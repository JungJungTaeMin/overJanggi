import type { BoardConfig, Position } from '../../engine/types';
import { getUnitType } from '../../data/unitTypes';

export interface MiniMark {
  position: Position;
  className: string;
}

export interface MiniToken {
  position: Position;
  owner: 'p1' | 'p2';
  /** 역할 실루엣을 고르기 위한 기물 종류. 비우면 원으로 그린다. */
  typeId?: string;
  label?: string;
}

interface Props {
  board: BoardConfig;
  cellSize: number;
  /** 칸을 통째로 칠하는 표시(이동 가능 칸 등) */
  fills?: MiniMark[];
  /** 칸 가운데 점(공격 사정권 등) — 칠과 겹쳐도 둘 다 보인다. */
  dots?: MiniMark[];
  /** 칸 테두리(회복 사정권 등) — 칠·점과 셋 다 겹칠 수 있다. */
  rings?: MiniMark[];
  tokens?: MiniToken[];
  /** 맵의 점령지·시작지점·장애물을 함께 그릴지 */
  showTerrain?: boolean;
  title?: string;
}

const OWNER_COLOR: Record<string, string> = { p1: '#2563eb', p2: '#dc2626' };

/**
 * 도움말 전용 축소 보드. 실제 `Board.tsx`를 쓰지 않는 이유는 그쪽이 계획·선택·미리보기 같은
 * 대전용 상태를 잔뜩 요구하기 때문이다 — 설명 그림은 상태가 없어야 하고, 여기서 필요한 건
 * "칸을 칠하고 도형을 얹는다"뿐이다.
 */
export function MiniBoard({ board, cellSize, fills, dots, rings, tokens, showTerrain, title }: Props) {
  const w = board.width * cellSize;
  const h = board.height * cellSize;
  const r = cellSize * 0.3;

  return (
    <svg className="mini-board" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title}>
      {title && <title>{title}</title>}
      {Array.from({ length: board.height }, (_, y) =>
        Array.from({ length: board.width }, (_, x) => (
          <rect key={`${x},${y}`} className="mini-cell" x={x * cellSize} y={y * cellSize} width={cellSize} height={cellSize} />
        )),
      )}

      {showTerrain && (
        <>
          {board.captureZone.map((p) => (
            <rect key={`c${p.x},${p.y}`} className="mini-capture" x={p.x * cellSize} y={p.y * cellSize} width={cellSize} height={cellSize} />
          ))}
          {(['p1', 'p2'] as const).map((owner) =>
            board.startZones[owner].map((p) => (
              <rect
                key={`s${owner}${p.x},${p.y}`}
                className={`mini-start mini-start-${owner}`}
                x={p.x * cellSize}
                y={p.y * cellSize}
                width={cellSize}
                height={cellSize}
              />
            )),
          )}
          {board.obstacles.map((p) => (
            <rect key={`o${p.x},${p.y}`} className="mini-obstacle" x={p.x * cellSize} y={p.y * cellSize} width={cellSize} height={cellSize} />
          ))}
        </>
      )}

      {fills?.map((m) => (
        <rect
          key={`f${m.className}${m.position.x},${m.position.y}`}
          className={m.className}
          x={m.position.x * cellSize}
          y={m.position.y * cellSize}
          width={cellSize}
          height={cellSize}
        />
      ))}

      {rings?.map((m) => (
        <rect
          key={`r${m.className}${m.position.x},${m.position.y}`}
          className={m.className}
          x={m.position.x * cellSize + 1.5}
          y={m.position.y * cellSize + 1.5}
          width={cellSize - 3}
          height={cellSize - 3}
          fill="none"
        />
      ))}

      {dots?.map((m) => (
        <circle
          key={`d${m.className}${m.position.x},${m.position.y}`}
          className={m.className}
          cx={m.position.x * cellSize + cellSize / 2}
          cy={m.position.y * cellSize + cellSize / 2}
          r={Math.max(2, cellSize * 0.17)}
        />
      ))}

      {tokens?.map((t, i) => {
        const cx = t.position.x * cellSize + cellSize / 2;
        const cy = t.position.y * cellSize + cellSize / 2;
        const color = OWNER_COLOR[t.owner];
        const role = t.typeId ? getUnitType(t.typeId).role : 'support';
        // 판 위와 같은 실루엣을 쓴다 — 도움말에서 배운 모양이 대전 화면에서 그대로 보여야 한다.
        const shape =
          role === 'tank' ? (
            <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} fill={color} stroke="#111" strokeWidth={1} />
          ) : role === 'dealer' ? (
            <polygon points={`${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}`} fill={color} stroke="#111" strokeWidth={1} />
          ) : (
            <circle cx={cx} cy={cy} r={r} fill={color} stroke="#111" strokeWidth={1} />
          );
        return (
          <g key={`t${i}`}>
            {shape}
            {t.label && (
              <text x={cx} y={cy + 3} textAnchor="middle" fontSize={Math.max(7, cellSize * 0.42)} fill="#fff">
                {t.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
