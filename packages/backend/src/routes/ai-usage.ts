/**
 * D217+ AI 사용량 강화 — 신규 endpoint 4건 (2026-05-25)
 *
 * 옛 endpoint /api/ai/usage = routes/ai.ts:3313 그대로 유지 (legacy 호환).
 * 본 파일 = Journey Builder 동급 8 화면 강화에 필요한 신규 endpoint:
 *   - GET  /api/ai-usage/overview         — 5 metric + 자율 진단 한 줄 (이번 달 / Cache / 모델 분포 / Batch / 전월 대비)
 *   - GET  /api/ai-usage/forecast         — 향후 30일 예측 (옛 30일 선형 회귀)
 *   - POST /api/ai-usage/search-natural   — 자연어 질문 → AI 답변 (호출 데이터 근거)
 *   - POST /api/ai-usage/threshold-alert  — 한도 알림 임계값 + 채널 설정 (companies.ai_usage_threshold_config)
 *
 * DB 의존:
 *   - ai_call_log (회사별 월/일 호출 + 모델 + 비용)
 *   - companies.ai_usage_threshold_config jsonb (D217+ 신규 ALTER 의무)
 *   - plans.ai_calls_per_month (월 한도)
 *   - ai_batch_jobs (Batch 처리 건수)
 */

import { Request, Response, Router } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { callAIWithFallback } from '../services/ai';
import { getMonthlyUsage, getDailyUsage, getModelBreakdown } from '../utils/ai-rate-limit';
import { getCacheStats } from '../utils/ai-cache';

const router = Router();
router.use(authenticate);

// ════════════════════════════════════════════════════════════════════
// 헬퍼 — 모델 추상 명칭 (UI 노출 시 모델명 차단 정합)
// ════════════════════════════════════════════════════════════════════

function abstractModelLabel(modelType: string): string {
  switch (modelType) {
    case 'opus':         return '고급 추론 모드';
    case 'sonnet':       return '표준 추론 모드';
    case 'gpt-fallback': return '보조 추론 모드';
    default:             return modelType;
  }
}

// ════════════════════════════════════════════════════════════════════
// 1. GET /api/ai-usage/overview — 5 metric + 자율 진단
// ════════════════════════════════════════════════════════════════════

router.get('/overview', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }

    const [monthly, daily, breakdown] = await Promise.all([
      getMonthlyUsage(companyId),
      getDailyUsage(companyId, 30),
      getModelBreakdown(companyId, 30),
    ]);
    const cache = getCacheStats();

    // 모델별 호출 집계 (추상 명칭 매핑)
    const modelTotals: Record<string, { count: number; cost: number }> = {};
    for (const b of breakdown) {
      const key = b.modelType;
      if (!modelTotals[key]) modelTotals[key] = { count: 0, cost: 0 };
      modelTotals[key].count += b.count;
      modelTotals[key].cost += b.cost;
    }
    const modelDistribution = Object.entries(modelTotals).map(([modelType, v]) => ({
      modelType,
      label: abstractModelLabel(modelType),
      count: v.count,
      cost: v.cost,
    })).sort((a, b) => b.count - a.count);

    // 일평균 + 한도 도달 예상일 (선형 추정)
    const dailyAvg = daily.length > 0 ? daily.reduce((s, d) => s + d.count, 0) / daily.length : 0;
    let predictedDaysToLimit: number | null = null;
    if (monthly.limit !== null && monthly.limit > 0 && dailyAvg > 0) {
      const remaining = Math.max(0, monthly.limit - monthly.used);
      predictedDaysToLimit = Math.floor(remaining / dailyAvg);
    }

    // 전월 대비 격차
    const prevMonthRes = await query(
      `SELECT COUNT(*)::int AS cnt
       FROM ai_call_log
       WHERE company_id = $1::uuid
         AND called_at >= (date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') - INTERVAL '1 month') AT TIME ZONE 'Asia/Seoul'
         AND called_at <  date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'`,
      [companyId],
    );
    const prevMonthCalls = Number(prevMonthRes.rows[0]?.cnt) || 0;
    const prevMonthDeltaPercent = prevMonthCalls > 0
      ? Math.round(((monthly.used - prevMonthCalls) / prevMonthCalls) * 100)
      : null;

    // Batch 처리 건수 (옛 ai_batch_jobs 안 30일)
    let batchCalls = 0;
    try {
      const batchRes = await query(
        `SELECT COALESCE(SUM(succeeded_count), 0)::int AS total
         FROM ai_batch_jobs
         WHERE company_id = $1::uuid
           AND submitted_at >= NOW() - INTERVAL '30 days'`,
        [companyId],
      );
      batchCalls = Number(batchRes.rows[0]?.total) || 0;
    } catch {
      batchCalls = 0;
    }

    // 한도 알림 설정 (companies.ai_usage_threshold_config)
    let thresholdConfig: Record<string, unknown> = {};
    try {
      const cfgRes = await query(
        `SELECT COALESCE(ai_usage_threshold_config, '{}'::jsonb) AS config
         FROM companies WHERE id = $1::uuid LIMIT 1`,
        [companyId],
      );
      thresholdConfig = cfgRes.rows[0]?.config || {};
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('column') && msg.includes('does not exist')) {
        thresholdConfig = { _migration_pending: true };
      }
    }

    // 진단 한 줄
    const monthlyPercent = monthly.limit !== null && monthly.limit > 0
      ? Math.round((monthly.used / monthly.limit) * 100)
      : 0;
    let topInsight = '';
    if (monthly.limit === null) {
      topInsight = `이번 달 ${monthly.used.toLocaleString()}회 호출. 무제한 요금제 사용 중입니다. cache 히트율 ${(cache.hitRate * 100).toFixed(1)}% 로 비용을 절감하고 있습니다.`;
    } else if (monthlyPercent >= 95) {
      topInsight = `한도 ${monthlyPercent}% 도달. 곧 AI 호출이 차단됩니다. Batch 처리 모드 전환 또는 요금제 업그레이드를 권장합니다.`;
    } else if (monthlyPercent >= 80) {
      topInsight = `한도 ${monthlyPercent}% 사용. ${predictedDaysToLimit !== null ? `약 ${predictedDaysToLimit}일 후 한도 도달 예상` : '주의 필요'}. 한도 알림 설정을 권장합니다.`;
    } else if (cache.hitRate >= 0.3) {
      topInsight = `한도 ${monthlyPercent}% 사용 중. cache 히트율 ${(cache.hitRate * 100).toFixed(1)}% 로 효율적으로 운영되고 있습니다.`;
    } else if (monthly.used > 100 && cache.hitRate < 0.1) {
      topInsight = `한도 ${monthlyPercent}% 사용. cache 히트율 ${(cache.hitRate * 100).toFixed(1)}% 가 낮습니다. 자연어 질문 반복 시 5분 내 동일 입력은 자동 cache 되므로 비용 절감 가능합니다.`;
    } else {
      topInsight = `이번 달 ${monthly.used.toLocaleString()}회 호출. 한도 ${monthlyPercent}% 사용 중입니다.`;
    }

    return res.json({
      success: true,
      monthly_calls: monthly.used,
      monthly_limit: monthly.limit,
      monthly_percent: monthlyPercent,
      daily_avg: Math.round(dailyAvg * 10) / 10,
      predicted_days_to_limit: predictedDaysToLimit,
      cache_hit_rate: cache.hitRate,
      cache_size: cache.size,
      cache_hit: cache.hit,
      cache_miss: cache.miss,
      model_distribution: modelDistribution,
      batch_calls: batchCalls,
      prev_month_calls: prevMonthCalls,
      prev_month_delta_percent: prevMonthDeltaPercent,
      threshold_config: thresholdConfig,
      top_insight: topInsight,
    });
  } catch (err: any) {
    console.error('[AI Usage overview] 오류:', err);
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요: 운영자에게 companies ALTER (ai_usage_threshold_config jsonb) 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// 2. GET /api/ai-usage/forecast — 향후 30일 예측 (선형 회귀)
// ════════════════════════════════════════════════════════════════════

router.get('/forecast', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }

    const daily = await getDailyUsage(companyId, 30);
    if (daily.length === 0) {
      return res.json({
        success: true,
        daily_forecast: [],
        avg_daily_calls: 0,
        avg_daily_cost: 0,
        no_data: true,
      });
    }

    // 오름차순 정렬 (옛 데이터는 DESC) — 선형 회귀 정합
    const sorted = [...daily].reverse();
    const n = sorted.length;
    const counts = sorted.map((d) => d.count);
    const costs = sorted.map((d) => d.cost);

    // 선형 회귀 (call count)
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += counts[i];
      sumXY += i * counts[i];
      sumXX += i * i;
    }
    const denom = n * sumXX - sumX * sumX;
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    const intercept = (sumY - slope * sumX) / n;

    // 비용 평균 (단순 평균 — 외부 변동 영향 작음)
    const avgCost = costs.reduce((s, c) => s + c, 0) / n;
    const avgCallsHistory = counts.reduce((s, c) => s + c, 0) / n;

    const forecast: Array<{ date: string; predicted_calls: number; predicted_cost: number; is_forecast: boolean }> = [];

    // 옛 30일 실제 데이터
    for (let i = 0; i < n; i++) {
      forecast.push({
        date: sorted[i].date,
        predicted_calls: counts[i],
        predicted_cost: costs[i],
        is_forecast: false,
      });
    }

    // 향후 30일 예측 (오름차순 추가)
    const todayKst = new Date();
    todayKst.setHours(0, 0, 0, 0);
    for (let d = 1; d <= 30; d++) {
      const xIdx = n - 1 + d;
      const predictedCalls = Math.max(0, Math.round(slope * xIdx + intercept));
      const costRatio = avgCallsHistory > 0 ? avgCost / avgCallsHistory : 0;
      const predictedCost = Math.round(predictedCalls * costRatio);
      const futureDate = new Date(todayKst.getTime() + d * 86_400_000);
      const dateStr = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
      forecast.push({
        date: dateStr,
        predicted_calls: predictedCalls,
        predicted_cost: predictedCost,
        is_forecast: true,
      });
    }

    return res.json({
      success: true,
      daily_forecast: forecast,
      avg_daily_calls: Math.round(avgCallsHistory * 10) / 10,
      avg_daily_cost: Math.round(avgCost),
      trend_slope: Math.round(slope * 100) / 100,
      no_data: false,
    });
  } catch (err: any) {
    console.error('[AI Usage forecast] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '예측 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// 3. POST /api/ai-usage/search-natural — 자연어 질문 → AI 답변
// ════════════════════════════════════════════════════════════════════

router.post('/search-natural', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }
    const q = String(req.body?.query || '').trim();
    if (q.length < 2) {
      return res.status(400).json({ success: false, error: '질문은 2자 이상 입력해주세요.' });
    }
    if (q.length > 500) {
      return res.status(400).json({ success: false, error: '질문은 500자 이내로 입력해주세요.' });
    }

    const [monthly, daily, breakdown] = await Promise.all([
      getMonthlyUsage(companyId),
      getDailyUsage(companyId, 30),
      getModelBreakdown(companyId, 30),
    ]);
    const cache = getCacheStats();

    if (daily.length === 0 && monthly.used === 0) {
      return res.json({
        success: true,
        answer: '아직 이번 달 AI 호출 데이터가 없어서 분석할 근거가 없습니다. 캠페인 생성 또는 AI 추천 메뉴를 사용하시면 데이터가 쌓입니다.',
        no_data: true,
      });
    }

    const topSources = breakdown.slice(0, 5)
      .map((b) => `${b.source} (${abstractModelLabel(b.modelType)}): ${b.count.toLocaleString()}회, ${b.cost.toLocaleString()}원`)
      .join('\n');

    const dailyContext = daily.slice(0, 14)
      .map((d) => `${d.date}: ${d.count}회 / ${d.cost.toLocaleString()}원`)
      .join('\n');

    const systemPrompt = `당신은 한줄로 마케팅 자동화 SaaS의 AI 사용량 분석 도우미입니다.

## 회사 사용량 데이터 (분석 근거)

### 이번 달 요약
- 호출 횟수: ${monthly.used.toLocaleString()}회 / 한도 ${monthly.limit !== null ? monthly.limit.toLocaleString() + '회' : '무제한'}
- Cache 히트율: ${(cache.hitRate * 100).toFixed(1)}% (hit ${cache.hit.toLocaleString()}, miss ${cache.miss.toLocaleString()})

### 최근 14일 일별
${dailyContext || '(데이터 없음)'}

### 30일 상위 호출 출처 + 모델
${topSources || '(데이터 없음)'}

## 답변 원칙 (반드시 준수)
1. 위 데이터만 근거로 답변하세요. 데이터에 없는 정보는 추측하지 마세요.
2. **모델명을 절대 노출하지 마세요**. "고급 추론 모드 / 표준 추론 모드 / 보조 추론 모드" 추상 명칭만 사용.
3. **구체 혜택(%, 원, 무료, 쿠폰) 임의 생성 금지**. 회사 정책 데이터가 없습니다.
4. 답변은 한국어 3~6문장으로 간결하게 작성하세요.
5. 비용 절감 추천 시 = Batch 처리 모드 (24시간 SLA, 50% 절감) + cache 히트율 향상 + 한도 알림 설정 중심으로 안내.
6. "~인 것 같습니다" 가설 표현 금지. 근거 명확하면 단언, 부족하면 "데이터 부족" 명시.`;

    const answer = await callAIWithFallback({
      system: systemPrompt,
      userMessage: q,
      maxTokens: 1500,
      temperature: 0.3,
      model: 'opus',
      companyId,
      source: 'ai-usage-search',
    });

    return res.json({
      success: true,
      answer,
      no_data: false,
      context_summary: {
        monthly_used: monthly.used,
        monthly_limit: monthly.limit,
        cache_hit_rate: cache.hitRate,
        top_sources_count: breakdown.length,
        daily_data_points: daily.length,
      },
    });
  } catch (err: any) {
    console.error('[AI Usage search-natural] 오류:', err);
    if (err?.name === 'AiRateLimitExceeded') {
      return res.status(429).json({ success: false, error: err.message, code: 'AI_RATE_LIMIT' });
    }
    return res.status(500).json({ success: false, error: err?.message || '검색 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// 4. POST /api/ai-usage/threshold-alert — 한도 알림 설정
// ════════════════════════════════════════════════════════════════════

interface ThresholdConfigInput {
  threshold_percent: number;
  channels: Array<'email' | 'sms' | 'inapp'>;
  enabled?: boolean;
}

router.post('/threshold-alert', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '한도 알림 설정은 회사 관리자만 가능합니다.' });
    }

    const body = req.body as ThresholdConfigInput;
    const thresholdPercent = Number(body.threshold_percent);
    if (![50, 80, 95].includes(thresholdPercent)) {
      return res.status(400).json({ success: false, error: 'threshold_percent는 50, 80, 95 중 하나여야 합니다.' });
    }
    const validChannels: Array<'email' | 'sms' | 'inapp'> = ['email', 'sms', 'inapp'];
    const channels = Array.isArray(body.channels)
      ? body.channels.filter((c) => validChannels.includes(c))
      : [];
    if (channels.length === 0) {
      return res.status(400).json({ success: false, error: '알림 채널을 1개 이상 선택해주세요 (email / sms / inapp).' });
    }
    const enabled = body.enabled !== false;

    const newConfig = {
      enabled,
      threshold_percent: thresholdPercent,
      channels,
      updated_at: new Date().toISOString(),
    };

    await query(
      `UPDATE companies
       SET ai_usage_threshold_config = $1::jsonb,
           updated_at = NOW()
       WHERE id = $2::uuid`,
      [JSON.stringify(newConfig), companyId],
    );

    return res.json({ success: true, config: newConfig });
  } catch (err: any) {
    console.error('[AI Usage threshold-alert] 오류:', err);
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요: 운영자에게 companies ALTER (ai_usage_threshold_config jsonb) 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    return res.status(500).json({ success: false, error: err?.message || '설정 저장 실패' });
  }
});

export default router;
