export type Vec3 = { x: number; y: number; z: number };
export type EntityId = string;
export type ResourceId = string;
export type RunPhase = 'title' | 'hub' | 'playing' | 'paused' | 'dead' | 'extracted';
export type Quality = 'low' | 'medium' | 'high';
export type Tier = 'wood' | 'stone' | 'cursed';
export type ResourceKind = 'tree' | 'stone' | 'gold' | 'cursed';
export type EnemyArchetype = 'goblin-stalker' | 'stone-golem' | 'blood-wyvern' | 'relic-hunter';
export type ActorArchetype = EnemyArchetype | 'rootbound-sovereign';
export type EnemyTier = 'normal' | 'elite' | 'enraged-elite';
export type LandmarkId = 'ancient-grove' | 'sunken-shrine' | 'ashen-spire';
export type BuffId = 'chain-lightning' | 'cleave' | 'vampirism' | 'multishot' | 'berserk-speed' | 'frost-nova' | 'crit-amplifier' | 'meteor-strike' | 'ironbark' | 'fleetfoot' | 'deep-breath' | 'soul-magnet';
export type RecipeId = 'stone-tool' | 'stone-weapon' | 'cursed-tool' | 'cursed-weapon' | 'arrows' | 'bandage' | 'summon-boss';
export type SkillNodeId = 'vitality' | 'endurance' | 'training' | 'recovery' | 'supply' | 'field-medic' | 'surveyor' | 'scavenger' | 'artisan';
export type RelicRecipeId = 'ember-fang' | 'rootheart' | 'moon-sigil';
export type Materials = { wood: number; stone: number; gold: number; soulShards: number; relicCores: number };
export type InputFrame = Readonly<{
  moveX: number; moveZ: number; aimGround: Vec3 | null; sprintHeld: boolean;
  dashPressed: boolean; meleeHeld: boolean; rangedHeld: boolean; rangedReleased: boolean;
  magicPressed: boolean; interactHeld: boolean; interactPressed: boolean;
  bandagePressed: boolean; pausePressed: boolean;
}>;
export type WorldLayout = Readonly<{
  seed: number; size: number; playerSpawn: Vec3;
  landmarks: readonly { id: LandmarkId; position: Vec3 }[];
  nodes: readonly { id: ResourceId; kind: ResourceKind; position: Vec3 }[];
  heightAt: (x: number, z: number) => number;
  isWalkable: (x: number, z: number) => boolean;
}>;
export type PlayerState = {
  id: 'player'; position: Vec3; velocity: Vec3; facing: Vec3;
  hp: number; maxHp: number; stamina: number; maxStamina: number;
  toolTier: Tier; weaponTier: Tier; arrows: number; bandages: number;
  overdrive: boolean; lastHostileHitAt: number; invulnerableUntil: number;
};
export type EnemyState = {
  id: EntityId; archetype: ActorArchetype; tier: EnemyTier; position: Vec3;
  facing: Vec3; hp: number; maxHp: number;
  mode: 'idle' | 'chase' | 'windup' | 'attack' | 'recover' | 'dead';
  modeUntil: number; phase: 1 | 2 | 3;
};
export type ResourceState = { id: ResourceId; kind: ResourceKind; position: Vec3; hp: number; maxHp: number; depleted: boolean };
export type ProjectileState = {
  id: EntityId; ownerId: EntityId; kind: 'arrow' | 'magic' | 'wyvern-spit' | 'boss-shard';
  position: Vec3; velocity: Vec3; damage: number; expiresAt: number;
};
export type LootState = { id: EntityId; position: Vec3; materials: Materials; blueprint: RelicRecipeId | null };
export type BeaconState = {
  index: number; landmarkId: LandmarkId; position: Vec3; opensAt: number; closesAt: number;
  multiplier: 1.5 | 2.5 | 5; announced: boolean; channelSeconds: number;
};
export type BuffDraft = { id: string; choices: readonly BuffId[]; paidGold: number };
export type ValidatedAsset =
  | { kind: 'procedural'; recipeId: RelicRecipeId; seed: number }
  | { kind: 'glb'; assetId: string; url: string; sha256: string; byteLength: number; triangles: number; materials: number; maxTextureSize: number };
export type ForgeAvailability = { mode: 'offline' | 'remote'; enabled: boolean; reason: string | null };
export type ForgeRequest = { requestId: string; recipeId: RelicRecipeId; rank: 1 | 2 | 3; visualSeed: number; customization: string | null; allowPaid: boolean };
export type ForgeJob = {
  id: string; requestId: string; mode: 'offline' | 'remote';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: number | null; asset: ValidatedAsset | null;
  error: { code: string; message: string } | null; createdAt: number; updatedAt: number;
};
export type ProfileState = {
  version: 1; soulShards: number; relicCores: number; blueprints: RelicRecipeId[];
  skills: Record<SkillNodeId, 0 | 1 | 2 | 3>;
  relicRanks: Record<RelicRecipeId, 0 | 1 | 2 | 3>;
  equippedRelic: RelicRecipeId | null;
  relicVisuals: Partial<Record<RelicRecipeId, ValidatedAsset>>;
  discoveries: string[]; settledRunIds: string[];
};
export type RunResult = {
  runId: string; outcome: 'dead' | 'extracted' | 'abandoned'; collectedSouls: number;
  multiplier: number; bankedSouls: number; bankedCores: number;
  bankedBlueprints: RelicRecipeId[]; discoverySouls: number; durationSeconds: number;
};
export type GameSettings = { quality: Quality; music: number; sfx: number; muted: boolean; reducedMotion: boolean };
export type RunState = {
  runId: string; seed: number; phase: RunPhase; pauseReason: 'menu' | 'draft' | 'blur' | null;
  elapsedSeconds: number; cycleIndex: number; dayPhase: 'day' | 'night'; world: WorldLayout | null;
  player: PlayerState; enemies: Map<EntityId, EnemyState>; resources: Map<ResourceId, ResourceState>;
  projectiles: Map<EntityId, ProjectileState>; loot: Map<EntityId, LootState>;
  materials: Materials; buffs: Record<BuffId, number>; threat: number; threatDecayAt: number;
  passiveHealBlockedUntil: number; nextHunterAt: number; kills: number;
  cursedNodesMined: number; paidDraftCount: number; activeDraft: BuffDraft | null;
  pendingDrafts: BuffDraft[]; beacon: BeaconState | null; bossSummoned: boolean;
  runBlueprints: RelicRecipeId[]; runDiscoveries: string[]; profile: ProfileState;
  result: RunResult | null; forgeJob: ForgeJob | null; settings: GameSettings;
  notification: string | null; unsaved: boolean;
};
export type PlayerStats = {
  maxHp: number; maxStamina: number; movementSpeed: number; sprintSpeed: number;
  meleeDamage: number; attackRate: number; damageReduction: number; critChance: number;
  critMultiplier: number; lifestealFraction: number; staminaCostMultiplier: number; pickupRadius: number;
};
export type UiSnapshot = Readonly<{
  phase: RunPhase; hp: number; maxHp: number; stamina: number; maxStamina: number;
  elapsedSeconds: number; cycleIndex: number; dayPhase: 'day' | 'night'; phaseSecondsRemaining: number;
  threat: number; overdrive: boolean; materials: Materials; buffs: Record<BuffId, number>;
  beacon: BeaconState | null; nextBeaconAt: number; payoutMultiplier: number; projectedSouls: number;
  draft: BuffDraft | null; profile: ProfileState; result: RunResult | null;
  forgeJob: ForgeJob | null; settings: GameSettings; kills: number;
  toolTier: Tier; weaponTier: Tier; arrows: number; bandages: number;
  notification: string | null; unsaved: boolean;
}>;
export type GameAction =
  | { type: 'start-run'; seed: number | null }
  | { type: 'pause' } | { type: 'resume' } | { type: 'return-hub' }
  | { type: 'craft'; recipeId: RecipeId }
  | { type: 'choose-buff'; draftId: string; buffId: BuffId }
  | { type: 'buy-draft'; chestId: LandmarkId }
  | { type: 'upgrade-skill'; nodeId: SkillNodeId }
  | { type: 'upgrade-relic'; recipeId: RelicRecipeId }
  | { type: 'equip-relic'; recipeId: RelicRecipeId }
  | { type: 'generate-relic'; recipeId: RelicRecipeId; customization: string | null }
  | { type: 'set-quality'; quality: Quality }
  | { type: 'set-audio'; music: number; sfx: number; muted: boolean };
export type GameEventMap = {
  'run:started': { runId: string; seed: number };
  'run:ended': { result: RunResult };
  'enemy:spawn-requested': { id: EntityId; archetype: ActorArchetype; tier: EnemyTier; position: Vec3 };
  'enemy:died': { id: EntityId; archetype: ActorArchetype; position: Vec3 };
  'actor:damaged': { id: EntityId; sourceId: EntityId; amount: number; hpRemaining: number; position: Vec3; critical: boolean };
  'player:heal-requested': { amount: number; source: 'passive' | 'bandage' };
  'combat:area-requested': { kind: 'meteor' | 'frost'; origin: Vec3; radius: number; damage: number; slowFraction: number; durationSeconds: number };
  'player:overdrive': { active: boolean };
  'resource:hit': { id: ResourceId; amount: number; toolTier: Tier; position: Vec3 };
  'resource:depleted': { id: ResourceId; kind: ResourceKind; position: Vec3 };
  'loot:collected': { id: EntityId; materials: Materials; blueprint: RelicRecipeId | null };
  'threat:changed': { value: number; healBlockedUntil: number };
  'beacon:changed': { beacon: BeaconState | null };
  'extraction:progress': { seconds: number; required: 10; interrupted: boolean };
  'buff:draft-opened': { draft: BuffDraft };
  'buff:chosen': { id: BuffId; stacks: number };
  'item:crafted': { recipeId: RecipeId };
  'discovery:recorded': { id: string };
  'forge:status': { job: ForgeJob };
  'fx:requested': { kind: 'hit' | 'crit' | 'dash' | 'slash' | 'arrow' | 'magic' | 'lightning' | 'meteor' | 'frost' | 'death'; position: Vec3; direction: Vec3 | null; intensity: number };
  'audio:cue': { cue: 'hit' | 'swing' | 'bow' | 'magic' | 'night' | 'lightning' | 'wood' | 'stone' | 'dash' | 'mine' | 'craft' | 'draft' | 'beacon' | 'extract' | 'death' | 'overdrive' | 'boss'; position: Vec3 | null };
};
