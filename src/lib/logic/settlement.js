// What a delivered order actually costs, line by line, once you count what turned up.
//
// A purchase order says what was asked for. A payment says what the distributor
// billed. Neither says what ARRIVED, and when a case is short those three numbers
// are not the same — which is the whole question Accounting has to answer before
// anyone pays: how much of this invoice do we actually owe, and how much is the
// distributor still holding?
//
// Two unit systems meet here, and mixing them is the standing bug in this codebase:
//
//   a PO LINE is written in ORDERED UNITS   — a case, a set, a box
//   a BOX row is one INVENTORY UNIT          — a tote, a lettered pack, a box
//   one ordered unit becomes `split_boxes` inventory units
//
// Boxes are the only record of what physically arrived, so everything here is
// counted in boxes and priced per box. A Biker case is one PO line of qty 1 at
// $10,336 and sixteen box rows at $646 — comparing the 1 to the 16 is how you talk
// a hall out of an order it has to place.
//
// Packing follows the goods. If half a case never arrived, half its collation is
// not owed either; that matches how receiving.js already prices a short delivery,
// and a vendor who disagrees will say so on the credit note.
//
// Tax is charged on taxable goods only, at the rate that applied to that order.

import { round2 } from './pricing.js';

const num = (v) => Number(v) || 0;                 // Postgres numerics arrive as strings
const splitOf = (line) => Math.max(1, parseInt(line?.split_boxes) || 1);

/** A box that is neither still on order nor written off as missing has arrived. */
const ARRIVED = new Set(['in_inventory', 'opened', 'sold_out']);

/**
 * Settle one order against what physically came in.
 *
 * `boxes` is every box row for this PO — the caller filters by po_id. A line with
 * no product_id (a delivery fee, a collation charge) has no boxes to count and is
 * treated as fully received, because a charge is not a thing that can be short.
 */
export function settleOrder({ lines = [], boxes = [], taxRate = 0, invoiced = null } = {}) {
  const byProduct = {};
  for (const b of boxes) {
    const k = b.product_id || '';
    (byProduct[k] ||= []).push(b);
  }

  const out = [];
  const seen = new Set();
  for (const l of lines) {
    const split = splitOf(l);
    const orderedBoxes = num(l.qty) * split;
    const perBox = round2(num(l.cost) / split);
    const packPerBox = round2(num(l.packing_each) / split);

    const pool = byProduct[l.product_id || ''] || [];
    if (l.product_id) seen.add(l.product_id);
    // A charge line has no stock behind it, so nothing can be short or spare.
    const isCharge = !l.product_id || l.kind === 'fee';
    const here = isCharge ? orderedBoxes : pool.filter((b) => ARRIVED.has(b.state)).length;

    // A delivery can be wrong in either direction. Short is stock we paid for and
    // did not get; extra is stock they sent that we are keeping and have not been
    // billed for. Capping at the ordered quantity — which this did at first —
    // makes the second kind invisible and quietly understates what we owe.
    const arrived = Math.min(here, orderedBoxes);
    const extra = Math.max(0, here - orderedBoxes);
    const missing = Math.max(0, orderedBoxes - here);

    out.push({
      id: l.id,
      name: l.name_snapshot || l.product_id || '(unnamed)',
      productId: l.product_id || null,
      tbd: !!l.price_tbd,
      taxable: l.taxable !== false,
      isCharge,
      offOrder: false,
      split,
      orderedUnits: num(l.qty),
      orderedBoxes,
      arrivedBoxes: arrived,
      missingBoxes: missing,
      extraBoxes: extra,
      perBox,
      orderedValue: round2(orderedBoxes * perBox),
      arrivedValue: round2(arrived * perBox),
      missingValue: round2(missing * perBox),
      extraValue: round2(extra * perBox),
      orderedPacking: round2(orderedBoxes * packPerBox),
      arrivedPacking: round2(arrived * packPerBox),
      missingPacking: round2(missing * packPerBox),
      extraPacking: 0,          // packing is charged on the order, not on a freebie
    });
  }

  // Stock that arrived against this order for a product with no line at all — the
  // distributor substituted or added something. It is ours, it has a cost, and
  // nobody has invoiced it. Valued from the box, because there is no line to read.
  for (const [pid, pool] of Object.entries(byProduct)) {
    if (!pid || seen.has(pid)) continue;
    const held = pool.filter((b) => ARRIVED.has(b.state));
    if (!held.length) continue;
    const value = round2(held.reduce((a, b) => a + num(b.cost), 0));
    out.push({
      id: `off:${pid}`,
      name: held[0].product_name || pid,
      productId: pid,
      tbd: false,
      taxable: held[0].taxable !== false,
      isCharge: false,
      offOrder: true,
      split: 1,
      orderedUnits: 0, orderedBoxes: 0, arrivedBoxes: 0, missingBoxes: 0,
      extraBoxes: held.length,
      perBox: round2(value / held.length),
      orderedValue: 0, arrivedValue: 0, missingValue: 0, extraValue: value,
      orderedPacking: 0, arrivedPacking: 0, missingPacking: 0, extraPacking: 0,
    });
  }

  // A line with no price yet cannot be added up. It is counted separately and
  // reported, rather than being silently treated as zero — an invoice that looks
  // fully covered when one line is still "?" is how a hall underpays.
  const priced = out.filter((l) => !l.tbd);
  const bucket = (goodsKey, packKey) => {
    const goods = round2(priced.reduce((a, l) => a + l[goodsKey], 0));
    const packing = round2(priced.reduce((a, l) => a + l[packKey], 0));
    const taxable = round2(priced.filter((l) => l.taxable).reduce((a, l) => a + l[goodsKey], 0));
    const tax = round2(taxable * num(taxRate));
    return { goods, packing, taxable, tax, total: round2(goods + packing + tax) };
  };

  const ordered = bucket('orderedValue', 'orderedPacking');
  const arrived = bucket('arrivedValue', 'arrivedPacking');
  const missing = bucket('missingValue', 'missingPacking');
  const extra   = bucket('extraValue',   'extraPacking');

  // What we actually owe: everything that is on the shelf, whether it was on the
  // order or turned up beside it.
  const owed = {
    goods: round2(arrived.goods + extra.goods),
    packing: round2(arrived.packing + extra.packing),
    taxable: round2(arrived.taxable + extra.taxable),
    tax: round2(arrived.tax + extra.tax),
    total: round2(arrived.total + extra.total),
  };

  const inv = invoiced == null ? null : num(invoiced);
  return {
    lines: out,
    ordered,
    arrived,
    extra,                                     // kept, and not yet billed for
    missing,                                   // billed for, never turned up
    owed,                                      // what should actually be paid
    // one signed number: negative means they still owe us stock, positive means
    // we are holding stock we have not paid for
    net: round2(extra.total - missing.total),
    tbdLines: out.filter((l) => l.tbd).length,
    shortLines: out.filter((l) => l.missingBoxes > 0).length,
    extraLines: out.filter((l) => l.extraBoxes > 0).length,
    complete: out.every((l) => l.missingBoxes === 0 && l.extraBoxes === 0),
    invoiced: inv,
    // positive => billed for more than is on our shelf
    overbilled: inv == null ? null : round2(inv - owed.total),
  };
}

/**
 * settleOrder, wired to the shapes the Accounting screen actually holds.
 *
 * This exists as its own function because the wiring is where the mistakes live,
 * not the arithmetic: matching a payment to its order by `po_num`, filtering boxes
 * down to that one order, and reading the tax rate off the right distributor. Get
 * any of those wrong and every figure on screen is confidently incorrect, so it is
 * tested rather than buried in a component.
 *
 * Returns null when there is nothing to settle — no order behind the payment (a
 * payment can be recorded on its own), or its lines not fetched yet. The caller
 * distinguishes those two cases for the message it shows.
 */
export function settlementForPayment({ payment, pos = [], linesByPo = {}, boxes = [], vendors = [] } = {}) {
  if (!payment) return null;
  const po = pos.find((x) => x.num === payment.po_num);
  if (!po) return null;
  const lines = linesByPo[po.id];
  if (!lines) return null;
  const vendor = vendors.find((v) => v.id === (po.vendor_id || payment.vendor_id));
  return settleOrder({
    lines,
    // boxes for THIS order only — the hall's whole box list is in context, and a
    // product can sit on several orders at once
    boxes: boxes.filter((b) => b.po_id === po.id),
    taxRate: Number(vendor?.tax_rate) || 0,
    invoiced: payment.amount,
  });
}

/** The month a payment belongs to, as "2026-09". Empty when it has no date. */
export const monthOf = (payment) => String(payment?.created_at || '').slice(0, 7);

/** Every month that has payments, newest first — the choices for the summary. */
export function monthsPresent(payments = []) {
  return [...new Set(payments.map(monthOf).filter((m) => m.length === 7))]
    .sort((a, b) => b.localeCompare(a));
}

/** "2026-09" -> "September 2026". */
export function monthLabel(m) {
  if (!/^\d{4}-\d{2}$/.test(String(m || ''))) return 'All months';
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
}

/**
 * What each distributor is owed, and what they still owe us, for one month.
 *
 * Two different questions sit in this one table and they must not be added
 * together. "Due to pay" is money leaving the hall — only OPEN payments, because
 * an invoice already settled is not due. "Short" is stock we were billed for and
 * did not get, netted against anything extra we kept, and it is a claim against
 * the distributor rather than a reduction of the cheque: the invoice still says
 * what it says until they issue a credit.
 *
 * `settlementOf(payment)` returns that payment's settlement, or null when its
 * order has not been loaded — those rows count toward money but contribute
 * nothing to short, and `unsettled` reports how many, so a total is never quietly
 * built on a partial read.
 */
export function monthlyByVendor(payments = [], settlementOf = () => null, month = '') {
  const rows = {};
  let unsettled = 0;
  for (const p of payments) {
    if (month && monthOf(p) !== month) continue;
    const v = (rows[p.vendor_id] ||= {
      vendorId: p.vendor_id, orders: 0, due: 0, paid: 0, short: 0, extra: 0, unsettled: 0,
    });
    v.orders += 1;
    const amt = num(p.amount);
    if (p.status === 'paid') v.paid = round2(v.paid + amt);
    else v.due = round2(v.due + amt);

    const s = settlementOf(p);
    if (!s) { v.unsettled += 1; unsettled += 1; continue; }
    v.short = round2(v.short + s.missing.total);
    v.extra = round2(v.extra + s.extra.total);
  }
  const list = Object.values(rows)
    .map((v) => ({ ...v, net: round2(v.short - v.extra) }))
    .sort((a, b) => b.due - a.due || String(a.vendorId).localeCompare(String(b.vendorId)));
  const total = list.reduce((a, v) => ({
    orders: a.orders + v.orders,
    due: round2(a.due + v.due),
    paid: round2(a.paid + v.paid),
    short: round2(a.short + v.short),
    extra: round2(a.extra + v.extra),
    net: round2(a.net + v.net),
  }), { orders: 0, due: 0, paid: 0, short: 0, extra: 0, net: 0 });
  return { rows: list, total, unsettled };
}
