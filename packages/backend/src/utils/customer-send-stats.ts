/**
 * customer-send-stats.ts — 고객별 발송 누적 카운터 CT (2026-07-03 Gap5 Layer2)
 *
 * 목적: 예측(predictive-suite)의 분모 total_sent가 여정(journey_step_logs)만 집계해
 *   직접발송·DM·자동마케팅만 쓰는 회사가 영원히 cold-start에 머무는 구멍을 메운다.
 *   고객당 1행 카운터(customer_send_stats) — 이벤트 적재가 아니라 행 수가 고객 수로 상한.
 *
 * 원칙:
 *   - ⚠️ 발송 경로 무영향: 발송 커밋 후 fire-and-forget(미await)로만 호출. 실패=경고 로그뿐.
 *   - 멱등: campaign_ref 마커(customer_send_stats_marks) — 재시도/중복 호출이 카운터를 두 번 올리지 않는다.
 *   - 호출 대상 = customer_id가 확정된 발송만(직접발송 고객DB 타겟·DM 타겟발송·자동마케팅).
 *     여정은 journey_step_logs가 이미 집계하므로 호출하지 않는다(중복 0).
 *     이메일은 클릭 분자(cdp_events message_click)와 결이 달라 제외(분자·분모 일관성).
 *   - 예측은 추천·표시·send-time 전용 — 이 카운터가 발송 대상 선정에 쓰이는 일은 없다
 *     (feedback_prediction_never_selects_target).
 *
 * 소비처: predictive-suite.ts (total_sent = 여정 + 본 카운터 합산, TS·벌크 SQL 두 벌 동일).
 */
import { query } from '../config/database';
import { buildJourneySafetyFilter } from './journey-safety-filter';

const BATCH = 5000;

export async function recordCustomerSends(input: {
  companyId: string;
  /** 캠페인 멱등 키 (예: campaignId, `dm:{campaignId}`) — 같은 키 재호출 = no-op */
  campaignRef: string;
  customerIds: string[];
}): Promise<void> {
  try {
    const ids = Array.from(new Set((input.customerIds || []).map((v) => String(v || '').trim()).filter(Boolean)));
    if (!input.companyId || !input.campaignRef || ids.length === 0) return;

    // 1) 캠페인 멱등 마커 — 이미 집계된 캠페인이면 종료 (재시도 중복 카운트 차단)
    const mark = await query(
      `INSERT INTO customer_send_stats_marks (campaign_ref, company_id)
       VALUES ($1, $2::uuid)
       ON CONFLICT (campaign_ref) DO NOTHING
       RETURNING campaign_ref`,
      [input.campaignRef.slice(0, 120), input.companyId],
    );
    if (mark.rows.length === 0) return;

    // 2) 고객당 +1 UPSERT (배치) — customers 존재·자사 소속 검증을 SELECT로 겸함(FK 에러·타사 오염 차단)
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      await query(
        `INSERT INTO customer_send_stats (customer_id, company_id, total_sent, last_sent_at, updated_at)
         SELECT c.id, $1::uuid, 1, NOW(), NOW()
           FROM customers c
          WHERE c.company_id = $1::uuid AND c.id = ANY($2::uuid[])
         ON CONFLICT (customer_id) DO UPDATE SET
           total_sent = customer_send_stats.total_sent + 1,
           last_sent_at = NOW(),
           updated_at = NOW()`,
        [input.companyId, batch],
      );
    }
  } catch (err: any) {
    // 실패해도 발송·응답 무영향 — 예측 분모만 일시적으로 적게 잡힐 뿐(advisory 우아한 열화)
    console.warn('[send-stats] 고객별 발송 카운터 적재 실패 (발송 무영향):', err?.message);
  }
}

/**
 * 필터 기반 서버사이드 변형 — 발송 대상 id를 Node로 안 들고오고(대량 안전), 동일 안전필터 where로
 *   customers에서 직접 customer_send_stats에 +1 UPSERT 한다. 자동마케팅 서버사이드 staging 적재와 짝.
 *   where 배치: companyId=$1, filterParams=$2+, (excludeClickedSince). 안전필터·미클릭가드는 발송 추출과 동일.
 *   ⚠️ recordCustomerSends와 동일하게 발송 커밋 후 fire-and-forget(미await), 실패=경고뿐, campaignRef 멱등.
 */
export async function recordCustomerSendsByFilter(input: {
  companyId: string;
  campaignRef: string;
  filterWhere: string;
  filterParams: any[];
  storeFilter?: string;
  excludeClickedSince?: Date | null;
}): Promise<void> {
  try {
    if (!input.companyId || !input.campaignRef) return;

    // 1) 캠페인 멱등 마커 — 이미 집계된 캠페인이면 종료 (재시도 중복 카운트 차단)
    const mark = await query(
      `INSERT INTO customer_send_stats_marks (campaign_ref, company_id)
       VALUES ($1, $2::uuid)
       ON CONFLICT (campaign_ref) DO NOTHING
       RETURNING campaign_ref`,
      [input.campaignRef.slice(0, 120), input.companyId],
    );
    if (mark.rows.length === 0) return;

    // 2) 발송 대상(동일 안전필터 where) 고객당 +1 — 서버사이드 SELECT-INSERT (customers 자사 소속 검증 겸함)
    const params: any[] = [input.companyId, ...input.filterParams];
    let clickGuard = '';
    if (input.excludeClickedSince) {
      params.push(input.excludeClickedSince);
      clickGuard =
        `AND NOT EXISTS (SELECT 1 FROM cdp_events ce WHERE ce.customer_id = c.id AND ce.company_id = $1 AND ce.event_name = 'message_click' AND ce.occurred_at >= $${params.length})`;
    }
    await query(
      `INSERT INTO customer_send_stats (customer_id, company_id, total_sent, last_sent_at, updated_at)
       SELECT c.id, $1::uuid, 1, NOW(), NOW()
         FROM customers c
        WHERE c.company_id = $1::uuid
          AND ${buildJourneySafetyFilter('c')}
          ${input.storeFilter || ''}
          ${input.filterWhere}
          ${clickGuard}
       ON CONFLICT (customer_id) DO UPDATE SET
         total_sent = customer_send_stats.total_sent + 1,
         last_sent_at = NOW(),
         updated_at = NOW()`,
      params,
    );
  } catch (err: any) {
    console.warn('[send-stats] 필터 기반 발송 카운터 적재 실패 (발송 무영향):', err?.message);
  }
}
