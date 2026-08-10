import type { GameState, ResolutionEvent } from '../types';
import { getUnitType } from '../../data/unitTypes';
import { initCharges } from '../createInitialState';
import { isOccupied } from '../grid';

/**
 * 시간 역행 복귀 단계(dealer2). 공격 단계 **직후**에 처리한다 — 그래야 "그 턴에 맞은 피해까지
 * 되돌린다"는 기술의 취지가 성립한다(턴종료까지 미루면 회복·점령 판정이 복귀 전 위치·체력을
 * 기준으로 먼저 일어나 버린다).
 *
 * 충전을 전부 소진한 기물은 첫 사용 시점에 기록해 둔 기준점(위치·체력)으로 되돌아가고, 충전은
 * 최대치로 초기화된다. 복귀 전후의 위치와 체력을 모두 로그에 남겨 무슨 일이 있었는지 추적할 수 있다.
 */
export function resolveRewind(state: GameState, log: ResolutionEvent[]): void {
  for (const unit of state.units) {
    if (unit.typeId !== 'dealer2' || !unit.alive) continue;
    if (!unit.rewindSnapshot) continue;
    if ((unit.charges['dealer2_rewind_move'] ?? 0) !== 0) continue;

    const snapshot = unit.rewindSnapshot;
    const from = unit.position;
    const fromHp = unit.currentHp;

    // 기준점 칸을 다른 기물이 차지하고 있으면 위치는 되돌리지 못하고 체력만 되돌린다
    // (기획서 미명시 — 기물 겹침 금지 규칙을 우선하는 기본값).
    const blocked = isOccupied(snapshot.position, state.units.filter((u) => u.instanceId !== unit.instanceId));
    if (!blocked) unit.position = snapshot.position;
    unit.currentHp = Math.min(unit.maxHp, snapshot.hp);
    unit.rewindSnapshot = null;
    unit.charges = initCharges(getUnitType('dealer2'));

    log.push({
      phase: 'attack',
      type: 'rewind',
      actorId: unit.instanceId,
      detail: {
        fromPosition: from,
        toPosition: unit.position,
        fromHp,
        toHp: unit.currentHp,
        positionBlocked: blocked,
      },
    });
  }
}
