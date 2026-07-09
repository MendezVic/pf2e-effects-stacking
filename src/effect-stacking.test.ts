import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyUnifiedEffectStacking, type StackableModifier } from './effect-stacking';
import { MODULE_ID } from './constants';
import { buildAggregatedEffectUpdate } from './aura/aggregation';
import { scheduleAuraEffectRefreshForActor } from './aura/lifecycle';

type ModifierData = Partial<StackableModifier> & Pick<StackableModifier, 'slug' | 'modifier' | 'source'>;

function modifier(data: ModifierData): StackableModifier {
  return {
    label: data.slug,
    type: 'status',
    enabled: true,
    ignored: false,
    ...data,
  };
}

function apply(modifiers: StackableModifier[]): { total: number; enabled: boolean[]; ignored: boolean[] } {
  return {
    total: applyUnifiedEffectStacking(modifiers),
    enabled: modifiers.map((item) => item.enabled),
    ignored: modifiers.map((item) => item.ignored),
  };
}

(globalThis as unknown as { foundry: { utils: Record<string, unknown> } }).foundry = {
  utils: {
    deepClone: <T>(value: T): T => structuredClone(value),
    escapeHTML: (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    getProperty: (source: Record<string, unknown>, path: string): unknown => {
      return path.split('.').reduce<unknown>((value, key) => {
        return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
      }, source);
    },
  },
};

function aggregateEffect(data: {
  description: string;
  rules: Record<string, unknown>[];
  baseRules?: Record<string, unknown>[];
  contributions?: unknown[];
  sourceId?: string | null;
  duplicateSource?: string;
}): {
  type: 'effect';
  id: string;
  sourceId: string | null;
  flags: { pf2e: { aura: { slug: string; origin: string; removeOnExit: boolean } }; [MODULE_ID]?: Record<string, unknown> };
  system: { description: { value: string }; rules: Record<string, unknown>[] };
  toObject: () => Record<string, unknown>;
  update: () => Promise<unknown>;
} {
  const source = {
    type: 'effect' as const,
    id: 'effect-id',
    sourceId: data.sourceId === undefined ? 'Compendium.test.Item.effect' : data.sourceId,
    flags: {
      pf2e: { aura: { slug: 'test-aura', origin: 'Actor.source-a', removeOnExit: true } },
      [MODULE_ID]: {
        ...(data.baseRules ? { baseRules: data.baseRules } : {}),
        ...(data.contributions ? { auraContributions: data.contributions } : {}),
      },
    },
    system: {
      description: { value: data.description },
      rules: data.rules,
    },
    _stats: data.duplicateSource ? { duplicateSource: data.duplicateSource } : {},
    update: async () => null,
  };

  return {
    ...source,
    toObject: () => structuredClone({
      type: source.type,
      id: source.id,
      sourceId: source.sourceId,
      flags: source.flags,
      system: source.system,
      _stats: source._stats,
    }),
  };
}

const twoAuraContributions = [
  {
    origin: 'Actor.source-a',
    name: 'Hei',
    token: 'Scene.scene.Token.source-a',
    auraSlug: 'test-aura',
    sourceId: 'Compendium.test.Item.effect',
    removeOnExit: true,
  },
  {
    origin: 'Actor.source-b',
    name: 'Lini',
    token: 'Scene.scene.Token.source-b',
    auraSlug: 'test-aura',
    sourceId: 'Compendium.test.Item.effect',
    removeOnExit: true,
  },
];

describe('applyUnifiedEffectStacking', () => {
  it('stacks same-type bonuses from different sources even when they have the same name', () => {
    const modifiers = [
      modifier({ slug: 'inspired-defense', modifier: 1, source: 'bard-a' }),
      modifier({ slug: 'inspired-defense', modifier: 1, source: 'bard-b' }),
    ];

    expect(apply(modifiers)).toEqual({
      total: 2,
      enabled: [true, true],
      ignored: [false, false],
    });
  });

  it('stacks same-source aura bonuses from different originating effect items', () => {
    const modifiers = [
      modifier({
        slug: 'protective-wards',
        modifier: 1,
        source: 'Protective Wards',
        rule: { item: { uuid: 'Actor.ally-a.Item.protective-wards-effect' } },
      }),
      modifier({
        slug: 'protective-wards',
        modifier: 1,
        source: 'Protective Wards',
        rule: { item: { uuid: 'Actor.ally-b.Item.protective-wards-effect' } },
      }),
    ];

    expect(apply(modifiers)).toEqual({
      total: 2,
      enabled: [true, true],
      ignored: [false, false],
    });
  });

  it('stacks same-source aura bonuses from different aura origins even with the same effect source id', () => {
    const modifiers = [
      modifier({
        slug: 'protective-wards',
        modifier: 1,
        source: 'Actor.target.Item.effect-a',
        rule: {
          item: {
            uuid: 'Actor.target.Item.effect-a',
            sourceId: 'Compendium.pf2e.spell-effects.Item.dWbg2gACxMkSnZag',
            flags: { pf2e: { aura: { slug: 'protective-ward', origin: 'Actor.caster-a' } } },
          },
        },
      }),
      modifier({
        slug: 'protective-wards',
        modifier: 1,
        source: 'Actor.target.Item.effect-b',
        rule: {
          item: {
            uuid: 'Actor.target.Item.effect-b',
            sourceId: 'Compendium.pf2e.spell-effects.Item.dWbg2gACxMkSnZag',
            flags: { pf2e: { aura: { slug: 'protective-ward', origin: 'Actor.caster-b' } } },
          },
        },
      }),
    ];

    expect(apply(modifiers)).toEqual({
      total: 2,
      enabled: [true, true],
      ignored: [false, false],
    });
  });

  it('keeps only the highest same-source bonus from the same originating effect item', () => {
    const modifiers = [
      modifier({
        slug: 'minor-defense',
        modifier: 1,
        source: 'Protective Wards',
        rule: { item: { uuid: 'Actor.ally-a.Item.protective-wards-effect' } },
      }),
      modifier({
        slug: 'major-defense',
        modifier: 2,
        source: 'Protective Wards',
        rule: { item: { uuid: 'Actor.ally-a.Item.protective-wards-effect' } },
      }),
    ];

    expect(apply(modifiers)).toEqual({
      total: 2,
      enabled: [false, true],
      ignored: [false, false],
    });
  });

  it('keeps only the highest same-type bonus from the same source', () => {
    const modifiers = [
      modifier({ slug: 'minor-defense', modifier: 1, source: 'same-effect' }),
      modifier({ slug: 'major-defense', modifier: 2, source: 'same-effect' }),
    ];

    expect(apply(modifiers)).toEqual({
      total: 2,
      enabled: [false, true],
      ignored: [false, false],
    });
  });

  it('stacks same-type penalties from different sources even when they have the same name', () => {
    const modifiers = [
      modifier({ slug: 'sickened', modifier: -1, source: 'stench-aura' }),
      modifier({ slug: 'sickened', modifier: -1, source: 'poison' }),
    ];

    expect(apply(modifiers)).toEqual({
      total: -2,
      enabled: [true, true],
      ignored: [false, false],
    });
  });

  it('keeps only the lowest same-type penalty from the same source', () => {
    const modifiers = [
      modifier({ slug: 'sickened', modifier: -1, source: 'same-effect' }),
      modifier({ slug: 'sickened', modifier: -2, source: 'same-effect' }),
    ];

    expect(apply(modifiers)).toEqual({
      total: -2,
      enabled: [false, true],
      ignored: [false, false],
    });
  });

  it('keeps bonus and penalty stacking independent for the same source', () => {
    const modifiers = [
      modifier({ slug: 'blessed', modifier: 1, source: 'same-effect' }),
      modifier({ slug: 'cursed', modifier: -1, source: 'same-effect' }),
    ];

    expect(apply(modifiers)).toEqual({
      total: 0,
      enabled: [true, true],
      ignored: [false, false],
    });
  });

  it('continues to always include untyped modifiers', () => {
    const modifiers = [
      modifier({ slug: 'first', modifier: 1, source: null, type: 'untyped' }),
      modifier({ slug: 'second', modifier: 2, source: null, type: 'untyped' }),
    ];

    expect(apply(modifiers)).toEqual({
      total: 3,
      enabled: [true, true],
      ignored: [false, false],
    });
  });

  it('preserves ability modifiers that PF2e already enabled', () => {
    const modifiers = [
      modifier({ slug: 'str', modifier: 1, source: null, type: 'ability' }),
      modifier({ slug: 'dex', modifier: 4, source: null, type: 'ability' }),
    ];

    expect(apply(modifiers)).toEqual({
      total: 5,
      enabled: [true, true],
      ignored: [false, false],
    });
  });

  it('preserves modifiers that PF2e already ignored', () => {
    const modifiers = [
      modifier({ slug: 'inactive', modifier: 3, source: 'inactive-effect', enabled: true, ignored: true }),
      modifier({ slug: 'active', modifier: 2, source: 'active-effect' }),
    ];

    expect(apply(modifiers)).toEqual({
      total: 2,
      enabled: [false, true],
      ignored: [true, false],
    });
  });

  it('preserves forced modifiers even when another modifier from the same source is better', () => {
    const modifiers = [
      modifier({ slug: 'forced', modifier: 1, source: 'same-effect', force: true }),
      modifier({ slug: 'better', modifier: 2, source: 'same-effect' }),
    ];

    expect(apply(modifiers)).toEqual({
      total: 3,
      enabled: [true, true],
      ignored: [false, false],
    });
  });
});

describe('buildAggregatedEffectUpdate', () => {
  it('scales a merged Protective Wards effect and lists each aura source', () => {
    const update = buildAggregatedEffectUpdate(
      aggregateEffect({
        description: '<p>You gain a +1 status bonus to AC.</p>',
        rules: [
          {
            key: 'FlatModifier',
            selector: 'ac',
            type: 'status',
            value: 1,
          },
        ],
      }),
      twoAuraContributions,
    );

    expect(update['system.rules']).toEqual([
      {
        key: 'FlatModifier',
        selector: 'ac',
        type: 'status',
        value: 2,
      },
    ]);
    expect(update['system.description.value']).toContain('You gain a +2 status bonus to AC.');
    expect(update['system.description.value']).toContain('+1 ac from Hei');
    expect(update['system.description.value']).toContain('+1 ac from Lini');
    expect(update[`flags.${MODULE_ID}.auraContributions`]).toEqual(twoAuraContributions);
  });

  it('scales a merged Dirge-style condition minimum and the granted condition badge', () => {
    const update = buildAggregatedEffectUpdate(
      aggregateEffect({
        description: "<p>Creatures with this effect won't automatically reduce their Frightened value below 1.</p>",
        rules: [
          {
            key: 'ActiveEffectLike',
            mode: 'add',
            path: 'flags.xdy-pf2e-workbench.condition.frightened.min',
            value: 1,
          },
          {
            key: 'GrantItem',
            uuid: 'Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL',
            allowDuplicate: true,
            inMemoryOnly: true,
          },
        ],
      }),
      twoAuraContributions,
    );

    expect(update['system.rules']).toEqual([
      {
        key: 'ActiveEffectLike',
        mode: 'add',
        path: 'flags.xdy-pf2e-workbench.condition.frightened.min',
        value: 2,
      },
      {
        key: 'GrantItem',
        uuid: 'Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL',
        allowDuplicate: true,
        inMemoryOnly: true,
        alterations: [
          {
            mode: 'override',
            property: 'badge-value',
            value: 2,
          },
        ],
      },
    ]);
    expect(update['system.description.value']).toContain('<li>Hei</li>');
    expect(update['system.description.value']).toContain('<li>Lini</li>');
    expect(update['system.description.value']).not.toContain('AC from');
  });

  it('recovers a valid base value from an older stacked Dirge effect with polluted base rules', () => {
    const update = buildAggregatedEffectUpdate(
      aggregateEffect({
        description: "<p>Creatures with this effect won't automatically reduce their Frightened value below 1.</p>",
        baseRules: [
          {
            key: 'ActiveEffectLike',
            mode: 'add',
            path: 'flags.xdy-pf2e-workbench.condition.frightened.min',
            value: 0.5,
          },
        ],
        contributions: twoAuraContributions,
        rules: [
          {
            key: 'ActiveEffectLike',
            mode: 'add',
            path: 'flags.xdy-pf2e-workbench.condition.frightened.min',
            value: 2,
          },
          {
            key: 'GrantItem',
            uuid: 'Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL',
            allowDuplicate: true,
            inMemoryOnly: true,
          },
        ],
      }),
      twoAuraContributions,
    );

    expect(update['system.rules']).toEqual([
      {
        key: 'ActiveEffectLike',
        mode: 'add',
        path: 'flags.xdy-pf2e-workbench.condition.frightened.min',
        value: 2,
      },
      {
        key: 'GrantItem',
        uuid: 'Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL',
        allowDuplicate: true,
        inMemoryOnly: true,
        alterations: [
          {
            mode: 'override',
            property: 'badge-value',
            value: 2,
          },
        ],
      },
    ]);
    expect(update[`flags.${MODULE_ID}.baseRules`]).toEqual([
      {
        key: 'ActiveEffectLike',
        mode: 'add',
        path: 'flags.xdy-pf2e-workbench.condition.frightened.min',
        value: 1,
      },
      {
        key: 'GrantItem',
        uuid: 'Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL',
        allowDuplicate: true,
        inMemoryOnly: true,
      },
    ]);
  });

  it('falls back to duplicateSource when an aura effect has no sourceId', () => {
    const update = buildAggregatedEffectUpdate(
      aggregateEffect({
        description: '<p>You gain a +1 status bonus to AC.</p>',
        sourceId: null,
        duplicateSource: 'Compendium.test.Item.effect',
        rules: [
          {
            key: 'FlatModifier',
            selector: 'ac',
            type: 'status',
            value: 1,
          },
        ],
      }),
      twoAuraContributions,
    );

    expect(update[`flags.${MODULE_ID}.baseRules`]).toEqual([
      {
        key: 'FlatModifier',
        selector: 'ac',
        type: 'status',
        value: 1,
      },
    ]);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('scheduleAuraEffectRefreshForActor', () => {
  it('does not run overlapping refreshes for the same actor', async () => {
    vi.useFakeTimers();

    let resolveDelete: () => void = () => undefined;
    const deleteBlocker = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    let activeDeletes = 0;
    let maxActiveDeletes = 0;
    let deleteCalls = 0;

    const staleEffect = aggregateEffect({
      description: '',
      rules: [],
      sourceId: 'Compendium.test.Item.effect',
    });
    const actor = {
      uuid: 'Actor.target',
      name: 'Target',
      itemTypes: { effect: [staleEffect] },
      getActiveTokens: () => [],
      deleteEmbeddedDocuments: async () => {
        deleteCalls += 1;
        activeDeletes += 1;
        maxActiveDeletes = Math.max(maxActiveDeletes, activeDeletes);
        await deleteBlocker;
        actor.itemTypes.effect = [];
        activeDeletes -= 1;
        return [];
      },
    };

    (globalThis as unknown as { game: unknown }).game = {
      user: { id: 'gm', isGM: true },
      users: { activeGM: { id: 'gm' } },
    };
    (globalThis as unknown as { canvas: unknown }).canvas = {
      ready: true,
      tokens: {
        placeables: [],
      },
    };
    (globalThis as unknown as { window: unknown }).window = globalThis;

    scheduleAuraEffectRefreshForActor(actor, 'test');

    await vi.advanceTimersByTimeAsync(100);
    expect(deleteCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(250);
    expect(deleteCalls).toBe(1);
    expect(maxActiveDeletes).toBe(1);

    resolveDelete();
    await vi.runOnlyPendingTimersAsync();

    expect(maxActiveDeletes).toBe(1);
  });
});
