import type { Owner } from '../../engine/types';
import { unitTypes } from '../../data/unitTypes';
import { ROSTER_SIZE } from '../../data/constants';
import { ROSTER_RULES, canAddPick, isRosterLegal, rosterViolation, tankCount } from '../../data/rosterRules';
import { useGameStore } from '../../store/gameStore';
import { canSeeHiddenInfo } from '../visibility';

const ROLE_LABEL: Record<string, string> = { tank: '탱커', dealer: '딜러', support: '지원' };

function DraftColumn({
  owner,
  label,
  readOnly,
  hidden,
}: {
  owner: Owner;
  label: string;
  readOnly: boolean;
  /** 이름을 감추고 진행도(몇 기 골랐는지)만 보여 준다 — 온라인 상대 편성. */
  hidden?: boolean;
}) {
  const picks = useGameStore((s) => s.draftPicks[owner]);
  const togglePick = useGameStore((s) => s.togglePick);
  const autoFillDraft = useGameStore((s) => s.autoFillDraft);
  const rosterRule = useGameStore((s) => s.rosterRule);
  const quota = ROSTER_RULES[rosterRule].tankQuota;

  return (
    <div className={`draft-column${readOnly ? ' read-only' : ''}`}>
      <div className="draft-column-head">
        <h3>
          {label} — {picks.length}/{ROSTER_SIZE}
          {/* 탱커 수가 제한된 규칙에서는 "몇 기 중 몇 기를 썼는가"가 곧 남은 선택지다.
              감춘 편성에서는 탱커 수도 편성의 일부이므로 같이 감춘다. */}
          {quota !== null && !hidden && <span className="draft-quota"> · 탱커 {tankCount(picks)}/{quota}</span>}
        </h3>
        {/* 다섯 번 고르는 대신 한 번. 어느 기물이 센지 모르는 상태에서는 이게 유일하게 근거 있는 선택이다. */}
        {!readOnly && (
          <button type="button" className="btn-auto-fill" onClick={() => autoFillDraft(owner)}>
            추천 편성
          </button>
        )}
      </div>
      {/* 내 편성이 아니면 고를 목록 자체를 보여 주지 않는다 — 상대가 이미 고른 결과만 확인한다. */}
      {hidden ? (
        <ul>
          <li className="muted">{picks.length === ROSTER_SIZE ? '편성 완료 — 판에서 확인' : '고르는 중…'}</li>
        </ul>
      ) : readOnly ? (
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
            // 규칙에 막혀 더 담을 수 없는 기물은 잠근다. 이미 담은 기물은 **빼기**가 남아 있어야
            // 하므로 잠그지 않는다 — 규칙 위반 상태를 되돌릴 길이 사라지면 안 된다.
            const disabled = count === 0 && !canAddPick(picks, t.id, rosterRule);
            return (
              <li key={t.id}>
                <button
                  onClick={() => togglePick(owner, t.id)}
                  disabled={disabled}
                  title={disabled && t.role === 'tank' ? `${ROSTER_RULES[rosterRule].label} — 탱커 자리를 이미 채웠습니다` : undefined}
                >
                  [{ROLE_LABEL[t.role]}] {t.name} {count > 0 ? `(x${count})` : ''}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div style={{ fontSize: 13, color: 'var(--muted)' }}>
        {hidden
          ? '상대 편성은 배치가 끝나고 판 위에서 드러납니다.'
          : `선택됨: ${picks.map((id) => unitTypes.find((t) => t.id === id)?.name ?? id).join(', ') || '없음'}`}
      </div>
    </div>
  );
}

export function UnitPicker() {
  const draftPicks = useGameStore((s) => s.draftPicks);
  const confirmDraft = useGameStore((s) => s.confirmDraft);
  const mode = useGameStore((s) => s.mode);
  const localOwner = useGameStore((s) => s.localOwner);
  const rosterRule = useGameStore((s) => s.rosterRule);
  const rule = ROSTER_RULES[rosterRule];
  const ready = isRosterLegal(draftPicks.p1, rosterRule) && isRosterLegal(draftPicks.p2, rosterRule);
  // 로컬 대전에서만 한 사람이 양쪽을 다 고른다. AI·온라인에서는 상대 편성이 읽기 전용이다.
  const readOnlyFor = (owner: Owner) => mode !== 'local' && owner !== localOwner;
  // 온라인은 읽기 전용을 넘어 **아예 감춘다** — 상대가 고르는 걸 실시간으로 보면서 맞춰 고르면
  // 나중에 확정하는 쪽이 언제나 유리해진다(배치를 감추는 것과 같은 이유).
  const hiddenFor = (owner: Owner) => !canSeeHiddenInfo(mode, localOwner, owner);
  const opponentLabel = mode === 'ai' ? 'AI (Player 2)' : 'Player 2';
  // 확정 버튼이 잠겼을 때 **내 편성의** 사유를 보여 준다(상대 편성은 내가 손댈 수 없다).
  const myViolation = rosterViolation(draftPicks[mode === 'local' ? 'p1' : localOwner], rosterRule);

  return (
    <div>
      <h2>드래프트 — 각 플레이어 5기물 선택 (중복 선택 가능)</h2>
      <p className="draft-rule-note">
        편성 규칙 · <strong>{rule.label}</strong> — {rule.summary}
      </p>
      <div className="draft-columns">
        <DraftColumn
          owner="p1"
          label={mode === 'ai' ? '나 (Player 1)' : 'Player 1'}
          readOnly={readOnlyFor('p1')}
          hidden={hiddenFor('p1')}
        />
        <DraftColumn owner="p2" label={opponentLabel} readOnly={readOnlyFor('p2')} hidden={hiddenFor('p2')} />
      </div>
      {!ready && myViolation && <p className="draft-rule-warning">{myViolation}</p>}
      <button onClick={confirmDraft} disabled={!ready} className="btn-primary" style={{ marginTop: 16, padding: '8px 16px' }}>
        배치 단계로
      </button>
    </div>
  );
}
