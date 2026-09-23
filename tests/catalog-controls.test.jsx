import React from 'react';
import assert from 'node:assert/strict';
import { act, create } from 'react-test-renderer';
import { AppCtx } from '../src/App.jsx';
import Inventory from '../src/components/Inventory.jsx';
import Purchase from '../src/components/Purchase.jsx';
import Games from '../src/components/Games.jsx';
import Owned from '../src/components/Owned.jsx';
import UpdateGame from '../src/components/UpdateGame.jsx';
import { ProductGroupingToggle } from '../src/components/ProductGrouping.jsx';
import { groupProducts, productGroup } from '../src/lib/logic/productGroups.js';
import { DemoStore } from '../src/lib/store/demoStore.js';
import { buildDrafts } from '../src/lib/logic/po.js';

const noop = () => {};
const vendors = [{ id: 'md', name: 'Marathon', tax_rate: 0.1, packing_fee: 0 }];
const products = [
  ['f2', 'Zebra Flash', 'flash'], ['p1', 'Alpha Paper', 'paper'],
  ['s2', 'Zebra Strip', 'strip'], ['u1', 'Alpha Unknown', null],
  ['f1', 'Alpha Flash', 'flash'], ['s1', 'Alpha Strip', 'strip'],
  ['o1', 'Alpha Supply', 'supply'],
].map(([id, name, type]) => ({ id, name, type, vendor_id: 'md', active: true,
  base_cost: 10, cost: 10, tickets: 1000, price_per_ticket: 1,
  pack_units: 1, split_boxes: 1, packing_units: 0, packing_rate: null }));
const ctx = {
  hall: 'sc', products, vendors,
  boxes: products.map((p) => ({ id: 'box-' + p.id, product_id: p.id, hall_id: 'sc', state: 'in_inventory' })),
  orderQty: {}, hidden: new Set(), can: () => true,
  store: { getOffsite: async () => [] }, reloadCatalog: noop, reloadHall: noop,
  setToast: noop, requirePin: async () => true, setScreen: noop, openSession: 'Friday',
};
async function mount(Comp, c = ctx, props = {}) {
  let tree;
  await act(async () => { tree = create(<AppCtx.Provider value={c}><Comp {...props} /></AppCtx.Provider>); });
  return tree;
}
const text = (n) => typeof n === 'string' || typeof n === 'number' ? String(n)
  : (n?.children || []).map(text).join('');
const bodyRows = (t) => t.root.findAllByType('tbody')[0].findAllByType('tr');
const names = (t) => bodyRows(t).filter((r) => r.findAllByType('td').length).map((r) => {
  const cell = r.findAllByType('td')[0];
  const input = cell.findAllByType('input')[0];
  return input ? input.props.defaultValue : text(cell);
});
const headings = (t) => bodyRows(t).filter((r) => r.props.className === 'product-group-row').map(text);
async function toggle(t, checked) {
  await act(async () => t.root.findByType(ProductGroupingToggle).props.onChange(checked));
}
async function change(t, id, value) {
  await act(async () => t.root.findByProps({ id }).props.onChange({ target: { value } }));
}
async function save(t) {
  await act(async () => t.root.findAllByType('button').find((b) => text(b) === 'Save').props.onClick());
}

async function main() {
const originalIds = products.map((p) => p.id);
assert.deepEqual(groupProducts(products).map((p) => p.id), ['s1', 's2', 'f1', 'f2', 'p1', 'o1', 'u1']);
assert.deepEqual(products.map((p) => p.id), originalIds);
assert.equal(productGroup({ type: 'constructor' }), 3);
assert.deepEqual(groupProducts([{ id: '2', name: 'alpha', type: 'strip' },
  { id: '1', name: 'Alpha', type: 'strip' }]).map((p) => p.id), ['1', '2']);

for (const Comp of [Inventory, Purchase, Games, Owned]) {
  const t = await mount(Comp);
  // Include supplies using the existing filter, when this screen offers it.
  const misc = t.root.findAllByType('select').find((s) => s.findAllByType('option').some((o) => o.props.value === 'misc'));
  if (misc) await act(async () => misc.props.onChange({ target: { value: 'all' } }));
  const before = names(t);
  const moneyBefore = text(t.toJSON()).match(/\$[\d,.]+/g);
  await toggle(t, true);
  assert.deepEqual(headings(t), ['Strips', 'Flash', 'Paper', 'Other']);
  assert.deepEqual(names(t), ['Alpha Strip', 'Zebra Strip', 'Alpha Flash', 'Zebra Flash', 'Alpha Paper', 'Alpha Supply', 'Alpha Unknown']);
  for (const row of bodyRows(t).filter((r) => r.props.className === 'product-group-row')) {
    assert.equal(row.findByType('th').props.colSpan, bodyRows(t).find((r) => r.findAllByType('td').length).findAllByType('td').length);
  }
  // Same amounts are present; only the rows changed order.
  assert.deepEqual((text(t.toJSON()).match(/\$[\d,.]+/g) || []).sort(), (moneyBefore || []).sort());
  await toggle(t, false);
  assert.deepEqual(names(t), before);
  assert.deepEqual(headings(t), []);
  t.unmount();
  console.log(`  ok    ${Comp.name}: grouping order, totals, column spans, and restoration`);
}

{
  const t = await mount(Purchase, { ...ctx, orderQty: { f2: 3 } });
  await toggle(t, true);
  const search = t.root.findAllByType('input').find((i) => i.props.type === 'text');
  await act(async () => search.props.onChange({ target: { value: 'Alpha Strip' } }));
  assert.deepEqual(names(t), ['Alpha Strip', 'Zebra Flash']);
  assert.equal(t.root.findAllByType('input').find((i) => i.props.className === 'qty' && i.props.value === 3).props.value, 3);
  const edit = t.root.findAllByType('button').find((b) => text(b) === 'Edit');
  await act(async () => edit.props.onClick());
  assert.equal(t.root.findByType(UpdateGame).props.product.name, 'Alpha Strip');
  t.unmount();
  console.log('  ok    Purchase: filters preserve ordered quantities and Edit opens the catalog item');
}

// Exercise the real persistent store through the actual editor, then reload a new
// store instance and price an order from the saved product (not form state).
const store = new DemoStore();
await store.init();
store.db.products = products.map((p) => ({ ...p }));
store.db.vendors = vendors;
let pinCalls = 0;
let toast = '';
const editCtx = { ...ctx, store, requirePin: async () => { pinCalls++; return true; }, setToast: (s) => { toast = s; } };
const item = async () => (await store.getProducts()).find((p) => p.id === 's1');
const editor = async (c = editCtx) => mount(UpdateGame, c, { product: { ...await item() }, onClose: noop });
{
  const t = await editor();
  assert.equal(t.root.findByProps({ id: 'packing-rate' }).props.value, '');
  await change(t, 'packing-units', '1');
  await change(t, 'packing-rate', '3.75');
  assert.ok(text(t.toJSON()).includes('Packing per ordered item: $3.75'));
  await save(t);
  assert.equal(pinCalls, 1);
  t.unmount();
  const reopenedStore = new DemoStore();
  await reopenedStore.init();
  const p = (await reopenedStore.getProducts()).find((p) => p.id === 's1');
  assert.equal(p.packing_rate, 3.75);
  assert.equal(p.packing_units, 1);
  const draft = buildDrafts({ s1: 2 }, [p], vendors)[0];
  assert.equal(draft.lines[0].packing_each, 3.75);
  assert.equal(draft.total, 29.5); // $20 goods + $2 goods tax + $7.50 untaxed packing
  const reopened = await editor();
  assert.equal(reopened.root.findByProps({ id: 'packing-rate' }).props.value, '3.75');
  reopened.unmount();
  console.log('  ok    item packing fee persists after reload and is used in future PO totals');
}
{
  const t = await editor({ ...editCtx, vendors: [{ ...vendors[0], packing_fee: 4 }] });
  await change(t, 'packing-rate', '0');
  await save(t);
  assert.equal((await item()).packing_rate, 0);
  assert.equal(buildDrafts({ s1: 1 }, [await item()], [{ ...vendors[0], packing_fee: 4 }])[0].lines[0].packing_each, 0);
  t.unmount();
  const reset = await editor({ ...editCtx, vendors: [{ ...vendors[0], packing_fee: 4 }] });
  await change(reset, 'packing-rate', '');
  await save(reset);
  assert.equal((await item()).packing_rate, null);
  assert.equal(buildDrafts({ s1: 1 }, [await item()], [{ ...vendors[0], packing_fee: 4 }])[0].lines[0].packing_each, 4);
  reset.unmount();
  console.log('  ok    zero saves free packing; clearing restores the distributor default');
}
{
  const t = await editor();
  const before = { ...await item() };
  for (const [id, value] of [['packing-rate', '-1'], ['packing-rate', '-0.001'], ['packing-rate', 'Infinity'], ['packing-rate', 'bad']]) {
    toast = '';
    await change(t, id, value);
    await save(t);
    assert.match(toast, /Enter a whole number/);
    assert.deepEqual(await item(), before);
  }
  await change(t, 'packing-rate', '5');
  await change(t, 'packing-units', '1.5');
  await save(t);
  assert.deepEqual(await item(), before);
  t.unmount();
  const denied = await editor({ ...editCtx, requirePin: async () => false });
  await change(denied, 'packing-rate', '5');
  await save(denied);
  assert.deepEqual(await item(), before);
  denied.unmount();
  const locked = await editor({ ...editCtx, can: () => false });
  assert.equal(locked.root.findAllByProps({ id: 'packing-rate' }).length, 0);
  locked.unmount();
  console.log('  ok    invalid fees, fractional units, denied PIN, and catalog access are guarded');
}
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
