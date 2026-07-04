import { MODULE_ID } from '../constants';
import { getAuraContributions, scalableRuleValue } from './aggregation';
import type { ActorPF2eInstance, AuraContribution, AuraContributionGroup, EffectItem } from '../pf2e/types';
import { debugLogsEnabled } from '../settings';

export function debugLog(message: string, data?: Record<string, unknown>): void {
  if (!debugLogsEnabled()) return;

  if (data) {
    console.debug(`${MODULE_ID} | aura | ${message}`, data);
  } else {
    console.debug(`${MODULE_ID} | aura | ${message}`);
  }
}

export function actorSummary(actor: Pick<ActorPF2eInstance, 'uuid' | 'name'>): Record<string, string> {
  return {
    name: actor.name,
    uuid: actor.uuid,
  };
}

export function effectSummary(effect: EffectItem): Record<string, unknown> {
  return {
    id: effect.id,
    name: effect.name,
    sourceId: effect.sourceId,
    aura: effect.flags.pf2e?.aura,
    contributions: getAuraContributions(effect).map(contributionSummary),
    ruleValues: effect.system?.rules
      ?.filter(rule => scalableRuleValue(rule) !== null || rule.key === 'GrantItem')
      .map(rule => ({
        key: rule.key,
        path: rule.path,
        selector: rule.selector,
        value: rule.value,
        uuid: rule.uuid,
        alterations: rule.alterations,
      })) ?? [],
  };
}

export function contributionSummary(contribution: AuraContribution): Record<string, unknown> {
  return {
    name: contribution.name,
    origin: contribution.origin,
    token: contribution.token || null,
    aura: contribution.auraSlug,
    removeOnExit: contribution.removeOnExit,
  };
}

export function groupSummary(group: AuraContributionGroup): Record<string, unknown> {
  return {
    aura: group.aura.slug,
    effectUuid: group.auraEffect.uuid,
    origin: {
      name: group.origin.actor.name,
      actor: group.origin.actor.uuid,
      token: group.origin.token.uuid,
    },
    contributions: group.contributions.map(contributionSummary),
  };
}
