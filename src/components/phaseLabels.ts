/**
 * **한 단계에는 이름이 하나뿐이어야 한다.**
 *
 * 같은 2단계를 도움말은 "공격 전 상태변화", 로그는 "2.공격전", 재생 바는 "2. 변환"이라고 부르던
 * 때가 있었다. 셋 다 맞는 말이지만 화면에 나란히 놓이면 플레이어는 **서로 다른 세 단계**가 있다고
 * 읽는다 — 규칙을 오해하게 만드는 종류의 버그라, 이름을 여기 한 곳에 모은다.
 *
 * 재생(ReplayPhase)과 로그(ResolutionEvent.phase)는 키 집합이 조금 다르다. 재생에는 판을 보여
 * 주기 위한 'start'·'turnStart'가 있고, 로그에는 순서 계산 기록인 'priority'가 있다. 겹치는
 * 다섯 단계의 **이름**만 공유하면 되므로 map 하나를 키 문자열로 열어 둔다.
 */
export const PHASE_NAME: Record<string, string> = {
  priority: '우선순위',
  start: '공개',
  turnStart: '턴 시작',
  movement: '이동',
  preAttack: '공격 전',
  attack: '공격',
  heal: '회복',
  endOfTurn: '턴 종료',
};

/** 해결 5단계에서 몇 번째인지. 단계가 아닌 것(공개·턴 시작)은 번호가 없다. */
const PHASE_NUMBER: Record<string, number> = {
  priority: 0,
  movement: 1,
  preAttack: 2,
  attack: 3,
  heal: 4,
  endOfTurn: 5,
};

/** "3. 공격"처럼 번호를 붙인 이름. 번호 없는 단계는 이름만 돌려준다. */
export function numberedPhase(phase: string): string {
  const name = PHASE_NAME[phase] ?? phase;
  const n = PHASE_NUMBER[phase];
  return n === undefined ? name : `${n}. ${name}`;
}
