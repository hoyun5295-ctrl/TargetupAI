/**
 * ★ CT: 네이버 쇼핑 검색 후보 (2026-07-16 M3 — DM 재개편 설계서 §2-5)
 *
 * 공식 오픈API(무료 일 25,000건)로 상품명 → 후보 이미지 목록.
 * ⛔ 자동 삽입 금지 — 후보 제시 + 사용자 원탭 확정 전용 (Harold 확정: 이름 유사도는 확정 근거가 아니다.
 *    자동 삽입은 연동몰 상품번호 ID 확정·og:image 경로만 — 오매칭 구조적 0).
 * 패턴 선례 = 한줄전단 CT-F17 (격리 원칙 — 코드 이식 없이 패턴만 미러).
 * env NAVER_CLIENT_ID / NAVER_CLIENT_SECRET (네이버 개발자센터 앱 — 한줄전단과 별도 등록 권장, 쿼터 분리).
 */

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || '';
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || '';
const SHOP_API_URL = 'https://openapi.naver.com/v1/search/shop.json';
const FETCH_TIMEOUT_MS = 5000;

export interface NaverShopCandidate {
  title: string;     // 상품명 (HTML 태그 제거)
  image: string;     // 상품 이미지 URL (네이버 CDN 썸네일)
  link: string;      // 상품/카탈로그 링크
  mallName: string;  // 판매처
  lprice: number;    // 최저가
}

/** 검색 API 설정 여부 — UI가 미설정을 정직하게 안내할 수 있게 노출 */
export function isNaverShopSearchConfigured(): boolean {
  return !!(NAVER_CLIENT_ID && NAVER_CLIENT_SECRET);
}

function stripHtml(s: any): string {
  return String(s ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

/** 상품명 정제 — 단위·수량·괄호 제거 후 핵심 품명만 (검색 적중률 — CT-F17 패턴 미러) */
export function cleanProductNameForSearch(raw: any): string {
  const s = String(raw ?? '');
  const cleaned = s
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\d+\s*(?:ml|l|g|kg|매|개|캔|병|팩|박스|봉|입|세트|ea|호|인분|포기|송이)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || s.trim()).slice(0, 80);
}

/**
 * 상품명 → 네이버 쇼핑 후보 최대 display건. 실패·미설정 = 빈 배열 (조용히 — 수동 업로드 경로 항상 병설).
 */
export async function searchNaverShopCandidates(query: string, display = 5): Promise<NaverShopCandidate[]> {
  if (!isNaverShopSearchConfigured()) return [];
  const q = cleanProductNameForSearch(query);
  if (q.length < 2) return [];
  try {
    const params = new URLSearchParams({ query: q, display: String(Math.min(Math.max(display, 1), 10)), sort: 'sim' });
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`${SHOP_API_URL}?${params.toString()}`, {
      headers: { 'X-Naver-Client-Id': NAVER_CLIENT_ID, 'X-Naver-Client-Secret': NAVER_CLIENT_SECRET },
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.log(`[naver-shop-search] API 응답 오류 status=${res.status}`);
      return [];
    }
    const data: any = await res.json();
    return (Array.isArray(data?.items) ? data.items : [])
      .filter((it: any) => {
        const img = String(it?.image || '');
        return img.startsWith('http') && !img.includes('noimage') && !img.includes('no_img');
      })
      .slice(0, display)
      .map((it: any) => ({
        title: stripHtml(it.title),
        image: String(it.image),
        link: String(it.link || ''),
        mallName: String(it.mallName || ''),
        lprice: Math.round(Number(it.lprice) || 0),
      }));
  } catch (err: any) {
    console.log('[naver-shop-search] 검색 실패:', err?.message);
    return [];
  }
}
