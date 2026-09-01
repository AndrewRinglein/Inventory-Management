import React, { useContext, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney, sumMoney } from '../lib/logic/po.js';
import { settlementForPayment } from '../lib/logic/settlement.js';

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
  const { hall, payments, vendors, boxes, pos, store, reloadHall, setToast, can } = useContext(AppCtx);
  const mayPay = can('markPaid');
  const vmap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);
  const rows = [...payments].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  // Expanding fetches the order's lines once and keeps them. Boxes are already in
  // context, so what physically arrived needs no round trip.
  const [openId, setOpenId] = useState(null);
  const [lines, setLines] = useState({});          // po id -> lines
  const [loading, setLoading] = useState(false);

  const toggle = async (pay) => {
    if (openId === pay.id) { setOpenId(null); return; }
    setOpenId(pay.id);
    const po = pos.find((x) => x.num === pay.po_num);
    if (!po || lines[po.id]) return;
    setLoading(true);
    try {
      const got = await store.getPoLines(po.id);
      setLines((m) => ({ ...m, [po.id]: got }));
    } catch (e) {
      setToast(e.message || 'Could not load that order');
    } finally { setLoading(false); }
  };

  /** The settled picture for one payment, or null when there is nothing to settle. */
  const settlementFor = (pay) =>
    settlementForPayment({ payment: pay, pos, linesByPo: lines, boxes, vendors });

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
                <td className="r mono"><b>{fmtMoney(p.amount)}</b></td>
                <td className="last r" onClick={(e) => e.stopPropagation()}>
                  {p.status === 'open'
                    ? (mayPay
                      ? <button className="btn green sm" onClick={() => markPaid(p)}>Mark paid</button>
                      : <span className="badge b-gold">open</span>)
                    : <span className="badge b-green">paid</span>}
                </td>
              </tr>
              {openId === p.id && (
                <tr>
                  <td className="first last" colSpan={7} style={{ background: '#fafbfc', padding: 0 }}>
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
        {rows.length === 0 && <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">No payments recorded yet — they appear when a shipment is confirmed.</div>}
      </div>
    </div>
  );
}
