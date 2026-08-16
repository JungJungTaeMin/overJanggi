/**
 * dealer4가 왜 1등인지 — 화력과 기동을 갈라서 훑는다. 분석 도구다. 앱 번들에 안 들어간다.
 *
 * 발동률 측정(scripts/dealer4Flank.ts)에서 나온 사실: 측면 보너스는 명중의 61%에 붙고 피해의
 * 44.7%를 만든다. 실효 공격력이 표기 5가 아니라 9.56이다. 여기까지만 보면 "조건부 패시브가 사실상
 * 상시라서 세다"가 답 같지만, 같은 측정에서 더 큰 숫자가 하나 더 나왔다 — dealer4는 판당 5.8회
 * 명중하는데 dealer3은 2.5회다. 화력이 아니라 **때릴 기회의 수**가 다르다.
 *
 * 그래서 화력(보너스·공격력)과 기동(이동력·사거리·이동축·공격축)을 따로 깎아 보고, dealer4의
 * 승점률과 **전체 편차**를 같이 본다. dealer4만 내려오고 편차가 그대로면 병목은 다른 데 있는
 * 것이고, 편차까지 줄면 이 하나가 병목이었던 것이다.
 *
 * 공격축을 따로 훑는 이유: 이 기물은 대각선으로 **움직이면서** 대각선으로 **쏜다**. 두 축이 같으면
 * 조준이 거의 공짜다(aiPlayer.stepsToLineUp이 재는 그 비용이 0에 가깝다). 축을 어긋나게 두면
 * 이동 능력은 그대로 두면서 조준 비용만 되살릴 수 있다 — 기물의 정체성을 덜 건드리는 손잡이다.
 *
 * 실행: npx vite-node scripts/dealer4Sweep.ts [게임수] [난이도]
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

const GAMES = Number(process.argv[2] ?? 300);
const DIFFICULTY = (process.argv[3] ?? 'hard') as AiDifficulty;
const MAX_TURNS = 80;

const dealer4 = unitTypes.find((t) => t.id === 'dealer4')!;

interface Row {
  label: string;
  d4Points: number;
  d4Damage: number;
  spread: number;
  worst: string;
  best: string;
  draws: number;
}

interface Spec {
  attack?: number;
  bonus?: number;
  moveSpeed?: number;
  range?: number;
  /** 대각 이동을 끄면 사선 맞추기가 걸음당 2칸씩 느려진다(aiPlayer.stepsToLineUp 참고). */
  diagonalMove?: boolean;
  /** 공격축. 이동축(대각)과 어긋나게 두면 조준 비용이 생긴다. */
  axis?: 'orthogonal' | 'diagonal' | 'both';
  label: string;
}

const BASE = { attack: 5, bonus: 7, moveSpeed: 2, range: 3, diagonalMove: true, axis: 'diagonal' as const };

function measure(spec: Spec): Row {
  const { attack, bonus, moveSpeed, range, diagonalMove, axis, label } = { ...BASE, ...spec };
  dealer4.attack = attack;
  dealer4.passive!.payload!.bonusDamage = bonus;
  dealer4.moveSpeed = moveSpeed;
  dealer4.attackShape.range = range;
  dealer4.attackShape.axis = axis;
  dealer4.diagonalMove = diagonalMove;

  const wins = new Map<string, number>();
  const draws = new Map<string, number>();
  const played = new Map<string, number>();
  for (const t of unitTypes) {
    wins.set(t.id, 0);
    draws.set(t.id, 0);
    played.set(t.id, 0);
  }
  let d4Damage = 0;
  let d4Games = 0;
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
    const hasD4 = rosters.p1.includes('dealer4') || rosters.p2.includes('dealer4');
    if (hasD4) d4Games += 1;

    for (let turn = 0; turn < MAX_TURNS && state.phase !== 'gameOver'; turn++) {
      const log = resolveTurn(state, aiActionPlan(state, 'p1', DIFFICULTY, rng), aiActionPlan(state, 'p2', DIFFICULTY, rng), rng);
      for (const e of log) {
        if ((e.type === 'hit' || e.type === 'dashDamage') && typeOf.get(e.actorId ?? '') === 'dealer4') {
          d4Damage += Number(e.detail?.damage ?? 0);
        }
      }
    }

    const winner = state.winner;
    if (!winner) drawCount += 1;
    for (const owner of ['p1', 'p2'] as Owner[]) {
      for (const type of new Set(rosters[owner])) {
        played.set(type, played.get(type)! + 1);
        if (winner === owner) wins.set(type, wins.get(type)! + 1);
        if (!winner) draws.set(type, draws.get(type)! + 1);
      }
    }
  }

  const points = [...played.entries()].map(([id, n]) => ({
    id,
    pts: n ? ((wins.get(id)! + draws.get(id)! / 2) / n) * 100 : 50,
  }));
  points.sort((a, b) => b.pts - a.pts);
  const nameOf = (id: string) => unitTypes.find((t) => t.id === id)!.name.replace(/^.*— /, '');

  return {
    label,
    d4Points: points.find((p) => p.id === 'dealer4')!.pts,
    d4Damage: d4Games ? d4Damage / d4Games : 0,
    spread: points[0].pts - points[points.length - 1].pts,
    best: `${nameOf(points[0].id)} ${points[0].pts.toFixed(1)}`,
    worst: `${nameOf(points[points.length - 1].id)} ${points[points.length - 1].pts.toFixed(1)}`,
    draws: drawCount,
  };
}

/**
 * 화력(보너스·공격력)과 기동(이동력·사거리·대각 이동)을 갈라서 훑는다.
 *
 * 화력만 만져서는 순위가 안 잡힌다는 게 1차 스윕에서 나왔다 — 패시브를 아예 없애도(5+0) dealer4가
 * 56.2%로 여전히 1위였다. 발동률 측정에서 나온 판당 명중 5.8회(dealer3은 2.5회)가 진짜 원인이라면
 * 기동을 깎을 때 화력을 깎을 때보다 승점이 더 크게 떨어져야 한다.
 */
const cases: Spec[] = [
  { label: '현재 (5+7 · 이동2 · 사거리3)' },
  { bonus: 5, label: '보너스 5' },
  { bonus: 3, label: '보너스 3' },
  { bonus: 0, label: '보너스 0' },
  { bonus: 0, attack: 7, label: '보너스 0 · 공격 7' },
  { moveSpeed: 1, label: '이동 1' },
  { range: 2, label: '사거리 2' },
  { diagonalMove: false, label: '대각 이동 불가' },
  { moveSpeed: 1, bonus: 3, label: '이동 1 · 보너스 3' },
  { axis: 'orthogonal', label: '공격축 직선 (이동은 대각)' },
  { axis: 'orthogonal', bonus: 3, label: '공격축 직선 · 보너스 3' },
  { axis: 'orthogonal', range: 4, label: '공격축 직선 · 사거리 4' },
];

console.log(`\n=== dealer4 스윕 · ${GAMES}판 · 난이도 ${DIFFICULTY} ===\n`);
console.log('설정                          dealer4 승점  판당피해   전체편차   1위                 10위                무승부');
for (const c of cases) {
  const r = measure(c);
  console.log(
    `${r.label.padEnd(28)} ${(r.d4Points.toFixed(1) + '%').padStart(11)} ${r.d4Damage.toFixed(1).padStart(9)} ` +
      `${(r.spread.toFixed(1) + '%p').padStart(10)}   ${r.best.padEnd(19)} ${r.worst.padEnd(19)} ${String(r.draws).padStart(5)}`,
  );
}
console.log('\n힌트: dealer4만 내려오고 전체편차가 그대로면 병목은 다른 데 있다. 편차까지 줄면 이게 병목이었다.');
console.log();
