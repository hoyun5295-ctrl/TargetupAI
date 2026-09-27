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

/**
 * 카카오 사용 회사인가 + 들어온 발신키가 그 회사의 활성 발신프로필 키인가.
 * 키가 비면 소유 검사는 건너뛴다 — 지금 그 경로의 동작을 그대로 둔다. 화면이 반드시 채우는 경로는 requireKey로 필수로 본다.
 * 키 판정 = kakao_sender_profiles(company_id, profile_key) · 사용 중지 프로필(is_active=false)은 통과하지 않는다(목록과 같은 규칙).
 */
export async function checkBrandSendGate(
  companyId: string, senderKey: string | null | undefined, opts: { requireKey?: boolean } = {},
): Promise<BrandSendGateResult> {
  const co = await query('SELECT kakao_enabled FROM companies WHERE id = $1', [companyId]);
  if (!co.rows[0]?.kakao_enabled) {
    return { ok: false, status: 403, code: 'KAKAO_NOT_ENABLED', error: '카카오 브랜드메시지가 활성화되지 않은 고객사입니다.' };
  }
  const key = String(senderKey ?? '').trim();
  if (!key) {
    return opts.requireKey
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
