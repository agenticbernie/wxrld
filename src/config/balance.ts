import type { ActorArchetype, BuffId, Materials, RecipeId, RelicRecipeId, ResourceKind, SkillNodeId, Tier } from '../types/game';

export const BUFF_IDS: readonly BuffId[] = ['chain-lightning', 'cleave', 'vampirism', 'multishot', 'berserk-speed', 'frost-nova', 'crit-amplifier', 'meteor-strike', 'ironbark', 'fleetfoot', 'deep-breath', 'soul-magnet'];
export const SKILL_IDS: readonly SkillNodeId[] = ['vitality', 'endurance', 'training', 'recovery', 'supply', 'field-medic', 'surveyor', 'scavenger', 'artisan'];
export const RELIC_IDS: readonly RelicRecipeId[] = ['ember-fang', 'rootheart', 'moon-sigil'];
export const EMPTY_MATERIALS: Readonly<Materials> = { wood: 0, stone: 0, gold: 0, soulShards: 0, relicCores: 0 };

const resources: Readonly<Record<ResourceKind, { hp: number; count: number; drops: Readonly<Materials>; minimumTier: Tier }>> = {
  tree: { hp: 60, count: 18, drops: { ...EMPTY_MATERIALS, wood: 6 }, minimumTier: 'wood' },
  stone: { hp: 80, count: 14, drops: { ...EMPTY_MATERIALS, stone: 4 }, minimumTier: 'wood' },
  gold: { hp: 80, count: 10, drops: { ...EMPTY_MATERIALS, gold: 2 }, minimumTier: 'wood' },
  cursed: { hp: 150, count: 12, drops: { ...EMPTY_MATERIALS, soulShards: 8 }, minimumTier: 'stone' },
};
const recipes: Readonly<Record<RecipeId, { name: string; cost: Readonly<Materials>; description: string }>> = {
  'stone-tool': { name: 'Stone Pick', cost: { ...EMPTY_MATERIALS, wood: 6, stone: 8 }, description: 'Harvest cursed deposits. 30 node damage.' },
  'stone-weapon': { name: 'Stone Blade', cost: { ...EMPTY_MATERIALS, wood: 6, stone: 8 }, description: '22 base melee damage.' },
  'cursed-tool': { name: 'Cursed Pick', cost: { ...EMPTY_MATERIALS, stone: 6, gold: 4, relicCores: 1 }, description: '40 node damage.' },
  'cursed-weapon': { name: 'Cursed Blade', cost: { ...EMPTY_MATERIALS, stone: 6, gold: 4, relicCores: 1 }, description: '32 base melee damage.' },
  arrows: { name: 'Arrow Bundle', cost: { ...EMPTY_MATERIALS, wood: 2, stone: 1 }, description: 'Craft ten arrows.' },
  bandage: { name: 'Field Bandage', cost: { ...EMPTY_MATERIALS, wood: 4, gold: 1 }, description: 'Restore 25 HP. Maximum four carried.' },
  'summon-boss': { name: 'Awaken Sovereign', cost: { ...EMPTY_MATERIALS, relicCores: 3 }, description: 'Summon at the Ashen Spire. Raises threat by 30.' },
};
const enemies: Readonly<Record<ActorArchetype, { hp: number; damage: number; speed: number; windup: number; cooldown: number; souls: number }>> = {
  'goblin-stalker': { hp: 50, damage: 8, speed: 3.8, windup: 0.45, cooldown: 1.3, souls: 1 },
  'stone-golem': { hp: 200, damage: 20, speed: 2.2, windup: 0.85, cooldown: 2.6, souls: 3 },
  'blood-wyvern': { hp: 120, damage: 12, speed: 4.2, windup: 0.8, cooldown: 2.2, souls: 2 },
  'relic-hunter': { hp: 160, damage: 16, speed: 4.8, windup: 0.65, cooldown: 1.8, souls: 6 },
  'rootbound-sovereign': { hp: 1800, damage: 24, speed: 1.7, windup: 1.2, cooldown: 3.2, souls: 40 },
};
const buffs: Readonly<Record<BuffId, { name: string; description: string; perStack: number; maxStacks: number }>> = {
  'chain-lightning': { name: 'Chain Lightning', description: 'Hits chain 15% damage to one more enemy per stack.', perStack: 0.15, maxStacks: 5 },
  cleave: { name: 'Cleave', description: '+8° melee arc and +0.15 m reach per stack.', perStack: 0.15, maxStacks: 5 },
  vampirism: { name: 'Vampirism', description: '+0.8% direct-damage lifesteal per stack.', perStack: 0.008, maxStacks: 5 },
  multishot: { name: 'Multishot', description: 'One extra arrow at 30% damage per stack. One ammo per volley.', perStack: 0.3, maxStacks: 5 },
  'berserk-speed': { name: 'Berserk Speed', description: '+5% attack speed per stack.', perStack: 0.05, maxStacks: 5 },
  'frost-nova': { name: 'Frost Nova', description: 'Every 6 s, slow nearby enemies by 6% per stack for 2 s.', perStack: 0.06, maxStacks: 5 },
  'crit-amplifier': { name: 'Crit Amplifier', description: '+5 percentage points critical chance per stack.', perStack: 0.05, maxStacks: 5 },
  'meteor-strike': { name: 'Meteor Strike', description: 'Every 12 s in combat, a marked meteor deals 40 damage per stack.', perStack: 40, maxStacks: 5 },
  ironbark: { name: 'Ironbark', description: 'Reduce incoming damage by 4% per stack.', perStack: 0.04, maxStacks: 5 },
  fleetfoot: { name: 'Fleetfoot', description: '+3% movement speed per stack.', perStack: 0.03, maxStacks: 5 },
  'deep-breath': { name: 'Deep Breath', description: 'Reduce stamina expenditure by 4% per stack.', perStack: 0.04, maxStacks: 5 },
  'soul-magnet': { name: 'Soul Magnet', description: '+1.5 m loot pickup radius per stack.', perStack: 1.5, maxStacks: 5 },
};
const skills: Readonly<Record<SkillNodeId, { name: string; description: string; perRank: number }>> = {
  vitality: { name: 'Vitality', description: '+5 maximum HP per rank.', perRank: 5 },
  endurance: { name: 'Endurance', description: '+5 maximum stamina per rank.', perRank: 5 },
  training: { name: 'Training', description: '+5% direct damage per rank.', perRank: 0.05 },
  recovery: { name: 'Recovery', description: 'Passive healing starts 0.5 s sooner per rank.', perRank: 0.5 },
  supply: { name: 'Supply', description: 'Start with five more arrows per rank.', perRank: 5 },
  'field-medic': { name: 'Field Medic', description: '+5 bandage healing per rank; ranks two and three add a starting bandage.', perRank: 1 },
  surveyor: { name: 'Surveyor', description: 'Beacon location revealed two seconds earlier per rank.', perRank: 2 },
  scavenger: { name: 'Scavenger', description: 'First three ordinary nodes per rank yield an extra material.', perRank: 3 },
  artisan: { name: 'Artisan', description: 'Start with two wood per rank.', perRank: 2 },
};
const relics: Readonly<Record<RelicRecipeId, { name: string; property: 'damage' | 'stamina'; description: string }>> = {
  'ember-fang': { name: 'Ember Fang', property: 'damage', description: 'A forged ember suspended within fractured bronze. +5% direct damage per rank.' },
  rootheart: { name: 'Rootheart', property: 'stamina', description: 'A living seed cradled in ancient roots. +5% maximum stamina per rank.' },
  'moon-sigil': { name: 'Moon Sigil', property: 'damage', description: 'Nested silver crescents bind a blood-moon shard. +5% direct damage per rank.' },
};

export const BALANCE = {
  player: { hp: 100, stamina: 100, moveSpeed: 4.5, sprintSpeed: 7, sprintCost: 16, staminaRegen: 22, staminaRegenDelay: 0.75, dashDistance: 4, dashDuration: 0.22, dashCost: 25, dashCooldown: 1.2, dashInvulnerability: 0.18, passiveHeal: 1, passiveHealDelay: 8, bandageHeal: 25, bandageDuration: 2, bandageMax: 4, pickupRadius: 2 },
  combat: { meleeDamage: { wood: 14, stone: 22, cursed: 32 }, toolDamage: { wood: 20, stone: 30, cursed: 40 }, attackRate: 2, meleeCost: 8, meleeReach: 2.7, meleeArc: Math.PI * 0.65, comboMultipliers: [1, 1.15, 1.5], comboReset: 1, gatherInterval: 0.35, gatherReach: 2.5, bowDamage: 24, bowDraw: 0.7, bowRange: 35, arrowSpeed: 28, magicDamage: 30, magicCooldown: 1, magicCost: 18, magicRange: 28, magicSpeed: 22, critChance: 0.05, critMultiplier: 1.5, maxCritChance: 0.3, maxAttackSpeedBonus: 0.25, maxDamageBonus: 0.5, hitstopSeconds: 0.035 },
  resources, recipes, enemies, buffs, skills, relics,
  spawning: { dayInterval: 12, nightInterval: 7, nightSpeedMultiplier: 1.15, dayDetection: 14, nightDetection: 21, maxEnemies: 18, maxHunters: 2, maxWyverns: 2, hpPerCycle: 0.08, damagePerCycle: 0.05, maxScalingCycles: 6, eliteHp: 1.35, eliteDamage: 1.15, enragedHp: 1.6, enragedDamage: 1.3 },
  threat: { max: 100, cursedIncrease: 18, bossIncrease: 30, decayDelay: 25, decayRate: 1, healSuppression: 20, hunterThreshold: 40, enragedThreshold: 75, hunterInterval: 25 },
  overdrive: { threshold: 0.3, attackMultiplier: 3, damageMultiplier: 2.5, lifesteal: 0.02, maxLifestealFraction: 0.06, maxLifestealPerSecond: 8 },
  buffEffects: { lightningRange: 6, lightningCooldown: 1, cleaveArcPerStack: Math.PI * 8 / 180, frostInterval: 6, frostDuration: 2, frostRadius: 3, meteorInterval: 12, meteorWarning: 0.7, meteorRadius: 3, killMilestones: [12, 30, 55, 85], firstChestCost: 5, chestCostIncrease: 3 },
  boss: { coreCost: 3, transitionThresholds: [0.66, 0.33], transitionSeconds: 1.5, rootDamage: 14, volleyDamage: 12, minimumTell: 1 },
  extraction: { daySeconds: 90, nightSeconds: 60, cycleSeconds: 150, windowSeconds: 45, channelSeconds: 10, radius: 10, announcementSeconds: 15, multipliers: [1.5, 2.5, 5] },
  progression: { skillCosts: [20, 50, 100], relicSoulCosts: [25, 60, 120], relicCoreCosts: [1, 2, 3], maxRank: 3, discoveryReward: 2, maxDiscoveries: 8 },
} as const;
