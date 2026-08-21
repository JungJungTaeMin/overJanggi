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
 * 실행: npx vite-node scripts/balanceSim.ts [게임수] [난이도] [최대턴] [탱커수] [맵] [기준맵] [--기준편성=free|N]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createInitialState } from '../src/engine/createInitialState';
import { resolveTurn } from '../src/engine/resolveTurn';
import { aiActionPlan, aiPlacement } from '../src/ai/aiPlayer';
import { seededRng } from '../src/engine/rng';
import { unitTypes } from '../src/data/unitTypes';
// 추첨은 게임의 편성 규칙과 **같은 함수**를 쓴다 — 시뮬레이터가 따로 뽑으면 여기서 잰 숫자가
// 실제 대전에서 벌어지는 일과 조용히 갈라진다.
import { randomRosterWithQuota } from '../src/data/rosterRules';
import { WIN_SCORE } from '../src/data/constants';
import { validateMap } from '../src/maps/mapModel';
import { loadBoard, renderBoard } from './loadMap';
import type { AiDifficulty } from '../src/ai/difficulty';
import type { Owner } from '../src/engine/types';

/**
 * 위치 인자와 `--이름=값` 플래그를 갈라 놓는다. 섞어 두면 플래그를 앞에 쓴 순간 그 자리의 위치
 * 인자로 잘못 읽혀(예: `--기준편성=free`가 '기준 맵'이 된다) 엉뚱한 기록과 비교한 표가 나온다.
 */
const ARGV = process.argv.slice(2);
const POSITIONAL = ARGV.filter((a) => !a.startsWith('--'));
const flag = (name: string) => ARGV.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const GAMES = Number(POSITIONAL[0] ?? 300);
const DIFFICULTY = (POSITIONAL[1] ?? 'hard') as AiDifficulty;
/**
 * 판을 끊는 지점. 게임 자체에는 턴 제한이 없으므로(교착 규칙은 기획서 10장 미정) 이건 순전히
 * 측정용 장치다. 여기서 끊긴 판을 무승부로 세는 탓에 상한을 낮게 잡으면 "느린 편성"이 "약한 편성"으로
 * 잘못 보인다 — 그래서 인자로 뺐다.
 */
const MAX_TURNS = Number(POSITIONAL[2] ?? 80);
/**
 * 편성에 넣을 탱커 수를 강제한다. `free`(기본)면 제약 없이 10종에서 균등 추첨 — 이때 탱커는
 * 이항분포로 0~5명이 섞이고 기대값이 1.5명이다.
 *
 * 왜 인자로 두는가: "탱커 1명만"은 스탯 조정이 아니라 **편성 규칙** 변경이라, 기물 값어치의
 * 순위 자체를 바꿀 수 있다. 예컨대 방벽·제어형은 다른 탱커가 앞에서 맞아 주는 걸 전제로 한
 * 기물인데, 그 전제가 사라지면 같은 스탯이어도 다른 기물이 된다. 스탯을 건드리지 않고 규칙만
 * 바꿔서 재는 게 목적이므로 유닛 데이터가 아니라 시뮬레이터 인자로 뺀다.
 *
 * 이 중 `1`은 게임의 **'탱커 1명 고정' 편성 규칙**과 같은 조건이다(src/data/rosterRules.ts) —
 * 추첨 자체도 그 파일 함수를 그대로 쓴다. 여기서 잰 숫자가 실제 대전에서 벌어지는 일과 달라지면
 * 측정할 값어치가 없기 때문이다. 여전히 인자인 이유는 0·2·3처럼 게임에 없는 조건도 재야
 * "탱커 수에 따라 이 기물이 어떻게 변하는가"라는 곡선이 나오기 때문이다.
 */
const TANK_QUOTA = POSITIONAL[3] === undefined || POSITIONAL[3] === 'free' ? null : Number(POSITIONAL[3]);
/**
 * 잴 맵. 기본은 '정원'(기본 맵)이다.
 *
 * 왜 맵을 바꿔 가며 재는가: 기물의 값어치는 스탯만으로 정해지지 않는다. 사거리 6짜리 장거리
 * 화력형은 탁 트인 맵에서와 엄폐물이 촘촘한 맵에서 전혀 다른 기물이고, 이동 4짜리 돌진형은
 * 진입로가 좁으면 갈 곳이 없다. 그래서 "이 기물이 세다"가 아니라 "이 맵에서 이 기물이 세다"가
 * 실제로 말이 되는 단위다.
 */
const MAP_ARG = POSITIONAL[4] ?? 'garden';
/**
 * 증감을 어느 기록과 비교할지. 비워 두면 **같은 설정·같은 맵의 직전 측정**과 비교한다 — 규칙이나
 * 스탯을 만졌을 때 그 변경이 무엇을 했는지 보는 기본 용도다.
 *
 * 여기에 다른 맵(예: 'garden')을 주면 그 맵의 기록과 비교한다. "이 맵이 누구에게 유리한가"는
 * 같은 맵을 두 번 돌려서는 알 수 없고 다른 맵과 견줘야 나오기 때문이다. 둘을 한 인자로 뭉뚱그리면
 * 표에 찍힌 증감이 '변경 전 대비'인지 '다른 맵 대비'인지 읽는 사람이 알 수 없게 된다.
 */
const BASE_MAP_ARG = POSITIONAL[5];
/**
 * 증감을 **다른 편성 규칙**의 기록과 비교한다. `--기준편성=free`처럼 준다.
 *
 * BASE_MAP_ARG과 같은 이유로 필요하다. "탱커 1명 제한이 누구에게 유리한가"는 탱커 1명끼리 두 번
 * 돌려서는 알 수 없고 자유 편성과 견줘야 나온다 — 그런데 기록은 편성 규칙별로 나뉘어 저장되므로
 * (규칙이 다르면 애초에 비교 대상이 아니라는 게 기본값이다) 규칙을 넘나드는 비교는 여기서
 * 명시적으로 열어 줘야 한다. 이름 있는 플래그로 둔 이유는 위치 인자가 이미 여섯 개라, 일곱
 * 번째·여덟 번째를 순서로 외우게 만들면 읽는 쪽이 무엇과 비교한 표인지 알 수 없게 되기 때문이다.
 */
const BASE_RULE_ARG = flag('기준편성');

const { name: mapName, board } = loadBoard(MAP_ARG);
// 저장 버튼이 쓰는 것과 **같은 검사**를 통과해야 한다. 실제로 대전에 못 쓰는 맵의 밸런스를
// 재 봐야 그 숫자를 적용할 데가 없다.
const mapErrors = validateMap(board);
if (mapErrors.length > 0) {
  console.error(`\n맵 검사 실패 — 이 맵은 대전에 쓸 수 없습니다:`);
  mapErrors.forEach((e) => console.error(`  · ${e}`));
  process.exit(1);
}

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

const randomRoster = (rng: () => number) => randomRosterWithQuota(rng, TANK_QUOTA);

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
    aiPlacement(rosters.p1, 'p1', board, rng),
    aiPlacement(rosters.p2, 'p2', board, rng),
    board,
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

/**
 * 편성 규칙의 표시 이름. 기록 키에도 그대로 쓰이므로 이 함수가 유일한 근거여야 한다.
 *
 * 0·2·3처럼 게임에 없는 할당량도 재므로 게임 쪽 이름표(rosterRules.ts)를 그대로 쓸 수는 없다.
 * 다만 겹치는 두 값(`null`·`1`)은 **글자까지 같아야 한다** — 여기 쌓인 기록의 키가 곧 그 문자열이라,
 * 이름을 바꾸면 예전 기준선과 이어지지 않고 증감 칸이 통째로 비어 버린다.
 */
const ruleLabel = (quota: number | null) => (quota === null ? '자유 편성' : `탱커 ${quota}명 고정`);
const rule = ruleLabel(TANK_QUOTA);
const baseRule = BASE_RULE_ARG === undefined ? rule : ruleLabel(BASE_RULE_ARG === 'free' ? null : Number(BASE_RULE_ARG));
const isGarden = MAP_ARG === 'garden';
const baseSnapshot = readAll()[keyForMap(BASE_MAP_ARG ?? MAP_ARG, baseRule)] ?? null;
const prev = baseSnapshot?.points;

console.log(`\n=== ${GAMES}판 · 난이도 ${DIFFICULTY} · 최대 ${MAX_TURNS}턴 · ${rule} · 맵 ${mapName} ===`);
if (!isGarden) console.log(renderBoard(board));
console.log(`p1 ${p1Wins}승 / p2 ${p2Wins}승 / 무승부 ${draws} · 평균 ${(totalTurns / GAMES).toFixed(1)}턴`);
if (baseSnapshot) {
  // 무엇과 견준 표인지 한 줄로 못박는다 — 맵이 다른지 편성 규칙이 다른지 모르면 증감은 읽을 수 없다.
  const differs = [
    BASE_MAP_ARG === undefined ? null : `맵 '${BASE_MAP_ARG}'`,
    baseRule === rule ? null : `${baseRule}`,
  ].filter(Boolean);
  const what = differs.length === 0 ? '같은 맵의 직전 측정' : differs.join(' · ');
  console.log(`증감은 ${what}(${baseSnapshot.label}) 대비다.`);
} else {
  console.log('비교할 기록이 없어 증감을 낼 수 없다(이번 결과가 다음 실행의 기준선이 된다).');
}
console.log('\n순위 기물             편성판수  승점률   증감      승률   무승부   판당피해  판당회복  판당사망  점령체류');
rows.forEach((r, i) => {
  const before = prev?.[r.id];
  const delta = before === undefined ? null : r.points - before;
  // ±0.05%p 미만은 반올림 잡음이라 화살표를 안 붙인다. 표본이 400~500판이면 기물당 표준오차가
  // 2.5%p 안팎이므로, 화살표는 "움직였다"는 표시일 뿐 그 자체로 유의성은 아니다.
  const mark = delta === null ? ' ' : delta > 0.05 ? '▲' : delta < -0.05 ? '▼' : '·';
  const deltaText = delta === null ? '   —   ' : `${mark}${(delta >= 0 ? '+' : '') + delta.toFixed(1)}%p`;
  console.log(
    `${String(i + 1).padStart(3)}. ${r.name.padEnd(14)} ${String(r.games).padStart(6)} ${r.points.toFixed(1).padStart(7)}% ${deltaText.padStart(9)} ${r.winRate.toFixed(1).padStart(6)}% ${r.drawRate.toFixed(1).padStart(6)}% ${r.dmg.toFixed(1).padStart(9)} ${r.heal.toFixed(1).padStart(9)} ${r.deaths.toFixed(2).padStart(9)} ${r.zone.toFixed(1).padStart(9)}`,
  );
});

const spread = rows[0].points - rows[rows.length - 1].points;
const prevSpread = prev ? Math.max(...Object.values(prev)) - Math.min(...Object.values(prev)) : null;
console.log(
  `\n전체편차(1위−10위) ${spread.toFixed(1)}%p` +
    (prevSpread === null ? '' : ` · 직전 ${prevSpread.toFixed(1)}%p → ${(spread - prevSpread >= 0 ? '+' : '') + (spread - prevSpread).toFixed(1)}%p`),
);
saveSnapshot();
/**
 * 직전 측정을 파일에 남겨 다음 실행이 자동으로 증감을 낼 수 있게 한다.
 *
 * 난이도·편성 규칙이 다르면 애초에 비교 대상이 아니므로 그 조합을 키로 나눠 저장한다. 판수는
 * 키에 넣지 않는다 — 판수만 다른 같은 설정끼리는 비교가 유효하고(표본이 늘 뿐이다), 넣으면
 * 판수를 조금만 바꿔도 기준선이 사라져 버린다.
 */
function snapshotPath(): string {
  return new URL('./.balanceSnapshots.json', import.meta.url).pathname;
}
/** 기본 맵 키에는 맵 이름을 붙이지 않는다 — 맵 인자가 생기기 전에 쌓아 둔 기록과 계속 이어지게. */
function keyForMap(mapArg: string, ruleName: string = rule): string {
  const base = `${DIFFICULTY}/${ruleName}/${MAX_TURNS}턴`;
  return mapArg === 'garden' ? base : `${base}/맵 ${loadBoard(mapArg).name}`;
}
function snapshotKey(): string {
  return keyForMap(MAP_ARG);
}
function readAll(): Record<string, { label: string; points: Record<string, number> }> {
  try {
    return JSON.parse(readFileSync(snapshotPath(), 'utf8'));
  } catch {
    return {};
  }
}
function loadSnapshot(): { label: string; points: Record<string, number> } | null {
  return readAll()[snapshotKey()] ?? null;
}
function saveSnapshot(): void {
  const all = readAll();
  all[snapshotKey()] = {
    label: `${new Date().toISOString().slice(0, 10)} · ${GAMES}판`,
    points: Object.fromEntries(rows.map((r) => [r.id, Number(r.points.toFixed(2))])),
  };
  writeFileSync(snapshotPath(), JSON.stringify(all, null, 2) + '\n');
}

if (drawScores.length > 0) {
  const avg = drawScores.reduce((a, b) => a + b, 0) / drawScores.length;
  console.log(`\n무승부 ${drawScores.length}판의 최고 점수 평균 ${avg.toFixed(1)} / ${WIN_SCORE}`);
}
// 포탑은 총량만으로는 읽히지 않는다 — 생성당 회복량이 "한 번 세운 포탑이 얼마나 값어치를
// 했는가"이고, 이게 낮으면 포탑이 금방 죽거나 아군이 곁에 없다는 뜻이다. 두 원인은 처방이 다르다.
{
  const perSpawn = turretSpawns ? turretHeal / turretSpawns : 0;
  const support3Games = rows.find((r) => r.id === 'support3')?.games ?? 0;
  const perSupport3Game = support3Games ? turretHeal / support3Games : 0;
  console.log(
    `\n포탑: 생성 ${turretSpawns}회 · 회복 총 ${turretHeal} · ` +
      `생성당 ${perSpawn.toFixed(1)} · 확률·포탑형 편성판당 ${perSupport3Game.toFixed(1)}`,
  );
}
console.log();
