// packages/backend/src/routes/dashboard.ts
// ★ D222+ Phase 1 (2026-05-27): Dashboard DB 현황 5 부분 본격 구현 — endpoint 4건
//   - GET /customer-trend?days=30   : 30일 추이 시계열 + 미니 metric 4 (전체/동의/거부/활성도) 델타
//   - GET /customer-distribution    : 등급 분포 (donut chart 1) + 채널 분포 (donut chart 2)
//   - GET /ai-insight               : AI 인사이트 + 1-click 액션 (이탈 위험 + 휴면 + VIP)
//   - GET /cohort-retention?months=6: 가입월별 잔존율 매트릭스 (6 cohort × 6 month)
//
// ★ D222+ Phase 1 후속 정정 (2026-05-27):
//   - Fix #1: store-scope 적용 (브랜드 회사 정보 격리 보안)
//   - Fix #2: req.user 타입 활용 (`(req as any).user` → `req.user`)
//   - Fix #3: pctDelta Number 변환 정리 (가독성)
import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { getStoreScope } from '../utils/store-scope';

const router = Router();
router.use(authenticate);

// 등급 분포 색상 매핑 (frontend 매핑 정합 — violet 톤 통일)
const TIER_COLORS = ['#8b5cf6', '#d946ef', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#a855f7'];

/**
 * GET /api/dashboard/customer-trend?days=30
 * N일 추이 시계열 (line chart) + 직전 N일 대비 ±% 델타
 */
router.get('/customer-trend', async (req: Request, res: Response) => {
  const days = Math.min(Number(req.query.days) || 30, 90);
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  const userType = req.user?.userType;
  if (!companyId) {
    return res.status(401).json({ error: '인증 필요' });
  }

  try {
    // ★ B16-01: 브랜드(store_code) 격리 — store-scope 컨트롤타워 사용
    //   - company_admin/super_admin = 전체 회사 영역 (격리 X)
    //   - company_user + filtered = customer_stores 조인 격리
    //   - company_user + blocked = 빈 응답 즉시 반환
    let storeFilter = '';
    const params: any[] = [companyId, days];

    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'blocked') {
        return res.json({
          success: true,
          trend: [],
          deltas: {
            totalDelta30: null,
            optInDelta30: null,
            optOutDelta30: null,
            activeRateDelta30: null,
          },
        });
      }
      if (scope.type === 'filtered') {
        storeFilter = ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($3::text[]))`;
        params.push(scope.storeCodes);
      }
      // scope.type === 'no_filter' → 필터 없이 company_id 전체 (기존대로)
    }

    // 일별 추이 (SMS 동의 + 수신거부 단일 컬럼)
    const trendR = await query(
      `SELECT
         date_trunc('day', created_at)::date::text AS date,
         COUNT(*)::int                              AS total,
         COUNT(*) FILTER (WHERE sms_opt_in = true)::int AS "optIn",
         COUNT(*) FILTER (WHERE is_opt_out = true)::int AS "optOut"
       FROM customers
       WHERE company_id = $1
         AND is_active = true
         AND created_at >= NOW() - ($2 || ' days')::INTERVAL
         ${storeFilter}
       GROUP BY 1
       ORDER BY 1`,
      params
    );

    // 델타 계산 — 직전 N일 vs 그 이전 N일
    const deltaR = await query(
      `WITH cur AS (
         SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE sms_opt_in = true)::int AS opt_in,
           COUNT(*) FILTER (WHERE is_opt_out = true)::int AS opt_out
         FROM customers
         WHERE company_id = $1
           AND is_active = true
           AND created_at >= NOW() - ($2 || ' days')::INTERVAL
           ${storeFilter}
       ),
       prev AS (
         SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE sms_opt_in = true)::int AS opt_in,
           COUNT(*) FILTER (WHERE is_opt_out = true)::int AS opt_out
         FROM customers
         WHERE company_id = $1
           AND is_active = true
           AND created_at >= NOW() - ($2 || ' days')::INTERVAL * 2
           AND created_at <  NOW() - ($2 || ' days')::INTERVAL
           ${storeFilter}
       )
       SELECT
         cur.total AS cur_total, prev.total AS prev_total,
         cur.opt_in AS cur_opt_in, prev.opt_in AS prev_opt_in,
         cur.opt_out AS cur_opt_out, prev.opt_out AS prev_opt_out
       FROM cur, prev`,
      params
    );

    const d = deltaR.rows[0] || {};

    // 한 번 변환 후 재사용 (null 안전 fallback 동시)
    const curTotal = Number(d.cur_total ?? 0);
    const prevTotal = Number(d.prev_total ?? 0);
    const curOptIn = Number(d.cur_opt_in ?? 0);
    const prevOptIn = Number(d.prev_opt_in ?? 0);
    const curOptOut = Number(d.cur_opt_out ?? 0);
    const prevOptOut = Number(d.prev_opt_out ?? 0);

    const pctDelta = (cur: number, prev: number): number | null =>
      prev > 0 ? Number(((cur - prev) / prev * 100).toFixed(1)) : null;

    const deltas: {
      totalDelta30: number | null;
      optInDelta30: number | null;
      optOutDelta30: number | null;
      activeRateDelta30: number | null;
    } = {
      totalDelta30: pctDelta(curTotal, prevTotal),
      optInDelta30: pctDelta(curOptIn, prevOptIn),
      optOutDelta30: pctDelta(curOptOut, prevOptOut),
      activeRateDelta30: null,
    };

    // 활성도 (옵트인 / 전체) 델타 — %p 단위
    if (curTotal > 0 && prevTotal > 0) {
      const curRate = curOptIn / curTotal * 100;
      const prevRate = prevOptIn / prevTotal * 100;
      deltas.activeRateDelta30 = Number((curRate - prevRate).toFixed(1));
    }

    res.json({ success: true, trend: trendR.rows, deltas });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 ALTER 실행 요청 의무',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('[dashboard/customer-trend] 조회 오류:', err);
    res.status(500).json({ success: false, error: err.message || '추이 조회 실패' });
  }
});

/**
 * GET /api/dashboard/customer-distribution
 * 등급 분포 (donut chart 1) + 채널 분포 (donut chart 2)
 * — D222+ Phase 1 정정: channels 영역 추가 (SMS 동의 / 비동의 / 수신거부 3 영역)
 */
router.get('/customer-distribution', async (req: Request, res: Response) => {
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  const userType = req.user?.userType;
  if (!companyId) {
    return res.status(401).json({ error: '인증 필요' });
  }

  try {
    // ★ B16-01: 브랜드(store_code) 격리 — store-scope 컨트롤타워 사용
    let storeFilter = '';
    const params: any[] = [companyId];

    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'blocked') {
        return res.json({ success: true, tiers: [], channels: [] });
      }
      if (scope.type === 'filtered') {
        storeFilter = ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($2::text[]))`;
        params.push(scope.storeCodes);
      }
      // scope.type === 'no_filter' → 필터 없이 company_id 전체 (기존대로)
    }

    // 등급 분포 (NULL/빈 값 = '미분류' 통합)
    const tiersR = await query(
      `SELECT
         COALESCE(NULLIF(grade, ''), '미분류') AS label,
         COUNT(*)::int AS value
       FROM customers
       WHERE company_id = $1 AND is_active = true
         ${storeFilter}
       GROUP BY 1
       ORDER BY 2 DESC
       LIMIT 8`,
      params
    );

    // ★ D222+ Phase 1: 채널 분포 (SMS 동의 / 비동의 / 수신거부 3 영역)
    const channelsR = await query(
      `SELECT
         SUM(CASE WHEN sms_opt_in = true AND is_opt_out = false THEN 1 ELSE 0 END)::int AS opt_in,
         SUM(CASE WHEN sms_opt_in = false AND is_opt_out = false THEN 1 ELSE 0 END)::int AS opt_out_implicit,
         SUM(CASE WHEN is_opt_out = true THEN 1 ELSE 0 END)::int AS opt_out_explicit
       FROM customers
       WHERE company_id = $1 AND is_active = true
         ${storeFilter}`,
      params
    );

    const ch = channelsR.rows[0] || {};
    const channels = [
      { label: 'SMS 동의', value: Number(ch.opt_in ?? 0), color: '#10b981' },
      { label: 'SMS 비동의', value: Number(ch.opt_out_implicit ?? 0), color: '#94a3b8' },
      { label: '수신거부', value: Number(ch.opt_out_explicit ?? 0), color: '#ef4444' },
    ].filter((c) => c.value > 0);

    res.json({
      success: true,
      tiers: tiersR.rows.map((r: any, i: number) => ({
        label: r.label,
        value: Number(r.value),
        color: TIER_COLORS[i % TIER_COLORS.length],
      })),
      channels,
    });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 ALTER 실행 요청 의무',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('[dashboard/customer-distribution] 조회 오류:', err);
    res.status(500).json({ success: false, error: err.message || '분포 조회 실패' });
  }
});

/**
 * GET /api/dashboard/ai-insight
 * AI 인사이트 카드 (1-click 액션) — 단순 SQL 영역 (AI 호출 X)
 * 3 인사이트 자동 분석:
 *  - 이탈 위험 고객 (90일+ 미접속 + SMS 동의)
 *  - 휴면 회수 후보 (180일+ 미접속)
 *  - VIP 회복 후보 (등급 VIP/Gold + 60일+ 미접속)
 */
router.get('/ai-insight', async (req: Request, res: Response) => {
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  const userType = req.user?.userType;
  if (!companyId) {
    return res.status(401).json({ error: '인증 필요' });
  }

  try {
    let storeFilter = '';
    const params: any[] = [companyId];

    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'blocked') {
        return res.json({ success: true, insights: [] });
      }
      if (scope.type === 'filtered') {
        storeFilter = ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($2::text[]))`;
        params.push(scope.storeCodes);
      }
    }

    // 3 인사이트 동시 분석 (단일 쿼리)
    const r = await query(
      `SELECT
         SUM(CASE WHEN sms_opt_in = true AND is_opt_out = false
                       AND last_login_at < NOW() - INTERVAL '90 days'
                       AND last_login_at >= NOW() - INTERVAL '180 days'
                  THEN 1 ELSE 0 END)::int AS churn_risk,
         SUM(CASE WHEN sms_opt_in = true AND is_opt_out = false
                       AND last_login_at < NOW() - INTERVAL '180 days'
                  THEN 1 ELSE 0 END)::int AS dormant,
         SUM(CASE WHEN sms_opt_in = true AND is_opt_out = false
                       AND grade IN ('VIP', 'Gold', 'GOLD', 'vip', '골드')
                       AND last_login_at < NOW() - INTERVAL '60 days'
                  THEN 1 ELSE 0 END)::int AS vip_recover
       FROM customers
       WHERE company_id = $1 AND is_active = true
         ${storeFilter}`,
      params
    );

    const row = r.rows[0] || {};
    const insights = [
      {
        id: 'churn_risk',
        priority: 1,
        type: 'critical',
        title: '이탈 위험 고객',
        count: Number(row.churn_risk ?? 0),
        description: '90일 이상 미접속 + SMS 동의 고객 — 즉시 재참여 메시지 발송 권장',
        oneClickObjective: '90일 이상 미접속 SMS 동의 고객에게 재참여 메시지 보내기',
        accentColor: 'rose',
      },
      {
        id: 'dormant',
        priority: 2,
        type: 'warning',
        title: '휴면 회수 후보',
        count: Number(row.dormant ?? 0),
        description: '180일 이상 미접속 — 휴면 회수 캠페인 진행 권장',
        oneClickObjective: '180일 이상 휴면 고객에게 복귀 인사 메시지 보내기',
        accentColor: 'amber',
      },
      {
        id: 'vip_recover',
        priority: 3,
        type: 'opportunity',
        title: 'VIP 회복 후보',
        count: Number(row.vip_recover ?? 0),
        description: 'VIP/Gold 등급 + 60일 이상 미접속 — 우대 혜택 안내 권장',
        oneClickObjective: '60일 미접속 VIP 고객에게 우대 혜택 안내 보내기',
        accentColor: 'emerald',
      },
    ].filter((i) => i.count > 0);

    res.json({ success: true, insights });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 ALTER 실행 요청 의무',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('[dashboard/ai-insight] 조회 오류:', err);
    res.status(500).json({ success: false, error: err.message || '인사이트 조회 실패' });
  }
});

/**
 * GET /api/dashboard/cohort-retention?months=6
 * 가입월별 잔존율 매트릭스 (6 cohort × 6 month)
 * - 가로 = 가입 N개월 후 (M0 M1 M2 ... M5)
 * - 세로 = 가입월 (cohort)
 * - 값 = 해당 cohort 안 N개월 후 활성 고객 비율
 */
router.get('/cohort-retention', async (req: Request, res: Response) => {
  const months = Math.min(Number(req.query.months) || 6, 12);
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  const userType = req.user?.userType;
  if (!companyId) {
    return res.status(401).json({ error: '인증 필요' });
  }

  try {
    let storeFilter = '';
    const params: any[] = [companyId, months];

    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'blocked') {
        return res.json({ success: true, cohorts: [], months });
      }
      if (scope.type === 'filtered') {
        storeFilter = ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($3::text[]))`;
        params.push(scope.storeCodes);
      }
    }

    // cohort × month 매트릭스 — 가입월별 N개월 후 활성도 (last_login_at 기준)
    const r = await query(
      `WITH cohorts AS (
         SELECT
           id,
           date_trunc('month', created_at)::date AS cohort_month,
           created_at,
           last_login_at
         FROM customers
         WHERE company_id = $1 AND is_active = true
           AND created_at >= date_trunc('month', NOW() - ($2 || ' months')::INTERVAL)
           ${storeFilter}
       )
       SELECT
         cohort_month,
         COUNT(*)::int AS cohort_size,
         json_agg(json_build_object(
           'monthOffset', month_offset,
           'activeCount', active_count,
           'retentionRate', CASE WHEN cohort_size_count > 0
                                  THEN ROUND(active_count * 100.0 / cohort_size_count, 1)
                                  ELSE 0 END
         ) ORDER BY month_offset) AS retention
       FROM (
         SELECT
           c.cohort_month,
           gs.month_offset,
           COUNT(*) FILTER (
             WHERE c.last_login_at >= c.cohort_month + (gs.month_offset || ' months')::INTERVAL
               AND c.last_login_at <  c.cohort_month + ((gs.month_offset + 1) || ' months')::INTERVAL
           )::int AS active_count,
           COUNT(*) OVER (PARTITION BY c.cohort_month)::int AS cohort_size_count
         FROM cohorts c
         CROSS JOIN generate_series(0, $2::int - 1) AS gs(month_offset)
         GROUP BY c.cohort_month, gs.month_offset, c.id, c.last_login_at
       ) sub
       GROUP BY cohort_month
       ORDER BY cohort_month DESC
       LIMIT $2`,
      params
    );

    res.json({
      success: true,
      months,
      cohorts: r.rows.map((row: any) => ({
        cohortMonth: row.cohort_month,
        cohortSize: Number(row.cohort_size ?? 0),
        retention: row.retention || [],
      })),
    });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 ALTER 실행 요청 의무',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('[dashboard/cohort-retention] 조회 오류:', err);
    res.status(500).json({ success: false, error: err.message || 'cohort 조회 실패' });
  }
});

export default router;
