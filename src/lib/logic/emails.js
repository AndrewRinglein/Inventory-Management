// Email templates — pure functions returning {kind, to, subject, body}.
// Sending happens elsewhere (edge function in production, log-only in demo).
//
// These are written to read like a person wrote them, because a person is
// accountable for them. Every email opens with the recipient's name, explains
// the situation in plain sentences, makes one clear ask, and is signed by a
// named human (configured in Settings → Sender identity).

import { fmtMoney, round2 } from './po.js';

/**
 * Each hall has its own person on the emails (Sagit for SC, Shelly for RWC).
 * Accepts either the hall-keyed shape { sc: {...}, rwc: {...} } or the older
 * flat { name, org, ... }, which applies to every hall.
 */
export function senderFor(sender, hallId) {
  if (!sender || typeof sender !== 'object') return {};
  if (sender.name || sender.org) return sender;          // legacy flat shape
  return sender[hallId] || sender.default || {};
}

/** "Sagit" / "Sagit — Vanguard" for signatures and the From display name. */
export function senderLabel(sender = {}) {
  const name = (sender.name || '').trim();
  const org = (sender.org || '').trim();
  if (name && org) return `${name} — ${org}`;
  return name || org || '';
}

function signature(sender = {}, hallName) {
  const out = ['', 'Thanks,', (sender.name || '').trim() || 'The inventory team'];
  const orgLine = [sender.title, sender.org].filter(Boolean).join(', ');
  if (orgLine) out.push(orgLine);
  if (hallName) out.push(hallName);
  if (sender.phone) out.push(sender.phone);
  return out;
}

const greet = (name) => (name ? `Hi ${name},` : 'Hello,');

/**
 * A PO line, printed as the parts it is actually made of:
 *
 *     1 x 10-Pack of strips Biker Double up   $64.00  x80   $320.00   $5,440.00
 *
 * base cost, units in the box, packing on that box, and what the line comes to.
 * Packing sits on the line that earned it rather than as a lump at the bottom —
 * a single "97 units of packing" figure tells nobody what one box really costs,
 * and it is the per-box number a vendor and a hall need to agree on.
 */
const money = (n) => fmtMoney(n);

/**
 * Simpler row for the shortage and delivered-$ emails. Those are about what
 * arrived and what to pay, not how a price is built, so they keep the plain
 * quantity-and-money shape. Packing rides along in the line total.
 */
const line = (l) => {
  const each = Number(l.cost) + (Number(l.packing_each) || 0);
  return `  ${String(l.qty).padStart(3)} x ${l.name_snapshot.padEnd(40)}  ${fmtMoney(each).padStart(10)} ea  =${fmtMoney(l.qty * each).padStart(12)}`;
};

function lineRow(l, w) {
  const packEach = Number(l.packing_each) || 0;
  const units = Math.max(1, parseInt(l.pack_units) || 1);
  const base = l.base_cost != null ? Number(l.base_cost) : Number(l.cost) || 0;
  // every money column on the row is extended for the quantity, so the row adds
  // up as written: base x units x qty, plus packing, equals the line total
  const packing = packEach * l.qty;
  const total = l.price_tbd ? '?' : money(l.qty * (Number(l.cost) + packEach));
  return [
    String(l.qty).padStart(4),
    ' x ',
    l.name_snapshot.padEnd(w.name),
    (l.price_tbd ? '?' : money(base)).padStart(w.base),
    (units > 1 ? `x${units}` : '').padStart(w.units),
    (packing > 0 ? money(packing) : '').padStart(w.pack),
    total.padStart(w.total),
  ].join('');
}

// "Unit" is what gets ordered and invoiced — a box, a set, a case. "Deals" is how
// many priceable pieces are inside one unit, which is what the base price is quoted
// against. A dauber is $19 per deal, 1 deal per unit; a Biker case is $64.60 per
// deal, 80 deals per unit. Both sides of an invoice mean the same thing by these.
function lineHeader(w) {
  return [
    'Unit', '   ', 'Item'.padEnd(w.name),
    'Base'.padStart(w.base), 'Deals'.padStart(w.units),
    'Packing'.padStart(w.pack), 'Line total'.padStart(w.total),
  ].join('');
}

/** Column widths sized to the content, so nothing is cut and nothing floats. */
function widths(lines) {
  return {
    name: Math.max(20, ...lines.map((l) => l.name_snapshot.length)) + 2,
    base: 12, units: 7, pack: 11, total: 14,
  };
}

/**
 * Wording on the PO that a person may want to change without a code push.
 * Settings → PO email overrides any of these; blank falls back to the default.
 * `note` is extra wording that only appears if it has been written.
 */
export const PO_TEXT_DEFAULTS = {
  intro: `Here's our next order for {hall}. Purchase order number is {po}.`,
  tbdNote: `Items below marked with a ? we don't have a current price. If you could send over pricing, we will update and resend same PO with those details.`,
  note: ``,
  closing: `Could you confirm you got this and let me know when it should arrive? Please put {po} on the invoice so we can match it up when it lands.`,
};

const fill = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));

/** Chosen text for one field: a non-blank override, else the default. */
const pick = (text, key) => {
  const v = (text?.[key] ?? '').trim();
  return v || PO_TEXT_DEFAULTS[key];
};

/**
 * "Tax (9.75%)" normally, "Tax (9.75% on stock)" once packing is in the mix.
 *
 * Without the qualifier the figure looks like an arithmetic error to anyone
 * checking it against the subtotal, because it no longer is that percentage of
 * the subtotal — packing and collation are a service and aren't taxed.
 */
const taxLabel = (vendor, qualify) =>
  `Tax (${(Number(vendor?.tax_rate) * 100 || 0).toFixed(2)}%${qualify ? ' on taxable stock' : ''}):`;

function poBody(po, vendor, hallName, hallAddress, sender, text = {}) {
  // hallAddress may be a plain string or a resolver, because a hall can send
  // different vendors to different doors (see logic/halls.js)
  const address = typeof hallAddress === 'function' ? hallAddress(vendor.id) : hallAddress;
  const date = new Date(po.sent_at || Date.now()).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
  const open = po.lines.filter((l) => l.price_tbd);
  const n = open.length;
  const w = widths(po.lines);
  const anyPacking = po.lines.some((l) => (Number(l.packing_each) || 0) > 0);
  const priced = po.lines.filter((l) => !l.price_tbd);
  const goodsTotal = priced.reduce((a, l) => a + l.qty * Number(l.cost), 0);
  const packingTotal = priced.reduce((a, l) => a + l.qty * (Number(l.packing_each) || 0), 0);
  const exemptTotal = priced.filter((l) => l.taxable === false)
    .reduce((a, l) => a + l.qty * Number(l.cost), 0);
  // the tax stops being a checkable percentage of the subtotal once either of
  // these is in play, so the label has to say what it IS a percentage of
  const qualifyTax = anyPacking || exemptTotal > 0;
  const vars = { hall: hallName, po: po.num, vendor: vendor.name, date };
  const extra = (text?.note ?? '').trim();
  return [
    greet(vendor.contact_name),
    ``,
    fill(pick(text, 'intro'), vars),
    n ? `` : null,
    n ? fill(pick(text, 'tbdNote'), vars) : null,
    extra ? `` : null,
    extra ? fill(extra, vars) : null,
    ``,
    lineHeader(w),
    '-'.repeat(4 + 3 + w.name + w.base + w.units + w.pack + w.total),
    ...po.lines.map((l) => lineRow(l, w)),
    '-'.repeat(4 + 3 + w.name + w.base + w.units + w.pack + w.total),
    ``,
    // split the subtotal so both sides can see what was goods and what was packing
    anyPacking ? `  ${'Stock:'.padEnd(20)}${fmtMoney(goodsTotal).padStart(12)}` : null,
    anyPacking ? `  ${'Packing:'.padEnd(20)}${fmtMoney(packingTotal).padStart(12)}` : null,
    exemptTotal > 0 ? `  ${'Of which exempt:'.padEnd(20)}${fmtMoney(exemptTotal).padStart(12)}` : null,
    `  ${'Subtotal:'.padEnd(20)}${fmtMoney(po.subtotal).padStart(12)}`,
    `  ${taxLabel(vendor, qualifyTax).padEnd(20)}${fmtMoney(po.tax).padStart(12)}`,
    `  ${'Total:'.padEnd(20)}${fmtMoney(po.total).padStart(12)}`,
    n ? `  (covers the priced lines only — the "?" items are on top of this)` : null,
    anyPacking ? `  Packing is included in each line above, not added separately, and is not taxed.` : null,
    ``,
    address ? `Please deliver to:\n${address}\n` : null,
    fill(pick(text, 'closing'), vars),
    `Ordered ${date}.`,
    ...signature(sender, hallName),
  ].filter((l) => l !== null).join('\n');
}

// ---------------------------------------------------------------------------
// HTML version of the PO.
//
// The plain-text table is 86 characters wide, which is fine in a mail client on a
// desk and unreadable on a phone — it wraps mid-row and the columns stop lining up.
// So the PO goes out as both: this HTML part, and the text above as the fallback
// for anyone whose client won't render it. Same wording, same figures, same order.
//
// On a wide screen it's the same six-column table. Under 560px the three
// price-breakdown columns drop out and their content reappears as a line under the
// item name, leaving units / item / total — which is what someone approving an
// order on their phone actually reads. Nothing is hidden, only re-stacked.

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Print rules for the same document.
 *
 * The PO is already a self-contained HTML page, so printing it is a matter of
 * taking the screen chrome off rather than building a second layout: drop the
 * grey page background and the card's border and shadow, keep the table from
 * breaking a row across a page, and repeat the header row on every sheet so page
 * two is still readable on its own.
 */
const PO_PRINT_CSS = `
  @media print{
    @page{margin:14mm;}
    body{background:#fff;}
    .wrap{max-width:none;margin:0;padding:0;}
    .card{border:0;border-radius:0;padding:0;box-shadow:none;}
    table.lines{page-break-inside:auto;}
    table.lines tr{page-break-inside:avoid;page-break-after:auto;}
    table.lines thead{display:table-header-group;}
    table.totals{page-break-inside:avoid;}
    .hide-sm{display:table-cell !important;}
    .detail{display:none !important;}
    a{text-decoration:none;color:inherit;}
    .print-head{display:block !important;}
  }
  .print-head{display:none;border-bottom:2px solid #1d2327;padding-bottom:8px;margin-bottom:16px;}
  .print-head .t{font-size:19px;font-weight:700;letter-spacing:.02em;}
  .print-head .m{font-size:12.5px;color:#5c6670;margin-top:3px;}`;

const PO_CSS = `
  body{margin:0;padding:0;background:#f4f5f6;}
  .wrap{max-width:680px;margin:0 auto;padding:20px 16px 32px;}
  .card{background:#fff;border:1px solid #e2e5e8;border-radius:8px;padding:22px 24px;}
  body,p,td,th,div{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
    font-size:15px;line-height:1.5;color:#1d2327;}
  p{margin:0 0 14px;}
  .num{font-family:'SF Mono',Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;white-space:nowrap;}
  table.lines{width:100%;border-collapse:collapse;margin:18px 0 4px;}
  table.lines th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#6b7378;
    text-align:right;padding:0 0 6px;border-bottom:1px solid #d8dcdf;font-weight:600;}
  table.lines th.l,table.lines td.l{text-align:left;padding-right:12px;}
  table.lines td{padding:9px 0;border-bottom:1px solid #eef0f2;vertical-align:top;}
  table.lines td.l{padding-right:12px;}
  th+th,td+td{padding-left:14px;}
  .detail{display:none;font-size:13px;color:#6b7378;}
  .tbd{color:#9a6b00;font-weight:700;}
  .totals{margin:16px 0 0;width:100%;}
  .totals td{padding:3px 0;font-size:14px;}
  .totals td.k{color:#5a6167;}
  .totals td.v{text-align:right;}
  .totals tr.grand td{font-weight:700;font-size:16px;padding-top:8px;border-top:1px solid #d8dcdf;}
  .addr{background:#f7f8f9;border-left:3px solid #c9ced2;padding:10px 14px;margin:18px 0;}
  .foot{font-size:13px;color:#6b7378;}
  @media only screen and (max-width:560px){
    .wrap{padding:10px 8px 24px;} .card{padding:16px 14px;border-radius:6px;}
    .hide-sm{display:none !important;}
    .detail{display:block;margin-top:3px;}
    table.lines td{padding:11px 0;}
  }
`;

export function poHtml(po, vendor, hallName, hallAddress, sender, text = {}) {
  const address = typeof hallAddress === 'function' ? hallAddress(vendor.id) : hallAddress;
  const date = new Date(po.sent_at || Date.now()).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
  const vars = { hall: hallName, po: po.num, vendor: vendor.name, date };
  const n = po.lines.filter((l) => l.price_tbd).length;
  const extra = (text?.note ?? '').trim();
  const anyPacking = po.lines.some((l) => (Number(l.packing_each) || 0) > 0);
  const priced = po.lines.filter((l) => !l.price_tbd);
  const goodsTotal = priced.reduce((a, l) => a + l.qty * Number(l.cost), 0);
  const packingTotal = priced.reduce((a, l) => a + l.qty * (Number(l.packing_each) || 0), 0);
  const exemptTotal = priced.filter((l) => l.taxable === false)
    .reduce((a, l) => a + l.qty * Number(l.cost), 0);
  // the tax stops being a checkable percentage of the subtotal once either of
  // these is in play, so the label has to say what it IS a percentage of
  const qualifyTax = anyPacking || exemptTotal > 0;

  const row = (l) => {
    const packEach = Number(l.packing_each) || 0;
    const deals = Math.max(1, parseInt(l.pack_units) || 1);
    const base = l.base_cost != null ? Number(l.base_cost) : Number(l.cost) || 0;
    const packing = packEach * l.qty;
    const tbd = '<span class="tbd">?</span>';
    // the same breakdown the wide columns show, written as a sentence for narrow screens
    const detail = l.price_tbd
      ? 'price to be confirmed'
      : [`${money(base)} each`, deals > 1 ? `× ${deals} deals` : null,
         packing > 0 ? `+ ${money(packing)} packing` : null].filter(Boolean).join(' ');
    return `<tr>
      <td class="num l">${l.qty}</td>
      <td class="l">${esc(l.name_snapshot)}<span class="detail">${detail}</span></td>
      <td class="num hide-sm">${l.price_tbd ? tbd : money(base)}</td>
      <td class="num hide-sm">${deals > 1 ? '&times;' + deals : ''}</td>
      <td class="num hide-sm">${packing > 0 ? money(packing) : ''}</td>
      <td class="num"><strong>${l.price_tbd ? tbd : money(l.qty * (Number(l.cost) + packEach))}</strong></td>
    </tr>`;
  };
  const totalRow = (k, v, cls = '') => `<tr class="${cls}"><td class="k">${k}</td><td class="v num">${v}</td></tr>`;

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(po.num)}</title><style>${PO_CSS}${PO_PRINT_CSS}</style></head>
<body><div class="wrap"><div class="card">
<div class="print-head">
  <div class="t">Purchase Order ${esc(po.num)}</div>
  <div class="m">${esc(hallName)} &nbsp;&middot;&nbsp; ${esc(vendor.name)} &nbsp;&middot;&nbsp; ${esc(date)}</div>
</div>
<p>${esc(greet(vendor.contact_name))}</p>
<p>${esc(fill(pick(text, 'intro'), vars))}</p>
${n ? `<p>${esc(fill(pick(text, 'tbdNote'), vars))}</p>` : ''}
${extra ? `<p>${esc(fill(extra, vars))}</p>` : ''}
<table class="lines" role="presentation">
<thead><tr>
  <th class="l">Unit</th><th class="l">Item</th>
  <th class="hide-sm">Base</th><th class="hide-sm">Deals</th>
  <th class="hide-sm">Packing</th><th>Line total</th>
</tr></thead>
<tbody>${po.lines.map(row).join('')}</tbody></table>
<table class="totals" role="presentation"><tbody>
${anyPacking ? totalRow('Stock', fmtMoney(goodsTotal)) : ''}
${anyPacking ? totalRow('Packing', fmtMoney(packingTotal)) : ''}
${exemptTotal > 0 ? totalRow('Of which exempt', fmtMoney(exemptTotal)) : ''}
${totalRow('Subtotal', fmtMoney(po.subtotal))}
${totalRow(taxLabel(vendor, qualifyTax).replace(/:$/, ''), fmtMoney(po.tax))}
${totalRow('Total', fmtMoney(po.total), 'grand')}
</tbody></table>
${n ? `<p class="foot">Covers the priced lines only — the &ldquo;?&rdquo; items are on top of this.</p>` : ''}
${anyPacking ? `<p class="foot">Packing is included in each line above, not added separately, and is not taxed.</p>` : ''}
${address ? `<div class="addr"><strong>Please deliver to:</strong><br>${esc(address).replace(/\n/g, '<br>')}</div>` : ''}
<p>${esc(fill(pick(text, 'closing'), vars))}</p>
<p class="foot">Ordered ${esc(date)}.</p>
<p>${signature(sender, hallName).filter(Boolean).map(esc).join('<br>')}</p>
</div></div></body></html>`;
}

/**
 * The order run's emails: one PO per vendor (up to 4).
 * Accounting is intentionally NOT copied on POs — they receive the delivered-$ email at
 * receiving time, which states what to actually pay. The CC address (Settings) still gets
 * a copy of everything for oversight.
 */
export function buildOrderEmails(pos, vendors, hallName, hallAddress, _accountingAddress, sender = {}, text = {}) {
  const vmap = Object.fromEntries(vendors.map((v) => [v.id, v]));
  const out = [];
  for (const po of pos) {
    const v = vmap[po.vendor_id];
    const subject = (text?.subject ?? '').trim();
    out.push({
      kind: 'po', po_num: po.num, to: v.email,
      subject: subject
        ? fill(subject, { hall: hallName, po: po.num, vendor: v.name })
        : `${hallName} order — PO ${po.num}`,
      body: poBody(po, v, hallName, hallAddress, sender, text),
      html: poHtml(po, v, hallName, hallAddress, sender, text),
    });
  }
  return out;
}

/**
 * Ask a distributor to confirm current pricing and ticket counts on specific games.
 *
 * Sent when our own record has gaps — a game that came off a paper count sheet with
 * no price, or one we've never had a ticket count for. It asks for exactly what's
 * missing on each line rather than dumping the whole catalog on them, because a
 * short, specific question gets answered and a long vague one doesn't.
 *
 * `items` are { name, ask: ['price'|'tickets'|'type'], cost, tickets } — `ask` says
 * what we're missing; anything we already hold is quoted back so they can correct it.
 */
export function buildPriceRequestEmail(vendor, hallName, items, sender = {}, note = '') {
  const width = Math.min(42, Math.max(18, ...items.map((i) => i.name.length)));
  const askLabel = (ask) => {
    const parts = [];
    if (ask.includes('price')) parts.push('price');
    if (ask.includes('tickets')) parts.push('tickets per box');
    if (ask.includes('type')) parts.push('flash / strip / paper?');
    return parts.join(' + ');
  };
  const row = (i) => {
    const have = [
      !i.ask.includes('price') && i.cost > 0 ? `we have ${fmtMoney(i.cost)}` : null,
      !i.ask.includes('tickets') && i.tickets > 0 ? `${i.tickets.toLocaleString()} tickets` : null,
    ].filter(Boolean).join(', ');
    return `  ${i.name.padEnd(width).slice(0, width)}   ${askLabel(i.ask)}${have ? `   (${have})` : ''}`;
  };

  const onlyPrice = items.every((i) => i.ask.length === 1 && i.ask[0] === 'price');
  const onlyTix = items.every((i) => i.ask.length === 1 && i.ask[0] === 'tickets');
  const what = onlyPrice ? 'current pricing' : onlyTix ? 'the ticket count per box' : 'current pricing and ticket counts';
  const n = items.length;

  return {
    kind: 'price_request', to: vendor.email,
    vendor_id: vendor.id, vendor_name: vendor.name,
    subject: `Quick question — ${what} on ${n} game${n === 1 ? '' : 's'} (${hallName})`,
    body: [
      greet(vendor.contact_name),
      ``,
      `I'm bringing our ${hallName} records up to date and I'm missing ${what} on a few of the games we carry from you. Whenever you get a minute, could you fill in the blanks below?`,
      ``,
      ...items.map(row),
      ``,
      note.trim() ? `${note.trim()}\n` : null,
      `No rush at all — replying straight to this email is fine, or send over your current price list and I'll pull it from there.`,
      `Thanks for the help, it saves me guessing.`,
      ...signature(sender, hallName),
    ].filter((l) => l !== null).join('\n'),
  };
}

/** One email per vendor, for the games selected across all of them. */
export function buildPriceRequests(items, vendors, hallName, sender = {}, note = '') {
  const vmap = Object.fromEntries(vendors.map((v) => [v.id, v]));
  const byVendor = {};
  for (const i of items) (byVendor[i.vendor_id] ||= []).push(i);
  return Object.entries(byVendor)
    .filter(([vid]) => vmap[vid])
    .map(([vid, list]) => buildPriceRequestEmail(
      vmap[vid], hallName,
      [...list].sort((a, b) => a.name.localeCompare(b.name)),
      sender, note,
    ));
}

// Money here must match what line() prints, which is cost + packing, extended by
// qty. Summing cost alone told accounting to pay less than the rows above it added
// up to — and that figure is written straight into payments.amount.
const lineTotal = (l) => l.qty * ((Number(l.cost) || 0) + (Number(l.packing_each) || 0));

export function buildShortageEmail(po, vendor, hallName, missingLines, sender = {}) {
  const value = round2(missingLines.reduce((a, l) => a + lineTotal(l), 0));
  const n = missingLines.reduce((a, l) => a + l.qty, 0);
  return {
    kind: 'shortage', po_num: po.num, to: vendor.email,
    subject: `Missing items from PO ${po.num} — ${hallName}`,
    body: [
      greet(vendor.contact_name),
      ``,
      `Thanks for the delivery on ${po.num}. When we checked everything in, ${n === 1 ? 'one item was' : `${n} items were`} missing from the shipment:`,
      ``,
      ...missingLines.map(line),
      ``,
      `  ${'Missing value:'.padEnd(20)}${fmtMoney(value).padStart(11)}`,
      ``,
      `Could you let me know whether ${n === 1 ? "it's" : "they're"} coming as a backorder, or if we should expect a credit instead? We've only recorded what actually arrived on our end.`,
      ...signature(sender, hallName),
    ].join('\n'),
  };
}

export function buildDeliveredEmail(po, vendor, hallName, invoiceNo, receivedLines, missingLines, sender = {}, accountingName = '') {
  const received = round2(receivedLines.reduce((a, l) => a + lineTotal(l), 0));
  const tax = round2(received * (Number(vendor.tax_rate) || 0));
  const owed = round2(received + tax);
  const variance = round2((Number(po.total) || 0) - owed);
  const short = missingLines.length > 0;

  return {
    kind: 'delivered', po_num: po.num, to: '(accounting)',
    subject: short
      ? `Pay ${fmtMoney(owed)} — PO ${po.num} (${vendor.name}) — short delivery`
      : `Pay ${fmtMoney(owed)} — PO ${po.num} (${vendor.name})`,
    body: [
      greet(accountingName),
      ``,
      `The order from ${vendor.name} for ${hallName} came in${invoiceNo ? ` on invoice ${invoiceNo}` : ''}.`,
      short
        ? `Part of it was short, so the amount to pay is less than the original PO. Please pay ${fmtMoney(owed)} — not the PO total.`
        : `Everything we ordered arrived. The amount to pay is ${fmtMoney(owed)}.`,
      ``,
      `What arrived:`,
      ...receivedLines.filter((l) => !l.extra).map(line),
      ...(receivedLines.some((l) => l.extra) ? [
        ``,
        `Also on the truck (not on the original PO — please include these):`,
        ...receivedLines.filter((l) => l.extra).map(line),
      ] : []),
      ...(short ? [
        ``,
        `NOT delivered — please don't pay for these:`,
        ...missingLines.map(line),
      ] : []),
      ``,
      `  ${'Received subtotal:'.padEnd(20)}${fmtMoney(received).padStart(11)}`,
      `  ${`Tax (${(vendor.tax_rate * 100).toFixed(2)}%):`.padEnd(20)}${fmtMoney(tax).padStart(11)}`,
      `  ${'AMOUNT TO PAY:'.padEnd(20)}${fmtMoney(owed).padStart(11)}`,
      ``,
      `  ${'Original PO total:'.padEnd(20)}${fmtMoney(po.total).padStart(11)}`,
      `  ${'Difference:'.padEnd(20)}${fmtMoney(variance).padStart(11)}${variance !== 0 ? '   <- worth a look before paying' : ''}`,
      ``,
      short
        ? `I've asked ${vendor.contact_name || vendor.name} about the missing items and will let you know whether they're backordered or credited.`
        : `Nothing outstanding on this one.`,
      ...signature(sender, hallName),
    ].join('\n'),
    amount: owed,
  };
}
