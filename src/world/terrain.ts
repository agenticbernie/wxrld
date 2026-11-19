import { BufferAttribute, BufferGeometry, Color, DataTexture, FloatType, RedFormat, LinearFilter } from 'three';
import { BALANCE } from '../config/balance';
import { Rng } from '../core/rng';
import type { LandmarkId, ResourceKind, WorldLayout } from '../types/game';

export const ISLAND_SIZE = 180;
export const WATER_LEVEL = 0.4;
const GRID = 128;
const HALF = ISLAND_SIZE / 2;
const STEP = ISLAND_SIZE / GRID;
const smooth = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function hash(x: number, z: number, seed: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n >>> 0) / 4294967295;
}
export function noise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), u = smooth(0, 1, x - ix), v = smooth(0, 1, z - iz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
}
const PLATEAUS: readonly { id: LandmarkId; x: number; z: number; h: number }[] = [
  { id: 'ancient-grove', x: -37, z: -12, h: 6.4 },
  { id: 'sunken-shrine', x: 39, z: 21, h: 3.4 },
  { id: 'ashen-spire', x: 7, z: -48, h: 12.5 },
];
const SPAWN = { x: 0, z: 25, h: 5.2 };

export type TerrainBundle = { layout: WorldLayout; geometry: BufferGeometry; heightTexture: DataTexture };

/** Navigation samples the exact triangles submitted to the GPU, not unrelated noise. */
export function createTerrain(seed: number): TerrainBundle {
  const heights = new Float32Array((GRID + 1) ** 2);
  const positions = new Float32Array(heights.length * 3);
  const colors = new Float32Array(heights.length * 3);
  const uvs = new Float32Array(heights.length * 2);
  function rawHeight(x: number, z: number): number {
    const coast = 77 + (noise(x * 0.032, z * 0.032, seed) - 0.5) * 13;
    const radial = Math.hypot(x * 0.98, z);
    const continental = 1 - smooth(coast - 21, coast + 2, radial);
    const n = noise(x * 0.038, z * 0.038, seed) * 5 + noise(x * 0.09, z * 0.09, seed + 7) * 2.5;
    const peaks = Math.exp(-((x - 18) ** 2 / 700 + (z + 57) ** 2 / 400)) * (22 + noise(x * 0.12, z * 0.12, seed + 91) * 15);
    const moss = Math.exp(-((x + 40) ** 2 / 1000 + (z + 25) ** 2 / 700)) * 8;
    let h = -3 + continental * (7 + n + peaks + moss);
    // Deliberate graded paths and twelve-metre-radius level extraction clearings.
    for (const p of PLATEAUS) {
      const distance = segmentDistance(x, z, SPAWN.x, SPAWN.z, p.x, p.z);
      const along = Math.max(0, Math.min(1, ((x - SPAWN.x) * (p.x - SPAWN.x) + (z - SPAWN.z) * (p.z - SPAWN.z)) / ((p.x - SPAWN.x) ** 2 + (p.z - SPAWN.z) ** 2)));
      const path = SPAWN.h + (p.h - SPAWN.h) * smooth(0, 1, along);
      h += (path - h) * (1 - smooth(3.2, 7.5, distance));
      h += (p.h - h) * (1 - smooth(12.8, 18.5, Math.hypot(x - p.x, z - p.z)));
    }
    h += (SPAWN.h - h) * (1 - smooth(9, 15, Math.hypot(x - SPAWN.x, z - SPAWN.z)));
    return h;
  }
  for (let z = 0; z <= GRID; z++) for (let x = 0; x <= GRID; x++) {
    const i = z * (GRID + 1) + x, wx = x * STEP - HALF, wz = z * STEP - HALF;
    heights[i] = rawHeight(wx, wz);
    positions.set([wx, heights[i] ?? 0, wz], i * 3);
    uvs.set([x / GRID, z / GRID], i * 2);
  }
  const indices: number[] = [];
  for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
    const a = z * (GRID + 1) + x, b = a + 1, c = a + GRID + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  const sand = new Color('#b4a07a'), meadow = new Color('#657a47'), moss = new Color('#3c5740'), stone = new Color('#6a7170'), basalt = new Color('#363d42');
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i] ?? 0, x = positions[i * 3] ?? 0, z = positions[i * 3 + 2] ?? 0;
    const c = sand.clone().lerp(meadow, smooth(1.8, 5, h)).lerp(moss, smooth(7, 16, h) * 0.7);
    c.lerp(stone, smooth(0.18, 0.5, 1 - normals.getY(i)));
    c.lerp(basalt, smooth(18, 27, h));
    const routeDistance = Math.min(...PLATEAUS.map(p => segmentDistance(x, z, SPAWN.x, SPAWN.z, p.x, p.z)));
    c.lerp(sand, (1 - smooth(1.1, 3.2, routeDistance)) * 0.28);
    if (h < 1.5) c.multiplyScalar(0.72 + smooth(WATER_LEVEL, 1.5, h) * 0.28);
    c.multiplyScalar(0.87 + noise(x * 0.4, z * 0.4, seed + 14) * 0.22);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  const heightAt = (x: number, z: number): number => {
    const gx = Math.max(0, Math.min(GRID - 0.000001, (x + HALF) / STEP));
    const gz = Math.max(0, Math.min(GRID - 0.000001, (z + HALF) / STEP));
    const ix = Math.floor(gx), iz = Math.floor(gz), u = gx - ix, v = gz - iz;
    const i = iz * (GRID + 1) + ix;
    const a = heights[i] ?? 0, b = heights[i + 1] ?? 0, c = heights[i + GRID + 1] ?? 0, d = heights[i + GRID + 2] ?? 0;
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  };
  const isWalkable = (x: number, z: number): boolean => {
    if (Math.abs(x) >= HALF - 2 || Math.abs(z) >= HALF - 2 || heightAt(x, z) < WATER_LEVEL + 0.65) return false;
    const dx = (heightAt(x + 0.6, z) - heightAt(x - 0.6, z)) / 1.2;
    const dz = (heightAt(x, z + 0.6) - heightAt(x, z - 0.6)) / 1.2;
    return Math.hypot(dx, dz) < 0.78;
  };
  // Flood-fill the navigation grid so random nodes never land in isolated walkable pockets.
  const accessible = new Uint8Array((GRID + 1) ** 2);
  const startX = Math.round((SPAWN.x + HALF) / STEP), startZ = Math.round((SPAWN.z + HALF) / STEP);
  const queue = [startZ * (GRID + 1) + startX]; accessible[queue[0] ?? 0] = 1;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const index = queue[cursor] ?? 0, ix = index % (GRID + 1), iz = Math.floor(index / (GRID + 1));
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = ix + dx, nz = iz + dz, next = nz * (GRID + 1) + nx;
      if (nx < 0 || nz < 0 || nx > GRID || nz > GRID || accessible[next] || !isWalkable(nx * STEP - HALF, nz * STEP - HALF)) continue;
      accessible[next] = 1; queue.push(next);
    }
  }
  const isReachable = (x: number, z: number): boolean => {
    if (!isWalkable(x, z)) return false;
    const ix = Math.round((x + HALF) / STEP), iz = Math.round((z + HALF) / STEP);
    if (!accessible[iz * (GRID + 1) + ix]) return false;
    for (let j = 1; j <= 3; j++) {
      const t = j / 3;
      if (!isWalkable(x + (ix * STEP - HALF - x) * t, z + (iz * STEP - HALF - z) * t)) return false;
    }
    return true;
  };
  const rng = new Rng(seed ^ 0x627e4f31);
  const nodes: { id: string; kind: ResourceKind; position: { x: number; y: number; z: number } }[] = [];
  const addNode = (kind: ResourceKind, x: number, z: number): void => { nodes.push({ id: `${kind}-${nodes.filter(n => n.kind === kind).length}`, kind, position: { x, y: heightAt(x, z), z } }); };
  // Enough guaranteed wood and stone for the first upgrades within a short walk.
  addNode('tree', -5.4, 25); addNode('tree', -8, 29); addNode('tree', 5.8, 28);
  addNode('stone', 4.4, 21.5); addNode('stone', 7.2, 20);
  for (const kind of ['tree', 'stone', 'gold', 'cursed'] as const) {
    let attempts = 0;
    while (nodes.filter(n => n.kind === kind).length < BALANCE.resources[kind].count && attempts++ < 12000) {
      const x = (rng.next() - 0.5) * 132, z = (rng.next() - 0.5) * 132;
      if (!isReachable(x, z) || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 11) continue;
      if (PLATEAUS.some(p => Math.hypot(x - p.x, z - p.z) < 13)) continue;
      if (nodes.some(n => Math.hypot(x - n.position.x, z - n.position.z) < 4)) continue;
      if (kind === 'cursed' && z > 5) continue;
      addNode(kind, x, z);
    }
    if (nodes.filter(n => n.kind === kind).length !== BALANCE.resources[kind].count) throw new Error(`Island seed ${seed} cannot place ${kind} resources.`);
  }
  const heightTexture = new DataTexture(heights, GRID + 1, GRID + 1, RedFormat, FloatType);
  heightTexture.minFilter = LinearFilter;
  heightTexture.magFilter = LinearFilter;
  heightTexture.needsUpdate = true;
  const layout: WorldLayout = {
    seed, size: ISLAND_SIZE,
    playerSpawn: { x: SPAWN.x, y: heightAt(SPAWN.x, SPAWN.z), z: SPAWN.z },
    landmarks: PLATEAUS.map(p => ({ id: p.id, position: { x: p.x, y: heightAt(p.x, p.z), z: p.z } })),
    nodes, heightAt, isWalkable,
  };
  return { layout, geometry, heightTexture };
}

export function inClearing(layout: WorldLayout, x: number, z: number, radius = 14): boolean {
  return layout.landmarks.some(p => Math.hypot(p.position.x - x, p.position.z - z) < radius) || Math.hypot(layout.playerSpawn.x - x, layout.playerSpawn.z - z) < 10;
}
