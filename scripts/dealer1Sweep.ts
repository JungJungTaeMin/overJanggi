/**
 * dealer1(장거리 화력형)의 공격축과 공격력을 훑는다. 분석 도구다. 앱 번들에 안 들어간다.
 *
 * 왜 이 두 개인가: 탄창식(2발·1턴 휴식)으로 바꿔 발사 가능 턴을 1/3에서 2/3로 **두 배**로 늘렸는데
 * 판당피해는 6.7 → 8.6으로 28%밖에 안 늘었다. 쿨다운은 병목이 아니었다는 뜻이다. 남은 후보는
 * 두 가지다 — 사선에 적이 안 들어오거나(축), 들어와도 한 발이 가벼워서 아무것도 못 죽이거나(화력).
 * 축은 기회의 수를, 공격력은 기회당 값어치를 건드리므로 두 손잡이는 서로 독립이다.
 *
 * 보고 방식: 매 설정마다 **1위부터 10위까지 전원**을 기준선(현재 설정) 대비 증감과 함께 찍는다.
 * dealer1만 보면 "올라갔다"까지밖에 못 말한다 — 누구를 밟고 올라갔는지, 전체 편차가 벌어졌는지
 * 좁혀졌는지는 10종을 다 봐야 나온다. 모든 설정이 같은 시드 집합(seededRng(1000+game))을 쓰므로
 * 설정 간 차이는 편성 운이 아니라 설정 때문이다.
 *
 * 실행: npx vite-node scripts/dealer1Sweep.ts [게임수] [난이도]
 */
import { createInitialState } from '../src/engine/createInitialState';
import { resolveTurn } from '../src/engine/resolveTurn';
import { aiActionPlan, aiPlacement } from '../src/ai/aiPlayer';
import { seededRng } from '../src/engine/rng';
import { mapDefinition } from '../src/data/mapDefinitions';
import { unitTypes } from '../src/data/unitTypes';
import { ROSTER_SIZE } from '../src/data/constants';
import type { AiDifficulty } from '../src/ai/difficulty';
import type { Owner } from '../src/engine/types';

const GAMES = Number(process.argv[2] ?? 400);
const DIFFICULTY = (process.argv[3] ?? 'hard') as AiDifficulty;
const MAX_TURNS = 80;

const dealer1 = unitTypes.find((t) => t.id === 'dealer1')!;

interface Spec {
  attack?: number;
  range?: number;
  axis?: 'orthogonal' | 'diagonal' | 'both';
  /** 이동력. 축을 넓혀도 전장에 못 가는 게 원인이라면 이쪽이 답이다. */
  moveSpeed?: number;
  label: string;
}

const BASE = { attack: 8, range: 6, axis: 'orthogonal' as const, moveSpeed: 1 };

interface Result {
  label: string;
  points: Map<string, number>;
  d1Damage: number;
  d1Zone: number;
  draws: number;
}

function measure(spec: Spec): Result {
  const { attack, range, axis, moveSpeed, label } = { ...BASE, ...spec };
  dealer1.attack = attack;
  dealer1.attackShape.range = range;
  dealer1.attackShape.axis = axis;
  dealer1.moveSpeed = moveSpeed;

  const wins = new Map<string, number>();
  const drawn = new Map<string, number>();
  const played = new Map<string, number>();
  for (const t of unitTypes) {
    wins.set(t.id, 0);
    drawn.set(t.id, 0);
    played.set(t.id, 0);
  }
  let d1Damage = 0;
  let d1Zone = 0;
  let d1Games = 0;
  let drawCount = 0;

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
    const zone = new Set(state.board.captureZone.map((c) => `${c.x},${c.y}`));
    if (rosters.p1.includes('dealer1') || rosters.p2.includes('dealer1')) d1Games += 1;

    for (let turn = 0; turn < MAX_TURNS && state.phase !== 'gameOver'; turn++) {
      const log = resolveTurn(state, aiActionPlan(state, 'p1', DIFFICULTY, rng), aiActionPlan(state, 'p2', DIFFICULTY, rng), rng);
      for (const e of log) {
        if ((e.type === 'hit' || e.type === 'dashDamage') && typeOf.get(e.actorId ?? '') === 'dealer1') {
          d1Damage += Number(e.detail?.damage ?? 0);
        }
      }
      for (const u of state.units) {
        if (u.alive && u.position && u.typeId === 'dealer1' && zone.has(`${u.position.x},${u.position.y}`)) d1Zone += 1;
      }
    }

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
  return { label, points, d1Damage: d1Games ? d1Damage / d1Games : 0, d1Zone: d1Games ? d1Zone / d1Games : 0, draws: drawCount };
}

const nameOf = (id: string) => unitTypes.find((t) => t.id === id)!.name.replace(/^.*— /, '');

/** 1위부터 10위까지 전원을 기준선 대비 증감과 함께 찍는다. */
function report(r: Result, base: Result | null): void {
  const ranked = [...r.points.entries()].sort((a, b) => b[1] - a[1]);
  const spread = ranked[0][1] - ranked[ranked.length - 1][1];

  console.log(`\n■ ${r.label}`);
  const spreadDelta = base ? spread - baseSpread(base) : null;
  const spreadText =
    spreadDelta === null ? '' : ` (기준선 대비 ${(spreadDelta >= 0 ? '+' : '') + spreadDelta.toFixed(1)}%p)`;
  console.log(
    `  dealer1 판당피해 ${r.d1Damage.toFixed(1)} · 점령체류 ${r.d1Zone.toFixed(1)}턴 · ` +
      `전체편차 ${spread.toFixed(1)}%p${spreadText} · 무승부 ${r.draws}`,
  );
  console.log('   순위  기물                  승점      증감');
  ranked.forEach(([id, pts], i) => {
    const delta = base ? pts - base.points.get(id)! : null;
    const mark = delta === null ? '' : delta > 0.05 ? '▲' : delta < -0.05 ? '▼' : '·';
    const deltaText = delta === null ? '(기준선)' : `${mark} ${(delta >= 0 ? '+' : '') + delta.toFixed(1)}%p`;
    const star = id === 'dealer1' ? '*' : ' ';
    console.log(`  ${star}${String(i + 1).padStart(3)}.  ${nameOf(id).padEnd(20)} ${(pts.toFixed(1) + '%').padStart(6)}   ${deltaText}`);
  });
}

function baseSpread(base: Result): number {
  const v = [...base.points.values()].sort((a, b) => b - a);
  return v[0] - v[v.length - 1];
}

const cases: Spec[] = [
  { label: '현재 (공격8 · 직선6 · 이동1)' },
  { axis: 'both', label: '축: 직선+대각 6' },
  { axis: 'both', range: 5, label: '축: 직선+대각 5 (사거리 한 칸 반납)' },
  { attack: 10, label: '공격 10' },
  { attack: 12, label: '공격 12' },
  { axis: 'both', attack: 10, label: '축 직선+대각 6 · 공격 10' },
  { axis: 'both', range: 5, attack: 10, label: '축 직선+대각 5 · 공격 10' },
  { moveSpeed: 2, label: '이동 2 (대조군 — 축·화력 대신 발)' },
];

/**
 * 4번째 인자로 볼 설정 번호만 고른다(예: `0,1,3,5`). 0번(현재 설정)은 기준선이므로 항상 포함된다.
 * 후보가 좁혀진 뒤 표본만 키워 다시 재려고 넣었다 — 400판에서 ±2.7%p면 3%p짜리 차이는 못 가른다.
 */
const PICK = process.argv[4]
  ? new Set([0, ...process.argv[4].split(',').map(Number)])
  : null;
const selected = cases.filter((_, i) => !PICK || PICK.has(i));

console.log(`\n=== dealer1 스윕 · ${GAMES}판 · 난이도 ${DIFFICULTY} ===`);
console.log('모든 설정이 같은 시드 집합을 쓴다. * = dealer1');

let base: Result | null = null;
for (const c of selected) {
  const r = measure(c);
  report(r, base);
  if (!base) base = r;
}
console.log();
