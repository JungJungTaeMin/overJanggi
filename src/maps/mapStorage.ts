import type { BoardConfig } from '../engine/types';

/**
 * 만든 맵의 저장소.
 *
 * **왜 서버가 기본이 아닌가**: 이 프로젝트는 GitHub Pages에 올라가는 정적 사이트라 백엔드가 없다.
 * 온라인 대전조차 서버를 안 쓰고 브라우저끼리 직접 연결(PeerJS)로 처리하고 있다. 그래서 기본
 * 저장소는 이 브라우저의 localStorage이고, **맵 서버 주소(VITE_MAP_SERVER)가 주어지면 그쪽을
 * 그대로 쓴다**. 어댑터를 갈아 끼우는 구조라 나중에 서버가 생겨도 화면 코드는 한 줄도 안 바뀐다.
 *
 * 서버가 없는 동안 "남에게 맵을 넘기는" 수단은 **공유 코드**(encodeMap/decodeMap)다. 맵 하나를
 * 문자열 한 덩이로 만들어 주고받으면 되고, 온라인 대전에서는 어차피 호스트의 맵이 스냅샷에
 * 통째로 실려 게스트에게 전달되므로 상대가 맵을 미리 받아둘 필요는 없다.
 */
export interface CustomMap {
  id: string;
  name: string;
  /** 마지막 저장 시각(ms). 목록 정렬에만 쓴다. */
  updatedAt: number;
  board: BoardConfig;
}

const LOCAL_KEY = 'simultaneous.customMaps.v1';

/** 맵 서버 주소. 빌드 시 주입되며, 비어 있으면 로컬 저장소로 동작한다. */
const SERVER_URL: string = (import.meta.env.VITE_MAP_SERVER as string | undefined)?.replace(/\/$/, '') ?? '';

export type StorageMode = 'server' | 'local';

export function storageMode(): StorageMode {
  return SERVER_URL ? 'server' : 'local';
}

export function storageLabel(): string {
  return SERVER_URL ? `맵 서버 (${SERVER_URL})` : '이 브라우저에 저장';
}

export function newMapId(): string {
  return `map_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function readLocal(): CustomMap[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomMap[]) : [];
  } catch {
    // 저장 형식이 깨졌다고 앱이 멈추면 안 된다 — 목록이 비어 보이는 편이 낫다.
    return [];
  }
}

function writeLocal(maps: CustomMap[]): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(maps));
}

async function serverFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`맵 서버 오류 ${res.status}`);
  return res.status === 204 ? null : res.json();
}

export async function listMaps(): Promise<CustomMap[]> {
  const maps = SERVER_URL ? ((await serverFetch('/maps')) as CustomMap[]) : readLocal();
  return [...maps].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveMap(map: CustomMap): Promise<CustomMap> {
  const record: CustomMap = { ...map, updatedAt: Date.now() };
  if (SERVER_URL) {
    return (await serverFetch(`/maps/${encodeURIComponent(record.id)}`, {
      method: 'PUT',
      body: JSON.stringify(record),
    })) as CustomMap;
  }
  const maps = readLocal();
  const idx = maps.findIndex((m) => m.id === record.id);
  if (idx >= 0) maps[idx] = record;
  else maps.push(record);
  writeLocal(maps);
  return record;
}

export async function deleteMap(id: string): Promise<void> {
  if (SERVER_URL) {
    await serverFetch(`/maps/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return;
  }
  writeLocal(readLocal().filter((m) => m.id !== id));
}

/**
 * 공유 코드 — 맵 하나를 문자열로 접는다.
 *
 * `btoa`는 바이트 단위라 한글 이름이 들어간 JSON을 그대로 넣으면 던진다. TextEncoder로 UTF-8
 * 바이트를 만든 뒤 base64로 바꾸고, URL/채팅에 붙여도 깨지지 않도록 `+/` 를 `-_` 로 바꾼다.
 */
export function encodeMap(map: CustomMap): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ name: map.name, board: map.board }));
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeMap(code: string): CustomMap {
  const normalized = code.trim().replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { name?: string; board?: BoardConfig };
  if (!parsed.board || typeof parsed.board.width !== 'number' || !parsed.board.startZones) {
    throw new Error('맵 코드 형식이 아닙니다.');
  }
  // 가져온 맵은 **항상 새 id**를 받는다 — 남의 맵을 불러왔다가 내 같은 id 맵을 덮어쓰는 일을 막는다.
  return { id: newMapId(), name: parsed.name || '가져온 맵', updatedAt: Date.now(), board: parsed.board };
}
