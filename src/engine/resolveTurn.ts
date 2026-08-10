import type { ActionPlan, GameState, ResolutionEvent } from './types';
import type { RngFn } from './rng';
import { computeTurnPriority } from './priority';
import { sanitizePlan } from './validation';
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
 */
export function resolveTurn(state: GameState, planP1: ActionPlan, planP2: ActionPlan, rngFn: RngFn = Math.random): ResolutionEvent[] {
  const log: ResolutionEvent[] = [];
  state.phase = 'resolving';

  const sanitizedP1 = sanitizeActionPlan(state, planP1);
  const sanitizedP2 = sanitizeActionPlan(state, planP2);

  const movementOrder = computeTurnPriority(state.units, rngFn);
  log.push({ phase: 'priority', type: 'movementOrder', detail: { order: movementOrder } });
  const movementIds = movementOrder.map((p) => p.instanceId);
  resolveMovement(state, sanitizedP1, sanitizedP2, movementIds, log);

  resolvePreAttack(state, sanitizedP1, sanitizedP2, log);

  const attackOrder = computeTurnPriority(state.units, rngFn);
  log.push({ phase: 'priority', type: 'attackOrder', detail: { order: attackOrder } });
  const attackIds = attackOrder.map((p) => p.instanceId);
  resolveAttacks(state, sanitizedP1, sanitizedP2, attackIds, log);

  // dealer2 시간역행 복귀는 공격 직후에 처리한다 — 그 턴에 받은 피해까지 되돌리는 것이 기술의 취지다.
  resolveRewind(state, log);

  state.lastPriorityOrder = { movement: movementOrder, attack: attackOrder };

  resolveHealing(state, sanitizedP1, sanitizedP2, log);
  resolveEndOfTurn(state, rngFn, log);

  state.log.push(...log);
  // TS는 resolveEndOfTurn(state, ...) 호출이 state.phase를 바꿀 수 있음을 알지 못하고
  // 30행의 대입으로 'resolving' 리터럴로 좁혀버린다(CFA가 함수 호출을 거쳐도 유지됨).
  // 실제로는 resolveEndOfTurn이 승리 조건 충족 시 'gameOver'로 바꿀 수 있으므로 단언으로 넓혀서 비교한다.
  const phaseAfterEnd = state.phase as GameState['phase'];
  if (phaseAfterEnd !== 'gameOver') state.phase = 'planning';
  return log;
}
