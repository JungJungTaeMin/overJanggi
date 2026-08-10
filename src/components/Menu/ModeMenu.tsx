import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { DIFFICULTY_ORDER, DIFFICULTY_PROFILES } from '../../ai/difficulty';
import { hostRoom, joinRoom, leaveOnline } from '../../online/netBridge';

/**
 * 시작 화면 — 무엇을 상대할지 고른다.
 * 온라인은 방을 연 쪽이 호스트(p1)이고, 코드로 들어온 쪽이 게스트(p2)다.
 */
export function ModeMenu() {
  const startLocal = useGameStore((s) => s.startLocal);
  const startAi = useGameStore((s) => s.startAi);
  const online = useGameStore((s) => s.online);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  const waiting = online.role === 'host' && online.status === 'waiting';
  const connecting = online.status === 'connecting';

  async function copyCode() {
    if (!online.roomId) return;
    try {
      await navigator.clipboard.writeText(online.roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mode-menu">
      <section className="mode-card">
        <h2>로컬 대전</h2>
        <p>한 화면에서 두 사람이 번갈아 계획을 세웁니다. 양쪽 계획이 모두 보이는 디버그 모드입니다.</p>
        <button className="btn-primary" onClick={startLocal}>
          시작
        </button>
      </section>

      <section className="mode-card">
        <h2>AI 대전</h2>
        <p>규칙 기반 AI와 겨룹니다. 사람은 Player 1, AI는 Player 2를 맡고 편성·배치도 AI가 스스로 합니다.</p>
        <div className="difficulty-row">
          {DIFFICULTY_ORDER.map((id) => {
            const profile = DIFFICULTY_PROFILES[id];
            return (
              <button key={id} className="difficulty-btn" onClick={() => startAi(id)} title={profile.description}>
                <strong>{profile.label}</strong>
                <span>{profile.description}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mode-card">
        <h2>온라인 대전</h2>
        <p>서버 없이 브라우저끼리 직접 연결(P2P)합니다. 한 사람이 방을 만들고, 다른 사람이 코드를 입력하세요.</p>

        {waiting ? (
          <div className="room-waiting">
            <div className="room-code">
              <span>방 코드</span>
              <code>{online.roomId}</code>
              <button className="btn-secondary" onClick={copyCode}>
                {copied ? '복사됨' : '복사'}
              </button>
            </div>
            <p className="muted">상대가 들어오면 자동으로 드래프트가 시작됩니다.</p>
            <button className="btn-secondary" onClick={leaveOnline}>
              방 닫기
            </button>
          </div>
        ) : (
          <div className="online-row">
            <button className="btn-primary" onClick={hostRoom} disabled={connecting}>
              방 만들기
            </button>
            <div className="join-row">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="방 코드"
                maxLength={8}
                spellCheck={false}
              />
              <button className="btn-secondary" onClick={() => joinRoom(code)} disabled={!code.trim() || connecting}>
                참가
              </button>
            </div>
          </div>
        )}

        {connecting && <p className="muted">연결 중…</p>}
        {online.status === 'error' && online.error && <p className="online-error">{online.error}</p>}
      </section>
    </div>
  );
}
