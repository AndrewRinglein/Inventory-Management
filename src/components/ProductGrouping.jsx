import React from 'react';
import { PRODUCT_GROUPS, productGroup, groupProducts } from '../lib/logic/productGroups.js';

export function ProductGroupingToggle({ checked, onChange }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}
      title="Strips, Flash, Paper, then Other; alphabetical within each group. Existing filters still apply.">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      Group by type (A-Z)
    </label>
  );
}

export function GroupedProductRows({ items, enabled, columns, getProduct = (item) => item, children }) {
  const shown = enabled ? groupProducts(items, getProduct) : items;
  return shown.map((item, index) => {
    const product = getProduct(item);
    const group = productGroup(product);
    const startsGroup = enabled && (!index || productGroup(getProduct(shown[index - 1])) !== group);
    return (
      <React.Fragment key={product.id}>
        {startsGroup && <tr className="product-group-row">
          <th colSpan={columns} scope="rowgroup" style={{ background: 'var(--bg)', padding: '10px 16px', textAlign: 'left' }}>
            {PRODUCT_GROUPS[group]}
          </th>
        </tr>}
        {children(item)}
      </React.Fragment>
    );
  });
}
