import type { AttackShape, BoardConfig, Direction, Position, UnitInstance } from './types';
import { samePosition } from './grid';
import { attackRangeFor, frontBandCells, lineCells } from './targeting';
import { hasActiveEffect } from './statusEffects';
import { flankBonusFor } from './flankBonus';

/**
 * **이 방향으로 쏘면 무엇이 맞는가.**
 *
 * 이 판정은 원래 공격 해결기 안에 파묻혀 있었다. 그래서 계획 화면은 "사거리 안의 칸"만 주황색으로
 * 칠할 수 있었고, 그 칸에 **실제로 맞을 대상이 있는지**는 말해 주지 못했다. 직접 굴려 보니 이게
 * 그냥 불편한 정도가 아니었다 — 사거리 표시를 믿고 여섯 기물을 연달아 쏘았는데 여섯 발 전부
 * 빗나갔다. 판에는 주황색이 잔뜩 칠해져 있었으므로 화면은 거짓말을 한 적이 없지만, 사람이 읽는
 * 뜻("여기 쏘면 뭔가 맞는다")과는 달랐다.
 *
 * 그래서 규칙을 여기 한 곳으로 끌어냈다. 해결기와 계획 화면이 **같은 함수**를 부르므로 미리보기가
 * 실제 결과와 갈라질 수 없다 — 갈라지면 그게 바로 사람을 헛발질하게 만드는 종류의 버그다.
 *
 * 결과를 네 갈래로 나눈 이유: 전부 "피해 0"으로 끝나지만 **다음 수가 전부 다르다.**
 * 방벽은 걷어내야 하고, 아군이 막았으면 그 아군을 비키게 해야 하고, 빈 사선이면 조준을 옮겨야 한다.
 * 하나로 뭉뚱그리면 화면이 알려 줄 수 있는 것 중 가장 쓸모 있는 부분이 사라진다.
 */
export interface AimTarget {
  unit: UnitInstance;
  /** 실제로 들어갈 피해(측면 교란 보너스까지 포함한 값). */
  damage: number;
  /** dealer4 측면 교란 보너스가 얹혔는지. */
  flank: boolean;
}

export type AimResult =
  | { kind: 'hit'; targets: AimTarget[] }
  /** 조준은 맞았지만 방벽이 지운다 — 빗나간 것이 아니다. */
  | { kind: 'barrier'; blocker: UnitInstance }
  /** 아군이 사선에 서 있어 막힌다. 비키기만 하면 닿는다는 뜻이라 빈 사선과 전혀 다르다. */
  | { kind: 'ally'; blocker: UnitInstance }
  /** 사거리 안에 아무도 없다. */
  | { kind: 'empty' };

export interface AimParams {
  unit: UnitInstance;
  /** 쏘는 칸. 기술 이동을 계획했다면 그 도착 칸이다(이동 1단계 → 공격 3단계). */
  from: Position;
  direction: Direction;
  units: UnitInstance[];
  board: BoardConfig;
  /**
   * 공격 도형. **해결기는 `resolvedAttackShape`, 계획 화면은 `plannedAttackShape`를 넘긴다** —
   * 동전으로 사거리가 갈리는 기물(support3)은 계획 시점에 결과를 알 수 없으므로 화면은 상한을
   * 쓰고 해결은 실제로 굴린 값을 쓴다. 그 차이를 이 함수가 몰래 정하면 안 되므로 인자로 받는다.
   */
  shape: AttackShape;
  /** 공격력. 위와 같은 이유로 계획/해결이 각자 넘긴다. */
  power: number;
  turnNumber: number;
}

export function aim({ unit, from, direction, units, board, shape, power, turnNumber }: AimParams): AimResult {
  const occupantAt = (cell: Position): UnitInstance | undefined =>
    units.find((u) => u.alive && u.position && samePosition(u.position, cell));

  // 범위형(tank3 전방 밴드)은 방벽을 무시하고 관통하며, 아군이 서 있어도 사선이 막히지 않는다(8장).
  if (shape.kind === 'aoe' && shape.aoeShape === 'line') {
    const targets: AimTarget[] = [];
    for (const cell of frontBandCells(from, direction, board)) {
      const occupant = occupantAt(cell);
      if (occupant && occupant.owner !== unit.owner) targets.push({ unit: occupant, damage: power, flank: false });
    }
    return targets.length > 0 ? { kind: 'hit', targets } : { kind: 'empty' };
  }

  if (shape.kind === 'line') {
    // 사거리는 방향마다 다를 수 있다(dealer3: 직선 4 · 대각 1) — attackRangeFor가 단일 근거다.
    for (const cell of lineCells(from, direction, attackRangeFor(shape, direction), board)) {
      const occupant = occupantAt(cell);
      if (!occupant) continue;
      if (occupant.owner === unit.owner) return { kind: 'ally', blocker: occupant };
      if (hasActiveEffect(occupant, 'barrier', turnNumber)) return { kind: 'barrier', blocker: occupant };
      const bonus = flankBonusFor(unit, occupant, units);
      // 직선 공격은 처음 만난 적 1명만 대상으로 한다.
      return { kind: 'hit', targets: [{ unit: occupant, damage: power + bonus, flank: bonus > 0 }] };
    }
  }

  return { kind: 'empty' };
}
