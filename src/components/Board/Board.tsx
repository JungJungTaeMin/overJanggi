import type { BoardConfig, Position, UnitInstance } from '../../engine/types';
import { healPackAt, isInCaptureZone, isObstacle, samePosition } from '../../engine/grid';
import type { PreviewStep } from '../Planning/actionGeometry';
import { UnitToken } from './UnitToken';

export const CELL_SIZE = 42;

/** 시간 역행(추가 이동) 구간을 일반 이동과 구분하는 색 — 기준점 표시에도 같은 색을 쓴다. */
export const REWIND_COLOR = '#7c3aed';

export interface PreviewMove {
  unit: UnitInstance;
  to: Position;
  /** 스텝별 경로. 추가 이동 구간(isExtra)은 보라색 실선으로 구분해 그린다. */
  steps: PreviewStep[];
}

/** dealer2 시간 역행 기준점(복귀 지점) 표시 정보. */
export interface RewindAnchor {
  unit: UnitInstance;
  position: Position;
  hp: number;
}

/** 힐팩 색 — 맵 메이커 팔레트(mapModel.TILE_PALETTE)와 반드시 같은 값이어야 미리보기가 실제와 같다. */
export const HEAL_PACK_COLOR: Record<number, string> = { 10: '#bbf7d0', 20: '#4ade80' };

interface Props {
  board: BoardConfig;
  units: UnitInstance[];
  /** 비어 있는(재생성 대기 중인) 힐팩 표시용. GameState.healPackTimers를 그대로 넘긴다. */
  healPackTimers?: Record<string, number>;
  highlightCells?: Position[];
  /** 선택된 유닛이 이동 가능한 칸(초록 강조) — 클릭하면 해당 방향·칸수로 이동을 지정한다. */
  moveCells?: Position[];
  /** 선택된 유닛이 공격 가능한 칸(주황 강조) — 클릭하면 해당 방향으로 공격을 지정한다. */
  attackCells?: Position[];
  /**
   * 이동 칸과 공격 칸이 **겹치는 칸**을 클릭했을 때 무엇으로 해석하는지.
   * 색·툴팁이 이 우선순위를 그대로 따라야 "클릭하면 무슨 일이 일어나는가"가 보드만 보고 읽힌다.
   */
  clickPriority?: 'move' | 'attack';
  clickableCells?: Position[];
  selectedUnitId?: string | null;
  onCellClick?: (p: Position) => void;
  onUnitClick?: (instanceId: string) => void;
  /** 공개(해결) 전, 이동을 계획한 유닛들을 도착 칸에 반투명 "예정" 토큰으로 미리 보여준다. */
  previewMoves?: PreviewMove[];
  /** dealer2 시간 역행 기준점 — 충전을 다 쓰면 이 칸·이 체력으로 돌아간다. */
  rewindAnchors?: RewindAnchor[];
}

function cellFill(p: Position, board: BoardConfig): string {
  if (isObstacle(p, board)) return '#374151';
  if (isInCaptureZone(p, board)) return '#fde68a';
  // 힐팩은 시작지점 안에도 놓을 수 있으므로 진영 색보다 먼저 본다 — 진영 색에 덮이면 안 보인다.
  const pack = healPackAt(p, board);
  if (pack) return HEAL_PACK_COLOR[pack.amount] ?? '#bbf7d0';
  if (board.startZones.p1.some((s) => samePosition(s, p))) return '#dbeafe';
  if (board.startZones.p2.some((s) => samePosition(s, p))) return '#fee2e2';
  return '#f8fafc';
}

function toSet(cells: Position[]): Set<string> {
  return new Set(cells.map((c) => `${c.x},${c.y}`));
}

/** 정원 맵 SVG 렌더링 — 구역 배경 → 장애물 → 이동/공격/일반 강조 → 유닛 순서로 그린다. */
export function Board({
  board,
  units,
  healPackTimers = {},
  highlightCells = [],
  moveCells = [],
  attackCells = [],
  clickPriority = 'move',
  clickableCells = [],
  selectedUnitId,
  onCellClick,
  onUnitClick,
  previewMoves = [],
  rewindAnchors = [],
}: Props) {
  const cells: Position[] = [];
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) cells.push({ x, y });
  }
  const moveSet = toSet(moveCells);
  const attackSet = toSet(attackCells);
  const clickableSet = new Set([...clickableCells, ...moveCells, ...attackCells].map((c) => `${c.x},${c.y}`));
  const highlightSet = toSet(highlightCells);

  return (
    <svg
      className="board-svg"
      // 맵이 13×19로 커지면서 원본 크기(546×798px)가 화면 높이를 넘긴다.
      // viewBox를 두고 실제 표시 크기는 CSS(max-height)에 맡겨 비율 그대로 축소되게 한다.
      viewBox={`0 0 ${board.width * CELL_SIZE} ${board.height * CELL_SIZE}`}
      width={board.width * CELL_SIZE}
      height={board.height * CELL_SIZE}
    >
      {cells.map((p) => {
        const key = `${p.x},${p.y}`;
        const clickable = clickableSet.has(key);
        const isMove = moveSet.has(key);
        const isAttack = attackSet.has(key);
        let fill = cellFill(p, board);
        // 이동/공격 칸이 겹치면 클릭 처리(handleCellClick)가 지금 모드 쪽을 먼저 보므로 색도 같이 맞춘다.
        const attackFirst = clickPriority === 'attack';
        if (attackFirst ? isAttack : isMove) fill = attackFirst ? '#fed7aa' : '#bbf7d0';
        else if (attackFirst ? isMove : isAttack) fill = attackFirst ? '#bbf7d0' : '#fed7aa';
        return (
          <rect
            key={key}
            className={clickable ? 'board-cell clickable' : 'board-cell'}
            x={p.x * CELL_SIZE}
            y={p.y * CELL_SIZE}
            width={CELL_SIZE}
            height={CELL_SIZE}
            fill={fill}
            stroke="#cbd5e1"
            strokeWidth={0.5}
            cursor={clickable ? 'pointer' : 'default'}
            onClick={clickable ? () => onCellClick?.(p) : undefined}
          >
            {clickable && (
              <title>
                {(clickPriority === 'attack' ? isAttack : isMove)
                  ? clickPriority === 'attack'
                    ? '클릭해서 이 방향으로 공격'
                    : '클릭해서 이 칸으로 이동'
                  : isAttack
                    ? '클릭해서 이 방향으로 공격'
                    : isMove
                      ? '클릭해서 이 칸으로 이동'
                      : '클릭해서 배치'}
              </title>
            )}
          </rect>
        );
      })}
      {/* 힐팩 — 십자 표시. 먹어서 비어 있는 동안은 회색 점선 + 남은 턴수를 띄운다.
          색만 다르게 하면 "여기 힐팩이 있었나?"를 기억해야 하므로 남은 턴을 숫자로 보여 준다. */}
      {(board.healPacks ?? []).map((pack) => {
        const cx = pack.position.x * CELL_SIZE + CELL_SIZE / 2;
        const cy = pack.position.y * CELL_SIZE + CELL_SIZE / 2;
        const arm = CELL_SIZE * 0.18;
        const thick = CELL_SIZE * 0.07;
        const remaining = healPackTimers[`${pack.position.x},${pack.position.y}`] ?? 0;
        const color = remaining > 0 ? '#94a3b8' : '#15803d';
        return (
          <g key={`pack-${pack.position.x},${pack.position.y}`} pointerEvents="none" opacity={remaining > 0 ? 0.5 : 1}>
            <rect x={cx - arm} y={cy - thick} width={arm * 2} height={thick * 2} fill={color} rx={1} />
            <rect x={cx - thick} y={cy - arm} width={thick * 2} height={arm * 2} fill={color} rx={1} />
            <text x={cx} y={cy + CELL_SIZE / 2 - 2} textAnchor="middle" fontSize={8} fontWeight="bold" fill={color}>
              {remaining > 0 ? `${remaining}턴` : pack.amount}
            </text>
          </g>
        );
      })}
      {[...highlightSet].map((key) => {
        const [x, y] = key.split(',').map(Number);
        return (
          <rect
            key={`hl-${key}`}
            x={x * CELL_SIZE + 2}
            y={y * CELL_SIZE + 2}
            width={CELL_SIZE - 4}
            height={CELL_SIZE - 4}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={2}
            pointerEvents="none"
          />
        );
      })}
      {/* 겹친 칸에서는 나중에 그린 테두리만 보이므로, **지금 클릭이 향하는 쪽**을 나중에 그린다. */}
      {(clickPriority === 'attack'
        ? [
            { prefix: 'mv', set: moveSet, color: '#16a34a' },
            { prefix: 'atk', set: attackSet, color: '#ea580c' },
          ]
        : [
            { prefix: 'atk', set: attackSet, color: '#ea580c' },
            { prefix: 'mv', set: moveSet, color: '#16a34a' },
          ]
      ).flatMap(({ prefix, set, color }) =>
        [...set].map((key) => {
          const [x, y] = key.split(',').map(Number);
          return (
            <rect
              key={`${prefix}-${key}`}
              x={x * CELL_SIZE + 2}
              y={y * CELL_SIZE + 2}
              width={CELL_SIZE - 4}
              height={CELL_SIZE - 4}
              fill="none"
              stroke={color}
              strokeWidth={2}
              pointerEvents="none"
            />
          );
        }),
      )}
      {/* 기준점(복귀 지점): 보라색 점선 마름모 + 기준 체력 라벨 */}
      {rewindAnchors.map(({ unit, position, hp }) => {
        const cx = position.x * CELL_SIZE + CELL_SIZE / 2;
        const cy = position.y * CELL_SIZE + CELL_SIZE / 2;
        const s = CELL_SIZE * 0.34;
        return (
          <g key={`anchor-${unit.instanceId}`} pointerEvents="none">
            <polygon
              points={`${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`}
              fill="none"
              stroke={REWIND_COLOR}
              strokeWidth={2}
              strokeDasharray="3 2"
            />
            <text x={cx} y={cy - s - 3} textAnchor="middle" fontSize={8} fill={REWIND_COLOR} fontWeight="bold">
              ⟲{hp}
            </text>
          </g>
        );
      })}
      {/* 이동 예정 경로: 칸마다 방향이 꺾일 수 있으므로 스텝별 선분으로 그린다.
          기본 이동 구간은 소유자 색 점선, 기술로 얻은 추가 이동 구간은 보라색 실선. */}
      {previewMoves.flatMap(({ unit, steps }) => {
        const ownerColor = unit.owner === 'p1' ? '#2563eb' : '#dc2626';
        return steps.map((s) => (
          <line
            key={`preview-line-${unit.instanceId}-${s.stepIndex}`}
            x1={s.from.x * CELL_SIZE + CELL_SIZE / 2}
            y1={s.from.y * CELL_SIZE + CELL_SIZE / 2}
            x2={s.to.x * CELL_SIZE + CELL_SIZE / 2}
            y2={s.to.y * CELL_SIZE + CELL_SIZE / 2}
            stroke={s.isExtra ? REWIND_COLOR : ownerColor}
            strokeWidth={s.isExtra ? 2.5 : 1.5}
            strokeDasharray={s.isExtra ? undefined : '4 3'}
            opacity={s.isExtra ? 0.85 : 0.6}
            pointerEvents="none"
          />
        ));
      })}
      {/* 스텝 번호(1번·2번… 이동) — 어느 칸이 몇 번째 이동인지 보드에서 바로 읽을 수 있게 한다. */}
      {previewMoves.flatMap(({ unit, steps }) =>
        steps.map((s) => (
          <text
            key={`preview-idx-${unit.instanceId}-${s.stepIndex}`}
            x={s.to.x * CELL_SIZE + CELL_SIZE - 6}
            y={s.to.y * CELL_SIZE + 10}
            textAnchor="middle"
            fontSize={8}
            fontWeight="bold"
            fill={s.isExtra ? REWIND_COLOR : '#334155'}
            pointerEvents="none"
          >
            {s.stepIndex + 1}
          </text>
        )),
      )}
      {/* 구간 도착점: "기본 이동으로 여기까지 / 기술 1회를 더 쓰면 여기까지 …"를 한눈에 보여준다.
          dealer2 시간역행처럼 충전 1회가 이동 Lv만큼을 통째로 더해 주는 기술에서 특히 중요하다. */}
      {previewMoves.flatMap(({ unit, steps }) => {
        const ownerColor = unit.owner === 'p1' ? '#2563eb' : '#dc2626';
        return steps
          .filter((s) => s.isSegmentEnd)
          .map((s) => {
            const color = s.segmentIndex === 0 ? ownerColor : REWIND_COLOR;
            const cx = s.to.x * CELL_SIZE + CELL_SIZE / 2;
            const cy = s.to.y * CELL_SIZE + CELL_SIZE / 2;
            return (
              <g key={`seg-${unit.instanceId}-${s.segmentIndex}-${s.stepIndex}`} pointerEvents="none">
                <circle cx={cx} cy={cy} r={CELL_SIZE * 0.42} fill="none" stroke={color} strokeWidth={1.5} opacity={0.9} />
                <text x={cx} y={cy + CELL_SIZE / 2 - 2} textAnchor="middle" fontSize={8} fontWeight="bold" fill={color}>
                  {s.segmentIndex === 0 ? '기본' : `기술${s.segmentIndex}`}
                </text>
              </g>
            );
          });
      })}
      {units.map((u) => (
        <UnitToken
          key={u.instanceId}
          unit={u}
          cellSize={CELL_SIZE}
          selected={u.instanceId === selectedUnitId}
          onClick={onUnitClick ? () => onUnitClick(u.instanceId) : undefined}
        />
      ))}
      {previewMoves.map(({ unit, to }) => (
        <UnitToken key={`preview-${unit.instanceId}`} unit={unit} cellSize={CELL_SIZE} ghost previewPosition={to} />
      ))}
    </svg>
  );
}
