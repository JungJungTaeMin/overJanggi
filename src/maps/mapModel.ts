import type { BoardConfig, Position } from '../engine/types';
import { HEAL_PACK_AMOUNTS } from '../data/constants';
import { MAX_ROSTER_SIZE } from '../data/rosterRules';
import { key } from '../engine/grid';

/**
 * 맵 메이커의 내부 표현.
 *
 * 엔진의 `BoardConfig`는 **종류별 좌표 목록**(장애물 배열, 점령지 배열, 시작지점 배열…)이라
 * 한 칸이 벽이면서 동시에 점령지일 수도 있다 — 저장은 되지만 규칙상 말이 안 되는 맵이다.
 * 에디터는 반대로 **칸 하나에 종류 하나**인 격자로 다룬다. 이러면 겹침이 구조적으로 불가능해져
 * "벽과 점령지가 겹치지 않는가" 같은 검사를 아예 할 필요가 없어진다. 저장할 때만 BoardConfig로
 * 펼치고, 불러올 때 다시 격자로 접는다.
 */
export type TileKind = 'empty' | 'wall' | 'capture' | 'startA' | 'startB' | 'heal10' | 'heal20';

export interface TilePalette {
  kind: TileKind;
  label: string;
  /** 보드/팔레트에서 쓰는 색. Board.tsx의 칸 색과 반드시 같은 값을 써야 미리보기가 실제와 같다. */
  color: string;
  hint: string;
}

/**
 * **판 바닥 색의 유일한 출처.**
 *
 * 예전에는 같은 색이 두 군데 적혀 있었다 — 판을 그리는 Board.tsx의 `cellFill`과 맵 메이커
 * 팔레트. 색을 한 번 바꾸면 다른 쪽은 조용히 옛 색으로 남아, 메이커에서 찍은 맵과 실제로
 * 플레이하는 맵의 색이 달라졌다(미리보기가 미리보기가 아니게 된다). 이제 둘 다 여기를 읽는다.
 *
 * 값이 전부 어두운 이유는 판 위에 올라가는 것들 때문이다. 기물·체력바·피해 숫자·사거리 강조가
 * 전부 바닥 위에 얹히는데, 바닥이 밝으면 그 위에 올릴 수 있는 색은 어두운 색뿐이라 팀색(파랑·빨강)이
 * 서로 비슷해 보인다. 바닥을 어둡게 깔면 밝은 색을 다 쓸 수 있어 무엇이 무엇인지가 색만으로 갈린다.
 */
export const TERRAIN_COLORS = {
  /**
   * 빈 바닥. 두 톤을 번갈아 칠해 격자선 없이도 칸이 세어진다(체스판과 같은 이유).
   *
   * **중립 회색이어야 한다.** 처음엔 판 전체를 푸른 회색으로 깔았는데, 그러자 P1 진영(파랑)이
   * 바닥과 같은 색조라 시작지점이 어디까지인지 안 보였다 — 부활 지점이 안 보이는 판이 된다.
   * 바닥에서 색조를 빼야 진영색 두 개가 둘 다 "칠해진 곳"으로 읽힌다.
   */
  floor: '#1c2130',
  floorAlt: '#171c29',
  /** 벽은 **바닥이 아니라 구멍**으로 읽혀야 한다 — 가장 어두운 값을 준다. */
  wall: '#05080f',
  /** 점령지는 판에서 유일하게 따뜻한 색이다. 눈이 목적지를 먼저 찾게 만든다. */
  capture: '#4a3915',
  startA: '#1a3557',
  startB: '#4a2029',
  heal10: '#17402f',
  heal20: '#1c6244',
} as const;

/** 팔레트 순서 = 화면에 뜨는 순서. 사용자가 요청한 블록 종류가 이 목록의 전부다. */
export const TILE_PALETTE: TilePalette[] = [
  { kind: 'startA', label: '진영 블럭 A', color: TERRAIN_COLORS.startA, hint: 'Player 1의 시작지점 · 부활 지점' },
  { kind: 'startB', label: '진영 블럭 B', color: TERRAIN_COLORS.startB, hint: 'Player 2의 시작지점 · 부활 지점' },
  { kind: 'wall', label: '벽 블럭', color: TERRAIN_COLORS.wall, hint: '이동·직선 공격을 모두 막는다' },
  { kind: 'capture', label: '점령 블럭', color: TERRAIN_COLORS.capture, hint: '이 칸 위의 인원수로 점수를 낸다' },
  { kind: 'heal10', label: '힐팩 10', color: TERRAIN_COLORS.heal10, hint: '밟으면 10 회복 · 3턴 뒤 재생성' },
  { kind: 'heal20', label: '힐팩 20', color: TERRAIN_COLORS.heal20, hint: '밟으면 20 회복 · 3턴 뒤 재생성' },
  { kind: 'empty', label: '지우개', color: TERRAIN_COLORS.floor, hint: '빈 칸으로 되돌린다' },
];

export const MIN_MAP_SIZE = 7;
export const MAX_MAP_SIZE = 25;

const HEAL_TILE: Record<number, TileKind> = { 10: 'heal10', 20: 'heal20' };
const TILE_HEAL: Partial<Record<TileKind, number>> = { heal10: 10, heal20: 20 };

export type TileGrid = TileKind[][];

export function blankTiles(width: number, height: number): TileGrid {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => 'empty' as TileKind));
}

/**
 * 격자 크기 변경. 이미 찍어 둔 칸은 좌상단 기준으로 최대한 보존한다 — 크기를 한 번 잘못 눌렀다고
 * 맵 전체가 날아가면 크기 조절 자체를 무서워서 못 쓰게 된다.
 */
export function resizeTiles(tiles: TileGrid, width: number, height: number): TileGrid {
  const next = blankTiles(width, height);
  for (let y = 0; y < Math.min(height, tiles.length); y++) {
    for (let x = 0; x < Math.min(width, tiles[y].length); x++) next[y][x] = tiles[y][x];
  }
  return next;
}

export function boardToTiles(board: BoardConfig): TileGrid {
  const tiles = blankTiles(board.width, board.height);
  const put = (p: Position, kind: TileKind) => {
    if (p.y >= 0 && p.y < board.height && p.x >= 0 && p.x < board.width) tiles[p.y][p.x] = kind;
  };
  // 겹쳐 저장된 맵(손으로 만든 기본 맵이나 예전 저장본)이 들어올 수 있으므로 순서를 정해 둔다:
  // 벽이 가장 약하고 시작지점이 가장 강하다 — 시작지점이 사라지면 배치가 아예 불가능해지기 때문.
  board.obstacles.forEach((p) => put(p, 'wall'));
  board.captureZone.forEach((p) => put(p, 'capture'));
  (board.healPacks ?? []).forEach((h) => put(h.position, HEAL_TILE[h.amount] ?? 'heal10'));
  board.startZones.p1.forEach((p) => put(p, 'startA'));
  board.startZones.p2.forEach((p) => put(p, 'startB'));
  return tiles;
}

export function tilesToBoard(tiles: TileGrid): BoardConfig {
  const height = tiles.length;
  const width = height > 0 ? tiles[0].length : 0;
  const board: BoardConfig = {
    width,
    height,
    obstacles: [],
    captureZone: [],
    startZones: { p1: [], p2: [] },
    healPacks: [],
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = { x, y };
      switch (tiles[y][x]) {
        case 'wall':
          board.obstacles.push(p);
          break;
        case 'capture':
          board.captureZone.push(p);
          break;
        case 'startA':
          board.startZones.p1.push(p);
          break;
        case 'startB':
          board.startZones.p2.push(p);
          break;
        case 'heal10':
        case 'heal20':
          board.healPacks!.push({ position: p, amount: TILE_HEAL[tiles[y][x]]! });
          break;
        default:
          break;
      }
    }
  }
  return board;
}

/** 걸어서 갈 수 있는 칸 집합(4방향 BFS). 대각 이동이 없는 기물도 있으므로 직선만 센다. */
function floodFill(board: BoardConfig, from: Position[]): Set<string> {
  const blocked = new Set(board.obstacles.map(key));
  const seen = new Set<string>();
  const queue: Position[] = [];
  for (const p of from) {
    if (blocked.has(key(p)) || seen.has(key(p))) continue;
    seen.add(key(p));
    queue.push(p);
  }
  const deltas = [
    { x: 0, y: -1 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
  ];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const d of deltas) {
      const next = { x: cur.x + d.x, y: cur.y + d.y };
      if (next.x < 0 || next.y < 0 || next.x >= board.width || next.y >= board.height) continue;
      const k = key(next);
      if (seen.has(k) || blocked.has(k)) continue;
      seen.add(k);
      queue.push(next);
    }
  }
  return seen;
}

/**
 * 저장 전 검사. **경고가 아니라 차단**이다 — 여기 걸리는 맵은 "재미없는 맵"이 아니라
 * 게임이 시작조차 못 하거나 영원히 안 끝나는 맵이다.
 */
export function validateMap(board: BoardConfig): string[] {
  const errors: string[] = [];
  // 기준은 **가장 큰 편성 규칙**(6대6)이다. 5칸짜리 진영을 통과시키면 그 맵은 자유 편성에서만
  // 쓸 수 있고, 6대6을 고른 사람은 여섯 번째 기물을 놓을 자리가 없는 채로 배치 화면에 갇힌다.
  if (board.startZones.p1.length < MAX_ROSTER_SIZE) {
    errors.push(`진영 블럭 A가 ${board.startZones.p1.length}칸입니다 — 기물 ${MAX_ROSTER_SIZE}개를 배치하려면 최소 ${MAX_ROSTER_SIZE}칸이 필요합니다.`);
  }
  if (board.startZones.p2.length < MAX_ROSTER_SIZE) {
    errors.push(`진영 블럭 B가 ${board.startZones.p2.length}칸입니다 — 최소 ${MAX_ROSTER_SIZE}칸이 필요합니다.`);
  }
  if (board.captureZone.length === 0) {
    errors.push('점령 블럭이 없습니다 — 점수를 낼 방법이 없어 판이 끝나지 않습니다.');
  }
  // 갇힌 점령지/갇힌 진영은 저장 시점에만 잡을 수 있다. 대전 중에 알아차리면 그 판은 통째로 버려진다.
  if (board.captureZone.length > 0) {
    for (const [owner, label] of [
      ['p1', 'A'],
      ['p2', 'B'],
    ] as const) {
      const zone = board.startZones[owner];
      if (zone.length === 0) continue;
      const reach = floodFill(board, zone);
      if (!board.captureZone.some((c) => reach.has(key(c)))) {
        errors.push(`진영 블럭 ${label}에서 점령 블럭까지 걸어갈 길이 없습니다 — 벽으로 막혀 있는지 확인하세요.`);
      }
    }
  }
  for (const pack of board.healPacks ?? []) {
    if (!HEAL_PACK_AMOUNTS.includes(pack.amount as (typeof HEAL_PACK_AMOUNTS)[number])) {
      errors.push(`힐팩 회복량 ${pack.amount}은(는) 지원하지 않습니다.`);
      break;
    }
  }
  return errors;
}

/** 저장 전 안내(차단하지는 않는다). 판이 굴러가긴 하지만 의도치 않았을 가능성이 큰 것들. */
export function mapWarnings(board: BoardConfig): string[] {
  const warnings: string[] = [];
  const a = board.startZones.p1.length;
  const b = board.startZones.p2.length;
  if (a !== b) warnings.push(`진영 블럭 A(${a}칸)와 B(${b}칸)의 크기가 다릅니다 — 부활 여유가 한쪽에 유리합니다.`);
  const packs = board.healPacks ?? [];
  if (packs.length > 0) {
    // 힐팩은 중립 자원이라 위치가 곧 유불리다. 한쪽 진영에 몰려 있으면 그 팀 전용 회복기가 된다.
    const midY = (board.height - 1) / 2;
    const nearA = packs.filter((p) => p.position.y < midY).length;
    const nearB = packs.filter((p) => p.position.y > midY).length;
    if (Math.abs(nearA - nearB) > 1) warnings.push(`힐팩이 한쪽에 몰려 있습니다(위 ${nearA}개 / 아래 ${nearB}개).`);
  }
  return warnings;
}
