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

  // ── SMS/LMS 추가 코드 (QTmsg 매뉴얼 ver4.0) ──
  1:    { label: '시스템 장애',       type: 'fail' },
  5:    { label: '번호 형식 오류',    type: 'fail' },
  9:    { label: '음영지역',          type: 'fail' },
  10:   { label: '단말기 메시지 Full', type: 'fail' },
  11:   { label: '기타 실패',         type: 'fail' },
  13:   { label: '번호이동 가입자',   type: 'fail' },
  40:   { label: '전송 실패(무선망)', type: 'fail' },
  41:   { label: '전송 실패(단말기)', type: 'fail' },
  45:   { label: '메시지 삭제',       type: 'fail' },
  50:   { label: '1일 제한건수 초과', type: 'fail' },
  51:   { label: '총 전송건수 초과',  type: 'fail' },
  52:   { label: '스팸 단어 감지',    type: 'fail' },
  53:   { label: '스팸 번호',         type: 'fail' },
  54:   { label: '스팸 단어+번호',    type: 'fail' },
  56:   { label: 'SMS 일일한도 초과', type: 'fail' },
  57:   { label: 'SMS 총한도 초과',   type: 'fail' },
  58:   { label: 'LMS 일일한도 초과', type: 'fail' },
  59:   { label: 'LMS 총한도 초과',   type: 'fail' },
  60:   { label: 'MMS 일일한도 초과', type: 'fail' },
  61:   { label: 'MMS 총한도 초과',   type: 'fail' },
  62:   { label: '동일대상 중복발송', type: 'fail' },
  70:   { label: '중복 순번',         type: 'fail' },
  71:   { label: '금지시간대 거절',   type: 'fail' },
  1100: { label: '부분 성공',         type: 'fail' },
  2000: { label: '포맷 오류',         type: 'fail' },
  2001: { label: '주소 에러',         type: 'fail' },
  2006: { label: 'Body 오류',         type: 'fail' },
  2007: { label: '미지원 미디어',     type: 'fail' },
  3005: { label: '음영지역',          type: 'fail' },
  3006: { label: '기타 실패',         type: 'fail' },
  5000: { label: '번호이동 에러',     type: 'fail' },
  5001: { label: '전송량 제한 초과',  type: 'fail' },
  5004: { label: '중복전송 에러',     type: 'fail' },
  5005: { label: '잔액 부족',         type: 'fail' },
  9001: { label: '유효시간 초과',     type: 'fail' },
  9002: { label: '폰번호 에러',       type: 'fail' },
  9003: { label: '스팸 번호',         type: 'fail' },
  9004: { label: '이통사 응답없음',   type: 'fail' },
  9005: { label: '파일크기 오류',     type: 'fail' },
  9006: { label: '미지원 파일형식',   type: 'fail' },
  9007: { label: '파일 오류',         type: 'fail' },
  9008: { label: '발신번호 미등록',   type: 'fail' },
  9009: { label: '발신번호 세칙에러', type: 'fail' },
  9010: { label: '콜백번호 스팸처리', type: 'fail' },
  9011: { label: '번호 공백',         type: 'fail' },
  9012: { label: '금지시간대 거절',   type: 'fail' },
  9013: { label: '번호도용 차단',     type: 'fail' },
  9014: { label: '착신번호 수신거절', type: 'fail' },

  // ── 카카오톡(KMS) 결과코드 (QTmsg 매뉴얼 ver4.0) ──
  7100: { label: '삭제된 옐로아이디',      type: 'fail' },
  7101: { label: '카카오 형식 오류',       type: 'fail' },
  7103: { label: 'SenderKey 유효하지않음', type: 'fail' },
  7105: { label: '발신프로필 미존재',      type: 'fail' },
  7106: { label: '삭제된 발신프로필',      type: 'fail' },
  7107: { label: '차단된 발신프로필',      type: 'fail' },
  7108: { label: '차단상태 옐로아이디',    type: 'fail' },
  7109: { label: '닫힌 옐로아이디',        type: 'fail' },
  7203: { label: '친구톡 대상아님',        type: 'fail' },
  7204: { label: '템플릿 불일치',          type: 'fail' },
  7300: { label: '카카오 기타에러',        type: 'fail' },
  7305: { label: '성공불확실(30일대기)',    type: 'pending' },
  7306: { label: '카카오 시스템 오류',     type: 'fail' },
  7308: { label: '전화번호 오류',          type: 'fail' },
  7311: { label: '메시지 미존재',          type: 'fail' },
  7314: { label: '메시지 길이 초과',       type: 'fail' },
  7315: { label: '템플릿 없음',            type: 'fail' },
  7318: { label: '메시지 전송불가',        type: 'fail' },
  7322: { label: '발송불가 시간',          type: 'fail' },
  7323: { label: '메시지그룹 미존재',      type: 'fail' },
  7324: { label: '이미지 전송불가',        type: 'fail' },
  7421: { label: '카카오 타임아웃',        type: 'fail' },
  7830: { label: '카카오실패→SMS성공',     type: 'success' },
  7831: { label: '카카오실패→LMS성공',     type: 'success' },
  63:   { label: '카카오 일일한도 초과',   type: 'fail' },
  64:   { label: '카카오 총한도 초과',     type: 'fail' },
  65:   { label: '친구톡 일일한도 초과',   type: 'fail' },
  66:   { label: '친구톡 총한도 초과',     type: 'fail' },
  67:   { label: '친구톡파일 일일한도 초과', type: 'fail' },
  68:   { label: '친구톡파일 총한도 초과', type: 'fail' },
};

/** 성공 코드 배열 — SQL WHERE 조건 등에 사용 */
export const SUCCESS_CODES: readonly number[] = [6, 1000, 1800, 7830, 7831];

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
