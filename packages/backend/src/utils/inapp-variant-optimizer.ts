/**
 * ★ CT-80: In-app Message A/B + Bandit Optimizer — D215+ (2026-05-25)
 *
 * 🎯 목적
 *   인앱 메시지 A/B variant 영역 — 옛 CT-31 bandit-optimizer.ts 재사용 wrapper.
 *   - createVariant: 부모 메시지에 A/B/C variant 신설 (parent_message_id + variant_weight)
 *   - listVariantsWithStats: variant + impression/click/CTR 통계
 *   - selectVariantForCustomer: Sticky bucketing + Thompson Sampling 자동 선택
 *   - declareWinnerIfReady: 95% CI 도달 시 winner 자동 적용 (옛 variant paused)
 *   - computeVariantsCI: 95% Credible Interval 표시 (UI)
 *
 * 🔗 옛 CT-31 (utils/bandit-optimizer.ts) 재사용
 *   - sampleBeta + thompsonSamplingChoice + computeBetaCredibleInterval
 *
 * ⛔ 영구 원칙
 *   - Sticky bucketing 의무 (동일 사용자에게 동일 variant 영구 표시 — 사고 차단)
 *   - 초기 3회 미만 = explore (모든 variant 동등 기회)
 *   - winner 자동 적용 = 옛 variant paused (삭제 X — 회사 admin이 통계 확인 가능)
 *   - 회사 격리 (company_id 의무)
 */

import { query } from '../config/database';
import { sampleBeta, computeBetaCredibleInterval } from './bandit-optimizer';
// ★ P1-4/P0-2 (2026-07-12) — 블록 정규화·스킴 무해화는 CT-27 단일 정의 재사용 (인라인 중복 금지)
import { sanitizeContentBlocks, sanitizeButtonsActionUrls, normalizeTheme, normalizeCardStyle, composeFlatFromPosterSlides } from './inapp-message';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface InAppVariantStats {
  messageId: string;
  parentMessageId: string | null;
  title: string;
  body: string;
  variantWeight: number;
  status: string;
  impressions: number;
  clicks: number;
  dismisses: number;
  ctr: number;
  ciLow: number;
  ciHigh: number;
  posteriorMean: number;
}

export interface VariantSelection {
  messageId: string;
  isParent: boolean;
  reason: 'sticky' | 'thompson' | 'explore' | 'single';
}

export interface WinnerDeclaration {
  declared: boolean;
  winnerMessageId: string | null;
  reason: string;
  pausedMessageIds: string[];
}

export interface CreateVariantInput {
  parentMessageId: string;
  title: string;
  body: string;
  template?: string;
  image_url?: string | null;
  buttons?: any[];
  background_color?: string;
  text_color?: string;
  animation?: string;
  variant_weight?: number;
  // ★ P1-4 (2026-07-12) — 명시 전달 시 그 값 우선, 미전달 시 부모 상속 (블록 부모의 variant가 레거시 단색 렌더로 오염되던 문제)
  content_blocks?: any[] | null;
  theme?: string | null;
  accent_color?: string | null;
  card_style?: string | null;
  badge_text?: string | null;
}

/**
 * ★ P1-4 (2026-07-12) — 부모 블록 사본에 variant 문안 반영 (순수 — vitest).
 * 첫 headline 블록 text=title, 첫 body 블록 text=body, 나머지 구조(이미지·CTA·혜택 등) 유지.
 * title/body가 빈 문자열이면 해당 블록 텍스트는 부모 그대로 유지(빈 문안으로 덮지 않음).
 */
export function replaceBlockTexts(parentBlocks: any, title: string, body: string): any[] {
  if (!Array.isArray(parentBlocks)) return [];
  const copy: any[] = JSON.parse(JSON.stringify(parentBlocks));
  let headlineDone = false;
  let bodyDone = false;
  for (const b of copy) {
    if (!b || typeof b !== 'object') continue;
    if (!headlineDone && b.type === 'headline' && String(title || '').trim()) {
      b.text = title;
      headlineDone = true;
    } else if (!bodyDone && b.type === 'body' && String(body || '').trim()) {
      b.text = body;
      bodyDone = true;
    }
  }
  return copy;
}

// ════════════════════════════════════════════════════════════════════
// Variant CRUD
// ════════════════════════════════════════════════════════════════════

/**
 * 부모 메시지에 A/B variant 신설.
 * 부모 메시지의 segment_conditions / trigger_conditions / display_frequency 등은 변경 X — 자동 상속.
 */
export async function createVariant(
  companyId: string,
  createdBy: string,
  input: CreateVariantInput
): Promise<string> {
  if (!companyId || !input.parentMessageId) throw new Error('companyId + parentMessageId 필수');

  const parentR = await query(
    `SELECT id, title, body, template, segment_conditions, trigger_conditions, personalization_vars,
            display_frequency, auto_dismiss_seconds, max_displays_per_user,
            send_start_hour, send_end_hour, allowed_weekdays, locale_variants, is_ad, status,
            content_blocks, theme, accent_color, card_style, badge_text, channel, design, poster_slides
     FROM cdp_inapp_messages
     WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
    [input.parentMessageId, companyId]
  );
  if (parentR.rows.length === 0) throw new Error('부모 메시지를 찾을 수 없습니다.');
  const parent = parentR.rows[0];

  // ★ P1-4 — 블록·테마·형태·뱃지·채널 상속. content_blocks는 부모 블록 사본에 variant 문안(title/body)만 교체
  //   (미상속 시 블록 부모의 variant가 레거시 단색 렌더로 표시돼 A/B가 "디자인 세대 차이" 테스트로 오염).
  //   input 명시 전달 시 그 값 우선. quickActionAIRefine(3안 자동 생성)도 같은 경로라 함께 해소.
  const variantBlocks = input.content_blocks !== undefined
    ? sanitizeContentBlocks(input.content_blocks)
    : replaceBlockTexts(parent.content_blocks, input.title, input.body);
  // ★ 2026-07-21 포스터 캐러셀 상속 — 부모 슬라이드 복사 + slide[0] 문안만 variant 문안으로 교체(블록 replaceBlockTexts 미러).
  //   빠지면 A/B variant가 캐러셀을 잃고 단일 포스터로 노출(Codex HIGH). design(포스터 색·서체)도 함께 상속.
  const variantSlides = Array.isArray(parent.poster_slides) && parent.poster_slides.length > 0
    ? [{ ...parent.poster_slides[0], title: input.title, body: input.body }, ...parent.poster_slides.slice(1)]
    : null;
  // ★ 2026-07-21 캐러셀 variant의 flat(image_url·buttons)은 slide0에서 합성 — 구 SDK가 첫 장을 단일 포스터로 표시(Codex 2R ⑥ 잔여).
  //   직접 /inapp/variant API가 image_url/buttons 생략해도 flat이 slide0과 일치(create/update와 동일 CT 재사용).
  // ★ 2026-07-21 (Codex 3R ⑥) — 캐러셀 variant의 flat은 slide0만 미러: fallback buttons=[]로 둬 slide0 무CTA면 flat도 무CTA.
  //   (명시 input.buttons를 fallback으로 두면 slide0엔 없는 CTA가 flat에만 생겨 구/신 SDK가 어긋남.)
  const variantFlat = variantSlides
    ? composeFlatFromPosterSlides(variantSlides, { title: input.title, body: input.body, imageUrl: input.image_url, buttons: [] })
    : null;

  const r = await query(
    `INSERT INTO cdp_inapp_messages (
       id, company_id, created_by, title, body, template, image_url, buttons,
       background_color, text_color,
       segment_conditions, trigger_conditions, personalization_vars,
       display_frequency, auto_dismiss_seconds, max_displays_per_user,
       send_start_hour, send_end_hour, allowed_weekdays, locale_variants,
       animation, is_ad, status,
       parent_message_id, variant_weight,
       content_blocks, theme, accent_color, card_style, badge_text, channel, design, poster_slides,
       created_at, updated_at
     ) VALUES (
       gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb,
       $8, $9,
       $10::jsonb, $11::jsonb, $12::jsonb,
       $13, $14, $15,
       $16, $17, $18::integer[], $19::jsonb,
       $20, $21, 'active',
       $22::uuid, $23,
       $24::jsonb, $25, $26, $27, $28, $29, $30::jsonb, $31::jsonb,
       NOW(), NOW()
     ) RETURNING id`,
    [
      companyId, createdBy,
      input.title, input.body,
      input.template || parent.template,
      variantFlat ? variantFlat.imageUrl : (input.image_url ?? null),
      JSON.stringify(sanitizeButtonsActionUrls(variantFlat ? variantFlat.buttons : (input.buttons || []))),
      input.background_color || '#4f46e5',
      input.text_color || '#ffffff',
      JSON.stringify(parent.segment_conditions || {}),
      JSON.stringify(parent.trigger_conditions || {}),
      JSON.stringify(parent.personalization_vars || []),
      parent.display_frequency || 'once_per_session',
      parent.auto_dismiss_seconds ?? null,
      parent.max_displays_per_user ?? null,
      parent.send_start_hour ?? null,
      parent.send_end_hour ?? null,
      parent.allowed_weekdays || [0, 1, 2, 3, 4, 5, 6],
      JSON.stringify(parent.locale_variants || {}),
      input.animation || 'fade',
      parent.is_ad || false,
      input.parentMessageId,
      input.variant_weight ?? 100,
      JSON.stringify(variantBlocks),
      input.theme !== undefined && input.theme !== null ? normalizeTheme(input.theme) : (parent.theme || 'auto'),
      input.accent_color !== undefined ? input.accent_color : (parent.accent_color ?? null),
      normalizeCardStyle(input.card_style !== undefined && input.card_style !== null ? input.card_style : parent.card_style),
      input.badge_text !== undefined ? input.badge_text : (parent.badge_text ?? null),
      parent.channel === 'app' ? 'app' : 'web',
      parent.design ? JSON.stringify(parent.design) : null,
      variantSlides ? JSON.stringify(variantSlides) : null,
    ]
  );

  return String(r.rows[0].id);
}

/**
 * 부모 메시지 + variants 목록 + impression/click/CTR/CI 통계.
 */
export async function listVariantsWithStats(
  companyId: string,
  parentMessageId: string
): Promise<InAppVariantStats[]> {
  if (!companyId || !parentMessageId) return [];

  // 부모 + variants 한꺼번에 조회 (parent_message_id IS NULL = 부모, = parentMessageId = variant)
  const r = await query(
    `SELECT m.id, m.parent_message_id, m.title, m.body, m.variant_weight, m.status,
            COUNT(*) FILTER (WHERE i.event_type = 'impression')::int AS impressions,
            COUNT(*) FILTER (WHERE i.event_type = 'click')::int AS clicks,
            COUNT(*) FILTER (WHERE i.event_type = 'dismiss')::int AS dismisses
     FROM cdp_inapp_messages m
     LEFT JOIN cdp_inapp_impressions i ON i.message_id = m.id AND i.company_id = m.company_id
     WHERE m.company_id = $1::uuid
       AND (m.id = $2::uuid OR m.parent_message_id = $2::uuid)
     GROUP BY m.id, m.parent_message_id, m.title, m.body, m.variant_weight, m.status, m.created_at
     ORDER BY m.parent_message_id NULLS FIRST, m.created_at ASC`,
    [companyId, parentMessageId]
  );

  return r.rows.map((row: any) => {
    const impressions = Number(row.impressions || 0);
    const clicks = Number(row.clicks || 0);
    const dismisses = Number(row.dismisses || 0);
    const alpha = 1 + clicks;
    const beta = 1 + Math.max(impressions - clicks, 0);
    const ci = computeBetaCredibleInterval(alpha, beta);
    return {
      messageId: String(row.id),
      parentMessageId: row.parent_message_id ? String(row.parent_message_id) : null,
      title: row.title,
      body: row.body,
      variantWeight: Number(row.variant_weight || 100),
      status: row.status,
      impressions,
      clicks,
      dismisses,
      ctr: impressions > 0 ? clicks / impressions : 0,
      ciLow: ci.lower95,
      ciHigh: ci.upper95,
      posteriorMean: alpha / (alpha + beta),
    };
  });
}

// ════════════════════════════════════════════════════════════════════
// Sticky Bucketing + Thompson Sampling
// ════════════════════════════════════════════════════════════════════

/**
 * 동일 사용자에게 직전 표시했던 variant 다시 응답 (sticky).
 * 직전 표시 X = null 응답 (Thompson Sampling 진입).
 */
async function findStickyVariant(
  companyId: string,
  parentMessageId: string,
  customerId: string | null,
  anonymousId: string | null
): Promise<string | null> {
  if (!customerId && !anonymousId) return null;

  const sql = customerId
    ? `SELECT i.message_id
       FROM cdp_inapp_impressions i
       JOIN cdp_inapp_messages m ON m.id = i.message_id
       WHERE i.company_id = $1::uuid AND i.customer_id = $2::uuid
         AND (m.id = $3::uuid OR m.parent_message_id = $3::uuid)
         AND m.status = 'active'
       ORDER BY i.occurred_at DESC LIMIT 1`
    : `SELECT i.message_id
       FROM cdp_inapp_impressions i
       JOIN cdp_inapp_messages m ON m.id = i.message_id
       WHERE i.company_id = $1::uuid AND i.anonymous_id = $2
         AND (m.id = $3::uuid OR m.parent_message_id = $3::uuid)
         AND m.status = 'active'
       ORDER BY i.occurred_at DESC LIMIT 1`;

  const r = await query(sql, [companyId, customerId || anonymousId, parentMessageId]);
  return r.rows.length > 0 ? String(r.rows[0].message_id) : null;
}

/**
 * 인앱 메시지 + variants 중 customer에게 표시할 variant 선택.
 * 흐름: Sticky bucketing 우선 → 초기 explore (3회 미만) → Thompson Sampling
 */
export async function selectVariantForCustomer(
  companyId: string,
  parentMessageId: string,
  customerId: string | null,
  anonymousId: string | null
): Promise<VariantSelection | null> {
  if (!companyId || !parentMessageId) return null;

  // Step 1: Sticky bucketing
  const stickyId = await findStickyVariant(companyId, parentMessageId, customerId, anonymousId);
  if (stickyId) {
    return {
      messageId: stickyId,
      isParent: stickyId === parentMessageId,
      reason: 'sticky',
    };
  }

  // Step 2: 활성 variants 통계 조회
  const stats = await listVariantsWithStats(companyId, parentMessageId);
  const activeStats = stats.filter((s) => s.status === 'active');
  if (activeStats.length === 0) return null;
  if (activeStats.length === 1) {
    return {
      messageId: activeStats[0].messageId,
      isParent: activeStats[0].parentMessageId === null,
      reason: 'single',
    };
  }

  // Step 3: 초기 explore — 각 variant 누적 impression 3 미만 = explore
  const totalImpressions = activeStats.reduce((sum, s) => sum + s.impressions, 0);
  if (totalImpressions < activeStats.length * 3) {
    // 가중치 + 누적 impression 역수로 explore — 적게 본 variant 우선
    const minImp = Math.min(...activeStats.map((s) => s.impressions));
    const candidates = activeStats.filter((s) => s.impressions === minImp);
    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    return {
      messageId: selected.messageId,
      isParent: selected.parentMessageId === null,
      reason: 'explore',
    };
  }

  // Step 4: Thompson Sampling — 각 variant Beta(α, β) sample → 최대값 선택
  let bestIdx = 0;
  let bestSample = -Infinity;
  activeStats.forEach((s, idx) => {
    const alpha = 1 + s.clicks;
    const beta = 1 + Math.max(s.impressions - s.clicks, 0);
    const sample = sampleBeta(alpha, beta);
    // variant_weight 가중치 반영
    const weightedSample = sample * (s.variantWeight / 100);
    if (weightedSample > bestSample) {
      bestSample = weightedSample;
      bestIdx = idx;
    }
  });

  const winner = activeStats[bestIdx];
  return {
    messageId: winner.messageId,
    isParent: winner.parentMessageId === null,
    reason: 'thompson',
  };
}

// ════════════════════════════════════════════════════════════════════
// Winner 자동 선언
// ════════════════════════════════════════════════════════════════════

/**
 * 95% CI 도달 시 winner 자동 적용 (옛 variant paused).
 * 조건: 각 variant impression 30+ AND 최고 CI low > 다른 모든 variant CI high.
 */
export async function declareWinnerIfReady(
  companyId: string,
  parentMessageId: string
): Promise<WinnerDeclaration> {
  if (!companyId || !parentMessageId) {
    return { declared: false, winnerMessageId: null, reason: 'invalid_input', pausedMessageIds: [] };
  }

  const stats = await listVariantsWithStats(companyId, parentMessageId);
  const activeStats = stats.filter((s) => s.status === 'active');

  if (activeStats.length < 2) {
    return { declared: false, winnerMessageId: null, reason: 'variant_불충분', pausedMessageIds: [] };
  }

  // 최소 impression 30
  const minImpressions = Math.min(...activeStats.map((s) => s.impressions));
  if (minImpressions < 30) {
    return { declared: false, winnerMessageId: null, reason: `최소 impression 30 필요 (현재 ${minImpressions})`, pausedMessageIds: [] };
  }

  // 최고 CI low > 다른 모든 variant CI high
  const sorted = [...activeStats].sort((a, b) => b.ciLow - a.ciLow);
  const top = sorted[0];
  const others = sorted.slice(1);
  const topDominates = others.every((s) => top.ciLow > s.ciHigh);
  if (!topDominates) {
    return { declared: false, winnerMessageId: null, reason: '95% CI 미도달 (variants 신뢰 구간 겹침)', pausedMessageIds: [] };
  }

  // Winner 적용 — 옛 variant paused
  const losersIds = others.map((s) => s.messageId);
  if (losersIds.length > 0) {
    await query(
      `UPDATE cdp_inapp_messages SET status = 'paused', updated_at = NOW()
       WHERE company_id = $1::uuid AND id = ANY($2::uuid[])`,
      [companyId, losersIds]
    );
  }

  return {
    declared: true,
    winnerMessageId: top.messageId,
    reason: `Winner 자동 적용 — CTR ${(top.ctr * 100).toFixed(1)}% (CI ${(top.ciLow * 100).toFixed(1)}~${(top.ciHigh * 100).toFixed(1)}%)`,
    pausedMessageIds: losersIds,
  };
}

/**
 * variant 통계 + CI 표시용 (UI 안 자세히 분석 카드).
 */
export async function computeVariantStatsForUI(
  companyId: string,
  parentMessageId: string
): Promise<InAppVariantStats[]> {
  return listVariantsWithStats(companyId, parentMessageId);
}
