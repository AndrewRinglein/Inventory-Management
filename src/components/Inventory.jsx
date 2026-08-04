import React, { useContext, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney } from '../lib/logic/po.js';
import { countByProduct } from '../lib/logic/boxes.js';

const COLS = [
  { key: 'vendor', label: 'Vendor' }, { key: 'type', label: 'Type' },
  { key: 'tickets', label: 'Tickets', r: true }, { key: 'price', label: '$ / ticket', r: true },
  { key: 'cost', label: 'Unit cost', r: true }, { key: 'inv', label: 'In stock', r: true },
  { key: 'open', label: 'Opened', r: true }, { key: 'onorder', label: 'On order', r: true },
  { key: 'value', label: 'Value', r: true }, { key: 'assigned', label: 'Set aside' },
];

export default function Inventory() {
  const { hall, products, vendors, boxes, store, reloadHall, setToast, can } = useContext(AppCtx);
  const editable = can('boxes');
  const [q, setQ] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [dir, setDir] = useState(1);
  const [assignPid, setAssignPid] = useState(null);
  const [assignTag, setAssignTag] = useState('');
  const [assignQty, setAssignQty] = useState(1);

  const vmap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);
  const cnt = useMemo(() => countByProduct(boxes), [boxes]);

  const rows = useMemo(() => {
    const out = [];
    let totVal = 0;
    for (const p of products) {
      const c = cnt[p.id];
      if (!c || (!c.inv && !c.open && !c.onorder)) continue;
      if (q && !p.name.toLowerCase().includes(q.toLowerCase())) continue;
      const asg = {};
      for (const b of boxes) {
        if (b.product_id === p.id && b.state === 'in_inventory' && b.session_tag) {
          asg[b.session_tag] = (asg[b.session_tag] || 0) + 1;
        }
      }
      const value = ((c.inv || 0) + (c.open || 0)) * p.cost;
      totVal += value;
      out.push({
        p, c, value,
        s: {
          name: p.name.toLowerCase(), vendor: vmap[p.vendor_id]?.name || '', type: p.type,
          tickets: p.tickets || 0, price: p.price_per_ticket || 1, cost: p.cost,
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
    return out;
  }, [products, boxes, cnt, q, sortKey, dir, vmap]);

  const sortBy = (k) => {
    if (k === sortKey) setDir(-dir);
    else { setSortKey(k); setDir(1); }
  };
  const arrow = (k) => (k === sortKey ? (dir > 0 ? ' ▲' : ' ▼') : '');

  const openOne = async (row) => {
    const pool = boxes.filter((b) => b.product_id === row.p.id && b.state === 'in_inventory');
    if (!pool.length) { setToast('No boxes in stock for this game'); return; }
    const box = pool.find((b) => !b.session_tag) || pool[0];
    await store.transitionBox(box.id, 'opened');
    await reloadHall();
    setToast(`Opened — ${row.p.name}`, async () => { await store.transitionBox(box.id, 'in_inventory'); await reloadHall(); });
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
        <div className="grow" />
        <span className="dim" style={{ fontSize: 13 }}>{rows.length} products with stock · owned value <b className="mono">{fmtMoney(rows.totVal)}</b></span>
      </div>
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
            <th className="last" style={{ width: 150 }} />
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.p.id}>
                <td className="first">{r.p.name}</td>
                <td className="dim" style={{ fontSize: 12 }}>{vmap[r.p.vendor_id]?.name}</td>
                <td className="dimmer" style={{ fontSize: 12 }}>{r.p.type}</td>
                <td className="r mono">{r.p.tickets ? r.p.tickets.toLocaleString() : '—'}</td>
                <td className="r mono dim">${r.p.price_per_ticket || 1}</td>
                <td className="r mono">{fmtMoney(r.p.cost)}</td>
                <td className="r mono"><b>{r.c.inv || 0}</b></td>
                <td className="r mono" style={{ color: 'var(--orange)' }}>{r.c.open || 0}</td>
                <td className="r mono dimmer">{r.c.onorder || 0}</td>
                <td className="r mono">{r.value ? fmtMoney(r.value) : '—'}</td>
                <td style={{ fontSize: 11, color: 'var(--green)' }}>{r.assignedLabel}</td>
                <td className="last r" style={{ whiteSpace: 'nowrap' }}>
                  {editable ? (<>
                    <button className="btn green sm" disabled={r.avail <= 0}
                      onClick={() => { setAssignPid(r.p.id); setAssignQty(1); }}>Assign</button>{' '}
                    <button className="btn orange sm" disabled={(r.c.inv || 0) <= 0} onClick={() => openOne(r)}>Open</button>
                  </>) : <span className="dimmer" style={{ fontSize: 11 }}>read-only</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">No products match.</div>}
      </div>

      {assignPid && (
        <div className="modal-bg" onClick={() => setAssignPid(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>Set aside for a session</div>
            <p className="dim" style={{ fontSize: 12.5, marginBottom: 14 }}>
              {products.find((p) => p.id === assignPid)?.name}
            </p>
            <div className="field"><label>Session (e.g. Fri Night, Sat Matinee)</label>
              <input type="text" value={assignTag} autoFocus onChange={(e) => setAssignTag(e.target.value)} style={{ width: '100%' }} /></div>
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
