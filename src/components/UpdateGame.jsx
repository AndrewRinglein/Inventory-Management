import React, { useContext, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { REAL_TYPES, isMisc, isGrabBag } from '../lib/logic/categories.js';
import { needsCost, needsType, needsTickets, needsAnyUpdate } from '../lib/logic/setup.js';
import { ticketPrice, fmtMoney } from '../lib/logic/po.js';
import { priceParts, baseCost, packUnits, splitBoxes, packingFor, round2 } from '../lib/logic/pricing.js';
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

/**
 * The shape a type comes in.
 *
 * Changing a game's type used to leave these alone, so a flash game retyped as
 * a strip stayed 1 deal to a box, packed, counted in boxes — while every other
 * strip in the catalog is 8 deals to a lettered pack with no packing. The type
 * IS the shape; picking one and then hand-fixing four other fields is a step
 * nobody remembers.
 *
 * Strips are 8 more often than not. Some are 16 and a Biker tote is 80, so the
 * fields stay visible and editable and the form says what it changed.
 */
const TYPE_SHAPE = {
  flash:  { pack_units: 1, split_boxes: 1, packing_units: 1, stock_unit: 'box' },
  strip:  { pack_units: 8, split_boxes: 8, packing_units: 0, stock_unit: 'pack' },
  paper:  { pack_units: 1, split_boxes: 1, packing_units: 0, stock_unit: 'box' },
  supply: { pack_units: 1, split_boxes: 1, packing_units: 0, stock_unit: 'dozen' },
};

/** True when the fields still look like the shape they came from — nobody has hand-set them. */
function looksUntouched(f, type) {
  const sh = TYPE_SHAPE[type];
  if (!sh) return true;
  return Number(f.pack_units) === sh.pack_units
      && Number(f.split_boxes) === sh.split_boxes
      && Number(f.packing_units) === sh.packing_units;
}

export default function UpdateGame({ product, onClose }) {
  const { store, reloadCatalog, reloadHall, setToast, vendors, requirePin, can } = useContext(AppCtx);
  const admin = can('editCatalog');

  const [f, setF] = useState({
    name: product.name || '',
    vendor_id: product.vendor_id || '',
    type: product.type || '',
    cost: needsCost(product) ? '' : String(baseCost(product)),
    pack_units: String(packUnits(product)),
    split_boxes: String(splitBoxes(product)),
    tickets: product.tickets ?? '',
    price_per_ticket: String(ticketPrice(product)),
    active: product.active !== false,
    packing_units: String(Number(product.packing_units) || 0),
    stock_unit: product.stock_unit || '',
    // blank means "use the distributor's rate" — 0 is a different, real answer
    packing_rate: product.packing_rate == null || product.packing_rate === ''
      ? '' : String(Number(product.packing_rate)),
  });
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  // Picking a type pulls its shape along, unless someone has already hand-set
  // those fields — then their numbers win and they get told nothing moved.
  const [reshaped, setReshaped] = useState(null);
  const setType = (next) => {
    const sh = TYPE_SHAPE[next];
    setF((s) => {
      if (!sh || !looksUntouched(s, s.type)) { setReshaped(null); return { ...s, type: next }; }
      setReshaped(next);
      return { ...s, type: next,
        pack_units: String(sh.pack_units), split_boxes: String(sh.split_boxes),
        packing_units: String(sh.packing_units), stock_unit: sh.stock_unit };
    });
  };

  const costWasSet = !needsCost(product);
  const vendorName = vendors.find((v) => v.id === product.vendor_id)?.name || '';
  const selectedVendor = vendors.find((v) => v.id === f.vendor_id);
  const packFee = Number(selectedVendor?.packing_fee) || 0;
  const packingUnits = Number(f.packing_units);
  const packingRate = f.packing_rate.trim() === '' ? null : round2(Number(f.packing_rate));
  const packingValid = f.packing_units.trim() !== '' && Number.isSafeInteger(packingUnits) && packingUnits >= 0
    && (packingRate === null || (Number.isFinite(packingRate) && Number(f.packing_rate) >= 0));
  const packingPreview = { packing_units: packingUnits, packing_rate: packingRate };
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
    if (c > 0 && Math.round(c * 100) / 100 !== baseCost(product)) out.base_cost = Math.round(c * 100) / 100;
    const u = Math.max(1, parseInt(f.pack_units) || 1);
    if (admin && u !== packUnits(product)) out.pack_units = u;
    const sb = Math.max(1, parseInt(f.split_boxes) || 1);
    if (admin && sb !== splitBoxes(product)) out.split_boxes = sb;
    if (wantsTickets) {
      const t = f.tickets === '' ? null : Math.max(0, parseInt(f.tickets) || 0);
      if (t !== (product.tickets ?? null)) out.tickets = t;
    }
    if (admin && parseFloat(f.price_per_ticket) !== ticketPrice(product)) {
      out.price_per_ticket = parseFloat(f.price_per_ticket) || 1;
    }
    if (admin && f.active !== (product.active !== false)) out.active = f.active;
    const pu = packingUnits;
    if (admin && pu !== (Number(product.packing_units) || 0)) out.packing_units = pu;
    // '' clears the override back to the distributor's rate; 0 pins it to free
    if (admin && f.stock_unit && f.stock_unit !== product.stock_unit) out.stock_unit = f.stock_unit;
    const pr = packingRate;
    const wasPr = product.packing_rate == null || product.packing_rate === ''
      ? null : Number(product.packing_rate);
    if (admin && pr !== wasPr) out.packing_rate = pr;
    return out;
  };

  const save = async () => {
    if (saving) return;
    if (admin && !f.name.trim()) { setToast('A game needs a name'); return; }
    if (admin && !packingValid) {
      setToast('Enter a whole number of packing units (0 or more) and a packing fee of 0 or more, or leave the fee blank for the distributor default.');
      return;
    }
    const fields = changed();
    if (!Object.keys(fields).length) { onClose(); return; }

    // Custom packing changes future order totals, just like other price changes.
    const touchesMoney = ('base_cost' in fields && costWasSet) || 'price_per_ticket' in fields
      || 'packing_rate' in fields || 'packing_units' in fields || 'pack_units' in fields;
    setSaving(true);
    try {
      if (touchesMoney && !(await requirePin())) return;
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
            onChange={(e) => setType(e.target.value)} style={{ width: '100%' }}>
            <option value="">— pick a type —</option>
            {REAL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {reshaped && TYPE_SHAPE[reshaped] && (
            <div style={{ fontSize: 11.5, marginTop: 5, color: 'var(--green,#2e7d5b)' }}>
              Set to the usual {reshaped} shape — {TYPE_SHAPE[reshaped].pack_units} per unit,
              counted in {TYPE_SHAPE[reshaped].stock_unit}s
              {TYPE_SHAPE[reshaped].packing_units ? ', packed' : ', no packing'}.
              {reshaped === 'strip' && ' Change it to 16 if this one is a 16-pack.'}
            </div>
          )}
          {f.type && !wantsTickets && (
            <div className="dimmer" style={{ fontSize: 11.5, marginTop: 4 }}>
              {isGrabBag(product) ? 'A mixed pack changes contents each order, so'
                : isMisc(product) ? 'This sells by the ticket, not the box, so'
                : `${f.type === 'supply' ? 'Supplies' : f.type[0].toUpperCase() + f.type.slice(1) + ' games'} sell as a unit, so`}{' '}
              no ticket count is needed.
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0 12px' }}>
          <div className="field"><label>Base cost $ (one unit)</label>
            <input className="num" type="number" min="0" step="0.01" value={f.cost} placeholder="0.00"
              autoFocus={needsCost(product) && !needsType(product)}
              onChange={(e) => set('cost', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()} style={{ width: '100%', fontSize: 16 }} />
            {costWasSet && <div className="dimmer" style={{ fontSize: 11, marginTop: 3 }}>Changing this asks for the PIN</div>}
          </div>
          {admin && (
            <div className="field"><label>Units / box</label>
              <input className="num" type="number" min="1" value={f.pack_units}
                onChange={(e) => set('pack_units', e.target.value)} style={{ width: '100%', fontSize: 16 }} /></div>
          )}
          {admin && (
            <div className="field"><label>Boxes per order</label>
              <input className="num" type="number" min="1" value={f.split_boxes}
                title="One ordered unit arrives as this many boxes on the shelf. 1 for almost everything."
                onChange={(e) => set('split_boxes', e.target.value)} style={{ width: '100%', fontSize: 16 }} /></div>
          )}
          {wantsTickets && (
            <div className="field"><label>Tickets per box</label>
              <input className="num" type="number" min="0" value={f.tickets} placeholder="e.g. 1440"
                onChange={(e) => set('tickets', e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()} style={{ width: '100%', fontSize: 16 }} /></div>
          )}
          <div className="field"><label>$ / ticket{!admin && <Locked />}</label>
            <select value={f.price_per_ticket} disabled={!admin}
              onChange={(e) => set('price_per_ticket', e.target.value)} style={{ width: '100%' }}>
              <option value="1">$1</option><option value="2">$2</option>
            </select></div>
        </div>

        {admin && (
          <div className="field">
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Packing / collation</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <label htmlFor="packing-units">Packing units per ordered item</label>
                <input id="packing-units" className="num" type="number" min="0" step="1" value={f.packing_units}
                  onChange={(e) => set('packing_units', e.target.value)} style={{ width: '100%' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor="packing-rate">Custom packing fee ($)</label>
                <input id="packing-rate" className="num" type="number" min="0" step="0.01" value={f.packing_rate}
                  placeholder={String(packFee)} onChange={(e) => set('packing_rate', e.target.value)}
                  style={{ width: '100%' }} />
              </div>
            </div>
            {packingValid && <div style={{ fontSize: 12, marginTop: 8 }}>
              Packing per ordered item: <b>{fmtMoney(packingFor(packingPreview, selectedVendor))}</b>
            </div>}
            <div className="dimmer" style={{ fontSize: 11, marginTop: 4 }}>
              The fee is charged per packing unit. For a flat fee per ordered item, set packing units to 1. Leave the fee blank to use{' '}
              {selectedVendor?.name || 'the distributor'}'s default ({fmtMoney(packFee)} per packing unit).
              {' '}Enter 0 for free packing. This fee is saved on the item and automatically used on future orders.
              {' '}Changing it asks for the PIN. Packing is not taxed.
            </div>
          </div>
        )}

        {admin && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', marginTop: 2 }}>
            <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />
            In use — untick to retire it from ordering. Stock already on the shelf still counts.
          </label>
        )}

        {(parseFloat(f.cost) > 0 && packingValid) && (() => {
          const pp = priceParts({ ...product, base_cost: parseFloat(f.cost) || 0, pack_units: parseInt(f.pack_units) || 1,
                                  type: f.type, split_boxes: parseInt(f.split_boxes) || 1, ...packingPreview }, selectedVendor);
          return (
            <div className="card pad" style={{ marginTop: 4, marginBottom: 4, background: 'var(--bg)' }}>
              <div className="mono" style={{ fontSize: 13 }}>
                {fmtMoney(pp.base)} × {pp.units} = <b>{fmtMoney(pp.box)}</b> per ordered item
                {pp.packing > 0 && <> + {fmtMoney(pp.packing)} packing = <b>{fmtMoney(pp.allIn)}</b></>}
                {pp.splits && <div style={{ marginTop: 3 }}>
                  arrives as <b>{pp.split} boxes</b> at <b>{fmtMoney(pp.perBox)}</b> each
                </div>}
              </div>
              <div className="dimmer" style={{ fontSize: 11 }}>
                base cost × units per box, then packing on top{pp.splits ? ', split across the boxes it becomes' : ''}
              </div>
            </div>
          );
        })()}

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
