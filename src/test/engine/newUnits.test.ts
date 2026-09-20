import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../engine/resolveTurn';
import { getUnitType } from '../../data/unitTypes';
import { addUnit, emptyPlan, emptyState, plan, rngFor, testBoard } from './helpers';
import type { GameState } from '../../engine/types';

/**
 * **새로 만든 여섯 기물의 규칙 잠금.**
 *
 * 여섯 중 넷(관통·화상·반격·표식)은 **기술이 아니라 공격 판정 자체를 바꾼다.** 그래서 틀려도
 * 예외가 나지 않고 그냥 피해 숫자가 조용히 달라진다 — 밀치기가 반대로 밀리면 판에서 눈에 띄지만,
 * 화상이 두 번 대신 세 번 닳는 건 아무도 눈치채지 못한 채 이 기물만 세진다(실제로 초안이 그랬고
 * 승률 59.8%로 튀었다).
 *
 * 그래서 여기서 잠그는 것은 값이 아니라 **횟수와 경계**다: 몇 명을 뚫는가, 몇 번 닳는가,
 * 되돌린 피해가 다시 되돌아오는가, 표식이 다음 턴까지 남는가.
 */

const HOOK = getUnitType('tank5').skills.find((s) => s.id === 'tank5_hook')!;
const BURN = getUnitType('dealer6').passive!;
const REFLECT_PERCENT = getUnitType('tank6').passive!.payload!.reflectPercent!;
const MARK = getUnitType('support6').skills.find((s) => s.id === 'support6_mark')!;

/** p1 한 명만 무언가를 하는 턴. 숫자를 읽기 쉽게 상대는 항상 아무것도 하지 않는다. */
function soloTurn(state: GameState, actorId: string, unitPlan: Parameters<typeof plan>[2][string], turn = 1) {
  return resolveTurn(state, plan('p1', turn, { [actorId]: unitPlan }), emptyPlan('p2', turn), rngFor('p1'));
}

describe('관통 사격(dealer5) — 첫 적에서 멈추지 않는다', () => {
  it('사선 위의 적을 전부 때린다', () => {
    const state = emptyState();
    const shooter = addUnit(state, 'dealer5', 'p1', { x: 1, y: 4 });
    // 대상은 **턴 종료 자동회복이 없는** 기물이라야 한다 — 범위 회복형을 세우면 그 회복이
    // 피해에 섞여 들어가 "관통이 반만 들어갔다"처럼 보인다(실제로 처음 그렇게 썼다).
    const near = addUnit(state, 'dealer1', 'p2', { x: 2, y: 4 });
    const far = addUnit(state, 'dealer1', 'p2', { x: 3, y: 4 });
    const power = getUnitType('dealer5').attack;

    soloTurn(state, shooter.instanceId, { baseAction: { kind: 'attack', direction: 'right' } });

    expect(near.currentHp).toBe(near.maxHp - power);
    expect(far.currentHp).toBe(far.maxHp - power);
  });

  /**
   * 뚫는 것은 **적의 몸**이지 방어 수단이 아니다. 여기가 무너지면 "앞에 하나 세워 두면 뒤가
   * 안전하다"는 대형 판단이 이 기물 하나 때문에 통째로 무의미해진다.
   */
  it('아군이 사선에 서 있으면 거기서 끊긴다 — 이미 맞힌 적은 그대로 맞는다', () => {
    const state = emptyState();
    const shooter = addUnit(state, 'dealer5', 'p1', { x: 1, y: 4 });
    const enemy = addUnit(state, 'dealer1', 'p2', { x: 2, y: 4 });
    addUnit(state, 'tank1', 'p1', { x: 3, y: 4 }); // 아군 차단
    const behind = addUnit(state, 'dealer1', 'p2', { x: 4, y: 4 });

    soloTurn(state, shooter.instanceId, { baseAction: { kind: 'attack', direction: 'right' } });

    expect(enemy.currentHp).toBe(enemy.maxHp - getUnitType('dealer5').attack);
    expect(behind.currentHp).toBe(behind.maxHp);
  });
});

describe('화상(dealer6) — 몇 번 닳는가', () => {
  it('명중한 턴부터 데이터의 duration만큼만 닳는다', () => {
    const state = emptyState();
    const shooter = addUnit(state, 'dealer6', 'p1', { x: 1, y: 4 });
    const target = addUnit(state, 'tank1', 'p2', { x: 2, y: 4 });
    const attack = getUnitType('dealer6').attack;
    const tick = BURN.payload!.damage!;
    const duration = BURN.payload!.duration!;

    soloTurn(state, shooter.instanceId, { baseAction: { kind: 'attack', direction: 'right' } });
    // 맞은 턴의 종료가 **첫 번째** 틱이다.
    expect(target.currentHp).toBe(target.maxHp - attack - tick);

    // 이후로는 아무도 아무것도 안 해도 duration을 채울 때까지만 계속 닳는다.
    for (let t = 2; t <= 6; t++) resolveTurn(state, emptyPlan('p1', t), emptyPlan('p2', t), rngFor('p1'));
    expect(target.currentHp).toBe(target.maxHp - attack - tick * duration);
  });

  /**
   * 겹쳐 쌓이지 않고 **다시 채워진다.** 쌓이게 두면 이 기물 둘을 넣은 편성이 "두 턴 스치면
   * 무엇이든 지운다"가 되어, 한 방이 판에서 가장 약하다는 대가가 사라진다.
   */
  it('두 번 맞아도 화상은 하나뿐이다', () => {
    const state = emptyState();
    const a = addUnit(state, 'dealer6', 'p1', { x: 1, y: 4 });
    const b = addUnit(state, 'dealer6', 'p1', { x: 3, y: 4 });
    const target = addUnit(state, 'tank1', 'p2', { x: 2, y: 4 });

    resolveTurn(
      state,
      plan('p1', 1, {
        [a.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } },
        [b.instanceId]: { baseAction: { kind: 'attack', direction: 'left' } },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(target.statusEffects.filter((e) => e.type === 'burn')).toHaveLength(1);
  });
});

describe('반격(tank6) — 되돌린 피해는 되돌아오지 않는다', () => {
  it('받은 피해의 절반을 공격자에게 돌려준다', () => {
    const state = emptyState();
    const attacker = addUnit(state, 'dealer3', 'p1', { x: 1, y: 4 });
    const riposter = addUnit(state, 'tank6', 'p2', { x: 2, y: 4 });
    const damage = getUnitType('dealer3').attack;

    // 충전 사격형은 공격 모드를 켜야 쏠 수 있다 — 켜는 것과 쏘는 것을 한 턴에 함께 계획한다.
    soloTurn(state, attacker.instanceId, {
      baseAction: { kind: 'attack', direction: 'right' },
      skillUse: { skillId: 'dealer3_attack_mode' },
    });

    expect(riposter.currentHp).toBe(riposter.maxHp - damage);
    expect(attacker.currentHp).toBe(attacker.maxHp - Math.floor((damage * REFLECT_PERCENT) / 100));
  });

  /**
   * 반격형끼리 마주 서는 경우. 여기가 없으면 무한 왕복이 되는데, 무한 루프가 아니라 **한 번 더
   * 도는 것**이라 테스트 없이는 그냥 "둘 다 좀 더 아팠다"로 지나간다.
   */
  it('반격형이 반격형을 때려도 되돌린 피해에는 다시 반격하지 않는다', () => {
    const state = emptyState();
    const attacker = addUnit(state, 'tank6', 'p1', { x: 1, y: 4 });
    const defender = addUnit(state, 'tank6', 'p2', { x: 2, y: 4 });
    const damage = getUnitType('tank6').attack;
    const reflected = Math.floor((damage * REFLECT_PERCENT) / 100);

    soloTurn(state, attacker.instanceId, { baseAction: { kind: 'attack', direction: 'right' } });

    expect(defender.currentHp).toBe(defender.maxHp - damage);
    // 되돌린 피해에 또 반격이 붙었다면 여기서 공격자가 더 깎여 있다.
    expect(attacker.currentHp).toBe(attacker.maxHp - reflected);
  });

  it('반격으로 죽은 뒤에는 더 되돌리지 않는다 — 죽은 기물은 이후 행동을 하지 않는다', () => {
    const state = emptyState();
    const attacker = addUnit(state, 'dealer3', 'p1', { x: 1, y: 4 });
    const riposter = addUnit(state, 'tank6', 'p2', { x: 2, y: 4 });
    riposter.currentHp = 1; // 이 한 방에 확실히 죽는다

    soloTurn(state, attacker.instanceId, {
      baseAction: { kind: 'attack', direction: 'right' },
      skillUse: { skillId: 'dealer3_attack_mode' },
    });

    expect(riposter.alive).toBe(false);
    expect(attacker.currentHp).toBe(attacker.maxHp);
  });
});

describe('표식(support6) — 이번 턴에만, 누가 때리든', () => {
  it('표식이 붙은 적은 때리는 쪽이 누구든 같은 만큼 더 아프다', () => {
    const state = emptyState();
    // 표식의 축은 both라 **정확한 직선·대각선 위**에 서야 닿는다(engine/skillRange.ts).
    const marker = addUnit(state, 'support6', 'p1', { x: 2, y: 2 });
    const shooter = addUnit(state, 'dealer5', 'p1', { x: 1, y: 4 });
    const target = addUnit(state, 'tank1', 'p2', { x: 2, y: 4 });
    const bonus = MARK.payload.bonusDamage!;

    resolveTurn(
      state,
      plan('p1', 1, {
        [marker.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'support6_mark', target: target.instanceId } },
        [shooter.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(target.currentHp).toBe(target.maxHp - getUnitType('dealer5').attack - bonus);
  });

  /**
   * **다음 턴까지 남으면 안 된다.** 이 판의 「1턴」 상태이상은 적용 턴과 다음 턴 두 번의 해결에
   * 걸쳐 살아 있고(§8, 방벽에는 그게 옳다), 표식에 그 규칙을 그대로 쓰면 쿨타임 없는 기술 하나가
   * 두 턴 내내 팀 전체의 피해를 올린다 — 실측 승률 71%가 그렇게 나왔다.
   */
  it('다음 턴에는 남아 있지 않다', () => {
    const state = emptyState();
    const marker = addUnit(state, 'support6', 'p1', { x: 2, y: 2 });
    const shooter = addUnit(state, 'dealer5', 'p1', { x: 1, y: 4 });
    const target = addUnit(state, 'tank1', 'p2', { x: 2, y: 4 });
    const power = getUnitType('dealer5').attack;

    soloTurn(state, marker.instanceId, {
      baseAction: { kind: 'none' },
      skillUse: { skillId: 'support6_mark', target: target.instanceId },
    });
    expect(target.statusEffects.some((e) => e.type === 'mark')).toBe(false);

    const hpBefore = target.currentHp;
    soloTurn(state, shooter.instanceId, { baseAction: { kind: 'attack', direction: 'right' } }, 2);
    expect(target.currentHp).toBe(hpBefore - power); // 보너스 없이 맨 피해만
  });
});

describe('갈고리(tank5) — 어디까지 끌려오는가', () => {
  const hookTurn = (state: GameState, casterId: string, targetId: string) =>
    soloTurn(state, casterId, { baseAction: { kind: 'none' }, skillUse: { skillId: 'tank5_hook', target: targetId } });

  it('시전자 쪽으로 distance만큼 끌려오되 시전자 칸을 넘지 않는다', () => {
    const board = testBoard({ width: 12, height: 12 });
    const state = emptyState(board);
    const distance = HOOK.payload.distance!;
    const caster = addUnit(state, 'tank5', 'p1', { x: 1, y: 4 });
    // 정확히 distance+1칸 떨어뜨려 둔다 — 다 끌려오면 시전자 바로 옆이다.
    const target = addUnit(state, 'tank1', 'p2', { x: 1 + distance + 1, y: 4 });

    hookTurn(state, caster.instanceId, target.instanceId);

    expect(target.position).toEqual({ x: 2, y: 4 });
    expect(caster.position).toEqual({ x: 1, y: 4 });
  });

  it('더 가까이 있으면 시전자 앞칸에서 멈춘다 — 시전자를 밀어내지 않는다', () => {
    const state = emptyState();
    const caster = addUnit(state, 'tank5', 'p1', { x: 1, y: 4 });
    const target = addUnit(state, 'tank1', 'p2', { x: 3, y: 4 });

    hookTurn(state, caster.instanceId, target.instanceId);

    expect(target.position).toEqual({ x: 2, y: 4 });
  });

  it('경로에 다른 기물이 서 있으면 그 앞에서 멈춘다', () => {
    const board = testBoard({ width: 12, height: 12 });
    const state = emptyState(board);
    const caster = addUnit(state, 'tank5', 'p1', { x: 1, y: 4 });
    addUnit(state, 'tank1', 'p1', { x: 3, y: 4 }); // 길을 막는 아군
    const target = addUnit(state, 'tank1', 'p2', { x: 6, y: 4 });

    hookTurn(state, caster.instanceId, target.instanceId);

    expect(target.position).toEqual({ x: 4, y: 4 });
  });

  it('사거리 밖의 적에게는 걸리지 않는다', () => {
    const board = testBoard({ width: 14, height: 14 });
    const state = emptyState(board);
    const caster = addUnit(state, 'tank5', 'p1', { x: 1, y: 4 });
    const target = addUnit(state, 'tank1', 'p2', { x: 1 + HOOK.payload.range! + 1, y: 4 });
    const at = target.position;

    const log = hookTurn(state, caster.instanceId, target.instanceId);

    expect(target.position).toEqual(at);
    /**
     * 사거리 밖 지정은 해결기까지 오지도 못한다 — **검증(engine/validation.ts)이 먼저 걷어낸다.**
     * 그래서 로그에 갈고리 사건 자체가 없고, 무엇보다 **쿨타임이 안 깎인다**: 사거리 밖을 찍은
     * 것만으로 3턴을 날리면 그건 규칙이 아니라 벌칙이다.
     */
    expect(log.some((e) => e.type === 'hook')).toBe(false);
    expect(caster.cooldowns['tank5_hook'] ?? 0).toBe(0);
  });
});

describe('전송(support5) — 아군을 옆으로 부른다', () => {
  it('사거리 안의 아군이 시전자 옆 빈칸으로 온다', () => {
    const board = testBoard({ width: 12, height: 12 });
    const state = emptyState(board);
    const caster = addUnit(state, 'support5', 'p1', { x: 2, y: 2 });
    const ally = addUnit(state, 'tank1', 'p1', { x: 2, y: 8 });

    soloTurn(state, caster.instanceId, {
      baseAction: { kind: 'none' },
      skillUse: { skillId: 'support5_recall', target: ally.instanceId },
    });

    expect(ally.position).not.toEqual({ x: 2, y: 8 });
    const dx = Math.abs(ally.position!.x - 2);
    const dy = Math.abs(ally.position!.y - 2);
    expect(Math.max(dx, dy)).toBe(1);
  });

  /**
   * 축이 both라 **선이 안 맞으면 안 걸린다.** 사거리만 보고 통과시키면 "사거리 6 안의 아무나"가
   * 되어 이 기물이 자리를 잡을 이유가 사라진다(engine/skillRange.ts).
   */
  it('직선·대각선 어느 쪽에도 안 걸리면 부르지 못한다', () => {
    const board = testBoard({ width: 12, height: 12 });
    const state = emptyState(board);
    const caster = addUnit(state, 'support5', 'p1', { x: 2, y: 2 });
    const ally = addUnit(state, 'tank1', 'p1', { x: 5, y: 4 }); // 직선도 대각도 아니다
    const at = ally.position;

    const log = soloTurn(state, caster.instanceId, {
      baseAction: { kind: 'none' },
      skillUse: { skillId: 'support5_recall', target: ally.instanceId },
    });

    expect(ally.position).toEqual(at);
    // 갈고리와 같다 — 검증이 먼저 걷어내므로 사건도 없고 쿨타임도 안 깎인다.
    expect(log.some((e) => e.type === 'recall')).toBe(false);
    expect(caster.cooldowns['support5_recall'] ?? 0).toBe(0);
  });
});
