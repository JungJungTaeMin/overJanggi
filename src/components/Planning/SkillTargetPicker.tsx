import type { Direction, SkillDef, SkillUse, UnitInstance } from '../../engine/types';
import { getUnitType } from '../../data/unitTypes';

const ALL_DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right', 'upleft', 'upright', 'downleft', 'downright'];
const DIRECTION_LABEL: Record<Direction, string> = {
  up: '위', down: '아래', left: '왼쪽', right: '오른쪽',
  upleft: '↖', upright: '↗', downleft: '↙', downright: '↘',
};

interface Props {
  skill: SkillDef;
  unit: UnitInstance;
  allUnits: UnitInstance[];
  value: SkillUse['target'];
  onChange: (target: string | Direction | undefined) => void;
}

/** 스킬의 targeting 종류에 따라 대상(적/아군 인스턴스 또는 방향)을 고르는 보조 입력. */
export function SkillTargetPicker({ skill, unit, allUnits, value, onChange }: Props) {
  // support3_turret은 targeting:'cell'이지만 실제로는 "앞칸" 방향을 지정한다(preAttack.ts 참고)
  if (skill.id === 'support3_turret') {
    return (
      <select value={(value as string) ?? ''} onChange={(e) => onChange((e.target.value || undefined) as Direction | undefined)}>
        <option value="">방향 선택</option>
        {ALL_DIRECTIONS.map((d) => (
          <option key={d} value={d}>
            {DIRECTION_LABEL[d]}
          </option>
        ))}
      </select>
    );
  }

  if (skill.targeting === 'enemy' || skill.targeting === 'ally') {
    const candidates = allUnits.filter(
      (u) => u.alive && (skill.targeting === 'enemy' ? u.owner !== unit.owner : u.owner === unit.owner) && u.instanceId !== unit.instanceId,
    );
    return (
      <select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{skill.targeting === 'enemy' ? '적 선택' : '아군 선택'}</option>
        {candidates.map((c) => (
          <option key={c.instanceId} value={c.instanceId}>
            {getUnitType(c.typeId).name} ({c.position ? `${c.position.x},${c.position.y}` : '전장 밖'})
          </option>
        ))}
      </select>
    );
  }

  return null;
}

export { ALL_DIRECTIONS, DIRECTION_LABEL };
