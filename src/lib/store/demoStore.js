// Demo store: full app behavior with data in this browser's localStorage.
// Lets the app run before Supabase is set up, and doubles as the training/demo sandbox.

import { CATALOG } from '../../data/catalog.js';
import { transition } from '../logic/boxes.js';

const uid = () => 'id_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export class DemoStore {
  isDemo = true;

  constructor(staged = false) {
    this.staged = staged;                                  // staged sandbox (?demo) vs plain local mode
    this.lsKey = staged ? 'bingo_inv_sandbox_v1' : 'bingo_inv_v1';
  }

  async init() {
    const raw = localStorage.getItem(this.lsKey);
    if (raw) {
      try { this.db = JSON.parse(raw); } catch { this.db = null; }
    }
    if (!this.db || !this.db.products) this.db = this.staged ? stagedSeed() : seed();
    this._save();
  }
  async resetDemo() {                                      // "Reset demo data" button
    this.db = this.staged ? stagedSeed() : seed();
    this._save();
  }
  _save() { try { localStorage.setItem(this.lsKey, JSON.stringify(this.db)); } catch {} }
  _event(kind, entity, entity_id, detail = {}) {
    this.db.events.unshift({ at: new Date().toISOString(), actor: 'demo', kind, entity, entity_id, detail });
    this.db.events = this.db.events.slice(0, 2000);
  }

  // ---- auth (demo: single password stored in settings) ----
  async signIn(_email, pass) {
    const ok = pass === (this.db.settings.demo_password || 'bingo');
    if (ok) {
      this.session = { email: 'demo@hall.local' };
      try { localStorage.setItem(this.lsKey + '_session', '1'); } catch {}
      return { ok: true };
    }
    return { ok: false, error: 'Wrong password (demo default: bingo)' };
  }
  async signOut() {
    this.session = null;
    try { localStorage.removeItem(this.lsKey + '_session'); } catch {}
  }
  async getSession() {
    if (!this.session) {
      try { if (localStorage.getItem(this.lsKey + '_session')) this.session = { email: 'demo@hall.local' }; } catch {}
    }
    return this.session || null;
  }

  // ---- catalog ----
  async getVendors() { return [...this.db.vendors]; }
  async getProducts() { return [...this.db.products]; }
  async updateProduct(id, fields) {
    const p = this.db.products.find((x) => x.id === id);
    if (!p) throw new Error('product not found');
    Object.assign(p, fields);
    this._event('update', 'products', id, { fields });
    this._save();
    return { ...p };
  }
  async addProduct(p) {
    const row = { id: 'C' + Date.now(), active: true, ...p };
    this.db.products.push(row);
    this._event('insert', 'products', row.id, {});
    this._save();
    return row;
  }
  async updateVendor(id, fields) {
    const v = this.db.vendors.find((x) => x.id === id);
    Object.assign(v, fields); this._save(); return { ...v };
  }

  // ---- order builder quantities ----
  async getOrderQty(hallId) { return { ...(this.db.order_qty[hallId] || {}) }; }
  async setOrderQty(hallId, productId, qty) {
    const h = (this.db.order_qty[hallId] ||= {});
    if (qty > 0) h[productId] = qty; else delete h[productId];
    this._save();
  }
  async clearOrderQty(hallId) { this.db.order_qty[hallId] = {}; this._save(); }

  // ---- purchase orders ----
  async createSentPos(hallId, drafts, numbered) {
    // numbered: [{...draft, num}] — numbering handled by caller via settings po_sequence
    const created = [];
    for (const d of numbered) {
      const po = {
        id: uid(), num: d.num, hall_id: hallId, vendor_id: d.vendor_id, status: 'sent',
        subtotal: d.subtotal, tax: d.tax, total: d.total,
        price_tbd_lines: d.lines.filter((l) => l.price_tbd).length,
        sent_at: new Date().toISOString(), created_at: new Date().toISOString(),
      };
      this.db.purchase_orders.push(po);
      for (const l of d.lines) {
        const { split_boxes, per_box_cost, ...rec } = l;
        this.db.po_lines.push({ id: uid(), po_id: po.id, ...rec });
        if (l.kind === 'fee' || !l.product_id) continue;   // packing charge: no boxes
        for (let i = 0; i < l.qty * (split_boxes || 1); i++) {
          this.db.boxes.push({
            id: uid(), hall_id: hallId, product_id: l.product_id, po_id: po.id,
            shipment_id: null, serial: '', cost: per_box_cost ?? l.cost, price_tbd: !!l.price_tbd, state: 'on_order',
            session_tag: null, ordered_at: new Date().toISOString(),
            received_at: null, opened_at: null, sold_out_at: null,
          });
        }
      }
      this._event('insert', 'purchase_orders', po.num, {});
      created.push(po);
    }
    this._save();
    return created;
  }
  async getPos(hallId) { return this.db.purchase_orders.filter((p) => p.hall_id === hallId); }
  async getPoLines(poId) { return this.db.po_lines.filter((l) => l.po_id === poId); }
  async setPoStatus(poId, status) {
    const po = this.db.purchase_orders.find((p) => p.id === poId);
    po.status = status;
    this._event('update', 'purchase_orders', po.num, { status });
    this._save();
  }

  async setPoArchived(poId, archived) {
    const po = this.db.purchase_orders.find((p) => p.id === poId);
    if (!po) throw new Error('That order is gone');
    po.archived_at = archived ? new Date().toISOString() : null;
    this._event(archived ? 'po.archive' : 'po.restore', 'purchase_orders', po.num, {
      label: `${po.hall_id === 'sc' ? 'Santa Clara' : 'Redwood City'} — ${archived ? 'archived' : 'restored'} PO ${po.num}`,
    });
    this._save();
    return po;
  }

  async deletePo(poId) {
    const po = this.db.purchase_orders.find((p) => p.id === poId);
    if (!po) throw new Error('That order is already gone');
    const mine = this.db.boxes.filter((b) => b.po_id === poId);
    const received = mine.filter((b) => b.state !== 'on_order');
    if (received.length) {
      throw new Error(`${received.length} box(es) on ${po.num} have already been received. Use "Close short" instead — deleting would remove stock that's on the shelf.`);
    }
    this.db.boxes = this.db.boxes.filter((b) => b.po_id !== poId);
    this.db.po_lines = this.db.po_lines.filter((l) => l.po_id !== poId);
    this.db.payments = this.db.payments.filter((x) => x.po_num !== po.num);
    this.db.purchase_orders = this.db.purchase_orders.filter((p) => p.id !== poId);
    this._event('po.delete', 'purchase_orders', po.num, {
      label: `${po.hall_id === 'sc' ? 'Santa Clara' : 'Redwood City'} — deleted PO ${po.num}`,
      total: po.total, vendor_id: po.vendor_id, boxes: mine.length,
    });
    this._save();
    return po;
  }

  // ---- boxes ----
  async getBoxes(hallId) { return this.db.boxes.filter((b) => b.hall_id === hallId); }
  async updateBox(id, fields) {
    const b = this.db.boxes.find((x) => x.id === id);
    Object.assign(b, fields); this._save(); return { ...b };
  }
  async transitionBox(id, toState) {
    const i = this.db.boxes.findIndex((x) => x.id === id);
    const next = transition(this.db.boxes[i], toState);   // throws on illegal move
    this.db.boxes[i] = next;
    this._event('box.state', 'boxes', id, { to: toState, product: next.product_id });
    this._save();
    return { ...next };
  }
  async createBoxes(list) {
    const rows = list.map((b) => ({ id: uid(), session_tag: null, ...b }));
    this.db.boxes.push(...rows); this._save(); return rows;
  }
  async setBoxSession(ids, tag) {
    for (const id of ids) {
      const b = this.db.boxes.find((x) => x.id === id);
      if (b) b.session_tag = tag;
    }
    this._save();
  }

  async adjustStock({ hallId, product, delta, note, label }) {
    const n = Math.abs(delta);
    if (!n) return;
    if (delta > 0) {
      for (let i = 0; i < n; i++) {
        this.db.boxes.push({
          id: uid(), hall_id: hallId, product_id: product.id, state: 'in_inventory',
          cost: Number(product.cost) || 0, serial: '', session_tag: null,
          ordered_at: new Date().toISOString(), received_at: new Date().toISOString(),
        });
      }
    } else {
      const pool = this.db.boxes.filter((b) => b.hall_id === hallId && b.product_id === product.id && b.state === 'in_inventory');
      pool.sort((a, b) => (a.session_tag ? 1 : 0) - (b.session_tag ? 1 : 0));   // untouched boxes first
      if (!pool.length) throw new Error('No boxes in stock to remove');
      for (const b of pool.slice(0, n)) b.state = 'missing';
    }
    this._event('adjust', 'products', product.id, { label, note, delta, hall: hallId });
    this._save();
  }

  // ---- receiving ----
  async createShipment(s) {
    const row = { id: uid(), confirmed: false, received_at: new Date().toISOString(), ...s };
    this.db.shipments.push(row); this._save(); return row;
  }
  async confirmShipment(id) {
    const s = this.db.shipments.find((x) => x.id === id);
    s.confirmed = true; this._save(); return s;
  }
  async getShipments(hallId) {
    const poIds = new Set(this.db.purchase_orders.filter((p) => p.hall_id === hallId).map((p) => p.id));
    return this.db.shipments.filter((s) => poIds.has(s.po_id));
  }
  async uploadInvoicePhoto(file) {
    // demo: keep as data URL in memory-limited slot
    const dataUrl = await new Promise((res) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file);
    });
    const path = 'demo/' + uid();
    (this.db.photos ||= {})[path] = dataUrl.slice(0, 500000);   // cap size in demo
    this._save();
    return path;
  }
  getPhotoUrl(path) { return (this.db.photos || {})[path] || null; }

  // ---- payments ----
  async getPayments(hallId) { return this.db.payments.filter((p) => p.hall_id === hallId); }
  async addPayment(p) {
    const row = { id: uid(), status: 'open', created_at: new Date().toISOString(), ...p };
    this.db.payments.push(row);
    this._event('insert', 'payments', row.id, { amount: p.amount });
    this._save(); return row;
  }
  async setPaymentStatus(id, status) {
    const p = this.db.payments.find((x) => x.id === id);
    p.status = status;
    this._event('update', 'payments', id, { status });
    this._save();
  }

  // ---- emails (demo: log only, clearly marked) ----
  async sendEmails(list, hallId) {
    const logs = list.map((e) => ({
      id: uid(), hall_id: hallId, po_num: e.po_num || null, kind: e.kind,
      to_addr: e.to, subject: e.subject, body: e.body,
      test_mode: true, provider_id: null,
      status: 'sent', created_at: new Date().toISOString(),
      demo_note: 'DEMO MODE — not actually sent',
    }));
    this.db.emails.push(...logs);
    this._event('emails.send', 'emails', String(list.length), {});
    this._save();
    return logs;
  }
  async getEmails(hallId) { return this.db.emails.filter((e) => e.hall_id === hallId); }

  // ---- settings / events ----
  async getSetting(key) { return this.db.settings[key]; }
  async setSetting(key, value) { this.db.settings[key] = value; this._save(); }
  async getEvents(limit = 200) { return this.db.events.slice(0, limit); }
  async logEvent(kind, entity, entity_id, detail = {}) { this._event(kind, entity, entity_id, detail); this._save(); }

  // ---- AI (demo stub: reads nothing, explains itself) ----
  async readInvoicePhoto() {
    return { demo: true, lines: [], note: 'AI invoice reading works once Supabase + the read-invoice function are set up. In demo mode, enter lines manually.' };
  }
}

// ---------------------------------------------------------------------------
// Staged sandbox seed (?demo): data at EVERY lifecycle stage so all screens
// demo well — POs sent/partial/closed, boxes in all states, open+paid invoices.
function stagedSeed() {
  const db = seed();
  const daysAgo = (d, h = 0) => new Date(Date.now() - d * 864e5 - h * 36e5).toISOString();
  const pmap = Object.fromEntries(db.products.map((p) => [p.id, p]));
  let serialN = 48800;
  const seq = {};

  const mkPo = (hall, vendor, status, sentDays, lines) => {
    const vc = { bv: 'BV', md: 'MD', cbs: 'CBS', pbf: 'PBF' }[vendor];
    const k = `${hall.toUpperCase()}-${vc}`;
    seq[k] = (seq[k] || 0) + 1;
    const d = new Date(Date.now() - sentDays * 864e5);
    const num = `${hall.toUpperCase()}-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${vc}-${String(seq[k]).padStart(3, '0')}`;
    const taxRate = db.vendors.find((v) => v.id === vendor).tax_rate;
    const subtotal = Math.round(lines.reduce((a, l) => a + l.qty * pmap[l.pid].cost, 0) * 100) / 100;
    const tax = Math.round(subtotal * taxRate * 100) / 100;
    const po = {
      id: uid(), num, hall_id: hall, vendor_id: vendor, status,
      subtotal, tax, total: Math.round((subtotal + tax) * 100) / 100,
      sent_at: daysAgo(sentDays), created_at: daysAgo(sentDays, 1),
    };
    db.purchase_orders.push(po);
    const ship = status !== 'sent'
      ? { id: uid(), po_id: po.id, invoice_no: 'INV-' + (7000 + serialN % 1000), notes: '', received_at: daysAgo(sentDays - 3), confirmed: true, invoice_photo_path: null }
      : null;
    if (ship) db.shipments.push(ship);
    for (const l of lines) {
      const p = pmap[l.pid];
      db.po_lines.push({
        id: uid(), po_id: po.id, product_id: l.pid, qty: l.qty, cost: p.cost,
        name_snapshot: p.name + (p.tickets ? ` (${p.tickets}/$${p.price_per_ticket || 1})` : ''),
      });
      const states = l.states || [];
      for (let i = 0; i < l.qty; i++) {
        const st = states[i] || (status === 'sent' ? 'on_order' : 'in_inventory');
        const received = st !== 'on_order' && st !== 'missing';
        db.boxes.push({
          id: uid(), hall_id: hall, product_id: l.pid, po_id: po.id,
          shipment_id: received && ship ? ship.id : null,
          serial: received ? `${vc}-${++serialN}` : '',
          cost: p.cost, state: st,
          session_tag: l.tags?.[i] || null,
          ordered_at: daysAgo(sentDays, 2),
          received_at: received ? daysAgo(sentDays - 3) : null,
          opened_session: st === 'opened' || st === 'sold_out' ? 'Friday' : null,
          opened_at: st === 'opened' || st === 'sold_out' ? daysAgo(sentDays - 5) : null,
          sold_out_at: st === 'sold_out' ? daysAgo(sentDays - 7 < 0 ? 0 : sentDays - 7) : null,
        });
      }
    }
    // email log
    const mail = (kind, to, subject) => db.emails.push({
      id: uid(), hall_id: hall, po_num: num, kind, to_addr: to, subject,
      body: '(demo email body)', test_mode: true, provider_id: null, status: 'sent', created_at: daysAgo(sentDays),
    });
    mail('po', 'vendor@example.com', `Purchase Order ${num}`);
    return po;
  };

  // --- Santa Clara: one closed, one partial, one still in transit ---
  const sc1 = mkPo('sc', 'bv', 'closed', 21, [
    { pid: 'P001', qty: 3, states: ['sold_out', 'opened', 'in_inventory'] },
    { pid: 'P006', qty: 2, states: ['in_inventory', 'in_inventory'], tags: [null, 'Friday'] },
    { pid: 'P012', qty: 2, states: ['opened', 'in_inventory'] },
  ]);
  const sc2 = mkPo('sc', 'md', 'partial', 9, [
    { pid: 'P200', qty: 3, states: ['in_inventory', 'in_inventory', 'on_order'] },
    { pid: 'P210', qty: 2, states: ['in_inventory', 'missing'] },
  ]);
  mkPo('sc', 'pbf', 'sent', 2, [
    { pid: 'P330', qty: 4 },
    { pid: 'P335', qty: 2 },
  ]);
  // --- Redwood City: smaller — one closed, one sent ---
  const rw1 = mkPo('rwc', 'cbs', 'closed', 14, [
    { pid: 'P311', qty: 2, states: ['opened', 'in_inventory'] },
    { pid: 'P312', qty: 2, states: ['sold_out', 'in_inventory'] },
  ]);
  mkPo('rwc', 'bv', 'sent', 1, [{ pid: 'P020', qty: 3 }]);

  // payments: paid, open, open-short
  const pay = (po, status, shortNote) => db.payments.push({
    id: uid(), hall_id: po.hall_id, vendor_id: po.vendor_id, po_num: po.num,
    invoice_no: 'INV-' + po.num.slice(-3), amount: po.total, status,
    created_at: po.sent_at,
  });
  pay(sc1, 'paid'); pay(sc2, 'open'); pay(rw1, 'open');

  // a half-built order in the SC builder
  db.order_qty.sc = { P003: 2, P205: 1 };

  // shortage + delivered emails for the partial PO
  db.emails.push(
    { id: uid(), hall_id: 'sc', po_num: sc2.num, kind: 'shortage', to_addr: 'vendor@example.com', subject: `Short delivery on PO ${sc2.num}`, body: '(demo)', test_mode: true, provider_id: null, status: 'sent', created_at: daysAgo(6) },
    { id: uid(), hall_id: 'sc', po_num: sc2.num, kind: 'delivered', to_addr: 'accounting@example.com', subject: `Delivered: PO ${sc2.num} (SHORT DELIVERY)`, body: '(demo)', test_mode: true, provider_id: null, status: 'sent', created_at: daysAgo(6) },
  );
  db.events.unshift(
    { at: daysAgo(0, 2), actor: 'demo', kind: 'box.state', entity: 'boxes', entity_id: 'demo', detail: {} },
    { at: daysAgo(1), actor: 'demo', kind: 'insert', entity: 'purchase_orders', entity_id: 'demo', detail: {} },
  );
  db.settings.po_sequence = seq;
  db.settings.email.accountingAddress = 'accounting@example.com';
  return db;
}

function seed() {
  return {
    vendors: CATALOG.vendors.map((v) => ({
      id: v.id, name: v.name, email: v.email || '', tax_rate: v.taxRate ?? 0.0975, active: true,
      contact_name: ({ bv: 'Scott', md: 'Esteban', pbf: 'Jordynn' })[v.id] || '',
    })),
    products: CATALOG.products.map((p) => ({
      id: p.id, vendor_id: p.vendor, name: p.name, orig_name: p.origName || '',
      type: p.type, cost: p.cost, tickets: p.tickets ?? null,
      price_per_ticket: p.price ?? 1, active: true,
    })),
    order_qty: { sc: {}, rwc: {} },
    purchase_orders: [], po_lines: [], shipments: [], boxes: [],
    payments: [], emails: [], events: [], photos: {},
    settings: {
      email: { testMode: true, testAddress: '', fromAddress: '', accountingAddress: '' },
      po_sequence: {},
      admin_pin: { pin: '1234' },
      halls_config: { sc: { address: '' }, rwc: { address: '' } },
      demo_password: 'bingo',
      sender: {
        sc: { name: 'Sagit', org: 'Vanguard', title: '', phone: '', replyTo: '' },
        rwc: { name: 'Shelly', org: 'Vanguard', title: '', phone: '', replyTo: '' },
      },
    },
  };
}
