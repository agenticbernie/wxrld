import { BALANCE, BUFF_IDS } from '../config/balance';
import type { RunResult, RunState } from '../types/game';
import { DISCOVERY_IDS, emptyMaterials } from './rules';

/** Only systems-owned buffers are cleared. Combat's actors/HP remain untouched. */
export function clearRunRewards(state: RunState): void {
  state.materials = emptyMaterials();
  state.resources.clear();
  state.loot.clear();
  for (const id of BUFF_IDS) state.buffs[id] = 0;
  state.player.toolTier = 'wood';
  state.player.weaponTier = 'wood';
  state.player.arrows = 0;
  state.player.bandages = 0;
  state.activeDraft = null;
  state.pendingDrafts.length = 0;
  state.runBlueprints.length = 0;
  state.runDiscoveries.length = 0;
  state.beacon = null;
  state.threat = 0;
  state.threatDecayAt = 0;
  state.passiveHealBlockedUntil = 0;
}

/** Returns null for duplicate/empty identities; profile is updated before callers
 * publish run:ended. Retaining every settled ID prevents later replay banking.
 */
export function settleRun(state: RunState, outcome: RunResult['outcome'], multiplier: number, balance: typeof BALANCE = BALANCE): RunResult | null {
  if (!state.runId || state.result !== null) return null;
  if (state.profile.settledRunIds.includes(state.runId)) {
    clearRunRewards(state);
    return null;
  }
  const extracted = outcome === 'extracted';
  const collectedSouls = Math.max(0, Math.floor(state.materials.soulShards));
  const payout = extracted ? multiplier : 0;
  const bankedSouls = extracted ? Math.floor(collectedSouls * payout) : 0;
  const bankedCores = extracted ? Math.max(0, Math.floor(state.materials.relicCores)) : 0;
  const bankedBlueprints = extracted
    ? [...new Set(state.runBlueprints)].filter(id => !state.profile.blueprints.includes(id))
    : [];
  const discovered = new Set(state.profile.discoveries);
  const firstDiscoveries = outcome === 'abandoned' ? [] : [...new Set(state.runDiscoveries)]
    .filter(id => DISCOVERY_IDS.includes(id) && !discovered.has(id));
  const alreadyRewarded = DISCOVERY_IDS.filter(id => discovered.has(id)).length;
  const rewarded = firstDiscoveries.slice(0, Math.max(0, balance.progression.maxDiscoveries - alreadyRewarded));
  const discoverySouls = rewarded.length * balance.progression.discoveryReward;
  const result: RunResult = {
    runId: state.runId, outcome, collectedSouls, multiplier: payout,
    bankedSouls, bankedCores, bankedBlueprints, discoverySouls,
    durationSeconds: state.elapsedSeconds,
  };
  state.profile.settledRunIds.push(state.runId);
  state.profile.soulShards += bankedSouls + discoverySouls;
  state.profile.relicCores += bankedCores;
  state.profile.blueprints.push(...bankedBlueprints);
  state.profile.discoveries.push(...rewarded);
  state.result = result;
  clearRunRewards(state);
  return result;
}
