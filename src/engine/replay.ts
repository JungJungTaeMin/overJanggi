import type { GameState, Owner, ResolutionEvent, UnitInstance } from './types';

/**
 * **한 턴의 해결을 단계마다 끊어 담은 스냅샷.**
 *
 * 규칙상 한 턴은 이동 → 공격전 상태변화 → 공격 → 회복 → 턴종료 순으로 **차례대로** 굴러가는데,
 * 화면에는 그 결과가 한꺼번에 나타났다. 그러면 "내 딜러가 쏜 게 맞았나, 상대가 먼저 움직여서
 * 빗나갔나"를 판만 보고는 되짚을 수 없다 — 로그를 읽어야만 알 수 있고, 그건 판을 보는 일이 아니다.
 *
 * 그래서 해결 중간중간의 판을 그대로 떠 둔다. 엔진은 여전히 한 번에 끝까지 계산하고(규칙은 조금도
 * 바뀌지 않는다) 화면만 그 사진들을 차례로 넘긴다. 재생은 순전히 보여주기라서, 스냅샷을 뜨는
 * 비용을 치를지 말지는 **부르는 쪽이 정한다** — resolveTurn의 capture 인자를 넘기지 않으면
 * 아무것도 뜨지 않는다(밸런스 시뮬레이터 1000판이 이 비용을 물지 않는 이유).
 */
export type ReplayPhase = 'start' | 'turnStart' | 'movement' | 'preAttack' | 'attack' | 'heal' | 'endOfTurn';

export interface ResolutionStep {
  phase: ReplayPhase;
  /**
   * 이 단계가 **끝난 직후**의 기물 상태(깊은 복사). 복사본이어야 하는 이유는 명백하다 —
   * 엔진은 state.units를 제자리에서 고치므로, 참조를 담아 두면 여섯 단계가 전부 마지막 판을
   * 가리키게 되어 재생이 통째로 무의미해진다.
   */
  units: UnitInstance[];
  healPackTimers: Record<string, number>;
  score: Record<Owner, number>;
  /**
   * **이 단계에서만** 나온 사건. 판 위 표시(맞음 / 빗나감 / 막힘 / 회복)의 근거다.
   * 단계 구분은 이벤트의 `phase` 값이 아니라 **기록된 순서**로 나눈다 — 사망은 공격 단계에서
   * 일어나면서도 `phase:'endOfTurn'`으로 적히는 등, phase 값이 실제 시점과 어긋나는 데가 있다.
   */
  events: ResolutionEvent[];
}

/** 한 턴 분의 재생. turnNumber는 "이게 몇 번째 턴의 재생인가"를 알리는 식별자다(아래 주석 참고). */
export interface TurnReplay {
  /**
   * 이 재생이 어느 턴의 것인지. 온라인 게스트는 호스트가 스토어를 만질 때마다 스냅샷을 통째로
   * 다시 받는데, 그때마다 steps 배열은 새 객체가 되어 참조 비교로는 "새 턴"과 구분되지 않는다.
   * 턴 번호로 구분하면 같은 턴의 스냅샷이 몇 번을 더 와도 재생이 처음부터 다시 돌지 않는다.
   */
  turnNumber: number;
  steps: ResolutionStep[];
}

export type ReplayCapture = (step: ResolutionStep) => void;

/** 지금 판을 한 장 떠서 한 단계로 만든다. */
export function captureStep(state: GameState, phase: ReplayPhase, events: ResolutionEvent[]): ResolutionStep {
  return {
    phase,
    units: structuredClone(state.units),
    healPackTimers: { ...state.healPackTimers },
    score: { ...state.score },
    events,
  };
}

/**
 * 판에 **보이는 것만** 뽑은 지문. 위치·생사·체력·보호막·상태이상까지 본다 — 상태이상을 빼면
 * 방벽과 구속만 걸린 「2.공격전」 단계가 "아무것도 안 바뀌었다"로 판정되어 통째로 사라진다.
 */
function boardSignature(units: UnitInstance[]): string {
  return units
    .map((u) => {
      const at = u.position ? `${u.position.x},${u.position.y}` : '-';
      const effects = u.statusEffects.map((e) => e.type).sort().join('|');
      return `${u.instanceId}:${u.alive ? 1 : 0}:${at}:${u.currentHp}/${u.maxHp}+${u.shieldHp}:${effects}`;
    })
    .join(';');
}

/**
 * **아무 일도 없던 단계는 빼고 넘긴다.** 여섯 단계를 늘 다 재생하면 대부분의 턴에서 절반은
 * 빈 화면을 쳐다보는 시간이 되고, 그러면 사용자는 재생 자체를 꺼 버린다. 사건도 없고 판도
 * 그대로면 보여줄 것이 없는 단계다.
 *
 * 첫 단계('start')만은 예외로 항상 남긴다 — 턴을 넘기기 직전에 보던 판이라 재생의 출발점이고,
 * 여기서 시작하지 않으면 "무엇이 어떻게 달라졌는지"의 기준이 사라진다.
 */
export function compactReplay(steps: ResolutionStep[]): ResolutionStep[] {
  const kept: ResolutionStep[] = [];
  let previous: string | null = null;
  for (const step of steps) {
    const signature = boardSignature(step.units);
    if (kept.length === 0 || step.events.length > 0 || signature !== previous) kept.push(step);
    previous = signature;
  }
  return kept;
}
