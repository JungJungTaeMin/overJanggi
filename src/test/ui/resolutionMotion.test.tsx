import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Board, CELL_SIZE } from '../../components/Board/Board';
import { resolveTurn } from '../../engine/resolveTurn';
import { compactReplay, type ResolutionStep } from '../../engine/replay';
import { stepVisuals } from '../../components/Board/resolutionMarkers';
import type { BoardConfig } from '../../engine/types';
import { addUnit, emptyPlan, emptyState, plan, rngFor } from '../engine/helpers';

/**
 * **"죽었을 때 모션이 있었으면 좋겠어. 또한 공격 모션도 — 총알이 나간다든가."**
 *
 * 두 요청은 같은 결함의 두 얼굴이다. 단계별 재생을 붙여 놨는데도 공격 단계는 여전히 **정지 화면
 * 두 장**이었다. 화살표 선은 「A가 B를 때렸다」는 *결과*지 때리는 *순간*이 아니고, 죽은 기물은
 * 좌표를 잃어 그냥 사라지는데 — 눈은 없어진 것을 못 본다.
 *
 * 애니메이션 자체는 CSS라 jsdom에서 볼 수 없다. 그래서 여기서 잠그는 것은 **연출이 붙을 자리와
 * 근거**다: 탄이 갈 곳을 알고 있는지, 격추 연출이 누구 것인지 알고 있는지, 그리고 단계가 넘어갈
 * 때 노드가 재사용되어 애니메이션이 조용히 안 도는 일이 없는지.
 */
const board: BoardConfig = {
  width: 7,
  height: 7,
  obstacles: [],
  captureZone: [],
  startZones: { p1: [{ x: 0, y: 0 }], p2: [{ x: 6, y: 6 }] },
};

function replayOf(run: (capture: (step: ResolutionStep) => void) => void): ResolutionStep[] {
  const steps: ResolutionStep[] = [];
  run((step) => steps.push(step));
  return compactReplay(steps);
}

function visualsAt(steps: ResolutionStep[], phase: ResolutionStep['phase']) {
  const index = steps.findIndex((s) => s.phase === phase);
  expect(index).toBeGreaterThanOrEqual(0);
  return { ...stepVisuals(steps[index], index > 0 ? steps[index - 1].units : []), units: steps[index].units };
}

describe('공격 모션 — 탄이 실제로 날아간다', () => {
  it('탄에 쏜 자리에서 맞은 자리까지의 이동량을 실어 보낸다', () => {
    // 좌표가 매번 달라 keyframe을 미리 만들 수 없다. 이동량을 CSS 변수로 넘기지 않으면
    // 애니메이션은 붙되 **제자리에서** 돌아, 있으나 마나 한 연출이 된다.
    const { container } = render(
      <Board
        board={board}
        units={[]}
        rays={[{ key: 'r', from: { x: 1, y: 1 }, to: { x: 4, y: 1 }, kind: 'hit' }]}
      />,
    );

    const bullet = container.querySelector('.board-bullet') as SVGElement | null;
    expect(bullet).not.toBeNull();
    // 출발점은 쏜 칸의 중심.
    expect(bullet!.getAttribute('cx')).toBe(String(1 * CELL_SIZE + CELL_SIZE / 2));
    // 이동량은 두 칸 중심 사이의 거리 — 세 칸을 오른쪽으로.
    expect(bullet!.style.getPropertyValue('--fly-x')).toBe(`${3 * CELL_SIZE}px`);
    expect(bullet!.style.getPropertyValue('--fly-y')).toBe('0px');
  });

  it('맞은 자리에 충격 표시를 남긴다 — 탄이 도착한 곳이 곧 그 자리다', () => {
    const { container } = render(
      <Board
        board={board}
        units={[]}
        rays={[{ key: 'r', from: { x: 0, y: 0 }, to: { x: 0, y: 3 }, kind: 'hit' }]}
      />,
    );

    const impact = container.querySelector('.board-impact') as SVGElement | null;
    expect(impact).not.toBeNull();
    expect(impact!.getAttribute('cx')).toBe(String(CELL_SIZE / 2));
    expect(impact!.getAttribute('cy')).toBe(String(3 * CELL_SIZE + CELL_SIZE / 2));
  });

  it('판을 뒤집어 보는 쪽에서는 탄도 뒤집혀 날아간다', () => {
    // 연출이 좌표 변환을 따로 하면 게스트 화면에서만 엉뚱한 방향으로 날아간다.
    const { container } = render(
      <Board
        board={board}
        units={[]}
        flipped
        rays={[{ key: 'r', from: { x: 1, y: 1 }, to: { x: 4, y: 1 }, kind: 'hit' }]}
      />,
    );

    const bullet = container.querySelector('.board-bullet') as SVGElement;
    expect(bullet.style.getPropertyValue('--fly-x')).toBe(`${-3 * CELL_SIZE}px`);
  });

  it('실제 공격 한 번이 탄 하나를 만든다 — 빗나가면 만들지 않는다', () => {
    const hit = emptyState(board);
    const shooter = addUnit(hit, 'dealer1', 'p1', { x: 0, y: 0 });
    addUnit(hit, 'tank1', 'p2', { x: 3, y: 0 });
    const attack = { baseAction: { kind: 'attack' as const, direction: 'right' as const } };

    const withTarget = visualsAt(
      replayOf((c) => resolveTurn(hit, plan('p1', 1, { [shooter.instanceId]: attack }), emptyPlan('p2', 1), rngFor('p1'), c)),
      'attack',
    );
    expect(withTarget.rays.filter((r) => r.kind === 'hit')).toHaveLength(1);

    const empty = emptyState(board);
    const lonely = addUnit(empty, 'dealer1', 'p1', { x: 0, y: 0 });
    const noTarget = visualsAt(
      replayOf((c) => resolveTurn(empty, plan('p1', 1, { [lonely.instanceId]: attack }), emptyPlan('p2', 1), rngFor('p1'), c)),
      'attack',
    );
    // 아무도 안 맞았는데 탄이 날아가면 화면이 없던 명중을 지어낸다.
    expect(noTarget.rays).toHaveLength(0);
  });
});

describe('격추 모션 — 사라짐을 사건으로', () => {
  it('격추 표시가 죽은 기물의 정체를 들고 있다 — 색이 여기서 나온다', () => {
    // 죽으면 position이 null이라 판에서 즉시 사라진다. 표시 쪽이 안 들고 있으면 "누구 것이
    // 죽었는가"를 화면에서 되찾을 방법이 없다 — 재생 중에 가장 급한 판단이 바로 그것이다.
    const state = emptyState(board);
    const attacker = addUnit(state, 'dealer1', 'p1', { x: 0, y: 0 });
    const victim = addUnit(state, 'support2', 'p2', { x: 2, y: 0 });
    victim.currentHp = 1;

    const { marks } = visualsAt(
      replayOf((c) =>
        resolveTurn(
          state,
          plan('p1', 1, { [attacker.instanceId]: { baseAction: { kind: 'attack', direction: 'right' } } }),
          emptyPlan('p2', 1),
          rngFor('p1'),
          c,
        ),
      ),
      'attack',
    );

    const death = marks.find((m) => m.kind === 'death');
    expect(death?.unitId).toBe(victim.instanceId);
    expect(victim.position).toBeNull();
  });

  it('죽은 기물의 편 색으로 터진다', () => {
    const dead = { ...addUnit(emptyState(board), 'tank1', 'p2', null) };
    const { container } = render(
      <Board
        board={board}
        units={[dead]}
        marks={[{ key: 'd', position: { x: 2, y: 2 }, kind: 'death', text: '격추', unitId: dead.instanceId }]}
      />,
    );

    const ring = container.querySelector('.death-ring circle');
    expect(ring).not.toBeNull();
    expect(ring!.getAttribute('stroke')).toBe('#dc2626'); // p2 = 빨강
    expect(container.querySelectorAll('.death-shards line').length).toBeGreaterThan(0);
  });

  it('격추가 없으면 아무것도 안 터진다', () => {
    const { container } = render(
      <Board board={board} units={[]} marks={[{ key: 'x', position: { x: 1, y: 1 }, kind: 'damage', text: '-8' }]} />,
    );
    expect(container.querySelector('.death-ring')).toBeNull();
  });
});

describe('단계가 넘어가도 연출이 다시 돈다', () => {
  it('표시·선 키에 단계 이름이 들어간다', () => {
    /**
     * React는 같은 키를 같은 DOM 노드로 재사용하고, 재사용된 노드는 **CSS 애니메이션을 다시
     * 시작하지 않는다.** 예전 키는 이벤트 순번뿐이라 공격 단계의 `ray-0`과 회복 단계의 `ray-0`이
     * 같은 노드였다 — 탄이 하필 두 번째 단계부터 조용히 안 날아가는, 눈으로 찾기 어려운 버그다.
     */
    const state = emptyState(board);
    const healer = addUnit(state, 'support2', 'p1', { x: 0, y: 0 });
    const hurt = addUnit(state, 'tank1', 'p1', { x: 0, y: 2 });
    const foe = addUnit(state, 'dealer1', 'p2', { x: 4, y: 4 });
    hurt.currentHp = 1;

    const steps = replayOf((c) =>
      resolveTurn(
        state,
        plan('p1', 1, {
          [healer.instanceId]: {
            baseAction: { kind: 'none' },
            skillUse: { skillId: 'support2_heal', target: hurt.instanceId },
          },
        }),
        plan('p2', 1, { [foe.instanceId]: { baseAction: { kind: 'none' } } }),
        rngFor('p1'),
        c,
      ),
    );

    const healRays = visualsAt(steps, 'heal').rays;
    expect(healRays.length).toBeGreaterThan(0);
    expect(healRays.every((r) => r.key.startsWith('heal-'))).toBe(true);

    // 서로 다른 단계의 키가 겹치지 않는다는 것이 요점이다.
    const allKeys = steps.flatMap((s, i) => {
      const v = stepVisuals(s, i > 0 ? steps[i - 1].units : []);
      return [...v.marks.map((m) => m.key), ...v.rays.map((r) => r.key)];
    });
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });
});
