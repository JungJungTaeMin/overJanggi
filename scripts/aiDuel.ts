/**
 * 새 `threatAt` vs 옛 `threatAt` **맞대결**. 분석 도구다. 앱 번들에 안 들어간다.
 *
 * 왜 필요한가: threatAt을 고치면서 네 가지를 바꿨는데, 셋(위협을 받는 쪽이 아니라 쏘는 쪽의 이동력,
 * 기본공격 쿨타임, dealer3·구속의 이동 불가)은 `validation.ts`가 이미 강제하는 규칙을 그대로 옮긴
 * 것이라 옳고 그름을 따질 게 없다. 하지만 넷째(축 인식 — 직선 공격 기물이 자기 행·열 밖은
 * 위협하지 않는다)는 **모델 개선**이라 "더 정확해졌다"와 "더 세졌다"가 같은 말이 아니다.
 * 위협을 더 정확히 보는 AI가 겁이 줄어 오히려 무모해질 수도 있다. 그래서 직접 붙여 본다.
 *
 * 설계상 조심한 것 둘:
 *
 *   1) **거울 편성** — 양쪽에 똑같은 무작위 5기물을 준다. 편성 운이 승패에 섞이면 300판으로는
 *      ±5%p가 그냥 노이즈로 나온다. 편성을 같게 두면 두 쪽의 차이는 위협 모델 하나뿐이다.
 *   2) **진영 교대** — 이 게임은 p1이 유리하다(자유 편성 300판에서 p1이 매번 10판 안팎 앞섰다).
 *      그래서 같은 시드로 (p1=새, p2=옛)과 (p1=옛, p2=새)를 둘 다 돌려 합산한다. 진영 이득이
 *      양쪽에 똑같이 한 번씩 돌아가므로 상쇄된다. 진영별 수치도 따로 찍어 편향이 보이게 둔다.
 *
 * 배치(aiPlacement)는 두 쪽 모두 **새 모델**로 고정한다 — 배치는 위협을 안 보지만, 혹시 보게
 * 되더라도 시작 위치가 달라지면 "같은 판"이라는 전제가 깨진다.
 *
 * ⚠️ 이 스크립트는 그냥은 안 돌아간다. 옛 모델을 되살리려면 `aiPlayer.ts`의 `threatAt` 맨 앞에
 * 아래 스위치를 **일시적으로** 다시 넣어야 한다. 측정이 끝나면 도로 빼라 — AI 안에 살아 있는
 * 전역 가변 플래그는 테스트를 조용히 오염시킨다.
 *
 *     let LEGACY_THREAT = false;
 *     export function setLegacyThreat(on: boolean): void { LEGACY_THREAT = on; }
 *
 *     export function threatAt(state, unit, dest) {
 *       if (LEGACY_THREAT) {
 *         let legacy = 0;
 *         for (const enemy of livingUnits(state, unit.owner === 'p1' ? 'p2' : 'p1')) {
 *           const typeDef = getUnitType(enemy.typeId);
 *           if (!typeDef.canAttack) continue;
 *           const reach = typeDef.attackShape.range + plannedMoveSpeed(unit);
 *           if (chebyshev(dest, enemy.position!) <= reach) legacy += plannedAttackPower(enemy);
 *         }
 *         return legacy;
 *       }
 *       ... 기존 본문 ...
 *
 * 실행: npx vite-node scripts/aiDuel.ts [게임수] [난이도] [최대턴]
 */
import { createInitialState } from '../src/engine/createInitialState';
import { resolveTurn } from '../src/engine/resolveTurn';
import * as ai from '../src/ai/aiPlayer';
import { aiActionPlan, aiPlacement } from '../src/ai/aiPlayer';
import { seededRng } from '../src/engine/rng';
import { mapDefinition } from '../src/data/mapDefinitions';
import { unitTypes } from '../src/data/unitTypes';
import { ROSTER_SIZE } from '../src/data/constants';
import type { AiDifficulty } from '../src/ai/difficulty';
import type { Owner } from '../src/engine/types';

const setLegacyThreat = (ai as Record<string, unknown>).setLegacyThreat as ((on: boolean) => void) | undefined;
if (!setLegacyThreat) {
  console.error(
    '\naiPlayer.ts에 setLegacyThreat이 없다. 이 스크립트 맨 위 주석의 스위치를 threatAt에 일시적으로\n' +
      '다시 넣고 돌려라. 측정이 끝나면 반드시 도로 빼라.\n',
  );
  process.exit(1);
}

const GAMES = Number(process.argv[2] ?? 300);
const DIFFICULTY = (process.argv[3] ?? 'hard') as AiDifficulty;
const MAX_TURNS = Number(process.argv[4] ?? 80);

interface Score {
  newWins: number;
  legacyWins: number;
  draws: number;
  turns: number;
}

/** `legacySide`가 옛 모델을 쓰는 쪽. 반대쪽이 새 모델이다. */
function runArrangement(legacySide: Owner): Score {
  const s: Score = { newWins: 0, legacyWins: 0, draws: 0, turns: 0 };
  const newSide: Owner = legacySide === 'p1' ? 'p2' : 'p1';

  for (let game = 0; game < GAMES; game++) {
    const rng = seededRng(1000 + game);
    // 거울 편성: 한 번 뽑아 양쪽에 그대로 준다.
    const roster = Array.from({ length: ROSTER_SIZE }, () => unitTypes[Math.floor(rng() * unitTypes.length)].id);

    setLegacyThreat(false);
    const state = createInitialState(
      roster,
      roster,
      aiPlacement(roster, 'p1', mapDefinition, rng),
      aiPlacement(roster, 'p2', mapDefinition, rng),
      mapDefinition,
    );

    let turn = 0;
    for (; turn < MAX_TURNS && state.phase !== 'gameOver'; turn++) {
      // 계획을 세우는 동안에만 스위치를 켠다. resolveTurn은 AI를 안 부르므로 밖에서 꺼도 된다.
      setLegacyThreat(legacySide === 'p1');
      const planP1 = aiActionPlan(state, 'p1', DIFFICULTY, rng);
      setLegacyThreat(legacySide === 'p2');
      const planP2 = aiActionPlan(state, 'p2', DIFFICULTY, rng);
      setLegacyThreat(false);
      resolveTurn(state, planP1, planP2, rng);
    }
    s.turns += turn;

    if (state.winner === newSide) s.newWins += 1;
    else if (state.winner === legacySide) s.legacyWins += 1;
    else s.draws += 1;
  }
  return s;
}

const a = runArrangement('p2'); // p1 = 새 모델
const b = runArrangement('p1'); // p1 = 옛 모델

const total = GAMES * 2;
const newWins = a.newWins + b.newWins;
const legacyWins = a.legacyWins + b.legacyWins;
const draws = a.draws + b.draws;
// 무승부를 반 승으로 치는 승점률. 판이 안 끝나는 것도 결과의 일부다.
const points = ((newWins + draws / 2) / total) * 100;

console.log(`\n=== threatAt 맞대결 · 거울 편성 · 진영 교대 · 각 ${GAMES}판(합 ${total}) · 난이도 ${DIFFICULTY} · 최대 ${MAX_TURNS}턴 ===\n`);
console.log('진영 배치            새 모델 승   옛 모델 승   무승부   평균 턴');
const row = (label: string, s: Score) =>
  console.log(
    `${label.padEnd(20)} ${String(s.newWins).padStart(10)} ${String(s.legacyWins).padStart(12)} ${String(s.draws).padStart(8)} ${(s.turns / GAMES).toFixed(1).padStart(9)}`,
  );
row('p1=새 / p2=옛', a);
row('p1=옛 / p2=새', b);
row('합계', { newWins, legacyWins, draws, turns: a.turns + b.turns });

console.log(`\n새 모델 승점률 ${points.toFixed(1)}% (승률 ${((newWins / total) * 100).toFixed(1)}%)`);

/**
 * 표본 오차 눈대중: 승점률의 표준오차는 대략 sqrt(0.25/n)이다. 50%에서 이만큼 이상 떨어져 있지
 * 않으면 "우열을 못 가렸다"가 정직한 결론이다. (거울 편성 덕에 실제 분산은 이보다 작을 것이다.)
 */
const se = Math.sqrt(0.25 / total) * 100;
const delta = points - 50;
console.log(`50% 기준 ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%p · 표준오차 약 ${se.toFixed(1)}%p (${Math.abs(delta / se).toFixed(1)}σ)`);
console.log();
