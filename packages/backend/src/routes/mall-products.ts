/**
 * 연동 몰 상품 조회 API (2026-07-08) — DM 상품 슬라이드 자동 채우기 소스.
 *
 * 1단계 = raw preview(실측): GET /api/mall-products/preview?provider=cafe24|naver&q=검색어
 *   → 연동된 몰의 상품 API 응답을 그대로 반환. 이미지·정가·할인가·상품링크 필드를 실측으로 확정한 뒤
 *     정규화 매핑 + DM 상품 피커를 붙인다(응답 스키마 추측 금지 영구 룰).
 *   메이크샵·고도몰·아임웹은 각 상품 API 조사 후 추가.
 */
import { Router, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import { getCafe24Integration, getCafe24ByoCredentials, fetchCafe24ProductsRaw, fetchCafe24Products } from '../utils/cafe24-client';
import { getNaverCommerceIntegration, getNaverCommerceCredentials, fetchNaverProductsRaw, fetchNaverProducts } from '../utils/naver-commerce-client';
import { matchMallProductByName } from '../utils/mall-product-match';
// ★ 2026-09-14 W5 우커머스 — Store API 공개 조회(키 불필요) · 몰별 탭 provider = woocommerce:{mall}
import { listWooIntegrations, getWooIntegration, fetchWooStoreProducts, fetchWooStoreProductsRaw } from '../utils/woocommerce-client';
import { normalizeWooMallId } from '../utils/woocommerce-core';
// ★ 2026-09-18 몰별 사용자 범위 — 관리자는 회사 전체 몰 · 사용자는 자기 분류코드 몰만(설계서 docs/2026-09-18-mall-integration-user-scope-design.md §3-5)
import { resolveIntegrationActor, canTouchIntegration, type IntegrationActor } from '../utils/integration-scope';

const WOO_PREFIX = 'woocommerce:';
/**
 * provider 'woocommerce:{mall}' → 이 회사 소속 + 이 주체가 다룰 수 있는 몰 행(없으면 undefined).
 * 타사 몰 주소로 조회하는 길과, 남의 분류코드 몰을 provider 문자열로 찍어 읽는 길을 함께 막는다.
 */
async function wooMallOf(companyId: string, provider: string, actor: IntegrationActor) {
  const mallId = normalizeWooMallId(provider.slice(WOO_PREFIX.length));
  const integ = mallId ? await getWooIntegration(companyId, mallId) : undefined;
  if (!integ || !canTouchIntegration(actor, integ.storeCode)) return undefined;
  return integ;
}

export const mallProductsRouter = Router();
mallProductsRouter.use(authenticate);

// GET /providers — 이 회사가 연동한 "상품 불러오기 지원" 몰 목록 (피커 탭 구성용)
mallProductsRouter.get('/providers', async (req: any, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const providers: Array<{ provider: string; label: string }> = [];
    const cafe = await getCafe24Integration(companyId).catch(() => null);
    if (cafe) providers.push({ provider: 'cafe24', label: '카페24' });
    const naver = await getNaverCommerceIntegration(companyId).catch(() => null);
    if (naver) providers.push({ provider: 'naver', label: '네이버 스마트스토어' });
    // 우커머스 — 몰별 탭(해제 몰 제외). Store API 가 공개라 연결 검증 전이라도 상품은 읽힌다.
    //   ★ 2026-09-18 사용자는 자기 분류코드 몰만(관리자는 전체 · 분류 미배정 사용자는 0개).
    const actor = await resolveIntegrationActor(req.user);
    const woo = (await listWooIntegrations(companyId).catch(() => [])).filter((m) => canTouchIntegration(actor, m.storeCode));
    for (const m of woo) providers.push({ provider: `woocommerce:${m.mallId}`, label: `우커머스 · ${m.mallId}` });
    return res.json({ success: true, providers });
  } catch (err: any) {
    console.error('[mall-products providers] 오류:', err?.message);
    return res.status(500).json({ success: false, error: err?.message || '연동 몰 조회 실패' });
  }
});

// GET /preview?provider=cafe24|naver&q= — 연동 몰 상품 raw 응답(실측)
mallProductsRouter.get('/preview', async (req: any, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const provider = String(req.query.provider || '').trim();
    const q = req.query.q ? String(req.query.q).trim() : undefined;

    if (provider === 'cafe24') {
      const integ = await getCafe24Integration(companyId);
      if (!integ) return res.status(404).json({ success: false, error: '카페24 연동이 없습니다.' });
      const creds = await getCafe24ByoCredentials(companyId, integ.mallId).catch(() => undefined);
      const raw = await fetchCafe24ProductsRaw(integ, { limit: 5, productName: q }, creds);
      return res.json({ success: true, provider, mallId: integ.mallId, raw });
    }

    if (provider === 'naver') {
      const integ = await getNaverCommerceIntegration(companyId);
      if (!integ) return res.status(404).json({ success: false, error: '네이버 스마트스토어 연동이 없습니다.' });
      const creds = (await getNaverCommerceCredentials(companyId).catch(() => null)) || undefined;
      const raw = await fetchNaverProductsRaw(integ, { size: 5, searchKeyword: q }, creds);
      return res.json({ success: true, provider, storeId: integ.storeId, raw });
    }

    if (provider.startsWith('woocommerce:')) {
      const integ = await wooMallOf(companyId, provider, await resolveIntegrationActor(req.user));
      if (!integ) return res.status(404).json({ success: false, error: '우커머스 연동이 없는 몰입니다.' });
      const raw = await fetchWooStoreProductsRaw(integ.siteUrl, { q, limit: 5 });
      return res.json({ success: true, provider, mallId: integ.mallId, raw });
    }

    return res.status(400).json({
      success: false,
      error: 'provider는 cafe24 · naver · woocommerce:{몰}만 지원합니다 (메이크샵·고도몰·아임웹은 상품 API 조사 후 추가).',
    });
  } catch (err: any) {
    // 실측 라우트 — 몰 API 에러(스코프 미동의·필수 body 누락 등)를 그대로 노출해 매핑 확정에 쓴다.
    console.error('[mall-products preview] 오류:', err?.message);
    return res.status(502).json({ success: false, error: err?.message || '상품 조회 실패' });
  }
});

// GET /search?provider=cafe24&q=&limit= — 정규화 상품 목록(MallProduct[]) — DM 상품 피커 소스
//   카페24 = 실측 확정. 네이버·메이크샵·고도몰·아임웹은 각 항목 필드 실측 후 추가.
mallProductsRouter.get('/search', async (req: any, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const provider = String(req.query.provider || '').trim();
    const q = req.query.q ? String(req.query.q).trim() : undefined;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 100);

    if (provider === 'cafe24') {
      const integ = await getCafe24Integration(companyId);
      if (!integ) return res.status(404).json({ success: false, error: '카페24 연동이 없습니다.' });
      const creds = await getCafe24ByoCredentials(companyId, integ.mallId).catch(() => undefined);
      const products = await fetchCafe24Products(integ, { q, limit }, creds);
      return res.json({ success: true, provider, products });
    }

    if (provider === 'naver') {
      const integ = await getNaverCommerceIntegration(companyId);
      if (!integ) return res.status(404).json({ success: false, error: '네이버 스마트스토어 연동이 없습니다.' });
      const creds = (await getNaverCommerceCredentials(companyId).catch(() => null)) || undefined;
      // storeUrl(스마트스토어 주소 슬러그) 확정 전 — 링크는 null. 확정 후 opts.storeUrl 주입.
      const products = await fetchNaverProducts(integ, { q, size: limit }, creds);
      return res.json({ success: true, provider, products });
    }

    if (provider.startsWith('woocommerce:')) {
      const integ = await wooMallOf(companyId, provider, await resolveIntegrationActor(req.user));
      if (!integ) return res.status(404).json({ success: false, error: '우커머스 연동이 없는 몰입니다.' });
      const products = await fetchWooStoreProducts(integ.siteUrl, { q, limit });
      return res.json({ success: true, provider, products });
    }

    return res.status(400).json({
      success: false,
      error: '현재 상품 불러오기는 카페24·네이버·우커머스만 지원합니다 (메이크샵·고도몰·아임웹은 실측 후 추가).',
    });
  } catch (err: any) {
    console.error('[mall-products search] 오류:', err?.message);
    return res.status(502).json({ success: false, error: err?.message || '상품 조회 실패' });
  }
});

// GET /match?name=&provider=&link= — 상품 매칭 1건(없으면 product:null). 슬라이드 상품명 → 이미지 자동 채우기용.
// ★ 2026-07-16 M3 — link(상품 링크) 제공 시 상품번호 ID 확정 매칭 최우선 (이름 표기 달라도 그 상품 — 오매칭 구조적 0)
mallProductsRouter.get('/match', async (req: any, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const name = String(req.query.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: '상품명이 필요합니다.' });
    const provider = req.query.provider ? String(req.query.provider).trim() : undefined;
    const linkUrl = req.query.link ? String(req.query.link).trim() : undefined;
    const product = await matchMallProductByName(companyId, name, provider, linkUrl);
    return res.json({ success: true, product: product || null });
  } catch (err: any) {
    console.error('[mall-products match] 오류:', err?.message);
    return res.status(502).json({ success: false, error: err?.message || '상품 매칭 실패' });
  }
});
