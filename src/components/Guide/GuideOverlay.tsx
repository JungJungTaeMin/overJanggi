import { useEffect } from 'react';
import type { BoardConfig, Position, UnitTypeDef } from '../../engine/types';
import { unitTypes, maxHpFor } from '../../data/unitTypes';
import { CAPTURE_MARGIN, RESPAWN_TURNS, WIN_SCORE } from '../../data/constants';
import { mapDefinition } from '../../data/mapDefinitions';
import { captureWinner } from '../../engine/capture';
import { useGameStore } from '../../store/gameStore';
import { MiniBoard, type MiniMark, type MiniToken } from './MiniBoard';
import { DIAGRAM_BOARD, DIAGRAM_ORIGIN, unitDiagram } from './rangeDiagram';
import { attackPowerLabel, attackRangeLabel, moveRangeLabel, skillGateLabel, skillReachLabel } from '../statLabels';
import { PHASE_NAME } from '../phaseLabels';

const ROLE_LABEL: Record<string, string> = { tank: '탱커', dealer: '딜러', support: '지원' };

/**
 * 기술이 **무엇을 하는지**만 손으로 적는다. 숫자(사거리·쿨타임·지속)는 전부 데이터에서 읽으므로
 * 밸런스를 고쳐도 이 문장은 낡지 않는다 — 낡을 수 있는 값은 여기 한 글자도 없다.
 */
const SKILL_BLURB: Record<string, string> = {
  tank1_fortify: '한 턴 동안 최대 체력과 보호막을 얻고 한 칸 더 움직인다.',
  tank2_charge: '지나간 칸 수만큼 경로 위의 적을 들이받는다. 적을 밟고 지나갈 수 있다.',
  tank3_barrier: '한 턴 동안 자신을 향한 직선 공격을 막는 방벽을 세운다.',
  tank3_root: '적 하나를 한 턴 동안 못 움직이게 묶는다.',
  dealer2_rewind_move: '이동을 한 번 더 한다. 충전을 다 쓰면 처음 쓴 시점의 자리와 체력으로 되돌아간다.',
  dealer3_attack_mode: '켜면 공격할 수 있고, 켜져 있는 동안은 움직일 수 없다.',
  dealer4_swap: '사거리 안의 아군과 자리를 맞바꾼다.',
  support1_aoe_heal: '자기 주변 아군을 한꺼번에 회복시킨다.',
  support2_heal: '멀리 있는 아군 하나를 회복시킨다.',
  support2_root: '가까운 적 하나를 한 턴 동안 묶는다.',
  support2_buff: '아군 하나의 공격력을 한 턴 올린다.',
  support3_turret: '앞칸에 포탑을 세운다. 포탑은 주변 아군을 회복시키고 팀당 한 기만 남는다.',
};

/**
 * 점령 예시판. 규칙을 글로 옮겨 적지 않고 `captureWinner`를 그대로 돌려 결과 문구를 얻는다 —
 * 예시가 규칙과 어긋날 방법이 없다.
 *
 * 폭이 5인 건 가장 붐비는 예시(3:1)에서 네 기물이 겹치지 않고 서되, 양쪽이 가운데서 만나는
 * 그림이 되도록 하기 위해서다.
 */
const EXAMPLE_WIDTH = 5;
const EXAMPLE_ROW = 1;
const EXAMPLE_BOARD: BoardConfig = {
  width: EXAMPLE_WIDTH,
  height: 3,
  obstacles: [],
  captureZone: Array.from({ length: EXAMPLE_WIDTH }, (_, x) => ({ x, y: EXAMPLE_ROW })),
  startZones: { p1: [], p2: [] },
};

const EXAMPLES: { p1: number; p2: number }[] = [
  { p1: 1, p2: 0 },
  { p1: 2, p2: 1 },
  { p1: 3, p2: 1 },
  { p1: 2, p2: 2 },
];

function exampleTokens(counts: { p1: number; p2: number }): MiniToken[] {
  const slots: Position[] = EXAMPLE_BOARD.captureZone;
  const tokens: MiniToken[] = [];
  // 파랑은 왼쪽부터, 빨강은 오른쪽부터 채워 서로 안 겹치게 둔다(칸의 위치는 규칙과 무관하다).
  for (let i = 0; i < counts.p1; i++) tokens.push({ position: slots[i], owner: 'p1' });
  for (let i = 0; i < counts.p2; i++) tokens.push({ position: slots[slots.length - 1 - i], owner: 'p2' });
  return tokens;
}

function UnitCard({ typeDef }: { typeDef: UnitTypeDef }) {
  const diagram = unitDiagram(typeDef);
  const fills: MiniMark[] = [];
  const dots: MiniMark[] = [];
  const rings: MiniMark[] = [];
  for (const cell of diagram.cells) {
    if (cell.move) fills.push({ position: cell.position, className: 'mark-move' });
    else if (cell.extraMove) fills.push({ position: cell.position, className: 'mark-move-extra' });
    if (cell.attack) dots.push({ position: cell.position, className: 'mark-attack' });
    if (cell.heal) rings.push({ position: cell.position, className: 'mark-heal' });
  }

  return (
    <article className="guide-unit-card">
      <header>
        <span className={`guide-role guide-role-${typeDef.role}`}>{ROLE_LABEL[typeDef.role]}</span>
        <h4>{typeDef.name.replace(/^.*—\s*/, '')}</h4>
      </header>
      {/* 토큰에 판 위와 같은 글자를 찍는다 — 도움말에서 외운 글자가 대전 화면에서 그대로 보여야
          "이게 그때 그 기물"이라는 연결이 생긴다. */}
      <MiniBoard
        board={DIAGRAM_BOARD}
        cellSize={13}
        fills={fills}
        dots={dots}
        rings={rings}
        tokens={[{ position: DIAGRAM_ORIGIN, owner: 'p1', typeId: typeDef.id, label: typeDef.shortLabel }]}
        title={`${typeDef.name} 이동·사거리`}
      />
      <dl className="guide-stats">
        <div>
          <dt>체력</dt>
          <dd>{maxHpFor(typeDef)}</dd>
        </div>
        <div>
          <dt>공격력</dt>
          <dd>{attackPowerLabel(typeDef)}</dd>
        </div>
        <div>
          <dt>이동</dt>
          <dd>{moveRangeLabel(typeDef)}</dd>
        </div>
        <div>
          <dt>사거리</dt>
          <dd>{attackRangeLabel(typeDef)}</dd>
        </div>
      </dl>
      <ul className="guide-skills">
        {typeDef.skills.map((skill) => {
          const reach = skillReachLabel(skill);
          return (
            <li key={skill.id}>
              <strong>{skill.name}</strong>
              <span className="guide-skill-gate">
                {skillGateLabel(skill)}
                {reach ? ` · ${reach}` : ''}
              </span>
              <span className="guide-skill-text">{SKILL_BLURB[skill.id] ?? ''}</span>
            </li>
          );
        })}
        {typeDef.passive && (
          <li>
            <strong>지속 효과</strong>
            <span className="guide-skill-text">{typeDef.passive.description}</span>
          </li>
        )}
        {typeDef.skills.length === 0 && !typeDef.passive && <li className="muted">기술 없음 — 기본 공격이 전부다.</li>}
      </ul>
    </article>
  );
}

/**
 * 처음 온 사람에게 필요한 건 규칙 **문장**이 아니라 그림이다. 이 게임의 세 가지 낯선 점
 * (동시에 계획한다 / 정해진 순서로 한꺼번에 해결된다 / 점령은 인원 차로 난다)은 글로 읽으면
 * 전부 추상적이라, 각각에 그림을 붙였다. 기물 그림은 손으로 그리지 않고 엔진에서 계산한다
 * (rangeDiagram.ts).
 */
export function GuideOverlay({ onClose }: { onClose: () => void }) {
  const quickStart = useGameStore((s) => s.quickStart);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="guide-backdrop" onClick={onClose}>
      <div className="guide-panel" role="dialog" aria-label="게임 방법" onClick={(e) => e.stopPropagation()}>
        <header className="guide-head">
          <h2>게임 방법</h2>
          <button type="button" className="btn-secondary" onClick={onClose}>
            닫기 <span className="key-hint">Esc</span>
          </button>
        </header>

        <section className="guide-section">
          <h3>1. 무엇을 하면 이기는가</h3>
          <div className="guide-split">
            <MiniBoard board={mapDefinition} cellSize={9} showTerrain title="정원 맵 — 점령지와 시작지점" />
            <div>
              <p>
                판 가운데의 <strong className="swatch-capture">점령지</strong>를 차지하는 게 전부다. 매 턴이 끝날 때
                점령지에 선 기물 수를 세어 앞선 쪽이 <strong>1점</strong>을 얻고, 먼저 <strong>{WIN_SCORE}점</strong>에
                닿으면 그 자리에서 이긴다. 턴당 최대 1점이라 최소 {WIN_SCORE}턴은 점령지를 지켜야 한다.
              </p>
              <p>
                양쪽 <strong className="swatch-start">시작지점</strong>에서 5기물로 출발한다. 죽어도 완전히 잃지 않는다 —{' '}
                <strong>{RESPAWN_TURNS}턴</strong> 뒤 시작지점에서 체력을 모두 채우고 되살아난다. 그래서 이 게임은
                기물을 아끼는 게임이 아니라 <strong>점령지를 몇 턴 더 밟느냐</strong>의 게임이다.
              </p>
              <p className="muted">회색 칸은 지나갈 수 없는 장애물이고, 직선 공격도 그 뒤로는 닿지 않는다.</p>
            </div>
          </div>
        </section>

        <section className="guide-section">
          <h3>2. 한 턴은 이렇게 흐른다</h3>
          <p>
            번갈아 두는 게 아니라 <strong>양쪽이 동시에</strong> 계획한다. 상대가 무엇을 할지 모르는 채로 5기물의
            행동을 정하고, 공개 버튼을 누르면 아래 순서대로 해결된다. 판 위에서도 이 순서 그대로
            한 단계씩 재생되므로, 누가 맞았고 누가 빗나갔는지를 눈으로 따라갈 수 있다.
          </p>
          <ol className="guide-phases">
            <li>
              <span className="guide-phase-no">1</span>
              <strong>{PHASE_NAME.movement}</strong>
              <em>이동 기술도 여기서 처리된다.</em>
            </li>
            <li>
              <span className="guide-phase-no">2</span>
              <strong>{PHASE_NAME.preAttack}</strong>
              <em>방벽 · 구속 · 공격 모드.</em>
            </li>
            <li>
              <span className="guide-phase-no">3</span>
              <strong>{PHASE_NAME.attack}</strong>
              <em>이동이 끝난 자리 기준으로 맞고 때린다.</em>
            </li>
            <li>
              <span className="guide-phase-no">4</span>
              <strong>{PHASE_NAME.heal}</strong>
              <em>이미 죽은 기물은 살릴 수 없다.</em>
            </li>
            <li>
              <span className="guide-phase-no">5</span>
              <strong>{PHASE_NAME.endOfTurn}</strong>
              <em>쿨타임 · 부활 · 점령 점수.</em>
            </li>
          </ol>
          <p className="guide-note">
            같은 단계 안에서는 <strong>이동력이 높은 기물 → 공격력이 높은 기물 → 딜러·탱커·지원</strong> 순으로 하나씩
            완전히 행동한다. 그래서 발 빠른 기물은 먼저 자리를 잡고, 느린 기물은 상대가 움직인 결과를 맞고 나서
            움직인다. <strong>계획을 먼저 입력한 쪽이 유리하지는 않다.</strong>
          </p>
        </section>

        <section className="guide-section">
          <h3>3. 점령 점수는 인원 차로 난다</h3>
          <p>
            사람 수가 많다고 바로 점수가 나지 않는다. 상대가 점령지에 <strong>한 명이라도 있으면</strong>{' '}
            <strong>{CAPTURE_MARGIN}명 이상</strong> 앞서야 한다. 상대가 아예 없으면 한 명으로도 점수가 난다.
          </p>
          <div className="guide-examples">
            {EXAMPLES.map((counts) => {
              const winner = captureWinner(counts);
              return (
                <figure key={`${counts.p1}-${counts.p2}`}>
                  <MiniBoard
                    board={EXAMPLE_BOARD}
                    cellSize={22}
                    showTerrain
                    tokens={exampleTokens(counts)}
                    title={`파랑 ${counts.p1} 대 빨강 ${counts.p2}`}
                  />
                  <figcaption>
                    <span className="guide-example-count">
                      {counts.p1} : {counts.p2}
                    </span>
                    <span className={winner ? `guide-example-win guide-example-${winner}` : 'guide-example-draw'}>
                      {winner === 'p1' ? '파랑 +1점' : winner === 'p2' ? '빨강 +1점' : '경합 · 0점'}
                    </span>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </section>

        <section className="guide-section">
          <h3>4. 기물 10종은 이렇게 움직인다</h3>
          <p>
            아래 그림은 모두 <strong>같은 축척</strong>이다. 가운데가 그 기물이고, 주변 칸이 한 턴에 닿는 범위다.
          </p>
          <ul className="guide-legend">
            <li>
              <span className="legend-swatch mark-move" /> 한 턴에 갈 수 있는 칸
            </li>
            <li>
              <span className="legend-swatch mark-move-extra" /> 운이 좋아야 닿는 칸(동전)
            </li>
            <li>
              <span className="legend-swatch legend-dot" /> 겨눌 수 있는 칸
            </li>
            <li>
              <span className="legend-swatch legend-ring" /> 회복이 닿는 칸
            </li>
          </ul>
          <p className="guide-note">
            빨간 점은 <strong>겨눌 수 있는 칸</strong>이지 한 번에 다 맞는 범위가 아니다. 직선 공격은 그 방향의{' '}
            <strong>첫 번째 적</strong> 하나에게만 맞고, 장애물과 다른 기물이 사선을 막는다. 이동 칸도 빈 판 기준이라
            실제로는 누가 서 있으면 거기서 멈춘다.
          </p>
          <div className="guide-unit-grid">
            {unitTypes.map((t) => (
              <UnitCard key={t.id} typeDef={t} />
            ))}
          </div>
        </section>

        <section className="guide-section">
          <h3>5. 조작은 이것만 알면 된다</h3>
          <ul className="guide-controls">
            <li>
              <strong>기물 고르기</strong> 턴이 시작되면 첫 기물이 저절로 골라져 있고, 한 기물의 행동을 정하면 다음
              기물로 넘어간다.
            </li>
            <li>
              <strong>이동</strong> 갈 칸을 클릭한다. 한 번의 이동은 <strong>한 방향 직진</strong>이다.
            </li>
            <li>
              <strong>공격</strong> 사거리 안의 적을 클릭한다.
            </li>
            <li>
              <strong>턴 넘기기</strong> <span className="key-hint">Space</span> 또는{' '}
              <span className="key-hint">Enter</span>.
            </li>
          </ul>
          <p className="muted">
            편성과 배치는 「추천 편성」·「자동 배치」로 한 번에 끝낼 수 있다. 규칙을 익히기 전에는 그쪽이 편하다.
          </p>
        </section>

        <footer className="guide-foot">
          <button
            className="btn-primary"
            onClick={() => {
              onClose();
              quickStart();
            }}
          >
            바로 한 판 해 보기
          </button>
          <button className="btn-secondary" onClick={onClose}>
            닫기
          </button>
        </footer>
      </div>
    </div>
  );
}
