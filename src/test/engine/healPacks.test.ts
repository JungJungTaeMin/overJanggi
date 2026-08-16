import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../engine/resolveTurn';
import { HEAL_PACK_RESPAWN_TURNS } from '../../data/constants';
import { addUnit, emptyPlan, emptyState, plan, rngFor, testBoard } from './helpers';

/**
 * 힐팩(맵 메이커 지형). 기물의 기술이 아니라 **보드가 주는 회복**이라 ActionPlan에 아무것도 적지
 * 않아도 발동한다 — 그래서 여기 테스트들은 대부분 "행동 없음" 계획으로 턴만 굴린다.
 */
function boardWithPack(amount = 10) {
  return testBoard({ healPacks: [{ position: { x: 4, y: 0 }, amount }] });
}

/** 한 턴을 아무 행동 없이 굴린다. */
function runTurn(state: ReturnType<typeof emptyState>) {
  resolveTurn(state, emptyPlan('p1', state.turnNumber), emptyPlan('p2', state.turnNumber), rngFor('p1'));
}

describe('힐팩', () => {
  it('힐팩 칸에 서 있는 다친 기물을 회복시킨다', () => {
    const state = emptyState(boardWithPack(10));
    const unit = addUnit(state, 'tank1', 'p1', { x: 4, y: 0 });
    unit.currentHp = 5;

    runTurn(state);

    expect(unit.currentHp).toBe(15);
  });

  it('최대 체력을 넘겨 회복하지 않는다', () => {
    const state = emptyState(boardWithPack(20));
    const unit = addUnit(state, 'dealer2', 'p1', { x: 4, y: 0 });
    unit.currentHp = unit.maxHp - 1;

    runTurn(state);

    expect(unit.currentHp).toBe(unit.maxHp);
  });

  it('체력이 꽉 찬 기물은 힐팩을 소모하지 않는다', () => {
    // 온전한 기물이 지나가다 밟는 것만으로 팀 자원이 사라지면, 힐팩 위를 지나는 경로 자체가 실수가 된다.
    const state = emptyState(boardWithPack(10));
    const full = addUnit(state, 'tank1', 'p1', { x: 4, y: 0 });

    runTurn(state);
    expect(state.healPackTimers).toEqual({});

    // 같은 힐팩이 여전히 살아 있어야 한다 — 다친 기물이 오면 그대로 먹힌다.
    full.position = null;
    const hurt = addUnit(state, 'tank1', 'p2', { x: 4, y: 0 });
    hurt.currentHp = 1;
    runTurn(state);
    expect(hurt.currentHp).toBe(11);
  });

  it('먹은 힐팩은 재생성 턴이 지나기 전까지 아무 효과가 없다', () => {
    const state = emptyState(boardWithPack(10));
    const unit = addUnit(state, 'tank1', 'p1', { x: 4, y: 0 });
    unit.currentHp = 1;

    runTurn(state);
    expect(unit.currentHp).toBe(11);

    // 비어 있는 동안은 계속 서 있어도 회복이 없다.
    const hpWhileEmpty: number[] = [];
    for (let i = 0; i < HEAL_PACK_RESPAWN_TURNS; i++) {
      unit.currentHp = 1;
      runTurn(state);
      hpWhileEmpty.push(unit.currentHp);
    }
    expect(hpWhileEmpty).toEqual(Array(HEAL_PACK_RESPAWN_TURNS).fill(1));

    // 재생성 턴이 지나면 다시 먹힌다.
    unit.currentHp = 1;
    runTurn(state);
    expect(unit.currentHp).toBe(11);
  });

  it('중립 자원이라 양 팀 누구든 먹는다', () => {
    const state = emptyState(boardWithPack(20));
    const enemy = addUnit(state, 'tank1', 'p2', { x: 4, y: 0 });
    enemy.currentHp = 1;

    runTurn(state);

    expect(enemy.currentHp).toBe(21);
  });

  it('걸어와서 멈춘 칸이 힐팩이면 그 턴에 바로 먹는다', () => {
    // 힐팩은 회복(4단계)에서 처리되므로 이동(1단계)이 끝난 **도착 칸** 기준이어야 한다.
    const state = emptyState(boardWithPack(10));
    const unit = addUnit(state, 'tank1', 'p1', { x: 3, y: 0 });
    unit.currentHp = 1;

    resolveTurn(
      state,
      plan('p1', 1, { [unit.instanceId]: { baseAction: { kind: 'move', direction: 'right', distance: 1 } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(unit.position).toEqual({ x: 4, y: 0 });
    expect(unit.currentHp).toBe(11);
  });

  it('힐팩이 없는 맵에서는 타이머가 생기지 않는다', () => {
    const state = emptyState(testBoard());
    const unit = addUnit(state, 'tank1', 'p1', { x: 4, y: 0 });
    unit.currentHp = 1;

    runTurn(state);

    expect(unit.currentHp).toBe(1);
    expect(state.healPackTimers).toEqual({});
  });
});
