import type { SkillDef, UnitTypeDef } from '../engine/types';
import { skillRangeSpec } from '../engine/skillRange';
import type { SkillAxis } from '../engine/targeting';

/**
 * **기물·기술 수치를 사람이 읽는 문장으로 바꾸는 곳.** 도움말과 대전 화면이 같은 함수를 쓴다 —
 * 각자 문장을 만들면 "도움말에는 직선 3칸이라 적혀 있는데 실제로는 대각선도 된다" 같은 어긋남이
 * 생기고, 이건 플레이어가 규칙을 오해하게 만드는 종류의 버그다.
 *
 * 숫자는 하나도 손으로 적지 않는다. 전부 `unitTypes`의 데이터와 `skillRangeSpec()`에서 읽으므로,
 * 밸런스를 조정하면 화면 문구가 저절로 따라온다.
 */

/** 자기 자신에게 거는 기술은 "닿는 칸"이 없으므로 사거리 그림에서 뺀다. */
export function skillReach(skill: SkillDef): { range: number; axis: SkillAxis } | null {
  const spec = skillRangeSpec(skill);
  if (spec) return spec;
  // 자기중심 범위 기술(support1 범위 회복)은 대상 표에 없고 payload의 반경으로만 표현된다.
  const radius = skill.payload.radius;
  return typeof radius === 'number' && radius > 0 ? { range: radius, axis: 'radius' } : null;
}

export function coinMoveSpeed(typeDef: UnitTypeDef): number | null {
  if (typeDef.passive?.id !== 'support3_coinflip') return null;
  const heads = typeDef.passive.payload?.headsMove;
  return typeof heads === 'number' && heads > typeDef.moveSpeed ? heads : null;
}

/** 동전 앞면일 때의 공격 사거리. 동전이 없거나 사거리가 안 갈리면 null. */
export function coinAttackRange(typeDef: UnitTypeDef): number | null {
  if (typeDef.passive?.id !== 'support3_coinflip') return null;
  const heads = typeDef.passive.payload?.headsRange;
  return typeof heads === 'number' && heads > typeDef.attackShape.range ? heads : null;
}

const AXIS_LABEL: Record<SkillAxis, string> = {
  orthogonal: '직선',
  diagonal: '대각선',
  both: '직선·대각선',
  radius: '반경',
};

/** "직선 4칸 · 대각선 1칸"처럼, 축마다 사거리가 다를 수 있다는 것까지 드러나는 라벨. */
export function attackRangeLabel(typeDef: UnitTypeDef): string {
  const shape = typeDef.attackShape;
  if (!typeDef.canAttack) return '공격 불가';
  if (shape.kind === 'aoe') return `앞 ${shape.range}칸 + 좌우 1칸(범위)`;
  if (shape.axis === 'both' && shape.diagonalRange !== undefined && shape.diagonalRange !== shape.range) {
    return `직선 ${shape.range}칸 · 대각선 ${shape.diagonalRange}칸`;
  }
  const axis = AXIS_LABEL[shape.axis ?? 'orthogonal'];
  // 사거리도 동전으로 갈릴 수 있다(support3) — 이동력 라벨과 같은 형식으로 드러낸다.
  const heads = coinAttackRange(typeDef);
  if (heads !== null && heads !== shape.range) return `${axis} ${shape.range} 또는 ${heads}칸(동전)`;
  return `${axis} ${shape.range}칸`;
}

/**
 * "4 또는 6(동전)"처럼, 공격력도 턴마다 갈릴 수 있다는 것까지 드러나는 라벨.
 *
 * 이걸 안 하면 확률·포탑형만 이동·사거리는 동전 표기인데 공격력만 뒷면 값(4)으로 고정돼 보인다 —
 * 화면이 스탯을 실제보다 낮게 말하는 셈이라, 측면 교란형에서 겪은 것과 같은 종류의 오해를 만든다.
 */
export function attackPowerLabel(typeDef: UnitTypeDef): string {
  if (!typeDef.canAttack) return '—';
  const payload = typeDef.passive?.id === 'support3_coinflip' ? typeDef.passive.payload : undefined;
  const heads = payload?.headsAttack;
  const tails = payload?.tailsAttack;
  if (typeof heads === 'number' && typeof tails === 'number' && heads !== tails) {
    return `${tails} 또는 ${heads}(동전)`;
  }
  return String(typeDef.attack);
}

export function moveRangeLabel(typeDef: UnitTypeDef): string {
  const axis = typeDef.diagonalMove ? '직선·대각선' : '직선';
  const heads = coinMoveSpeed(typeDef);
  return heads !== null ? `${axis} ${typeDef.moveSpeed} 또는 ${heads}칸(동전)` : `${axis} ${typeDef.moveSpeed}칸`;
}

/** 기술의 사거리 한 줄. 자기 자신에게 거는 기술은 사거리라는 개념이 없어 null이다. */
export function skillReachLabel(skill: SkillDef): string | null {
  const reach = skillReach(skill);
  return reach ? `${AXIS_LABEL[reach.axis]} ${reach.range}칸` : null;
}

/** 기술을 언제 다시 쓸 수 있는지 — 쿨타임/충전/토글은 데이터의 gate가 그대로 답이다. */
export function skillGateLabel(skill: SkillDef): string {
  const gate = skill.gate;
  if (gate.type === 'cooldown') return `쿨타임 ${gate.turns}턴`;
  if (gate.type === 'charge') return `충전 ${gate.maxCharges}회`;
  if (gate.type === 'toggle') return '켜고 끄기';
  return '매 턴';
}
