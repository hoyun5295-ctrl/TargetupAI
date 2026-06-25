/**
 * ★ CDP identity 검수 플래그 recorder — 2026-06-25 (A1 skip_conflict + A4 phone_conflict 공용 저장소)
 *
 * 자동 병합/자동 phone 변경은 위험 → 충돌 시 변경 안 하고 본 테이블에 플래그만 적재(운영 검수 후 수동 병합).
 * 테이블 미생성(마이그레이션 미실행) 시 = warn 후 skip (식별/발송 흐름 절대 차단 X). db_alter_safety_net 정합.
 */
import { query } from '../config/database';

export type IdentityReviewKind = 'phone_conflict' | 'merge_candidate';

export async function recordIdentityReview(p: {
  companyId: string;
  customerId: string;
  kind: IdentityReviewKind;
  detail: Record<string, any>;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO cdp_identity_review (id, company_id, customer_id, kind, detail, resolved, created_at)
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4::jsonb, false, NOW())`,
      [p.companyId, p.customerId, p.kind, JSON.stringify(p.detail || {})],
    );
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('cdp_identity_review') && msg.includes('does not exist')) {
      console.warn('[CDP Identity Review] cdp_identity_review 테이블 미생성 — 마이그레이션 필요(검수 플래그 skip, 식별 흐름 유지)');
      return;
    }
    console.warn('[CDP Identity Review] 플래그 기록 실패(식별 흐름 유지):', err);
  }
}
