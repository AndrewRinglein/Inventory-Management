// Product categories used by the Inventory and Purchase filters.
//
// "Misc" covers things that are stocked and counted but aren't a game you open
// and sell out of a box: dauber supplies, and cherry-ticket cases (which sell by
// the ticket). Most of the time people want games only, so that's the default.

export const GAME_TYPES = [
  { value: '', label: 'All types' },
  { value: 'flash', label: 'Flash' },
  { value: 'strip', label: 'Strip' },
  { value: 'paper', label: 'Paper' },
  { value: 'guarantee', label: 'Guarantee' },
  { value: 'supply', label: 'Supply' },
  { value: '_unset', label: 'Needs a type' },
];

/** The types a person can pick on a product row. */
export const REAL_TYPES = [
  { value: 'flash', label: 'flash' },
  { value: 'strip', label: 'strip' },
  { value: 'guarantee', label: 'guarantee' },
  { value: 'paper', label: 'paper' },
  { value: 'supply', label: 'supply' },
];

export const MISC_MODES = [
  { value: 'games', label: 'Games only' },
  { value: 'all', label: 'Include cherry & daubers' },
  { value: 'misc', label: 'Cherry & daubers only' },
];

// "Cheery- Thrilling 3's/Bank Busters" is a cherry case with a typo in the
// count sheet it came from — match the misspelling too rather than rename it.
const CHERRY = /ch(err|eer)y/i;

// A mixed pack — whatever the vendor had spare that week. There is no single
// ticket count to record, so the app shouldn't keep asking for one. These are
// still ordinary games for every other purpose: they order, receive and count
// like anything else, so they stay out of the Misc filter.
const GRAB_BAG = /\bmisc\b|\bassort|\bvariety pack/i;

export const isGrabBag = (p) => !!p && GRAB_BAG.test(p.name || '');

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
  if (type === '_unset') return !p.type;
  if (type && p.type !== type) return false;
  return true;
}
