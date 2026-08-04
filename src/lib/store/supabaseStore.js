// Supabase-backed store — same interface as DemoStore.
// Activated automatically when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set in .env.

import { createClient } from '@supabase/supabase-js';

const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

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
  async getProducts() { return ok(await this.sb.from('products').select('*').order('name')); }
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
    const rows = ok(await this.sb.from('order_qty').select('*').eq('hall_id', hallId));
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
  async createSentPos(hallId, _drafts, numbered) {
    const created = [];
    for (const d of numbered) {
      const po = ok(await this.sb.from('purchase_orders').insert({
        num: d.num, hall_id: hallId, vendor_id: d.vendor_id, status: 'sent',
        subtotal: d.subtotal, tax: d.tax, total: d.total, sent_at: new Date().toISOString(),
      }).select().single());
      ok(await this.sb.from('po_lines').insert(d.lines.map((l) => ({ po_id: po.id, ...l }))));
      const boxes = d.lines.flatMap((l) =>
        Array.from({ length: l.qty }, () => ({
          hall_id: hallId, product_id: l.product_id, po_id: po.id, cost: l.cost, state: 'on_order',
        })));
      ok(await this.sb.from('boxes').insert(boxes));
      created.push(po);
    }
    return created;
  }
  async getPos(hallId) { return ok(await this.sb.from('purchase_orders').select('*').eq('hall_id', hallId).order('created_at', { ascending: false })); }
  async getPoLines(poId) { return ok(await this.sb.from('po_lines').select('*').eq('po_id', poId)); }
  async setPoStatus(poId, status) { ok(await this.sb.from('purchase_orders').update({ status }).eq('id', poId)); }

  // ---- boxes ----
  async getBoxes(hallId) { return ok(await this.sb.from('boxes').select('*').eq('hall_id', hallId)); }
  async updateBox(id, fields) { return ok(await this.sb.from('boxes').update(fields).eq('id', id).select().single()); }
  async transitionBox(id, toState) {
    // the DB trigger stamps timestamps + rejects illegal transitions
    return ok(await this.sb.from('boxes').update({ state: toState }).eq('id', id).select().single());
  }
  async createBoxes(list) { return ok(await this.sb.from('boxes').insert(list).select()); }
  async setBoxSession(ids, tag) { ok(await this.sb.from('boxes').update({ session_tag: tag }).in('id', ids)); }

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
  async getPayments(hallId) { return ok(await this.sb.from('payments').select('*').eq('hall_id', hallId).order('created_at', { ascending: false })); }
  async addPayment(p) { return ok(await this.sb.from('payments').insert(p).select().single()); }
  async setPaymentStatus(id, status) { ok(await this.sb.from('payments').update({ status }).eq('id', id)); }

  // ---- emails: real sending via the send-email edge function ----
  async sendEmails(list, hallId) {
    const settings = await this.getSetting('email');
    const { data, error } = await this.sb.functions.invoke('send-email', {
      body: { emails: list, hall_id: hallId, settings },
    });
    if (error) throw new Error('send-email failed: ' + error.message);
    return data.logs;
  }
  async getEmails(hallId) { return ok(await this.sb.from('emails').select('*').eq('hall_id', hallId).order('created_at', { ascending: false })); }

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
