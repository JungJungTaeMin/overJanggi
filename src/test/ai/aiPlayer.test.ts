import { describe, expect, it } from 'vitest';
import { aiActionPlan, aiDraftPicks, aiPlacement, planForUnit } from '../../ai/aiPlayer';
import { DIFFICULTY_PROFILES } from '../../ai/difficulty';
import { seededRng } from '../../engine/rng';
import { isActionLegal } from '../../engine/validation';
import { resolveTurn } from '../../engine/resolveTurn';
import { mapDefinition } from '../../data/mapDefinitions';
import { ROSTER_SIZE } from '../../data/constants';
import { addUnit, emptyPlan, emptyState, testBoard } from '../engine/helpers';

/** 잡음 없이 "가장 좋은 수"만 보는 프로필 — 휴리스틱의 의도를 그대로 검증하기 위한 것. */
const HARD = DIFFICULTY_PROFILES.hard;
const rng = () => seededRng(12345);

/**
 * AI는 탐색이 아니라 **한 수 평가**다. 그러니 테스트도 "최선의 수를 찾았는가"가 아니라
 * (1) 절대 불법 계획을 내지 않는가, (2) 명백한 상황에서 명백한 수를 두는가를 본다.
 */
describe('AI — 계획의 합법성', () => {
  it('어떤 난이도에서든 엔진이 거부할 계획을 내지 않는다', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const state = emptyState();
      // 이동/공격/기술 제약이 제각각인 기물들을 한 판에 모아 둔다.
      for (const [i, typeId] of ['tank1', 'tank2', 'tank3', 'dealer1', 'dealer2', 'dealer3', 'dealer4', 'support1', 'support2', 'support3'].entries()) {
        addUnit(state, typeId, 'p2', { x: i % 9, y: 7 });
      }
      addUnit(state, 'tank1', 'p1', { x: 4, y: 4 });

      const plan = aiActionPlan(state, 'p2', difficulty, rng());
      for (const [instanceId, unitPlan] of Object.entries(plan.actions)) {
        const unit = state.units.find((u) => u.instanceId === instanceId)!;
        expect(isActionLegal(state, unit, unitPlan), `${difficulty} / ${unit.typeId}`).toBe(true);
      }
    }
  });

  it('죽은 기물과 포탑은 계획 대상이 아니다', () => {
    const state = emptyState();
    const alive = addUnit(state, 'tank1', 'p2', { x: 4, y: 6 });
    const dead = addUnit(state, 'dealer1', 'p2', null);
    dead.alive = false;
    const turret = addUnit(state, 'turret', 'p2', { x: 3, y: 6 });

    const plan = aiActionPlan(state, 'p2', 'hard', rng());
    expect(Object.keys(plan.actions)).toEqual([alive.instanceId]);
    expect(plan.actions[turret.instanceId]).toBeUndefined();
  });

  it('구속(root)당한 기물은 이동을 계획하지 않는다', () => {
    const state = emptyState();
    const unit = addUnit(state, 'tank2', 'p2', { x: 4, y: 6 });
    unit.statusEffects.push({ type: 'root', appliedOnTurn: 1, expiresAfterTurn: 2, sourceId: 'x' });
    addUnit(state, 'tank1', 'p1', { x: 4, y: 1 });

    const plan = planForUnit(state, unit, HARD, rng());
    expect(plan.baseAction.kind).not.toBe('move');
  });
});

describe('AI — 명백한 상황에서의 판단', () => {
  it('한 방에 죽일 수 있는 적이 사거리에 있으면 그 방향으로 공격한다', () => {
    const state = emptyState();
    const shooter = addUnit(state, 'dealer1', 'p2', { x: 4, y: 4 }); // 공격 8, 직선 사거리 6
    const victim = addUnit(state, 'dealer2', 'p1', { x: 4, y: 1 }); // 최대 체력 10
    victim.currentHp = 4;

    const plan = planForUnit(state, shooter, HARD, rng());
    expect(plan.baseAction).toEqual({ kind: 'attack', direction: 'up' });
  });

  it('사거리에 아무도 없으면 공격 대신 점령지 쪽으로 움직인다', () => {
    // 점령지는 (4,4) 한 칸뿐인 테스트 보드.
    const state = emptyState();
    const unit = addUnit(state, 'tank2', 'p2', { x: 4, y: 8 });

    const plan = planForUnit(state, unit, HARD, rng());
    expect(plan.baseAction.kind).toBe('move');
    if (plan.baseAction.kind === 'move') expect(plan.baseAction.direction).toBe('up');
  });

  it('tank2는 일렬로 선 적들을 밟고 지나가는 돌진을 고른다', () => {
    const state = emptyState(testBoard({ captureZone: [{ x: 0, y: 8 }] }));
    const tank2 = addUnit(state, 'tank2', 'p2', { x: 4, y: 0 });
    addUnit(state, 'dealer1', 'p1', { x: 4, y: 1 });
    addUnit(state, 'dealer1', 'p1', { x: 4, y: 2 });

    const plan = planForUnit(state, tank2, HARD, rng());
    expect(plan.skillUse?.skillId).toBe('tank2_charge');
    expect(plan.baseAction.kind).toBe('move');
    if (plan.baseAction.kind === 'move') expect(plan.baseAction.direction).toBe('down');
  });

  it('dealer3은 사거리에 적이 있으면 공격 모드를 켜고 쏜다', () => {
    // 점령지를 멀리 두어 "점령지로 걸어가기 vs 지금 쏘기"의 저울이 공격 쪽으로 확실히 기울게 한다.
    const state = emptyState(testBoard({ captureZone: [{ x: 0, y: 0 }] }));
    const dealer3 = addUnit(state, 'dealer3', 'p2', { x: 4, y: 5 }); // 직선·대각 사거리 4
    addUnit(state, 'tank1', 'p1', { x: 4, y: 2 });

    const plan = planForUnit(state, dealer3, HARD, rng());
    expect(plan.skillUse?.skillId).toBe('dealer3_attack_mode');
    expect(plan.baseAction).toEqual({ kind: 'attack', direction: 'up' });
  });

  it('support2는 다친 아군을 회복한다 (공격을 못 하는 기물이므로 회복이 유일한 값어치)', () => {
    const state = emptyState();
    const healer = addUnit(state, 'support2', 'p2', { x: 4, y: 5 });
    const wounded = addUnit(state, 'tank1', 'p2', { x: 4, y: 4 });
    wounded.currentHp = 10; // 최대 40

    const plan = planForUnit(state, healer, HARD, rng());
    expect(plan.skillUse?.skillId).toBe('support2_heal');
    expect(plan.skillUse?.target).toBe(wounded.instanceId);
  });

  it('쉬움은 기술을 전혀 쓰지 않는다', () => {
    const state = emptyState();
    const tank2 = addUnit(state, 'tank2', 'p2', { x: 4, y: 0 });
    addUnit(state, 'dealer1', 'p1', { x: 4, y: 1 });

    const plan = planForUnit(state, tank2, DIFFICULTY_PROFILES.easy, rng());
    expect(plan.skillUse).toBeUndefined();
  });
});

describe('AI — 드래프트와 배치', () => {
  it('난이도와 무관하게 정확히 5기물을 고른다', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      expect(aiDraftPicks(difficulty, rng())).toHaveLength(ROSTER_SIZE);
    }
  });

  it('배치는 자기 시작지점 안이고, 서로 겹치지 않으며, 탱커가 점령지에 더 가깝다', () => {
    const picks = ['dealer1', 'tank1', 'support1', 'tank3', 'dealer2'];
    const positions = aiPlacement(picks, 'p2', mapDefinition, rng());

    expect(positions).toHaveLength(picks.length);
    const zoneKeys = new Set(mapDefinition.startZones.p2.map((p) => `${p.x},${p.y}`));
    for (const p of positions) expect(zoneKeys.has(`${p.x},${p.y}`)).toBe(true);
    expect(new Set(positions.map((p) => `${p.x},${p.y}`)).size).toBe(picks.length);

    // p2는 아래쪽(y가 큰 쪽)에서 시작하므로 점령지에 가까울수록 y가 작다.
    const yOf = (typeId: string) => positions[picks.indexOf(typeId)].y;
    expect(yOf('tank1')).toBeLessThanOrEqual(yOf('dealer1'));
    expect(yOf('dealer1')).toBeLessThanOrEqual(yOf('support1'));
  });
});

describe('AI — 실전 진행', () => {
  it('AI끼리 20턴을 돌려도 엔진이 예외 없이 해결하고, 실제로 판이 움직인다', () => {
    const state = emptyState(mapDefinition);
    const random = rng();
    for (const [i, typeId] of aiDraftPicks('hard', random).entries()) {
      addUnit(state, typeId, 'p1', mapDefinition.startZones.p1[i]);
    }
    for (const [i, typeId] of aiDraftPicks('normal', random).entries()) {
      addUnit(state, typeId, 'p2', mapDefinition.startZones.p2[i]);
    }
    const startPositions = state.units.map((u) => ({ ...u.position! }));

    let damageHappened = false;
    for (let turn = 0; turn < 20 && state.phase !== 'gameOver'; turn++) {
      const log = resolveTurn(
        state,
        aiActionPlan(state, 'p1', 'hard', random),
        aiActionPlan(state, 'p2', 'normal', random),
        random,
      );
      if (log.some((e) => e.type === 'hit' || e.type === 'dashDamage')) damageHappened = true;
    }

    // 서로를 향해 전진하다 붙었으면 반드시 피해가 나온다 — "제자리에서 아무것도 안 하는 AI"를 잡는 검사.
    expect(damageHappened).toBe(true);
    expect(state.units.some((u, i) => u.position && (u.position.x !== startPositions[i].x || u.position.y !== startPositions[i].y))).toBe(true);
  });

  it('사람이 아무 계획도 내지 않으면 AI가 점수를 벌어 결국 이긴다', () => {
    const state = emptyState(mapDefinition);
    const random = rng();
    for (const [i, typeId] of aiDraftPicks('hard', random).entries()) {
      addUnit(state, typeId, 'p2', mapDefinition.startZones.p2[i]);
    }
    addUnit(state, 'tank1', 'p1', mapDefinition.startZones.p1[0]);

    for (let turn = 0; turn < 60 && state.phase !== 'gameOver'; turn++) {
      resolveTurn(state, emptyPlan('p1', state.turnNumber), aiActionPlan(state, 'p2', 'hard', random), random);
    }
    expect(state.score.p2).toBeGreaterThan(0);
  });
});
