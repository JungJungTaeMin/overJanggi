import type { BoardConfig, Position, SkillDef, UnitTypeDef } from '../../engine/types';
import { unitTypes } from '../../data/unitTypes';
import { createUnitInstance } from '../../engine/createInitialState';
import { skillRangeSpec } from '../../engine/skillRange';
import { isWithinSkillRange, type SkillAxis } from '../../engine/targeting';
import { computeAttackOptions, computeMoveOptions } from '../Planning/actionGeometry';

/**
 * 도움말의 기물 그림은 **그리지 않고 계산한다.**
 *
 * 손으로 칸을 찍어 두면 스탯이 바뀌는 순간 그림만 옛날 값으로 남는다 — 이 저장소는 사거리·이동력을
 * 측정 결과에 따라 자주 고쳐 왔으므로(unitTypes.ts의 긴 주석들이 그 기록이다) 실제로 벌어질 일이다.
 * 그래서 판에서 쓰는 것과 **같은 함수**(computeMoveOptions / computeAttackOptions)를 빈 판 위에서
 * 불러 칸을 얻는다. 화면의 초록/빨강은 그 기물이 실제로 클릭할 수 있는 칸과 정의상 같다.
 */

/** 자기 자신에게 거는 기술은 "닿는 칸"이 없으므로 사거리 그림에서 뺀다. */
function skillReach(skill: SkillDef): { range: number; axis: SkillAxis } | null {
  const spec = skillRangeSpec(skill);
  if (spec) return spec;
  // 자기중심 범위 기술(support1 범위 회복)은 대상 표에 없고 payload의 반경으로만 표현된다.
  const radius = skill.payload.radius;
  return typeof radius === 'number' && radius > 0 ? { range: radius, axis: 'radius' } : null;
}

/** 이 기물이 한 턴에 닿을 수 있는 가장 먼 거리 — 모든 기물이 같은 축척을 쓰도록 판 크기를 여기서 정한다. */
function maxReach(typeDef: UnitTypeDef): number {
  const skillRanges = typeDef.skills.map((s) => skillReach(s)?.range ?? 0);
  return Math.max(
    typeDef.moveSpeed,
    coinMoveSpeed(typeDef) ?? 0,
    typeDef.attackShape.range,
    coinAttackRange(typeDef) ?? 0,
    typeDef.attackShape.diagonalRange ?? 0,
    ...skillRanges,
  );
}

/**
 * 기물마다 판 크기를 달리하면 "누가 더 멀리 가는가"가 그림에서 안 보인다 — 사거리 6짜리와 2짜리가
 * 똑같은 크기의 격자를 꽉 채운 것처럼 보이기 때문이다. 그래서 **가장 멀리 닿는 기물에 맞춘 하나의
 * 축척**을 전부가 공유한다.
 */
export const DIAGRAM_RADIUS = Math.max(...unitTypes.map(maxReach));
const SIZE = DIAGRAM_RADIUS * 2 + 1;

/** 장애물도 다른 기물도 없는 빈 판. 그림이 보여 주려는 건 기하지 지형이 아니다. */
export const DIAGRAM_BOARD: BoardConfig = {
  width: SIZE,
  height: SIZE,
  obstacles: [],
  captureZone: [],
  startZones: { p1: [], p2: [] },
};

export const DIAGRAM_ORIGIN: Position = { x: DIAGRAM_RADIUS, y: DIAGRAM_RADIUS };

export interface DiagramCell {
  position: Position;
  /** 기본 이동력으로 닿는 칸 */
  move: boolean;
  /** 조건이 맞아야만 닿는 칸(support3의 동전 앞면) */
  extraMove: boolean;
  attack: boolean;
  heal: boolean;
}

export interface UnitDiagram {
  typeDef: UnitTypeDef;
  cells: DiagramCell[];
  moveSpeed: number;
  /** 동전·기술로 늘어난 이동력. 없으면 null. */
  extraMoveSpeed: number | null;
}

/**
 * support3은 이동력이 매 턴 동전으로 정해지는 유일한 기물이라, 한 숫자로는 그릴 수 없다.
 * 앞면 값을 데이터(passive payload)에서 읽어 "여기까지는 운이 좋아야 간다"를 따로 칠한다.
 */
function coinMoveSpeed(typeDef: UnitTypeDef): number | null {
  if (typeDef.passive?.id !== 'support3_coinflip') return null;
  const heads = typeDef.passive.payload?.headsMove;
  return typeof heads === 'number' && heads > typeDef.moveSpeed ? heads : null;
}

/** 동전 앞면일 때의 공격 사거리. 동전이 없거나 사거리가 안 갈리면 null. */
function coinAttackRange(typeDef: UnitTypeDef): number | null {
  if (typeDef.passive?.id !== 'support3_coinflip') return null;
  const heads = typeDef.passive.payload?.headsRange;
  return typeof heads === 'number' && heads > typeDef.attackShape.range ? heads : null;
}

const cellKey = (p: Position) => `${p.x},${p.y}`;

export function unitDiagram(typeDef: UnitTypeDef): UnitDiagram {
  const unit = createUnitInstance(typeDef.id, 'p1', DIAGRAM_ORIGIN);
  const marks = new Map<string, DiagramCell>();
  const mark = (p: Position, kind: 'move' | 'extraMove' | 'attack' | 'heal') => {
    const existing = marks.get(cellKey(p));
    const cell = existing ?? { position: p, move: false, extraMove: false, attack: false, heal: false };
    cell[kind] = true;
    if (!existing) marks.set(cellKey(p), cell);
  };

  // 이동 — 판에 자기 혼자 있는 상태에서의 도달 칸. 실제 판에서는 다른 기물이 길을 막을 수 있다.
  for (const option of computeMoveOptions(unit, [unit], DIAGRAM_BOARD, typeDef.moveSpeed)) {
    mark(option.position, 'move');
  }
  const heads = coinMoveSpeed(typeDef);
  if (heads !== null) {
    for (const option of computeMoveOptions(unit, [unit], DIAGRAM_BOARD, heads)) {
      if (!marks.get(cellKey(option.position))?.move) mark(option.position, 'extraMove');
    }
  }

  // 공격 — 축·축별 사거리·범위공격 밴드까지 전부 엔진이 정한다(canAttack이 false면 빈 배열).
  for (const option of computeAttackOptions(unit, DIAGRAM_BOARD)) mark(option.position, 'attack');

  // 회복 — 지원 기물의 진짜 "사정권"은 공격이 아니라 이쪽이라, 빠뜨리면 그림이 거짓말을 한다.
  for (const skill of typeDef.skills) {
    if (skill.effectCategory !== 'heal') continue;
    const reach = skillReach(skill);
    if (!reach) continue;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = { x, y };
        if (isWithinSkillRange(DIAGRAM_ORIGIN, p, reach.range, DIAGRAM_BOARD, reach.axis)) mark(p, 'heal');
      }
    }
  }

  return { typeDef, cells: [...marks.values()], moveSpeed: typeDef.moveSpeed, extraMoveSpeed: heads };
}

const AXIS_LABEL: Record<SkillAxis, string> = {
  orthogonal: '직선',
  diagonal: '대각선',
  both: '직선·대각선',
  radius: '반경',
};

/** "직선 4칸 · 대각선 1칸"처럼, 축마다 사거리가 다를 수 있다는 것까지 드러나는 라벨. */
export function attackRangeLabel(typeDef: UnitTypeDef): string {
  const shape = typeDef.attackShape;
  if (!typeDef.canAttack) return '공격 불가';
  if (shape.kind === 'aoe') return `앞 ${shape.range}칸 + 좌우 1칸(범위)`;
  if (shape.axis === 'both' && shape.diagonalRange !== undefined && shape.diagonalRange !== shape.range) {
    return `직선 ${shape.range}칸 · 대각선 ${shape.diagonalRange}칸`;
  }
  const axis = AXIS_LABEL[shape.axis ?? 'orthogonal'];
  // 사거리도 동전으로 갈릴 수 있다(support3) — 이동력 라벨과 같은 형식으로 드러낸다.
  const heads = coinAttackRange(typeDef);
  if (heads !== null && heads !== shape.range) return `${axis} ${shape.range} 또는 ${heads}칸(동전)`;
  return `${axis} ${shape.range}칸`;
}

/**
 * "4 또는 6(동전)"처럼, 공격력도 턴마다 갈릴 수 있다는 것까지 드러나는 라벨.
 *
 * 이걸 안 하면 확률·포탑형만 이동·사거리는 동전 표기인데 공격력만 뒷면 값(4)으로 고정돼 보인다 —
 * 화면이 스탯을 실제보다 낮게 말하는 셈이라, 측면 교란형에서 겪은 것과 같은 종류의 오해를 만든다.
 */
export function attackPowerLabel(typeDef: UnitTypeDef): string {
  if (!typeDef.canAttack) return '—';
  const payload = typeDef.passive?.id === 'support3_coinflip' ? typeDef.passive.payload : undefined;
  const heads = payload?.headsAttack;
  const tails = payload?.tailsAttack;
  if (typeof heads === 'number' && typeof tails === 'number' && heads !== tails) {
    return `${tails} 또는 ${heads}(동전)`;
  }
  return String(typeDef.attack);
}

export function moveRangeLabel(typeDef: UnitTypeDef): string {
  const axis = typeDef.diagonalMove ? '직선·대각선' : '직선';
  const heads = coinMoveSpeed(typeDef);
  return heads !== null ? `${axis} ${typeDef.moveSpeed} 또는 ${heads}칸(동전)` : `${axis} ${typeDef.moveSpeed}칸`;
}

/** 기술의 사거리 한 줄. 자기 자신에게 거는 기술은 사거리라는 개념이 없어 null이다. */
export function skillReachLabel(skill: SkillDef): string | null {
  const reach = skillReach(skill);
  return reach ? `${AXIS_LABEL[reach.axis]} ${reach.range}칸` : null;
}

/** 기술을 언제 다시 쓸 수 있는지 — 쿨타임/충전/토글은 데이터의 gate가 그대로 답이다. */
export function skillGateLabel(skill: SkillDef): string {
  const gate = skill.gate;
  if (gate.type === 'cooldown') return `쿨타임 ${gate.turns}턴`;
  if (gate.type === 'charge') return `충전 ${gate.maxCharges}회`;
  if (gate.type === 'toggle') return '켜고 끄기';
  return '매 턴';
}
