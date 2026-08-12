// Turning a delivery into the lines an email is built from.
//
// This lived inside the Receiving screen, which meant the arithmetic that decides
// what the hall pays could only be exercised by clicking through the UI. It got
// two unit conversions wrong for months, and no test could have caught either
// because there was nothing importable to test.
//
// The one rule that matters here:
//
//   A PO is written in ORDERED UNITS — a case, a set, a box.
//   A shelf is counted in INVENTORY UNITS — a tote, a lettered pack, a box.
//   One ordered unit becomes `split_boxes` inventory units.
//
// The emails count in inventory units, because that is what the person checking
// the truck counted. So EVERY per-unit figure on the line has to come down to the
// inventory unit — not just the cost. Bringing the cost down and leaving packing
// alone billed one Biker case for 16 x $160 of collation instead of $160.

import { round2, splitBoxes } from './pricing.js';

/**
 * Any per-ORDERED-UNIT figure, brought down to one inventory unit.
 *
 * Exact whenever the split divides the figure, which it does for every line in
 * the live catalog. Where it doesn't, the residue is at most half a cent per unit
 * and shows up in the PO-vs-payment "Difference" line rather than being hidden.
 */
export const perUnitOf = (value, split) =>
  round2((Number(value) || 0) / Math.max(1, parseInt(split) || 1));

/**
 * How many inventory units one ordered unit of this line becomes.
 *
 * The line's own `split_boxes` is a snapshot taken when the order was placed and
 * wins over the catalog, so re-shaping a product later cannot silently re-price a
 * delivery that is already in flight.
 */
export const lineSplit = (line, product) =>
  Math.max(1, parseInt(line?.split_boxes) || splitBoxes(product));

/**
 * A PO line, restated as the inventory units that actually arrived.
 *
 * `orderedUnitPrice` is what one ordered unit costs — either the price locked on
 * the line, or the one the clerk read off the invoice for a line whose price was
 * still open.
 */
export function receivedLine(line, product, qtyUnits, orderedUnitPrice) {
  const split = lineSplit(line, product);
  return {
    ...line,
    qty: qtyUnits,
    cost: perUnitOf(orderedUnitPrice, split),
    packing_each: perUnitOf(line?.packing_each, split),
    price_tbd: false,
  };
}

/**
 * The same, for the part of a line that did not turn up.
 *
 * Priced identically to what did arrive, so "what we paid" and "what you owe us"
 * are quoted in the same money. It stays `price_tbd` only if nobody has supplied
 * a price at all — otherwise the vendor gets a credit note reading "$?".
 */
export function missingLine(line, product, qtyUnits, orderedUnitPrice) {
  return {
    ...receivedLine(line, product, qtyUnits, orderedUnitPrice),
    price_tbd: !!line?.price_tbd && !(Number(orderedUnitPrice) > 0),
  };
}

/**
 * Stock that arrived without being on the PO.
 *
 * There is no line to inherit from, so the shape comes off the product: the price
 * is still an ORDERED-UNIT price and still has to be divided down, and exemption
 * has to be read from the catalog or a tray of daubers gets taxed here while the
 * same daubers on a PO would not be.
 */
export function extraLine(product, name, qtyUnits, orderedUnitPrice) {
  return {
    name_snapshot: name ?? product?.name ?? '',
    qty: qtyUnits,
    cost: perUnitOf(orderedUnitPrice, splitBoxes(product)),
    packing_each: 0,
    taxable: product?.taxable !== false,
    extra: true,
  };
}
