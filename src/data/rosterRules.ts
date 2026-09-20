import type { Role } from '../engine/types';
import { getUnitType, unitTypes } from './unitTypes';
import { ROSTER_SIZE } from './constants';

/**
 * 편성 규칙 — **몇 기물을, 어떻게 골라야 하는가**에 대한 제약이다.
 *
 * 왜 따로 두는가: 이건 스탯 조정이 아니라 **규칙 변경**이라 기물의 값어치 순위 자체를 바꾼다.
 * 밸런스 측정(`scripts/balanceSim.ts` 5번째 인자)에서 탱커 수를 고정해 재 봤을 때 실제로 그랬다:
 * 방어 강화형은 혼자일 때 값어치가 나오고(자기가 유일한 전선) 돌진·기동형은 짝이 있을 때 값어치가
 * 나온다. 즉 같은 스탯이어도 "탱커 몇 명 편성인가"에 따라 다른 기물이 된다.
 *
 * 그래서 규칙은 유닛 데이터가 아니라 여기 한 곳에 두고, **드래프트 화면 · AI 편성 · 시뮬레이터가
 * 모두 이 파일을 근거로 삼는다**. 각자 조건을 따로 쓰면 사람은 못 고르는 편성을 AI가 내는 식으로
 * 조용히 갈라진다.
 *
 * 규칙이 **편성 인원수까지** 정하는 이유는 6대6 규칙 때문이다. 인원수를 `ROSTER_SIZE` 상수 하나로
 * 두면 규칙마다 다른 값을 가질 수 없고, 화면·스토어·AI가 각자 5를 하드코딩한 채 규칙만 6이 되어
 * "여섯 번째 기물을 골랐는데 배치 슬롯이 다섯 개"인 상태가 된다. 인원수를 묻는 곳은 전부
 * `rosterSizeOf()`를 쓴다.
 */
export type RosterRuleId = 'free' | 'oneTank' | 'sixRoles';

export interface RosterRule {
  id: RosterRuleId;
  label: string;
  /** 메뉴 카드에 그대로 쓰이는 한 줄 설명. */
  summary: string;
  /** 이 규칙에서 한 팀이 편성하는 기물 수. */
  size: number;
  /**
   * 역할별로 **정확히** 몇 기를 넣어야 하는가. 적지 않은 역할은 남는 자리를 자유롭게 채운다
   * (탱커 1명 고정: `{ tank: 1 }` — 나머지 4자리는 딜러·지원 아무거나).
   * null이면 역할 제약이 없다.
   */
  roleQuota: Partial<Record<Role, number>> | null;
}

export const ROSTER_RULES: Record<RosterRuleId, RosterRule> = {
  free: {
    id: 'free',
    label: '자유 편성',
    // 종 수를 문장에 박아 두면 기물을 하나 늘릴 때 이 한 줄만 조용히 낡는다(실제로 밀어내기·제어형을
    // 넣으면서 "10종"이 거짓이 됐다).
    summary: `기물 ${unitTypes.length}종에서 제약 없이 ${ROSTER_SIZE}기물. 같은 기물을 여러 기 넣어도 된다.`,
    size: ROSTER_SIZE,
    roleQuota: null,
  },
  oneTank: {
    id: 'oneTank',
    label: '탱커 1명 고정',
    summary: '탱커는 정확히 1기, 나머지 4기는 딜러·지원에서. 탱커를 겹겹이 세워 버티는 편성이 사라진다.',
    size: ROSTER_SIZE,
    roleQuota: { tank: 1 },
  },
  /**
   * 6대6 · 역할 균형(사용자 요청). 앞의 두 규칙이 "무엇을 고를 수 있는가"만 건드린 것과 달리
   * 이 규칙은 **판 위의 기물 수**를 바꾼다 — 같은 맵에 20기가 아니라 24기가 서므로 점령지 앞이
   * 더 붐비고, 역할이 2:2:2로 고정돼 "화력만 다섯"이나 "탱커 없이 시작" 같은 극단 편성이 사라진다.
   */
  sixRoles: {
    id: 'sixRoles',
    label: '6대6 · 역할 균형',
    summary: '한 팀 6기물을 탱커 2 · 딜러 2 · 지원 2로 정확히 맞춘다. 역할 하나가 빠진 편성이 나올 수 없다.',
    size: 6,
    roleQuota: { tank: 2, dealer: 2, support: 2 },
  },
};

export const ROSTER_RULE_ORDER: RosterRuleId[] = ['free', 'oneTank', 'sixRoles'];

/** 어떤 규칙에서도 필요한 최대 편성 인원 — 맵 시작지점이 최소 이만큼은 넓어야 모든 규칙을 담는다. */
export const MAX_ROSTER_SIZE = Math.max(...ROSTER_RULE_ORDER.map((id) => ROSTER_RULES[id].size));

const ROLE_LABEL: Record<Role, string> = { tank: '탱커', dealer: '딜러', support: '지원' };

export const DEFAULT_ROSTER_RULE: RosterRuleId = 'free';

/** 모르는 값이 들어와도(옛 스냅샷, 손으로 고친 저장값) 판이 깨지지 않게 기본 규칙으로 떨어뜨린다. */
export function rosterRuleOf(id: RosterRuleId | undefined | null): RosterRule {
  return ROSTER_RULES[id as RosterRuleId] ?? ROSTER_RULES[DEFAULT_ROSTER_RULE];
}

export function tankQuotaOf(id: RosterRuleId | undefined | null): number | null {
  return rosterRuleOf(id).roleQuota?.tank ?? null;
}

/** 이 규칙에서 한 팀이 골라야 하는 기물 수. 인원수를 묻는 곳은 전부 이 함수를 거친다. */
export function rosterSizeOf(id: RosterRuleId | undefined | null): number {
  return rosterRuleOf(id).size;
}

const TANKS = unitTypes.filter((t) => t.role === 'tank');
const NON_TANKS = unitTypes.filter((t) => t.role !== 'tank');
const BY_ROLE: Record<Role, string[]> = {
  tank: TANKS.map((t) => t.id),
  dealer: unitTypes.filter((t) => t.role === 'dealer').map((t) => t.id),
  support: unitTypes.filter((t) => t.role === 'support' && !t.isTurret).map((t) => t.id),
};

export function isTankType(typeId: string): boolean {
  return getUnitType(typeId).role === 'tank';
}

export function tankCount(picks: string[]): number {
  return picks.filter(isTankType).length;
}

export function roleCount(picks: string[], role: Role): number {
  return picks.filter((id) => getUnitType(id).role === role).length;
}

/**
 * 이 기물을 지금 더 담을 수 있는가. **담은 뒤에도 편성을 채울 수 있는지**까지 본다 —
 * 탱커 1명 고정에서 비탱커를 4기 채웠다면 남은 한 자리는 탱커 몫이므로 비탱커 버튼이 잠겨야 한다.
 * "탱커를 2기 담은 다음 확정 단계에서 퇴짜"는 고른 걸 되돌리게 만들 뿐이라 담는 순간 막는다.
 *
 * 두 가지를 함께 본다: (1) 정원이 정해진 역할은 그 수를 넘을 수 없고, (2) 정원이 안 정해진
 * 역할들이 쓸 수 있는 자리는 "전체 − 정해진 정원의 합"만큼뿐이다. (2)가 없으면 탱커 1명 고정에서
 * 비탱커만 5기 담고 나서야 퇴짜를 맞는다.
 */
export function canAddPick(picks: string[], typeId: string, ruleId: RosterRuleId): boolean {
  const rule = rosterRuleOf(ruleId);
  if (picks.length >= rule.size) return false;
  const quota = rule.roleQuota;
  if (!quota) return true;

  const next = [...picks, typeId];
  const quotaRoles = Object.keys(quota) as Role[];
  let quotaTotal = 0;
  for (const role of quotaRoles) {
    const limit = quota[role]!;
    quotaTotal += limit;
    if (roleCount(next, role) > limit) return false;
  }
  const freeUsed = next.filter((id) => !quotaRoles.includes(getUnitType(id).role)).length;
  return freeUsed <= rule.size - quotaTotal;
}

/**
 * 편성이 규칙에 맞는지. 맞으면 null, 아니면 **화면에 그대로 띄울 사유**를 돌려준다 —
 * 검사와 안내문을 한 함수로 묶어야 "버튼은 잠겼는데 왜 잠겼는지 알 수 없는" 상태가 안 생긴다.
 */
export function rosterViolation(picks: string[], ruleId: RosterRuleId): string | null {
  const rule = rosterRuleOf(ruleId);
  if (picks.length !== rule.size) return `${rule.size}기물을 골라야 합니다 (지금 ${picks.length}기)`;
  for (const [role, limit] of Object.entries(rule.roleQuota ?? {}) as [Role, number][]) {
    const have = roleCount(picks, role);
    if (have !== limit) return `${ROLE_LABEL[role]}를 정확히 ${limit}기 넣어야 합니다 (지금 ${have}기)`;
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
export function randomRosterWithQuota(rng: () => number, quota: number | null, size: number = ROSTER_SIZE): string[] {
  if (quota === null) {
    return Array.from({ length: size }, () => unitTypes[Math.floor(rng() * unitTypes.length)].id);
  }
  const roster = [
    ...Array.from({ length: quota }, () => TANKS[Math.floor(rng() * TANKS.length)].id),
    ...Array.from({ length: size - quota }, () => NON_TANKS[Math.floor(rng() * NON_TANKS.length)].id),
  ];
  return shuffled(roster, rng);
}

function shuffled(roster: string[], rng: () => number): string[] {
  for (let i = roster.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [roster[i], roster[j]] = [roster[j], roster[i]];
  }
  return roster;
}

export function randomRoster(rng: () => number, ruleId: RosterRuleId): string[] {
  const rule = rosterRuleOf(ruleId);
  const quota = rule.roleQuota;
  if (!quota) return randomRosterWithQuota(rng, null, rule.size);
  // 탱커만 정원이 있는 규칙은 예전 경로를 그대로 쓴다 — 밸런스 시뮬레이터가 같은 함수로
  // 할당량을 쓸어 보고 있어서(scripts/balanceSim.ts) 뽑는 방식이 갈리면 측정값이 비교 불가능해진다.
  const roles = Object.keys(quota) as Role[];
  if (roles.length === 1 && roles[0] === 'tank') return randomRosterWithQuota(rng, quota.tank!, rule.size);

  const roster: string[] = [];
  for (const role of roles) {
    const pool = BY_ROLE[role];
    for (let i = 0; i < quota[role]!; i++) roster.push(pool[Math.floor(rng() * pool.length)]);
  }
  // 정원이 안 정해진 역할이 남은 자리를 채운다(지금은 그런 규칙이 없지만 규칙을 하나 더 넣을 때
  // 여기서 조용히 짧은 편성이 나오는 걸 막는다).
  const freePool = unitTypes.filter((t) => !roles.includes(t.role)).map((t) => t.id);
  while (roster.length < rule.size && freePool.length > 0) {
    roster.push(freePool[Math.floor(rng() * freePool.length)]);
  }
  return shuffled(roster, rng);
}
