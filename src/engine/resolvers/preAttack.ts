import type { ActionPlan, Direction, GameState, ResolutionEvent } from '../types';
import { getUnitType } from '../../data/unitTypes';
import { addStatusEffect, hasActiveEffect } from '../statusEffects';
import { samePosition, step } from '../grid';
import { createUnitInstance } from '../createInitialState';

/** 2단계: 방벽·구속·공격모드 등 공격 전 상태변화(3.2절) */
export function resolvePreAttack(state: GameState, planP1: ActionPlan, planP2: ActionPlan, log: ResolutionEvent[]): void {
  const turnNumber = state.turnNumber;

  // support3: 턴 시작 시 동전 결정(매 턴 자동, 스킬 사용 여부와 무관)
  for (const unit of state.units) {
    if (unit.typeId !== 'support3' || !unit.alive) continue;
    const typeDef = getUnitType('support3');
    const chance = typeDef.passive?.payload?.headsChance ?? 0.5;
    const heads = Math.random() < chance;
    addStatusEffect(unit, heads ? 'coinHeads' : 'coinTails', turnNumber, unit.instanceId);
    log.push({ phase: 'preAttack', type: 'coinFlip', actorId: unit.instanceId, detail: { heads } });
  }

  for (const plan of [planP1, planP2]) {
    for (const [instanceId, unitPlan] of Object.entries(plan.actions)) {
      if (!unitPlan.skillUse) continue;
      const unit = state.units.find((u) => u.instanceId === instanceId);
      if (!unit || !unit.alive) continue;
      const typeDef = getUnitType(unit.typeId);
      const skill = typeDef.skills.find((s) => s.id === unitPlan.skillUse!.skillId);
      if (!skill || skill.effectCategory !== 'preAttack') continue;

      if (skill.id === 'tank3_barrier') {
        addStatusEffect(unit, 'barrier', turnNumber, unit.instanceId);
        unit.cooldowns[skill.id] = 1;
        log.push({ phase: 'preAttack', type: 'barrier', actorId: unit.instanceId });
      } else if (skill.id === 'tank3_root' || skill.id === 'support2_root') {
        const targetId = unitPlan.skillUse!.target as string | undefined;
        const target = state.units.find((u) => u.instanceId === targetId && u.alive);
        if (target) addStatusEffect(target, 'root', turnNumber, unit.instanceId);
        if (skill.id === 'tank3_root') unit.cooldowns[skill.id] = 5;
        log.push({ phase: 'preAttack', type: 'root', actorId: unit.instanceId, targetId });
      } else if (skill.id === 'dealer3_attack_mode') {
        const currentlyOn = hasActiveEffect(unit, 'attackMode', turnNumber);
        if (currentlyOn) {
          unit.statusEffects = unit.statusEffects.filter((e) => e.type !== 'attackMode');
        } else {
          addStatusEffect(unit, 'attackMode', turnNumber, unit.instanceId);
        }
        log.push({ phase: 'preAttack', type: 'toggle', actorId: unit.instanceId, detail: { on: !currentlyOn } });
      } else if (skill.id === 'support3_turret') {
        const frontDir = unitPlan.skillUse!.target as Direction | undefined;
        if (unit.position && frontDir) {
          const cell = step(unit.position, frontDir);
          const occupied = state.units.some((u) => u.alive && u.position && samePosition(u.position, cell));
          if (!occupied) {
            const turret = createUnitInstance('turret', unit.owner, cell);
            state.units.push(turret);
            log.push({ phase: 'preAttack', type: 'turretSpawn', actorId: unit.instanceId, detail: { at: cell } });
          }
        }
      }
    }
  }
}
