import React, { useContext, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { REAL_TYPES, isMisc, isGrabBag } from '../lib/logic/categories.js';
import { needsCost, needsType, needsTickets, needsAnyUpdate } from '../lib/logic/setup.js';
import { ticketPrice, fmtMoney } from '../lib/logic/po.js';
import AskDistributor from './AskDistributor.jsx';

/**
 * Edit a game without leaving the screen you're on.
 *
 * Two jobs in one dialog, because to the person at the desk they're the same job:
 * filling in what a half-imported record is missing, and correcting something that
 * turned out to be wrong — a typo'd name, the wrong distributor, a stale price.
 *
 * The one line that stays drawn: filling a BLANK field is open to anyone who keeps
 * the shelves, since a blank blocks their work and there's nothing to lose. Changing
 * a value that already exists is Super Admin, and changing money asks for the PIN —
 * a price edit follows through onto every future PO.
 */
export default function UpdateGame({ product, onClose }) {
  const { store, reloadCatalog, reloadHall, setToast, vendors, requirePin, can } = useContext(AppCtx);
  const admin = can('editCatalog');

  const [f, setF] = useState({
    name: product.name || '',
    vendor_id: product.vendor_id || '',
    type: product.type || '',
    cost: needsCost(product) ? '' : String(product.cost),
    tickets: product.tickets ?? '',
    price_per_ticket: String(ticketPrice(product)),
    active: product.active !== false,
    packing_units: String(Number(product.packing_units) || 0),
  });
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const costWasSet = !needsCost(product);
  const vendorName = vendors.find((v) => v.id === product.vendor_id)?.name || '';
  // only worth showing where the distributor actually charges packing
  const packFee = Number(vendors.find((v) => v.id === f.vendor_id)?.packing_fee) || 0;
  // a mixed pack or a cherry case has no single ticket count to ask for
  const wantsTickets = f.type === 'flash' && !isMisc(product) && !isGrabBag(product);

  // what the row will look like after this save
  const after = useMemo(() => ({
    ...product,
    name: f.name, vendor_id: f.vendor_id, type: f.type || null,
    cost: parseFloat(f.cost) || 0,
    tickets: wantsTickets ? (parseInt(f.tickets) || null) : product.tickets,
  }), [product, f, wantsTickets]);

  const stillMissing = [
    needsCost(after) && 'unit cost',
    needsType(after) && 'type',
    needsTickets(after) && 'ticket count',
  ].filter(Boolean);

  /** Only send what actually changed, so an untouched field can't overwrite anything. */
  const changed = () => {
    const out = {};
    if (admin && f.name.trim() && f.name !== product.name) out.name = f.name.trim();
    if (admin && f.vendor_id !== product.vendor_id) out.vendor_id = f.vendor_id;
    if (f.type !== (product.type || '')) out.type = f.type || null;
    const c = parseFloat(f.cost);
    if (c > 0 && Math.round(c * 100) / 100 !== Number(product.cost)) out.cost = Math.round(c * 100) / 100;
    if (wantsTickets) {
      const t = f.tickets === '' ? null : Math.max(0, parseInt(f.tickets) || 0);
      if (t !== (product.tickets ?? null)) out.tickets = t;
    }
    if (admin && parseFloat(f.price_per_ticket) !== ticketPrice(product)) {
      out.price_per_ticket = parseFloat(f.price_per_ticket) || 1;
    }
    if (admin && f.active !== (product.active !== false)) out.active = f.active;
    const pu = Math.max(0, parseInt(f.packing_units) || 0);
    if (admin && pu !== (Number(product.packing_units) || 0)) out.packing_units = pu;
    return out;
  };

  const save = async () => {
    if (saving) return;
    if (admin && !f.name.trim()) { setToast('A game needs a name'); return; }
    const fields = changed();
    if (!Object.keys(fields).length) { onClose(); return; }

    // repricing something that already had a price, or moving the $/ticket, is PIN-gated
    const touchesMoney = ('cost' in fields && costWasSet) || 'price_per_ticket' in fields;
    if (touchesMoney && !(await requirePin())) return;

    setSaving(true);
    try {
      await store.updateProduct(product.id, fields);
      await reloadCatalog();
      await reloadHall?.();
      const what = Object.keys(fields).length === 1 ? 'Saved' : `Saved ${Object.keys(fields).length} changes`;
      setToast(needsAnyUpdate(after) ? `${what} — still needs ${stillMissing.join(' and ')}` : `${product.name} is all set`);
      onClose();
    } catch (e) {
      setToast(e.message || 'Could not save that');
    } finally { setSaving(false); }
  };

  const Locked = () => <span className="dimmer" style={{ fontSize: 11 }}> · Super Admin only</span>;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 500, maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>Edit game</div>
        <p className="dim" style={{ fontSize: 12.5, marginBottom: 14 }}>
          {product.name}
          <span className="mono dimmer" style={{ marginLeft: 8, fontSize: 11 }}>{product.id}</span>
        </p>

        <div className="field"><label>Name{!admin && <Locked />}</label>
          <input type="text" value={f.name} disabled={!admin}
            onChange={(e) => set('name', e.target.value)} style={{ width: '100%' }} /></div>

        <div className="field"><label>Distributor{!admin && <Locked />}</label>
          <select value={f.vendor_id} disabled={!admin}
            onChange={(e) => set('vendor_id', e.target.value)} style={{ width: '100%' }}>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          {admin && f.vendor_id !== product.vendor_id && (
            <div style={{ fontSize: 11.5, marginTop: 4, color: 'var(--gold)' }}>
              Future orders for this game will go to {vendors.find((v) => v.id === f.vendor_id)?.name}.
              Orders already sent keep the distributor they went out with.
            </div>
          )}
        </div>

        <div className="field"><label>Type</label>
          <select value={f.type} autoFocus={needsType(product)}
            onChange={(e) => set('type', e.target.value)} style={{ width: '100%' }}>
            <option value="">— pick a type —</option>
            {REAL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {f.type && !wantsTickets && (
            <div className="dimmer" style={{ fontSize: 11.5, marginTop: 4 }}>
              {isGrabBag(product) ? 'A mixed pack changes contents each order, so'
                : isMisc(product) ? 'This sells by the ticket, not the box, so'
                : `${f.type === 'supply' ? 'Supplies' : f.type[0].toUpperCase() + f.type.slice(1) + ' games'} sell as a unit, so`}{' '}
              no ticket count is needed.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label>Unit cost $</label>
            <input className="num" type="number" min="0" step="0.01" value={f.cost} placeholder="0.00"
              autoFocus={needsCost(product) && !needsType(product)}
              onChange={(e) => set('cost', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()} style={{ width: '100%', fontSize: 16 }} />
            {costWasSet && <div className="dimmer" style={{ fontSize: 11, marginTop: 3 }}>Changing this asks for the PIN</div>}
          </div>
          {wantsTickets && (
            <div className="field" style={{ flex: 1 }}><label>Tickets per box</label>
              <input className="num" type="number" min="0" value={f.tickets} placeholder="e.g. 1440"
                onChange={(e) => set('tickets', e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()} style={{ width: '100%', fontSize: 16 }} /></div>
          )}
          <div className="field" style={{ width: 110 }}><label>$ / ticket{!admin && <Locked />}</label>
            <select value={f.price_per_ticket} disabled={!admin}
              onChange={(e) => set('price_per_ticket', e.target.value)} style={{ width: '100%' }}>
              <option value="1">$1</option><option value="2">$2</option>
            </select></div>
        </div>

        {admin && packFee > 0 && (
          <div className="field"><label>Packing units per box</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input className="num" type="number" min="0" value={f.packing_units}
                onChange={(e) => set('packing_units', e.target.value)} style={{ width: 90 }} />
              <span className="dimmer" style={{ fontSize: 11.5 }}>
                {vendorName} charges {fmtMoney(packFee)} per unit — this box would add{' '}
                <b>{fmtMoney(packFee * (parseInt(f.packing_units) || 0))}</b>. Flash is 1, a 10-pack case is 80,
                an ordinary strip is 0.
              </span>
            </div>
          </div>
        )}

        {admin && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', marginTop: 2 }}>
            <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />
            In use — untick to retire it from ordering. Stock already on the shelf still counts.
          </label>
        )}

        <div style={{ marginTop: 10, fontSize: 12 }}>
          {stillMissing.length
            ? <span style={{ color: 'var(--gold)' }}>After saving, this game still needs a <b>{stillMissing.join(' and a ')}</b>.</span>
            : <span style={{ color: 'var(--green)', fontWeight: 600 }}>✓ Nothing left to fill in on this game.</span>}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
          <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          {can('send') && (
            <button className="btn ghost" onClick={() => setAsking(true)}
              title="Email the distributor asking for this game's price and ticket count">
              ✉ Ask {vendorName || 'the distributor'}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>

        {!admin && (
          <p className="muted-note" style={{ marginTop: 8 }}>
            You can fill in what's missing. Renaming a game, moving it to another distributor
            or changing an existing price is Super Admin.
          </p>
        )}

        {asking && <AskDistributor preselect={product.id} onClose={() => setAsking(false)} />}
      </div>
    </div>
  );
}
