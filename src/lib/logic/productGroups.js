// The display order is deliberate, independent of the catalog's type picker.
export const PRODUCT_GROUPS = ['Strips', 'Flash', 'Paper', 'Other'];

export function productGroup(product) {
  switch (product?.type) {
    case 'strip': return 0;
    case 'flash': return 1;
    case 'paper': return 2;
    default: return 3;
  }
}

export function compareGroupedProducts(a, b) {
  return productGroup(a) - productGroup(b)
    || String(a?.name || '').trim().localeCompare(String(b?.name || '').trim(), undefined, { sensitivity: 'base' })
    || String(a?.id || '').localeCompare(String(b?.id || ''));
}

// Copy before sorting: catalogs, selected quantities and accounting totals stay intact.
export function groupProducts(items, getProduct = (item) => item) {
  return [...items].sort((a, b) => compareGroupedProducts(getProduct(a), getProduct(b)));
}
