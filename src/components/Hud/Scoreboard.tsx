import { currentReplayStep, useGameStore } from '../../store/gameStore';
import { WIN_SCORE } from '../../data/constants';

export function Scoreboard() {
  const state = useGameStore((s) => s.state);
  /**
   * 재생 중에는 **그 단계의** 턴·점수를 보여 준다. 스토어의 최종 값을 그대로 띄우면 판은 아직
   * 이동 단계인데 점수판에는 이미 정산이 끝난 숫자가 떠 있게 되고, 그러면 어느 쪽이 지금인지
   * 알 수 없어 재생 자체가 못 믿을 그림이 된다.
   */
  const step = useGameStore(currentReplayStep);
  const replay = useGameStore((s) => s.replay);
  if (!state) return null;

  const turnNumber = step && replay ? replay.turnNumber : state.turnNumber;
  const score = step ? step.score : state.score;
  // 승리는 재생이 끝까지 간 뒤에 알린다 — 마지막 한 방을 보기도 전에 결과부터 뜨면 김이 샌다.
  const winner = step ? null : state.winner;

  return (
    <div className={`scoreboard${step ? ' replaying' : ''}`}>
      <span className="turn">턴 {turnNumber}</span>
      <span className="score-p1">P1 {score.p1}</span>
      <span className="win-score">/ {WIN_SCORE}</span>
      <span className="score-p2">P2 {score.p2}</span>
      {winner && <span className="winner">{winner === 'p1' ? 'Player 1' : 'Player 2'} 승리!</span>}
    </div>
  );
}
