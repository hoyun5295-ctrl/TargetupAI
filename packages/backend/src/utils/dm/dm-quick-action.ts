/**
 * CT-87 — dm-quick-action.ts
 *
 * D216+ 모바일DM 강화 — 1-click 3 액션 자동 처리.
 *
 * 3 액션:
 *   - ai_refine — 전체 카피 다듬기 (감성 + 실용 톤)
 *   - design_align — 브랜드 킷 색상 정합화
 *   - variable_consistency — 변수 fallback 자동 추가
 *
 * 영구 룰 정합:
 *   - feedback_ai_no_arbitrary_benefit — AI 시스템 프롬프트 안 구체 혜택 X
 *   - feedback_ai_operator_model_isolation — model: 'opus'
 *   - feedback_no_target_auto_relax — 임의 추측 X
 *
 * 호출 영역: routes/dm.ts POST /:id/quick-action
 */

import { query } from '../../config/database';
// ★ 2026-09-26 한줄로 V2 R1-26 — 섹션 읽기·되쓰기 CT(pages 우선)
import { extractFlatSectionsFromDm, mapDmSections } from './dm-builder';
import { callAIWithFallback } from '../../services/ai';
import { extractJson } from './dm-ai';
import type { SectionType } from './dm-section-registry';

// ────────────── 타입 ──────────────

export type QuickActionType = 'ai_refine' | 'design_align' | 'variable_consistency';

export interface QuickActionChange {
  section_id: string;
  section_type: SectionType;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string;
}

export interface QuickActionResult {
  action: QuickActionType;
  campaign_id: string;
  changes: QuickActionChange[];
  applied_at: string;
}

// ────────────── 헬퍼 ──────────────

function parseJson<T = any>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  return value as T;
}

function extractEditableText(sec: any): string {
  switch (sec?.type) {
    case 'header':
      return sec?.props?.brand_name || sec?.props?.event_title || '';
    case 'hero':
      return `${sec?.props?.headline || ''}\n${sec?.props?.sub_copy || ''}`.trim();
    case 'text_card':
      return `${sec?.props?.headline || ''}\n${sec?.props?.body || ''}`.trim();
    case 'cta':
      return (sec?.props?.buttons || []).map((b: any) => b?.label).filter(Boolean).join(' / ');
    case 'footer':
      return sec?.props?.notes || '';
    default:
      return '';
  }
}

function applyRefinedText(sec: any, refined: string): Record<string, unknown> {
  const props = { ...(sec?.props || {}) };
  switch (sec?.type) {
    case 'header':
      if (props.brand_name) props.brand_name = refined.split('\n')[0] || props.brand_name;
      else props.event_title = refined.split('\n')[0] || props.event_title;
      return props;
    case 'hero': {
      const lines = refined.split('\n').filter((l) => l.trim());
      return {
        ...props,
        headline: lines[0] || props.headline,
        sub_copy: lines.slice(1).join('\n') || props.sub_copy,
      };
    }
    case 'text_card': {
      const lines = refined.split('\n').filter((l) => l.trim());
      return {
        ...props,
        headline: lines[0] || props.headline,
        body: lines.slice(1).join('\n') || props.body,
      };
    }
    case 'footer':
      return { ...props, notes: refined };
    default:
      return props;
  }
}

// ────────────── ai_refine 액션 ──────────────

const REFINE_SYSTEM = `당신은 모바일 DM 카피라이터입니다. 원본 카피를 한국 마케팅 톤 (감성 + 실용) 으로 다듬습니다.

**절대 금지:**
- 원본에 없는 정보 (할인율 / 가격 / 일자 / 매장명) 추가 금지
- 구체 혜택 (%/원/쿠폰/무료/사은품/적립/무료배송/할인) 임의 생성 금지. 회사 admin 직접 작성 영역
- 유니코드 이모지 추가 금지. SMS 호환 특수문자만 사용
- 변수 (% 감싸기) 형식 보존 의무

**허용:**
- 길이 80~150% 변동
- 감성 + 실용 톤 조정
- 자연스러운 한국어 다듬기
- 인사말 / 마무리 표현 추가

**출력 형식 (JSON):**
{ "refined": "..." }`;

async function refineAllCopy(companyId: string, campaignId: string): Promise<QuickActionResult> {
  // ★ 2026-09-26 한줄로 V2 R1-26 — pages 우선(요즘 DM) · 옛 sections 칸 폴백(CT)
  const result = await query(`SELECT pages, sections FROM dm_pages WHERE id = $1`, [campaignId]);
  const sections: any[] = extractFlatSectionsFromDm(result.rows[0]);

  const changes: QuickActionChange[] = [];

  for (const sec of sections) {
    const text = extractEditableText(sec);
    if (!text || text.length < 5) continue;

    try {
      const aiText = await callAIWithFallback({
        system: REFINE_SYSTEM,
        userMessage: `원본:\n${text}`,
        maxTokens: 400,
        temperature: 0.7,
        model: 'opus',
        companyId,
        source: 'dm-quick-action-refine',
      });

      const parsed = extractJson<{ refined?: string }>(aiText);
      const refined = (parsed?.refined || '').trim();

      if (refined && refined !== text) {
        const newProps = applyRefinedText(sec, refined);
        changes.push({
          section_id: sec.id,
          section_type: sec.type,
          before: sec.props,
          after: newProps,
          reason: '카피 톤 정합 다듬기',
        });
      }
    } catch (err) {
      console.warn(`[dm-quick-action] refine 실패 section_id=${sec?.id}:`, err);
    }
  }

  return {
    action: 'ai_refine',
    campaign_id: campaignId,
    changes,
    applied_at: new Date().toISOString(),
  };
}

// ────────────── design_align 액션 ──────────────

async function alignDesign(campaignId: string): Promise<QuickActionResult> {
  const result = await query(`SELECT pages, sections, brand_kit FROM dm_pages WHERE id = $1`, [campaignId]);
  const sections: any[] = extractFlatSectionsFromDm(result.rows[0]);   // ★ 2026-09-26 R1-26 pages 우선
  const brandKit: any = parseJson(result.rows[0]?.brand_kit) || {};

  const changes: QuickActionChange[] = [];

  for (const sec of sections) {
    const newProps: Record<string, any> = { ...(sec?.props || {}) };
    let modified = false;

    if (
      sec?.type === 'header' &&
      brandKit?.primary_color &&
      newProps.background_color !== brandKit.primary_color
    ) {
      newProps.background_color = brandKit.primary_color;
      modified = true;
    }
    if (sec?.type === 'cta' && brandKit?.accent_color && Array.isArray(newProps.buttons)) {
      newProps.buttons = newProps.buttons.map((b: any) => ({
        ...b,
        background_color: b?.style === 'primary' ? brandKit.accent_color : b?.background_color,
      }));
      modified = true;
    }
    if (
      sec?.type === 'footer' &&
      brandKit?.neutral_color &&
      newProps.background_color !== brandKit.neutral_color
    ) {
      newProps.background_color = brandKit.neutral_color;
      modified = true;
    }

    if (modified) {
      changes.push({
        section_id: sec.id,
        section_type: sec.type,
        before: sec.props,
        after: newProps,
        reason: '브랜드 킷 색상 정합화',
      });
    }
  }

  return {
    action: 'design_align',
    campaign_id: campaignId,
    changes,
    applied_at: new Date().toISOString(),
  };
}

// ────────────── variable_consistency 액션 ──────────────

const FALLBACK_MAP: Record<string, string> = {
  name: '고객님',
  고객명: '고객님',
  grade: '회원',
  등급: '회원',
  store: '매장',
  매장: '매장',
  last_purchase_date: '최근',
  recent_purchase_date: '최근',
  최근구매일: '최근',
};

async function ensureVariableConsistency(campaignId: string): Promise<QuickActionResult> {
  const result = await query(`SELECT pages, sections FROM dm_pages WHERE id = $1`, [campaignId]);
  const sections: any[] = extractFlatSectionsFromDm(result.rows[0]);   // ★ 2026-09-26 R1-26 pages 우선

  const changes: QuickActionChange[] = [];

  for (const sec of sections) {
    const text = JSON.stringify(sec?.props || {});
    const vars = text.match(/%([^%\s]+)%/g) || [];
    if (vars.length === 0) continue;

    const existingFallbacks: any[] = sec?.props?.variable_fallbacks || sec?.variable_fallbacks || [];
    const newFallbacks: any[] = [...existingFallbacks];
    let modified = false;

    for (const varTag of vars) {
      const varName = varTag.replace(/%/g, '');
      if (!existingFallbacks.some((f: any) => f?.variable === varName)) {
        newFallbacks.push({
          variable: varName,
          fallback: FALLBACK_MAP[varName] || '',
        });
        modified = true;
      }
    }

    if (modified) {
      const newProps = { ...(sec?.props || {}), variable_fallbacks: newFallbacks };
      changes.push({
        section_id: sec.id,
        section_type: sec.type,
        before: sec.props,
        after: newProps,
        reason: '변수 fallback 자동 추가',
      });
    }
  }

  return {
    action: 'variable_consistency',
    campaign_id: campaignId,
    changes,
    applied_at: new Date().toISOString(),
  };
}

// ────────────── 메인 함수 + DB 반영 ──────────────

export async function applyQuickAction(
  companyId: string,
  campaignId: string,
  action: QuickActionType,
): Promise<QuickActionResult> {
  let result: QuickActionResult;
  switch (action) {
    case 'ai_refine':
      result = await refineAllCopy(companyId, campaignId);
      break;
    case 'design_align':
      result = await alignDesign(campaignId);
      break;
    case 'variable_consistency':
      result = await ensureVariableConsistency(campaignId);
      break;
    default:
      throw new Error(`알 수 없는 액션: ${action}`);
  }

  if (result.changes.length === 0) return result;

  // DB 반영 — ★ 2026-09-26 한줄로 V2 R1-26 읽은 곳에 쓴다(pages 구조면 pages 안 섹션 · 옛 DM이면 sections 칸 · CT mapDmSections).
  const dbResult = await query(`SELECT pages, sections FROM dm_pages WHERE id = $1 AND company_id = $2`, [campaignId, companyId]);
  const mapped = mapDmSections(dbResult.rows[0], (sec: any) => {
    const change = result.changes.find((c) => c.section_id === sec?.id);
    return change ? { ...sec, props: change.after } : sec;
  });
  if (!mapped) return result;

  await query(
    `UPDATE dm_pages SET ${mapped.column} = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
    [JSON.stringify(mapped.value), campaignId, companyId],
  );

  return result;
}
