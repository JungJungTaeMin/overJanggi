import type { Owner } from '../../engine/types';
import { useGameStore } from '../../store/gameStore';
import { getUnitType } from '../../data/unitTypes';
import { REWIND_SKILL_ID } from '../../data/constants';
import { hasActiveEffect } from '../../engine/statusEffects';
import { UnitActionSelector } from './UnitActionSelector';
import { summarizeBaseAction, summarizeSkillMove, summarizeSkillUse } from './planSummary';

interface Props {
  owner: Owner;
  label: string;
}

/**
 * 한 플레이어의 5기물 행동 계획 패널. 디버그 모드이므로 양쪽 패널이 항상 동시에 보인다.
 * 각 기물은 한 줄 요약(이름·HP·현재 행동)으로 접혀 있다가, 클릭하면 그 기물의 편집기가
 * 펼쳐진다 — 10개 기물의 상세 컨트롤이 한꺼번에 쏟아지지 않도록 해 화면을 덜 어지럽힌다.
 */
export function ActionPanel({ owner, label }: Props) {
  const state = useGameStore((s) => s.state);
  const plan = useGameStore((s) => s.plans?.[owner]);
  const setBaseAction = useGameStore((s) => s.setBaseAction);
  const setSkillUse = useGameStore((s) => s.setSkillUse);
  const setSkillMove = useGameStore((s) => s.setSkillMove);
  const selectedUnitId = useGameStore((s) => s.selectedUnitId);
  const setSelectedUnit = useGameStore((s) => s.setSelectedUnit);

  if (!state || !plan) return null;
  const units = state.units.filter((u) => u.owner === owner && !u.isTurret);

  return (
    <div className={`action-panel owner-${owner}`}>
      <h3 className="panel-title">{label}</h3>
      <div className="unit-rows">
        {units.map((unit) => {
          const unitPlan = plan.actions[unit.instanceId] ?? { baseAction: { kind: 'none' } };
          const typeDef = getUnitType(unit.typeId);
          const selected = unit.instanceId === selectedUnitId;
          const hpRatio = unit.maxHp > 0 ? Math.max(0, unit.currentHp / unit.maxHp) : 0;
          const skillSummary = summarizeSkillUse(unit, unitPlan.skillUse);
          const skillMoveSummary = summarizeSkillMove(unitPlan.skillMove);
          const rewindGate = typeDef.skills.find((s) => s.id === REWIND_SKILL_ID)?.gate;
          const rewindMax = rewindGate?.type === 'charge' ? rewindGate.maxCharges : 0;

          return (
            <div key={unit.instanceId} className={`unit-row${selected ? ' selected' : ''}${!unit.alive ? ' dead' : ''}`}>
              <button
                type="button"
                className="unit-row-header"
                onClick={() => setSelectedUnit(selected ? null : unit.instanceId)}
              >
                <span className={`unit-role-dot role-${typeDef.role}`} />
                <span className="unit-name">{typeDef.name}</span>
                {unit.alive ? (
                  <>
                    <span className="hp-bar">
                      <span className="hp-fill" style={{ width: `${hpRatio * 100}%`, background: hpRatio > 0.3 ? '#22c55e' : '#ef4444' }} />
                    </span>
                    <span className="hp-text">
                      {unit.currentHp}/{unit.maxHp}
                    </span>
                    {unit.shieldHp > 0 && <span className="badge badge-shield">보호막 {unit.shieldHp}</span>}
                    {hasActiveEffect(unit, 'root', state.turnNumber) && <span className="badge badge-root">구속</span>}
                    {hasActiveEffect(unit, 'barrier', state.turnNumber) && <span className="badge badge-barrier">방벽</span>}
                    {hasActiveEffect(unit, 'attackMode', state.turnNumber) && <span className="badge badge-attackmode">공격모드</span>}
                    {/* dealer2 시간역행: 접힌 상태에서도 남은 사용량과 기준 체력이 바로 보여야 한다(§9). */}
                    {rewindMax > 0 && (
                      <span className="badge badge-rewind">
                        ⟲ {unit.charges[REWIND_SKILL_ID] ?? 0}/{rewindMax}
                        {unit.rewindSnapshot ? ` · 기준 ${unit.rewindSnapshot.hp}` : ''}
                      </span>
                    )}
                    <span className="unit-action-chip">
                      {summarizeBaseAction(unitPlan.baseAction)}
                      {skillSummary ? ` + ${skillSummary}` : ''}
                      {skillMoveSummary ? ` + ${skillMoveSummary}` : ''}
                    </span>
                  </>
                ) : (
                  <span className="unit-action-chip dead">부활까지 {unit.respawnTurnsRemaining}턴</span>
                )}
              </button>
              {selected && unit.alive && (
                <div className="unit-row-editor">
                  <UnitActionSelector
                    unit={unit}
                    allUnits={state.units}
                    board={state.board}
                    turnNumber={state.turnNumber}
                    plan={unitPlan}
                    onBaseAction={(a) => setBaseAction(owner, unit.instanceId, a)}
                    onSkillUse={(s) => setSkillUse(owner, unit.instanceId, s)}
                    onSkillMove={(m) => setSkillMove(owner, unit.instanceId, m)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
