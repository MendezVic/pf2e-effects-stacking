import { MODULE_ID } from './constants';
import { applyUnifiedEffectStacking, type StackableModifier } from './effect-stacking';

type StatisticModifierConstructor = {
  prototype: {
    calculateTotal: (rollOptions?: Set<string>) => void;
  };
};

type PF2eGame = typeof game & {
  pf2e?: {
    StatisticModifier?: StatisticModifierConstructor;
  };
};

type StatisticModifierInstance = {
  _modifiers: StackableModifier[];
  totalModifier: number;
};

function isPatched(calculateTotal: unknown): boolean {
  return typeof calculateTotal === 'function' && Reflect.get(calculateTotal, MODULE_ID) === true;
}

export function patchPF2eStacking(): boolean {
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
