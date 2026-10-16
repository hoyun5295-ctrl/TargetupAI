/**
 * lib/studio-texts.ts — 이미지 스튜디오 포스터 문구 자동 채움 규칙 (2026-10-16 · 설계서 2026-10-16-image-studio-picker-channel §2-5)
 *
 * 스튜디오 제작 화면과 DM 삽입 창이 같은 규칙을 쓴다(두 창이 갈라진 뿌리 = 복사).
 * 템플릿·상품이 바뀌면 칸마다 「비어 있거나 직전 자동값 그대로인 칸」만 새 자동값으로 바꾼다.
 * 사람이 친 값 · 호출부가 넘긴 값(블록 제목)은 덮지 않는다. 옛 동작은 상품을 고르는 순간 친 문구를 통째로 지웠다.
 * 검증 = backend/src/utils/__tests__/image-studio-picker-channel-1016.test.ts
 */

export interface StudioTexts { label: string; title: string; subtitle: string }

export const EMPTY_STUDIO_TEXTS: StudioTexts = { label: '', title: '', subtitle: '' };

const KEYS = ['label', 'title', 'subtitle'] as const;

/** {productName}·{salePrice} 토큰 = 연동 몰 실데이터(사용자가 고칠 수 있다 · AI 임의 혜택 아님). 상품이 없으면 빈칸. */
export function fillStudioTokens(s: string | undefined | null, product: { name?: string | null; salePrice?: number | null } | null): string {
  return String(s || '')
    .replace(/\{productName\}/g, product?.name || '')
    .replace(/\{salePrice\}/g, product?.salePrice ? `${Math.round(Number(product.salePrice) || 0).toLocaleString()}원` : '');
}

/** 템플릿 기본 문구 → 이번 자동값 */
export function autoStudioTexts(
  defaults: { label?: string; title?: string; subtitle?: string } | null | undefined,
  product: { name?: string | null; salePrice?: number | null } | null,
): StudioTexts {
  return {
    label: fillStudioTokens(defaults?.label, product),
    title: fillStudioTokens(defaults?.title, product),
    subtitle: fillStudioTokens(defaults?.subtitle, product),
  };
}

/** 지금 값 · 직전 자동값 · 새 자동값 → 다음 값. 비어 있거나 직전 자동값 그대로인 칸만 바꾼다. */
export function applyAutoTexts(current: StudioTexts, prevAuto: StudioTexts, nextAuto: StudioTexts): StudioTexts {
  const out = { ...current };
  for (const k of KEYS) {
    if (!current[k] || current[k] === prevAuto[k]) out[k] = nextAuto[k];
  }
  return out;
}
