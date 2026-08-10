import type { ActionPlan, BoardConfig, GameState, Owner, Position, UnitTurnPlan } from '../../engine/types';
import { createInitialState, createUnitInstance } from '../../engine/createInitialState';

/** 작은 테스트 전용 보드 — 실제 '정원' 맵과 분리해 엔진 로직만 격리 테스트한다. */
export function testBoard(overrides: Partial<BoardConfig> = {}): BoardConfig {
  return {
    width: 9,
    height: 9,
    obstacles: [],
    captureZone: [{ x: 4, y: 4 }],
    startZones: { p1: [{ x: 0, y: 0 }, { x: 1, y: 0 }], p2: [{ x: 8, y: 8 }, { x: 7, y: 8 }] },
    ...overrides,
  };
}

export function emptyState(board: BoardConfig = testBoard()): GameState {
  return createInitialState([], [], [], [], board);
}

export function addUnit(state: GameState, typeId: string, owner: Owner, position: Position | null) {
  const unit = createUnitInstance(typeId, owner, position);
  state.units.push(unit);
  return unit;
}

export function plan(playerId: Owner, turnNumber: number, actions: Record<string, UnitTurnPlan>): ActionPlan {
  return { turnNumber, playerId, actions };
}

export const emptyPlan = (playerId: Owner, turnNumber: number): ActionPlan => plan(playerId, turnNumber, {});

/**
 * 우선순위 동률 그룹의 무작위 타이브레이크를 결정론적으로 고정하는 테스트 헬퍼(engine/priority.ts의
 * pickRandomOrder 참고). rngFn()이 0에 가까우면 동률 그룹이 원래(유닛 추가) 순서를 유지하고,
 * 1에 가까우면 완전히 반대 순서가 된다 — 'p1'을 넘기면 p1이 먼저 추가된 유닛 기준으로 그 순서를
 * 유지시켜 사실상 "p1이 동률에서 우선"하도록, 'p2'를 넘기면 그 반대가 되도록 고정한다.
 */
export const rngFor = (firstMover: Owner) => (firstMover === 'p1' ? () => 0 : () => 0.9);
