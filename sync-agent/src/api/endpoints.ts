/**
 * Target-UP Sync API 엔드포인트 상수
 */

export const ENDPOINTS = {
  SYNC_CUSTOMERS: '/api/sync/customers',
  SYNC_PURCHASES: '/api/sync/purchases',
  HEARTBEAT: '/api/sync/heartbeat',
  LOG: '/api/sync/log',
  CONFIG: '/api/sync/config',
  REGISTER: '/api/sync/register',
  VERSION: '/api/sync/version',
  /** exe 다운로드 (자동 업데이트) — Phase 5 추가 */
  DOWNLOAD: '/api/sync/download',
  /** 커스텀 필드 라벨 등록 — v1.4.0 추가 */
  FIELD_DEFINITIONS: '/api/sync/field-definitions',
  /** AI 컬럼 매핑 — v1.5.0 추가 */
  AI_MAPPING: '/api/sync/ai-mapping',
  /** FIELD_MAP 동적 전달 — v1.5.0 M-4 추가 */
  FIELD_MAP: '/api/sync/field-map',
} as const;
