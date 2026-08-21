/**
 * dm-template-registry.ts — 기본 제공 템플릿 7카테고리
 *
 * 사용자가 "템플릿으로 시작"할 때 이 레지스트리의 템플릿을 복사.
 * 각 템플릿은 sections[] + brand_kit 추천 + 추천 변형.
 *
 * dm_templates 테이블에 시드 삽입하는 함수도 제공 (초기 설치용).
 *
 * 설계서: status/DM-PRO-DESIGN.md §19 완료 체크리스트
 */
import { query } from '../../config/database';
import type { Section } from './dm-section-registry';
import { createSection } from './dm-section-registry';
import type { DmBrandKit } from './dm-tokens';

// ────────────── 타입 ──────────────

export type TemplateCategory =
  | 'new_product'        // 신상품 홍보
  | 'discount'           // 할인 프로모션
  | 'urgent'             // 긴급 마감형
  | 'point_reminder'     // 포인트 리마인드
  | 'reactivation'       // 재방문 유도
  | 'offline_driving'    // 오프라인 매장 유도
  | 'vip';               // VIP 전용

export type TemplateIndustry = 'beauty' | 'fashion' | 'food' | 'tech' | 'luxury' | 'general';

export type DmTemplate = {
  id: string;
  category: TemplateCategory;
  industry: TemplateIndustry;
  name: string;
  description: string;
  thumbnail_url?: string;
  sections: Section[];
  brand_kit?: Partial<DmBrandKit>;
  popularity: number;
};

// ────────────── 템플릿 정의 ──────────────

function tpl(id: string, category: TemplateCategory, industry: TemplateIndustry, name: string, description: string, sections: Section[], brand_kit?: Partial<DmBrandKit>, popularity = 0): DmTemplate {
  return { id, category, industry, name, description, sections, brand_kit, popularity };
}

function genId(type: string, i: number): string {
  return `seed-${type}-${i}`;
}

/** 각 템플릿의 섹션은 category별 기본 조합 + 빈 값 */
function buildSections(types: Array<Parameters<typeof createSection>[0]>): Section[] {
  return types.map((type, i) => createSection(type, genId(type, i), i));
}

/**
 * ★ 2026-07-13 디자인 3.0 — 아트디렉션 완성형(골든) 템플릿 빌더.
 * 섹션 타입 + 스타일 패치(구도/배경면/연결부/겹침/정렬/props 일부)를 함께 지정.
 * 문안은 SECTION_DEFAULTS의 중립 placeholder 그대로 — 구체 혜택 수치 없음(AI 임의 혜택 금지 룰 정합).
 */
type SecPatch = Partial<Pick<Section, 'treatment' | 'background' | 'divider_shape' | 'pull_up' | 'align'>> & { props?: Record<string, unknown> };
function buildStyledSections(entries: Array<[Parameters<typeof createSection>[0], SecPatch?]>): Section[] {
  return entries.map(([type, patch], i) => {
    const s = createSection(type, genId(type, i), i);
    if (patch) {
      const { props, ...rest } = patch;
      Object.assign(s, rest);
      if (props) s.props = { ...(s.props as any), ...props } as any;
    }
    return s;
  });
}

// ★ 2026-07-13 디자인 3.0 — 옛 7종(빈 골격) → 아트디렉션 완성형 12종으로 격상.
//   기존 7개 id 유지(과거 dm_pages.template_id 참조·시드 UPSERT 호환) + 신규 5종 추가.
export const DM_TEMPLATES: DmTemplate[] = [
  tpl(
    'new_product_beauty',
    'new_product', 'beauty',
    '뷰티 신상 런칭 · 에디토리얼',
    '세리프 헤드라인 + 오버랩 히어로 + 대표 상품 포커스. 잡지 화보 톤의 신상 소개',
    buildStyledSections([
      ['header'],
      ['hero', { treatment: 'editorial_overlap' }],
      ['text_card', { treatment: 'lead' }],
      ['product_carousel', { treatment: 'focus', background: 'soft' }],
      ['cta', { treatment: 'bar' }],
      ['store_info', { treatment: 'card' }],
      ['footer'],
    ]),
    {
      primary_color: '#ec4899', accent_color: '#f59e0b', tone: 'elegant',
      font_display: '"Noto Serif KR", serif',
      art_direction: { theme: 'editorial', typeScale: 'editorial', headlineFont: 'serif', spacingDensity: 'airy', accentMotif: 'rule', sectionDivider: 'hairline' },
    },
    10,
  ),
  tpl(
    'discount_fashion',
    'discount', 'fashion',
    '패션 시즌 세일 · 볼드',
    '풀블리드 히어로 + 긴박 배너 타이머 + 티켓 쿠폰 + 스티키 CTA. 세일 전용 임팩트 조판',
    buildStyledSections([
      ['header'],
      ['hero', { treatment: 'full_bleed', props: { overlay: 'strong' } }],
      ['countdown', { treatment: 'banner' }],
      ['coupon', { treatment: 'ticket' }],
      ['product_carousel', { treatment: 'list' }],
      ['cta', { treatment: 'sticky' }],
      ['footer'],
    ]),
    {
      primary_color: '#18181b', accent_color: '#fde68a', tone: 'urgent',
      font_display: '"Black Han Sans", sans-serif',
      art_direction: { theme: 'bold-sale', typeScale: 'bold', headlineFont: 'sans', spacingDensity: 'compact', accentMotif: 'index', sectionDivider: 'none' },
    },
    12,
  ),
  tpl(
    'urgent_today_close',
    'urgent', 'general',
    '오늘 마감 · 임팩트',
    '상단 타이머 + 분할 히어로 + 스포트라이트 쿠폰 + 스티키 CTA. 마감 임박 집중 유도',
    buildStyledSections([
      ['header'],
      ['countdown'],
      ['hero', { treatment: 'split' }],
      ['coupon', { treatment: 'spotlight' }],
      ['cta', { treatment: 'sticky' }],
      ['footer'],
    ]),
    {
      primary_color: '#ef4444', accent_color: '#fbbf24', tone: 'urgent',
      art_direction: { theme: 'bold-sale', typeScale: 'bold', headlineFont: 'sans', spacingDensity: 'compact', accentMotif: 'none', sectionDivider: 'none' },
    },
    15,
  ),
  tpl(
    'point_reminder_general',
    'point_reminder', 'general',
    '포인트 리마인드 · 미니멀',
    '리드 텍스트 + 라이트 프로모 코드 + 고스트 CTA. 조용하고 정갈한 안내 톤',
    buildStyledSections([
      ['header'],
      ['text_card', { treatment: 'lead' }],
      ['promo_code', { treatment: 'light' }],
      ['cta', { treatment: 'ghost' }],
      ['footer'],
    ]),
    {
      primary_color: '#3b82f6', accent_color: '#93c5fd', tone: 'friendly',
      art_direction: { theme: 'minimal', typeScale: 'minimal', headlineFont: 'sans', spacingDensity: 'standard', accentMotif: 'none', sectionDivider: 'gap' },
    },
    6,
  ),
  tpl(
    'reactivation_beauty',
    'reactivation', 'beauty',
    '휴면 재방문 · 소프트',
    '소프트 오버레이 히어로 + 프레임 텍스트 + 쿠폰 겹침 카드. 부드러운 안부 톤',
    buildStyledSections([
      ['header'],
      ['hero', { props: { overlay: 'soft' } }],
      ['text_card', { treatment: 'framed', background: 'soft' }],
      ['coupon', { pull_up: true }],
      ['cta'],
      ['footer'],
    ]),
    {
      primary_color: '#ec4899', accent_color: '#fbcfe8', background_color: '#fffafc', tone: 'friendly',
      art_direction: { theme: 'soft-pastel', typeScale: 'minimal', headlineFont: 'sans', spacingDensity: 'airy', accentMotif: 'dot', sectionDivider: 'gap' },
    },
    7,
  ),
  tpl(
    'offline_driving_food',
    'offline_driving', 'food',
    '매장 방문 · 웜 페이퍼',
    '종이 질감 배경 + 고운바탕 세리프 + 모자이크 갤러리 + 매장 카드. 따뜻한 로컬 톤',
    buildStyledSections([
      ['header'],
      ['hero', { treatment: 'editorial_overlap' }],
      ['text_card', { treatment: 'lead' }],
      ['gallery', { treatment: 'mosaic' }],
      ['store_info', { treatment: 'card', background: 'soft' }],
      ['cta', { treatment: 'bar' }],
      ['footer'],
    ]),
    {
      primary_color: '#9a5b33', accent_color: '#e8b96a', background_color: '#faf6ef', tone: 'friendly',
      font_display: '"Gowun Batang", serif',
      art_direction: { theme: 'paper', typeScale: 'editorial', headlineFont: 'serif', spacingDensity: 'airy', accentMotif: 'dot', sectionDivider: 'hairline', grain: true },
    },
    8,
  ),
  tpl(
    'vip_exclusive_luxury',
    'vip', 'luxury',
    'VIP 프라이빗 · 럭셔리 다크',
    '다크 서피스 전면 + 골드 액센트 + 타이포 히어로 + 인용 카드. 격조 있는 비공개 오퍼',
    buildStyledSections([
      ['header'],
      ['hero', { treatment: 'typographic' }],
      ['text_card', { treatment: 'quote' }],
      ['promo_code'],
      ['store_info', { treatment: 'card' }],
      ['cta', { treatment: 'ghost' }],
      ['footer'],
    ]),
    {
      primary_color: '#b89150', accent_color: '#d4af37', background_color: '#0e1018', tone: 'premium',
      font_display: '"Noto Serif KR", serif',
      art_direction: { theme: 'luxury-dark', typeScale: 'editorial', headlineFont: 'serif', spacingDensity: 'airy', accentMotif: 'rule', sectionDivider: 'rule', grain: true },
    },
    9,
  ),
  // ── 신규 5종 ──
  tpl(
    'new_product_tech',
    'new_product', 'tech',
    '테크 신제품 · 시티 나이트',
    '다크 배경 + 시안 네온 + 브랜드 틴트 풀블리드 + 포커스 상품 + 스티키 CTA',
    buildStyledSections([
      ['header'],
      ['hero', { treatment: 'full_bleed', props: { overlay: 'brand' } }],
      ['countdown', { treatment: 'banner' }],
      ['product_carousel', { treatment: 'focus' }],
      ['cta', { treatment: 'sticky' }],
      ['footer'],
    ]),
    {
      primary_color: '#0ea5e9', accent_color: '#22d3ee', background_color: '#0b1220', tone: 'premium',
      art_direction: { theme: 'city-night', typeScale: 'bold', headlineFont: 'sans', spacingDensity: 'standard', accentMotif: 'index', sectionDivider: 'none', grain: true },
    },
    8,
  ),
  tpl(
    'discount_food',
    'discount', 'food',
    '푸드 위크 특가 · 비비드',
    '분할 히어로 + 리스트형 메뉴 + 티켓 쿠폰 + 후기. 생동감 있는 식음 프로모션',
    buildStyledSections([
      ['header'],
      ['hero', { treatment: 'split' }],
      ['product_carousel', { treatment: 'list' }],
      ['coupon', { treatment: 'ticket', background: 'soft' }],
      ['reviews'],
      ['cta', { treatment: 'bar' }],
      ['footer'],
    ]),
    {
      primary_color: '#ea580c', accent_color: '#fbbf24', tone: 'playful',
      art_direction: { theme: 'vivid', typeScale: 'bold', headlineFont: 'sans', spacingDensity: 'standard', accentMotif: 'index', sectionDivider: 'none' },
    },
    7,
  ),
  tpl(
    'vip_fashion_mono',
    'vip', 'fashion',
    '패션 멤버스 · 모노 에디토리얼',
    '흑백 미니멀 + 타이포 히어로 + 모자이크 룩북 + 인용. 하이패션 룩북 톤',
    buildStyledSections([
      ['header'],
      ['hero', { treatment: 'typographic' }],
      ['gallery', { treatment: 'mosaic' }],
      ['text_card', { treatment: 'quote' }],
      ['cta', { treatment: 'ghost' }],
      ['footer'],
    ]),
    {
      primary_color: '#18181b', accent_color: '#a3a3a3', tone: 'premium',
      font_display: '"Noto Serif KR", serif',
      art_direction: { theme: 'mono-editorial', typeScale: 'editorial', headlineFont: 'serif', spacingDensity: 'airy', accentMotif: 'rule', sectionDivider: 'hairline' },
    },
    6,
  ),
  tpl(
    'reactivation_gradient',
    'reactivation', 'general',
    '다시 만나요 · 그라데이션',
    '무드 그라데이션 히어로 + 그라데이션 면 텍스트 + 겹침 쿠폰. 산뜻한 복귀 인사',
    buildStyledSections([
      ['header'],
      ['hero'],
      ['text_card', { treatment: 'lead', background: 'gradient', divider_shape: 'wave' }],
      ['coupon', { pull_up: true }],
      ['cta'],
      ['footer'],
    ]),
    {
      primary_color: '#7c3aed', accent_color: '#c084fc', tone: 'friendly',
      art_direction: { theme: 'gradient', typeScale: 'bold', headlineFont: 'sans', spacingDensity: 'standard', accentMotif: 'none', sectionDivider: 'gap' },
    },
    6,
  ),
  tpl(
    'event_invite_festive',
    'offline_driving', 'general',
    '팝업·이벤트 초대 · 페스티브',
    '상단 오버레이 히어로 + 타이머 + 갤러리 + 매장 카드 + 스티키 CTA. 초대장 톤',
    buildStyledSections([
      ['header'],
      ['hero', { treatment: 'full_bleed', props: { overlay: 'top' } }],
      ['countdown'],
      ['gallery'],
      ['store_info', { treatment: 'card' }],
      ['cta', { treatment: 'sticky' }],
      ['footer'],
    ]),
    {
      primary_color: '#e11d48', accent_color: '#fbbf24', tone: 'playful',
      art_direction: { theme: 'festive', typeScale: 'bold', headlineFont: 'sans', spacingDensity: 'standard', accentMotif: 'bracket', sectionDivider: 'none' },
    },
    5,
  ),
];

// ────────────── 조회 ──────────────

export function getTemplate(id: string): DmTemplate | null {
  return DM_TEMPLATES.find((t) => t.id === id) || null;
}

export function listTemplates(filter?: { category?: TemplateCategory; industry?: TemplateIndustry }): DmTemplate[] {
  let out = DM_TEMPLATES.slice();
  if (filter?.category) out = out.filter((t) => t.category === filter.category);
  if (filter?.industry) out = out.filter((t) => t.industry === filter.industry);
  return out.sort((a, b) => b.popularity - a.popularity);
}

// ────────────── DB 시드 (초기 설치용) ──────────────

/**
 * dm_templates 테이블에 기본 템플릿 UPSERT.
 * 서버 시작 시 1회 호출 권장 (app.ts listen 콜백).
 */
export async function seedDefaultTemplates(): Promise<void> {
  try {
    for (const t of DM_TEMPLATES) {
      await query(
        `INSERT INTO dm_templates (id, category, industry, name, description, sections, brand_kit, popularity, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
         ON CONFLICT (id) DO UPDATE SET
           category = EXCLUDED.category,
           industry = EXCLUDED.industry,
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           sections = EXCLUDED.sections,
           brand_kit = EXCLUDED.brand_kit,
           is_active = TRUE`,
        [t.id, t.category, t.industry, t.name, t.description, JSON.stringify(t.sections), JSON.stringify(t.brand_kit || {}), t.popularity],
      );
    }
    console.log(`[DM Template] 기본 템플릿 ${DM_TEMPLATES.length}종 시드 완료`);
  } catch (e: any) {
    console.warn('[DM Template] 시드 실패:', e?.message);
  }
}

// ────────────── 템플릿에서 신규 DM 생성 ──────────────

export type NewDmFromTemplate = {
  title: string;
  store_name?: string;
  sections: Section[];
  brand_kit: DmBrandKit;
  template_id: string;
};

export function instantiateTemplate(template: DmTemplate, override?: { title?: string; storeName?: string; brandKit?: Partial<DmBrandKit> }): NewDmFromTemplate {
  // 섹션 ID를 새로 발급하여 독립된 DM 생성
  const cloned: Section[] = template.sections.map((s, i) => ({
    ...s,
    id: (globalThis.crypto?.randomUUID?.() || `new-${Date.now()}-${i}`),
    props: JSON.parse(JSON.stringify(s.props)),
    variable_fallbacks: s.variable_fallbacks ? JSON.parse(JSON.stringify(s.variable_fallbacks)) : [],
  }));

  return {
    title: override?.title || template.name,
    store_name: override?.storeName,
    sections: cloned,
    brand_kit: { ...(template.brand_kit || {}), ...(override?.brandKit || {}) } as DmBrandKit,
    template_id: template.id,
  };
}
