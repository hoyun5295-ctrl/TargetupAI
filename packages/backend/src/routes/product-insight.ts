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
import { recoCandidatesFor, signalTextsFor, SIGNAL_TEXT_NAMES_MAX } from '../utils/product-reco';
import { PAIR_WINDOW_DAYS, PAIR_COUNT_MAX, listBoughtTogether, countBoughtNotBought, listBoughtNotBought } from '../utils/product-pairs';   // ★ C152 D

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
/** 짝 목록(a · b 글자) — 꼴이 틀린 줄은 빈 짝으로 둔다(차례 보존 = 응답 수가 입력 차례와 맞는다) */
const pairList = (v: unknown, max: number): Array<{ a: string; b: string }> =>
  (Array.isArray(v) ? v.slice(0, max).map((x: any) => ({ a: typeof x?.a === 'string' ? x.a : '', b: typeof x?.b === 'string' ? x.b : '' })) : []);

// GET /pairs — 같이 산 상품(★ 2026-11-21 C152 D · 최근 보관 기간 · 산 사람이 많은 상품마다 같이 산 상품)
router.get('/pairs', guarded('pairs', async (_req, res, companyId) => {
  return res.json({ success: true, windowDays: PAIR_WINDOW_DAYS, pairs: await listBoughtTogether(companyId) });
}));

// POST /audience-counts — 줄 끝 버튼의 인원(상품 = 보고 안 산 고객 · 검색어 = 그 말을 찾은 고객) · 표와 따로 불러 표가 먼저 뜬다
router.post('/audience-counts', guarded('audience-counts', async (req, res, companyId, userId) => {
  const [products, terms, pairs] = await Promise.all([
    countViewedNotBought(companyId, userId, strList(req.body?.keys, 100)),
    countSearchedCustomers(companyId, userId, strList(req.body?.terms, 50)),
    countBoughtNotBought(companyId, userId, pairList(req.body?.pairs, PAIR_COUNT_MAX)),   // ★ C152 D 사고 안 산 고객(입력 차례 그대로)
  ]);
  return res.json({ success: true, products: Object.fromEntries(products), terms: Object.fromEntries(terms), pairs });
}));

// POST /audience — 직접발송 창에 채울 명단(지금 다시 센다 · 수신거부 · 중복 · 회신번호 검사는 직접발송 길이 그대로 한다)
router.post('/audience', guarded('audience', async (req, res, companyId, userId) => {
  const kind = req.body?.kind;
  const value = typeof req.body?.value === 'string' ? req.body.value : '';
  const other = typeof req.body?.other === 'string' ? req.body.other : '';
  if ((kind !== 'product' && kind !== 'search' && kind !== 'pair') || !value.trim() || (kind === 'pair' && !other.trim())) {
    return res.status(400).json({ success: false, error: '대상을 다시 골라 주세요.' });
  }
  const list = kind === 'product'
    ? await listViewedNotBought(companyId, userId, value)
    : kind === 'pair'
      ? await listBoughtNotBought(companyId, userId, value, other)   // ★ C152 D value = 산 상품 · other = 안 산 상품
      : await listSearchedCustomers(companyId, userId, value);
  return res.json({ success: true, kind, ...list });
}));

// POST /signal-texts — 상품 묶음(DM · 이메일)의 「반응 숫자 표시」가 받는 글자(★ 2026-11-14 C133 F2 ② · 설계서 §5-3)
//   관문 = 상품 숫자를 볼 수 있는 요청자(guarded = productInsightOpenFor · 분류코드로 나뉜 담당자에게는 닫는다 = 회사 전체 값).
//   글자 = 서버가 만든 꼴 그대로 · 조회가 없는 상품 이름은 응답에 없다. 편집기는 받은 글자를 문서에 고정한다(보여 줄 때 다시 세지 않는다).
router.post('/signal-texts', guarded('signal-texts', async (req, res, companyId) => {
  return res.json({ success: true, windowDays: PRODUCT_SIGNAL_WINDOW_DAYS, texts: await signalTextsFor(companyId, strList(req.body?.names, SIGNAL_TEXT_NAMES_MAX)) });
}));

// GET /reco-candidates — 추천 상품 후보 제안(★ 2026-11-13 C133 F2 ① · 설계서 §5-4)
//   관문 = 추천 상품이 열린 회사만(판정 = product-reco recoCandidatesFor 한 곳 · 여기는 응답 꼴만). 이름만 준다(숫자 없음 = 분류코드로 나뉜 담당자에게도 같은 응답).
//   live = false → 화면은 「추천 상품」 단추를 그리지 않는다 · hasSignals = false → 단추는 잠그고 이유 한 줄.
router.get('/reco-candidates', async (req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ success: true, ...(await recoCandidatesFor(req.user?.companyId ? String(req.user.companyId) : null)) });
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'product_signal_daily')) return;
    if (respondUserError(res, err)) return;
    console.error('[product-insight/reco-candidates] 실패:', err?.message);
    return res.status(500).json({ success: false, error: '추천 상품 후보를 불러오지 못했습니다.' });
  }
});

export default router;
