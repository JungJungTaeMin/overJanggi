import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../engine/createInitialState';
import { resolveTurn } from '../../engine/resolveTurn';
import { mapDefinition } from '../../data/mapDefinitions';
import { WIN_SCORE } from '../../data/constants';
import type { ActionPlan, Position } from '../../engine/types';

function emptyPlan(turnNumber: number, playerId: 'p1' | 'p2'): ActionPlan {
  return { turnNumber, playerId, actions: {} };
}

const rosterIds = ['tank1', 'tank2', 'tank3', 'dealer1', 'support1'];

/** 실제 '정원' 맵과 실제 기물 로스터로 드래프트→배치→여러 턴 해결까지 이어지는 골든패스. */
describe('golden path: draft-like setup through capture win', () => {
  it('creates a valid initial state on the real map with both rosters placed in their start zones', () => {
    const p1Positions: Position[] = mapDefinition.startZones.p1.slice(0, 5);
    const p2Positions: Position[] = mapDefinition.startZones.p2.slice(0, 5);
    const state = createInitialState(rosterIds, rosterIds, p1Positions, p2Positions, mapDefinition);

    expect(state.units).toHaveLength(10);
    expect(state.phase).toBe('planning');
    expect(state.turnNumber).toBe(1);
    expect(state.score).toEqual({ p1: 0, p2: 0 });
    // 모든 유닛이 각자 시작구역 안에서 시작한다.
    for (const u of state.units) {
      expect(u.position).not.toBeNull();
      expect(u.alive).toBe(true);
      expect(u.currentHp).toBe(u.maxHp);
    }
  });

  it('resolves several no-op turns without throwing and increments turnNumber each time', () => {
    const p1Positions: Position[] = mapDefinition.startZones.p1.slice(0, 5);
    const p2Positions: Position[] = mapDefinition.startZones.p2.slice(0, 5);
    const state = createInitialState(rosterIds, rosterIds, p1Positions, p2Positions, mapDefinition);

    for (let i = 0; i < 3; i++) {
      const before = state.turnNumber;
      resolveTurn(state, emptyPlan(before, 'p1'), emptyPlan(before, 'p2'), () => 0.5);
      expect(state.turnNumber).toBe(before + 1);
      expect(state.phase).toBe('planning');
    }
    expect(state.log.length).toBeGreaterThan(0);
  });

  it('two unopposed p1 occupants in the real capture zone score 1pt/turn, and reaching WIN_SCORE ends the game', () => {
    const p1Positions: Position[] = mapDefinition.startZones.p1.slice(0, 5);
    const p2Positions: Position[] = mapDefinition.startZones.p2.slice(0, 5);
    const state = createInitialState(rosterIds, rosterIds, p1Positions, p2Positions, mapDefinition);

    // p1 유닛 **두 기**를 실제 점령지로 순간이동(테스트 편의상 직접 배치)시켜 매 턴 1점씩 쌓이는지
    // 확인한다. 두 기인 이유는 CAPTURE_MARGIN이 2라 한 기로는 점수가 나지 않기 때문이다.
    const mid = Math.floor(mapDefinition.captureZone.length / 2);
    state.units[0].position = mapDefinition.captureZone[mid];
    state.units[1].position = mapDefinition.captureZone[mid + 1];

    for (let turn = 1; turn <= WIN_SCORE; turn++) {
      resolveTurn(state, emptyPlan(turn, 'p1'), emptyPlan(turn, 'p2'), () => 0.5);
      if (state.phase === 'gameOver') break;
    }

    expect(state.score.p1).toBeGreaterThanOrEqual(WIN_SCORE);
    expect(state.phase).toBe('gameOver');
    expect(state.winner).toBe('p1');
  });
});
