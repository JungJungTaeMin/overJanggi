import { useGameStore } from '../../store/gameStore';
import { ROSTER_RULES, ROSTER_RULE_ORDER } from '../../data/rosterRules';

/**
 * 대전 전에 편성 규칙을 고르는 칸. 맵과 같은 층위의 선택이라 맵 바로 아래에 둔다 —
 * 규칙은 로컬·AI·온라인 세 모드에 모두 적용되므로 모드 카드 안에 넣으면 세 번 적어야 한다.
 *
 * 맵과 마찬가지로 온라인에서는 **호스트가 고른 규칙**이 스냅샷으로 전달된다.
 */
export function RosterRulePicker() {
  const rosterRule = useGameStore((s) => s.rosterRule);
  const setRosterRule = useGameStore((s) => s.setRosterRule);

  return (
    <section className="mode-card">
      <h2>편성 규칙</h2>
      <p>드래프트에서 5기물을 어떻게 고를 수 있는지 정합니다. 기물 스탯은 규칙과 무관하게 같습니다.</p>
      <div className="rule-choice-row">
        {ROSTER_RULE_ORDER.map((id) => {
          const rule = ROSTER_RULES[id];
          return (
            <button
              key={id}
              className={`rule-choice${rosterRule === id ? ' active' : ''}`}
              onClick={() => setRosterRule(id)}
            >
              <strong>{rule.label}</strong>
              <span>{rule.summary}</span>
            </button>
          );
        })}
      </div>
      <p className="muted">온라인 대전에서는 방을 만든 쪽(호스트)이 고른 규칙으로 진행됩니다.</p>
    </section>
  );
}
