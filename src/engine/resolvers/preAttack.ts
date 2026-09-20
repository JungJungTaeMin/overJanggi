import type { ActionPlan, Direction, GameState, Position, ResolutionEvent } from '../types';
import { getUnitType } from '../../data/unitTypes';
import { addStatusEffect, hasActiveEffect } from '../statusEffects';
import { DIRECTION_DELTA, inBounds, isObstacle, samePosition, step, unitAt } from '../grid';
import { canTargetWithSkill } from '../skillRange';
import { createUnitInstance } from '../createInitialState';
import { applyDamage } from '../damage';
import { killUnit } from '../death';

/**
 * 두 칸을 잇는 8방향 중 하나. 정확한 직선·대각선 위가 아니면 null이다.
 * 밀치기의 축이 `both`라서 대상은 반드시 이 조건을 만족한다 — null은 데이터가 어긋났다는 뜻.
 */
export function directionFrom(from: Position, to: Position): Direction | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  // 대각선이라면 정확한 45도여야 한다 — (2,1) 같은 어긋난 칸은 8방향으로 표현할 수 없다.
  if (dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy)) return null;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  return (Object.keys(DIRECTION_DELTA) as Direction[]).find((d) => DIRECTION_DELTA[d].x === sx && DIRECTION_DELTA[d].y === sy) ?? null;
}

/**
 * 밀치기가 대상을 어디로 보내는지. **판을 건드리지 않는다** — 해결 단계는 결과를 적용하고,
 * AI는 같은 함수로 두어 수를 견줘 본다. 둘이 서로 다른 계산을 들고 있으면 AI가 실제로는 일어나지
 * 않는 밀치기를 노리게 되는데, 그건 화면에 "왜 저기다 쓰지?"로만 보이고 원인을 찾을 수 없다.
 *
 * `distance`칸까지 **한 칸씩** 민다. 목적지만 보면 벽을 뚫고 반대편에 착지하기 때문이다(이동
 * 단계가 스텝 시뮬레이션을 하는 이유와 같다). 판 밖·장애물·다른 기물이 모두 벽 노릇을 하고,
 * 끝까지 못 간 경우에만 `collided`가 선다 — 다 밀려난 건 부딪힌 게 아니다.
 *
 * 부딪힌 **상대 기물은 피해를 받지 않는다.** 연쇄로 밀리게 만들면 밀치기 한 번이 판 전체를 흔들 수
 * 있어, 이 기물의 값이 "적이 얼마나 겹쳐 서 있었나"라는 통제 불가능한 변수에 좌우된다.
 */
export function shovePath(
  state: GameState,
  from: Position,
  dir: Direction,
  distance: number,
): { to: Position; moved: number; collided: boolean } {
  // 대상 자신이 경로를 막는 일은 없다 — 첫 칸부터 이미 자기 자리에서 한 칸 떨어져 있고,
  // 계속 같은 방향으로만 멀어지므로 자기 칸을 다시 밟지 않는다.
  let at = from;
  for (let moved = 0; moved < distance; moved++) {
    const next = step(at, dir);
    const blocked =
      !inBounds(next, state.board) || isObstacle(next, state.board) || unitAt(next, state.units) !== undefined;
    if (blocked) return { to: at, moved, collided: true };
    at = next;
  }
  return { to: at, moved: distance, collided: false };
}

/**
 * 갈고리가 대상을 어디까지 끌어오는지. 밀치기(`shovePath`)의 거울상이고, 판을 건드리지 않는
 * 것도 같은 이유다 — 해결과 AI가 같은 함수를 봐야 AI가 실제로 일어나지 않는 견인을 노리지 않는다.
 *
 * 밀치기와 다른 점은 **멈추는 조건이 하나 더 있다**는 것이다: 시전자 바로 옆에 닿으면 거기서
 * 멈춘다. 시전자 칸은 이미 점유돼 있으므로 그냥 두어도 막히긴 하지만, 그러면 "부딪혔다"로
 * 기록돼 벽에 처박은 것과 구분되지 않는다 — 갈고리는 **끝까지 당겨진 것**이 성공이다.
 */
export function pullPath(
  state: GameState,
  from: Position,
  dirToCaster: Direction,
  distance: number,
  caster: Position,
): { to: Position; moved: number } {
  let at = from;
  for (let moved = 0; moved < distance; moved++) {
    const next = step(at, dirToCaster);
    if (samePosition(next, caster)) return { to: at, moved };
    const blocked =
      !inBounds(next, state.board) || isObstacle(next, state.board) || unitAt(next, state.units) !== undefined;
    if (blocked) return { to: at, moved };
    at = next;
  }
  return { to: at, moved: distance };
}

/**
 * 전송이 아군을 세울 칸. 시전자 인접 8칸 중 **비어 있고 지형이 아닌** 칸을 고르되, 원래 자리에서
 * 가장 가까운 칸을 고른다 — 부른 아군이 판 반대쪽으로 빙 돌아 나타나면 "당겨 왔다"가 아니라
 * "순간이동시켰다"로 보이고, 무엇보다 어느 칸에 설지 예측할 수 없으면 계획을 세울 수가 없다.
 *
 * 동률은 **좌표 순서**로 끊는다. 무작위로 두면 같은 판에서 두 번 부를 때 결과가 달라져,
 * 재현되지 않는 실패가 생긴다.
 */
export function recallCell(state: GameState, caster: Position, from: Position): Position | null {
  const candidates = (Object.keys(DIRECTION_DELTA) as Direction[])
    .map((d) => step(caster, d))
    .filter(
      (c) => inBounds(c, state.board) && !isObstacle(c, state.board) && unitAt(c, state.units) === undefined,
    );
  if (candidates.length === 0) return null;
  const dist = (c: Position) => Math.max(Math.abs(c.x - from.x), Math.abs(c.y - from.y));
  return candidates.sort((a, b) => dist(a) - dist(b) || a.y - b.y || a.x - b.x)[0];
}

/** 2단계: 방벽·구속·공격모드 등 공격 전 상태변화(3.2절)
 *
 * `order`는 **이동 단계에서 쓴 우선순위 그대로**다. 이 단계의 효과는 원래 순서와 무관했지만
 * (상태이상은 서로 간섭하지 않는다) 밀치기가 들어오면서 처음으로 **순서가 결과를 바꾸는** 효과가
 * 생겼다 — 서로를 미는 두 기물 중 먼저 처리된 쪽만 성공한다. `[planP1, planP2]` 순서를 그대로
 * 두면 P1이 항상 이겨서 "먼저 입력한 쪽이 우선권을 갖지 않는다"는 이 게임의 전제가 깨진다.
 * 밀치기는 결국 **강제 이동**이므로 이번 턴 이동 순서를 그대로 물려받는다 — 코인을 새로 던지지
 * 않는 건 한 턴 안에서 같은 기물이 두 개의 다른 우선권을 갖는 게 더 설명하기 어렵기 때문이다.
 */
export function resolvePreAttack(
  state: GameState,
  planP1: ActionPlan,
  planP2: ActionPlan,
  log: ResolutionEvent[],
  order: string[] = [],
): void {
  const turnNumber = state.turnNumber;

  // 우선순위에 있는 기물이 먼저, 목록에 없는 기물(포탑 등)은 뒤에 원래 순서대로.
  const rank = new Map(order.map((id, i) => [id, i]));
  const entries: [string, ActionPlan['actions'][string]][] = [];
  for (const plan of [planP1, planP2]) entries.push(...Object.entries(plan.actions));
  entries.sort((a, b) => (rank.get(a[0]) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b[0]) ?? Number.MAX_SAFE_INTEGER));

  for (const [instanceId, unitPlan] of entries) {
    if (!unitPlan.skillUse) continue;
    const unit = state.units.find((u) => u.instanceId === instanceId);
    if (!unit || !unit.alive) continue;
    const typeDef = getUnitType(unit.typeId);
    const skill = typeDef.skills.find((s) => s.id === unitPlan.skillUse!.skillId);
    if (!skill || skill.effectCategory !== 'preAttack') continue;

    if (skill.id === 'tank3_barrier') {
      addStatusEffect(unit, 'barrier', turnNumber, unit.instanceId);
      unit.cooldowns[skill.id] = 1;
      log.push({ phase: 'preAttack', type: 'barrier', actorId: unit.instanceId });
    } else if (skill.id === 'tank3_root' || skill.id === 'support2_root') {
      const targetId = unitPlan.skillUse!.target as string | undefined;
      const target = state.units.find((u) => u.instanceId === targetId && u.alive);
      // 사거리는 이 단계(이동 직후) 기준으로 다시 본다 — 계획 시점에 닿았어도 대상이 달아났으면
      // 빗나간다. 쿨타임은 빗나가도 소모된다: 기술을 쓰기로 한 것 자체가 이번 턴의 선택이었다.
      const inRange = !!target && canTargetWithSkill(unit, target, skill, state.board);
      // 두 구속의 강도가 다르다: tank3은 발만 묶고(root), support2는 그 턴을 통째로 날린다(stun).
      // support2가 더 센 이유는 이 기물이 공격을 아예 못 하기 때문이다 — 유일한 방해 수단이다.
      const effect = skill.id === 'support2_root' ? 'stun' : 'root';
      if (target && inRange) addStatusEffect(target, effect, turnNumber, unit.instanceId);
      if (skill.id === 'tank3_root') unit.cooldowns[skill.id] = 5;
      log.push({ phase: 'preAttack', type: effect, actorId: unit.instanceId, targetId, detail: { landed: inRange } });
    } else if (skill.id === 'tank4_shove') {
      /**
       * **밀치기** — 적 하나를 시전자 반대 방향으로 밀어낸다.
       *
       * 미는 방향을 사용자가 고르지 않는다. 축이 `both`라 대상은 항상 정확한 직선·대각선 위에
       * 있고, 그러면 "나에게서 멀어지는 방향"은 8방향 중 하나로 유일하게 정해진다 — 방향을
       * 따로 받으면 "내 쪽으로 당기기"까지 생겨 기물이 두 개가 된다.
       *
       * 구속(root)·기절(stun)에 걸린 적도 밀린다. 그 상태이상들이 막는 건 **자기 발로 걷는
       * 것**이고 이건 남이 미는 것이다 — 여기서 면역을 주면 제어 기물끼리 서로를 무력화한다.
       */
      const targetId = unitPlan.skillUse!.target as string | undefined;
      const target = state.units.find((u) => u.instanceId === targetId && u.alive && u.owner !== unit.owner);
      // 구속과 같은 이유로 사거리를 이 시점(이동 직후)에 다시 본다. 쿨타임은 빗나가도 소모된다.
      const canReach = !!target && !!unit.position && canTargetWithSkill(unit, target, skill, state.board);
      const dir = canReach ? directionFrom(unit.position!, target!.position!) : null;
      let moved = 0;
      let collided = false;
      if (target && dir) {
        const path = shovePath(state, target.position!, dir, skill.payload.distance ?? 1);
        target.position = path.to;
        moved = path.moved;
        collided = path.collided;
      }
      unit.cooldowns[skill.id] = skill.gate.type === 'cooldown' ? skill.gate.turns : 0;
      // 밀친 사실을 **부딪힌 피해보다 먼저** 남긴다. 로그는 읽는 순서가 곧 인과라서, 충돌이 위에
      // 오면 "왜 갑자기 벽에 부딪혔지" 하고 한 줄 아래를 찾아 내려가게 된다(브라우저에서 확인).
      log.push({
        phase: 'preAttack',
        type: 'shove',
        actorId: unit.instanceId,
        targetId,
        detail: { landed: !!dir, cells: moved, collided, to: target?.position ?? null },
      });
      // 충돌 피해는 **끝까지 못 밀렸을 때만**이다. 한 칸도 못 갔어도(등 뒤가 벽) 부딪힌 건
      // 부딪힌 것이므로 피해가 들어간다 — 벽에 붙은 적을 미는 것이 헛수고가 되면 안 된다.
      if (target && collided) {
        const damage = skill.payload.wallDamage ?? 0;
        applyDamage(target, damage);
        log.push({
          phase: 'preAttack',
          type: 'shoveImpact',
          actorId: unit.instanceId,
          targetId,
          detail: { damage },
        });
        if (target.currentHp <= 0) killUnit(target, log);
      }
    } else if (skill.id === 'tank5_hook') {
      /**
       * **갈고리** — 적 하나를 시전자 쪽으로 끌어온다. 밀치기의 거울상이라 구조가 같다:
       * 방향을 사용자가 고르지 않고(축이 both라 유일하게 정해진다), 사거리는 이 시점(이동 직후)에
       * 다시 보고, 쿨타임은 빗나가도 소모된다.
       *
       * **벽에 처박는 피해가 없다.** 밀치기의 충돌 피해는 "밀 곳이 없는데도 민" 보상인데, 끌어오기는
       * 길이 막히면 그냥 덜 끌려올 뿐 아무것도 낭비되지 않는다 — 이미 가까워졌다는 뜻이기 때문이다.
       */
      const targetId = unitPlan.skillUse!.target as string | undefined;
      const target = state.units.find((u) => u.instanceId === targetId && u.alive && u.owner !== unit.owner);
      const canReach = !!target && !!unit.position && canTargetWithSkill(unit, target, skill, state.board);
      // 밀치기는 "나에게서 멀어지는" 방향이고 갈고리는 그 반대 — 대상에서 시전자를 향하는 방향이다.
      const dir = canReach ? directionFrom(target!.position!, unit.position!) : null;
      let moved = 0;
      if (target && dir) {
        const path = pullPath(state, target.position!, dir, skill.payload.distance ?? 1, unit.position!);
        target.position = path.to;
        moved = path.moved;
      }
      unit.cooldowns[skill.id] = skill.gate.type === 'cooldown' ? skill.gate.turns : 0;
      log.push({
        phase: 'preAttack',
        type: 'hook',
        actorId: unit.instanceId,
        targetId,
        detail: { landed: !!dir, cells: moved, to: target?.position ?? null },
      });
    } else if (skill.id === 'support5_recall') {
      /**
       * **전송** — 아군 하나를 시전자 옆 빈 칸으로 부른다.
       *
       * 대상 검사가 조준 보조와 같다(살아 있는 **다른** 아군). 자기 자신을 지정하면 제자리로
       * 옮기는 셈이라 턴만 버리고, 그건 사용자가 의도한 수일 리가 없다.
       *
       * 옆이 꽉 차 있으면 아무 일도 일어나지 않되 **쿨타임은 소모된다** — 다른 모든 대상 지정
       * 기술과 같은 규칙이다(빗나가도 그 턴의 선택은 이미 쓴 것이다).
       */
      const targetId = unitPlan.skillUse!.target as string | undefined;
      const target = state.units.find(
        (u) => u.instanceId === targetId && u.alive && u.owner === unit.owner && u.instanceId !== unit.instanceId,
      );
      const inRange = !!target && !!unit.position && !!target.position && canTargetWithSkill(unit, target, skill, state.board);
      const cell = inRange ? recallCell(state, unit.position!, target!.position!) : null;
      if (target && cell) target.position = cell;
      unit.cooldowns[skill.id] = skill.gate.type === 'cooldown' ? skill.gate.turns : 0;
      log.push({
        phase: 'preAttack',
        type: 'recall',
        actorId: unit.instanceId,
        targetId,
        detail: { landed: !!cell, to: cell },
      });
    } else if (skill.id === 'support6_mark') {
      /**
       * **표식** — 적 하나가 이번 턴 받는 모든 피해를 늘린다. 피해를 더하는 곳은 여기가 아니라
       * 공격 판정(engine/aim.ts)이다 — 표식은 상태이상일 뿐이고, 누가 때리든 같은 값이 붙어야
       * 하므로 「맞는 쪽」에서 한 번만 읽는다.
       */
      const targetId = unitPlan.skillUse!.target as string | undefined;
      const target = state.units.find((u) => u.instanceId === targetId && u.alive && u.owner !== unit.owner);
      const bonus = skill.payload.bonusDamage ?? 0;
      const landed = !!target && canTargetWithSkill(unit, target, skill, state.board);
      if (target && landed) {
        /**
         * **표식만 유일하게 `addStatusEffect`를 안 쓴다.** 그 함수는 "1턴"을 `+1`로 새기는데,
         * 이 판에서 「1턴」은 **적용된 턴과 그 다음 턴, 두 번의 해결에 걸쳐** 살아 있다(§8).
         * 방벽에는 그게 옳다 — 방벽은 "이번 턴 맞을 것"이 아니라 "다음 상대 턴을 버티는 것"이니까.
         *
         * 그런데 표식에 같은 규칙을 쓰면 **쿨타임 없는 기술 하나가 두 턴 내내 팀 전체의 피해를
         * 올린다.** 실측 승률이 71%로 튀었고(기준 50%), 설명문 "그 턴 동안"과도 어긋났다.
         * 숫자를 깎아 덮으려 해 봤지만 표식 3까지 내려도 64%였다 — 값이 아니라 **지속이** 문제였다.
         *
         * 그래서 `expiresAfterTurn = turnNumber`다. 이번 턴 공격 판정(3단계)에는 살아 있고 같은
         * 턴 종료의 pruneExpiredEffects(nextTurn)에서 지워진다. 화상이 `-1`을 쓰는 것과 같은
         * 계산이고 이유도 같다: "몇 턴 붙어 있나"가 아니라 **"몇 번 쓰이나"**로 세야 한다.
         */
        target.statusEffects.push({
          type: 'mark',
          appliedOnTurn: turnNumber,
          expiresAfterTurn: turnNumber,
          magnitude: bonus,
          sourceId: unit.instanceId,
        });
      }
      log.push({
        phase: 'preAttack',
        type: 'mark',
        actorId: unit.instanceId,
        targetId,
        detail: { landed, amount: landed ? bonus : 0 },
      });
    } else if (skill.id === 'support2_buff') {
      // 조준 보조: 사선 위 아군 1명의 공격력을 올린다. 구속과 같은 이유로 사거리를 여기서 다시 보고,
      // 대상이 **자기 팀의 다른 기물**인지까지 확인한다 — 적을 강화하거나 자기 자신을 지정하면 안 된다
      // (support2는 공격 자체를 못 하므로 자가 버프는 그냥 턴 낭비다).
      const targetId = unitPlan.skillUse!.target as string | undefined;
      const target = state.units.find(
        (u) => u.instanceId === targetId && u.alive && u.owner === unit.owner && u.instanceId !== unit.instanceId,
      );
      const bonus = skill.payload.attackBonus ?? 0;
      const landed = !!target && canTargetWithSkill(unit, target, skill, state.board);
      if (target && landed) addStatusEffect(target, 'buff', turnNumber, unit.instanceId, bonus);
      log.push({
        phase: 'preAttack',
        type: 'buff',
        actorId: unit.instanceId,
        targetId,
        detail: { landed, amount: landed ? bonus : 0 },
      });
    } else if (skill.id === 'support4_veil') {
      /**
       * 차단막은 대상도 사거리도 없다 — 러너 주변 8칸을 이번 턴과 다음 턴 동안 "판정이 지워지는 칸"으로
       * 만들 뿐이고, 어느 칸이 덮이는지는 러너의 **현 위치**에서 veil.ts가 그때그때 계산한다.
       * 그래서 러너가 다음 턴에 움직이면 차단막도 함께 따라간다 — 고정 장판이 아니라 몸에 붙은 장이다.
       *
       * 여기(2단계)에 있는 것만으로 "무조건 공격보다 먼저"가 성립한다. 3단계 공격도 4단계 회복도
       * 항상 이 뒤에 오므로 특별 취급이 필요 없다.
       */
      addStatusEffect(unit, 'veil', turnNumber, unit.instanceId);
      unit.cooldowns[skill.id] = 5;
      log.push({ phase: 'preAttack', type: 'veil', actorId: unit.instanceId, detail: { at: unit.position } });
    } else if (skill.id === 'dealer3_attack_mode') {
      const currentlyOn = hasActiveEffect(unit, 'attackMode', turnNumber);
      if (currentlyOn) {
        unit.statusEffects = unit.statusEffects.filter((e) => e.type !== 'attackMode');
      } else {
        addStatusEffect(unit, 'attackMode', turnNumber, unit.instanceId);
      }
      log.push({ phase: 'preAttack', type: 'toggle', actorId: unit.instanceId, detail: { on: !currentlyOn } });
    } else if (skill.id === 'support3_turret') {
      const frontDir = unitPlan.skillUse!.target as Direction | undefined;
      if (unit.position && frontDir) {
        const cell = step(unit.position, frontDir);
        const occupied = state.units.some((u) => u.alive && u.position && samePosition(u.position, cell));
        if (!occupied) {
          // 포탑은 **팀당 1기**. 이번 턴 설치를 계획한 팀의 기존 포탑은 이미 턴 시작
          // 단계(turnStart.ts)에서 철거됐지만, 같은 팀 support3이 두 기라면 이 루프 안에서
          // 둘 다 세우려 든다 — 그래서 설치 시점에도 같은 팀 포탑을 걷어내 불변식을 지킨다.
          state.units = state.units.filter((u) => !(u.isTurret && u.owner === unit.owner));
          const turret = createUnitInstance('turret', unit.owner, cell);
          state.units.push(turret);
          log.push({ phase: 'preAttack', type: 'turretSpawn', actorId: unit.instanceId, detail: { at: cell } });
        }
      }
    }
  }
}
