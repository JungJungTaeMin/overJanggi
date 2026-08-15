import type { BoardConfig, SkillDef, UnitInstance } from './types';
import { isWithinSkillRange, type SkillAxis } from './targeting';

/**
 * **대상 지정 기술의 사거리·축 표.** 사거리를 쓰는 곳이 네 군데(해결 단계 · validation · AI ·
 * UI 대상 선택)라, 각자 숫자를 들고 있으면 반드시 어긋난다 — 실제로 예전에는 AI만 `<= 4`를
 * 하드코딩해 두고 나머지 셋은 사거리를 아예 검사하지 않아서, 데이터의 `range`를 올려도 게임이
 * 전혀 변하지 않았다. 그래서 축은 여기 한 곳에만 두고 거리 값은 기물 데이터의 payload에서 읽는다.
 *
 * 축은 payload가 `Record<string, number>`라 숫자만 담을 수 있어서 데이터에 못 넣고 여기 둔다.
 * `export`인 건 밸런스 스윕 스크립트(scripts/tuneSupport2.ts)가 축을 바꿔 가며 측정하기 위해서다 —
 * 게임 코드에서는 읽기 전용으로 다룬다.
 */
export const SKILL_AXIS: Record<string, { rangeKey: string; axis: SkillAxis }> = {
  // 기획서 "회복 직선4" / "직선 2칸 내 적 1명 구속" — 둘 다 같은 행·열만.
  support2_heal: { rangeKey: 'range', axis: 'orthogonal' },
  support2_root: { rangeKey: 'range', axis: 'orthogonal' },
  // 조준 보조도 같은 사선 규칙을 탄다 — 저격수 힐러의 정체성이 "라인을 맞춰야 한다"는 것이므로,
  // 신규 기술이라고 여기서만 축을 풀어 주면 그 정체성이 무너진다.
  support2_buff: { rangeKey: 'range', axis: 'orthogonal' },
  // 기획서 "대각선 3칸 내 아군과 자리교체" — 정확한 대각선만.
  dealer4_swap: { rangeKey: 'swapRange', axis: 'diagonal' },
  /**
   * tank3 구속은 기획서에 사거리가 없다("적1 1턴 이동불가"). 무제한으로 두면 판 반대편 기물을
   * 묶을 수 있어 명백히 의도 밖이므로 기본값을 정했다: **직선·대각선 3칸**. support2 구속(직선 2)보다
   * 넉넉한 건 쿨타임이 5턴으로 훨씬 길기 때문이고, 축을 both로 푼 건 tank3이 이동 2의 근접
   * 기물이라 직선만으로는 실전에서 거의 못 쓰기 때문이다. 조정 가능한 판단값이다.
   */
  tank3_root: { rangeKey: 'range', axis: 'both' },
};

/** 이 기술이 "판 위의 특정 기물"을 사거리 안에서 골라야 하는 기술인지. 아니면 null. */
export function skillRangeSpec(skill: SkillDef): { range: number; axis: SkillAxis } | null {
  const entry = SKILL_AXIS[skill.id];
  if (!entry) return null;
  const range = skill.payload[entry.rangeKey];
  if (typeof range !== 'number') return null;
  return { range, axis: entry.axis };
}

/**
 * 시전자가 이 기술로 저 대상에게 실제로 닿는지. 사거리를 쓰지 않는 기술이면 항상 true다
 * (대상 종류·생존 검사는 호출하는 쪽 책임).
 */
export function canTargetWithSkill(
  caster: UnitInstance,
  target: UnitInstance,
  skill: SkillDef,
  board: BoardConfig,
): boolean {
  const spec = skillRangeSpec(skill);
  if (!spec) return true;
  if (!caster.position || !target.position) return false;
  return isWithinSkillRange(caster.position, target.position, spec.range, board, spec.axis);
}
