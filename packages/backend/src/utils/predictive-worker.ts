/**
 * predictive-worker.ts (D197 2026-05-22)
 *
 * Phase B-2 Predictive Suite — 1시간 주기 cron worker
 *
 * 본질:
 *  - 모든 active 회사 대상 매시간 customer 예측 점수 자동 갱신
 *  - 24h TTL (매일 1회 재계산 정합)
 *  - 신규 customer 등록 시 event-driven 즉시 계산 (별 진입점)
 *  - 모델 자동 진화 (옛 데이터 누적 시 정확도 자동 향상)
 *
 * 영구 원칙 정합:
 *  - 회사 격리 (companyId 단위 batch)
 *  - 6,000사+ 운영 영향 0 (worker 실패 시 발송 영향 0)
 *  - workerRunning guard (중복 진입 차단)
 *  - 한 회사 batch limit 5000명 (옛 큰 회사 영역 분할 처리 정합)
 */

import { query } from '../config/database';
import { recomputeCompanyPredictions } from './predictive-suite';

const WORKER_INTERVAL_MS = 60 * 60 * 1000;  // 1h
const PER_COMPANY_BATCH_LIMIT = 5000;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;  // 24h

let workerRunning = false;
let workerInterval: ReturnType<typeof setInterval> | null = null;

export function startPredictiveWorker(): void {
  if (workerInterval) {
    console.log('[PredictiveWorker] 옛 worker 진입 중 — skip');
    return;
  }
  console.log('[PredictiveWorker] 1시간 주기 worker 시작 — 회사 전체 customer 예측 점수 자동 갱신');

  // 진입 직후 1회 실행 (서버 재시작 직후 옛 stale 데이터 즉시 갱신)
  void runPredictiveBatch();

  workerInterval = setInterval(() => {
    void runPredictiveBatch();
  }, WORKER_INTERVAL_MS);
}

export function stopPredictiveWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log('[PredictiveWorker] worker 종료');
  }
}

async function runPredictiveBatch(): Promise<void> {
  if (workerRunning) {
    console.log('[PredictiveWorker] 옛 batch 진행 중 — skip');
    return;
  }
  workerRunning = true;
  const startedAt = Date.now();
  let totalUpdated = 0;
  let totalSkipped = 0;
  let companiesProcessed = 0;

  try {
    // active 회사 매트릭스 (BUSINESS / ENTERPRISE 플랜 또는 cdp_events 누적 1+건 회사)
    const companyRes = await query(
      `SELECT DISTINCT c.id
       FROM companies c
       LEFT JOIN plans p ON p.id = c.plan_id
       WHERE p.plan_code IN ('BUSINESS', 'ENTERPRISE')
          OR EXISTS (
            SELECT 1 FROM cdp_events ce
            WHERE ce.company_id = c.id AND ce.occurred_at > NOW() - INTERVAL '30 days'
          )
       ORDER BY c.id`
    );

    for (const row of companyRes.rows) {
      try {
        const result = await recomputeCompanyPredictions(row.id, {
          limit: PER_COMPANY_BATCH_LIMIT,
          staleAfterMs: STALE_AFTER_MS,
        });
        totalUpdated += result.updated;
        totalSkipped += result.skipped;
        companiesProcessed++;
      } catch (err: any) {
        console.warn('[PredictiveWorker] 회사 batch 오류, skip:', row.id, err?.message);
      }
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(`[PredictiveWorker] batch 완료 — 회사 ${companiesProcessed}개 / customer ${totalUpdated}명 갱신 / skip ${totalSkipped}명 / ${(elapsedMs / 1000).toFixed(1)}s`);
  } catch (err: any) {
    console.error('[PredictiveWorker] batch 진입 오류:', err?.message);
  } finally {
    workerRunning = false;
  }
}

/**
 * Event-driven 진입점 — 신규 customer 등록 / 옛 customer 활동 update 직후 호출
 * (customer-upsert.ts + cdp-events.ts에서 호출 가능 — 우선순위 낮은 영역은 batch 의존 정합)
 */
export async function triggerCustomerPredictionUpdate(
  customerId: string,
  companyId: string,
): Promise<void> {
  try {
    const { computePredictions } = await import('./predictive-suite');
    const predictions = await computePredictions(customerId, companyId);
    await query(
      `INSERT INTO cdp_customer_predictions
         (customer_id, company_id, click_score, churn_risk, purchase_likelihood, computed_at, model_version)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
       ON CONFLICT (customer_id) DO UPDATE SET
         click_score = EXCLUDED.click_score,
         churn_risk = EXCLUDED.churn_risk,
         purchase_likelihood = EXCLUDED.purchase_likelihood,
         computed_at = EXCLUDED.computed_at,
         model_version = EXCLUDED.model_version`,
      [
        customerId, companyId,
        predictions.clickScore, predictions.churnRisk, predictions.purchaseLikelihood,
        predictions.computedAt, predictions.modelVersion,
      ]
    );
  } catch (err: any) {
    console.warn('[PredictiveWorker] event-driven 갱신 오류, skip:', err?.message);
  }
}
