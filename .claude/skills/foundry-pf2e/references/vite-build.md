# Vite build & dev

A Vite **library build**: one TypeScript entry (`src/index.ts`) → `dist/<id>.js` +
`dist/<id>.css`, which `module.json` lists in `esmodules` / `styles`. `dist/` is
gitignored — build before enabling a world, and after edits; CI builds it for releases.

## Config

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const moduleJSON = JSON.parse(readFileSync(new URL('./module.json', import.meta.url), 'utf8'));

export default defineConfig({
  root: 'src/',
  base: `/modules/${moduleJSON.id}/dist/`,
  plugins: [svelte()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // `npm run dev` runs Vite as a reverse proxy in front of Foundry (see Dev reload).
  // Ignored by `vite build`.
  server: {
    port: 30001,
    open: '/game',
    proxy: {
      // Built entry doesn't exist in dev — serve src/index.ts (so edits hot-reload) instead.
      [`/modules/${moduleJSON.id}/dist/${moduleJSON.id}.js`]: {
        target: `http://localhost:30001/modules/${moduleJSON.id}/dist`,
        rewrite: () => '/index.ts',
      },
      // Static files Foundry serves from disk (Vite's root is src/).
      [`^/modules/${moduleJSON.id}/(lang|packs|assets)/`]: 'http://localhost:30000',
      // Everything outside our module → real Foundry.
      [`^(?!/modules/${moduleJSON.id}/)`]: 'http://localhost:30000',
      '/socket.io': { target: 'ws://localhost:30000', ws: true },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: 'es2022',
    lib: { entry: './index.ts', formats: ['es'], fileName: () => `${moduleJSON.id}.js` },
    rollupOptions: {
      output: {
        assetFileNames: (asset) => {
          const name = asset.name ?? asset.names?.[0] ?? '';
          return name.endsWith('.css') ? `${moduleJSON.id}.css` : '[name][extname]';
        },
      },
    },
  },
});
```

Vite reads the id from `module.json`, so you define it once. `assetFileNames` forces
the emitted CSS to the stable `<id>.css` name `module.json` expects.

## Scripts

- `npm run build` — `vite build`.
- `npm run dev` — Vite **dev server** with HMR, reverse-proxying Foundry (see Dev reload).
- `npm run watch` — `vite build --watch` (rebuild `dist/` on save, no HMR).
- `npm run check` — `svelte-check && tsc --noEmit` (uses `foundry-pf2e` types).
- `npm run setup` — resolves dev paths (reads the Foundry data dir from its
  `Config/options.json` `dataPath`; optionally clones/points at the PF2e source), then
  symlinks the repo into Foundry's `Data/modules/` and pulls reference sources in.
  Caches to `.dev-paths.json`.

## What is and isn't bundled

- **Emitted: exactly two files.** `dist/<id>.js` and `dist/<id>.css`. The CSS is the
  bundle of `src/index.ts`'s `import './styles.css'` plus every Svelte component's
  scoped `<style>`. A stylesheet outside the JS import graph won't bundle.
- **Not bundled: `.hbs` templates and other static assets.** ApplicationV2 `PARTS`
  (the Handlebars path) reference them by URL, e.g.
  `template: 'modules/<id>/templates/foo.hbs'`. Keep them in a repo-root `templates/`,
  register partials with `foundry.applications.handlebars.loadTemplates([...])` on
  `init`, and **add the dir to the release zip** (see below) — the build won't.

## Path alias

`@/*` → `src/*` must live in BOTH `tsconfig.json` (`paths`) and `vite.config.ts`
(`resolve.alias`). A tsconfig-only alias type-checks but breaks the Vite build.

## Type-checking is separate

Vite (esbuild) does **not** type-check. Run `npm run check`. Make the release workflow
run it before building, so a broken `tsc` can't ship.

## TypeScript tooling

`vite.config.ts`, `svelte.config.ts`, and `scripts/*.ts` are all TypeScript; Node ≥22.18
strips types by default so scripts run via `node scripts/foo.ts` (no `tsx`/`ts-node`). Pin
`engines.node` (and `.nvmrc`) to ≥22.18 — older Node can't load the `.ts` configs. Both
svelte-check and vite load a `.ts` svelte config fine.

## Release

`.github/workflows/release.yml` on tag `vX.Y.Z`: stamp the version into `module.json`,
`npm ci`, `npm run check`, `npm run build`, then zip `module.json LICENSE README.md
dist lang packs` (exclude `packs/_source` and LevelDB `LOCK`/`LOG*`). If you add a
`templates/` or `assets/` dir, add it to the zip file list or it won't ship.

## Dev reload

`npm run dev` runs Vite as a **reverse proxy in front of Foundry**: Vite on `:30001`
serves the module's source (with HMR) and proxies everything else — Foundry routes, the
socket, static files — to the real server on `:30000`. The proxy rule above rewrites
Foundry's request for the built `dist/<id>.js` back to `src/index.ts`, so Vite serves it
transformed instead of 404'ing on a file that doesn't exist in dev.

**Prerequisite:** Foundry must be running with an **active (launched) world** that has
the module enabled — an esmodule loads only inside a world, so there's nothing to
hot-swap until one is launched. Vite never starts Foundry; it only proxies it. Then open
`http://localhost:30001/game` (not `:30000`) and log in. Editing a `.svelte` hot-swaps in
place (state preserved); editing `src/index.ts` (hooks/bootstrap) triggers a full reload
— expected, since re-running init on a live world would double-register hooks.

**Svelte 5:** do **not** hand-inject `import.meta.hot.accept()` into components. The
Svelte 5 compiler + `@sveltejs/vite-plugin-svelte` emit component HMR automatically; a
manual accept (the Svelte-4-era trick) breaks it. The `server` block is all that's needed
— no custom HMR plugin, no dev-manifest swap.

**Fallback:** `npm run watch` (`vite build --watch`) rebuilds `dist/` on save; browse
`:30000` and reload the browser (F5) after a `.js`/`.svelte` rebuild. Foundry hot-reloads
`.hbs`/`.css`/`.json` in place but **not** esmodules.
