// One way of asking "are these two the same game?".
//
// Game names reach this system by hand, from spreadsheets typed at two halls, and
// the catalogue name drifts underneath them. The same game is "In Laws" on the
// sheet, "In Laws 180x8" in the original import, and "In Laws - Strip" after
// somebody reclassifies it. None of those are typos — they are all correct, at
// different moments — so comparing raw strings is the wrong instrument.
//
// The rules here are deliberately narrow. Each one exists because a real rename
// happened and would otherwise have dropped a game's sheet lines into the
// unmatched pile with no warning:
//
//   " - Strip" / "(Strip)"      a game reclassified from flash to strip and
//                               tagged in its title. This is the live case: the
//                               whole strip catalogue was suffixed at once, and
//                               people will keep doing it one game at a time.
//   "1260/$1", "180x8"          the tier and count suffixes carried in from the
//                               distributor's own list.
//   punctuation and case        "Swee' Pea" vs "Swee Pea", "PAI GOW" vs "Pai Gow".
//
// This does NOT decide a match on its own — two different games can share a key
// (Fire Balls exists twice, genuinely). It answers "could these be the same
// name", and the caller still has to deal with more than one candidate.

/** A trailing type tag someone added to the title: " - Strip", " (strip)", "-STRIP". */
const TYPE_TAG = /[\s\-–—]*[\(\[]?\s*(strip|strips|flash|paper|pack)\s*[\)\]]?\s*$/i;

/** Distributor tier and count suffixes: "1260/$1", "180x8", "2600 / $2". */
const TIER = /\s*\d[\d,]*\s*(\/\s*\$?\d+|x\s*\d+)\s*$/i;

/**
 * The comparable form of a game name.
 *
 * Strips one trailing type tag and one trailing tier, then removes everything
 * that is not a letter or a digit. Only one of each is removed: "Biker - Strip
 * - Strip" is a double-suffixing mistake worth seeing rather than silently
 * papering over.
 */
export function matchKey(name) {
  let s = String(name ?? '').trim();
  s = s.replace(TIER, '');
  s = s.replace(TYPE_TAG, '');
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Every name a product has ever answered to, as comparable keys. */
export function keysFor(product) {
  const p = product || {};
  const all = [p.name, p.orig_name, ...(p.aliases || [])];
  return new Set(all.filter(Boolean).map(matchKey).filter((k) => k.length > 0));
}

/** True when a hand-typed sheet name could mean this product. */
export const nameMatches = (product, raw) => keysFor(product).has(matchKey(raw));

/** Products a hand-typed name could mean. More than one is a real possibility. */
export const candidatesFor = (products, raw) =>
  (products || []).filter((p) => nameMatches(p, raw));

/**
 * Loose search for the game picker: does this product answer to what was typed?
 *
 * Substring, over every name the product has held. Someone searching "In Laws"
 * has to find it after it becomes "In Laws - Strip", and someone searching the
 * new name has to find it too — a picker that only looks at the current name
 * hides the game from whoever still calls it by the old one.
 */
export function searchMatches(product, term) {
  const t = String(term ?? '').trim().toLowerCase();
  if (!t) return true;
  const p = product || {};
  const names = [p.name, p.orig_name, ...(p.aliases || [])].filter(Boolean);
  if (names.some((n) => String(n).toLowerCase().includes(t))) return true;
  // fall back to the comparable form, so "inlaws" and "in-laws" still find it
  const k = matchKey(t);
  return k.length > 0 && [...keysFor(p)].some((key) => key.includes(k));
}
