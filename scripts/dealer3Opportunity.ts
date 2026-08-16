/**
 * 충전 사격형(dealer3)이 **왜** 약한가 — 원인 분해. 분석 도구다. 앱 번들에 안 들어간다.
 *
 * 이상한 점부터: dealer3은 dealer1보다 공격력(10 vs 9)도 체력(20 vs 15)도 높고 사격 후 쉬지도
 * 않는데, **판당 피해는 더 낮다**(20.2 vs 24.5). 스탯이 전부 위인데 결과가 아래면 병목은
 * 스탯이 아니다. 숫자를 올리기 전에 어디서 새는지 먼저 센다.
 *
 * 후보는 셋이고 처방이 각각 다르다:
 *
 *   (A) **사선에 적이 안 들어온다** — 이동 1짜리가 사거리 4밖에 없으면 적이 서 주기를 기다리는
 *       수밖에 없다. 사거리(또는 축)를 올려야 풀린다.
 *   (B) **기회는 있는데 안 쏜다** — AI가 공격 모드 토글을 비싸게 보거나 다른 행동에 밀린다.
 *       기물 스탯이 아니라 AI 후보 생성·가중치 문제다.
 *   (C) **켜 놓고 논다** — 공격 모드가 켜진 채 사선에 적이 없어 이동도 공격도 못 하는 턴.
 *       토글이 실질적으로 이동 봉인이 되는 경우로, 토글 규칙 자체를 손봐야 한다.
 *
 * 그래서 매 턴 dealer3에 대해 넷을 따로 센다: 살아 있던 턴 / 사선·사거리 안에 적이 있던 턴 /
 * 실제로 공격을 고른 턴 / 공격 모드가 켜져 있던 턴. 그리고 **같은 판의 dealer1을 대조군으로**
 * 똑같이 센다 — 사거리만 다른 붙박이 저격수라, 둘의 "기회율" 격차가 곧 사거리의 값이다.
 *
 * 편성은 양 팀에 dealer1·dealer3을 하나씩 강제로 넣는다. 무작위 편성이면 둘이 다른 판에
 * 등장해 지형·상대가 달라지는데, 그러면 기회율 차이가 사거리 탓인지 판 탓인지 안 갈린다.
 *
 * 실행: npx vite-node scripts/dealer3Opportunity.ts [게임수] [난이도] [맵]
 */
import { createInitialState } from '../src/engine/createInitialState';
import { resolveTurn } from '../src/engine/resolveTurn';
import { aiActionPlan, aiPlacement } from '../src/ai/aiPlayer';
import { seededRng } from '../src/engine/rng';
import { unitTypes } from '../src/data/unitTypes';
import { ROSTER_SIZE } from '../src/data/constants';
import { hasActiveEffect } from '../src/engine/statusEffects';
import { isWithinAttackRange } from '../src/engine/targeting';
import { loadBoard } from './loadMap';
import type { AiDifficulty } from '../src/ai/difficulty';
import type { GameState, Owner, UnitInstance } from '../src/engine/types';

const GAMES = Number(process.argv[2] ?? 300);
const DIFFICULTY = (process.argv[3] ?? 'hard') as AiDifficulty;
const MAP_ARG = process.argv[4] ?? 'garden';
const MAX_TURNS = 80;

const { name: mapName, board } = loadBoard(MAP_ARG);

/** 대조군 포함, 재는 대상. dealer1은 "사거리만 다른 같은 계열"이라 격차 해석의 기준이 된다. */
const SUBJECTS = ['dealer3', 'dealer1'] as const;

interface Tally {
  turns: number; // 살아서 판 위에 있던 턴
  enemyInRange: number; // 그중 사선·사거리 안에 적이 있던 턴 = 쏠 수 있었던 턴(상한)
  choseAttack: number; // 그중 AI가 실제로 공격을 고른 턴
  modeOn: number; // (dealer3 전용) 공격 모드가 켜져 있던 턴
  onButNoTarget: number; // (dealer3 전용) 켜져 있는데 사선에 적이 없던 턴 = 이동도 공격도 못 한 턴
  onCooldown: number; // (dealer1 전용) 재장전 중이라 못 쏘던 턴
  nearestSum: number; // 가장 가까운 적까지의 체비셰프 거리 합 — 평균 교전 거리
}

function blank(): Tally {
  return { turns: 0, enemyInRange: 0, choseAttack: 0, modeOn: 0, onButNoTarget: 0, onCooldown: 0, nearestSum: 0 };
}

/**
 * 사선·사거리 안에 적이 있는가. **상한**으로 잡는다 — 아군이 사선을 막는 경우나 방벽은 빼지
 * 않는다. 상한조차 낮게 나오면 "기회가 없다"는 결론이 그만큼 단단해지기 때문이다.
 */
function hasTarget(state: GameState, unit: UnitInstance): boolean {
  const shape = unitTypes.find((t) => t.id === unit.typeId)!.attackShape;
  return state.units.some(
    (e) =>
      e.owner !== unit.owner &&
      e.alive &&
      e.position &&
      isWithinAttackRange(unit.position!, e.position, shape, state.board),
  );
}

function nearestEnemyDistance(state: GameState, unit: UnitInstance): number {
  let best = Infinity;
  for (const e of state.units) {
    if (e.owner === unit.owner || !e.alive || !e.position) continue;
    const d = Math.max(Math.abs(e.position.x - unit.position!.x), Math.abs(e.position.y - unit.position!.y));
    if (d < best) best = d;
  }
  return best === Infinity ? 0 : best;
}

const tallies: Record<string, Tally> = { dealer3: blank(), dealer1: blank() };

for (let game = 0; game < GAMES; game++) {
  // 시드는 balanceSim과 같은 계열(1000 + game)로 맞춘다. 밸런스 표와 이 표를 나란히 읽을 때
  // 서로 다른 판을 보고 있으면 해석이 어긋난다.
  const rng = seededRng(1000 + game);

  const makeRoster = (): string[] => {
    const roster = [...SUBJECTS] as string[];
    while (roster.length < ROSTER_SIZE) roster.push(unitTypes[Math.floor(rng() * unitTypes.length)].id);
    // 배치가 편성 순서를 보므로 섞는다. 안 섞으면 저격수가 늘 같은 자리에서 시작한다.
    for (let i = roster.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [roster[i], roster[j]] = [roster[j], roster[i]];
    }
    return roster;
  };

  const rosters: Record<Owner, string[]> = { p1: makeRoster(), p2: makeRoster() };
  const state = createInitialState(
    rosters.p1,
    rosters.p2,
    aiPlacement(rosters.p1, 'p1', board, rng),
    aiPlacement(rosters.p2, 'p2', board, rng),
    board,
  );

  for (let turn = 0; turn < MAX_TURNS && state.phase !== 'gameOver'; turn++) {
    // 계획을 받아 두고 **해결 전** 상태에서 센다 — 기회(무엇을 고를 수 있었나)와 선택(무엇을
    // 골랐나)을 같은 스냅샷 위에서 봐야 둘을 비교할 수 있다.
    const plans = { p1: aiActionPlan(state, 'p1', DIFFICULTY, rng), p2: aiActionPlan(state, 'p2', DIFFICULTY, rng) };

    for (const unit of state.units) {
      const t = tallies[unit.typeId];
      if (!t || !unit.alive || !unit.position) continue;

      t.turns += 1;
      const target = hasTarget(state, unit);
      if (target) t.enemyInRange += 1;
      t.nearestSum += nearestEnemyDistance(state, unit);

      const kind = plans[unit.owner].actions[unit.instanceId]?.baseAction.kind;
      if (kind === 'attack' || kind === 'attackAt') t.choseAttack += 1;

      if (unit.typeId === 'dealer3') {
        const on = hasActiveEffect(unit, 'attackMode', state.turnNumber);
        if (on) t.modeOn += 1;
        if (on && !target) t.onButNoTarget += 1;
      }
      if (unit.typeId === 'dealer1' && (unit.cooldowns['basicAttack'] ?? 0) > 0) t.onCooldown += 1;
    }

    resolveTurn(state, plans.p1, plans.p2, rng);
  }
}

console.log(`\n=== 충전 사격형 기회 분해 · ${GAMES}판 · 난이도 ${DIFFICULTY} · 맵 ${mapName} ===`);
for (const id of SUBJECTS) {
  const def = unitTypes.find((t) => t.id === id)!;
  console.log(`${def.name}: 공격력 ${def.attack} · ${def.attackShape.kind} ${def.attackShape.range} (${def.attackShape.axis}) · 이동 ${def.moveSpeed}`);
}

console.log('\n기물            살아있던턴   사선내적   실제공격   공격/기회   평균교전거리   모드ON   ON공회전   재장전중');
for (const id of SUBJECTS) {
  const t = tallies[id];
  const def = unitTypes.find((u) => u.id === id)!;
  const pct = (n: number) => ((n / t.turns) * 100).toFixed(1) + '%';
  const dash = (s: string, use: boolean) => (use ? s : '—');
  console.log(
    `${def.name.slice(-6).padEnd(14)} ${String(t.turns).padStart(9)} ${pct(t.enemyInRange).padStart(10)} ` +
      `${pct(t.choseAttack).padStart(10)} ` +
      `${((t.choseAttack / Math.max(1, t.enemyInRange)) * 100).toFixed(1).padStart(9)}% ` +
      `${(t.nearestSum / t.turns).toFixed(2).padStart(13)} ` +
      `${dash(pct(t.modeOn), id === 'dealer3').padStart(9)} ${dash(pct(t.onButNoTarget), id === 'dealer3').padStart(10)} ` +
      `${dash(pct(t.onCooldown), id === 'dealer1').padStart(10)}`,
  );
}

console.log('\n읽는 법:');
console.log('  · "사선내적"이 dealer1보다 크게 낮으면 병목은 **사거리**다(가설 A).');
console.log('  · "사선내적"은 비슷한데 "공격/기회"가 낮으면 AI가 안 쏘는 것이다(가설 B).');
console.log('  · "ON공회전"이 높으면 켜 놓고 이동도 공격도 못 하는 턴이 많다는 뜻이다(가설 C).');
