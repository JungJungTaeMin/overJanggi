/**
 * 기물 10종 + 포탑의 스탯 시트를 **데이터에서 직접 생성**한다. 분석 도구다. 앱 번들에 안 들어간다.
 *
 * 손으로 적은 표는 반드시 어긋난다 — 실제로 이 프로젝트에서 dealer1의 공격력 8이 테스트 6곳에
 * 하드코딩돼 있다가 값을 10으로 바꾸는 순간 전부 깨졌다. 그래서 표를 문서에 박아 두는 대신
 * unitTypes.ts와 skillRange.ts를 읽어서 그때그때 뽑는다. 이 스크립트의 출력이 곧 현재 진실이다.
 *
 * 실행: npx vite-node scripts/unitSheet.ts
 */
import { unitTypes, turretType, maxHpFor } from '../src/data/unitTypes';
import { SKILL_AXIS } from '../src/engine/skillRange';
import { HP_MULTIPLIER, WIN_SCORE, RESPAWN_TURNS, ROSTER_SIZE } from '../src/data/constants';
import type { SkillDef, UnitTypeDef } from '../src/engine/types';

const AXIS_KO: Record<string, string> = {
  orthogonal: '직선',
  diagonal: '대각',
  both: '직선+대각',
  radius: '반경',
};

const ROLE_KO: Record<string, string> = { tank: '탱커', dealer: '딜러', support: '지원' };

/** 공격 사거리·모양을 한 칸에 담는다. 못 때리는 기물은 그렇다고 쓴다. */
function attackText(t: UnitTypeDef): string {
  if (!t.canAttack) return '공격 불가';
  const s = t.attackShape;
  if (s.kind === 'aoe') return `전방 ${s.range}칸 + 좌우 ${s.aoeRadius ?? 1}칸 (범위)`;
  // 축마다 사거리가 다르면(dealer3: 직선 4 · 대각 1) 한 숫자로 뭉뚱그리면 안 된다 — 시트를 보고
  // "대각으로도 4칸"이라 읽어 버리면 밸런스 판단이 통째로 어긋난다.
  if (s.axis === 'both' && s.diagonalRange !== undefined && s.diagonalRange !== s.range) {
    return `직선 ${s.range}칸 + 대각 ${s.diagonalRange}칸`;
  }
  return `${AXIS_KO[s.axis]} ${s.range}칸`;
}

/** 기술의 발동 조건(쿨타임/충전/토글/상시)을 사람 말로. */
function gateText(s: SkillDef): string {
  switch (s.gate.type) {
    case 'cooldown':
      return `쿨타임 ${s.gate.turns}턴`;
    case 'charge':
      return `충전 ${s.gate.maxCharges}회`;
    case 'toggle':
      return '토글';
    default:
      return '상시';
  }
}

/** 기술 사거리는 payload의 숫자 + skillRange.ts의 축을 합쳐야 나온다. */
function skillRangeText(s: SkillDef): string {
  const entry = SKILL_AXIS[s.id];
  if (entry) {
    const r = s.payload[entry.rangeKey];
    if (typeof r === 'number') return `${AXIS_KO[entry.axis]} ${r}칸`;
  }
  if (typeof s.payload.radius === 'number') return `반경 ${s.payload.radius}칸`;
  return '—';
}

const pad = (s: string, n: number) => {
  // 한글은 폭 2로 세어야 열이 안 밀린다.
  const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x1100 ? 2 : 1), 0);
  return s + ' '.repeat(Math.max(0, n - w));
};

console.log(`\n=== 기물 스탯 시트 ===`);
console.log(`체력 = 체력Lv × ${HP_MULTIPLIER} · 편성 ${ROSTER_SIZE}기 · 부활 ${RESPAWN_TURNS}턴 · 승리 ${WIN_SCORE}점\n`);

console.log(
  pad('기물', 30) + pad('역할', 6) + pad('이동', 6) + pad('대각이동', 10) + pad('체력', 10) + pad('공격력', 8) + '공격 사거리',
);
console.log('─'.repeat(88));
for (const t of unitTypes) {
  console.log(
    pad(t.name, 30) +
      pad(ROLE_KO[t.role], 6) +
      pad(String(t.moveSpeed), 6) +
      pad(t.diagonalMove ? '가능' : '불가', 10) +
      pad(`${maxHpFor(t)} (Lv${t.hpLv})`, 10) +
      pad(t.canAttack ? String(t.attack) : '—', 8) +
      attackText(t),
  );
}
console.log(
  pad(turretType.name + ' (소환물)', 30) +
    pad(ROLE_KO[turretType.role], 6) +
    pad(String(turretType.moveSpeed), 6) +
    pad('불가', 10) +
    pad(String(maxHpFor(turretType)), 10) +
    pad('—', 8) +
    '공격 불가',
);

console.log(`\n\n=== 기술 · 패시브 ===`);
for (const t of [...unitTypes, turretType]) {
  if (t.skills.length === 0 && !t.passive && !t.attackRestTurns) continue;
  console.log(`\n▸ ${t.name}`);
  if (t.attackRestTurns) {
    console.log(`   [기본공격 제약] ${t.attackShots ?? 1}발 연속 발사 후 ${t.attackRestTurns}턴 휴식`);
  }
  for (const s of t.skills) {
    console.log(`   [기술] ${pad(s.name, 14)} ${pad(gateText(s), 12)} 사거리 ${pad(skillRangeText(s), 12)} 대상 ${s.targeting}`);
    const extras = Object.entries(s.payload).filter(([k]) => k !== 'range' && k !== 'swapRange' && k !== 'radius');
    if (extras.length) console.log(`          ${extras.map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  }
  if (t.passive) {
    console.log(`   [패시브] ${t.passive.description}`);
  }
}
console.log();
