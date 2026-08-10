import type { UnitInstance } from './types';

/**
 * 피해 적용(8장): 보호막 체력이 있으면 먼저 소모하고, 남은 피해만 실체력에서 차감한다.
 * 보호막과 방벽이 동시에 걸리는 경우의 우선순위는 기획서 §10에 미정으로 남아 있어,
 * 이 프로젝트에서는 "방벽이 막으면 보호막/체력 모두 그대로"를 기본값으로 채택했다
 * (attacks.ts에서 방벽 체크가 이 함수 호출보다 먼저 일어나 자연히 그렇게 동작한다).
 */
export function applyDamage(unit: UnitInstance, amount: number): void {
  if (amount <= 0) return;
  let remaining = amount;
  if (unit.shieldHp > 0) {
    const absorbed = Math.min(unit.shieldHp, remaining);
    unit.shieldHp -= absorbed;
    remaining -= absorbed;
  }
  if (remaining > 0) unit.currentHp = Math.max(0, unit.currentHp - remaining);
}
