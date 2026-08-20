// Per-hall catalogue filtering.
//
// The catalogue is shared by both halls, but the floors are not. Some games only
// ever existed at one hall, and a few names exist twice with genuinely different
// contents behind them — Red White & Blue is three separate records, and the two
// halls buy different ones. Nothing can be merged or deleted, so each hall gets
// to say which records it does not want to look at.
//
// The rule that keeps this safe: hiding is about the VIEW, never the STOCK. A
// hidden game's boxes still exist, are still owned, still cost what they cost,
// and are still counted in the value total. Anything that reads these helpers to
// decide what to DISPLAY is using them correctly; anything that reads them to
// decide what something is WORTH is a bug.

/** The hidden set for a hall, as a Set of product ids. Accepts rows or ids. */
export function hiddenSet(rows, hallId) {
  const out = new Set();
  for (const r of rows || []) {
    if (typeof r === 'string') { out.add(r); continue; }
    if (!r) continue;
    if (hallId && r.hall_id && r.hall_id !== hallId) continue;
    if (r.product_id) out.add(r.product_id);
  }
  return out;
}

export const isHidden = (hidden, productId) =>
  !!(hidden && typeof hidden.has === 'function' && hidden.has(productId));

/**
 * Split rows into what this hall shows and what it has put away.
 * `pick` pulls the product id off a row — Inventory rows carry `{ p }`, Purchase
 * rows are the product itself, so neither screen has to reshape its data first.
 */
export function splitVisible(rows, hidden, pick = (r) => r?.id) {
  const visible = [], put = [];
  for (const r of rows || []) (isHidden(hidden, pick(r)) ? put : visible).push(r);
  return { visible, hidden: put };
}

/**
 * What is sitting behind the filter, so a screen can say so out loud.
 *
 * `count` is how many games this hall hides in total — including ones with no
 * stock, which is the ordinary case and the reason the feature exists.
 * `boxes` and `value` cover only the hidden games that still hold stock. Those
 * are the numbers that would silently leave a floor total if hiding were allowed
 * to remove them, so every screen that hides rows has to surface them.
 */
export function hiddenStockSummary(rows, hidden, pick = (r) => r?.id, measure) {
  let count = 0, boxes = 0, value = 0, withStock = 0;
  for (const r of rows || []) {
    if (!isHidden(hidden, pick(r))) continue;
    count++;
    const m = measure ? measure(r) : { boxes: 0, value: 0 };
    const b = Number(m?.boxes) || 0;
    const v = Number(m?.value) || 0;
    if (b > 0) withStock++;
    boxes += b;
    value += v;
  }
  return { count, boxes, value: Math.round(value * 100) / 100, withStock };
}

/**
 * The sentence a screen prints under its table. Null when there is nothing to say,
 * so a caller can render it unconditionally.
 */
export function hiddenNote(summary) {
  const s = summary || {};
  if (!s.count) return null;
  const games = `${s.count} game${s.count === 1 ? '' : 's'} hidden at this hall`;
  if (!s.boxes) return games + '.';
  return `${games} — ${s.boxes} box${s.boxes === 1 ? '' : 'es'} still on the floor, `
       + 'counted in the totals above.';
}

/**
 * Sort comparator that sinks a hall's put-away games to the bottom of a list.
 *
 * The picker on Session Use is where duplicated names actually get resolved by a
 * person, so it is where hiding earns its keep: Red White & Blue is three separate
 * records and the two halls buy different ones. Putting the hall's own games first
 * makes the obvious click the right one.
 *
 * Deliberately a sort and not a filter. A hall genuinely playing a put-away game —
 * the last few boxes of the wrong-hall duplicate, say — must still be able to
 * record it, or the line falls into the unmatched pile for someone to key by hand.
 *
 *   list.sort((a, b) => hiddenLast(a, b, hidden) || a.name.localeCompare(b.name))
 */
export function hiddenLast(a, b, hidden) {
  return (isHidden(hidden, a?.id) ? 1 : 0) - (isHidden(hidden, b?.id) ? 1 : 0);
}
