import type { ResolutionEvent, UnitInstance } from './types';
import { RESPAWN_TURNS } from '../data/constants';

/** 체력 0 이하가 된 기물을 전장에서 제거(3.4절). 쿨타임/충전/상태이상 초기화는 부활 시 처리(판단 필요 항목 #5). */
export function killUnit(unit: UnitInstance, log: ResolutionEvent[]): void {
  if (!unit.alive) return;
  unit.alive = false;
  unit.position = null;
  unit.respawnTurnsRemaining = RESPAWN_TURNS;
  unit.statusEffects = [];
  unit.shieldHp = 0;
  // dealer2 시간역행: 사망하면 기준점(복귀 지점)은 사라진다 — 되돌아갈 과거가 없어지는 셈.
  // 충전량은 여기서 건드리지 않고 부활 시점(endOfTurn.ts의 finalizeRespawn)에 최대치로 초기화된다.
  unit.rewindSnapshot = null;
  log.push({ phase: 'endOfTurn', type: 'death', actorId: unit.instanceId });
}
