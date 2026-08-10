import type { PriorityEntry, Role, UnitInstance } from './types';
import type { RngFn } from './rng';
import { getUnitType } from '../data/unitTypes';

const ROLE_RANK: Record<Role, number> = { dealer: 0, tank: 1, support: 2 };
const ROLE_LABEL: Record<Role, string> = { dealer: '딜러', tank: '탱커', support: '지원' };

interface Scored {
  unit: UnitInstance;
  moveSpeed: number;
  attack: number;
  roleRank: number;
  role: Role;
}

/**
 * 동률 그룹 내부를 무작위로 섞는다. rngFn()이 항상 0에 가까우면 원래(배열) 순서를 유지하고,
 * 항상 1에 가까우면 완전히 반대 순서가 된다 — 테스트에서 결정론적으로 제어하기 위한 성질.
 */
function pickRandomOrder<T>(items: T[], rngFn: RngFn): T[] {
  const remaining = [...items];
  const result: T[] = [];
  while (remaining.length > 0) {
    const idx = Math.min(remaining.length - 1, Math.max(0, Math.floor(rngFn() * remaining.length)));
    result.push(remaining.splice(idx, 1)[0]);
  }
  return result;
}

/**
 * 턴 우선순위(3.2절/3.2.1절): 이동 Lv(이동속도) 높은 순 → 공격 수치 높은 순 → 역할(딜러>탱커>지원)
 * → 그래도 같으면 시스템이 무작위로 결정. 무작위로 결정된 순서는 해당 턴의 해당 행동 단계에서만
 * 유효하다 — 이동 단계 직전과 공격 단계 직전에 각각 독립적으로 호출해야 하며(이 시점에 죽은 유닛은
 * 자동으로 제외됨), 하나의 결과를 두 단계에 재사용하지 않는다.
 * (판단 필요 항목: 이번 턴 스킬로 얻는 이동속도 버프는 순위 계산에 반영하지 않고 기본 스탯 기준으로 고정한다 —
 *  이동 단계 자체가 이 순서를 써서 진행되므로, 버프 적용 여부를 순위에 반영하면 순환 의존이 생기기 때문.)
 */
export function computeTurnPriority(units: UnitInstance[], rngFn: RngFn): PriorityEntry[] {
  const scored: Scored[] = units
    .filter((u) => u.alive)
    .map((u) => {
      const typeDef = getUnitType(u.typeId);
      return { unit: u, moveSpeed: typeDef.moveSpeed, attack: typeDef.attack, roleRank: ROLE_RANK[typeDef.role], role: typeDef.role };
    });

  scored.sort((a, b) => {
    if (a.moveSpeed !== b.moveSpeed) return b.moveSpeed - a.moveSpeed;
    if (a.attack !== b.attack) return b.attack - a.attack;
    return a.roleRank - b.roleRank;
  });

  const entries: PriorityEntry[] = [];
  let i = 0;
  while (i < scored.length) {
    let j = i + 1;
    while (
      j < scored.length &&
      scored[j].moveSpeed === scored[i].moveSpeed &&
      scored[j].attack === scored[i].attack &&
      scored[j].roleRank === scored[i].roleRank
    ) {
      j++;
    }
    const group = scored.slice(i, j);
    const ordered = group.length > 1 ? pickRandomOrder(group, rngFn) : group;
    for (const g of ordered) {
      const base = `이동Lv${g.moveSpeed} 공격${g.attack} ${ROLE_LABEL[g.role]}`;
      entries.push({ instanceId: g.unit.instanceId, reason: group.length > 1 ? `${base} (동률 → 무작위 결정)` : base });
    }
    i = j;
  }
  return entries;
}
