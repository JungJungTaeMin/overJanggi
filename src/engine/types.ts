export type Position = { x: number; y: number };

export type Direction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'upleft'
  | 'upright'
  | 'downleft'
  | 'downright';

export type Owner = 'p1' | 'p2';
export type Role = 'tank' | 'dealer' | 'support';

export type EffectCategory = 'movement' | 'preAttack' | 'attack' | 'heal';

export type SkillGate =
  | { type: 'cooldown'; turns: number }
  | { type: 'charge'; maxCharges: number }
  | { type: 'toggle' }
  | { type: 'auto' };

export type TargetingKind = 'self' | 'ally' | 'enemy' | 'cell' | 'line' | 'aoe' | 'none';

export interface AttackShape {
  kind: 'melee' | 'line' | 'aoe';
  range: number;
  /** 직선 공격이 허용되는 축. 기본 orthogonal(상하좌우) */
  axis?: 'orthogonal' | 'diagonal' | 'both';
  /**
   * 대각선 방향에만 적용되는 사거리. 비우면 `range`를 그대로 쓴다(축마다 사거리가 같은 기존 동작).
   *
   * 왜 필요한가: dealer3처럼 "직선 4칸 + 대각선 1칸"인 비대칭 사거리를 표현하려면 축 하나로는
   * 부족하다. axis를 `both`로 두고 여기에 1을 주면 십자로는 멀리, 대각으로는 코앞만 닿는다.
   * 방향별 실제 사거리는 `attackRangeFor()` 한 곳에서만 계산한다 — 해결·AI·UI가 각자 계산하면
   * 사거리 표시와 실제 타격 범위가 소리 없이 어긋난다.
   */
  diagonalRange?: number;
  aoeRadius?: number;
  aoeShape?: 'plus' | 'square' | 'line';
}

export interface SkillDef {
  id: string;
  name: string;
  effectCategory: EffectCategory;
  gate: SkillGate;
  targeting: TargetingKind;
  payload: Record<string, number>;
}

export interface UnitTypeDef {
  id: string;
  name: string;
  /**
   * 판 위 토큰에 찍히는 **한 글자** 이름.
   *
   * 이름에서 유도하지 않고 손으로 적는다 — "방어 강화형"과 "방벽·제어형", "장거리 화력형"과
   * "장거리 회복·구속형"처럼 앞 글자가 겹치는 짝이 있어서 자동 생성하면 서로 구별되지 않는다.
   * 구별이 목적인 값이므로 10종이 전부 달라야 한다(unitTypes.test.ts가 잠근다).
   */
  shortLabel: string;
  role: Role;
  moveSpeed: number;
  /** 체력 Lv. maxHp = hpLv * HP_MULTIPLIER(5). fixedMaxHp가 있으면 그 값을 대신 사용(예: 포탑은 "체력 1"로 Lv 공식과 무관하게 명시됨) */
  hpLv: number;
  fixedMaxHp?: number;
  attack: number;
  attackShape: AttackShape;
  diagonalMove: boolean;
  canAttack: boolean;
  skills: SkillDef[];
  /**
   * 기본 공격 자체에 걸리는 제약("기술"이 아니다). 탄창식이다 — attackShots발을 연속으로 쏘고 나면
   * attackRestTurns턴을 쉰다. 딜러1은 2발·1턴 휴식이라 1공격 2공격 3휴식 4공격 5공격 6휴식이 된다.
   */
  attackShots?: number;
  attackRestTurns?: number;
  passive?: { id: string; description: string; payload?: Record<string, number> };
  isTurret?: boolean;
}

export interface StatusEffectInstance {
  /**
   * `root`는 **이동만** 막는다(6장) — 묶인 채로도 쏘고 기술을 쓴다. `stun`은 그 턴의 행동
   * 자체를 막는다(이동·공격·기술 전부). 둘을 한 종류로 합치지 않는 건 tank3 구속이 여전히
   * 이동만 막는 기술이기 때문이다.
   */
  type: 'barrier' | 'root' | 'stun' | 'attackMode' | 'buff' | string;
  appliedOnTurn: number;
  expiresAfterTurn: number;
  magnitude?: number;
  sourceId: string;
}

export interface UnitInstance {
  instanceId: string;
  typeId: string;
  owner: Owner;
  position: Position | null;
  currentHp: number;
  maxHp: number;
  /** 보호막 체력(8장). 최대 체력에 포함되지 않는 별도 체력이며, 일반 체력보다 먼저 소모된다. */
  shieldHp: number;
  alive: boolean;
  respawnTurnsRemaining: number | null;
  cooldowns: Record<string, number>;
  charges: Record<string, number>;
  statusEffects: StatusEffectInstance[];
  isTurret?: boolean;
  /** dealer2 시간역행: 첫 사용 시점의 위치/체력 스냅샷 (충전 3회 소진 시 복귀) */
  rewindSnapshot?: { position: Position; hp: number } | null;
}

/** 기본 행동: 이동 또는 공격 중 하나(3.2절) */
export type BaseAction =
  | {
      kind: 'move';
      direction: Direction;
      distance: number;
      /**
       * 스텝별 이동 방향. 이동은 더 이상 "한 방향으로 N칸"에 묶이지 않고 매 칸마다 방향을 꺾을 수
       * 있으므로, 이 배열이 존재하면 이것이 실제 경로의 유일한 근거가 되고 direction/distance는
       * 요약값(각각 첫 스텝 방향, path.length)으로만 쓰인다. 없으면 direction 방향으로 distance칸
       * 직진하는 기존 해석이 적용된다(보드 클릭·단축키·기존 테스트 호환).
       */
      path?: Direction[];
      /**
       * `path`를 "이동 한 번" 단위 구간으로 끊는 길이 배열. 예: dealer2가 기본 3칸 → 기술1 2칸 →
       * 기술2 3칸 → 기술3 3칸으로 움직이면 `[3, 2, 3, 3]`이다. 구간은 서로 독립이라 앞 구간을 덜
       * 썼다고 뒤 구간이 길어지지 않고 남는 칸은 그대로 버려진다. 없으면 구간 최대치를 앞에서부터
       * 채운 것으로 해석한다(보드 클릭·구형 계획 호환).
       */
      segmentLengths?: number[];
    }
  | { kind: 'attack'; direction: Direction }
  | { kind: 'attackAt'; targetCell: Position }
  | { kind: 'none' };

export interface SkillUse {
  skillId: string;
  target?: Position | string;
  /**
   * 충전형 기술을 이번 턴에 몇 번 사용할지(dealer2 시간역행: 1~3). 생략하면 1회.
   * 충전 1개당 추가 이동 1칸이므로, dealer2는 한 턴에 최대 3칸까지 더 움직일 수 있다.
   */
  amount?: number;
}

/**
 * **기술이 만들어 낸 이동.** 기본 이동 구간은 없고 기술이 준 구간만 있다 —
 * 그래서 기본 행동을 공격으로 잡은 턴에도 이 이동은 살아 있다.
 */
export interface SkillMove {
  /** 스텝별 이동 방향. 길이가 곧 이동 칸수다. */
  path: Direction[];
  /** 기술 1회분 = 한 구간. 예: 시간역행 3회로 3+3+3칸이면 `[3, 3, 3]`. 없으면 한 구간으로 본다. */
  segmentLengths?: number[];
}

/** 한 기물이 한 턴에 제출하는 계획: 기본행동 + (선택) 기술. 기술은 기본행동과 함께 사용 가능(3.2절). */
export interface UnitTurnPlan {
  baseAction: BaseAction;
  skillUse?: SkillUse;
  /**
   * **기술 이동.** 기본 행동을 **공격**으로 잡은 턴에도, "이동을 한 번 더" 통째로 주는 기술
   * (dealer2 시간역행)을 쓰면 그 기술이 만든 이동만으로 움직일 수 있다. 기본 행동은 여전히 하나
   * (= 공격)이고, 이동은 전부 기술 몫이다 — 3회 사용이면 이동 Lv×3칸이며 기본 이동 칸은 없다.
   * 이동은 1단계, 공격은 3단계에서 처리되므로 결과적으로 "기술로 파고들어 **도착 칸에서** 공격"이
   * 되고, dealer2의 복귀는 공격 직후라 히트&런도 그대로 성립한다.
   *
   * tank1 방어태세·tank2 돌진의 "이동 +1"은 **기본 이동을 늘리는 버프**라 기본 행동이 공격이면
   * 늘릴 이동 자체가 없다 — 그런 기술로는 이 이동을 만들 수 없다(validation.ts).
   * 기본 행동이 이미 이동이면 경로는 `baseAction`이 갖고 있으므로 이 필드는 무시된다.
   */
  skillMove?: SkillMove;
}

export interface ActionPlan {
  turnNumber: number;
  playerId: Owner;
  actions: Record<string, UnitTurnPlan>;
}

/**
 * 힐팩 — 맵에 고정된 회복 지점. 어느 팀이든 **그 칸에 서 있으면** 회복 단계(4단계)에 회복된다.
 *
 * 중립 자원이라 소유자가 없다. 대신 한 번 먹으면 일정 턴 비어 있다가 다시 차는데(회복량이 아니라
 * **재생성 시각**이 자원의 희소성을 만든다), 그래서 "누가 먼저 먹느냐"가 판단거리가 된다.
 * 이미 체력이 꽉 찬 기물은 밟아도 소모하지 않는다 — 아군이 아깝게 낭비하는 일을 막는다.
 */
export interface HealPack {
  position: Position;
  /** 회복량. 맵 메이커에서는 10/20 두 등급만 찍을 수 있다(HEAL_PACK_AMOUNTS). */
  amount: number;
}

export interface BoardConfig {
  width: number;
  height: number;
  obstacles: Position[];
  captureZone: Position[];
  startZones: { p1: Position[]; p2: Position[] };
  /**
   * 힐팩 배치. 기본 '정원' 맵에는 없고 맵 메이커로 만든 맵에서만 쓰이므로 선택 항목이다 —
   * 기존 맵/테스트 픽스처가 전부 이 필드를 적어야 하는 상황을 피한다.
   */
  healPacks?: HealPack[];
}

export type GamePhase = 'draft' | 'placement' | 'planning' | 'resolving' | 'gameOver';

export interface ResolutionEvent {
  phase: 'priority' | 'movement' | 'preAttack' | 'attack' | 'heal' | 'endOfTurn';
  type: string;
  actorId?: string;
  targetId?: string;
  detail?: Record<string, unknown>;
}

/**
 * 턴 우선순위 한 항목(3.2.1절): 이동 Lv desc → 공격 수치 desc → 역할(딜러>탱커>지원) → 무작위.
 * order 배열의 인덱스가 곧 우선순위(0이 가장 먼저 행동). reason은 UI/로그에 표시할 결정 근거.
 * 무작위로 결정된 순서는 해당 턴의 해당 행동 단계에서만 유효하므로(§3.2.1), 이동 단계와 공격
 * 단계는 각각 독립적으로 계산된 순서를 갖는다 — movement/attack이 별도 배열인 이유.
 */
export interface PriorityEntry {
  instanceId: string;
  reason: string;
}

export interface TurnPriorityOrders {
  movement: PriorityEntry[];
  attack: PriorityEntry[];
}

export interface GameState {
  turnNumber: number;
  phase: GamePhase;
  board: BoardConfig;
  units: UnitInstance[];
  score: { p1: number; p2: number };
  winner: Owner | null;
  lastPriorityOrder: TurnPriorityOrders | null;
  /**
   * 비어 있는 힐팩이 다시 차기까지 남은 턴. 키는 `"x,y"`(grid.key)이고, 값이 0이거나 키가 없으면
   * 지금 먹을 수 있는 상태다. 보드(BoardConfig)가 아니라 여기 두는 이유는 보드는 **맵 정의**라
   * 판마다 변하지 않아야 하기 때문이다 — 같은 맵으로 두 판을 돌려도 서로 영향이 없어야 한다.
   */
  healPackTimers: Record<string, number>;
  log: ResolutionEvent[];
}
