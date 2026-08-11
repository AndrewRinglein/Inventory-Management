import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Every build gets an id, baked into the bundle and written to version.json beside it.
// The running app polls that file and can tell when the server has moved on without it —
// which matters because GitHub Pages serves index.html from cache, so a browser can sit
// on an old page pointing at asset filenames that no longer exist. The symptom is a
// stale bundle and a 404 on the CSS, and it looks exactly like a bug in the code.
const BUILD_ID = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [
    react(),
    {
      name: 'emit-version',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ build: BUILD_ID }),
        });
      },
    },
  ],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  build: { outDir: 'dist', sourcemap: false },
});
