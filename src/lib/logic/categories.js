// Product categories used by the Inventory and Purchase filters.
//
// "Misc" covers things that are stocked and counted but aren't a game you open
// and sell out of a box: dauber supplies, and cherry-ticket cases (which sell by
// the ticket). Most of the time people want games only, so that's the default.

export const GAME_TYPES = [
  { value: '', label: 'All types' },
  { value: 'flash', label: 'Flash' },
  { value: 'strip', label: 'Strip' },
  { value: 'guarantee', label: 'Guarantee' },
  { value: 'paper', label: 'Paper' },
];

export const MISC_MODES = [
  { value: 'games', label: 'Games only' },
  { value: 'all', label: 'Include cherry & daubers' },
  { value: 'misc', label: 'Cherry & daubers only' },
];

const CHERRY = /cherry/i;

/** Daubers and other supplies, plus cherry-ticket cases. */
export function isMisc(p) {
  if (!p) return false;
  return p.type === 'supply' || CHERRY.test(p.name || '');
}

/** Does this product pass the type + misc filters? */
export function passesFilters(p, { type = '', misc = 'games' } = {}) {
  const m = isMisc(p);
  if (misc === 'games' && m) return false;
  if (misc === 'misc' && !m) return false;
  if (type && p.type !== type) return false;
  return true;
}
