/**
 * utils/hub-company-context.ts — 허브(AI 오퍼레이터 제안 · AI 한줄로) 문안 · 대상 AI 에 넘기는 회사 정보 + 고객 통계
 * ★ 2026-10-18 routes/ai.ts `/operator/propose` 에서 원형 이동(본문 무변경 · 요청 사용자 = viewer).
 */
import { query } from '../config/database';
import { getOpt080Number } from './messageUtils';
import { viewerConsentJoin } from './mall-consent';

export async function loadHubCompanyContext(
  companyId: string,
  userId: string | null,
  viewer: { userId?: string | null; userType?: string | null } | null | undefined,
): Promise<{ companyInfo: any; customerStats: any }> {
  const companyResult = await query(
    `SELECT company_name, business_type, COALESCE(reject_number, opt_out_080_number) as reject_number,
            brand_name, brand_slogan, brand_description, brand_tone, customer_schema,
            cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, unit_price_basis
     FROM companies WHERE id = $1::uuid`,
    [companyId]
  );
  const companyInfo: any = companyResult.rows[0] || {};
  companyInfo.name = companyInfo.company_name;

  // ★ D102: getOpt080Number 컨트롤타워 사용
  const userOpt080 = await getOpt080Number(userId || null, companyId);
  if (userOpt080) companyInfo.reject_number = userOpt080;

  // 카카오 프로필 여부 (recommendTarget 채널 추천 hint)
  const kakaoProfileResult = await query(
    'SELECT COUNT(*) FROM kakao_sender_profiles WHERE company_id = $1 AND is_active = true',
    [companyId]
  );
  companyInfo.has_kakao_profile = parseInt(kakaoProfileResult.rows[0].count) > 0;

  // 고객 통계
  const consentU = await viewerConsentJoin(companyId, viewer, '', 'customers.id');   // ★ 2026-10-02 수신동의 읽기 = CT(mall-consent)
  const statsResult = await query(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE ${consentU.isTrue}) as sms_opt_in_count,
       COUNT(*) FILTER (WHERE gender = 'M') as male_count,
       COUNT(*) FILTER (WHERE gender = 'F') as female_count,
       AVG(purchase_count) as avg_purchase_count,
       AVG(total_purchase_amount) as avg_total_spent
     FROM customers${consentU.join} WHERE company_id = $1 AND is_active = true`,
    [companyId]
  );
  const customerStats = statsResult.rows[0];
  return { companyInfo, customerStats };
}
