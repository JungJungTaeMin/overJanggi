import type { ActionPlan, GameState, Owner, ResolutionEvent } from '../types';
import type { RngFn } from '../rng';
import { getUnitType } from '../../data/unitTypes';
import { addStatusEffect } from '../statusEffects';

/**
 * 0단계: 이동보다 **먼저** 끝나야 하는 턴 시작 처리.
 *
 * 1. support3(확률·포탑형)의 동전 결정. 앞면 이동2·공격6 / 뒷면 이동1·공격4.
 *    예전에는 공격 전 상태변화(2단계)에서 굴렸는데, 그러면 이동 단계가 참조할 수 있는 값이
 *    *지난 턴* 결과뿐이라 동전이 이동력에 영향을 줄 방법이 아예 없었다.
 *    지난 턴 동전은 먼저 지운다 — 상태이상 기본 수명이 "적용 턴 + 다음 턴"이라 그냥 두면 두 턴치가
 *    겹쳐서 `hasActiveEffect('coinHeads')`가 사실상 "둘 중 하나라도 앞면"(=75%)이 되어 버린다.
 *
 * 2. 이번 턴에 포탑을 세우는 팀의 **기존 포탑 철거**. 포탑은 **팀당 1기**(판 전체에 최대 2기)다.
 *    support3을 두 기 편성해도 그 팀 포탑은 여전히 1기이고, 나중에 세운 쪽이 남는다.
 *
 *    철거를 여기서(이동 전에) 하는 이유: 포탑은 바로 앞칸에 서므로, 2단계까지 남겨 두면 자기가
 *    세운 포탑에 스스로 길이 막혀 앞으로 나아갈 수 없다. 실제로 그래서 support3이 시작지점 근처를
 *    맴돌며 점령지에 한 번도 들어가지 못했다.
 */
export function resolveTurnStart(
  state: GameState,
  planP1: ActionPlan,
  planP2: ActionPlan,
  rngFn: RngFn,
  log: ResolutionEvent[],
): void {
  const turnNumber = state.turnNumber;

  for (const unit of state.units) {
    if (unit.typeId !== 'support3' || !unit.alive) continue;
    const chance = getUnitType(unit.typeId).passive?.payload?.headsChance ?? 0.5;
    unit.statusEffects = unit.statusEffects.filter((e) => e.type !== 'coinHeads' && e.type !== 'coinTails');
    const heads = rngFn() < chance;
    addStatusEffect(unit, heads ? 'coinHeads' : 'coinTails', turnNumber, unit.instanceId);
    log.push({ phase: 'preAttack', type: 'coinFlip', actorId: unit.instanceId, detail: { heads } });
  }

  const replacing = new Set<Owner>();
  for (const plan of [planP1, planP2]) {
    for (const [instanceId, unitPlan] of Object.entries(plan.actions)) {
      if (unitPlan.skillUse?.skillId !== 'support3_turret') continue;
      const caster = state.units.find((u) => u.instanceId === instanceId);
      if (caster?.alive) replacing.add(caster.owner);
    }
  }
  if (replacing.size > 0) {
    state.units = state.units.filter((u) => !(u.isTurret && replacing.has(u.owner)));
  }
}
