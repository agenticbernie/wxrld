import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from '../src/config/balance';
import { createProfile, createRunState, resetRunState } from '../src/core/state';
import { GameEvents } from '../src/core/events';
import { Rng } from '../src/core/rng';
import { EMPTY_INPUT, withoutEdges } from '../src/core/input';
import { CombatFacade } from '../src/combat/CombatFacade';
import { SystemsFacade } from '../src/systems/SystemsFacade';
import type { GameContext } from '../src/core/context';
import type { InputFrame, WorldLayout } from '../src/types/game';

function setup() {
  const state = createRunState(createProfile());
  resetRunState(state, 55, 'integration-55');
  const world: WorldLayout = {
    seed: 55, size: 80, playerSpawn: { x: 0, y: 0, z: 0 },
    landmarks: [{ id: 'ancient-grove', position: { x: 15, y: 0, z: 0 } }, { id: 'sunken-shrine', position: { x: -15, y: 0, z: 0 } }, { id: 'ashen-spire', position: { x: 0, y: 0, z: 20 } }],
    nodes: [{ id: 'tree-1', kind: 'tree', position: { x: 0, y: 0, z: -2 } }],
    heightAt: () => 0, isWalkable: (x, z) => Math.hypot(x, z) < 38,
  };
  state.world = world;
  const ctx: GameContext = { state, balance: BALANCE, events: new GameEvents(), rng: new Rng(55) };
  const combat = new CombatFacade(ctx); const systems = new SystemsFacade(ctx);
  combat.resetRun(); systems.resetRun(); state.phase = 'playing';
  const step = (seconds: number, supplied: InputFrame = EMPTY_INPUT, fight = true): void => {
    let remaining = seconds; let input = supplied;
    while (remaining > 1e-9 && !state.result) {
      const dt = Math.min(1 / 60, remaining); systems.update(dt, input); if (fight) combat.update(dt, input); systems.afterCombat(dt, input); remaining -= dt; input = withoutEdges(input);
    }
  };
  return { state, ctx, combat, systems, step };
}

test('systems and combat cooperate on harvesting and inventory exactly once', () => {
  const { state, step } = setup();
  step(0.72, { ...EMPTY_INPUT, interactHeld: true });
  assert.equal(state.resources.get('tree-1')?.depleted, true);
  Object.assign(state.player.position, { x: 0, y: 0, z: -2 }); step(0.1);
  assert.equal(state.materials.wood, 6);
  step(1, { ...EMPTY_INPUT, interactHeld: true });
  assert.equal(state.materials.wood, 6);
});
test('one completed bandage consumes one item and applies one medic-scaled heal', () => {
  const { state, step } = setup();
  state.player.hp = 40; state.player.lastHostileHitAt = 0; state.profile.skills['field-medic'] = 2;
  step(1 / 60, { ...EMPTY_INPUT, bandagePressed: true });
  step(1.8); assert.equal(state.player.bandages, 2); assert.equal(state.player.hp, 40);
  step(0.3); assert.equal(state.player.bandages, 1); assert.equal(state.player.hp, 75);
  step(0.5); assert.equal(state.player.bandages, 1); assert.equal(state.player.hp, 75);
});
test('movement cancels a bandage without consuming the item', () => {
  const { state, step } = setup(); state.player.hp = 40; state.player.lastHostileHitAt = 0;
  step(1 / 60, { ...EMPTY_INPUT, bandagePressed: true });
  step(0.1, { ...EMPTY_INPUT, moveX: 1 }); step(2.2);
  assert.equal(state.player.bandages, 2); assert.equal(state.player.hp, 40);
});
test('complete extraction banks one multiplier, unmultiplied cores, and never settles twice', () => {
  const { state, ctx, systems, step } = setup();
  step(150, EMPTY_INPUT, false);
  assert.ok(state.beacon);
  Object.assign(state.player.position, state.beacon.position); state.player.velocity = { x: 0, y: 0, z: 0 };
  state.materials.soulShards = 7; state.materials.relicCores = 2; state.runBlueprints.push('ember-fang');
  let settlements = 0; ctx.events.on('run:ended', () => settlements++);
  step(10.1, { ...EMPTY_INPUT, interactHeld: true }, false);
  assert.equal(state.result?.outcome, 'extracted'); assert.equal(state.result?.bankedSouls, 10); assert.equal(state.result?.bankedCores, 2);
  assert.deepEqual(state.profile.blueprints, ['ember-fang']);
  const banked = state.profile.soulShards;
  systems.afterCombat(1, { ...EMPTY_INPUT, interactHeld: true }); systems.abandonRun();
  assert.equal(state.profile.soulShards, banked); assert.equal(settlements, 1);
});
