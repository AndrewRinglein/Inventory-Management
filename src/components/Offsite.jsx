import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney } from '../lib/logic/po.js';
import { LOCATIONS, locationLabel, daysSinceConfirmed, isStale, STALE_DAYS } from '../lib/logic/location.js';

/**
 * Stock we own that is not on the floor.
 *
 * This screen exists because off-site stock is, by definition, the stock nobody
 * looks at. A distributor holding fifteen boxes for six months and a storage
 * unit nobody has opened since spring both look exactly like a healthy balance
 * until someone goes and checks. So the column that matters here is not the
 * count — it is when a human last laid eyes on it.
 */
const HALLS = { sc: 'Santa Clara', rwc: 'Redwood City' };

export default function Offsite() {
  const { hall, store, boxes, setToast, can, reloadHall } = useContext(AppCtx);
  const editable = can('boxes');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ship, setShip] = useState(null);      // the group being brought to the hall
  const [qty, setQty] = useState('');

  const load = () => {
    setLoading(true);
    (store.getOffsite ? store.getOffsite(hall) : Promise.resolve([]))
      .then((r) => { setRows(r || []); setLoading(false); })
      .catch(() => { setRows([]); setLoading(false); });
  };
  useEffect(load, [hall, store, boxes]);   // eslint-disable-line

  const totals = useMemo(() => {
    const t = { boxes: 0, value: 0, stale: 0, byLoc: {} };
    for (const r of rows) {
      t.boxes += r.boxes;
      t.value += r.value;
      const l = (t.byLoc[r.location] ||= { boxes: 0, value: 0 });
      l.boxes += r.boxes; l.value += r.value;
      if (isStale({ counted_at: r.counted_at })) t.stale += r.boxes;
    }
    return t;
  }, [rows]);

  const doConfirm = async (r) => {
    if (busy) return;
    setBusy(true);
    try {
      await store.confirmOffsite(r.ids);
      load();
      setToast(`${r.boxes} box(es) of ${r.name} confirmed present`);
    } catch (e) { setToast(e.message || 'Could not confirm that'); }
    finally { setBusy(false); }
  };

  const doShip = async () => {
    if (busy || !ship) return;
    const n = Math.max(1, parseInt(qty) || 0);
    setBusy(true);
    try {
      await store.moveBoxes({
        hallId: hall, productId: ship.product_id, from: ship.location, to: 'hall', qty: n,
      });
      setShip(null); setQty('');
      await reloadHall();
      load();
      setToast(`${n} box(es) of ${ship.name} moved to the floor at ${HALLS[hall]}`);
    } catch (e) { setToast(e.message || 'Could not move that stock'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="page-head">
        <div className="h1">Off-site — {HALLS[hall]}</div>
        <div className="grow" />
        <span className="dimmer" style={{ fontSize: 12.5 }}>
          {loading ? 'loading…' : `${totals.boxes} box(es), ${fmtMoney(totals.value)}`}
        </span>
      </div>

      <div className="card pad" style={{ marginBottom: 12, fontSize: 12.5 }}>
        Stock this hall owns that is <b>not on its floor</b>. It counts toward inventory
        value and it does <b>not</b> count toward what can be played tonight, which is why
        a floor count should never report it as missing.
        {totals.stale > 0 && (
          <div style={{ marginTop: 8, padding: '8px 10px', background: '#fdf8ee',
                        border: '1px solid #e2c39a', borderRadius: 6 }}>
            <b>{totals.stale} box(es) haven't been confirmed in over {STALE_DAYS} days.</b>{' '}
            Nothing here gets counted on a session night, so this is the only thing standing
            between a storage unit and a surprise.
          </div>
        )}
        {Object.keys(totals.byLoc).length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {LOCATIONS.filter((l) => totals.byLoc[l.id]).map((l) => (
              <span key={l.id} className="dimmer">
                {l.label}: <b>{totals.byLoc[l.id].boxes}</b> ({fmtMoney(totals.byLoc[l.id].value)})
              </span>
            ))}
          </div>
        )}
      </div>

      {!loading && !rows.length && (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div className="dimmer">Nothing off-site for {HALLS[hall]}.</div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="tbl">
            <thead><tr>
              <th className="first">Game</th>
              <th>Where</th>
              <th className="r" style={{ width: 80 }}>Boxes</th>
              <th className="r" style={{ width: 110 }}>Value</th>
              <th style={{ width: 150 }}>Last confirmed</th>
              <th className="last" style={{ width: 190 }} />
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const days = daysSinceConfirmed({ counted_at: r.counted_at });
                const stale = isStale({ counted_at: r.counted_at });
                return (
                  <tr key={`${r.product_id}|${r.location}|${r.location_ref || ''}`}>
                    <td className="first">{r.name}</td>
                    <td style={{ fontSize: 12.5 }}>
                      {locationLabel(r.location)}
                      {r.location_ref && <span className="dimmer"> · {r.location_ref}</span>}
                    </td>
                    <td className="r mono"><b>{r.boxes}</b></td>
                    <td className="r mono">{fmtMoney(r.value)}</td>
                    <td style={{ fontSize: 12.5, color: stale ? 'var(--orange)' : 'inherit' }}>
                      {days === null ? 'never' : days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}
                    </td>
                    <td className="last" style={{ textAlign: 'right' }}>
                      {editable && (
                        <>
                          <button className="btn sm ghost" disabled={busy}
                            onClick={() => { setShip(r); setQty(String(r.boxes)); }}>Ship to floor</button>
                          {' '}
                          <button className="btn sm ghost" disabled={busy}
                            onClick={() => doConfirm(r)}>Confirm</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {ship && (
        <div className="modal-bg" onClick={() => !busy && setShip(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 460 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
              Bring {ship.name} to the floor
            </div>
            <p style={{ fontSize: 13 }}>
              {ship.boxes} box{ship.boxes === 1 ? '' : 'es'} at {locationLabel(ship.location)}
              {ship.location_ref ? ` · ${ship.location_ref}` : ''}. Moving them changes where
              they are, not what they are — they stay in stock throughout, so nothing is
              received and nothing is billed again.
            </p>
            <label style={{ display: 'block', fontSize: 12.5, marginTop: 6 }}>
              How many
              <input type="number" min="1" max={ship.boxes} value={qty} style={{ marginLeft: 8, width: 90 }}
                onChange={(e) => setQty(e.target.value)} />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn primary" disabled={busy} onClick={doShip}>
                {busy ? 'Working…' : 'Move to the floor'}
              </button>
              <div style={{ flex: 1 }} />
              <button className="btn ghost" disabled={busy} onClick={() => setShip(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
