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

  /**
   * **이 게임에서 이기고 있는지 알려 주는 유일한 숫자다.** 그런데 예전에는 `P1 0 / 15 P2 0`이
   * 한 줄짜리 14px 평문이라, 화면에서 가장 안 보이는 것이 하필 승패였다. 게다가 「0 / 15」는
   * 머릿속에서 나눗셈을 해야 얼마나 남았는지 알 수 있다 — 점령전은 매 턴 1~2점씩 올라가는
   * 게임이라 "얼마나 남았나"가 다음 수를 정한다.
   *
   * 그래서 숫자를 키우고 팀색 칩으로 감싼 뒤, 밑에 목표까지의 막대를 깐다. 나눗셈 없이 두 막대의
   * 길이 차이로 형세가 읽힌다. 막대 길이는 `WIN_SCORE`에서 계산하므로 목표 점수를 바꿔도
   * 여기는 손댈 것이 없다.
   */
  return (
    <div className={`scoreboard${step ? ' replaying' : ''}`}>
      <span className="turn">턴 {turnNumber}</span>
      {(['p1', 'p2'] as const).map((owner) => (
        <span key={owner} className={`score-chip score-${owner}`}>
          <span className="score-chip-head">
            <span className="score-chip-label">{owner === 'p1' ? 'P1' : 'P2'}</span>
            <span className="score-chip-value">{score[owner]}</span>
          </span>
          <span className="score-chip-track">
            <span
              className="score-chip-fill"
              style={{ width: `${Math.min(100, (score[owner] / WIN_SCORE) * 100)}%` }}
            />
          </span>
        </span>
      ))}
      <span className="win-score">{WIN_SCORE}점 선취</span>
      {winner && <span className="winner">{winner === 'p1' ? 'Player 1' : 'Player 2'} 승리!</span>}
    </div>
  );
}
