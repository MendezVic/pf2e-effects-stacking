# Multi-client sync (the ReignMaker pattern)

Use this when module state must stay consistent across every connected client. The
runegoblin `pf2e-reignmaker` module is the worked reference (Svelte stores fed by
document hooks). Add the heavier parts (race safety) only once you actually have
concurrent writers.

## Two propagation channels — use the right one

1. **Document updates = the default sync.** Persist state in a document flag (e.g. the
   party actor: `actor.setFlag('<id>', 'state', data)`). When the GM writes it, Foundry
   broadcasts an `updateActor` hook to *every* client; each client's
   `Hooks.on('updateActor', …)` refreshes its local store. The update fans out on its
   own — don't also send it over the socket. This is the authoritative path.
2. **Raw socket = transient, non-persisted signals** (force-reload, "console clear", a
   popup on all clients). `game.socket` needs `"socket": true` in `module.json`.

## GM-authority request/reply

Only the GM may write world documents, so non-GM clients ask the GM to write.

- Channel constant: `'module.<id>'` (always `module.<id>`).
- Register once on every client: `game.socket.on('module.<id>', handleMessage)`; emit
  with `game.socket.emit('module.<id>', message)`.
- A non-GM "dispatch" emits `{ action, data, senderId, requestId, kind: 'request' }`
  and awaits a reply. The GM (`game.user.isGM`) runs the handler, writes the document,
  and emits `{ kind: 'result' | 'error', requestId, targetId: senderId, data }`. Only
  the client whose `game.user.id === targetId` resolves its pending promise (keyed by
  `requestId`); time out after ~10s if no GM replies. A GM caller runs the handler
  locally instead of emitting.
- **Foundry does not echo `emit` back to the sender.** So a broadcast the sender must
  also react to calls a local handler directly; and request/reply needs the explicit
  reply message (there's no echo to rely on).

## Race safety (concurrent writers)

Flags carry a `version`. A write includes `expectedVersion`; the GM handler rejects a
stale write (`VersionConflictError`), serialized behind a per-document write lock; the
caller re-reads, recomputes, and retries. Add this only once you have concurrent
mutators.

## Readiness gate

Socket handlers `await` an init promise (resolved on `ready`, once the backing document
is loaded) so messages buffered during startup don't run against null state.

## Source files in reignmaker

`src/services/ActionDispatcher.ts`, `src/hooks/kingdomSync.ts`, `src/stores/KingdomStore.ts`.
