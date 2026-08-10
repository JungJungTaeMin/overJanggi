import type { BoardConfig, Direction, Position, UnitInstance } from './types';

export const DIRECTION_DELTA: Record<Direction, Position> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  upleft: { x: -1, y: -1 },
  upright: { x: 1, y: -1 },
  downleft: { x: -1, y: 1 },
  downright: { x: 1, y: 1 },
};

export const ORTHOGONAL_DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];
export const DIAGONAL_DIRECTIONS: Direction[] = ['upleft', 'upright', 'downleft', 'downright'];

export function key(p: Position): string {
  return `${p.x},${p.y}`;
}

export function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

export function inBounds(p: Position, board: BoardConfig): boolean {
  return p.x >= 0 && p.x < board.width && p.y >= 0 && p.y < board.height;
}

export function isObstacle(p: Position, board: BoardConfig): boolean {
  return board.obstacles.some((o) => samePosition(o, p));
}

export function isInCaptureZone(p: Position, board: BoardConfig): boolean {
  return board.captureZone.some((c) => samePosition(c, p));
}

export function unitAt(p: Position, units: UnitInstance[]): UnitInstance | undefined {
  return units.find((u) => u.alive && u.position && samePosition(u.position, p));
}

export function isOccupied(p: Position, units: UnitInstance[]): boolean {
  return unitAt(p, units) !== undefined;
}

export function step(p: Position, dir: Direction): Position {
  const d = DIRECTION_DELTA[dir];
  return { x: p.x + d.x, y: p.y + d.y };
}

/** 이동 가능 칸 판정: 보드 안, 장애물 없음, 다른 살아있는 유닛 없음 */
export function isWalkable(p: Position, board: BoardConfig, units: UnitInstance[]): boolean {
  return inBounds(p, board) && !isObstacle(p, board) && !isOccupied(p, units);
}

/** 도달 가능한 칸 하나 — 몇 칸째인지(distance)를 함께 들고 다닌다. */
export interface ReachableStep {
  position: Position;
  /** 출발 칸에서 몇 스텝 움직인 칸인지. 통과만 하는 칸이 있으면 배열 index와 달라진다. */
  distance: number;
}

/**
 * 특정 유닛이 한 방향으로 최대 moveSpeed까지 갈 수 있는 칸들(스텝 순서대로).
 *
 * `passThrough`를 주면 그 조건에 맞는 기물은 **막지 않고 지나간다**(tank2 돌진이 적을 밟고 가는 경우).
 * 다만 그 기물이 서 있는 칸은 **정지 칸이 될 수 없으므로** 결과에 넣지 않는다 — 그래서 반환값이
 * 단순 배열 index가 아니라 실제 이동 칸수(distance)를 따로 들고 있어야 한다.
 */
export function reachableSteps(
  from: Position,
  direction: Direction,
  distance: number,
  board: BoardConfig,
  units: UnitInstance[],
  selfInstanceId: string,
  passThrough?: (u: UnitInstance) => boolean,
): ReachableStep[] {
  const otherUnits = units.filter((u) => u.instanceId !== selfInstanceId && u.alive);
  const cells: ReachableStep[] = [];
  let current = from;
  for (let i = 0; i < distance; i++) {
    const next = step(current, direction);
    if (!inBounds(next, board) || isObstacle(next, board)) break;
    const occupant = unitAt(next, otherUnits);
    if (occupant && !passThrough?.(occupant)) break;
    if (!occupant) cells.push({ position: next, distance: i + 1 });
    current = next;
  }
  return cells;
}

/** 도달 가능한 모든 칸(4방향, 각 방향 최대 moveSpeed) — 하이라이트용 */
export function reachableCells(
  from: Position,
  moveSpeed: number,
  board: BoardConfig,
  units: UnitInstance[],
  selfInstanceId: string,
  allowDiagonal: boolean,
): Position[] {
  const directions = allowDiagonal ? [...ORTHOGONAL_DIRECTIONS, ...DIAGONAL_DIRECTIONS] : ORTHOGONAL_DIRECTIONS;
  const result: Position[] = [];
  for (const dir of directions) {
    const cells = reachableSteps(from, dir, moveSpeed, board, units, selfInstanceId);
    result.push(...cells.map((c) => c.position));
  }
  return result;
}
