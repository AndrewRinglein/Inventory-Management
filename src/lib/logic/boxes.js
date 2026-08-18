// Box lifecycle state machine — mirror of the database guard in 001_schema.sql.
// The DB enforces it too; this copy gives instant feedback and powers demo mode.

export const STATES = ['on_order', 'in_inventory', 'opened', 'sold_out', 'missing'];

const ALLOWED = {
  on_order:     ['in_inventory', 'missing'],
  in_inventory: ['opened', 'missing'],
  opened:       ['sold_out', 'in_inventory'],   // in_inventory = undo of open
  sold_out:     ['opened'],                      // undo only
  missing:      ['in_inventory', 'on_order'],    // late arrival / undo
};

export const canTransition = (from, to) => from === to || (ALLOWED[from] || []).includes(to);

/** Apply a transition, stamping the appropriate timestamp. Throws on illegal moves. */
export function transition(box, to, now = new Date().toISOString()) {
  if (!canTransition(box.state, to)) {
    throw new Error(`illegal box state transition: ${box.state} -> ${to}`);
  }
  const b = { ...box, state: to };
  if (to === 'in_inventory' && !b.received_at) b.received_at = now;
  if (to === 'opened') b.opened_at = b.opened_at || now;
  if (to === 'sold_out') b.sold_out_at = b.sold_out_at || now;
  return b;
}

/**
 * Per-product counts for a hall's boxes.
 *
 * `inv` MEANS ON THE FLOOR. That is deliberate and it is the safe default: every
 * caller of this function — the order builder, session apply, the assign screen —
 * is asking an operational question, and answering it with stock sitting in a
 * distributor's warehouse would be wrong in the dangerous direction. Off-site is
 * reported alongside, never folded in.
 *
 *   inv      in_inventory, on the floor        what can be played tonight
 *   open     opened, on the floor              part-used, still selling
 *   off      in_inventory or opened, off-site  ours, elsewhere, not playable
 *   owned    inv + open + off                  what accounting counts as stock
 *
 * `offBy` breaks the off-site figure down by location so a screen can say WHERE
 * without a second pass over the boxes.
 */
export function countByProduct(boxes) {
  const out = {};
  for (const b of boxes) {
    const c = (out[b.product_id] ||= {
      inv: 0, open: 0, onorder: 0, sold: 0, missing: 0, off: 0, owned: 0, offBy: {},
    });
    const where = b.location || 'hall';       // every row predates the column
    const held = b.state === 'in_inventory' || b.state === 'opened';
    if (where !== 'hall') {
      if (held) {
        c.off++; c.owned++;
        c.offBy[where] = (c.offBy[where] || 0) + 1;
      }
      // an off-site box is never floor stock, whatever its state
      if (b.state === 'on_order') c.onorder++;
      else if (b.state === 'sold_out') c.sold++;
      else if (b.state === 'missing') c.missing++;
      continue;
    }
    if (b.state === 'in_inventory') { c.inv++; c.owned++; }
    else if (b.state === 'opened') { c.open++; c.owned++; }
    else if (b.state === 'on_order') c.onorder++;
    else if (b.state === 'sold_out') c.sold++;
    else if (b.state === 'missing') c.missing++;
  }
  return out;
}
