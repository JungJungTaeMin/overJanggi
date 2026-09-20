import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../engine/resolveTurn';
import { getUnitType } from '../../data/unitTypes';
import { addStatusEffect } from '../../engine/statusEffects';
import { addUnit, emptyPlan, emptyState, plan, rngFor, testBoard } from './helpers';

const SHOVE = getUnitType('tank4').skills.find((s) => s.id === 'tank4_shove')!;
const DISTANCE = SHOVE.payload.distance!;
const WALL_DAMAGE = SHOVE.payload.wallDamage!;
const RANGE = SHOVE.payload.range!;

/** 밀치기 한 번만 계획하는 턴. 밀치기는 2단계(공격 전)라 이동·공격 없이도 단독으로 성립한다. */
function shoveTurn(state: ReturnType<typeof emptyState>, casterId: string, targetId: string) {
  return resolveTurn(
    state,
    plan('p1', 1, { [casterId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'tank4_shove', target: targetId } } }),
    emptyPlan('p2', 1),
    rngFor('p1'),
  );
}

/**
 * **밀치기 — 강제 이동.**
 *
 * 이 기술의 값어치는 피해가 아니라 **적이 서 있는 칸**이다. 그래서 여기서 잠그는 것도 피해량이
 * 아니라 기하다: 어느 방향으로, 몇 칸, 무엇에 막혀 멈추는가. 방향을 사용자가 고르지 않고
 * "시전자 반대쪽"으로 유도하기 때문에, 방향 계산이 틀리면 **적을 내 쪽으로 당기는** 정반대
 * 기술이 되면서도 예외는 하나도 안 난다.
 */
describe('밀치기 — 어디로 얼마나 밀리는가', () => {
  it('시전자 반대 방향으로 정확히 payload.distance만큼 민다', () => {
    const state = emptyState();
    const caster = addUnit(state, 'tank4', 'p1', { x: 1, y: 4 });
    const target = addUnit(state, 'tank1', 'p2', { x: 2, y: 4 });

    shoveTurn(state, caster.instanceId, target.instanceId);

    // 시전자가 왼쪽에 있으므로 오른쪽으로 밀린다 — 당겨지지 않는다.
    expect(target.position).toEqual({ x: 2 + DISTANCE, y: 4 });
    expect(caster.position).toEqual({ x: 1, y: 4 });
  });

  it('대각선 위의 적도 민다 — 축이 both가 아니면 여기서 걸린다', () => {
    const state = emptyState();
    const caster = addUnit(state, 'tank4', 'p1', { x: 2, y: 2 });
    const target = addUnit(state, 'tank1', 'p2', { x: 3, y: 3 });

    shoveTurn(state, caster.instanceId, target.instanceId);

    expect(target.position).toEqual({ x: 3 + DISTANCE, y: 3 + DISTANCE });
  });

  it('장애물에 막히면 그 앞에서 멈추고 충돌 피해를 받는다 — 벽을 통과하지 않는다', () => {
    // 밀리는 경로 두 번째 칸에 벽을 둔다: 한 칸만 밀리고 멈춰야 한다.
    const board = testBoard({ obstacles: [{ x: 4, y: 4 }] });
    const state = emptyState(board);
    const caster = addUnit(state, 'tank4', 'p1', { x: 1, y: 4 });
    const target = addUnit(state, 'tank1', 'p2', { x: 2, y: 4 });
    const hpBefore = target.currentHp;

    const log = shoveTurn(state, caster.instanceId, target.instanceId);

    expect(target.position).toEqual({ x: 3, y: 4 });
    expect(target.currentHp).toBe(hpBefore - WALL_DAMAGE);
    expect(log.some((e) => e.type === 'shoveImpact')).toBe(true);
  });

  it('등 뒤가 판 끝이면 한 칸도 안 밀리지만 충돌 피해는 들어간다', () => {
    const state = emptyState();
    const caster = addUnit(state, 'tank4', 'p1', { x: 6, y: 4 });
    const target = addUnit(state, 'tank1', 'p2', { x: 8, y: 4 }); // 보드 폭 9 — 오른쪽 끝
    const hpBefore = target.currentHp;

    shoveTurn(state, caster.instanceId, target.instanceId);

    // 벽에 붙은 적을 미는 것이 완전한 헛수고가 되면 이 기물은 구석에서 아무것도 못 한다.
    expect(target.position).toEqual({ x: 8, y: 4 });
    expect(target.currentHp).toBe(hpBefore - WALL_DAMAGE);
  });

  it('다른 기물도 벽 노릇을 한다 — 부딪힌 쪽은 밀리지도 다치지도 않는다', () => {
    const state = emptyState();
    const caster = addUnit(state, 'tank4', 'p1', { x: 1, y: 4 });
    const target = addUnit(state, 'tank1', 'p2', { x: 2, y: 4 });
    const wallUnit = addUnit(state, 'tank1', 'p2', { x: 4, y: 4 });
    const bystanderHp = wallUnit.currentHp;

    shoveTurn(state, caster.instanceId, target.instanceId);

    expect(target.position).toEqual({ x: 3, y: 4 });
    // 연쇄 밀림이 없다는 것 — 있으면 밀치기 한 번이 판 전체를 흔든다.
    expect(wallUnit.position).toEqual({ x: 4, y: 4 });
    expect(wallUnit.currentHp).toBe(bystanderHp);
  });

  it('끝까지 밀린 경우에는 충돌 피해가 없다', () => {
    const state = emptyState();
    const caster = addUnit(state, 'tank4', 'p1', { x: 1, y: 4 });
    const target = addUnit(state, 'tank1', 'p2', { x: 2, y: 4 });
    const hpBefore = target.currentHp;

    const log = shoveTurn(state, caster.instanceId, target.instanceId);

    expect(target.currentHp).toBe(hpBefore);
    expect(log.some((e) => e.type === 'shoveImpact')).toBe(false);
  });

  /**
   * 사거리는 **두 번** 검사된다. 계획 시점(validation.ts)에서 한 번 — 애초에 사거리 밖 적은
   * 지정조차 못 하므로 이 경로는 여기까지 오지 않는다. 그리고 해결 시점(이동 직후)에 한 번 더 —
   * 계획할 때 닿았어도 **대상이 1단계에서 달아나면** 빗나가야 한다. 두 번째 검사가 없으면
   * 밀치기는 도망치는 적을 순간이동으로 따라가 미는 기술이 된다.
   */
  it('계획 뒤에 대상이 달아나면 빗나간다 — 쿨타임은 그래도 소모된다', () => {
    const state = emptyState();
    const caster = addUnit(state, 'tank4', 'p1', { x: 1, y: 4 });
    // 이동 4짜리를 골라 사거리(2) 밖으로 확실히 빠져나가게 한다.
    const runner = addUnit(state, 'tank2', 'p2', { x: 1 + RANGE, y: 4 });

    const log = resolveTurn(
      state,
      plan('p1', 1, {
        [caster.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'tank4_shove', target: runner.instanceId } },
      }),
      plan('p2', 1, { [runner.instanceId]: { baseAction: { kind: 'move', direction: 'right', distance: 4 } } }),
      rngFor('p1'),
    );

    // 스스로 달려간 자리 그대로 — 밀린 흔적이 없어야 한다.
    expect(runner.position).toEqual({ x: 1 + RANGE + 4, y: 4 });
    expect(log.find((e) => e.type === 'shove')?.detail?.landed).toBe(false);
    // 기술을 쓰기로 한 것 자체가 이번 턴의 선택이었다 — 빗나가도 공짜가 아니다.
    expect(caster.cooldowns['tank4_shove']).toBeGreaterThan(0);
  });

  it('아군은 밀 수 없다 — 대상이 적이 아니면 아무 일도 일어나지 않는다', () => {
    const state = emptyState();
    const caster = addUnit(state, 'tank4', 'p1', { x: 1, y: 4 });
    const ally = addUnit(state, 'tank1', 'p1', { x: 2, y: 4 });

    shoveTurn(state, caster.instanceId, ally.instanceId);

    expect(ally.position).toEqual({ x: 2, y: 4 });
  });

  it('구속·기절에 걸린 적도 밀린다 — 그 상태이상이 막는 건 제 발로 걷는 것이다', () => {
    const state = emptyState();
    const caster = addUnit(state, 'tank4', 'p1', { x: 1, y: 4 });
    const target = addUnit(state, 'tank1', 'p2', { x: 2, y: 4 });
    addStatusEffect(target, 'root', state.turnNumber, caster.instanceId);

    shoveTurn(state, caster.instanceId, target.instanceId);

    // 여기서 면역을 주면 제어 기물끼리 서로를 완전히 무력화한다.
    expect(target.position).toEqual({ x: 2 + DISTANCE, y: 4 });
  });
});

/**
 * 밀치기가 실제로 사는 곳. 위 기하 테스트가 다 통과해도 **이 두 가지가 안 되면** 이 기물은
 * "가끔 5 피해를 주는 약한 탱커"일 뿐이다.
 */
describe('밀치기 — 판에 미치는 효과', () => {
  it('점령지 위의 적을 밖으로 밀어내면 그 턴 점수가 뒤집힌다', () => {
    // 점령지를 한 칸으로 두고 그 위에 p2를 세운다 — 밀지 않으면 p2가 점수를 낸다.
    const board = testBoard({ captureZone: [{ x: 4, y: 4 }] });
    const state = emptyState(board);
    const caster = addUnit(state, 'tank4', 'p1', { x: 2, y: 4 });
    const holder = addUnit(state, 'tank1', 'p2', { x: 4, y: 4 });

    shoveTurn(state, caster.instanceId, holder.instanceId);

    expect(holder.position).toEqual({ x: 4 + DISTANCE, y: 4 });
    // 점령 점수는 5단계(턴 종료)에 계산되므로, 2단계에서 빼내면 그 턴 득점이 통째로 사라진다.
    expect(state.score.p2).toBe(0);
  });

  it('밀어서 죽일 수 있다 — 체력이 충돌 피해보다 적으면 사망 처리된다', () => {
    const board = testBoard({ obstacles: [{ x: 3, y: 4 }] });
    const state = emptyState(board);
    const caster = addUnit(state, 'tank4', 'p1', { x: 1, y: 4 });
    const frail = addUnit(state, 'dealer2', 'p2', { x: 2, y: 4 });
    frail.currentHp = 1;

    const log = shoveTurn(state, caster.instanceId, frail.instanceId);

    expect(frail.alive).toBe(false);
    expect(log.some((e) => e.type === 'death' && e.actorId === frail.instanceId)).toBe(true);
  });
});

/**
 * 밀치기는 이 게임에서 **처음으로 처리 순서가 결과를 바꾸는 공격 전 효과**다. 상태이상은 서로
 * 간섭하지 않아 `[planP1, planP2]` 고정 순서로도 문제가 없었지만, 서로를 미는 두 기물은 먼저
 * 처리된 쪽만 성공한다 — 순서를 안 넘기면 P1이 항상 이겨서 "먼저 입력한 쪽이 우선권을 갖지
 * 않는다"는 이 게임의 전제가 깨진다. 이건 예외를 안 던지고 승률로만 드러나는 종류의 버그다.
 */
describe('밀치기 — 맞밀기의 우선권은 소유자가 아니라 우선순위가 정한다', () => {
  function mutualShove(firstMover: 'p1' | 'p2') {
    const state = emptyState();
    // 같은 기물(tank4)끼리라 이동Lv·공격 수치·역할이 모두 같다 → 무작위 타이브레이크로 넘어간다.
    const a = addUnit(state, 'tank4', 'p1', { x: 3, y: 4 });
    const b = addUnit(state, 'tank4', 'p2', { x: 4, y: 4 });
    resolveTurn(
      state,
      plan('p1', 1, { [a.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'tank4_shove', target: b.instanceId } } }),
      plan('p2', 1, { [b.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'tank4_shove', target: a.instanceId } } }),
      rngFor(firstMover),
    );
    return { a, b };
  }

  it('우선권이 p1이면 p1이 밀어내고, p2면 반대가 된다', () => {
    const first = mutualShove('p1');
    // 먼저 처리된 쪽이 상대를 사거리 밖으로 밀어내 상대의 밀치기는 빗나간다.
    expect(first.a.position).toEqual({ x: 3, y: 4 });
    expect(first.b.position).toEqual({ x: 4 + DISTANCE, y: 4 });

    const second = mutualShove('p2');
    expect(second.b.position).toEqual({ x: 4, y: 4 });
    expect(second.a.position).toEqual({ x: 3 - DISTANCE, y: 4 });
  });
});
