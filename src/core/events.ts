import type { GameEventMap } from '../types/game';

type Listener = (payload: never) => void;

export class GameEvents {
  private readonly listeners = new Map<keyof GameEventMap, Set<Listener>>();
  on<K extends keyof GameEventMap>(name: K, listener: (payload: GameEventMap[K]) => void): () => void {
    const set = this.listeners.get(name) ?? new Set<Listener>();
    const erased: Listener = listener;
    set.add(erased);
    this.listeners.set(name, set);
    return () => { set.delete(erased); };
  }
  emit<K extends keyof GameEventMap>(name: K, payload: GameEventMap[K]): void {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const listener of [...set]) listener(payload as never);
  }
  clear(): void { this.listeners.clear(); }
}
