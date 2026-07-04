import { MODULE_ID } from '../constants';
import { buildAggregatedEffectUpdate, getAuraContributions, mergeContributions } from './aggregation';
import { actorSummary, contributionSummary, debugLog, effectSummary, groupSummary } from './debug';
import type { ActorPF2eConstructor, ActorPF2eInstance, AuraContribution, AuraContributionGroup, AuraData, AuraEffectData, AuraOrigin, EffectItem, RuntimeAura, RuntimeAuraActor, RuntimeToken } from '../pf2e/types';

function isPatched(method: unknown): boolean {
  return typeof method === 'function' && Reflect.get(method, MODULE_ID) === true;
}

function auraAffectsActor(data: AuraEffectData, origin: AuraOrigin['actor'], actor: ActorPF2eInstance): boolean {
  return (data.includesSelf && origin.uuid === actor.uuid) || (data.affects === 'allies' && actor.isAllyOf(origin)) || (data.affects === 'enemies' && actor.isEnemyOf(origin)) || (data.affects === 'all' && origin.uuid !== actor.uuid);
}

function setPath(source: Record<string, unknown>, path: string, value: unknown): void {
  foundry.utils.setProperty(source, path, value);
}

async function hydrateContributionNames(contributions: AuraContribution[]): Promise<AuraContribution[]> {
  return Promise.all(
    contributions.map(async contribution => {
      if (contribution.name && contribution.name !== contribution.origin) return contribution;

      const originActor = await foundry.utils.fromUuid(contribution.origin);
      const name = originActor && typeof originActor === 'object' && 'name' in originActor && typeof originActor.name === 'string' ? originActor.name : contribution.name;
      return { ...contribution, name };
    }),
  );
}

function actorTokens(actor: ActorPF2eInstance): unknown[] {
  return actor.getActiveTokens(true, true);
}

function tokenAura(token: RuntimeToken, auraSlug: string): RuntimeAura | null {
  return token.document?.auras?.get(auraSlug) ?? token.auras?.get(auraSlug) ?? null;
}

function auraContainsActorToken(aura: RuntimeAura, actor: ActorPF2eInstance): boolean {
  const targetTokens = actorTokens(actor);
  return targetTokens.some(token => aura.containsToken(token));
}

function sceneTokens(): RuntimeToken[] {
  const placeables = canvas.ready ? canvas.tokens?.placeables : null;
  return Array.isArray(placeables) ? (placeables as unknown as RuntimeToken[]) : [];
}

function collectSceneAuraContributions(actor: ActorPF2eInstance, aura: AuraData, auraEffect: AuraEffectData): AuraContribution[] {
  const contributions: AuraContribution[] = [];

  for (const token of sceneTokens()) {
    const originActor = token.actor;
    if (!originActor || token.document?.hidden) continue;

    const originAura = tokenAura(token, aura.slug);
    if (!originAura || !auraContainsActorToken(originAura, actor)) continue;

    const actorAuraEffect = originActor.auras?.get(aura.slug)?.effects?.find(effect => {
      return effect.uuid === auraEffect.uuid && auraAffectsActor(effect, originActor, actor);
    });
    if (!actorAuraEffect) continue;

    contributions.push({
      origin: originActor.uuid,
      name: originActor.name,
      token: token.document?.uuid ?? '',
      auraSlug: aura.slug,
      sourceId: auraEffect.uuid,
      removeOnExit: actorAuraEffect.removeOnExit,
    });
  }

  return contributions;
}

function collectSceneAuraContributionGroups(actor: ActorPF2eInstance): AuraContributionGroup[] {
  const groups = new Map<string, AuraContributionGroup>();

  for (const token of sceneTokens()) {
    const origin = auraOriginFromToken(token);
    if (!origin || origin.token.hidden) continue;
    const originActor = origin.actor as RuntimeAuraActor;

    for (const [auraSlug, aura] of originActor.auras ?? []) {
      const renderedAura = tokenAura(token, auraSlug);
      if (!renderedAura || !auraContainsActorToken(renderedAura, actor)) continue;

      for (const auraEffect of aura.effects ?? []) {
        if (!auraAffectsActor(auraEffect, origin.actor, actor)) continue;

        const key = `${auraEffect.uuid}:${aura.slug}`;
        const contribution: AuraContribution = {
          origin: origin.actor.uuid,
          name: origin.actor.name,
          token: origin.token.uuid,
          auraSlug: aura.slug,
          sourceId: auraEffect.uuid,
          removeOnExit: auraEffect.removeOnExit,
        };
        const group = groups.get(key);

        if (group) {
          group.contributions.push(contribution);
        } else {
          groups.set(key, {
            aura,
            auraEffect,
            origin,
            contributions: [contribution],
          });
        }
      }
    }
  }

  return [...groups.values()];
}

function auraOriginFromToken(token: RuntimeToken): AuraOrigin | null {
  const actor = token.actor;
  const tokenDocument = token.document;
  if (!actor || !tokenDocument?.uuid) return null;

  return {
    actor,
    token: {
      uuid: tokenDocument.uuid,
      hidden: Boolean(tokenDocument.hidden),
    },
  };
}

async function refreshActorAuraEffects(actor: ActorPF2eInstance, reason: string): Promise<void> {
  if (!canvas.ready) return;

  debugLog('refresh actor auras started', {
    actor: actorSummary(actor),
    reason,
  });

  const groups = collectSceneAuraContributionGroups(actor);
  debugLog('refresh actor auras scan complete', {
    actor: actorSummary(actor),
    reason,
    groupCount: groups.length,
    groups: groups.map(groupSummary),
  });

  for (const group of groups) {
    await applyAuraContributionGroup(actor, group, reason);
  }
}

export function scheduleAuraEffectRefreshForActor(actor: unknown, reason = 'manual'): void {
  if (!actor || typeof actor !== 'object' || !('uuid' in actor)) return;

  for (const delay of [100, 350, 900]) {
    window.setTimeout(() => {
      void refreshActorAuraEffects(actor as ActorPF2eInstance, `${reason}:${delay}`).catch(error => {
        console.error(`${MODULE_ID} | aura refresh failed`, {
          actor: (actor as { uuid?: string }).uuid,
          reason,
          delay,
          error,
        });
      });
    }, delay);
  }
}

export function scheduleAuraEffectRefreshForScene(reason = 'manual'): void {
  const actors = new Set<ActorPF2eInstance>();

  for (const token of sceneTokens()) {
    if (token.actor) actors.add(token.actor as unknown as ActorPF2eInstance);
  }

  debugLog('scheduled scene aura refresh', {
    reason,
    actorCount: actors.size,
    actors: [...actors].map(actorSummary),
  });

  for (const actor of actors) {
    scheduleAuraEffectRefreshForActor(actor, reason);
  }
}

async function createAuraEffect(actor: ActorPF2eInstance, aura: AuraData, auraEffect: AuraEffectData, origin: AuraOrigin): Promise<EffectItem | null> {
  const effect = await foundry.utils.fromUuid(auraEffect.uuid);
  if (!effect || !('type' in effect) || effect.type !== 'effect' || !('toObject' in effect) || typeof effect.toObject !== 'function') {
    return null;
  }

  const source = foundry.utils.mergeObject(effect.toObject(), {
    flags: {
      pf2e: {
        aura: {
          slug: aura.slug,
          origin: origin.actor.uuid,
          removeOnExit: auraEffect.removeOnExit,
        },
      },
    },
  }) as Record<string, unknown>;
  delete source._id;
  setPath(source, 'flags.pf2e.aura', {
    slug: aura.slug,
    origin: origin.actor.uuid,
    removeOnExit: auraEffect.removeOnExit,
  });
  setPath(source, 'system.duration.unit', 'unlimited');
  setPath(source, 'system.duration.expiry', null);
  setPath(source, 'system.context', {
    target: null,
    origin: {
      actor: origin.actor.uuid,
      token: origin.token.uuid,
      item: null,
      spellcasting: null,
      rollOptions: [],
    },
    roll: null,
  });
  setPath(source, '_stats.duplicateSource', auraEffect.uuid);

  if (aura.level !== null) {
    setPath(source, 'system.level.value', aura.level);
  }

  const traits = foundry.utils.getProperty(source, 'system.traits.value');
  if (Array.isArray(traits) && traits.length === 0) {
    traits.push(...aura.traits);
  }

  for (const alteration of auraEffect.alterations) {
    alteration.applyTo(source);
  }

  const created = await actor.createEmbeddedDocuments('Item', [source]);
  return created.at(0) as EffectItem | null;
}

async function applyAuraContributionGroup(actor: ActorPF2eInstance, group: AuraContributionGroup, reason: string): Promise<void> {
  const contributions = await hydrateContributionNames(mergeContributions(group.contributions));
  const validContributions: AuraContribution[] = [];

  for (const contribution of contributions) {
    if (await contributionStillApplies(actor, contribution)) {
      validContributions.push(contribution);
    }
  }

  const matchingEffects = actor.itemTypes.effect.filter(effect => effect.sourceId === group.auraEffect.uuid && effect.flags.pf2e?.aura?.slug === group.aura.slug);

  if (validContributions.length === 0) {
    if (matchingEffects.length > 0) {
      await actor.deleteEmbeddedDocuments('Item', matchingEffects.map(effect => effect.id));
    }
    return;
  }

  let primaryEffect = matchingEffects.at(0);
  if (!primaryEffect) {
    primaryEffect = await createAuraEffect(actor, group.aura, group.auraEffect, group.origin) ?? undefined;
  }
  if (!primaryEffect) return;

  const duplicateIds = matchingEffects.filter(effect => effect.id !== primaryEffect.id).map(effect => effect.id);
  const update = buildAggregatedEffectUpdate(primaryEffect, validContributions);
  update['flags.pf2e.aura'] = {
    slug: group.aura.slug,
    origin: validContributions[0].origin,
    removeOnExit: validContributions.some(contribution => contribution.removeOnExit),
  };
  update['system.context'] = {
    target: null,
    origin: {
      actor: validContributions[0].origin,
      token: validContributions[0].token || null,
      item: null,
      spellcasting: null,
      rollOptions: [],
    },
    roll: null,
  };

  debugLog('applying aggregate aura effect', {
    actor: actorSummary(actor),
    reason,
    aura: group.aura.slug,
    effect: effectSummary(primaryEffect),
    contributionCount: validContributions.length,
    contributions: validContributions.map(contributionSummary),
    duplicateIds,
  });

  await primaryEffect.update(update);
  if (duplicateIds.length > 0) {
    await actor.deleteEmbeddedDocuments('Item', duplicateIds);
  }
}

async function contributionStillApplies(actor: ActorPF2eInstance, contribution: AuraContribution): Promise<boolean> {
  if (!contribution.removeOnExit) return true;

  const originActor = (await foundry.utils.fromUuid(contribution.origin)) as RuntimeAuraActor | null;
  if (!originActor || typeof originActor !== 'object') return false;

  const originTokens = typeof originActor.getActiveTokens === 'function' ? originActor.getActiveTokens(true, true) : [];
  const originToken = originTokens.at(0);
  const originAura = originToken?.auras?.get(contribution.auraSlug) ?? null;
  const originAuras = originActor.auras instanceof Map ? originActor.auras : null;
  const auraEffectData = originAuras?.get(contribution.auraSlug)?.effects?.find((effect: AuraEffectData) => {
    return effect.uuid === contribution.sourceId && auraAffectsActor(effect, originActor, actor);
  });

  if (!originAura || !auraEffectData) return false;

  const targetTokens = actor.getActiveTokens(true, true);
  if (targetTokens.length === 0) return false;

  return targetTokens.some(token => originAura.containsToken(token));
}

async function consolidateAuraEffects(actor: ActorPF2eInstance, aura: AuraData, origin: AuraOrigin): Promise<void> {
  const guardState = {
    actor: actorSummary(actor),
    aura: aura.slug,
    origin: {
      name: origin.actor.name,
      actor: origin.actor.uuid,
      token: origin.token.uuid,
    },
    effectCount: aura.effects.length,
    currentUserIsPrimaryUpdater: game.user === actor.primaryUpdater,
    isParty: actor.isOfType('party'),
    allowsEffects: actor.allowedItemTypes.includes('effect'),
    originTokenHidden: origin.token.hidden,
    existingAuraEffects: actor.itemTypes.effect
      .filter(effect => effect.flags.pf2e?.aura)
      .map(effectSummary),
  };

  debugLog('checking aura effects after PF2E pass', guardState);

  if (game.user !== actor.primaryUpdater) {
    debugLog('skipped aura consolidation: user is not actor primary updater', guardState);
    return;
  }

  if (actor.isOfType('party')) {
    debugLog('skipped aura consolidation: target is party actor', guardState);
    return;
  }

  if (!actor.allowedItemTypes.includes('effect')) {
    debugLog('skipped aura consolidation: target actor cannot receive effect items', guardState);
    return;
  }

  if (origin.token.hidden) {
    debugLog('skipped aura consolidation: origin token is hidden', guardState);
    return;
  }

  const originActorUuid = origin.actor.uuid;
  const rollOptions = aura.effects.some(effect => effect.predicate.length > 0) ? [...origin.actor.getRollOptions(), ...actor.getSelfRollOptions('target')] : [];
  const parentOptionsCache: Record<string, string[]> = {};

  for (const auraEffect of aura.effects) {
    const effectState = {
      actor: actorSummary(actor),
      aura: aura.slug,
      originActor: originActorUuid,
      originActorName: origin.actor.name,
      effectUuid: auraEffect.uuid,
      affects: auraEffect.affects,
      includesSelf: auraEffect.includesSelf,
      removeOnExit: auraEffect.removeOnExit,
      predicateLength: auraEffect.predicate.length,
      parentUuid: auraEffect.parent.uuid,
    };

    const parentOptions = parentOptionsCache[auraEffect.parent.uuid] ?? (parentOptionsCache[auraEffect.parent.uuid] = auraEffect.parent.getRollOptions?.('parent') ?? []);
    const predicateOptions = [...rollOptions, ...parentOptions];
    if (!auraEffect.predicate.test(predicateOptions)) {
      debugLog('skipped aura effect: predicate failed', { ...effectState, predicateOptions });
      continue;
    }

    if (!auraAffectsActor(auraEffect, origin.actor, actor)) {
      debugLog('skipped aura effect: aura does not affect actor', effectState);
      continue;
    }

    const matchingEffects = actor.itemTypes.effect.filter(effect => effect.sourceId === auraEffect.uuid && effect.flags.pf2e?.aura?.slug === aura.slug);
    let primaryEffect = matchingEffects.at(0);

    if (!primaryEffect) {
      const effect = await foundry.utils.fromUuid(auraEffect.uuid);
      if (!effect || !('type' in effect) || effect.type !== 'effect' || !('toObject' in effect) || typeof effect.toObject !== 'function') {
        debugLog('skipped aura effect: source effect was not found', {
          ...effectState,
          resolvedType: effect && typeof effect === 'object' && 'type' in effect ? effect.type : typeof effect,
        });
        continue;
      }

      const source = foundry.utils.mergeObject(effect.toObject(), {
        flags: {
          pf2e: {
            aura: {
              slug: aura.slug,
              origin: originActorUuid,
              removeOnExit: auraEffect.removeOnExit,
            },
          },
        },
      }) as Record<string, unknown>;
      delete source._id;
      setPath(source, 'flags.pf2e.aura', {
        slug: aura.slug,
        origin: originActorUuid,
        removeOnExit: auraEffect.removeOnExit,
      });
      setPath(source, 'system.duration.unit', 'unlimited');
      setPath(source, 'system.duration.expiry', null);
      setPath(source, 'system.context', {
        target: null,
        origin: {
          actor: originActorUuid,
          token: origin.token.uuid,
          item: null,
          spellcasting: null,
          rollOptions: [],
        },
        roll: null,
      });
      setPath(source, '_stats.duplicateSource', auraEffect.uuid);

      if (aura.level !== null) {
        setPath(source, 'system.level.value', aura.level);
      }

      const traits = foundry.utils.getProperty(source, 'system.traits.value');
      if (Array.isArray(traits) && traits.length === 0) {
        traits.push(...aura.traits);
      }

      for (const alteration of auraEffect.alterations) {
        alteration.applyTo(source);
      }

      debugLog('creating aggregate aura effect', effectState);
      const created = await actor.createEmbeddedDocuments('Item', [source]);
      primaryEffect = created.at(0) as EffectItem | undefined;
    }

    if (!primaryEffect) {
      debugLog('skipped aura effect: created effect was missing', {
        ...effectState,
        resolvedType: 'created item missing',
      });
      continue;
    }

    const currentContribution: AuraContribution = {
      origin: originActorUuid,
      name: origin.actor.name,
      token: origin.token.uuid,
      auraSlug: aura.slug,
      sourceId: auraEffect.uuid,
      removeOnExit: auraEffect.removeOnExit,
    };
    const contributions = await hydrateContributionNames(mergeContributions([
      ...matchingEffects.flatMap(effect => getAuraContributions(effect)),
      ...collectSceneAuraContributions(actor, aura, auraEffect),
      currentContribution,
    ]));
    const validContributions: AuraContribution[] = [];

    for (const contribution of contributions) {
      if (await contributionStillApplies(actor, contribution)) {
        validContributions.push(contribution);
      }
    }

    if (validContributions.length === 0) {
      debugLog('deleting aggregate aura effect: no valid aura sources remain', effectState);
      await actor.deleteEmbeddedDocuments('Item', matchingEffects.map(effect => effect.id));
      continue;
    }

    const duplicateIds = matchingEffects.filter(effect => effect.id !== primaryEffect.id).map(effect => effect.id);
    const update = buildAggregatedEffectUpdate(primaryEffect, validContributions);
    update['flags.pf2e.aura'] = {
      slug: aura.slug,
      // PF2E still expects a single origin for its native remove-on-exit pass.
      origin: validContributions[0].origin,
      removeOnExit: validContributions.some(contribution => contribution.removeOnExit),
    };
    update['system.context'] = {
      target: null,
      origin: {
        actor: validContributions[0].origin,
        token: validContributions[0].token || null,
        item: null,
        spellcasting: null,
        rollOptions: [],
      },
      roll: null,
    };

    debugLog('updating aggregate aura effect', {
      ...effectState,
      effect: effectSummary(primaryEffect),
      contributionCount: validContributions.length,
      contributions: validContributions.map(contributionSummary),
      duplicateIds,
    });

    await primaryEffect.update(update);
    debugLog('aggregate aura effect updated', {
      ...effectState,
      effect: effectSummary(primaryEffect),
      count: validContributions.length,
    });
    if (duplicateIds.length > 0) {
      await actor.deleteEmbeddedDocuments('Item', duplicateIds);
    }
  }
}

async function createMissingAuraEffects(actor: ActorPF2eInstance, aura: AuraData, origin: AuraOrigin): Promise<void> {
  try {
    await consolidateAuraEffects(actor, aura, origin);
  } catch (error) {
    console.error(`${MODULE_ID} | aura consolidation failed`, {
      actor: actorSummary(actor),
      aura: aura.slug,
      origin: {
        name: origin.actor.name,
        actor: origin.actor.uuid,
        token: origin.token.uuid,
      },
      error,
    });
  }
}

export function patchPF2eAuraEffects(): boolean {
  const ActorPF2e = CONFIG.Actor.documentClass as unknown as ActorPF2eConstructor | undefined;
  const prototype = ActorPF2e?.prototype;

  if (!prototype) {
    debugLog('aura patch not installed: ActorPF2e prototype missing');
    return false;
  }

  if (isPatched(prototype.applyAreaEffects)) {
    debugLog('aura patch already installed');
    return false;
  }

  const originalApplyAreaEffects = prototype.applyAreaEffects;

  const applyAreaEffects = async function (this: ActorPF2eInstance, aura: AuraData, origin: AuraOrigin): Promise<void> {
    debugLog('PF2E aura pass started', {
      actor: actorSummary(this),
      aura: aura.slug,
      origin: {
        name: origin.actor.name,
        actor: origin.actor.uuid,
        token: origin.token.uuid,
      },
      effectUuids: aura.effects.map(effect => effect.uuid),
    });
    await originalApplyAreaEffects.call(this, aura, origin);
    debugLog('PF2E aura pass completed', {
      actor: actorSummary(this),
      aura: aura.slug,
      auraEffectsAfterPF2E: this.itemTypes.effect
        .filter(effect => effect.flags.pf2e?.aura)
        .map(effectSummary),
    });
    await createMissingAuraEffects(this, aura, origin);
  };

  Reflect.set(applyAreaEffects, MODULE_ID, true);
  prototype.applyAreaEffects = applyAreaEffects;

  debugLog('aura patch installed');
  return true;
}
