import type { GameState, Owner, Position, ResolutionEvent, UnitInstance } from '../types';
import type { RngFn } from '../rng';
import { CAPTURE_MARGIN, WIN_SCORE } from '../../data/constants';
import { getUnitType, maxHpFor } from '../../data/unitTypes';
import { initCharges } from '../createInitialState';
import { inBounds, isObstacle, isOccupied, isInCaptureZone, key, step } from '../grid';
import { hasActiveEffect, isEffectActive, pruneExpiredEffects } from '../statusEffects';

/** 부활 지점 탐색 순서: 좌→우→상→하(판단 필요 항목 재검토, 시작지점 인접 칸 탐색 순서 기본값) */
const RESPAWN_SEARCH_ORDER = ['left', 'right', 'up', 'down'] as const;

/**
 * owner 공유 부활 후보 칸 목록: 시작지점 칸들(원래 순서) → 각 시작지점 칸의 인접 칸
 * (좌→우→상→하 순, 장애물/보드 밖 제외). 모든 부활 대기 유닛이 이 동일한 순서 목록을 공유한다(§3.5).
 */
function buildRespawnCandidates(state: GameState, owner: Owner): Position[] {
  const zone = state.board.startZones[owner];
  const list: Position[] = [...zone];
  for (const cell of zone) {
    for (const dir of RESPAWN_SEARCH_ORDER) {
      const adj = step(cell, dir);
      if (!inBounds(adj, state.board) || isObstacle(adj, state.board)) continue;
      list.push(adj);
    }
  }
  // 시작지점 칸의 인접 칸이 다른 시작지점 칸과 겹칠 수 있으므로 중복 좌표를 제거한다.
  const seen = new Set<string>();
  return list.filter((p) => {
    const k = key(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function finalizeRespawn(unit: UnitInstance, freeCell: Position, log: ResolutionEvent[]): void {
  const typeDef = getUnitType(unit.typeId);
  // 기술2(있다면, 예: tank3_root)의 쿨타임은 부활해도 초기화하지 않는다(§8) —
  // 나머지 쿨타임/충전/상태이상/보호막은 모두 초기화되는 "클린 상태" 부활이 기본값이다.
  const skill2Id = typeDef.skills[1]?.id;
  const preservedSkill2Cooldown = skill2Id ? unit.cooldowns[skill2Id] : undefined;

  unit.alive = true;
  unit.position = freeCell;
  unit.maxHp = maxHpFor(typeDef); // 사망 시점의 버프가 남아 있던 maxHp를 신뢰하지 않고 새로 계산(판단 필요 항목 #5)
  unit.currentHp = unit.maxHp;
  unit.shieldHp = 0;
  unit.respawnTurnsRemaining = null;
  unit.cooldowns = {};
  if (skill2Id && preservedSkill2Cooldown !== undefined && preservedSkill2Cooldown > 0) {
    unit.cooldowns[skill2Id] = preservedSkill2Cooldown;
  }
  unit.charges = initCharges(typeDef);
  unit.statusEffects = [];
  unit.rewindSnapshot = null;
  log.push({ phase: 'endOfTurn', type: 'respawn', actorId: unit.instanceId, detail: { at: freeCell } });
}

/**
 * 부활 위치 동시 배정(§3.5): 같은 턴종료 틱에 부활하는 유닛들이 owner별 공유 후보 목록에서
 * 각자 "현재 최선의 후보"를 동시에 제안한다. 어떤 칸을 단독으로 제안한 유닛만 그 칸에 확정된다.
 * 2명 이상이 같은 칸을 동시에 제안하면, 이동·공격 우선순위(이동Lv·공격력·역할)나 입력 순서 같은
 * "부활 순서·선공권"은 전혀 적용하지 않고 — 턴 시작 무작위 선공권과 동일한 성격의 공정한 무작위
 * 추첨으로 단 한 명만 그 칸에 확정하고, 나머지 전원은 동시에 다음 후보로 넘어간다. 완전히 동률인
 * 두 유닛이 매 라운드 같은 칸에서 계속 부딪히기만 하면 후보가 소진될 때까지도 아무도 배정받지
 * 못하는 교착 상태가 되므로, 그 교착을 막기 위한 최소한의 공정성 장치다. 후보가 소진된 유닛은
 * 이번 틱에 배정되지 않고 다음 틱에 재시도한다.
 */
function respawnUnits(state: GameState, units: UnitInstance[], rngFn: RngFn, log: ResolutionEvent[]): void {
  if (units.length === 0) return;

  const byOwner = new Map<Owner, UnitInstance[]>();
  for (const u of units) {
    if (!byOwner.has(u.owner)) byOwner.set(u.owner, []);
    byOwner.get(u.owner)!.push(u);
  }

  for (const [owner, ownerUnits] of byOwner) {
    const candidates = buildRespawnCandidates(state, owner);
    const cursor = new Map<string, number>(ownerUnits.map((u) => [u.instanceId, 0]));
    const claimedThisTick = new Set<string>();
    let pending = ownerUnits;

    while (pending.length > 0) {
      const proposals = new Map<string, UnitInstance[]>();
      for (const u of pending) {
        let idx = cursor.get(u.instanceId)!;
        while (idx < candidates.length) {
          const k = key(candidates[idx]);
          if (!isOccupied(candidates[idx], state.units) && !claimedThisTick.has(k)) break;
          idx++;
        }
        cursor.set(u.instanceId, idx);
        if (idx >= candidates.length) continue; // 후보 소진 — 다음 틱에 재시도(respawnTurnsRemaining은 0 이하로 유지)
        const k = key(candidates[idx]);
        if (!proposals.has(k)) proposals.set(k, []);
        proposals.get(k)!.push(u);
      }

      const stillPending: UnitInstance[] = [];
      for (const [k, claimants] of proposals) {
        if (claimants.length === 1) {
          const u = claimants[0];
          finalizeRespawn(u, candidates[cursor.get(u.instanceId)!], log);
          claimedThisTick.add(k);
          continue;
        }
        const winnerIdx = Math.min(claimants.length - 1, Math.max(0, Math.floor(rngFn() * claimants.length)));
        const winner = claimants[winnerIdx];
        finalizeRespawn(winner, candidates[cursor.get(winner.instanceId)!], log);
        claimedThisTick.add(k);
        for (const u of claimants) {
          if (u === winner) continue;
          cursor.set(u.instanceId, cursor.get(u.instanceId)! + 1);
          stillPending.push(u);
        }
      }
      pending = stillPending;
    }
  }
}

/** 5단계: 턴종료효과(3.2절) — 쿨타임/상태이상 감소, 부활, 점령 점수, 승리조건. */
export function resolveEndOfTurn(state: GameState, rngFn: RngFn, log: ResolutionEvent[]): void {
  const turnNumber = state.turnNumber;
  const nextTurn = turnNumber + 1;

  // 1) support1: 턴 종료 자동회복(해당 턴에 힐을 사용했다면 2배)
  for (const unit of state.units) {
    if (unit.typeId !== 'support1' || !unit.alive) continue;
    const typeDef = getUnitType('support1');
    const payload = typeDef.passive?.payload ?? {};
    const base = payload.baseAmount ?? 1;
    const multiplier = hasActiveEffect(unit, 'healedThisTurn', turnNumber) ? (payload.healedThisTurnMultiplier ?? 1) : 1;
    const amount = base * multiplier;
    unit.currentHp = Math.min(unit.maxHp, unit.currentHp + amount);
    log.push({ phase: 'endOfTurn', type: 'autoRegen', actorId: unit.instanceId, detail: { amount } });
  }

  for (const unit of state.units) {
    if (!unit.alive) continue;

    // 2) tank1 방어태세: 보호막(shield) 효과가 다음 턴에 더 이상 유효하지 않게 되면, 남은 보호막
    // 체력이 얼마든 관계없이 전부 소멸시킨다(§8 — 보호막은 최대체력에 포함되지 않는 별도 체력이므로,
    // 근원 효과가 만료되면 잔여량과 무관하게 함께 사라진다). 함께 부여됐던 최대 체력 증가분(hpBuff)도
    // 같은 시점에 되돌리고, 현재 체력이 새 최대치를 넘지 않도록 clamp한다(§6/§7.1/§8 "함께 부여"/"함께 제거").
    for (const effect of unit.statusEffects) {
      if (effect.type === 'shield' && !isEffectActive(effect, nextTurn)) {
        unit.shieldHp = 0;
      }
      if (effect.type === 'hpBuff' && !isEffectActive(effect, nextTurn)) {
        const amount = effect.magnitude ?? 0;
        unit.maxHp = Math.max(1, unit.maxHp - amount);
        unit.currentHp = Math.min(unit.currentHp, unit.maxHp);
      }
    }

    // 3) dealer2 시간역행 복귀는 여기가 아니라 공격 단계 직후(resolvers/rewind.ts)에서 처리한다 —
    //    그 턴에 받은 피해까지 되돌리는 것이 기술의 취지이므로 턴종료까지 미루면 안 된다.

    // 4) 쿨타임 감소
    for (const skillId of Object.keys(unit.cooldowns)) {
      unit.cooldowns[skillId] = Math.max(0, unit.cooldowns[skillId] - 1);
    }

    // 5) 상태이상 지속시간 감소·만료 제거(다음 턴 기준)
    pruneExpiredEffects(unit, nextTurn);
  }

  // 5-1) 힐팩 재생성 카운트다운. 기물 쿨타임과 **같은 틱**에서 깎아 두 시계가 어긋나지 않게 한다
  //      (그래서 healing.ts가 넣는 값도 쿨타임과 똑같이 +1 보정을 쓴다).
  for (const cell of Object.keys(state.healPackTimers)) {
    const next = state.healPackTimers[cell] - 1;
    if (next <= 0) {
      delete state.healPackTimers[cell];
      log.push({ phase: 'endOfTurn', type: 'healPackReady', detail: { at: cell } });
    } else {
      state.healPackTimers[cell] = next;
    }
  }

  // 6) 부활 카운트다운 + 사망 중 기술2 쿨타임 감소(§8: "사망한 동안에도 기술 2의 쿨타임은 정상적으로
  // 감소하지만, 부활 시 초기화하지 않는다" — 나머지 쿨타임/충전/상태이상은 death.ts에서 이미 초기화됨).
  const respawningNow: UnitInstance[] = [];
  for (const unit of state.units) {
    if (unit.alive || unit.respawnTurnsRemaining === null) continue;
    const typeDef = getUnitType(unit.typeId);
    const skill2Id = typeDef.skills[1]?.id;
    if (skill2Id && (unit.cooldowns[skill2Id] ?? 0) > 0) {
      unit.cooldowns[skill2Id] = Math.max(0, unit.cooldowns[skill2Id] - 1);
    }
    unit.respawnTurnsRemaining -= 1;
    if (unit.respawnTurnsRemaining <= 0) respawningNow.push(unit);
  }
  respawnUnits(state, respawningNow, rngFn, log);

  // 7) 점령 점수 — **인원 차 점령, 턴당 최대 1점**. 생존 유닛(기절·구속 포함, 사망 제외)을
  // 팀별로 센 뒤, 다음 둘 중 하나면 그 팀이 1점을 얻는다:
  //   · 상대가 **아예 없다**(무저항) — 1:0도 점수가 난다.
  //   · 상대가 있다면 CAPTURE_MARGIN명 **이상 앞선다** — 2:1은 경합(0점), 3:1부터 점수.
  // 몇 명 더 많은지는 점수 크기에 영향을 주지 않는다 — 3:1이든 5:0이든 똑같이 1점이다.
  //
  // 무저항을 예외로 두는 이유: 아무도 지키지 않는 점령지를 한 기물이 차지했는데 0점이면, 상대가
  // 전멸했거나 완전히 물러난 판이 진행되지 않고 멈춘다. 인원 차 기준은 **막는 쪽이 있을 때**
  // 비로소 의미가 있는 규칙이다.
  //
  // 기획서 5장 원문은 "양 팀이 함께 있으면 무조건 경합 0점"이었는데, 그러면 양쪽이 점령지에
  // 들어간 순간 아무도 점수를 못 내고 그 상태가 스스로 유지된다 — 200판 시뮬레이션에서 17.5%가
  // 끝나지 않았고, 그 판들의 선두 팀 평균 점수는 300턴을 돌려도 10점 만점에 1.6점이었다.
  // 느린 판이 아니라 완전 교착이라 기물 스탯으로는 풀 수 없었다.
  //
  // 그래서 승자 판정을 인원수가 아니라 **인원 차**로 바꿨다. 양쪽이 함께 있어도 병력을 더 밀어
  // 넣을 이유가 생겨 교착이 풀린다. 차이 기준을 1이 아니라 2로 둔 것은 "한 명 슬쩍 더 넣기"로
  // 점령이 굴러가지 않게 하려는 것이다 — 수비 한 명이 공격 두 명을 묶어 두는 값을 갖는다.
  const owners: Owner[] = ['p1', 'p2'];
  const counts: Record<Owner, number> = { p1: 0, p2: 0 };
  for (const unit of state.units) {
    if (!unit.alive || !unit.position || unit.isTurret) continue; // 포탑은 편성 기물이 아니라 점령에 안 센다
    if (isInCaptureZone(unit.position, state.board)) counts[unit.owner] += 1;
  }
  const [a, b] = owners;
  const leader = counts[a] > counts[b] ? a : b;
  const follower = leader === a ? b : a;
  const needed = counts[follower] === 0 ? 1 : counts[follower] + CAPTURE_MARGIN;
  if (counts[leader] >= needed) state.score[leader] += 1;

  log.push({ phase: 'endOfTurn', type: 'score', detail: { p1: state.score.p1, p2: state.score.p2, p1Count: counts.p1, p2Count: counts.p2 } });

  // 8) 승리조건: 선도달 즉시 승리
  if (state.score.p1 >= WIN_SCORE || state.score.p2 >= WIN_SCORE) {
    state.winner = state.score.p1 >= WIN_SCORE ? 'p1' : 'p2';
    state.phase = 'gameOver';
    log.push({ phase: 'endOfTurn', type: 'win', detail: { winner: state.winner } });
  }

  // TODO: 스테일메이트(교착) 규칙 미정(기획서 10장) — 이번 구현 범위 밖, 추후 결정 필요

  state.turnNumber += 1;
}
