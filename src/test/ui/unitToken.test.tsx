import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Board } from '../../components/Board/Board';
import { createUnitInstance } from '../../engine/createInitialState';
import { getUnitType } from '../../data/unitTypes';
import type { BoardConfig, UnitInstance } from '../../engine/types';

const board: BoardConfig = {
  width: 6,
  height: 6,
  obstacles: [],
  captureZone: [],
  startZones: { p1: [], p2: [] },
};

/**
 * 측면 보너스는 화면에 드러나야 하는 값이다 — 측정에서 표기 공격력 5인 이 기물의 실효가 8.18이고
 * 전체 피해의 36.3%가 이 패시브에서 나왔는데, 화면에는 아무 단서도 없었다.
 *
 * 실제 대전에서 이 조건을 만들려면 특정 편성이 뽑히고 적 둘이 붙어 서야 해서 브라우저로 재현하기가
 * 어렵다. 그래서 표시 자체를 여기서 잠근다.
 */
describe('측면 보너스 표시 — 조준 시점에 보이는가', () => {
  function scene(): { units: UnitInstance[]; attacker: UnitInstance; lone: UnitInstance; paired: UnitInstance } {
    // 공격자는 대각선으로 쏘므로(대각 3칸) 대각선 위에 대상을 둔다.
    const attacker = createUnitInstance('dealer4', 'p1', { x: 0, y: 0 });
    const lone = createUnitInstance('tank1', 'p2', { x: 1, y: 1 }); // 옆에 아무도 없다
    const paired = createUnitInstance('tank1', 'p2', { x: 2, y: 2 });
    // 발동에 필요한 인접 아군 수는 밸런스 조정 대상이라 데이터에서 읽는다 — 숫자를 박아 두면
    // 문턱을 올릴 때마다 규칙이 아니라 테스트가 깨진다.
    const needed = getUnitType('dealer4').passive!.payload!.minAdjacentAllies ?? 1;
    const around = [
      { x: 3, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 3 },
      { x: 2, y: 1 },
    ].slice(0, needed);
    const buddies = around.map((p) => createUnitInstance('tank1', 'p2', p));
    return { units: [attacker, lone, paired, ...buddies], attacker, lone, paired };
  }

  it('옆에 아군이 붙은 적에게만 보너스를 띄우고, 수치는 기물 데이터에서 온다', () => {
    const { units, attacker, lone, paired } = scene();
    const { container } = render(
      <Board
        board={board}
        units={units}
        selectedUnitId={attacker.instanceId}
        attackCells={[lone.position!, paired.position!]}
      />,
    );

    const bonus = getUnitType('dealer4').passive!.payload!.bonusDamage;
    const texts = [...container.querySelectorAll('text')].map((t) => t.textContent);
    // 숫자를 박지 않는다 — 밸런스 조정으로 7이 5가 됐을 때 화면만 옛 값을 띄우면 안 된다.
    expect(texts).toContain(`+${bonus}`);
    // 둘 다 사거리 안이지만 조건을 채운 쪽만 표시된다.
    expect(texts.filter((t) => t === `+${bonus}`)).toHaveLength(1);
  });

  it('사거리 밖의 적은 조건을 채워도 표시하지 않는다 — 조준 중인 칸만 칠한다', () => {
    const { units, attacker } = scene();
    const { container } = render(
      <Board board={board} units={units} selectedUnitId={attacker.instanceId} attackCells={[]} />,
    );
    const bonus = getUnitType('dealer4').passive!.payload!.bonusDamage;
    expect([...container.querySelectorAll('text')].map((t) => t.textContent)).not.toContain(`+${bonus}`);
  });

  it('패시브가 없는 기물을 고르면 아무것도 안 뜬다', () => {
    const { units, lone, paired } = scene();
    const other = createUnitInstance('dealer1', 'p1', { x: 0, y: 3 });
    const { container } = render(
      <Board
        board={board}
        units={[...units, other]}
        selectedUnitId={other.instanceId}
        attackCells={[lone.position!, paired.position!]}
      />,
    );
    expect([...container.querySelectorAll('text')].some((t) => t.textContent?.startsWith('+'))).toBe(false);
  });
});
