/**
 * predictive-worker.ts (D197 2026-05-22, D210+ Phase 3 2026-05-23, 매일 1회 전환 2026-06-02)
 *
 * Phase B-2 Predictive Suite — 매일 KST 오전 9시 cron worker
 *
 * 역할:
 *  - 연동 회사(싱크에이전트/SDK) 대상 매일 1회 customer 예측 점수 자동 갱신 + DB 규모별 일일 차감(회사+날짜 멱등)
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
import { dailyDbAnalysisCredits, kstDateTag, kstHour } from './ai-credit-calc';
import { ACTIVE_PAID_PLAN_WHERE } from './plan-guard';

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
  console.log('[PredictiveWorker] worker 시작 — 매일 KST 오전 9시 연동 회사 예측 점수 갱신 (DB 규모별 일일 차감 · 회사+날짜 멱등)');

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

/**
 * 예측 일괄 실행 코어 — 시간 가드 없이 즉시 1회 실행(멱등키 회사+날짜 유지 = 같은 날 중복 차감 0).
 *  스케줄(runPredictiveBatch, 매일 KST 9시)과 슈퍼관리자 수동 트리거(POST /admin/predictive/run-now)가 공유.
 *  대상 = 요금제 가입 회사(ACTIVE_PAID_PLAN_WHERE = FREE 제외·구독 만료/정지 제외) + 고객 DB 보유.
 *    ★ 크레딧 모델 v2(2026-07-01 Harold 확정): "요금제 쓰는 회사는 데이터 올라가 있으면 매일 분석·차감".
 *      predictive_enabled 토글 폐지(무시) — 연동 여부와 무관하게 요금제·고객 보유만으로 대상 판정.
 *    분석 차감액 = 회사별 고객 수 기준 dailyDbAnalysisCredits. 고객 0 = 차감 0 → skip. 크레딧 부족 = 예측 skip(무과금).
 */
export async function runPredictiveBatchNow(): Promise<{
  ran: boolean;
  companiesProcessed: number;
  totalUpdated: number;
  creditSkipped: number;
  elapsedMs: number;
}> {
  if (workerRunning) {
    console.log('[PredictiveWorker] batch 진행 중 — skip');
    return { ran: false, companiesProcessed: 0, totalUpdated: 0, creditSkipped: 0, elapsedMs: 0 };
  }

  workerRunning = true;
  const startedAt = Date.now();
  const todayKst = kstDateTag(new Date());
  let totalUpdated = 0;
  let totalTrained = 0;
  let totalCold = 0;
  let companiesProcessed = 0;
  let creditSkipped = 0;

  try {
    // 대상 = 요금제 가입 회사 전체(FREE 제외·구독 만료/정지 제외) + 고객 DB 보유. predictive_enabled 토글 무시.
    //   분석 차감액은 회사별 DB 규모(고객 수)로 산정 → 루프 안에서 계산.
    const companyRes = await query(
      `SELECT DISTINCT c.id
         FROM companies c
         JOIN plans p ON c.plan_id = p.id
        WHERE ${ACTIVE_PAID_PLAN_WHERE}
          AND EXISTS (SELECT 1 FROM customers cu WHERE cu.company_id = c.id)
        ORDER BY c.id`
    );

    for (const row of companyRes.rows) {
      // DB 규모 기준 일일 분석 차감액 (요금제 가입 회사 매일 1회, v2). 고객 수 0 = 차감 0 → skip.
      const cntRes = await query(`SELECT COUNT(*)::int AS n FROM customers WHERE company_id = $1::uuid`, [row.id]);
      const cost = dailyDbAnalysisCredits(Number(cntRes.rows[0]?.n) || 0);
      if (cost <= 0) continue;
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
        // ★ 2026-07-02 3단계 (Harold 확정): 같은 일일 분석 차감 1회에 "오늘의 추천" 브리핑 동반 생성(추가 차감 0).
        //   실패는 예측·발송에 영향 0 — 격리 후 다음 날 사이클이 재시도.
        try {
          const { generateCompanyDailyBrief } = await import('./company-daily-brief');
          const brief = await generateCompanyDailyBrief(row.id);
          if (brief.saved) {
            console.log(`[PredictiveWorker] 일일 브리핑 저장 company=${row.id} 추천 ${brief.recommendationCount}건 (AI ${brief.aiCalled ? 1 : 0}회)`);
          }
        } catch (briefErr: any) {
          console.warn('[PredictiveWorker] 일일 브리핑 생성 skip:', row.id, briefErr?.message);
        }
      } catch (err: any) {
        console.warn('[PredictiveWorker] 회사 batch 오류, skip:', row.id, err?.message);
      }
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(`[PredictiveWorker] 매일 batch 완료 — 회사 ${companiesProcessed}개 / customer ${totalUpdated}명 갱신 (trained ${totalTrained} / cold ${totalCold} / 크레딧부족 skip ${creditSkipped}) / ${(elapsedMs / 1000).toFixed(1)}s`);
    return { ran: true, companiesProcessed, totalUpdated, creditSkipped, elapsedMs };
  } catch (err: any) {
    console.error('[PredictiveWorker] batch 진입 오류:', err?.message);
    return { ran: true, companiesProcessed, totalUpdated, creditSkipped, elapsedMs: Date.now() - startedAt };
  } finally {
    workerRunning = false;
  }
}

/**
 * 스케줄 진입점 — 30분 주기로 깨어 KST 오전 9시대 하루 1회만 runPredictiveBatchNow 실행.
 *  가드(시간·하루 1회)는 여기, 실제 처리·멱등 차감은 runPredictiveBatchNow가 담당.
 */
async function runPredictiveBatch(): Promise<void> {
  const now = new Date();
  if (kstHour(now) !== PREDICTIVE_RUN_HOUR_KST) return;
  const todayKst = kstDateTag(now);
  if (lastBatchDateKst === todayKst) return;
  lastBatchDateKst = todayKst;
  await runPredictiveBatchNow();
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
