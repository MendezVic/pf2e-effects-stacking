type ModifierKind = 'bonus' | 'penalty' | 'modifier';
type StackableModifierType = 'ability' | 'circumstance' | 'item' | 'potency' | 'proficiency' | 'status' | 'untyped';

export interface StackableModifier {
  slug: string;
  label: string;
  modifier: number;
  type: StackableModifierType;
  source: string | null;
  rule?: {
    item?: {
      uuid?: string | null;
      sourceId?: string | null;
      flags?: {
        pf2e?: {
          aura?: {
            slug?: string;
            origin?: string;
          };
        };
      };
    } | null;
  } | null;
  enabled: boolean;
  ignored: boolean;
  force?: boolean;
  kind?: ModifierKind;
}

function modifierKind(modifier: StackableModifier): ModifierKind {
  if (modifier.kind) return modifier.kind;
  if (modifier.modifier >= 0 && !['ability', 'untyped'].includes(modifier.type)) return 'bonus';
  if (modifier.modifier < 0 && modifier.type !== 'ability') return 'penalty';
  return 'modifier';
}

function modifierSource(modifier: StackableModifier): string {
  const aura = modifier.rule?.item?.flags?.pf2e?.aura;
  const auraSourceId = modifier.rule?.item?.sourceId;
  if (aura?.origin && auraSourceId) return `aura:${auraSourceId}:${aura.origin}`;

  const itemUuid = modifier.rule?.item?.uuid;
  if (itemUuid) return itemUuid;
  return modifier.source || '';
}

function resolveTypeGroup(modifiers: StackableModifier[], betterFirst: (a: StackableModifier, b: StackableModifier) => number): void {
  const acceptedSources = new Set<string>();
  const acceptedSlugs = new Set<string>();

  for (const modifier of [...modifiers].sort(betterFirst)) {
    if (modifier.force) {
      modifier.enabled = true;
      continue;
    }

    const source = modifierSource(modifier);
    const hasSourceConflict = acceptedSources.has(source);
    const hasNameConflict = acceptedSlugs.has(modifier.slug);

    modifier.enabled = !hasSourceConflict && !hasNameConflict;

    if (modifier.enabled) {
      acceptedSources.add(source);
      acceptedSlugs.add(modifier.slug);
    }
  }
}

export function applyUnifiedEffectStacking(modifiers: StackableModifier[]): number {
  const groups = new Map<string, StackableModifier[]>();

  for (const modifier of modifiers) {
    if (modifier.ignored) {
      modifier.enabled = false;
      continue;
    }

    if (modifier.type === 'untyped') {
      modifier.enabled = true;
      continue;
    }

    // PF2e's original stacking pass already handles ability modifiers.
    if (modifier.type === 'ability') continue;

    const key = `${modifier.type}:${modifierKind(modifier)}`;
    const group = groups.get(key);
    if (group) {
      group.push(modifier);
    } else {
      groups.set(key, [modifier]);
    }
  }

  for (const [key, group] of groups) {
    if (key.endsWith(':penalty')) {
      resolveTypeGroup(group, (a, b) => a.modifier - b.modifier);
    } else {
      resolveTypeGroup(group, (a, b) => b.modifier - a.modifier);
    }
  }

  return modifiers.filter((modifier) => modifier.enabled).reduce((total, modifier) => total + modifier.modifier, 0);
}
