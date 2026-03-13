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
redis.on('error', (err) => console.error('[Redis] 연결 에러:', err.message));

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
  /** 슈퍼관리자 세션 타임아웃 — 30분 */
  superAdminSessionMinutes: Number(process.env.SUPER_ADMIN_SESSION_MINUTES) || 30,
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
  /** 고객 업로드 DB insert 배치 (원래 4000 → 500 으로 축소된 이력 있음, 복원) */
  customerUpload: 2000,
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
  /** 발송결과 차트 데이터 — 진행중 5분 / 완료 24시간 */
  resultChartActive: 300,
  resultChartCompleted: 86400,
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
// 발송 허용 시간대 (분할발송 오버플로우 방지)
// ============================================================
export const SEND_HOURS = {
  /** 발송 시작 시각 (24시간제) — 이 시간 이전에는 발송하지 않음 */
  start: Number(process.env.SEND_START_HOUR) || 8,
  /** 발송 종료 시각 (24시간제) — 이 시간 이후에는 다음날 start로 이월 */
  end: Number(process.env.SEND_END_HOUR) || 21,
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

// ============================================================
// 공급자(인비토) 사업자 정보 — 청구서·정산서 PDF/이메일에 사용
// ============================================================
export const INVITO_INFO = {
  /** 상호 */
  companyName: process.env.INVITO_COMPANY_NAME || '주식회사 인비토 (INVITO corp.)',
  /** 대표자명 */
  ceoName: process.env.INVITO_CEO_NAME || '유 호 윤',
  /** 사업자등록번호 */
  bizNumber: process.env.INVITO_BIZ_NUMBER || '667-86-00578',
  /** 업태/종목 */
  bizType: process.env.INVITO_BIZ_TYPE || '서비스 / 소프트웨어및앱개발 공급',
  /** 주소 */
  address: process.env.INVITO_ADDRESS || '서울시 송파구 오금로 36길46, 4층',
  /** 대표 연락처 */
  phone: process.env.INVITO_PHONE || '1800-8125',
  /** 대표 이메일 */
  email: process.env.INVITO_EMAIL || 'mobile@invitocorp.com',
};
