import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney } from '../lib/logic/po.js';
import { countByProduct } from '../lib/logic/boxes.js';
import { stockUnit, perBoxValue } from '../lib/logic/pricing.js';
import { GAME_TYPES, MISC_MODES, passesFilters } from '../lib/logic/categories.js';

const HALL = { sc: 'Santa Clara', rwc: 'Redwood City' };

/**
 * Record a delivery that arrived, with or without a purchase order behind it.
 *
 * The PO reference has three shapes and they are not the same thing. One of ours
 * means the boxes it already put on order are the ones arriving, so they get
 * received rather than duplicated. A number typed by hand means the order exists
 * on paper somewhere else. Pre-PO means the stock predates this system and there
 * is no order to find — saying so is more useful than leaving the field blank and
 * wondering later.
 */
export default function AddDelivery({ onClose }) {
  const { hall, products, vendors, boxes, pos, store, reloadHall, setToast } = useContext(AppCtx);
  const today = new Date().toISOString().slice(0, 10);

  const [vendorId, setVendorId] = useState('');
  const [when, setWhen] = useState(today);
  const [poMode, setPoMode] = useState('none');   // none | ours | typed | prepo
  const [poId, setPoId] = useState('');
  const [poTyped, setPoTyped] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [note, setNote] = useState('');
  const [qty, setQty] = useState({});             // product_id -> boxes
  const [q, setQ] = useState('');
  const [typeF, setTypeF] = useState('');
  const [miscF, setMiscF] = useState('all');
  const [busy, setBusy] = useState(false);

  const cnt = useMemo(() => countByProduct(boxes), [boxes]);
  const vmap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);
  const openPos = pos.filter((p) => p.status === 'sent' || p.status === 'partial');
  const posForVendor = openPos.filter((p) => !vendorId || p.vendor_id === vendorId);

  // picking one of our POs fixes the vendor — they can't disagree
  useEffect(() => {
    if (poMode === 'ours' && poId) {
      const po = pos.find((p) => p.id === poId);
      if (po && po.vendor_id !== vendorId) setVendorId(po.vendor_id);
    }
  }, [poId, poMode]);   // eslint-disable-line

  // what that PO is still waiting on, so the list can lead with it
  const expected = useMemo(() => {
    if (poMode !== 'ours' || !poId) return {};
    const m = {};
    for (const b of boxes) {
      if (b.po_id === poId && b.state === 'on_order') m[b.product_id] = (m[b.product_id] || 0) + 1;
    }
    return m;
  }, [poId, poMode, boxes]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return products
      .filter((p) => p.active !== false)
      .filter((p) => (qty[p.id] > 0) || Object.keys(expected).includes(p.id) || (
        (!vendorId || p.vendor_id === vendorId) &&
        (!term || p.name.toLowerCase().includes(term)) &&
        passesFilters(p, { type: typeF, misc: miscF })
      ))
      .sort((a, b) =>
        (expected[b.id] ? 1 : 0) - (expected[a.id] ? 1 : 0) ||
        a.name.localeCompare(b.name));
  }, [products, vendorId, q, typeF, miscF, qty, expected]);

  const lines = Object.entries(qty).filter(([, n]) => n > 0).map(([product_id, n]) => ({ product_id, qty: n }));
  const totalBoxes = lines.reduce((a, l) => a + l.qty, 0);
  const totalValue = lines.reduce((a, l) => {
    const p = products.find((x) => x.id === l.product_id);
    return a + l.qty * (p ? perBoxValue(p) : 0);
  }, 0);

  const poRef = poMode === 'prepo' ? 'PRE-PO'
    : poMode === 'typed' ? poTyped.trim()
    : poMode === 'ours' ? (pos.find((p) => p.id === poId)?.num || '')
    : '';

  const ready = vendorId && when && totalBoxes > 0
    && (poMode !== 'ours' || poId) && (poMode !== 'typed' || poTyped.trim());

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const res = await store.addDelivery({
        hallId: hall, vendorId, receivedAt: when,
        poId: poMode === 'ours' ? poId : null,
        poRef, invoiceNo: invoiceNo.trim(), note: note.trim(), lines,
      });
      await reloadHall();
      setToast(res.claimed
        ? `${res.total} box(es) received — ${res.claimed} against the order, ${res.created} beyond it`
        : `${res.total} box(es) received into ${HALL[hall]}`, null, 7000);
      onClose();
    } catch (e) {
      setToast(e.message || 'Could not record that delivery', null, 8000);
    } finally { setBusy(false); }
  };

  const setN = (pid, v) => {
    const n = Math.max(0, parseInt(v) || 0);
    setQty((s) => ({ ...s, [pid]: n }));
  };

  return (
    <div className="modal-bg" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}
        style={{ width: 1000, maxWidth: '96vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Add a delivery — {HALL[hall]}</div>
        <p className="dimmer" style={{ fontSize: 12.5, margin: '4px 0 12px' }}>
          For stock that turned up without going through Review &amp; Send here — a phoned-in order,
          a standing weekly drop, or anything from before this system. Everything you tick goes
          straight into inventory, dated as below.
        </p>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Distributor</label>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={{ width: 210 }}>
              <option value="">— pick one —</option>
              {vendors.filter((v) => v.id !== 'unknown').map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Day it arrived</label>
            <input type="date" value={when} max={today} onChange={(e) => setWhen(e.target.value)} style={{ width: 160 }} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Their invoice no. <span className="dimmer">(optional)</span></label>
            <input type="text" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} style={{ width: 150 }} />
          </div>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>Purchase order</label>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
            {[
              ['ours', 'One of ours'],
              ['typed', 'A PO number from elsewhere'],
              ['prepo', 'Pre-PO — before this system'],
              ['none', 'No PO at all'],
            ].map(([k, label]) => (
              <label key={k} style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" name="pomode" checked={poMode === k} onChange={() => setPoMode(k)} />
                {label}
              </label>
            ))}
          </div>
          {poMode === 'ours' && (
            <div style={{ marginTop: 8 }}>
              <select value={poId} onChange={(e) => setPoId(e.target.value)} style={{ width: 420 }}>
                <option value="">— pick an open order —</option>
                {posForVendor.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.num} · {vmap[p.vendor_id]?.name} · {fmtMoney(p.total)}
                    {p.status === 'partial' ? ' · part-received' : ''}
                  </option>
                ))}
              </select>
              {posForVendor.length === 0 && (
                <div className="dimmer" style={{ fontSize: 11.5, marginTop: 4 }}>
                  No open orders{vendorId ? ` for ${vmap[vendorId]?.name}` : ''} — use one of the other options.
                </div>
              )}
              {poId && (
                <div className="dimmer" style={{ fontSize: 11.5, marginTop: 4 }}>
                  Boxes that order is waiting on are listed first and pre-filled. Anything you add beyond
                  what it expected is received as extra rather than against it.
                </div>
              )}
            </div>
          )}
          {poMode === 'typed' && (
            <input type="text" autoFocus value={poTyped} placeholder="e.g. 8842, or their order number"
              onChange={(e) => setPoTyped(e.target.value)} style={{ width: 260, marginTop: 8 }} />
          )}
          {poMode === 'prepo' && (
            <div className="dimmer" style={{ fontSize: 11.5, marginTop: 6 }}>
              Recorded as <span className="mono">PRE-PO</span> — stock that arrived before this system
              was tracking orders. It counts into inventory the same way; it just has no order to reconcile against.
            </div>
          )}
        </div>

        <div className="filter-bar" style={{ marginTop: 10 }}>
          <input type="text" placeholder="Search games…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
          <label>Type
            <select value={typeF} onChange={(e) => setTypeF(e.target.value)}>
              {GAME_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select></label>
          <label>Misc
            <select value={miscF} onChange={(e) => setMiscF(e.target.value)}>
              {MISC_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select></label>
          <div style={{ flex: 1 }} />
          <span className="dimmer" style={{ fontSize: 12 }}>{rows.length} shown</span>
        </div>

        <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border-lt)', borderRadius: 6 }}>
          <table className="tbl">
            <thead><tr>
              <th className="first">Game</th><th>Distributor</th><th>Counted as</th>
              <th className="r">In stock</th><th className="r">On order</th>
              <th className="r">Per unit</th>
              <th style={{ textAlign: 'center', width: 110 }}>Delivered</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => {
                const c = cnt[p.id] || {};
                const exp = expected[p.id] || 0;
                const n = qty[p.id] || 0;
                return (
                  <tr key={p.id} className={n ? 'hl' : ''}>
                    <td className="first">
                      {p.name}
                      {exp > 0 && <span className="badge b-gold" style={{ marginLeft: 6, fontSize: 10 }}>
                        {exp} on this order</span>}
                    </td>
                    <td className="dim" style={{ fontSize: 12 }}>{vmap[p.vendor_id]?.name || '—'}</td>
                    <td className="dimmer" style={{ fontSize: 12 }}>{stockUnit(p)[1]}</td>
                    <td className="r mono">{c.inv || 0}</td>
                    <td className="r mono dimmer">{c.onorder || 0}</td>
                    <td className="r mono dimmer">{fmtMoney(perBoxValue(p))}</td>
                    <td style={{ textAlign: 'center' }}>
                      <input className="qty" type="number" min="0" value={n || ''} placeholder=""
                        onChange={(e) => setN(p.id, e.target.value)} />
                      {exp > 0 && n !== exp && (
                        <button className="btn ghost sm" style={{ marginLeft: 4, padding: '1px 5px', fontSize: 10 }}
                          onClick={() => setN(p.id, exp)} title="Fill in what the order expected">all</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <div className="dimmer" style={{ padding: 24, textAlign: 'center' }}>
            {vendorId ? 'No games match.' : 'Pick a distributor to see their games.'}
          </div>}
        </div>

        <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
          <label>Note <span className="dimmer">(optional — anything odd about this delivery)</span></label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%' }} />
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
          <button className="btn primary" disabled={!ready || busy} onClick={save}>
            {busy ? 'Recording…' : `Receive ${totalBoxes} box${totalBoxes === 1 ? '' : 'es'}`}
          </button>
          <span className="dim" style={{ fontSize: 12.5 }}>
            {totalBoxes > 0 && <>{lines.length} game{lines.length === 1 ? '' : 's'} · <b className="mono">{fmtMoney(totalValue)}</b> into stock</>}
            {poRef && <span className="dimmer"> · against {poRef}</span>}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
