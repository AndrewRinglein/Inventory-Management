import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney, sumMoney } from '../lib/logic/po.js';
import { settlementForPayment, monthlyByVendor, monthsPresent, monthLabel, monthOf }
  from '../lib/logic/settlement.js';
import { buildSettlementEmail, senderFor } from '../lib/logic/emails.js';
import { round2 } from '../lib/logic/pricing.js';

const HALL_NAMES = { sc: 'Santa Clara', rwc: 'Redwood City' };

/**
 * What a delivered order is actually worth, once you count what turned up.
 *
 * Defined at module scope, not inside Accounting: a component declared inside
 * another is a new type on every render, so React throws its subtree away and
 * rebuilds it each time — which in this codebase has previously meant inputs
 * losing focus mid-keystroke.
 */
function Detail({ st }) {
  const Money = ({ v, bold, tone }) => (
    <span className="mono" style={{ fontWeight: bold ? 700 : 400, color: tone || 'inherit' }}>
      {fmtMoney(v)}
    </span>
  );
  const owed = st.arrived.total;
  const short = st.missing.total;
  return (
    <div style={{ padding: '10px 14px 14px' }}>
      <table className="tbl" style={{ marginBottom: 10 }}>
        <thead><tr>
          <th className="first">Item</th>
          <th className="r" style={{ width: 78 }} title="Boxes the order asked for">Ordered</th>
          <th className="r" style={{ width: 78 }} title="Boxes that physically arrived">Arrived</th>
          <th className="r" style={{ width: 78 }} title="Ordered but never turned up">Missing</th>
          <th className="r" style={{ width: 96 }}>Per box</th>
          <th className="r" style={{ width: 110 }}>Owed</th>
          <th className="r last" style={{ width: 110 }}>Not owed</th>
        </tr></thead>
        <tbody>
          {st.lines.map((l) => (
            <tr key={l.id} className={l.missingBoxes > 0 ? 'hl' : ''}>
              <td className="first">
                <span style={{ whiteSpace: 'pre-line' }}>{l.name}</span>
                {l.tbd && <span className="badge b-gold" style={{ marginLeft: 6 }}
                  title="No price on this line, so it is not in any total below">awaiting price</span>}
                {l.isCharge && <span className="dimmer" style={{ fontSize: 11 }}> · charge</span>}
              </td>
              <td className="r mono">{l.isCharge ? '—' : l.orderedBoxes}</td>
              <td className="r mono">{l.isCharge ? '—' : l.arrivedBoxes}</td>
              <td className="r mono" style={{ color: l.missingBoxes ? 'var(--orange)' : 'inherit' }}>
                {l.isCharge ? '—' : (l.missingBoxes || '')}
              </td>
              <td className="r mono dimmer">{l.tbd ? '?' : fmtMoney(l.perBox)}</td>
              <td className="r mono">{l.tbd ? <span className="tbd" style={{ cursor: 'default' }}>?</span> : fmtMoney(l.arrivedValue + l.arrivedPacking)}</td>
              <td className="r mono last" style={{ color: l.missingValue ? 'var(--orange)' : 'var(--ink-3)' }}>
                {l.tbd ? '—' : (l.missingValue || l.missingPacking ? fmtMoney(l.missingValue + l.missingPacking) : '—')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', fontSize: 12.5, alignItems: 'flex-start' }}>
        <div>
          <div className="dimmer" style={{ fontSize: 11, marginBottom: 2 }}>Ordered</div>
          <Money v={st.ordered.total} />
          <div className="dimmer" style={{ fontSize: 11 }}>
            {fmtMoney(st.ordered.goods)} goods
            {st.ordered.packing > 0 && <> + {fmtMoney(st.ordered.packing)} packing</>}
            {st.ordered.tax > 0 && <> + {fmtMoney(st.ordered.tax)} tax</>}
          </div>
        </div>
        <div>
          <div className="dimmer" style={{ fontSize: 11, marginBottom: 2 }}>Should be paid</div>
          <Money v={owed} bold />
          <div className="dimmer" style={{ fontSize: 11 }}>
            {fmtMoney(st.arrived.goods)} goods
            {st.arrived.packing > 0 && <> + {fmtMoney(st.arrived.packing)} packing</>}
            {st.arrived.tax > 0 && <> + {fmtMoney(st.arrived.tax)} tax</>}
          </div>
        </div>
        <div>
          <div className="dimmer" style={{ fontSize: 11, marginBottom: 2 }}>Never arrived</div>
          <Money v={short} bold tone={short > 0 ? 'var(--orange)' : undefined} />
          <div className="dimmer" style={{ fontSize: 11 }}>
            {st.shortLines === 0 ? 'everything turned up'
              : `${st.shortLines} line${st.shortLines === 1 ? '' : 's'} short`}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: 'right' }}>
          <div className="dimmer" style={{ fontSize: 11, marginBottom: 2 }}>Invoiced</div>
          <Money v={st.invoiced} />
          {st.overbilled != null && Math.abs(st.overbilled) >= 0.01 && (
            <div style={{ fontSize: 11.5, marginTop: 3,
                          color: st.overbilled > 0 ? 'var(--orange)' : 'var(--green)' }}>
              {st.overbilled > 0
                ? <>billed <b>{fmtMoney(st.overbilled)}</b> more than arrived</>
                : <>billed <b>{fmtMoney(-st.overbilled)}</b> less than arrived</>}
            </div>
          )}
          {st.overbilled != null && Math.abs(st.overbilled) < 0.01 && (
            <div className="dimmer" style={{ fontSize: 11.5, marginTop: 3 }}>matches what arrived</div>
          )}
        </div>
      </div>

      {st.tbdLines > 0 && (
        <div className="dimmer" style={{ fontSize: 11.5, marginTop: 10 }}>
          {st.tbdLines} line{st.tbdLines === 1 ? '' : 's'} still {st.tbdLines === 1 ? 'has' : 'have'} no
          price, so {st.tbdLines === 1 ? 'it is' : 'they are'} in none of these totals — the real bill
          will be higher than “should be paid”.
        </div>
      )}
    </div>
  );
}

export default function Accounting() {
  const { hall, payments, vendors, boxes, pos, store, reloadHall, setToast, can, settings } = useContext(AppCtx);
  const mayPay = can('markPaid');
  const vmap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);
  const rows = [...payments].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  // Expanding fetches the order's lines once and keeps them. Boxes are already in
  // context, so what physically arrived needs no round trip.
  const [openId, setOpenId] = useState(null);
  const [lines, setLines] = useState({});          // po id -> lines
  const [busy, setBusy] = useState(false);
  const [notify, setNotify] = useState(null);      // { vendorId, scope, email }

  // Ordered and Short are columns now, not just something you see after expanding,
  // so every payment's order has to be settled up front. One batched request for
  // the whole screen rather than one per row.
  const wanted = useMemo(() => {
    const ids = [];
    for (const p of payments) {
      const po = pos.find((x) => x.num === p.po_num);
      if (po) ids.push(po.id);
    }
    return ids;
  }, [payments, pos]);

  useEffect(() => {
    const need = wanted.filter((id) => !(id in lines));
    if (!need.length) return;
    let alive = true;
    store.getPoLinesFor(need)
      .then((got) => { if (alive) setLines((m) => ({ ...m, ...got })); })
      .catch((e) => setToast(e.message || 'Could not load the order lines'));
    return () => { alive = false; };
  }, [wanted]);   // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (pay) => setOpenId(openId === pay.id ? null : pay.id);


  /** Does this payment have anything worth emailing a distributor about? */
  const hasIssue = (pay) => {
    const st = settlementFor(pay);
    if (!st) return false;
    return st.missing.total > 0.005 || st.extra.total > 0.005
        || (st.overbilled != null && Math.abs(st.overbilled) > 0.005);
  };

  /** Every payment for this distributor that still has something to raise. */
  const issuesFor = (vendorId) => payments.filter((p) => p.vendor_id === vendorId && hasIssue(p));

  /**
   * Build the email and show it before anything is sent.
   *
   * Deliberately a preview with an explicit Send: this goes to a supplier under
   * the hall's name and asks them for money, so it is not something to fire off
   * from a single click on a table row.
   */
  const openNotify = (vendorId, scope, one = null) => {
    const chosen = scope === 'all' ? issuesFor(vendorId) : [one];
    const orders = chosen.map((pay) => ({
      po: pos.find((x) => x.num === pay.po_num),
      settlement: settlementFor(pay),
    })).filter((o) => o.po && o.settlement);
    const vendor = vmap[vendorId];
    const email = buildSettlementEmail(
      vendor, HALL_NAMES[hall], orders, senderFor(settings.sender, hall));
    if (!email) { setToast('Nothing to raise on that order'); return; }
    setNotify({ vendorId, scope, email, count: orders.length });
  };

  const sendNotify = async () => {
    if (!notify || busy) return;
    setBusy(true);
    try {
      await store.sendEmails([notify.email], hall);
      setToast(`Sent to ${vmap[notify.vendorId]?.name || 'the distributor'}`);
      setNotify(null);
    } catch (e) {
      setToast(e.message || 'Could not send that email');
    } finally { setBusy(false); }
  };

  /** The settled picture for one payment, or null when there is nothing to settle. */
  const settlementFor = (pay) =>
    settlementForPayment({ payment: pay, pos, linesByPo: lines, boxes, vendors });

  // Placed AFTER settlementFor, not before: the summary closes over it, and a
  // const read above its own declaration is a ReferenceError that the build
  // cannot see. That is the bug that white-screened the whole app once already.
  //
  // The table above stays whole — a summary that silently hid ten of fourteen
  // rows would be worse than no summary. The month applies to the footer only,
  // and the footer says so.
  const months = useMemo(() => monthsPresent(payments), [payments]);
  const [month, setMonth] = useState('');
  useEffect(() => { if (!month && months.length) setMonth(months[0]); }, [months, month]);
  const summary = useMemo(
    () => monthlyByVendor(payments, settlementFor, month),
    [payments, month, lines, pos, boxes, vendors]);   // eslint-disable-line react-hooks/exhaustive-deps

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
        {[...new Set(payments.map((p) => p.vendor_id))]
          .map((vid) => ({ vid, n: issuesFor(vid).length }))
          .filter((v) => v.n > 1)
          .map(({ vid, n }) => (
            <button key={vid} className="btn ghost sm" onClick={() => openNotify(vid, 'all')}
              title={`One email to ${vmap[vid]?.name} covering all ${n} orders with something outstanding`}>
              ✉ {vmap[vid]?.name} ({n})
            </button>
          ))}
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr>
            <th className="first">PO #</th><th>Vendor</th><th>Invoice #</th><th>Created</th>
            <th>Delivery</th>
            <th className="r" style={{ width: 116 }} title="What the order came to, before checking what arrived">Amount ordered</th>
            <th className="r" style={{ width: 116 }}
                title="Value of what never turned up, less anything extra we kept. Negative means they sent more than we ordered.">Amount short</th>
            <th className="r" style={{ width: 116 }}>Amount to pay</th>
            <th className="last r" style={{ width: 210 }} />
          </tr></thead>
          <tbody>
            {rows.map((p) => (
              <React.Fragment key={p.id}>
              <tr onClick={() => toggle(p)} style={{ cursor: 'pointer' }}
                  title="Click to see what arrived and what is actually owed">
                <td className="first mono" style={{ fontSize: 12 }}>
                  <span className="dimmer" style={{ marginRight: 5 }}>{openId === p.id ? '▾' : '▸'}</span>
                  {p.po_num}
                </td>
                <td style={{ fontSize: 12.5 }}>{vmap[p.vendor_id]?.name}</td>
                <td className="mono dim" style={{ fontSize: 12 }}>{p.invoice_no || '—'}</td>
                <td className="dimmer" style={{ fontSize: 12 }}>{(p.created_at || '').slice(0, 10)}</td>
                <td>{fulfilled(p)
                  ? <span className="badge b-green">complete</span>
                  : <span className="badge b-orange">short — check</span>}</td>
                {(() => {
                  const st = settlementFor(p);
                  if (!st) return (<>
                    <td className="r mono dimmer">—</td>
                    <td className="r mono dimmer">—</td>
                  </>);
                  // one signed number: positive means stock we paid for never came,
                  // negative means they sent extra we are keeping and owe for
                  const short = round2(st.missing.total - st.extra.total);
                  return (<>
                    <td className="r mono dimmer">{fmtMoney(st.ordered.total)}</td>
                    <td className="r mono" style={{
                      color: short > 0.005 ? 'var(--orange)'
                           : short < -0.005 ? 'var(--green)' : 'var(--ink-3)' }}>
                      {Math.abs(short) < 0.005 ? '—'
                        : short > 0 ? fmtMoney(short)
                        : <span title="They delivered more than the order and we kept it">
                            +{fmtMoney(-short)}
                          </span>}
                    </td>
                  </>);
                })()}
                <td className="r mono"><b>{fmtMoney(p.amount)}</b></td>
                <td className="last r" onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                  {p.status === 'open'
                    ? (mayPay
                      ? <button className="btn green sm" onClick={() => markPaid(p)}>Mark paid</button>
                      : <span className="badge b-gold">open</span>)
                    : <span className="badge b-green">paid</span>}
                  {' '}
                  <button className="btn ghost sm" disabled={!hasIssue(p)}
                    title={hasIssue(p)
                      ? 'Email the distributor about what is short or extra on this order'
                      : 'Nothing to raise — what arrived matches what was invoiced'}
                    onClick={() => openNotify(p.vendor_id, 'one', p)}>✉ Notify</button>
                </td>
              </tr>
              {openId === p.id && (
                <tr>
                  <td className="first last" colSpan={9} style={{ background: '#fafbfc', padding: 0 }}>
                    {(() => {
                      const st = settlementFor(p);
                      if (!st) return (
                        <div className="dimmer" style={{ padding: 16, fontSize: 12.5 }}>
                          {loading ? 'Loading the order…'
                            : pos.find((x) => x.num === p.po_num)
                              ? 'Loading the order…'
                              : `No purchase order found for ${p.po_num} — this payment was recorded on its own, so there are no lines to check it against.`}
                        </div>
                      );
                      return <Detail st={st} />;
                    })()}
                  </td>
                </tr>
              )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        {summary.rows.length > 0 && (
        <div className="card" style={{ marginTop: 14, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', gap: 10 }}>
            <b style={{ fontSize: 13 }}>By distributor</b>
            <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ fontSize: 12 }}>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              <option value="">All months</option>
            </select>
            <div style={{ flex: 1 }} />
            <span className="dimmer" style={{ fontSize: 11.5 }}>
              The table above always shows every order — this covers {monthLabel(month).toLowerCase()} only.
            </span>
          </div>
          <table className="tbl">
            <thead><tr>
              <th className="first">Distributor</th>
              <th className="r" style={{ width: 70 }}>Orders</th>
              <th className="r" style={{ width: 130 }}
                  title="Value billed but never delivered, net of anything extra we kept. This is a claim against them, not a reduction of the cheque — the invoice stands until they issue a credit.">Short</th>
              <th className="r" style={{ width: 130 }} title="Open invoices only. Anything already marked paid is not due.">Due to pay</th>
              <th className="r last" style={{ width: 130 }}>Already paid</th>
            </tr></thead>
            <tbody>
              {summary.rows.map((v) => (
                <tr key={v.vendorId}>
                  <td className="first">
                    {vmap[v.vendorId]?.name || v.vendorId}
                    {v.unsettled > 0 && (
                      <span className="dimmer" style={{ fontSize: 11 }}
                        title="These orders' lines haven't loaded, so they add to the money but not to Short">
                        {' '}· {v.unsettled} not checked
                      </span>
                    )}
                    {issuesFor(v.vendorId).length > 1 && (
                      <button className="btn ghost sm" style={{ marginLeft: 8 }}
                        onClick={() => openNotify(v.vendorId, 'all')}
                        title={`One email covering all ${issuesFor(v.vendorId).length} orders with something outstanding`}>
                        ✉ Notify
                      </button>
                    )}
                  </td>
                  <td className="r mono dimmer">{v.orders}</td>
                  <td className="r mono" style={{
                    color: v.net > 0.005 ? 'var(--orange)' : v.net < -0.005 ? 'var(--green)' : 'var(--ink-3)' }}>
                    {Math.abs(v.net) < 0.005 ? '—'
                      : v.net > 0 ? fmtMoney(v.net)
                      : <span title="They delivered more than was ordered and we kept it">+{fmtMoney(-v.net)}</span>}
                  </td>
                  <td className="r mono"><b>{fmtMoney(v.due)}</b></td>
                  <td className="r mono dimmer last">{v.paid ? fmtMoney(v.paid) : '—'}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--border)' }}>
                <td className="first"><b>Total</b></td>
                <td className="r mono dimmer">{summary.total.orders}</td>
                <td className="r mono" style={{
                  color: summary.total.net > 0.005 ? 'var(--orange)'
                       : summary.total.net < -0.005 ? 'var(--green)' : 'var(--ink-3)' }}>
                  <b>{Math.abs(summary.total.net) < 0.005 ? '—'
                    : summary.total.net > 0 ? fmtMoney(summary.total.net)
                    : '+' + fmtMoney(-summary.total.net)}</b>
                </td>
                <td className="r mono"><b>{fmtMoney(summary.total.due)}</b></td>
                <td className="r mono dimmer last">{summary.total.paid ? fmtMoney(summary.total.paid) : '—'}</td>
              </tr>
            </tbody>
          </table>
          {summary.unsettled > 0 && (
            <div className="dimmer" style={{ padding: '8px 14px', fontSize: 11.5 }}>
              {summary.unsettled} order{summary.unsettled === 1 ? '' : 's'} in this month
              {summary.unsettled === 1 ? ' has' : ' have'} no purchase order behind
              {summary.unsettled === 1 ? ' it' : ' them'}, so {summary.unsettled === 1 ? 'it counts' : 'they count'}
              {' '}toward the money but not toward Short.
            </div>
          )}
        </div>
      )}

      {notify && (
        <div className="modal-bg" onClick={() => !busy && setNotify(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 640 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              {notify.scope === 'all'
                ? `Email ${vmap[notify.vendorId]?.name} about ${notify.count} orders`
                : `Email ${vmap[notify.vendorId]?.name}`}
            </div>
            <p className="dimmer" style={{ fontSize: 12.5, margin: '4px 0 10px' }}>
              To <b>{notify.email.to || 'no address on file'}</b> · {notify.email.subject}
            </p>
            <pre style={{ maxHeight: 340, overflow: 'auto', background: '#fafbfc',
                          border: '1px solid var(--border-lt)', borderRadius: 6, padding: 12,
                          fontSize: 12, whiteSpace: 'pre-wrap', margin: 0 }}>{notify.email.body}</pre>
            <p className="dimmer" style={{ fontSize: 11.5, marginTop: 8 }}>
              Nothing is marked paid or adjusted by sending this — it asks the distributor to
              correct their invoice. What we owe is still what arrived.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn primary" disabled={busy || !notify.email.to}
                title={notify.email.to ? '' : 'No email address on file for this distributor'}
                onClick={sendNotify}>{busy ? 'Sending…' : 'Send'}</button>
              <button className="btn ghost" disabled={busy} onClick={() => setNotify(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {rows.length === 0 && <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">No payments recorded yet — they appear when a shipment is confirmed.</div>}
      </div>
    </div>
  );
}
