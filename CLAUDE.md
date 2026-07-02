# pf2e-effects-stacking — project rules

A Foundry VTT **Pathfinder 2e** module template. Hybrid: compendium content (`packs/`)
plus a scripted esmodule (`src/`) built with TypeScript + Svelte 5 + Vite
(`src/index.ts` → `dist/pf2e-effects-stacking.{js,css}`). `module.json` is the manifest.

**The Foundry/PF2e API, compendium packs, Svelte-in-ApplicationV2, the Vite build, and
multi-client sync live in the user-level `foundry-pf2e` skill** — consult it for any of
those (it loads on demand, so this file stays lean). Here: only the hard rules and
what's specific to this repo.

New module from this template: `npm run init -- <new-id> [--title "..."]` rewrites the
id/title everywhere and deletes the init script. See README.

Code style: global `~/.claude/CLAUDE.md` — comment only the non-obvious *why*.

## Hard rules (override defaults)

- **v14 only, no v1 APIs.** Everything under `foundry.*`. Never `foundry.appv1`, bare
  `Application` / `FormApplication` / `Dialog`, or bare `mergeObject` / `duplicate` /
  `getProperty`. Windows are ApplicationV2; dialogs DialogV2; structured data is
  `foundry.abstract.DataModel` + `defineSchema()`. A v1-only class → find the V2 form first.
- **TypeScript everywhere, including tooling.** `vite.config.ts`, `svelte.config.ts`,
  and `scripts/*.ts` run via `node` (≥22.18 strips types by default — no `tsx`/`ts-node`). No
  `.mjs`/`.js` tooling. `package.json` pins `engines.node`.
- **UI is Svelte 5 mounted in an ApplicationV2 shell** (`mount`/`unmount`, runes) — not
  Svelte 4 forms (`new Component()`, `$destroy`, `export let`). See the skill's
  `svelte-in-applicationv2.md`.

## Build & dev

- `npm run build` → builds `packs/` from `packs/_source/` **and** `dist/` (both gitignored;
  build before enabling a world, and after edits).
- `npm run dev` — HMR dev server (`:30001`, proxies Foundry). `npm run watch` — `vite build --watch`.
  `npm run check` — `svelte-check` + `tsc`. `npm run setup` —
  resolve dev paths (detect/clone/prompt), then scaffold the Foundry module dir + pull references in.
- **Test (verification loop):** `npm test` — vitest unit specs (zero-setup, the CI tier).
  `npm run test:e2e` — Playwright against a real headless Foundry (opt-in; needs a licensed Foundry
  + a migration-current pf2e world, so it can't run in CI). Tiers, commands, preconditions, the
  check-harness-health discipline, and spec conventions live in the skill's `references/testing.md`.
- **Two ways the module lands in Foundry** (both put it at `modules/<id>/`):
  - `npm run setup` (dev) — a **real** module dir whose entries (`module.json`, `dist`, `lang`,
    `packs`, `assets`) symlink back to the repo, so edits + Vite HMR are live. NOT a whole-repo
    symlink (that leaked `node_modules`/`.git` and shipped no assets).
  - `npm run deploy` — `vite build`, then **copy** a clean, link-free, self-contained dir
    (same shape as the release zip). Use to test the shipped artifact or install without the repo.
- Art has **one source and one output**: it lives once in top-level `assets/` (beside `lang/`,
  `packs/`; not under `src/`, which is for built code) and ships once as a served file at
  `modules/<id>/assets/…` (dev symlink / `deploy` copy / release zip). **Reference it by that
  path** — from scene/tile content and from code alike (kingmaker and abomination-vaults do
  exactly this; their esmodules embed zero assets). Do NOT `import` art: in the lib build an
  import inlines a *second* copy into `dist/<id>.js`. When code needs an SVG's shapes live (e.g.
  to animate them), `fetch()` the served file and inline it (see `src/ui/components/example/RuneGoblinBadge.svelte`).
  The served path must resolve in dev, `deploy`, and the release zip.
- Active install: `FoundryVTT` (a fresh v14 desktop install may use `FoundryVTT-v14`).
  References: `_pf2e-source`, `_foundry-data`, `_foundry-modules`.

## This repo's specifics

- Module id `pf2e-effects-stacking`; flags, settings, the socket channel (`module.<id>`),
  and pack names (`<id>.<pack>`) all key off it. Use `const MODULE_ID`.
- Public API: `game.modules.get(MODULE_ID).api = {...}` (cast — `api` isn't typed on `Module`).
- Strings: `lang/en.json` under `pf2e-effects-stacking.*`; `game.i18n.localize/format`. No hard-coded strings.
- compatibility `minimum "14"`, `verified "14"`; MIT license. Author and the `url`/`manifest`/`download` org come from `npm run init` (committed as `<your-name>`/`<your-org>` placeholders until then).
- Release: tag `vX.Y.Z` → `release.yml` stamps the version, type-checks, builds, publishes `module.json` + `pf2e-effects-stacking.zip` (zip ships `dist lang packs assets` — must include the art).

## Gotchas

- Compendium packs build from `packs/_source/<name>` → `packs/<name>` on `npm run build`
  (`scripts/pack.ts`; built LevelDB gitignored like `dist/`). Edit the JSON sources, not the
  LevelDB. If Foundry holds a pack open the build skips it with a warning (LevelDB lock) —
  close Foundry to refresh. `npm run init` rewrites the sources so a generated module's packs
  carry its id after the next build. Pack workflow: skill's `packs-cli.md`.
- **Distribution is derived, not a mode.** `scripts/pack.ts` ships what `module.json` registers:
  register an `Adventure` pack and `npm run build` *derives* it from the per-type sources
  (`scripts/build-adventure.ts`, keepId import → ids preserved → cross-links hold); register none
  and you get plain compendia. Runtime libraries (effects a rule grants in place by compendium UUID)
  go under `packs/_source/_library/<name>/` so they ship as compendia and stay out of the Adventure.
  Sources stay canonical (compendium UUIDs); the build rewrites bundled-pack refs to world UUIDs,
  `scripts/normalize-refs.ts` rewrites them back after an unpack. Don't default to an Adventure —
  imported docs are copies that go stale on module update; only *worlds to run* warrant it. Runtime
  side: `promptAdventureImport()` in `src/adventure.ts` (self-deactivates with no Adventure pack).
  Decision guide + workflow: README "Ship as an Adventure" and the skill's `packs-cli.md`.
- `dist/` is gitignored — served via the dev scaffold's `dist` symlink after build; CI builds it for releases.
- Vite does **not** type-check — run `npm run check` (the release workflow does too).
- `npm run dev` = Vite HMR dev server on `:30001` reverse-proxying Foundry (`:30000`). It proxies an *already-running* Foundry — start Foundry and **launch a world with the module enabled** first, or there's no esmodule to hot-swap. Then browse `:30001/game` (not `:30000`). `.svelte` edits hot-swap; editing `src/index.ts` full-reloads. `npm run watch` = old `vite build --watch` (browse `:30000`, manual F5; Foundry hot-reloads `.hbs`/`.css`/`.json` but not esmodules).
- Persist state in document flags, not raw socket; raw socket for transient signals only (skill's `multi-client-sync.md`).
