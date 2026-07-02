---
name: foundry-pf2e
description: >-
  Authoring Foundry VTT Pathfinder 2e (PF2e) modules with TypeScript, Svelte 5, and
  Vite, targeting Foundry v14 APIs only (ApplicationV2 / DialogV2 / DataModel — never
  the v1 namespace). Use whenever working inside a Foundry/PF2e module repo: editing
  module.json, src/ esmodules, hooks, settings, document flags, compendium packs (the
  fvtt CLI), a Svelte UI mounted in ApplicationV2, the Vite lib build, or multi-client
  state sync. Trigger even when the user only mentions Foundry, a PF2e module,
  ApplicationV2, foundry packs, hooks, or a module.json — don't wait to be named.
---

# Foundry VTT PF2e module authoring

Conventions and APIs for the runegoblin family of Foundry **Pathfinder 2e** modules.
These are hybrid modules: compendium content (`packs/`) plus a scripted esmodule
(`src/`) built with TypeScript + Svelte 5 + Vite into `dist/<id>.js` + `.css`, which
`module.json` loads.

New module? Start from the `runegoblin-foundrytemplate` template and run `npm run init -- <new-id>`; it
rewrites the id/title everywhere. Don't hand-scaffold from scratch.

## Two rules that override defaults

**1. v14 only — no v1 APIs.** Use only current Foundry APIs under the `foundry.*`
tree. Never the v1 namespace or deprecated globals: no `foundry.appv1`; no bare
`Application` / `FormApplication` / `Dialog`; no bare `mergeObject` / `duplicate` /
`getProperty` (use the `foundry.utils.*` forms). Every window is an **ApplicationV2**
(`foundry.applications.api.ApplicationV2`); dialogs are **DialogV2**
(`foundry.applications.api.DialogV2`); structured data is `foundry.abstract.DataModel`
with `defineSchema()`. If a class seems to exist only in v1, find its V2 replacement
before writing it — don't fall back to v1.

**2. TypeScript everywhere, including tooling.** App code, `vite.config.ts`,
`svelte.config.ts`, and Node scripts (`scripts/*.ts`) are all TypeScript. Run scripts
with `node scripts/foo.ts`; Node ≥22.18 strips types by default, so no `tsx`/`ts-node`. Don't
introduce `.mjs`/`.js` tooling unless a tool's config loader requires it.

## Reference files — read the one that fits the task

Load these as needed; don't read all of them up front.

- **`references/foundry-api.md`** — the API surface: `foundry.*` namespaces, `game.*`,
  hooks and lifecycle, documents & flags, settings, the packs runtime API, ambient
  globals, and where the authoritative docs live. Read when writing hooks, settings,
  flags, or any Foundry API call.
- **`references/svelte-in-applicationv2.md`** — the Foundry UI glue: a thin
  ApplicationV2 shell that `mount()`s a Svelte 5 component (`unmount()` on close), the
  `*.svelte` shim, and Svelte's own AI tooling (`@sveltejs/mcp` autofixer) for the
  language itself. Read when building or editing any UI.
- **`references/vite-build.md`** — the build: lib config emitting one `.js` + one
  `.css`, the `@` alias, what is and isn't bundled (`.hbs`/assets aren't), the release
  zip, and why `npm run check` is separate. Read when touching the build or adding
  templates/assets.
- **`references/packs-cli.md`** — compendium packs: the `fvtt` pack/unpack workflow,
  the LevelDB lock, `_key`, registering packs in `module.json`, and **distribution** —
  raw compendia vs. a derived **Adventure** pack (keepId, the `_library/` convention, when
  *not* to use one). Read when working with `packs/` or deciding how content ships.
- **`references/multi-client-sync.md`** — keeping state consistent across connected
  clients: document-flag propagation vs. raw socket, GM-authority request/reply, race
  safety. Read only when state must sync across clients.
- **`references/testing.md`** — the two-tier verification harness: `npm test` (vitest,
  zero-setup, the CI tier) vs. `npm run test:e2e` (Playwright against a real headless
  Foundry), what each proves, commands + preconditions, checking harness health before
  trusting green, and how to author a spec. Read when verifying a change, adding tests,
  or wiring CI.

## Essentials worth knowing without opening a file

**Module identity.** The module id (e.g. `pf2e-my-module`) is the key for flags,
settings, the socket channel (`module.<id>`), and pack names (`<id>.<pack>`). Use a
`const MODULE_ID = '<id>'` and reference it everywhere.

**Public API.** Expose it the Foundry way: `game.modules.get(MODULE_ID).api = {...}`
(on `ready`, or earlier if dependents need it). Don't attach to `game`. `api` isn't a
typed field on `Module`, so cast at the assignment: `(module as { api?: T }).api`.

**Localization.** User-facing strings live in `lang/en.json` under `<id>.*` and are
read with `game.i18n.localize('<id>.key')` / `format(key, data)`. No hard-coded
strings. `lang/` ships verbatim (not built) and is in the release zip.

**Flags for state.** Persisted module state lives in document flags:
`doc.getFlag('<id>', key)` / `setFlag(...)` / `unsetFlag(...)`. For structured data use
`foundry.abstract.DataModel` + `static defineSchema()`.

**Authoritative docs.** Official reference: https://foundryvtt.com/api/ (pick the v14
build). The `foundry-pf2e` typedefs (`node_modules/foundry-pf2e/types/`) are what `tsc`
checks and add PF2e types. On conflict, trust the typedefs for what compiles, the docs
for what runs.
