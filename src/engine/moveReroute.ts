import type { Direction, SkillUse, UnitInstance } from './types';
import { getUnitType } from '../data/unitTypes';

export interface RerouteInfo {
  direction: Direction;
  /** 이 스텝(0-indexed)부터 방향이 reroute.direction으로 바뀐다. */
  fromStep: number;
}

/**
 * 이동 도중 경로를 바꿀 수 있는 기술(tank2 돌진, dealer2 추가이동)의 reroute 정보를 계산한다.
 * 엔진의 실제 해결(resolvers/movement.ts)과 UI 미리보기(actionGeometry.ts)가 동일한 규칙을
 * 공유하도록 여기 한 곳에만 둔다.
 *
 * - tank2_charge: "경로 1회 변경 가능" — 첫 1칸 이후부터 reroute 가능(기존 동작 유지).
 * - dealer2_rewind_move: "이동이 끝나고 추가 이동을 하면 방향이 바뀔 수 있어야 함" —
 *   기본 이동속도(moveSpeed)만큼 이동한 뒤, 추가이동 구간부터 reroute 가능.
 */
export function getRerouteInfo(unit: UnitInstance, skillUse: SkillUse | undefined): RerouteInfo | undefined {
  if (!skillUse || typeof skillUse.target !== 'string') return undefined;
  if (unit.typeId === 'tank2' && skillUse.skillId === 'tank2_charge') {
    return { direction: skillUse.target as Direction, fromStep: 1 };
  }
  if (unit.typeId === 'dealer2' && skillUse.skillId === 'dealer2_rewind_move') {
    const typeDef = getUnitType(unit.typeId);
    return { direction: skillUse.target as Direction, fromStep: typeDef.moveSpeed };
  }
  return undefined;
}
