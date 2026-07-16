/**
 * ★ CT: 연동 몰 상품 정규화 (2026-07-08) — DM 상품 슬라이드 자동 채우기.
 *
 * 몰마다 다른 상품 응답을 한 모델(MallProduct)로 맞춘다. 몰별 정규화 함수는 전부 여기에 모은다(인라인 금지).
 * ⛔ 응답 스키마는 실측으로 확정한 필드만 매핑(추측 금지). 카페24 = /mall-products/preview 실측 확정.
 */

/** 이름 매칭용 정규화 — 소문자 + 공백·괄호·구분자 제거(정확 일치 판정용). 엉뚱한 상품 매칭 방지로 "정확 일치"만 쓴다. */
export function normalizeNameForMatch(s: any): string {
  return String(s ?? '').toLowerCase().replace(/[\s[\]()·・,.\-_/~]/g, '');
}

/**
 * ★ 2026-07-16 M3 — 상품 상세 URL에서 몰 상품번호 추출 (순수).
 * 고객이 행사문에 붙여넣은 링크의 번호가 곧 연동 몰의 상품 축:
 *   네이버 = brand.naver.com·smartstore.naver.com/{스토어}/products/{channelProductNo}
 *   카페24 = detail.html?product_no={no} 또는 SEO형 /product/{이름}/{no}/
 * 번호 일치 = "그 상품" 기계 확정 — 이름 유사도가 아니라 ID라 오매칭이 구조적으로 불가능 (설계서 §2-5).
 */
export function extractMallProductNo(url: any): string | null {
  const s = String(url ?? '').trim();
  if (!s) return null;
  let m = s.match(/\/products\/(\d+)/);
  if (m) return m[1];
  m = s.match(/[?&]product_no=(\d+)/);
  if (m) return m[1];
  m = s.match(/\/product\/[^/]+\/(\d+)(?:[/?#]|$)/);
  if (m) return m[1];
  return null;
}

export interface MallProduct {
  provider: string;
  code: string;          // 몰 상품 코드/번호 (식별)
  name: string;
  price: number;         // 정가 (취소선)
  salePrice: number;     // 판매가 (실제 판매가)
  discountRate: number;  // 할인율 % (정가↔판매가 계산, 없으면 0)
  imageUrl: string | null;   // 대표 이미지 (몰 외부 URL — 선택 시 우리 스토리지로 복사)
  productUrl: string | null; // 상품 상세 링크
}

/**
 * 카페24 상품(GET /api/v2/admin/products 항목) → MallProduct.
 * 실측 확정: retail_price=정가 · price=판매가 · list_image/detail_image/small_image · selling/display/sold_out.
 * 판매·전시 중 + 품절 아님만 통과. 상품링크는 응답에 없어 mallId로 구성.
 */
export function normalizeCafe24Product(p: any, mallId: string): MallProduct | null {
  if (!p || typeof p !== 'object') return null;
  if (String(p.selling) !== 'T' || String(p.display) !== 'T' || String(p.sold_out) === 'T') return null;
  const name = String(p.product_name || '').trim();
  const sale = Math.round(Number(p.price) || 0);          // 판매가
  const retail = Math.round(Number(p.retail_price) || 0); // 정가(소비자가)
  if (!name || sale <= 0) return null;
  const price = retail > 0 ? retail : sale;               // 정가 없으면 판매가로
  const discountRate = price > sale && price > 0 ? Math.round((1 - sale / price) * 100) : 0;
  const img = p.detail_image || p.list_image || p.small_image || p.tiny_image || null;
  const productNo = p.product_no;
  const productUrl = productNo ? `https://${mallId}.cafe24.com/product/detail.html?product_no=${productNo}` : null;
  return {
    provider: 'cafe24',
    code: String(p.product_code || productNo || ''),
    name: name.slice(0, 120),
    price,
    salePrice: sale,
    discountRate,
    imageUrl: img ? String(img) : null,
    productUrl,
  };
}

/**
 * 네이버 커머스 channelProduct(contents[].channelProducts[] 항목) → MallProduct.
 * 실측 확정: salePrice=정가(판매설정가) · discountedPrice=판매가(할인적용) · representativeImage.url(목록에 바로 옴) ·
 *   channelProductNo=상품번호 · statusType='SALE' + channelProductDisplayStatusType='ON'만.
 * 상품링크 = storeUrl(스마트스토어 주소)/products/{channelProductNo} — storeUrl 미확정 시 null.
 */
export function normalizeNaverProduct(cp: any, storeUrl?: string): MallProduct | null {
  if (!cp || typeof cp !== 'object') return null;
  if (String(cp.statusType) !== 'SALE') return null;
  if (cp.channelProductDisplayStatusType && String(cp.channelProductDisplayStatusType) !== 'ON') return null;
  const name = String(cp.name || '').trim();
  const listPrice = Math.round(Number(cp.salePrice) || 0);           // 정가(판매설정가)
  if (!name || listPrice <= 0) return null;
  const discounted = Math.round(Number(cp.discountedPrice) || 0);    // 할인적용가
  const salePrice = discounted > 0 && discounted < listPrice ? discounted : listPrice; // 판매가
  const discountRate = listPrice > salePrice && listPrice > 0 ? Math.round((1 - salePrice / listPrice) * 100) : 0;
  const img = cp.representativeImage?.url || null;
  const no = cp.channelProductNo;
  const base = (storeUrl || '').replace(/\/+$/, '');
  const productUrl = base && no ? `${base}/products/${no}` : null;
  return {
    provider: 'naver',
    code: String(no || cp.originProductNo || ''),
    name: name.slice(0, 120),
    price: listPrice,   // 정가
    salePrice,          // 판매가
    discountRate,
    imageUrl: img ? String(img) : null,
    productUrl,
  };
}
