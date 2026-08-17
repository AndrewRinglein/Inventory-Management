import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney } from '../lib/logic/po.js';
import { REASONS, reasonLabel } from './Adjust.jsx';

/**
 * Everything that has happened, in one place.
 *
 * The Dashboard shows the last twelve, which is enough to notice something and
 * nowhere near enough to answer a question. This is the same feed with the whole
 * record behind it: filter by what kind of thing happened, search the text, and
 * for adjustments see the reason and what it did to the shelf.
 *
 * Raw row-level audit rows are deliberately not here — see getEvents. They are
 * forensics, and loading one invoice writes three hundred of them.
 */

const HALLS = { sc: 'Santa Clara', rwc: 'Redwood City' };

// how each kind reads to a person, and what colour it carries
const KINDS = {
  'adjust':        { label: 'Stock adjusted', tone: 'b-orange' },
  'po.record':     { label: 'Order recorded', tone: 'b-teal' },
  'po.reprice':    { label: 'Order repriced', tone: 'b-teal' },
  'po.archive':    { label: 'Order archived', tone: 'b-grey' },
  'po.restore':    { label: 'Order restored', tone: 'b-grey' },
  'delivery.add':  { label: 'Delivery',       tone: 'b-green' },
  'shipment.receive': { label: 'Order received', tone: 'b-green' },
  'session.apply': { label: 'Session used',   tone: 'b-teal' },
  'session.short': { label: 'Never received', tone: 'b-orange' },
  'session.undo':  { label: 'Session undone', tone: 'b-orange' },
  'email.send':    { label: 'Email sent',     tone: 'b-teal' },
  'eom':           { label: 'End of month',   tone: 'b-green' },
  'count':         { label: 'Count',          tone: 'b-teal' },
};
const kindOf = (k) => KINDS[k] || { label: k, tone: 'b-grey' };

const GROUPS = [
  { id: 'all',        label: 'Everything', match: () => true },
  { id: 'adjust',     label: 'Adjustments', match: (e) => e.kind === 'adjust' },
  { id: 'stock',      label: 'Stock in',    match: (e) => e.kind === 'delivery.add' || e.kind === 'shipment.receive' },
  { id: 'received',   label: 'Received',    match: (e) => e.kind === 'shipment.receive' },
  { id: 'orders',     label: 'Orders',      match: (e) => e.kind.startsWith('po.') || e.kind === 'email.send' },
  { id: 'sessions',   label: 'Sessions',    match: (e) => e.kind.startsWith('session.') },
];

const dayLabel = (iso) => {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today - that) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};

export default function History() {
  const { hall, store, boxes, pos } = useContext(AppCtx);
  const [events, setEvents] = useState([]);
  const [adjust, setAdjust] = useState([]);
  const [group, setGroup] = useState('all');
  const [reason, setReason] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  // shipment id -> lines, fetched only when a receipt is opened. A confirmed
  // order can bring three hundred boxes; loading every one of them to draw a
  // feed nobody has expanded is the reason this is lazy.
  const [open, setOpen] = useState({});
  const [detail, setDetail] = useState({});

  const toggleReceipt = async (id) => {
    setOpen((o) => ({ ...o, [id]: !o[id] }));
    if (detail[id] || !store.getReceiptDetail) return;
    setDetail((d) => ({ ...d, [id]: 'loading' }));
    try {
      const lines = await store.getReceiptDetail(id);
      setDetail((d) => ({ ...d, [id]: lines }));
    } catch {
      setDetail((d) => ({ ...d, [id]: [] }));
    }
  };

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([
      store.getEvents(500).catch(() => []),
      store.getAdjustments ? store.getAdjustments(hall).catch(() => []) : [],
    ]).then(([ev, adj]) => {
      if (!live) return;
      setEvents(ev || []); setAdjust(adj || []); setLoading(false);
    });
    return () => { live = false; };
  }, [hall, store, boxes, pos]);

  // adjustment lines, keyed by the event they belong to, so a swap shows both sides
  const linesFor = useMemo(() => {
    const m = {};
    for (const l of adjust) (m[l.id] ||= []).push(l);
    return m;
  }, [adjust]);

  const shown = useMemo(() => {
    const g = GROUPS.find((x) => x.id === group) || GROUPS[0];
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      if (!g.match(e)) return false;
      if (reason && (e.kind !== 'adjust' || e.detail?.reason !== reason)) return false;
      // events carry the hall in the label or the detail; keep anything unlabelled
      const h = e.detail?.hall;
      if (h && h !== hall) return false;
      if (!needle) return true;
      return JSON.stringify(e.detail || {}).toLowerCase().includes(needle)
        || String(e.entity_id).toLowerCase().includes(needle);
    });
  }, [events, group, reason, q, hall]);

  const byDay = useMemo(() => {
    const out = [];
    for (const e of shown) {
      const d = dayLabel(e.at);
      if (!out.length || out[out.length - 1].day !== d) out.push({ day: d, rows: [] });
      out[out.length - 1].rows.push(e);
    }
    return out;
  }, [shown]);

  // what the adjustments in view did to the shelf, by reason
  const totals = useMemo(() => {
    const t = {};
    for (const l of adjust) {
      if (reason && l.reason !== reason) continue;
      const r = (t[l.reason] ||= { boxes: 0, value: 0 });
      r.boxes += Number(l.delta) || 0;
      r.value += Number(l.value_change) || 0;
    }
    return t;
  }, [adjust, reason]);

  return (
    <div>
      <div className="page-head">
        <div className="h1">History — {HALLS[hall]}</div>
        <div className="grow" />
        <span className="dimmer" style={{ fontSize: 12.5 }}>
          {loading ? 'loading…' : `${shown.length} of ${events.length}`}
        </span>
      </div>

      <div className="card pad" style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {GROUPS.map((g) => (
          <button key={g.id} className={'btn sm ' + (group === g.id ? 'primary' : 'ghost')}
            onClick={() => { setGroup(g.id); if (g.id !== 'adjust') setReason(''); }}>{g.label}</button>
        ))}
        <div style={{ width: 1, height: 22, background: 'var(--border)' }} />
        <input type="text" value={q} placeholder="Search notes, games, PO numbers…"
          onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
      </div>

      {group === 'adjust' && (
        <div className="card pad" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="dimmer" style={{ fontSize: 12 }}>Reason:</span>
            <button className={'btn sm ' + (reason === '' ? 'primary' : 'ghost')} onClick={() => setReason('')}>All</button>
            {REASONS.map((r) => (
              <button key={r.id} className={'btn sm ' + (reason === r.id ? 'primary' : 'ghost')}
                onClick={() => setReason(r.id)}>{r.label}</button>
            ))}
          </div>
          {Object.keys(totals).length > 0 && (
            <table className="tbl" style={{ marginTop: 10 }}><tbody>
              {Object.entries(totals).sort((a, b) => a[1].value - b[1].value).map(([r, v]) => (
                <tr key={r}>
                  <td className="first">{reasonLabel(r)}</td>
                  <td className="r mono">{v.boxes > 0 ? `+${v.boxes}` : v.boxes} boxes</td>
                  <td className="r mono last" style={{ color: v.value < 0 ? 'var(--orange)' : 'var(--green)' }}>
                    {fmtMoney(v.value)}
                  </td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      )}

      {!loading && !shown.length && (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div className="dimmer">Nothing matches that.</div>
        </div>
      )}

      {byDay.map((d) => (
        <div key={d.day} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--dim)', margin: '0 0 6px 2px' }}>{d.day}</div>
          <div className="card" style={{ overflow: 'hidden' }}>
            {d.rows.map((e, i) => {
              const k = kindOf(e.kind);
              const lines = e.kind === 'adjust' ? linesFor[e.entity_id] : null;
              return (
                <div key={e.id ?? i} style={{ padding: '10px 14px', borderBottom: i === d.rows.length - 1 ? 0 : '1px solid var(--border-lt)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span className="dimmer mono" style={{ fontSize: 11, minWidth: 44 }}>
                      {new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </span>
                    <span className={'badge ' + k.tone}>{k.label}</span>
                    {e.detail?.reason && <span className="badge b-grey">{reasonLabel(e.detail.reason)}</span>}
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {e.detail?.label || `${e.entity} ${String(e.entity_id).slice(0, 12)}`}
                    </span>
                    {e.kind === 'shipment.receive' && (
                      <button className="btn sm ghost" style={{ padding: '1px 8px', fontSize: 11.5 }}
                        onClick={() => toggleReceipt(e.entity_id)}>
                        {open[e.entity_id] ? 'Hide what arrived' : 'See what arrived'}
                      </button>
                    )}
                  </div>
                  {e.kind === 'shipment.receive' && open[e.entity_id] && (
                    <div style={{ marginTop: 6, paddingLeft: 52 }}>
                      {detail[e.entity_id] === 'loading' && <span className="dimmer" style={{ fontSize: 12 }}>loading…</span>}
                      {Array.isArray(detail[e.entity_id]) && detail[e.entity_id].length === 0 && (
                        <span className="dimmer" style={{ fontSize: 12 }}>
                          No boxes are recorded against this receipt.
                        </span>
                      )}
                      {Array.isArray(detail[e.entity_id]) && detail[e.entity_id].length > 0 && (
                        <table className="tbl" style={{ maxWidth: 620 }}><tbody>
                          {detail[e.entity_id].map((l) => (
                            <tr key={l.product_id}>
                              <td className="first">{l.name}</td>
                              <td className="r mono">{l.boxes} box{l.boxes === 1 ? '' : 'es'}</td>
                              <td className="r mono">{fmtMoney(l.value)}</td>
                              <td className="r last dimmer" style={{ fontSize: 11.5 }}>
                                {/* where those boxes are now — a receipt whose stock is
                                    already played reads very differently from one sitting
                                    untouched on the shelf */}
                                {Object.entries(l.states).map(([s, n]) => `${n} ${s.replace('_', ' ')}`).join(', ')}
                              </td>
                            </tr>
                          ))}
                          <tr>
                            <td className="first" style={{ fontWeight: 700 }}>Total</td>
                            <td className="r mono" style={{ fontWeight: 700 }}>
                              {detail[e.entity_id].reduce((a, l) => a + l.boxes, 0)} boxes
                            </td>
                            <td className="r mono last" style={{ fontWeight: 700 }} colSpan={2}>
                              {fmtMoney(detail[e.entity_id].reduce((a, l) => a + l.value, 0))}
                            </td>
                          </tr>
                        </tbody></table>
                      )}
                    </div>
                  )}
                  {e.detail?.note && (
                    <div className="dim" style={{ fontSize: 12, marginTop: 3, paddingLeft: 52 }}>
                      &ldquo;{e.detail.note}&rdquo;
                    </div>
                  )}
                  {lines && lines.length > 0 && (
                    <div className="mono" style={{ fontSize: 11.5, marginTop: 4, paddingLeft: 52 }}>
                      {lines.map((l) => (
                        <span key={l.product_id + l.delta} style={{ marginRight: 14,
                          color: l.delta < 0 ? 'var(--orange)' : 'var(--green)' }}>
                          {l.delta > 0 ? '+' : '−'}{Math.abs(l.delta)} {l.game}
                          {l.hall_id !== hall && <span className="dimmer"> ({HALLS[l.hall_id]})</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
