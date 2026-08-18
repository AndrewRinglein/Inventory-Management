import React, { useContext, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney } from '../lib/logic/po.js';
import { perBoxValue, stockUnit } from '../lib/logic/pricing.js';
import { isFloor } from '../lib/logic/location.js';

/**
 * Record a stock change and say why.
 *
 * The case this exists for is the swap: a distributor is out of Whole Enchiladas
 * and hands over an American Heroes instead. Entered as two separate corrections
 * those rows only connect in the head of whoever typed both, and if one is later
 * reversed the other quietly lies. Here it is ONE record with a line out and a
 * line in, so the history reads "swapped 1 Whole Enchiladas for 1 American
 * Heroes" and stays true.
 *
 * Counts are not forced to balance. Distributors hand over two of something for
 * one of something else often enough that a balance rule would only teach people
 * to type numbers that aren't true.
 */

export const REASONS = [
  { id: 'swap',     label: 'Swap',                  hint: 'Distributor substituted one game for another', twoSided: true },
  { id: 'damaged',  label: 'Damaged',               hint: 'Unsellable — torn, water, printing' },
  { id: 'miscount', label: 'Miscount',              hint: 'The shelf and the system disagree, no other explanation' },
  { id: 'found',    label: 'Found',                 hint: 'Turned up in the back room' },
  { id: 'returned', label: 'Returned to distributor', hint: 'Sent back for credit' },
  { id: 'transfer', label: 'Transferred to other hall', hint: 'Moved between Santa Clara and Redwood City', crossHall: true },
];
export const reasonLabel = (id) => REASONS.find((r) => r.id === id)?.label || id;

const HALLS = { sc: 'Santa Clara', rwc: 'Redwood City' };

/** Type-ahead over the catalog. Stocked games first — that's what usually moves. */
function GamePick({ value, onPick, hall, boxes, products, placeholder }) {
  const [q, setQ] = useState('');
  const stocked = useMemo(() => {
    const n = {};
    // floor only — you cannot adjust a box sitting in a distributor's warehouse
    for (const b of boxes) if (b.hall_id === hall && b.state === 'in_inventory' && isFloor(b)) n[b.product_id] = (n[b.product_id] || 0) + 1;
    return n;
  }, [boxes, hall]);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return products
      .filter((p) => p.active !== false && p.name.toLowerCase().includes(s))
      .sort((a, b) => (stocked[b.id] || 0) - (stocked[a.id] || 0) || a.name.localeCompare(b.name))
      .slice(0, 8);
  }, [q, products, stocked]);

  if (value) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 13 }}>{value.name}</b>
        <span className="dimmer" style={{ fontSize: 11.5 }}>
          {stocked[value.id] || 0} in stock · {fmtMoney(perBoxValue(value))} each
        </span>
        <button className="btn ghost sm" onClick={() => { onPick(null); setQ(''); }}>change</button>
      </div>
    );
  }
  return (
    <div style={{ position: 'relative' }}>
      <input type="text" value={q} placeholder={placeholder || 'Type a game name…'}
        onChange={(e) => setQ(e.target.value)} style={{ width: '100%' }} />
      {hits.length > 0 && (
        <div className="card" style={{ position: 'absolute', zIndex: 30, left: 0, right: 0, marginTop: 2, maxHeight: 220, overflowY: 'auto' }}>
          {hits.map((p) => (
            <div key={p.id} onClick={() => { onPick(p); setQ(''); }}
              style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border-lt)' }}>
              {p.name}
              <span className="dimmer" style={{ fontSize: 11, marginLeft: 8 }}>
                {stocked[p.id] || 0} in stock
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Adjust({ onClose, preset }) {
  const { hall, boxes, products, store, reloadHall, setToast, requirePin } = useContext(AppCtx);
  const [reason, setReason] = useState(preset?.reason || 'swap');
  const [note, setNote] = useState('');
  const [outP, setOutP] = useState(preset?.product || null);
  const [outN, setOutN] = useState('1');
  const [inP, setInP] = useState(null);
  const [inN, setInN] = useState('1');
  const [busy, setBusy] = useState(false);

  const meta = REASONS.find((r) => r.id === reason) || REASONS[0];
  const otherHall = hall === 'sc' ? 'rwc' : 'sc';
  // "found" only adds; everything else takes off the shelf, and a swap does both
  const addsOnly = reason === 'found';
  const twoSided = meta.twoSided || meta.crossHall;

  const stockOf = (p) => (p ? boxes.filter((b) => b.hall_id === hall && b.product_id === p.id
    && b.state === 'in_inventory' && isFloor(b)).length : 0);
  const nOut = Math.max(0, parseInt(outN) || 0);
  const nIn = Math.max(0, parseInt(inN) || 0);
  const short = !addsOnly && outP && nOut > stockOf(outP);

  const save = async () => {
    if (busy) return;
    if (!note.trim()) { setToast('Say why — that is the whole point of the record'); return; }
    const lines = [];
    if (addsOnly) {
      if (!outP || !nOut) { setToast('Pick a game and a count'); return; }
      lines.push({ product_id: outP.id, delta: nOut });
    } else {
      if (!outP || !nOut) { setToast('Pick the game coming off the shelf'); return; }
      lines.push({ product_id: outP.id, delta: -nOut });
      if (reason === 'swap') {
        if (!inP || !nIn) { setToast('Pick the game they gave you instead'); return; }
        lines.push({ product_id: inP.id, delta: nIn });
      }
      if (reason === 'transfer') {
        lines.push({ product_id: outP.id, delta: nOut, hall_id: otherHall });
      }
    }
    if (!(await requirePin())) return;
    setBusy(true);
    try {
      await store.addAdjustment({ hallId: hall, reason, note: note.trim(), lines });
      await reloadHall();
      setToast('Recorded — it is in History with your note', null, 5000);
      onClose();
    } catch (e) {
      setToast(e.message || 'Could not record that');
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-bg" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ fontWeight: 700, fontSize: 15 }}>Adjust stock — {HALLS[hall]}</div>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Why?</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {REASONS.map((r) => (
                <button key={r.id} className={'btn sm ' + (reason === r.id ? 'primary' : 'ghost')}
                  onClick={() => setReason(r.id)}>{r.label}</button>
              ))}
            </div>
            <div className="dimmer" style={{ fontSize: 11.5, marginTop: 5 }}>{meta.hint}</div>
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label>{addsOnly ? 'Game found' : reason === 'swap' ? 'Game they were out of' : 'Game'}</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <input className="num" type="number" min="1" value={outN}
                onChange={(e) => setOutN(e.target.value)} style={{ width: 74 }} />
              <div style={{ flex: 1 }}>
                <GamePick value={outP} onPick={setOutP} hall={hall} boxes={boxes} products={products} />
              </div>
            </div>
            {short && (
              <div style={{ color: 'var(--orange)', fontSize: 11.5, marginTop: 5 }}>
                Only {stockOf(outP)} in stock. Record what really happened — but if the shelf
                disagrees too, that is a Miscount as well and worth a second entry.
              </div>
            )}
          </div>

          {reason === 'swap' && (
            <div className="field" style={{ marginTop: 12 }}>
              <label>Game they gave you instead</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <input className="num" type="number" min="1" value={inN}
                  onChange={(e) => setInN(e.target.value)} style={{ width: 74 }} />
                <div style={{ flex: 1 }}>
                  <GamePick value={inP} onPick={setInP} hall={hall} boxes={boxes} products={products}
                    placeholder="Type the replacement…" />
                </div>
              </div>
              <div className="dimmer" style={{ fontSize: 11.5, marginTop: 5 }}>
                The counts do not have to match — record what they actually handed over.
              </div>
            </div>
          )}

          {reason === 'transfer' && (
            <div className="dimmer" style={{ fontSize: 11.5, marginTop: 4 }}>
              Leaves {HALLS[hall]} and arrives at {HALLS[otherHall]} as one record.
            </div>
          )}

          <div className="field" style={{ marginTop: 12 }}>
            <label>Note — what happened? (required)</label>
            <input type="text" value={note} placeholder={
              reason === 'swap' ? 'e.g. Scott was out of Enchiladas, sent Heroes instead'
                : reason === 'damaged' ? 'e.g. water damage in the back room'
                : 'e.g. found behind the paper stock'}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()} style={{ width: '100%' }} />
          </div>

          {outP && (
            <div className="card pad" style={{ marginTop: 12, background: 'var(--bg)' }}>
              <div className="mono" style={{ fontSize: 12.5 }}>
                {addsOnly
                  ? <>+{nOut} {outP.name} — {fmtMoney(nOut * perBoxValue(outP))} onto the shelf</>
                  : <>
                      −{nOut} {outP.name}
                      {reason === 'swap' && inP && <> &nbsp;→&nbsp; +{nIn} {inP.name}</>}
                      {reason === 'transfer' && <> &nbsp;→&nbsp; {HALLS[otherHall]}</>}
                      <div className="dimmer" style={{ marginTop: 3, fontSize: 11.5 }}>
                        {reason === 'transfer'
                          ? 'No change in total value — it moves halls.'
                          : <>value {reason === 'swap' && inP
                              ? fmtMoney(nIn * perBoxValue(inP) - nOut * perBoxValue(outP))
                              : fmtMoney(-nOut * perBoxValue(outP))}</>}
                      </div>
                    </>}
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn primary" disabled={busy || !note.trim() || !outP} onClick={save}>
            {busy ? 'Saving…' : 'Record it'}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
