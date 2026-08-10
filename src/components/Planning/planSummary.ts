import type { BaseAction, SkillMove, SkillUse, UnitInstance } from '../../engine/types';
import { getUnitType } from '../../data/unitTypes';
import { DIRECTION_LABEL } from './SkillTargetPicker';

/** 유닛 카드가 접혀 있을 때도 한눈에 보이는 행동 요약 문구. */
export function summarizeBaseAction(action: BaseAction): string {
  if (action.kind === 'move') return `이동 ${DIRECTION_LABEL[action.direction]} ${action.distance}칸`;
  if (action.kind === 'attack') return `공격 ${DIRECTION_LABEL[action.direction]}`;
  if (action.kind === 'attackAt') return `공격 (${action.targetCell.x},${action.targetCell.y})`;
  return '대기';
}

/**
 * 기술이 만든 이동은 기본 행동(공격)과 별개의 부가 요소라 요약에도 따로 붙인다.
 * 칸수는 기술 사용 횟수만큼 구간이 나뉘므로 "기술 이동 3칸(2회)"처럼 함께 보여 준다.
 */
export function summarizeSkillMove(skillMove?: SkillMove): string | null {
  if (!skillMove || skillMove.path.length === 0) return null;
  const uses = skillMove.segmentLengths?.filter((n) => n > 0).length ?? 1;
  return `기술 이동 ${DIRECTION_LABEL[skillMove.path[0]]} ${skillMove.path.length}칸 (${uses}회)`;
}

export function summarizeSkillUse(unit: UnitInstance, skillUse?: SkillUse): string | null {
  if (!skillUse) return null;
  const typeDef = getUnitType(unit.typeId);
  const skill = typeDef.skills.find((s) => s.id === skillUse.skillId);
  return skill ? skill.name : null;
}
