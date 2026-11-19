# Wxrld — Architecture and Conventions

## 1. Architectural choice and dependency baseline
- Use **one shared mutable `RunState`**, typed synchronous game events and explicit UI action callbacks. No competing stores, ECS framework, hidden singleton or cross-directory import cycles.
- Only the documented field owner mutates a field. Other modules read state or emit a typed request. Event payloads contain IDs/plain data, never scene objects or DOM nodes.
- Browser stack: Three.js **0.180.0**, `@types/three` **0.180.0**, TypeScript **5.9.2**, Vite **7.3.8**, Tailwind CSS **4.1.13**, `@tailwindcss/vite` **4.1.13**; Node **24**, npm and `tsx` **4.20.6**.
- Vite 7 is deliberate: the selected Tailwind Vite plugin supports Vite 5/6/7, not Vite 8. Use the compatible patched 7.3.8 baseline.
- Browser testing: Playwright **1.65.1** if available/compatible with installed Chromium; otherwise pin a verified compatible version and record the change. No unverified dependency or test claim.
- Source, comments, identifiers and documentation are English. Strict TypeScript, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, no explicit/implicit `any` and no unchecked casts to silence integration errors.
- These documents precede source scaffolding. No implementation, build or browser test has been performed by writing them.

## 2. Directory ownership and build order
| Owner | Exclusive implementation directories | Responsibilities |
|---|---|---|
| World/rendering | `src/world/`, `src/rendering/` | Terrain/layout, camera, renderer, PBR shaders, procedural models, visual maps, generated GLB display |
| Entities/combat | `src/entities/`, `src/combat/` | Player motion/HP/stamina, enemy AI, projectiles, attacks, hit tests, direct-damage/lifesteal resolution |
| Systems | `src/systems/` | Run clock, resources/loot, crafting, threat/spawning requests, buffs, extraction, boss altar, skill/relic economy, settlement |
| Services/UI/audio/scripts | `src/services/`, `src/ui/`, `src/audio/`, `scripts/`, `server/` | Save/forge clients, DOM screens, Web Audio, dry-run batch script, optional provider server |
- **Before independent implementation:** scaffold `src/types/game.ts`, `src/config/balance.ts`, `src/core/` (state, events, context, input, math, RNG, spatial hash, selectors), package/TS/Vite configuration and public interface stubs.
- Common contracts are frozen before directory work begins. Owners may request a contract correction; they must not independently edit common contracts or another owner's directory.
- Implement each owner's facade against the shared contract; no direct imports between world, combat, systems or UI. Services may be consumed through their documented interfaces, never import consumers.
- **After owner integration:** compose `src/main.ts`, repair only agreed interface gaps, then run proposed tests. No owner independently writes an alternative main loop.
- Dependency direction: types →no project imports; balance →types; core →types/balance; owner modules →core/types/balance; main →all facades. Services never import world/combat/systems/UI.
- Avoid large barrel exports that reintroduce cycles. Each facade has one explicit module path and named export.

## 3. Canonical shared types in `src/types/game.ts`
The following names/fields are contract requirements; add richer internal types only without changing these meanings.
```ts
export type Vec3 = { x: number; y: number; z: number };
export type EntityId = string; export type ResourceId = string;
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
export type InputFrame = Readonly<{ moveX: number; moveZ: number; aimGround: Vec3 | null; sprintHeld: boolean; dashPressed: boolean; meleeHeld: boolean; rangedHeld: boolean; rangedReleased: boolean; magicPressed: boolean; interactHeld: boolean; interactPressed: boolean; bandagePressed: boolean; pausePressed: boolean }>;
export type WorldLayout = Readonly<{ seed: number; size: number; playerSpawn: Vec3; landmarks: readonly { id: LandmarkId; position: Vec3 }[]; nodes: readonly { id: ResourceId; kind: ResourceKind; position: Vec3 }[]; heightAt: (x: number, z: number) => number; isWalkable: (x: number, z: number) => boolean }>;
export type PlayerState = { id: 'player'; position: Vec3; velocity: Vec3; facing: Vec3; hp: number; maxHp: number; stamina: number; maxStamina: number; toolTier: Tier; weaponTier: Tier; arrows: number; bandages: number; overdrive: boolean; lastHostileHitAt: number; invulnerableUntil: number };
export type EnemyState = { id: EntityId; archetype: ActorArchetype; tier: EnemyTier; position: Vec3; facing: Vec3; hp: number; maxHp: number; mode: 'idle' | 'chase' | 'windup' | 'attack' | 'recover' | 'dead'; modeUntil: number; phase: 1 | 2 | 3 };
export type ResourceState = { id: ResourceId; kind: ResourceKind; position: Vec3; hp: number; maxHp: number; depleted: boolean };
export type ProjectileState = { id: EntityId; ownerId: EntityId; kind: 'arrow' | 'magic' | 'wyvern-spit' | 'boss-shard'; position: Vec3; velocity: Vec3; damage: number; expiresAt: number };
export type LootState = { id: EntityId; position: Vec3; materials: Materials; blueprint: RelicRecipeId | null };
export type BeaconState = { index: number; landmarkId: LandmarkId; position: Vec3; opensAt: number; closesAt: number; multiplier: 1.5 | 2.5 | 5; announced: boolean; channelSeconds: number };
export type BuffDraft = { id: string; choices: readonly BuffId[]; paidGold: number };
export type ProfileState = { version: 1; soulShards: number; relicCores: number; blueprints: RelicRecipeId[]; skills: Record<SkillNodeId, 0 | 1 | 2 | 3>; relicRanks: Record<RelicRecipeId, 0 | 1 | 2 | 3>; equippedRelic: RelicRecipeId | null; relicVisuals: Partial<Record<RelicRecipeId, ValidatedAsset>>; discoveries: string[]; settledRunIds: string[] };
export type RunResult = { runId: string; outcome: 'dead' | 'extracted' | 'abandoned'; collectedSouls: number; multiplier: number; bankedSouls: number; bankedCores: number; bankedBlueprints: RelicRecipeId[]; discoverySouls: number; durationSeconds: number };
export type RunState = { runId: string; seed: number; phase: RunPhase; pauseReason: 'menu' | 'draft' | 'blur' | null; elapsedSeconds: number; cycleIndex: number; dayPhase: 'day' | 'night'; world: WorldLayout | null; player: PlayerState; enemies: Map<EntityId, EnemyState>; resources: Map<ResourceId, ResourceState>; projectiles: Map<EntityId, ProjectileState>; loot: Map<EntityId, LootState>; materials: Materials; buffs: Record<BuffId, number>; threat: number; threatDecayAt: number; passiveHealBlockedUntil: number; nextHunterAt: number; kills: number; cursedNodesMined: number; paidDraftCount: number; activeDraft: BuffDraft | null; pendingDrafts: BuffDraft[]; beacon: BeaconState | null; bossSummoned: boolean; runBlueprints: RelicRecipeId[]; runDiscoveries: string[]; profile: ProfileState; result: RunResult | null };
```
- Use `null` for absent shared fields rather than inconsistent optional properties. Initialize every buff/skill/relic record key. Mutable maps are never persisted directly.
- `WorldLayout` functions and map references remain runtime-only. Save `ProfileState` through validated JSON conversion; do not stringify the full run.

## 4. Core exports and balance
- `src/config/balance.ts` exports named `BALANCE`, a deeply readonly typed object with sections `player`, `combat`, `resources`, `recipes`, `enemies`, `threat`, `overdrive`, `buffs`, `boss`, `extraction`, `skills`, `relics`; values come from doc 01, not duplicated owner-local constants.
- `src/core/context.ts` exports `GameContext = { state: RunState; events: GameEvents; balance: typeof BALANCE; rng: Rng }`; imports balance/types without creating a reverse dependency.
- `src/core/state.ts`: `createRunState(profile: ProfileState): RunState`, `resetRunState(state: RunState, seed: number, runId: string): void`, `createProfile(): ProfileState`.
- Reset preserves the shared state object and profile identity; clears maps/counters/result, locks loadout max stats and does not start the clock until initialization completes.
- `src/core/events.ts`: `GameEvents` has `on<K extends keyof GameEventMap>(name: K, listener: (payload: GameEventMap[K]) => void): () => void`, `emit<K extends keyof GameEventMap>(name: K, payload: GameEventMap[K]): void`, `clear(): void`.
- `src/core/input.ts`: named `InputController`, constructor `(canvas: HTMLCanvasElement)`, `sample(resolveAim: (clientX: number, clientY: number) => Vec3 | null): InputFrame`, `clear(): void`, `dispose(): void`. `sample` consumes edge presses once.
- Input mapping: WASD/Shift/Space/left mouse/right mouse/Q/E/R/Escape; R uses bandage. UI modals consume pointer/keyboard events; held inputs clear on pause/blur to prevent stuck attacks.
- `src/core/rng.ts`: named class `Rng`, constructor `(seed: number)`, `reset(seed: number): void`, `next(): number`, `int(min: number, maxExclusive: number): number`, `pick<T>(items: readonly T[]): T`; empty pick throws a clear error. Main resets the shared RNG before run initialization.
- `src/core/spatial-hash.ts`: named `SpatialHash<T extends string>`, constructor `(cellSize: number)`, `set(id: T, position: Vec3): void`, `remove(id: T): void`, `query(position: Vec3, radius: number): T[]`, `clear(): void`.
- `src/core/math.ts` named exports: `clamp(value: number, min: number, max: number): number`, `lerp(a: number, b: number, t: number): number`, `distanceXZ(a: Vec3, b: Vec3): number`, `normalizeXZ(v: Vec3): Vec3`, `addVec3(a: Vec3, b: Vec3): Vec3`, `scaleVec3(v: Vec3, scale: number): Vec3`; zero-length normalization returns a zero vector.
- Combat owns an actor index; systems own node/loot indices, using the common implementation. Updates follow position changes; queries still perform exact distance filtering.
- `src/core/selectors.ts`: `getUiSnapshot(state: RunState): UiSnapshot`; `getPlayerStats(state: RunState, balance: typeof BALANCE): PlayerStats`. Derived stats are never stored in a second authoritative store.
- `PlayerStats`: maxHp, maxStamina, movementSpeed, sprintSpeed, meleeDamage, attackRate, damageReduction, critChance, critMultiplier, lifestealFraction, staminaCostMultiplier, pickupRadius (all numbers).
- `UiSnapshot = Readonly<{ phase: RunPhase; hp: number; maxHp: number; stamina: number; maxStamina: number; elapsedSeconds: number; dayPhase: 'day' | 'night'; threat: number; overdrive: boolean; materials: Readonly<Materials>; buffs: Readonly<Record<BuffId, number>>; beacon: Readonly<BeaconState> | null; nextBeaconIn: number; channelSeconds: number; projectedPayout: number; draft: Readonly<BuffDraft> | null; profile: Readonly<ProfileState>; result: Readonly<RunResult> | null }>`; copy nested display data, never expose state aliases/maps. Forge status is a UI-local event cache populated by `forge:status`, not an extra authoritative run store.

## 5. Exact shared event contract
`src/types/game.ts` exports `GameEventMap`; names and payload fields below are exact. Events are synchronous; unsubscribe on facade disposal.
| Event | Payload |
|---|---|
| run:started | `{ runId: string; seed: number }` |
| run:ended | `{ result: RunResult }` |
| enemy:spawn-requested | `{ id: EntityId; archetype: ActorArchetype; tier: EnemyTier; position: Vec3 }` |
| enemy:died | `{ id: EntityId; archetype: ActorArchetype; position: Vec3 }` |
| actor:damaged | `{ id: EntityId; sourceId: EntityId; amount: number; hpRemaining: number; position: Vec3; critical: boolean }` |
| player:heal-requested | `{ amount: number; source: 'passive' | 'bandage' }` |
| combat:area-requested | `{ kind: 'meteor' | 'frost'; origin: Vec3; radius: number; damage: number; slowFraction: number; durationSeconds: number }` |
| player:overdrive | `{ active: boolean }` |
| resource:hit | `{ id: ResourceId; amount: number; toolTier: Tier; position: Vec3 }` |
| resource:depleted | `{ id: ResourceId; kind: ResourceKind; position: Vec3 }` |
| loot:collected | `{ id: EntityId; materials: Materials; blueprint: RelicRecipeId | null }` |
| threat:changed | `{ value: number; healBlockedUntil: number }` |
| beacon:changed | `{ beacon: BeaconState | null }` |
| extraction:progress | `{ seconds: number; required: 10; interrupted: boolean }` |
| buff:draft-opened | `{ draft: BuffDraft }` |
| buff:chosen | `{ id: BuffId; stacks: number }` |
| item:crafted | `{ recipeId: RecipeId }` |
| discovery:recorded | `{ id: string }` |
| forge:status | `{ job: ForgeJob }` |
| fx:requested | `{ kind: 'hit' | 'crit' | 'dash' | 'lightning' | 'meteor' | 'frost' | 'death'; position: Vec3; direction: Vec3 | null; intensity: number }` |
| audio:cue | `{ cue: 'hit' | 'dash' | 'mine' | 'craft' | 'draft' | 'beacon' | 'extract' | 'death' | 'overdrive' | 'boss'; position: Vec3 | null }` |
- Combat applies HP mutation once, then emits damage; systems calculate loot from enemy archetype, not renderer meshes. Resource hit is a request; systems validates tier/range and mutates node HP. Systems schedule meteor/frost and emit `combat:area-requested`; combat alone applies enemy damage/slow, without lifesteal or recursive procs. Chain Lightning is resolved by combat from direct-hit buff state.
- Death/settlement is resolved before opening drafts or completing extraction. Event listeners must not recursively request the same damage/proc.

## 6. Exact facade exports and methods
All constructors use the same `GameContext`; facade-local options below are declared in the exporting module. Methods are synchronous unless shown otherwise.
```ts
// src/world/WorldFacade.ts — named export
export class WorldFacade {
  constructor(ctx: GameContext, options: { canvas: HTMLCanvasElement; quality: Quality });
  resetRun(): WorldLayout;
  setPresentation(mode: 'title' | 'hub' | 'run'): void;
  getAimPoint(clientX: number, clientY: number): Vec3 | null;
  applyRelicVisual(asset: ValidatedAsset): Promise<void>;
  setQuality(quality: Quality): void;
  resize(width: number, height: number, pixelRatio: number): void;
  update(dt: number): void; // reconcile, animate, render; dt=0 still renders
  dispose(): void;
}
// src/combat/CombatFacade.ts — named export
export class CombatFacade {
  constructor(ctx: GameContext);
  resetRun(): void;
  update(dt: number, input: InputFrame): void;
  dispose(): void;
}
// src/systems/SystemsFacade.ts — named export
export class SystemsFacade {
  constructor(ctx: GameContext);
  resetRun(): void;
  update(dt: number, input: InputFrame): void; // timers, spawn requests, healing requests
  afterCombat(dt: number, input: InputFrame): void; // death, loot, channel, drafts, settlement
  handleAction(action: GameAction): boolean; // returns true only when consumed
  abandonRun(): void;
  dispose(): void;
}
// src/ui/UiFacade.ts — named export
export class UiFacade {
  constructor(ctx: GameContext, options: { root: HTMLElement; onAction: (action: GameAction) => void });
  update(dt: number): void;
  dispose(): void;
}
// src/audio/AudioFacade.ts — named export
export class AudioFacade {
  constructor(ctx: GameContext);
  unlock(): Promise<void>;
  setVolumes(music: number, sfx: number): void;
  setMuted(muted: boolean): void;
  update(dt: number): void;
  dispose(): void;
}
// src/services/ForgeService.ts — named export
export class ForgeService {
  constructor(options: { apiBase: string | null; allowPaid: boolean });
  getAvailability(signal?: AbortSignal): Promise<ForgeAvailability>;
  submit(request: ForgeRequest, signal?: AbortSignal): Promise<ForgeJob>;
  getJob(jobId: string, signal?: AbortSignal): Promise<ForgeJob>;
  cancel(jobId: string): Promise<void>;
  resolveAsset(job: ForgeJob, signal?: AbortSignal): Promise<ValidatedAsset>;
  dispose(): void;
}
// src/services/SaveRepository.ts — named export
export class SaveRepository {
  load(): ProfileState;
  save(profile: ProfileState): { saved: boolean; error: string | null };
  export(profile: ProfileState): string;
  import(json: string): ProfileState;
}
```
- `ForgeAvailability = { mode: 'offline' | 'remote'; enabled: boolean; reason: string | null }`; `ForgeRequest = { requestId: string; recipeId: RelicRecipeId; rank: 1 | 2 | 3; visualSeed: number; customization: string | null; allowPaid: boolean }`.
- `ForgeJob = { id: string; requestId: string; mode: 'offline' | 'remote'; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'; progress: number | null; asset: ValidatedAsset | null; error: { code: string; message: string } | null; createdAt: number; updatedAt: number }`.
- `ValidatedAsset = { kind: 'procedural'; recipeId: RelicRecipeId; seed: number } | { kind: 'glb'; assetId: string; url: string; sha256: string; byteLength: number; triangles: number; materials: number; maxTextureSize: number }`.
- World loads the accepted app-owned GLB URL; asset service validates downloads before this descriptor exists. Offline submit succeeds immediately with a procedural descriptor and no external call.

## 7. UI actions, state ownership and visual synchronization
- `GameAction` is a discriminated union: `start-run {seed:number|null}`, `pause {}`, `resume {}`, `return-hub {}`, `craft {recipeId:RecipeId}`, `choose-buff {draftId:string,buffId:BuffId}`, `buy-draft {chestId:LandmarkId}`, `upgrade-skill {nodeId:SkillNodeId}`, `upgrade-relic {recipeId:RelicRecipeId}`, `equip-relic {recipeId:RelicRecipeId}`, `generate-relic {recipeId:RelicRecipeId,customization:string|null}`, `set-quality {quality:Quality}`, `set-audio {music:number,sfx:number,muted:boolean}`. Each variant uses `type` equal to its name plus the listed fields.
- Main exclusively writes phase/pause reason, creates/replaces run identity, chooses seed, publishes layout, handles start/pause/resume/return/settings/generation actions and coordinates persistence.
- Combat exclusively writes player movement/HP/stamina/Overdrive/invulnerability/last-hit fields, enemies and projectiles. It consumes typed healing/spawn requests synchronously.
- Systems write materials, resources/loot, tool/weapon tier, arrows/bandages, buffs/drafts, clock/threat/beacon, counters, discoveries, blueprints, profile economy and settled result. Combat consumes arrows through a shared documented inventory decrement inside attack resolution; do not also decrement in systems.
- For inventory safety, combat is the sole writer of arrows during attacks; systems is the sole writer during crafting/reset. These operations occur sequentially in the central loop, never in async callbacks.
- Systems settles each run ID once, updates the profile, then emits `run:ended`; main transitions phase and saves the already-settled profile. Abandon clears unbanked rewards and pays no discoveries.
- UI never mutates state directly. Snapshot display uses copied plain values; forms emit actions. Forge completion changes only profile visual metadata in hub through main's validated completion path.
- World keeps `Map<EntityId, visualHandle>` and `Map<ResourceId, visualHandle>` plus instance slots; adds/removes/depletion stages come from shared maps. It never awards loot or changes HP.

## 8. Central loop, timing and composition
- Initialization: load profile →create state/events/RNG/context →create facades once →world title presentation →install main action dispatcher and lifecycle listeners.
- Start: clear input →reset shared state with selected seed/run ID →`state.world = world.resetRun()` →`combat.resetRun()` →`systems.resetRun()` →phase playing →presentation run →emit `run:started`.
- Each playing fixed step at 1/60 s: sample input once →systems.update →combat.update →systems.afterCombat. Then render/UI/audio update once per animation frame.
- Use bounded fixed-step accumulator, at most five steps/frame; consume button edges once across substeps. Clamp unusually large foreground frame gaps rather than fast-forwarding hidden-tab time.
- `systems.afterCombat` resolves lethal HP before extraction/drafts. It accounts for only the valid window portion of a boundary-crossing step, evaluates completion, then expires the beacon.
- Paused/title/hub/dead/extracted: no simulation updates; world/UI/audio receive dt=0 or appropriate decorative presentation time isolated from run clock. Blur clears inputs, pauses and requires explicit resume.
- Pause/draft events route through main phase controller. Opening a modal resets the extraction channel. Draft choices are fixed before pause, and choosing resumes only when no other modal/blur reason remains.
- Game effects may freeze poses/camera briefly but never alter the fixed simulation clock. RNG is seeded; do not call `Math.random()` for gameplay rewards/spawns/drafts.
- Disposal removes subscriptions/listeners, stops audio, aborts client polling and disposes renderer/visual resources; repeated runs reuse facades rather than duplicating listeners.

## 9. Build, testing and definition of done
- Proposed scripts: `dev` Vite, `dev:api` Node server via tsx, `typecheck` browser +Node TS projects, `build` Vite browser build +Node server type/build output, `test:unit` deterministic unit tests, `test:browser` Playwright, `assets:generate` dry-run batch script.
- Browser and Node use separate TS configurations/output; server credentials/provider transport never enter browser imports. Separate browser chunks for Three.js and lazily loaded GLTF/postprocessing/forge UI; avoid unnecessary dynamic-import waterfalls.
- Tailwind v4 uses its Vite plugin and CSS import. Pin dependency versions, commit lockfile when requested, avoid incompatible undocumented build flags.
- Unit coverage: clock/multipliers, channel interruptions/deadline ties, threat cooldown, Overdrive/lifesteal/proc caps, recipes/drafts, skill/relic ranks, save validation and idempotent settlement.
- Browser coverage: title/hub/run lifecycle, keyboard/pointer input, gather/craft, night threats, pause/blur, paid gold draft, extraction/death persistence and fully offline forge. Use test-only deterministic setup hooks, never hidden player cheats in production UI.
- Build/typecheck/unit/browser commands are **proposed, not executed**. Record actual outputs, unresolved failures and performance hardware when implementation exists.
- No engineering harness, special workflow agents/skills or unrelated process artifacts are part of this project. Keep implementation focused on these four specifications and the root guidance file.
