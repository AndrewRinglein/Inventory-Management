import React, { useContext, useMemo } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney, sumMoney } from '../lib/logic/po.js';

export default function Accounting() {
  const { hall, payments, vendors, boxes, pos, store, reloadHall, setToast, can } = useContext(AppCtx);
  const mayPay = can('markPaid');
  const vmap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);
  const rows = [...payments].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const markPaid = async (p) => {
    await store.setPaymentStatus(p.id, 'paid');
    await reloadHall();
    setToast(`Marked paid — ${p.po_num} ${fmtMoney(p.amount)}`,
      async () => { await store.setPaymentStatus(p.id, 'open'); await reloadHall(); });
  };

  const fulfilled = (p) => {
    const po = pos.find((x) => x.num === p.po_num);
    if (!po) return true;
    return !boxes.some((b) => b.po_id === po.id && (b.state === 'on_order' || b.state === 'missing'));
  };

  return (
    <div>
      <div className="page-head">
        <div className="h1">Accounting — {hall === 'sc' ? 'Santa Clara' : 'Redwood City'}</div>
        <div className="grow" />
        <span className="dim" style={{ fontSize: 13 }}>
          Open: <b className="mono">{fmtMoney(sumMoney(rows.filter((p) => p.status === 'open'), (p) => p.amount))}</b>
        </span>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr>
            <th className="first">PO #</th><th>Vendor</th><th>Invoice #</th><th>Created</th>
            <th>Delivery</th><th className="r">Amount to pay</th><th className="last r" style={{ width: 120 }} />
          </tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="first mono" style={{ fontSize: 12 }}>{p.po_num}</td>
                <td style={{ fontSize: 12.5 }}>{vmap[p.vendor_id]?.name}</td>
                <td className="mono dim" style={{ fontSize: 12 }}>{p.invoice_no || '—'}</td>
                <td className="dimmer" style={{ fontSize: 12 }}>{(p.created_at || '').slice(0, 10)}</td>
                <td>{fulfilled(p)
                  ? <span className="badge b-green">complete</span>
                  : <span className="badge b-orange">short — check</span>}</td>
                <td className="r mono"><b>{fmtMoney(p.amount)}</b></td>
                <td className="last r">
                  {p.status === 'open'
                    ? (mayPay
                      ? <button className="btn green sm" onClick={() => markPaid(p)}>Mark paid</button>
                      : <span className="badge b-gold">open</span>)
                    : <span className="badge b-green">paid</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">No payments recorded yet — they appear when a shipment is confirmed.</div>}
      </div>
    </div>
  );
}
