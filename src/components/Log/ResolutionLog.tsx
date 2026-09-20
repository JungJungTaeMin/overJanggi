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
          // 밀치기 — 결과가 **위치**라서 원문(JSON)으로 흘리면 판에서 무슨 일이 일어났는지 못 읽는다.
          // 빗나감/막힘/몇 칸을 한 줄에 다 적어야 "왜 안 밀렸지?"에 로그가 답할 수 있다.
          if (event.type === 'shove') {
            const d = event.detail ?? {};
            const cells = Number(d.cells ?? 0);
            const detail = !d.landed
              ? '빗나감 (사거리 밖)'
              : cells === 0
                ? '막혀서 밀리지 않음'
                : `${cells}칸 밀림 → ${posLabel(d.to as Position | null | undefined)}${d.collided ? ' (도중에 막힘)' : ''}`;
            return (
              <li key={i} className="log-dash">
                [{PHASE_LABEL[event.phase] ?? event.phase}] ⇥ 밀치기 — {unitLabel(event.actorId ?? '')} →{' '}
                {unitLabel(event.targetId ?? '')} · {detail}
              </li>
            );
          }
          if (event.type === 'shoveImpact') {
            const d = event.detail ?? {};
            return (
              <li key={i} className="log-dash">
                [{PHASE_LABEL[event.phase] ?? event.phase}] ✸ 충돌 — {unitLabel(event.targetId ?? '')}이(가) 벽에 부딪혀{' '}
                {String(d.damage)} 피해
              </li>
            );
          }
          // 갈고리 — 밀치기와 같은 이유로 풀어 쓴다. 결과가 위치라서 "왜 안 끌려왔지?"에
          // 답하려면 빗나감/막힘/몇 칸이 한 줄에 다 있어야 한다.
          if (event.type === 'hook') {
            const d = event.detail ?? {};
            const cells = Number(d.cells ?? 0);
            const detail = !d.landed
              ? '빗나감 (사거리 밖)'
              : cells === 0
                ? '막혀서 끌려오지 않음'
                : `${cells}칸 끌려옴 → ${posLabel(d.to as Position | null | undefined)}`;
            return (
              <li key={i} className="log-dash">
                [{PHASE_LABEL[event.phase] ?? event.phase}] ⇤ 갈고리 — {unitLabel(event.actorId ?? '')} →{' '}
                {unitLabel(event.targetId ?? '')} · {detail}
              </li>
            );
          }
          // 전송 — 아군이 판 반대편에서 갑자기 나타나는 사건이라, 로그에 도착 칸이 없으면
          // 화면만 보고는 "저 기물이 어떻게 여기 있지"를 설명할 수 없다.
          if (event.type === 'recall') {
            const d = event.detail ?? {};
            return (
              <li key={i} className="log-skillmove">
                [{PHASE_LABEL[event.phase] ?? event.phase}] ⇠ 전송 — {unitLabel(event.actorId ?? '')} →{' '}
                {unitLabel(event.targetId ?? '')} ·{' '}
                {d.landed ? `${posLabel(d.to as Position | null | undefined)}(으)로 불러옴` : '빗나감 (사거리 밖이거나 옆에 빈칸 없음)'}
              </li>
            );
          }
          // 표식 — 판에는 배지 하나만 붙고 피해 숫자는 **때린 쪽의 줄**에 섞여 나온다.
          // 이 줄이 없으면 "왜 저 공격만 유독 아팠지"를 되짚을 수 없다.
          if (event.type === 'mark') {
            const d = event.detail ?? {};
            return (
              <li key={i} className="log-pace">
                [{PHASE_LABEL[event.phase] ?? event.phase}] ◈ 표식 — {unitLabel(event.actorId ?? '')} →{' '}
                {unitLabel(event.targetId ?? '')} ·{' '}
                {d.landed ? `이번 턴 받는 피해 +${String(d.amount)}` : '빗나감 (사거리 밖)'}
              </li>
            );
          }
          // 화상은 두 줄로 나뉜다: 붙은 순간(공격 단계)과 닳는 순간(턴종료). 한 줄로 합치면
          // 맞은 턴에 이미 다 아픈 것처럼 읽혀서, 이 기물이 왜 약한 한 방을 갖는지가 안 보인다.
          if (event.type === 'burn') {
            return (
              <li key={i} className="log-dash">
                [{PHASE_LABEL[event.phase] ?? event.phase}] ♨ 화상 부착 — {unitLabel(event.actorId ?? '')} →{' '}
                {unitLabel(event.targetId ?? '')}
              </li>
            );
          }
          if (event.type === 'burnTick') {
            const d = event.detail ?? {};
            return (
              <li key={i} className="log-dash">
                [{PHASE_LABEL[event.phase] ?? event.phase}] ♨ 화상 피해 — {unitLabel(event.actorId ?? '')} ·{' '}
                {String(d.damage)} 피해
              </li>
            );
          }
          // 반격 — 때린 쪽이 피를 흘리는 사건이라, 이 줄이 없으면 자기 기물의 체력이 왜 줄었는지
          // 로그 어디에도 답이 없다(공격 줄은 상대가 맞은 것만 적는다).
          if (event.type === 'riposte') {
            const d = event.detail ?? {};
            return (
              <li key={i} className="log-dash">
                [{PHASE_LABEL[event.phase] ?? event.phase}] ↩ 반격 — {unitLabel(event.actorId ?? '')} →{' '}
                {unitLabel(event.targetId ?? '')} · 받은 피해의 절반인 {String(d.damage)}을(를) 되돌림
              </li>
            );
          }
          // 차단막을 친 사실 자체 — 판에는 칸 색만 바뀌므로 "언제 걸렸나"는 로그에만 남는다.
          if (event.type === 'veil') {
            return (
              <li key={i} className="log-block">
                [{PHASE_LABEL[event.phase] ?? event.phase}] ▧ 차단막 — {unitLabel(event.actorId ?? '')} ·{' '}
                {posLabel((event.detail ?? {}).at as Position | null | undefined)} 주변 8칸의 공격·회복이 지워짐
              </li>
            );
          }
          // 지워진 공격·회복. 피해도 회복도 0이라 판에 흔적이 없으니, 이 줄이 없으면 사람은
          // "왜 아무 일도 안 일어났지"를 되짚을 수 없다.
          if (event.type === 'blockedByVeil') {
            return (
              <li key={i} className="log-block">
                [{PHASE_LABEL[event.phase] ?? event.phase}] ▧ 차단막에 지워짐 — {unitLabel(event.actorId ?? '')} →{' '}
                {unitLabel(event.targetId ?? '')}
              </li>
            );
          }
          // 러너 가속 — 이동 칸수가 왜 늘었는지는 이 줄에만 있다.
          if (event.type === 'pace') {
            const d = event.detail ?? {};
            return (
              <li key={i} className="log-pace">
                [{PHASE_LABEL[event.phase] ?? event.phase}] ⇢ 가속 — {unitLabel(event.actorId ?? '')} ·{' '}
                {d.reset ? '최대 속도를 다 쓰고' : '다음 턴'} 이동 Lv {String(d.level)}
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
