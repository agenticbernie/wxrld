import assert from 'node:assert/strict';
import test from 'node:test';
import { BALANCE } from '../config/balance';
import type { GameContext } from '../core/context';
import { GameEvents } from '../core/events';
import { Rng } from '../core/rng';
import { getPlayerStats } from '../core/selectors';
import { createProfile, createRunState, resetRunState } from '../core/state';
import type { ActorArchetype, EnemyTier, InputFrame, Vec3, WorldLayout } from '../types/game';
import { CombatFacade } from './CombatFacade';
import { isOverdriveEligible, LifestealBudget, rangedDamage, scaledEnemyStats } from './damage';
import { inMeleeArc, moveOnGround, segmentCircleHit } from './geometry';

const IDLE: InputFrame = {
  moveX: 0, moveZ: 0, aimGround: null, sprintHeld: false, dashPressed: false,
  meleeHeld: false, rangedHeld: false, rangedReleased: false, magicPressed: false,
  interactHeld: false, interactPressed: false, bandagePressed: false, pausePressed: false,
};
class NoCritRng extends Rng { override next(): number { return 0.99; } }
function setup(rng: Rng = new NoCritRng(101)) {
  const state = createRunState(createProfile());
  resetRunState(state, 101, 'combat-test');
  const world: WorldLayout = {
    seed: 101, size: 180, playerSpawn: { x: 0, y: 0, z: 0 }, nodes: [], landmarks: [],
    heightAt: () => 0, isWalkable: (x, z) => Math.abs(x) < 88 && Math.abs(z) < 88,
  };
  state.world = world;
  const ctx: GameContext = { state, events: new GameEvents(), rng, balance: BALANCE };
  const combat = new CombatFacade(ctx);
  combat.resetRun(); state.phase = 'playing';
  function step(input: Partial<InputFrame> = {}, dt = 1 / 60) {
    state.elapsedSeconds += dt;
    combat.update(dt, { ...IDLE, ...input });
  }
  function advance(seconds: number, input: Partial<InputFrame> = {}) {
    let remaining = seconds;
    while (remaining > 1e-9) { const dt = Math.min(1 / 60, remaining); step(input, dt); remaining -= dt; }
  }
  function spawn(id: string, archetype: ActorArchetype, x = 0, z = -2, tier: EnemyTier = 'normal') {
    ctx.events.emit('enemy:spawn-requested', { id, archetype, tier, position: { x, y: 0, z } });
    const enemy = state.enemies.get(id);
    assert.ok(enemy); return enemy;
  }
  return { state, ctx, combat, step, advance, spawn };
}
function close(actual: number, expected: number, epsilon = 1e-6) { assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`); }
const forward: Vec3 = { x: 0, y: 0, z: -10 };

test('swept segment hit detects tunnelling, starts inside, misses, and tangencies', () => {
  const start = { x: -5, y: 0, z: 0 }, end = { x: 5, y: 0, z: 0 }, center = { x: 0, y: 0, z: 0 };
  close(segmentCircleHit(start, end, center, 1) ?? -1, 0.4);
  assert.equal(segmentCircleHit(center, end, center, 1), 0);
  assert.equal(segmentCircleHit(start, end, { ...center, z: 2 }, 1), null);
  close(segmentCircleHit(start, end, { ...center, z: 1 }, 1) ?? -1, 0.5);
  assert.equal(segmentCircleHit(start, start, center, 1), null);
});

test('arc is directional and ground movement sweeps through intervening obstacles', () => {
  const origin = { x: 0, y: 0, z: 0 };
  assert.ok(inMeleeArc(origin, forward, { ...origin, z: -2 }, 2.5, Math.PI / 2));
  assert.equal(inMeleeArc(origin, forward, { ...origin, z: 2 }, 2.5, Math.PI / 2), false);
  const { state } = setup();
  assert.ok(state.world);
  const wall: WorldLayout = { ...state.world, isWalkable: x => !(x > 1 && x < 2) };
  moveOnGround(origin, 4, 0, wall);
  assert.ok(origin.x <= 1.01);
});

test('idle is stationary; WASD diagonals normalize; aim remains independent of movement', () => {
  const { state, step, advance } = setup();
  advance(1); close(state.player.position.z, 0);
  step({ moveX: 1, moveZ: -1, aimGround: forward }, 0.1);
  close(Math.hypot(state.player.position.x, state.player.position.z), 0.45);
  close(state.player.facing.x, 0); close(state.player.facing.z, -1);
  assert.ok(state.player.velocity.x > 0 && state.player.velocity.z < 0);
});

test('dash travels exactly 4m over .22s, costs 25, and observes its cooldown', () => {
  const { state, step, advance } = setup();
  step({ dashPressed: true, aimGround: forward });
  advance(0.22 - 1 / 60);
  close(state.player.position.z, -4); close(state.player.stamina, 75);
  const before = state.player.position.z;
  step({ dashPressed: true }); close(state.player.position.z, before);
  advance(1.2);
  step({ dashPressed: true }); assert.ok(state.player.position.z < before);
});

test('sprint uses stamina and regeneration waits the full expenditure delay', () => {
  const { state, step, advance } = setup();
  advance(1, { moveX: 1, sprintHeld: true });
  close(state.player.position.x, 7); close(state.player.stamina, 84);
  advance(0.7); close(state.player.stamina, 84);
  step({}, 0.1); close(state.player.stamina, 85.1);
});

test('melee holds at 2/sec, combos 1/1.15/1.5 and consumes 8 per swing', () => {
  const { state, step, advance, spawn } = setup();
  const enemy = spawn('golem', 'stone-golem');
  step({ meleeHeld: true, aimGround: forward }); close(enemy.hp, 186);
  advance(0.5, { meleeHeld: true, aimGround: forward }); close(enemy.hp, 169.9);
  advance(0.5, { meleeHeld: true, aimGround: forward }); close(enemy.hp, 148.9);
  assert.ok(state.player.stamina <= 76.01);
});

test('resource hits are requests only, tool-tier scaled, and use .35s cadence even in overdrive', () => {
  const { state, ctx, step, advance } = setup();
  state.resources.set('tree', { id: 'tree', kind: 'tree', position: { x: 0, y: 0, z: -2 }, hp: 60, maxHp: 60, depleted: false });
  state.player.hp = 20; state.player.toolTier = 'stone';
  const hits: number[] = [];
  ctx.events.on('resource:hit', request => hits.push(request.amount));
  step({ meleeHeld: true, aimGround: forward });
  advance(0.7, { meleeHeld: true, aimGround: forward });
  assert.deepEqual(hits, [30, 30, 30]);
  assert.equal(state.resources.get('tree')?.hp, 60);
  close(state.player.stamina, 100);
});

test('aimed enemies take priority over nearby harvest, E otherwise gathers seamlessly', () => {
  const { state, ctx, step, spawn } = setup();
  state.resources.set('tree', { id: 'tree', kind: 'tree', position: { x: 1, y: 0, z: -1 }, hp: 60, maxHp: 60, depleted: false });
  let hits = 0; ctx.events.on('resource:hit', () => hits++);
  const enemy = spawn('golem', 'stone-golem');
  step({ interactHeld: true, aimGround: forward });
  assert.equal(hits, 0); close(enemy.hp, 186);
  step({ interactHeld: true, aimGround: { x: 0, y: 0, z: 10 } });
  assert.equal(hits, 1);
});

test('holding E at an active beacon never harvests or auto-attacks a nearby enemy', () => {
  const { state, ctx, step, spawn } = setup();
  state.beacon = { index: 1, landmarkId: 'ancient-grove', position: { x: 0, y: 0, z: 0 }, opensAt: 0, closesAt: 45, multiplier: 1.5, announced: true, channelSeconds: 0 };
  state.resources.set('tree', { id: 'tree', kind: 'tree', position: { x: 0, y: 0, z: -2 }, hp: 60, maxHp: 60, depleted: false });
  const enemy = spawn('golem', 'stone-golem');
  let hits = 0; ctx.events.on('resource:hit', () => hits++);
  step({ interactHeld: true, aimGround: forward });
  assert.equal(hits, 0); close(enemy.hp, 200);
  step({ interactHeld: true, meleeHeld: true, aimGround: forward }); close(enemy.hp, 186);
});

test('bow needs full draw, multishot spends one ammo and adds 30% damage projectiles', () => {
  const { state, step, advance } = setup();
  state.buffs.multishot = 3;
  step({ rangedHeld: true, aimGround: forward }); advance(0.3, { rangedHeld: true });
  step({ rangedReleased: true }); assert.equal(state.player.arrows, 10);
  step({ rangedHeld: true, aimGround: forward }); advance(0.7, { rangedHeld: true });
  step({ rangedReleased: true });
  assert.equal(state.player.arrows, 9); assert.equal(state.projectiles.size, 4);
  const damages = [...state.projectiles.values()].map(p => p.damage);
  close(damages[0] ?? 0, 24);
  for (const damage of damages.slice(1)) close(damage, 7.2);
});

test('projectile sweeps hit enemies and expired IDs/state objects are pooled for reuse', () => {
  const { state, step, advance, spawn } = setup();
  const enemy = spawn('golem', 'stone-golem', 0, -7);
  step({ rangedHeld: true, aimGround: forward }); advance(0.7, { rangedHeld: true }); step({ rangedReleased: true });
  const projectile = [...state.projectiles.values()][0]; assert.ok(projectile);
  advance(0.4); close(enemy.hp, 176); assert.equal(state.projectiles.size, 0);
  step({ magicPressed: true });
  const recycled = [...state.projectiles.values()][0]; assert.ok(recycled);
  assert.equal(recycled, projectile); assert.equal(recycled.id, projectile.id); assert.equal(recycled.kind, 'magic');
});

test('magic has a cooldown and costs 18 stamina; loadout/overdrive affect ranged damage once', () => {
  const { state, step } = setup();
  state.profile.skills.training = 3;
  state.profile.equippedRelic = 'ember-fang'; state.profile.relicRanks['ember-fang'] = 3;
  state.player.hp = 29;
  step({ magicPressed: true, aimGround: forward });
  close([...state.projectiles.values()][0]?.damage ?? 0, 97.5);
  close(state.player.stamina, 82);
  step({ magicPressed: true }); assert.equal(state.projectiles.size, 1); close(state.player.stamina, 82);
  close(rangedDamage(24, state, BALANCE), 78);
});

test('strict Overdrive threshold and immediate healing exit do not double melee multipliers', () => {
  assert.equal(isOverdriveEligible(30, 100, 0.3), false);
  assert.equal(isOverdriveEligible(29.999, 100, 0.3), true);
  assert.equal(isOverdriveEligible(0, 100, 0.3), false);
  const { state, ctx, step, spawn } = setup();
  state.player.hp = 29.9;
  const enemy = spawn('golem', 'stone-golem');
  const modes: boolean[] = []; ctx.events.on('player:overdrive', event => modes.push(event.active));
  step({ meleeHeld: true, aimGround: forward });
  close(enemy.hp, 165); close(state.player.hp, 30.6);
  assert.equal(state.player.overdrive, false); assert.deepEqual(modes, [true, false]);
  ctx.events.emit('player:heal-requested', { amount: 20, source: 'bandage' });
  close(state.player.hp, 50.6);
});

test('rolling lifesteal uses actual HP, 6%/hit, missing HP and a strict 8HP/sec cap', () => {
  const budget = new LifestealBudget();
  close(budget.claim(0, 1000, 1, 100, 0.06, 8), 8);
  close(budget.claim(0.99, 1000, 1, 100, 0.06, 8), 0);
  close(budget.claim(1, 100, 0.06, 100, 0.06, 8), 6);
  close(budget.claim(1.1, 100, 0.06, 1, 0.06, 8), 1);
  close(budget.claim(1.2, 100, 0.06, 100, 0.06, 8), 1);
  budget.reset(); close(budget.claim(2, 5, 0.06, 100, 0.06, 8), 0.3);
});

test('kills are emitted once; overkill lifesteal excludes corpses, nodes and secondary damage', () => {
  const { state, ctx, step, spawn } = setup();
  state.player.hp = 10; state.buffs.vampirism = 5; state.buffs['chain-lightning'] = 1;
  const target = spawn('goblin', 'goblin-stalker'); target.hp = 5;
  const other = spawn('other', 'stone-golem', 0, -5);
  let deaths = 0;
  ctx.events.on('enemy:died', () => deaths++);
  step({ meleeHeld: true, aimGround: forward });
  close(state.player.hp, 10.3); assert.equal(deaths, 1); close(other.hp, 197.9);
  ctx.events.emit('combat:area-requested', { kind: 'meteor', origin: { x: 0, y: 0, z: -5 }, radius: 10, damage: 1000, slowFraction: 0, durationSeconds: 0 });
  close(state.player.hp, 10.3); assert.equal(deaths, 2);
  ctx.events.emit('combat:area-requested', { kind: 'meteor', origin: { x: 0, y: 0, z: -5 }, radius: 10, damage: 1000, slowFraction: 0, durationSeconds: 0 });
  assert.equal(deaths, 2);
});

test('lightning target cooldown is one second, non-recursive and unaffected by overdrive', () => {
  const { state, step, advance, spawn } = setup();
  state.player.hp = 10; state.buffs['chain-lightning'] = 1;
  spawn('primary', 'stone-golem');
  const secondary = spawn('secondary', 'stone-golem', 0, -5);
  step({ meleeHeld: true, aimGround: forward }); close(secondary.hp, 197.9);
  advance(0.18, { meleeHeld: true, aimGround: forward }); close(secondary.hp, 197.9);
});

test('scaled spawn stats snapshot tier/cycle and enforce separate boss/hunter/wyvern caps', () => {
  const scaled = scaledEnemyStats(100, 20, 'enraged-elite', 99, BALANCE);
  close(scaled.hp, 236.8); close(scaled.damage, 33.8);
  const { state, ctx, spawn } = setup();
  state.cycleIndex = 2;
  const hunter = spawn('hunter1', 'relic-hunter', 20, 0, 'elite');
  close(hunter.maxHp, 160 * 1.35 * 1.16);
  spawn('hunter2', 'relic-hunter', 22, 0);
  ctx.events.emit('enemy:spawn-requested', { id: 'hunter3', archetype: 'relic-hunter', tier: 'normal', position: { x: 24, y: 0, z: 0 } });
  assert.equal(state.enemies.has('hunter3'), false);
  for (let i = 0; i < 16; i++) spawn(`ordinary${i}`, 'stone-golem', 30 + i, 20);
  spawn('boss', 'rootbound-sovereign', 30, 30);
  ctx.events.emit('enemy:spawn-requested', { id: 'overflow', archetype: 'goblin-stalker', tier: 'normal', position: { x: 30, y: 0, z: 30 } });
  assert.equal(state.enemies.has('overflow'), false); assert.equal(state.enemies.size, 19);
});

test('day/night detection uses balance radii and a detected night enemy never gives up chase', () => {
  const { state, step, spawn } = setup();
  const enemy = spawn('goblin', 'goblin-stalker', 20, 0);
  step(); assert.equal(enemy.mode, 'idle'); close(enemy.position.x, 20);
  state.dayPhase = 'night'; step(); assert.equal(enemy.mode, 'chase'); assert.ok(enemy.position.x < 20);
  state.player.position.x = -40;
  state.dayPhase = 'day'; step(); assert.equal(enemy.mode, 'chase');
  state.dayPhase = 'night';
  const nightSpawn = spawn('night-spawn', 'goblin-stalker', 30, 0);
  step(); assert.equal(nightSpawn.mode, 'chase');
});

test('golem attacks have a full tell; moving out of the marked slam avoids damage', () => {
  const { state, step, advance, spawn } = setup();
  const enemy = spawn('golem', 'stone-golem');
  advance(0.86); assert.equal(enemy.mode, 'windup'); close(state.player.hp, 100);
  advance(0.8); close(state.player.hp, 100);
  advance(0.1); close(state.player.hp, 80);
  const another = setup(); another.spawn('golem', 'stone-golem');
  another.advance(0.86); another.advance(0.9, { moveX: 1 }); close(another.state.player.hp, 100);
  step();
});

test('dash immunity prevents HP damage but hostile contact still interrupts bandages/channels', () => {
  const { state, ctx, step, advance, spawn } = setup();
  spawn('golem', 'stone-golem'); advance(0.86); advance(0.8);
  let absorbed = false; ctx.events.on('actor:damaged', event => { if (event.id === 'player' && event.amount === 0) absorbed = true; });
  step({ dashPressed: true, moveX: 1 }); advance(0.1);
  close(state.player.hp, 100); assert.equal(absorbed, true); assert.ok(state.player.lastHostileHitAt > 1.6);
});

test('combat does not consume or heal with systems-owned bandages', () => {
  const { state, ctx, step, advance } = setup();
  state.player.hp = 40; state.profile.skills['field-medic'] = 2;
  let requests = 0;
  ctx.events.on('player:heal-requested', request => { if (request.source === 'bandage') requests++; });
  step({ bandagePressed: true }); advance(3);
  close(state.player.hp, 40); assert.equal(state.player.bandages, 2); assert.equal(requests, 0);
  ctx.events.emit('player:heal-requested', { amount: 35, source: 'bandage' });
  close(state.player.hp, 75); assert.equal(state.player.bandages, 2);
});

test('hostile contact blocks passive healing while explicit bandage healing remains valid', () => {
  const { state, ctx, step, advance, spawn } = setup();
  state.player.hp = 40;
  spawn('golem', 'stone-golem'); step({ bandagePressed: true }); advance(2.1);
  assert.ok(state.player.hp < 40); assert.equal(state.player.bandages, 2);
  const before = state.player.hp;
  ctx.events.emit('player:heal-requested', { amount: 10, source: 'passive' }); close(state.player.hp, before);
  state.player.lastHostileHitAt = -100; state.passiveHealBlockedUntil = state.elapsedSeconds + 20;
  ctx.events.emit('player:heal-requested', { amount: 10, source: 'passive' }); close(state.player.hp, before);
  ctx.events.emit('player:heal-requested', { amount: 10, source: 'bandage' }); close(state.player.hp, before + 10);
});

test('boss phase thresholds grant exactly 1.5s invulnerability, never healing', () => {
  const { state, ctx, advance, spawn } = setup();
  const boss = spawn('boss', 'rootbound-sovereign', 0, -5);
  const meteor = (damage: number) => ctx.events.emit('combat:area-requested', { kind: 'meteor', origin: boss.position, radius: 1, damage, slowFraction: 0, durationSeconds: 0 });
  meteor(620); assert.equal(boss.phase, 2); assert.equal(boss.mode, 'recover'); close(boss.hp, 1180);
  meteor(100); close(boss.hp, 1180);
  advance(1.49); meteor(100); close(boss.hp, 1180);
  advance(0.02); meteor(600); assert.equal(boss.phase, 3); close(boss.hp, 580);
  const until = boss.modeUntil; close(until - state.elapsedSeconds, 1.5);
  advance(1.51); meteor(100); close(boss.hp, 480);
});

test('boss pattern tells never drop below one second in phase three', () => {
  const { state, ctx, step, advance, spawn } = setup();
  const boss = spawn('boss', 'rootbound-sovereign', 0, -7);
  ctx.events.emit('combat:area-requested', { kind: 'meteor', origin: boss.position, radius: 1, damage: 1250, slowFraction: 0, durationSeconds: 0 });
  advance(3);
  for (let i = 0; i < 120; i++) {
    step();
    if (boss.mode === 'windup') { assert.ok(boss.modeUntil - state.elapsedSeconds >= 1 - 1e-6); return; }
  }
  assert.fail('Boss did not enter a telegraphed attack');
});

test('frost affects movement, with exactly half slow on bosses, and causes no damage/healing', () => {
  const normal = setup(), slowed = setup();
  const a = normal.spawn('golem', 'stone-golem', 0, -13), b = slowed.spawn('golem', 'stone-golem', 0, -13);
  slowed.ctx.events.emit('combat:area-requested', { kind: 'frost', origin: b.position, radius: 3, damage: 9999, slowFraction: 0.3, durationSeconds: 2 });
  normal.advance(0.5); slowed.advance(0.5);
  close((13 + b.position.z) / (13 + a.position.z), 0.7); close(b.hp, 200);
  const bossNormal = setup(), bossSlow = setup();
  const c = bossNormal.spawn('boss', 'rootbound-sovereign', 0, -20), d = bossSlow.spawn('boss', 'rootbound-sovereign', 0, -20);
  bossSlow.ctx.events.emit('combat:area-requested', { kind: 'frost', origin: d.position, radius: 3, damage: 0, slowFraction: 0.3, durationSeconds: 2 });
  bossNormal.advance(0.5); bossSlow.advance(0.5);
  close((20 + d.position.z) / (20 + c.position.z), 0.85);
});

test('paused/dead/late-run event requests are ignored and reset/disposal do not duplicate listeners', () => {
  const { state, ctx, combat, step, spawn } = setup();
  const enemy = spawn('golem', 'stone-golem'); state.player.hp = 50; state.phase = 'paused';
  ctx.events.emit('player:heal-requested', { amount: 25, source: 'bandage' }); close(state.player.hp, 50);
  ctx.events.emit('combat:area-requested', { kind: 'meteor', origin: enemy.position, radius: 3, damage: 50, slowFraction: 0, durationSeconds: 0 }); close(enemy.hp, 200);
  ctx.events.emit('enemy:spawn-requested', { id: 'paused', archetype: 'goblin-stalker', tier: 'normal', position: { x: 0, y: 0, z: -3 } }); assert.equal(state.enemies.has('paused'), false);
  const position = { ...state.player.position }; step({ moveX: 1 }); assert.deepEqual(state.player.position, position);
  state.phase = 'playing'; state.runId = 'new-unreset-run';
  ctx.events.emit('player:heal-requested', { amount: 25, source: 'bandage' }); close(state.player.hp, 50);
  combat.resetRun(); state.player.hp = 0;
  ctx.events.emit('player:heal-requested', { amount: 25, source: 'bandage' }); close(state.player.hp, 0);
  state.player.hp = 50; combat.dispose(); combat.dispose();
  ctx.events.emit('player:heal-requested', { amount: 25, source: 'bandage' }); close(state.player.hp, 50);
});

test('synchronous secondary damage requests cannot recursively proc more secondary damage', () => {
  const { ctx, spawn } = setup();
  const enemy = spawn('golem', 'stone-golem');
  let requests = 0;
  ctx.events.on('actor:damaged', event => {
    if (event.id === 'player') return;
    requests++;
    ctx.events.emit('combat:area-requested', { kind: 'meteor', origin: enemy.position, radius: 3, damage: 20, slowFraction: 0, durationSeconds: 0 });
  });
  ctx.events.emit('combat:area-requested', { kind: 'meteor', origin: enemy.position, radius: 3, damage: 20, slowFraction: 0, durationSeconds: 0 });
  close(enemy.hp, 180); assert.equal(requests, 1);
});

test('seeded critical rolls are repeatable and selector caps baseline 5% plus 5pp per stack at 30%', () => {
  function run(seed: number) {
    const game = setup(new Rng(seed)); const enemy = game.spawn('golem', 'stone-golem');
    game.step({ meleeHeld: true, aimGround: forward }); return enemy.hp;
  }
  assert.equal(run(2026), run(2026));
  const { state } = setup(); close(getPlayerStats(state).critChance, 0.05);
  state.buffs['crit-amplifier'] = 5; close(getPlayerStats(state).critChance, 0.3);
});
