import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyUnifiedEffectStacking, type StackableModifier } from './effect-stacking';
import { MODULE_ID } from './constants';
import { buildAggregatedEffectUpdate } from './aura/aggregation';
import { scheduleAuraEffectRefreshForActor, updateEffectIfChanged } from './aura/lifecycle';

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
    fromUuid: async () => null,
    getProperty: (source: Record<string, unknown>, path: string): unknown => {
      return path.split('.').reduce<unknown>((value, key) => {
        return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
      }, source);
    },
    mergeObject: <T extends Record<string, unknown>, U extends Record<string, unknown>>(source: T, update: U): T & U => {
      return { ...source, ...update };
    },
    setProperty: (source: Record<string, unknown>, path: string, value: unknown): void => {
      const parts = path.split('.');
      let target = source;
      for (const part of parts.slice(0, -1)) {
        const next = target[part];
        if (!next || typeof next !== 'object') target[part] = {};
        target = target[part] as Record<string, unknown>;
      }
      target[parts.at(-1) ?? path] = value;
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
  update: (data: Record<string, unknown>) => Promise<unknown>;
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
  it('keeps only the highest same-type bonus from different sources with the same name', () => {
    const modifiers = [
      modifier({ slug: 'inspired-defense', modifier: 1, source: 'bard-a' }),
      modifier({ slug: 'inspired-defense', modifier: 2, source: 'bard-b' }),
    ];

    expect(apply(modifiers)).toEqual({
      total: 2,
      enabled: [false, true],
      ignored: [false, false],
    });
  });

  it('keeps only the highest same-name aura bonus from different originating effect items', () => {
    const modifiers = [
      modifier({
        slug: 'protective-wards',
        modifier: 2,
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
      enabled: [true, false],
      ignored: [false, false],
    });
  });

  it('keeps only the highest same-name aura bonus from different aura origins', () => {
    const modifiers = [
      modifier({
        slug: 'protective-wards',
        modifier: 2,
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
      enabled: [true, false],
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

  it('keeps only the lowest same-type penalty from different sources with the same name', () => {
    const modifiers = [
      modifier({ slug: 'sickened', modifier: -1, source: 'stench-aura' }),
      modifier({ slug: 'sickened', modifier: -2, source: 'poison' }),
    ];

    expect(apply(modifiers)).toEqual({
      total: -2,
      enabled: [false, true],
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
    expect(update[`flags.${MODULE_ID}.managedAuraEffect`]).toBe(true);
  });

  it('refreshes altered aura source rules and tags for Glorious Banner', () => {
    const currentEffect = aggregateEffect({
      description: '<p>You gain a +1 status bonus to Will saves against fear.</p>',
      baseRules: [
        {
          hideIfDisabled: true,
          key: 'FlatModifier',
          predicate: ['item:trait:fear'],
          selector: ['will'],
          slug: 'commanders-banner-fear',
          type: 'status',
          value: 1,
        },
      ],
      rules: [
        {
          hideIfDisabled: true,
          key: 'FlatModifier',
          predicate: ['item:trait:fear'],
          selector: ['will'],
          slug: 'commanders-banner-fear',
          type: 'status',
          value: 1,
        },
      ],
    });
    const gloriousSource = {
      system: {
        description: {
          value: '<p>If the origin has the Glorious Banner feat, you gain a +1 status bonus to AC, Fortitude saves, and Reflex saves.</p>',
        },
        rules: [
          {
            hideIfDisabled: true,
            key: 'FlatModifier',
            predicate: ['item:trait:fear'],
            selector: ['will'],
            slug: 'commanders-banner-fear',
            type: 'status',
            value: 1,
          },
          {
            hideIfDisabled: true,
            key: 'FlatModifier',
            predicate: ['parent:tag:glorious-banner'],
            selector: ['reflex', 'fortitude', 'ac'],
            slug: 'commanders-banner-glorious-banner',
            type: 'status',
            value: 1,
          },
        ],
        traits: {
          value: [],
          otherTags: ['glorious-banner'],
        },
      },
    };

    const update = buildAggregatedEffectUpdate(currentEffect, [twoAuraContributions[0]], gloriousSource);

    expect(update['system.rules']).toEqual(gloriousSource.system.rules);
    expect(update['system.traits']).toEqual({
      value: [],
      otherTags: ['glorious-banner'],
    });
    expect(update[`flags.${MODULE_ID}.baseRules`]).toEqual(gloriousSource.system.rules);
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

  it('skips aura effect deletes for items already gone from the actor collection', async () => {
    vi.useFakeTimers();

    const staleEffect = aggregateEffect({
      description: '',
      rules: [],
      sourceId: 'Compendium.test.Item.effect',
    });
    let deleteCalls = 0;
    const actor = {
      uuid: 'Actor.target',
      name: 'Target',
      items: { has: () => false },
      itemTypes: { effect: [staleEffect] },
      getActiveTokens: () => [],
      deleteEmbeddedDocuments: async () => {
        deleteCalls += 1;
        throw new Error('Item "effect-id" does not exist!');
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
    await vi.runOnlyPendingTimersAsync();

    expect(deleteCalls).toBe(0);
  });

  it('deletes inactive managed aggregate aura effects after the stale state settles', async () => {
    vi.useFakeTimers();

    let aggregateUpdate: Record<string, unknown> | null = null;
    const staleEffect = aggregateEffect({
      description: '',
      rules: [
        {
          key: 'FlatModifier',
          selector: 'ac',
          type: 'status',
          value: 1,
        },
      ],
      sourceId: 'Compendium.test.Item.effect',
      contributions: twoAuraContributions,
    });
    staleEffect.update = async (update: Record<string, unknown>) => {
      aggregateUpdate = update;
      return null;
    };

    let deleteCalls = 0;
    const actor = {
      uuid: 'Actor.target',
      name: 'Target',
      itemTypes: { effect: [staleEffect] },
      items: {
        has: (id: string) => actor.itemTypes.effect.some(effect => effect.id === id),
      },
      getActiveTokens: () => [],
      deleteEmbeddedDocuments: async (_embeddedName: string, ids: string[]) => {
        deleteCalls += 1;
        actor.itemTypes.effect = actor.itemTypes.effect.filter(effect => !ids.includes(effect.id));
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
    expect(aggregateUpdate?.['system.rules']).toEqual([]);
    expect(deleteCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(2000);
    expect(deleteCalls).toBe(1);
    expect(actor.itemTypes.effect).toEqual([]);
  });

  it('keeps managed aggregate aura effects out of PF2e native remove-on-exit cleanup', async () => {
    vi.useFakeTimers();

    const targetToken = { uuid: 'Scene.scene.Token.target', x: 0, y: 0, width: 1, height: 1 };
    const sourceEffect = aggregateEffect({
      description: '<p>You gain a +1 status bonus to AC.</p>',
      rules: [
        {
          key: 'FlatModifier',
          predicate: ['parent:tag:glorious-banner'],
          selector: 'ac',
          type: 'status',
          value: 1,
        },
      ],
      sourceId: 'Compendium.test.Item.effect',
    });
    const aura = {
      slug: 'test-aura',
      level: null,
      traits: [],
      effects: [
        {
          uuid: 'Compendium.test.Item.effect',
          removeOnExit: true,
          affects: 'allies' as const,
          includesSelf: false,
          parent: {
            uuid: 'Item.aura',
            slug: 'glorious-banner',
            getRollOptions: () => ['parent:slug:glorious-banner'],
          },
          predicate: { length: 0, test: () => true },
          alterations: [],
        },
      ],
    };
    const renderedAura = {
      squares: [
        {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          active: true,
        },
      ],
    };
    const originActor = {
      uuid: 'Actor.origin',
      name: 'Origin',
      auras: new Map([['test-aura', aura]]),
      getActiveTokens: () => [{ auras: new Map([['test-aura', renderedAura]]) }],
      getRollOptions: () => [],
    };
    let aggregateUpdate: Record<string, unknown> | null = null;
    const actor = {
      uuid: 'Actor.target',
      name: 'Target',
      itemTypes: { effect: [] as ReturnType<typeof aggregateEffect>[] },
      allowedItemTypes: ['effect'],
      isAllyOf: () => true,
      isEnemyOf: () => false,
      isOfType: () => false,
      getSelfRollOptions: () => [],
      getActiveTokens: () => [targetToken],
      createEmbeddedDocuments: async (_embeddedName: string, data: Record<string, unknown>[]) => {
        const created = {
          ...data[0],
          id: 'created-effect',
          type: 'effect' as const,
          sourceId: 'Compendium.test.Item.effect',
          flags: data[0].flags as ReturnType<typeof aggregateEffect>['flags'],
          system: data[0].system as ReturnType<typeof aggregateEffect>['system'],
          toObject: () => structuredClone({
            ...data[0],
            id: 'created-effect',
            type: 'effect',
            sourceId: 'Compendium.test.Item.effect',
          }),
          update: async (update: Record<string, unknown>) => {
            aggregateUpdate = update;
            return null;
          },
        };
        actor.itemTypes.effect.push(created);
        return [created];
      },
      deleteEmbeddedDocuments: async () => [],
    };

    (foundry.utils.fromUuid as (uuid: string) => Promise<unknown>) = async (uuid: string) => {
      if (uuid === 'Compendium.test.Item.effect') return sourceEffect;
      if (uuid === 'Actor.origin') return originActor;
      return null;
    };
    (globalThis as unknown as { game: unknown }).game = {
      user: { id: 'gm', isGM: true },
      users: { activeGM: { id: 'gm' } },
    };
    (globalThis as unknown as { canvas: unknown }).canvas = {
      ready: true,
      tokens: {
        placeables: [
          {
            actor: originActor,
            document: {
              uuid: 'Scene.scene.Token.origin',
              hidden: false,
              auras: new Map([['test-aura', renderedAura]]),
            },
          },
        ],
      },
    };
    (globalThis as unknown as { window: unknown }).window = globalThis;

    scheduleAuraEffectRefreshForActor(actor, 'test');
    await vi.advanceTimersByTimeAsync(100);

    expect(aggregateUpdate?.['flags.pf2e.aura']).toEqual({
      slug: 'test-aura',
      origin: 'Actor.origin',
      removeOnExit: false,
    });
    expect(aggregateUpdate?.[`flags.${MODULE_ID}.auraContributions`]).toEqual([
      {
        origin: 'Actor.origin',
        name: 'Origin',
        token: 'Scene.scene.Token.origin',
        auraSlug: 'test-aura',
        sourceId: 'Compendium.test.Item.effect',
        removeOnExit: true,
      },
    ]);
    expect(aggregateUpdate?.['system.traits']).toEqual({
      otherTags: ['glorious-banner'],
    });
  });
});

describe('updateEffectIfChanged', () => {
  it('skips updates for effects already gone from the actor collection', async () => {
    const effect = aggregateEffect({
      description: '',
      rules: [],
      sourceId: 'Compendium.test.Item.effect',
    });
    let updateCalls = 0;
    effect.update = async () => {
      updateCalls += 1;
      return null;
    };
    const actor = {
      uuid: 'Actor.target',
      items: { has: () => false },
      itemTypes: { effect: [effect] },
    };

    await updateEffectIfChanged(actor, effect, { 'system.description.value': 'changed' }, {});

    expect(updateCalls).toBe(0);
  });

  it('tolerates effects disappearing during an update', async () => {
    const effect = aggregateEffect({
      description: '',
      rules: [],
      sourceId: 'Compendium.test.Item.effect',
    });
    effect.update = async () => {
      throw new Error('undefined id [effect-id] does not exist in the EmbeddedCollection collection.');
    };
    const actor = {
      uuid: 'Actor.target',
      items: { has: () => true },
      itemTypes: { effect: [effect] },
    };

    await expect(updateEffectIfChanged(actor, effect, { 'system.description.value': 'changed' }, {})).resolves.toBeUndefined();
  });
});
