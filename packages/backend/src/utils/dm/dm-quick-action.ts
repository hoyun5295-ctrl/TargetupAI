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

import { rewriteAddsFacts, readingAddsEfficacy, efficacyNote, EFFICACY_PROMPT_RULES, EFFICACY_REWRITE_RULE } from '../copy-benefit-detector';
import { composeVoicePrompt } from '../brand-voice-prompt';
import { resolveCopyIntent } from '../copy-content-type';
import { query } from '../../config/database';
// ★ 2026-09-26 한줄로 V2 R1-26 — 섹션 읽기·되쓰기 CT(pages 우선)
import { extractFlatSectionsFromDm, mapDmSections, getDmDetail, updateDm, DmStaleSaveError } from './dm-builder';
import { dmPublishStaticBlock } from './dm-publish-gate';
import { callAIWithFallback } from '../../services/ai';
import { checkCredit, settleOrUndo } from '../ai-credit';
import { runInCreditBundle } from '../ai-credit-context';
import { getCreditCost } from '../ai-credit-calc';
import { UserFacingError } from '../http-error';
import { randomUUID } from 'crypto';
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
  /** ★ 2026-10-24 ② 결과 안내 서버 문장(원문에 없는 효능 · 숫자 · 혜택이 생겨 버린 다듬기 수) */
  notes?: string[];
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
${EFFICACY_PROMPT_RULES}
${EFFICACY_REWRITE_RULE}

**허용:**
- 길이 80~150% 변동
- 감성 + 실용 톤 조정
- 자연스러운 한국어 다듬기
- 인사말 / 마무리 표현 추가

**출력 형식 (JSON):**
{ "refined": "..." }`;

/** 다듬기 돈 = 저장이 끝난 뒤 걷는다(applyQuickAction) · 이 함수는 금액과 키만 정한다 */
type PendingCharge = { cost: number; source: string; key: string };

async function refineAllCopy(companyId: string, campaignId: string): Promise<{ result: QuickActionResult; charge: PendingCharge | null }> {
  // ★ 2026-09-26 한줄로 V2 R1-26 — pages 우선(요즘 DM) · 옛 sections 칸 폴백(CT)
  const result = await query(`SELECT pages, sections FROM dm_pages WHERE id = $1 AND company_id = $2`, [campaignId, companyId]);
  const sections: any[] = extractFlatSectionsFromDm(result.rows[0]);
  // ★ 2026-10-25 원장 #67 · Z4 — 돈 = 바뀐 블록 수 × 단가를 성공 뒤 한 번(옛: 블록마다 응답 순간 1크레딧 · 버린 다듬기 · 바뀐 것 0 도 걷었다).
  //   AI 를 부르기 전에 최대 금액(다듬을 블록 수 × 단가)으로 잔액을 본다 · 안쪽 AI 호출은 묶음(차감 0).
  const unit = getCreditCost('dm-quick-action-refine');
  const candidates = sections.filter((sec) => { const t = extractEditableText(sec); return !!t && t.length >= 5; }).length;
  if (unit > 0 && candidates > 0) await checkCredit(companyId, unit * candidates);
  const out = await runInCreditBundle(() => refineSectionsCopy(companyId, sections));
  // ★ 1026 Codex 1R — 걷는 때 = 바뀐 내용이 저장된 뒤(옛: 여기서 걷고 그 뒤 관문 409 · 저장 실패면 결과 없이 돈만 나갔다)
  const charge = unit > 0 && out.changes.length > 0
    ? { cost: unit * out.changes.length, source: 'dm-quick-action-refine', key: `dm-quick-action-refine:${campaignId}:${randomUUID()}` }
    : null;
  const note = efficacyNote('rewrite', out.rejected);
  return {
    result: {
      action: 'ai_refine',
      campaign_id: campaignId,
      changes: out.changes,
      applied_at: new Date().toISOString(),
      ...(note ? { notes: [note] } : {}),
    },
    charge,
  };
}

async function refineSectionsCopy(companyId: string, sections: any[]): Promise<{ changes: QuickActionChange[]; rejected: number }> {
  const changes: QuickActionChange[] = [];
  let rejected = 0;
  // ★ 2026-10-28 AI 메모리 설계 K11-1 — DM 빠른 고치기 = 고치기(예시 0 · 원문 꼴 유지) · 말투만
  const { system: refineSystem } = await composeVoicePrompt({
    companyId, producer: 'dm-quick-refine', mode: 'rewrite', scope: 'tone', kind: resolveCopyIntent({ isAd: true }).kind, basePrompt: REFINE_SYSTEM,
  });

  for (const sec of sections) {
    const text = extractEditableText(sec);
    if (!text || text.length < 5) continue;

    try {
      const aiText = await callAIWithFallback({
        system: refineSystem,
        userMessage: `원본:\n${text}`,
        maxTokens: 400,
        temperature: 0.7,
        model: 'opus',
        companyId,
        source: 'dm-quick-action-refine',
      });

      const parsed = extractJson<{ refined?: string }>(aiText);
      const refined = (parsed?.refined || '').trim();
      // ★ 2026-09-30 WP2 — 다듬기는 표현만. 원문에 없던 숫자 · 혜택 값이 생긴 다듬기는 버린다(원문 유지).
      // ★ 2026-10-24 세 채널 구조체크 ② — 판정 = rewriteAddsFacts(숫자 ∥ 혜택 ∥ 효능) · 근거 = 그 칸의 실제 글(사람 검토 없이 바로 저장되는 출구라 1순위)
      //   ★ Codex 1R — 판정 대상 = **실제로 저장할 섹션의 글**(applyRefinedText 가 남긴 옛 부제 · 본문과 새 헤드라인을 고객이 이어 읽는다)
      // ★ Codex 5R · 6R — applyRefinedText 는 AI 응답이 두 줄 미만이고 원래 부제 · 본문이 있으면 그 옛 칸을 남겨 새 줄과 잇는다(「무료」 + 「배송은…」 = 새 혜택).
      //   그 조건(= 옛 칸이 실제로 남는 경우)이면 적용하지 않는다(고객 글 그대로 · 사실 판정 문제가 아니라 버린 수에 넣지 않음) · 두 줄 이상이면 칸 전부가 바뀌어 아래 판정이 본다.
      const keptSecond = sec?.type === 'hero' ? sec?.props?.sub_copy : sec?.type === 'text_card' ? sec?.props?.body : '';
      if (refined && String(keptSecond || '').trim() && refined.split('\n').filter((l) => l.trim()).length < 2) {
        console.warn(`[dm-quick-action] 다듬은 줄이 원래 칸보다 적어 적용하지 않음 section_id=${sec?.id}`);
        continue;
      }
      const newProps = refined ? applyRefinedText(sec, refined) : null;
      const appliedText = newProps ? extractEditableText({ ...sec, props: newProps }) : '';
      //   숫자 · 혜택 = AI 가 고친 글 vs 원래 글(0930 계약 그대로) · 효능 = 적용 결과를 이어 읽는 단위(readingAddsEfficacy · 칸 = 줄)
      const fabricated = !!newProps && appliedText !== text && (rewriteAddsFacts(refined, text) || readingAddsEfficacy(appliedText.split('\n'), text.split('\n')));
      if (fabricated) { rejected += 1; console.warn(`[dm-quick-action] 원문에 없는 숫자 · 혜택 · 효능이 생겨 다듬기를 버림 section_id=${sec?.id}`); }

      if (newProps && refined !== text && appliedText !== text && !fabricated) {
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
  return { changes, rejected };
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
  let charge: PendingCharge | null = null;
  switch (action) {
    case 'ai_refine':
      ({ result, charge } = await refineAllCopy(companyId, campaignId));
      break;
    case 'design_align':
      result = await alignDesign(campaignId);
      break;
    case 'variable_consistency':
      result = await ensureVariableConsistency(campaignId);
      break;
    default:
      throw new UserFacingError(400, 'QUICK_ACTION_INVALID', '고를 수 없는 빠른 수정이에요. 화면을 새로 고쳐 주세요.');
  }

  if (result.changes.length === 0) return result;

  // DB 반영 — ★ 2026-09-26 한줄로 V2 R1-26 읽은 곳에 쓴다(pages 구조면 pages 안 섹션 · 옛 DM이면 sections 칸 · CT mapDmSections).
  // ★ 2026-10-25 원장 #68 — 일반 저장(PUT /:id)과 같은 길: 발행 중 DM 이면 같은 정적 관문을 저장될 모습으로 보고(막히면 반영 0 · 409) ·
  //   저장은 같은 저장 함수(updateDm · 저장 판이 함께 바뀐다). 옛: 관문 · 저장 판을 건너뛰고 라이브 DM 을 바로 덮었다.
  const cur = await getDmDetail(campaignId, companyId);
  if (!cur) return result;
  const mapped = mapDmSections(cur, (sec: any) => {
    const change = result.changes.find((c) => c.section_id === sec?.id);
    return change ? { ...sec, props: change.after } : sec;
  });
  if (!mapped) return result;
  if (cur.status === 'published') {
    const block = dmPublishStaticBlock({ ...cur, [mapped.column]: mapped.value } as any);
    if (block) throw new UserFacingError(409, block.code || 'DM_PUBLISHED_BLOCK', `보내진 DM 이라 바로 반영하지 않았어요. ${block.error}`);
  }
  // ★ 1026 Codex 2R — 저장 · 되돌리기 = 저장 판 조건(읽은 판이 그대로일 때만 쓴다 · 그 사이 남이 고친 내용을 덮지 않는다)
  let saved: any;
  try {
    saved = await updateDm(campaignId, companyId, { [mapped.column]: mapped.value } as any, { baseVersion: (cur as any).save_version || undefined });
  } catch (err) {
    if (err instanceof DmStaleSaveError) throw new UserFacingError(409, 'DM_CHANGED', '그 사이 DM 이 바뀌었어요. 화면을 새로 고친 뒤 다시 눌러 주세요.');
    throw err;
  }
  if (!saved) return result;   // DM 이 없어졌다 = 반영 0 · 걷지 않는다
  // ★ 1026 Codex 1R — 저장 뒤 걷는다 · 못 걷으면(402 · 503) 저장 전 내용으로 되돌린다(결과 없이 돈 0 · 돈 없이 결과 0)
  //   되돌리기도 이 저장이 만든 판일 때만(그 사이 남이 고쳤으면 덮지 않고 DmStaleSaveError → [CREDIT][ORPHAN] 경보)
  if (charge) {
    const prev = { [mapped.column]: (cur as any)[mapped.column] };
    const savedVersion = saved.save_version || undefined;
    await settleOrUndo({
      settle: { companyId, cost: charge.cost, source: charge.source, idempotencyKey: charge.key },
      undo: async () => { await updateDm(campaignId, companyId, prev as any, { baseVersion: savedVersion }); },
      what: 'DM 다듬기 반영',
    });
  }

  return result;
}
