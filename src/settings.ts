import { MODULE_ID } from './constants';

export const DEBUG_LOGS_SETTING = 'debugLogs';

export function registerSettings(): void {
  game.settings.register(MODULE_ID, DEBUG_LOGS_SETTING, {
    name: game.i18n.localize(`${MODULE_ID}.settings.debugLogs.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.debugLogs.hint`),
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
  });
}

export function debugLogsEnabled(): boolean {
  try {
    return game.settings.get(MODULE_ID, DEBUG_LOGS_SETTING) === true;
  } catch {
    return false;
  }
}
