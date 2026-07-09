import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const moduleJSON = JSON.parse(readFileSync(new URL('./module.json', import.meta.url), 'utf8'));
const id = moduleJSON.id;

const FOUNDRY = 'http://localhost:30000';

export default defineConfig({
  root: 'src/',
  base: `/modules/${id}/dist/`,
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // `npm run dev` runs this as a reverse proxy in front of Foundry: open
  // http://localhost:30001/game (NOT :30000) and Vite serves our module's source with
  // HMR while proxying everything else — Foundry routes, the socket, our static files —
  // to the real server on :30000. Ignored by `vite build`.
  server: {
    port: 30001,
    open: '/game',
    proxy: {
      // The built entry doesn't exist in dev: bounce Foundry's request for it back to
      // Vite as src/index.ts (base maps /modules/<id>/dist/ → src/), served with HMR.
      [`/modules/${id}/dist/${id}.js`]: {
        target: `http://localhost:30001/modules/${id}/dist`,
        rewrite: () => '/index.ts',
      },
      [`/modules/${id}/dist/${id}.css`]: {
        target: `http://localhost:30001/modules/${id}/dist`,
        rewrite: () => '/styles.css',
      },
      // Our static localization files live under the module, not in Vite's src/ root.
      [`^/modules/${id}/lang/`]: FOUNDRY,
      // Everything outside our module (Foundry core, the active system, other modules).
      [`^(?!/modules/${id}/)`]: FOUNDRY,
      '/socket.io': { target: 'ws://localhost:30000', ws: true },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: 'es2022',
    lib: {
      entry: './index.ts',
      formats: ['es'],
      fileName: () => `${id}.js`,
    },
    rollupOptions: {
      output: {
        assetFileNames: (asset) => {
          const name = asset.name ?? asset.names?.[0] ?? '';
          return name.endsWith('.css') ? `${id}.css` : '[name][extname]';
        },
      },
    },
  },
});
