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
// ★ 2026-07-04 Tier 1 반응 신호 — DM 클릭(updateTrainingMetrics.clickCount) + 이메일 클릭(updateTrainingEngagement)
import { getSourceRef, updateTrainingMetrics, updateTrainingEngagement } from './training-logger';
// ★ 2026-07-04 학습 루프 ②: 거부 제안 → "피할 것" 증류 (negative 신호 첫 활용)
import { callAIWithFallback } from '../services/ai';

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
    // ★ 2026-07-04 학습 루프 ②: 거부 제안 5건+ 회사의 "피할 것" 증류 (주간 멱등·tick당 5사 상한)
    const avoidLearned = await accumulateAvoidPatterns();
    const pruned = await pruneOverCapMemories();
    if (journeyLearned || insightCompanies || dmLearned || emailLearned || avoidLearned || pruned) {
      console.log(
        `[ai-memory-accumulator] tick — 여정 ${journeyLearned} / 등급인사이트 ${insightCompanies}사 / DM ${dmLearned} / 이메일 ${emailLearned} / 거부증류 ${avoidLearned}사 / 정리 ${pruned}건`,
      );
    }
  } catch (err: any) {
    console.log(`[ai-memory-accumulator] tick 진입 오류 — ${err?.message || 'unknown'}`);
  } finally {
    _workerRunning = false;
  }
}

// 1) 여정 완료 학습 — 7일 내 완료 execution 회사·여정별 집계 후 recordCampaignLearning.
//    ★ 2026-07-12 — 실클릭 연결: clickCount 0 하드코딩은 게이트(shouldRecordCampaignLearning)가 항상 차단해
//    여정 학습이 영구 보류였다. Codex 1R 정정 2건 반영:
//    - 분모 = status 목록이 아니라 "실발송 step 존재(journey_step_logs status='sent')" — goal_met은 발송 전에도
//      찍힐 수 있어(0710 조기 이탈) status 기준 분모는 미발송 인원을 포함한다.
//    - 클릭 = 이 여정 귀속만: 단축링크 클릭 이벤트가 properties.journey_id를 기록(short-url 적재·journey-stats 소비
//      — 배포 중 컬럼/키)하므로 매칭에 포함. 같은 고객의 타 캠페인·타 여정 클릭 오탐 차단.
//    - 신원 = 컬럼 customer_id(익명 클릭은 NULL) OR properties.customer_id(short-url 토큰 resolve 값) 2축.
//      단, source='short_url_click' + short_url_hash 존재로 서버 기록 이벤트에 한정(Codex 3R — CDP API/SDK가
//      properties를 임의 전송할 수 있어 소스 무제한이면 위조 클릭이 학습에 유입. 'short_url_click'은 리다이렉트
//      핸들러 전용 마커·SDK ingest는 'sdk' 하드코딩·CDP API는 키 provider라 클라이언트가 설정 불가).
//    실측 0이면 지금처럼 보류(가짜 0% 차단 원칙 유지).
async function accumulateJourneyLearning(): Promise<number> {
  const recentRes = await query(
    `SELECT e.company_id, e.journey_id, j.name AS journey_name,
            COUNT(*) FILTER (
              WHERE EXISTS (
                SELECT 1 FROM journey_step_logs jsl2
                 WHERE jsl2.execution_id = e.id AND jsl2.status = 'sent'
              )
            ) AS sent_count,
            COUNT(*) FILTER (
              WHERE EXISTS (
                SELECT 1 FROM journey_step_logs jsl
                  JOIN cdp_events ce ON ce.company_id = e.company_id
                   AND ce.source = 'short_url_click'
                   AND ce.properties->>'short_url_hash' IS NOT NULL
                   AND ce.event_name = 'message_click'
                   AND ce.properties->>'journey_id' = e.journey_id::text
                   AND (ce.customer_id = e.customer_id OR ce.properties->>'customer_id' = e.customer_id::text)
                   AND ce.occurred_at >= jsl.sent_at
                 WHERE jsl.execution_id = e.id AND jsl.status = 'sent'
              )
            ) AS click_count
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
        messageBody: '',
        sentCount,
        clickCount: Number(row.click_count) || 0, // 실측 클릭 수신자 수 — 0이면 CT 게이트가 보류
        conversionCount: 0,
        hasConversionData: false, // 전환 데이터 미연결 — 가짜 전환율 차단
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
  // ★ Codex 1R — qualifying 등급이 0이 된 회사도 stale 자동 인사이트가 남아 있으면 선정(정리 전용 진입).
  //   정리 후 다음 tick부터는 두 branch 모두 거짓이라 자연 이탈 — 무한 재선정 없음.
  const companies = await query(
    `SELECT co.id AS company_id
       FROM companies co
      WHERE (
              EXISTS (
                SELECT 1 FROM customers c
                 WHERE c.company_id = co.id AND c.grade IS NOT NULL AND c.grade <> ''
                 GROUP BY c.grade HAVING COUNT(*) >= $1
              )
              OR EXISTS (
                SELECT 1 FROM ai_company_memory ms
                 WHERE ms.company_id = co.id AND ms.memory_type = 'customer_insight'
                   AND ms.source = 'ai_auto' AND ms.metadata->>'grade' IS NOT NULL
                   AND ms.memory_key LIKE 'grade\\_%' ESCAPE '\\'
              )
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
      // ★ 2026-07-12 (Codex 1R 정정) — 사라진 등급의 stale 인사이트 정리: 자동 생성된 grade_* 행 중 이번 실측에
      //   없는 등급 삭제(등급 폐지·표본 미달 전환분 — importance 7이라 90일 정리 대상 밖 = 영구 잔존이던 결함).
      //   인사이트 0건이어도 실행(qualifying 등급 전멸 = 전부 stale). 경계 3중:
      //   source='ai_auto'(admin CRUD는 서버가 admin_input 강제) + metadata.grade 구조 마커(워커 기록분만 보유)
      //   + LIKE ESCAPE 명시(literal 언더스코어).
      await query(
        `DELETE FROM ai_company_memory
          WHERE company_id = $1::uuid
            AND memory_type = 'customer_insight'
            AND source = 'ai_auto'
            AND metadata->>'grade' IS NOT NULL
            AND memory_key LIKE 'grade\\_%' ESCAPE '\\'
            AND NOT (memory_key = ANY($2::text[]))`,
        [companyId, insights.map((i) => i.memoryKey)],
      ).catch((e: any) => console.log(`[ai-memory-accumulator] stale grade 정리 오류 — ${e?.message || 'unknown'}`));
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
        // ★ 2026-07-04 Tier 1: 클릭 수신자 수(clickedCount) — 랭커·검색기의 반응 기반 정렬 신호
        clickCount: clickedCount,
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

      // ★ 2026-07-04 Tier 1: 이메일 클릭을 문안 학습 코퍼스에 환류 — 반응 신호만 갱신
      //   (sent/success는 발송 시점 SMTP 실측이 진실 — updateTrainingMetrics 절대값 SET로 덮지 않는다)
      void updateTrainingEngagement(getSourceRef(row.id), Number(row.click_count) || 0, null);
    } catch (err: any) {
      console.log(`[ai-memory-accumulator] email=${row.id} 오류 — ${err?.message || 'unknown'}`);
    }
  }
  return learned;
}

// 6) ★ 2026-07-04 학습 루프 ②: 거부 제안 → "피할 것" 증류.
//    최근 30일 rejected 제안 5건+ 회사만, 기존 증류가 7일 내면 skip(멱등·LLM 비용 가드), tick당 5사 상한.
//    산출 = ai_company_memory(brand_tone_evolution/avoid_patterns 단일 행 upsert) →
//    buildMemoryPromptContext 경유로 Operator + 문안 생성(composeCopyBrain ③)에 자동 주입.
async function accumulateAvoidPatterns(): Promise<number> {
  const companies = await query(
    `SELECT p.company_id, COUNT(*)::int AS cnt
       FROM operator_proposals p
      WHERE p.status = 'rejected'
        AND p.created_at >= NOW() - INTERVAL '30 days'
        AND NOT EXISTS (
              SELECT 1 FROM ai_company_memory m
               WHERE m.company_id = p.company_id
                 AND m.memory_type = 'brand_tone_evolution'
                 AND m.memory_key = 'avoid_patterns'
                 AND m.updated_at >= NOW() - INTERVAL '7 days'
            )
      GROUP BY p.company_id
     HAVING COUNT(*) >= 5
      LIMIT 5`,
  );
  let learned = 0;
  for (const row of companies.rows) {
    try {
      const proposals = await query(
        `SELECT proposal_json FROM operator_proposals
          WHERE company_id = $1::uuid AND status = 'rejected'
            AND created_at >= NOW() - INTERVAL '30 days'
          ORDER BY created_at DESC LIMIT 10`,
        [row.company_id],
      );
      // proposal_json.messages에서 문안 텍스트 방어적 추출 (variant 구조 키 여러 형태 대응)
      const texts: string[] = [];
      for (const p of proposals.rows) {
        const pj = typeof p.proposal_json === 'string' ? JSON.parse(p.proposal_json) : p.proposal_json;
        const msgs = Array.isArray(pj?.messages) ? pj.messages : [];
        for (const m of msgs) {
          const t = String(m?.message_text || m?.lms_text || m?.sms_text || m?.body || '').trim();
          if (t.length >= 20) texts.push(t.slice(0, 300));
          if (texts.length >= 15) break;
        }
        if (texts.length >= 15) break;
      }
      if (texts.length < 3) continue; // 표본 부족 — 증류 보류(가짜 패턴 차단)

      const raw = await callAIWithFallback({
        system:
          '너는 마케팅 카피 분석가다. 아래는 이 회사 담당자가 "거부"한 AI 제안 문안들이다. '
          + '거부된 문안들의 공통 문제 패턴을 3~5개 추출한다. 특정 문안의 문장을 인용하지 말고 패턴만(예: "과도한 감탄사", "혜택 없이 긴 인사말"). '
          + 'JSON 배열만 출력: ["패턴1","패턴2"]',
        userMessage: texts.map((t, i) => `${i + 1}. ${t.replace(/\n/g, ' / ')}`).join('\n'),
        maxTokens: 500,
        temperature: 0.2,
        model: 'sonnet',
        creditCost: 0, // 내부 학습 — 사용자 크레딧 차감 없음
      });
      const m = raw.match(/\[[\s\S]*\]/);
      if (!m) continue;
      let donts: string[] = [];
      try { donts = (JSON.parse(m[0]) as any[]).map(String).filter((s) => s.trim()).slice(0, 5); } catch { continue; }
      if (donts.length === 0) continue;

      await addMemory({
        companyId: row.company_id,
        memoryType: 'brand_tone_evolution',
        memoryKey: 'avoid_patterns',
        memoryValue: `담당자가 거부한 제안들의 공통 패턴: 새 문안에서 피할 것: ${donts.join(' / ')}`,
        importance: 7,
        source: 'reject_distill',
        metadata: { sample_count: texts.length, rejected_30d: Number(row.cnt) || 0 },
      });
      learned += 1;
    } catch (err: any) {
      console.log(`[ai-memory-accumulator] avoid company=${row.company_id} 오류 — ${err?.message || 'unknown'}`);
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
