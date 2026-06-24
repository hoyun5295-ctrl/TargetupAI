/**
 * ★ CT-F14 — 전단AI 템플릿 렌더링 엔진 V3
 *
 * 전단지 공개 페이지 HTML 렌더링의 유일한 진입점.
 * short-urls.ts에서 호출: renderTemplate(templateCode, data)
 *
 * V3 아키텍처: 4개 완전히 다른 레이아웃 엔진 + 테마별 색상 교체.
 *  ① renderGridEngine    — 2열 그리드 카드 (grid, mart_fresh, mart_weekend, mart_clearance, butcher_daily)
 *  ② renderMagazineEngine — 1열 매거진형 (magazine, butcher_premium)
 *  ③ renderEditorialEngine — 에디토리얼 풀블리드 (editorial, mart_seasonal)
 *  ④ renderShowcaseEngine  — 대형 쇼케이스 (showcase, highlight, butcher_bulk)
 *
 * 신규 필드: unit(규격), origin(원산지), cardDiscount(카드할인)
 */
export interface FlyerRenderData {
    storeName: string;
    title: string;
    period: string;
    categories: Array<{
        name: string;
        items: FlyerRenderItem[];
    }>;
    qrCodeDataUrl?: string;
    qrCouponText?: string;
    /** 외부 링크 (밴드/쇼핑몰/전화/지도/인스타/블로그) */
    externalLinks?: Array<{
        label: string;
        url: string;
        icon: string;
    }>;
    /** 공지사항/게시판 */
    announcements?: Array<{
        title: string;
        content: string;
    }>;
    /** GIF 배너 URL */
    bannerGifUrl?: string;
    /** Phase 1+3: 수신자 전화번호 (tracking URL에서 식별) */
    trackingPhone?: string;
    /** Phase 3: 전단지 ID (장바구니 API용) */
    flyerId?: string;
    /** Phase 3: 회사 ID */
    companyId?: string;
}
export interface FlyerRenderItem {
    name: string;
    originalPrice: number;
    salePrice: number;
    badge?: string;
    imageUrl?: string;
    /** 규격 (e.g. "6kg/통", "500ml", "1박스 20kg") */
    unit?: string;
    /** 원산지 (e.g. "국내산", "미국산", "노르웨이") */
    origin?: string;
    /** 카드할인 (e.g. "농협카드 5% 추가", "삼성카드 10%") */
    cardDiscount?: string;
    /** AI 마케팅 문구 (e.g. "🍖 겉바속촉! 에어프라이어 180도 15분이면 완성") */
    aiCopy?: string;
}
declare function esc(str: string): string;
declare function fmtPrice(price: number): string;
/**
 * ★ 단일 진입점. templateCode로 렌더러 선택. 미존재 시 grid 폴백.
 */
export declare function renderTemplate(templateCode: string, data: FlyerRenderData): string;
export { esc as escapeHtml, fmtPrice as formatPrice };
//# sourceMappingURL=flyer-templates.d.ts.map