/**
 * CT-55 utils/ai-rate-limit.ts (D209+ 2026-05-22)
 *
 * Phase D 비용 안전 매트릭스 — 회사별 AI 호출 월 한도 + 카운트
 *
 * 본질: 한줄로 운영 시 무제한 AI 호출 = 비용 폭발 사고 차단. 회사 plan별 월 한도 정합.
 *
 * 영구 원칙 정합:
 *  - plans.ai_calls_per_month NULL = 무제한 (ENTERPRISE)
 *  - ★2026-09-25 Harold B안: 면제 source(`AI_CALL_LIMIT_EXEMPT_SOURCES`)는 한도 검사도 건너뛰고 한도와 비교되는 숫자에서도 빠진다
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

/** 직접발송 맞춤법 검사 source(원장 `spell_check_uses.source`와 같은 값 · 이름 소유 = 여기) */
export const DIRECT_SPELL_AI_SOURCE = 'direct-send-spell';
/** 대행발송 맞춤법 검사 source(이름 소유 = 여기) */
export const AGENCY_SPELL_AI_SOURCE = 'agency-send-spell';

/**
 * 월 AI 호출 한도에서 빠지는 source(한 벌 · ★2026-09-25 Harold B안).
 * 이 목록의 호출은 ① 한도 검사를 건너뛰고(`callAIWithFallback`) ② **한도와 비교되는 모든 숫자**에서 빠진다
 * (월 사용량 `getMonthlyUsage` · 일별 호출 수 `getDailyUsage` · 사용량 화면 전월 호출). 기록(`ai_call_log`)은 그대로 남아
 * 출처별 분포(`getModelBreakdown`)와 일별 비용에는 보인다.
 * 넣는 기준 = 자기 사용 한도가 따로 있는 서비스. 맞춤법 = 무료 월 5회(`spell-check-quota`) · 사용자당 1분 6회 · 같은 글 5분 캐시.
 * 이유(Harold 승인): 맞춤법 무제한이 크레딧 매출을 내는 다른 AI 기능의 한도를 깎지 않게 한다.
 */
export const AI_CALL_LIMIT_EXEMPT_SOURCES: readonly string[] = [DIRECT_SPELL_AI_SOURCE, AGENCY_SPELL_AI_SOURCE];

/** 한도 면제 호출인가 */
export function isAiCallLimitExempt(source: string | null | undefined): boolean {
  return !!source && AI_CALL_LIMIT_EXEMPT_SOURCES.includes(source);
}

/**
 * 한도에 세는 호출(SQL 조각 · 한 벌). 목록 값은 코드 상수라 글자로 싣는다.
 * source 가 NULL 인 옛 행도 센다(COALESCE) — 조건을 붙였다고 옛 행이 셈에서 빠지면 안 된다.
 */
export function aiLimitCountedSql(col = 'source'): string {
  return `COALESCE(${col}, '') NOT IN (${AI_CALL_LIMIT_EXEMPT_SOURCES.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ')})`;
}

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
 * 회사별 월 한도 + 사용량 조회 (KST 월 기준). used = 한도에 세는 호출만(`aiLimitCountedSql`).
 */
export async function getMonthlyUsage(companyId: string): Promise<{ used: number; limit: number | null }> {
  if (!companyId) return { used: 0, limit: null };
  const cached = usageCache.get(companyId);
  if (cached && cached.expiresAt > Date.now()) {
    return { used: cached.used, limit: cached.limit };
  }

  try {
    // ★ D217+ 정정 (2026-05-25 Harold 명시): 옛 `c.plan_code` 사고 = companies 안 plan_code 컬럼 X
    //   = D215+ PM2 로그 영역 "column c.plan_code does not exist" + silent fallback 0 사고
    //   정정 = c.plan_id = p.id (다른 호출처 30+ 전수 정합)
    const planRes = await query(
      `SELECT p.ai_calls_per_month
       FROM companies c
       LEFT JOIN plans p ON c.plan_id = p.id
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
         AND called_at >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'
         AND ${aiLimitCountedSql()}`,
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
}): Promise<string | null> {
  // ★ D227+ 종량제: INSERT된 ai_call_log.id를 반환 → deductCredit의 aiCallLogId(idempotency)로 연결.
  if (!opts.companyId) return null;
  try {
    const res = await query(
      `INSERT INTO ai_call_log (
        id, company_id, called_at, source, model_type, input_tokens, output_tokens, cost_won, success
      ) VALUES (
        gen_random_uuid(), $1::uuid, NOW(), $2, $3, $4, $5, $6, $7
      ) RETURNING id`,
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
    return res.rows[0]?.id || null;
  } catch (err: any) {
    console.warn('[AiRateLimit] recordAiCall 오류 (silent skip):', err?.message);
    return null;
  }
}

/**
 * 30일 사용량 일별 매트릭스 (대시보드용)
 * count = 한도에 세는 호출(일평균·한도 도달 예측·30일 예측이 한도와 비교한다) · cost = 전체 원가(면제 호출 포함).
 */
export async function getDailyUsage(companyId: string, days = 30): Promise<Array<{ date: string; count: number; cost: number }>> {
  if (!companyId) return [];
  try {
    const res = await query(
      `SELECT
         to_char(date_trunc('day', called_at AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD') AS date,
         (COUNT(*) FILTER (WHERE ${aiLimitCountedSql()}))::int AS count,
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

/**
 * ★ D210+ Phase 3 B-8 (2026-05-23 Harold 명시): 30일 모델별 분포 매트릭스 (source + modelType + 비용)
 *   회사 admin 영역 = 모델별 사용 영역 분포 인지 (sub-agent / orchestrator / journey / refine 영역 등)
 */
export async function getModelBreakdown(companyId: string, days = 30): Promise<Array<{ source: string; modelType: string; count: number; cost: number }>> {
  if (!companyId) return [];
  try {
    const res = await query(
      `SELECT
         source,
         model_type,
         COUNT(*)::int AS count,
         COALESCE(SUM(cost_won), 0)::int AS cost
       FROM ai_call_log
       WHERE company_id = $1::uuid
         AND called_at >= NOW() - ($2 || ' days')::interval
       GROUP BY source, model_type
       ORDER BY count DESC
       LIMIT 30`,
      [companyId, days]
    );
    return res.rows.map((r: any) => ({
      source: r.source,
      modelType: r.model_type,
      count: Number(r.count) || 0,
      cost: Number(r.cost) || 0,
    }));
  } catch (err: any) {
    console.warn('[AiRateLimit] getModelBreakdown 오류:', err?.message);
    return [];
  }
}
