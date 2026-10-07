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

  // ── 비토 게이트웨이 접수 단계 영구 거부(P3-2 · 2026-09-12) ──
  // Agent 가 게이트웨이 거부 코드를 이 숫자로 바꿔 status_code 에 쓴다(Agent 설정 ack_result_codes).
  // 등록부 소유 = 게이트웨이 status/MESSAGE_RESULT_CODE_STANDARD.md. 숫자는 그쪽과 같아야 한다.
  9401: { label: '문자로 보낼 수 없는 글자(작성 화면에서 확인)', type: 'fail' },
  9402: { label: '본문 길이 초과',        type: 'fail' },
  9403: { label: 'MMS 첨부 누락',         type: 'fail' },
  9404: { label: '수신번호 형식 오류',     type: 'fail' },
  9405: { label: '메시지 유형 오류',       type: 'fail' },
  9406: { label: '필수 항목 누락',         type: 'fail' },
  9407: { label: '차단된 URL',            type: 'fail' },
  9408: { label: '발신사업자 식별코드 오류', type: 'fail' },
  9409: { label: '중복 접수(같은 번호 다른 내용)', type: 'fail' },

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
  // ★ 2026-10-07 짧게(칸 넘침 · 박성용 접수) — 알림톡 실패는 화면이 결과 아래 작은 글씨로 붙인다
  7830: { label: 'SMS 대체 성공',          type: 'success' },
  7831: { label: 'LMS 대체 성공',          type: 'success' },
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

/** ★ 2026-09-29 한줄로 V2 차수 5 — 비토 게이트웨이 접수 단계 영구 거부(위 9401~9409 묶음 · 통신사에 가지도 않았다) */
export const GATEWAY_REJECT_CODES: readonly number[] = [9401, 9402, 9403, 9404, 9405, 9406, 9407, 9408, 9409];

/**
 * ★ 2026-09-29 한줄로 V2 차수 5(B-0928-1 범위 밖 ①) — 스팸 검사 발송 실패 행의 사유(화면용).
 * 옛: 모달이 실패를 전부 「통신사가 문자를 받지 않았어요」로 보여 게이트웨이 반려(글자·길이 등 · 고쳐서 다시 검사하면 된다)와
 *   통신사 실패를 가를 수 없었다(0928 U+200B 9401 반려 = 3사 모두 '전달 실패').
 */
export function spamFailDetail(statusCode: number): { failKind: 'rejected' | 'carrier'; failLabel: string } {
  return {
    failKind: GATEWAY_REJECT_CODES.includes(statusCode) ? 'rejected' : 'carrier',
    failLabel: getStatusLabel(statusCode),
  };
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
 * ★ 2026-10-03 카카오 실패 → 문자 대체 성공의 두 모양 (서수란 접수 · 크로커다일 9/29 대체 LMS 가 알림톡으로 청구됨)
 *   ① 옛 QTmsg 라인 = 대체 문자가 별도 행(L/S + k_oriseq = 원본 K행 seqno)
 *   ② 비토 게이트웨이 라인(SMSQ_SEND_13~16) = 별도 행 없이 **원래 알림톡(K) 행**의 결과코드가 7830(SMS)·7831(LMS)
 *      (bito-gateway engine/report.go parentFallbackReport · agent/poller isGatewayManagedFallbackReport 가 L행 적재를 건너뜀)
 *   ②를 알림톡 성공으로 세면 통계는 대체분을 놓치고 정산은 알림톡 단가로 청구한다.
 *   판정은 여기 하나가 소유한다(JS 판정 · SQL 조각이 같은 상수에서 나온다).
 *   ⛔ 브랜드(F) 행은 이 판정에 넣지 않았다 — 같은 코드가 F행에도 실리는지 운영 실측 전이다(BUGS B-1003-1 추가 과제).
 */
export const KAKAO_FALLBACK_SMS_CODE = 7830;
export const KAKAO_FALLBACK_LMS_CODE = 7831;

/** 알림톡(K) 행이 문자로 대체 성공했으면 그 문자 유형('S'|'L'), 아니면 null */
export function alimtalkFallbackMsgType(msgType: string, statusCode?: number | string | null): 'S' | 'L' | null {
  if (msgType !== 'K' || statusCode == null || statusCode === '') return null;
  const code = Number(statusCode);
  if (code === KAKAO_FALLBACK_SMS_CODE) return 'S';
  if (code === KAKAO_FALLBACK_LMS_CODE) return 'L';
  return null;
}

/** SQL용: 청구 유형 식(CASE)에 끼우는 WHEN 절 — K행 대체 성공을 그 문자 유형으로 (alimtalkFallbackMsgType 과 같은 규칙) */
export const ALIMTALK_FALLBACK_TYPE_WHEN_SQL =
  `WHEN msg_type = 'K' AND status_code = ${KAKAO_FALLBACK_SMS_CODE} THEN 'S' `
  + `WHEN msg_type = 'K' AND status_code = ${KAKAO_FALLBACK_LMS_CODE} THEN 'L'`;

/** SQL용: 카카오 실패 대체발송 행 — ① 별도 문자 행 + ② K행 대체 성공 (발송결과·엑셀의 「대체발송」 필터) */
export const SUBSTITUTE_ROW_SQL =
  `((k_oriseq > 0 AND msg_type IN ('L', 'S')) `
  + `OR (msg_type = 'K' AND status_code IN (${KAKAO_FALLBACK_SMS_CODE}, ${KAKAO_FALLBACK_LMS_CODE})))`;

/**
 * 발송내역 행별 유형 라벨 (QTmsg SMSQ_SEND의 msg_type + k_oriseq 기반).
 * 발송내역 상세/엑셀에서 행마다 표시. 카카오 실패 후 LMS 대체발송을 별도 구분.
 * - 'K' + 7830/7831(status_code)  → 대체 SMS · 대체 LMS — 비토 라인 모양(★2026-10-03)
 * - 'K'                          → 알림톡
 * - 'L' + k_oriseq(원본 K행 seqno) → 대체 LMS · 대체 SMS
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

export function getSendTypeLabel(msgType: string, kOriseq?: number | string | null, statusCode?: number | string | null): string {
  const ori = Number(kOriseq);
  const isSub = kOriseq != null && kOriseq !== '' && !Number.isNaN(ori) && ori > 0;
  // ★ 2026-10-03 비토 라인 = K행 결과코드로 대체 성공(위 KAKAO_FALLBACK_* 주석)
  const inRow = alimtalkFallbackMsgType(msgType, statusCode);
  // ★ 2026-10-07 짧게(옛 「카카오실패 대체발송(LMS)」가 칸에서 4줄로 깨졌다 · 박성용 접수)
  if (inRow) return inRow === 'L' ? '대체 LMS' : '대체 SMS';
  if (msgType === 'K') return '알림톡';
  if (msgType === 'F') return '브랜드메시지';   // ★ 2026-07-30 브랜드 SMSQ 합류(msg_type='F')
  if (msgType === 'L') return isSub ? '대체 LMS' : 'LMS';
  if (msgType === 'S') return isSub ? '대체 SMS' : 'SMS';
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
 * 통계에서 알림톡(K)과 카카오실패 대체발송(L·k_oriseq>0 · K+7830/7831)을 분리 집계할 때 사용.
 */
export type SmsChannel = 'alimtalk' | 'brand' | 'substitute_lms' | 'substitute_sms' | 'lms' | 'sms' | 'mms' | 'other';

export function classifyMsgChannel(msgType: string, kOriseq?: number | string | null, statusCode?: number | string | null): SmsChannel {
  const ori = Number(kOriseq);
  const isSub = kOriseq != null && kOriseq !== '' && !Number.isNaN(ori) && ori > 0;
  // ★ 2026-10-03 비토 라인 = K행 결과코드로 대체 성공(위 KAKAO_FALLBACK_* 주석)
  const inRow = alimtalkFallbackMsgType(msgType, statusCode);
  if (inRow) return inRow === 'L' ? 'substitute_lms' : 'substitute_sms';
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
    const ch = classifyMsgChannel(r.msg_type, r.k_oriseq, r.status_code);
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

/**
 * ★ 2026-10-07 (박성용 접수 cmuxvwasa0pvajnn462s5ubyr) 알림톡 캠페인 = 「알림톡 시도」와 「대체 문자」를 따로 센다.
 *   옛 목록은 대체로 나간 문자까지 알림톡 성공으로 셌다(3건 성공 · 실제 = 알림톡 2 성공 + 1 실패 → LMS 대체 1 성공).
 *   청구(send-usage-aggregation)는 대체 성공을 문자 유형으로 센다 — 이 집계가 같은 판정(alimtalkFallbackMsgType · k_oriseq)을 쓴다.
 *   - 알림톡 시도 = K행 전부. K+7830/7831(비토 라인 = 같은 행에 대체 결과) = 알림톡 실패 + 대체 성공 1건씩.
 *   - 옛 라인 = 실패한 K행(알림톡 실패) + 별도 L/S행(k_oriseq>0 = 대체 · 그 행의 결과대로).
 *   그 밖의 행(브랜드·일반 문자)은 세지 않는다(알림톡 캠페인 행만 넘어온다).
 */
export interface AlimtalkFallbackCount extends ChannelCount {
  fallback: { LMS: ChannelCount; SMS: ChannelCount };
}

export function tallyAlimtalkFallback(
  rows: Array<{ msg_type: string; k_oriseq?: number | string | null; status_code: number | string; cnt: number | string }>,
): AlimtalkFallbackCount {
  const init = (): ChannelCount => ({ total: 0, success: 0, fail: 0, pending: 0 });
  const out: AlimtalkFallbackCount = { ...init(), fallback: { LMS: init(), SMS: init() } };
  const add = (b: ChannelCount, code: number, cnt: number) => {
    b.total += cnt;
    if (isSuccess(code)) b.success += cnt;
    else if (isPending(code)) b.pending += cnt;
    else b.fail += cnt;
  };
  for (const r of rows) {
    const cnt = Number(r.cnt || 0);
    const code = Number(r.status_code);
    if (r.msg_type === 'K') {
      const inRow = alimtalkFallbackMsgType('K', code);
      if (inRow) {
        out.total += cnt; out.fail += cnt;                                          // 알림톡은 실패했고
        const f = out.fallback[inRow === 'L' ? 'LMS' : 'SMS'];
        f.total += cnt; f.success += cnt;                                            // 같은 행에서 문자로 대체 성공
      } else {
        add(out, code, cnt);
      }
      continue;
    }
    const ori = Number(r.k_oriseq);
    const isSub = r.k_oriseq != null && r.k_oriseq !== '' && !Number.isNaN(ori) && ori > 0;
    if (isSub && (r.msg_type === 'L' || r.msg_type === 'S')) add(out.fallback[r.msg_type === 'L' ? 'LMS' : 'SMS'], code, cnt);
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

/**
 * ★ 2026-09-26 한줄로 V2 m042(Harold 결정 「발송 실패만 환불·청구 제외 · 시간 초과는 청구」) — 스팸 검사 결과 행의 청구 판정.
 * 청구 = 결과가 나왔고 통신사 발송 실패가 아닌 행(통과·차단·시간 초과). 후불 청구 두 축과 선불 실패 환불이 이 두 조건만 쓴다.
 */
export function spamBilledResultSql(alias: string): string {
  return `(${alias}.result IS NOT NULL AND ${alias}.result <> '${SPAM_RESULT.FAILED}')`;
}
export function spamFailedResultSql(alias: string): string {
  return `${alias}.result = '${SPAM_RESULT.FAILED}'`;
}
/**
 * ★ 2026-09-29 한줄로 V2 차수 5 — 같은 판정의 함수판(행을 이미 읽은 화면: 테스트 목록 비용·상태).
 * 옛: 화면 3곳(campaigns·manage-stats·admin)이 `result IS NOT NULL`을 완료=성공으로 세어 발송 실패 행도 비용·성공에 넣었다.
 */
export function isSpamResultBilled(result: string | null | undefined): boolean {
  return result != null && result !== SPAM_RESULT.FAILED;
}
/** 스팸 검사 결과 행의 목록 상태 — 대기(결과 없음) · 실패(발송 실패) · 성공(통과·차단·시간 초과 = 청구) */
export function spamResultRowStatus(result: string | null | undefined): 'pending' | 'fail' | 'success' {
  if (result == null) return 'pending';
  return result === SPAM_RESULT.FAILED ? 'fail' : 'success';
}

/**
 * ★ 2026-09-29 한줄로 V2 차수 5(Codex 1R high) — 스팸 검사 결과 행 한 칸의 판정 쓰기. 폴링·시간 초과 자리 전부가 이 문장 하나를 쓴다
 * ($1 = 결과 · $2 = 결과 행 id). **아직 판정 안 된 행**(앱 미수신 · 결과 없음)에만 쓴다.
 * 옛: 행을 고른 뒤 조건 없이 id 로 덮어, 그 사이 다른 쪽이 쓴 발송 실패(선불 환불됨)를 시간 초과(청구)로, 앱 통과를 차단으로 바꿨다
 *   → 환불은 남고 후불은 청구 · 전부 실패였던 체험이 다시 횟수에 들어갔다. 쓴 행 수(rowCount)로 "이번에 썼는가"를 가린다.
 * 앱 수신 보고(/report)는 판정된 차단도 늦은 진짜 수신으로 바꾸는 규칙이 달라 이 문장을 쓰지 않는다(발송 실패만 지킨다).
 */
export const SPAM_RESULT_DECIDE_SQL = `UPDATE spam_filter_test_results SET result = $1 WHERE id = $2 AND received = false AND result IS NULL`;

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
