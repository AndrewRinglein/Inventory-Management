// Purchase-order math and numbering. Pure functions — unit tested in tests/logic.test.js.

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Postgres numeric columns arrive over the wire as STRINGS ("64.60"), so every
// money helper coerces first. A string has its own toLocaleString that quietly
// ignores the options, which would drop thousands separators and cents.
export const fmtMoney = (n) =>
  '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** $ per ticket as a number — same string-from-the-API trap as above. */
export const ticketPrice = (p) => Number(p?.price_per_ticket) || 1;

/** Display name for a PO line: cleaned name + (tickets/$price) so vendors see the full spec. */
export function lineName(product) {
  if (!product.tickets) return product.name;
  return `${product.name} (${product.tickets}/$${product.price_per_ticket || 1})`;
}

/**
 * Totals for one vendor's lines.
 * lines: [{qty, cost, price_tbd}] → { subtotal, tax, total, tbd, partial }.
 *
 * A line whose price we don't have yet contributes nothing to the money. That
 * makes the printed total a floor, not the bill — `partial` says so, and every
 * caller that shows a total is expected to say so too. Quietly counting an
 * unpriced line as $0 would understate the order and, later, the amount to pay.
 */
export function poTotals(lines, taxRate) {
  const priced = lines.filter((l) => !l.price_tbd);
  const subtotal = round2(priced.reduce((a, l) => a + l.qty * l.cost, 0));
  const tax = round2(subtotal * (taxRate || 0));
  const tbd = lines.filter((l) => l.price_tbd).length;
  return { subtotal, tax, total: round2(subtotal + tax), tbd, partial: tbd > 0 };
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
    (byVendor[p.vendor_id] ||= []).push({
      product_id: pid, name_snapshot: lineName(p), qty: n,
      cost: Number(p.cost) > 0 ? p.cost : 0,
      price_tbd: !(Number(p.cost) > 0),   // ordered before we knew the price
      kind: 'item', _type: p.type,
    });
  }
  return Object.entries(byVendor).map(([vendorId, rawLines]) => {
    const v = vmap[vendorId];
    rawLines.sort((a, b) => a.name_snapshot.localeCompare(b.name_snapshot));
    const lines = rawLines.map(({ _type, ...l }) => l);
    const fee = packingLine(v, rawLines);
    if (fee) lines.push(fee);
    return { vendor_id: vendorId, vendor_name: v.name, lines, ...poTotals(lines, v.tax_rate) };
  }).sort((a, b) => a.vendor_name.localeCompare(b.vendor_name));
}

/**
 * Some vendors add a per-box packing charge on certain product types
 * (Bingo Vision: $4 per box of flash). It becomes a real PO line so the vendor
 * sees it and the total matches their invoice — but kind 'fee' means it never
 * creates an inventory box.
 * Returns null when the vendor charges nothing or nothing qualifying was ordered.
 */
export function packingLine(vendor, lines) {
  const fee = Number(vendor?.packing_fee) || 0;
  if (fee <= 0) return null;
  const types = String(vendor.packing_types || 'flash')
    .split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  const boxes = lines
    .filter((l) => l.kind !== 'fee' && types.includes(String(l._type || '').toLowerCase()))
    .reduce((a, l) => a + l.qty, 0);
  if (boxes <= 0) return null;
  const label = types.length === 1 ? types[0] : 'items';
  return {
    product_id: null, kind: 'fee', qty: boxes, cost: round2(fee), price_tbd: false,
    name_snapshot: `Packing — ${fmtMoney(fee)} per box of ${label}`,
  };
}
