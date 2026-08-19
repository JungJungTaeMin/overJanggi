import { describe, expect, it, beforeEach } from 'vitest';
import {
  ROSTER_RULE_ORDER,
  canAddPick,
  isRosterLegal,
  randomRoster,
  rosterViolation,
  tankCount,
} from '../../data/rosterRules';
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
});
