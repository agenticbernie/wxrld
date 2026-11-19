import { BALANCE, BUFF_IDS, EMPTY_MATERIALS, RELIC_IDS } from '../config/balance';
import type { GameContext } from '../core/context';
import { distanceXZ } from '../core/math';
import { Rng } from '../core/rng';
import type { BeaconState, BuffDraft, BuffId, EnemyArchetype, Materials, RelicRecipeId, Tier, Vec3, WorldLayout } from '../types/game';

// GDD rules not represented in the frozen BALANCE contract. Keep these explicit
// rather than inferring gameplay tuning from unrelated configuration fields.
export const GDD_RULES = Object.freeze({
  chestRadius: 4, altarRadius: 4, landmarkVisitRadius: 10,
  spawnMinimum: 18, spawnMaximum: 30, spawnAttempts: 96,
  goblinWeight: 60, golemWeight: 25, wyvernWeight: 15,
  initialArrows: 10, initialBandages: 2, arrowBundle: 10,
  cursedNodesPerCore: 3, fieldMedicHealPerRank: 5,
});
export const MATERIAL_KEYS: readonly (keyof Materials)[] = ['wood', 'stone', 'gold', 'soulShards', 'relicCores'];
export const DISCOVERY_IDS: readonly string[] = [
  'enemy:goblin-stalker', 'enemy:stone-golem', 'enemy:blood-wyvern', 'enemy:relic-hunter',
  'landmark:ancient-grove', 'landmark:sunken-shrine', 'landmark:ashen-spire', 'enemy:rootbound-sovereign',
];
export const TIME_EPSILON = 1e-9;
export const POSITION_EPSILON = 1e-5;
export const tierRank = (tier: Tier): number => tier === 'wood' ? 0 : tier === 'stone' ? 1 : 2;
export const finitePosition = (position: Vec3): boolean => Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
export const emptyMaterials = (): Materials => ({ ...EMPTY_MATERIALS });

export function canAfford(materials: Readonly<Materials>, cost: Readonly<Materials>): boolean {
  return MATERIAL_KEYS.every(key => Number.isFinite(materials[key]) && Number.isFinite(cost[key]) && cost[key] >= 0 && materials[key] >= cost[key]);
}
export function spendMaterials(materials: Materials, cost: Readonly<Materials>): void {
  for (const key of MATERIAL_KEYS) materials[key] -= cost[key];
}
export function addMaterials(materials: Materials, addition: Readonly<Materials>): void {
  for (const key of MATERIAL_KEYS) materials[key] += addition[key];
}
export function eligibleBuffs(buffs: Readonly<Record<BuffId, number>>, balance: typeof BALANCE = BALANCE): BuffId[] {
  return BUFF_IDS.filter(id => buffs[id] < balance.buffs[id].maxStacks);
}
export function createDraft(id: string, buffs: Readonly<Record<BuffId, number>>, rng: Rng, paidGold: number, balance: typeof BALANCE = BALANCE): BuffDraft | null {
  const pool = eligibleBuffs(buffs, balance);
  if (pool.length === 0) return null;
  // Partial Fisher-Yates: three distinct, seeded choices without replacement.
  const choices: BuffId[] = [];
  while (pool.length && choices.length < 3) {
    const index = rng.int(0, pool.length);
    const choice = pool.splice(index, 1)[0];
    if (choice !== undefined) choices.push(choice);
  }
  return { id, choices, paidGold };
}
export function normalSpawnArchetype(rng: Rng, wyvernAllowed = true): EnemyArchetype {
  const groundWeight = GDD_RULES.goblinWeight + GDD_RULES.golemWeight;
  const roll = rng.next() * (groundWeight + (wyvernAllowed ? GDD_RULES.wyvernWeight : 0));
  return roll < GDD_RULES.goblinWeight ? 'goblin-stalker' : roll < groundWeight ? 'stone-golem' : 'blood-wyvern';
}
export function validWindowSeconds(start: number, end: number, beacon: Pick<BeaconState, 'opensAt' | 'closesAt'>): number {
  return Math.max(0, Math.min(end, beacon.closesAt) - Math.max(start, beacon.opensAt));
}
export function relicVisualSeed(recipeId: RelicRecipeId, rank: number): number {
  let seed = 2166136261;
  for (const character of `${recipeId}:${rank}`) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  return seed >>> 0;
}
export function nextBlueprint(owned: ReadonlySet<RelicRecipeId>, cursor: number): { blueprint: RelicRecipeId | null; cursor: number } {
  for (let offset = 0; offset < RELIC_IDS.length; offset++) {
    const index = (cursor + offset) % RELIC_IDS.length;
    const blueprint = RELIC_IDS[index];
    if (blueprint !== undefined && !owned.has(blueprint)) return { blueprint, cursor: (index + 1) % RELIC_IDS.length };
  }
  return { blueprint: null, cursor };
}

/** A bounded navigation flood from the island spawn, reused for pads/spawns.
 * Straight-line checks alone reject the intentionally winding graded paths.
 */
export class Reachability {
  private readonly cells = new Set<string>();
  private readonly step: number;
  private readonly origin: Vec3;
  constructor(private readonly world: WorldLayout) {
    this.step = Math.max(2, world.size / 128);
    this.origin = { ...world.playerSpawn };
    if (!finitePosition(this.origin) || !(world.size > 0) || !Number.isFinite(world.size) || !world.isWalkable(this.origin.x, this.origin.z)) return;
    const limit = Math.min(128, Math.ceil(world.size / this.step));
    const queue: { x: number; z: number }[] = [{ x: 0, z: 0 }];
    this.cells.add('0,0');
    for (let head = 0; head < queue.length; head++) {
      const cell = queue[head];
      if (!cell) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const x = cell.x + dx, z = cell.z + dz;
        const key = `${x},${z}`;
        if (Math.abs(x) > limit || Math.abs(z) > limit || this.cells.has(key)) continue;
        const from = this.point(cell.x, cell.z), to = this.point(x, z);
        if (!this.clearSegment(from, to)) continue;
        this.cells.add(key);
        queue.push({ x, z });
      }
    }
  }
  private point(x: number, z: number): Vec3 { return { x: this.origin.x + x * this.step, y: 0, z: this.origin.z + z * this.step }; }
  private clearSegment(from: Vec3, to: Vec3): boolean {
    const samples = Math.max(1, Math.ceil(distanceXZ(from, to) / 0.5));
    for (let index = 0; index <= samples; index++) {
      const fraction = index / samples;
      if (!this.world.isWalkable(from.x + (to.x - from.x) * fraction, from.z + (to.z - from.z) * fraction)) return false;
    }
    return true;
  }
  includes(position: Vec3): boolean {
    if (!finitePosition(position) || !this.world.isWalkable(position.x, position.z)) return false;
    const x = Math.round((position.x - this.origin.x) / this.step), z = Math.round((position.z - this.origin.z) / this.step);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (this.cells.has(`${x + dx},${z + dz}`) && this.clearSegment(position, this.point(x + dx, z + dz))) return true;
    }
    return false;
  }
}

export function findSpawnPosition(ctx: GameContext, reachable: Reachability | null, viewForward: Readonly<Vec3> = { x: 0, y: 0, z: -1 }): Vec3 | null {
  const { state, rng, balance } = ctx;
  const world = state.world;
  if (!world || !reachable || !finitePosition(state.player.position)) return null;
  const viewLength = Math.hypot(viewForward.x, viewForward.z);
  const beacon = state.beacon;
  for (let attempt = 0; attempt < GDD_RULES.spawnAttempts; attempt++) {
    const angle = rng.next() * Math.PI * 2;
    const radius = GDD_RULES.spawnMinimum + rng.next() * (GDD_RULES.spawnMaximum - GDD_RULES.spawnMinimum);
    const dx = Math.cos(angle) * radius, dz = Math.sin(angle) * radius;
    // The run camera trails on +Z and looks toward -Z, independently of mouse
    // aim/player facing. Exclude its front 120-degree sector. Tests/integrators
    // may supply a different plain-data heading without importing rendering.
    if (viewLength > POSITION_EPSILON && (dx * viewForward.x + dz * viewForward.z) / (radius * viewLength) > 0.5) continue;
    const x = state.player.position.x + dx, z = state.player.position.z + dz;
    const position = { x, y: world.heightAt(x, z), z };
    if (!finitePosition(position) || !reachable.includes(position)) continue;
    if (beacon && state.elapsedSeconds >= beacon.opensAt - TIME_EPSILON && state.elapsedSeconds <= beacon.closesAt + TIME_EPSILON && distanceXZ(position, beacon.position) <= balance.extraction.radius) continue;
    if ([...state.enemies.values()].some(enemy => enemy.hp > 0 && enemy.mode !== 'dead' && distanceXZ(position, enemy.position) < 2)) continue;
    return position;
  }
  return null;
}
