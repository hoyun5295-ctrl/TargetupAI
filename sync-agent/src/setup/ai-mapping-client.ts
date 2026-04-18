/**
 * setup/ai-mapping-client.ts
 * ==========================
 * SyncAgent v1.5.0 — 설치 마법사용 AI 매핑 클라이언트
 *
 * 배경: 설치 마법사 단계에서는 ApiClient 인스턴스가 아직 구성되기 전일 수 있다.
 *       (서버 URL/API 키 입력 직후 Step 4에서 AI 매핑 호출)
 *
 * 역할: 설치 마법사(setup-html.ts, cli.ts, edit-config.ts)에서
 *       서버 `POST /api/sync/ai-mapping`을 직접 호출하는 경량 함수.
 *
 * ⚠️ API 키는 절대 Agent 번들에 포함시키지 않는다 (설계서 §5-3 PII 정책).
 *    사용자가 입력한 서버 접속 정보(apiKey, apiSecret)만 헤더로 전송.
 */

import axios from 'axios';
import type {
  AiMappingRequest,
  AiMappingResponse,
  FieldMapResponse,
  ApiResponse,
} from '../types/api';
import { createAuthHeaders, type AuthCredentials } from '../api/auth';
import { ENDPOINTS } from '../api/endpoints';
import { getLogger } from '../logger';

const logger = getLogger('setup:ai-mapping');

export interface SetupAiMappingOptions {
  serverUrl: string;
  credentials: AuthCredentials;
  timeoutMs?: number;
}

/**
 * 설치 마법사 단계에서 AI 컬럼 매핑 호출.
 *
 * 반환:
 *   - 성공: AiMappingResponse
 *   - 쿼터 초과(429): 명확한 에러 메시지와 함께 throw
 *   - 서비스 불가(503): throw (Agent는 로컬 autoSuggestMapping 폴백 사용)
 *   - 네트워크 오류: throw
 */
export async function requestAiMapping(
  options: SetupAiMappingOptions,
  request: AiMappingRequest,
): Promise<AiMappingResponse> {
  const { serverUrl, credentials, timeoutMs = 60_000 } = options;

  try {
    const response = await axios.post<ApiResponse<AiMappingResponse>>(
      serverUrl.replace(/\/$/, '') + ENDPOINTS.AI_MAPPING,
      request,
      {
        headers: createAuthHeaders(credentials),
        timeout: timeoutMs,
      },
    );
    if (!response.data.success || !response.data.data) {
      const err = (response.data as any).error;
      throw new Error(typeof err === 'string' ? err : err?.message || 'AI 매핑 응답 실패');
    }
    logger.info(`AI 매핑 완료: ${request.columns.length}개 컬럼, 모델=${response.data.data.modelUsed}`);
    return response.data.data;
  } catch (error: any) {
    if (error?.response?.status === 429) {
      const detail = error.response.data?.error || 'AI 매핑 호출 한도 초과 (월 10회)';
      logger.warn(`AI 매핑 쿼터 초과: ${detail}`);
      const e = new Error(detail);
      (e as any).code = 'AI_MAPPING_QUOTA_EXCEEDED';
      throw e;
    }
    if (error?.response?.status === 503) {
      const detail = error.response.data?.error || 'AI 매핑 서비스 일시 장애';
      logger.warn(`AI 매핑 서비스 불가: ${detail}`);
      const e = new Error(detail);
      (e as any).code = 'AI_MAPPING_UNAVAILABLE';
      throw e;
    }
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`AI 매핑 호출 실패: ${msg}`);
    throw new Error(`AI 매핑 호출 실패: ${msg}`);
  }
}

/**
 * 설치 마법사 단계에서 FIELD_MAP 수신 (M-4).
 * 서버의 현재 표준 필드 정의를 받아 Agent config.enc에 캐시.
 */
export async function fetchFieldMap(
  options: SetupAiMappingOptions,
): Promise<FieldMapResponse | null> {
  const { serverUrl, credentials, timeoutMs = 15_000 } = options;
  try {
    const response = await axios.get<ApiResponse<FieldMapResponse>>(
      serverUrl.replace(/\/$/, '') + ENDPOINTS.FIELD_MAP,
      {
        headers: createAuthHeaders(credentials),
        timeout: timeoutMs,
      },
    );
    if (!response.data.success || !response.data.data) return null;
    return response.data.data;
  } catch (error) {
    logger.warn('FIELD_MAP 수신 실패 (기본 로컬 스키마 사용)', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
