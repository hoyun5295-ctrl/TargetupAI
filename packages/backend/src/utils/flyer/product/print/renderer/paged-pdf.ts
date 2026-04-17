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

import { getPuppeteerBrowser } from '../../flyer-pdf';
import { loadTemplate } from './template-registry';
import { resolveSlotData, FILL_RUNTIME, type RawFlyerInput } from './slot-filler';
import { getPaperDimensions, type PaperSizeKey, type Orientation } from '../PAPER-SIZES';

const PAGED_POLYFILL_CDN = 'https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js';

export interface RenderFlyerPdfOptions {
  templateId: string;
  input: RawFlyerInput;
  /** 최대 렌더 대기 시간 (ms). 기본 60초 */
  timeoutMs?: number;
  /** 디버그 로그 */
  debug?: boolean;
  /** Paged.js 폴리필 비활성화 (단순 HTML → PDF 모드, 다중페이지 분할 불필요 시) */
  skipPagedJs?: boolean;
}

export interface RenderFlyerPdfResult {
  pdf: Buffer;
  /** debug=true 일 때만 생성 — 실제 렌더 결과를 눈으로 검수하기 위한 PNG */
  screenshot?: Buffer;
  /** debug=true 일 때만 생성 — 조립된 최종 HTML 문자열 (슬롯 주입 전) */
  html?: string;
  pageCount: number;
  durationMs: number;
  paperSize: PaperSizeKey;
  orientation: Orientation;
}

// ============================================================
// HTML 조립
// ============================================================

function htmlEscapeJsonForScript(obj: any): string {
  // <script> 안에 직접 삽입할 때 </script> 이스케이프 처리
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function assembleHtml(
  templateHtml: string,
  templateCss: string,
  slotData: Record<string, any>,
  opts: { skipPagedJs?: boolean },
): string {
  // 1. {{INLINE_CSS}} 플레이스홀더 치환
  let html = templateHtml.replace(/\{\{INLINE_CSS\}\}/g, templateCss);

  // 2. {{flyer.title}} 플레이스홀더 제거 (slot-filler 가 처리하므로 title 태그만 비움)
  html = html.replace(/\{\{flyer\.title\}\}/g, '');

  // 3. </body> 직전에 주입할 스크립트 블록
  const slotDataJson = htmlEscapeJsonForScript(slotData);
  const pagedInit = opts.skipPagedJs
    ? `window.__PAGED_DONE = true;`
    : `
        window.PagedConfig = {
          auto: false,
          after: function(flow) {
            // ★ Paged.js가 원본 콘텐츠를 body에 남겨두는 문제 — 원본 숨김 처리
            // (Puppeteer가 원본+pagedjs_pages 둘 다 인쇄해서 페이지 수가 배가되는 현상 방지)
            try {
              var nodes = document.querySelectorAll('body > :not(.pagedjs_pages):not(script):not(style):not(link)');
              for (var i = 0; i < nodes.length; i++) {
                nodes[i].style.display = 'none';
              }
            } catch (e) {
              console.error('[paged] dedup error', e);
            }
            window.__PAGED_DONE = true;
          }
        };`;
  const pagedScript = opts.skipPagedJs
    ? ''
    : `<script src="${PAGED_POLYFILL_CDN}" crossorigin="anonymous"></script>`;
  const pagedStart = opts.skipPagedJs
    ? ''
    : `
      (async function(){
        // 슬롯 채움 완료 대기
        for (var i = 0; i < 100 && !window.__SLOTS_FILLED; i++) {
          await new Promise(function(r){ setTimeout(r, 20); });
        }
        // Paged.js polyfill 로드 완료 대기
        for (var i = 0; i < 200 && !window.PagedPolyfill; i++) {
          await new Promise(function(r){ setTimeout(r, 30); });
        }
        if (window.PagedPolyfill) {
          try { await window.PagedPolyfill.preview(); }
          catch (e) { console.error('[paged] preview error', e); window.__PAGED_DONE = true; }
        } else {
          console.warn('[paged] Paged.js polyfill 미로드 — skip');
          window.__PAGED_DONE = true;
        }
      })();`;

  const injection = `
<script>window.__SLOT_DATA = ${slotDataJson};</script>
<script>${pagedInit}</script>
<script>${FILL_RUNTIME}</script>
${pagedScript}
<script>${pagedStart}</script>
`;

  // </body> 앞에 삽입
  if (html.includes('</body>')) {
    html = html.replace('</body>', `${injection}\n</body>`);
  } else {
    html = html + injection;
  }

  return html;
}

// ============================================================
// Public API
// ============================================================

export async function renderFlyerPdf(options: RenderFlyerPdfOptions): Promise<RenderFlyerPdfResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs || 60000;
  const log = (...a: any[]) => { if (options.debug) console.log('[paged-pdf]', ...a); };

  // 1) 템플릿 로드
  const tpl = await loadTemplate(options.templateId);
  const paperSize = tpl.manifest.paper.size;
  const orientation = tpl.manifest.paper.orientation || 'portrait';
  log('template loaded', { id: tpl.manifest.id, paper: paperSize, orientation });

  // 2) 슬롯 데이터 resolve
  const slotData = resolveSlotData(tpl.manifest, options.input);
  log('slot data resolved', Object.keys(slotData));

  // 3) 최종 HTML 조립
  const html = assembleHtml(tpl.html, tpl.css, slotData, { skipPagedJs: options.skipPagedJs });

  // 4) Puppeteer 렌더
  const browser = await getPuppeteerBrowser();
  const page = await browser.newPage();

  try {
    const dims = getPaperDimensions(paperSize, orientation);
    // 뷰포트 — CSS mm 단위와 정합되도록 96dpi 기준 px 계산
    const MM_TO_PX_96 = 96 / 25.4;
    await page.setViewport({
      width: Math.round(dims.widthMm * MM_TO_PX_96),
      height: Math.round(dims.heightMm * MM_TO_PX_96),
      deviceScaleFactor: 2,
    });

    // 콘솔 로그를 Node stdout으로 (디버깅)
    if (options.debug) {
      page.on('console', (msg: any) => console.log('[page]', msg.type(), msg.text()));
      page.on('pageerror', (err: any) => console.error('[page] error', err));
    }

    await page.setContent(html, { waitUntil: 'networkidle0', timeout: Math.min(timeoutMs, 30000) });
    log('content set');

    // 슬롯 채움 완료 대기
    await page.waitForFunction('window.__SLOTS_FILLED === true', { timeout: 15000 });
    log('slots filled');

    // Paged.js pagination 완료 대기
    if (!options.skipPagedJs) {
      await page.waitForFunction('window.__PAGED_DONE === true', { timeout: timeoutMs });
      log('paged.js done');
    }

    // 페이지 수 조회 (Paged.js 생성 .pagedjs_page 개수)
    // ※ page.evaluate에 문자열을 넘겨 Node TS가 DOM lib 없이도 컴파일되게 함
    const pageCount = options.skipPagedJs
      ? 1
      : ((await page.evaluate('document.querySelectorAll(".pagedjs_page").length')) as number) || 1;
    log('page count', pageCount);

    // PDF 생성
    const pdfOpts: any = {
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    };

    // preferCSSPageSize가 안 먹히는 경우 대비 명시 width/height
    if (!options.skipPagedJs) {
      // Paged.js가 .pagedjs_page 에 명시적 width/height를 mm로 박음 → preferCSSPageSize OK
    } else {
      pdfOpts.width = `${dims.widthMm}mm`;
      pdfOpts.height = `${dims.heightMm}mm`;
    }

    const pdfBuffer = await page.pdf(pdfOpts);
    log('pdf generated', pdfBuffer.length);

    // debug 모드 — 렌더 결과를 눈으로 검수하기 위한 PNG + HTML 반환
    let screenshotBuffer: Buffer | undefined;
    if (options.debug) {
      try {
        const raw = await page.screenshot({ type: 'png', fullPage: true });
        screenshotBuffer = Buffer.from(raw);
        log('screenshot captured', screenshotBuffer.length);
      } catch (e) {
        log('screenshot failed', e);
      }
    }

    return {
      pdf: Buffer.from(pdfBuffer),
      screenshot: screenshotBuffer,
      html: options.debug ? html : undefined,
      pageCount,
      durationMs: Date.now() - startedAt,
      paperSize,
      orientation,
    };
  } finally {
    await page.close().catch(() => {});
  }
}
