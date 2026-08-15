import type { UnitInstance } from './types';
import { getUnitType } from '../data/unitTypes';
import { hasActiveEffect } from './statusEffects';

/**
 * 기물의 "이번 턴 실제 스탯". 지금은 support3(확률·포탑형)만 여기서 갈라진다 —
 * 매 턴 앞면/뒷면이 정해지고 그에 따라 이동력과 공격력이 통째로 바뀌기 때문에,
 * `unitTypes.moveSpeed` / `unitTypes.attack`을 그대로 읽으면 안 된다.
 *
 * **계획 시점과 해결 시점의 값이 다르다.** 동전은 해결 단계(이동 직전)에 굴러가므로 계획을 세울 때는
 * 결과를 알 수 없다. 그래서 계획·검증·UI·AI는 앞면 기준(최대치)으로 상한을 잡고, 실제 해결에서
 * 뒷면이 나오면 경로가 그만큼 잘린다. 반대로 하면(뒷면 기준) 앞면일 때 이동력을 못 쓰고,
 * 굴린 뒤 검증하면 계획 자체가 통째로 무효가 되어 "운이 나쁘면 아무것도 못 한다"가 된다.
 */
export function plannedMoveSpeed(unit: UnitInstance): number {
  const typeDef = getUnitType(unit.typeId);
  const payload = typeDef.passive?.payload;
  if (unit.typeId !== 'support3' || !payload) return typeDef.moveSpeed;
  return Math.max(payload.headsMove ?? 0, payload.tailsMove ?? 0);
}

/** 해결 단계에서 쓰는 실제 이동력 — 이번 턴에 굴린 동전 결과를 반영한다. */
export function resolvedMoveSpeed(unit: UnitInstance, turnNumber: number): number {
  const typeDef = getUnitType(unit.typeId);
  const payload = typeDef.passive?.payload;
  if (unit.typeId !== 'support3' || !payload) return typeDef.moveSpeed;
  const heads = hasActiveEffect(unit, 'coinHeads', turnNumber);
  return (heads ? payload.headsMove : payload.tailsMove) ?? typeDef.moveSpeed;
}

/** 해결 단계에서 쓰는 실제 공격력 — 이번 턴에 굴린 동전 결과를 반영한다. */
export function resolvedAttackPower(unit: UnitInstance, turnNumber: number): number {
  const typeDef = getUnitType(unit.typeId);
  const payload = typeDef.passive?.payload;
  if (unit.typeId !== 'support3' || !payload) return typeDef.attack;
  const heads = hasActiveEffect(unit, 'coinHeads', turnNumber);
  return (heads ? payload.headsAttack : payload.tailsAttack) ?? typeDef.attack;
}

/** 계획·UI·AI가 쓰는 공격력 상한(앞면 기준). */
export function plannedAttackPower(unit: UnitInstance): number {
  const typeDef = getUnitType(unit.typeId);
  const payload = typeDef.passive?.payload;
  if (unit.typeId !== 'support3' || !payload) return typeDef.attack;
  return Math.max(payload.headsAttack ?? 0, payload.tailsAttack ?? 0);
}
