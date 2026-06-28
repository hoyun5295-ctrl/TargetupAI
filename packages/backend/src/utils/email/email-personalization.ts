/**
 * email-personalization.ts — 이메일 발송 시 수신자별 Section[] 개인화 (순수, DB import 0)
 *
 * - Liquid 변수({{ customer.X }}) 치환: CT-50 liquid-templating 엔진 재사용(인라인 치환 신설 0).
 * - 구조화 조건부 표시(display_condition) 평가: 충족 안 하는 수신자에겐 해당 섹션 제외.
 * 이메일은 신규 채널이라 옛 %변수%는 미지원(에디터 변수 칩이 Liquid 토큰을 삽입).
 * 발송 경로(email-channel / email-send-sweeper)가 renderEmailSections 직전 수신자별 호출.
 * config/database를 import하는 inapp-personalization은 의도적으로 피한다(검증 스크립트 process.exit 회피).
 */
import { renderLiquid, flattenCustomerForLiquid } from '../liquid-templating';
import type { Section } from '../dm/dm-section-registry';

// 이메일 화이트리스트 섹션의 치환 대상 string 필드(렌더되는 텍스트만).
const STRING_FIELD_KEYS: Record<string, string[]> = {
  header: ['brand_name'],
  hero: ['headline', 'sub_copy'],
  text_card: ['tag', 'headline', 'body'],
  coupon: ['discount_label', 'usage_condition'],
  promo_code: ['description', 'instructions'],
  store_info: ['address', 'business_hours'],
  footer: ['notes', 'legal_text'],
};

/** 단일 텍스트 Liquid 치환. Liquid 문법 없으면 원본 그대로(엔진이 통과). */
export function renderEmailText(text: string, customer: Record<string, any>): string {
  if (!text) return text;
  return renderLiquid(text, { customer: flattenCustomerForLiquid(customer) }).rendered;
}

/** 구조화 조건 평가 — 고객 필드 vs 값. 필드 없으면 빈 문자로 안전 비교. */
export function evalDisplayCondition(
  cond: NonNullable<Section['display_condition']>,
  customer: Record<string, any>,
): boolean {
  const raw = customer ? customer[cond.field] : undefined;
  const a = raw === undefined || raw === null ? '' : String(raw);
  const b = cond.value ?? '';
  switch (cond.op) {
    case 'eq': return a === b;
    case 'ne': return a !== b;
    case 'gt': return Number(a) > Number(b);
    case 'gte': return Number(a) >= Number(b);
    case 'lt': return Number(a) < Number(b);
    case 'lte': return Number(a) <= Number(b);
    case 'contains': return a.includes(b);
    default: return true;
  }
}

/**
 * 수신자별 섹션 해석 — visible=false·조건 불충족 섹션 제외 + 남은 섹션 string 필드 Liquid 치환.
 * 순수 함수(DB 0). 입력 sections는 변형하지 않고 새 배열 반환.
 */
export function resolveEmailSectionsForCustomer(
  sections: Section[],
  customer: Record<string, any>,
): Section[] {
  const out: Section[] = [];
  for (const s of sections || []) {
    if (s.visible === false) continue;
    if (s.display_condition && !evalDisplayCondition(s.display_condition, customer)) continue;
    const keys = STRING_FIELD_KEYS[s.type] || [];
    const props: any = { ...(s.props as any) };
    for (const k of keys) {
      if (typeof props[k] === 'string' && props[k]) {
        props[k] = renderEmailText(props[k], customer);
      }
    }
    // CTA 버튼 라벨도 치환
    if (s.type === 'cta' && Array.isArray(props.buttons)) {
      props.buttons = props.buttons.map((b: any) => ({
        ...b,
        label: b && typeof b.label === 'string' && b.label ? renderEmailText(b.label, customer) : b?.label,
      }));
    }
    out.push({ ...s, props });
  }
  return out;
}
