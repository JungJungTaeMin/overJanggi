import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Board, CELL_SIZE } from '../../components/Board/Board';
import { boardView, isBoardFlipped } from '../../components/Board/orientation';
import { createUnitInstance } from '../../engine/createInitialState';
import type { BoardConfig, Position } from '../../engine/types';

/** 기본 맵과 같은 배치 — p1이 위(y=0), p2가 아래. */
const board: BoardConfig = {
  width: 5,
  height: 7,
  obstacles: [],
  captureZone: [],
  startZones: { p1: [{ x: 0, y: 0 }], p2: [{ x: 4, y: 6 }] },
};

/**
 * **엔진 좌표는 하나, 보는 방향은 둘.** 온라인 게스트(p2)는 자기 진영이 아래로 오도록 판을 돌려
 * 본다. 여기서 잠그는 건 "돌려 그려도 **좌표는 안 돈다**"는 것이다 — 화면만 도는 게 아니라
 * 클릭이 돌려주는 좌표까지 같이 돌아 버리면 게스트가 판 반대편에 기물을 놓게 되고, 그건 규칙이
 * 아니라 화면 코드가 게임을 망가뜨리는 종류의 버그다.
 */
describe('판 뒤집기 — 내 진영을 아래로', () => {
  it('내 시작지점이 위쪽이면 뒤집어 아래로 내린다', () => {
    // 기본 맵은 p1이 위 — 그러니 뒤집어야 하는 쪽은 p1이다(p2는 이미 아래에 있다).
    expect(isBoardFlipped(board, 'p1', 'online')).toBe(true);
    expect(isBoardFlipped(board, 'p2', 'online')).toBe(false);
  });

  it('온라인에서만 뒤집는다 — 로컬은 "내 진영"이 없고 AI는 보던 방향이 있다', () => {
    expect(isBoardFlipped(board, 'p1', 'local')).toBe(false);
    expect(isBoardFlipped(board, 'p1', 'ai')).toBe(false);
  });

  /**
   * `localOwner === 'p1'`을 상수로 박지 않고 시작지점 위치를 재는 이유가 여기 있다 —
   * 맵 메이커로 진영을 뒤바꾼 맵에서도 **내 진영이 아래**라는 약속이 지켜져야 한다.
   */
  it('진영이 뒤바뀐 커스텀 맵에서는 뒤집는 쪽도 뒤바뀐다', () => {
    const swapped: BoardConfig = { ...board, startZones: { p1: [{ x: 0, y: 6 }], p2: [{ x: 4, y: 0 }] } };
    expect(isBoardFlipped(swapped, 'p1', 'online')).toBe(false);
    expect(isBoardFlipped(swapped, 'p2', 'online')).toBe(true);
  });

  it('상하 거울이 아니라 180° 회전이다 — 좌우도 같이 바뀌어야 손잡이가 맞는다', () => {
    const view = boardView(board, true);
    // 좌상단(0,0)은 우하단으로 간다. 상하만 뒤집었다면 x는 0 그대로였을 것이다.
    expect(view({ x: 0, y: 0 })).toEqual({ x: 4, y: 6 });
    expect(view({ x: 4, y: 6 })).toEqual({ x: 0, y: 0 });
  });

  it('두 번 돌리면 제자리 — 시점 변환이 정보를 잃지 않는다', () => {
    const view = boardView(board, true);
    for (let y = 0; y < board.height; y++) {
      for (let x = 0; x < board.width; x++) {
        expect(view(view({ x, y }))).toEqual({ x, y });
      }
    }
  });

  it('안 뒤집을 때는 좌표를 그대로 돌려준다', () => {
    const view = boardView(board, false);
    expect(view({ x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
  });

  /** 칸을 픽셀 위치로 찾는다 — 뒤집힌 판에서 "어느 칸이 어디에 그려졌는가"를 보는 유일한 방법. */
  function rectAt(container: HTMLElement, p: Position): Element | undefined {
    return [...container.querySelectorAll('rect.board-cell')].find(
      (r) => r.getAttribute('x') === String(p.x * CELL_SIZE) && r.getAttribute('y') === String(p.y * CELL_SIZE),
    );
  }

  it('p1 시작지점이 화면 아래에 그려진다', () => {
    const { container } = render(<Board board={board} units={[]} flipped />);
    // 엔진 좌표 (0,0)인 p1 시작지점은 화면에서는 마지막 행·마지막 열에 있다.
    const cell = rectAt(container, { x: board.width - 1, y: board.height - 1 });
    expect(cell?.getAttribute('fill')).toBe('#dbeafe'); // p1 진영 색
    // 반대로 화면 맨 위 왼쪽 칸은 p2 진영이다.
    expect(rectAt(container, { x: 0, y: 0 })?.getAttribute('fill')).toBe('#fee2e2');
  });

  it('기물도 같은 자리로 따라 그려진다', () => {
    const unit = createUnitInstance('tank1', 'p1', { x: 1, y: 2 });
    const { container } = render(<Board board={board} units={[unit]} flipped />);
    /**
     * 칸으로 가는 이동은 토큰 그룹의 transform이 전부 맡는다(도형·글자·체력바는 원점 기준으로
     * 그린다) — 기물이 칸을 옮길 때 CSS로 미끄러지게 하려고 위치를 한 곳으로 모은 결과다.
     * 그래서 "어디에 그려졌는가"도 도형의 x/y가 아니라 그룹의 translate에서 읽는다.
     */
    const token = container.querySelector('g.unit-token');
    const expectedCx = (board.width - 1 - 1) * CELL_SIZE + CELL_SIZE / 2;
    const expectedCy = (board.height - 1 - 2) * CELL_SIZE + CELL_SIZE / 2;
    expect(token?.getAttribute('transform')).toBe(`translate(${expectedCx}, ${expectedCy})`);
  });

  it('클릭은 그려진 자리와 상관없이 **엔진 좌표**를 돌려준다', () => {
    const onCellClick = vi.fn();
    const target: Position = { x: 0, y: 0 }; // p1 시작지점 = 뒤집힌 화면에서는 오른쪽 아래
    const { container } = render(
      <Board board={board} units={[]} flipped clickableCells={[target]} onCellClick={onCellClick} />,
    );
    // 화면 오른쪽 아래 칸을 누른다.
    const drawn = rectAt(container, { x: board.width - 1, y: board.height - 1 })!;
    fireEvent.click(drawn);
    // 돌아오는 좌표는 화면 좌표가 아니라 엔진 좌표여야 한다.
    expect(onCellClick).toHaveBeenCalledWith(target);
  });
});
