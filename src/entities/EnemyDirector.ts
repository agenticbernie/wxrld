import type { GameContext } from '../core/context';
import { distanceXZ, normalizeXZ } from '../core/math';
import type { SpatialHash } from '../core/spatial-hash';
import type { EnemyState, EntityId, GameEventMap, ProjectileState, Vec3 } from '../types/game';
import { scaledEnemyStats } from '../combat/damage';
import { actorRadius, finitePosition, inMeleeArc, moveOnGround, rotateXZ } from '../combat/geometry';

type AttackKind = 'melee' | 'slam' | 'spit' | 'blink' | 'roots' | 'volley';
type Brain = {
  hunted: boolean; side: number; damage: number; nextAttackAt: number; attackIndex: number;
  attack: AttackKind; target: Vec3; transitionUntil: number; slowUntil: number; slowFraction: number;
};
export type EnemyPorts = {
  actors: SpatialHash<EntityId>;
  hitPlayer: (sourceId: EntityId, amount: number) => void;
  shoot: (ownerId: EntityId, kind: ProjectileState['kind'], origin: Vec3, direction: Vec3, damage: number, speed: number, range: number, weaponBase: number) => void;
};

/** Simulation-only brains. EnemyState.mode/facing remain the renderer's authoritative pose/tell. */
export class EnemyDirector {
  private readonly brains = new Map<EntityId, Brain>();
  private readonly freeBrains: Brain[] = [];
  constructor(private readonly ctx: GameContext, private readonly ports: EnemyPorts) {}

  reset(): void {
    for (const brain of this.brains.values()) this.freeBrains.push(brain);
    this.brains.clear();
  }

  spawn(request: GameEventMap['enemy:spawn-requested']): void {
    const { state, balance } = this.ctx;
    if (!state.world || !finitePosition(request.position) || !state.world.isWalkable(request.position.x, request.position.z) || state.enemies.has(request.id) || request.id === 'player') return;
    let ordinary = 0, hunters = 0, wyverns = 0, bosses = 0;
    for (const enemy of state.enemies.values()) {
      if (enemy.hp <= 0) continue;
      if (enemy.archetype === 'rootbound-sovereign') bosses++;
      else ordinary++;
      if (enemy.archetype === 'relic-hunter') hunters++;
      if (enemy.archetype === 'blood-wyvern') wyverns++;
    }
    if (request.archetype === 'rootbound-sovereign' ? bosses > 0 : ordinary >= balance.spawning.maxEnemies) return;
    if (request.archetype === 'relic-hunter' && hunters >= balance.spawning.maxHunters) return;
    if (request.archetype === 'blood-wyvern' && wyverns >= balance.spawning.maxWyverns) return;
    const base = balance.enemies[request.archetype];
    const scaled = scaledEnemyStats(base.hp, base.damage, request.tier, state.cycleIndex, balance);
    const position = { ...request.position, y: state.world.heightAt(request.position.x, request.position.z) + (request.archetype === 'blood-wyvern' ? 1.8 : 0) };
    const enemy: EnemyState = {
      id: request.id, archetype: request.archetype, tier: request.tier, position,
      facing: normalizeXZ(state.player.position.x - position.x, state.player.position.z - position.z),
      hp: scaled.hp, maxHp: scaled.hp, mode: 'idle', modeUntil: 0, phase: 1,
    };
    const brain = this.freeBrains.pop() ?? {
      hunted: false, side: 1, damage: 0, nextAttackAt: 0, attackIndex: 0,
      attack: 'melee', target: { x: 0, y: 0, z: 0 }, transitionUntil: 0, slowUntil: 0, slowFraction: 0,
    };
    brain.hunted = state.dayPhase === 'night' || request.archetype === 'rootbound-sovereign' || request.archetype === 'relic-hunter';
    brain.side = this.ctx.rng.next() < 0.5 ? -1 : 1;
    brain.damage = scaled.damage;
    brain.nextAttackAt = state.elapsedSeconds + base.windup;
    brain.attackIndex = 0; brain.attack = 'melee'; brain.transitionUntil = 0;
    brain.slowUntil = 0; brain.slowFraction = 0;
    Object.assign(brain.target, position);
    state.enemies.set(enemy.id, enemy);
    this.brains.set(enemy.id, brain);
    this.ports.actors.set(enemy.id, position);
    if (request.archetype === 'rootbound-sovereign') this.ctx.events.emit('audio:cue', { cue: 'boss', position: { ...position } });
  }

  isInvulnerable(id: EntityId): boolean {
    return (this.brains.get(id)?.transitionUntil ?? 0) > this.ctx.state.elapsedSeconds;
  }

  onDamaged(enemy: EnemyState): void {
    const brain = this.brains.get(enemy.id);
    if (!brain || enemy.hp <= 0) return;
    brain.hunted = true;
    this.tryTransition(enemy, brain);
  }

  markDead(enemy: EnemyState): void {
    enemy.mode = 'dead'; enemy.modeUntil = this.ctx.state.elapsedSeconds + 0.7;
    this.ports.actors.remove(enemy.id);
  }

  slow(id: EntityId, fraction: number, duration: number): void {
    const brain = this.brains.get(id);
    if (!brain || fraction <= 0 || duration <= 0) return;
    const now = this.ctx.state.elapsedSeconds;
    brain.slowFraction = Math.max(brain.slowUntil > now ? brain.slowFraction : 0, Math.min(0.9, fraction));
    brain.slowUntil = Math.max(brain.slowUntil, now + duration);
  }

  update(dt: number): void {
    const { state, balance } = this.ctx;
    const now = state.elapsedSeconds;
    for (const enemy of state.enemies.values()) {
      if (state.player.hp <= 0 || state.phase !== 'playing' || state.result) break;
      const brain = this.brains.get(enemy.id);
      if (!brain) continue;
      if (enemy.hp <= 0) {
        if (now >= enemy.modeUntil) {
          state.enemies.delete(enemy.id); this.brains.delete(enemy.id); this.freeBrains.push(brain);
        }
        continue;
      }
      if (brain.transitionUntil > now) continue;
      if (brain.transitionUntil > 0) {
        brain.transitionUntil = 0;
        if (this.tryTransition(enemy, brain)) continue;
        enemy.mode = 'chase'; enemy.modeUntil = 0; brain.nextAttackAt = now + 0.4;
      }
      if (this.tryTransition(enemy, brain)) continue;
      if (enemy.mode === 'windup') {
        if (now >= enemy.modeUntil) {
          this.resolveAttack(enemy, brain);
          enemy.mode = 'attack'; enemy.modeUntil = now + 0.12;
          const cooldown = balance.enemies[enemy.archetype].cooldown * (enemy.archetype === 'rootbound-sovereign' && enemy.phase === 3 ? 0.8 : 1);
          brain.nextAttackAt = now + cooldown;
        }
        continue;
      }
      if (enemy.mode === 'attack') {
        if (now >= enemy.modeUntil) { enemy.mode = 'recover'; enemy.modeUntil = Math.min(brain.nextAttackAt, now + 0.45); }
        continue;
      }
      if (enemy.mode === 'recover' && now < enemy.modeUntil) continue;
      const distance = distanceXZ(enemy.position, state.player.position);
      const detection = state.dayPhase === 'night' ? balance.spawning.nightDetection : balance.spawning.dayDetection;
      // Detection latches pursuit. Night spawns already hunt; losing range never resets it.
      if (distance <= detection) brain.hunted = true;
      if (!brain.hunted) { enemy.mode = 'idle'; enemy.modeUntil = 0; continue; }
      const toPlayer = normalizeXZ(state.player.position.x - enemy.position.x, state.player.position.z - enemy.position.z);
      Object.assign(enemy.facing, toPlayer);
      enemy.mode = 'chase'; enemy.modeUntil = 0;
      const attackRange = enemy.archetype === 'rootbound-sovereign' ? 10 : enemy.archetype === 'blood-wyvern' ? 14 : enemy.archetype === 'relic-hunter' ? 6 : enemy.archetype === 'stone-golem' ? 3.2 : 1.9;
      if (distance <= attackRange && now >= brain.nextAttackAt) { this.beginAttack(enemy, brain); continue; }
      this.move(enemy, brain, toPlayer, distance, dt);
    }
  }

  private tryTransition(enemy: EnemyState, brain: Brain): boolean {
    if (enemy.archetype !== 'rootbound-sovereign' || enemy.phase === 3 || brain.transitionUntil > this.ctx.state.elapsedSeconds) return false;
    const threshold = this.ctx.balance.boss.transitionThresholds[enemy.phase - 1];
    if (threshold === undefined || enemy.hp > enemy.maxHp * threshold) return false;
    enemy.phase = enemy.phase === 1 ? 2 : 3;
    brain.transitionUntil = this.ctx.state.elapsedSeconds + this.ctx.balance.boss.transitionSeconds;
    enemy.mode = 'recover'; enemy.modeUntil = brain.transitionUntil;
    this.ctx.events.emit('fx:requested', { kind: 'frost', position: { ...enemy.position }, direction: null, intensity: 4 });
    this.ctx.events.emit('audio:cue', { cue: 'boss', position: { ...enemy.position } });
    return true;
  }

  private beginAttack(enemy: EnemyState, brain: Brain): void {
    const { state, balance } = this.ctx;
    Object.assign(brain.target, state.player.position);
    switch (enemy.archetype) {
      case 'goblin-stalker': brain.attack = 'melee'; break;
      case 'stone-golem': brain.attack = 'slam'; Object.assign(brain.target, enemy.position); break;
      case 'blood-wyvern': brain.attack = 'spit'; break;
      case 'relic-hunter': brain.attack = 'blink'; break;
      case 'rootbound-sovereign': {
        const index = brain.attackIndex++ % (enemy.phase === 1 ? 2 : 3);
        brain.attack = index === 0 ? 'slam' : index === 1 ? 'roots' : 'volley';
        if (brain.attack === 'slam') Object.assign(brain.target, enemy.position);
        break;
      }
    }
    enemy.mode = 'windup';
    let tell = balance.enemies[enemy.archetype].windup;
    if (enemy.archetype === 'rootbound-sovereign') tell = Math.max(balance.boss.minimumTell, tell * (enemy.phase === 3 ? 0.85 : 1));
    enemy.modeUntil = state.elapsedSeconds + tell;
    if (brain.attack === 'roots' || brain.attack === 'blink') {
      this.ctx.events.emit('fx:requested', { kind: brain.attack === 'roots' ? 'frost' : 'slash', position: { ...brain.target }, direction: { ...enemy.facing }, intensity: 0.6 });
    }
  }

  private resolveAttack(enemy: EnemyState, brain: Brain): void {
    const { state, balance } = this.ctx;
    const player = state.player;
    if (brain.attack === 'melee') {
      if (inMeleeArc(enemy.position, enemy.facing, player.position, 2.2, Math.PI * 0.75)) this.ports.hitPlayer(enemy.id, brain.damage);
    } else if (brain.attack === 'slam' || brain.attack === 'roots') {
      const radius = brain.attack === 'roots' ? 2.1 : enemy.archetype === 'rootbound-sovereign' ? 4 : 3;
      const damage = brain.attack === 'roots' ? brain.damage * balance.boss.rootDamage / balance.enemies['rootbound-sovereign'].damage : brain.damage;
      this.ctx.events.emit('fx:requested', { kind: brain.attack === 'roots' ? 'frost' : 'hit', position: { ...brain.target }, direction: null, intensity: radius });
      if (distanceXZ(player.position, brain.target) <= radius) this.ports.hitPlayer(enemy.id, damage);
    } else if (brain.attack === 'blink') {
      if (state.world) {
        const arrival = { x: brain.target.x - enemy.facing.x * 1.1, y: brain.target.y, z: brain.target.z - enemy.facing.z * 1.1 };
        if (state.world.isWalkable(arrival.x, arrival.z)) {
          Object.assign(enemy.position, arrival);
          enemy.position.y = state.world.heightAt(arrival.x, arrival.z);
          this.ports.actors.set(enemy.id, enemy.position);
        }
      }
      this.ctx.events.emit('fx:requested', { kind: 'dash', position: { ...enemy.position }, direction: { ...enemy.facing }, intensity: 1 });
      if (distanceXZ(player.position, brain.target) <= 1.8 && distanceXZ(player.position, enemy.position) <= 2.5) this.ports.hitPlayer(enemy.id, brain.damage);
    } else {
      const direction = normalizeXZ(brain.target.x - enemy.position.x, brain.target.z - enemy.position.z);
      if (brain.attack === 'spit') {
        this.ports.shoot(enemy.id, 'wyvern-spit', enemy.position, direction, brain.damage, 13, 24, 0);
      } else {
        const count = enemy.phase === 3 ? 7 : 5;
        const damage = brain.damage * balance.boss.volleyDamage / balance.enemies['rootbound-sovereign'].damage;
        for (let i = 0; i < count; i++) this.ports.shoot(enemy.id, 'boss-shard', enemy.position, rotateXZ(direction, (i - (count - 1) / 2) * 0.16), damage, 15, 30, 0);
      }
    }
  }

  private move(enemy: EnemyState, brain: Brain, toPlayer: Vec3, distance: number, dt: number): void {
    const { state, balance } = this.ctx;
    if (!state.world) return;
    let direction = toPlayer;
    if (enemy.archetype === 'blood-wyvern') {
      const forward = distance > 10 ? 1 : distance < 6 ? -1 : 0;
      direction = normalizeXZ(toPlayer.x * forward - toPlayer.z * brain.side * 0.8, toPlayer.z * forward + toPlayer.x * brain.side * 0.8);
    } else if (enemy.archetype === 'goblin-stalker' && distance < 8 && distance > 1.7) {
      direction = rotateXZ(toPlayer, brain.side * 0.65);
    } else if (distance < (enemy.archetype === 'rootbound-sovereign' ? 4.5 : actorRadius(enemy.archetype) + 0.5)) return;
    let separationX = 0, separationZ = 0;
    const radius = actorRadius(enemy.archetype);
    for (const id of this.ports.actors.query(enemy.position, radius + 2)) {
      if (id === enemy.id || id === 'player') continue;
      const other = state.enemies.get(id);
      if (!other || other.hp <= 0) continue;
      const dx = enemy.position.x - other.position.x, dz = enemy.position.z - other.position.z;
      const length = Math.hypot(dx, dz), overlap = radius + actorRadius(other.archetype) + 0.15 - length;
      if (overlap <= 0) continue;
      if (length < 1e-5) { separationX += brain.side; separationZ += 0.5; }
      else { separationX += dx / length * overlap; separationZ += dz / length * overlap; }
    }
    direction = normalizeXZ(direction.x + separationX, direction.z + separationZ);
    const speed = balance.enemies[enemy.archetype].speed * (state.dayPhase === 'night' ? balance.spawning.nightSpeedMultiplier : 1) * (brain.slowUntil > state.elapsedSeconds ? 1 - brain.slowFraction : 1);
    const beforeX = enemy.position.x, beforeZ = enemy.position.z;
    const hover = enemy.archetype === 'blood-wyvern' ? 1.8 : 0;
    moveOnGround(enemy.position, direction.x * speed * dt, direction.z * speed * dt, state.world, hover);
    if (Math.hypot(enemy.position.x - beforeX, enemy.position.z - beforeZ) < speed * dt * 0.2) {
      const alternate = rotateXZ(direction, brain.side * Math.PI / 2);
      moveOnGround(enemy.position, alternate.x * speed * dt, alternate.z * speed * dt, state.world, hover);
    }
    this.ports.actors.set(enemy.id, enemy.position);
  }
}
