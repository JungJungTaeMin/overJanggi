import { describe, expect, it } from 'vitest';
import type { Direction, Position } from '../../engine/types';
import { resolveTurn } from '../../engine/resolveTurn';
import { addUnit, emptyPlan, emptyState, plan, rngFor } from './helpers';
import { ammoState } from '../../engine/unitStats';

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

  it('dealer1은 2발 쏘고 한 턴 쉰다 — 공격·공격·휴식이 반복된다', () => {
    // 장거리 화력형의 제약은 "쏘면 3턴 못 쏜다"가 아니라 탄창식이다: 2발 연속 → 1턴 휴식 → 다시 2발.
    // 매 턴 같은 공격을 계획해도 쉬는 턴은 sanitizePlan이 걸러내므로(validation.ts) 피해가 0이 된다.
    const state = emptyState();
    const sniper = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });
    const target = addUnit(state, 'tank1', 'p2', { x: 3, y: 0 });

    // 매 턴 체력을 되돌려 놓는다 — 표적이 죽으면 부활 대기로 빠져 사선에서 사라지고, 그때부터는
    // "쏘지 않은 턴"과 "쏠 대상이 없던 턴"이 구별되지 않는다. 재려는 건 발사 게이트뿐이다.
    const dealt: number[] = [];
    for (let turn = 1; turn <= 6; turn++) {
      target.currentHp = target.maxHp;
      resolveTurn(
        state,
        plan('p1', turn, { [sniper.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
        emptyPlan('p2', turn),
        rngFor('p1'),
      );
      dealt.push(target.maxHp - target.currentHp);
    }

    expect(dealt.map((d) => d > 0)).toEqual([true, true, false, true, true, false]);
    // 쏜 턴들은 전부 같은 피해 — 쉬는 턴이 "빗나간 턴"이 아니라 진짜 발사 금지임을 못박는다.
    expect(new Set(dealt.filter((d) => d > 0)).size).toBe(1);
  });

  it('축마다 사거리가 다르면 방향에 따라 닿는 거리가 달라진다 — dealer3는 직선 4칸 · 대각 1칸', () => {
    // `diagonalRange`가 붙기 전까지 AttackShape의 사거리는 축과 무관한 값 하나였다. 이 테스트가
    // 지키는 것은 dealer3의 숫자가 아니라 **비대칭 사거리가 실제로 해결 단계에 반영된다**는
    // 사실이다 — 대각 2칸이 맞으면 diagonalRange가 어디선가 무시되고 range로 대체된 것이다.
    const shot = (attackerAt: Position, targetAt: Position, direction: Direction) => {
      const state = emptyState();
      const shooter = addUnit(state, 'dealer3', 'p1', attackerAt);
      const target = addUnit(state, 'tank1', 'p2', targetAt); // maxHp 40 — 한 방에 안 죽어 피해량이 그대로 남는다
      resolveTurn(
        state,
        plan('p1', 1, {
          // 공격 모드를 켜야 쏠 수 있는 기물이라 토글을 같은 턴에 함께 낸다.
          [shooter.instanceId]: { baseAction: { kind: 'attack', direction }, skillUse: { skillId: 'dealer3_attack_mode' } },
        }),
        emptyPlan('p2', 1),
        rngFor('p1'),
      );
      return target.maxHp - target.currentHp;
    };

    expect(shot({ x: 0, y: 4 }, { x: 4, y: 4 }, 'right')).toBeGreaterThan(0); // 직선 4칸 — 닿는다
    expect(shot({ x: 0, y: 4 }, { x: 1, y: 5 }, 'downright')).toBeGreaterThan(0); // 대각 1칸 — 닿는다
    expect(shot({ x: 0, y: 4 }, { x: 2, y: 6 }, 'downright')).toBe(0); // 대각 2칸 — 안 닿는다
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

/**
 * 탄창 잔량은 화면이 보여줘야 하는 값인데 `charges`와 `cooldowns` 두 곳에서 유도된다.
 * UI가 직접 계산하면 쿨타임의 +1(같은 턴 끝에 깎일 몫)을 몰라 휴식 턴수를 하나씩 더 표시하게
 * 되므로, `ammoState()` 한 곳만 쓰게 하고 그 함수를 여기서 잠근다.
 */
describe('ammoState — 탄창식 기본 공격의 화면 표시용 단일 근거', () => {
  it('탄창식이 아닌 기물은 null이라 "해당 없음"과 "0발"이 구별된다', () => {
    const state = emptyState();
    expect(ammoState(addUnit(state, 'tank1', 'p1', { x: 0, y: 0 }))).toBeNull();
  });

  it('쏘기 전에는 탄창이 꽉 차 있다', () => {
    const state = emptyState();
    const d1 = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });
    expect(ammoState(d1)).toEqual({ magazine: 2, remaining: 2, restingTurns: 0 });
  });

  it('한 발 쏘면 잔탄만 줄고 아직 쉬지 않는다', () => {
    const state = emptyState();
    const d1 = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });
    addUnit(state, 'tank1', 'p2', { x: 3, y: 0 });

    resolveTurn(
      state,
      plan('p1', 1, { [d1.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(ammoState(d1)).toEqual({ magazine: 2, remaining: 1, restingTurns: 0 });
  });

  it('탄창을 비우면 휴식에 들어가고 잔탄이 0이 된다', () => {
    const state = emptyState();
    const d1 = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });
    addUnit(state, 'tank1', 'p2', { x: 3, y: 0 });
    const shoot = { baseAction: { kind: 'attack' as const, direction: 'right' as const } };

    resolveTurn(state, plan('p1', 1, { [d1.instanceId]: shoot }), emptyPlan('p2', 1), rngFor('p1'));
    resolveTurn(state, plan('p1', 2, { [d1.instanceId]: shoot }), emptyPlan('p2', 2), rngFor('p1'));

    // 공격 단계에서 2로 걸렸다가 같은 턴 종료에 1로 깎인 상태다 — 다음 턴 공격이 불법이므로
    // 사람이 체감하는 대기도 정확히 1턴이다.
    expect(ammoState(d1)).toEqual({ magazine: 2, remaining: 0, restingTurns: 1 });
  });
});
