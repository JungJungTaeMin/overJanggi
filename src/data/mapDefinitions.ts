import type { BoardConfig, Position } from '../engine/types';

/**
 * '정원' 맵 기본값. 기획서(4장)에 정확한 좌표가 없어 임의로 정한 값 —
 * 밸런스 조정 시 이 파일만 바꾸면 되도록 구역 단위로 분리했다.
 *
 * **크기 1.5배 확대(사용자 요청)**: 기존 9×13 → 13×19. 각 변에 1.5를 곱하면 13.5×19.5라 정수가
 * 아니므로 **홀수를 유지하도록 내림**했다 — 폭이 홀수여야 중앙 열(x=6)을 기준으로 좌우가, 높이가
 * 홀수여야 중앙 행(y=9)을 기준으로 상하가 완전히 대칭이 되어 양 팀 조건이 같아진다.
 * 6개 구역(시작지점 2, 좌측 골목, 중앙 진입부, 중앙 점령지, 우측 다리, 우측 공터)의 역할과
 * 서로의 비율은 그대로 두고 치수만 1.5배로 늘렸다.
 */
export const WIDTH = 13;
export const HEIGHT = 19;

function rect(x0: number, y0: number, x1: number, y1: number): Position[] {
  const cells: Position[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) cells.push({ x, y });
  }
  return cells;
}

function key(p: Position): string {
  return `${p.x},${p.y}`;
}

function subtract(a: Position[], b: Position[]): Position[] {
  const bKeys = new Set(b.map(key));
  return a.filter((p) => !bKeys.has(key(p)));
}

/**
 * 중앙 점령지 — 3×3, 중심은 맵 정중앙 (6, 9).
 * 맵을 1.5배로 키울 때 5×5로 함께 늘렸다가 **사용자 요청으로 원래 3×3로 되돌렸다** —
 * 맵이 넓어진 만큼 점령지가 상대적으로 좁아져 한 칸을 두고 다투는 밀도가 올라간다.
 */
export const captureZone: Position[] = rect(5, 8, 7, 10);

/** 시작지점 — 좌우 한 칸씩 여백을 두고 3행(기존 2행의 1.5배). 점령지에는 포함되지 않는다. */
export const startZones = {
  p1: rect(1, 0, 11, 2),
  p2: rect(1, 16, 11, 18),
};

/** 좌측 골목 — 폭 1칸, 코너로 직선공격을 차단한다(기존 9칸 길이 → 13칸 구간을 지그재그로 통과) */
export const alleyLeftPath: Position[] = [
  { x: 1, y: 3 },
  { x: 1, y: 4 },
  { x: 1, y: 5 },
  { x: 1, y: 6 },
  { x: 1, y: 7 },
  // 첫 번째 코너 — 오른쪽으로 두 칸 꺾어 점령지 서쪽 입구로 붙는다
  { x: 2, y: 7 },
  { x: 3, y: 7 },
  { x: 3, y: 8 },
  { x: 3, y: 9 },
  { x: 3, y: 10 },
  { x: 3, y: 11 },
  // 두 번째 코너 — 다시 왼쪽 벽면으로 붙어 p2 시작지점까지 내려간다
  { x: 2, y: 11 },
  { x: 1, y: 11 },
  { x: 1, y: 12 },
  { x: 1, y: 13 },
  { x: 1, y: 14 },
  { x: 1, y: 15 },
];

/** 좌측 골목을 감싸는 벽 — bounding box에서 통로를 뺀 나머지 */
const leftBox = rect(0, 3, 3, 15);
export const alleyLeftWalls: Position[] = subtract(leftBox, alleyLeftPath);

/** 우측 다리 — 폭 3칸(기존 2칸의 1.5배), 직선 구간 */
export const bridgeRightPath: Position[] = rect(9, 6, 11, 12);

/** 우측 공터 — 개방된 우회 구역 */
const rightBox = rect(9, 3, 12, 15);
export const fieldRightPath: Position[] = subtract(rightBox, bridgeRightPath);

/** 공터의 엄폐물(원거리 기물의 일방적 공격 방지). 공터가 길어진 만큼 2개 → 3개로 늘렸다. */
export const fieldCoverObstacles: Position[] = [
  { x: 12, y: 5 },
  { x: 12, y: 9 },
  { x: 12, y: 13 },
];

export const obstacles: Position[] = [...alleyLeftWalls, ...fieldCoverObstacles];

export const mapDefinition: BoardConfig = {
  width: WIDTH,
  height: HEIGHT,
  obstacles,
  captureZone,
  startZones,
};

/** UI 차선 색상 표시용(엔진 로직과 무관) */
export const laneHint = {
  narrow: alleyLeftPath,
  wide: [...bridgeRightPath, ...fieldRightPath],
};
