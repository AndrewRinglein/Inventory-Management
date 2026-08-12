// Demo store: full app behavior with data in this browser's localStorage.
// Lets the app run before Supabase is set up, and doubles as the training/demo sandbox.

import { CATALOG } from '../../data/catalog.js';
import { perBoxValue } from '../logic/pricing.js';
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
  async createSentPos(hallId, drafts, numbered, opts = {}) {
    // numbered: [{...draft, num}] — numbering handled by caller via settings po_sequence
    // opts.recordedOnly: placed outside this system, no email follows.
    // opts.placedAt: backdate it (and its boxes) to the day it was really placed.
    const { recordedOnly = false, placedAt = null, vendorRef = '' } = opts;
    const when = placedAt || new Date().toISOString();
    const created = [];
    for (const d of numbered) {
      const po = {
        id: uid(), num: d.num, hall_id: hallId, vendor_id: d.vendor_id, status: 'sent',
        subtotal: d.subtotal, tax: d.tax, total: d.total,
        price_tbd_lines: d.lines.filter((l) => l.price_tbd).length,
        sent_at: when, created_at: when,
        recorded_only: recordedOnly, vendor_ref: vendorRef || null,
      };
      this.db.purchase_orders.push(po);
      for (const l of d.lines) {
        const { per_box_cost, ...rec } = l;
        const split_boxes = l.split_boxes;
        this.db.po_lines.push({ id: uid(), po_id: po.id, ...rec });
        if (l.kind === 'fee' || !l.product_id) continue;   // packing charge: no boxes
        for (let i = 0; i < l.qty * (split_boxes || 1); i++) {
          this.db.boxes.push({
            id: uid(), hall_id: hallId, product_id: l.product_id, po_id: po.id,
            shipment_id: null, serial: '', cost: per_box_cost ?? l.cost, price_tbd: !!l.price_tbd, state: 'on_order',
            session_tag: null, ordered_at: when,
            received_at: null, opened_at: null, sold_out_at: null,
          });
        }
      }
      this._event(recordedOnly ? 'po.record' : 'insert', 'purchase_orders', po.num,
        recordedOnly ? { label: `Recorded PO ${po.num} (no email sent)`, placed_at: when, vendor_ref: vendorRef || null } : {});
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

  async repricePo(poId, lines, totals) {
    for (const l of lines) {
      const row = this.db.po_lines.find((x) => x.id === l.id);
      if (row) Object.assign(row, {
        cost: l.cost, base_cost: l.base_cost, pack_units: l.pack_units,
        packing_each: l.packing_each, price_tbd: !!l.price_tbd,
      });
    }
    const po = this.db.purchase_orders.find((p) => p.id === poId);
    Object.assign(po, {
      subtotal: totals.subtotal, tax: totals.tax, total: totals.total,
      price_tbd_lines: lines.filter((l) => l.price_tbd).length,
    });
    for (const l of lines) {
      if (!l.product_id || l.kind === 'fee') continue;
      const per = l.split_boxes > 1 ? Math.round((l.cost / l.split_boxes) * 100) / 100 : l.cost;
      for (const b of this.db.boxes) {
        if (b.po_id === poId && b.product_id === l.product_id && b.state === 'on_order') {
          b.cost = per; b.price_tbd = !!l.price_tbd;
        }
      }
    }
    this._event('po.reprice', 'purchase_orders', po.num, { label: `Repriced PO ${po.num}`, total: po.total });
    this._save();
    return po;
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
          cost: perBoxValue(product), serial: '', session_tag: null,
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

  // ---- adjustments with a reason ---- (mirrors supabaseStore)
  async addAdjustment({ hallId, reason, note, lines, actor = 'demo' }) {
    const clean = (lines || []).filter((l) => l.product_id && Number(l.delta));
    if (!clean.length) throw new Error('An adjustment needs at least one game and a count');
    if (!String(note || '').trim()) throw new Error('An adjustment needs a note saying why');
    const head = { id: uid(), hall_id: hallId, at: new Date().toISOString(),
                   reason, note: String(note).trim(), actor };
    (this.db.stock_adjustments ||= []).push(head);
    const names = {};
    for (const l of clean) {
      const p = this.db.products.find((x) => x.id === l.product_id);
      if (!p) throw new Error('Unknown game on an adjustment line');
      names[l.product_id] = p.name;
      const lineHall = l.hall_id || hallId;
      const each = perBoxValue(p);
      const n = Math.abs(Number(l.delta));
      (this.db.stock_adjustment_lines ||= []).push({
        id: uid(), adjustment_id: head.id, hall_id: lineHall,
        product_id: p.id, delta: Number(l.delta), each_value: each });
      if (Number(l.delta) > 0) {
        for (let i = 0; i < n; i++) this.db.boxes.push({
          id: uid(), hall_id: lineHall, product_id: p.id, state: 'in_inventory',
          cost: each, serial: '', session_tag: null, adjustment_id: head.id,
          received_at: new Date().toISOString() });
      } else {
        const pool = this.db.boxes.filter((b) => b.hall_id === lineHall
          && b.product_id === p.id && b.state === 'in_inventory');
        pool.sort((a, b) => (a.session_tag ? 1 : 0) - (b.session_tag ? 1 : 0));
        if (pool.length < n) throw new Error(`Only ${pool.length} ${p.name} in stock — cannot take ${n} off`);
        for (const b of pool.slice(0, n)) { b.state = 'missing'; b.adjustment_id = head.id; }
      }
    }
    const parts = clean.map((l) => `${Number(l.delta) > 0 ? '+' : '−'}${Math.abs(Number(l.delta))} ${names[l.product_id]}`);
    this._event('adjust', 'stock_adjustments', head.id, {
      label: `${hallId === 'sc' ? 'Santa Clara' : 'Redwood City'} — ${reason}: ${parts.join(', ')}`,
      note: head.note, reason, hall: hallId });
    this._save();
    return head;
  }

  async getAdjustments(hallId) {
    const heads = (this.db.stock_adjustments || []).filter((a) => a.hall_id === hallId);
    const byId = Object.fromEntries(heads.map((h) => [h.id, h]));
    return (this.db.stock_adjustment_lines || [])
      .filter((l) => byId[l.adjustment_id])
      .map((l) => {
        const a = byId[l.adjustment_id];
        const p = this.db.products.find((x) => x.id === l.product_id) || {};
        return { ...a, ...l, booked_hall: a.hall_id, hall_id: l.hall_id,
                 game: p.name, game_type: p.type,
                 value_change: Math.round(l.delta * l.each_value * 100) / 100 };
      })
      .sort((x, y) => String(y.at).localeCompare(String(x.at)));
  }

  // ---- session use ---- (demo mirror of the Supabase implementation)
  async getSessions() { return [...(this.db.sessions || [])]; }
  async getSessionPlays(sessionId) { return (this.db.session_plays || []).filter((p) => p.session_id === sessionId); }
  async getAllSessionPlays() { return [...(this.db.session_plays || [])]; }

  async applySession(sessionId, plays) {
    const sess = (this.db.sessions || []).find((x) => x.id === sessionId);
    if (!sess) throw new Error('Session not found');
    if (sess.applied_at) throw new Error('That session has already been taken out of stock.');
    if (sess.historical) {
      throw new Error('That session is historical — it is there for run-rate history, '
        + 'not for stock. Nothing to take off the shelf.');
    }
    // mirrors supabaseStore: applied_at is stamped last, so a run that died partway
    // leaves boxes consumed and the flag clear. The boxes are the durable record.
    if ((this.db.boxes || []).some((b) => b.session_id === sessionId)) {
      throw new Error('This session was partly applied before and stopped midway. '
        + 'Undo it first, then apply it again — otherwise the stock gets taken off twice.');
    }
    const want = {};
    for (const p of plays) if (p.product_id) want[p.product_id] = (want[p.product_id] || 0) + p.qty;
    const short = []; let moved = 0, invented = 0;
    const tag = `${sess.session_date}${sess.part ? ' ' + sess.part : ''}`;
    const now = new Date().toISOString();
    for (const [pid, n] of Object.entries(want)) {
      // opened-on-the-floor boxes are the ones the sheet means; take them first
      const avail = this.db.boxes.filter((b) => b.hall_id === sess.hall_id
        && b.product_id === pid && !b.session_id
        && (b.state === 'opened' || b.state === 'in_inventory'));
      const pool = [...avail.filter((b) => b.state === 'opened'),
                    ...avail.filter((b) => b.state === 'in_inventory')].slice(0, n);
      for (const b of pool) {
        b.state = 'sold_out'; b.session_id = sessionId;
        b.opened_session = b.opened_session || tag;
        b.opened_at = b.opened_at || now; b.sold_out_at = now;
        moved++;
      }
      const gap = n - pool.length;
      if (gap > 0) {
        short.push({ product_id: pid, wanted: n, found: pool.length, invented: gap });
        const p = this.db.products.find((x) => x.id === pid) || {};
        const each = Math.round(((Number(p.base_cost) || 0) * Math.max(1, p.pack_units || 1)
          / Math.max(1, p.split_boxes || 1)) * 100) / 100;
        for (let i = 0; i < gap; i++) {
          this.db.boxes.push({
            id: uid(), hall_id: sess.hall_id, product_id: pid, state: 'sold_out',
            unrecorded: true, session_id: sessionId, cost: each, serial: '',
            opened_session: tag, opened_at: now, sold_out_at: now, received_at: null,
          });
        }
        invented += gap;
      }
    }
    sess.applied_at = now;
    this._event('session.apply', 'sessions', sessionId, { moved, invented, short: short.length });
    this._save();
    return { session: sess, moved, invented, short };
  }

  async undoSession(sessionId) {
    const sess = (this.db.sessions || []).find((x) => x.id === sessionId);
    const mine = this.db.boxes.filter((b) => b.session_id === sessionId);
    const real = mine.filter((b) => !b.unrecorded);
    for (const b of real) {
      b.state = 'in_inventory'; b.session_id = null; b.opened_session = null;
      b.opened_at = null; b.sold_out_at = null;
    }
    this.db.boxes = this.db.boxes.filter((b) => !(b.session_id === sessionId && b.unrecorded));
    if (sess) sess.applied_at = null;
    this._event('session.undo', 'sessions', sessionId, { restored: real.length, removed: mine.length - real.length });
    this._save();
    return { session: sess, restored: real.length, removed: mine.length - real.length };
  }

  async setPlayProduct(playId, productId) {
    const p = (this.db.session_plays || []).find((x) => x.id === playId);
    if (p) Object.assign(p, { product_id: productId, match_how: 'confirmed', match_score: 1 });
    if (p) await this.learnAlias(productId, p.name_raw);
    this._save();
    return p;
  }

  /** Mirrors supabaseStore: a hand-made match teaches the catalog that name. */
  async learnAlias(productId, raw) {
    const name = String(raw || '').trim();
    const prod = (this.db.products || []).find((x) => x.id === productId);
    if (!name || !prod) return;
    const key = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const known = [prod.name, ...(prod.aliases || [])].map(key);
    if (known.includes(key(name))) return;
    prod.aliases = [...(prod.aliases || []), name].slice(-12);
    this._save();
  }

  // ---- session assignments ---- (demo mirror)
  async getAssignments(hallId) {
    const mine = new Set((this.db.sessions || []).filter((s) => s.hall_id === hallId).map((s) => s.id));
    return (this.db.session_assignments || []).filter((a) => mine.has(a.session_id));
  }
  async ensureSession({ hallId, date, part = '' }) {
    this.db.sessions ||= [];
    const found = this.db.sessions.find((s) => s.hall_id === hallId && s.session_date === date && (s.part || '') === part);
    if (found) return found;
    const [y, m, d] = date.split('-').map(Number);
    const row = { id: uid(), hall_id: hallId, session_date: date, part,
      weekday: new Date(y, m - 1, d, 12).toLocaleDateString('en-US', { weekday: 'long' }),
      applied_at: null, source_file: null };
    this.db.sessions.push(row); this._save();
    return row;
  }
  async setAssignments(sessionId, productIds) {
    this.db.session_assignments ||= [];
    const want = [...new Set(productIds)];
    const have = this.db.session_assignments.filter((a) => a.session_id === sessionId);
    const added = want.filter((pid) => !have.some((a) => a.product_id === pid));
    const removed = have.filter((a) => !want.includes(a.product_id));
    this.db.session_assignments = this.db.session_assignments
      .filter((a) => a.session_id !== sessionId || want.includes(a.product_id));
    for (const pid of added) {
      this.db.session_assignments.push({ id: uid(), session_id: sessionId, product_id: pid });
    }
    this._event('session.assign', 'sessions', sessionId, { total: want.length });
    this._save();
    return { total: want.length, added: added.length, removed: removed.length };
  }

  // ---- deliveries ---- (demo mirror)
  async getDeliveries(hallId) { return (this.db.deliveries || []).filter((d) => d.hall_id === hallId); }

  /** Mirrors supabaseStore: shipments and deliveries are both arrivals. */
  async getArrivals(hallId) {
    const pos = Object.fromEntries((this.db.purchase_orders || []).map((p) => [p.id, p]));
    const fromShip = (this.db.shipments || [])
      .filter((sh) => pos[sh.po_id]?.hall_id === hallId)
      .map((sh) => ({
        id: sh.id, source: 'shipment', hall_id: hallId,
        received_at: String(sh.received_at).slice(0, 10), received_ts: sh.received_at,
        vendor_id: pos[sh.po_id].vendor_id, po_id: sh.po_id, po_ref: pos[sh.po_id].num,
        invoice_no: sh.invoice_no || null, note: sh.notes || null,
        boxes: (this.db.boxes || []).filter((b) => b.po_id === sh.po_id && b.state !== 'on_order').length,
      }));
    const fromDel = (this.db.deliveries || []).filter((d) => d.hall_id === hallId).map((d) => ({
      ...d, source: 'delivery', received_ts: d.received_at,
      boxes: (this.db.boxes || []).filter((b) => b.delivery_id === d.id).length,
    }));
    return [...fromShip, ...fromDel]
      .sort((a, b) => String(b.received_ts).localeCompare(String(a.received_ts)));
  }
  async addDelivery({ hallId, vendorId, receivedAt, poId = null, poRef = '', invoiceNo = '', note = '', lines }) {
    this.db.deliveries ||= [];
    const del = { id: uid(), hall_id: hallId, vendor_id: vendorId, received_at: receivedAt,
      po_id: poId, po_ref: poRef || null, invoice_no: invoiceNo || null, note: note || null,
      created_at: new Date().toISOString() };
    this.db.deliveries.push(del);
    let claimed = 0, created = 0;
    for (const l of lines) {
      let left = Math.max(0, parseInt(l.qty) || 0);
      if (!left) continue;
      if (poId) {
        for (const b of this.db.boxes) {
          if (left <= 0) break;
          if (b.po_id === poId && b.product_id === l.product_id && b.state === 'on_order') {
            b.state = 'in_inventory'; b.delivery_id = del.id; b.received_at = receivedAt;
            claimed++; left--;
          }
        }
      }
      const p = this.db.products.find((x) => x.id === l.product_id) || {};
      const each = Math.round(((Number(p.base_cost) || 0) * Math.max(1, p.pack_units || 1)
        / Math.max(1, p.split_boxes || 1)) * 100) / 100;
      for (let i = 0; i < left; i++) {
        this.db.boxes.push({ id: uid(), hall_id: hallId, product_id: l.product_id,
          state: 'in_inventory', delivery_id: del.id, po_id: poId, cost: each,
          price_tbd: !(each > 0), received_at: receivedAt, serial: '' });
        created++;
      }
    }
    if (poId) {
      const left = this.db.boxes.some((b) => b.po_id === poId && b.state === 'on_order');
      const po = this.db.purchase_orders.find((x) => x.id === poId);
      if (po) po.status = left ? 'partial' : 'closed';
    }
    this._event('delivery.add', 'deliveries', del.id, { claimed, created, po_ref: poRef });
    this._save();
    return { delivery: del, claimed, created, total: claimed + created };
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
  // mirrors supabaseStore.getEvents — raw audit rows are forensics, not activity
  async getEvents(limit = 200, { raw = false } = {}) {
    const rows = raw ? this.db.events
      : this.db.events.filter((e) => !['insert', 'update', 'delete'].includes(e.kind));
    return rows.slice(0, limit);
  }
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
