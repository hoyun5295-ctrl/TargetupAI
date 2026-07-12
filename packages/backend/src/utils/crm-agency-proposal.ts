// ============================================================
// crm-agency-proposal.ts — CRM 캠페인 대행 제안서 엔진 (슈퍼관리자 내부 도구 · 무과금)
// ============================================================
// 스펙: docs/superpowers/specs/2026-07-09-crm-campaign-agency-design.md
// ★ 최상위 불변식 (Harold 2026-07-09): 업체 단일 스코프 — 아래 모든 쿼리·CT 호출은
//   인자로 받은 companyId 하나만 바라본다 (WHERE company_id = $1). 교차 오염 절대 금지.
// ★ 무과금 (Harold 확정): 전 AI 호출을 runInCreditBundle로 감싸 고객사 크레딧 차감 0.
//   (callAIWithFallback은 creditCost 미지정 시 source 맵으로 자동 차감 — 번들이 이를 차단)
// 타겟 실측 = 기존 검증 경로 재사용: recommendTarget(자연어→필터) + countFilteredCustomers(공통 안전필터 COUNT).
import { query } from '../config/database';
import { callAIWithFallback, recommendTarget, countFilteredCustomers } from '../services/ai';
import { extractJsonFromAiText } from './ai-json';
import { getCompanyDataProfile, formatProfileForAiPrompt } from './company-data-profile';
import { listMemories, LEARNING_MEMORY_TYPES } from './company-memory';
import { runInCreditBundle } from './ai-credit-context';
import { getCompanyCosts } from '../config/defaults';
import {
  AgencyProposalResult, buildAgencyIntakeSystemPrompt, buildAgencySystemPrompt, buildAgencyUserMessage, normalizeProposal,
} from './crm-agency-proposal-core';
import { extractEventTextFromImages, EventImageInput } from './event-image-extract';
import { buildParsedFromForm, sanitizeIntakeDates } from './crm-agency-request';
import type { AgencyRequestParsed } from './crm-agency-request';

interface AgencyContext {
  companyRow: Record<string, any>;
  customerStats: Record<string, any>;
  profileBlock: string;
  memoryLines: string[];
  campaignLines: string[];
  notes: string[];
}

/** 회사 스코프 실데이터 수집 — 축별 best-effort(실패 축은 notes에 정직 기록, 전체 실패 아님) */
async function collectContext(companyId: string): Promise<AgencyContext> {
  const notes: string[] = [];

  // 회사 기본 + 단가 (컬럼 전부 기존 운영 코드 SELECT 실증분 — continuous-operator ctx·report-pdf)
  const companyRes = await query(
    `SELECT company_name, business_type, brand_name, brand_tone, customer_schema,
            cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao
       FROM companies WHERE id = $1::uuid`,
    [companyId],
  );
  const companyRow = companyRes.rows[0];
  if (!companyRow) throw new Error('회사를 찾을 수 없습니다.');

  // 고객 통계 (continuous-operator generateProposal 동일 산식 — 운영 실증)
  const statsRes = await query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE sms_opt_in = true) AS sms_opt_in_count,
       AVG((custom_fields->>'purchase_count')::numeric) AS avg_purchase_count,
       AVG((custom_fields->>'total_spent')::numeric) AS avg_total_spent
     FROM customers
     WHERE company_id = $1::uuid AND is_active = true`,
    [companyId],
  );
  const customerStats = statsRes.rows[0] || {};

  // 축 1 — DB 현황 프로필 (%변수% 세계 = percent)
  let profileBlock = '';
  try {
    const profile = await getCompanyDataProfile(companyId);
    profileBlock = formatProfileForAiPrompt(profile, { variableStyle: 'percent' });
  } catch (e: any) {
    notes.push('고객DB 현황 분석 실패 — 해당 축 생략');
    console.log('[CRM대행] 프로필 축 생략:', e?.message || e);
  }

  // 축 2 — AI 학습 메모리 (중요도순 상위)
  let memoryLines: string[] = [];
  try {
    // ★ 2026-07-12 — 학습 5종 한정 (무필터면 브랜드 자산(중요도 7~10, 최대 31행)이 20슬롯 잠식)
    const memories = await listMemories(companyId, { limit: 20, memoryTypes: LEARNING_MEMORY_TYPES });
    memoryLines = memories.map((m) => `- [${m.memoryType}] ${m.memoryKey}: ${m.memoryValue} (중요도 ${m.importance})`);
  } catch (e: any) {
    notes.push('AI 학습 메모리 조회 실패 — 해당 축 생략');
    console.log('[CRM대행] 메모리 축 생략:', e?.message || e);
  }

  // 축 3 — 최근 캠페인 이력 (campaign_name 등 5컬럼 = information_schema + 운영 SELECT 실증 2026-07-09)
  let campaignLines: string[] = [];
  try {
    const campRes = await query(
      `SELECT campaign_name, message_type, sent_at, target_count, success_count
         FROM campaigns
        WHERE company_id = $1::uuid AND sent_at IS NOT NULL
        ORDER BY sent_at DESC LIMIT 15`,
      [companyId],
    );
    campaignLines = campRes.rows.map((c: any) => {
      const d = c.sent_at ? new Date(c.sent_at).toISOString().slice(0, 10) : '-';
      return `- ${d} · ${c.campaign_name || '(무제)'} · ${c.message_type || '-'} · 대상 ${c.target_count ?? '-'} · 성공 ${c.success_count ?? '-'}`;
    });
  } catch (e: any) {
    notes.push('과거 캠페인 이력 조회 실패 — 해당 축 생략');
    console.log('[CRM대행] 캠페인 축 생략:', e?.message || e);
  }

  return { companyRow, customerStats, profileBlock, memoryLines, campaignLines, notes };
}

/** 플랜별 타겟 실측 — 대상자 수는 AI 추정이 아닌 DB COUNT (영구 룰). 플랜 단위 실패는 정직 기록 후 계속. */
async function measurePlanTargets(
  companyId: string, ctx: AgencyContext, result: AgencyProposalResult,
): Promise<void> {
  const costs = getCompanyCosts(ctx.companyRow);
  const companyInfo = {
    business_type: ctx.companyRow.business_type,
    brand_name: ctx.companyRow.brand_name,
    company_name: ctx.companyRow.company_name,
    customer_schema: ctx.companyRow.customer_schema,
  };
  for (const plan of result.plans) {
    if (!plan.targetDescription) continue;
    try {
      // 자연어 규칙 → 필터 (기존 Target Sub-agent — 번들 안이라 무과금)
      const target = await recommendTarget(
        companyId,
        `다음 명확한 규칙에 해당하는 고객만: ${plan.targetDescription}`,
        ctx.customerStats,
        companyInfo,
        { model: 'opus' },
      );
      // ★ Codex 적대 리뷰 fix: 빈 필터({}) = 변환 실패 취급 — recommendTarget degraded 경로(API 키 미설정 등)가
      //   filters:{}를 반환하면 전 고객 COUNT가 좁은 타겟 플랜에 찍히는 오표기 차단(services/ai.ts:1588 실증).
      plan.targetFilters = target?.filters && Object.keys(target.filters).length > 0 ? target.filters : null;
      if (!plan.targetFilters) { result.dataNotes.push(`'${plan.title}' 타겟 필터 변환 실패 — 실행 시 재산정`); continue; }
      // DB 실측 COUNT (공통 안전필터 포함 — orchestrator와 동일 경로, userId ''=orchestrator 관례)
      const counted = await countFilteredCustomers(companyId, plan.targetFilters as Record<string, any>, '');
      plan.targetCount = Number((counted as any)?.count) || 0;
      const unit = plan.channel === 'sms' ? costs.sms
        : plan.channel === 'lms' ? costs.lms
        : plan.channel === 'mms' ? costs.mms
        : plan.channel === 'alimtalk' ? costs.kakao
        : null;
      plan.estimatedCost = unit != null && plan.targetCount != null ? Math.round(plan.targetCount * unit) : null;
    } catch (e: any) {
      plan.targetFilters = null; plan.targetCount = null; plan.estimatedCost = null;
      result.dataNotes.push(`'${plan.title}' 타겟 실측 실패 — 실행 시 재산정`);
      console.log('[CRM대행] 플랜 타겟 실측 생략:', e?.message || e);
    }
  }
}

/**
 * 접수 폼 자동 입력 — 행사 이미지를 구조화 전사해 폼 필드(AgencyRequestParsed)로 반환 (2026-07-09 Harold 승인).
 * 저장 없음(호출측이 폼 프리필에만 사용). 무과금(runInCreditBundle) — 대행 상품 정책과 동일.
 * @param companyId 요청 고객사(크레딧 컨텍스트·비즈니스+ 게이트는 호출측 검증)
 */
export async function analyzeAgencyIntakeImages(
  companyId: string, images: EventImageInput[],
): Promise<AgencyRequestParsed> {
  return runInCreditBundle(async () => {
    const aiText = await callAIWithFallback({
      system: buildAgencyIntakeSystemPrompt(),
      userMessage: '위 이미지에 실제로 보이는 내용만 규칙대로 JSON으로 정리해줘. 보이지 않는 값은 빈 값으로 둬.',
      maxTokens: 1500,
      temperature: 0.2,
      companyId,
      source: 'crm-agency-intake',
      creditCost: 0,  // ★ 무과금 명시 (번들이 이미 0 처리 — 이중 안전)
      images,
    });
    const raw = extractJsonFromAiText(aiText);
    // 정규화 + 날짜 ISO 가드(달력 입력칸 호환) — 없는 값은 빈 값 그대로(추정 금지)
    return sanitizeIntakeDates(buildParsedFromForm(raw));
  });
}

/**
 * CRM 캠페인 대행 제안서 생성 — 슈퍼관리자 전용 진입점.
 * @param companyId 분석 대상 업체 (★ 단일 스코프 — 이 함수의 모든 하위 호출이 이 값만 사용)
 * @param images 고객사가 접수 시 올린 행사 이미지(base64) — 있으면 vision 전사 축 추가 (번들 안 = 무과금)
 */
export async function generateAgencyProposal(
  companyId: string, request: AgencyRequestParsed, images?: EventImageInput[],
): Promise<AgencyProposalResult> {
  return runInCreditBundle(async () => {
    const ctx = await collectContext(companyId);

    // 축 4 — 행사 이미지 판독(전사). 실패는 정직 기록 후 계속(기존 축과 동일한 best-effort).
    let imageTranscript = '';
    if (images && images.length > 0) {
      try {
        imageTranscript = await extractEventTextFromImages({ images, companyId });
      } catch (e: any) {
        ctx.notes.push('행사 이미지 판독 실패 — 해당 축 생략');
        console.log('[CRM대행] 이미지 판독 축 생략:', e?.message || e);
      }
    }

    const aiText = await callAIWithFallback({
      system: buildAgencySystemPrompt(),
      userMessage: buildAgencyUserMessage({
        companyName: ctx.companyRow.company_name || '',
        businessType: ctx.companyRow.business_type || '',
        brandName: ctx.companyRow.brand_name || '',
        brandTone: ctx.companyRow.brand_tone || '',
        profileBlock: ctx.profileBlock,
        memoryLines: ctx.memoryLines,
        campaignLines: ctx.campaignLines,
        request,
        imageTranscript: imageTranscript || undefined,
      }),
      maxTokens: 4000,
      temperature: 0.5,
      model: 'opus',
      companyId,
      source: 'crm-agency-proposal',
      creditCost: 0,  // ★ 무과금 명시 (번들이 이미 0 처리 — 이중 안전)
    });
    const parsed = extractJsonFromAiText(aiText);
    // 이미지 전사 = 고객 제출물 — 혜택 출구가드 허용 텍스트에 포함
    const result = normalizeProposal(parsed, ctx.companyRow.company_name || '', request, imageTranscript || undefined);
    if (imageTranscript) result.imageTranscript = imageTranscript;
    await measurePlanTargets(companyId, ctx, result);
    result.dataNotes.push(...ctx.notes);
    return result;
  });
}
