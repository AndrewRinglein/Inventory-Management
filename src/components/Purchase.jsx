import React, { useContext, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney, buildDrafts, ticketPrice } from '../lib/logic/po.js';
import { countByProduct } from '../lib/logic/boxes.js';
import { GAME_TYPES, MISC_MODES, passesFilters } from '../lib/logic/categories.js';
import { needsCost, needsType, needsTickets, needsVendor } from '../lib/logic/setup.js';
import { priceParts } from '../lib/logic/pricing.js';
import UpdateGame from './UpdateGame.jsx';

const TIX_FILTERS = [
  ['', 'All'], ['lt1000', '< 1,000'], ['1to2k', '1,000–1,999'],
  ['2to3k', '2,000–2,999'], ['3kplus', '3,000 +'], ['none', 'Needs update'],
];
const tixMatch = (t, sel) => !sel ? true : sel === 'none' ? !(Number(t) > 0) : !t ? false :
  sel === 'lt1000' ? t < 1000 : sel === '1to2k' ? t >= 1000 && t < 2000 :
  sel === '2to3k' ? t >= 2000 && t < 3000 : t >= 3000;

const STOCK_FILTERS = [
  ['', 'All'], ['out', 'Out of stock'], ['low', 'Low (1–2)'],
  ['some', 'In stock'], ['onorder', 'On order'], ['nocost', 'Needs cost'],
];
const stockMatch = (p, live, onorder, sel) =>
  !sel ? true :
  sel === 'out' ? live === 0 :
  sel === 'low' ? live > 0 && live <= 2 :
  sel === 'some' ? live > 0 :
  sel === 'onorder' ? onorder > 0 :
  needsCost(p);

const sortVal = (p, k, cnt) => {
  const c = cnt[p.id] || {};
  switch (k) {
    case 'tickets': return p.tickets || 0;
    case 'price': return ticketPrice(p);
    case 'vendor': return p.vendor_id || '';
    case 'type': return p.type || '';
    case 'cost': return Number(p.cost) || 0;
    case 'live': return (c.inv || 0) + (c.open || 0);
    case 'onorder': return c.onorder || 0;
    default: return p.name.toLowerCase();
  }
};

export default function Purchase() {
  const { hall, products, vendors, boxes, orderQty, store, reloadHall, setScreen, setToast, can } = useContext(AppCtx);
  const editable = can('order');
  const [vendorF, setVendorF] = useState('');
  const [q, setQ] = useState('');
  const [typeF, setTypeF] = useState('');
  const [miscF, setMiscF] = useState('games');
  const [tixF, setTixF] = useState('');
  const [priceF, setPriceF] = useState('');
  const [stockF, setStockF] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [dir, setDir] = useState(1);
  const [updPid, setUpdPid] = useState(null);

  const cnt = useMemo(() => countByProduct(boxes), [boxes]);
  const vmap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);

  // use the same builder the PO uses, so packing charges are in the running total
  const drafts = useMemo(() => buildDrafts(orderQty, products, vendors), [orderQty, products, vendors]);
  const grand = drafts.reduce((a, d) => a + d.total, 0);
  const lineCount = drafts.reduce((a, d) => a + d.lines.filter((l) => l.kind !== 'fee').length, 0);
  const feeTotal = drafts.reduce((a, d) => a + d.lines.filter((l) => l.kind === 'fee').reduce((x, l) => x + l.qty * l.cost, 0), 0);
  const tbdOrdered = drafts.reduce((a, d) => a + d.lines.filter((l) => l.price_tbd).length, 0);

  const Upd = ({ p }) => (
    <button className="badge b-gold" style={{ border: 0, cursor: 'pointer', font: 'inherit', fontSize: 11, fontWeight: 600 }}
      title="Click to fill this in" onClick={() => setUpdPid(p.id)}>update</button>
  );

  const stockOf = (p) => (cnt[p.id]?.inv || 0) + (cnt[p.id]?.open || 0);

  const rows = products
    .filter((p) => p.active !== false)
    .filter((p) => (orderQty[p.id] || 0) > 0 || (   // anything already on the order always shows
      (!vendorF || p.vendor_id === vendorF) &&
      (!q || p.name.toLowerCase().includes(q.toLowerCase())) &&
      passesFilters(p, { type: typeF, misc: miscF }) &&
      tixMatch(p.tickets, tixF) &&
      (!priceF || String(ticketPrice(p)) === priceF) &&
      stockMatch(p, stockOf(p), cnt[p.id]?.onorder || 0, stockF)
    ))
    .sort((a, b) => {
      const x = sortVal(a, sortKey, cnt), y = sortVal(b, sortKey, cnt);
      const d = typeof x === 'string' ? x.localeCompare(y) : (x || 0) - (y || 0);
      return d * dir || a.name.localeCompare(b.name);
    });

  const sortBy = (k) => { if (k === sortKey) setDir(-dir); else { setSortKey(k); setDir(1); } };
  const arrow = (k) => (k === sortKey ? (dir > 0 ? ' ▲' : ' ▼') : '');
  const stop = (e) => e.stopPropagation();

  const setQty = async (pid, v) => {
    const n = Math.max(0, parseInt(v) || 0);
    await store.setOrderQty(hall, pid, n);
    await reloadHall();
  };

  return (
    <div>
      <div className="page-head" style={{ position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10, paddingTop: 6, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
        <div className="h1">Purchase — {hall === 'sc' ? 'Santa Clara' : 'Redwood City'}</div>
        {(vendorF || typeF || tixF || priceF || stockF || q || miscF !== 'games') && (
          <button className="btn ghost sm" onClick={() => { setVendorF(''); setTypeF(''); setTixF(''); setPriceF(''); setStockF(''); setQ(''); setMiscF('games'); }}>
            Clear filters
          </button>
        )}
        <span className="dimmer" style={{ fontSize: 12 }}>{rows.length} shown</span>
        <div className="grow" />
        <span className="dim" style={{ fontSize: 13 }}>
          {lineCount ? `${lineCount} lines` : 'Enter quantities to build an order'}
          {feeTotal > 0 && <span className="dimmer"> · incl. {fmtMoney(feeTotal)} packing</span>}
        </span>
        <span className="mono" style={{ fontWeight: 700, fontSize: 16 }}>
          {lineCount ? (tbdOrdered ? `${fmtMoney(grand)} +?` : fmtMoney(grand)) : ''}
        </span>
        <button className="btn primary" disabled={!lineCount || !editable} onClick={() => setScreen('review')}
          title={editable ? '' : 'Your role cannot place orders for this hall'}>Review order →</button>
      </div>
      {tbdOrdered > 0 && (
        <div className="demo-banner" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>
            <b>{tbdOrdered} line{tbdOrdered === 1 ? '' : 's'} on this order {tbdOrdered === 1 ? 'has' : 'have'} no price yet.</b>{' '}
            {tbdOrdered === 1 ? 'It' : 'They'}'ll go out as “?” and the email asks the distributor to send at their list price
            and put the figure on the invoice. The total below covers the priced lines only.
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost sm" onClick={() => setScreen('games')}>Enter prices instead →</button>
        </div>
      )}
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr>
            <th className="first sortable" onClick={() => sortBy('name')}>
              <div>Game{arrow('name')}</div>
              <input type="text" placeholder="Search…" value={q} onClick={stop}
                onChange={(e) => setQ(e.target.value)} style={{ fontWeight: 400, marginTop: 3, width: 190 }} />
            </th>
            <th className="r sortable" style={{ width: 118 }} onClick={() => sortBy('tickets')}>
              <div>Tickets{arrow('tickets')}</div>
              <select value={tixF} onClick={stop} onChange={(e) => setTixF(e.target.value)} style={{ fontWeight: 400, marginTop: 3, width: '100%' }}>
                {TIX_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </th>
            <th className="r sortable" style={{ width: 86 }} onClick={() => sortBy('price')}>
              <div>$ / ticket{arrow('price')}</div>
              <select value={priceF} onClick={stop} onChange={(e) => setPriceF(e.target.value)} style={{ fontWeight: 400, marginTop: 3, width: '100%' }}>
                <option value="">All</option><option value="1">$1</option><option value="2">$2</option>
              </select>
            </th>
            <th className="sortable" style={{ width: 150 }} onClick={() => sortBy('vendor')}>
              <div>Vendor{arrow('vendor')}</div>
              <select value={vendorF} onClick={stop} onChange={(e) => setVendorF(e.target.value)} style={{ fontWeight: 400, marginTop: 3, width: '100%' }}>
                <option value="">All</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </th>
            <th className="sortable" style={{ width: 118 }} onClick={() => sortBy('type')}>
              <div>Type{arrow('type')}</div>
              <select value={typeF} onClick={stop} onChange={(e) => setTypeF(e.target.value)} style={{ fontWeight: 400, marginTop: 3, width: '100%' }}>
                {GAME_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </th>
            <th className="r sortable" style={{ width: 96 }} onClick={() => sortBy('cost')}>
              <div>Unit cost{arrow('cost')}</div>
              <select value={miscF} onClick={stop} onChange={(e) => setMiscF(e.target.value)} style={{ fontWeight: 400, marginTop: 3, width: '100%' }} title="Cherry tickets and dauber supplies">
                {MISC_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </th>
            <th className="r sortable" style={{ width: 110 }} onClick={() => sortBy('live')}>
              <div>Live{arrow('live')}</div>
              <select value={stockF} onClick={stop} onChange={(e) => setStockF(e.target.value)} style={{ fontWeight: 400, marginTop: 3, width: '100%' }}>
                {STOCK_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </th>
            <th className="r sortable" onClick={() => sortBy('onorder')}>On order{arrow('onorder')}</th>
            <th style={{ textAlign: 'center' }}>Order qty</th><th className="r last">Line total</th>
          </tr></thead>
          <tbody>
            {rows.map((p) => {
              const n = orderQty[p.id] || 0;
              const c = cnt[p.id] || {};
              return (
                <tr key={p.id} className={n ? 'hl' : ''}>
                  <td className="first">{p.name}</td>
                  <td className="r mono">{needsTickets(p) ? <Upd p={p} /> : (p.tickets ? p.tickets.toLocaleString() : '—')}</td>
                  <td className="r mono dim">${ticketPrice(p)}</td>
                  <td className="dim" style={{ fontSize: 12 }}>
                    {needsVendor(p) ? <Upd p={p} /> : vmap[p.vendor_id]?.name}
                  </td>
                  <td className="dimmer" style={{ fontSize: 12 }}>{needsType(p) ? <Upd p={p} /> : p.type}</td>
                  <td className="r mono">
                    {needsCost(p)
                      ? <button className="tbd" title="No price on our side — the PO goes out with a ? and the vendor fills it in. Click to enter it now."
                          onClick={() => setUpdPid(p.id)}>?</button>
                      : (() => {
                          const pp = priceParts(p, vmap[p.vendor_id]);
                          return (
                            <span title={`${fmtMoney(pp.base)} per unit × ${pp.units}${pp.packing ? ` + ${fmtMoney(pp.packing)} packing` : ''}`}>
                              {fmtMoney(pp.box)}
                              {(pp.multiplied || pp.packing > 0) && (
                                <div className="dimmer" style={{ fontSize: 10.5 }}>
                                  {pp.multiplied && `${fmtMoney(pp.base)} ×${pp.units}`}
                                  {pp.packing > 0 && ` +${fmtMoney(pp.packing)} pk`}
                                </div>
                              )}
                            </span>
                          );
                        })()}
                  </td>
                  <td className="r mono">{(c.inv || 0) + (c.open || 0)}</td>
                  <td className="r mono dimmer">{c.onorder || 0}</td>
                  <td style={{ textAlign: 'center' }}>
                    {needsVendor(p)
                      ? <button className="badge b-gold" style={{ border: 0, cursor: 'pointer', font: 'inherit', fontSize: 11, fontWeight: 600 }}
                          title="We don't know who supplies this yet, so there's nobody to send the order to. Click to set the distributor."
                          onClick={() => setUpdPid(p.id)}>needs distributor</button>
                      : <input className={'qty' + (needsCost(p) ? ' tbd-qty' : '')} type="number" min="0" value={n || ''} placeholder="" disabled={!editable}
                          title={needsCost(p) ? "You can order this — the PO will show ? and ask the vendor for their price" : ''}
                          onChange={(e) => setQty(p.id, e.target.value)} />}
                  </td>
                  <td className="r mono last">{n ? (needsCost(p) ? <span className="tbd">?</span> : fmtMoney(n * p.cost)) : ''}</td>
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
