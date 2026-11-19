import type { GameAction, InputFrame, RunState } from './game';
import type { WorldDiagnostics } from '../world/WorldFacade';

export type WxrldDebug = {
  state: RunState;
  action: (action: GameAction) => void;
  step: (seconds: number, input?: InputFrame, simulateCombat?: boolean) => void;
  diagnostics: () => WorldDiagnostics;
};

declare global {
  interface Window { __WXRLD__?: WxrldDebug }
}
