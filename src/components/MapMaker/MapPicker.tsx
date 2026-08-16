import { useEffect, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { WIDTH, HEIGHT } from '../../data/mapDefinitions';
import { listMaps, type CustomMap } from '../../maps/mapStorage';

/**
 * 대전 전에 맵을 고르는 칸. 기본 '정원' 맵은 목록의 첫 항목이며 null로 표현한다
 * (기본 맵을 CustomMap으로 복제해 두면 기본 맵을 고칠 때 두 벌을 관리해야 한다).
 *
 * 온라인 대전에서는 **호스트가 고른 맵**이 스냅샷으로 게스트에게 전달되므로, 게스트가 여기서 무엇을
 * 고르든 실제 대전에는 호스트의 맵이 쓰인다 — 그 사실을 아래 안내문에 적어 둔다.
 */
export function MapPicker() {
  const selectedMap = useGameStore((s) => s.selectedMap);
  const selectMap = useGameStore((s) => s.selectMap);
  const openMapMaker = useGameStore((s) => s.openMapMaker);
  const [maps, setMaps] = useState<CustomMap[]>([]);

  useEffect(() => {
    listMaps()
      .then(setMaps)
      .catch(() => setMaps([]));
  }, []);

  // 고른 맵이 다른 브라우저/다른 기기에서 지워졌을 수 있다. 목록에 없으면 기본 맵으로 되돌린다.
  useEffect(() => {
    if (selectedMap && maps.length > 0 && !maps.some((m) => m.id === selectedMap.id)) selectMap(null);
  }, [maps, selectedMap, selectMap]);

  return (
    <section className="mode-card">
      <h2>맵</h2>
      <p>대전에 쓸 맵을 고릅니다. 직접 만든 맵은 맵 메이커에서 저장하면 여기 나타납니다.</p>
      <div className="map-choice-row">
        <button className={`map-choice${selectedMap === null ? ' active' : ''}`} onClick={() => selectMap(null)}>
          <strong>정원 (기본)</strong>
          <span>
            {WIDTH}×{HEIGHT} · 중앙 점령지 3×3
          </span>
        </button>
        {maps.map((m) => (
          <button key={m.id} className={`map-choice${selectedMap?.id === m.id ? ' active' : ''}`} onClick={() => selectMap(m)}>
            <strong>{m.name}</strong>
            <span>
              {m.board.width}×{m.board.height} · 점령 {m.board.captureZone.length}칸
              {(m.board.healPacks?.length ?? 0) > 0 ? ` · 힐팩 ${m.board.healPacks!.length}` : ''}
            </span>
          </button>
        ))}
      </div>
      <div className="online-row">
        <button className="btn-secondary" onClick={openMapMaker}>
          맵 메이커 열기
        </button>
      </div>
      <p className="muted">온라인 대전에서는 방을 만든 쪽(호스트)이 고른 맵으로 진행됩니다.</p>
    </section>
  );
}
