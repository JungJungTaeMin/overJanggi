/**
 * 두 기물을 **같은 편성에 넣었을 때** 서로의 값어치가 오르는가 — 분석 도구다. 앱 번들에 안 들어간다.
 *
 * 왜 필요한가: `balanceSim.ts`는 기물별 승점률만 뽑는다. 그 숫자는 "이 기물이 평균적으로 얼마나
 * 센가"지 "누구와 함께일 때 세지는가"가 아니다. 편성이 무작위라 짝은 자연히 섞이므로, 같은
 * 판 묶음을 **A와 B가 같은 팀에 다 있는 판 / A만 있는 판**으로 갈라 보면 상호작용이 드러난다.
 *
 * **단순 비교는 교란된다.** "support2가 X와 같이 있을 때 더 이긴다"는 X가 그냥 센 기물이어도
 * 나온다 — 실제로 상위 시너지 자리에 전체 승점 1·2위 기물이 그대로 올라온다. 그래서 이중차분을 쓴다:
 *
 *     시너지 = [X 있을 때 − X 없을 때]_support2 있는 편성  −  [X 있을 때 − X 없을 때]_support2 없는 편성
 *
 * 뒤 항이 "X는 원래 이만큼 세다"를 흡수하므로, 남는 건 **support2와 X 사이의 상호작용**뿐이다.
 *
 * 읽는 법: 0에 가까우면 두 기물은 서로 무관하다는 뜻이고, 그건 "시너지가 없다"가 아니라
 * **"AI가 그 시너지를 쓸 줄 모른다"**일 수도 있다 — 예컨대 AI는 dealer4_swap을 아예 계획하지
 * 않으므로(src/ai에 참조 없음) 자리교체 시너지는 여기 절대 안 잡힌다. 그래서 이 스크립트는
 * 시너지의 **하한**을 재는 도구지 상한을 재는 도구가 아니다.
 *
 * 실행: npx vite-node scripts/pairSynergy.ts [게임수] [난이도]
 */
import { createInitialState } from '../src/engine/createInitialState';
import { resolveTurn } from '../src/engine/resolveTurn';
import { aiActionPlan, aiPlacement } from '../src/ai/aiPlayer';
import { seededRng } from '../src/engine/rng';
import { mapDefinition } from '../src/data/mapDefinitions';
import { unitTypes } from '../src/data/unitTypes';
import { ROSTER_SIZE } from '../src/data/constants';
import type { AiDifficulty } from '../src/ai/difficulty';
import type { Owner } from '../src/engine/types';

const GAMES = Number(process.argv[2] ?? 1000);
const DIFFICULTY = (process.argv[3] ?? 'hard') as AiDifficulty;
const MAX_TURNS = 80;

/** 관심 기물: 이 기물이 있는 편성만 표본으로 쓴다. */
const FOCUS = 'support2';

interface Bucket {
  games: number;
  score: number; // 승 1점, 무 0.5점
}

/** 짝 기물별 2×2 분할표: [support2 유무][짝 유무]. 이중차분의 네 칸이다. */
const cells: Record<'s2' | 'no', { with: Map<string, Bucket>; without: Map<string, Bucket> }> = {
  s2: { with: new Map(), without: new Map() },
  no: { with: new Map(), without: new Map() },
};

const bump = (m: Map<string, Bucket>, key: string, score: number) => {
  const b = m.get(key) ?? { games: 0, score: 0 };
  b.games += 1;
  b.score += score;
  m.set(key, b);
};

const rate = (b: Bucket | undefined) => (b && b.games ? (b.score / b.games) * 100 : 0);

for (let game = 0; game < GAMES; game++) {
  const rng = seededRng(1000 + game);
  const rosters: Record<Owner, string[]> = {
    p1: Array.from({ length: ROSTER_SIZE }, () => unitTypes[Math.floor(rng() * unitTypes.length)].id),
    p2: Array.from({ length: ROSTER_SIZE }, () => unitTypes[Math.floor(rng() * unitTypes.length)].id),
  };
  const state = createInitialState(
    rosters.p1,
    rosters.p2,
    aiPlacement(rosters.p1, 'p1', mapDefinition, rng),
    aiPlacement(rosters.p2, 'p2', mapDefinition, rng),
    mapDefinition,
  );

  for (let turn = 0; turn < MAX_TURNS && state.phase !== 'gameOver'; turn++) {
    resolveTurn(state, aiActionPlan(state, 'p1', DIFFICULTY, rng), aiActionPlan(state, 'p2', DIFFICULTY, rng), rng);
  }
  const winner = state.winner;

  for (const owner of ['p1', 'p2'] as Owner[]) {
    const own = new Set(rosters[owner]);
    const score = winner === owner ? 1 : winner ? 0 : 0.5;
    const row = cells[own.has(FOCUS) ? 's2' : 'no']; // support2 없는 편성도 통제군으로 센다
    for (const t of unitTypes) {
      if (t.id === FOCUS) continue;
      bump(own.has(t.id) ? row.with : row.without, t.id, score);
    }
  }
}

const nameOf = (id: string) => unitTypes.find((t) => t.id === id)!.name.replace(/^.*— /, '');

console.log(`\n=== ${nameOf(FOCUS)} 동반 시너지(이중차분) · ${GAMES}판 · 난이도 ${DIFFICULTY} ===`);
console.log('짝 기물           동반판수  s2편성:짝O  짝X    차이   |  통제군 차이   순시너지');

const rows = unitTypes
  .filter((t) => t.id !== FOCUS)
  .map((t) => {
    const games = cells.s2.with.get(t.id)?.games ?? 0;
    const treated = rate(cells.s2.with.get(t.id)) - rate(cells.s2.without.get(t.id));
    const control = rate(cells.no.with.get(t.id)) - rate(cells.no.without.get(t.id));
    return { id: t.id, games, treated, control, net: treated - control };
  })
  .sort((a, b) => b.net - a.net);

const sign = (v: number) => (v > 0 ? '+' : '') + v.toFixed(1);
for (const r of rows) {
  console.log(
    `${nameOf(r.id).padEnd(16)} ${String(r.games).padStart(6)} ` +
      `${rate(cells.s2.with.get(r.id)).toFixed(1).padStart(9)}% ${rate(cells.s2.without.get(r.id)).toFixed(1).padStart(6)}% ` +
      `${sign(r.treated).padStart(7)}%p  |${sign(r.control).padStart(9)}%p ${sign(r.net).padStart(9)}%p`,
  );
}
console.log();
