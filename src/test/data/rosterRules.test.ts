import { describe, expect, it, beforeEach } from 'vitest';
import {
  MAX_ROSTER_SIZE,
  ROSTER_RULE_ORDER,
  ROSTER_RULES,
  canAddPick,
  isRosterLegal,
  randomRoster,
  roleCount,
  rosterSizeOf,
  rosterViolation,
  tankCount,
} from '../../data/rosterRules';
import { mapDefinition } from '../../data/mapDefinitions';
import { validateMap } from '../../maps/mapModel';
import { ROSTER_SIZE } from '../../data/constants';
import { aiDraftPicks } from '../../ai/aiPlayer';
import { seededRng } from '../../engine/rng';
import { useGameStore } from '../../store/gameStore';

const rng = () => seededRng(4242);

describe('편성 규칙 — 탱커 1명 고정', () => {
  it('탱커를 두 번째로 담는 것을 막고, 빼는 것은 언제나 허용한다', () => {
    expect(canAddPick([], 'tank1', 'oneTank')).toBe(true);
    // 이미 탱커가 하나 있으면 다른 탱커도, 같은 탱커 한 기 더도 담을 수 없다.
    expect(canAddPick(['tank1'], 'tank2', 'oneTank')).toBe(false);
    expect(canAddPick(['tank1'], 'tank1', 'oneTank')).toBe(false);
    expect(canAddPick(['tank1'], 'dealer1', 'oneTank')).toBe(true);
  });

  it('비탱커 4기를 채우면 남은 한 자리는 탱커 몫으로 잠긴다', () => {
    const fourDealers = ['dealer1', 'dealer2', 'dealer3', 'dealer4'];
    expect(canAddPick(fourDealers, 'support1', 'oneTank')).toBe(false);
    expect(canAddPick(fourDealers, 'tank3', 'oneTank')).toBe(true);
    // 자유 편성에서는 같은 상황에서 아무거나 담을 수 있다 — 규칙이 실제로 갈라지는지 확인한다.
    expect(canAddPick(fourDealers, 'support1', 'free')).toBe(true);
  });

  it('탱커 수가 정확히 맞아야 확정할 수 있고, 아니면 사유가 나온다', () => {
    const noTank = ['dealer1', 'dealer2', 'dealer3', 'dealer4', 'support1'];
    const oneTank = ['tank1', 'dealer2', 'dealer3', 'dealer4', 'support1'];
    const twoTanks = ['tank1', 'tank2', 'dealer3', 'dealer4', 'support1'];

    expect(isRosterLegal(oneTank, 'oneTank')).toBe(true);
    expect(rosterViolation(noTank, 'oneTank')).toContain('탱커');
    expect(rosterViolation(twoTanks, 'oneTank')).toContain('탱커');
    // 자유 편성은 셋 다 통과한다.
    for (const picks of [noTank, oneTank, twoTanks]) expect(isRosterLegal(picks, 'free')).toBe(true);
  });

  it('무작위 편성은 규칙을 지킨다 — 자유 편성은 탱커 수가 실제로 흔들린다', () => {
    const random = rng();
    const tankCounts = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const oneTank = randomRoster(random, 'oneTank');
      expect(oneTank).toHaveLength(ROSTER_SIZE);
      expect(tankCount(oneTank)).toBe(1);
      tankCounts.add(tankCount(randomRoster(random, 'free')));
    }
    // 자유 편성이 우연히 항상 1명을 뽑았다면 두 규칙을 비교하는 의미가 없다.
    expect(tankCounts.size).toBeGreaterThan(1);
  });

  it('AI 편성은 모든 난이도·모든 규칙에서 사람과 같은 규칙을 지킨다', () => {
    const random = rng();
    for (const ruleId of ROSTER_RULE_ORDER) {
      for (const difficulty of ['easy', 'normal', 'hard'] as const) {
        const picks = aiDraftPicks(difficulty, random, ruleId);
        expect(rosterViolation(picks, ruleId), `${ruleId}/${difficulty}`).toBeNull();
      }
    }
  });
});

/**
 * **6대6 · 역할 균형.** 앞의 두 규칙과 달리 이 규칙은 판 위의 기물 수 자체를 바꾼다 —
 * 그래서 여기서 잠그는 것은 "고를 수 있는가"만이 아니라 **인원수가 규칙마다 다르다는 사실을
 * 온 코드가 알고 있는가**다. 인원수를 상수 5로 읽는 곳이 하나라도 남으면 여섯 번째 기물이
 * 배치 슬롯을 못 받거나(스토어), AI만 5기로 싸우거나(편성 표), 확정 버튼이 영영 안 열린다.
 */
describe('편성 규칙 — 6대6 · 역할 균형', () => {
  const balanced = ['tank1', 'tank3', 'dealer1', 'dealer4', 'support1', 'support2'];

  it('여섯 기물을 요구한다 — 다섯 기에서는 확정되지 않는다', () => {
    expect(rosterSizeOf('sixRoles')).toBe(6);
    expect(isRosterLegal(balanced, 'sixRoles')).toBe(true);
    expect(rosterViolation(balanced.slice(0, 5), 'sixRoles')).toContain('6기물');
  });

  it('역할마다 정원이 따로 찬다 — 한 역할을 두 기 담으면 그 역할만 잠긴다', () => {
    expect(canAddPick(['tank1'], 'tank3', 'sixRoles')).toBe(true);
    expect(canAddPick(['tank1', 'tank3'], 'tank2', 'sixRoles')).toBe(false);
    // 탱커가 찼어도 딜러·지원 자리는 그대로 열려 있다.
    expect(canAddPick(['tank1', 'tank3'], 'dealer1', 'sixRoles')).toBe(true);
    expect(canAddPick(['dealer1', 'dealer2'], 'dealer3', 'sixRoles')).toBe(false);
    expect(canAddPick(['support1', 'support2'], 'support3', 'sixRoles')).toBe(false);
  });

  it('수는 맞는데 역할이 어긋난 편성은 사유를 돌려준다', () => {
    // 6기물이라 인원수 검사는 통과한다 — 여기서 안 걸리면 "6/6인데 확정이 안 되는" 화면이 된다.
    const lopsided = ['tank1', 'tank3', 'dealer1', 'dealer2', 'dealer3', 'support1'];
    expect(lopsided).toHaveLength(6);
    expect(rosterViolation(lopsided, 'sixRoles')).toContain('딜러');
  });

  it('무작위 편성도 2:2:2를 지킨다 — 쉬움 AI가 규칙 밖 편성을 내면 안 된다', () => {
    const random = rng();
    for (let i = 0; i < 100; i++) {
      const picks = randomRoster(random, 'sixRoles');
      expect(picks).toHaveLength(6);
      for (const role of ['tank', 'dealer', 'support'] as const) expect(roleCount(picks, role)).toBe(2);
    }
  });

  it('맵 검사는 가장 큰 편성을 기준으로 한다 — 5칸짜리 진영은 6대6을 담지 못한다', () => {
    expect(MAX_ROSTER_SIZE).toBe(6);
    const narrow = {
      ...mapDefinition,
      startZones: { p1: mapDefinition.startZones.p1.slice(0, 5), p2: mapDefinition.startZones.p2.slice(0, 6) },
    };
    expect(validateMap(narrow).some((e) => e.includes('진영 블럭 A'))).toBe(true);
    expect(validateMap(mapDefinition)).toEqual([]);
  });
});

/**
 * 규칙 표 자체의 불변식. 규칙을 하나 더 넣을 때 여기가 먼저 깨진다 —
 * 정원 합이 인원수를 넘는 규칙은 **아무도 확정할 수 없는** 규칙이라 화면에서는 원인을 못 찾는다.
 */
describe('편성 규칙 표 — 채울 수 있는 규칙만 있다', () => {
  it('모든 규칙에서 정원 합이 편성 인원을 넘지 않는다', () => {
    for (const id of ROSTER_RULE_ORDER) {
      const rule = ROSTER_RULES[id];
      const total = Object.values(rule.roleQuota ?? {}).reduce((a, b) => a + b, 0);
      expect(total, id).toBeLessThanOrEqual(rule.size);
    }
  });
});

/**
 * 화면 버튼만 잠그면 온라인 게스트의 원격 호출(togglePick/confirmDraft)이 규칙을 우회한다 —
 * 스토어가 최종 관문인지 확인한다.
 */
describe('편성 규칙 — 스토어가 최종 관문이다', () => {
  beforeEach(() => {
    useGameStore.setState({ rosterRule: 'oneTank', draftPicks: { p1: [], p2: [] }, stage: 'draft', mode: 'local' });
  });

  it('규칙을 어기는 선택은 스토어에 들어가지 않는다', () => {
    const { togglePick } = useGameStore.getState();
    togglePick('p1', 'tank1');
    togglePick('p1', 'tank2');
    expect(useGameStore.getState().draftPicks.p1).toEqual(['tank1']);

    // 빼는 건 막지 않는다 — 막으면 규칙에 걸린 편성을 되돌릴 방법이 없어진다.
    togglePick('p1', 'tank1');
    expect(useGameStore.getState().draftPicks.p1).toEqual([]);
  });

  it('탱커 수가 어긋난 편성으로는 배치 단계로 넘어가지 않는다', () => {
    useGameStore.setState({
      draftPicks: {
        p1: ['tank1', 'tank2', 'dealer3', 'dealer4', 'support1'],
        p2: ['tank1', 'dealer2', 'dealer3', 'dealer4', 'support1'],
      },
    });
    useGameStore.getState().confirmDraft();
    expect(useGameStore.getState().stage).toBe('draft');

    useGameStore.setState({
      draftPicks: {
        p1: ['tank3', 'dealer2', 'dealer3', 'dealer4', 'support1'],
        p2: ['tank1', 'dealer2', 'dealer3', 'dealer4', 'support1'],
      },
    });
    useGameStore.getState().confirmDraft();
    expect(useGameStore.getState().stage).toBe('placement');
  });

  /**
   * 6대6이 실제로 6대6인지는 드래프트가 아니라 **판 위**에서만 확인된다. 배치 슬롯이 5개면
   * 여섯 번째 기물은 미배치로 남고, 규칙만 6이고 게임은 5대5인 채로 조용히 진행된다.
   */
  it('6대6에서는 배치 슬롯도 여섯 개이고 판에 12기가 선다', () => {
    useGameStore.setState({ rosterRule: 'sixRoles', mode: 'local', selectedMap: null });
    const roster = ['tank1', 'tank3', 'dealer1', 'dealer4', 'support1', 'support2'];
    useGameStore.setState({ draftPicks: { p1: roster, p2: [...roster] } });

    useGameStore.getState().confirmDraft();
    expect(useGameStore.getState().stage).toBe('placement');
    expect(useGameStore.getState().placementPositions.p1).toHaveLength(6);

    useGameStore.getState().autoPlace('p1');
    useGameStore.getState().autoPlace('p2');
    useGameStore.getState().confirmPlacement();

    const units = useGameStore.getState().state?.units.filter((u) => !u.isTurret) ?? [];
    expect(units).toHaveLength(12);
    // 같은 칸에 두 기물이 겹치면 그 판은 시작부터 깨진 것이다.
    expect(new Set(units.map((u) => `${u.owner}:${u.position!.x},${u.position!.y}`)).size).toBe(12);
    // 계획표도 6기 몫이 있어야 여섯 번째 기물이 행동을 지정받는다.
    expect(Object.keys(useGameStore.getState().plans?.p1.actions ?? {})).toHaveLength(6);
  });
});
