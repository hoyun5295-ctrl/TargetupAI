"use strict";
/**
 * ★ 인쇄전단 V2 (D129) — 용지 규격 9종
 *
 * 한국 마트/전단 실무 규격 전수 커버:
 *   1절(전지)     788 × 1091 mm — 대형마트 메인
 *   2절            545 × 788  mm — 동네마트 표준 (최다 사용) ★ V1 누락 → V2 신규
 *   4절            394 × 545  mm — 중형
 *   A3             297 × 420  mm — 국제규격 대형
 *   B4             257 × 364  mm — 국제규격 중형
 *   A4             210 × 297  mm — 소형
 *   8절            272 × 394  mm — 한국전통 (V1 370×260 오류 → V2 수정)
 *   16절           137 × 197  mm — DM/쿠폰
 *   타블로이드     279 × 432  mm — 신문형
 *
 * 세로(portrait) / 가로(landscape) 전부 지원. 동일 템플릿 공유.
 *
 * 인쇄 규약:
 *   - DPI: 300 (상업 인쇄 표준)
 *   - 1mm = 300 / 25.4 = 11.811 px @ 300dpi
 *   - 출혈(bleed): 3mm (재단 여유)
 *   - 안전선(safe zone): 5mm (텍스트/중요요소 안쪽 유지)
 *
 * Paged.js `@page { size: Wmm Hmm; }` 로 바인딩.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAPER_SIZES = exports.PRINT_RULES = exports.MM_TO_PX_300DPI = void 0;
exports.getPaperDimensions = getPaperDimensions;
exports.buildPagedMediaCSS = buildPagedMediaCSS;
exports.listPaperOptions = listPaperOptions;
/** mm → px @ 300dpi */
exports.MM_TO_PX_300DPI = 300 / 25.4; // 11.8110236220...
/** 인쇄 규약 */
exports.PRINT_RULES = {
    dpi: 300,
    bleedMm: 3,
    safeZoneMm: 5,
    cropMarkLengthMm: 5,
};
/** 용지 규격 9종 */
exports.PAPER_SIZES = {
    j1: {
        key: 'j1',
        label: '1-jeol (Full sheet)',
        labelKo: '1절 (전지)',
        widthMm: 788,
        heightMm: 1091,
        category: 'korean_traditional',
        note: '대형마트 메인 전단',
    },
    j2: {
        key: 'j2',
        label: '2-jeol',
        labelKo: '2절',
        widthMm: 545,
        heightMm: 788,
        category: 'korean_traditional',
        note: '★ 동네마트 실무 표준 — 가장 많이 사용',
    },
    j4: {
        key: 'j4',
        label: '4-jeol',
        labelKo: '4절',
        widthMm: 394,
        heightMm: 545,
        category: 'korean_traditional',
        note: '중형 전단',
    },
    j8: {
        key: 'j8',
        label: '8-jeol',
        labelKo: '8절',
        widthMm: 272,
        heightMm: 394,
        category: 'korean_traditional',
        note: '소형 전단 (V1 370×260 오류 수정)',
    },
    j16: {
        key: 'j16',
        label: '16-jeol',
        labelKo: '16절',
        widthMm: 137,
        heightMm: 197,
        category: 'korean_traditional',
        note: 'DM/쿠폰/할인권',
    },
    A3: {
        key: 'A3',
        label: 'A3',
        labelKo: 'A3',
        widthMm: 297,
        heightMm: 420,
        category: 'international',
    },
    B4: {
        key: 'B4',
        label: 'B4',
        labelKo: 'B4',
        widthMm: 257,
        heightMm: 364,
        category: 'international',
    },
    A4: {
        key: 'A4',
        label: 'A4',
        labelKo: 'A4',
        widthMm: 210,
        heightMm: 297,
        category: 'international',
        note: '소형 전단/포스터',
    },
    tabloid: {
        key: 'tabloid',
        label: 'Tabloid',
        labelKo: '타블로이드',
        widthMm: 279,
        heightMm: 432,
        category: 'tabloid',
        note: '신문형',
    },
};
/** 선택한 용지 + 방향에 따른 실제 치수(mm) 반환 */
function getPaperDimensions(key, orientation = 'portrait') {
    const p = exports.PAPER_SIZES[key];
    const [w, h] = orientation === 'landscape'
        ? [p.heightMm, p.widthMm]
        : [p.widthMm, p.heightMm];
    return {
        widthMm: w,
        heightMm: h,
        widthPx: Math.round(w * exports.MM_TO_PX_300DPI),
        heightPx: Math.round(h * exports.MM_TO_PX_300DPI),
    };
}
/** Paged.js `@page` CSS 문자열 생성 */
function buildPagedMediaCSS(key, orientation = 'portrait', opts) {
    const { widthMm, heightMm } = getPaperDimensions(key, orientation);
    const margin = opts?.marginMm ?? 0;
    const bleed = opts?.bleed ? `bleed: ${exports.PRINT_RULES.bleedMm}mm;` : '';
    return `
@page {
  size: ${widthMm}mm ${heightMm}mm;
  margin: ${margin}mm;
  ${bleed}
  marks: ${opts?.bleed ? 'crop cross' : 'none'};
}
`.trim();
}
/** 용지 선택 드롭다운용 옵션 리스트 */
function listPaperOptions() {
    return Object.values(exports.PAPER_SIZES).map(p => ({
        key: p.key,
        label: `${p.labelKo} (${p.widthMm}×${p.heightMm}mm)${p.note ? ` — ${p.note}` : ''}`,
        category: p.category,
    }));
}
//# sourceMappingURL=PAPER-SIZES.js.map