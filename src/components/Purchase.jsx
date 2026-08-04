import React, { useContext, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney } from '../lib/logic/po.js';
import { countByProduct } from '../lib/logic/boxes.js';

export default function Purchase() {
  const { hall, products, vendors, boxes, orderQty, store, reloadHall, setScreen, setToast, can } = useContext(AppCtx);
  const editable = can('order');
  const [vendorF, setVendorF] = useState('');
  const [q, setQ] = useState('');

  const cnt = useMemo(() => countByProduct(boxes), [boxes]);
  const vmap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);

  let grand = 0, lineCount = 0;
  for (const [pid, n] of Object.entries(orderQty)) {
    if (!(n > 0)) continue;
    const p = products.find((x) => x.id === pid);
    if (!p) continue;
    lineCount++;
    grand += n * p.cost * (1 + (vmap[p.vendor_id]?.tax_rate || 0));
  }

  const rows = products
    .filter((p) => p.active !== false)
    .filter((p) => !vendorF || p.vendor_id === vendorF)
    .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const setQty = async (pid, v) => {
    const n = Math.max(0, parseInt(v) || 0);
    await store.setOrderQty(hall, pid, n);
    await reloadHall();
  };

  return (
    <div>
      <div className="page-head" style={{ position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10, paddingTop: 6, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
        <div className="h1">Purchase — {hall === 'sc' ? 'Santa Clara' : 'Redwood City'}</div>
        <select value={vendorF} onChange={(e) => setVendorF(e.target.value)}>
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <input type="text" placeholder="Search game…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 180 }} />
        <div className="grow" />
        <span className="dim" style={{ fontSize: 13 }}>{lineCount ? `${lineCount} lines` : 'Enter quantities to build an order'}</span>
        <span className="mono" style={{ fontWeight: 700, fontSize: 16 }}>{lineCount ? fmtMoney(grand) : ''}</span>
        <button className="btn primary" disabled={!lineCount || !editable} onClick={() => setScreen('review')}
          title={editable ? '' : 'Your role cannot place orders for this hall'}>Review order →</button>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr>
            <th className="first">Game</th><th className="r">Tickets</th><th className="r">$ / ticket</th>
            <th>Vendor</th><th>Type</th><th className="r">Unit cost</th>
            <th className="r">Live</th><th className="r">On order</th>
            <th style={{ textAlign: 'center' }}>Order qty</th><th className="r last">Line total</th>
          </tr></thead>
          <tbody>
            {rows.map((p) => {
              const n = orderQty[p.id] || 0;
              const c = cnt[p.id] || {};
              return (
                <tr key={p.id} className={n ? 'hl' : ''}>
                  <td className="first">{p.name}</td>
                  <td className="r mono">{p.tickets ? p.tickets.toLocaleString() : '—'}</td>
                  <td className="r mono dim">${p.price_per_ticket || 1}</td>
                  <td className="dim" style={{ fontSize: 12 }}>{vmap[p.vendor_id]?.name}</td>
                  <td className="dimmer" style={{ fontSize: 12 }}>{p.type}</td>
                  <td className="r mono">{fmtMoney(p.cost)}</td>
                  <td className="r mono">{(c.inv || 0) + (c.open || 0)}</td>
                  <td className="r mono dimmer">{c.onorder || 0}</td>
                  <td style={{ textAlign: 'center' }}>
                    <input className="qty" type="number" min="0" value={n || ''} placeholder="" disabled={!editable}
                      onChange={(e) => setQty(p.id, e.target.value)} />
                  </td>
                  <td className="r mono last">{n ? fmtMoney(n * p.cost) : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">No games match.</div>}
      </div>
    </div>
  );
}
