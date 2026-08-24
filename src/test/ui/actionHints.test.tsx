import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { UnitActionSelector } from '../../components/Planning/UnitActionSelector';
import { createUnitInstance } from '../../engine/createInitialState';
import { addStatusEffect } from '../../engine/statusEffects';
import type { BoardConfig, UnitInstance, UnitTurnPlan } from '../../engine/types';

const board: BoardConfig = {
  width: 9,
  height: 9,
  obstacles: [],
  captureZone: [],
  startZones: { p1: [], p2: [] },
};

const noop = () => {};

function renderSelector(unit: UnitInstance, plan: UnitTurnPlan, turnNumber = 1) {
  return render(
    <UnitActionSelector
      unit={unit}
      allUnits={[unit]}
      board={board}
      turnNumber={turnNumber}
      plan={plan}
      onBaseAction={noop}
      onSkillUse={noop}
      onSkillMove={noop}
    />,
  );
}

const idle: UnitTurnPlan = { baseAction: { kind: 'none' } };

/**
 * 화면이 **왜 이 선택지가 없는지**를 말해 주지 않으면 플레이어는 버그로 읽는다. 여기서 잠그는 건
 * 두 가지다: 공격을 못 하는 기물이 그 사실을 말하는가, 그리고 공격 모드의 **대가**(이동 불가)가
 * 켜진 동안 보이는가. 후자는 토글이 같은 턴에 즉시 반영되므로 "이번 턴 계획"까지 반영해야 한다.
 */
describe('조작 안내 — 못 하는 것의 이유를 말해 주는가', () => {
  it('공격 불가 기물은 선택지를 숨기는 데 그치지 않고 이유를 말한다', () => {
    const s2 = createUnitInstance('support2', 'p1', { x: 4, y: 4 });
    const { container } = renderSelector(s2, idle);

    expect([...container.querySelectorAll('option')].map((o) => o.textContent)).not.toContain('공격');
    expect(container.textContent).toContain('공격을 못 합니다');
  });

  it('공격 모드가 꺼져 있으면 "이동만 가능"이라고 알린다', () => {
    const d3 = createUnitInstance('dealer3', 'p1', { x: 4, y: 4 });
    const { container } = renderSelector(d3, idle);
    expect(container.textContent).toContain('이동만 가능');
  });

  it('이미 켜져 있으면 "이동 불가"라고 알린다', () => {
    const d3 = createUnitInstance('dealer3', 'p1', { x: 4, y: 4 });
    addStatusEffect(d3, 'attackMode', 1, d3.instanceId);
    const { container } = renderSelector(d3, idle);
    expect(container.textContent).toContain('이동 불가');
  });

  it('이번 턴에 토글을 계획하면 안내가 뒤집힌다 — 토글은 같은 턴에 즉시 반영된다', () => {
    const off = createUnitInstance('dealer3', 'p1', { x: 4, y: 4 });
    const togglingOn: UnitTurnPlan = { baseAction: { kind: 'none' }, skillUse: { skillId: 'dealer3_attack_mode' } };
    expect(renderSelector(off, togglingOn).container.textContent).toContain('이동 불가');

    const on = createUnitInstance('dealer3', 'p1', { x: 4, y: 4 });
    addStatusEffect(on, 'attackMode', 1, on.instanceId);
    expect(renderSelector(on, togglingOn).container.textContent).toContain('이동만 가능');
  });

  it('기술 사거리가 고르기 전에 보인다 — 고르고 나서야 안 닿는 걸 알면 그 클릭이 낭비다', () => {
    const s2 = createUnitInstance('support2', 'p1', { x: 4, y: 4 });
    const { container } = renderSelector(s2, idle);
    const options = [...container.querySelectorAll('option')].map((o) => o.textContent ?? '');
    expect(options.some((o) => o.includes('장거리 회복') && o.includes('칸'))).toBe(true);
  });
});
