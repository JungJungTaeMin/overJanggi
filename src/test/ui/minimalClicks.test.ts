import { beforeEach, describe, expect, it } from 'vitest';
import { ROSTER_SIZE } from '../../data/constants';
import { ROSTER_RULE_ORDER, rosterViolation } from '../../data/rosterRules';
import { mapDefinition } from '../../data/mapDefinitions';
import { getUnitType } from '../../data/unitTypes';
import { createUnitInstance } from '../../engine/createInitialState';
import type { UnitTurnPlan } from '../../engine/types';
import { hasPendingMoveSegment } from '../../components/Planning/actionGeometry';
import { useGameStore } from '../../store/gameStore';

/**
 * "최소 클릭" 경로는 클릭을 아끼는 게 목적이므로, 아껴 준 그 한 번이 **직접 눌렀을 때와 같은
 * 결과**를 내야 의미가 있다. 규칙을 어긴 편성으로 판이 시작되거나 두 기물이 같은 칸에 서면
 * 사용자는 아낀 클릭보다 많은 클릭으로 뒷수습을 해야 한다.
 */
describe('빠른 시작 — 클릭 한 번으로 전투까지', () => {
  beforeEach(() => {
    useGameStore.setState({ rosterRule: 'free', aiDifficulty: 'normal', selectedMap: null });
  });

  it('드래프트·배치를 거친 것과 같은 상태로 전투가 시작된다', () => {
    useGameStore.getState().quickStart();
    const s = useGameStore.getState();

    expect(s.stage).toBe('game');
    expect(s.mode).toBe('ai');
    expect(s.state?.phase).toBe('planning');
    // 화면만 건너뛴 게 아니라 편성·배치 데이터도 남아야 한다("새 게임"이 여기서 다시 출발한다).
    expect(s.draftPicks.p1).toHaveLength(ROSTER_SIZE);
    expect(s.placementPositions.p2.every(Boolean)).toBe(true);
    expect(s.state?.units.filter((u) => !u.isTurret)).toHaveLength(ROSTER_SIZE * 2);
    // 계획표가 없으면 첫 턴부터 아무 행동도 지정할 수 없다.
    expect(Object.keys(s.plans?.p1.actions ?? {})).toHaveLength(ROSTER_SIZE);
  });

  it('어떤 편성 규칙에서도 규칙을 지키는 편성으로 시작한다', () => {
    for (const ruleId of ROSTER_RULE_ORDER) {
      useGameStore.setState({ rosterRule: ruleId });
      useGameStore.getState().quickStart();
      const { draftPicks } = useGameStore.getState();
      expect(rosterViolation(draftPicks.p1, ruleId), `p1/${ruleId}`).toBeNull();
      expect(rosterViolation(draftPicks.p2, ruleId), `p2/${ruleId}`).toBeNull();
    }
  });
});

describe('추천 편성 · 자동 배치', () => {
  beforeEach(() => {
    useGameStore.setState({
      rosterRule: 'oneTank',
      mode: 'local',
      stage: 'draft',
      selectedMap: null,
      draftPicks: { p1: [], p2: [] },
      placementPositions: { p1: [], p2: [] },
    });
  });

  it('추천 편성은 다섯 번 고른 것과 같은 자리에 놓이고 규칙을 지킨다', () => {
    useGameStore.getState().autoFillDraft('p1');
    const picks = useGameStore.getState().draftPicks.p1;
    expect(picks).toHaveLength(ROSTER_SIZE);
    expect(rosterViolation(picks, 'oneTank')).toBeNull();
    // 상대 편성까지 대신 채워 주지는 않는다.
    expect(useGameStore.getState().draftPicks.p2).toEqual([]);
  });

  it('자동 배치는 손으로 놓은 기물을 그대로 두고 빈 자리만, 겹치지 않게 채운다', () => {
    useGameStore.getState().autoFillDraft('p1');
    useGameStore.getState().confirmDraft();

    const handPlaced = mapDefinition.startZones.p1[0];
    useGameStore.getState().placeUnit('p1', 2, handPlaced);
    useGameStore.getState().autoPlace('p1');

    const positions = useGameStore.getState().placementPositions.p1;
    expect(positions.every(Boolean)).toBe(true);
    expect(positions[2]).toEqual(handPlaced);
    // 같은 칸에 두 기물이 겹치면 배치가 무효라 사용자가 다시 찍어야 한다.
    expect(new Set(positions.map((p) => `${p!.x},${p!.y}`)).size).toBe(ROSTER_SIZE);
    // 시작지점 밖으로 나가면 안 된다.
    const zone = new Set(mapDefinition.startZones.p1.map((p) => `${p.x},${p.y}`));
    for (const p of positions) expect(zone.has(`${p!.x},${p!.y}`)).toBe(true);
  });
});

/**
 * 자동 넘기기의 유일한 안전장치. 이 판단이 틀리면 dealer2처럼 이동을 여러 번 얻은 기물이
 * 첫 구간만 찍은 채 다음 기물로 넘어가 버려, 남은 구간을 찍을 기회가 사라진다.
 */
describe('자동 넘기기 — 남은 이동 구간이 있으면 넘기지 않는다', () => {
  const move = (path: ('up' | 'down')[], segmentLengths: number[]): UnitTurnPlan => ({
    baseAction: { kind: 'move', direction: path[0], distance: path.length, path, segmentLengths },
  });

  it('평범한 기물은 한 번 찍으면 계획이 끝난다', () => {
    const unit = createUnitInstance('tank1', 'p1', { x: 4, y: 10 });
    expect(hasPendingMoveSegment(unit, { baseAction: { kind: 'none' } }, 1)).toBe(true);
    expect(hasPendingMoveSegment(unit, move(['up'], [1]), 1)).toBe(false);
    // 공격은 이동 구간을 쓰지 않으므로 그 자체로 계획이 끝난 것이다.
    expect(hasPendingMoveSegment(unit, { baseAction: { kind: 'attack', direction: 'up' } }, 1)).toBe(false);
  });

  it('시간 역행으로 이동을 더 얻었으면 그 구간을 다 찍을 때까지 남아 있다', () => {
    const unit = createUnitInstance('dealer2', 'p1', { x: 4, y: 10 });
    const skillUse = { skillId: 'dealer2_rewind_move', amount: 1 };
    const speed = getUnitType('dealer2').moveSpeed;

    const baseOnly: UnitTurnPlan = { ...move(['up', 'up', 'up'], [speed]), skillUse };
    expect(hasPendingMoveSegment(unit, baseOnly, 1)).toBe(true);

    const bothSegments: UnitTurnPlan = {
      ...move(['up', 'up', 'up', 'down', 'down', 'down'], [speed, speed]),
      skillUse,
    };
    expect(hasPendingMoveSegment(unit, bothSegments, 1)).toBe(false);
  });
});
