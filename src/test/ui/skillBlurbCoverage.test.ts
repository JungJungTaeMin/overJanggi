import { describe, expect, it } from 'vitest';
import { unitTypes } from '../../data/unitTypes';
import { SKILL_BLURB } from '../../components/Guide/GuideOverlay';

/**
 * **도움말이 모든 기술을 설명하는지.**
 *
 * 도움말은 기술 한 줄을 `SKILL_BLURB[skill.id] ?? ''`로 그린다 — 표에 없는 기술은 기술 이름과
 * 사거리·쿨타임만 뜨고 **설명 칸이 빈 줄**이 된다. 지워지는 게 아니라 비어 있는 것이라 화면을
 * 훑어봐서는 "이 기술은 원래 설명이 짧구나"와 구별이 안 된다(unitGlyphCoverage와 같은 종류의
 * 누락이다).
 *
 * 목록을 베껴 적지 않고 `unitTypes`를 그대로 도니까, 기물을 추가하고 설명을 빠뜨리면 이 테스트가
 * 그 기술 id를 이름 대고 알려 준다.
 */
describe('도움말 기술 설명 — 설명 없는 기술이 없다', () => {
  const allSkillIds = unitTypes.flatMap((t) => t.skills.map((s) => s.id));

  it('모든 기술에 설명 문장이 있다', () => {
    const missing = allSkillIds.filter((id) => !SKILL_BLURB[id]?.trim());
    expect(missing, `GuideOverlay의 SKILL_BLURB에 설명이 없는 기술: ${missing.join(', ')}`).toEqual([]);
  });

  /**
   * 반대 방향의 누락도 잡는다. 기물을 지우거나 기술 id를 바꾸면 설명만 표에 남는데, 그건 화면에
   * 아예 안 나오므로 영원히 안 들킨다 — 그리고 다음 사람이 그 낡은 문장을 규칙으로 믿는다.
   */
  it('없는 기술의 설명이 표에 남아 있지 않다', () => {
    const orphans = Object.keys(SKILL_BLURB).filter((id) => !allSkillIds.includes(id));
    expect(orphans, `기물 데이터에 없는데 설명만 남은 기술: ${orphans.join(', ')}`).toEqual([]);
  });
});
