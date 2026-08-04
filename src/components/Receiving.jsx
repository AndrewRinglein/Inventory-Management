import React, { useContext, useEffect, useMemo, useState, useRef } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney } from '../lib/logic/po.js';
import { buildShortageEmail, buildDeliveredEmail } from '../lib/logic/emails.js';

const HALL_NAMES = { sc: 'Santa Clara', rwc: 'Redwood City' };

export default function Receiving() {
  const { hall, pos, boxes, vendors, settings, store, reloadHall, setToast, receivingPo, setReceivingPo, IS_DEMO, can, receivingScanRef } = useContext(AppCtx);
  const open = pos.filter((p) => p.status === 'sent' || p.status === 'partial');
  const cur = open.find((p) => p.id === receivingPo) || null;

  const [lines, setLines] = useState([]);
  const [recv, setRecv] = useState({});          // product_id -> qty received this shipment
  const [serials, setSerials] = useState({});    // product_id -> "s1, s2" text
  const [invoiceNo, setInvoiceNo] = useState('');
  const [photo, setPhoto] = useState(null);      // File
  const [aiNote, setAiNote] = useState('');
  const [stage, setStage] = useState('checkin'); // checkin | emails
  const [pendingEmails, setPendingEmails] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pendingScan, setPendingScan] = useState(null);   // scanned code awaiting game pick
  const [scanCount, setScanCount] = useState(0);
  const scannedRef = useRef(new Set());
  const stateRef = useRef({});
  stateRef.current = { lines, recv, serials, cur };

  const vmap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);

  // scan-to-receive: every scan either matches a serial from the invoice list,
  // or asks which game the box belongs to (one tap), keeping manual entry fully usable alongside.
  useEffect(() => {
    receivingScanRef.current = async (code) => {
      const { lines, serials, cur } = stateRef.current;
      if (!cur || stage !== 'checkin') return { ok: false, message: 'Pick which order arrived first.' };
      if (scannedRef.current.has(code)) return { ok: false, message: `${code} was already scanned this delivery.` };
      const hit = lines.find((l) => (serials[l.product_id] || '').split(/[\s,\n]+/).includes(code));
      if (hit) { applyScan(hit.product_id, code); return { ok: true, message: `✓ ${hit.name_snapshot}` }; }
      setPendingScan(code);
      return { ok: false, message: `Serial ${code} isn't on the invoice list — pick the game below.` };
    };
    return () => { receivingScanRef.current = null; };
  }, [stage]);   // eslint-disable-line

  const applyScan = (pid, code) => {
    scannedRef.current.add(code);
    setScanCount(scannedRef.current.size);
    const { lines, recv, serials } = stateRef.current;
    const line = lines.find((l) => l.product_id === pid);
    const rem = line ? remainingFor(line) : 0;
    const now = Math.min((parseInt(recv[pid]) || 0) + 1, rem || 1);
    setRecv({ ...recv, [pid]: now });
    const list = (serials[pid] || '').split(/[\s,\n]+/).filter(Boolean);
    if (!list.includes(code)) setSerials({ ...serials, [pid]: [...list, code].join(', ') });
  };

  useEffect(() => {
    setStage('checkin'); setPendingEmails(null); setRecv({}); setSerials({}); setInvoiceNo(''); setPhoto(null); setAiNote('');
    scannedRef.current = new Set(); setScanCount(0); setPendingScan(null);
    if (cur) store.getPoLines(cur.id).then((ls) => {
      setLines(ls);
      // remaining = ordered minus already-received (for partial second deliveries)
      const rec = {};
      for (const l of ls) {
        const already = boxes.filter((b) => b.po_id === cur.id && b.product_id === l.product_id && b.state !== 'on_order' && b.state !== 'missing').length;
        rec[l.product_id] = Math.max(0, l.qty - already);
      }
      setRecv(rec);
    });
  }, [cur?.id]);   // eslint-disable-line

  const remainingFor = (l) => {
    const already = boxes.filter((b) => b.po_id === cur.id && b.product_id === l.product_id && b.state !== 'on_order' && b.state !== 'missing').length;
    return Math.max(0, l.qty - already);
  };

  // role guard AFTER all hooks (react rules) — masters viewing the other hall land here
  if (!can('receive')) {
    return (
      <div>
        <div className="page-head"><div className="h1">Receiving — {HALL_NAMES[hall]}</div></div>
        <div className="card pad dimmer">
          Your role can't receive shipments{hall === 'sc' ? ' for Santa Clara' : ' for Redwood City'}.
          {open.length > 0 && ` (${open.length} order(s) currently awaiting delivery.)`}
        </div>
      </div>
    );
  }

  const aiRead = async () => {
    if (!photo) { setToast('Take or choose an invoice photo first'); return; }
    setBusy(true);
    try {
      const path = await store.uploadInvoicePhoto(photo);
      const res = await store.readInvoicePhoto(path);
      if (res.demo) { setAiNote(res.note); }
      else if (res.lines?.length) {
        // match extracted lines to PO lines by fuzzy name; pre-fill quantities + serials
        const rec = { ...recv }, ser = { ...serials };
        for (const ex of res.lines) {
          const match = lines.find((l) => l.name_snapshot.toLowerCase().includes((ex.name || '').toLowerCase().slice(0, 12)));
          if (match) {
            rec[match.product_id] = ex.qty ?? rec[match.product_id];
            if (ex.serials?.length) ser[match.product_id] = ex.serials.join(', ');
          }
        }
        setRecv(rec); setSerials(ser);
        setAiNote(`AI read ${res.lines.length} line(s) — verify below, then confirm.`);
      } else setAiNote('AI could not find line items on that photo — enter them manually.');
    } catch (e) { setAiNote('AI read failed: ' + e.message); }
    setBusy(false);
  };

  const confirm = async () => {
    if (!cur || busy) return;
    setBusy(true);
    try {
      let photoPath = null;
      if (photo) photoPath = await store.uploadInvoicePhoto(photo);
      const shipment = await store.createShipment({ po_id: cur.id, invoice_no: invoiceNo, invoice_photo_path: photoPath, notes: '' });

      const receivedLines = [], missingLines = [];
      for (const l of lines) {
        const want = remainingFor(l);
        const got = Math.min(Math.max(0, parseInt(recv[l.product_id]) || 0), want);
        const serialList = (serials[l.product_id] || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
        // flip boxes on_order -> in_inventory
        const pool = boxes.filter((b) => b.po_id === cur.id && b.product_id === l.product_id && b.state === 'on_order').slice(0, got);
        for (let i = 0; i < pool.length; i++) {
          await store.updateBox(pool[i].id, { serial: serialList[i] || '', shipment_id: shipment.id });
          await store.transitionBox(pool[i].id, 'in_inventory');
        }
        if (got > 0) receivedLines.push({ ...l, qty: got });
        const still = want - got;
        if (still > 0) missingLines.push({ ...l, qty: still });
      }
      await store.confirmShipment(shipment.id);
      await store.setPoStatus(cur.id, missingLines.length ? 'partial' : 'closed');

      // build the two follow-up emails for review
      const v = vmap[cur.vendor_id];
      const emails = [];
      if (missingLines.length) emails.push(buildShortageEmail(cur, v, HALL_NAMES[hall], missingLines));
      const delivered = buildDeliveredEmail(cur, v, HALL_NAMES[hall], invoiceNo, receivedLines, missingLines);
      delivered.to = settings.email?.accountingAddress || '(accounting address not set)';
      emails.push(delivered);
      await store.addPayment({
        hall_id: hall, vendor_id: cur.vendor_id, po_num: cur.num,
        invoice_no: invoiceNo, amount: delivered.amount,
      });
      await reloadHall();
      setPendingEmails(emails);
      setStage('emails');
      setToast(missingLines.length
        ? `Shipment confirmed — ${missingLines.reduce((a, l) => a + l.qty, 0)} item(s) missing`
        : 'Shipment confirmed — everything received');
    } catch (e) {
      setToast('Confirm failed: ' + e.message);
    } finally { setBusy(false); }
  };

  const sendFollowUps = async () => {
    await store.sendEmails(pendingEmails, hall);
    setToast(IS_DEMO ? `${pendingEmails.length} email(s) logged (demo — not sent)` : `${pendingEmails.length} email(s) sent`);
    setPendingEmails(null);
    setReceivingPo(null);
  };

  if (!cur) {
    return (
      <div>
        <div className="page-head"><div className="h1">Receiving — {HALL_NAMES[hall]}</div></div>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--border)' }}>Which order arrived?</div>
          {open.length === 0 && <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">No orders are awaiting delivery.</div>}
          <table className="tbl"><tbody>
            {open.map((p) => (
              <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setReceivingPo(p.id)}>
                <td className="first mono">{p.num}</td>
                <td>{vmap[p.vendor_id]?.name}</td>
                <td><span className={'badge ' + (p.status === 'sent' ? 'b-gold' : 'b-orange')}>{p.status === 'sent' ? 'awaiting delivery' : 'partially received'}</span></td>
                <td className="r mono last">{fmtMoney(p.total)}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      </div>
    );
  }

  if (stage === 'emails' && pendingEmails) {
    return (
      <div>
        <div className="page-head">
          <div className="h1">Receiving — follow-up emails</div>
          <div className="grow" />
          <button className="btn primary" onClick={sendFollowUps}>Send {pendingEmails.length} email(s)</button>
        </div>
        {pendingEmails.map((e, i) => (
          <div className="email-preview" key={i} style={{ marginBottom: 14 }}>
            <div className="hd"><b>To:</b> {e.to} — <b>{e.subject}</b></div>
            <pre>{e.body}</pre>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div className="h1">Receiving — <span className="mono">{cur.num}</span> ({vmap[cur.vendor_id]?.name})</div>
        <div className="grow" />
        <div className="scan-ind on"><span className="dot" />Scanning ready — {scanCount} box{scanCount === 1 ? '' : 'es'} scanned · manual entry works too</div>
        <button className="btn ghost" onClick={() => setReceivingPo(null)}>← Different order</button>
      </div>
      <div className="card pad" style={{ marginBottom: 14, display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field" style={{ margin: 0 }}><label>Vendor invoice #</label>
          <input type="text" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} style={{ width: 160 }} /></div>
        <div className="field" style={{ margin: 0 }}><label>Delivery invoice photo</label>
          <input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] || null)} /></div>
        <button className="btn primary" disabled={busy || !photo} onClick={aiRead}>{busy ? 'Reading…' : '🤖 AI-read invoice'}</button>
        {aiNote && <span className="dim" style={{ fontSize: 12.5, maxWidth: 420 }}>{aiNote}</span>}
      </div>
      <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
        <table className="tbl">
          <thead><tr>
            <th className="first">Ordered item</th><th className="r">Ordered</th><th className="r">Still expected</th>
            <th style={{ width: 110 }}>Received now</th><th className="last">Box serials (comma-separated, optional)</th>
          </tr></thead>
          <tbody>
            {lines.map((l) => {
              const rem = remainingFor(l);
              return (
                <tr key={l.id} style={rem === 0 ? { opacity: 0.5 } : {}}>
                  <td className="first">{l.name_snapshot}</td>
                  <td className="r mono">{l.qty}</td>
                  <td className="r mono">{rem}</td>
                  <td>
                    <input className="qty" type="number" min="0" max={rem} value={recv[l.product_id] ?? ''}
                      onChange={(e) => setRecv({ ...recv, [l.product_id]: e.target.value })} disabled={rem === 0} />
                  </td>
                  <td className="last">
                    <input className="cell mono" type="text" style={{ fontSize: 11.5 }} placeholder={rem ? 'e.g. 48812, 48813' : ''}
                      value={serials[l.product_id] || ''} disabled={rem === 0}
                      onChange={(e) => setSerials({ ...serials, [l.product_id]: e.target.value })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pendingScan && (
        <div className="modal-bg" onClick={() => setPendingScan(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>Which game is this box?</div>
            <p className="dim" style={{ fontSize: 12.5, marginBottom: 12 }}>
              Scanned serial <b className="mono">{pendingScan}</b> — tap the game it belongs to:
            </p>
            {lines.filter((l) => remainingFor(l) > 0).map((l) => (
              <button key={l.id} className="btn ghost" style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 6 }}
                onClick={() => { applyScan(l.product_id, pendingScan); setPendingScan(null); }}>
                {l.name_snapshot} <span className="dimmer">({remainingFor(l)} expected)</span>
              </button>
            ))}
            {lines.every((l) => remainingFor(l) === 0) && <p className="dimmer">Nothing left expected on this order.</p>}
            <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => setPendingScan(null)}>Cancel — not from this order</button>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn green" disabled={busy} onClick={confirm}>
          {busy ? 'Confirming…' : '✓ Confirm shipment & update inventory'}
        </button>
        <span className="muted-note">Anything "still expected" but not received will be flagged missing → shortage email + short-pay note to accounting.</span>
      </div>
    </div>
  );
}
