// ============================================================
// sms-result-map.ts — 발송 결과값 매핑 컨트롤타워 (Single Source of Truth)
// ============================================================
// 역할: QTmsg status_code, 통신사 코드, 스팸필터 판정 결과를 한 곳에서 정의
// 원칙: 결과값 해석이 필요한 모든 파일은 이 파일을 import하여 사용
// 참조: campaigns.ts, results.ts, spam-filter.ts, ResultsModal.tsx (백엔드→프론트 전달)
// ============================================================

import { isBrandOnlyChannel } from './billing-types';

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
  100:  { label: '결과 대기',        type: 'pending' },
  104:  { label: '결과 대기',        type: 'pending' },

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
  92:   { label: '전송 실패(코드 92)', type: 'fail' }, // ★ 2026-06-11 폴라초이스 6/8 실측 214건 — 매뉴얼 정의 확인 시 라벨 정정

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

/**
 * ★ 2026-06-13: 발송 큐 행의 표시 상태 — "발송 예약"과 "결과 대기" 구분 (Harold 지시).
 * 예약 선적재 행은 status_code=100(대기)이라 그대로 보여주면 "결과 대기"로 표시돼
 * 아직 안 나간 예약 행이 발송된 것처럼 보이는 불안을 만든다 (에이스하드웨어 실측).
 * - 대기 코드 + 발송 요청 시각이 미래(is_future) = 발송 예약 (type 'scheduled')
 * - 그 외 = 기존 라벨/타입 그대로
 * 판정 기준(sendreq_time > NOW())은 발송 에이전트의 픽업 기준과 동일.
 * 소비처: admin.ts 발송 상세 / results.ts 상세·엑셀 (3표면 동일 산출 의무).
 */
export type QueueRowStatusType = StatusType | 'scheduled';

export function getQueueRowStatus(
  statusCode: number,
  isFutureSendreq: boolean,
): { label: string; type: QueueRowStatusType } {
  if (isFutureSendreq && isPending(Number(statusCode))) {
    return { label: '발송 예약', type: 'scheduled' };
  }
  return { label: getStatusLabel(statusCode), type: getStatusType(statusCode) };
}

/** SQL용: 성공 코드 IN 절 문자열 — 예: "6, 1000, 1800" */
export const SUCCESS_CODES_SQL = SUCCESS_CODES.join(', ');

/** SQL용: 대기 코드 IN 절 문자열 — 예: "100, 104" */
export const PENDING_CODES_SQL = PENDING_CODES.join(', ');

/**
 * 발송내역 행별 유형 라벨 (QTmsg SMSQ_SEND의 msg_type + k_oriseq 기반).
 * 발송내역 상세/엑셀에서 행마다 표시. 카카오 실패 후 LMS 대체발송을 별도 구분.
 * - 'K'                          → 알림톡
 * - 'L' + k_oriseq(원본 K행 seqno) → 카카오실패 대체발송
 * - 'L'                          → LMS
 * - 'S'                          → SMS
 * - 'M'                          → MMS
 * - 그 외(IMC '카카오(TEXT)' 등)   → 원본 그대로
 */
/**
 * ★ 2026-07-30 브랜드 SMSQ 합류 — 브랜드 행(msg_type='F')의 msg_contents는 JSON 문자열이다.
 * 화면·엑셀 본문 컬럼에는 안의 MESSAGE(사용자 본문)를 풀어 보여준다. 그 외 유형은 원문 그대로.
 */
export function getDisplayContents(msgType: string, msgContents: any): string {
  const raw = String(msgContents ?? '');
  if (msgType !== 'F') return raw;
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === 'object') {
      if (typeof j.MESSAGE === 'string' && j.MESSAGE) return j.MESSAGE;
      return '(기본형 템플릿 발송)';   // BASIC_TCD/BASIC_VAR — 본문은 템플릿에 있다
    }
  } catch { /* JSON이 아니면 원문 유지 */ }
  return raw;
}

export function getSendTypeLabel(msgType: string, kOriseq?: number | string | null): string {
  const ori = Number(kOriseq);
  const isSub = kOriseq != null && kOriseq !== '' && !Number.isNaN(ori) && ori > 0;
  if (msgType === 'K') return '알림톡';
  if (msgType === 'F') return '브랜드메시지';   // ★ 2026-07-30 브랜드 SMSQ 합류(msg_type='F')
  if (msgType === 'L') return isSub ? '카카오실패 대체발송(LMS)' : 'LMS';
  if (msgType === 'S') return isSub ? '카카오실패 대체발송(SMS)' : 'SMS';
  if (msgType === 'M') return 'MMS';
  return msgType;
}

/**
 * 통계/엑셀 문자타입 라벨 (캠페인 send_channel + message_type 기반).
 * 알림톡 캠페인은 message_type이 'LMS'로 저장되므로 send_channel로 구분.
 * 정산 단가는 message_type 기준 유지, 화면 표기만 알림톡으로 분리.
 * - send_channel='alimtalk' → 알림톡
 * - 그 외 → message_type (SMS/LMS/MMS)
 */
export function getCampaignChannelLabel(sendChannel: string | null | undefined, messageType: string): string {
  if (sendChannel === 'alimtalk') return '알림톡';
  // ★ 2026-07-30: 브랜드 전용 채널은 message_type(LMS)이 아니라 브랜드메시지로 표기 (both는 문자 혼합이라 제외)
  if (isBrandOnlyChannel(sendChannel)) return '브랜드메시지';
  // ★ 2026-07-25 message_type이 비어 있으면 엑셀 '문자타입' 셀이 통째로 빈칸이 됐다.
  //   빈 셀은 담당자에게 "데이터 누락"으로 읽힌다(고객사 발송통계에서 접수된 그 증상과 같다).
  //   값이 없는 것과 유형을 모르는 것을 구분해 표기한다.
  return String(messageType || '').trim() || '(유형 미상)';
}

/**
 * 발송 채널 분류 (집계 키) — getSendTypeLabel과 동일 규칙의 영문 키 버전.
 * 통계에서 알림톡(K)과 카카오실패 대체발송(L·k_oriseq>0)을 분리 집계할 때 사용.
 */
export type SmsChannel = 'alimtalk' | 'brand' | 'substitute_lms' | 'substitute_sms' | 'lms' | 'sms' | 'mms' | 'other';

export function classifyMsgChannel(msgType: string, kOriseq?: number | string | null): SmsChannel {
  const ori = Number(kOriseq);
  const isSub = kOriseq != null && kOriseq !== '' && !Number.isNaN(ori) && ori > 0;
  if (msgType === 'K') return 'alimtalk';
  if (msgType === 'F') return 'brand';   // ★ 2026-07-30 브랜드 SMSQ 합류
  if (msgType === 'L') return isSub ? 'substitute_lms' : 'lms';  // 카카오 실패 → LMS 대체
  if (msgType === 'S') return isSub ? 'substitute_sms' : 'sms';  // 카카오 실패 → SMS 대체
  if (msgType === 'M') return 'mms';
  return 'other';
}

export interface ChannelCount { total: number; success: number; fail: number; pending: number; }

/**
 * msg_type/k_oriseq/status_code별 집계 행 배열을 채널별 성공·실패·대기로 누적.
 * status 판정은 SUCCESS_CODES/PENDING_CODES(이 파일) 단일 진실 재사용.
 */
export function tallySmsChannelCounts(
  rows: Array<{ msg_type: string; k_oriseq?: number | string | null; status_code: number | string; cnt: number | string }>
): Record<SmsChannel, ChannelCount> {
  const init = (): ChannelCount => ({ total: 0, success: 0, fail: 0, pending: 0 });
  const out: Record<SmsChannel, ChannelCount> = {
    alimtalk: init(), brand: init(), substitute_lms: init(), substitute_sms: init(), lms: init(), sms: init(), mms: init(), other: init(),
  };
  for (const r of rows) {
    const ch = classifyMsgChannel(r.msg_type, r.k_oriseq);
    const cnt = Number(r.cnt || 0);
    const code = Number(r.status_code);
    const b = out[ch];
    b.total += cnt;
    if (isSuccess(code)) b.success += cnt;
    else if (isPending(code)) b.pending += cnt;
    else b.fail += cnt;
  }
  return out;
}

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
