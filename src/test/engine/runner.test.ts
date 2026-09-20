import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../engine/resolveTurn';
import { getUnitType } from '../../data/unitTypes';
import { captureCounts, captureWeightOf } from '../../engine/capture';
import { paceLevel, plannedMoveSpeed } from '../../engine/unitStats';
import { sumMagnitude } from '../../engine/statusEffects';
import { CAPTURE_MARGIN } from '../../data/constants';
import { addUnit, emptyState, plan, rngFor, testBoard } from './helpers';

const RUNNER = getUnitType('support4');
const WEIGHT = RUNNER.passive!.payload!.captureWeight!;
const MIN_MOVE = RUNNER.passive!.payload!.minMove!;
const MAX_MOVE = RUNNER.passive!.payload!.maxMove!;
const VEIL_CD = RUNNER.skills.find((s) => s.id === 'support4_veil')!.gate;
const PACE_CD = RUNNER.skills.find((s) => s.id === 'support4_pace')!.gate;

/** p1만 행동하는 한 턴. 러너 검증은 상대 계획이 개입하지 않을 때가 대부분이다. */
function turn(state: ReturnType<typeof emptyState>, actions: Parameters<typeof plan>[2], p2Actions = {}) {
  return resolveTurn(state, plan('p1', state.turnNumber, actions), plan('p2', state.turnNumber, p2Actions), rngFor('p1'));
}

const move = (direction: 'up' | 'down' | 'left' | 'right', distance: number) =>
  ({ baseAction: { kind: 'move' as const, direction, distance } });

/**
 * **패시브1 — 혼자 여러 명 몫으로 점령한다.** 점수를 내는 함수와 AI가 같은 무게를 봐야 한다.
 * 여기서 잠그는 것은 "러너는 N으로 센다"는 숫자가 아니라 **인원 차 규칙(CAPTURE_MARGIN)과
 * 맞물린 결과**다 — 무게가 바뀌면 "적 몇 명까지 혼자 밀어낼 수 있는가"가 통째로 달라지므로,
 * 아래 두 경계(밀어내는 쪽 / 못 밀어내는 쪽)를 무게에서 **유도해서** 잰다.
 *
 * 무게는 실제로 2에서 3으로 올렸다(밸런스: 러너 승점률 38.4% → 41.7%). 그때 이 describe의
 * 제목과 본문이 "2명"이라고 적힌 채 남아 있었고, 테스트는 붉어져서 그걸 알려 줬다.
 */
describe('러너 패시브1 — 혼자 여러 명 몫으로 점령한다', () => {
  it('점령 인원을 패시브에 적힌 무게로 센다', () => {
    const state = emptyState();
    const runner = addUnit(state, 'support4', 'p1', { x: 4, y: 4 });
    expect(captureWeightOf(runner)).toBe(WEIGHT);
    expect(captureCounts(state)).toEqual({ p1: WEIGHT, p2: 0 });
  });

  it('혼자 점령지에 서면 점수가 난다 — 무저항 예외를 그대로 탄다', () => {
    const state = emptyState();
    addUnit(state, 'support4', 'p1', { x: 4, y: 4 });

    turn(state, {});

    expect(state.score.p1).toBe(1);
  });

  /**
   * 무게가 클수록 혼자 밀어낼 수 있는 적이 늘어난다 — 그 경계가 정확히 `무게 − CAPTURE_MARGIN`
   * 명이다(captureWinner: 앞선 쪽이 CAPTURE_MARGIN 이상 앞서야 점수). 이 두 테스트가 경계의
   * 양쪽이라, 무게를 올리거나 CAPTURE_MARGIN을 건드리면 반드시 한쪽이 먼저 붉어진다.
   */
  const soloBeats = WEIGHT - CAPTURE_MARGIN;
  const zoneFor = (n: number) => testBoard({ captureZone: Array.from({ length: n + 1 }, (_, i) => ({ x: 4, y: 4 + i })) });
  const fillFoes = (state: ReturnType<typeof emptyState>, n: number) => {
    for (let i = 0; i < n; i++) addUnit(state, 'tank1', 'p2', { x: 4, y: 5 + i });
  };

  it(`적 ${soloBeats}명까지는 혼자 밀어내고 점수를 낸다`, () => {
    const state = emptyState(zoneFor(soloBeats));
    addUnit(state, 'support4', 'p1', { x: 4, y: 4 });
    fillFoes(state, soloBeats);

    turn(state, {});

    expect(state.score.p1).toBe(1);
  });

  it(`적이 한 명만 더 늘어 ${soloBeats + 1}명이 되면 경합이다 — 무게가 인원 차 규칙을 무너뜨리지 않는다`, () => {
    const state = emptyState(zoneFor(soloBeats + 1));
    addUnit(state, 'support4', 'p1', { x: 4, y: 4 });
    fillFoes(state, soloBeats + 1);

    turn(state, {});

    expect(state.score.p1).toBe(0);
    expect(state.score.p2).toBe(0);
  });
});

/**
 * **패시브2 — 가속.** 이 패시브는 판 위에 아무 흔적도 남기지 않는다(체력도 위치도 그대로다).
 * 그래서 틀려도 예외가 나지 않고, 그저 "이동 칸수가 이상한 기물"이 된다. 잠글 것은 주기 전체다:
 * 최소에서 시작해 걸을 때마다 오르고, 최대에서 한 번 더 걸으면 최소로 돌아간다.
 */
describe('러너 패시브2 — 걸을수록 빨라지는 이동 Lv', () => {
  it('최소 Lv에서 시작한다', () => {
    const state = emptyState();
    const runner = addUnit(state, 'support4', 'p1', { x: 4, y: 0 });
    expect(paceLevel(runner)).toBe(MIN_MOVE);
    expect(plannedMoveSpeed(runner)).toBe(MIN_MOVE);
  });

  it('걸은 턴마다 1씩 올라 최대에 닿고, 최대에서 또 걸으면 최소로 돌아간다', () => {
    const state = emptyState();
    const runner = addUnit(state, 'support4', 'p1', { x: 0, y: 0 });
    const seen: number[] = [paceLevel(runner)];

    // 최소 → 최대 → 초기화까지 한 바퀴. 이동 Lv이 오르므로 칸수도 그때그때 다르다.
    // 바퀴의 길이는 **Lv 폭이 정한다**(MAX_MOVE 자체가 아니다) — 최소 Lv을 올리면 바퀴가 짧아진다.
    const rampSteps = MAX_MOVE - MIN_MOVE + 1;
    for (let i = 0; i < rampSteps; i++) {
      turn(state, { [runner.instanceId]: move('right', paceLevel(runner)) });
      seen.push(paceLevel(runner));
    }

    // 최소 → … → 최대 → 최소. 최대 Lv은 한 턴만 쓰고 초기화된다.
    const ramp = Array.from({ length: rampSteps }, (_, i) => MIN_MOVE + i);
    expect(seen).toEqual([...ramp, MIN_MOVE]);
  });

  it('제자리에 선 턴에는 오르지 않는다 — 계획이 아니라 실제로 걸은 것만 센다', () => {
    const state = emptyState();
    const runner = addUnit(state, 'support4', 'p1', { x: 4, y: 4 });

    turn(state, { [runner.instanceId]: { baseAction: { kind: 'none' } } });

    expect(paceLevel(runner)).toBe(MIN_MOVE);
  });

  it('벽에 막혀 한 칸도 못 갔으면 오르지 않는다', () => {
    const state = emptyState(testBoard({ obstacles: [{ x: 5, y: 4 }] }));
    const runner = addUnit(state, 'support4', 'p1', { x: 4, y: 4 });

    turn(state, { [runner.instanceId]: move('right', 1) });

    expect(runner.position).toEqual({ x: 4, y: 4 });
    expect(paceLevel(runner)).toBe(MIN_MOVE);
  });

  it('오른 Lv만큼 실제로 더 걷는다 — 눈금만 오르고 칸수가 그대로면 패시브가 없는 것과 같다', () => {
    const state = emptyState();
    const runner = addUnit(state, 'support4', 'p1', { x: 0, y: 4 });

    turn(state, { [runner.instanceId]: move('right', MIN_MOVE) });
    expect(runner.position).toEqual({ x: MIN_MOVE, y: 4 });

    // 이제 Lv이 하나 올랐으니 그만큼 더 간다.
    turn(state, { [runner.instanceId]: move('right', MIN_MOVE + 1) });
    expect(runner.position).toEqual({ x: MIN_MOVE * 2 + 1, y: 4 });
  });
});

/**
 * **액티브1 — 차단막.** 이 기술의 핵심은 "무엇을 막느냐"가 아니라 **막지 않는 것이 없다**는 점이다.
 * 직선 공격도 범위 공격도, 적의 회복도 아군의 회복도 전부 지운다. 예외를 하나라도 만들면 러너는
 * 비용 없는 순수 이득이 되므로, 여기서 잠그는 것은 그 무차별성이다.
 */
describe('러너 액티브1 — 차단막', () => {
  const veil = (id: string) => ({ [id]: { baseAction: { kind: 'none' as const }, skillUse: { skillId: 'support4_veil' } } });

  it('덮인 칸을 지나는 직선 공격을 지운다', () => {
    const state = emptyState();
    const runner = addUnit(state, 'support4', 'p1', { x: 4, y: 4 });
    const ally = addUnit(state, 'tank1', 'p1', { x: 4, y: 3 });
    const shooter = addUnit(state, 'dealer1', 'p2', { x: 4, y: 6 });
    const hpBefore = ally.currentHp;

    // 사선 (4,6) → (4,3)은 러너가 덮은 (4,5)를 지난다.
    turn(state, veil(runner.instanceId), {
      [shooter.instanceId]: { baseAction: { kind: 'attack', direction: 'up' } },
    });

    expect(ally.currentHp).toBe(hpBefore);
  });

  it('러너 자신이 선 칸은 덮이지 않는다 — 8칸이지 9칸이 아니다', () => {
    const state = emptyState();
    const runner = addUnit(state, 'support4', 'p1', { x: 4, y: 4 });
    const shooter = addUnit(state, 'dealer1', 'p2', { x: 8, y: 4 });
    const hpBefore = runner.currentHp;

    // (8,4)에서 왼쪽으로 쏘면 (7,4)…(5,4)는 덮이지 않고 (5,4)에서 처음 덮인다.
    // 사거리가 러너까지 닿는지와 무관하게, 자기 칸이 덮인다면 이 공격은 지워져야 한다.
    turn(state, veil(runner.instanceId), {
      [shooter.instanceId]: { baseAction: { kind: 'attack', direction: 'left' } },
    });

    // (5,4)가 덮여 있으므로 탄이 러너에 닿기 전에 지워진다 — 러너는 자기 주변 덕에 살지만
    // 그건 자기 칸이 덮였기 때문이 아니다. 아래 인접 사격이 그 차이를 가른다.
    expect(runner.currentHp).toBe(hpBefore);

    // 바로 옆 칸(덮인 칸이 사이에 없다)에서 쏘면 그대로 맞는다.
    const point = addUnit(state, 'dealer1', 'p2', { x: 5, y: 4 });
    turn(state, veil(runner.instanceId), {
      [point.instanceId]: { baseAction: { kind: 'attack', direction: 'left' } },
    });
    expect(runner.currentHp).toBeLessThan(hpBefore);
  });

  it('범위 공격도 덮인 칸에서는 지워진다 — 방벽과 달리 관통하지 않는다', () => {
    const state = emptyState();
    const runner = addUnit(state, 'support4', 'p1', { x: 4, y: 4 });
    const ally = addUnit(state, 'tank1', 'p1', { x: 4, y: 5 });
    const bomber = addUnit(state, 'tank3', 'p2', { x: 4, y: 6 });
    const hpBefore = ally.currentHp;

    turn(state, veil(runner.instanceId), {
      [bomber.instanceId]: { baseAction: { kind: 'attack', direction: 'up' } },
    });

    expect(ally.currentHp).toBe(hpBefore);
  });

  it('**아군의 회복까지** 지운다 — 우리 편 예외가 있으면 비용 없는 기술이 된다', () => {
    const state = emptyState();
    const runner = addUnit(state, 'support4', 'p1', { x: 4, y: 4 });
    const healer = addUnit(state, 'support2', 'p1', { x: 4, y: 6 });
    const wounded = addUnit(state, 'tank1', 'p1', { x: 4, y: 3 });
    wounded.currentHp = 1;

    turn(state, {
      ...veil(runner.instanceId),
      [healer.instanceId]: {
        baseAction: { kind: 'none' },
        skillUse: { skillId: 'support2_heal', target: wounded.instanceId },
      },
    });

    expect(wounded.currentHp).toBe(1);
  });

  it('덮이지 않은 사선의 회복은 그대로 들어간다 — 무엇이든 막는 기술이 아니다', () => {
    const state = emptyState();
    addUnit(state, 'support4', 'p1', { x: 0, y: 0 });
    const healer = addUnit(state, 'support2', 'p1', { x: 4, y: 6 });
    const wounded = addUnit(state, 'tank1', 'p1', { x: 4, y: 3 });
    wounded.currentHp = 1;

    turn(state, {
      [healer.instanceId]: {
        baseAction: { kind: 'none' },
        skillUse: { skillId: 'support2_heal', target: wounded.instanceId },
      },
    });

    expect(wounded.currentHp).toBeGreaterThan(1);
  });

  it('쿨타임이 데이터의 값만큼 걸린다', () => {
    const state = emptyState();
    const runner = addUnit(state, 'support4', 'p1', { x: 4, y: 4 });

    turn(state, veil(runner.instanceId));

    // 턴 끝에서 1이 깎인 뒤의 값이다.
    expect(VEIL_CD.type).toBe('cooldown');
    expect(runner.cooldowns['support4_veil']).toBe((VEIL_CD as { turns: number }).turns - 1);
  });
});

/**
 * **액티브2 — 발맞추기.** "자신의 이동 Lv만큼"이 이 기술의 전부다. 상수로 굳어 버리면 가속
 * 패시브와 이 기술이 서로 맞물리는 설계가 통째로 사라지므로, 잠글 것은 **크기가 Lv을 따라간다**는 것이다.
 */
describe('러너 액티브2 — 발맞추기', () => {
  const pace = (casterId: string, targetId: string) => ({
    [casterId]: { baseAction: { kind: 'none' as const }, skillUse: { skillId: 'support4_pace', target: targetId } },
  });

  it('직선으로 인접한 아군에게 지금 이동 Lv만큼 이동력을 준다', () => {
    const state = emptyState();
    const runner = addUnit(state, 'support4', 'p1', { x: 4, y: 4 });
    const ally = addUnit(state, 'tank1', 'p1', { x: 5, y: 4 });

    const turnNumber = state.turnNumber;
    turn(state, pace(runner.instanceId, ally.instanceId));

    expect(sumMagnitude(ally, 'moveBonus', turnNumber)).toBe(MIN_MOVE);
  });

  it('가속한 러너는 더 큰 이동력을 나눠 준다 — 크기가 상수가 아니다', () => {
    const state = emptyState();
    const runner = addUnit(state, 'support4', 'p1', { x: 0, y: 4 });

    // 최대 Lv까지 걸어 올린다. 몇 턴이 걸리고 몇 칸을 가는지는 Lv 폭이 정하므로 손으로 적지 않는다.
    for (let lv = MIN_MOVE; lv < MAX_MOVE; lv++) turn(state, { [runner.instanceId]: move('right', lv) });
    expect(paceLevel(runner)).toBe(MAX_MOVE);

    // 가속이 끝난 **그 자리 옆**에 아군을 세운다 — 이 테스트가 재는 건 걸은 거리가 아니라
    // "나눠 주는 이동력이 지금 Lv을 따라간다"는 것뿐이다.
    const ally = addUnit(state, 'tank1', 'p1', { x: runner.position!.x, y: runner.position!.y + 1 });

    const turnNumber = state.turnNumber;
    turn(state, pace(runner.instanceId, ally.instanceId));

    expect(sumMagnitude(ally, 'moveBonus', turnNumber)).toBe(MAX_MOVE);
  });

  it('대각선 아군에게는 닿지 않는다 — 직선 4칸이 이 기술의 값이다', () => {
    const state = emptyState();
    const runner = addUnit(state, 'support4', 'p1', { x: 4, y: 4 });
    const ally = addUnit(state, 'tank1', 'p1', { x: 5, y: 5 });

    const turnNumber = state.turnNumber;
    turn(state, pace(runner.instanceId, ally.instanceId));

    expect(sumMagnitude(ally, 'moveBonus', turnNumber)).toBe(0);
  });

  /**
   * **늘어난 칸을 실제로 쓰는 것은 다음 턴이다.** 동시 턴이라 아군은 계획 시점에 이 버프가 올지
   * 모르고, 이동은 계획할 때 칸수를 찍어야 한다. 상태이상이 이번 턴과 다음 턴을 덮으므로 아군은
   * 다음 턴 계획에서 늘어난 칸을 쓴다 — 이 테스트가 잠그는 것이 그 타이밍이다.
   */
  it('받은 아군은 다음 턴에 실제로 더 걷는다 — 상태이상만 붙고 칸수가 그대로면 아무 일도 안 한 것이다', () => {
    const state = emptyState();
    const runner = addUnit(state, 'support4', 'p1', { x: 4, y: 4 });
    const ally = addUnit(state, 'tank1', 'p1', { x: 5, y: 4 });
    const base = getUnitType('tank1').moveSpeed;

    turn(state, pace(runner.instanceId, ally.instanceId));
    turn(state, { [ally.instanceId]: { baseAction: { kind: 'move', direction: 'right', distance: base + MIN_MOVE } } });

    expect(ally.position).toEqual({ x: 5 + base + MIN_MOVE, y: 4 });
  });

  it('쿨타임이 데이터의 값만큼 걸린다', () => {
    const state = emptyState();
    const runner = addUnit(state, 'support4', 'p1', { x: 4, y: 4 });
    const ally = addUnit(state, 'tank1', 'p1', { x: 5, y: 4 });

    turn(state, pace(runner.instanceId, ally.instanceId));

    expect(PACE_CD.type).toBe('cooldown');
    expect(runner.cooldowns['support4_pace']).toBe((PACE_CD as { turns: number }).turns - 1);
  });
});
