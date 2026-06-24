/**
 * ★ 전단AI: POP 가격표 템플릿 시스템 (V3 — 5종 템플릿)
 *
 * 5종 POP 디자인:
 *   1. hot     — HOT 프라이스 (이미지 크게 + 하단 가격)
 *   2. classic — 클래식 마트 (빨강 헤더 + 이미지 + 빨강 가격바)
 *   3. simple  — 심플 화이트 (깔끔한 흰 배경 + 이미지 + 가격)
 *   4. dark    — 다크 프리미엄 (검정 배경 + 골드 가격)
 *   5. jumbo   — 대형 가격 (가격이 메인, 이미지 보조)
 */
export interface PopItem {
    name: string;
    originalPrice: number;
    salePrice: number;
    badge?: string;
    unit?: string;
    origin?: string;
    cardDiscount?: string;
    aiCopy?: string;
    imageUrl?: string;
}
export interface PopOptions {
    storeName?: string;
    storeAddress?: string;
    colorTheme?: 'red' | 'yellow' | 'green' | 'blue' | 'black';
    popTemplate?: PopTemplate;
    paperSize?: string;
    landscape?: boolean;
}
export type PopTemplate = 'hot' | 'classic' | 'simple' | 'dark' | 'jumbo';
export declare const POP_TEMPLATES: {
    value: PopTemplate;
    label: string;
    desc: string;
}[];
export declare function renderPricePop(item: PopItem, options?: PopOptions): string;
export declare function renderMultiPop(items: PopItem[], splits: number, options?: PopOptions): string;
export declare function renderPromoPop(category: string, items: PopItem[], options?: PopOptions): string;
//# sourceMappingURL=flyer-pop-templates.d.ts.map