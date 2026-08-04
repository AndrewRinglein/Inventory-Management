// Purchase-order math and numbering. Pure functions — unit tested in tests/logic.test.js.

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export const fmtMoney = (n) =>
  '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Display name for a PO line: cleaned name + (tickets/$price) so vendors see the full spec. */
export function lineName(product) {
  if (!product.tickets) return product.name;
  return `${product.name} (${product.tickets}/$${product.price_per_ticket || 1})`;
}

/**
 * Totals for one vendor's lines.
 * lines: [{qty, cost}]  → { subtotal, tax, total } with tax rounded per-PO (matches the spreadsheet).
 */
export function poTotals(lines, taxRate) {
  const subtotal = round2(lines.reduce((a, l) => a + l.qty * l.cost, 0));
  const tax = round2(subtotal * (taxRate || 0));
  return { subtotal, tax, total: round2(subtotal + tax) };
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
      product_id: pid, name_snapshot: lineName(p), qty: n, cost: p.cost,
    });
  }
  return Object.entries(byVendor).map(([vendorId, lines]) => {
    const v = vmap[vendorId];
    lines.sort((a, b) => a.name_snapshot.localeCompare(b.name_snapshot));
    return { vendor_id: vendorId, vendor_name: v.name, lines, ...poTotals(lines, v.tax_rate) };
  }).sort((a, b) => a.vendor_name.localeCompare(b.vendor_name));
}
