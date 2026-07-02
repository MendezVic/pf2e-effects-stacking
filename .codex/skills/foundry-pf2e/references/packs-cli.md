# Compendium packs (fvtt CLI)

Packs are LevelDB databases under `packs/`. Edit them as JSON sources in
`packs/_source/<name>/` and compile with the `fvtt` CLI.

## LevelDB is locked while Foundry runs

**Close Foundry before any `fvtt package` op** — the LevelDB `LOCK` blocks it otherwise.

## Pack / unpack

The CLI ships as a dev dependency, wrapped as `npm run pack` / `npm run unpack` (or call
`npx fvtt` directly).

```bash
# JSON sources -> LevelDB pack
npm run pack   -- <name> --in packs/_source/<name> --out packs

# LevelDB pack -> JSON sources (after editing content inside Foundry)
npm run unpack -- <name> --in packs --out packs/_source/<name>
```

Pass explicit `--in/--out` so the CLI's configured `dataPath` doesn't matter (it may
point at a different Foundry install).

## What to track and register

- Track `packs/_source/*.json`. The LevelDB `LOCK`/`LOG*` files are gitignored;
  `.gitattributes` marks `packs/*/** binary`.
- Every packed doc needs a `_key` of the form `!collection!id` (e.g.
  `!scenes!abc123…`).
- Register each pack in `module.json` `"packs"`:

```json
{ "name": "<name>", "label": "Human Label", "path": "packs/<name>", "type": "Scene" }
```

Actor/Item packs also need `"system": "pf2e"`.

## Adventure packaging vs. raw compendia

A module distributes the **same** `packs/_source/` tree two ways — it's a derived build target,
not a mode, and there's no migration between them:

- **Compendia** — browseable packs dragged in piecemeal. Right for a *bag of content* (bestiary,
  token/item/spell collection, rules library). They stay **live**: a module update updates what
  users see.
- **One Adventure** — a single `Adventure` document the GM imports to populate the world. Right for
  *a world to run* (scenes with placed tokens, encounters, cross-referencing journals/macros, or any
  esmodule feature bound to a document id). Import uses **keepId**, so every `_id` is preserved on
  every install — that's what keeps hardcoded ids and `@UUID` cross-links valid. Loose per-pack
  import mints new ids and silently breaks them.

**Default to compendia.** Adventure-imported documents are *copies*: a later module update won't
touch them, and re-import risks clobbering the GM's edits — so anything you keep improving (statblocks,
errata) belongs in a compendium, not an Adventure. (This staleness is why PF2e premium modules merge
fresh data from system compendia in `_preImport`.) Only consolidate when the module is a world to run.

How it works in this template's tooling (`scripts/pack.ts` → `scripts/build-adventure.ts`):

- **The trigger is registration.** Register an `Adventure`-type pack in `module.json` `"packs"` and
  `npm run build` derives it; register none and you ship plain compendia. No flag, no config.
- **`_library/` convention.** Runtime libraries — packs a rule element grants in place by compendium
  UUID (e.g. a PF2e `Aura`'s `effects[].uuid`) — **must** stay compendium-resident, never imported.
  Put their sources under `packs/_source/_library/<name>/`; the build ships them as compendia and
  keeps them out of the Adventure. The Adventure bundles every `_source/<dir>` *outside* `_library/`.
- **Refs: canonical = compendium UUIDs.** Author `@UUID[Compendium.<id>.<pack>.<Type>.<id>]`. The
  Adventure build rewrites refs to **bundled** packs into world UUIDs (`@UUID[Actor.<id>]`) — they
  become world docs on import — and leaves refs to `_library` packs as compendium UUIDs. After you
  import, edit in Foundry, and unpack, refs return as world UUIDs; `npm run normalize`
  (`scripts/normalize-refs.ts`) rewrites them back so sources don't drift.
- **Scene tokens.** The build keeps only tokens whose actor is bundled (and links them to the
  imported actor); it drops the rest — world party placeholders and NPCs whose actor isn't bundled
  would otherwise import actorless.
- **Runtime prompt.** `promptAdventureImport()` (`src/adventure.ts`) discovers the module's Adventure
  pack and prompts the GM once (gated by `core.adventureImports`); no-op when none is registered.

An `Adventure` pack's source is a single document with `_key` `!adventures!<id>`, embedding its
content under `scenes`/`journal`/`actors`/`items`/`macros`/`folders`/… — but you don't hand-author it;
`build-adventure.ts` assembles it from the per-type sources.

## Runtime access

Reading packs at runtime is the `game.packs.get('<id>.<name>')` API — see
`foundry-api.md`.
