import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../engine/resolveTurn';
import { addUnit, emptyPlan, emptyState, plan, rngFor, testBoard } from './helpers';

const REWIND = 'dealer2_rewind_move';

/**
 * 기술 이동(§3.2 확장, 사용자 확정 규칙).
 *
 * 기본 행동은 여전히 이동/공격 중 하나뿐이다. 다만 **"이동을 한 번 더" 주는 기술**을 쓴 턴에는
 * 그 기술이 이동을 맡으므로, 기본 행동을 공격으로 잡아도 움직일 수 있다.
 * 이때 움직이는 칸은 **기술이 준 몫뿐**이다 — dealer2가 시간역행을 3회 쓰면 "기본 이동 3 + 기술 9"가
 * 아니라 기술 몫 9칸만 간다(기본 행동 칸은 공격이 가져갔으므로 기본 이동은 존재하지 않는다).
 * 이동은 1단계, 공격은 3단계이므로 공격은 자동으로 **도착 칸**에서 나간다.
 */
describe('기술 이동 후 공격', () => {
  it('기본 행동이 공격이면 기본 이동 없이 기술이 준 칸만 움직인 뒤 도착 칸에서 쏜다', () => {
    const state = emptyState();
    const dealer2 = addUnit(state, 'dealer2', 'p1', { x: 0, y: 0 }); // 이동 3, 공격 6, 직선 사거리 2
    const target = addUnit(state, 'tank1', 'p2', { x: 0, y: 4 }); // 최대 체력 40

    const log = resolveTurn(
      state,
      plan('p1', 1, {
        [dealer2.instanceId]: {
          baseAction: { kind: 'attack', direction: 'down' },
          skillUse: { skillId: REWIND, amount: 1 },
          skillMove: { path: ['down', 'down', 'down'], segmentLengths: [3] },
        },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    // 기술 1회 = 이동 Lv 3칸. 기본 이동 3칸이 더 붙어 (0,6)까지 가면 안 된다.
    expect(dealer2.position).toEqual({ x: 0, y: 3 });
    // 출발 칸 (0,0)에서는 사거리 2로 절대 닿지 않는 적이 도착 칸 (0,3)에서는 바로 앞에 있다.
    expect(target.currentHp).toBe(34);
    expect(log.some((e) => e.type === 'skillMoveAttack' && e.actorId === dealer2.instanceId)).toBe(true);
  });

  it('시간역행 2회 = 6칸 — 기본 이동 3칸이 얹혀 9칸이 되지 않는다', () => {
    const state = emptyState(testBoard({ width: 13, height: 13 }));
    const dealer2 = addUnit(state, 'dealer2', 'p1', { x: 0, y: 0 });
    const bystander = addUnit(state, 'tank1', 'p2', { x: 0, y: 8 });

    resolveTurn(
      state,
      plan('p1', 1, {
        [dealer2.instanceId]: {
          baseAction: { kind: 'attack', direction: 'right' },
          skillUse: { skillId: REWIND, amount: 2 },
          skillMove: { path: Array<'down'>(6).fill('down'), segmentLengths: [3, 3] },
        },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(dealer2.position).toEqual({ x: 0, y: 6 });
    expect(dealer2.charges[REWIND]).toBe(1); // 3 - 2, 아직 0이 아니라 복귀는 없다
    expect(bystander.currentHp).toBe(40); // 공격은 오른쪽으로 나가 이 기물에는 닿지 않는다
  });

  it('히트&런 — 기술로 파고들어 때린 피해는 남고 몸은 기준점으로 복귀한다', () => {
    const state = emptyState(testBoard({ width: 13, height: 13 }));
    const dealer2 = addUnit(state, 'dealer2', 'p1', { x: 0, y: 0 });
    const target = addUnit(state, 'tank1', 'p2', { x: 1, y: 9 });

    resolveTurn(
      state,
      plan('p1', 1, {
        [dealer2.instanceId]: {
          baseAction: { kind: 'attack', direction: 'right' },
          skillUse: { skillId: REWIND, amount: 3 },
          skillMove: { path: Array<'down'>(9).fill('down'), segmentLengths: [3, 3, 3] },
        },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    // 복귀는 공격 단계 **뒤**에 처리되므로 (0,9)에서 때린 피해가 남는다.
    expect(target.currentHp).toBe(34);
    expect(dealer2.position).toEqual({ x: 0, y: 0 });
    expect(dealer2.charges[REWIND]).toBe(3); // 충전을 다 쓰면 복귀와 함께 초기화
  });

  it('이동을 만들어 주지 못하는 기술이면 기술 이동은 떨어져 나가고 제자리에서 공격한다', () => {
    const state = emptyState();
    // tank2 돌진의 +1은 **기본 이동**을 늘리는 버프라 "이동을 한 번 더"가 아니다.
    const tank2 = addUnit(state, 'tank2', 'p1', { x: 0, y: 0 }); // 공격 2, 사거리 4
    const target = addUnit(state, 'tank1', 'p2', { x: 2, y: 0 });

    resolveTurn(
      state,
      plan('p1', 1, {
        [tank2.instanceId]: {
          baseAction: { kind: 'attack', direction: 'right' },
          skillUse: { skillId: 'tank2_charge' },
          skillMove: { path: ['down', 'down'], segmentLengths: [2] },
        },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(tank2.position).toEqual({ x: 0, y: 0 }); // 기술 이동은 무효
    expect(target.currentHp).toBe(38); // 공격 계획은 살아남는다
  });

  it('기본 행동이 이동이면 경로는 기본 행동이 갖고, 그 턴에 공격은 없다', () => {
    const state = emptyState();
    const dealer2 = addUnit(state, 'dealer2', 'p1', { x: 0, y: 0 });
    const target = addUnit(state, 'tank1', 'p2', { x: 0, y: 7 });

    resolveTurn(
      state,
      plan('p1', 1, {
        [dealer2.instanceId]: {
          baseAction: {
            kind: 'move',
            direction: 'down',
            distance: 6,
            path: Array<'down'>(6).fill('down'),
            segmentLengths: [3, 3],
          },
          skillUse: { skillId: REWIND, amount: 1 },
          skillMove: { path: ['right'], segmentLengths: [1] },
        },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(dealer2.position).toEqual({ x: 0, y: 6 }); // 기본 3 + 기술 3
    expect(target.currentHp).toBe(40); // 기본 행동이 이동이므로 공격은 계획될 수 없다
  });
});
