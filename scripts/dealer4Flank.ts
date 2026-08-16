/**
 * dealer4의 측면 보너스가 **얼마나 자주 터지는가**. 분석 도구다. 앱 번들에 안 들어간다.
 *
 * 문제 제기: 500판 측정에서 dealer4가 승점 59.8%로 2등과 4.5%p 차이가 났고, 판당피해 42.6은
 * 공격력 10짜리 dealer3(33.8)보다도 높았다. dealer4의 공격력은 5다. 즉 "다른 적과 인접한 대상"이라는
 * **조건부** 보너스(+7)가 사실상 상시로 붙고 있다는 뜻인데, 그렇다면 이 기물의 실제 공격력은 12다.
 *
 * 조건이 쉬운 데는 구조적인 이유가 있다: 이 게임의 승리 조건이 점령이라 적은 3×3 점령지로 모인다.
 * 뭉친 적을 때리면 인접 조건은 저절로 충족된다. 즉 보너스는 "측면을 파고든 보상"이 아니라
 * "게임이 원래 시키는 일을 한 보상"일 수 있다.
 *
 * 그래서 두 가지를 나눠 센다:
 *
 *   - 발동률: dealer4의 명중 중 보너스가 붙은 비율. 100%에 가까우면 조건부가 아니다.
 *   - 점령지 안/밖: 점령지 근처에서만 높다면 조건이 아니라 **맵 구조**가 원인이다. 밖에서도
 *     높으면 조건 자체가 헐거운 것이라 조건을 조여야 한다.
 *
 * 비교군으로 dealer3(공격력 10, 보너스 없음)의 명중 수도 같이 센다 — 발동률이 높아도 애초에
 * 명중 횟수가 적으면 판당피해로 이어지지 않기 때문이다.
 *
 * 실행: npx vite-node scripts/dealer4Flank.ts [게임수] [난이도]
 */
import { createInitialState } from '../src/engine/createInitialState';
import { resolveTurn } from '../src/engine/resolveTurn';
import { aiActionPlan, aiPlacement } from '../src/ai/aiPlayer';
import { seededRng } from '../src/engine/rng';
import { mapDefinition } from '../src/data/mapDefinitions';
import { unitTypes } from '../src/data/unitTypes';
import { ROSTER_SIZE } from '../src/data/constants';
import type { AiDifficulty } from '../src/ai/difficulty';
import type { GameState, Owner, Position } from '../src/engine/types';

const GAMES = Number(process.argv[2] ?? 300);
const DIFFICULTY = (process.argv[3] ?? 'hard') as AiDifficulty;
const MAX_TURNS = 80;

let hits = 0;
let flankHits = 0;
let damage = 0;
let bonusDamage = 0;
/** 대상이 점령지 안에 있었을 때. 맵 구조가 조건을 대신 충족시켜 주는지 보려는 것이다. */
let hitsInZone = 0;
let flankInZone = 0;
let dealer3Hits = 0;
let games = 0;

const bonus = unitTypes.find((t) => t.id === 'dealer4')!.passive!.payload!.bonusDamage as number;

for (let game = 0; game < GAMES; game++) {
  const rng = seededRng(1000 + game);
  const rosters: Record<Owner, string[]> = {
    p1: Array.from({ length: ROSTER_SIZE }, () => unitTypes[Math.floor(rng() * unitTypes.length)].id),
    p2: Array.from({ length: ROSTER_SIZE }, () => unitTypes[Math.floor(rng() * unitTypes.length)].id),
  };
  const state: GameState = createInitialState(
    rosters.p1,
    rosters.p2,
    aiPlacement(rosters.p1, 'p1', mapDefinition, rng),
    aiPlacement(rosters.p2, 'p2', mapDefinition, rng),
    mapDefinition,
  );
  if (!rosters.p1.includes('dealer4') && !rosters.p2.includes('dealer4')) continue;
  games += 1;

  const typeOf = new Map(state.units.map((u) => [u.instanceId, u.typeId]));
  const zone = new Set(state.board.captureZone.map((c: Position) => `${c.x},${c.y}`));

  for (let turn = 0; turn < MAX_TURNS && state.phase !== 'gameOver'; turn++) {
    // 대상 위치는 피격 **직후** 상태에서 읽는다. 공격 단계에서는 아무도 움직이지 않으므로
    // 때린 시점의 위치와 같다(죽어서 position이 null이 된 경우만 빠지는데, 그건 아래에서 건너뛴다).
    const log = resolveTurn(state, aiActionPlan(state, 'p1', DIFFICULTY, rng), aiActionPlan(state, 'p2', DIFFICULTY, rng), rng);
    for (const e of log) {
      if (e.type !== 'hit') continue;
      const attacker = typeOf.get(e.actorId ?? '');
      if (attacker === 'dealer3') dealer3Hits += 1;
      if (attacker !== 'dealer4') continue;

      hits += 1;
      damage += Number(e.detail?.damage ?? 0);
      const flank = e.detail?.flank === true;
      if (flank) {
        flankHits += 1;
        bonusDamage += bonus;
      }
      const target = state.units.find((u) => u.instanceId === e.targetId);
      if (target?.position && zone.has(`${target.position.x},${target.position.y}`)) {
        hitsInZone += 1;
        if (flank) flankInZone += 1;
      }
    }
  }
}

const pct = (n: number, d: number) => (d === 0 ? '  —  ' : ((n / d) * 100).toFixed(1) + '%');

console.log(`\n=== dealer4 측면 보너스 발동률 · ${games}판(dealer4 편성) · 난이도 ${DIFFICULTY} ===`);
console.log(`보너스 설정: 공격력 ${unitTypes.find((t) => t.id === 'dealer4')!.attack} + 측면 ${bonus}\n`);
console.log(`명중          ${hits}회 (판당 ${(hits / games).toFixed(1)})`);
console.log(`그중 측면 발동 ${flankHits}회 — **발동률 ${pct(flankHits, hits)}**`);
console.log(`총 피해       ${damage} (판당 ${(damage / games).toFixed(1)})`);
console.log(`그중 보너스분 ${bonusDamage} — 피해의 ${pct(bonusDamage, damage)}가 패시브에서 나온다`);
console.log(`실효 공격력   ${(damage / Math.max(hits, 1)).toFixed(2)} (표기 공격력 ${unitTypes.find((t) => t.id === 'dealer4')!.attack})`);
console.log();
console.log(`대상이 점령지 안이던 명중  ${hitsInZone}회 — 그중 측면 발동 ${pct(flankInZone, hitsInZone)}`);
console.log(`대상이 점령지 밖이던 명중  ${hits - hitsInZone}회 — 그중 측면 발동 ${pct(flankHits - flankInZone, hits - hitsInZone)}`);
console.log();
console.log(`참고 · dealer3 명중 ${dealer3Hits}회 (판당 ${(dealer3Hits / games).toFixed(1)}) — 공격력 10, 보너스 없음`);
console.log('\n힌트: 발동률이 100%에 가까우면 "조건부"가 아니라 그냥 공격력이다. 점령지 안/밖이 비슷하면');
console.log('     원인은 맵 구조가 아니라 조건 자체가 헐거운 것이다.');
console.log();
