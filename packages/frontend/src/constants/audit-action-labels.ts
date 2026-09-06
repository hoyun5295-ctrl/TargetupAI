/**
 * audit-action-labels.ts — 감사 로그 액션·상세의 한글 표기 CT (★ 2026-08-24 · Harold "영문 전수 한글화")
 *
 * 백엔드가 `audit_logs.action`에 적는 값 전수를 여기 한 곳이 소유한다(작성 시점 grep 전수 = 아래 목록).
 * 화면(AdminDashboard 감사 로그 탭)은 이 맵으로만 그린다 — 인라인 맵을 다시 만들지 않는다.
 * ⛔ 백엔드에 새 액션을 적기 시작하면 여기에 라벨을 함께 등록한다. 등록을 잊어도 화면은 죽지 않고
 *   원문 코드를 그대로 보여준다(숨기는 것보다 보이는 낡음이 낫다).
 */

/** 액션 → 한글 라벨 */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  // 로그인·세션
  login_success: '로그인 성공',
  login_fail: '로그인 실패',
  login_blocked: '로그인 차단',
  logout: '로그아웃',
  login_session_conflict: '동시 접속 감지',
  login_takeover: '접속 인계',
  // 2차 인증(MFA·OTP)
  mfa_challenge: '2차 인증 요청',
  mfa_success: '2차 인증 성공',
  mfa_fail: '2차 인증 실패',
  mfa_locked: '2차 인증 잠김',
  mfa_phone_changed: '2차 인증 번호 변경',
  totp_enroll_start: 'OTP 등록 시작',
  totp_enrolled: 'OTP 등록 완료',
  // ★ 2026-09-05 AI 영업 아웃리치(ceo 전용 · routes/sales-outreach.ts 성공 분기)
  'sales_outreach.enqueue': 'AI 영업 업체 등록',
  'sales_outreach.enqueue_bulk': 'AI 영업 일괄 등록',
  'sales_outreach.confirm': 'AI 영업 확정(제작 시작)',
  'sales_outreach.retry': 'AI 영업 재시도',
  'sales_outreach.recrawl': 'AI 영업 다시 읽기',
  'sales_outreach.regenerate': 'AI 영업 산출물 재생성',
  'sales_outreach.send': 'AI 영업 자사 메일 발송',
  'sales_outreach.test_send': 'AI 영업 검수 메일 발송',
  'sales_outreach.mail_confirmed': 'AI 영업 수신 확인',
  'sales_outreach.forwarded': 'AI 영업 업체 전달 표시',
  'sales_outreach.copy_edit': 'AI 영업 문안 수정',
  'sales_outreach.subject_edit': 'AI 영업 제목 수정',
  'sales_outreach.rebuild_email': 'AI 영업 메일 재조립',
  'sales_outreach.dismiss': 'AI 영업 실패 건 숨기기',
  'sales_outreach.material_override': '재료 부족 잠금 해제',
  'sales_outreach.delete': 'AI 영업 건 삭제(링크 닫음)',
  'sales_outreach.delete_bulk': 'AI 영업 선택 삭제',
  'sales_outreach.materials': 'AI 영업 재료 다시 고르기',
  'sales_outreach.sections': 'AI 영업 블록 숨기기',
  // ★ 2026-09-05 베스트 구성 · 실물 예시(AI 영업 학습)
  'best_layout.example_promote': '실물 예시 올리기(AI 영업 학습)',
  'best_layout.example_delete': '실물 예시 삭제(AI 영업 학습)',
  // 접근 통제(전송자격인증)
  machine_origin_detected: '기계 접속 감지',
  machine_origin_blocked: '기계 접속 차단',
  foreign_access_detected: '국외 접속 감지',
  foreign_access_blocked: '국외 접속 차단',
  pre_auth_effect: '로그인 전 차단 적용',
  geo_cidrs_replaced: '국외 대역 갱신',
  access_origin_exception_granted: '접속 예외 허용',
  access_origin_exception_revoked: '접속 예외 해제',
  // 고객 데이터
  customer_delete: '고객 삭제',
  customer_bulk_delete: '고객 선택삭제',
  customer_delete_all: '고객 전체삭제',
  customer_delete_by_user: '사용자별 고객 삭제',
  privacy_export: '개인정보 내보내기',
  privacy_purge: '개인정보 파기',
  // 계정·회사 관리
  user_update: '사용자 수정',
  account_restricted: '계정 제한',
  company_terminated: '회사 해지',
  // ★ 2026-08-27 직원 계정 등급(전송자격인증 3.2·3.3)
  admin_role_changed: '직원 등급 변경',
  admin_account_created: '직원 계정 생성',
  admin_account_disabled: '직원 계정 비활성',
  admin_account_enabled: '직원 계정 재활성',
  admin_password_changed: '직원 비밀번호 변경',
  // 발송 라인·정책
  line_group_create: '라인그룹 생성',
  line_group_update: '라인그룹 수정',
  line_group_delete: '라인그룹 삭제',
  company_line_group_change: '회사 라인그룹 변경',
  company_unit_price_update: '회사 단가 변경',
  sender_line_policy_update: '발신 라인 정책 변경',
  // 운영
  spam_block_rule_create: '금칙어 규칙 추가',
  spam_block_rule_update: '금칙어 규칙 수정',
  deposit_hold_resolved: '입금 보류 해제',
  diagnosis_manual_grant: '진단 수동 부여',
  diagnosis_status_change: '진단 상태 변경',
  // ★ 2026-08-30 승인 링크 보안 보강 — 무로그인 링크로 실행된 승인의 감사 노출
  charge_link_approved: '충전 링크 승인',
  agency_link_approved: '대행발송 링크 승인',
};

/** 액션 → 뱃지 색(등록 없으면 회색). 성공=초록 · 실패·차단·파기=빨강 · 감지·주의=호박 · 인계·변경=파랑 */
export const AUDIT_ACTION_COLOR: Record<string, string> = {
  login_success: 'bg-green-100 text-green-700',
  mfa_success: 'bg-green-100 text-green-700',
  totp_enrolled: 'bg-green-100 text-green-700',
  login_fail: 'bg-red-100 text-red-700',
  mfa_fail: 'bg-red-100 text-red-700',
  login_blocked: 'bg-red-200 text-red-800',
  mfa_locked: 'bg-red-200 text-red-800',
  machine_origin_blocked: 'bg-red-100 text-red-700',
  foreign_access_blocked: 'bg-red-100 text-red-700',
  customer_delete: 'bg-orange-100 text-orange-700',
  customer_bulk_delete: 'bg-orange-100 text-orange-700',
  customer_delete_by_user: 'bg-orange-100 text-orange-700',
  customer_delete_all: 'bg-red-100 text-red-700',
  privacy_purge: 'bg-red-100 text-red-700',
  login_session_conflict: 'bg-amber-100 text-amber-700',
  machine_origin_detected: 'bg-amber-100 text-amber-700',
  foreign_access_detected: 'bg-amber-100 text-amber-700',
  login_takeover: 'bg-indigo-100 text-indigo-700',
  account_restricted: 'bg-red-100 text-red-700',
  company_terminated: 'bg-red-100 text-red-700',
  charge_link_approved: 'bg-green-100 text-green-700',
  agency_link_approved: 'bg-green-100 text-green-700',
};

const USER_TYPE_LABEL: Record<string, string> = {
  admin: '관리자', user: '사용자', super_admin: '슈퍼관리자', company_admin: '고객사관리자', company_user: '사용자',
};

/** 실패·차단 사유 → 한글 */
const REASON_LABEL: Record<string, string> = {
  invalid_password: '비밀번호 불일치',
  user_not_found: '계정 없음',
  inactive: '비활성 계정',
  locked: '잠금 계정',
  dormant: '휴면 계정',
  not_allowed: '접근 차단',
  agent_only_company: '발송 전용 회사(웹 로그인 없음)',
  not_company_admin: '관리자 계정 아님',
  system_account: '시스템 계정',
  account_disabled: '사용 중지 계정',
  account_restricted: '제한된 계정',
  company_terminated: '해지된 회사',
  invalid_totp: 'OTP 번호 불일치',
  machine_origin_blocked: '기계 접속 차단',
  foreign_access_blocked: '국외 접속 차단',
};

/** 상세 JSON의 값 몇 가지 → 한글 */
const SCOPE_LABEL: Record<string, string> = {
  company_agent: '발송 에이전트',
  web: '웹 접속',
};

/** 상세 키 → 한글(문장 조립이 없는 액션의 폴백 나열용) */
const DETAIL_KEY_LABEL: Record<string, string> = {
  loginId: '아이디', companyName: '고객사', company_name: '고객사', userType: '구분', reason: '사유',
  scope: '범위', registered: '등록 여부', country: '국가', ip: 'IP', phone: '번호',
  deleted_customers: '삭제 수', deleted_count: '삭제 수', count: '건수',
};

/**
 * 직원 계정 등급 → 한글. (★2026-08-27 전송자격인증 3.2·3.3)
 * ⛔ **원본은 백엔드 `utils/admin-role.ts` `ADMIN_ROLE_LABEL`이다.** 여기는 감사 로그 상세를 그리기 위한 사본이고,
 *   갈라지지 않도록 백엔드 계약 테스트(`admin-role-label-parity`)가 두 파일을 대조한다. 한쪽만 고치면 테스트가 깨진다.
 */
export const ADMIN_ROLE_LABEL: Record<string, string> = {
  super: '대표',
  lead: '지원팀장',
  support: '지원팀원',
};

const roleName = (v: any) => ADMIN_ROLE_LABEL[String(v ?? '')] || String(v ?? '') || '-';

const yn = (v: any) => (v === true ? '예' : v === false ? '아니오' : String(v));

/**
 * 상세(JSON)를 사람이 읽는 한 줄로. 액션별 문장이 있으면 그것을, 없으면 키·값을 한글로 나열한다.
 * ⛔ raw JSON을 그대로 내보내지 않는다 — 그게 이 파일이 생긴 이유다(Harold 0824 "영문으로 모르는 것들").
 */
export function formatAuditDetail(action: string, details: any): string {
  const d = details || {};
  const who = () => [d.loginId, d.companyName && `· ${d.companyName}`].filter(Boolean).join(' ');
  switch (action) {
    case 'login_success':
      return `${d.loginId || ''} (${USER_TYPE_LABEL[d.userType] || d.userType || ''}) · ${d.companyName || ''}`;
    case 'login_fail':
    case 'login_blocked':
      return `${d.loginId || ''} · ${REASON_LABEL[d.reason] || d.reason || ''}`;
    case 'logout':
      return `${d.loginId || ''} 로그아웃`;
    case 'login_session_conflict':
      return `${who()} 계정이 이미 다른 곳에서 접속 중이었습니다`;
    case 'login_takeover':
      return `${who()} 기존 접속을 끊고 새로 로그인했습니다`;
    case 'machine_origin_detected':
    case 'machine_origin_blocked':
      return `${SCOPE_LABEL[d.scope] || d.scope || ''} 접속 · ${d.registered === false ? '미등록 출처' : d.registered === true ? '등록된 출처' : ''}`.trim();
    case 'foreign_access_detected':
    case 'foreign_access_blocked':
      return [d.loginId, d.country && `국가: ${d.country}`].filter(Boolean).join(' · ');
    case 'customer_delete':
      return `${d.company_name || ''} · ${d.phone || ''} 삭제`;
    case 'customer_bulk_delete':
      return `${d.company_name || ''} · ${Number(d.deleted_count || d.count || 0).toLocaleString()}명 선택삭제`;
    case 'customer_delete_all':
      return `${d.company_name || ''} · ${Number(d.deleted_customers || 0).toLocaleString()}명 전체삭제`;
    // ★ 2026-08-27 직원 계정 등급(전송자격인증 3.2·3.3) — 등급 코드를 그대로 내보내지 않는다
    case 'admin_role_changed':
      return [
        `${d.name || d.login_id || ''}(${d.login_id || ''})`,
        `등급 ${roleName(d.before)} → ${roleName(d.after)}`,
        d.reason && `사유: ${d.reason}`,
      ].filter(Boolean).join(' · ');
    case 'admin_account_created':
      return [
        `${d.name || ''}(${d.login_id || ''}) 계정 생성`,
        `등급 ${roleName(d.role)}`,
        d.reason && `사유: ${d.reason}`,
      ].filter(Boolean).join(' · ');
    case 'admin_account_disabled':
    case 'admin_account_enabled':
      return [
        `${d.name || ''}(${d.login_id || ''}) ${action === 'admin_account_enabled' ? '사용 재개' : '사용 중지'}`,
        d.reason && `사유: ${d.reason}`,
      ].filter(Boolean).join(' · ');
    case 'admin_password_changed':
      return `${d.login_id || ''} 비밀번호 변경${d.reason === 'initial_password' ? ' (초기 비밀번호 교체)' : ''}`;
    // ★ 2026-08-30 승인 링크 보안 보강
    case 'charge_link_approved':
      return [d.companyName, d.amount != null && `${Number(d.amount).toLocaleString()}원`, d.phone && `승인 번호 ${d.phone}`]
        .filter(Boolean).join(' · ');
    case 'agency_link_approved':
      return [d.label, d.phone && `승인 번호 ${d.phone}`].filter(Boolean).join(' · ');
    default: {
      const parts = Object.entries(d)
        .filter(([, v]) => v != null && v !== '' && typeof v !== 'object')
        .slice(0, 5)
        .map(([k, v]) => `${DETAIL_KEY_LABEL[k] || k}: ${typeof v === 'boolean' ? yn(v) : REASON_LABEL[String(v)] || String(v)}`);
      return parts.join(' · ');
    }
  }
}
