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
  radius: { sm: string; md: string; lg: string; xl: string };
  // ── ★ 2026-07-07(5) 이메일 디자인 2.0 (인앱 2.0 톤 미러 — 추가 토큰, 기존 의미 불변) ──
  /** 강조색 연한 워시 (칩/쿠폰 면) — rgba */
  primarySoft: string;
  /** 강조색 대시 보더 색 (쿠폰 절취) — rgba */
  primaryDashed: string;
  /** primary 버튼 그라데이션 (background-image 값 — 미지원 클라이언트는 solid primary 폴백) */
  btnGrad: string;
  /** 카드 상단 브랜드 밴드 그라데이션 */
  bandGrad: string;
  /** 강조색 밴드/카운트다운 면 그라데이션 */
  heroGrad: string;
  /** 바깥 배경 (슬레이트 틴트 — brandKit.background_color 우선) */
  shellBg: string;
}

/** ★ 2026-07-07(5) 실측 발견 결함 수정 — 폰트 스택의 큰따옴표("Pretendard Variable")가
 *  style="..." 속성을 조기 종료시켜 HTML 파손 + 폰트 무효. 인라인 속성용은 작은따옴표로 치환. */
function inlineFont(stack: string): string {
  return stack.replace(/"/g, "'");
}

/** 브랜드킷(snake_case 필드) → 이메일 인라인 값. 미설정 필드는 DM 기본 토큰. */
export function resolveEmailBrand(brandKit?: DmBrandKit | null): EmailBrand {
  const primary = brandKit?.primary_color || DM_COLOR_TOKENS.brand.primary;
  return {
    primary,
    primaryHover: brandKit?.primary_color ? shift(primary, -24) : DM_COLOR_TOKENS.brand.primaryHover,
    accent: brandKit?.accent_color || DM_COLOR_TOKENS.brand.accent,
    text: DM_COLOR_TOKENS.neutral[800],
    textMuted: DM_COLOR_TOKENS.neutral[500],
    bg: brandKit?.background_color || DM_COLOR_TOKENS.neutral[100],
    cardBg: DM_COLOR_TOKENS.neutral[0],
    border: DM_COLOR_TOKENS.neutral[200],
    fontFamily: inlineFont(brandKit?.font_family || DM_TYPOGRAPHY.fontFamily.primary),
    mono: inlineFont(DM_TYPOGRAPHY.fontFamily.mono),
    sp: DM_SPACING,
    type: DM_TYPOGRAPHY.scale,
    radius: { sm: '8px', md: '12px', lg: '16px', xl: '20px' },
    primarySoft: withAlpha(primary, 0.08),
    primaryDashed: withAlpha(primary, 0.45),
    btnGrad: `linear-gradient(180deg,${shift(primary, 14)} 0%,${shift(primary, -28)} 100%)`,
    bandGrad: `linear-gradient(90deg,${primary} 0%,${shift(primary, 64)} 100%)`,
    heroGrad: `linear-gradient(135deg,${shift(primary, 18)} 0%,${primary} 55%,${shift(primary, -56)} 100%)`,
    shellBg: brandKit?.background_color || '#eef1f6',
  };
}

/** 명도 이동 — delta<0 = 어둡게, >0 = 밝게 (결정적 변환, 임의 상수 아님). #rrggbb 외는 원본 반환. */
function shift(hex: string, delta: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp(((n >> 16) & 255) + delta);
  const g = clamp(((n >> 8) & 255) + delta);
  const b = clamp((n & 255) + delta);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

/** hex + 알파 → rgba 문자열. #rrggbb 외는 원본 반환. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
