import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../config/database';
import { readPlanFreeQuotas } from '../utils/free-messaging';
import { authenticate } from '../middlewares/auth';
import { parseFeatureSeen, recordFeatureSeen, FEATURE_SEEN_RATE } from '../utils/feature-interest';
import { buildFeatureIntrosPayload, resolveSignedMedia } from '../utils/plan-feature-intros-serve';
import fs from 'fs';
import { claimIntro, dismissIntro, peekIntro } from '../utils/v3-intro';   // ★ 2026-11-13 C133 F7 · ★ 2026-11-16 C136 준비(peek)
import { canSeeIntroContent, gatedImageFile, GATED_CACHE_CONTROL } from '../utils/gated-content';   // ★ 2026-11-16 C136 로그인 뒤에만 주는 소개 그림
import { v3FeaturesFor } from '../utils/v3-stage';   // ★ 2026-11-13 C133 단계 개방
import { handleDbMigrationError } from '../utils/db-migration-error';
import { PUBLIC_CATALOG_PLAN_SQL } from '../utils/plan-guard';   // ★ 2026-11-18 C144

const router = Router();

/**
 * ★ 2026-10-19 B-0816-1③ — 비로그인에도 열린 목록이라 화면이 읽는 칸만 내보낸다(내부 기능 플래그 · 한도 칸 비공개).
 * 소비처 4곳(PricingPage · TrialUpsellModal · 슈퍼관리자 회사 등록 · 회사 상세 요금제 선택)이 읽는 칸 전부 = 아래 7개.
 * 요금제 관리(전 칸)는 슈퍼관리자 전용 `/api/admin/plans` 가 따로 소유한다.
 */
export const PUBLIC_PLAN_FIELDS = ['id', 'plan_code', 'plan_name', 'max_customers', 'monthly_price', 'is_active', 'ai_credits_per_month'] as const;
export function publicPlanRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(PUBLIC_PLAN_FIELDS.filter((k) => k in row).map((k) => [k, row[k]]));
}

// GET /api/plans - 요금제 목록 (인증 불필요)
//   ★ 2026-09-03 planQuotas 동반 — 비로그인 요금제 안내(/pricing 방문자 모드)가 "포함된 무료 메시지"를
//     그리려면 로그인 전용 /companies/my-free-messaging 없이도 요금제별 수량이 필요하다.
//     같은 CT(readPlanFreeQuotas · plans.free_*_qty 파생)를 쓰므로 진실은 여전히 plans 한 곳이다.
//     DDL 미실행이면 CT가 {}를 돌려주고, 그 밖의 실패도 목록 자체는 막지 않는다(키 추가라 기존 소비처 무영향).
router.get('/', async (req: Request, res: Response) => {
  try {
    // ★ 2026-11-18 C144 제휴 판(JBN 특별가)은 공개 목록에 없다(그 가격은 /jbn 링크에서만 · 판정 = PUBLIC_CATALOG_PLAN_SQL)
    const result = await query(
      `SELECT * FROM plans p WHERE p.is_active = true AND ${PUBLIC_CATALOG_PLAN_SQL} ORDER BY p.monthly_price ASC`
    );

    let planQuotas: Record<string, Record<string, number>> = {};
    try {
      planQuotas = await readPlanFreeQuotas();
    } catch (err) {
      console.error('요금제 무료 수량 조회 실패(목록은 계속):', err);
    }

    return res.json({ plans: result.rows.map(publicPlanRow), planQuotas });
  } catch (error) {
    console.error('요금제 목록 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ★ 2026-10-06 기능 안내 창 열람 · 「요금제 보기」 기록(로그인 필수 · 고객사 사용자만) — 슈퍼관리자 「기능 관심 업체」의 원천.
//   기록 실패는 화면에 영향이 없다(recordAuditLog 가 삼킨다) · 모르는 값은 기록하지 않고 204.
// ★ Codex 1R — 사용자당 호출 상한(공용 audit_logs 가 반복 호출로 불어나지 않게 · 넘으면 INSERT 전에 429 · 화면은 결과를 보지 않는다)
const featureSeenLimiter = rateLimit({
  ...FEATURE_SEEN_RATE,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `feature-seen:${req.user?.userId || 'anon'}`,
  message: { success: false, error: '요청이 너무 잦습니다.', code: 'RATE_LIMITED' },
});

router.post('/feature-seen', authenticate, featureSeenLimiter, async (req: Request, res: Response) => {
  const input = parseFeatureSeen(req.body);
  if (input) await recordFeatureSeen(req, input);
  return res.status(204).end();
});

// ★ 2026-11-13 C133 F7 — 로그인 직후 「한줄로 V3」 소개 창(판정 · SQL = utils/v3-intro.ts · 설계서 docs/2026-11-13-hanjul-v3-design.md §2).
//   claim = 띄울지 묻는 것이 곧 노출 한 번을 쓰는 것(서버 한 문장 선점 · 계정당 최대 3번 · 로그인당 1번) · 로그인 표식은 요청의 토큰에서 서버가 만든다.
//   표가 없으면(DDL 전) 503 DB_MIGRATION_PENDING → 화면은 띄우지 않는다. 그 밖의 실패도 화면은 띄우지 않는다(모르면 띄우지 않는다).
const bearerOf = (req: Request): string | null => {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() || null : null;
};
// ★ 2026-11-16 C136(설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §2-1) — 순서 = 준비(peek) → 그림 받기 → 선점(claim).
//   peek = 이 로그인에 띄울 판과 그 판의 글을 준다 · 노출을 쓰지 않는다(그림을 못 받은 로그인이 노출 수를 태우지 않게).
//   claim = 화면이 준비한 판의 열쇠(introKey)를 싣고 온다 · 서버 판정이 그 열쇠와 같을 때만 노출 한 번을 쓴다.
//   글 · 그림은 로그인한 고객사 사용자에게만(에이전트 전용 회사 제외) · 머리말 = private, no-store.
router.get('/v3-intro/peek', authenticate, featureSeenLimiter, async (req: Request, res: Response) => {
  try {
    const out = await peekIntro(req.user as any, bearerOf(req));
    res.setHeader('Cache-Control', GATED_CACHE_CONTROL);
    return res.json({ success: true, ...out });
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'user_intro_acks')) return;
    console.error('[plans/v3-intro/peek] 실패:', err?.message);
    return res.status(500).json({ success: false, error: '소개를 불러오지 못했습니다.' });
  }
});
router.post('/v3-intro/claim', authenticate, featureSeenLimiter, async (req: Request, res: Response) => {
  try {
    const out = await claimIntro(req.user as any, bearerOf(req), req.body?.introKey);
    res.setHeader('Cache-Control', GATED_CACHE_CONTROL);
    return res.json({ success: true, ...out });
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'user_intro_acks')) return;
    console.error('[plans/v3-intro/claim] 실패:', err?.message);
    return res.status(500).json({ success: false, error: '소개를 불러오지 못했습니다.' });
  }
});
router.post('/v3-intro/dismiss', authenticate, featureSeenLimiter, async (req: Request, res: Response) => {
  try {
    await dismissIntro(req.user as any, req.body?.introKey);   // ★ 2026-11-15 C135 판 열쇠(닫힌 목록 검증 = CT)
    return res.json({ success: true });
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'user_intro_acks')) return;
    console.error('[plans/v3-intro/dismiss] 실패:', err?.message);
    return res.status(500).json({ success: false, error: '저장하지 못했습니다.' });
  }
});

// ★ 2026-11-16 C136 — 소개 그림(로그인 필수 · 고객사 사용자 · 에이전트 전용 회사 제외 · 보관 폴더에 있는 이름만 · 판정 = utils/gated-content.ts).
//   화면은 로그인 토큰으로 받아 blob 주소로 바꿔 쓴다(img 주소로 직접 열 수 없다 = 주소를 알아도 로그인 없이는 못 받는다).
//   못 주는 경우는 전부 404(있는 이름인지 알려 주지 않는다) · 회사 조회 실패 = 503.
const gatedImageLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 240,   // 창 하나 = 그림 9장 · 제안 페이지 = 12장(새로고침 여유 포함)
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `gated-img:${req.user?.userId || 'anon'}`,
  message: { success: false, error: '요청이 너무 잦습니다.', code: 'RATE_LIMITED' },
});
router.get('/gated/img/:name', authenticate, gatedImageLimiter, async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', GATED_CACHE_CONTROL);
  let allowed = false;
  try {
    allowed = await canSeeIntroContent(req.user as any);
  } catch (err: any) {
    console.error('[plans/gated/img] 회사 조회 실패:', err?.message);
    return res.status(503).json({ success: false, error: '잠시 후 다시 시도해 주세요.' });
  }
  const file = allowed ? gatedImageFile(req.params.name) : null;
  if (!file) return res.status(404).json({ success: false, error: '찾을 수 없습니다.' });
  res.setHeader('Content-Type', file.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const stream = fs.createReadStream(file.absPath);
  stream.on('error', () => { if (!res.headersSent) res.status(404).end(); else res.end(); });
  return stream.pipe(res);
});

// ★ 2026-11-13 C133 — 이 회사에 지금 열린 V3 기능(화면이 입구를 그릴지 묻는다 · 판정 = utils/v3-stage.ts 한 곳 · 닫힌 회사 = 전부 false).
//   값은 입구를 그릴지에만 쓴다(권한은 각 기능의 서버 길이 다시 판정한다). 요금제를 못 읽으면 success: false(모름 = 화면은 이번에만 그리지 않고 다음에 다시 묻는다).
router.get('/v3-features', authenticate, async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const user = req.user as any;
  const companyId = user?.userType === 'super_admin' ? null : user?.companyId;
  const features = await v3FeaturesFor(companyId);
  if (!features) return res.json({ success: false, code: 'UNKNOWN' });
  return res.json({ success: true, features });
});

// ★ 2026-10-07 기능 안내 원장 · 영상 — 로그인한 사람에게만(Harold 「구멍 자체를 만들지 마」) · 소유 = utils/plan-feature-intros-serve.ts
router.get('/feature-intros', authenticate, async (req: Request, res: Response) => {
  try {
    const payload = await buildFeatureIntrosPayload(req.user as any);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ success: true, ...payload });
  } catch (err: any) {
    console.error('[plans/feature-intros] 실패:', err?.message);
    return res.status(500).json({ success: false, error: '기능 안내를 불러오지 못했습니다.' });
  }
});

// 영상 · 첫 장면 그림 — 서명 주소만(<video> 는 토큰 머리글을 못 싣는다) · 틀리거나 만료면 404(있는지도 드러내지 않는다)
router.get('/feature-media', (req: Request, res: Response) => {
  const abs = resolveSignedMedia(String(req.query.f || ''), req.query);
  if (!abs) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.sendFile(abs);
});

export default router;
