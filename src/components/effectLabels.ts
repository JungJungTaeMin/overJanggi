/**
 * 상태이상 **표시 이름**의 유일한 출처.
 *
 * 왜 필요한가: 상태이상의 `type`은 엔진 내부 식별자(`veil`, `attackMode`, `root`…)다. 계획
 * 패널은 이걸 손으로 한글 배지로 옮겨 적고 있었지만, 상태 표(UnitStatusList)와 판 위 기물
 * 툴팁(UnitToken)은 그냥 식별자를 그대로 뿌렸다 — 같은 효과가 화면 왼쪽에서는 「차단막」,
 * 오른쪽에서는 `veil`로 보인다. 처음 보는 사람은 그 둘이 같은 것인 줄 모른다.
 *
 * 그래서 이름을 여기 한 곳에 모으고 세 화면이 모두 여기를 읽는다. 새 상태이상을 만들 때
 * 여기를 안 채우면 식별자가 그대로 노출되므로, 빠뜨린 게 화면에서 바로 눈에 띈다.
 */
export const STATUS_LABEL: Record<string, string> = {
  root: '구속',
  stun: '행동불가',
  barrier: '방벽',
  attackMode: '공격모드',
  veil: '차단막',
  pace: '발맞추기',
  buff: '공격 증가',
  // 이 둘은 화면에서 raw id가 새어 나오는 걸 실제로 보고 채웠다 — 방어 강화형이 한 턴 버티는
  // 동안 상태 표에 `hpBuff, moveBonus`라고 떴다. 「모르는 식별자는 그대로 내보낸다」는 아래
  // 규칙이 의도대로 동작한 사례다: 빠뜨린 게 조용히 사라지지 않고 눈에 띄었다.
  hpBuff: '최대 체력 증가',
  moveBonus: '이동력 증가',
  shield: '보호막',
  rewindAnchor: '역행 기준점',
  healedThisTurn: '회복받음',
  autoRegen: '자동 재생',
  coinHeads: '동전 앞면',
  coinTails: '동전 뒷면',
  burn: '화상',
  mark: '표식',
};

/** 모르는 식별자는 감추지 않고 그대로 내보낸다 — 조용히 사라지면 빠진 걸 눈치챌 수 없다. */
export function statusLabel(type: string): string {
  return STATUS_LABEL[type] ?? type;
}
