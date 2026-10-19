/**
 * 구도가 안 읽는 값 — 그 구도에서 공용 속성 패널이 감추는 필드. **백엔드 원장의 사본이다.**
 *
 * 원본 = `packages/backend/src/utils/dm/dm-property-contract.ts` `DM_TREATMENT_HIDDEN`(감출 이유 · 판정은 백엔드 렌더 탐침이 소유).
 * ⛔ 이 파일을 손으로 고치지 마라. 백엔드 원장을 고치고 다시 옮긴다(어긋나면 `dm-editor-coverage.test.ts` 파리티가 깨진다).
 * 표 = 면(ssr = 모바일 DM · email = 이메일) → 블록 → 구도(그 블록의 구도 전부 · 빈 목록 = 감출 것 없음) → 감출 필드.
 */
// ★ 2026-10-19 B-1014-3⑦
export const DM_TREATMENT_HIDDEN_FIELDS: Record<'ssr' | 'email', Record<string, Record<string, readonly string[]>>> = /* JSON:BEGIN */{
  "ssr": {
    "hero": {
      "classic": ["overlay"],
      "full_bleed": ["overlay_gradient"],
      "split": ["focus", "headline_emphasis", "height", "image_fit", "overlay", "overlay_gradient"],
      "typographic": ["focus", "headline_emphasis", "height", "image_fit", "image_url", "overlay", "overlay_gradient"],
      "editorial_overlap": ["focus", "headline_emphasis", "height", "image_fit", "overlay", "overlay_gradient"]
    },
    "text_card": {
      "classic": [],
      "lead": ["image_position", "image_url"],
      "framed": ["image_position"],
      "quote": ["image_position", "image_url"]
    },
    "reviews": {
      "classic": [],
      "quote": ["reviews[].date", "show_average_rating"]
    },
    "coupon": {
      "classic": [],
      "ticket": ["button_color"],
      "spotlight": ["button_color"]
    },
    "gallery": {
      "classic": [],
      "mosaic": ["layout"]
    },
    "product_carousel": {
      "classic": [],
      "focus": ["show_indicator"],
      "list": ["show_indicator"]
    }
  },
  "email": {
    "hero": {
      "classic": [],
      "split": ["overlay", "overlay_gradient"],
      "typographic": ["focus", "height", "image_fit", "image_url", "overlay", "overlay_gradient"]
    }
  }
}/* JSON:END */;

/** 그 면 · 블록 · 구도에서 감출 필드. 표에 없는 구도(그 면이 안 쓰는 구도) = 그 면의 기본(classic)으로 그려지므로 classic 목록. */
export function treatmentHiddenFieldsFor(surface: 'ssr' | 'email', sectionType: string, treatment?: string): readonly string[] {
  const byTreatment = DM_TREATMENT_HIDDEN_FIELDS[surface][sectionType];
  if (!byTreatment) return [];
  return byTreatment[treatment || 'classic'] ?? byTreatment.classic ?? [];
}
