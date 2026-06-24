/**
 * dm-brand-extractor.ts — URL → 브랜드 메타 자동 추출
 *
 * 기능:
 *  1. URL fetch → HTML
 *  2. <meta>/<link> 파싱: og:title, og:image, og:site_name, theme-color, apple-touch-icon, favicon
 *  3. DmBrandKit 부분 반환 (사용자 확인 후 override)
 *
 * 정책:
 *  - User-Agent 설정 (일부 사이트가 봇 차단)
 *  - 5초 timeout
 *  - 리다이렉트 허용 (최대 3회)
 *  - 상대 URL은 base URL로 absolute 변환
 *
 * 소비처:
 *  - dm-brand-kit.ts의 suggestBrandKitFromUrl
 *  - routes/dm.ts POST /brand-kit/extract
 */
import type { DmBrandKit } from './dm-tokens';
export type BrandExtractResult = {
    site_name?: string;
    title?: string;
    description?: string;
    logo_url?: string;
    favicon_url?: string;
    og_image_url?: string;
    primary_color?: string;
    theme_color?: string;
    contact?: {
        phone?: string;
        email?: string;
        website?: string;
    };
    sns?: {
        instagram?: string;
        youtube?: string;
        kakao?: string;
        naver?: string;
    };
};
/**
 * URL에서 브랜드 메타 추출.
 * 실패 시 빈 객체 반환 (예외 throw 하지 않음).
 */
export declare function extractBrandFromUrl(targetUrl: string): Promise<BrandExtractResult>;
/**
 * BrandExtractResult → DmBrandKit 부분값으로 변환.
 * 사용자가 UI에서 확인 후 updateCompanyBrandKit으로 적용.
 */
export declare function toBrandKitPatch(result: BrandExtractResult): Partial<DmBrandKit>;
//# sourceMappingURL=dm-brand-extractor.d.ts.map