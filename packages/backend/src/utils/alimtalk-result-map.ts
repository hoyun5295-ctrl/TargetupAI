/**
 * CT-17: 휴머스온 IMC 응답코드 → 한줄로 내부 상태 매핑 컨트롤타워
 *
 * ALIMTALK-DESIGN.md §5-3, §9 준수.
 *
 * 두 종류의 코드 맵:
 *   1) IMC_RESULT_CODE_MAP — 관리 API 응답 code (0000/4xxx/5xxx/6xxx/9xxx)
 *   2) IMC_REPORT_CODE_MAP — 웹훅 리포트 reportCode (발송 결과)
 *
 * 참고: 전체 응답 코드는 월요일 IMC 응답 코드 문서 최종 확인 후 보강 예정.
 * 알 수 없는 코드는 fallback(system_error)로 안전 처리됨.
 */

export type ImcCodeKind = 'success' | 'user_error' | 'system_error' | 'inspect' | 'retryable';

export interface ImcCodeMapping {
  kind: ImcCodeKind;
  userMessage?: string;
  logLevel: 'info' | 'warn' | 'error';
  retry?: boolean;
}

// ════════════════════════════════════════════════════════════
// 관리 API 응답 코드 맵
// ════════════════════════════════════════════════════════════

export const IMC_RESULT_CODE_MAP: Record<string, ImcCodeMapping> = {
  // ── 성공 ─────────────────────────────────────
  '0000': { kind: 'success', logLevel: 'info' },

  // ── 일반 검증 실패 (4000대) ─────────────────
  '4000': { kind: 'user_error', userMessage: '요청값이 잘못되었습니다', logLevel: 'warn' },
  '4001': { kind: 'system_error', userMessage: '인증에 실패했습니다', logLevel: 'error' },

  // ── 발신프로필 (4010~4012, 4039) ────────────
  '4010': { kind: 'user_error', userMessage: '발신프로필 키가 이미 존재합니다', logLevel: 'warn' },
  '4011': { kind: 'user_error', userMessage: '발신프로필을 찾을 수 없습니다', logLevel: 'warn' },
  '4012': { kind: 'user_error', userMessage: '발신프로필 카테고리를 찾을 수 없습니다', logLevel: 'warn' },
  '4039': { kind: 'user_error', userMessage: '고객사 발신프로필 키가 이미 사용 중입니다', logLevel: 'warn' },

  // ── 알림톡/브랜드 템플릿 (4013~4031) ────────
  '4013': { kind: 'user_error', userMessage: '알림톡 템플릿 코드를 찾을 수 없습니다', logLevel: 'warn' },
  '4014': { kind: 'user_error', userMessage: '알림톡 템플릿 키가 중복됩니다', logLevel: 'warn' },
  '4015': { kind: 'inspect', userMessage: '검수요청 가능한 상태가 아닙니다', logLevel: 'warn' },
  '4016': { kind: 'inspect', userMessage: '검수요청 취소 가능한 상태가 아닙니다', logLevel: 'warn' },
  '4017': { kind: 'user_error', userMessage: '수정 가능한 상태가 아닙니다', logLevel: 'warn' },
  '4018': { kind: 'user_error', userMessage: '템플릿 카테고리를 찾을 수 없습니다', logLevel: 'warn' },
  '4019': { kind: 'user_error', userMessage: '브랜드메시지 템플릿 코드를 찾을 수 없습니다', logLevel: 'warn' },
  '4020': { kind: 'user_error', userMessage: '브랜드메시지 템플릿 키를 찾을 수 없습니다', logLevel: 'warn' },
  '4021': { kind: 'user_error', userMessage: '삭제된 알림톡 템플릿입니다', logLevel: 'warn' },
  '4022': { kind: 'user_error', userMessage: '삭제된 친구톡 템플릿입니다', logLevel: 'warn' },
  '4023': { kind: 'user_error', userMessage: '삭제 가능한 상태가 아닙니다', logLevel: 'warn' },
  '4024': { kind: 'user_error', userMessage: '중지 가능한 상태가 아닙니다', logLevel: 'warn' },
  '4025': { kind: 'user_error', userMessage: '중지해제 가능한 상태가 아닙니다', logLevel: 'warn' },
  '4026': { kind: 'user_error', userMessage: '승인 취소 가능한 상태가 아닙니다', logLevel: 'warn' },
  '4027': { kind: 'user_error', userMessage: '고객사 관리 코드가 이미 사용 중입니다', logLevel: 'warn' },
  '4030': { kind: 'user_error', userMessage: '템플릿 승인(APR)이 필요합니다', logLevel: 'warn' },
  '4031': { kind: 'user_error', userMessage: '템플릿 발송 가능 상태가 아닙니다', logLevel: 'warn' },

  // ── 알림 수신자 (4032~4038) ─────────────────
  '4032': { kind: 'user_error', userMessage: '알림 수신자 기능 사용 권한이 없습니다', logLevel: 'warn' },
  '4033': { kind: 'user_error', userMessage: '알림 수신자를 찾을 수 없습니다', logLevel: 'warn' },
  '4034': { kind: 'user_error', userMessage: '알림 수신자 전화번호가 중복됩니다', logLevel: 'warn' },
  '4035': { kind: 'user_error', userMessage: '알림 수신자 키가 중복됩니다', logLevel: 'warn' },
  '4036': { kind: 'user_error', userMessage: '활성 알림 수신자 최대 인원(10명)을 초과했습니다', logLevel: 'warn' },
  '4038': { kind: 'user_error', userMessage: '지정한 전화번호가 활성 수신자 목록에 없습니다', logLevel: 'warn' },

  // ── 파일/첨부 (4100~4103) ───────────────────
  '4100': { kind: 'user_error', userMessage: '첨부파일이 존재하지 않습니다', logLevel: 'warn' },
  '4101': { kind: 'retryable', userMessage: '파일 저장 실패 (재시도)', logLevel: 'warn', retry: true },
  '4102': { kind: 'user_error', userMessage: '이미지 파일 키를 찾을 수 없습니다', logLevel: 'warn' },
  '4103': { kind: 'user_error', userMessage: '파일 최대 크기를 초과했습니다', logLevel: 'warn' },

  // ── 메시지 키 중복 (재생성) ─────────────────
  '5000': { kind: 'retryable', userMessage: '메시지 키가 중복됩니다 (재생성 필요)', logLevel: 'warn', retry: true },

  // ── 내부 시스템 에러 (재시도 가능) ───────────
  '6000': { kind: 'retryable', logLevel: 'error', retry: true },
  '6001': { kind: 'retryable', logLevel: 'error', retry: true },
  '6002': { kind: 'system_error', logLevel: 'error' },
  '6005': { kind: 'retryable', logLevel: 'error', retry: true },

  // ── 카카오 장애 (재시도) ─────────────────────
  '9998': { kind: 'retryable', userMessage: '카카오 서버 오류 (재시도)', logLevel: 'error', retry: true },
  '9999': { kind: 'retryable', userMessage: '카카오 서버 오류 (재시도)', logLevel: 'error', retry: true },
};

export function resolveImcCode(code: string): ImcCodeMapping {
  return (
    IMC_RESULT_CODE_MAP[code] || {
      kind: 'system_error',
      userMessage: `알 수 없는 오류 (${code})`,
      logLevel: 'error',
    }
  );
}

// ════════════════════════════════════════════════════════════
// 웹훅 리포트 코드 맵 (reportCode, 발송 결과)
// ════════════════════════════════════════════════════════════

export type ReportKind = 'delivered' | 'failed' | 'unknown';

export interface ReportCodeMapping {
  kind: ReportKind;
  userMessage: string;
}

/**
 * 카카오 리포트 코드 맵 (웹훅 reportCode)
 *
 * 출처: `C:\Users\ceo\Downloads\imc_extracted\10_52_06_응답 코드.txt` 실 스펙 대조 완료
 * 이전 구현의 오매핑(1001/1002/1004 의미 완전히 반대)은 전부 교정됨.
 * 알 수 없는 코드는 `resolveReportCode()` fallback이 "알 수 없는 리포트 코드 (xxx)"로 처리.
 */
export const IMC_REPORT_CODE_MAP: Record<string, ReportCodeMapping> = {
  // ── 성공 ─────────────────────────────────────
  '0000': { kind: 'delivered', userMessage: '전송 성공' },

  // ── 데이터/권한 관련 (0xxx 계열) ────────────
  '508':  { kind: 'unknown',  userMessage: '데이터 없음' },
  '811':  { kind: 'failed',   userMessage: '권한 없음' },

  // ── 요청 포맷/인증 (1001~1004) ──────────────
  // ★ 이전 매핑 "카카오톡 미설치/친구아님/수신거부" 는 오매핑 — 교정함
  '1001': { kind: 'failed', userMessage: '요청 JSON 본문 누락' },             // NO_JSON_BODY
  '1002': { kind: 'failed', userMessage: '허브 파트너 키 오류' },             // INVALID_HUB_PARTNER_KEY
  '1003': { kind: 'failed', userMessage: '발신프로필 키 오류' },             // INVALID_SENDER_KEY
  '1004': { kind: 'failed', userMessage: '요청 JSON 필드 값 누락' },         // NO_VALUE_JSON_ELEMENT

  // ── 발신프로필 상태 (1006~1007, 1021~1025) ──
  '1006': { kind: 'failed', userMessage: '삭제된 발신프로필' },
  '1007': { kind: 'failed', userMessage: '중지된 발신프로필' },
  '1021': { kind: 'failed', userMessage: '차단된 발신프로필' },
  '1022': { kind: 'failed', userMessage: '비활성 발신프로필' },
  '1023': { kind: 'failed', userMessage: '삭제된 발신프로필' },
  '1024': { kind: 'failed', userMessage: '삭제 진행 중인 발신프로필' },
  '1025': { kind: 'failed', userMessage: '스팸 처리된 발신프로필' },
  '1027': { kind: 'failed', userMessage: '스팸 처리된 발신프로필(MSG)' },

  // ── 계약/ID (1009, 1011~1016) ─────────────
  '1009': { kind: 'failed', userMessage: 'VAS ID 미등록' },
  '1011': { kind: 'failed', userMessage: '계약 정보 없음' },
  '1012': { kind: 'failed', userMessage: '유저 키 오류' },
  '1013': { kind: 'failed', userMessage: '유효하지 않은 앱링크' },
  '1014': { kind: 'failed', userMessage: '유효하지 않은 사업자번호' },
  '1015': { kind: 'failed', userMessage: '유효하지 않은 앱 유저 ID' },
  '1016': { kind: 'failed', userMessage: '사업자등록번호 불일치' },

  // ── 수신자/요청 (1020, 1026, 1028, 1030, 1033) ─
  '1020': { kind: 'failed', userMessage: '수신자 전화번호 오류' },
  '1026': { kind: 'failed', userMessage: '사용 불가 메시지 타입' },
  '1028': { kind: 'failed', userMessage: '사용 불가 타겟팅 옵션' },
  '1030': { kind: 'failed', userMessage: '잘못된 요청 파라미터' },
  '1033': { kind: 'failed', userMessage: '메시지 타입/버블 타입 불일치' },

  // ── 발송 실패 (2003~2006) ──────────────────
  '2003': { kind: 'failed', userMessage: '친구톡 수신자 친구아님' },
  '2005': { kind: 'failed', userMessage: '이미지 읽기 실패' },
  '2006': { kind: 'failed', userMessage: '시리얼넘버 형식 불일치' },

  // ── 전송 예외 (3000~3060) ──────────────────
  '3000': { kind: 'failed', userMessage: '예상치 못한 오류' },
  '3005': { kind: 'failed', userMessage: 'ACK 타임아웃' },
  '3006': { kind: 'failed', userMessage: '메시지 전송 실패' },
  '3008': { kind: 'failed', userMessage: '전화번호 형식 오류' },
  '3010': { kind: 'failed', userMessage: 'JSON 파싱 오류' },
  '3011': { kind: 'failed', userMessage: '메시지 없음' },
  '3013': { kind: 'failed', userMessage: '메시지 본문 비어있음' },
  '3014': { kind: 'failed', userMessage: '메시지 길이 초과' },
  '3015': { kind: 'failed', userMessage: '템플릿 없음' },
  '3016': { kind: 'failed', userMessage: '템플릿 매칭 실패' },
  '3018': { kind: 'failed', userMessage: '발송 불가 상태' },
  '3019': { kind: 'failed', userMessage: '메시지 발송 불가' },
  '3021': { kind: 'failed', userMessage: '카카오톡 최소버전 미지원' },
  '3022': { kind: 'failed', userMessage: '발송 불가 시간대' },
  '3023': { kind: 'failed', userMessage: '비디오 파일 오류' },
  '3024': { kind: 'failed', userMessage: '이미지 파일 오류' },
  '3025': { kind: 'failed', userMessage: '변수 글자수 제한 초과' },
  '3026': { kind: 'failed', userMessage: '상담/봇 전환 버튼 extra 제한 초과' },
  '3027': { kind: 'failed', userMessage: '템플릿 버튼 매칭 실패' },
  '3028': { kind: 'failed', userMessage: '템플릿 타이틀 매칭 실패' },
  '3029': { kind: 'failed', userMessage: '타이틀 길이 초과' },
  '3030': { kind: 'failed', userMessage: '템플릿/메시지 타입 매칭 실패' },
  '3031': { kind: 'failed', userMessage: '템플릿 헤더 매칭 실패' },
  '3032': { kind: 'failed', userMessage: '헤더 길이 초과' },
  '3050': { kind: 'failed', userMessage: '광고성 수신동의 미지원' },

  // ── 4xxx 발송 인프라 오류 ─────────────────
  '4100': { kind: 'failed', userMessage: '시리얼넘버 오류' },
  '4103': { kind: 'failed', userMessage: '유효한 허브 파트너 없음' },
  '4104': { kind: 'failed', userMessage: '유효한 발신프로필 없음' },
  '4105': { kind: 'failed', userMessage: '유효한 계약 없음' },
  '4110': { kind: 'failed', userMessage: '버블/메시지 타입 오류' },
  '4121': { kind: 'failed', userMessage: '발송 대상 오류' },
  '4131': { kind: 'failed', userMessage: '요청 ID 중복' },
  '4132': { kind: 'failed', userMessage: '템플릿 변수 불일치' },
  '4133': { kind: 'failed', userMessage: '중지된 템플릿' },
  '4134': { kind: 'failed', userMessage: '변경된 템플릿' },
  '4135': { kind: 'failed', userMessage: '지갑 계약 없음' },
  '4136': { kind: 'failed', userMessage: '지갑 잔액 부족' },
  '4138': { kind: 'failed', userMessage: '브랜드메시지 발송 건수 제한 초과' },
  '4143': { kind: 'failed', userMessage: '요청 만료' },

  // ── 전송시간 초과 ─────────────────────────
  '1100': { kind: 'failed', userMessage: '전송시간 만료' },

  // ── 문자(SMS/LMS/MMS)/RCS 리포트 코드는 추후 발송 로그 확인 후 보강
  //    현재 우리는 QTmsg Agent 경유 문자라 reportCode가 IMC로 오지 않음
};

export function resolveReportCode(code: string): ReportCodeMapping {
  return (
    IMC_REPORT_CODE_MAP[code] || {
      kind: 'unknown',
      userMessage: `알 수 없는 리포트 코드 (${code})`,
    }
  );
}

// ════════════════════════════════════════════════════════════
// 리포트 타입 (SM/AT/FT/RCS)
// ════════════════════════════════════════════════════════════

export type ReportType = 'SM' | 'LM' | 'MM' | 'AT' | 'FT' | 'RCS';

export const REPORT_TYPE_LABEL: Record<string, string> = {
  SM: 'SMS',
  LM: 'LMS',
  MM: 'MMS',
  AT: '알림톡',
  FT: '친구톡/브랜드메시지',
  RCS: 'RCS',
};
