// Supabase-backed store — same interface as DemoStore.
// Activated automatically when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set in .env.

import { createClient } from '@supabase/supabase-js';
import { senderFor } from '../logic/emails.js';
import { perBoxValue } from '../logic/pricing.js';
import { round2 } from '../logic/po.js';
import { wantedFromPlays, consumeOrder, writeOffCost, ShortfallError } from '../logic/session.js';

const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

const HALLS = { sc: 'Santa Clara', rwc: 'Redwood City' };

/** "Santa Clara — swapped 1 Whole Enchiladas for 1 American Heroes" */
function adjustmentLabel(hallId, reason, lines, prods) {
  const nm = (l) => prods[l.product_id]?.name || l.product_id;
  const out = lines.filter((l) => Number(l.delta) < 0);
  const inn = lines.filter((l) => Number(l.delta) > 0);
  const list = (xs) => xs.map((l) => `${Math.abs(Number(l.delta))} ${nm(l)}`).join(' and ');
  const hall = HALLS[hallId] || hallId;
  if (reason === 'swap' && out.length && inn.length) {
    return `${hall} — swapped ${list(out)} for ${list(inn)}`;
  }
  if (reason === 'transfer') {
    const to = lines.find((l) => Number(l.delta) > 0);
    return `${hall} — transferred ${list(out.length ? out : inn)}`
      + (to?.hall_id && to.hall_id !== hallId ? ` to ${HALLS[to.hall_id] || to.hall_id}` : '');
  }
  const word = { damaged: 'wrote off', miscount: 'recounted', found: 'found',
                 returned: 'returned to the distributor' }[reason] || 'adjusted';
  const all = [...out, ...inn];
  return `${hall} — ${word} ${list(all)}`;
}

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
  /**
   * Update a product — and never let a rename cost us a match.
   *
   * Session sheets are typed by hand and say what they have always said. The
   * matcher tries the name first, then the aliases, so renaming a game in the
   * catalogue silently stops its sheet lines matching: every one drops into the
   * unmatched pile for somebody to key in by hand, and nothing warns you. Renaming
   * "In Laws" to "In Laws - Strip" is enough to do it.
   *
   * So the old name is kept as an alias automatically, every time. The rename is
   * still a rename — screens, POs and emails all show the new name — but the old
   * spelling goes on matching for as long as the sheets keep using it.
   */
  async updateProduct(id, fields) {
    const patch = { ...fields };
    if (patch.name != null) {
      const cur = ok(await this.sb.from('products').select('name,aliases').eq('id', id).maybeSingle());
      const old = (cur?.name || '').trim();
      const next = String(patch.name).trim();
      if (old && old !== next) {
        const have = cur?.aliases || [];
        // case-insensitive, so re-casing a name does not pile up near-duplicates
        const key = (v) => v.trim().toLowerCase();
        if (!have.some((a) => key(a) === key(old))) patch.aliases = [...have, old];
      }
    }
    return ok(await this.sb.from('products').update(patch).eq('id', id).select().single());
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
      // per_box_cost is derived at receiving time; the price parts are kept so this
      // PO can be reprinted years later exactly as the vendor received it
      ok(await this.sb.from('po_lines').insert(
        d.lines.map(({ per_box_cost, ...l }) => ({ po_id: po.id, ...l }))));
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

  /** Write re-quoted lines and totals back onto an existing PO, keeping its number. */
  async repricePo(poId, lines, totals) {
    for (const l of lines) {
      ok(await this.sb.from('po_lines').update({
        cost: l.cost, base_cost: l.base_cost, pack_units: l.pack_units,
        packing_each: l.packing_each, price_tbd: !!l.price_tbd,
      }).eq('id', l.id));
    }
    const po = ok(await this.sb.from('purchase_orders').update({
      subtotal: totals.subtotal, tax: totals.tax, total: totals.total,
      price_tbd_lines: lines.filter((l) => l.price_tbd).length,
    }).eq('id', poId).select().single());
    // boxes still on order carry the old price; bring them along
    for (const l of lines) {
      if (!l.product_id || l.kind === 'fee') continue;
      const per = l.split_boxes > 1 ? Math.round((l.cost / l.split_boxes) * 100) / 100 : l.cost;
      ok(await this.sb.from('boxes').update({ cost: per, price_tbd: !!l.price_tbd })
        .eq('po_id', poId).eq('product_id', l.product_id).eq('state', 'on_order'));
    }
    await this.logEvent('po.reprice', 'purchase_orders', po.num, {
      label: `${po.hall_id === 'sc' ? 'Santa Clara' : 'Redwood City'} — repriced PO ${po.num} to ${totals.total}`,
      total: po.total,
    });
    return po;
  }

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
        hall_id: hallId, product_id: product.id, state: 'in_inventory', location: 'hall',
        cost: perBoxValue(product), serial: '', received_at: new Date().toISOString(),
      }));
      ok(await this.sb.from('boxes').insert(rows));
    } else {
      // ON THE FLOOR. An adjustment describes something that happened to stock
      // in this hall — damaged, miscounted, found. Without this filter the write
      // reached into boxes a distributor is holding: the operator writes off four
      // that went missing here, four vendor boxes get marked missing instead, the
      // floor count does not move, and they do it again until off-site drains.
      const pool = ok(await this.sb.from('boxes').select('id')
        .eq('hall_id', hallId).eq('product_id', product.id).eq('state', 'in_inventory')
        .eq('location', 'hall')
        .is('session_tag', null).limit(n));
      const ids = pool.map((b) => b.id);
      if (ids.length < n) {   // fall back to set-aside boxes only if we must
        const extra = ok(await this.sb.from('boxes').select('id')
          .eq('hall_id', hallId).eq('product_id', product.id).eq('state', 'in_inventory')
          .eq('location', 'hall')
          .not('session_tag', 'is', null).limit(n - ids.length));
        ids.push(...extra.map((b) => b.id));
      }
      // Do not silently under-apply. Taking two off when five were asked for and
      // logging delta -5 makes the history claim something that did not happen —
      // addAdjustment already refuses in this situation, and the two entry points
      // must not disagree.
      if (!ids.length) throw new Error('No boxes in stock to remove');
      if (ids.length < n) {
        throw new Error(`Only ${ids.length} on the floor — cannot take ${n} off.`
          + ` Anything held off-site has to be brought in first.`);
      }
      ok(await this.sb.from('boxes').update({ state: 'missing' }).in('id', ids));
    }
    await this.logEvent('adjust', 'products', product.id, { label, note, delta, hall: hallId });
  }

  // ---- adjustments with a reason ----
  //
  // The shape that matters is the SWAP: a distributor is out of one game and
  // hands over another. Recorded as two separate adjustments those rows only
  // connect in the head of whoever typed both, and reversing one leaves the
  // other lying. So an adjustment is a header with a reason and a note, plus one
  // line per product — a swap is one line out and one line in, a transfer is the
  // same with a different hall on each line.
  //
  // Counts are deliberately not required to balance. Distributors hand over two
  // of something for one of something else all the time, and a rule that forces
  // a match just teaches people to enter numbers that aren't true.
  async addAdjustment({ hallId, reason, note, lines, actor = 'app' }) {
    const clean = (lines || []).filter((l) => l.product_id && Number(l.delta));
    if (!clean.length) throw new Error('An adjustment needs at least one game and a count');
    if (!String(note || '').trim()) throw new Error('An adjustment needs a note saying why');

    const ids = [...new Set(clean.map((l) => l.product_id))];
    const prods = Object.fromEntries(
      (ok(await this.sb.from('products').select('*').in('id', ids))).map((p) => [p.id, p]));

    const head = ok(await this.sb.from('stock_adjustments').insert({
      hall_id: hallId, reason, note: String(note).trim(), actor,
    }).select().single());

    try {
      for (const l of clean) {
        const p = prods[l.product_id];
        if (!p) throw new Error('Unknown game on an adjustment line');
        const lineHall = l.hall_id || hallId;
        const each = perBoxValue(p);
        const n = Math.abs(Number(l.delta));
        ok(await this.sb.from('stock_adjustment_lines').insert({
          adjustment_id: head.id, hall_id: lineHall, product_id: p.id,
          delta: Number(l.delta), each_value: each,
        }).select('id'));

        if (Number(l.delta) > 0) {
          ok(await this.sb.from('boxes').insert(Array.from({ length: n }, () => ({
            hall_id: lineHall, product_id: p.id, state: 'in_inventory', cost: each,
            serial: '', received_at: new Date().toISOString(), adjustment_id: head.id,
          }))).select('id'));
        } else {
          // prefer boxes not set aside for a session, same as adjustStock
          const free = ok(await this.sb.from('boxes').select('id')
            .eq('hall_id', lineHall).eq('product_id', p.id).eq('state', 'in_inventory')
            .eq('location', 'hall')                       // floor only — see adjustStock
            .is('session_tag', null).limit(n));
          const pick = free.map((b) => b.id);
          if (pick.length < n) {
            const extra = ok(await this.sb.from('boxes').select('id')
              .eq('hall_id', lineHall).eq('product_id', p.id).eq('state', 'in_inventory')
              .eq('location', 'hall')
              .not('session_tag', 'is', null).limit(n - pick.length));
            pick.push(...extra.map((b) => b.id));
          }
          if (pick.length < n) {
            throw new Error(`Only ${pick.length} ${p.name} in stock — cannot take ${n} off`);
          }
          ok(await this.sb.from('boxes').update({ state: 'missing', adjustment_id: head.id })
            .in('id', pick));
        }
      }
    } catch (e) {
      // a half-written adjustment is worse than none: undo the header and its
      // lines (boxes created so far cascade off nothing, so clear them first)
      ok(await this.sb.from('boxes').delete().eq('adjustment_id', head.id).eq('state', 'in_inventory'));
      ok(await this.sb.from('boxes').update({ state: 'in_inventory', adjustment_id: null })
        .eq('adjustment_id', head.id).eq('state', 'missing'));
      ok(await this.sb.from('stock_adjustments').delete().eq('id', head.id));
      throw e;
    }

    await this.logEvent('adjust', 'stock_adjustments', head.id, {
      label: adjustmentLabel(hallId, reason, clean, prods),
      note: String(note).trim(), reason,
      lines: clean.map((l) => ({ product: prods[l.product_id]?.name, delta: Number(l.delta) })),
      hall: hallId,
    });
    return head;
  }

  async getAdjustments(hallId, limit = 300) {
    return fetchAll(() => this.sb.from('adjustment_history').select('*')
      .eq('hall_id', hallId).order('at', { ascending: false }).limit(limit));
  }

  // ---- session use ----
  //
  // A session records what the count sheets say was played. Nothing leaves stock
  // until someone applies it, because the sheet and the shelf disagree often
  // enough that the gap has to be looked at rather than silently absorbed.
  async getSessions() {
    return fetchAll(() => this.sb.from('sessions').select('*')
      .order('session_date', { ascending: false }).order('part'));
  }
  async getSessionPlays(sessionId) {
    return fetchAll(() => this.sb.from('session_plays').select('*').eq('session_id', sessionId).order('name_raw'));
  }
  /** Every play across every session — enough to draw the cards without N queries. */
  async getAllSessionPlays() {
    return fetchAll(() => this.sb.from('session_plays').select('*'));
  }

  /**
   * Take a session's boxes out of stock.
   *
   * in_inventory -> opened -> sold_out, one box at a time, because that is the
   * lifecycle every other screen already understands and the database enforces it.
   * Each box is stamped with the session, which is what makes undo exact rather
   * than a guess at which boxes to put back.
   *
   * Short lines STOP the run. If the shelf holds four and the sheet says eight,
   * nothing moves and the caller is told which games are short and by how much.
   * Writing the difference off as never-received boxes is still possible, but
   * only when the caller passes { allowShort: true } — a deliberate answer to a
   * question, rather than something that happens silently on the way past.
   */
  async applySession(sessionId, plays, opts = {}) {
    const sess = ok(await this.sb.from('sessions').select('*').eq('id', sessionId).single());
    if (sess.applied_at) throw new Error('That session has already been taken out of stock.');
    // Historical programmes describe play from before the system held inventory.
    // The stock they came from was never recorded, so applying one would invent
    // consumption against today's shelf. The database enforces this too.
    if (sess.historical) {
      throw new Error('That session is historical — it is there for run-rate history, '
        + 'not for stock. Nothing to take off the shelf.');
    }
    // applied_at is stamped at the END, so a run that dies partway — a dropped
    // connection, a closed laptop — leaves boxes consumed and the session still
    // looking unapplied. Pressing apply again would take a SECOND box off the
    // shelf for every line that had already gone through. The boxes themselves
    // are the durable record of that, so ask them, not the flag.
    const already = ok(await this.sb.from('boxes').select('id').eq('session_id', sessionId).limit(1));
    if (already.length) {
      throw new Error('This session was partly applied before and stopped midway. '
        + 'Undo it first, then apply it again — otherwise the stock gets taken off twice.');
    }
    const want = wantedFromPlays(plays);
    const prods = Object.fromEntries(
      (ok(await this.sb.from('products').select('*').in('id', Object.keys(want).length ? Object.keys(want) : ['-'])))
        .map((p) => [p.id, p]));

    // COUNT FIRST, MOVE SECOND. The old loop consumed each game as it went and
    // only discovered a shortfall when it reached one, so a session that was
    // short on its last game had already taken every earlier game off the shelf.
    // Nothing is written until every line is known to be satisfiable.
    const pools = {};
    const short = [];
    for (const [pid, n] of Object.entries(want)) {
      // Boxes opened on the floor during play are exactly the ones the count sheet
      // is reporting, so take those FIRST. Looking only at in_inventory destroyed
      // untouched shelf stock, invented a shortfall for boxes that were right
      // there, and left the real ones stuck open forever.
      const pool = ok(await this.sb.from('boxes').select('id,state')
        .eq('hall_id', sess.hall_id).eq('product_id', pid)
        .in('state', ['opened', 'in_inventory'])
        // ON THE FLOOR ONLY. A session cannot play a box a distributor is still
        // holding, and letting it try would turn owned-but-elsewhere stock into
        // phantom consumption — the shortfall would vanish and the off-site
        // count would silently drain.
        .eq('location', 'hall')
        .is('session_id', null)
        .order('state', { ascending: true })            // 'in_inventory' < 'opened' alphabetically…
        .order('received_at', { nullsFirst: true })
        .limit(n * 2));
      pools[pid] = consumeOrder(pool, n);               // …so re-order explicitly: opened first
      if (pools[pid].length < n) {
        short.push({ product_id: pid, wanted: n, found: pools[pid].length, invented: n - pools[pid].length });
      }
    }
    if (short.length && !opts.allowShort) {
      throw new ShortfallError(short,
        Object.fromEntries(Object.values(prods).map((p) => [p.id, p.name])));
    }

    let moved = 0, invented = 0;
    for (const [pid, n] of Object.entries(want)) {
      const ordered = pools[pid];
      for (const b of ordered) {
        if (b.state === 'in_inventory') {
          ok(await this.sb.from('boxes').update({ state: 'opened', session_id: sessionId,
            opened_session: `${sess.session_date}${sess.part ? ' ' + sess.part : ''}` }).eq('id', b.id));
        } else {
          ok(await this.sb.from('boxes').update({ session_id: sessionId }).eq('id', b.id));
        }
        ok(await this.sb.from('boxes').update({ state: 'sold_out' }).eq('id', b.id));
        moved++;
      }
      // The caller has accepted the shortfall. Record the difference as
      // never-received boxes so the ledger still balances and the gap stays
      // countable — but it is now an accepted write-off, not a silent one.
      const gap = n - ordered.length;
      if (gap > 0) {
        const each = writeOffCost(prods[pid]);
        const now = new Date().toISOString();
        ok(await this.sb.from('boxes').insert(Array.from({ length: gap }, () => ({
          hall_id: sess.hall_id, product_id: pid, state: 'sold_out', unrecorded: true,
          session_id: sessionId, cost: each,
          opened_session: `${sess.session_date}${sess.part ? ' ' + sess.part : ''}`,
          opened_at: now, sold_out_at: now,
        }))));
        invented += gap;
      }
    }
    const applied = ok(await this.sb.from('sessions')
      .update({ applied_at: new Date().toISOString() }).eq('id', sessionId).select().single());
    await this.logEvent('session.apply', 'sessions', sessionId, {
      label: `${sess.hall_id === 'sc' ? 'Santa Clara' : 'Redwood City'} — ${sess.session_date}` +
             `${sess.part ? ' ' + sess.part : ''}: ${moved + invented} box(es) played` +
             (invented ? `, ${invented} of them never received into stock` : ''),
      moved, invented, short: short.length, hall: sess.hall_id,
    });
    // A write-off gets its own line on the history. The apply event alone buried
    // it in a subclause nobody reads, which is how 79 boxes went unnoticed.
    if (invented > 0) {
      await this.logEvent('session.short', 'sessions', sessionId, {
        label: `${sess.hall_id === 'sc' ? 'Santa Clara' : 'Redwood City'} — ${sess.session_date}`
             + `${sess.part ? ' ' + sess.part : ''}: ${invented} box(es) played that were never `
             + `received into stock (${short.map((s) => (prods[s.product_id]?.name || s.product_id)
                 + ' ×' + s.invented).join(', ')})`,
        invented, hall: sess.hall_id,
        games: short.map((s) => ({ ...s, name: prods[s.product_id]?.name || s.product_id })),
      });
    }
    return { session: applied, moved, invented, short };
  }

  /** Put a session's boxes back. Exact, because each carries the session's id. */
  async undoSession(sessionId) {
    const sess = ok(await this.sb.from('sessions').select('*').eq('id', sessionId).single());
    const boxes = await fetchAll(() => this.sb.from('boxes').select('id,state,unrecorded').eq('session_id', sessionId));
    const real = boxes.filter((b) => !b.unrecorded);
    const ghosts = boxes.filter((b) => b.unrecorded);
    for (const b of real) {
      if (b.state === 'sold_out') ok(await this.sb.from('boxes').update({ state: 'opened' }).eq('id', b.id));
      ok(await this.sb.from('boxes').update({
        state: 'in_inventory', session_id: null, opened_session: null,
        opened_at: null, sold_out_at: null,
      }).eq('id', b.id));
    }
    // boxes that were never on a shelf don't go back on one
    if (ghosts.length) ok(await this.sb.from('boxes').delete().in('id', ghosts.map((b) => b.id)));
    const restored = ok(await this.sb.from('sessions')
      .update({ applied_at: null }).eq('id', sessionId).select().single());
    await this.logEvent('session.undo', 'sessions', sessionId, {
      label: `${sess.hall_id === 'sc' ? 'Santa Clara' : 'Redwood City'} — ${sess.session_date}` +
             `${sess.part ? ' ' + sess.part : ''}: ${real.length} box(es) put back` +
             (ghosts.length ? `, ${ghosts.length} never-received removed` : ''),
      restored: real.length, removed: ghosts.length,
    });
    return { session: restored, restored: real.length, removed: ghosts.length };
  }

  /**
   * Point a session line at a different product — or at one for the first time.
   *
   * The name the programs use is recorded on the product as an alias, so the
   * match is made once and never again. Three games on the 10 Aug programme had
   * to be matched by hand — "Boop-Oop A-Doop" against a catalog reading BOOPOOP
   * ADOOP, "Dabbing Derby" against Dabbin' Derby, "Triple 500" against a catalog
   * typo of Tirple 500 — and every one of them would have come back next month.
   * The person at the desk already did the thinking; this keeps it.
   */
  async setPlayProduct(playId, productId) {
    const play = ok(await this.sb.from('session_plays')
      .update({ product_id: productId, match_how: 'confirmed', match_score: 1 })
      .eq('id', playId).select().single());
    await this.learnAlias(productId, play.name_raw);
    return play;
  }

  /** Remember a name a product is known by. No-op if it already matches. */
  async learnAlias(productId, raw) {
    const name = String(raw || '').trim();
    if (!name || !productId) return;
    const p = ok(await this.sb.from('products').select('name,aliases').eq('id', productId).single());
    const key = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const known = [p.name, ...(p.aliases || [])].map(key);
    if (known.includes(key(name))) return;
    // cap it: a runaway import must not grow one row without bound
    const next = [...(p.aliases || []), name].slice(-12);
    ok(await this.sb.from('products').update({ aliases: next }).eq('id', productId).select().single());
  }

  // ---- session assignments (what's racked for a session, decided ahead) ----
  //
  // A plan, not consumption. Assigning sets nothing in motion in the stock ledger;
  // what was actually played arrives later on the count sheet. The two disagree
  // often enough that conflating them would lose information.
  async getAssignments(hallId) {
    const rows = await fetchAll(() => this.sb
      .from('session_assignments')
      .select('id, session_id, product_id, sessions!inner(hall_id)')
      .eq('sessions.hall_id', hallId));
    return rows.map(({ sessions, ...r }) => r);
  }

  /** Find the session for a hall/date/part, creating it if this is the first time. */
  async ensureSession({ hallId, date, part = '' }) {
    const found = ok(await this.sb.from('sessions').select('*')
      .eq('hall_id', hallId).eq('session_date', date).eq('part', part));
    if (found.length) return found[0];
    const [y, m, d] = date.split('-').map(Number);
    const weekday = new Date(y, m - 1, d, 12).toLocaleDateString('en-US', { weekday: 'long' });
    return ok(await this.sb.from('sessions')
      .insert({ hall_id: hallId, session_date: date, part, weekday })
      .select().single());
  }

  /** Set a session's assigned games to exactly this list. */
  async setAssignments(sessionId, productIds) {
    const want = [...new Set(productIds)];
    const have = await fetchAll(() => this.sb.from('session_assignments')
      .select('id, product_id').eq('session_id', sessionId));
    const drop = have.filter((r) => !want.includes(r.product_id)).map((r) => r.id);
    const add = want.filter((pid) => !have.some((r) => r.product_id === pid));
    if (drop.length) ok(await this.sb.from('session_assignments').delete().in('id', drop));
    if (add.length) {
      ok(await this.sb.from('session_assignments')
        .insert(add.map((pid) => ({ session_id: sessionId, product_id: pid }))));
    }
    await this.logEvent('session.assign', 'sessions', sessionId, {
      label: `Assigned ${want.length} flash game(s) to a session`,
      added: add.length, removed: drop.length, total: want.length,
    });
    return { total: want.length, added: add.length, removed: drop.length };
  }

  // ---- deliveries ----
  //
  // Stock arriving, recorded on its own terms. Where it matches a PO we issued,
  // the boxes that PO already put on order are the ones received — creating new
  // ones would double the count. Anything beyond what the PO expected, or arriving
  // with no PO of ours at all, becomes new stock.
  async getDeliveries(hallId) {
    return fetchAll(() => this.sb.from('deliveries').select('*').eq('hall_id', hallId)
      .order('received_at', { ascending: false }));
  }

  /**
   * Every time stock turned up, from either write path.
   *
   * Receiving a PO writes a SHIPMENT; "Add delivery", for a drop with no PO of
   * ours, writes a DELIVERY. Same event, two tables, and anything reading only
   * one is wrong for half the hall — Redwood City receives through the PO flow
   * and its "recently received" list sat empty with 145 boxes on the shelf.
   */
  async getArrivals(hallId, limit = 60) {
    return ok(await this.sb.from('stock_arrivals').select('*')
      .eq('hall_id', hallId).order('received_ts', { ascending: false }).limit(limit));
  }

  async addDelivery({ hallId, vendorId, receivedAt, poId = null, poRef = '', invoiceNo = '', note = '', lines }) {
    const del = ok(await this.sb.from('deliveries').insert({
      hall_id: hallId, vendor_id: vendorId, received_at: receivedAt,
      po_id: poId, po_ref: poRef || null, invoice_no: invoiceNo || null, note: note || null,
    }).select().single());

    const ids = lines.map((l) => l.product_id);
    const prods = Object.fromEntries(
      (ok(await this.sb.from('products').select('*').in('id', ids.length ? ids : ['-'])))
        .map((p) => [p.id, p]));

    let claimed = 0, created = 0;
    for (const l of lines) {
      const n = Math.max(0, parseInt(l.qty) || 0);
      if (!n) continue;
      let left = n;
      if (poId) {
        const pool = ok(await this.sb.from('boxes').select('id')
          .eq('po_id', poId).eq('product_id', l.product_id).eq('state', 'on_order').limit(left));
        for (const b of pool) {
          ok(await this.sb.from('boxes').update({
            state: 'in_inventory', delivery_id: del.id, received_at: receivedAt,
          }).eq('id', b.id));
          claimed++; left--;
        }
      }
      if (left > 0) {
        const p = prods[l.product_id] || {};
        const each = Math.round(((Number(p.base_cost) || 0) * Math.max(1, p.pack_units || 1)
          / Math.max(1, p.split_boxes || 1)) * 100) / 100;
        ok(await this.sb.from('boxes').insert(Array.from({ length: left }, () => ({
          hall_id: hallId, product_id: l.product_id, state: 'in_inventory',
          delivery_id: del.id, po_id: poId, cost: each,
          price_tbd: !(each > 0), received_at: receivedAt,
        }))));
        created += left;
      }
    }

    // a PO with nothing left on order has arrived in full
    if (poId) {
      const remaining = ok(await this.sb.from('boxes').select('id').eq('po_id', poId).eq('state', 'on_order').limit(1));
      await this.setPoStatus(poId, remaining.length ? 'partial' : 'closed');
    }

    await this.logEvent('delivery.add', 'deliveries', del.id, {
      label: `${hallId === 'sc' ? 'Santa Clara' : 'Redwood City'} — delivery from ${vendorId} on ${receivedAt}: ` +
             `${claimed + created} box(es)` + (poRef ? ` (${poRef})` : ''),
      claimed, created, po_id: poId, po_ref: poRef,
    });
    return { delivery: del, claimed, created, total: claimed + created };
  }

  // ---- receiving ----
  async createShipment(s) { return ok(await this.sb.from('shipments').insert(s).select().single()); }
  /**
   * Mark a shipment received, and put it on the history.
   *
   * Receiving used to write boxes and nothing else, so a confirmed delivery left
   * no trace on the history at all — the only way to see what had actually turned
   * up against an order was to query the boxes table. `summary` is the human part
   * (which PO, which invoice, how many short); the line detail is never snapshotted
   * here because the boxes themselves are the record — see getReceiptDetail.
   */
  async confirmShipment(id, summary = {}) {
    const row = ok(await this.sb.from('shipments').update({ confirmed: true }).eq('id', id).select().single());
    const po = row.po_id
      ? ok(await this.sb.from('purchase_orders').select('num,hall_id,vendor_id').eq('id', row.po_id).single())
      : null;
    await this.logEvent('shipment.receive', 'shipments', id, {
      label: `${po?.num || 'delivery'} received`
        + (summary.invoice_no ? ` — invoice ${summary.invoice_no}` : '')
        + (summary.boxes != null ? ` — ${summary.boxes} box(es)` : '')
        + (summary.missing ? `, ${summary.missing} short` : ''),
      po_id: row.po_id, po_num: po?.num, hall: po?.hall_id, vendor_id: po?.vendor_id,
      invoice_no: summary.invoice_no || null, boxes: summary.boxes ?? null,
      missing: summary.missing || 0, amount: summary.amount ?? null,
    });
    return row;
  }

  /**
   * What actually arrived on one shipment, by game.
   *
   * Read from the boxes, not from a snapshot taken at confirm time. A box can be
   * adjusted, marked missing or swapped afterwards, and the question "what did
   * this delivery bring us" should answer with the boxes that exist, including
   * anything that turned up which was never on the order.
   */
  async getReceiptDetail(shipmentId) {
    const rows = await fetchAll(() => this.sb.from('boxes')
      .select('id,product_id,cost,state,serial,po_id,location').eq('shipment_id', shipmentId));
    if (!rows.length) return [];
    const ids = [...new Set(rows.map((b) => b.product_id).filter(Boolean))];
    const prods = Object.fromEntries((ok(await this.sb.from('products').select('id,name').in('id', ids)))
      .map((p) => [p.id, p.name]));
    const byProduct = {};
    for (const b of rows) {
      const g = (byProduct[b.product_id] ||= {
        product_id: b.product_id, name: prods[b.product_id] || b.product_id,
        boxes: 0, value: 0, serials: [], states: {}, offNow: 0,
      });
      g.boxes += 1;
      if ((b.location || 'hall') !== 'hall') g.offNow += 1;
      g.value = round2(g.value + (Number(b.cost) || 0));
      if (b.serial) g.serials.push(b.serial);
      g.states[b.state] = (g.states[b.state] || 0) + 1;
    }
    return Object.values(byProduct).sort((a, b) => a.name.localeCompare(b.name));
  }
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

  // ---- location: where stock physically is ----

  /**
   * Move boxes between the floor, a distributor's warehouse and off-site storage.
   *
   * A move is NOT a state change — a box in_inventory stays in_inventory whether
   * it is on the shelf or in a storage unit. Only `location` moves, which is why
   * the state guard never sees this and cannot object.
   *
   * Boxes are chosen oldest-received first, the same order a session consumes
   * them, so shipping "four Lucky Kat" takes the four that have been sitting
   * longest rather than an arbitrary four.
   */
  async moveBoxes({ hallId, productId, from, to, qty, ref = null, fromRef, ids = null,
                    states = ['in_inventory', 'opened'], note = '' }) {
    if (from === to) throw new Error('That stock is already there.');
    if (!['hall', 'vendor', 'storage'].includes(to)) throw new Error(`Unknown location "${to}".`);
    const n = Math.max(0, parseInt(qty) || 0);
    if (!n) throw new Error('How many boxes?');
    // `ids` is how the UI should call this. The Owned screen groups rows by
    // product AND location_ref, so "ship the Marathon row" has to move Marathon's
    // boxes; selecting on product+location alone moved whichever ref happened to
    // sort first and marked the wrong distributor's stock as arrived.
    let pool;
    if (ids?.length) {
      // filter FIRST, then take n — slicing the caller's id list first meant a
      // single box already moved by someone else turned a valid request into
      // "only 1 box is there", and the demo store disagreed about which pair moved
      pool = (ok(await this.sb.from('boxes').select('id')
        .in('id', ids).eq('location', from)
        .in('state', states).is('session_id', null))).slice(0, n);
    } else {
      let q = this.sb.from('boxes').select('id')
        .eq('hall_id', hallId).eq('product_id', productId)
        .eq('location', from)
        .in('state', states)
        .is('session_id', null)
        // boxes racked for a session are spoken for — don't ship them out from
        // under Assign
        .is('session_tag', null);
      if (fromRef !== undefined) {
        q = fromRef === null ? q.is('location_ref', null) : q.eq('location_ref', fromRef);
      }
      pool = ok(await q.order('received_at', { nullsFirst: true }).order('id').limit(n));
    }
    if (pool.length < n) {
      throw new Error(`Only ${pool.length} box(es) of that are ${from === 'hall' ? 'on the floor' : 'at ' + from}, `
        + `so ${n} cannot move.`);
    }
    const picked = pool.map((b) => b.id);
    // look the name up BEFORE the write: doing it after meant a lookup failure
    // reported "could not move" when the boxes had already moved, and the user
    // would ship them twice
    const prod = (ok(await this.sb.from('products').select('name').eq('id', productId).limit(1)))[0];
    ok(await this.sb.from('boxes').update({
      location: to, location_ref: to === 'hall' ? null : (ref || null),
      // ANY move means someone physically handled every box, so it is a sighting
      // wherever it lands. Blanking this on the way out made freshly-stored stock
      // appear instantly in the "not confirmed in 60 days" banner, which trains
      // people to ignore the banner.
      counted_at: new Date().toISOString().slice(0, 10),
    }).in('id', picked));
    await this.logEvent('stock.move', 'boxes', picked[0], {
      label: `${prod?.name || productId} — ${n} box(es) moved ${from} → ${to}`
           + (ref ? ` (${ref})` : ''),
      hall: hallId, product_id: productId, from, to, qty: n, ref, note, box_ids: picked,
    });
    return { moved: n, ids: picked };
  }

  /** Everything this hall owns that is not on its floor, newest confirmation first. */
  async getOffsite(hallId) {
    const rows = await fetchAll(() => this.sb.from('boxes')
      .select('id,product_id,cost,state,location,location_ref,counted_at,received_at')
      .eq('hall_id', hallId).neq('location', 'hall')
      .in('state', ['in_inventory', 'opened']));
    if (!rows.length) return [];
    const ids = [...new Set(rows.map((b) => b.product_id).filter(Boolean))];
    const prods = Object.fromEntries((ok(await this.sb.from('products').select('id,name').in('id', ids)))
      .map((p) => [p.id, p.name]));
    const grouped = {};
    for (const b of rows) {
      const key = `${b.product_id}|${b.location}|${b.location_ref || ''}`;
      const g = (grouped[key] ||= {
        product_id: b.product_id, name: prods[b.product_id] || b.product_id,
        location: b.location, location_ref: b.location_ref,
        boxes: 0, value: 0, counted_at: b.counted_at, ids: [],
      });
      g.boxes += 1;
      g.value = round2(g.value + (Number(b.cost) || 0));
      g.ids.push(b.id);
      // the group is only as fresh as its stalest box
      if (!b.counted_at || (g.counted_at && b.counted_at < g.counted_at)) g.counted_at = b.counted_at;
    }
    return Object.values(grouped).sort((a, b) =>
      a.name.localeCompare(b.name) || a.location.localeCompare(b.location));
  }

  /** Someone laid eyes on it. Records the date so staleness means something. */
  async confirmOffsite(ids, on = new Date().toISOString().slice(0, 10)) {
    if (!ids?.length) return { confirmed: 0 };
    ok(await this.sb.from('boxes').update({ counted_at: on }).in('id', ids));
    await this.logEvent('stock.confirm', 'boxes', ids[0], {
      label: `${ids.length} off-site box(es) confirmed present`, qty: ids.length, on,
    });
    return { confirmed: ids.length };
  }

  // ---- hidden games: a hall's private view of a shared catalogue ----

  /** Product ids this hall does not want to see. Display only — never a stock filter. */
  async getHidden(hallId) {
    const rows = await fetchAll(() => this.sb.from('hidden_products')
      .select('product_id,hidden_at,note').eq('hall_id', hallId));
    return rows.map((r) => r.product_id);
  }

  /**
   * Hide or unhide one game at one hall.
   *
   * Deliberately upsert/delete rather than a toggle: two managers on the same
   * screen pressing Hide would otherwise flip it back to visible, and a toggle
   * would also mean the caller has to already know the current state to be right.
   */
  async setHidden(hallId, productId, hide, note = null) {
    if (!hallId || !productId) throw new Error('setHidden needs a hall and a product');
    // read the name BEFORE writing — a lookup that fails after the commit reports
    // failure for work that actually happened
    const prod = ok(await this.sb.from('products').select('id,name').eq('id', productId).maybeSingle());
    if (!prod) throw new Error(`No such game: ${productId}`);
    if (hide) {
      // note is only written when one is supplied — the UI passes null, and an
      // upsert carrying it would wipe a reason someone typed earlier
      const row = { hall_id: hallId, product_id: productId };
      if (note != null) row.note = note;
      ok(await this.sb.from('hidden_products')
        .upsert(row, { onConflict: 'hall_id,product_id' }));
    } else {
      ok(await this.sb.from('hidden_products').delete()
        .eq('hall_id', hallId).eq('product_id', productId));
    }
    await this.logEvent(hide ? 'catalog.hide' : 'catalog.unhide', 'products', productId, {
      label: `${prod.name} ${hide ? 'hidden at' : 'shown again at'} ${hallId.toUpperCase()}`,
      hall: hallId, product_id: productId, note,
    });
    return { product_id: productId, hidden: !!hide };
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
    // The function reports per-email status and used to be ignored, so a bounced
    // address produced a cheerful "delivered to vendors" and a logged email the
    // vendor never got. Surface the failures; the caller decides what to say.
    const logs = data.logs || [];
    const failed = logs.filter((l) => l && l.status !== 'sent');
    if (failed.length) {
      const why = failed.map((l) => `${l.to_addr || 'no address'}: ${l.error || 'failed'}`).join('; ');
      const err = new Error(`${failed.length} of ${logs.length} email(s) did not send — ${why}`);
      err.partial = { logs, failed };     // some may have gone: don't let the caller resend blindly
      throw err;
    }
    return logs;
  }
  async getEmails(hallId) { return fetchAll(() => this.sb.from('emails').select('*').eq('hall_id', hallId).order('created_at', { ascending: false })); }

  // ---- settings / events ----
  async getSetting(key) {
    const rows = ok(await this.sb.from('settings').select('value').eq('key', key));
    return rows[0]?.value;
  }
  async setSetting(key, value) { ok(await this.sb.from('settings').upsert({ key, value })); }
  /**
   * Activity, as a person would describe it.
   *
   * There is a row-level audit trigger writing an event for every insert, update
   * and delete — thousands of them, none carrying a label. Those are forensics,
   * not activity: loading one invoice writes 300 of them and pushes everything
   * legible off the end of a 12-row panel. Recording the five August deliveries
   * buried the whole feed under 615 unlabelled rows in a single afternoon.
   *
   * So this returns the events the app deliberately logged. Pass raw:true for the
   * audit trail.
   */
  async getEvents(limit = 200, { raw = false } = {}) {
    let qy = this.sb.from('events').select('*');
    if (!raw) qy = qy.not('kind', 'in', '("insert","update","delete")');
    return ok(await qy.order('at', { ascending: false }).limit(limit));
  }
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
