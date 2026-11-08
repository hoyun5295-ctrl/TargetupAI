// ============================================================
// sms-result-map.ts — 발송 결과값 매핑 컨트롤타워 (Single Source of Truth)
// ============================================================
// 역할: QTmsg status_code, 통신사 코드, 스팸필터 판정 결과를 한 곳에서 정의
// 원칙: 결과값 해석이 필요한 모든 파일은 이 파일을 import하여 사용
// 참조: campaigns.ts, results.ts, spam-filter.ts, ResultsModal.tsx (백엔드→프론트 전달)
// ============================================================

import { HANJUL_BAND_CODES } from './result-code-hanjul-band.generated';
import { isBrandOnlyChannel, FALLBACK_BILLING_CODE, billingTypeLabelOf } from './billing-types';

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

/** ★ 2026-11-02 엔진 재설계 E3-5 — 실발송 결과 중 스팸 차단 코드(이름에 「스팸」이 든 코드 · 위 표에서 기계로 뽑는다 · 손 목록 0)
 *  ★ 2026-11-06 C107F 뿌리 R64 — 원천 둘: 위 결과 표 라벨 + 비토 대역 표(HANJUL_BAND_CODES) 제목. 결과 표에서만 뽑으면
 *    비토 라인 스팸 차단(40016 · 49004 · 49010 · 39004 · 39010)을 세지 못해 그 라인 여정의 스팸 몰림 안내가 나가지 않았다.
 *    카카오 채널 제재(21025 · 21027)는 제목에 「스팸」이 없어 들어가지 않는다(통신사가 문자를 막은 일이 아니다). */
export const SPAM_BLOCK_STATUS_CODES: readonly number[] = [
  ...Object.entries(STATUS_CODE_MAP).filter(([, v]) => v.label.includes('스팸')).map(([k]) => Number(k)),
  ...Object.entries(HANJUL_BAND_CODES).filter(([, v]) => v.title.includes('스팸')).map(([k]) => Number(k)),
];
/** 스팸 차단 몰림 경계 — 그 칸 · 그날 20건 이상이고 결과(성공 + 실패)의 30% 이상 */
export const SPAM_SURGE_MIN = 20;
export const SPAM_SURGE_RATIO = 0.3;
/** (순수) 스팸 차단 몰림인가 — 안내 + 상황판만(자동 보류 0 · 코드 해석은 우리 쪽 판정이라 멈추지 않는다 · 설계 SC-8) */
export function isSpamBlockSurge(spamBlocked: number, results: number): boolean {
  return spamBlocked >= SPAM_SURGE_MIN && results > 0 && spamBlocked / results >= SPAM_SURGE_RATIO;
}

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

/**
 * ★ 2026-11-05 C107 G5 · 뿌리 R62 — 비토 게이트웨이 실패 코드 대역(한줄로 에이전트 정책 failure_code_policy = mapped).
 *   게이트웨이가 실패 원 코드를 표준 코드로 바꿔 대역 코드로 돌려준다(카카오 20000+n · LMS 30000+n · SMS 40000+n · 공통 50000+n ·
 *   규칙 = 게이트웨이 scripts/gw/customer-failure-codes-hanjul.sql · 라벨 = 생성 파일 result-code-hanjul-band.generated.ts).
 *   위 결과 표(키 9999 이하)와 겹치지 않아 표에 섞지 않는다 — 섞으면 「스팸」 글자로 뽑는 SPAM_BLOCK_STATUS_CODES 가 함께 바뀐다(추가 과제).
 *   생성 뒤 게이트웨이 표에 새 코드가 생기면 계열 기본 라벨(「카카오: 실패(코드 n)」)이 덮는다. 유형 = 언제나 실패.
 */
export const HANJUL_BAND_BASE = { KAKAO: 20000, LMSMMS: 30000, SMS: 40000, V: 50000 } as const;
const BAND_FAMILY_LABEL: Readonly<Record<number, string>> = { 2: '카카오', 3: 'LMS', 4: 'SMS', 5: '발송' };
// ★ 2026-11-06 비토엔진 오류접수(결과코드 매핑 · 설계서 docs/2026-11-06-bito-console-tickets-design.md A-4 · D-A6 뿌리)
//   라벨 파일은 생성 파일이라 게이트웨이 표준 코드가 늘면 모른다 → 판정 자리에서 만난 라벨 없는 대역 코드를 모아 두고
//   감시 워커(system-monitor-worker checkUnknownBandCodes)가 꺼내 코드별 하루 한 번 알린다. 크기 상한 = 대역 범위(4만).
const unknownBandSeen = new Set<number>();
/** 지난번 뒤로 판정 자리에서 만난 라벨 없는 대역 코드(꺼내면 비운다). */
export function takeUnknownBandCodes(): number[] {
  const out = [...unknownBandSeen].sort((a, b) => a - b);
  unknownBandSeen.clear();
  return out;
}
export function bandStatusInfo(statusCode: number): StatusCodeInfo | null {
  if (!Number.isInteger(statusCode) || statusCode < 20000 || statusCode > 59999) return null;
  const family = BAND_FAMILY_LABEL[Math.floor(statusCode / 10000)];
  const known = HANJUL_BAND_CODES[statusCode];
  if (!known) unknownBandSeen.add(statusCode);
  return { label: `${family}: ${known ? known.title : `실패(코드 ${statusCode % 10000})`}`, type: 'fail' };
}

/** status_code → 라벨 문자열 (매핑에 없으면 비토 실패 대역 라벨 · 그것도 아니면 '코드 NNN') */
export function getStatusLabel(statusCode: number): string {
  return STATUS_CODE_MAP[statusCode]?.label || bandStatusInfo(statusCode)?.label || `코드 ${statusCode}`;
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

/** status_code → 타입 (매핑에 없으면 비토 실패 대역 = 'fail' · 그것도 아니면 'unknown') */
export function getStatusType(statusCode: number): StatusType {
  return STATUS_CODE_MAP[statusCode]?.type || bandStatusInfo(statusCode)?.type || 'unknown';
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
 * ★ 2026-10-08 결과 코드로 있을 수 없는 상태값의 하한 — 이 표의 코드는 전부 4자리 이하다(5자리 이상 0개 · 1008 실측).
 *   사례 = 게스 SMSQ_SEND_14 seqno 2380726 · 100 이 67108964(100 + 2^26)로 바뀌어 에이전트가 영영 안 가져갔다(10/5~10/8 대기 잔존).
 *   대기(100 · 104)는 이 하한보다 작아 절대 걸리지 않는다(비토 100 = 결과 대기 보호).
 *   소비 = expired-pending-sweeper(48h 뒤 실패 마킹) · system-monitor-worker(즉시 경보).
 */
export const ABNORMAL_STATUS_MIN = 100000;

/**
 * ★ 2026-10-03 카카오 실패 → 문자 대체 성공의 두 모양 (서수란 접수 · 크로커다일 9/29 대체 LMS 가 알림톡으로 청구됨)
 *   ① 옛 QTmsg 라인 = 대체 문자가 별도 행(L/S + k_oriseq = 원본 K행 seqno)
 *   ② 비토 게이트웨이 라인(SMSQ_SEND_13~16) = 별도 행 없이 **원래 알림톡(K) 행**의 결과코드가 7830(SMS)·7831(LMS)
 *      (bito-gateway engine/report.go parentFallbackReport · agent/poller isGatewayManagedFallbackReport 가 L행 적재를 건너뜀)
 *   ②를 알림톡 성공으로 세면 통계는 대체분을 놓치고 정산은 알림톡 단가로 청구한다.
 *   판정은 여기 하나가 소유한다(JS 판정 · SQL 조각이 같은 상수에서 나온다).
 *
 * ★ 2026-10-16 판정을 `fallbackOf` 하나로 모았다(B-1016-1 · 같은 부류 세 번째 접수).
 *   옛: 통계 엑셀(classifyMsgChannel · 행 1 = 채널 1)과 캠페인 목록(tallyKakaoFallback · 시도 + 대체)이 같은 행을 다르게 셌고,
 *   청구 식은 대체를 L·S 로 접어 정산서에서 대체 여부가 사라졌다. 이제 집계·라벨·관리자 상세·청구 식이 이 판정 하나를 쓴다.
 *
 * ★ 2026-11-05 C107(브랜드메시지 접수 T2 · T3 · 뿌리 R1) 부모에 브랜드(F)를 넣었다. 1105 실측(SMSQ_SEND_14 · 15 · 27행) =
 *   F 행에도 대체 성공 7830(next A) · 7831(next B)이 같은 행에 찍히고 문자 행은 따로 없다(게이트웨이 report.go parentFallbackReport 가
 *   알림톡 · 브랜드 공통). 옛 판정이 K 만 봐서 브랜드 대체가 통계에선 브랜드 성공 · 정산에선 브랜드 단가였다.
 */
export const KAKAO_FALLBACK_SMS_CODE = 7830;
export const KAKAO_FALLBACK_LMS_CODE = 7831;

/** ★ 2026-11-05 C107 — 카카오 실패 → 문자 대체가 결과코드로 남는 부모 행 유형(알림톡 K · 브랜드 F). 판정 · SQL 조각이 이 목록 하나에서 나온다. */
export const KAKAO_FALLBACK_PARENT_TYPES: readonly string[] = ['K', 'F'];
/** SQL IN 조각 — `('K', 'F')` */
export const KAKAO_FALLBACK_PARENT_SQL = `(${KAKAO_FALLBACK_PARENT_TYPES.map((t) => `'${t}'`).join(', ')})`;

/** 옛 모양의 대체 행(자식 행) 조건 — k_oriseq = 원본 K행 seqno. ★2026-10-16 sms-queue 에서 옮겼다(판정 소유 = 이 파일) */
export const SMS_SUB_ROW_SQL = 'k_oriseq IS NOT NULL AND k_oriseq > 0';

/**
 * 이 행이 알림톡 실패 뒤 문자 대체인가 → 그 문자 유형('S'|'L'), 아니면 null. 대체 판정의 유일한 정의.
 *   - 비토 모양 = K행 결과코드 7830(SMS)·7831(LMS) — 그 행은 대체 성공이다
 *   - 옛 모양 = S/L 행 + k_oriseq > 0 — 결과(성공·실패·대기)는 그 행의 결과코드대로
 */
export function fallbackOf(msgType: string, kOriseq?: number | string | null, statusCode?: number | string | null): 'S' | 'L' | null {
  if (KAKAO_FALLBACK_PARENT_TYPES.includes(msgType)) {
    if (statusCode == null || statusCode === '') return null;
    const code = Number(statusCode);
    if (code === KAKAO_FALLBACK_SMS_CODE) return 'S';
    if (code === KAKAO_FALLBACK_LMS_CODE) return 'L';
    return null;
  }
  if (msgType !== 'S' && msgType !== 'L') return null;
  const ori = Number(kOriseq);
  return kOriseq != null && kOriseq !== '' && !Number.isNaN(ori) && ori > 0 ? msgType : null;
}

/**
 * SQL용: 청구 유형 식(CASE)에 끼우는 WHEN 절 — 두 모양의 대체를 청구 집계 코드 KS·KL 로(fallbackOf 와 같은 규칙).
 * ★ 2026-10-16 옛: 'S'·'L'(문자와 한 줄) → 정산서 「LMS」 · 이제 = 「LMS(대체발송)」 줄(billing-types SMS_FB·LMS_FB · 단가는 문자 상속).
 */
export const FALLBACK_BILLING_CODE_WHEN_SQL =
  `WHEN msg_type IN ${KAKAO_FALLBACK_PARENT_SQL} AND status_code = ${KAKAO_FALLBACK_SMS_CODE} THEN '${FALLBACK_BILLING_CODE.S}' `
  + `WHEN msg_type IN ${KAKAO_FALLBACK_PARENT_SQL} AND status_code = ${KAKAO_FALLBACK_LMS_CODE} THEN '${FALLBACK_BILLING_CODE.L}' `
  + `WHEN msg_type = 'S' AND ${SMS_SUB_ROW_SQL} THEN '${FALLBACK_BILLING_CODE.S}' `
  + `WHEN msg_type = 'L' AND ${SMS_SUB_ROW_SQL} THEN '${FALLBACK_BILLING_CODE.L}'`;

/** SQL용: 카카오 실패 대체발송 행 — ① 별도 문자 행 + ② 카카오(K · F) 행 대체 성공 (발송결과·엑셀의 「대체발송」 필터) */
export const SUBSTITUTE_ROW_SQL =
  `((k_oriseq > 0 AND msg_type IN ('L', 'S')) `
  + `OR (msg_type IN ${KAKAO_FALLBACK_PARENT_SQL} AND status_code IN (${KAKAO_FALLBACK_SMS_CODE}, ${KAKAO_FALLBACK_LMS_CODE})))`;

/** SQL용(선불 결과별 정산 · smsKakaoResultAgg) — 카카오 시도 성공(알림톡 · 브랜드 공통 1800) */
export const KAKAO_DELIVERED_SQL = `msg_type IN ${KAKAO_FALLBACK_PARENT_SQL} AND status_code = 1800`;

/**
 * ★ 2026-11-06 C107F ② 뿌리 R65 — 브랜드메시지 받는 사람의 **실제 채널 친구 여부**(에이전트가 쓰는 SMSQ 칸 · 비토 라인 12 ~ 16 만).
 *   게이트웨이가 친구 단가 정산을 마친 브랜드메시지만 Y / N 을 준다(게이트웨이 migrations/101 · engine.AgentFriendYNSQL) · 그 밖 NULL.
 *   단가 규칙 하나 = 대상값이 친구(I · F) 이거나 이 칸이 Y → 친구 단가 · 그 밖 비친구(올려 받지 않는다).
 *   ⛔ 칸이 없는 표(QTmsg 라인 · 이력 표)에서 이 이름을 부르면 쿼리 전체가 죽는다 — 표마다 sms-queue getFriendColumnTables 로 고른다.
 */
export const SMSQ_FRIEND_COLUMN = 'k_friend_yn';
/** SQL용 — 그 행이 브랜드로 실제 친구에게 전달됐다(카카오 시도 성공 · 브랜드 F · 친구 칸 Y) · 친구 칸이 있는 표에서만 쓴다 */
export const BRAND_FRIEND_DELIVERED_SQL = `${KAKAO_DELIVERED_SQL} AND msg_type = 'F' AND ${SMSQ_FRIEND_COLUMN} = 'Y'`;
/** SQL용 — 카카오 행 자체의 대체 성공(SMS · LMS) */
export const KAKAO_INROW_FALLBACK_SMS_SQL = `msg_type IN ${KAKAO_FALLBACK_PARENT_SQL} AND status_code = ${KAKAO_FALLBACK_SMS_CODE}`;
export const KAKAO_INROW_FALLBACK_LMS_SQL = `msg_type IN ${KAKAO_FALLBACK_PARENT_SQL} AND status_code = ${KAKAO_FALLBACK_LMS_CODE}`;

/**
 * 발송내역 행별 유형 라벨 (QTmsg SMSQ_SEND의 msg_type + k_oriseq 기반).
 * 발송내역 상세/엑셀에서 행마다 표시. 카카오 실패 후 LMS 대체발송을 별도 구분(판정 = fallbackOf).
 * - 대체(K + 7830/7831 · S/L + k_oriseq) → 대체 SMS · 대체 LMS
 * - 'K'                          → 알림톡
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

// ★ 2026-11-08 C117 D10 뿌리 R65(화면 쪽) — 넷째 인자 = 그 줄의 받는 사람 실제 친구 값(SMSQ k_friend_yn · 조회 = sms-queue withFriendYnField)
//   **필수** = 줄을 그리는 자리가 친구 칸을 조회하지 않으면 tsc 가 막는다. Y = 친구 · N = 비친구(청구 유형 이름) · 빈 값(대기 · 실패 · 칸 없는 표 · 옛 행) = 「브랜드메시지」
export function getSendTypeLabel(msgType: string, kOriseq: number | string | null | undefined, statusCode: number | string | null | undefined, friendYn: string | null | undefined): string {
  // ★ 2026-10-16 대체 판정 = fallbackOf 하나(두 모양) · ★ 2026-10-07 짧게(옛 「카카오실패 대체발송(LMS)」가 칸에서 4줄로 깨졌다 · 박성용 접수)
  const fb = fallbackOf(msgType, kOriseq, statusCode);
  if (fb) return fb === 'L' ? '대체 LMS' : '대체 SMS';
  if (msgType === 'K') return '알림톡';
  if (msgType === 'F') {   // ★ 2026-07-30 브랜드 SMSQ 합류(msg_type='F')
    const f = String(friendYn ?? '').trim().toUpperCase();
    return f === 'Y' ? billingTypeLabelOf('BRAND') : f === 'N' ? billingTypeLabelOf('BRAND_NF') : '브랜드메시지';
  }
  if (msgType === 'L') return 'LMS';
  if (msgType === 'S') return 'SMS';
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
export function getCampaignChannelLabel(sendChannel: string | null | undefined, messageType: string, kakaoTargeting?: string | null): string {
  if (sendChannel === 'alimtalk') return '알림톡';
  // ★ 2026-07-30: 브랜드 전용 채널은 message_type(LMS)이 아니라 브랜드메시지로 표기 (both는 문자 혼합이라 제외)
  // ★ 2026-11-08 C117 D9(Harold H1) — 이름 = 고른 대상(채널 친구 · 비친구만 · 마수동 전체 · 옛 C107 D-11 청구 이름 폐기 = 청구는 받는 사람마다 실제 친구 · 줄 이름 getSendTypeLabel)
  if (isBrandOnlyChannel(sendChannel)) return kakaoTargeting === undefined ? '브랜드메시지' : brandTargetingLabel(kakaoTargeting);   // 넘기지 않으면 채널 단위(campaign-list-csv 와 같은 규칙)
  // ★ 2026-07-25 message_type이 비어 있으면 엑셀 '문자타입' 셀이 통째로 빈칸이 됐다.
  //   빈 셀은 담당자에게 "데이터 누락"으로 읽힌다(고객사 발송통계에서 접수된 그 증상과 같다).
  //   값이 없는 것과 유형을 모르는 것을 구분해 표기한다.
  return String(messageType || '').trim() || '(유형 미상)';
}

/**
 * ★ 2026-11-08 C117 D9(Harold H1) — 브랜드 캠페인 이름 = 고른 대상(이름 원천 = brand-message TARGETING_OPTIONS label · 일치 = 계약 c117 B3-a · 프론트 미러 campaign-axis BRAND_TARGETING_LABELS).
 *   F(전체 채널 친구) = 채널 친구 · 빈 값 · 모르는 값(옛 행) = 「브랜드메시지」(모르는 대상을 단정하지 않는다).
 */
export const BRAND_TARGETING_NAMES: Readonly<Record<string, string>> = { I: '채널 친구', F: '채널 친구', N: '비친구만', M: '마수동 전체' };
export function brandTargetingLabel(kakaoTargeting: string | null | undefined): string {
  const name = BRAND_TARGETING_NAMES[String(kakaoTargeting ?? '').trim().toUpperCase()];
  return name ? `브랜드메시지(${name})` : '브랜드메시지';
}

export interface ChannelCount { total: number; success: number; fail: number; pending: number; }

/**
 * ★ 2026-10-07 (박성용 접수 cmuxvwasa0pvajnn462s5ubyr) 알림톡 캠페인 = 「알림톡 시도」와 「대체 문자」를 따로 센다.
 * ★ 2026-11-05 C107 — 브랜드(F) 부모도 같은 규칙(알림톡 · 브랜드 전용 캠페인 = 「카카오 시도」 + 「대체 문자」).
 *   옛 목록은 대체로 나간 문자까지 알림톡 성공으로 셌다(3건 성공 · 실제 = 알림톡 2 성공 + 1 실패 → LMS 대체 1 성공).
 *   - 알림톡 시도 = K행 전부. K+7830/7831(비토 라인 = 같은 행에 대체 결과) = 알림톡 실패 + 대체 성공 1건씩.
 *   - 옛 라인 = 실패한 K행(알림톡 실패) + 별도 L/S행(k_oriseq>0 = 대체 · 그 행의 결과대로).
 *   그 밖의 행(브랜드·일반 문자)은 세지 않는다(알림톡 캠페인 행만 넘어온다).
 * ★ 2026-10-16 통계 엑셀도 이 집계 하나를 쓴다(옛 엑셀 전용 classifyMsgChannel·tallySmsChannelCounts 삭제 · B-1016-1).
 *   대체 판정 = fallbackOf · 청구 식 = 같은 규칙의 SQL 조각(FALLBACK_BILLING_CODE_WHEN_SQL).
 */
export interface KakaoFallbackCount extends ChannelCount {
  fallback: { LMS: ChannelCount; SMS: ChannelCount };
  /** ★ 2026-11-06 C107F ② 카카오 성공 중 브랜드로 실제 친구에게 간 수(success 의 부분집합 · 친구 단가 · 친구 칸 있는 표만) */
  friendSuccess: number;
}

export function tallyKakaoFallback(
  rows: Array<{ msg_type: string; k_oriseq?: number | string | null; status_code: number | string; cnt: number | string; friend?: boolean }>,
): KakaoFallbackCount {
  const init = (): ChannelCount => ({ total: 0, success: 0, fail: 0, pending: 0 });
  const out: KakaoFallbackCount = { ...init(), fallback: { LMS: init(), SMS: init() }, friendSuccess: 0 };
  const add = (b: ChannelCount, code: number, cnt: number) => {
    b.total += cnt;
    if (isSuccess(code)) b.success += cnt;
    else if (isPending(code)) b.pending += cnt;
    else b.fail += cnt;
  };
  for (const r of rows) {
    const cnt = Number(r.cnt || 0);
    const code = Number(r.status_code);
    const fb = fallbackOf(r.msg_type, r.k_oriseq, code);
    if (KAKAO_FALLBACK_PARENT_TYPES.includes(r.msg_type)) {
      if (fb) {
        out.total += cnt; out.fail += cnt;                                          // 카카오(알림톡 · 브랜드)는 실패했고
        const f = out.fallback[fb === 'L' ? 'LMS' : 'SMS'];
        f.total += cnt; f.success += cnt;                                            // 같은 행에서 문자로 대체 성공
      } else {
        add(out, code, cnt);
        if (r.friend === true && r.msg_type === 'F' && isSuccess(code)) out.friendSuccess += cnt;   // ★ C107F ② 브랜드 실제 친구 성공
      }
      continue;
    }
    if (fb) add(out.fallback[fb === 'L' ? 'LMS' : 'SMS'], code, cnt);               // 옛 모양 대체 행 = 그 행의 결과대로
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
  // ★ 2026-11-01 여정 재발 방지 B1-4 — 통신사 전달 성공 + 앱 보고 없음 = 「확인 중」(차단 아님 · 확인 문자 · 늦은 보고로 닫힌다)
  UNCONFIRMED: 'unconfirmed',
  // ★ 2026-11-01 B1-4 — 확인 중이 확인 문자로도 닫히지 않음(검사폰이 확인 문자를 보고하지 않음 · 단말 확인 불가) = 검사 장애(차단 아님)
  ERROR: 'error',
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

/**
 * ★ 2026-11-01 여정 재발 방지 B1-4(Codex 설계 2R #4) — 「통신사 전달 성공 + 앱 보고 없음」으로 끝나는 **모든** 자리의 공용 판정.
 *   옛: 45초 확정 · 시간 초과 두 갈래(큐 · 수동)가 차단으로 적어, 실제로 받은 LG U+ 문자도 「차단」이었다(B-1101-3 · 10-30 실측 3건).
 *   차단(blocked)을 쓰는 길은 확인 문자 수신 하나뿐이다(spam-probe) — 계약 시험이 SQL 자리를 센다.
 */
export function deliveredUnreportedResult(): SpamResultType {
  return SPAM_RESULT.UNCONFIRMED;
}

/** 스팸필터 result → 표시명 */
export const SPAM_RESULT_LABEL: Record<string, string> = {
  [SPAM_RESULT.PASS]: '정상',
  [SPAM_RESULT.BLOCKED]: '차단',
  [SPAM_RESULT.FAILED]: '실패',
  [SPAM_RESULT.TIMEOUT]: '시간초과',
  [SPAM_RESULT.UNCONFIRMED]: '확인 중',
  [SPAM_RESULT.ERROR]: '검사폰 확인 불가',
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
