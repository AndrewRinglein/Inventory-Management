import React, { useContext, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney, ticketPrice } from '../lib/logic/po.js';
import { countByProduct } from '../lib/logic/boxes.js';

import { SESSIONS } from '../lib/sessions.js';
import { GAME_TYPES, MISC_MODES, passesFilters } from '../lib/logic/categories.js';
import { needsCost, needsType, needsTickets, needsVendor } from '../lib/logic/setup.js';
import UpdateGame from './UpdateGame.jsx';

const COLS = [
  { key: 'vendor', label: 'Vendor' }, { key: 'type', label: 'Type' },
  { key: 'tickets', label: 'Tickets', r: true }, { key: 'price', label: '$ / ticket', r: true },
  { key: 'cost', label: 'Unit cost', r: true }, { key: 'inv', label: 'In stock', r: true },
  { key: 'open', label: 'Opened', r: true }, { key: 'onorder', label: 'On order', r: true },
  { key: 'value', label: 'Value', r: true }, { key: 'assigned', label: 'Set aside' },
];

export default function Inventory() {
  const { hall, products, vendors, boxes, store, reloadHall, setToast, can, openSession } = useContext(AppCtx);
  const editable = can('boxes');
  const [q, setQ] = useState('');
  const [typeF, setTypeF] = useState('');
  const [miscF, setMiscF] = useState('games');
  const [sortKey, setSortKey] = useState('name');
  const [dir, setDir] = useState(1);
  const [assignPid, setAssignPid] = useState(null);
  const [assignTag, setAssignTag] = useState('');
  const [assignQty, setAssignQty] = useState(1);
  const [adjustMode, setAdjustMode] = useState(false);
  const [adj, setAdj] = useState(null);      // { p, from, to }
  const [adjNote, setAdjNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [updPid, setUpdPid] = useState(null);

  // the gold 'update' chip: click it to fill the blank in place
  const Upd = ({ p }) => (
    <button className="badge b-gold" style={{ border: 0, cursor: 'pointer', font: 'inherit', fontSize: 11, fontWeight: 600 }}
      title="Click to fill this in" onClick={() => setUpdPid(p.id)}>update</button>
  );

  const vmap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);
  const cnt = useMemo(() => countByProduct(boxes), [boxes]);

  const rows = useMemo(() => {
    const out = [];
    let totVal = 0, unvalued = 0;
    for (const p of products) {
      const c = cnt[p.id];
      if (!c || (!c.inv && !c.open && !c.onorder)) continue;
      if (q && !p.name.toLowerCase().includes(q.toLowerCase())) continue;
      if (!passesFilters(p, { type: typeF, misc: miscF })) continue;
      const asg = {};
      for (const b of boxes) {
        if (b.product_id === p.id && b.state === 'in_inventory' && b.session_tag) {
          asg[b.session_tag] = (asg[b.session_tag] || 0) + 1;
        }
      }
      const held = (c.inv || 0) + (c.open || 0);
      const value = held * (Number(p.cost) || 0);
      totVal += value;
      if (needsCost(p)) unvalued += held;   // counted, but we can't put a number on it yet
      out.push({
        p, c, value,
        s: {
          name: p.name.toLowerCase(), vendor: vmap[p.vendor_id]?.name || '', type: p.type,
          tickets: p.tickets || 0, price: ticketPrice(p), cost: Number(p.cost) || 0,
          inv: c.inv || 0, open: c.open || 0, onorder: c.onorder || 0, value,
          assigned: Object.keys(asg).join(', '),
        },
        assignedLabel: Object.entries(asg).map(([k, n]) => `${k} ×${n}`).join(', ') || '—',
        avail: (c.inv || 0) - Object.values(asg).reduce((a, n) => a + n, 0),
      });
    }
    out.sort((a, b) => {
      const x = a.s[sortKey], y = b.s[sortKey];
      const d = typeof x === 'string' ? x.localeCompare(y) : (x || 0) - (y || 0);
      return d * dir || a.s.name.localeCompare(b.s.name);
    });
    out.totVal = totVal;
    out.unvalued = unvalued;
    return out;
  }, [products, boxes, cnt, q, typeF, miscF, sortKey, dir, vmap]);

  const sortBy = (k) => {
    if (k === sortKey) setDir(-dir);
    else { setSortKey(k); setDir(1); }
  };
  const arrow = (k) => (k === sortKey ? (dir > 0 ? ' ▲' : ' ▼') : '');

  const openOne = async (row) => {
    const pool = boxes.filter((b) => b.product_id === row.p.id && b.state === 'in_inventory');
    if (!pool.length) { setToast('No boxes in stock for this game'); return; }
    const box = pool.find((b) => b.session_tag === openSession) || pool.find((b) => !b.session_tag) || pool[0];
    await store.updateBox(box.id, { opened_session: openSession });
    await store.transitionBox(box.id, 'opened');
    await reloadHall();
    setToast(`Opened for ${openSession} — ${row.p.name}`, async () => {
      await store.transitionBox(box.id, 'in_inventory');
      await store.updateBox(box.id, { opened_session: null });
      await reloadHall();
    });
  };

  const doAssign = async () => {
    const row = rows.find((r) => r.p.id === assignPid);
    if (!row || !assignTag.trim()) return;
    const pool = boxes.filter((b) => b.product_id === assignPid && b.state === 'in_inventory' && !b.session_tag)
      .slice(0, Math.max(1, assignQty));
    if (!pool.length) { setToast('No unassigned boxes left for this game'); return; }
    await store.setBoxSession(pool.map((b) => b.id), assignTag.trim());
    await reloadHall();
    setAssignPid(null); setAssignTag('');
    setToast(`${pool.length} box${pool.length > 1 ? 'es' : ''} set aside for ${assignTag.trim()}`);
  };

  // A hand count that disagrees with the system. The note is required — a
  // count that changes without a reason is worse than no count at all.
  const saveAdjust = async () => {
    if (!adj || saving) return;
    const delta = adj.to - adj.from;
    if (!delta) { setAdj(null); return; }
    if (!adjNote.trim()) { setToast('Add a note explaining the change'); return; }
    setSaving(true);
    const sign = delta > 0 ? '+' : '−';
    try {
      await store.adjustStock({
        hallId: hall, product: adj.p, delta, note: adjNote.trim(),
        label: `${hall === 'sc' ? 'Santa Clara' : 'Redwood City'} — ${adj.p.name} ${sign}${Math.abs(delta)} (${adj.from} → ${adj.to})`,
      });
      await reloadHall();
      setAdj(null); setAdjNote('');
      setToast(`${adj.p.name}: ${adj.from} → ${adj.to} boxes`);
    } catch (e) {
      setToast(e.message || 'Could not adjust that count');
    } finally { setSaving(false); }
  };

  const clearAssign = async () => {
    const ids = boxes.filter((b) => b.product_id === assignPid && b.session_tag).map((b) => b.id);
    await store.setBoxSession(ids, null);
    await reloadHall();
    setAssignPid(null);
    setToast('Set-asides cleared');
  };

  return (
    <div>
      <div className="page-head">
        <div className="h1">Inventory — {hall === 'sc' ? 'Santa Clara' : 'Redwood City'}</div>
        <select value={typeF} onChange={(e) => setTypeF(e.target.value)} title="Game type">
          {GAME_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={miscF} onChange={(e) => setMiscF(e.target.value)} title="Cherry tickets and dauber supplies">
          {MISC_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <div className="grow" />
        <span className="dim" style={{ fontSize: 13 }}>
          {rows.length} products with stock · owned value <b className="mono">{fmtMoney(rows.totVal)}</b>
          {rows.unvalued > 0 && (
            <span className="tbd" style={{ cursor: 'default', fontSize: 12 }}
              title={`${rows.unvalued} boxes have no unit cost yet, so they aren't in this figure`}>
              {' '}+ {rows.unvalued} unpriced
            </span>
          )}
        </span>
        {editable && (
          <button className={'btn ' + (adjustMode ? 'orange' : 'ghost')} onClick={() => setAdjustMode(!adjustMode)}
            title="Hand-correct a count that doesn't match the shelf">
            {adjustMode ? '🔓 Done adjusting' : '🔒 Adjust inventory'}
          </button>
        )}
      </div>
      {adjustMode && (
        <div className="demo-banner" style={{ background: '#fdf3e7', borderColor: '#e2c39a' }}>
          <b>Adjust mode is on.</b> Click any <b>In stock</b> number to set what's actually on the shelf.
          Every change needs a note and shows up in Recent Activity.
        </div>
      )}
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr>
            <th className="first sortable" onClick={() => sortBy('name')}>
              <div>Game{arrow('name')}</div>
              <input type="text" placeholder="Search game…" value={q} onClick={(e) => e.stopPropagation()}
                onChange={(e) => setQ(e.target.value)} style={{ fontWeight: 400, marginTop: 3, width: 200 }} />
            </th>
            {COLS.map((c) => (
              <th key={c.key} className={'sortable' + (c.r ? ' r' : '')} onClick={() => sortBy(c.key)}>{c.label}{arrow(c.key)}</th>
            ))}
            <th className="last" style={{ width: 200 }} />
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.p.id}>
                <td className="first">
                  {r.p.name}
                  {needsCost(r.p) && <span className="badge b-gold" style={{ marginLeft: 6 }} title="No unit cost — can't be ordered or received until set">can't order</span>}
                </td>
                <td className="dim" style={{ fontSize: 12 }}>
                  {needsVendor(r.p) ? <Upd p={r.p} /> : vmap[r.p.vendor_id]?.name}
                </td>
                <td className="dimmer" style={{ fontSize: 12 }}>{needsType(r.p) ? <Upd p={r.p} /> : r.p.type}</td>
                <td className="r mono">{needsTickets(r.p) ? <Upd p={r.p} /> : (r.p.tickets ? r.p.tickets.toLocaleString() : '—')}</td>
                <td className="r mono dim">${ticketPrice(r.p)}</td>
                <td className="r mono">{needsCost(r.p) ? <Upd p={r.p} /> : fmtMoney(r.p.cost)}</td>
                <td className="r mono">
                  {adjustMode
                    ? <button className="btn ghost sm" style={{ fontFamily: 'inherit', minWidth: 46 }}
                        title="Set the real shelf count"
                        onClick={() => { setAdj({ p: r.p, from: r.c.inv || 0, to: r.c.inv || 0 }); setAdjNote(''); }}>
                        <b>{r.c.inv || 0}</b> ✎
                      </button>
                    : <b>{r.c.inv || 0}</b>}
                </td>
                <td className="r mono" style={{ color: 'var(--orange)' }}>{r.c.open || 0}</td>
                <td className="r mono dimmer">{r.c.onorder || 0}</td>
                <td className="r mono">{r.value ? fmtMoney(r.value) : '—'}</td>
                <td style={{ fontSize: 11, color: 'var(--green)' }}>{r.assignedLabel}</td>
                <td className="last r" style={{ whiteSpace: 'nowrap' }}>
                  {editable ? (<>
                    <button className="btn green sm" disabled={r.avail <= 0}
                      onClick={() => { setAssignPid(r.p.id); setAssignQty(1); }}>Assign</button>{' '}
                    <button className="btn orange sm" disabled={(r.c.inv || 0) <= 0} onClick={() => openOne(r)}>Open</button>{' '}
                    <button className="btn ghost sm" title="Edit this game — name, distributor, type, price, tickets"
                      onClick={() => setUpdPid(r.p.id)}>Edit</button>
                  </>) : <span className="dimmer" style={{ fontSize: 11 }}>read-only</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">No products match.</div>}
      </div>

      {updPid && <UpdateGame product={products.find((p) => p.id === updPid)} onClose={() => setUpdPid(null)} />}

      {adj && (
        <div className="modal-bg" onClick={() => setAdj(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>Adjust inventory</div>
            <p className="dim" style={{ fontSize: 12.5, marginBottom: 14 }}>{adj.p.name}</p>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end' }}>
              <div className="field" style={{ margin: 0 }}><label>System says</label>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700, padding: '4px 0' }}>{adj.from}</div></div>
              <div style={{ fontSize: 20, color: 'var(--ink-2)', paddingBottom: 8 }}>→</div>
              <div className="field" style={{ margin: 0 }}><label>Actually on the shelf</label>
                <input className="num" type="number" min="0" autoFocus value={adj.to}
                  onChange={(e) => setAdj({ ...adj, to: Math.max(0, parseInt(e.target.value) || 0) })}
                  style={{ width: 110, fontSize: 20, fontWeight: 700 }} /></div>
              <div style={{ paddingBottom: 10, fontWeight: 700, fontSize: 14, color: adj.to > adj.from ? 'var(--green)' : adj.to < adj.from ? 'var(--orange)' : 'var(--ink-2)' }}>
                {adj.to === adj.from ? 'no change' : (adj.to > adj.from ? `+${adj.to - adj.from}` : `−${adj.from - adj.to}`) + ' boxes'}
              </div>
            </div>
            <div className="field" style={{ marginTop: 14 }}><label>Note — why is it different? (required)</label>
              <input type="text" value={adjNote} placeholder="e.g. two boxes damaged in the back room"
                onChange={(e) => setAdjNote(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveAdjust()} style={{ width: '100%' }} /></div>
            <p className="dimmer" style={{ fontSize: 11.5, marginTop: 8 }}>
              {adj.to < adj.from
                ? 'Removed boxes are marked missing, not deleted — the history stays intact.'
                : adj.to > adj.from
                  ? `Added boxes are valued at ${fmtMoney(adj.p.cost)} each, this hall's current unit cost.`
                  : 'Set a different number to record an adjustment.'}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn primary" disabled={adj.to === adj.from || !adjNote.trim() || saving} onClick={saveAdjust}>
                {saving ? 'Saving…' : 'Save adjustment'}
              </button>
              <div style={{ flex: 1 }} />
              <button className="btn ghost" onClick={() => setAdj(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {assignPid && (
        <div className="modal-bg" onClick={() => setAssignPid(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>Set aside for a session</div>
            <p className="dim" style={{ fontSize: 12.5, marginBottom: 14 }}>
              {products.find((p) => p.id === assignPid)?.name}
            </p>
            <div className="field"><label>Session</label>
              <select value={assignTag} autoFocus onChange={(e) => setAssignTag(e.target.value)} style={{ width: '100%' }}>
                <option value="">— pick a session —</option>
                {SESSIONS.map((sn) => <option key={sn} value={sn}>{sn}</option>)}
              </select></div>
            <div className="field"><label>How many boxes</label>
              <input type="number" min="1" value={assignQty} onChange={(e) => setAssignQty(Math.max(1, parseInt(e.target.value) || 1))} style={{ width: 90 }} /></div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn green" onClick={doAssign}>Set aside</button>
              <button className="btn ghost" onClick={clearAssign}>Clear all set-asides</button>
              <div style={{ flex: 1 }} />
              <button className="btn ghost" onClick={() => setAssignPid(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
