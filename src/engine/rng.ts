import type { Owner } from './types';

export type RngFn = () => number;

/** 턴 시작 시 무작위 선공권. 동순위 충돌 타이브레이크에만 쓰인다(단계 순서 자체는 항상 고정). */
export function flipFirstMover(rngFn: RngFn = Math.random): Owner {
  return rngFn() < 0.5 ? 'p1' : 'p2';
}

/**
 * 시드 하나로 재현되는 난수(mulberry32). AI 테스트가 "이 상황에서 이 수를 둔다"를 단정할 수 있으려면
 * 난수가 결정론적이어야 한다 — Math.random을 그대로 쓰면 같은 국면에서도 결과가 흔들린다.
 */
export function seededRng(seed: number): RngFn {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
