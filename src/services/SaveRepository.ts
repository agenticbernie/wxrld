import { createProfile } from '../core/state';
import { RELIC_IDS, SKILL_IDS } from '../config/balance';
import type { ProfileState, RelicRecipeId, ValidatedAsset } from '../types/game';

export const SAVE_KEY = 'wxrld.profile.v1';
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, maximum: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum;
const strings = (value: unknown, maximum: number): value is string[] => Array.isArray(value) && value.length <= maximum && value.every(item => typeof item === 'string' && item.length <= 160);
const recipe = (value: unknown): value is RelicRecipeId => typeof value === 'string' && RELIC_IDS.some(id => id === value);

export function validateAsset(value: unknown): ValidatedAsset {
  if (!record(value)) throw new Error('Invalid relic appearance.');
  if (value.kind === 'procedural' && recipe(value.recipeId) && integer(value.seed, 4294967295)) return { kind: 'procedural', recipeId: value.recipeId, seed: value.seed };
  if (value.kind === 'glb' && typeof value.assetId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value.assetId) && typeof value.url === 'string' && /^\/(?:api\/forge\/assets|assets\/generated)\/[a-zA-Z0-9_./-]+$/.test(value.url) && !value.url.includes('..') && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256) && integer(value.byteLength, 15 * 1024 * 1024) && integer(value.triangles, 50000) && integer(value.materials, 6) && integer(value.maxTextureSize, 2048)) {
    return { kind: 'glb', assetId: value.assetId, url: value.url, sha256: value.sha256, byteLength: value.byteLength, triangles: value.triangles, materials: value.materials, maxTextureSize: value.maxTextureSize };
  }
  throw new Error('Relic appearance is outside the accepted asset budget.');
}
export function validateProfile(value: unknown): ProfileState {
  if (!record(value) || value.version !== 1 || !integer(value.soulShards, 10000000) || !integer(value.relicCores, 100000) || !record(value.skills) || !record(value.relicRanks) || !strings(value.blueprints, 3) || !strings(value.discoveries, 8) || !strings(value.settledRunIds, 256)) throw new Error('Save data is invalid or uses an unsupported version.');
  const profile = createProfile();
  profile.soulShards = value.soulShards;
  profile.relicCores = value.relicCores;
  for (const id of SKILL_IDS) {
    const rank = value.skills[id];
    if (rank !== 0 && rank !== 1 && rank !== 2 && rank !== 3) throw new Error(`Invalid skill rank: ${id}.`);
    profile.skills[id] = rank;
  }
  for (const id of RELIC_IDS) {
    const rank = value.relicRanks[id];
    if (rank !== 0 && rank !== 1 && rank !== 2 && rank !== 3) throw new Error(`Invalid relic rank: ${id}.`);
    profile.relicRanks[id] = rank;
  }
  for (const id of value.blueprints) { if (!recipe(id)) throw new Error('Unknown blueprint.'); if (!profile.blueprints.includes(id)) profile.blueprints.push(id); }
  if (value.equippedRelic !== null && !recipe(value.equippedRelic)) throw new Error('Unknown equipped relic.');
  profile.equippedRelic = value.equippedRelic;
  if (profile.equippedRelic && (!profile.blueprints.includes(profile.equippedRelic) || profile.relicRanks[profile.equippedRelic] === 0)) throw new Error('Equipped relic is not unlocked.');
  if (record(value.relicVisuals)) for (const id of RELIC_IDS) if (value.relicVisuals[id] !== undefined) profile.relicVisuals[id] = validateAsset(value.relicVisuals[id]);
  profile.discoveries = [...new Set(value.discoveries)];
  profile.settledRunIds = [...new Set(value.settledRunIds)];
  return profile;
}

export class SaveRepository {
  lastError: string | null = null;
  constructor(private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>) {}
  private getStorage(): Pick<Storage, 'getItem' | 'setItem'> { return this.storage ?? window.localStorage; }
  load(): ProfileState {
    this.lastError = null;
    try { const text = this.getStorage().getItem(SAVE_KEY); return text ? this.import(text) : createProfile(); }
    catch (error) { this.lastError = error instanceof Error ? error.message : 'Local save is unavailable.'; return createProfile(); }
  }
  save(profile: ProfileState): { saved: boolean; error: string | null } {
    try { this.getStorage().setItem(SAVE_KEY, this.export(profile)); this.lastError = null; return { saved: true, error: null }; }
    catch (error) { this.lastError = error instanceof Error ? error.message : 'Local save is unavailable.'; return { saved: false, error: this.lastError }; }
  }
  export(profile: ProfileState): string { return JSON.stringify(validateProfile(profile)); }
  import(json: string): ProfileState {
    if (json.length > 131072) throw new Error('Save data is too large.');
    const value: unknown = JSON.parse(json);
    return validateProfile(value);
  }
}
