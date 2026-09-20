import type { ReactNode } from 'react';
import type { Position, UnitInstance } from '../../engine/types';
import { getUnitType } from '../../data/unitTypes';
import { statusLabel } from '../effectLabels';
import { UnitGlyph, unitGlyphPlacement } from '../unitGlyphs';

interface Props {
  unit: UnitInstance;
  cellSize: number;
  selected?: boolean;
  onClick?: () => void;
  /**
   * 공개(해결) 전 "이렇게 움직일 예정" 미리보기 토큰으로 그릴 때 사용.
   * 반투명·점선 테두리로 그리며 클릭/HP바/상태뱃지는 생략한다.
   */
  ghost?: boolean;
  /**
   * **그릴 칸.** 엔진 좌표가 아니라 Board가 시점 변환(orientation.ts)을 마친 화면 좌표다 —
   * 판을 뒤집어 보는 쪽에서는 `unit.position`과 다르다. 미리보기 토큰은 도착 예정 칸이 온다.
   * Board는 언제나 이 값을 넘기고, 생략되면 좌표 그대로 그린다.
   */
  at?: Position;
  /**
   * 지금 조준 중인 기물의 패시브가 이 대상에게 얹는 추가 피해. 0이나 undefined면 안 그린다.
   * 값을 받아서 그리기만 한다 — 조건 판정은 engine/flankBonus.ts가 하고 Board가 넘긴다.
   */
  bonusDamage?: number;
}

/**
 * 팀색. 어두운 판으로 바꾸면서 **밝기를 올렸다** — 예전 값(#2563eb / #dc2626)은 밝은 종이
 * 위에서 진하게 보이라고 고른 색이라, 어두운 바닥에 얹으면 둘 다 탁해져 파랑과 빨강의 거리가
 * 좁아진다. 판에서 가장 먼저 갈라져야 하는 것이 **누구 편인가**이므로 여기만은 확실히 밝게 둔다.
 * CSS 토큰(--p1/--p2)과 같은 값이어야 계획 패널·점수판의 팀색과 판 위 기물이 같은 팀으로 읽힌다.
 */
export const OWNER_COLOR: Record<string, string> = { p1: '#5b9cff', p2: '#ff6b6b' };
/** 실루엣 테두리. 바닥보다 어두운 색이라 어떤 지형 위에 서도 기물 윤곽이 바닥에서 떨어진다. */
const OUTLINE = '#05080f';

/** 역할별 실루엣: 탱커=사각, 딜러=삼각, 지원=원. 이모지 대신 순수 SVG 도형으로 구분한다. */
export function UnitToken({ unit, cellSize, selected, onClick, ghost, at, bonusDamage }: Props) {
  const position = at ?? unit.position;
  if (!position) return null;
  const typeDef = getUnitType(unit.typeId);
  /**
   * **칸으로 가는 이동은 그룹 transform이 맡고, 안쪽 도형은 원점에 그린다.**
   *
   * 예전에는 도형·글자·체력바가 저마다 절대 좌표를 들고 있었다. 그래서 기물이 칸을 옮기면 화면이
   * 순간이동했고, 특히 해결을 단계별로 재생하는 지금은 「1. 이동」이 **움직임이 아니라 점프 컷**으로
   * 보였다 — 한 단계를 통째로 이동에 쓰면서 정작 이동은 안 보이는 셈이었다.
   *
   * 위치를 transform 한 곳으로 모으면 CSS transition 한 줄로 기물이 미끄러진다. 좌표 계산은
   * 그대로라 판을 뒤집어 보는 쪽(orientation.ts)도 영향이 없다.
   */
  const tx = position.x * cellSize + cellSize / 2;
  const ty = position.y * cellSize + cellSize / 2;
  const cx = 0;
  const cy = 0;
  const color = OWNER_COLOR[unit.owner];
  /**
   * 0.32 → 0.38. 기호를 넣으려면 그릴 자리가 필요한데, 13열 판이 화면에 맞춰 줄면 한 칸이 32px라
   * 0.32에서는 토큰 지름이 21px, 그 안 기호는 12px 남짓이라 획이 서로 붙었다. 0.38이면 지름
   * 25px·기호 15px이 되고, 칸 사이에는 여전히 0.24칸(약 8px)의 틈이 남아 인접한 두 기물이
   * 한 덩어리로 뭉쳐 보이지 않는다.
   */
  const r = cellSize * 0.38;
  const hpRatio = unit.maxHp > 0 ? Math.max(0, unit.currentHp / unit.maxHp) : 0;
  const shieldRatio = unit.maxHp > 0 ? Math.min(1, unit.shieldHp / unit.maxHp) : 0;
  const strokeDasharray = ghost ? '3 2' : undefined;

  /**
   * **한 글자 이름 대신 그림기호.** 예전에는 여기 `typeDef.shortLabel`(방·돌·벽…)을 찍었는데,
   * 화면에서 재 보니 9.7px이었다 — 한글 한 글자가 그 크기면 획이 서로 붙어 얼룩이 된다. 즉
   * 기물을 가르는 수단이 사실상 실루엣 3종뿐이었고, 12종이 세 무리로만 보였다.
   *
   * 기호는 `components/unitGlyphs.tsx` 한 곳에만 있고 편성·계획 목록의 배지도 같은 것을 쓴다.
   * 판에서 본 그림이 목록에도 그대로 있어야 드래프트에서 고른 기물과 판 위의 말이 이어진다.
   *
   * 포탑은 토큰 자체가 다른 것들의 60% 크기라 기호도 그만큼 줄인다.
   */
  const glyphR = unit.isTurret ? r * 0.6 : r;
  const glyph = unitGlyphPlacement(unit.isTurret ? 'support' : typeDef.role, glyphR);

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
        stroke={OUTLINE}
        strokeWidth={1}
        strokeDasharray={strokeDasharray}
      />
    );
  } else if (typeDef.role === 'tank') {
    shape = <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} fill={color} stroke={OUTLINE} strokeWidth={1.5} strokeDasharray={strokeDasharray} />;
  } else if (typeDef.role === 'dealer') {
    const pts = `${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}`;
    shape = <polygon points={pts} fill={color} stroke={OUTLINE} strokeWidth={1.5} strokeDasharray={strokeDasharray} />;
  } else {
    shape = <circle cx={cx} cy={cy} r={r} fill={color} stroke={OUTLINE} strokeWidth={1.5} strokeDasharray={strokeDasharray} />;
  }

  if (ghost) {
    return (
      <g className="unit-token" transform={`translate(${tx}, ${ty})`} opacity={0.45} pointerEvents="none">
        {shape}
        <UnitGlyph typeId={unit.typeId} scale={glyph.scale} dy={glyph.dy} color={OUTLINE} />
      </g>
    );
  }

  // 동전(coinHeads/coinTails)은 **지난 턴** 결과라 이번 턴 상태로 읽히면 안 된다 — UnitStatusList.tsx.
  // 이름은 반드시 한글 라벨로 옮긴다: 툴팁만 `veil`이라고 뜨면 계획 패널의 「차단막」 배지와
  // 같은 것인 줄 알 수가 없다.
  const activeEffects = unit.statusEffects
    .map((e) => e.type)
    .filter((t) => t !== 'coinHeads' && t !== 'coinTails')
    .map(statusLabel)
    .join(', ');

  return (
    <g
      className="unit-token"
      transform={`translate(${tx}, ${ty})`}
      opacity={unit.respawnTurnsRemaining !== null ? 0.4 : 1}
      onClick={onClick}
      cursor={onClick ? 'pointer' : 'default'}
    >
      {/* 선택 고리는 **두 겹**이다. 노란 고리 하나만 그리면 점령지(따뜻한 황토색) 위에 선 기물은
          고리와 바닥의 색이 붙어 선택된 티가 안 난다. 안쪽에 어두운 고리를 한 겹 깔아 어떤
          지형 위에서도 노란 선이 바닥에서 떨어지게 한다. */}
      {selected && (
        <>
          <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke={OUTLINE} strokeWidth={4} opacity={0.7} />
          <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke="#facc15" strokeWidth={2} />
        </>
      )}
      {/* 조준 중인 기물의 패시브가 이 대상에 얹힐 때 — 사거리 안에 여럿이면 어느 쪽이 이득인지
          클릭 전에 보여야 한다. 공격 계열이라 하이라이트(주황)와 같은 색을 쓴다. */}
      {!!bonusDamage && bonusDamage > 0 && (
        <>
          <circle cx={cx} cy={cy} r={r + 3} fill="none" stroke="#fb923c" strokeWidth={2} strokeDasharray="2 2" />
          <text x={cx + r + 2} y={cy - r} fontSize={9} fontWeight="bold" fill="#fb923c" pointerEvents="none">
            +{bonusDamage}
          </text>
        </>
      )}
      {/* 그림자 한 겹. 기물이 **바닥에 그려진 무늬**가 아니라 바닥 위에 놓인 말로 보이게 하는
          가장 싼 방법이다 — 어두운 판에서는 윤곽선만으로는 기물과 지형이 같은 평면에 눌린다.
          필터 정의는 Board.tsx의 <defs>에 한 번만 있다. */}
      <g filter="url(#token-lift)">{shape}</g>
      <UnitGlyph typeId={unit.typeId} scale={glyph.scale} dy={glyph.dy} color={OUTLINE} />
      {!unit.isTurret && (
        <>
          {/* 체력바 바탕은 판에서 **가장 어두운 값**을 쓴다. 회색(#333)이면 벽(거의 검정) 앞에서는
              바탕이 도리어 밝아 체력이 가득 찬 것처럼 보였다 — 줄어든 만큼이 눈에 띄어야 한다. */}
          <rect x={cx - r} y={cy + r + 2} width={r * 2} height={3} rx={1.5} fill={OUTLINE} opacity={0.85} />
          <rect
            x={cx - r}
            y={cy + r + 2}
            width={r * 2 * hpRatio}
            height={3}
            rx={1.5}
            fill={hpRatio > 0.3 ? '#4ade80' : '#f87171'}
          />
          {unit.shieldHp > 0 && (
            <>
              {/* 보호막 체력(8장): 최대체력에 포함되지 않는 별도 체력 — HP바 바로 위에 하늘색 바로 표시 */}
              <rect x={cx - r} y={cy + r - 2} width={r * 2} height={2} fill="#0c4a6e" opacity={0.5} />
              <rect x={cx - r} y={cy + r - 2} width={r * 2 * shieldRatio} height={2} fill="#38bdf8" />
            </>
          )}
        </>
      )}
      {/* 예전에는 상태이상이 붙었을 때만 이름표를 달았다. 토큰에서 한 글자 이름을 걷어낸 지금은
          **언제나** 달아야 한다 — 기호를 아직 못 외운 사람에게 이름으로 돌아갈 길이 여기뿐이다. */}
      <title>
        {typeDef.name} — HP {unit.currentHp}/{unit.maxHp}
        {unit.shieldHp > 0 ? ` — 보호막 ${unit.shieldHp}` : ''}
        {activeEffects ? ` — ${activeEffects}` : ''}
      </title>
    </g>
  );
}
