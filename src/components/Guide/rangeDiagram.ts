import { coinAttackRange, coinMoveSpeed, skillReach } from '../statLabels';
import type { BoardConfig, Position, UnitTypeDef } from '../../engine/types';
import { unitTypes } from '../../data/unitTypes';
import { createUnitInstance } from '../../engine/createInitialState';

import { isWithinSkillRange } from '../../engine/targeting';
import { computeAttackOptions, computeMoveOptions } from '../Planning/actionGeometry';

/**
 * 도움말의 기물 그림은 **그리지 않고 계산한다.**
 *
 * 손으로 칸을 찍어 두면 스탯이 바뀌는 순간 그림만 옛날 값으로 남는다 — 이 저장소는 사거리·이동력을
 * 측정 결과에 따라 자주 고쳐 왔으므로(unitTypes.ts의 긴 주석들이 그 기록이다) 실제로 벌어질 일이다.
 * 그래서 판에서 쓰는 것과 **같은 함수**(computeMoveOptions / computeAttackOptions)를 빈 판 위에서
 * 불러 칸을 얻는다. 화면의 초록/빨강은 그 기물이 실제로 클릭할 수 있는 칸과 정의상 같다.
 */

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
