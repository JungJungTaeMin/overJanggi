import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../engine/resolveTurn';
import { addUnit, emptyPlan, emptyState, plan, rngFor } from './helpers';

/**
 * support3(확률·포탑형)은 "턴 시작 시 동전 결정: 앞면 이동2·공격6 / 뒷면 이동1·공격4"인데,
 * 구현에서는 오랫동안 동전이 **공격력에만** 붙어 있었다. 이동 관련 값(headsMove/tailsMove)을
 * 읽는 코드가 아예 없었고 typeDef.moveSpeed는 0이라, 이 기물은 한 칸도 움직이지 못했다.
 * 게다가 동전을 굴리는 자리가 2단계(공격 전 상태변화)라 1단계(이동)보다 뒤였다 —
 * 이동이 동전을 참조하려 해도 지난 턴 결과밖에 볼 수 없는 구조였다.
 *
 * rngFor('p1')은 () => 0(앞면), rngFor('p2')는 () => 0.9(뒷면)를 돌려준다.
 */
describe('support3 coin flip', () => {
  const moveTwo = { baseAction: { kind: 'move' as const, direction: 'right' as const, distance: 2, path: ['right' as const, 'right' as const] } };

  it('heads gives 2 move — the full planned distance resolves', () => {
    const state = emptyState();
    const unit = addUnit(state, 'support3', 'p1', { x: 0, y: 0 });

    resolveTurn(state, plan('p1', 1, { [unit.instanceId]: moveTwo }), emptyPlan('p2', 1), rngFor('p1'));

    expect(unit.position).toEqual({ x: 2, y: 0 });
  });

  it('tails gives 1 move — the same plan is truncated, not thrown away', () => {
    // 계획은 앞면 기준(최대치)으로 세우고 해결에서 잘린다. 굴린 뒤 검증하면 뒷면일 때 계획 전체가
    // 무효가 되어 "운이 나쁘면 아무것도 못 한다"가 되므로 자르는 쪽을 택했다.
    const state = emptyState();
    const unit = addUnit(state, 'support3', 'p1', { x: 0, y: 0 });

    resolveTurn(state, plan('p1', 1, { [unit.instanceId]: moveTwo }), emptyPlan('p2', 1), rngFor('p2'));

    expect(unit.position).toEqual({ x: 1, y: 0 });
  });

  it('uses the injected rng, so the same seed replays identically', () => {
    // 예전 구현은 Math.random을 직접 불렀다. 엔진이 순수 함수라는 전제(테스트·재현·리플레이)가 깨진다.
    const results = [0, 1].map(() => {
      const state = emptyState();
      const unit = addUnit(state, 'support3', 'p1', { x: 0, y: 0 });
      const log = resolveTurn(state, emptyPlan('p1', 1), emptyPlan('p2', 1), rngFor('p1'));
      void unit;
      return log.find((e) => e.type === 'coinFlip')?.detail?.heads;
    });
    expect(results[0]).toBe(true);
    expect(results[0]).toBe(results[1]);
  });

  it('only this turn’s coin counts — last turn’s flip does not linger', () => {
    // 상태이상 기본 수명이 "적용 턴 + 다음 턴"이라, 지우지 않으면 두 턴치가 겹쳐서
    // hasActiveEffect('coinHeads')가 사실상 "둘 중 하나라도 앞면"(=75%)이 되어 버린다.
    const state = emptyState();
    const unit = addUnit(state, 'support3', 'p1', { x: 0, y: 0 });

    resolveTurn(state, emptyPlan('p1', 1), emptyPlan('p2', 1), rngFor('p1')); // 앞면
    resolveTurn(state, emptyPlan('p1', 2), emptyPlan('p2', 2), rngFor('p2')); // 뒷면

    expect(unit.statusEffects.filter((e) => e.type === 'coinHeads' || e.type === 'coinTails')).toHaveLength(1);
    expect(unit.statusEffects.some((e) => e.type === 'coinTails')).toBe(true);
  });
});

describe('support3 turret', () => {
  const spawn = { baseAction: { kind: 'none' as const }, skillUse: { skillId: 'support3_turret', target: 'right' as const } };

  it('keeps only one turret per team — a new one replaces the old', () => {
    // 제한이 없으면 매 턴 포탑을 하나씩 남기며 지나가, HP 1짜리 회복 오라 벽이 판 전체에 깔린다
    // (시뮬레이션에서 한 판에 19기까지 쌓였다).
    const state = emptyState();
    const unit = addUnit(state, 'support3', 'p1', { x: 0, y: 0 });

    resolveTurn(state, plan('p1', 1, { [unit.instanceId]: spawn }), emptyPlan('p2', 1), rngFor('p1'));
    expect(state.units.filter((u) => u.isTurret)).toHaveLength(1);

    resolveTurn(state, plan('p1', 2, { [unit.instanceId]: spawn }), emptyPlan('p2', 2), rngFor('p1'));
    expect(state.units.filter((u) => u.isTurret)).toHaveLength(1);
  });

  it('caps at one turret per team even when that team fields two support3', () => {
    // 제한은 소환자별이 아니라 **팀별**이다 — 판 전체에 최대 2기(A팀 1 · B팀 1).
    const state = emptyState();
    const a = addUnit(state, 'support3', 'p1', { x: 0, y: 0 });
    const b = addUnit(state, 'support3', 'p1', { x: 0, y: 2 });
    const enemy = addUnit(state, 'support3', 'p2', { x: 5, y: 5 });

    resolveTurn(
      state,
      plan('p1', 1, { [a.instanceId]: spawn, [b.instanceId]: spawn }),
      plan('p2', 1, { [enemy.instanceId]: spawn }),
      rngFor('p1'),
    );

    const turrets = state.units.filter((u) => u.isTurret);
    expect(turrets).toHaveLength(2);
    expect(turrets.filter((t) => t.owner === 'p1')).toHaveLength(1);
    expect(turrets.filter((t) => t.owner === 'p2')).toHaveLength(1);
  });

  it('removes the old turret before movement, so it cannot block its own summoner', () => {
    // 포탑은 바로 앞칸에 선다. 철거를 2단계까지 미루면 자기가 세운 포탑에 스스로 길이 막혀
    // 앞으로 나아갈 수 없다 — 실제로 그래서 support3이 점령지에 한 번도 들어가지 못했다.
    const state = emptyState();
    const unit = addUnit(state, 'support3', 'p1', { x: 0, y: 0 });

    resolveTurn(state, plan('p1', 1, { [unit.instanceId]: spawn }), emptyPlan('p2', 1), rngFor('p1'));
    expect(state.units.find((u) => u.isTurret)?.position).toEqual({ x: 1, y: 0 });

    resolveTurn(
      state,
      plan('p1', 2, {
        [unit.instanceId]: { baseAction: { kind: 'move', direction: 'right', distance: 1, path: ['right'] }, skillUse: spawn.skillUse },
      }),
      emptyPlan('p2', 2),
      rngFor('p1'),
    );

    expect(unit.position).toEqual({ x: 1, y: 0 });
    expect(state.units.find((u) => u.isTurret)?.position).toEqual({ x: 2, y: 0 });
  });

  it('never moves, even when handed a move plan', () => {
    // 포탑은 고정물이다. 실제로는 계획 패널·plansForTurn·AI가 전부 isTurret으로 걸러서 계획이
    // 들어올 일이 없지만, 그 필터가 하나라도 새면 조용히 걸어다니게 되므로 엔진 쪽 상한(moveSpeed 0)이
    // 최후의 방어선인지 직접 확인한다.
    const state = emptyState();
    const unit = addUnit(state, 'support3', 'p1', { x: 0, y: 0 });

    resolveTurn(state, plan('p1', 1, { [unit.instanceId]: spawn }), emptyPlan('p2', 1), rngFor('p1'));
    const turret = state.units.find((u) => u.isTurret)!;
    expect(turret.position).toEqual({ x: 1, y: 0 });

    resolveTurn(
      state,
      plan('p1', 2, {
        [turret.instanceId]: { baseAction: { kind: 'move', direction: 'right', distance: 1, path: ['right'] } },
      }),
      emptyPlan('p2', 2),
      rngFor('p1'),
    );

    expect(turret.position).toEqual({ x: 1, y: 0 });
  });

  it('heals allies around it and never damages anyone — it is a healing turret', () => {
    // 기획상 포탑은 딜링이 아니라 힐링이다. 주변 8칸 중 **아군만** 회복하고, 적은 회복도 피해도 받지 않는다.
    const state = emptyState();
    const unit = addUnit(state, 'support3', 'p1', { x: 0, y: 0 });
    const ally = addUnit(state, 'tank1', 'p1', { x: 2, y: 0 }); // 포탑(1,0) 인접
    const foe = addUnit(state, 'tank1', 'p2', { x: 1, y: 1 }); // 포탑(1,0) 인접
    ally.currentHp = 1;
    const foeHpBefore = foe.currentHp;

    const log = resolveTurn(state, plan('p1', 1, { [unit.instanceId]: spawn }), emptyPlan('p2', 1), rngFor('p1'));

    expect(ally.currentHp).toBeGreaterThan(1);
    expect(foe.currentHp).toBe(foeHpBefore);
    const turret = state.units.find((u) => u.isTurret)!;
    expect(log.some((e) => e.type === 'hit' && e.actorId === turret.instanceId)).toBe(false);
  });
});
