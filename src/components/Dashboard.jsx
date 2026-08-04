import React, { useContext, useEffect, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney } from '../lib/logic/po.js';

const HALL_NAMES = { sc: 'Santa Clara', rwc: 'Redwood City' };

export default function Dashboard() {
  const { hall, boxes, pos, payments, products, setScreen, store } = useContext(AppCtx);
  const [events, setEvents] = useState([]);
  useEffect(() => { store.getEvents(12).then(setEvents); }, [boxes, pos]);   // eslint-disable-line

  const live = boxes.filter((b) => b.state === 'in_inventory' || b.state === 'opened');
  const liveVal = live.reduce((a, b) => a + (b.cost || 0), 0);
  const inTransit = boxes.filter((b) => b.state === 'on_order').length;
  const openPos = pos.filter((p) => p.status === 'sent' || p.status === 'partial');
  const openPay = payments.filter((p) => p.status === 'open');

  return (
    <div>
      <div className="page-head">
        <div className="h1">Dashboard — {HALL_NAMES[hall]}</div>
        <div className="grow" />
        <span className="dimmer" style={{ fontSize: 12.5 }}>{products.length} products · 4 vendors</span>
      </div>
      <div className="stat-grid">
        <div className="card pad stat"><label>Live inventory value</label><div className="v">{fmtMoney(liveVal)}</div><div className="s">{live.length} boxes owned</div></div>
        <div className="card pad stat"><label>Boxes in stock</label><div className="v">{boxes.filter((b) => b.state === 'in_inventory').length}</div><div className="s">{boxes.filter((b) => b.state === 'opened').length} opened on floor</div></div>
        <div className="card pad stat"><label>Open orders</label><div className="v">{openPos.length}</div><div className="s">{inTransit} boxes in transit</div></div>
        <div className="card pad stat"><label>Open payments</label><div className="v">{fmtMoney(openPay.reduce((a, p) => a + p.amount, 0))}</div><div className="s">{openPay.length} invoices awaiting payment</div></div>
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
          <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--border)' }}>Recent activity</div>
          {events.length === 0 && <div style={{ padding: 26, textAlign: 'center' }} className="dimmer">Nothing yet.</div>}
          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            {events.map((e, i) => (
              <div key={i} style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-lt)', fontSize: 12.5 }}>
                <span className="dimmer mono" style={{ fontSize: 11 }}>{new Date(e.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>{' '}
                <span className="badge b-teal" style={{ margin: '0 6px' }}>{e.kind}</span>
                <span className="dim">{e.entity} {String(e.entity_id).slice(0, 14)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
