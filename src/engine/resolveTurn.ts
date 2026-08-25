import type { ActionPlan, GameState, ResolutionEvent } from './types';
import type { RngFn } from './rng';
import { captureStep, type ReplayCapture, type ReplayPhase } from './replay';
import { computeTurnPriority } from './priority';
import { sanitizePlan } from './validation';
import { resolveTurnStart } from './resolvers/turnStart';
import { resolveMovement } from './resolvers/movement';
import { resolvePreAttack } from './resolvers/preAttack';
import { resolveAttacks } from './resolvers/attacks';
import { resolveRewind } from './resolvers/rewind';
import { resolveHealing } from './resolvers/healing';
import { resolveEndOfTurn } from './resolvers/endOfTurn';

/** 제출된 계획을 합법 범위로 정규화한 ActionPlan을 만든다(불법 항목은 baseAction:'none'으로 무효화). */
function sanitizeActionPlan(state: GameState, plan: ActionPlan): ActionPlan {
  const actions: ActionPlan['actions'] = {};
  for (const [instanceId, unitPlan] of Object.entries(plan.actions)) {
    const unit = state.units.find((u) => u.instanceId === instanceId);
    actions[instanceId] = unit ? sanitizePlan(state, unit, unitPlan) : { baseAction: { kind: 'none' } };
  }
  return { ...plan, actions };
}

/**
 * 턴 해결 오케스트레이터(3.2절/3.2.1절). 두 플레이어의 계획을 동시에 공개했다고 가정하고,
 * 고정된 5단계 순서로 하나의 결과를 계산한다. 단계 순서 자체는 항상 고정이지만, 각 단계 내에서
 * 기물별로 처리할 순서(우선순위, 이동Lv desc → 공격 수치 desc → 역할 → 무작위)는 이동 단계
 * 직전과 공격 단계 직전에 각각 독립적으로 계산한다 — 무작위로 결정된 순서는 해당 행동 단계에서만
 * 유효하다(§3.2.1). 공격 단계 순서는 이동·공격전 단계에서 죽은 기물을 자연히 제외한다.
 * 먼저 입력한 플레이어가 우선권을 갖지 않는다.
 *
 * `capture`를 넘기면 단계가 끝날 때마다 그때의 판을 한 장씩 떠서 돌려준다(engine/replay.ts).
 * **규칙에는 아무 영향이 없다** — 넘기지 않으면 스냅샷을 뜨지 않으므로 AI·밸런스 시뮬레이터는
 * 이 기능이 없던 때와 정확히 같은 비용으로 돈다.
 */
export function resolveTurn(
  state: GameState,
  planP1: ActionPlan,
  planP2: ActionPlan,
  rngFn: RngFn = Math.random,
  capture?: ReplayCapture,
): ResolutionEvent[] {
  const log: ResolutionEvent[] = [];
  state.phase = 'resolving';

  /**
   * 직전 표시 이후 쌓인 로그를 잘라 한 단계로 묶는다. 이벤트의 `phase` 값이 아니라 **기록된
   * 순서**로 나누는 것이 핵심이다 — 사망은 공격 단계에서 일어나면서도 `phase:'endOfTurn'`으로
   * 적히므로, phase로 나누면 죽는 장면이 두 단계 뒤에 가서야 뜬다.
   *
   * 우선순위(priority) 이벤트는 뺀다. 판에 그릴 것이 없는 진행 정보라 남겨 두면 "아무 일도
   * 없던 단계"가 사건 있는 단계로 오인되어 compactReplay가 걸러 내지 못한다.
   */
  let cursor = 0;
  const mark = (phase: ReplayPhase): void => {
    if (!capture) return;
    capture(captureStep(state, phase, log.slice(cursor).filter((e) => e.phase !== 'priority')));
    cursor = log.length;
  };

  // 재생의 출발점 — 턴을 넘기기 직전에 양쪽이 보던 판.
  mark('start');

  const sanitizedP1 = sanitizeActionPlan(state, planP1);
  const sanitizedP2 = sanitizeActionPlan(state, planP2);

  // support3의 동전은 이동력까지 바꾸고, 이전 포탑은 이동 경로를 막는다 — 둘 다 이동보다 먼저.
  resolveTurnStart(state, sanitizedP1, sanitizedP2, rngFn, log);
  mark('turnStart');

  const movementOrder = computeTurnPriority(state.units, rngFn);
  log.push({ phase: 'priority', type: 'movementOrder', detail: { order: movementOrder } });
  const movementIds = movementOrder.map((p) => p.instanceId);
  resolveMovement(state, sanitizedP1, sanitizedP2, movementIds, log);
  mark('movement');

  resolvePreAttack(state, sanitizedP1, sanitizedP2, log);
  mark('preAttack');

  const attackOrder = computeTurnPriority(state.units, rngFn);
  log.push({ phase: 'priority', type: 'attackOrder', detail: { order: attackOrder } });
  const attackIds = attackOrder.map((p) => p.instanceId);
  resolveAttacks(state, sanitizedP1, sanitizedP2, attackIds, log);

  // dealer2 시간역행 복귀는 공격 직후에 처리한다 — 그 턴에 받은 피해까지 되돌리는 것이 기술의 취지다.
  resolveRewind(state, log);
  mark('attack');

  state.lastPriorityOrder = { movement: movementOrder, attack: attackOrder };

  resolveHealing(state, sanitizedP1, sanitizedP2, log);
  mark('heal');

  resolveEndOfTurn(state, rngFn, log);
  mark('endOfTurn');

  state.log.push(...log);
  // TS는 resolveEndOfTurn(state, ...) 호출이 state.phase를 바꿀 수 있음을 알지 못하고
  // 30행의 대입으로 'resolving' 리터럴로 좁혀버린다(CFA가 함수 호출을 거쳐도 유지됨).
  // 실제로는 resolveEndOfTurn이 승리 조건 충족 시 'gameOver'로 바꿀 수 있으므로 단언으로 넓혀서 비교한다.
  const phaseAfterEnd = state.phase as GameState['phase'];
  if (phaseAfterEnd !== 'gameOver') state.phase = 'planning';
  return log;
}
