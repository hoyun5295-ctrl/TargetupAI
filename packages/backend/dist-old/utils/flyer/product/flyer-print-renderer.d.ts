/**
 * ★ CT-F21 — 인쇄용 전단 HTML 렌더러 V2 (완전 재작성)
 *
 * 한국 마트 전단지 실제 규격 기반:
 *   A3 (420x297mm) — 대형마트
 *   B4 (364x257mm) — 동네마트
 *   A4 (297x210mm) — 소형전단
 *   8절 (370x260mm) — 한국 전통규격
 *   타블로이드 (432x279mm) — 신문형
 *
 * 레이아웃 패턴 (한국 마트 전단 표준):
 *   ┌─────────────────────────────────────┐
 *   │  매장 로고 │ 매장 정보 │ 전화/QR     │ ← 헤더 (매장별 고정)
 *   ├─────────────────────────────────────┤
 *   │  ★ 메인 타이틀 배너                   │ ← 행사명 (봄세일 특가전)
 *   ├─────────────────────────────────────┤
 *   │  [메인1] [메인2] [메인3] [메인4]     │ ← 메인행사 (대형 카드 4열)
 *   ├─────────────────────────────────────┤
 *   │  카테고리명                           │
 *   │  [상품] [상품] [상품] [상품]          │ ← 카테고리별 (4열 그리드)
 *   │  [상품] [상품] [상품] [상품]          │
 *   ├─────────────────────────────────────┤
 *   │  매장 주소 │ 영업시간 │ 전화번호      │ ← 푸터
 *   └─────────────────────────────────────┘
 *
 * 기존 flyer-pdf.ts (CT-F11) 재활용: generatePdfFromHtml()
 */
export interface PrintProduct {
    productName: string;
    originalPrice?: number;
    salePrice: number;
    unit?: string;
    category?: string;
    imageUrl?: string;
    promoType: 'main' | 'sub' | 'general';
    aiCopy?: string;
    origin?: string;
}
export interface PrintStoreInfo {
    storeName: string;
    address?: string;
    phone?: string;
    hours?: string;
    logoUrl?: string;
}
export interface PrintTheme {
    name: string;
    primary: string;
    secondary: string;
    accent: string;
    bg: string;
    headerBg: string;
    headerText: string;
    priceBg: string;
    priceText: string;
    badgeBg: string;
    badgeText: string;
    cardBg: string;
    catHeaderBg: string;
    catHeaderText: string;
}
export interface PrintFlyerData {
    store: PrintStoreInfo;
    title: string;
    period: string;
    products: PrintProduct[];
    theme?: PrintTheme;
    templateCode?: string;
    mainBannerUrl?: string;
    paperSize?: 'A3' | 'B4' | 'A4' | '8cut' | 'tabloid';
}
export declare function renderPrintFlyer(data: PrintFlyerData): string;
/** 사용 가능한 테마 목록 */
export declare function getAvailableThemes(): PrintTheme[];
/** 테마 이름으로 조회 */
export declare function getThemeByName(name: string): PrintTheme | undefined;
/** 용지 사이즈 목록 */
export declare function getAvailablePaperSizes(): {
    value: string;
    label: string;
}[];
//# sourceMappingURL=flyer-print-renderer.d.ts.map