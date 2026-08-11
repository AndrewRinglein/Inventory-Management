import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { countByProduct } from '../lib/logic/boxes.js';
import { passesFilters } from '../lib/logic/categories.js';

const HALL = { sc: 'Santa Clara', rwc: 'Redwood City' };

// Saturday and Sunday run twice; every other day runs once. Nine a week.
const isDouble = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const wd = new Date(y, m - 1, d, 12).getDay();
  return wd === 0 || wd === 6;
};
const dayName = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString('en-US',
    { weekday: 'long', month: 'short', day: 'numeric' });
};
/** "Sunday PM" — what the Paymaster sheet calls it. */
export const sessionName = (s) => {
  const [y, m, d] = s.session_date.split('-').map(Number);
  const wd = new Date(y, m - 1, d, 12).toLocaleDateString('en-US', { weekday: 'long' });
  return s.part ? `${wd} ${s.part}` : wd;
};
const longLabel = (s) => `${dayName(s.session_date)}${s.part ? ` · ${s.part}` : ''}`;

export default function Assign() {
  const { hall, products, boxes, store, setToast, can } = useContext(AppCtx);
  const today = new Date().toISOString().slice(0, 10);

  const [tab, setTab] = useState('build');        // build | assigned
  const [sessions, setSessions] = useState([]);
  const [assign, setAssign] = useState([]);       // all assignments for this hall
  const [date, setDate] = useState(today);
  const [part, setPart] = useState('');
  const [picked, setPicked] = useState(new Set());
  const [q, setQ] = useState('');
  const [onlyStocked, setOnlyStocked] = useState(true);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(null);  // the session object being printed

  const load = async () => {
    const [s, a] = await Promise.all([store.getSessions(), store.getAssignments(hall)]);
    setSessions(s); setAssign(a);
  };
  useEffect(() => { load(); }, [hall]);   // eslint-disable-line

  const pmap = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const cnt = useMemo(() => countByProduct(boxes), [boxes]);

  // a Sat/Sun date needs AM or PM; a weekday must not carry one
  useEffect(() => { if (!isDouble(date) && part) setPart(''); }, [date]);   // eslint-disable-line

  const current = sessions.find((s) =>
    s.hall_id === hall && s.session_date === date && (s.part || '') === (part || ''));

  // load the existing picks whenever the chosen session changes
  useEffect(() => {
    setPicked(new Set(current ? assign.filter((a) => a.session_id === current.id).map((a) => a.product_id) : []));
  }, [current?.id, assign]);   // eslint-disable-line

  const byS = useMemo(() => {
    const m = {};
    for (const a of assign) (m[a.session_id] ||= []).push(a.product_id);
    return m;
  }, [assign]);

  const flash = useMemo(() => {
    const term = q.trim().toLowerCase();
    return products
      .filter((p) => p.active !== false && p.type === 'flash')
      .filter((p) => passesFilters(p, { type: 'flash', misc: 'games' }))
      .filter((p) => picked.has(p.id) || (
        (!term || p.name.toLowerCase().includes(term)) &&
        (!onlyStocked || (cnt[p.id]?.inv || 0) > 0)
      ))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, q, onlyStocked, cnt, picked]);

  const toggle = (pid) => setPicked((s) => {
    const n = new Set(s);
    n.has(pid) ? n.delete(pid) : n.add(pid);    // one of each, so it's on or off
    return n;
  });

  const save = async (thenPrint) => {
    if (busy) return;
    setBusy(true);
    try {
      const sess = await store.ensureSession({ hallId: hall, date, part });
      await store.setAssignments(sess.id, [...picked]);
      await load();
      setToast(`${picked.size} flash game${picked.size === 1 ? '' : 's'} assigned to ${longLabel(sess)}`);
      if (thenPrint) setPrinting({ ...sess, ids: [...picked] });
    } catch (e) {
      setToast(e.message || 'Could not save that assignment', null, 8000);
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => { window.print(); setPrinting(null); }, 60);
    return () => clearTimeout(t);
  }, [printing]);

  const assignedSessions = sessions
    .filter((s) => s.hall_id === hall && (byS[s.id] || []).length)
    .sort((a, b) => b.session_date.localeCompare(a.session_date) || (b.part || '').localeCompare(a.part || ''));

  const editSession = (s) => {
    setDate(s.session_date); setPart(s.part || ''); setTab('build');
  };

  return (
    <div>
      <div className="page-head no-print">
        <div className="h1">Assign — {HALL[hall]}</div>
        <div className="hall-switch" style={{ margin: 0 }}>
          <button className={tab === 'build' ? 'on' : ''} onClick={() => setTab('build')}>Assign a session</button>
          <button className={tab === 'assigned' ? 'on' : ''} onClick={() => setTab('assigned')}>
            Assigned ({assignedSessions.length})
          </button>
        </div>
        <div className="grow" />
        <span className="dimmer" style={{ fontSize: 12 }}>
          Assigning racks games for a night. It doesn't move stock — what was played comes back on the count sheet.
        </span>
      </div>

      {tab === 'build' && (
        <div className="no-print">
          <div className="card pad" style={{ marginBottom: 12, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Session date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} />
            </div>
            {isDouble(date) && (
              <div className="field" style={{ margin: 0 }}>
                <label>Which one</label>
                <div className="hall-switch" style={{ margin: 0 }}>
                  <button className={part === 'AM' ? 'on' : ''} onClick={() => setPart('AM')}>Afternoon</button>
                  <button className={part === 'PM' ? 'on' : ''} onClick={() => setPart('PM')}>Evening</button>
                </div>
              </div>
            )}
            <div style={{ fontSize: 13 }}>
              <div style={{ fontWeight: 700 }}>{dayName(date)}{part ? ` · ${part === 'AM' ? 'afternoon' : 'evening'}` : ''}</div>
              <div className="dimmer" style={{ fontSize: 12 }}>
                {current
                  ? `${(byS[current.id] || []).length} already assigned${current.applied_at ? ' · session already taken out of stock' : ''}`
                  : 'Nothing assigned to this session yet'}
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ textAlign: 'right' }}>
              <div className="mono" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{picked.size}</div>
              <div className="dimmer" style={{ fontSize: 11 }}>games picked</div>
            </div>
            {can('boxes') && (<>
              <button className="btn" disabled={busy || (isDouble(date) && !part)} onClick={() => save(false)}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button className="btn primary" disabled={busy || !picked.size || (isDouble(date) && !part)}
                onClick={() => save(true)}>Save &amp; print</button>
            </>)}
          </div>

          {isDouble(date) && !part && (
            <div className="demo-banner">{dayName(date)} runs twice — pick afternoon or evening.</div>
          )}

          <div className="filter-bar">
            <input type="text" placeholder="Search flash games…" value={q}
              onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={onlyStocked} onChange={(e) => setOnlyStocked(e.target.checked)} />
              In stock only
            </label>
            <div style={{ flex: 1 }} />
            <span className="dimmer" style={{ fontSize: 12 }}>{flash.length} flash games shown</span>
            {picked.size > 0 && <button className="btn ghost sm" onClick={() => setPicked(new Set())}>Clear picks</button>}
          </div>

          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr>
                <th className="first" style={{ width: 52 }}>Rack</th>
                <th>Flash game</th><th className="r">Tickets</th><th className="r">$ / tkt</th>
                <th className="r">In stock</th><th className="last">Also assigned to</th>
              </tr></thead>
              <tbody>
                {flash.map((p) => {
                  const on = picked.has(p.id);
                  const have = cnt[p.id]?.inv || 0;
                  // the same game racked for another night is worth knowing before you commit
                  const clash = sessions.filter((s) => s.hall_id === hall && !s.applied_at
                    && s.id !== current?.id && (byS[s.id] || []).includes(p.id));
                  return (
                    <tr key={p.id} className={on ? 'hl' : ''} style={{ cursor: 'pointer' }} onClick={() => toggle(p.id)}>
                      <td className="first" style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={on} onChange={() => toggle(p.id)}
                          onClick={(e) => e.stopPropagation()} />
                      </td>
                      <td>{p.name}</td>
                      <td className="r mono dimmer">{p.tickets ? p.tickets.toLocaleString() : '—'}</td>
                      <td className="r mono dimmer">${Number(p.price_per_ticket) || 1}</td>
                      <td className="r mono" style={{ color: have ? undefined : '#a33b2e' }}>{have}</td>
                      <td className="last dimmer" style={{ fontSize: 11.5 }}>
                        {clash.length ? clash.map(sessionName).join(', ') : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {flash.length === 0 && <div className="dimmer" style={{ padding: 28, textAlign: 'center' }}>
              No flash games match{onlyStocked ? ' — try unticking "In stock only"' : ''}.
            </div>}
          </div>
        </div>
      )}

      {tab === 'assigned' && (
        <div className="no-print" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 12 }}>
          {assignedSessions.map((s) => {
            const ids = byS[s.id] || [];
            const past = s.session_date < today;
            return (
              <div key={s.id} className="card" style={{ padding: '14px 16px',
                borderLeft: `4px solid ${s.applied_at ? 'var(--green,#2e7d5b)' : past ? '#c9ced2' : 'var(--gold,#d9a441)'}` }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <b style={{ fontSize: 14.5 }}>{longLabel(s)}</b>
                  <div style={{ flex: 1 }} />
                  {s.applied_at
                    ? <span className="badge b-green">played</span>
                    : past ? <span className="badge b-gray">past</span>
                    : <span className="badge b-gold">upcoming</span>}
                </div>
                <div style={{ margin: '10px 0 6px' }}>
                  <span className="mono" style={{ fontSize: 24, fontWeight: 700 }}>{ids.length}</span>
                  <span className="dimmer" style={{ fontSize: 12 }}> flash games racked</span>
                </div>
                <div className="dimmer" style={{ fontSize: 11.5, maxHeight: 58, overflow: 'hidden' }}>
                  {ids.map((id) => pmap[id]?.name || id).sort().join(' · ')}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  {can('boxes') && <button className="btn ghost sm" onClick={() => editSession(s)}>Edit</button>}
                  <div style={{ flex: 1 }} />
                  <button className="btn ghost sm" onClick={() => setPrinting({ ...s, ids })}>🖨 Print</button>
                </div>
              </div>
            );
          })}
          {assignedSessions.length === 0 && (
            <div className="card pad dimmer" style={{ gridColumn: '1 / -1', textAlign: 'center' }}>
              Nothing assigned yet for {HALL[hall]}.
            </div>
          )}
        </div>
      )}

      {printing && <PaymasterSheet session={printing} pmap={pmap} />}
    </div>
  );
}

/**
 * The Paymaster Tracking Sheet, as it exists on paper today.
 *
 * Only the game names are filled in — Daub, Downline, Last Ball and Instants are
 * per-game payout figures the catalog does not hold yet, so they print as ruled
 * blanks for the Paymaster to write in, exactly as the current sheet does. Name
 * and Start Cash are blanks for the same reason. Rows are padded to the bottom of
 * the page so there is always somewhere to add a game that went on late.
 */
function PaymasterSheet({ session, pmap }) {
  const names = (session.ids || []).map((id) => pmap[id]?.name || id).sort((a, b) => a.localeCompare(b));
  const ROWS = 30;                                   // fills a Letter page
  const blanks = Math.max(0, ROWS - names.length);
  const rule = { borderBottom: '1px solid #000', height: 26 };
  // the paper form rules each column separately, with a gap between — it reads as
  // four places to write rather than one long line, so keep that
  const Cell = () => <td style={{ padding: '0 6px', height: 26 }}><div style={{ borderBottom: '1px solid #000', height: '100%' }} /></td>;

  return (
    <div className="print-only paymaster">
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 26 }}>Paymaster Tracking Sheet</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 18 }}>
        <tbody>
          <tr>
            <td style={{ width: '48%', ...rule, verticalAlign: 'bottom' }} />
            <td style={{ width: '4%' }} />
            <td style={{ width: '16%', verticalAlign: 'bottom', fontSize: 12 }}>Day:</td>
            <td style={{ width: '32%', ...rule, verticalAlign: 'bottom', fontSize: 12, textAlign: 'center' }}>
              {sessionName(session)}
            </td>
          </tr>
          <tr><td style={{ fontSize: 12, paddingTop: 2 }}>Name:</td><td /><td /><td /></tr>
          <tr>
            <td style={{ height: 18 }} /><td />
            <td style={{ verticalAlign: 'bottom', fontSize: 12 }}>Start Cash:</td>
            <td style={{ ...rule }} />
          </tr>
        </tbody>
      </table>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', width: '30%', paddingBottom: 4 }}>Flash Game</th>
            <th style={{ textAlign: 'center', width: '16%' }}>Daub</th>
            <th style={{ textAlign: 'center', width: '18%' }}>Downline</th>
            <th style={{ textAlign: 'center', width: '18%' }}>Last Ball</th>
            <th style={{ textAlign: 'center', width: '18%' }}>Instants</th>
          </tr>
        </thead>
        <tbody>
          {names.map((n, i) => (
            <tr key={i}>
              <td style={{ ...rule, paddingRight: 10 }}>{n}</td>
              <Cell /><Cell /><Cell /><Cell />
            </tr>
          ))}
          {Array.from({ length: blanks }, (_, i) => (
            <tr key={`b${i}`}>
              <td style={{ ...rule, paddingRight: 10 }} />
              <Cell /><Cell /><Cell /><Cell />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// exposed so the print layout can be rendered and eyeballed in a test harness
Assign.__paymaster = PaymasterSheet;
