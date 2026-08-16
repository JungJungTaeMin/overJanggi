import type { Direction, GameState, UnitInstance, UnitTurnPlan } from './types';
import { getUnitType } from '../data/unitTypes';
import { DIAGONAL_DIRECTIONS } from './grid';
import { hasActiveEffect, sumMagnitude } from './statusEffects';
import { skillRangeSpec } from './skillRange';
import { isWithinSkillRange } from './targeting';
import {
  canPlanSkillMove,
  countInSegmentTurns,
  inSegmentTurnAllowance,
  isSkillOnlyMove,
  moveSegmentCapacities,
  normalizedMoveAction,
  planMoveCapacity,
  plannedDestination,
  resolveSegmentLengths,
  segmentOrigins,
  staticRunLimit,
  wholeExtraMoveUses,
} from './movePath';

export function isActionLegal(state: GameState, unit: UnitInstance, plan: UnitTurnPlan): boolean {
  if (!unit.alive) {
    return plan.baseAction.kind === 'none' && !plan.skillUse;
  }
  const typeDef = getUnitType(unit.typeId);

  // 행동불가(stun, support2 구속): 그 턴의 행동 자체가 안 된다 — 이동도 공격도 기술도. 여기서
  // 한 번에 막는 이유는 이게 "무엇을 계획할 수 있는가"의 문제라서다. 아래 개별 규칙들보다 먼저
  // 걸러야 stun 상태에서 기술만 몰래 통과하는 구멍이 안 생긴다. 점령은 행동이 아니므로 그대로 센다.
  if (hasActiveEffect(unit, 'stun', state.turnNumber)) {
    return plan.baseAction.kind === 'none' && !plan.skillUse;
  }

  // dealer3: 이번 턴에 토글을 사용하면 preAttack 단계에서 즉시 반영되므로,
  // "토글 후 상태"를 미리 계산해 같은 턴 토글+공격/이동 조합을 판정한다.
  if (unit.typeId === 'dealer3') {
    const currentlyOn = hasActiveEffect(unit, 'attackMode', state.turnNumber);
    const togglingThisTurn = plan.skillUse?.skillId === 'dealer3_attack_mode';
    const willBeOn = togglingThisTurn ? !currentlyOn : currentlyOn;
    if (plan.baseAction.kind === 'move' && willBeOn) return false;
    if ((plan.baseAction.kind === 'attack' || plan.baseAction.kind === 'attackAt') && !willBeOn) return false;
  }

  // "이동을 한 번 더" 주는 기술이 만든 이동은 기본 행동이 공격이어도 살아 있다 —
  // 다만 그런 기술(dealer2 시간역행)을 실제로 쓸 때만 가능하다(tank1/tank2의 +1은 기본 이동 버프).
  const skillOnlyMove = isSkillOnlyMove(plan);
  if (skillOnlyMove && !canPlanSkillMove(unit, plan.skillUse)) return false;

  // 구속(root)은 이동 단계만 막는다 — 공격/기술/점령에는 영향 없음(6장). 기술 이동도 이동이라 막힌다.
  const moveAction = normalizedMoveAction(plan);
  if (moveAction && hasActiveEffect(unit, 'root', state.turnNumber)) return false;

  if (moveAction) {
    // 이번 턴에 쓰는 이동 계열 기술이 주는 추가 칸수는 기술마다 다르다 — dealer2 시간역행은
    // 이번 턴에 소비하는 충전 개수(1~3)만큼 늘어나므로 고정 +1로 계산하면 안 된다.
    const carriedBonus = sumMagnitude(unit, 'moveBonus', state.turnNumber);
    const cap = planMoveCapacity(unit, plan, carriedBonus);
    const steps = moveAction.path?.length ?? moveAction.distance;
    if (steps < 1 || steps > cap) return false;

    // 구간별 상한: "기술 1회 = 이동 한 번 더"이므로 한 구간이 이동 Lv을 넘을 수 없고, 앞 구간을
    // 덜 썼다고 그 나머지를 뒤 구간에 몰아 쓸 수도 없다(총합만 검사하면 3+0+0+9 같은 계획이 통과한다).
    const declared = moveAction.segmentLengths;
    if (declared) {
      const capacities = moveSegmentCapacities(unit, plan.skillUse, carriedBonus);
      if (declared.length > capacities.length) return false;
      if (declared.some((len, i) => !Number.isInteger(len) || len < 0 || len > capacities[i])) return false;
      if (declared.reduce((a, b) => a + b, 0) !== steps) return false;

      // 추가 이동은 칸수를 고를 수 없다 — 한 번 쓰기로 했으면 이동 Lv만큼 통째로 간다.
      // 장애물·판 끝에 막히는 경우에만 그 앞 칸까지로 짧아진다(사용자 확정 규칙).
      const path = moveAction.path;
      if (path && unit.position && wholeExtraMoveUses(unit, plan.skillUse) > 0) {
        const origins = segmentOrigins(unit.position, path, declared, state.board);
        let cursor = declared[0] ?? 0;
        for (let seg = 1; seg < declared.length; seg++) {
          const len = declared[seg];
          const origin = origins[seg];
          if (len > 0) {
            if (!origin) return false; // 앞 구간이 이미 막혔는데 더 가겠다는 계획
            if (len !== staticRunLimit(origin, path[cursor], capacities[seg], state.board)) return false;
          }
          cursor += len;
        }
      }
    }

    // 한 번의 이동은 무조건 한 방향. 방향 전환은 구간 경계(dealer2의 기본 이동 → 기술 n회째)이거나
    // 경로 변경을 명시적으로 허용하는 기술(tank2 돌진)을 쓸 때만 가능하다.
    if (moveAction.path) {
      const segLengths = resolveSegmentLengths(unit, plan, moveAction.path.length);
      if (countInSegmentTurns(moveAction.path, segLengths) > inSegmentTurnAllowance(unit, plan.skillUse)) {
        return false;
      }
    }
    const legalDirections: Direction[] | null = typeDef.diagonalMove ? null : DIAGONAL_DIRECTIONS;
    if (legalDirections && moveAction.path?.some((d) => legalDirections.includes(d))) return false;
    if (legalDirections && !moveAction.path && legalDirections.includes(moveAction.direction)) return false;
  }

  if (plan.baseAction.kind === 'attack' || plan.baseAction.kind === 'attackAt') {
    if (!typeDef.canAttack) return false;
    if ((unit.cooldowns['basicAttack'] ?? 0) > 0) return false;
  }

  if (plan.skillUse) {
    const skill = typeDef.skills.find((s) => s.id === plan.skillUse!.skillId);
    if (!skill) return false;
    if (skill.gate.type === 'cooldown' && (unit.cooldowns[skill.id] ?? 0) > 0) return false;
    if (skill.gate.type === 'charge' && (unit.charges[skill.id] ?? 0) <= 0) return false;
    // 지원 기물: 공격 또는 힐 중 하나만(3.2절)
    if (typeDef.role === 'support' && skill.effectCategory === 'heal' && plan.baseAction.kind === 'attack') {
      return false;
    }
    // 대상 지정 기술의 사거리. 이게 없으면 UI에서 맵 반대편 기물을 골라도 그대로 통과한다.
    //
    // 기준 칸은 현재 위치가 아니라 **이번 턴 도착할 칸**이다. 이동과 기술은 함께 계획할 수 있고
    // 이동이 먼저 해결되므로, 출발 칸으로 재면 "옆으로 비켜서서 회복 라인을 여는" 정상적인 수가
    // 전부 불법이 된다. 어디까지나 계획 시점의 **1차 검사**이고, 다른 기물의 방해나 대상의 이동으로
    // 실제로는 빗나갈 수 있어서 해결 단계에서 한 번 더 본다(healing.ts/preAttack.ts).
    const spec = skillRangeSpec(skill);
    if (spec) {
      const target = state.units.find((u) => u.instanceId === plan.skillUse!.target && u.alive);
      if (!target || !target.position) return false;
      const from = plannedDestination(unit, plan, state.board);
      if (!from || !isWithinSkillRange(from, target.position, spec.range, state.board, spec.axis)) return false;
    }
  }

  return true;
}

/**
 * 불법적인 계획은 안전하게 무시(기본행동=none, 기술 없음)하기 위한 정규화.
 * 기술 이동은 **기본 행동에 딸린 부가 요소**이므로, 그것만 불법일 때 계획 전체를 날리지 않고 그
 * 항목만 떼어낸다 — 기술을 이동을 만들지 못하는 것으로 바꾼 뒤 남아 있는 예전 경로 등.
 */
export function sanitizePlan(state: GameState, unit: UnitInstance, plan: UnitTurnPlan): UnitTurnPlan {
  if (isActionLegal(state, unit, plan)) return plan;
  if (plan.skillMove) {
    const { skillMove: _dropped, ...rest } = plan;
    if (isActionLegal(state, unit, rest)) return rest;
  }
  return { baseAction: { kind: 'none' } };
}
