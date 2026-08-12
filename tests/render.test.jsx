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
      getAdjustments: [], getArrivals: [],
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
};

const SCREENS = {
  Dashboard, Purchase, Review, Inventory, OpenBoxes, Orders, Accounting,
  Receiving, Games, SessionUse, Assign, History, SettingsScreen, Sidebar,
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
process.exit(failed ? 1 : 0);
