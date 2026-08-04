import React, { useContext, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { SESSIONS } from '../lib/sessions.js';

export default function OpenBoxes() {
  const { hall, boxes, products, store, reloadHall, setToast, scanMode, setScanMode, productName, can, openSession, setOpenSession } = useContext(AppCtx);
  const [lookup, setLookup] = useState('');
  const editable = can('boxes');

  const opened = useMemo(
    () => boxes.filter((b) => b.state === 'opened')
      .sort((a, b) => (b.opened_at || '').localeCompare(a.opened_at || '')),
    [boxes]);

  const manualAct = async (box, action) => {
    if (action === 'soldout') {
      await store.transitionBox(box.id, 'sold_out');
      setToast(`Sold out — ${productName(box.product_id)}`,
        async () => { await store.transitionBox(box.id, 'opened'); await reloadHall(); });
    } else {
      await store.transitionBox(box.id, 'in_inventory');
      setToast(`Returned to stock — ${productName(box.product_id)}`);
    }
    await reloadHall();
  };

  // manual serial lookup (same resolver semantics as scanning, for no-scanner situations)
  const findBySerial = (e) => {
    e.preventDefault();
    if (!editable) { setToast('Read-only for your role'); return; }
    const code = lookup.trim();
    if (!code) return;
    const b = boxes.find((x) => x.serial === code);
    if (!b) { setToast(`Serial "${code}" not found in this hall`); return; }
    if (b.state === 'in_inventory') {
      store.updateBox(b.id, { opened_session: openSession })
        .then(() => store.transitionBox(b.id, 'opened'))
        .then(() => { reloadHall(); setToast(`Opened for ${openSession} — ${productName(b.product_id)}`); });
    } else if (b.state === 'opened') {
      store.transitionBox(b.id, 'sold_out').then(() => { reloadHall(); setToast(`Sold out — ${productName(b.product_id)}`); });
    } else {
      setToast(`Box is ${b.state.replace('_', ' ')} — nothing to do`);
    }
    setLookup('');
  };

  const ModeBtn = ({ id, label, cls }) => (
    <button className={'btn ' + (scanMode === id ? cls : 'ghost')} onClick={() => setScanMode(scanMode === id ? 'off' : id)}>{label}</button>
  );

  return (
    <div>
      <div className="page-head">
        <div className="h1">Open Boxes — {hall === 'sc' ? 'Santa Clara' : 'Redwood City'}</div>
        <div className="grow" />
        <div className={'scan-ind ' + (scanMode !== 'off' ? 'on' : '')}>
          <span className="dot" />
          {scanMode === 'off' ? 'Scanner off' : scanMode === 'open' ? 'Scan mode: OPEN box' : 'Scan mode: SOLD OUT'}
        </div>
      </div>
      <div className="card pad" style={{ marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {editable ? (<>
          <div className="field" style={{ margin: 0 }}>
            <label>Opening for session</label>
            <select value={openSession} onChange={(e) => setOpenSession(e.target.value)} style={{ fontWeight: 600 }}>
              {SESSIONS.map((sn) => <option key={sn} value={sn}>{sn}</option>)}
            </select>
          </div>
          <ModeBtn id="open" label="📦 Open-box scan" cls="orange" />
          <ModeBtn id="soldout" label="💰 Sold-out scan" cls="green" />
        </>) : <span className="dimmer" style={{ fontSize: 12.5 }}>Read-only for your role — scanning and status changes disabled.</span>}
        <div style={{ flex: 1 }} />
        <form onSubmit={findBySerial} style={{ display: 'flex', gap: 8 }}>
          <input type="text" placeholder="…or type a serial number" value={lookup} data-scan-target="1"
            onChange={(e) => setLookup(e.target.value)} style={{ width: 220 }} />
          <button className="btn ghost">Go</button>
        </form>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--border)' }}>
          Currently open on the floor ({opened.length})
        </div>
        <table className="tbl">
          <thead><tr>
            <th className="first">Game</th><th>Serial</th><th>Session</th><th>Opened</th><th className="last r" style={{ width: 210 }} />
          </tr></thead>
          <tbody>
            {opened.map((b) => (
              <tr key={b.id}>
                <td className="first">{productName(b.product_id)}</td>
                <td className="mono dim">{b.serial || '—'}</td>
                <td style={{ fontSize: 11, color: 'var(--green)' }}>{b.opened_session || b.session_tag || '—'}</td>
                <td className="dimmer" style={{ fontSize: 12 }}>
                  {b.opened_at ? new Date(b.opened_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                </td>
                <td className="last r" style={{ whiteSpace: 'nowrap' }}>
                  {editable ? (<>
                    <button className="btn green sm" onClick={() => manualAct(b, 'soldout')}>Sold out</button>{' '}
                    <button className="btn ghost sm" onClick={() => manualAct(b, 'return')}>Back to stock</button>
                  </>) : <span className="dimmer" style={{ fontSize: 11 }}>read-only</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {opened.length === 0 && <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">No boxes are open. Open one from Inventory, or scan with mode ON.</div>}
      </div>
    </div>
  );
}
