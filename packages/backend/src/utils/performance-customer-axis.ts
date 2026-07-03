/**
 * ★ CT: 성과리포트 고객 축(Customer Axis) — 전 채널 발송결과 × 고객 DB 매칭 (2026-07-03)
 *
 * 설계: docs/superpowers/specs/2026-07-03-performance-customer-axis-design.md
 * Harold 비전: "모든 경로의 발송결과가 하나로 묶였으니, 실제 고객 DB와 매칭해 보는 것이 성과리포트."
 *
 * 컬럼 검증 완료 (information_schema 2026-07-03 실측 — Harold 실행):
 *   journey_executions(id, journey_id, customer_id) / journey_step_logs(execution_id, sent_at, status, campaign_id)
 *   dm_recipient_tokens(token, dm_id, customer_id, company_id, created_at)
 *   dm_views(dm_id, company_id, recipient_token, viewed_at)
 *   email_campaigns(id, company_id, sent_at, sent_count, open_count, click_count)
 *   email_events(campaign_id, email, event_type, occurred_at)
 *   cdp_events(customer_id, event_name, occurred_at, properties, company_id) / customers(id, company_id, grade, email)
 *   — cdp_events·customers·campaigns.target_filter는 grade-conversion-stats CT 헤더 기존 검증분.
 *   journeys.company_id = 운영 쿼리 실사용(journey-executor.ts:161). customers.email = email-channel.ts:580 (LOWER 매칭).
 *
 * 성능 원칙 (D231 504 교훈):
 *   - 전 쿼리 company_id 격리 + 기간 필터 집계 SELECT만. self-join 0. 요청 경로 정제(DELETE/UPDATE) 0.
 *   - snapshot-v2에 얹지 않고 별도 endpoint(lazy load — 모달 열 때)로만 호출.
 *   - 매출 SUM은 EXISTS 매칭(JOIN 중복 계상 방지 — 한 고객이 기간 내 여러 번 수신해도 구매 이벤트는 1회만 합산).
 */

import { query } from '../config/database';
import {
  GradePerformanceRow,
  GradeComponents,
  mergeGradePerformance,
  toGradeCountMap,
} from './performance-customer-axis-core';

export type { GradePerformanceRow } from './performance-customer-axis-core';

const GRADE_EXPR = `COALESCE(NULLIF(TRIM(cu.grade), ''), '(미분류)')`;

/**
 * 등급 × 전 채널 성과 표.
 * 원천 라벨: 여정·DM = customer_id 정확 / 이메일 = 반응자(email 매칭) / SMS = target_filter 등급 근사.
 */
export async function buildGradePerformance(companyId: string, days: number): Promise<GradePerformanceRow[]> {
  const safe = async (label: string, fn: () => Promise<Array<{ grade: any; cnt: any }>>) => {
    try {
      return toGradeCountMap(await fn());
    } catch (e: any) {
      console.log(`[customer-axis] ${label} skip:`, e?.message || e);
      return toGradeCountMap([]);
    }
  };

  const [journeySent, dmSent, dmViewers, emailClickers, smsTargetedSent, purchaseRows] = await Promise.all([
    // 1) 여정 발송 (정확 — journey_step_logs → journey_executions.customer_id)
    safe('journeySent', async () => (await query(
      `SELECT ${GRADE_EXPR} AS grade, COUNT(*)::int AS cnt
         FROM journey_step_logs jsl
         JOIN journey_executions je ON je.id = jsl.execution_id
         JOIN journeys j ON j.id = je.journey_id
         JOIN customers cu ON cu.id = je.customer_id AND cu.company_id = $1::uuid
        WHERE j.company_id = $1::uuid
          AND jsl.status = 'sent'
          AND jsl.sent_at > NOW() - ($2 || ' days')::interval
        GROUP BY 1`,
      [companyId, days],
    )).rows),

    // 2) DM 수신 고객 (정확 — dm_recipient_tokens.customer_id)
    safe('dmSent', async () => (await query(
      `SELECT ${GRADE_EXPR} AS grade, COUNT(DISTINCT t.customer_id)::int AS cnt
         FROM dm_recipient_tokens t
         JOIN customers cu ON cu.id = t.customer_id AND cu.company_id = $1::uuid
        WHERE t.company_id = $1::uuid
          AND t.created_at > NOW() - ($2 || ' days')::interval
        GROUP BY 1`,
      [companyId, days],
    )).rows),

    // 3) DM 열람 고객 (정확 — dm_views.recipient_token → 토큰의 customer_id)
    safe('dmViewers', async () => (await query(
      `SELECT ${GRADE_EXPR} AS grade, COUNT(DISTINCT t.customer_id)::int AS cnt
         FROM dm_views v
         JOIN dm_recipient_tokens t ON t.token = v.recipient_token
         JOIN customers cu ON cu.id = t.customer_id AND cu.company_id = $1::uuid
        WHERE v.company_id = $1::uuid
          AND v.recipient_token IS NOT NULL
          AND v.viewed_at > NOW() - ($2 || ' days')::interval
        GROUP BY 1`,
      [companyId, days],
    )).rows),

    // 4) 이메일 클릭 고객 (반응자 기준 — 발송 명단 미보존이라 이벤트 email ↔ customers.email LOWER 매칭)
    safe('emailClickers', async () => (await query(
      `SELECT ${GRADE_EXPR} AS grade, COUNT(DISTINCT cu.id)::int AS cnt
         FROM email_events ev
         JOIN email_campaigns ec ON ec.id = ev.campaign_id
         JOIN customers cu ON cu.company_id = $1::uuid AND LOWER(cu.email) = LOWER(ev.email)
        WHERE ec.company_id = $1::uuid
          AND ev.event_type = 'click'
          AND ev.occurred_at > NOW() - ($2 || ' days')::interval
        GROUP BY 1`,
      [companyId, days],
    )).rows),

    // 5) SMS/카카오 캠페인 발송 합 (근사 — campaigns.target_filter grade. grade-conversion-stats 패턴)
    safe('smsTargetedSent', async () => (await query(
      `WITH grade_campaigns AS (
         SELECT gx.grade, c.sent_count
           FROM campaigns c
          CROSS JOIN LATERAL (
            SELECT CASE
              WHEN jsonb_typeof(c.target_filter->'grade'->'value') = 'array'
                THEN c.target_filter->'grade'->'value'
              WHEN c.target_filter->'grade'->>'value' IS NOT NULL
                THEN jsonb_build_array(c.target_filter->'grade'->'value')
              ELSE '[]'::jsonb
            END AS garr
          ) gv
          CROSS JOIN LATERAL jsonb_array_elements_text(gv.garr) AS gx(grade)
          WHERE c.company_id = $1::uuid
            AND c.status = 'completed'
            AND c.sent_at IS NOT NULL
            AND c.sent_at > NOW() - ($2 || ' days')::interval
       )
       SELECT COALESCE(NULLIF(TRIM(grade), ''), '(미분류)') AS grade,
              COALESCE(SUM(sent_count), 0)::int AS cnt
         FROM grade_campaigns
        GROUP BY 1`,
      [companyId, days],
    )).rows),

    // 6) 구매 고객·매출 (cdp_events — buyers/revenue 두 값이라 별도 처리)
    (async () => {
      try {
        return (await query(
          `SELECT ${GRADE_EXPR} AS grade,
                  COUNT(DISTINCT e.customer_id)::int AS buyers,
                  COALESCE(SUM((e.properties->>'total_amount')::numeric), 0)::float AS revenue
             FROM cdp_events e
             JOIN customers cu ON cu.id = e.customer_id AND cu.company_id = $1::uuid
            WHERE e.company_id = $1::uuid
              AND e.event_name IN ('purchase', 'order')
              AND e.customer_id IS NOT NULL
              AND e.occurred_at > NOW() - ($2 || ' days')::interval
            GROUP BY 1`,
          [companyId, days],
        )).rows as Array<{ grade: any; buyers: any; revenue: any }>;
      } catch (e: any) {
        console.log('[customer-axis] purchase skip:', e?.message || e);
        return [] as Array<{ grade: any; buyers: any; revenue: any }>;
      }
    })(),
  ]);

  const components: GradeComponents = {
    journeySent,
    dmSent,
    dmViewers,
    emailClickers,
    smsTargetedSent,
    buyers: toGradeCountMap(purchaseRows.map((r) => ({ grade: r.grade, cnt: r.buyers }))),
    revenue: toGradeCountMap(purchaseRows.map((r) => ({ grade: r.grade, cnt: r.revenue }))),
  };
  return mergeGradePerformance(components);
}

// ───────────────────────────────────────────────────────────
// 수신 고객 기준 정밀 attribution (여정 ∪ DM — customer_id 정확 매칭)
// ───────────────────────────────────────────────────────────

export interface RecipientAttributionWindow {
  windowLabel: string;   // '24h' / '7d' / '30d'
  windowHours: number;
  buyers: number;        // 수신 후 윈도우 내 구매한 수신 고객 수
  purchases: number;     // 그 구매 이벤트 수
  revenue: number;       // 그 구매 매출 합
}

export interface RecipientAttributionResult {
  totalRecipients: number;  // 기간 내 수신 고객 수 (여정 ∪ DM, distinct)
  windows: RecipientAttributionWindow[];
  computedAt: string;
  source: string;
}

/** 수신 고객 집합(여정·DM) CTE — 두 빌더가 공유 */
const RECIPIENTS_CTE = `
  WITH recip AS (
    SELECT je.customer_id, jsl.sent_at AS touched_at
      FROM journey_step_logs jsl
      JOIN journey_executions je ON je.id = jsl.execution_id
      JOIN journeys j ON j.id = je.journey_id
     WHERE j.company_id = $1::uuid
       AND jsl.status = 'sent'
       AND jsl.sent_at > NOW() - ($2 || ' days')::interval
    UNION ALL
    SELECT t.customer_id, t.created_at AS touched_at
      FROM dm_recipient_tokens t
     WHERE t.company_id = $1::uuid
       AND t.created_at > NOW() - ($2 || ' days')::interval
  )`;

/**
 * "발송받은 그 고객이 구매했나" — 수신 고객 ∩ cdp 구매 (수신 시각 후 윈도우).
 * 기존 buildCampaignAttribution(회사 전체 시간 윈도우)과 병기 — SMS 캠페인은 명단 미보존이라 거기가 커버.
 */
export async function buildRecipientAttribution(
  companyId: string,
  days: number,
): Promise<RecipientAttributionResult> {
  const recipientsResult = await query(
    `${RECIPIENTS_CTE}
     SELECT COUNT(DISTINCT customer_id)::int AS total FROM recip`,
    [companyId, days],
  );
  const totalRecipients = Number(recipientsResult.rows[0]?.total) || 0;

  const windows: RecipientAttributionWindow[] = [];
  const windowDefs = [
    { label: '24h', hours: 24 },
    { label: '7d', hours: 168 },
    { label: '30d', hours: 720 },
  ];

  for (const w of windowDefs) {
    if (totalRecipients === 0) {
      windows.push({ windowLabel: w.label, windowHours: w.hours, buyers: 0, purchases: 0, revenue: 0 });
      continue;
    }
    // EXISTS 매칭 — 한 고객 다회 수신이어도 구매 이벤트는 1회만 계상 (JOIN 중복 방지)
    const r = await query(
      `${RECIPIENTS_CTE}
       SELECT COUNT(*)::int AS purchases,
              COUNT(DISTINCT e.customer_id)::int AS buyers,
              COALESCE(SUM((e.properties->>'total_amount')::numeric), 0)::float AS revenue
         FROM cdp_events e
        WHERE e.company_id = $1::uuid
          AND e.event_name IN ('purchase', 'order')
          AND e.customer_id IS NOT NULL
          AND e.occurred_at > NOW() - ($3 || ' days')::interval
          AND EXISTS (
            SELECT 1 FROM recip r
             WHERE r.customer_id = e.customer_id
               AND e.occurred_at >= r.touched_at
               AND e.occurred_at <= r.touched_at + ($4 || ' hours')::interval
          )`,
      [companyId, days, days + 30, w.hours],
    );
    windows.push({
      windowLabel: w.label,
      windowHours: w.hours,
      purchases: Number(r.rows[0]?.purchases) || 0,
      buyers: Number(r.rows[0]?.buyers) || 0,
      revenue: Number(r.rows[0]?.revenue) || 0,
    });
  }

  return {
    totalRecipients,
    windows,
    computedAt: new Date().toISOString(),
    source: '여정(journey_step_logs)·DM(dm_recipient_tokens) 수신 고객 ∩ cdp_events 구매 (customer_id 정확 매칭)',
  };
}
