import type { Direction, Position, PriorityEntry } from '../../engine/types';
import { useGameStore } from '../../store/gameStore';
import { DIRECTION_LABEL } from '../Planning/SkillTargetPicker';
import { numberedPhase } from '../phaseLabels';

// 단계 이름은 phaseLabels.ts가 유일한 근거다 — 로그와 재생 바가 같은 단계를 다르게 부르면
// 플레이어는 없는 단계를 하나 더 있다고 읽는다.
const PHASE_LABEL: Record<string, string> = {
  priority: numberedPhase('priority'),
  movement: numberedPhase('movement'),
  preAttack: numberedPhase('preAttack'),
  attack: numberedPhase('attack'),
  heal: numberedPhase('heal'),
  endOfTurn: numberedPhase('endOfTurn'),
};

function posLabel(p: Position | null | undefined): string {
  return p ? `(${p.x}, ${p.y})` : '전장 밖';
}

export function ResolutionLog() {
  const lastLog = useGameStore((s) => s.lastLog);
  const state = useGameStore((s) => s.state);
  if (lastLog.length === 0) return null;

  const unitLabel = (instanceId: string): string => {
    const unit = state?.units.find((u) => u.instanceId === instanceId);
    return unit ? `${unit.owner}:${unit.typeId}` : instanceId;
  };

  return (
    <div className="resolution-log">
      <h4>직전 턴 해결 로그</h4>
      <ol>
        {lastLog.map((event, i) => {
          if (event.phase === 'priority' && (event.type === 'movementOrder' || event.type === 'attackOrder')) {
            const order = (event.detail?.order as PriorityEntry[] | undefined) ?? [];
            const stageLabel = event.type === 'movementOrder' ? '이동' : '공격';
            return (
              <li key={i}>
                [{PHASE_LABEL[event.phase] ?? event.phase}] {stageLabel} 단계 처리 순서(3.2.1절 — 이 단계에서만 유효):
                <ol className="priority-order">
                  {order.map((entry, rank) => (
                    <li key={entry.instanceId}>
                      {rank + 1}순위 — {unitLabel(entry.instanceId)} ({entry.reason})
                    </li>
                  ))}
                </ol>
              </li>
            );
          }
          // dealer2 시간역행 — 기준점 기록과 복귀는 원시 JSON 대신 위치·체력을 읽을 수 있게 풀어 쓴다.
          if (event.type === 'rewindAnchor') {
            const d = event.detail ?? {};
            return (
              <li key={i} className="log-rewind">
                [{PHASE_LABEL[event.phase] ?? event.phase}] ⟲ 기준점 기록 — {unitLabel(event.actorId ?? '')} ·{' '}
                {posLabel(d.at as Position | undefined)} · 체력 {String(d.hp)}
              </li>
            );
          }
          // 기술로 파고들어 쏜 공격 — 어디서 쐈는지가 핵심이라 좌표를 풀어 쓴다.
          if (event.type === 'skillMoveAttack') {
            const d = event.detail ?? {};
            const dir = d.direction as Direction | undefined;
            return (
              <li key={i} className="log-skillmove">
                [{PHASE_LABEL[event.phase] ?? event.phase}] ⇢ 기술 이동 후 공격 — {unitLabel(event.actorId ?? '')} ·{' '}
                {posLabel(d.from as Position | undefined)}에서{dir ? ` ${DIRECTION_LABEL[dir] ?? String(dir)} 방향` : ''}
              </li>
            );
          }
          // 빗나간 공격 — 판에 아무 변화도 남기지 않는 사건이라, 로그에서마저 원시 JSON이면
          // "쏘긴 쐈는데 아무 일도 없었다"를 알 길이 없다.
          if (event.type === 'noTarget') {
            const d = event.detail ?? {};
            const dir = d.direction as Direction | undefined;
            return (
              <li key={i} className="log-miss">
                [{PHASE_LABEL[event.phase] ?? event.phase}] ✕ 빗나감 — {unitLabel(event.actorId ?? '')} ·{' '}
                {posLabel(d.at as Position | null | undefined)}에서
                {dir ? ` ${DIRECTION_LABEL[dir] ?? String(dir)} 방향` : ''} · 사거리 안에 적 없음
              </li>
            );
          }
          // tank2 돌진 — "누구를 몇 칸만큼 밟고 지나갔는지"가 핵심이라 풀어 쓴다.
          if (event.type === 'dashDamage') {
            const d = event.detail ?? {};
            return (
              <li key={i} className="log-dash">
                [{PHASE_LABEL[event.phase] ?? event.phase}] ⇉ 돌진 관통 — {unitLabel(event.actorId ?? '')} →{' '}
                {unitLabel(event.targetId ?? '')} · 이동 칸수만큼 {String(d.damage)} 피해
              </li>
            );
          }
          if (event.type === 'rewind') {
            const d = event.detail ?? {};
            return (
              <li key={i} className="log-rewind">
                [{PHASE_LABEL[event.phase] ?? event.phase}] ⟲ 시간 역행 복귀 — {unitLabel(event.actorId ?? '')} ·{' '}
                {posLabel(d.fromPosition as Position | null | undefined)} → {posLabel(d.toPosition as Position | null | undefined)}
                {d.positionBlocked ? ' (기준점이 막혀 위치는 유지)' : ''} · 체력 {String(d.fromHp)} → {String(d.toHp)} · 충전 초기화
              </li>
            );
          }
          return (
            <li key={i}>
              [{PHASE_LABEL[event.phase] ?? event.phase}] {event.type}
              {event.actorId ? ` — actor:${unitLabel(event.actorId)}` : ''}
              {event.targetId ? ` -> target:${unitLabel(event.targetId)}` : ''}
              {event.detail ? ` ${JSON.stringify(event.detail)}` : ''}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
