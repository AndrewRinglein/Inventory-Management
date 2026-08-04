import React, { useContext, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { buildDrafts, nextPoNum, fmtMoney } from '../lib/logic/po.js';
import { buildOrderEmails } from '../lib/logic/emails.js';

const HALL_NAMES = { sc: 'Santa Clara', rwc: 'Redwood City' };

export default function Review() {
  const { hall, products, vendors, orderQty, settings, store, reloadHall, reloadSettings, setScreen, setToast, IS_DEMO, can } = useContext(AppCtx);
  const [emailIdx, setEmailIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState({});   // idx -> {subject, body}

  const drafts = useMemo(() => buildDrafts(orderQty, products, vendors), [orderQty, products, vendors]);

  const emailCfg = settings.email || {};
  const hallName = HALL_NAMES[hall];
  const hallAddress = settings.halls_config?.[hall]?.address || '';
  const accounting = emailCfg.accountingAddress || '(accounting address not set — Settings)';

  const emails = useMemo(() => {
    // numbering preview only; real numbers assigned at send
    let seq = { ...(settings.po_sequence || {}) };
    const numbered = drafts.map((d) => {
      const r = nextPoNum(seq, hall, d.vendor_id);
      seq = r.seq;
      return { ...d, num: r.num, sent_at: new Date().toISOString() };
    });
    return { numbered, list: buildOrderEmails(numbered, vendors, hallName, hallAddress, accounting, settings.sender || {}) };
  }, [drafts, settings, hall, vendors]);   // eslint-disable-line

  const view = (i) => {
    const e = emails.list[i];
    return e ? { ...e, ...(edits[i] || {}) } : null;
  };
  const cur = view(Math.min(emailIdx, emails.list.length - 1));

  const sendAll = async () => {
    if (!can('send')) { setToast('Your role cannot send orders for this hall'); return; }
    if (!drafts.length || busy) return;
    setBusy(true);
    let pos = null;
    try {
      // ALWAYS number from the freshly-stored sequence (never React state) —
      // prevents duplicate PO numbers after a failed send or a second open window.
      let seq = { ...((await store.getSetting('po_sequence')) || {}) };
      const numbered = drafts.map((d) => {
        const r = nextPoNum(seq, hall, d.vendor_id);
        seq = r.seq;
        return { ...d, num: r.num };
      });
      await store.setSetting('po_sequence', seq);
      pos = await store.createSentPos(hall, drafts, numbered);
      // POs exist from here on: clear the builder immediately so a retry can never duplicate them
      await store.clearOrderQty(hall);
      await reloadHall();
      await reloadSettings();
      const finalEmails = buildOrderEmails(
        numbered.map((d, i) => ({ ...d, sent_at: pos[i]?.sent_at })),
        vendors, hallName, hallAddress, accounting, settings.sender || {}
      ).map((e, i) => ({ ...e, ...(edits[i] || {}) }));
      await store.sendEmails(finalEmails, hall);
      setToast(IS_DEMO
        ? `${pos.length} PO(s) created; ${finalEmails.length} emails logged (demo — not sent)`
        : `${pos.length} PO(s) sent; ${finalEmails.length} emails delivered to ${emailCfg.testMode ? 'TEST inbox' : 'vendors + accounting'}`);
      setScreen('orders');
    } catch (err) {
      if (pos) {
        setToast(`${pos.length} PO(s) WERE created, but the emails failed: ${err.message}. Find them under Open Orders — do not re-enter the order.`, null, 9000);
        setScreen('orders');
      } else {
        setToast('Send failed: ' + err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!drafts.length) {
    return (
      <div>
        <div className="page-head"><div className="h1">Review &amp; Send — {hallName}</div></div>
        <div className="card pad dimmer">No quantities entered yet. <a href="#" onClick={(e) => { e.preventDefault(); setScreen('purchase'); }}>Back to the order builder →</a></div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div className="h1">Review &amp; Send — {hallName}</div>
        <div className="grow" />
        <button className="btn ghost" onClick={() => setScreen('purchase')}>← Back to builder</button>
        <button className="btn primary" disabled={busy || !can('send')} onClick={sendAll}
          title={can('send') ? '' : 'Your role cannot send orders for this hall'}>
          {busy ? 'Sending…' : `Send all (${emails.list.length} emails)`}
        </button>
      </div>
      {emailCfg.testMode && !IS_DEMO && (
        <div className="demo-banner">Email test mode is ON — everything goes to {emailCfg.testAddress || 'the test address'} instead of vendors. Turn off in Settings when ready.</div>
      )}
      <div className="two-col">
        <div>
          {emails.numbered.map((d) => (
            <div className="card" key={d.vendor_id} style={{ marginBottom: 12 }}>
              <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                <b>{d.vendor_name}</b><span className="mono dim">{d.num}</span>
              </div>
              <table className="tbl">
                <tbody>
                  {d.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="first">{l.name_snapshot}</td>
                      <td className="r mono">×{l.qty}</td>
                      <td className="r mono last">{fmtMoney(l.qty * l.cost)}</td>
                    </tr>
                  ))}
                  <tr><td className="first dim">Subtotal / Tax / Total</td><td />
                    <td className="r mono last"><b>{fmtMoney(d.subtotal)} / {fmtMoney(d.tax)} / {fmtMoney(d.total)}</b></td></tr>
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <div>
          <div className="card" style={{ marginBottom: 10 }}>
            {emails.list.map((e, i) => (
              <div key={i} onClick={() => setEmailIdx(i)}
                style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-lt)', cursor: 'pointer', background: i === emailIdx ? '#eef3f5' : 'transparent', fontSize: 12.5 }}>
                <span className={'badge ' + (e.kind === 'po' ? 'b-teal' : 'b-gray')} style={{ marginRight: 8 }}>{e.kind === 'po' ? 'PO' : 'copy'}</span>
                {view(i).subject}
              </div>
            ))}
          </div>
          {cur && (
            <div className="email-preview">
              <div className="hd">
                <div><b>To:</b> {cur.to}</div>
                <input className="cell" style={{ fontWeight: 600, width: '100%' }} value={cur.subject}
                  onChange={(e) => setEdits({ ...edits, [emailIdx]: { ...(edits[emailIdx] || {}), subject: e.target.value } })} />
              </div>
              <textarea style={{ width: '100%', border: 'none', minHeight: 340, fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, padding: 14, resize: 'vertical' }}
                value={cur.body}
                onChange={(e) => setEdits({ ...edits, [emailIdx]: { ...(edits[emailIdx] || {}), body: e.target.value } })} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
