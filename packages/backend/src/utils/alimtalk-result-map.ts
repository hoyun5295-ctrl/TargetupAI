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

export const IMC_REPORT_CODE_MAP: Record<string, ReportCodeMapping> = {
  // ── 성공 ─────────────────────────────────────
  '0000': { kind: 'delivered', userMessage: '전송 성공' },

  // ── 데이터/권한 관련 ────────────────────────
  '508':  { kind: 'unknown',  userMessage: '데이터 없음' },
  '811':  { kind: 'failed',   userMessage: '권한 없음' },

  // ── 발신프로필 상태 ────────────────────────
  '1003': { kind: 'failed', userMessage: '발신프로필 오류' },
  '1006': { kind: 'failed', userMessage: '삭제된 발신프로필' },
  '1007': { kind: 'failed', userMessage: '중지된 발신프로필' },
  '1013': { kind: 'failed', userMessage: '유효하지 않은 앱링크' },

  // ── 카카오 수신 실패 (예시, 월요일 완전본 수령 후 보강) ──
  '1001': { kind: 'failed', userMessage: '카카오톡 미설치 수신자' },
  '1002': { kind: 'failed', userMessage: '카카오톡 채널 친구 아님' },
  '1004': { kind: 'failed', userMessage: '메시지 수신 거부' },
  '1005': { kind: 'failed', userMessage: '탈퇴한 수신자' },
  '1100': { kind: 'failed', userMessage: '전송시간 만료' },

  // 참고: 문자(8000~) / RCS(41xxx~77xxx)는 월요일 응답코드 문서 확정 후 추가
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
