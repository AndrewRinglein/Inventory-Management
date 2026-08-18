// Scanner input: capture + resolution.
//
// Capture: HID keyboard-wedge scanners "type" the code as a fast keystroke burst
// ending in Enter. We watch document keydown; characters arriving faster than
// BURST_MS apart accumulate in a buffer. Enter after >= MIN_LEN chars = a scan.
// Human typing is slower and (unless focused on our hidden pattern) goes to
// whatever input has focus — we ignore bursts when a text field is focused
// UNLESS the field opts in with data-scan-target.

import { isFloor, locationLabel } from './location.js';

const BURST_MS = 45;
const MIN_LEN = 4;

export function createScanCapture(onScan) {
  let buf = '';
  let last = 0;
  const handler = (e) => {
    const el = document.activeElement;
    const inField = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    if (inField && !el.dataset.scanTarget) return;   // let normal typing be normal
    const now = performance.now();
    if (now - last > BURST_MS) buf = '';
    last = now;
    if (e.key === 'Enter') {
      if (buf.length >= MIN_LEN) {
        const code = buf;
        buf = '';
        e.preventDefault();
        onScan(code.trim());
      }
      return;
    }
    if (e.key.length === 1) buf += e.key;
  };
  document.addEventListener('keydown', handler, true);
  return () => document.removeEventListener('keydown', handler, true);
}

/**
 * Resolve a scanned code against the hall's boxes for the current mode.
 * ctx: { mode: 'receive'|'open'|'soldout'|'off', boxes, hallId, poId? }
 * Returns an action descriptor — the caller performs it and shows feedback:
 *   {ok:true,  action:'receive'|'open'|'soldout', box}
 *   {ok:false, reason:'off'|'unknown'|'duplicate'|'wrong_state'|'wrong_po', box?, message}
 */
export function resolveScan(code, ctx) {
  const { mode, boxes, poId } = ctx;
  if (!mode || mode === 'off') return { ok: false, reason: 'off', message: 'Scanner mode is off — pick Receive, Open, or Sold out first.' };

  const matches = boxes.filter((b) => b.serial && b.serial === code);
  if (!matches.length) return { ok: false, reason: 'unknown', message: `Code "${code}" not recognized.` };

  // A box the system believes is at a distributor or in storage cannot be opened
  // or sold out on a floor it is not on. If the serial is physically in someone's
  // hand then the RECORD is what's wrong, and the honest response is to say so
  // rather than quietly transitioning it — an off-site box walked to sold_out
  // stops being counted as owned and leaves inventory with no trace of why.
  // Receiving is exempt: receiving is what puts a box somewhere in the first place.
  if (mode !== 'receive') {
    const here = matches.filter(isFloor);
    if (!here.length) {
      const b = matches[0];
      return { ok: false, reason: 'offsite', box: b,
        message: `That box is recorded as ${locationLabel(b.location)}`
          + `${b.location_ref ? ' · ' + b.location_ref : ''}, not on the floor. `
          + `Bring it in from Owned Inventory first.` };
    }
    return resolveOnFloor(code, { ...ctx, boxes: here });
  }

  if (mode === 'receive') {
    const onOrder = matches.find((b) => b.state === 'on_order' && (!poId || b.po_id === poId));
    if (onOrder) return { ok: true, action: 'receive', box: onOrder };
    const already = matches.find((b) => b.state !== 'on_order');
    if (already) return { ok: false, reason: 'duplicate', box: already, message: `Already received (${fmtWhen(already.received_at)}).` };
    return { ok: false, reason: 'wrong_po', box: matches[0], message: 'That box belongs to a different order.' };
  }

  return resolveOnFloor(code, ctx);
}

/** The open / sold-out paths, once the box is known to be on the floor. */
function resolveOnFloor(code, ctx) {
  const { mode, boxes } = ctx;
  const matches = boxes.filter((b) => b.serial && b.serial === code);
  if (mode === 'open') {
    const inInv = matches.find((b) => b.state === 'in_inventory');
    if (inInv) return { ok: true, action: 'open', box: inInv };
    const opened = matches.find((b) => b.state === 'opened');
    if (opened) return { ok: false, reason: 'duplicate', box: opened, message: `Already opened (${fmtWhen(opened.opened_at)}).` };
    return { ok: false, reason: 'wrong_state', box: matches[0], message: `Box is ${label(matches[0].state)} — can't open.` };
  }

  if (mode === 'soldout') {
    const opened = matches.find((b) => b.state === 'opened');
    if (opened) return { ok: true, action: 'soldout', box: opened };
    const sold = matches.find((b) => b.state === 'sold_out');
    if (sold) return { ok: false, reason: 'duplicate', box: sold, message: `Already marked sold out (${fmtWhen(sold.sold_out_at)}).` };
    const inInv = matches.find((b) => b.state === 'in_inventory');
    if (inInv) return { ok: false, reason: 'wrong_state', box: inInv, message: 'Box was never opened — open it first.' };
    return { ok: false, reason: 'wrong_state', box: matches[0], message: `Box is ${label(matches[0].state)}.` };
  }

  return { ok: false, reason: 'off', message: 'Unknown scan mode.' };
}

const label = (s) => ({ on_order: 'still on order', in_inventory: 'in inventory', opened: 'opened', sold_out: 'sold out', missing: 'marked missing' }[s] || s);

function fmtWhen(iso) {
  if (!iso) return 'earlier';
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Short beeps via WebAudio — no audio files needed. */
export function beep(ok = true) {
  try {
    const ctx = (beep._ctx ||= new (window.AudioContext || window.webkitAudioContext)());
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = ok ? 1120 : 300;
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (ok ? 0.12 : 0.32));
    o.start(); o.stop(ctx.currentTime + (ok ? 0.13 : 0.33));
  } catch { /* audio unavailable — visual flash still shows */ }
}
