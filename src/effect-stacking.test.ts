import { describe, expect, it } from 'vitest';
import { applyUnifiedEffectStacking, type StackableModifier } from './effect-stacking';

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
});
