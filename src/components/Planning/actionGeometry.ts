import type { BaseAction, BoardConfig, Direction, Position, SkillMove, SkillUse, UnitInstance, UnitTurnPlan } from '../../engine/types';
import { getUnitType } from '../../data/unitTypes';
import { ORTHOGONAL_DIRECTIONS, DIAGONAL_DIRECTIONS, reachableSteps, samePosition, step, isWalkable } from '../../engine/grid';
import { attackRangeFor, lineCells, frontBandCells } from '../../engine/targeting';
import {
  isSkillOnlyMove,
  moveSegmentCapacities,
  planMoveCapacity,
  resolveMovePath,
  resolveSegmentLengths,
  segmentIndexByStep,
  segmentOrigins,
  staticRunLimit,
  staticStep,
  wholeExtraMoveUses,
} from '../../engine/movePath';
import { sumMagnitude } from '../../engine/statusEffects';

export interface MoveOption {
  position: Position;
  direction: Direction;
  distance: number;
}

export interface AttackOption {
  position: Position;
  direction: Direction;
}

function directionsForAxis(axis?: 'orthogonal' | 'diagonal' | 'both'): Direction[] {
  if (axis === 'diagonal') return DIAGONAL_DIRECTIONS;
  if (axis === 'both') return [...ORTHOGONAL_DIRECTIONS, ...DIAGONAL_DIRECTIONS];
  return ORTHOGONAL_DIRECTIONS;
}

/**
 * 이번 턴 이 기물이 실제로 움직일 수 있는 최대 칸수. 이미 걸려 있는 이동 버프(moveBonus)와
 * **이번 턴 계획에 담긴 이동 기술의 보너스**를 모두 더한다 — 후자를 빼먹으면 dealer2가 시간역행을
 * 계획해도 보드에 추가 이동 칸이 초록으로 뜨지 않아 "기술을 써도 추가 이동이 안 되는" 것처럼 보인다.
 */
export function moveCapacity(unit: UnitInstance, turnNumber: number, plan: UnitTurnPlan): number {
  return planMoveCapacity(unit, plan, sumMagnitude(unit, 'moveBonus', turnNumber));
}

/**
 * 선택된 유닛이 보드 클릭만으로 이동을 지정할 수 있도록, 갈 수 있는 모든 칸을
 * (방향, 칸수)와 함께 계산한다. 드롭다운(방향+칸수 입력)과 동일한 결과를 만들어내므로
 * 두 입력 방식은 항상 서로 호환된다.
 */
export function computeMoveOptions(
  unit: UnitInstance,
  allUnits: UnitInstance[],
  board: BoardConfig,
  maxSteps: number,
  /** 이동을 시작하는 칸. 기본은 기물의 현재 위치지만, 추가 이동을 계획 중이면 앞 구간의 도착 칸이다. */
  from?: Position,
  /** 이번 계획이 적을 밟고 지나가는 이동인지(tank2 돌진). */
  passesThroughEnemies = false,
): MoveOption[] {
  const origin = from ?? unit.position;
  if (!origin || maxSteps <= 0) return [];
  const typeDef = getUnitType(unit.typeId);
  const dirs = typeDef.diagonalMove ? [...ORTHOGONAL_DIRECTIONS, ...DIAGONAL_DIRECTIONS] : ORTHOGONAL_DIRECTIONS;
  const passThrough = passesThroughEnemies ? (u: UnitInstance) => u.owner !== unit.owner : undefined;
  const options: MoveOption[] = [];
  for (const dir of dirs) {
    const cells = reachableSteps(origin, dir, maxSteps, board, allUnits, unit.instanceId, passThrough);
    cells.forEach(({ position, distance }) => options.push({ position, direction: dir, distance }));
  }
  return options;
}

/**
 * 이번 계획이 tank2 돌진인지 — 돌진일 때만 경로에 적을 끼워 넣을 수 있다(적을 밟고 지나가므로).
 * 보드 하이라이트와 엔진(resolvers/movement.ts의 isDash)이 같은 조건을 봐야 "초록으로 떴는데
 * 실제로는 못 간다"는 어긋남이 생기지 않는다.
 */
export function isDashPlanning(unit: UnitInstance, plan: UnitTurnPlan): boolean {
  return unit.typeId === 'tank2' && plan.skillUse?.skillId === 'tank2_charge' && !isSkillMovePlanning(plan);
}

/**
 * "지금 보드에서 클릭하면 어느 구간을 채우는가"를 나타내는 커서.
 *
 * 한 번의 이동은 한 방향이므로, dealer2처럼 이동을 여러 번 얻은 기물은 **구간을 하나씩** 찍어
 * 나가야 한다. 그래서 초록 이동 칸도 기물의 현재 위치가 아니라 **아직 안 채운 첫 구간의 출발
 * 칸(= 앞 구간의 도착 칸)** 기준으로 그려야 한다 — 그렇지 않으면 기본 이동을 찍은 뒤에는
 * 보드 클릭으로 추가 이동을 지정할 방법이 없다.
 */
export interface MovePlanCursor {
  /** 이번 클릭이 채울 구간 번호(0 = 기본 이동) */
  segmentIndex: number;
  /** 그 구간이 출발하는 칸 */
  origin: Position;
  /** 그 구간에 쓸 수 있는 최대 칸수 */
  maxSteps: number;
  /** 이미 확정된 앞 구간들 — 클릭 결과를 이어 붙일 때 그대로 앞에 둔다. */
  priorSegments: Direction[][];
  /**
   * 추가 이동 구간이라 칸수를 고를 수 없는지. true면 방향만 정하고 칸수는 항상 이동 Lv이며,
   * 장애물·판 끝에 막힐 때만 그 앞 칸까지로 짧아진다.
   */
  fixedLength: boolean;
}

/**
 * 이번 계획의 이동을 **기술 몫으로만** 채워야 하는지.
 *
 * 기본 행동을 공격으로 잡으면 기본 이동 구간은 아예 없고, "이동을 한 번 더" 주는 기술이 준 구간만
 * 쓸 수 있다(사용자 확정 규칙: 공격이면 이동×3이 아니라 기술 3회분만 움직인다).
 * 기본 행동이 '없음'일 때는 아직 아무것도 정하지 않은 상태이므로 평범한 기본 이동을 계획하게 둔다.
 */
export function isSkillMovePlanning(plan: UnitTurnPlan): boolean {
  return plan.baseAction.kind === 'attack' || plan.baseAction.kind === 'attackAt';
}

export function movePlanCursor(
  unit: UnitInstance,
  board: BoardConfig,
  plan: UnitTurnPlan,
  turnNumber: number,
): MovePlanCursor | null {
  if (!unit.position) return null;
  const skillUse = plan.skillUse;
  const capacities = moveSegmentCapacities(unit, skillUse, sumMagnitude(unit, 'moveBonus', turnNumber));
  const path = resolveMovePath(unit, plan, moveCapacity(unit, turnNumber, plan));
  const segLengths = resolveSegmentLengths(unit, plan, path.length);

  // 기본 행동이 공격이면 기본 이동 구간(0번)은 쓸 수 없다 — 기술이 준 구간부터 찍는다.
  const firstEditable = isSkillMovePlanning(plan) ? 1 : 0;
  // 아직 한 칸도 안 채운 첫 구간이 목표. 전부 채웠다면 처음 구간부터 다시 찍는 것으로 본다
  // (그래야 계획을 세운 뒤에도 보드 클릭만으로 경로를 갈아엎을 수 있다).
  let segmentIndex = capacities.findIndex((_, i) => i >= firstEditable && (segLengths[i] ?? 0) === 0);
  if (segmentIndex < 0) segmentIndex = firstEditable;

  const segments: Direction[][] = [];
  let acc = 0;
  for (const len of segLengths) {
    segments.push(path.slice(acc, acc + len));
    acc += len;
  }
  // 앞 구간이 아직 없으면(기술 이동의 0번 구간 등) 빈 구간으로 채워 번호를 맞춘다.
  const priorSegments = Array.from({ length: segmentIndex }, (_, i) => segments[i] ?? []);
  // 앞 구간을 실제로 걸어가 출발 칸을 구한다. 장애물에 막히면 거기서 계획이 끝나므로 더 못 찍는다.
  // (아직 계획되지 않은 앞 구간은 0칸으로 봐야 커서가 제자리에서 시작한다.)
  const priorLengths = priorSegments.map((seg) => seg.length);
  const origin = segmentOrigins(unit.position, path, priorLengths, board)[segmentIndex];
  const fixedLength = segmentIndex > 0 && wholeExtraMoveUses(unit, skillUse) > 0;
  if (!origin) return { segmentIndex, origin: unit.position, maxSteps: 0, priorSegments, fixedLength };
  return { segmentIndex, origin, maxSteps: capacities[segmentIndex] ?? 0, priorSegments, fixedLength };
}

/**
 * 추가 이동 구간의 보드 클릭 후보 — 방향마다 **딱 한 칸**(이동 Lv만큼 간 칸, 장애물·판 끝에
 * 막히면 그 앞 칸)만 내놓는다. 칸수를 고를 수 없다는 규칙을 보드 쪽에서도 그대로 지키기 위해서다.
 */
export function computeFixedMoveOptions(unit: UnitInstance, board: BoardConfig, cursor: MovePlanCursor): MoveOption[] {
  if (cursor.maxSteps <= 0) return [];
  const typeDef = getUnitType(unit.typeId);
  const dirs = typeDef.diagonalMove ? [...ORTHOGONAL_DIRECTIONS, ...DIAGONAL_DIRECTIONS] : ORTHOGONAL_DIRECTIONS;
  const options: MoveOption[] = [];
  for (const dir of dirs) {
    const distance = staticRunLimit(cursor.origin, dir, cursor.maxSteps, board);
    if (distance <= 0) continue;
    let position = cursor.origin;
    for (let i = 0; i < distance; i++) position = step(position, dir);
    options.push({ position, direction: dir, distance });
  }
  return options;
}

/** 커서가 가리키는 구간을 "그 칸까지 직진"으로 채운 새 구간 배열(0번 = 기본 이동). */
export function applyMoveOption(cursor: MovePlanCursor, option: MoveOption): Direction[][] {
  const run = Array<Direction>(option.distance).fill(option.direction);
  return [...cursor.priorSegments, run];
}

/** 계획에 저장할 이동 형태. 기술 이동은 기본 행동을 건드리지 않고 `skillMove`에만 담긴다. */
export type MovePlanPatch =
  | { kind: 'base'; action: BaseAction }
  | { kind: 'skill'; skillMove: SkillMove | undefined };

/**
 * 구간 배열을 계획에 저장할 형태로 바꾼다.
 * `skillOnly`(기본 행동이 공격)면 0번 기본 이동 구간을 떼고 기술이 만든 구간만 저장한다 —
 * 그래야 "기본 행동은 공격, 이동은 전부 기술 몫"이라는 규칙이 데이터에도 그대로 남는다.
 */
export function movePlanFromSegments(segments: Direction[][], skillOnly: boolean): MovePlanPatch {
  const trimmed = [...segments];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].length === 0) trimmed.pop(); // 빈 꼬리 구간 제거

  if (skillOnly) {
    const extras = trimmed.slice(1);
    const path = extras.flat();
    return {
      kind: 'skill',
      skillMove: path.length > 0 ? { path, segmentLengths: extras.map((s) => s.length) } : undefined,
    };
  }
  const path = trimmed.flat();
  if (path.length === 0) return { kind: 'base', action: { kind: 'none' } };
  return {
    kind: 'base',
    action: {
      kind: 'move',
      direction: path[0],
      distance: path.length,
      path,
      segmentLengths: trimmed.map((s) => s.length),
    },
  };
}

/**
 * 추가 이동 구간의 길이는 사용자가 고르는 값이 아니라 **방향과 장애물이 결정한다**.
 * 그래서 어떤 구간이 바뀌든(기본 이동 칸수를 줄여 출발 칸이 밀리는 경우 포함) 뒤 구간들의 길이를
 * 전부 다시 계산해 준다 — 그렇지 않으면 편집기가 엔진이 거부할 계획을 만들어 낸다.
 */
export function normalizeMoveSegments(
  unit: UnitInstance,
  board: BoardConfig,
  skillUse: SkillUse | undefined,
  turnNumber: number,
  segments: Direction[][],
): Direction[][] {
  if (!unit.position || wholeExtraMoveUses(unit, skillUse) <= 0) return segments;
  const capacities = moveSegmentCapacities(unit, skillUse, sumMagnitude(unit, 'moveBonus', turnNumber));
  const out: Direction[][] = [];
  let pos: Position | null = unit.position;
  segments.forEach((seg, i) => {
    if (i === 0 || seg.length === 0 || !pos) {
      out.push(seg);
    } else {
      const dir = seg[0];
      const length = staticRunLimit(pos, dir, capacities[i] ?? 0, board);
      out.push(Array<Direction>(length).fill(dir));
    }
    for (const dir of out[i]) {
      if (!pos) break;
      pos = staticStep(pos, dir, board);
    }
  });
  return out;
}

/**
 * 선택된 유닛이 보드 클릭만으로 공격 방향을 지정할 수 있도록, 공격 사거리 내
 * 모든 칸을 방향과 함께 계산한다(범위공격은 밴드 전체를 같은 방향으로 취급).
 */
export function computeAttackOptions(
  unit: UnitInstance,
  board: BoardConfig,
  /** 공격을 쏘는 칸. 기본은 현재 위치지만, "기술 이동 후 공격"이면 이동 도착 칸이다. */
  from?: Position,
): AttackOption[] {
  const origin = from ?? unit.position;
  if (!origin) return [];
  const typeDef = getUnitType(unit.typeId);
  if (!typeDef.canAttack) return [];
  const dirs = directionsForAxis(typeDef.attackShape.axis);
  const options: AttackOption[] = [];
  for (const dir of dirs) {
    const cells =
      typeDef.attackShape.kind === 'aoe' && typeDef.attackShape.aoeShape === 'line'
        ? frontBandCells(origin, dir, board)
        : lineCells(origin, dir, attackRangeFor(typeDef.attackShape, dir), board);
    cells.forEach((position) => options.push({ position, direction: dir }));
  }
  return options;
}

/**
 * 이번 턴 기본 공격을 실제로 **쏘게 될 칸**. 기술 이동을 계획했다면 그 이동을 마친 도착 칸이고
 * (이동은 1단계, 공격은 3단계라 도착 칸에서 쏘게 된다), 아니면 지금 서 있는 칸이다.
 */
export function attackOrigin(
  unit: UnitInstance,
  allUnits: UnitInstance[],
  board: BoardConfig,
  plan: UnitTurnPlan,
  turnNumber: number,
): Position | null {
  if (!unit.position) return null;
  if (!isSkillOnlyMove(plan)) return unit.position;
  const steps = previewMoveSteps(unit, allUnits, board, plan, turnNumber);
  return previewMoveDestination(steps, unit) ?? unit.position;
}

export function findMoveOption(options: MoveOption[], p: Position): MoveOption | undefined {
  return options.find((o) => samePosition(o.position, p));
}

export function findAttackOption(options: AttackOption[], p: Position): AttackOption | undefined {
  return options.find((o) => samePosition(o.position, p));
}

/** 미리보기 경로의 한 구간(스텝). isExtra면 기술로 얻은 추가 이동 구간이라 다른 색으로 그린다. */
export interface PreviewStep {
  from: Position;
  to: Position;
  /** 0-indexed 스텝 번호 — UI의 "n번 이동"은 stepIndex + 1이다. */
  stepIndex: number;
  /** 기본 이동력을 넘어선 스텝(dealer2 시간역행 등 기술로 얻은 칸)인지 */
  isExtra: boolean;
  /** 0 = 기본 이동, 1.. = 기술을 n회째 써서 얻은 추가 이동 구간 */
  segmentIndex: number;
  /** 이 스텝이 자기 구간의 마지막 칸인지 — 보드에 "기본 이동 도착 / 기술 n회 도착"을 찍는 지점 */
  isSegmentEnd: boolean;
}

/**
 * 공개(해결) 전, "이렇게 움직일 예정" 미리보기 경로를 스텝 단위로 계산한다.
 * 실제 해결 엔진(resolvers/movement.ts)과 완전히 같은 경로 해석(engine/movePath.ts)을 공유하되,
 * 동시에 계획 중인 다른 유닛들과의 충돌은 고려하지 않는 단일 유닛 근사치다 — 정확한 결과는
 * 공개 시점의 우선순위·상대 계획에 따라 달라질 수 있으므로 "예정" 표시로만 사용한다.
 */
export function previewMoveSteps(
  unit: UnitInstance,
  allUnits: UnitInstance[],
  board: BoardConfig,
  plan: UnitTurnPlan,
  turnNumber: number,
): PreviewStep[] {
  if (!unit.position) return [];
  const others = allUnits.filter((u) => u.instanceId !== unit.instanceId && u.alive);
  const path = resolveMovePath(unit, plan, moveCapacity(unit, turnNumber, plan));
  if (path.length === 0) return [];
  // 구간 경계는 계획에 담긴 구간별 길이가 결정한다 — 이동 Lv로 균등하게 자르면 "기술1은 2칸만"처럼
  // 구간을 덜 쓴 계획에서 이후 구간 표시가 통째로 밀린다.
  const segLengths = resolveSegmentLengths(unit, plan, path.length);
  const segByStep = segmentIndexByStep(segLengths);

  const steps: PreviewStep[] = [];
  let current = unit.position;
  for (let i = 0; i < path.length; i++) {
    const next = step(current, path[i]);
    if (!isWalkable(next, board, others)) break; // 막히면 그 앞에서 멈춘다(엔진과 동일)
    steps.push({
      from: current,
      to: next,
      stepIndex: i,
      isExtra: (segByStep[i] ?? 0) > 0,
      segmentIndex: segByStep[i] ?? 0,
      isSegmentEnd: segByStep[i] !== segByStep[i + 1], // 다음 스텝이 다른 구간이면(또는 없으면) 여기가 도착점
    });
    current = next;
  }
  // 경로가 장애물에 막혀 중간에 잘렸어도 실제로 멈추는 칸은 최종 도착점이므로 반드시 표시한다.
  // (구간 경계 판정만으로는 잘린 마지막 스텝에 도착 표식이 붙지 않아 "기술 3회 도착"이 사라진다.)
  const last = steps[steps.length - 1];
  if (last) last.isSegmentEnd = true;
  return steps;
}

/** 미리보기 경로의 최종 도착 칸(제자리면 null). */
export function previewMoveDestination(steps: PreviewStep[], unit: UnitInstance): Position | null {
  const last = steps[steps.length - 1];
  if (!last || !unit.position) return null;
  return samePosition(last.to, unit.position) ? null : last.to;
}
