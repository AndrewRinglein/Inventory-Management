// Purchase-order math and numbering. Pure functions — unit tested in tests/logic.test.js.

import { perBoxValue, baseCost, packUnits, packingFor } from './pricing.js';

// Coerces first. A Postgres numeric arrives as a string, and "58.80" + 4 is
// "58.804" — arithmetic that looks like arithmetic and silently is not.
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Postgres numeric columns arrive over the wire as STRINGS ("64.60"), so every
// money helper coerces first. A string has its own toLocaleString that quietly
// ignores the options, which would drop thousands separators and cents.
export const fmtMoney = (n) =>
  '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** $ per ticket as a number — same string-from-the-API trap as above. */
export const ticketPrice = (p) => Number(p?.price_per_ticket) || 1;

/**
 * Add up a money column. Every numeric in this app can arrive from Postgres as a
 * string, and `a + b` on a string is concatenation, not addition — a bug that
 * produces a plausible-looking number rather than an error. Use this instead of
 * a bare reduce anywhere money is summed.
 */
export const sumMoney = (rows, pick = (r) => r) =>
  round2(rows.reduce((a, r) => a + (Number(pick(r)) || 0), 0));

/** Display name for a PO line: cleaned name + (tickets/$price) so vendors see the full spec. */
export function lineName(product) {
  if (!product.tickets) return product.name;
  return `${product.name} (${product.tickets}/$${product.price_per_ticket || 1})`;
}

/**
 * Totals for one vendor's lines.
 * lines: [{qty, cost, packing_each, price_tbd}]
 *   → { goods, packing, subtotal, taxable, tax, total, tbd, partial }.
 *
 * TAX FALLS ON THE GOODS ONLY. Packing and strip collation are a service, and
 * California does not tax them here — the distributors' own invoices are the
 * proof. Bingo Vision 1806006: ten strip lines at $5,168 = $51,680 of goods plus
 * $1,600 of collation makes a $53,280 subtotal, and the tax charged is $5,038.80,
 * which is 9.75% of $51,680 and not of $53,280. Same on 1806034, where backing
 * $3,229.16 out at 9.75% leaves exactly $672.00 of the $33,791.60 untaxed.
 * Taxing the whole subtotal overstated every Bingo Vision order.
 *
 * A line whose price we don't have yet contributes nothing to the money. That
 * makes the printed total a floor, not the bill — `partial` says so, and every
 * caller that shows a total is expected to say so too. Quietly counting an
 * unpriced line as $0 would understate the order and, later, the amount to pay.
 */
export function poTotals(lines, taxRate) {
  const priced = lines.filter((l) => !l.price_tbd);
  const goods = sumMoney(priced, (l) => l.qty * (Number(l.cost) || 0));
  // packing rides on the line that earned it, so it still shows in that line's money
  const packing = sumMoney(priced, (l) => l.qty * (Number(l.packing_each) || 0));
  const subtotal = round2(goods + packing);
  // ...and some GOODS are exempt too. Marathon billed us twice on 08/07/2026:
  // 5812098, all games, $1,396.00 net and $136.11 tax — 9.75% exactly. 5812121,
  // all daubers, $987.00 net and no tax line at all. Daubers are bought for
  // resale to players; the games are not. So exemption is a property of the
  // product, not of the distributor.
  const taxableGoods = sumMoney(
    priced.filter((l) => l.taxable !== false), (l) => l.qty * (Number(l.cost) || 0));
  const tax = round2(taxableGoods * (taxRate || 0));
  const tbd = lines.filter((l) => l.price_tbd).length;
  return {
    goods, packing, subtotal, taxable: taxableGoods, tax,
    exempt: round2(goods - taxableGoods),
    total: round2(subtotal + tax), tbd, partial: tbd > 0,
  };
}

export const VENDOR_CODES = { bv: 'BV', md: 'MD', cbs: 'CBS', pbf: 'PBF' };

/**
 * Next PO number, e.g. SC-2026-08-BV-014.
 * seq is a plain object persisted in settings ('po_sequence'): { "SC-BV": 13, ... }
 * Returns { num, seq } with the incremented sequence (caller persists it).
 */
export function nextPoNum(seq, hallId, vendorId, date = new Date()) {
  const hall = hallId.toUpperCase();
  const vc = VENDOR_CODES[vendorId] || vendorId.toUpperCase();
  const key = `${hall}-${vc}`;
  const n = (seq[key] || 0) + 1;
  const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  return { num: `${hall}-${ym}-${vc}-${String(n).padStart(3, '0')}`, seq: { ...seq, [key]: n } };
}

/**
 * Build PO drafts from the order-builder quantities.
 * qty: {productId: n}; products/vendors: catalog arrays.
 * Returns one draft per vendor with lines, totals. (Numbers are assigned at send time.)
 */
export function buildDrafts(qty, products, vendors) {
  const pmap = Object.fromEntries(products.map((p) => [p.id, p]));
  const vmap = Object.fromEntries(vendors.map((v) => [v.id, v]));
  const byVendor = {};
  for (const [pid, n] of Object.entries(qty)) {
    if (!(n > 0)) continue;
    const p = pmap[pid];
    if (!p) continue;
    // no confirmed distributor means no one to send the PO to — keep it off the order
    if (!p.vendor_id || p.vendor_id === 'unknown') continue;
    (byVendor[p.vendor_id] ||= []).push({
      product_id: pid, name_snapshot: lineName(p), qty: n,
      // Number() on the way IN, not just in the test above it. Keeping the raw
      // string here made poTotals concatenate it against the packing and quietly
      // drop packing from every subtotal, tax and total.
      cost: Number(p.cost) > 0 ? Number(p.cost) : 0,
      price_tbd: !(Number(p.cost) > 0),   // ordered before we knew the price
      kind: 'item',
      base_cost: baseCost(p),
      pack_units: packUnits(p),
      packing_each: packingFor(p, vmap[p.vendor_id]),
      // one ordered unit can arrive as several inventory boxes, each worth a share
      split_boxes: Math.max(1, parseInt(p.split_boxes) || 1),
      per_box_cost: perBoxValue(p),
      // supplies are resold to players, so they come to us exempt (see poTotals)
      taxable: p.taxable !== false,
    });
  }
  return Object.entries(byVendor).map(([vendorId, rawLines]) => {
    const v = vmap[vendorId];
    rawLines.sort((a, b) => a.name_snapshot.localeCompare(b.name_snapshot));
    const lines = rawLines.map(({ _packUnits, ...l }) => l);   // internal only, never persisted
    return { vendor_id: vendorId, vendor_name: v.name, lines, ...poTotals(lines, v.tax_rate) };
  }).sort((a, b) => a.vendor_name.localeCompare(b.vendor_name));
}

/**
 * DEPRECATED — packing is now charged on the line that earned it (see buildDrafts),
 * because a lump sum at the bottom tells nobody what any single item really costs.
 * Kept only so an older PO with a standalone fee line still renders.
 *
 * Some vendors add a packing surcharge — Bingo Vision charges $4 per packed unit.
 *
 * How many units a box packs is a property of the PRODUCT, not of its type: a box
 * of flash packs 1 ($4), a Biker 10-pack case packs 80 ($320), and an ordinary
 * strip packs none at all. Anything left at 0 is never charged, which is the safe
 * default for a product nobody has confirmed — daubers included.
 *
 * The rate belongs to the vendor, the unit count to the product, so only a vendor
 * who actually charges packing can ever produce this line.
 *
 * It becomes a real PO line so the vendor sees it and the total matches their
 * invoice — but kind 'fee' means it never creates an inventory box.
 */
export function packingLine(vendor, lines) {
  const fee = Number(vendor?.packing_fee) || 0;
  if (fee <= 0) return null;
  const units = lines
    .filter((l) => l.kind !== 'fee')
    .reduce((a, l) => a + l.qty * (Number(l._packUnits) || 0), 0);
  if (units <= 0) return null;
  return {
    product_id: null, kind: 'fee', qty: units, cost: round2(fee), price_tbd: false,
    name_snapshot: `Packing — ${fmtMoney(fee)} per unit (${units} unit${units === 1 ? '' : 's'})`,
  };
}

/**
 * Rebuild a sent PO into the shape the email templates expect, so it can be
 * printed again months later.
 *
 * The line is the source of truth — it holds what the vendor was actually quoted.
 * The catalog is only consulted for parts a line predates (POs written before
 * base_cost / pack_units were kept on the line), and never to overwrite them:
 * a reprint that quietly showed today's price instead of the sent price would be
 * worse than no reprint at all.
 */
export function poFromRecord(po, lines, products) {
  const pmap = Object.fromEntries(products.map((p) => [p.id, p]));
  return {
    ...po,
    lines: lines.map((l) => {
      const p = pmap[l.product_id] || {};
      return {
        ...l,
        base_cost: l.base_cost != null ? Number(l.base_cost) : (Number(p.base_cost) || Number(l.cost) || 0),
        pack_units: l.pack_units != null ? Number(l.pack_units) : (Number(p.pack_units) || 1),
        packing_each: Number(l.packing_each) || 0,
        cost: Number(l.cost) || 0,
        qty: Number(l.qty) || 0,
      };
    }),
  };
}

/**
 * Re-quote a PO from today's catalog. For the case the "?" note describes: the
 * vendor sends prices for the lines we had none for, those go into the catalog,
 * and the same PO number goes back out with the figures filled in.
 *
 * Returns the new lines and totals plus what changed, so the change can be shown
 * before anything is written.
 */
export function repriceFromCatalog(po, lines, products, vendor) {
  const pmap = Object.fromEntries(products.map((p) => [p.id, p]));
  const changes = [];
  const next = lines.map((l) => {
    const p = pmap[l.product_id];
    if (!p || l.kind === 'fee') return { ...l };
    const base = baseCost(p);
    const units = packUnits(p);
    const cost = round2(base * units);
    const packing = packingFor(p, vendor);
    const tbd = !(cost > 0);
    if (round2(Number(l.cost) || 0) !== cost || (Number(l.packing_each) || 0) !== packing) {
      changes.push({
        name: l.name_snapshot,
        from: Number(l.cost) || 0, to: cost,
        wasTbd: !!l.price_tbd, nowTbd: tbd,
      });
    }
    return { ...l, base_cost: base, pack_units: units, cost, packing_each: packing, price_tbd: tbd };
  });
  return { lines: next, totals: poTotals(next, vendor?.tax_rate || 0), changes };
}
