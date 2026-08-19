import type { GameState, Owner } from './types';
import { CAPTURE_MARGIN } from '../data/constants';
import { isInCaptureZone } from './grid';

/** 점령지 안에 서 있는 팀별 기물 수(포탑 제외). */
export interface CaptureCounts {
  p1: number;
  p2: number;
}

/**
 * **인원 차 점령, 턴당 최대 1점.** 이 한 함수가 규칙의 유일한 근거다 — 턴종료 해결과 도움말 화면이
 * 같은 함수를 부르므로 "화면에 적힌 설명"과 "실제로 점수가 나는 조건"이 갈라질 수 없다.
 *
 * 점수가 나는 조건은 둘 중 하나다:
 *   · 상대가 **아예 없다**(무저항) — 1:0도 점수가 난다.
 *   · 상대가 있다면 `CAPTURE_MARGIN`명 **이상 앞선다** — 2:1은 경합(0점), 3:1부터 점수.
 * 몇 명 더 많은지는 점수 크기에 영향을 주지 않는다 — 3:1이든 5:0이든 똑같이 1점이다.
 *
 * 무저항을 예외로 두는 이유: 아무도 지키지 않는 점령지를 한 기물이 차지했는데 0점이면, 상대가
 * 전멸했거나 완전히 물러난 판이 진행되지 않고 멈춘다. 인원 차 기준은 **막는 쪽이 있을 때**
 * 비로소 의미가 있는 규칙이다.
 *
 * 기획서 5장 원문은 "양 팀이 함께 있으면 무조건 경합 0점"이었는데, 그러면 양쪽이 점령지에
 * 들어간 순간 아무도 점수를 못 내고 그 상태가 스스로 유지된다 — 200판 시뮬레이션에서 17.5%가
 * 끝나지 않았고, 그 판들의 선두 팀 평균 점수는 300턴을 돌려도 10점 만점에 1.6점이었다.
 * 느린 판이 아니라 완전 교착이라 기물 스탯으로는 풀 수 없었다.
 *
 * 그래서 승자 판정을 인원수가 아니라 **인원 차**로 바꿨다. 양쪽이 함께 있어도 병력을 더 밀어
 * 넣을 이유가 생겨 교착이 풀린다. 차이 기준을 1이 아니라 2로 둔 것은 "한 명 슬쩍 더 넣기"로
 * 점령이 굴러가지 않게 하려는 것이다 — 수비 한 명이 공격 두 명을 묶어 두는 값을 갖는다.
 */
export function captureWinner(counts: CaptureCounts): Owner | null {
  const owners: Owner[] = ['p1', 'p2'];
  const [a, b] = owners;
  const leader = counts[a] > counts[b] ? a : b;
  const follower = leader === a ? b : a;
  const needed = counts[follower] === 0 ? 1 : counts[follower] + CAPTURE_MARGIN;
  return counts[leader] >= needed ? leader : null;
}

/** 지금 점령지에 서 있는 팀별 인원. 포탑은 편성 기물이 아니라 점령에 세지 않는다. */
export function captureCounts(state: GameState): CaptureCounts {
  const counts: CaptureCounts = { p1: 0, p2: 0 };
  for (const unit of state.units) {
    if (!unit.alive || !unit.position || unit.isTurret) continue;
    if (isInCaptureZone(unit.position, state.board)) counts[unit.owner] += 1;
  }
  return counts;
}
