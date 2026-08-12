// A component defined inside another component, wrapping a text field.
//
// React identifies a component by its function. Declaring one inside another
// makes a new function on every render, so React cannot match it to the tree it
// drew last time — it unmounts the old subtree and mounts a fresh one. Anything
// with a caret in it loses focus, which to the person typing looks like the box
// rejecting them after a single letter.
//
// It shipped on Settings: every field there was built by a `Row` declared inside
// SettingsScreen, so typing an email address meant one letter, click, one
// letter, click. Nothing in a render test catches it, because the markup is
// correct — only the identity is wrong.
//
// So this reads the source instead. An inner component holding only a button or
// a span is harmless; one holding an input, select or textarea is this bug.

import fs from 'node:fs';
import path from 'node:path';

const DIR = new URL('../src/components/', import.meta.url).pathname;
const FIELD = /<(input|select|textarea)\b/;

// a component declaration indented inside another function body
const INNER = /^[ \t]+(?:const|let|function)\s+([A-Z]\w*)\s*[=(]/gm;

let bad = 0, checked = 0;
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.jsx'))) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8');
  for (const m of src.matchAll(INNER)) {
    checked++;
    // the declaration runs to the first line that returns to its own indent
    const from = m.index;
    const indent = m[0].match(/^[ \t]*/)[0];
    const rest = src.slice(from + m[0].length);
    const endRel = rest.search(new RegExp(`\\n${indent}(?:const|let|function|return|\\}|[A-Za-z])`));
    const body = endRel === -1 ? rest.slice(0, 2000) : rest.slice(0, endRel);
    if (FIELD.test(body)) {
      bad++;
      console.log(`  FAIL  ${file}: <${m[1]}> is declared inside another component and contains`
        + ` a form field — it will remount on every render and drop focus.`
        + `\n        Move it to module scope.`);
    }
  }
}
console.log(bad
  ? `\n${bad} inner component(s) wrap a form field`
  : `  ok    no inner component wraps a form field (${checked} inner components checked)`);
process.exit(bad ? 1 : 0);
