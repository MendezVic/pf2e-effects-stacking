import { MODULE_ID } from '../constants';
import type { AuraContribution, EffectItem } from '../pf2e/types';

function getModuleFlag(item: EffectItem, key: string): unknown {
  return foundry.utils.getProperty(item, `flags.${MODULE_ID}.${key}`);
}

function effectSourceId(item: EffectItem): string | null {
  const duplicateSource = foundry.utils.getProperty(item.toObject(), '_stats.duplicateSource');
  return item.sourceId ?? (typeof duplicateSource === 'string' ? duplicateSource : null);
}

export function contributionKey(contribution: AuraContribution): string {
  return `${contribution.sourceId}:${contribution.auraSlug}:${contribution.origin}`;
}

export function getAuraContributions(effect: EffectItem): AuraContribution[] {
  const contributions = getModuleFlag(effect, 'auraContributions');
  if (Array.isArray(contributions)) {
    return contributions.filter((contribution): contribution is AuraContribution => {
      return (
        contribution !== null &&
        typeof contribution === 'object' &&
        typeof contribution.origin === 'string' &&
        typeof contribution.name === 'string' &&
        typeof contribution.token === 'string' &&
        typeof contribution.auraSlug === 'string' &&
        typeof contribution.sourceId === 'string' &&
        typeof contribution.removeOnExit === 'boolean'
      );
    });
  }

  const auraData = effect.flags.pf2e?.aura;
  const sourceId = effectSourceId(effect);
  if (!auraData?.origin || !sourceId) return [];

  return [
    {
      origin: auraData.origin,
      name: auraData.origin,
      token: '',
      auraSlug: auraData.slug ?? '',
      sourceId,
      removeOnExit: Boolean(auraData.removeOnExit),
    },
  ];
}

export function mergeContributions(contributions: AuraContribution[]): AuraContribution[] {
  const byKey = new Map<string, AuraContribution>();
  for (const contribution of contributions) {
    byKey.set(contributionKey(contribution), contribution);
  }

  return [...byKey.values()];
}

export function scalableRuleValue(rule: Record<string, unknown>): number | null {
  if (typeof rule.value !== 'number') return null;
  return rule.key === 'FlatModifier' || rule.key === 'ActiveEffectLike' ? rule.value : null;
}

function stackedConditionMinimumValue(rules: Record<string, unknown>[], count: number): number | null {
  const conditionMinimums = rules
    .filter(rule => rule.key === 'ActiveEffectLike' && typeof rule.path === 'string' && typeof rule.value === 'number' && /^flags\.[^.]+\.condition\.[^.]+\.min$/.test(rule.path))
    .map(rule => Number(rule.value) * count);

  return conditionMinimums.length > 0 ? Math.max(...conditionMinimums) : null;
}

function scaleGrantItemBadgeValue(rule: Record<string, unknown>, count: number, conditionMinimumValue: number | null): Record<string, unknown> {
  if (rule.key !== 'GrantItem' || rule.inMemoryOnly !== true) return rule;

  const alterations = Array.isArray(rule.alterations) ? rule.alterations : [];
  let foundBadgeValue = false;
  const scaledAlterations = alterations.map(alteration => {
    if (!alteration || typeof alteration !== 'object') return alteration;

    const alterationData = alteration as Record<string, unknown>;
    if (alterationData.property !== 'badge-value') return alteration;

    foundBadgeValue = true;
    return typeof alterationData.value === 'number'
      ? { ...alterationData, value: alterationData.value * count }
      : alteration;
  });

  if (!foundBadgeValue && conditionMinimumValue !== null) {
    scaledAlterations.push({
      mode: 'override',
      property: 'badge-value',
      value: conditionMinimumValue,
    });
  }

  return scaledAlterations.length === alterations.length && !foundBadgeValue
    ? rule
    : { ...rule, alterations: scaledAlterations };
}

function scaleStackableRuleValues(rules: Record<string, unknown>[], count: number): Record<string, unknown>[] {
  const conditionMinimumValue = stackedConditionMinimumValue(rules, count);

  return rules.map(rule => {
    const value = scalableRuleValue(rule);
    if (value !== null) return { ...rule, value: value * count };
    return scaleGrantItemBadgeValue(rule, count, conditionMinimumValue);
  });
}

function unscaleStackableRuleValues(rules: Record<string, unknown>[], count: number): Record<string, unknown>[] {
  if (count <= 1) return rules;

  return rules.map(rule => {
    if (typeof rule.value !== 'number') return rule;
    if (rule.key === 'FlatModifier') return { ...rule, value: rule.value / count };
    if (rule.key === 'ActiveEffectLike' && Math.abs(rule.value) >= count && rule.value % count === 0) {
      return { ...rule, value: rule.value / count };
    }
    return rule;
  });
}

function rulesHaveValidBaseValues(rules: Record<string, unknown>[]): boolean {
  return rules.every(rule => {
    return !(rule.key === 'ActiveEffectLike' && typeof rule.value === 'number' && !Number.isInteger(rule.value));
  });
}

function ruleSelectors(rule: Record<string, unknown>): string[] {
  if (Array.isArray(rule.selector)) return rule.selector.map(selector => String(selector));
  if (typeof rule.selector === 'string') return [rule.selector];
  return [];
}

function summarizeStackedRules(rules: Record<string, unknown>[], contributions: AuraContribution[]): string {
  const flatModifier = rules.find(rule => rule.key === 'FlatModifier' && typeof rule.value === 'number');
  if (!flatModifier) return '';

  const selector = ruleSelectors(flatModifier).join(', ') || 'modifier';
  const value = Number(flatModifier.value);
  const signed = value > 0 ? `+${value}` : String(value);
  return `<p>${contributions.map(contribution => `${signed} ${selector} from ${foundry.utils.escapeHTML(contribution.name)}`).join('<br>')}</p>`;
}

function buildStackedDescription(baseDescription: string, baseRules: Record<string, unknown>[], contributions: AuraContribution[]): string {
  const summary = summarizeStackedRules(baseRules, contributions);
  const flatModifier = baseRules.find(rule => rule.key === 'FlatModifier' && typeof rule.value === 'number');
  const selectors = flatModifier ? ruleSelectors(flatModifier) : [];
  const total = flatModifier && selectors.includes('ac') ? Number(flatModifier.value) * contributions.length : null;
  const description = total === null
    ? baseDescription
    : baseDescription.replace(/<p>You gain a \+?\d+ status bonus to AC\.<\/p>/, `<p>You gain a +${total} status bonus to AC.</p>`);

  return [
    description,
    summary,
    '<hr>',
    '<p><strong>Aura sources</strong></p>',
    `<ul>${contributions.map(contribution => `<li>${foundry.utils.escapeHTML(contribution.name)}</li>`).join('')}</ul>`,
  ].filter(Boolean).join('\n');
}

export function buildAggregatedEffectUpdate(effect: EffectItem, contributions: AuraContribution[]): Record<string, unknown> {
  const source = effect.toObject();
  const baseDescription = String(foundry.utils.getProperty(source, `flags.${MODULE_ID}.baseDescription`) ?? effect.system?.description?.value ?? '');
  const sourceBaseRules = foundry.utils.getProperty(source, `flags.${MODULE_ID}.baseRules`);
  const existingContributionCount = getAuraContributions(effect).length;
  const baseRules = Array.isArray(sourceBaseRules) && rulesHaveValidBaseValues(sourceBaseRules as Record<string, unknown>[])
    ? (foundry.utils.deepClone(sourceBaseRules) as Record<string, unknown>[])
    : Array.isArray(effect.system?.rules)
      ? unscaleStackableRuleValues(foundry.utils.deepClone(effect.system.rules), existingContributionCount)
      : [];
  const rules = scaleStackableRuleValues(baseRules, contributions.length);

  return {
    'system.description.value': buildStackedDescription(baseDescription, baseRules, contributions),
    'system.rules': rules,
    [`flags.${MODULE_ID}.baseDescription`]: baseDescription,
    [`flags.${MODULE_ID}.baseRules`]: baseRules,
    [`flags.${MODULE_ID}.auraContributions`]: contributions,
  };
}
