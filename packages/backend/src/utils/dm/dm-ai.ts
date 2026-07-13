/**
 * dm-ai.ts — DM 빌더 AI 엔진 4모듈 (D125 프로모델)
 *
 *  1. parsePrompt       — 자연어 한 줄 → 구조화된 CampaignSpec
 *  2. recommendLayout   — CampaignSpec → Section[] (섹션 구성 + 스타일 변형)
 *  3. generateCopy      — Section + spec → 섹션별 카피 3안
 *  4. transformTone     — 기존 문안 → 지정 톤으로 변환
 *  (보너스) improveMessage — 전체 섹션 문안 AI 개선 제안
 *
 * 기존 services/ai.ts 의 callAIWithFallback (Claude → GPT 폴백) 재활용.
 *
 * 설계서: status/DM-PRO-DESIGN.md §9
 */
import { callAIWithFallback } from '../../services/ai';
// ★ 2026-07-03 DM 문안두뇌 주입 (전 채널 학습 통합 Phase 1c) — 회사 성과 DM 문안 RAG + 브랜드 키트
import { composeCopyBrain } from '../copy-prompt-composer';
// ★ 2026-07-08 행사 원문 상품 구조 추출 — 원문 실존 검증(환각 가격 차단) 공용 CT
import { validateProductsAgainstEventText, type ExtractedEventProduct } from '../event-brief';
// ★ 2026-07-13 — 상품 URL 페이지의 og:image 자동 채움 (브랜드 추출기 CT 재사용)
import { fetchProductOgImages } from './dm-brand-extractor';
import {
  SECTION_META, SECTION_DEFAULTS, type Section, type SectionType,
  createSection,
} from './dm-section-registry';
import type { DmBrandKit } from './dm-tokens';
import { decideLayoutMode, splitSectionsIntoPages, type DmLayoutMode } from './dm-page-split';
import { normalizeVisualConcept, applyVisualDirection, type VisualConcept } from './dm-visual-direction';
import { normalizeSectionChain } from './dm-section-layout';

// ────────────── 타입 ──────────────

export type CampaignObjective = 'awareness' | 'sale' | 'retention' | 'reactivation' | 'loyalty';
export type CampaignTone = 'premium' | 'friendly' | 'urgent' | 'elegant' | 'playful';
export type CampaignIndustry = 'beauty' | 'fashion' | 'food' | 'tech' | 'luxury' | 'general';

export type CampaignSpec = {
  brand: { name: string; tone?: CampaignTone };
  objective: CampaignObjective;
  target: {
    age_range?: [number, number];
    gender?: 'F' | 'M' | 'all';
    region?: string;
    segment?: string;
  };
  benefit?: {
    type: 'discount' | 'coupon' | 'free_gift' | 'point' | 'limited_time';
    value?: string;
  };
  urgency?: {
    end_datetime?: string;
    label?: string;
  };
  personalization?: string[];
  tone: CampaignTone;
  industry?: CampaignIndustry;
  recommended_sections?: SectionType[];
};

export type CopyDraft = {
  headlines?: Array<{ style: 'direct' | 'emotional' | 'urgent'; text: string }>;
  subCopies?: string[];
  ctaLabels?: string[];
  body?: string;
};

export type ToneKey = 'direct' | 'emotional' | 'premium' | 'urgent' | 'friendly' | 'sales';
export const TONE_LABELS: Record<ToneKey, string> = {
  direct: '직관형',
  emotional: '감성형',
  premium: '고급형',
  urgent: '긴박형',
  friendly: '친절형',
  sales: '세일즈형',
};

// ────────────── 유틸: JSON 추출 ──────────────

/** AI 응답에서 첫 번째 JSON 블록을 안전하게 파싱 (D216+ — CT-86~90 공용 export) */
export function extractJson<T = unknown>(raw: string): T {
  if (!raw) throw new Error('빈 응답');
  let s = raw.trim();
  // 마크다운 코드블록 제거
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  // JSON 블록만 추출 (첫 { ~ 마지막 })
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first < 0 || last < first) throw new Error('JSON 형식이 아닙니다: ' + s.slice(0, 120));
  const jsonStr = s.slice(first, last + 1);
  try {
    return JSON.parse(jsonStr) as T;
  } catch (e: any) {
    throw new Error(`JSON 파싱 실패: ${e.message} — raw: ${jsonStr.slice(0, 200)}`);
  }
}

function extractJsonArray<T = unknown>(raw: string): T[] {
  if (!raw) return [];
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const first = s.indexOf('[');
  const last = s.lastIndexOf(']');
  if (first < 0 || last < first) throw new Error('JSON 배열 형식이 아닙니다');
  const jsonStr = s.slice(first, last + 1);
  return JSON.parse(jsonStr) as T[];
}

// ────────────── 1. Prompt Parser ──────────────

const PROMPT_PARSER_SYSTEM = `당신은 리테일·이커머스 마케팅 캠페인을 구조화하는 어시스턴트입니다.
사용자의 자연어 입력을 JSON 스펙으로 변환합니다.

반드시 아래 스키마로만 출력합니다 (코드블록/설명 금지):
{
  "brand": { "name": "...", "tone": "premium|friendly|urgent|elegant|playful" },
  "objective": "awareness|sale|retention|reactivation|loyalty",
  "target": {
    "age_range": [20, 30] | null,
    "gender": "F|M|all",
    "region": "서울|..." | null,
    "segment": "VIP|휴면|..." | null
  },
  "benefit": {
    "type": "discount|coupon|free_gift|point|limited_time",
    "value": "20%|5만원|..."
  } | null,
  "urgency": {
    "end_datetime": "ISO-8601 형식" | null,
    "label": "오늘 자정 마감|..." | null
  } | null,
  "personalization": ["고객명","최근구매매장","보유포인트"] | [],
  "tone": "premium|friendly|urgent|elegant|playful",
  "industry": "beauty|fashion|food|tech|luxury|general"
}

규칙:
- "오늘 자정" 같은 상대 표현은 현재 시각(UTC+9 한국) 기준으로 ISO-8601 문자열로 변환합니다.
- 브랜드명이 명시되지 않으면 name을 빈 문자열 ""로 둡니다.
- 추측하지 말 것. 정보가 없으면 해당 필드는 null 또는 기본값.
- JSON 외 다른 텍스트 절대 출력하지 마세요.`;

export async function parsePrompt(rawPrompt: string, companyId?: string): Promise<CampaignSpec> {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().replace('Z', '+09:00');
  const userMessage = `현재 한국 시각: ${kst}

입력:
${rawPrompt}

위 입력을 JSON으로 변환하세요.`;

  const text = await callAIWithFallback({
    system: PROMPT_PARSER_SYSTEM,
    userMessage,
    maxTokens: 1200,
    temperature: 0.2,
    model: 'opus',
    companyId,
    source: 'dm-parse', // ★ D227+ 종량제: 집계용(맵 미등록=0). dm-builder 묶음 안에선 자동 0
  });

  const parsed = extractJson<Partial<CampaignSpec>>(text);

  // Normalize + defaults
  const spec: CampaignSpec = {
    brand: { name: parsed.brand?.name || '', tone: parsed.brand?.tone as CampaignTone | undefined },
    objective: (parsed.objective as CampaignObjective) || 'sale',
    target: parsed.target || {},
    benefit: parsed.benefit || undefined,
    urgency: parsed.urgency || undefined,
    personalization: parsed.personalization || [],
    tone: (parsed.tone as CampaignTone) || parsed.brand?.tone || 'friendly',
    industry: (parsed.industry as CampaignIndustry) || 'general',
  };
  return spec;
}

// ────────────── 2. Layout Recommender ──────────────

/** objective별 기본 섹션 구성 (규칙 기반) */
const OBJECTIVE_TEMPLATES: Record<CampaignObjective, SectionType[]> = {
  sale:         ['header', 'hero', 'coupon', 'countdown', 'cta', 'store_info', 'footer'],
  awareness:    ['header', 'hero', 'video', 'text_card', 'cta', 'footer'],
  retention:    ['header', 'text_card', 'cta', 'sns', 'footer'],
  reactivation: ['header', 'hero', 'coupon', 'text_card', 'cta', 'footer'],
  loyalty:      ['header', 'hero', 'promo_code', 'text_card', 'cta', 'footer'],
};

/** industry → style_variant 추천 */
const INDUSTRY_VARIANT: Record<CampaignIndustry, string> = {
  beauty:  'beauty-elegant',
  fashion: 'fashion-editorial',
  food:    'food-warm',
  tech:    'default',
  luxury:  'luxury',
  general: 'default',
};

export function recommendLayout(spec: CampaignSpec): Section[] {
  const types = (spec.recommended_sections && spec.recommended_sections.length > 0)
    ? spec.recommended_sections
    : OBJECTIVE_TEMPLATES[spec.objective] || OBJECTIVE_TEMPLATES.sale;

  const variant = INDUSTRY_VARIANT[spec.industry || 'general'];

  const sections: Section[] = types.map((type, idx) => {
    const base = createSection(type, cryptoId(), idx);

    // objective별 기본값 초기 주입
    switch (type) {
      case 'header':
        (base.props as any).variant = 'logo';
        if (spec.brand.name) (base.props as any).brand_name = spec.brand.name;
        break;
      case 'hero':
        if (spec.benefit?.value) (base.props as any).headline = `${spec.benefit.value} 특별 혜택`;
        break;
      case 'coupon':
        if (spec.benefit?.type === 'discount' || spec.benefit?.type === 'coupon') {
          (base.props as any).discount_label = spec.benefit.value || '';
          (base.props as any).discount_type = 'percent';
        }
        if (spec.urgency?.end_datetime) (base.props as any).expire_date = spec.urgency.end_datetime;
        break;
      case 'countdown':
        if (spec.urgency?.end_datetime) (base.props as any).end_datetime = spec.urgency.end_datetime;
        if (spec.urgency?.label) (base.props as any).urgency_text = spec.urgency.label;
        break;
      case 'cta':
        (base.props as any).buttons = [{ label: '자세히 보기', url: '', style: 'primary' }];
        break;
      case 'footer':
        (base.props as any).show_unsubscribe_link = true;
        break;
    }

    // 스타일 변형 적용 (해당 섹션이 지원하는 경우만)
    if (SECTION_META[type].supportsStyleVariants.includes(variant)) {
      base.style_variant = variant;
    }
    return base;
  });

  return sections;
}

// ────────────── 3. Copy Generator ──────────────

const COPY_GEN_SYSTEM = `당신은 리테일 브랜드 모바일 DM 카피라이터입니다.
브랜드/타겟/혜택/긴급성/톤을 고려해 섹션별 카피를 생성합니다.

제약:
- 한국어만 사용
- 이모지 사용 금지 — 발행물의 절제된 톤을 깨뜨린다. 장식이 필요하면 문장과 단어 선택으로 표현 (2026-07-02 디자인 v2 카피 규율)
- 느낌표 최대 1개
- (광고)·무료수신거부·080 번호 같은 발송 표기를 카피에 절대 넣지 않는다 — 발송 시스템이 설정값으로 별도 합성
- 브랜드명을 카피 본문에 직접 삽입하지 않음 (브랜드 영역은 별도)
- 과장 표현("반드시 성공", "무조건") 금지
- 개인화 변수는 %고객명% 같은 형태 유지
- 구체 혜택 수치(20%, 5만원, 1+1, 무료배송, 쿠폰 금액, 사은품, 당첨 인원, 남은 수량 등) 절대 생성 금지 — 회사가 직접 채울 자리이므로 비워 둔다
- 모르는 사실(상품명·가격·일정·수량)을 지어내지 않는다 — 구조와 분위기만 카피로 표현
- JSON 외 다른 텍스트 출력 금지`;

export async function generateCopy(spec: CampaignSpec, section: Section, companyId?: string): Promise<CopyDraft> {
  const specSummary = JSON.stringify({
    brand: spec.brand.name,
    objective: spec.objective,
    target: spec.target,
    benefit: spec.benefit,
    urgency: spec.urgency?.label,
    tone: spec.tone,
    industry: spec.industry,
    personalization: spec.personalization,
  });

  let sectionHint = '';
  let schema = '';

  switch (section.type) {
    case 'hero':
      sectionHint = '히어로 섹션의 메인 헤드라인 3안 + 서브카피 1개를 생성';
      schema = `{
  "headlines": [
    { "style": "direct", "text": "18자 이내" },
    { "style": "emotional", "text": "18자 이내" },
    { "style": "urgent", "text": "18자 이내" }
  ],
  "subCopies": ["30자 이내"]
}`;
      break;
    case 'text_card':
      sectionHint = '텍스트 카드의 헤드라인 + 본문(2~3문장)을 생성';
      schema = `{
  "headlines": [{ "style": "direct", "text": "15자 이내" }],
  "body": "본문 2~3문장"
}`;
      break;
    case 'cta':
      sectionHint = 'CTA 버튼 라벨 3안을 생성';
      schema = `{ "ctaLabels": ["10자 이내", "10자 이내", "10자 이내"] }`;
      break;
    case 'coupon':
      sectionHint = '쿠폰 강조 문구(discount_label)와 사용 조건 1줄';
      schema = `{
  "headlines": [{ "style": "direct", "text": "15자 이내" }],
  "body": "사용 조건 1줄"
}`;
      break;
    case 'countdown':
      sectionHint = '카운트다운 상단 긴급 문구 3안';
      schema = `{ "headlines": [
  { "style": "urgent", "text": "10자 이내" },
  { "style": "direct", "text": "10자 이내" },
  { "style": "emotional", "text": "10자 이내" }
] }`;
      break;
    case 'promo_code':
      sectionHint = '프로모션 코드 상단 설명 + 사용법 1줄';
      schema = `{
  "headlines": [{ "style": "direct", "text": "15자 이내" }],
  "body": "사용법 1줄"
}`;
      break;
    case 'footer':
      sectionHint = '유의사항 2~3줄 (법정 안내 톤)';
      schema = `{ "body": "유의사항 2~3줄 (줄바꿈 \\n)" }`;
      break;
    // D216+ 신규 인터랙션·시각 섹션 — 제목/질문/안내 골격만 생성, 구체 혜택·숫자는 비워 둔다
    case 'product_carousel':
    case 'gallery':
    case 'reviews':
    case 'survey':
      sectionHint = `${SECTION_META[section.type].label} 섹션의 제목 1개 (상품명·가격·할인·수량 등 구체 숫자 절대 포함 금지)`;
      schema = `{ "headlines": [{ "style": "direct", "text": "14자 이내" }] }`;
      break;
    case 'poll':
      sectionHint = '투표 질문 1개 (찬반/선호를 묻는 중립적 질문, 혜택 약속 금지)';
      schema = `{ "headlines": [{ "style": "direct", "text": "질문 24자 이내" }] }`;
      break;
    case 'lucky_draw':
      sectionHint = '추첨 이벤트 제목 + 참여 안내 1줄 (경품명·당첨 인원·혜택 숫자 절대 생성 금지)';
      schema = `{ "headlines": [{ "style": "emotional", "text": "14자 이내" }], "body": "참여 안내 1줄" }`;
      break;
    case 'email_capture':
      sectionHint = '이메일 수집 헤드라인 + 안내 1줄 (할인율·쿠폰·금액 등 구체 혜택 절대 생성 금지)';
      schema = `{ "headlines": [{ "style": "direct", "text": "16자 이내" }], "body": "안내 1줄" }`;
      break;
    case 'limited_quantity':
      sectionHint = '선착순 한정 섹션 제목 1개 (남은 수량·할인 숫자 절대 포함 금지)';
      schema = `{ "headlines": [{ "style": "urgent", "text": "14자 이내" }] }`;
      break;
    case 'instant_coupon':
      sectionHint = '즉시 쿠폰 섹션의 짧은 라벨 1개 (할인율·금액 등 구체 혜택 숫자 절대 생성 금지)';
      schema = `{ "headlines": [{ "style": "direct", "text": "12자 이내" }] }`;
      break;
    case 'header':
      return {}; // 헤더는 브랜드명/로고 위주라 AI 생성 제외
    default:
      return {}; // video/store_info/sns/slideshow 등은 AI 생성 대상 아님
  }

  const userMessage = `캠페인 스펙: ${specSummary}

${sectionHint}

아래 JSON 스키마로만 응답:
${schema}`;

  // ★ 2026-07-03 문안두뇌 주입 — 회사 성과 DM 문안 RAG + 브랜드 키트(시그니처·슬로건·금지어)를 시스템에 덧붙임.
  //   companyId 있을 때만, 실패해도 기본 프롬프트로 그대로 생성(생성 무영향). isAd=true(DM=판촉 기본).
  let genSystem = COPY_GEN_SYSTEM;
  if (companyId) {
    try {
      const brain = await composeCopyBrain({ companyId, channels: ['DM'], isAd: true });
      if (brain.promptSuffix) genSystem = COPY_GEN_SYSTEM + brain.promptSuffix;
    } catch (err) {
      console.warn('[copy-brain] DM generateCopy 주입 실패 — 기본 프롬프트로 진행:', (err as Error)?.message);
    }
  }

  const text = await callAIWithFallback({
    system: genSystem,
    userMessage,
    maxTokens: 800,
    temperature: 0.8,
    model: 'opus',
    companyId,
    source: 'dm-copy', // ★ D227+ 종량제: 집계용(맵 미등록=0). dm-builder 묶음 안에선 자동 0
  });
  return extractJson<CopyDraft>(text);
}

// ────────────── 4. Tone Transformer ──────────────

const TONE_SYSTEM = `당신은 카피 톤 변환 전문가입니다.
주어진 원문을 지정된 톤으로 자연스럽게 변환합니다.

톤 종류:
- direct: 직관형 (혜택을 바로 제시)
- emotional: 감성형 (고객의 순간/감정 자극)
- premium: 고급형 (절제된 언어, 여백의 미)
- urgent: 긴박형 (마감/희소성 강조)
- friendly: 친절형 (따뜻한 어투)
- sales: 세일즈형 (구매 전환 강조)

제약:
- 한국어 유지
- 원문의 길이 대비 ±30% 이내
- 이모지 사용 금지 — 원문에 있던 이모지도 제거 (2026-07-02 디자인 v2 카피 규율)
- 출력은 JSON: { "text": "변환된 문장" }
- JSON 외 다른 텍스트 금지`;

export async function transformTone(text: string, targetTone: ToneKey, companyId?: string): Promise<string> {
  const userMessage = `원문: "${text}"
목표 톤: ${targetTone} (${TONE_LABELS[targetTone] || targetTone})

변환 결과를 JSON으로 반환.`;

  const raw = await callAIWithFallback({
    system: TONE_SYSTEM,
    userMessage,
    maxTokens: 300,
    temperature: 0.7,
    model: 'opus',
    companyId,
    source: 'dm-tone', // ★ D227+ 종량제: 집계용(맵 미등록=0)
  });
  const parsed = extractJson<{ text: string }>(raw);
  return parsed.text || text;
}

// ────────────── 5. Improve Message (전체 섹션) ──────────────

const IMPROVE_SYSTEM = `당신은 리테일 DM 카피 편집자입니다.
여러 섹션의 카피를 받아 다음 기준으로 개선안을 제시합니다:
- 문구 더 짧게 정리
- 전환 유도 강화
- CTA 더 강하게
- 혜택 강조 순서 개선
- 너무 장황한 문구 축약
- 반복 표현 제거

출력 JSON:
{ "suggestions": [
  { "section_id": "...", "field": "headline|body|cta_label|...", "before": "...", "after": "...", "reason": "짧은 이유" }
] }

개선이 필요 없는 항목은 포함하지 않음. JSON 외 다른 텍스트 금지.`;

export type ImprovementSuggestion = {
  section_id: string;
  field: string;
  before: string;
  after: string;
  reason: string;
};

export async function improveMessage(sections: Section[], brandKit?: DmBrandKit, companyId?: string): Promise<ImprovementSuggestion[]> {
  // AI가 분석 가능한 섹션만 추려 페이로드 축소
  const payload = sections
    .filter((s) => SECTION_META[s.type].aiAware && s.visible && !s.ai_locked)
    .map((s) => ({
      section_id: s.id,
      type: s.type,
      props: extractEditableFields(s),
    }));

  if (payload.length === 0) return [];

  const userMessage = `브랜드 톤: ${brandKit?.tone || 'friendly'}

현재 섹션 카피:
${JSON.stringify(payload, null, 2)}

개선 제안 JSON.`;

  const raw = await callAIWithFallback({
    system: IMPROVE_SYSTEM,
    userMessage,
    maxTokens: 1800,
    temperature: 0.5,
    model: 'opus',
    companyId,
    source: 'dm-improve', // ★ D227+ 종량제: 집계용(맵 미등록=0)
  });
  const parsed = extractJson<{ suggestions?: ImprovementSuggestion[] }>(raw);
  return parsed.suggestions || [];
}

// ────────────── 내부 헬퍼 ──────────────

function cryptoId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `sec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 섹션에서 AI가 편집할 수 있는 텍스트 필드만 추출 */
function extractEditableFields(section: Section): Record<string, unknown> {
  const p = section.props as any;
  const type = section.type;
  const out: Record<string, unknown> = {};
  const keysByType: Record<SectionType, string[]> = {
    // 옛 11
    header:     ['event_title', 'discount_label'],
    hero:       ['headline', 'sub_copy'],
    coupon:     ['discount_label', 'usage_condition'],
    countdown:  ['urgency_text'],
    text_card:  ['tag', 'headline', 'body'],
    cta:        ['buttons'],
    video:      ['caption'],
    store_info: [],
    sns:        [],
    promo_code: ['description', 'instructions', 'cta_label'],
    footer:     ['notes'],
    // D216+ 신규 16 — AI 편집 가능 텍스트 필드
    product_carousel:  ['title'],
    gallery:           ['title'],
    slideshow:         [],
    tab_cards:         [],
    poll:              ['question'],
    survey:            ['title', 'completion_reward_text'],
    email_capture:     ['headline', 'description', 'reward_description', 'success_text'],
    click_rewards:     ['reward_description'],
    lucky_draw:        ['title', 'description'],
    roulette:          [],
    instant_coupon:    ['coupon_label', 'discount_description', 'conditions', 'usage_instructions'],
    limited_quantity:  ['title', 'description'],
    youtube_embed:     [],
    instagram_embed:   [],
    map_store_locator: [],
    reviews:           ['title'],
  };
  for (const k of keysByType[type] || []) {
    if (p[k] !== undefined && p[k] !== null && p[k] !== '') out[k] = p[k];
  }
  return out;
}

// ────────────── Compatibility: 사용되지 않는 SECTION_DEFAULTS import 방지 ──────────────
void SECTION_DEFAULTS;

// ────────────── D216+ One-Shot AI 생성 (parsePrompt + recommendLayout + generateCopy 통합) ──────────────

import { randomUUID } from 'crypto';

/** 빠른 시작 12 시나리오 → 섹션 chain 매핑 */
const SCENARIO_MAP: Record<string, { sections: SectionType[]; toneHint: CampaignTone; objective: CampaignObjective }> = {
  '신상품 출시':   { sections: ['header', 'hero', 'product_carousel', 'cta', 'footer'], toneHint: 'premium',  objective: 'sale' },
  '시즌 세일':     { sections: ['header', 'countdown', 'coupon', 'cta', 'footer'],      toneHint: 'urgent',   objective: 'sale' },
  '추첨 이벤트':   { sections: ['header', 'hero', 'lucky_draw', 'cta', 'footer'],       toneHint: 'playful',  objective: 'awareness' },
  '매장 안내':     { sections: ['header', 'hero', 'map_store_locator', 'store_info', 'footer'], toneHint: 'friendly', objective: 'loyalty' },
  '설문 + 보상':   { sections: ['header', 'survey', 'instant_coupon', 'footer'],        toneHint: 'friendly', objective: 'retention' },
  '신규 환영':     { sections: ['header', 'hero', 'email_capture', 'cta', 'footer'],    toneHint: 'friendly', objective: 'awareness' },
  '룰렛 이벤트':   { sections: ['header', 'roulette', 'cta', 'footer'],                 toneHint: 'playful',  objective: 'awareness' },
  '갤러리 룩북':   { sections: ['header', 'hero', 'gallery', 'product_carousel', 'cta', 'footer'], toneHint: 'premium',  objective: 'sale' },
  '리뷰 모음':     { sections: ['header', 'hero', 'reviews', 'cta', 'footer'],          toneHint: 'friendly', objective: 'retention' },
  '선착순 한정특가': { sections: ['header', 'countdown', 'limited_quantity', 'coupon', 'cta', 'footer'], toneHint: 'urgent', objective: 'sale' },
  '실시간 투표':   { sections: ['header', 'hero', 'poll', 'cta', 'footer'],             toneHint: 'playful',  objective: 'awareness' },
  'VIP 초대':      { sections: ['header', 'hero', 'promo_code', 'text_card', 'cta', 'store_info', 'footer'], toneHint: 'premium', objective: 'loyalty' },
};

export interface OneShotResult {
  spec: CampaignSpec;
  sections: Section[];
  brandKit: Partial<DmBrandKit>;
  scenario?: string;
  layoutMode: DmLayoutMode;
  pages: Section[][];
}

// ────────────── 행사 원문 상품 구조 추출 (2026-07-08) ──────────────

const PRODUCT_EXTRACT_SYSTEM = `당신은 행사 원문에서 상품 정보를 구조화하는 파서입니다.
원문에 명시된 상품만 추출합니다. 원문에 없는 상품·가격·할인 창작 절대 금지.

규칙:
- name = 상품명 (원문 표기 그대로, 앞뒤 라벨 정리만 허용)
- price = 정가 (원문 숫자 그대로, 콤마 제거한 정수)
- discount_price = 할인가 (원문에 있을 때만), discount_rate = 할인율 % (원문에 있을 때만)
- link_url = 그 상품 블록에 붙은 URL (원문에 있을 때만, 원문 글자 그대로). URL 창작·축약·변형 절대 금지. 없으면 생략
- 가격이 하나만 적힌 상품은 price에 넣고 discount_price 생략
- 가격이 전혀 없는 상품·상품이 없는 원문 = 빈 배열

JSON만 출력:
{ "products": [{ "name": "상품명", "price": 0, "discount_price": 0, "discount_rate": 0, "link_url": "https://..." }] }`;

/**
 * 행사 원문 → 상품 목록 추출 + 원문 실존 기계 검증(validateProductsAgainstEventText).
 * 검증 탈락/파싱 실패 = 빈 배열 (호출부는 placeholder 유지 — 생성 흐름 무영향).
 */
export async function extractEventProducts(sourceText: string, companyId?: string): Promise<ExtractedEventProduct[]> {
  const text = String(sourceText || '').trim();
  if (!text) return [];
  try {
    const raw = await callAIWithFallback({
      system: PRODUCT_EXTRACT_SYSTEM,
      userMessage: `[행사 원문]\n${text.slice(0, 4000)}\n\n위 원문에서 상품 목록을 JSON으로 추출하세요.`,
      maxTokens: 2000,
      temperature: 0,
      model: 'sonnet',
      companyId,
      source: 'dm-product-extract', // 종량제: 맵 미등록=0 — dm-ai-generate 묶음 안 집계만
    });
    const parsed = extractJson<{ products?: unknown[] }>(raw);
    return validateProductsAgainstEventText(parsed?.products, text);
  } catch (err) {
    console.warn('[extractEventProducts] 추출 실패 — 빈 배열 폴백:', (err as any)?.message);
    return [];
  }
}

/**
 * 자연어 한 줄 OR 시나리오명 → 완성된 sections[] + brandKit 통합 생성.
 *
 * 흐름:
 *   1. scenario 영역 지정 시 = SCENARIO_MAP 매핑 활용 (섹션 chain 강제 + 톤 hint)
 *   2. scenario 영역 X = parsePrompt → spec.recommended_sections 영역 활용
 *   3. recommendLayout → 옛 영역 정합 (다만 scenario 강제 시 = override)
 *   4. 섹션별 generateCopy → 섹션 props 자동 매핑
 *   5. 완성된 Section[] + brandKit 반환
 */
export async function oneShotGenerate(opts: {
  prompt: string;
  scenario?: string;
  brandName?: string;
  companyId?: string; // ★ D227+ 종량제: 묶음 집계용 — 내부 parse/copy에 전파
  eventText?: string; // ★ 2026-07-08 행사 원문 — product_carousel 상품 구조 추출 근거(없으면 prompt로 폴백)
}): Promise<OneShotResult> {
  const prompt = (opts.prompt || '').trim();
  if (!prompt && !opts.scenario) {
    throw new Error('prompt 또는 scenario 영역 필요');
  }

  // 1. spec 영역 생성 (scenario 영역 지정 시 = 기본 spec 영역 + scenario 매핑 활용)
  let spec: CampaignSpec;
  let scenarioMeta = opts.scenario ? SCENARIO_MAP[opts.scenario] : undefined;

  if (prompt) {
    spec = await parsePrompt(prompt, opts.companyId);
  } else {
    // scenario 영역만 지정 시 = 옛 CampaignSpec 타입 정합 default spec
    spec = {
      brand: { name: opts.brandName || '', tone: scenarioMeta?.toneHint || 'friendly' },
      objective: scenarioMeta?.objective || 'sale',
      target: {},
      personalization: [],
      tone: scenarioMeta?.toneHint || 'friendly',
      industry: 'general',
      recommended_sections: scenarioMeta?.sections || ['header', 'hero', 'cta', 'footer'],
    };
  }

  // brandKit 영역 = 옛 spec 영역 정합 (회사 admin 영역 = override 가능)
  const brandKit: Partial<DmBrandKit> = {
    tone: spec.tone || scenarioMeta?.toneHint || 'friendly',
  };

  // 2. sections chain 결정 — 빠른 시작 시나리오는 고정, 자유 프롬프트는 AI 설계 + 안전 정규화(Phase 3).
  let sectionTypes: SectionType[];
  if (scenarioMeta?.sections) {
    sectionTypes = scenarioMeta.sections;
  } else if (prompt) {
    const aiChain = await designSectionLayout(spec, opts.companyId);
    sectionTypes = normalizeSectionChain(aiChain, spec.objective);
  } else {
    sectionTypes = normalizeSectionChain(
      Array.isArray(spec.recommended_sections) ? (spec.recommended_sections as SectionType[]) : [],
      spec.objective,
    );
  }

  // 3. 섹션 영역 생성 + 카피 자동 매핑
  const sections: Section[] = [];
  for (let i = 0; i < sectionTypes.length; i++) {
    const type = sectionTypes[i];
    if (!SECTION_META[type]) continue;

    const section = createSection(type, randomUUID(), i);

    // 4. 섹션별 카피 자동 생성 (AI 영역 = 옛 영역 정합) + 신규 16 영역 = default props 정합
    if (SECTION_META[type].aiAware) {
      try {
        const copy = await generateCopy(spec, section, opts.companyId);
        section.props = mergeCopyIntoProps(section.props as any, type, copy) as any;
      } catch (err) {
        console.warn(`[oneShotGenerate] generateCopy 실패 type=${type}:`, (err as any)?.message);
      }
    }

    applyInteractionDefaults(section);
    sections.push(section);
  }

  // ★ 2026-07-08 행사 원문 상품 구조 반영 — 첫 product_carousel.products에 원문 실존 검증 통과분 주입.
  //   추출 실패/검증 탈락 = placeholder 유지(기존 흐름 무영향). 이미지는 직접 업로드(image_url '').
  const productSource = (opts.eventText || '').trim() || prompt;
  const carouselIdx = sections.findIndex((s) => s.type === 'product_carousel');
  if (carouselIdx >= 0 && productSource) {
    const extracted = await extractEventProducts(productSource, opts.companyId);
    if (extracted.length > 0) {
      // ★ 2026-07-13 — 상품 URL 매핑(원문 실존 검증 통과분) + URL 페이지의 og:image로 상품 이미지 자동 채움.
      //   이미지 fetch 실패/사설 호스트/og 부재 = 빈 값 유지(생성 차단 X — 사용자가 직접 업로드).
      const ogImages = await fetchProductOgImages(extracted.map((p) => p.link_url));
      (sections[carouselIdx].props as any).products = extracted.map((p, i) => ({
        id: randomUUID(),
        image_url: ogImages[i] || '',
        name: p.name,
        price: p.price,
        ...(p.discount_price ? { discount_price: p.discount_price } : {}),
        ...(p.discount_rate ? { discount_rate: p.discount_rate } : {}),
        ...(p.link_url ? { link_url: p.link_url } : {}),
      }));
    }
  }

  // ★ AI 비주얼 디렉터 — 캠페인별 색·무드·강조 + 섹션 구도(treatment)를 설계해 섹션에 입힘(사진 없어도 완성형).
  const concept = await designVisualConcept(spec, undefined, opts.companyId);
  // 디렉터의 섹션 타입별 treatment 추천 → 섹션 id 맵(없으면 applyVisualDirection이 typeScale 기반 기본 적용).
  const treatmentById: Record<string, string> = {};
  if (concept.treatments) {
    for (const s of sections) {
      const t = concept.treatments[s.type];
      if (t) treatmentById[s.id] = t;
    }
  }
  const directed = applyVisualDirection(sections, concept, treatmentById);
  // ★ 2026-07-13 디자인 3.0 — 비주얼 컨셉의 타입스케일을 brand_kit.art_direction으로 영속화(뷰어 실주입 — 디자인만, 사실/혜택 무관)
  const adBase = (brandKit as any)?.art_direction || {};
  const enrichedKit = {
    ...brandKit,
    art_direction: {
      ...adBase,
      typeScale: concept.type_scale,
      headlineFont: adBase.headlineFont || (concept.type_scale === 'editorial' ? 'serif' : 'sans'),
      spacingDensity: adBase.spacingDensity || (concept.type_scale === 'editorial' ? 'airy' : 'standard'),
      accentMotif: adBase.accentMotif || (concept.type_scale === 'editorial' ? 'rule' : 'none'),
      sectionDivider: adBase.sectionDivider || (concept.type_scale === 'editorial' ? 'hairline' : 'none'),
    },
    ...(concept.type_scale === 'editorial' && !(brandKit as any)?.font_display ? { font_display: '"Noto Serif KR", serif' } : {}),
  } as typeof brandKit;
  // 섹션 구성으로 레이아웃 모드 자동 결정 + 모드별 페이지 분할 (slides면 여러 장, scroll이면 한 장)
  const layoutMode = decideLayoutMode(directed);
  const pages = splitSectionsIntoPages(directed, layoutMode);
  return { spec, sections: directed, brandKit: enrichedKit, scenario: opts.scenario, layoutMode, pages };
}

/**
 * 인터랙션 섹션 자동 구조화 — 경품/등급 틀을 placeholder로 채워 1클릭 캠페인을 바로 편집 가능 상태로.
 * 구체 혜택(%/원/쿠폰/무료) 임의 생성 절대 금지 — 이름은 항상 [직접 작성해주세요]. 확률·인원 구조만 제안.
 */
function applyInteractionDefaults(section: Section): void {
  const p = section.props as any;
  if (section.type === 'lucky_draw') {
    if (!Array.isArray(p.prizes) || p.prizes.length === 0) {
      p.prizes = [{ rank: 1, name: '[직접 작성해주세요]', count: 1 }];
    }
  } else if (section.type === 'roulette') {
    if (Array.isArray(p.segments) && p.segments.length >= 2) {
      const n = p.segments.length;
      const winners = Math.min(2, n - 1);
      const loseProb = (1 - 0.05 * winners) / (n - winners);
      p.segments = p.segments.map((s: any, i: number) =>
        i < winners
          ? { ...s, label: `${i + 1}등`, reward_description: '[직접 작성해주세요]', prize_count: 1, probability: 0.05 }
          : { ...s, label: '꽝', reward_description: undefined, prize_count: 0, probability: loseProb },
      );
    }
  } else if (section.type === 'survey') {
    // 설문 기본 1문항 골격 — 질문·선택지는 [직접 작성해주세요] (사실·혜택 생성 X)
    if (!Array.isArray(p.questions) || p.questions.length === 0) {
      p.questions = [
        { id: '1', type: 'single', question: '[직접 작성해주세요]', options: ['[직접 작성해주세요]', '[직접 작성해주세요]'], required: false },
      ];
    }
  }
}

/** AI 생성 카피 영역 → 섹션 props 매핑 (옛 11 + 신규 16 정합) */
function mergeCopyIntoProps(currentProps: Record<string, unknown>, type: SectionType, copy: any): Record<string, unknown> {
  const next = { ...currentProps };
  const firstHeadline = Array.isArray(copy?.headlines) && copy.headlines[0]?.text ? copy.headlines[0].text : '';
  const body = copy?.body || '';

  switch (type) {
    case 'header':
      if (firstHeadline) next.event_title = firstHeadline;
      break;
    case 'hero':
      if (firstHeadline) next.headline = firstHeadline;
      if (body) next.sub_copy = body;
      break;
    case 'coupon':
      if (firstHeadline) next.discount_label = firstHeadline;
      if (body) next.usage_condition = body;
      break;
    case 'countdown':
      if (firstHeadline) next.urgency_text = firstHeadline;
      break;
    case 'text_card':
      if (firstHeadline) next.headline = firstHeadline;
      if (body) next.body = body;
      break;
    case 'cta':
      if (firstHeadline && Array.isArray(next.buttons) && next.buttons.length > 0) {
        (next.buttons as any[])[0] = { ...(next.buttons as any[])[0], label: firstHeadline };
      }
      break;
    case 'promo_code':
      if (firstHeadline) next.description = firstHeadline;
      if (body) next.instructions = body;
      break;
    case 'footer':
      if (body) next.notes = body;
      break;
    // 신규 16 — AI 생성 영역 (default props 안 placeholder 영역 정합)
    case 'product_carousel':
    case 'gallery':
    case 'reviews':
      if (firstHeadline) next.title = firstHeadline;
      break;
    case 'poll':
      if (firstHeadline) next.question = firstHeadline;
      break;
    case 'survey':
      if (firstHeadline) next.title = firstHeadline;
      break;
    case 'email_capture':
      if (firstHeadline) next.headline = firstHeadline;
      if (body) next.description = body;
      break;
    case 'click_rewards':
      if (firstHeadline) next.reward_description = firstHeadline;
      break;
    case 'lucky_draw':
    case 'limited_quantity':
      if (firstHeadline) next.title = firstHeadline;
      if (body) next.description = body;
      break;
    case 'instant_coupon':
      if (firstHeadline) next.coupon_label = firstHeadline;
      if (body) next.discount_description = body;
      break;
    default:
      // roulette / tab_cards / slideshow / youtube_embed / instagram_embed / map_store_locator / video / store_info / sns = 회사 admin 직접 작성
      break;
  }
  return next;
}

// ────────────── AI 비주얼 디렉터 (Phase 1) ──────────────

const VISUAL_DIRECTOR_SYSTEM = `당신은 모바일 DM 아트 디렉터입니다.
브랜드·목적·업종·톤을 보고 이 캠페인의 비주얼 컨셉(색 팔레트·무드·강조 + 섹션 구도)을 설계합니다.
제약:
- 색은 HEX 6자리. 브랜드 색이 주어지면 그와 조화롭게, 없으면 업종 무드에 맞게.
- treatments는 섹션 "구도(레이아웃)"만 고른다. 각 섹션 타입은 아래 목록에서만 선택:
  hero: classic|full_bleed|split|typographic|editorial_overlap
  coupon: classic|ticket|spotlight
  text_card: classic|lead|framed|quote
  cta: classic|bar|ghost|sticky
  product_carousel: classic|focus|list
  gallery: classic|mosaic
  reviews: classic|quote
  countdown: classic|banner
  promo_code: classic|light
  store_info: classic|card
  (캠페인 톤·맥락에 맞게 다양하게. 고급/에디토리얼이면 typographic·quote·focus·ticket, 세일/긴박이면 full_bleed·banner·sticky를 적극 활용.)
- 디자인 디렉션만. 상품명·가격·할인율·쿠폰·무료·혜택 문구 등 사실/카피는 절대 만들지 않는다.
- JSON만 출력:
{ "palette": { "primary":"#xxxxxx","accent":"#xxxxxx","surface":"#xxxxxx","on_surface":"#xxxxxx" },
  "mood":"한두 단어","hero_treatment":"gradient|color_block|image","emphasis_sections":["hero"],"type_scale":"bold|editorial|minimal",
  "treatments":{ "hero":"...","coupon":"...","text_card":"...","cta":"...","product_carousel":"...","gallery":"...","reviews":"...","countdown":"...","promo_code":"...","store_info":"..." } }`;

/**
 * AI 비주얼 디렉터 — 캠페인별 색·무드·강조 컨셉을 설계. 색·무드만 만든다(혜택/사실 생성 X — 영구 룰).
 * 실패해도 업종 기본 팔레트로 안전 degrade(발송·생성 차단 X).
 */
export async function designVisualConcept(spec: CampaignSpec, brandKit?: DmBrandKit, companyId?: string): Promise<VisualConcept> {
  try {
    const userMessage = `브랜드: ${spec.brand.name || '(미정)'} / 목적: ${spec.objective} / 업종: ${spec.industry} / 톤: ${spec.tone}` +
      (brandKit?.primary_color ? ` / 브랜드색: ${brandKit.primary_color}` : '');
    const text = await callAIWithFallback({
      system: VISUAL_DIRECTOR_SYSTEM,
      userMessage,
      maxTokens: 400,
      temperature: 0.7,
      model: 'opus',
      companyId,
      source: 'dm-visual', // ★ D227+ 종량제: 묶음 안에선 0(과차감 방지)
    });
    return normalizeVisualConcept(extractJson(text) as any, spec.industry || 'general');
  } catch (e: any) {
    console.warn('[designVisualConcept] fallback:', e?.message);
    return normalizeVisualConcept({}, spec.industry || 'general');
  }
}

// ────────────── AI 섹션 디자이너 (Phase 3) — 자유 프롬프트 섹션 chain 다양화 ──────────────

const SECTION_LAYOUT_SYSTEM = `당신은 모바일 DM 정보구조 설계자입니다.
브랜드·목적·업종·캠페인 맥락을 보고 어떤 섹션을 어떤 순서로 배치할지 설계합니다.
사용 가능한 섹션 타입(이 중에서만 선택):
header, hero, coupon, countdown, text_card, cta, video, store_info, sns, promo_code, footer,
product_carousel, gallery, slideshow, tab_cards, poll, survey, email_capture, click_rewards,
lucky_draw, roulette, instant_coupon, limited_quantity, youtube_embed, instagram_embed, map_store_locator, reviews
제약:
- 목적에 맞는 섹션을 5~8개. 같은 목적이라도 캠페인 맥락에 따라 다르게 구성.
- header로 시작, footer로 끝. cta는 1개 이상.
- 섹션 "구성"만 설계한다. 카피·혜택·상품·숫자는 만들지 않는다.
- JSON 배열만 출력: ["header","hero","coupon","cta","footer"]`;

/**
 * AI 섹션 디자이너 — 자유 프롬프트일 때 섹션 chain(타입 순서)을 콘텐츠 기반으로 설계.
 * 반환값은 normalizeSectionChain으로 안전 정규화해 사용(유효성·순서·maxCount 가드).
 * 실패 시 빈 배열 → 정규화가 최소 chain 보장(degrade).
 */
export async function designSectionLayout(spec: CampaignSpec, companyId?: string): Promise<SectionType[]> {
  try {
    const userMessage = `목적: ${spec.objective} / 업종: ${spec.industry} / 톤: ${spec.tone}`
      + (spec.brand.name ? ` / 브랜드: ${spec.brand.name}` : '')
      + (spec.benefit?.type ? ` / 혜택유형: ${spec.benefit.type}` : '')
      + (spec.urgency?.label ? ` / 긴급성 있음` : '');
    const text = await callAIWithFallback({
      system: SECTION_LAYOUT_SYSTEM,
      userMessage,
      maxTokens: 300,
      temperature: 0.8,
      model: 'opus',
      companyId,
      source: 'dm-layout', // ★ D227+ 종량제: 묶음 안에선 0(과차감 방지)
    });
    return extractJsonArray<string>(text) as SectionType[];
  } catch (e: any) {
    console.warn('[designSectionLayout] fallback:', e?.message);
    return [];
  }
}
