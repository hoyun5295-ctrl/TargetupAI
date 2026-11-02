/**
 * CT-55 utils/ai-rate-limit.ts (D209+ 2026-05-22) — AI 호출 기록 · 통계
 *
 * ★ 2026-11-01 월 AI 호출 수 한도 삭제(Harold 「한도를 두는거 자체가 문제 · 어짜피 지들 크레딧 소모하는건데」 · 설계서 §16-4).
 *   쓰는 양은 크레딧 하나로 막는다(크레딧 CT · 사용률 = creditUsageThisMonth). 여기 남는 것 = 호출 기록(ai_call_log) ·
 *   월 · 일 · 모델별 통계 · 맞춤법 원천 이름. 한도 판정 · 면제 원천 목록 · 셈 조각 · 사용량 캐시는 지웠다.
 *
 * SCHEMA 의존:
 *  - ai_call_log 테이블 (D209+ CREATE)
 */

import { query } from '../config/database';

/** 직접발송 맞춤법 검사 source(원장 `spell_check_uses.source`와 같은 값 · 이름 소유 = 여기) */
export const DIRECT_SPELL_AI_SOURCE = 'direct-send-spell';
/** 대행발송 맞춤법 검사 source(이름 소유 = 여기) */
export const AGENCY_SPELL_AI_SOURCE = 'agency-send-spell';

/** 이번 달(KST) AI 호출 수(사용량 통계 · 모든 원천) */
export async function getMonthlyCallCount(companyId: string): Promise<number> {
  if (!companyId) return 0;
  try {
    const r = await query(
      `SELECT COUNT(*)::int AS cnt
       FROM ai_call_log
       WHERE company_id = $1::uuid
         AND called_at >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'`,
      [companyId]
    );
    return Number(r.rows[0]?.cnt) || 0;
  } catch (err: any) {
    console.warn('[AiRateLimit] getMonthlyCallCount 오류, default 0:', err?.message);
    return 0;
  }
}

/**
 * AI 호출 기록 — ai_call_log INSERT
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
    return res.rows[0]?.id || null;
  } catch (err: any) {
    console.warn('[AiRateLimit] recordAiCall 오류 (silent skip):', err?.message);
    return null;
  }
}

/**
 * 30일 사용량 일별 매트릭스 (대시보드용)
 * count = 그날 호출 수 · cost = 그날 원가.
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
