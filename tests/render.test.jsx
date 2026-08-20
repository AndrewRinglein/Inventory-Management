// Render smoke test.
//
// Every screen gets rendered to a string against a mock context. It asserts
// nothing about what they look like — it only proves they run. That is the class
// of bug the build cannot see: `view is not defined` is a perfectly valid
// identifier at compile time and only explodes when React evaluates the tree, so
// a green `vite build` says nothing about whether a screen still opens.
//
// Run with:  npm test

import React from 'react';
import { renderToString } from 'react-dom/server';
import { AppCtx } from '../src/App.jsx';

import Dashboard from '../src/components/Dashboard.jsx';
import Purchase from '../src/components/Purchase.jsx';
import Review from '../src/components/Review.jsx';
import Inventory from '../src/components/Inventory.jsx';
import OpenBoxes from '../src/components/OpenBoxes.jsx';
import Orders from '../src/components/Orders.jsx';
import Accounting from '../src/components/Accounting.jsx';
import Receiving from '../src/components/Receiving.jsx';
import Games from '../src/components/Games.jsx';
import SessionUse from '../src/components/SessionUse.jsx';
import AddDelivery from '../src/components/AddDelivery.jsx';
import Assign from '../src/components/Assign.jsx';
import History from '../src/components/History.jsx';
import Adjust from '../src/components/Adjust.jsx';
import Owned from '../src/components/Owned.jsx';
import SettingsScreen from '../src/components/SettingsScreen.jsx';
import Sidebar from '../src/components/Sidebar.jsx';

const vendors = [
  { id: 'bv', name: 'Bingo Vision', email: 'a@b.com', contact_name: 'Scott', tax_rate: 0.0975, packing_fee: 4 },
  { id: 'md', name: 'Marathon', email: 'c@d.com', contact_name: 'Esteban', tax_rate: 0.0975, packing_fee: 0 },
];
const products = [
  { id: 'P1', name: 'Golden Carrot', vendor_id: 'bv', type: 'flash', tickets: 1200, price_per_ticket: '1.00',
    base_cost: '64.60', cost: '64.60', pack_units: 1, split_boxes: 1, packing_units: 1, stock_unit: 'box', active: true },
  { id: 'P2', name: 'Monopoly', vendor_id: 'bv', type: 'strip', tickets: null, price_per_ticket: '1.00',
    base_cost: '64.60', cost: '1033.60', pack_units: 16, split_boxes: 16, packing_units: 0, stock_unit: 'pack', active: true },
  { id: 'P3', name: 'No Vendor Game', vendor_id: 'unknown', type: null, tickets: null, price_per_ticket: '1.00',
    base_cost: '0', cost: '0', pack_units: 1, split_boxes: 1, packing_units: 0, stock_unit: 'box', active: true },
];
const boxes = [
  { id: 'b1', hall_id: 'sc', product_id: 'P1', state: 'in_inventory', cost: '64.60', session_tag: null },
  { id: 'b2', hall_id: 'sc', product_id: 'P1', state: 'opened', cost: '64.60', opened_session: 'Friday' },
  { id: 'b3', hall_id: 'sc', product_id: 'P2', state: 'on_order', cost: '64.60', po_id: 'po1' },
];
const pos = [{
  id: 'po1', num: 'SC-2026-08-BV-001', hall_id: 'sc', vendor_id: 'bv', status: 'sent',
  subtotal: '100.00', tax: '9.75', total: '109.75', sent_at: '2026-08-01T00:00:00Z',
  created_at: '2026-08-01T00:00:00Z', archived_at: null, recorded_only: false, vendor_ref: null,
}];
const sessions = [{
  id: 's1', hall_id: 'sc', session_date: '2026-08-03', part: '', weekday: 'Monday',
  source_file: 'SC Program 8-3-26.xlsx', applied_at: null,
}];
const plays = [
  { id: 'pl1', session_id: 's1', category: 'on-site', name_raw: 'Golden Carrot', qty: 1, serial: '31A1', product_id: 'P1', match_how: 'exact', match_score: 1 },
  { id: 'pl2', session_id: 's1', category: 'pre-sale', name_raw: 'Mystery Thing', qty: 2, serial: '', product_id: null, match_how: 'none', match_score: 0 },
];

const store = new Proxy({}, {
  get: (_t, k) => {
    if (k === 'isDemo') return true;
    return async () => ({
      getSessions: sessions, getAllSessionPlays: plays, getSessionPlays: plays,
      getPoLines: [], getEmails: [], getEvents: [], getDeliveries: [], getAssignments: [],
      getAdjustments: [], getArrivals: [], getOffsite: [], getReceiptDetail: [],
    }[k] ?? []);
  },
});

const ctx = {
  hall: 'sc', setHall: () => {}, screen: 'dashboard', setScreen: () => {},
  vendors, products, boxes, pos, allPos: pos, payments: [], orderQty: { P1: 2 },
  settings: { email: {}, sender: {}, halls_config: {}, po_email: {}, po_sequence: {} },
  store, reloadHall: async () => {}, reloadCatalog: async () => {}, reloadSettings: async () => {},
  setToast: () => {}, requirePin: async () => true, can: () => true,
  scanMode: 'off', setScanMode: () => {}, openSession: 'Friday', setOpenSession: () => {},
  receivingPo: null, setReceivingPo: () => {}, receivingScanRef: { current: null },
  productName: (pid) => products.find((p) => p.id === pid)?.name || pid,
  role: 'admin', roleLabel: 'Super Admin', IS_DEMO: true, IS_SANDBOX: false,
  hidden: new Set(), toggleHidden: async () => {},
};

const SCREENS = {
  Dashboard, Purchase, Review, Inventory, OpenBoxes, Orders, Accounting,
  Receiving, Games, SessionUse, Assign, History, SettingsScreen, Sidebar, Owned,
  AddDelivery: (p) => <AddDelivery onClose={() => {}} {...p} />,
  Adjust: (p) => <Adjust onClose={() => {}} {...p} />,
};

let failed = 0;
for (const [name, Comp] of Object.entries(SCREENS)) {
  try {
    renderToString(<AppCtx.Provider value={ctx}><Comp /></AppCtx.Provider>);
    console.log(`  ok    ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}: ${e.message}`);
  }
}
console.log(failed ? `\n${failed} screen(s) failed to render` : '\nall screens render');

// ---------------------------------------------------------------- column order
//
// Managers were losing the row between the game name and the number they needed,
// because several games have near-identical names and the count sat far to the
// right. The count now sits immediately after the name, and on Purchase the order
// box sits immediately after that. This is a deliberate layout, so it is pinned:
// a future edit that reorders the header without reordering the cells (or vice
// versa) breaks here rather than silently printing every number one column off.

const headersOf = (html) => {
  const head = html.match(/<thead[^>]*>([\s\S]*?)<\/thead>/);
  if (!head) return [];
  return [...head[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
    .map((m) => m[1].replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')
                    .replace(/[↑↓]/g, '').replace(/\s+/g, ' ').trim());
};
const firstRowCells = (html) => {
  const body = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  if (!body) return 0;
  const row = body[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/);
  if (!row) return 0;
  // top-level <td> only — nested tables would confuse a naive count, and there are none
  return (row[1].match(/<td/g) || []).length;
};

const LAYOUTS = [
  { name: 'Purchase',  Comp: Purchase,  lead: ['Game', 'Available', 'Units', 'Line total'] },
  { name: 'Inventory', Comp: Inventory, lead: ['Game', 'Available', 'Counted as'] },
];

let layoutFailed = 0;
console.log('');
for (const { name, Comp, lead } of LAYOUTS) {
  const html = renderToString(<AppCtx.Provider value={ctx}><Comp /></AppCtx.Provider>);
  const th = headersOf(html);
  // Inventory's Game header carries a search box, so compare on the leading word only
  const norm = (h, want) => (h.startsWith(want) ? want : h);
  const ok = lead.every((want, i) => norm(th[i] || '', want) === want);
  if (!ok) {
    layoutFailed++;
    console.log(`  FAIL  ${name} columns: wanted ${lead.join(' | ')}, got ${th.slice(0, lead.length).join(' | ')}`);
  } else {
    console.log(`  ok    ${name} leads with ${lead.join(' | ')}`);
  }
  const nTd = firstRowCells(html);
  if (nTd && nTd !== th.length) {
    layoutFailed++;
    console.log(`  FAIL  ${name}: ${th.length} headers but ${nTd} cells in the first row — a column is off by one`);
  } else if (nTd) {
    console.log(`  ok    ${name} header and cells line up (${nTd} columns)`);
  }
}

// ---------------------------------------------------------------- hiding games
//
// Hiding is a per-hall VIEW filter. The row leaves the screen; the money does
// not. That distinction is the entire safety argument for allowing a game with
// stock to be hidden at all, so it is asserted rather than trusted: the same
// render, twice, with and without the game hidden, and the floor total has to
// come out identical.

const withHidden = (ids) => ({ ...ctx, hidden: new Set(ids) });
const render = (Comp, c) => renderToString(<AppCtx.Provider value={c}><Comp /></AppCtx.Provider>);
const moneyIn = (html) => (html.match(/\$[\d,]+\.\d\d/g) || []);

let hideFailed = 0;
const hideCheck = (label, cond) => {
  if (cond) console.log(`  ok    ${label}`);
  else { hideFailed++; console.log(`  FAIL  ${label}`); }
};

console.log('');
{
  // P1 (Golden Carrot) holds 1 in inventory + 1 opened at this hall
  const plain = render(Inventory, ctx);
  const hid = render(Inventory, withHidden(['P1']));
  hideCheck('Inventory drops a hidden game from the table',
    plain.includes('Golden Carrot') && !hid.includes('>Golden Carrot'));
  hideCheck('Inventory still totals the hidden stock',
    moneyIn(plain)[0] === moneyIn(hid)[0]);
  hideCheck('Inventory says out loud what is behind the filter',
    /1 game hidden at this hall/.test(hid) && /still on the floor/.test(hid));
  hideCheck('Inventory offers a way back to a hidden game',
    /Show hidden \(1\)/.test(hid));

  // the shared mock context puts 2 units of P1 on the order, so clear it first —
  // an order quantity deliberately overrides hiding and would mask this check
  const noOrder = { ...withHidden(['P1']), orderQty: {} };
  const purch = render(Purchase, noOrder);
  hideCheck('Purchase will not offer a hidden game to order',
    render(Purchase, { ...ctx, orderQty: {} }).includes('Golden Carrot')
      && !purch.includes('Golden Carrot'));
  // renderToString splits adjacent expressions with a comment node, so the
  // count and its label are not literally adjacent in the markup
  hideCheck('Purchase points at where hiding is managed', /1(<!-- -->)? hidden here/.test(purch));

  // a hidden game that somehow still carries an order quantity must stay
  // reachable, or the number is stranded on an order nobody can see
  const stranded = render(Purchase, withHidden(['P1']));   // ctx already has P1: 2
  hideCheck('Purchase keeps a hidden game that still has a quantity on the order',
    stranded.includes('Golden Carrot') && /still on the order/.test(stranded));

  // THE ONE THAT NEARLY SHIPPED BROKEN.
  //
  // Inventory only lists games that HAVE stock. So a game hidden while it held
  // boxes vanished from the screen entirely the moment the last box was played —
  // "Show hidden" had nothing to show, Purchase filtered it out, and there was no
  // way back short of editing the database. A hidden game must stay reachable
  // whatever its count says.
  const noStock = {
    ...withHidden(['P3']),         // P3 = No Vendor Game, zero boxes at this hall
    orderQty: {},
  };
  const back = render(Inventory, { ...noStock, });
  hideCheck('Inventory can still reach a hidden game that has run down to nothing',
    /Show hidden \(1\)/.test(back));
  hideCheck('...and shows it when asked, so it can be unhidden',
    render(Inventory, noStock).includes('No Vendor Game') === false
      && /1 game hidden at this hall/.test(back));

  // and the games most in need of hiding — the ones this hall never carried —
  // have no Inventory row at all, so the control has to exist on Purchase too
  hideCheck('Purchase offers a Hide control for catalogue games with no stock',
    /title="Put this game away for this hall only/.test(render(Purchase, { ...ctx, orderQty: {} })));
}

process.exit(failed + layoutFailed + hideFailed ? 1 : 0);
