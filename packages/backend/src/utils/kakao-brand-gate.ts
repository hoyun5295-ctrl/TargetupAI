/**
 * CT: 카카오 브랜드 발송 게이트 · 발신프로필 조회 범위 — ★ 2026-09-27 한줄로 V2 차수 1 GATE(S2-01 · R100 · m119 일부)
 *
 * 브랜드 발송 경로(/brand-send · 테스트 발송 · AI 캠페인 생성·발송 · 직접발송 대량·동기)가 요청 본문의 발신키를 그대로 IMC에 실었다.
 * 남의 발신키를 알면 그 프로필로 발송할 수 있었고, 카카오 사용 여부 검사는 세 곳에 같은 인라인 문장으로 흩어져 있었다.
 * 판정을 여기 한 곳에 둔다. 발신프로필 단건 조회도 목록과 같은 범위 규칙(슈퍼관리자 전체 · 그 밖은 자기 회사)을 여기서 받는다.
 */
import { query } from '../config/database';

export type BrandSendGateResult =
  | { ok: true }
  | { ok: false; status: number; code: string; error: string };

/** 발송이 쓰는 꼴 그대로(비면 I · 대문자) — 마수동 전체(M) · 비친구(N)만 승인 대상 */
export function brandTargetingNeedsApproval(targeting: string | null | undefined): boolean {
  const t = String(targeting || 'I').trim().toUpperCase();
  return t === 'M' || t === 'N';
}

/**
 * 대상 범위에 맞는 승인 + 들어온 발신키가 그 회사의 활성 발신프로필 키인가.
 * ★ 2026-10-29 B-1029-1(박성용 접수) — 승인(`companies.kakao_enabled` = 슈퍼관리자 「카카오 브랜드메시지」)은 마수동 전체 · 비친구 발송에만 필요하다
 *   (채널 친구 5만 + 마케팅 수신동의 증적). 채널 친구(I) 발송은 승인 없이 나간다 · 대신 자기 회사의 활성 발신프로필 키를 반드시 고른다.
 *   옛: 대상 범위를 보지 않고 승인 하나로 모든 브랜드 발송을 막아 승인 전 회사의 채널 친구 발송까지 막혔다.
 * 승인된 회사의 키 빈 값 = 소유 검사 건너뜀(그 경로의 옛 동작) · 화면이 반드시 채우는 경로는 requireKey 로 필수.
 * 키 판정 = kakao_sender_profiles(company_id, profile_key) · 사용 중지 프로필(is_active=false)은 통과하지 않는다(목록과 같은 규칙).
 */
export async function checkBrandSendGate(
  companyId: string, senderKey: string | null | undefined, targeting: string | null | undefined, opts: { requireKey?: boolean } = {},
): Promise<BrandSendGateResult> {
  const co = await query('SELECT kakao_enabled FROM companies WHERE id = $1', [companyId]);
  const approved = co.rows[0]?.kakao_enabled === true;
  if (!approved && brandTargetingNeedsApproval(targeting)) {
    return {
      ok: false, status: 403, code: 'KAKAO_NOT_ENABLED',
      error: '마수동 전체 · 비친구 발송은 카카오 브랜드메시지 승인(채널 친구 5만 · 마케팅 수신동의 증적) 뒤에 열립니다. 채널 친구 발송은 지금 보낼 수 있습니다.',
    };
  }
  const key = String(senderKey ?? '').trim();
  if (!key) {
    return opts.requireKey || !approved
      ? { ok: false, status: 400, code: 'SENDER_KEY_REQUIRED', error: '발신 프로필을 선택해주세요.' }
      : { ok: true };
  }
  const owned = await query(
    `SELECT 1 AS ok FROM kakao_sender_profiles
      WHERE company_id = $1 AND profile_key = $2 AND COALESCE(is_active, true) = true
      LIMIT 1`,
    [companyId, key],
  );
  if (owned.rows.length === 0) {
    return { ok: false, status: 403, code: 'SENDER_KEY_NOT_OWNED', error: '이 회사에 등록된 발신 프로필이 아닙니다. 발신 프로필을 다시 선택해주세요.' };
  }
  return { ok: true };
}

/**
 * 발신프로필 조회 범위 조건 — 슈퍼관리자 = 전체('') · 회사 사용자 = 자기 회사(company_id = $n) · 회사 없음 = null(호출부가 401).
 * @param paramIndex 회사 id가 들어갈 자리표시 번호
 */
export function senderProfileScope(
  user: { userType?: string; companyId?: string } | undefined, paramIndex: number,
): { sql: string; params: any[] } | null {
  if (user?.userType === 'super_admin') return { sql: '', params: [] };
  if (!user?.companyId) return null;
  return { sql: ` AND company_id = $${paramIndex}`, params: [user.companyId] };
}
