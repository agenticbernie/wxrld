import { BALANCE } from '../config/balance';
import type { PlayerStats, ProfileState, RunState, UiSnapshot } from '../types/game';
import { clamp } from './math';

export function getPlayerStats(state: RunState, balance: typeof BALANCE = BALANCE): PlayerStats {
  const relic = state.profile.equippedRelic;
  const rank = relic ? state.profile.relicRanks[relic] : 0;
  const relicDamage = relic && balance.relics[relic].property === 'damage' ? rank * 0.05 : 0;
  const relicStamina = relic && balance.relics[relic].property === 'stamina' ? rank * 0.05 : 0;
  const overdrive = state.player.overdrive;
  const speedBonus = state.buffs.fleetfoot * balance.buffs.fleetfoot.perStack;
  const damageBonus = Math.min(balance.combat.maxDamageBonus, state.profile.skills.training * balance.skills.training.perRank + relicDamage);
  return {
    maxHp: balance.player.hp + state.profile.skills.vitality * balance.skills.vitality.perRank,
    maxStamina: (balance.player.stamina + state.profile.skills.endurance * balance.skills.endurance.perRank) * (1 + relicStamina),
    movementSpeed: balance.player.moveSpeed * (1 + speedBonus),
    sprintSpeed: balance.player.sprintSpeed * (1 + speedBonus),
    meleeDamage: balance.combat.meleeDamage[state.player.weaponTier] * (1 + damageBonus) * (overdrive ? balance.overdrive.damageMultiplier : 1),
    attackRate: balance.combat.attackRate * (1 + Math.min(balance.combat.maxAttackSpeedBonus, state.buffs['berserk-speed'] * balance.buffs['berserk-speed'].perStack)) * (overdrive ? balance.overdrive.attackMultiplier : 1),
    damageReduction: state.buffs.ironbark * balance.buffs.ironbark.perStack,
    critChance: Math.min(balance.combat.maxCritChance, balance.combat.critChance + state.buffs['crit-amplifier'] * balance.buffs['crit-amplifier'].perStack),
    critMultiplier: balance.combat.critMultiplier,
    lifestealFraction: Math.min(balance.overdrive.maxLifestealFraction, state.buffs.vampirism * balance.buffs.vampirism.perStack + (overdrive ? balance.overdrive.lifesteal : 0)),
    staminaCostMultiplier: 1 - state.buffs['deep-breath'] * balance.buffs['deep-breath'].perStack,
    pickupRadius: balance.player.pickupRadius + state.buffs['soul-magnet'] * balance.buffs['soul-magnet'].perStack,
  };
}
export function cloneProfile(profile: ProfileState): ProfileState {
  return { ...profile, blueprints: [...profile.blueprints], skills: { ...profile.skills }, relicRanks: { ...profile.relicRanks }, relicVisuals: { ...profile.relicVisuals }, discoveries: [...profile.discoveries], settledRunIds: [...profile.settledRunIds] };
}
export function extractionMultiplier(index: number): 1.5 | 2.5 | 5 { return index <= 1 ? 1.5 : index === 2 ? 2.5 : 5; }
export function getUiSnapshot(state: RunState): UiSnapshot {
  const cycleTime = state.elapsedSeconds % BALANCE.extraction.cycleSeconds;
  const nextBeaconAt = (Math.floor(state.elapsedSeconds / BALANCE.extraction.cycleSeconds) + 1) * BALANCE.extraction.cycleSeconds;
  const payoutMultiplier = state.beacon?.multiplier ?? extractionMultiplier(Math.floor(nextBeaconAt / BALANCE.extraction.cycleSeconds));
  return {
    phase: state.phase, hp: state.player.hp, maxHp: state.player.maxHp,
    stamina: state.player.stamina, maxStamina: state.player.maxStamina,
    elapsedSeconds: state.elapsedSeconds, cycleIndex: state.cycleIndex, dayPhase: state.dayPhase,
    phaseSecondsRemaining: clamp((state.dayPhase === 'day' ? BALANCE.extraction.daySeconds : BALANCE.extraction.cycleSeconds) - cycleTime, 0, 150),
    threat: state.threat, overdrive: state.player.overdrive, materials: { ...state.materials }, buffs: { ...state.buffs },
    beacon: state.beacon ? { ...state.beacon, position: { ...state.beacon.position } } : null,
    nextBeaconAt, payoutMultiplier, projectedSouls: Math.floor(state.materials.soulShards * payoutMultiplier),
    draft: state.activeDraft ? { ...state.activeDraft, choices: [...state.activeDraft.choices] } : null,
    profile: cloneProfile(state.profile), result: state.result ? { ...state.result, bankedBlueprints: [...state.result.bankedBlueprints] } : null,
    forgeJob: state.forgeJob ? { ...state.forgeJob } : null, settings: { ...state.settings }, kills: state.kills,
    toolTier: state.player.toolTier, weaponTier: state.player.weaponTier, arrows: state.player.arrows, bandages: state.player.bandages,
    notification: state.notification, unsaved: state.unsaved,
  };
}
