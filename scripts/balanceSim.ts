/**
 * 밸런스 측정용 시뮬레이터 — 게임 코드가 아니라 **분석 도구**다. 앱 번들에 포함되지 않는다.
 *
 * 왜 필요한가: 기물 10종의 스탯은 기획서 원문을 그대로 옮긴 값이라 실제로 서로 맞붙었을 때
 * 어떤지 아무도 측정한 적이 없다. 감으로 숫자를 만지면 한 곳을 고치고 다른 곳을 부수기 쉽다.
 * 엔진이 순수 함수라 수천 판을 무료로 돌릴 수 있으므로, 조정 전에 근거를 먼저 만든다.
 *
 * 방법: 양쪽 모두 같은 난이도의 AI가 무작위 5기물 편성으로 붙는다. 편성이 무작위이므로
 * 특정 기물이 "들어간 판의 승률"이 그 기물의 실제 값어치에 대한 추정치가 된다(팀 단위 기여도).
 *
 * 실행: npx vite-node scripts/balanceSim.ts [게임수] [난이도]
 */
import { createInitialState } from '../src/engine/createInitialState';
import { resolveTurn } from '../src/engine/resolveTurn';
import { aiActionPlan, aiPlacement } from '../src/ai/aiPlayer';
import { seededRng } from '../src/engine/rng';
import { mapDefinition } from '../src/data/mapDefinitions';
import { unitTypes } from '../src/data/unitTypes';
import { ROSTER_SIZE, WIN_SCORE } from '../src/data/constants';
import type { AiDifficulty } from '../src/ai/difficulty';
import type { Owner } from '../src/engine/types';

const GAMES = Number(process.argv[2] ?? 300);
const DIFFICULTY = (process.argv[3] ?? 'hard') as AiDifficulty;
/**
 * 판을 끊는 지점. 게임 자체에는 턴 제한이 없으므로(교착 규칙은 기획서 10장 미정) 이건 순전히
 * 측정용 장치다. 여기서 끊긴 판을 무승부로 세는 탓에 상한을 낮게 잡으면 "느린 편성"이 "약한 편성"으로
 * 잘못 보인다 — 그래서 인자로 뺐다.
 */
const MAX_TURNS = Number(process.argv[4] ?? 80);

interface Stat {
  games: number;
  wins: number;
  draws: number;
  damage: number;
  kills: number;
  deaths: number;
  healing: number;
  zoneTurns: number;
}

const stats = new Map<string, Stat>();
const blank = (): Stat => ({ games: 0, wins: 0, draws: 0, damage: 0, kills: 0, deaths: 0, healing: 0, zoneTurns: 0 });
for (const t of unitTypes) stats.set(t.id, blank());

function randomRoster(rng: () => number): string[] {
  return Array.from({ length: ROSTER_SIZE }, () => unitTypes[Math.floor(rng() * unitTypes.length)].id);
}

let p1Wins = 0;
let p2Wins = 0;
let draws = 0;
let totalTurns = 0;
let turretSpawns = 0;
let turretHeal = 0;
const drawScores: number[] = [];

for (let game = 0; game < GAMES; game++) {
  const rng = seededRng(1000 + game);
  const rosters: Record<Owner, string[]> = { p1: randomRoster(rng), p2: randomRoster(rng) };
  const state = createInitialState(
    rosters.p1,
    rosters.p2,
    aiPlacement(rosters.p1, 'p1', mapDefinition, rng),
    aiPlacement(rosters.p2, 'p2', mapDefinition, rng),
    mapDefinition,
  );

  // 한 판 안에서 인스턴스 → 기물 종류를 되짚기 위한 표.
  const typeOf = new Map(state.units.map((u) => [u.instanceId, u.typeId]));
  const perGame = new Map<string, Stat>();
  const bump = (id: string | undefined, f: (s: Stat) => void) => {
    const type = id && typeOf.get(id);
    if (!type) return;
    if (!perGame.has(type)) perGame.set(type, blank());
    f(perGame.get(type)!);
  };

  let turn = 0;
  for (; turn < MAX_TURNS && state.phase !== 'gameOver'; turn++) {
    const log = resolveTurn(state, aiActionPlan(state, 'p1', DIFFICULTY, rng), aiActionPlan(state, 'p2', DIFFICULTY, rng), rng);
    for (const e of log) {
      if (e.type === 'hit' || e.type === 'dashDamage') bump(e.actorId, (s) => (s.damage += Number(e.detail?.damage ?? 0)));
      else if (e.type === 'death') bump(e.actorId, (s) => (s.deaths += 1));
      else if (e.type === 'heal') bump(e.actorId, (s) => (s.healing += Number(e.detail?.amount ?? 0)));
      // 포탑은 판 도중에 생기는 별도 엔티티라 typeOf에 없다. 소환한 support3의 성과이므로 따로 센다.
      else if (e.type === 'turretSpawn') turretSpawns += 1;
      else if (e.type === 'turretAura') turretHeal += Number(e.detail?.amount ?? 0);
    }
    // 점령지 체류는 로그가 아니라 판 상태에서 직접 센다 — 점수의 원천이므로 별도 지표로 둘 값어치가 있다.
    const zone = new Set(state.board.captureZone.map((c) => `${c.x},${c.y}`));
    for (const u of state.units) {
      if (u.alive && u.position && !u.isTurret && zone.has(`${u.position.x},${u.position.y}`)) {
        bump(u.instanceId, (s) => (s.zoneTurns += 1));
      }
    }
  }
  totalTurns += turn;

  // 무승부 판의 점수는 "왜 안 끝났는가"를 가른다 — 양쪽 다 낮으면 점령지가 계속 경합(0점)이었다는 뜻이고,
  // 한쪽이 9점 근처면 그냥 느린 판이다.
  const winner = state.winner;
  if (!winner) drawScores.push(Math.max(state.score.p1, state.score.p2));
  if (winner === 'p1') p1Wins++;
  else if (winner === 'p2') p2Wins++;
  else draws++;

  for (const owner of ['p1', 'p2'] as Owner[]) {
    // 같은 기물을 2기 이상 넣었어도 "그 기물이 들어간 판" 한 번으로 센다.
    for (const type of new Set(rosters[owner])) {
      const s = stats.get(type)!;
      s.games += 1;
      if (winner === owner) s.wins += 1;
      if (!winner) s.draws += 1;
    }
  }
  for (const [type, g] of perGame) {
    const s = stats.get(type)!;
    s.damage += g.damage;
    s.deaths += g.deaths;
    s.healing += g.healing;
    s.zoneTurns += g.zoneTurns;
  }
}

const rows = [...stats.entries()]
  .map(([id, s]) => ({
    id,
    name: unitTypes.find((t) => t.id === id)!.name.replace(/^.*— /, ''),
    games: s.games,
    winRate: s.games ? (s.wins / s.games) * 100 : 0,
    // 승률만 보면 "지는 기물"과 "판을 늘어지게 만드는 기물"이 구별되지 않는다. 무승부를 반 승으로
    // 치는 승점률이 진짜 값어치에 가깝다 — 50%가 균형점이고, 정렬도 이 값으로 한다.
    points: s.games ? ((s.wins + s.draws / 2) / s.games) * 100 : 0,
    drawRate: s.games ? (s.draws / s.games) * 100 : 0,
    dmg: s.games ? s.damage / s.games : 0,
    heal: s.games ? s.healing / s.games : 0,
    deaths: s.games ? s.deaths / s.games : 0,
    zone: s.games ? s.zoneTurns / s.games : 0,
  }))
  .sort((a, b) => b.points - a.points);

console.log(`\n=== ${GAMES}판 · 난이도 ${DIFFICULTY} · 최대 ${MAX_TURNS}턴 ===`);
console.log(`p1 ${p1Wins}승 / p2 ${p2Wins}승 / 무승부 ${draws} · 평균 ${(totalTurns / GAMES).toFixed(1)}턴\n`);
console.log('기물             편성판수  승점률    승률   무승부   판당피해  판당회복  판당사망  점령체류');
for (const r of rows) {
  console.log(
    `${r.name.padEnd(14)} ${String(r.games).padStart(6)} ${r.points.toFixed(1).padStart(7)}% ${r.winRate.toFixed(1).padStart(6)}% ${r.drawRate.toFixed(1).padStart(6)}% ${r.dmg.toFixed(1).padStart(9)} ${r.heal.toFixed(1).padStart(9)} ${r.deaths.toFixed(2).padStart(9)} ${r.zone.toFixed(1).padStart(9)}`,
  );
}
if (drawScores.length > 0) {
  const avg = drawScores.reduce((a, b) => a + b, 0) / drawScores.length;
  console.log(`\n무승부 ${drawScores.length}판의 최고 점수 평균 ${avg.toFixed(1)} / ${WIN_SCORE}`);
}
console.log(`\n포탑: 생성 ${turretSpawns}회 · 회복 총 ${turretHeal}`);
console.log();
