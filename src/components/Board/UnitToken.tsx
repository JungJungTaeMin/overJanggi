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
  /**
   * 지금 조준 중인 기물의 패시브가 이 대상에게 얹는 추가 피해. 0이나 undefined면 안 그린다.
   * 값을 받아서 그리기만 한다 — 조건 판정은 engine/flankBonus.ts가 하고 Board가 넘긴다.
   */
  bonusDamage?: number;
}

const OWNER_COLOR: Record<string, string> = { p1: '#2563eb', p2: '#dc2626' };

/** 역할별 실루엣: 탱커=사각, 딜러=삼각, 지원=원. 이모지 대신 순수 SVG 도형으로 구분한다. */
export function UnitToken({ unit, cellSize, selected, onClick, ghost, previewPosition, bonusDamage }: Props) {
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

  /**
   * 한 글자 이름은 **칸 크기에 비례**해야 한다. 예전 라벨(`T1`)은 라틴 문자라 9px 고정으로도
   * 읽혔지만 한글은 같은 크기에서 뭉개진다 — 판 위에서 기물을 가르는 수단이 실루엣 3종과 이
   * 글자뿐이라, 안 읽히면 구별 수단이 통째로 사라진다.
   *
   * `dominantBaseline="central"`을 쓰는 이유: y에 상수를 더해 눈으로 맞추면 글자 크기를 바꿀
   * 때마다 그 상수도 같이 손봐야 한다.
   */
  const labelProps = {
    x: cx,
    // 삼각형(딜러)은 중심 높이에서 폭이 절반뿐이라 글자가 빗변 밖으로 삐져나온다 — 넓은 밑변 쪽으로
    // 조금 내려 찍는다. 사각형·원은 중심이 가장 넓으므로 그대로 둔다.
    y: typeDef.role === 'dealer' && !unit.isTurret ? cy + r * 0.28 : cy,
    textAnchor: 'middle' as const,
    dominantBaseline: 'central' as const,
    fontSize: Math.max(9, cellSize * 0.3),
    fontWeight: 700,
    fill: '#fff',
    pointerEvents: 'none' as const,
  };

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
        <text {...labelProps}>{typeDef.shortLabel}</text>
      </g>
    );
  }

  const activeEffects = unit.statusEffects.map((e) => e.type).join(', ');

  return (
    <g opacity={unit.respawnTurnsRemaining !== null ? 0.4 : 1} onClick={onClick} cursor={onClick ? 'pointer' : 'default'}>
      {selected && <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke="#facc15" strokeWidth={2} />}
      {/* 조준 중인 기물의 패시브가 이 대상에 얹힐 때 — 사거리 안에 여럿이면 어느 쪽이 이득인지
          클릭 전에 보여야 한다. 공격 계열이라 하이라이트(주황)와 같은 색을 쓴다. */}
      {!!bonusDamage && bonusDamage > 0 && (
        <>
          <circle cx={cx} cy={cy} r={r + 3} fill="none" stroke="#ea580c" strokeWidth={2} strokeDasharray="2 2" />
          <text x={cx + r + 2} y={cy - r} fontSize={9} fontWeight="bold" fill="#ea580c" pointerEvents="none">
            +{bonusDamage}
          </text>
        </>
      )}
      {shape}
      <text {...labelProps}>{typeDef.shortLabel}</text>
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
