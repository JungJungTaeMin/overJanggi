import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { DIFFICULTY_ORDER, DIFFICULTY_PROFILES } from '../../ai/difficulty';
import { hostRoom, joinRoom, leaveOnline } from '../../online/netBridge';
import { MapPicker } from '../MapMaker/MapPicker';
import { RosterRulePicker } from './RosterRulePicker';

/**
 * 시작 화면 — 무엇을 상대할지 고른다.
 * 온라인은 방을 연 쪽이 호스트(p1)이고, 코드로 들어온 쪽이 게스트(p2)다.
 */
export function ModeMenu({ onOpenGuide }: { onOpenGuide: () => void }) {
  const startLocal = useGameStore((s) => s.startLocal);
  const startAi = useGameStore((s) => s.startAi);
  const quickStart = useGameStore((s) => s.quickStart);
  const aiDifficulty = useGameStore((s) => s.aiDifficulty);
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
      {/* 처음 온 사람이 눌러야 할 단 하나의 버튼. 편성·배치는 규칙을 익히기 전에는 무슨 선택인지도
          모르는 채 12번을 눌러야 하는 구간이라, 기본 경로에서는 통째로 건너뛴다. */}
      <section className="mode-card quick-start-card">
        <h2>바로 시작</h2>
        <p>
          추천 편성과 자동 배치로 <strong>AI {DIFFICULTY_PROFILES[aiDifficulty].label}</strong> 대전을 곧장
          시작합니다. 편성과 배치를 직접 고르고 싶으면 아래 모드를 고르세요.
        </p>
        <div className="quick-start-row">
          <button className="btn-primary btn-quick-start" onClick={quickStart}>
            클릭 한 번으로 시작
          </button>
          {/* 규칙을 아예 모르는 사람에게는 "시작" 옆이 유일하게 눈에 들어오는 자리다. */}
          <button type="button" className="btn-secondary" onClick={onOpenGuide}>
            처음이신가요? 게임 방법 보기
          </button>
        </div>
      </section>

      {/* 맵을 모드 버튼보다 위에 둔다 — 모드 버튼을 누르면 곧바로 판이 시작되므로, 아래에 있으면
          맵을 고르기 전에 시작돼 버린다. */}
      <MapPicker />
      {/* 규칙도 같은 이유로 위에 있어야 한다. */}
      <RosterRulePicker />

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
