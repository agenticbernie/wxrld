import type { GameContext } from '../core/context';
import { distanceXZ } from '../core/math';
import type { SpatialHash } from '../core/spatial-hash';
import type { EnemyState, EntityId, ProjectileState, Vec3 } from '../types/game';
import { actorRadius, segmentCircleHit } from '../combat/geometry';

type ProjectileRecord = { state: ProjectileState; weaponBase: number; bornAt: number };
export type ProjectilePorts = {
  actors: SpatialHash<EntityId>;
  hitEnemy: (enemy: EnemyState, damage: number, weaponBase: number) => void;
  hitPlayer: (sourceId: EntityId, damage: number) => void;
};

/** Reuses state objects, IDs and records; swept collision prevents fast-arrow tunnelling. */
export class ProjectilePool {
  private readonly records = new Map<EntityId, ProjectileRecord>();
  private readonly free: ProjectileRecord[] = [];
  private nextId = 0;
  constructor(private readonly ctx: GameContext, private readonly ports: ProjectilePorts) {}

  reset(): void {
    for (const record of this.records.values()) this.free.push(record);
    this.records.clear(); this.ctx.state.projectiles.clear();
  }

  spawn(ownerId: EntityId, kind: ProjectileState['kind'], origin: Vec3, direction: Vec3, damage: number, speed: number, range: number, weaponBase: number): void {
    if (!(damage > 0) || !(speed > 0) || !(range > 0)) return;
    const length = Math.hypot(direction.x, direction.z);
    if (length < 1e-8) return;
    const record = this.free.pop() ?? {
      state: {
        id: `projectile-${this.nextId++}`, ownerId, kind,
        position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, damage: 0, expiresAt: 0,
      }, weaponBase: 0, bornAt: 0,
    };
    const projectile = record.state;
    projectile.ownerId = ownerId; projectile.kind = kind; projectile.damage = damage;
    Object.assign(projectile.position, origin);
    projectile.position.y += kind === 'wyvern-spit' ? 0.3 : 0.9;
    projectile.velocity.x = direction.x / length * speed;
    projectile.velocity.y = 0; projectile.velocity.z = direction.z / length * speed;
    projectile.expiresAt = this.ctx.state.elapsedSeconds + range / speed;
    record.weaponBase = weaponBase; record.bornAt = this.ctx.state.elapsedSeconds;
    this.records.set(projectile.id, record);
    this.ctx.state.projectiles.set(projectile.id, projectile);
  }

  update(dt: number): void {
    const { state } = this.ctx;
    const now = state.elapsedSeconds;
    for (const record of this.records.values()) {
      if (state.player.hp <= 0 || state.phase !== 'playing' || state.result) break;
      const projectile = record.state;
      const step = Math.max(0, Math.min(now, projectile.expiresAt) - Math.max(now - dt, record.bornAt));
      if (step <= 0) { if (now >= projectile.expiresAt) this.release(record); continue; }
      const start = projectile.position;
      const end = { x: start.x + projectile.velocity.x * step, y: start.y + projectile.velocity.y * step, z: start.z + projectile.velocity.z * step };
      const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, z: (start.z + end.z) / 2 };
      const radius = distanceXZ(start, end) / 2 + 2.1;
      let firstTime = Infinity;
      let target: EnemyState | 'player' | null = null;
      for (const id of this.ports.actors.query(midpoint, radius)) {
        if (projectile.ownerId === 'player') {
          if (id === 'player') continue;
          const enemy = state.enemies.get(id);
          if (!enemy || enemy.hp <= 0) continue;
          const t = segmentCircleHit(start, end, enemy.position, actorRadius(enemy.archetype) + 0.12);
          if (t !== null && t < firstTime) { firstTime = t; target = enemy; }
        } else if (id === 'player') {
          const t = segmentCircleHit(start, end, state.player.position, 0.48);
          if (t !== null && t < firstTime) { firstTime = t; target = 'player'; }
        }
      }
      // Ground collision is swept too. Ignore vertical actor presentation offsets in hit tests.
      if (state.world) {
        const steps = Math.max(1, Math.ceil(distanceXZ(start, end) / 0.25));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          if (t >= firstTime) break;
          const x = start.x + (end.x - start.x) * t, z = start.z + (end.z - start.z) * t;
          const y = start.y + (end.y - start.y) * t;
          if (y <= state.world.heightAt(x, z) + 0.05) {
            firstTime = t; target = null; break;
          }
        }
      }
      if (Number.isFinite(firstTime)) {
        projectile.position.x += (end.x - start.x) * firstTime;
        projectile.position.y += (end.y - start.y) * firstTime;
        projectile.position.z += (end.z - start.z) * firstTime;
        // Remove before synchronous listeners can request secondary combat effects.
        this.release(record);
        if (target === 'player') this.ports.hitPlayer(projectile.ownerId, projectile.damage);
        else if (target) this.ports.hitEnemy(target, projectile.damage, record.weaponBase);
      } else {
        Object.assign(projectile.position, end);
        if (now >= projectile.expiresAt) this.release(record);
      }
    }
  }

  private release(record: ProjectileRecord): void {
    this.ctx.state.projectiles.delete(record.state.id);
    this.records.delete(record.state.id); this.free.push(record);
  }
}
