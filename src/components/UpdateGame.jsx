import React, { useContext, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { REAL_TYPES, isMisc, isGrabBag } from '../lib/logic/categories.js';
import { needsCost, needsType, needsTickets, needsAnyUpdate } from '../lib/logic/setup.js';

/**
 * Fill in a game's blank fields without leaving the screen you spotted them on.
 *
 * Only blanks are editable here — this is for completing a half-imported record,
 * not for repricing. Changing an existing price stays on Add / Update Games,
 * behind the admin PIN. Changing the type to something that isn't flash drops the
 * ticket requirement, so one edit can clear every "update" tag on the row.
 */
export default function UpdateGame({ product, onClose }) {
  const { store, reloadCatalog, setToast } = useContext(AppCtx);
  const [type, setType] = useState(product.type || '');
  const [cost, setCost] = useState(needsCost(product) ? '' : String(product.cost));
  const [tickets, setTickets] = useState(product.tickets ?? '');
  const [saving, setSaving] = useState(false);

  const costLocked = !needsCost(product);     // already priced — don't reprice here
  // a mixed pack or a cherry case has no single ticket count to ask for
  const wantsTickets = type === 'flash' && !isMisc(product) && !isGrabBag(product);

  // what the row will look like after this save
  const after = useMemo(() => ({
    ...product, type: type || null,
    cost: costLocked ? product.cost : (parseFloat(cost) || 0),
    tickets: wantsTickets ? (parseInt(tickets) || null) : product.tickets,
  }), [product, type, cost, tickets, costLocked, wantsTickets]);

  const stillMissing = [
    needsCost(after) && 'unit cost',
    needsType(after) && 'type',
    needsTickets(after) && 'ticket count',
  ].filter(Boolean);

  const save = async () => {
    if (saving) return;
    const fields = {};
    if (type !== (product.type || '')) fields.type = type || null;
    if (!costLocked) {
      const c = parseFloat(cost);
      if (!(c > 0)) { setToast('Enter a unit cost greater than zero'); return; }
      fields.cost = Math.round(c * 100) / 100;
    }
    if (wantsTickets) {
      const t = tickets === '' ? null : Math.max(0, parseInt(tickets) || 0);
      if (t !== (product.tickets ?? null)) fields.tickets = t;
    }
    if (!Object.keys(fields).length) { onClose(); return; }
    setSaving(true);
    try {
      await store.updateProduct(product.id, fields);
      await reloadCatalog();
      setToast(needsAnyUpdate(after) ? `${product.name} saved — still needs ${stillMissing.join(' and ')}` : `${product.name} is all set`);
      onClose();
    } catch (e) {
      setToast(e.message || 'Could not save that');
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 460 }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>Update game</div>
        <p className="dim" style={{ fontSize: 12.5, marginBottom: 16 }}>{product.name}</p>

        <div className="field"><label>Type</label>
          <select value={type} autoFocus onChange={(e) => setType(e.target.value)} style={{ width: '100%' }}>
            <option value="">— pick a type —</option>
            {REAL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {type && !wantsTickets && (
            <div className="dimmer" style={{ fontSize: 11.5, marginTop: 4 }}>
              {isGrabBag(product) ? 'A mixed pack changes contents each order, so'
                : isMisc(product) ? 'This sells by the ticket, not the box, so'
                : `${type === 'supply' ? 'Supplies' : type[0].toUpperCase() + type.slice(1) + ' games'} sell as a unit, so`}{' '}
              no ticket count is needed.
            </div>
          )}
        </div>

        <div className="field"><label>Unit cost $</label>
          {costLocked ? (
            <div>
              <span className="mono" style={{ fontSize: 16, fontWeight: 700 }}>${Number(product.cost).toFixed(2)}</span>
              <span className="dimmer" style={{ fontSize: 11.5, marginLeft: 10 }}>
                already set — change it on Add / Update Games
              </span>
            </div>
          ) : (
            <input className="num" type="number" min="0" step="0.01" value={cost} placeholder="0.00"
              onChange={(e) => setCost(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()} style={{ width: 130, fontSize: 16 }} />
          )}
        </div>

        {wantsTickets && (
          <div className="field"><label>Tickets per box</label>
            <input className="num" type="number" min="0" value={tickets} placeholder="e.g. 1440"
              onChange={(e) => setTickets(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()} style={{ width: 130, fontSize: 16 }} />
          </div>
        )}

        <div style={{ marginTop: 6, fontSize: 12 }}>
          {stillMissing.length
            ? <span style={{ color: 'var(--gold)' }}>After saving, this game still needs a <b>{stillMissing.join(' and a ')}</b>.</span>
            : <span style={{ color: 'var(--green)', fontWeight: 600 }}>✓ Saving this clears every “update” tag on this game.</span>}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
