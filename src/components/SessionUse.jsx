import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
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
  const { hall, products, boxes, store, reloadHall, setToast, requirePin, can } = useContext(AppCtx);
  const [sessions, setSessions] = useState(null);
  const [plays, setPlays] = useState([]);
  const [open, setOpen] = useState(null);     // session id drilled into
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

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

  const mine = (sessions || []).filter((s) => s.hall_id === hall);

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
    if (!s.applied_at) {
      for (const [pid, n] of Object.entries(want)) {
        const have = cnt[pid]?.inv || 0;
        if (n > have) { short += n - have; shortTitles++; }
      }
    }
    return { rows, onsite, presale, total: onsite + presale, unmatched, short, shortTitles };
  };

  const doApply = async (s) => {
    if (busy) return;
    if (!(await requirePin())) return;
    setBusy(true);
    try {
      const res = await store.applySession(s.id, byS[s.id] || []);
      await Promise.all([load(), reloadHall()]);
      setConfirm(null);
      setToast(res.short.length
        ? `${res.moved} box(es) taken out of stock — ${res.short.length} game(s) came up short and were left alone`
        : `${res.moved} box(es) taken out of stock`, null, 8000);
    } catch (e) {
      setToast(e.message || 'Could not apply that session', null, 8000);
    } finally { setBusy(false); }
  };

  const doUndo = async (s) => {
    if (busy) return;
    if (!(await requirePin())) return;
    setBusy(true);
    try {
      const res = await store.undoSession(s.id);
      await Promise.all([load(), reloadHall()]);
      setToast(`${res.restored} box(es) put back on the shelf`);
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
          {mine.length} session{mine.length === 1 ? '' : 's'} · {totalBoxes} flash boxes played ·{' '}
          <b>{applied}</b> taken out of stock
        </span>
      </div>

      <div className="demo-banner" style={{ background: '#eef3f5', borderColor: '#c9d6db' }}>
        Each card is one session, read from that day's count sheet. Nothing leaves inventory until
        you press <b>Take out of stock</b> on the card — and that can be undone.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
        {mine.map((s) => {
          const st = stats(s);
          const done = !!s.applied_at;
          return (
            <div key={s.id} className="card" style={{
              padding: '14px 16px', borderLeft: `4px solid ${done ? 'var(--green,#2e7d5b)' : st.short ? '#d9a441' : 'var(--border)'}`,
              background: done ? '#f4f9f6' : '#fff',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <b style={{ fontSize: 14.5 }}>{sessionLabel(s)}</b>
                <div style={{ flex: 1 }} />
                {done
                  ? <span className="badge b-green" title={`Applied ${new Date(s.applied_at).toLocaleString()}`}>✓ out of stock</span>
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
                  {st.short > 0 && <div>⚠ {st.short} box{st.short === 1 ? '' : 'es'} across {st.shortTitles} game{st.shortTitles === 1 ? '' : 's'} not on the shelf</div>}
                  {st.unmatched > 0 && <div>⚠ {st.unmatched} not matched to a game yet</div>}
                </div>
              )}

              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                <button className="btn ghost sm" onClick={() => setOpen(s.id)}>See the list →</button>
                <div style={{ flex: 1 }} />
                {can('boxes') && (done
                  ? <button className="btn ghost sm" disabled={busy} onClick={() => doUndo(s)}
                      title="Put these boxes back on the shelf">↩ Undo</button>
                  : <button className="btn primary sm" disabled={busy} onClick={() => setConfirm(s)}>
                      Take out of stock
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
                {cur.applied_at && <span className="badge b-green">✓ out of stock</span>}
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
                    const shortRow = !cur.applied_at && p && r.qty > have;
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
                          {p
                            ? <>{p.name}{r.match_how !== 'exact' &&
                                <span className="dimmer" style={{ fontSize: 10.5 }}> ({r.match_how})</span>}</>
                            : <span className="badge b-gold" style={{ fontSize: 10 }}>no match yet</span>}
                        </td>
                        <td className="r mono dimmer">{have == null ? '—' : `${have} ${p ? stockUnit(p)[1] : ''}`}</td>
                        <td className="last" style={{ fontSize: 11.5 }}>
                          {cur.applied_at ? <span style={{ color: 'var(--green,#2e7d5b)' }}>taken out</span>
                            : shortRow ? <span style={{ color: '#8a6100' }}>only {have} on shelf</span>
                            : p ? <span className="dimmer">ready</span>
                            : <span style={{ color: '#8a6100' }}>can't subtract</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
                {can('boxes') && (cur.applied_at
                  ? <button className="btn ghost" disabled={busy} onClick={() => doUndo(cur)}>↩ Put these back on the shelf</button>
                  : <button className="btn primary" disabled={busy} onClick={() => { setOpen(null); setConfirm(cur); }}>
                      Take {st.total - st.unmatched} box{st.total - st.unmatched === 1 ? '' : 'es'} out of stock
                    </button>)}
                <div style={{ flex: 1 }} />
                <button className="btn ghost" onClick={() => setOpen(null)}>Close</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ---- confirm ---- */}
      {confirm && (() => {
        const st = stats(confirm);
        return (
          <div className="modal-bg" onClick={() => !busy && setConfirm(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 520 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
                Take {sessionLabel(confirm)} out of stock?
              </div>
              <p style={{ fontSize: 13 }}>
                This marks {st.total - st.unmatched} box{st.total - st.unmatched === 1 ? '' : 'es'} as
                played and sold out at {HALL[confirm.hall_id]} — {st.onsite} on-site, {st.presale} pre-sale.
                Each box is stamped with this session, so <b>Undo</b> puts exactly those back.
              </p>
              {st.short > 0 && (
                <p style={{ fontSize: 12.5, background: '#fdf8ee', border: '1px solid #e2c39a', borderRadius: 6, padding: '10px 12px' }}>
                  <b>{st.short} box{st.short === 1 ? '' : 'es'} across {st.shortTitles} game{st.shortTitles === 1 ? '' : 's'} aren't
                  on the shelf.</b> Those will be skipped, not forced negative — the sheet says they were
                  played, so either a delivery was never received in or the count is behind. Whatever is
                  there will come out; the rest stays for you to sort out.
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
                  {busy ? 'Working…' : 'Take out of stock'}
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
