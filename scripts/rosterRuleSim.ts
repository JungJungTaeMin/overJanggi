/**
 * **편성 규칙이 판의 리듬을 얼마나 바꾸는가.**
 *
 * 기물 스탯을 재는 `balanceSim.ts`와 목적이 다르다. 여기서 묻는 것은 "어느 기물이 센가"가 아니라
 * **규칙 하나를 갈아 끼웠을 때 판이 여전히 끝나는가**다. 6대6은 스탯을 하나도 안 건드리고
 * 판 위의 기물을 20기에서 24기로 늘리는데, 늘어난 20%가 어디로 가는지는 사전에 알 수 없다:
 *
 *   - 화력이 늘어 판이 **짧아질** 수도 있고,
 *   - 점령지 앞이 붐벼 경합(0점)이 늘어 판이 **길어지거나 안 끝날** 수도 있다.
 *
 * 후자면 규칙이 아니라 `WIN_SCORE`를 함께 봐야 하므로, 규칙을 넣기 전에 이 값부터 재 둔다.
 * 무승부율은 시뮬레이터 상한(MAX_TURNS) 안에 못 끝낸 비율이라 실제 게임의 무승부가 아니다 —
 * "얼마나 질질 끄는가"의 대리 지표로만 읽는다.
 *
 * 실행: npx vite-node scripts/rosterRuleSim.ts [게임수] [난이도] [최대턴]
 */
import { createInitialState } from '../src/engine/createInitialState';
import { resolveTurn } from '../src/engine/resolveTurn';
import { aiActionPlan, aiPlacement } from '../src/ai/aiPlayer';
import { seededRng } from '../src/engine/rng';
import { mapDefinition } from '../src/data/mapDefinitions';
import { ROSTER_RULES, ROSTER_RULE_ORDER, randomRoster, type RosterRuleId } from '../src/data/rosterRules';
import { WIN_SCORE } from '../src/data/constants';
import type { AiDifficulty } from '../src/ai/difficulty';
import type { Owner } from '../src/engine/types';

const GAMES = Number(process.argv[2] ?? 200);
const DIFFICULTY = (process.argv[3] ?? 'hard') as AiDifficulty;
const MAX_TURNS = Number(process.argv[4] ?? 80);
const board = mapDefinition;

interface RuleStat {
  turns: number;
  finished: number;
  draws: number;
  deaths: number;
  damage: number;
  /** 점수가 **난** 턴 수. 경합(0점)으로 흘려보낸 턴을 가려낸다. */
  scoringTurns: number;
  contested: number;
}

function run(ruleId: RosterRuleId): RuleStat {
  const s: RuleStat = { turns: 0, finished: 0, draws: 0, deaths: 0, damage: 0, scoringTurns: 0, contested: 0 };

  for (let game = 0; game < GAMES; game++) {
    // 규칙끼리 같은 시드를 쓴다 — 편성 추첨과 배치가 같은 난수열에서 나와야 비교가 성립한다.
    const rng = seededRng(1000 + game);
    const rosters: Record<Owner, string[]> = { p1: randomRoster(rng, ruleId), p2: randomRoster(rng, ruleId) };
    const state = createInitialState(
      rosters.p1,
      rosters.p2,
      aiPlacement(rosters.p1, 'p1', board, rng),
      aiPlacement(rosters.p2, 'p2', board, rng),
      board,
    );

    let turn = 0;
    let lastTotal = 0;
    for (; turn < MAX_TURNS && state.phase !== 'gameOver'; turn++) {
      const log = resolveTurn(state, aiActionPlan(state, 'p1', DIFFICULTY, rng), aiActionPlan(state, 'p2', DIFFICULTY, rng), rng);
      for (const e of log) {
        if (e.type === 'death') s.deaths += 1;
        else if (e.type === 'hit' || e.type === 'dashDamage') s.damage += Number(e.detail?.damage ?? 0);
      }
      const total = state.score.p1 + state.score.p2;
      if (total > lastTotal) s.scoringTurns += 1;
      else s.contested += 1;
      lastTotal = total;
    }

    s.turns += turn;
    if (state.winner) s.finished += 1;
    else s.draws += 1;
  }
  return s;
}

console.log(`\n편성 규칙별 판의 리듬 — ${GAMES}판 · ${DIFFICULTY} AI 미러 · 정원 맵 · 승리 ${WIN_SCORE}점 · 상한 ${MAX_TURNS}턴\n`);
console.log('규칙                  인원  평균턴  완료율  판당사망  판당피해  득점턴비율');
for (const id of ROSTER_RULE_ORDER) {
  const rule = ROSTER_RULES[id];
  const s = run(id);
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  console.log(
    `${rule.label.padEnd(20)}  ${String(rule.size).padStart(2)}  ` +
      `${(s.turns / GAMES).toFixed(1).padStart(6)}  ${pct(s.finished / GAMES).padStart(6)}  ` +
      `${(s.deaths / GAMES).toFixed(1).padStart(8)}  ${(s.damage / GAMES).toFixed(0).padStart(8)}  ` +
      `${pct(s.scoringTurns / (s.scoringTurns + s.contested)).padStart(10)}`,
  );
}
console.log('');
