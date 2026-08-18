import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney } from '../lib/logic/po.js';
import { perBoxValue } from '../lib/logic/pricing.js';
import { countByProduct } from '../lib/logic/boxes.js';
import { LOCATIONS, locationLabel, locationShort, daysSinceConfirmed, isStale, STALE_DAYS }
  from '../lib/logic/location.js';

/**
 * Everything this hall owns, wherever it is. The accounting view.
 *
 * Its sibling — Inventory — is the operational one: what is on the floor and can
 * be played tonight, counts and money alike. Neither screen ever shows the
 * other's number, because a single figure covering both is what makes someone
 * look at nineteen Monster Score, four of which are actually here, and decide
 * not to order.
 *
 * The column that matters for the off-site rows is not the count but when a
 * human last laid eyes on them. A distributor holding fifteen boxes for six
 * months and a storage unit nobody has opened since spring both look exactly
 * like a healthy balance until somebody goes and checks.
 */
const HALLS = { sc: 'Santa Clara', rwc: 'Redwood City' };

export default function Owned() {
  const { hall, products, store, boxes, setToast, can, reloadHall } = useContext(AppCtx);
  const editable = can('boxes');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ship, setShip] = useState(null);      // the group being brought to the hall
  const [qty, setQty] = useState('');
  // sending stock OUT. Without this the feature is a one-way door: you can drain
  // off-site stock through the UI but only create it with hand-written SQL.
  const [send, setSend] = useState(null);      // {productId, to, ref, qty}
  const [pick, setPick] = useState('');

  const load = () => {
    setLoading(true);
    (store.getOffsite ? store.getOffsite(hall) : Promise.resolve([]))
      .then((r) => { setRows(r || []); setLoading(false); })
      .catch(() => { setRows([]); setLoading(false); });
  };
  useEffect(load, [hall, store, boxes]);   // eslint-disable-line

  const cnt = useMemo(() => countByProduct(boxes), [boxes]);

  /**
   * One row per game we own anything of, split by where it is. Floor and
   * off-site are shown as separate columns and never summed into a single
   * "stock" figure — the total column is explicitly labelled Owned so nobody
   * mistakes it for what can be played.
   */
  const owned = useMemo(() => {
    const out = [];
    let totVal = 0, floorVal = 0, offVal = 0;
    for (const p of products) {
      const c = cnt[p.id];
      if (!c || (!c.owned && !c.onorder)) continue;
      const floor = (c.inv || 0) + (c.open || 0);
      const per = perBoxValue(p);
      const value = c.owned * per;
      totVal += value; floorVal += floor * per; offVal += (c.off || 0) * per;
      out.push({ p, floor, off: c.off || 0, offBy: c.offBy || {},
                 onorder: c.onorder || 0, owned: c.owned, value });
    }
    out.sort((a, b) => (b.off - a.off) || b.value - a.value || a.p.name.localeCompare(b.p.name));
    out.totVal = totVal; out.floorVal = floorVal; out.offVal = offVal;
    return out;
  }, [products, cnt]);

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

  const doSend = async () => {
    if (busy || !send?.productId) return;
    const n = Math.max(1, parseInt(send.qty) || 0);
    setBusy(true);
    try {
      await store.moveBoxes({
        hallId: hall, productId: send.productId, from: 'hall', to: send.to,
        qty: n, ref: send.ref?.trim() || null,
        // the picker counts sealed stock, so move sealed stock — shipping a
        // part-sold box out of the hall loses the open box off the floor
        states: ['in_inventory'],
      });
      setSend(null); setPick('');
      await reloadHall();
      load();
      setToast(`${n} box(es) moved off the floor to ${locationLabel(send.to)}`);
    } catch (e) { setToast(e.message || 'Could not move that stock'); }
    finally { setBusy(false); }
  };

  const doShip = async () => {
    if (busy || !ship) return;
    const n = Math.max(1, parseInt(qty) || 0);
    setBusy(true);
    try {
      await store.moveBoxes({
        hallId: hall, productId: ship.product_id, from: ship.location, to: 'hall', qty: n,
        // the row is one product at ONE location_ref; move those exact boxes,
        // not whichever of that product's off-site boxes sorts first
        fromRef: ship.location_ref ?? null, ids: ship.ids,
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
        <div className="h1">Owned inventory — {HALLS[hall]}</div>
        <div className="grow" />
        {can('boxes') && (
          <button className="btn sm ghost" style={{ marginRight: 10 }}
            onClick={() => { setSend({ productId: '', to: 'storage', ref: '', qty: '1' }); setPick(''); }}>
            Send stock off-site
          </button>
        )}
        <span className="dimmer" style={{ fontSize: 12.5 }}>
          {loading ? 'loading…'
            : `${owned.reduce((a, r) => a + r.owned, 0)} box(es) owned · ${fmtMoney(owned.totVal)}`}
        </span>
      </div>

      <div className="card pad" style={{ marginBottom: 12, fontSize: 12.5 }}>
        Everything this hall <b>owns</b>, wherever it sits — the accounting picture.
        For what can actually be played tonight, use <b>Inventory</b>; that screen is
        floor-only, counts and money alike, and the two are deliberately never added
        together.
        {totals.stale > 0 && (
          <div style={{ marginTop: 8, padding: '8px 10px', background: '#fdf8ee',
                        border: '1px solid #e2c39a', borderRadius: 6 }}>
            <b>{totals.stale} box(es) sit in a group nobody has confirmed in over {STALE_DAYS} days.</b>{' '}
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

      {/* All three figures are catalogue value (perBoxValue), so floor + off-site
          reconciles to owned. The detail table lower down sums each box's RECORDED
          cost instead, which is the right basis there — it is answering "what did
          this particular stock cost" — and the two can differ after a price change. */}
      <div className="card pad" style={{ marginBottom: 12, display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        <span><label className="dimmer" style={{ fontSize: 11, display: 'block' }}>Owned value</label>
          <b className="mono" style={{ fontSize: 16 }}>{fmtMoney(owned.totVal)}</b></span>
        <span><label className="dimmer" style={{ fontSize: 11, display: 'block' }}>On the floor</label>
          <b className="mono" style={{ fontSize: 16 }}>{fmtMoney(owned.floorVal)}</b></span>
        <span><label className="dimmer" style={{ fontSize: 11, display: 'block' }}>Off-site</label>
          <b className="mono" style={{ fontSize: 16, color: owned.offVal ? 'var(--teal)' : 'inherit' }}>
            {fmtMoney(owned.offVal)}</b></span>
        <div style={{ flex: 1 }} />
        <span className="dimmer" style={{ fontSize: 11.5, maxWidth: 320, alignSelf: 'center' }}>
          Boxes still on order are a commitment, not an asset, so they are shown but
          not counted in owned value.
        </span>
      </div>

      <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
        <table className="tbl">
          <thead><tr>
            <th className="first">Game</th>
            <th className="r" style={{ width: 90 }} title="On this hall's floor — playable">Floor</th>
            <th className="r" style={{ width: 90 }} title="Ours, held elsewhere — not playable">Off-site</th>
            <th className="r" style={{ width: 90 }} title="Floor + off-site. NOT what can be played.">Owned</th>
            <th className="r" style={{ width: 90 }} title="Committed, not yet ours">On order</th>
            <th className="r last" style={{ width: 110 }}>Value</th>
          </tr></thead>
          <tbody>
            {owned.map((r) => (
              <tr key={r.p.id}>
                <td className="first">{r.p.name}</td>
                <td className="r mono">{r.floor || <span className="dimmer">—</span>}</td>
                <td className="r mono" style={{ color: r.off ? 'var(--teal)' : 'inherit' }}
                    title={Object.entries(r.offBy).map(([k, n]) => `${n} ${locationShort(k)}`).join(', ')}>
                  {r.off ? <b>{r.off}</b> : <span className="dimmer">—</span>}
                </td>
                <td className="r mono"><b>{r.owned}</b></td>
                <td className="r mono dimmer">{r.onorder || '—'}</td>
                <td className="r mono last">{fmtMoney(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!owned.length && <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">Nothing in stock.</div>}
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--dim)', margin: '0 0 6px 2px' }}>
        Off-site detail — where it is, and when anyone last checked
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

      {send && (
        <div className="modal-bg" onClick={() => !busy && setSend(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 520 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Send stock off the floor</div>
            <p style={{ fontSize: 13 }}>
              The boxes stay in stock and keep their value — only where they are changes.
              They stop counting toward what can be played tonight straight away.
            </p>
            <label style={{ display: 'block', fontSize: 12.5, marginTop: 8 }}>
              Game
              <input type="text" value={pick} placeholder="Type to find a game with floor stock…"
                style={{ display: 'block', width: '100%', marginTop: 3 }}
                onChange={(e) => { setPick(e.target.value); setSend({ ...send, productId: '' }); }} />
            </label>
            {pick.trim().length >= 2 && !send.productId && (
              <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--border)',
                            borderRadius: 6, marginTop: 4 }}>
                {products
                  .filter((p) => ((cnt[p.id]?.inv || 0) > 0)
                    && p.name.toLowerCase().includes(pick.trim().toLowerCase()))
                  .slice(0, 12)
                  .map((p) => (
                    <div key={p.id} className="nav-item" style={{ cursor: 'pointer', fontSize: 12.5 }}
                      onClick={() => { setSend({ ...send, productId: p.id }); setPick(p.name); }}>
                      {p.name} <span className="dimmer">· {cnt[p.id].inv} on the floor</span>
                    </div>
                  ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12.5 }}>How many
                <input type="number" min="1" max={cnt[send.productId]?.inv || 1} value={send.qty}
                  style={{ marginLeft: 8, width: 80 }}
                  onChange={(e) => setSend({ ...send, qty: e.target.value })} /></label>
              <label style={{ fontSize: 12.5 }}>Where
                <select value={send.to} style={{ marginLeft: 8 }}
                  onChange={(e) => setSend({ ...send, to: e.target.value })}>
                  {LOCATIONS.filter((l) => l.id !== 'hall')
                    .map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select></label>
              <label style={{ fontSize: 12.5, flex: 1, minWidth: 180 }}>Which one
                <input type="text" value={send.ref} placeholder="Marathon · Unit 14 · …"
                  style={{ display: 'block', width: '100%', marginTop: 3 }}
                  onChange={(e) => setSend({ ...send, ref: e.target.value })} /></label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn primary" disabled={busy || !send.productId} onClick={doSend}>
                {busy ? 'Working…' : 'Move it off the floor'}
              </button>
              <div style={{ flex: 1 }} />
              <button className="btn ghost" disabled={busy} onClick={() => setSend(null)}>Cancel</button>
            </div>
          </div>
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
