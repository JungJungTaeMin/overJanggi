import { getUnitType, unitTypes } from './unitTypes';
import { ROSTER_SIZE } from './constants';

/**
 * 편성 규칙 — 5기물을 **어떻게 골라야 하는가**에 대한 제약이다.
 *
 * 왜 따로 두는가: 이건 스탯 조정이 아니라 **규칙 변경**이라 기물의 값어치 순위 자체를 바꾼다.
 * 밸런스 측정(`scripts/balanceSim.ts` 5번째 인자)에서 탱커 수를 고정해 재 봤을 때 실제로 그랬다:
 * 방어 강화형은 혼자일 때 값어치가 나오고(자기가 유일한 전선) 돌진·기동형은 짝이 있을 때 값어치가
 * 나온다. 즉 같은 스탯이어도 "탱커 몇 명 편성인가"에 따라 다른 기물이 된다.
 *
 * 그래서 규칙은 유닛 데이터가 아니라 여기 한 곳에 두고, **드래프트 화면 · AI 편성 · 시뮬레이터가
 * 모두 이 파일을 근거로 삼는다**. 각자 조건을 따로 쓰면 사람은 못 고르는 편성을 AI가 내는 식으로
 * 조용히 갈라진다.
 */
export type RosterRuleId = 'free' | 'oneTank';

export interface RosterRule {
  id: RosterRuleId;
  label: string;
  /** 메뉴 카드에 그대로 쓰이는 한 줄 설명. */
  summary: string;
  /** 편성에 넣어야 하는 탱커 수. null이면 제약 없음. */
  tankQuota: number | null;
}

export const ROSTER_RULES: Record<RosterRuleId, RosterRule> = {
  free: {
    id: 'free',
    label: '자유 편성',
    summary: '기물 10종에서 제약 없이 5기물. 같은 기물을 여러 기 넣어도 된다.',
    tankQuota: null,
  },
  oneTank: {
    id: 'oneTank',
    label: '탱커 1명 고정',
    summary: '탱커는 정확히 1기, 나머지 4기는 딜러·지원에서. 탱커를 겹겹이 세워 버티는 편성이 사라진다.',
    tankQuota: 1,
  },
};

export const ROSTER_RULE_ORDER: RosterRuleId[] = ['free', 'oneTank'];

export const DEFAULT_ROSTER_RULE: RosterRuleId = 'free';

/** 모르는 값이 들어와도(옛 스냅샷, 손으로 고친 저장값) 판이 깨지지 않게 기본 규칙으로 떨어뜨린다. */
export function rosterRuleOf(id: RosterRuleId | undefined | null): RosterRule {
  return ROSTER_RULES[id as RosterRuleId] ?? ROSTER_RULES[DEFAULT_ROSTER_RULE];
}

export function tankQuotaOf(id: RosterRuleId | undefined | null): number | null {
  return rosterRuleOf(id).tankQuota;
}

const TANKS = unitTypes.filter((t) => t.role === 'tank');
const NON_TANKS = unitTypes.filter((t) => t.role !== 'tank');

export function isTankType(typeId: string): boolean {
  return getUnitType(typeId).role === 'tank';
}

export function tankCount(picks: string[]): number {
  return picks.filter(isTankType).length;
}

/**
 * 이 기물을 지금 더 담을 수 있는가. **담은 뒤에도 5기물을 채울 수 있는지**까지 본다 —
 * 탱커 1명 고정에서 비탱커를 4기 채웠다면 남은 한 자리는 탱커 몫이므로 비탱커 버튼이 잠겨야 한다.
 * "탱커를 2기 담은 다음 확정 단계에서 퇴짜"는 고른 걸 되돌리게 만들 뿐이라 담는 순간 막는다.
 */
export function canAddPick(picks: string[], typeId: string, ruleId: RosterRuleId): boolean {
  if (picks.length >= ROSTER_SIZE) return false;
  const quota = tankQuotaOf(ruleId);
  if (quota === null) return true;
  const tanks = tankCount(picks) + (isTankType(typeId) ? 1 : 0);
  const nonTanks = picks.length + 1 - tanks;
  return tanks <= quota && nonTanks <= ROSTER_SIZE - quota;
}

/**
 * 편성이 규칙에 맞는지. 맞으면 null, 아니면 **화면에 그대로 띄울 사유**를 돌려준다 —
 * 검사와 안내문을 한 함수로 묶어야 "버튼은 잠겼는데 왜 잠겼는지 알 수 없는" 상태가 안 생긴다.
 */
export function rosterViolation(picks: string[], ruleId: RosterRuleId): string | null {
  if (picks.length !== ROSTER_SIZE) return `${ROSTER_SIZE}기물을 골라야 합니다 (지금 ${picks.length}기)`;
  const quota = tankQuotaOf(ruleId);
  if (quota !== null && tankCount(picks) !== quota) {
    return `탱커를 정확히 ${quota}기 넣어야 합니다 (지금 ${tankCount(picks)}기)`;
  }
  return null;
}

export function isRosterLegal(picks: string[], ruleId: RosterRuleId): boolean {
  return rosterViolation(picks, ruleId) === null;
}

/**
 * 규칙을 지키는 무작위 편성. 쉬움 난이도 AI와 밸런스 시뮬레이터가 함께 쓴다.
 *
 * 할당량이 있을 때도 **복원추출**이다 — 자유 편성 쪽도 같은 기물을 2기 넣을 수 있으므로, 여기서만
 * 중복을 막으면 두 조건을 비교할 수 없게 된다. 뽑은 뒤 순서를 섞는 이유는 배치(aiPlacement)가 편성
 * 순서를 보기 때문이다. 안 섞으면 탱커가 항상 같은 자리에서 시작해 "탱커 1명 고정"이 아니라
 * "탱커를 특정 위치에 고정"을 재는 꼴이 된다.
 */
export function randomRosterWithQuota(rng: () => number, quota: number | null): string[] {
  if (quota === null) {
    return Array.from({ length: ROSTER_SIZE }, () => unitTypes[Math.floor(rng() * unitTypes.length)].id);
  }
  const roster = [
    ...Array.from({ length: quota }, () => TANKS[Math.floor(rng() * TANKS.length)].id),
    ...Array.from({ length: ROSTER_SIZE - quota }, () => NON_TANKS[Math.floor(rng() * NON_TANKS.length)].id),
  ];
  for (let i = roster.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [roster[i], roster[j]] = [roster[j], roster[i]];
  }
  return roster;
}

export function randomRoster(rng: () => number, ruleId: RosterRuleId): string[] {
  return randomRosterWithQuota(rng, tankQuotaOf(ruleId));
}
