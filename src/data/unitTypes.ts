import type { UnitTypeDef } from '../engine/types';
import { HP_MULTIPLIER } from './constants';

/**
 * 기획서(v0.5) 7장 원문 스탯을 그대로 옮긴 것. 쿨타임/트리거가 문서에 명시되지 않은
 * 항목은 '판단 필요 항목'으로 계획 문서(3-joyful-dolphin.md)에 정리된 기본값을 따른다:
 *   - support2 구속 스킬, support1 회복 패시브: 쿨타임 없음(매턴 사용 가능)
 *   - 방벽(tank3 skill1): 지속시간(1턴) 동안 유지되며 피격으로는 소멸하지 않는다 — 자연 만료로만
 *     제거된다. 범위형(AoE) 공격은 방벽을 무시하고 관통하지만, 지형 장애물은 시야를 차단해
 *     장애물 뒤 칸은 범위 공격의 대상이 될 수 없다(§3.4/§8).
 *   - 체력 Lv 증가(tank1 방어 태세 등): 최대 체력을 배율만큼 늘리는 효과와, 동일한 양의 별도
 *     "보호막 체력"을 함께 부여한다(§6/§7.1 "함께 부여"). 지속시간이 끝나면 늘어난 최대 체력과
 *     남은 보호막을 함께 제거한다(§8). 보호막은 피해를 받을 때 실제 체력보다 먼저 소모된다(§8).
 */
export const unitTypes: UnitTypeDef[] = [
  {
    id: 'tank1',
    name: '탱커 1 — 방어 강화형',
    shortLabel: '방',
    role: 'tank',
    moveSpeed: 1,
    hpLv: 8,
    attack: 3,
    attackShape: { kind: 'line', range: 3, axis: 'orthogonal' },
    diagonalMove: false,
    canAttack: true,
    skills: [
      {
        id: 'tank1_fortify',
        name: '방어 태세',
        effectCategory: 'movement',
        gate: { type: 'cooldown', turns: 3 },
        targeting: 'self',
        payload: { hpBonus: 1, moveBonus: 1, duration: 1 },
      },
    ],
  },
  {
    id: 'tank2',
    name: '탱커 2 — 돌진·기동형',
    shortLabel: '돌',
    role: 'tank',
    moveSpeed: 4,
    hpLv: 6,
    attack: 2,
    attackShape: { kind: 'line', range: 4, axis: 'orthogonal' },
    diagonalMove: false,
    canAttack: true,
    skills: [
      {
        id: 'tank2_charge',
        name: '돌진',
        effectCategory: 'movement',
        gate: { type: 'cooldown', turns: 2 },
        targeting: 'self',
        // 피해량은 실제 이동한 칸 수로 동적 계산되므로 payload에는 고정값을 두지 않는다.
        payload: { moveBonus: 1, rerouteCount: 1 },
      },
    ],
  },
  {
    id: 'tank3',
    name: '탱커 3 — 방벽·제어형',
    shortLabel: '벽',
    role: 'tank',
    moveSpeed: 2,
    hpLv: 8,
    attack: 5,
    attackShape: { kind: 'aoe', range: 1, axis: 'orthogonal', aoeShape: 'line', aoeRadius: 1 },
    diagonalMove: false,
    canAttack: true,
    skills: [
      {
        id: 'tank3_barrier',
        name: '방벽 설치',
        effectCategory: 'preAttack',
        gate: { type: 'cooldown', turns: 1 },
        targeting: 'self',
        payload: {},
      },
      {
        id: 'tank3_root',
        name: '구속',
        effectCategory: 'preAttack',
        gate: { type: 'cooldown', turns: 5 },
        targeting: 'enemy',
        // range는 기획서에 없는 판단값이다(engine/skillRange.ts 주석 참고) — 직선·대각선 3칸.
        payload: { duration: 1, range: 3 },
      },
    ],
  },
  {
    id: 'dealer1',
    name: '딜러 1 — 장거리 화력형',
    shortLabel: '저',
    role: 'dealer',
    moveSpeed: 1,
    hpLv: 3,
    // dealer3(10)보다 **반드시 약해야 한다**(사용자 결정) — 둘 다 원거리 화력 기물이라 수치가
    // 같으면 역할이 겹친다. dealer1은 사거리 6으로 더 멀리서, dealer3은 더 세게 쏘는 구도다.
    attack: 9,
    // 축을 대각선까지 넓힌 이유: 탄창식으로 발사 가능 턴을 두 배로 늘렸는데도 판당피해가 28%밖에
    // 안 늘었다 — 병목은 쿨다운이 아니라 **사선에 적이 안 들어오는 것**이었다. 이동 1짜리가 직선
    // 사거리 6만 갖고 있으면 자기 행·열에 적이 서 주기를 기다리는 수밖에 없다.
    attackShape: { kind: 'line', range: 6, axis: 'both' },
    // 이동은 여전히 직선만 — 조준선은 넓히되 발은 안 준다. 이 기물의 정체성은 느린 포대다.
    diagonalMove: false,
    canAttack: true,
    skills: [],
    attackShots: 2,
    attackRestTurns: 1,
  },
  {
    id: 'dealer2',
    name: '딜러 2 — 시간 역행형',
    shortLabel: '역',
    role: 'dealer',
    moveSpeed: 3,
    hpLv: 2,
    attack: 6,
    attackShape: { kind: 'line', range: 2, axis: 'orthogonal' },
    diagonalMove: false,
    canAttack: true,
    skills: [
      {
        id: 'dealer2_rewind_move',
        name: '추가 이동',
        effectCategory: 'movement',
        gate: { type: 'charge', maxCharges: 3 },
        targeting: 'self',
        // 충전 1회 = "이동을 한 번 더 하는" 것 = 이동 Lv(3칸)만큼 추가 이동.
        // 따라서 한 턴에 3회를 모두 쓰면 3(기본) + 3×3 = 12칸까지 움직인다.
        payload: { extraMoveMultiple: 1 },
      },
    ],
  },
  {
    id: 'dealer3',
    name: '딜러 3 — 충전 사격형',
    shortLabel: '충',
    role: 'dealer',
    /**
     * **이동 1 + 대각 이동 가능 / 공격은 직선만** — 조준선과 이동축을 맞바꿨다(사용자 결정).
     *
     * 이전에는 반대였다(직선 이동 · 직선+대각 사격). 그때 계측(`dealer3Opportunity.ts`)에서
     * 나온 사실은 이 기물이 약한 원인이 **사거리도 화력도 아니라 발**이라는 것이었다 —
     * 평균 교전거리 5.8칸에 사거리 4라 사선에 적이 있는 턴이 11.2%뿐이었고(사거리 6짜리
     * dealer1은 20.6%), 사거리를 5로 올려도 승점은 ±0.0%p, 6까지 올려도 +2.6%p였는데
     * 이동만 2로 올리자 +8.1%p였다.
     *
     * 이번 형태는 그 결론을 **이동력이 아니라 이동축으로** 푼다. 대각 이동이 열리면 한 걸음의
     * 도달 범위가 4칸에서 8칸이 되고, 특히 사선 밖으로 빠지거나 사선에 걸치는 일이 한 턴에
     * 된다 — 이동 1을 유지한 채 "자리 잡는 능력"만 올리는 셈이다. 대신 **멀리 나가는** 사선은
     * 직선 4방향뿐이 되므로(대각은 1칸짜리 자기 방어용이다, attackShape 주석) 그 손실을
     * 공격력으로 되갚는다.
     *
     * 결과: 축을 맞바꾼 것만으로 사용자 맵 42.7% → 44.7%(+2.0%p)였다. 점령체류가 5.7 → 9.1턴으로
     * 늘어 방향은 맞았지만, 이동 2가 줬던 +8.1%p에는 한참 못 미친다. **한 걸음의 도달 범위를
     * 넓히는 것과 걸음 수를 늘리는 것은 값이 다르다** — 대각 이동은 갈 수 있는 방향을 늘릴 뿐,
     * 점령지까지의 거리를 줄여 주지는 않기 때문이다.
     *
     * 그래서 이 기물은 여전히 하위권(46.3%, 9위)에 남아 있다. 사거리·공격력으로는 여기까지가
     * 한계라는 근거는 아래 attack 주석에 있고, 진짜 병목은 **공격 모드가 이동을 막는 규칙**이다:
     * 켜 놓고 사선에 아무도 없는 채 얼어 있던 턴이 27%였다. 이동력이나 토글 규칙을 손대지 않는
     * 한 이 기물은 50%에 닿지 않는다.
     */
    moveSpeed: 1,
    hpLv: 4,
    /**
     * 10 → 16 → **12**(사용자 결정). 16은 스윕에서 유일하게 두 맵 모두 오른 값이었지만,
     * 아래 대각 1칸이 붙으면서 사선 수가 4방향에서 8방향으로 늘었으므로 **한 방의 값을 낮춰
     * 기회 수와 맞바꾼다**.
     *
     * 사거리·공격력 스윕(`dealer3Sweep.ts`, 1000판·시드 짝지음)에서 배운 것은 두 가지다.
     * 첫째, 사거리는 어느 값도 듣지 않았다 — 5·6·7로 올려도, 3·2로 내려도 승점은 44.7~45.8%로
     * 오차 범위였다. 둘째, **화력은 스스로를 갉아먹는 손잡이다**: 10 → 16으로 60% 올렸는데
     * 판당피해는 20.9 → 24.9로 19%만 늘었고, 같은 표에서 사선에 적이 있던 턴은 15.5% → 12.3%로
     * **떨어졌다**. AI의 위협 모델이 공격력을 보고 적을 밀어내므로, 세게 만들수록 적이 그 사선을
     * 피해 간다.
     *
     * 그 되먹임은 이번 측정에서 그대로 확인됐다: 공격을 16 → 12로 **내렸는데 판당피해는
     * 24.9 → 29.6으로 올랐다**(사용자 맵). 한 방이 약해지자 적이 사선을 덜 피해 발사 횟수가
     * 늘었기 때문이고, 승점도 46.3 → 47.5%(정원 49.5 → 52.0%)로 두 맵 모두 올랐다. 대각 1칸이
     * 함께 붙은 조정이라 둘의 몫을 나눠 말할 수는 없지만, 적어도 **공격력을 깎는 쪽이 손해가
     * 아니었다**는 것은 분명하다.
     *
     * 12여도 dealer1(9)보다 높고 역할은 겹치지 않는다. dealer1은 직선+대각 6칸을 2발씩 훑는
     * 지속 화력이고, 이쪽은 한 방이다. 다만 16일 때 있던 "15HP 기물을 한 대에 지운다"는 성질은
     * 사라진다 — 그게 이 조정에서 실제로 내려놓는 것이다.
     */
    attack: 12,
    /**
     * **직선 4칸 + 대각 1칸**(사용자 결정). 축마다 사거리가 다른 첫 기물이라 엔진에
     * `diagonalRange`를 새로 넣었고, 방향별 실제 사거리는 `attackRangeFor()` 한 곳에서만
     * 계산한다 — 해결·AI·UI가 각자 `range`를 읽으면 화면의 사정권과 실제 타격 범위가 소리 없이
     * 어긋난다.
     *
     * 의도: 직선은 여전히 이 기물의 주 사선이고, 대각은 **코앞에 붙은 적을 지우는 자기 방어**다.
     * 공격 모드를 켠 동안 이동이 막히므로 대각으로 파고든 적에게 아무것도 못 하고 얻어맞는
     * 구간이 있었는데, 1칸짜리 대각이 그 구멍만 메운다. 대각 사거리를 1로 묶는 이유는 사거리를
     * 올려도 승점이 안 움직인다는 위 스윕 결과 때문이다 — 늘려 봐야 판당피해만 오르고 점령체류가
     * 깎여 상쇄된다.
     *
     * 결과(1000판·시드 짝지음): 사용자 맵 46.3 → 47.5%(7위), 정원 49.5 → 52.0%(**3위**).
     * 정원 전체편차도 16.7 → 15.2%p로 줄었다. 공격력을 4 깎고 얻은 성적이라 **대각 1칸은 깎인
     * 화력값보다 비싸게 팔렸다**. 다만 사용자 맵 점령체류는 8.6턴으로 여전히 아래에서 두 번째다 —
     * 사거리·화력이 아니라 공격 모드가 이동을 막는 규칙이 병목이라는 진단(moveSpeed 주석)은
     * 이 조정으로도 뒤집히지 않았다.
     */
    attackShape: { kind: 'line', range: 4, axis: 'both', diagonalRange: 1 },
    // 걷는 축(직선+대각)과 쏘는 축의 **거리**를 일부러 어긋나게 둔다. 대각으로 파고들어 직선
    // 사선을 잡는 기물이라, 대각은 멀리 못 쏘고 직선만 멀리 나간다.
    diagonalMove: true,
    canAttack: true,
    skills: [
      {
        id: 'dealer3_attack_mode',
        name: '공격 모드 전환',
        effectCategory: 'preAttack',
        gate: { type: 'toggle' },
        targeting: 'self',
        // 켜진 동안만 공격 가능, 이동 불가 (validation.ts에서 강제)
        payload: {},
      },
    ],
  },
  {
    id: 'dealer4',
    name: '딜러 4 — 측면 교란형',
    shortLabel: '측',
    role: 'dealer',
    moveSpeed: 2,
    hpLv: 4,
    attack: 5,
    attackShape: { kind: 'line', range: 3, axis: 'diagonal' },
    diagonalMove: true,
    canAttack: true,
    skills: [
      {
        id: 'dealer4_swap',
        name: '자리 교체',
        effectCategory: 'movement',
        gate: { type: 'cooldown', turns: 3 },
        targeting: 'ally',
        payload: { swapRange: 3 },
      },
    ],
    /**
     * 다른 적과 인접한 대상에게 추가피해 — 상시 조건부 패시브(쿨타임 없음).
     *
     * **7 → 5**(사용자 결정). 이 기물은 측정 이래 모든 설정에서 1위였고(WIN_SCORE 7·10·14·15,
     * 편성 규칙 2종, 이번 세션 실험 4종 전부) 2위와 7%p 이상 벌어져 있었다.
     *
     * 원인은 표기 공격력이 아니라 이 패시브였다. `dealer4Flank.ts` 1000판 측정에서 발동률 57.0%,
     * **전체 피해의 43.4%가 이 패시브에서** 나왔고 실효 공격력은 9.18이었다 — 표기 5는 10종 중
     * 7위인데 실효는 dealer1(9)과 같은 상위권이라, 스탯 시트가 실제를 반영하지 못하고 있었다.
     *
     * 5로 낮춘 결과: 실효 공격력 8.18, 패시브 몫 36.3%, 승점 60.7 → 58.9%. **전체편차가
     * 16.5 → 14.4%p로 측정 이래 최소치**가 됐고, 깎인 화력이 특정 기물이 아니라 중하위권에
     * 골고루 갔다(돌진·기동형 ▲2.0, 시간 역행형 ▲1.1, 지원 2종 각 ▲1.0).
     *
     * 승점 하락폭(-1.8%p)이 화력 삭감분보다 작은 건 이 저장소에 이미 기록된 되먹임 때문이다 —
     * 한 방이 약해지자 AI 위협 모델이 이 기물을 덜 피해 명중이 9.3 → 10.0회로 늘었다
     * (dealer3 attack 주석의 "화력은 스스로를 갉아먹는 손잡이"와 같은 현상).
     *
     * **조건 자체는 손대지 않았다.** 점령지 밖 발동률(66.5%)이 안(54.3%)보다 높아 "측면을 파고든
     * 보상"이라는 이름값을 못 하는 구조는 그대로다. 보상만 줄인 조정이라, 조건을 조이는 안
     * (대각 인접 요구, 인접 아군 2명 이상)은 여전히 미검증으로 남아 있다.
     */
    passive: { id: 'dealer4_flank_bonus', description: '다른 적과 인접한 대상에게 +5 추가 피해', payload: { bonusDamage: 5 } },
  },
  {
    id: 'support1',
    name: '지원 1 — 범위 회복형',
    shortLabel: '범',
    role: 'support',
    moveSpeed: 2,
    hpLv: 3,
    attack: 1,
    attackShape: { kind: 'line', range: 2, axis: 'orthogonal' },
    diagonalMove: false,
    canAttack: true,
    // 회복량은 기획서 원문(1)이 아니라 3이다. 원문 수치는 `maxHp = 체력Lv × 2` 기준으로 쓰였는데,
    // 구현에서 HP_MULTIPLIER를 5로 올리면서 체력만 2.5배가 되고 회복량은 그대로 남았다. 그 결과
    // 공격 5~10 대 회복 1이 되어 힐이 사실상 아무것도 되돌리지 못했다 — 200판 시뮬레이션에서 지원
    // 3종이 나란히 최하위(28~34%)였던 주된 원인이다. 체력과 같은 비율(×2.5, 반올림)로 맞춘다.
    // support2 회복(3→8)과 포탑 오라(2→5)도 같은 이유로 같은 비율을 적용했다.
    skills: [
      {
        id: 'support1_aoe_heal',
        name: '범위 회복',
        effectCategory: 'heal',
        gate: { type: 'auto' },
        targeting: 'aoe',
        payload: { radius: 2, healAmount: 3 },
      },
    ],
    // 턴 종료 시 자동 회복, 해당 턴에 힐을 사용했다면 자동회복량 2배
    passive: { id: 'support1_auto_regen', description: '턴 종료 시 자동 회복. 해당 턴 회복량 2배', payload: { baseAmount: 3, healedThisTurnMultiplier: 2 } },
  },
  {
    id: 'support2',
    name: '지원 2 — 장거리 회복·구속형',
    shortLabel: '구',
    role: 'support',
    moveSpeed: 1,
    hpLv: 3,
    /**
     * 기획서대로 공격 불가다. "힐량의 1/2(=4) 딜, 회복과 같은 직선 4"를 실제로 넣고 300판을 재 본 적이
     * 있는데(승점 44.0→51.1%), 그 상승분은 전부 착시였다. 적 AI의 `threatAt`이 공격력을 그대로 위협으로
     * 읽어 접근을 피한 것이고, 공격력 4를 둔 채 **적의 위협 계산에서만 빼자** 44.3%로 돌아왔다.
     * 실제 판당 피해는 1.0 — 판당 1.77회 쏘고 명중률 14%다(동시 턴이라 이동 전 위치를 보고 쏘는데
     * 이동력 1이라 빗나가도 재조준을 못 한다). 사람 상대로는 아무것도 바뀌지 않는다는 뜻이라 되돌렸다.
     */
    attack: 0,
    attackShape: { kind: 'line', range: 0, axis: 'orthogonal' },
    diagonalMove: false,
    canAttack: false,
    skills: [
      {
        id: 'support2_heal',
        name: '장거리 회복',
        effectCategory: 'heal',
        gate: { type: 'auto' },
        targeting: 'ally',
        payload: { range: 5, healAmount: 8 },
      },
      {
        id: 'support2_root',
        name: '구속',
        effectCategory: 'preAttack',
        gate: { type: 'auto' },
        targeting: 'enemy',
        payload: { range: 2, duration: 1 },
      },
      /**
       * **조준 보조** — 기획서에 없는 신규 기술이다. 넣은 이유는 측정이다.
       *
       * 이 기물은 이동력 1이라 라인을 맞추러 갈 수 없고, 그래서 오래 최하위 승점(38.8%)이었다.
       * 처음엔 회복 사거리·힐량이 문제인 줄 알았는데 둘 다 아니었다. 직선 사거리를 4→12로 올려도
       * 승점이 38.8→38.2%로 **내려갔고**, 힐량을 8→25로 3배 올리면 판당 회복량만 정확히 3배가 될 뿐
       * 승점은 역시 38.2%였다. 회복량이 승리로 환산되지 않는다는 뜻이다.
       *
       * 기회를 분해해 보니 원인이 나왔다(scripts/support2Opportunity.ts): 사거리 안에 아군이 있는
       * 턴은 **67%**인데, 그중 **부상한** 아군이 있는 턴은 **9%**뿐이었다. 즉 58%의 턴에서 이 기물은
       * 아군을 빤히 보면서도 회복이라는 대상 조건 때문에 아무것도 못 하고 있었다. 축을 대각선까지
       * 열어도 부상 아군은 9→15%로밖에 안 올라, 기하를 손대는 걸로는 못 고치는 문제였다.
       *
       * 버프는 **다치지 않은 아군에게도** 걸리므로 9%가 아니라 67%의 풀을 쓴다. 사거리와 축(직선)은
       * 회복과 똑같이 두어 "긴 사선을 맞춰야 한다"는 저격수 정체성을 그대로 유지한다.
       *
       * 한 턴에 쓰는 기술은 하나뿐(`UnitTurnPlan.skillUse`가 단수)이라, 다칠 아군이 있으면 회복이
       * 우선되고 비는 턴을 이 기술이 메운다 — 회복을 대체하지 않는다.
       *
       * **버프량이 3인 건 상한이 아니라 하한 때문이다.** 스윕에서 6까지 올리면 승점은 46.0%로 더
       * 높아지는데, 대신 판당 회복량이 17.1→1.1로 무너졌다. 버프 가치(6×1.5=9)가 회복 가치
       * (3×2.5=7.5)를 항상 이겨서 이 기물이 회복을 아예 안 하는 버프 봇이 되기 때문이다. 3이면
       * 4.5 < 7.5이라 **다친 아군이 있으면 회복이 먼저**고 버프는 빈 턴만 메운다 — 실측 판당
       * 회복량 16.0으로 원래(17.1)를 거의 유지한다.
       *
       * 사거리는 측정으로 고른 게 아니라 **회복과 맞춘 값(5)이다**(사용자 결정). 스윕에서는 6과 8이
       * 결과가 완전히 같았는데(43.2% / 18.0%p), 어차피 차이가 없다면 두 기술의 사거리가 따로 노는
       * 것보다 하나로 외워지는 편이 낫다 — "이 기물은 직선 5칸 안에서 일한다"로 끝난다.
       */
      {
        id: 'support2_buff',
        name: '조준 보조',
        effectCategory: 'preAttack', // 공격 단계 전에 얹혀야 이번 턴 공격에 반영된다
        gate: { type: 'auto' },
        targeting: 'ally',
        payload: { range: 5, attackBonus: 3 },
      },
    ],
  },
  {
    id: 'support3',
    name: '지원 3 — 확률·포탑형',
    shortLabel: '탑',
    role: 'support',
    // 이동력·공격력은 매 턴 동전으로 정해진다(아래 passive) — 여기 값은 동전이 없을 때의 바닥값이다.
    // 기획서에 사거리 수치가 없어 support1(직선 2)과 같은 근거리 지원 사거리를 기본값으로 둔다.
    // 0으로 두면 공격력 6/4가 닿을 칸이 없어 영영 쓰이지 않는 죽은 값이 된다.
    moveSpeed: 1,
    hpLv: 3,
    attack: 4,
    attackShape: { kind: 'line', range: 2, axis: 'orthogonal' },
    diagonalMove: false,
    canAttack: true,
    skills: [
      {
        id: 'support3_turret',
        name: '포탑 생성',
        effectCategory: 'preAttack',
        gate: { type: 'auto' },
        targeting: 'cell',
        payload: {},
      },
    ],
    /**
     * 턴 시작 시 동전 결정(각 50%). 직접 회복은 못 하고 포탑으로만 팀에 기여한다.
     *
     * **앞면을 이동2·사거리2 → 이동3·사거리3으로 올렸다**(사용자 결정). 이 기물은 측정 내내
     * 최하위(44.5%)였고, 원인을 찾는 실험 셋(동전 타이밍·포탑 체력·부활 턴수)이 전부 실패해
     * 남은 축이 이동뿐이었다(PROGRESS 20절). 선례도 있다 — 충전 사격형은 사거리를 5·6으로 올려도
     * ±0.0~+2.6%p였는데 이동만 2로 올리자 +8.1%p였다.
     *
     * 공격력(4/6)은 그대로 둔다. 이 기물의 진단은 "붙어야 일하는데 붙을 발이 없다"였지 화력이
     * 아니었고, 화력은 이 저장소에서 반복적으로 스스로를 갉아먹는 손잡이로 확인됐다.
     *
     * 사거리가 동전에 따라 갈리는 건 이 기물이 처음이라 `unitStats.ts`에 `resolvedAttackShape`/
     * `plannedAttackShape`를 새로 뒀다 — 이동력·공격력이 이미 쓰던 것과 같은 패턴이다.
     * 아래 `attackShape.range`(2)는 동전 정보가 없는 곳에서 쓰이는 바닥값이자 뒷면 값이다.
     */
    passive: {
      id: 'support3_coinflip',
      description: '턴 시작 시 동전 결정: 앞면 이동3·공격6·사거리3 / 뒷면 이동1·공격4·사거리2',
      payload: {
        headsMove: 3,
        headsAttack: 6,
        headsRange: 3,
        tailsMove: 1,
        tailsAttack: 4,
        tailsRange: 2,
        headsChance: 0.5,
      },
    },
  },
];

/**
 * support3이 앞칸에 세우는 **회복** 포탑. 5기물 편성 수에 포함되지 않는 별도 엔티티다.
 *
 * - **딜링이 아니라 힐링이다**: attack 0 · canAttack false. 주변 8칸의 **아군만** 회복한다(healing.ts).
 * - **움직이지 않는다**: moveSpeed 0. 계획 자체가 들어오지 않지만(plansForTurn/ActionPanel이
 *   isTurret으로 거른다) 설령 들어와도 이동 상한이 0이라 제자리다.
 * - **팀당 1기**(판 전체 최대 2기). 새로 세우면 그 팀의 기존 포탑이 철거된다(turnStart.ts).
 *
 * **체력 1 → 8**(기획서 원문은 1). 원래 의도는 support3(하위권)을 살리는 것이었고 그건 실패했다 —
 * 포탑 회복 총량이 +13.7% 늘었는데 support3 승점률은 44.9 → 45.3%로 사실상 제자리였다(1000판,
 * 시드 짝지음). 이 저장소에서 "회복량이 승리로 환산되지 않는다"가 확인된 세 번째 사례다
 * (앞선 둘은 support2의 사거리 4→12, 힐량 8→25 스윕 — 아래 support2 주석 참고).
 *
 * 그런데도 8을 채택한 이유는 **전체편차**다. 1위−10위 격차가 16.1 → 14.8%p로 측정 이래 최소치가
 * 됐다. 회복이 늘어 상위권 폭딜 기물이 눌린 결과이고(측면 교란형 61.0 → 60.1%), 목적과 다른
 * 이유로 채택한 값이라는 걸 여기 적어 둔다 — 나중에 "support3을 위한 값"으로 오해하고 되돌리면
 * 편차만 다시 벌어진다.
 */
export const turretType: UnitTypeDef = {
  id: 'turret',
  name: '포탑',
  shortLabel: '＋',
  role: 'support',
  moveSpeed: 0,
  hpLv: 0,
  fixedMaxHp: 8,
  attack: 0,
  attackShape: { kind: 'aoe', range: 0, axis: 'orthogonal' },
  diagonalMove: false,
  canAttack: false,
  skills: [],
  isTurret: true,
  passive: { id: 'turret_aura', description: '주변 8칸 아군 회복', payload: { healAmount: 5, radius: 1 } },
};

export function getUnitType(typeId: string): UnitTypeDef {
  if (typeId === turretType.id) return turretType;
  const found = unitTypes.find((u) => u.id === typeId);
  if (!found) throw new Error(`Unknown unit type: ${typeId}`);
  return found;
}

export function maxHpFor(typeDef: UnitTypeDef): number {
  return typeDef.fixedMaxHp ?? typeDef.hpLv * HP_MULTIPLIER;
}
