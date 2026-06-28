/**
 * email-section-refine.ts — 비주얼 에디터 "AI로 개선" 순수 코어 (DB import 0, TDD 대상)
 *
 * - 다듬는 대상은 마케팅 카피 필드만(hero/ text_card 텍스트 + cta 버튼 라벨).
 *   혜택(coupon/promo_code)·법적/사실(footer legal·store_info)·브랜드명(header)은 제외 — 사실 변경 0.
 * - AI가 돌려준 텍스트는 안전 검증(변수 토큰 보존·혜택 자리표시자 보존·빈 결과 거부)을 통과한 것만 반영.
 *   하나라도 어기면 그 필드는 원본 유지(임의 혜택·변수 손실 차단).
 * - AI 호출 자체(브랜드 보이스 의존)는 email-ai.ts의 refineEmailSections가 담당. 이 파일은 순수.
 */
import type { Section } from '../dm/dm-section-registry';

// 다듬어도 안전한 마케팅 카피 필드(사실·혜택·법적 텍스트 제외).
export const REFINABLE_FIELD_KEYS: Record<string, string[]> = {
  hero: ['headline', 'sub_copy'],
  text_card: ['tag', 'headline', 'body'],
};

export type RefineSlot =
  | { si: number; kind: 'prop'; key: string; original: string }
  | { si: number; kind: 'button'; idx: number; original: string };

/** 다듬을 텍스트 조각을 결정적 순서로 수집(숨김 섹션·빈 문자열 제외). */
export function collectRefinableTexts(sections: Section[]): { slots: RefineSlot[]; texts: string[] } {
  const slots: RefineSlot[] = [];
  const texts: string[] = [];
  (sections || []).forEach((s, si) => {
    if (!s || s.visible === false) return;
    const props: any = s.props || {};
    const keys = REFINABLE_FIELD_KEYS[s.type] || [];
    for (const key of keys) {
      const v = props[key];
      if (typeof v === 'string' && v.trim()) {
        slots.push({ si, kind: 'prop', key, original: v });
        texts.push(v);
      }
    }
    if (s.type === 'cta' && Array.isArray(props.buttons)) {
      props.buttons.forEach((b: any, idx: number) => {
        if (b && typeof b.label === 'string' && b.label.trim()) {
          slots.push({ si, kind: 'button', idx, original: b.label });
          texts.push(b.label);
        }
      });
    }
  });
  return { slots, texts };
}

/** 다듬은 텍스트 안전 검증 — 빈 결과·변수 토큰 누락·혜택 자리표시자 손실은 거부. */
export function isRefinedTextSafe(original: string, refined: unknown): boolean {
  if (typeof refined !== 'string' || !refined.trim()) return false;
  // {{ ... }} 변수 토큰은 글자 그대로 보존돼야
  const vars = original.match(/\{\{[^}]*\}\}/g) || [];
  for (const v of vars) { if (!refined.includes(v)) return false; }
  // [ ...직접... ] 형태 혜택 자리표시자 보존
  const placeholders = original.match(/\[[^\]]*직접[^\]]*\]/g) || [];
  for (const p of placeholders) { if (!refined.includes(p)) return false; }
  return true;
}

/** 안전 통과분만 교체한 새 Section[] 반환(원본 불변). slots[k] ↔ refined[k] 정렬. */
export function applyRefinedTexts(sections: Section[], slots: RefineSlot[], refined: string[]): Section[] {
  const out: Section[] = (sections || []).map((s) => ({ ...s, props: JSON.parse(JSON.stringify(s.props ?? {})) }));
  slots.forEach((slot, k) => {
    const r = refined[k];
    if (!isRefinedTextSafe(slot.original, r)) return; // 안전 실패 → 원본 유지
    const sec: any = out[slot.si];
    if (!sec) return;
    if (slot.kind === 'prop') {
      sec.props[slot.key] = r;
    } else if (Array.isArray(sec.props.buttons) && sec.props.buttons[slot.idx]) {
      sec.props.buttons[slot.idx] = { ...sec.props.buttons[slot.idx], label: r };
    }
  });
  return out;
}
