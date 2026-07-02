type ModifierKind = 'bonus' | 'penalty' | 'modifier';
type StackableModifierType = 'ability' | 'circumstance' | 'item' | 'potency' | 'proficiency' | 'status' | 'untyped';

export interface StackableModifier {
  slug: string;
  label: string;
  modifier: number;
  type: StackableModifierType;
  source: string | null;
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
  return modifier.source || '';
}

function resolveTypeGroup(modifiers: StackableModifier[], betterFirst: (a: StackableModifier, b: StackableModifier) => number): void {
  const acceptedSources = new Set<string>();

  for (const modifier of [...modifiers].sort(betterFirst)) {
    const source = modifierSource(modifier);
    const hasSourceConflict = acceptedSources.has(source);

    modifier.enabled = !hasSourceConflict;

    if (modifier.enabled) {
      acceptedSources.add(source);
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
