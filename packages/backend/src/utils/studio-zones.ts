/**
 * studio-zones.ts — 이미지 스튜디오 서버 층의 자리 표 · 판 규칙(★ 2026-11-07 C112 · 설계서 docs/2026-11-07-c112-studio-brand-logo-design.md D5 · D6 · D7 · D14)
 *
 * 순수 함수만. 3순위 = 로고 칸 · V2 가 같은 파일에 가격 판 줄을 더한다(구역 표 두 벌 금지).
 * 화면은 서버가 돌려준 허용 모서리 · 크기 목록으로 그린다(화면 사본 0).
 */

export type LogoCorner = 'tl' | 'tr' | 'bl' | 'br';
export type LogoSize = 's' | 'm' | 'l';

/** 모서리 · 같은 조용함이면 이 순서(왼쪽 위 → 오른쪽 위 → 오른쪽 아래 → 왼쪽 아래) */
export const LOGO_CORNERS: readonly LogoCorner[] = ['tl', 'tr', 'br', 'bl'];
export const LOGO_SIZES: readonly LogoSize[] = ['s', 'm', 'l'];
/** 로고 폭 = 포스터 폭 비율(디자인 값) */
export const LOGO_WIDTH_RATIO: Readonly<Record<LogoSize, number>> = { s: 0.12, m: 0.18, l: 0.24 };
/** 로고 높이 상한 = 포스터 높이 비율(가로 · 세로로 긴 로고가 자리를 넘지 않게) */
export const LOGO_HEIGHT_RATIO: Readonly<Record<LogoSize, number>> = { s: 0.06, m: 0.09, l: 0.12 };
/** 모서리 여백 = 포스터 폭 비율 */
export const LOGO_MARGIN_RATIO = 0.04;
export const LOGO_DEFAULT_SIZE: LogoSize = 'm';
/** 판 여백 = 로고 높이 비율 · 판 둥글기 = 판 높이 비율(디자인 값) */
export const PLATE_PAD_RATIO = 0.22;
export const PLATE_RADIUS_RATIO = 0.25;

export function isLogoCorner(v: unknown): v is LogoCorner {
  return v === 'tl' || v === 'tr' || v === 'bl' || v === 'br';
}
export function isLogoSize(v: unknown): v is LogoSize {
  return v === 's' || v === 'm' || v === 'l';
}

/** 글 없는 판(인앱 글 얹기 장 · 아래 1/3 = 인앱 글 자리) = 위 두 모서리만 */
export function allowedLogoCorners(textless: boolean): LogoCorner[] {
  return textless ? ['tl', 'tr'] : [...LOGO_CORNERS];
}

/** 높이 상한까지만 맞춘 목표 상자(원본 1배 상한 전) */
function rawTarget(posterW: number, posterH: number, logoW: number, logoH: number, size: LogoSize): { width: number; height: number } {
  let width = Math.max(1, Math.round(posterW * LOGO_WIDTH_RATIO[size]));
  let height = Math.max(1, Math.round((width * logoH) / logoW));
  const maxH = Math.max(1, Math.round(posterH * LOGO_HEIGHT_RATIO[size]));
  if (height > maxH) {
    height = maxH;
    width = Math.max(1, Math.round((height * logoW) / logoH));
  }
  return { width, height };
}

/** 그 크기의 로고 상자 — 비율 유지 · 높이 상한 · 원본보다 크게 키우지 않는다 */
export function logoTargetSize(posterW: number, posterH: number, logoW: number, logoH: number, size: LogoSize): { width: number; height: number } {
  const t = rawTarget(posterW, posterH, logoW, logoH, size);
  if (t.width > logoW || t.height > logoH) return { width: logoW, height: logoH };
  return t;
}

/** 크기 칩 — 목표가 원본보다 크면 고를 수 없다(흐려진다) · 작게는 늘 고를 수 있다(원본 크기로 얹는다) */
export function logoSizeOptions(posterW: number, posterH: number, logoW: number, logoH: number): Array<{ id: LogoSize; ok: boolean }> {
  return LOGO_SIZES.map((id) => ({ id, ok: id === 's' || rawTarget(posterW, posterH, logoW, logoH, id).width <= logoW }));
}

/**
 * 모서리 자리 — 여백 = 포스터 폭 4% · 포스터 밖으로 나가지 않는다.
 *   ★ C118 safeEdge(0 ~ 0.5) = 축마다 비워 둘 가장자리 비율(인앱용 = 안전 칸 밖 · 가로 · 세로 따로) · 0 = 지금 그대로.
 */
export function logoPlacement(posterW: number, posterH: number, box: { width: number; height: number }, corner: LogoCorner, safeEdge = 0): { left: number; top: number } {
  const mx = safeEdge > 0 ? Math.ceil(posterW * safeEdge) : Math.round(posterW * LOGO_MARGIN_RATIO);
  const my = safeEdge > 0 ? Math.ceil(posterH * safeEdge) : mx;
  const left = corner === 'tl' || corner === 'bl' ? mx : posterW - mx - box.width;
  const top = corner === 'tl' || corner === 'tr' ? my : posterH - my - box.height;
  return {
    left: Math.max(0, Math.min(left, posterW - box.width)),
    top: Math.max(0, Math.min(top, posterH - box.height)),
  };
}

// ── 판 규칙(D7) ──────────────────────────────────────────────

/** WCAG 2.1 SC 1.4.11 비텍스트 대비 하한 */
export const LOGO_MIN_CONTRAST = 3;

/** sRGB 값(0 ~ 255) → 상대 휘도(WCAG) */
export function srgbLuminance(v255: number): number {
  const c = Math.max(0, Math.min(255, v255)) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** RGB → 상대 휘도(WCAG) */
export function rgbLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbLuminance(r) + 0.7152 * srgbLuminance(g) + 0.0722 * srgbLuminance(b);
}

export function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** 판이 필요한가 — 로고와 그 자리의 밝은 쪽(상위 10%) · 어두운 쪽(하위 10%) 대비가 하나라도 3:1 미만이면 판(어수선한 자리도 걸린다) */
export function needsPlate(logoLum: number, regionLowLum: number, regionHighLum: number): boolean {
  return contrastRatio(logoLum, regionLowLum) < LOGO_MIN_CONTRAST || contrastRatio(logoLum, regionHighLum) < LOGO_MIN_CONTRAST;
}

/** 판 색 = 흰색 · 짙은 남색 가운데 로고와 대비가 큰 쪽 */
export const PLATE_LIGHT = { r: 255, g: 255, b: 255, alpha: 0.92 } as const;
export const PLATE_DARK = { r: 15, g: 23, b: 42, alpha: 0.88 } as const;
export function plateTone(logoLum: number): 'light' | 'dark' {
  const light = contrastRatio(logoLum, rgbLuminance(PLATE_LIGHT.r, PLATE_LIGHT.g, PLATE_LIGHT.b));
  const dark = contrastRatio(logoLum, rgbLuminance(PLATE_DARK.r, PLATE_DARK.g, PLATE_DARK.b));
  return light >= dark ? 'light' : 'dark';
}
