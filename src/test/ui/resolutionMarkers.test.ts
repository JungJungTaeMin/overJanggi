import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../engine/resolveTurn';
import { compactReplay, type ResolutionStep } from '../../engine/replay';
import { stepSummary, stepVisuals } from '../../components/Board/resolutionMarkers';
import { addUnit, emptyPlan, emptyState, plan, rngFor } from '../engine/helpers';

/**
 * 사용자가 원한 것은 한 문장이었다 — "내가 때렸는지 못 때렸는지, 힐했는지 못 했는지를
 * 직관적으로". 그 네 경우가 **판 위 배지**로 각각 다르게 나오는지를 여기서 못 박는다.
 * 근거는 언제나 그 단계의 이벤트다(체력 차이를 빼서 추정하지 않는다).
 */
function replayOf(run: (capture: (step: ResolutionStep) => void) => void): ResolutionStep[] {
  const steps: ResolutionStep[] = [];
  run((step) => steps.push(step));
  return compactReplay(steps);
}

function visualsAt(steps: ResolutionStep[], phase: ResolutionStep['phase']) {
  const index = steps.findIndex((s) => s.phase === phase);
  expect(index).toBeGreaterThanOrEqual(0);
  const previous = index > 0 ? steps[index - 1].units : [];
  return stepVisuals(steps[index], previous);
}

describe('board marks', () => {
  it('shows the damage taken and a ray from the attacker', () => {
    const state = emptyState();
    const attacker = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });
    const victim = addUnit(state, 'support2', 'p2', { x: 2, y: 0 });

    const steps = replayOf((capture) =>
      resolveTurn(
        state,
        plan('p1', 1, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
        emptyPlan('p2', 1),
        rngFor('p1'),
        capture,
      ),
    );

    const { marks, rays } = visualsAt(steps, 'attack');
    const damage = marks.find((m) => m.kind === 'damage');
    expect(damage).toBeDefined();
    expect(damage!.text).toMatch(/^-\d+$/);
    expect(damage!.position).toEqual({ x: 2, y: 0 });
    expect(victim.currentHp).toBeLessThan(victim.maxHp);
    expect(rays).toContainEqual(
      expect.objectContaining({ from: { x: 0, y: 0 }, to: { x: 2, y: 0 }, kind: 'hit' }),
    );
  });

  it('marks a kill at the square the unit died on, not at its null position', () => {
    const state = emptyState();
    const attacker = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });
    const victim = addUnit(state, 'support2', 'p2', { x: 2, y: 0 });
    victim.currentHp = 3;

    const steps = replayOf((capture) =>
      resolveTurn(
        state,
        plan('p1', 1, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
        emptyPlan('p2', 1),
        rngFor('p1'),
        capture,
      ),
    );

    const { marks } = visualsAt(steps, 'attack');
    const death = marks.find((m) => m.kind === 'death');
    expect(victim.alive).toBe(false);
    expect(victim.position).toBeNull(); // 죽으면 좌표를 잃는다 — 직전 단계로 물러나 찾아야 하는 이유
    expect(death).toBeDefined();
    expect(death!.position).toEqual({ x: 2, y: 0 });
  });

  it('marks a miss where the shot was fired from', () => {
    const state = emptyState();
    const attacker = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });

    const steps = replayOf((capture) =>
      resolveTurn(
        state,
        plan('p1', 1, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
        emptyPlan('p2', 1),
        rngFor('p1'),
        capture,
      ),
    );

    const { marks } = visualsAt(steps, 'attack');
    const miss = marks.find((m) => m.kind === 'miss');
    expect(miss).toBeDefined();
    expect(miss!.text).toBe('빗나감');
    expect(miss!.position).toEqual({ x: 0, y: 0 });
  });

  it('separates "blocked" from "missed" — the same 0 damage, opposite next moves', () => {
    const state = emptyState();
    const attacker = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });
    const defender = addUnit(state, 'tank3', 'p2', { x: 2, y: 0 });

    const steps = replayOf((capture) =>
      resolveTurn(
        state,
        plan('p1', 1, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
        plan('p2', 1, {
          [defender.instanceId]: { baseAction: { kind: 'none' }, skillUse: { skillId: 'tank3_barrier' } },
        }),
        rngFor('p1'),
        capture,
      ),
    );

    const { marks } = visualsAt(steps, 'attack');
    expect(marks.find((m) => m.kind === 'blocked')?.text).toBe('막힘');
    expect(marks.some((m) => m.kind === 'miss')).toBe(false);
    expect(marks.some((m) => m.kind === 'damage')).toBe(false);
  });

  it('shows the amount healed', () => {
    const state = emptyState();
    const healer = addUnit(state, 'support2', 'p1', { x: 0, y: 0 });
    const hurt = addUnit(state, 'tank1', 'p1', { x: 0, y: 2 });
    hurt.currentHp = 1;

    const steps = replayOf((capture) =>
      resolveTurn(
        state,
        plan('p1', 1, {
          [healer.instanceId]: {
            baseAction: { kind: 'none' },
            skillUse: { skillId: 'support2_heal', target: hurt.instanceId },
          },
        }),
        emptyPlan('p2', 1),
        rngFor('p1'),
        capture,
      ),
    );

    const { marks, rays } = visualsAt(steps, 'heal');
    const heal = marks.find((m) => m.kind === 'heal');
    expect(heal).toBeDefined();
    expect(heal!.text).toMatch(/^\+\d+$/);
    expect(heal!.position).toEqual({ x: 0, y: 2 });
    expect(rays.some((r) => r.kind === 'heal')).toBe(true);
  });
});

describe('stepSummary', () => {
  it('counts the same marks the board draws', () => {
    const marks = [
      { key: 'a', position: { x: 0, y: 0 }, kind: 'damage' as const, text: '-8' },
      { key: 'b', position: { x: 1, y: 0 }, kind: 'damage' as const, text: '-3' },
      { key: 'c', position: { x: 2, y: 0 }, kind: 'death' as const, text: '격추' },
    ];
    const step = { phase: 'attack' as const, units: [], healPackTimers: {}, score: { p1: 0, p2: 0 }, events: [] };
    expect(stepSummary(step, marks)).toBe('명중 2 · 처치 1');
  });

  it('falls back to naming the phase when nothing visible happened', () => {
    const step = { phase: 'preAttack' as const, units: [], healPackTimers: {}, score: { p1: 0, p2: 0 }, events: [] };
    expect(stepSummary(step, [])).toBe('방벽 · 구속 · 공격모드');
  });
});
