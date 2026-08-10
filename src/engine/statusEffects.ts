import type { StatusEffectInstance, UnitInstance } from './types';

/**
 * "1턴 동안" 효과: 적용된 턴의 행동 해결부터 다음 턴 행동 해결 전까지 유지(8장).
 * 방벽(barrier)은 v0.3 기준 피격 시 소멸하지 않고, 이 지속시간이 자연 만료될 때까지
 * (턴종료 단계의 pruneExpiredEffects에서만) 제거된다 — 이전에는 1회 피격 시 소멸했으나
 * 기획서 재검토로 변경됨(판단 필요 항목 #3 재검토, attacks.ts 참고).
 */
export function isEffectActive(effect: StatusEffectInstance, turnNumber: number): boolean {
  return turnNumber >= effect.appliedOnTurn && turnNumber <= effect.expiresAfterTurn;
}

export function activeEffectsOfType(unit: UnitInstance, type: string, turnNumber: number): StatusEffectInstance[] {
  return unit.statusEffects.filter((e) => e.type === type && isEffectActive(e, turnNumber));
}

export function hasActiveEffect(unit: UnitInstance, type: string, turnNumber: number): boolean {
  return activeEffectsOfType(unit, type, turnNumber).length > 0;
}

export function sumMagnitude(unit: UnitInstance, type: string, turnNumber: number): number {
  return activeEffectsOfType(unit, type, turnNumber).reduce((sum, e) => sum + (e.magnitude ?? 0), 0);
}

export function addStatusEffect(
  unit: UnitInstance,
  type: string,
  turnNumber: number,
  sourceId: string,
  magnitude?: number,
): void {
  unit.statusEffects.push({
    type,
    appliedOnTurn: turnNumber,
    expiresAfterTurn: turnNumber + 1,
    magnitude,
    sourceId,
  });
}

/** 만료된 상태이상 제거(턴종료 단계에서 호출) */
export function pruneExpiredEffects(unit: UnitInstance, turnNumber: number): void {
  unit.statusEffects = unit.statusEffects.filter((e) => e.expiresAfterTurn >= turnNumber);
}
