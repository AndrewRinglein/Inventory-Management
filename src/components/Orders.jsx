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
  const { hall, pos, allPos, boxes, vendors, store, reloadHall, setToast, setScreen, setReceivingPo, requirePin, can } = useContext(AppCtx);
  const [sel, setSel] = useState(null);
  const [lines, setLines] = useState([]);
  const [emails, setEmails] = useState([]);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('active');   // active | archived

  const vmap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);
  const archived = (allPos || []).filter((p) => p.archived_at);
  const shown = view === 'archived' ? archived : pos;
  const sorted = [...shown].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
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

  // an order that was entered by mistake. Anything already received blocks it —
  // the store refuses too, this is just so the button explains itself first.
  const receivedOnCur = boxes.filter((b) => b.po_id === cur?.id && b.state !== 'on_order').length;

  const toggleArchive = async () => {
    if (busy || !cur) return;
    setBusy(true);
    try {
      const nowArchived = !cur.archived_at;
      await store.setPoArchived(cur.id, nowArchived);
      await reloadHall();
      setSel(null);
      setToast(nowArchived
        ? `${cur.num} archived — find it under Archived`
        : `${cur.num} restored to the active list`);
    } catch (e) {
      setToast(e.message || 'Could not archive that order');
    } finally { setBusy(false); }
  };

  const doDelete = async () => {
    if (busy) return;
    if (!(await requirePin())) return;
    setBusy(true);
    try {
      await store.deletePo(cur.id);
      await reloadHall();
      setSel(null); setConfirmDel(false);
      setToast(`PO ${cur.num} deleted`);
    } catch (e) {
      setToast(e.message || 'Could not delete that order', null, 8000);
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="page-head">
        <div className="h1">Open Orders — {hall === 'sc' ? 'Santa Clara' : 'Redwood City'}</div>
        <div className="hall-switch" style={{ margin: 0 }}>
          <button className={view === 'active' ? 'on' : ''} onClick={() => { setView('active'); setSel(null); }}>
            Active ({pos.length})
          </button>
          <button className={view === 'archived' ? 'on' : ''} onClick={() => { setView('archived'); setSel(null); }}>
            Archived ({archived.length})
          </button>
        </div>
        <div className="grow" />
        <span className="dimmer" style={{ fontSize: 12 }}>
          {view === 'archived'
            ? 'Archived orders are hidden everywhere else — nothing about them was deleted.'
            : 'Click an order to see its lines, receive it, archive it or delete it.'}
        </span>
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
          {sorted.length === 0 && (
            <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">
              {view === 'archived' ? 'Nothing archived yet.' : 'No purchase orders yet.'}
            </div>
          )}
        </div>
        {cur && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <b className="mono">{cur.num}</b>
              <span className={'badge ' + STATUS[cur.status][0]}>{STATUS[cur.status][1]}</span>
              {cur.archived_at && (
                <span className="badge b-gray" title={`Archived ${new Date(cur.archived_at).toLocaleDateString()}`}>archived</span>
              )}
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
              {can('order') && (
                <button className="btn ghost sm" onClick={toggleArchive} disabled={busy}
                  title={cur.archived_at
                    ? 'Put this order back in the active list'
                    : 'File it away — it keeps everything, but leaves the working views'}>
                  {cur.archived_at ? '↩ Restore' : '🗄 Archive'}
                </button>
              )}
              {can('order') && (
                <button className="btn ghost sm" onClick={() => setConfirmDel(true)}
                  title={receivedOnCur ? 'Some of this order is already on the shelf — close it short instead' : 'Delete this order entirely'}
                  style={{ color: receivedOnCur ? 'var(--ink-3)' : '#a33b2e' }}>Delete</button>
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

      {confirmDel && cur && (
        <div className="modal-bg" onClick={() => setConfirmDel(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 460 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Delete PO {cur.num}?</div>
            {receivedOnCur > 0 ? (
              <>
                <p style={{ fontSize: 13 }}>
                  {receivedOnCur} box{receivedOnCur === 1 ? '' : 'es'} from this order {receivedOnCur === 1 ? 'is' : 'are'} already
                  in inventory. Deleting the order would take {receivedOnCur === 1 ? 'it' : 'them'} off the shelf and unpick the
                  invoice {receivedOnCur === 1 ? 'it was' : 'they were'} received against.
                </p>
                <p className="dim" style={{ fontSize: 12.5 }}>
                  Use <b>Close short</b> instead — it keeps what arrived and marks the rest missing.
                </p>
                <div style={{ display: 'flex', marginTop: 14 }}>
                  <div style={{ flex: 1 }} />
                  <button className="btn ghost" onClick={() => setConfirmDel(false)}>Close</button>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: 13 }}>
                  This removes the order, its {lines.length} line{lines.length === 1 ? '' : 's'}, and the{' '}
                  {boxes.filter((b) => b.po_id === cur.id).length} box{boxes.filter((b) => b.po_id === cur.id).length === 1 ? '' : 'es'} it
                  put on order. Nothing has been received, so no stock is affected.
                </p>
                <p className="dim" style={{ fontSize: 12.5 }}>
                  {emails.length > 0
                    ? `Heads up — ${emails.length} email${emails.length === 1 ? ' has' : 's have'} already gone out on this PO. The distributor still has it, so tell them it's cancelled.`
                    : 'No emails went out on this one.'}
                  {' '}The number {cur.num} won't be reused, and the deletion is recorded in Recent Activity.
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button className="btn" style={{ background: '#a33b2e', color: '#fff' }} disabled={busy} onClick={doDelete}>
                    {busy ? 'Deleting…' : `Delete ${cur.num}`}
                  </button>
                  <div style={{ flex: 1 }} />
                  <button className="btn ghost" onClick={() => setConfirmDel(false)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
