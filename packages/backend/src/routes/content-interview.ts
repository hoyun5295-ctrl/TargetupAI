/**
 * content-interview.ts — 원스텝 AI 컨텐츠 생성 라우트 (★ 2026-08-13 Phase 3)
 *
 * 설계서 = docs/2026-08-13-one-step-content-interview-design.md §4-1·§4-4·§6-1
 *
 * 흐름 = 세션 열기(프리필) → 답 저장(원자 병합) → 견적 → 생성 확정(차감 + 생성).
 *
 * ⛔ 불변
 *   - **전 엔드포인트 고객사 스코프**(`requireCompany` + 모든 쿼리에 `company_id` 직접 조건).
 *   - **인터뷰 단계는 무과금**이다 — 여기서 AI를 부르는 곳은 생성 확정 하나뿐이다.
 *   - **표시 금액과 실제 차감이 같은 함수에서 나온다**(`estimateOneStep`). 견적과 차감이 갈리면
 *     "표시 100 ≠ 차감 120"이 재현된다.
 *   - **생성이 성공한 뒤에 걷는다.** 실패하면 차감 지점에 도달하지 않는다(효과 검증 후 과금).
 *   - **발행분은 여기서 걷지 않는다** — 발행 라우트가 자기 키로 걷는다(같은 제작물 이중 과금 차단).
 *   - `one_step_sessions`는 배포 후 DDL이다 — 그 전에는 503(`DB_MIGRATION_PENDING`)으로 답한다.
 */
import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { requireCompany } from '../utils/request-scope';
import {
  buildMasterBrief,
  nextQuestion,
  remainingUserInputs,
  sanitizeAnswers,
  validateAnswer,
  visibleQuestions,
  type InterviewAnswers,
  type InterviewContext,
} from '../utils/content-interview';
import { prefillInterview } from '../utils/content-interview-fill';
import { buildDmStructure } from '../utils/dm/dm-interview-contract';
import { estimateOneStep } from '../utils/one-step-cost';
import { oneShotGenerate } from '../utils/dm/dm-ai';
import { attachMallImagesToProductCarousels } from '../utils/mall-product-match';
import { checkCredit, deductCreditSafe } from '../utils/ai-credit';
import { runInCreditBundle } from '../utils/ai-credit-context';

const router = Router();
router.use(authenticate);

const TABLE = 'one_step_sessions';

interface SessionRow {
  id: string;
  answers: InterviewAnswers;
  prefill: { context?: InterviewContext };
  attempt: number;
  interviewPaid: boolean;
  status: string;
}

function mapSession(r: any): SessionRow {
  return {
    id: String(r.id),
    answers: sanitizeAnswers(r.answers),
    prefill: (r.prefill && typeof r.prefill === 'object') ? r.prefill : {},
    attempt: Number(r.attempt) || 0,
    interviewPaid: !!r.interview_paid_at,
    status: String(r.status),
  };
}

/** 세션 1건 — 회사 조건을 직접 건다(id만으로 열면 남의 세션이 열린다). */
async function loadSession(companyId: string, id: string): Promise<SessionRow | null> {
  const r = await query(
    `SELECT id, answers, prefill, attempt, interview_paid_at, status
       FROM ${TABLE} WHERE id = $1::uuid AND company_id = $2::uuid`,
    [id, companyId],
  );
  return r.rows[0] ? mapSession(r.rows[0]) : null;
}

/** 화면이 그릴 진행 상태 — 질문 목록·다음 질문·사용자가 채워야 할 남은 개수. */
function progressOf(answers: InterviewAnswers) {
  return {
    questions: visibleQuestions(answers),
    next: nextQuestion(answers),
    remainingUserInputs: remainingUserInputs(answers),
  };
}

// POST /api/one-step/sessions — 세션 열기 (프리필 포함)
router.post('/sessions', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    const ev = req.body?.event || {};
    const prefill = await prefillInterview(companyId, {
      title: ev.title ? String(ev.title).slice(0, 200) : undefined,
      startsOn: ev.startsOn ? String(ev.startsOn).slice(0, 10) : undefined,
      endsOn: ev.endsOn ? String(ev.endsOn).slice(0, 10) : undefined,
      periodEnd: ev.periodEnd ? String(ev.periodEnd) : null,
    });
    const r = await query(
      `INSERT INTO ${TABLE} (company_id, created_by, channel, prefill)
       VALUES ($1::uuid, $2::uuid, 'dm', $3::jsonb) RETURNING id`,
      [companyId, req.user?.userId || null, JSON.stringify(prefill)],
    );
    const id = String(r.rows[0].id);
    return res.status(201).json({ id, prefill, ...progressOf({}) });
  } catch (error: any) {
    if (handleDbMigrationError(error, res, TABLE)) return;
    console.error('[one-step] 세션 생성 실패:', error?.message || error);
    return res.status(500).json({ error: '세션을 열지 못했습니다.' });
  }
});

// GET /api/one-step/sessions/:id — 이어하기
router.get('/sessions/:id', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    const s = await loadSession(companyId, String(req.params.id));
    if (!s) return res.status(404).json({ error: '해당 세션을 찾을 수 없습니다.' });
    return res.json({ id: s.id, answers: s.answers, prefill: s.prefill, status: s.status, ...progressOf(s.answers) });
  } catch (error: any) {
    if (handleDbMigrationError(error, res, TABLE)) return;
    console.error('[one-step] 세션 조회 실패:', error?.message || error);
    return res.status(500).json({ error: '세션 조회 실패' });
  }
});

// PATCH /api/one-step/sessions/:id/answers — 답 1건 저장
//   ⛔ read-modify-write 금지 — 단일 원자 병합(동시 저장이 서로를 지우지 않게).
router.patch('/sessions/:id/answers', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const key = String(req.body?.key || '');
  const value = req.body?.value;
  const verdict = validateAnswer(key, value);
  if (!verdict.ok) {
    // 모르는 키는 "옛 화면이 보낸 값"이라 400으로 조용히 되돌린다(500으로 세션을 죽이지 않는다).
    return res.status(400).json({ error: verdict.error === 'unknown_key' ? '지원하지 않는 항목입니다.' : verdict.error });
  }
  try {
    const r = await query(
      `UPDATE ${TABLE}
          SET answers = COALESCE(answers, '{}'::jsonb) || jsonb_build_object($3::text, $4::jsonb),
              updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'draft'
        RETURNING answers`,
      [String(req.params.id), companyId, key, JSON.stringify(value ?? null)],
    );
    if (r.rows.length === 0) return res.status(404).json({ error: '수정할 수 있는 세션이 아닙니다.' });
    const answers = sanitizeAnswers(r.rows[0].answers);
    return res.json({ answers, ...progressOf(answers) });
  } catch (error: any) {
    if (handleDbMigrationError(error, res, TABLE)) return;
    console.error('[one-step] 답 저장 실패:', error?.message || error);
    return res.status(500).json({ error: '답을 저장하지 못했습니다.' });
  }
});

// GET /api/one-step/sessions/:id/estimate — 견적 (화면 표시 = 실제 차감과 같은 산식)
router.get('/sessions/:id/estimate', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    const s = await loadSession(companyId, String(req.params.id));
    if (!s) return res.status(404).json({ error: '해당 세션을 찾을 수 없습니다.' });
    return res.json(estimateOneStep({ sessionId: s.id, attempt: s.attempt, interviewPaid: s.interviewPaid }));
  } catch (error: any) {
    if (handleDbMigrationError(error, res, TABLE)) return;
    console.error('[one-step] 견적 실패:', error?.message || error);
    return res.status(500).json({ error: '견적을 내지 못했습니다.' });
  }
});

// POST /api/one-step/sessions/:id/generate — 생성 확정
router.post('/sessions/:id/generate', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    const s = await loadSession(companyId, String(req.params.id));
    if (!s) return res.status(404).json({ error: '해당 세션을 찾을 수 없습니다.' });

    const ctx: InterviewContext = s.prefill?.context || {};
    const brief = buildMasterBrief(s.answers, ctx);
    const hasBenefit = typeof s.answers.benefit === 'string' && s.answers.benefit.trim().length > 0;
    const structure = buildDmStructure(brief.decisions, { hasBenefit });

    // 회차 선점 — 견적·차감이 같은 회차를 보게 한다(선점 전 계산은 동시 요청에서 어긋난다).
    const claim = await query(
      `UPDATE ${TABLE} SET attempt = attempt + 1, updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid RETURNING attempt, (interview_paid_at IS NOT NULL) AS paid`,
      [s.id, companyId],
    );
    if (claim.rows.length === 0) return res.status(404).json({ error: '해당 세션을 찾을 수 없습니다.' });
    const attempt = Number(claim.rows[0].attempt) || 1;
    const interviewPaid = !!claim.rows[0].paid;

    const quote = estimateOneStep({ sessionId: s.id, attempt, interviewPaid });
    await checkCredit(companyId, quote.total);

    // ⛔ 생성이 끝난 뒤에 걷는다 — 실패하면 차감 지점에 도달하지 않는다.
    const result = await runInCreditBundle(async () => {
      const r = await oneShotGenerate({
        prompt: '',              // ⛔ 비운다 — 프롬프트 요약 통로를 타지 않기 위한 조건이다(설계서 §0-5)
        eventText: brief.eventText,
        structure,
        companyId,
      });
      for (const c of quote.charges) {
        if (c.cost <= 0) continue;
        await deductCreditSafe({
          companyId, cost: c.cost, source: c.source,
          createdBy: req.user?.userId || null, idempotencyKey: c.idempotencyKey,
        });
      }
      return r;
    });

    // 대행 델타를 걷었으면 그 사실을 원장에 새긴다(재생성이 델타를 다시 걷지 않는 근거).
    if (!interviewPaid) {
      await query(
        `UPDATE ${TABLE} SET interview_paid_at = NOW(), updated_at = NOW()
          WHERE id = $1::uuid AND company_id = $2::uuid AND interview_paid_at IS NULL`,
        [s.id, companyId],
      ).catch((e: any) => console.warn('[one-step] 대행 차감 표식 실패:', e?.message || e));
    }

    // 상품 이미지·정가·링크는 코드가 채운다(프롬프트로 지시하지 않는다 — 생성기 규칙과 싸우지 않게).
    try { await attachMallImagesToProductCarousels(companyId, result.sections); } catch { /* best-effort */ }

    // 계측 — 결정축 반영은 커버리지로 못 재므로 **최종 체인**을 함께 남긴다(설계서 §4-5).
    await query(
      `UPDATE ${TABLE}
          SET decisions = $3::jsonb, section_types = $4::jsonb, coverage = $5::jsonb,
              status = 'generated', updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid`,
      [s.id, companyId, JSON.stringify(brief.decisions), JSON.stringify(structure.sectionTypes),
        JSON.stringify(result.coverage ?? null)],
    ).catch((e: any) => console.warn('[one-step] 세션 기록 실패:', e?.message || e));

    return res.json({
      success: true,
      charged: quote,
      data: {
        sections: result.sections,
        pages: result.pages,
        layout_mode: result.layoutMode,
        brand_kit: result.brandKit,
        brief: result.brief ?? null,
        coverage: result.coverage ?? null,
      },
    });
  } catch (error: any) {
    if (handleDbMigrationError(error, res, TABLE)) return;
    if (error?.name === 'InsufficientCreditError' || /크레딧/.test(String(error?.message || ''))) {
      return res.status(402).json({ error: '크레딧이 부족합니다. 충전 후 다시 시도해 주세요.', code: 'INSUFFICIENT_CREDIT' });
    }
    console.error('[one-step] 생성 실패:', error?.message || error);
    return res.status(500).json({ error: '생성에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

export default router;
