import type { ActionPlan, GameState, ResolutionEvent, UnitInstance } from '../types';
import { getUnitType, turretType } from '../../data/unitTypes';
import { radiusCells } from '../targeting';
import { samePosition } from '../grid';

interface PendingHeal {
  target: UnitInstance;
  amount: number;
}

/** 4단계: 회복(3.2절). 3단계 종료 후 HP를 스냅샷하고 끝에 일괄 적용 — 이미 죽은 대상 힐은 무효가 된다. */
export function resolveHealing(state: GameState, planP1: ActionPlan, planP2: ActionPlan, log: ResolutionEvent[]): void {
  const pending: PendingHeal[] = [];

  for (const plan of [planP1, planP2]) {
    for (const [instanceId, unitPlan] of Object.entries(plan.actions)) {
      if (!unitPlan.skillUse) continue;
      const unit = state.units.find((u) => u.instanceId === instanceId);
      if (!unit || !unit.alive || !unit.position) continue;
      const typeDef = getUnitType(unit.typeId);
      const skill = typeDef.skills.find((s) => s.id === unitPlan.skillUse!.skillId);
      if (!skill || skill.effectCategory !== 'heal') continue;

      if (skill.id === 'support1_aoe_heal') {
        const cells = radiusCells(unit.position, skill.payload.radius, state.board, 'chebyshev', true);
        for (const cell of cells) {
          const occupant = state.units.find((u) => u.alive && u.position && samePosition(u.position, cell) && u.owner === unit.owner);
          if (!occupant) continue;
          pending.push({ target: occupant, amount: skill.payload.healAmount });
          log.push({ phase: 'heal', type: 'heal', actorId: unit.instanceId, targetId: occupant.instanceId, detail: { amount: skill.payload.healAmount } });
        }
        // 턴 종료 시 자동회복 2배 적용을 위한 이번 턴 표식 (같은 턴에만 유효)
        unit.statusEffects.push({ type: 'healedThisTurn', appliedOnTurn: state.turnNumber, expiresAfterTurn: state.turnNumber, sourceId: unit.instanceId });
      } else if (skill.id === 'support2_heal') {
        const targetId = unitPlan.skillUse!.target as string | undefined;
        const target = state.units.find((u) => u.instanceId === targetId && u.alive);
        if (target) {
          pending.push({ target, amount: skill.payload.healAmount });
          log.push({ phase: 'heal', type: 'heal', actorId: unit.instanceId, targetId: target.instanceId, detail: { amount: skill.payload.healAmount } });
        }
      }
    }
  }

  // 포탑(support3) 오라 — 별도 행동 계획 없이 매 턴 자동으로 주변 아군을 회복한다.
  for (const turret of state.units.filter((u) => u.isTurret && u.alive && u.position)) {
    const healAmount = turretType.passive?.payload?.healAmount ?? 0;
    const radius = turretType.passive?.payload?.radius ?? 1;
    const cells = radiusCells(turret.position!, radius, state.board, 'chebyshev', false);
    for (const cell of cells) {
      const occupant = state.units.find((u) => u.alive && u.position && samePosition(u.position, cell) && u.owner === turret.owner);
      if (occupant) {
        pending.push({ target: occupant, amount: healAmount });
        log.push({ phase: 'heal', type: 'turretAura', actorId: turret.instanceId, targetId: occupant.instanceId, detail: { amount: healAmount } });
      }
    }
  }

  for (const h of pending) {
    if (!h.target.alive) continue;
    h.target.currentHp = Math.min(h.target.maxHp, h.target.currentHp + h.amount);
  }
}
