import { describe, expect, it } from 'vitest';
import { unitTypes, getUnitType } from '../../data/unitTypes';
import { CAPTURE_MARGIN } from '../../data/constants';
import { captureWinner } from '../../engine/capture';
import { DIAGRAM_ORIGIN, DIAGRAM_RADIUS, unitDiagram } from '../../components/Guide/rangeDiagram';
import { attackPowerLabel, attackRangeLabel, moveRangeLabel } from '../../components/statLabels';

/**
 * 도움말 그림이 틀리면 차라리 없느니만 못하다 — 처음 온 사람은 그림을 규칙으로 믿고 배우기 때문에,
 * 그림과 엔진이 어긋나면 "설명대로 눌렀는데 안 된다"가 된다. 그래서 그림은 엔진 함수로 계산하고,
 * 여기서는 **그 계산이 각 기물의 실제 스탯과 맞는지**를 못 박는다.
 */

type Cells = ReturnType<typeof unitDiagram>['cells'];

/** 기물 자리를 (0,0)으로 놓고 상대 좌표로 읽는다 — 표시가 없는 칸은 목록에 아예 없으므로 false다. */
const at = (cells: Cells, dx: number, dy: number, kind: keyof Omit<Cells[number], 'position'>) =>
  cells.find((c) => c.position.x === DIAGRAM_ORIGIN.x + dx && c.position.y === DIAGRAM_ORIGIN.y + dy)?.[kind] ?? false;

describe('기물 그림 — 엔진이 정한 칸과 같은가', () => {
  it('모든 기물이 이동 칸을 갖고, 판은 가장 멀리 닿는 기물까지 담는다', () => {
    for (const t of unitTypes) {
      const { cells } = unitDiagram(t);
      expect(cells.some((c) => c.move), t.id).toBe(true);
      // 사거리가 판 밖으로 잘리면 그림이 실제보다 짧아 보인다.
      expect(DIAGRAM_RADIUS, t.id).toBeGreaterThanOrEqual(t.attackShape.range);
    }
  });

  it('이동 축이 그림에 그대로 나온다 — 대각 이동이 없는 기물은 대각 칸이 비어 있다', () => {
    const tank1 = unitDiagram(getUnitType('tank1')); // 이동 1, 직선만
    expect(at(tank1.cells, 1, 0, 'move')).toBe(true);
    expect(at(tank1.cells, 1, 1, 'move')).toBe(false);
    expect(tank1.cells.filter((c) => c.move)).toHaveLength(4); // 상하좌우 한 칸씩

    const dealer3 = unitDiagram(getUnitType('dealer3')); // 이동 1, 직선+대각
    expect(at(dealer3.cells, 1, 1, 'move')).toBe(true);
    expect(dealer3.cells.filter((c) => c.move)).toHaveLength(8);
  });

  it('축마다 사거리가 다른 기물(dealer3)은 그림에서도 다르게 나온다', () => {
    const { cells } = unitDiagram(getUnitType('dealer3')); // 직선 4 · 대각선 1
    expect(at(cells, 4, 0, 'attack')).toBe(true);
    expect(at(cells, 1, 1, 'attack')).toBe(true);
    expect(at(cells, 2, 2, 'attack')).toBe(false);
    expect(attackRangeLabel(getUnitType('dealer3'))).toBe('직선 4칸 · 대각선 1칸');
  });

  it('공격할 수 없는 기물은 공격 칸 대신 회복 칸을 보여 준다', () => {
    const support2 = getUnitType('support2');
    const { cells } = unitDiagram(support2);
    expect(cells.some((c) => c.attack)).toBe(false);
    expect(attackRangeLabel(support2)).toBe('공격 불가');
    // 이 기물의 진짜 사정권은 회복 직선 5칸이다. 이걸 빼면 이동 1칸짜리 그림만 남아 거짓말이 된다.
    expect(at(cells, 0, -5, 'heal')).toBe(true);
    expect(at(cells, 1, 1, 'heal')).toBe(false);
  });

  it('범위 회복(support1)은 반경으로, 범위 공격(tank3)은 밴드로 그려진다', () => {
    const support1 = unitDiagram(getUnitType('support1'));
    expect(at(support1.cells, 2, 2, 'heal')).toBe(true); // 반경 2 = 체비셰프
    expect(at(support1.cells, 3, 0, 'heal')).toBe(false);

    const tank3 = unitDiagram(getUnitType('tank3'));
    // 방향당 앞 1칸 + 좌우 1칸이고 네 방향의 모서리가 서로 겹쳐, 사정권은 인접 8칸이 된다.
    // 실제로 한 번에 맞는 건 그중 3칸뿐 — 그림은 사정권이지 한 방의 범위가 아니다(도움말에 명시).
    expect(tank3.cells.filter((c) => c.attack)).toHaveLength(8);
    expect(at(tank3.cells, 0, -1, 'attack')).toBe(true);
    expect(at(tank3.cells, 1, -1, 'attack')).toBe(true);
    expect(at(tank3.cells, 0, -2, 'attack')).toBe(false);
  });

  it('동전으로 이동력이 갈리는 기물은 "운이 좋아야 닿는 칸"을 따로 칠한다', () => {
    const support3 = getUnitType('support3');
    const { cells, extraMoveSpeed } = unitDiagram(support3);
    // 앞면/뒷면 값은 밸런스 조정 대상이라 숫자를 박지 않는다 — 여기서 재는 건 특정 칸수가 아니라
    // **뒷면으로 닿는 칸과 앞면이라야 닿는 칸이 다르게 칠해지는가**다.
    const { tailsMove, headsMove } = support3.passive!.payload!;
    expect(extraMoveSpeed).toBe(headsMove);
    expect(headsMove).toBeGreaterThan(tailsMove);
    expect(at(cells, tailsMove, 0, 'move')).toBe(true);
    expect(at(cells, headsMove, 0, 'move')).toBe(false);
    expect(at(cells, headsMove, 0, 'extraMove')).toBe(true);
    expect(moveRangeLabel(support3)).toBe(`직선 ${tailsMove} 또는 ${headsMove}칸(동전)`);
  });
  it('동전으로 갈리는 스탯은 라벨에도 범위로 적힌다 — 뒷면 값만 보이면 화면이 스탯을 낮게 말한다', () => {
    const support3 = getUnitType('support3');
    const { tailsAttack, headsAttack } = support3.passive!.payload!;
    expect(attackPowerLabel(support3)).toBe(`${tailsAttack} 또는 ${headsAttack}(동전)`);
    // 동전이 없는 기물은 그냥 숫자다.
    expect(attackPowerLabel(getUnitType('tank1'))).toBe(String(getUnitType('tank1').attack));
    // 공격을 못 하는 기물은 숫자가 아니라 —.
    expect(attackPowerLabel(getUnitType('support2'))).toBe('—');
  });
});

/**
 * 점령 규칙은 설명하기 가장 어려운 규칙이고(인원 차 2 이상 + 무저항 예외), 그래서 도움말이 가장
 * 필요한 곳이다. 도움말과 엔진이 같은 함수를 부르는지를 여기서 확인한다.
 */
describe('점령 점수 규칙', () => {
  it('상대가 없으면 한 명으로도 점수가 난다', () => {
    expect(captureWinner({ p1: 1, p2: 0 })).toBe('p1');
    expect(captureWinner({ p1: 0, p2: 3 })).toBe('p2');
  });

  it('상대가 있으면 인원 차가 기준치 이상이어야 한다', () => {
    expect(captureWinner({ p1: 2, p2: 1 })).toBeNull(); // 한 명 차이는 경합
    expect(captureWinner({ p1: 1 + CAPTURE_MARGIN, p2: 1 })).toBe('p1');
    expect(captureWinner({ p1: 5, p2: 3 })).toBe('p1');
  });

  it('아무도 없거나 동수면 점수가 나지 않는다', () => {
    expect(captureWinner({ p1: 0, p2: 0 })).toBeNull();
    expect(captureWinner({ p1: 2, p2: 2 })).toBeNull();
  });
});
