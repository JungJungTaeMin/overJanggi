import type { Position, UnitInstance } from '../../engine/types';
import type { ReplayPhase, ResolutionStep } from '../../engine/replay';
import { numberedPhase } from '../phaseLabels';

/**
 * **해결의 한 단계를 판 위 표시로 옮긴다.**
 *
 * 로그에는 처음부터 다 적혀 있었다 — 누가 누구를 몇 대 때렸고 누가 빗나갔는지. 문제는 그걸
 * 읽으려면 판에서 눈을 떼야 한다는 것이고, 그러면 "때렸다"가 판 위의 사건이 아니라 판 밖의
 * 기록이 된다. 여기서 하는 일은 같은 사건을 **기물이 서 있는 자리 위에** 다시 그리는 것뿐이다.
 *
 * 근거는 언제나 그 단계의 이벤트다 — 체력 차이를 빼서 추정하지 않는다. 추정하면 방벽에 막혀
 * 0이 들어간 것과 애초에 조준이 빗나간 것을 구분할 수 없고, 그 둘은 다음 수가 정반대다.
 */

/** 이름은 phaseLabels.ts 한 곳에서만 온다 — 재생 바와 로그가 같은 단계를 다르게 부르지 않도록. */
export const REPLAY_PHASE_LABEL: Record<ReplayPhase, string> = {
  start: numberedPhase('start'),
  turnStart: numberedPhase('turnStart'),
  movement: numberedPhase('movement'),
  preAttack: numberedPhase('preAttack'),
  attack: numberedPhase('attack'),
  heal: numberedPhase('heal'),
  endOfTurn: numberedPhase('endOfTurn'),
};

export type MarkKind = 'damage' | 'heal' | 'blocked' | 'miss' | 'death' | 'respawn';

export interface BoardMark {
  key: string;
  position: Position;
  kind: MarkKind;
  text: string;
}

export type RayKind = 'hit' | 'blocked' | 'heal';

/** 누가 누구에게 무엇을 했는지 잇는 선. 숫자만으로는 **누가 한 짓인지**가 빠진다. */
export interface BoardRay {
  key: string;
  from: Position;
  to: Position;
  kind: RayKind;
}

export interface StepVisuals {
  marks: BoardMark[];
  rays: BoardRay[];
}

const EMPTY: StepVisuals = { marks: [], rays: [] };

function indexBy(units: UnitInstance[]): Map<string, UnitInstance> {
  return new Map(units.map((u) => [u.instanceId, u]));
}

export function stepVisuals(step: ResolutionStep | null, previousUnits: UnitInstance[] = []): StepVisuals {
  if (!step) return EMPTY;

  const now = indexBy(step.units);
  const before = indexBy(previousUnits);
  /**
   * 죽은 기물은 position이 null이 된다(death.ts). 그래서 **직전 단계의 위치**로 물러나 찾는다 —
   * 안 그러면 이 게임에서 가장 중요한 사건인 처치가 판 위에 흔적을 못 남긴다.
   */
  const positionOf = (id: string | undefined): Position | null => {
    if (!id) return null;
    return now.get(id)?.position ?? before.get(id)?.position ?? null;
  };

  // 같은 단계에서 한 기물이 여러 번 맞거나 여러 곳에서 회복받을 수 있다 — 숫자를 겹쳐 그리는
  // 대신 대상마다 합쳐서 한 번에 보여 준다.
  const damage = new Map<string, number>();
  const heal = new Map<string, number>();
  const marks: BoardMark[] = [];
  const rays: BoardRay[] = [];

  step.events.forEach((event, i) => {
    const amount = Number(event.detail?.amount ?? event.detail?.damage ?? 0);
    switch (event.type) {
      case 'hit':
      case 'dashDamage': {
        if (event.targetId) damage.set(event.targetId, (damage.get(event.targetId) ?? 0) + amount);
        // 돌진 관통은 밟고 지나간 것이라 조준선이 없다 — 화살을 그리면 쏜 것처럼 보인다.
        const from = event.type === 'hit' ? positionOf(event.actorId) : null;
        const to = positionOf(event.targetId);
        if (from && to) rays.push({ key: `ray-${i}`, from, to, kind: 'hit' });
        break;
      }
      case 'blockedByBarrier': {
        const to = positionOf(event.targetId);
        const from = positionOf(event.actorId);
        if (to) marks.push({ key: `blocked-${i}`, position: to, kind: 'blocked', text: '막힘' });
        if (from && to) rays.push({ key: `ray-${i}`, from, to, kind: 'blocked' });
        break;
      }
      case 'noTarget': {
        // 쏜 자리는 이벤트가 직접 들고 있다 — 공격 시점의 위치라 나중에 찾는 것보다 정확하다.
        const at = (event.detail?.at as Position | null | undefined) ?? positionOf(event.actorId);
        if (at) marks.push({ key: `miss-${i}`, position: at, kind: 'miss', text: '빗나감' });
        break;
      }
      case 'heal':
      case 'turretAura':
      case 'healPack':
      case 'autoRegen': {
        if (event.targetId ?? event.actorId) {
          const id = (event.targetId ?? event.actorId)!;
          heal.set(id, (heal.get(id) ?? 0) + amount);
          const from = positionOf(event.actorId);
          const to = positionOf(id);
          // 자기 자신을 회복한 것에는 선을 긋지 않는다(숫자만으로 충분하고, 선은 점이 된다).
          if (from && to && event.actorId !== id) rays.push({ key: `ray-${i}`, from, to, kind: 'heal' });
        }
        break;
      }
      case 'death': {
        const at = positionOf(event.actorId);
        if (at) marks.push({ key: `death-${i}`, position: at, kind: 'death', text: '격추' });
        break;
      }
      case 'respawn': {
        const at = event.detail?.at as Position | undefined;
        if (at) marks.push({ key: `respawn-${i}`, position: at, kind: 'respawn', text: '부활' });
        break;
      }
      default:
        break;
    }
  });

  for (const [id, total] of damage) {
    const at = positionOf(id);
    if (at && total > 0) marks.push({ key: `dmg-${id}`, position: at, kind: 'damage', text: `-${total}` });
  }
  for (const [id, total] of heal) {
    const at = positionOf(id);
    if (at && total > 0) marks.push({ key: `heal-${id}`, position: at, kind: 'heal', text: `+${total}` });
  }

  return { marks, rays };
}

/**
 * 한 단계를 몇 밀리초 보여 줄지. **그 단계에 실제로 벌어진 일의 양**이 정한다 — 전부 같은 시간을
 * 주면 아무도 안 움직인 「2. 변환」이 3연속 처치가 난 「3. 공격」과 똑같이 길어져, 재생이 결과를
 * 보여 주는 장치가 아니라 매 턴 물어야 하는 통행료가 된다.
 */
export function stepDurationMs(marks: BoardMark[]): number {
  return Math.min(1600, 520 + marks.length * 260);
}

/** 표시가 하나도 없는 단계에서 대신 쓸 한 마디 — "지금 무슨 단계인지"만은 늘 읽혀야 한다. */
const QUIET_SUMMARY: Record<ReplayPhase, string> = {
  start: '계획 공개',
  turnStart: '턴 시작 처리',
  movement: '이동',
  preAttack: '방벽 · 구속 · 공격모드',
  attack: '공격',
  heal: '회복',
  endOfTurn: '쿨타임 · 부활 · 점수',
};

const SUMMARY_LABEL: Record<MarkKind, string> = {
  damage: '명중',
  heal: '회복',
  blocked: '막힘',
  miss: '빗나감',
  death: '처치',
  respawn: '부활',
};

/**
 * 이 단계에서 실제로 벌어진 일을 한 줄로. 판 위 표시와 **같은 근거**(marks)로 만든다 —
 * 따로 세면 "명중 2"라고 써 놓고 판에는 숫자가 하나만 뜨는 일이 생긴다.
 */
export function stepSummary(step: ResolutionStep | null, marks: BoardMark[]): string {
  if (!step) return '';
  const counts = new Map<MarkKind, number>();
  for (const mark of marks) counts.set(mark.kind, (counts.get(mark.kind) ?? 0) + 1);
  const parts = (Object.keys(SUMMARY_LABEL) as MarkKind[])
    .filter((kind) => counts.has(kind))
    .map((kind) => `${SUMMARY_LABEL[kind]} ${counts.get(kind)}`);
  return parts.length > 0 ? parts.join(' · ') : QUIET_SUMMARY[step.phase];
}
