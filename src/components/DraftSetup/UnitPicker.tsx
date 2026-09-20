import type { Owner, Role } from '../../engine/types';
import { unitTypes } from '../../data/unitTypes';
import { ROSTER_RULES, canAddPick, isRosterLegal, roleCount, rosterViolation } from '../../data/rosterRules';
import { useGameStore } from '../../store/gameStore';
import { canSeeHiddenInfo } from '../visibility';
import { UnitMark } from '../unitGlyphs';

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
  const rule = ROSTER_RULES[rosterRule];
  const quotaEntries = Object.entries(rule.roleQuota ?? {}) as [Role, number][];

  return (
    <div className={`draft-column${readOnly ? ' read-only' : ''}`}>
      <div className="draft-column-head">
        <h3>
          {label} — {picks.length}/{rule.size}
          {/* 역할 정원이 있는 규칙에서는 "몇 기 중 몇 기를 썼는가"가 곧 남은 선택지다. 총원만
              보여 주면 6대6에서 "6/6인데 왜 확정이 안 되지"가 된다(역할이 어긋난 것이다).
              감춘 편성에서는 역할 구성도 편성의 일부이므로 같이 감춘다. */}
          {!hidden &&
            quotaEntries.map(([role, limit]) => (
              <span key={role} className="draft-quota">
                {' '}
                · {ROLE_LABEL[role]} {roleCount(picks, role)}/{limit}
              </span>
            ))}
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
          <li className="muted">{picks.length === rule.size ? '편성 완료 — 판에서 확인' : '고르는 중…'}</li>
        </ul>
      ) : readOnly ? (
        <ul>
          {picks.map((id, i) => {
            const t = unitTypes.find((u) => u.id === id);
            return (
              <li key={i}>
                <span className="draft-readonly-item">
                  {t && <UnitMark typeId={t.id} size={17} />}
                  <span className="draft-role-tag">{t ? ROLE_LABEL[t.role] : '?'}</span>
                  {t?.name ?? id}
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
            // 잠긴 이유는 둘 중 하나다: 그 역할 정원이 찼거나, 남은 자리가 다른 역할 몫이거나.
            const roleFull = quotaEntries.some(([role, limit]) => role === t.role && roleCount(picks, role) >= limit);
            return (
              <li key={t.id}>
                <button
                  onClick={() => togglePick(owner, t.id)}
                  disabled={disabled}
                  title={
                    disabled
                      ? `${rule.label} — ${roleFull ? `${ROLE_LABEL[t.role]} 자리를 이미 채웠습니다` : '남은 자리는 다른 역할 몫입니다'}`
                      : undefined
                  }
                >
                  {/* 역할을 `[탱커]`라고 적는 대신 **판 위 실루엣과 같은 모양**을 세운다(사각/삼각/원).
                      드래프트는 이 게임에서 기물 이름을 처음 보는 자리인데, 여기서 역할이 글자였다가
                      판에서 갑자기 도형이 되면 둘을 잇는 법을 판에서 다시 배워야 한다. */}
                  <UnitMark typeId={t.id} size={17} />
                  <span className="draft-role-tag">{ROLE_LABEL[t.role]}</span>
                  <span className="draft-unit-name">{t.name}</span>
                  {/* 몇 기 담았는지는 「고른 것」이므로 강조색 뱃지로 — `(x2)`는 이름의 일부처럼 읽힌다. */}
                  {count > 0 && <span className="draft-pick-count">×{count}</span>}
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
      <h2>드래프트 — 각 플레이어 {rule.size}기물 선택 (중복 선택 가능)</h2>
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
