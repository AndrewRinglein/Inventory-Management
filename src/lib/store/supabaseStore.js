// Supabase-backed store — same interface as DemoStore.
// Activated automatically when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set in .env.

import { createClient } from '@supabase/supabase-js';
import { senderFor } from '../logic/emails.js';
import { perBoxValue } from '../logic/pricing.js';

const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

// PostgREST caps every response at 1000 rows and gives no warning when it truncates —
// a hall with more than 1000 boxes would silently show wrong counts and values.
// Page through until a short page comes back.
const PAGE = 1000;
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const rows = ok(await build().range(from, from + PAGE - 1));
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export class SupabaseStore {
  isDemo = false;

  constructor(url, key) {
    this.sb = createClient(url, key);
  }
  async init() { /* nothing to preload; session restored by supabase-js */ }

  // ---- auth ----
  async signIn(email, pass) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password: pass });
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  async signOut() { await this.sb.auth.signOut(); }
  async getSession() {
    const { data } = await this.sb.auth.getSession();
    return data.session ? { email: data.session.user.email } : null;
  }

  // ---- catalog ----
  async getVendors() { return ok(await this.sb.from('vendors').select('*').order('name')); }
  async getProducts() { return fetchAll(() => this.sb.from('products').select('*').order('name')); }
  async updateProduct(id, fields) {
    return ok(await this.sb.from('products').update(fields).eq('id', id).select().single());
  }
  async addProduct(p) {
    const row = { id: 'C' + Date.now(), ...p };
    return ok(await this.sb.from('products').insert(row).select().single());
  }
  async updateVendor(id, fields) {
    return ok(await this.sb.from('vendors').update(fields).eq('id', id).select().single());
  }

  // ---- order builder quantities ----
  async getOrderQty(hallId) {
    const rows = await fetchAll(() => this.sb.from('order_qty').select('*').eq('hall_id', hallId));
    return Object.fromEntries(rows.map((r) => [r.product_id, r.qty]));
  }
  async setOrderQty(hallId, productId, qty) {
    if (qty > 0) {
      ok(await this.sb.from('order_qty').upsert({ hall_id: hallId, product_id: productId, qty }));
    } else {
      ok(await this.sb.from('order_qty').delete().match({ hall_id: hallId, product_id: productId }));
    }
  }
  async clearOrderQty(hallId) { ok(await this.sb.from('order_qty').delete().eq('hall_id', hallId)); }

  // ---- purchase orders ----
  /**
   * Create the POs for an order.
   *
   * opts.recordedOnly marks an order that was placed outside this system — no
   * email will follow. opts.placedAt backdates it, which is the whole point of
   * recording one: an order phoned in two weeks ago has to sit in the record on
   * the day it was actually placed, or the month's spend and the age of what's
   * on order both read wrong. The boxes are backdated with it.
   */
  async createSentPos(hallId, _drafts, numbered, opts = {}) {
    const { recordedOnly = false, placedAt = null, vendorRef = '' } = opts;
    const when = placedAt || new Date().toISOString();
    const created = [];
    for (const d of numbered) {
      const po = ok(await this.sb.from('purchase_orders').insert({
        num: d.num, hall_id: hallId, vendor_id: d.vendor_id, status: 'sent',
        subtotal: d.subtotal, tax: d.tax, total: d.total,
        price_tbd_lines: d.lines.filter((l) => l.price_tbd).length,
        sent_at: when, created_at: when,
        recorded_only: recordedOnly, vendor_ref: vendorRef || null,
      }).select().single());
      // split_boxes / per_box_cost are how the boxes get built, not part of the PO record
      ok(await this.sb.from('po_lines').insert(
        d.lines.map(({ split_boxes, per_box_cost, base_cost, pack_units, ...l }) => ({ po_id: po.id, ...l }))));
      // fee lines (packing charges) are not physical goods — no boxes for them.
      // One ordered unit can become several inventory boxes (a case of totes), each
      // carrying its share of the landed cost.
      const boxes = d.lines.filter((l) => l.kind !== 'fee' && l.product_id).flatMap((l) =>
        Array.from({ length: l.qty * (l.split_boxes || 1) }, () => ({
          hall_id: hallId, product_id: l.product_id, po_id: po.id,
          cost: l.per_box_cost ?? l.cost, price_tbd: !!l.price_tbd, state: 'on_order',
          ordered_at: when,
        })));
      if (boxes.length) ok(await this.sb.from('boxes').insert(boxes));
      if (recordedOnly) {
        await this.logEvent('po.record', 'purchase_orders', po.num, {
          label: `${hallId === 'sc' ? 'Santa Clara' : 'Redwood City'} — recorded PO ${po.num} (no email sent)`,
          total: po.total, vendor_id: po.vendor_id, placed_at: when, vendor_ref: vendorRef || null,
        });
      }
      created.push(po);
    }
    return created;
  }
  async getPos(hallId) { return fetchAll(() => this.sb.from('purchase_orders').select('*').eq('hall_id', hallId).order('created_at', { ascending: false })); }
  async getPoLines(poId) { return fetchAll(() => this.sb.from('po_lines').select('*').eq('po_id', poId)); }
  async setPoStatus(poId, status) { ok(await this.sb.from('purchase_orders').update({ status }).eq('id', poId)); }

  /** Archive (or restore) a PO. Nothing is destroyed — it just leaves the working views. */
  async setPoArchived(poId, archived) {
    const po = ok(await this.sb.from('purchase_orders')
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq('id', poId).select().single());
    await this.logEvent(archived ? 'po.archive' : 'po.restore', 'purchase_orders', po.num, {
      label: `${po.hall_id === 'sc' ? 'Santa Clara' : 'Redwood City'} — ${archived ? 'archived' : 'restored'} PO ${po.num}`,
    });
    return po;
  }

  /**
   * Delete a purchase order outright — for one entered by mistake.
   *
   * Refuses once anything on it has been received: those boxes are real stock on a
   * real shelf, and dropping the PO would either delete them or orphan them from the
   * invoice they were paid against. Close it short instead. The PO number is not
   * recycled, so a vendor holding the old email can still be matched to the record
   * in the activity log.
   */
  async deletePo(poId) {
    const po = ok(await this.sb.from('purchase_orders').select('*').eq('id', poId).single());
    const boxes = await fetchAll(() => this.sb.from('boxes').select('id,state').eq('po_id', poId));
    const received = boxes.filter((b) => b.state !== 'on_order');
    if (received.length) {
      throw new Error(`${received.length} box(es) on ${po.num} have already been received. Use "Close short" instead — deleting would remove stock that's on the shelf.`);
    }
    ok(await this.sb.from('boxes').delete().eq('po_id', poId));
    ok(await this.sb.from('payments').delete().eq('po_num', po.num).eq('hall_id', po.hall_id));
    ok(await this.sb.from('po_lines').delete().eq('po_id', poId));       // FK cascade also covers this
    ok(await this.sb.from('purchase_orders').delete().eq('id', poId));
    await this.logEvent('po.delete', 'purchase_orders', po.num, {
      label: `${po.hall_id === 'sc' ? 'Santa Clara' : 'Redwood City'} — deleted PO ${po.num}`,
      total: po.total, vendor_id: po.vendor_id, boxes: boxes.length,
    });
    return po;
  }

  // ---- boxes ----
  async getBoxes(hallId) { return fetchAll(() => this.sb.from('boxes').select('*').eq('hall_id', hallId).order('id')); }
  async updateBox(id, fields) { return ok(await this.sb.from('boxes').update(fields).eq('id', id).select().single()); }
  async transitionBox(id, toState) {
    // the DB trigger stamps timestamps + rejects illegal transitions
    return ok(await this.sb.from('boxes').update({ state: toState }).eq('id', id).select().single());
  }
  async createBoxes(list) { return ok(await this.sb.from('boxes').insert(list).select()); }
  async setBoxSession(ids, tag) { ok(await this.sb.from('boxes').update({ session_tag: tag }).in('id', ids)); }

  /**
   * Hand-correct the count for one product. A positive delta adds boxes straight
   * into stock (a count that came up short in the system); a negative delta marks
   * boxes missing. Never silently deletes — every adjustment leaves an event with
   * the note attached, so the count can be explained later.
   */
  async adjustStock({ hallId, product, delta, note, label }) {
    const n = Math.abs(delta);
    if (!n) return;
    if (delta > 0) {
      const rows = Array.from({ length: n }, () => ({
        hall_id: hallId, product_id: product.id, state: 'in_inventory',
        cost: perBoxValue(product), serial: '', received_at: new Date().toISOString(),
      }));
      ok(await this.sb.from('boxes').insert(rows));
    } else {
      const pool = ok(await this.sb.from('boxes').select('id')
        .eq('hall_id', hallId).eq('product_id', product.id).eq('state', 'in_inventory')
        .is('session_tag', null).limit(n));
      const ids = pool.map((b) => b.id);
      if (ids.length < n) {   // fall back to set-aside boxes only if we must
        const extra = ok(await this.sb.from('boxes').select('id')
          .eq('hall_id', hallId).eq('product_id', product.id).eq('state', 'in_inventory')
          .not('session_tag', 'is', null).limit(n - ids.length));
        ids.push(...extra.map((b) => b.id));
      }
      if (!ids.length) throw new Error('No boxes in stock to remove');
      ok(await this.sb.from('boxes').update({ state: 'missing' }).in('id', ids));
    }
    await this.logEvent('adjust', 'products', product.id, { label, note, delta, hall: hallId });
  }

  // ---- receiving ----
  async createShipment(s) { return ok(await this.sb.from('shipments').insert(s).select().single()); }
  async confirmShipment(id) { return ok(await this.sb.from('shipments').update({ confirmed: true }).eq('id', id).select().single()); }
  async getShipments(hallId) {
    return ok(await this.sb.from('shipments').select('*, purchase_orders!inner(hall_id)').eq('purchase_orders.hall_id', hallId));
  }
  async uploadInvoicePhoto(file) {
    const path = `invoices/${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`;
    const { error } = await this.sb.storage.from('invoices').upload(path, file);
    if (error) throw new Error(error.message);
    return path;
  }
  getPhotoUrl(path) {
    const { data } = this.sb.storage.from('invoices').getPublicUrl(path);
    return data.publicUrl;
  }

  // ---- payments ----
  async getPayments(hallId) { return fetchAll(() => this.sb.from('payments').select('*').eq('hall_id', hallId).order('created_at', { ascending: false })); }
  async addPayment(p) { return ok(await this.sb.from('payments').insert(p).select().single()); }
  async setPaymentStatus(id, status) { ok(await this.sb.from('payments').update({ status }).eq('id', id)); }

  // ---- emails: real sending via the send-email edge function ----
  async sendEmails(list, hallId) {
    const [settings, allSenders] = await Promise.all([this.getSetting('email'), this.getSetting('sender')]);
    const sender = senderFor(allSenders, hallId);
    const { data, error } = await this.sb.functions.invoke('send-email', {
      body: { emails: list, hall_id: hallId, settings, sender },
    });
    if (error) throw new Error('send-email failed: ' + error.message);
    return data.logs;
  }
  async getEmails(hallId) { return fetchAll(() => this.sb.from('emails').select('*').eq('hall_id', hallId).order('created_at', { ascending: false })); }

  // ---- settings / events ----
  async getSetting(key) {
    const rows = ok(await this.sb.from('settings').select('value').eq('key', key));
    return rows[0]?.value;
  }
  async setSetting(key, value) { ok(await this.sb.from('settings').upsert({ key, value })); }
  async getEvents(limit = 200) { return ok(await this.sb.from('events').select('*').order('at', { ascending: false }).limit(limit)); }
  async logEvent(kind, entity, entity_id, detail = {}) {
    ok(await this.sb.from('events').insert({ kind, entity, entity_id, detail, actor: 'app' }));
  }

  // ---- AI invoice/label reading via edge function ----
  async readInvoicePhoto(path) {
    const { data, error } = await this.sb.functions.invoke('read-invoice', { body: { path } });
    if (error) throw new Error('read-invoice failed: ' + error.message);
    return data;
  }
}
