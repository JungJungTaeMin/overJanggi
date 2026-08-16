/**
 * dealer3(충전 사격형)의 사거리·화력·이동을 훑는다. 분석 도구다. 앱 번들에 안 들어간다.
 *
 * 왜 이 손잡이들인가: 기회 분해(`dealer3Opportunity.ts`)에서 나온 두 숫자가 방향을 정해 줬다.
 *
 *   · **평균 교전거리 5.8칸**인데 dealer3의 사거리는 4다. 싸움이 벌어지는 거리가 사거리 밖이다.
 *   · 그 결과 사선에 적이 있는 턴이 11.2%뿐이다 — 사거리 6짜리 dealer1(20.6%)의 **절반**이다.
 *     이동력·축이 같으니 이 격차는 온전히 사거리 두 칸 값이다.
 *
 * 그래서 사거리는 **기회의 수**를, 공격력은 **기회당 값어치**를, 이동력은 **기회를 만들러 갈 수
 * 있는지**를 각각 건드리는 독립 손잡이가 된다. 어느 쪽이 병목인지는 셋을 따로 돌려 봐야 갈린다.
 *
 * 제약: dealer1의 공격력(9)은 dealer3(10)보다 반드시 낮아야 하고(사용자 결정), dealer1이 "더
 * 멀리 쏘는 쪽"이라는 구분도 지켜야 한다. 그래서 사거리 6은 **채택 후보가 아니라 상한 측정용
 * 대조군**으로만 넣는다 — 6에서도 안 오르면 병목이 사거리가 아니라는 뜻이기 때문이다.
 *
 * 보고 방식: 매 설정마다 1위부터 10위까지 전원을 기준선(현재 설정) 대비 증감과 함께 찍는다.
 * dealer3만 보면 "올라갔다"까지밖에 못 말한다 — 누구를 밟고 올라갔는지, 전체 편차가 벌어졌는지
 * 좁혀졌는지는 10종을 다 봐야 나온다. 모든 설정이 같은 시드 집합(seededRng(1000+game))을 쓰므로
 * 설정 간 차이는 편성 운이 아니라 설정 때문이다.
 *
 * 실행: npx vite-node scripts/dealer3Sweep.ts [게임수] [난이도] [맵] [볼설정번호]
 */
import { createInitialState } from '../src/engine/createInitialState';
import { resolveTurn } from '../src/engine/resolveTurn';
import { aiActionPlan, aiPlacement } from '../src/ai/aiPlayer';
import { seededRng } from '../src/engine/rng';
import { unitTypes } from '../src/data/unitTypes';
import { ROSTER_SIZE } from '../src/data/constants';
import { isWithinAttackRange } from '../src/engine/targeting';
import { loadBoard } from './loadMap';
import type { AiDifficulty } from '../src/ai/difficulty';
import type { Owner } from '../src/engine/types';

const GAMES = Number(process.argv[2] ?? 400);
const DIFFICULTY = (process.argv[3] ?? 'hard') as AiDifficulty;
const MAP_ARG = process.argv[4] ?? 'garden';
const MAX_TURNS = 80;

const { name: mapName, board } = loadBoard(MAP_ARG);
const dealer3 = unitTypes.find((t) => t.id === 'dealer3')!;

interface Spec {
  attack?: number;
  range?: number;
  moveSpeed?: number;
  /** 체력 레벨. 기동력을 준 만큼 무르게 만들어 되갚는 안을 재려고 넣었다(maxHp = hpLv × 5). */
  hpLv?: number;
  label: string;
}

/** 현재 값. 스윕이 유닛 데이터를 제자리에서 바꾸므로 매 설정마다 여기서 되돌린다. */
const BASE = {
  attack: dealer3.attack,
  range: dealer3.attackShape.range,
  moveSpeed: dealer3.moveSpeed,
  hpLv: dealer3.hpLv,
};

/**
 * 기물 한 종의 판당 성적. **10종 전부에 대해** 모은다 — 조정 대상만 보면 "올랐다"까지밖에
 * 못 말하고, 그 상승분이 누구의 판당피해·점령체류를 깎아서 나온 것인지는 전원을 봐야 나온다.
 */
interface UnitStat {
  games: number;
  damage: number;
  healing: number;
  deaths: number;
  zoneTurns: number;
}

interface Result {
  label: string;
  points: Map<string, number>;
  stats: Map<string, UnitStat>;
  /** 사선·사거리 안에 적이 있던 턴의 비율. 사거리를 올린 게 **기회로 환전됐는지** 보는 창이다. */
  chanceRate: number;
  draws: number;
  turns: number;
}

function measure(spec: Spec): Result {
  const { attack, range, moveSpeed, hpLv, label } = { ...BASE, ...spec };
  dealer3.attack = attack;
  dealer3.attackShape.range = range;
  dealer3.moveSpeed = moveSpeed;
  dealer3.hpLv = hpLv;

  const wins = new Map<string, number>();
  const drawn = new Map<string, number>();
  const played = new Map<string, number>();
  const stats = new Map<string, UnitStat>();
  for (const t of unitTypes) {
    wins.set(t.id, 0);
    drawn.set(t.id, 0);
    played.set(t.id, 0);
    stats.set(t.id, { games: 0, damage: 0, healing: 0, deaths: 0, zoneTurns: 0 });
  }
  let drawCount = 0;
  let totalTurns = 0;
  let aliveTurns = 0;
  let chanceTurns = 0;

  for (let game = 0; game < GAMES; game++) {
    const rng = seededRng(1000 + game);
    const rosters: Record<Owner, string[]> = {
      p1: Array.from({ length: ROSTER_SIZE }, () => unitTypes[Math.floor(rng() * unitTypes.length)].id),
      p2: Array.from({ length: ROSTER_SIZE }, () => unitTypes[Math.floor(rng() * unitTypes.length)].id),
    };
    const state = createInitialState(
      rosters.p1,
      rosters.p2,
      aiPlacement(rosters.p1, 'p1', board, rng),
      aiPlacement(rosters.p2, 'p2', board, rng),
      board,
    );
    const typeOf = new Map(state.units.map((u) => [u.instanceId, u.typeId]));
    const zone = new Set(state.board.captureZone.map((c) => `${c.x},${c.y}`));
    // 판당 지표의 분모는 balanceSim과 **같은 기준**이어야 두 표를 나란히 읽을 수 있다:
    // "그 기물이 편성에 들어간 **팀-판** 수"다. 양 팀이 다 넣었으면 2로 센다 — 피해·점령체류는
    // 양쪽 인스턴스가 모두 쌓으므로 분모도 팀 단위여야 앞뒤가 맞는다. 판 단위로 세면 양 팀이
    // 함께 넣는 인기 기물일수록 분모만 작아져 판당 수치가 30%씩 부풀어 오른다.
    for (const owner of ['p1', 'p2'] as Owner[]) {
      for (const id of new Set(rosters[owner])) stats.get(id)!.games += 1;
    }
    /** 로그의 인스턴스 id를 기물 종류로 바꿔 누적한다. 포탑은 typeOf에 없어 자동으로 빠진다. */
    const bump = (id: string | undefined, f: (s: UnitStat) => void) => {
      const type = id && typeOf.get(id);
      if (type) f(stats.get(type)!);
    };

    let turn = 0;
    for (; turn < MAX_TURNS && state.phase !== 'gameOver'; turn++) {
      // 기회는 **해결 전** 상태에서 센다. 사거리·축만 보는 상한이라 아군이 사선을 막는 경우는
      // 빼지 않는다 — 상한조차 안 오르면 "사거리가 병목이 아니다"는 결론이 그만큼 단단해진다.
      for (const u of state.units) {
        if (u.typeId !== 'dealer3' || !u.alive || !u.position) continue;
        aliveTurns += 1;
        if (
          state.units.some(
            (e) => e.owner !== u.owner && e.alive && e.position &&
              isWithinAttackRange(u.position!, e.position, dealer3.attackShape, state.board),
          )
        ) {
          chanceTurns += 1;
        }
      }

      const log = resolveTurn(state, aiActionPlan(state, 'p1', DIFFICULTY, rng), aiActionPlan(state, 'p2', DIFFICULTY, rng), rng);
      for (const e of log) {
        if (e.type === 'hit' || e.type === 'dashDamage') bump(e.actorId, (s) => (s.damage += Number(e.detail?.damage ?? 0)));
        else if (e.type === 'heal') bump(e.actorId, (s) => (s.healing += Number(e.detail?.amount ?? 0)));
        // death 이벤트의 actorId는 **죽은 쪽**이다(가해자가 아니다) — balanceSim과 같은 기준.
        else if (e.type === 'death') bump(e.actorId, (s) => (s.deaths += 1));
      }
      for (const u of state.units) {
        if (u.alive && u.position && !u.isTurret && zone.has(`${u.position.x},${u.position.y}`)) {
          bump(u.instanceId, (s) => (s.zoneTurns += 1));
        }
      }
    }
    totalTurns += turn;

    const winner = state.winner;
    if (!winner) drawCount += 1;
    for (const owner of ['p1', 'p2'] as Owner[]) {
      for (const type of new Set(rosters[owner])) {
        played.set(type, played.get(type)! + 1);
        if (winner === owner) wins.set(type, wins.get(type)! + 1);
        if (!winner) drawn.set(type, drawn.get(type)! + 1);
      }
    }
  }

  const points = new Map<string, number>();
  for (const [id, n] of played) {
    points.set(id, n ? ((wins.get(id)! + drawn.get(id)! / 2) / n) * 100 : 50);
  }
  return {
    label,
    points,
    stats,
    chanceRate: aliveTurns ? (chanceTurns / aliveTurns) * 100 : 0,
    draws: drawCount,
    turns: totalTurns / GAMES,
  };
}

const nameOf = (id: string) => unitTypes.find((t) => t.id === id)!.name.replace(/^.*— /, '');

function spreadOf(r: Result): number {
  const v = [...r.points.values()].sort((a, b) => b - a);
  return v[0] - v[v.length - 1];
}

/** 1위부터 10위까지 전원을 기준선 대비 증감과 함께 찍는다. */
function report(r: Result, base: Result | null): void {
  const ranked = [...r.points.entries()].sort((a, b) => b[1] - a[1]);
  const spread = spreadOf(r);
  const spreadDelta = base ? spread - spreadOf(base) : null;
  const spreadText = spreadDelta === null ? '' : ` (기준선 대비 ${(spreadDelta >= 0 ? '+' : '') + spreadDelta.toFixed(1)}%p)`;

  console.log(`\n■ ${r.label}`);
  console.log(
    `  전체편차 ${spread.toFixed(1)}%p${spreadText} · 무승부 ${r.draws} · 평균 ${r.turns.toFixed(1)}턴 · ` +
      `dealer3 사선기회 ${r.chanceRate.toFixed(1)}%`,
  );
  console.log('   순위  기물                  승점률     증감      판당피해  판당회복  점령체류');
  ranked.forEach(([id, pts], i) => {
    const delta = base ? pts - base.points.get(id)! : null;
    const mark = delta === null ? '' : delta > 0.05 ? '▲' : delta < -0.05 ? '▼' : '·';
    const deltaText = delta === null ? '(기준선)' : `${mark} ${(delta >= 0 ? '+' : '') + delta.toFixed(1)}%p`;
    const star = id === 'dealer3' ? '*' : ' ';
    const s = r.stats.get(id)!;
    const per = (n: number) => (s.games ? n / s.games : 0).toFixed(1);
    console.log(
      `  ${star}${String(i + 1).padStart(3)}.  ${nameOf(id).padEnd(20)} ${(pts.toFixed(1) + '%').padStart(6)}   ${deltaText.padEnd(10)} ` +
        `${per(s.damage).padStart(8)} ${per(s.healing).padStart(9)} ${per(s.zoneTurns).padStart(9)}`,
    );
  });
}

/**
 * 손잡이는 **사거리와 공격력 둘뿐**이다(사용자 지정). 이동력·체력은 이제 고정값이라 후보에서
 * 뺐다 — Spec에 필드는 남겨 두었지만 예전 측정을 재현할 때만 쓴다.
 *
 * 사거리 상한을 6으로 보는 이유: dealer1은 **직선+대각** 6이라 조준 칸이 48칸인데, 직선 전용인
 * dealer3은 6이어도 24칸이다. 숫자가 같아져도 "더 멀리 보는 쪽"이라는 dealer1의 정체성은
 * 커버리지로 유지된다. 7은 그 숫자마저 넘으므로 채택 후보가 아니라 곡선 확인용 대조군이다.
 */
const cases: Spec[] = [
  { label: `현재 (공격${BASE.attack} · 직선 ${BASE.range}칸)` },
  { range: 5, label: '사거리 5' },
  { range: 6, label: '사거리 6' },
  { range: 7, label: '사거리 7 (대조군 — dealer1의 숫자를 넘음, 채택 후보 아님)' },
  { attack: 13, label: '공격 13 (화력만)' },
  { attack: 16, label: '공격 16 (화력만)' },
  { range: 5, attack: 13, label: '사거리 5 · 공격 13' },
  { range: 6, attack: 13, label: '사거리 6 · 공격 13' },
  // ── 2차: 1차에서 사거리를 올릴수록 판당피해는 오르는데 **점령체류가 같이 떨어졌다**
  //    (4칸 11.2턴 → 6칸 10.3턴 → 6칸·공격13 9.3턴). 사거리가 길면 AI가 점령지에서 멀찍이
  //    세워 두고, 이 게임의 승점은 피해가 아니라 점령지 인원에서 난다. 그렇다면 손잡이 방향이
  //    반대다 — **사거리를 줄여 전장 안으로 밀어 넣고 그 대가를 화력으로 치른다.**
  { range: 3, attack: 13, label: '사거리 3 · 공격 13' },
  { range: 3, attack: 16, label: '사거리 3 · 공격 16' },
  { range: 2, attack: 16, label: '사거리 2 · 공격 16' },
  { range: 2, attack: 20, label: '사거리 2 · 공격 20' },
];

/** 4번째 인자로 볼 설정 번호만 고른다(예: `1,2`). 0번(현재)은 기준선이라 항상 포함된다. */
const PICK = process.argv[5] ? new Set([0, ...process.argv[5].split(',').map(Number)]) : null;
const selected = cases.filter((_, i) => !PICK || PICK.has(i));

console.log(`\n=== dealer3 스윕 · ${GAMES}판 · 난이도 ${DIFFICULTY} · 맵 ${mapName} ===`);
console.log('모든 설정이 같은 시드 집합을 쓴다. * = dealer3');

let base: Result | null = null;
for (const c of selected) {
  const r = measure(c);
  report(r, base);
  if (!base) base = r;
}
console.log();
