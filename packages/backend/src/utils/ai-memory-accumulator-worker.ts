// packages/backend/src/utils/ai-memory-accumulator-worker.ts
// 2026-05-26 신설 / 2026-06-13 통합 — 1시간 cron으로 ① 여정 완료 학습 ② 등급별 고객 인사이트
//   ③ 타입별 상한 초과 메모리 정리를 함께 수행한다.
//
// 정직성(2026-06-13): 여정 실클릭(cdp_events)이 적재되기 전에는 clickCount 0이라 company-memory
//   게이트에서 학습이 보류된다(가짜 0% 차단). 등급 인사이트는 customers 실측만 사용(cdp 불요).

import { query } from '../config/database';
import { recordCampaignLearning, addMemory, cleanupDeprecatedMemories } from './company-memory';
import { buildCustomerInsights } from './ai-memory-customer-insight';
import { pickMemoriesToPrune } from './ai-memory-text';

const INTERVAL_MS = 60 * 60 * 1000; // 1시간
const INSIGHT_MIN_SAMPLE = 10;      // 등급별 최소 표본 (미만 = 인사이트 생성 보류)
const INSIGHT_BATCH = 50;           // 1 tick 당 인사이트 갱신 회사 수
// 타입별 메모리 보존 상한 — 초과분은 저신호(낮은 importance→오래됨→낮은 usage) 우선 삭제.
const TYPE_CAPS: Record<string, number> = {
  success_pattern: 50,
  channel_performance: 10,
  customer_insight: 10,
  compliance_learning: 30,
  brand_tone_evolution: 20,
};

let _workerTimer: NodeJS.Timeout | null = null;
let _workerRunning = false;

/** 1시간 cron tick — 여정 학습 + 등급 인사이트 + 수명관리. idempotent. */
export async function runAiMemoryAccumulatorTick(): Promise<void> {
  if (_workerRunning) return;
  _workerRunning = true;
  try {
    const journeyLearned = await accumulateJourneyLearning();
    const insightCompanies = await accumulateCustomerInsights();
    const pruned = await pruneOverCapMemories();
    if (journeyLearned || insightCompanies || pruned) {
      console.log(
        `[ai-memory-accumulator] tick — 여정 ${journeyLearned} / 등급인사이트 ${insightCompanies}사 / 정리 ${pruned}건`,
      );
    }
  } catch (err: any) {
    console.log(`[ai-memory-accumulator] tick 진입 오류 — ${err?.message || 'unknown'}`);
  } finally {
    _workerRunning = false;
  }
}

// 1) 여정 완료 학습 — 7일 내 완료 execution 회사·여정별 집계 후 recordCampaignLearning.
async function accumulateJourneyLearning(): Promise<number> {
  const recentRes = await query(
    `SELECT e.company_id, e.journey_id, j.name AS journey_name,
            COUNT(*) FILTER (WHERE e.status IN ('completed', 'sent')) AS sent_count
       FROM journey_executions e
       JOIN journeys j ON j.id = e.journey_id
      WHERE e.completed_at >= NOW() - INTERVAL '7 days'
        AND e.completed_at <= NOW()
      GROUP BY e.company_id, e.journey_id, j.name
      HAVING COUNT(*) >= 10`,
  );
  let learned = 0;
  for (const row of recentRes.rows) {
    try {
      const sentCount = Number(row.sent_count) || 0;
      if (sentCount < 10) continue;
      await recordCampaignLearning({
        companyId: row.company_id,
        campaignId: row.journey_id,
        campaignName: row.journey_name || '여정 자동 발송',
        channel: 'mixed',
        targetCriteria: 'journey_executor',
        messageBody: '', // 여정 실클릭(cdp_events) 연결은 데이터 적재 후 후속 단계
        sentCount,
        clickCount: 0,
        conversionCount: 0,
        hasConversionData: false, // cdp_events 0건 — 전환 데이터 없음(가짜 전환율 차단)
        isAd: false,
      });
      learned += 1;
    } catch (err: any) {
      console.log(`[ai-memory-accumulator] journey=${row.journey_id} 오류 — ${err?.message || 'unknown'}`);
    }
  }
  return learned;
}

// 2) 등급별 고객 인사이트 — customers 실측 집계(cdp 불요). 회사+20h 멱등(UPSERT).
//    qualifying 등급(표본 ≥ MIN_SAMPLE)이 있는 회사만 선정 → 0 인사이트 회사 재선정 방지.
async function accumulateCustomerInsights(): Promise<number> {
  const companies = await query(
    `SELECT co.id AS company_id
       FROM companies co
      WHERE EXISTS (
              SELECT 1 FROM customers c
               WHERE c.company_id = co.id AND c.grade IS NOT NULL AND c.grade <> ''
               GROUP BY c.grade HAVING COUNT(*) >= $1
            )
        AND NOT EXISTS (
              SELECT 1 FROM ai_company_memory m
               WHERE m.company_id = co.id AND m.memory_type = 'customer_insight'
                 AND m.source = 'ai_auto' AND m.updated_at >= NOW() - INTERVAL '20 hours'
            )
      ORDER BY co.id
      LIMIT $2`,
    [INSIGHT_MIN_SAMPLE, INSIGHT_BATCH],
  );
  let done = 0;
  for (const row of companies.rows) {
    const companyId = row.company_id;
    try {
      const gradeRes = await query(
        `SELECT grade,
                COUNT(*)::int AS customer_count,
                AVG(COALESCE(total_purchase_amount, 0))::float AS avg_amount,
                AVG(COALESCE(purchase_count, 0))::float AS avg_count,
                AVG(COALESCE(ltv_score, 0))::float AS avg_ltv
           FROM customers
          WHERE company_id = $1::uuid AND grade IS NOT NULL AND grade <> ''
          GROUP BY grade`,
        [companyId],
      );
      const overallRes = await query(
        `SELECT AVG(COALESCE(total_purchase_amount, 0))::float AS avg_amount,
                AVG(COALESCE(purchase_count, 0))::float AS avg_count
           FROM customers WHERE company_id = $1::uuid`,
        [companyId],
      );
      const insights = buildCustomerInsights({
        grades: gradeRes.rows.map((r: any) => ({
          grade: String(r.grade),
          customerCount: Number(r.customer_count) || 0,
          avgPurchaseAmount: Number(r.avg_amount) || 0,
          avgPurchaseCount: Number(r.avg_count) || 0,
          avgLtvScore: Number(r.avg_ltv) || 0,
        })),
        overallAvgPurchaseAmount: Number(overallRes.rows[0]?.avg_amount) || 0,
        overallAvgPurchaseCount: Number(overallRes.rows[0]?.avg_count) || 0,
        minSample: INSIGHT_MIN_SAMPLE,
      });
      for (const ins of insights) {
        await addMemory({
          companyId,
          memoryType: 'customer_insight',
          memoryKey: ins.memoryKey,
          memoryValue: ins.memoryValue,
          importance: ins.importance,
          source: 'ai_auto',
          metadata: { grade: ins.grade, customer_count: ins.customerCount },
        });
      }
      // 활성 회사 동반 — 오래된 저영향 메모리 정리(C3)
      await cleanupDeprecatedMemories(companyId).catch(() => {});
      if (insights.length > 0) done += 1;
    } catch (err: any) {
      console.log(`[ai-memory-accumulator] customer_insight company=${companyId} 오류 — ${err?.message || 'unknown'}`);
    }
  }
  return done;
}

// 3) 타입별 상한 초과 메모리 정리 — 초과한 (회사,타입)만 골라 저신호 우선 삭제(pickMemoriesToPrune).
async function pruneOverCapMemories(): Promise<number> {
  let deleted = 0;
  for (const [type, cap] of Object.entries(TYPE_CAPS)) {
    const over = await query(
      `SELECT company_id
         FROM ai_company_memory
        WHERE memory_type = $1
        GROUP BY company_id
        HAVING COUNT(*) > $2
        LIMIT 100`,
      [type, cap],
    );
    for (const row of over.rows) {
      try {
        const mems = await query(
          `SELECT id, memory_type, importance,
                  COALESCE(usage_count, 0)::int AS usage_count,
                  (EXTRACT(EPOCH FROM last_accessed_at) * 1000)::bigint AS accessed_ms
             FROM ai_company_memory
            WHERE company_id = $1::uuid AND memory_type = $2`,
          [row.company_id, type],
        );
        const ids = pickMemoriesToPrune(
          mems.rows.map((m: any) => ({
            id: String(m.id),
            memoryType: String(m.memory_type),
            importance: Number(m.importance) || 5,
            usageCount: Number(m.usage_count) || 0,
            lastAccessedAt: Number(m.accessed_ms) || 0,
          })),
          { [type]: cap },
        );
        if (ids.length > 0) {
          await query(`DELETE FROM ai_company_memory WHERE id = ANY($1::uuid[])`, [ids]);
          deleted += ids.length;
        }
      } catch (err: any) {
        console.log(`[ai-memory-accumulator] prune company=${row.company_id} type=${type} 오류 — ${err?.message || 'unknown'}`);
      }
    }
  }
  return deleted;
}

export function startAiMemoryAccumulatorWorker(): void {
  if (_workerTimer) return;
  _workerTimer = setInterval(() => {
    runAiMemoryAccumulatorTick().catch((e) =>
      console.log(`[ai-memory-accumulator] interval 오류 — ${(e as Error).message}`),
    );
  }, INTERVAL_MS);
  console.log('[ai-memory-accumulator] 1시간 cron worker 시작');
}

export function stopAiMemoryAccumulatorWorker(): void {
  if (_workerTimer) {
    clearInterval(_workerTimer);
    _workerTimer = null;
  }
}
