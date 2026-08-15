import type { BoardConfig, Direction, SkillDef, SkillUse, UnitInstance, UnitTurnPlan } from '../../engine/types';
import { getUnitType } from '../../data/unitTypes';
import { skillRangeSpec } from '../../engine/skillRange';
import { isWithinSkillRange, type SkillAxis } from '../../engine/targeting';
import { plannedDestination } from '../../engine/movePath';

const ALL_DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right', 'upleft', 'upright', 'downleft', 'downright'];
const DIRECTION_LABEL: Record<Direction, string> = {
  up: '위', down: '아래', left: '왼쪽', right: '오른쪽',
  upleft: '↖', upright: '↗', downleft: '↙', downright: '↘',
};

interface Props {
  skill: SkillDef;
  unit: UnitInstance;
  allUnits: UnitInstance[];
  board: BoardConfig;
  /** 사거리는 **이번 턴 도착할 칸** 기준이라, 같은 턴에 계획한 이동까지 봐야 한다. */
  plan: UnitTurnPlan;
  value: SkillUse['target'];
  onChange: (target: string | Direction | undefined) => void;
}

/** 스킬의 targeting 종류에 따라 대상(적/아군 인스턴스 또는 방향)을 고르는 보조 입력. */
export function SkillTargetPicker({ skill, unit, allUnits, board, plan, value, onChange }: Props) {
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

    // 사거리 밖 대상은 **지우지 않고 비활성**으로 남긴다. 목록에서 아예 빼 버리면 "왜 저 기물은
    // 고를 수 없지?"에 답이 없지만, 회색으로 남겨 두면 사거리와 직선 제약을 그 자리에서 배운다.
    const spec = skillRangeSpec(skill);
    const from = spec ? plannedDestination(unit, plan, board) : null;
    const outOfRange = (u: UnitInstance) =>
      !!spec && (!from || !u.position || !isWithinSkillRange(from, u.position, spec.range, board, spec.axis));

    // 축마다 제약이 다르니 라벨도 다르게 — "7칸"만 보여 주면 직선 7칸인지 반경 7칸인지 알 수 없다.
    const AXIS_LABEL: Record<SkillAxis, string> = {
      orthogonal: '직선',
      diagonal: '대각선',
      both: '직선·대각선',
      radius: '반경',
    };
    const axisLabel = spec ? AXIS_LABEL[spec.axis] : '';
    return (
      <>
        <select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">{skill.targeting === 'enemy' ? '적 선택' : '아군 선택'}</option>
          {candidates.map((c) => (
            <option key={c.instanceId} value={c.instanceId} disabled={outOfRange(c)}>
              {getUnitType(c.typeId).name} ({c.position ? `${c.position.x},${c.position.y}` : '전장 밖'})
              {outOfRange(c) ? ' — 사거리 밖' : ''}
            </option>
          ))}
        </select>
        {spec && <span className="skill-range-hint">{axisLabel} {spec.range}칸</span>}
      </>
    );
  }

  return null;
}

export { ALL_DIRECTIONS, DIRECTION_LABEL };
