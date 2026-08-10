import type { Owner } from '../../engine/types';
import { useGameStore } from '../../store/gameStore';
import { getUnitType } from '../../data/unitTypes';
import { isEffectActive } from '../../engine/statusEffects';

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
            const activeEffects = u.statusEffects.filter((e) => isEffectActive(e, state.turnNumber));
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
