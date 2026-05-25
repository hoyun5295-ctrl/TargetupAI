/**
 * ★ CT-84: In-app Message Quick Action — D215+ (2026-05-25)
 *
 * 🎯 목적
 *   회사 admin 1-click 액션 — Explainer (CT-81) 추천 → 즉시 적용.
 *   - quickActionAIRefine: AI 본문 다듬기 (감성/실용/캐주얼 3안 → A/B variant 자동 신설)
 *   - quickActionTimeOptimize: 시간대 최적화 (CT-83 hourly best CTR 자동 적용)
 *   - quickActionSegmentRefine: 세그먼트 정밀화 (LTV 상위 자동 한정)
 *
 * 🔗 의존
 *   - CT-77 inapp-ai-generator (변수 정합)
 *   - CT-80 inapp-variant-optimizer (variant 자동 신설)
 *   - CT-83 inapp-funnel-stats (시간대 best 분석)
 *
 * ⛔ 영구 원칙
 *   - AI 임의 혜택 X — 본문 다듬기 시 옛 placeholder 보존 의무
 *   - 모델명 사용자 노출 X
 *   - 회사 격리 (company_id 의무)
 *   - 회사 admin 사전 명시 후 적용 (1-click = "추천" 카드 → 회사 admin이 적용 button 누름)
 */

import { callAIWithFallback } from '../services/ai';
import { query } from '../config/database';
import { createVariant } from './inapp-variant-optimizer';
import { buildHourlyDistribution } from './inapp-funnel-stats';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface QuickActionResult {
  actionType: 'ai_refine' | 'time_optimize' | 'segment_refine';
  applied: boolean;
  appliedDetails: string;
  beforeAfter: {
    before: any;
    after: any;
  };
  createdVariantIds?: string[];
}

interface RefineVariant {
  tone: '감성적' | '실용적' | '캐주얼';
  title: string;
  body: string;
}

// ════════════════════════════════════════════════════════════════════
// 1. AI 다듬기 — 감성/실용/캐주얼 3안 자동 생성 → A/B variant 신설
// ════════════════════════════════════════════════════════════════════

export async function quickActionAIRefine(
  companyId: string,
  messageId: string,
  createdBy: string
): Promise<QuickActionResult> {
  if (!companyId || !messageId) throw new Error('companyId + messageId 필수');

  // 부모 메시지 조회
  const msgR = await query(
    `SELECT id, title, body, template, image_url, buttons, background_color, text_color, is_ad
     FROM cdp_inapp_messages
     WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
    [messageId, companyId]
  );
  if (msgR.rows.length === 0) throw new Error('메시지를 찾을 수 없습니다.');
  const parent = msgR.rows[0];

  // AI 호출 — 3 tone 자동 생성
  const system = `당신은 한국 마케팅 자동화 인앱 메시지 카피라이터입니다.
회사 admin이 본 메시지 본문을 A/B 테스트하고자 합니다.
원본 메시지의 의도/구조/혜택 placeholder는 보존하고, 톤만 다르게 3안을 생성합니다.

[원본]
- 제목: ${parent.title}
- 본문: ${parent.body}

[3 tone 매핑]
1. 감성적: 시즌 감성 + 진심 어린 표현 + 정중함
2. 실용적: 명확한 가치 제안 + 사실 기반 + 간결
3. 캐주얼: 친근한 대화체 + 가벼운 톤 (단, 격조 X — "단골" / "초특가" 단어 사용 절대 금지)

[★ 영구 룰 — 절대 위반 X ★]
- 구체 혜택 (% / 원 / 무료 / 쿠폰 / 사은품) 임의 작성 X — \`[혜택 안내 — 직접 작성해주세요]\` placeholder 그대로 보존
- 원본 안 변수 ({{ customer.name }}, %고객명% 등) 그대로 보존
- 원본 안 URL placeholder ([URL — 회사 admin 수정]) 그대로 보존
- 제목 20자 안 / 본문 200~400자

[응답 JSON]

\`\`\`json
{
  "variants": [
    { "tone": "감성적", "title": "...", "body": "..." },
    { "tone": "실용적", "title": "...", "body": "..." },
    { "tone": "캐주얼", "title": "...", "body": "..." }
  ]
}
\`\`\`

응답은 반드시 위 JSON 객체만.`;

  const userMessage = `위 원본 메시지를 3 tone (감성적/실용적/캐주얼)으로 다듬어주세요.
영구 룰 준수 의무: placeholder + 변수 + URL placeholder 그대로 보존.`;

  const aiResult = await callAIWithFallback({
    system,
    userMessage,
    model: 'opus',
    maxTokens: 2048,
    temperature: 0.8,
  });

  const jsonText = extractJSON(aiResult || '');
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e: any) {
    throw new Error(`AI 응답 JSON 파싱 실패: ${e.message}`);
  }

  const variants: RefineVariant[] = Array.isArray(parsed.variants)
    ? parsed.variants.slice(0, 3).map((v: any) => ({
        tone: ['감성적', '실용적', '캐주얼'].includes(v.tone) ? v.tone : '실용적',
        title: String(v.title || '').slice(0, 100),
        body: String(v.body || ''),
      }))
    : [];

  if (variants.length === 0) throw new Error('AI variant 생성 실패 — 응답 안 variants 0건');

  // variant 자동 신설 (CT-80 createVariant 호출) — 가중치 동등 100/100/100
  const createdIds: string[] = [];
  for (const v of variants) {
    try {
      const id = await createVariant(companyId, createdBy, {
        parentMessageId: messageId,
        title: v.title,
        body: v.body,
        template: parent.template,
        image_url: parent.image_url,
        buttons: Array.isArray(parent.buttons) ? parent.buttons : [],
        background_color: parent.background_color,
        text_color: parent.text_color,
        animation: 'fade',
        variant_weight: 100,
      });
      createdIds.push(id);
    } catch (e: any) {
      console.warn(`[CT-84 quickActionAIRefine] variant 신설 실패 (tone=${v.tone}):`, e?.message);
    }
  }

  return {
    actionType: 'ai_refine',
    applied: createdIds.length > 0,
    appliedDetails: `A/B variant ${createdIds.length}건 자동 신설 — 감성/실용/캐주얼 톤 자동 생성. 발송 시점 Sticky bucketing + Thompson Sampling으로 winner 자동 선택`,
    beforeAfter: {
      before: { variantCount: 0 },
      after: { variantCount: createdIds.length, tones: variants.map((v) => v.tone) },
    },
    createdVariantIds: createdIds,
  };
}

// ════════════════════════════════════════════════════════════════════
// 2. 시간대 최적화 — best hour 자동 적용
// ════════════════════════════════════════════════════════════════════

export async function quickActionTimeOptimize(
  companyId: string,
  messageId: string
): Promise<QuickActionResult> {
  if (!companyId || !messageId) throw new Error('companyId + messageId 필수');

  // 옛 send_start/end_hour 조회
  const msgR = await query(
    `SELECT send_start_hour, send_end_hour FROM cdp_inapp_messages
     WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
    [messageId, companyId]
  );
  if (msgR.rows.length === 0) throw new Error('메시지를 찾을 수 없습니다.');
  const beforeStart = msgR.rows[0].send_start_hour;
  const beforeEnd = msgR.rows[0].send_end_hour;

  // 시간대별 분포 (CT-83)
  const hourly = await buildHourlyDistribution(companyId, messageId);
  const totalImp = hourly.reduce((s, h) => s + h.impressions, 0);
  if (totalImp < 50) {
    return {
      actionType: 'time_optimize',
      applied: false,
      appliedDetails: `데이터 누적 부족 (impression ${totalImp}건 < 50건) — 시간대 최적화 진행 X. 충분한 데이터 후 재시도 권장`,
      beforeAfter: {
        before: { send_start_hour: beforeStart, send_end_hour: beforeEnd },
        after: { send_start_hour: beforeStart, send_end_hour: beforeEnd },
      },
    };
  }

  // 상위 8 시간대 (CTR DESC) — 연속 윈도우 도출
  const sortedHours = [...hourly]
    .filter((h) => h.impressions >= 5)
    .sort((a, b) => b.ctr - a.ctr)
    .slice(0, 8);

  if (sortedHours.length === 0) {
    return {
      actionType: 'time_optimize',
      applied: false,
      appliedDetails: '유효한 시간대 통계 없음 — 시간대 최적화 진행 X',
      beforeAfter: {
        before: { send_start_hour: beforeStart, send_end_hour: beforeEnd },
        after: { send_start_hour: beforeStart, send_end_hour: beforeEnd },
      },
    };
  }

  // 상위 hours 중 min/max — 새벽 (0~7) 자동 제외 (안전)
  const validHours = sortedHours.map((h) => h.hour).filter((h) => h >= 7 && h <= 22);
  if (validHours.length === 0) {
    return {
      actionType: 'time_optimize',
      applied: false,
      appliedDetails: '새벽 시간대만 CTR 높음 — 안전상 적용 X (7~22시 표준 유지 권장)',
      beforeAfter: {
        before: { send_start_hour: beforeStart, send_end_hour: beforeEnd },
        after: { send_start_hour: beforeStart, send_end_hour: beforeEnd },
      },
    };
  }

  const newStart = Math.min(...validHours);
  const newEnd = Math.max(...validHours);

  await query(
    `UPDATE cdp_inapp_messages
     SET send_start_hour = $1::integer, send_end_hour = $2::integer, updated_at = NOW()
     WHERE id = $3::uuid AND company_id = $4::uuid`,
    [newStart, newEnd, messageId, companyId]
  );

  return {
    actionType: 'time_optimize',
    applied: true,
    appliedDetails: `시간대 ${newStart}~${newEnd}시 적용 — 상위 CTR 시간대 자동 도출 (${validHours.length}개 시간대 분석)`,
    beforeAfter: {
      before: { send_start_hour: beforeStart, send_end_hour: beforeEnd },
      after: { send_start_hour: newStart, send_end_hour: newEnd },
    },
  };
}

// ════════════════════════════════════════════════════════════════════
// 3. 세그먼트 정밀화 — LTV 상위 / 활성 사용자 자동 한정
// ════════════════════════════════════════════════════════════════════

export async function quickActionSegmentRefine(
  companyId: string,
  messageId: string
): Promise<QuickActionResult> {
  if (!companyId || !messageId) throw new Error('companyId + messageId 필수');

  // 옛 segment_conditions 조회
  const msgR = await query(
    `SELECT segment_conditions FROM cdp_inapp_messages
     WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
    [messageId, companyId]
  );
  if (msgR.rows.length === 0) throw new Error('메시지를 찾을 수 없습니다.');
  const beforeSegment = msgR.rows[0].segment_conditions || {};

  // 회사 LTV 분포 — 상위 30% 임계값 도출
  const ltvR = await query(
    `SELECT percentile_cont(0.7) WITHIN GROUP (ORDER BY total_purchase_amount) AS p70
     FROM customers
     WHERE company_id = $1::uuid AND is_active = true AND total_purchase_amount IS NOT NULL`,
    [companyId]
  );
  const p70LTV = Math.floor(Number(ltvR.rows[0]?.p70 || 0));

  if (p70LTV <= 0) {
    return {
      actionType: 'segment_refine',
      applied: false,
      appliedDetails: '회사 LTV 데이터 부족 — 세그먼트 정밀화 진행 X. CDP 동기화 후 재시도 권장',
      beforeAfter: { before: beforeSegment, after: beforeSegment },
    };
  }

  // 활성 사용자 임계값 (30일 안)
  const newSegment = {
    ...beforeSegment,
    customer: {
      ...(beforeSegment.customer || {}),
      ltv_min: p70LTV,
      last_activity_days_ago_max: 30,
    },
  };

  await query(
    `UPDATE cdp_inapp_messages
     SET segment_conditions = $1::jsonb, updated_at = NOW()
     WHERE id = $2::uuid AND company_id = $3::uuid`,
    [JSON.stringify(newSegment), messageId, companyId]
  );

  return {
    actionType: 'segment_refine',
    applied: true,
    appliedDetails: `세그먼트 정밀화 적용 — LTV ${p70LTV.toLocaleString()}원 이상 (상위 30%) + 30일 안 활성 사용자 한정`,
    beforeAfter: {
      before: beforeSegment,
      after: newSegment,
    },
  };
}

// ════════════════════════════════════════════════════════════════════
// 헬퍼
// ════════════════════════════════════════════════════════════════════

function extractJSON(text: string): string {
  if (text.includes('```json')) {
    const start = text.indexOf('```json') + 7;
    const end = text.indexOf('```', start);
    return text.slice(start, end).trim();
  }
  if (text.includes('```')) {
    const start = text.indexOf('```') + 3;
    const end = text.indexOf('```', start);
    return text.slice(start, end).trim();
  }
  return text.trim();
}
