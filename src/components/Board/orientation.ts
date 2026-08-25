import type { BoardConfig, Owner, Position } from '../../engine/types';
import type { GameMode } from '../../store/gameStore';

/**
 * **판을 어느 쪽에서 보고 있는가.**
 *
 * 엔진 좌표는 언제나 하나뿐이다 — 기본 맵은 p1 시작지점이 위(y=0), p2가 아래다. 그런데 사람은
 * 자기 진영이 아래에 있어야 앞으로 미는 방향을 직관적으로 읽는다. 그래서 **좌표는 그대로 두고
 * 그리는 자리만** 뒤집는다. 클릭이 돌려주는 좌표도 엔진 좌표 그대로라, 규칙·AI·네트워크는
 * 시점을 전혀 모른다.
 *
 * 상하만 뒤집지 않고 **180° 회전**(x·y 둘 다)을 쓰는 이유: 상하 거울은 좌우를 바꾸지 않아
 * 손잡이(chirality)가 뒤집힌다 — 한 사람에게 왼쪽 골목인 곳이 상대에게도 왼쪽으로 보여
 * "왼쪽으로 돌아가자"가 서로 다른 곳을 가리키게 된다. 실제로 판을 사이에 두고 마주 앉으면
 * 판이 180° 돌아간 것이고, 그때 한쪽의 왼쪽은 반대쪽의 오른쪽이다.
 */
export type BoardView = (p: Position) => Position;

const IDENTITY: BoardView = (p) => p;

export function boardView(board: BoardConfig, flipped: boolean): BoardView {
  if (!flipped) return IDENTITY;
  return (p) => ({ x: board.width - 1 - p.x, y: board.height - 1 - p.y });
}

/**
 * 내 진영이 아래로 오도록 뒤집어야 하는가.
 *
 * `localOwner === 'p1'`으로 적지 않고 **시작지점이 실제로 어느 쪽에 있는지 재는** 이유는
 * 맵 메이커로 만든 맵 때문이다 — 커스텀 맵은 진영을 좌우로 놓거나 위아래를 바꿔 놓을 수 있어서,
 * 기본 맵의 배치를 상수로 박아 두면 그런 맵에서 오히려 내 진영이 위로 간다.
 *
 * **온라인에서만** 뒤집는다. 로컬 대전은 한 사람이 양쪽을 다 조종해 "내 진영"이라는 것이 없고,
 * AI 대전은 지금까지 보던 방향이 있어 요청 없이 돌려 놓으면 그게 더 낯설다.
 */
export function isBoardFlipped(board: BoardConfig, localOwner: Owner, mode: GameMode): boolean {
  if (mode !== 'online') return false;
  const zone = board.startZones[localOwner];
  if (!zone || zone.length === 0) return false;
  const midY = (board.height - 1) / 2;
  const avgY = zone.reduce((sum, p) => sum + p.y, 0) / zone.length;
  // 내 시작지점이 위쪽 절반에 있으면 돌려서 아래로 내린다. 정확히 가운데면 돌릴 이유가 없다.
  return avgY < midY;
}
