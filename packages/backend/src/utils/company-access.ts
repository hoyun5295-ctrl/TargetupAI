/**
 * company-access.ts — 회사 상태 기반 접근 차단 컨트롤타워 (★2026-08-18)
 *
 * 왜 회사 축인가
 *   해지 라우트가 소속 계정을 dormant로 바꾸긴 하지만 그 전파는 경로마다 다르다.
 *   0818 실측 — 해지 14곳 중 1곳은 계정이 active로 남았고, 정지(suspended)는 전파 코드 자체가 없었다.
 *   전파에 기대면 경로가 늘 때마다 샌다. 계약이 끝났다는 사실은 회사 한 곳에만 있으므로 거기서 판정한다.
 *
 * ⚠ NULL 취급
 *   companies.status의 NULL·미설정은 **활성**이다(SCHEMA.md — 기존 판정이 전부 `!== 'terminated'` 형태라
 *   NULL이 통과하도록 설계돼 있다). 그래서 `!== 'active'` 같은 부정 비교를 쓰면 NULL 회사가 전부 차단된다.
 *   반드시 **차단할 값만 열거**하는 긍정 비교로 판정한다.
 *
 * 전송자격인증 3.3(접근권한 변경의 적정성) 대응 축.
 */

/** 차단 대상 회사 상태 → 사용자에게 보일 문구. 여기 없는 값은 통과다(NULL 포함). */
const BLOCKED_COMPANY_STATUS: Record<string, string> = {
  terminated: '종료된 계약입니다. 담당자에게 문의해주세요.',
  suspended: '서비스가 일시 중지되었습니다. 담당자에게 문의해주세요.',
};

export interface CompanyAccessDenial {
  /** 감사 로그용 사유 코드 */
  reason: string;
  /** 사용자 노출 문구 */
  message: string;
}

/**
 * 회사 상태로 접근을 막아야 하는가.
 * 막아야 하면 사유·문구를, 통과면 null을 돌려준다.
 */
export function resolveCompanyAccessDenial(companyStatus: any): CompanyAccessDenial | null {
  const status = String(companyStatus ?? '').trim();
  const message = BLOCKED_COMPANY_STATUS[status];
  if (!message) return null;
  return { reason: `company_${status}`, message };
}
