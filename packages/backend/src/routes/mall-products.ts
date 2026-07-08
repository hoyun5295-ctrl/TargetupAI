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
import { getNaverCommerceIntegration, getNaverCommerceCredentials, fetchNaverProductsRaw } from '../utils/naver-commerce-client';

export const mallProductsRouter = Router();
mallProductsRouter.use(authenticate);

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

    return res.status(400).json({
      success: false,
      error: 'provider는 cafe24 또는 naver만 지원합니다 (메이크샵·고도몰·아임웹은 상품 API 조사 후 추가).',
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

    return res.status(400).json({
      success: false,
      error: '현재 상품 불러오기는 카페24만 지원합니다 (네이버 등은 항목 필드 실측 후 추가).',
    });
  } catch (err: any) {
    console.error('[mall-products search] 오류:', err?.message);
    return res.status(502).json({ success: false, error: err?.message || '상품 조회 실패' });
  }
});
