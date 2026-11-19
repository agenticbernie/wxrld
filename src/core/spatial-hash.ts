import type { Vec3 } from '../types/game';

export class SpatialHash<T extends string> {
  private readonly cells = new Map<string, Set<T>>();
  private readonly entries = new Map<T, { key: string; x: number; z: number }>();
  constructor(private readonly cellSize: number) {
    if (!(cellSize > 0)) throw new RangeError('Spatial hash cells must have positive size.');
  }
  private key(x: number, z: number): string { return `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`; }
  set(id: T, position: Vec3): void {
    const key = this.key(position.x, position.z);
    const previous = this.entries.get(id);
    if (previous?.key !== key) {
      this.remove(id);
      const cell = this.cells.get(key) ?? new Set<T>();
      cell.add(id);
      this.cells.set(key, cell);
    }
    this.entries.set(id, { key, x: position.x, z: position.z });
  }
  remove(id: T): void {
    const previous = this.entries.get(id);
    if (!previous) return;
    const cell = this.cells.get(previous.key);
    cell?.delete(id);
    if (cell?.size === 0) this.cells.delete(previous.key);
    this.entries.delete(id);
  }
  query(position: Vec3, radius: number): T[] {
    const result: T[] = [];
    const radiusSquared = radius * radius;
    const minX = Math.floor((position.x - radius) / this.cellSize);
    const maxX = Math.floor((position.x + radius) / this.cellSize);
    const minZ = Math.floor((position.z - radius) / this.cellSize);
    const maxZ = Math.floor((position.z + radius) / this.cellSize);
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      for (const id of this.cells.get(`${x},${z}`) ?? []) {
        const entry = this.entries.get(id);
        if (entry && (entry.x - position.x) ** 2 + (entry.z - position.z) ** 2 <= radiusSquared) result.push(id);
      }
    }
    return result;
  }
  clear(): void { this.cells.clear(); this.entries.clear(); }
}
