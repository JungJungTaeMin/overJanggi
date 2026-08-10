import { useMemo, useState } from 'react';
import type { Owner, Position, UnitInstance } from '../../engine/types';
import { createUnitInstance } from '../../engine/createInitialState';
import { getUnitType } from '../../data/unitTypes';
import { mapDefinition } from '../../data/mapDefinitions';
import { useGameStore } from '../../store/gameStore';
import { Board } from '../Board/Board';

interface Slot {
  owner: Owner;
  index: number;
}

function OwnerSlotList({ owner, label, active, onSelect }: { owner: Owner; label: string; active: Slot | null; onSelect: (s: Slot) => void }) {
  const picks = useGameStore((s) => s.draftPicks[owner]);
  const positions = useGameStore((s) => s.placementPositions[owner]);

  return (
    <div className="draft-column" style={{ minWidth: 240 }}>
      <h3>{label}</h3>
      <ul>
        {picks.map((typeId, i) => {
          const placed = positions[i];
          const isActive = active !== null && active.owner === owner && active.index === i;
          return (
            <li key={i}>
              <button onClick={() => onSelect({ owner, index: i })} style={{ background: isActive ? '#fef9c3' : undefined }}>
                {getUnitType(typeId).name} — {placed ? `(${placed.x}, ${placed.y})` : '미배치'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PlacementScreen() {
  const draftPicks = useGameStore((s) => s.draftPicks);
  const placementPositions = useGameStore((s) => s.placementPositions);
  const placeUnit = useGameStore((s) => s.placeUnit);
  const confirmPlacement = useGameStore((s) => s.confirmPlacement);
  const mode = useGameStore((s) => s.mode);
  const localOwner = useGameStore((s) => s.localOwner);
  // 로컬 대전에서만 한 사람이 양쪽을 배치한다. AI·온라인에서는 내 진영만 찍는다.
  const owners: Owner[] = mode === 'local' ? ['p1', 'p2'] : [localOwner];
  const [active, setActive] = useState<Slot | null>({ owner: owners[0], index: 0 });

  const previewUnits = useMemo(() => {
    const units: UnitInstance[] = [];
    for (const owner of ['p1', 'p2'] as Owner[]) {
      draftPicks[owner].forEach((typeId, i) => {
        const pos = placementPositions[owner][i];
        if (pos) units.push(createUnitInstance(typeId, owner, pos));
      });
    }
    return units;
  }, [draftPicks, placementPositions]);

  const clickableCells: Position[] = active ? mapDefinition.startZones[active.owner] : [];

  function handleCellClick(p: Position) {
    if (!active) return;
    placeUnit(active.owner, active.index, p);
    const positions = placementPositions[active.owner];
    const nextUnplaced = positions.findIndex((pos, i) => i !== active.index && !pos);
    if (nextUnplaced >= 0) {
      setActive({ owner: active.owner, index: nextUnplaced });
    } else {
      // 내가 배치할 진영이 하나뿐이면(AI·온라인) 다음 진영으로 넘어가지 않는다.
      const otherOwner = owners.find((o) => o !== active.owner);
      const otherUnplaced = otherOwner ? placementPositions[otherOwner].findIndex((pos) => !pos) : -1;
      setActive(otherOwner && otherUnplaced >= 0 ? { owner: otherOwner, index: otherUnplaced } : null);
    }
  }

  const ready = placementPositions.p1.every(Boolean) && placementPositions.p2.every(Boolean);
  const mine = placementPositions[localOwner];
  const myTurnDone = mode === 'local' ? ready : mine.length > 0 && mine.every(Boolean);

  return (
    <div className="placement-layout">
      <div className="board-column">
        <h2>배치 — 각 진영 칸을 클릭해 기물을 배치하세요</h2>
        <Board board={mapDefinition} units={previewUnits} clickableCells={clickableCells} onCellClick={handleCellClick} />
        <button onClick={confirmPlacement} disabled={!ready} className="btn-primary" style={{ marginTop: 8, padding: '8px 16px' }}>
          전투 시작
        </button>
        {mode !== 'local' && myTurnDone && !ready && <p className="muted">상대의 배치를 기다리는 중…</p>}
      </div>
      <div style={{ display: 'flex', gap: 24 }}>
        {owners.map((owner) => (
          <OwnerSlotList
            key={owner}
            owner={owner}
            label={owner === 'p1' ? 'Player 1' : 'Player 2'}
            active={active}
            onSelect={setActive}
          />
        ))}
      </div>
    </div>
  );
}
