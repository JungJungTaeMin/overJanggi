import { useGameStore } from '../../store/gameStore';

export function TurnControls() {
  const state = useGameStore((s) => s.state);
  const resolve = useGameStore((s) => s.resolve);
  const resetGame = useGameStore((s) => s.resetGame);
  if (!state) return null;

  if (state.phase === 'gameOver') {
    return (
      <button onClick={resetGame} className="btn-primary" style={{ padding: '8px 20px' }}>
        새 게임
      </button>
    );
  }

  return (
    <button onClick={resolve} className="btn-primary" style={{ padding: '8px 20px' }}>
      공개 및 해결
    </button>
  );
}
