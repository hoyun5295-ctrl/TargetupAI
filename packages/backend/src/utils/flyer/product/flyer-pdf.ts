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

import puppeteer, { Browser } from 'puppeteer';
import fs from 'fs';
import path from 'path';

// ============================================================
// ★ 로컬 이미지를 base64 data URL로 인라인 변환
// puppeteer setContent에서 HTTP 요청 불가 → 파일 직접 읽어서 인라인
// ============================================================

const UPLOAD_BASE = path.resolve(process.cwd(), 'uploads');
const PRODUCT_IMAGE_DIR = process.env.PRODUCT_IMAGE_PATH || path.resolve('./uploads/product-images');

function inlineLocalImages(html: string): string {
  return html.replace(/src="([^"]+)"/g, (match, src: string) => {
    // 외부 URL(http)이나 data URL은 그대로
    if (src.startsWith('http') || src.startsWith('data:')) return match;

    let filePath: string | null = null;

    // /api/flyer/catalog-images/{companyId}/{filename}
    const catalogMatch = src.match(/\/api\/flyer\/catalog-images\/([^/]+)\/([^/]+)$/);
    if (catalogMatch) {
      filePath = path.join(UPLOAD_BASE, 'catalog-images', catalogMatch[1], catalogMatch[2]);
    }

    // /api/flyer/flyers/flyer-products/{companyId}/{filename}
    const productMatch = src.match(/\/api\/flyer\/flyers\/flyer-products\/([^/]+)\/([^/]+)$/);
    if (productMatch) {
      filePath = path.join(UPLOAD_BASE, 'flyer-products', productMatch[1], productMatch[2]);
    }

    // /api/flyer/flyers/product-images/{filename} (Pixabay 기본 이미지)
    const pixabayMatch = src.match(/\/api\/flyer\/flyers\/product-images\/([^/]+)$/);
    if (pixabayMatch) {
      filePath = path.join(PRODUCT_IMAGE_DIR, decodeURIComponent(pixabayMatch[1]));
    }

    if (!filePath || !fs.existsSync(filePath)) return match;

    try {
      const buf = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      return `src="data:${mime};base64,${buf.toString('base64')}"`;
    } catch {
      return match;
    }
  });
}

// ============================================================
// 싱글톤 브라우저 관리
// ============================================================

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
      ],
    });
  }
  return browser;
}

/**
 * ★ D129 인쇄전단 V2 — paged-pdf.ts 등 외부 모듈에서 동일 싱글톤을 공유하기 위한 export.
 * 내부용 getBrowser()는 그대로 두고 얇은 래퍼만 제공.
 */
export async function getPuppeteerBrowser(): Promise<Browser> {
  return getBrowser();
}

// 프로세스 종료 시 cleanup
process.on('exit', () => { browser?.close().catch(() => {}); });
process.on('SIGINT', () => { browser?.close().catch(() => {}); process.exit(0); });
process.on('SIGTERM', () => { browser?.close().catch(() => {}); process.exit(0); });

// ============================================================
// 동시 요청 세마포어 (최대 3개)
// ============================================================

let activePdfJobs = 0;
const MAX_CONCURRENT_PDF = 3;
const waitQueue: Array<() => void> = [];

async function acquireSemaphore(): Promise<void> {
  if (activePdfJobs < MAX_CONCURRENT_PDF) {
    activePdfJobs++;
    return;
  }
  return new Promise<void>(resolve => {
    waitQueue.push(() => { activePdfJobs++; resolve(); });
  });
}

function releaseSemaphore(): void {
  activePdfJobs--;
  if (waitQueue.length > 0) {
    const next = waitQueue.shift()!;
    next();
  }
}

// ============================================================
// PDF 생성 함수
// ============================================================

export type PaperSize = 'A4' | 'A3' | 'A2' | 'A1' | 'A0' | 'price_card' | 'Letter';

/** 커스텀 사이즈 매핑 (puppeteer가 지원하지 않는 사이즈) */
const CUSTOM_SIZES: Record<string, { width: string; height: string }> = {
  A2: { width: '420mm', height: '594mm' },
  A1: { width: '594mm', height: '841mm' },
  A0: { width: '841mm', height: '1189mm' },
  price_card: { width: '90mm', height: '55mm' },
};

export interface PdfOptions {
  /** 용지 크기 */
  format?: PaperSize;
  /** 가로 모드 (기본 false) */
  landscape?: boolean;
  /** HTML 내 상대경로 이미지의 base URL */
  baseUrl?: string;
  /** 여백 (기본 0 — 전단지는 여백 없이 풀페이지) */
  margin?: { top?: string; bottom?: string; left?: string; right?: string };
}

/**
 * HTML 문자열을 PDF Buffer로 변환
 */
export async function generatePdfFromHtml(
  html: string,
  options: PdfOptions = {}
): Promise<Buffer> {
  await acquireSemaphore();
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    // 모바일 전단지 뷰포트 (480px 기준)
    await page.setViewport({ width: 480, height: 800 });

    // ★ 이미지를 base64 data URL로 인라인 변환
    // puppeteer setContent에서 localhost HTTP 요청이 불안정 → 파일 직접 읽어서 인라인
    const resolvedHtml = inlineLocalImages(html);

    const setContentOptions: any = { waitUntil: 'networkidle0', timeout: 30000 };

    await page.setContent(resolvedHtml, setContentOptions);

    // 이미지 로딩 대기 (최대 5초)
    await page.evaluate(`
      Promise.all(
        Array.from(document.images)
          .filter(function(img) { return !img.complete; })
          .map(function(img) { return new Promise(function(r) { img.onload = r; img.onerror = r; }); })
      )
    `).catch(() => {});

    // ★ 커스텀 사이즈 지원 (A0/A1/A2/프라이스카드)
    const fmt = options.format || 'A4';
    const customSize = CUSTOM_SIZES[fmt];
    const pdfOpts: any = {
      landscape: options.landscape || false,
      printBackground: true,
      preferCSSPageSize: false,
      margin: options.margin || { top: '0', bottom: '0', left: '0', right: '0' },
    };
    if (customSize) {
      pdfOpts.width = options.landscape ? customSize.height : customSize.width;
      pdfOpts.height = options.landscape ? customSize.width : customSize.height;
    } else {
      pdfOpts.format = fmt as any;
    }
    const pdf = await page.pdf(pdfOpts);

    return Buffer.from(pdf);
  } finally {
    await page.close();
    releaseSemaphore();
  }
}

/**
 * 브라우저 인스턴스 수동 종료 (테스트/서버 종료 시)
 */
export async function closePdfBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}
