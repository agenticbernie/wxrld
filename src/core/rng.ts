export class Rng {
  private seed: number;
  constructor(seed: number) { this.seed = seed >>> 0 || 0x9e3779b9; }
  reset(seed: number): void { this.seed = seed >>> 0 || 0x9e3779b9; }
  next(): number {
    let value = this.seed;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.seed = value >>> 0;
    return this.seed / 4294967296;
  }
  int(min: number, maxExclusive: number): number {
    if (maxExclusive <= min) throw new RangeError('Random integer range must be nonempty.');
    return min + Math.floor(this.next() * (maxExclusive - min));
  }
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Cannot choose from an empty collection.');
    const value = items[this.int(0, items.length)];
    if (value === undefined) throw new RangeError('Random collection item is unavailable.');
    return value;
  }
}
