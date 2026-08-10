import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../engine/resolveTurn';
import { addUnit, emptyPlan, emptyState, testBoard } from './helpers';

describe('occupation scoring and win condition', () => {
  it('awards 1 point when one team has a single occupant in the capture zone', () => {
    const state = emptyState();
    addUnit(state, 'support2', 'p1', { x: 4, y: 4 });

    resolveTurn(state, emptyPlan('p1', 1), emptyPlan('p2', 1), () => 0);

    expect(state.score.p1).toBe(1);
    expect(state.score.p2).toBe(0);
  });

  it('caps the score at 2 points regardless of having 2 or more occupants', () => {
    const board = testBoard({ captureZone: [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 4, y: 6 }] });
    const state = emptyState(board);
    addUnit(state, 'support2', 'p1', { x: 4, y: 4 });
    addUnit(state, 'support2', 'p1', { x: 4, y: 5 });
    addUnit(state, 'support2', 'p1', { x: 4, y: 6 });

    resolveTurn(state, emptyPlan('p1', 1), emptyPlan('p2', 1), () => 0);

    expect(state.score.p1).toBe(2);
  });

  it('awards no points when both teams contest the capture zone', () => {
    const board = testBoard({ captureZone: [{ x: 4, y: 4 }, { x: 4, y: 5 }] });
    const state = emptyState(board);
    addUnit(state, 'support2', 'p1', { x: 4, y: 4 });
    addUnit(state, 'support2', 'p2', { x: 4, y: 5 });

    resolveTurn(state, emptyPlan('p1', 1), emptyPlan('p2', 1), () => 0);

    expect(state.score.p1).toBe(0);
    expect(state.score.p2).toBe(0);
  });

  it('ends the game immediately once a team reaches the win score', () => {
    const state = emptyState();
    state.score.p1 = 9;
    addUnit(state, 'support2', 'p1', { x: 4, y: 4 });

    resolveTurn(state, emptyPlan('p1', 1), emptyPlan('p2', 1), () => 0);

    expect(state.score.p1).toBe(10);
    expect(state.winner).toBe('p1');
    expect(state.phase).toBe('gameOver');
  });
});
