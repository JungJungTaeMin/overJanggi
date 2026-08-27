import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Board, CELL_SIZE } from '../../components/Board/Board';
import type { BoardConfig, Position } from '../../engine/types';

/**
 * **"동전 뒷면이 떠도 UI에서는 이동이 3칸 되는 것처럼 보인다."** — 의 나머지 절반.
 *
 * `coinCells.test.ts`가 잠그는 것은 **어느 칸이 운 칸인가**(기하)다. 그런데 그 계산이 아무리 맞아도
 * 판이 두 종류를 **똑같이** 칠하면 사용자가 보는 거짓말은 그대로다 — 고친 것이 화면에 도달하지
 * 못한 셈이다. 그래서 여기서는 계산이 아니라 **그려진 결과**를 확인한다.
 *
 * 세 가지를 따로 잠그는 이유: 채움색만으로는 시작지점·점령지처럼 배경이 이미 칠해진 칸 위에서
 * 구분이 묻히고(그래서 점선 테두리), 색과 점선은 둘 다 "왜?"를 말해 주지 못한다(그래서 툴팁).
 */
const board: BoardConfig = {
  width: 5,
  height: 5,
  obstacles: [],
  captureZone: [],
  startZones: { p1: [{ x: 0, y: 0 }], p2: [{ x: 4, y: 4 }] },
};

const GUARANTEED: Position = { x: 1, y: 0 };
const LUCKY: Position = { x: 3, y: 0 };

function renderBoard() {
  const { container } = render(
    <Board
      board={board}
      units={[]}
      moveCells={[GUARANTEED, LUCKY]}
      luckyCells={[LUCKY]}
      onCellClick={() => {}}
    />,
  );
  const cellAt = (p: Position) =>
    container.querySelector(`rect.board-cell[x="${p.x * CELL_SIZE}"][y="${p.y * CELL_SIZE}"]`) as SVGElement;
  const borderAt = (p: Position) =>
    [...container.querySelectorAll('rect[fill="none"]')].find(
      (r) => r.getAttribute('x') === String(p.x * CELL_SIZE + 2) && r.getAttribute('y') === String(p.y * CELL_SIZE + 2),
    ) as SVGElement | undefined;
  return { container, cellAt, borderAt };
}

describe('coin cells on the board', () => {
  it('paints the coin-only cell in a paler tone than the guaranteed one', () => {
    // 다른 **계열**의 색을 주면 "이동 칸이 아닌 무언가"로 읽힌다. 같은 초록의 옅은 톤이어야
    // "같은 이동 칸인데 보장이 안 될 뿐"이라는 뜻이 남는다.
    const { cellAt } = renderBoard();
    expect(cellAt(GUARANTEED).getAttribute('fill')).toBe('#bbf7d0');
    expect(cellAt(LUCKY).getAttribute('fill')).toBe('#e8f8ee');
  });

  it('outlines the coin-only cell with a dashed border', () => {
    // 옅은 채움은 배경이 칠해진 칸 위에서 묻힌다 — 테두리는 어디에 놓여도 뜻이 그대로다.
    const { borderAt } = renderBoard();
    expect(borderAt(GUARANTEED)?.getAttribute('stroke-dasharray')).toBeNull();
    expect(borderAt(LUCKY)?.getAttribute('stroke-dasharray')).toBe('3 3');
  });

  it('says why in words — color alone never explains itself', () => {
    const { cellAt } = renderBoard();
    expect(cellAt(GUARANTEED).querySelector('title')?.textContent).not.toContain('동전');
    expect(cellAt(LUCKY).querySelector('title')?.textContent).toContain('동전이 앞면일 때만 닿습니다(50%)');
  });

  it('still lets the coin-only cell be clicked — the plan is made for heads', () => {
    // 「운」은 못 찍게 하는 표시가 아니다. 못 찍게 하면 앞면인 턴에 3칸을 영영 못 쓴다.
    const { cellAt } = renderBoard();
    expect(cellAt(LUCKY).getAttribute('class')).toContain('clickable');
    expect(cellAt(LUCKY).getAttribute('cursor')).toBe('pointer');
  });

  it('draws nothing special when no cell depends on a coin', () => {
    // 확률·포탑형이 아닌 기물에서 점선이 하나라도 새어 나오면 표시가 배경이 된다.
    const { container } = render(
      <Board board={board} units={[]} moveCells={[GUARANTEED, LUCKY]} onCellClick={() => {}} />,
    );
    const dashed = [...container.querySelectorAll('rect[fill="none"]')].filter(
      (r) => r.getAttribute('stroke-dasharray') === '3 3',
    );
    expect(dashed).toHaveLength(0);
    expect(container.querySelector(`rect.board-cell[x="${LUCKY.x * CELL_SIZE}"]`)?.getAttribute('fill')).toBe('#bbf7d0');
  });
});
