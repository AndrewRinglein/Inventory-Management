// Bundle the render smoke test (JSX, browser imports) and run it under node.
//
// The app reads window/localStorage at module scope — the role comes from the URL —
// so a few stubs go in before the bundle is evaluated. They exist only to let the
// modules load; nothing under test depends on their values.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = {
  location: { href: 'http://localhost/?role=admin', search: '?role=admin', pathname: '/' },
  localStorage: globalThis.localStorage,
  addEventListener() {}, removeEventListener() {},
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  activeElement: null, createElement: () => ({ click() {}, setAttribute() {}, style: {} }),
};
globalThis.performance ??= { now: () => 0 };

const out = '/tmp/render-test.cjs';
await build({
  entryPoints: ['tests/render.test.jsx'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: out,
  absWorkingDir: process.cwd(),
  jsx: 'automatic',
  logLevel: 'silent',
  loader: { '.css': 'empty' },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': '""',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
    'import.meta.env.DEV': 'false',
  },
});
await import(pathToFileURL(out).href);
