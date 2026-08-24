import type { BaseAction, BoardConfig, Direction, SkillMove, SkillUse, UnitInstance, UnitTurnPlan } from '../../engine/types';
import { getUnitType } from '../../data/unitTypes';
import {
  attackOrigin,
  isSkillMovePlanning,
  moveCapacity,
  movePlanFromSegments,
  normalizeMoveSegments,
  previewMoveSteps,
} from './actionGeometry';
import {
  canPlanSkillMove,
  inSegmentTurnAllowance,
  moveSegmentCapacities,
  plannedChargeUses,
  resolveMovePath,
  resolveSegmentLengths,
  wholeExtraMoveUses,
} from '../../engine/movePath';
import { isWalkable, samePosition, step } from '../../engine/grid';
import { hasActiveEffect, sumMagnitude } from '../../engine/statusEffects';
import { SkillTargetPicker, ALL_DIRECTIONS, DIRECTION_LABEL } from './SkillTargetPicker';
import { skillReachLabel } from '../statLabels';

const ORTHOGONAL: Direction[] = ['up', 'down', 'left', 'right'];
const DIAGONAL: Direction[] = ['upleft', 'upright', 'downleft', 'downright'];

/** 되돌아가는 방향 — "꺾는다"에 해당하지 않으므로 경로 변경 기본값에서 제외한다. */
const OPPOSITE: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
  upleft: 'downright',
  upright: 'downleft',
  downleft: 'upright',
  downright: 'upleft',
};

const REWIND_SKILL = 'dealer2_rewind_move';

/** 한 번의 직진(같은 방향으로 연속한 칸). 한 번의 이동은 원칙적으로 직진 하나로만 이뤄진다. */
interface MoveRun {
  direction: Direction;
  length: number;
}

function directionsForAxis(axis?: 'orthogonal' | 'diagonal' | 'both'): Direction[] {
  if (axis === 'diagonal') return DIAGONAL;
  if (axis === 'both') return ALL_DIRECTIONS;
  return ORTHOGONAL;
}

interface Props {
  unit: UnitInstance;
  allUnits: UnitInstance[];
  board: BoardConfig;
  turnNumber: number;
  plan: UnitTurnPlan;
  onBaseAction: (a: BaseAction) => void;
  onSkillUse: (s: SkillUse | undefined) => void;
  onSkillMove: (skillMove: SkillMove | undefined) => void;
}

/** 펼쳐진(선택된) 기물 한 개의 상세 행동 편집기. 이름/HP/상태는 ActionPanel의 행 헤더가 이미 보여준다. */
export function UnitActionSelector({ unit, allUnits, board, turnNumber, plan, onBaseAction, onSkillUse, onSkillMove }: Props) {
  const typeDef = getUnitType(unit.typeId);
  const baseAction = plan.baseAction;
  const skillUse = plan.skillUse;
  const selectedSkill = skillUse ? typeDef.skills.find((s) => s.id === skillUse.skillId) : undefined;

  const moveDirections = typeDef.diagonalMove ? ALL_DIRECTIONS : ORTHOGONAL;
  /**
   * 이번 턴 **해결 시점의** 공격 모드 상태. validation.ts와 같은 계산이다 — 토글은 preAttack에서
   * 즉시 반영되므로 "지금 켜져 있는가"가 아니라 "이번 턴에 켜져 있을 것인가"가 이동 가능 여부를
   * 정한다. 화면이 현재 상태만 보고 말하면 토글을 계획한 턴에 정반대로 안내하게 된다.
   */
  const attackModeWillBeOn =
    hasActiveEffect(unit, 'attackMode', turnNumber) !== (plan.skillUse?.skillId === 'dealer3_attack_mode');

  const attackDirections = directionsForAxis(typeDef.attackShape.axis);

  // dealer2 시간 역행 관련 상태
  const rewindSkill = typeDef.skills.find((s) => s.id === REWIND_SKILL);
  const maxCharges = rewindSkill?.gate.type === 'charge' ? rewindSkill.gate.maxCharges : 0;
  const chargesLeft = unit.charges[REWIND_SKILL] ?? 0;
  const rewindActive = skillUse?.skillId === REWIND_SKILL;
  const rewindUses = rewindActive ? plannedChargeUses(unit, skillUse) : 0;
  const chargesAfter = chargesLeft - rewindUses;

  /**
   * **기술 이동**: 기본 행동을 공격으로 두고, "이동을 한 번 더" 주는 기술이 만든 이동만으로 움직이는
   * 모드. 이때 이동 구간은 기술 몫(1회 = 이동 Lv)뿐이고 **기본 이동 구간은 아예 없다** —
   * dealer2가 공격을 계획하면 "이동 3 + 기술 3×3"이 아니라 기술 3회분(9칸)만 움직인다.
   */
  const skillOnly = isSkillMovePlanning(plan);
  const skillMovePossible = canPlanSkillMove(unit, skillUse);
  const showPathEditor = baseAction.kind === 'move' || (skillOnly && skillMovePossible);

  // 이번 턴 이동 가능 칸수(기술 보너스 포함)와 현재 계획된 스텝별 경로
  const capacity = moveCapacity(unit, turnNumber, plan);
  const currentPath = resolveMovePath(unit, plan, capacity);

  // 경로를 "이동 한 번" 단위 구간으로 끊어, 기본 이동 도착점과 기술을 n회 쓴 도착점을 각각 보여준다.
  // 구간은 서로 독립이라 길이도 제각각일 수 있다(기본 아래3 / 기술1 왼쪽2 / 기술2 아래3 …).
  const segCapacities = moveSegmentCapacities(unit, skillUse, sumMagnitude(unit, 'moveBonus', turnNumber));
  /** 이번 턴 "이동을 한 번 더" 받은 횟수 — 0보다 크면 1번 구간부터는 칸수를 고를 수 없다. */
  const extraMoveUses = wholeExtraMoveUses(unit, skillUse);
  /** 구간 *안에서* 방향을 꺾을 수 있는 횟수(tank2 돌진만 1) — 기본은 0, 즉 한 구간은 한 방향 직진이다. */
  const turnAllowance = inSegmentTurnAllowance(unit, skillUse);
  const segLengths = resolveSegmentLengths(unit, plan, currentPath.length);
  /** 구간 번호 → 그 구간의 첫 스텝이 전체 경로에서 몇 번째인지 */
  const segStart = segLengths.map((_, i) => segLengths.slice(0, i).reduce((a, b) => a + b, 0));

  // 보드 미리보기(previewMoveSteps)와 같은 계산을 그대로 쓴다 — 여기서 따로 좌표를 더하면 장애물에
  // 막혀 실제로는 갈 수 없는 칸을 "도착"이라고 표시해 패널과 보드가 어긋난다.
  const previewSteps = previewMoveSteps(unit, allUnits, board, plan, turnNumber);
  const segmentArrivals = new Map<number, string>(
    previewSteps.filter((s) => s.isSegmentEnd).map((s) => [s.segmentIndex, `(${s.to.x}, ${s.to.y})`]),
  );
  /** 장애물·유닛에 막혀 실제로는 실행되지 않는 첫 스텝 번호(없으면 null). */
  const blockedFromStep = previewSteps.length < currentPath.length ? previewSteps.length : null;

  // 기술로 파고들면 공격은 "지금 서 있는 칸"이 아니라 도착 칸에서 나간다(이동 1단계 → 공격 3단계).
  const firePosition = attackOrigin(unit, allUnits, board, plan, turnNumber);
  const movedBeforeAttack = !!firePosition && !!unit.position && !samePosition(firePosition, unit.position);

  function skillDisabled(skillId: string): boolean {
    const skill = typeDef.skills.find((s) => s.id === skillId);
    if (!skill) return true;
    if (skill.gate.type === 'cooldown') return (unit.cooldowns[skillId] ?? 0) > 0;
    if (skill.gate.type === 'charge') return (unit.charges[skillId] ?? 0) <= 0;
    return false;
  }

  /** 현재 계획을 구간별 방향 배열(= 편집 단위)로 펼친다. */
  function currentSegments(): Direction[][] {
    return segLengths.map((len, i) => currentPath.slice(segStart[i], segStart[i] + len));
  }

  /**
   * 구간 배열을 계획에 반영한다. 엔진은 평평한 `path`만 보고 움직이고, `segmentLengths`는
   * "어디까지가 기본 이동이고 어디부터가 기술 n회째인지"를 보존한다.
   * 기술 이동 모드에서는 기본 행동(공격)을 건드리지 않고 `skillMove`에만 경로를 담는다.
   */
  function commitSegments(segments: Direction[][]) {
    // 추가 이동 구간의 칸수는 방향과 장애물이 정한다 — 어떤 편집이든 여기서 다시 계산해 맞춘다.
    const normalized = normalizeMoveSegments(unit, board, skillUse, turnNumber, segments);
    const patch = movePlanFromSegments(normalized, skillOnly);
    if (patch.kind === 'skill') onSkillMove(patch.skillMove);
    else onBaseAction(patch.action);
  }

  /** 한 구간을 "같은 방향으로 연속한 칸 묶음"(= 한 번의 직진)으로 나눈다. */
  function runsOfSegment(seg: number): MoveRun[] {
    const runs: MoveRun[] = [];
    for (const dir of currentSegments()[seg] ?? []) {
      const last = runs[runs.length - 1];
      if (last && last.direction === dir) last.length += 1;
      else runs.push({ direction: dir, length: 1 });
    }
    return runs;
  }

  /** 구간별 직진 묶음 배열을 다시 평평한 경로로 되돌려 계획에 반영한다. */
  function commitRuns(runsBySeg: MoveRun[][]) {
    commitSegments(runsBySeg.map((runs) => runs.flatMap((r) => Array<Direction>(r.length).fill(r.direction))));
  }

  function updateRun(seg: number, runIndex: number, patch: Partial<MoveRun>) {
    const bySeg = segCapacities.map((_, i) => runsOfSegment(i));
    const runs = [...(bySeg[seg] ?? [])];
    const current = runs[runIndex] ?? { direction: 'up' as Direction, length: 0 };
    const next = { ...current, ...patch };
    if (next.length <= 0 || !next.direction) runs.splice(runIndex, 1); // 0칸·방향 없음 = 이 직진을 없앤다
    else runs[runIndex] = next;
    bySeg[seg] = runs;
    commitRuns(bySeg);
  }

  /**
   * tank2 돌진처럼 경로 변경이 허용될 때, 구간 안에 두 번째 직진을 추가한다.
   * 새 직진의 방향은 반드시 **앞 직진과 꺾이는 방향**이어야 한다 — 경로는 평평한 방향 배열로
   * 저장되므로 같은 방향(또는 되돌아가는 반대 방향)을 넣으면 runsOfSegment가 도로 하나로
   * 합쳐 버려서 UI에 아무 변화도 나타나지 않는다.
   */
  function addRun(seg: number) {
    const bySeg = segCapacities.map((_, i) => runsOfSegment(i));
    const runs = [...(bySeg[seg] ?? [])];
    const used = runs.reduce((a, r) => a + r.length, 0);
    if (used >= (segCapacities[seg] ?? 0)) return;
    const prev = runs[runs.length - 1]?.direction;
    const bendable = moveDirections.filter((d) => d !== prev && d !== OPPOSITE[prev as Direction]);
    // 꺾는 지점(= 지금까지의 도착 칸)에서 실제로 한 칸 갈 수 있는 방향을 먼저 고른다.
    // 그렇지 않으면 벽에 붙은 기물이 곧장 "막힘"으로 시작하는 쓸모없는 기본값을 받게 된다.
    const from = previewSteps[(segStart[seg] ?? 0) + used - 1]?.to ?? unit.position;
    const others = allUnits.filter((u) => u.instanceId !== unit.instanceId);
    const bent =
      (from && bendable.find((d) => isWalkable(step(from, d), board, others))) ?? bendable[0] ?? moveDirections[0];
    runs.push({ direction: bent, length: 1 });
    bySeg[seg] = runs;
    commitRuns(bySeg);
  }

  return (
    <div className="editor-body">
      <div className="editor-row">
        <span className="editor-label">위치</span>
        <span>{unit.position ? `(${unit.position.x}, ${unit.position.y})` : '전장 밖'}</span>
      </div>

      <div className="editor-row">
        <span className="editor-label">행동</span>
        <select
          value={baseAction.kind}
          onChange={(e) => {
            const kind = e.target.value as BaseAction['kind'];
            if (kind === 'move') onBaseAction({ kind: 'move', direction: 'up', distance: 1, path: ['up'] });
            else if (kind === 'attack') onBaseAction({ kind: 'attack', direction: 'up' });
            else onBaseAction({ kind: 'none' });
          }}
        >
          <option value="none">행동 없음</option>
          <option value="move">이동</option>
          {typeDef.canAttack && <option value="attack">공격</option>}
        </select>

        {/* 공격 항목이 그냥 없으면 "왜 안 보이지"가 된다. 못 하는 게 아니라 **원래 못 하는 기물**이라는
            걸 말해 줘야 한다 — 이 기물의 정체성(공격을 포기한 순수 유틸)이기도 하다. */}
        {!typeDef.canAttack && <span className="editor-hint">이 기물은 공격을 못 합니다 — 기술로만 싸웁니다.</span>}

        {/* 공격 모드는 켜면 이동이 막힌다(validation.ts). 배지가 "켜짐"만 알려 주면 왜 이동 칸이
            사라졌는지 알 수 없어서, 대가를 이 자리에서 같이 말한다. 켜고 끄는 건 같은 턴에 즉시
            반영되므로 이번 턴 계획까지 포함해 판정한다. */}
        {typeDef.id === 'dealer3' && (
          <span className="editor-hint">
            {attackModeWillBeOn ? '공격 모드 켜짐 — 이번 턴 이동 불가, 공격만 가능합니다.' : '공격 모드 꺼짐 — 이번 턴 이동만 가능, 공격 불가입니다.'}
          </span>
        )}

        {baseAction.kind === 'attack' && (
          <>
            <select value={baseAction.direction} onChange={(e) => onBaseAction({ ...baseAction, direction: e.target.value as Direction })}>
              {attackDirections.map((d) => (
                <option key={d} value={d}>
                  {DIRECTION_LABEL[d]}
                </option>
              ))}
            </select>
            <span className="editor-hint">
              {movedBeforeAttack && firePosition
                ? `기술 이동으로 도착한 (${firePosition.x}, ${firePosition.y})에서 쏩니다 (또는 보드에서 주황 칸 클릭).`
                : '(또는 보드에서 주황 칸 클릭)'}
            </span>
          </>
        )}
      </div>

      {/* 기본 행동이 공격이어도, "이동을 한 번 더" 주는 기술을 쓰면 그 기술이 이동을 맡는다. */}
      {skillOnly && skillMovePossible && (
        <div className="skillmove-note">
          ⇢ 기본 행동이 <strong>공격</strong>이라 이동은 전부 기술 몫입니다 — 기본 이동({typeDef.moveSpeed}칸)은
          쓰지 않고 기술이 준 {capacity}칸({extraMoveUses}회 × {typeDef.moveSpeed}칸)만 움직인 뒤, 그 도착 칸에서 공격합니다.
        </div>
      )}

      {/* tank2 돌진은 "경로의 적"을 실제로 밟고 지나가는 기술이라, 경로에 적을 그대로 넣어도 된다는
          점을 미리 알려 준다(아군·장애물은 여전히 막는다는 것까지). */}
      {showPathEditor && unit.typeId === 'tank2' && skillUse?.skillId === 'tank2_charge' && (
        <div className="dash-note">
          ⇉ <strong>돌진</strong> — 경로 위의 <strong>적을 밟고 지나가며</strong> 실제 이동한 칸수만큼 피해를 줍니다.
          아군과 장애물은 그대로 막고, 밟은 적 위에서는 멈출 수 없어 그 앞 칸까지 물러납니다.
        </div>
      )}

      {/* 경로 편집: 한 번의 이동 = 한 방향 직진. 방향을 바꾸려면 dealer2처럼 "이동을 한 번 더" 주는
          기술로 구간을 넘기거나, tank2 돌진처럼 경로 변경을 허용하는 기술을 써야 한다. */}
      {showPathEditor && (
        <div className="move-path-editor">
          <div className="editor-row">
            <span className="editor-label">경로</span>
            <span className="editor-hint">
              총 {currentPath.length}칸 / 최대 {capacity}칸{' '}
              {skillOnly
                ? `(기술 ${extraMoveUses}회 × ${typeDef.moveSpeed}칸 — 기본 이동 없음)`
                : `(기본 ${typeDef.moveSpeed}${capacity > typeDef.moveSpeed ? ` + 추가 ${capacity - typeDef.moveSpeed}` : ''})`}{' '}
              — 보드에서 초록 칸을 클릭하면 아직 비어 있는 구간이 하나씩 채워집니다.
            </span>
          </div>
          {/* 구간별 블록: 한 구간 = "이동 한 번" = 한 방향으로 직진. 방향을 바꾸려면 다음 구간으로
              넘어가야 하고(dealer2 추가 이동), 구간 안에서 꺾는 건 tank2 돌진처럼 경로 변경을
              허용하는 기술을 쓸 때뿐이다. */}
          {segCapacities.map((segCap, seg) => {
            // 기술 이동 모드에서는 기본 이동 구간(0번)을 아예 쓰지 않으므로 편집기에서도 감춘다.
            if (skillOnly && seg === 0) return null;
            const runs = runsOfSegment(seg);
            const used = segLengths[seg] ?? 0;
            const maxRuns = 1 + (seg === 0 ? turnAllowance : 0);
            const segEnd = (segStart[seg] ?? 0) + used;
            const isBlocked = blockedFromStep !== null && blockedFromStep < segEnd;
            const rows = runs.length > 0 ? runs : [{ direction: '' as Direction | '', length: 0 }];
            // 추가 이동은 칸수를 고를 수 없다 — 방향만 정하면 이동 Lv만큼(막히면 그 앞 칸까지) 간다.
            const fixedLength = seg > 0 && extraMoveUses > 0;
            return (
              <div key={seg}>
                <div className={`move-segment-head${seg > 0 ? ' extra' : ''}`}>
                  {seg === 0 ? '기본 이동' : `기술 ${seg}회 사용 — 추가 이동`} ({used}/{segCap}칸)
                  {fixedLength && used > 0 && used < segCap && ' — 장애물 앞까지'}
                </div>
                {rows.map((run, r) => {
                  const otherCells = used - (runs[r]?.length ?? 0);
                  return (
                    <div key={r} className={`move-step-row${seg > 0 ? ' extra' : ''}`}>
                      <span className="move-step-label">{r === 0 ? '방향' : '꺾어서'}</span>
                      <select
                        value={run.direction}
                        onChange={(e) =>
                          updateRun(seg, r, {
                            direction: e.target.value as Direction,
                            length: Math.max(1, run.length),
                          })
                        }
                      >
                        <option value="">— 이동 안 함</option>
                        {moveDirections.map((d) => (
                          <option key={d} value={d}>
                            {DIRECTION_LABEL[d]}
                          </option>
                        ))}
                      </select>
                      {fixedLength ? (
                        <span className="move-fixed-length">{run.length || segCap}칸 고정</span>
                      ) : (
                        <select
                          value={run.length}
                          disabled={!run.direction}
                          onChange={(e) => updateRun(seg, r, { length: Number(e.target.value) })}
                        >
                          {Array.from({ length: segCap - otherCells + 1 }, (_, n) => (
                            <option key={n} value={n}>
                              {n}칸
                            </option>
                          ))}
                        </select>
                      )}
                      {r === rows.length - 1 && segmentArrivals.has(seg) && (
                        <span className={`move-arrival${seg > 0 ? ' extra' : ''}`}>
                          {seg === 0 ? '기본 이동 도착' : `기술 ${seg}회 도착`} {segmentArrivals.get(seg)}
                        </span>
                      )}
                    </div>
                  );
                })}
                {isBlocked && (
                  <div className="move-step-row">
                    <span className="move-arrival blocked">막힘 — 이 구간을 끝까지 가지 못합니다</span>
                  </div>
                )}
                {runs.length < maxRuns && used > 0 && used < segCap && (
                  <button type="button" className="btn-step-add" onClick={() => addRun(seg)}>
                    + 경로 변경 ({selectedSkill?.name ?? '기술'} — 1회 가능)
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {typeDef.skills.length > 0 && (
        <div className="editor-row">
          <span className="editor-label">기술</span>
          <select value={skillUse?.skillId ?? ''} onChange={(e) => onSkillUse(e.target.value ? { skillId: e.target.value } : undefined)}>
            <option value="">기술 없음</option>
            {typeDef.skills.map((s) => (
              <option key={s.id} value={s.id} disabled={skillDisabled(s.id)}>
                {s.name}
                {/* 사거리는 고르기 **전에** 보여야 한다 — 고르고 나서 대상 목록이 비어 있는 걸 보고
                    "안 닿는구나"를 알게 되면 그 클릭이 통째로 낭비다. 도움말과 같은 함수를 쓴다. */}
                {skillReachLabel(s) ? ` · ${skillReachLabel(s)}` : ''}
                {s.gate.type === 'cooldown' && (unit.cooldowns[s.id] ?? 0) > 0 ? ` (쿨타임 ${unit.cooldowns[s.id]})` : ''}
                {s.gate.type === 'charge' ? ` (충전 ${unit.charges[s.id] ?? 0}/${s.gate.maxCharges})` : ''}
              </option>
            ))}
          </select>

          {selectedSkill && selectedSkill.id !== REWIND_SKILL && selectedSkill.targeting !== 'self' && selectedSkill.targeting !== 'none' && (
            <SkillTargetPicker
              skill={selectedSkill}
              unit={unit}
              allUnits={allUnits}
              board={board}
              plan={plan}
              value={skillUse?.target}
              onChange={(target) => onSkillUse({ skillId: selectedSkill.id, target })}
            />
          )}
        </div>
      )}

      {/* dealer2 시간 역행 전용 패널(§8.1) */}
      {rewindSkill && (
        <div className={`rewind-panel${rewindActive ? ' active' : ''}`}>
          <div className="rewind-header">
            <span className="rewind-title">시간 역행 — 추가 이동 (1회 = {typeDef.moveSpeed}칸)</span>
            <span className="rewind-charges">
              남은 사용량 {chargesLeft}/{maxCharges}
              {rewindActive && rewindUses > 0 ? ` → 사용 후 ${chargesAfter}/${maxCharges}` : ''}
            </span>
          </div>

          <div className="rewind-anchor-info">
            {unit.rewindSnapshot ? (
              <>
                기준점 ⟲ ({unit.rewindSnapshot.position.x}, {unit.rewindSnapshot.position.y}) · 기준 체력{' '}
                <strong>{unit.rewindSnapshot.hp}</strong> — 충전을 모두 쓰면 이 위치와 체력으로 돌아갑니다.
              </>
            ) : (
              <>기준점 없음 — 처음 사용하는 순간의 위치와 체력이 자동으로 기준점이 됩니다.</>
            )}
          </div>

          {rewindActive && (
            <div className="editor-row">
              <span className="editor-label">사용량</span>
              <select
                value={rewindUses}
                onChange={(e) => onSkillUse({ skillId: REWIND_SKILL, amount: Number(e.target.value) })}
              >
                {Array.from({ length: chargesLeft }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}회 사용 (추가 {n * typeDef.moveSpeed}칸)
                  </option>
                ))}
              </select>
              <span className="editor-hint">
                1회 사용 = 이동을 한 번 더 = {typeDef.moveSpeed}칸 추가 (한 턴에 최대 {maxCharges}회 ={' '}
                {/* 기본 행동이 공격이면 기본 이동 몫이 없으므로 총합도 기술 몫뿐이다. */}
                {(skillOnly ? 0 : typeDef.moveSpeed) + maxCharges * typeDef.moveSpeed}칸
                {skillOnly ? ' — 기본 행동이 공격이라 기본 이동은 빠집니다' : ''}).
              </span>
            </div>
          )}

          {rewindActive && chargesAfter === 0 && (
            <p className="rewind-warning">
              ⚠ 이번 사용으로 충전이 0이 됩니다 — <strong>이번 턴 공격 단계가 끝난 직후</strong> 기준점
              {unit.rewindSnapshot
                ? ` (${unit.rewindSnapshot.position.x}, ${unit.rewindSnapshot.position.y}) · 체력 ${unit.rewindSnapshot.hp}`
                : ' (이번 턴 시작 위치·체력)'}
              으로 복귀하고 충전이 {maxCharges}회로 초기화됩니다.
            </p>
          )}

          <div className="rewind-buttons">
            <button
              type="button"
              className="btn-rewind-use"
              disabled={chargesLeft <= 0 || rewindActive}
              onClick={() => onSkillUse({ skillId: REWIND_SKILL, amount: 1 })}
            >
              사용
            </button>
            <button type="button" className="btn-rewind-cancel" disabled={!rewindActive} onClick={() => onSkillUse(undefined)}>
              취소
            </button>
            <button
              type="button"
              className="btn-rewind-normal"
              disabled={!rewindActive}
              onClick={() => {
                // 기술을 빼면 추가 구간이 통째로 사라지므로 기본 이동 구간만 남긴다
                // (그대로 두면 이동 상한을 넘겨 계획 전체가 무효화된다).
                onSkillUse(undefined);
                if (baseAction.kind === 'move') commitSegments(currentSegments().slice(0, 1));
                else onSkillMove(undefined); // 기술 이동은 기술이 사라지면 성립하지 않는다
              }}
            >
              일반 이동으로 변경
            </button>
          </div>
        </div>
      )}

      {(baseAction.kind !== 'none' || skillUse || plan.skillMove) && (
        <button
          type="button"
          className="btn-clear"
          onClick={() => {
            onBaseAction({ kind: 'none' });
            onSkillUse(undefined);
            onSkillMove(undefined);
          }}
        >
          행동 초기화
        </button>
      )}
    </div>
  );
}
