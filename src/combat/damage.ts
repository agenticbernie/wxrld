import type { BALANCE } from '../config/balance';
import type { EnemyTier, RunState } from '../types/game';

export function isOverdriveEligible(hp: number, maxHp: number, threshold: number): boolean {
  return hp > 0 && maxHp > 0 && hp < maxHp * threshold;
}

/** Mirrors the common selector for non-melee weapons, applying each bonus exactly once. */
export function rangedDamage(base: number, state: RunState, balance: typeof BALANCE): number {
  const relic = state.profile.equippedRelic;
  const relicBonus = relic && balance.relics[relic].property === 'damage' ? state.profile.relicRanks[relic] * 0.05 : 0;
  const bonus = Math.min(balance.combat.maxDamageBonus, state.profile.skills.training * balance.skills.training.perRank + relicBonus);
  return base * (1 + bonus) * (state.player.overdrive ? balance.overdrive.damageMultiplier : 1);
}

export function scaledEnemyStats(baseHp: number, baseDamage: number, tier: EnemyTier, cycle: number, balance: typeof BALANCE): { hp: number; damage: number } {
  const completed = Math.min(balance.spawning.maxScalingCycles, Math.max(0, Math.floor(cycle)));
  const hpTier = tier === 'enraged-elite' ? balance.spawning.enragedHp : tier === 'elite' ? balance.spawning.eliteHp : 1;
  const damageTier = tier === 'enraged-elite' ? balance.spawning.enragedDamage : tier === 'elite' ? balance.spawning.eliteDamage : 1;
  return {
    hp: baseHp * hpTier * (1 + completed * balance.spawning.hpPerCycle),
    damage: baseDamage * damageTier * (1 + completed * balance.spawning.damagePerCycle),
  };
}

/** Actual heals (not attempted heals) share an exact rolling simulation-second budget. */
export class LifestealBudget {
  private readonly entries: { at: number; amount: number }[] = [];
  reset(): void { this.entries.length = 0; }
  claim(now: number, removedHp: number, fraction: number, missingHp: number, maxFraction: number, maxPerSecond: number): number {
    while (this.entries.length && (this.entries[0]?.at ?? now) <= now - 1 + 1e-10) this.entries.shift();
    const spent = this.entries.reduce((sum, entry) => sum + entry.amount, 0);
    const heal = Math.max(0, Math.min(removedHp * Math.min(maxFraction, Math.max(0, fraction)), maxPerSecond - spent, missingHp));
    if (heal > 0) this.entries.push({ at: now, amount: heal });
    return heal;
  }
}
