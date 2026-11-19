import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile } from '../src/core/state';
import { SaveRepository, SAVE_KEY } from '../src/services/SaveRepository';
import { ForgeService, proceduralJob } from '../src/services/ForgeService';
import { inspectGlb } from '../server/asset-validator';
import type { ForgeRequest } from '../src/types/game';

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}
const request: ForgeRequest = { requestId: 'test-preview', recipeId: 'rootheart', rank: 1, visualSeed: 55, customization: null, allowPaid: false };

test('profile save round-trips independently from active run state', () => {
  const storage = new MemoryStorage(); const repository = new SaveRepository(storage); const profile = createProfile();
  profile.soulShards = 42; profile.skills.vitality = 2;
  assert.equal(repository.save(profile).saved, true);
  assert.equal(repository.load().soulShards, 42); assert.equal(repository.load().skills.vitality, 2);
  assert.equal(storage.values.get(SAVE_KEY)?.includes('elapsedSeconds'), false);
});
test('save validation rejects unknown versions, rank overflow, and unearned equipped relics', () => {
  const repository = new SaveRepository(new MemoryStorage());
  const profile = createProfile();
  assert.throws(() => repository.import(JSON.stringify({ ...profile, version: 2 })), /unsupported version/);
  assert.throws(() => repository.import(JSON.stringify({ ...profile, soulShards: -1 })), /invalid/);
  assert.throws(() => repository.import(JSON.stringify({ ...profile, skills: { ...profile.skills, vitality: 9 } })), /rank/);
  assert.throws(() => repository.import(JSON.stringify({ ...profile, equippedRelic: 'rootheart' })), /unlocked/);
  assert.throws(() => repository.import(JSON.stringify({ ...profile, relicVisuals: { rootheart: { kind: 'glb', url: 'http://127.0.0.1/secrets' } } })), /asset budget/);
});
test('blocked storage returns a recoverable unsaved result and fresh usable profile', () => {
  const repository = new SaveRepository({ getItem: () => { throw new Error('Storage disabled'); }, setItem: () => { throw new Error('Quota exceeded'); } });
  assert.equal(repository.load().soulShards, 0); assert.match(repository.lastError ?? '', /Storage disabled/);
  assert.equal(repository.save(createProfile()).saved, false);
  assert.match(repository.lastError ?? '', /Quota exceeded/);
});
test('offline forging has deterministic visuals and idempotent request IDs without fetching', async () => {
  const service = new ForgeService({ apiBase: null, allowPaid: false });
  const availability = await service.getAvailability(); assert.equal(availability.mode, 'offline');
  const a = await service.submit(request); const b = await service.submit(request);
  assert.equal(a, b); assert.equal(a.mode, 'offline'); assert.equal(a.status, 'succeeded');
  assert.deepEqual(await service.resolveAsset(a), { kind: 'procedural', recipeId: 'rootheart', seed: 55 });
  assert.equal((await service.getJob(a.id)).id, a.id);
  await assert.rejects(service.submit({ ...request, requestId: 'paid-test', allowPaid: true }), /disabled/);
  service.dispose();
  await assert.rejects(service.submit({ ...request, requestId: 'late-test' }), /disposed/);
});
test('forge requests reject URL-bearing customization and invalid seed/rank', () => {
  assert.throws(() => proceduralJob({ ...request, customization: 'https://example.invalid/private' }), /Invalid/);
  assert.throws(() => proceduralJob({ ...request, visualSeed: -1 }), /Invalid/);
  assert.throws(() => proceduralJob({ ...request, requestId: '../../escape' }), /Invalid/);
});
test('GLB inspection rejects malformed headers, oversized files and external resources', () => {
  assert.throws(() => inspectGlb(new Uint8Array(10)), /size/);
  assert.throws(() => inspectGlb(new Uint8Array(25)), /header/);
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'https://example.invalid/mesh.bin' }] }));
  const length = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(20 + length); bytes.fill(32, 20);
  const view = new DataView(bytes.buffer); view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true); view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true); bytes.set(json, 20);
  assert.throws(() => inspectGlb(bytes), /self-contained/);
});
