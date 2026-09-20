import { describe, expect, it } from 'vitest';
import { unitTypes, turretType } from '../../data/unitTypes';
import { hasUnitGlyph } from '../../components/unitGlyphs';

/**
 * **판 위에서 기물을 알아볼 수 있는지.**
 *
 * 토큰에서 한 글자 이름을 걷어내고 그림기호로 바꿨다(unitGlyphs.tsx). 그래서 기호가 없는 기물은
 * 이제 「기호가 빠진 기물」이 아니라 **민무늬 도형**으로 그려진다 — 없는 게 아니라 있는데 안 보이는
 * 꼴이라, 화면을 봐도 빠진 줄 모른다. 상태이상 이름이 빠지면 raw id가 튀어나와 눈에 띄던 것과
 * 정반대다(effectLabels.ts).
 *
 * 눈으로 못 잡는 종류의 누락이므로 여기서 잡는다. 목록을 베껴 적지 않고 `unitTypes`를 그대로
 * 도니까, 기물을 추가하고 기호를 빠뜨리면 이 테스트가 그 id를 이름 대고 알려 준다.
 */
describe('기물 그림기호 — 판 위에 민무늬 기물이 없다', () => {
  it('모든 기물 종류에 그림기호가 있다', () => {
    const missing = [...unitTypes, turretType].map((t) => t.id).filter((id) => !hasUnitGlyph(id));
    expect(missing, `unitGlyphs.tsx에 기호가 없는 기물: ${missing.join(', ')}`).toEqual([]);
  });
});
