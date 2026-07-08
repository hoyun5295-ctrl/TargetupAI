/**
 * ★ CT: 연동 몰 상품 정규화 (2026-07-08) — DM 상품 슬라이드 자동 채우기.
 *
 * 몰마다 다른 상품 응답을 한 모델(MallProduct)로 맞춘다. 몰별 정규화 함수는 전부 여기에 모은다(인라인 금지).
 * ⛔ 응답 스키마는 실측으로 확정한 필드만 매핑(추측 금지). 카페24 = /mall-products/preview 실측 확정.
 */

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
