/**
 * recipient-conversion.ts — 캠페인 **실수신자**의 발송 뒤 구매 귀속 (★ 2026-09-27 한줄로 V2 R093·R165)
 *
 * 옛: 발송 뒤 N일 창 안의 **회사 전체** 구매를 그 캠페인 성과로 잡았다(수신자 무관).
 *   발송이 없었어도 생겼을 매출이 캠페인·자동마케팅 몫이 되어, 분석·ROI가 부풀었다.
 * 이제: 발송 큐 원장(app_etc1 = 캠페인 id · 성공 코드만)의 실수신 번호와 구매 고객 번호가 같은 구매만 센다.
 *   - 수신자 명단 = readCampaignQueuedPhones(successOnly) — 리마인드 코호트·변화 축 마감과 같은 단일 문.
 *   - 명단을 못 읽은 캠페인은 0으로 넣지 않고 건너뛴다(0은 성과 없음의 증거가 아니다). 호출부가 "확인 못 함"을 표기한다.
 */
import { query } from '../config/database';
import { readCampaignQueuedPhones } from './continuous-operator';
import { kstFromNaiveUtc, kstDayStartNaiveUtc } from './stats-aggregation';

/** 캠페인 실수신(성공) 번호(숫자만). 캠페인 없음 = []. 발송 큐 조회 실패 = null. */
export async function recipientPhonesOfCampaign(companyId: string, campaignId: string): Promise<string[] | null> {
  const camp = await query(
    `SELECT send_config, created_by, COALESCE(sent_at, scheduled_at, created_at) AS ref_date
       FROM campaigns WHERE id = $1::uuid AND company_id = $2::uuid`,
    [campaignId, companyId],
  );
  if (camp.rows.length === 0) return [];
  try {
    return await readCampaignQueuedPhones(companyId, campaignId, camp.rows[0], { successOnly: true });
  } catch (e: any) {
    console.warn(`[recipient-conversion] 수신자 명단 조회 실패 (campaign ${campaignId}):`, e?.message);
    return null;
  }
}

export interface RunRecipientConversion {
  campaign_name: string;
  sent_at: any;
  sent_count: number;
  converted_customers: number;
  conversion_revenue: number;
}

/** 분석 구매 전환이 훑는 실행 수 — 실행마다 발송 큐를 읽으므로 최근 것부터 이만큼만. */
const RUN_SCAN_LIMIT = 30;

/**
 * 분석 기간 캠페인 실행(10건 이상 발송 · 최근 RUN_SCAN_LIMIT회)별 실수신자의 발송일 포함 7일 구매 → 매출 상위 10.
 * purchases.purchase_date는 KST 날짜(시각 없음)이고 campaign_runs.sent_at은 UTC 벽시계라(SCHEMA.md 시간 축 주의)
 * 발송 시각을 KST 날짜로 바꿔 날짜끼리 비교한다. 같은 날 발송 전 구매는 날짜만으로 가릴 수 없어 포함된다.
 */
export async function buildRecipientRunConversions(
  companyId: string,
  dateFrom: string,
  dateTo: string,
): Promise<{ rows: RunRecipientConversion[]; basis: string }> {
  const runs = await query(
    `SELECT cr.id AS run_id, c.id AS campaign_id, c.campaign_name, cr.sent_at, cr.sent_count
       FROM campaign_runs cr
       JOIN campaigns c ON cr.campaign_id = c.id
      WHERE c.company_id = $1
        AND cr.sent_at >= ${kstDayStartNaiveUtc('$2')}
        AND cr.sent_at < ${kstDayStartNaiveUtc('($3)::date + 1')}
        AND cr.sent_count >= 10
      ORDER BY cr.sent_at DESC
      LIMIT ${RUN_SCAN_LIMIT}`,
    [companyId, dateFrom, dateTo],
  );

  const phonesByCampaign = new Map<string, string[] | null>();
  let unreadableCampaigns = 0;
  const out: RunRecipientConversion[] = [];
  for (const r of runs.rows) {
    const campaignId = String(r.campaign_id);
    if (!phonesByCampaign.has(campaignId)) {
      const ph = await recipientPhonesOfCampaign(companyId, campaignId);
      phonesByCampaign.set(campaignId, ph);
      if (ph === null) unreadableCampaigns++;
    }
    const phones = phonesByCampaign.get(campaignId);
    if (phones === null || phones === undefined) continue;
    let converted = 0;
    let revenue = 0;
    if (phones.length > 0) {
      const conv = await query(
        `SELECT COUNT(DISTINCT m.phone)::int AS converted_customers,
                COALESCE(SUM(m.total_amount), 0)::float AS conversion_revenue
           FROM (
             SELECT regexp_replace(COALESCE(NULLIF(pu.customer_phone, ''), cu.phone, ''), '\\D', '', 'g') AS phone,
                    pu.total_amount
               FROM campaign_runs cr
               JOIN purchases pu ON pu.company_id = $1::uuid
                AND pu.purchase_date >= (${kstFromNaiveUtc('cr.sent_at')})::date::timestamp
                AND pu.purchase_date <  ((${kstFromNaiveUtc('cr.sent_at')})::date + 7)::timestamp
               LEFT JOIN customers cu ON cu.id = pu.customer_id
              WHERE cr.id = $2::uuid
           ) m
          WHERE m.phone = ANY($3::text[])`,
        [companyId, r.run_id, phones],
      );
      converted = Number(conv.rows[0]?.converted_customers) || 0;
      revenue = Number(conv.rows[0]?.conversion_revenue) || 0;
    }
    out.push({
      campaign_name: r.campaign_name,
      sent_at: r.sent_at,
      sent_count: Number(r.sent_count) || 0,
      converted_customers: converted,
      conversion_revenue: revenue,
    });
  }
  out.sort((a, b) => b.conversion_revenue - a.conversion_revenue);
  const basis = `실수신자(발송 성공 번호)의 발송일 포함 7일 구매 · 최근 ${runs.rows.length}회 실행 기준`
    + (unreadableCampaigns > 0 ? ` · 수신자 확인 못 한 캠페인 ${unreadableCampaigns}개 제외` : '');
  return { rows: out.slice(0, 10), basis };
}
