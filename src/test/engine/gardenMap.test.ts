import { describe, expect, it } from 'vitest';
import type { Position } from '../../engine/types';
import { mapDefinition } from '../../data/mapDefinitions';
import { inBounds, isObstacle, samePosition, ORTHOGONAL_DIRECTIONS, step } from '../../engine/grid';

const board = mapDefinition;
const key = (p: Position) => `${p.x},${p.y}`;

/** 장애물(과 추가로 막은 칸)을 피해 상하좌우로 이동했을 때 from에서 to에 닿을 수 있는지. */
function reachable(from: Position, to: Position, extraBlocked: Position[] = []): boolean {
  const blocked = new Set(extraBlocked.map(key));
  const seen = new Set([key(from)]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (samePosition(current, to)) return true;
    for (const dir of ORTHOGONAL_DIRECTIONS) {
      const next = step(current, dir);
      if (!inBounds(next, board) || isObstacle(next, board)) continue;
      if (blocked.has(key(next)) || seen.has(key(next))) continue;
      seen.add(key(next));
      queue.push(next);
    }
  }
  return false;
}

/** 맵 전체에서 특정 열 범위를 통째로 벽으로 취급한다(우회로가 실제로 존재하는지 확인용). */
function columns(predicate: (x: number) => boolean): Position[] {
  const cells: Position[] = [];
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) if (predicate(x)) cells.push({ x, y });
  }
  return cells;
}

/**
 * '정원' 맵(1.5배 확대판 13×19) 구조 회귀 테스트.
 * 좌표를 손으로 적는 맵이라 한 칸만 잘못 적어도 통로가 막히거나 한쪽 팀만 유리해질 수 있다.
 */
describe('정원 맵 구조', () => {
  const p1Start = board.startZones.p1[0];
  const p2Start = board.startZones.p2[board.startZones.p2.length - 1];
  const captureCenter = { x: 6, y: 9 };

  it('크기는 13×19(기존 9×13의 1.5배 — 대칭을 위해 홀수 유지)', () => {
    expect(board.width).toBe(13);
    expect(board.height).toBe(19);
  });

  it('시작지점은 점령지와 겹치지 않고 장애물도 없다', () => {
    const capture = new Set(board.captureZone.map(key));
    for (const cell of [...board.startZones.p1, ...board.startZones.p2]) {
      expect(inBounds(cell, board)).toBe(true);
      expect(capture.has(key(cell))).toBe(false);
      expect(isObstacle(cell, board)).toBe(false);
    }
  });

  it('점령지는 중앙 (6, 9)를 중심으로 한 3×3 연속 구역이다', () => {
    expect(board.captureZone).toHaveLength(9);
    const xs = board.captureZone.map((p) => p.x);
    const ys = board.captureZone.map((p) => p.y);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([5, 7]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([8, 10]);
    expect(board.captureZone.some((p) => samePosition(p, captureCenter))).toBe(true);
    expect(board.captureZone.every((p) => !isObstacle(p, board))).toBe(true);
  });

  it('상하 대칭이라 양 팀의 진입 조건이 같다', () => {
    const mirrored = new Set(board.obstacles.map((p) => key({ x: p.x, y: board.height - 1 - p.y })));
    expect(new Set(board.obstacles.map(key))).toEqual(mirrored);
  });

  it('양 시작지점과 점령지가 모두 연결돼 있다', () => {
    expect(reachable(p1Start, captureCenter)).toBe(true);
    expect(reachable(p2Start, captureCenter)).toBe(true);
    expect(reachable(p1Start, p2Start)).toBe(true);
  });

  it('중앙을 막아도 좌측 골목만으로 반대편까지 갈 수 있다', () => {
    // x >= 4를 전부 벽으로 치면 남는 길은 좌측 골목뿐이다(양 끝도 좌측 시작 칸으로 잡는다).
    expect(reachable({ x: 1, y: 0 }, { x: 1, y: 18 }, columns((x) => x >= 4))).toBe(true);
  });

  it('중앙과 좌측을 막아도 우측 다리·공터만으로 반대편까지 갈 수 있다', () => {
    // x <= 8을 전부 벽으로 치면 남는 길은 우측 다리·공터뿐이다.
    expect(reachable({ x: 9, y: 0 }, { x: 9, y: 18 }, columns((x) => x <= 8))).toBe(true);
  });
});
