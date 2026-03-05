/**
 * 플랫폼 기본값 설정 (중앙 관리)
 *
 * 원칙: 고객사 DB 값 우선 → 없을 경우 환경변수 → 없을 경우 아래 기본값
 * 하드코딩 방지: 모든 파일에서 이 모듈을 import하여 사용
 * 수정 시 이 파일 하나만 변경하면 전체 반영됨
 */

import Redis from 'ioredis';

// ============================================================
// Redis 공통 인스턴스
// ============================================================
export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
export const redis = new Redis(REDIS_URL);

// ============================================================
// AI 모델명 (환경변수로 모델 업그레이드 시 .env만 수정)
// ============================================================
export const AI_MODELS = {
  claude: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
  gpt: process.env.GPT_MODEL || 'gpt-5.1',
};

// ============================================================
// 서비스 기본 단가 (원) — 고객사 DB 미설정 시 폴백
// ============================================================
export const DEFAULT_COSTS = {
  sms: parseFloat(process.env.DEFAULT_COST_SMS || '9.9'),
  lms: parseFloat(process.env.DEFAULT_COST_LMS || '27'),
  mms: parseFloat(process.env.DEFAULT_COST_MMS || '50'),
  kakao: parseFloat(process.env.DEFAULT_COST_KAKAO || '7.5'),
};

/**
 * 고객사 단가 조회 헬퍼
 * company 레코드에서 단가를 추출하되, 미설정 시 환경변수 기본값 사용
 */
export function getCompanyCosts(company: Record<string, any>) {
  return {
    sms: parseFloat(company?.cost_per_sms) || DEFAULT_COSTS.sms,
    lms: parseFloat(company?.cost_per_lms) || DEFAULT_COSTS.lms,
    mms: parseFloat(company?.cost_per_mms) || DEFAULT_COSTS.mms,
    kakao: parseFloat(company?.cost_per_kakao) || DEFAULT_COSTS.kakao,
  };
}

// ============================================================
// 타임아웃 (밀리초)
// ============================================================
export const TIMEOUTS = {
  /** 세션 활동 갱신 주기 — 5분 */
  activityUpdate: 5 * 60 * 1000,
  /** 스팸필터 테스트 최종 안전장치 타임아웃 — 60초 (정상 시 QTmsg 성공 후 10초에 판정 완료) */
  spamFilterTest: 60 * 1000,
  /** 스팸필터 안전 강제종료 — 90초 */
  spamFilterSafety: 90 * 1000,
  /** 업로드 파일 정리 주기 — 1시간 */
  uploadCleanup: 60 * 60 * 1000,
  /** 동기화 중단 정리 기준 — 30분 */
  syncStaleThreshold: 30 * 60 * 1000,
  /** 동기화 정리 주기 — 5분 */
  syncCleanupInterval: 5 * 60 * 1000,
  /** AI 재시도 대기 — 2초 */
  aiRetryDelay: 2000,
};

// ============================================================
// 배치 사이즈 (건수)
// ============================================================
export const BATCH_SIZES = {
  /** 고객 업로드 DB insert 배치 */
  customerUpload: 500,
  /** 발송 메시지 업데이트 배치 */
  messageUpdate: 1000,
  /** 동기화 API 고객 배치 */
  syncCustomer: 5000,
  /** 동기화 API 구매 배치 */
  syncPurchase: 5000,
  /** 고객 세그멘테이션 기본 한도 */
  customerSegment: 10000,
};

// ============================================================
// 캐시 TTL (초)
// ============================================================
export const CACHE_TTL = {
  /** 라인그룹 캐시 — 60초 (밀리초 아님 주의: campaigns.ts에서 ms로 변환) */
  lineGroup: 60,
  /** 고객 통계 — 60초 */
  customerStats: 60,
  /** 업로드 메타데이터 — 10분 */
  uploadMeta: 600,
  /** 업로드 진행상태 — 1시간 */
  uploadProgress: 3600,
  /** 메시지 편집 진행상태 — 10분 */
  messageEditProgress: 600,
};

// ============================================================
// Rate Limit
// ============================================================
export const RATE_LIMITS = {
  /** Rate limit 윈도우 — 1분 */
  windowMs: 60_000,
  /** IP 차단 기준 실패 횟수 */
  ipFailThreshold: 10,
  /** 회사별 분당 최대 요청 */
  companyMaxPerMinute: 60,
};

// ============================================================
// AI 토큰 한도
// ============================================================
export const AI_MAX_TOKENS = {
  /** 필드 매핑 (upload.ts) */
  fieldMapping: 1024,
  /** 브랜드 메시지 생성 */
  brandMessage: 2048,
  /** 타겟 추천 */
  targeting: 1024,
  /** 브리핑 파싱 */
  briefingParse: 1024,
  /** 맞춤 메시지 생성 */
  customMessage: 2048,
  /** 분석 인사이트 */
  analysis: 4096,
};

// ============================================================
// 기타 제한값
// ============================================================
export const LIMITS = {
  /** Express JSON body 최대 크기 */
  requestBodySize: '50mb',
  /** MMS 이미지 파일 최대 크기 (bytes) */
  mmsImageSize: 300 * 1024,
  /** MMS 이미지 최대 장수 */
  mmsImageCount: 3,
  /** JWT 토큰 만료 */
  jwtExpiry: '24h',
};
