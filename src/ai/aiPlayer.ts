import type {
  ActionPlan,
  BaseAction,
  BoardConfig,
  Direction,
  GameState,
  Owner,
  Position,
  AttackShape,
  SkillDef,
  UnitInstance,
  UnitTurnPlan,
} from '../engine/types';
import { getUnitType, unitTypes } from '../data/unitTypes';
import {
  DIAGONAL_DIRECTIONS,
  ORTHOGONAL_DIRECTIONS,
  inBounds,
  isObstacle,
  samePosition,
  step,
} from '../engine/grid';
import { frontBandCells, isWithinSkillRange, lineCells } from '../engine/targeting';
import { skillRangeSpec } from '../engine/skillRange';
import { hasActiveEffect, sumMagnitude } from '../engine/statusEffects';
import { isActionLegal, sanitizePlan } from '../engine/validation';
import { staticRunLimit } from '../engine/movePath';
// 동전은 해결 단계에서 굴러가므로 계획 시점에는 결과를 알 수 없다 — AI도 앞면 기준(최대치)으로 본다.
import { plannedAttackPower, plannedMoveSpeed } from '../engine/unitStats';
import type { RngFn } from '../engine/rng';
import { ROSTER_SIZE } from '../data/constants';
import { DIFFICULTY_PROFILES, type AiDifficulty, type DifficultyProfile } from './difficulty';

export type { AiDifficulty } from './difficulty';

/**
 * 규칙 기반(휴리스틱) AI.
 *
 * 탐색 트리를 돌리지 않는다 — 동시 턴이라 상대 계획을 모르는 상태에서의 미니맥스는 의미가 약하고,
 * 5기물 × (이동 후보 + 공격 방향 + 기술 조합)만 해도 분기가 폭발한다. 대신 **기물 하나씩 독립적으로**
 * "이번 턴에 낼 수 있는 계획 후보"를 만들고 한 수 평가(피해 + 위치 + 위협)로 고른다. 기물 간 협동은
 * 점령지·적 위치라는 **공유된 목표 점수**를 통해 간접적으로만 일어난다.
 *
 * 모든 후보는 마지막에 `isActionLegal`로 거르므로, 여기서 규칙을 조금 잘못 계산해도 엔진이 거부할
 * 계획이 밖으로 나가지는 않는다(그 후보가 조용히 탈락할 뿐이다).
 */

/** 어떤 기물을 먼저 죽이는 게 이득인지 — 역할별 가중치. */
function roleValue(unit: UnitInstance): number {
  if (unit.isTurret) return 0.35;
  switch (getUnitType(unit.typeId).role) {
    case 'dealer':
      return 1.35;
    case 'support':
      return 1.2;
    default:
      return 1;
  }
}

function chebyshev(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * 이 칸에서 그 기술로 대상에게 닿는지. 사거리와 축은 전부 데이터/공용 표에서 읽는다
 * (engine/skillRange.ts) — AI가 자기 숫자를 따로 들고 있으면 데이터를 바꿔도 AI만 옛날 값으로
 * 움직이게 되고, 실제로 그 버그 때문에 회복 사거리를 4→7로 올려도 시뮬레이션 결과가 한 자리도
 * 변하지 않았다.
 */
function reaches(from: Position, target: UnitInstance, skill: SkillDef, board: BoardConfig): boolean {
  const spec = skillRangeSpec(skill);
  if (!spec || !target.position) return false;
  return isWithinSkillRange(from, target.position, spec.range, board, spec.axis);
}

/** 점령지까지의 거리(가장 가까운 점령 칸 기준). 점령지 안이면 0. */
export function distanceToCaptureZone(p: Position, board: BoardConfig): number {
  let best = Infinity;
  for (const c of board.captureZone) best = Math.min(best, chebyshev(p, c));
  return best === Infinity ? 0 : best;
}

function livingUnits(state: GameState, owner: Owner): UnitInstance[] {
  return state.units.filter((u) => u.alive && u.owner === owner && u.position);
}

function occupantAt(state: GameState, p: Position, excludeId?: string): UnitInstance | undefined {
  return state.units.find((u) => u.alive && u.instanceId !== excludeId && u.position && samePosition(u.position, p));
}

function adjacentAllyOf(target: UnitInstance, units: UnitInstance[]): boolean {
  if (!target.position) return false;
  return ORTHOGONAL_DIRECTIONS.some((dir) => {
    const adj = step(target.position!, dir);
    return units.some(
      (u) => u.alive && u.instanceId !== target.instanceId && u.owner === target.owner && u.position && samePosition(u.position, adj),
    );
  });
}

/** 피해 하나의 가치 — 넘치는 피해(오버킬)는 세지 않고, 처치는 별도로 크게 쳐준다. */
function damageValue(target: UnitInstance, amount: number, profile: DifficultyProfile): number {
  const pool = target.currentHp + target.shieldHp;
  const effective = Math.min(amount, pool);
  const kills = amount >= pool;
  return effective * roleValue(target) + (kills ? profile.killWeight * roleValue(target) : 0);
}

/**
 * `from`에서 `direction`으로 기본 공격을 쐈을 때의 기대 가치.
 * 실제 해결(resolvers/attacks.ts)과 같은 규칙을 본다 — 아군이 사선을 막고, 방벽은 직선 공격을 무효화하며,
 * 범위형(tank3)은 밴드 안의 적 전원을 때린다.
 */
function attackValue(
  state: GameState,
  unit: UnitInstance,
  from: Position,
  direction: Direction,
  profile: DifficultyProfile,
): number {
  const typeDef = getUnitType(unit.typeId);
  const power = plannedAttackPower(unit);
  const shape = typeDef.attackShape;

  if (shape.kind === 'aoe' && shape.aoeShape === 'line') {
    let total = 0;
    for (const cell of frontBandCells(from, direction, state.board)) {
      const occupant = occupantAt(state, cell, unit.instanceId);
      if (occupant && occupant.owner !== unit.owner) total += damageValue(occupant, power, profile);
    }
    return total;
  }

  for (const cell of lineCells(from, direction, shape.range, state.board)) {
    const occupant = occupantAt(state, cell, unit.instanceId);
    if (!occupant) continue;
    if (occupant.owner === unit.owner) return 0; // 아군이 사선을 막는다
    if (hasActiveEffect(occupant, 'barrier', state.turnNumber)) return 0;
    let amount = power;
    if (unit.typeId === 'dealer4' && adjacentAllyOf(occupant, state.units)) {
      amount += typeDef.passive?.payload?.bonusDamage ?? 0;
    }
    return damageValue(occupant, amount, profile);
  }
  return 0;
}

/**
 * `from`에 선 기물이 `to` 칸을 **공격 사거리·축 안에 넣기까지** 필요한 최소 이동 칸 수.
 * 이미 조준선 위면 0이다.
 *
 * 왜 이게 필요한가: 예전 `threatAt`은 체비쇼프 거리 하나로만 위협을 쟀다. 그러면 직선 공격
 * 기물이 자기 행·열이 아닌 칸까지 전부 위협하는 것으로 계산돼, 실제로는 못 맞히는 기물이
 * 주변 사각형 전체를 지배하는 것처럼 보인다. support2에 공격을 줬을 때 승점이 44→51%로
 * 뛰었다가 위협 계산에서 빼자 44%로 돌아온 게 바로 이 과대평가였다.
 *
 * 장애물과 다른 기물은 일부러 무시한다 — 막힐 수도 있다는 이유로 위협을 깎으면 실제로 뚫렸을 때
 * 그대로 죽는다. 위협은 **상한**으로 잡는 편이 안전하다.
 */
export function stepsToLineUp(from: Position, to: Position, shape: AttackShape, diagonalMove: boolean): number {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const r = shape.range;

  /**
   * 한 걸음이 (dx, dy)를 얼마나 바꿀 수 있는지가 이동 방식으로 갈린다:
   *   - 대각선 이동 가능 → 한 걸음에 둘 다 1씩 바꿀 수 있으므로 **더 큰 쪽**이 곧 걸음 수다
   *   - 직교 이동만 가능 → 한 걸음에 하나씩만 바꾸므로 **합**이 걸음 수다
   * 이 구분이 없으면 dealer4(대각 이동)의 접근 속도를 실제보다 느리게 본다.
   */
  const cost = (needX: number, needY: number) => (diagonalMove ? Math.max(needX, needY) : needX + needY);

  // 범위형(tank3의 전방 3칸 띠)·근접은 축 제약이 없으니 거리만 좁히면 된다. 띠의 정확한 도형 대신
  // 사거리 원으로 근사하는데, 위협을 **과소평가하지 않는** 쪽이라 안전한 방향의 오차다.
  if (shape.kind !== 'line') return cost(Math.max(0, dx - r), Math.max(0, dy - r));

  // 직선 공격: 한 축을 0으로 만들고(정렬) 남은 축을 사거리 안으로 넣어야 한다(접근).
  // 두 축 중 어느 쪽으로 정렬하든 되므로 싼 쪽을 고른다.
  const orthogonal = Math.min(cost(dx, Math.max(0, dy - r)), cost(Math.max(0, dx - r), dy));

  // 대각선 공격: dx == dy == t(단 t ≤ 사거리)가 되어야 사선에 오른다. t를 0..사거리로 훑어
  // 가장 싼 값을 고른다 — 사거리가 6 이하라 순회 비용은 무시할 만하고, 닫힌 식보다 틀릴 여지가 없다.
  let diagonal = Infinity;
  for (let t = 0; t <= r; t++) diagonal = Math.min(diagonal, cost(Math.abs(dx - t), Math.abs(dy - t)));

  const axis = shape.axis ?? 'orthogonal';
  if (axis === 'orthogonal') return orthogonal;
  if (axis === 'diagonal') return diagonal;
  return Math.min(orthogonal, diagonal);
}

/**
 * 이 칸에 서면 **이번 턴 공격 단계에서** 적에게 얼마나 맞을 수 있는지.
 *
 * 동시 턴이라 적도 이번 턴에 움직인 뒤 때린다 — 그래서 "적의 이동력만큼 다가와서 조준선에
 * 올릴 수 있는가"를 본다. 이번 턴에 때릴 수 없는 게 확실한 적은 아예 세지 않는다:
 *
 *   - 기본공격 쿨타임 중(dealer1은 한 번 쏘면 3턴을 못 쏜다) → 이번 턴 공격이 불법이다
 *   - 구속당한 적 → 다가올 수 없다(사거리는 그대로 위협)
 *   - dealer3 → 이동과 공격이 같은 턴에 절대 불가하다(validation.ts). 제자리 사거리만 위협
 *
 * 앞의 두 가지는 `validation.ts`가 강제하는 규칙을 그대로 옮긴 것이라 근사치가 아니라 정확하다.
 */
export function threatAt(state: GameState, unit: UnitInstance, dest: Position): number {
  let threat = 0;
  for (const enemy of livingUnits(state, unit.owner === 'p1' ? 'p2' : 'p1')) {
    const typeDef = getUnitType(enemy.typeId);
    if (!typeDef.canAttack) continue;
    // 이번 턴에 기본공격 자체가 불법인 적은 위협이 0이다.
    if ((enemy.cooldowns['basicAttack'] ?? 0) > 0) continue;

    // **적의** 이동력이다. 예전에는 여기에 위협을 받는 쪽(`unit`)의 이동력이 들어가 있어서,
    // 발이 느린 기물은 적을 실제보다 덜 무서워하고 발 빠른 기물은 더 무서워했다 — 정확히 반대다.
    const canClose = !hasActiveEffect(enemy, 'root', state.turnNumber) && enemy.typeId !== 'dealer3';
    const allowance = canClose ? plannedMoveSpeed(enemy) : 0;

    if (stepsToLineUp(enemy.position!, dest, typeDef.attackShape, typeDef.diagonalMove) <= allowance) {
      threat += plannedAttackPower(enemy);
    }
  }
  return threat;
}

/**
 * 도착 칸 자체의 가치. 이 게임의 승리 조건은 점령이므로 **점령지 근접이 기본 나침반**이고,
 * 체력이 적을수록 위협받는 칸을 더 강하게 피한다(탱커는 어차피 맞으러 가는 역할이라 덜 피한다).
 */
function positionValue(state: GameState, unit: UnitInstance, dest: Position, profile: DifficultyProfile): number {
  const board = state.board;
  const inZone = board.captureZone.some((c) => samePosition(c, dest));
  let score = inZone ? 14 * profile.captureWeight : -distanceToCaptureZone(dest, board) * 0.9 * profile.captureWeight;

  // 적에게서 너무 멀면 아무 일도 일어나지 않는다 — 아주 약한 접근 성향만 준다.
  const enemies = livingUnits(state, unit.owner === 'p1' ? 'p2' : 'p1');
  if (enemies.length > 0) {
    const nearest = Math.min(...enemies.map((e) => chebyshev(dest, e.position!)));
    score -= Math.min(nearest, 12) * 0.2;
  }

  const hpRatio = unit.maxHp > 0 ? unit.currentHp / unit.maxHp : 1;
  const squishiness = getUnitType(unit.typeId).role === 'tank' ? 0.4 : 1;
  score -= threatAt(state, unit, dest) * profile.threatWeight * squishiness * (1.3 - hpRatio);
  return score;
}

/** `direction`으로 최대 `cap`칸 직진했을 때 실제로 지나가는 칸들과, 돌진이면 밟은 적들. */
function walkLine(
  state: GameState,
  unit: UnitInstance,
  direction: Direction,
  cap: number,
  dash: boolean,
): { cells: Position[]; trampled: UnitInstance[] } {
  const cells: Position[] = [];
  const trampled: UnitInstance[] = [];
  let current = unit.position!;
  for (let i = 0; i < cap; i++) {
    const next = step(current, direction);
    if (!inBounds(next, state.board) || isObstacle(next, state.board)) break;
    const occupant = occupantAt(state, next, unit.instanceId);
    if (occupant && (!dash || occupant.owner === unit.owner)) break;
    if (occupant) trampled.push(occupant);
    current = next;
    cells.push(current);
  }
  // 밟고 지나간 적 위에서는 멈출 수 없다(resolvers/movement.ts와 동일).
  while (cells.length > 0 && occupantAt(state, cells[cells.length - 1], unit.instanceId)) {
    const dropped = cells.pop()!;
    const last = trampled[trampled.length - 1];
    if (last?.position && samePosition(last.position, dropped)) trampled.pop();
  }
  return { cells, trampled };
}

function moveAction(direction: Direction, steps: number, segmentLengths?: number[]): BaseAction {
  return {
    kind: 'move',
    direction,
    distance: steps,
    path: Array<Direction>(steps).fill(direction),
    ...(segmentLengths ? { segmentLengths } : {}),
  };
}

function moveDirections(unit: UnitInstance): Direction[] {
  return getUnitType(unit.typeId).diagonalMove ? [...ORTHOGONAL_DIRECTIONS, ...DIAGONAL_DIRECTIONS] : ORTHOGONAL_DIRECTIONS;
}

function attackDirections(unit: UnitInstance): Direction[] {
  const axis = getUnitType(unit.typeId).attackShape.axis;
  if (axis === 'diagonal') return DIAGONAL_DIRECTIONS;
  if (axis === 'both') return [...ORTHOGONAL_DIRECTIONS, ...DIAGONAL_DIRECTIONS];
  return ORTHOGONAL_DIRECTIONS;
}

/** 한 후보 = 하나의 계획 + 그 계획을 실행했을 때 서 있게 될 칸 + 계획 고유의 가산점. */
interface Candidate {
  plan: UnitTurnPlan;
  dest: Position;
  bonus: number;
}

function generateCandidates(state: GameState, unit: UnitInstance, profile: DifficultyProfile): Candidate[] {
  const here = unit.position!;
  const typeDef = getUnitType(unit.typeId);
  const turn = state.turnNumber;
  const enemies = livingUnits(state, unit.owner === 'p1' ? 'p2' : 'p1');
  const allies = livingUnits(state, unit.owner);
  const rooted = hasActiveEffect(unit, 'root', turn);
  const carriedMoveBonus = sumMagnitude(unit, 'moveBonus', turn);
  const attackModeOn = hasActiveEffect(unit, 'attackMode', turn);
  const skillReady = (id: string) => (unit.cooldowns[id] ?? 0) <= 0;
  const out: Candidate[] = [];
  const push = (plan: UnitTurnPlan, dest: Position, bonus = 0) => out.push({ plan, dest, bonus });

  push({ baseAction: { kind: 'none' } }, here);

  /** 이번 턴 이동 후보(방향 × 칸수). dealer3은 공격 모드가 켜져 있으면 이동 자체가 불법이다. */
  const moveCandidates: { action: BaseAction; dest: Position }[] = [];
  if (!rooted && !(unit.typeId === 'dealer3' && attackModeOn)) {
    const cap = plannedMoveSpeed(unit) + carriedMoveBonus;
    for (const dir of moveDirections(unit)) {
      const { cells } = walkLine(state, unit, dir, cap, false);
      cells.forEach((dest, i) => moveCandidates.push({ action: moveAction(dir, i + 1), dest }));
    }
  }
  for (const m of moveCandidates) push({ baseAction: m.action }, m.dest);

  const canAttackNow = typeDef.canAttack && (unit.cooldowns['basicAttack'] ?? 0) <= 0;
  const attackable = canAttackNow && !(unit.typeId === 'dealer3' && !attackModeOn);
  if (attackable) {
    for (const dir of attackDirections(unit)) push({ baseAction: { kind: 'attack', direction: dir } }, here);
  }

  if (!profile.useSkills) return out;

  // ── 기술 후보 ──────────────────────────────────────────────────────────────
  // tank1 방어 태세: 최대·현재 체력 +5와 같은 양의 보호막, 그리고 이동 +1. 맞을 자리에 있을 때만 값어치가 있다.
  if (unit.typeId === 'tank1' && skillReady('tank1_fortify')) {
    const fortify = { skillId: 'tank1_fortify' };
    const worth = threatAt(state, unit, here) > 0 ? 9 : 2;
    push({ baseAction: { kind: 'none' }, skillUse: fortify }, here, worth);
    if (attackable) {
      for (const dir of attackDirections(unit)) {
        push({ baseAction: { kind: 'attack', direction: dir }, skillUse: fortify }, here, worth);
      }
    }
    if (!rooted) {
      const cap = plannedMoveSpeed(unit) + carriedMoveBonus + 1;
      for (const dir of moveDirections(unit)) {
        const { cells } = walkLine(state, unit, dir, cap, false);
        cells.forEach((dest, i) => push({ baseAction: moveAction(dir, i + 1), skillUse: fortify }, dest, worth));
      }
    }
  }

  // tank2 돌진: 이동 +1 + 경로의 적을 밟고 지나가며 이동 칸수만큼 피해. 방향별로 **끝까지** 달리는 수만 본다
  // (돌진 피해는 이동 칸수에 비례하므로 중간에 멈추는 건 거의 항상 손해다).
  if (unit.typeId === 'tank2' && skillReady('tank2_charge') && !rooted) {
    const cap = plannedMoveSpeed(unit) + carriedMoveBonus + 1;
    for (const dir of moveDirections(unit)) {
      const { cells, trampled } = walkLine(state, unit, dir, cap, true);
      if (cells.length === 0) continue;
      const damage = cells.length;
      const bonus = trampled.reduce((sum, e) => sum + damageValue(e, damage, profile), 0);
      push({ baseAction: moveAction(dir, cells.length), skillUse: { skillId: 'tank2_charge' } }, cells[cells.length - 1], bonus);
    }
  }

  // tank3: 방벽(자신에게 오는 직선 공격 무효) / 구속(적 1명 1턴 이동 불가)
  if (unit.typeId === 'tank3') {
    if (skillReady('tank3_barrier')) {
      const barrier = { skillId: 'tank3_barrier' };
      const worth = Math.min(threatAt(state, unit, here), 12) * 0.8;
      push({ baseAction: { kind: 'none' }, skillUse: barrier }, here, worth);
      if (attackable) {
        for (const dir of attackDirections(unit)) {
          push({ baseAction: { kind: 'attack', direction: dir }, skillUse: barrier }, here, worth);
        }
      }
    }
    if (skillReady('tank3_root')) {
      // 점령지에 있거나 점령지로 달려오는 적을 묶는 게 가장 값어치가 크다.
      // 사거리 안의 적만 고른다 — 예전에는 판 위의 적 전체에서 골랐고, 엔진도 사거리를 안 봐서
      // 맵 반대편 기물을 묶을 수 있었다.
      const rootSkill = typeDef.skills.find((s) => s.id === 'tank3_root')!;
      const target = pickBy(
        enemies.filter((e) => reaches(here, e, rootSkill, state.board)),
        (e) => 12 - distanceToCaptureZone(e.position!, state.board) - chebyshev(here, e.position!) * 0.5,
      );
      if (target) {
        const root = { skillId: 'tank3_root', target: target.instanceId };
        push({ baseAction: { kind: 'none' }, skillUse: root }, here, 6);
        if (attackable) {
          for (const dir of attackDirections(unit)) push({ baseAction: { kind: 'attack', direction: dir }, skillUse: root }, here, 6);
        }
      }
    }
  }

  // dealer2 추가 이동: 충전 1개 = 이동 한 번 더. **충전을 0으로 만들면 첫 사용 지점으로 되감기**되므로
  // 마지막 한 개는 남겨 둔다(되감기를 전술로 쓰는 건 사람 몫).
  if (unit.typeId === 'dealer2' && !rooted && (unit.charges['dealer2_rewind_move'] ?? 0) >= 2) {
    const baseCap = plannedMoveSpeed(unit) + carriedMoveBonus;
    for (const dir of moveDirections(unit)) {
      const first = staticRunLimit(here, dir, baseCap, state.board);
      let origin = here;
      for (let i = 0; i < first; i++) origin = step(origin, dir);
      const second = staticRunLimit(origin, dir, plannedMoveSpeed(unit), state.board);
      if (second <= 0) continue;
      const { cells } = walkLine(state, unit, dir, first + second, false);
      if (cells.length === 0) continue;
      push(
        {
          baseAction: moveAction(dir, first + second, [first, second]),
          skillUse: { skillId: 'dealer2_rewind_move', amount: 1 },
        },
        cells[cells.length - 1],
      );
    }
  }

  // dealer3 공격 모드 토글: 켜야 쏠 수 있고, 켠 동안은 못 움직인다 — 사거리 안에 적이 들어왔을 때만 켠다.
  if (unit.typeId === 'dealer3') {
    const toggle = { skillId: 'dealer3_attack_mode' };
    if (!attackModeOn) {
      for (const dir of attackDirections(unit)) {
        push({ baseAction: { kind: 'attack', direction: dir }, skillUse: toggle }, here);
      }
    } else {
      push({ baseAction: { kind: 'none' }, skillUse: toggle }, here, -2);
      if (!rooted) {
        for (const dir of moveDirections(unit)) {
          const { cells } = walkLine(state, unit, dir, plannedMoveSpeed(unit) + carriedMoveBonus, false);
          cells.forEach((dest, i) => push({ baseAction: moveAction(dir, i + 1), skillUse: toggle }, dest, -2));
        }
      }
    }
  }

  // support1 범위 회복: 자기중심 반경 2 아군 전원. 다친 아군이 없으면 의미 없다.
  if (unit.typeId === 'support1') {
    const heal = { skillId: 'support1_aoe_heal' };
    const worthAt = (center: Position) =>
      allies
        .filter((a) => chebyshev(center, a.position!) <= 2)
        .reduce((sum, a) => sum + Math.min(1, a.maxHp - a.currentHp) * 3, 0);
    push({ baseAction: { kind: 'none' }, skillUse: heal }, here, worthAt(here));
    for (const m of moveCandidates) push({ baseAction: m.action, skillUse: heal }, m.dest, worthAt(m.dest));
  }

  // support2: 직선 회복 / 직선 2칸 구속 / 직선 조준 보조. 공격을 못 하는 기물이라 매 턴 셋 중
  // 하나는 써야 한다. 셋 다 사거리 안에 대상이 있어야 하므로 후보가 하나도 안 나오는 턴이 있는데,
  // 조준 보조가 생기기 전에는 그런 턴이 **전체의 90%**였다(scripts/support2Opportunity.ts).
  if (unit.typeId === 'support2') {
    const healSkill = typeDef.skills.find((s) => s.id === 'support2_heal')!;
    const rootSkill = typeDef.skills.find((s) => s.id === 'support2_root')!;
    const buffSkill = typeDef.skills.find((s) => s.id === 'support2_buff')!;
    const wounded = allies.filter((a) => a.currentHp < a.maxHp);

    // 사거리는 **도착 칸 기준**으로 따진다. 회복이 직선 제약이라 한 칸만 비켜서도 닿는 대상이
    // 통째로 바뀌므로, 제자리에서만 재면 "라인을 열려고 옆으로 서는" 수를 아예 못 찾는다.
    // (예전에는 여기에 `chebyshev(here, a) <= 4`가 하드코딩돼 있어서, 데이터의 사거리를 올려도
    //  AI가 그 숫자를 못 보고 게임이 전혀 변하지 않았다.)
    const healFrom = (from: Position) => {
      const target = pickBy(
        wounded.filter((a) => reaches(from, a, healSkill, state.board)),
        (a) => (a.maxHp - a.currentHp) * roleValue(a),
      );
      if (!target) return null;
      const worth = Math.min(3, target.maxHp - target.currentHp) * 2.5 * roleValue(target);
      return { skillUse: { skillId: 'support2_heal', target: target.instanceId }, worth };
    };
    const healHere = healFrom(here);
    if (healHere) push({ baseAction: { kind: 'none' }, skillUse: healHere.skillUse }, here, healHere.worth);
    for (const m of moveCandidates) {
      const healThere = healFrom(m.dest);
      if (healThere) push({ baseAction: m.action, skillUse: healThere.skillUse }, m.dest, healThere.worth);
    }

    const rootTarget = pickBy(
      enemies.filter((e) => reaches(here, e, rootSkill, state.board)),
      (e) => 12 - distanceToCaptureZone(e.position!, state.board),
    );
    if (rootTarget) {
      const root = { skillId: 'support2_root', target: rootTarget.instanceId };
      push({ baseAction: { kind: 'none' }, skillUse: root }, here, 5);
    }

    /**
     * 조준 보조. 회복과 달리 **다치지 않은 아군에게도** 걸리므로 후보 풀이 훨씬 넓다 — 그게 이
     * 기술을 넣은 이유 자체다. 대신 아무에게나 걸면 낭비이므로 두 가지를 거른다:
     *   - 공격을 못 하거나(`canAttack` false, 예: 다른 support2) 기본공격 쿨타임에 걸린 아군
     *     (dealer1은 한 번 쏘면 3턴을 못 쏜다 — 그 사이 버프를 주면 그대로 버려진다)
     *   - 적과 너무 멀어 이번 턴에도 다음 턴에도 못 때릴 아군
     * 지속시간이 이번 턴과 다음 턴을 덮으므로(방벽·구속과 같은 규약) 사거리 + 이동력만큼 여유를 준다.
     */
    const bonus = buffSkill.payload.attackBonus ?? 0;
    const willFight = (a: UnitInstance) => {
      const def = getUnitType(a.typeId);
      if (!def.canAttack || (a.cooldowns['basicAttack'] ?? 0) > 0) return false;
      const reach = def.attackShape.range + plannedMoveSpeed(a);
      return enemies.some((e) => chebyshev(a.position!, e.position!) <= reach);
    };
    const buffFrom = (from: Position) => {
      const target = pickBy(
        allies.filter((a) => willFight(a) && reaches(from, a, buffSkill, state.board)),
        // 같은 +N이라도 오래 살아남아 여러 번 때릴 기물에게 주는 편이 낫다.
        (a) => roleValue(a) * (a.currentHp + a.shieldHp),
      );
      if (!target) return null;
      // 버프의 값어치는 결국 "추가로 들어갈 피해"다. 회복(부상 3당 7.5점)과 눈금을 맞춰 1.5배로 둔다.
      return { skillUse: { skillId: 'support2_buff', target: target.instanceId }, worth: bonus * 1.5 * roleValue(target) };
    };
    const buffHere = buffFrom(here);
    if (buffHere) push({ baseAction: { kind: 'none' }, skillUse: buffHere.skillUse }, here, buffHere.worth);
    for (const m of moveCandidates) {
      const buffThere = buffFrom(m.dest);
      if (buffThere) push({ baseAction: m.action, skillUse: buffThere.skillUse }, m.dest, buffThere.worth);
    }
  }

  // support3 포탑: 앞칸(적 진영 방향)이 비어 있으면 매 턴 세운다 — 주변 8칸 아군을 계속 회복한다.
  // 포탑은 이동이 끝난 뒤(2단계) 도착 칸 앞에 서므로 이동과 함께 계획할 수 있다. 제자리 버전만
  // 후보로 내면 포탑 점수(+6)가 위치 점수를 항상 눌러서 이 기물이 시작지점에 영원히 붙어 있게 된다.
  if (unit.typeId === 'support3') {
    const forward: Direction = unit.owner === 'p1' ? 'down' : 'up';
    const turret = { skillId: 'support3_turret', target: forward };
    // 포탑을 새로 세우는 계획이면 **직전 포탑은 이동 전에 철거된다**(turnStart.ts). 그러니 경로와
    // 설치 칸을 볼 때는 자기 포탑을 없는 셈 쳐야 한다. 그러지 않으면 바로 앞칸에 서 있는 자기
    // 포탑이 전진을 막는 것으로 보여, 옆으로만 오가며 점령지에 영영 못 들어간다(실측: 점령 체류 0).
    const stateWithoutMyTurret: GameState = {
      ...state,
      units: state.units.filter((u) => !(u.isTurret && u.owner === unit.owner)),
    };
    const canPlaceAt = (from: Position) => {
      const cell = step(from, forward);
      return (
        inBounds(cell, state.board) &&
        !isObstacle(cell, state.board) &&
        !occupantAt(stateWithoutMyTurret, cell, unit.instanceId)
      );
    };
    if (canPlaceAt(here)) push({ baseAction: { kind: 'none' }, skillUse: turret }, here, 6);
    if (!rooted) {
      const cap = plannedMoveSpeed(unit) + carriedMoveBonus;
      for (const dir of moveDirections(unit)) {
        const { cells } = walkLine(stateWithoutMyTurret, unit, dir, cap, false);
        cells.forEach((dest, i) => {
          if (canPlaceAt(dest)) push({ baseAction: moveAction(dir, i + 1), skillUse: turret }, dest, 6);
        });
      }
    }
  }

  return out;
}

/** 점수 함수가 가장 큰 원소 하나(없으면 undefined). */
function pickBy<T>(items: T[], score: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const item of items) {
    const s = score(item);
    if (s > bestScore) {
      bestScore = s;
      best = item;
    }
  }
  return best;
}

/** 한 기물의 이번 턴 계획. 후보를 전부 평가해 가장 점수가 높은 하나를 고른다. */
export function planForUnit(state: GameState, unit: UnitInstance, profile: DifficultyProfile, rngFn: RngFn): UnitTurnPlan {
  if (!unit.alive || !unit.position) return { baseAction: { kind: 'none' } };

  let bestPlan: UnitTurnPlan = { baseAction: { kind: 'none' } };
  let bestScore = -Infinity;

  for (const candidate of generateCandidates(state, unit, profile)) {
    if (!isActionLegal(state, unit, candidate.plan)) continue;
    const base = candidate.plan.baseAction;
    const attack =
      base.kind === 'attack' ? attackValue(state, unit, candidate.dest, base.direction, profile) : 0;
    const score =
      attack + candidate.bonus + positionValue(state, unit, candidate.dest, profile) + (rngFn() - 0.5) * profile.noise;
    if (score > bestScore) {
      bestScore = score;
      bestPlan = candidate.plan;
    }
  }
  // 후보 생성이 규칙을 잘못 읽었더라도 불법 계획이 엔진에 들어가지 않게 마지막으로 한 번 더 거른다.
  return sanitizePlan(state, unit, bestPlan);
}

/** AI가 제출하는 이번 턴 전체 계획. 포탑은 계획 대상이 아니다(자동 오라만 있다). */
export function aiActionPlan(
  state: GameState,
  owner: Owner,
  difficulty: AiDifficulty,
  rngFn: RngFn = Math.random,
): ActionPlan {
  const profile = DIFFICULTY_PROFILES[difficulty];
  const actions: Record<string, UnitTurnPlan> = {};
  for (const unit of state.units) {
    if (unit.owner !== owner || unit.isTurret) continue;
    if (!unit.alive || !unit.position) continue;
    actions[unit.instanceId] = planForUnit(state, unit, profile, rngFn);
  }
  return { turnNumber: state.turnNumber, playerId: owner, actions };
}

/**
 * 드래프트. 난이도가 올라갈수록 조합의 짜임새가 좋아진다 —
 * 쉬움은 무작위라 지원 기물이 하나도 없는 편성이 나오기도 한다.
 */
const DRAFT_PRESETS: Record<AiDifficulty, string[]> = {
  easy: [],
  // 보통: 전방 탱커 둘 + 안정적인 화력 + 회복.
  normal: ['tank1', 'tank3', 'dealer1', 'dealer4', 'support1'],
  // 어려움: 점령지를 밀어붙일 돌진 + 최대 화력(공격모드) + 원거리 회복.
  hard: ['tank1', 'tank2', 'dealer3', 'dealer1', 'support1'],
};

export function aiDraftPicks(difficulty: AiDifficulty, rngFn: RngFn = Math.random): string[] {
  const preset = DRAFT_PRESETS[difficulty];
  if (preset.length === ROSTER_SIZE) return [...preset];
  const picks: string[] = [];
  while (picks.length < ROSTER_SIZE) {
    picks.push(unitTypes[Math.floor(rngFn() * unitTypes.length)].id);
  }
  return picks;
}

/**
 * 배치. 점령지에 가까운 칸부터 채우되 **탱커를 앞줄, 원거리·지원을 뒷줄**에 둔다 —
 * 시작지점은 3행이라 이 정렬만으로도 "탱커가 먼저 맞는" 진형이 나온다.
 */
export function aiPlacement(picks: string[], owner: Owner, board: BoardConfig, rngFn: RngFn = Math.random): Position[] {
  const cells = [...board.startZones[owner]];
  // 같은 거리의 칸들 사이 순서를 흔들어 매판 같은 자리에 서지 않게 한다.
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rngFn() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  cells.sort((a, b) => distanceToCaptureZone(a, board) - distanceToCaptureZone(b, board));

  const frontFirst = picks
    .map((typeId, index) => ({ typeId, index }))
    .sort((a, b) => rowPriority(a.typeId) - rowPriority(b.typeId));

  const result: Position[] = Array(picks.length).fill(null) as unknown as Position[];
  frontFirst.forEach((entry, rank) => {
    result[entry.index] = cells[rank] ?? cells[cells.length - 1];
  });
  return result;
}

function rowPriority(typeId: string): number {
  const role = getUnitType(typeId).role;
  if (role === 'tank') return 0;
  if (role === 'dealer') return 1;
  return 2;
}
