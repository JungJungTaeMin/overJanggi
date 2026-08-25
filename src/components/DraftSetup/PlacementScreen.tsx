import { useMemo, useState } from 'react';
import type { Owner, Position, UnitInstance } from '../../engine/types';
import { createUnitInstance } from '../../engine/createInitialState';
import { getUnitType } from '../../data/unitTypes';
import { boardOf, useGameStore } from '../../store/gameStore';
import { Board } from '../Board/Board';
import { isBoardFlipped } from '../Board/orientation';
import { canSeeHiddenInfo } from '../visibility';

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
  const autoPlace = useGameStore((s) => s.autoPlace);
  const confirmPlacement = useGameStore((s) => s.confirmPlacement);
  const mode = useGameStore((s) => s.mode);
  const localOwner = useGameStore((s) => s.localOwner);
  // 커스텀 맵을 골랐으면 배치도 그 맵 위에서 해야 한다 — 기본 맵의 시작지점은 좌표부터 다르다.
  const board = boardOf(useGameStore((s) => s.selectedMap));
  // 로컬 대전에서만 한 사람이 양쪽을 배치한다. AI·온라인에서는 내 진영만 찍는다.
  const owners: Owner[] = mode === 'local' ? ['p1', 'p2'] : [localOwner];
  const [active, setActive] = useState<Slot | null>({ owner: owners[0], index: 0 });

  /**
   * 온라인에서는 **상대 진형을 보여 주지 않는다.** 배치는 양쪽이 동시에, 서로 못 보는 채로 정하는
   * 것이 전제인데(그래서 "상대의 배치를 기다리는 중…"이 뜬다) 판에 그려 버리면 늦게 놓는 쪽이
   * 상대 진형을 다 보고 맞춰 놓게 된다. 경계선은 components/visibility.ts에 적혀 있다.
   */
  const previewUnits = useMemo(() => {
    const units: UnitInstance[] = [];
    for (const owner of ['p1', 'p2'] as Owner[]) {
      if (!canSeeHiddenInfo(mode, localOwner, owner)) continue;
      draftPicks[owner].forEach((typeId, i) => {
        const pos = placementPositions[owner][i];
        if (pos) units.push(createUnitInstance(typeId, owner, pos));
      });
    }
    return units;
  }, [draftPicks, placementPositions, mode, localOwner]);

  const clickableCells: Position[] = active ? board.startZones[active.owner] : [];

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

  /** 내가 배치하는 진영을 모두 자동으로 채운다(로컬 대전이면 양쪽). */
  function autoPlaceMine() {
    owners.forEach((owner) => autoPlace(owner));
    setActive(null); // 남은 자리가 없으니 "지금 놓는 기물" 표시도 지운다
  }

  const ready = placementPositions.p1.every(Boolean) && placementPositions.p2.every(Boolean);
  const mine = placementPositions[localOwner];
  const myTurnDone = mode === 'local' ? ready : mine.length > 0 && mine.every(Boolean);

  return (
    <div className="placement-layout">
      <div className="board-column">
        <h2>배치 — 각 진영 칸을 클릭해 기물을 배치하세요</h2>
        <Board
          board={board}
          units={previewUnits}
          clickableCells={clickableCells}
          onCellClick={handleCellClick}
          flipped={isBoardFlipped(board, localOwner, mode)}
        />
        <div className="placement-actions">
          {/* 시작 진형은 어차피 시작지점 3행 안에서만 정해진다 — 다섯 칸을 일일이 찍는 대신
              탱커 앞줄·원거리 뒷줄이라는 정석 진형을 한 번에 받고, 마음에 안 드는 기물만 다시 찍는다. */}
          <button type="button" className="btn-secondary" onClick={autoPlaceMine} disabled={myTurnDone}>
            자동 배치
          </button>
          <button onClick={confirmPlacement} disabled={!ready} className="btn-primary" style={{ padding: '8px 16px' }}>
            전투 시작
          </button>
        </div>
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
