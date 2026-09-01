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
  for (const l of lines) {
    const split = splitOf(l);
    const orderedBoxes = num(l.qty) * split;
    const perBox = round2(num(l.cost) / split);
    const packPerBox = round2(num(l.packing_each) / split);

    const pool = byProduct[l.product_id || ''] || [];
    // A charge line has no stock behind it, so nothing can be missing from it.
    const isCharge = !l.product_id || l.kind === 'fee';
    const arrived = isCharge ? orderedBoxes
      : Math.min(orderedBoxes, pool.filter((b) => ARRIVED.has(b.state)).length);
    const missing = Math.max(0, orderedBoxes - arrived);

    out.push({
      id: l.id,
      name: l.name_snapshot || l.product_id || '(unnamed)',
      tbd: !!l.price_tbd,
      taxable: l.taxable !== false,
      isCharge,
      split,
      orderedUnits: num(l.qty),
      orderedBoxes,
      arrivedBoxes: arrived,
      missingBoxes: missing,
      perBox,
      orderedValue: round2(orderedBoxes * perBox),
      arrivedValue: round2(arrived * perBox),
      missingValue: round2(missing * perBox),
      orderedPacking: round2(orderedBoxes * packPerBox),
      arrivedPacking: round2(arrived * packPerBox),
      missingPacking: round2(missing * packPerBox),
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

  const inv = invoiced == null ? null : num(invoiced);
  return {
    lines: out,
    ordered,
    arrived,                                   // what is actually owed
    missing,                                   // what the distributor still holds
    tbdLines: out.filter((l) => l.tbd).length,
    shortLines: out.filter((l) => l.missingBoxes > 0).length,
    complete: out.every((l) => l.missingBoxes === 0),
    invoiced: inv,
    // positive => billed for more than turned up
    overbilled: inv == null ? null : round2(inv - arrived.total),
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
