import type { UnitTypeDef } from '../engine/types';
import { HP_MULTIPLIER } from './constants';

/**
 * 기획서(v0.5) 7장 원문 스탯을 그대로 옮긴 것. 쿨타임/트리거가 문서에 명시되지 않은
 * 항목은 '판단 필요 항목'으로 계획 문서(3-joyful-dolphin.md)에 정리된 기본값을 따른다:
 *   - support2 구속 스킬, support1 회복 패시브: 쿨타임 없음(매턴 사용 가능)
 *   - 방벽(tank3 skill1): 지속시간(1턴) 동안 유지되며 피격으로는 소멸하지 않는다 — 자연 만료로만
 *     제거된다. 범위형(AoE) 공격은 방벽을 무시하고 관통하지만, 지형 장애물은 시야를 차단해
 *     장애물 뒤 칸은 범위 공격의 대상이 될 수 없다(§3.4/§8).
 *   - 체력 Lv 증가(tank1 방어 태세 등): 최대 체력을 배율만큼 늘리는 효과와, 동일한 양의 별도
 *     "보호막 체력"을 함께 부여한다(§6/§7.1 "함께 부여"). 지속시간이 끝나면 늘어난 최대 체력과
 *     남은 보호막을 함께 제거한다(§8). 보호막은 피해를 받을 때 실제 체력보다 먼저 소모된다(§8).
 */
export const unitTypes: UnitTypeDef[] = [
  {
    id: 'tank1',
    name: '탱커 1 — 방어 강화형',
    role: 'tank',
    moveSpeed: 1,
    hpLv: 8,
    attack: 3,
    attackShape: { kind: 'line', range: 3, axis: 'orthogonal' },
    diagonalMove: false,
    canAttack: true,
    skills: [
      {
        id: 'tank1_fortify',
        name: '방어 태세',
        effectCategory: 'movement',
        gate: { type: 'cooldown', turns: 3 },
        targeting: 'self',
        payload: { hpBonus: 1, moveBonus: 1, duration: 1 },
      },
    ],
  },
  {
    id: 'tank2',
    name: '탱커 2 — 돌진·기동형',
    role: 'tank',
    moveSpeed: 4,
    hpLv: 6,
    attack: 2,
    attackShape: { kind: 'line', range: 4, axis: 'orthogonal' },
    diagonalMove: false,
    canAttack: true,
    skills: [
      {
        id: 'tank2_charge',
        name: '돌진',
        effectCategory: 'movement',
        gate: { type: 'cooldown', turns: 2 },
        targeting: 'self',
        // 피해량은 실제 이동한 칸 수로 동적 계산되므로 payload에는 고정값을 두지 않는다.
        payload: { moveBonus: 1, rerouteCount: 1 },
      },
    ],
  },
  {
    id: 'tank3',
    name: '탱커 3 — 방벽·제어형',
    role: 'tank',
    moveSpeed: 2,
    hpLv: 8,
    attack: 5,
    attackShape: { kind: 'aoe', range: 1, axis: 'orthogonal', aoeShape: 'line', aoeRadius: 1 },
    diagonalMove: false,
    canAttack: true,
    skills: [
      {
        id: 'tank3_barrier',
        name: '방벽 설치',
        effectCategory: 'preAttack',
        gate: { type: 'cooldown', turns: 1 },
        targeting: 'self',
        payload: {},
      },
      {
        id: 'tank3_root',
        name: '구속',
        effectCategory: 'preAttack',
        gate: { type: 'cooldown', turns: 5 },
        targeting: 'enemy',
        // range는 기획서에 없는 판단값이다(engine/skillRange.ts 주석 참고) — 직선·대각선 3칸.
        payload: { duration: 1, range: 3 },
      },
    ],
  },
  {
    id: 'dealer1',
    name: '딜러 1 — 장거리 화력형',
    role: 'dealer',
    moveSpeed: 1,
    hpLv: 3,
    attack: 8,
    attackShape: { kind: 'line', range: 6, axis: 'orthogonal' },
    diagonalMove: false,
    canAttack: true,
    skills: [],
    attackCooldownTurns: 3,
  },
  {
    id: 'dealer2',
    name: '딜러 2 — 시간 역행형',
    role: 'dealer',
    moveSpeed: 3,
    hpLv: 2,
    attack: 6,
    attackShape: { kind: 'line', range: 2, axis: 'orthogonal' },
    diagonalMove: false,
    canAttack: true,
    skills: [
      {
        id: 'dealer2_rewind_move',
        name: '추가 이동',
        effectCategory: 'movement',
        gate: { type: 'charge', maxCharges: 3 },
        targeting: 'self',
        // 충전 1회 = "이동을 한 번 더 하는" 것 = 이동 Lv(3칸)만큼 추가 이동.
        // 따라서 한 턴에 3회를 모두 쓰면 3(기본) + 3×3 = 12칸까지 움직인다.
        payload: { extraMoveMultiple: 1 },
      },
    ],
  },
  {
    id: 'dealer3',
    name: '딜러 3 — 충전 사격형',
    role: 'dealer',
    moveSpeed: 1,
    hpLv: 4,
    attack: 10,
    attackShape: { kind: 'line', range: 4, axis: 'both' },
    diagonalMove: true,
    canAttack: true,
    skills: [
      {
        id: 'dealer3_attack_mode',
        name: '공격 모드 전환',
        effectCategory: 'preAttack',
        gate: { type: 'toggle' },
        targeting: 'self',
        // 켜진 동안만 공격 가능, 이동 불가 (validation.ts에서 강제)
        payload: {},
      },
    ],
  },
  {
    id: 'dealer4',
    name: '딜러 4 — 측면 교란형',
    role: 'dealer',
    moveSpeed: 2,
    hpLv: 4,
    attack: 5,
    attackShape: { kind: 'line', range: 3, axis: 'diagonal' },
    diagonalMove: true,
    canAttack: true,
    skills: [
      {
        id: 'dealer4_swap',
        name: '자리 교체',
        effectCategory: 'movement',
        gate: { type: 'cooldown', turns: 3 },
        targeting: 'ally',
        payload: { swapRange: 3 },
      },
    ],
    // 다른 적과 인접한 대상에게 +7 추가피해 — 상시 조건부 패시브(쿨타임 없음)
    passive: { id: 'dealer4_flank_bonus', description: '다른 적과 인접한 대상에게 +7 추가 피해', payload: { bonusDamage: 7 } },
  },
  {
    id: 'support1',
    name: '지원 1 — 범위 회복형',
    role: 'support',
    moveSpeed: 2,
    hpLv: 3,
    attack: 1,
    attackShape: { kind: 'line', range: 2, axis: 'orthogonal' },
    diagonalMove: false,
    canAttack: true,
    // 회복량은 기획서 원문(1)이 아니라 3이다. 원문 수치는 `maxHp = 체력Lv × 2` 기준으로 쓰였는데,
    // 구현에서 HP_MULTIPLIER를 5로 올리면서 체력만 2.5배가 되고 회복량은 그대로 남았다. 그 결과
    // 공격 5~10 대 회복 1이 되어 힐이 사실상 아무것도 되돌리지 못했다 — 200판 시뮬레이션에서 지원
    // 3종이 나란히 최하위(28~34%)였던 주된 원인이다. 체력과 같은 비율(×2.5, 반올림)로 맞춘다.
    // support2 회복(3→8)과 포탑 오라(2→5)도 같은 이유로 같은 비율을 적용했다.
    skills: [
      {
        id: 'support1_aoe_heal',
        name: '범위 회복',
        effectCategory: 'heal',
        gate: { type: 'auto' },
        targeting: 'aoe',
        payload: { radius: 2, healAmount: 3 },
      },
    ],
    // 턴 종료 시 자동 회복, 해당 턴에 힐을 사용했다면 자동회복량 2배
    passive: { id: 'support1_auto_regen', description: '턴 종료 시 자동 회복. 해당 턴 회복량 2배', payload: { baseAmount: 3, healedThisTurnMultiplier: 2 } },
  },
  {
    id: 'support2',
    name: '지원 2 — 장거리 회복·구속형',
    role: 'support',
    moveSpeed: 1,
    hpLv: 3,
    /**
     * 기획서대로 공격 불가다. "힐량의 1/2(=4) 딜, 회복과 같은 직선 4"를 실제로 넣고 300판을 재 본 적이
     * 있는데(승점 44.0→51.1%), 그 상승분은 전부 착시였다. 적 AI의 `threatAt`이 공격력을 그대로 위협으로
     * 읽어 접근을 피한 것이고, 공격력 4를 둔 채 **적의 위협 계산에서만 빼자** 44.3%로 돌아왔다.
     * 실제 판당 피해는 1.0 — 판당 1.77회 쏘고 명중률 14%다(동시 턴이라 이동 전 위치를 보고 쏘는데
     * 이동력 1이라 빗나가도 재조준을 못 한다). 사람 상대로는 아무것도 바뀌지 않는다는 뜻이라 되돌렸다.
     */
    attack: 0,
    attackShape: { kind: 'line', range: 0, axis: 'orthogonal' },
    diagonalMove: false,
    canAttack: false,
    skills: [
      {
        id: 'support2_heal',
        name: '장거리 회복',
        effectCategory: 'heal',
        gate: { type: 'auto' },
        targeting: 'ally',
        payload: { range: 4, healAmount: 8 },
      },
      {
        id: 'support2_root',
        name: '구속',
        effectCategory: 'preAttack',
        gate: { type: 'auto' },
        targeting: 'enemy',
        payload: { range: 2, duration: 1 },
      },
      /**
       * **조준 보조** — 기획서에 없는 신규 기술이다. 넣은 이유는 측정이다.
       *
       * 이 기물은 이동력 1이라 라인을 맞추러 갈 수 없고, 그래서 오래 최하위 승점(38.8%)이었다.
       * 처음엔 회복 사거리·힐량이 문제인 줄 알았는데 둘 다 아니었다. 직선 사거리를 4→12로 올려도
       * 승점이 38.8→38.2%로 **내려갔고**, 힐량을 8→25로 3배 올리면 판당 회복량만 정확히 3배가 될 뿐
       * 승점은 역시 38.2%였다. 회복량이 승리로 환산되지 않는다는 뜻이다.
       *
       * 기회를 분해해 보니 원인이 나왔다(scripts/support2Opportunity.ts): 사거리 안에 아군이 있는
       * 턴은 **67%**인데, 그중 **부상한** 아군이 있는 턴은 **9%**뿐이었다. 즉 58%의 턴에서 이 기물은
       * 아군을 빤히 보면서도 회복이라는 대상 조건 때문에 아무것도 못 하고 있었다. 축을 대각선까지
       * 열어도 부상 아군은 9→15%로밖에 안 올라, 기하를 손대는 걸로는 못 고치는 문제였다.
       *
       * 버프는 **다치지 않은 아군에게도** 걸리므로 9%가 아니라 67%의 풀을 쓴다. 사거리와 축(직선)은
       * 회복과 똑같이 두어 "긴 사선을 맞춰야 한다"는 저격수 정체성을 그대로 유지한다.
       *
       * 한 턴에 쓰는 기술은 하나뿐(`UnitTurnPlan.skillUse`가 단수)이라, 다칠 아군이 있으면 회복이
       * 우선되고 비는 턴을 이 기술이 메운다 — 회복을 대체하지 않는다.
       *
       * **버프량이 3인 건 상한이 아니라 하한 때문이다.** 스윕에서 6까지 올리면 승점은 46.0%로 더
       * 높아지는데, 대신 판당 회복량이 17.1→1.1로 무너졌다. 버프 가치(6×1.5=9)가 회복 가치
       * (3×2.5=7.5)를 항상 이겨서 이 기물이 회복을 아예 안 하는 버프 봇이 되기 때문이다. 3이면
       * 4.5 < 7.5이라 **다친 아군이 있으면 회복이 먼저**고 버프는 빈 턴만 메운다 — 실측 판당
       * 회복량 16.0으로 원래(17.1)를 거의 유지한다. 사거리 6은 8과 결과가 완전히 같아서(43.2% /
       * 18.0%p) 더 줄 이유가 없어 짧은 쪽을 골랐다.
       */
      {
        id: 'support2_buff',
        name: '조준 보조',
        effectCategory: 'preAttack', // 공격 단계 전에 얹혀야 이번 턴 공격에 반영된다
        gate: { type: 'auto' },
        targeting: 'ally',
        payload: { range: 6, attackBonus: 3 },
      },
    ],
  },
  {
    id: 'support3',
    name: '지원 3 — 확률·포탑형',
    role: 'support',
    // 이동력·공격력은 매 턴 동전으로 정해진다(아래 passive) — 여기 값은 동전이 없을 때의 바닥값이다.
    // 기획서에 사거리 수치가 없어 support1(직선 2)과 같은 근거리 지원 사거리를 기본값으로 둔다.
    // 0으로 두면 공격력 6/4가 닿을 칸이 없어 영영 쓰이지 않는 죽은 값이 된다.
    moveSpeed: 1,
    hpLv: 3,
    attack: 4,
    attackShape: { kind: 'line', range: 2, axis: 'orthogonal' },
    diagonalMove: false,
    canAttack: true,
    skills: [
      {
        id: 'support3_turret',
        name: '포탑 생성',
        effectCategory: 'preAttack',
        gate: { type: 'auto' },
        targeting: 'cell',
        payload: {},
      },
    ],
    // 턴 시작 시 동전 결정(각 50%): 앞면 이동2·공격6 / 뒷면 이동1·공격4. 직접 회복 불가.
    passive: {
      id: 'support3_coinflip',
      description: '턴 시작 시 동전 결정: 앞면 이동2·공격6 / 뒷면 이동1·공격4',
      payload: { headsMove: 2, headsAttack: 6, tailsMove: 1, tailsAttack: 4, headsChance: 0.5 },
    },
  },
];

/**
 * support3이 앞칸에 세우는 **회복** 포탑. 5기물 편성 수에 포함되지 않는 별도 엔티티다.
 *
 * - **딜링이 아니라 힐링이다**: attack 0 · canAttack false. 주변 8칸의 **아군만** 회복한다(healing.ts).
 * - **움직이지 않는다**: moveSpeed 0. 계획 자체가 들어오지 않지만(plansForTurn/ActionPanel이
 *   isTurret으로 거른다) 설령 들어와도 이동 상한이 0이라 제자리다.
 * - **팀당 1기**(판 전체 최대 2기). 새로 세우면 그 팀의 기존 포탑이 철거된다(turnStart.ts).
 */
export const turretType: UnitTypeDef = {
  id: 'turret',
  name: '포탑',
  role: 'support',
  moveSpeed: 0,
  hpLv: 0,
  fixedMaxHp: 1,
  attack: 0,
  attackShape: { kind: 'aoe', range: 0, axis: 'orthogonal' },
  diagonalMove: false,
  canAttack: false,
  skills: [],
  isTurret: true,
  passive: { id: 'turret_aura', description: '주변 8칸 아군 회복', payload: { healAmount: 5, radius: 1 } },
};

export function getUnitType(typeId: string): UnitTypeDef {
  if (typeId === turretType.id) return turretType;
  const found = unitTypes.find((u) => u.id === typeId);
  if (!found) throw new Error(`Unknown unit type: ${typeId}`);
  return found;
}

export function maxHpFor(typeDef: UnitTypeDef): number {
  return typeDef.fixedMaxHp ?? typeDef.hpLv * HP_MULTIPLIER;
}
