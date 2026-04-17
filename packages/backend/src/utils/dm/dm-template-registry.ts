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

export const DM_TEMPLATES: DmTemplate[] = [
  tpl(
    'new_product_beauty',
    'new_product', 'beauty',
    '뷰티 신상 런칭',
    '신상품 출시 예고 + 샘플 증정 홍보',
    buildSections(['header', 'hero', 'text_card', 'cta', 'store_info', 'footer']),
    { primary_color: '#ec4899', accent_color: '#fbcfe8', tone: 'elegant' },
    10,
  ),
  tpl(
    'discount_fashion',
    'discount', 'fashion',
    '시즌 세일 (패션)',
    '시즌 마감 전체 할인 + 쿠폰 코드 + 타이머',
    buildSections(['header', 'hero', 'coupon', 'countdown', 'cta', 'footer']),
    { primary_color: '#18181b', accent_color: '#fde68a', tone: 'urgent' },
    12,
  ),
  tpl(
    'urgent_today_close',
    'urgent', 'general',
    '오늘 자정 마감',
    '극단적 긴급성 + 쿠폰 + 1버튼 CTA',
    buildSections(['header', 'countdown', 'hero', 'coupon', 'cta', 'footer']),
    { primary_color: '#ef4444', tone: 'urgent' },
    15,
  ),
  tpl(
    'point_reminder_general',
    'point_reminder', 'general',
    '포인트 소멸 리마인드',
    '보유 포인트 재안내 + 사용 유도',
    buildSections(['header', 'text_card', 'promo_code', 'cta', 'footer']),
    { primary_color: '#3b82f6', tone: 'friendly' },
    6,
  ),
  tpl(
    'reactivation_beauty',
    'reactivation', 'beauty',
    '휴면 고객 재방문 (뷰티)',
    '그동안 안부 + 재방문 쿠폰',
    buildSections(['header', 'hero', 'text_card', 'coupon', 'cta', 'footer']),
    { primary_color: '#ec4899', tone: 'emotional' as any },
    7,
  ),
  tpl(
    'offline_driving_food',
    'offline_driving', 'food',
    '오프라인 매장 방문 유도 (푸드)',
    '매장 한정 혜택 + 위치 안내',
    buildSections(['header', 'hero', 'text_card', 'store_info', 'cta', 'footer']),
    { primary_color: '#ea580c', accent_color: '#fef3c7', tone: 'friendly' },
    8,
  ),
  tpl(
    'vip_exclusive_luxury',
    'vip', 'luxury',
    'VIP 전용 프라이빗 오퍼',
    '격조 있는 톤, 비공개 혜택',
    buildSections(['header', 'hero', 'promo_code', 'text_card', 'cta', 'store_info', 'footer']),
    { primary_color: '#1e3a8a', accent_color: '#d4af37', tone: 'premium' },
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
