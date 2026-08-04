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
    product_id: null, kind: 'fee', qty: boxes, cost: round2(fee),
    name_snapshot: `Packing — ${fmtMoney(fee)} per box of ${label}`,
  };
}
