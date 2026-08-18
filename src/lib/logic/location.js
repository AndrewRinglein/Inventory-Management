// Where stock is, as opposed to what condition it is in.
//
// The system answers two questions that look like one and are not:
//
//   OWNED     every box with a cost, wherever it sits      -> what accounting asks
//   ON FLOOR  what can be played tonight                   -> what operations asks
//
// They agree for every box sitting at its own hall, which is why one number has
// worked so far. Off-site stock is where they come apart: fifteen boxes the
// distributor is holding are an asset and are not playable, both at once.
//
// The consequence worth caring about is not the reporting, it is the decision.
// A shortage the floor cannot cover but off-site stock can is a SHIPMENT. Only a
// shortage nothing covers is a PURCHASE. Without a location the app cannot tell
// those apart, so it says "buy" to both and you buy what you already own.

export const LOCATIONS = [
  { id: 'hall',    label: 'On the floor', short: 'Floor',
    hint: 'At its hall, countable, playable tonight' },
  { id: 'vendor',  label: 'Held by distributor', short: 'Distributor',
    hint: 'Bought and invoiced — ours, but they still have it' },
  { id: 'storage', label: 'Off-site storage', short: 'Storage',
    hint: 'Ours, somewhere else, and not part of a floor count' },
];

export const locationLabel = (id) => LOCATIONS.find((l) => l.id === id)?.label || id;
export const locationShort = (id) => LOCATIONS.find((l) => l.id === id)?.short || id;

/** A box with no location is on the floor — every row predates this column. */
export const locationOf = (box) => box?.location || 'hall';
export const isFloor = (box) => locationOf(box) === 'hall';
export const isOffsite = (box) => !isFloor(box);

/**
 * Playable tonight: on the floor, and either sitting there or already open.
 * `opened` counts because a part-used box is still on the shelf being sold from.
 */
export const isPlayable = (box) =>
  isFloor(box) && (box.state === 'in_inventory' || box.state === 'opened');

/**
 * Owned: anything we have paid for or committed to and have not yet consumed.
 * Deliberately includes off-site and excludes on_order — an order that has not
 * arrived is a commitment, not an asset, and putting it in inventory value is
 * how a $64,000 order becomes a $77,000 payable.
 */
export const isOwned = (box) =>
  box.state === 'in_inventory' || box.state === 'opened';

/**
 * What to do about a shortage.
 *
 * `need` is how many boxes the floor is short. `offsite` is how many we already
 * own elsewhere. Returns what to ship, what to buy, and which it leads with —
 * because "you are short four and you own six in storage" is a completely
 * different instruction from "you are short four".
 */
export function coverShortage(need, offsite) {
  const short = Math.max(0, Math.round(Number(need) || 0));
  const have = Math.max(0, Math.round(Number(offsite) || 0));
  const ship = Math.min(short, have);
  const buy = short - ship;
  return {
    ship, buy, short,
    action: short === 0 ? 'none' : (buy === 0 ? 'ship' : (ship === 0 ? 'buy' : 'both')),
  };
}

/** One line of plain English for a shortage, for a screen or an order note. */
export function shortageAdvice(need, offsite, where) {
  const c = coverShortage(need, offsite);
  const at = where ? ` at ${where}` : ' off-site';
  if (c.action === 'none') return '';
  if (c.action === 'ship') return `Short ${c.short} — you already own ${c.ship}${at}. Ship, don't buy.`;
  if (c.action === 'buy') return `Short ${c.short} — nothing off-site. Buy ${c.buy}.`;
  return `Short ${c.short} — ship ${c.ship}${at}, buy the other ${c.buy}.`;
}

/** How stale an off-site confirmation is, in days. Null when never confirmed. */
export function daysSinceConfirmed(box, today = new Date()) {
  if (!box?.counted_at) return null;
  // counted_at is a plain calendar date. `new Date('2026-08-18')` parses as UTC
  // midnight, so comparing it to a local clock made a confirmation made this
  // morning read as "1 day ago" and the "today" branch unreachable. Compare
  // calendar days in local time instead.
  const [y, m, d] = String(box.counted_at).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const then = new Date(y, m - 1, d);
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((now - then) / 86400000));
}

// Stock nobody looks at is stock that quietly disappears, and off-site stock is
// by definition the stock nobody looks at. Anything past this wants confirming.
export const STALE_DAYS = 60;
export const isStale = (box, today = new Date()) => {
  const d = daysSinceConfirmed(box, today);
  return d === null || d > STALE_DAYS;
};

/**
 * Filter a box list down to what is physically on a hall floor.
 *
 * Every screen that asks an operational question has to go through this. The
 * moment off-site boxes joined the same table, a bare
 * `boxes.filter(b => b.state === 'in_inventory')` stopped meaning "available"
 * and started meaning "owned" — silently, with no error, in the one direction
 * that matters: it showed nineteen Monster Score when four were playable, and
 * anyone reading it would decide not to order.
 */
export const onFloor = (boxes) => (boxes || []).filter(isFloor);

/** Boxes that can be played or opened right now: on the floor and in stock. */
export const playable = (boxes) => (boxes || []).filter(isPlayable);
