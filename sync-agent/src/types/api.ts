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
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
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
}

export interface AgentCommand {
  id?: string;
  type: 'full_sync' | 'restart' | 'update_config';
  payload?: unknown;
  issuedAt?: string;
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
