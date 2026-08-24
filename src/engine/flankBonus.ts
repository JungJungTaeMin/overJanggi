import type { UnitInstance } from './types';
import { getUnitType } from '../data/unitTypes';
import { ORTHOGONAL_DIRECTIONS, samePosition, step } from './grid';

/**
 * dealer4(측면 교란형) 패시브의 **유일한 근거**.
 *
 * 해결(attacks.ts)과 화면(조준 하이라이트)이 각자 조건을 적으면 반드시 갈라진다 — 그러면
 * "화면에 +5라고 떴는데 실제로는 안 붙는" 종류의 버그가 나고, 이건 플레이어가 규칙을 오해하게
 * 만드는 버그라 값 하나를 공유해 막는다. 점령 규칙을 `capture.ts`로 뺀 것과 같은 이유다.
 *
 * 이 패시브를 화면에 드러내야 하는 이유는 측정에서 나왔다: 표기 공격력은 5인데 발동률이 59.3%라
 * 실효 공격력이 8.18이다(전체 피해의 36.3%가 이 패시브에서 나온다). 화면이 5만 보여주면
 * 스탯 시트가 실제를 반영하지 못한다.
 */
export function countAdjacentAllies(target: UnitInstance, units: UnitInstance[]): number {
  if (!target.position) return 0;
  return ORTHOGONAL_DIRECTIONS.filter((dir) => {
    const adj = step(target.position!, dir);
    return units.some(
      (u) => u.alive && u.instanceId !== target.instanceId && u.owner === target.owner && u.position && samePosition(u.position, adj),
    );
  }).length;
}

/**
 * 이 공격자가 이 대상을 때릴 때 실제로 얹히는 추가 피해. 조건이 아니거나 해당 기물이 아니면 0.
 *
 * 숫자를 인자로 받지 않고 기물 데이터에서 직접 읽는다 — 밸런스 조정으로 7이 5가 됐을 때
 * 화면만 옛 숫자를 띄우는 일이 없어야 한다.
 */
export function flankBonusFor(attacker: UnitInstance, target: UnitInstance, units: UnitInstance[]): number {
  const passive = getUnitType(attacker.typeId).passive;
  if (passive?.id !== 'dealer4_flank_bonus') return 0;
  if (target.owner === attacker.owner) return 0;
  // 몇 명이 붙어 있어야 "뭉친 것"으로 볼지는 데이터가 정한다 — 조건을 조이는 실험을 코드 수정
  // 없이 돌릴 수 있어야 하고, 화면·해결·AI가 같은 문턱을 본다.
  const needed = passive.payload?.minAdjacentAllies ?? 1;
  return countAdjacentAllies(target, units) >= needed ? (passive.payload?.bonusDamage ?? 0) : 0;
}
