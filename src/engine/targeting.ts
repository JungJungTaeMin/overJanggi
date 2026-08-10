import type { BoardConfig, Direction } from './types';
import type { Position } from './types';
import { inBounds, isObstacle, step } from './grid';

const PERPENDICULAR: Record<Direction, [Direction, Direction]> = {
  up: ['left', 'right'],
  down: ['left', 'right'],
  left: ['up', 'down'],
  right: ['up', 'down'],
  upleft: ['upright', 'downleft'],
  upright: ['upleft', 'downright'],
  downleft: ['upright', 'downleft'],
  downright: ['upleft', 'downright'],
};

/** 공격 방향으로 뻗는 사선의 칸들. 지형 장애물을 만나면 그 칸까지 포함하고 중단한다. */
export function lineCells(from: Position, direction: Direction, range: number, board: BoardConfig): Position[] {
  const cells: Position[] = [];
  let current = from;
  for (let i = 0; i < range; i++) {
    current = step(current, direction);
    if (!inBounds(current, board)) break;
    cells.push(current);
    if (isObstacle(current, board)) break;
  }
  return cells;
}

/**
 * from에서 to까지 지형 장애물이 시야를 막는지 판정(브레젠험 격자선). 방벽은 범위 공격의
 * 시야를 차단하는 장애물로 취급하지 않으므로 isObstacle()만 검사한다(기획서 §3.4/§8).
 */
export function hasLineOfSight(from: Position, to: Position, board: BoardConfig): boolean {
  let x0 = from.x;
  let y0 = from.y;
  const x1 = to.x;
  const y1 = to.y;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (!(x0 === x1 && y0 === y1)) {
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
    if (x0 === x1 && y0 === y1) break;
    if (isObstacle({ x: x0, y: y0 }, board)) return false;
  }
  return true;
}

/**
 * tank3 전용: 전방 1칸 + 그 좌우 1칸(총 3칸 밴드). 장애물 뒤 칸은 범위 공격의 대상이 될 수
 * 없다(기획서 §3.4) — 칸 자체가 장애물이거나 시전자로부터의 시야가 장애물에 막히면 제외한다.
 */
export function frontBandCells(position: Position, direction: Direction, board: BoardConfig): Position[] {
  const front = step(position, direction);
  const [d1, d2] = PERPENDICULAR[direction];
  const cells = [front, step(front, d1), step(front, d2)];
  return cells.filter(
    (c) => inBounds(c, board) && !isObstacle(c, board) && hasLineOfSight(position, c, board),
  );
}

/** 범위 공격/회복용 반경 판정 */
export function radiusCells(
  center: Position,
  radius: number,
  board: BoardConfig,
  metric: 'manhattan' | 'chebyshev' = 'chebyshev',
  includeCenter = false,
): Position[] {
  const cells: Position[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      if (dx === 0 && dy === 0) {
        if (includeCenter) cells.push({ x: center.x, y: center.y });
        continue;
      }
      const dist = metric === 'manhattan' ? Math.abs(dx) + Math.abs(dy) : Math.max(Math.abs(dx), Math.abs(dy));
      if (dist > radius) continue;
      const c = { x: center.x + dx, y: center.y + dy };
      if (inBounds(c, board)) cells.push(c);
    }
  }
  return cells;
}
