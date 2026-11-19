import type { GameContext } from '../core/context';
import { distanceXZ, normalizeXZ } from '../core/math';
import { getPlayerStats } from '../core/selectors';
import type { SpatialHash } from '../core/spatial-hash';
import type { EnemyState, EntityId, InputFrame, ProjectileState, ResourceId, ResourceState, Vec3 } from '../types/game';
import { rangedDamage } from '../combat/damage';
import { finitePosition, inMeleeArc, moveOnGround, rotateXZ } from '../combat/geometry';

export type PlayerPorts = {
  actors: SpatialHash<EntityId>; nodes: SpatialHash<ResourceId>;
  hitEnemy: (enemy: EnemyState, damage: number, weaponBase: number) => void;
  shoot: (ownerId: EntityId, kind: ProjectileState['kind'], origin: Vec3, direction: Vec3, damage: number, speed: number, range: number, weaponBase: number) => void;
};

export class PlayerController {
  private lastSpendAt = -Infinity;
  private lastSwingAt = -Infinity;
  private lastGatherAt = -Infinity;
  private lastMagicAt = -Infinity;
  private dashReadyAt = 0;
  private dashRemaining = 0;
  private readonly dashDirection: Vec3 = { x: 0, y: 0, z: 1 };
  private combo = 0;
  private drawStartedAt: number | null = null;
  // A swing owns one reusable hit record; secondary effects never re-enter this record.
  private readonly swingHits = new Set<EntityId>();

  constructor(private readonly ctx: GameContext, private readonly ports: PlayerPorts) {}

  reset(): void {
    const { state } = this.ctx;
    const player = state.player;
    if (state.world) {
      Object.assign(player.position, state.world.playerSpawn);
      player.position.y = state.world.heightAt(player.position.x, player.position.z);
    }
    Object.assign(player.velocity, { x: 0, y: 0, z: 0 });
    Object.assign(player.facing, { x: 0, y: 0, z: -1 });
    player.hp = player.maxHp; player.stamina = player.maxStamina;
    player.lastHostileHitAt = -Infinity; player.invulnerableUntil = 0;
    this.lastSpendAt = this.lastSwingAt = this.lastGatherAt = this.lastMagicAt = -Infinity;
    this.dashReadyAt = 0; this.dashRemaining = 0; this.combo = 0;
    this.drawStartedAt = null; this.swingHits.clear();
    this.ports.actors.set('player', player.position);
  }

  interruptUse(): void { this.drawStartedAt = null; }

  clearHeldActions(): void { this.drawStartedAt = null; }

  update(dt: number, input: InputFrame): void {
    const { state, balance } = this.ctx;
    const player = state.player, now = state.elapsedSeconds;
    if (!state.world) return;
    if (input.aimGround && finitePosition(input.aimGround)) {
      const dx = input.aimGround.x - player.position.x, dz = input.aimGround.z - player.position.z;
      if (Math.hypot(dx, dz) > 0.0001) Object.assign(player.facing, normalizeXZ(dx, dz));
    }
    const moveX = Number.isFinite(input.moveX) ? input.moveX : 0;
    const moveZ = Number.isFinite(input.moveZ) ? input.moveZ : 0;
    const moving = Math.hypot(moveX, moveZ) > 0.0001;
    const move = moving ? normalizeXZ(moveX, moveZ) : { x: 0, y: 0, z: 0 };

    const stats = getPlayerStats(state, balance);
    if (input.dashPressed && now >= this.dashReadyAt && this.dashRemaining <= 0 && this.spend(balance.player.dashCost * stats.staminaCostMultiplier)) {
      Object.assign(this.dashDirection, moving ? move : player.facing);
      this.dashRemaining = balance.player.dashDuration;
      this.dashReadyAt = now + balance.player.dashCooldown;
      player.invulnerableUntil = now + balance.player.dashInvulnerability;
      this.drawStartedAt = null;
      this.ctx.events.emit('fx:requested', { kind: 'dash', position: { ...player.position }, direction: { ...this.dashDirection }, intensity: 1 });
      this.ctx.events.emit('audio:cue', { cue: 'dash', position: { ...player.position } });
    }
    const beforeX = player.position.x, beforeZ = player.position.z, beforeY = player.position.y;
    const dashing = this.dashRemaining > 0;
    if (dashing) {
      const step = Math.min(dt, this.dashRemaining);
      const distance = balance.player.dashDistance * step / balance.player.dashDuration;
      moveOnGround(player.position, this.dashDirection.x * distance, this.dashDirection.z * distance, state.world);
      this.dashRemaining = Math.max(0, this.dashRemaining - step);
    } else if (moving) {
      let speed = stats.movementSpeed;
      if (input.sprintHeld && player.stamina > 0) {
        const wanted = balance.player.sprintCost * stats.staminaCostMultiplier * dt;
        const spent = Math.min(player.stamina, wanted);
        this.spend(spent);
        speed += (stats.sprintSpeed - speed) * (wanted > 0 ? spent / wanted : 1);
      }
      moveOnGround(player.position, move.x * speed * dt, move.z * speed * dt, state.world);
    } else player.position.y = state.world.heightAt(player.position.x, player.position.z);
    player.velocity.x = (player.position.x - beforeX) / dt;
    player.velocity.y = (player.position.y - beforeY) / dt;
    player.velocity.z = (player.position.z - beforeZ) / dt;
    this.ports.actors.set('player', player.position);

    if (dashing) { this.regenerate(dt); return; }

    const beacon = state.beacon;
    const beaconHeld = input.interactHeld && beacon !== null && now >= beacon.opensAt && now <= beacon.closesAt && distanceXZ(player.position, beacon.position) <= balance.extraction.radius;
    const wantsTool = input.meleeHeld || (input.interactHeld && !beaconHeld);
    const reach = balance.combat.meleeReach + state.buffs.cleave * balance.buffs.cleave.perStack;
    const arc = balance.combat.meleeArc + state.buffs.cleave * balance.buffEffects.cleaveArcPerStack;
    const enemyTarget = wantsTool ? this.findEnemy(reach, arc) : null;
    const node = wantsTool && !beaconHeld && !enemyTarget ? this.findNode(input.interactHeld) : null;
    if (node) {
      this.drawStartedAt = null;
      if (now - this.lastGatherAt + 1e-10 >= balance.combat.gatherInterval) {
        this.lastGatherAt = now;
        this.ctx.events.emit('resource:hit', { id: node.id, amount: balance.combat.toolDamage[player.toolTier], toolTier: player.toolTier, position: { ...node.position } });
        this.ctx.events.emit('fx:requested', { kind: 'slash', position: { ...player.position }, direction: { ...player.facing }, intensity: 0.6 });
      }
    } else if (input.meleeHeld || (input.interactHeld && !beaconHeld && enemyTarget !== null)) {
      this.drawStartedAt = null;
      if (now - this.lastSwingAt + 1e-10 >= 1 / stats.attackRate && this.spend(balance.combat.meleeCost * stats.staminaCostMultiplier)) this.swing(reach, arc);
    } else {
      this.bow(input);
    }
    const attackRateMultiplier = stats.attackRate / balance.combat.attackRate;
    if (input.magicPressed && now - this.lastMagicAt + 1e-10 >= balance.combat.magicCooldown / attackRateMultiplier && this.spend(balance.combat.magicCost * stats.staminaCostMultiplier)) {
      this.lastMagicAt = now; this.drawStartedAt = null;
      this.ports.shoot('player', 'magic', player.position, player.facing, rangedDamage(balance.combat.magicDamage, state, balance), balance.combat.magicSpeed, balance.combat.magicRange, balance.combat.magicDamage);
      this.ctx.events.emit('fx:requested', { kind: 'magic', position: { ...player.position }, direction: { ...player.facing }, intensity: 1 });
      this.ctx.events.emit('audio:cue', { cue: 'magic', position: { ...player.position } });
    }
    this.regenerate(dt);
  }

  private spend(amount: number): boolean {
    if (this.ctx.state.player.stamina + 1e-10 < amount) return false;
    if (amount > 0) {
      this.ctx.state.player.stamina = Math.max(0, this.ctx.state.player.stamina - amount);
      this.lastSpendAt = this.ctx.state.elapsedSeconds;
    }
    return true;
  }

  private regenerate(dt: number): void {
    const { state, balance } = this.ctx;
    const now = state.elapsedSeconds;
    const eligible = Math.max(0, now - Math.max(now - dt, this.lastSpendAt + balance.player.staminaRegenDelay));
    state.player.stamina = Math.min(state.player.maxStamina, state.player.stamina + eligible * balance.player.staminaRegen);
  }

  private findEnemy(reach: number, arc: number): EnemyState | null {
    const player = this.ctx.state.player;
    let nearest: EnemyState | null = null, best = Infinity;
    for (const id of this.ports.actors.query(player.position, reach)) {
      const enemy = this.ctx.state.enemies.get(id);
      if (!enemy || enemy.hp <= 0 || !inMeleeArc(player.position, player.facing, enemy.position, reach, arc)) continue;
      const distance = distanceXZ(player.position, enemy.position);
      if (distance < best) { nearest = enemy; best = distance; }
    }
    return nearest;
  }

  private findNode(interact: boolean): ResourceState | null {
    const { state, balance } = this.ctx;
    let nearest: ResourceState | null = null, best = Infinity;
    for (const id of this.ports.nodes.query(state.player.position, balance.combat.gatherReach)) {
      const node = state.resources.get(id);
      if (!node || node.hp <= 0 || node.depleted || (node.kind === 'cursed' && state.player.toolTier === 'wood')) continue;
      if (!interact && !inMeleeArc(state.player.position, state.player.facing, node.position, balance.combat.gatherReach, balance.combat.meleeArc)) continue;
      const distance = distanceXZ(state.player.position, node.position);
      if (distance < best) { nearest = node; best = distance; }
    }
    return nearest;
  }

  private swing(reach: number, arc: number): void {
    const { state, balance } = this.ctx;
    const now = state.elapsedSeconds;
    if (now - this.lastSwingAt > balance.combat.comboReset) this.combo = 0;
    const multiplier = balance.combat.comboMultipliers[this.combo] ?? 1;
    const stats = getPlayerStats(state, balance);
    this.lastSwingAt = now;
    this.combo = (this.combo + 1) % balance.combat.comboMultipliers.length;
    this.swingHits.clear();
    this.ctx.events.emit('fx:requested', { kind: 'slash', position: { ...state.player.position }, direction: rotateXZ(state.player.facing, this.combo === 1 ? -0.22 : this.combo === 2 ? 0.22 : 0), intensity: multiplier });
    this.ctx.events.emit('audio:cue', { cue: 'swing', position: { ...state.player.position } });
    for (const id of this.ports.actors.query(state.player.position, reach)) {
      if (state.phase !== 'playing' || state.player.hp <= 0 || state.result) break;
      const enemy = state.enemies.get(id);
      if (!enemy || enemy.hp <= 0 || this.swingHits.has(id) || !inMeleeArc(state.player.position, state.player.facing, enemy.position, reach, arc)) continue;
      this.swingHits.add(id);
      this.ports.hitEnemy(enemy, stats.meleeDamage * multiplier, balance.combat.meleeDamage[state.player.weaponTier]);
    }
  }

  private bow(input: InputFrame): void {
    const { state, balance } = this.ctx;
    const now = state.elapsedSeconds;
    if (input.rangedHeld && this.drawStartedAt === null && state.player.arrows > 0) this.drawStartedAt = now;
    if (input.rangedReleased) {
      const rateMultiplier = getPlayerStats(state, balance).attackRate / balance.combat.attackRate;
      if (this.drawStartedAt !== null && now - this.drawStartedAt + 1e-10 >= balance.combat.bowDraw / rateMultiplier && state.player.arrows > 0) {
        state.player.arrows--;
        const damage = rangedDamage(balance.combat.bowDamage, state, balance);
        const extras = Math.min(balance.buffs.multishot.maxStacks, Math.max(0, Math.floor(state.buffs.multishot)));
        this.ports.shoot('player', 'arrow', state.player.position, state.player.facing, damage, balance.combat.arrowSpeed, balance.combat.bowRange, balance.combat.bowDamage);
        for (let i = 0; i < extras; i++) {
          const side = i % 2 === 0 ? -1 : 1;
          const angle = side * (Math.floor(i / 2) + 1) * Math.PI / 24;
          this.ports.shoot('player', 'arrow', state.player.position, rotateXZ(state.player.facing, angle), damage * balance.buffs.multishot.perStack, balance.combat.arrowSpeed, balance.combat.bowRange, balance.combat.bowDamage);
        }
        this.ctx.events.emit('fx:requested', { kind: 'arrow', position: { ...state.player.position }, direction: { ...state.player.facing }, intensity: 1 + extras * 0.3 });
        this.ctx.events.emit('audio:cue', { cue: 'bow', position: { ...state.player.position } });
      }
      this.drawStartedAt = null;
    } else if (!input.rangedHeld) this.drawStartedAt = null;
  }
}
