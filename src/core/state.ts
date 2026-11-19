import { BALANCE, BUFF_IDS, EMPTY_MATERIALS, RELIC_IDS, SKILL_IDS } from '../config/balance';
import type { BuffId, PlayerState, ProfileState, RelicRecipeId, RunState, SkillNodeId } from '../types/game';
import { getPlayerStats } from './selectors';

export function createProfile(): ProfileState {
  const skills = Object.fromEntries(SKILL_IDS.map(id => [id, 0])) as Record<SkillNodeId, 0 | 1 | 2 | 3>;
  const relicRanks = Object.fromEntries(RELIC_IDS.map(id => [id, 0])) as Record<RelicRecipeId, 0 | 1 | 2 | 3>;
  return { version: 1, soulShards: 0, relicCores: 0, blueprints: [], skills, relicRanks, equippedRelic: null, relicVisuals: {}, discoveries: [], settledRunIds: [] };
}
function createPlayer(): PlayerState {
  return { id: 'player', position: { x: 0, y: 3, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, facing: { x: 0, y: 0, z: 1 }, hp: BALANCE.player.hp, maxHp: BALANCE.player.hp, stamina: BALANCE.player.stamina, maxStamina: BALANCE.player.stamina, toolTier: 'wood', weaponTier: 'wood', arrows: 10, bandages: 2, overdrive: false, lastHostileHitAt: -100, invulnerableUntil: 0 };
}
export function createRunState(profile: ProfileState): RunState {
  return {
    runId: '', seed: 1, phase: 'title', pauseReason: null, elapsedSeconds: 0, cycleIndex: 0,
    dayPhase: 'day', world: null, player: createPlayer(), enemies: new Map(), resources: new Map(),
    projectiles: new Map(), loot: new Map(), materials: { ...EMPTY_MATERIALS },
    buffs: Object.fromEntries(BUFF_IDS.map(id => [id, 0])) as Record<BuffId, number>,
    threat: 0, threatDecayAt: 0, passiveHealBlockedUntil: 0, nextHunterAt: 0,
    kills: 0, cursedNodesMined: 0, paidDraftCount: 0, activeDraft: null, pendingDrafts: [],
    beacon: null, bossSummoned: false, runBlueprints: [], runDiscoveries: [], profile,
    result: null, forgeJob: null, settings: { quality: 'medium', music: 0.25, sfx: 0.55, muted: false, reducedMotion: false },
    notification: null, unsaved: false,
  };
}
export function resetRunState(state: RunState, seed: number, runId: string): void {
  const settings = state.settings;
  const unsaved = state.unsaved;
  Object.assign(state, createRunState(state.profile));
  state.settings = settings;
  state.unsaved = unsaved;
  state.seed = seed >>> 0;
  state.runId = runId;
  const stats = getPlayerStats(state, BALANCE);
  state.player.maxHp = stats.maxHp;
  state.player.hp = stats.maxHp;
  state.player.maxStamina = stats.maxStamina;
  state.player.stamina = stats.maxStamina;
  state.player.arrows += state.profile.skills.supply * 5;
  state.player.bandages += Math.max(0, state.profile.skills['field-medic'] - 1);
  state.materials.wood = state.profile.skills.artisan * 2;
}
