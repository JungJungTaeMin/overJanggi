import { useGameStore } from '../../store/gameStore';
import { getUnitType } from '../../data/unitTypes';

/** 사망한 기물의 부활까지 남은 턴 수를 보여준다. */
export function RespawnTracker() {
  const state = useGameStore((s) => s.state);
  if (!state) return null;
  const dead = state.units.filter((u) => !u.alive && !u.isTurret);
  if (dead.length === 0) return null;

  return (
    <div className="respawn-tracker">
      <h4>부활 대기</h4>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
        {dead.map((u) => (
          <li key={u.instanceId}>
            [{u.owner === 'p1' ? 'P1' : 'P2'}] {getUnitType(u.typeId).name} — {u.respawnTurnsRemaining}턴 후 부활
          </li>
        ))}
      </ul>
    </div>
  );
}
