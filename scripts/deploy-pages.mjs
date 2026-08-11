// Publish dist/ to the gh-pages worktree at .ghp
//
// Two things here are not optional, and both have broken the live site before.
//
// 1. The bundle must be built with BASE_PATH=/Inventory-Management/. GitHub Pages
//    serves this repo as a PROJECT site, so the app lives under a subpath. A
//    default `vite build` emits src="/assets/..." which resolves to the domain
//    root and 404s — a blank page, no error anyone can read. Use `npm run deploy`,
//    never a bare `vite build` followed by a copy.
//
// 2. Old files must be deleted, not just overwritten. Asset names are content
//    hashed, so a plain copy leaves every past bundle behind and the branch grows
//    without bound while nothing tells you which files are live.
//
// 404.html is index.html again, which is what makes a deep link work: Pages has
// no server-side routing, so it serves 404.html for any path that is not a real
// file, and an identical copy of index.html boots the app there instead.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const GHP = path.join(ROOT, '.ghp');

if (!fs.existsSync(DIST)) throw new Error('no dist/ — run npm run build:pages first');

const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
if (!html.includes('/Inventory-Management/assets/')) {
  throw new Error(
    'dist/index.html does not reference /Inventory-Management/assets/ — it was built\n'
    + 'without BASE_PATH and would deploy a blank page. Run: npm run build:pages');
}
if (!fs.existsSync(GHP)) throw new Error('no .ghp worktree — git worktree add .ghp gh-pages');

// clear everything except the worktree's own git pointer
for (const name of fs.readdirSync(GHP)) {
  if (name === '.git') continue;
  fs.rmSync(path.join(GHP, name), { recursive: true, force: true });
}
fs.cpSync(DIST, GHP, { recursive: true });

// SPA fallback, and the marker that stops Pages running the output through Jekyll
fs.copyFileSync(path.join(GHP, 'index.html'), path.join(GHP, '404.html'));
fs.writeFileSync(path.join(GHP, '.nojekyll'), '');

const git = (...a) => execFileSync('git', a, { cwd: GHP, encoding: 'utf8' });
git('add', '-A');
const staged = git('diff', '--cached', '--name-only').trim();
if (!staged) { console.log('nothing changed'); process.exit(0); }
const rev = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
git('commit', '-q', '-m', `deploy ${rev}`);
console.log(`staged ${staged.split('\n').length} file(s), committed as deploy ${rev}`);
console.log('now: git -C .ghp push origin gh-pages');
