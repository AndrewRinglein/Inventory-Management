import React, { useContext, useEffect, useMemo, useState, useRef } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney, snapshotHead } from '../lib/logic/po.js';
import { buildShortageEmail, buildDeliveredEmail, senderFor } from '../lib/logic/emails.js';
import { needsSetup } from '../lib/logic/setup.js';
import { splitBoxes } from '../lib/logic/pricing.js';
import { receivedLine, missingLine, extraLine, perUnitOf, lineSplit } from '../lib/logic/receiving.js';
import AddDelivery from './AddDelivery.jsx';

const HALL_NAMES = { sc: 'Santa Clara', rwc: 'Redwood City' };

export default function Receiving() {
  const { hall, pos, boxes, vendors, products, settings, store, reloadHall, reloadCatalog, setToast, receivingPo, setReceivingPo, IS_DEMO, can, receivingScanRef } = useContext(AppCtx);
  const open = pos.filter((p) => p.status === 'sent' || p.status === 'partial');
  const cur = open.find((p) => p.id === receivingPo) || null;

  const [lines, setLines] = useState([]);
  const [recv, setRecv] = useState({});          // product_id -> qty received this shipment
  const [serials, setSerials] = useState({});    // product_id -> "s1, s2" text
  const [invoiceNo, setInvoiceNo] = useState('');
  const [pages, setPages] = useState([]);        // File[] — an invoice can be several pages
  const [aiNote, setAiNote] = useState('');
  const [extras, setExtras] = useState([]);      // games received that weren't on this PO
  const [addQuery, setAddQuery] = useState('');  // manual entry: game name
  const [addPick, setAddPick] = useState(null);  // manual entry: the chosen game
  const [addQty, setAddQty] = useState('1');     // manual entry: how many boxes
  const addNameRef = useRef(null);
  const [tbdPrice, setTbdPrice] = useState({});  // product_id -> unit price read off the invoice
  const [deliveries, setDeliveries] = useState([]);
  const [stage, setStage] = useState('checkin'); // checkin | emails
  const [pendingEmails, setPendingEmails] = useState(null);
  const [busy, setBusy] = useState(false);
  const [addDelivery, setAddDelivery] = useState(false);
  const [pendingScan, setPendingScan] = useState(null);   // scanned code awaiting game pick
  const [scanCount, setScanCount] = useState(0);
  const [manualCode, setManualCode] = useState('');       // the scan box (also accepts typing)
  const scanBoxRef = useRef(null);
  const scannedRef = useRef(new Set());
  const stateRef = useRef({});
  stateRef.current = { lines, recv, serials, cur, extras };

  const vmap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);

  // what has already landed, newest first — reloaded whenever stock moves
  // arrivals, not deliveries — a received PO writes a shipment, an ad-hoc drop
  // writes a delivery, and reading one table shows half the story
  useEffect(() => { store.getArrivals(hall).then(setDeliveries).catch(() => setDeliveries([])); },
    [hall, boxes, pos, store]);

  // manual entry: type a game name, pick from the catalog (this vendor's games first)
  const matchingProducts = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const vid = cur?.vendor_id;
    return products
      .filter((p) => p.name.toLowerCase().includes(q))
      .sort((a, b) => (a.vendor_id === vid ? 0 : 1) - (b.vendor_id === vid ? 0 : 1) || a.name.localeCompare(b.name))
      .slice(0, 12);
  }, [addQuery, products, cur]);

  // scan-to-receive: every scan either matches a serial from the invoice list,
  // or asks which game the box belongs to (one tap), keeping manual entry fully usable alongside.
  /** One path for every scan, whether it came from the scanner or the box above. */
  const handleScan = async (code) => {
    const r = await receivingScanRef.current?.(code);
    if (r?.message) setToast(r.message);
    scanBoxRef.current?.focus();
    return r;
  };

  useEffect(() => {
    receivingScanRef.current = async (code) => {
      const { lines, serials, cur } = stateRef.current;
      if (!cur || stage !== 'checkin') return { ok: false, message: 'Pick which order arrived first.' };
      if (scannedRef.current.has(code)) return { ok: false, message: `${code} was already scanned this delivery.` };
      setManualCode('');   // the scan box is the scanner's home — always clear it
      const hit = lines.find((l) => (serials[l.product_id] || '').split(/[\s,\n]+/).includes(code));
      if (hit) { applyScan(hit.product_id, code); return { ok: true, message: `✓ ${snapshotHead(hit.name_snapshot)}` }; }
      const ex = (stateRef.current.extras || []).find((x) => (x.serials || '').split(/[\s,\n]+/).includes(code));
      if (ex) { applyExtraScan(ex.key, code); return { ok: true, message: `✓ ${ex.name}` }; }
      setPendingScan(code);
      return { ok: false, message: `Serial ${code} isn't on the invoice list — pick the game below.` };
    };
    return () => { receivingScanRef.current = null; };
  }, [stage]);   // eslint-disable-line

  /** Manual entry: add any catalog game as received (name + box count), even if it wasn't on this PO. */
  const addExtra = (product, code, qty = 1) => {
    const n = Math.max(1, parseInt(qty) || 1);
    setExtras((prev) => {
      const found = prev.find((x) => x.product_id === product.id);
      if (found) {
        return prev.map((x) => x.product_id === product.id
          ? {
            ...x, qty: x.qty + n,
            serials: code && !x.serials.includes(code) ? [x.serials, code].filter(Boolean).join(', ') : x.serials,
          }
          : x);
      }
      return [...prev, {
        key: product.id + '_' + Date.now(), product_id: product.id, name: product.name,
        cost: Number(product.cost) || 0, price_tbd: needsSetup(product), qty: n, serials: code || '',
      }];
    });
    if (code) { scannedRef.current.add(code); setScanCount(scannedRef.current.size); }
    setAddQuery(''); setAddPick(null); setAddQty('1');
  };

  /** Commit the name + count row. Falls back to the single exact match if nothing was clicked. */
  const commitManualAdd = () => {
    const pick = addPick || (matchingProducts.length === 1 ? matchingProducts[0] : null);
    if (!pick) { setToast('Pick a game from the list first'); return; }
    addExtra(pick, null, addQty);
    addNameRef.current?.focus();
  };

  const applyExtraScan = (key, code) => {
    scannedRef.current.add(code); setScanCount(scannedRef.current.size);
    setExtras((prev) => prev.map((x) => x.key === key ? { ...x, qty: x.qty + 1 } : x));
  };

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
    setStage('checkin'); setPendingEmails(null); setRecv({}); setSerials({}); setInvoiceNo(''); setPages([]); setAiNote('');
    setExtras([]); setAddQuery(''); setAddPick(null); setAddQty('1');
    scannedRef.current = new Set(); setScanCount(0); setPendingScan(null);
    if (cur) store.getPoLines(cur.id).then((all) => {
      const ls = all.filter((l) => l.kind !== 'fee');   // packing charges aren't received
      setLines(ls);
      // remaining = ordered minus already-received (for partial second deliveries)
      const rec = {};
      for (const l of ls) {
        const per = Math.max(1, parseInt(l.split_boxes) || 1);
        const already = boxes.filter((b) => b.po_id === cur.id && b.product_id === l.product_id && b.state !== 'on_order' && b.state !== 'missing').length;
        rec[l.product_id] = Math.max(0, l.qty * per - already);
      }
      setRecv(rec);
    });
  }, [cur?.id]);   // eslint-disable-line

  useEffect(() => {
    if (stage === 'checkin' && cur && !pendingScan) scanBoxRef.current?.focus();
  }, [stage, cur, pendingScan]);

  /**
   * Lines that went out with a "?" and are arriving now. The invoice in your hand
   * is the answer, so this is the moment to capture it — after this the boxes are
   * in stock and accounting is told what to pay, and both need the real number.
   */
  const priceOf = (pid, fallback) => {
    const v = parseFloat(tbdPrice[pid]);
    return v > 0 ? Math.round(v * 100) / 100 : (Number(fallback) || 0);
  };
  const openPriceLines = lines.filter((l) => l.price_tbd && (parseInt(recv[l.product_id]) || 0) > 0);
  const openPriceExtras = extras.filter((x) => x.price_tbd && (parseInt(x.qty) || 0) > 0);
  const missingPrices = [...openPriceLines.map((l) => l.product_id), ...openPriceExtras.map((x) => x.product_id)]
    .filter((pid) => !(parseFloat(tbdPrice[pid]) > 0));

  /**
   * How many INVENTORY UNITS one ordered unit of this line becomes. A PO line is
   * written in ordered units — one Biker case — but the shelf, the boxes table and
   * the person counting all work in totes. The line records what the split was at
   * the time it was sent; the catalog is only a fallback for older lines.
   */
  const boxesPerUnit = (l) => lineSplit(l, products.find((p) => p.id === l.product_id));

  /** Boxes this line still owes, counted the same way the shelf counts them. */
  const remainingFor = (l) => {
    const already = boxes.filter((b) => b.po_id === cur.id && b.product_id === l.product_id && b.state !== 'on_order' && b.state !== 'missing').length;
    return Math.max(0, l.qty * boxesPerUnit(l) - already);
  };

  /** What one box off this line costs — the ordered-unit price divided by the split. */
  const perBoxOf = (l, orderedUnitPrice) => perUnitOf(orderedUnitPrice, boxesPerUnit(l));

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

  /** Read every uploaded page and merge the results into the check-in list. */
  const aiRead = async () => {
    if (!pages.length) { setToast('Add at least one invoice page first'); return; }
    setBusy(true);
    try {
      const rec = { ...recv }, ser = { ...serials };
      const unmatched = [];
      let found = 0, demoNote = '';
      for (let i = 0; i < pages.length; i++) {
        setAiNote(`Reading page ${i + 1} of ${pages.length}…`);
        const path = await store.uploadInvoicePhoto(pages[i]);
        const res = await store.readInvoicePhoto(path);
        if (res.demo) { demoNote = res.note; continue; }
        if (res.invoice_no && !invoiceNo) setInvoiceNo(res.invoice_no);
        for (const ex of res.lines || []) {
          found++;
          const needle = (ex.name || '').toLowerCase().slice(0, 12);
          const match = needle && lines.find((l) => l.name_snapshot.toLowerCase().includes(needle));
          if (match) {
            rec[match.product_id] = ex.qty ?? rec[match.product_id];
            if (ex.serials?.length) ser[match.product_id] = ex.serials.join(', ');
          } else if (ex.name) {
            // on the invoice but not on this PO — offer it as an extra to confirm
            const p = products.find((pr) => pr.name.toLowerCase().includes(needle));
            if (p) unmatched.push({ product: p, qty: ex.qty || 1, serials: ex.serials || [] });
            else unmatched.push({ raw: ex.name, qty: ex.qty || 1 });
          }
        }
      }
      setRecv(rec); setSerials(ser);
      if (unmatched.length) {
        setExtras((prev) => [...prev, ...unmatched.filter((u) => u.product).map((u) => ({
          key: u.product.id + '_' + Math.random().toString(36).slice(2, 7),
          product_id: u.product.id, name: u.product.name, cost: u.product.cost,
          qty: u.qty, serials: (u.serials || []).join(', '),
        }))]);
      }
      const unknownNames = unmatched.filter((u) => !u.product).map((u) => u.raw);
      setAiNote(demoNote || [
        `Read ${pages.length} page${pages.length > 1 ? 's' : ''}: ${found} line(s) found.`,
        unmatched.filter((u) => u.product).length ? `${unmatched.filter((u) => u.product).length} weren't on this PO — added below to confirm.` : '',
        unknownNames.length ? `Couldn't match: ${unknownNames.join(', ')} — add by name if needed.` : '',
        'Check everything before confirming.',
      ].filter(Boolean).join(' '));
    } catch (e) { setAiNote('AI read failed: ' + e.message); }
    setBusy(false);
  };

  const confirm = async () => {
    if (!cur || busy) return;
    if (missingPrices.length) {
      setToast(`Enter the invoice price for ${missingPrices.length} item${missingPrices.length === 1 ? '' : 's'} first — it's marked "?" on the order.`, null, 6000);
      return;
    }
    // The invoice number is what ties a delivery to the paper the distributor
    // sends and to the payment Accounting will chase. It was optional, and so it
    // was skipped every time: every payment on the books reads "—" in the invoice
    // column, which makes a credit impossible to reference and a bill impossible
    // to find. Required from here.
    if (!invoiceNo.trim()) {
      setToast('Enter the vendor invoice number before confirming — Accounting needs it to reference this delivery.', null, 6000);
      return;
    }
    setBusy(true);
    try {
      // the "?" lines are answered by the invoice: put the price on the catalog first,
      // so the boxes, the payment and the value are all built from the real number
      for (const [pid, raw] of Object.entries(tbdPrice)) {
        const price = parseFloat(raw);
        if (!(price > 0)) continue;
        const p = products.find((x) => x.id === pid);
        if (!p || Number(p.cost) > 0) continue;
        // Write base_cost, never cost. A database trigger recomputes
        // cost = base_cost x pack_units whenever base_cost is set, and every
        // unpriced product has base_cost 0 — so writing cost alone was undone
        // in the same statement and the invoice price silently vanished.
        // The clerk reads an ORDERED-UNIT price off the invoice; base_cost is
        // per deal, so divide by the deals in a unit.
        const units = Math.max(1, parseInt(p.pack_units) || 1);
        await store.updateProduct(pid, { base_cost: Math.round((price / units) * 100) / 100 });
      }
      const paths = [];
      for (const p of pages) paths.push(await store.uploadInvoicePhoto(p));
      const shipment = await store.createShipment({
        po_id: cur.id, invoice_no: invoiceNo.trim(), notes: '',
        invoice_photo_path: paths[0] || null, invoice_photo_paths: paths,
      });

      const receivedLines = [], missingLines = [];
      for (const l of lines) {
        const want = remainingFor(l);
        const got = Math.min(Math.max(0, parseInt(recv[l.product_id]) || 0), want);
        const serialList = (serials[l.product_id] || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
        // flip boxes on_order -> in_inventory
        const unit = l.price_tbd ? priceOf(l.product_id, l.cost) : l.cost;
        const perBox = perBoxOf(l, unit);
        const pool = boxes.filter((b) => b.po_id === cur.id && b.product_id === l.product_id && b.state === 'on_order').slice(0, got);
        for (let i = 0; i < pool.length; i++) {
          await store.updateBox(pool[i].id, {
            serial: serialList[i] || '', shipment_id: shipment.id,
            // a box carries what ONE box cost, not what the case cost
            ...(l.price_tbd ? { cost: perBox, price_tbd: false } : {}),
          });
          await store.transitionBox(pool[i].id, 'in_inventory');
        }
        // the emails count in boxes, so every per-unit figure on the line comes
        // down to the box — see logic/receiving.js, which owns that arithmetic
        const prod = products.find((p) => p.id === l.product_id);
        if (got > 0) receivedLines.push(receivedLine(l, prod, got, unit));
        const still = want - got;
        if (still > 0) missingLines.push(missingLine(l, prod, still, unit));
      }
      // items that arrived but weren't on the PO: create them straight into inventory
      for (const x of extras) {
        const n = Math.max(0, parseInt(x.qty) || 0);
        if (!n) continue;
        const sers = (x.serials || '').split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
        const unit = x.price_tbd ? priceOf(x.product_id, x.cost) : x.cost;
        const xp = products.find((p) => p.id === x.product_id);
        // `unit` is an ORDERED-UNIT price and `n` is a count of boxes, so this has
        // to be divided down exactly like a PO line. Billing the case price against
        // the tote count put a single off-PO Biker case on the invoice at $82,688.
        const row = extraLine(xp, x.name, n, unit);
        await store.createBoxes(Array.from({ length: n }, (_, i) => ({
          hall_id: hall, product_id: x.product_id, po_id: cur.id, shipment_id: shipment.id,
          serial: sers[i] || '', cost: row.cost, price_tbd: false, state: 'in_inventory',
          received_at: new Date().toISOString(),
        })));
        receivedLines.push(row);
      }
      await store.confirmShipment(shipment.id, {
        invoice_no: invoiceNo.trim(),
        boxes: receivedLines.reduce((a, l) => a + l.qty, 0),
        missing: missingLines.reduce((a, l) => a + l.qty, 0),
      });
      await store.setPoStatus(cur.id, missingLines.length ? 'partial' : 'closed');

      // build the two follow-up emails for review
      const v = vmap[cur.vendor_id];
      const emails = [];
      const sender = senderFor(settings.sender, hall);
      const acctName = settings.email?.accountingName || '';
      if (missingLines.length) emails.push(buildShortageEmail(cur, v, HALL_NAMES[hall], missingLines, sender));
      const delivered = buildDeliveredEmail(cur, v, HALL_NAMES[hall], invoiceNo, receivedLines, missingLines, sender, acctName);
      delivered.to = settings.email?.accountingAddress || '(accounting address not set)';
      emails.push(delivered);
      await store.addPayment({
        hall_id: hall, vendor_id: cur.vendor_id, po_num: cur.num,
        invoice_no: invoiceNo.trim(), amount: delivered.amount,
      });
      await reloadHall();
      await reloadCatalog();
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

  if (!cur) {
    return (
      <div>
        <div className="page-head">
          <div className="h1">Receiving — {HALL_NAMES[hall]}</div>
          <div className="grow" />
          <button className="btn primary" onClick={() => setAddDelivery(true)}
            title="Stock that arrived without going through Review & Send here">
            + Add delivery
          </button>
        </div>
        {addDelivery && <AddDelivery onClose={() => setAddDelivery(false)} />}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--border)' }}>Which order arrived?</div>
          {open.length === 0 && (
            <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">
              No orders are awaiting delivery.<br />
              <span style={{ fontSize: 12.5 }}>
                Stock can still arrive without one — use <b>Add delivery</b> above for a phoned-in
                order, a weekly drop, or anything from before this system.
              </span>
            </div>
          )}
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

        {/* Everything that has already landed. Without this the screen shows only
            what is still outstanding, so an order that arrived and closed the same
            day never appears here at all — including every delivery entered from a
            paper invoice after the fact. */}
        <div className="card" style={{ overflow: 'hidden', marginTop: 14 }}>
          <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--border)' }}>
            Received &middot; last {deliveries.length} {deliveries.length === 1 ? 'delivery' : 'deliveries'}
          </div>
          {deliveries.length === 0 && (
            <div style={{ padding: 26, textAlign: 'center' }} className="dimmer">Nothing received yet.</div>
          )}
          <table className="tbl"><tbody>
            {deliveries.map((d) => (
              <tr key={d.id}>
                <td className="first mono">{new Date(d.received_at + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}</td>
                <td>{vmap[d.vendor_id]?.name || d.vendor_id}</td>
                <td className="mono dim" style={{ fontSize: 12 }}>{d.po_ref || '—'}</td>
                <td className="dim" style={{ fontSize: 12 }}>{d.invoice_no ? `inv ${d.invoice_no}` : ''}</td>
                <td className="r mono last">{d.boxes || 0} {d.boxes === 1 ? 'box' : 'boxes'}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div className="h1">Receiving — <span className="mono">{cur.num}</span> ({vmap[cur.vendor_id]?.name})</div>
        <div className="grow" />
        <form onSubmit={(e) => { e.preventDefault(); const c = manualCode.trim(); setManualCode(''); if (c) handleScan(c); }}
              style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input ref={scanBoxRef} type="text" data-scan-target="1" value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="Scan or type a box serial…"
            style={{ width: 230, borderColor: 'var(--green)', fontFamily: "'IBM Plex Mono',monospace" }} />
          <span className="scan-ind on"><span className="dot" />{scanCount} scanned</span>
        </form>
        <button className="btn ghost" onClick={() => setReceivingPo(null)}>← Different order</button>
      </div>
      <div className="card pad" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Vendor invoice # <span style={{ color: 'var(--orange)' }}>*</span></label>
            <input type="text" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)}
              className={invoiceNo.trim() ? '' : 'needs-update'}
              placeholder="from the paper"
              title="Required. Accounting quotes this when chasing a credit or matching a bill."
              style={{ width: 160 }} /></div>
          <div className="field" style={{ margin: 0 }}><label>Invoice pages — add as many as the invoice has</label>
            <input type="file" accept="image/*" capture="environment" multiple
              onChange={(e) => { setPages((p) => [...p, ...Array.from(e.target.files || [])]); e.target.value = ''; }} /></div>
          <button className="btn primary" disabled={busy || !pages.length} onClick={aiRead}>
            {busy ? 'Reading…' : pages.length ? `🤖 Read ${pages.length} page${pages.length === 1 ? '' : 's'}` : '🤖 Read invoice'}
          </button>
        </div>
        {pages.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {pages.map((p, i) => (
              <span key={i} className="badge b-teal" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                Page {i + 1}: {p.name.length > 22 ? p.name.slice(0, 22) + '…' : p.name}
                <span style={{ cursor: 'pointer', fontWeight: 700 }}
                  onClick={() => setPages((prev) => prev.filter((_, j) => j !== i))}>×</span>
              </span>
            ))}
            <span className="dimmer" style={{ fontSize: 11.5 }}>All pages are saved with the shipment.</span>
          </div>
        )}
        {aiNote && <p className="muted-note" style={{ marginTop: 8 }}>{aiNote}</p>}
      </div>
      <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
        <table className="tbl">
          <thead><tr>
            <th className="first">Ordered item</th><th className="r">Ordered</th><th className="r">Still expected</th>
            <th className="r" style={{ width: 120 }}>Unit price</th>
            <th style={{ width: 110 }}>Received now</th><th className="last">Box serials (comma-separated, optional)</th>
          </tr></thead>
          <tbody>
            {lines.map((l) => {
              const rem = remainingFor(l);
              return (
                <tr key={l.id} style={rem === 0 ? { opacity: 0.5 } : {}}>
                  <td className="first" style={{ whiteSpace: 'pre-line' }}>{l.name_snapshot}</td>
                  <td className="r mono">{l.qty}</td>
                  <td className="r mono">{rem}</td>
                  <td className="r mono">
                    {l.price_tbd
                      ? <input className="num needs-update" type="number" min="0" step="0.01" style={{ width: 92 }}
                          placeholder="from invoice" title="This went out as ? — put the price from the invoice here"
                          value={tbdPrice[l.product_id] ?? ''} disabled={rem === 0}
                          onChange={(e) => setTbdPrice({ ...tbdPrice, [l.product_id]: e.target.value })} />
                      : fmtMoney(l.cost)}
                  </td>
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
      {missingPrices.length > 0 && (
        <div className="demo-banner">
          <b>{missingPrices.length} item{missingPrices.length === 1 ? '' : 's'} still need{missingPrices.length === 1 ? 's' : ''} a price from the invoice.</b>{' '}
          {missingPrices.length === 1 ? 'It' : 'They'} went out on the PO as “?”. Enter what the invoice says and it'll be
          saved to the catalog, the boxes and the amount accounting is told to pay.
        </div>
      )}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <b style={{ fontSize: 13 }}>Also arrived — not on this order</b>
          <span className="dimmer" style={{ fontSize: 12 }}>Type the game and how many boxes. These go straight into inventory and onto the amount to pay.</span>
          <div style={{ flex: 1 }} />
          <form onSubmit={(e) => { e.preventDefault(); commitManualAdd(); }}
                style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div className="field" style={{ margin: 0, position: 'relative' }}>
              <label>Game name</label>
              <input ref={addNameRef} type="text" placeholder="Type a game name…" value={addQuery}
                onChange={(e) => { setAddQuery(e.target.value); setAddPick(null); }}
                style={{ width: 240, borderColor: addPick ? 'var(--green)' : undefined }} />
              {!addPick && addQuery.trim().length >= 2 && (
                <div className="card" style={{ position: 'absolute', top: 56, left: 0, width: 340, zIndex: 60, maxHeight: 250, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}>
                  {matchingProducts.length === 0 && <div style={{ padding: 12 }} className="dimmer">No game matches “{addQuery}”.</div>}
                  {matchingProducts.map((p) => (
                    <div key={p.id} onClick={() => { setAddPick(p); setAddQuery(p.name); }}
                      style={{ padding: '7px 12px', borderBottom: '1px solid var(--border-lt)', fontSize: 12.5,
                               cursor: 'pointer' }}>
                      <b>{p.name}</b>
                      <span className="dimmer"> · {vmap[p.vendor_id]?.name} · {needsSetup(p) ? '' : fmtMoney(p.cost)}</span>
                      {needsSetup(p) && <span className="badge b-gold" style={{ marginLeft: 6 }}>price from invoice</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label># of boxes</label>
              <input className="num" type="number" min="1" value={addQty}
                onChange={(e) => setAddQty(e.target.value)} style={{ width: 90 }} />
            </div>
            <button className="btn green" type="submit">+ Add</button>
          </form>
        </div>
        {extras.length === 0
          ? <div style={{ padding: '14px 16px' }} className="dimmer">Nothing extra yet.</div>
          : (
            <table className="tbl">
              <thead><tr>
                <th className="first">Game</th><th className="r">Unit cost</th>
                <th style={{ width: 110 }}>Received</th><th>Box serials</th><th className="last" style={{ width: 60 }} />
              </tr></thead>
              <tbody>
                {extras.map((x) => (
                  <tr key={x.key}>
                    <td className="first">{x.name}</td>
                    <td className="r mono">
                      {x.price_tbd
                        ? <input className="num needs-update" type="number" min="0" step="0.01" style={{ width: 92 }}
                            placeholder="from invoice" title="We have no price for this one — put the invoice price here"
                            value={tbdPrice[x.product_id] ?? ''}
                            onChange={(e) => setTbdPrice({ ...tbdPrice, [x.product_id]: e.target.value })} />
                        : fmtMoney(x.cost)}
                    </td>
                    <td>
                      <input className="qty" type="number" min="0" value={x.qty}
                        onChange={(e) => setExtras((prev) => prev.map((y) => y.key === x.key ? { ...y, qty: Math.max(0, parseInt(e.target.value) || 0) } : y))} />
                    </td>
                    <td>
                      <input className="cell mono" type="text" style={{ fontSize: 11.5 }} placeholder="optional"
                        value={x.serials}
                        onChange={(e) => setExtras((prev) => prev.map((y) => y.key === x.key ? { ...y, serials: e.target.value } : y))} />
                    </td>
                    <td className="last r">
                      <button className="btn ghost sm" onClick={() => setExtras((prev) => prev.filter((y) => y.key !== x.key))}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
                <span style={{ whiteSpace: 'pre-line' }}>{l.name_snapshot}</span> <span className="dimmer">({remainingFor(l)} expected)</span>
              </button>
            ))}
            {lines.every((l) => remainingFor(l) === 0) && <p className="dimmer" style={{ marginBottom: 8 }}>Nothing left expected on this order.</p>}
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Not on this order? Find the game by name:</label>
                <input type="text" placeholder="Type a game name…" value={addQuery} autoFocus={false}
                  onChange={(e) => setAddQuery(e.target.value)} style={{ width: '100%' }} />
              </div>
              {addQuery.trim().length >= 2 && (
                <div style={{ maxHeight: 170, overflowY: 'auto', marginTop: 6 }}>
                  {matchingProducts.map((p) => (
                    <div key={p.id} onClick={() => { addExtra(p, pendingScan, 1); setPendingScan(null); }}
                      style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-lt)', cursor: 'pointer', fontSize: 12.5 }}>
                      <b>{p.name}</b><span className="dimmer"> · {fmtMoney(p.cost)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => { setPendingScan(null); setAddQuery(''); }}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn green" disabled={busy || missingPrices.length > 0} onClick={confirm}
          title={missingPrices.length ? 'Enter the invoice price for the "?" items first' : ''}>
          {busy ? 'Confirming…'
            : missingPrices.length ? `Enter ${missingPrices.length} price${missingPrices.length === 1 ? '' : 's'} first`
            : '✓ Confirm shipment & update inventory'}
        </button>
        <span className="muted-note">
          Anything "still expected" but not received is flagged missing → shortage email + short-pay note to accounting.
          {extras.length > 0 && ` ${extras.reduce((a, x) => a + (parseInt(x.qty) || 0), 0)} extra box(es) will be added to inventory and to the amount to pay.`}
        </span>
      </div>
    </div>
  );
}
