import React, { useContext, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import Adjust from './Adjust.jsx';
import { fmtMoney, ticketPrice } from '../lib/logic/po.js';
import { countByProduct } from '../lib/logic/boxes.js';

import { SESSIONS } from '../lib/sessions.js';
import { GAME_TYPES, MISC_MODES, passesFilters } from '../lib/logic/categories.js';
import { needsCost, needsType, needsTickets, needsVendor } from '../lib/logic/setup.js';
import { priceParts, perBoxValue, stockUnit, unitLabel } from '../lib/logic/pricing.js';
import UpdateGame from './UpdateGame.jsx';
import { isFloor } from '../lib/logic/location.js';
import { splitVisible, hiddenStockSummary, hiddenNote, isHidden } from '../lib/logic/hidden.js';

// Available sits immediately after the name, and its unit label right beside it.
// Managers were losing the row while tracking across to the count — several games
// have near-identical names, so a long horizontal scan was picking up the wrong line.
const COLS = [
  { key: 'inv', label: 'Available', r: true }, { key: 'unit', label: 'Counted as' },
  { key: 'open', label: 'Opened', r: true }, { key: 'onorder', label: 'On order', r: true },
  { key: 'vendor', label: 'Vendor' }, { key: 'type', label: 'Type' },
  { key: 'tickets', label: 'Tickets', r: true }, { key: 'price', label: '$ / ticket', r: true },
  { key: 'cost', label: 'Per unit', r: true },
  { key: 'value', label: 'Value', r: true }, { key: 'assigned', label: 'Set aside' },
];

export default function Inventory() {
  const { hall, products, vendors, boxes, store, reloadHall, setToast, can, openSession,
          hidden, toggleHidden } = useContext(AppCtx);
  const editable = can('boxes');
  const [q, setQ] = useState('');
  const [typeF, setTypeF] = useState('');
  const [miscF, setMiscF] = useState('games');
  const [sortKey, setSortKey] = useState('name');
  const [dir, setDir] = useState(1);
  const [adjustMode, setAdjustMode] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [adj, setAdj] = useState(null);      // { p, from, to }
  const [adjNote, setAdjNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [updPid, setUpdPid] = useState(null);
  const [showHidden, setShowHidden] = useState(false);
  const [hideAsk, setHideAsk] = useState(null);   // { row, held } — confirm before hiding stock

  // the gold 'update' chip: click it to fill the blank in place
  const Upd = ({ p }) => (
    <button className="badge b-gold" style={{ border: 0, cursor: 'pointer', font: 'inherit', fontSize: 11, fontWeight: 600 }}
      title="Click to fill this in" onClick={() => setUpdPid(p.id)}>update</button>
  );

  const vmap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);
  const cnt = useMemo(() => countByProduct(boxes), [boxes]);

  const rows = useMemo(() => {
    const out = [];
    let totVal = 0, unvalued = 0;
    for (const p of products) {
      const c = cnt[p.id];
      const put = isHidden(hidden, p.id);
      // include games whose whole position is off-site. The row reads 0 available,
      // which is the honest operational answer — dropping it entirely made the game
      // most in need of a shipment indistinguishable from one the hall doesn't carry.
      //
      // A HIDDEN game is kept even with nothing behind it, and this is load-bearing.
      // Hide a game holding two boxes, play them both, and without this line the row
      // leaves `rows` the moment the count reaches zero — so "Show hidden" has
      // nothing to show and there is no way back short of editing the database.
      // Whatever a hall has put away must stay reachable so it can be brought back.
      if (!put && (!c || (!c.inv && !c.open && !c.onorder && !c.off))) continue;
      if (q && !p.name.toLowerCase().includes(q.toLowerCase())) continue;
      if (!passesFilters(p, { type: typeF, misc: miscF })) continue;
      const cc = c || {};
      const asg = {};
      for (const b of boxes) {
        if (b.product_id === p.id && b.state === 'in_inventory' && isFloor(b) && b.session_tag) {
          asg[b.session_tag] = (asg[b.session_tag] || 0) + 1;
        }
      }
      // THIS SCREEN IS OPERATIONAL. Every number on it — counts and money alike —
      // is stock on this hall's floor, because the question it answers is "what
      // can we play and what do we need". Owned-but-elsewhere lives on its own
      // screen; mixing the two here is what made the figures unreadable.
      const held = (cc.inv || 0) + (cc.open || 0);
      // a case that splits into 16 totes is worth 1/16 per tote, not the case
      // price per tote
      const value = held * perBoxValue(p);
      totVal += value;
      if (needsCost(p)) unvalued += held;   // counted, but we can't put a number on it yet
      out.push({
        p, c: cc, value,
        s: {
          name: p.name.toLowerCase(), vendor: vmap[p.vendor_id]?.name || '', type: p.type,
          tickets: p.tickets || 0, price: ticketPrice(p), cost: Number(p.cost) || 0,
          inv: cc.inv || 0, open: cc.open || 0, onorder: cc.onorder || 0, value,
          unit: stockUnit(p)[1],
          assigned: Object.keys(asg).join(', '),
        },
        assignedLabel: Object.entries(asg).map(([k, n]) => `${k} ×${n}`).join(', ') || '—',
        avail: (cc.inv || 0) - Object.values(asg).reduce((a, n) => a + n, 0),
      });
    }
    out.sort((a, b) => {
      const x = a.s[sortKey], y = b.s[sortKey];
      const d = typeof x === 'string' ? x.localeCompare(y) : (x || 0) - (y || 0);
      return d * dir || a.s.name.localeCompare(b.s.name);
    });
    out.totVal = totVal;
    out.unvalued = unvalued;
    return out;
  }, [products, boxes, cnt, q, typeF, miscF, sortKey, dir, vmap, hidden]);

  // Hidden games are split off AFTER rows is built, which is the whole point:
  // rows.totVal has already counted them. Hiding a game changes what a manager
  // reads, never what the hall is holding, so the money on this screen is the
  // same number whether the row is on show or put away.
  const split = useMemo(() => splitVisible(rows, hidden, (r) => r.p.id), [rows, hidden]);
  const shown = showHidden ? rows : split.visible;
  const hiddenSummary = useMemo(
    () => hiddenStockSummary(rows, hidden, (r) => r.p.id,
      (r) => ({ boxes: (r.c.inv || 0) + (r.c.open || 0), value: r.value })),
    [rows, hidden]);

  const sortBy = (k) => {
    if (k === sortKey) setDir(-dir);
    else { setSortKey(k); setDir(1); }
  };
  const arrow = (k) => (k === sortKey ? (dir > 0 ? ' ▲' : ' ▼') : '');

  const openOne = async (row) => {
    // an off-site box cannot be opened on a floor it is not on
    const pool = boxes.filter((b) => b.product_id === row.p.id && b.state === 'in_inventory' && isFloor(b));
    if (!pool.length) { setToast('No boxes in stock for this game'); return; }
    const box = pool.find((b) => b.session_tag === openSession) || pool.find((b) => !b.session_tag) || pool[0];
    await store.updateBox(box.id, { opened_session: openSession });
    await store.transitionBox(box.id, 'opened');
    await reloadHall();
    setToast(`Opened for ${openSession} — ${row.p.name}`, async () => {
      await store.transitionBox(box.id, 'in_inventory');
      await store.updateBox(box.id, { opened_session: null });
      await reloadHall();
    });
  };


  /**
   * Put a game away for this hall, or bring it back.
   *
   * Hiding something that still holds boxes is allowed but never silent: the
   * confirm names the count, and the note under the table keeps naming it for as
   * long as the stock exists. The alternative — refusing until the count reaches
   * zero — would mean the wrong-hall duplicates could never be tidied away, since
   * their leftover boxes may never be played.
   */
  const askHide = (row) => {
    const c = row.c || {};
    const held = (c.inv || 0) + (c.open || 0);
    // On-order matters as much as floor stock, and is the easier one to miss:
    // Receiving does not filter on hidden, so boxes already paid for would arrive
    // onto a floor where the game has no row on either operational screen.
    // Off-site counts too — it is owned, it is just not here.
    if (held || c.onorder || c.off) {
      setHideAsk({ row, held, onorder: c.onorder || 0, off: c.off || 0 });
      return;
    }
    doHide(row, true);
  };

  const doHide = async (row, hide) => {
    setHideAsk(null);
    try {
      await toggleHidden(row.p.id, hide);
      setToast(
        hide ? `${row.p.name} hidden at ${hall === 'sc' ? 'Santa Clara' : 'Redwood City'}`
             : `${row.p.name} is showing again`,
        () => toggleHidden(row.p.id, !hide));
    } catch (e) {
      setToast(e.message || 'Could not change that');
    }
  };

  // A hand count that disagrees with the system. The note is required — a
  // count that changes without a reason is worse than no count at all.
  const saveAdjust = async () => {
    if (!adj || saving) return;
    const delta = adj.to - adj.from;
    if (!delta) { setAdj(null); return; }
    if (!adjNote.trim()) { setToast('Add a note explaining the change'); return; }
    setSaving(true);
    const sign = delta > 0 ? '+' : '−';
    try {
      await store.adjustStock({
        hallId: hall, product: adj.p, delta, note: adjNote.trim(),
        label: `${hall === 'sc' ? 'Santa Clara' : 'Redwood City'} — ${adj.p.name} ${sign}${Math.abs(delta)} (${adj.from} → ${adj.to})`,
      });
      await reloadHall();
      setAdj(null); setAdjNote('');
      setToast(`${adj.p.name}: ${adj.from} → ${adj.to} ${stockUnit(adj.p)[1]}`);
    } catch (e) {
      setToast(e.message || 'Could not adjust that count');
    } finally { setSaving(false); }
  };


  return (
    <div>
      {showAdjust && <Adjust onClose={() => setShowAdjust(false)} />}
      <div className="page-head">
        <div className="h1">Inventory — {hall === 'sc' ? 'Santa Clara' : 'Redwood City'}</div>
        <select value={typeF} onChange={(e) => setTypeF(e.target.value)} title="Game type">
          {GAME_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={miscF} onChange={(e) => setMiscF(e.target.value)} title="Cherry tickets and dauber supplies">
          {MISC_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <div className="grow" />
        <span className="dim" style={{ fontSize: 13 }}>
          <span title={hiddenSummary.withStock > 0
            ? `${shown.length} shown. The money covers all ${rows.length} including ${hiddenSummary.count} hidden, because hiding a game does not stop the hall owning it.`
            : ''}>
            {shown.length} products in stock · on the floor, <b className="mono">{fmtMoney(rows.totVal)}</b>
            {hiddenSummary.withStock > 0 && (
              <span className="dimmer" style={{ fontSize: 11.5 }}> (incl. {hiddenSummary.boxes} hidden)</span>
            )}
          </span>
          {rows.unvalued > 0 && (
            <span className="tbd" style={{ cursor: 'default', fontSize: 12 }}
              title={`${rows.unvalued} units have no cost yet, so they aren't in this figure`}>
              {' '}+ {rows.unvalued} unpriced
            </span>
          )}
        </span>
        {hiddenSummary.count > 0 && (
          <button className={'btn ' + (showHidden ? 'orange' : 'ghost')} onClick={() => setShowHidden(!showHidden)}
            title={showHidden
              ? 'Go back to just the games this hall uses'
              : `${hiddenSummary.count} game(s) put away at this hall — show them so you can bring one back`}>
            {showHidden ? '🙈 Hide them again' : `👁 Show hidden (${hiddenSummary.count})`}
          </button>
        )}
        {editable && (
          <>
            <button className="btn ghost" onClick={() => setShowAdjust(true)}
              title="Record a swap, damage, a miscount or a transfer — with a note and a reason">
              ✎ Adjust stock
            </button>
            <button className={'btn ' + (adjustMode ? 'orange' : 'ghost')} onClick={() => setAdjustMode(!adjustMode)}
              title="Hand-correct a count that doesn't match the shelf">
              {adjustMode ? '🔓 Done adjusting' : '🔒 Adjust inventory'}
            </button>
          </>
        )}
      </div>
      {adjustMode && (
        <div className="demo-banner" style={{ background: '#fdf3e7', borderColor: '#e2c39a' }}>
          <b>Adjust mode is on.</b> Click any <b>Available</b> number — the one next to the game name — to set what's actually on the shelf.
          Every change needs a note and shows up in Recent Activity.
        </div>
      )}
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr>
            <th className="first sortable" onClick={() => sortBy('name')}>
              <div>Game{arrow('name')}</div>
              <input type="text" placeholder="Search game…" value={q} onClick={(e) => e.stopPropagation()}
                onChange={(e) => setQ(e.target.value)} style={{ fontWeight: 400, marginTop: 3, width: 200 }} />
            </th>
            {COLS.map((c) => (
              <th key={c.key} className={'sortable' + (c.r ? ' r' : '')} onClick={() => sortBy(c.key)}>{c.label}{arrow(c.key)}</th>
            ))}
            <th className="last" style={{ width: 200 }} />
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.p.id} style={isHidden(hidden, r.p.id) ? { opacity: 0.55 } : undefined}>
                <td className="first">
                  {r.p.name}
                  {isHidden(hidden, r.p.id) && (
                    <span className="badge" style={{ marginLeft: 6, fontSize: 10.5 }}
                      title="Put away at this hall — still owned, still counted, just not normally shown">hidden</span>
                  )}
                  {needsCost(r.p) && <span className="badge b-gold" style={{ marginLeft: 6 }} title="No unit cost — can't be ordered or received until set">can't order</span>}
                </td>
                <td className="r mono">
                  {adjustMode
                    ? <button className="btn ghost sm" style={{ fontFamily: 'inherit', minWidth: 46 }}
                        title="Set the real shelf count"
                        onClick={() => { setAdj({ p: r.p, from: r.c.inv || 0, to: r.c.inv || 0 }); setAdjNote(''); }}>
                        <b>{r.c.inv || 0}</b> ✎
                      </button>
                    : <b>{r.c.inv || 0}</b>}
                  {!r.c.inv && !r.c.open && (r.c.off || 0) > 0 && (
                    <div className="dimmer" style={{ fontSize: 10.5, fontWeight: 400 }}
                         title="Owned but not here — see Owned Inventory to bring it in">
                      {r.c.off} off-site
                    </div>
                  )}
                </td>
                <td className="dimmer" style={{ fontSize: 12 }}
                  title={`Every count on this row — in stock, opened, on order — is in ${stockUnit(r.p)[1]}`}>
                  {unitLabel(r.p, r.c.inv || 0)}
                </td>
                <td className="r mono" style={{ color: 'var(--orange)' }}>{r.c.open || 0}</td>
                <td className="r mono dimmer">{r.c.onorder || 0}</td>
                <td className="dim" style={{ fontSize: 12 }}>
                  {needsVendor(r.p) ? <Upd p={r.p} /> : vmap[r.p.vendor_id]?.name}
                </td>
                <td className="dimmer" style={{ fontSize: 12 }}>{needsType(r.p) ? <Upd p={r.p} /> : r.p.type}</td>
                <td className="r mono">{needsTickets(r.p) ? <Upd p={r.p} /> : (r.p.tickets ? r.p.tickets.toLocaleString() : '—')}</td>
                <td className="r mono dim">${ticketPrice(r.p)}</td>
                <td className="r mono">
                  {needsCost(r.p) ? <Upd p={r.p} /> : (() => {
                    const pp = priceParts(r.p, vmap[r.p.vendor_id]);
                    return <span title={`${fmtMoney(pp.base)} per deal × ${pp.units} deal${pp.units === 1 ? '' : 's'} = ${fmtMoney(pp.box)} per ordered unit`
                      + (pp.splits ? `, arriving as ${pp.split} ${pp.unit[1]} at ${fmtMoney(pp.perBox)} each` : '')
                      + (pp.packing ? `. Packing of ${fmtMoney(pp.packing)} is billed on the PO but not carried in stock value.` : '')}>
                      {fmtMoney(pp.perBox)}
                      {(pp.multiplied || pp.splits) && (
                        <div className="dimmer" style={{ fontSize: 10.5 }}>
                          {pp.splits ? `${fmtMoney(pp.box)} ÷ ${pp.split}` : `${fmtMoney(pp.base)} ×${pp.units}`}
                        </div>
                      )}
                    </span>;
                  })()}
                </td>
                <td className="r mono">{r.value ? fmtMoney(r.value) : '—'}</td>
                <td style={{ fontSize: 11, color: 'var(--green)' }}>{r.assignedLabel}</td>
                <td className="last r" style={{ whiteSpace: 'nowrap' }}>
                  {editable ? (<>
                    {isHidden(hidden, r.p.id)
                      ? <button className="btn ghost sm" title="Show this game at this hall again"
                          onClick={() => doHide(r, false)}>Unhide</button>
                      : <>
                          <button className="btn orange sm" disabled={(r.c.inv || 0) <= 0} onClick={() => openOne(r)}>Open</button>{' '}
                          <button className="btn ghost sm" title="Edit this game — name, distributor, type, price, tickets"
                            onClick={() => setUpdPid(r.p.id)}>Edit</button>{' '}
                          <button className="btn ghost sm" title="Put this game away for this hall only. Nothing is deleted — the boxes, their cost and their history all stay."
                            onClick={() => askHide(r)}>Hide</button>
                        </>}
                  </>) : <span className="dimmer" style={{ fontSize: 11 }}>read-only</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">No products match.</div>}
      </div>
      {hiddenNote(hiddenSummary) && (
        <div className="dimmer" style={{ fontSize: 12, marginTop: 8 }}
          title="Hiding is a view filter for this hall only. The boxes, their cost and their state are untouched, and Owned Inventory still reports them.">
          {hiddenNote(hiddenSummary)}
          {!showHidden && hiddenSummary.count > 0 && (
            <button className="btn ghost sm" style={{ marginLeft: 8 }} onClick={() => setShowHidden(true)}>Show them</button>
          )}
        </div>
      )}

      {updPid && <UpdateGame product={products.find((p) => p.id === updPid)} onClose={() => setUpdPid(null)} />}

      {hideAsk && (
        <div className="modal-bg" onClick={() => setHideAsk(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>Hide this game here?</div>
            <p className="dim" style={{ fontSize: 12.5, marginBottom: 12 }}>{hideAsk.row.p.name}</p>
            <p style={{ fontSize: 13, marginBottom: 10 }}>
              {hideAsk.held > 0 && <>
                It still has <b>{unitLabel(hideAsk.row.p, hideAsk.held)}</b> on the floor at{' '}
                {hall === 'sc' ? 'Santa Clara' : 'Redwood City'}, worth{' '}
                <b className="mono">{fmtMoney(hideAsk.row.value)}</b>.{' '}
              </>}
              {hideAsk.onorder > 0 && <>
                <b>{unitLabel(hideAsk.row.p, hideAsk.onorder)}</b> {hideAsk.onorder === 1 ? 'is' : 'are'} on
                order and will still arrive.{' '}
              </>}
              {hideAsk.off > 0 && <>
                <b>{unitLabel(hideAsk.row.p, hideAsk.off)}</b> {hideAsk.off === 1 ? 'is' : 'are'} owned
                off-site.{' '}
              </>}
            </p>
            <p className="dimmer" style={{ fontSize: 12, marginBottom: 14 }}>
              Nothing is deleted and nothing moves. Anything on the floor stays in the floor total
              above, stays on Owned Inventory, and can still be scanned. The row simply stops
              appearing on Inventory and Purchase for this hall until you unhide it.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => doHide(hideAsk.row, true)}>Hide it</button>
              <button className="btn ghost" onClick={() => setHideAsk(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {adj && (
        <div className="modal-bg" onClick={() => setAdj(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>Adjust inventory</div>
            <p className="dim" style={{ fontSize: 12.5, marginBottom: 14 }}>{adj.p.name}</p>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end' }}>
              <div className="field" style={{ margin: 0 }}><label>System says</label>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700, padding: '4px 0' }}>{adj.from}</div></div>
              <div style={{ fontSize: 20, color: 'var(--ink-2)', paddingBottom: 8 }}>→</div>
              <div className="field" style={{ margin: 0 }}><label>Actually on the shelf ({stockUnit(adj.p)[1]})</label>
                <input className="num" type="number" min="0" autoFocus value={adj.to}
                  onChange={(e) => setAdj({ ...adj, to: Math.max(0, parseInt(e.target.value) || 0) })}
                  style={{ width: 110, fontSize: 20, fontWeight: 700 }} /></div>
              <div style={{ paddingBottom: 10, fontWeight: 700, fontSize: 14, color: adj.to > adj.from ? 'var(--green)' : adj.to < adj.from ? 'var(--orange)' : 'var(--ink-2)' }}>
                {adj.to === adj.from ? 'no change' : (adj.to > adj.from ? `+${adj.to - adj.from}` : `−${adj.from - adj.to}`) + ' ' + stockUnit(adj.p)[1]}
              </div>
            </div>
            <div className="field" style={{ marginTop: 14 }}><label>Note — why is it different? (required)</label>
              <input type="text" value={adjNote} placeholder="e.g. two boxes damaged in the back room"
                onChange={(e) => setAdjNote(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveAdjust()} style={{ width: '100%' }} /></div>
            <p className="dimmer" style={{ fontSize: 11.5, marginTop: 8 }}>
              {adj.to < adj.from
                ? `Removed ${stockUnit(adj.p)[1]} are marked missing, not deleted — the history stays intact.`
                : adj.to > adj.from
                  ? `Added ${stockUnit(adj.p)[1]} are valued at ${fmtMoney(perBoxValue(adj.p))} each.`
                  : 'Set a different number to record an adjustment.'}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn primary" disabled={adj.to === adj.from || !adjNote.trim() || saving} onClick={saveAdjust}>
                {saving ? 'Saving…' : 'Save adjustment'}
              </button>
              <div style={{ flex: 1 }} />
              <button className="btn ghost" onClick={() => setAdj(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
