import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../engine/resolveTurn';
import { addUnit, emptyPlan, emptyState, plan, rngFor } from './helpers';

/**
 * **빗나간 공격은 판에 아무 흔적도 남기지 않는다** — 그래서 이벤트로 남기지 않으면
 * "쏘긴 쐈는데 아무 일도 없었다"를 사용자가 알 길이 없다. 체력 차이로 추정할 수도 없다:
 * 0 피해는 방벽에 막힌 것과 애초에 조준이 빈 것을 구분하지 못하고, 그 둘은 다음 수가 정반대다.
 */
describe('noTarget event', () => {
  it('fires when an attack is aimed at empty space', () => {
    const state = emptyState();
    const attacker = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });

    const log = resolveTurn(
      state,
      plan('p1', 1, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    const miss = log.find((e) => e.type === 'noTarget');
    expect(miss).toBeDefined();
    expect(miss!.actorId).toBe(attacker.instanceId);
    // 판 위에 배지를 찍으려면 **쏜 자리**가 필요하다 — 나중에 위치를 되찾으면 이미 움직인 뒤다.
    expect(miss!.detail?.at).toEqual({ x: 0, y: 0 });
    expect(miss!.detail?.direction).toBe('right');
  });

  it('does not fire when the attack lands', () => {
    const state = emptyState();
    const attacker = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });
    addUnit(state, 'support2', 'p2', { x: 2, y: 0 });

    const log = resolveTurn(
      state,
      plan('p1', 1, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(log.some((e) => e.type === 'hit')).toBe(true);
    expect(log.some((e) => e.type === 'noTarget')).toBe(false);
  });

  it('does not fire when a barrier eats the shot — blocked is not missed', () => {
    const state = emptyState();
    const attacker = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });
    const defender = addUnit(state, 'tank3', 'p2', { x: 2, y: 0 });

    const log = resolveTurn(
      state,
      plan('p1', 1, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
      plan('p2', 1, { [defender.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'tank3_barrier' } } }),
      rngFor('p1'),
    );

    expect(log.some((e) => e.type === 'blockedByBarrier')).toBe(true);
    expect(log.some((e) => e.type === 'noTarget')).toBe(false);
  });
});
