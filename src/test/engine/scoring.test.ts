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

  it('still awards only 1 point when a team has several occupants — 1 is the per-turn maximum', () => {
    const board = testBoard({ captureZone: [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 4, y: 6 }] });
    const state = emptyState(board);
    addUnit(state, 'support2', 'p1', { x: 4, y: 4 });
    addUnit(state, 'support2', 'p1', { x: 4, y: 5 });
    addUnit(state, 'support2', 'p1', { x: 4, y: 6 });

    resolveTurn(state, emptyPlan('p1', 1), emptyPlan('p2', 1), () => 0);

    expect(state.score.p1).toBe(1);
  });

  it('awards no points when both teams have equal numbers in the capture zone', () => {
    const board = testBoard({ captureZone: [{ x: 4, y: 4 }, { x: 4, y: 5 }] });
    const state = emptyState(board);
    addUnit(state, 'support2', 'p1', { x: 4, y: 4 });
    addUnit(state, 'support2', 'p2', { x: 4, y: 5 });

    resolveTurn(state, emptyPlan('p1', 1), emptyPlan('p2', 1), () => 0);

    expect(state.score.p1).toBe(0);
    expect(state.score.p2).toBe(0);
  });
});

/**
 * **다수결 점령, 턴당 최대 1점.** 점령지에 양 팀이 함께 있어도 더 이상 무조건 0점이 아니다 —
 * 인원이 많은 쪽이 **1점**을 얻고, 정확히 동수일 때만 0점이다.
 *
 * 몇 명 차이인지는 점수에 영향을 주지 않는다. 3:1도 5:1도 똑같이 1점이므로, 이미 과반을 잡은
 * 점령지에 병력을 더 붓는 보상이 없다 — 남는 기물은 교전이나 수비로 돌리는 편이 낫다.
 *
 * 이 변경의 이유는 밸런스 측정이었다. 원문 규칙("양 팀 공존이면 무조건 0점")에서는 200판 중
 * 17.5%가 끝나지 않았고, 그 무승부 게임들에서 앞선 팀조차 10점 만점에 평균 1.6점이었다 —
 * 양 팀이 점령지에 한 명씩만 넣어 두면 영원히 0점이라, 서로 밀어내지 못하는 교착이 그대로 굳었다.
 */
describe('majority occupation', () => {
  const zone = [
    { x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 },
    { x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 },
  ];

  /** 점령지 칸들에 팀별 인원을 채워 한 턴 해결한 뒤 점수를 돌려준다. */
  function scoreFor(p1Count: number, p2Count: number) {
    const state = emptyState(testBoard({ captureZone: zone }));
    let i = 0;
    for (let n = 0; n < p1Count; n++) addUnit(state, 'support2', 'p1', zone[i++]);
    for (let n = 0; n < p2Count; n++) addUnit(state, 'support2', 'p2', zone[i++]);
    resolveTurn(state, emptyPlan('p1', 1), emptyPlan('p2', 1), () => 0);
    return state.score;
  }

  it('gives the outnumbering team a point — 2 vs 1 scores, it is not a scoreless contest', () => {
    expect(scoreFor(2, 1)).toEqual({ p1: 1, p2: 0 });
  });

  it('gives the same 1 point for a bigger lead — 3 vs 1 is not worth more than 2 vs 1', () => {
    expect(scoreFor(3, 1)).toEqual({ p1: 1, p2: 0 });
  });

  it('gives 1 point however lopsided the majority is', () => {
    expect(scoreFor(4, 1)).toEqual({ p1: 1, p2: 0 });
    expect(scoreFor(5, 0)).toEqual({ p1: 1, p2: 0 });
  });

  it('gives nothing to either team on an exact tie, however many are in there', () => {
    expect(scoreFor(2, 2)).toEqual({ p1: 0, p2: 0 });
    expect(scoreFor(3, 3)).toEqual({ p1: 0, p2: 0 });
  });

  it('scores for whichever side is ahead, not just p1', () => {
    expect(scoreFor(1, 3)).toEqual({ p1: 0, p2: 1 });
  });

  it('needs at least WIN_SCORE turns of control to win — 1 point per turn is the hard ceiling', () => {
    // 상한이 1점이라 승리까지 최소 10턴은 점령 우위를 유지해야 한다. 이전 2점 상한에서는
    // 점령지를 크게 장악한 팀이 5턴 만에 끝낼 수 있었다.
    const state = emptyState(testBoard({ captureZone: zone }));
    for (let n = 0; n < 4; n++) addUnit(state, 'support2', 'p1', zone[n]);

    for (let turn = 1; turn <= 9; turn++) {
      resolveTurn(state, emptyPlan('p1', turn), emptyPlan('p2', turn), () => 0);
    }

    expect(state.score.p1).toBe(9);
    expect(state.winner).toBeNull();
  });

  it('ignores turrets — they are summons, not roster pieces, and would be a free permanent margin', () => {
    // 포탑은 팀당 1기가 점령지에 눌러앉아 움직이지 않으므로, 세면 그 팀이 영구히 +1 우위를 얻는다.
    const state = emptyState(testBoard({ captureZone: zone }));
    addUnit(state, 'support2', 'p1', zone[0]);
    addUnit(state, 'support2', 'p2', zone[1]);
    const turret = addUnit(state, 'turret', 'p1', zone[2]);
    expect(turret.isTurret).toBe(true);

    resolveTurn(state, emptyPlan('p1', 1), emptyPlan('p2', 1), () => 0);

    expect(state.score).toEqual({ p1: 0, p2: 0 });
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
