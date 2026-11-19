import { BUFF_IDS } from '../config/balance';
import type { GameContext } from '../core/context';
import { clamp, distanceXZ } from '../core/math';
import { extractionMultiplier, getPlayerStats } from '../core/selectors';
import { SpatialHash } from '../core/spatial-hash';
import type { ActorArchetype, BuffDraft, BuffId, EntityId, GameAction, GameEventMap, InputFrame, LandmarkId, LootState, RecipeId, RelicRecipeId, ResourceId, RunResult, Vec3 } from '../types/game';
import { addMaterials, canAfford, createDraft, DISCOVERY_IDS, emptyMaterials, findSpawnPosition, finitePosition, GDD_RULES, nextBlueprint, normalSpawnArchetype, POSITION_EPSILON, Reachability, relicVisualSeed, spendMaterials, tierRank, TIME_EPSILON, validWindowSeconds } from './rules';
import { settleRun } from './settlement';

type MeteorWarning = { origin: Vec3; hitsAt: number; damage: number };
type BandageUse = { seconds: number; origin: Vec3 };

export class SystemsFacade {
  private readonly nodeIndex = new SpatialHash<ResourceId>(4);
  private readonly lootIndex = new SpatialHash<EntityId>(4);
  private readonly rewardedEnemies = new Set<EntityId>();
  private readonly harvestTimes = new Map<ResourceId, number>();
  private readonly subscriptions: (() => void)[];
  private reachable: Reachability | null = null;
  private normalSpawnSeconds = 0;
  private spawnSequence = 0;
  private draftSequence = 0;
  private ordinaryNodesMined = 0;
  private firstHunterRewarded = false;
  private blueprintCursor = 0;
  private frostSeconds = 0;
  private meteorSeconds = 0;
  private readonly meteors: MeteorWarning[] = [];
  private bandage: BandageUse | null = null;
  private lastHarvestAt = -Infinity;
  private hostileHitThisStep = false;
  private stepStart: number | null = null;
  private lastResolvedTime = -Infinity;
  private stepPosition: Vec3 | null = null;
  private nextBeaconIndex = 1;
  private lastBeaconLandmark: LandmarkId | null = null;
  private beaconOpened = false;
  private bossDefeated = false;
  private disposed = false;

  constructor(private readonly ctx: GameContext) {
    this.subscriptions = [
      ctx.events.on('resource:hit', request => this.harvest(request)),
      ctx.events.on('enemy:died', death => this.enemyDied(death)),
      ctx.events.on('actor:damaged', damage => {
        if (damage.id !== ctx.state.player.id || damage.sourceId === ctx.state.player.id || !this.hasActiveRun()) return;
        // An absorbed hostile hit (amount zero) is still an interruption.
        this.hostileHitThisStep = true;
        this.bandage = null;
        this.interruptChannel('Hostile hit');
      }),
    ];
  }

  resetRun(): void {
    if (this.disposed) return;
    const { state, balance } = this.ctx;
    this.nodeIndex.clear();
    this.lootIndex.clear();
    this.rewardedEnemies.clear();
    this.harvestTimes.clear();
    this.normalSpawnSeconds = 0;
    this.spawnSequence = 0;
    this.draftSequence = 0;
    this.ordinaryNodesMined = 0;
    this.firstHunterRewarded = false;
    this.blueprintCursor = 0;
    this.frostSeconds = 0;
    this.meteorSeconds = 0;
    this.meteors.length = 0;
    this.bandage = null;
    this.lastHarvestAt = -Infinity;
    this.lastResolvedTime = -Infinity;
    this.hostileHitThisStep = false;
    this.stepStart = null;
    this.stepPosition = null;
    this.nextBeaconIndex = 1;
    this.lastBeaconLandmark = null;
    this.beaconOpened = false;
    this.bossDefeated = false;
    state.elapsedSeconds = 0;
    state.cycleIndex = 0;
    state.dayPhase = 'day';
    state.materials = emptyMaterials();
    state.materials.wood = state.profile.skills.artisan * balance.skills.artisan.perRank;
    state.resources.clear();
    state.loot.clear();
    state.player.toolTier = 'wood';
    state.player.weaponTier = 'wood';
    state.player.arrows = GDD_RULES.initialArrows + state.profile.skills.supply * balance.skills.supply.perRank;
    state.player.bandages = Math.min(balance.player.bandageMax, GDD_RULES.initialBandages + Math.max(0, state.profile.skills['field-medic'] - 1));
    for (const id of BUFF_IDS) state.buffs[id] = 0;
    state.threat = 0;
    state.threatDecayAt = 0;
    state.passiveHealBlockedUntil = 0;
    state.nextHunterAt = 0;
    state.kills = 0;
    state.cursedNodesMined = 0;
    state.paidDraftCount = 0;
    state.activeDraft = null;
    state.pendingDrafts.length = 0;
    state.beacon = null;
    state.bossSummoned = false;
    state.runBlueprints.length = 0;
    state.runDiscoveries.length = 0;
    state.result = null;
    state.notification = null;
    this.reachable = state.world ? new Reachability(state.world) : null;
    for (const node of state.world?.nodes ?? []) {
      if (!finitePosition(node.position) || state.resources.has(node.id)) continue;
      const hp = balance.resources[node.kind].hp;
      state.resources.set(node.id, { ...node, position: { ...node.position }, hp, maxHp: hp, depleted: false });
      this.nodeIndex.set(node.id, node.position);
    }
  }

  update(dt: number, input: InputFrame): void {
    if (!this.canSimulate() || !Number.isFinite(dt) || dt <= 0) {
      if (this.hasActiveRun() && (this.ctx.state.phase === 'paused' || this.ctx.state.activeDraft)) {
        this.interruptChannel('Modal opened');
        this.bandage = null;
      }
      return;
    }
    const { state, balance, events } = this.ctx;
    const start = state.elapsedSeconds;
    const end = start + dt;
    if (!Number.isFinite(end)) return;
    this.stepStart = start;
    this.stepPosition = { ...state.player.position };
    state.elapsedSeconds = end;
    state.cycleIndex = Math.floor((end + TIME_EPSILON) / balance.extraction.cycleSeconds);
    const cycleTime = end - state.cycleIndex * balance.extraction.cycleSeconds;
    const previousDayPhase = state.dayPhase;
    state.dayPhase = cycleTime + TIME_EPSILON < balance.extraction.daySeconds ? 'day' : 'night';
    if (previousDayPhase === 'day' && state.dayPhase === 'night') events.emit('audio:cue', { cue: 'night', position: null });
    this.updateThreat(start, end);
    this.updateBeaconSchedule(end);
    this.updateNormalSpawns(start, end);
    this.tryHunter();
    this.updateSecondaryEffects(dt);
    const healStartsAt = Math.max(
      state.player.lastHostileHitAt + Math.max(0, balance.player.passiveHealDelay - state.profile.skills.recovery * balance.skills.recovery.perRank),
      state.passiveHealBlockedUntil,
    );
    const healSeconds = Math.max(0, end - Math.max(start, healStartsAt));
    if (healSeconds > 0 && state.player.hp > 0 && state.player.hp < state.player.maxHp) {
      events.emit('player:heal-requested', { amount: healSeconds * balance.player.passiveHeal, source: 'passive' });
    }
    if (input.pausePressed) {
      this.interruptChannel('Modal opened');
      this.bandage = null;
    }
  }

  afterCombat(dt: number, input: InputFrame): void {
    if (!this.hasActiveRun()) return;
    const { state } = this.ctx;
    // No draft, pickup, healing completion or extraction may outrank lethal HP.
    if (state.player.hp <= 0) {
      this.finishRun('dead', 0);
      return;
    }
    if (!this.canSimulate() || !Number.isFinite(dt) || dt <= 0) {
      this.interruptChannel('Modal opened');
      this.bandage = null;
      this.stepStart = null;
      this.stepPosition = null;
      return;
    }
    const end = state.elapsedSeconds;
    if (this.stepStart === null && end <= this.lastResolvedTime + TIME_EPSILON) return;
    const start = this.stepStart ?? Math.max(0, end - dt);
    this.lastResolvedTime = end;
    const movement = this.movementReason(input);
    this.updateBandage(Math.max(0, end - start), input, movement);
    // A synchronous heal consumer is allowed to publish HP events. Recheck HP.
    if (state.player.hp <= 0) {
      this.finishRun('dead', 0);
      return;
    }
    this.collectNearbyLoot();
    this.recordLandmarkVisits();
    this.updateChannel(start, end, input, movement);
    if (state.result) return;
    this.expireBeacon(end);
    if (input.interactPressed && !this.insideOpenBeacon()) this.interactNearby();
    if (!state.activeDraft && !input.pausePressed) this.openPendingDraft();
    this.hostileHitThisStep = false;
    this.stepStart = null;
    this.stepPosition = null;
  }

  handleAction(action: GameAction): boolean {
    if (this.disposed) return false;
    switch (action.type) {
      case 'craft': return this.craft(action.recipeId);
      case 'buy-draft': return this.buyDraft(action.chestId);
      case 'choose-buff': return this.chooseBuff(action.draftId, action.buffId);
      case 'upgrade-skill': return this.upgradeSkill(action.nodeId);
      case 'upgrade-relic': return this.upgradeRelic(action.recipeId);
      case 'equip-relic': {
        const { state } = this.ctx;
        if (state.phase !== 'hub' || state.profile.relicRanks[action.recipeId] <= 0 || !state.profile.blueprints.includes(action.recipeId) || state.profile.equippedRelic === action.recipeId) return false;
        state.profile.equippedRelic = action.recipeId;
        state.notification = `${this.ctx.balance.relics[action.recipeId].name} equipped.`;
        return true;
      }
      case 'pause':
        // Main still owns this action and phase. Interruption is systems-owned.
        if (this.hasActiveRun()) {
          this.interruptChannel('Modal opened');
          this.bandage = null;
        }
        return false;
      default: return false; // Main handles generation, lifecycle and settings.
    }
  }

  abandonRun(): void {
    if (!this.hasActiveRun()) return;
    this.finishRun(this.ctx.state.player.hp <= 0 ? 'dead' : 'abandoned', 0);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.nodeIndex.clear();
    this.lootIndex.clear();
    this.meteors.length = 0;
    this.bandage = null;
    this.reachable = null;
  }

  private hasActiveRun(): boolean {
    const { state } = this.ctx;
    return !this.disposed && !!state.runId && state.result === null && (state.phase === 'playing' || state.phase === 'paused');
  }
  private canSimulate(): boolean {
    const { state } = this.ctx;
    return this.hasActiveRun() && state.phase === 'playing' && state.pauseReason === null && state.activeDraft === null;
  }
  private canInteract(): boolean {
    const { state } = this.ctx;
    return this.hasActiveRun() && state.player.hp > 0 && !state.activeDraft &&
      ((state.phase === 'playing' && state.pauseReason === null) || (state.phase === 'paused' && state.pauseReason === 'menu'));
  }

  private harvest(request: GameEventMap['resource:hit']): void {
    if (!this.canSimulate()) return;
    const { state, balance, events } = this.ctx;
    const node = state.resources.get(request.id);
    if (!node || node.depleted || state.player.hp <= 0 || !finitePosition(request.position) || !finitePosition(state.player.position)) return;
    const rule = balance.resources[node.kind];
    const amount = balance.combat.toolDamage[state.player.toolTier];
    if (request.toolTier !== state.player.toolTier || tierRank(request.toolTier) < tierRank(rule.minimumTier) || request.amount !== amount || !Number.isFinite(request.amount)) return;
    if (distanceXZ(state.player.position, node.position) > balance.combat.gatherReach + POSITION_EPSILON) return;
    if (!this.nodeIndex.query(state.player.position, balance.combat.gatherReach + POSITION_EPSILON).includes(node.id)) return;
    const now = state.elapsedSeconds;
    if (now - this.lastHarvestAt + TIME_EPSILON < balance.combat.gatherInterval || now - (this.harvestTimes.get(node.id) ?? -Infinity) + TIME_EPSILON < balance.combat.gatherInterval) return;
    const remaining = Math.max(0, node.hp - amount);
    if (!Number.isFinite(node.hp) || node.hp <= 0 || !Number.isFinite(remaining)) return;
    this.lastHarvestAt = now;
    this.harvestTimes.set(node.id, now);
    node.hp = remaining;
    events.emit('audio:cue', { cue: 'mine', position: { ...node.position } });
    if (remaining > 0) return;
    node.depleted = true;
    this.nodeIndex.remove(node.id);
    const materials = { ...rule.drops };
    if (node.kind === 'cursed') {
      state.cursedNodesMined++;
      if (state.cursedNodesMined % GDD_RULES.cursedNodesPerCore === 0) materials.relicCores++;
      this.disturbThreat(balance.threat.cursedIncrease, true);
    } else {
      this.ordinaryNodesMined++;
      if (this.ordinaryNodesMined <= state.profile.skills.scavenger * balance.skills.scavenger.perRank) {
        if (node.kind === 'tree') materials.wood++;
        else if (node.kind === 'stone') materials.stone++;
        else materials.gold++;
      }
    }
    this.dropLoot({ id: `${state.runId}:loot:node:${node.id}`, position: { ...node.position }, materials, blueprint: null });
    events.emit('resource:depleted', { id: node.id, kind: node.kind, position: { ...node.position } });
  }

  private enemyDied(death: GameEventMap['enemy:died']): void {
    if (!this.hasActiveRun() || this.rewardedEnemies.has(death.id) || !finitePosition(death.position)) return;
    const { state, balance } = this.ctx;
    // Reserve the ID before emitting discovery events; listeners are synchronous.
    this.rewardedEnemies.add(death.id);
    state.kills++;
    const materials = emptyMaterials();
    materials.soulShards = balance.enemies[death.archetype].souls;
    let blueprint: RelicRecipeId | null = null;
    if (death.archetype === 'relic-hunter' && !this.firstHunterRewarded) {
      this.firstHunterRewarded = true;
      blueprint = this.allocateBlueprint();
    } else if (death.archetype === 'rootbound-sovereign') {
      this.bossDefeated = true;
      blueprint = this.allocateBlueprint();
      if (blueprint === null) materials.relicCores++;
    }
    this.dropLoot({ id: `${state.runId}:loot:enemy:${death.id}`, position: { ...death.position }, materials, blueprint });
    this.recordDiscovery(`enemy:${death.archetype}`);
    if (balance.buffEffects.killMilestones.some(milestone => milestone === state.kills)) {
      const draft = this.makeDraft(0);
      if (draft) state.pendingDrafts.push(draft);
    }
  }
  private allocateBlueprint(): RelicRecipeId | null {
    const { state } = this.ctx;
    const owned = new Set([...state.profile.blueprints, ...state.runBlueprints]);
    for (const loot of state.loot.values()) if (loot.blueprint) owned.add(loot.blueprint);
    const next = nextBlueprint(owned, this.blueprintCursor);
    this.blueprintCursor = next.cursor;
    return next.blueprint;
  }
  private dropLoot(loot: LootState): void {
    if (this.ctx.state.loot.has(loot.id)) return;
    this.ctx.state.loot.set(loot.id, loot);
    this.lootIndex.set(loot.id, loot.position);
  }
  private collectNearbyLoot(): void {
    const { state, events, balance } = this.ctx;
    // Reconcile externally initialized fixtures and any moved physical drops.
    for (const loot of state.loot.values()) if (finitePosition(loot.position)) this.lootIndex.set(loot.id, loot.position);
    const radius = getPlayerStats(state, balance).pickupRadius;
    for (const id of this.lootIndex.query(state.player.position, radius)) {
      const loot = state.loot.get(id);
      if (!loot || distanceXZ(loot.position, state.player.position) > radius) {
        if (!loot) this.lootIndex.remove(id);
        continue;
      }
      state.loot.delete(id);
      this.lootIndex.remove(id);
      addMaterials(state.materials, loot.materials);
      if (loot.blueprint && !state.profile.blueprints.includes(loot.blueprint) && !state.runBlueprints.includes(loot.blueprint)) state.runBlueprints.push(loot.blueprint);
      events.emit('loot:collected', { id, materials: { ...loot.materials }, blueprint: loot.blueprint });
    }
  }

  private disturbThreat(amount: number, suppressHealing: boolean): void {
    const { state, balance, events } = this.ctx;
    state.threat = clamp(state.threat + amount, 0, balance.threat.max);
    state.threatDecayAt = state.elapsedSeconds + balance.threat.decayDelay;
    if (suppressHealing) state.passiveHealBlockedUntil = state.elapsedSeconds + balance.threat.healSuppression;
    events.emit('threat:changed', { value: state.threat, healBlockedUntil: state.passiveHealBlockedUntil });
  }
  private updateThreat(start: number, end: number): void {
    const { state, balance, events } = this.ctx;
    const seconds = Math.max(0, end - Math.max(start, state.threatDecayAt));
    if (state.threat <= 0 || seconds <= 0) return;
    state.threat = Math.max(0, state.threat - seconds * balance.threat.decayRate);
    events.emit('threat:changed', { value: state.threat, healBlockedUntil: state.passiveHealBlockedUntil });
  }
  private activeEnemies(): { total: number; hunters: number; wyverns: number } {
    let total = 0, hunters = 0, wyverns = 0;
    for (const enemy of this.ctx.state.enemies.values()) {
      if (enemy.hp <= 0 || enemy.mode === 'dead' || enemy.archetype === 'rootbound-sovereign') continue;
      total++;
      if (enemy.archetype === 'relic-hunter') hunters++;
      if (enemy.archetype === 'blood-wyvern') wyverns++;
    }
    return { total, hunters, wyverns };
  }
  private requestSpawn(archetype: ActorArchetype, tier: 'normal' | 'elite' | 'enraged-elite', position: Vec3): void {
    this.ctx.events.emit('enemy:spawn-requested', { id: `${this.ctx.state.runId}:enemy:${++this.spawnSequence}`, archetype, tier, position: { ...position } });
  }
  private updateNormalSpawns(start: number, end: number): void {
    const { balance, rng } = this.ctx;
    let cursor = start;
    while (cursor < end - TIME_EPSILON) {
      const cycle = Math.floor((cursor + TIME_EPSILON) / balance.extraction.cycleSeconds);
      const cycleStart = cycle * balance.extraction.cycleSeconds;
      const day = cursor + TIME_EPSILON < cycleStart + balance.extraction.daySeconds;
      const boundary = cycleStart + (day ? balance.extraction.daySeconds : balance.extraction.cycleSeconds);
      const segmentEnd = Math.min(end, boundary);
      const interval = day ? balance.spawning.dayInterval : balance.spawning.nightInterval;
      this.normalSpawnSeconds += segmentEnd - cursor;
      while (this.normalSpawnSeconds + TIME_EPSILON >= interval) {
        this.normalSpawnSeconds = Math.max(0, this.normalSpawnSeconds - interval);
        const active = this.activeEnemies();
        if (active.total >= balance.spawning.maxEnemies) continue;
        const archetype = normalSpawnArchetype(rng, active.wyverns < balance.spawning.maxWyverns);
        const position = findSpawnPosition(this.ctx, this.reachable);
        if (position) this.requestSpawn(archetype, 'normal', position);
      }
      cursor = segmentEnd;
    }
  }
  private tryHunter(): void {
    const { state, balance } = this.ctx;
    if (state.threat < balance.threat.hunterThreshold || state.elapsedSeconds + TIME_EPSILON < state.nextHunterAt) return;
    const active = this.activeEnemies();
    if (active.total >= balance.spawning.maxEnemies || active.hunters >= balance.spawning.maxHunters) return;
    const position = findSpawnPosition(this.ctx, this.reachable);
    if (!position) return;
    // Set cooldown before synchronous spawning; threshold changes never reset it.
    state.nextHunterAt = state.elapsedSeconds + balance.threat.hunterInterval;
    this.requestSpawn('relic-hunter', state.threat >= balance.threat.enragedThreshold ? 'enraged-elite' : 'elite', position);
  }

  private updateSecondaryEffects(dt: number): void {
    const { state, balance, events } = this.ctx;
    for (let index = this.meteors.length - 1; index >= 0; index--) {
      const warning = this.meteors[index];
      if (!warning || state.elapsedSeconds + TIME_EPSILON < warning.hitsAt) continue;
      this.meteors.splice(index, 1);
      events.emit('combat:area-requested', { kind: 'meteor', origin: { ...warning.origin }, radius: balance.buffEffects.meteorRadius, damage: warning.damage, slowFraction: 0, durationSeconds: 0 });
    }
    const frostStacks = state.buffs['frost-nova'];
    if (frostStacks <= 0) this.frostSeconds = 0;
    else {
      this.frostSeconds += dt;
      while (this.frostSeconds + TIME_EPSILON >= balance.buffEffects.frostInterval) {
        this.frostSeconds = Math.max(0, this.frostSeconds - balance.buffEffects.frostInterval);
        const origin = { ...state.player.position };
        events.emit('fx:requested', { kind: 'frost', position: origin, direction: null, intensity: frostStacks });
        events.emit('combat:area-requested', { kind: 'frost', origin: { ...origin }, radius: balance.buffEffects.frostRadius, damage: 0, slowFraction: frostStacks * balance.buffs['frost-nova'].perStack, durationSeconds: balance.buffEffects.frostDuration });
      }
    }
    const meteorStacks = state.buffs['meteor-strike'];
    if (meteorStacks <= 0) { this.meteorSeconds = 0; return; }
    const detection = state.dayPhase === 'day' ? balance.spawning.dayDetection : balance.spawning.nightDetection;
    const targets = [...state.enemies.values()].filter(enemy => enemy.hp > 0 && enemy.mode !== 'dead' && distanceXZ(enemy.position, state.player.position) <= detection)
      .sort((a, b) => distanceXZ(a.position, state.player.position) - distanceXZ(b.position, state.player.position) || a.id.localeCompare(b.id));
    const target = targets[0];
    if (!target) return;
    this.meteorSeconds += dt;
    while (this.meteorSeconds + TIME_EPSILON >= balance.buffEffects.meteorInterval) {
      this.meteorSeconds = Math.max(0, this.meteorSeconds - balance.buffEffects.meteorInterval);
      const origin = { ...target.position };
      this.meteors.push({ origin, hitsAt: state.elapsedSeconds + balance.buffEffects.meteorWarning, damage: meteorStacks * balance.buffs['meteor-strike'].perStack });
      events.emit('fx:requested', { kind: 'meteor', position: { ...origin }, direction: null, intensity: meteorStacks });
    }
  }

  private movementReason(input: InputFrame): string | null {
    const { player } = this.ctx.state;
    if (Math.hypot(input.moveX, input.moveZ) > POSITION_EPSILON || Math.hypot(player.velocity.x, player.velocity.z) > POSITION_EPSILON || (this.stepPosition && distanceXZ(this.stepPosition, player.position) > POSITION_EPSILON)) return 'Movement';
    return null;
  }
  private updateBandage(dt: number, input: InputFrame, movement: string | null): void {
    const { state, balance, events } = this.ctx;
    if (movement || this.hostileHitThisStep || input.pausePressed || input.dashPressed || input.meleeHeld || input.rangedHeld || input.rangedReleased || input.magicPressed) {
      if (this.bandage) state.notification = `Bandage cancelled: ${movement ?? (this.hostileHitThisStep ? 'hostile hit' : 'action interrupted')}.`;
      this.bandage = null;
      return;
    }
    if (!this.bandage && input.bandagePressed && state.player.bandages > 0 && state.player.hp < state.player.maxHp) {
      this.bandage = { seconds: 0, origin: { ...state.player.position } };
      state.notification = `Applying bandage — stay still for ${balance.player.bandageDuration} seconds.`;
      this.interruptChannel('Bandage use');
    }
    if (!this.bandage) return;
    if (distanceXZ(this.bandage.origin, state.player.position) > POSITION_EPSILON || state.player.bandages <= 0) { this.bandage = null; return; }
    this.bandage.seconds += dt;
    if (this.bandage.seconds + TIME_EPSILON < balance.player.bandageDuration) return;
    this.bandage = null;
    state.player.bandages--;
    events.emit('player:heal-requested', { amount: balance.player.bandageHeal + state.profile.skills['field-medic'] * GDD_RULES.fieldMedicHealPerRank, source: 'bandage' });
    state.notification = 'Bandage applied.';
  }

  private updateBeaconSchedule(now: number): void {
    const { state, balance, rng, events } = this.ctx;
    if (state.beacon) {
      if (!this.beaconOpened && now + TIME_EPSILON >= state.beacon.opensAt && now <= state.beacon.closesAt + TIME_EPSILON) {
        this.beaconOpened = true;
        state.notification = `Beacon open — hold E for ${balance.extraction.channelSeconds}s. Souls ×${state.beacon.multiplier}.`;
        events.emit('beacon:changed', { beacon: this.copyBeacon() });
        events.emit('audio:cue', { cue: 'beacon', position: { ...state.beacon.position } });
      }
      return;
    }
    const opensAt = this.nextBeaconIndex * balance.extraction.cycleSeconds;
    const announcement = balance.extraction.announcementSeconds + state.profile.skills.surveyor * balance.skills.surveyor.perRank;
    if (now + TIME_EPSILON < opensAt - announcement) return;
    // A large deterministic step may skip a window; never create a stale pad.
    if (now > opensAt + balance.extraction.windowSeconds + TIME_EPSILON) {
      this.nextBeaconIndex = Math.floor(now / balance.extraction.cycleSeconds) + 1;
      this.updateBeaconSchedule(now);
      return;
    }
    const bossActive = (state.bossSummoned && !this.bossDefeated) || [...state.enemies.values()].some(enemy => enemy.archetype === 'rootbound-sovereign' && enemy.hp > 0 && enemy.mode !== 'dead');
    let eligible = (state.world?.landmarks ?? []).filter(landmark => this.reachable?.includes(landmark.position) && (!bossActive || landmark.id !== 'ashen-spire'));
    const alternatives = eligible.filter(landmark => landmark.id !== this.lastBeaconLandmark);
    if (alternatives.length) eligible = alternatives;
    if (!eligible.length) return;
    const selected = rng.pick(eligible);
    state.beacon = {
      index: this.nextBeaconIndex, landmarkId: selected.id, position: { ...selected.position },
      opensAt, closesAt: opensAt + balance.extraction.windowSeconds,
      multiplier: extractionMultiplier(this.nextBeaconIndex), announced: true, channelSeconds: 0,
    };
    this.lastBeaconLandmark = selected.id;
    this.beaconOpened = now + TIME_EPSILON >= opensAt;
    state.notification = this.beaconOpened ? `Beacon open at ${selected.id}. Souls ×${state.beacon.multiplier}.` : `Beacon revealed at ${selected.id}; opens in ${Math.max(0, Math.ceil(opensAt - now))}s.`;
    events.emit('beacon:changed', { beacon: this.copyBeacon() });
    events.emit('audio:cue', { cue: 'beacon', position: { ...selected.position } });
  }
  private copyBeacon(): GameEventMap['beacon:changed']['beacon'] {
    const beacon = this.ctx.state.beacon;
    return beacon ? { ...beacon, position: { ...beacon.position } } : null;
  }
  private insideOpenBeacon(): boolean {
    const { state, balance } = this.ctx;
    return !!state.beacon && state.elapsedSeconds + TIME_EPSILON >= state.beacon.opensAt && state.elapsedSeconds <= state.beacon.closesAt + TIME_EPSILON && distanceXZ(state.player.position, state.beacon.position) <= balance.extraction.radius;
  }
  private updateChannel(start: number, end: number, input: InputFrame, movement: string | null): void {
    const { state, balance, events } = this.ctx;
    const beacon = state.beacon;
    if (!beacon) return;
    let reason: string | null = null;
    if (state.activeDraft || state.phase !== 'playing' || input.pausePressed) reason = 'Modal opened';
    else if (this.hostileHitThisStep) reason = 'Hostile hit';
    else if (!input.interactHeld) reason = 'E released';
    else if (movement) reason = movement;
    else if (input.dashPressed) reason = 'Dash';
    else if (input.meleeHeld || input.rangedHeld || input.rangedReleased || input.magicPressed) reason = 'Attack';
    else if (this.bandage || input.bandagePressed) reason = 'Bandage use';
    else if (distanceXZ(state.player.position, beacon.position) > balance.extraction.radius || (this.stepPosition && distanceXZ(this.stepPosition, beacon.position) > balance.extraction.radius)) reason = 'Outside beacon radius';
    else if (end + TIME_EPSILON < beacon.opensAt) reason = 'Beacon not open';
    if (reason) { this.interruptChannel(reason); return; }
    const validSeconds = validWindowSeconds(start, end, beacon);
    if (validSeconds <= 0) return;
    beacon.channelSeconds = Math.min(balance.extraction.channelSeconds, beacon.channelSeconds + validSeconds);
    events.emit('extraction:progress', { seconds: beacon.channelSeconds, required: balance.extraction.channelSeconds, interrupted: false });
    if (beacon.channelSeconds + TIME_EPSILON >= balance.extraction.channelSeconds) this.finishRun('extracted', beacon.multiplier);
  }
  private interruptChannel(reason: string): void {
    const { state, balance, events } = this.ctx;
    const beacon = state.beacon;
    if (!beacon || beacon.channelSeconds <= 0) return;
    beacon.channelSeconds = 0;
    state.notification = `Extraction interrupted: ${reason}.`;
    events.emit('extraction:progress', { seconds: 0, required: balance.extraction.channelSeconds, interrupted: true });
  }
  private expireBeacon(now: number): void {
    const { state, events } = this.ctx;
    const beacon = state.beacon;
    if (!beacon || now + TIME_EPSILON < beacon.closesAt) return;
    this.interruptChannel('Beacon window closed');
    this.nextBeaconIndex = beacon.index + 1;
    state.beacon = null;
    this.beaconOpened = false;
    state.notification = 'Beacon closed. Survive until the next window.';
    events.emit('beacon:changed', { beacon: null });
    this.updateBeaconSchedule(now);
  }
  private recordDiscovery(id: string): void {
    const { state, events } = this.ctx;
    if (!DISCOVERY_IDS.includes(id) || state.profile.discoveries.includes(id) || state.runDiscoveries.includes(id)) return;
    state.runDiscoveries.push(id);
    events.emit('discovery:recorded', { id });
  }
  private recordLandmarkVisits(): void {
    for (const landmark of this.ctx.state.world?.landmarks ?? []) {
      if (distanceXZ(landmark.position, this.ctx.state.player.position) <= GDD_RULES.landmarkVisitRadius) this.recordDiscovery(`landmark:${landmark.id}`);
    }
  }

  private interactNearby(): void {
    if (!this.canInteract()) return;
    const { state } = this.ctx;
    const landmarks = [...(state.world?.landmarks ?? [])].filter(landmark => distanceXZ(state.player.position, landmark.position) <= GDD_RULES.chestRadius)
      .sort((a, b) => distanceXZ(state.player.position, a.position) - distanceXZ(state.player.position, b.position) || a.id.localeCompare(b.id));
    const landmark = landmarks[0];
    if (!landmark) return;
    if (landmark.id === 'ashen-spire' && !state.bossSummoned && canAfford(state.materials, this.ctx.balance.recipes['summon-boss'].cost)) this.craft('summon-boss');
    else this.buyDraft(landmark.id);
  }
  private craft(recipeId: RecipeId): boolean {
    if (!this.canInteract()) return false;
    const { state, balance, events } = this.ctx;
    // Ordinary recipes are menu actions in a fully paused simulation. The
    // proximity-checked altar is the sole world-interaction recipe.
    if (recipeId !== 'summon-boss' && (state.phase !== 'paused' || state.pauseReason !== 'menu')) return false;
    const recipe = balance.recipes[recipeId];
    if (!canAfford(state.materials, recipe.cost)) return false;
    switch (recipeId) {
      case 'stone-tool': if (tierRank(state.player.toolTier) >= tierRank('stone')) return false; break;
      case 'stone-weapon': if (tierRank(state.player.weaponTier) >= tierRank('stone')) return false; break;
      case 'cursed-tool': if (tierRank(state.player.toolTier) >= tierRank('cursed')) return false; break;
      case 'cursed-weapon': if (tierRank(state.player.weaponTier) >= tierRank('cursed')) return false; break;
      case 'bandage': if (state.player.bandages >= balance.player.bandageMax) return false; break;
      case 'summon-boss': {
        const altar = state.world?.landmarks.find(landmark => landmark.id === 'ashen-spire');
        if (state.bossSummoned || !altar || !this.reachable?.includes(altar.position) || distanceXZ(state.player.position, altar.position) > GDD_RULES.altarRadius) return false;
        if ([...state.enemies.values()].some(enemy => enemy.archetype === 'rootbound-sovereign' && enemy.hp > 0 && enemy.mode !== 'dead')) return false;
        break;
      }
      case 'arrows': if (!Number.isSafeInteger(state.player.arrows + GDD_RULES.arrowBundle)) return false; break;
    }
    // All eligibility is validated before costs or equipment change.
    spendMaterials(state.materials, recipe.cost);
    this.interruptChannel('Crafting');
    this.bandage = null;
    switch (recipeId) {
      case 'stone-tool': state.player.toolTier = 'stone'; break;
      case 'stone-weapon': state.player.weaponTier = 'stone'; break;
      case 'cursed-tool': state.player.toolTier = 'cursed'; break;
      case 'cursed-weapon': state.player.weaponTier = 'cursed'; break;
      case 'arrows': state.player.arrows += GDD_RULES.arrowBundle; break;
      case 'bandage': state.player.bandages++; break;
      case 'summon-boss': {
        const altar = state.world?.landmarks.find(landmark => landmark.id === 'ashen-spire');
        if (!altar) throw new Error('Validated boss altar disappeared during synchronous crafting.');
        state.bossSummoned = true;
        this.disturbThreat(balance.threat.bossIncrease, false);
        this.requestSpawn('rootbound-sovereign', 'normal', altar.position);
        events.emit('audio:cue', { cue: 'boss', position: { ...altar.position } });
        break;
      }
    }
    state.notification = `${recipe.name} crafted.`;
    events.emit('item:crafted', { recipeId });
    events.emit('audio:cue', { cue: 'craft', position: { ...state.player.position } });
    return true;
  }
  private makeDraft(paidGold: number): BuffDraft | null {
    const { state, rng, balance } = this.ctx;
    const draft = createDraft(`${state.runId}:draft:${this.draftSequence + 1}`, state.buffs, rng, paidGold, balance);
    if (draft) this.draftSequence++;
    return draft;
  }
  private buyDraft(chestId: LandmarkId): boolean {
    if (!this.canInteract() || this.ctx.state.pendingDrafts.length > 0) return false;
    const { state, balance } = this.ctx;
    const chest = state.world?.landmarks.find(landmark => landmark.id === chestId);
    if (!chest || !this.reachable?.includes(chest.position) || distanceXZ(state.player.position, chest.position) > GDD_RULES.chestRadius) return false;
    const cost = balance.buffEffects.firstChestCost + state.paidDraftCount * balance.buffEffects.chestCostIncrease;
    if (state.materials.gold < cost) return false;
    const draft = this.makeDraft(cost);
    if (!draft) return false;
    state.materials.gold -= cost;
    state.paidDraftCount++;
    this.openDraft(draft);
    return true;
  }
  private openDraft(draft: BuffDraft): void {
    const { state, events } = this.ctx;
    this.interruptChannel('Draft opened');
    this.bandage = null;
    state.activeDraft = draft;
    events.emit('buff:draft-opened', { draft: { ...draft, choices: [...draft.choices] } });
    events.emit('audio:cue', { cue: 'draft', position: null });
  }
  private openPendingDraft(): void {
    const { state, balance } = this.ctx;
    if (!this.hasActiveRun() || state.player.hp <= 0 || state.activeDraft) return;
    if (state.phase === 'paused' && state.pauseReason !== 'draft') return;
    while (state.pendingDrafts.length) {
      const queued = state.pendingDrafts.shift();
      if (!queued) continue;
      // Keep the original seeded choices, removing newly capped ones, never reroll.
      const choices = queued.choices.filter(id => state.buffs[id] < balance.buffs[id].maxStacks);
      if (choices.length) { this.openDraft({ ...queued, choices }); return; }
    }
  }
  private chooseBuff(draftId: string, buffId: BuffId): boolean {
    const { state, balance, events } = this.ctx;
    if (!this.hasActiveRun() || state.player.hp <= 0 || (state.phase === 'paused' && state.pauseReason !== 'draft')) return false;
    const draft = state.activeDraft;
    if (!draft || draft.id !== draftId || !draft.choices.includes(buffId) || state.buffs[buffId] >= balance.buffs[buffId].maxStacks) return false;
    state.buffs[buffId]++;
    state.activeDraft = null;
    if (buffId === 'frost-nova' && state.buffs[buffId] === 1) this.frostSeconds = 0;
    if (buffId === 'meteor-strike' && state.buffs[buffId] === 1) this.meteorSeconds = 0;
    events.emit('buff:chosen', { id: buffId, stacks: state.buffs[buffId] });
    this.openPendingDraft();
    return true;
  }
  private upgradeSkill(nodeId: Extract<GameAction, { type: 'upgrade-skill' }>['nodeId']): boolean {
    const { state, balance } = this.ctx;
    const current = state.profile.skills[nodeId];
    if (state.phase !== 'hub' || current === balance.progression.maxRank) return false;
    const cost = balance.progression.skillCosts[current];
    if (cost === undefined || state.profile.soulShards < cost) return false;
    const next = current === 0 ? 1 : current === 1 ? 2 : 3;
    state.profile.soulShards -= cost;
    state.profile.skills[nodeId] = next;
    state.notification = `${balance.skills[nodeId].name} upgraded to rank ${next}.`;
    return true;
  }
  private upgradeRelic(recipeId: RelicRecipeId): boolean {
    const { state, balance } = this.ctx;
    const current = state.profile.relicRanks[recipeId];
    if (state.phase !== 'hub' || !state.profile.blueprints.includes(recipeId) || current === balance.progression.maxRank) return false;
    const souls = balance.progression.relicSoulCosts[current], cores = balance.progression.relicCoreCosts[current];
    if (souls === undefined || cores === undefined || state.profile.soulShards < souls || state.profile.relicCores < cores) return false;
    const next = current === 0 ? 1 : current === 1 ? 2 : 3;
    state.profile.soulShards -= souls;
    state.profile.relicCores -= cores;
    state.profile.relicRanks[recipeId] = next;
    state.profile.relicVisuals[recipeId] = { kind: 'procedural', recipeId, seed: relicVisualSeed(recipeId, next) };
    state.notification = `${balance.relics[recipeId].name} forged at rank ${next}.`;
    return true;
  }
  private finishRun(outcome: RunResult['outcome'], multiplier: number): void {
    const { state, events } = this.ctx;
    const result = settleRun(state, outcome, multiplier, this.ctx.balance);
    this.meteors.length = 0;
    this.bandage = null;
    this.stepStart = null;
    this.stepPosition = null;
    this.hostileHitThisStep = false;
    this.nodeIndex.clear();
    this.lootIndex.clear();
    if (!result) return;
    state.notification = outcome === 'extracted' ? `Extracted: ${result.bankedSouls} Souls banked, plus ${result.discoverySouls} discovery Souls.` : outcome === 'dead' ? 'Run lost. Unbanked loot was discarded.' : 'Run abandoned. No rewards banked.';
    events.emit('beacon:changed', { beacon: null });
    if (outcome !== 'abandoned') events.emit('audio:cue', { cue: outcome === 'extracted' ? 'extract' : 'death', position: null });
    // Main transitions phase and persists this already-settled profile.
    events.emit('run:ended', { result: { ...result, bankedBlueprints: [...result.bankedBlueprints] } });
  }
}
