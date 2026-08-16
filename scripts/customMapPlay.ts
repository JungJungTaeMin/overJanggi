/**
 * 커스텀 맵 시험 주행 — 맵 메이커로 만든 맵이 **실제로 게임이 되는지** 확인하는 분석 도구다.
 * 앱 번들에 포함되지 않는다.
 *
 * 왜 필요한가: 맵 메이커는 칸을 칠하게 해 줄 뿐, 그 맵에서 판이 굴러가는지는 알려주지 않는다.
 * 점령지가 벽에 갇혔거나, 진영이 너무 멀어 아무도 못 만나거나, 힐팩이 한쪽에 몰려 한 팀만
 * 무한히 버티는 맵은 **UI로는 멀쩡해 보인다**. 그래서 저장 전 검사(validateMap)를 통과한 맵을
 * 놓고 AI끼리 수백 판을 붙여 본다 — 끝나긴 하는가, 한쪽으로 기울지 않는가, 힐팩이 실제로
 * 쓰이는가.
 *
 * 맵은 편집기와 **같은 경로**(TileGrid → tilesToBoard)로 만든다. 여기서만 통하는 별도 변환을
 * 쓰면 정작 사용자가 저장한 맵과 다른 것을 시험하게 된다.
 *
 * 실행:
 *   npx vite-node scripts/customMapPlay.ts [게임수] [난이도] [최대턴] [맵]
 *   맵: 'sample'(기본, 아래 ASCII) | 'garden'(기본 정원 맵) | 공유 코드 문자열
 */
import { createInitialState } from '../src/engine/createInitialState';
import { resolveTurn } from '../src/engine/resolveTurn';
import { aiActionPlan, aiPlacement } from '../src/ai/aiPlayer';
import { seededRng } from '../src/engine/rng';
import { plannedMoveSpeed } from '../src/engine/unitStats';
import { unitTypes } from '../src/data/unitTypes';
import { ROSTER_SIZE, WIN_SCORE } from '../src/data/constants';
import { mapWarnings, validateMap } from '../src/maps/mapModel';
import { loadBoard, renderBoard } from './loadMap';
import type { AiDifficulty } from '../src/ai/difficulty';
import type { Owner } from '../src/engine/types';

const GAMES = Number(process.argv[2] ?? 200);
const DIFFICULTY = (process.argv[3] ?? 'hard') as AiDifficulty;
const MAX_TURNS = Number(process.argv[4] ?? 80);
const MAP_ARG = process.argv[5] ?? 'sample';

const { name: mapName, board } = loadBoard(MAP_ARG);

console.log(`\n맵: ${mapName}  ${board.width}×${board.height}`);
console.log(renderBoard(board));
console.log(
  `진영 A ${board.startZones.p1.length}칸 · 진영 B ${board.startZones.p2.length}칸 · 점령 ${board.captureZone.length}칸 · 벽 ${board.obstacles.length}칸 · 힐팩 ${board.healPacks?.length ?? 0}개`,
);

// 저장 버튼이 쓰는 것과 **같은 검사**를 여기서도 통과해야 한다. 시뮬레이터만 관대하면
// "테스트는 되는데 저장은 안 되는 맵"이 생긴다.
const errors = validateMap(board);
if (errors.length > 0) {
  console.error('\n맵 검사 실패 — 이 맵은 저장할 수도, 대전에 쓸 수도 없습니다:');
  errors.forEach((e) => console.error(`  · ${e}`));
  process.exit(1);
}
mapWarnings(board).forEach((w) => console.log(`  경고: ${w}`));

interface Side {
  wins: number;
  score: number;
}

const sides: Record<Owner, Side> = { p1: { wins: 0, score: 0 }, p2: { wins: 0, score: 0 } };
let draws = 0;
let totalTurns = 0;
let packPickups = 0;
let packHealing = 0;
let packChances = 0;
let totalDeaths = 0;
const zoneVisits = { p1: 0, p2: 0 };
/** 판이 끝난 턴 분포 — 맵이 판을 얼마나 빨리/느리게 만드는지가 맵 평가의 핵심 지표다. */
const finishTurns: number[] = [];

function randomRoster(rng: () => number): string[] {
  return Array.from({ length: ROSTER_SIZE }, () => unitTypes[Math.floor(rng() * unitTypes.length)].id);
}

for (let game = 0; game < GAMES; game++) {
  // 밸런스 시뮬레이터와 **같은 시드 집합**을 쓴다 — 그래야 '정원'과 커스텀 맵의 차이가
  // 맵 때문인지 편성 운 때문인지 구분된다(같은 판번호면 같은 편성이 나온다).
  const rng = seededRng(1000 + game);
  const rosters: Record<Owner, string[]> = { p1: randomRoster(rng), p2: randomRoster(rng) };
  const state = createInitialState(
    rosters.p1,
    rosters.p2,
    aiPlacement(rosters.p1, 'p1', board, rng),
    aiPlacement(rosters.p2, 'p2', board, rng),
    board,
  );

  let turn = 0;
  for (; turn < MAX_TURNS && state.phase !== 'gameOver'; turn++) {
    const log = resolveTurn(state, aiActionPlan(state, 'p1', DIFFICULTY, rng), aiActionPlan(state, 'p2', DIFFICULTY, rng), rng);
    for (const e of log) {
      if (e.type === 'healPack') {
        packPickups += 1;
        packHealing += Number(e.detail?.amount ?? 0);
      } else if (e.type === 'death') totalDeaths += 1;
    }
    const zone = new Set(board.captureZone.map((c) => `${c.x},${c.y}`));
    for (const u of state.units) {
      if (u.alive && u.position && !u.isTurret && zone.has(`${u.position.x},${u.position.y}`)) zoneVisits[u.owner] += 1;
    }

    // **기회**를 따로 센다. 획득 횟수만 보면 "AI가 힐팩을 무시한다"와 "먹을 상황 자체가 없다"를
    // 구분할 수 없다 — 둘은 고쳐야 할 곳이 완전히 다르다(AI 평가함수 vs 맵 배치/규칙).
    // 기회 = 다친 채 살아 있고, 이번 턴 이동으로 닿을 수 있는 차 있는 힐팩이 있는 상태.
    for (const u of state.units) {
      if (!u.alive || !u.position || u.isTurret || u.currentHp >= u.maxHp) continue;
      const speed = plannedMoveSpeed(u);
      for (const pack of board.healPacks ?? []) {
        if ((state.healPackTimers[`${pack.position.x},${pack.position.y}`] ?? 0) > 0) continue;
        const d = Math.max(Math.abs(pack.position.x - u.position.x), Math.abs(pack.position.y - u.position.y));
        if (d <= speed) {
          packChances += 1;
          break;
        }
      }
    }
  }

  totalTurns += turn;
  sides.p1.score += state.score.p1;
  sides.p2.score += state.score.p2;
  if (state.winner) {
    sides[state.winner].wins += 1;
    finishTurns.push(turn);
  } else {
    draws += 1;
  }
}

const pct = (n: number) => `${((n / GAMES) * 100).toFixed(1)}%`;
const median = (xs: number[]) => (xs.length === 0 ? 0 : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]);

console.log(`\n── ${GAMES}판 · ${DIFFICULTY} · 최대 ${MAX_TURNS}턴 ──`);
console.log(`P1 승 ${sides.p1.wins} (${pct(sides.p1.wins)})   P2 승 ${sides.p2.wins} (${pct(sides.p2.wins)})   무승부 ${draws} (${pct(draws)})`);
console.log(`평균 진행 턴 ${(totalTurns / GAMES).toFixed(1)}   승부난 판의 중앙 턴 ${median(finishTurns)}`);
console.log(`평균 점수 P1 ${(sides.p1.score / GAMES).toFixed(2)} : P2 ${(sides.p2.score / GAMES).toFixed(2)} (승리 ${WIN_SCORE}점)`);
console.log(`판당 사망 ${(totalDeaths / GAMES).toFixed(1)}   점령지 체류 P1 ${(zoneVisits.p1 / GAMES).toFixed(1)} : P2 ${(zoneVisits.p2 / GAMES).toFixed(1)}`);
console.log(
  `힐팩 획득 판당 ${(packPickups / GAMES).toFixed(2)}회 · 회복량 ${(packHealing / GAMES).toFixed(1)} · 기회 ${(packChances / GAMES).toFixed(1)}회 (전환율 ${packChances > 0 ? ((packPickups / packChances) * 100).toFixed(1) : '0.0'}%)`,
);

// 맵이 망가졌을 때 나오는 전형적인 모양들을 자동으로 짚어 준다. 숫자만 던지면 무엇이 정상인지
// 알 수 없어 매번 사람이 판단해야 한다.
const verdicts: string[] = [];
if (draws / GAMES > 0.2) verdicts.push(`무승부가 ${pct(draws)}로 많습니다 — 점령지 진입로가 좁아 교착이 나거나 진영이 너무 멀 수 있습니다.`);
const winGap = Math.abs(sides.p1.wins - sides.p2.wins) / GAMES;
if (winGap > 0.1) verdicts.push(`진영 승률 차가 ${(winGap * 100).toFixed(1)}%p입니다 — 맵이 위아래로 대칭인지 확인하세요.`);
if ((board.healPacks?.length ?? 0) > 0 && packPickups / GAMES < 0.5) {
  verdicts.push('힐팩이 거의 안 쓰였습니다 — 주 동선에서 너무 멀리 떨어져 있을 수 있습니다.');
}
console.log(verdicts.length > 0 ? `\n${verdicts.map((v) => `⚠ ${v}`).join('\n')}` : '\n특이사항 없음 — 판이 정상적으로 굴러갑니다.');
