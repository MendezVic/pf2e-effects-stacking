import './styles.css';
import { MODULE_ID } from './constants';
import { patchPF2eStacking, scheduleAuraEffectRefreshForActor, scheduleAuraEffectRefreshForScene, userCanManageAuraEffects } from './pf2e-patch';
import { debugLogsEnabled, registerSettings } from './settings';

interface ModuleApi {
  version: string;
  stackingPatched: boolean;
}

function tokenEmitsAuras(token: unknown): boolean {
  if (!token || typeof token !== 'object') return false;

  const candidate = token as {
    actor?: { auras?: Map<unknown, unknown> | null } | null;
    document?: { auras?: Map<unknown, unknown> | null } | null;
    auras?: Map<unknown, unknown> | null;
  };
  return Boolean(candidate.actor?.auras?.size || candidate.document?.auras?.size || candidate.auras?.size);
}

function tokenSummary(token: unknown): Record<string, unknown> {
  if (!token || typeof token !== 'object') return { token: null };

  const candidate = token as {
    id?: string;
    name?: string;
    actor?: { name?: string; uuid?: string; auras?: Map<unknown, unknown> | null } | null;
    document?: { uuid?: string; x?: number; y?: number; auras?: Map<unknown, unknown> | null } | null;
    auras?: Map<unknown, unknown> | null;
  };

  return {
    id: candidate.id,
    name: candidate.name,
    uuid: candidate.document?.uuid,
    actor: candidate.actor?.name,
    actorUuid: candidate.actor?.uuid,
    x: candidate.document?.x,
    y: candidate.document?.y,
    emitsAuras: tokenEmitsAuras(token),
    actorAuras: [...(candidate.actor?.auras?.keys?.() ?? [])],
    documentAuras: [...(candidate.document?.auras?.keys?.() ?? [])],
    objectAuras: [...(candidate.auras?.keys?.() ?? [])],
  };
}

function debugTokenHook(hook: string, token: unknown, data?: Record<string, unknown>): void {
  if (!debugLogsEnabled()) return;
  console.debug(`${MODULE_ID} | token | ${hook}`, {
    token: tokenSummary(token),
    ...data,
  });
}

function isManagedAuraItem(item: { flags?: Record<string, unknown> }): boolean {
  const flags = item.flags?.[MODULE_ID];
  return Boolean(
    flags &&
    typeof flags === 'object' &&
    ('managedAuraEffect' in flags || Array.isArray((flags as Record<string, unknown>).auraContributions))
  );
}

Hooks.once('init', () => {
  registerSettings();
  if (debugLogsEnabled()) console.debug(`${MODULE_ID} | module initialized`);
});

Hooks.once('ready', () => {
  const module = game.modules.get(MODULE_ID);
  const version = module?.version ?? '0.0.0';
  const stackingPatched = patchPF2eStacking();
  const api: ModuleApi = { version, stackingPatched };
  // `api` is the Foundry convention for a public API, but isn't a typed field on Module.
  if (module) (module as { api?: ModuleApi }).api = api;
  if (debugLogsEnabled()) {
    console.debug(`${MODULE_ID} | module ready`, {
      version,
      stackingPatched,
    });
  }
  scheduleAuraEffectRefreshForScene('ready');
});

Hooks.once('canvasReady', () => {
  scheduleAuraEffectRefreshForScene('canvasReady');
});

Hooks.on('updateToken', (token, changes) => {
  if (!userCanManageAuraEffects()) return;
  if (!('x' in changes) && !('y' in changes) && !('elevation' in changes)) return;

  if (tokenEmitsAuras(token)) {
    debugTokenHook('updateToken -> scene refresh', token, { changes, reason: 'updateToken:auraSource' });
    scheduleAuraEffectRefreshForScene('updateToken:auraSource');
  } else {
    debugTokenHook('updateToken -> actor refresh', token, { changes, reason: 'updateToken' });
    scheduleAuraEffectRefreshForActor(token.actor, 'updateToken');
  }
});

Hooks.on('createToken', (token) => {
  if (!userCanManageAuraEffects()) return;

  if (tokenEmitsAuras(token)) {
    debugTokenHook('createToken -> scene refresh', token, { reason: 'createToken:auraSource' });
    scheduleAuraEffectRefreshForScene('createToken:auraSource');
  } else {
    debugTokenHook('createToken -> actor refresh', token, { reason: 'createToken' });
    scheduleAuraEffectRefreshForActor(token.actor, 'createToken');
  }
});

Hooks.on('deleteToken', (token) => {
  if (!userCanManageAuraEffects()) return;

  const reason = tokenEmitsAuras(token) ? 'deleteToken:auraSource' : 'deleteToken';
  debugTokenHook('deleteToken -> scene refresh', token, { reason });
  scheduleAuraEffectRefreshForScene(reason);
});

Hooks.on('createItem', (item) => {
  if (!userCanManageAuraEffects()) return;
  if (item.type !== 'effect') return;
  if (isManagedAuraItem(item)) return;

  // A stance can add an aura through its rules without the stance item itself
  // carrying flags.pf2e.aura. Refresh every potentially affected actor after
  // PF2e has rebuilt the source actor's auras.
  scheduleAuraEffectRefreshForScene('createItem:effect');
});

Hooks.on('updateItem', (item) => {
  if (!userCanManageAuraEffects()) return;
  if (item.type !== 'effect') return;
  if (isManagedAuraItem(item)) return;

  scheduleAuraEffectRefreshForScene('updateItem:effect');
});

Hooks.on('deleteItem', (item) => {
  if (!userCanManageAuraEffects()) return;
  if (item.type !== 'effect') return;
  if (isManagedAuraItem(item)) return;

  scheduleAuraEffectRefreshForScene('deleteItem:effect');
});
