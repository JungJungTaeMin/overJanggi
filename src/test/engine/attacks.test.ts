import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../engine/resolveTurn';
import { addUnit, emptyPlan, emptyState, plan, rngFor } from './helpers';

describe('attack resolution', () => {
  it('a line attack only hits the first enemy along the ray', () => {
    const state = emptyState();
    const attacker = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 }); // attack 8, range 6
    const near = addUnit(state, 'support2', 'p2', { x: 2, y: 0 }); // maxHp 15(hpLv3×5) — 8뎀 한방으론 안 죽으므로 낮춰서 사망을 강제한다
    near.currentHp = 5;
    const far = addUnit(state, 'support2', 'p2', { x: 4, y: 0 });

    resolveTurn(
      state,
      plan('p1', 1, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(near.alive).toBe(false);
    expect(far.alive).toBe(true);
    expect(far.currentHp).toBe(far.maxHp);
  });

  it('a friendly unit on the line blocks the attack without taking damage', () => {
    const state = emptyState();
    const attacker = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });
    const ally = addUnit(state, 'tank1', 'p1', { x: 2, y: 0 });
    const enemy = addUnit(state, 'support2', 'p2', { x: 4, y: 0 });

    resolveTurn(
      state,
      plan('p1', 1, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(ally.currentHp).toBe(ally.maxHp);
    expect(enemy.alive).toBe(true);
    expect(enemy.currentHp).toBe(enemy.maxHp);
  });

  it('an obstacle blocks the line, protecting units behind it', () => {
    const state = emptyState({
      width: 9,
      height: 9,
      obstacles: [{ x: 2, y: 0 }],
      captureZone: [],
      startZones: { p1: [{ x: 0, y: 0 }], p2: [{ x: 8, y: 8 }] },
    });
    const attacker = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });
    const enemy = addUnit(state, 'support2', 'p2', { x: 4, y: 0 });

    resolveTurn(
      state,
      plan('p1', 1, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(enemy.alive).toBe(true);
    expect(enemy.currentHp).toBe(enemy.maxHp);
  });

  it('an AoE attack independently hits every target in its band', () => {
    const state = emptyState();
    const attacker = addUnit(state, 'tank3', 'p1', { x: 2, y: 2 }); // frontBand: right => (3,1)(3,2)(3,3)
    const top = addUnit(state, 'support2', 'p2', { x: 3, y: 1 });
    const bottom = addUnit(state, 'support2', 'p2', { x: 3, y: 3 });

    resolveTurn(
      state,
      plan('p1', 1, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(top.currentHp).toBe(Math.max(0, top.maxHp - 5));
    expect(bottom.currentHp).toBe(Math.max(0, bottom.maxHp - 5));
  });

  it('an AoE attack cannot target a cell occupied by a terrain obstacle', () => {
    // §3.4/§8: 장애물 뒤에 있는(장애물이 놓인) 칸은 범위형 공격의 대상이 아니다.
    const state = emptyState({
      width: 9,
      height: 9,
      obstacles: [{ x: 3, y: 1 }],
      captureZone: [],
      startZones: { p1: [{ x: 0, y: 0 }], p2: [{ x: 8, y: 8 }] },
    });
    const attacker = addUnit(state, 'tank3', 'p1', { x: 2, y: 2 }); // frontBand: right => (3,1)(3,2)(3,3)
    const onObstacle = addUnit(state, 'support2', 'p2', { x: 3, y: 1 });
    const exposed = addUnit(state, 'support2', 'p2', { x: 3, y: 3 });

    resolveTurn(
      state,
      plan('p1', 1, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(onObstacle.currentHp).toBe(onObstacle.maxHp);
    expect(exposed.currentHp).toBe(Math.max(0, exposed.maxHp - 5));
  });

  it('logs a cancelled-attack event for a unit that dies before the attack phase', () => {
    // §3.6/§9: 사망한 기물은 이후 행동을 수행하지 않으며, 공격 전에 사망해 취소된 경우 로그에 남는다.
    const state = emptyState();
    const killer = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 }); // attack 8, range 6
    const victim = addUnit(state, 'tank1', 'p2', { x: 2, y: 0 }); // canAttack, attack 3, range 3
    victim.currentHp = 1;
    const victimAttackTarget = addUnit(state, 'tank1', 'p1', { x: 4, y: 0 });

    const log = resolveTurn(
      state,
      plan('p1', 1, { [killer.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
      plan('p2', 1, { [victim.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
      rngFor('p1'),
    );

    expect(victim.alive).toBe(false);
    expect(victimAttackTarget.currentHp).toBe(victimAttackTarget.maxHp); // 죽은 채로 공격 차례를 맞아 아무 일도 없음
    expect(log.some((e) => e.phase === 'attack' && e.type === 'cancelledByDeath' && e.actorId === victim.instanceId)).toBe(true);
  });

  it('a priority-ordered "mutual" kill is actually one-sided — the winner strikes first and the loser never gets to act', () => {
    // v0.3: 공격은 더 이상 스냅샷-후-일괄적용이 아니라 우선순위 순서대로 한 기물씩 즉시 적용된다.
    // 두 tank1은 스탯이 완전히 동률이라 순위는 무작위 동률처리로 결정되고, rngFor('p1')은 배열
    // 원래 순서(p1이 먼저 추가됨)를 유지하도록 고정돼 있으므로 p1Unit이 먼저 공격해 p2Unit을
    // 죽이고, p2Unit은 이미 죽은 채로 자기 차례를 맞아 반격하지 못한다(3.6절).
    const state = emptyState();
    const p1Unit = addUnit(state, 'tank1', 'p1', { x: 0, y: 0 }); // attack 3, range 3
    const p2Unit = addUnit(state, 'tank1', 'p2', { x: 2, y: 0 });
    p1Unit.currentHp = 2;
    p2Unit.currentHp = 2;

    resolveTurn(
      state,
      plan('p1', 1, { [p1Unit.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
      plan('p2', 1, { [p2Unit.instanceId]: { baseAction: { kind: 'attack', direction: 'left' } } }),
      rngFor('p1'),
    );

    expect(p1Unit.alive).toBe(true);
    expect(p2Unit.alive).toBe(false);
  });
});
