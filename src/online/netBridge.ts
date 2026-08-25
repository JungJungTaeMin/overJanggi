import Peer, { type DataConnection } from 'peerjs';
import {
  applyRemoteAction,
  applySnapshot,
  setNetAdapter,
  storeSnapshot,
  useGameStore,
  type RemoteAction,
  type StoreSnapshot,
} from '../store/gameStore';

/**
 * PeerJS(WebRTC) 1:1 대전.
 *
 * 서버가 없으므로 **호스트가 곧 서버**다(호스트 권위). 게스트는 자기 스토어를 직접 고치지 않고
 * "이 동작을 실행해 달라"는 원격 호출만 보내고, 호스트가 적용한 뒤 전체 스냅샷을 돌려준다.
 * 이렇게 하면 무작위 선공권처럼 재현 불가능한 요소가 들어가는 해결 단계도 **한 곳에서만** 굴러
 * 두 화면이 어긋날 수 없다. 이 게임은 원래 정보 은닉이 없는 설계라(양쪽 계획을 한 화면에 띄우는
 * 디버그 모드) 상태를 통째로 복제해도 규칙상 문제가 없다.
 */

type NetMessage = { kind: 'snapshot'; snapshot: StoreSnapshot } | { kind: 'action'; action: RemoteAction };

/** PeerJS 공개 브로커는 전 세계가 같이 쓰므로 id 충돌을 피하려고 접두어를 붙인다. */
const ROOM_PREFIX = 'simultaneous-';
/** 헷갈리기 쉬운 0/O, 1/I를 뺀 방 코드 알파벳. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let peer: Peer | null = null;
let conn: DataConnection | null = null;
let unsubscribeBroadcast: (() => void) | null = null;

function randomRoomCode(length = 6): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function send(message: NetMessage): void {
  if (conn?.open) conn.send(message);
}

function setOnline(patch: Parameters<ReturnType<typeof useGameStore.getState>['setOnlineState']>[0]): void {
  useGameStore.getState().setOnlineState(patch);
}

/** 호스트만 실행: 스토어가 바뀔 때마다 게스트에게 전체 상태를 흘려보낸다. */
function startHostBroadcast(): void {
  unsubscribeBroadcast?.();
  unsubscribeBroadcast = useGameStore.subscribe((s, prev) => {
    const changed =
      s.stage !== prev.stage ||
      s.state !== prev.state ||
      s.plans !== prev.plans ||
      s.draftPicks !== prev.draftPicks ||
      s.placementPositions !== prev.placementPositions ||
      s.lastLog !== prev.lastLog ||
      // 재생도 게스트에게 가야 한다 — 안 보내면 게스트 화면에서는 턴이 여전히 한 번에 튄다.
      s.replay !== prev.replay ||
      // 규칙·맵은 메뉴에서만 바뀌지만, 연결 뒤에 호스트가 메뉴로 돌아가 바꾸고 다시 시작할 수 있다.
      s.rosterRule !== prev.rosterRule ||
      s.selectedMap !== prev.selectedMap;
    if (changed) send({ kind: 'snapshot', snapshot: storeSnapshot() });
  });
}

function describeError(err: unknown): string {
  const type = (err as { type?: string })?.type;
  if (type === 'peer-unavailable') return '그런 방이 없습니다. 코드를 다시 확인하세요.';
  if (type === 'unavailable-id') return '같은 방 코드가 이미 쓰이고 있습니다. 다시 만들어 주세요.';
  if (type === 'network' || type === 'server-error') return '중계 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.';
  return (err as { message?: string })?.message ?? '알 수 없는 연결 오류';
}

function handleDisconnect(): void {
  conn = null;
  setNetAdapter(null);
  unsubscribeBroadcast?.();
  unsubscribeBroadcast = null;
  setOnline({ status: 'error', error: '상대와의 연결이 끊어졌습니다.' });
}

/** 방을 연다. 코드를 상대에게 알려 주면 상대가 joinRoom으로 들어온다. */
export function hostRoom(): void {
  leaveOnline();
  const code = randomRoomCode();
  setOnline({ role: 'host', roomId: code, status: 'connecting', error: null });

  peer = new Peer(ROOM_PREFIX + code);
  peer.on('open', () => setOnline({ status: 'waiting' }));
  peer.on('error', (err) => setOnline({ status: 'error', error: describeError(err) }));
  peer.on('connection', (incoming) => {
    // 1:1 전용 — 이미 상대가 있으면 새 연결은 거절한다.
    if (conn) {
      incoming.close();
      return;
    }
    conn = incoming;
    incoming.on('open', () => {
      setNetAdapter({ role: 'host', sendAction: () => {} });
      useGameStore.getState().startOnline('host');
      startHostBroadcast();
      send({ kind: 'snapshot', snapshot: storeSnapshot() });
    });
    incoming.on('data', (raw) => {
      const message = raw as NetMessage;
      if (message?.kind === 'action') applyRemoteAction(message.action);
    });
    incoming.on('close', handleDisconnect);
  });
}

/** 방 코드로 들어간다. */
export function joinRoom(code: string): void {
  leaveOnline();
  const roomId = code.trim().toUpperCase();
  setOnline({ role: 'guest', roomId, status: 'connecting', error: null });

  peer = new Peer();
  peer.on('error', (err) => setOnline({ status: 'error', error: describeError(err) }));
  peer.on('open', () => {
    const outgoing = peer!.connect(ROOM_PREFIX + roomId, { reliable: true });
    conn = outgoing;
    outgoing.on('open', () => {
      setNetAdapter({ role: 'guest', sendAction: (action) => send({ kind: 'action', action }) });
      // 화면을 게스트(p2) 시점으로 바꾼다. 실제 진행 상황은 곧 도착할 스냅샷이 덮어쓴다.
      useGameStore.getState().startOnline('guest');
    });
    outgoing.on('data', (raw) => {
      const message = raw as NetMessage;
      if (message?.kind === 'snapshot') applySnapshot(message.snapshot);
    });
    outgoing.on('close', handleDisconnect);
  });
}

/** 연결을 완전히 정리한다(메뉴로 돌아갈 때). */
export function leaveOnline(): void {
  unsubscribeBroadcast?.();
  unsubscribeBroadcast = null;
  setNetAdapter(null);
  conn?.close();
  conn = null;
  peer?.destroy();
  peer = null;
}
