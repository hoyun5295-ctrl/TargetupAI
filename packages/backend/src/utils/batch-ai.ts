/**
 * ★ CT-38: Anthropic Batch API 컨트롤타워 — D181 (2026-05-19)
 *
 * 🎯 목적
 *   D162-5 AI 4 결합 #2 박은 영역 — 대량 발송 박은 영역 (100+ 개인화 메시지) 50% 비용 절감.
 *   Anthropic Batch API 표준 박음 — 24시간 박은 영역 박음 (real-time 박지 X 영역).
 *
 * 📋 Anthropic 표준
 *   - API: https://api.anthropic.com/v1/messages/batches
 *   - SDK: anthropic.messages.batches.create({ requests: [...] })
 *   - 1 batch 박은 영역 = 최대 100,000 requests
 *   - 박은 영역 박은 영역 박음 = 24시간 박음 (대부분 1h 이내)
 *   - 비용: standard 박은 영역의 **50%**
 *
 * 📊 사용 흐름
 *   1. submitBatch(companyId, requests[]) — Anthropic batches.create 박음 + DB INSERT
 *   2. pollBatch(batchId) — 상태 박음 (cron 박은 영역 박음 또는 사용자 호출)
 *   3. getBatchResults(batchId) — 완료 시 박은 결과 박음 (custom_id 박은 영역 박음)
 *
 * ⛔ 영구 원칙 정합
 *   - 모델 분리 #3 — AI Operator 영역만 박음 (Sonnet 4.6 흐름 영향 0건)
 *   - real-time 박지 X — Continuous Operator 박은 영역 (다음 날 박음 정합) 또는 ENT 대량 캠페인
 *   - 사용자 신뢰 #4 — 회사 admin이 batch 박은 영역 박은 영역 박음 (PM2 로그)
 */

import Anthropic from '@anthropic-ai/sdk';
import { query } from '../config/database';
import { AI_MODELS } from '../config/defaults';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export type BatchStatus = 'in_progress' | 'canceling' | 'ended';
export type BatchJobStatus = 'submitted' | 'processing' | 'completed' | 'failed' | 'expired';

export interface BatchRequest {
  customId: string;
  system: string;
  userMessage: string;
  maxTokens?: number;
}

export interface BatchJob {
  id: string;
  companyId: string;
  batchId: string;             // Anthropic 박은 batch ID
  model: string;
  totalRequests: number;
  status: BatchJobStatus;
  succeededCount: number;
  erroredCount: number;
  expiredCount: number;
  metadata: Record<string, unknown>;
  submittedAt: Date;
  completedAt: Date | null;
}

export interface BatchResultItem {
  customId: string;
  text: string | null;
  errorType: string | null;
  errorMessage: string | null;
}

// ════════════════════════════════════════════════════════════════════
// Batch 박음
// ════════════════════════════════════════════════════════════════════

/**
 * 대량 박은 영역 박음 — Anthropic Batch API 박음 + DB INSERT.
 * - model: 'opus' (Opus 4.7) — AI Operator 영역
 * - 50% 비용 절감 박음 (Anthropic 표준)
 */
export async function submitBatch(input: {
  companyId: string;
  model?: 'sonnet' | 'opus';
  requests: BatchRequest[];
  metadata?: Record<string, unknown>;
}): Promise<BatchJob> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.');
  }
  if (input.requests.length === 0) {
    throw new Error('requests 배열은 1건 이상 필요합니다.');
  }
  if (input.requests.length > 100000) {
    throw new Error('Anthropic Batch API 1회 한도(100,000건) 초과 — 분할 진행해주세요.');
  }

  const modelKey = input.model || 'opus';
  const modelId = modelKey === 'opus' ? AI_MODELS.opus : AI_MODELS.claude;

  // Anthropic Batch API 박음 — custom_id 박은 영역 박음
  const requests = input.requests.map((r) => ({
    custom_id: r.customId.slice(0, 64),
    params: {
      model: modelId,
      max_tokens: r.maxTokens || 1024,
      system: r.system,
      messages: [{ role: 'user' as const, content: r.userMessage }],
    },
  }));

  const batch = await (anthropic.messages.batches as any).create({ requests });

  // DB INSERT
  const result = await query(
    `INSERT INTO ai_batch_jobs (
      id, company_id, batch_id, model, total_requests, status,
      succeeded_count, errored_count, expired_count, metadata,
      submitted_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2, $3, $4, 'submitted',
      0, 0, 0, $5::jsonb,
      NOW(), NOW(), NOW()
    ) RETURNING *`,
    [
      input.companyId,
      batch.id,
      modelId,
      requests.length,
      JSON.stringify(input.metadata || {}),
    ]
  );

  console.log(`[BatchAI] ${input.companyId} 박음 — ${requests.length} requests (batch_id=${batch.id}, model=${modelId})`);
  return mapRow(result.rows[0]);
}

/**
 * batch 상태 박음 + DB 갱신.
 * - Anthropic batches.retrieve 박음
 * - status='ended' 시 결과 박은 영역 박음 정합 (getBatchResults 박음)
 */
export async function pollBatch(batchId: string): Promise<BatchJob | null> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.');
  }

  const dbRow = await query(
    `SELECT * FROM ai_batch_jobs WHERE batch_id = $1 LIMIT 1`,
    [batchId]
  );
  if (dbRow.rows.length === 0) return null;
  const job = mapRow(dbRow.rows[0]);

  if (job.status === 'completed' || job.status === 'failed' || job.status === 'expired') {
    return job;
  }

  const batch = await (anthropic.messages.batches as any).retrieve(batchId);
  const counts = batch.request_counts || {};
  const succeededCount = counts.succeeded || 0;
  const erroredCount = counts.errored || 0;
  const expiredCount = counts.expired || 0;

  let newStatus: BatchJobStatus = 'processing';
  if (batch.processing_status === 'ended') {
    newStatus = succeededCount > 0 ? 'completed' : (expiredCount > 0 ? 'expired' : 'failed');
  }

  await query(
    `UPDATE ai_batch_jobs SET
       status = $2,
       succeeded_count = $3,
       errored_count = $4,
       expired_count = $5,
       completed_at = CASE WHEN $2 IN ('completed', 'failed', 'expired') THEN NOW() ELSE completed_at END,
       updated_at = NOW()
     WHERE batch_id = $1`,
    [batchId, newStatus, succeededCount, erroredCount, expiredCount]
  );

  return { ...job, status: newStatus, succeededCount, erroredCount, expiredCount };
}

/**
 * batch 결과 박음 (completed 박은 영역 박은 후).
 * - Anthropic batches.results 박음 (streaming JSONL)
 */
export async function getBatchResults(batchId: string): Promise<BatchResultItem[]> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.');
  }
  const results: BatchResultItem[] = [];
  const stream = await (anthropic.messages.batches as any).results(batchId);
  for await (const entry of stream as AsyncIterable<any>) {
    const customId = entry.custom_id || '';
    const result = entry.result;
    if (result?.type === 'succeeded') {
      const text = (result.message?.content || [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');
      results.push({ customId, text, errorType: null, errorMessage: null });
    } else if (result?.type === 'errored') {
      results.push({
        customId,
        text: null,
        errorType: result.error?.type || 'unknown',
        errorMessage: result.error?.message || '',
      });
    } else {
      results.push({
        customId,
        text: null,
        errorType: result?.type || 'unknown',
        errorMessage: '',
      });
    }
  }
  return results;
}

/**
 * 회사 batch 박은 영역 박음 (운영 모니터링).
 */
export async function listBatchJobs(companyId: string, limit: number = 50): Promise<BatchJob[]> {
  const result = await query(
    `SELECT * FROM ai_batch_jobs WHERE company_id = $1::uuid
     ORDER BY submitted_at DESC LIMIT $2`,
    [companyId, Math.min(limit, 200)]
  );
  return result.rows.map(mapRow);
}

// ════════════════════════════════════════════════════════════════════
// 헬퍼
// ════════════════════════════════════════════════════════════════════

function mapRow(row: any): BatchJob {
  return {
    id: row.id,
    companyId: row.company_id,
    batchId: row.batch_id,
    model: row.model,
    totalRequests: row.total_requests || 0,
    status: row.status,
    succeededCount: row.succeeded_count || 0,
    erroredCount: row.errored_count || 0,
    expiredCount: row.expired_count || 0,
    metadata: row.metadata || {},
    submittedAt: new Date(row.submitted_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
  };
}
