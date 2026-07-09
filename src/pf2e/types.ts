import type { StackableModifier } from '../effect-stacking';

export type StatisticModifierConstructor = {
  prototype: {
    calculateTotal: (rollOptions?: Set<string>) => void;
  };
};

export type AuraData = {
  slug: string;
  level: number | null;
  traits: string[];
  effects: AuraEffectData[];
};

export type AuraEffectData = {
  uuid: string;
  removeOnExit: boolean;
  affects: 'allies' | 'enemies' | 'all';
  includesSelf: boolean;
  parent: {
    uuid: string;
    slug?: string | null;
    system?: {
      traits?: {
        otherTags?: string[];
      };
    };
    getRollOptions?: (prefix?: 'parent') => string[];
  };
  predicate: {
    length: number;
    test: (options: string[]) => boolean;
  };
  alterations: {
    applyTo: (source: Record<string, unknown>) => void;
  }[];
};

export type AuraOrigin = {
  actor: {
    uuid: string;
    name: string;
    getRollOptions: () => string[];
  };
  token: {
    uuid: string;
    hidden: boolean;
  };
};

export type PF2eGame = typeof game & {
  pf2e?: {
    RuleElements?: {
      builtin?: {
        FlatModifier?: FlatModifierRuleElementConstructor;
      };
    };
    StatisticModifier?: StatisticModifierConstructor;
  };
};

export type FlatModifierRuleElementConstructor = {
  prototype: FlatModifierRuleElementInstance;
};

export type FlatModifierRuleElementInstance = {
  slug?: string | null;
  item?: {
    sourceId?: string | null;
    flags?: {
      pf2e?: {
        aura?: {
          slug?: string;
          origin?: string;
        };
      };
    };
  };
  beforePrepareData: () => void;
};

export type StatisticModifierInstance = {
  _modifiers: StackableModifier[];
  totalModifier: number;
};

export type ActorPF2eConstructor = {
  prototype: ActorPF2eInstance;
};

export type ActorPF2eInstance = {
  uuid: string;
  name: string;
  primaryUpdater: unknown;
  allowedItemTypes: string[];
  itemTypes: {
    effect: EffectItem[];
  };
  isOfType: (type: 'party') => boolean;
  isAllyOf: (actor: AuraOrigin['actor']) => boolean;
  isEnemyOf: (actor: AuraOrigin['actor']) => boolean;
  getSelfRollOptions: (prefix?: 'target') => string[];
  getActiveTokens: (linked?: boolean, document?: boolean) => unknown[];
  applyAreaEffects: (aura: AuraData, origin: AuraOrigin) => Promise<void>;
  createEmbeddedDocuments: (embeddedName: 'Item', data: Record<string, unknown>[]) => Promise<unknown[]>;
  deleteEmbeddedDocuments: (embeddedName: 'Item', ids: string[]) => Promise<unknown[]>;
};

export type EffectItem = {
  type: string;
  id: string;
  name?: string;
  sourceId: string | null;
  flags: {
    pf2e?: {
      aura?: {
        slug?: string;
        origin?: string;
        removeOnExit?: boolean;
      };
    };
  };
  system?: {
    description?: {
      value?: string;
    };
    rules?: Record<string, unknown>[];
  };
  update: (data: Record<string, unknown>) => Promise<unknown>;
  toObject: () => Record<string, unknown>;
};

export type AuraContribution = {
  origin: string;
  name: string;
  token: string;
  auraSlug: string;
  sourceId: string;
  removeOnExit: boolean;
};

export type AuraContributionGroup = {
  aura: AuraData;
  auraEffect: AuraEffectData;
  origin: AuraOrigin;
  contributions: AuraContribution[];
};

export type RuntimeAura = {
  containsToken?: (token: unknown) => boolean;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  squares?: {
    x: number;
    y: number;
    width: number;
    height: number;
    active?: boolean;
  }[];
};

export type RuntimeAuraActor = AuraOrigin['actor'] & {
  auras?: Map<string, AuraData>;
  getActiveTokens?: (linked?: boolean, document?: boolean) => { auras?: Map<string, RuntimeAura> }[];
};

export type RuntimeToken = {
  actor?: RuntimeAuraActor | null;
  document?: {
    uuid?: string;
    hidden?: boolean;
    auras?: Map<string, RuntimeAura>;
  };
  auras?: Map<string, RuntimeAura>;
};
