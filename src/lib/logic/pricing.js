// A price has three parts, and squashing them into one number is what made the
// catalog hard to trust:
//
//   base       what one unit costs                    $64.60
//   units      how many units come in a box            x16
//   box cost   what the vendor invoices for the box   $1,033.60   (base x units)
//
// Packing is a fourth, separate thing. How many units a vendor charges packing on
// is NOT how many are in the box — Monopoly packs 16 and is charged for none, a
// Biker case packs 80 and is charged for all 80, a box of flash packs 1.

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Units in a box. Always at least 1, so the maths can never collapse to zero. */
export const packUnits = (p) => Math.max(1, parseInt(p?.pack_units) || 1);

/** What one unit costs. Falls back to the box cost for anything not yet split out. */
export const baseCost = (p) =>
  p?.base_cost != null && p.base_cost !== '' ? Number(p.base_cost) : Number(p?.cost) || 0;

/** What the vendor invoices for one box. */
export const boxCost = (p) => round2(baseCost(p) * packUnits(p));

/**
 * The rate charged per packed unit. Usually the vendor's, but a product may
 * override it, because one vendor can charge two different rates: Bingo Vision
 * bills $4.00 a box to pack flash and $2.00 a deal to collate strips. Invoice
 * 1806006 is 800 deals of collation at $2.00 = $1,600; 1806034 carries $672.00,
 * which is 168 boxes at $4.00. One vendor-level number cannot say both.
 *
 * 0 is a real answer (a vendor who packs free), so only null/undefined/'' falls
 * through to the vendor.
 */
export const packingRate = (p, vendor) => {
  const own = p?.packing_rate;
  if (own !== null && own !== undefined && own !== '') return Number(own) || 0;
  return Number(vendor?.packing_fee) || 0;
};

/** Packing on one box of this product, at whichever rate applies. */
export const packingFor = (p, vendor) =>
  round2(packingRate(p, vendor) * (Number(p?.packing_units) || 0));

/** Box cost plus its packing — what a box actually costs to have on the shelf. */
export const allInCost = (p, vendor) => round2(boxCost(p) + packingFor(p, vendor));

/**
 * How many inventory boxes one ordered unit becomes.
 *
 * Usually 1 — you buy a box, you shelve a box. But a Biker 10-pack case is bought
 * as one line and arrives as 16 totes, and it's the tote that gets counted, opened
 * and sold from. Always at least 1.
 */
export const splitBoxes = (p) => Math.max(1, parseInt(p?.split_boxes) || 1);

/**
 * What ONE INVENTORY UNIT is worth — the goods cost of the ordered unit spread
 * across the units it becomes. A Biker case is 80 deals at $64.60, so $5,168, and
 * it arrives as 16 totes: $323.00 a tote.
 *
 * Packing is deliberately NOT in here. It is a charge for getting the goods to the
 * door, not part of what the goods are worth sitting on a shelf, and rolling it in
 * makes a tote look more valuable than an identical tote that came in a bigger
 * delivery. It stays on the PO, where the vendor invoices it. boxCost + packing is
 * what gets paid; this is what gets counted.
 */
export const perBoxValue = (p) => round2(boxCost(p) / splitBoxes(p));

/**
 * The noun for one counted unit. A bare "16" on the Inventory screen is ambiguous
 * across this catalog — it could be 16 totes, 16 lettered packs or 16 boxes.
 */
const UNIT_WORDS = {
  box: ['box', 'boxes'],
  pack: ['pack', 'packs'],
  tote: ['tote', 'totes'],
  dozen: ['12 pack', '12 packs'],
};
export function stockUnit(p) {
  const key = p?.stock_unit
    || (packUnits(p) === 80 ? 'tote' : p?.type === 'strip' ? 'pack' : p?.type === 'supply' ? 'dozen' : 'box');
  return UNIT_WORDS[key] || UNIT_WORDS.box;
}
/** "1 tote" / "16 totes" */
export const unitLabel = (p, n) => stockUnit(p)[n === 1 ? 0 : 1];

/** The four parts, ready to print. */
export function priceParts(p, vendor) {
  const units = packUnits(p);
  const split = splitBoxes(p);
  return {
    base: baseCost(p),
    units,
    box: boxCost(p),
    packing: packingFor(p, vendor),
    allIn: allInCost(p, vendor),
    split,
    perBox: perBoxValue(p),
    unit: stockUnit(p),
    multiplied: units > 1,
    splits: split > 1,
  };
}
