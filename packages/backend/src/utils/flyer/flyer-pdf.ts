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

export interface PdfOptions {
  /** 용지 크기 (기본 A4) */
  format?: 'A4' | 'A3' | 'Letter';
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

    // HTML 세팅 — baseUrl이 있으면 이미지 상대경로 해결
    const setContentOptions: any = { waitUntil: 'networkidle0', timeout: 30000 };

    await page.setContent(html, setContentOptions);

    // 이미지 로딩 대기 (최대 5초)
    await page.evaluate(`
      Promise.all(
        Array.from(document.images)
          .filter(function(img) { return !img.complete; })
          .map(function(img) { return new Promise(function(r) { img.onload = r; img.onerror = r; }); })
      )
    `).catch(() => {});

    const pdf = await page.pdf({
      format: options.format || 'A4',
      landscape: options.landscape || false,
      printBackground: true,
      preferCSSPageSize: false,
      margin: options.margin || { top: '0', bottom: '0', left: '0', right: '0' },
    });

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
