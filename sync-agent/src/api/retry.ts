/**
 * 지수 백오프 재시도 로직
 *
 * 재시도 전략:
 *   네트워크 오류 / 500: 30초 → 1분 → 5분 → 15분 (무제한)
 *   서버 500:           1분 → 5분 → 15분 (최대 10회)
 *   401 인증 실패:       즉시 중단
 *   400 데이터 오류:     건별 스킵
 *
 * 변경사항 (2026-02-11):
 *   - test 프리셋 추가: 2초 시작, 최대 3회 (큐 적재 테스트용)
 *   - getRetryPreset() 추가: 환경변수 RETRY_PRESET=test 로 전환 가능
 */

import { getLogger } from '../logger';

const logger = getLogger('api:retry');

export interface RetryConfig {
  /** 초기 대기 시간 (ms) */
  initialDelay: number;
  /** 최대 대기 시간 (ms) */
  maxDelay: number;
  /** 최대 재시도 횟수 (0 = 무제한) */
  maxRetries: number;
  /** 백오프 배수 */
  multiplier: number;
}

export const RETRY_PRESETS = {
  /** 네트워크 오류: 무제한 재시도 */
  network: {
    initialDelay: 30_000,   // 30초
    maxDelay: 900_000,      // 15분
    maxRetries: 0,          // 무제한
    multiplier: 2,
  } satisfies RetryConfig,

  /** 서버 오류 (500): 최대 10회 */
  server: {
    initialDelay: 60_000,   // 1분
    maxDelay: 900_000,      // 15분
    maxRetries: 10,
    multiplier: 3,
  } satisfies RetryConfig,

  /** DB 접속 오류: 최대 10회 */
  database: {
    initialDelay: 60_000,   // 1분
    maxDelay: 300_000,      // 5분
    maxRetries: 10,
    multiplier: 2,
  } satisfies RetryConfig,

  /** 🧪 테스트용: 빠르게 소진 (큐 적재 테스트) */
  test: {
    initialDelay: 2_000,    // 2초
    maxDelay: 5_000,        // 5초
    maxRetries: 3,          // 3회면 소진
    multiplier: 2,
  } satisfies RetryConfig,
};

/**
 * 환경변수 RETRY_PRESET에 따라 적절한 재시도 설정 반환
 *
 * RETRY_PRESET=test → 빠른 재시도 (큐 적재 테스트용)
 * 미설정 / 기타    → 프로덕션 설정
 */
export function getRetryPreset(type: 'server' | 'network' | 'database'): RetryConfig {
  if (process.env.RETRY_PRESET === 'test') {
    logger.warn(`🧪 테스트용 재시도 설정 사용 (${RETRY_PRESETS.test.maxRetries}회, ${RETRY_PRESETS.test.initialDelay}ms)`);
    return RETRY_PRESETS.test;
  }
  return RETRY_PRESETS[type];
}

/**
 * 재시도 불필요한 에러인지 판별
 */
export function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return true;

  const err = error as Record<string, unknown>;

  // HTTP 상태 코드 기반 판별
  const status = err.status ?? err.statusCode ?? (err.response as Record<string, unknown>)?.status;

  if (status === 401 || status === 403) {
    logger.error('인증 실패 — 재시도하지 않습니다.', { status });
    return false;
  }

  if (status === 400) {
    logger.warn('잘못된 요청 (400) — 건별 스킵', { status });
    return false;
  }

  return true;
}

/**
 * 지수 백오프로 비동기 함수를 재시도합니다.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  label: string = 'operation',
): Promise<T> {
  let attempt = 0;
  let delay = config.initialDelay;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;

      if (!isRetryableError(error)) {
        throw error;
      }

      if (config.maxRetries > 0 && attempt >= config.maxRetries) {
        logger.error(`${label}: 최대 재시도 횟수(${config.maxRetries}) 초과`, { attempt });
        throw error;
      }

      // 지터(jitter) 추가: ±20%
      const jitter = delay * (0.8 + Math.random() * 0.4);
      const actualDelay = Math.min(jitter, config.maxDelay);

      logger.warn(
        `${label}: 재시도 ${attempt}회 (${Math.round(actualDelay / 1000)}초 후)`,
        { error: error instanceof Error ? error.message : String(error) },
      );

      await sleep(actualDelay);
      delay = Math.min(delay * config.multiplier, config.maxDelay);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
