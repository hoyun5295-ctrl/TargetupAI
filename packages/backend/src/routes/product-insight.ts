/**
 * ★ 2026-11-13 C133 F2 ③ — 성과리포트 「상품 · 검색어」 탭의 서버 길(설계서 docs/2026-11-13-hanjul-v3-design.md §5-2).
 *
 * 판정 · SQL = utils/product-signal.ts 한 곳(여기는 관문과 응답 꼴만).
 * 관문 = 로그인 → 단계 개방(v3Live 'product-insight' · 요금제가 먼저) → 분류코드로 나뉜 담당자에게는 닫는다
 *   (상품 조회 수는 회사 전체 값이라 담당자의 범위로 나눌 수 없다 = 「사용자는 자기 것」 원칙 · 그 담당자에게는 탭 자체가 없다).
 * 닫힌 회사에는 `/summary` 가 live: false 만 준다(화면은 탭을 그리지 않는다) · 나머지 주소는 403.
 * 표가 없으면(DDL 전) 503 DB_MIGRATION_PENDING.
 */
import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { respondUserError } from '../utils/http-error';
import {
  PRODUCT_SIGNAL_WINDOW_DAYS, productInsightOpenFor,
  listProductSignals, hasProductSignals, listSearchTerms,
  countViewedNotBought, countSearchedCustomers, listViewedNotBought, listSearchedCustomers,
} from '../utils/product-signal';

const router = Router();
router.use(authenticate);

type Handler = (req: Request, res: Response, companyId: string, userId: string) => Promise<unknown>;
/** 관문 + 오류 꼴을 한 번만 적는다 */
const guarded = (label: string, work: Handler) => async (req: Request, res: Response) => {
  try {
    if (!(await productInsightOpenFor(req.user as any))) {
      return res.status(403).json({ success: false, code: 'V3_STAGE_CLOSED', error: '이 화면을 쓸 수 없습니다.' });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    return await work(req, res, String(req.user!.companyId), String(req.user!.userId));
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'product_signal_daily')) return;
    if (respondUserError(res, err)) return;
    console.error(`[product-insight/${label}] 실패:`, err?.message);
    return res.status(500).json({ success: false, error: '상품 반응을 불러오지 못했습니다.' });
  }
};

// GET /summary — 탭을 그릴지(닫힌 회사 = live:false 한 줄 · 그 밖의 값은 주지 않는다)
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const live = await productInsightOpenFor(req.user as any);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ success: true, live });
  } catch (err: any) {
    console.error('[product-insight/summary] 실패:', err?.message);
    return res.json({ success: true, live: false });   // 모르면 그리지 않는다
  }
});

// GET /products — 최근 30일 상품 표(앞 30일 비교 칸 포함)
router.get('/products', guarded('products', async (_req, res, companyId) => {
  const [products, hasSignals] = await Promise.all([listProductSignals(companyId), hasProductSignals(companyId)]);
  return res.json({ success: true, windowDays: PRODUCT_SIGNAL_WINDOW_DAYS, hasSignals, products });
}));

// GET /search-terms — 최근 30일 검색어 순위
router.get('/search-terms', guarded('search-terms', async (_req, res, companyId) => {
  return res.json({ success: true, windowDays: PRODUCT_SIGNAL_WINDOW_DAYS, terms: await listSearchTerms(companyId) });
}));

const strList = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, max) : []);

// POST /audience-counts — 줄 끝 버튼의 인원(상품 = 보고 안 산 고객 · 검색어 = 그 말을 찾은 고객) · 표와 따로 불러 표가 먼저 뜬다
router.post('/audience-counts', guarded('audience-counts', async (req, res, companyId, userId) => {
  const [products, terms] = await Promise.all([
    countViewedNotBought(companyId, userId, strList(req.body?.keys, 100)),
    countSearchedCustomers(companyId, userId, strList(req.body?.terms, 50)),
  ]);
  return res.json({ success: true, products: Object.fromEntries(products), terms: Object.fromEntries(terms) });
}));

// POST /audience — 직접발송 창에 채울 명단(지금 다시 센다 · 수신거부 · 중복 · 회신번호 검사는 직접발송 길이 그대로 한다)
router.post('/audience', guarded('audience', async (req, res, companyId, userId) => {
  const kind = req.body?.kind;
  const value = typeof req.body?.value === 'string' ? req.body.value : '';
  if ((kind !== 'product' && kind !== 'search') || !value.trim()) {
    return res.status(400).json({ success: false, error: '대상을 다시 골라 주세요.' });
  }
  const list = kind === 'product'
    ? await listViewedNotBought(companyId, userId, value)
    : await listSearchedCustomers(companyId, userId, value);
  return res.json({ success: true, kind, ...list });
}));

export default router;
