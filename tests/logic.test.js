import { test } from 'node:test';
import assert from 'node:assert/strict';

import { poTotals, nextPoNum, buildDrafts, lineName, round2, packingLine, fmtMoney, ticketPrice } from '../src/lib/logic/po.js';
import { canTransition, transition, countByProduct } from '../src/lib/logic/boxes.js';
import { resolveScan } from '../src/lib/logic/scan.js';
import { buildOrderEmails, buildDeliveredEmail, buildShortageEmail, senderFor } from '../src/lib/logic/emails.js';
import { isMisc, passesFilters } from '../src/lib/logic/categories.js';
import { needsSetup, needsCost, needsType, needsTickets, needsAnyUpdate, needsVendor, UNKNOWN_VENDOR, productsNeedingSetup } from '../src/lib/logic/setup.js';
import { isGrabBag } from '../src/lib/logic/categories.js';

// ---------- PO math ----------
test('poTotals matches spreadsheet math (9.75% tax)', () => {
  // From the SC sheet: Pacific block totaled 1179.00 -> tax 114.9525 -> 1293.9525
  const lines = [{ qty: 1, cost: 1179 }];
  const t = poTotals(lines, 0.0975);
  assert.equal(t.subtotal, 1179);
  assert.equal(t.tax, 114.95);           // rounded to cents at PO level
  assert.equal(t.total, 1293.95);
});

test('poTotals sums multiple lines and rounds once', () => {
  const t = poTotals([{ qty: 4, cost: 86.4 }, { qty: 6, cost: 86.4 }, { qty: 3, cost: 60 }], 0.0975);
  assert.equal(t.subtotal, round2(345.6 + 518.4 + 180));   // 1044
  assert.equal(t.total, round2(1044 * 1.0975));
});

test('PO numbering increments per hall+vendor and pads', () => {
  const d = new Date('2026-08-01T12:00:00');
  let r = nextPoNum({}, 'sc', 'bv', d);
  assert.equal(r.num, 'SC-2026-08-BV-001');
  r = nextPoNum(r.seq, 'sc', 'bv', d);
  assert.equal(r.num, 'SC-2026-08-BV-002');
  const r2 = nextPoNum(r.seq, 'rwc', 'bv', d);
  assert.equal(r2.num, 'RWC-2026-08-BV-001');    // independent sequence
  const r3 = nextPoNum(r2.seq, 'sc', 'cbs', d);
  assert.equal(r3.num, 'SC-2026-08-CBS-001');
});

const products = [
  { id: 'P1', vendor_id: 'bv', name: 'Big Fish', cost: 117.3, tickets: 1995, price_per_ticket: 1, type: 'flash', packing_units: 1 },
  { id: 'P2', vendor_id: 'bv', name: 'Casino City', cost: 230.5, tickets: 1960, price_per_ticket: 2, type: 'flash', packing_units: 1 },
  { id: 'P3', vendor_id: 'md', name: 'Moolah', cost: 120, tickets: 2400, price_per_ticket: 1, type: 'flash', packing_units: 1 },
  { id: 'P4', vendor_id: 'md', name: 'Fat Kitty', cost: 89.1, tickets: null, price_per_ticket: 1, type: 'flash', packing_units: 1 },
];
const vendors = [
  { id: 'bv', name: 'Bingo Vision', email: 'bv@x.com', contact_name: 'Scott', tax_rate: 0.0975 },
  { id: 'md', name: 'Marathon', email: 'md@x.com', contact_name: 'Esteban', tax_rate: 0.0975 },
];
const SENDER = { name: 'Sagit', org: 'Vanguard' };

test('buildDrafts groups by vendor, skips zero qty, locks prices', () => {
  const drafts = buildDrafts({ P1: 2, P2: 0, P3: 1 }, products, vendors);
  assert.equal(drafts.length, 2);
  const bv = drafts.find((d) => d.vendor_id === 'bv');
  assert.equal(bv.lines.length, 1);
  assert.equal(bv.lines[0].cost, 117.3);
  assert.equal(bv.subtotal, 234.6);
});

// ---------- per-vendor packing charge ----------
const bvFee = { id: 'bv', name: 'Bingo Vision', email: 'bv@x.com', contact_name: 'Scott', tax_rate: 0.0975, packing_fee: 4, packing_types: 'flash' };
const vendorsFee = [bvFee, { id: 'md', name: 'Marathon', email: 'md@x.com', tax_rate: 0.0975 }];

test('Bingo Vision packs $4 per unit, and flash boxes hold one unit each', () => {
  const [d] = buildDrafts({ P1: 2, P2: 3 }, products, vendorsFee);   // both bv flash, 1 unit each
  const fee = d.lines.find((l) => l.kind === 'fee');
  assert.ok(fee, 'packing line missing');
  assert.equal(fee.qty, 5, '5 boxes x 1 unit');
  assert.equal(fee.cost, 4);
  assert.equal(fee.product_id, null, 'fee lines are not products');
  assert.match(fee.name_snapshot, /Packing/);
});

test('a case that packs 80 units is charged 80 x $4', () => {
  const cases = [{ id: 'C80', vendor_id: 'bv', name: '10-Pack of strips Biker', cost: 5120,
                   type: 'strip', price_per_ticket: 1, packing_units: 80 }];
  const [d] = buildDrafts({ C80: 1 }, cases, vendorsFee);
  assert.equal(d.lines.find((l) => l.kind === 'fee').qty, 80);
  assert.equal(d.subtotal, 5120 + 320);
});

test('an ordinary strip carries no packing even from the charging vendor', () => {
  const plain = [{ id: 'S16', vendor_id: 'bv', name: 'Monopoly', cost: 64.6,
                   type: 'strip', price_per_ticket: 1, packing_units: 0 }];
  const [d] = buildDrafts({ S16: 3 }, plain, vendorsFee);
  assert.ok(!d.lines.some((l) => l.kind === 'fee'), 'packing_units 0 means never charged');
  assert.equal(d.subtotal, round2(64.6 * 3));
});

test('a mixed order charges only the units that carry packing', () => {
  const mix = [
    { id: 'F', vendor_id: 'bv', name: 'Pecker Heads', cost: 58.8, type: 'flash', price_per_ticket: 1, packing_units: 1 },
    { id: 'S', vendor_id: 'bv', name: 'Monopoly', cost: 64.6, type: 'strip', price_per_ticket: 1, packing_units: 0 },
    { id: 'C', vendor_id: 'bv', name: '10-Pack of strips', cost: 5120, type: 'strip', price_per_ticket: 1, packing_units: 80 },
  ];
  const [d] = buildDrafts({ F: 2, S: 4, C: 1 }, mix, vendorsFee);
  assert.equal(d.lines.find((l) => l.kind === 'fee').qty, 82, '2 flash units + 80 case units, strips excluded');
});

test('packing never applies to a vendor that does not charge it', () => {
  const other = [{ id: 'X', vendor_id: 'md', name: 'Anything', cost: 100, type: 'flash', price_per_ticket: 1, packing_units: 1 }];
  const drafts = buildDrafts({ X: 5 }, other, vendorsFee);
  assert.ok(!drafts[0].lines.some((l) => l.kind === 'fee'), 'only Bingo Vision charges packing');
});

test('packing is included in subtotal, tax and total', () => {
  const [d] = buildDrafts({ P1: 2 }, products, vendorsFee);          // 2 x 117.30 = 234.60 + 8 packing
  assert.equal(d.subtotal, 242.60);
  assert.equal(d.total, round2(242.60 * 1.0975));
});

test('packingLine returns null for a vendor with no fee configured', () => {
  assert.equal(packingLine({ packing_fee: 0 }, [{ qty: 2, _packUnits: 1 }]), null);
  assert.equal(packingLine({}, [{ qty: 2, _packUnits: 1 }]), null);
  assert.equal(packingLine({ packing_fee: 4 }, [{ qty: 2, _packUnits: 0 }]), null,
    'a charging vendor still adds nothing when nothing packs');
});

test('lineName includes tickets/price only when known', () => {
  assert.equal(lineName(products[0]), 'Big Fish (1995/$1)');
  assert.equal(lineName(products[1]), 'Casino City (1960/$2)');
  assert.equal(lineName(products[3]), 'Fat Kitty');
});

// ---------- box state machine ----------
test('legal lifecycle passes, illegal jumps throw', () => {
  let b = { state: 'on_order' };
  b = transition(b, 'in_inventory');
  assert.ok(b.received_at);
  b = transition(b, 'opened');
  b = transition(b, 'sold_out');
  assert.ok(b.sold_out_at);
  assert.throws(() => transition({ state: 'sold_out' }, 'in_inventory'));
  assert.throws(() => transition({ state: 'on_order' }, 'sold_out'));
  assert.throws(() => transition({ state: 'on_order' }, 'opened'));
});

test('undo paths are allowed', () => {
  assert.ok(canTransition('opened', 'in_inventory'));   // undo open
  assert.ok(canTransition('sold_out', 'opened'));       // undo sold-out
  assert.ok(canTransition('missing', 'in_inventory'));  // late arrival
});

test('countByProduct tallies states', () => {
  const c = countByProduct([
    { product_id: 'P1', state: 'in_inventory' },
    { product_id: 'P1', state: 'in_inventory' },
    { product_id: 'P1', state: 'opened' },
    { product_id: 'P1', state: 'on_order' },
    { product_id: 'P2', state: 'sold_out' },
  ]);
  assert.deepEqual(c.P1, { inv: 2, open: 1, onorder: 1, sold: 0, missing: 0 });
  assert.equal(c.P2.sold, 1);
});

// ---------- scan resolver ----------
const boxes = [
  { id: 'b1', serial: 'SN100', state: 'on_order', po_id: 'po1', product_id: 'P1' },
  { id: 'b2', serial: 'SN200', state: 'in_inventory', product_id: 'P1' },
  { id: 'b3', serial: 'SN300', state: 'opened', opened_at: '2026-07-30T21:14:00Z', product_id: 'P1' },
  { id: 'b4', serial: 'SN400', state: 'sold_out', product_id: 'P2' },
];

test('resolver: mode off', () => {
  assert.equal(resolveScan('SN200', { mode: 'off', boxes }).ok, false);
});
test('resolver: unknown code', () => {
  const r = resolveScan('NOPE', { mode: 'open', boxes });
  assert.equal(r.reason, 'unknown');
});
test('resolver: receive matches on-order box on the right PO', () => {
  assert.equal(resolveScan('SN100', { mode: 'receive', boxes, poId: 'po1' }).action, 'receive');
  assert.equal(resolveScan('SN100', { mode: 'receive', boxes, poId: 'po2' }).reason, 'wrong_po');
});
test('resolver: open works once, duplicate detected', () => {
  assert.equal(resolveScan('SN200', { mode: 'open', boxes }).action, 'open');
  assert.equal(resolveScan('SN300', { mode: 'open', boxes }).reason, 'duplicate');
});
test('resolver: soldout requires opened first', () => {
  assert.equal(resolveScan('SN300', { mode: 'soldout', boxes }).action, 'soldout');
  assert.equal(resolveScan('SN200', { mode: 'soldout', boxes }).reason, 'wrong_state');
  assert.equal(resolveScan('SN400', { mode: 'soldout', boxes }).reason, 'duplicate');
});

// ---------- emails ----------
test('order run builds one vendor email per PO (accounting not copied on POs)', () => {
  const pos = [{ num: 'SC-2026-08-BV-001', vendor_id: 'bv', lines: [{ qty: 2, name_snapshot: 'Big Fish (1995/$1)', cost: 117.3 }], subtotal: 234.6, tax: 22.87, total: 257.47 }];
  const emails = buildOrderEmails(pos, vendors, 'Santa Clara', '123 Main St', 'acct@hall.com', SENDER);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].kind, 'po');
  assert.equal(emails[0].to, 'bv@x.com');
  assert.ok(!emails.some((e) => e.to === 'acct@hall.com'), 'accounting must not be on PO emails');
  assert.match(emails[0].body, /Total:.*\$257\.47/s);
});

// ---------- the human layer ----------
test('PO email greets the vendor contact and is signed by a named person', () => {
  const pos = [{ num: 'SC-1', vendor_id: 'bv', lines: [{ qty: 1, name_snapshot: 'A', cost: 10 }], subtotal: 10, tax: 1, total: 11 }];
  const [e] = buildOrderEmails(pos, vendors, 'Santa Clara', '123 Main St', '', SENDER);
  assert.ok(e.body.startsWith('Hi Scott,'), 'must open with a greeting');
  assert.match(e.body, /Thanks,\nSagit/, 'must be signed by the sender');
  assert.match(e.body, /Vanguard/);
  assert.ok(!/\bPURCHASE ORDER\b/.test(e.body), 'should not read like a machine dump');
  assert.match(e.subject, /Santa Clara order/);
});

test('emails degrade gracefully with no contact name or sender configured', () => {
  const anon = [{ id: 'bv', name: 'Bingo Vision', email: 'bv@x.com', tax_rate: 0.0975 }];
  const pos = [{ num: 'SC-1', vendor_id: 'bv', lines: [{ qty: 1, name_snapshot: 'A', cost: 10 }], subtotal: 10, tax: 1, total: 11 }];
  const [e] = buildOrderEmails(pos, anon, 'Santa Clara', '', '');
  assert.ok(e.body.startsWith('Hello,'), 'falls back to a neutral greeting');
  assert.match(e.body, /The inventory team/, 'falls back to a neutral signature');
  assert.ok(!e.body.includes('undefined') && !e.body.includes('null'));
});

test('two vendors -> two PO emails, still no accounting copies', () => {
  const pos = [
    { num: 'SC-1', vendor_id: 'bv', lines: [{ qty: 1, name_snapshot: 'A', cost: 10 }], subtotal: 10, tax: 1, total: 11 },
    { num: 'SC-2', vendor_id: 'md', lines: [{ qty: 1, name_snapshot: 'B', cost: 20 }], subtotal: 20, tax: 2, total: 22 },
  ];
  const emails = buildOrderEmails(pos, vendors, 'Santa Clara', '', 'acct@hall.com', SENDER);
  assert.equal(emails.length, 2);
  assert.deepEqual(emails.map((e) => e.to).sort(), ['bv@x.com', 'md@x.com']);
});

// ---------- items imported without a price ----------
test('an item with no cost is not ready to order or receive', () => {
  // needsCost is about money; needsSetup is about whether an order can be addressed
  assert.equal(needsCost({ name: 'Cowgirls', cost: 0 }), true);
  assert.equal(needsCost({ name: 'Cowgirls', cost: '0.00' }), true);
  assert.equal(needsCost({ name: 'Cowgirls' }), true);
  assert.equal(needsCost({ name: 'BIG FISH', cost: 117.3 }), false);
  assert.equal(needsCost({ name: 'BIG FISH', cost: '117.30' }), false, 'costs arrive as strings from the API');
  assert.equal(needsSetup({ name: 'BIG FISH', cost: 117.3, vendor_id: 'bv' }), false,
    'a priced game with a real distributor is ready to order');
  assert.equal(needsSetup({ name: 'Cowgirls', cost: 0, vendor_id: 'bv' }), false,
    'no price is fine — the PO prints ? and asks the vendor');
});

test('productsNeedingSetup lists the ones with no distributor, alphabetically', () => {
  const list = productsNeedingSetup([
    { name: 'Zeta', vendor_id: UNKNOWN_VENDOR, cost: 64.6 },
    { name: 'BIG FISH', vendor_id: 'bv', cost: 117.3 },
    { name: 'Alpha', vendor_id: null, cost: 0 },
    { name: 'Priced later', vendor_id: 'md', cost: 0 },
  ]);
  assert.deepEqual(list.map((p) => p.name), ['Alpha', 'Zeta'],
    'a known distributor with no price is orderable; an unknown distributor is not');
});

// ---------- inventory filters ----------
const FLASH  = { name: 'BIG FISH', type: 'flash' };
const STRIP  = { name: 'Vanguard Strips', type: 'strip' };
const PAPER  = { name: 'Red/White/Blue paper', type: 'paper' };
const DAUBER = { name: '$2 DAUBERS — Blue', type: 'supply' };
const CHERRY = { name: 'Cherry Ticket-- A Whole Lotta', type: 'flash' };

test('misc = dauber supplies and cherry-ticket cases', () => {
  assert.equal(isMisc(DAUBER), true);
  assert.equal(isMisc(CHERRY), true, 'cherry cases are misc even though the type is flash');
  assert.equal(isMisc(FLASH), false);
  assert.equal(isMisc(STRIP), false);
});

test('games-only (the default) hides daubers and cherry', () => {
  const opts = { misc: 'games' };
  assert.ok(passesFilters(FLASH, opts) && passesFilters(STRIP, opts) && passesFilters(PAPER, opts));
  assert.ok(!passesFilters(DAUBER, opts));
  assert.ok(!passesFilters(CHERRY, opts));
});

test('include-all shows everything; misc-only shows just cherry and daubers', () => {
  const all = { misc: 'all' };
  assert.ok([FLASH, STRIP, PAPER, DAUBER, CHERRY].every((p) => passesFilters(p, all)));
  const only = { misc: 'misc' };
  assert.ok(passesFilters(DAUBER, only) && passesFilters(CHERRY, only));
  assert.ok(!passesFilters(FLASH, only) && !passesFilters(STRIP, only));
});

test('type filter combines with the misc filter', () => {
  assert.ok(passesFilters(FLASH, { type: 'flash', misc: 'games' }));
  assert.ok(!passesFilters(STRIP, { type: 'flash', misc: 'games' }));
  // cherry is type flash but still hidden in games-only
  assert.ok(!passesFilters(CHERRY, { type: 'flash', misc: 'games' }));
  assert.ok(passesFilters(CHERRY, { type: 'flash', misc: 'all' }));
});

// ---------- per-hall sender ----------
const SENDERS = {
  sc: { name: 'Sagit', org: 'Vanguard' },
  rwc: { name: 'Shelly', org: 'Vanguard' },
};

test('each hall signs with its own person', () => {
  assert.equal(senderFor(SENDERS, 'sc').name, 'Sagit');
  assert.equal(senderFor(SENDERS, 'rwc').name, 'Shelly');
});

test('Redwood City POs are signed by Shelly, Santa Clara by Sagit', () => {
  const pos = [{ num: 'RWC-1', vendor_id: 'bv', lines: [{ qty: 1, name_snapshot: 'A', cost: 10 }], subtotal: 10, tax: 1, total: 11 }];
  const [rwc] = buildOrderEmails(pos, vendors, 'Redwood City', '', '', senderFor(SENDERS, 'rwc'));
  assert.match(rwc.body, /Thanks,\nShelly/);
  assert.ok(!rwc.body.includes('Sagit'));
  const [sc] = buildOrderEmails([{ ...pos[0], num: 'SC-1' }], vendors, 'Santa Clara', '', '', senderFor(SENDERS, 'sc'));
  assert.match(sc.body, /Thanks,\nSagit/);
});

test('senderFor accepts the older flat shape for every hall', () => {
  const flat = { name: 'Sagit', org: 'Vanguard' };
  assert.equal(senderFor(flat, 'rwc').name, 'Sagit');
  assert.equal(senderFor(flat, 'sc').name, 'Sagit');
});

test('senderFor degrades to an empty object when unset', () => {
  assert.deepEqual(senderFor(undefined, 'sc'), {});
  assert.deepEqual(senderFor({}, 'sc'), {});
});

test('delivered email computes pay amount from received only, flags variance', () => {
  const po = { num: 'SC-1', total: 257.47, lines: [] };
  const received = [{ qty: 1, name_snapshot: 'Big Fish (1995/$1)', cost: 117.3 }];
  const missing = [{ qty: 1, name_snapshot: 'Big Fish (1995/$1)', cost: 117.3 }];
  const e = buildDeliveredEmail(po, vendors[0], 'Santa Clara', 'INV-9', received, missing, SENDER, 'Jamie');
  assert.equal(e.amount, Math.round(117.3 * 1.0975 * 100) / 100);
  assert.match(e.subject, /short delivery/i);
  assert.match(e.subject, /Pay \$128\.74/, 'subject states the amount to pay');
  assert.match(e.body, /don't pay for these/);
  assert.ok(e.body.startsWith('Hi Jamie,'));
  assert.match(e.body, /Thanks,\nSagit/);
});

test('fully-delivered email says so plainly and has no short-pay warning', () => {
  const po = { num: 'SC-1', total: 128.73, lines: [] };
  const e = buildDeliveredEmail(po, vendors[0], 'Santa Clara', 'INV-9',
    [{ qty: 1, name_snapshot: 'Big Fish', cost: 117.3 }], [], SENDER, 'Jamie');
  assert.ok(!/short/i.test(e.subject));
  assert.match(e.body, /Everything we ordered arrived/);
  assert.ok(!e.body.includes("don't pay for these"));
});

test('shortage email lists missing value', () => {
  const e = buildShortageEmail({ num: 'SC-1' }, vendors[0], 'SC', [{ qty: 2, name_snapshot: 'X', cost: 50 }], SENDER);
  assert.match(e.body, /\$100\.00/);
  assert.match(e.subject, /Missing items/);
  assert.ok(e.body.startsWith('Hi Scott,'));
  assert.match(e.body, /2 items were missing/, 'plural phrasing');
  assert.match(e.body, /backorder/);
});

test('shortage email uses singular phrasing for one missing item', () => {
  const e = buildShortageEmail({ num: 'SC-1' }, vendors[0], 'SC', [{ qty: 1, name_snapshot: 'X', cost: 50 }], SENDER);
  assert.match(e.body, /one item was missing/);
  assert.match(e.body, /whether it's coming/);
});

test('a blank type is flagged for update, but guarantee is a real type', () => {
  assert.equal(needsType({ name: 'Caribbean Gold', type: null }), true);
  assert.equal(needsType({ name: 'Caribbean Gold' }), true);
  assert.equal(needsType({ name: 'Guarantee numbers- Money Tree', type: 'guarantee' }), false,
    'SC stocks 24 real guarantee games — the type must stay valid');
  assert.equal(needsType({ name: 'Cowgirls', type: 'flash' }), false);
});

test('only flash games need a ticket count', () => {
  assert.equal(needsTickets({ name: 'Cowgirls', type: 'flash', tickets: null }), true);
  assert.equal(needsTickets({ name: 'Cowgirls', type: 'flash', tickets: 1440 }), false);
  assert.equal(needsTickets({ name: 'Lucky Strip', type: 'strip', tickets: 0 }), false,
    'strips sell as a pack, so a ticket count is meaningless');
  assert.equal(needsTickets({ name: 'Red,White and Blue paper', type: 'paper' }), false);
  assert.equal(needsTickets({ name: 'Guarantee- Comics', type: 'guarantee' }), false);
  assert.equal(needsTickets({ name: '$2 DAUBERS — Blue', type: 'supply' }), false);
  assert.equal(needsTickets({ name: 'Caribbean Gold', type: null }), false,
    'ask for the type first — the ticket question only makes sense once it is flash');
  assert.equal(needsTickets({ name: 'Big Five cherry ticket', type: 'flash' }), false,
    'cherry cases sell by the ticket and are counted, not boxed');
  assert.equal(needsTickets({ name: "Cheery- Thrilling 3's/Bank Busters", type: 'flash' }), false,
    'the count sheet misspelled cherry — it is still a cherry case');
});

test('retyping a flash game as a strip clears its ticket requirement', () => {
  const before = { name: 'Bingo Shark', vendor_id: 'bv', type: 'flash', cost: 64.6, tickets: null };
  assert.equal(needsAnyUpdate(before), true);
  const after = { ...before, type: 'strip' };
  assert.equal(needsAnyUpdate(after), false, 'one edit clears every update tag on the row');
});

test('only a missing distributor blocks ordering; other gaps just ask for an update', () => {
  const noType = { name: 'Caribbean Gold', vendor_id: 'pbf', type: null, cost: 89.1, tickets: 1440 };
  assert.equal(needsSetup(noType), false, 'a blank type must not stop a PO');
  assert.equal(needsAnyUpdate(noType), true, 'but it still shows update');
  const done = { name: 'BIG FISH', vendor_id: 'bv', type: 'flash', cost: 117.3, tickets: 1440 };
  assert.equal(needsAnyUpdate(done), false);
});

test('mixed packs are not asked for a ticket count', () => {
  for (const name of ['Misc Packs', 'Premium Misc packs', 'Misc packs of Race/Down',
                      'Misc Vanguard Packs of strips', 'Assorted flash', 'Variety pack']) {
    assert.equal(isGrabBag({ name }), true, name);
    assert.equal(needsTickets({ name, type: 'flash', tickets: null }), false, name);
  }
});

test('a real game whose name merely contains those letters still needs a count', () => {
  assert.equal(isGrabBag({ name: 'Miscreant Mayhem' }), false, 'word boundary, not substring');
  assert.equal(needsTickets({ name: 'Miscreant Mayhem', type: 'flash', tickets: null }), true);
  assert.equal(isGrabBag({ name: 'Monopoly' }), false);
});

// ---- asking a distributor for prices and counts ----
import { buildPriceRequests, buildPriceRequestEmail } from '../src/lib/logic/emails.js';

const ASK_VENDORS = [
  { id: 'bv', name: 'Bingo Vision', email: 'scott@example-bv.com', contact_name: 'Scott' },
  { id: 'md', name: 'Marathon Distributors', email: 'esteban@example-md.com', contact_name: 'Esteban' },
];
const ASK_SENDER = { name: 'Sagit', title: 'Inventory', org: 'Vanguard' };

test('one email per distributor, each listing only their own games', () => {
  const items = [
    { name: 'Cowgirls', vendor_id: 'bv', cost: 0, tickets: 0, ask: ['price', 'tickets'] },
    { name: 'Smokin Tokens', vendor_id: 'md', cost: 0, tickets: 0, ask: ['price'] },
    { name: 'Animal Idol', vendor_id: 'bv', cost: 0, tickets: 0, ask: ['price'] },
  ];
  const out = buildPriceRequests(items, ASK_VENDORS, 'Redwood City', ASK_SENDER);
  assert.equal(out.length, 2);
  const bv = out.find((e) => e.vendor_id === 'bv');
  assert.equal(bv.to, 'scott@example-bv.com');
  assert.match(bv.body, /Hi Scott,/);
  assert.match(bv.body, /Cowgirls/);
  assert.match(bv.body, /Animal Idol/);
  assert.ok(!bv.body.includes('Smokin Tokens'), "another vendor's game must not leak into this email");
  assert.match(out.find((e) => e.vendor_id === 'md').body, /Smokin Tokens/);
});

test('games are listed alphabetically and the ask names the missing field', () => {
  const e = buildPriceRequestEmail(ASK_VENDORS[0], 'Santa Clara', [
    { name: 'Alpha', cost: 0, tickets: 0, ask: ['price'] },
    { name: 'Beta', cost: 64.6, tickets: 0, ask: ['tickets'] },
  ], ASK_SENDER);
  assert.ok(e.body.indexOf('Alpha') < e.body.indexOf('Beta'));
  assert.match(e.body, /Beta.*tickets per box/);
  assert.match(e.body, /we have \$64\.60/, 'quote back what we hold so they can correct it');
});

test('the subject narrows when we only need one kind of answer', () => {
  const priceOnly = buildPriceRequestEmail(ASK_VENDORS[0], 'Santa Clara',
    [{ name: 'Alpha', cost: 0, tickets: 0, ask: ['price'] }], ASK_SENDER);
  assert.match(priceOnly.subject, /current pricing on 1 game/);
  const both = buildPriceRequestEmail(ASK_VENDORS[0], 'Santa Clara', [
    { name: 'Alpha', cost: 0, tickets: 0, ask: ['price'] },
    { name: 'Beta', cost: 0, tickets: 0, ask: ['tickets'] },
  ], ASK_SENDER);
  assert.match(both.subject, /pricing and ticket counts on 2 games/);
});

test('the sender signs it and an optional note is carried through', () => {
  const e = buildPriceRequestEmail(ASK_VENDORS[0], 'Santa Clara',
    [{ name: 'Alpha', cost: 0, tickets: 0, ask: ['price'] }], ASK_SENDER, 'Planning the fall order.');
  assert.match(e.body, /Planning the fall order\./);
  assert.match(e.body, /Thanks,\nSagit\nInventory, Vanguard\nSanta Clara/);
});

test('a vendor with no address is skipped rather than sent into the void', () => {
  const out = buildPriceRequests(
    [{ name: 'Orphan', vendor_id: 'nobody', cost: 0, tickets: 0, ask: ['price'] }],
    ASK_VENDORS, 'Santa Clara', ASK_SENDER);
  assert.equal(out.length, 0);
});

// ---- ordering a game before we know its price ----
const TBD_VENDORS = [{ id: 'bv', name: 'Bingo Vision', email: 'scott@bv.test', contact_name: 'Scott', tax_rate: 0.0975, packing_fee: 0 }];
const TBD_PRODUCTS = [
  { id: 'A', vendor_id: 'bv', name: 'Priced Game', type: 'flash', cost: 100, tickets: 1440, price_per_ticket: 1 },
  { id: 'B', vendor_id: 'bv', name: 'New Game', type: 'flash', cost: 0, tickets: null, price_per_ticket: 1 },
];

test('an unpriced game can be ordered and is flagged rather than counted as free', () => {
  const [d] = buildDrafts({ A: 2, B: 3 }, TBD_PRODUCTS, TBD_VENDORS);
  assert.equal(d.lines.length, 2);
  const b = d.lines.find((l) => l.product_id === 'B');
  assert.equal(b.price_tbd, true);
  assert.equal(b.qty, 3, 'the quantity is real even though the price is not');
  assert.equal(d.lines.find((l) => l.product_id === 'A').price_tbd, false);
});

test('the total covers the priced lines only, and says so', () => {
  const [d] = buildDrafts({ A: 2, B: 3 }, TBD_PRODUCTS, TBD_VENDORS);
  assert.equal(d.subtotal, 200, 'the unpriced line must not add $0 worth of nothing');
  assert.equal(d.tax, 19.5);
  assert.equal(d.total, 219.5);
  assert.equal(d.tbd, 1);
  assert.equal(d.partial, true);
});

test('an order with every price known is not marked partial', () => {
  const [d] = buildDrafts({ A: 2 }, TBD_PRODUCTS, TBD_VENDORS);
  assert.equal(d.tbd, 0);
  assert.equal(d.partial, false);
});

test('poTotals ignores unpriced lines when computing tax', () => {
  const t = poTotals([
    { qty: 1, cost: 100, price_tbd: false },
    { qty: 9, cost: 0, price_tbd: true },
  ], 0.1);
  assert.equal(t.subtotal, 100);
  assert.equal(t.tax, 10, 'tax on what we know, not on a phantom zero');
  assert.equal(t.total, 110);
  assert.equal(t.tbd, 1);
});

test('the PO email prints ? and asks the vendor to fill the price in', () => {
  const [d] = buildDrafts({ A: 2, B: 3 }, TBD_PRODUCTS, TBD_VENDORS);
  const [e] = buildOrderEmails([{ ...d, num: 'SC-2026-08-BV-001' }], TBD_VENDORS, 'Santa Clara', '', '', { name: 'Sagit' });
  assert.match(e.body, /New Game\s+\?\s+ea\s+=\s+\?/, 'both money columns read ? on that line');
  assert.match(e.body, /\$100\.00 ea/, 'the priced line still shows its price');
  assert.match(e.body, /Items below marked with a \? we don't have a current price\./);
  assert.match(e.body, /send over pricing, we will update and resend same PO/);
  assert.match(e.body, /covers the priced lines only/);
});

test('a fully priced PO email says nothing about missing prices', () => {
  const [d] = buildDrafts({ A: 2 }, TBD_PRODUCTS, TBD_VENDORS);
  const [e] = buildOrderEmails([{ ...d, num: 'SC-2026-08-BV-002' }], TBD_VENDORS, 'Santa Clara', '', '', { name: 'Sagit' });
  assert.ok(!/\?\s+ea/.test(e.body), 'no ? in the money column on a fully priced order');
  assert.ok(!e.body.includes("Items below marked with a ?"));
  assert.ok(!e.body.includes('covers the priced lines only'));
});

// ---- per-vendor delivery addresses ----
import { deliveryAddress, setVendorAddress, hasOverride, overriddenVendors } from '../src/lib/logic/halls.js';

const HALLS = {
  sc: { address: '1 Hall Way, Santa Clara, CA' },
  rwc: { address: '2 Hall Rd, Redwood City, CA', byVendor: { md: '900 Dock St, San Carlos, CA' } },
};

test('a vendor without its own address gets the hall address', () => {
  assert.equal(deliveryAddress(HALLS, 'rwc', 'bv'), '2 Hall Rd, Redwood City, CA');
  assert.equal(deliveryAddress(HALLS, 'sc', 'md'), '1 Hall Way, Santa Clara, CA',
    "an override on one hall must not leak into the other");
});

test('a vendor with its own address gets that one', () => {
  assert.equal(deliveryAddress(HALLS, 'rwc', 'md'), '900 Dock St, San Carlos, CA');
  assert.equal(hasOverride(HALLS, 'rwc', 'md'), true);
  assert.equal(hasOverride(HALLS, 'rwc', 'bv'), false);
});

test('clearing a vendor address puts it back on the hall address', () => {
  const cleared = setVendorAddress(HALLS, 'rwc', 'md', '   ');
  assert.equal(hasOverride(cleared, 'rwc', 'md'), false);
  assert.equal(deliveryAddress(cleared, 'rwc', 'md'), '2 Hall Rd, Redwood City, CA');
  assert.deepEqual(HALLS.rwc.byVendor, { md: '900 Dock St, San Carlos, CA' }, 'must not mutate the original');
});

test('setting a vendor address leaves every other vendor and hall alone', () => {
  const next = setVendorAddress(HALLS, 'rwc', 'bv', '77 Side Door, Redwood City, CA');
  assert.equal(deliveryAddress(next, 'rwc', 'bv'), '77 Side Door, Redwood City, CA');
  assert.equal(deliveryAddress(next, 'rwc', 'md'), '900 Dock St, San Carlos, CA');
  assert.equal(deliveryAddress(next, 'sc', 'bv'), '1 Hall Way, Santa Clara, CA');
});

test('missing config is empty rather than a crash', () => {
  assert.equal(deliveryAddress(undefined, 'rwc', 'md'), '');
  assert.equal(deliveryAddress({}, 'rwc', 'md'), '');
  assert.equal(deliveryAddress({ rwc: {} }, 'rwc', 'md'), '');
  assert.deepEqual(overriddenVendors(undefined, 'rwc', [{ id: 'md' }]), []);
});

test('the PO prints the address for the vendor it is going to', () => {
  const V = [
    { id: 'bv', name: 'Bingo Vision', email: 'a@x.test', contact_name: 'Scott', tax_rate: 0.0975, packing_fee: 0 },
    { id: 'md', name: 'Marathon', email: 'b@x.test', contact_name: 'Esteban', tax_rate: 0.0975, packing_fee: 0 },
  ];
  const P = [
    { id: 'A', vendor_id: 'bv', name: 'Alpha', type: 'flash', cost: 10, tickets: 100, price_per_ticket: 1 },
    { id: 'B', vendor_id: 'md', name: 'Beta', type: 'flash', cost: 20, tickets: 100, price_per_ticket: 1 },
  ];
  const drafts = buildDrafts({ A: 1, B: 1 }, P, V).map((d, i) => ({ ...d, num: `N${i}` }));
  const resolver = (vid) => deliveryAddress(HALLS, 'rwc', vid);
  const out = buildOrderEmails(drafts, V, 'Redwood City', resolver, '', { name: 'Shelly' });
  const bv = out.find((e) => e.to === 'a@x.test');
  const md = out.find((e) => e.to === 'b@x.test');
  assert.match(bv.body, /Please deliver to:\n2 Hall Rd, Redwood City, CA/);
  assert.match(md.body, /Please deliver to:\n900 Dock St, San Carlos, CA/);
});

test('a plain string address still works everywhere', () => {
  const V = [{ id: 'bv', name: 'BV', email: 'a@x.test', contact_name: 'Scott', tax_rate: 0.0975, packing_fee: 0 }];
  const P = [{ id: 'A', vendor_id: 'bv', name: 'Alpha', type: 'flash', cost: 10, tickets: 100, price_per_ticket: 1 }];
  const [d] = buildDrafts({ A: 1 }, P, V);
  const [e] = buildOrderEmails([{ ...d, num: 'N1' }], V, 'Santa Clara', '1 Hall Way', '', { name: 'Sagit' });
  assert.match(e.body, /Please deliver to:\n1 Hall Way/);
});

// ---- numbers arrive from Postgres as strings ----
test('$ per ticket survives the string form the API sends', () => {
  assert.equal(ticketPrice({ price_per_ticket: '1.00' }), 1, 'this is what broke the catalog filter');
  assert.equal(ticketPrice({ price_per_ticket: '2.00' }), 2);
  assert.equal(ticketPrice({ price_per_ticket: 2 }), 2);
  assert.equal(ticketPrice({}), 1, 'default to $1');
  assert.equal(ticketPrice(null), 1);
  assert.equal(ticketPrice({ price_per_ticket: '0' }), 1, 'zero is not a real ticket price');
});

test('a filter comparing $ per ticket as text now matches', () => {
  const rows = [{ price_per_ticket: '1.00' }, { price_per_ticket: '2.00' }, { price_per_ticket: '1.00' }];
  assert.equal(rows.filter((p) => String(ticketPrice(p)) === '1').length, 2);
  assert.equal(rows.filter((p) => String(ticketPrice(p)) === '2').length, 1);
  // the old expression, kept as a reminder of the bug it caused
  assert.equal(rows.filter((p) => String(p.price_per_ticket || 1) === '1').length, 0);
});

test('money formats properly even when the value is a string', () => {
  assert.equal(fmtMoney('1234.5'), '$1,234.50');
  assert.equal(fmtMoney('64.60'), '$64.60');
  assert.equal(fmtMoney(1234.5), '$1,234.50');
  assert.equal(fmtMoney(null), '$0.00');
});

// ---- a game whose distributor nobody has confirmed ----
test('the unknown-distributor placeholder counts as a gap, not a vendor', () => {
  assert.equal(needsVendor({ vendor_id: UNKNOWN_VENDOR }), true);
  assert.equal(needsVendor({ vendor_id: null }), true);
  assert.equal(needsVendor({}), true);
  assert.equal(needsVendor({ vendor_id: 'bv' }), false);
});

test('a fully priced game still needs updating while its distributor is unknown', () => {
  const p = { name: 'Little Horses', vendor_id: UNKNOWN_VENDOR, type: 'flash', cost: 64.6, tickets: 1440 };
  assert.equal(needsCost(p), false);
  assert.equal(needsTickets(p), false);
  assert.equal(needsAnyUpdate(p), true, 'the distributor gap has to keep it flagged');
  assert.equal(needsSetup(p), true, 'and it must stay off any order');
});

test('an unknown-distributor game cannot reach a purchase order', () => {
  const V = [
    { id: 'bv', name: 'Bingo Vision', tax_rate: 0.0975, packing_fee: 0 },
    { id: 'unknown', name: 'Unknown — needs confirming', tax_rate: 0.0975, packing_fee: 0 },
  ];
  const P = [
    { id: 'A', vendor_id: 'bv', name: 'Known Game', type: 'flash', cost: 50, tickets: 100, price_per_ticket: 1 },
    { id: 'B', vendor_id: 'unknown', name: 'Little Horses', type: 'flash', cost: 60, tickets: 100, price_per_ticket: 1 },
  ];
  const drafts = buildDrafts({ A: 2, B: 5 }, P, V);
  assert.equal(drafts.length, 1, 'no PO is built for a vendor we cannot email');
  assert.equal(drafts[0].vendor_id, 'bv');
  assert.ok(!drafts[0].lines.some((l) => l.product_id === 'B'),
    'and it must not be smuggled onto someone else’s order either');
});
