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
  /** 공격 후 자동으로 부여되는 쿨다운(딜러1처럼 "기술"이 아닌 기본 공격 자체의 제약) */
  attackCooldownTurns?: number;
  passive?: { id: string; description: string; payload?: Record<string, number> };
  isTurret?: boolean;
}

export interface StatusEffectInstance {
  type: 'barrier' | 'root' | 'attackMode' | 'buff' | string;
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
  /** 포탑을 세운 support3의 instanceId. 기물당 포탑 1기 규칙(preAttack.ts)을 위해 필요하다. */
  summonerId?: string;
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

export interface BoardConfig {
  width: number;
  height: number;
  obstacles: Position[];
  captureZone: Position[];
  startZones: { p1: Position[]; p2: Position[] };
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
  log: ResolutionEvent[];
}
