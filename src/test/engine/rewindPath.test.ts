import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../engine/resolveTurn';
import { addUnit, emptyPlan, emptyState, plan, rngFor } from './helpers';
import { RESPAWN_TURNS } from '../../data/constants';

const REWIND = 'dealer2_rewind_move';

describe('one move = one direction', () => {
  it('rejects a bent path from a unit with no skill that permits changing course', () => {
    // 사용자 확정 규칙: 한 번의 이동은 무조건 한 방향. 기술 없이 꺾으면 계획 자체가 무효다.
    const state = emptyState();
    const tank2 = addUnit(state, 'tank2', 'p1', { x: 0, y: 0 }); // moveSpeed 4

    resolveTurn(
      state,
      plan('p1', 1, {
        [tank2.instanceId]: {
          baseAction: { kind: 'move', direction: 'right', distance: 4, path: ['right', 'right', 'down', 'down'] },
        },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(tank2.position).toEqual({ x: 0, y: 0 });
  });

  it('lets tank2 bend once mid-move because its 돌진 skill grants one course change', () => {
    const state = emptyState();
    const tank2 = addUnit(state, 'tank2', 'p1', { x: 0, y: 0 });

    resolveTurn(
      state,
      plan('p1', 1, {
        [tank2.instanceId]: {
          baseAction: { kind: 'move', direction: 'right', distance: 4, path: ['right', 'right', 'down', 'down'] },
          skillUse: { skillId: 'tank2_charge' },
        },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(tank2.position).toEqual({ x: 2, y: 2 });
  });

  it('still rejects a second bend — 돌진 allows exactly one course change', () => {
    const state = emptyState();
    const tank2 = addUnit(state, 'tank2', 'p1', { x: 0, y: 0 });

    resolveTurn(
      state,
      plan('p1', 1, {
        [tank2.instanceId]: {
          baseAction: { kind: 'move', direction: 'right', distance: 4, path: ['right', 'right', 'down', 'right'] },
          skillUse: { skillId: 'tank2_charge' },
        },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(tank2.position).toEqual({ x: 0, y: 0 });
  });

  it('stops a legally bent path at the first blocked step, exactly like a straight one', () => {
    const state = emptyState({ width: 9, height: 9, obstacles: [{ x: 2, y: 1 }], captureZone: [], startZones: { p1: [{ x: 0, y: 0 }], p2: [{ x: 8, y: 8 }] } });
    const tank2 = addUnit(state, 'tank2', 'p1', { x: 0, y: 0 });

    resolveTurn(
      state,
      plan('p1', 1, {
        [tank2.instanceId]: {
          baseAction: { kind: 'move', direction: 'right', distance: 4, path: ['right', 'right', 'down', 'down'] },
          skillUse: { skillId: 'tank2_charge' },
        },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    // (1,0) → (2,0) 까지 간 뒤 아래 (2,1)이 장애물이라 그 앞에서 멈춘다.
    expect(tank2.position).toEqual({ x: 2, y: 0 });
  });
});

describe('dealer2 time rewind', () => {
  it('grants a whole extra move (= its move Lv) per charge — one charge makes it move 6 cells', () => {
    const state = emptyState();
    const dealer2 = addUnit(state, 'dealer2', 'p1', { x: 0, y: 0 }); // moveSpeed 3

    resolveTurn(
      state,
      plan('p1', 1, {
        [dealer2.instanceId]: {
          baseAction: {
            kind: 'move',
            direction: 'right',
            distance: 6,
            path: ['right', 'right', 'right', 'right', 'right', 'right'],
          },
          skillUse: { skillId: REWIND, amount: 1 },
        },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(dealer2.position).toEqual({ x: 6, y: 0 }); // 기본 3칸 + 기술 1회 3칸
    expect(dealer2.charges[REWIND]).toBe(2);
    expect(dealer2.rewindSnapshot).toEqual({ position: { x: 0, y: 0 }, hp: dealer2.maxHp });
  });

  it('does not let the extra cells leak into the following turn', () => {
    // 추가 이동은 "그 턴" 한정. tank1/tank2의 이동 버프처럼 상태이상으로 남으면 다음 턴에 충전을
    // 쓰지 않고도 추가 칸을 누리게 되므로(복귀 후 충전이 3/3으로 돌아온다) 턴 한정이어야 한다.
    const state = emptyState();
    const dealer2 = addUnit(state, 'dealer2', 'p1', { x: 0, y: 0 });

    resolveTurn(
      state,
      plan('p1', 1, {
        [dealer2.instanceId]: {
          baseAction: { kind: 'move', direction: 'down', distance: 4, path: ['down', 'down', 'down', 'down'] },
          skillUse: { skillId: REWIND, amount: 1 },
        },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );
    expect(dealer2.position).toEqual({ x: 0, y: 4 });

    resolveTurn(
      state,
      plan('p1', 2, {
        [dealer2.instanceId]: {
          baseAction: { kind: 'move', direction: 'down', distance: 4, path: ['down', 'down', 'down', 'down'] },
        },
      }),
      emptyPlan('p2', 2),
      rngFor('p1'),
    );

    expect(dealer2.position).toEqual({ x: 0, y: 4 }); // 기술 없이 4칸은 불법 — 계획 자체가 무시된다
  });

  it('spends all three charges in one turn for a 12-cell move, then reverts to the anchor', () => {
    // 사용자 확정 규칙: 턴당 3회까지 사용 가능하고 1회가 이동 Lv(3칸)을 통째로 더해 준다 →
    // 3 + 3×3 = 12칸. 충전이 0이 되면 그 턴 공격 직후에 복귀한다.
    const state = emptyState();
    const dealer2 = addUnit(state, 'dealer2', 'p1', { x: 0, y: 0 });

    const log = resolveTurn(
      state,
      plan('p1', 1, {
        [dealer2.instanceId]: {
          baseAction: {
            kind: 'move',
            direction: 'right',
            distance: 12,
            // 9×9 보드 안에서 12칸을 돌기 위해 구간마다 방향을 꺾는다(기본3 → 기술1 → 기술2 → 기술3).
            path: [
              'right', 'right', 'right',
              'down', 'down', 'down',
              'left', 'left', 'left',
              'down', 'down', 'down',
            ],
          },
          skillUse: { skillId: REWIND, amount: 3 },
        },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    const rewindEvent = log.find((e) => e.type === 'rewind');
    expect(rewindEvent).toBeDefined();
    // 실제로 12칸을 갔다는 근거는 복귀 로그의 출발 위치다(복귀 후에는 원위치라 position만으로는 알 수 없다).
    expect(rewindEvent?.detail?.fromPosition).toEqual({ x: 0, y: 6 });
    expect(rewindEvent?.detail?.toPosition).toEqual({ x: 0, y: 0 });
    expect(log.find((e) => e.type === 'move')?.detail?.cellsMoved).toBe(12);
    expect(dealer2.position).toEqual({ x: 0, y: 0 });
    expect(dealer2.charges[REWIND]).toBe(3); // 복귀와 함께 충전 초기화
    expect(dealer2.rewindSnapshot).toBeNull();
  });

  it('reverts after the attack phase, so damage taken on the rewinding turn is undone as well', () => {
    // 사용자 확정 규칙: 복귀 시점은 턴종료가 아니라 "공격 이후" — 그 턴에 받은 피해까지 되돌린다.
    const state = emptyState();
    const dealer2 = addUnit(state, 'dealer2', 'p1', { x: 0, y: 0 });
    // dealer2는 maxHp 10이라 dealer1(공격 10)로 때리면 되감기 전에 죽어 버린다 — 살아남아야
    // "받은 피해가 되돌려지는가"를 잴 수 있으므로 공격력 3짜리 tank1을 사거리(직선 3) 안에 세운다.
    const attacker = addUnit(state, 'tank1', 'p2', { x: 3, y: 0 });

    resolveTurn(
      state,
      plan('p1', 1, { [dealer2.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: REWIND, amount: 1 } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );
    expect(dealer2.charges[REWIND]).toBe(2);

    const log = resolveTurn(
      state,
      plan('p1', 2, { [dealer2.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: REWIND, amount: 2 } } }),
      plan('p2', 2, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'left' } } }),
      rngFor('p1'),
    );

    const rewindEvent = log.find((e) => e.type === 'rewind');
    expect(rewindEvent?.detail?.fromHp).toBe(dealer2.maxHp - 3); // 피해는 분명히 들어갔고
    expect(rewindEvent?.detail?.toHp).toBe(dealer2.maxHp); // 복귀가 그것까지 되돌린다
    expect(dealer2.currentHp).toBe(dealer2.maxHp);
  });

  it('clears the anchor on death and restores full charges on respawn', () => {
    const state = emptyState();
    const dealer2 = addUnit(state, 'dealer2', 'p1', { x: 0, y: 0 });
    dealer2.currentHp = 5; // dealer1의 10뎀으로 확실히 사망시킨다
    const killer = addUnit(state, 'dealer1', 'p2', { x: 4, y: 0 });

    resolveTurn(
      state,
      plan('p1', 1, { [dealer2.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: REWIND, amount: 1 } } }),
      plan('p2', 1, { [killer.instanceId]: { baseAction: { kind: 'attack', direction: 'left' } } }),
      rngFor('p1'),
    );

    expect(dealer2.alive).toBe(false);
    expect(dealer2.rewindSnapshot).toBeNull(); // 되돌아갈 과거가 사라진다
    expect(dealer2.charges[REWIND]).toBe(2); // 충전은 부활 전까지 그대로

    // 부활까지 남은 턴종료 틱을 모두 돌린다 — RESPAWN_TURNS를 조정해도 따라오도록 숫자를 박지 않는다.
    for (let i = 0; i < RESPAWN_TURNS - 1; i++) {
      const turn = 2 + i;
      resolveTurn(state, emptyPlan('p1', turn), emptyPlan('p2', turn), rngFor('p1'));
    }

    expect(dealer2.alive).toBe(true);
    expect(dealer2.charges[REWIND]).toBe(3);
    expect(dealer2.rewindSnapshot).toBeNull();
  });

  it('lets each granted move bend on its own, but every one of them must spend the full move Lv', () => {
    // 사용자 확정 규칙: 추가 이동의 칸수는 고를 수 없다 — 무조건 이동 Lv(3칸)이다.
    // 기술1만 2칸으로 줄인 계획은 막힌 것이 없으므로 불법이다.
    const state = emptyState();
    const dealer2 = addUnit(state, 'dealer2', 'p1', { x: 4, y: 0 });

    resolveTurn(
      state,
      plan('p1', 1, {
        [dealer2.instanceId]: {
          baseAction: {
            kind: 'move',
            direction: 'down',
            distance: 11,
            path: ['down', 'down', 'down', 'left', 'left', 'down', 'down', 'down', 'right', 'right', 'right'],
            segmentLengths: [3, 2, 3, 3],
          },
          skillUse: { skillId: REWIND, amount: 3 },
        },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(dealer2.position).toEqual({ x: 4, y: 0 }); // 계획 자체가 무시된다
  });

  it('lets a granted move stop in front of an obstacle — the only reason it may be shorter', () => {
    // 같은 경로라도 왼쪽 3칸째가 장애물이면 "장애물의 전 칸"까지인 2칸이 곧 정해진 칸수다.
    const state = emptyState({
      width: 9,
      height: 9,
      obstacles: [{ x: 1, y: 3 }],
      captureZone: [],
      startZones: { p1: [{ x: 0, y: 0 }], p2: [{ x: 8, y: 8 }] },
    });
    const dealer2 = addUnit(state, 'dealer2', 'p1', { x: 4, y: 0 });

    const log = resolveTurn(
      state,
      plan('p1', 1, {
        [dealer2.instanceId]: {
          baseAction: {
            kind: 'move',
            direction: 'down',
            distance: 11,
            path: ['down', 'down', 'down', 'left', 'left', 'down', 'down', 'down', 'right', 'right', 'right'],
            segmentLengths: [3, 2, 3, 3],
          },
          skillUse: { skillId: REWIND, amount: 3 },
        },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(log.find((e) => e.type === 'move')?.detail?.cellsMoved).toBe(11);
    // (4,0) →아래3→ (4,3) →왼쪽2(장애물 (1,3) 앞)→ (2,3) →아래3→ (2,6) →오른쪽3→ (5,6)
    expect(log.find((e) => e.type === 'rewind')?.detail?.fromPosition).toEqual({ x: 5, y: 6 });
    expect(dealer2.position).toEqual({ x: 4, y: 0 }); // 충전을 다 썼으니 기준점으로 복귀
  });

  it('only lets dealer2 change direction at the boundary between granted moves, not inside one', () => {
    // 기본 이동 3칸 도중에 꺾는 계획 — 구간 경계가 아니므로 불법이다.
    const state = emptyState();
    const dealer2 = addUnit(state, 'dealer2', 'p1', { x: 0, y: 0 });

    resolveTurn(
      state,
      plan('p1', 1, {
        [dealer2.instanceId]: {
          baseAction: {
            kind: 'move',
            direction: 'right',
            distance: 6,
            path: ['right', 'down', 'right', 'down', 'down', 'down'],
            segmentLengths: [3, 3],
          },
          skillUse: { skillId: REWIND, amount: 1 },
        },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(dealer2.position).toEqual({ x: 0, y: 0 });
  });

  it('does not let cells skipped in one granted move be hoarded into another', () => {
    // 총합(12칸)만 보면 합법이지만, 한 번의 이동이 이동 Lv(3칸)을 넘을 수는 없다.
    const state = emptyState();
    const dealer2 = addUnit(state, 'dealer2', 'p1', { x: 0, y: 0 });

    resolveTurn(
      state,
      plan('p1', 1, {
        [dealer2.instanceId]: {
          baseAction: {
            kind: 'move',
            direction: 'right',
            distance: 12,
            path: ['right', 'right', 'right', 'down', 'down', 'down', 'down', 'down', 'down', 'down', 'down', 'down'],
            segmentLengths: [3, 0, 0, 9], // 기술1·2를 아껴 기술3에 9칸을 몰아쓰려는 계획
          },
          skillUse: { skillId: REWIND, amount: 3 },
        },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(dealer2.position).toEqual({ x: 0, y: 0 }); // 불법 계획은 통째로 무시된다
  });

  it('rejects a plan that moves further than the charges actually spent allow', () => {
    const state = emptyState();
    const dealer2 = addUnit(state, 'dealer2', 'p1', { x: 0, y: 0 });

    resolveTurn(
      state,
      plan('p1', 1, {
        [dealer2.instanceId]: {
          baseAction: {
            kind: 'move',
            direction: 'right',
            distance: 7,
            path: ['right', 'right', 'right', 'right', 'right', 'right', 'right'],
          },
          skillUse: { skillId: REWIND, amount: 1 }, // 3 + 3 = 6칸까지만 합법
        },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(dealer2.position).toEqual({ x: 0, y: 0 }); // 불법 계획은 통째로 무시된다
  });
});
