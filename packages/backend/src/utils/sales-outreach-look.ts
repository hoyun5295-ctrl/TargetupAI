/**
 * ★ 2026-09-05(3) AI 영업 아웃리치 — 룩(구도·배경면·아트디렉션) 결정적 배정 CT (순수 · DB 0 · AI 0 · 네트워크 0)
 * 설계 = docs/2026-09-05-ai-sales-outreach-refinement-design.md §22 C1 (브레인스토밍 5역할 수렴안)
 *
 * 왜 코드가 입히는가:
 * - 산출물 JSON에 구도 키(treatment·background)가 0건이라 두 렌더러가 가진 구도 분기(hero split·typographic ·
 *   carousel focus·list · coupon ticket·spotlight · cta bar · 배경면 soft·tint)가 한 번도 실행되지 않고 흰 면이 세로로 이어졌다.
 * - AI에게 구도를 시키면 허용표 밖 값이 fail-closed로 classic이 되어 조용히 사라진다(selectTreatment·selectEmailTreatment).
 *   룩은 재료 형태(이미지 비율·상품 수·섹션 순서)로 결정 가능한 규칙이라 코드가 입힌다.
 *
 * ⛔ 쓰는 자리 = **섹션 최상위 필드**(`section.treatment`·`section.background`). props에 쓰면 아무도 읽지 않는다
 *    (dm-section-renderer renderSection · email-section-renderer renderBlock 둘 다 최상위를 읽는다).
 * ⛔ 값은 각 채널 허용표(`TREATMENTS`·`EMAIL_TREATMENTS`)를 **import해서** 그 안에서만 고른다. 표에 없는 섹션·값은 건드리지 않는다.
 * ⛔ classic은 명시하지 않는다(미설정 = classic = 오늘 출력과 바이트 동일). 배정 표는 design-core/template-compilers.ts의
 *    기존 배정(hero typographic · text_card lead→framed · carousel focus+soft · coupon spotlight/ticket · cta bar)을 차용한다.
 * ⛔ brand_kit 키는 `OUTREACH_BRAND_KIT_KEYS` 화이트리스트뿐 — `logo_url`은 어떤 경우에도 넣지 않는다(불변 11 로고 픽셀 금지).
 * ⛔ 검증은 JSON 키 수가 아니라 렌더 HTML 지표(`data-treatment=` · `dm-bgx-` · 이메일 밴드 td)로 한다 — classic이면 attr을 붙이지 않으므로
 *    JSON만 세면 통과해도 화면은 그대로일 수 있다.
 */
import type { Section } from './dm/dm-section-registry';
import type { DmBrandKit } from './dm/dm-tokens';
import { TREATMENTS } from './dm/dm-art-direction';
import { EMAIL_TREATMENTS, EMAIL_BACKGROUNDS } from './email/email-blocks';
import { exemplarGroupOf } from './sales-outreach-exemplars';
import { getContrastRatio } from './dm/dm-tokens';

export type OutreachChannel = 'DM' | 'EMAIL';

/**
 * 아웃리치 DM 레이아웃 모드 = **scroll(세로 한 페이지)** 고정 — 적대 리뷰(0905(3)) 확정 2건의 뿌리.
 * 갤러리·상품이 있으면 공용 판정(decideLayoutMode)이 slides를 고르는데, slides는 뷰어가 갤러리를 한 장씩 별도 페이지로 펼치며
 * 그 과정에서 갤러리의 구도(mosaic)·link_url·alt를 버린다(dm-slides-expand) = C1·C2-1이 발행물에 도달하지 않는다. 또 슬라이드 넘김은
 * 뷰어 스크립트가 담당해 검토 화면의 sandbox iframe(스크립트 0)에서는 첫 장만 보인다. 제안 메일에 링크되는 샘플은 세로 스크롤이 자연스럽다.
 * 되돌리기 = 이 상수 하나(produce.ts가 pages·layout_mode에 같이 쓴다).
 */
export const OUTREACH_DM_LAYOUT_MODE: 'scroll' = 'scroll';

/** 흰 글자 대비 하한(dm-tokens.isBrandKitPrimaryAccessible과 같은 값) */
const PRIMARY_MIN_CONTRAST = 4.5;

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * ★ 0905(4) 브랜드 색 접근성 보정 — 브랜드 색이 흰 글자 대비 4.5 미만이면(이니스프리 초록 실측 2.6) 버리고 기본 보라 토큰이 나가
 * "템플릿 티"가 났다. 색상·채도는 두고 **명도만 단계적으로 낮춰** 대비를 넘기는 첫 색을 쓴다(브랜드 정체성 유지 · 결정적). 12단계 안에 못 넘기면 null.
 */
export function accessiblePrimaryOf(hex: string | null | undefined): string | null {
  const rgb = hex ? hexToRgb(hex) : null;
  if (!rgb) return null;
  let [r, g, b] = rgb;
  // 밝은 무채색(흰·연회색)은 브랜드 색이 아니다 — 어둡게 만들면 회색이 되어 통과해 버린다. 검정·짙은 회색은 정당한 브랜드 색(패션)이라 허용.
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx > 0 && (mx - mn) / mx < 0.1 && mx / 255 > 0.5) return null;
  for (let i = 0; i < 12; i++) {
    const cur = rgbToHex(r, g, b);
    if (getContrastRatio(cur, '#ffffff') >= PRIMARY_MIN_CONTRAST) return cur;
    r *= 0.88; g *= 0.88; b *= 0.88;
  }
  return null;
}

/** 이미지 URL → 실측 폭·높이(갤러리·상품 사본·포스터). 없는 URL = 비율 미상(가로형으로 간주하지 않는다). */
export type LookImageDims = Record<string, { width: number; height: number }>;

/** 두 채널이 함께 허용하는 배경면만 쓴다(DM BGX_KEYS ⊇ · EMAIL_BACKGROUNDS ⊇). dark·gradient·glass는 브랜드 색 대비를 코드가 못 잡아 제외. */
export const OUTREACH_BACKGROUNDS: readonly string[] = ['soft', 'tint'];

/** 가로형 판정 경계(폭/높이). 이 이상 = 가로 배너 → 사진 위 밴드(classic) · 미만 = 세로·정사각 → 분할(split). */
export const LANDSCAPE_RATIO = 1.25;

export type OutreachArtDirection = {
  typeScale: 'editorial' | 'bold' | 'minimal';
  headlineFont: 'sans' | 'serif';
  spacingDensity: 'compact' | 'standard' | 'airy';
  accentMotif: 'none' | 'rule' | 'index' | 'bracket' | 'dot';
  sectionDivider: 'none' | 'hairline' | 'gap' | 'rule';
};

/** 업종군(예시 3군과 같은 축) → DM·이메일 공통 아트디렉션. 결정적 표 — 감각치를 런타임에 만들지 않는다. */
export const OUTREACH_ART_DIRECTION: Record<'fashion' | 'beauty' | 'commerce', OutreachArtDirection> = {
  fashion:  { typeScale: 'editorial', headlineFont: 'sans', spacingDensity: 'airy',     accentMotif: 'rule', sectionDivider: 'hairline' },
  beauty:   { typeScale: 'minimal',   headlineFont: 'sans', spacingDensity: 'standard', accentMotif: 'none', sectionDivider: 'gap' }, // dot은 제목 끝 빨간 점이 문장부호처럼 보였다(이니스프리 육안)
  commerce: { typeScale: 'bold',      headlineFont: 'sans', spacingDensity: 'standard', accentMotif: 'rule', sectionDivider: 'hairline' },
};

export function outreachArtDirection(industry: string | null | undefined): OutreachArtDirection {
  return { ...OUTREACH_ART_DIRECTION[exemplarGroupOf(industry)] };
}

/** 아웃리치 DM brand_kit에 실을 수 있는 키 전부. 이 밖의 키(logo_url·font·contact·sns)는 만들지 않는다. */
export const OUTREACH_BRAND_KIT_KEYS: readonly string[] = ['primary_color', 'art_direction'];

/** brand_kit은 **항상** 만든다(art_direction 그릇). 대비 미달이면 primary_color만 뺀다(색은 토큰 기본으로 폴백 · renderDmTokensCss). */
export function buildOutreachBrandKit(accessiblePrimaryColor: string | null | undefined, industry: string | null | undefined): DmBrandKit {
  const kit: DmBrandKit = { art_direction: outreachArtDirection(industry) };
  if (accessiblePrimaryColor) kit.primary_color = accessiblePrimaryColor;
  for (const k of Object.keys(kit)) {
    if (!OUTREACH_BRAND_KIT_KEYS.includes(k)) delete (kit as Record<string, unknown>)[k];
  }
  return kit;
}

function ratioOf(url: string | null | undefined, dims: LookImageDims): number | null {
  if (!url) return null;
  const d = dims[url];
  if (!d || !(d.width > 0) || !(d.height > 0)) return null;
  return d.width / d.height;
}

/** 허용표 안에서만 구도를 고른다. 표에 없는 섹션·값 = undefined(건드리지 않음). classic은 반환하지 않는다. */
export function pickTreatment(channel: OutreachChannel, type: string, want: string): string | undefined {
  const table = channel === 'DM' ? TREATMENTS : EMAIL_TREATMENTS;
  const allowed = table[type];
  if (!allowed || want === 'classic') return undefined;
  return allowed.includes(want) ? want : undefined;
}

function pickBackground(channel: OutreachChannel, want: string): 'soft' | 'tint' | undefined {
  if (!OUTREACH_BACKGROUNDS.includes(want)) return undefined;
  if (channel === 'EMAIL' && !EMAIL_BACKGROUNDS.includes(want)) return undefined;
  return want as 'soft' | 'tint';
}

export interface OutreachLookStats {
  /** 구도(treatment)가 실린 섹션 수 — classic 명시는 세지 않는다 */
  treatments: number;
  /** 배경면(background)이 실린 섹션 수 */
  backgrounds: number;
  /** 배정 결과 목록(근거 패널·전후 대조용) `type#n:treatment/background` */
  assigned: string[];
}

/**
 * 룩 배정(순수). 입력 순서를 보존하고 섹션 최상위에 treatment·background만 덧쓴다(props 무변경).
 * 규칙(재료 형태로 결정 · 채널 허용표로 검증):
 *  - hero: 이미지 없음 → typographic · DM = 이미지가 있으면 항상 split(브랜드 색 밴드 위 헤드라인 + 배너 전체 · 잘림 0 · 배너 속 글씨 위에 글씨를 겹치지 않는다) · EMAIL = 세로·정사각 split · 가로 classic(낮은 박스)
 *  - text_card: 첫 번째 lead · 홀수 번째 framed · 그 밖 classic + soft(리듬)
 *  - product_carousel: 상품 2~3개 → focus · 4개 이상 → classic(2열 카드 스와이프 · 직원 실물 형태) · 첫 묶음 soft · list(작은 썸네일 행)는 쓰지 않는다
 *  - gallery(DM): 격자 배치에서만 3장 이상 + 첫 장 가로형 → mosaic(배너 통째 목록 list_1xN에는 얹지 않는다)
 *  - coupon: DM ticket · EMAIL spotlight
 *  - countdown(DM): banner
 *  - cta: 전부 bar(브랜드 색 풀폭) · 마지막 앞의 cta만 tint 밴드
 */
export function applyOutreachLook(sections: readonly Section[], channel: OutreachChannel, dims: LookImageDims): { sections: Section[]; stats: OutreachLookStats } {
  const list = Array.isArray(sections) ? sections.filter((s) => s && typeof s === 'object') : [];
  const ordinal: Record<string, number> = {};
  const lastCtaIdx = list.reduce((acc, s, i) => (s.type === 'cta' ? i : acc), -1);
  const stats: OutreachLookStats = { treatments: 0, backgrounds: 0, assigned: [] };
  const out = list.map((s, i): Section => {
    const type = String(s.type);
    const n = (ordinal[type] = (ordinal[type] || 0) + 1);
    const p: any = (s.props && typeof s.props === 'object') ? s.props : {};
    let treatment: string | undefined;
    let background: 'soft' | 'tint' | undefined;
    switch (type) {
      case 'hero': {
        const r = ratioOf(p.image_url, dims);
        if (!p.image_url) treatment = pickTreatment(channel, type, 'typographic');
        else if (channel === 'DM' || (r !== null && r < LANDSCAPE_RATIO)) treatment = pickTreatment(channel, type, 'split');
        break;
      }
      case 'text_card':
        if (n === 1) treatment = pickTreatment(channel, type, 'lead');
        else if (n % 2 === 1) treatment = pickTreatment(channel, type, 'framed');
        else background = pickBackground(channel, 'soft');
        break;
      case 'product_carousel': {
        // 상품 4개 이상 = classic(2열 카드 · 3개 초과면 가로 스와이프 + 점 = 직원 실물 형태) · 2~3개 = focus(첫 상품 대형). list(작은 썸네일 행)는 쓰지 않는다.
        const count = Array.isArray(p.products) ? p.products.length : 0;
        if (count > 0 && count < 4) treatment = pickTreatment(channel, type, 'focus');
        if (n === 1) background = pickBackground(channel, 'soft');
        break;
      }
      case 'gallery': {
        const imgs: any[] = Array.isArray(p.images) ? p.images : [];
        const r0 = ratioOf(imgs[0]?.url, dims);
        // 배너 통째 목록(list_1xN)에는 격자 구도를 얹지 않는다
        if (p.layout !== 'list_1xN' && imgs.length >= 3 && r0 !== null && r0 >= LANDSCAPE_RATIO) treatment = pickTreatment(channel, type, 'mosaic');
        break;
      }
      case 'coupon':
        treatment = pickTreatment(channel, type, channel === 'DM' ? 'ticket' : 'spotlight');
        break;
      case 'countdown':
        treatment = pickTreatment(channel, type, 'banner');
        break;
      case 'cta': {
        // 전부 큰 바(brand 색 풀폭 · 직원 실물 CTA 형태) · 마지막 앞의 CTA만 tint 밴드
        // ★ 2026-09-06 S2 라벨 13자 초과면 bar 배정을 건너뛴다(375폭 풀폭 바에서 굵은 한글 14자+는 2줄로 접힌다 · 공용 렌더러 무변경 · 기본 버튼 구도로 둔다)
        const labels: string[] = Array.isArray(p.buttons) ? p.buttons.map((b: any) => String(b?.label || '')) : [];
        if (!labels.some((l) => l.length > 13)) treatment = pickTreatment(channel, type, 'bar');
        if (i !== lastCtaIdx) background = pickBackground(channel, 'tint');
        break;
      }
      default:
        break;
    }
    if (!treatment && !background) return s;
    if (treatment) stats.treatments++;
    if (background) stats.backgrounds++;
    stats.assigned.push(`${type}#${n}:${treatment || '-'}/${background || '-'}`);
    return { ...s, ...(treatment ? { treatment } : {}), ...(background ? { background } : {}) } as Section;
  });
  return { sections: out, stats };
}

/** 이미 룩이 실린 섹션 배열의 통계(섹션 숨김 재실행처럼 배정을 다시 하지 않는 경로용). */
export function lookStatsOf(sections: readonly Section[]): OutreachLookStats {
  const ordinal: Record<string, number> = {};
  const stats: OutreachLookStats = { treatments: 0, backgrounds: 0, assigned: [] };
  for (const s of Array.isArray(sections) ? sections : []) {
    if (!s || typeof s !== 'object') continue;
    const type = String(s.type);
    const n = (ordinal[type] = (ordinal[type] || 0) + 1);
    const t = s.treatment && s.treatment !== 'classic' ? s.treatment : undefined;
    const b = s.background;
    if (!t && !b) continue;
    if (t) stats.treatments++;
    if (b) stats.backgrounds++;
    stats.assigned.push(`${type}#${n}:${t || '-'}/${b || '-'}`);
  }
  return stats;
}

/** 렌더 HTML에서 룩이 실제로 실렸는지 세는 지표(전후 대조·검증용 · 순수). */
export function countLookMarkers(html: string): { treatmentAttrs: number; dmBackgrounds: number; emailBands: number } {
  const h = String(html || '');
  return {
    treatmentAttrs: (h.match(/data-treatment="/g) || []).length,
    // 뷰어 CSS 정의(.dm-bgx-soft{…})가 아니라 마크업의 class 사용만 센다
    dmBackgrounds: (h.match(/class="[^"]*\bdm-bgx-(?:soft|tint|dark|gradient|glass)\b/g) || []).length,
    emailBands: (h.match(/<tr><td style="padding:0;background:/g) || []).length,
  };
}
