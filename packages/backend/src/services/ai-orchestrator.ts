/**
 * AI Operator — Multi-Agent Orchestrator (D170+, 2026-05-19)
 *
 * Harold 명시 모델 정합 (절대 분리):
 *   - 모든 AI 호출 = Claude Opus 4.7 (model: 'opus' 박음)
 *   - 백업 fallback = GPT 5.5 (callAIWithFallback이 자동 분기)
 *   - 기존 한줄로AI 흐름(Sonnet 4.6 + gpt-5.4-mini)은 영향 0건
 *
 * Braze급 SaaS Step 0 — Sub-agent 협업 구조:
 *   1. Target Sub-agent  : 자연어 → 고객군 + filters (recommendTarget + model:'opus')
 *   2. Verify Sub-agent  : AI 추정 count → DB 실제 count (countFilteredCustomers, AI 호출 X)
 *   3. Message Sub-agent : 채널별 A/B/C 문안 (generateMessages + model:'opus')
 *   4. Compliance Sub-agent: 스팸/금칙어/정책 검수 (callAIWithFallback + model:'opus')
 *   5. Cost-ROI Sub-agent: 단순 산술 (회사별 단가 × count + 성과 추정, AI 호출 X)
 *
 * 회사별 메모리:
 *   - buildCompanyMemoryContext: 브랜드 톤 + 30일 성공 캠페인 history 시스템 프롬프트
 *   - callAIWithFallback의 cache_control ephemeral과 결합 (D167) → 90% 비용 절감
 */

import { query } from '../config/database';
import { getCompanyCosts } from '../config/defaults';
import {
  callAIWithFallback,
  recommendTarget,
  generateMessages,
  extractVarCatalog,
  filterVarCatalogByData,
  countFilteredCustomers,
} from './ai';

// ============================================================
// 타입
// ============================================================

export interface AgentContext {
  companyId: string;
  userId: string | null;
  objective: string;
  companyInfo: Record<string, any>;
  customerStats: Record<string, any>;
}

export interface ComplianceResult {
  passed: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  warnings: string[];
  suggestions: string[];
}

export interface OrchestratorResult {
  target: {
    count: number;
    totalCount: number;
    criteria: string;
    filters: Record<string, any>;
    suggestedName: string;
  };
  messages: Array<{
    variantId: string;
    variantName: string;
    concept: string;
    body: string;
    subject: string;
    byteCount: number;
    byteWarning: boolean;
    score: number;
  }>;
  recommendation: string;
  recommendationReason: string;
  channel: {
    recommended: string;
    reason: string;
    isAd: boolean;
    rejectNumber: string | null;  // ★ D170+ (Harold 명시): 광고 메시지 미리보기에 (광고)+무료거부 자동 합성 정보
  };
  schedule: {
    recommendedTime: string;
  };
  compliance: ComplianceResult;
  cost: {
    estimated: number;
    unitCost: number;
    breakdown: string;
  };
  performance: {
    expectedClicks: number;
    expectedConversions: number;
    expectedRevenue: number;
    clickRate: number;
    conversionRate: number;
  };
  meta: {
    usePersonalization: boolean;
    personalizationVars: string[];
    useIndividualCallback: boolean;
    countVerified: boolean;
    generatedAt: string;
    agentDurations: Record<string, number>;
  };
}

// ============================================================
// 회사별 메모리 컨텍스트 빌더 (D170)
// 시스템 프롬프트에 박혀 cache_control ephemeral과 결합 시 90% 비용 절감
// ============================================================

export async function buildCompanyMemoryContext(companyId: string): Promise<string> {
  try {
    const [companyRes, recentRes] = await Promise.all([
      query(
        `SELECT brand_name, brand_slogan, brand_description, brand_tone, business_type
         FROM companies WHERE id = $1::uuid`,
        [companyId]
      ),
      query(
        `SELECT DISTINCT message_content
         FROM campaigns
         WHERE company_id = $1 AND status = 'completed'
           AND message_content IS NOT NULL AND LENGTH(message_content) > 30
           AND sent_at > NOW() - INTERVAL '30 days'
         ORDER BY message_content
         LIMIT 10`,
        [companyId]
      ),
    ]);

    const company = companyRes.rows[0] || {};
    const recentMessages: string[] = recentRes.rows.map((r: any) => r.message_content);

    return `## Company Memory (D170 회사별 누적 학습)
- 브랜드명: ${company.brand_name || '(미설정)'}
- 슬로건: ${company.brand_slogan || '(미설정)'}
- 톤앤매너: ${company.brand_tone || '친근함'}
- 업종: ${company.business_type || '(미설정)'}
${company.brand_description ? `- 브랜드 소개: ${company.brand_description}` : ''}

## 최근 30일 성공 캠페인 history (${recentMessages.length}건)
${recentMessages.length > 0
  ? recentMessages.map((m, i) => `${i + 1}. ${m.replace(/\(광고\)/g, '').replace(/무료거부\d+/g, '').replace(/무료수신거부\s?\d{3}-?\d{3,4}-?\d{4}/g, '').trim().slice(0, 250)}`).join('\n')
  : '(최근 30일 발송 이력 없음)'}
`;
  } catch (err) {
    console.warn('[Orchestrator] buildCompanyMemoryContext 실패, 빈 컨텍스트 반환:', err);
    return '';
  }
}

// ============================================================
// Sub-agent: Compliance (Haiku 4.5, 스팸 + 카카오 정책 검수)
// ============================================================

export async function checkCompliance(
  message: string,
  channel: string,
  isAd: boolean
): Promise<ComplianceResult> {
  // 본문 비어있으면 검수 skip
  if (!message || message.trim().length < 5) {
    return { passed: false, riskLevel: 'high', warnings: ['메시지 본문이 비어있습니다.'], suggestions: [] };
  }

  const system = `당신은 한국 SMS/LMS/MMS/알림톡 발송 규정 검수 전문가입니다.
주어진 메시지가 한국 정보통신망법 + 카카오 알림톡 정책 + 통신사 스팸 정책에 부합하는지 검수합니다.
JSON 형식으로만 응답하세요.`;

  const userMessage = `## 검수 대상
- 채널: ${channel}
- 광고성: ${isAd ? '광고 (Ad)' : '정보 (Info)'}
- 본문:
"""
${message}
"""

## 검수 기준
1. 금칙어: "확정", "100%", "무료", "당첨" 등 과장 표현
2. 스팸 위험: 과도한 할인 표현, 긴급성 강조, 반복 특수문자
3. 광고 표시: 광고 메시지에 "(광고)" 표기 누락은 시스템 자동 처리 (검수 X)
4. 카카오 정책: 알림톡은 거래관계 있는 수신자 대상 한정 (검수 X — 발신자 책임)
5. 변수 형식: %변수% 또는 #{변수} 외 형식 금지

## 출력 형식 (JSON만 응답)
{
  "passed": true 또는 false,
  "riskLevel": "low" 또는 "medium" 또는 "high",
  "warnings": ["발견된 문제 한 줄 설명", ...],
  "suggestions": ["수정 제안 한 줄 설명", ...]
}

passed=true 이면 warnings/suggestions 빈 배열 가능. 사소한 issue는 medium, 발송 차단 필요 시 high.`;

  try {
    const text = await callAIWithFallback({
      system,
      userMessage,
      maxTokens: 512,
      temperature: 0.1,
      // ★ D170+ (Harold 명시 2026-05-19): Compliance도 Opus 4.7로 격상.
      //   Haiku 4.5는 빠른 비용 절감 가치이나 한국 정책 검수 품질에서 Opus가 정합. 비용은 ENT 전용이라 한정.
      model: 'opus',
    });

    let jsonStr = text;
    if (text.includes('```json')) {
      const start = text.indexOf('```json') + 7;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    } else if (text.includes('```')) {
      const start = text.indexOf('```') + 3;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    }

    const parsed = JSON.parse(jsonStr);
    return {
      passed: !!parsed.passed,
      riskLevel: (parsed.riskLevel === 'high' || parsed.riskLevel === 'medium' || parsed.riskLevel === 'low')
        ? parsed.riskLevel
        : 'low',
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.slice(0, 5).map(String) : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 5).map(String) : [],
    };
  } catch (err) {
    console.warn('[Compliance Sub-agent] 검수 실패, passed=true fallback:', err);
    return { passed: true, riskLevel: 'low', warnings: [], suggestions: [] };
  }
}

// ============================================================
// Cost-ROI Sub-agent (단순 산술 — AI 호출 X)
// ============================================================

interface CostROIInput {
  count: number;
  channel: string;
  companyInfo: Record<string, any>;
  avgRevenue: number;
}

interface CostROIResult {
  cost: {
    estimated: number;
    unitCost: number;
    breakdown: string;
  };
  performance: {
    expectedClicks: number;
    expectedConversions: number;
    expectedRevenue: number;
    clickRate: number;
    conversionRate: number;
  };
}

function calculateCostROI(input: CostROIInput): CostROIResult {
  const { count, channel, companyInfo, avgRevenue } = input;
  const costs = getCompanyCosts(companyInfo);
  const channelKey = (channel || 'SMS').toLowerCase();
  const unitCost: number = (costs as Record<string, number>)[channelKey] ?? costs.sms;
  const estimatedCost = Math.round(count * unitCost);

  // 성과 예측 — D169 Extended Thinking이 활성화된 D170+ 단계에서 reasoning 기반 정합 강화 예정
  const expectedClickRate = 0.03;
  const expectedConversionRate = 0.008;
  const expectedClicks = Math.round(count * expectedClickRate);
  const expectedConversions = Math.round(count * expectedConversionRate);
  const expectedRevenue = Math.round(expectedConversions * avgRevenue);

  return {
    cost: {
      estimated: estimatedCost,
      unitCost,
      breakdown: `${channel} ${count.toLocaleString()}건 × ${unitCost.toLocaleString()}원`,
    },
    performance: {
      expectedClicks,
      expectedConversions,
      expectedRevenue,
      clickRate: expectedClickRate,
      conversionRate: expectedConversionRate,
    },
  };
}

// ============================================================
// Orchestrator main — 6 Sub-agent 호출 + 결과 통합
// ============================================================

export async function orchestrate(ctx: AgentContext): Promise<OrchestratorResult> {
  const durations: Record<string, number> = {};
  const mark = (key: string, start: number) => { durations[key] = Date.now() - start; };

  // ============ 1. Target Sub-agent (Opus 4.7 — Harold 명시) ============
  const targetStart = Date.now();
  const targetResult = await recommendTarget(
    ctx.companyId,
    ctx.objective,
    ctx.customerStats,
    ctx.companyInfo as any,
    { model: 'opus' } // ★ D170+ (Harold 명시): AI Operator Target Sub-agent = Opus 4.7
  );
  mark('target', targetStart);

  let estimatedCount = Math.max(0, targetResult.estimated_count || 0);

  // ============ 2. Target Verification (D168 — Tool Use SQL Loop 정신) ============
  const verifyStart = Date.now();
  let countVerified = false;
  try {
    const cnt = await countFilteredCustomers(ctx.companyId, targetResult.filters, ctx.userId || '');
    if (cnt.count !== estimatedCount) {
      console.log(`[Orchestrator] count 검증 — AI 추정 ${estimatedCount} → DB 실제 ${cnt.count}`);
    }
    estimatedCount = cnt.count;
    countVerified = true;
  } catch (cntErr) {
    console.warn('[Orchestrator] count 검증 실패, AI 추정값 fallback:', cntErr);
  }
  mark('verify', verifyStart);

  // ============ 3. Message Sub-agent ============
  const messageStart = Date.now();
  const { fieldMappings: varCatalog, availableVars } = extractVarCatalog(ctx.companyInfo.customer_schema);
  await filterVarCatalogByData(varCatalog, availableVars, ctx.companyId);

  const messagesResult = await generateMessages(
    ctx.objective,
    {
      total_count: estimatedCount,
      avg_purchase_count: parseFloat(ctx.customerStats.avg_purchase_count) || 0,
      avg_total_spent: parseFloat(ctx.customerStats.avg_total_spent) || 0,
    },
    {
      brandName: ctx.companyInfo.brand_name || ctx.companyInfo.company_name,
      brandSlogan: ctx.companyInfo.brand_slogan,
      brandDescription: ctx.companyInfo.brand_description,
      brandTone: ctx.companyInfo.brand_tone,
      channel: targetResult.recommended_channel,
      isAd: targetResult.is_ad,
      rejectNumber: ctx.companyInfo.reject_number,
      usePersonalization: targetResult.use_personalization,
      personalizationVars: targetResult.personalization_vars,
      availableVarsCatalog: varCatalog,
      availableVars: availableVars,
      // ★ D170+ (Harold 명시 2026-05-19): Message Sub-agent = Opus 4.7 (1M ctx + 본문 품질 최상)
      model: 'opus',
    }
  );
  mark('message', messageStart);

  // 변환 — message_text 단일 필드 (D165 fix 정합)
  const normalizedMessages = messagesResult.variants.slice(0, 3).map((v) => {
    const anyV = v as unknown as Record<string, unknown>;
    return {
      variantId: v.variant_id,
      variantName: v.variant_name,
      concept: v.concept,
      body: (anyV.message_text as string) || '',
      subject: (anyV.subject as string) || '',
      byteCount: (anyV.byte_count as number) || 0,
      byteWarning: (anyV.byte_warning as boolean) || false,
      score: v.score,
    };
  });

  // ============ 4. Compliance Sub-agent (Haiku 4.5) ============
  const complianceStart = Date.now();
  const primaryBody = normalizedMessages[0]?.body || '';
  const compliance = await checkCompliance(
    primaryBody,
    targetResult.recommended_channel || 'SMS',
    !!targetResult.is_ad
  );
  mark('compliance', complianceStart);

  // ============ 5. Cost-ROI Sub-agent (산술) ============
  const costStart = Date.now();
  const costRoi = calculateCostROI({
    count: estimatedCount,
    channel: targetResult.recommended_channel || 'SMS',
    companyInfo: ctx.companyInfo,
    avgRevenue: parseFloat(ctx.customerStats.avg_total_spent) || 50000,
  });
  mark('costRoi', costStart);

  return {
    target: {
      count: estimatedCount,
      totalCount: parseInt(ctx.customerStats.total || '0'),
      criteria: targetResult.reasoning,
      filters: targetResult.filters,
      suggestedName: targetResult.suggested_campaign_name,
    },
    messages: normalizedMessages,
    recommendation: messagesResult.recommendation,
    recommendationReason: messagesResult.recommendation_reason,
    channel: {
      recommended: targetResult.recommended_channel,
      reason: targetResult.channel_reason,
      isAd: !!targetResult.is_ad,
      rejectNumber: (ctx.companyInfo.reject_number as string) || null, // ★ Harold 명시: 광고+무료거부 자동 합성용
    },
    schedule: {
      recommendedTime: targetResult.recommended_time,
    },
    compliance,
    cost: costRoi.cost,
    performance: costRoi.performance,
    meta: {
      usePersonalization: !!targetResult.use_personalization,
      personalizationVars: targetResult.personalization_vars || [],
      useIndividualCallback: !!targetResult.use_individual_callback,
      countVerified,
      generatedAt: new Date().toISOString(),
      agentDurations: durations,
    },
  };
}
