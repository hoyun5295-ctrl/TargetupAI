/**
 * AI Operator — Multi-Agent Orchestrator (D170+, 2026-05-19)
 *
 * Harold 명시 모델 분리 (절대 준수):
 *   - 대부분의 AI 호출 = Claude Opus (Target / Compliance / Insight / Orchestrator, model: 'opus')
 *   - 단, Message Sub-agent = Sonnet (D209+ 품질·비용 균형, model: 'sonnet')
 *   - 백업 fallback = GPT (callAIWithFallback이 자동 분기)
 *   - 기존 한줄로AI 흐름(Sonnet + gpt-mini)은 영향 0건
 *
 * Braze급 SaaS Step 0 — Sub-agent 협업 구조:
 *   1. Target Sub-agent  : 자연어 → 고객군 + filters (recommendTarget + model:'opus')
 *   2. Verify Sub-agent  : AI 추정 count → DB 실제 count (countFilteredCustomers, AI 호출 X)
 *   3. Message Sub-agent : 채널별 A/B/C 문안 (generateMessages + model:'sonnet')
 *   4. Compliance Sub-agent: 스팸/금칙어/정책 검수 (callAIWithFallback + model:'opus')
 *   5. Cost-ROI Sub-agent: 단순 산술 (회사별 단가 × count + 성과 추정, AI 호출 X)
 *
 * 회사별 메모리:
 *   - buildCompanyMemoryContext: 브랜드 톤 + 30일 성공 캠페인 history 시스템 프롬프트
 *   - callAIWithFallback의 cache_control ephemeral과 결합 (D167) → 90% 비용 절감
 */

import Anthropic from '@anthropic-ai/sdk';
import { query } from '../config/database';
import { getCompanyCosts, AI_MODELS, isAdaptiveOnlyModel, resolveMaxTokens } from '../config/defaults';
// ★ D181 (2026-05-19): Anthropic Memory 패턴 박음 — 회사별 누적 학습
import { buildMemoryPromptContext as buildCompanyMemoryPromptContext } from '../utils/company-memory';
// ★ D210+ Phase 2 (Harold 명시 2026-05-23): CT-58 — 회사 customer DB 실측 프로필.
//   generateMessages 호출 직전 자동 조회 → AI userMessage 안 동적 주입 → 어설픈 개인화 차단.
import { getCompanyDataProfile } from '../utils/company-data-profile';
import {
  callAIWithFallback,
  recommendTarget,
  generateMessages,
  extractVarCatalog,
  filterVarCatalogByData,
  countFilteredCustomers,
} from './ai';
// ★ 2026-08-03 타겟팅 재설계 A-1: 자동마케팅 대상 수는 단일 문으로만 센다(피로도·미클릭·코호트 게이트 포함 —
//   종전 countFilteredCustomers는 게이트를 안 봐서 제안 수·통지 수가 실발송보다 컸다).
//   ⛔ 1R 정정: 이 문은 audienceScope==='operator'일 때만. 공용 제안 경로는 countFilteredCustomers 그대로.
import { countOperatorAudienceFor, resolveOperatorStoreScope } from '../utils/operator-audience';
// ★ 2026-08-03 A-7: 세그먼트 계약 — 축이 정해지면 SQL이 정해진다(AI 해석 개입 없음).
import { normalizeSegmentParams, getSegmentContract } from '../utils/automarketing-segment';
// 성과 추정도 대상 수와 같은 최종 WHERE(안전필터·미클릭·피로도 포함)를 쓰게 하려고 공용 조각 빌더를 함께 쓴다.
import { buildAudienceWhere } from '../utils/operator-recipients';
// ★ D227+ 성과 추정 실데이터 전환 — calculateCostROI(하드코딩) 대체
import { estimatePerformance } from '../utils/operator-performance-estimator';
// 문안 생성 objective 합성(seasonHint 결합) 공통 헬퍼 — orchestrate / orchestrateWithAI 일관
import { buildMessageObjective } from '../utils/season-context';
// ★ D227+ AI 성과 분석가 sub-agent — 통계 결과 위에 진단·전략·리스크 자연어 (숫자 생성 X)
import { extractJsonFromAiText } from '../utils/ai-json';
import {
  buildInsightPrompt,
  normalizeInsight,
  buildInsufficientInsight,
  InsightInput,
  InsightResult,
} from '../utils/performance-insight';
// ★ D227+ 종량제: 풀분석 묶음 차감 — 진입점 1회, sub-agent는 묶음 컨텍스트로 0(과차감 방지)
import { checkCredit, deductCreditSafe } from '../utils/ai-credit';
import { applyBenefitToBody, buildTargetHintPromptBlock, normalizeTargetHint } from '../utils/autosend-policy';
import { currentUserId } from '../utils/request-context';
import { runInCreditBundle } from '../utils/ai-credit-context';
import { getCreditCost } from '../utils/ai-credit-calc';

// 풀분석/자동마케팅 크레딧 = CREDIT_COST_MAP 단일 진실(getCreditCost(source)). orchestrate=300, continuous-operator=200.

// ★ D171-D (2026-05-19): 진정 Orchestrator AI 전용 Anthropic 인스턴스 (Tool Use 직접 호출)
const orchestratorAnthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// ============================================================
// 타입
// ============================================================

export interface AgentContext {
  companyId: string;
  userId: string | null;
  objective: string;
  companyInfo: Record<string, any>;
  customerStats: Record<string, any>;
  seasonHint?: string;   // 계절 문안 힌트 — 메시지 생성에만 주입(objective·타겟 불변). 자동마케팅에서 사용.
  // ★ 2026-06-26: 자동마케팅 채널 고정(#1) + 관리자 입력 혜택(#4) — 옵셔널, 미설정 시 기존 동작(AI 추천 채널·placeholder 유지).
  forcedChannel?: string;          // 'sms'|'lms'|'mms' — 설정 시 AI 추천 대신 이 채널로 문안·검수·발송 일관
  benefitContent?: string | null;  // 관리자 직접 입력 혜택 — 생성 문안의 [혜택 ...] placeholder 치환
  // ★ 2026-07-02 (Harold 명시): 자동마케팅 = 마케팅 = 무조건 광고. true면 AI 판정과 무관하게 is_ad 고정 →
  //   문안 생성·검수·스팸테스트·발송((광고)+무료거부 080 자동 합성)까지 전 하류 일관.
  forcedIsAd?: boolean;
  // ★ 2026-07-07 마케팅 캘린더 완비: 발송 대상 축(TARGET_HINTS 화이트리스트) — 타겟 sub-agent에만 고정 지시로 주입.
  //   문안 세계와 타겟 세계 지시 분리 원칙(2026-07-06 Liquid 결선 교훈). 미지정 = 기존 자유 해석.
  targetHint?: string | null;
  /**
   * ★ 2026-08-03 타겟팅 재설계 A-7 — 세그먼트 계약. 지정되면 대상 조건은 계약이 만들고
   *   타겟 sub-agent의 filters는 쓰지 않는다(회차마다 재해석하지 않는다 = 결정성).
   *   미지정 = 종전대로 filters 해석(옛 오퍼레이터 호환).
   */
  segmentKey?: string | null;
  segmentParams?: Record<string, number> | null;
  /**
   * ⛔ 2026-08-03 1R 정정 — 이 호출이 자동마케팅 회차인지 밝힌다.
   *   orchestrate는 자동마케팅(continuous-operator)과 일반 AI 제안(/operator/propose)이 공유한다.
   *   자동마케팅 게이트(발송 피로도·미클릭·리마인드 코호트)를 공용 경로에 그대로 적용하면 범위 밖 화면의
   *   추천 수가 조용히 달라지고, 그 뒤 미리보기 명단과도 어긋난다. 'operator'일 때만 그 게이트를 쓴다.
   */
  audienceScope?: 'operator';
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
    /**
     * ★ 2026-08-03 A-7: 계약으로 뽑은 제안이면 축과 파라미터가 여기 남는다.
     *   발송 시점 추출·명단 조회가 filters가 아니라 이 축으로 컴파일한다 — 저장 후에도 조건이 같다.
     */
    segmentKey?: string | null;
    segmentParams?: Record<string, number> | null;
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
    // ★ D227+ 실데이터 추정 — 타겟 객단가 + ROI + 추정 근거
    avgRevenue: number;
    roi: number;
    basis: {
      level: string;
      label: string;
      confidence: string;
      notes: string[];
      eventWindowDays?: number;
      gradeBreakdown?: Array<{ grade: string; count: number; conversionRate: number; expectedConversions: number; expectedRevenue: number; source: string }>;
    };
    insight?: InsightResult;
  };
  meta: {
    usePersonalization: boolean;
    personalizationVars: string[];
    useIndividualCallback: boolean;
    countVerified: boolean;
    /**
     * ★ 2026-08-03 A-1: 대상 수 실측 실패 사유. 값이 있으면 target.count는 0(fail-closed)이며
     *   AI 추정치로 대체하지 않는다. 0건 통지가 이 사유를 담당자에게 그대로 전달한다.
     */
    countError?: string;
    generatedAt: string;
    agentDurations: Record<string, number>;
    // ★ D171-D (2026-05-19): 진정 Orchestrator AI (Opus 4.7) Tool Use 흐름 진입 여부
    usedAIDecision?: boolean;
    // ★ D171-D: AI가 어떤 tool을 어떤 입력으로 호출했는지 추적 (배포 후 운영 분석용)
    aiDecisionTrace?: Array<{ iteration: number; tool: string; inputSummary: string; durationMs: number }>;
    // Orchestrator AI 경로 최종 통합 분석(자연어 한 단락). 순차 경로엔 없음(옵셔널).
    aiSynthesis?: string;
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

    // ★ D181 (2026-05-19) — Anthropic Memory 패턴 박음: ai_company_memory 박은 영역 박음
    const memoryContext = await buildCompanyMemoryPromptContext(companyId, 30).catch((err) => {
      console.warn('[Orchestrator] buildMemoryPromptContext 실패:', err);
      return '';
    });

    return `## Company Memory (D170 / D181 회사별 누적 학습)
- 브랜드명: ${company.brand_name || '(미설정)'}
- 슬로건: ${company.brand_slogan || '(미설정)'}
- 톤앤매너: ${company.brand_tone || '친근함'}
- 업종: ${company.business_type || '(미설정)'}
${company.brand_description ? `- 브랜드 소개: ${company.brand_description}` : ''}

## 최근 30일 성공 캠페인 history (${recentMessages.length}건)
${recentMessages.length > 0
  ? recentMessages.map((m, i) => `${i + 1}. ${m.replace(/\(광고\)/g, '').replace(/무료거부\d+/g, '').replace(/무료수신거부\s?\d{3}-?\d{3,4}-?\d{4}/g, '').trim().slice(0, 250)}`).join('\n')
  : '(최근 30일 발송 이력 없음)'}

${memoryContext}`;
  } catch (err) {
    console.warn('[Orchestrator] buildCompanyMemoryContext 실패, 빈 컨텍스트 반환:', err);
    return '';
  }
}

// ============================================================
// Sub-agent: Compliance (Opus — 스팸 + 카카오 정책 검수)
// ============================================================

export async function checkCompliance(
  message: string,
  channel: string,
  isAd: boolean,
  companyId?: string // ★ D227+ 종량제: orchestrate 묶음 sub(차감 0) — 토큰 집계용
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

## 검수 기준 (아래 항목만 검수 — 본문에 실제로 있는 내용만 평가)
1. 금칙어: "확정", "100%", "무료", "당첨" 등 과장 표현
2. 스팸 위험: 과도한 할인 표현, 긴급성 강조, 반복 특수문자
3. 변수 형식: %변수% 또는 #{변수} 외 형식 금지
4. 미완성 표기: [테스트계정]·[브랜드명] 등 대괄호 placeholder가 본문에 그대로 남아있으면 경고 (실제 발송 시 노출 위험)

## ★ 검수 제외 — 아래는 시스템/발신 설정이 자동 처리하므로 본문에 없어도 정상이다. 절대 누락/경고/제안에 넣지 마라
- "(광고)" 표기: 발송 시 시스템이 본문 앞에 자동 부착
- 무료수신거부 080 안내 문구: 발송 시 시스템이 본문 뒤에 자동 부착 (본문에 있든 없든 누락으로 잡지 마라)
- 발신번호/상호명/사업자 정보: 발신 설정 영역 (본문 기준으로 누락 잡지 마라)
- 카카오 알림톡 수신관계: 발신자 책임 (검수 X)
→ 위 4개는 본문에 안 보여도 정상이다. 본문에 실제로 존재하는 표현만 보고 판단하라.

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
      maxTokens: 2048,  // ★ 2026-07-01: thinking ON 대비 여유 (검수 JSON 출력 자체는 짧음)
      temperature: 0.1,
      // ★ 2026-07-01 (Harold 명시): 검수 정밀도 — Opus 4.8 + adaptive thinking ON.
      //   본문을 한 줄까지 꼼꼼히 따져 오탐(무료거부 있는데 누락으로 잡음) 차단.
      thinking: true,
      model: 'opus',
      companyId,
      source: 'compliance-check', // ★ D227+ 종량제: orchestrate 묶음 sub — 차감 0(집계만)
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
    // ★ 자동발송 fail-closed: 검수를 완료하지 못하면 passed=false → 자동발송 자격 제외(수동 검토는 가능).
    console.warn('[Compliance Sub-agent] 검수 실패 → passed=false(자동발송 보류):', err);
    return { passed: false, riskLevel: 'medium', warnings: ['자동 검수를 완료하지 못해 자동발송을 보류합니다.'], suggestions: [] };
  }
}

// ============================================================
// ★ D227+ Cost-ROI 추정 — calculateCostROI(전 회사 0.8% 하드코딩) 제거.
//   utils/operator-performance-estimator.ts estimatePerformance로 대체:
//   타겟 실제 객단가 + 과거 캠페인 실측 3단계 추정. (옛 VIP "매출 50만원" 비현실 수치 정정)
// ============================================================

// ============================================================
// Orchestrator main — 6 Sub-agent 호출 + 결과 통합
// ============================================================

export async function orchestrate(ctx: AgentContext, creditOpts?: { source?: string; cost?: number }): Promise<OrchestratorResult> {
  // ★ D227+ 종량제: 풀분석 묶음 — 진입 사전 체크 → 본문(sub는 묶음으로 차감 0) → 성공 후 1회 차감.
  //   creditOpts: 자동마케팅 등이 source/cost 오버라이드(예: source 'continuous-operator' → 200). 미지정 시 풀분석 300.
  const source = creditOpts?.source ?? 'orchestrate';
  const cost = creditOpts?.cost ?? getCreditCost(source);
  await checkCredit(ctx.companyId, cost);
  return runInCreditBundle(async () => {
    const result = await _orchestrateImpl(ctx);
    // ★ 2026-07-08 (Harold 명시): 문안 미출력(0건 매칭 등) = 사용자 결과 없음 → 차감 skip.
    //   문안이 1개 이상 실제 생성된 경우에만 과금 (6원칙 ② 효과 검증 후 과금).
    if ((result.messages?.length ?? 0) > 0) {
      await deductCreditSafe({ companyId: ctx.companyId, cost, source, createdBy: ctx.userId || currentUserId() || null });
    }
    return result;
  });
}

async function _orchestrateImpl(ctx: AgentContext): Promise<OrchestratorResult> {
  const durations: Record<string, number> = {};
  const mark = (key: string, start: number) => { durations[key] = Date.now() - start; };

  // ============ 1. Target Sub-agent (Opus 4.7 — Harold 명시) ============
  const targetStart = Date.now();
  // ★ 2026-07-07: 타겟 축 고정 지시(마케팅 캘린더 완비) — 화이트리스트 정규화 후 지시 블록 생성(이상값 = 무지시).
  // ⛔ 7R 정정: 계약이 있으면 옛 힌트 지시를 주지 않는다. 대상은 계약이 정하는데 지시만 옛 축으로 가면
  //   기준 설명과 문안이 실제 대상과 다른 사람을 가리킨다(계약 birthday인데 문안은 VIP를 말한다).
  const hasContract = ctx.audienceScope === 'operator'
    && typeof ctx.segmentKey === 'string' && !!ctx.segmentKey.trim();
  const targetDirective = hasContract ? '' : buildTargetHintPromptBlock(normalizeTargetHint(ctx.targetHint));
  const targetResult = await recommendTarget(
    ctx.companyId,
    ctx.objective,
    ctx.customerStats,
    ctx.companyInfo as any,
    { model: 'opus', ...(targetDirective ? { targetDirective } : {}) } // ★ D170+ (Harold 명시): AI Operator Target Sub-agent = Opus 4.7
  );
  mark('target', targetStart);

  // ★ 2026-06-26: 자동마케팅이 폼에서 채널을 고정하면 AI 추천 대신 그 채널로 통일 (#1).
  //   recommended_channel 1곳만 덮으면 하류(문안 생성·검수·비용·표시)가 전부 자동 일관 — 제안·테스트·발송 채널 일치.
  if (ctx.forcedChannel && ['sms', 'lms', 'mms'].includes(ctx.forcedChannel.toLowerCase())) {
    targetResult.recommended_channel = ctx.forcedChannel.toUpperCase();
  }

  // ★ 2026-07-02 (Harold 명시): 자동마케팅 = 무조건 광고 — forcedChannel과 같은 1곳 override로 하류 전부 일관.
  if (ctx.forcedIsAd === true) {
    targetResult.is_ad = true;
  }

  let estimatedCount = Math.max(0, targetResult.estimated_count || 0);

  // ============ 2. Target Verification (D168 — Tool Use SQL Loop 정신) ============
  const verifyStart = Date.now();
  let countVerified = false;
  let countError: string | undefined;
  // ★ 2026-08-03 A-7: 계약이 있으면 AI가 만든 filters를 버린다. 대상 조건은 축이 정하고, 축이 정해지면 SQL이 정해진다.
  //   ⛔ 1R 정정: 계약 해석은 자동마케팅 회차에서만. 공용 제안 경로는 종전 그대로 둔다(범위 밖 동작 변화 금지).
  const isOperatorScope = ctx.audienceScope === 'operator';
  // ⛔ 2R 정정: 여기서 화이트리스트로 깎지 않는다(깎으면 미지의 축이 "계약 없음"이 되어 옛 경로로 샌다).
  //   원문을 컴파일 문에 넘기고, 유효성은 그 한 곳에서 판정한다. 모르는 축이면 아래 catch가 대상 0 + 사유로 받는다.
  const rawSegmentKey = isOperatorScope && typeof ctx.segmentKey === 'string' && ctx.segmentKey.trim()
    ? ctx.segmentKey.trim() : null;
  let contractKey: string | null = null;
  let contractParams: Record<string, number> | null = null;
  let contractLabel = '';
  let contractCriteria = '';
  // 대상 판정에 실제로 쓰인 조건 — 성과 추정도 같은 WHERE를 봐야 수와 기대 성과의 근거가 갈리지 않는다(3R 정정).
  let audienceWhere: { sql: string; params: any[] } | null = null;
  if (rawSegmentKey) targetResult.filters = {};   // 계약이 조건이다 — AI가 만든 filters는 쓰지 않는다
  try {
    // ★ 2026-08-03 A-1: 자동마케팅은 발송 게이트(피로도·미클릭)를 포함한 단일 문 — 센 수가 곧 화면 수·사전 통지 수다.
    //   일반 제안 경로는 그 게이트가 발송에 걸리지 않으므로 종전 count를 유지한다.
    let actual: number;
    if (isOperatorScope) {
      // ⛔ 5R 정정: 제안 수도 발송과 같은 매장 범위로 센다. 종전엔 미리보기만 범위를 적용하고 제안 수·통지 수는
      //   회사 전체였다 — 담당자가 본 수와 실제 나가는 수가 갈렸다.
      const scope = await resolveOperatorStoreScope(ctx.companyId, ctx.userId || null);
      if (scope.blocked) throw new Error('담당 매장이 지정되지 않아 발송 대상을 정할 수 없습니다.');
      const measured = await countOperatorAudienceFor({
        companyId: ctx.companyId,
        segmentKey: rawSegmentKey,
        segmentParams: ctx.segmentParams,
        legacyFilters: targetResult.filters,
        storeFilter: scope.storeFilter,
        baseParams: scope.baseParams,
      });
      actual = measured.count;
      // 컴파일이 확정한 축을 제안에 남긴다 — 발송·명단이 같은 축으로 다시 컴파일한다.
      contractKey = measured.compiled.segmentKey;
      contractParams = contractKey ? normalizeSegmentParams(contractKey as any, ctx.segmentParams) : null;
      if (contractKey) {
        // 화면 기준·캠페인 이름의 근거를 계약으로 통일한다(파라미터까지 문장에 담아 두루뭉술을 없앤다).
        const c = getSegmentContract(contractKey);
        const dayPart = contractParams?.days ? ` (기준 ${contractParams.days}일)` : '';
        contractLabel = c?.label || '';
        contractCriteria = c ? `${c.label}${dayPart} — ${c.description}` : '';
      }
      // ⛔ 4R 정정: 조건 조각만 넘기면 추정기는 안전필터·수신거부·피로도를 안 본다 — VIP 100명 중 실제 10명인데
      //   프로파일은 100명 기준으로 잡혀 기대 매출이 몇 배가 된다. count가 쓴 최종 WHERE 그대로를 넘긴다.
      const estParams: any[] = [...scope.baseParams, ...measured.compiled.filterParams];
      const estWhere = buildAudienceWhere(estParams, measured.compiled.filterWhere, scope.storeFilter, measured.gates);
      audienceWhere = { sql: estWhere, params: estParams.slice(1) };
    } else {
      const cnt = await countFilteredCustomers(ctx.companyId, targetResult.filters, ctx.userId || '');
      actual = cnt.count;
    }
    if (actual !== estimatedCount) {
      console.log(`[Orchestrator] count 검증 — AI 추정 ${estimatedCount} → DB 실제 ${actual}`);
    }
    estimatedCount = actual;
    countVerified = true;
  } catch (cntErr: any) {
    // ★ 2026-08-03 A-1 fail-closed: 종전엔 실패 시 AI 추정값으로 진행했다(대상 판정을 AI가 한 셈).
    //   실측이 없으면 대상은 0이다 — Zero-Count 게이트가 제안 생성을 막고, 사유는 담당자에게 통지된다.
    countError = cntErr?.message || '대상 수 실측 실패';
    estimatedCount = 0;
    console.warn('[Orchestrator] count 검증 실패 → 대상 0 처리(AI 추정값 사용 안 함):', cntErr);
  }
  mark('verify', verifyStart);

  // ============ 2-1. Zero-Count 정책 (D171 — Harold 명시 영구 원칙) ============
  // 타겟 매칭 0건이면 자동완화(relaxFilters) 박지 X — 발송 차단이 정합.
  // AI가 임의로 조건 풀어서 다른 고객에게 발송 = 마케팅 의도 파괴 + 수신자 권리 침해 + 발신번호 차단 위험.
  // 0건 응답을 그대로 frontend에 박아 사용자가 조건을 재입력하도록 안내.
  // 메모리: feedback_no_target_auto_relax.md

  // ============ 3. Message Sub-agent ============
  const messageStart = Date.now();
  const { fieldMappings: varCatalog, availableVars } = extractVarCatalog(ctx.companyInfo.customer_schema);
  await filterVarCatalogByData(varCatalog, availableVars, ctx.companyId);
  // ★ D210+ Phase 2 (Harold 명시 2026-05-23): 회사 customer DB 실측 프로필 자동 조회 (CT-58).
  //   AI userMessage 안 안전/분기/차단 3단계 분류 동적 주입 → 어설픈 개인화 사고 차단.
  const companyDataProfile = await getCompanyDataProfile(ctx.companyId);

  // ★ 2026-07-02 3단계: 회사 누적 학습(성공 패턴·채널 성과·정지 사유)을 문안 생성에 주입 — 계절 힌트와 같은 채널.
  //   그동안 쓰기만 되고 기본 경로에서 읽히지 않던 ai_company_memory가 여기서 처음 반영된다. 실패 시 빈 문자열(영향 0).
  const learnedMemoryContext = await buildCompanyMemoryPromptContext(ctx.companyId, 20).catch(() => '');
  // ⛔ 8R 정정: 계약이 있으면 문안 생성에도 그 대상을 명시한다. 종전엔 목표 문장만 넘겨서
  //   대상은 생일 고객인데 문안·개인화·채널 사유가 VIP를 말하는 일이 생겼다(수신자와 문안이 다른 사람을 가리킨다).
  const contractAudienceBlock = contractCriteria
    ? `[실제 발송 대상 — 이 대상에게 맞게 쓴다]\n${contractCriteria}\n목표 문장과 대상이 다르면 대상을 따른다. 다른 고객군을 지칭하지 않는다.`
    : '';
  const messagesResult = await generateMessages(
    buildMessageObjective(
      ctx.objective,
      [contractAudienceBlock, ctx.seasonHint, learnedMemoryContext].filter(Boolean).join('\n\n'),
    ),
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
      // ★ D210+ Phase 2 (Harold 명시 2026-05-23): 회사 실측 데이터 프로필 (CT-58) 전달 — 어설픈 변수 차단.
      companyDataProfile,
      // ★ D209+ (Harold 명시 2026-05-22): Message Sub-agent = Sonnet 4.6 전환.
      //   기존 ai.ts generateMessages 시스템 프롬프트 매트릭스(D152 + D80 정합) 정합 본질
      //   + 비용 80% 절감 (한줄로 운영 정합).
      model: 'sonnet',
      // ★ D225+ Brand Voice Learning — 회사별 가이드라인 자동 주입
      companyId: ctx.companyId,
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

  // ★ 2026-06-26: 관리자가 입력한 혜택이 있으면 생성 문안의 [혜택 ...] placeholder를 그 값으로 치환 (#4).
  //   AI는 혜택을 지어내지 않는다(미입력 시 placeholder 유지가 기본). 관리자 작성값만 들어간다 — 거짓광고/정보통신망법 준수.
  //   2026-07-07: applyBenefitToBody CT로 통일 — 발송 직전(dispatchProposalSend)도 같은 규칙으로 재치환 + 잔존 시 출구 가드 차단.
  if (ctx.benefitContent && ctx.benefitContent.trim()) {
    for (const m of normalizedMessages) {
      m.body = applyBenefitToBody(m.body, ctx.benefitContent);
    }
  }

  // ============ 4. Compliance Sub-agent (Opus) ============
  const complianceStart = Date.now();
  const primaryBody = normalizedMessages[0]?.body || '';
  const compliance = await checkCompliance(
    primaryBody,
    targetResult.recommended_channel || 'SMS',
    !!targetResult.is_ad,
    ctx.companyId
  );
  mark('compliance', complianceStart);

  // ============ 5. 성과 추정 (D227+ 실데이터 — 타겟 객단가 + 과거 실측) ============
  const costStart = Date.now();
  const channelKey5 = (targetResult.recommended_channel || 'SMS').toLowerCase();
  const costs5 = getCompanyCosts(ctx.companyInfo);
  const unitCost5 = (costs5 as Record<string, number>)[channelKey5] ?? costs5.sms;
  const est = await estimatePerformance({
    companyId: ctx.companyId,
    filters: targetResult.filters,
    count: estimatedCount,
    channel: targetResult.recommended_channel || 'SMS',
    unitCost: unitCost5,
    fallbackAvgRevenue: parseFloat(ctx.customerStats.avg_total_spent) || 0,
    // ⛔ 3R 정정: 계약 제안은 filters가 비어 있어 성과 프로파일이 전체 고객으로 잡혔다 — 같은 조건을 넘긴다.
    targetWhere: audienceWhere,
  });
  mark('costRoi', costStart);

  // ★ D227+ 성과 인사이트 sub-agent (Opus) — 통계 숫자 위에 진단·전략·리스크 (숫자 생성 X)
  const insight = await generatePerformanceInsight({
    level: est.basis.level,
    companyName: String(ctx.companyInfo?.name || ctx.companyInfo?.company_name || '고객사'),
    objective: ctx.objective,
    channel: targetResult.recommended_channel || 'SMS',
    targetCount: estimatedCount,
    expectedConversions: est.performance.expectedConversions,
    conversionRate: est.performance.conversionRate,
    expectedRevenue: est.performance.expectedRevenue,
    estimatedCost: est.cost.estimated,
    multiple: est.cost.estimated > 0 ? est.performance.expectedRevenue / est.cost.estimated : 0,
    eventWindowDays: est.basis.eventWindowDays,
    confidence: est.basis.confidence,
    gradeBreakdown: est.basis.gradeBreakdown || [],
    basisLabel: est.basis.label,
  }, ctx.companyId);

  return {
    target: {
      count: estimatedCount,
      totalCount: parseInt(ctx.customerStats.total || '0'),
      // ⛔ 7R 정정: 계약이 있으면 기준 설명도 계약이 근거다. AI reasoning을 그대로 쓰면 화면이
      //   실제 대상과 다른 사람을 설명한다(대상은 생일 고객인데 기준은 VIP 재구매라고 적힌다).
      criteria: contractCriteria || targetResult.reasoning,
      filters: targetResult.filters,
      suggestedName: contractLabel || targetResult.suggested_campaign_name,
      // ★ 2026-08-03 A-7: 저장된 제안이 발송·명단 조회에서 같은 축으로 다시 컴파일되게 축을 함께 남긴다.
      ...(contractKey ? { segmentKey: contractKey, segmentParams: contractParams } : {}),
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
    cost: est.cost,
    performance: { ...est.performance, basis: est.basis, insight },
    meta: {
      usePersonalization: !!targetResult.use_personalization,
      personalizationVars: targetResult.personalization_vars || [],
      useIndividualCallback: !!targetResult.use_individual_callback,
      countVerified,
      ...(countError ? { countError } : {}),
      generatedAt: new Date().toISOString(),
      agentDurations: durations,
    },
  };
}

// ============================================================
// ★ D171-D (2026-05-19): 진정 Orchestrator AI (Opus 4.7) — Tool Use 기반 sub-agent 호출 흐름
//
// Harold 명시 D171 종결 — orchestrate()가 backend 직접 순차 호출이라면,
// orchestrateWithAI()는 Opus 4.7 Orchestrator AI가 sub-agent를 tool로 호출하며 분배 결정.
//
// 흐름:
//   1. Opus 4.7에 system 프롬프트(회사 메모리 + Zero-Count 영구 원칙 + 사용 가능 tool) 박음
//   2. user message에 사용자 objective + 회사 통계 박음
//   3. Loop iteration (max 8):
//      a. AI 응답 받음
//      b. stop_reason='tool_use'면 tool 호출 + tool_result 박아 재호출
//      c. stop_reason='end_turn'이면 종료
//   4. 통합 결과로 OrchestratorResult 박음 + cost_roi 계산 (산술, AI tool X)
//
// 안전장치:
//   - max_iterations: 8 (무한 loop 차단)
//   - per-tool max_calls: 2
//   - max_tokens: 4096
//   - 실패 시 orchestrate() 자동 fallback (응답 인터페이스 호환)
//   - Zero-Count Auto-Relax 절대 금지 (system 프롬프트 명시) — feedback_no_target_auto_relax.md
//
// 모델 분리 룰 (feedback_ai_operator_model_isolation.md):
//   - Orchestrator AI = Opus 4.7 (Sonnet 4.6 영향 0건)
//   - Tool 내부 sub-agent = 기존 Opus 4.7 model:'opus' 박힘 그대로
//
// 라우팅:
//   - routes/ai.ts /operator/propose가 env flag AI_OPERATOR_USE_AI_DECISION=true 시 본 함수 진입
//   - default false (기존 orchestrate 순차 호출)
// ============================================================

interface ToolCallTrace {
  iteration: number;
  tool: string;
  inputSummary: string;
  durationMs: number;
}

const ORCHESTRATOR_TOOLS: Anthropic.Tool[] = [
  {
    name: 'target_analysis',
    description: '사용자의 마케팅 목표를 분석하여 고객 타겟 필터 조건을 추출합니다. AI가 customer_schema 기반 필터 + 추천 채널(SMS/LMS/MMS/KAKAO) + 광고 여부 + 개인화 변수를 결정합니다. (호출 1회 권장)',
    input_schema: {
      type: 'object',
      properties: {
        analysis_note: { type: 'string', description: '왜 이 단계를 호출하는지 한 줄 메모' },
      },
      required: ['analysis_note'],
    },
  },
  {
    name: 'count_verification',
    description: 'target_analysis 결과 filters로 실제 DB 매칭 고객 수를 검증합니다. AI 추정값이 아닌 DB 실제 count를 반환합니다. (target_analysis 후 필수)',
    input_schema: {
      type: 'object',
      properties: {
        verification_note: { type: 'string', description: '검증 의도 한 줄 메모' },
      },
      required: ['verification_note'],
    },
  },
  {
    name: 'message_composition',
    description: 'target_analysis + count_verification 결과를 바탕으로 채널별 A/B/C 메시지 3안을 생성합니다. (count_verification 후 호출, 0건이면 호출 금지)',
    input_schema: {
      type: 'object',
      properties: {
        composition_note: { type: 'string', description: '문안 의도 한 줄 메모' },
      },
      required: ['composition_note'],
    },
  },
  {
    name: 'compliance_check',
    description: '생성된 메시지가 한국 정보통신망법 + 카카오 정책 + 통신사 스팸 정책에 부합하는지 검수합니다. (message_composition 후 호출)',
    input_schema: {
      type: 'object',
      properties: {
        check_note: { type: 'string', description: '검수 의도 한 줄 메모' },
      },
      required: ['check_note'],
    },
  },
];

export async function orchestrateWithAI(ctx: AgentContext, creditOpts?: { source?: string; cost?: number }): Promise<OrchestratorResult> {
  // ★ D227+ 종량제: 풀분석 묶음 (orchestrate와 동일 — 진입 1회 차감). fallback은 _orchestrateImpl 직접(이중차감 방지).
  const source = creditOpts?.source ?? 'orchestrate';
  const cost = creditOpts?.cost ?? getCreditCost(source);
  await checkCredit(ctx.companyId, cost);
  return runInCreditBundle(async () => {
    const result = await _orchestrateWithAIImpl(ctx);
    // ★ 2026-07-08 (Harold 명시): 문안 미출력(0건 매칭 등) = 사용자 결과 없음 → 차감 skip.
    //   문안이 1개 이상 실제 생성된 경우에만 과금 (6원칙 ② 효과 검증 후 과금).
    if ((result.messages?.length ?? 0) > 0) {
      await deductCreditSafe({ companyId: ctx.companyId, cost, source, createdBy: ctx.userId || currentUserId() || null });
    }
    return result;
  });
}

async function _orchestrateWithAIImpl(ctx: AgentContext): Promise<OrchestratorResult> {
  console.log('[OrchestratorAI] 진입 — Opus 4.7 Tool Use 기반 sub-agent 호출 흐름');

  const durations: Record<string, number> = {};
  const trace: ToolCallTrace[] = [];
  const toolCallCounts: Record<string, number> = {};
  const mark = (key: string, start: number) => { durations[key] = Date.now() - start; };

  // sub-agent 호출 결과 저장 (각 tool이 채우는 closure 변수)
  let targetResult: any = null;
  let estimatedCount = 0;
  let countVerified = false;
  let normalizedMessages: OrchestratorResult['messages'] = [];
  let messagesResult: any = null;
  let compliance: ComplianceResult = { passed: false, riskLevel: 'high', warnings: ['Compliance 미실행'], suggestions: [] };
  // ★ Orchestrator AI 최종 통합 분석(end_turn 텍스트) — 결과 meta.aiSynthesis로 전달(토큰 낭비 방지)
  let aiSynthesis = '';

  // Tool 실제 호출 (tool name → 해당 sub-agent 함수)
  const callTool = async (toolName: string): Promise<any> => {
    const start = Date.now();
    try {
      if (toolName === 'target_analysis') {
        targetResult = await recommendTarget(
          ctx.companyId, ctx.objective, ctx.customerStats, ctx.companyInfo as any,
          { model: 'opus' }
        );
        // ★ 2026-07-02 (Harold 명시): 자동마케팅 = 무조건 광고 — orchestrate와 동일 1곳 override.
        if (ctx.forcedIsAd === true) targetResult.is_ad = true;
        estimatedCount = Math.max(0, targetResult.estimated_count || 0);
        mark('target', start);
        return {
          estimated_count: estimatedCount,
          filters: targetResult.filters,
          reasoning: targetResult.reasoning,
          recommended_channel: targetResult.recommended_channel,
          is_ad: !!targetResult.is_ad,
          suggested_campaign_name: targetResult.suggested_campaign_name,
        };
      }
      if (toolName === 'count_verification') {
        if (!targetResult) {
          mark('verify', start);
          return { error: 'target_analysis가 먼저 호출되어야 합니다.' };
        }
        try {
          // ★ 2026-08-03 A-1 / 1R 정정: 자동마케팅 회차만 발송 게이트를 포함한 단일 문으로 센다.
          //   이 tool 흐름은 공용 제안(/operator/propose)도 쓰므로 범위 밖에는 종전 count를 유지한다.
          const actual = ctx.audienceScope === 'operator'
            ? (await countOperatorAudienceFor({ companyId: ctx.companyId, legacyFilters: targetResult.filters })).count
            : (await countFilteredCustomers(ctx.companyId, targetResult.filters, ctx.userId || '')).count;
          estimatedCount = actual;
          countVerified = true;
          mark('verify', start);
          return {
            actual_count: actual,
            // ★ Zero-Count 영구 원칙 안내 (Harold 명시 D171)
            warning: actual === 0
              ? '★ 매칭 0건 — 발송 차단 정합 (Harold 영구 원칙). 자동완화 절대 금지. message_composition 호출 X. 사용자에게 조건 재입력 안내 제공할 것.'
              : null,
          };
        } catch (cntErr: any) {
          // ★ 2026-08-03 A-1 fail-closed: 실측 실패는 0으로 — message_composition 게이트가 그대로 막는다.
          estimatedCount = 0;
          countVerified = false;
          mark('verify', start);
          return { error: `count_verification 실패: ${cntErr?.message || 'unknown'} — 대상 0 처리(추정값 사용 금지)` };
        }
      }
      if (toolName === 'message_composition') {
        if (!targetResult) {
          mark('message', start);
          return { error: 'target_analysis가 먼저 호출되어야 합니다.' };
        }
        if (estimatedCount === 0) {
          mark('message', start);
          return { error: '★ 매칭 0건 — Zero-Count 영구 원칙으로 message_composition 호출 차단. count_verification 결과를 사용자에게 안내해야 함.' };
        }
        const { fieldMappings: varCatalog, availableVars } = extractVarCatalog(ctx.companyInfo.customer_schema);
        await filterVarCatalogByData(varCatalog, availableVars, ctx.companyId);
        // ★ D210+ Phase 2 (Harold 명시 2026-05-23): 회사 customer DB 실측 프로필 자동 조회 (CT-58).
        const companyDataProfile = await getCompanyDataProfile(ctx.companyId);

        messagesResult = await generateMessages(
          buildMessageObjective(ctx.objective, ctx.seasonHint),
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
            // ★ D210+ Phase 2 (Harold 명시 2026-05-23): 회사 실측 데이터 프로필 (CT-58) 전달 — 어설픈 변수 차단.
            companyDataProfile,
            // ★ D209+ (Harold 명시 2026-05-22): orchestrateWithAI 내부 generateMessages도 Sonnet 4.6 전환.
            //   메시지 품질 ai.ts 정합 본질 + 비용 80% 절감.
            model: 'sonnet',
            // ★ D225+ Brand Voice Learning — 회사별 가이드라인 자동 주입
            companyId: ctx.companyId,
          }
        );
        normalizedMessages = messagesResult.variants.slice(0, 3).map((v: any) => {
          const anyV = v as Record<string, unknown>;
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
        mark('message', start);
        return {
          variant_count: normalizedMessages.length,
          recommendation: messagesResult.recommendation,
          recommendation_reason: messagesResult.recommendation_reason,
          primary_body_preview: normalizedMessages[0]?.body?.slice(0, 200) || '',
        };
      }
      if (toolName === 'compliance_check') {
        if (!targetResult || normalizedMessages.length === 0) {
          mark('compliance', start);
          return { error: 'message_composition이 먼저 호출되어야 합니다.' };
        }
        const primaryBody = normalizedMessages[0]?.body || '';
        compliance = await checkCompliance(
          primaryBody,
          targetResult.recommended_channel || 'SMS',
          !!targetResult.is_ad,
          ctx.companyId
        );
        mark('compliance', start);
        return {
          passed: compliance.passed,
          risk_level: compliance.riskLevel,
          warnings: compliance.warnings,
          suggestions: compliance.suggestions,
        };
      }
      return { error: `알 수 없는 tool: ${toolName}` };
    } catch (err: any) {
      console.error(`[OrchestratorAI] tool ${toolName} 호출 실패:`, err);
      return { error: err?.message || 'tool 호출 실패' };
    }
  };

  // ============ Opus 4.7 Orchestrator AI 호출 ============
  const memoryContext = await buildCompanyMemoryContext(ctx.companyId);

  const systemPrompt = `당신은 한국 SMS/LMS 마케팅 자동화의 진정 Orchestrator AI입니다.
사용자의 마케팅 목표(자연어 한 줄)를 받아, 사용 가능한 sub-agent tool 4종을 적절한 순서로 호출하여 통합 제안서를 만들어주세요.

${memoryContext}

## 사용 가능한 Tool (호출 순서 권장)
1. target_analysis (필수, 1회): 마케팅 목표 → 고객 타겟 필터 + 채널 + 광고 여부 추출
2. count_verification (필수, target 후 1회): DB 실제 매칭 고객 수 검증
3. message_composition (count>0 시 1회): 채널별 A/B/C 메시지 3안 생성. count=0이면 호출 금지
4. compliance_check (message 후 1회): 정보통신망법 + 카카오 정책 + 스팸 정책 검수

## ★ 절대 영구 원칙 (Harold 명시 D171)
- 타겟 매칭 0건이 나오면 자동완화(relaxFilters / auto-relax) 절대 금지. 발송 차단이 정합.
- AI가 임의로 조건 풀어서 다른 고객에게 발송 = 마케팅 의도 파괴 + 수신자 권리 침해 + 발신번호 차단 위험.
- count_verification 결과 0건이면 message_composition 호출하지 말고, "★ 매칭 0건 — 사용자가 조건을 재입력해야 합니다" 한 줄로 즉시 응답 종료.

## 흐름 가이드
- 4 tool을 모두 호출한 후 통합 분석 한 단락(200자 이내) 박고 종료 (stop_reason='end_turn')
- 각 tool은 최대 2회만 호출 가능 (안전장치)
- 동일 tool 결과 받은 후 입력 변경 없이 재호출 금지
- tool_use 없이 자유 텍스트만 응답하면 fallback 흐름으로 전환됩니다 — 반드시 tool을 호출하세요`;

  const userMessage = `## 사용자 마케팅 목표
"${ctx.objective}"

## 회사 컨텍스트
- 회사명: ${ctx.companyInfo.company_name || '(미설정)'}
- 업종: ${ctx.companyInfo.business_type || '(미설정)'}
- 전체 고객: ${ctx.customerStats.total || 0}명
- SMS 수신동의: ${ctx.customerStats.sms_opt_in_count || 0}명

위 정보 + 회사 메모리를 토대로 sub-agent tool을 순서대로 호출해 통합 제안서를 만들어주세요.
모든 tool 호출 후 최종 분석을 한 단락(200자 이내) 박고 종료해주세요.`;

  const orchestratorStart = Date.now();
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];
  const maxIterations = 8;
  let stoppedNormally = false;

  try {
    for (let iter = 1; iter <= maxIterations; iter++) {
      // Sonnet 5는 thinking 생략 시 adaptive 자동 ON → tool 루프 max_tokens 잠식·응답 잘림 방지
      const orchThinking: any = isAdaptiveOnlyModel(AI_MODELS.opus) ? { thinking: { type: 'disabled' } } : {};
      const response = await orchestratorAnthropic.messages.create({
        model: AI_MODELS.opus,
        max_tokens: resolveMaxTokens(4096, AI_MODELS.opus),
        ...orchThinking,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages,
        tools: ORCHESTRATOR_TOOLS,
      });

      // 종료 조건
      if (response.stop_reason !== 'tool_use') {
        const textBlock = response.content.find((b: any) => b.type === 'text');
        const finalText = textBlock && textBlock.type === 'text' ? (textBlock as any).text : '';
        aiSynthesis = (finalText || '').trim();
        console.log(`[OrchestratorAI] iter ${iter} 종료 (stop_reason=${response.stop_reason}) — ${finalText.slice(0, 100)}`);
        stoppedNormally = true;
        break;
      }

      // tool_use blocks 처리
      const toolUseBlocks = response.content.filter((b: any) => b.type === 'tool_use');
      if (toolUseBlocks.length === 0) {
        console.warn('[OrchestratorAI] tool_use stop_reason인데 tool_use block 0건 — fallback');
        break;
      }

      // assistant message에 박음
      messages.push({ role: 'assistant', content: response.content as any });

      // 각 tool 호출 + tool_result 박음
      const toolResults: any[] = [];
      for (const toolUse of toolUseBlocks) {
        if (toolUse.type !== 'tool_use') continue;
        const toolName = (toolUse as any).name;
        const toolUseId = (toolUse as any).id;
        const toolInput = (toolUse as any).input;

        // per-tool max_calls 안전장치
        toolCallCounts[toolName] = (toolCallCounts[toolName] || 0) + 1;
        if (toolCallCounts[toolName] > 2) {
          console.warn(`[OrchestratorAI] tool ${toolName} 2회 초과 — 차단`);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: JSON.stringify({ error: '동일 tool 2회 초과 호출 차단 (안전장치)' }),
            is_error: true,
          });
          continue;
        }

        const toolStart = Date.now();
        const toolResult = await callTool(toolName);
        trace.push({
          iteration: iter,
          tool: toolName,
          inputSummary: typeof toolInput === 'object' ? JSON.stringify(toolInput).slice(0, 100) : String(toolInput).slice(0, 100),
          durationMs: Date.now() - toolStart,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: JSON.stringify(toolResult),
          is_error: !!toolResult.error,
        });
      }

      messages.push({ role: 'user', content: toolResults as any });
    }

    mark('orchestrator', orchestratorStart);

    // 필수 tool 호출 검증
    if (!targetResult) {
      throw new Error('OrchestratorAI: target_analysis 미호출 — fallback');
    }
    if (!messagesResult || normalizedMessages.length === 0) {
      // 0건 매칭으로 message_composition 의도적 skip한 경우 정합
      if (estimatedCount === 0) {
        console.log('[OrchestratorAI] 0건 매칭으로 message_composition skip — Zero-Count 영구 원칙 정합');
        normalizedMessages = [];
        messagesResult = { recommendation: '', recommendation_reason: '매칭 고객 0건 — 사용자가 조건을 재입력해야 합니다.' };
      } else {
        throw new Error('OrchestratorAI: message_composition 미호출 (count>0) — fallback');
      }
    }
    if (!stoppedNormally) {
      console.warn(`[OrchestratorAI] max_iterations(${maxIterations}) 도달 — 부분 결과로 진행`);
    }
  } catch (orchErr: any) {
    console.error('[OrchestratorAI] 흐름 실패 — _orchestrateImpl fallback:', orchErr?.message || orchErr);
    return _orchestrateImpl(ctx);
  }

  // ============ 성과 추정 (D227+ 실데이터 — 타겟 객단가 + 과거 실측) ============
  const costStart = Date.now();
  const channelKeyAI = (targetResult.recommended_channel || 'SMS').toLowerCase();
  const costsAI = getCompanyCosts(ctx.companyInfo);
  const unitCostAI = (costsAI as Record<string, number>)[channelKeyAI] ?? costsAI.sms;
  const est = await estimatePerformance({
    companyId: ctx.companyId,
    filters: targetResult.filters || {},
    count: estimatedCount,
    channel: targetResult.recommended_channel || 'SMS',
    unitCost: unitCostAI,
    fallbackAvgRevenue: parseFloat(ctx.customerStats.avg_total_spent) || 0,
  });
  mark('costRoi', costStart);

  // ★ D227+ 성과 인사이트 sub-agent (Opus) — 통계 숫자 위에 진단·전략·리스크 (숫자 생성 X)
  const insight = await generatePerformanceInsight({
    level: est.basis.level,
    companyName: String(ctx.companyInfo?.name || ctx.companyInfo?.company_name || '고객사'),
    objective: ctx.objective,
    channel: targetResult.recommended_channel || 'SMS',
    targetCount: estimatedCount,
    expectedConversions: est.performance.expectedConversions,
    conversionRate: est.performance.conversionRate,
    expectedRevenue: est.performance.expectedRevenue,
    estimatedCost: est.cost.estimated,
    multiple: est.cost.estimated > 0 ? est.performance.expectedRevenue / est.cost.estimated : 0,
    eventWindowDays: est.basis.eventWindowDays,
    confidence: est.basis.confidence,
    gradeBreakdown: est.basis.gradeBreakdown || [],
    basisLabel: est.basis.label,
  }, ctx.companyId);

  return {
    target: {
      count: estimatedCount,
      totalCount: parseInt(ctx.customerStats.total || '0'),
      criteria: targetResult.reasoning || '',
      filters: targetResult.filters || {},
      suggestedName: targetResult.suggested_campaign_name || '',
    },
    messages: normalizedMessages,
    recommendation: messagesResult.recommendation || '',
    recommendationReason: messagesResult.recommendation_reason || '',
    channel: {
      recommended: targetResult.recommended_channel || 'SMS',
      reason: targetResult.channel_reason || '',
      isAd: !!targetResult.is_ad,
      rejectNumber: (ctx.companyInfo.reject_number as string) || null,
    },
    schedule: {
      recommendedTime: targetResult.recommended_time || '',
    },
    compliance,
    cost: est.cost,
    performance: { ...est.performance, basis: est.basis, insight },
    meta: {
      usePersonalization: !!targetResult.use_personalization,
      personalizationVars: targetResult.personalization_vars || [],
      useIndividualCallback: !!targetResult.use_individual_callback,
      countVerified,
      generatedAt: new Date().toISOString(),
      agentDurations: durations,
      usedAIDecision: true,
      aiDecisionTrace: trace,
      aiSynthesis: aiSynthesis || undefined,
    },
  };
}

// ============================================================
// ★ D227+ 성과 인사이트 Sub-agent (Opus) — 통계 결과를 받아 진단·전략·리스크를 자연어로 생성.
//   숫자는 통계가 만든 것만 인용 (buildInsightPrompt의 system 가드 + normalizeInsight 정규화).
//   데이터 부족(insufficient_data) → AI 호출 스킵 + 데이터 연동 안내.
//   AI 실패 → graceful degrade (빈 인사이트, 통계는 그대로 표시, 발송 차단 X).
// ============================================================
async function generatePerformanceInsight(input: InsightInput, companyId?: string): Promise<InsightResult> {
  if (input.level === 'insufficient_data') return buildInsufficientInsight();
  try {
    const { system, userMessage } = buildInsightPrompt(input);
    const text = await callAIWithFallback({
      system,
      userMessage,
      maxTokens: 1200,
      temperature: 0.5,
      model: 'opus',
      companyId,
      source: 'performance-insight',
    });
    return normalizeInsight(extractJsonFromAiText(text));
  } catch (e: any) {
    console.log('[performance-insight] AI skip:', e?.message || e);
    return { diagnosis: '', insights: [], strategy: [], risks: [], generated: false };
  }
}
