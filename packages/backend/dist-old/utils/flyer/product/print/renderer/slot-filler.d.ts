/**
 * ★ 인쇄전단 V2 (D129) — 슬롯 필러
 *
 * 역할 1(서버): manifest + 입력 데이터 → 정규화된 SlotData 반환
 *   - fallback 적용
 *   - selection 규칙 적용 (highest_discount, manual, featured 등)
 *   - category.mode='auto' + prefer 순서로 카테고리 할당
 *
 * 역할 2(브라우저 런타임): FILL_RUNTIME 상수로 JS 문자열 export
 *   - Puppeteer 페이지에 injectScript로 주입
 *   - window.__SLOT_DATA 를 읽어 DOM 바인딩 수행
 *   - 완료 시 window.__SLOTS_FILLED = true 신호
 *
 * 의존성: cheerio/jsdom 없음 (브라우저가 DOM 엔진 담당)
 */
import type { TemplateManifest } from './template-registry';
export interface RawProduct {
    productName: string;
    originalPrice?: number;
    salePrice: number;
    unit?: string;
    category?: string;
    imageUrl?: string;
    promoType?: 'main' | 'sub' | 'general';
    featured?: boolean;
    aiCopy?: string;
    origin?: string;
}
export interface RawStoreInfo {
    name?: string;
    address?: string;
    phone?: string;
    hours?: string;
    deliveryHours?: string;
    logoUrl?: string;
    mapUrl?: string;
}
export interface RawQrInfo {
    title?: string;
    subtitle?: string;
    imageUrl?: string;
    targetUrl?: string;
}
export interface RawFlyerInput {
    store?: RawStoreInfo;
    qr?: RawQrInfo;
    heroTitle?: string;
    heroSubcopy?: string;
    products: RawProduct[];
    /** 슬롯별 직접 오버라이드 (텍스트/배너 라벨 등) */
    slotOverrides?: Record<string, any>;
}
/** 슬롯 ID → 해당 슬롯의 resolved 값 */
export type SlotData = Record<string, any>;
export declare function resolveSlotData(manifest: TemplateManifest, input: RawFlyerInput): SlotData;
/**
 * 브라우저에서 실행될 슬롯 바인딩 스크립트.
 * - window.__SLOT_DATA 를 읽어 DOM 조작.
 * - data-slot / data-bind / data-bind-src / data-bind-bg / data-slot-meta 속성 인식.
 * - 그리드 슬롯은 <template data-role="card">를 복제하여 자식 삽입.
 * - 완료 시 window.__SLOTS_FILLED = true.
 */
export declare const FILL_RUNTIME: string;
//# sourceMappingURL=slot-filler.d.ts.map