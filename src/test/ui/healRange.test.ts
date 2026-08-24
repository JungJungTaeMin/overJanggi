import { describe, expect, it } from 'vitest';
import { computeHealCells } from '../../components/Planning/actionGeometry';
import { createUnitInstance } from '../../engine/createInitialState';
import { getUnitType } from '../../data/unitTypes';
import type { BoardConfig, UnitTurnPlan } from '../../engine/types';

const board: BoardConfig = {
  width: 9,
  height: 9,
  obstacles: [],
  captureZone: [],
  startZones: { p1: [], p2: [] },
};

const has = (cells: { x: number; y: number }[], x: number, y: number) => cells.some((c) => c.x === x && c.y === y);

/**
 * 범위 회복형은 **서 있는 자리가 곧 성능**인데(판당회복 195.8로 전체 최고) 그 반경이 화면에
 * 보이지 않았다. 여기서 잠그는 건 두 가지다: 반경이 데이터와 같은가, 그리고 **이동 뒤 자리**를
 * 기준으로 그리는가. 회복은 이동(1단계)보다 뒤인 4단계라 출발 칸으로 그리면 실제와 어긋난다.
 */
describe('회복 사정권 — 계획한 회복이 어디까지 닿는가', () => {
  const healSkill = getUnitType('support1').skills.find((s) => s.effectCategory === 'heal')!;
  const plan: UnitTurnPlan = { baseAction: { kind: 'none' }, skillUse: { skillId: healSkill.id } };

  it('자기중심 반경 기술은 데이터의 반경만큼 사방으로 퍼진다', () => {
    const unit = createUnitInstance('support1', 'p1', { x: 4, y: 4 });
    const radius = healSkill.payload.radius!;
    const cells = computeHealCells(unit, board, plan);

    expect(has(cells, 4 + radius, 4)).toBe(true);
    expect(has(cells, 4, 4 + radius)).toBe(true);
    expect(has(cells, 4 + radius + 1, 4)).toBe(false);
  });

  it('이동을 계획했으면 **도착 칸** 기준으로 그린다 — 회복은 이동 뒤에 일어난다', () => {
    const unit = createUnitInstance('support1', 'p1', { x: 0, y: 4 });
    const radius = healSkill.payload.radius!;
    const cells = computeHealCells(unit, board, plan, { x: 4, y: 4 });

    expect(has(cells, 4 + radius, 4)).toBe(true);
    // 출발 칸 주변은 이제 사정권 밖이다.
    expect(has(cells, 0, 4)).toBe(false);
  });

  it('직선 사거리 회복(장거리 회복형)은 같은 행·열로만 뻗는다', () => {
    const s2 = getUnitType('support2');
    const heal = s2.skills.find((s) => s.effectCategory === 'heal')!;
    const unit = createUnitInstance('support2', 'p1', { x: 4, y: 4 });
    const cells = computeHealCells(unit, board, { baseAction: { kind: 'none' }, skillUse: { skillId: heal.id } });

    expect(has(cells, 4, 0)).toBe(true); // 같은 열
    expect(has(cells, 5, 5)).toBe(false); // 대각선은 안 된다
  });

  it('회복이 아닌 기술이나 무계획이면 아무 칸도 안 그린다', () => {
    const unit = createUnitInstance('support1', 'p1', { x: 4, y: 4 });
    expect(computeHealCells(unit, board, undefined)).toEqual([]);
    expect(computeHealCells(unit, board, { baseAction: { kind: 'none' } })).toEqual([]);
    const tank = createUnitInstance('tank3', 'p1', { x: 4, y: 4 });
    expect(computeHealCells(tank, board, { baseAction: { kind: 'none' }, skillUse: { skillId: 'tank3_barrier' } })).toEqual([]);
  });
});
