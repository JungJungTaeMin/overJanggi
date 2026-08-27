import { useMemo, type CSSProperties } from 'react';
import type { BoardConfig, Position, UnitInstance } from '../../engine/types';
import { healPackAt, isInCaptureZone, isObstacle, samePosition } from '../../engine/grid';
import type { PreviewStep } from '../Planning/actionGeometry';
import { UnitToken } from './UnitToken';
import { flankBonusFor } from '../../engine/flankBonus';
import { boardView } from './orientation';
import type { BoardMark, BoardRay, MarkKind, RayKind } from './resolutionMarkers';
import type { AimMark } from '../Planning/aimPreview';

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
   * 계획한 회복 기술이 닿는 칸. 이동·공격 칸과 달리 **클릭 대상이 아니라 알림**이다 —
   * 자기중심 반경(범위 회복형)은 대상을 고르는 게 아니라 서는 자리로 정해지기 때문이다.
   * 그래서 칸을 칠하지 않고 테두리만 그려 클릭 가능한 칸과 헷갈리지 않게 한다.
   */
  healCells?: Position[];
  /**
   * 이동 칸과 공격 칸이 **겹치는 칸**을 클릭했을 때 무엇으로 해석하는지.
   * 색·툴팁이 이 우선순위를 그대로 따라야 "클릭하면 무슨 일이 일어나는가"가 보드만 보고 읽힌다.
   */
  clickPriority?: 'move' | 'attack';
  /**
   * 이동·공격 칸 중 **동전이 앞면이어야만 닿는 칸**(확률·포탑형). 찍을 수는 있지만 보장되지
   * 않는다는 것이 색으로 읽혀야 한다 — 근거·판정은 Planning/actionGeometry.ts.
   */
  luckyCells?: Position[];
  clickableCells?: Position[];
  selectedUnitId?: string | null;
  onCellClick?: (p: Position) => void;
  onUnitClick?: (instanceId: string) => void;
  /** 공개(해결) 전, 이동을 계획한 유닛들을 도착 칸에 반투명 "예정" 토큰으로 미리 보여준다. */
  previewMoves?: PreviewMove[];
  /** dealer2 시간 역행 기준점 — 충전을 다 쓰면 이 칸·이 체력으로 돌아간다. */
  rewindAnchors?: RewindAnchor[];
  /**
   * 판을 180° 돌려 그린다(내 진영을 아래로). **그리는 자리만** 바뀌고 클릭이 돌려주는 좌표는
   * 엔진 좌표 그대로다 — 근거는 orientation.ts.
   */
  flipped?: boolean;
  /** 단계 재생 중 판 위에 띄우는 표시(-8 / +3 / 빗나감 / 막힘 / 격추). 근거는 resolutionMarkers.ts. */
  marks?: BoardMark[];
  /** 같은 재생의 "누가 누구에게"를 잇는 선. */
  rays?: BoardRay[];
  /**
   * 지금 조준하면 **무엇이 맞는지**(클릭 전 미리보기). 사거리 칸(주황)은 사선이 뻗는 범위일 뿐이라
   * "여기 쏘면 맞는다"를 뜻하지 않는다 — 근거·판정은 Planning/aimPreview.ts.
   */
  aimMarks?: AimMark[];
}

/** 표시 색 — 판의 다른 강조색(초록=이동, 주황=공격 사거리)과 겹치지 않게 고른 값들. */
const MARK_STYLE: Record<MarkKind, { fill: string; text: string }> = {
  damage: { fill: '#dc2626', text: '#ffffff' },
  heal: { fill: '#15803d', text: '#ffffff' },
  blocked: { fill: '#0ea5e9', text: '#ffffff' },
  miss: { fill: '#94a3b8', text: '#ffffff' },
  death: { fill: '#1f2937', text: '#ffffff' },
  respawn: { fill: '#7c3aed', text: '#ffffff' },
};

const RAY_STYLE: Record<RayKind, { stroke: string; dash?: string }> = {
  hit: { stroke: '#dc2626' },
  blocked: { stroke: '#0ea5e9', dash: '5 3' },
  heal: { stroke: '#15803d', dash: '2 3' },
};

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

/** 조준 미리보기 색 — 맞는다=공격색(주황), 방벽=재생 중 「막힘」과 같은 하늘색, 아군 차단=회색. */
const AIM_STYLE: Record<AimMark['kind'], { stroke: string; dash?: string; label: string }> = {
  hit: { stroke: '#ea580c', label: '이 방향으로 쏘면 맞습니다' },
  ally: { stroke: '#94a3b8', dash: '3 2', label: '아군이 사선을 막고 있습니다 — 비키면 닿습니다' },
  barrier: { stroke: '#0ea5e9', dash: '3 2', label: '방벽에 막혀 피해가 들어가지 않습니다' },
};

/**
 * 한 칸에 여러 방향의 조준 결과가 겹칠 수 있다(범위 공격, 대각·직선을 함께 쏘는 기물).
 * 겹치면 **가장 유리한 것 하나만** 남긴다 — 같은 칸에 표식을 두 번 겹쳐 그리면 굵기만 늘어나
 * 무슨 뜻인지 되레 안 읽힌다. 우선순위는 hit > barrier > ally: 때릴 수 있다는 사실이 먼저다.
 */
const AIM_RANK: Record<AimMark['kind'], number> = { hit: 2, barrier: 1, ally: 0 };

function dedupeAimMarks(marks: AimMark[]): AimMark[] {
  const best = new Map<string, AimMark>();
  for (const m of marks) {
    const key = `${m.position.x},${m.position.y}`;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, m);
      continue;
    }
    if (AIM_RANK[m.kind] > AIM_RANK[prev.kind]) best.set(key, m);
    else if (m.kind === 'hit' && prev.kind === 'hit' && (m.damage ?? 0) > (prev.damage ?? 0)) best.set(key, m);
  }
  return [...best.values()];
}

/** 정원 맵 SVG 렌더링 — 구역 배경 → 장애물 → 이동/공격/일반 강조 → 유닛 순서로 그린다. */
export function Board({
  board,
  units,
  healPackTimers = {},
  highlightCells = [],
  moveCells = [],
  attackCells = [],
  healCells = [],
  clickPriority = 'move',
  luckyCells = [],
  clickableCells = [],
  selectedUnitId,
  onCellClick,
  onUnitClick,
  previewMoves = [],
  rewindAnchors = [],
  flipped = false,
  marks = [],
  rays = [],
  aimMarks = [],
}: Props) {
  const cells: Position[] = [];
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) cells.push({ x, y });
  }
  // 엔진 좌표 → 화면 좌표. 아래에서 픽셀을 계산하는 곳은 **전부** 이 두 함수를 거친다.
  const view = boardView(board, flipped);
  const px = (x: number) => (flipped ? board.width - 1 - x : x) * CELL_SIZE;
  const py = (y: number) => (flipped ? board.height - 1 - y : y) * CELL_SIZE;
  const moveSet = toSet(moveCells);
  const attackSet = toSet(attackCells);
  const luckySet = toSet(luckyCells);
  /**
   * 지금 조준 중인 기물의 패시브가 **어느 대상에게** 얹히는지. 측정에서 이 패시브가 dealer4 전체
   * 피해의 36.3%를 차지하는 것으로 나왔는데(표기 공격력 5, 실효 8.18) 화면에는 아무 단서도 없었다 —
   * 사거리 안에 둘이 서 있으면 어느 쪽을 쏘는 게 이득인지가 조준 시점에 보여야 한다.
   *
   * 조건과 수치는 engine/flankBonus.ts가 단일 근거다(해결 단계가 부르는 바로 그 함수).
   * 사거리 밖까지 칠하면 소음이라 **지금 때릴 수 있는 칸**에 선 적만 표시한다.
   */
  const flankTargets = useMemo(() => {
    const marks = new Map<string, number>();
    const attacker = units.find((u) => u.instanceId === selectedUnitId);
    if (!attacker) return marks;
    for (const target of units) {
      if (!target.alive || !target.position) continue;
      if (!attackSet.has(`${target.position.x},${target.position.y}`)) continue;
      const bonus = flankBonusFor(attacker, target, units);
      if (bonus > 0) marks.set(target.instanceId, bonus);
    }
    return marks;
  }, [units, selectedUnitId, attackCells]);
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
        // 동전이 앞면이어야만 닿는 칸은 **같은 색의 옅은 톤**을 쓴다. 다른 색을 주면 새로운 뜻으로
        // 읽히지만, 실제로는 "같은 이동 칸인데 보장이 안 될 뿐"이다.
        const isLucky = luckySet.has(key);
        let fill = cellFill(p, board);
        // 이동/공격 칸이 겹치면 클릭 처리(handleCellClick)가 지금 모드 쪽을 먼저 보므로 색도 같이 맞춘다.
        const attackFirst = clickPriority === 'attack';
        const moveFill = isLucky ? '#e8f8ee' : '#bbf7d0';
        const attackFill = isLucky ? '#fdeee0' : '#fed7aa';
        if (attackFirst ? isAttack : isMove) fill = attackFirst ? attackFill : moveFill;
        else if (attackFirst ? isMove : isAttack) fill = attackFirst ? moveFill : attackFill;
        return (
          <rect
            key={key}
            className={clickable ? 'board-cell clickable' : 'board-cell'}
            x={px(p.x)}
            y={py(p.y)}
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
                {isLucky ? ' — 동전이 앞면일 때만 닿습니다(50%)' : ''}
              </title>
            )}
          </rect>
        );
      })}
      {/* 힐팩 — 십자 표시. 먹어서 비어 있는 동안은 회색 점선 + 남은 턴수를 띄운다.
          색만 다르게 하면 "여기 힐팩이 있었나?"를 기억해야 하므로 남은 턴을 숫자로 보여 준다. */}
      {(board.healPacks ?? []).map((pack) => {
        const cx = px(pack.position.x) + CELL_SIZE / 2;
        const cy = py(pack.position.y) + CELL_SIZE / 2;
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
            x={px(x) + 2}
            y={py(y) + 2}
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
          // 보장되지 않는 칸은 **점선**으로 두른다. 옅은 채움만으로는 판 배경색과 섞여 안 읽히는
          // 칸이 생기는데(시작지점·점령지 위), 테두리는 어디에 놓여도 뜻이 그대로 남는다.
          const lucky = luckySet.has(key);
          return (
            <rect
              key={`${prefix}-${key}`}
              x={px(x) + 2}
              y={py(y) + 2}
              width={CELL_SIZE - 4}
              height={CELL_SIZE - 4}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeDasharray={lucky ? '3 3' : undefined}
              opacity={lucky ? 0.7 : 1}
              pointerEvents="none"
            />
          );
        }),
      )}
      {/* 기준점(복귀 지점): 보라색 점선 마름모 + 기준 체력 라벨 */}
      {rewindAnchors.map(({ unit, position, hp }) => {
        const cx = px(position.x) + CELL_SIZE / 2;
        const cy = py(position.y) + CELL_SIZE / 2;
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
            x1={px(s.from.x) + CELL_SIZE / 2}
            y1={py(s.from.y) + CELL_SIZE / 2}
            x2={px(s.to.x) + CELL_SIZE / 2}
            y2={py(s.to.y) + CELL_SIZE / 2}
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
            x={px(s.to.x) + CELL_SIZE - 6}
            y={py(s.to.y) + 10}
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
            const cx = px(s.to.x) + CELL_SIZE / 2;
            const cy = py(s.to.y) + CELL_SIZE / 2;
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
      {healCells.map((p) => (
        <rect
          key={`heal-${p.x},${p.y}`}
          className="heal-range-cell"
          x={px(p.x) + 1.5}
          y={py(p.y) + 1.5}
          width={CELL_SIZE - 3}
          height={CELL_SIZE - 3}
          fill="none"
          pointerEvents="none"
        />
      ))}
      {/* 해결 재생: "누가 누구에게"를 잇는 선. 기물보다 **아래**에 깔아 토큰을 가리지 않게 한다. */}
      {rays.length > 0 && (
        <defs>
          {(Object.keys(RAY_STYLE) as RayKind[]).map((kind) => (
            <marker
              key={kind}
              id={`ray-arrow-${kind}`}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="4"
              markerHeight="4"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L8,4 L0,8 z" fill={RAY_STYLE[kind].stroke} />
            </marker>
          ))}
        </defs>
      )}
      {/**
       * **선은 결과이고, 탄은 과정이다.**
       *
       * 화살표 선만 그리면 「A가 B를 때렸다」는 사실은 남지만 *때리는 일이 벌어지는 순간*은 없다 —
       * 판이 한 프레임 만에 결과 그림으로 갈아 끼워지므로, 단계를 나눠 놓고도 공격 단계는 여전히
       * 정지 화면 두 장이다. 그래서 쏜 자리에서 맞은 자리로 **실제로 날아가는 탄**을 하나 얹는다.
       *
       * 좌표별 keyframe을 만들 수는 없으므로 이동량을 CSS 변수로 넘긴다(index.css의 `bullet-fly`).
       * 도착 시점에 맞춰 늦게 터지는 충격 고리까지가 한 벌이다 — 탄이 아직 날아가는 중에 터지면
       * 인과가 뒤집혀 보인다.
       */}
      {rays.map((ray) => {
        const x1 = px(ray.from.x) + CELL_SIZE / 2;
        const y1 = py(ray.from.y) + CELL_SIZE / 2;
        const x2 = px(ray.to.x) + CELL_SIZE / 2;
        const y2 = py(ray.to.y) + CELL_SIZE / 2;
        const style = RAY_STYLE[ray.kind];
        return (
          <g key={ray.key} pointerEvents="none">
            <line
              className="board-ray"
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={style.stroke}
              strokeWidth={2.5}
              strokeDasharray={style.dash}
              markerEnd={`url(#ray-arrow-${ray.kind})`}
              opacity={0.85}
            />
            <circle
              className="board-bullet"
              cx={x1}
              cy={y1}
              // 회복은 총알이 아니다 — 같은 궤적을 쓰되 더 크고 무른 빛으로 그려 뜻을 가른다.
              r={ray.kind === 'heal' ? 4 : 3}
              fill={style.stroke}
              style={{ '--fly-x': `${x2 - x1}px`, '--fly-y': `${y2 - y1}px` } as CSSProperties}
            />
            <circle className="board-impact" cx={x2} cy={y2} r={CELL_SIZE * 0.3} fill="none" stroke={style.stroke} strokeWidth={2} />
          </g>
        );
      })}
      {/* 조준 미리보기(클릭 전). 유닛보다 **먼저** 그려 토큰이 위에 오게 한다 — 표식은 대상을
          가리키는 것이지 대상을 가리는 것이 아니다. 한 칸에 여러 방향이 겹치면 가장 센 것만 남긴다. */}
      {dedupeAimMarks(aimMarks).map((m) => {
        const cx = px(m.position.x) + CELL_SIZE / 2;
        const cy = py(m.position.y) + CELL_SIZE / 2;
        const s = CELL_SIZE * 0.44;
        const style = AIM_STYLE[m.kind];
        return (
          <g key={`aim-${m.position.x},${m.position.y}`} className="aim-mark" pointerEvents="none">
            {/* 조준선 모서리 4개. 원이나 채움을 쓰면 이미 판에 있는 강조(선택 링·측면 교란 링)와
                섞여 버려서, 겹쳐도 뜻이 갈리는 도형으로 골랐다. */}
            {[
              [-1, -1],
              [1, -1],
              [-1, 1],
              [1, 1],
            ].map(([sx, sy]) => (
              <path
                key={`${sx},${sy}`}
                d={`M ${cx + sx * s} ${cy + sy * s * 0.45} L ${cx + sx * s} ${cy + sy * s} L ${cx + sx * s * 0.45} ${cy + sy * s}`}
                fill="none"
                stroke={style.stroke}
                strokeWidth={2}
                strokeLinecap="round"
                strokeDasharray={style.dash}
              />
            ))}
            {m.kind === 'hit' && (
              <text
                x={cx}
                y={cy - s - 2}
                textAnchor="middle"
                fontSize={10}
                fontWeight="bold"
                fill={style.stroke}
                stroke="#fff"
                strokeWidth={2.5}
                paintOrder="stroke"
              >
                −{m.damage}
              </text>
            )}
            <title>{style.label}</title>
          </g>
        );
      })}
      {units.map((u) => (
        <UnitToken
          key={u.instanceId}
          unit={u}
          cellSize={CELL_SIZE}
          at={u.position ? view(u.position) : undefined}
          selected={u.instanceId === selectedUnitId}
          bonusDamage={flankTargets.get(u.instanceId)}
          onClick={onUnitClick ? () => onUnitClick(u.instanceId) : undefined}
        />
      ))}
      {previewMoves.map(({ unit, to }) => (
        <UnitToken key={`preview-${unit.instanceId}`} unit={unit} cellSize={CELL_SIZE} ghost at={view(to)} />
      ))}
      {/**
       * **격추 연출.** 죽은 기물은 그 자리에서 사라진다(position이 null이 되므로 토큰이 아예 안
       * 그려진다). 그래서 이 게임에서 가장 중요한 사건이 화면에서는 「방금까지 있던 것이 없다」는
       * 부재로만 나타났다 — 눈은 없어진 것을 못 본다. 사라진 자리에 터지는 고리와 흩어지는 파편을
       * 남겨, 없어졌다는 사실 자체가 **한 번 일어나는 사건**으로 보이게 한다.
       *
       * 색은 죽은 기물 소유자의 색이다. 남의 것이 죽었는지 내 것이 죽었는지를 배지 글자를 읽기
       * 전에 알아야 하고, 그 판단은 재생 중에 가장 급하다.
       */}
      {marks
        .filter((m) => m.kind === 'death')
        .map((mark) => {
          const dead = mark.unitId ? units.find((u) => u.instanceId === mark.unitId) : undefined;
          const color = dead ? (dead.owner === 'p1' ? '#2563eb' : '#dc2626') : MARK_STYLE.death.fill;
          const cx = px(mark.position.x) + CELL_SIZE / 2;
          const cy = py(mark.position.y) + CELL_SIZE / 2;
          const r = CELL_SIZE * 0.32;
          return (
            <g key={`burst-${mark.key}`} transform={`translate(${cx}, ${cy})`} pointerEvents="none">
              <g className="death-ring">
                <circle cx={0} cy={0} r={r} fill="none" stroke={color} strokeWidth={2.5} />
              </g>
              <g className="death-shards">
                {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
                  const rad = (deg * Math.PI) / 180;
                  return (
                    <line
                      key={deg}
                      x1={Math.cos(rad) * r * 0.5}
                      y1={Math.sin(rad) * r * 0.5}
                      x2={Math.cos(rad) * r * 1.05}
                      y2={Math.sin(rad) * r * 1.05}
                      stroke={color}
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  );
                })}
              </g>
            </g>
          );
        })}
      {/* 해결 재생 표시(-8 / +3 / 빗나감 / 막힘). 기물 **위**에 그린다 — 가려지면 없는 것과 같다. */}
      {marks.map((mark) => {
        const style = MARK_STYLE[mark.kind];
        const cx = px(mark.position.x) + CELL_SIZE / 2;
        // 칸 위 가장자리에 붙이되 판 밖으로 나가지 않게 잡아 둔다(맨 윗줄에서 잘려 안 보이는 것을 막는다).
        const top = Math.max(1, py(mark.position.y) - 11);
        const width = Math.max(22, mark.text.length * 8 + 8);
        return (
          <g key={mark.key} className="board-mark" pointerEvents="none">
            <rect x={cx - width / 2} y={top} width={width} height={14} rx={7} fill={style.fill} opacity={0.95} />
            <text x={cx} y={top + 10.5} textAnchor="middle" fontSize={9.5} fontWeight="bold" fill={style.text}>
              {mark.text}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
