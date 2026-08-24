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
