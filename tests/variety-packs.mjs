// A variety pack's colour count IS its deal multiplier.
//
// One deal per colour. Eleven colours means pack_units 11 and split_boxes 11 —
// eleven packs on the shelf, each worth one deal. If the colour list in
// src/data/variety-packs.js and the pack_units in the migration ever disagree, the
// PO asks the vendor for a number of colours it is not paying for, or pays for
// colours it did not ask for, and the shelf count is wrong by the difference.
//
// The list lives in code and the multiplier lives in the database, so nothing
// structural keeps them together. This does.

import fs from 'node:fs';
import { VARIETY_PACKS } from '../src/data/variety-packs.js';

const SQL = new URL('../supabase/migrations/043_marathon_daubers.sql', import.meta.url).pathname;
const sql = fs.readFileSync(SQL, 'utf8');

let bad = 0, checked = 0;

for (const [id, pack] of Object.entries(VARIETY_PACKS)) {
  checked++;
  const n = pack.colors.length;

  // The update block for this product: from the LAST `update products set` before
  // its `where`, not the first one in the file. A plain lazy match starts at S830
  // and runs to whichever `where` is asked for, so it reads S830's numbers for
  // every product — which reported a correct migration as broken.
  const block = sql.match(
    new RegExp(`update products set(?:(?!update products set)[\\s\\S])*?where id = '${id}';`));
  if (!block) {
    console.log(`  FAIL  ${id} (${pack.label}) has colours here but no update in 043.`);
    bad++;
    continue;
  }
  const units = Number((block[0].match(/pack_units\s*=\s*(\d+)/) || [])[1]);
  const split = Number((block[0].match(/split_boxes\s*=\s*(\d+)/) || [])[1]);

  if (units !== n || split !== n) {
    console.log(`  FAIL  ${id} (${pack.label}): ${n} colours listed, but the migration sets`
      + ` pack_units=${units} and split_boxes=${split}.`
      + `\n        One deal per colour — all three numbers must be ${n}.`);
    bad++;
  }

  const dupes = pack.colors.filter((c, i) => pack.colors.indexOf(c) !== i);
  if (dupes.length) {
    console.log(`  FAIL  ${id} (${pack.label}): duplicate colour(s) ${[...new Set(dupes)].join(', ')}.`);
    bad++;
  }
}

// every colour in a pack should also be buyable on its own
for (const [id, pack] of Object.entries(VARIETY_PACKS)) {
  for (const c of pack.colors) {
    const needle = `'${pack.label.replace(/'/g, "''")}','${c}'`;
    if (!sql.includes(needle)) {
      console.log(`  FAIL  ${id}: ${pack.label} ${c} is in the pack but has no single-colour`
        + ` product in 043 (looked for ${needle}).`);
      bad++;
    }
  }
}

console.log(bad
  ? `\n${bad} variety-pack mismatch(es)`
  : `  ok    variety packs agree with their deal multipliers (${checked} packs, `
    + `${Object.values(VARIETY_PACKS).reduce((a, p) => a + p.colors.length, 0)} colours)`);
process.exit(bad ? 1 : 0);
