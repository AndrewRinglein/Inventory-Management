import React, { useContext, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney, buildDrafts, ticketPrice } from '../lib/logic/po.js';
import { countByProduct } from '../lib/logic/boxes.js';
import { locationShort, shortageAdvice } from '../lib/logic/location.js';
import { GAME_TYPES, MISC_MODES, passesFilters } from '../lib/logic/categories.js';
import { needsCost, needsType, needsTickets, needsVendor } from '../lib/logic/setup.js';
import { priceParts, baseCost, packUnits } from '../lib/logic/pricing.js';
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
    case 'base': return baseCost(p);
    case 'units': return packUnits(p);
    case 'packing': return Number(p.packing_units) || 0;
    case 'cost': return Number(p.cost) || 0;
    case 'live': return (c.inv || 0) + (c.open || 0);
    case 'off': return c.off || 0;
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
  const anyFilter = !!(vendorF || typeF || tixF || priceF || stockF || q || miscF !== 'games');
  const clearFilters = () => {
    setVendorF(''); setTypeF(''); setTixF(''); setPriceF(''); setStockF(''); setQ(''); setMiscF('games');
  };

  const setQty = async (pid, v) => {
    const n = Math.max(0, parseInt(v) || 0);
    await store.setOrderQty(hall, pid, n);
    await reloadHall();
  };

  return (
    <div>
      <div className="page-head" style={{ position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10, paddingTop: 6, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
        <div className="h1">Purchase — {hall === 'sc' ? 'Santa Clara' : 'Redwood City'}</div>
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
      <div className="filter-bar">
        <input type="text" placeholder="Search game…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 190 }} />
        <label>Vendor
          <select value={vendorF} onChange={(e) => setVendorF(e.target.value)}>
            <option value="">All</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select></label>
        <label>Type
          <select value={typeF} onChange={(e) => setTypeF(e.target.value)}>
            {GAME_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select></label>
        <label>Misc
          <select value={miscF} onChange={(e) => setMiscF(e.target.value)} title="Cherry tickets and dauber supplies">
            {MISC_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select></label>
        <label>Tickets
          <select value={tixF} onChange={(e) => setTixF(e.target.value)}>
            {TIX_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
        <label>$ / ticket
          <select value={priceF} onChange={(e) => setPriceF(e.target.value)}>
            <option value="">All</option><option value="1">$1</option><option value="2">$2</option>
          </select></label>
        <label>Stock
          <select value={stockF} onChange={(e) => setStockF(e.target.value)}>
            {STOCK_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
        <div style={{ flex: 1 }} />
        <span className="dimmer" style={{ fontSize: 12 }}>{rows.length} shown</span>
        {anyFilter && <button className="btn ghost sm" onClick={clearFilters}>Clear</button>}
      </div>

      {/* Ship before you buy. The order builder's job is to tell you what you
          NEED; if you already own it somewhere else the answer is a shipment,
          not a purchase order, and nothing else in the app will say so. */}
      {(() => {
        const owned = Object.entries(orderQty)
          .filter(([pid, n]) => n > 0 && (cnt[pid]?.off || 0) > 0)
          .map(([pid, n]) => {
            const p = products.find((x) => x.id === pid);
            const c = cnt[pid] || {};
            return { pid, name: p?.name || pid, want: n, off: c.off || 0, offBy: c.offBy || {} };
          });
        if (!owned.length) return null;
        return (
          <div className="card pad" style={{ marginBottom: 12, background: '#eef7f6', border: '1px solid #9ec9c4' }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
              You already own {owned.reduce((a, o) => a + Math.min(o.want, o.off), 0)} box(es) of what you're ordering
            </div>
            {owned.map((o) => (
              <div key={o.pid} style={{ fontSize: 12.5, marginTop: 2 }}>
                <b>{o.name}</b> — ordering {o.want}, and {o.off} already ours
                ({Object.entries(o.offBy).map(([k, v]) => `${v} ${locationShort(k)}`).join(', ')}).
                {' '}{shortageAdvice(o.want, o.off)}
              </div>
            ))}
          </div>
        );
      })()}

      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr>
            <th className="first sortable" onClick={() => sortBy('name')}>Game{arrow('name')}</th>
            <th className="r sortable" style={{ width: 92 }} onClick={() => sortBy('tickets')}>Tickets{arrow('tickets')}</th>
            <th className="r sortable" style={{ width: 74 }} onClick={() => sortBy('price')}>$ / tkt{arrow('price')}</th>
            <th className="sortable" style={{ width: 150 }} onClick={() => sortBy('vendor')}>Vendor{arrow('vendor')}</th>
            <th className="sortable" style={{ width: 88 }} onClick={() => sortBy('type')}>Type{arrow('type')}</th>
            <th className="r sortable" style={{ width: 92 }} onClick={() => sortBy('base')} title="What one deal costs">Base ${arrow('base')}</th>
            <th className="r sortable" style={{ width: 62 }} onClick={() => sortBy('units')} title="Deals inside one ordered unit — what the base price is quoted against">Deals{arrow('units')}</th>
            <th className="r sortable" style={{ width: 86 }} onClick={() => sortBy('packing')} title="Packing on one ordered unit">Packing{arrow('packing')}</th>
            <th className="r sortable" style={{ width: 106 }} onClick={() => sortBy('cost')} title="Base × deals + packing">Unit total{arrow('cost')}</th>
            <th className="r sortable" style={{ width: 66 }} onClick={() => sortBy('live')}
                title="On the floor at this hall — what can actually be played">Live{arrow('live')}</th>
            <th className="r sortable" style={{ width: 76 }} onClick={() => sortBy('off')}
                title="Already ours, but held by a distributor or sat in storage. Ship it rather than buying more.">Off-site{arrow('off')}</th>
            <th className="r sortable" style={{ width: 78 }} onClick={() => sortBy('onorder')}>On order{arrow('onorder')}</th>
            <th style={{ textAlign: 'center', width: 96 }}>Units</th>
            <th className="r last" style={{ width: 118 }}>Line total</th>
          </tr></thead>
          <tbody>
            {rows.map((p) => {
              const n = orderQty[p.id] || 0;
              const c = cnt[p.id] || {};
              const pp = priceParts(p, vmap[p.vendor_id]);
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
                      : fmtMoney(pp.base)}
                  </td>
                  <td className="r mono dimmer">{pp.multiplied ? `×${pp.units}` : '—'}</td>
                  <td className="r mono">{pp.packing > 0 ? fmtMoney(pp.packing) : <span className="dimmer">—</span>}</td>
                  <td className="r mono">
                    {needsCost(p) ? <span className="dimmer">—</span> : <b>{fmtMoney(pp.allIn)}</b>}
                    {pp.splits && <div className="dimmer" style={{ fontSize: 10.5 }}>→ {pp.split} boxes @ {fmtMoney(pp.perBox)}</div>}
                  </td>
                  <td className="r mono">{(c.inv || 0) + (c.open || 0)}</td>
                  {/* The whole point of the location column: you should never be
                      typing a quantity into a game you already own elsewhere
                      without being told so. */}
                  <td className="r mono" title={(c.off || 0)
                        ? `${Object.entries(c.offBy || {}).map(([k, v]) => `${v} ${locationShort(k)}`).join(', ')} — ship this before buying more`
                        : ''}
                      style={{ color: (c.off || 0) ? 'var(--teal)' : 'inherit', fontWeight: (c.off || 0) ? 700 : 400 }}>
                    {(c.off || 0) || <span className="dimmer">—</span>}
                  </td>
                  <td className="r mono dimmer">{c.onorder || 0}</td>
                  <td style={{ textAlign: 'center' }}>
                    {needsVendor(p)
                      ? <button className="badge b-gold" style={{ border: 0, cursor: 'pointer', font: 'inherit', fontSize: 11, fontWeight: 600 }}
                          title="We don't know who supplies this yet, so there's nobody to send the order to. Click to set the distributor."
                          onClick={() => setUpdPid(p.id)}>needs distributor</button>
                      : <>
                          <input className={'qty' + (needsCost(p) ? ' tbd-qty' : '')} type="number" min="0" value={n || ''} placeholder="" disabled={!editable}
                            title={needsCost(p) ? "You can order this — the PO will show ? and ask the vendor for their price" : ''}
                            onChange={(e) => setQty(p.id, e.target.value)} />
                          {pp.splits && n > 0 && <div className="dimmer" style={{ fontSize: 10.5 }}>= {n * pp.split} boxes</div>}
                        </>}
                  </td>
                  <td className="r mono last">
                    {n ? (needsCost(p) ? <span className="tbd">?</span> : <>
                      <b>{fmtMoney(n * pp.allIn)}</b>
                      {pp.packing > 0 && <div className="dimmer" style={{ fontSize: 10.5 }}>incl. {fmtMoney(n * pp.packing)} packing</div>}
                    </>) : ''}
                  </td>
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
