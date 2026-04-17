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
import {
  SECTION_META, SECTION_DEFAULTS, type Section, type SectionType,
  createSection,
} from './dm-section-registry';
import type { DmBrandKit } from './dm-tokens';

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

/** AI 응답에서 첫 번째 JSON 블록을 안전하게 파싱 */
function extractJson<T = unknown>(raw: string): T {
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

export async function parsePrompt(rawPrompt: string): Promise<CampaignSpec> {
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
- 이모지 최대 1개, 느낌표 최대 1개
- 브랜드명을 카피 본문에 직접 삽입하지 않음 (브랜드 영역은 별도)
- 과장 표현("반드시 성공", "무조건") 금지
- 개인화 변수는 %고객명% 같은 형태 유지
- JSON 외 다른 텍스트 출력 금지`;

export async function generateCopy(spec: CampaignSpec, section: Section): Promise<CopyDraft> {
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
    case 'header':
      return {}; // 헤더는 브랜드명/로고 위주라 AI 생성 제외
    default:
      return {}; // video/store_info/sns는 AI 생성 대상 아님
  }

  const userMessage = `캠페인 스펙: ${specSummary}

${sectionHint}

아래 JSON 스키마로만 응답:
${schema}`;

  const text = await callAIWithFallback({
    system: COPY_GEN_SYSTEM,
    userMessage,
    maxTokens: 800,
    temperature: 0.8,
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
- 이모지 최대 1개
- 출력은 JSON: { "text": "변환된 문장" }
- JSON 외 다른 텍스트 금지`;

export async function transformTone(text: string, targetTone: ToneKey): Promise<string> {
  const userMessage = `원문: "${text}"
목표 톤: ${targetTone} (${TONE_LABELS[targetTone] || targetTone})

변환 결과를 JSON으로 반환.`;

  const raw = await callAIWithFallback({
    system: TONE_SYSTEM,
    userMessage,
    maxTokens: 300,
    temperature: 0.7,
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

export async function improveMessage(sections: Section[], brandKit?: DmBrandKit): Promise<ImprovementSuggestion[]> {
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
  };
  for (const k of keysByType[type] || []) {
    if (p[k] !== undefined && p[k] !== null && p[k] !== '') out[k] = p[k];
  }
  return out;
}

// ────────────── Compatibility: 사용되지 않는 SECTION_DEFAULTS import 방지 ──────────────
void SECTION_DEFAULTS;
