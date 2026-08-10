import type { Owner } from '../../engine/types';
import { unitTypes } from '../../data/unitTypes';
import { ROSTER_SIZE } from '../../data/constants';
import { useGameStore } from '../../store/gameStore';

const ROLE_LABEL: Record<string, string> = { tank: '탱커', dealer: '딜러', support: '지원' };

function DraftColumn({ owner, label, readOnly }: { owner: Owner; label: string; readOnly: boolean }) {
  const picks = useGameStore((s) => s.draftPicks[owner]);
  const togglePick = useGameStore((s) => s.togglePick);

  return (
    <div className={`draft-column${readOnly ? ' read-only' : ''}`}>
      <h3>
        {label} — {picks.length}/{ROSTER_SIZE}
      </h3>
      {/* 내 편성이 아니면 고를 목록 자체를 보여 주지 않는다 — 상대가 이미 고른 결과만 확인한다. */}
      {readOnly ? (
        <ul>
          {picks.map((id, i) => {
            const t = unitTypes.find((u) => u.id === id);
            return (
              <li key={i}>
                <span className="draft-readonly-item">
                  [{t ? ROLE_LABEL[t.role] : '?'}] {t?.name ?? id}
                </span>
              </li>
            );
          })}
          {picks.length === 0 && <li className="muted">아직 고르는 중…</li>}
        </ul>
      ) : (
        <ul>
          {unitTypes.map((t) => {
            const count = picks.filter((p) => p === t.id).length;
            const disabled = picks.length >= ROSTER_SIZE && count === 0;
            return (
              <li key={t.id}>
                <button onClick={() => togglePick(owner, t.id)} disabled={disabled && count === 0}>
                  [{ROLE_LABEL[t.role]}] {t.name} {count > 0 ? `(x${count})` : ''}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div style={{ fontSize: 13, color: 'var(--muted)' }}>
        선택됨: {picks.map((id) => unitTypes.find((t) => t.id === id)?.name ?? id).join(', ') || '없음'}
      </div>
    </div>
  );
}

export function UnitPicker() {
  const draftPicks = useGameStore((s) => s.draftPicks);
  const confirmDraft = useGameStore((s) => s.confirmDraft);
  const mode = useGameStore((s) => s.mode);
  const localOwner = useGameStore((s) => s.localOwner);
  const ready = draftPicks.p1.length === ROSTER_SIZE && draftPicks.p2.length === ROSTER_SIZE;
  // 로컬 대전에서만 한 사람이 양쪽을 다 고른다. AI·온라인에서는 상대 편성이 읽기 전용이다.
  const readOnlyFor = (owner: Owner) => mode !== 'local' && owner !== localOwner;
  const opponentLabel = mode === 'ai' ? 'AI (Player 2)' : 'Player 2';

  return (
    <div>
      <h2>드래프트 — 각 플레이어 5기물 선택 (중복 선택 가능)</h2>
      <div className="draft-columns">
        <DraftColumn owner="p1" label={mode === 'ai' ? '나 (Player 1)' : 'Player 1'} readOnly={readOnlyFor('p1')} />
        <DraftColumn owner="p2" label={opponentLabel} readOnly={readOnlyFor('p2')} />
      </div>
      <button onClick={confirmDraft} disabled={!ready} className="btn-primary" style={{ marginTop: 16, padding: '8px 16px' }}>
        배치 단계로
      </button>
    </div>
  );
}
