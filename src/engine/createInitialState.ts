import { nanoid } from 'nanoid';
import type { BoardConfig, GameState, Owner, Position, UnitInstance, UnitTypeDef } from './types';
import { getUnitType, maxHpFor } from '../data/unitTypes';
import { mapDefinition } from '../data/mapDefinitions';

export function initCharges(typeDef: UnitTypeDef): Record<string, number> {
  const charges: Record<string, number> = {};
  for (const skill of typeDef.skills) {
    if (skill.gate.type === 'charge') charges[skill.id] = skill.gate.maxCharges;
  }
  return charges;
}

export function createUnitInstance(typeId: string, owner: Owner, position: Position | null): UnitInstance {
  const typeDef = getUnitType(typeId);
  const maxHp = maxHpFor(typeDef);
  return {
    instanceId: nanoid(8),
    typeId,
    owner,
    position,
    currentHp: maxHp,
    maxHp,
    shieldHp: 0,
    alive: true,
    respawnTurnsRemaining: null,
    cooldowns: {},
    charges: initCharges(typeDef),
    statusEffects: [],
    // 포탑 여부는 타입에서 그대로 물려받는다. 이 플래그가 비어 있으면 포탑이 계획 패널에 끼어들고
    // (plansForTurn/ActionPanel이 isTurret으로 거른다) 회복 오라(healing.ts)도 아예 돌지 않는다.
    ...(typeDef.isTurret ? { isTurret: true } : {}),
    rewindSnapshot: null,
  };
}

export function createInitialState(
  p1Types: string[],
  p2Types: string[],
  p1Positions: (Position | null)[],
  p2Positions: (Position | null)[],
  board: BoardConfig = mapDefinition,
): GameState {
  const p1Units = p1Types.map((t, i) => createUnitInstance(t, 'p1', p1Positions[i] ?? null));
  const p2Units = p2Types.map((t, i) => createUnitInstance(t, 'p2', p2Positions[i] ?? null));
  return {
    turnNumber: 1,
    phase: 'planning',
    board,
    units: [...p1Units, ...p2Units],
    score: { p1: 0, p2: 0 },
    winner: null,
    lastPriorityOrder: null,
    log: [],
  };
}
