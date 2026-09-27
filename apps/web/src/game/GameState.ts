export type GamePhase = 'courseSelect' | 'aiming' | 'charging' | 'resolving' | 'holeComplete' | 'scorecard' | 'nameEntry' | 'leaderboard';

export interface GameState {
  phase: GamePhase;
  hole: number;
  stroke: number;
  holeStrokes: number[];
  selectedClub: string;
  aimYaw: number;
  power: number;
  accuracy: number;
  distanceToPin: number;
  par: number;
  message?: string;
}

export function initialGameState(): GameState {
  return { phase: 'courseSelect', hole: 1, stroke: 1, holeStrokes: [], selectedClub: 'driver', aimYaw: 0, power: 0, accuracy: 0, distanceToPin: 0, par: 4 };
}
