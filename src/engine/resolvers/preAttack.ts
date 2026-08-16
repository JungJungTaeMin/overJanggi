import type { ActionPlan, Direction, GameState, ResolutionEvent } from '../types';
import { getUnitType } from '../../data/unitTypes';
import { addStatusEffect, hasActiveEffect } from '../statusEffects';
import { samePosition, step } from '../grid';
import { canTargetWithSkill } from '../skillRange';
import { createUnitInstance } from '../createInitialState';

/** 2단계: 방벽·구속·공격모드 등 공격 전 상태변화(3.2절) */
export function resolvePreAttack(state: GameState, planP1: ActionPlan, planP2: ActionPlan, log: ResolutionEvent[]): void {
  const turnNumber = state.turnNumber;

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
        // 사거리는 이 단계(이동 직후) 기준으로 다시 본다 — 계획 시점에 닿았어도 대상이 달아났으면
        // 빗나간다. 쿨타임은 빗나가도 소모된다: 기술을 쓰기로 한 것 자체가 이번 턴의 선택이었다.
        const inRange = !!target && canTargetWithSkill(unit, target, skill, state.board);
        // 두 구속의 강도가 다르다: tank3은 발만 묶고(root), support2는 그 턴을 통째로 날린다(stun).
        // support2가 더 센 이유는 이 기물이 공격을 아예 못 하기 때문이다 — 유일한 방해 수단이다.
        const effect = skill.id === 'support2_root' ? 'stun' : 'root';
        if (target && inRange) addStatusEffect(target, effect, turnNumber, unit.instanceId);
        if (skill.id === 'tank3_root') unit.cooldowns[skill.id] = 5;
        log.push({ phase: 'preAttack', type: effect, actorId: unit.instanceId, targetId, detail: { landed: inRange } });
      } else if (skill.id === 'support2_buff') {
        // 조준 보조: 사선 위 아군 1명의 공격력을 올린다. 구속과 같은 이유로 사거리를 여기서 다시 보고,
        // 대상이 **자기 팀의 다른 기물**인지까지 확인한다 — 적을 강화하거나 자기 자신을 지정하면 안 된다
        // (support2는 공격 자체를 못 하므로 자가 버프는 그냥 턴 낭비다).
        const targetId = unitPlan.skillUse!.target as string | undefined;
        const target = state.units.find(
          (u) => u.instanceId === targetId && u.alive && u.owner === unit.owner && u.instanceId !== unit.instanceId,
        );
        const bonus = skill.payload.attackBonus ?? 0;
        const landed = !!target && canTargetWithSkill(unit, target, skill, state.board);
        if (target && landed) addStatusEffect(target, 'buff', turnNumber, unit.instanceId, bonus);
        log.push({
          phase: 'preAttack',
          type: 'buff',
          actorId: unit.instanceId,
          targetId,
          detail: { landed, amount: landed ? bonus : 0 },
        });
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
            // 포탑은 **팀당 1기**. 이번 턴 설치를 계획한 팀의 기존 포탑은 이미 턴 시작
            // 단계(turnStart.ts)에서 철거됐지만, 같은 팀 support3이 두 기라면 이 루프 안에서
            // 둘 다 세우려 든다 — 그래서 설치 시점에도 같은 팀 포탑을 걷어내 불변식을 지킨다.
            state.units = state.units.filter((u) => !(u.isTurret && u.owner === unit.owner));
            const turret = createUnitInstance('turret', unit.owner, cell);
            state.units.push(turret);
            log.push({ phase: 'preAttack', type: 'turretSpawn', actorId: unit.instanceId, detail: { at: cell } });
          }
        }
      }
    }
  }
}
