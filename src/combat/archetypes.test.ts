import assert from 'node:assert/strict';
import test from 'node:test';
import { BALANCE } from '../config/balance';
import type { GameContext } from '../core/context';
import { GameEvents } from '../core/events';
import { Rng } from '../core/rng';
import { createProfile, createRunState, resetRunState } from '../core/state';
import type { ActorArchetype, InputFrame } from '../types/game';
import { CombatFacade } from './CombatFacade';

const IDLE: InputFrame = { moveX: 0, moveZ: 0, aimGround: null, sprintHeld: false, dashPressed: false, meleeHeld: false, rangedHeld: false, rangedReleased: false, magicPressed: false, interactHeld: false, interactPressed: false, bandagePressed: false, pausePressed: false };
class NoCritRng extends Rng { override next(): number { return 0.99; } }
function simulation(archetype: ActorArchetype, z: number) {
  const state = createRunState(createProfile()); resetRunState(state, 9, 'ai-test');
  state.world = { seed: 9, size: 180, playerSpawn: { x: 0, y: 0, z: 0 }, landmarks: [], nodes: [], heightAt: () => 0, isWalkable: () => true };
  const ctx: GameContext = { state, events: new GameEvents(), balance: BALANCE, rng: new NoCritRng(9) };
  const combat = new CombatFacade(ctx); combat.resetRun(); state.phase = 'playing';
  ctx.events.emit('enemy:spawn-requested', { id: 'enemy', archetype, tier: 'normal', position: { x: 0, y: 0, z } });
  const enemy = state.enemies.get('enemy'); assert.ok(enemy);
  function advance(seconds: number, input: Partial<InputFrame> = {}) {
    let left = seconds;
    while (left > 1e-9) { const dt = Math.min(left, 1 / 60); state.elapsedSeconds += dt; combat.update(dt, { ...IDLE, ...input }); left -= dt; }
  }
  return { state, ctx, enemy, advance };
}
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('goblin close contact is harmless until its .45s directional attack tell completes', () => {
  const { state, enemy, advance } = simulation('goblin-stalker', -1);
  advance(0.46); assert.equal(enemy.mode, 'windup'); close(state.player.hp, 100);
  advance(0.43); close(state.player.hp, 100);
  advance(0.05); close(state.player.hp, 92);
});

test('hunter marks a destination, waits its tell, then blink-strikes; movement evades the mark', () => {
  const game = simulation('relic-hunter', -5);
  game.advance(0.67); assert.equal(game.enemy.mode, 'windup'); close(game.state.player.hp, 100);
  game.advance(0.6); close(game.state.player.hp, 100);
  game.advance(0.1); close(game.state.player.hp, 84);
  assert.ok(Math.hypot(game.enemy.position.x, game.enemy.position.z) < 1.3);
  const evade = simulation('relic-hunter', -5);
  evade.advance(0.67); evade.advance(0.72, { moveX: 1 }); close(evade.state.player.hp, 100);
});

test('wyvern hovers and strafes, then fires non-homing ranged spit after .8s windup', () => {
  const { state, enemy, advance } = simulation('blood-wyvern', -10);
  advance(0.82); assert.equal(enemy.mode, 'windup'); close(enemy.position.y, 1.8);
  assert.ok(Math.abs(enemy.position.x) > 0.1); close(state.player.hp, 100); assert.equal(state.projectiles.size, 0);
  advance(0.75); assert.equal(state.projectiles.size, 0);
  advance(0.12); assert.equal([...state.projectiles.values()][0]?.kind, 'wyvern-spit');
  advance(1); close(state.player.hp, 88);
});

test('ironbark mitigates hostile HP loss while deep-breath reduces the single melee cost', () => {
  const { state, advance } = simulation('stone-golem', -2);
  state.buffs.ironbark = 5; state.buffs['deep-breath'] = 5;
  advance(1.8); close(state.player.hp, 84);
  advance(1 / 60, { meleeHeld: true, aimGround: { x: 0, y: 0, z: -10 } }); close(state.player.stamina, 93.6);
});

test('cleave extends reach and arc by their exact per-stack balance values', () => {
  const game = simulation('stone-golem', -3.2);
  game.advance(1 / 60, { meleeHeld: true, aimGround: { x: 0, y: 0, z: -10 } }); close(game.enemy.hp, 200);
  game.state.buffs.cleave = 5;
  game.advance(0.5, { meleeHeld: true, aimGround: { x: 0, y: 0, z: -10 } });
  assert.ok(game.enemy.hp < 200);
});

test('overdrive accelerates magic cadence and bow draw threefold, not gathering or dash cooldown', () => {
  const game = simulation('stone-golem', -25); game.state.player.hp = 20;
  game.advance(1 / 60, { magicPressed: true, aimGround: { x: 1, y: 0, z: 0 } }); close(game.state.player.stamina, 82);
  game.advance(0.32); game.advance(1 / 60, { magicPressed: true }); close(game.state.player.stamina, 64);
  game.advance(1 / 60, { rangedHeld: true }); game.advance(0.24, { rangedHeld: true });
  game.advance(1 / 60, { rangedReleased: true }); assert.equal(game.state.player.arrows, 9);
});
