import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../engine/resolveTurn';
import { WIN_SCORE } from '../../data/constants';
import { addUnit, emptyPlan, emptyState, testBoard } from './helpers';

describe('occupation scoring and win condition', () => {
  it('awards 1 point to a lone occupant when nobody contests', () => {
    // 인원 차 기준은 **막는 쪽이 있을 때만** 적용된다. 아무도 없는 점령지는 1기로도 먹힌다 —
    // 그러지 않으면 상대가 전멸했거나 물러난 판이 진행되지 않고 멈춘다.
    const state = emptyState();
    addUnit(state, 'support2', 'p1', { x: 4, y: 4 });

    resolveTurn(state, emptyPlan('p1', 1), emptyPlan('p2', 1), () => 0);

    expect(state.score).toEqual({ p1: 1, p2: 0 });
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
 * **인원 차 점령, 턴당 최대 1점.** 상대가 점령지에 없으면 1기로도 점수가 나고(1:0 → 1점),
 * 상대가 있으면 CAPTURE_MARGIN(2)명 이상 앞서야 점수가 난다 — 2:1은 경합(0점), 3:1부터 1점.
 *
 * 몇 명 차이인지는 점수 크기에 영향을 주지 않는다. 3:1도 5:0도 똑같이 1점이므로, 이미 점령한
 * 곳에 병력을 더 붓는 보상은 없다 — 차이 2를 만든 뒤 남는 기물은 교전이나 수비로 돌리는 편이 낫다.
 *
 * 원문 규칙("양 팀 공존이면 무조건 0점")에서는 200판 중 17.5%가 끝나지 않았고, 그 무승부
 * 게임들에서 앞선 팀조차 10점 만점에 평균 1.6점이었다 — 양 팀이 한 명씩만 넣어 두면 영원히
 * 0점이라 교착이 굳었다. 인원 차 기준은 병력을 더 밀어 넣을 이유를 만들어 그 교착을 푼다.
 */
describe('margin occupation', () => {
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

  it('gives nothing for a one-body lead — 2 vs 1 is a contest, not an occupation', () => {
    // 이 줄이 이 규칙의 핵심이다. 단순 다수결이던 이전 규칙에서는 여기서 p1이 1점을 얻었다.
    expect(scoreFor(2, 1)).toEqual({ p1: 0, p2: 0 });
  });

  it('scores once the lead reaches two — 3 vs 1 is the smallest scoring lead against a defender', () => {
    expect(scoreFor(3, 1)).toEqual({ p1: 1, p2: 0 });
  });

  it('gives the same 1 point however lopsided the lead is', () => {
    expect(scoreFor(4, 1)).toEqual({ p1: 1, p2: 0 });
    expect(scoreFor(5, 0)).toEqual({ p1: 1, p2: 0 });
  });

  it('lets a single defender deny two attackers — this is the point of the rule', () => {
    // 수비 1기가 공격 2기를 묶는다. 수비가 빠지는 순간 같은 2기가 곧바로 점수를 낸다.
    expect(scoreFor(2, 1)).toEqual({ p1: 0, p2: 0 });
    expect(scoreFor(2, 0)).toEqual({ p1: 1, p2: 0 });
  });

  it('scores an uncontested zone with a single unit, but not once one defender arrives', () => {
    // 이 두 줄이 "무저항 예외"의 경계다. 수비 1기가 들어오는 것만으로 공격 1기의 점수가 끊긴다.
    expect(scoreFor(1, 0)).toEqual({ p1: 1, p2: 0 });
    expect(scoreFor(1, 1)).toEqual({ p1: 0, p2: 0 });
  });

  it('gives nothing to either team on an exact tie, however many are in there', () => {
    expect(scoreFor(2, 2)).toEqual({ p1: 0, p2: 0 });
    expect(scoreFor(3, 3)).toEqual({ p1: 0, p2: 0 });
  });

  it('scores for whichever side is ahead, not just p1', () => {
    expect(scoreFor(1, 3)).toEqual({ p1: 0, p2: 1 });
  });

  it('needs at least WIN_SCORE turns of control to win — 1 point per turn is the hard ceiling', () => {
    // 턴당 상한이 1점이라 승리까지 최소 WIN_SCORE턴은 점령 우위를 유지해야 한다. 이전 2점 상한에서는
    // 점령지를 크게 장악한 팀이 절반의 턴으로 끝낼 수 있었다.
    //
    // 숫자를 박지 않고 WIN_SCORE로 세는 이유: 여기서 재는 건 "10턴"이 아니라 **점수와 턴이 1:1로
    // 묶여 있다**는 성질이다. 승리 점수는 판 길이 조정으로 바뀌는 값이라 박아 두면 규칙이 멀쩡한데도
    // 테스트가 깨진다.
    const state = emptyState(testBoard({ captureZone: zone }));
    for (let n = 0; n < 4; n++) addUnit(state, 'support2', 'p1', zone[n]);

    for (let turn = 1; turn < WIN_SCORE; turn++) {
      resolveTurn(state, emptyPlan('p1', turn), emptyPlan('p2', turn), () => 0);
    }

    expect(state.score.p1).toBe(WIN_SCORE - 1);
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
    const state = emptyState(testBoard({ captureZone: zone }));
    state.score.p1 = WIN_SCORE - 1;
    addUnit(state, 'support2', 'p1', zone[0]);
    addUnit(state, 'support2', 'p1', zone[1]);

    resolveTurn(state, emptyPlan('p1', 1), emptyPlan('p2', 1), () => 0);

    expect(state.score.p1).toBe(WIN_SCORE);
    expect(state.winner).toBe('p1');
    expect(state.phase).toBe('gameOver');
  });
});
