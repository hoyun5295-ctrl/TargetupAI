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
  /** 같은 번호 수신동의 세대 — 1.7.6 추가(설계서 docs/2026-11-03-sync-duplicate-phone-consent-design.md §3-2 ②) */
  CONSENT_PASS_START: '/api/sync/consent-pass/start',
  CONSENT_PASS_STAGE: '/api/sync/consent-pass/stage',
  CONSENT_PASS_STAGE_DONE: '/api/sync/consent-pass/stage-done',
  CONSENT_PASS_COMPLETE: '/api/sync/consent-pass/complete',
} as const;
