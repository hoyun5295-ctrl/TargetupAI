/**
 * company-daily-brief.ts — 오늘의 추천: 회사 일일 마케팅 브리핑 엔진 (2026-07-02 3단계)
 *
 * 흐름 (Harold 확정 원가 구조):
 *  - predictive-worker 매일 KST 9시 사이클에 합류 — DB 규모별 일일 분석 차감 1회에 포함(추가 차감 0).
 *  - 수집은 전부 SQL·읽기 전용(원가 0): 고객 DB 실측 신호(journey-opportunities 재사용) +
 *    회사 누적 학습(ai_company_memory + 최근 30일 캠페인 이력) + 운영 중 오퍼레이터.
 *  - AI 종합 판단 1회(회사당 하루 1회 고정) → 추천 카드 최대 3건. 문안 생성·검수·스팸테스트 같은
 *    비싼 체인은 담당자가 카드를 눌러 자동마케팅을 시작하는 순간에만 실행.
 *  - 신호 0건 = AI 호출 없이 빈 브리핑 저장(insufficient_data 정직 · 원가 0).
 *
 * 안전망: company_daily_briefs 테이블 미생성 환경에서는 저장을 조용히 skip(CREATE 후 자동 활성).
 */

import { query } from '../config/database';
import { callAIWithFallback } from '../services/ai';
import { buildCompanyMemoryContext } from '../services/ai-orchestrator';
import { buildJourneyOpportunities } from './journey-opportunities';
import { kstYesterdayRange } from './autosend-policy';
import {
  sanitizeBriefRecommendations, extractJsonObject,
  buildDailyBriefSystemPrompt, buildDailyBriefUserMessage,
  BriefRecommendation, BriefSignalOpportunity, YesterdayRecapSummary, PromotionCandidate,
} from './daily-brief-policy';

export interface DailyBriefResult {
  saved: boolean;
  recommendationCount: number;
  aiCalled: boolean;
}

export async function generateCompanyDailyBrief(companyId: string): Promise<DailyBriefResult> {
  // 1. 신호 수집 — 전부 실데이터·읽기 전용. 개별 실패는 빈 값으로 격리(브리핑이 발송·예측에 영향 0).
  const { start: yStart, end: yEnd } = kstYesterdayRange();
  const [opps, memoryBlock, opsRes, pendRes, recapRes, promoRes] = await Promise.all([
    buildJourneyOpportunities(companyId).catch((e: any) => {
      console.warn('[DailyBrief] 신호 수집 경고:', e?.message);
      return [] as Awaited<ReturnType<typeof buildJourneyOpportunities>>;
    }),
    buildCompanyMemoryContext(companyId).catch(() => ''),
    query(
      `SELECT name, objective FROM continuous_operators
        WHERE company_id = $1::uuid AND status IN ('active', 'paused_no_credit')`,
      [companyId],
    ).catch(() => ({ rows: [] as any[] })),
    query(
      `SELECT COUNT(*)::int AS n FROM operator_proposals
        WHERE company_id = $1::uuid AND status IN ('pending', 'admin_review')`,
      [companyId],
    ).catch(() => ({ rows: [{ n: 0 }] as any[] })),
    // ★ 5차: 어제 자동마케팅 발송 성과 실측(회고 문자와 동일 축) — 발송·성공 = campaigns, 클릭 = 변이 실측 누적
    query(
      `SELECT COUNT(*)::int AS campaigns,
              COALESCE(SUM(c.sent_count), 0)::int AS sent,
              COALESCE(SUM(c.success_count), 0)::int AS success,
              COALESCE(SUM((SELECT SUM(v.click_count) FROM operator_proposal_variants v WHERE v.proposal_id = p.id)), 0)::int AS clicked
         FROM operator_proposals p
         JOIN campaigns c ON c.id = p.campaign_id
        WHERE p.company_id = $1::uuid AND p.status = 'sent' AND p.campaign_id IS NOT NULL
          AND p.auto_sent_at >= $2 AND p.auto_sent_at < $3`,
      [companyId, yStart.toISOString(), yEnd.toISOString()],
    ).catch(() => ({ rows: [] as any[] })),
    // ★ 5차: 여정 정착 후보 — 발송·클릭 실측 누적(변이 테이블). 30/5 = 통계 최소 표본 가드(데이터 충분성 — 사업 지표 아님)
    query(
      `SELECT o.name, o.objective,
              COALESCE(SUM(v.sent_count), 0)::int AS sent,
              COALESCE(SUM(v.click_count), 0)::int AS clicks
         FROM continuous_operators o
         JOIN operator_proposals p ON p.operator_id = o.id
         JOIN operator_proposal_variants v ON v.proposal_id = p.id
        WHERE o.company_id = $1::uuid AND o.status = 'active'
        GROUP BY o.id, o.name, o.objective
       HAVING COALESCE(SUM(v.sent_count), 0) >= 30 AND COALESCE(SUM(v.click_count), 0) >= 5
        LIMIT 5`,
      [companyId],
    ).catch(() => ({ rows: [] as any[] })),
  ]);

  const opportunities: BriefSignalOpportunity[] = (opps as any[]).map((o) => ({
    type: String(o.type),
    title: String(o.title),
    count: Number(o.count) || 0,
    valueAtStake: Number(o.valueAtStake) || 0,
    suggestedObjective: String(o.suggestedObjective || ''),
  }));
  const activeOperators = (opsRes.rows as any[]).map((r) => ({ name: String(r.name), objective: String(r.objective) }));
  const pendingProposals = Number((pendRes.rows as any[])[0]?.n) || 0;
  const recapRow = (recapRes.rows as any[])[0];
  const yesterdayRecap: YesterdayRecapSummary | null = recapRow
    ? { campaigns: Number(recapRow.campaigns) || 0, sent: Number(recapRow.sent) || 0, success: Number(recapRow.success) || 0, clicked: Number(recapRow.clicked) || 0 }
    : null;
  const promotionCandidates: PromotionCandidate[] = (promoRes.rows as any[]).map((r) => ({
    name: String(r.name), objective: String(r.objective), sent: Number(r.sent) || 0, clicks: Number(r.clicks) || 0,
  }));

  // 2. AI 종합 판단 — 신호 0건이면 호출하지 않는다(억지 추천·불필요 원가 차단).
  let headline = '';
  let recommendations: BriefRecommendation[] = [];
  let aiCalled = false;
  // 신호 또는 정착 후보가 있어야 AI 호출 (억지 추천·불필요 원가 차단)
  if ((opportunities.length > 0 || promotionCandidates.length > 0) && process.env.ANTHROPIC_API_KEY) {
    try {
      const text = await callAIWithFallback({
        system: buildDailyBriefSystemPrompt(),
        userMessage: buildDailyBriefUserMessage({ memoryBlock, opportunities, activeOperators, pendingProposals, yesterdayRecap, promotionCandidates }),
        maxTokens: 1600,
        temperature: 0.4,
        model: 'opus',
        companyId,
        source: 'daily-brief',
        creditCost: 0, // 일일 분석 차감(predictive-daily 멱등 1회)에 포함 — 별도 차감 0 (Harold 확정 2026-07-02)
      });
      aiCalled = true;
      const parsed = extractJsonObject(text);
      headline = String(parsed?.headline || '').trim().slice(0, 200);
      recommendations = sanitizeBriefRecommendations(parsed?.recommendations, opportunities);
    } catch (err: any) {
      console.warn('[DailyBrief] AI 종합 판단 실패 — 빈 브리핑으로 저장:', err?.message);
    }
  }

  // 3. 저장 — KST 날짜 기준 회사당 하루 1행 UPSERT.
  try {
    await query(
      `INSERT INTO company_daily_briefs (id, company_id, brief_date, headline, recommendations, signals, created_at)
       VALUES (gen_random_uuid(), $1::uuid, (NOW() AT TIME ZONE 'Asia/Seoul')::date, $2, $3::jsonb, $4::jsonb, NOW())
       ON CONFLICT (company_id, brief_date) DO UPDATE SET
         headline = EXCLUDED.headline,
         recommendations = EXCLUDED.recommendations,
         signals = EXCLUDED.signals,
         created_at = NOW()`,
      [
        companyId,
        headline,
        JSON.stringify(recommendations),
        JSON.stringify({ opportunities, activeOperators, pendingProposals, yesterdayRecap, promotionCandidates }),
      ],
    );
    return { saved: true, recommendationCount: recommendations.length, aiCalled };
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('does not exist')) {
      // 테이블 미생성(마이그레이션 전) — 조용히 skip. CREATE 후 다음 사이클부터 자동 저장.
      console.warn('[DailyBrief] company_daily_briefs 미생성 — 저장 skip (CREATE TABLE 대기)');
      return { saved: false, recommendationCount: recommendations.length, aiCalled };
    }
    throw err;
  }
}
