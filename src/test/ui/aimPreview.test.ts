import { describe, expect, it } from 'vitest';
import { addUnit, emptyPlan, emptyState, plan, rngFor } from '../engine/helpers';
import { computeAttackOptions } from '../../components/Planning/actionGeometry';
import { aimSummary, computeAimMarks } from '../../components/Planning/aimPreview';
import { resolveTurn } from '../../engine/resolveTurn';
import { addStatusEffect } from '../../engine/statusEffects';

/**
 * **사거리 하이라이트는 "닿는다"를 뜻하지 않는다.** 주황 칸은 사선이 뻗는 범위일 뿐인데 사람은
 * 그걸 "여기 쏘면 맞는다"로 읽는다 — 그래서 조준 결과를 클릭 전에 판에 올린다.
 *
 * 여기서 지키려는 것은 하나다: **미리보기가 실제 해결과 갈라지지 않는가.** 갈라지는 순간 이 표시는
 * 도움이 아니라 헛발질을 부추기는 쪽이 된다.
 */
function marksFor(state: ReturnType<typeof emptyState>, attackerId: string) {
  const attacker = state.units.find((u) => u.instanceId === attackerId)!;
  const options = computeAttackOptions(attacker, state.board, attacker.position!);
  return computeAimMarks(attacker, state.units, state.board, attacker.position!, options, state.turnNumber);
}

describe('aim preview marks', () => {
  it('marks the enemy that a straight shot would actually hit', () => {
    const state = emptyState();
    const attacker = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });
    const victim = addUnit(state, 'support2', 'p2', { x: 2, y: 0 });

    const marks = marksFor(state, attacker.instanceId);
    const hits = marks.filter((m) => m.kind === 'hit');
    expect(hits).toHaveLength(1);
    expect(hits[0].position).toEqual(victim.position);
    expect(hits[0].direction).toBe('right');
    expect(hits[0].damage).toBeGreaterThan(0);
  });

  it('shows nothing when every direction is empty — 빈 사선마다 표식을 찍지 않는다', () => {
    const state = emptyState();
    const attacker = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });

    // 사거리 칸은 잔뜩 있는데(주황이 칠해지는데) 조준 표식은 하나도 없어야 한다 —
    // 바로 이 차이가 "여섯 발 연속 헛방"을 만들던 지점이다.
    expect(computeAttackOptions(attacker, state.board, attacker.position!).length).toBeGreaterThan(0);
    expect(marksFor(state, attacker.instanceId)).toHaveLength(0);
  });

  it('distinguishes an ally blocking the line from an empty line', () => {
    const state = emptyState();
    const attacker = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });
    const friend = addUnit(state, 'support2', 'p1', { x: 1, y: 0 });
    addUnit(state, 'support2', 'p2', { x: 2, y: 0 });

    const marks = marksFor(state, attacker.instanceId);
    // 아군이 비키기만 하면 닿는다는 뜻이라, 빈 사선과 전혀 다른 다음 수를 부른다.
    expect(marks).toEqual([{ position: friend.position, kind: 'ally', direction: 'right' }]);
  });

  it('distinguishes a barrier from a clean hit', () => {
    const state = emptyState();
    const attacker = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });
    const victim = addUnit(state, 'support2', 'p2', { x: 2, y: 0 });
    addStatusEffect(victim, 'barrier', state.turnNumber, victim.instanceId);

    const marks = marksFor(state, attacker.instanceId);
    expect(marks).toEqual([{ position: victim.position, kind: 'barrier', direction: 'right' }]);
  });

  /**
   * **이 테스트가 이 기능의 전부다.** 미리보기가 실제로 들어갈 피해와 다르면, 화면은 여전히
   * 거짓말을 하는 것이고 사거리 하이라이트만 갖고 있던 예전보다 나빠진다(숫자까지 틀리므로).
   */
  it('predicts exactly the damage the engine deals (측면 교란 보너스 포함)', () => {
    const state = emptyState();
    // dealer4는 대각 공격이고, 대상이 다른 적과 인접하면 보너스가 붙는다.
    const attacker = addUnit(state, 'dealer4', 'p1', { x: 0, y: 0 });
    const victim = addUnit(state, 'support2', 'p2', { x: 1, y: 1 });
    addUnit(state, 'tank1', 'p2', { x: 2, y: 1 });

    const predicted = marksFor(state, attacker.instanceId).find(
      (m) => m.kind === 'hit' && m.position.x === 1 && m.position.y === 1,
    );
    expect(predicted).toBeDefined();

    const before = victim.currentHp;
    resolveTurn(
      state,
      plan('p1', 1, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'downright' } } }),
      emptyPlan('p2', 1),
      rngFor('p1'),
    );
    expect(before - victim.currentHp).toBe(predicted!.damage);
  });
});

describe('aimSummary', () => {
  it('explains why nothing is marked instead of staying silent', () => {
    expect(aimSummary([])).toContain('닿는 대상이 없습니다');
  });

  it('names the blocker so the next move is obvious', () => {
    expect(aimSummary([{ position: { x: 1, y: 0 }, kind: 'ally', direction: 'right' }])).toContain('아군');
    expect(aimSummary([{ position: { x: 1, y: 0 }, kind: 'barrier', direction: 'right' }])).toContain('방벽');
  });

  it('reports the best available damage when something is in range', () => {
    const summary = aimSummary([
      { position: { x: 1, y: 0 }, kind: 'hit', damage: 5, direction: 'right' },
      { position: { x: 0, y: 1 }, kind: 'hit', damage: 12, direction: 'down' },
    ]);
    expect(summary).toContain('2곳');
    expect(summary).toContain('12');
  });
});
