import React, { useContext, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { needsCost, needsType, needsTickets, needsAnyUpdate, productsNeedingUpdate } from '../lib/logic/setup.js';
import { REAL_TYPES } from '../lib/logic/categories.js';
import { ticketPrice, fmtMoney } from '../lib/logic/po.js';
import { priceParts } from '../lib/logic/pricing.js';
import AskDistributor from './AskDistributor.jsx';
import UpdateGame from './UpdateGame.jsx';

const TIX_FILTERS = [
  ['', 'All'], ['lt1000', 'Under 1,000'], ['1to2k', '1,000 – 1,999'],
  ['2to3k', '2,000 – 2,999'], ['3kplus', '3,000 +'], ['none', 'No count'],
];
const tixMatch = (t, sel) => !sel ? true : sel === 'none' ? !t : !t ? false :
  sel === 'lt1000' ? t < 1000 : sel === '1to2k' ? t >= 1000 && t < 2000 :
  sel === '2to3k' ? t >= 2000 && t < 3000 : t >= 3000;

export default function Games() {
  const { products, vendors, store, reloadCatalog, setToast, requirePin, can } = useContext(AppCtx);
  const editable = can('editCatalog');   // super admin only, by decision
  const [q, setQ] = useState('');
  const [vendorF, setVendorF] = useState('');
  const [tixF, setTixF] = useState('');
  const [priceF, setPriceF] = useState('');
  const [showOrig, setShowOrig] = useState(false);
  const [onlyUnpriced, setOnlyUnpriced] = useState(false);
  const [asking, setAsking] = useState(false);
  const [editPid, setEditPid] = useState(null);
  const [ng, setNg] = useState({ name: '', vendor_id: 'bv', type: 'flash', cost: '', tickets: '', price: '1' });

  const vmap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);

  const unpriced = useMemo(() => productsNeedingUpdate(products), [products]);

  const rows = products
    .filter((p) => !onlyUnpriced || needsAnyUpdate(p))
    .filter((p) => !vendorF || p.vendor_id === vendorF)
    .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
    .filter((p) => !priceF || String(ticketPrice(p)) === priceF)
    .filter((p) => tixMatch(p.tickets, tixF))
    .sort((a, b) => a.name.localeCompare(b.name));

  const edit = async (p, field, value) => {
    if (!editable) return;
    let v = value;
    if (field === 'cost') {
      if (!(await requirePin())) return;   // price changes are PIN-protected
      v = Math.round((parseFloat(v) || 0) * 100) / 100;
    }
    if (field === 'price_per_ticket') { if (!(await requirePin())) return; v = parseFloat(v) || 1; }
    if (field === 'tickets') v = v === '' ? null : Math.max(0, parseInt(v) || 0);
    if (field === 'base_cost') { if (!(await requirePin())) return; v = Math.round((parseFloat(v) || 0) * 100) / 100; }
    if (field === 'pack_units') { if (!(await requirePin())) return; v = Math.max(1, parseInt(v) || 1); }
    if (field === 'name' && !String(v).trim()) { setToast('Name cannot be empty'); return; }
    await store.updateProduct(p.id, { [field]: v });
    await reloadCatalog();
    setToast('Saved');
  };

  const addGame = async () => {
    if (!editable) return;
    if (!ng.name.trim()) { setToast('Enter a game name'); return; }
    const cost = parseFloat(ng.cost);
    if (!(cost > 0)) { setToast('Enter a unit cost'); return; }
    await store.addProduct({
      vendor_id: ng.vendor_id, name: ng.name.trim(), orig_name: '', type: ng.type,
      cost: Math.round(cost * 100) / 100,
      tickets: parseInt(ng.tickets) || null,
      price_per_ticket: parseFloat(ng.price) || 1,
    });
    await reloadCatalog();
    setNg({ ...ng, name: '', cost: '', tickets: '' });
    setToast(`Game added to ${vmap[ng.vendor_id]?.name}`);
  };

  return (
    <div>
      {asking && <AskDistributor onClose={() => setAsking(false)} />}
      {editPid && <UpdateGame product={products.find((p) => p.id === editPid)} onClose={() => setEditPid(null)} />}
      <div className="page-head">
        <div className="h1">{editable ? 'Add / Update Games' : 'Game Catalog'}</div>
        {!editable && <span className="badge b-gray">read-only — catalog edits are Super Admin only</span>}
        <div className="grow" />
        {can('send') && (
          <button className="btn primary" onClick={() => setAsking(true)}
            title="Email each distributor asking for their current prices and ticket counts">
            ✉ Ask distributors for prices
          </button>
        )}
      </div>

      {editable && <div className="card pad" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--ink-2)', marginBottom: 10 }}>Add a new game</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 2, minWidth: 200, margin: 0 }}><label>Game name</label>
            <input type="text" value={ng.name} placeholder="e.g. Lucky Sevens" onChange={(e) => setNg({ ...ng, name: e.target.value })} style={{ width: '100%' }} /></div>
          <div className="field" style={{ width: 180, margin: 0 }}><label>Vendor</label>
            <select value={ng.vendor_id} onChange={(e) => setNg({ ...ng, vendor_id: e.target.value })} style={{ width: '100%' }}>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select></div>
          <div className="field" style={{ width: 120, margin: 0 }}><label>Type</label>
            <select value={ng.type} onChange={(e) => setNg({ ...ng, type: e.target.value })} style={{ width: '100%' }}>
              {REAL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select></div>
          <div className="field" style={{ width: 100, margin: 0 }}><label>Unit cost $</label>
            <input className="num" type="number" min="0" step="0.01" value={ng.cost} onChange={(e) => setNg({ ...ng, cost: e.target.value })} style={{ width: '100%' }} /></div>
          <div className="field" style={{ width: 95, margin: 0 }}><label>Tickets</label>
            <input className="num" type="number" min="0" value={ng.tickets} placeholder="—" onChange={(e) => setNg({ ...ng, tickets: e.target.value })} style={{ width: '100%' }} /></div>
          <div className="field" style={{ width: 85, margin: 0 }}><label>$ / ticket</label>
            <select value={ng.price} onChange={(e) => setNg({ ...ng, price: e.target.value })} style={{ width: '100%' }}>
              <option value="1">$1</option><option value="2">$2</option>
            </select></div>
          <button className="btn green" onClick={addGame}>+ Add game</button>
        </div>
      </div>}

      {unpriced.length > 0 && (
        <div className="demo-banner" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>
            <b>{unpriced.length} item{unpriced.length === 1 ? '' : 's'} need updating.</b>{' '}
            Anything marked <b>update</b> is a blank field. Items without a unit cost are counted in
            inventory but can't be ordered or received until one is set.
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost sm" onClick={() => setOnlyUnpriced(!onlyUnpriced)}>
            {onlyUnpriced ? 'Show all games' : 'Show only these →'}
          </button>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showOrig} onChange={(e) => setShowOrig(e.target.checked)} />
          Show original names
        </label>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr>
            <th className="first">
              <div>Game</div>
              <input type="text" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ fontWeight: 400, marginTop: 3, maxWidth: 220 }} />
            </th>
            <th style={{ width: 120 }}>
              <div>Tickets</div>
              <select value={tixF} onChange={(e) => setTixF(e.target.value)} style={{ fontWeight: 400, marginTop: 3, width: '100%' }}>
                {TIX_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </th>
            <th style={{ width: 175 }}>
              <div>Vendor</div>
              <select value={vendorF} onChange={(e) => setVendorF(e.target.value)} style={{ fontWeight: 400, marginTop: 3, width: '100%' }}>
                <option value="">All</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </th>
            <th style={{ width: 56 }}>ID</th>
            {showOrig && <th style={{ width: 210 }}>Orig name</th>}
            <th style={{ width: 100 }}>Type</th>
            <th style={{ width: 96 }}>Base $</th>
            <th style={{ width: 52 }} title="Units per box">×</th>
            <th className="r" style={{ width: 92 }} title="Packing charged on this box">Packing</th>
            <th className="r" style={{ width: 104 }}>Box cost</th>
            <th style={{ width: 82 }}>
              <div>$ / ticket</div>
              <select value={priceF} onChange={(e) => setPriceF(e.target.value)} style={{ fontWeight: 400, marginTop: 3, width: '100%' }}>
                <option value="">All</option><option value="1">$1</option><option value="2">$2</option>
              </select>
            </th>
            <th className="last" style={{ width: 60 }} />
          </tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="first">
                  <input className="cell" disabled={!editable} defaultValue={p.name} key={p.id + p.name}
                    onBlur={(e) => e.target.value !== p.name && edit(p, 'name', e.target.value)} />
                </td>
                <td>
                  <input className={'cell num' + (needsTickets(p) ? ' needs-update' : '')} type="number" min="0"
                    placeholder={needsTickets(p) ? 'update' : '—'} title={needsTickets(p) ? 'No ticket count yet' : ''}
                    disabled={!editable} defaultValue={p.tickets ?? ''} key={p.id + '_t' + p.tickets}
                    onBlur={(e) => String(p.tickets ?? '') !== e.target.value && edit(p, 'tickets', e.target.value)} style={{ width: 90 }} />
                </td>
                <td>
                  <select value={p.vendor_id} disabled={!editable} onChange={(e) => edit(p, 'vendor_id', e.target.value)}
                    style={{ fontSize: 12, padding: '3px 4px', width: '100%' }}
                    title="Move this game to another distributor — future orders go to them">
                    {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </td>
                <td className="mono dimmer" style={{ fontSize: 11 }}>{p.id}</td>
                {showOrig && <td className="dimmer" style={{ fontSize: 11 }}>{p.orig_name}</td>}
                <td>
                  <select value={needsType(p) ? '' : p.type} disabled={!editable} onChange={(e) => e.target.value && edit(p, 'type', e.target.value)}
                    className={needsType(p) ? 'needs-update' : ''} title={needsType(p) ? 'Type not set yet' : ''}
                    style={{ fontSize: 12, padding: '3px 4px', width: '100%' }}>
                    {needsType(p) && <option value="">update</option>}
                    {REAL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </td>
                <td>
                  <input className={'cell num' + (needsCost(p) ? ' needs-update' : '')} type="number" min="0" step="0.01"
                    placeholder={needsCost(p) ? 'update' : ''} title={needsCost(p) ? 'No cost yet — the PO prints ? and asks' : 'What one unit costs'}
                    disabled={!editable} defaultValue={needsCost(p) ? '' : priceParts(p, vmap[p.vendor_id]).base}
                    key={p.id + '_b' + p.base_cost}
                    onBlur={(e) => String(priceParts(p, vmap[p.vendor_id]).base) !== e.target.value && edit(p, 'base_cost', e.target.value)}
                    style={{ width: 80 }} />
                </td>
                <td>
                  <input className="cell num" type="number" min="1" disabled={!editable}
                    title="Units per box — the base cost is multiplied by this"
                    defaultValue={priceParts(p, vmap[p.vendor_id]).units} key={p.id + '_u' + p.pack_units}
                    onBlur={(e) => String(priceParts(p, vmap[p.vendor_id]).units) !== e.target.value && edit(p, 'pack_units', e.target.value)}
                    style={{ width: 46 }} />
                </td>
                <td className="r mono dimmer" style={{ fontSize: 11.5 }}>
                  {priceParts(p, vmap[p.vendor_id]).packing > 0
                    ? fmtMoney(priceParts(p, vmap[p.vendor_id]).packing) : '—'}
                </td>
                <td className="r mono"><b>{needsCost(p) ? '—' : fmtMoney(priceParts(p, vmap[p.vendor_id]).box)}</b></td>
                <td>
                  <select value={String(ticketPrice(p))} disabled={!editable} onChange={(e) => edit(p, 'price_per_ticket', e.target.value)}
                    style={{ fontSize: 12, padding: '3px 4px', width: '100%' }} className="mono">
                    <option value="1">$1</option><option value="2">$2</option>
                  </select>
                </td>
                <td className="last" style={{ whiteSpace: 'nowrap' }}>
                  {editable && <><button className="btn ghost sm" onClick={() => setEditPid(p.id)}
                    title="Edit everything about this game">Edit</button>{' '}</>}
                  {needsCost(p)
                    ? <span className="badge b-gold" title="Set a unit cost to make this orderable">can't order</span>
                    : (p.id.startsWith('C') && <span className="badge b-green">new</span>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">No games match.</div>}
      </div>
      {editable && <p className="muted-note">Changes apply to the whole catalog (both halls). Prices already locked onto sent POs are not affected. Price edits ask for the admin PIN.</p>}
    </div>
  );
}
