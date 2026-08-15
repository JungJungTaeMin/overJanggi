/**
 * support2가 **왜** 노는가 — 발동률 10%의 원인 분해. 분석 도구다. 앱 번들에 안 들어간다.
 *
 * 스윕에서 나온 사실: support2가 살아 있는 턴 중 회복이 나가는 턴은 10%뿐이고, 사거리를 4→8로
 * 올려도 10%에서 안 움직인다. 원인은 둘 중 하나인데 둘은 처방이 정반대다.
 *
 *   (A) 사거리·라인 안에 **아군 자체가 없다** → 축을 넓히거나(대각선 포함) 사거리를 올리면 해결
 *   (B) 아군은 있는데 **다치지 않아 회복할 게 없다** → 축을 넓혀도 소용없다. 대상 조건이 병목이라
 *       "아무 아군에게나 걸 수 있는 효과"(버프 등)가 아니면 발동률이 안 오른다
 *
 * 그래서 매 턴 세 가지를 따로 센다: 살아 있는 아군 수 / 그중 라인·사거리 안 / 그중 부상한 아군.
 * (A)와 (B)의 비중이 갈리면 1안(대각선 포함)과 3안(신규 기술)의 우열이 그 자리에서 결정된다.
 *
 * 실행: npx vite-node scripts/support2Opportunity.ts [게임수] [난이도]
 */
import { createInitialState } from '../src/engine/createInitialState';
import { resolveTurn } from '../src/engine/resolveTurn';
import { aiActionPlan, aiPlacement } from '../src/ai/aiPlayer';
import { seededRng } from '../src/engine/rng';
import { mapDefinition } from '../src/data/mapDefinitions';
import { unitTypes } from '../src/data/unitTypes';
import { ROSTER_SIZE } from '../src/data/constants';
import { SKILL_AXIS } from '../src/engine/skillRange';
import { isWithinSkillRange, type SkillAxis } from '../src/engine/targeting';
import type { AiDifficulty } from '../src/ai/difficulty';
import type { GameState, Owner } from '../src/engine/types';

const GAMES = Number(process.argv[2] ?? 300);
const DIFFICULTY = (process.argv[3] ?? 'hard') as AiDifficulty;
const MAX_TURNS = 80;

const support2Def = unitTypes.find((t) => t.id === 'support2')!;
const healSkill = support2Def.skills.find((s) => s.id === 'support2_heal')!;

interface Tally {
  turns: number; // support2가 살아서 판 위에 있던 턴 수
  anyAlly: number; // 그중 살아 있는 아군이 하나라도 있던 턴
  allyInRange: number; // 그중 사거리·축 안에 아군이 있던 턴
  woundedInRange: number; // 그중 사거리·축 안에 **부상한** 아군이 있던 턴
  /**
   * 공격을 열어 준 뒤 추가된 두 칸. 시뮬레이터에서 support2에 공격을 주자 승점이 44.0→51.1%로
   * 올랐는데 **판당 피해는 1.0**이었다 — 실제로 쏴서 오른 건지, 아니면 AI의 위협 모델
   * (`threatAt`이 `canAttack`과 공격력만 보고 적을 밀어내는 것)이 만든 착시인지 구분해야 한다.
   *
   *   - enemyInAttackRange: 공격 사선·사거리 안에 적이 있던 턴 = **쏠 수 있었던 턴**
   *   - choseAttack: AI가 실제로 공격을 고른 턴 = **쐈던 턴**
   *
   * 앞이 낮으면 기회 자체가 없는 것(위치 문제)이고, 앞은 높은데 뒤가 낮으면 회복·버프가 항상
   * 더 값어치 있어서 공격이 사문화된 것이다. 둘 다 낮으면 승점 상승분은 전부 착시다.
   */
  enemyInAttackRange: number;
  choseAttack: number;
}

function measure(range: number, axis: SkillAxis): Tally {
  healSkill.payload.range = range;
  SKILL_AXIS.support2_heal.axis = axis;

  const t: Tally = { turns: 0, anyAlly: 0, allyInRange: 0, woundedInRange: 0, enemyInAttackRange: 0, choseAttack: 0 };

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

    for (let turn = 0; turn < MAX_TURNS && state.phase !== 'gameOver'; turn++) {
      // 계획을 먼저 받아 두고 **해결 전** 상태에서 센다. aiActionPlan은 상태를 건드리지 않으므로
      // 기회(무엇을 고를 수 있었나)와 선택(무엇을 골랐나)을 같은 스냅샷 위에서 볼 수 있다.
      const plans = { p1: aiActionPlan(state, 'p1', DIFFICULTY, rng), p2: aiActionPlan(state, 'p2', DIFFICULTY, rng) };

      for (const healer of state.units) {
        if (healer.typeId !== 'support2' || !healer.alive || !healer.position) continue;
        t.turns += 1;

        const allies = state.units.filter(
          (u) => u.owner === healer.owner && u.alive && u.position && u.instanceId !== healer.instanceId && !u.isTurret,
        );
        if (allies.length > 0) t.anyAlly += 1;

        const reachable = allies.filter((u) =>
          isWithinSkillRange(healer.position!, u.position!, range, state.board, axis),
        );
        if (reachable.length > 0) t.allyInRange += 1;
        if (reachable.some((u) => u.currentHp < u.maxHp)) t.woundedInRange += 1;

        // 공격 기회는 **상한**으로 잡는다: 사거리·축만 보고 아군이 사선을 막는 경우는 빼지 않는다.
        // 상한조차 낮게 나오면 "기회가 없다"는 결론이 그만큼 단단해진다.
        if (support2Def.canAttack) {
          const enemies = state.units.filter((u) => u.owner !== healer.owner && u.alive && u.position);
          const shape = support2Def.attackShape;
          if (enemies.some((e) => isWithinSkillRange(healer.position!, e.position!, shape.range, state.board, shape.axis))) {
            t.enemyInAttackRange += 1;
          }
        }
        if (plans[healer.owner].actions[healer.instanceId]?.baseAction.kind === 'attack') t.choseAttack += 1;
      }

      resolveTurn(state, plans.p1, plans.p2, rng);
    }
  }
  return t;
}

const cases: { range: number; axis: SkillAxis; label: string }[] = [
  { range: 4, axis: 'orthogonal', label: '직선 4 (현재)' },
  { range: 8, axis: 'orthogonal', label: '직선 8' },
  { range: 8, axis: 'both', label: '직선·대각 8' },
  { range: 8, axis: 'radius', label: '반경 8 (참고)' },
];

console.log(`\n=== support2 기회 분해 · ${GAMES}판 · 난이도 ${DIFFICULTY} ===`);
console.log(`공격: ${support2Def.canAttack ? `공격력 ${support2Def.attack} · 사거리 ${support2Def.attackShape.range}` : '불가'}\n`);
console.log('설정              살아있던턴   아군존재   사거리내아군   그중부상   실질기회율   사선내적   실제공격');

for (const c of cases) {
  const t = measure(c.range, c.axis);
  const pct = (n: number) => ((n / t.turns) * 100).toFixed(0).padStart(5) + '%';
  console.log(
    `${c.label.padEnd(16)} ${String(t.turns).padStart(9)} ${pct(t.anyAlly).padStart(10)} ` +
      `${pct(t.allyInRange).padStart(13)} ${pct(t.woundedInRange).padStart(10)} ` +
      `${(((t.woundedInRange / t.turns) * 100).toFixed(1) + '%').padStart(12)} ` +
      `${pct(t.enemyInAttackRange).padStart(10)} ${pct(t.choseAttack).padStart(10)}`,
  );
}
console.log('\n힌트: "사거리내아군"이 높은데 "그중부상"이 낮으면 병목은 축이 아니라 **회복이라는 대상 조건**이다.');
console.log('     "사선내적"은 높은데 "실제공격"이 낮으면, 공격은 열려 있어도 회복·버프에 밀려 사문화된 것이다.');
