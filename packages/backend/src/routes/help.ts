/**
 * routes/help.ts — 도움말 봇 · 기능 카탈로그 API (★ 2026-08-22 신설)
 *
 * 설계 = docs/FEATURE-HELP-CATALOG.md. 판정·조립은 CT(`utils/help-answer.ts` · `content/feature-catalog.ts`)가 소유한다.
 *
 * 노출 = **요금제 사용 중인 회사만**(Harold 2026-08-22 지시). 판정은 서버가 한다 — 프론트가 요금제를 받아 판정하면 두 벌이 된다.
 *   기준 = `plan-guard`의 `ACTIVE_PAID_PLAN_WHERE`와 같은 식(plan_code <> FREE · 구독이 만료·정지 아님). 슈퍼관리자는 항상.
 * 모드 = 묻지 않는다. 발송 이력(PG campaigns)이 없으면 온보딩, 있으면 도움말.
 *   ⛔ 발송 이력 판정에 MySQL 큐를 읽지 않는다 — 같은 날 고객 360이 회사 조건 없이 읽어 타사 발송이 노출된 자리다.
 * ⛔ 이 라우트는 `X-Credit-*` 헤더를 싣지 않는다. 전역 인터셉터가 그 헤더를 잡아 차감 토스트를 띄운다.
 * ⛔ `help_questions`는 신규 테이블 — 없으면 503 DB_MIGRATION_PENDING(db_alter_safety_net). 단 답변 자체는 기록 실패와 무관하게 나간다.
 */
import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { loadPlanContext, canUseFeature, type PlanContext } from '../utils/plan-guard';
import {
  FEATURE_CATALOG, JOB_GROUPS, findJob, jobsForPath, toPublicJob, normalizePath, type PublicFeatureJob,
} from '../content/feature-catalog';
import { answerHelpQuestion, HELP_MAX_HISTORY, HELP_MAX_QUESTION } from '../utils/help-answer';
import { getOnboardingState } from '../utils/onboarding-wizard';

const router = Router();
router.use(authenticate);

/** 요금제 사용 중인가(Harold 2026-08-22: 요금제를 쓰는 회사에만 봇을 보인다) */
function isPaidPlan(ctx: PlanContext | null): boolean {
  if (!ctx) return false;
  if (ctx.planCode === 'FREE') return false;
  return ctx.subscriptionStatus !== 'expired' && ctx.subscriptionStatus !== 'suspended';
}

async function resolveEligibility(req: Request): Promise<{ ok: boolean; ctx: PlanContext | null; companyId: string | null }> {
  const companyId = req.user?.companyId || null;
  if (!companyId) return { ok: false, ctx: null, companyId: null };
  const ctx = await loadPlanContext(companyId);
  const ok = req.user?.userType === 'super_admin' || isPaidPlan(ctx);
  return { ok, ctx, companyId };
}

/** 작업마다 "지금 이 회사에서 열려 있는가"를 붙인다. 요금제 문구는 여기서만 만든다(모델이 쓰지 않는다) */
function withLock(job: PublicFeatureJob, ctx: PlanContext | null): PublicFeatureJob & { locked: boolean } {
  if (!job.planKey || !ctx) return { ...job, locked: false };
  return { ...job, locked: !canUseFeature(ctx, job.planKey).allowed };
}

/** 발송 이력 유무 — PG campaigns만 본다(⛔ MySQL 금지) */
async function hasSentAnything(companyId: string): Promise<boolean> {
  try {
    const r = await query(
      `SELECT EXISTS (SELECT 1 FROM campaigns WHERE company_id = $1::uuid AND status IN ('completed', 'sending')) AS x`,
      [companyId],
    );
    return !!r.rows[0]?.x;
  } catch {
    return true; // 못 읽으면 도움말 모드(온보딩을 강요하지 않는다)
  }
}

const isMissingRelation = (err: any) => {
  const msg = String(err?.message || '');
  return msg.includes('relation') && msg.includes('does not exist');
};

async function logQuestion(opts: { companyId: string; userId: string; path: string | null; question: string; matched: string[]; answered: boolean }): Promise<'ok' | 'missing' | 'error'> {
  try {
    await query(
      `INSERT INTO help_questions (id, company_id, user_id, path, question, matched_ids, answered, created_at)
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5::text[], $6, NOW())`,
      [opts.companyId, opts.userId, opts.path, opts.question.slice(0, HELP_MAX_QUESTION), opts.matched, opts.answered],
    );
    return 'ok';
  } catch (err: any) {
    if (isMissingRelation(err)) return 'missing';
    console.warn('[help] 질문 기록 실패(답변은 나간다):', err?.message);
    return 'error';
  }
}

// ════════════════════════════════════════════════════════════
// GET /api/help/context?path=/dashboard — 런처가 처음 부르는 것 하나
// ════════════════════════════════════════════════════════════
router.get('/context', async (req: Request, res: Response) => {
  try {
    const { ok, ctx, companyId } = await resolveEligibility(req);
    if (!ok || !companyId) return res.json({ success: true, eligible: false });

    const path = normalizePath(String(req.query.path || '/'));
    const sent = await hasSentAnything(companyId);
    const mode: 'onboarding' | 'help' = sent ? 'help' : 'onboarding';

    const here = jobsForPath(path).map((j) => withLock(toPublicJob(j), ctx));
    const starter = ['sender-register', 'upload-customers', 'send-direct', 'check-results', 'manage-unsubscribes']
      .map((id) => findJob(id)).filter(Boolean).map((j) => withLock(toPublicJob(j!), ctx));

    // 기존 마법사(체험권 보유 회사만 대상). 대상이 아니면 링크를 그리지 않는다 — 봇이 체험권 게이트를 물려받지 않는다
    let wizard: { available: boolean; step: number | null; completed: boolean } = { available: false, step: null, completed: false };
    if (ctx?.isAiOperatorTrialActive) {
      try {
        const st: any = await getOnboardingState(companyId, req.user!.userId);
        wizard = { available: true, step: Number(st?.currentStep || 1), completed: !!st?.completedAt };
      } catch {
        wizard = { available: false, step: null, completed: false };
      }
    }

    return res.json({ success: true, eligible: true, mode, path, here, starter, wizard });
  } catch (err: any) {
    console.error('[help/context] 오류:', err);
    return res.status(500).json({ success: false, error: '도움말을 불러오지 못했습니다.' });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/help/catalog — 안내 화면(/guide)용 전체 목록
// ════════════════════════════════════════════════════════════
router.get('/catalog', async (req: Request, res: Response) => {
  try {
    const { ok, ctx } = await resolveEligibility(req);
    if (!ok) return res.status(403).json({ success: false, code: 'HELP_NOT_AVAILABLE', error: '요금제 사용 중인 계정에서 열립니다.' });
    const jobs = FEATURE_CATALOG.map((j) => withLock(toPublicJob(j), ctx));
    return res.json({ success: true, groups: JOB_GROUPS, jobs });
  } catch (err: any) {
    console.error('[help/catalog] 오류:', err);
    return res.status(500).json({ success: false, error: '안내를 불러오지 못했습니다.' });
  }
});

router.get('/catalog/:id', async (req: Request, res: Response) => {
  try {
    const { ok, ctx } = await resolveEligibility(req);
    if (!ok) return res.status(403).json({ success: false, code: 'HELP_NOT_AVAILABLE', error: '요금제 사용 중인 계정에서 열립니다.' });
    const job = findJob(String(req.params.id));
    if (!job) return res.status(404).json({ success: false, error: '해당 안내가 없습니다.' });
    const related = job.related.map((id) => findJob(id)).filter(Boolean).map((j) => withLock(toPublicJob(j!), ctx));
    return res.json({ success: true, job: withLock(toPublicJob(job), ctx), related });
  } catch (err: any) {
    console.error('[help/catalog/:id] 오류:', err);
    return res.status(500).json({ success: false, error: '안내를 불러오지 못했습니다.' });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/help/ask { question, path } — 질문 1건
// ════════════════════════════════════════════════════════════
router.post('/ask', async (req: Request, res: Response) => {
  try {
    const { ok, ctx, companyId } = await resolveEligibility(req);
    if (!ok || !companyId) return res.status(403).json({ success: false, code: 'HELP_NOT_AVAILABLE', error: '요금제 사용 중인 계정에서 열립니다.' });

    const question = String(req.body?.question || '').trim();
    if (!question) return res.status(400).json({ success: false, error: '질문을 입력해 주세요.' });
    if (question.length > HELP_MAX_QUESTION) return res.status(400).json({ success: false, error: `질문은 ${HELP_MAX_QUESTION}자까지 입력할 수 있습니다.` });
    const path = req.body?.path ? normalizePath(String(req.body.path)) : null;

    // 후속 대화(★2026-08-24). 화면이 직전 문답을 보낸다 — 형식이 어긋난 항목은 조용히 버린다(막지 않는다).
    // 내용 검증은 여기서 하지 않는다: 최종 방어는 답변 CT의 JSON 계약·출구 검사다.
    const history = Array.isArray(req.body?.history)
      ? req.body.history
          .filter((t: any) => t && typeof t.q === 'string' && typeof t.a === 'string')
          .slice(-HELP_MAX_HISTORY)
          .map((t: any) => ({ q: String(t.q), a: String(t.a) }))
      : undefined;

    const result = await answerHelpQuestion({ companyId, question, currentPath: path, history });
    const jobs = result.jobs.map((j) => withLock(j, ctx));

    // 기록은 답변과 독립이다 — 실패해도 답은 나간다. 미답 비율이 2단계 정의의 유일한 입력이다
    await logQuestion({
      companyId, userId: req.user!.userId, path, question,
      matched: result.jobs.map((j) => j.id), answered: result.answered,
    });

    return res.json({ success: true, answered: result.answered, answer: result.answer, direct: result.direct, jobs, reason: result.answered ? undefined : result.reason });
  } catch (err: any) {
    console.error('[help/ask] 오류:', err);
    return res.status(500).json({ success: false, error: '답변을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/help/questions { question, path } — "문의 남기기"(답을 못 받은 질문을 남긴다)
// ════════════════════════════════════════════════════════════
router.post('/questions', async (req: Request, res: Response) => {
  try {
    const { ok, companyId } = await resolveEligibility(req);
    if (!ok || !companyId) return res.status(403).json({ success: false, code: 'HELP_NOT_AVAILABLE', error: '요금제 사용 중인 계정에서 열립니다.' });
    const question = String(req.body?.question || '').trim();
    if (!question) return res.status(400).json({ success: false, error: '문의 내용을 입력해 주세요.' });
    const path = req.body?.path ? normalizePath(String(req.body.path)) : null;

    const r = await logQuestion({ companyId, userId: req.user!.userId, path, question, matched: [], answered: false });
    if (r === 'missing') {
      return res.status(503).json({ success: false, code: 'DB_MIGRATION_PENDING', error: '문의 남기기를 준비 중입니다. 잠시 후 다시 시도해 주세요.' });
    }
    if (r === 'error') return res.status(500).json({ success: false, error: '문의를 남기지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[help/questions] 오류:', err);
    return res.status(500).json({ success: false, error: '문의를 남기지 못했습니다.' });
  }
});

export default router;
