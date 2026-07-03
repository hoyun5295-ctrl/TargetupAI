// packages/backend/src/utils/ai-memory-accumulator-worker.ts
// 2026-05-26 신설 / 2026-06-13 통합 — 1시간 cron으로 ① 여정 완료 학습 ② 등급별 고객 인사이트
//   ③ 타입별 상한 초과 메모리 정리를 함께 수행한다.
//
// 정직성(2026-06-13): 여정 실클릭(cdp_events)이 적재되기 전에는 clickCount 0이라 company-memory
//   게이트에서 학습이 보류된다(가짜 0% 차단). 등급 인사이트는 customers 실측만 사용(cdp 불요).

import { query } from '../config/database';
import {
  recordCampaignLearning, addMemory, cleanupDeprecatedMemories,
  recordDmEngagementLearning, recordEmailEngagementLearning,
} from './company-memory';
import { buildCustomerInsights } from './ai-memory-customer-insight';
import { pickMemoriesToPrune } from './ai-memory-text';
// ★ 2026-07-02(5) DM 참여 학습 — 추적 endpoint와 동일 CT로 수신자 행 집계 (이중 진실 차단)
import { getDmRecipientEngagementRows, getDmDetail, extractFlatSectionsFromDm } from './dm/dm-builder';
import { sanitizeSectionInteractions, sumSectionClicks, isDmCompleted, buildDmSectionLabel } from './dm/dm-tracking';
// ★ 2026-07-03 DM 성과 라벨을 문안 학습 코퍼스(ai_training_logs)에도 환류 (전 채널 학습 통합 Phase 1d)
import { getSourceRef, updateTrainingMetrics } from './training-logger';

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
    // ★ 2026-07-02(5) Harold 지시 — DM·이메일 추적 데이터를 회사 AI 학습 메모리로 자동 전송
    const dmLearned = await accumulateDmEngagement();
    const emailLearned = await accumulateEmailEngagement();
    const pruned = await pruneOverCapMemories();
    if (journeyLearned || insightCompanies || dmLearned || emailLearned || pruned) {
      console.log(
        `[ai-memory-accumulator] tick — 여정 ${journeyLearned} / 등급인사이트 ${insightCompanies}사 / DM ${dmLearned} / 이메일 ${emailLearned} / 정리 ${pruned}건`,
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

// 4) ★ 2026-07-02(5) DM 참여 학습 — 최근 7일 열람 활동이 있는 발송 DM을 회사·DM별 집계 후 메모리 기록.
//    멱등: metadata.last_dm_id + 20h 윈도우(NOT EXISTS). 표본·실측 게이트는 record CT 내부(shouldRecordDmEngagement).
async function accumulateDmEngagement(): Promise<number> {
  const dms = await query(
    `SELECT DISTINCT t.company_id, t.dm_id, p.title
       FROM dm_recipient_tokens t
       JOIN dm_pages p ON p.id = t.dm_id
      WHERE EXISTS (
              SELECT 1 FROM dm_views v
               WHERE v.dm_id = t.dm_id AND v.last_active_at >= NOW() - INTERVAL '7 days'
            )
        AND NOT EXISTS (
              SELECT 1 FROM ai_company_memory m
               WHERE m.company_id = t.company_id
                 AND m.memory_type = 'channel_performance'
                 AND m.memory_key = 'channel_dm'
                 AND m.metadata->>'last_dm_id' = t.dm_id::text
                 AND m.updated_at >= NOW() - INTERVAL '20 hours'
            )
      LIMIT 20`,
  );
  let learned = 0;
  for (const row of dms.rows) {
    try {
      const rows = await getDmRecipientEngagementRows(row.dm_id, row.company_id);
      const sentCount = rows.length;
      let viewedCount = 0;
      let completedCount = 0;
      let clickedCount = 0;
      let respondedCount = 0;
      const sectionClicks: Record<string, number> = {};
      for (const r of rows as any[]) {
        if (r.viewed_at) viewedCount += 1;
        if (r.viewed_at && isDmCompleted(r.page_reached, r.total_pages, r.max_scroll_pct)) completedCount += 1;
        if (sumSectionClicks(r.section_interactions) > 0) clickedCount += 1;
        if (r.responded) respondedCount += 1;
        const si = sanitizeSectionInteractions(r.section_interactions);
        for (const [sid, c] of Object.entries(si)) {
          sectionClicks[sid] = (sectionClicks[sid] || 0) + c.clicks;
        }
      }
      // 최다 클릭 섹션 라벨 (클릭 실측 있을 때만 — 발행물 섹션 메타에서 라벨 구성)
      let topSectionLabel: string | undefined;
      const top = Object.entries(sectionClicks).sort((a, b) => b[1] - a[1]).find(([, n]) => n > 0);
      if (top) {
        const dm = await getDmDetail(row.dm_id, row.company_id);
        const sec = dm ? extractFlatSectionsFromDm(dm).find((s: any) => String(s?.id) === top[0]) : null;
        if (sec) topSectionLabel = buildDmSectionLabel(String((sec as any).type || ''), (sec as any).props);
      }
      const ok = await recordDmEngagementLearning({
        companyId: row.company_id,
        dmId: row.dm_id,
        dmTitle: String(row.title || '모바일DM'),
        sentCount, viewedCount, completedCount, clickedCount, respondedCount, topSectionLabel,
      });
      if (ok) learned += 1;

      // ★ 2026-07-03 DM 성과 라벨 → 문안 학습 코퍼스 환류 (fire-and-forget, 실패해도 워커 무영향).
      //   source_ref=getSourceRef(dm_id) = 1b 발송 적재와 동일 키. success=열람(viewed, SMS 클릭에 상응).
      //   updateTrainingMetrics는 절대값 SET이라 매 tick 최신 누적으로 덮어씀(멱등). 미적재 DM이면 0행 no-op.
      updateTrainingMetrics({
        sourceRef: getSourceRef(row.dm_id),
        sentCount,
        successCount: viewedCount,
        failCount: Math.max(0, sentCount - viewedCount),
      }).catch(() => { /* 학습 환류 실패는 워커·발송에 영향 없음 */ });
    } catch (err: any) {
      console.log(`[ai-memory-accumulator] dm=${row.dm_id} 오류 — ${err?.message || 'unknown'}`);
    }
  }
  return learned;
}

// 5) ★ 2026-07-02(5) 이메일 성과 학습 — 최근 7일 발송·오픈 실측 캠페인을 메모리 기록.
//    멱등: metadata.last_campaign_id + 20h 윈도우. 게이트(표본 10+·오픈 실측)는 record CT 내부.
async function accumulateEmailEngagement(): Promise<number> {
  const campaigns = await query(
    `SELECT ec.id, ec.company_id, ec.name, ec.sent_count, ec.open_count, ec.click_count
       FROM email_campaigns ec
      WHERE ec.sent_at IS NOT NULL
        AND ec.sent_at >= NOW() - INTERVAL '7 days'
        AND ec.sent_count >= 10
        AND ec.open_count > 0
        AND NOT EXISTS (
              SELECT 1 FROM ai_company_memory m
               WHERE m.company_id = ec.company_id
                 AND m.memory_type = 'channel_performance'
                 AND m.memory_key = 'channel_email'
                 AND m.metadata->>'last_campaign_id' = ec.id::text
                 AND m.updated_at >= NOW() - INTERVAL '20 hours'
            )
      LIMIT 50`,
  );
  let learned = 0;
  for (const row of campaigns.rows) {
    try {
      const ok = await recordEmailEngagementLearning({
        companyId: row.company_id,
        campaignId: row.id,
        name: String(row.name || '이메일 캠페인'),
        sentCount: Number(row.sent_count) || 0,
        openCount: Number(row.open_count) || 0,
        clickCount: Number(row.click_count) || 0,
      });
      if (ok) learned += 1;
    } catch (err: any) {
      console.log(`[ai-memory-accumulator] email=${row.id} 오류 — ${err?.message || 'unknown'}`);
    }
  }
  return learned;
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
