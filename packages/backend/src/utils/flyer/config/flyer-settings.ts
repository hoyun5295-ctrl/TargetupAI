/**
 * ★ 전단AI 매장/회사 설정 컨트롤타워
 *
 * 데이터 자동 파기, 알림 설정 등 회사/캠페인 단위 설정 관리.
 * 라우트에서 인라인 query 금지 — 이 CT를 통해야 한다.
 */

import { query } from '../../../config/database';

// ============================================================
// 데이터 자동 파기 설정
// ============================================================

/**
 * 회사 전체 자동 파기 설정 조회
 */
export async function getAutoPurgeSettings(companyId: string): Promise<{ auto_purge_days: number }> {
  const result = await query(
    `SELECT auto_purge_days FROM flyer_companies WHERE id = $1`,
    [companyId]
  );
  return { auto_purge_days: result.rows[0]?.auto_purge_days || 0 };
}

/**
 * 회사 전체 자동 파기 설정 변경
 */
export async function updateAutoPurgeSettings(companyId: string, days: number): Promise<void> {
  await query(
    `UPDATE flyer_companies SET auto_purge_days = $2 WHERE id = $1`,
    [companyId, days || 0]
  );
}

/**
 * 캠페인별 자동 파기 설정
 */
export async function setCampaignAutoPurge(campaignId: string, companyId: string, days: number): Promise<void> {
  await query(
    `UPDATE flyer_campaigns SET
       extra_data = COALESCE(extra_data, '{}'::jsonb) || jsonb_build_object('auto_purge_days', $3),
       updated_at = NOW()
     WHERE id = $1 AND company_id = $2`,
    [campaignId, companyId, days || 0]
  );
}
