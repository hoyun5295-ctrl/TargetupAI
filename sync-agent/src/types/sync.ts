/**
 * 동기화 관련 타입 정의
 */

// ─── 동기화 대상 ────────────────────────────────────────

export type SyncTarget = 'customers' | 'purchases';
export type SyncMode = 'incremental' | 'full';
export type AgentStatus = 'active' | 'inactive' | 'error';

// ─── 동기화 상태 (로컬 저장) ────────────────────────────

export interface SyncState {
  /** 고객 데이터 마지막 동기화 시각 (ISO 8601) */
  lastCustomerSyncAt: string | null;
  /** 구매 데이터 마지막 동기화 시각 (ISO 8601) */
  lastPurchaseSyncAt: string | null;
  /** 마지막 전체 동기화 시각 */
  lastFullSyncAt: string | null;
  /** Agent 서버 등록 ID */
  agentId: string | null;
  /** 총 동기화된 고객 수 */
  totalCustomersSynced: number;
  /** 총 동기화된 구매 건수 */
  totalPurchasesSynced: number;
  /** 커스텀 필드 정의 서버 등록 완료 여부 (v1.4.0) */
  fieldDefinitionsRegistered: boolean;
}

export const DEFAULT_SYNC_STATE: SyncState = {
  lastCustomerSyncAt: null,
  lastPurchaseSyncAt: null,
  lastFullSyncAt: null,
  agentId: null,
  totalCustomersSynced: 0,
  totalPurchasesSynced: 0,
  fieldDefinitionsRegistered: false,
};

// ─── 동기화 결과 ────────────────────────────────────────

export interface SyncResult {
  target: SyncTarget;
  mode: SyncMode;
  totalCount: number;
  successCount: number;
  failCount: number;
  skippedCount: number;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  errors: SyncError[];
}

export interface SyncError {
  /** 오류 발생 레코드의 키 (전화번호 등) */
  recordKey?: string;
  /** 오류 코드 */
  code: string;
  /** 오류 메시지 */
  message: string;
  /** 원본 에러 */
  cause?: unknown;
}

// ─── 배치 처리 ──────────────────────────────────────────

export interface SyncBatch<T> {
  items: T[];
  batchIndex: number;
  totalBatches: number;
}

// ─── 큐 아이템 (오프라인 대비) ──────────────────────────

export interface QueueItem {
  id: number;
  type: SyncTarget;
  payload: string;  // JSON
  createdAt: string;
  retries: number;
}
