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
  /**
   * ★ 2026-07-16 자가 호스팅(궁서 폴백 사고 정정) — 우리 서버에서 직접 서빙하는 woff2 메타.
   * null = 자가 호스팅 안 함(Pretendard = 시스템/별도 CDN, google:null과 동일 취급).
   * fileId = assets/dm-fonts/<fileId>-<subset>-<weight>.woff2 파일 접두어(@fontsource 패키지명).
   * weights = 자가 호스팅 가중치(scripts/fetch-dm-fonts.mjs MANIFEST와 동일 — 값 변경 시 재fetch 필수).
   */
  selfHost: { fileId: string; weights: number[] } | null;
}

export const CORE_FONTS: readonly CoreFont[] = [
  {
    id: 'pretendard', label: '프리텐다드 (기본)', match: 'Pretendard',
    css: '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    emailCss: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif",
    google: null,
    selfHost: null,
  },
  {
    id: 'noto-serif', label: '노토 세리프 (명조)', match: 'Noto Serif KR',
    css: '"Noto Serif KR", serif',
    emailCss: "'Noto Serif KR', 'Nanum Myeongjo', 'AppleMyungjo', Batang, Georgia, serif",
    google: 'Noto+Serif+KR:wght@400;600;700;900',
    selfHost: { fileId: 'noto-serif-kr', weights: [400, 700, 900] },
  },
  {
    id: 'nanum-myeongjo', label: '나눔명조', match: 'Nanum Myeongjo',
    css: '"Nanum Myeongjo", serif',
    emailCss: "'Nanum Myeongjo', 'Noto Serif KR', 'AppleMyungjo', Batang, Georgia, serif",
    google: 'Nanum+Myeongjo:wght@400;700;800',
    selfHost: { fileId: 'nanum-myeongjo', weights: [400, 700, 800] },
  },
  {
    id: 'gowun-batang', label: '고운바탕 (부드러운 명조)', match: 'Gowun Batang',
    css: '"Gowun Batang", serif',
    emailCss: "'Gowun Batang', 'Nanum Myeongjo', 'AppleMyungjo', Batang, Georgia, serif",
    google: 'Gowun+Batang:wght@400;700',
    selfHost: { fileId: 'gowun-batang', weights: [400, 700] },
  },
  {
    id: 'gowun-dodum', label: '고운돋움', match: 'Gowun Dodum',
    css: '"Gowun Dodum", sans-serif',
    emailCss: "'Gowun Dodum', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif",
    google: 'Gowun+Dodum',
    selfHost: { fileId: 'gowun-dodum', weights: [400] },
  },
  {
    id: 'black-han', label: '검은고딕 (임팩트)', match: 'Black Han Sans',
    css: '"Black Han Sans", sans-serif',
    emailCss: "'Black Han Sans', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif",
    google: 'Black+Han+Sans',
    selfHost: { fileId: 'black-han-sans', weights: [400] },
  },
  // ── 2026-07-16 무료 글꼴 확장 (6→12) — 전부 OFL/무료·한글 지원, 자가 호스팅 ──
  {
    id: 'noto-sans-kr', label: '노토 산스 (고딕)', match: 'Noto Sans KR',
    css: '"Noto Sans KR", sans-serif',
    emailCss: "'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
    google: 'Noto+Sans+KR:wght@400;500;700;900',
    selfHost: { fileId: 'noto-sans-kr', weights: [400, 500, 700, 900] },
  },
  {
    id: 'ibm-plex-sans-kr', label: 'IBM 플렉스 산스', match: 'IBM Plex Sans KR',
    css: '"IBM Plex Sans KR", sans-serif',
    emailCss: "'IBM Plex Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif",
    google: 'IBM+Plex+Sans+KR:wght@400;500;700',
    selfHost: { fileId: 'ibm-plex-sans-kr', weights: [400, 500, 700] },
  },
  {
    id: 'gothic-a1', label: '고딕 A1', match: 'Gothic A1',
    css: '"Gothic A1", sans-serif',
    emailCss: "'Gothic A1', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif",
    google: 'Gothic+A1:wght@400;700;900',
    selfHost: { fileId: 'gothic-a1', weights: [400, 700, 900] },
  },
  {
    id: 'nanum-gothic', label: '나눔고딕', match: 'Nanum Gothic',
    css: '"Nanum Gothic", sans-serif',
    emailCss: "'Nanum Gothic', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif",
    google: 'Nanum+Gothic:wght@400;700;800',
    selfHost: { fileId: 'nanum-gothic', weights: [400, 700, 800] },
  },
  {
    id: 'jua', label: '주아 (둥근 제목)', match: 'Jua',
    css: '"Jua", sans-serif',
    emailCss: "'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif",
    google: 'Jua',
    selfHost: { fileId: 'jua', weights: [400] },
  },
  {
    id: 'do-hyeon', label: '도현 (각진 제목)', match: 'Do Hyeon',
    css: '"Do Hyeon", sans-serif',
    emailCss: "'Do Hyeon', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif",
    google: 'Do+Hyeon',
    selfHost: { fileId: 'do-hyeon', weights: [400] },
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

// ────────────── 자가 호스팅 @font-face (2026-07-16) ──────────────
//
// 배경: 발행 DM/이메일 헤드라인 서체(명조 등)를 구글 Fonts CDN에서 불러오다 수신 단말·망에서
//   미로드 → serif 제네릭(궁서)로 폴백되는 신고(박성용). 우리 서버가 직접 woff2를 서빙하면
//   제3자 CDN 의존/미로드가 사라지고 편집 캔버스·발행 뷰어·이메일이 같은 파일을 쓴다.
// woff2 파일: packages/backend/assets/dm-fonts/<fileId>-<subset>-<weight>.woff2 (scripts/fetch-dm-fonts.mjs).

/** 라틴(영문/숫자/기본기호) 서브셋 unicode-range — "2026 SUMMER NEW" 등은 작은 라틴 파일로. */
export const SELF_HOST_LATIN_RANGE =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
/** 한글(음절+자모+호환+괄호기호+전각) 서브셋 unicode-range. */
export const SELF_HOST_KOREAN_RANGE =
  'U+1100-11FF,U+3000-303F,U+3130-318F,U+3200-321E,U+3260-327F,U+A960-A97F,U+AC00-D7A3,U+D7B0-D7FF,U+FF00-FFEF';

function selfHostFace(family: string, weight: number, url: string, range: string): string {
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(${url}) format('woff2');unicode-range:${range};}`;
}

/**
 * 자가 호스팅 @font-face CSS — selfHost 서체 전량을 라틴/한글 서브셋 × 가중치로 선언.
 * urlBase = woff2 디렉터리 경로 접두어(끝 / 제거). 예: 'fonts'(fonts.css 기준 상대) 또는 절대 URL.
 * 선언만 하며 실제 woff2는 브라우저가 "폰트 실사용 + 코드포인트 매칭" 시에만 받음(미사용 서체 무다운로드).
 */
export function renderSelfHostFontFaceCss(urlBase: string): string {
  const base = urlBase.replace(/\/+$/, '');
  const faces: string[] = [];
  for (const c of CORE_FONTS) {
    if (!c.selfHost) continue;
    const family = c.match; // css 첫 패밀리명 = 렌더러가 참조하는 이름
    for (const w of c.selfHost.weights) {
      faces.push(selfHostFace(family, w, `${base}/${c.selfHost.fileId}-latin-${w}.woff2`, SELF_HOST_LATIN_RANGE));
      faces.push(selfHostFace(family, w, `${base}/${c.selfHost.fileId}-korean-${w}.woff2`, SELF_HOST_KOREAN_RANGE));
    }
  }
  return faces.join('\n');
}

/** font-family 문자열(들)이 가리키는 자가 호스팅 서체의 대표(한글) woff2 URL — 뷰어 <link rel=preload>용. */
export function selfHostPreloadUrls(urlBase: string, ...families: Array<string | undefined | null>): string[] {
  const base = urlBase.replace(/\/+$/, '');
  const urls: string[] = [];
  for (const f of families) {
    if (!f) continue;
    for (const c of CORE_FONTS) {
      if (!c.selfHost) continue;
      if (!f.includes(c.match)) continue;
      const w = c.selfHost.weights.includes(700) ? 700 : c.selfHost.weights[0];
      const u = `${base}/${c.selfHost.fileId}-korean-${w}.woff2`;
      if (!urls.includes(u)) urls.push(u);
    }
  }
  return urls;
}
