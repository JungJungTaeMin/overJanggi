import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { mapDefinition } from '../../data/mapDefinitions';
import {
  MAX_MAP_SIZE,
  MIN_MAP_SIZE,
  TILE_PALETTE,
  blankTiles,
  boardToTiles,
  mapWarnings,
  resizeTiles,
  tilesToBoard,
  validateMap,
  type TileGrid,
  type TileKind,
} from '../../maps/mapModel';
import {
  decodeMap,
  deleteMap,
  encodeMap,
  listMaps,
  newMapId,
  saveMap,
  storageLabel,
  type CustomMap,
} from '../../maps/mapStorage';

const CELL = 24;

const KIND_COLOR = Object.fromEntries(TILE_PALETTE.map((t) => [t.kind, t.color])) as Record<TileKind, string>;

/**
 * 맵 메이커 — 칸을 칠해서 맵을 만들고 저장한다.
 *
 * 편집 대상은 엔진의 BoardConfig가 아니라 **칸마다 종류 하나뿐인 격자**(mapModel.TileGrid)다.
 * 그래서 "벽이면서 점령지인 칸" 같은 게 애초에 만들어지지 않고, 저장 버튼을 누를 때만 BoardConfig로
 * 펼친다. 검사(validateMap)는 경고가 아니라 **차단**인데, 여기서 걸리는 맵은 취향 문제가 아니라
 * 배치가 불가능하거나 점수를 낼 수 없어서 판이 끝나지 않는 맵이기 때문이다.
 */
export function MapEditor() {
  const backToMenu = useGameStore((s) => s.backToMenu);
  const selectMap = useGameStore((s) => s.selectMap);
  const selectedMap = useGameStore((s) => s.selectedMap);

  const [maps, setMaps] = useState<CustomMap[]>([]);
  const [mapId, setMapId] = useState<string | null>(null);
  const [name, setName] = useState('새 맵');
  const [tiles, setTiles] = useState<TileGrid>(() => boardToTiles(mapDefinition));
  const [brush, setBrush] = useState<TileKind>('startA');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [importCode, setImportCode] = useState('');

  const height = tiles.length;
  const width = height > 0 ? tiles[0].length : 0;

  const refresh = useCallback(async () => {
    try {
      setMaps(await listMaps());
    } catch (e) {
      setNotice(`맵 목록을 불러오지 못했습니다: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const board = useMemo(() => tilesToBoard(tiles), [tiles]);
  const errors = useMemo(() => validateMap(board), [board]);
  const warnings = useMemo(() => mapWarnings(board), [board]);

  // 드래그로 이어 칠하기. 버튼을 누른 채 지나간 칸을 모두 칠한다 — 벽 한 줄을 그으려고 스무 번
  // 클릭하게 만들면 맵을 만들다 지친다.
  const painting = useRef(false);
  useEffect(() => {
    const stop = () => {
      painting.current = false;
    };
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, []);

  function paint(x: number, y: number) {
    setTiles((prev) => {
      if (prev[y][x] === brush) return prev; // 같은 값이면 리렌더를 만들지 않는다(드래그 중 매 칸 호출된다)
      const next = prev.map((row) => [...row]);
      next[y][x] = brush;
      return next;
    });
  }

  function changeSize(nextWidth: number, nextHeight: number) {
    const w = Math.min(MAX_MAP_SIZE, Math.max(MIN_MAP_SIZE, nextWidth || MIN_MAP_SIZE));
    const h = Math.min(MAX_MAP_SIZE, Math.max(MIN_MAP_SIZE, nextHeight || MIN_MAP_SIZE));
    setTiles((prev) => resizeTiles(prev, w, h));
  }

  function loadMap(map: CustomMap) {
    setMapId(map.id);
    setName(map.name);
    setTiles(boardToTiles(map.board));
    setNotice(null);
  }

  function startBlank() {
    setMapId(null);
    setName('새 맵');
    setTiles(blankTiles(13, 19));
    setNotice(null);
  }

  function startFromDefault() {
    setMapId(null);
    setName('정원 사본');
    setTiles(boardToTiles(mapDefinition));
    setNotice(null);
  }

  async function handleSave(asNew: boolean) {
    if (errors.length > 0) return;
    setBusy(true);
    try {
      const record: CustomMap = {
        id: asNew || !mapId ? newMapId() : mapId,
        name: name.trim() || '이름 없는 맵',
        updatedAt: Date.now(),
        board,
      };
      const saved = await saveMap(record);
      setMapId(saved.id);
      await refresh();
      // 지금 대전에 쓰기로 골라 둔 맵을 고쳤다면 그 선택도 갱신해야 한다 — 안 그러면 저장은 됐는데
      // 대전은 예전 판본으로 돌아가 "저장이 안 됐다"고 오해하게 된다.
      if (selectedMap?.id === saved.id) selectMap(saved);
      setNotice(`저장했습니다 — ${saved.name}`);
    } catch (e) {
      setNotice(`저장 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    try {
      await deleteMap(id);
      if (mapId === id) startBlank();
      if (selectedMap?.id === id) selectMap(null);
      await refresh();
      setNotice('삭제했습니다.');
    } catch (e) {
      setNotice(`삭제 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function copyShareCode() {
    const code = encodeMap({ id: mapId ?? newMapId(), name, updatedAt: Date.now(), board });
    try {
      await navigator.clipboard.writeText(code);
      setNotice('공유 코드를 복사했습니다 — 상대에게 붙여넣어 전달하세요.');
    } catch {
      setNotice(code);
    }
  }

  function handleImport() {
    try {
      const imported = decodeMap(importCode);
      setMapId(null);
      setName(imported.name);
      setTiles(boardToTiles(imported.board));
      setImportCode('');
      setNotice('가져왔습니다 — 확인 후 저장하세요.');
    } catch (e) {
      setNotice(`가져오기 실패: ${(e as Error).message}`);
    }
  }

  const canUse = errors.length === 0 && mapId !== null;

  return (
    <div className="map-maker">
      <div className="map-maker-main">
        <div className="map-maker-toolbar">
          <input
            className="map-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="맵 이름"
            maxLength={30}
          />
          <label className="map-size">
            가로
            <input type="number" min={MIN_MAP_SIZE} max={MAX_MAP_SIZE} value={width} onChange={(e) => changeSize(Number(e.target.value), height)} />
          </label>
          <label className="map-size">
            세로
            <input type="number" min={MIN_MAP_SIZE} max={MAX_MAP_SIZE} value={height} onChange={(e) => changeSize(width, Number(e.target.value))} />
          </label>
          <button className="btn-secondary" onClick={startBlank}>
            빈 맵
          </button>
          <button className="btn-secondary" onClick={startFromDefault}>
            정원 맵 복사
          </button>
        </div>

        <div className="palette">
          {TILE_PALETTE.map((t) => (
            <button
              key={t.kind}
              className={`palette-btn${brush === t.kind ? ' active' : ''}`}
              onClick={() => setBrush(t.kind)}
              title={t.hint}
            >
              <span className="palette-swatch" style={{ background: t.color }} />
              <span className="palette-label">{t.label}</span>
              <span className="palette-count">
                {t.kind === 'empty' ? '' : tiles.flat().filter((k) => k === t.kind).length}
              </span>
            </button>
          ))}
        </div>
        <p className="muted">{TILE_PALETTE.find((t) => t.kind === brush)?.hint}</p>

        <svg
          className="map-editor-grid"
          viewBox={`0 0 ${width * CELL} ${height * CELL}`}
          width={width * CELL}
          height={height * CELL}
          onMouseLeave={() => {
            painting.current = false;
          }}
        >
          {tiles.flatMap((row, y) =>
            row.map((kind, x) => (
              <rect
                key={`${x},${y}`}
                x={x * CELL}
                y={y * CELL}
                width={CELL}
                height={CELL}
                fill={KIND_COLOR[kind]}
                stroke="#cbd5e1"
                strokeWidth={0.5}
                cursor="crosshair"
                onMouseDown={() => {
                  painting.current = true;
                  paint(x, y);
                }}
                onMouseEnter={() => {
                  if (painting.current) paint(x, y);
                }}
              />
            )),
          )}
          {/* 힐팩은 두 등급의 초록이 비슷해서 색만으로는 구분이 안 된다 — 회복량을 그대로 적는다. */}
          {tiles.flatMap((row, y) =>
            row.map((kind, x) =>
              kind === 'heal10' || kind === 'heal20' ? (
                <text
                  key={`t-${x},${y}`}
                  x={x * CELL + CELL / 2}
                  y={y * CELL + CELL / 2 + 3}
                  textAnchor="middle"
                  fontSize={9}
                  fontWeight="bold"
                  fill="#14532d"
                  pointerEvents="none"
                >
                  {kind === 'heal10' ? 10 : 20}
                </text>
              ) : null,
            ),
          )}
        </svg>

        {errors.length > 0 && (
          <ul className="map-errors">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {errors.length === 0 && warnings.length > 0 && (
          <ul className="map-warnings">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        <div className="map-maker-actions">
          <button className="btn-primary" onClick={() => handleSave(false)} disabled={busy || errors.length > 0}>
            {mapId ? '저장' : '새로 저장'}
          </button>
          <button className="btn-secondary" onClick={() => handleSave(true)} disabled={busy || errors.length > 0}>
            다른 이름으로 저장
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              const target = maps.find((m) => m.id === mapId);
              if (target) selectMap(target);
              setNotice(target ? `대전 맵으로 골랐습니다 — ${target.name}` : null);
            }}
            disabled={!canUse}
            title={canUse ? undefined : '먼저 저장해야 대전에 쓸 수 있습니다.'}
          >
            이 맵으로 대전
          </button>
          <button className="btn-secondary" onClick={() => setShareOpen((v) => !v)}>
            공유
          </button>
          <button className="btn-secondary" onClick={backToMenu}>
            메뉴로
          </button>
        </div>

        {shareOpen && (
          <div className="map-share">
            <button className="btn-secondary" onClick={copyShareCode}>
              공유 코드 복사
            </button>
            <div className="join-row">
              <input value={importCode} onChange={(e) => setImportCode(e.target.value)} placeholder="공유 코드 붙여넣기" spellCheck={false} />
              <button className="btn-secondary" onClick={handleImport} disabled={!importCode.trim()}>
                가져오기
              </button>
            </div>
          </div>
        )}

        {notice && <p className="map-notice">{notice}</p>}
      </div>

      <aside className="map-list">
        <h3>저장된 맵</h3>
        <p className="muted">{storageLabel()}</p>
        {maps.length === 0 && <p className="muted">아직 저장한 맵이 없습니다.</p>}
        <ul>
          {maps.map((m) => (
            <li key={m.id} className={m.id === mapId ? 'active' : undefined}>
              <button className="map-list-name" onClick={() => loadMap(m)}>
                {m.name}
                <span className="muted">
                  {m.board.width}×{m.board.height}
                  {(m.board.healPacks?.length ?? 0) > 0 ? ` · 힐팩 ${m.board.healPacks!.length}` : ''}
                </span>
              </button>
              <button className="map-list-del" onClick={() => handleDelete(m.id)} disabled={busy} title="삭제">
                ×
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
