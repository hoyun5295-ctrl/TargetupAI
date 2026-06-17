/**
 * email-tokens.ts — 브랜드킷 → 이메일 인라인 값 해석 (단일 진입점)
 *
 * DM 디자인 토큰(리터럴 값)을 읽기 차용해, 이메일 렌더러가 인라인 style에 넣을
 * 실제 색/타이포/여백 값을 돌려준다. CSS 변수는 이메일에서 안 쓰므로 전부 리터럴.
 * 브랜드킷이 있으면 색·폰트를 override.
 */
import { DM_COLOR_TOKENS, DM_TYPOGRAPHY, DM_SPACING } from '../dm/dm-tokens';
import type { DmBrandKit } from '../dm/dm-tokens';

export interface EmailBrand {
  primary: string;
  primaryHover: string;
  accent: string;
  text: string;
  textMuted: string;
  bg: string;        // 바깥 배경
  cardBg: string;    // 본문 카드 배경
  border: string;
  fontFamily: string;
  mono: string;
  sp: typeof DM_SPACING;
  type: typeof DM_TYPOGRAPHY.scale;
  radius: { sm: string; md: string; lg: string };
}

/** 브랜드킷(snake_case 필드) → 이메일 인라인 값. 미설정 필드는 DM 기본 토큰. */
export function resolveEmailBrand(brandKit?: DmBrandKit | null): EmailBrand {
  const primary = brandKit?.primary_color || DM_COLOR_TOKENS.brand.primary;
  return {
    primary,
    primaryHover: brandKit?.primary_color ? darken(primary) : DM_COLOR_TOKENS.brand.primaryHover,
    accent: brandKit?.accent_color || DM_COLOR_TOKENS.brand.accent,
    text: DM_COLOR_TOKENS.neutral[800],
    textMuted: DM_COLOR_TOKENS.neutral[500],
    bg: brandKit?.background_color || DM_COLOR_TOKENS.neutral[100],
    cardBg: DM_COLOR_TOKENS.neutral[0],
    border: DM_COLOR_TOKENS.neutral[200],
    fontFamily: brandKit?.font_family || DM_TYPOGRAPHY.fontFamily.primary,
    mono: DM_TYPOGRAPHY.fontFamily.mono,
    sp: DM_SPACING,
    type: DM_TYPOGRAPHY.scale,
    radius: { sm: '8px', md: '12px', lg: '16px' },
  };
}

/** hover 색 — 명도 24 하강(결정적 변환, 임의 상수 아님). #rrggbb 외는 원본 반환. */
function darken(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, ((n >> 16) & 255) - 24);
  const g = Math.max(0, ((n >> 8) & 255) - 24);
  const b = Math.max(0, (n & 255) - 24);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}
