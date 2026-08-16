/**
 * CT: 이번 달(KST) 발송 실적·사용금액 집계 (2026-08-16 신설 — 마케팅 진단 설계서 §5-4)
 *
 * 기원 = routes/customers.ts /stats computeStats의 월 사용 블록을 **원형 이동**(동작·산식 무변경).
 * 소비처 = ①고객 대시보드 /stats(company_user는 본인 발송만) ②마케팅 진단 리포트(회사 전체).
 * 리포트와 화면이 각자 계산하면 같은 회사에서 숫자가 갈라진다 — route-local 복사 금지.
 *
 * 진실 원천
 *   - 카운트 = getCampaignResultCounts(카운트 단일 진입점 — SMS+카카오 합산 완료값이라
 *     카카오를 따로 더하지 않는다: 이중 합산 금지 계약. 발송결과·발송통계·관리자 화면과 동일 소스).
 *   - 단가 = getCompanyCosts(고객사 DB 단가 우선·부가세 포함 표시가 — 청구서 공급가액과는 다른 축).
 *   - 테스트·스팸필터 비용 = 프로 미만만 포함(D79) · balance_transactions 기반(D100).
 */
import { query } from '../config/database';
import { getCompanyCosts } from '../config/defaults';
import { getCampaignResultCounts } from './stats-aggregation';

export interface MonthlyUsage {
  totalSent: number;
  totalSuccess: number;
  totalFail: number;
  smsSent: number;
  lmsSent: number;
  mmsSent: number;
  kakaoSent: number;
  /** 채널 비용 + (프로 미만) 테스트·스팸필터 비용. 원 단위 실수 — 반올림은 표시 시점 1회. */
  monthlyCost: number;
  costs: { sms: number; lms: number; mms: number; kakao: number };
}

export async function computeMonthlyUsage(
  companyId: string,
  opts: { userId?: string; userType?: string } = {},
): Promise<MonthlyUsage> {
  const { userId, userType } = opts;

  // ★ 사용자(company_user)는 본인 발송만, 관리자(company_admin)는 전체 (customers.ts 원형)
  const monthlySendFilterClause = userType === 'company_user' && userId ? ' AND c.created_by = $2' : '';
  const monthlySendFilterParams: any[] = userType === 'company_user' && userId ? [companyId, userId] : [companyId];

  const [companyResult, monthlyMetaResult] = await Promise.all([
    // 단가 계산 입력 (표시 단가 축 — getCompanyCosts가 기준을 해석한다)
    query(
      `SELECT cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, unit_price_basis
         FROM companies WHERE id = $1`,
      [companyId],
    ),
    // 이번 달 채널별 발송 통계 메타 (취소/초안/예약 제외, 성공 건수 기준)
    // ★ D144: PG 캐시 의존 제거 — 캠페인 메타만 SELECT → 카운트 단일 진입점 → JS 합산.
    // ★ 2026-07-17: send_config(sentTables)·발송시각 동봉 — 집계가 실적재 테이블만 훑도록(집계 전용)
    query(
      `SELECT c.id, c.company_id, c.created_by, c.message_type,
              c.result_final, c.sent_count, c.success_count, c.fail_count,
              c.send_config, c.sent_at, c.scheduled_at, c.created_at
       FROM campaigns c
       WHERE c.company_id = $1
         AND c.status NOT IN ('cancelled', 'draft', 'scheduled')
         AND c.created_at >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'))::date::timestamp AT TIME ZONE 'Asia/Seoul'${monthlySendFilterClause}`,
      monthlySendFilterParams,
    ),
  ]);
  const company = companyResult.rows[0] || {};

  // ★ 2026-07-17(2) — 카운트 단일 진입점 합류: 확정(result_final) 캠페인 = PG 캐시, 진행 중만 MySQL 실시간.
  const monthlyCountMap = await getCampaignResultCounts(monthlyMetaResult.rows);

  // 채널별 집계 (성공 건수 기준으로 비용 계산)
  let smsSent = 0, lmsSent = 0, mmsSent = 0, kakaoSent = 0;
  let totalSent = 0, totalSuccess = 0, totalFail = 0;

  for (const c of monthlyMetaResult.rows) {
    const counts = monthlyCountMap.get(c.id) || { sent: 0, success: 0, fail: 0, pending: 0 };
    const success = counts.success;
    totalSent += counts.sent;
    totalSuccess += success;
    totalFail += counts.fail;

    switch (c.message_type) {
      case 'SMS': smsSent += success; break;
      case 'LMS': lmsSent += success; break;
      case 'MMS': mmsSent += success; break;
      case 'KAKAO': kakaoSent += success; break;
    }
  }

  // 월 사용금액 계산 (고객사 DB 단가 우선, 없으면 환경변수 기본단가)
  // ★ 2026-07-26 화면에 보이는 사용금액은 고객이 실제로 낼 금액(부가세 포함) — CT가 기준을 해석한다.
  const { sms: costSms, lms: costLms, mms: costMms, kakao: costKakao } = getCompanyCosts(company);

  let monthlyCost =
    smsSent * costSms +
    lmsSent * costLms +
    mmsSent * costMms +
    kakaoSent * costKakao;

  // ★ D79: 테스트발송 + 스팸필터 — 발송건수/성공률에서 제외, 사용금액만 요금제별 차등 포함
  // - 사용금액: 무료/스타터/베이직 → 포함 (유료), 프로 이상 → 미포함 (무료 제공)
  let testCost = 0;
  try {
    const planResult = await query(
      `SELECT p.plan_code FROM companies c JOIN plans p ON c.plan_id = p.id WHERE c.id = $1`,
      [companyId],
    );
    const planCode = (planResult.rows[0]?.plan_code || 'FREE').toUpperCase();
    const isProOrAbove = ['PRO', 'BUSINESS', 'ENTERPRISE'].includes(planCode);

    if (!isProOrAbove) {
      // ★ D100: balance_transactions 기반 테스트 비용 (테스트발송 차감 참조ID = 더미 UUID)
      const testCostFilter = userType === 'company_user' && userId ? ' AND created_by = $2' : '';
      const testCostParams: any[] = userType === 'company_user' && userId ? [companyId, userId] : [companyId];
      const testCostResult = await query(
        `SELECT COALESCE(SUM(amount), 0)::numeric as total
         FROM balance_transactions
         WHERE company_id = $1
           AND type = 'deduct'
           AND reference_id = '00000000-0000-0000-0000-000000000000'
           AND created_at >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'))::date::timestamp AT TIME ZONE 'Asia/Seoul'${testCostFilter}`,
        testCostParams,
      );
      testCost += parseFloat(testCostResult.rows[0]?.total ?? 0);

      // 스팸필터 비용 — spam_filter_tests JOIN으로 식별 (reference_type = 'campaign' 기본값이라)
      const sfCostFilter = userType === 'company_user' && userId ? ' AND bt.created_by = $2' : '';
      const sfCostParams: any[] = userType === 'company_user' && userId ? [companyId, userId] : [companyId];
      const sfCostResult = await query(
        `SELECT COALESCE(SUM(bt.amount), 0)::numeric as total
         FROM balance_transactions bt
         WHERE bt.company_id = $1
           AND bt.type = 'deduct'
           AND bt.reference_id IN (SELECT id FROM spam_filter_tests WHERE company_id = $1)
           AND bt.created_at >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'))::date::timestamp AT TIME ZONE 'Asia/Seoul'${sfCostFilter}`,
        sfCostParams,
      );
      testCost += parseFloat(sfCostResult.rows[0]?.total ?? 0);
    }
    // 프로 이상: testCost = 0 (무료 제공, 사용금액 미포함)
  } catch (testCostErr) {
    console.warn('[monthly-usage] 테스트/스팸필터 비용 조회 실패 (무시):', testCostErr);
  }
  monthlyCost += testCost;

  return {
    totalSent, totalSuccess, totalFail,
    smsSent, lmsSent, mmsSent, kakaoSent,
    monthlyCost,
    costs: { sms: costSms, lms: costLms, mms: costMms, kakao: costKakao },
  };
}
