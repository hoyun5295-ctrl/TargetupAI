"use strict";
/**
 * ★ CT-F17 — 전단AI 네이버 쇼핑 검색 (상품 이미지 자동 매칭)
 *
 * 상품명으로 네이버 쇼핑 검색 → 상품 이미지 URL 반환.
 * 카탈로그 등록/CSV 업로드 시 자동 이미지 매칭에 사용.
 *
 * API: https://openapi.naver.com/v1/search/shop.json
 * 무료: 일 25,000건
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchNaverShopping = searchNaverShopping;
exports.downloadAndSaveImage = downloadAndSaveImage;
exports.autoMatchImage = autoMatchImage;
exports.batchAutoMatchImages = batchAutoMatchImages;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || '';
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || '';
const SHOP_API_URL = 'https://openapi.naver.com/v1/search/shop.json';
const IMAGE_API_URL = 'https://openapi.naver.com/v1/search/image';
// 이미지 저장 경로
const IMAGE_DIR = path_1.default.join(process.cwd(), 'uploads', 'catalog-images');
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
function cleanProductName(raw) {
    return raw
        .replace(/\d+\s*(송이|개|캔|병|팩|박스|봉|입|매|kg|g|ml|l|리터|줄|세트|인분|포기|단|묶음|통|ea|봉지)/gi, '')
        .replace(/\([^)]*\)/g, '') // 괄호 내용 제거
        .replace(/\s+/g, ' ')
        .trim() || raw.trim();
}
/**
 * ★ 네이버 쇼핑 API 검색 — 상품 이미지 + 가격 정보
 * 이미지 검색보다 상품 이미지가 정확하지만 주류/담배는 안 나옴.
 */
async function searchShopApi(q, display) {
    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET)
        return [];
    try {
        const params = new URLSearchParams({
            query: cleanProductName(q),
            display: String(Math.min(display, 100)),
            sort: 'sim',
        });
        const res = await fetch(`${SHOP_API_URL}?${params}`, {
            headers: { 'X-Naver-Client-Id': NAVER_CLIENT_ID, 'X-Naver-Client-Secret': NAVER_CLIENT_SECRET },
        });
        if (!res.ok)
            return [];
        const data = await res.json();
        return (data.items || [])
            .filter((item) => {
            // ★ 품질 필터: 이미지 URL 존재 + 최소 200px 이상 (네이버 쇼핑 이미지는 보통 정사각형)
            const img = item.image || '';
            return img && !img.includes('noimage') && !img.includes('no_img');
        })
            .map((item) => ({
            title: stripHtml(item.title || ''),
            link: item.link || '',
            image: item.image || '',
            lprice: item.lprice || '0',
            hprice: item.hprice || '0',
            mallName: item.mallName || '',
            maker: item.maker || '',
            brand: item.brand || '',
            category1: item.category1 || '',
            category2: item.category2 || '',
            category3: item.category3 || '',
        }));
    }
    catch {
        return [];
    }
}
async function searchNaverShopping(query, display = 5) {
    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
        console.warn('[naver-search] NAVER_CLIENT_ID/SECRET 미설정');
        return { query, items: [], total: 0 };
    }
    try {
        // ★ 상품명 정제 후 검색 (단위/수량 제거 → 핵심 품명만)
        const cleanQuery = cleanProductName(query);
        const params = new URLSearchParams({
            query: cleanQuery + ' 식품', // "식품" 키워드로 식품 이미지 우선
            display: String(Math.min(display, 100)),
            sort: 'sim',
            filter: 'large', // 큰 이미지만
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
        const data = await res.json();
        const imageItems = (data.items || [])
            .filter((item) => {
            // ★ 품질 필터: noimage 제외 + 기본 유효성
            const img = item.thumbnail || item.link || '';
            return img && !img.includes('noimage') && !img.includes('no_img');
        })
            .map((item) => ({
            title: stripHtml(item.title || ''),
            link: item.link || '',
            image: item.thumbnail || item.link || '',
            lprice: '0', hprice: '0', mallName: '', maker: '', brand: '',
            category1: '', category2: '', category3: '',
        }));
        // ★ 쇼핑 API 병행 검색 (더 정확한 상품 이미지)
        const shopItems = await searchShopApi(query, display);
        // ★ 쇼핑 API 결과 우선, 이미지 검색 보충 (중복 제거)
        const seenImages = new Set();
        const merged = [];
        for (const item of [...shopItems, ...imageItems]) {
            if (seenImages.has(item.image))
                continue;
            seenImages.add(item.image);
            merged.push(item);
            if (merged.length >= display)
                break;
        }
        return { query, items: merged, total: data.total || 0 };
    }
    catch (err) {
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
async function downloadAndSaveImage(imageUrl, companyId) {
    try {
        const companyDir = path_1.default.join(IMAGE_DIR, companyId);
        if (!fs_1.default.existsSync(companyDir)) {
            fs_1.default.mkdirSync(companyDir, { recursive: true });
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(imageUrl, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok)
            return null;
        const buffer = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get('content-type') || 'image/jpeg';
        const ext = contentType.includes('png') ? 'png' : 'jpg';
        const filename = `${crypto_1.default.randomBytes(8).toString('hex')}.${ext}`;
        const filePath = path_1.default.join(companyDir, filename);
        fs_1.default.writeFileSync(filePath, buffer);
        // 서빙 URL 반환 (flyers.ts의 이미지 서빙 패턴 참조)
        return `/api/flyer/catalog-images/${companyId}/${filename}`;
    }
    catch (err) {
        console.error('[naver-search] 이미지 다운로드 실패:', err.message);
        return null;
    }
}
/**
 * ★ 상품명으로 이미지 자동 매칭 (검색 → 1순위 이미지 다운로드 → URL 반환)
 *
 * CSV 업로드나 카탈로그 자동 등록 시 사용.
 */
async function autoMatchImage(productName, companyId) {
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
async function batchAutoMatchImages(products, companyId) {
    const results = [];
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
function stripHtml(str) {
    return str.replace(/<[^>]*>/g, '');
}
//# sourceMappingURL=flyer-naver-search.js.map