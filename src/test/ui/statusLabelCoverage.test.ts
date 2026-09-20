import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../engine/createInitialState';
import { resolveTurn } from '../../engine/resolveTurn';
import { aiActionPlan } from '../../ai/aiPlayer';
import { mapDefinition } from '../../data/mapDefinitions';
import { unitTypes } from '../../data/unitTypes';
import { STATUS_LABEL } from '../../components/effectLabels';
import type { GameState, Owner, Position } from '../../engine/types';

/**
 * **화면에 엔진 식별자가 새어 나오지 않는지.**
 *
 * `statusLabel()`은 모르는 식별자를 감추지 않고 그대로 내보낸다 — 조용히 사라지면 빠진 걸 눈치챌
 * 수 없기 때문이다(effectLabels.ts). 실제로 그 설계 덕에 상태 표에서 `hpBuff, moveBonus`를 눈으로
 * 발견했다. 하지만 **눈으로 발견하는 데 기대는 건 새 상태이상을 넣을 때마다 운에 맡기는 것**이다.
 *
 * 그래서 라벨 표를 손으로 베껴 적고 대조하는 대신, **실제로 게임을 돌린다.** 모든 기물이 한 번씩은
 * 나오도록 편성을 나눠 AI 대 AI를 여러 판 굴리면서, 어느 기물에든 붙은 상태이상의 type을 전부 모아
 * 라벨이 있는지 본다. 목록을 테스트가 따로 들고 있지 않으므로 엔진에 새 상태이상이 생기면 여기서
 * 저절로 잡힌다.
 *
 * 반대로 이 테스트는 **한 번도 안 붙는 상태이상은 못 잡는다.** 그건 감수한다 — 화면에 뜬 적이 없다는
 * 뜻이라 애초에 문제가 아니고, 억지로 잡으려면 결국 목록을 베껴 적는 수밖에 없다.
 */
describe('상태이상 표시 이름 — 화면에 raw id가 새지 않는다', () => {
  function playOut(rosterP1: string[], rosterP2: string[], turns: number): Set<string> {
    const seen = new Set<string>();
    // resolveTurn은 state를 제자리에서 고치고 로그를 돌려준다 — 반환값을 state로 받으면 안 된다.
    const state: GameState = createInitialState(
      rosterP1,
      rosterP2,
      mapDefinition.startZones.p1.slice(0, rosterP1.length) as Position[],
      mapDefinition.startZones.p2.slice(0, rosterP2.length) as Position[],
      mapDefinition,
    );

    // 고정 시드. 실패가 재현되지 않으면 고칠 수가 없다.
    let seed = 20260828;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let i = 0; i < turns && !state.winner; i++) {
      // 양쪽 계획은 **해결 전 같은 판**을 보고 세워야 한다 — 동시 턴이므로.
      const plans = (['p1', 'p2'] as Owner[]).map((o) => aiActionPlan(state, o, 'hard', rng));
      resolveTurn(state, plans[0], plans[1], rng);
      for (const unit of state.units) {
        for (const effect of unit.statusEffects) seen.add(effect.type);
      }
    }
    return seen;
  }

  it('모든 기물을 굴려도 이름 없는 상태이상이 나오지 않는다', () => {
    const all = unitTypes.map((t) => t.id);
    /**
     * 한 판에는 6기물만 설 수 있으므로 6종씩 잘라 **묶음끼리 돌려가며** 붙인다(A vs B, B vs C,
     * C vs A …). 예전에는 그냥 반으로 갈랐는데, 기물이 12종에서 18종으로 늘자 한 편이 9기물이
     * 되어 편성 규칙을 넘겼다 — 기물 수를 세는 곳이 여기 하나뿐이면 그런 식으로 조용히 어긋난다.
     * 이렇게 두면 기물이 몇 종으로 늘어도 모든 기물이 최소 두 판에 나온다.
     */
    const SIZE = 6;
    const groups: string[][] = [];
    for (let i = 0; i < all.length; i += SIZE) groups.push(all.slice(i, i + SIZE));
    const seen = new Set<string>();
    for (let i = 0; i < groups.length; i++) {
      const a = groups[i];
      const b = groups[(i + 1) % groups.length];
      for (const type of playOut(a, b, 40)) seen.add(type);
    }

    // 아무것도 안 걸린 채로 통과하면 테스트가 있으나 마나다 — 실제로 상태이상이 붙었는지 먼저 본다.
    expect(seen.size).toBeGreaterThan(3);

    const unlabeled = [...seen].filter((type) => !(type in STATUS_LABEL));
    expect(unlabeled, `effectLabels.ts에 한글 이름이 없는 상태이상: ${unlabeled.join(', ')}`).toEqual([]);
  });
});
