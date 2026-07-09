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

function isResponsibleGM(): boolean {
  if (!game.user.isGM) return false;

  const users = game.users as { activeGM?: { id: string } } | undefined;
  const activeGM = users?.activeGM;
  return !activeGM || activeGM.id === game.user.id;
}

export function userCanManageAuraEffects(): boolean {
  return isResponsibleGM();
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

function auraEffectPredicatePasses(actor: ActorPF2eInstance, originActor: AuraOrigin['actor'], auraEffect: AuraEffectData): boolean {
  if (auraEffect.predicate.length === 0) return true;

  const parentOptions = auraEffect.parent.getRollOptions?.('parent') ?? [];
  return auraEffect.predicate.test([
    ...originActor.getRollOptions(),
    ...actor.getSelfRollOptions('target'),
    ...parentOptions,
  ]);
}

function sceneTokens(): RuntimeToken[] {
  const placeables = canvas.ready ? canvas.tokens?.placeables : null;
  return Array.isArray(placeables) ? (placeables as unknown as RuntimeToken[]) : [];
}

const pendingActorRefreshes = new Map<string, number[]>();
const pendingAuraEffectCreates = new Map<string, Promise<EffectItem | null>>();
const runningActorRefreshes = new Map<string, Promise<void>>();
const queuedActorRefreshReasons = new Map<string, string>();

function auraEffectSourceId(effect: EffectItem): string | null {
  const documentDuplicateSource = foundry.utils.getProperty(effect, '_stats.duplicateSource');
  const sourceDuplicateSource = foundry.utils.getProperty(effect.toObject(), '_stats.duplicateSource');
  const duplicateSource = documentDuplicateSource ?? sourceDuplicateSource;
  return effect.sourceId ?? (typeof duplicateSource === 'string' ? duplicateSource : null);
}

function effectMatchesAuraSource(effect: EffectItem, auraSlug: string, sourceId: string): boolean {
  return auraEffectSourceId(effect) === sourceId && effect.flags.pf2e?.aura?.slug === auraSlug;
}

function auraEffectKey(auraSlug: string, sourceId: string): string {
  return `${sourceId}:${auraSlug}`;
}

function findMatchingAuraEffects(actor: ActorPF2eInstance, auraSlug: string, sourceId: string): EffectItem[] {
  return actor.itemTypes.effect.filter(effect => effectMatchesAuraSource(effect, auraSlug, sourceId));
}

function auraEffectCreateKey(actor: ActorPF2eInstance, auraSlug: string, sourceId: string): string {
  return `${actor.uuid}:${auraEffectKey(auraSlug, sourceId)}`;
}

function isManagedAggregateAuraEffect(effect: EffectItem): boolean {
  return Array.isArray(foundry.utils.getProperty(effect, `flags.${MODULE_ID}.auraContributions`));
}

function shouldRemoveStaleAuraEffect(effect: EffectItem): boolean {
  return effect.flags.pf2e?.aura?.removeOnExit === true || isManagedAggregateAuraEffect(effect);
}

function updatesAreNoop(document: EffectItem, update: Record<string, unknown>): boolean {
  return Object.entries(update).every(([path, value]) => {
    const current = foundry.utils.getProperty(document, path);
    return JSON.stringify(current) === JSON.stringify(value);
  });
}

async function updateEffectIfChanged(effect: EffectItem, update: Record<string, unknown>, context: Record<string, unknown>): Promise<void> {
  if (updatesAreNoop(effect, update)) {
    debugLog('skipped aggregate aura effect update: no changes', {
      ...context,
      effect: effectSummary(effect),
    });
    return;
  }

  await effect.update(update);
}

function collectSceneAuraContributions(actor: ActorPF2eInstance, aura: AuraData, auraEffect: AuraEffectData): AuraContribution[] {
  const contributions: AuraContribution[] = [];

  for (const token of sceneTokens()) {
    const originActor = token.actor;
    if (!originActor || token.document?.hidden) continue;

    const originAura = tokenAura(token, aura.slug);
    if (!originAura || !auraContainsActorToken(originAura, actor)) continue;

    const actorAuraEffect = originActor.auras?.get(aura.slug)?.effects?.find(effect => {
      return effect.uuid === auraEffect.uuid && auraAffectsActor(effect, originActor, actor) && auraEffectPredicatePasses(actor, originActor, effect);
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
        if (!auraEffectPredicatePasses(actor, origin.actor, auraEffect)) continue;

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
  if (!isResponsibleGM()) {
    debugLog('skipped aura refresh: user is not responsible GM', {
      actor: actorSummary(actor),
      reason,
    });
    return;
  }

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

  await pruneStaleAggregateAuraEffects(actor, groups, reason);

  for (const group of groups) {
    await applyAuraContributionGroup(actor, group, reason);
  }
}

async function pruneStaleAggregateAuraEffects(actor: ActorPF2eInstance, groups: AuraContributionGroup[], reason: string): Promise<void> {
  const activeKeys = new Set(groups.map(group => auraEffectKey(group.aura.slug, group.auraEffect.uuid)));
  const staleEffects = actor.itemTypes.effect.filter(effect => {
    const auraSlug = effect.flags.pf2e?.aura?.slug;
    const sourceId = auraEffectSourceId(effect);
    if (!auraSlug || !sourceId || !shouldRemoveStaleAuraEffect(effect)) return false;

    return !activeKeys.has(auraEffectKey(auraSlug, sourceId));
  });

  if (staleEffects.length === 0) return;

  debugLog('deleting stale aggregate aura effects', {
    actor: actorSummary(actor),
    reason,
    effects: staleEffects.map(effectSummary),
  });
  await actor.deleteEmbeddedDocuments('Item', staleEffects.map(effect => effect.id));
}

export function scheduleAuraEffectRefreshForActor(actor: unknown, reason = 'manual'): void {
  if (!actor || typeof actor !== 'object' || !('uuid' in actor)) return;
  if (!isResponsibleGM()) return;

  const actorUuid = String((actor as { uuid: string }).uuid);
  const pending = pendingActorRefreshes.get(actorUuid) ?? [];
  for (const timeoutId of pending) {
    window.clearTimeout(timeoutId);
  }

  const timeoutIds: number[] = [];
  for (const delay of [100, 350, 900]) {
    const timeoutId = window.setTimeout(() => {
      runQueuedActorAuraRefresh(actor as ActorPF2eInstance, `${reason}:${delay}`);
      const remaining = pendingActorRefreshes.get(actorUuid)?.filter(id => id !== timeoutId) ?? [];
      if (remaining.length > 0) pendingActorRefreshes.set(actorUuid, remaining);
      else pendingActorRefreshes.delete(actorUuid);
    }, delay);
    timeoutIds.push(timeoutId);
  }

  pendingActorRefreshes.set(actorUuid, timeoutIds);
}

function runQueuedActorAuraRefresh(actor: ActorPF2eInstance, reason: string): void {
  const actorUuid = actor.uuid;
  if (runningActorRefreshes.has(actorUuid)) {
    queuedActorRefreshReasons.set(actorUuid, reason);
    return;
  }

  let refresh: Promise<void>;
  refresh = (async () => {
    let currentReason = reason;

    while (true) {
      queuedActorRefreshReasons.delete(actorUuid);
      try {
        await refreshActorAuraEffects(actor, currentReason);
      } catch (error) {
        console.error(`${MODULE_ID} | aura refresh failed`, {
          actor: actor.uuid,
          reason: currentReason,
          error,
        });
      }

      const queuedReason = queuedActorRefreshReasons.get(actorUuid);
      if (!queuedReason) return;
      currentReason = queuedReason;
    }
  })().finally(() => {
    if (runningActorRefreshes.get(actorUuid) === refresh) {
      runningActorRefreshes.delete(actorUuid);
      queuedActorRefreshReasons.delete(actorUuid);
    }
  });

  runningActorRefreshes.set(actorUuid, refresh);
}

export function scheduleAuraEffectRefreshForScene(reason = 'manual'): void {
  if (!isResponsibleGM()) return;

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
  const existing = findMatchingAuraEffects(actor, aura.slug, auraEffect.uuid).at(0);
  if (existing) return existing;

  const createKey = auraEffectCreateKey(actor, aura.slug, auraEffect.uuid);
  const pending = pendingAuraEffectCreates.get(createKey);
  if (pending) return pending;

  const create = createAuraEffectUnchecked(actor, aura, auraEffect, origin).finally(() => {
    pendingAuraEffectCreates.delete(createKey);
  });
  pendingAuraEffectCreates.set(createKey, create);
  return create;
}

async function createAuraEffectUnchecked(actor: ActorPF2eInstance, aura: AuraData, auraEffect: AuraEffectData, origin: AuraOrigin): Promise<EffectItem | null> {
  const effect = await foundry.utils.fromUuid(auraEffect.uuid);
  if (!effect || !('type' in effect) || effect.type !== 'effect' || !('toObject' in effect) || typeof effect.toObject !== 'function') {
    return null;
  }

  const existing = findMatchingAuraEffects(actor, aura.slug, auraEffect.uuid).at(0);
  if (existing) return existing;

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

  let matchingEffects = findMatchingAuraEffects(actor, group.aura.slug, group.auraEffect.uuid);

  if (validContributions.length === 0) {
    if (matchingEffects.length > 0) {
      await actor.deleteEmbeddedDocuments('Item', matchingEffects.map(effect => effect.id));
    }
    return;
  }

  let primaryEffect = matchingEffects.at(0);
  if (!primaryEffect) {
    primaryEffect = await createAuraEffect(actor, group.aura, group.auraEffect, group.origin) ?? undefined;
    matchingEffects = findMatchingAuraEffects(actor, group.aura.slug, group.auraEffect.uuid);
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

  await updateEffectIfChanged(primaryEffect, update, {
    actor: actorSummary(actor),
    reason,
    aura: group.aura.slug,
    contributionCount: validContributions.length,
    duplicateIds,
  });
  if (duplicateIds.length > 0) {
    await actor.deleteEmbeddedDocuments('Item', duplicateIds);
  }
}

async function contributionStillApplies(actor: ActorPF2eInstance, contribution: AuraContribution): Promise<boolean> {
  const originActor = (await foundry.utils.fromUuid(contribution.origin)) as RuntimeAuraActor | null;
  if (!originActor || typeof originActor !== 'object') return false;

  const originAuras = originActor.auras instanceof Map ? originActor.auras : null;
  const auraEffectData = originAuras?.get(contribution.auraSlug)?.effects?.find((effect: AuraEffectData) => {
    return effect.uuid === contribution.sourceId && auraAffectsActor(effect, originActor, actor) && auraEffectPredicatePasses(actor, originActor, effect);
  });

  if (!auraEffectData) return false;

  const targetTokens = actor.getActiveTokens(true, true);
  if (targetTokens.length === 0) return false;

  const originTokens = typeof originActor.getActiveTokens === 'function' ? originActor.getActiveTokens(true, true) : [];
  return originTokens.some(originToken => {
    const originAura = originToken?.auras?.get(contribution.auraSlug) ?? null;
    return originAura ? targetTokens.some(token => originAura.containsToken(token)) : false;
  });
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
    currentUserIsResponsibleGM: isResponsibleGM(),
    isParty: actor.isOfType('party'),
    allowsEffects: actor.allowedItemTypes.includes('effect'),
    originTokenHidden: origin.token.hidden,
    existingAuraEffects: actor.itemTypes.effect
      .filter(effect => effect.flags.pf2e?.aura)
      .map(effectSummary),
  };

  debugLog('checking aura effects after PF2E pass', guardState);

  if (!isResponsibleGM()) {
    debugLog('skipped aura consolidation: user is not responsible GM', guardState);
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

    let matchingEffects = findMatchingAuraEffects(actor, aura.slug, auraEffect.uuid);
    let primaryEffect = matchingEffects.at(0);

    if (!primaryEffect) {
      debugLog('creating aggregate aura effect', effectState);
      primaryEffect = await createAuraEffect(actor, aura, auraEffect, origin) ?? undefined;
      matchingEffects = findMatchingAuraEffects(actor, aura.slug, auraEffect.uuid);
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

    const updateContext = {
      ...effectState,
      contributionCount: validContributions.length,
      duplicateIds,
    };

    debugLog('updating aggregate aura effect', {
      ...updateContext,
      effect: effectSummary(primaryEffect),
      contributions: validContributions.map(contributionSummary),
    });

    await updateEffectIfChanged(primaryEffect, update, updateContext);
    debugLog('aggregate aura effect checked', {
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
