export type AiDifficulty = 'easy' | 'normal' | 'hard';

/**
 * 난이도는 "AI를 얼마나 똑똑하게 만들까"가 아니라 **어떤 실수를 얼마나 허용할까**로 정의한다.
 * 같은 평가 함수를 공유하고 아래 계수만 다르므로, 쉬움도 말이 되는 수를 두되 자주 손해를 본다.
 */
export interface DifficultyProfile {
  id: AiDifficulty;
  label: string;
  description: string;
  /** 후보 점수에 섞는 잡음의 폭. 크면 최선수를 자주 놓친다. */
  noise: number;
  /** 기술(스킬)을 후보로 검토하는지. 쉬움은 기본 행동만 쓴다. */
  useSkills: boolean;
  /** 점령지 가치 가중치 — 낮으면 점령을 잊고 싸움만 한다. */
  captureWeight: number;
  /** 적 사거리 안에 서는 것에 대한 회피 성향. 0이면 위협을 아예 못 본다. */
  threatWeight: number;
  /** 처치 가능한 대상에 얼마나 집중하는지(마무리 감각). */
  killWeight: number;
}

export const DIFFICULTY_PROFILES: Record<AiDifficulty, DifficultyProfile> = {
  easy: {
    id: 'easy',
    label: '쉬움',
    description: '기술을 쓰지 않고, 눈앞의 적에게 반응만 합니다. 자주 실수합니다.',
    noise: 16,
    useSkills: false,
    captureWeight: 0.5,
    threatWeight: 0,
    killWeight: 8,
  },
  normal: {
    id: 'normal',
    label: '보통',
    description: '기술을 쓰고 점령지를 노립니다. 가끔 손해 보는 수를 둡니다.',
    noise: 5,
    useSkills: true,
    captureWeight: 1.2,
    threatWeight: 0.35,
    killWeight: 18,
  },
  hard: {
    id: 'hard',
    label: '어려움',
    description: '점령지를 우선하고, 사거리 밖에서 접근하며, 마무리를 놓치지 않습니다.',
    noise: 0.6,
    useSkills: true,
    captureWeight: 2,
    threatWeight: 1,
    killWeight: 30,
  },
};

export const DIFFICULTY_ORDER: AiDifficulty[] = ['easy', 'normal', 'hard'];
