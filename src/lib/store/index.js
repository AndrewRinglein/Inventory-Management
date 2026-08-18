// Store selector: real Supabase when configured, otherwise browser-local demo mode.
//
// Both stores expose the SAME interface, so every screen is written once:
//   init(), isDemo
//   auth:      signIn(email, pass), signOut(), getSession()
//   catalog:   getVendors(), getProducts(), updateProduct(id, fields), addProduct(p)
//   orderQty:  getOrderQty(hallId), setOrderQty(hallId, productId, qty), clearOrderQty(hallId)
//   pos:       createSentPos(hallId, drafts) -> pos[], getPos(hallId), getPoLines(poId),
//              setPoStatus(poId, status)
//   boxes:     getBoxes(hallId), updateBox(id, fields), transitionBox(id, toState),
//              createBoxes(list), setBoxSession(ids, tag)
//   receiving: createShipment(s), confirmShipment(shipmentId, summary), getReceiptDetail(shipmentId),
//              uploadInvoicePhoto(file) -> path, getShipments(hallId)
//   location:  moveBoxes({hallId, productId, from, to, qty, ref}), getOffsite(hallId),
//              confirmOffsite(ids, on)   -- where stock IS, independent of its state
//   payments:  getPayments(hallId), addPayment(p), setPaymentStatus(id, status)
//   emails:    sendEmails(list) -> logs (routes via edge function in prod, log-only in demo),
//              getEmails(hallId)
//   settings:  getSetting(key), setSetting(key, value)
//   events:    getEvents(limit)
//   ai:        readInvoicePhoto(pathOrDataUrl) -> extracted lines (edge fn / demo stub)

import { DemoStore } from './demoStore.js';
import { SupabaseStore } from './supabaseStore.js';
import { demoFromUrl } from '../roles.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ?demo in the URL always opens the staged sandbox, even when Supabase is configured.
// Without Supabase keys, the app runs on the (empty-start) local store.
const wantDemo = demoFromUrl();
export const store = wantDemo || !(url && key)
  ? new DemoStore(wantDemo)          // true -> staged sandbox with rich fake data
  : new SupabaseStore(url, key);
export const IS_DEMO = store.isDemo;
export const IS_SANDBOX = wantDemo;
