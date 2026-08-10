import { useGameStore } from '../../store/gameStore';
import { WIN_SCORE } from '../../data/constants';

export function Scoreboard() {
  const state = useGameStore((s) => s.state);
  if (!state) return null;

  return (
    <div className="scoreboard">
      <span className="turn">턴 {state.turnNumber}</span>
      <span className="score-p1">P1 {state.score.p1}</span>
      <span className="win-score">/ {WIN_SCORE}</span>
      <span className="score-p2">P2 {state.score.p2}</span>
      {state.winner && <span className="winner">{state.winner === 'p1' ? 'Player 1' : 'Player 2'} 승리!</span>}
    </div>
  );
}
