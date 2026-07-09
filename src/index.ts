import './styles.css';
import { MODULE_ID } from './constants';
import { patchPF2eStacking, scheduleAuraEffectRefreshForActor, scheduleAuraEffectRefreshForScene, userCanManageAuraEffects } from './pf2e-patch';
import { debugLogsEnabled, registerSettings } from './settings';

interface ModuleApi {
  version: string;
  stackingPatched: boolean;
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

  scheduleAuraEffectRefreshForActor(token.actor, 'updateToken');
});

Hooks.on('createItem', (item) => {
  if (!userCanManageAuraEffects()) return;
  if (item.type !== 'effect' || !item.flags?.pf2e?.aura) return;

  scheduleAuraEffectRefreshForActor(item.actor, 'createItem');
});

Hooks.on('deleteItem', (item) => {
  if (!userCanManageAuraEffects()) return;
  if (item.type !== 'effect' || !item.flags?.pf2e?.aura) return;

  scheduleAuraEffectRefreshForActor(item.actor, 'deleteItem');
});
