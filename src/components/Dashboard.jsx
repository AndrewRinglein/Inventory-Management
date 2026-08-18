import React, { useContext, useEffect, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney, sumMoney } from '../lib/logic/po.js';
import { onFloor, isOffsite } from '../lib/logic/location.js';

const HALL_NAMES = { sc: 'Santa Clara', rwc: 'Redwood City' };

export default function Dashboard() {
  const { hall, boxes, pos, payments, products, setScreen, store, settings, reloadSettings, setToast, can } = useContext(AppCtx);
  const [events, setEvents] = useState([]);
  const lastEom = settings.eom?.[hall];
  const markEom = async () => {
    const now = new Date().toISOString();
    await store.setSetting('eom', { ...(settings.eom || {}), [hall]: now });
    await store.logEvent('eom', 'halls', hall, { label: `${HALL_NAMES[hall]} EOM updated` });
    await reloadSettings();
    setEvents(await store.getEvents(12));
    setToast(`${HALL_NAMES[hall]} EOM marked complete`);
  };
  useEffect(() => { store.getEvents(12).then(setEvents); }, [boxes, pos]);   // eslint-disable-line
  const [dels, setDels] = useState([]);
  // arrivals, not deliveries: receiving a PO writes a shipment and 'Add delivery'
  // writes a delivery, and a hall that receives through the PO flow saw an empty list
  useEffect(() => { store.getArrivals(hall).then(setDels).catch(() => setDels([])); }, [hall, boxes, pos]);   // eslint-disable-line

  // ON THE FLOOR. Stock a distributor is holding is owned, not available, and
  // folding it in here would overstate every number on this screen.
  const floor = onFloor(boxes);
  const offCount = boxes.filter((b) => isOffsite(b)
    && (b.state === 'in_inventory' || b.state === 'opened')).length;
  const live = floor.filter((b) => b.state === 'in_inventory' || b.state === 'opened');
  const liveVal = sumMoney(live, (b) => b.cost);
  // boxes on an archived order aren't really in transit any more — the order left
  // the working views, so it shouldn't keep feeding the dashboard a number
  const liveIds = new Set(pos.map((p) => p.id));
  const inTransit = boxes.filter((b) => b.state === 'on_order' && (!b.po_id || liveIds.has(b.po_id))).length;
  const openPos = pos.filter((p) => p.status === 'sent' || p.status === 'partial');
  const openPay = payments.filter((p) => p.status === 'open');

  // An order that arrives and closes the same day never touches "open orders",
  // so without this the dashboard is silent about the busiest thing that happened.
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const monthPos = pos.filter((p) => p.sent_at && new Date(p.sent_at) >= monthStart);
  const monthSpend = sumMoney(monthPos, (p) => p.total);
  const recentDels = dels.slice(0, 6);

  return (
    <div>
      <div className="page-head">
        <div className="h1">Dashboard — {HALL_NAMES[hall]}</div>
        <div className="grow" />
        <span className="dimmer" style={{ fontSize: 12.5 }}>{products.length} products · 4 vendors</span>
        <span className="dim" style={{ fontSize: 12.5 }}>
          Last EOM: <b>{lastEom ? new Date(lastEom).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'never'}</b>
        </span>
        {can('boxes') && <button className="btn ghost sm" onClick={markEom} title="Record that the end-of-month inventory check for this hall is done">✓ Mark EOM done</button>}
      </div>
      <div className="stat-grid">
        <div className="card pad stat"><label>Live inventory value</label><div className="v">{fmtMoney(liveVal)}</div><div className="s">{live.length} boxes on the floor</div></div>
        <div className="card pad stat"><label>Boxes on the floor</label><div className="v">{floor.filter((b) => b.state === 'in_inventory').length}</div><div className="s">{floor.filter((b) => b.state === 'opened').length} opened on floor{offCount > 0 ? ` · ${offCount} off-site` : ''}</div></div>
        <div className="card pad stat"><label>Open orders</label><div className="v">{openPos.length}</div><div className="s">{inTransit} boxes in transit</div></div>
        <div className="card pad stat"><label>Ordered this month</label><div className="v">{fmtMoney(monthSpend)}</div><div className="s">{monthPos.length} order{monthPos.length === 1 ? '' : 's'} · {dels.length} arrival{dels.length === 1 ? '' : 's'} logged</div></div>
        <div className="card pad stat"><label>Open payments</label><div className="v">{fmtMoney(sumMoney(openPay, (p) => p.amount))}</div><div className="s">{openPay.length} invoices awaiting payment</div></div>
      </div>
      <div className="two-col">
        <div className="card">
          <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--border)' }}>Open purchase orders</div>
          {openPos.length === 0 && <div style={{ padding: 26, textAlign: 'center' }} className="dimmer">No open orders. <a href="#" onClick={(e) => { e.preventDefault(); setScreen('purchase'); }}>Start one →</a></div>}
          <table className="tbl">
            <tbody>
              {openPos.map((p) => (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setScreen('orders')}>
                  <td className="first mono">{p.num}</td>
                  <td><span className={'badge ' + (p.status === 'sent' ? 'b-gold' : 'b-orange')}>{p.status === 'sent' ? 'awaiting delivery' : 'partially received'}</span></td>
                  <td className="r mono last">{fmtMoney(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--border)' }}>Recently received</div>
          {recentDels.length === 0 && <div style={{ padding: 26, textAlign: 'center' }} className="dimmer">Nothing received yet.</div>}
          <table className="tbl"><tbody>
            {recentDels.map((d) => (
              <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => setScreen('receiving')}>
                <td className="first mono">{new Date(d.received_at + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}</td>
                <td className="mono" style={{ fontSize: 12 }}>{d.po_ref || d.invoice_no || '—'}</td>
                <td className="r mono last">{d.boxes || 0} boxes</td>
              </tr>
            ))}
          </tbody></table>
        </div>
        <div className="card">
          <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--border)' }}>Recent activity</div>
          {events.length === 0 && <div style={{ padding: 26, textAlign: 'center' }} className="dimmer">Nothing yet.</div>}
          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            {events.map((e, i) => (
              <div key={i} style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-lt)', fontSize: 12.5 }}>
                <span className="dimmer mono" style={{ fontSize: 11 }}>{new Date(e.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>{' '}
                <span className={'badge ' + (e.kind === 'eom' ? 'b-green' : e.kind === 'adjust' ? 'b-orange' : 'b-teal')} style={{ margin: '0 6px' }}>
                  {e.kind === 'eom' ? 'EOM' : e.kind}
                </span>
                {e.detail?.label
                  ? <b style={{ color: e.kind === 'adjust' ? 'var(--orange)' : 'var(--green)' }}>{e.detail.label}</b>
                  : <span className="dim">{e.entity} {String(e.entity_id).slice(0, 14)}</span>}
                {e.detail?.note && <div className="dim" style={{ fontSize: 11.5, marginTop: 2, paddingLeft: 2 }}>“{e.detail.note}”</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
