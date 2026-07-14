/**
 * ★ CT design-core/fonts.ts — 3채널 공용 서체 카탈로그 (디자인 4.0 M1, 2026-07-14)
 *
 * 2026-07-14 실측: 같은 6종 카탈로그가 5벌(BE dm-tokens · FE dm-tokens · BE email-tokens ·
 * SDK inapp-theme · FE blockTheme)로 존재 — 이 파일이 단일 소유자가 되고,
 * backend 2벌은 M2에서 이 파일을 소비, FE·SDK 미러는 M3 동기 테스트로 기계 고정.
 *
 * css      = DM·인앱 공용 font-family 문자열 (brandKit.font_family 저장값 하위호환)
 * emailCss = 이메일 가지 — 웹폰트 미지원 클라이언트 대비 한국어 시스템 폴백 스택
 * match    = 저장된 font-family 문자열에서 이 서체를 식별하는 대표 패밀리명
 * google   = Google Fonts css2 파라미터 (null = 별도 로드 불필요)
 */

export interface CoreFont {
  id: string;
  label: string;
  match: string;
  css: string;
  emailCss: string;
  google: string | null;
}

export const CORE_FONTS: readonly CoreFont[] = [
  {
    id: 'pretendard', label: '프리텐다드 (기본)', match: 'Pretendard',
    css: '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    emailCss: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif",
    google: null,
  },
  {
    id: 'noto-serif', label: '노토 세리프 (명조)', match: 'Noto Serif KR',
    css: '"Noto Serif KR", serif',
    emailCss: "'Noto Serif KR', 'Nanum Myeongjo', 'AppleMyungjo', Batang, Georgia, serif",
    google: 'Noto+Serif+KR:wght@400;600;700;900',
  },
  {
    id: 'nanum-myeongjo', label: '나눔명조', match: 'Nanum Myeongjo',
    css: '"Nanum Myeongjo", serif',
    emailCss: "'Nanum Myeongjo', 'Noto Serif KR', 'AppleMyungjo', Batang, Georgia, serif",
    google: 'Nanum+Myeongjo:wght@400;700;800',
  },
  {
    id: 'gowun-batang', label: '고운바탕 (부드러운 명조)', match: 'Gowun Batang',
    css: '"Gowun Batang", serif',
    emailCss: "'Gowun Batang', 'Nanum Myeongjo', 'AppleMyungjo', Batang, Georgia, serif",
    google: 'Gowun+Batang:wght@400;700',
  },
  {
    id: 'gowun-dodum', label: '고운돋움', match: 'Gowun Dodum',
    css: '"Gowun Dodum", sans-serif',
    emailCss: "'Gowun Dodum', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif",
    google: 'Gowun+Dodum',
  },
  {
    id: 'black-han', label: '검은고딕 (임팩트)', match: 'Black Han Sans',
    css: '"Black Han Sans", sans-serif',
    emailCss: "'Black Han Sans', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif",
    google: 'Black+Han+Sans',
  },
];

/**
 * font-family 문자열(들) → Google Fonts css2 URL. 카탈로그 매칭 0건 = null (로드 안 함).
 * DM(dmGoogleFontsUrl)·인앱(inappGoogleFontsUrl)과 동일 규약 — 화이트리스트 밖 문자열로
 * 외부 URL을 만들지 않는다.
 */
export function coreGoogleFontsUrl(...families: Array<string | undefined | null>): string | null {
  const params: string[] = [];
  for (const f of families) {
    if (!f) continue;
    for (const c of CORE_FONTS) {
      if (!c.google) continue;
      const first = c.css.split(',')[0].replace(/"/g, '').trim();
      if (f.includes(first) && !params.includes(c.google)) params.push(c.google);
    }
  }
  if (params.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${params.map((p) => `family=${p}`).join('&')}&display=swap`;
}
