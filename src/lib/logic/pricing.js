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

/** Packing on one box of this product, at this vendor's rate. */
export const packingFor = (p, vendor) =>
  round2((Number(vendor?.packing_fee) || 0) * (Number(p?.packing_units) || 0));

/** Box cost plus its packing — what a box actually costs to have on the shelf. */
export const allInCost = (p, vendor) => round2(boxCost(p) + packingFor(p, vendor));

/** The four parts, ready to print. */
export function priceParts(p, vendor) {
  const units = packUnits(p);
  return {
    base: baseCost(p),
    units,
    box: boxCost(p),
    packing: packingFor(p, vendor),
    allIn: allInCost(p, vendor),
    multiplied: units > 1,
  };
}
