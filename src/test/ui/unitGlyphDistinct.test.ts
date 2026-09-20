import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Resvg } from '@resvg/resvg-js';
import { unitTypes } from '../../data/unitTypes';
import { UnitMark } from '../../components/unitGlyphs';

/**
 * **12px에서 두 기물이 같은 그림이 되지 않는지.**
 *
 * unitGlyphCoverage는 「기호가 있는가」를 본다. 있는데도 옆 기물과 구별이 안 되면 그 테스트는
 * 통과하고 판 위에서는 여전히 두 기물을 못 가른다. 실제로 그렇게 두 번 새어 나갔다:
 *
 *   - 탱커 5(갈고리·견인형)를 화살촉 두 개가 가운데서 만나게 그렸더니 나비넥타이, 즉 ✕가 됐다.
 *     바로 옆 탱커 6(반격형)이 진짜 ✕다.
 *   - 딜러 1(장거리 화력형)의 가로 점선이 12px에서 점 사이 빈틈을 잃고 가로 막대로 뭉쳤다.
 *     딜러 5(관통 사격형)도 가로 막대다.
 *
 * 둘 다 **크게 그려 놓고 보면 멀쩡했다.** 96px에서 넉넉히 갈리는 두 그림이 12px에서 같아지는 게
 * 이 파일이 막으려는 사고다. 그래서 눈이 아니라 픽셀로 잰다 — 배지를 12×12로 실제 래스터화해서
 * 같은 역할끼리 밝기 차를 낸다(역할이 다르면 실루엣이 사각/삼각/원으로 이미 가르므로 뺀다).
 *
 * **이 테스트가 못 잡는 것도 분명히 해 둔다.** 위 두 사고를 이 지표로 재면 각각 7.91과 3.45다.
 * 딜러 쪽(질량이 같은 축에 몰린 경우)은 현재 최소값 5.62보다 한참 아래라 걸리지만, 탱커 쪽은
 * 오히려 위로 나온다 — 나비넥타이와 ✕는 「사람이 보기에 같은 모양」이지 「픽셀이 같은 그림」이
 * 아니기 때문이다. 블러를 먹여 사람 눈에 가깝게 만들어 봐도 정상 쌍과 안 갈린다(여유배율 1.02).
 * 그러니 이건 **바닥선이지 증명이 아니다.** 기호를 새로 그렸으면 이 테스트를 통과하더라도
 * 12px로 줄여서 같은 무리의 나머지 다섯과 나란히 눈으로 봐야 한다.
 */

const PX = 12;

/** 배지 SVG를 12×12로 굽고 픽셀마다 밝기(흰 바탕에 합성)를 낸다. */
function luminance(svg: string): number[] {
  const raw = new Uint8Array(new Resvg(svg, { fitTo: { mode: 'width', value: PX } }).render().pixels);
  const out: number[] = [];
  for (let i = 0; i < PX * PX * 4; i += 4) {
    const a = raw[i + 3] / 255;
    out.push((0.299 * raw[i] + 0.587 * raw[i + 1] + 0.114 * raw[i + 2]) * a + 255 * (1 - a));
  }
  return out;
}

/**
 * UnitMark는 실루엣을 `currentColor`로 칠한다 — 페이지에서는 CSS가 색을 넣어 주지만 독립 SVG로
 * 떼어 내면 검정으로 풀려서 **기호까지 통째로 까만 덩어리**가 된다(그러면 모든 쌍의 차이가 0에
 * 수렴해 테스트가 조용히 무의미해진다). 그래서 목록에서 쓰는 실제 색을 박아 준다.
 */
function markLuminance(typeId: string): number[] {
  const markup = renderToStaticMarkup(createElement(UnitMark, { typeId, size: PX }));
  return luminance(markup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" color="#92a3bf" '));
}

function meanAbsDiff(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/** 실패했을 때 「왜」를 눈으로 보여 준다 — 숫자만 던지면 어느 획이 뭉쳤는지 알 수가 없다. */
function asciiArt(px: number[]): string {
  const rows: string[] = [];
  for (let y = 0; y < PX; y++) {
    let row = '';
    for (let x = 0; x < PX; x++) {
      const L = px[y * PX + x];
      row += L > 200 ? '.' : L > 120 ? '+' : L > 60 ? 'o' : '#';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

/**
 * 정상 쌍의 최소값(5.62)과 걸러야 할 옛 딜러 1(3.45) 사이. 양쪽으로 25% 안팎 여유가 있다.
 * **이 숫자를 낮추려거든 아래 카나리아부터 보라** — 낮추는 순간 그게 먼저 깨진다.
 */
const MIN_DIFF = 4.5;

describe('기물 그림기호 — 12px에서 서로 다른 그림이다', () => {
  it('같은 역할 안에서 어떤 두 기물도 12px 픽셀이 겹치지 않는다', () => {
    const marks = unitTypes.map((t) => ({ t, px: markLuminance(t.id) }));

    // 래스터가 살아 있는지 먼저 본다. 전부 까맣거나 전부 비면 아래 비교는 통과하면서 무의미해진다.
    const spread = new Set(marks[0].px.map((v) => Math.round(v / 32)));
    expect(spread.size, '배지가 단색으로 구워졌다 — currentColor가 안 풀렸을 것이다').toBeGreaterThan(1);

    const collisions: string[] = [];
    for (let i = 0; i < marks.length; i++)
      for (let j = i + 1; j < marks.length; j++) {
        if (marks[i].t.role !== marks[j].t.role) continue;
        const d = meanAbsDiff(marks[i].px, marks[j].px);
        if (d >= MIN_DIFF) continue;
        collisions.push(
          `${marks[i].t.name} vs ${marks[j].t.name} — 차이 ${d.toFixed(2)} (최소 ${MIN_DIFF})\n` +
            `${asciiArt(marks[i].px)}\n\n${asciiArt(marks[j].px)}`,
        );
      }

    expect(collisions, `12px에서 구별되지 않는 기물 쌍:\n\n${collisions.join('\n\n')}`).toEqual([]);
  });

  /**
   * 임계값이 실제로 무언가를 막고 있다는 증거. 이게 없으면 MIN_DIFF를 0으로 낮춰도 위 테스트는
   * 초록불이고, 그때부터 이 파일은 통과만 하는 장식이 된다. 그래서 **지금은 코드에 없는 옛 그림**을
   * 손으로 지어 두고, 그게 임계값 아래로 떨어지는지 본다.
   */
  it('옛 딜러 1의 가로 점선은 이 임계값에 걸린다', () => {
    const scale = 0.86 * 0.5;
    const dy = 0.86 * 0.3;
    const oldDots =
      '<circle cx="-0.68" cy="0" r="0.19" fill="currentColor"/>' +
      '<circle cx="0" cy="0" r="0.19" fill="currentColor"/>' +
      '<circle cx="0.68" cy="0" r="0.19" fill="currentColor"/>';
    const oldDealer1 =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${PX}" height="${PX}" viewBox="-1 -1 2 2" color="#92a3bf">` +
      '<polygon points="0,-0.86 0.86,0.86 -0.86,0.86" fill="currentColor"/>' +
      `<g transform="translate(0, ${dy}) scale(${scale})" stroke="#05080f" stroke-width="0.28" ` +
      'stroke-linecap="round" stroke-linejoin="round" color="#05080f" fill="none">' +
      `${oldDots}</g></svg>`;

    const d = meanAbsDiff(luminance(oldDealer1), markLuminance('dealer5'));
    expect(d, `옛 딜러 1 vs 딜러 5 = ${d.toFixed(2)} — 임계값 ${MIN_DIFF}을 넘어 버리면 이 테스트는 아무것도 안 막는다`).toBeLessThan(
      MIN_DIFF,
    );
  });
});
