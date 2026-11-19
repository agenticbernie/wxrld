import type { RunState } from '../types/game';
import type { BALANCE } from '../config/balance';
import type { GameEvents } from './events';
import type { Rng } from './rng';

export type GameContext = { state: RunState; events: GameEvents; balance: typeof BALANCE; rng: Rng };
