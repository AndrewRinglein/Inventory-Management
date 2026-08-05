import React, { useContext, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { buildPriceRequests } from '../lib/logic/emails.js';
import { needsCost, needsType, needsTickets } from '../lib/logic/setup.js';
import { fmtMoney } from '../lib/logic/po.js';

/** What we'd ask this vendor about a given game, based on what our record is missing. */
export function askFor(p) {
  const ask = [];
  if (needsCost(p)) ask.push('price');
  if (needsTickets(p)) ask.push('tickets');
  if (needsType(p)) ask.push('type');
  return ask;
}

const ASK_LABEL = { price: 'price', tickets: 'tickets', type: 'type' };

/**
 * Ask a distributor to confirm pricing and ticket counts on specific games.
 *
 * Opens pre-ticked with everything that has a gap, so the common case is two clicks.
 * You can untick those and tick anything else — asking about a game whose price we
 * already hold is a legitimate "is this still right?", so nothing is locked out.
 * One email per vendor, no matter how the selection is spread across them.
 */
export default function AskDistributor({ onClose, preselect = null }) {
  const { hall, products, vendors, store, setToast, can } = useContext(AppCtx);
  const hallName = hall === 'sc' ? 'Santa Clara' : 'Redwood City';

  const gaps = useMemo(
    () => products.filter((p) => p.active !== false && askFor(p).length > 0),
    [products],
  );
  const [picked, setPicked] = useState(() => new Set(preselect ? [preselect] : gaps.map((p) => p.id)));
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(!!preselect);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);

  const pool = showAll ? products.filter((p) => p.active !== false) : gaps;
  const rows = useMemo(() => pool
    .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name)), [pool, q]);

  const vmap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);

  // A game we already know everything about still gets asked "is this current?"
  const items = useMemo(() => products
    .filter((p) => picked.has(p.id))
    .map((p) => ({
      id: p.id, name: p.name, vendor_id: p.vendor_id,
      cost: Number(p.cost) || 0, tickets: p.tickets || 0,
      ask: askFor(p).length ? askFor(p) : ['price', 'tickets'],
    })), [products, picked]);

  const reachable = (vid) => {
    const e = vmap[vid]?.email || '';
    return e.includes('@') && !e.includes('example');
  };
  const emails = useMemo(
    () => buildPriceRequests(items.filter((i) => reachable(i.vendor_id)), vendors, hallName, {}, note),
    [items, vendors, hallName, note, vmap],
  );
  const noEmail = [...new Set(items.map((i) => i.vendor_id))].filter((v) => !reachable(v));

  const toggle = (id) => setPicked((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const setMany = (list, on) => setPicked((s) => {
    const n = new Set(s);
    for (const p of list) on ? n.add(p.id) : n.delete(p.id);
    return n;
  });

  const send = async () => {
    if (busy || !emails.length) return;
    setBusy(true);
    try {
      // sendEmails fills in the real sender identity for this hall server-side
      const logs = await store.sendEmails(emails, hall);
      await store.logEvent('price_request', 'vendors', items.map((i) => i.vendor_id).join(','), {
        label: `${hallName} — asked ${emails.length} distributor${emails.length === 1 ? '' : 's'} about ${items.length} game${items.length === 1 ? '' : 's'}`,
        note: note.trim() || null,
      });
      setSent(logs?.length ?? emails.length);
      setToast(`Sent to ${emails.length} distributor${emails.length === 1 ? '' : 's'}`);
    } catch (e) {
      setToast(e.message || 'Could not send those emails');
    } finally { setBusy(false); }
  };

  if (sent !== null) {
    return (
      <div className="modal-bg" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 460, textAlign: 'center' }}>
          <div style={{ fontSize: 30 }}>📨</div>
          <div style={{ fontWeight: 700, fontSize: 16, margin: '8px 0 4px' }}>
            Sent to {emails.length} distributor{emails.length === 1 ? '' : 's'}
          </div>
          <p className="dim" style={{ fontSize: 13 }}>
            {emails.map((e) => e.to).join(', ')}
          </p>
          <p className="dimmer" style={{ fontSize: 12 }}>
            When they reply, fill the numbers in on Add / Update Games — or click any gold
            “update” tag right where you spot it.
          </p>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={onClose}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 760, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Ask a distributor for pricing &amp; counts</div>
        <p className="dim" style={{ fontSize: 12.5, marginBottom: 12 }}>
          Pick the games you want confirmed. Each distributor gets one email listing only their own games.
        </p>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <input type="text" placeholder="Search games…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show every game, not just the ones with gaps
          </label>
          <div style={{ flex: 1 }} />
          <button className="btn ghost sm" onClick={() => setMany(rows, true)}>Select all shown</button>
          <button className="btn ghost sm" onClick={() => setMany(rows, false)}>Clear</button>
        </div>

        <div className="card" style={{ overflow: 'auto', flex: 1, minHeight: 180 }}>
          <table className="tbl">
            <thead><tr>
              <th className="first" style={{ width: 34 }} />
              <th>Game</th><th style={{ width: 160 }}>Distributor</th>
              <th style={{ width: 190 }}>What we'd ask for</th>
              <th className="r last" style={{ width: 110 }}>What we hold</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => {
                const ask = askFor(p);
                return (
                  <tr key={p.id} className={picked.has(p.id) ? 'hl' : ''} style={{ cursor: 'pointer' }} onClick={() => toggle(p.id)}>
                    <td className="first"><input type="checkbox" checked={picked.has(p.id)} readOnly /></td>
                    <td>{p.name}</td>
                    <td className="dim" style={{ fontSize: 12 }}>{vmap[p.vendor_id]?.name || '—'}</td>
                    <td style={{ fontSize: 11.5 }}>
                      {ask.length
                        ? ask.map((a) => <span key={a} className="badge b-gold" style={{ marginRight: 4 }}>{ASK_LABEL[a]}</span>)
                        : <span className="dimmer">confirm it's still current</span>}
                    </td>
                    <td className="r mono last" style={{ fontSize: 11.5 }}>
                      {needsCost(p) ? <span className="dimmer">—</span> : fmtMoney(p.cost)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">
              {showAll ? 'No games match.' : 'Nothing has a gap right now — tick “show every game” to ask about something anyway.'}
            </div>
          )}
        </div>

        <div className="field" style={{ marginTop: 12, marginBottom: 6 }}>
          <label>Anything to add? (optional — goes in every email)</label>
          <input type="text" value={note} placeholder="e.g. We're planning the fall order and want to budget properly."
            onChange={(e) => setNote(e.target.value)} style={{ width: '100%' }} />
        </div>

        {noEmail.length > 0 && (
          <div className="demo-banner" style={{ margin: '4px 0' }}>
            No usable email address for <b>{noEmail.map((v) => vmap[v]?.name).join(', ')}</b> — those games won't be
            included. Add an address in Settings first.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <button className="btn primary" disabled={!emails.length || busy || !can('send')} onClick={send}
            title={can('send') ? '' : 'Your role cannot send email'}>
            {busy ? 'Sending…' : `Send ${emails.length || 'no'} email${emails.length === 1 ? '' : 's'}`}
          </button>
          <button className="btn ghost" disabled={!emails.length} onClick={() => setPreview(emails[0])}>Preview</button>
          <span className="dim" style={{ fontSize: 12.5 }}>
            {items.length} game{items.length === 1 ? '' : 's'} across {emails.length} distributor{emails.length === 1 ? '' : 's'}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>

        {preview && (
          <div className="modal-bg" onClick={() => setPreview(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 660 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Preview</div>
                <div style={{ flex: 1 }} />
                {emails.map((e) => (
                  <button key={e.vendor_id} className={'btn sm ' + (e === preview ? 'primary' : 'ghost')} onClick={() => setPreview(e)}>
                    {e.vendor_name}
                  </button>
                ))}
              </div>
              <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>To: {preview.to}</div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{preview.subject}</div>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, background: 'var(--bg)', padding: 12, borderRadius: 6, maxHeight: '46vh', overflow: 'auto' }}>
                {preview.body}
              </pre>
              <p className="dimmer" style={{ fontSize: 11.5, marginTop: 6 }}>
                The signature is filled in from Settings → Sender identity when it sends.
              </p>
              <div style={{ display: 'flex', marginTop: 10 }}>
                <div style={{ flex: 1 }} />
                <button className="btn ghost" onClick={() => setPreview(null)}>Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
