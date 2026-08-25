import type { BoardConfig, Direction, Position, UnitInstance } from '../../engine/types';
import { aim } from '../../engine/aim';
import { plannedAttackPower, plannedAttackShape } from '../../engine/unitStats';
import type { AttackOption } from './actionGeometry';

/**
 * **주황 칸이 "닿는다"는 뜻은 아니었다.**
 *
 * 사거리 하이라이트는 「이 칸까지 사선이 뻗는다」만 말한다. 그런데 사람은 그걸 「여기 쏘면 맞는다」로
 * 읽는다 — 실제로 이 화면을 믿고 여섯 기물을 연달아 쏘았다가 여섯 발 전부 허공에 날렸다. 판은
 * 주황색으로 가득했으므로 화면이 거짓말을 한 적은 없지만, 사람이 읽은 뜻과는 달랐다.
 *
 * 그래서 조준 결과를 **클릭 전에** 판 위에 올린다. 어느 방향이 실제로 무언가를 때리는지, 무엇을
 * 얼마나 때리는지, 혹은 왜 안 닿는지(아군이 사선을 막았나 / 방벽에 막히나)를 표시한다.
 *
 * 판정은 engine/aim.ts — **해결 단계가 부르는 바로 그 함수**다. 미리보기용으로 규칙을 다시 적으면
 * 그 사본이 언젠가 실제 결과와 갈라지고, 갈라지는 순간 이 표시는 헛발질을 부추기는 쪽이 된다.
 */
export interface AimMark {
  position: Position;
  /** hit=때린다 / ally=아군이 사선을 막는다 / barrier=방벽이 지운다. */
  kind: 'hit' | 'ally' | 'barrier';
  /** 예상 피해(측면 교란 보너스 포함). hit일 때만. */
  damage?: number;
  direction: Direction;
}

/**
 * 지금 쏠 수 있는 **모든 방향**을 미리 굴려 본다. 한 방향만 보여 주면 "이 방향은 왜 표시가 없지"를
 * 답할 수 없고, 사거리 안에 여럿이면 어느 쪽이 이득인지도 비교가 안 된다.
 *
 * 공격력·사거리는 `planned*`를 쓴다 — 동전으로 갈리는 기물(support3)은 계획 시점에 결과를 알 수
 * 없으므로 화면은 상한을 그린다(사거리 하이라이트와 같은 규칙).
 */
export function computeAimMarks(
  unit: UnitInstance,
  units: UnitInstance[],
  board: BoardConfig,
  from: Position,
  attackOptions: AttackOption[],
  turnNumber: number,
): AimMark[] {
  if (attackOptions.length === 0) return [];
  const shape = plannedAttackShape(unit);
  const power = plannedAttackPower(unit, turnNumber);

  const marks: AimMark[] = [];
  const seen = new Set<Direction>();
  for (const option of attackOptions) {
    if (seen.has(option.direction)) continue;
    seen.add(option.direction);

    const result = aim({ unit, from, direction: option.direction, units, board, shape, power, turnNumber });
    if (result.kind === 'hit') {
      for (const target of result.targets) {
        if (!target.unit.position) continue;
        marks.push({ position: target.unit.position, kind: 'hit', damage: target.damage, direction: option.direction });
      }
    } else if (result.kind === 'ally' && result.blocker.position) {
      marks.push({ position: result.blocker.position, kind: 'ally', direction: option.direction });
    } else if (result.kind === 'barrier' && result.blocker.position) {
      marks.push({ position: result.blocker.position, kind: 'barrier', direction: option.direction });
    }
    // empty(사거리 안에 아무도 없음)는 표시하지 않는다 — 빈 사선마다 표식을 찍으면 여덟 방향이
    // 전부 칠해져서, 정작 무언가 맞는 한 방향이 소음에 묻힌다.
  }
  return marks;
}

/** 조준 결과 한 줄 요약 — 표식이 하나도 없을 때 "왜 없는지"를 글로 답한다. */
export function aimSummary(marks: AimMark[]): string {
  if (marks.length === 0) return '지금 이 자리에서는 어느 방향으로 쏴도 닿는 대상이 없습니다.';
  const hits = marks.filter((m) => m.kind === 'hit');
  if (hits.length === 0) {
    const ally = marks.some((m) => m.kind === 'ally');
    const barrier = marks.some((m) => m.kind === 'barrier');
    if (ally && barrier) return '아군이 사선을 막거나 방벽에 막힙니다 — 비켜서거나 방벽부터 걷어내세요.';
    if (ally) return '아군이 사선에 서 있습니다 — 비키게 하면 닿습니다.';
    return '방벽에 막힙니다 — 피해가 들어가지 않습니다.';
  }
  const best = Math.max(...hits.map((m) => m.damage ?? 0));
  return `조준되는 대상 ${hits.length}곳 — 최대 ${best} 피해.`;
}
