import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../engine/resolveTurn';
import { computeAttackOptions, computeMoveOptions, luckyCells } from '../../components/Planning/actionGeometry';
import { certainMoveSpeed, coinMoveSwing, plannedMoveSpeed } from '../../engine/unitStats';
import { getUnitType } from '../../data/unitTypes';
import { addUnit, emptyPlan, emptyState, plan, rngFor, testBoard } from '../engine/helpers';

/**
 * **"동전 뒷면이 떠도 UI에서는 이동이 3칸 되는 것처럼 보인다."**
 *
 * 확률·포탑형은 이동력(1 또는 3)과 사거리(2 또는 3)가 매 턴 동전으로 갈리는데, 동전은 계획을 세운
 * **뒤** 해결 단계에서 굴러간다. 그래서 계획을 상한(앞면)으로 세우게 두는 것 자체는 옳다 — 하한으로
 * 잡으면 앞면인 턴에 3칸을 못 쓰고, 굴린 뒤 검증하면 운 나쁜 턴에 계획이 통째로 무효가 된다.
 *
 * 틀린 것은 **화면**이었다. 상한만 그리면 세 칸이 다 보장된 것처럼 보이고, 절반의 확률로 한 칸만
 * 가고 나면 판이 거짓말을 한 셈이 된다. 그래서 칸을 빼는 대신 **표시를 가른다**.
 *
 * 아래에서 못 박는 것은 하나다 — `lucky`로 표시한 칸이 **정확히** 뒷면일 때 못 가는 칸이어야 한다.
 * 표시가 실제와 어긋나면 상한만 그리던 예전보다 나쁘다(새 거짓말이 하나 더 늘 뿐이다).
 */
const PAYLOAD = getUnitType('support3').passive!.payload!;

describe('coin-dependent cells', () => {
  it('marks exactly the cells the tails coin cannot reach', () => {
    const state = emptyState();
    const unit = addUnit(state, 'support3', 'p1', { x: 0, y: 0 });

    const options = computeMoveOptions(unit, state.units, state.board, plannedMoveSpeed(unit));
    const guaranteed = options.filter((o) => !o.lucky);
    const lucky = options.filter((o) => o.lucky);

    // 보장 칸 = 뒷면 이동력 안쪽. 운 칸 = 그 너머부터 앞면 이동력까지.
    expect(guaranteed.every((o) => o.distance <= PAYLOAD.tailsMove)).toBe(true);
    expect(lucky.every((o) => o.distance > PAYLOAD.tailsMove && o.distance <= PAYLOAD.headsMove)).toBe(true);
    expect(lucky.length).toBeGreaterThan(0);
  });

  it('a lucky cell really is unreachable on tails — and reachable on heads', () => {
    // 표시와 실제가 갈리면 안 된다. 그래서 같은 계획을 앞면·뒷면 두 번 굴려 직접 비교한다.
    const board = testBoard();
    const target = { x: PAYLOAD.headsMove, y: 0 };
    const path = Array<'right'>(PAYLOAD.headsMove).fill('right');
    const movePlan = {
      baseAction: { kind: 'move' as const, direction: 'right' as const, distance: path.length, path },
    };

    const run = (coin: 'p1' | 'p2') => {
      const state = emptyState(board);
      const unit = addUnit(state, 'support3', 'p1', { x: 0, y: 0 });
      resolveTurn(state, plan('p1', 1, { [unit.instanceId]: movePlan }), emptyPlan('p2', 1), rngFor(coin));
      return unit.position;
    };

    // 계획 화면이 이 칸을 「운이 좋아야 닿는 칸」이라고 말했는지 먼저 확인하고,
    const state = emptyState(board);
    const unit = addUnit(state, 'support3', 'p1', { x: 0, y: 0 });
    const options = computeMoveOptions(unit, state.units, board, plannedMoveSpeed(unit));
    expect(luckyCells(options)).toContainEqual(target);

    // 그 말이 실제 해결과 맞는지 확인한다.
    expect(run('p1')).toEqual(target); // 앞면 — 닿는다
    expect(run('p2')).not.toEqual(target); // 뒷면 — 못 닿는다
  });

  it('says nothing about units whose reach does not depend on a coin', () => {
    // 모든 칸에 "운"을 붙이면 표시가 배경이 되어 정작 확률·포탑형에서 안 읽힌다.
    const state = emptyState();
    const dealer = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });
    const tank = addUnit(state, 'tank2', 'p1', { x: 0, y: 4 });

    for (const unit of [dealer, tank]) {
      expect(coinMoveSwing(unit)).toBe(0);
      expect(luckyCells(computeMoveOptions(unit, state.units, state.board, plannedMoveSpeed(unit)))).toEqual([]);
      expect(luckyCells(computeAttackOptions(unit, state.board))).toEqual([]);
    }
  });

  it('splits the attack range too — the coin decides reach, not just distance walked', () => {
    const state = emptyState();
    const unit = addUnit(state, 'support3', 'p1', { x: 4, y: 4 });

    const options = computeAttackOptions(unit, state.board);
    const lucky = luckyCells(options);
    const distance = (p: { x: number; y: number }) => Math.abs(p.x - 4) + Math.abs(p.y - 4);

    expect(lucky.length).toBeGreaterThan(0);
    // 뒷면 사거리 안쪽은 하나도 「운」이 아니고, 그 너머는 전부 「운」이다.
    expect(lucky.every((p) => distance(p) > PAYLOAD.tailsRange)).toBe(true);
    expect(options.filter((o) => !o.lucky).every((o) => distance(o.position) <= PAYLOAD.tailsRange)).toBe(true);
  });

  it('keeps the upper bound clickable — the plan is still made for heads', () => {
    // 표시를 가른다고 칸을 빼면 앞면인 턴에 3칸을 못 쓴다. 「운」은 못 찍게 하는 표시가 아니다.
    const state = emptyState();
    const unit = addUnit(state, 'support3', 'p1', { x: 0, y: 0 });
    const options = computeMoveOptions(unit, state.units, state.board, plannedMoveSpeed(unit));

    expect(Math.max(...options.map((o) => o.distance))).toBe(PAYLOAD.headsMove);
    expect(certainMoveSpeed(unit)).toBe(PAYLOAD.tailsMove);
    expect(plannedMoveSpeed(unit)).toBe(PAYLOAD.headsMove);
  });
});
