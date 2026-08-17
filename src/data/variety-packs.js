// What is inside a variety pack.
//
// Marathon sells daubers two ways: one deal of one colour, or a "colour pack" —
// one deal of every colour, on a single line, so restocking is one row instead of
// eleven. The pack is an ordering convenience; it comes apart into separate packs
// the moment it lands, and each of those is also a product in its own right.
//
// The PO has to name the colours, or the vendor is being asked for "a colour pack"
// and both sides find out what that meant at delivery.
//
// This is a lookup rather than a column because three products in a catalog of
// five hundred have it. A `colors` column would sit empty on every flash game, and
// empty columns invite half-answers. The deal multiplier IS a column — pack_units —
// and the two must agree: eleven colours means x11. tests/variety-packs.mjs fails
// the build if this list and the migration that sets pack_units drift apart.

export const VARIETY_PACKS = {
  S830: {
    label: "Dabbin' Fever 4oz",
    colors: ['Red', 'Green', 'Orange', 'Teal', 'Yellow', 'Purple', 'Pink', 'Fuchsia'],
  },
  S831: {
    label: 'Sunsational 4oz',
    colors: ['Red', 'Green', 'Orange', 'Pink', 'Magenta', 'Sky Blue', 'Coral',
      'Lilac', 'Violet', 'Yellow', 'Ruby Red'],
  },
  S832: {
    label: "Dabbin' Win 1.5oz/15mm",
    colors: ['Red', 'Blue', 'Green', 'Orange', 'Yellow', 'Purple', 'Teal', 'Pink'],
  },
};

/** The colours in this line's pack, or null if it isn't one. */
export const packColors = (productId) => VARIETY_PACKS[productId]?.colors || null;

/** "Red, Green, Orange, Teal, Yellow, Purple, Pink and Fuchsia" */
export function packColorList(productId) {
  const c = packColors(productId);
  if (!c || !c.length) return null;
  if (c.length === 1) return c[0];
  return `${c.slice(0, -1).join(', ')} and ${c[c.length - 1]}`;
}
