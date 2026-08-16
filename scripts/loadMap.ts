/**
 * 분석 스크립트가 공유하는 맵 로더. 앱 번들에 포함되지 않는다.
 *
 * 왜 따로 두는가: 커스텀 맵 시험(customMapPlay)과 밸런스 측정(balanceSim)이 **같은 맵**을 읽어야
 * "이 맵에서 이 기물이 세다"는 말이 성립한다. 로딩 코드를 각자 들고 있으면 한쪽만 고쳐졌을 때
 * 서로 다른 맵을 재면서 같은 맵인 줄 아는 사고가 난다.
 *
 * 맵은 편집기와 **같은 경로**(TileGrid → tilesToBoard)로 만든다. 여기서만 통하는 별도 변환을 쓰면
 * 정작 사용자가 저장한 맵과 다른 것을 시험하게 된다.
 */
import { readFileSync } from 'node:fs';
import { mapDefinition } from '../src/data/mapDefinitions';
import { boardToTiles, tilesToBoard, type TileGrid, type TileKind } from '../src/maps/mapModel';
import { decodeMap } from '../src/maps/mapStorage';
import type { BoardConfig } from '../src/engine/types';

/**
 * 시험용 맵을 그림으로 적는다. 좌표 배열로 적으면 사람이 읽고 고칠 수 없어서, 맵의 모양이
 * 문제인지 규칙이 문제인지 구분이 안 된다.
 *
 *   A/B 진영 블럭   # 벽 블럭   C 점령 블럭   h 힐팩10   H 힐팩20   . 빈 칸
 */
const ASCII_LEGEND: Record<string, TileKind> = {
  '.': 'empty',
  '#': 'wall',
  C: 'capture',
  A: 'startA',
  B: 'startB',
  h: 'heal10',
  H: 'heal20',
};

/**
 * 기본 시험 맵 '십자로'. 정원 맵과 일부러 다르게 만들었다 — 좌우 대칭이면서 **위아래로도** 대칭이라
 * 진영 유불리가 없고(그래야 승률 편향이 맵 탓인지 기물 탓인지 구분된다), 점령지를 벽으로 둘러싸
 * 진입로를 네 곳으로 좁혔다. 힐팩은 중앙선 기준으로 정확히 반씩 놓아 한 팀 전용 회복기가 되지 않게 했다.
 */
const SAMPLE_MAP = [
  '.AAAAAAAAAAA.',
  '.A.........A.',
  '....#####....',
  '..h.......h..',
  '..#..###..#..',
  '.....#.#.....',
  '...#.CCC.#...',
  '..H..CCC..H..',
  '...#.CCC.#...',
  '.....#.#.....',
  '..#..###..#..',
  '..h.......h..',
  '....#####....',
  '.B.........B.',
  '.BBBBBBBBBBB.',
];

export function asciiToTiles(rows: string[]): TileGrid {
  const width = Math.max(...rows.map((r) => r.length));
  return rows.map((row) =>
    Array.from({ length: width }, (_, x) => {
      const ch = row[x] ?? '.';
      const kind = ASCII_LEGEND[ch];
      if (!kind) throw new Error(`알 수 없는 맵 기호 '${ch}'`);
      return kind;
    }),
  );
}

const TILE_CHAR: Record<TileKind, string> = { empty: '·', wall: '█', capture: 'C', startA: 'A', startB: 'B', heal10: 'h', heal20: 'H' };

export function renderBoard(board: BoardConfig): string {
  return boardToTiles(board)
    .map((row) => row.map((k) => TILE_CHAR[k]).join(''))
    .join('\n');
}

/**
 * 맵 인자를 보드로 바꾼다.
 *   'garden'      기본 정원 맵
 *   'sample'      위 '십자로' 시험 맵
 *   '*.txt'       위 ASCII와 같은 형식으로 그린 텍스트 파일
 *   그 외          맵 메이커의 '공유 코드 복사'로 뽑은 문자열
 */
export function loadBoard(arg: string): { name: string; board: BoardConfig } {
  if (arg === 'garden') return { name: '정원 (기본 맵)', board: mapDefinition };
  if (arg === 'sample') return { name: '십자로 (시험용 커스텀 맵)', board: tilesToBoard(asciiToTiles(SAMPLE_MAP)) };
  // 맵을 고쳐 가며 재보려면 스크립트를 매번 편집하는 것보다 파일을 바꾸는 편이 낫다 — 시험한 맵이
  // 파일로 남아 나중에 비교할 수도 있다.
  if (arg.endsWith('.txt')) {
    const rows = readFileSync(arg, 'utf8').split('\n').filter((r) => r.trim().length > 0);
    return { name: arg, board: tilesToBoard(asciiToTiles(rows)) };
  }
  // 사용자가 실제로 만든 맵을 그대로 붙여 넣어 돌릴 수 있어야 이 도구가 쓸모 있다.
  const imported = decodeMap(arg);
  return { name: `${imported.name} (공유 코드)`, board: imported.board };
}
