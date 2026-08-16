import type { ActionPlan, Direction, GameState, Position, ResolutionEvent, UnitInstance, UnitTurnPlan } from '../types';
import { getUnitType } from '../../data/unitTypes';
import { resolvedAttackPower } from '../unitStats';
import { ORTHOGONAL_DIRECTIONS, samePosition, step } from '../grid';
import { attackRangeFor, frontBandCells, lineCells } from '../targeting';
import { hasActiveEffect } from '../statusEffects';
import { applyDamage } from '../damage';
import { killUnit } from '../death';
import { isSkillOnlyMove } from '../movePath';

/** 이번 턴 이 기물이 실제로 수행할 공격(= 기본 행동 공격). */
type AttackIntent =
  | { kind: 'attack'; direction: Direction; afterSkillMove: boolean }
  | { kind: 'attackAt'; targetCell: Position; afterSkillMove: boolean };

/**
 * 기본 행동이 공격이면 그 공격이 이번 턴의 공격이다.
 * **기술 이동(skillMove)을 함께 계획했다면** 이동 단계에서 기술로 옮겨 간 **도착 칸**에서 쏘게 된다 —
 * 이 함수가 불리는 시점에는 이미 이동이 끝나 unit.position이 도착 칸이므로 별도 처리가 필요 없다.
 */
function attackIntentOf(unitPlan: UnitTurnPlan): AttackIntent | null {
  const base = unitPlan.baseAction;
  const afterSkillMove = isSkillOnlyMove(unitPlan);
  if (base.kind === 'attack') return { kind: 'attack', direction: base.direction, afterSkillMove };
  if (base.kind === 'attackAt') return { kind: 'attackAt', targetCell: base.targetCell, afterSkillMove };
  return null;
}

/**
 * 3단계: 공격(3.4절, 3.6절). 우선순위(이동 단계와 동일한 순서) 순서대로 기물을 한 번에 하나씩
 * 완전히 공격시킨다 — 피해는 즉시 적용하고, 사망도 즉시 처리한다. 이미 사망한 기물은 이후 자신의
 * 공격을 수행하지 않는다(3.6절 "사망한 기물은 해당 턴의 이후 행동을 수행하지 않는다").
 * 이 방식은 상호킬을 자동으로 우선순위 승자의 일방적 킬로 귀결시킨다 — 두 유닛이 서로를 죽일 화력을
 * 갖고 있어도, 먼저 처리되는(우선순위가 높은) 쪽이 상대를 죽이면 상대는 이미 죽어 자신의 공격을
 * 수행하지 못한다.
 *
 * 방벽(8장, 판단 필요 항목 재검토): 이전에는 1회 피격 시 소멸했으나, 기획서 v0.3은 방벽이
 * 지속시간(1턴) 동안 유지되며 자연 만료로만 사라진다고 명시한다 — 따라서 여기서는 방벽을
 * 소모(consume)하지 않고 단순히 피해만 무효화한다. 또한 범위형(AoE) 공격은 방벽을 무시하고
 * 관통한다(직선 단일대상 공격만 방벽에 막힌다).
 */
export function resolveAttacks(
  state: GameState,
  planP1: ActionPlan,
  planP2: ActionPlan,
  priorityOrder: string[],
  log: ResolutionEvent[],
): void {
  const turnNumber = state.turnNumber;

  const plansById = new Map<string, UnitTurnPlan>();
  for (const plan of [planP1, planP2]) {
    for (const [instanceId, unitPlan] of Object.entries(plan.actions)) {
      plansById.set(instanceId, unitPlan);
    }
  }

  for (const instanceId of priorityOrder) {
    const unitPlan = plansById.get(instanceId);
    if (!unitPlan) continue;
    const action = attackIntentOf(unitPlan);
    const wantsToAttack = !!action;
    const unit = state.units.find((u) => u.instanceId === instanceId);
    if (!unit || !unit.alive || !unit.position) {
      // 공격을 계획했지만 이동·공격전 단계, 혹은 공격 단계 내 자기 차례 이전에 이미 사망해 공격을
      // 수행하지 못한 기물을 로그에 남긴다(§3.6 "사망한 기물은 해당 턴의 이후 행동을 수행하지
      // 않는다", §9 UI 표시 요구사항).
      if (unit && !unit.alive && wantsToAttack) {
        log.push({ phase: 'attack', type: 'cancelledByDeath', actorId: unit.instanceId });
      }
      continue;
    }

    if (!action) continue;
    const typeDef = getUnitType(unit.typeId);
    if (!typeDef.canAttack) continue;
    if (unit.typeId === 'dealer3' && !hasActiveEffect(unit, 'attackMode', turnNumber)) continue;

    if (action.afterSkillMove) {
      // 기술로 파고든 자리에서 쏘는 공격 — 어디서 쐈는지가 로그에서 바로 보여야 한다.
      log.push({
        phase: 'attack',
        type: 'skillMoveAttack',
        actorId: unit.instanceId,
        detail: { from: unit.position, direction: action.kind === 'attack' ? action.direction : undefined },
      });
    }

    const attackPower = resolvedAttackPower(unit, turnNumber);
    const shape = typeDef.attackShape;

    if (shape.kind === 'aoe' && shape.aoeShape === 'line' && action.kind === 'attack') {
      // tank3: 전방 1칸 + 좌우 1칸 범위. 범위형 공격은 방벽을 무시하고 관통한다(8장).
      const cells = frontBandCells(unit.position, action.direction, state.board);
      for (const cell of cells) {
        const occupant = state.units.find((u) => u.alive && u.position && samePosition(u.position, cell) && u.owner !== unit.owner);
        if (!occupant) continue;
        applyDamage(occupant, attackPower);
        log.push({ phase: 'attack', type: 'hit', actorId: unit.instanceId, targetId: occupant.instanceId, detail: { damage: attackPower } });
        if (occupant.currentHp <= 0 && occupant.alive) killUnit(occupant, log);
      }
    } else if (shape.kind === 'line' && action.kind === 'attack') {
      // 사거리는 방향마다 다를 수 있다(dealer3: 직선 4 · 대각 1) — attackRangeFor가 단일 근거다.
      const cells = lineCells(unit.position, action.direction, attackRangeFor(shape, action.direction), state.board);
      for (const cell of cells) {
        const occupant = state.units.find((u) => u.alive && u.position && samePosition(u.position, cell));
        if (!occupant) continue;
        if (occupant.owner === unit.owner) break; // 아군을 만나면 사선이 막힘
        if (hasActiveEffect(occupant, 'barrier', turnNumber)) {
          log.push({ phase: 'attack', type: 'blockedByBarrier', actorId: unit.instanceId, targetId: occupant.instanceId });
          break;
        }
        let amount = attackPower;
        // 측면 교란(dealer4): 대상이 자기 아군과 인접해 있으면 추가 피해. 조건 충족 여부를 로그에
        // 남긴다 — 이게 없으면 피해 숫자만 보고 보너스가 터졌는지 되짚을 수 없고(버프까지 얹히면
        // 더더욱), 실제로 "조건부 패시브가 사실상 상시인지"를 재려다 이게 막혀 로그부터 고쳤다.
        const flank = unit.typeId === 'dealer4' && hasAdjacentAlly(occupant, state.units);
        if (flank) amount += typeDef.passive?.payload?.bonusDamage ?? 0;
        applyDamage(occupant, amount);
        log.push({
          phase: 'attack',
          type: 'hit',
          actorId: unit.instanceId,
          targetId: occupant.instanceId,
          detail: { damage: amount, ...(unit.typeId === 'dealer4' ? { flank } : {}) },
        });
        if (occupant.currentHp <= 0 && occupant.alive) killUnit(occupant, log);
        break; // 직선 공격은 처음 만난 적 1명만 대상으로 한다
      }
      // 사거리 안에 적이 없어도 공격 행동 자체는 정상 해결(3.4절) — 별도 처리 불필요
    }

    // 탄창식 기본 공격(딜러1): attackShots발을 연속으로 쏜 뒤에만 쉰다. 쏜 횟수는 charges에 센다
    // — 부활 시 charges가 initCharges로 초기화되므로(endOfTurn) 되살아난 기물은 탄창이 꽉 찬 상태다.
    if (typeDef.attackRestTurns) {
      const magazine = typeDef.attackShots ?? 1;
      const fired = (unit.charges['basicAttack'] ?? 0) + 1;
      if (fired >= magazine) {
        // +1인 이유: 이 턴 끝에서 쿨다운이 곧바로 1 깎인다(endOfTurn 4번). 한 턴을 쉬게 하려면 2를 넣어야 한다.
        unit.cooldowns['basicAttack'] = typeDef.attackRestTurns + 1;
        unit.charges['basicAttack'] = 0;
      } else {
        unit.charges['basicAttack'] = fired;
      }
    }
  }
}

function hasAdjacentAlly(target: UnitInstance, units: UnitInstance[]): boolean {
  if (!target.position) return false;
  return ORTHOGONAL_DIRECTIONS.some((dir) => {
    const adj = step(target.position!, dir);
    return units.some((u) => u.alive && u.instanceId !== target.instanceId && u.owner === target.owner && u.position && samePosition(u.position, adj));
  });
}
