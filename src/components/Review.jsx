import React, { useContext, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { buildDrafts, nextPoNum, fmtMoney } from '../lib/logic/po.js';
import { buildOrderEmails, senderFor, PO_TEXT_DEFAULTS } from '../lib/logic/emails.js';
import { addressResolver } from '../lib/logic/halls.js';

const HALL_NAMES = { sc: 'Santa Clara', rwc: 'Redwood City' };

export default function Review() {
  const { hall, products, vendors, orderQty, settings, store, reloadHall, reloadSettings, setScreen, setToast, IS_DEMO, can } = useContext(AppCtx);
  const [emailIdx, setEmailIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState({});   // idx -> {subject, body}
  const [recording, setRecording] = useState(false);          // the "record only" dialog
  const [placedOn, setPlacedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [vendorRef, setVendorRef] = useState('');
  const [preview, setPreview] = useState('phone');   // phone | text

  const drafts = useMemo(() => buildDrafts(orderQty, products, vendors), [orderQty, products, vendors]);
  const totalTbd = drafts.reduce((a, d) => a + (d.tbd || 0), 0);
  // what actually lands on the shelf: a case can split into several boxes
  const totalBoxes = drafts.reduce((a, d) => a + d.lines
    .filter((l) => l.kind !== 'fee' && l.product_id)
    .reduce((x, l) => x + l.qty * (l.split_boxes || 1), 0), 0);
  const vendorNames = drafts.map((d) => d.vendor_name).join(', ');

  const emailCfg = settings.email || {};
  const hallName = HALL_NAMES[hall];
  // a vendor may deliver somewhere other than the hall itself
  const hallAddress = addressResolver(settings.halls_config, hall);
  const accounting = emailCfg.accountingAddress || '(accounting address not set — Settings)';

  // Per-email wording for THIS send, layered over the Settings defaults. Editing a
  // field rebuilds both the laid-out and plain-text versions from the same source,
  // so they can't drift apart — which is what made an edited PO fall back to plain
  // text and lose its column alignment in clients that use a proportional font.
  const TEXT_KEYS = ['subject', 'intro', 'tbdNote', 'note', 'closing'];
  const textFor = (i) => {
    const merged = { ...(settings.po_email || {}) };
    const e = edits[i] || {};
    for (const k of TEXT_KEYS) if (e[k] != null) merged[k] = e[k];
    return merged;
  };
  const buildFor = (numbered) => numbered.map((d, i) => {
    const e = buildOrderEmails([d], vendors, hallName, hallAddress, accounting,
      senderFor(settings.sender, hall), textFor(i))[0];
    // the raw-text escape hatch: whatever they typed wins, and the email goes
    // text-only because there is no way to reflect free text into the HTML
    const raw = edits[i]?.rawBody;
    return raw != null ? { ...e, body: raw, html: undefined } : e;
  });

  const emails = useMemo(() => {
    // numbering preview only; real numbers assigned at send
    let seq = { ...(settings.po_sequence || {}) };
    const numbered = drafts.map((d) => {
      const r = nextPoNum(seq, hall, d.vendor_id);
      seq = r.seq;
      return { ...d, num: r.num, sent_at: new Date().toISOString() };
    });
    return { numbered, list: buildFor(numbered) };
  }, [drafts, settings, hall, vendors, edits]);   // eslint-disable-line

  const cur = emails.list[Math.min(emailIdx, emails.list.length - 1)] || null;
  const setField = (k, v) => setEdits({ ...edits, [emailIdx]: { ...(edits[emailIdx] || {}), [k]: v } });

  // A yyyy-mm-dd from a date input is midnight UTC, which lands on the previous
  // day west of Greenwich — a PO recorded as July 1 would file itself under June.
  // Pin it to local noon so the calendar date is the one the person picked.
  const atLocalNoon = (ymd) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0).toISOString();
  };

  /**
   * Write the order to the books.
   *
   * recordedOnly skips the emails entirely — for an order that was already placed
   * some other way (phoned in, emailed by hand) and just needs to exist in the
   * record so stock and spend come out right.
   */
  const commit = async ({ recordedOnly }) => {
    if (!can(recordedOnly ? 'order' : 'send')) {
      setToast(`Your role cannot ${recordedOnly ? 'record' : 'send'} orders for this hall`); return;
    }
    if (!drafts.length || busy) return;
    setBusy(true);
    let pos = null;
    try {
      const placedAt = recordedOnly ? atLocalNoon(placedOn) : new Date().toISOString();
      // ALWAYS number from the freshly-stored sequence (never React state) —
      // prevents duplicate PO numbers after a failed send or a second open window.
      let seq = { ...((await store.getSetting('po_sequence')) || {}) };
      const numbered = drafts.map((d) => {
        // number it in the month it was placed, not the month it was typed in
        const r = nextPoNum(seq, hall, d.vendor_id, new Date(placedAt));
        seq = r.seq;
        return { ...d, num: r.num };
      });
      await store.setSetting('po_sequence', seq);
      pos = await store.createSentPos(hall, drafts, numbered, {
        recordedOnly, placedAt, vendorRef: recordedOnly ? vendorRef.trim() : '',
      });
      // POs exist from here on: clear the builder immediately so a retry can never duplicate them
      await store.clearOrderQty(hall);
      await reloadHall();
      await reloadSettings();

      if (recordedOnly) {
        setToast(`${pos.length} PO(s) recorded, dated ${new Date(placedAt).toLocaleDateString()} — no email sent`, null, 6000);
        setScreen('orders');
        return;
      }

      const finalEmails = buildFor(numbered.map((d, i) => ({ ...d, sent_at: pos[i]?.sent_at })));
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
        setToast((recordedOnly ? 'Could not record that order: ' : 'Send failed: ') + err.message);
      }
    } finally {
      setBusy(false);
      setRecording(false);
    }
  };

  const sendAll = () => commit({ recordedOnly: false });

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
        <button className="btn ghost" disabled={busy || !can('order')} onClick={() => setRecording(true)}
          title="For an order that was already placed some other way — writes it to the books without emailing anyone">
          Record without sending
        </button>
        <button className="btn primary" disabled={busy || !can('send')} onClick={sendAll}
          title={can('send') ? '' : 'Your role cannot send orders for this hall'}>
          {busy ? 'Sending…' : `Send all (${emails.list.length} emails)`}
        </button>
      </div>
      {totalTbd > 0 && (
        <div className="demo-banner">
          <b>{totalTbd} line{totalTbd === 1 ? '' : 's'} {totalTbd === 1 ? 'goes' : 'go'} out with a “?” for the price.</b>{' '}
          The email asks the distributor to ship at their list price and put the figure on the invoice. When it arrives,
          Receiving will ask you for the real price and fill it in everywhere.
        </div>
      )}
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
                      <td className="r mono dimmer" style={{ fontSize: 11 }}>
                        {l.pack_units > 1 ? `${fmtMoney(l.base_cost)} ×${l.pack_units}` : ''}
                      </td>
                      <td className="r mono dimmer" style={{ fontSize: 11 }}>
                        {l.packing_each > 0 ? fmtMoney(l.packing_each) : ''}
                      </td>
                      <td className="r mono last">
                        {l.price_tbd ? <span className="tbd" title="No price on our side — the vendor fills this in on their invoice">?</span>
                          : fmtMoney(l.qty * (l.cost + (l.packing_each || 0)))}
                      </td>
                    </tr>
                  ))}
                  <tr><td className="first dim">Stock / Packing</td><td colSpan={2} />
                    <td className="r mono last">
                      {fmtMoney(d.lines.filter((l) => !l.price_tbd).reduce((a, l) => a + l.qty * l.cost, 0))}
                      {' / '}
                      {fmtMoney(d.lines.filter((l) => !l.price_tbd).reduce((a, l) => a + l.qty * (l.packing_each || 0), 0))}
                    </td></tr>
                  <tr><td className="first dim">Subtotal / Tax / Total</td><td colSpan={2} />
                    <td className="r mono last"><b>{fmtMoney(d.subtotal)} / {fmtMoney(d.tax)} / {fmtMoney(d.total)}</b></td></tr>
                  {d.partial && (
                    <tr><td className="first" colSpan={5} style={{ fontSize: 11.5, color: 'var(--gold)' }}>
                      Plus {d.tbd} unpriced line{d.tbd === 1 ? '' : 's'} — this total is what we know, not the final bill.
                    </td></tr>
                  )}
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
                {e.subject}
              </div>
            ))}
          </div>
          {cur && (
            <div className="email-preview">
              <div className="hd">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div><b>To:</b> {cur.to}</div>
                  <div style={{ flex: 1 }} />
                  <div className="hall-switch" style={{ margin: 0 }}>
                    {[
                      ['edit', '✎ Edit wording', 'Change what this email says'],
                      ['phone', 'Phone view', 'How it will look on a phone'],
                      ['text', 'Plain-text view', 'The fallback for clients that show no formatting'],
                    ].map(([t, label, tip]) => (
                      <button key={t} className={preview === t ? 'on' : ''} onClick={() => setPreview(t)} title={tip}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mono dimmer" style={{ fontSize: 12, marginTop: 4 }}>{cur.subject}</div>
              </div>

              {preview === 'edit' ? (
                <div style={{ padding: 14 }}>
                  <p className="dimmer" style={{ fontSize: 12, margin: '0 0 12px' }}>
                    <b>This is the only tab you type in</b> — the two views beside it just show the result.
                    Changes apply to this email only and rebuild both versions, so the phone layout stays.
                    Blank uses the standard wording (shown greyed). To change every future PO instead,
                    use Settings → PO email wording.
                  </p>
                  {[
                    ['subject', 'Subject line', 1, `${'{hall}'} order — PO ${'{po}'}`],
                    ['intro', 'Opening line', 2, PO_TEXT_DEFAULTS.intro],
                    ['note', 'Extra paragraph', 3, 'Anything specific to this order — delivery timing, a substitution, a question'],
                    ['closing', 'Closing line', 3, PO_TEXT_DEFAULTS.closing],
                  ].map(([k, label, rows, ph]) => (
                    <div className="field" key={k}>
                      <label>{label}</label>
                      {rows === 1
                        ? <input type="text" value={(edits[emailIdx] || {})[k] ?? ''} placeholder={ph}
                            style={{ width: '100%' }} onChange={(e) => setField(k, e.target.value)} />
                        : <textarea value={(edits[emailIdx] || {})[k] ?? ''} placeholder={ph} rows={rows}
                            style={{ width: '100%', resize: 'vertical' }} onChange={(e) => setField(k, e.target.value)} />}
                    </div>
                  ))}
                  <div className="dimmer" style={{ fontSize: 11.5, marginTop: 10 }}>
                    {'{hall}'} {'{po}'} {'{vendor}'} {'{date}'} fill in automatically. The item table and totals
                    are always generated — they have to match the order.
                  </div>
                  {edits[emailIdx]?.rawBody == null ? (
                    <button className="btn ghost sm" style={{ marginTop: 12 }}
                      onClick={() => setField('rawBody', cur.body)}
                      title="Type the whole email yourself — the phone layout is lost">
                      Write the whole email by hand instead…
                    </button>
                  ) : (
                    <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={() => setField('rawBody', null)}>
                      ← Back to the generated email
                    </button>
                  )}
                </div>
              ) : preview === 'phone' && cur.html ? (
                <div style={{ background: '#e9ebed', padding: 14, display: 'flex', justifyContent: 'center' }}>
                  <iframe title="Phone preview" srcDoc={cur.html}
                    style={{ width: 390, height: 560, border: '1px solid var(--border)', borderRadius: 10, background: '#fff' }} />
                </div>
              ) : (
                <textarea readOnly={edits[emailIdx]?.rawBody == null}
                  style={{ width: '100%', border: 'none', minHeight: 340, fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, padding: 14, resize: 'vertical', background: edits[emailIdx]?.rawBody == null ? '#fbfbfc' : '#fff' }}
                  value={cur.body}
                  onChange={(e) => setField('rawBody', e.target.value)} />
              )}

              <div className="dimmer" style={{ fontSize: 11.5, padding: '8px 14px', borderTop: '1px solid var(--border-lt)' }}>
                {cur.html
                  ? 'Both versions go in the same email — phones and most clients show the laid-out one, anything plain-text-only falls back to the Text tab.'
                  : "Hand-written: this one sends as plain text only. Mail clients that use a proportional font won't keep the columns lined up."}
              </div>
            </div>
          )}
        </div>
      </div>

      {recording && (
        <div className="modal-bg" onClick={() => !busy && setRecording(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
              Record {emails.numbered.length} order{emails.numbered.length === 1 ? '' : 's'} without sending
            </div>
            <p style={{ fontSize: 13 }}>
              This writes {emails.numbered.length === 1 ? 'the order' : 'the orders'} to the books exactly as a sent order —
              same PO number, same lines, {totalBoxes} box{totalBoxes === 1 ? '' : 'es'} on order — but no email goes to{' '}
              {emails.numbered.length === 1 ? vendorNames : 'the distributors'}. Use it for an order that was already
              placed by phone or by hand.
            </p>
            <label style={{ display: 'block', fontSize: 12.5, marginTop: 12 }}>
              Date it was placed
              <input type="date" value={placedOn} max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setPlacedOn(e.target.value)}
                style={{ display: 'block', marginTop: 4, width: 180 }} />
            </label>
            <div className="dimmer" style={{ fontSize: 11.5, marginTop: 4 }}>
              The PO number and the month's spend both follow this date, so put in the real one.
            </div>
            <label style={{ display: 'block', fontSize: 12.5, marginTop: 12 }}>
              Their reference <span className="dimmer">(optional — their order or invoice number, if you have it)</span>
              <input type="text" value={vendorRef} placeholder="e.g. 8842 or INV-10233"
                onChange={(e) => setVendorRef(e.target.value)}
                style={{ display: 'block', marginTop: 4, width: '100%' }} />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button className="btn primary" disabled={busy} onClick={() => commit({ recordedOnly: true })}>
                {busy ? 'Recording…' : 'Record — no email'}
              </button>
              <div style={{ flex: 1 }} />
              <button className="btn ghost" disabled={busy} onClick={() => setRecording(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
