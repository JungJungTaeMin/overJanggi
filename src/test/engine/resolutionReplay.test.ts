import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../engine/resolveTurn';
import { compactReplay, type ResolutionStep } from '../../engine/replay';
import { addUnit, emptyPlan, emptyState, plan, rngFor } from './helpers';

/**
 * 해결을 **단계별로 되감아 보여 주기** 위한 기록 장치. 검증의 핵심은 세 가지다 —
 * (1) 기록이 실제 해결 순서를 따르는가, (2) 각 단계가 그 시점의 판을 **복사해** 들고 있는가
 * (참조를 담으면 여섯 단계가 전부 마지막 판을 가리켜 재생이 정지 화면이 된다),
 * (3) 기록을 켜지 않은 호출(AI·밸런스 시뮬레이터)이 조금도 달라지지 않는가.
 */
function capturedSteps(run: (capture: (step: ResolutionStep) => void) => void): ResolutionStep[] {
  const steps: ResolutionStep[] = [];
  run((step) => steps.push(step));
  return steps;
}

describe('resolution replay capture', () => {
  it('records the documented phase order', () => {
    const state = emptyState();
    const attacker = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });
    addUnit(state, 'support2', 'p2', { x: 2, y: 0 });

    const steps = capturedSteps((capture) =>
      resolveTurn(
        state,
        plan('p1', 1, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
        emptyPlan('p2', 1),
        rngFor('p1'),
        capture,
      ),
    );

    expect(steps.map((s) => s.phase)).toEqual([
      'start',
      'turnStart',
      'movement',
      'preAttack',
      'attack',
      'heal',
      'endOfTurn',
    ]);
  });

  it('each step keeps a snapshot of that moment, not a reference to the final board', () => {
    const state = emptyState();
    const mover = addUnit(state, 'tank2', 'p1', { x: 0, y: 0 }); // 이동 4

    const steps = capturedSteps((capture) =>
      resolveTurn(
        state,
        plan('p1', 1, { [mover.instanceId]: { baseAction: { kind: 'move', direction: 'right', distance: 3 } } }),
        emptyPlan('p2', 1),
        rngFor('p1'),
        capture,
      ),
    );

    const before = steps.find((s) => s.phase === 'start')!;
    const after = steps.find((s) => s.phase === 'movement')!;
    expect(before.units.find((u) => u.instanceId === mover.instanceId)!.position).toEqual({ x: 0, y: 0 });
    expect(after.units.find((u) => u.instanceId === mover.instanceId)!.position).toEqual({ x: 3, y: 0 });

    // 해결이 끝난 뒤 판을 더 흔들어도 기록은 그대로여야 한다.
    mover.position = { x: 8, y: 8 };
    expect(after.units.find((u) => u.instanceId === mover.instanceId)!.position).toEqual({ x: 3, y: 0 });
  });

  it('splits events by when they were pushed, and drops priority bookkeeping', () => {
    const state = emptyState();
    const attacker = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });
    const victim = addUnit(state, 'support2', 'p2', { x: 2, y: 0 });
    victim.currentHp = 3; // 한 방에 죽여 처치가 어느 단계에 들어가는지 본다

    const steps = capturedSteps((capture) =>
      resolveTurn(
        state,
        plan('p1', 1, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
        emptyPlan('p2', 1),
        rngFor('p1'),
        capture,
      ),
    );

    const attackStep = steps.find((s) => s.phase === 'attack')!;
    const types = attackStep.events.map((e) => e.type);
    expect(types).toContain('hit');
    // killUnit은 death 이벤트에 phase:'endOfTurn'을 달지만, 실제로 죽은 것은 공격 단계다 —
    // 밀어 넣은 순서로 자르기 때문에 처치는 눈에 보이는 그 순간에 함께 나온다.
    expect(types).toContain('death');
    expect(steps.every((s) => s.events.every((e) => e.phase !== 'priority'))).toBe(true);
  });

  it('resolves identically whether or not capture is passed', () => {
    const build = () => {
      const state = emptyState();
      const attacker = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });
      addUnit(state, 'support2', 'p2', { x: 2, y: 0 });
      return { state, attacker };
    };

    const bare = build();
    const logBare = resolveTurn(
      bare.state,
      plan('p1', 1, { [bare.attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    const watched = build();
    const logWatched = resolveTurn(
      watched.state,
      plan('p1', 1, { [watched.attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
      () => {},
    );

    expect(logWatched.map((e) => e.type)).toEqual(logBare.map((e) => e.type));
    expect(watched.state.units.map((u) => u.currentHp)).toEqual(bare.state.units.map((u) => u.currentHp));
  });
});

describe('compactReplay', () => {
  it('drops steps where nothing happened and nothing changed', () => {
    const state = emptyState();
    addUnit(state, 'tank1', 'p1', { x: 0, y: 0 });

    const steps = capturedSteps((capture) =>
      resolveTurn(state, emptyPlan('p1', 1), emptyPlan('p2', 1), rngFor('p1'), capture),
    );
    const kept = compactReplay(steps);

    expect(kept.length).toBeLessThan(steps.length);
    expect(kept[0].phase).toBe('start'); // 시작 판은 언제나 남는다 — 기준이 없으면 변화도 없다
    expect(kept).not.toContainEqual(expect.objectContaining({ phase: 'preAttack' }));
  });

  it('keeps a step whose only change is a status effect', () => {
    // 「2. 변환」은 판 위 위치도 체력도 안 바뀐다 — 상태이상을 지문에 넣지 않으면
    // 사용자가 이름으로 지목한 바로 그 단계가 통째로 사라진다.
    const state = emptyState();
    const barrier = addUnit(state, 'tank3', 'p1', { x: 0, y: 0 });

    const steps = capturedSteps((capture) =>
      resolveTurn(
        state,
        plan('p1', 1, {
          [barrier.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'tank3_barrier' } },
        }),
        emptyPlan('p2', 1),
        rngFor('p1'),
        capture,
      ),
    );

    expect(compactReplay(steps).some((s) => s.phase === 'preAttack')).toBe(true);
  });
});
