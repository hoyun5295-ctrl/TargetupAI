/**
 * ★ D129 V2 — 인쇄전단 이미지 파이프라인 (기존 자산 재사용 전용)
 *
 * 역할: 상품 리스트의 imageUrl을 인쇄 가능한 품질로 변환
 *
 * 이미지 소싱 순서 (전부 기존 컨트롤타워 재사용):
 *   1. product-images.ts getProductDisplay() — PRODUCT_MAP(한국 마트 상품 60개 키워드) 매칭
 *   2. flyer-naver-search.ts searchNaverShopping() — 네이버 쇼핑 API (한국 실사 판매상품)
 *   (외국 API 사용 금지 — 한국 마트 상품 매칭 정확도 낮음)
 *
 * 배경제거: 기존 flyer-rembg.ts removeBackground() 재사용
 *   - 결과는 data:image/png;base64 data URL 인라인 (Puppeteer 네트워크 의존 제거)
 *
 * 실패 정책: 각 단계 실패 시 원본 유지 (기간계 안정성)
 */

import { removeBackground } from '../../flyer-rembg';
import { getProductDisplay } from '../../../../product-images';
import { searchNaverShopping } from '../../flyer-naver-search';

// ============================================================
// 타입
// ============================================================
export interface PipelineProduct {
  productName: string;
  imageUrl?: string;
  category?: string;
  [key: string]: any;
}

export interface PipelineOptions {
  autoRembg?: boolean;
  autoMatchImage?: boolean;
  companyId?: string;
}

// ============================================================
// 이미지 다운로드/디코딩
// ============================================================
async function fetchImageBuffer(src: string): Promise<Buffer | null> {
  if (!src) return null;
  try {
    // data URL
    if (src.startsWith('data:')) {
      const comma = src.indexOf(',');
      if (comma < 0) return null;
      const meta = src.slice(5, comma);
      const data = src.slice(comma + 1);
      if (meta.includes('base64')) return Buffer.from(data, 'base64');
      return Buffer.from(decodeURIComponent(data));
    }
    // http(s)
    if (/^https?:/i.test(src)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(src, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 이미지 버퍼 → data URL (Puppeteer 렌더용, 네트워크 의존 제거)
 */
function bufferToDataUrl(buffer: Buffer, mime = 'image/png'): string {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

// ============================================================
// 개별 상품 처리 — 기존 컨트롤타워만 호출
// ============================================================
async function processOne(
  product: PipelineProduct,
  opts: PipelineOptions,
): Promise<PipelineProduct> {
  let imageUrl = product.imageUrl || '';

  // 1. 이미지 없으면 기존 자산에서 찾기
  if (!imageUrl && opts.autoMatchImage) {
    // 1-1. PRODUCT_MAP (한국 마트 상품 60개 키워드 매핑, 로컬 서빙)
    const display = getProductDisplay(product.productName || '');
    if (display.imageUrl) {
      imageUrl = display.imageUrl;
    } else {
      // 1-2. 네이버 쇼핑 API (실제 판매상품 실사진)
      try {
        const shopResult = await searchNaverShopping(product.productName || '', 1);
        const first = (shopResult as any)?.items?.[0] || (Array.isArray(shopResult) ? shopResult[0] : null);
        if (first?.image) imageUrl = first.image;
      } catch { /* 네이버 실패 시 imageUrl 빈 상태로 유지 */ }
    }
  }

  // 2. rembg 배경제거 (기존 flyer-rembg.ts) → data URL 인라인
  if (imageUrl && opts.autoRembg) {
    const buffer = await fetchImageBuffer(imageUrl);
    if (buffer && buffer.length > 0) {
      try {
        const removed = await removeBackground(buffer);
        if (removed && removed.length > 0) {
          imageUrl = bufferToDataUrl(removed, 'image/png');
        }
      } catch {
        // rembg 실패 시 원본 유지
      }
    }
  }

  return { ...product, imageUrl };
}

// ============================================================
// 공개 API — 상품 배열 일괄 처리
// ============================================================
export async function processProductImages<T extends PipelineProduct>(
  products: T[],
  opts: PipelineOptions = {},
): Promise<T[]> {
  if (!opts.autoRembg && !opts.autoMatchImage) return products;

  // 동시성 제한 (rembg/네이버API 부하 고려) — 최대 3개 병렬
  const MAX_PARALLEL = 3;
  const out: T[] = new Array(products.length);

  for (let i = 0; i < products.length; i += MAX_PARALLEL) {
    const chunk = products.slice(i, i + MAX_PARALLEL);
    const results = await Promise.all(chunk.map(p => processOne(p, opts)));
    for (let j = 0; j < results.length; j++) {
      out[i + j] = results[j] as T;
    }
  }

  return out;
}
