/**
 * **재생 속도 한 곳.**
 *
 * 읽을 수 있는 속도는 사람마다 다르고, 같은 사람도 규칙을 처음 배울 때와 100판째가 다르다 —
 * 한 값으로 못 박아 두면 누군가에게는 반드시 너무 빠르거나 너무 느리다. 실제로 "너무 빠르다"는
 * 지적이 나온 뒤 값을 올렸는데, 값을 올리는 것만으로는 반대쪽 사람이 생길 뿐이라 고르게 했다.
 *
 * 이 파일은 **아무것도 import하지 않는다.** 설정은 스토어(`gameStore`)가 들고, 시간 계산은
 * 화면(`resolutionMarkers`)이 한다 — 둘 다 여기를 보게 하려면 어느 쪽에도 얹혀 있으면 안 된다.
 */
export const PLAYBACK_SPEEDS = [
  { id: 'slow', label: '느리게', factor: 1.6 },
  { id: 'normal', label: '보통', factor: 1 },
  { id: 'fast', label: '빠르게', factor: 0.6 },
] as const;

export type PlaybackSpeedId = (typeof PLAYBACK_SPEEDS)[number]['id'];

export const DEFAULT_PLAYBACK_SPEED: PlaybackSpeedId = 'normal';

export function isPlaybackSpeedId(value: unknown): value is PlaybackSpeedId {
  return PLAYBACK_SPEEDS.some((s) => s.id === value);
}

export function speedFactor(id: PlaybackSpeedId): number {
  return PLAYBACK_SPEEDS.find((s) => s.id === id)?.factor ?? 1;
}
