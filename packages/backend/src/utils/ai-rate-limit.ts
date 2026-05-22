/**
 * CT-55 utils/ai-rate-limit.ts (D209+ 2026-05-22)
 *
 * Phase D 비용 안전 매트릭스 — 회사별 AI 호출 월 한도 + 카운트
 *
 * 본질: 6,000사+ 운영 시 무제한 AI 호출 = 비용 폭발 사고 차단. 회사 plan별 월 한도 정합.
 *
 * 영구 원칙 정합:
 *  - plans.ai_calls_per_month NULL = 무제한 (ENTERPRISE)
 *  - 한도 초과 시 throw AiRateLimitExceeded (호출 측 catch + 사용자 안내)
 *  - ai_call_log 매 호출 INSERT (회사별 월 통계 진실의 원천)
 *  - DB 조회 비용 매트릭스 = in-memory cache (60초 TTL)
 *  - companyId 없으면 통계 skip (안전 정합)
 *
 * SCHEMA 의존:
 *  - plans.ai_calls_per_month integer NULL (D209+ ALTER 신규)
 *  - ai_call_log 테이블 (D209+ CREATE 신규)
 */

import { query } from '../config/database';

export class AiRateLimitExceeded extends Error {
  constructor(message: string, public used: number, public limit: number) {
    super(message);
    this.name = 'AiRateLimitExceeded';
  }
}

interface UsageCache {
  used: number;
  limit: number | null;
  expiresAt: number;
}

const usageCache = new Map<string, UsageCache>();
const USAGE_CACHE_TTL_MS = 60 * 1000;  // 60초 (월 카운트라 분 단위 정합)

/**
 * 회사별 월 한도 + 사용량 조회 (KST 월 기준)
 */
export async function getMonthlyUsage(companyId: string): Promise<{ used: number; limit: number | null }> {
  if (!companyId) return { used: 0, limit: null };
  const cached = usageCache.get(companyId);
  if (cached && cached.expiresAt > Date.now()) {
    return { used: cached.used, limit: cached.limit };
  }

  try {
    const planRes = await query(
      `SELECT p.ai_calls_per_month
       FROM companies c
       LEFT JOIN plans p ON c.plan_code = p.code
       WHERE c.id = $1::uuid
       LIMIT 1`,
      [companyId]
    );
    const limit = planRes.rows[0]?.ai_calls_per_month != null
      ? Number(planRes.rows[0].ai_calls_per_month)
      : null;

    const usageRes = await query(
      `SELECT COUNT(*)::int AS cnt
       FROM ai_call_log
       WHERE company_id = $1::uuid
         AND called_at >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'`,
      [companyId]
    );
    const used = usageRes.rows[0]?.cnt || 0;

    usageCache.set(companyId, { used, limit, expiresAt: Date.now() + USAGE_CACHE_TTL_MS });
    return { used, limit };
  } catch (err: any) {
    console.warn('[AiRateLimit] getMonthlyUsage 오류, default 0:', err?.message);
    return { used: 0, limit: null };
  }
}

/**
 * 한도 검증 — 초과 시 throw AiRateLimitExceeded
 */
export async function checkAiRateLimit(companyId: string): Promise<void> {
  if (!companyId) return;
  const { used, limit } = await getMonthlyUsage(companyId);
  if (limit !== null && used >= limit) {
    throw new AiRateLimitExceeded(
      `이번 달 AI 호출 한도 초과 (사용 ${used.toLocaleString()}회 / 한도 ${limit.toLocaleString()}회). 회사 요금제 업그레이드 또는 다음 달 자동 초기화를 기다려주세요.`,
      used,
      limit
    );
  }
}

/**
 * AI 호출 기록 — ai_call_log INSERT + cache 무효화
 */
export async function recordAiCall(opts: {
  companyId: string | null;
  source: string;  // 'generate-messages' / 'journey-ai' / 'refine-message' / ...
  modelType: 'sonnet' | 'opus' | 'gpt-fallback';
  inputTokens?: number;
  outputTokens?: number;
  costWon?: number;
  success?: boolean;
}): Promise<void> {
  if (!opts.companyId) return;
  try {
    await query(
      `INSERT INTO ai_call_log (
        id, company_id, called_at, source, model_type, input_tokens, output_tokens, cost_won, success
      ) VALUES (
        gen_random_uuid(), $1::uuid, NOW(), $2, $3, $4, $5, $6, $7
      )`,
      [
        opts.companyId,
        opts.source.slice(0, 50),
        opts.modelType,
        opts.inputTokens || 0,
        opts.outputTokens || 0,
        opts.costWon || 0,
        opts.success !== false,
      ]
    );
    usageCache.delete(opts.companyId);
  } catch (err: any) {
    console.warn('[AiRateLimit] recordAiCall 오류 (silent skip):', err?.message);
  }
}

/**
 * 30일 사용량 일별 매트릭스 (대시보드용)
 */
export async function getDailyUsage(companyId: string, days = 30): Promise<Array<{ date: string; count: number; cost: number }>> {
  if (!companyId) return [];
  try {
    const res = await query(
      `SELECT
         to_char(date_trunc('day', called_at AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD') AS date,
         COUNT(*)::int AS count,
         COALESCE(SUM(cost_won), 0)::int AS cost
       FROM ai_call_log
       WHERE company_id = $1::uuid
         AND called_at >= NOW() - ($2 || ' days')::interval
       GROUP BY date_trunc('day', called_at AT TIME ZONE 'Asia/Seoul')
       ORDER BY date_trunc('day', called_at AT TIME ZONE 'Asia/Seoul') DESC`,
      [companyId, days]
    );
    return res.rows;
  } catch (err: any) {
    console.warn('[AiRateLimit] getDailyUsage 오류:', err?.message);
    return [];
  }
}
