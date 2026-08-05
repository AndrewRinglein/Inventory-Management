import { test } from 'node:test';
import assert from 'node:assert/strict';

import { poTotals, nextPoNum, buildDrafts, lineName, round2, packingLine } from '../src/lib/logic/po.js';
import { canTransition, transition, countByProduct } from '../src/lib/logic/boxes.js';
import { resolveScan } from '../src/lib/logic/scan.js';
import { buildOrderEmails, buildDeliveredEmail, buildShortageEmail, senderFor } from '../src/lib/logic/emails.js';

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
  { id: 'P1', vendor_id: 'bv', name: 'Big Fish', cost: 117.3, tickets: 1995, price_per_ticket: 1, type: 'flash' },
  { id: 'P2', vendor_id: 'bv', name: 'Casino City', cost: 230.5, tickets: 1960, price_per_ticket: 2, type: 'flash' },
  { id: 'P3', vendor_id: 'md', name: 'Moolah', cost: 120, tickets: 2400, price_per_ticket: 1, type: 'flash' },
  { id: 'P4', vendor_id: 'md', name: 'Fat Kitty', cost: 89.1, tickets: null, price_per_ticket: 1, type: 'flash' },
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

test('Bingo Vision flash order adds $4/box packing as a fee line', () => {
  const [d] = buildDrafts({ P1: 2, P2: 3 }, products, vendorsFee);   // both bv flash
  const fee = d.lines.find((l) => l.kind === 'fee');
  assert.ok(fee, 'packing line missing');
  assert.equal(fee.qty, 5, 'one packing charge per box of flash');
  assert.equal(fee.cost, 4);
  assert.equal(fee.product_id, null, 'fee lines are not products');
  assert.match(fee.name_snapshot, /Packing/);
});

test('packing is included in subtotal, tax and total', () => {
  const [d] = buildDrafts({ P1: 2 }, products, vendorsFee);          // 2 x 117.30 = 234.60 + 8 packing
  assert.equal(d.subtotal, 242.60);
  assert.equal(d.total, round2(242.60 * 1.0975));
});

test('other vendors get no packing charge', () => {
  const drafts = buildDrafts({ P3: 4 }, products, vendorsFee);       // Marathon flash
  assert.ok(!drafts[0].lines.some((l) => l.kind === 'fee'));
});

test('no packing when nothing of the charged type is ordered', () => {
  const nonFlash = [{ id: 'S1', vendor_id: 'bv', name: 'Strip Pack', cost: 60, tickets: null, price_per_ticket: 1, type: 'strip' }];
  const drafts = buildDrafts({ S1: 3 }, nonFlash, vendorsFee);
  assert.ok(!drafts[0].lines.some((l) => l.kind === 'fee'), 'strips should not be charged packing');
});

test('packing counts only the charged types in a mixed order', () => {
  const mixed = [
    { id: 'F1', vendor_id: 'bv', name: 'Flash A', cost: 100, type: 'flash', price_per_ticket: 1 },
    { id: 'S1', vendor_id: 'bv', name: 'Strip A', cost: 50, type: 'strip', price_per_ticket: 1 },
  ];
  const [d] = buildDrafts({ F1: 3, S1: 5 }, mixed, vendorsFee);
  assert.equal(d.lines.find((l) => l.kind === 'fee').qty, 3, 'only flash boxes counted');
});

test('packingLine returns null for a vendor with no fee configured', () => {
  assert.equal(packingLine({ packing_fee: 0 }, [{ qty: 2, _type: 'flash' }]), null);
  assert.equal(packingLine({}, [{ qty: 2, _type: 'flash' }]), null);
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
