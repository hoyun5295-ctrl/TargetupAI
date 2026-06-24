/**
 * ★ 전단AI: PDF 생성 유틸
 *
 * puppeteer로 HTML → PDF 변환.
 * 전단지 PDF + POP PDF 공통 사용.
 *
 * - 브라우저 싱글톤 재사용 (메모리 절약)
 * - 동시 요청 세마포어 (최대 3개)
 * - 프로세스 종료 시 자동 cleanup
 */
import { Browser } from 'puppeteer';
/**
 * ★ D129 인쇄전단 V2 — paged-pdf.ts 등 외부 모듈에서 동일 싱글톤을 공유하기 위한 export.
 * 내부용 getBrowser()는 그대로 두고 얇은 래퍼만 제공.
 */
export declare function getPuppeteerBrowser(): Promise<Browser>;
export type PaperSize = 'A4' | 'A3' | 'A2' | 'A1' | 'A0' | 'price_card' | 'Letter';
export interface PdfOptions {
    /** 용지 크기 */
    format?: PaperSize;
    /** 가로 모드 (기본 false) */
    landscape?: boolean;
    /** HTML 내 상대경로 이미지의 base URL */
    baseUrl?: string;
    /** 여백 (기본 0 — 전단지는 여백 없이 풀페이지) */
    margin?: {
        top?: string;
        bottom?: string;
        left?: string;
        right?: string;
    };
}
/**
 * HTML 문자열을 PDF Buffer로 변환
 */
export declare function generatePdfFromHtml(html: string, options?: PdfOptions): Promise<Buffer>;
/**
 * 브라우저 인스턴스 수동 종료 (테스트/서버 종료 시)
 */
export declare function closePdfBrowser(): Promise<void>;
//# sourceMappingURL=flyer-pdf.d.ts.map