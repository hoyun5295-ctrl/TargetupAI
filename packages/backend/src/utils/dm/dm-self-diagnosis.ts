/**
 * CT-86 — dm-self-diagnosis.ts
 *
 * D216+ 모바일DM 강화 — 5 factor 자율 진단 + AI topInsight 도출.
 *
 * 5 factor:
 *   1. ctr — 최근 30일 열람/응답 기반 클릭률
 *   2. design_consistency — 브랜드 킷 색상 일관성
 *   3. ad_label_compliance — 광고 표기 정합 (정보통신망법)
 *   4. variable_integrity — 변수 fallback 정합
 *   5. section_order — 섹션 순서 (header → hero → cta → footer)
 *
 * 영구 룰 정합:
 *   - feedback_ai_no_arbitrary_benefit — AI 시스템 프롬프트 안 구체 혜택 X
 *   - feedback_ai_operator_model_isolation — model: 'opus'
 *   - no_model_name_ui_exposure — UI 노출 영역 모델명 X
 *
 * 호출 영역: routes/dm.ts POST /:id/self-diagnose
 */

import { query } from '../../config/database';
import { callAIWithFallback } from '../../services/ai';
import { listMemories } from '../company-memory';
import { extractJson } from './dm-ai';

// ────────────── 타입 ──────────────

export type DiagnosisFactor =
  | 'ctr'
  | 'design_consistency'
  | 'ad_label_compliance'
  | 'variable_integrity'
  | 'section_order';

export type DiagnosisStatus = 'good' | 'warning' | 'critical';

export interface DmDiagnosisFactorResult {
  factor: DiagnosisFactor;
  score: number;             // 0~100
  status: DiagnosisStatus;
  short_message: string;     // 한 줄 진단 (15~25자)
  detail?: string;
}

export type RecommendedActionType = 'ai_refine' | 'design_align' | 'variable_consistency';

export interface DmRecommendedAction {
  action: RecommendedActionType;
  priority: 'high' | 'medium' | 'low';
  reason: string;
}

export interface DmSelfDiagnosisResult {
  campaign_id: string;
  overall_score: number;
  factors: DmDiagnosisFactorResult[];
  top_insight: string;
  recommended_actions: DmRecommendedAction[];
  diagnosed_at: string;
}

// ────────────── 5 factor 평가 함수 ──────────────

async function evaluateCtr(campaignId: string, companyId: string): Promise<DmDiagnosisFactorResult> {
  const result = await query(
    `SELECT
      COUNT(DISTINCT dv.id) AS view_count,
      COUNT(DISTINCT der.id) AS interaction_count
    FROM dm_views dv
    LEFT JOIN dm_event_responses der ON der.campaign_id = dv.dm_id
      AND der.occurred_at >= NOW() - INTERVAL '30 days'
    WHERE dv.dm_id = $1 AND dv.company_id = $2
      AND dv.viewed_at >= NOW() - INTERVAL '30 days'`,
    [campaignId, companyId],
  );

  const views = Number(result.rows[0]?.view_count || 0);
  const interactions = Number(result.rows[0]?.interaction_count || 0);
  const ctr = views > 0 ? (interactions / views) * 100 : 0;

  if (views < 50) {
    return {
      factor: 'ctr',
      score: 50,
      status: 'warning',
      short_message: '데이터 부족 (열람 50건 미만)',
      detail: `현재 ${views}건 — 분석을 위해 더 많은 발송 필요`,
    };
  }
  if (ctr >= 5) {
    return { factor: 'ctr', score: 90, status: 'good', short_message: `CTR ${ctr.toFixed(1)}% — 우수` };
  }
  if (ctr >= 2) {
    return { factor: 'ctr', score: 70, status: 'warning', short_message: `CTR ${ctr.toFixed(1)}% — 평균` };
  }
  return {
    factor: 'ctr',
    score: 40,
    status: 'critical',
    short_message: `CTR ${ctr.toFixed(1)}% — 개선 필요`,
    detail: 'CTA 위치 / 카피 / 이미지 정합 검토 권장',
  };
}

async function evaluateDesignConsistency(campaignId: string): Promise<DmDiagnosisFactorResult> {
  const result = await query(`SELECT sections, brand_kit FROM dm_pages WHERE id = $1`, [campaignId]);
  const sections: any[] = parseJson(result.rows[0]?.sections) || [];
  const brandKit: any = parseJson(result.rows[0]?.brand_kit) || {};

  let issues = 0;
  for (const sec of sections) {
    if (
      sec?.type === 'header' &&
      brandKit?.primary_color &&
      sec?.props?.background_color &&
      sec.props.background_color !== brandKit.primary_color
    ) {
      issues++;
    }
  }

  if (issues === 0) {
    return { factor: 'design_consistency', score: 95, status: 'good', short_message: '디자인 일관성 우수' };
  }
  if (issues <= 2) {
    return {
      factor: 'design_consistency',
      score: 70,
      status: 'warning',
      short_message: `${issues}개 섹션 색상 불일치`,
      detail: '브랜드 킷과 다른 색상 사용 — 디자인 정합화 권장',
    };
  }
  return {
    factor: 'design_consistency',
    score: 40,
    status: 'critical',
    short_message: `${issues}개 섹션 색상 불일치`,
    detail: '브랜드 정체성 약화 위험',
  };
}

async function evaluateAdLabelCompliance(campaignId: string): Promise<DmDiagnosisFactorResult> {
  const result = await query(`SELECT sections FROM dm_pages WHERE id = $1`, [campaignId]);
  const sections: any[] = parseJson(result.rows[0]?.sections) || [];

  const hasAdLabel = sections.some(
    (sec: any) =>
      sec?.type === 'header' &&
      (sec?.props?.ad_label === true || /광고|\(광고\)/.test(sec?.props?.brand_name || sec?.props?.event_title || '')),
  );

  if (hasAdLabel) {
    return { factor: 'ad_label_compliance', score: 100, status: 'good', short_message: '광고 표기 정합' };
  }
  return {
    factor: 'ad_label_compliance',
    score: 30,
    status: 'critical',
    short_message: '광고 표기 누락',
    detail: '정보통신망법 위반 위험 — 헤더 (광고) 표기 의무',
  };
}

async function evaluateVariableIntegrity(campaignId: string): Promise<DmDiagnosisFactorResult> {
  const result = await query(`SELECT sections FROM dm_pages WHERE id = $1`, [campaignId]);
  const sections: any[] = parseJson(result.rows[0]?.sections) || [];

  let unbound = 0;
  let total = 0;
  for (const sec of sections) {
    const text = JSON.stringify(sec?.props || {});
    const vars = text.match(/%[^%\s]+%/g) || [];
    total += vars.length;
    const fallbacks: any[] = sec?.props?.variable_fallbacks || sec?.variable_fallbacks || [];
    unbound += vars.filter(
      (v) => !fallbacks.some((f: any) => f?.variable === v.replace(/%/g, '')),
    ).length;
  }

  if (total === 0) {
    return { factor: 'variable_integrity', score: 80, status: 'good', short_message: '변수 미사용' };
  }
  const integrityRate = ((total - unbound) / total) * 100;
  if (integrityRate >= 90) {
    return { factor: 'variable_integrity', score: 95, status: 'good', short_message: `변수 ${total}건 정합` };
  }
  if (integrityRate >= 70) {
    return {
      factor: 'variable_integrity',
      score: 70,
      status: 'warning',
      short_message: `${unbound}건 fallback 누락`,
      detail: '비어있는 변수 시 빈 영역 표시 위험',
    };
  }
  return {
    factor: 'variable_integrity',
    score: 40,
    status: 'critical',
    short_message: `${unbound}건 fallback 누락`,
    detail: '발송 시 빈 변수 출력 위험',
  };
}

async function evaluateSectionOrder(campaignId: string): Promise<DmDiagnosisFactorResult> {
  const result = await query(`SELECT sections FROM dm_pages WHERE id = $1`, [campaignId]);
  const sections: any[] = parseJson(result.rows[0]?.sections) || [];

  const types = sections.map((s: any) => s?.type);
  const hasHeader = types[0] === 'header';
  const hasFooter = types[types.length - 1] === 'footer';
  const hasHeroNearTop = types.slice(0, 3).includes('hero');
  const hasCta = types.includes('cta');

  let score = 100;
  const issues: string[] = [];
  if (!hasHeader) { score -= 25; issues.push('헤더 누락 (상단)'); }
  if (!hasFooter) { score -= 15; issues.push('푸터 누락 (하단)'); }
  if (!hasHeroNearTop) { score -= 20; issues.push('히어로 상단 누락'); }
  if (!hasCta) { score -= 30; issues.push('CTA 누락'); }

  if (score >= 90) {
    return { factor: 'section_order', score, status: 'good', short_message: '섹션 순서 우수' };
  }
  if (score >= 60) {
    return {
      factor: 'section_order',
      score,
      status: 'warning',
      short_message: '섹션 순서 개선 권장',
      detail: issues.join(' / '),
    };
  }
  return {
    factor: 'section_order',
    score: Math.max(score, 0),
    status: 'critical',
    short_message: '섹션 구조 미흡',
    detail: issues.join(' / '),
  };
}

// ────────────── AI topInsight 도출 ──────────────

const TOP_INSIGHT_SYSTEM = `당신은 모바일 DM 마케팅 진단 전문가입니다. 회사 컨텍스트와 5 factor 분석 결과를 기반으로 가장 시급한 개선 한 줄 (15~25자) 을 출력합니다.

**절대 금지:**
- 구체 혜택 (%/원/쿠폰/무료/사은품) 제시 금지 — 회사 admin 직접 작성 영역
- AI 도구명 / 모델명 노출 금지
- 한 줄 이상 출력 금지

**출력 형식 (JSON):**
{ "top_insight": "..." }`;

async function deriveTopInsight(
  companyId: string,
  factors: DmDiagnosisFactorResult[],
): Promise<string> {
  try {
    const memories = await listMemories(companyId, { limit: 8, minImportance: 4 });
    const memorySnippet = memories
      .map((m) => `[${m.memoryType}] ${m.memoryKey}: ${m.memoryValue}`)
      .join('\n')
      .slice(0, 1200);

    const factorSummary = factors
      .map((f) => `- ${f.factor}: ${f.status} (${f.score}점) — ${f.short_message}`)
      .join('\n');

    const userMessage = `회사 메모리:
${memorySnippet || '(없음)'}

5 factor 결과:
${factorSummary}

가장 시급한 개선 한 줄 (15~25자) 출력.`;

    const text = await callAIWithFallback({
      system: TOP_INSIGHT_SYSTEM,
      userMessage,
      maxTokens: 200,
      temperature: 0.4,
      model: 'opus',
      companyId,
      source: 'dm-self-diagnosis',
    });

    const parsed = extractJson<{ top_insight?: string }>(text);
    const insight = (parsed?.top_insight || '').trim();
    if (insight.length > 0) {
      return insight.slice(0, 50);
    }
  } catch (err) {
    console.warn('[dm-self-diagnosis] top_insight 도출 실패:', err);
  }

  // Fallback — critical factor 우선
  const critical = factors.find((f) => f.status === 'critical');
  if (critical) return critical.short_message;
  const warning = factors.find((f) => f.status === 'warning');
  if (warning) return warning.short_message;
  return '전체 진단 우수 — 추가 발송 데이터 누적 권장';
}

// ────────────── 메인 함수 ──────────────

export async function selfDiagnoseDm(
  companyId: string,
  campaignId: string,
): Promise<DmSelfDiagnosisResult> {
  const [ctr, design, adLabel, variable, order] = await Promise.all([
    evaluateCtr(campaignId, companyId),
    evaluateDesignConsistency(campaignId),
    evaluateAdLabelCompliance(campaignId),
    evaluateVariableIntegrity(campaignId),
    evaluateSectionOrder(campaignId),
  ]);

  const factors: DmDiagnosisFactorResult[] = [ctr, design, adLabel, variable, order];
  const overall = Math.round(factors.reduce((sum, f) => sum + f.score, 0) / factors.length);

  const topInsight = await deriveTopInsight(companyId, factors);

  // 추천 액션 도출
  const recommendedActions: DmRecommendedAction[] = [];
  if (variable.status !== 'good') {
    recommendedActions.push({
      action: 'variable_consistency',
      priority: 'high',
      reason: variable.short_message,
    });
  }
  if (design.status !== 'good') {
    recommendedActions.push({
      action: 'design_align',
      priority: 'medium',
      reason: design.short_message,
    });
  }
  if (ctr.status === 'critical') {
    recommendedActions.push({
      action: 'ai_refine',
      priority: 'high',
      reason: 'CTR 낮음 — 카피 개선 권장',
    });
  }

  // last_diagnosed_at 갱신 (D216+ 신규 컬럼)
  await query(`UPDATE dm_pages SET last_diagnosed_at = NOW() WHERE id = $1`, [campaignId]);

  return {
    campaign_id: campaignId,
    overall_score: overall,
    factors,
    top_insight: topInsight,
    recommended_actions: recommendedActions,
    diagnosed_at: new Date().toISOString(),
  };
}

// ────────────── 헬퍼 ──────────────

function parseJson<T = any>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  return value as T;
}
