import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { canSeeHiddenInfo, hidesOpponentInfo } from '../../components/visibility';
import { PlacementScreen } from '../../components/DraftSetup/PlacementScreen';
import { UnitPicker } from '../../components/DraftSetup/UnitPicker';
import { useGameStore } from '../../store/gameStore';
import type { GameMode } from '../../store/gameStore';
import type { Owner, Position } from '../../engine/types';

/** 진영 색 — 토큰이 몇 개 그려졌는지 세는 유일한 표식이다(HP바 색과 겹치지 않는다). */
const OWNER_FILL: Record<Owner, string> = { p1: '#2563eb', p2: '#dc2626' };

function countTokens(container: HTMLElement, owner: Owner): number {
  return [...container.querySelectorAll('[fill]')].filter((el) => el.getAttribute('fill') === OWNER_FILL[owner]).length;
}

function setupPlacement(mode: GameMode, localOwner: Owner): void {
  const picks = ['tank1', 'dealer1', 'dealer2', 'support1', 'support2'];
  // 시작지점 안이 아니어도 미리보기 토큰은 그려진다 — 여기서 재는 건 "그리는가"뿐이다.
  const spots = (y: number): Position[] => [0, 1, 2, 3, 4].map((x) => ({ x, y }));
  useGameStore.setState({
    stage: 'placement',
    mode,
    localOwner,
    draftPicks: { p1: [...picks], p2: [...picks] },
    placementPositions: { p1: spots(1), p2: spots(2) },
  });
}

/**
 * **온라인은 서로 다른 화면을 본다.** 이 게임은 원래 한 화면에서 양쪽을 조종하는 디버그 모드로
 * 만들어져 편성·배치·계획이 전부 열려 있었고, 그 전제 그대로 온라인을 붙이면 "동시에 내고 한꺼번에
 * 공개한다"는 규칙이 껍데기만 남는다 — 늦게 정하는 쪽이 상대를 다 보고 맞춰 내면 그만이다.
 *
 * 여기서 잠그는 건 **감추는 범위**다. 감춘 게 너무 적으면 규칙이 무너지고, 너무 많으면(해결된
 * 판 위 위치까지 감추면) 다음 수를 세울 근거가 사라진다. 그 경계를 양쪽에서 조인다.
 */
describe('온라인 정보 은닉 — 감출 것과 감추지 말 것', () => {
  beforeEach(() => {
    useGameStore.getState().backToMenu();
  });

  it('로컬 대전은 감추지 않는다 — 한 사람이 양쪽을 조종하므로 감출 상대가 없다', () => {
    expect(hidesOpponentInfo('local')).toBe(false);
    expect(canSeeHiddenInfo('local', 'p1', 'p2')).toBe(true);
  });

  it('AI 대전도 감추지 않는다 — AI는 사람 화면을 보고 두지 않아 정보 우위가 생기지 않는다', () => {
    expect(hidesOpponentInfo('ai')).toBe(false);
    expect(canSeeHiddenInfo('ai', 'p1', 'p2')).toBe(true);
  });

  it('온라인은 상대만 감추고 내 것은 그대로 본다', () => {
    expect(canSeeHiddenInfo('online', 'p2', 'p2')).toBe(true);
    expect(canSeeHiddenInfo('online', 'p2', 'p1')).toBe(false);
    expect(canSeeHiddenInfo('online', 'p1', 'p2')).toBe(false);
  });

  it('배치 화면 — 온라인에서는 내 진형만 판에 그린다', () => {
    setupPlacement('online', 'p2');
    const { container } = render(<PlacementScreen />);
    expect(countTokens(container, 'p2')).toBe(5);
    expect(countTokens(container, 'p1')).toBe(0);
  });

  it('배치 화면 — 로컬 대전에서는 양쪽 다 그린다(한 사람이 둘 다 놓는다)', () => {
    setupPlacement('local', 'p1');
    const { container } = render(<PlacementScreen />);
    expect(countTokens(container, 'p1')).toBe(5);
    expect(countTokens(container, 'p2')).toBe(5);
  });

  /**
   * 내 칸에는 고를 수 있는 10종이 전부 나열되므로 화면 전체 텍스트로는 판정할 수 없다 —
   * **상대 칸** 안만 들여다봐야 한다(첫 칸이 p1, 둘째가 p2).
   */
  function draftColumnText(container: HTMLElement, owner: Owner): string {
    const columns = [...container.querySelectorAll('.draft-column')];
    return columns[owner === 'p1' ? 0 : 1].textContent ?? '';
  }

  it('드래프트 — 온라인에서는 상대가 무엇을 골랐는지 이름이 안 나온다', () => {
    useGameStore.setState({
      stage: 'draft',
      mode: 'online',
      localOwner: 'p2',
      draftPicks: { p1: ['tank1', 'dealer1'], p2: ['support1'] },
    });
    const { container } = render(<UnitPicker />);
    // 내가 고른 것은 내 칸에 보이고
    expect(draftColumnText(container, 'p2')).toContain('범위 회복형');
    // 상대 칸에는 이름이 없다 — 실시간으로 보면서 맞춰 고를 수 있으면 안 된다.
    const opponent = draftColumnText(container, 'p1');
    expect(opponent).not.toContain('방어 강화형');
    // 진행도까지 감추면 상대가 멈춰 있는 건지 알 수 없어 기다리기가 불안하다 — 개수는 남긴다.
    expect(opponent).toContain('2/5');
  });

  it('드래프트 — AI 대전에서는 상대 편성이 그대로 보인다(배우는 데 쓰인다)', () => {
    useGameStore.setState({
      stage: 'draft',
      mode: 'ai',
      localOwner: 'p1',
      draftPicks: { p1: ['support1'], p2: ['tank1'] },
    });
    const { container } = render(<UnitPicker />);
    expect(draftColumnText(container, 'p2')).toContain('방어 강화형');
  });
});
