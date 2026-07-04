import { MODULE_ID } from './constants';
import { applyUnifiedEffectStacking } from './effect-stacking';
import { debugLog } from './aura/debug';
import { patchPF2eAuraEffects, scheduleAuraEffectRefreshForActor, scheduleAuraEffectRefreshForScene } from './aura/lifecycle';
import type { FlatModifierRuleElementInstance, PF2eGame, StatisticModifierInstance } from './pf2e/types';

export { scheduleAuraEffectRefreshForActor, scheduleAuraEffectRefreshForScene };

function isPatched(method: unknown): boolean {
  return typeof method === 'function' && Reflect.get(method, MODULE_ID) === true;
}

function patchPF2eAuraFlatModifierSlugs(): boolean {
  const FlatModifier = (game as PF2eGame).pf2e?.RuleElements?.builtin?.FlatModifier;
  const prototype = FlatModifier?.prototype;

  if (!prototype || isPatched(prototype.beforePrepareData)) return false;

  const originalBeforePrepareData = prototype.beforePrepareData;

  const beforePrepareData = function (this: FlatModifierRuleElementInstance): void {
    const aura = this.item?.flags?.pf2e?.aura;
    const sourceId = this.item?.sourceId;

    if (aura?.origin && sourceId && !this.slug) {
      this.slug = `${sourceId}.${aura.slug ?? 'aura'}.${aura.origin}`;
    }

    return originalBeforePrepareData.call(this);
  };

  Reflect.set(beforePrepareData, MODULE_ID, true);
  prototype.beforePrepareData = beforePrepareData;

  debugLog('flat modifier aura slug patch installed');
  return true;
}

function patchPF2eStatisticModifiers(): boolean {
  const StatisticModifier = (game as PF2eGame).pf2e?.StatisticModifier;
  const prototype = StatisticModifier?.prototype;

  if (!prototype || isPatched(prototype.calculateTotal)) return false;

  const originalCalculateTotal = prototype.calculateTotal;

  const calculateTotal = function (this: StatisticModifierInstance, rollOptions: Set<string> = new Set()): void {
    originalCalculateTotal.call(this, rollOptions);
    this.totalModifier = applyUnifiedEffectStacking(this._modifiers);
  };

  Reflect.set(calculateTotal, MODULE_ID, true);
  prototype.calculateTotal = calculateTotal;

  return true;
}

export function patchPF2eStacking(): boolean {
  const flatModifierSlugsPatched = patchPF2eAuraFlatModifierSlugs();
  const statisticModifiersPatched = patchPF2eStatisticModifiers();
  const auraEffectsPatched = patchPF2eAuraEffects();

  return flatModifierSlugsPatched || statisticModifiersPatched || auraEffectsPatched;
}
