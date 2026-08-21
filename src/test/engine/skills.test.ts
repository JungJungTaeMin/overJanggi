import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../engine/resolveTurn';
import { unitTypes } from '../../data/unitTypes';
import { addUnit, emptyPlan, emptyState, plan, rngFor } from './helpers';
import { RESPAWN_TURNS } from '../../data/constants';

/**
 * 공격력을 숫자로 박지 않는 이유: 여기서 재는 건 "10만큼 깎였다"가 아니라 **공격이 나갔는가**다.
 * 밸런스 조정으로 바뀌는 값을 테스트에 박아 두면 규칙이 멀쩡한데도 테스트가 깨진다.
 */
const DEALER3_ATTACK = unitTypes.find((t) => t.id === 'dealer3')!.attack;

/**
 * 사망한 유닛이 부활할 때까지 남은 턴종료 틱을 모두 돌린다. `RESPAWN_TURNS`를 조정해도
 * 테스트가 따라오도록 숫자를 박지 않는다 — 여기서 재는 건 "정확히 2턴"이 아니라
 * **"상수가 말하는 턴 수만큼 지나야 부활한다"**는 규칙이다.
 */
function advanceUntilRespawn(state: ReturnType<typeof emptyState>, fromTurn: number): void {
  for (let i = 0; i < RESPAWN_TURNS - 1; i++) {
    const turn = fromTurn + i;
    resolveTurn(state, emptyPlan('p1', turn), emptyPlan('p2', turn), rngFor('p1'));
  }
}

describe('skills and status effects', () => {
  it('a barrier granted this turn blocks an incoming attack this same turn and persists (not consumed)', () => {
    // v0.3: 방벽은 더 이상 1회 피격 시 소멸하지 않고, 지속시간(1턴) 동안 유지되며 자연 만료로만
    // 제거된다(판단 필요 항목 #3 재검토).
    const state = emptyState();
    const defender = addUnit(state, 'tank3', 'p1', { x: 2, y: 0 });
    const attacker = addUnit(state, 'dealer1', 'p2', { x: 0, y: 0 });

    resolveTurn(
      state,
      plan('p1', 1, { [defender.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'tank3_barrier' } } }),
      plan('p2', 1, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
      rngFor('p1'),
    );

    expect(defender.currentHp).toBe(defender.maxHp);
    expect(defender.statusEffects.some((e) => e.type === 'barrier')).toBe(true);
  });

  it('an AoE attack ignores barrier entirely and hits shielded and exposed targets alike', () => {
    // v0.3(8장): 범위형(AoE) 공격은 방벽을 무시하고 관통한다 — 직선 단일대상 공격만 방벽에 막힌다.
    const state = emptyState();
    const attacker = addUnit(state, 'tank3', 'p1', { x: 2, y: 2 }); // band: (3,1)(3,2)(3,3)
    const shielded = addUnit(state, 'support2', 'p2', { x: 3, y: 1 });
    const exposed = addUnit(state, 'support2', 'p2', { x: 3, y: 3 });
    shielded.statusEffects.push({ type: 'barrier', appliedOnTurn: 1, expiresAfterTurn: 2, sourceId: 'x' });

    resolveTurn(
      state,
      plan('p1', 1, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(shielded.currentHp).toBe(Math.max(0, shielded.maxHp - 5));
    expect(exposed.currentHp).toBe(Math.max(0, exposed.maxHp - 5));
  });

  /**
   * 구속 두 종류의 강도가 다르다. tank3_root는 발만 묶고(6장 "구속은 이동에만 영향"), support2_root는
   * 그 턴의 행동 자체를 지운다. 아래 두 검사는 그 **차이**를 못박는 것이라 하나만 있으면 의미가 없다 —
   * 둘을 같은 효과로 되돌리는 회귀가 나면 한쪽만 깨진다.
   */
  it('support2 구속은 행동불가다 — 묶인 기물은 공격도 기술도 못 한다', () => {
    const state = emptyState();
    const stunned = addUnit(state, 'dealer3', 'p1', { x: 4, y: 4 });
    stunned.statusEffects.push({ type: 'stun', appliedOnTurn: 1, expiresAfterTurn: 2, sourceId: 'x' });
    const victim = addUnit(state, 'support2', 'p2', { x: 4, y: 2 }); // dealer3 사거리(직선·대각 4) 안

    resolveTurn(
      state,
      plan('p1', 1, {
        // 공격 모드를 켜고 쏘는, 평소라면 완전히 합법인 계획이다.
        [stunned.instanceId]: { baseAction: { kind: 'attack', direction: 'up' }, skillUse: { skillId: 'dealer3_attack_mode' } },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(victim.currentHp).toBe(victim.maxHp); // 공격이 안 나갔고
    expect(stunned.statusEffects.some((e) => e.type === 'attackMode')).toBe(false); // 기술도 안 걸렸다
  });

  it('tank3 구속은 발만 묶는다 — 묶인 기물도 공격은 그대로 한다', () => {
    const state = emptyState();
    const rooted = addUnit(state, 'dealer3', 'p1', { x: 4, y: 4 });
    rooted.statusEffects.push({ type: 'root', appliedOnTurn: 1, expiresAfterTurn: 2, sourceId: 'x' });
    const victim = addUnit(state, 'support2', 'p2', { x: 4, y: 2 });

    resolveTurn(
      state,
      plan('p1', 1, {
        [rooted.instanceId]: { baseAction: { kind: 'attack', direction: 'up' }, skillUse: { skillId: 'dealer3_attack_mode' } },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(victim.currentHp).toBe(Math.max(0, victim.maxHp - DEALER3_ATTACK));
  });

  it('allows dealer3 to toggle attack mode on and attack in the same turn', () => {
    const state = emptyState();
    const dealer3 = addUnit(state, 'dealer3', 'p1', { x: 0, y: 0 });
    const enemy = addUnit(state, 'support2', 'p2', { x: 2, y: 0 });

    resolveTurn(
      state,
      plan('p1', 1, {
        [dealer3.instanceId]: { baseAction: { kind: 'attack', direction: 'right' }, skillUse: { skillId: 'dealer3_attack_mode' } },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(enemy.currentHp).toBe(Math.max(0, enemy.maxHp - DEALER3_ATTACK));
    expect(dealer3.statusEffects.some((e) => e.type === 'attackMode')).toBe(true);
  });

  it('blocks dealer3 from moving while attack mode is active', () => {
    const state = emptyState();
    const dealer3 = addUnit(state, 'dealer3', 'p1', { x: 4, y: 4 });
    dealer3.statusEffects.push({ type: 'attackMode', appliedOnTurn: 1, expiresAfterTurn: 2, sourceId: dealer3.instanceId });

    resolveTurn(
      state,
      plan('p1', 1, { [dealer3.instanceId]: { baseAction: { kind: 'move', direction: 'right', distance: 1 } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(dealer3.position).toEqual({ x: 4, y: 4 });
  });

  it('reverts dealer2 to its snapshot position and HP once charges hit zero', () => {
    const state = emptyState();
    const dealer2 = addUnit(state, 'dealer2', 'p1', { x: 0, y: 0 });

    resolveTurn(
      state,
      plan('p1', 1, { [dealer2.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'dealer2_rewind_move' } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );
    expect(dealer2.charges['dealer2_rewind_move']).toBe(2);
    expect(dealer2.rewindSnapshot).toEqual({ position: { x: 0, y: 0 }, hp: dealer2.maxHp });

    resolveTurn(
      state,
      plan('p1', 2, { [dealer2.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'dealer2_rewind_move' } } }),
      emptyPlan('p2', 2),
      rngFor('p1'),
    );
    dealer2.currentHp = 1; // 스냅샷 이후 입은 피해를 시뮬레이션

    resolveTurn(
      state,
      plan('p1', 3, { [dealer2.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'dealer2_rewind_move' } } }),
      emptyPlan('p2', 3),
      rngFor('p1'),
    );

    expect(dealer2.currentHp).toBe(dealer2.maxHp);
    expect(dealer2.charges['dealer2_rewind_move']).toBe(3);
    expect(dealer2.rewindSnapshot).toBeNull();
  });

  it('grants a temporary max-HP increase together with equal shield HP, then reverts both together on expiry', () => {
    // §6/§7.1/§8: 체력 Lv 증가는 최대 체력 증가와 동일한 양의 보호막을 "함께" 부여하고,
    // 지속시간이 끝나면 늘어난 최대 체력과 남은 보호막을 함께 제거한다.
    const state = emptyState();
    const unit = addUnit(state, 'tank1', 'p1', { x: 0, y: 0 }); // hpLv8 → maxHp 40, hpBonus1 → +5

    resolveTurn(
      state,
      plan('p1', 1, { [unit.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'tank1_fortify' } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );
    expect(unit.maxHp).toBe(45);
    expect(unit.currentHp).toBe(45);
    expect(unit.shieldHp).toBe(5);

    resolveTurn(state, emptyPlan('p1', 2), emptyPlan('p2', 2), rngFor('p1'));

    expect(unit.maxHp).toBe(40);
    expect(unit.currentHp).toBe(40);
    expect(unit.shieldHp).toBe(0);
  });

  it('keeps decrementing a dead unit\'s skill-2 cooldown every end-of-turn tick, and preserves it through respawn', () => {
    // §8: "사망한 동안에도 기술 2의 쿨타임은 정상적으로 감소하지만, 부활 시 초기화하지 않는다."
    const state = emptyState();
    const tank3 = addUnit(state, 'tank3', 'p1', { x: 0, y: 0 }); // skill2 = tank3_root, cooldown 5
    // 구속 사거리(직선·대각선 3칸) 안에 둔다. 대상 없이 기술만 계획하면 이제 계획 자체가
    // 무효화되어(validation) 쿨타임이 아예 걸리지 않는다 — 이 테스트의 주제는 사망 중 쿨타임
    // 감소이므로, 기술이 실제로 나가도록 유효한 대상을 준다.
    const killer = addUnit(state, 'dealer1', 'p2', { x: 3, y: 0 }); // attack 8, range 6
    tank3.currentHp = 1;

    resolveTurn(
      state,
      plan('p1', 1, {
        [tank3.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'tank3_root', target: killer.instanceId } },
      }),
      plan('p2', 1, { [killer.instanceId]: { baseAction: { kind: 'attack', direction: 'left' } } }),
      rngFor('p1'),
    );
    expect(tank3.alive).toBe(false);
    expect(tank3.cooldowns['tank3_root']).toBe(4); // preAttack에서 5로 설정된 직후, 같은 턴 턴종료에서 사망 중에도 1 감소

    advanceUntilRespawn(state, 2);

    expect(tank3.alive).toBe(true); // RESPAWN_TURNS번째 턴종료에 부활
    // 감소는 사망 중에도 계속됐고 부활이 이를 되돌리지 않는다(§8). 쿨타임이 0에 닿으면 키 자체가
    // 지워지므로 `?? 0`으로 받는다 — RESPAWN_TURNS가 5 이상이면 부활 전에 자연 만료된다.
    expect(tank3.cooldowns['tank3_root'] ?? 0).toBe(Math.max(0, 5 - RESPAWN_TURNS));
    // 위 값은 RESPAWN_TURNS가 크면 0이라 "초기화됨"과 구별되지 않는다. 초기화 여부 자체는
    // 이 어서션이 가른다 — 부활이 쿨타임을 되돌렸다면 5로 돌아가 있을 것이다.
    expect(tank3.cooldowns['tank3_root'] ?? 0).not.toBe(5);
  });

  it('respawns a dead unit exactly RESPAWN_TURNS end-of-turn ticks after death', () => {
    const state = emptyState();
    const victim = addUnit(state, 'support2', 'p1', { x: 4, y: 0 }); // maxHp 15(hpLv3×5) — 8뎀 한방으론 안 죽으므로 낮춰서 사망을 강제한다
    victim.currentHp = 5;
    const attacker = addUnit(state, 'dealer1', 'p2', { x: 6, y: 0 });

    resolveTurn(
      state,
      emptyPlan('p1', 1),
      plan('p2', 1, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'left' } } }),
      rngFor('p1'),
    );
    expect(victim.alive).toBe(false);
    expect(victim.respawnTurnsRemaining).toBe(RESPAWN_TURNS - 1);

    advanceUntilRespawn(state, 2);

    expect(victim.alive).toBe(true);
    expect(victim.currentHp).toBe(victim.maxHp);
    expect(state.board.startZones.p1).toContainEqual(victim.position);
  });

  it('resolves two units respawning on the same tick without letting them collide on the same cell', () => {
    // §3.5: 같은 턴종료 틱에 부활하는 두 유닛이 동일한 시작지점 후보 칸을 동시에 제안하면 무작위로
    // 한 명만 확정되고 나머지는 다음 후보로 넘어간다 — 두 유닛 모두 결국 서로 다른 칸에 배정돼야
    // 하고, 절대 같은 칸을 공유해서는 안 된다.
    const state = emptyState(); // p1 startZones: (0,0), (1,0)
    const v1 = addUnit(state, 'support2', 'p1', { x: 0, y: 5 });
    const v2 = addUnit(state, 'support2', 'p1', { x: 1, y: 5 });
    v1.currentHp = 1;
    v2.currentHp = 1;
    const a1 = addUnit(state, 'dealer1', 'p2', { x: 0, y: 3 });
    const a2 = addUnit(state, 'dealer1', 'p2', { x: 1, y: 3 });

    resolveTurn(
      state,
      emptyPlan('p1', 1),
      plan('p2', 1, {
        [a1.instanceId]: { baseAction: { kind: 'attack', direction: 'down' } },
        [a2.instanceId]: { baseAction: { kind: 'attack', direction: 'down' } },
      }),
      rngFor('p1'),
    );
    expect(v1.alive).toBe(false);
    expect(v2.alive).toBe(false);

    advanceUntilRespawn(state, 2);

    expect(v1.alive).toBe(true);
    expect(v2.alive).toBe(true);
    expect(v1.position).not.toEqual(v2.position);
    expect(state.board.startZones.p1).toContainEqual(v1.position);
    expect(state.board.startZones.p1).toContainEqual(v2.position);
  });
});
