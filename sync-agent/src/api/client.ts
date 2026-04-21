/**
 * Target-UP Sync API 클라이언트
 * 모든 서버 통신의 단일 진입점
 *
 * 변경사항 (2026-02-11):
 *   - RETRY_PRESETS.server → getRetryPreset('server')로 변경
 *   - RETRY_PRESET=test 환경변수로 빠른 재시도 테스트 가능
 *   - checkVersion: currentVersion, agentId 파라미터 추가
 *   - getConfig: agentId 파라미터 추가
 *   - downloadVersion: exe 스트림 다운로드 (Phase 5 추가)
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { ENDPOINTS } from './endpoints';
import { createAuthHeaders, type AuthCredentials } from './auth';
import { withRetry, getRetryPreset } from './retry';
import { getLogger } from '../logger';
import type {
  ApiResponse,
  SyncCustomersRequest,
  SyncCustomersResponse,
  SyncPurchasesRequest,
  SyncPurchasesResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  SyncLogRequest,
  RemoteConfig,
  RegisterRequest,
  RegisterResponse,
  VersionResponse,
  FieldDefinitionsRequest,
  FieldDefinitionsResponse,
  AiMappingRequest,
  AiMappingResponse,
  FieldMapResponse,
} from '../types/api';

const logger = getLogger('api:client');

/**
 * v1.5.0 — 싱크 응답 config 감지 콜백.
 * main.ts에서 Scheduler.applyRemoteConfig를 바인딩.
 */
export type RemoteConfigHandler = (config: RemoteConfig) => void;

export class ApiClient {
  private http: AxiosInstance;
  private credentials: AuthCredentials;
  /** v1.5.0: 싱크 응답의 config를 받아 스케줄러에 전달하는 콜백 */
  private onRemoteConfig: RemoteConfigHandler | null = null;

  constructor(baseUrl: string, credentials: AuthCredentials) {
    this.credentials = credentials;

    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 60_000, // 60초 (벌크 전송 대비)
      headers: createAuthHeaders(credentials),
    });

    // 요청/응답 로깅
    this.http.interceptors.request.use((config) => {
      logger.debug(`→ ${config.method?.toUpperCase()} ${config.url}`, {
        dataSize: config.data ? JSON.stringify(config.data).length : 0,
      });
      return config;
    });

    this.http.interceptors.response.use(
      (response) => {
        logger.debug(`← ${response.status} ${response.config.url}`);
        return response;
      },
      (error: AxiosError) => {
        // ★ D131 후속(2026-04-21): 서버 응답 body의 detail/error 메시지까지 로깅.
        //   기존엔 'Request failed with status code 500'만 노출되어 원인 추적 불가.
        //   B31-02 CT-07 field-definitions 500 원인 확정을 위해 본문 상세 포함.
        const body = error.response?.data as any;
        const bodyDetail = body?.detail || body?.error?.message || body?.error;
        logger.error(`← ERROR ${error.response?.status ?? 'NETWORK'} ${error.config?.url}`, {
          message: error.message,
          status: error.response?.status,
          serverDetail: typeof bodyDetail === 'string' ? bodyDetail : bodyDetail ? JSON.stringify(bodyDetail) : undefined,
        });
        throw error;
      },
    );
  }

  /** v1.5.0: 싱크 응답 config 핸들러 등록 (main.ts에서 Scheduler.applyRemoteConfig 연결) */
  setRemoteConfigHandler(handler: RemoteConfigHandler): void {
    this.onRemoteConfig = handler;
  }

  /** v1.5.0: 응답 데이터에서 config 추출 후 핸들러 호출 */
  private applyConfigFromResponse(data: any): void {
    try {
      if (data && data.config && this.onRemoteConfig) {
        this.onRemoteConfig(data.config as RemoteConfig);
      }
    } catch (e) {
      logger.debug('응답 config 처리 실패 (무시)', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ─── 고객 동기화 ──────────────────────────────────────

  async syncCustomers(request: SyncCustomersRequest): Promise<ApiResponse<SyncCustomersResponse>> {
    return withRetry(
      async () => {
        const { data } = await this.http.post<ApiResponse<SyncCustomersResponse>>(
          ENDPOINTS.SYNC_CUSTOMERS,
          request,
        );
        this.applyConfigFromResponse(data);
        return data;
      },
      getRetryPreset('server'),
      'syncCustomers',
    );
  }

  // ─── 구매내역 동기화 ─────────────────────────────────

  async syncPurchases(request: SyncPurchasesRequest): Promise<ApiResponse<SyncPurchasesResponse>> {
    return withRetry(
      async () => {
        const { data } = await this.http.post<ApiResponse<SyncPurchasesResponse>>(
          ENDPOINTS.SYNC_PURCHASES,
          request,
        );
        this.applyConfigFromResponse(data);
        return data;
      },
      getRetryPreset('server'),
      'syncPurchases',
    );
  }

  // ─── Heartbeat ────────────────────────────────────────

  async heartbeat(request: HeartbeatRequest): Promise<HeartbeatResponse | null> {
    try {
      const { data } = await this.http.post<ApiResponse<HeartbeatResponse>>(
        ENDPOINTS.HEARTBEAT,
        request,
      );
      // ★ D131 후속(2026-04-21): 서버 응답 최상위 remoteConfig를 HeartbeatResponse로 병합.
      //   백엔드가 heartbeat 응답 최상위에 remoteConfig.commands를 실어 보냄.
      //   기존엔 data.data만 반환해서 commands를 놓침 → pause/resume 명령 영영 수신 못 함.
      const result = (data.data ?? {}) as HeartbeatResponse;
      if (data.remoteConfig) {
        result.remoteConfig = data.remoteConfig;
      }
      return result;
    } catch (error) {
      logger.warn('Heartbeat 전송 실패 (무시하고 계속)', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  // ─── 동기화 로그 전송 ─────────────────────────────────

  async sendLog(request: SyncLogRequest): Promise<void> {
    try {
      await this.http.post(ENDPOINTS.LOG, {
        agent_id: request.agentId,
        sync_type: request.syncType,
        sync_mode: request.syncMode,
        total_count: request.totalCount,
        success_count: request.successCount,
        fail_count: request.failCount,
        duration_ms: request.durationMs,
        error_message: request.errorMessage,
        started_at: request.startedAt,
        completed_at: request.completedAt,
      });
    } catch (error) {
      logger.warn('로그 전송 실패 (무시하고 계속)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ─── 원격 설정 조회 ───────────────────────────────────

  async getConfig(agentId?: string): Promise<RemoteConfig | null> {
    try {
      const url = agentId
        ? `${ENDPOINTS.CONFIG}?agent_id=${encodeURIComponent(agentId)}`
        : ENDPOINTS.CONFIG;
      const { data } = await this.http.get<ApiResponse<RemoteConfig>>(url);
      return data.data ?? null;
    } catch (error) {
      logger.warn('원격 설정 조회 실패', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  // ─── Agent 등록 ───────────────────────────────────────

  async register(request: RegisterRequest): Promise<RegisterResponse> {
    const { data } = await this.http.post<ApiResponse<RegisterResponse>>(
      ENDPOINTS.REGISTER,
      request,
    );

    if (!data.success || !data.data) {
      throw new Error(`Agent 등록 실패: ${data.error?.message ?? '알 수 없는 오류'}`);
    }

    logger.info('Agent 등록 완료', {
      agentId: data.data.agentId,
      companyName: data.data.companyName,
    });

    return data.data;
  }

  // ─── 버전 확인 ────────────────────────────────────────

  async checkVersion(currentVersion?: string, agentId?: string): Promise<VersionResponse | null> {
    try {
      const params = new URLSearchParams();
      if (currentVersion) params.set('current_version', currentVersion);
      if (agentId) params.set('agent_id', agentId);
      const query = params.toString();
      const url = query ? `${ENDPOINTS.VERSION}?${query}` : ENDPOINTS.VERSION;

      const { data } = await this.http.get<ApiResponse<VersionResponse>>(url);
      return data.data ?? null;
    } catch (error) {
      logger.debug('버전 확인 실패 (무시)', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  // ─── 커스텀 필드 라벨 등록 (v1.4.0) ────────────────────

  async registerFieldDefinitions(
    request: FieldDefinitionsRequest,
  ): Promise<FieldDefinitionsResponse | null> {
    try {
      const { data } = await this.http.post<ApiResponse<FieldDefinitionsResponse>>(
        ENDPOINTS.FIELD_DEFINITIONS,
        request,
      );
      logger.info('커스텀 필드 정의 등록 완료', {
        count: request.definitions.length,
      });
      return data.data ?? null;
    } catch (error) {
      logger.warn('커스텀 필드 정의 등록 실패 (무시하고 계속)', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  // ─── v1.5.0: AI 컬럼 매핑 호출 ────────────────────────

  async aiMapping(request: AiMappingRequest): Promise<AiMappingResponse> {
    const { data } = await this.http.post<ApiResponse<AiMappingResponse>>(
      ENDPOINTS.AI_MAPPING,
      request,
    );
    if (!data.success || !data.data) {
      const errMsg = (data as any).error || 'AI 매핑 실패';
      throw new Error(typeof errMsg === 'string' ? errMsg : errMsg.message || 'AI 매핑 실패');
    }
    return data.data;
  }

  // ─── v1.5.0 M-4: FIELD_MAP 동적 수신 ──────────────────

  async getFieldMap(): Promise<FieldMapResponse | null> {
    try {
      const { data } = await this.http.get<ApiResponse<FieldMapResponse>>(ENDPOINTS.FIELD_MAP);
      return data.data ?? null;
    } catch (error) {
      logger.warn('FIELD_MAP 조회 실패 (무시하고 로컬 스키마 사용)', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  // ─── exe 다운로드 (자동 업데이트) — Phase 5 추가 ──────

  /**
   * 새 버전 exe 스트림 다운로드
   *
   * @param downloadUrl 서버 제공 URL 또는 기본 DOWNLOAD 엔드포인트
   * @param version 다운로드할 버전 문자열
   * @returns axios 스트림 응답 (response.data가 Readable 스트림)
   */
  async downloadVersion(
    downloadUrl?: string,
    version?: string,
  ): Promise<{ stream: NodeJS.ReadableStream; totalSize: number }> {
    const url = downloadUrl || `${ENDPOINTS.DOWNLOAD}/${version}`;

    logger.info(`exe 다운로드 시작: ${url}`);

    const response = await this.http.get(url, {
      responseType: 'stream',
      timeout: 5 * 60_000, // 5분 (큰 파일 대비)
    });

    const totalSize = parseInt(response.headers['content-length'] || '0', 10);

    return {
      stream: response.data,
      totalSize,
    };
  }
}
