/**
 * ★ CT-F17 — 전단AI 네이버 쇼핑 검색 (상품 이미지 자동 매칭)
 *
 * 상품명으로 네이버 쇼핑 검색 → 상품 이미지 URL 반환.
 * 카탈로그 등록/CSV 업로드 시 자동 이미지 매칭에 사용.
 *
 * API: https://openapi.naver.com/v1/search/shop.json
 * 무료: 일 25,000건
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || '';
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || '';
const SHOP_API_URL = 'https://openapi.naver.com/v1/search/shop.json';
const IMAGE_API_URL = 'https://openapi.naver.com/v1/search/image';

// 이미지 저장 경로
const IMAGE_DIR = path.join(process.cwd(), 'uploads', 'catalog-images');

export interface NaverShopItem {
  title: string;       // 상품명 (HTML 태그 포함 가능)
  link: string;        // 상품 페이지 URL
  image: string;       // ★ 상품 이미지 URL
  lprice: string;      // 최저가
  hprice: string;      // 최고가
  mallName: string;    // 판매처
  maker: string;       // 제조사
  brand: string;       // 브랜드
  category1: string;
  category2: string;
  category3: string;
}

export interface ImageSearchResult {
  query: string;
  items: NaverShopItem[];
  total: number;
}

/**
 * ★ 네이버 이미지 검색 — 상품명으로 검색하여 후보 이미지 반환
 *
 * 쇼핑 검색은 주류/담배 등 온라인 판매 금지 상품이 안 나옴.
 * 이미지 검색은 모든 상품 커버 가능.
 *
 * @param query 상품명 (예: "카스 500ml", "처음처럼 소주")
 * @param display 결과 수 (기본 5, 최대 100)
 */
/**
 * 상품명에서 단위/수량/규격을 제거하여 핵심 품명만 추출.
 * "바나나 1송이" → "바나나", "청송사과 20kg" → "청송사과", "카스 500ml 24캔" → "카스"
 */
function cleanProductName(raw: string): string {
  return raw
    .replace(/\d+\s*(송이|개|캔|병|팩|박스|봉|입|매|kg|g|ml|l|리터|줄|세트|인분|포기|단|묶음|통|ea|봉지)/gi, '')
    .replace(/\([^)]*\)/g, '')       // 괄호 내용 제거
    .replace(/\s+/g, ' ')
    .trim() || raw.trim();
}

export async function searchNaverShopping(
  query: string,
  display: number = 5
): Promise<ImageSearchResult> {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    console.warn('[naver-search] NAVER_CLIENT_ID/SECRET 미설정');
    return { query, items: [], total: 0 };
  }

  try {
    // ★ 상품명 정제 후 검색 (단위/수량 제거 → 핵심 품명만)
    const cleanQuery = cleanProductName(query);
    const params = new URLSearchParams({
      query: cleanQuery + ' 식품',  // "식품" 키워드로 식품 이미지 우선
      display: String(Math.min(display, 100)),
      sort: 'sim',
      filter: 'large',  // 큰 이미지만
    });

    const res = await fetch(`${IMAGE_API_URL}?${params}`, {
      headers: {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
      },
    });

    if (!res.ok) {
      console.error(`[naver-search] 이미지 API 오류: ${res.status} ${res.statusText}`);
      return { query, items: [], total: 0 };
    }

    const data = await res.json() as any;
    return {
      query,
      items: (data.items || []).map((item: any) => ({
        title: stripHtml(item.title || ''),
        link: item.link || '',
        image: item.thumbnail || item.link || '',  // 이미지 검색은 thumbnail 필드
        lprice: '0',
        hprice: '0',
        mallName: '',
        maker: '',
        brand: '',
        category1: '',
        category2: '',
        category3: '',
      })),
      total: data.total || 0,
    };
  } catch (err: any) {
    console.error('[naver-search] 검색 실패:', err.message);
    return { query, items: [], total: 0 };
  }
}

/**
 * ★ 이미지 URL → 로컬 서버에 다운로드 저장
 *
 * 네이버 쇼핑 이미지 URL은 외부 CDN이라 직접 링크하면 불안정.
 * 우리 서버에 저장하여 안정적으로 서빙.
 */
export async function downloadAndSaveImage(
  imageUrl: string,
  companyId: string
): Promise<string | null> {
  try {
    const companyDir = path.join(IMAGE_DIR, companyId);
    if (!fs.existsSync(companyDir)) {
      fs.mkdirSync(companyDir, { recursive: true });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(imageUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const filename = `${crypto.randomBytes(8).toString('hex')}.${ext}`;
    const filePath = path.join(companyDir, filename);

    fs.writeFileSync(filePath, buffer);

    // 서빙 URL 반환 (flyers.ts의 이미지 서빙 패턴 참조)
    return `/api/flyer/catalog-images/${companyId}/${filename}`;
  } catch (err: any) {
    console.error('[naver-search] 이미지 다운로드 실패:', err.message);
    return null;
  }
}

/**
 * ★ 상품명으로 이미지 자동 매칭 (검색 → 1순위 이미지 다운로드 → URL 반환)
 *
 * CSV 업로드나 카탈로그 자동 등록 시 사용.
 */
export async function autoMatchImage(
  productName: string,
  companyId: string
): Promise<{ imageUrl: string | null; source: 'naver' | 'none'; candidates: NaverShopItem[] }> {
  const result = await searchNaverShopping(productName, 5);

  if (result.items.length === 0) {
    return { imageUrl: null, source: 'none', candidates: [] };
  }

  // 1순위 이미지 다운로드
  const savedUrl = await downloadAndSaveImage(result.items[0].image, companyId);

  return {
    imageUrl: savedUrl,
    source: 'naver',
    candidates: result.items,
  };
}

/**
 * ★ 배치 이미지 매칭 — CSV 업로드 시 여러 상품 한번에 처리
 *
 * 네이버 API 호출 제한 고려하여 순차 실행 + 딜레이
 */
export async function batchAutoMatchImages(
  products: Array<{ name: string; index: number }>,
  companyId: string
): Promise<Array<{ index: number; name: string; imageUrl: string | null; candidates: NaverShopItem[] }>> {
  const results: Array<{ index: number; name: string; imageUrl: string | null; candidates: NaverShopItem[] }> = [];

  for (const product of products) {
    const match = await autoMatchImage(product.name, companyId);
    results.push({
      index: product.index,
      name: product.name,
      imageUrl: match.imageUrl,
      candidates: match.candidates,
    });

    // API 호출 간격 (100ms) — 네이버 API rate limit 방지
    await new Promise(r => setTimeout(r, 100));
  }

  return results;
}

/** HTML 태그 제거 */
function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '');
}
