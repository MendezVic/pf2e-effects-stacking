import './styles.css';
import { MODULE_ID } from './constants';
import { patchPF2eStacking } from './pf2e-patch';

interface ModuleApi {
  version: string;
  stackingPatched: boolean;
}

Hooks.once('init', () => {
  console.log(`${MODULE_ID} | init`);
});

Hooks.once('ready', () => {
  const module = game.modules.get(MODULE_ID);
  const version = module?.version ?? '0.0.0';
  const stackingPatched = patchPF2eStacking();
  const api: ModuleApi = { version, stackingPatched };
  // `api` is the Foundry convention for a public API, but isn't a typed field on Module.
  if (module) (module as { api?: ModuleApi }).api = api;
  console.log(`${MODULE_ID} | ready (v${version}, stacking patched: ${stackingPatched})`);
});
