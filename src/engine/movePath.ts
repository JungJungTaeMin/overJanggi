import type { BaseAction, BoardConfig, Direction, Position, SkillUse, UnitInstance, UnitTurnPlan } from './types';
import { getUnitType } from '../data/unitTypes';
import { inBounds, isObstacle, step } from './grid';
import { getRerouteInfo } from './moveReroute';
import { plannedMoveSpeed } from './unitStats';

/** 기본 행동 중 이동만 뽑은 타입. */
export type MoveBaseAction = Extract<BaseAction, { kind: 'move' }>;

/**
 * 충전형 기술을 이번 턴에 몇 번 쓰는지. dealer2 시간역행은 1회 사용이 "이동을 한 번 더 하는" 것이라
 * 사용 횟수 × 이동 Lv 만큼 칸이 늘어난다(칸수 환산은 plannedMoveBonus). 보유 충전량은 넘겨 쓸 수 없다.
 */
export function plannedChargeUses(unit: UnitInstance, skillUse: SkillUse | undefined): number {
  if (!skillUse) return 0;
  const typeDef = getUnitType(unit.typeId);
  const skill = typeDef.skills.find((s) => s.id === skillUse.skillId);
  if (!skill || skill.gate.type !== 'charge') return 0;
  const available = unit.charges[skill.id] ?? 0;
  const requested = Math.floor(skillUse.amount ?? 1);
  return Math.max(0, Math.min(requested, available));
}

/**
 * 이번 턴 계획이 부여하는 추가 이동 칸수(이미 걸려 있는 moveBonus 상태이상은 제외).
 * - 충전형(dealer2 시간역행): 1회 사용 = 이동을 한 번 더 하는 것 = 이동 Lv만큼 추가.
 *   턴당 최대 3회이므로 3 + 3×3 = 최대 12칸.
 * - 쿨타임형 이동 버프(tank1 방어태세, tank2 돌진): 문서상 "이동 +1"로 고정.
 */
export function plannedMoveBonus(unit: UnitInstance, skillUse: SkillUse | undefined): number {
  if (!skillUse) return 0;
  const typeDef = getUnitType(unit.typeId);
  const skill = typeDef.skills.find((s) => s.id === skillUse.skillId);
  if (!skill || skill.effectCategory !== 'movement') return 0;
  if (skill.gate.type === 'charge') {
    return plannedChargeUses(unit, skillUse) * plannedMoveSpeed(unit) * (skill.payload.extraMoveMultiple ?? 1);
  }
  const bonus = skill.payload.moveBonus ?? skill.payload.extraMove;
  return bonus ?? 0;
}

/**
 * 이동 경로를 "구간(segment)"으로 나눌 때 한 구간의 기준 길이 = 이 기물의 이동 Lv.
 * 0번 구간은 기본 이동, 1번 구간부터는 기술을 n회 쓴 덕에 추가로 얻는 "이동 한 번"이다.
 */
export function moveSegmentLength(unit: UnitInstance): number {
  return Math.max(1, plannedMoveSpeed(unit));
}

/**
 * 이번 턴 계획이 "이동을 한 번 더" 통째로 몇 번 주는지(dealer2 시간역행처럼 충전 1회 = 이동 1회).
 * tank1/tank2의 `이동 +1` 같은 단순 가산 버프는 구간을 늘리지 않으므로 0을 돌려준다.
 */
export function wholeExtraMoveUses(unit: UnitInstance, skillUse: SkillUse | undefined): number {
  if (!skillUse) return 0;
  const typeDef = getUnitType(unit.typeId);
  const skill = typeDef.skills.find((s) => s.id === skillUse.skillId);
  if (!skill || skill.effectCategory !== 'movement' || skill.gate.type !== 'charge') return 0;
  if (skill.payload.extraMoveMultiple === undefined) return 0;
  return plannedChargeUses(unit, skillUse);
}

/**
 * **기술만으로 이동할 수 있는가.** "이동을 한 번 더" 통째로 주는 기술(dealer2 시간역행)만 해당한다 —
 * tank1/tank2의 `이동 +1`은 기본 이동을 늘리는 버프라 기본 행동이 공격이면 늘릴 이동이 없다.
 */
export function canPlanSkillMove(unit: UnitInstance, skillUse: SkillUse | undefined): boolean {
  return wholeExtraMoveUses(unit, skillUse) > 0;
}

/** 기본 행동은 공격(또는 없음)이고 이동은 전부 기술이 만든 계획인지. */
export function isSkillOnlyMove(plan: UnitTurnPlan): boolean {
  return plan.baseAction.kind !== 'move' && !!plan.skillMove && plan.skillMove.path.length > 0;
}

/**
 * 계획에 담긴 이동을 **하나의 move 행동으로 정규화**한다. 기술 이동은 기본 이동 구간을 0칸으로 둔
 * `[0, 기술1회, 기술2회, …]` 형태가 되므로, 구간 상한·장애물·미리보기 등 기존 이동 코드가 기본 행동
 * 이동과 완전히 같은 경로를 그대로 태울 수 있다(구간 번호도 어긋나지 않는다).
 */
export function normalizedMoveAction(plan: UnitTurnPlan): MoveBaseAction | null {
  if (plan.baseAction.kind === 'move') return plan.baseAction;
  const skillMove = plan.skillMove;
  if (!skillMove || skillMove.path.length === 0) return null;
  const extraLengths = skillMove.segmentLengths ?? [skillMove.path.length];
  return {
    kind: 'move',
    direction: skillMove.path[0],
    distance: skillMove.path.length,
    path: skillMove.path,
    segmentLengths: [0, ...extraLengths],
  };
}

/**
 * 이번 턴 이 계획이 실제로 쓸 수 있는 총 이동 칸수.
 * 기술 이동만 하는 계획에는 **기본 이동 몫이 없다** — 기술이 준 칸수가 전부다.
 */
export function planMoveCapacity(unit: UnitInstance, plan: UnitTurnPlan, carriedBonus = 0): number {
  const bonus = plannedMoveBonus(unit, plan.skillUse);
  // 기본 행동이 이동이 아니면 기본 이동 칸은 애초에 존재하지 않는다 — 아직 경로를 한 칸도 안 찍은
  // 상태에서도 상한이 "기술 몫"으로 보여야 UI가 12칸(3+9) 같은 잘못된 숫자를 안내하지 않는다.
  if (plan.baseAction.kind !== 'move') return bonus;
  return Math.max(0, plannedMoveSpeed(unit) + carriedBonus + bonus);
}

/**
 * 이번 턴에 계획할 수 있는 구간들의 **최대 칸수**를 순서대로 돌려준다.
 * `[기본 이동, 기술 1회, 기술 2회, …]` — 각 구간은 서로 독립이라 앞 구간을 덜 쓴다고 뒤 구간이
 * 길어지지 않는다(예: 기본 3칸 / 기술1 2칸만 쓰고 / 기술2 3칸 → 남은 1칸은 그냥 버려진다).
 * 이 배열의 합이 곧 이번 턴 총 이동 상한이다.
 */
export function moveSegmentCapacities(
  unit: UnitInstance,
  skillUse: SkillUse | undefined,
  carriedBonus = 0,
): number[] {
  const uses = wholeExtraMoveUses(unit, skillUse);
  // 구간을 늘리지 않는 단순 가산 버프(+1 등)는 기본 구간 길이에 더한다.
  const flatBonus = uses > 0 ? 0 : plannedMoveBonus(unit, skillUse);
  const base = Math.max(1, plannedMoveSpeed(unit) + carriedBonus + flatBonus);
  return [base, ...Array.from({ length: uses }, () => moveSegmentLength(unit))];
}

/**
 * 추가 이동(기술 1회 = "이동을 한 번 더")은 **칸수를 고를 수 없다** — 무조건 이동 Lv만큼 간다.
 * 단, 판 밖이나 장애물에 막히면 그 **앞 칸까지만** 갈 수 있으므로 그때만 짧아진다.
 * 다른 기물은 이번 턴에 같이 움직이므로 여기서는 정적 장애물과 판 경계만 본다 — 기물에 막히는 경우는
 * 계획을 불법으로 만들지 않고 해결 단계에서 그 앞에 멈추는 것으로 처리한다.
 */
export function staticRunLimit(from: Position, dir: Direction, cap: number, board: BoardConfig): number {
  let pos = from;
  let n = 0;
  while (n < cap) {
    const next = step(pos, dir);
    if (!inBounds(next, board) || isObstacle(next, board)) break;
    pos = next;
    n += 1;
  }
  return n;
}

/** 한 칸 전진하되 판 밖·장애물이면 null(= 여기서 더는 못 간다). */
export function staticStep(from: Position, dir: Direction, board: BoardConfig): Position | null {
  const next = step(from, dir);
  return inBounds(next, board) && !isObstacle(next, board) ? next : null;
}

/**
 * 이 계획대로 움직였을 때 **도착할 셈인 칸**. 지형만 보고 걸으며 다른 기물의 방해는 고려하지 않는다
 * — 누가 길을 막는지는 이동 단계에서야 정해지기 때문이다.
 *
 * 대상 지정 기술의 사거리를 계획 시점에 검사하려면 이 값이 필요하다. 사거리를 **출발 칸** 기준으로
 * 보면 "옆으로 한 칸 비켜서서 회복 라인을 여는" 정상적인 수가 전부 불법이 되어 버린다 —
 * support2의 회복이 직선 제약이라 특히 그렇다.
 */
export function plannedDestination(unit: UnitInstance, plan: UnitTurnPlan, board: BoardConfig): Position | null {
  if (!unit.position) return null;
  const move = normalizedMoveAction(plan);
  if (!move) return unit.position;
  const path = move.path ?? Array.from({ length: move.distance }, () => move.direction);
  let current = unit.position;
  for (const dir of path) {
    const next = staticStep(current, dir, board);
    if (!next) break; // 지형에 막히면 거기까지가 이번 턴의 도착 칸이다
    current = next;
  }
  return current;
}

/**
 * 각 구간이 출발하는 칸을 앞에서부터 걸어가며 구한다(정적 장애물 기준).
 * 반환 배열의 길이는 `segmentLengths.length + 1` — 마지막 원소는 아직 채우지 않은 다음 구간의 출발 칸이다.
 * 중간에 막히면 그 이후는 전부 null이다.
 */
export function segmentOrigins(
  from: Position,
  path: Direction[],
  segmentLengths: number[],
  board: BoardConfig,
): (Position | null)[] {
  const origins: (Position | null)[] = [];
  let pos: Position | null = from;
  let i = 0;
  for (const len of segmentLengths) {
    origins.push(pos);
    for (let k = 0; k < len; k++) {
      if (!pos) break;
      pos = staticStep(pos, path[i + k], board);
    }
    i += len;
  }
  origins.push(pos);
  return origins;
}

/**
 * 계획된 경로를 실제 구간별 길이로 나눈다.
 * - `baseAction.segmentLengths`가 있으면 그것이 유일한 근거다(구간을 덜 쓰는 계획을 표현하는 유일한 방법).
 * - 없으면 구간 최대치를 앞에서부터 채우는 방식으로 나눈다 — 보드 클릭·구형 계획 호환.
 */
export function resolveSegmentLengths(unit: UnitInstance, plan: UnitTurnPlan, pathLength: number): number[] {
  const skillUse = plan.skillUse;
  const capacities = moveSegmentCapacities(unit, skillUse);
  const lengths: number[] = [];
  let remaining = pathLength;

  const declared = normalizedMoveAction(plan)?.segmentLengths;
  const source = declared ?? capacities;
  for (let i = 0; i < source.length && remaining > 0; i++) {
    const take = Math.max(0, Math.min(source[i], capacities[i] ?? 0, remaining));
    lengths.push(take);
    remaining -= take;
  }
  // 선언된 길이의 합이 경로보다 짧으면(구형 데이터 등) 남은 스텝은 마지막 구간에 붙인다.
  if (remaining > 0 && lengths.length > 0) lengths[lengths.length - 1] += remaining;
  else if (remaining > 0) lengths.push(remaining);
  return lengths;
}

/**
 * **한 번의 이동은 무조건 한 방향이다.** 그 안에서 방향을 꺾을 수 있는 횟수를 돌려준다 —
 * tank2 돌진처럼 payload에 `rerouteCount`가 있는 기술만 예외다.
 * dealer2 시간역행의 방향 전환은 구간 *내부*가 아니라 **구간 경계**(기본 이동이 끝나는 지점,
 * 기술 n회째가 끝나는 지점)에서 일어나므로 여기에 해당하지 않는다.
 */
export function inSegmentTurnAllowance(unit: UnitInstance, skillUse: SkillUse | undefined): number {
  if (!skillUse) return 0;
  const skill = getUnitType(unit.typeId).skills.find((s) => s.id === skillUse.skillId);
  if (!skill || skill.effectCategory !== 'movement') return 0;
  return skill.payload.rerouteCount ?? 0;
}

/** 구간 경계가 아닌 곳에서 방향이 꺾인 횟수 — 0이 아니면 "한 번의 이동 = 한 방향" 규칙 위반이다. */
export function countInSegmentTurns(path: Direction[], segmentLengths: number[]): number {
  const boundaries = new Set<number>();
  let acc = 0;
  for (const len of segmentLengths) {
    boundaries.add(acc);
    acc += len;
  }
  let turns = 0;
  for (let i = 1; i < path.length; i++) {
    if (path[i] !== path[i - 1] && !boundaries.has(i)) turns++;
  }
  return turns;
}

/** 구간별 길이 배열을 "스텝 번호 → 구간 번호" 조회표로 편다. */
export function segmentIndexByStep(segmentLengths: number[]): number[] {
  const byStep: number[] = [];
  segmentLengths.forEach((len, seg) => {
    for (let i = 0; i < len; i++) byStep.push(seg);
  });
  return byStep;
}

/**
 * 한 기물의 이동 계획을 "스텝별 방향 배열"로 정규화한다. 엔진의 실제 해결(resolvers/movement.ts)과
 * UI 미리보기(components/Planning/actionGeometry.ts)가 반드시 같은 경로를 계산하도록 여기 한 곳에만 둔다.
 *
 * 우선순위:
 * 1. `baseAction.path`가 있으면 그대로 사용(칸마다 자유롭게 꺾는 신 모델).
 * 2. 없으면 direction으로 distance칸 직진하되, 구 reroute 규칙(tank2 돌진의 1회 경로 변경 등)을
 *    적용해 해당 스텝부터 방향을 바꾼다 — 보드 클릭·단축키·기존 계획 데이터 호환용.
 *
 * 어느 경우든 총 스텝 수는 `maxSteps`(이동 Lv + 이동 보너스)로 잘린다.
 */
export function resolveMovePath(unit: UnitInstance, plan: UnitTurnPlan, maxSteps: number): Direction[] {
  const baseAction = normalizedMoveAction(plan);
  if (!baseAction) return [];
  const cap = Math.max(0, maxSteps);

  if (baseAction.path && baseAction.path.length > 0) {
    return baseAction.path.slice(0, cap);
  }

  const reroute = getRerouteInfo(unit, plan.skillUse);
  const steps = Math.max(0, Math.min(baseAction.distance, cap));
  const path: Direction[] = [];
  for (let i = 0; i < steps; i++) {
    path.push(reroute && i >= reroute.fromStep ? reroute.direction : baseAction.direction);
  }
  return path;
}
