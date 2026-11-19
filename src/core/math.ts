import type { Vec3 } from '../types/game';

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, value: number): number => { const t = clamp((value - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const distanceSquared = (a: Vec3, b: Vec3): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
export const distance = (a: Vec3, b: Vec3): number => Math.sqrt(distanceSquared(a, b));
export const distanceXZ = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);
export const normalizeXZ = (x: number, z: number): Vec3 => { const length = Math.hypot(x, z); return length > 0.0001 ? { x: x / length, y: 0, z: z / length } : { x: 0, y: 0, z: 1 }; };
export const copyVec3 = (value: Vec3): Vec3 => ({ x: value.x, y: value.y, z: value.z });
export function segmentDistanceXZ(point: Vec3, start: Vec3, end: Vec3): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const denominator = dx * dx + dz * dz;
  const t = denominator > 0 ? clamp(((point.x - start.x) * dx + (point.z - start.z) * dz) / denominator, 0, 1) : 0;
  return Math.hypot(point.x - start.x - t * dx, point.z - start.z - t * dz);
}
