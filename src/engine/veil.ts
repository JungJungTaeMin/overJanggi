import type { Position, UnitInstance } from './types';
import { getUnitType } from '../data/unitTypes';
import { hasActiveEffect } from './statusEffects';

/**
 * **차단막(러너 액티브1) — 이 칸을 지나가는 공격·회복은 지워진다.**
 *
 * 판정이 이 파일 하나뿐인 이유는 방벽에서 이미 겪은 것과 같다: 무엇이 맞고 무엇이 안 맞는지를
 * 여러 곳이 각자 계산하면 **화면의 미리보기와 실제 결과가 갈라지고**, 그 순간 이 표시는 사람을
 * 헛발질하게 만드는 쪽이 된다(aim.ts 첫 주석). 지금 이 규칙을 보는 곳은 세 군데다 —
 * 조준 판정(aim.ts, 해결과 미리보기가 함께 쓴다) · 회복 해결(resolvers/healing.ts) · AI 위협 평가.
 *
 * **방벽과 무엇이 다른가.** 방벽은 *기물 한 명이* 자기에게 오는 직선 공격을 막고 범위 공격은
 * 관통한다. 차단막은 *칸*을 막는다 — 그 칸을 지나거나 그 칸에서 끝나는 것이면 종류를 가리지
 * 않고 전부 지운다. 그래서 범위 공격도, 회복도, **아군의 것까지도** 막힌다.
 *
 * 아군 것을 막는 건 실수가 아니라 값이다. 러너는 못 때리고 못 고치는 대신 판정 자체를 지우는
 * 기물인데, 그 효과에 "우리 편만 통과" 예외를 두면 비용이 쿨타임 5턴뿐인 순수 이득이 된다.
 * 아군 사이에 서면 아군의 사선까지 함께 막히므로 **어디에 서느냐가 곧 이 기술의 값**이 된다.
 *
 * 러너 자신이 선 칸은 덮이지 않는다(자기 기준 직선·대각 1칸 = 8칸, 사용자 규격). 즉 러너 본인은
 * 이 기술로 자신을 지키지 못하고 **주변에 선 기물들**을 지킨다 — 대신 자기 쪽으로 오는 사선은
 * 대개 이 8칸을 통과해야 하므로 결과적으로 함께 막히는 각이 많다.
 */
function veilRadiusOf(unit: UnitInstance): number {
  const skill = getUnitType(unit.typeId).skills.find((s) => s.id === 'support4_veil');
  return skill?.payload.radius ?? 1;
}

/** 이 칸을 덮고 있는 차단막의 시전자. 없으면 undefined. */
export function veilAt(cell: Position, units: UnitInstance[], turnNumber: number): UnitInstance | undefined {
  return units.find((u) => {
    if (!u.alive || !u.position || !hasActiveEffect(u, 'veil', turnNumber)) return false;
    const dx = Math.abs(u.position.x - cell.x);
    const dy = Math.abs(u.position.y - cell.y);
    // 자기 칸(0,0)은 제외 — 8칸이지 9칸이 아니다.
    if (dx === 0 && dy === 0) return false;
    return Math.max(dx, dy) <= veilRadiusOf(u);
  });
}

/**
 * `from`에서 `to`로 가는 판정이 차단막을 지나는가. `from`은 빼고 `to`는 포함해서 본다 —
 * 쏘는 칸·거는 칸 자신이 덮여 있다고 자기 행동이 막히면 러너 옆에 선 아군이 아무것도 못 한다.
 *
 * 직선·대각선 위가 아니면(예: 자기중심 반경 회복의 (2,1) 같은 대상) **도착 칸만** 본다.
 * 그런 판정에는 "지나간다"고 부를 만한 경로 자체가 없기 때문이고, 억지로 경로를 만들면
 * 규칙이 "어떤 칸을 지난다고 치느냐"에 달린 설명 불가능한 것이 된다.
 */
export function veilBetween(
  from: Position,
  to: Position,
  units: UnitInstance[],
  turnNumber: number,
): UnitInstance | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const aligned = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
  if (!aligned) return veilAt(to, units, turnNumber);

  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  for (let i = 1; i <= steps; i++) {
    const found = veilAt({ x: from.x + sx * i, y: from.y + sy * i }, units, turnNumber);
    if (found) return found;
  }
  return undefined;
}
