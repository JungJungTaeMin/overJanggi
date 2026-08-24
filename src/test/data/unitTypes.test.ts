import { describe, expect, it } from 'vitest';
import { turretType, unitTypes } from '../../data/unitTypes';

/**
 * 판 위에서 기물을 알아보는 수단은 **역할 실루엣 3종 + 한 글자 이름**뿐이다. 실루엣은 10종을
 * 3개로 뭉치므로, 같은 역할끼리 갈라 주는 건 이 글자 하나가 전부다 — 겹치면 화면만 보고는
 * 두 기물을 구별할 방법이 사라진다.
 */
describe('shortLabel — 판 위 한 글자 이름', () => {
  it('10종 + 포탑이 전부 서로 다르다', () => {
    const labels = [...unitTypes, turretType].map((t) => t.shortLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('한 글자다 — 토큰 안에 들어가야 하므로 길어지면 안 된다', () => {
    for (const t of [...unitTypes, turretType]) {
      expect([...t.shortLabel], t.id).toHaveLength(1);
    }
  });
});

/**
 * 패시브 설명은 **손으로 적은 문장**이라 수치를 조정하면 조용히 낡는다. 실제로 이번에 조건을
 * 1명 → 2명으로 조이면서 설명은 "다른 적과 인접한 대상"인 채로 남아 도움말이 옛 조건을 말하고
 * 있었다. 문장 자체를 자동 생성하지는 않되(어색해진다), **숫자가 어긋나는 것만은** 여기서 막는다.
 */
describe('패시브 설명 — 문장의 숫자가 데이터와 같은가', () => {
  it('측면 보너스 설명에 실제 피해량과 인접 문턱이 그대로 적혀 있다', () => {
    const passive = unitTypes.find((t) => t.id === 'dealer4')!.passive!;
    const { bonusDamage, minAdjacentAllies } = passive.payload!;
    expect(passive.description).toContain(String(bonusDamage));
    expect(passive.description).toContain(String(minAdjacentAllies));
  });

  it('동전 설명에 앞면·뒷면 수치가 전부 적혀 있다', () => {
    const passive = unitTypes.find((t) => t.id === 'support3')!.passive!;
    const p = passive.payload!;
    for (const key of ['headsMove', 'headsAttack', 'headsRange', 'tailsMove', 'tailsAttack', 'tailsRange'] as const) {
      expect(passive.description, key).toContain(String(p[key]));
    }
  });
});
