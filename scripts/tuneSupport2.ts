/**
 * support2(장거리 회복·구속형) 회복 스탯 스윕 — 분석 도구다. 앱 번들에 들어가지 않는다.
 *
 * 왜 스윕인가: 이 기물은 이동력 1이 정체성이라 기동력으로는 못 올린다. 대신 그 대가인
 * **회복 사거리와 회복량**을 올려서 값어치를 맞추려는데, 두 값이 서로 독립이 아니다 —
 * 사거리를 늘리면 힐 대상이 늘어 실효 회복량도 같이 오른다. 그래서 한 값씩 감으로 만지는 대신
 * 격자로 훑어 실제 승점률을 본다.
 *
 * 통제: 모든 변형이 **같은 시드 집합**으로 같은 편성·같은 배치를 만난다. 변형 간 차이가
 * 무작위성이 아니라 스탯 차이에서만 오도록 하기 위해서다.
 *
 * 보는 값 두 가지:
 *   - support2 승점률 → 목표는 50%
 *   - 전체 편차(최고−최저) → 한 기물을 올리다 다른 기물을 부수지 않았는지. 이게 커지면 실패다.
 *
 * 실행: npx vite-node scripts/tuneSupport2.ts [게임수] [난이도]
 */
import { createInitialState } from '../src/engine/createInitialState';
import { resolveTurn } from '../src/engine/resolveTurn';
import { aiActionPlan, aiPlacement } from '../src/ai/aiPlayer';
import { seededRng } from '../src/engine/rng';
import { mapDefinition } from '../src/data/mapDefinitions';
import { unitTypes } from '../src/data/unitTypes';
import { ROSTER_SIZE } from '../src/data/constants';
import { SKILL_AXIS } from '../src/engine/skillRange';
import type { SkillAxis } from '../src/engine/targeting';
import type { AiDifficulty } from '../src/ai/difficulty';
import type { Owner } from '../src/engine/types';

const GAMES = Number(process.argv[2] ?? 200);
const DIFFICULTY = (process.argv[3] ?? 'hard') as AiDifficulty;
const MAX_TURNS = 80;

const support2 = unitTypes.find((t) => t.id === 'support2')!;
const healSkill = support2.skills.find((s) => s.id === 'support2_heal')!;
const buffSkill = support2.skills.find((s) => s.id === 'support2_buff')!;

interface Result {
  points: Map<string, number>;
  support2Heal: number;
  /**
   * **발동률** — support2가 살아 있던 턴 중 실제로 회복이 나간 턴의 비율. 이 지표가 없으면
   * "판당 회복량"이 올라간 이유가 한 발이 세져서인지 발을 더 자주 쏴서인지 구분할 수 없다.
   * 힐량만 올리는 안(직선 유지)은 발동률에 손을 못 대므로, 발동률이 낮으면 그 안의 천장이 낮다.
   */
  fireRate: number;
  /** 그중 조준 보조가 차지하는 비율 — 신규 기술이 실제로 빈 턴을 메우는지 확인용. */
  buffRate: number;
  support2Zone: number;
  avgTurns: number;
  draws: number;
}

function runSuite(): Result {
  const games = new Map<string, number>();
  const wins = new Map<string, number>();
  const drawsPer = new Map<string, number>();
  let healTotal = 0;
  let healCasts = 0;
  let buffCasts = 0;
  let s2AliveTurns = 0;
  let zoneTotal = 0;
  let s2Games = 0;
  let totalTurns = 0;
  let draws = 0;

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
    const typeOf = new Map(state.units.map((u) => [u.instanceId, u.typeId]));

    let turn = 0;
    for (; turn < MAX_TURNS && state.phase !== 'gameOver'; turn++) {
      const log = resolveTurn(state, aiActionPlan(state, 'p1', DIFFICULTY, rng), aiActionPlan(state, 'p2', DIFFICULTY, rng), rng);
      for (const e of log) {
        if (!e.actorId || typeOf.get(e.actorId) !== 'support2') continue;
        // 회복과 조준 보조를 **같은 분자**에 넣는다. 이 기물의 문제는 "회복이 약하다"가 아니라
        // "쓸 수 있는 턴이 없다"였으므로, 봐야 할 값은 둘을 합친 실질 가동률이다.
        if (e.type === 'heal') {
          healTotal += Number(e.detail?.amount ?? 0);
          healCasts += 1;
        } else if (e.type === 'buff' && e.detail?.landed) {
          buffCasts += 1;
        }
      }
      const zone = new Set(state.board.captureZone.map((c) => `${c.x},${c.y}`));
      for (const u of state.units) {
        if (u.typeId !== 'support2' || !u.alive || !u.position) continue;
        s2AliveTurns += 1; // 발동률의 분모: "쏠 수 있었던 턴"
        if (zone.has(`${u.position.x},${u.position.y}`)) zoneTotal += 1;
      }
    }
    totalTurns += turn;
    const winner = state.winner;
    if (!winner) draws += 1;

    for (const owner of ['p1', 'p2'] as Owner[]) {
      for (const type of new Set(rosters[owner])) {
        games.set(type, (games.get(type) ?? 0) + 1);
        if (winner === owner) wins.set(type, (wins.get(type) ?? 0) + 1);
        if (!winner) drawsPer.set(type, (drawsPer.get(type) ?? 0) + 1);
        if (type === 'support2') s2Games += 1;
      }
    }
  }

  const points = new Map<string, number>();
  for (const t of unitTypes) {
    const g = games.get(t.id) ?? 0;
    points.set(t.id, g ? (((wins.get(t.id) ?? 0) + (drawsPer.get(t.id) ?? 0) / 2) / g) * 100 : 0);
  }
  return {
    points,
    support2Heal: s2Games ? healTotal / s2Games : 0,
    fireRate: s2AliveTurns ? ((healCasts + buffCasts) / s2AliveTurns) * 100 : 0,
    buffRate: s2AliveTurns ? (buffCasts / s2AliveTurns) * 100 : 0,
    support2Zone: s2Games ? zoneTotal / s2Games : 0,
    avgTurns: totalTurns / GAMES,
    draws,
  };
}

/**
 * **조준 보조(신규 기술)의 값 찾기.** 회복은 기획서 원문 그대로(직선 4·힐량 8) 고정하고 버프만 훑는다.
 *
 * 왜 회복을 안 건드리는가: 이미 재 봤고 둘 다 실패했다. 직선을 유지한 채 사거리 4→12는 38.8→38.2%,
 * 힐량 8→25(3배)는 판당 회복량만 3배가 되고 승점은 38.2%였다. 축을 대각선까지 열어야 42.9%인데
 * 그건 저격수 컨셉을 깎는다. 병목은 회복의 세기가 아니라 **회복을 걸 수 있는 턴이 9%뿐**인 것이었다.
 *
 * 그래서 보는 값은 `발동률`이다 — 회복+버프를 합친 실질 가동률. 이게 9%대에서 안 올라오면 버프의
 * 사거리나 AI 채택 조건이 잘못된 것이지 버프량이 부족한 게 아니다. 버프량(`buff`)은 그 다음 문제다.
 */
const variants: { buffRange: number; buff: number; axis: SkillAxis }[] = [
  { buffRange: 0, buff: 0, axis: 'orthogonal' }, // 버프 없음 — 기준선
  { buffRange: 4, buff: 2, axis: 'orthogonal' },
  { buffRange: 4, buff: 4, axis: 'orthogonal' },
  { buffRange: 4, buff: 6, axis: 'orthogonal' },
  { buffRange: 6, buff: 3, axis: 'orthogonal' },
  { buffRange: 6, buff: 4, axis: 'orthogonal' },
  { buffRange: 6, buff: 6, axis: 'orthogonal' },
  { buffRange: 8, buff: 3, axis: 'orthogonal' },
  { buffRange: 8, buff: 4, axis: 'orthogonal' },
  { buffRange: 8, buff: 6, axis: 'orthogonal' },
];

console.log(`\n=== support2 조준 보조 스윕 · ${GAMES}판 · 난이도 ${DIFFICULTY} ===`);
console.log('버프사거리 버프량  support2승점  전체편차   최저기물         최고기물         판당힐  발동률  버프율  평균턴  무승부');

for (const v of variants) {
  // 버프 사거리 0 = 어떤 대상에도 안 닿음 → 기술이 없는 것과 같은 기준선.
  buffSkill.payload.range = v.buffRange;
  buffSkill.payload.attackBonus = v.buff;
  SKILL_AXIS.support2_buff.axis = v.axis;
  const r = runSuite();

  const sorted = [...r.points.entries()].sort((a, b) => b[1] - a[1]);
  const spread = sorted[0][1] - sorted[sorted.length - 1][1];
  const nameOf = (id: string) => unitTypes.find((t) => t.id === id)!.name.replace(/^.*— /, '');
  const lo = sorted[sorted.length - 1];
  const hi = sorted[0];
  const base = v.buff === 0 ? ' ←기준(버프 없음)' : '';

  console.log(
    `${String(v.buffRange).padStart(8)} ${String(v.buff).padStart(6)} ${r.points.get('support2')!.toFixed(1).padStart(12)}% ${spread.toFixed(1).padStart(8)}%p  ` +
      `${(nameOf(lo[0]) + ' ' + lo[1].toFixed(1)).padEnd(17)}${(nameOf(hi[0]) + ' ' + hi[1].toFixed(1)).padEnd(17)}` +
      `${r.support2Heal.toFixed(1).padStart(6)} ${r.fireRate.toFixed(0).padStart(5)}% ${r.buffRate.toFixed(0).padStart(5)}% ${r.avgTurns.toFixed(1).padStart(7)} ${String(r.draws).padStart(6)}${base}`,
  );
}
console.log();
