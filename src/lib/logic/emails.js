// Email templates — pure functions returning {kind, to, subject, body}.
// Sending happens elsewhere (edge function in production, log-only in demo).
//
// These are written to read like a person wrote them, because a person is
// accountable for them. Every email opens with the recipient's name, explains
// the situation in plain sentences, makes one clear ask, and is signed by a
// named human (configured in Settings → Sender identity).

import { fmtMoney } from './po.js';

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
  const packing = Number(l.packing_each) || 0;
  const units = Math.max(1, parseInt(l.pack_units) || 1);
  const base = l.base_cost != null ? Number(l.base_cost) : Number(l.cost) || 0;
  const total = l.price_tbd ? '?' : money(l.qty * (Number(l.cost) + packing));
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

function lineHeader(w) {
  return [
    ' Qty', '   ', 'Item'.padEnd(w.name),
    'Base'.padStart(w.base), 'Units'.padStart(w.units),
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

function poBody(po, vendor, hallName, hallAddress, sender) {
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
  return [
    greet(vendor.contact_name),
    ``,
    `Here's our next order for ${hallName}. Purchase order number is ${po.num}.`,
    n ? `` : null,
    n ? `Items below marked with a ? we don't have a current price. If you could send over pricing, we will update and resend same PO with those details.` : null,
    ``,
    lineHeader(w),
    '-'.repeat(4 + 3 + w.name + w.base + w.units + w.pack + w.total),
    ...po.lines.map((l) => lineRow(l, w)),
    '-'.repeat(4 + 3 + w.name + w.base + w.units + w.pack + w.total),
    ``,
    // split the subtotal so both sides can see what was goods and what was packing
    anyPacking ? `  ${'Stock:'.padEnd(20)}${fmtMoney(goodsTotal).padStart(12)}` : null,
    anyPacking ? `  ${'Packing:'.padEnd(20)}${fmtMoney(packingTotal).padStart(12)}` : null,
    `  ${'Subtotal:'.padEnd(20)}${fmtMoney(po.subtotal).padStart(12)}`,
    `  ${`Tax (${(vendor.tax_rate * 100).toFixed(2)}%):`.padEnd(20)}${fmtMoney(po.tax).padStart(12)}`,
    `  ${'Total:'.padEnd(20)}${fmtMoney(po.total).padStart(12)}`,
    n ? `  (covers the priced lines only — the "?" items are on top of this)` : null,
    anyPacking ? `  Packing is included in each line above, not added separately.` : null,
    ``,
    address ? `Please deliver to:\n${address}\n` : null,
    `Could you confirm you got this and let me know when it should arrive? Please put ${po.num} on the invoice so we can match it up when it lands.`,
    `Ordered ${date}.`,
    ...signature(sender, hallName),
  ].filter((l) => l !== null).join('\n');
}

/**
 * The order run's emails: one PO per vendor (up to 4).
 * Accounting is intentionally NOT copied on POs — they receive the delivered-$ email at
 * receiving time, which states what to actually pay. The CC address (Settings) still gets
 * a copy of everything for oversight.
 */
export function buildOrderEmails(pos, vendors, hallName, hallAddress, _accountingAddress, sender = {}) {
  const vmap = Object.fromEntries(vendors.map((v) => [v.id, v]));
  const out = [];
  for (const po of pos) {
    const v = vmap[po.vendor_id];
    out.push({
      kind: 'po', po_num: po.num, to: v.email,
      subject: `${hallName} order — PO ${po.num}`,
      body: poBody(po, v, hallName, hallAddress, sender),
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

export function buildShortageEmail(po, vendor, hallName, missingLines, sender = {}) {
  const value = missingLines.reduce((a, l) => a + l.qty * l.cost, 0);
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
  const received = receivedLines.reduce((a, l) => a + l.qty * l.cost, 0);
  const tax = Math.round(received * vendor.tax_rate * 100) / 100;
  const owed = Math.round((received + tax) * 100) / 100;
  const variance = Math.round((po.total - owed) * 100) / 100;
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
