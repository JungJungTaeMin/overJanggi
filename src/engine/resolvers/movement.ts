import type { ActionPlan, Direction, GameState, Position, ResolutionEvent, UnitInstance } from '../types';
import { getUnitType } from '../../data/unitTypes';
import { HP_MULTIPLIER } from '../../data/constants';
import { inBounds, isObstacle, samePosition, step } from '../grid';
import { addStatusEffect, sumMagnitude } from '../statusEffects';
import { killUnit } from '../death';
import { applyDamage } from '../damage';
import { isSkillOnlyMove, plannedChargeUses, resolveMovePath } from '../movePath';
import { resolvedMoveSpeed } from '../unitStats';
import { canTargetWithSkill } from '../skillRange';

interface MoveIntent {
  unit: UnitInstance;
  /** 스텝별 이동 방향(칸마다 자유롭게 꺾을 수 있다). 길이가 곧 이동 칸수. */
  path: Direction[];
  isDash: boolean;
}

/** 정적 지형(경계·장애물)만으로 막히는지. 기물 점유 여부는 보지 않는다. */
function isPassableTerrain(state: GameState, p: Position): boolean {
  return inBounds(p, state.board) && !isObstacle(p, state.board);
}

function occupantAt(state: GameState, excludeInstanceId: string, p: Position): UnitInstance | undefined {
  return state.units.find((u) => u.alive && u.instanceId !== excludeInstanceId && u.position && samePosition(u.position, p));
}

/**
 * 1단계: 이동 및 이동 관련 기술(3.2절, 3.2.1절, 3.3절). 턴 우선순위(이동 Lv desc 등) 순서로
 * 기물을 한 번에 하나씩 완전히 이동시킨다 — 먼저 처리된 기물이 도착한 칸은 나중에 처리되는
 * 기물에게 그대로 장애물로 작용하며, 이 자연스러운 순차 처리만으로 3.6절의 충돌 규칙
 * ("선공 우선순위가 높은 기물이 칸을 차지하고, 후순위는 가장 가까운 유효 위치에서 멈춘다")이 성립한다.
 */
export function resolveMovement(
  state: GameState,
  planP1: ActionPlan,
  planP2: ActionPlan,
  priorityOrder: string[],
  log: ResolutionEvent[],
): void {
  const turnNumber = state.turnNumber;
  /**
   * dealer2 시간역행으로 이번 턴에만 늘어난 이동 칸수(instanceId → 칸수).
   * tank1/tank2의 이동 버프처럼 `moveBonus` 상태이상으로 주지 않는 이유: 상태이상의 "1턴 동안"은
   * 적용 턴과 그 다음 턴까지 유효한데(statusEffects.ts), 충전형인 시간역행이 그렇게 남으면
   * 다음 턴에 충전을 쓰지 않고도 추가 칸을 그대로 누리게 된다(복귀 직후 충전이 3/3으로 초기화되므로
   * 최대 9칸까지 가능해진다). 충전 1개 = 그 턴 1칸이라는 규칙을 지키려면 이번 턴 안에서만 살아야 한다.
   */
  const rewindExtraMove = new Map<string, number>();

  // 1) 이동 계열 기술(tank1 방어태세, tank2 돌진, dealer2 추가이동, dealer4 자리교체)의 버프/충전 처리
  for (const plan of [planP1, planP2]) {
    for (const [instanceId, unitPlan] of Object.entries(plan.actions)) {
      const unit = state.units.find((u) => u.instanceId === instanceId);
      if (!unit || !unit.alive || !unitPlan.skillUse) continue;
      const typeDef = getUnitType(unit.typeId);
      const skill = typeDef.skills.find((s) => s.id === unitPlan.skillUse!.skillId);
      if (!skill || skill.effectCategory !== 'movement') continue;

      if (skill.id === 'tank1_fortify') {
        // §6/§7.1: 체력 Lv 증가는 (a) 최대 체력을 배율만큼 늘리고 현재 체력도 같이 늘리는 효과와
        // (b) 동일한 양의 별도 "보호막 체력"을 함께("함께 부여") 준다 — 이전 판단 필요 항목이 아니라
        // 문서에 확정된 규칙. 지속시간 만료 시 늘어난 최대 체력과 남은 보호막을 함께 제거한다(§8, endOfTurn.ts).
        const bonusAmount = skill.payload.hpBonus * HP_MULTIPLIER;
        unit.maxHp += bonusAmount;
        unit.currentHp += bonusAmount;
        unit.shieldHp += bonusAmount;
        addStatusEffect(unit, 'moveBonus', turnNumber, unit.instanceId, skill.payload.moveBonus);
        addStatusEffect(unit, 'shield', turnNumber, unit.instanceId, bonusAmount);
        addStatusEffect(unit, 'hpBuff', turnNumber, unit.instanceId, bonusAmount);
        unit.cooldowns[skill.id] = 3;
        log.push({ phase: 'movement', type: 'skill', actorId: unit.instanceId, detail: { skillId: skill.id, shieldAmount: bonusAmount, hpBonus: bonusAmount } });
      } else if (skill.id === 'tank2_charge') {
        addStatusEffect(unit, 'moveBonus', turnNumber, unit.instanceId, skill.payload.moveBonus);
        unit.cooldowns[skill.id] = 2;
        log.push({ phase: 'movement', type: 'skill', actorId: unit.instanceId, detail: { skillId: skill.id } });
      } else if (skill.id === 'dealer2_rewind_move') {
        // 충전 1개 = "이동을 한 번 더" = 이동 Lv(3칸)만큼 추가 이동. 한 턴에 3개까지 한꺼번에 쓸 수
        // 있으므로 최대 3 + 3×3 = 12칸까지 움직인다.
        const uses = plannedChargeUses(unit, unitPlan.skillUse);
        if (uses <= 0) continue;
        // 첫 사용 시점의 위치·체력을 자동으로 기준점(스냅샷)으로 기록한다 — 이미 기준점이 있으면
        // 갱신하지 않는다(복귀 지점은 "처음 사용한 그 순간"이어야 하므로).
        if (!unit.rewindSnapshot && unit.position) {
          unit.rewindSnapshot = { position: unit.position, hp: unit.currentHp };
          log.push({
            phase: 'movement',
            type: 'rewindAnchor',
            actorId: unit.instanceId,
            detail: { at: unit.position, hp: unit.currentHp },
          });
        }
        unit.charges[skill.id] = Math.max(0, (unit.charges[skill.id] ?? 0) - uses);
        rewindExtraMove.set(unit.instanceId, uses * typeDef.moveSpeed * (skill.payload.extraMoveMultiple ?? 1));
        log.push({
          phase: 'movement',
          type: 'skill',
          actorId: unit.instanceId,
          detail: { skillId: skill.id, uses, chargesLeft: unit.charges[skill.id] },
        });
      } else if (skill.id === 'dealer4_swap') {
        const targetId = unitPlan.skillUse!.target as string | undefined;
        const ally = state.units.find((u) => u.instanceId === targetId && u.alive && u.owner === unit.owner);
        // 자리교체는 **대각선 3칸 이내**만(기획서 7장). 이 검사가 없던 동안 dealer4는 맵 어디로든
        // 순간이동할 수 있었다. 여기는 이동 단계 맨 앞이라 아직 아무도 움직이지 않았고, 자리교체
        // 자체가 곧 이동이므로 턴 시작 위치 기준으로 판정하는 것이 맞다.
        if (ally && unit.position && ally.position && canTargetWithSkill(unit, ally, skill, state.board)) {
          const tmp = unit.position;
          unit.position = ally.position;
          ally.position = tmp;
          unit.cooldowns[skill.id] = 3;
          log.push({ phase: 'movement', type: 'swap', actorId: unit.instanceId, targetId: ally.instanceId });
        }
      }
    }
  }

  // 2) 이동 의도 수집 — 기본 행동 이동 + "기술이 만든 이동"(기본 행동이 공격인 경우)
  const intentsById = new Map<string, MoveIntent>();
  for (const plan of [planP1, planP2]) {
    for (const [instanceId, unitPlan] of Object.entries(plan.actions)) {
      const skillOnly = isSkillOnlyMove(unitPlan);
      if (unitPlan.baseAction.kind !== 'move' && !skillOnly) continue;
      const unit = state.units.find((u) => u.instanceId === instanceId);
      if (!unit || !unit.alive || !unit.position) continue;
      // tank1/tank2의 이동 버프는 위 1)에서 moveBonus 상태이상으로 반영됐고, dealer2 시간역행은
      // 이번 턴 한정이라 별도 맵에 담겨 있다 — 둘을 더해야 이번 턴 실제 이동 한계가 나온다.
      // 기술 이동만 하는 계획(기본 행동 = 공격)에는 기본 이동 몫이 없어 기술이 준 칸수가 전부다.
      const extra = rewindExtraMove.get(instanceId) ?? 0;
      // 해결 단계이므로 이번 턴 동전 결과가 반영된 실제 이동력을 쓴다(support3 외에는 typeDef와 동일).
      const cap = skillOnly ? extra : resolvedMoveSpeed(unit, turnNumber) + sumMagnitude(unit, 'moveBonus', turnNumber) + extra;
      intentsById.set(instanceId, {
        unit,
        path: resolveMovePath(unit, unitPlan, cap),
        // tank2 돌진 피해는 "기본 이동을 돌진으로 하는" 효과라 기술 이동에는 붙지 않는다.
        // 기술 id까지 확인한다 — tank2에 다른 기술이 생겨도 그걸 돌진으로 오인하지 않게.
        isDash: !skillOnly && unit.typeId === 'tank2' && unitPlan.skillUse?.skillId === 'tank2_charge',
      });
    }
  }

  // 3) 우선순위 순서대로 한 기물씩 완전히 이동시킨다.
  for (const instanceId of priorityOrder) {
    const intent = intentsById.get(instanceId);
    if (!intent || !intent.unit.alive || intent.path.length === 0) continue;

    const movedCells: Position[] = [];
    /**
     * 돌진으로 밟고 지나간 적. **칸 순서대로** 담아 두는 이유는, 마지막에 정지 칸을 뒤로 물릴 때
     * 실제로는 지나가지 않은 적을 같이 잘라내야 하기 때문이다(아래 (c) 참고).
     */
    const trampled: UnitInstance[] = [];
    let current = intent.unit.position!;
    for (const dir of intent.path) {
      const next = step(current, dir);
      // 정적 지형은 돌진이든 아니든 통과 불가 — 벽을 뚫는 기술이 아니다.
      if (!isPassableTerrain(state, next)) break;
      const occupant = occupantAt(state, intent.unit.instanceId, next);
      // 돌진은 **적만** 밟고 지나간다. 아군은 그대로 막는다(아군을 통과하면 돌진이 아니라 순간이동이 된다).
      if (occupant && (!intent.isDash || occupant.owner === intent.unit.owner)) break;
      if (occupant) trampled.push(occupant);
      current = next;
      movedCells.push(current);
    }
    // (c) 밟고 지나간 적 **위에서 멈출 수는 없다** — 정지 칸이 점유돼 있으면 비어 있는 마지막 칸까지
    // 되돌린다. movedCells도 함께 줄여야 "이동 칸수 = 피해량"이 실제 이동과 어긋나지 않는다.
    while (movedCells.length > 0 && occupantAt(state, intent.unit.instanceId, movedCells[movedCells.length - 1])) {
      const droppedCell = movedCells.pop()!;
      const lastTrampled = trampled[trampled.length - 1];
      if (lastTrampled?.position && samePosition(lastTrampled.position, droppedCell)) trampled.pop();
    }
    if (movedCells.length === 0) continue;
    current = movedCells[movedCells.length - 1];

    intent.unit.position = current;
    log.push({
      phase: 'movement',
      type: 'move',
      actorId: intent.unit.instanceId,
      detail: { to: current, cellsMoved: movedCells.length },
    });

    /**
     * tank2 돌진(§7.1 "경로의 적에게 이동 칸수만큼 피해"): 밟고 지나간 적 전원에게 실제 이동 칸수만큼.
     * 피해는 **이동이 다 끝난 뒤** 한 번에 적용한다 — 스텝마다 즉시 적용하면 "밟아서 죽인 칸에 설 수
     * 있는가"에 따라 이동 칸수(=피해량)가 달라져 순환 참조가 생긴다. 지금 규칙에서는 밟아 죽여도
     * 그 칸을 차지하지 못한다.
     * 방벽(barrier)은 attacks.ts의 직선 공격에서만 검사하므로 돌진 피해는 방벽을 무시한다
     * (범위공격이 방벽을 관통하는 기존 규칙과 같은 결). 보호막(shieldHp)은 applyDamage가 공통으로 처리.
     */
    if (intent.isDash) {
      const dealtTo = new Set<string>();
      for (const enemy of trampled) {
        if (dealtTo.has(enemy.instanceId) || !enemy.alive) continue;
        dealtTo.add(enemy.instanceId);
        applyDamage(enemy, movedCells.length);
        log.push({
          phase: 'movement',
          type: 'dashDamage',
          actorId: intent.unit.instanceId,
          targetId: enemy.instanceId,
          detail: { damage: movedCells.length },
        });
        if (enemy.currentHp <= 0) killUnit(enemy, log);
      }
    }
  }
}
