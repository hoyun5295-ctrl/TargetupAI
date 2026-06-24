import type { DmBrandKit } from './dm-tokens';
export declare const DEFAULT_BRAND_KIT: DmBrandKit;
export declare function getCompanyBrandKit(companyId: string): Promise<DmBrandKit>;
export declare function updateCompanyBrandKit(companyId: string, patch: Partial<DmBrandKit>): Promise<DmBrandKit>;
/** URL에서 메타 태그/로고/테마컬러 추출 → DmBrandKit 부분값 반환 (D126 V2) */
export declare function suggestBrandKitFromUrl(url: string): Promise<Partial<DmBrandKit>>;
/** 추출 결과 원본(프리뷰 포함)도 함께 반환 — 프론트에서 확인 UI에 사용 */
export declare function previewBrandExtract(url: string): Promise<{
    raw: import("./dm-brand-extractor").BrandExtractResult;
    patch: Partial<DmBrandKit>;
}>;
//# sourceMappingURL=dm-brand-kit.d.ts.map