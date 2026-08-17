// Applying a session to stock. Pure parts, so both stores behave identically and
// the rules can be tested without a database.

/**
 * What a session wants off the shelf: {productId: boxes}.
 * Lines with no product resolved are not stock movements and are skipped — the
 * import refuses to guess a product, so an unresolved line never gets this far.
 */
export function wantedFromPlays(plays) {
  const want = {};
  for (const p of plays || []) {
    if (!p?.product_id) continue;
    want[p.product_id] = (want[p.product_id] || 0) + (Number(p.qty) || 0);
  }
  return want;
}

/**
 * A session asked for more boxes than the hall had.
 *
 * This used to be handled by quietly inserting the difference as boxes marked
 * `unrecorded`, consumed in the same breath. The ledger balanced, which is
 * exactly why nobody noticed: 79 boxes at Santa Clara had been written off that
 * way before anyone went looking. A shortfall is a real-world fact — either the
 * count is wrong or stock arrived without a receipt — and it has to be answered
 * by a person, not absorbed by an insert.
 *
 * So the default is to refuse and say what is short. A caller that has decided
 * to accept it passes `allowShort` and the write-off still happens, but it is
 * now a deliberate act with its own event on the history.
 */
export class ShortfallError extends Error {
  constructor(short, names) {
    super(shortfallMessage(short, names));
    this.name = 'ShortfallError';
    this.short = short;
    this.code = 'session_short';
  }
}

/** Human-readable "what is short and by how much". `names` maps id -> game name. */
export function shortfallMessage(short, names = {}) {
  const label = (s) => `${names[s.product_id] || s.product_id} — needs ${s.wanted}, `
    + `${s.found === 0 ? 'none on the shelf' : `only ${s.found} on the shelf`}`;
  const total = short.reduce((a, s) => a + (s.wanted - s.found), 0);
  return `This session plays ${total} box${total === 1 ? '' : 'es'} the hall does not have:\n`
    + short.map((s) => '  • ' + label(s)).join('\n')
    + '\n\nNothing has been taken off the shelf. Either the count is wrong, or these '
    + 'arrived without being received in. Fix the stock and apply again, or apply '
    + 'anyway to record the difference as never-received.';
}

/**
 * Per-box value for a write-off, from the product's own pricing.
 * base_cost is per DEAL, pack_units deals per ordered unit, split_boxes countable
 * boxes per ordered unit. Packing is excluded — it buys no cardboard.
 */
export function writeOffCost(product) {
  const p = product || {};
  return Math.round(((Number(p.base_cost) || 0) * Math.max(1, p.pack_units || 1)
    / Math.max(1, p.split_boxes || 1)) * 100) / 100;
}

/**
 * Order a pool of candidate boxes the way a session consumes them.
 * Boxes already opened on the floor are the ones the count sheet is describing,
 * so they go first; untouched shelf stock only after that. Taking shelf stock
 * first destroyed good boxes and left the opened ones stuck open forever.
 */
export function consumeOrder(pool, n) {
  const list = pool || [];
  return [
    ...list.filter((b) => b.state === 'opened'),
    ...list.filter((b) => b.state === 'in_inventory'),
  ].slice(0, n);
}
