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
    // 매 턴 반드시 누르는 버튼이라 단축키를 버튼에 적어 둔다 — 도움말에만 적으면 아무도 못 찾는다.
    <button onClick={resolve} className="btn-primary" style={{ padding: '8px 20px' }} title="단축키: Space 또는 Enter">
      공개 및 해결 <span className="key-hint">Space</span>
    </button>
  );
}
