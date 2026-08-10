import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../engine/resolveTurn';
import { computeMoveOptions, isDashPlanning } from '../../components/Planning/actionGeometry';
import { addUnit, emptyPlan, emptyState, plan, rngFor, testBoard } from './helpers';

const CHARGE = 'tank2_charge';
/** 이동 5칸(이동 Lv 4 + 돌진 버프 1)을 그대로 계획하는 헬퍼. */
const dashDown = (steps: number) => ({
  baseAction: { kind: 'move' as const, direction: 'down' as const, distance: steps, path: Array<'down'>(steps).fill('down') },
  skillUse: { skillId: CHARGE },
});

/**
 * tank2 돌진(§7.1 "1턴간 이동+1, **경로의 적에게 이동 칸수만큼 피해**, 경로 1회 변경 가능").
 *
 * "경로의 적"을 문자 그대로 구현하려면 돌진이 적 칸을 **통과**할 수 있어야 한다 — 일반 이동처럼
 * 적 앞에서 멈추면 경로 위에 적이 설 수가 없어 규칙이 죽은 문장이 된다. 그래서 돌진 중에만
 * 적을 밟고 지나가고(아군·장애물은 그대로 막힘), 밟은 적 전원이 **실제 이동 칸수**만큼 맞는다.
 */
describe('tank2 돌진 — 경로의 적 관통 피해', () => {
  it('일렬로 선 적들을 밟고 지나가며 전원에게 이동 칸수만큼 피해를 준다', () => {
    const state = emptyState();
    const tank2 = addUnit(state, 'tank2', 'p1', { x: 0, y: 0 }); // 이동 4 + 돌진 +1 = 5칸
    const front = addUnit(state, 'tank1', 'p2', { x: 0, y: 2 }); // 최대 체력 40
    const back = addUnit(state, 'tank1', 'p2', { x: 0, y: 3 });

    const log = resolveTurn(state, plan('p1', 1, { [tank2.instanceId]: dashDown(5) }), emptyPlan('p2', 1), rngFor('p1'));

    expect(tank2.position).toEqual({ x: 0, y: 5 });
    // 5칸을 갔으므로 밟힌 둘 다 5씩. "먼저 밟힌 쪽이 더 아프다" 같은 감쇠는 없다.
    expect(front.currentHp).toBe(35);
    expect(back.currentHp).toBe(35);
    expect(log.filter((e) => e.type === 'dashDamage')).toHaveLength(2);
  });

  it('정지 칸이 적에게 점유돼 있으면 그 앞 칸까지 물러나고, 피해량도 줄어든 이동 칸수를 따른다', () => {
    const state = emptyState();
    const tank2 = addUnit(state, 'tank2', 'p1', { x: 0, y: 0 });
    const trampled = addUnit(state, 'tank1', 'p2', { x: 0, y: 2 });
    const blocker = addUnit(state, 'tank1', 'p2', { x: 0, y: 5 }); // 5칸째 = 정지 예정 칸

    resolveTurn(state, plan('p1', 1, { [tank2.instanceId]: dashDown(5) }), emptyPlan('p2', 1), rngFor('p1'));

    // 밟고 지나간 적 **위에서 멈출 수는 없다** → 비어 있는 마지막 칸 (0,4)까지 되돌린다.
    expect(tank2.position).toEqual({ x: 0, y: 4 });
    expect(trampled.currentHp).toBe(36); // 5가 아니라 실제 이동한 4칸만큼
    // 결국 지나가지 못한 (0,5)의 적은 밟힌 것으로 치지 않는다.
    expect(blocker.currentHp).toBe(40);
  });

  it('아군은 관통하지 못하고 그 앞에서 멈춘다 — 그때까지 밟은 적만 피해를 입는다', () => {
    const state = emptyState();
    const tank2 = addUnit(state, 'tank2', 'p1', { x: 0, y: 0 });
    const enemyA = addUnit(state, 'tank1', 'p2', { x: 0, y: 1 });
    const enemyB = addUnit(state, 'tank1', 'p2', { x: 0, y: 2 });
    addUnit(state, 'tank1', 'p1', { x: 0, y: 4 }); // 아군 벽

    resolveTurn(state, plan('p1', 1, { [tank2.instanceId]: dashDown(5) }), emptyPlan('p2', 1), rngFor('p1'));

    expect(tank2.position).toEqual({ x: 0, y: 3 });
    expect(enemyA.currentHp).toBe(37);
    expect(enemyB.currentHp).toBe(37);
  });

  it('정적 장애물은 돌진으로도 뚫지 못한다 — 적만 통과 대상이다', () => {
    const state = emptyState(testBoard({ obstacles: [{ x: 0, y: 3 }] }));
    const tank2 = addUnit(state, 'tank2', 'p1', { x: 0, y: 0 });
    const enemy = addUnit(state, 'tank1', 'p2', { x: 0, y: 1 });

    resolveTurn(state, plan('p1', 1, { [tank2.instanceId]: dashDown(5) }), emptyPlan('p2', 1), rngFor('p1'));

    expect(tank2.position).toEqual({ x: 0, y: 2 }); // 적 한 명을 밟고 지나가 장애물 앞에서 정지
    expect(enemy.currentHp).toBe(38);
  });

  it('돌진 피해로 죽은 적은 그 턴의 공격을 수행하지 못한다 (피해가 1단계에서 발생)', () => {
    const state = emptyState();
    const tank2 = addUnit(state, 'tank2', 'p1', { x: 0, y: 0 });
    const victim = addUnit(state, 'tank1', 'p1', { x: 2, y: 2 }); // 적의 공격 대상
    const enemy = addUnit(state, 'dealer2', 'p2', { x: 0, y: 2 }); // 공격 6, 직선 사거리 2
    enemy.currentHp = 4; // 돌진 5칸이면 확실히 죽는 체력

    const log = resolveTurn(
      state,
      plan('p1', 1, { [tank2.instanceId]: dashDown(5) }),
      plan('p2', 1, { [enemy.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
      rngFor('p1'),
    );

    expect(enemy.alive).toBe(false);
    expect(victim.currentHp).toBe(40); // 공격이 나가지 못했다
    expect(log.some((e) => e.type === 'hit' && e.actorId === enemy.instanceId)).toBe(false);
    // 이동(1단계)에서 죽었으므로 공격 순서(3단계 직전 재계산) 자체에 들어가지 못한다.
    expect(log.some((e) => e.type === 'attackOrder' && (e.detail!.order as { instanceId: string }[]).some((p) => p.instanceId === enemy.instanceId))).toBe(false);
  });

  it('돌진 기술을 쓰지 않은 이동은 적을 통과하지도, 피해를 주지도 않는다', () => {
    const state = emptyState();
    const tank2 = addUnit(state, 'tank2', 'p1', { x: 0, y: 0 });
    const enemy = addUnit(state, 'tank1', 'p2', { x: 0, y: 2 });

    const log = resolveTurn(
      state,
      plan('p1', 1, {
        [tank2.instanceId]: { baseAction: { kind: 'move', direction: 'down', distance: 4, path: Array<'down'>(4).fill('down') } },
      }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );

    expect(tank2.position).toEqual({ x: 0, y: 1 }); // 적 앞에서 정지
    expect(enemy.currentHp).toBe(40);
    expect(log.some((e) => e.type === 'dashDamage')).toBe(false);
  });
});

/**
 * 보드 하이라이트(초록 칸)는 엔진과 **같은 통과 규칙**을 써야 한다. 여기가 어긋나면 "돌진인데
 * 적 뒤쪽 칸이 안 떠서 계획 자체를 못 세우는" 상태가 된다(실제로 그랬다).
 */
describe('tank2 돌진 — 이동 가능 칸 하이라이트', () => {
  const setup = () => {
    const state = emptyState();
    const tank2 = addUnit(state, 'tank2', 'p1', { x: 0, y: 0 });
    addUnit(state, 'tank1', 'p2', { x: 0, y: 2 });
    return { state, tank2 };
  };
  const downCells = (opts: { position: { x: number; y: number } }[]) =>
    opts.filter((o) => o.position.x === 0).map((o) => o.position.y).sort((a, b) => a - b);

  it('돌진이면 적 뒤쪽 칸까지 뜨되, 적이 서 있는 칸은 정지 칸이 될 수 없어 빠진다', () => {
    const { state, tank2 } = setup();
    const options = computeMoveOptions(tank2, state.units, state.board, 5, undefined, true);
    expect(downCells(options)).toEqual([1, 3, 4, 5]); // (0,2)의 적은 통과만 한다
    // 칸수는 배열 순서가 아니라 실제 이동 칸수여야 한다 — (0,5)는 5칸째다.
    expect(options.find((o) => o.position.x === 0 && o.position.y === 5)?.distance).toBe(5);
  });

  it('돌진이 아니면 적 앞에서 끊긴다', () => {
    const { state, tank2 } = setup();
    expect(downCells(computeMoveOptions(tank2, state.units, state.board, 5))).toEqual([1]);
  });

  it('isDashPlanning은 돌진 기술을 실제로 쓸 때만, 그리고 기본 행동이 이동일 때만 참이다', () => {
    const { tank2 } = setup();
    expect(isDashPlanning(tank2, { baseAction: { kind: 'none' }, skillUse: { skillId: CHARGE } })).toBe(true);
    expect(isDashPlanning(tank2, { baseAction: { kind: 'none' } })).toBe(false);
    // 기본 행동이 공격이면 이동 자체가 기술 몫이라 돌진(기본 이동 버프)이 성립하지 않는다.
    expect(isDashPlanning(tank2, { baseAction: { kind: 'attack', direction: 'down' }, skillUse: { skillId: CHARGE } })).toBe(false);
  });
});
