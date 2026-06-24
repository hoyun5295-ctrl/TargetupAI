/**
 * ★ 인쇄전단 V2 (D129) — Paged.js + Puppeteer PDF 렌더러
 *
 * 파이프라인:
 *   1. loadTemplate(templateId) → { manifest, html, css }
 *   2. resolveSlotData(manifest, input) → SlotData
 *   3. assembleHtml() — 인라인 CSS + 슬롯 데이터 + FILL_RUNTIME + Paged.js polyfill
 *   4. Puppeteer page.setContent → 슬롯 채움 완료 대기 → Paged.js pagination 완료 대기
 *   5. page.pdf({ preferCSSPageSize: true }) → Buffer
 *
 * 의존성: 기존 flyer-pdf.ts의 puppeteer 싱글톤 재사용 (브라우저 재활용)
 *
 * Paged.js CDN: unpkg.com/pagedjs/dist/paged.polyfill.js
 */
import { type RawFlyerInput } from './slot-filler';
import { type PaperSizeKey, type Orientation } from '../PAPER-SIZES';
export interface RenderFlyerPdfOptions {
    templateId: string;
    input: RawFlyerInput;
    /** 최대 렌더 대기 시간 (ms). 기본 60초 */
    timeoutMs?: number;
    /** 디버그 로그 */
    debug?: boolean;
    /** Paged.js 폴리필 비활성화 (단순 HTML → PDF 모드, 다중페이지 분할 불필요 시) */
    skipPagedJs?: boolean;
    /** 출력 포맷 — 'pdf'(기본, 인쇄업체 제출용) 또는 'png'(확인용 고해상도 이미지) */
    format?: 'pdf' | 'png';
    /** PNG 모드 전용: deviceScaleFactor 기본 3 (≈288dpi). 인쇄 확인용이라 300dpi 근접 */
    pngScale?: number;
}
export interface RenderFlyerPdfResult {
    /** format='pdf' 이면 존재 */
    pdf?: Buffer;
    /** format='png' 이면 존재. debug=true 에서도 검수용 스크린샷으로 생성됨 */
    png?: Buffer;
    /** (하위호환) screenshot = png alias */
    screenshot?: Buffer;
    /** debug=true 일 때만 생성 — 조립된 최종 HTML 문자열 (슬롯 주입 전) */
    html?: string;
    pageCount: number;
    durationMs: number;
    paperSize: PaperSizeKey;
    orientation: Orientation;
    format: 'pdf' | 'png';
}
export declare function renderFlyerPdf(options: RenderFlyerPdfOptions): Promise<RenderFlyerPdfResult>;
//# sourceMappingURL=paged-pdf.d.ts.map