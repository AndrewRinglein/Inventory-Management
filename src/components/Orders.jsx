import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney } from '../lib/logic/po.js';

const STATUS = {
  draft: ['b-gray', 'Draft'],
  sent: ['b-gold', 'Sent — awaiting delivery'],
  partial: ['b-orange', 'Partially received'],
  closed: ['b-gray', 'Closed'],
};

export default function Orders() {
  const { hall, pos, boxes, vendors, store, reloadHall, setToast, setScreen, setReceivingPo, can } = useContext(AppCtx);
  const [sel, setSel] = useState(null);
  const [lines, setLines] = useState([]);
  const [emails, setEmails] = useState([]);

  const vmap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);
  const sorted = [...pos].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const cur = sorted.find((p) => p.id === sel) || sorted[0];

  useEffect(() => {
    if (!cur) { setLines([]); return; }
    store.getPoLines(cur.id).then(setLines);
    store.getEmails(hall).then((all) => setEmails(all.filter((e) => e.po_num === cur.num)));
  }, [cur?.id, pos]);   // eslint-disable-line

  const recvCount = useMemo(() => {
    const m = {};
    for (const b of boxes) {
      if (b.po_id === cur?.id && b.state !== 'on_order' && b.state !== 'missing') {
        m[b.product_id] = (m[b.product_id] || 0) + 1;
      }
    }
    return m;
  }, [boxes, cur]);

  const closeShort = async () => {
    const stragglers = boxes.filter((b) => b.po_id === cur.id && b.state === 'on_order');
    for (const b of stragglers) await store.transitionBox(b.id, 'missing');
    await store.setPoStatus(cur.id, 'closed');
    await reloadHall();
    setToast(`Order closed short — ${stragglers.length} undelivered box(es) marked missing`);
  };

  return (
    <div>
      <div className="page-head">
        <div className="h1">Open Orders — {hall === 'sc' ? 'Santa Clara' : 'Redwood City'}</div>
      </div>
      <div className="two-col" style={{ gridTemplateColumns: '420px 1fr' }}>
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="tbl">
            <thead><tr><th className="first">PO #</th><th>Vendor</th><th>Status</th><th className="r last">Total</th></tr></thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id} onClick={() => setSel(p.id)}
                  style={{ cursor: 'pointer', background: cur?.id === p.id ? '#eef3f5' : 'transparent' }}>
                  <td className="first mono" style={{ fontSize: 12 }}>{p.num}</td>
                  <td style={{ fontSize: 12 }}>{vmap[p.vendor_id]?.name}</td>
                  <td><span className={'badge ' + STATUS[p.status][0]} style={{ fontSize: 10 }}>{STATUS[p.status][1]}</span></td>
                  <td className="r mono last">{fmtMoney(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length === 0 && <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">No purchase orders yet.</div>}
        </div>
        {cur && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <b className="mono">{cur.num}</b>
              <span className={'badge ' + STATUS[cur.status][0]}>{STATUS[cur.status][1]}</span>
              <span className="dimmer" style={{ fontSize: 12 }}>
                {vmap[cur.vendor_id]?.name} · sent {cur.sent_at ? new Date(cur.sent_at).toLocaleDateString() : '—'} · {lines.length} lines
              </span>
              <div style={{ flex: 1 }} />
              {can('receive') && (cur.status === 'sent' || cur.status === 'partial') && (
                <button className="btn primary sm" onClick={() => { setReceivingPo(cur.id); setScreen('intake'); }}>Receive delivery →</button>
              )}
              {can('receive') && cur.status === 'partial' && (
                <button className="btn ghost sm" onClick={closeShort}>Close short</button>
              )}
            </div>
            <table className="tbl">
              <thead><tr><th className="first">Item</th><th className="r">Qty</th><th className="r">Line total</th><th className="last">Received</th></tr></thead>
              <tbody>
                {lines.map((l) => {
                  const got = Math.min(recvCount[l.product_id] || 0, l.qty);
                  const full = got >= l.qty;
                  return (
                    <tr key={l.id}>
                      <td className="first">{l.name_snapshot}</td>
                      <td className="r mono">{l.qty}</td>
                      <td className="r mono">{fmtMoney(l.qty * l.cost)}</td>
                      <td className="last">
                        <span className={'badge ' + (cur.status === 'sent' ? 'b-gold' : full ? 'b-green' : 'b-orange')}>
                          {cur.status === 'sent' ? 'in transit' : full ? 'received' : `${got} of ${l.qty}`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="first dim">Subtotal {fmtMoney(cur.subtotal)} · Tax {fmtMoney(cur.tax)}</td>
                  <td colSpan={2} className="r mono"><b>{fmtMoney(cur.total)}</b></td><td className="last" />
                </tr>
              </tbody>
            </table>
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--ink-3)', marginBottom: 6 }}>Emails on this PO</div>
              {emails.length === 0 && <span className="dimmer" style={{ fontSize: 12.5 }}>None logged.</span>}
              {emails.map((e) => (
                <div key={e.id} style={{ fontSize: 12.5, padding: '3px 0' }}>
                  <span className="mono dimmer">{(e.created_at || '').slice(5, 10)}</span> · {e.subject}
                  {e.test_mode && <span className="badge b-gold" style={{ marginLeft: 6, fontSize: 10 }}>test</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
