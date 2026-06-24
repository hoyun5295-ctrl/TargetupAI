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
export type PaperSizeKey = 'j1' | 'j2' | 'j4' | 'j8' | 'j16' | 'A3' | 'B4' | 'A4' | 'tabloid';
export type Orientation = 'portrait' | 'landscape';
export interface PaperSize {
    key: PaperSizeKey;
    label: string;
    labelKo: string;
    widthMm: number;
    heightMm: number;
    category: 'korean_traditional' | 'international' | 'tabloid';
    note?: string;
}
/** mm → px @ 300dpi */
export declare const MM_TO_PX_300DPI: number;
/** 인쇄 규약 */
export declare const PRINT_RULES: {
    readonly dpi: 300;
    readonly bleedMm: 3;
    readonly safeZoneMm: 5;
    readonly cropMarkLengthMm: 5;
};
/** 용지 규격 9종 */
export declare const PAPER_SIZES: Record<PaperSizeKey, PaperSize>;
/** 선택한 용지 + 방향에 따른 실제 치수(mm) 반환 */
export declare function getPaperDimensions(key: PaperSizeKey, orientation?: Orientation): {
    widthMm: number;
    heightMm: number;
    widthPx: number;
    heightPx: number;
};
/** Paged.js `@page` CSS 문자열 생성 */
export declare function buildPagedMediaCSS(key: PaperSizeKey, orientation?: Orientation, opts?: {
    marginMm?: number;
    bleed?: boolean;
}): string;
/** 용지 선택 드롭다운용 옵션 리스트 */
export declare function listPaperOptions(): Array<{
    key: PaperSizeKey;
    label: string;
    category: string;
}>;
//# sourceMappingURL=PAPER-SIZES.d.ts.map