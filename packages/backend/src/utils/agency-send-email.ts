/**
 * utils/agency-send-email.ts — 대행발송 이메일 접수 · 허용 발신자 CT (★2026-08-26 §18)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §18-2. 허용 발신자 원장(agency_send_email_senders)의
 * 정규화·판정이 여기 산다. 관리 라우트(routes/admin.ts)와 메일 워커가 같은 함수를 쓴다(판정 두 벌 금지).
 *
 * ⛔ 신원 게이트 = allowlist_only(★0826 실측: 하이웍스는 수신 인증 헤더를 붙이지 않는다).
 *   허용 목록 **정확 일치**가 전부다 — plus-tag·점을 벗기는 정규화는 서로 다른 사람을 같은 주소로
 *   접어 위조 방향으로만 넓어지므로 하지 않는다.
 */
import { query } from '../config/database';

/**
 * 발신 주소 정규화: `"홍길동" <a@b.com>` 에서 주소만 추출 → lower → trim. plus-tag 보존.
 * 주소 형태가 아니면 ''(판정 불가 = 미등록과 같게 취급).
 */
export function normalizeSenderEmail(raw: any): string {
  const s = String(raw ?? '').trim();
  const m = s.match(/<([^<>\s]+@[^<>\s]+)>/);
  const addr = (m ? m[1] : s).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) ? addr : '';
}

export type SenderResolution =
  /** 등록·활성 주소 + 귀속 사용자 활성 — 접수를 진행할 수 있다 */
  | { outcome: 'ok'; senderId: string; companyId: string; userId: string; label: string | null }
  /** 허용 목록에 없다(회신 0 · 격리 카운터만) */
  | { outcome: 'unregistered' }
  /** 같은 활성 주소가 2행 이상 — 회사 판정 불가(fail-closed) */
  | { outcome: 'ambiguous' }
  /** 주소는 등록됐는데 귀속 사용자가 비활성·소멸 — 접수하면 발송 직전에 죽는다(worker dispatch_no_owner) */
  | { outcome: 'owner_inactive'; senderId: string; companyId: string };

/**
 * 발신 주소 → 회사·귀속 사용자 판정. **한 쿼리**로 허용 행과 사용자 활성 상태를 함께 읽는다(§18-2).
 * ⛔ 호출 자리는 이메일 워커의 `createRequestCore` 직전 단일 지점이다(네 번째 우회 입구 방지).
 */
export async function resolveEmailSender(fromRaw: any): Promise<SenderResolution> {
  const email = normalizeSenderEmail(fromRaw);
  if (!email) return { outcome: 'unregistered' };
  const r = await query(
    `SELECT s.id, s.company_id, s.user_id, s.label, u.status AS user_status, u.is_active AS user_is_active
       FROM agency_send_email_senders s
       LEFT JOIN users u ON u.id = s.user_id
      WHERE s.email_norm = $1 AND s.is_active`,
    [email],
  );
  if (r.rows.length === 0) return { outcome: 'unregistered' };
  if (r.rows.length > 1) return { outcome: 'ambiguous' };
  const row = r.rows[0];
  // 활성 판정 = 로그인 게이트와 같은 두 축(is_active AND status='active' · auth.ts:291).
  // 차단할 값 열거가 아니라 허용 값만 통과(긍정 비교 · LESSONS_BACKEND 33행). 사용자 행이 없어도 막는다.
  if (row.user_is_active !== true || row.user_status !== 'active') {
    return { outcome: 'owner_inactive', senderId: row.id, companyId: row.company_id };
  }
  return { outcome: 'ok', senderId: row.id, companyId: row.company_id, userId: row.user_id, label: row.label ?? null };
}
