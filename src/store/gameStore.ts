import { create } from 'zustand';
import type { ActionPlan, BaseAction, BoardConfig, GameState, Owner, Position, ResolutionEvent, SkillMove, SkillUse, UnitTurnPlan } from '../engine/types';
import type { CustomMap } from '../maps/mapStorage';
import { createInitialState } from '../engine/createInitialState';
import { resolveTurn } from '../engine/resolveTurn';
import { compactReplay, type ResolutionStep, type TurnReplay } from '../engine/replay';
import { canPlanSkillMove } from '../engine/movePath';
import { ROSTER_SIZE } from '../data/constants';
import { DEFAULT_ROSTER_RULE, canAddPick, isRosterLegal, type RosterRuleId } from '../data/rosterRules';
import { mapDefinition } from '../data/mapDefinitions';
import { aiActionPlan, aiDraftPicks, aiPlacement } from '../ai/aiPlayer';
import type { AiDifficulty } from '../ai/difficulty';
import { DEFAULT_PLAYBACK_SPEED, isPlaybackSpeedId, type PlaybackSpeedId } from '../components/Board/playbackSpeed';

export type Stage = 'menu' | 'mapMaker' | 'draft' | 'placement' | 'game';

/** 이 브라우저에서 무엇을 상대하는지. 화면 구성(상대 패널 노출)과 상대 계획의 출처를 결정한다. */
export type GameMode = 'local' | 'ai' | 'online';

export type OnlineRole = 'host' | 'guest';
export type OnlineStatus = 'idle' | 'connecting' | 'waiting' | 'connected' | 'error';

export interface OnlineState {
  role: OnlineRole | null;
  /** 호스트의 peer id = 방 코드. 게스트는 이 값을 입력해 들어온다. */
  roomId: string | null;
  status: OnlineStatus;
  error: string | null;
}

const IDLE_ONLINE: OnlineState = { role: null, roomId: null, status: 'idle', error: null };

function emptyPlan(playerId: Owner, turnNumber: number): ActionPlan {
  return { turnNumber, playerId, actions: {} };
}

function plansForTurn(state: GameState): { p1: ActionPlan; p2: ActionPlan } {
  const p1 = emptyPlan('p1', state.turnNumber);
  const p2 = emptyPlan('p2', state.turnNumber);
  for (const unit of state.units) {
    if (!unit.alive || unit.isTurret) continue;
    const plan: UnitTurnPlan = { baseAction: { kind: 'none' } };
    (unit.owner === 'p1' ? p1 : p2).actions[unit.instanceId] = plan;
  }
  return { p1, p2 };
}

export function opponentOf(owner: Owner): Owner {
  return owner === 'p1' ? 'p2' : 'p1';
}

/**
 * 사람이 "추천 편성"·"빠른 시작"으로 받는 조합.
 *
 * AI 어려움이 쓰는 표를 그대로 가져온다 — 밸런스 측정에서 상위권이던 편성이고, 여기에 따로
 * 적어 두면 같은 근거가 두 곳으로 갈려 한쪽만 낡는다. 편성 규칙도 그 표가 이미 지킨다.
 */
function recommendedRoster(rule: RosterRuleId): string[] {
  return aiDraftPicks('hard', Math.random, rule);
}

const cellKey = (p: Position) => `${p.x},${p.y}`;

/**
 * 이번 판에 쓸 보드. 맵을 고르지 않았으면 기본 '정원' 맵이다.
 *
 * 화면과 엔진이 **같은 한 곳**에서 보드를 가져오게 하려고 함수로 뺐다 — 예전처럼 여기저기서
 * `mapDefinition`을 직접 import하면 커스텀 맵을 고른 뒤에도 배치 화면만 기본 맵을 그리는 식으로
 * 조용히 어긋난다.
 */
export function boardOf(map: CustomMap | null): BoardConfig {
  return map?.board ?? mapDefinition;
}

/**
 * 게스트가 호스트에게 "이 동작을 대신 실행해 달라"고 보내는 원격 호출.
 *
 * 온라인은 **호스트 권위(host-authoritative)** 구조다. 게스트는 자기 스토어를 직접 고치지 않고 이
 * 메시지만 보내며, 호스트가 실제로 적용한 뒤 전체 스냅샷을 돌려준다 — 두 브라우저가 각자 상태를
 * 굴리다 어긋나는 일(특히 무작위 선공권이 들어가는 해결 단계)이 원천적으로 생기지 않는다.
 */
export type RemoteAction =
  | { name: 'togglePick'; args: [Owner, string] }
  | { name: 'autoFillDraft'; args: [Owner] }
  | { name: 'confirmDraft'; args: [] }
  | { name: 'placeUnit'; args: [Owner, number, Position] }
  | { name: 'autoPlace'; args: [Owner] }
  | { name: 'confirmPlacement'; args: [] }
  | { name: 'setBaseAction'; args: [Owner, string, BaseAction] }
  | { name: 'setSkillUse'; args: [Owner, string, SkillUse | undefined] }
  | { name: 'setSkillMove'; args: [Owner, string, SkillMove | undefined] }
  | { name: 'resolve'; args: [] }
  | { name: 'resetGame'; args: [] };

/** 호스트가 게스트에게 보내는 전체 상태. 이 게임은 정보 은닉이 없으므로 통째로 복제해도 된다. */
export interface StoreSnapshot {
  stage: Stage;
  draftPicks: Record<Owner, string[]>;
  placementPositions: Record<Owner, (Position | null)[]>;
  state: GameState | null;
  plans: { p1: ActionPlan; p2: ActionPlan } | null;
  lastLog: ResolutionEvent[];
  /**
   * 직전 턴의 단계별 재생. 게스트도 자기 화면에서 같은 순서로 넘겨 봐야 하므로 스냅샷에 싣는다.
   * **재생 위치(replayIndex)는 싣지 않는다** — 재생은 각자의 화면에서 각자 굴러가는 것이라,
   * 위치까지 동기화하면 호스트가 한 칸 넘길 때마다 통신이 한 번씩 나가고 게스트의 재생은
   * 자기 속도가 아니라 상대의 프레임에 끌려다니게 된다.
   */
  replay: TurnReplay | null;
  /**
   * 호스트가 고른 맵. 대전이 시작되면 보드가 GameState 안에 들어가지만, **배치 화면은 아직
   * GameState가 없어서** 이 값이 없으면 게스트만 기본 맵 위에 기물을 놓게 된다.
   */
  selectedMap: CustomMap | null;
  /**
   * 호스트가 고른 편성 규칙. 맵과 같은 이유로 스냅샷에 실린다 — 이 값이 없으면 게스트의 드래프트
   * 화면만 자유 편성으로 열려, 규칙에 어긋나는 편성을 고르고 나서야 확정이 막힌다.
   */
  rosterRule: RosterRuleId;
}

export interface NetAdapter {
  role: OnlineRole;
  sendAction: (action: RemoteAction) => void;
}

let netAdapter: NetAdapter | null = null;

export function setNetAdapter(adapter: NetAdapter | null): void {
  netAdapter = adapter;
}

/** 게스트라면 동작을 호스트로 넘기고 로컬 변경은 하지 않는다(true를 돌려준다). */
function forwardIfGuest(action: RemoteAction): boolean {
  if (netAdapter?.role !== 'guest') return false;
  netAdapter.sendAction(action);
  return true;
}

interface GameStore {
  stage: Stage;
  mode: GameMode;
  /** 이 브라우저 앞에 앉은 사람이 조종하는 진영. 로컬 대전에서는 양쪽 모두 조종한다. */
  localOwner: Owner;
  aiDifficulty: AiDifficulty;
  online: OnlineState;
  draftPicks: Record<Owner, string[]>;
  placementPositions: Record<Owner, (Position | null)[]>;
  state: GameState | null;
  plans: { p1: ActionPlan; p2: ActionPlan } | null;
  lastLog: ResolutionEvent[];
  /** 직전 턴의 단계별 재생(engine/replay.ts). 없으면 재생할 것이 없다는 뜻이다. */
  replay: TurnReplay | null;
  /** 지금 보여 주는 단계 번호. 로컬 값이라 스냅샷에 실리지 않는다. */
  replayIndex: number;
  /** 재생이 굴러가는 중인지. 이 값이 켜져 있는 동안은 계획 입력을 받지 않는다. */
  replayPlaying: boolean;
  /** 재생을 세워 둔 상태(단계는 그대로 보여 주되 자동으로 넘기지 않는다). */
  replayPaused: boolean;
  /**
   * 단계별 재생을 쓸지. 매 턴의 속도를 바꾸는 설정이라 반드시 끌 수 있어야 하고, 매번 다시
   * 끄게 하면 설정이 아니라 성가심이 되므로 브라우저에 기억시킨다.
   */
  playbackEnabled: boolean;
  /**
   * 재생 속도. 읽을 수 있는 속도는 사람마다 다르고 같은 사람도 처음과 100판째가 다르다 —
   * 하나로 정해 두면 누군가에게는 반드시 너무 빠르다. 켜고 끄기와 같은 이유로 기억시킨다.
   */
  playbackSpeed: PlaybackSpeedId;
  selectedUnitId: string | null;
  /** 대전에 쓸 커스텀 맵. null이면 기본 '정원' 맵. 판을 다시 시작해도 유지된다. */
  selectedMap: CustomMap | null;
  /** 이번 판의 편성 규칙. 맵과 마찬가지로 판을 다시 시작해도 유지된다. */
  rosterRule: RosterRuleId;

  openMapMaker: () => void;
  selectMap: (map: CustomMap | null) => void;
  setRosterRule: (rule: RosterRuleId) => void;

  startLocal: () => void;
  startAi: (difficulty: AiDifficulty) => void;
  /**
   * 메뉴에서 곧장 전투로. 편성·배치를 자동으로 끝내 **클릭 한 번**으로 판이 시작된다 —
   * 규칙을 익히기 전에는 드래프트·배치가 무슨 선택인지도 모르는 채 12번을 눌러야 했다.
   */
  quickStart: () => void;
  /** 온라인 대전 시작(연결은 online/netBridge가 맡고, 여기서는 화면/소유 진영만 잡는다). */
  startOnline: (role: OnlineRole) => void;
  setOnlineState: (patch: Partial<OnlineState>) => void;
  togglePick: (owner: Owner, typeId: string) => void;
  /** 추천 편성으로 5기물을 한 번에 채운다(현재 편성 규칙을 지키는 조합). */
  autoFillDraft: (owner: Owner) => void;
  confirmDraft: () => void;
  placeUnit: (owner: Owner, index: number, position: Position) => void;
  /** 아직 안 놓은 기물을 시작지점에 자동으로 배치한다(이미 놓은 기물은 그대로). */
  autoPlace: (owner: Owner) => void;
  confirmPlacement: () => void;
  setBaseAction: (owner: Owner, instanceId: string, action: BaseAction) => void;
  setSkillUse: (owner: Owner, instanceId: string, skill: SkillUse | undefined) => void;
  /** 기술이 만든 이동(기본 행동이 공격일 때 쓰는 이동 경로). undefined면 해제. */
  setSkillMove: (owner: Owner, instanceId: string, skillMove: SkillMove | undefined) => void;
  setSelectedUnit: (instanceId: string | null) => void;
  /** 재생을 한 단계 넘긴다. 마지막 단계에서 부르면 재생이 끝난다(판은 최종 상태로 돌아온다). */
  advanceReplay: () => void;
  /** 재생을 그만두고 곧바로 최종 판을 본다(건너뛰기). */
  stopReplay: () => void;
  /** 특정 단계로 바로 간다 — "공격 단계만 다시" 같은 확인은 처음부터 다시 보게 하면 안 된다. */
  seekReplay: (index: number) => void;
  togglePauseReplay: () => void;
  /** 방금 지나간 턴을 처음부터 다시 본다. */
  restartReplay: () => void;
  setPlaybackEnabled: (enabled: boolean) => void;
  setPlaybackSpeed: (speed: PlaybackSpeedId) => void;
  resolve: () => void;
  resetGame: () => void;
  /** 메뉴로 완전히 되돌아간다(온라인 연결 해제는 netBridge가 별도로 처리). */
  backToMenu: () => void;
}

const FRESH = {
  draftPicks: { p1: [], p2: [] } as Record<Owner, string[]>,
  placementPositions: { p1: [], p2: [] } as Record<Owner, (Position | null)[]>,
  state: null,
  plans: null,
  lastLog: [] as ResolutionEvent[],
  replay: null as TurnReplay | null,
  replayIndex: 0,
  replayPlaying: false,
  replayPaused: false,
  selectedUnitId: null,
};

const PLAYBACK_SETTING_KEY = 'simultaneous.stepPlayback';
const PLAYBACK_SPEED_KEY = 'simultaneous.stepPlaybackSpeed';

/** 저장된 재생 설정. 값이 없으면 켜 둔다 — 처음 보는 사람에게 필요한 쪽이 기본값이어야 한다. */
function loadPlaybackEnabled(): boolean {
  try {
    return localStorage.getItem(PLAYBACK_SETTING_KEY) !== 'off';
  } catch {
    return true; // 사생활 보호 모드 등으로 localStorage가 막힌 브라우저
  }
}

/** 저장된 재생 속도. 모르는 값이 들어 있으면 기본값으로 돌린다(예전 버전이 남긴 값일 수 있다). */
function loadPlaybackSpeed(): PlaybackSpeedId {
  try {
    const saved = localStorage.getItem(PLAYBACK_SPEED_KEY);
    return isPlaybackSpeedId(saved) ? saved : DEFAULT_PLAYBACK_SPEED;
  } catch {
    return DEFAULT_PLAYBACK_SPEED;
  }
}

/**
 * 새 재생이 도착했을 때의 시작 상태. 호스트(resolve)와 게스트(applySnapshot) 양쪽에서 쓰이므로
 * 한 곳에 적어 둔다 — 두 경로가 갈리면 한쪽 화면만 재생이 안 되는 종류의 버그가 난다.
 *
 * 단계가 하나뿐이면 재생하지 않는다. 그건 "아무 일도 없던 턴"이라 넘겨 봐야 같은 그림이다.
 */
function beginPlayback(replay: TurnReplay | null, enabled: boolean) {
  return {
    replay,
    replayIndex: 0,
    replayPlaying: enabled && !!replay && replay.steps.length > 1,
    replayPaused: false,
  };
}

export const useGameStore = create<GameStore>((set, get) => ({
  stage: 'menu',
  mode: 'local',
  localOwner: 'p1',
  aiDifficulty: 'normal',
  online: IDLE_ONLINE,
  selectedMap: null,
  rosterRule: DEFAULT_ROSTER_RULE,
  playbackEnabled: loadPlaybackEnabled(),
  playbackSpeed: loadPlaybackSpeed(),
  ...FRESH,

  openMapMaker: () => set({ ...FRESH, stage: 'mapMaker' }),

  selectMap: (map) => set({ selectedMap: map }),

  setRosterRule: (rule) => set({ rosterRule: rule }),

  startLocal: () => set({ ...FRESH, stage: 'draft', mode: 'local', localOwner: 'p1', online: IDLE_ONLINE }),

  startAi: (difficulty) =>
    set((s) => ({
      ...FRESH,
      stage: 'draft',
      mode: 'ai',
      localOwner: 'p1',
      aiDifficulty: difficulty,
      online: IDLE_ONLINE,
      // AI 편성은 미리 확정해 둔다 — 사람이 자기 5기물만 고르면 바로 배치로 넘어간다.
      draftPicks: { p1: [], p2: aiDraftPicks(difficulty, Math.random, s.rosterRule) },
    })),

  quickStart: () =>
    set((s) => {
      // 드래프트·배치를 건너뛰되 **거쳐 간 것과 같은 상태**를 만든다 — 화면만 건너뛰고 데이터가
      // 비면 "새 게임"으로 돌아왔을 때 편성이 사라진다.
      const board = boardOf(s.selectedMap);
      const picks: Record<Owner, string[]> = {
        p1: recommendedRoster(s.rosterRule),
        p2: aiDraftPicks(s.aiDifficulty, Math.random, s.rosterRule),
      };
      const positions: Record<Owner, Position[]> = {
        p1: aiPlacement(picks.p1, 'p1', board),
        p2: aiPlacement(picks.p2, 'p2', board),
      };
      const gameState = createInitialState(picks.p1, picks.p2, positions.p1, positions.p2, board);
      return {
        ...FRESH,
        stage: 'game',
        mode: 'ai',
        localOwner: 'p1',
        online: IDLE_ONLINE,
        draftPicks: picks,
        placementPositions: positions,
        state: gameState,
        plans: plansForTurn(gameState),
      };
    }),

  startOnline: (role) =>
    set({
      ...FRESH,
      stage: 'draft',
      mode: 'online',
      // 호스트가 p1, 게스트가 p2. 각자 자기 진영만 조종한다.
      localOwner: role === 'host' ? 'p1' : 'p2',
      online: { ...get().online, role, status: 'connected', error: null },
    }),

  setOnlineState: (patch) => set((s) => ({ online: { ...s.online, ...patch } })),

  togglePick: (owner, typeId) => {
    if (forwardIfGuest({ name: 'togglePick', args: [owner, typeId] })) return;
    set((s) => {
      const current = s.draftPicks[owner];
      const idx = current.indexOf(typeId);
      let next: string[];
      // 편성 규칙 검사는 **담을 때만** 한다 — 빼는 건 언제나 허용해야 규칙에 막힌 편성을 되돌릴 수 있다.
      if (idx >= 0) {
        next = [...current.slice(0, idx), ...current.slice(idx + 1)];
      } else if (canAddPick(current, typeId, s.rosterRule)) {
        next = [...current, typeId];
      } else {
        next = current;
      }
      return { draftPicks: { ...s.draftPicks, [owner]: next } };
    });
  },

  autoFillDraft: (owner) => {
    if (forwardIfGuest({ name: 'autoFillDraft', args: [owner] })) return;
    // 고르던 것을 남겨 두고 빈 자리만 메우면 규칙(탱커 정원)을 만족시킬 조합을 다시 풀어야 한다.
    // "추천 편성"은 조합 전체가 근거이므로 통째로 갈아 끼우고, 마음에 안 들면 눌러 빼면 된다.
    set((s) => ({ draftPicks: { ...s.draftPicks, [owner]: recommendedRoster(s.rosterRule) } }));
  },

  confirmDraft: () => {
    if (forwardIfGuest({ name: 'confirmDraft', args: [] })) return;
    set((s) => {
      // 화면이 이미 막고 있지만 게스트의 원격 호출도 여기로 들어오므로 규칙 검사는 스토어가 최종이다.
      if (!isRosterLegal(s.draftPicks.p1, s.rosterRule) || !isRosterLegal(s.draftPicks.p2, s.rosterRule)) return {};
      const positions: Record<Owner, (Position | null)[]> = {
        p1: Array(ROSTER_SIZE).fill(null),
        p2: Array(ROSTER_SIZE).fill(null),
      };
      if (s.mode === 'ai') {
        // AI는 배치도 스스로 끝낸다 — 사람은 자기 진영만 찍으면 된다.
        const ai = opponentOf(s.localOwner);
        positions[ai] = aiPlacement(s.draftPicks[ai], ai, boardOf(s.selectedMap));
      }
      return { stage: 'placement', placementPositions: positions };
    });
  },

  placeUnit: (owner, index, position) => {
    if (forwardIfGuest({ name: 'placeUnit', args: [owner, index, position] })) return;
    set((s) => {
      const positions = [...s.placementPositions[owner]];
      // 이미 다른 슬롯이 같은 칸을 차지하고 있으면 그 슬롯은 비운다(칸 중복 방지)
      for (let i = 0; i < positions.length; i++) {
        if (i !== index && positions[i] && positions[i]!.x === position.x && positions[i]!.y === position.y) positions[i] = null;
      }
      positions[index] = position;
      return { placementPositions: { ...s.placementPositions, [owner]: positions } };
    });
  },

  autoPlace: (owner) => {
    if (forwardIfGuest({ name: 'autoPlace', args: [owner] })) return;
    set((s) => {
      const board = boardOf(s.selectedMap);
      const picks = s.draftPicks[owner];
      // AI와 같은 진형(탱커 앞줄·원거리 뒷줄)을 쓴다 — 자동 배치가 AI보다 나쁜 자리를 주면 안 된다.
      const suggested = aiPlacement(picks, owner, board);
      const positions = [...s.placementPositions[owner]];
      // 이미 손으로 놓아 둔 기물은 건드리지 않는다. 그 칸을 추천 자리로 다시 쓰지 않도록 먼저 표시해 둔다.
      const taken = new Set(positions.filter(Boolean).map((p) => cellKey(p!)));
      for (let i = 0; i < picks.length; i++) {
        if (positions[i]) continue;
        const cell =
          suggested[i] && !taken.has(cellKey(suggested[i]))
            ? suggested[i]
            : board.startZones[owner].find((c) => !taken.has(cellKey(c)));
        if (!cell) continue; // 시작지점이 편성보다 좁은 맵 — 남은 자리는 사람이 직접 정한다
        positions[i] = cell;
        taken.add(cellKey(cell));
      }
      return { placementPositions: { ...s.placementPositions, [owner]: positions } };
    });
  },

  confirmPlacement: () => {
    if (forwardIfGuest({ name: 'confirmPlacement', args: [] })) return;
    set((s) => {
      const { p1, p2 } = s.placementPositions;
      if (p1.some((p) => !p) || p2.some((p) => !p)) return {};
      const gameState = createInitialState(s.draftPicks.p1, s.draftPicks.p2, p1, p2, boardOf(s.selectedMap));
      return { stage: 'game', state: gameState, plans: plansForTurn(gameState), lastLog: [] };
    });
  },

  setBaseAction: (owner, instanceId, action) => {
    if (forwardIfGuest({ name: 'setBaseAction', args: [owner, instanceId, action] })) return;
    set((s) => {
      if (!s.plans) return {};
      const plan = s.plans[owner];
      const existing = plan.actions[instanceId] ?? { baseAction: { kind: 'none' } };
      const nextEntry: UnitTurnPlan = { ...existing, baseAction: action };
      // 기본 행동을 이동으로 바꾸면 경로는 기본 행동이 갖는다 — 기술 이동 경로는 의미가 없어진다.
      if (action.kind === 'move') delete nextEntry.skillMove;
      const updated: ActionPlan = { ...plan, actions: { ...plan.actions, [instanceId]: nextEntry } };
      return { plans: { ...s.plans, [owner]: updated } };
    });
  },

  setSkillUse: (owner, instanceId, skill) => {
    if (forwardIfGuest({ name: 'setSkillUse', args: [owner, instanceId, skill] })) return;
    set((s) => {
      if (!s.plans) return {};
      const plan = s.plans[owner];
      const existing = plan.actions[instanceId] ?? { baseAction: { kind: 'none' } };
      const nextEntry: UnitTurnPlan = { ...existing, skillUse: skill };
      if (!skill) delete nextEntry.skillUse;
      // 이동을 만들어 주지 못하는 기술로 바꾸면 기술 이동의 근거가 사라지므로 경로도 함께 해제한다.
      const unit = s.state?.units.find((u) => u.instanceId === instanceId);
      if (nextEntry.skillMove && (!unit || !canPlanSkillMove(unit, skill))) delete nextEntry.skillMove;
      const updated: ActionPlan = { ...plan, actions: { ...plan.actions, [instanceId]: nextEntry } };
      return { plans: { ...s.plans, [owner]: updated } };
    });
  },

  setSkillMove: (owner, instanceId, skillMove) => {
    if (forwardIfGuest({ name: 'setSkillMove', args: [owner, instanceId, skillMove] })) return;
    set((s) => {
      if (!s.plans) return {};
      const plan = s.plans[owner];
      const existing = plan.actions[instanceId] ?? { baseAction: { kind: 'none' } };
      const nextEntry: UnitTurnPlan = { ...existing, skillMove };
      if (!skillMove || skillMove.path.length === 0) delete nextEntry.skillMove;
      const updated: ActionPlan = { ...plan, actions: { ...plan.actions, [instanceId]: nextEntry } };
      return { plans: { ...s.plans, [owner]: updated } };
    });
  },

  setSelectedUnit: (instanceId) => set({ selectedUnitId: instanceId }),

  advanceReplay: () =>
    set((s) => {
      if (!s.replayPlaying || !s.replay) return {};
      const next = s.replayIndex + 1;
      // 마지막 단계를 지나면 재생을 끈다 — 그러면 판이 스토어의 최종 상태로 돌아온다.
      if (next >= s.replay.steps.length) return { replayPlaying: false };
      return { replayIndex: next };
    }),

  stopReplay: () => set({ replayPlaying: false, replayPaused: false }),

  togglePauseReplay: () => set((s) => (s.replayPlaying ? { replayPaused: !s.replayPaused } : {})),

  seekReplay: (index) =>
    set((s) => {
      if (!s.replay || index < 0 || index >= s.replay.steps.length) return {};
      // 골라서 보는 것은 곧 "여기서 멈춰 두고 보겠다"는 뜻이라 자동 넘김은 멈춘다.
      return { replayIndex: index, replayPlaying: true, replayPaused: true };
    }),

  restartReplay: () =>
    set((s) => (s.replay && s.replay.steps.length > 1 ? { replayIndex: 0, replayPlaying: true, replayPaused: false } : {})),

  setPlaybackEnabled: (enabled) => {
    try {
      localStorage.setItem(PLAYBACK_SETTING_KEY, enabled ? 'on' : 'off');
    } catch {
      // 저장이 막혀도 이번 판에서는 설정이 먹어야 한다 — 기억만 못 할 뿐이다.
    }
    // 재생 중에 끄면 즉시 최종 판으로 간다(끄기가 곧 건너뛰기여야 한다).
    set(enabled ? { playbackEnabled: true } : { playbackEnabled: false, replayPlaying: false });
  },

  setPlaybackSpeed: (speed) => {
    try {
      localStorage.setItem(PLAYBACK_SPEED_KEY, speed);
    } catch {
      // 저장이 막혀도 이번 판에서는 먹어야 한다 — 기억만 못 할 뿐이다.
    }
    set({ playbackSpeed: speed });
  },

  resolve: () => {
    if (forwardIfGuest({ name: 'resolve', args: [] })) return;
    set((s) => {
      if (!s.state || !s.plans) return {};
      // AI 대전이면 상대 계획은 사람이 만든 게 아니라 여기서 즉석으로 생성한다 —
      // 계획 생성은 해결 직전 상태를 보고 하므로, 사람의 계획을 훔쳐보지는 못한다(계획은 서로 독립).
      const plans =
        s.mode === 'ai'
          ? { ...s.plans, [opponentOf(s.localOwner)]: aiActionPlan(s.state, opponentOf(s.localOwner), s.aiDifficulty) }
          : s.plans;
      // 단계별 재생용 스냅샷. 재생을 꺼 뒀으면 아예 뜨지 않는다 — 안 쓸 사진을 여섯 장 찍고
      // 온라인이면 통신에까지 실어 보낼 이유가 없다.
      const turnNumber = s.state.turnNumber;
      const steps: ResolutionStep[] = [];
      const log = resolveTurn(s.state, plans.p1, plans.p2, Math.random, s.playbackEnabled ? (step) => steps.push(step) : undefined);
      const nextState: GameState = structuredClone(s.state);
      const replay: TurnReplay | null = steps.length > 0 ? { turnNumber, steps: compactReplay(steps) } : null;
      return {
        state: nextState,
        plans: nextState.phase === 'gameOver' ? plans : plansForTurn(nextState),
        lastLog: log,
        selectedUnitId: null,
        ...beginPlayback(replay, s.playbackEnabled),
      };
    });
  },

  resetGame: () => {
    if (forwardIfGuest({ name: 'resetGame', args: [] })) return;
    set((s) => ({
      ...FRESH,
      stage: 'draft',
      // 같은 상대와 다시 붙는다 — 모드/난이도/편성 규칙/온라인 연결은 그대로 유지한다.
      draftPicks: s.mode === 'ai' ? { p1: [], p2: aiDraftPicks(s.aiDifficulty, Math.random, s.rosterRule) } : { p1: [], p2: [] },
    }));
  },

  backToMenu: () => set({ ...FRESH, stage: 'menu', mode: 'local', localOwner: 'p1', online: IDLE_ONLINE }),
}));

/** 호스트가 게스트의 원격 호출을 실제 스토어 동작으로 실행한다. */
export function applyRemoteAction(action: RemoteAction): void {
  const s = useGameStore.getState();
  switch (action.name) {
    case 'togglePick':
      return s.togglePick(...action.args);
    case 'autoFillDraft':
      return s.autoFillDraft(...action.args);
    case 'placeUnit':
      return s.placeUnit(...action.args);
    case 'autoPlace':
      return s.autoPlace(...action.args);
    case 'confirmDraft':
      return s.confirmDraft();
    case 'confirmPlacement':
      return s.confirmPlacement();
    case 'setBaseAction':
      return s.setBaseAction(...action.args);
    case 'setSkillUse':
      return s.setSkillUse(...action.args);
    case 'setSkillMove':
      return s.setSkillMove(...action.args);
    case 'resolve':
      return s.resolve();
    case 'resetGame':
      return s.resetGame();
  }
}

/**
 * 지금 화면에 보여야 할 단계. 재생 중이 아니면 null이고, 그때는 화면이 스토어의 최종 상태를 본다.
 *
 * 판과 점수판이 **같은 통로**로 이 값을 보게 하려고 셀렉터로 빼 뒀다 — 각자 조건을 적으면
 * 판은 이동 단계를 그리는데 점수판에는 이미 정산된 점수가 떠 있는 어긋남이 생긴다.
 */
export function currentReplayStep(s: Pick<GameStore, 'replay' | 'replayIndex' | 'replayPlaying'>): ResolutionStep | null {
  if (!s.replayPlaying || !s.replay) return null;
  return s.replay.steps[s.replayIndex] ?? null;
}

export function storeSnapshot(): StoreSnapshot {
  const s = useGameStore.getState();
  return {
    stage: s.stage,
    draftPicks: s.draftPicks,
    placementPositions: s.placementPositions,
    state: s.state,
    plans: s.plans,
    lastLog: s.lastLog,
    replay: s.replay,
    selectedMap: s.selectedMap,
    rosterRule: s.rosterRule,
  };
}

/** 게스트가 호스트의 스냅샷을 그대로 받아 적는다. 자기 진영·연결 상태 등 로컬 값은 건드리지 않는다. */
export function applySnapshot(snapshot: StoreSnapshot): void {
  const s = useGameStore.getState();
  const replay = snapshot.replay ?? null;
  /**
   * **새 턴의 재생일 때만** 재생을 다시 시작한다. 호스트는 계획을 한 번 만질 때마다 스냅샷을
   * 통째로 보내는데, 그때마다 steps는 새 배열이라 참조로는 구분되지 않는다 — 턴 번호로 보지
   * 않으면 상대가 기물 하나를 클릭할 때마다 내 화면의 재생이 처음으로 되감긴다.
   */
  const isNewTurn = replay?.turnNumber !== s.replay?.turnNumber;
  useGameStore.setState({
    stage: snapshot.stage,
    draftPicks: snapshot.draftPicks,
    placementPositions: snapshot.placementPositions,
    state: snapshot.state,
    plans: snapshot.plans,
    lastLog: snapshot.lastLog,
    ...(isNewTurn ? beginPlayback(replay, s.playbackEnabled) : { replay }),
    // 맵도 호스트를 따라간다 — 게스트가 자기 브라우저에서 고른 맵은 대전에 쓰이지 않는다.
    selectedMap: snapshot.selectedMap,
    // 편성 규칙도 마찬가지다. 옛 호스트가 보낸 스냅샷에는 이 값이 없을 수 있어 기본 규칙으로 받는다.
    rosterRule: snapshot.rosterRule ?? DEFAULT_ROSTER_RULE,
  });
}
