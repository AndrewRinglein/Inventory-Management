// The lines an invoice email is built from must come from logic/receiving.js.
//
// A PO is written in ORDERED UNITS; a shelf is counted in INVENTORY UNITS. Every
// per-unit figure on a received line has to be divided by the split, and getting
// that wrong is expensive and quiet: one Biker case billed 16 x $160 of collation
// instead of $160, and an off-PO case was billed at $82,688 instead of $5,168.
// Both numbers went straight into payments.amount.
//
// receivedLine/missingLine/extraLine own that conversion and are unit-tested. But
// a test of the helper proves nothing if the screen stops calling it — reverting
// Receiving.jsx to the buggy version left the whole suite green, because the
// arithmetic tests still passed against a helper nobody used.
//
// So this checks the wiring rather than the maths: anything pushed onto
// receivedLines or missingLines must be the result of one of those three calls.
// Re-inlining an object literal there is the bug, and it fails here.

import fs from 'node:fs';

const FILE = new URL('../src/components/Receiving.jsx', import.meta.url).pathname;
const ALLOWED = ['receivedLine(', 'missingLine(', 'extraLine('];

const src = fs.readFileSync(FILE, 'utf8');

// a row may be held in a local first — the extras path needs its cost to price the
// boxes before the row is pushed — so bind those names and accept them too
const bound = new Set();
for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(\w+)\(/g)) {
  if (ALLOWED.includes(m[2] + '(')) bound.add(m[1]);
}

const pushes = [...src.matchAll(/(receivedLines|missingLines)\.push\(\s*([\s\S]{0,60})/g)];

let bad = 0;
for (const m of pushes) {
  const arg = m[2].trimStart();
  if (ALLOWED.some((f) => arg.startsWith(f))) continue;
  if (bound.has((arg.match(/^(\w+)\s*\)/) || [])[1])) continue;
  bad++;
  const lineNo = src.slice(0, m.index).split('\n').length;
  console.log(`  FAIL  Receiving.jsx:${lineNo}: ${m[1]}.push() is given something other than`
    + ` receivedLine()/missingLine()/extraLine().`
    + `\n        A PO line is priced per ORDERED UNIT and these emails count in boxes —`
    + `\n        build the row in lib/logic/receiving.js so the split is applied and tested.`);
}

if (!pushes.length) {
  console.log('  FAIL  Receiving.jsx: no receivedLines/missingLines .push() found at all —'
    + ' this guard has drifted from the code and needs updating.');
  bad++;
}

console.log(bad
  ? `\n${bad} invoice line(s) built outside logic/receiving.js`
  : `  ok    invoice lines all built through logic/receiving.js (${pushes.length} call sites checked)`);
process.exit(bad ? 1 : 0);
