import { useGameStore } from '../../store/gameStore';
import { REPLAY_PHASE_LABEL } from './resolutionMarkers';
import { PHASE_NAME } from '../phaseLabels';

/**
 * **지금 판 위에서 무엇이 굴러가고 있는지.**
 *
 * 단계별 재생은 화면이 스스로 움직인다 — 사용자가 아무것도 안 했는데 기물이 옮겨 다니고 숫자가
 * 뜬다. 그래서 "지금 몇 단계이고, 몇 개 중 몇 번째이며, 멈추려면 무엇을 누르는가"가 판 옆에
 * 반드시 있어야 한다. 없으면 재생은 기능이 아니라 **화면이 멋대로 구는 것**으로 보인다.
 *
 * 단계 이름은 눌러서 그리로 갈 수 있게 둔다. 지나간 공격 단계를 다시 보려고 턴 전체를 처음부터
 * 재생하게 만들 이유가 없다.
 */
export function PlaybackBar({ summary }: { summary: string }) {
  const replay = useGameStore((s) => s.replay);
  const index = useGameStore((s) => s.replayIndex);
  const playing = useGameStore((s) => s.replayPlaying);
  const paused = useGameStore((s) => s.replayPaused);
  const enabled = useGameStore((s) => s.playbackEnabled);
  const stopReplay = useGameStore((s) => s.stopReplay);
  const restartReplay = useGameStore((s) => s.restartReplay);
  const seekReplay = useGameStore((s) => s.seekReplay);
  const togglePauseReplay = useGameStore((s) => s.togglePauseReplay);
  const setPlaybackEnabled = useGameStore((s) => s.setPlaybackEnabled);

  const steps = replay?.steps ?? [];
  const hasReplay = steps.length > 1;

  return (
    <div className={`playback-bar${playing ? ' playing' : ''}`}>
      <label className="playback-toggle" title="끄면 지금까지처럼 턴 결과가 한 번에 나타납니다.">
        <input type="checkbox" checked={enabled} onChange={(e) => setPlaybackEnabled(e.target.checked)} />
        단계별 재생
      </label>

      {hasReplay ? (
        <>
          <div className="playback-steps">
            {steps.map((step, i) => (
              <button
                key={`${step.phase}-${i}`}
                type="button"
                className={`playback-step${playing && i === index ? ' current' : ''}${playing && i < index ? ' done' : ''}`}
                onClick={() => seekReplay(i)}
              >
                {REPLAY_PHASE_LABEL[step.phase]}
              </button>
            ))}
          </div>
          {playing ? (
            <>
              {/* 재생 중에만 한 줄 요약을 띄운다 — 끝난 뒤에도 남으면 지금 판의 설명으로 오해된다. */}
              <span className="playback-summary">{summary}</span>
              <button type="button" className="btn-secondary btn-tiny" onClick={togglePauseReplay}>
                {paused ? '재생' : '멈춤'}
              </button>
              <button type="button" className="btn-secondary btn-tiny" onClick={stopReplay}>
                건너뛰기
              </button>
            </>
          ) : (
            <button type="button" className="btn-secondary btn-tiny" onClick={restartReplay}>
              다시 보기
            </button>
          )}
        </>
      ) : (
        // 단계 이름이 데이터에서 오므로 뒤에 조사를 붙이지 않는다 — "회복를"이 나온다.
        <span className="muted playback-idle">
          턴을 넘기면 {PHASE_NAME.movement} · {PHASE_NAME.preAttack} · {PHASE_NAME.attack} · {PHASE_NAME.heal} 순서로
          차례차례 보여 줍니다.
        </span>
      )}
    </div>
  );
}
