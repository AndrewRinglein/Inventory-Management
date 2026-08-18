import { test } from 'node:test';
import assert from 'node:assert/strict';

import { poTotals, nextPoNum, buildDrafts, lineName, round2, packingLine, fmtMoney, ticketPrice,
  snapshotHead, snapshotRest } from '../src/lib/logic/po.js';
import { canTransition, transition, countByProduct } from '../src/lib/logic/boxes.js';
import { resolveScan } from '../src/lib/logic/scan.js';
import { buildOrderEmails, buildDeliveredEmail, buildShortageEmail, senderFor } from '../src/lib/logic/emails.js';
import { isMisc, passesFilters } from '../src/lib/logic/categories.js';
import { needsSetup, needsCost, needsType, needsTickets, needsAnyUpdate, needsVendor, UNKNOWN_VENDOR, productsNeedingSetup } from '../src/lib/logic/setup.js';
import { isGrabBag } from '../src/lib/logic/categories.js';
import { priceParts, boxCost, baseCost, packUnits, packingFor } from '../src/lib/logic/pricing.js';
import { receivedLine, missingLine, extraLine, perUnitOf, lineSplit } from '../src/lib/logic/receiving.js';
import { writeOffCost, wantedFromPlays, consumeOrder } from '../src/lib/logic/session.js';
import { coverShortage, shortageAdvice, onFloor, playable, daysSinceConfirmed }
  from '../src/lib/logic/location.js';
import { DemoStore } from '../src/lib/store/demoStore.js';

/**
 * A hall with one box of Bingo Bandit, none of Cash Cow, one of Ditto Dog, and an
 * unapplied session to run against it. Built through DemoStore so the test drives
 * the same applySession the app does — a local re-implementation would let the
 * real one regress with the suite still green, which is how the last fix slipped.
 */
function shortStore() {
  const s = new DemoStore();
  s.db = {
    halls: [{ id: 'sc', name: 'Santa Clara' }],
    products: [
      { id: 'G1', name: 'Bingo Bandit', base_cost: 100, pack_units: 1, split_boxes: 1 },
      { id: 'G2', name: 'Cash Cow', base_cost: 80, pack_units: 1, split_boxes: 1 },
      { id: 'G3', name: 'Ditto Dog', base_cost: 60, pack_units: 1, split_boxes: 1 },
    ],
    boxes: [
      { id: 'b1', hall_id: 'sc', product_id: 'G1', state: 'in_inventory' },
      { id: 'b3', hall_id: 'sc', product_id: 'G3', state: 'in_inventory' },
    ],
    sessions: [{ id: 's1', hall_id: 'sc', session_date: '2026-08-10', part: '', applied_at: null }],
    session_plays: [], events: [], settings: {},
  };
  s._save = () => {};
  return s;
}

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

test('packing rides on the line that earned it, not a lump at the bottom', () => {
  const [d] = buildDrafts({ P1: 2, P2: 3 }, products, vendorsFee);   // both bv flash, 1 unit each
  assert.ok(!d.lines.some((l) => l.kind === 'fee'), 'no separate packing line any more');
  for (const l of d.lines) assert.equal(l.packing_each, 4, 'each flash box carries its own $4');
  assert.equal(d.subtotal, round2(2 * (117.3 + 4) + 3 * (230.5 + 4)));
});

test('a case that packs 80 units carries $320 on its own line', () => {
  const cases = [{ id: 'C80', vendor_id: 'bv', name: '10-Pack of strips Biker', cost: 5120,
                   base_cost: 64, pack_units: 80, type: 'strip', price_per_ticket: 1, packing_units: 80 }];
  const [d] = buildDrafts({ C80: 1 }, cases, vendorsFee);
  const l = d.lines[0];
  assert.equal(l.packing_each, 320, 'on the line, where a vendor can check it');
  assert.equal(l.base_cost, 64);
  assert.equal(l.pack_units, 80);
  assert.equal(d.subtotal, 5440);
});

test('an ordinary strip carries no packing even from the charging vendor', () => {
  const plain = [{ id: 'S16', vendor_id: 'bv', name: 'Monopoly', cost: 64.6,
                   type: 'strip', price_per_ticket: 1, packing_units: 0 }];
  const [d] = buildDrafts({ S16: 3 }, plain, vendorsFee);
  assert.ok(!d.lines.some((l) => l.kind === 'fee'), 'packing_units 0 means never charged');
  assert.equal(d.subtotal, round2(64.6 * 3));
});

test('a mixed order puts packing only on the lines that carry it', () => {
  const mix = [
    { id: 'F', vendor_id: 'bv', name: 'Pecker Heads', cost: 58.8, type: 'flash', price_per_ticket: 1, packing_units: 1 },
    { id: 'S', vendor_id: 'bv', name: 'Monopoly', cost: 64.6, type: 'strip', price_per_ticket: 1, packing_units: 0 },
    { id: 'C', vendor_id: 'bv', name: '10-Pack of strips', cost: 5120, type: 'strip', price_per_ticket: 1, packing_units: 80 },
  ];
  const [d] = buildDrafts({ F: 2, S: 4, C: 1 }, mix, vendorsFee);
  const by = Object.fromEntries(d.lines.map((l) => [l.product_id, l.packing_each]));
  assert.deepEqual(by, { F: 4, S: 0, C: 320 });
  assert.equal(d.subtotal, round2(2 * 62.8 + 4 * 64.6 + 5440));
});

test('packing never applies to a vendor that does not charge it', () => {
  const other = [{ id: 'X', vendor_id: 'md', name: 'Anything', cost: 100, type: 'flash', price_per_ticket: 1, packing_units: 1 }];
  const drafts = buildDrafts({ X: 5 }, other, vendorsFee);
  assert.ok(!drafts[0].lines.some((l) => l.kind === 'fee'), 'only Bingo Vision charges packing');
});

test('packing is in the subtotal and the total, but not in the tax', () => {
  const [d] = buildDrafts({ P1: 2 }, products, vendorsFee);          // 2 x 117.30 = 234.60 + 8 packing
  assert.equal(d.goods, 234.60);
  assert.equal(d.packing, 8);
  assert.equal(d.subtotal, 242.60);
  assert.equal(d.tax, round2(234.60 * 0.0975), 'the goods are taxed, the service is not');
  assert.notEqual(d.tax, round2(242.60 * 0.0975));
  assert.equal(d.total, round2(242.60 + round2(234.60 * 0.0975)));
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
  assert.deepEqual(c.P1, { inv: 2, open: 1, onorder: 1, sold: 0, missing: 0,
    off: 0, owned: 3, offBy: {} });
  assert.equal(c.P2.sold, 1);
});

// ---------- where stock is, as opposed to what state it is in ----------
//
// Two numbers, not one: what accounting owns and what operations can play. They
// only ever differ off-site, which is why one number worked until it didn't.

test('off-site stock is owned but never counted as floor stock', () => {
  const c = countByProduct([
    { product_id: 'P1', state: 'in_inventory' },
    { product_id: 'P1', state: 'in_inventory', location: 'vendor' },
    { product_id: 'P1', state: 'in_inventory', location: 'storage' },
    { product_id: 'P1', state: 'opened' },
  ]).P1;
  assert.equal(c.inv, 1, 'floor stock only');
  assert.equal(c.open, 1);
  assert.equal(c.off, 2, 'both off-site boxes');
  assert.equal(c.owned, 4, 'accounting sees all four');
  assert.deepEqual(c.offBy, { vendor: 1, storage: 1 });
});

test('a box with no location is on the floor', () => {
  // every row predates the column; none of them may silently become off-site
  const c = countByProduct([{ product_id: 'P1', state: 'in_inventory' }]).P1;
  assert.equal(c.inv, 1);
  assert.equal(c.off, 0);
});

test('a shortage covered by off-site stock is a shipment, not a purchase', () => {
  assert.deepEqual(coverShortage(4, 6), { ship: 4, buy: 0, short: 4, action: 'ship' });
  assert.deepEqual(coverShortage(4, 0), { ship: 0, buy: 4, short: 4, action: 'buy' });
  assert.deepEqual(coverShortage(4, 1), { ship: 1, buy: 3, short: 4, action: 'both' });
  assert.equal(coverShortage(0, 5).action, 'none');
  assert.match(shortageAdvice(4, 6, 'storage'), /Ship, don't buy/);
  assert.match(shortageAdvice(4, 0), /Buy 4/);
});

test('a session cannot play stock that is off-site', async () => {
  // the dangerous case: the only box we own is at the distributor. Playing it
  // would drain the off-site count and hide a real shortage on the floor.
  const store = shortStore();
  store.db.boxes = [{ id: 'v1', hall_id: 'sc', product_id: 'G1',
                      state: 'in_inventory', location: 'vendor' }];
  await assert.rejects(
    () => store.applySession('s1', [{ product_id: 'G1', qty: 1 }]),
    (e) => e.code === 'session_short');
  assert.equal(store.db.boxes[0].location, 'vendor', 'the off-site box was left alone');
  assert.equal(store.db.boxes[0].state, 'in_inventory');
});

test('moving stock changes where it is, not what it is', async () => {
  const store = shortStore();
  store.db.boxes = [
    { id: 'v1', hall_id: 'sc', product_id: 'G1', state: 'in_inventory', location: 'vendor', cost: 100 },
    { id: 'v2', hall_id: 'sc', product_id: 'G1', state: 'in_inventory', location: 'vendor', cost: 100 },
  ];
  const res = await store.moveBoxes({ hallId: 'sc', productId: 'G1', from: 'vendor', to: 'hall', qty: 1 });
  assert.equal(res.moved, 1);
  const moved = store.db.boxes.find((b) => b.location === 'hall');
  assert.equal(moved.state, 'in_inventory', 'still in stock — nothing was received again');
  assert.ok(moved.counted_at, 'arriving on the floor is a fresh sighting');
  assert.equal(store.db.boxes.filter((b) => b.location === 'vendor').length, 1);
});

test('you cannot ship more than is actually there', async () => {
  const store = shortStore();
  store.db.boxes = [{ id: 'v1', hall_id: 'sc', product_id: 'G1', state: 'in_inventory', location: 'storage' }];
  await assert.rejects(
    () => store.moveBoxes({ hallId: 'sc', productId: 'G1', from: 'storage', to: 'hall', qty: 3 }),
    /Only 1 box/);
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
  assert.match(e.body, /New Game\s+\?\s+\?/, 'base and line total both read ? on that line');
  assert.match(e.body, /\$100\.00/, 'the priced line still shows its price');
  assert.match(e.body, /Items below marked with a \? we don't have a current price\./);
  assert.match(e.body, /send over pricing, we will update and resend same PO/);
  assert.match(e.body, /covers the priced lines only/);
});

test('a fully priced PO email says nothing about missing prices', () => {
  const [d] = buildDrafts({ A: 2 }, TBD_PRODUCTS, TBD_VENDORS);
  const [e] = buildOrderEmails([{ ...d, num: 'SC-2026-08-BV-002' }], TBD_VENDORS, 'Santa Clara', '', '', { name: 'Sagit' });
  assert.ok(!/\s\?\s*$/m.test(e.body), 'no ? in the money columns on a fully priced order');
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

// ---- base cost x units per box, with packing separate ----
const BV = { id: 'bv', packing_fee: 4 };

test('a box costs the base price times the units inside it', () => {
  assert.equal(boxCost({ base_cost: 64.6, pack_units: 16 }), 1033.60, 'Monopoly: $64.60 x 16');
  assert.equal(boxCost({ base_cost: 64.6, pack_units: 8 }), 516.80, 'an ordinary strip: x8');
  assert.equal(boxCost({ base_cost: 64, pack_units: 80 }), 5120, 'a Biker case: $64 x 80');
  assert.equal(boxCost({ base_cost: 58.8, pack_units: 1 }), 58.80, 'a box of flash is one unit');
});

test('a product not yet split into parts still prices correctly', () => {
  assert.equal(baseCost({ cost: 117.3 }), 117.3, 'fall back to the box cost');
  assert.equal(packUnits({}), 1, 'never zero, or the maths collapses');
  assert.equal(packUnits({ pack_units: 0 }), 1);
  assert.equal(boxCost({ cost: 117.3 }), 117.3);
});

test('units in a box and units charged packing are different numbers', () => {
  const monopoly = { base_cost: 64.6, pack_units: 16, packing_units: 0 };
  assert.equal(packUnits(monopoly), 16, 'sixteen in the box');
  assert.equal(packingFor(monopoly, BV), 0, 'and none of them charged packing');

  const biker = { base_cost: 64, pack_units: 80, packing_units: 80 };
  assert.equal(packingFor(biker, BV), 320);

  const flash = { base_cost: 58.8, pack_units: 1, packing_units: 1 };
  assert.equal(packingFor(flash, BV), 4);
});

test('the four parts read back as a set', () => {
  const p = priceParts({ base_cost: 64, pack_units: 80, packing_units: 80 }, BV);
  assert.equal(p.base, 64);
  assert.equal(p.units, 80);
  assert.equal(p.box, 5120, 'base x deals is what the vendor invoices for the goods');
  assert.equal(p.packing, 320);
  assert.equal(p.allIn, 5440, 'goods plus packing is what gets paid');
  assert.equal(p.split, 1);
  assert.equal(p.perBox, 5120,
    'but stock value is goods only — packing is freight, not worth on a shelf');
  assert.equal(p.multiplied, true);
  assert.equal(p.splits, false);
  assert.deepEqual(p.unit, ['tote', 'totes'],
    'and it says what one counted thing is — 80 deals to a unit is the Biker case, '
    + 'which is counted in totes');
});

test('a vendor that charges no packing never adds any, whatever the units', () => {
  const p = priceParts({ base_cost: 100, pack_units: 8, packing_units: 8 }, { packing_fee: 0 });
  assert.equal(p.packing, 0);
  assert.equal(p.allIn, 800);
});

// ---- one ordered unit, several boxes on the shelf ----
test('a case that arrives as 16 totes values each tote at a sixteenth', () => {
  const biker = { base_cost: 64, pack_units: 80, packing_units: 80, split_boxes: 16 };
  const p = priceParts(biker, BV);
  assert.equal(p.box, 5120, 'the vendor invoices the case');
  assert.equal(p.packing, 320);
  assert.equal(p.allIn, 5440, 'landed cost of the case');
  assert.equal(p.split, 16);
  assert.equal(p.perBox, 320,
    'each tote is worth a sixteenth of the GOODS — the $320 packing bills on the PO '
    + 'but does not ride on the shelf, or an identical tote from a bigger delivery '
    + 'would be worth less');
});

test('almost everything is one box per ordered unit, so nothing changes', () => {
  const flash = { base_cost: 58.8, pack_units: 1, packing_units: 1 };
  const p = priceParts(flash, BV);
  assert.equal(p.split, 1);
  assert.equal(p.splits, false);
  assert.equal(p.perBox, p.box, 'buy a box, shelf a box');
  assert.equal(p.perBox, 58.8, 'at the goods price; its $4 packing stays on the PO');
  assert.equal(p.allIn, 62.8, 'which is still what the vendor charges');
});

test('ordering a splitting product creates one box per tote, not per case', () => {
  const V = [{ id: 'bv', name: 'Bingo Vision', tax_rate: 0.0975, packing_fee: 4 }];
  const P = [{ id: 'B', vendor_id: 'bv', name: '10-Pack of strips Biker', type: 'strip',
               base_cost: 64, pack_units: 80, packing_units: 80, split_boxes: 16,
               price_per_ticket: 1, cost: 5120 }];
  const [d] = buildDrafts({ B: 2 }, P, V);
  const line = d.lines.find((l) => l.kind !== 'fee');
  assert.equal(line.qty, 2, 'the PO orders 2 cases');
  assert.equal(line.cost, 5120, 'at the case price');
  assert.equal(line.split_boxes, 16);
  assert.equal(line.per_box_cost, 320);
  assert.equal(line.qty * line.split_boxes, 32, 'which will become 32 totes in inventory');
  assert.equal(round2(line.qty * line.split_boxes * line.per_box_cost), 10240,
    'and the shelf value equals the goods on the order, packing excluded');
});

// ---- packing on the line, and the stock/packing split ----
test('a PO line prints base, units, packing and its own total', () => {
  const V = [{ id: 'bv', name: 'Bingo Vision', email: 'a@x.test', contact_name: 'Scott', tax_rate: 0.0975, packing_fee: 4 }];
  const P = [
    { id: 'C', vendor_id: 'bv', name: '10-Pack of strips Biker', type: 'strip',
      base_cost: 64, pack_units: 80, packing_units: 80, cost: 5120, price_per_ticket: 1 },
    { id: 'F', vendor_id: 'bv', name: 'Pecker Heads', type: 'flash',
      base_cost: 58.8, pack_units: 1, packing_units: 1, cost: 58.8, price_per_ticket: 1 },
  ];
  const [d] = buildDrafts({ C: 1, F: 2 }, P, V);
  const [e] = buildOrderEmails([{ ...d, num: 'N1' }], V, 'Redwood City', '', '', { name: 'Shelly' });

  assert.match(e.body, /Unit\s+Item\s+Base\s+Deals\s+Packing\s+Line total/,
    'a header in the words both sides of an invoice use: a Unit is ordered, Deals are inside it');
  assert.match(e.body, /10-Pack of strips Biker\s+\$64\.00\s+x80\s+\$320\.00\s+\$5,440\.00/);
  assert.match(e.body, /Pecker Heads\s+\$58\.80\s+\$8\.00\s+\$125\.60/,
    'two boxes: packing is extended too, so 58.80x2 + 8.00 = 125.60 reads off the row');
  assert.ok(!/Packing — /.test(e.body), 'no lump-sum packing line any more');
});

test('the PO splits its subtotal into stock and packing', () => {
  const V = [{ id: 'bv', name: 'Bingo Vision', email: 'a@x.test', contact_name: 'Scott', tax_rate: 0.0975, packing_fee: 4 }];
  const P = [{ id: 'F', vendor_id: 'bv', name: 'Pecker Heads', type: 'flash',
               base_cost: 58.8, pack_units: 1, packing_units: 1, cost: 58.8, price_per_ticket: 1 }];
  const [d] = buildDrafts({ F: 10 }, P, V);
  const [e] = buildOrderEmails([{ ...d, num: 'N2' }], V, 'Redwood City', '', '', { name: 'Shelly' });
  assert.match(e.body, /Stock:\s+\$588\.00/);
  assert.match(e.body, /Packing:\s+\$40\.00/);
  assert.match(e.body, /Subtotal:\s+\$628\.00/);
  assert.equal(d.subtotal, 628, 'and the totals agree with the maths');
});

test('an order with no packing shows no stock/packing split', () => {
  const V = [{ id: 'md', name: 'Marathon', email: 'b@x.test', tax_rate: 0.0975, packing_fee: 0 }];
  const P = [{ id: 'X', vendor_id: 'md', name: 'Lucky Kat', type: 'flash',
               base_cost: 103, pack_units: 1, packing_units: 1, cost: 103, price_per_ticket: 1 }];
  const [d] = buildDrafts({ X: 4 }, P, V);
  const [e] = buildOrderEmails([{ ...d, num: 'N3' }], V, 'Santa Clara', '', '', { name: 'Sagit' });
  assert.ok(!/Stock:/.test(e.body), 'nothing to split when the vendor charges no packing');
  assert.match(e.body, /Subtotal:\s+\$412\.00/);
});

// ---- Postgres numerics arrive as strings ----
//
// These guard a bug that shipped: buildDrafts tested the cost with Number() but
// stored the raw string, so poTotals computed "58.80" + 4 = "58.804" and packing
// silently fell out of every subtotal, tax and total. The line total was right and
// the subtotal beneath it was wrong, in the same email, to the vendor.
test('a PO built from string-typed numerics still totals correctly', () => {
  const V = [{ id: 'bv', name: 'Bingo Vision', email: 'a@x.test', contact_name: 'S',
               tax_rate: '0.0975', packing_fee: '4.00' }];
  const P = [{ id: 'F', vendor_id: 'bv', name: 'Pecker Heads', type: 'flash',
               base_cost: '58.80', pack_units: 1, packing_units: 1, split_boxes: 1,
               cost: '58.80', price_per_ticket: '1.00' }];
  const [d] = buildDrafts({ F: 10 }, P, V);

  assert.equal(typeof d.lines[0].cost, 'number', 'the draft coerces on the way in');
  assert.equal(d.subtotal, 628, '10 x (58.80 goods + 4.00 packing)');
  assert.equal(d.tax, 57.33, '9.75% of the $588 of goods — the $40 of packing is untaxed');
  assert.equal(d.total, 685.33);
});

// ---- tax falls on the goods, not on the service ----
//
// Reproduced from the distributors' own invoices, which is the only authority
// that settles it. Both of these are Bingo Vision, August 2026.
test('Bingo Vision 1806006 reproduces line for line', () => {
  const V = [{ id: 'bv', name: 'Bingo Vision', email: 'a@x.test', contact_name: 'S',
               tax_rate: '0.0975', packing_fee: '4.00' }];
  // ten strip titles, 80 deals each at $64.60, collated at $2.00 a deal
  const P = Array.from({ length: 10 }, (_, i) => ({
    id: `T${i}`, vendor_id: 'bv', name: `Tote title ${i}`, type: 'strip',
    base_cost: '64.60', pack_units: 80, packing_units: 80, packing_rate: '2.00',
    split_boxes: 16, cost: '5168.00', price_per_ticket: '1.00',
  }));
  const [d] = buildDrafts(Object.fromEntries(P.map((p) => [p.id, 1])), P, V);

  assert.equal(d.goods, 51680, 'ten lines at $5,168');
  assert.equal(d.packing, 1600, 'STRIP COLLATION SERVICE, 800 deals at $2.00');
  assert.equal(d.subtotal, 53280);
  assert.equal(d.tax, 5038.80, 'as printed — 9.75% of the goods, not of the subtotal');
  assert.equal(d.total, 58318.80);
});

test('a strip tote is collated at $2 a deal, not packed at the flash $4', () => {
  const V = [{ id: 'bv', name: 'Bingo Vision', email: 'a@x.test', contact_name: 'S',
               tax_rate: '0.0975', packing_fee: '4.00' }];
  const P = [
    { id: 'T', vendor_id: 'bv', name: 'Biker tote', type: 'strip', base_cost: '64.60',
      pack_units: 80, packing_units: 80, packing_rate: '2.00', split_boxes: 16,
      cost: '5168.00', price_per_ticket: '1.00' },
    { id: 'F', vendor_id: 'bv', name: 'Some flash', type: 'flash', base_cost: '58.80',
      pack_units: 1, packing_units: 1, split_boxes: 1, cost: '58.80', price_per_ticket: '1.00' },
  ];
  const [d] = buildDrafts({ T: 1, F: 1 }, P, V);
  const by = Object.fromEntries(d.lines.map((l) => [l.product_id, l.packing_each]));
  assert.equal(by.T, 160, '80 deals x $2.00');
  assert.equal(by.F, 4, 'the flash box still takes the vendor rate');
});

test('Marathon 5812098 and 5812121 reproduce — games taxed, daubers not', () => {
  const V = [{ id: 'md', name: 'Marathon', email: 'a@x.test', contact_name: 'E',
               tax_rate: '0.0975', packing_fee: '0' }];
  const games = [
    { id: 'G1', vendor_id: 'md', name: 'Rags to Riches $2', type: 'flash', base_cost: '209.00',
      pack_units: 1, packing_units: 0, split_boxes: 1, cost: '209.00', price_per_ticket: '2.00' },
    { id: 'G2', vendor_id: 'md', name: 'Cats & Dogs', type: 'flash', base_cost: '280.00',
      pack_units: 1, packing_units: 0, split_boxes: 1, cost: '280.00', price_per_ticket: '2.00' },
    { id: 'G3', vendor_id: 'md', name: 'Lucky Bucks', type: 'flash', base_cost: '280.00',
      pack_units: 1, packing_units: 0, split_boxes: 1, cost: '280.00', price_per_ticket: '2.00' },
  ];
  // 2 x 209 + 209 + 209 + 280 + 280 = 1396.00, tax 136.11 as printed
  const [g] = buildDrafts({ G1: 4, G2: 1, G3: 1 }, games, V);
  assert.equal(g.goods, 1396, 'the printed net');
  assert.equal(g.tax, 136.11, 'the printed tax');
  assert.equal(g.total, 1532.11, 'the printed balance due');

  const daubers = [{ id: 'D', vendor_id: 'md', name: 'Sunsational 4oz', type: 'supply',
    base_cost: '19.50', pack_units: 1, packing_units: 0, split_boxes: 1,
    cost: '19.50', price_per_ticket: '1.00', taxable: false }];
  const [d] = buildDrafts({ D: 10 }, daubers, V);
  assert.equal(d.goods, 195);
  assert.equal(d.tax, 0, 'no tax line on 5812121');
  assert.equal(d.total, 195);
});

test('an exempt line does not drag the taxable ones out of tax', () => {
  const V = [{ id: 'md', name: 'Marathon', email: 'a@x.test', contact_name: 'E',
               tax_rate: '0.10', packing_fee: '0' }];
  const P = [
    { id: 'G', vendor_id: 'md', name: 'A game', type: 'flash', base_cost: '100',
      pack_units: 1, packing_units: 0, split_boxes: 1, cost: '100', price_per_ticket: '1' },
    { id: 'D', vendor_id: 'md', name: 'A dauber', type: 'supply', base_cost: '50',
      pack_units: 1, packing_units: 0, split_boxes: 1, cost: '50', price_per_ticket: '1',
      taxable: false },
  ];
  const [d] = buildDrafts({ G: 1, D: 1 }, P, V);
  assert.equal(d.goods, 150);
  assert.equal(d.taxable, 100);
  assert.equal(d.exempt, 50);
  assert.equal(d.tax, 10, 'ten percent of the game only');
  assert.equal(d.total, 160);
});

test('a packing rate of 0 is an answer, not a missing value', () => {
  const V = [{ id: 'bv', name: 'Bingo Vision', email: 'a@x.test', contact_name: 'S',
               tax_rate: '0.0975', packing_fee: '4.00' }];
  const free = { base_cost: 58.8, pack_units: 1, packing_units: 1, packing_rate: 0 };
  assert.equal(packingFor(free, V[0]), 0, 'pinned to free, not fallen through to $4');
  const unset = { base_cost: 58.8, pack_units: 1, packing_units: 1, packing_rate: null };
  assert.equal(packingFor(unset, V[0]), 4, 'null means use the distributor rate');
});

test('the printed subtotal equals the printed lines', () => {
  const V = [{ id: 'bv', name: 'Bingo Vision', email: 'a@x.test', contact_name: 'S',
               tax_rate: '0.0975', packing_fee: '4.00' }];
  const P = [
    { id: 'C', vendor_id: 'bv', name: 'Biker case', type: 'strip', base_cost: '64.60',
      pack_units: 80, packing_units: 80, split_boxes: 16, cost: '5168.00', price_per_ticket: '1.00' },
    { id: 'F', vendor_id: 'bv', name: 'Pecker Heads', type: 'flash', base_cost: '58.80',
      pack_units: 1, packing_units: 1, split_boxes: 1, cost: '58.80', price_per_ticket: '1.00' },
  ];
  const [d] = buildDrafts({ C: 1, F: 2 }, P, V);
  // what the rows say, added up by hand, must be what the footer says
  const printed = d.lines.reduce((a, l) => a + l.qty * (Number(l.cost) + Number(l.packing_each || 0)), 0);
  assert.equal(round2(printed), d.subtotal, 'no line may disagree with the subtotal beneath it');
  assert.equal(d.subtotal, 5613.6);
});

// ---------- the amount accounting is told to pay ----------
//
// These three pin the money in buildDeliveredEmail, because its result is written
// straight into payments.amount. Every one of them failed before the fix: the old
// code taxed the packing service, ignored products.taxable, and was handed a
// packing figure that had not been brought down to the box.

test('delivered email does not tax packing — it is a service, not goods', () => {
  // BV case: $51,680 of stock + $1,600 collation. The vendor's own invoice taxes
  // 51,680 -> 5,038.80, not 53,280 -> 5,194.80.
  const po = { num: 'SC-1', total: 58318.80 };
  const received = [{ qty: 10, name_snapshot: 'Biker', cost: 5168, packing_each: 160, taxable: true }];
  const e = buildDeliveredEmail(po, vendors[0], 'Santa Clara', 'INV-1', received, [], SENDER, 'Jamie');
  assert.equal(e.amount, 58318.80, 'tax base must exclude packing');
  assert.match(e.body, /Stock:\s+\$51,680\.00/);
  assert.match(e.body, /Packing:\s+\$1,600\.00/);
  assert.match(e.body, /Difference:\s+\$0\.00/, 'the bill must agree with the PO it came from');
});

test('delivered email honours products.taxable — daubers are exempt', () => {
  // Marathon 5812121: all daubers, $987.00 net, no tax line on the invoice at all.
  const po = { num: 'SC-2', total: 987 };
  const received = [{ qty: 10, name_snapshot: 'Daubers', cost: 98.70, packing_each: 0, taxable: false }];
  const e = buildDeliveredEmail(po, vendors[1], 'Santa Clara', 'INV-2', received, [], SENDER, 'Jamie');
  assert.equal(e.amount, 987, 'an exempt line must not be taxed');
  assert.match(e.body, /Of which exempt:\s+\$987\.00/);
});

test('delivered email taxes a mixed load correctly', () => {
  const po = { num: 'SC-3', total: 0 };
  const received = [
    { qty: 1, name_snapshot: 'Game', cost: 1000, packing_each: 100, taxable: true },
    { qty: 1, name_snapshot: 'Daubers', cost: 500, packing_each: 0, taxable: false },
  ];
  const e = buildDeliveredEmail(po, vendors[0], 'Santa Clara', 'INV-3', received, [], SENDER, '');
  // goods 1500, packing 100, subtotal 1600; taxable goods 1000 -> tax 97.50
  assert.equal(e.amount, 1697.50);
});

test('receivedLine brings EVERY per-unit figure down to the box', () => {
  // A case of 16 totes at $5,168 carrying $160 of collation is $323 + $10 a tote —
  // not $323 + $160. This calls the real function Receiving calls.
  const l = { product_id: 'P163', name_snapshot: 'Biker', qty: 1, cost: 5168, packing_each: 160, split_boxes: 16, taxable: true };
  const r = receivedLine(l, null, 16, 5168);
  assert.equal(r.cost, 323, 'cost per tote');
  assert.equal(r.packing_each, 10, 'packing per tote — NOT the case figure');
  assert.equal(r.qty, 16);
  assert.equal(r.price_tbd, false);
  // and the whole case bills exactly what one unsplit case bills
  const e = buildDeliveredEmail({ num: 'SC-4', total: 5831.88 }, vendors[0], 'Santa Clara', 'INV-4', [r], [], SENDER, '');
  assert.equal(e.amount, 5831.88);
  assert.match(e.body, /Difference:\s+\$0\.00/);
});

test('receivedLine falls back to the catalog split when the line has none', () => {
  const l = { product_id: 'P163', name_snapshot: 'Biker', qty: 1, cost: 5168, packing_each: 160 };
  const r = receivedLine(l, { split_boxes: 16 }, 16, 5168);
  assert.equal(r.cost, 323);
  assert.equal(r.packing_each, 10);
});

test('extraLine divides an off-PO price down and reads exemption off the product', () => {
  // product.cost is an ORDERED-UNIT price; qty is a box count. Billing one
  // against the other put a single off-PO Biker case on the invoice at $82,688.
  const biker = { id: 'P163', name: 'Biker', cost: 5168, base_cost: 64.6, pack_units: 80, split_boxes: 16, taxable: true };
  const x = extraLine(biker, 'Biker', 16, 5168);
  assert.equal(x.cost, 323, 'must be the per-tote price, not the case price');
  assert.equal(x.qty, 16);
  assert.equal(x.taxable, true);
  assert.equal(x.extra, true);
  const e = buildDeliveredEmail({ num: 'X', total: 0 }, vendors[0], 'SC', 'I', [x], [], SENDER, '');
  assert.equal(e.amount, 5671.88);

  const daub = { id: 'S830', name: 'Dabbin Fever', cost: 12, base_cost: 12, pack_units: 1, split_boxes: 1, taxable: false };
  const d = extraLine(daub, 'Dabbin Fever', 10, 12);
  assert.equal(d.cost, 12);
  assert.equal(d.taxable, false, 'an exempt supply stays exempt when it arrives off-PO');
  assert.equal(buildDeliveredEmail({ num: 'X', total: 0 }, vendors[1], 'SC', 'I', [d], [], SENDER, '').amount, 120);
});

test('missingLine is priced like what arrived, and only stays TBD with no price at all', () => {
  const l = { product_id: 'P163', name_snapshot: 'Biker', qty: 1, cost: 5168, packing_each: 160, split_boxes: 16, price_tbd: true };
  assert.equal(missingLine(l, null, 4, 5168).price_tbd, false, 'a price was supplied');
  assert.equal(missingLine(l, null, 4, 5168).cost, 323);
  assert.equal(missingLine(l, null, 4, 0).price_tbd, true, 'still nothing to quote');
});

test('perUnitOf never divides by zero and copes with junk', () => {
  assert.equal(perUnitOf(160, 16), 10);
  assert.equal(perUnitOf(160, 0), 160);
  assert.equal(perUnitOf(160, null), 160);
  assert.equal(perUnitOf(undefined, 16), 0);
  assert.equal(perUnitOf('160', '16'), 10);
});

test('a split line received in two deliveries bills the case exactly once', () => {
  const l = { product_id: 'P163', name_snapshot: 'Biker', qty: 1, cost: 5168, packing_each: 160, split_boxes: 16, taxable: true };
  const first = buildDeliveredEmail({ num: 'A', total: 0 }, vendors[0], 'SC', 'I', [receivedLine(l, null, 8, 5168)], [], SENDER, '');
  const second = buildDeliveredEmail({ num: 'A', total: 0 }, vendors[0], 'SC', 'I', [receivedLine(l, null, 8, 5168)], [], SENDER, '');
  assert.equal(round2(first.amount + second.amount), 5831.88);
});

test('shortage value counts goods plus packing, and no tax', () => {
  const missing = [{ qty: 2, name_snapshot: 'Biker', cost: 323, packing_each: 10 }];
  const e = buildShortageEmail({ num: 'SC-5' }, vendors[0], 'Santa Clara', missing, SENDER);
  assert.match(e.body, /Missing value:\s+\$666\.00/);
});

// ---------- variety packs on the order ----------

test('a variety pack carries its colours into the PO line at send time', () => {
  // Not looked up when something renders it — baked into name_snapshot, the same
  // way the name is, so the sent order is a record of what was actually asked for.
  const pack = { id: 'S831', vendor_id: 'md', name: 'Sunsational 4oz — colour pack ($3)',
    type: 'supply', base_cost: 19.50, cost: 214.50, pack_units: 11, split_boxes: 11,
    packing_units: 0, taxable: false };
  const md = { id: 'md', name: 'Marathon', email: 'm@x', tax_rate: 0.0975, packing_fee: 4 };
  const [d] = buildDrafts({ S831: 2 }, [pack], [md]);
  const snap = d.lines[0].name_snapshot;
  assert.match(snap, /^Sunsational 4oz — colour pack \(\$3\)\n/);
  assert.match(snap, /colours: Red, Green, Orange, Pink, Magenta, Sky Blue, Coral, Lilac, Violet, Yellow and Ruby Red$/);
  assert.equal(snapshotHead(snap), 'Sunsational 4oz — colour pack ($3)');
  assert.equal(snapshotRest(snap).length, 1);
  // exempt supply, no packing, 2 x $214.50
  assert.equal(d.total, 429);
});

test('an ordinary game gets no colour line', () => {
  const p = { id: 'M1', vendor_id: 'md', name: 'Lucky Sevens', type: 'flash', base_cost: 80,
    cost: 80, pack_units: 1, split_boxes: 1, packing_units: 1, tickets: 1200, price_per_ticket: 1 };
  const md = { id: 'md', name: 'Marathon', email: 'm@x', tax_rate: 0.0975, packing_fee: 4 };
  const [d] = buildDrafts({ M1: 5 }, [p], [md]);
  assert.equal(d.lines[0].name_snapshot, 'Lucky Sevens (1200/$1)');
  assert.equal(snapshotRest(d.lines[0].name_snapshot).length, 0);
});

test('the colour line prints under its row without widening the table', () => {
  const md = { id: 'md', name: 'Marathon', email: 'm@x', contact_name: 'Esteban', tax_rate: 0.0975 };
  const lines = [{ product_id: 'S831', qty: 2, cost: 214.50, base_cost: 19.50, pack_units: 11,
    packing_each: 0, taxable: false, kind: 'item',
    name_snapshot: 'Sunsational 4oz — colour pack ($3)\ncolours: Red, Green and Blue' }];
  const po = { num: 'X', hall_id: 'sc', vendor_id: 'md', lines, ...poTotals(lines, 0.0975), sent_at: '2026-08-12' };
  const [e] = buildOrderEmails([po], [md], 'Santa Clara', '1 Main St', SENDER);
  const rows = e.body.split('\n');
  const item = rows.find((r) => r.includes('Sunsational'));
  const colourRow = rows.find((r) => r.trim().startsWith('colours:'));
  assert.ok(item && colourRow, 'both the row and its colours are printed');
  assert.ok(rows.indexOf(colourRow) === rows.indexOf(item) + 1, 'colours sit directly under the row');
  // the Item column is sized on the name, not on the colour list
  const header = rows.find((r) => r.startsWith('Unit'));
  assert.ok(header.length < 100, `header should stay narrow, was ${header.length}`);
});

// ---------------------------------------------------------------- shortfalls
//
// The bug these guard: applySession used to invent a box whenever the sheet
// played more than the shelf held, consume it in the same statement, and carry
// on. The ledger balanced, so nothing ever looked wrong — 79 boxes at Santa
// Clara were written off that way before anyone counted.

test('a session that is short refuses, and writes nothing', async () => {
  const store = shortStore();
  await assert.rejects(
    () => store.applySession('s1', [{ product_id: 'G1', qty: 3 }]),
    (e) => e.code === 'session_short' && /needs 3/.test(e.message));
  // the crucial part: the shelf is untouched and the session is still open
  assert.equal(store.db.boxes.filter((b) => b.state === 'in_inventory').length, 2);
  assert.equal(store.db.boxes.filter((b) => b.unrecorded).length, 0);
  assert.equal(store.db.sessions[0].applied_at, null);
});

test('the refusal names every short game and the size of the gap', async () => {
  const store = shortStore();
  const e = await store.applySession('s1', [{ product_id: 'G1', qty: 3 }, { product_id: 'G2', qty: 2 }])
    .then(() => null, (err) => err);
  assert.ok(e, 'it rejected');
  assert.equal(e.short.length, 2);
  assert.deepEqual(e.short.map((s) => s.wanted - s.found).sort(), [2, 2]);
  assert.match(e.message, /Bingo Bandit/);
  assert.match(e.message, /Cash Cow/);
  assert.match(e.message, /none on the shelf/);
});

test('nothing is consumed when a LATER line is the short one', async () => {
  // the old loop applied game by game, so a shortfall on the last game left every
  // earlier game already taken off the shelf and the session still unapplied
  const store = shortStore();
  await assert.rejects(() => store.applySession('s1',
    [{ product_id: 'G3', qty: 1 }, { product_id: 'G1', qty: 3 }]));
  const g3 = store.db.boxes.find((b) => b.product_id === 'G3');
  assert.equal(g3.state, 'in_inventory', 'the satisfiable line was not consumed');
  assert.equal(g3.session_id, undefined);
});

test('allowShort records the write-off, and says so on the history', async () => {
  const store = shortStore();
  const res = await store.applySession('s1', [{ product_id: 'G1', qty: 3 }], { allowShort: true });
  assert.equal(res.moved, 1);
  assert.equal(res.invented, 2);
  const ghosts = store.db.boxes.filter((b) => b.unrecorded);
  assert.equal(ghosts.length, 2);
  assert.ok(ghosts.every((b) => b.state === 'sold_out' && b.session_id === 's1'));
  assert.ok(store.db.events.some((e) => e.kind === 'session.short'),
    'a write-off gets its own history line, not a subclause of the apply');
});

test('a session that fits applies with no shortfall event', async () => {
  const store = shortStore();
  const res = await store.applySession('s1', [{ product_id: 'G1', qty: 1 }]);
  assert.equal(res.moved, 1);
  assert.equal(res.invented, 0);
  assert.equal(store.db.boxes.filter((b) => b.unrecorded).length, 0);
  assert.ok(!store.db.events.some((e) => e.kind === 'session.short'));
});

test('a write-off is valued per box, not per ordered unit', () => {
  // $512 a case, 8 boxes to the case -> $64 a box. Billing the case against a box
  // count is the same error that turned a $5,671 receipt into $90,750.
  assert.equal(writeOffCost({ base_cost: 512, pack_units: 1, split_boxes: 8 }), 64);
  assert.equal(writeOffCost({ base_cost: 19.5, pack_units: 11, split_boxes: 11 }), 19.5);
  assert.equal(writeOffCost(undefined), 0);
});

// The regression that prompted the split: fifteen Monster Score sitting at
// Marathon made a raw in_inventory count read nineteen when four were playable,
// and anyone reading nineteen decides not to order.

test('the operational number never includes stock held elsewhere', () => {
  const boxes = [
    ...Array.from({ length: 4 }, (_, i) => ({ id: 'f' + i, product_id: 'N904', state: 'in_inventory' })),
    ...Array.from({ length: 15 }, (_, i) => ({ id: 'v' + i, product_id: 'N904', state: 'in_inventory', location: 'vendor' })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: 'o' + i, product_id: 'N904', state: 'on_order' })),
  ];
  const c = countByProduct(boxes).N904;
  assert.equal(c.inv, 4, 'available is four, not nineteen');
  assert.equal(c.off, 15);
  assert.equal(c.owned, 19, 'accounting still sees all nineteen');
  assert.equal(c.onorder, 4, 'on order is a commitment, counted apart from both');
  // and the two must never be the same number
  assert.notEqual(c.inv, c.owned);
});

test('onFloor filters a list down to floor stock', () => {
  const boxes = [
    { id: 'a', state: 'in_inventory' },
    { id: 'b', state: 'in_inventory', location: 'hall' },
    { id: 'c', state: 'in_inventory', location: 'vendor' },
    { id: 'd', state: 'opened', location: 'storage' },
  ];
  assert.deepEqual(onFloor(boxes).map((b) => b.id), ['a', 'b']);
  assert.deepEqual(playable(boxes).map((b) => b.id), ['a', 'b']);
});

// ---------- regressions from the adversarial review of the location change ----------

test('an adjustment writes off floor boxes, never off-site ones', async () => {
  // Reported bug: Adjust.jsx validated against floor stock but the store selected
  // its pool with no location filter, so writing off four boxes lost on the floor
  // marked four of the distributor's boxes missing instead. The floor count never
  // moved, so the operator would repeat it until off-site drained to nothing.
  const store = shortStore();
  store.db.boxes = [
    ...Array.from({ length: 2 }, (_, i) => ({ id: 'f' + i, hall_id: 'sc', product_id: 'G1', state: 'in_inventory' })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: 'v' + i, hall_id: 'sc', product_id: 'G1',
      state: 'in_inventory', location: 'vendor' })),
  ];
  await store.adjustStock({ hallId: 'sc', product: store.db.products[0], delta: -2, note: 'lost on the floor' });
  const missing = store.db.boxes.filter((b) => b.state === 'missing');
  assert.equal(missing.length, 2);
  assert.ok(missing.every((b) => (b.location || 'hall') === 'hall'),
    `wrote off ${missing.map((b) => b.id)} — off-site boxes must never be touched`);
  assert.equal(store.db.boxes.filter((b) => b.location === 'vendor').length, 5);
});

test('shipping moves the boxes from the row you clicked, not another distributor', async () => {
  // Reported bug: getOffsite groups by product AND location_ref, but moveBoxes
  // matched on product+location only, so "ship the Marathon row" could bring in
  // Trade Products' stock and mark the wrong distributor as delivered.
  const store = shortStore();
  store.db.boxes = [
    { id: 'm1', hall_id: 'sc', product_id: 'G1', state: 'in_inventory', location: 'vendor', location_ref: 'Marathon' },
    { id: 't1', hall_id: 'sc', product_id: 'G1', state: 'in_inventory', location: 'vendor', location_ref: 'Trade Products' },
  ];
  await store.moveBoxes({ hallId: 'sc', productId: 'G1', from: 'vendor', to: 'hall', qty: 1,
    fromRef: 'Marathon', ids: ['m1'] });
  assert.equal(store.db.boxes.find((b) => b.id === 'm1').location, 'hall');
  assert.equal(store.db.boxes.find((b) => b.id === 't1').location, 'vendor');
});

test('a move stamps a sighting whichever way it goes', async () => {
  const store = shortStore();
  store.db.boxes = [{ id: 'f1', hall_id: 'sc', product_id: 'G1', state: 'in_inventory' }];
  await store.moveBoxes({ hallId: 'sc', productId: 'G1', from: 'hall', to: 'storage', qty: 1, ref: 'Unit 14' });
  const b = store.db.boxes[0];
  assert.equal(b.location, 'storage');
  assert.equal(b.location_ref, 'Unit 14');
  // someone just physically handled it; landing straight in the "never confirmed"
  // banner would train people to ignore the banner
  assert.ok(b.counted_at, 'moving stock out is still a sighting');
});

test('moving stock refuses an unknown destination', async () => {
  const store = shortStore();
  store.db.boxes = [{ id: 'f1', hall_id: 'sc', product_id: 'G1', state: 'in_inventory' }];
  await assert.rejects(
    () => store.moveBoxes({ hallId: 'sc', productId: 'G1', from: 'hall', to: 'garage', qty: 1 }),
    /Unknown location/);
});

test('moving stock leaves boxes racked for a session alone', async () => {
  const store = shortStore();
  store.db.boxes = [
    { id: 'tagged', hall_id: 'sc', product_id: 'G1', state: 'in_inventory', session_tag: 'Fri PM' },
    { id: 'free', hall_id: 'sc', product_id: 'G1', state: 'in_inventory' },
  ];
  await store.moveBoxes({ hallId: 'sc', productId: 'G1', from: 'hall', to: 'storage', qty: 1 });
  assert.equal(store.db.boxes.find((b) => b.id === 'tagged').location, undefined,
    'a box set aside for a session must not be shipped out from under Assign');
  assert.equal(store.db.boxes.find((b) => b.id === 'free').location, 'storage');
});

test('the scanner will not open a box that is recorded off-site', () => {
  // Reported bug: OpenBoxes guarded its manual serial field but the scanner —
  // the primary input — went through resolveScan, which never looked at location.
  // Scanning twice would walk a vendor box to sold_out and out of owned stock.
  const off = [{ id: 'v', serial: 'X1', state: 'in_inventory', location: 'vendor', location_ref: 'Marathon' }];
  const r = resolveScan('X1', { mode: 'open', boxes: off });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'offsite');
  assert.match(r.message, /Marathon/);
  // sold-out mode too
  const opened = [{ id: 'v', serial: 'X2', state: 'opened', location: 'storage' }];
  assert.equal(resolveScan('X2', { mode: 'soldout', boxes: opened }).reason, 'offsite');
  // but a floor box still works, and receiving is exempt — receiving is what puts
  // a box somewhere in the first place
  assert.equal(resolveScan('X3', { mode: 'open', boxes: [{ serial: 'X3', state: 'in_inventory' }] }).ok, true);
});

test('same-day confirmation reads as today, not yesterday', () => {
  const today = new Date(2026, 7, 18, 14, 30);
  assert.equal(daysSinceConfirmed({ counted_at: '2026-08-18' }, today), 0);
  assert.equal(daysSinceConfirmed({ counted_at: '2026-08-11' }, today), 7);
  assert.equal(daysSinceConfirmed({ counted_at: null }, today), null);
});

test('an adjustment refuses rather than quietly taking off fewer than asked', async () => {
  // It used to write off whatever the floor had and still log the full delta, so
  // the history claimed five boxes were written off when two were. addAdjustment
  // already refused; the two entry points must not disagree.
  const store = shortStore();
  store.db.boxes = [
    { id: 'f0', hall_id: 'sc', product_id: 'G1', state: 'in_inventory' },
    ...Array.from({ length: 5 }, (_, i) => ({ id: 'v' + i, hall_id: 'sc', product_id: 'G1',
      state: 'in_inventory', location: 'vendor' })),
  ];
  await assert.rejects(
    () => store.adjustStock({ hallId: 'sc', product: store.db.products[0], delta: -5, note: 'x' }),
    /Only 1 on the floor/);
  assert.equal(store.db.boxes.filter((b) => b.state === 'missing').length, 0, 'nothing written');
  assert.equal(store.db.boxes.filter((b) => b.location === 'vendor').length, 5);
});

test('sending stock off-site takes a sealed box, not a part-sold one', async () => {
  // the picker counts sealed stock, so the move has to take sealed stock —
  // otherwise the half-sold box silently leaves the floor and Open Boxes
  const store = shortStore();
  store.db.boxes = [
    { id: 'opened', hall_id: 'sc', product_id: 'G1', state: 'opened', received_at: '2026-01-01' },
    { id: 'sealed', hall_id: 'sc', product_id: 'G1', state: 'in_inventory', received_at: '2026-08-01' },
  ];
  await store.moveBoxes({ hallId: 'sc', productId: 'G1', from: 'hall', to: 'storage', qty: 1,
    states: ['in_inventory'] });
  assert.equal(store.db.boxes.find((b) => b.id === 'sealed').location, 'storage');
  assert.equal(store.db.boxes.find((b) => b.id === 'opened').location, undefined);
});

test('a box someone else already moved does not change which boxes ship', async () => {
  // the ids path used to slice the caller's list before filtering, so one stale
  // id shifted the selection — and the two stores disagreed about the result
  const store = shortStore();
  store.db.boxes = [
    { id: 'v1', hall_id: 'sc', product_id: 'G1', state: 'in_inventory', location: 'hall' },
    { id: 'v2', hall_id: 'sc', product_id: 'G1', state: 'in_inventory', location: 'vendor' },
    { id: 'v3', hall_id: 'sc', product_id: 'G1', state: 'in_inventory', location: 'vendor' },
  ];
  const r = await store.moveBoxes({ hallId: 'sc', productId: 'G1', from: 'vendor', to: 'hall',
    qty: 2, ids: ['v1', 'v2', 'v3'] });
  assert.deepEqual(r.ids, ['v2', 'v3']);
});

test('a failed multi-line adjustment leaves nothing behind', async () => {
  const store = shortStore();
  store.db.products.push({ id: 'G9', name: 'Ghost Game', base_cost: 50, pack_units: 1, split_boxes: 1 });
  store.db.boxes = [{ id: 'a1', hall_id: 'sc', product_id: 'G1', state: 'in_inventory' }];
  await assert.rejects(() => store.addAdjustment({
    hallId: 'sc', reason: 'damaged', note: 'two lines, second impossible',
    lines: [{ product_id: 'G1', delta: -1 }, { product_id: 'G9', delta: -1 }],
  }));
  assert.equal(store.db.boxes[0].state, 'in_inventory', 'the first line was rolled back');
  assert.equal((store.db.stock_adjustments || []).length, 0, 'no orphan header');
  assert.equal((store.db.stock_adjustment_lines || []).length, 0, 'no orphan lines');
});
