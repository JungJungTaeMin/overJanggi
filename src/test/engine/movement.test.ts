import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../engine/resolveTurn';
import { addUnit, emptyPlan, emptyState, plan, rngFor, testBoard } from './helpers';

describe('movement resolution', () => {
  it('moves a unit in a straight line when unobstructed', () => {
    const state = emptyState();
    const unit = addUnit(state, 'tank1', 'p1', { x: 1, y: 1 });

    resolveTurn(
      state,
      plan('p1', 1, { [unit.instanceId]: { baseAction: { kind: 'move', direction: 'right', distance: 1 } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(unit.position).toEqual({ x: 2, y: 1 });
  });

  it('stops a unit immediately when the very next cell is an obstacle', () => {
    const board = testBoard({ obstacles: [{ x: 3, y: 3 }] });
    const state = emptyState(board);
    const unit = addUnit(state, 'tank2', 'p1', { x: 2, y: 3 });

    resolveTurn(
      state,
      plan('p1', 1, { [unit.instanceId]: { baseAction: { kind: 'move', direction: 'right', distance: 3 } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(unit.position).toEqual({ x: 2, y: 3 });
  });

  it('stops a fast unit just before another unit blocking its path', () => {
    const state = emptyState();
    const mover = addUnit(state, 'tank2', 'p1', { x: 0, y: 0 }); // moveSpeed 4
    addUnit(state, 'support2', 'p2', { x: 2, y: 0 });

    resolveTurn(
      state,
      plan('p1', 1, { [mover.instanceId]: { baseAction: { kind: 'move', direction: 'right', distance: 4 } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(mover.position).toEqual({ x: 1, y: 0 });
  });

  it('gives the contested destination to whichever unit wins the priority tie-break on a collision', () => {
    // v0.3: 이동은 더 이상 "동시" 스텝 시뮬레이션이 아니라 우선순위(동률 시 무작위) 순서대로
    // 한 기물씩 완전히 이동한다. 두 tank1은 스탯이 동률이라 rngFor('p1')이 고정하는 순서(유닛
    // 추가 순서 유지)상 p1Unit이 먼저 처리되어 목적지를 선점하고, p2Unit은 그 앞에서 멈춘다.
    const state = emptyState();
    const p1Unit = addUnit(state, 'tank1', 'p1', { x: 2, y: 2 });
    const p2Unit = addUnit(state, 'tank1', 'p2', { x: 4, y: 2 });

    resolveTurn(
      state,
      plan('p1', 1, { [p1Unit.instanceId]: { baseAction: { kind: 'move', direction: 'right', distance: 1 } } }),
      plan('p2', 1, { [p2Unit.instanceId]: { baseAction: { kind: 'move', direction: 'left', distance: 1 } } }),
      rngFor('p1'),
    );

    expect(p1Unit.position).toEqual({ x: 3, y: 2 });
    expect(p2Unit.position).toEqual({ x: 4, y: 2 });
  });

  it('breaks a move-speed tie in favor of the unit with the higher attack stat', () => {
    // v0.5: 이동 Lv가 같으면 공격 수치가 높은 기물이 우선한다(이전엔 낮은 쪽이 우선이었음).
    // dealer1(이동1·공격8)과 tank1(이동1·공격3)은 이동 Lv이 동률이므로 공격 수치로 갈린다 —
    // 무작위 동률처리가 필요 없는 결정론적 케이스다.
    const state = emptyState();
    const highAttack = addUnit(state, 'dealer1', 'p1', { x: 2, y: 2 });
    const lowAttack = addUnit(state, 'tank1', 'p2', { x: 4, y: 2 });

    resolveTurn(
      state,
      plan('p1', 1, { [highAttack.instanceId]: { baseAction: { kind: 'move', direction: 'right', distance: 1 } } }),
      plan('p2', 1, { [lowAttack.instanceId]: { baseAction: { kind: 'move', direction: 'left', distance: 1 } } }),
      rngFor('p1'),
    );

    expect(highAttack.position).toEqual({ x: 3, y: 2 });
    expect(lowAttack.position).toEqual({ x: 4, y: 2 });
  });

  it('lets dealer2 bend direction on the bonus step granted by its rewind-move skill', () => {
    const state = emptyState();
    const unit = addUnit(state, 'dealer2', 'p1', { x: 0, y: 5 }); // moveSpeed 3

    resolveTurn(
      state,
      plan('p1', 1, {
        [unit.instanceId]: {
          baseAction: { kind: 'move', direction: 'right', distance: 4 },
          skillUse: { skillId: 'dealer2_rewind_move', target: 'up' },
        },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    // 처음 3칸(moveSpeed)은 원래 방향(right), 충전 기술이 준 보너스 4번째 칸부터 reroute(up) 적용.
    expect(unit.position).toEqual({ x: 3, y: 4 });
  });

  it('keeps dealer2 moving straight when no reroute direction is given for its bonus step', () => {
    const state = emptyState();
    const unit = addUnit(state, 'dealer2', 'p1', { x: 0, y: 5 });

    resolveTurn(
      state,
      plan('p1', 1, {
        [unit.instanceId]: {
          baseAction: { kind: 'move', direction: 'right', distance: 4 },
          skillUse: { skillId: 'dealer2_rewind_move' },
        },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(unit.position).toEqual({ x: 4, y: 5 });
  });

  it('blocks movement entirely while a unit is rooted', () => {
    const state = emptyState();
    const unit = addUnit(state, 'tank1', 'p1', { x: 1, y: 1 });
    unit.statusEffects.push({ type: 'root', appliedOnTurn: 1, expiresAfterTurn: 2, sourceId: 'x' });

    resolveTurn(
      state,
      plan('p1', 1, { [unit.instanceId]: { baseAction: { kind: 'move', direction: 'right', distance: 1 } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(unit.position).toEqual({ x: 1, y: 1 });
  });
});
