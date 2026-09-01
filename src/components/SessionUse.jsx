import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { isHidden, hiddenLast } from '../lib/logic/hidden.js';
import { searchMatches } from '../lib/logic/naming.js';
import { countByProduct } from '../lib/logic/boxes.js';
import { stockUnit } from '../lib/logic/pricing.js';

const HALL = { sc: 'Santa Clara', rwc: 'Redwood City' };

/** "Sat 9 Aug · evening" — how someone at the hall would say it. */
function sessionLabel(s) {
  const [y, m, d] = s.session_date.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  const day = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const part = s.part === 'AM' ? 'matinee' : s.part === 'PM' ? 'evening' : '';
  return part ? `${day} · ${part}` : day;
}

export default function SessionUse() {
  const { hall, products, boxes, store, reloadHall, setToast, requirePin, can, hidden } = useContext(AppCtx);
  const [sessions, setSessions] = useState(null);
  const [plays, setPlays] = useState([]);
  const [open, setOpen] = useState(null);     // session id drilled into
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [assign, setAssign] = useState(null);   // the play whose game we're picking
  const [q, setQ] = useState('');

  const load = async () => {
    const [s, p] = await Promise.all([store.getSessions(), store.getAllSessionPlays()]);
    setSessions(s); setPlays(p);
  };
  useEffect(() => { load(); }, []);   // eslint-disable-line

  const pmap = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const cnt = useMemo(() => countByProduct(boxes), [boxes]);
  const byS = useMemo(() => {
    const m = {};
    for (const p of plays) (m[p.session_id] ||= []).push(p);
    return m;
  }, [plays]);

  // A session imported from a pre-system programme (July and earlier) is history.
  // It cannot come off the shelf, and comparing it with today's stock is
  // meaningless — the boxes it played were never in the system.
  const isHistory = (s) => !!s.historical;

  const forHall = (sessions || []).filter((s) => s.hall_id === hall);
  const months = [...new Set(forHall.map((s) => String(s.session_date).slice(0, 7)))].sort().reverse();
  const [period, setPeriod] = useState('current');
  const monthName = (ym) => {
    const [y, m] = ym.split('-');
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
  };
  const mine = forHall.filter((s) => {
    if (period === 'all') return true;
    if (period === 'current') return !isHistory(s);
    if (period === 'history') return isHistory(s);
    return String(s.session_date).slice(0, 7) === period;
  }).sort((a, b) => String(b.session_date + (b.part || '')).localeCompare(a.session_date + (a.part || '')));

  /**
   * What a session would cost the shelf, worked out per product rather than per
   * line: two lines of the same game draw from one pool. "Short" is the honest
   * number — the sheet says it was played, the shelf says it isn't there.
   */
  const stats = (s) => {
    const rows = byS[s.id] || [];
    const onsite = rows.filter((r) => r.category === 'on-site').reduce((a, r) => a + r.qty, 0);
    const presale = rows.filter((r) => r.category === 'pre-sale').reduce((a, r) => a + r.qty, 0);
    const unmatched = rows.filter((r) => !r.product_id).reduce((a, r) => a + r.qty, 0);
    const want = {};
    for (const r of rows) if (r.product_id) want[r.product_id] = (want[r.product_id] || 0) + r.qty;
    let short = 0, shortTitles = 0;
    if (!s.applied_at && !isHistory(s)) {
      for (const [pid, n] of Object.entries(want)) {
        const have = cnt[pid]?.inv || 0;
        if (n > have) { short += n - have; shortTitles++; }
      }
    }
    return { rows, onsite, presale, total: onsite + presale, unmatched, short, shortTitles };
  };

  /**
   * `allowShort` is only ever true on a second pass, after the store has refused
   * once and the person has read which games are short and said go anyway. The
   * first call never writes anything off — that was the whole bug.
   */
  const doApply = async (s, allowShort = false) => {
    if (busy) return;
    if (!(await requirePin())) return;
    setBusy(true);
    try {
      const res = await store.applySession(s.id, byS[s.id] || [], { allowShort });
      await Promise.all([load(), reloadHall()]);
      setConfirm(null);
      setToast(res.invented
        ? `${res.moved + res.invented} box(es) recorded as played — ${res.invented} of them were never received into stock`
        : `${res.moved} box(es) removed from stock`, null, 8000);
    } catch (e) {
      if (e?.code === 'session_short') {
        // nothing was written; ask, then re-run with the shortfall accepted
        setConfirm({ kind: 'short', session: s, message: e.message, short: e.short });
      } else {
        setToast(e.message || 'Could not apply that session', null, 8000);
      }
    } finally { setBusy(false); }
  };

  /**
   * Point a line at a product. Kept on the line rather than renaming the game,
   * because the sheet said what it said — the match is our reading of it, and a
   * reading should be correctable without editing the evidence.
   */
  const doAssign = async (pid) => {
    if (!assign || busy) return;
    setBusy(true);
    try {
      await store.setPlayProduct(assign.id, pid);
      await load();
      setAssign(null); setQ('');
      setToast(`"${assign.name_raw}" now points at ${pmap[pid]?.name || pid}`);
    } catch (e) {
      setToast(e.message || 'Could not save that match');
    } finally { setBusy(false); }
  };

  const doUndo = async (s) => {
    if (busy) return;
    if (!(await requirePin())) return;
    setBusy(true);
    try {
      const res = await store.undoSession(s.id);
      await Promise.all([load(), reloadHall()]);
      setToast(`${res.restored} box(es) put back on the shelf`
        + (res.removed ? `, ${res.removed} never-received removed` : ''));
    } catch (e) {
      setToast(e.message || 'Could not undo that session', null, 8000);
    } finally { setBusy(false); }
  };

  if (sessions === null) return <div className="card pad dimmer">Loading sessions…</div>;

  const applied = mine.filter((s) => s.applied_at).length;
  const totalBoxes = mine.reduce((a, s) => a + stats(s).total, 0);
  const cur = mine.find((s) => s.id === open);

  return (
    <div>
      <div className="page-head">
        <div className="h1">Session Use — {HALL[hall]}</div>
        <div className="grow" />
        <span className="dim" style={{ fontSize: 13 }}>
          {mine.length} session{mine.length === 1 ? '' : 's'} · {totalBoxes} flash boxes played
          {mine.some((s) => !isHistory(s)) && <> · <b>{applied}</b> removed from stock</>}
        </span>
      </div>

      <div className="demo-banner" style={{ background: '#eef3f5', borderColor: '#c9d6db' }}>
        Each card is one session, read from that day's count sheet. Nothing leaves inventory until
        you press <b>Remove stock</b> on the card — and that can be undone.
        {' '}Sessions marked <b>history</b> are from before the system held inventory: they are here
        for run rates only, so they have nothing to remove and are not compared against the shelf.
      </div>

      <div className="card pad" style={{ marginBottom: 12, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="dimmer" style={{ fontSize: 12, marginRight: 2 }}>Show:</span>
        <button className={'btn sm ' + (period === 'current' ? 'primary' : 'ghost')}
          onClick={() => setPeriod('current')} title="Sessions the system holds inventory for">Current</button>
        <button className={'btn sm ' + (period === 'history' ? 'primary' : 'ghost')}
          onClick={() => setPeriod('history')} title="Imported programmes, July and earlier">History</button>
        <button className={'btn sm ' + (period === 'all' ? 'primary' : 'ghost')}
          onClick={() => setPeriod('all')}>All</button>
        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
        <select value={months.includes(period) ? period : ''} style={{ minWidth: 150 }}
          onChange={(e) => e.target.value && setPeriod(e.target.value)}>
          <option value="">— jump to a month —</option>
          {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
        {mine.map((s) => {
          const st = stats(s);
          const done = !!s.applied_at;
          return (
            <div key={s.id} className="card" style={{
              padding: '14px 16px', borderLeft: `4px solid ${isHistory(s) ? 'var(--border)' : done ? 'var(--green,#2e7d5b)' : st.short ? '#d9a441' : 'var(--border)'}`,
              background: isHistory(s) ? '#fafafa' : done ? '#f4f9f6' : '#fff',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <b style={{ fontSize: 14.5 }}>{sessionLabel(s)}</b>
                <div style={{ flex: 1 }} />
                {isHistory(s)
                  ? <span className="badge b-grey" title="Played before the system held inventory — kept for run-rate history only">history</span>
                  : done
                    ? <span className="badge b-green" title={`Applied ${new Date(s.applied_at).toLocaleString()}`}>✓ stock removed</span>
                    : <span className="badge b-gray">not applied</span>}
              </div>

              <div style={{ display: 'flex', gap: 18, margin: '12px 0 4px' }}>
                <div>
                  <div className="mono" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1 }}>{st.total}</div>
                  <div className="dimmer" style={{ fontSize: 11 }}>boxes</div>
                </div>
                <div style={{ borderLeft: '1px solid var(--border-lt)', paddingLeft: 16, fontSize: 12.5 }}>
                  <div><span className="mono" style={{ fontWeight: 600 }}>{st.onsite}</span> <span className="dim">on-site flash</span></div>
                  <div><span className="mono" style={{ fontWeight: 600 }}>{st.presale}</span> <span className="dim">pre-sale flash</span></div>
                </div>
              </div>

              {(st.short > 0 || st.unmatched > 0) && !done && (
                <div style={{ fontSize: 11.5, color: '#8a6100', marginTop: 6 }}>
                  {st.short > 0 && <div>⚠ {st.short} box{st.short === 1 ? '' : 'es'} across {st.shortTitles} game{st.shortTitles === 1 ? '' : 's'} played but never received</div>}
                  {st.unmatched > 0 && <div>⚠ {st.unmatched} not matched to a game yet</div>}
                </div>
              )}

              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                <button className="btn ghost sm" onClick={() => setOpen(s.id)}>See the list →</button>
                <div style={{ flex: 1 }} />
                {!isHistory(s) && can('boxes') && (done
                  ? <button className="btn ghost sm" disabled={busy} onClick={() => doUndo(s)}
                      title="Put these boxes back on the shelf">↩ Undo</button>
                  : <button className="btn primary sm" disabled={busy} onClick={() => setConfirm(s)}>
                      Remove stock
                    </button>)}
              </div>
            </div>
          );
        })}
      </div>
      {mine.length === 0 && (
        <div className="card pad dimmer" style={{ textAlign: 'center' }}>
          No sessions recorded for {HALL[hall]} yet.
        </div>
      )}

      {/* ---- drill-in ---- */}
      {cur && (() => {
        const st = stats(cur);
        const rows = [...st.rows].sort((a, b) =>
          a.category.localeCompare(b.category) || a.name_raw.localeCompare(b.name_raw));
        return (
          <div className="modal-bg" onClick={() => setOpen(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 860, maxWidth: '95vw', maxHeight: '88vh', overflow: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{sessionLabel(cur)} — {HALL[cur.hall_id]}</div>
                {isHistory(cur)
                  ? <span className="badge b-grey" title="Played before the system held inventory">history</span>
                  : cur.applied_at && <span className="badge b-green">✓ stock removed</span>}
                <div style={{ flex: 1 }} />
                <span className="dimmer" style={{ fontSize: 11.5 }}>{cur.source_file}</span>
              </div>
              <p className="dimmer" style={{ fontSize: 12, margin: '4px 0 10px' }}>
                {st.total} boxes — {st.onsite} on-site, {st.presale} pre-sale.
                Names are exactly as written on the count sheet; the matched game is what
                inventory would take the box from.
              </p>
              <table className="tbl">
                <thead><tr>
                  <th className="first">Category</th><th>Game — as written</th><th>Serial</th>
                  <th className="r">Boxes</th><th>Matched game</th><th className="r">In stock</th><th className="last">Status</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const p = pmap[r.product_id];
                    const have = r.product_id ? (cnt[r.product_id]?.inv || 0) : null;
                    const shortRow = !cur.applied_at && !isHistory(cur) && p && r.qty > have;
                    return (
                      <tr key={r.id}>
                        <td className="first">
                          <span className={'badge ' + (r.category === 'on-site' ? 'b-teal' : 'b-gold')} style={{ fontSize: 10 }}>
                            {r.category}
                          </span>
                        </td>
                        <td>{r.name_raw}</td>
                        <td className="mono dimmer" style={{ fontSize: 11.5 }}>{r.serial || '—'}</td>
                        <td className="r mono">{r.qty}</td>
                        <td style={{ fontSize: 12.5 }}>
                          {cur.applied_at ? (
                            p ? p.name : <span className="dimmer">—</span>
                          ) : p ? (
                            <button className="linkish" title="Click to point this line at a different game"
                              onClick={() => { setAssign(r); setQ(''); }}>
                              {p.name}
                              {r.match_how !== 'exact' && <span className="dimmer" style={{ fontSize: 10.5 }}> ({r.match_how})</span>}
                            </button>
                          ) : (
                            <button className="badge b-gold" style={{ border: 0, cursor: 'pointer', font: 'inherit', fontSize: 10, fontWeight: 600 }}
                              title="Pick the game this is" onClick={() => { setAssign(r); setQ(''); }}>
                              no match yet — pick one
                            </button>
                          )}
                        </td>
                        <td className="r mono dimmer">{isHistory(cur) || have == null ? '—' : `${have} ${p ? stockUnit(p)[1] : ''}`}</td>
                        <td className="last" style={{ fontSize: 11.5 }}>
                          {cur.applied_at ? <span style={{ color: 'var(--green,#2e7d5b)' }}>taken out</span>
                            : shortRow ? <span style={{ color: '#8a6100' }}>{have} on shelf, {r.qty - have} never received</span>
                            : p ? <span className="dimmer">ready</span>
                            : <span style={{ color: '#8a6100' }}>can't subtract</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
                {!isHistory(cur) && can('boxes') && (cur.applied_at
                  ? <button className="btn ghost" disabled={busy} onClick={() => doUndo(cur)}>↩ Put these back on the shelf</button>
                  : <button className="btn primary" disabled={busy} onClick={() => { setOpen(null); setConfirm(cur); }}>
                      Remove {st.total - st.unmatched} box{st.total - st.unmatched === 1 ? '' : 'es'}
                    </button>)}
                <div style={{ flex: 1 }} />
                <button className="btn ghost" onClick={() => setOpen(null)}>Close</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ---- pick the game a line means ---- */}
      {assign && (() => {
        const term = q.trim().toLowerCase();
        // Games this hall has put away sink to the bottom, and say why.
        //
        // This picker is where duplicated names actually get resolved by a
        // person, so it is where hiding earns its keep: Red White & Blue is
        // three records and the halls buy different ones. Sorting the hall's
        // own games first means the obvious click is the right one.
        //
        // They stay pickable. A hall genuinely playing a put-away game — the
        // last few boxes of the wrong-hall duplicate, say — must be able to
        // record it, or the line falls into the unmatched pile and someone
        // keys it by hand instead.
        const matches = products
          .filter((p) => p.active !== false && p.type === 'flash')
          .filter((p) => searchMatches(p, term))
          .sort((a, b) => hiddenLast(a, b, hidden) || a.name.localeCompare(b.name));
        const list = matches.slice(0, 60);
        const clipped = matches.length - list.length;
        return (
          <div className="modal-bg" onClick={() => !busy && setAssign(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Which game is this?</div>
              <p className="dimmer" style={{ fontSize: 12.5, margin: '4px 0 10px' }}>
                The count sheet wrote <b style={{ color: 'var(--ink)' }}>{assign.name_raw}</b>
                {assign.serial && <> · serial <span className="mono">{assign.serial}</span></>}.
                Picking here changes what inventory subtracts; the sheet's own wording is left alone.
              </p>
              <input type="text" autoFocus placeholder="Search games…" value={q}
                onChange={(e) => setQ(e.target.value)} style={{ width: '100%' }} />
              <div style={{ maxHeight: 320, overflow: 'auto', marginTop: 10, border: '1px solid var(--border-lt)', borderRadius: 6 }}>
                {list.map((p) => {
                  const have = cnt[p.id]?.inv || 0;
                  return (
                    <div key={p.id} onClick={() => doAssign(p.id)}
                      style={{ padding: '7px 12px', cursor: 'pointer', display: 'flex', gap: 10,
                        alignItems: 'center', borderBottom: '1px solid var(--border-lt)',
                        background: p.id === assign.product_id ? '#eef3f5' : 'transparent' }}>
                      <span style={{ flex: 1, fontSize: 13, opacity: isHidden(hidden, p.id) ? 0.6 : 1 }}>
                        {p.name}
                        {isHidden(hidden, p.id) && (
                          <span className="badge" style={{ marginLeft: 6, fontSize: 10 }}
                            title="Hidden at this hall — usually the other hall's version of this name. Still pickable if this really is what was played.">
                            hidden here
                          </span>
                        )}
                      </span>
                      <span className="dimmer" style={{ fontSize: 11 }}>
                        {p.tickets ? `${p.tickets.toLocaleString()} tkts · ` : ''}{have} in stock
                      </span>
                    </div>
                  );
                })}
                {list.length === 0 && <div className="dimmer" style={{ padding: 16, textAlign: 'center', fontSize: 12.5 }}>
                  Nothing matches. If this is a game we don't carry yet, add it under Add / Update Games first.
                </div>}
                {clipped > 0 && <div className="dimmer" style={{ padding: '8px 12px', fontSize: 11.5, textAlign: 'center' }}>
                  {clipped} more not shown — type a few letters to narrow it down.
                </div>}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                {assign.product_id && (
                  <button className="btn ghost sm" disabled={busy} onClick={() => doAssign(null)}
                    title="Leave this line unmatched — it won't be subtracted">Clear the match</button>
                )}
                <div style={{ flex: 1 }} />
                <button className="btn ghost" disabled={busy} onClick={() => setAssign(null)}>Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ---- the store refused: short on stock, nothing written ---- */}
      {confirm?.kind === 'short' && (
        <div className="modal-bg" onClick={() => !busy && setConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
              {sessionLabel(confirm.session)} plays boxes the hall doesn't have
            </div>
            <p style={{ fontSize: 13, whiteSpace: 'pre-wrap', margin: 0 }}>{confirm.message}</p>
            <p style={{ fontSize: 12.5, background: '#fdf8ee', border: '1px solid #e2c39a',
                        borderRadius: 6, padding: '10px 12px', marginTop: 12 }}>
              Applying anyway records the difference as boxes that were never received into
              stock. That keeps the ledger honest, but it is a write-off — it will show on the
              history as one, and someone still has to find out where those boxes came from.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn ghost" disabled={busy}
                      onClick={() => { const s = confirm.session; setConfirm(null); doApply(s, true); }}>
                {busy ? 'Working…' : 'Apply anyway and record the write-off'}
              </button>
              <div style={{ flex: 1 }} />
              <button className="btn primary" disabled={busy} onClick={() => setConfirm(null)}>
                Stop — I'll fix the stock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- confirm ---- */}
      {confirm && !confirm.kind && (() => {
        const st = stats(confirm);
        return (
          <div className="modal-bg" onClick={() => !busy && setConfirm(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 520 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
                Remove stock for {sessionLabel(confirm)}?
              </div>
              <p style={{ fontSize: 13 }}>
                This marks {st.total - st.unmatched} box{st.total - st.unmatched === 1 ? '' : 'es'} as
                played and sold out at {HALL[confirm.hall_id]} — {st.onsite} on-site, {st.presale} pre-sale.
                Each box is stamped with this session, so <b>Undo</b> puts exactly those back.
              </p>
              {st.short > 0 && (
                <p style={{ fontSize: 12.5, background: '#fdf8ee', border: '1px solid #e2c39a', borderRadius: 6, padding: '10px 12px' }}>
                  <b>{st.short} box{st.short === 1 ? '' : 'es'} across {st.shortTitles} game{st.shortTitles === 1 ? '' : 's'} aren't
                  on the shelf.</b> This will stop rather than take anything off, and show you which
                  games are short. Nothing gets written until you say so on the next screen.
                </p>
              )}
              {st.unmatched > 0 && (
                <p className="dimmer" style={{ fontSize: 12.5 }}>
                  {st.unmatched} box{st.unmatched === 1 ? '' : 'es'} still aren't matched to a game and
                  will be left alone entirely.
                </p>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="btn primary" disabled={busy} onClick={() => doApply(confirm)}>
                  {busy ? 'Working…' : 'Remove stock'}
                </button>
                <div style={{ flex: 1 }} />
                <button className="btn ghost" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
