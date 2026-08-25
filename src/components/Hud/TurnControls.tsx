import type { ActionPlan, Owner } from '../../engine/types';
import { useGameStore } from '../../store/gameStore';

export function TurnControls() {
  const state = useGameStore((s) => s.state);
  const plans = useGameStore((s) => s.plans);
  const mode = useGameStore((s) => s.mode);
  const localOwner = useGameStore((s) => s.localOwner);
  const resolve = useGameStore((s) => s.resolve);
  const resetGame = useGameStore((s) => s.resetGame);
  // 재생 중에는 턴을 넘길 수 없다 — 지나간 판을 보는 동안 눌리면 다음 턴이 빈 계획으로 해결된다.
  const replayPlaying = useGameStore((s) => s.replayPlaying);
  if (!state) return null;

  if (state.phase === 'gameOver' && !replayPlaying) {
    return (
      <button onClick={resetGame} className="btn-primary" style={{ padding: '8px 20px' }}>
        새 게임
      </button>
    );
  }

  const progress = planProgress(plans, mode === 'local' ? ['p1', 'p2'] : [localOwner]);
  const allIdle = progress !== null && progress.done === 0;

  return (
    <div className="turn-controls">
      {/**
       * **몇 기물에 지시를 내렸는지.** 「대기」도 정당한 선택이라 막을 수는 없지만, 실제로 해 보면
       * 막히는 쪽은 결심이 아니라 **깜빡함**이다 — 한 기물만 만지고 Space를 눌러 나머지 넷을 통째로
       * 놀린 턴이 여러 번 나왔다. 한 번 해결하면 되돌릴 수 없으니 누르기 **전에** 보여야 한다.
       * 그래서 막지 않고 세기만 한다.
       */}
      {progress && (
        <span className={`plan-progress${allIdle ? ' idle' : ''}`} title="이번 턴에 행동을 지정한 기물 수입니다. 「대기」도 선택이므로 막지는 않습니다.">
          {progress.done}/{progress.total} 지정
        </span>
      )}
      {/* 매 턴 반드시 누르는 버튼이라 단축키를 버튼에 적어 둔다 — 도움말에만 적으면 아무도 못 찾는다. */}
      <button
        onClick={resolve}
        disabled={replayPlaying}
        className="btn-primary"
        style={{ padding: '8px 20px' }}
        title={replayPlaying ? '해결 과정을 보여 주는 중입니다.' : '단축키: Space 또는 Enter'}
      >
        {replayPlaying ? '해결 중…' : <>공개 및 해결 <span className="key-hint">Space</span></>}
      </button>
    </div>
  );
}

/**
 * 내가 조종하는 쪽의 계획 진행도. 온라인·AI 대전에서는 내 기물만 센다 — 상대 계획은 볼 수 없고,
 * 볼 수 없는 것을 진행도에 넣으면 숫자가 영영 안 차는 것처럼 보인다.
 *
 * "지정했다"의 기준은 **엔진이 이번 턴 무언가를 하게 되는가**다: 기본 행동을 잡았거나(이동·공격),
 * 기술을 걸었거나, 기술 이동을 넣었거나. 셋 다 비어 있으면 그 기물은 이번 턴 아무것도 하지 않는다.
 */
function planProgress(
  plans: Record<Owner, ActionPlan> | null,
  owners: Owner[],
): { done: number; total: number } | null {
  if (!plans) return null;
  let done = 0;
  let total = 0;
  for (const owner of owners) {
    for (const plan of Object.values(plans[owner].actions)) {
      total += 1;
      if (plan.baseAction.kind !== 'none' || plan.skillUse || plan.skillMove) done += 1;
    }
  }
  return total > 0 ? { done, total } : null;
}
