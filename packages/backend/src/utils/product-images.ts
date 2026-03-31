/**
 * CT: product-images.ts — 상품 이미지 자동 매핑 컨트롤타워
 *
 * 3단계 이미지 소싱:
 *   1. DALL-E 생성 이미지 (서버 저장, 최우선)
 *   2. Unsplash 큐레이션 이미지 (키워드 매핑 폴백)
 *   3. 이모지 (최종 폴백)
 *
 * 사용처: short-urls.ts (전단지 공개 페이지 렌더링), flyers.ts (이미지 생성 API)
 */

import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

export interface ProductDisplay {
  emoji: string;
  imageUrl: string | null;
}

interface ProductEntry {
  keyword: string;
  emoji: string;
  image: string;
}

/** ★ D100: 마트 주요 상품 이미지 매핑 — Pixabay 무료 실사 이미지 (로컬 서빙)
 *  image: 로컬 파일명 → resolveProductImageUrl()에서 API URL로 변환
 *  Unsplash(외국 식재료) → Pixabay(한국 마트 느낌) 교체 완료
 */
const PRODUCT_MAP: ProductEntry[] = [
  // ── 과일 (14개 이미지) ──
  { keyword: '딸기', emoji: '🍓', image: '딸기.jpg' },
  { keyword: '사과', emoji: '🍎', image: '사과.jpg' },
  { keyword: '배', emoji: '🍐', image: '배.jpg' },
  { keyword: '귤', emoji: '🍊', image: '귤.jpg' },
  { keyword: '오렌지', emoji: '🍊', image: '귤.jpg' },
  { keyword: '바나나', emoji: '🍌', image: '바나나.jpg' },
  { keyword: '포도', emoji: '🍇', image: '포도.jpg' },
  { keyword: '수박', emoji: '🍉', image: '수박.jpg' },
  { keyword: '참외', emoji: '🍈', image: '참외.jpg' },
  { keyword: '복숭아', emoji: '🍑', image: '복숭아.jpg' },
  { keyword: '체리', emoji: '🍒', image: '체리.jpg' },
  { keyword: '토마토', emoji: '🍅', image: '토마토.jpg' },
  { keyword: '블루베리', emoji: '🫐', image: '블루베리.jpg' },
  { keyword: '키위', emoji: '🥝', image: '키위.jpg' },
  { keyword: '망고', emoji: '🥭', image: '망고.jpg' },

  // ── 채소 (13개 이미지) ──
  { keyword: '양배추', emoji: '🥬', image: '양배추.jpg' },
  { keyword: '브로콜리', emoji: '🥦', image: '브로콜리.jpg' },
  { keyword: '당근', emoji: '🥕', image: '당근.jpg' },
  { keyword: '감자', emoji: '🥔', image: '감자.jpg' },
  { keyword: '고구마', emoji: '🍠', image: '고구마.jpg' },
  { keyword: '양파', emoji: '🧅', image: '양파.jpg' },
  { keyword: '마늘', emoji: '🧄', image: '마늘.jpg' },
  { keyword: '옥수수', emoji: '🌽', image: '옥수수.jpg' },
  { keyword: '고추', emoji: '🌶️', image: '고추.jpg' },
  { keyword: '버섯', emoji: '🍄', image: '버섯.jpg' },
  { keyword: '파프리카', emoji: '🫑', image: '파프리카.jpg' },
  { keyword: '시금치', emoji: '🥬', image: '시금치.jpg' },
  { keyword: '호박', emoji: '🎃', image: '호박.jpg' },
  { keyword: '오이', emoji: '🥒', image: '오이.jpg' },
  { keyword: '배추', emoji: '🥬', image: '양배추.jpg' },

  // ── 축산 (6개 이미지) ──
  { keyword: '소고기', emoji: '🥩', image: '소고기.jpg' },
  { keyword: '한우', emoji: '🥩', image: '한우.jpg' },
  { keyword: '삼겹살', emoji: '🥓', image: '삼겹살.jpg' },
  { keyword: '목살', emoji: '🥩', image: '목살.jpg' },
  { keyword: '닭', emoji: '🍗', image: '닭고기.jpg' },
  { keyword: '닭고기', emoji: '🍗', image: '닭고기.jpg' },
  { keyword: '오리', emoji: '🦆', image: '오리고기.jpg' },
  { keyword: '오리고기', emoji: '🦆', image: '오리고기.jpg' },

  // ── 수산 (5개 이미지) ──
  { keyword: '연어', emoji: '🐟', image: '연어.jpg' },
  { keyword: '고등어', emoji: '🐟', image: '고등어.jpg' },
  { keyword: '새우', emoji: '🦐', image: '새우.jpg' },
  { keyword: '오징어', emoji: '🦑', image: '오징어.jpg' },
  { keyword: '게', emoji: '🦀', image: '게.jpg' },
  { keyword: '조개', emoji: '🐚', image: '조개.jpg' },

  // ── 유제품/가공 (5개 이미지) ──
  { keyword: '계란', emoji: '🥚', image: '계란.jpg' },
  { keyword: '달걀', emoji: '🥚', image: '계란.jpg' },
  { keyword: '우유', emoji: '🥛', image: '우유.jpg' },
  { keyword: '치즈', emoji: '🧀', image: '치즈.jpg' },
  { keyword: '두부', emoji: '🫘', image: '두부.jpg' },
  { keyword: '소시지', emoji: '🌭', image: '소시지.jpg' },

  // ── 가공식품 (4개 이미지) ──
  { keyword: '김치', emoji: '🥬', image: '김치.jpg' },
  { keyword: '라면', emoji: '🍜', image: '라면.jpg' },
  { keyword: '비비고왕교자', emoji: '🥟', image: '비비고 왕교자.webp' },
  { keyword: '비비고 왕교자', emoji: '🥟', image: '비비고 왕교자.webp' },
  { keyword: '카스 500ml', emoji: '🍺', image: '카스 500ML.jpeg' },
  { keyword: '카스 500ML', emoji: '🍺', image: '카스 500ML.jpeg' },
];

/**
 * 상품명에서 키워드를 매칭하여 이모지 + 이미지 URL을 반환.
 * 매칭되지 않으면 이모지만 '📦', 이미지는 null.
 */
export function getProductDisplay(productName: string): ProductDisplay {
  const name = productName.toLowerCase();
  for (const entry of PRODUCT_MAP) {
    if (name.includes(entry.keyword.toLowerCase())) {
      // ★ D100: 로컬 파일명 → API URL 변환
      const imageUrl = `/api/flyer/flyers/product-images/${encodeURIComponent(entry.image)}`;
      return { emoji: entry.emoji, imageUrl };
    }
  }
  return { emoji: '📦', imageUrl: null };
}

/**
 * 이모지만 반환 (하위호환용 — 기존 getEmoji 대체)
 */
export function getEmoji(productName: string): string {
  return getProductDisplay(productName).emoji;
}

/**
 * 이미지 태그 또는 이모지 태그 반환 (HTML 렌더링용)
 * 우선순위: DALL-E 생성 이미지 > Unsplash > 이모지
 * @param size - 이미지 크기 (기본 48px)
 * @param generatedImageUrl - DALL-E 생성 이미지 URL (있으면 최우선)
 */
export function renderProductImage(productName: string, size: number = 48, generatedImageUrl?: string): string {
  const { emoji } = getProductDisplay(productName);
  const finalUrl = generatedImageUrl || null;
  if (finalUrl) {
    return `<img src="${finalUrl}" alt="" class="product-img" onerror="this.onerror=null;this.style.display='none';var fb=this.nextElementSibling;if(fb)fb.style.display='flex'"><div class="emoji-fb emoji-area" style="display:none">${emoji}</div>`;
  }
  return `<div class="emoji-area">${emoji}</div>`;
}

// ============================================================
// DALL-E 3 이미지 생성 + 서버 저장
// ============================================================

const PRODUCT_IMAGE_DIR = process.env.PRODUCT_IMAGE_PATH || path.resolve('./uploads/product-images');

// 디렉토리 자동 생성
if (!fs.existsSync(PRODUCT_IMAGE_DIR)) {
  fs.mkdirSync(PRODUCT_IMAGE_DIR, { recursive: true });
}

/** 메모리 캐시: 상품명 → 로컬 이미지 경로 */
const generatedImageCache = new Map<string, string>();

/** 서버 시작 시 기존 생성 이미지 캐시에 로드 */
function loadExistingImages(): void {
  try {
    const files = fs.readdirSync(PRODUCT_IMAGE_DIR);
    for (const file of files) {
      if (file.endsWith('.png')) {
        const keyword = decodeURIComponent(file.replace('.png', ''));
        generatedImageCache.set(keyword, path.join(PRODUCT_IMAGE_DIR, file));
      }
    }
    if (generatedImageCache.size > 0) {
      console.log(`[전단AI] 기존 상품 이미지 ${generatedImageCache.size}개 캐시 로드`);
    }
  } catch { /* 디렉토리 없으면 무시 */ }
}
loadExistingImages();

/**
 * URL에서 파일 다운로드
 */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;
    client.get(url, (response) => {
      // 리다이렉트 처리
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          downloadFile(redirectUrl, dest).then(resolve).catch(reject);
          return;
        }
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

/**
 * DALL-E 3로 상품 이미지 생성 + 서버 저장
 * @returns 로컬 파일 경로 또는 null (실패 시)
 */
export async function generateProductImage(productName: string): Promise<string | null> {
  // 캐시 확인
  const cached = generatedImageCache.get(productName);
  if (cached && fs.existsSync(cached)) return cached;

  if (!process.env.OPENAI_API_KEY) {
    console.warn('[전단AI] OPENAI_API_KEY 미설정 — DALL-E 이미지 생성 불가');
    return null;
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = `한국 마트에서 판매하는 "${productName}" 상품의 고품질 사진.
깨끗한 흰색 배경, 정면에서 촬영, 음식 광고 스타일.
실제 한국 마트에서 볼 수 있는 모습 그대로. 사실적인 사진.
텍스트나 글자 없이 상품만 표시.`;

    console.log(`[전단AI] DALL-E 이미지 생성 중: ${productName}`);

    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
    });

    const imageUrl = response.data?.[0]?.url;
    if (!imageUrl) {
      console.error(`[전단AI] DALL-E 응답에 이미지 URL 없음: ${productName}`);
      return null;
    }

    // 서버에 저장
    const filename = `${encodeURIComponent(productName)}.png`;
    const filePath = path.join(PRODUCT_IMAGE_DIR, filename);
    await downloadFile(imageUrl, filePath);

    // 캐시 등록
    generatedImageCache.set(productName, filePath);
    console.log(`[전단AI] 이미지 생성 완료: ${productName} → ${filename}`);

    return filePath;
  } catch (err: any) {
    console.error(`[전단AI] DALL-E 이미지 생성 실패 (${productName}):`, err.message);
    return null;
  }
}

/**
 * 전단지의 모든 상품에 대해 이미지 일괄 생성 (비동기 백그라운드)
 * @returns 생성 결과 { 상품명: 이미지URL }
 */
export async function generateFlyerImages(categories: any[]): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  const allItems: string[] = [];

  for (const cat of categories) {
    for (const item of (cat.items || [])) {
      const name = item.name?.trim();
      if (name && !allItems.includes(name)) {
        allItems.push(name);
      }
    }
  }

  // 순차 처리 (DALL-E rate limit 고려)
  for (const name of allItems) {
    const filePath = await generateProductImage(name);
    if (filePath) {
      results[name] = filePath;
    }
  }

  return results;
}

/**
 * 상품명으로 생성된 이미지의 API URL 반환
 * (Nginx에서 /api/flyer/product-images/ 를 서빙하거나, 별도 엔드포인트에서 제공)
 */
export function getGeneratedImageUrl(productName: string): string | null {
  const cached = generatedImageCache.get(productName);
  if (cached && fs.existsSync(cached)) {
    return `/api/flyer/flyers/product-images/${encodeURIComponent(productName)}.png`;
  }
  return null;
}

/**
 * 최종 이미지 URL 결정
 * ⚠️ DALL-E = AI 느낌 강함, Unsplash = 외국 식재료 느낌 → 둘 다 부적합
 * 이모지가 가장 깔끔하고 안정적 (로드 실패 없음, 한국 마트 느낌)
 */
export function resolveProductImageUrl(productName: string): string | null {
  // ★ D100: Pixabay 로컬 이미지 활성화 — getProductDisplay에서 URL 반환
  const display = getProductDisplay(productName);
  return display.imageUrl;
}
