import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../config/database';
import { readPlanFreeQuotas } from '../utils/free-messaging';
import { authenticate } from '../middlewares/auth';
import { parseFeatureSeen, recordFeatureSeen, FEATURE_SEEN_RATE } from '../utils/feature-interest';
import { buildFeatureIntrosPayload, resolveSignedMedia } from '../utils/plan-feature-intros-serve';
import { claimIntro, dismissIntro } from '../utils/v3-intro';   // ★ 2026-11-13 C133 F7
import { v3FeaturesFor } from '../utils/v3-stage';   // ★ 2026-11-13 C133 단계 개방
import { handleDbMigrationError } from '../utils/db-migration-error';

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
    const result = await query(
      `SELECT * FROM plans WHERE is_active = true ORDER BY monthly_price ASC`
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
router.post('/v3-intro/claim', authenticate, featureSeenLimiter, async (req: Request, res: Response) => {
  try {
    const out = await claimIntro(req.user as any, bearerOf(req));
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ success: true, ...out });
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'user_intro_acks')) return;
    console.error('[plans/v3-intro/claim] 실패:', err?.message);
    return res.status(500).json({ success: false, error: '소개를 불러오지 못했습니다.' });
  }
});
router.post('/v3-intro/dismiss', authenticate, featureSeenLimiter, async (req: Request, res: Response) => {
  try {
    await dismissIntro(req.user as any);
    return res.json({ success: true });
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'user_intro_acks')) return;
    console.error('[plans/v3-intro/dismiss] 실패:', err?.message);
    return res.status(500).json({ success: false, error: '저장하지 못했습니다.' });
  }
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
