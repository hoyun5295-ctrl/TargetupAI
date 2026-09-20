/**
 * sns-brand.ts — SNS 채널 브랜드 색·로고 글리프 원장 (2026-09-20 S1)
 *
 * 왜 따로 두나: 채널 카드·미리보기 프레임·이력 줄이 같은 색과 같은 글리프를 써야 한다.
 * 화면마다 손으로 적으면 갈라진다(허브 지면 5벌 사건과 같은 부류 · `operator-ui.ts` 머리말).
 *
 * 색은 **저장소가 이미 쓰는 값 그대로**다 — `components/dm/canvas/SnsSection.tsx` 의 `SNS_COLORS`
 * (인스타 #e1306c · 페북 #1877f2). 같은 브랜드가 화면마다 다른 색이면 그게 곧 어색함이다.
 * 다크 지면에서 검정이 브랜드색인 채널(Threads · X)은 흰색으로 둔다.
 *
 * ⛔ 로고는 **단순화한 글리프**다. 각 플랫폼 공식 로고 파일을 복제해 넣지 않는다 —
 *   브랜드 가이드가 변형을 제한하고, 우리 화면의 선 굵기·크기 체계와도 어긋난다.
 *
 * ⛔ Tailwind 클래스로 조립하지 않는다(완성 리터럴만 읽는다). 브랜드 색은 인라인 style 로 쓴다.
 */

export const SNS_BRAND_COLOR: Record<string, string> = {
  instagram: '#e1306c',
  threads: '#ffffff',
  facebook_page: '#1877f2',
  x: '#ffffff',
};

/** 채널 색. 목록에 없으면 액센트 바이올렛으로 떨어뜨린다(색이 없다고 카드가 깨지지 않게). */
export function snsBrandColor(platform: string): string {
  return SNS_BRAND_COLOR[platform] || '#8b5cf6';
}

/** 로고 글리프 path 데이터. `fill` = 면으로 그리는가, 아니면 선(stroke)으로 그리는가. */
export interface SnsGlyph {
  paths: string[];
  /** true = 면(fill), false = 선(stroke 1.9) */
  fill: boolean;
  /** 선으로 그릴 때 함께 찍는 점(인스타 렌즈 옆 점 같은 것) */
  dots?: { cx: number; cy: number; r: number }[];
}

export const SNS_GLYPH: Record<string, SnsGlyph> = {
  instagram: {
    fill: false,
    paths: ['M3 8.2A5.2 5.2 0 0 1 8.2 3h7.6A5.2 5.2 0 0 1 21 8.2v7.6A5.2 5.2 0 0 1 15.8 21H8.2A5.2 5.2 0 0 1 3 15.8z', 'M16.1 12a4.1 4.1 0 1 1-8.2 0 4.1 4.1 0 0 1 8.2 0z'],
    dots: [{ cx: 17.4, cy: 6.6, r: 1.1 }],
  },
  threads: {
    fill: false,
    paths: [
      'M16.3 11.4c-.2-3.6-2.4-5.3-4.6-5.3-2.4 0-4 1.6-4.3 3',
      'M12 18.4c-3.3 0-5.6-2.4-5.6-6.4S8.7 5.6 12 5.6c3.6 0 5.8 2.3 5.8 6.4 0 3.1-1.4 4.8-3.3 4.8-1.5 0-2.5-1-2.5-2.3 0-1.5 1.2-2.4 3-2.4 2.4 0 3.9 1.3 3.9 3.4 0 2.4-2.1 3.9-4.9 3.9z',
    ],
  },
  facebook_page: {
    fill: true,
    paths: ['M13.6 21v-7.9h2.7l.4-3.1h-3.1V8c0-.9.25-1.5 1.55-1.5h1.65V3.7c-.3 0-1.3-.13-2.45-.13-2.4 0-4.05 1.47-4.05 4.18V10H7.6v3.1h2.7V21h3.3z'],
  },
  x: {
    fill: true,
    paths: ['M17.5 3h3.1l-6.8 7.8L21.8 21h-6.2l-4.9-6.4L5 21H1.9l7.3-8.3L1.5 3h6.4l4.4 5.8L17.5 3zm-1.1 16.1h1.7L7.7 4.8H5.9l10.5 14.3z'],
  },
};
