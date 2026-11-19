import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE, BUFF_IDS, RELIC_IDS } from '../config/balance';
import type { GameContext } from '../core/context';
import { GameEvents } from '../core/events';
import { Rng } from '../core/rng';
import { createProfile, createRunState, resetRunState } from '../core/state';
import type { ActorArchetype, EnemyState, GameEventMap, InputFrame, ResourceKind, WorldLayout } from '../types/game';
import { SystemsFacade } from './SystemsFacade';
import { DISCOVERY_IDS, emptyMaterials, findSpawnPosition, normalSpawnArchetype, Reachability, relicVisualSeed, validWindowSeconds } from './rules';
import { settleRun } from './settlement';

const IDLE: InputFrame = {
  moveX: 0, moveZ: 0, aimGround: null, sprintHeld: false, dashPressed: false,
  meleeHeld: false, rangedHeld: false, rangedReleased: false, magicPressed: false,
  interactHeld: false, interactPressed: false, bandagePressed: false, pausePressed: false,
};
const HOLD: InputFrame = { ...IDLE, interactHeld: true };
function fixture(kinds: readonly ResourceKind[] = []) {
  const profile = createProfile();
  const state = createRunState(profile);
  resetRunState(state, 42, 'test-run');
  const world: WorldLayout = {
    seed: 42, size: 180, playerSpawn: { x: 0, y: 0, z: 0 },
    landmarks: [
      { id: 'ancient-grove', position: { x: 0, y: 0, z: 0 } },
      { id: 'sunken-shrine', position: { x: 35, y: 0, z: 0 } },
      { id: 'ashen-spire', position: { x: 0, y: 0, z: -35 } },
    ],
    nodes: kinds.map((kind, index) => ({ id: `node-${index}`, kind, position: { x: 1, y: 0, z: 0 } })),
    heightAt: () => 0,
    isWalkable: (x, z) => Math.abs(x) <= 90 && Math.abs(z) <= 90,
  };
  state.world = world;
  state.player.position = { ...world.playerSpawn };
  const ctx: GameContext = { state, events: new GameEvents(), balance: BALANCE, rng: new Rng(42) };
  const systems = new SystemsFacade(ctx);
  systems.resetRun();
  state.phase = 'playing';
  function step(dt: number, input = IDLE, combat?: () => void) {
    systems.update(dt, input);
    combat?.();
    systems.afterCombat(dt, input);
  }
  function harvest(index: number, count: number) {
    for (let hit = 0; hit < count; hit++) step(0.35, IDLE, () => {
      ctx.events.emit('resource:hit', { id: `node-${index}`, amount: BALANCE.combat.toolDamage[state.player.toolTier], toolTier: state.player.toolTier, position: { x: 1, y: 0, z: 0 } });
    });
  }
  function beacon(now = 185, channel = 0) {
    state.elapsedSeconds = now;
    state.beacon = { index: 1, landmarkId: 'ancient-grove', position: { x: 0, y: 0, z: 0 }, opensAt: 150, closesAt: 195, multiplier: 1.5, announced: true, channelSeconds: channel };
  }
  return { ctx, state, profile, systems, step, harvest, beacon };
}
function enemy(id: string, archetype: ActorArchetype = 'goblin-stalker'): EnemyState {
  return { id, archetype, tier: 'normal', position: { x: 2, y: 0, z: 0 }, facing: { x: 0, y: 0, z: 1 }, hp: 100, maxHp: 100, mode: 'chase', modeUntil: 0, phase: 1 };
}

test('reset populates configured nodes and owns no phase, HP or player position', () => {
  const f = fixture(['tree', 'stone', 'gold', 'cursed']);
  f.profile.skills.supply = 3; f.profile.skills.artisan = 3; f.profile.skills['field-medic'] = 3;
  f.state.phase = 'paused'; f.state.pauseReason = 'menu'; f.state.player.hp = 7;
  f.state.player.position = { x: 16, y: 4, z: 19 };
  f.systems.resetRun();
  assert.deepEqual([...f.state.resources.values()].map(node => node.hp), [60, 80, 80, 150]);
  assert.equal(f.state.player.hp, 7); assert.equal(f.state.phase, 'paused'); assert.equal(f.state.pauseReason, 'menu');
  assert.deepEqual(f.state.player.position, { x: 16, y: 4, z: 19 });
  assert.equal(f.state.player.arrows, 25); assert.equal(f.state.player.bandages, 4); assert.equal(f.state.materials.wood, 6);
  f.state.world = null; f.systems.resetRun(); assert.equal(f.state.resources.size, 0);
  f.state.phase = 'playing'; f.state.pauseReason = null; f.step(150);
  assert.equal(f.state.beacon, null);
});

test('resource requests reject wrong tier, forged damage, distance, cadence and NaN without mutation', () => {
  const f = fixture(['tree', 'cursed']);
  const request: GameEventMap['resource:hit'] = { id: 'node-0', amount: 20, toolTier: 'wood', position: { x: 1, y: 0, z: 0 } };
  for (const invalid of [{ ...request, amount: 40 }, { ...request, amount: NaN }, { ...request, toolTier: 'cursed' as const }]) f.ctx.events.emit('resource:hit', invalid);
  f.ctx.events.emit('resource:hit', { ...request, id: 'node-1' });
  assert.equal(f.state.resources.get('node-0')?.hp, 60); assert.equal(f.state.resources.get('node-1')?.hp, 150);
  f.state.player.position.x = 10; f.ctx.events.emit('resource:hit', request); assert.equal(f.state.resources.get('node-0')?.hp, 60);
  f.state.player.position.x = 0; f.ctx.events.emit('resource:hit', request); f.ctx.events.emit('resource:hit', request);
  assert.equal(f.state.resources.get('node-0')?.hp, 40);
  f.harvest(0, 2); assert.equal(f.state.materials.wood, 6);
  f.harvest(0, 5); assert.equal(f.state.materials.wood, 6);
});

test('ordinary scavenger nodes and every third cursed core have once-only physical drops', () => {
  const f = fixture(['tree', 'tree', 'stone', 'gold', 'cursed', 'cursed', 'cursed']);
  f.profile.skills.scavenger = 1;
  f.harvest(0, 3); f.harvest(1, 3); f.harvest(2, 4); f.harvest(3, 4);
  assert.deepEqual(f.state.materials, { wood: 14, stone: 5, gold: 2, soulShards: 0, relicCores: 0 });
  f.state.player.toolTier = 'stone';
  f.harvest(4, 5); const firstExpiry = f.state.passiveHealBlockedUntil;
  f.harvest(5, 5); f.harvest(6, 5);
  assert.equal(f.state.cursedNodesMined, 3); assert.equal(f.state.materials.soulShards, 24); assert.equal(f.state.materials.relicCores, 1);
  assert.equal(f.state.threat, 54); assert.equal(f.state.passiveHealBlockedUntil, f.state.elapsedSeconds + 20);
  assert.ok(f.state.passiveHealBlockedUntil < firstExpiry + 20);
});

test('soul magnet uses spatial pickups, not harvest reach; collection events cannot pay twice', () => {
  const f = fixture(['tree']);
  f.state.buffs['soul-magnet'] = 5;
  f.state.player.position.x = 8; f.harvest(0, 3); assert.equal(f.state.resources.get('node-0')?.hp, 60);
  f.state.loot.set('drop', { id: 'drop', position: { x: 0, y: 0, z: 0 }, materials: { ...emptyMaterials(), soulShards: 7 }, blueprint: null });
  let collections = 0;
  f.ctx.events.on('loot:collected', () => collections++);
  f.step(0.1); f.step(0.1);
  f.ctx.events.emit('loot:collected', { id: 'drop', materials: { ...emptyMaterials(), soulShards: 7 }, blueprint: null });
  assert.equal(f.state.materials.soulShards, 7); assert.equal(collections, 2); assert.equal(f.state.loot.size, 0);
});

test('recipes are atomic, repeat-resistant upgrades and single-unit bounded consumables', () => {
  const f = fixture();
  f.state.phase = 'paused'; f.state.pauseReason = 'menu';
  Object.assign(f.state.materials, { wood: 100, stone: 100, gold: 100, relicCores: 10 });
  assert.equal(f.systems.handleAction({ type: 'craft', recipeId: 'stone-tool' }), true);
  const before = { ...f.state.materials };
  assert.equal(f.systems.handleAction({ type: 'craft', recipeId: 'stone-tool' }), false); assert.deepEqual(f.state.materials, before);
  assert.equal(f.systems.handleAction({ type: 'craft', recipeId: 'cursed-tool' }), true);
  assert.equal(f.systems.handleAction({ type: 'craft', recipeId: 'stone-tool' }), false);
  const arrows = f.state.player.arrows;
  assert.equal(f.systems.handleAction({ type: 'craft', recipeId: 'arrows' }), true); assert.equal(f.state.player.arrows, arrows + 10);
  assert.equal(f.systems.handleAction({ type: 'craft', recipeId: 'bandage' }), true);
  assert.equal(f.systems.handleAction({ type: 'craft', recipeId: 'bandage' }), true);
  assert.equal(f.systems.handleAction({ type: 'craft', recipeId: 'bandage' }), false); assert.equal(f.state.player.bandages, 4);
  f.state.pauseReason = 'draft'; assert.equal(f.systems.handleAction({ type: 'craft', recipeId: 'arrows' }), false);
  f.state.pauseReason = 'blur'; assert.equal(f.systems.handleAction({ type: 'craft', recipeId: 'arrows' }), false);
});

test('boss altar costs three cores once, requests its own slot and cannot be used remotely', () => {
  const f = fixture(); f.state.materials.relicCores = 10;
  const spawned: GameEventMap['enemy:spawn-requested'][] = [];
  f.ctx.events.on('enemy:spawn-requested', request => spawned.push(request));
  assert.equal(f.systems.handleAction({ type: 'craft', recipeId: 'summon-boss' }), false); assert.equal(f.state.materials.relicCores, 10);
  f.state.player.position = { x: 0, y: 0, z: -35 };
  assert.equal(f.systems.handleAction({ type: 'craft', recipeId: 'summon-boss' }), true);
  assert.equal(f.state.materials.relicCores, 7); assert.equal(f.state.threat, 30); assert.equal(spawned[0]?.archetype, 'rootbound-sovereign');
  assert.equal(f.systems.handleAction({ type: 'craft', recipeId: 'summon-boss' }), false);
});

test('gold drafts are seeded, distinct and not charged for capped/remote/duplicate actions', () => {
  const f = fixture(); f.state.materials.gold = 50;
  for (const id of BUFF_IDS) f.state.buffs[id] = 5;
  assert.equal(f.systems.handleAction({ type: 'buy-draft', chestId: 'ancient-grove' }), false); assert.equal(f.state.materials.gold, 50);
  f.state.buffs.cleave = 0;
  assert.equal(f.systems.handleAction({ type: 'buy-draft', chestId: 'sunken-shrine' }), false);
  assert.equal(f.systems.handleAction({ type: 'buy-draft', chestId: 'ancient-grove' }), true);
  const draft = f.state.activeDraft; assert.ok(draft); assert.deepEqual(draft.choices, ['cleave']); assert.equal(f.state.materials.gold, 45);
  assert.equal(f.systems.handleAction({ type: 'buy-draft', chestId: 'ancient-grove' }), false);
  assert.equal(f.systems.handleAction({ type: 'choose-buff', draftId: 'wrong', buffId: 'cleave' }), false);
  assert.equal(f.systems.handleAction({ type: 'choose-buff', draftId: draft.id, buffId: 'cleave' }), true);
  assert.equal(f.systems.handleAction({ type: 'choose-buff', draftId: draft.id, buffId: 'cleave' }), false);
  assert.equal(f.systems.handleAction({ type: 'buy-draft', chestId: 'ancient-grove' }), true); assert.equal(f.state.activeDraft?.paidGold, 8);
  const a = fixture(), b = fixture(); a.state.materials.gold = b.state.materials.gold = 5;
  a.systems.handleAction({ type: 'buy-draft', chestId: 'ancient-grove' }); b.systems.handleAction({ type: 'buy-draft', chestId: 'ancient-grove' });
  assert.deepEqual(a.state.activeDraft, b.state.activeDraft); assert.equal(new Set(a.state.activeDraft?.choices).size, 3);
});

test('enemy death rewards survive body removal, deduplicate, and rotate unowned blueprints', () => {
  const f = fixture(); f.profile.blueprints.push('ember-fang');
  const death = { id: 'hunter', archetype: 'relic-hunter' as const, position: { x: 1, y: 0, z: 0 } };
  f.ctx.events.emit('enemy:died', death); f.ctx.events.emit('enemy:died', death);
  f.ctx.events.emit('enemy:died', { ...death, id: 'hunter-2' });
  f.ctx.events.emit('enemy:died', { ...death, id: 'boss', archetype: 'rootbound-sovereign' });
  f.step(0.1);
  assert.equal(f.state.kills, 3); assert.equal(f.state.materials.soulShards, 52);
  assert.deepEqual(f.state.runBlueprints, ['rootheart', 'moon-sigil']);
  const allOwned = fixture(); allOwned.profile.blueprints.push(...RELIC_IDS);
  allOwned.ctx.events.emit('enemy:died', { ...death, id: 'boss', archetype: 'rootbound-sovereign' }); allOwned.step(0.1);
  assert.equal(allOwned.state.materials.relicCores, 1);
});

test('milestone drafts queue rather than opening during damage and lethal HP wins', () => {
  const f = fixture(); f.state.kills = 11; f.profile.soulShards = 90;
  let opened = 0; f.ctx.events.on('buff:draft-opened', () => opened++);
  f.ctx.events.emit('enemy:died', { id: 'kill-12', archetype: 'goblin-stalker', position: { x: 0, y: 0, z: 0 } });
  assert.equal(f.state.pendingDrafts.length, 1); assert.equal(opened, 0);
  f.beacon(194, 9); f.state.materials.soulShards = 100;
  f.step(1, HOLD, () => { f.state.player.hp = 0; });
  assert.equal(f.state.result?.outcome, 'dead'); assert.equal(opened, 0); assert.equal(f.state.activeDraft, null);
  assert.equal(f.state.result?.bankedSouls, 0); assert.equal(f.profile.soulShards, 92);
});

test('day/night clock and all paused timers are exact', () => {
  const f = fixture(); f.step(89); assert.equal(f.state.dayPhase, 'day');
  f.step(1); assert.equal(f.state.dayPhase, 'night'); assert.equal(f.state.cycleIndex, 0);
  f.step(60); assert.equal(f.state.dayPhase, 'day'); assert.equal(f.state.cycleIndex, 1);
  const elapsed = f.state.elapsedSeconds; f.state.phase = 'paused'; f.state.pauseReason = 'blur'; f.step(1000);
  assert.equal(f.state.elapsedSeconds, elapsed);
});

test('normal spawning preserves day/night cadence and population caps', () => {
  const f = fixture(); let spawned = 0;
  f.ctx.events.on('enemy:spawn-requested', request => {
    spawned++;
    f.state.enemies.set(request.id, { ...enemy(request.id, request.archetype), position: request.position, tier: request.tier });
  });
  f.step(90); assert.equal(spawned, 7);
  f.step(1); assert.equal(spawned, 8);
  f.step(300); assert.ok(f.state.enemies.size <= 18);
  assert.ok([...f.state.enemies.values()].filter(value => value.archetype === 'blood-wyvern').length <= 2);
});

test('spawn points use reachability, the rear sector and active-pad exclusion; weights are deterministic', () => {
  const f = fixture(); const reachable = new Reachability(f.state.world!);
  f.beacon(170); f.state.beacon!.position = { x: -23, y: 0, z: 0 };
  for (let index = 0; index < 100; index++) {
    const point = findSpawnPosition(f.ctx, reachable); assert.ok(point);
    const radius = Math.hypot(point.x, point.z); assert.ok(radius >= 18 && radius <= 30);
    assert.ok(-point.z / radius <= 0.5 + 1e-9);
    assert.ok(Math.hypot(point.x + 23, point.z) > 10);
  }
  const rng = new Rng(27), counts = { 'goblin-stalker': 0, 'stone-golem': 0, 'blood-wyvern': 0, 'relic-hunter': 0 };
  for (let index = 0; index < 10000; index++) counts[normalSpawnArchetype(rng)]++;
  assert.ok(Math.abs(counts['goblin-stalker'] - 6000) < 200);
  assert.ok(Math.abs(counts['stone-golem'] - 2500) < 150);
  assert.ok(Math.abs(counts['blood-wyvern'] - 1500) < 150);
  for (let index = 0; index < 100; index++) assert.notEqual(normalSpawnArchetype(rng, false), 'blood-wyvern');
});

test('threat decay honors the valid post-delay portion and hunter cooldown never resets on oscillation', () => {
  const f = fixture(); f.state.threat = 80; f.state.threatDecayAt = 25;
  const hunters: GameEventMap['enemy:spawn-requested'][] = [];
  f.ctx.events.on('enemy:spawn-requested', request => { if (request.archetype === 'relic-hunter') hunters.push(request); });
  f.step(1); assert.equal(hunters.length, 1); assert.equal(hunters[0]?.tier, 'enraged-elite'); assert.equal(f.state.nextHunterAt, 26);
  f.state.threat = 39; f.step(1); f.state.threat = 50; f.step(1); assert.equal(hunters.length, 1);
  f.state.elapsedSeconds = 24; f.state.threat = 80; f.step(2); assert.equal(f.state.threat, 79); assert.equal(hunters.length, 2);
  f.state.enemies.set('h1', enemy('h1', 'relic-hunter')); f.state.enemies.set('h2', enemy('h2', 'relic-hunter'));
  f.state.threatDecayAt = 1000; f.step(25); assert.equal(hunters.length, 2);
});

test('frost pulses and warned meteor emit combat requests without mutating enemy HP', () => {
  const f = fixture(); f.state.buffs['frost-nova'] = 5; f.state.buffs['meteor-strike'] = 2;
  const target = enemy('target'); f.state.enemies.set(target.id, target);
  const areas: GameEventMap['combat:area-requested'][] = [], effects: GameEventMap['fx:requested'][] = [];
  f.ctx.events.on('combat:area-requested', request => areas.push(request)); f.ctx.events.on('fx:requested', request => effects.push(request));
  f.step(6); assert.equal(areas[0]?.slowFraction, 0.3); assert.equal(areas[0]?.durationSeconds, 2);
  f.step(6); assert.equal(effects.filter(value => value.kind === 'meteor').length, 1); assert.equal(areas.filter(value => value.kind === 'meteor').length, 0);
  target.position.x = 8;
  f.step(0.69); assert.equal(areas.filter(value => value.kind === 'meteor').length, 0);
  f.step(0.01); const meteor = areas.find(value => value.kind === 'meteor'); assert.equal(meteor?.damage, 80); assert.equal(meteor?.origin.x, 2);
  assert.equal(target.hp, 100);
});

test('bandage heals through requests only, consumes once on completion, and hostile zero-damage hits cancel', () => {
  const f = fixture(); f.state.player.hp = 30; f.state.passiveHealBlockedUntil = 1000;
  const heals: GameEventMap['player:heal-requested'][] = []; f.ctx.events.on('player:heal-requested', request => heals.push(request));
  f.step(1, { ...IDLE, bandagePressed: true }); assert.equal(f.state.player.bandages, 2);
  f.step(1); assert.equal(f.state.player.bandages, 1); assert.deepEqual(heals, [{ amount: 25, source: 'bandage' }]); assert.equal(f.state.player.hp, 30);
  f.step(1, { ...IDLE, bandagePressed: true });
  f.step(1, IDLE, () => f.ctx.events.emit('actor:damaged', { id: 'player', sourceId: 'enemy', amount: 0, hpRemaining: 30, position: { x: 0, y: 0, z: 0 }, critical: false }));
  assert.equal(f.state.player.bandages, 1); assert.equal(heals.length, 1);
});

test('beacon announces early with Surveyor, excludes the boss arena and avoids repeat landmarks', () => {
  const f = fixture(); f.profile.skills.surveyor = 3; f.state.bossSummoned = true;
  const getBeacon = () => f.state.beacon;
  f.step(128); assert.equal(getBeacon(), null); f.step(1);
  const first = getBeacon(); assert.ok(first); assert.notEqual(first.landmarkId, 'ashen-spire');
  const previous = first.landmarkId; f.step(66); assert.equal(getBeacon(), null);
  f.step(84); const second = getBeacon(); assert.ok(second); assert.notEqual(second.landmarkId, previous); assert.equal(second.multiplier, 2.5);
});

test('channel never starts before opening and completion at exact close banks once', () => {
  const f = fixture(); f.beacon(140); f.state.materials.soulShards = 7; f.state.materials.relicCores = 2;
  f.step(9, HOLD); assert.equal(f.state.beacon?.channelSeconds, 0);
  f.state.elapsedSeconds = 185;
  let ended = 0; f.ctx.events.on('run:ended', ({ result }) => { ended++; assert.equal(f.profile.soulShards, result.bankedSouls + result.discoverySouls); });
  f.step(10, HOLD);
  assert.equal(f.state.result?.outcome, 'extracted'); assert.equal(f.state.result?.bankedSouls, 10); assert.equal(f.profile.relicCores, 2);
  assert.equal(f.state.phase, 'playing'); assert.equal(f.state.materials.soulShards, 0);
  f.systems.abandonRun(); f.step(20, HOLD); assert.equal(ended, 1); assert.deepEqual(f.profile.settledRunIds, ['test-run']);
});

test('boundary-crossing steps credit only the valid window portion, allow close ties and block late completion', () => {
  const exact = fixture(); exact.beacon(194.5, 9.5); exact.step(1, HOLD); assert.equal(exact.state.result?.outcome, 'extracted');
  const late = fixture(); late.beacon(194.5, 9.4); late.step(1, HOLD); assert.equal(late.state.result, null); assert.equal(late.state.beacon, null);
  assert.equal(validWindowSeconds(149, 151, { opensAt: 150, closesAt: 195 }), 1);
  assert.equal(validWindowSeconds(196, 198, { opensAt: 150, closesAt: 195 }), 0);
});

test('movement, attacks, release, dash, radius, modal and absorbed hostile hits all reset extraction', () => {
  for (const input of [{ ...HOLD, moveX: 1 }, { ...HOLD, meleeHeld: true }, { ...HOLD, rangedHeld: true }, { ...HOLD, magicPressed: true }, { ...HOLD, dashPressed: true }, IDLE]) {
    const f = fixture(); f.beacon(170, 5); f.step(0.1, input); assert.equal(f.state.beacon?.channelSeconds, 0); assert.match(f.state.notification ?? '', /interrupted/);
  }
  const radius = fixture(); radius.beacon(170, 5); radius.state.player.position.x = 11; radius.step(0.1, HOLD); assert.equal(radius.state.beacon?.channelSeconds, 0);
  const modal = fixture(); modal.beacon(170, 5); assert.equal(modal.systems.handleAction({ type: 'pause' }), false); assert.equal(modal.state.beacon?.channelSeconds, 0);
  const hit = fixture(); hit.beacon(170, 9);
  hit.step(1, HOLD, () => hit.ctx.events.emit('actor:damaged', { id: 'player', sourceId: 'hostile', amount: 0, hpRemaining: 100, position: { x: 0, y: 0, z: 0 }, critical: false }));
  assert.equal(hit.state.result, null); assert.equal(hit.state.beacon?.channelSeconds, 0); assert.match(hit.state.notification ?? '', /Hostile hit/);
});

test('settlement multiplies only Souls, clears run rewards, keeps all settled IDs and bounds lifetime discoveries', () => {
  const f = fixture(); f.profile.soulShards = 50; f.profile.relicCores = 3;
  f.profile.settledRunIds.push(...Array.from({ length: 300 }, (_, index) => `old-${index}`));
  f.state.materials.soulShards = 7; f.state.materials.relicCores = 4; f.state.runBlueprints.push('ember-fang', 'ember-fang');
  f.state.runDiscoveries.push(...DISCOVERY_IDS, ...DISCOVERY_IDS, 'fake');
  const result = settleRun(f.state, 'extracted', 5); assert.ok(result);
  assert.equal(result.bankedSouls, 35); assert.equal(result.bankedCores, 4); assert.equal(result.discoverySouls, 16);
  assert.equal(f.profile.soulShards, 101); assert.equal(f.profile.relicCores, 7); assert.deepEqual(f.profile.blueprints, ['ember-fang']);
  assert.equal(f.profile.settledRunIds.length, 301); assert.equal(settleRun(f.state, 'extracted', 5), null);
  resetRunState(f.state, 2, 'next'); f.state.runDiscoveries.push(...DISCOVERY_IDS); assert.equal(settleRun(f.state, 'dead', 0)?.discoverySouls, 0);
  resetRunState(f.state, 3, 'old-0'); f.state.materials.soulShards = 100; assert.equal(settleRun(f.state, 'extracted', 5), null); assert.equal(f.profile.soulShards, 101);
});

test('abandon pays neither run loot nor discoveries and disposal removes handlers', () => {
  const f = fixture(['tree']); f.profile.soulShards = 90; f.state.materials.soulShards = 100; f.state.runDiscoveries.push(DISCOVERY_IDS[0]!);
  f.systems.abandonRun(); assert.equal(f.profile.soulShards, 90); assert.equal(f.state.result?.outcome, 'abandoned'); assert.equal(f.state.runDiscoveries.length, 0);
  f.systems.resetRun(); f.state.phase = 'playing'; f.systems.dispose(); f.systems.dispose();
  f.ctx.events.emit('enemy:died', { id: 'late', archetype: 'goblin-stalker', position: { x: 0, y: 0, z: 0 } }); assert.equal(f.state.kills, 0);
  assert.equal(f.systems.handleAction({ type: 'craft', recipeId: 'arrows' }), false);
});

test('hub skill and relic costs/ranks are exact; ordinary forging is deterministic and generation is main-owned', () => {
  const f = fixture(); f.state.phase = 'hub'; f.profile.soulShards = 1000; f.profile.relicCores = 20;
  for (let rank = 0; rank < 3; rank++) assert.equal(f.systems.handleAction({ type: 'upgrade-skill', nodeId: 'vitality' }), true);
  assert.equal(f.profile.soulShards, 830); assert.equal(f.profile.skills.vitality, 3); assert.equal(f.systems.handleAction({ type: 'upgrade-skill', nodeId: 'vitality' }), false);
  assert.equal(f.systems.handleAction({ type: 'upgrade-relic', recipeId: 'rootheart' }), false);
  f.profile.blueprints.push('rootheart');
  for (let rank = 0; rank < 3; rank++) assert.equal(f.systems.handleAction({ type: 'upgrade-relic', recipeId: 'rootheart' }), true);
  assert.equal(f.profile.soulShards, 625); assert.equal(f.profile.relicCores, 14); assert.equal(f.profile.relicRanks.rootheart, 3);
  assert.deepEqual(f.profile.relicVisuals.rootheart, { kind: 'procedural', recipeId: 'rootheart', seed: relicVisualSeed('rootheart', 3) });
  assert.equal(f.systems.handleAction({ type: 'equip-relic', recipeId: 'rootheart' }), true); assert.equal(f.profile.equippedRelic, 'rootheart');
  assert.equal(f.systems.handleAction({ type: 'generate-relic', recipeId: 'rootheart', customization: null }), false);
  f.state.phase = 'playing'; assert.equal(f.systems.handleAction({ type: 'upgrade-skill', nodeId: 'training' }), false);
});

test('all twelve buffs accept exactly five stacks and no sixth selection', () => {
  const f = fixture(); f.state.phase = 'paused'; f.state.pauseReason = 'draft';
  for (const id of BUFF_IDS) {
    for (let rank = 0; rank < 5; rank++) {
      const draftId = `${id}-${rank}`;
      f.state.activeDraft = { id: draftId, choices: [id], paidGold: 0 };
      assert.equal(f.systems.handleAction({ type: 'choose-buff', draftId, buffId: id }), true);
    }
    f.state.activeDraft = { id: `${id}-sixth`, choices: [id], paidGold: 0 };
    assert.equal(f.systems.handleAction({ type: 'choose-buff', draftId: `${id}-sixth`, buffId: id }), false);
    assert.equal(f.state.buffs[id], 5);
  }
});

test('queued free drafts retain choices, prune newly capped buffs and never resume the clock', () => {
  const f = fixture(); f.beacon(170, 3); f.state.buffs.cleave = 4;
  f.state.pendingDrafts.push(
    { id: 'first', choices: ['cleave'], paidGold: 0 },
    { id: 'capped', choices: ['cleave'], paidGold: 0 },
    { id: 'next', choices: ['cleave', 'vampirism'], paidGold: 0 },
  );
  f.step(0.1, HOLD); assert.equal(f.state.activeDraft?.id, 'first'); assert.equal(f.state.beacon?.channelSeconds, 0);
  f.state.phase = 'paused'; f.state.pauseReason = 'draft';
  const elapsed = f.state.elapsedSeconds;
  assert.equal(f.systems.handleAction({ type: 'choose-buff', draftId: 'first', buffId: 'cleave' }), true);
  assert.deepEqual(f.state.activeDraft?.choices, ['vampirism']); assert.equal(f.state.activeDraft?.id, 'next');
  assert.equal(f.state.elapsedSeconds, elapsed); assert.equal(f.state.pendingDrafts.length, 0);
});

test('passive healing requests only valid post-delay and post-suppression portions; death never revives', () => {
  const f = fixture(); f.state.player.hp = 20; f.state.player.lastHostileHitAt = 0;
  f.profile.skills.recovery = 3; f.state.elapsedSeconds = 6;
  const heals: GameEventMap['player:heal-requested'][] = [];
  f.ctx.events.on('player:heal-requested', request => heals.push(request));
  f.step(1); assert.deepEqual(heals, [{ amount: 0.5, source: 'passive' }]);
  f.state.passiveHealBlockedUntil = 10; f.step(2); assert.equal(heals.length, 1);
  f.step(2); assert.deepEqual(heals[1], { amount: 1, source: 'passive' });
  f.state.player.hp = 0; f.step(2); assert.equal(heals.length, 2); assert.equal(f.state.result?.outcome, 'dead');
});

test('repeated afterCombat calls without a new clock step cannot accelerate extraction', () => {
  const f = fixture(); f.beacon(170); f.step(1, HOLD);
  assert.equal(f.state.beacon?.channelSeconds, 1);
  for (let repeat = 0; repeat < 20; repeat++) f.systems.afterCombat(1, HOLD);
  assert.equal(f.state.beacon?.channelSeconds, 1); assert.equal(f.state.result, null);
});
