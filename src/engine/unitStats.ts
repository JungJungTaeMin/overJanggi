import type { AttackShape, UnitInstance } from './types';
import { getUnitType } from '../data/unitTypes';
import { hasActiveEffect, sumMagnitude } from './statusEffects';

/**
 * **러너의 가속 패시브.** 이동 Lv이 최소~최대 사이를 오가는 기물의 눈금을 여기 한 곳에서만 읽는다.
 *
 * 상태이상(moveBonus)이 아니라 `charges`에 쌓는 이유가 둘 있다. 첫째, 상태이상의 "1턴 동안"은 적용
 * 턴과 다음 턴까지만 살아 있어서(statusEffects.ts) **여러 턴에 걸쳐 쌓이는 값**을 담을 수 없다.
 * 둘째, moveBonus로 주면 이 값이 기술 버프와 한 통에 섞여 "가속으로 3Lv인 상태"와 "1Lv인데 버프를
 * 2 받은 상태"를 구별할 수 없게 되는데, 발맞추기가 **자기 이동 Lv만큼** 나눠 주는 기술이라 그 둘이
 * 갈라져야 한다(가속분만 세고 남이 준 버프는 되팔지 않는다).
 *
 * 사망하면 charges가 initCharges로 초기화되므로(endOfTurn) 부활한 러너는 최소 Lv에서 다시 시작한다 —
 * "사망 시 전부 초기화"라는 기존 판단값과 같다.
 */
const PACE_KEY = 'paceMomentum';

function paceSpec(unit: UnitInstance): { min: number; max: number } | null {
  const typeDef = getUnitType(unit.typeId);
  const payload = typeDef.passive?.payload;
  if (!payload || typeof payload.maxMove !== 'number') return null;
  return { min: payload.minMove ?? typeDef.moveSpeed, max: payload.maxMove };
}

/** 가속 패시브를 가진 기물의 현재 눈금(화면 배지용). 없는 기물이면 null. */
export function paceState(unit: UnitInstance): { level: number; min: number; max: number } | null {
  const spec = paceSpec(unit);
  return spec ? { level: paceLevel(unit), ...spec } : null;
}

/** 러너가 **이번 턴** 걷는 이동 Lv. 가속 패시브가 없는 기물은 기본 이동력 그대로. */
export function paceLevel(unit: UnitInstance): number {
  const spec = paceSpec(unit);
  if (!spec) return getUnitType(unit.typeId).moveSpeed;
  return Math.min(spec.max, spec.min + (unit.charges[PACE_KEY] ?? 0));
}

/**
 * 걸은 턴의 정산 — 이동 단계에서 **실제로 한 칸이라도 움직인 뒤** 부른다.
 *
 * "최대 이동 Lv이 되면 다음 턴에 최소로 치환된다"를 그대로 옮긴 것이다: 최대치로 달린 그 턴이
 * 끝나면 0으로 되돌아간다. 그래서 러너는 1 → 2 → 3 → 1을 도는 4턴 주기를 갖고, **최대 속도는
 * 한 턴만** 쓴다. 제자리에 선 턴은 아무 일도 일어나지 않는다(가속도 감속도 없다) — 숨을 고르는
 * 것이 곧 다음 가속을 미루는 선택이 되도록.
 *
 * 다음 턴 Lv을 돌려주는 이유는 로그와 화면이 "지금 몇 Lv이 됐는지"를 말할 수 있어야 해서다.
 * 가속은 판에 아무 흔적도 남기지 않는 변화라, 로그가 없으면 사람은 이동 칸수가 왜 늘었는지 모른다.
 */
export function advancePace(unit: UnitInstance): { level: number; reset: boolean } | null {
  const spec = paceSpec(unit);
  if (!spec) return null;
  const reset = paceLevel(unit) >= spec.max;
  unit.charges[PACE_KEY] = reset ? 0 : (unit.charges[PACE_KEY] ?? 0) + 1;
  return { level: paceLevel(unit), reset };
}

/**
 * 기물의 "이번 턴 실제 스탯". support3(확률·포탑형)과 support4(러너)만 여기서 갈라진다 —
 * 하나는 매 턴 동전으로 이동력·공격력이 통째로 바뀌고, 다른 하나는 걸은 턴마다 이동 Lv이 오른다.
 * 어느 쪽이든 `unitTypes.moveSpeed` / `unitTypes.attack`을 그대로 읽으면 안 된다.
 *
 * **계획 시점과 해결 시점의 값이 다르다.** 동전은 해결 단계(이동 직전)에 굴러가므로 계획을 세울 때는
 * 결과를 알 수 없다. 그래서 계획·검증·UI·AI는 앞면 기준(최대치)으로 상한을 잡고, 실제 해결에서
 * 뒷면이 나오면 경로가 그만큼 잘린다. 반대로 하면(뒷면 기준) 앞면일 때 이동력을 못 쓰고,
 * 굴린 뒤 검증하면 계획 자체가 통째로 무효가 되어 "운이 나쁘면 아무것도 못 한다"가 된다.
 *
 * 러너의 가속에는 그런 갈라짐이 없다 — 이번 턴 Lv은 **지난 턴에 이미 확정된 값**이라 계획과 해결이
 * 같은 숫자를 본다. 그래서 아래 세 함수가 러너에 대해서는 전부 같은 값을 돌려준다.
 */
export function plannedMoveSpeed(unit: UnitInstance): number {
  const typeDef = getUnitType(unit.typeId);
  const payload = typeDef.passive?.payload;
  if (paceSpec(unit)) return paceLevel(unit);
  if (unit.typeId !== 'support3' || !payload) return typeDef.moveSpeed;
  return Math.max(payload.headsMove ?? 0, payload.tailsMove ?? 0);
}

/**
 * **동전이 어떻게 나오든 반드시 가는 이동력**(뒷면 기준 = 하한).
 *
 * `plannedMoveSpeed`(앞면 기준 상한)와 짝이다. 계획은 상한으로 세우는 게 맞지만, 화면이 상한만
 * 그리면 **3칸이 보장된 것처럼** 보인다 — 실제로는 절반의 확률로 1칸이다. 상한과 하한을 둘 다
 * 알아야 "여기까지는 확실하고 저기부터는 운"을 칸 색으로 갈라 그릴 수 있다.
 */
export function certainMoveSpeed(unit: UnitInstance): number {
  const typeDef = getUnitType(unit.typeId);
  const payload = typeDef.passive?.payload;
  // 러너의 이번 턴 Lv은 운이 아니라 지난 턴의 결과라 상한과 하한이 같다 — 점선 칸이 생기지 않는다.
  if (paceSpec(unit)) return paceLevel(unit);
  if (unit.typeId !== 'support3' || !payload) return typeDef.moveSpeed;
  return Math.min(payload.headsMove ?? typeDef.moveSpeed, payload.tailsMove ?? typeDef.moveSpeed);
}

/**
 * 동전 때문에 잘려 나갈 수 있는 이동 칸수(앞면 − 뒷면). 동전으로 안 갈리는 기물은 0.
 *
 * 이동력에는 기술·상태이상 보너스가 더 얹히므로 "이번 턴 상한 − 이 값"이 곧 보장 칸수다.
 * 상한을 어디서 구했든(구간별 용량이든 단일 이동력이든) 같은 폭만큼 잘리기 때문에, 폭으로
 * 들고 다니면 호출부가 보너스 계산을 다시 하지 않아도 된다.
 */
export function coinMoveSwing(unit: UnitInstance): number {
  return Math.max(0, plannedMoveSpeed(unit) - certainMoveSpeed(unit));
}

/** 해결 단계에서 쓰는 실제 이동력 — 이번 턴에 굴린 동전 결과를 반영한다. */
export function resolvedMoveSpeed(unit: UnitInstance, turnNumber: number): number {
  const typeDef = getUnitType(unit.typeId);
  const payload = typeDef.passive?.payload;
  if (paceSpec(unit)) return paceLevel(unit);
  if (unit.typeId !== 'support3' || !payload) return typeDef.moveSpeed;
  const heads = hasActiveEffect(unit, 'coinHeads', turnNumber);
  return (heads ? payload.headsMove : payload.tailsMove) ?? typeDef.moveSpeed;
}

/**
 * support2의 조준 보조(`support2_buff`)가 얹는 공격력 증가분. 공격력을 읽는 곳이 여러 군데라
 * 여기 한 곳에서만 더한다 — 사거리 버그가 정확히 "숫자를 네 군데가 따로 들고 있어서" 났었다.
 *
 * `sumMagnitude`인 이유: 아군 둘이 같은 대상을 지정하면 둘 다 들어가는 게 자연스럽다(둘 다 자기
 * 턴을 썼다). 겹치기가 문제가 되면 지속시간이 짧아 저절로 풀린다.
 */
function attackBuff(unit: UnitInstance, turnNumber: number): number {
  return sumMagnitude(unit, 'buff', turnNumber);
}

/** 해결 단계에서 쓰는 실제 공격력 — 이번 턴에 굴린 동전 결과와 받은 버프를 반영한다. */
export function resolvedAttackPower(unit: UnitInstance, turnNumber: number): number {
  const typeDef = getUnitType(unit.typeId);
  const payload = typeDef.passive?.payload;
  const base =
    unit.typeId !== 'support3' || !payload
      ? typeDef.attack
      : ((hasActiveEffect(unit, 'coinHeads', turnNumber) ? payload.headsAttack : payload.tailsAttack) ?? typeDef.attack);
  return base + attackBuff(unit, turnNumber);
}

/**
 * 계획·UI·AI가 쓰는 공격력 상한(앞면 기준).
 *
 * `turnNumber`가 선택 인자인 건 호출부 사정이 갈리기 때문이다: 이번 턴에 **이미 걸려 있는** 버프를
 * 알고 계획하려면 턴 번호가 필요하지만, 턴 맥락 없이 기물의 기본 화력만 보고 싶은 곳도 있다.
 * 넘기지 않으면 버프를 빼고 순수 기본값을 준다.
 */
export function plannedAttackPower(unit: UnitInstance, turnNumber?: number): number {
  const typeDef = getUnitType(unit.typeId);
  const payload = typeDef.passive?.payload;
  const base =
    unit.typeId !== 'support3' || !payload
      ? typeDef.attack
      : Math.max(payload.headsAttack ?? 0, payload.tailsAttack ?? 0);
  return base + (turnNumber === undefined ? 0 : attackBuff(unit, turnNumber));
}

/**
 * 이번 턴 실제 공격 도형 — support3만 동전에 따라 **사거리**가 갈린다(앞면 3 / 뒷면 2).
 *
 * 사거리를 읽는 곳은 전부 `attackRangeFor()`를 거치게 돼 있는데, 그 함수는 방향(직선/대각)만 보고
 * `shape`를 그대로 받는다 — 동전 상태를 알 방법이 없다. 그래서 **shape를 건네기 전에 여기서
 * 갈아 끼운다**. 이렇게 두면 "방향별 사거리는 attackRangeFor 한 곳"이라는 기존 불변식과
 * "턴별 스탯은 unitStats 한 곳"이라는 불변식이 둘 다 유지된다.
 */
function coinRange(unit: UnitInstance, pick: (heads: number, tails: number) => number): AttackShape {
  const typeDef = getUnitType(unit.typeId);
  const payload = typeDef.passive?.payload;
  if (unit.typeId !== 'support3' || !payload) return typeDef.attackShape;
  const heads = payload.headsRange ?? typeDef.attackShape.range;
  const tails = payload.tailsRange ?? typeDef.attackShape.range;
  return { ...typeDef.attackShape, range: pick(heads, tails) };
}

/** 해결 단계에서 쓰는 실제 공격 도형 — 이번 턴에 굴린 동전 결과를 반영한다. */
export function resolvedAttackShape(unit: UnitInstance, turnNumber: number): AttackShape {
  const heads = hasActiveEffect(unit, 'coinHeads', turnNumber);
  return coinRange(unit, (h, t) => (heads ? h : t));
}

/**
 * 계획·UI·AI가 쓰는 공격 도형(앞면 기준 = 최대 사거리).
 *
 * 이동력과 같은 이유로 최대치를 잡는다 — 뒷면 기준으로 잡으면 앞면인 턴에 사거리를 못 쓰고,
 * 굴린 뒤 검증하면 운이 나쁜 턴에 계획 자체가 무효가 된다. 뒷면이 나오면 그냥 안 닿는다.
 */
export function plannedAttackShape(unit: UnitInstance): AttackShape {
  return coinRange(unit, (h, t) => Math.max(h, t));
}

/** 동전이 어떻게 나오든 반드시 닿는 공격 도형(뒷면 기준 = 하한). `certainMoveSpeed`와 같은 이유. */
export function certainAttackShape(unit: UnitInstance): AttackShape {
  return coinRange(unit, (h, t) => Math.min(h, t));
}

/**
 * 탄창식 기본 공격의 현재 상태(dealer1: 2발 쏘고 1턴 휴식).
 *
 * **UI가 이 계산을 직접 하면 안 된다.** 잔탄이 한 값이 아니라 `charges['basicAttack']`(이번 탄창에서
 * 쏜 횟수)과 `cooldowns['basicAttack']`(휴식 잔여)에 나뉘어 있고, 둘의 관계가 직관적이지 않다 —
 * 쿨타임은 공격 단계에서 `attackRestTurns + 1`로 설정되지만 그 +1은 **같은 턴 종료에 곧바로
 * 깎이는 일시값**이라(attacks.ts 주석), 화면이 보는 해결 후 상태에서는 이미 `attackRestTurns`다.
 * 여기서 보정을 넣으면 오히려 한 턴을 덜 세게 된다.
 *
 * 탄창식이 아닌 기물은 null — 호출부가 "이 기물에는 해당 없음"과 "0발 남음"을 구별해야 한다.
 */
export interface AmmoState {
  /** 탄창 크기(연속으로 쏠 수 있는 발수) */
  magazine: number;
  /** 지금 쏠 수 있는 남은 발수. 휴식 중이면 0이다. */
  remaining: number;
  /** 0보다 크면 휴식 중이고, 이번 턴 공격이 아예 불법이다(validation.ts). */
  restingTurns: number;
}

export function ammoState(unit: UnitInstance): AmmoState | null {
  const typeDef = getUnitType(unit.typeId);
  if (!typeDef.attackRestTurns) return null;
  const magazine = typeDef.attackShots ?? 1;
  // 해결이 끝난 뒤의 값을 그대로 쓴다 — 공격 단계의 +1은 같은 턴 종료에 이미 깎였다.
  const restingTurns = unit.cooldowns['basicAttack'] ?? 0;
  const fired = unit.charges['basicAttack'] ?? 0;
  return { magazine, remaining: restingTurns > 0 ? 0 : magazine - fired, restingTurns };
}
