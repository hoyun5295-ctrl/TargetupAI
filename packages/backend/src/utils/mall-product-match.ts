/**
 * ★ CT: 연동 몰 상품 이름 매칭 (2026-07-08) — 자동 이름매칭.
 *
 * 상품명이 연동 몰의 상품명과 "정규화 후 정확히 일치"할 때만 그 상품(이미지·정가·판매가·링크)을 돌려준다.
 * ⛔ 애매/부분 일치는 매칭하지 않는다(엉뚱한 상품 이미지 첨부 방지 — 없는 값 지어내기 금지 정신).
 * 몰 API 실패는 조용히 skip(생성·입력 흐름 무영향).
 */
import { getCafe24Integration, getCafe24ByoCredentials, fetchCafe24Products } from './cafe24-client';
import { getNaverCommerceIntegration, getNaverCommerceCredentials, fetchNaverProducts } from './naver-commerce-client';
import { type MallProduct, normalizeNameForMatch, extractMallProductNo } from './mall-product-normalize';

const SUPPORTED_PROVIDERS = ['cafe24', 'naver'];

/**
 * 상품명 → 연동 몰에서 매칭 1건(없으면 null). provider 미지정 시 연동 몰 순회.
 * ★ 2026-07-16 M3 — linkUrl(사용자가 붙여넣은 상품 링크) 제공 시 **상품번호 일치를 최우선 확정**:
 *   이름 검색 결과 중 링크 번호와 같은 상품이 있으면 이름 표기가 달라도 그 상품(ID 확정 — 오매칭 구조적 0).
 *   번호 일치가 없을 때만 기존 이름 정확 일치 폴백 (기존 소비처 동작 보존).
 */
export async function matchMallProductByName(companyId: string, name: string, provider?: string, linkUrl?: string): Promise<MallProduct | null> {
  const target = normalizeNameForMatch(name);
  if (!companyId || target.length < 2) return null;
  const linkNo = extractMallProductNo(linkUrl);
  const providers = provider ? [provider] : SUPPORTED_PROVIDERS;
  for (const prov of providers) {
    try {
      let products: MallProduct[] = [];
      if (prov === 'cafe24') {
        const integ = await getCafe24Integration(companyId).catch(() => null);
        if (!integ) continue;
        const creds = await getCafe24ByoCredentials(companyId, integ.mallId).catch(() => undefined);
        products = await fetchCafe24Products(integ, { q: name, limit: 20 }, creds);
      } else if (prov === 'naver') {
        const integ = await getNaverCommerceIntegration(companyId).catch(() => null);
        if (!integ) continue;
        const creds = (await getNaverCommerceCredentials(companyId).catch(() => null)) || undefined;
        products = await fetchNaverProducts(integ, { q: name, size: 20 }, creds);
      }
      if (linkNo) {
        const byId = products.find((p) => String(p.code) === linkNo || extractMallProductNo(p.productUrl) === linkNo);
        if (byId) return byId;
      }
      const exact = products.find((p) => normalizeNameForMatch(p.name) === target);
      if (exact) return exact;
    } catch {
      // 몰 API 실패 = 매칭 skip
    }
  }
  return null;
}

/**
 * 생성된 섹션(DM·이메일 공용 — 동일 shape)의 product_carousel 항목명으로 몰 상품을 이름매칭
 * → 이미지·링크·정가·할인가를 자동 첨부. 이미 채워진 값은 덮지 않는다(빈 값만). 실패는 skip. 안전 상한(12건).
 */
export async function attachMallImagesToProductCarousels(companyId: string, sections: any): Promise<void> {
  if (!companyId || !Array.isArray(sections)) return;
  let matched = 0;
  for (const sec of sections) {
    if (sec?.type !== 'product_carousel') continue;
    const items = sec?.props?.products;
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      if (matched >= 12) return;
      const nm = String(it?.name || '').trim();
      const hasImg = !!(it?.image_url && String(it.image_url).trim());
      if (!nm || hasImg) continue;
      // ★ 2026-07-16 M3 — 행사문에 붙여넣은 상품 링크가 있으면 번호 축 ID 확정 매칭 (오매칭 구조적 0)
      const linkUrl = String(it?.link_url || '').trim() || undefined;
      // eslint-disable-next-line no-await-in-loop
      const m = await matchMallProductByName(companyId, nm, undefined, linkUrl);
      if (!m) continue;
      matched++;
      if (m.imageUrl) it.image_url = m.imageUrl;
      if (m.productUrl && !(it.link_url && String(it.link_url).trim())) it.link_url = m.productUrl;
      if (m.price > 0 && !(Number(it.price) > 0)) it.price = m.price;
      if (m.salePrice > 0 && m.salePrice < m.price && !(Number(it.discount_price) > 0)) it.discount_price = m.salePrice;
    }
  }
}
