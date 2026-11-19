import type { ActorArchetype, Vec3, WorldLayout } from '../types/game';

/** First intersection of a swept XZ segment with a circle, including initial overlap. */
export function segmentCircleHit(start: Vec3, end: Vec3, center: Vec3, radius: number): number | null {
  const dx = end.x - start.x, dz = end.z - start.z;
  const ox = start.x - center.x, oz = start.z - center.z;
  const c = ox * ox + oz * oz - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dz * dz;
  if (a < 1e-12) return null;
  const b = 2 * (ox * dx + oz * dz);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

export function inMeleeArc(origin: Vec3, facing: Vec3, target: Vec3, reach: number, arc: number): boolean {
  const dx = target.x - origin.x, dz = target.z - origin.z;
  const length = Math.hypot(dx, dz);
  if (length > reach) return false;
  if (length < 1e-8) return true;
  const facingLength = Math.hypot(facing.x, facing.z);
  if (facingLength < 1e-8) return false;
  return (dx * facing.x + dz * facing.z) / (length * facingLength) >= Math.cos(arc / 2) - 1e-10;
}

export function rotateXZ(direction: Vec3, radians: number): Vec3 {
  const cos = Math.cos(radians), sin = Math.sin(radians);
  return { x: direction.x * cos - direction.z * sin, y: 0, z: direction.x * sin + direction.z * cos };
}

export function actorRadius(archetype: ActorArchetype): number {
  switch (archetype) {
    case 'rootbound-sovereign': return 1.8;
    case 'stone-golem': return 0.9;
    case 'blood-wyvern': return 0.8;
    case 'relic-hunter': return 0.6;
    case 'goblin-stalker': return 0.5;
  }
}

/** Sample the path, not just the destination, so a dash cannot tunnel across water. */
export function moveOnGround(position: Vec3, dx: number, dz: number, world: WorldLayout, hover = 0): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.2));
  const sx = dx / steps, sz = dz / steps;
  for (let step = 0; step < steps; step++) {
    const x = position.x + sx, z = position.z + sz;
    if (world.isWalkable(x, z)) {
      position.x = x; position.z = z;
    } else if (Math.abs(sx) >= Math.abs(sz)) {
      if (world.isWalkable(x, position.z)) position.x = x;
      else if (world.isWalkable(position.x, z)) position.z = z;
    } else {
      if (world.isWalkable(position.x, z)) position.z = z;
      else if (world.isWalkable(x, position.z)) position.x = x;
    }
  }
  position.y = world.heightAt(position.x, position.z) + hover;
}

export function finitePosition(position: Vec3): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}
