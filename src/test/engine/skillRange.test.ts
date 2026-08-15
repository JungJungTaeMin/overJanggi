import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../engine/resolveTurn';
import { isActionLegal } from '../../engine/validation';
import { addUnit, emptyPlan, emptyState, plan, rngFor, testBoard } from './helpers';

/**
 * 대상 지정 기술의 **사거리**. 오랫동안 `payload.range`는 아무 데서도 읽히지 않는 장식이었다 —
 * 해결 단계는 instanceId로 대상을 찾아 거리 검사 없이 적용했고, validation은 쿨타임·충전만 봤으며,
 * UI는 살아 있는 기물 전체를 드롭다운에 넣었다. 그 결과:
 *
 *   - support2("회복 직선 4칸")가 13×19 맵 어디로든 회복했고
 *   - dealer4("대각선 3칸 자리교체")는 사실상 무제한 순간이동이었다.
 *
 * 데이터의 사거리를 4에서 7로 올려도 시뮬레이션 결과가 한 자리도 변하지 않아서 발견했다.
 * AI만 `chebyshev <= 4`를 하드코딩해 두고 있었기 때문에, 그 숫자가 사실상의 규칙이었다.
 */
describe('targeted skill range', () => {
  describe('support2 heal — 직선만, 사거리 안에서만', () => {
    it('heals an ally in a straight line within range', () => {
      const state = emptyState();
      const healer = addUnit(state, 'support2', 'p1', { x: 0, y: 0 });
      const ally = addUnit(state, 'tank1', 'p1', { x: 3, y: 0 }); // 같은 행, 3칸
      ally.currentHp = 1;

      resolveTurn(
        state,
        plan('p1', 1, {
          [healer.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'support2_heal', target: ally.instanceId } },
        }),
        emptyPlan('p2', 1),
        rngFor('p1'),
      );

      expect(ally.currentHp).toBeGreaterThan(1);
    });

    it('does not heal an ally that is off the line, however close it is', () => {
      // 대각선으로 한 칸 어긋난 아군 — 거리는 가깝지만 "직선"이 아니라 닿지 않는다.
      const state = emptyState();
      const healer = addUnit(state, 'support2', 'p1', { x: 0, y: 0 });
      const ally = addUnit(state, 'tank1', 'p1', { x: 1, y: 1 });
      ally.currentHp = 1;

      resolveTurn(
        state,
        plan('p1', 1, {
          [healer.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'support2_heal', target: ally.instanceId } },
        }),
        emptyPlan('p2', 1),
        rngFor('p1'),
      );

      expect(ally.currentHp).toBe(1);
    });

    it('does not heal across the whole board — the old bug', () => {
      const state = emptyState(testBoard({ width: 20 }));
      const healer = addUnit(state, 'support2', 'p1', { x: 0, y: 0 });
      const ally = addUnit(state, 'tank1', 'p1', { x: 12, y: 0 });
      ally.currentHp = 1;

      resolveTurn(
        state,
        plan('p1', 1, {
          [healer.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'support2_heal', target: ally.instanceId } },
        }),
        emptyPlan('p2', 1),
        rngFor('p1'),
      );

      expect(ally.currentHp).toBe(1);
    });

    it('is blocked by terrain — no healing through a wall', () => {
      const state = emptyState(testBoard({ obstacles: [{ x: 2, y: 0 }] }));
      const healer = addUnit(state, 'support2', 'p1', { x: 0, y: 0 });
      const ally = addUnit(state, 'tank1', 'p1', { x: 4, y: 0 });
      ally.currentHp = 1;

      resolveTurn(
        state,
        plan('p1', 1, {
          [healer.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'support2_heal', target: ally.instanceId } },
        }),
        emptyPlan('p2', 1),
        rngFor('p1'),
      );

      expect(ally.currentHp).toBe(1);
    });

    it('measures range from where the unit ends up, so stepping aside to open a line is legal', () => {
      // 사거리를 출발 칸으로 재면 "라인을 열려고 옆으로 한 칸 서는" 정상적인 수가 전부 불법이 된다.
      // 힐러가 (0,0), 아군이 (3,1) — 지금은 어긋나 있지만 (0,1)로 내려서면 같은 행이 된다.
      const state = emptyState();
      const healer = addUnit(state, 'support2', 'p1', { x: 0, y: 0 });
      const ally = addUnit(state, 'tank1', 'p1', { x: 3, y: 1 });
      ally.currentHp = 1;

      const stepAsideAndHeal = {
        baseAction: { kind: 'move' as const, direction: 'down' as const, distance: 1, path: ['down' as const] },
        skillUse: { skillId: 'support2_heal', target: ally.instanceId },
      };
      // 제자리에서 쏘는 건 불법, 라인을 열면서 쏘는 건 합법 — 차이는 목적지뿐이다.
      expect(
        isActionLegal(state, healer, {
          baseAction: { kind: 'none' },
          skillUse: { skillId: 'support2_heal', target: ally.instanceId },
        }),
      ).toBe(false);
      expect(isActionLegal(state, healer, stepAsideAndHeal)).toBe(true);

      resolveTurn(state, plan('p1', 1, { [healer.instanceId]: stepAsideAndHeal }), emptyPlan('p2', 1), rngFor('p1'));

      expect(healer.position).toEqual({ x: 0, y: 1 });
      expect(ally.currentHp).toBeGreaterThan(1);
    });
  });

  /**
   * 조준 보조는 기획서에 없는 신규 기술이라, 넣은 근거 자체가 회귀 대상이다: 이 기물이 최하위였던
   * 이유는 회복이 약해서가 아니라 **회복을 걸 수 있는 턴이 9%뿐**이어서였고(사거리 안에 아군이
   * 있는 턴은 67%인데 그중 다친 아군이 있는 턴이 9%), 버프는 멀쩡한 아군에게도 걸려 그 격차를 메운다.
   * 그래서 "멀쩡한 아군에게 걸린다"가 이 기술의 핵심 계약이다.
   */
  describe('support2 buff — 사선 위 아군 공격력 증가', () => {
    it('buffs a full-health ally, which is the whole point of the skill', () => {
      const state = emptyState();
      const healer = addUnit(state, 'support2', 'p1', { x: 0, y: 0 });
      const ally = addUnit(state, 'dealer1', 'p1', { x: 4, y: 0 }); // 같은 행, 멀쩡함

      resolveTurn(
        state,
        plan('p1', 1, {
          [healer.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'support2_buff', target: ally.instanceId } },
        }),
        emptyPlan('p2', 1),
        rngFor('p1'),
      );

      expect(ally.statusEffects.some((e) => e.type === 'buff')).toBe(true);
    });

    it('actually raises the damage the buffed ally deals this same turn', () => {
      // 2단계(공격 전 상태변화)에서 걸리므로 3단계 공격에 반영돼야 한다. 한 턴 늦게 들어오면
      // "지금 이 적을 마무리하려고 버프를 건다"는 계획이 전부 빗나간다.
      const state = emptyState();
      const healer = addUnit(state, 'support2', 'p1', { x: 0, y: 0 });
      const shooter = addUnit(state, 'dealer1', 'p1', { x: 3, y: 0 }); // 공격 8, 직선 6
      const enemy = addUnit(state, 'tank1', 'p2', { x: 5, y: 0 });
      const bonus = 3; // unitTypes의 support2_buff.attackBonus

      resolveTurn(
        state,
        plan('p1', 1, {
          [healer.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'support2_buff', target: shooter.instanceId } },
          [shooter.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } },
        }),
        emptyPlan('p2', 1),
        rngFor('p1'),
      );

      expect(enemy.currentHp).toBe(enemy.maxHp - (8 + bonus));
    });

    it('does not buff an enemy', () => {
      const state = emptyState();
      const healer = addUnit(state, 'support2', 'p1', { x: 0, y: 0 });
      const enemy = addUnit(state, 'dealer1', 'p2', { x: 3, y: 0 });

      resolveTurn(
        state,
        plan('p1', 1, {
          [healer.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'support2_buff', target: enemy.instanceId } },
        }),
        emptyPlan('p2', 1),
        rngFor('p1'),
      );

      expect(enemy.statusEffects.some((e) => e.type === 'buff')).toBe(false);
    });

    it('obeys the same straight-line rule as the heal — no buffing off the line', () => {
      // 신규 기술이라고 축을 풀어 주면 저격수 컨셉이 이 기물에서만 무너진다.
      const state = emptyState();
      const healer = addUnit(state, 'support2', 'p1', { x: 0, y: 0 });
      const ally = addUnit(state, 'dealer1', 'p1', { x: 2, y: 3 });

      resolveTurn(
        state,
        plan('p1', 1, {
          [healer.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'support2_buff', target: ally.instanceId } },
        }),
        emptyPlan('p2', 1),
        rngFor('p1'),
      );

      expect(ally.statusEffects.some((e) => e.type === 'buff')).toBe(false);
    });
  });

  describe('support2 root — 직선 2칸', () => {
    it('roots an enemy on the line within 2', () => {
      const state = emptyState();
      const caster = addUnit(state, 'support2', 'p1', { x: 0, y: 0 });
      const enemy = addUnit(state, 'tank1', 'p2', { x: 2, y: 0 });

      resolveTurn(
        state,
        plan('p1', 1, {
          [caster.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'support2_root', target: enemy.instanceId } },
        }),
        emptyPlan('p2', 1),
        rngFor('p1'),
      );

      expect(enemy.statusEffects.some((e) => e.type === 'root')).toBe(true);
    });

    it('does not root an enemy 3 cells away', () => {
      const state = emptyState();
      const caster = addUnit(state, 'support2', 'p1', { x: 0, y: 0 });
      const enemy = addUnit(state, 'tank1', 'p2', { x: 3, y: 0 });

      resolveTurn(
        state,
        plan('p1', 1, {
          [caster.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'support2_root', target: enemy.instanceId } },
        }),
        emptyPlan('p2', 1),
        rngFor('p1'),
      );

      expect(enemy.statusEffects.some((e) => e.type === 'root')).toBe(false);
    });
  });

  describe('dealer4 swap — 대각선 3칸', () => {
    it('swaps with an ally on the diagonal within 3', () => {
      const state = emptyState();
      const dealer = addUnit(state, 'dealer4', 'p1', { x: 0, y: 0 });
      const ally = addUnit(state, 'tank1', 'p1', { x: 2, y: 2 });

      resolveTurn(
        state,
        plan('p1', 1, {
          [dealer.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'dealer4_swap', target: ally.instanceId } },
        }),
        emptyPlan('p2', 1),
        rngFor('p1'),
      );

      expect(dealer.position).toEqual({ x: 2, y: 2 });
      expect(ally.position).toEqual({ x: 0, y: 0 });
    });

    it('refuses an ally that is not on a true diagonal', () => {
      const state = emptyState();
      const dealer = addUnit(state, 'dealer4', 'p1', { x: 0, y: 0 });
      const ally = addUnit(state, 'tank1', 'p1', { x: 2, y: 1 });

      resolveTurn(
        state,
        plan('p1', 1, {
          [dealer.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'dealer4_swap', target: ally.instanceId } },
        }),
        emptyPlan('p2', 1),
        rngFor('p1'),
      );

      expect(dealer.position).toEqual({ x: 0, y: 0 });
      expect(ally.position).toEqual({ x: 2, y: 1 });
    });

    it('is not a teleport — a far diagonal ally is out of reach', () => {
      // 이게 예전의 실제 동작이었다: 대각선이기만 하면 판 끝까지 자리교체가 됐다.
      const state = emptyState();
      const dealer = addUnit(state, 'dealer4', 'p1', { x: 0, y: 0 });
      const ally = addUnit(state, 'tank1', 'p1', { x: 5, y: 5 });

      resolveTurn(
        state,
        plan('p1', 1, {
          [dealer.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'dealer4_swap', target: ally.instanceId } },
        }),
        emptyPlan('p2', 1),
        rngFor('p1'),
      );

      expect(dealer.position).toEqual({ x: 0, y: 0 });
      expect(ally.position).toEqual({ x: 5, y: 5 });
    });
  });

  describe('validation', () => {
    it('rejects a targeted skill with no target at all', () => {
      // 예전에는 통과해서 쿨타임만 소모하고 아무 일도 일어나지 않았다.
      const state = emptyState();
      const caster = addUnit(state, 'tank3', 'p1', { x: 0, y: 0 });
      addUnit(state, 'tank1', 'p2', { x: 1, y: 0 });

      expect(isActionLegal(state, caster, { baseAction: { kind: 'none' }, skillUse: { skillId: 'tank3_root' } })).toBe(false);
    });

    it('rejects an out-of-range target so the plan never reaches resolution', () => {
      const state = emptyState(testBoard({ width: 20 }));
      const caster = addUnit(state, 'support2', 'p1', { x: 0, y: 0 });
      const far = addUnit(state, 'tank1', 'p1', { x: 12, y: 0 });

      expect(
        isActionLegal(state, caster, {
          baseAction: { kind: 'none' },
          skillUse: { skillId: 'support2_heal', target: far.instanceId },
        }),
      ).toBe(false);
    });
  });
});
