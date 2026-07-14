/**
 * DM 속성 계약 (SoT) — 편집기가 노출하는 속성이 발행물(SSR·CSS)에 실제로 반영되는지 기계로 검증하는 근거표.
 *
 * ★ 2026-07-14 신설 — 재발 방지책 1 ("편집기 ≠ 발행" 이음새 차단).
 *   배경: 0713~0714 디자인 3.0/4.0 대개편에서 연결부 색(#2)·줄바꿈(#3)·폰트(#5)·그라데이션 2색(#6) 등
 *   "편집기에서 고를 수 있는데 발행물엔 반영 안 되는" 이음새가 반복. 스냅샷 테스트는 "렌더됨"만 보고
 *   "속성이 실제로 소비되는가"는 못 잡는다. 이 표를 근거로 dm-editor-parity.test.ts가 각 속성의 소비를 강제한다.
 *
 * 규칙: 편집기에 새 속성/옵션(배경면·연결부·구도·텍스트 필드 등)을 추가하면 반드시 이 표에 등재한다.
 *   → 등재하면 파리티 테스트가 "그 값이 SSR/CSS 출력에서 실제로 달라지는지"를 밟아 미소비를 배포 전 차단한다.
 *   (DmRightPanel BACKGROUND_OPTIONS/DIVIDER_OPTIONS/TREATMENT_OPTIONS 와 값이 일치해야 한다.)
 */

/** 배경면 옵션 — 각 값은 CSS에서 자체 배경 + 연결부(divider) 착색 규칙을 가져야 한다(연결부가 보이려면 섹션 실제 색으로 착색). */
export const DM_BACKGROUNDS = ['soft', 'tint', 'dark', 'gradient', 'glass'] as const;

/** 하단 연결부 모양 — 각 값은 SSR/캔버스에서 SVG(dm-divider-svg)로 방출돼야 한다. */
export const DM_DIVIDERS = ['wave', 'slant', 'curve'] as const;

/** 개행 반영 대상 — (섹션타입 × 구도 × 텍스트 필드): 이 조합에서 입력 개행이 발행물에 보존돼야 한다.
 *  헤드라인/서브카피 = `\n→<br>`, 본문 = `white-space:pre-wrap`. 한 구도라도 빠지면 "편집기는 2줄, 발행물은 1줄" 불일치. */
export const DM_NEWLINE_FIELDS: Array<{ type: string; treatment?: string; field: 'headline' | 'sub_copy' | 'body' }> = [
  { type: 'hero', treatment: 'classic', field: 'headline' },
  { type: 'hero', treatment: 'typographic', field: 'headline' },
  { type: 'hero', treatment: 'full_bleed', field: 'headline' },
  { type: 'hero', treatment: 'split', field: 'headline' },
  { type: 'hero', treatment: 'editorial_overlap', field: 'headline' },
  { type: 'hero', treatment: 'classic', field: 'sub_copy' },
  { type: 'hero', treatment: 'typographic', field: 'sub_copy' },
  { type: 'hero', treatment: 'full_bleed', field: 'sub_copy' },
  { type: 'hero', treatment: 'split', field: 'sub_copy' },
  { type: 'hero', treatment: 'editorial_overlap', field: 'sub_copy' },
  { type: 'text_card', treatment: 'classic', field: 'headline' },
  { type: 'text_card', treatment: 'lead', field: 'headline' },
  { type: 'text_card', treatment: 'framed', field: 'headline' },
  { type: 'text_card', treatment: 'quote', field: 'headline' },
  { type: 'text_card', treatment: 'classic', field: 'body' },
  { type: 'text_card', treatment: 'lead', field: 'body' },
  { type: 'text_card', treatment: 'framed', field: 'body' },
  { type: 'text_card', treatment: 'quote', field: 'body' },
];

/** 상품 이미지 맞춤 — cover/contain이 발행물 출력에서 실제로 달라져야 한다(#1 회귀 차단). */
export const DM_IMAGE_FITS = ['cover', 'contain'] as const;
