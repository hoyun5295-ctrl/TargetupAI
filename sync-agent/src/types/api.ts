/**
 * Target-UP Sync API 요청/응답 타입
 */

import type { SyncTarget, SyncMode, AgentStatus } from './sync';
import type { Customer } from './customer';
import type { Purchase } from './purchase';

// ─── 공통 ───────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  // ★ D131 후속(2026-04-21): heartbeat/sync 응답 최상위에 원격 설정/명령 포함 가능.
  //   서버가 sync_agents.config.commands를 꺼내 여기에 실어 보냄 (heartbeat 라우트 추가 전달 경로).
  remoteConfig?: import('./api').RemoteConfig;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  // ★ D131 후속: 서버 에러 응답 상세 (예: CT-07 field-definitions 500 원인 추적)
  detail?: string;
}

// ─── POST /api/sync/customers ───────────────────────────

export interface SyncCustomersRequest {
  customers: Customer[];
  mode: SyncMode;
  batchIndex?: number;
  totalBatches?: number;
}

export interface SyncCustomersResponse {
  upsertedCount: number;
  failedCount: number;
  failures?: Array<{
    phone: string;
    reason: string;
  }>;
}

// ─── POST /api/sync/purchases ───────────────────────────

export interface SyncPurchasesRequest {
  purchases: Purchase[];
  mode: SyncMode;
  batchIndex?: number;
  totalBatches?: number;
}

export interface SyncPurchasesResponse {
  insertedCount: number;
  failedCount: number;
  failures?: Array<{
    customerPhone: string;
    reason: string;
  }>;
}

// ─── POST /api/sync/heartbeat ───────────────────────────

export interface HeartbeatRequest {
  agentId: string;
  agentVersion: string;
  status: AgentStatus;
  osInfo: string;
  dbType: string;
  lastSyncAt: string | null;
  totalCustomersSynced: number;
  queuedItems: number;
  uptime: number;  // seconds
  // ★ v1.6.1 (2026-07-10 원격 관리 전수 점검 P0-1): 에이전트 자기 보고 — 서버가 config.reported에 사본 저장.
  //   슈퍼관리자가 "지금 뭐가 매핑돼 있나/소스 컬럼이 뭔가"를 원격에서 보는 유일한 통로(진실 이원화 D7 해소).
  //   구버전 서버는 이 필드를 무시(하위호환).
  reported?: AgentSelfReport;
  // ★ v1.6.1 (P1-4): 명령 실행 결과 ACK — 서버는 ACK 수신 시에만 명령 큐에서 제거(At-Least-Once).
  commandResults?: AgentCommandResult[];
}

// ★ v1.6.1: 에이전트 자기 보고 본문
export interface AgentSelfReport {
  /** 적용 매핑의 해시(sha1 12자) — 서버 사본과 드리프트 대조용 */
  configVersion: string;
  /** 현재 런타임 적용 매핑 (config.enc 진실의 사본) */
  appliedMapping: {
    customers: Record<string, string>;
    purchases: Record<string, string>;
    customFieldLabels: Record<string, string>;
  };
  /** 소스 DB 컬럼 목록 (고객/구매 테이블 — 조회 실패 타겟은 생략) */
  sourceColumns?: {
    customers?: string[];
    purchases?: string[];
  };
  /** sourceColumns 조회 시각 (캐시 신선도 표시) */
  sourceColumnsAt?: string;
}

// ★ v1.6.1: 명령 실행 결과 (ACK)
export interface AgentCommandResult {
  commandId: string;
  type: string;
  ok: boolean;
  message?: string;
  /** 진단 명령 결과 데이터 (report_logs 줄 배열 · test_connection 상세 · mapping_dryrun 미리보기) */
  data?: unknown;
  completedAt: string;
}

export interface HeartbeatResponse {
  serverTime: string;
  latestVersion?: string;
  downloadUrl?: string;
  forceUpdate?: boolean;
  remoteConfig?: RemoteConfig;
}

// ─── POST /api/sync/log ─────────────────────────────────

export interface SyncLogRequest {
  agentId: string;
  syncType: SyncTarget;
  syncMode: SyncMode;
  totalCount: number;
  successCount: number;
  failCount: number;
  durationMs: number;
  errorMessage?: string;
  startedAt: string;
  completedAt: string;
}

// ─── GET /api/sync/config (레거시 유지) + 싱크 응답 config (v1.5.0) ─

export interface RemoteConfig {
  syncIntervalCustomers?: number;
  syncIntervalPurchases?: number;
  /** v1.5.0: 서버 응답 config에 포함 */
  heartbeatInterval?: number;
  /** v1.5.0: 서버 응답 config에 포함 */
  queueRetryInterval?: number;
  /** v1.5.0: 설정 변경 감지용 타임스탬프 */
  version?: string;
  batchSize?: number;
  mapping?: {
    customers?: Record<string, string>;
    purchases?: Record<string, string>;
  };
  commands?: AgentCommand[];
  // ★ v1.6.1 (P1-6): heartbeat 임시 단축 지시 — 서버가 대기 명령/미수신 ACK가 있을 때 동봉.
  //   에이전트는 until까지 heartbeat를 intervalMinutes 주기로 추가 전송(명령·ACK 왕복 즉시성).
  boost?: {
    heartbeatIntervalMinutes?: number;
    until: string;
  };
}

export interface AgentCommand {
  id?: string;
  // ★ D131 후속(2026-04-21): pause/resume 추가 — 슈퍼관리자 UI에서 원격 동기화 제어
  //   pause: 스케줄러 stop (heartbeat 유지), resume: 재개, restart: 프로세스 종료 후 서비스 재시작
  // ★ v1.6.1 (P2-7·8·9): 원격 진단 3종 — report_logs(최근 로그 업로드)·test_connection(소스 DB 연결 테스트)·
  //   mapping_dryrun(신규 매핑을 소스 1행에 적용한 미리보기 — 저장/적용 없음)
  type: 'full_sync' | 'restart' | 'update_config' | 'pause' | 'resume'
    | 'report_logs' | 'test_connection' | 'mapping_dryrun';
  payload?: unknown;
  // ★ 2026-07-01: 서버(admin-sync)가 명령을 `params` 필드로 저장한 하위호환 — 에이전트는 payload ?? params 수용
  params?: unknown;
  issuedAt?: string;
}

// ★ v1.6.1: report_logs 명령 payload
export interface ReportLogsPayload {
  /** 최근 N줄 (기본 200 · 상한 1000) */
  lines?: number;
}

// ★ v1.6.1: mapping_dryrun 명령 payload — 소스 1행에 적용해 볼 매핑(저장 안 함)
export interface MappingDryrunPayload {
  mapping?: {
    customers?: Record<string, string>;
    purchases?: Record<string, string>;
  };
}

// ★ 2026-07-01: update_config 명령 payload — 슈퍼관리자에서 매핑을 원격 갱신(원격 재설치 없이).
//   에이전트는 mapping을 로컬 config.enc에 저장 + 런타임 반영 + 바뀐 타겟 full_sync.
export interface UpdateConfigPayload {
  mapping?: {
    /** 소스컬럼 → 표준/custom 필드 (예: { "신규등록일자": "custom_5" }) */
    customers?: Record<string, string>;
    purchases?: Record<string, string>;
    /** custom 슬롯 라벨 (예: { "custom_1": "등록일자" }) — 서버 필드정의 재등록용 */
    customFieldLabels?: Record<string, string>;
  };
  syncIntervalCustomers?: number;
  syncIntervalPurchases?: number;
}

// ─── POST /api/sync/register ────────────────────────────

export interface RegisterRequest {
  apiKey: string;
  apiSecret: string;
  agentName: string;
  agentVersion: string;
  osInfo: string;
  dbType: string;
}

export interface RegisterResponse {
  agentId: string;
  companyId: string;
  companyName: string;
  config: RemoteConfig;
}

// ─── GET /api/sync/version ──────────────────────────────

export interface VersionResponse {
  latestVersion: string;
  currentVersion?: string;
  updateAvailable?: boolean;
  downloadUrl?: string;
  forceUpdate?: boolean;
  releaseNotes?: string;
}

// ─── POST /api/sync/field-definitions (v1.4.0) ─────────

export interface FieldDefinition {
  field_key: string;    // custom_1 ~ custom_15
  field_label: string;  // 고객사 원본 라벨 (예: "결혼기념일")
  field_type?: string;  // string | date | number (기본 string)
}

export interface FieldDefinitionsRequest {
  definitions: FieldDefinition[];
}

export interface FieldDefinitionsResponse {
  savedCount: number;
}

// ─── POST /api/sync/ai-mapping (v1.5.0) — Claude Opus 4.7 자동 매핑 ─

export type AiMappingSupportedDbType = 'mssql' | 'mysql' | 'oracle' | 'postgres' | 'excel' | 'csv';
export type AiMappingTarget = 'customers' | 'purchases';

export interface AiMappingRequest {
  target: AiMappingTarget;
  tableName: string;
  dbType: AiMappingSupportedDbType;
  columns: string[];
}

export interface AiMappingResponse {
  mapping: Record<string, string | null>;
  modelUsed: string;
  cacheHit: boolean;
  tokensUsed: number;
  costEstimate: number;
}

// ─── GET /api/sync/field-map (v1.5.0 M-4) — FIELD_MAP 동적 전달 ─

export interface FieldMapEntry {
  fieldKey: string;
  category: string;
  displayName: string;
  aliases: string[];
  dataType: 'string' | 'number' | 'date' | 'boolean';
  storageType: 'column' | 'custom_fields';
  columnName: string;
  normalizeFunction: string | null;
  sortOrder: number;
}

export interface FieldMapResponse {
  fieldMap: FieldMapEntry[];
  categoryLabels: Record<string, string>;
  version: string;
}
