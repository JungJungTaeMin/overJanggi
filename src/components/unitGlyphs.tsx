import type { ReactNode } from 'react';
import { getUnitType } from '../data/unitTypes';
import type { Role } from '../engine/types';

/**
 * 판 위 기물을 **읽지 않고 알아보게** 하는 그림기호의 유일한 출처.
 *
 * 왜 필요한가는 재 보고 알았다. 판이 13열이고 화면에 맞춰 줄어들면 한 칸은 32px 남짓이고, 그
 * 안의 토큰은 지름 21px, 거기 찍히던 한글 한 글자는 **화면에서 9.7px**이었다(cellSize 42 ×
 * 0.3 = 12.6 뷰박스 단위 × 0.771 축소). 9.7px짜리 한글은 글자가 아니라 얼룩이다. 즉 그동안
 * 기물을 가르는 수단은 사실상 실루엣 3종(사각·삼각·원)뿐이었고, 12종이 세 무리로만 보였다.
 *
 * 그래서 글자를 키우는 대신 **글자를 버렸다.** 대신 각 기물이 판에서 실제로 하는 일을 1~2획짜리
 * 그림으로 그린다 — 미는 기물은 화살표가 바깥으로, 끌어오는 기물은 안으로, 벽 기물은 가로줄,
 * 회복 기물은 십자. 읽는 것보다 보는 것이 빠르다.
 *
 * **핵심 제약: 기호는 같은 역할 안에서만 서로 달라도 된다.** 역할은 이미 실루엣이 가르고 있어서
 * (탱커=사각, 딜러=삼각, 지원=원) 18종을 전부 다르게 그릴 필요가 없다. 6종씩 세 벌이면 되고,
 * 6종은 12px에서도 「덩어리가 어디 몰려 있는가」만으로 구별된다 — 그래서 한 무리 안에서는
 * 가운데 뭉침 / 가장자리 뭉침 / 가로 / 세로 / 대각 / 굽음 / 테두리로 질량 분포를 흩어 놓았다.
 *
 * **여기서 실수하는 방식은 한 가지뿐이다: 두 기호를 같은 축에 놓는 것.** 그리고 그 실수는 크게
 * 그려 놓고 보면 안 보인다 — 96px에서 넉넉히 갈리는 두 그림이 12px에서는 같은 그림이 된다.
 * 획 사이의 빈틈이 1px 밑으로 내려가면 그냥 뭉치기 때문이고, 그래서 「점선 대 실선」처럼
 * **빈틈에 기대는 구별은 12px에서 제일 먼저 사라진다.**
 *
 * 눈으로 크게 보고 판단하지 말고 재라. 배지를 12×12로 래스터화해 같은 역할끼리 픽셀 차이를
 * 내는 일은 `src/test/ui/unitGlyphDistinct.test.ts`가 자동으로 한다 — 겹치는 쌍이 있으면
 * 이름과 함께 두 기물의 12px 그림을 그려서 보여 준다. 실제로 이 방법으로 두 건이 걸렸고 둘 다
 * 아래 주석에 적어 뒀다(탱커의 갈고리·견인형, 딜러의 장거리 화력형).
 *
 * **다만 그 테스트는 바닥선이지 증명이 아니다.** 픽셀 차이는 「질량이 같은 축에 몰린」 충돌은
 * 잡아도 「사람이 보기에 같은 모양」은 못 잡는다 — 나비넥타이와 ✕가 그랬다. 새 기호를 그렸으면
 * 테스트가 초록불이어도 12px로 줄여 나머지 다섯과 나란히 놓고 눈으로 봐야 한다.
 *
 * 좌표계는 -1..1 정규화 상자다. 쓰는 쪽이 `scale()`로 키우므로 선 굵기도 같이 커진다 —
 * 판 위 21px 토큰과 편성 화면 18px 배지가 **같은 그림**이 되는 것이 이 파일의 목적이므로,
 * 크기별로 따로 그린 그림을 두지 않는다.
 */

/** 정규화 상자 기준 선 굵기. 12px까지 줄어들어도 획이 살아남는 하한이 이 근처다. */
const STROKE = 0.28;

/**
 * 기물별 그림기호. 키는 `UnitTypeDef.id`이고, **빠지면 테스트가 잡는다**
 * (`src/test/ui/unitGlyphCoverage.test.ts`) — 새 기물을 넣고 여기를 안 채우면 판 위에서 그
 * 기물만 민무늬 도형이 되는데, 민무늬는 「기호가 없다」가 아니라 「기호가 있는데 안 보인다」로
 * 읽혀서 눈으로는 알아채기 어렵다.
 */
const GLYPH: Record<string, ReactNode> = {
  // ─── 탱커(사각) ─────────────────────────────────────────────────────────
  /** 방어 강화형 — 껍질을 한 겹 더 두른다. 질량이 테두리에 있다. */
  tank1: <rect x={-0.66} y={-0.66} width={1.32} height={1.32} rx={0.2} />,
  /** 돌진·기동형 — 앞으로 뻗는 화살 하나. 세로. */
  tank2: (
    <>
      <line x1={0} y1={0.8} x2={0} y2={-0.5} />
      <polyline points="-0.55,-0.1 0,-0.72 0.55,-0.1" />
    </>
  ),
  /** 방벽·제어형 — 가로로 누운 벽 두 줄. */
  tank3: (
    <>
      <line x1={-0.8} y1={-0.36} x2={0.8} y2={-0.36} />
      <line x1={-0.8} y1={0.36} x2={0.8} y2={0.36} />
    </>
  ),
  /** 밀어내기·제어형 — 화살촉이 **바깥으로**. 가운데가 비어 보인다. */
  tank4: (
    <>
      <polyline points="-0.15,-0.62 -0.75,0 -0.15,0.62" />
      <polyline points="0.15,-0.62 0.75,0 0.15,0.62" />
    </>
  ),
  /**
   * 갈고리·견인형 — **갈고리를 그대로 그린다.** 이름 그대로 자루 하나에 아래에서 걸리는 굽음 하나.
   *
   * 처음에는 밀어내기(tank4)의 화살촉을 안으로 뒤집어 「밀기↔당기기」 짝으로 그렸다. 종이 위에서는
   * 우아했지만 판에서는 못 쓴다 — 화살촉 두 개의 꼭짓점이 가운데(±0.15)에서 만나면 나비넥타이,
   * 즉 **✕가 된다.** 그런데 바로 옆 반격형(tank6)이 진짜 ✕다. 96px으로 키워 놓고 보면 둘이
   * 겨우 갈리고, 정작 써야 하는 12px에서는 같은 그림이다. 짝으로 읽히는 우아함은 두 기물이
   * 서로 구별될 때만 값이 있다.
   */
  tank5: <path d="M0.34,-0.8 L0.34,0.05 A0.43,0.43 0 0 1 -0.52,0.05" />,
  /** 반격형 — 되돌려 주는 엇갈림. 유일하게 대각으로 뻗는 탱커 기호다. */
  tank6: (
    <>
      <line x1={-0.66} y1={-0.66} x2={0.66} y2={0.66} />
      <line x1={0.66} y1={-0.66} x2={-0.66} y2={0.66} />
    </>
  ),

  // ─── 딜러(삼각) ─────────────────────────────────────────────────────────
  // 삼각형은 아래로 갈수록 넓어지므로 기호를 조금 내려 찍고 작게 그린다(unitGlyphPlacement).
  /**
   * 장거리 화력형 — 멀리 날아가는 세 발. **세로로** 세운다.
   *
   * 원래는 가로로 띄엄띄엄 찍은 점선이었고, 관통 사격형(dealer5)의 실선 한 줄과 「점선↔실선」으로
   * 갈리게 해 뒀다. 12px로 줄여서 재 보니 그 구별이 통째로 사라진다 — 삼각형 안에 들어가는
   * 기호는 6×5px 남짓이라 점 세 개 사이의 빈틈이 1px도 안 되고, 결국 **가로 막대 하나로 뭉친다.**
   * 관통형도 가로 막대다. 실제로 두 기물의 12px 픽셀 차이가 딜러 15쌍 중 가장 작았다(4.1 —
   * 그다음이 6.9다).
   *
   * 그래서 점은 그대로 두고 **축만 세로로 돌렸다.** 딜러 6종에서 세로는 비어 있던 축이라,
   * 뭉쳐서 세로 막대가 되더라도 가로 막대(관통형)와는 겹칠 수가 없다. 판에서 적은 위아래에
   * 있으니 「멀리 날아간다」를 세로로 읽는 쪽이 뜻에도 맞다.
   */
  dealer1: (
    <>
      <circle cx={0} cy={-0.68} r={0.19} fill="currentColor" />
      <circle cx={0} cy={0} r={0.19} fill="currentColor" />
      <circle cx={0} cy={0.68} r={0.19} fill="currentColor" />
    </>
  ),
  /** 시간 역행형 — 되감기는 고리. 한 곳이 끊겨 있어 「원」이 아니라 「회전」으로 읽힌다. */
  dealer2: (
    <>
      <path d="M0.72,0.18 A0.74,0.74 0 1 0 0.28,-0.68" />
      <polyline points="-0.05,-0.78 0.36,-0.72 0.3,-0.28" />
    </>
  ),
  /** 충전 사격형 — 조준경. 가운데에 질량이 몰린다. */
  dealer3: (
    <>
      <circle cx={0} cy={0} r={0.74} />
      <circle cx={0} cy={0} r={0.16} fill="currentColor" />
    </>
  ),
  /** 측면 교란형 — 옆에서 비껴 들어오는 대각 화살. */
  dealer4: (
    <>
      <line x1={-0.72} y1={0.72} x2={0.66} y2={-0.66} />
      <polyline points="0.06,-0.72 0.74,-0.74 0.72,-0.06" />
    </>
  ),
  /** 관통 사격형 — 끝까지 뚫고 나가는 한 줄. 딜러 중 유일하게 가로로 눕는 기호다. */
  dealer5: (
    <>
      <line x1={-0.85} y1={0} x2={0.45} y2={0} />
      <polyline points="0.2,-0.5 0.82,0 0.2,0.5" />
    </>
  ),
  /** 화염 사격형 — 남아서 타는 불꽃. 유일하게 속이 찬 딜러 기호다. */
  dealer6: <path d="M0,-0.85 C0.6,-0.2 0.78,0.28 0.36,0.62 C0.14,0.8 -0.14,0.8 -0.36,0.62 C-0.78,0.28 -0.6,-0.2 0,-0.85 Z" fill="currentColor" />,

  // ─── 지원(원) ───────────────────────────────────────────────────────────
  /** 범위 회복형 — 십자에 범위를 두른다. */
  support1: (
    <>
      <circle cx={0} cy={0} r={0.85} />
      <line x1={0} y1={-0.46} x2={0} y2={0.46} />
      <line x1={-0.46} y1={0} x2={0.46} y2={0} />
    </>
  ),
  /** 장거리 회복·구속형 — 테두리 없는 맨 십자. 범위형과 「둘렀나 아닌가」로만 갈린다. */
  support2: (
    <>
      <line x1={0} y1={-0.82} x2={0} y2={0.82} />
      <line x1={-0.82} y1={0} x2={0.82} y2={0} />
    </>
  ),
  /** 확률·포탑형 — 반쪽만 채워진 동전. */
  support3: (
    <>
      <circle cx={0} cy={0} r={0.76} />
      <path d="M0,-0.76 A0.76,0.76 0 0 1 0,0.76 Z" fill="currentColor" />
    </>
  ),
  /** 러너 — 속도선 두 겹. */
  support4: (
    <>
      <polyline points="-0.72,-0.62 -0.08,0 -0.72,0.62" />
      <polyline points="0.08,-0.62 0.72,0 0.08,0.62" />
    </>
  ),
  /** 전송형 — 멀리 있는 아군(점)을 당겨 온다. */
  support5: (
    <>
      <circle cx={0.5} cy={0} r={0.24} />
      <line x1={-0.85} y1={0} x2={-0.05} y2={0} />
      <polyline points="-0.34,-0.4 0.06,0 -0.34,0.4" />
    </>
  ),
  /** 표식형 — 적에게 찍는 표적. */
  support6: (
    <>
      <polygon points="0,-0.82 0.82,0 0,0.82 -0.82,0" />
      <circle cx={0} cy={0} r={0.17} fill="currentColor" />
    </>
  ),

  /** 포탑 — 판에서 가장 작은 토큰이라 획이 둘을 넘으면 뭉갠다. */
  turret: (
    <>
      <line x1={0} y1={-0.75} x2={0} y2={0.75} />
      <line x1={-0.75} y1={0} x2={0.75} y2={0} />
    </>
  ),
};

export function hasUnitGlyph(typeId: string): boolean {
  return typeId in GLYPH;
}

/**
 * 실루엣 안에 기호가 놓이는 자리. **삼각형만 예외**라서 이 규칙이 필요하다 — 딜러 실루엣은
 * 가운데 높이에서 폭이 절반뿐이라, 사각·원과 같은 크기로 찍으면 기호가 빗변 밖으로 새어 나간다.
 * 예전 한 글자 라벨도 같은 이유로 딜러만 아래로 내려 찍고 있었다.
 */
export function unitGlyphPlacement(role: Role, r: number): { scale: number; dy: number } {
  if (role === 'dealer') return { scale: r * 0.5, dy: r * 0.3 };
  return { scale: r * 0.62, dy: 0 };
}

/**
 * 판 위 토큰 안에 얹는 기호. 원점 기준으로 그리므로 부르는 쪽이 이미 칸으로 옮겨 놓은
 * 좌표계 안에서 그대로 쓰면 된다.
 */
export function UnitGlyph({ typeId, scale, dy = 0, color }: { typeId: string; scale: number; dy?: number; color: string }) {
  const glyph = GLYPH[typeId];
  if (!glyph) return null;
  return (
    <g
      transform={`translate(0, ${dy}) scale(${scale})`}
      stroke={color}
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      /* 기본은 선으로만 그린다. 속을 채워야 하는 획만 `fill="currentColor"`를 달아 두는데,
         그러면 「어느 기물이 채움인가」라는 목록을 따로 들고 다니지 않아도 된다 — 예전에는
         그 목록에 충전 사격형(◎)이 잘못 들어가 조준경 바깥 고리까지 통째로 메워져 검은
         덩어리가 됐고, 그림 정의만 봐서는 원인을 찾을 수 없었다. */
      color={color}
      fill="none"
      pointerEvents="none"
    >
      {glyph}
    </g>
  );
}

/** 역할 실루엣 하나. 판 토큰과 목록 배지가 **같은 도형**을 쓰도록 여기서만 그린다. */
function RoleSilhouette({ role, r, fill, stroke, strokeWidth }: { role: Role; r: number; fill: string; stroke: string; strokeWidth: number }) {
  if (role === 'tank') return <rect x={-r} y={-r} width={r * 2} height={r * 2} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  if (role === 'dealer') return <polygon points={`0,${-r} ${r},${r} ${-r},${r}`} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  return <circle cx={0} cy={0} r={r} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
}

/**
 * **목록용 기물 배지.** 편성·계획 패널이 쓰던 `.unit-role-dot`(역할만 알려 주는 회색 도형)을
 * 대신한다. 판 위에서 본 그림과 글자 그대로 같은 것이 목록에도 있어야, 드래프트에서 고른 기물이
 * 판 위 어느 말인지 이어진다 — 그 연결이 없으면 이름을 외우는 수밖에 없다.
 */
export function UnitMark({ typeId, size = 18, tone = 'muted' }: { typeId: string; size?: number; tone?: 'muted' | 'p1' | 'p2' }) {
  const typeDef = getUnitType(typeId);
  const r = 0.86;
  const { scale, dy } = unitGlyphPlacement(typeDef.role, r);
  const fill = tone === 'muted' ? 'currentColor' : `var(--${tone})`;
  return (
    <svg className="unit-mark" width={size} height={size} viewBox="-1 -1 2 2" aria-hidden focusable="false">
      <RoleSilhouette role={typeDef.role} r={r} fill={fill} stroke="none" strokeWidth={0} />
      {/* 배지는 바탕이 팀색이든 회색이든 **어두운 획**으로 파낸다 — 판 위 토큰과 같은 처리다. */}
      <UnitGlyph typeId={typeId} scale={scale} dy={dy} color="#05080f" />
    </svg>
  );
}
