import type { ActionPlan, GameState, ResolutionEvent, UnitInstance } from '../types';
import { getUnitType, turretType } from '../../data/unitTypes';
import { radiusCells } from '../targeting';
import { canTargetWithSkill } from '../skillRange';
import { healPackAt, key, samePosition } from '../grid';
import { veilAt, veilBetween } from '../veil';
import { HEAL_PACK_RESPAWN_TURNS } from '../../data/constants';

interface PendingHeal {
  target: UnitInstance;
  amount: number;
}

/** 4단계: 회복(3.2절). 3단계 종료 후 HP를 스냅샷하고 끝에 일괄 적용 — 이미 죽은 대상 힐은 무효가 된다. */
export function resolveHealing(state: GameState, planP1: ActionPlan, planP2: ActionPlan, log: ResolutionEvent[]): void {
  const pending: PendingHeal[] = [];
  const turnNumber = state.turnNumber;

  /**
   * 차단막(러너)이 이 회복을 지우는가. 지운다면 그 사실을 로그에 남기고 true를 돌려준다 —
   * 회복은 판 위에 흔적이 거의 남지 않아서, 그냥 조용히 빼면 "힐을 썼는데 체력이 안 올랐다"가 된다.
   * 시전 칸은 빼고 도착 칸은 포함해서 보는 규칙은 veil.ts 한 곳에만 있다.
   */
  const veiled = (caster: UnitInstance, target: UnitInstance): boolean => {
    if (!caster.position || !target.position) return false;
    const blocker = veilBetween(caster.position, target.position, state.units, turnNumber);
    if (!blocker) return false;
    log.push({
      phase: 'heal',
      type: 'blockedByVeil',
      actorId: caster.instanceId,
      targetId: target.instanceId,
      detail: { blockerId: blocker.instanceId },
    });
    return true;
  };

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
          if (veiled(unit, occupant)) continue;
          pending.push({ target: occupant, amount: skill.payload.healAmount });
          log.push({ phase: 'heal', type: 'heal', actorId: unit.instanceId, targetId: occupant.instanceId, detail: { amount: skill.payload.healAmount } });
        }
        // 턴 종료 시 자동회복 2배 적용을 위한 이번 턴 표식 (같은 턴에만 유효)
        unit.statusEffects.push({ type: 'healedThisTurn', appliedOnTurn: state.turnNumber, expiresAfterTurn: state.turnNumber, sourceId: unit.instanceId });
      } else if (skill.id === 'support2_heal') {
        const targetId = unitPlan.skillUse!.target as string | undefined;
        const target = state.units.find((u) => u.instanceId === targetId && u.alive);
        // 사거리(직선 N칸, 장애물이 시야를 막으면 불가)는 여기서 반드시 다시 본다 — validation이
        // 이미 걸렀더라도 이 단계는 **이동이 끝난 뒤**라, 계획 시점에는 닿았던 대상이 서로
        // 움직여서 벌어졌을 수 있다. 사거리는 회복이 실제로 일어나는 시점 기준이어야 한다.
        if (target && canTargetWithSkill(unit, target, skill, state.board) && !veiled(unit, target)) {
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
      if (occupant && !veiled(turret, occupant)) {
        pending.push({ target: occupant, amount: healAmount });
        log.push({ phase: 'heal', type: 'turretAura', actorId: turret.instanceId, targetId: occupant.instanceId, detail: { amount: healAmount } });
      }
    }
  }

  // 힐팩(맵 메이커 전용 지형) — 회복 단계에 그 칸 위에 서 있는 기물이 자동으로 먹는다.
  //
  // 이동(1단계)이 끝난 뒤 판정하므로 "힐팩까지 걸어가서 먹는" 계획이 성립하고, 공격(3단계)
  // 뒤이므로 그 턴에 맞은 피해까지 메워 준다. 반대로 **그 턴에 죽었으면 못 먹는다** — 아래
  // `alive` 검사가 그 역할을 한다. 기물이 계획할 행동이 아니라 지형 효과라서 ActionPlan을
  // 보지 않고 보드와 위치만 본다.
  for (const unit of state.units) {
    if (!unit.alive || !unit.position) continue;
    const pack = healPackAt(unit.position, state.board);
    if (!pack) continue;
    // 비어 있는(재생성 대기 중인) 힐팩은 밟아도 아무 일이 없다.
    if ((state.healPackTimers[key(unit.position)] ?? 0) > 0) continue;
    // 체력이 꽉 찬 기물은 **소모하지 않는다**. 안 그러면 온전한 기물이 지나가다 밟는 것만으로
    // 팀의 자원이 사라져, 힐팩 위를 지나는 경로 자체가 실수가 된다.
    if (unit.currentHp >= unit.maxHp) continue;
    /**
     * 차단막이 덮은 칸의 힐팩은 먹히지 않는다 — 규칙을 "덮인 칸에서는 회복이 일어나지 않는다"
     * 한 줄로 유지하려면 시전자가 없는 지형 회복도 예외가 될 수 없다. 대신 **소모도 되지 않는다**:
     * 아래 타이머 설정을 건너뛰므로 러너가 비켜난 뒤 다시 먹을 수 있다.
     */
    if (veilAt(unit.position, state.units, turnNumber)) continue;
    pending.push({ target: unit, amount: pack.amount });
    state.healPackTimers[key(unit.position)] = HEAL_PACK_RESPAWN_TURNS + 1; // +1: 이 턴 끝에서 곧바로 1 깎인다
    log.push({ phase: 'heal', type: 'healPack', actorId: unit.instanceId, targetId: unit.instanceId, detail: { amount: pack.amount, at: unit.position } });
  }

  for (const h of pending) {
    if (!h.target.alive) continue;
    h.target.currentHp = Math.min(h.target.maxHp, h.target.currentHp + h.amount);
  }
}
