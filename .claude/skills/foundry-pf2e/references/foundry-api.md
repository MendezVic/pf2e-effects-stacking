# Foundry API (v13/v14) — quick reference

Everything lives under the `foundry.*` tree; the old bare globals are off-limits (see
the v14 hard rule in SKILL.md).

## Contents
- Ambient globals
- Namespaces
- `game.*`
- Hooks & lifecycle
- Documents & flags
- Settings
- UI entry points
- Packs (runtime API)

## Ambient globals (never import)

The `foundry-pf2e` types supply `game`, `ui`, `canvas`, `CONFIG`, `CONST`, `Hooks`,
`foundry`, and `Roll` as ambient globals — reference them directly, no import.

## Namespaces

- `foundry.utils` — `mergeObject`, `deepClone`, `duplicate`, `randomID`,
  `getProperty`/`setProperty`, `expandObject`/`flattenObject`, `debounce`,
  `fromUuid`/`fromUuidSync`.
- `foundry.documents` — Actor, Item, Scene, JournalEntry, Macro, …
- `foundry.abstract` — `Document`, `DataModel`, `TypeDataModel`.
- `foundry.applications` — UI (ApplicationV2, DialogV2, handlebars helpers).
- `foundry.data.fields` — schema field classes for DataModel.
- `foundry.canvas`, `foundry.dice.Roll`, `foundry.helpers`.

## `game.*`

`game.user` / `game.userId` / `game.user.isGM`, `game.users`, `game.actors`,
`game.items`, `game.scenes`, `game.journal`, `game.macros`,
`game.modules.get(id)?.version`, `game.settings`, `game.socket`, `game.i18n`,
`game.packs.get('module.id.pack')`, `game.ready`. In a PF2e world `game` is typed
`GamePF2e`.

## Hooks (`Hooks.on/once/off/call/callAll`)

- **Lifecycle:** `init` (register settings/classes) → `i18nInit` → `setup` → `ready`
  (game state safe) → `canvasReady`.
- **Documents:** `create/update/delete{Actor,Item,Scene,…}` and
  `preCreate/preUpdate/preDelete*` (return `false` to cancel). `updateUser`,
  `userConnected`.
- **ApplicationV2:** `render{ClassName}(app, html, context, options)`,
  `close{ClassName}`.

## Documents & flags

`Doc.create(data)`, `doc.update(changes)`, `doc.delete()`; embedded via
`create/update/deleteEmbeddedDocuments(name, …)`. Persisted module state lives in
**flags**: `doc.getFlag('<id>', key)` / `setFlag(...)` / `unsetFlag(...)` (stored at
`doc.flags['<id>']`). For structured custom data use `foundry.abstract.DataModel` +
`static defineSchema()` with `foundry.data.fields.*`.

## Settings

```ts
game.settings.register('<id>', key, {
  scope: 'world' | 'client' | 'user',
  config, type, default, onChange,
});
```

Then `game.settings.get/set`. `world` = shared (GM writes); `client` = per-browser;
`user` = per-user. `registerMenu` for config apps.

## UI entry points (V2 only)

- `foundry.applications.api.ApplicationV2` (+ `HandlebarsApplicationMixin` for static
  markup, or mount Svelte — see `svelte-in-applicationv2.md`). Statics:
  `DEFAULT_OPTIONS`, `PARTS`, lifecycle `_prepareContext()`, `_renderHTML()`,
  `_replaceHTML()`, `actions`.
- Dialogs: `foundry.applications.api.DialogV2.wait({...})`.
- Toasts: `ui.notifications.info/warn/error`.
- Never `Application` / `FormApplication` / `Dialog`.

## Packs (runtime API)

```ts
const pack = game.packs.get('<id>.<name>');
await pack.getIndex();
await pack.getDocument(docId);
await pack.getDocuments();
await pack.importAll();
```

(Building/editing packs is a separate workflow — see `packs-cli.md`.)
