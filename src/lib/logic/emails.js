// Email template builders — pure functions returning {kind, to, subject, body}.
// Sending happens elsewhere (edge function in production, log-only in demo).

import { fmtMoney } from './po.js';

const line = (l) => `  ${String(l.qty).padStart(3)} x ${l.name_snapshot.padEnd(48)} @ ${fmtMoney(l.cost).padStart(9)}  =  ${fmtMoney(l.qty * l.cost).padStart(10)}`;

function poBody(po, vendor, hallName, hallAddress) {
  return [
    `PURCHASE ORDER ${po.num}`,
    `Date: ${new Date(po.sent_at || Date.now()).toLocaleDateString('en-US')}`,
    ``,
    `From:  ${hallName}${hallAddress ? `\nDeliver to: ${hallAddress}` : ''}`,
    `To:    ${vendor.name}`,
    ``,
    `Items:`,
    ...po.lines.map(line),
    ``,
    `  Subtotal:       ${fmtMoney(po.subtotal).padStart(12)}`,
    `  Tax (${(vendor.tax_rate * 100).toFixed(2)}%):    ${fmtMoney(po.tax).padStart(12)}`,
    `  TOTAL:          ${fmtMoney(po.total).padStart(12)}`,
    ``,
    `Please confirm receipt of this order and expected delivery date.`,
    `Reference PO ${po.num} on the delivery invoice.`,
  ].join('\n');
}

/**
 * The order run's emails: one PO per vendor (up to 4).
 * Accounting is intentionally NOT copied on POs — they receive the delivered-$ email at
 * receiving time, which states what to actually pay. The CC address (Settings) still gets
 * a copy of everything for oversight.
 */
export function buildOrderEmails(pos, vendors, hallName, hallAddress, _accountingAddress) {
  const vmap = Object.fromEntries(vendors.map((v) => [v.id, v]));
  const out = [];
  for (const po of pos) {
    const v = vmap[po.vendor_id];
    out.push({
      kind: 'po', po_num: po.num, to: v.email,
      subject: `Purchase Order ${po.num} — ${hallName}`,
      body: poBody(po, v, hallName, hallAddress),
    });
  }
  return out;
}

export function buildShortageEmail(po, vendor, hallName, missingLines) {
  const value = missingLines.reduce((a, l) => a + l.qty * l.cost, 0);
  return {
    kind: 'shortage', po_num: po.num, to: vendor.email,
    subject: `Short delivery on PO ${po.num} — ${hallName}`,
    body: [
      `Regarding Purchase Order ${po.num}:`,
      ``,
      `The following ordered items were not included in the delivery:`,
      ...missingLines.map(line),
      ``,
      `  Missing value:  ${fmtMoney(value).padStart(12)}`,
      ``,
      `Please advise whether these items will ship as a backorder or be credited.`,
    ].join('\n'),
  };
}

export function buildDeliveredEmail(po, vendor, hallName, invoiceNo, receivedLines, missingLines) {
  const received = receivedLines.reduce((a, l) => a + l.qty * l.cost, 0);
  const tax = Math.round(received * vendor.tax_rate * 100) / 100;
  const owed = Math.round((received + tax) * 100) / 100;
  const variance = Math.round((po.total - owed) * 100) / 100;
  return {
    kind: 'delivered', po_num: po.num, to: '(accounting)',
    subject: `Delivered: PO ${po.num} — pay ${fmtMoney(owed)}${missingLines.length ? ' (SHORT DELIVERY)' : ''}`,
    body: [
      `Delivery received against PO ${po.num} (${vendor.name}, ${hallName}).`,
      `Vendor invoice #: ${invoiceNo || '(none entered)'}`,
      ``,
      `Received items:`,
      ...receivedLines.map(line),
      ``,
      ...(missingLines.length
        ? [`NOT delivered (do not pay for these):`, ...missingLines.map(line), ``] : []),
      `  Received subtotal:  ${fmtMoney(received).padStart(12)}`,
      `  Tax (${(vendor.tax_rate * 100).toFixed(2)}%):        ${fmtMoney(tax).padStart(12)}`,
      `  AMOUNT TO PAY:      ${fmtMoney(owed).padStart(12)}`,
      ``,
      `  Original PO total:  ${fmtMoney(po.total).padStart(12)}`,
      `  Variance:           ${fmtMoney(variance).padStart(12)}${variance !== 0 ? '  <-- check before paying' : ''}`,
    ].join('\n'),
    amount: owed,
  };
}
