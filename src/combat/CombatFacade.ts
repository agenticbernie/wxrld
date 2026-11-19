import type { GameContext } from '../core/context';
import { distanceXZ } from '../core/math';
import { getPlayerStats } from '../core/selectors';
import { SpatialHash } from '../core/spatial-hash';
import { EnemyDirector } from '../entities/EnemyDirector';
import { PlayerController } from '../entities/PlayerController';
import { ProjectilePool } from '../entities/ProjectilePool';
import type { EnemyState, EntityId, GameEventMap, InputFrame, ResourceId, ResourceState } from '../types/game';
import { isOverdriveEligible, LifestealBudget } from './damage';

/** The combat field owner; systems advance the shared clock before calling update. */
export class CombatFacade {
  private readonly actors = new SpatialHash<EntityId>(6);
  private readonly nodes = new SpatialHash<ResourceId>(4);
  private readonly enemies: EnemyDirector;
  private readonly player: PlayerController;
  private readonly projectiles: ProjectilePool;
  private readonly lifesteal = new LifestealBudget();
  private readonly lightningUntil = new Map<EntityId, number>();
  private readonly subscriptions: (() => void)[] = [];
  private indexedResources: Map<ResourceId, ResourceState> | null = null;
  private indexedResourceCount = -1;
  private runId: string;
  private disposed = false;
  private ended = false;
  private resolvingSecondary = false;

  constructor(private readonly ctx: GameContext) {
    this.runId = ctx.state.runId;
    const shoot: ProjectilePool['spawn'] = (...args) => this.projectiles.spawn(...args);
    this.projectiles = new ProjectilePool(ctx, {
      actors: this.actors,
      hitEnemy: (enemy, damage, base) => this.directHit(enemy, damage, base),
      hitPlayer: (sourceId, damage) => this.hostileHit(sourceId, damage),
    });
    this.enemies = new EnemyDirector(ctx, { actors: this.actors, shoot, hitPlayer: (sourceId, damage) => this.hostileHit(sourceId, damage) });
    this.player = new PlayerController(ctx, { actors: this.actors, nodes: this.nodes, shoot, hitEnemy: (enemy, damage, base) => this.directHit(enemy, damage, base) });
    this.subscriptions.push(
      ctx.events.on('enemy:spawn-requested', request => { if (this.live()) this.enemies.spawn(request); }),
      ctx.events.on('player:heal-requested', request => {
        if (!this.live()) return;
        this.synchronizeOverdrive();
        if (request.source === 'passive') {
          const delay = ctx.balance.player.passiveHealDelay - ctx.state.profile.skills.recovery * ctx.balance.skills.recovery.perRank;
          if (ctx.state.elapsedSeconds < ctx.state.passiveHealBlockedUntil || ctx.state.elapsedSeconds - ctx.state.player.lastHostileHitAt < delay) return;
        }
        this.heal(request.amount);
      }),
      ctx.events.on('combat:area-requested', request => { if (this.live()) this.area(request); }),
      ctx.events.on('resource:depleted', request => { this.nodes.remove(request.id); }),
      ctx.events.on('run:ended', request => {
        if (request.result.runId === this.runId) { this.ended = true; this.player.clearHeldActions(); }
      }),
      ctx.events.on('buff:draft-opened', () => this.player.clearHeldActions()),
    );
  }

  resetRun(): void {
    if (this.disposed) return;
    this.runId = this.ctx.state.runId; this.ended = false;
    this.actors.clear(); this.nodes.clear(); this.enemies.reset(); this.projectiles.reset();
    this.ctx.state.enemies.clear();
    this.lightningUntil.clear(); this.lifesteal.reset();
    this.indexedResources = null; this.indexedResourceCount = -1;
    this.player.reset();
    this.synchronizeOverdrive();
    this.indexResources();
  }

  update(dt: number, input: InputFrame): void {
    if (!this.live()) { this.player.clearHeldActions(); return; }
    if (!Number.isFinite(dt) || dt <= 0 || !this.ctx.state.world) return;
    // Systems can heal before this step; refresh eligibility before selecting attack stats.
    this.synchronizeOverdrive();
    this.indexResources();
    this.player.update(dt, input);
    if (!this.live()) return;
    this.enemies.update(dt);
    if (!this.live()) return;
    this.projectiles.update(dt);
    this.synchronizeOverdrive();
    // Removed corpses cannot keep per-target lightning cooldown storage alive indefinitely.
    for (const [id, until] of this.lightningUntil) if (until <= this.ctx.state.elapsedSeconds || !this.ctx.state.enemies.has(id)) this.lightningUntil.delete(id);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
    this.player.clearHeldActions(); this.enemies.reset(); this.projectiles.reset();
    this.actors.clear(); this.nodes.clear(); this.lightningUntil.clear(); this.lifesteal.reset();
  }

  private live(): boolean {
    const state = this.ctx.state;
    return !this.disposed && !this.ended && state.runId === this.runId && state.phase === 'playing' && state.result === null && state.player.hp > 0;
  }

  private indexResources(): void {
    const resources = this.ctx.state.resources;
    if (resources === this.indexedResources && resources.size === this.indexedResourceCount) return;
    this.nodes.clear();
    for (const node of resources.values()) if (!node.depleted && node.hp > 0) this.nodes.set(node.id, node.position);
    this.indexedResources = resources; this.indexedResourceCount = resources.size;
  }

  private synchronizeOverdrive(): void {
    const { state, balance, events } = this.ctx;
    const active = isOverdriveEligible(state.player.hp, state.player.maxHp, balance.overdrive.threshold);
    if (state.player.overdrive === active) return;
    state.player.overdrive = active;
    events.emit('player:overdrive', { active });
    if (active) events.emit('audio:cue', { cue: 'overdrive', position: { ...state.player.position } });
  }

  private heal(amount: number): void {
    if (!this.live() || !Number.isFinite(amount) || amount <= 0) return;
    const player = this.ctx.state.player;
    player.hp = Math.min(player.maxHp, player.hp + amount);
    this.synchronizeOverdrive();
  }

  private hostileHit(sourceId: EntityId, damage: number): void {
    if (!this.live() || !Number.isFinite(damage) || damage < 0) return;
    const { state, balance, events } = this.ctx;
    const player = state.player;
    // A hostile contact interrupts use/extraction even if immunity or reduction absorbs it.
    player.lastHostileHitAt = state.elapsedSeconds;
    this.player.interruptUse();
    this.synchronizeOverdrive();
    const stats = getPlayerStats(state, balance);
    const removed = state.elapsedSeconds < player.invulnerableUntil ? 0 : Math.min(player.hp, damage * Math.max(0, 1 - stats.damageReduction));
    player.hp = Math.max(0, player.hp - removed);
    this.synchronizeOverdrive();
    events.emit('actor:damaged', { id: 'player', sourceId, amount: removed, hpRemaining: player.hp, position: { ...player.position }, critical: false });
    if (removed > 0) {
      events.emit('fx:requested', { kind: 'hit', position: { ...player.position }, direction: null, intensity: Math.min(2, removed / 12) });
      events.emit('audio:cue', { cue: 'hit', position: { ...player.position } });
    }
  }

  private directHit(enemy: EnemyState, damage: number, weaponBase: number): void {
    if (!this.live() || enemy.hp <= 0 || this.enemies.isInvulnerable(enemy.id)) return;
    this.synchronizeOverdrive();
    const { state, balance, events, rng } = this.ctx;
    const stats = getPlayerStats(state, balance);
    const critical = rng.next() < stats.critChance;
    const removed = this.damageEnemy(enemy, damage * (critical ? stats.critMultiplier : 1), critical);
    if (removed <= 0) return;
    const healing = this.lifesteal.claim(state.elapsedSeconds, removed, stats.lifestealFraction, state.player.maxHp - state.player.hp, balance.overdrive.maxLifestealFraction, balance.overdrive.maxLifestealPerSecond);
    this.heal(healing);
    events.emit('fx:requested', { kind: critical ? 'crit' : 'hit', position: { ...enemy.position }, direction: { ...state.player.facing }, intensity: critical ? 1.6 : 1 });
    events.emit('audio:cue', { cue: 'hit', position: { ...enemy.position } });
    this.chain(enemy, weaponBase);
  }

  /** Returns actual HP removed. Secondary calls bypass crit, lifesteal and recursive procs. */
  private damageEnemy(enemy: EnemyState, damage: number, critical: boolean): number {
    if (!this.live() || enemy.hp <= 0 || this.enemies.isInvulnerable(enemy.id) || !Number.isFinite(damage) || damage <= 0) return 0;
    const removed = Math.min(enemy.hp, damage);
    enemy.hp = Math.max(0, enemy.hp - removed);
    const died = enemy.hp <= 0;
    if (died) this.enemies.markDead(enemy);
    else this.enemies.onDamaged(enemy);
    const position = { ...enemy.position };
    this.ctx.events.emit('actor:damaged', { id: enemy.id, sourceId: 'player', amount: removed, hpRemaining: enemy.hp, position, critical });
    if (died) {
      // HP/mode are already dead before listeners can synchronously request another hit.
      this.ctx.events.emit('enemy:died', { id: enemy.id, archetype: enemy.archetype, position });
      this.ctx.events.emit('fx:requested', { kind: 'death', position, direction: null, intensity: enemy.archetype === 'rootbound-sovereign' ? 3 : 1 });
    }
    return removed;
  }

  private chain(origin: EnemyState, weaponBase: number): void {
    if (!this.live() || this.resolvingSecondary || !(weaponBase > 0)) return;
    const { state, balance, events } = this.ctx;
    const stacks = Math.min(balance.buffs['chain-lightning'].maxStacks, Math.max(0, Math.floor(state.buffs['chain-lightning'])));
    if (stacks <= 0) return;
    const targets: EnemyState[] = [];
    for (const id of this.actors.query(origin.position, balance.buffEffects.lightningRange)) {
      if (id === origin.id || (this.lightningUntil.get(id) ?? 0) > state.elapsedSeconds) continue;
      const enemy = state.enemies.get(id);
      if (enemy && enemy.hp > 0 && !this.enemies.isInvulnerable(id)) targets.push(enemy);
    }
    targets.sort((a, b) => distanceXZ(a.position, origin.position) - distanceXZ(b.position, origin.position) || a.id.localeCompare(b.id));
    this.resolvingSecondary = true;
    try {
      for (const enemy of targets.slice(0, stacks)) {
        // Reserve before damage emission so synchronous listeners cannot duplicate a chain.
        this.lightningUntil.set(enemy.id, state.elapsedSeconds + balance.buffEffects.lightningCooldown);
        const removed = this.damageEnemy(enemy, weaponBase * balance.buffs['chain-lightning'].perStack, false);
        if (removed > 0) {
          events.emit('fx:requested', { kind: 'lightning', position: { ...origin.position }, direction: { x: enemy.position.x - origin.position.x, y: enemy.position.y - origin.position.y, z: enemy.position.z - origin.position.z }, intensity: 1 });
          events.emit('audio:cue', { cue: 'lightning', position: { ...enemy.position } });
        }
      }
    } finally { this.resolvingSecondary = false; }
  }

  private area(request: GameEventMap['combat:area-requested']): void {
    if (this.resolvingSecondary || !Number.isFinite(request.radius) || request.radius < 0 || !Number.isFinite(request.origin.x) || !Number.isFinite(request.origin.z)) return;
    this.synchronizeOverdrive();
    this.resolvingSecondary = true;
    try {
      for (const id of this.actors.query(request.origin, request.radius)) {
        if (!this.live()) break;
        const enemy = this.ctx.state.enemies.get(id);
        if (!enemy || enemy.hp <= 0) continue;
        if (request.kind === 'meteor') this.damageEnemy(enemy, request.damage, false);
        if (Number.isFinite(request.slowFraction) && Number.isFinite(request.durationSeconds)) this.enemies.slow(id, request.slowFraction * (enemy.archetype === 'rootbound-sovereign' ? 0.5 : 1), request.durationSeconds);
      }
    } finally { this.resolvingSecondary = false; }
  }
}
