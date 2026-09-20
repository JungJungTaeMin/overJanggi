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
  /**
   * 밀치기는 축이 both여야 **한다** — 여기서 orthogonal로 조이면 미는 방향이 상하좌우 4개뿐이라
   * 점령지 모서리에 선 적을 밖으로 못 빼내는 각이 생긴다. both면 대상이 항상 정확한 직선·대각선
   * 위에 있으므로 "시전자 반대 방향"이 8방향 중 하나로 유일하게 정해진다 — 미는 방향을 따로
   * 고르게 하지 않아도 되는 이유이자, 이 축이 기하학적 전제인 이유다(resolvers/preAttack.ts).
   */
  tank4_shove: { rangeKey: 'range', axis: 'both' },
  /**
   * 발맞추기는 **직선 1칸(총 4칸)**이다(사용자 결정). 대각을 열면 8칸이 되어 "누군가는 늘 옆에
   * 있는" 기술이 되는데, 그러면 쿨타임 2턴짜리 상시 버프와 다를 게 없다. 직선 4칸이면 러너가
   * 아군의 바로 옆에 서 주어야 하고, 그 자리를 잡는 것 자체가 이 기물의 이번 턴 이동을 쓴다.
   */
  support4_pace: { rangeKey: 'range', axis: 'orthogonal' },
  /**
   * 갈고리는 밀치기와 **같은 이유로** both다. 대상이 정확한 직선·대각선 위에 있어야 "나에게로
   * 가까워지는 방향"이 8방향 중 하나로 유일하게 정해지고, 그래야 끌어오는 경로를 따로 고르게
   * 하지 않아도 된다. 이건 취향이 아니라 기하학적 전제다(resolvers/preAttack.ts).
   */
  tank5_hook: { rangeKey: 'range', axis: 'both' },
  /**
   * 전송은 사거리가 6으로 길다. 축을 both로 조인 것이 그 대가다 — 판 절반을 가로질러 부를 수
   * 있는 대신, **부를 아군과 선을 맞춰 서야** 한다. 축까지 풀면 "사거리 6 안의 아무나"가 되어
   * 이 기물이 자리를 잡을 이유가 사라진다.
   */
  support5_recall: { rangeKey: 'range', axis: 'both' },
  // 표식은 조준 보조의 거울상이지만 축은 both다. 조준 보조가 직선인 건 support2가 "긴 사선을
  // 맞추는 저격수"라는 정체성 때문이고, 표식형에는 그런 정체성이 없다 — 대신 사거리가 4로 짧다.
  support6_mark: { rangeKey: 'range', axis: 'both' },
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
