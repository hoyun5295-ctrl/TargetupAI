// 풀분석 데이터 수집 호출부 — campaigns/customers/companies SELECT 후 순수 코어 호출.
// 순수 계산은 multidim-comparison/message-analysis/forecast/message-byte(전부 TDD). 여기는 DB SELECT + 매핑만.
// 기간 필터 = 발송일 기준 COALESCE(scheduled_at, sent_at)(2026-06-08 통일) + 발송 완료분(sent_at IS NOT NULL).
import { query } from '../config/database';
import { resolveChargeUnitPrice } from './unit-price';
import { computeTypeComparison, computeNewVsExisting, type TypeComparison, type NewVsExistingResult } from './multidim-comparison';
import { computeMessageTypePerformance, computeLengthDistribution, type MessageTypePerf, type LengthBucket } from './message-analysis';
import { computeSendTrendForecast, computeMissedOpportunity, type TrendForecast, type MissedOpportunity } from './forecast';
import { eucKrByteLength } from './message-byte';
import type { RfmSegment } from './rfm-segment';

const PERIOD_DAYS: Record<string, number> = { '7d': 7, '14d': 14, '30d': 30, '90d': 90 };
function periodDays(period: string): number {
  return PERIOD_DAYS[period] || 30;
}

export interface MultiDimComparison {
  byType: TypeComparison[];
  newVsExisting: NewVsExistingResult;
}

/** 다차원 비교 — send_type 유형별 성과 + 기간 내 신규/기존 고객 구성. */
export async function buildMultiDimComparison(companyId: string, period: string, nowMs: number): Promise<MultiDimComparison> {
  const days = periodDays(period);
  const typeRes = await query(
    `SELECT send_type,
            COALESCE(SUM(success_count + fail_count), 0) AS sent,
            COALESCE(SUM(success_count), 0) AS success
     FROM campaigns
     WHERE company_id = $1::uuid
       AND sent_at IS NOT NULL
       AND COALESCE(scheduled_at, sent_at) > NOW() - ($2 || ' days')::interval
     GROUP BY send_type`,
    [companyId, String(days)],
  );
  const byType = computeTypeComparison(
    typeRes.rows.map((r: any) => ({ sendType: r.send_type, sent: Number(r.sent) || 0, success: Number(r.success) || 0 })),
  );
  const custRes = await query(
    `SELECT created_at FROM customers WHERE company_id = $1::uuid AND is_active = true`,
    [companyId],
  );
  const periodStartMs = nowMs - days * 86400000;
  const newVsExisting = computeNewVsExisting(
    custRes.rows.map((c: any) => ({ createdAtMs: c.created_at ? new Date(c.created_at).getTime() : null })),
    periodStartMs,
  );
  return { byType, newVsExisting };
}

export interface MessageAnalysis {
  byType: MessageTypePerf[];
  lengthDist: LengthBucket[];
}

/** 메시지 분석 — message_type 유형별 성과(단가 주입) + 본문 byte 길이 분포. */
export async function buildMessageAnalysis(companyId: string, period: string): Promise<MessageAnalysis> {
  const days = periodDays(period);
  const res = await query(
    `SELECT message_type,
            COALESCE(SUM(success_count + fail_count), 0) AS sent,
            COALESCE(SUM(success_count), 0) AS success
     FROM campaigns
     WHERE company_id = $1::uuid
       AND sent_at IS NOT NULL
       AND COALESCE(scheduled_at, sent_at) > NOW() - ($2 || ' days')::interval
     GROUP BY message_type`,
    [companyId, String(days)],
  );
  const costRes = await query(
    `SELECT cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, unit_price_basis FROM companies WHERE id = $1::uuid`,
    [companyId],
  );
  const c = costRes.rows[0] || {};
  // 단가가 0/null이면 costMap에 넣지 않는다 → 순수 코어가 비용을 null(데이터부족)로 둔다. 임의 fallback 상수 금지.
  const costMap: Record<string, number> = {};
  // ★ 2026-07-26 부가세 포함가로 환산(고객이 실제로 내는 금액). 미설정·0은 그대로 제외한다.
  for (const t of ['SMS', 'LMS', 'MMS', 'KAKAO'] as const) {
    const v = resolveChargeUnitPrice(c, t);
    if (v > 0) costMap[t] = v;
  }
  const byType = computeMessageTypePerformance(
    res.rows.map((r: any) => ({ messageType: r.message_type, sent: Number(r.sent) || 0, success: Number(r.success) || 0 })),
    costMap,
  );
  const lenRes = await query(
    `SELECT message_content FROM campaigns
     WHERE company_id = $1::uuid AND sent_at IS NOT NULL
       AND COALESCE(scheduled_at, sent_at) > NOW() - ($2 || ' days')::interval
       AND message_content IS NOT NULL AND message_content <> ''`,
    [companyId, String(days)],
  );
  const lengthDist = computeLengthDistribution(lenRes.rows.map((r: any) => eucKrByteLength(String(r.message_content || ''))));
  return { byType, lengthDist };
}

export interface ForecastResult {
  trend: TrendForecast;
  missed: MissedOpportunity;
}

/** 예측·기회 — 일별 발송량 시계열 추세 + RFM 이탈위험/휴면 규모(놓친 기회). */
export async function buildForecast(companyId: string, period: string, rfmSegments: RfmSegment[]): Promise<ForecastResult> {
  const days = periodDays(period);
  const res = await query(
    `SELECT (COALESCE(scheduled_at, sent_at) AT TIME ZONE 'Asia/Seoul')::date AS d,
            COALESCE(SUM(success_count + fail_count), 0) AS sent
     FROM campaigns
     WHERE company_id = $1::uuid
       AND sent_at IS NOT NULL
       AND COALESCE(scheduled_at, sent_at) > NOW() - ($2 || ' days')::interval
     GROUP BY d ORDER BY d`,
    [companyId, String(days)],
  );
  const dailySeries = res.rows.map((r: any) => Number(r.sent) || 0);
  const trend = computeSendTrendForecast(dailySeries);
  const missed = computeMissedOpportunity(rfmSegments);
  return { trend, missed };
}
