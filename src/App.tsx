import { useEffect, useMemo, useState } from 'react';
import type { Direction, Owner, Position, UnitTurnPlan } from './engine/types';
import { useGameStore } from './store/gameStore';
import { DIFFICULTY_PROFILES } from './ai/difficulty';
import { ModeMenu } from './components/Menu/ModeMenu';
import { leaveOnline } from './online/netBridge';
import { getUnitType } from './data/unitTypes';
import { samePosition } from './engine/grid';
import { canPlanSkillMove } from './engine/movePath';
import { UnitPicker } from './components/DraftSetup/UnitPicker';
import { PlacementScreen } from './components/DraftSetup/PlacementScreen';
import { Board } from './components/Board/Board';
import { ActionPanel } from './components/Planning/ActionPanel';
import {
  applyMoveOption,
  attackOrigin,
  computeAttackOptions,
  computeFixedMoveOptions,
  computeMoveOptions,
  isDashPlanning,
  findAttackOption,
  findMoveOption,
  isSkillMovePlanning,
  movePlanCursor,
  movePlanFromSegments,
  previewMoveDestination,
  previewMoveSteps,
} from './components/Planning/actionGeometry';
import type { PreviewMove, RewindAnchor } from './components/Board/Board';
import { Scoreboard } from './components/Hud/Scoreboard';
import { UnitStatusList } from './components/Hud/UnitStatusList';
import { RespawnTracker } from './components/Hud/RespawnTracker';
import { TurnControls } from './components/Hud/TurnControls';
import { ResolutionLog } from './components/Log/ResolutionLog';

/** 편집 중인 입력 요소에 포커스가 있을 때는 단축키를 무시한다(드롭다운 키보드 탐색 등과 충돌 방지). */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
}

function GameScreen() {
  const state = useGameStore((s) => s.state);
  const plans = useGameStore((s) => s.plans);
  const mode = useGameStore((s) => s.mode);
  const localOwner = useGameStore((s) => s.localOwner);
  // 로컬 대전은 한 사람이 양쪽을 다 계획한다(디버그 모드). AI·온라인에서는 내 계획만 편집할 수 있다.
  const planningOwners: Owner[] = mode === 'local' ? ['p1', 'p2'] : [localOwner];
  const selectedUnitId = useGameStore((s) => s.selectedUnitId);
  const setSelectedUnit = useGameStore((s) => s.setSelectedUnit);
  const setBaseAction = useGameStore((s) => s.setBaseAction);
  const setSkillUse = useGameStore((s) => s.setSkillUse);
  const setSkillMove = useGameStore((s) => s.setSkillMove);

  const selectedUnit = state && selectedUnitId ? state.units.find((u) => u.instanceId === selectedUnitId) ?? null : null;
  const canPlan = !!state && state.phase === 'planning';

  const storedPlan = selectedUnit && plans ? plans[selectedUnit.owner].actions[selectedUnit.instanceId] : undefined;
  // 계획이 아직 없으면 "행동 없음"으로 취급한다 — 아래 계산들은 계획 전체(기본 행동 + 기술 + 기술 이동)를
  // 함께 봐야 하므로 항상 완전한 UnitTurnPlan을 넘긴다.
  const selectedPlan = useMemo<UnitTurnPlan>(() => storedPlan ?? { baseAction: { kind: 'none' } }, [storedPlan]);

  /**
   * **보드 클릭 모드.** 사거리 안은 대개 걸어서도 갈 수 있어 초록(이동) 칸과 주황(공격) 칸이 겹친다 —
   * 겹친 칸을 클릭했을 때 무엇을 뜻하는지 사용자가 직접 정하게 한다. 기본값은 기본 행동을 따라가므로
   * (공격을 고르면 자동으로 공격 모드) 대부분은 토글을 건드릴 일이 없다.
   */
  const [clickMode, setClickMode] = useState<'move' | 'attack'>('move');
  const baseActionKind = selectedPlan.baseAction.kind;
  useEffect(() => {
    setClickMode(baseActionKind === 'attack' || baseActionKind === 'attackAt' ? 'attack' : 'move');
  }, [selectedUnitId, baseActionKind]);

  /**
   * 초록 칸을 계산할 때 쓰는 계획. 기본 행동이 공격이면 기본 이동 몫이 없어 초록 칸이 하나도 안 뜨는데,
   * 그대로 두면 보드만으로는 공격 계획을 되돌릴 방법이 사라진다 — 그래서 **"이 기물이 지금 이동을
   * 계획한다면"**을 기준으로 그리고, 초록 칸을 클릭하면 기본 행동이 이동으로 바뀌게 한다.
   * 단, 기술로 이동할 수 있는 기물(dealer2 시간역행)은 공격을 유지한 채 기술 구간을 찍어야 하므로 예외.
   */
  const movePlanBasis = useMemo<UnitTurnPlan>(() => {
    if (!selectedUnit || !isSkillMovePlanning(selectedPlan)) return selectedPlan;
    if (canPlanSkillMove(selectedUnit, selectedPlan.skillUse)) return selectedPlan;
    return { ...selectedPlan, baseAction: { kind: 'move', direction: 'up', distance: 0, path: [] } };
  }, [selectedUnit, selectedPlan]);
  /** 초록 칸을 클릭하면 이미 잡아 둔 공격 계획이 이동으로 바뀌는 상황인지(안내문에 명시). */
  const movingCancelsAttack = movePlanBasis !== selectedPlan;

  // chess.com처럼: 유닛을 선택하면 현재 행동 종류와 상관없이 이동/공격 가능 칸을 항상 함께 보여준다.
  // 다만 한 번의 이동은 한 방향이므로 초록 칸은 **아직 안 채운 첫 구간**만 그린다 — dealer2가
  // 기본 이동을 찍고 나면 그 도착 칸에서 다시 초록 칸이 떠 기술 1회·2회·3회를 이어서 찍을 수 있다.
  // 기본 행동이 공격이면 기본 이동 구간은 건너뛰고 기술이 준 구간부터 찍는다(movePlanCursor가 처리).
  const moveCursor = useMemo(() => {
    if (!state || !canPlan || !selectedUnit || !selectedUnit.alive) return null;
    return movePlanCursor(selectedUnit, state.board, movePlanBasis, state.turnNumber);
  }, [state, canPlan, selectedUnit, movePlanBasis]);

  const moveOptions = useMemo(() => {
    if (!state || !selectedUnit || !moveCursor) return [];
    // 추가 이동 구간은 칸수를 고를 수 없다 — 방향마다 "이동 Lv만큼 간 칸"(막히면 그 앞 칸) 하나뿐.
    if (moveCursor.fixedLength) return computeFixedMoveOptions(selectedUnit, state.board, moveCursor);
    // tank2 돌진은 적을 밟고 지나가므로, 적 뒤쪽 칸도 초록으로 떠야 계획할 수 있다.
    const dashing = isDashPlanning(selectedUnit, movePlanBasis);
    return computeMoveOptions(selectedUnit, state.units, state.board, moveCursor.maxSteps, moveCursor.origin, dashing);
  }, [state, selectedUnit, moveCursor, movePlanBasis]);

  // 기술 이동을 계획했으면 공격은 **이동 도착 칸**에서 나간다(이동은 1단계, 공격은 3단계) —
  // 주황 칸도 거기서부터 그려야 "기술로 파고들어 공격"을 보드만 보고 계획할 수 있다.
  const attackFrom = useMemo(() => {
    if (!state || !canPlan || !selectedUnit || !selectedUnit.alive) return null;
    return attackOrigin(selectedUnit, state.units, state.board, selectedPlan, state.turnNumber);
  }, [state, canPlan, selectedUnit, selectedPlan]);

  const attackOptions = useMemo(() => {
    if (!state || !canPlan || !selectedUnit || !selectedUnit.alive || !attackFrom) return [];
    // 기본 행동으로 이동을 잡았으면 이번 턴 공격은 불가능하다 — 주황 칸을 숨긴다.
    if (selectedPlan.baseAction.kind === 'move') return [];
    return computeAttackOptions(selectedUnit, state.board, attackFrom);
  }, [state, canPlan, selectedUnit, selectedPlan, attackFrom]);

  /** 기술 이동으로 지금 서 있는 칸이 아닌 곳에서 쏘게 되는지 — 보드 안내문에서 도착 칸을 알려 준다. */
  const firesAfterSkillMove =
    !!attackFrom && !!selectedUnit?.position && !samePosition(attackFrom, selectedUnit.position);

  // 공개(해결) 전 "이렇게 움직일 예정" 미리보기 — 두 플레이어의 이동 계획 전부에 대해 계산한다
  // (디버그 모드라 양쪽 계획이 항상 같은 화면에 보이므로 소유자 구분 없이 전부 표시).
  const previewMoves = useMemo<PreviewMove[]>(() => {
    if (!state || !plans || !canPlan) return [];
    const result: PreviewMove[] = [];
    for (const unit of state.units) {
      if (!unit.alive) continue;
      const unitPlan = plans[unit.owner].actions[unit.instanceId];
      // 기본 이동뿐 아니라 **기술이 만든 이동**도 미리보기에 나와야 한다(경로가 없으면 빈 배열이 온다).
      if (!unitPlan) continue;
      const steps = previewMoveSteps(unit, state.units, state.board, unitPlan, state.turnNumber);
      const to = previewMoveDestination(steps, unit);
      if (to) result.push({ unit, to, steps });
    }
    return result;
  }, [state, plans, canPlan]);

  // dealer2 시간 역행 기준점: 이미 기록된 스냅샷을 보드에 표시한다.
  const rewindAnchors = useMemo<RewindAnchor[]>(() => {
    if (!state) return [];
    return state.units
      .filter((u) => u.alive && u.rewindSnapshot)
      .map((u) => ({ unit: u, position: u.rewindSnapshot!.position, hp: u.rewindSnapshot!.hp }));
  }, [state]);

  // 단축키: A 공격 / M 이동 / S 기술1 / U 기술2 / H 힐(치유 계열 기술) — 선택된 유닛에만 적용.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!state || state.phase !== 'planning' || !selectedUnit || !selectedUnit.alive) return;
      if (e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;

      const typeDef = getUnitType(selectedUnit.typeId);
      const owner = selectedUnit.owner;
      const instanceId = selectedUnit.instanceId;

      switch (e.key.toLowerCase()) {
        case 'm':
          e.preventDefault();
          setBaseAction(owner, instanceId, { kind: 'move', direction: 'up', distance: 1 });
          break;
        case 'a':
          if (!typeDef.canAttack) return;
          e.preventDefault();
          // 공격은 언제나 기본 행동이다. 이동이 필요하면 그 뒤에 이동 기술로 경로를 찍는다
          // (기본 행동을 공격으로 바꾸면 기본 이동 구간은 사라진다).
          setBaseAction(owner, instanceId, { kind: 'attack', direction: 'up' });
          break;
        case 's': {
          const skill = typeDef.skills[0];
          if (!skill) return;
          e.preventDefault();
          setSkillUse(owner, instanceId, { skillId: skill.id });
          break;
        }
        case 'u': {
          const skill = typeDef.skills[1];
          if (!skill) return;
          e.preventDefault();
          setSkillUse(owner, instanceId, { skillId: skill.id });
          break;
        }
        case 'h': {
          const healSkill = typeDef.skills.find((sk) => sk.effectCategory === 'heal');
          if (!healSkill) return;
          e.preventDefault();
          setSkillUse(owner, instanceId, { skillId: healSkill.id });
          break;
        }
        default:
          break;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state, selectedUnit, setBaseAction, setSkillUse]);

  if (!state) return null;

  // 내가 조종하지 않는 진영의 기물은 보드에서 클릭해도 계획이 바뀌지 않는다(선택해서 보는 것만 가능).
  const controlsSelected = !!selectedUnit && (mode === 'local' || selectedUnit.owner === localOwner);
  const canPlanClicks = state.phase === 'planning' && !!selectedUnit && selectedUnit.alive && controlsSelected;

  /** 공격 방향을 정하는 유일한 통로 — 보드 클릭이든 적 기물 클릭이든 여기로 모인다. */
  function aimAttack(direction: Direction) {
    if (!selectedUnit) return;
    // 공격은 항상 기본 행동이다 — 이미 계획된 기술 이동은 그대로 두므로 "기술로 파고들어 공격"이 된다.
    setBaseAction(selectedUnit.owner, selectedUnit.instanceId, { kind: 'attack', direction });
  }

  function handleCellClick(p: Position) {
    if (!canPlanClicks || !selectedUnit) return;
    const moveHit = findMoveOption(moveOptions, p);
    const attackHit = findAttackOption(attackOptions, p);
    // 이동 칸과 공격 칸은 겹치기 마련이라(사거리 안은 대개 걸어서도 갈 수 있다) 한쪽을 먼저 봐야 한다.
    // 어느 쪽인지는 보드 위 "클릭 모드"가 정하고, 칸 색도 같은 규칙으로 칠해 클릭 결과가 보이게 한다.
    if (clickMode === 'attack' && attackHit) {
      aimAttack(attackHit.direction);
      return;
    }
    if (moveHit && moveCursor) {
      // 보드 클릭은 "그 칸까지 직진" = 이동 한 번이므로, 커서가 가리키는 구간 하나만 채운다.
      // 앞 구간들은 그대로 두므로 기본 이동 → 기술 1회 → 2회 → 3회를 순서대로 찍어 나갈 수 있다.
      // 기본 행동이 공격이면 그 경로는 기본 행동을 덮어쓰지 않고 **기술 이동**으로만 저장된다.
      const patch = movePlanFromSegments(applyMoveOption(moveCursor, moveHit), isSkillMovePlanning(movePlanBasis));
      if (patch.kind === 'skill') setSkillMove(selectedUnit.owner, selectedUnit.instanceId, patch.skillMove);
      else setBaseAction(selectedUnit.owner, selectedUnit.instanceId, patch.action);
      return;
    }
    if (attackHit) aimAttack(attackHit.direction);
  }

  function handleUnitClick(instanceId: string) {
    // 공격 모드에서 사거리 안의 적 기물을 클릭하면 **그 적을 조준**한다 — 기물 위를 클릭했다고 해서
    // 칸 클릭이 먹히지 않으면 "적을 클릭해서 공격"이라는 가장 자연스러운 조작이 막힌다.
    const target = state?.units.find((u) => u.instanceId === instanceId);
    if (clickMode === 'attack' && canPlanClicks && selectedUnit && target && target.position && target.owner !== selectedUnit.owner) {
      const hit = findAttackOption(attackOptions, target.position);
      if (hit) {
        aimAttack(hit.direction);
        return;
      }
    }
    setSelectedUnit(instanceId === selectedUnitId ? null : instanceId);
  }

  return (
    <div className="game-screen">
      <div className="top-bar">
        <Scoreboard />
        <TurnControls />
      </div>
      <div className="main-layout">
        <div className="board-column">
          <Board
            board={state.board}
            units={state.units}
            moveCells={canPlanClicks ? moveOptions.map((o) => o.position) : []}
            attackCells={canPlanClicks ? attackOptions.map((o) => o.position) : []}
            clickPriority={clickMode}
            selectedUnitId={selectedUnitId}
            onCellClick={handleCellClick}
            onUnitClick={handleUnitClick}
            previewMoves={previewMoves}
            rewindAnchors={rewindAnchors}
          />
          {selectedUnit && (moveOptions.length > 0 || attackOptions.length > 0) && (
            <>
              {/* 겹친 칸의 클릭 뜻을 정하는 토글 — 지금 선택된 쪽이 칸 색과 클릭 결과를 모두 결정한다. */}
              <div className="click-mode-switch">
                <span className="click-mode-label">보드 클릭</span>
                <button
                  type="button"
                  className={`click-mode-btn move${clickMode === 'move' ? ' active' : ''}`}
                  disabled={moveOptions.length === 0}
                  onClick={() => setClickMode('move')}
                >
                  이동 지정
                </button>
                <button
                  type="button"
                  className={`click-mode-btn attack${clickMode === 'attack' ? ' active' : ''}`}
                  disabled={attackOptions.length === 0}
                  onClick={() => setClickMode('attack')}
                >
                  공격 방향 지정
                </button>
              </div>
              <p className="board-hint">
                {clickMode === 'attack'
                  ? attackOptions.length > 0
                    ? `주황색 칸(또는 그 칸의 적 기물)을 클릭하면 ${
                        firesAfterSkillMove && attackFrom ? `기술 이동 도착 칸 (${attackFrom.x}, ${attackFrom.y})에서 ` : ''
                      }그 방향으로 공격합니다.`
                    : '지금은 공격할 수 있는 칸이 없습니다.'
                  : moveOptions.length > 0
                    ? moveCursor && moveCursor.segmentIndex > 0
                      ? `초록색 칸을 클릭하면 기술 ${moveCursor.segmentIndex}회째 추가 이동 방향을 정합니다 — 칸수는 항상 이동 Lv(장애물이 있으면 그 앞 칸까지).`
                      : movingCancelsAttack
                        ? '초록색 칸을 클릭하면 잡아 둔 공격 계획 대신 그 칸까지 이동합니다.'
                        : '초록색 칸을 클릭하면 그 칸까지 한 방향으로 이동합니다.'
                    : '지금은 이동할 수 있는 칸이 없습니다.'}
              </p>
            </>
          )}
          <RespawnTracker />
          <ResolutionLog />
        </div>
        <div className="hud-column">
          <UnitStatusList owner="p1" label="Player 1" />
          <UnitStatusList owner="p2" label="Player 2" />
        </div>
      </div>
      <div className="action-panels">
        {planningOwners.map((owner) => (
          <ActionPanel key={owner} owner={owner} label={`${owner === 'p1' ? 'Player 1' : 'Player 2'} 계획`} />
        ))}
      </div>
    </div>
  );
}

/** 지금 무엇을 상대하고 있는지 + 메뉴로 나가는 길. 온라인이면 연결도 함께 끊는다. */
function ModeBanner() {
  const mode = useGameStore((s) => s.mode);
  const stage = useGameStore((s) => s.stage);
  const localOwner = useGameStore((s) => s.localOwner);
  const aiDifficulty = useGameStore((s) => s.aiDifficulty);
  const online = useGameStore((s) => s.online);
  const backToMenu = useGameStore((s) => s.backToMenu);
  if (stage === 'menu') return null;

  const label =
    mode === 'ai'
      ? `AI 대전 · ${DIFFICULTY_PROFILES[aiDifficulty].label} · 내 진영 ${localOwner.toUpperCase()}`
      : mode === 'online'
        ? `온라인 대전 · ${online.role === 'host' ? '호스트' : '게스트'} · 방 ${online.roomId ?? '?'} · 내 진영 ${localOwner.toUpperCase()}`
        : '로컬 대전 · 양쪽 모두 조종';

  return (
    <div className="mode-banner">
      <span>{label}</span>
      <button
        className="btn-secondary"
        onClick={() => {
          leaveOnline();
          backToMenu();
        }}
      >
        메뉴로
      </button>
    </div>
  );
}

export default function App() {
  const stage = useGameStore((s) => s.stage);

  return (
    <div className="app-shell">
      <h1 className="app-title">Simultaneous</h1>
      <ModeBanner />
      {stage === 'menu' && <ModeMenu />}
      {stage === 'draft' && <UnitPicker />}
      {stage === 'placement' && <PlacementScreen />}
      {stage === 'game' && <GameScreen />}
    </div>
  );
}
