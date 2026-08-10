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
        payload: { duration: 1 },
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
    skills: [
      {
        id: 'support1_aoe_heal',
        name: '범위 회복',
        effectCategory: 'heal',
        gate: { type: 'auto' },
        targeting: 'aoe',
        payload: { radius: 2, healAmount: 1 },
      },
    ],
    // 턴 종료 시 자동 회복, 해당 턴에 힐을 사용했다면 자동회복량 2배
    passive: { id: 'support1_auto_regen', description: '턴 종료 시 자동 회복. 해당 턴 회복량 2배', payload: { baseAmount: 1, healedThisTurnMultiplier: 2 } },
  },
  {
    id: 'support2',
    name: '지원 2 — 장거리 회복·구속형',
    role: 'support',
    moveSpeed: 1,
    hpLv: 3,
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
        payload: { range: 4, healAmount: 3 },
      },
      {
        id: 'support2_root',
        name: '구속',
        effectCategory: 'preAttack',
        gate: { type: 'auto' },
        targeting: 'enemy',
        payload: { range: 2, duration: 1 },
      },
    ],
  },
  {
    id: 'support3',
    name: '지원 3 — 확률·포탑형',
    role: 'support',
    moveSpeed: 0,
    hpLv: 3,
    attack: 0,
    attackShape: { kind: 'line', range: 0, axis: 'orthogonal' },
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

/** support3이 매 턴 앞칸에 생성하는 포탑. 5기물 편성 수에 포함되지 않는 별도 엔티티. */
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
  passive: { id: 'turret_aura', description: '주변 8칸 아군 회복', payload: { healAmount: 2, radius: 1 } },
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
