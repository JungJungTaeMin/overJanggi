import type { ReactNode } from 'react';
import type { Position, UnitInstance } from '../../engine/types';
import { getUnitType } from '../../data/unitTypes';

interface Props {
  unit: UnitInstance;
  cellSize: number;
  selected?: boolean;
  onClick?: () => void;
  /**
   * 공개(해결) 전 "이렇게 움직일 예정" 미리보기 토큰으로 그릴 때 사용.
   * true면 unit.position 대신 previewPosition에 반투명·점선 테두리로 그리며 클릭/HP바/상태뱃지는 생략한다.
   */
  ghost?: boolean;
  previewPosition?: Position;
}

const OWNER_COLOR: Record<string, string> = { p1: '#2563eb', p2: '#dc2626' };

/** 역할별 실루엣: 탱커=사각, 딜러=삼각, 지원=원. 이모지 대신 순수 SVG 도형으로 구분한다. */
export function UnitToken({ unit, cellSize, selected, onClick, ghost, previewPosition }: Props) {
  const position = ghost ? previewPosition : unit.position;
  if (!position) return null;
  const typeDef = getUnitType(unit.typeId);
  const cx = position.x * cellSize + cellSize / 2;
  const cy = position.y * cellSize + cellSize / 2;
  const color = OWNER_COLOR[unit.owner];
  const r = cellSize * 0.32;
  const hpRatio = unit.maxHp > 0 ? Math.max(0, unit.currentHp / unit.maxHp) : 0;
  const shieldRatio = unit.maxHp > 0 ? Math.min(1, unit.shieldHp / unit.maxHp) : 0;
  const strokeDasharray = ghost ? '3 2' : undefined;

  let shape: ReactNode;
  if (unit.isTurret) {
    shape = (
      <rect
        x={cx - r * 0.6}
        y={cy - r * 0.6}
        width={r * 1.2}
        height={r * 1.2}
        fill={color}
        opacity={0.6}
        stroke="#111"
        strokeWidth={1}
        strokeDasharray={strokeDasharray}
      />
    );
  } else if (typeDef.role === 'tank') {
    shape = <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} fill={color} stroke="#111" strokeWidth={1.5} strokeDasharray={strokeDasharray} />;
  } else if (typeDef.role === 'dealer') {
    const pts = `${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}`;
    shape = <polygon points={pts} fill={color} stroke="#111" strokeWidth={1.5} strokeDasharray={strokeDasharray} />;
  } else {
    shape = <circle cx={cx} cy={cy} r={r} fill={color} stroke="#111" strokeWidth={1.5} strokeDasharray={strokeDasharray} />;
  }

  if (ghost) {
    return (
      <g opacity={0.45} pointerEvents="none">
        {shape}
        <text x={cx} y={cy + 3} textAnchor="middle" fontSize={9} fill="#fff" pointerEvents="none">
          {typeDef.id.replace(/[a-z]+/, (m) => m[0].toUpperCase())}
        </text>
      </g>
    );
  }

  const activeEffects = unit.statusEffects.map((e) => e.type).join(', ');

  return (
    <g opacity={unit.respawnTurnsRemaining !== null ? 0.4 : 1} onClick={onClick} cursor={onClick ? 'pointer' : 'default'}>
      {selected && <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke="#facc15" strokeWidth={2} />}
      {shape}
      <text x={cx} y={cy + 3} textAnchor="middle" fontSize={9} fill="#fff" pointerEvents="none">
        {typeDef.id.replace(/[a-z]+/, (m) => m[0].toUpperCase())}
      </text>
      {!unit.isTurret && (
        <>
          <rect x={cx - r} y={cy + r + 2} width={r * 2} height={3} fill="#333" />
          <rect x={cx - r} y={cy + r + 2} width={r * 2 * hpRatio} height={3} fill={hpRatio > 0.3 ? '#22c55e' : '#ef4444'} />
          {unit.shieldHp > 0 && (
            <>
              {/* 보호막 체력(8장): 최대체력에 포함되지 않는 별도 체력 — HP바 바로 위에 하늘색 바로 표시 */}
              <rect x={cx - r} y={cy + r - 2} width={r * 2} height={2} fill="#0c4a6e" opacity={0.5} />
              <rect x={cx - r} y={cy + r - 2} width={r * 2 * shieldRatio} height={2} fill="#38bdf8" />
            </>
          )}
        </>
      )}
      {(activeEffects || unit.shieldHp > 0) && (
        <title>
          {typeDef.name} — HP {unit.currentHp}/{unit.maxHp}
          {unit.shieldHp > 0 ? ` — 보호막 ${unit.shieldHp}` : ''}
          {activeEffects ? ` — ${activeEffects}` : ''}
        </title>
      )}
    </g>
  );
}
