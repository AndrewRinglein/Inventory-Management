import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney, poFromRecord, repriceFromCatalog } from '../lib/logic/po.js';
import { buildOrderEmails, senderFor, PO_TEXT_DEFAULTS } from '../lib/logic/emails.js';
import { addressResolver } from '../lib/logic/halls.js';

const HALL_NAMES = { sc: 'Santa Clara', rwc: 'Redwood City' };

const STATUS = {
  draft: ['b-gray', 'Draft'],
  sent: ['b-gold', 'Sent — awaiting delivery'],
  partial: ['b-orange', 'Partially received'],
  closed: ['b-gray', 'Closed'],
};

// A recorded order is awaiting delivery just like a sent one — but "Sent" would
// claim this system emailed the distributor, and it didn't.
const statusOf = (p) => (p.recorded_only && p.status === 'sent'
  ? ['b-gold', 'Placed — awaiting delivery']
  : STATUS[p.status]);

export default function Orders() {
  const { hall, pos, allPos, boxes, vendors, products, settings, store, reloadHall, setToast, setScreen, setReceivingPo, requirePin, can } = useContext(AppCtx);
  const [sel, setSel] = useState(null);
  const [lines, setLines] = useState([]);
  const [emails, setEmails] = useState([]);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('active');   // active | archived
  const [resend, setResend] = useState(null);  // { text:{}, reprice:bool, tab:'phone'|'text'|'edit' }

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
  const itemLines = lines.filter((l) => l.kind !== 'fee');
  const orderedBoxes = itemLines.reduce((a, l) => a + l.qty, 0);
  const tbdLines = itemLines.filter((l) => l.price_tbd).length;
  const tbdBoxes = itemLines.filter((l) => l.price_tbd).reduce((a, l) => a + l.qty, 0);

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

  // ---- resend an email for a PO that already exists ----
  //
  // Rebuilt from the stored lines, not from the order builder, so what goes out is
  // what this PO actually says. "Update prices first" is the other half of the note
  // we send with unpriced lines: the vendor replies with their price, it goes into
  // the catalog, and the same PO number goes back out with the figures filled in.
  const vendorOf = (p) => vmap[p?.vendor_id] || {};
  const repriced = useMemo(() => {
    if (!resend || !cur || !lines.length) return null;
    return repriceFromCatalog(cur, lines, products, vendorOf(cur));
  }, [resend, cur, lines, products, vendors]);   // eslint-disable-line

  const resendEmail = useMemo(() => {
    if (!resend || !cur || !lines.length) return null;
    const useLines = resend.reprice && repriced ? repriced.lines : lines;
    const head = resend.reprice && repriced ? { ...cur, ...repriced.totals } : cur;
    const rec = poFromRecord(head, useLines, products);
    return buildOrderEmails([rec], vendors, HALL_NAMES[hall],
      addressResolver(settings.halls_config, hall),
      null, senderFor(settings.sender, hall),
      { ...(settings.po_email || {}), ...resend.text })[0];
  }, [resend, cur, lines, products, vendors, settings, hall, repriced]);   // eslint-disable-line

  const doResend = async () => {
    if (busy || !resendEmail) return;
    setBusy(true);
    try {
      if (resend.reprice && repriced?.changes.length) {
        await store.repricePo(cur.id, repriced.lines, repriced.totals);
      }
      await store.sendEmails([{ ...resendEmail, po_num: cur.num, kind: 'po' }], hall);
      await reloadHall();
      const fresh = await store.getPoLines(cur.id);
      setLines(fresh);
      setResend(null);
      setToast(`${cur.num} sent again to ${vendorOf(cur).name}`, null, 6000);
      setEmails(await store.getEmails(hall).then((all) => all.filter((e) => e.po_num === cur.num)));
    } catch (e) {
      setToast(e.message || 'Could not send that email', null, 8000);
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
                  <td><span className={'badge ' + statusOf(p)[0]} style={{ fontSize: 10 }}>{statusOf(p)[1]}</span></td>
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
              <span className={'badge ' + statusOf(cur)[0]}>{statusOf(cur)[1]}</span>
              {cur.archived_at && (
                <span className="badge b-gray" title={`Archived ${new Date(cur.archived_at).toLocaleDateString()}`}>archived</span>
              )}
              {cur.recorded_only && (
                <span className="badge b-gray" title="Entered for the record — this system did not email the distributor">
                  recorded — not sent
                </span>
              )}
              <span className="dimmer" style={{ fontSize: 12 }}>
                {vmap[cur.vendor_id]?.name} · {cur.recorded_only ? 'placed' : 'sent'} {cur.sent_at ? new Date(cur.sent_at).toLocaleDateString() : '—'}
                {cur.vendor_ref && <> · their ref <span className="mono">{cur.vendor_ref}</span></>}
                {' · '}{itemLines.length} item{itemLines.length === 1 ? '' : 's'}, {orderedBoxes} box{orderedBoxes === 1 ? '' : 'es'}
                {tbdLines > 0 && <span style={{ color: 'var(--gold)' }}> · {tbdLines} awaiting price</span>}
              </span>
              <div style={{ flex: 1 }} />
              {can('receive') && (cur.status === 'sent' || cur.status === 'partial') && (
                <button className="btn primary sm" onClick={() => { setReceivingPo(cur.id); setScreen('intake'); }}>Receive delivery →</button>
              )}
              {can('receive') && cur.status === 'partial' && (
                <button className="btn ghost sm" onClick={closeShort}>Close short</button>
              )}
              {can('send') && (
                <button className="btn ghost sm" disabled={busy || !lines.length}
                  onClick={() => setResend({ text: {}, reprice: false, tab: 'phone' })}
                  title="Send this PO to the distributor again — same number, same lines">
                  ✉ Resend
                </button>
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
              <thead><tr>
                <th className="first">Item</th><th className="r">Units</th>
                <th className="r">Per unit</th><th className="r">Line total</th><th className="last">Received</th>
              </tr></thead>
              <tbody>
                {lines.map((l) => {
                  const got = Math.min(recvCount[l.product_id] || 0, l.qty);
                  const full = got >= l.qty;
                  const fee = l.kind === 'fee';
                  return (
                    <tr key={l.id}>
                      <td className="first">
                        {l.name_snapshot}
                        {l.price_tbd && <span className="badge b-gold" style={{ marginLeft: 6 }}
                          title="Went out with a ? — the distributor sends their price and we reissue">awaiting price</span>}
                      </td>
                      <td className="r mono">{l.qty}</td>
                      <td className="r mono">{l.price_tbd ? <span className="tbd" style={{ cursor: 'default' }}>?</span> : fmtMoney(l.cost)}</td>
                      <td className="r mono">{l.price_tbd ? <span className="tbd" style={{ cursor: 'default' }}>?</span> : fmtMoney(l.qty * l.cost)}</td>
                      <td className="last">
                        {fee
                          ? <span className="dimmer" style={{ fontSize: 11 }}>charge, not stock</span>
                          : <span className={'badge ' + (cur.status === 'sent' ? 'b-gold' : full ? 'b-green' : 'b-orange')}>
                              {cur.status === 'sent' ? 'in transit' : full ? 'received' : `${got} of ${l.qty}`}
                            </span>}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="first dim">Subtotal {fmtMoney(cur.subtotal)} · Tax {fmtMoney(cur.tax)}</td>
                  <td colSpan={3} className="r mono"><b>{fmtMoney(cur.total)}</b></td><td className="last" />
                </tr>
                {tbdLines > 0 && (
                  <tr><td className="first" colSpan={5} style={{ fontSize: 11.5, color: 'var(--gold)' }}>
                    {tbdLines} line{tbdLines === 1 ? '' : 's'} ({tbdBoxes} box{tbdBoxes === 1 ? '' : 'es'}) went out without a price.
                    That total is what we know, not the final bill — the rest comes back on their invoice.
                  </td></tr>
                )}
              </tbody>
            </table>
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--ink-3)', marginBottom: 6 }}>Emails on this PO</div>
              {emails.length === 0 && (
                <span className="dimmer" style={{ fontSize: 12.5 }}>
                  {cur.recorded_only
                    ? 'None — this order was recorded for the books, not sent from here. The distributor was contacted some other way.'
                    : 'None logged.'}
                </span>
              )}
              {emails.map((e) => (
                <div key={e.id} style={{ fontSize: 12.5, padding: '3px 0' }}>
                  <span className="mono dimmer">{(e.created_at || '').slice(5, 10)}</span> · {e.subject}
                  {e.test_mode && <span className="badge b-gold" style={{ marginLeft: 6, fontSize: 10 }}>test</span>}
                  {e.status && e.status !== 'sent' && (
                    <span className="badge" style={{ marginLeft: 6, fontSize: 10, background: '#f6dcd6', color: '#a33b2e' }}
                      title="This one did not reach the distributor — check the address and resend">
                      {e.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {resend && cur && resendEmail && (
        <div className="modal-bg" onClick={() => !busy && setResend(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 760, maxWidth: '94vw' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Resend {cur.num}</div>
              <span className="dimmer" style={{ fontSize: 12 }}>to {vendorOf(cur).name} · {resendEmail.to}</span>
              <div style={{ flex: 1 }} />
              <div className="hall-switch" style={{ margin: 0 }}>
                {[
                  ['edit', '✎ Edit wording', 'Change what this email says'],
                  ['phone', 'Phone view', 'How it will look on a phone'],
                  ['text', 'Plain-text view', 'The fallback for clients that show no formatting'],
                ].map(([t, label, tip]) => (
                  <button key={t} className={resend.tab === t ? 'on' : ''} title={tip}
                    onClick={() => setResend({ ...resend, tab: t })}>{label}</button>
                ))}
              </div>
            </div>
            <p className="dimmer" style={{ fontSize: 12, margin: '0 0 10px' }}>
              Same PO number, rebuilt from this order's own lines — nothing new is created and no stock moves.
              Nothing sends until you press the button at the bottom; <b>✎ Edit wording</b> is where you change what it says.
            </p>

            {tbdLines > 0 && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fdf8ee',
                border: '1px solid #e2c39a', borderRadius: 6, padding: '10px 12px', fontSize: 12.5, marginBottom: 10 }}>
                <input type="checkbox" checked={resend.reprice} style={{ marginTop: 2 }}
                  onChange={(e) => setResend({ ...resend, reprice: e.target.checked })} />
                <span>
                  <b>Update prices from the catalog first.</b>{' '}
                  {repriced?.changes.length
                    ? `${repriced.changes.length} line${repriced.changes.length === 1 ? '' : 's'} would change` +
                      (resend.reprice ? ` — new total ${fmtMoney(repriced.totals.total)}, was ${fmtMoney(cur.total)}.` : '.')
                    : 'Nothing has changed in the catalog since this went out.'}
                  <div className="dimmer" style={{ marginTop: 3 }}>
                    For when the distributor has sent the prices we were missing: enter them in Games, then resend
                    the same PO with the figures filled in. This rewrites the order and its on-order boxes.
                  </div>
                </span>
              </label>
            )}

            {resend.reprice && repriced?.changes.length > 0 && (
              <div style={{ maxHeight: 120, overflow: 'auto', border: '1px solid var(--border-lt)', borderRadius: 6, marginBottom: 10 }}>
                <table className="tbl"><tbody>
                  {repriced.changes.map((c, i) => (
                    <tr key={i}>
                      <td className="first" style={{ fontSize: 12 }}>{c.name}</td>
                      <td className="r mono dimmer" style={{ fontSize: 12 }}>{c.wasTbd ? '?' : fmtMoney(c.from)}</td>
                      <td className="r mono last" style={{ fontSize: 12 }}>→ {c.nowTbd ? '?' : fmtMoney(c.to)}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            )}

            {resend.tab === 'edit' ? (
              <div>
                {[
                  ['subject', 'Subject line', 1, `${'{hall}'} order — PO ${'{po}'}`],
                  ['intro', 'Opening line', 2, PO_TEXT_DEFAULTS.intro],
                  ['note', 'Extra paragraph', 3, 'e.g. Resending with the prices you sent over — everything else is unchanged.'],
                  ['closing', 'Closing line', 2, PO_TEXT_DEFAULTS.closing],
                ].map(([k, label, rows, ph]) => (
                  <div className="field" key={k}>
                    <label>{label}</label>
                    {rows === 1
                      ? <input type="text" value={resend.text[k] ?? ''} placeholder={ph} style={{ width: '100%' }}
                          onChange={(e) => setResend({ ...resend, text: { ...resend.text, [k]: e.target.value } })} />
                      : <textarea value={resend.text[k] ?? ''} placeholder={ph} rows={rows} style={{ width: '100%', resize: 'vertical' }}
                          onChange={(e) => setResend({ ...resend, text: { ...resend.text, [k]: e.target.value } })} />}
                  </div>
                ))}
              </div>
            ) : resend.tab === 'phone' ? (
              <div style={{ background: '#e9ebed', padding: 12, display: 'flex', justifyContent: 'center', borderRadius: 6 }}>
                <iframe title="Phone preview" srcDoc={resendEmail.html}
                  style={{ width: 390, height: 420, border: '1px solid var(--border)', borderRadius: 10, background: '#fff' }} />
              </div>
            ) : (
              <textarea readOnly value={resendEmail.body}
                style={{ width: '100%', height: 340, fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5,
                  padding: 12, background: '#fbfbfc', border: '1px solid var(--border-lt)', borderRadius: 6, resize: 'vertical' }} />
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
              <button className="btn primary" disabled={busy} onClick={doResend}>
                {busy ? 'Sending…' : (resend.reprice && repriced?.changes.length ? 'Update prices and send' : 'Send again')}
              </button>
              <span className="dimmer" style={{ fontSize: 11.5 }}>
                {emails.length} email{emails.length === 1 ? '' : 's'} already logged on this PO
              </span>
              <div style={{ flex: 1 }} />
              <button className="btn ghost" disabled={busy} onClick={() => setResend(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

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
