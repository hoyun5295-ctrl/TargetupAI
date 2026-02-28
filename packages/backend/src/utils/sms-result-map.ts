// ============================================================
// sms-result-map.ts — 발송 결과값 매핑 컨트롤타워 (Single Source of Truth)
// ============================================================
// 역할: QTmsg status_code, 통신사 코드, 스팸필터 판정 결과를 한 곳에서 정의
// 원칙: 결과값 해석이 필요한 모든 파일은 이 파일을 import하여 사용
// 참조: campaigns.ts, results.ts, spam-filter.ts, ResultsModal.tsx (백엔드→프론트 전달)
// ============================================================

// ========================
// Part 1: QTmsg status_code 매핑
// ========================

export type StatusType = 'success' | 'fail' | 'pending' | 'unknown';

export interface StatusCodeInfo {
  label: string;
  type: StatusType;
}

/** QTmsg status_code → 한줄로 결과 매핑 (유일한 정의) */
export const STATUS_CODE_MAP: Record<number, StatusCodeInfo> = {
  // 성공
  6:    { label: 'SMS 성공',        type: 'success' },
  1000: { label: 'LMS 성공',        type: 'success' },
  1800: { label: '카카오 성공',      type: 'success' },

  // 대기
  100:  { label: '발송 대기',        type: 'pending' },
  104:  { label: '발송 대기',        type: 'pending' },

  // 실패 — 수신자 문제
  7:    { label: '결번/서비스정지',   type: 'fail' },
  8:    { label: '단말기 꺼짐',      type: 'fail' },
  2008: { label: '비가입자/결번',    type: 'fail' },

  // 실패 — 메시지 문제
  3000: { label: '메시지 형식 오류',  type: 'fail' },
  3001: { label: '발신번호 오류',    type: 'fail' },
  3002: { label: '수신번호 오류',    type: 'fail' },
  3003: { label: '메시지 길이 초과',  type: 'fail' },
  3004: { label: '스팸 차단',        type: 'fail' },

  // 실패 — 시스템/과금
  23:   { label: '식별코드 오류',    type: 'fail' },
  2323: { label: '식별코드 오류',    type: 'fail' },
  55:   { label: '요금 부족',        type: 'fail' },
  16:   { label: '스팸 차단',        type: 'fail' },

  // 실패 — 기타
  4000: { label: '전송 시간 초과',   type: 'fail' },
  9999: { label: '기타 오류',        type: 'fail' },
};

/** 성공 코드 배열 — SQL WHERE 조건 등에 사용 */
export const SUCCESS_CODES: readonly number[] = [6, 1000, 1800];

/** 대기 코드 배열 */
export const PENDING_CODES: readonly number[] = [100, 104];

/** 성공 여부 판별 */
export function isSuccess(statusCode: number): boolean {
  return SUCCESS_CODES.includes(statusCode);
}

/** 실패 여부 판별 (성공도 아니고 대기도 아닌 모든 코드) */
export function isFail(statusCode: number): boolean {
  return !isSuccess(statusCode) && !isPending(statusCode);
}

/** 대기 여부 판별 */
export function isPending(statusCode: number): boolean {
  return PENDING_CODES.includes(statusCode);
}

/** status_code → 라벨 문자열 (매핑에 없으면 '코드 NNN') */
export function getStatusLabel(statusCode: number): string {
  return STATUS_CODE_MAP[statusCode]?.label || `코드 ${statusCode}`;
}

/** status_code → 타입 (매핑에 없으면 'unknown') */
export function getStatusType(statusCode: number): StatusType {
  return STATUS_CODE_MAP[statusCode]?.type || 'unknown';
}

/** SQL용: 성공 코드 IN 절 문자열 — 예: "6, 1000, 1800" */
export const SUCCESS_CODES_SQL = SUCCESS_CODES.join(', ');

/** SQL용: 대기 코드 IN 절 문자열 — 예: "100, 104" */
export const PENDING_CODES_SQL = PENDING_CODES.join(', ');

// ========================
// Part 2: 통신사 코드 매핑
// ========================

/** mob_company → 표시명 (유일한 정의) */
export const CARRIER_MAP: Record<string, string> = {
  '11': 'SKT',
  '16': 'KT',
  '19': 'LG U+',
  '12': 'SKT 알뜰폰',
  '17': 'KT 알뜰폰',
  '20': 'LG 알뜰폰',
  'SKT': 'SKT',
  'KTF': 'KT',
  'LGT': 'LG U+',
};

/** mob_company → 표시명 (매핑에 없으면 원본 반환) */
export function getCarrierLabel(mobCompany: string): string {
  return CARRIER_MAP[mobCompany] || mobCompany || '알 수 없음';
}

// ========================
// Part 3: 스팸필터 판정 결과
// ========================

/** 스팸필터 result 상수 — spam-filter.ts에서 문자열 직접 사용 대신 이 상수 사용 */
export const SPAM_RESULT = {
  PASS: 'pass',       // 정상 수신 (스팸 아님)
  BLOCKED: 'blocked', // 스팸 차단됨
  FAILED: 'failed',   // 발송 자체 실패
  TIMEOUT: 'timeout',  // 시간 초과 (판정 불가)
} as const;

export type SpamResultType = typeof SPAM_RESULT[keyof typeof SPAM_RESULT];

/** 스팸필터 result → 표시명 */
export const SPAM_RESULT_LABEL: Record<string, string> = {
  [SPAM_RESULT.PASS]: '정상',
  [SPAM_RESULT.BLOCKED]: '차단',
  [SPAM_RESULT.FAILED]: '실패',
  [SPAM_RESULT.TIMEOUT]: '시간초과',
};

/** 스팸필터 result → 표시명 (null/undefined → '대기') */
export function getSpamResultLabel(result: string | null | undefined): string {
  if (!result) return '대기';
  return SPAM_RESULT_LABEL[result] || '대기';
}

/** 스팸필터 result → CSS 타입 (프론트 배지 색상 결정용) */
export function getSpamResultType(result: string | null | undefined): 'pass' | 'blocked' | 'fail' | 'pending' {
  if (!result) return 'pending';
  if (result === SPAM_RESULT.PASS) return 'pass';
  if (result === SPAM_RESULT.BLOCKED) return 'blocked';
  if (result === SPAM_RESULT.FAILED || result === SPAM_RESULT.TIMEOUT) return 'fail';
  return 'pending';
}
