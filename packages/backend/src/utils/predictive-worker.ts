/**
 * predictive-worker.ts (D197 2026-05-22, D210+ Phase 3 2026-05-23, 매일 1회 전환 2026-06-02)
 *
 * Phase B-2 Predictive Suite — 매일 KST 오전 9시 cron worker
 *
 * 역할:
 *  - 연동 회사(싱크에이전트/SDK) 대상 매일 1회 customer 예측 점수 자동 갱신 + 매일 3크레딧(회사+날짜 멱등)
 *  - 회사 전체 customer 1 SQL UPSERT (D210+ Phase 3)
 *  - 신규 customer 등록 시 event-driven 즉시 계산 (별도 진입점 = triggerCustomerPredictionUpdate)
 *  - 모델 자동 진화 (데이터 누적 시 정확도 자동 향상)
 *
 * D210+ Phase 3 (2026-05-23 Harold 명시):
 *  - 기존 PER_COMPANY_BATCH_LIMIT = 5,000 제한 폐기
 *  - 기존 단일 customer 1 SQL × N → 회사 전체 1 SQL UPSERT
 *  - 큰 회사 (29,997명+) = 1 cron 진입에 전수 갱신 완료 (3~10초)
 *
 * 영구 원칙:
 *  - 회사 격리 (companyId 단위 batch)
 *  - 한줄로 운영 영향 0 (worker 실패 시 발송 영향 0)
 *  - workerRunning guard (중복 진입 차단)
 */

import { query } from '../config/database';
import { computeCompanyPredictionsBatch } from './predictive-suite';
import { checkCredit, deductCreditSafe, InsufficientCreditError } from './ai-credit';
import { getCreditCost, kstDateTag, kstHour } from './ai-credit-calc';

// 30분마다 깨어 KST 오전 9시대에 하루 1회만 실행(차감은 회사+날짜 멱등으로 추가 보장).
const WORKER_INTERVAL_MS = 30 * 60 * 1000;
const PREDICTIVE_RUN_HOUR_KST = 9;

let workerRunning = false;
let workerInterval: ReturnType<typeof setInterval> | null = null;
let lastBatchDateKst = '';  // 오늘(KST) 배치 실행 여부 — 하루 1회 가드

export function startPredictiveWorker(): void {
  if (workerInterval) {
    console.log('[PredictiveWorker] worker 진입 중 — skip');
    return;
  }
  console.log('[PredictiveWorker] worker 시작 — 매일 KST 오전 9시 연동 회사 예측 점수 갱신 (매일 3크레딧 · 회사+날짜 멱등)');

  // 진입 직후 1회 점검 (9시대가 아니면 가드가 즉시 거른다)
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
    console.log('[PredictiveWorker] batch 진행 중 — skip');
    return;
  }

  // KST 오전 9시대 + 하루 1회만 (30분 주기·서버 재시작 중복 진입 차단)
  const now = new Date();
  if (kstHour(now) !== PREDICTIVE_RUN_HOUR_KST) return;
  const todayKst = kstDateTag(now);
  if (lastBatchDateKst === todayKst) return;
  lastBatchDateKst = todayKst;

  workerRunning = true;
  const startedAt = Date.now();
  let totalUpdated = 0;
  let totalTrained = 0;
  let totalCold = 0;
  let companiesProcessed = 0;
  let creditSkipped = 0;
  const cost = getCreditCost('predictive-daily');  // 3

  try {
    // 대상 = 연동 회사(싱크에이전트 등록 OR SDK cdp_events)만 + 예측 ON(predictive_enabled).
    //   predictive_enabled 컬럼 ALTER 전제 — COALESCE로 미설정 시 ON 취급(배포 후 컬럼 default true).
    const companyRes = await query(
      `SELECT DISTINCT c.id
         FROM companies c
        WHERE COALESCE(c.predictive_enabled, true) = true
          AND (
            EXISTS (SELECT 1 FROM sync_agents sa WHERE sa.company_id = c.id)
            OR EXISTS (SELECT 1 FROM cdp_events ce WHERE ce.company_id = c.id AND ce.source = 'custom_sdk')
          )
        ORDER BY c.id`
    );

    for (const row of companyRes.rows) {
      // 크레딧 사전 차단 — 부족하면 이 회사 예측 skip(무과금 예측 방지). 미설정 회사는 통과(차감도 자동 skip).
      try {
        await checkCredit(row.id, cost);
      } catch (err: any) {
        if (err instanceof InsufficientCreditError) {
          creditSkipped++;
          console.log(`[PredictiveWorker] 크레딧 부족 skip company=${row.id} cost=${cost}`);
          continue;
        }
      }

      try {
        const result = await computeCompanyPredictionsBatch(row.id);
        totalUpdated += result.updated;
        totalTrained += result.trainedCount;
        totalCold += result.coldCount;
        companiesProcessed++;
        // created_by = 회사 대표 admin(예측 자동 차감의 설정 주체). 없으면 null('자동').
        const adminRes = await query(
          `SELECT id FROM users WHERE company_id = $1::uuid AND user_type = 'company_admin' ORDER BY id LIMIT 1`,
          [row.id]
        );
        // 성공 후 차감 — 회사+날짜 멱등키로 하루 1회 보장(재시작·재진입 중복 차감 0).
        await deductCreditSafe({
          companyId: row.id,
          cost,
          source: 'predictive-daily',
          createdBy: adminRes.rows[0]?.id || null,
          idempotencyKey: `predictive-daily:${row.id}:${todayKst}`,
        });
      } catch (err: any) {
        console.warn('[PredictiveWorker] 회사 batch 오류, skip:', row.id, err?.message);
      }
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(`[PredictiveWorker] 매일 batch 완료 — 회사 ${companiesProcessed}개 / customer ${totalUpdated}명 갱신 (trained ${totalTrained} / cold ${totalCold} / 크레딧부족 skip ${creditSkipped}) / ${(elapsedMs / 1000).toFixed(1)}s`);
  } catch (err: any) {
    console.error('[PredictiveWorker] batch 진입 오류:', err?.message);
  } finally {
    workerRunning = false;
  }
}

/**
 * Event-driven 진입점 — 신규 customer 등록 / 기존 customer 활동 update 직후 호출
 * (customer-upsert.ts + cdp-events.ts에서 호출 가능 — 우선순위 낮은 경우는 batch 의존)
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
