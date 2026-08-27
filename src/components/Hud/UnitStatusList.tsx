import type { Owner } from '../../engine/types';
import { useGameStore } from '../../store/gameStore';
import { getUnitType } from '../../data/unitTypes';
import { isEffectActive } from '../../engine/statusEffects';

/**
 * **동전은 「지금 걸려 있는 상태」가 아니다.**
 *
 * 확률·포탑형의 동전은 해결 단계의 맨 앞에서 굴러가고, 상태이상 기본 수명이 「적용 턴 + 다음 턴」이라
 * 계획 화면에는 **지난 턴에 나온 결과**가 그대로 남아 있다. 그런데 표에 그냥 뜨면 사람은 그걸
 * "이번 턴은 뒷면"으로 읽는다 — 실제로 이번 턴 동전은 아직 굴리지도 않았고 절반의 확률로 앞면이다.
 *
 * 그래서 표에서 뺀다. 이번 턴의 불확실성은 판이 직접 말한다: 동전이 앞면이어야만 닿는 칸은
 * 점선·옅은 색으로 갈라 그려진다(Planning/actionGeometry.ts).
 */
function isStaleCoin(type: string): boolean {
  return type === 'coinHeads' || type === 'coinTails';
}

/** 살아있는 기물의 HP/쿨타임/상태이상 지속시간을 상시 노출하는 표(9장 체크리스트). */
export function UnitStatusList({ owner, label }: { owner: Owner; label: string }) {
  const state = useGameStore((s) => s.state);
  if (!state) return null;
  const units = state.units.filter((u) => u.owner === owner && u.alive);

  return (
    <div className="unit-status-list">
      <h4>{label} 상태</h4>
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>기물</th>
            <th style={{ textAlign: 'left' }}>HP</th>
            <th style={{ textAlign: 'left' }}>쿨타임</th>
            <th style={{ textAlign: 'left' }}>충전/기준점</th>
            <th style={{ textAlign: 'left' }}>상태이상</th>
          </tr>
        </thead>
        <tbody>
          {units.map((u) => {
            const typeDef = getUnitType(u.typeId);
            const activeEffects = u.statusEffects.filter((e) => isEffectActive(e, state.turnNumber) && !isStaleCoin(e.type));
            const cooldowns = Object.entries(u.cooldowns).filter(([, v]) => v > 0);
            // 충전형 기술(현재는 dealer2 시간역행)의 남은 사용량과, 복귀 기준점의 위치·체력.
            const charges = typeDef.skills
              .filter((s) => s.gate.type === 'charge')
              .map((s) => `${s.name} ${u.charges[s.id] ?? 0}/${s.gate.type === 'charge' ? s.gate.maxCharges : 0}`);
            return (
              <tr key={u.instanceId}>
                <td>{typeDef.name}</td>
                <td>
                  {u.currentHp}/{u.maxHp}
                  {u.shieldHp > 0 ? ` (+보호막${u.shieldHp})` : ''}
                </td>
                <td>{cooldowns.length ? cooldowns.map(([id, v]) => `${id}:${v}`).join(', ') : '-'}</td>
                <td>
                  {charges.length ? charges.join(', ') : '-'}
                  {u.rewindSnapshot
                    ? ` · ⟲(${u.rewindSnapshot.position.x}, ${u.rewindSnapshot.position.y})·체력${u.rewindSnapshot.hp}`
                    : ''}
                </td>
                <td>{activeEffects.length ? activeEffects.map((e) => e.type).join(', ') : '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
