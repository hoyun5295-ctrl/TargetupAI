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
import { resolveOwnerScope } from '../utils/owner-scope';
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
import { estimateOneStep, sumOneStepCharges, oneStepInterviewKey } from '../utils/one-step-cost';
import { oneShotGenerate } from '../utils/dm/dm-ai';
import { attachMallImagesToProductCarousels } from '../utils/mall-product-match';
import { checkCredit, deductCreditOutcome, isChargedByKey, isCreditEnabledStrict } from '../utils/ai-credit';
import { runInCreditBundle } from '../utils/ai-credit-context';

const router = Router();
router.use(authenticate);

const TABLE = 'one_step_sessions';

interface SessionRow {
  id: string;
  answers: InterviewAnswers;
  prefill: { context?: InterviewContext };
  attempt: number;
  status: string;
}
// ⛔ `interview_paid_at`을 여기 싣지 않는다. 과금 여부의 진실은 원장 하나이고(`isChargedByKey`),
//    세션에 사본을 두면 차감은 됐는데 표식만 실패한 순간 이미 낸 돈을 다시 청구하게 된다.

function mapSession(r: any): SessionRow {
  return {
    id: String(r.id),
    answers: sanitizeAnswers(r.answers),
    prefill: (r.prefill && typeof r.prefill === 'object') ? r.prefill : {},
    attempt: Number(r.attempt) || 0,
    status: String(r.status),
  };
}

/**
 * 세션 1건 — 회사 조건에 더해 **소유 조건**까지 직접 건다.
 * id만으로 열면 남의 회사가 열리고, 회사 조건만 걸면 같은 회사 다른 담당자의 세션이 열린다.
 * 격리 축은 형제 기능인 DM(`dm_pages ... AND created_by`)과 같다 — 담당자는 본인 것만, 관리자는 회사 전체.
 */
async function loadSession(companyId: string, id: string, ownerId: string | null): Promise<SessionRow | null> {
  const r = await query(
    `SELECT id, answers, prefill, attempt, status
       FROM ${TABLE}
      WHERE id = $1::uuid AND company_id = $2::uuid
        AND ($3::uuid IS NULL OR created_by = $3::uuid)`,
    [id, companyId, ownerId],
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
    const userId = req.user?.userId || null;

    // 진행 중인 내 세션이 있으면 **그것을 이어준다.**
    // 새 세션을 만들면 대행 델타 멱등키(`one-step:{sessionId}` = 세션 고정)도 함께 새로 생겨,
    // 이미 낸 대행비를 다시 걷는다 — 실수로 닫았다 다시 연 사람에게 50이 또 나가는 경로였다.
    // `fresh` = 사용자가 [새로 시작]을 눌렀다. 시간 창은 "같은 행사인가"를 증명하지 못하므로
    // 이어할지 새로 할지는 **사용자가 명시로 고른다**(우리가 지문으로 추측하지 않는다).
    if (userId && !req.body?.fresh) {
      const prev = await query(
        // 창(30일)은 기존 초안 재개 규약을 그대로 쓴다(`event_campaign_drafts` 재개 바와 같은 값) —
        // 오래된 초안까지 이어붙으면 지난달 행사의 답이 이번 행사에 조용히 실린다.
        // 끊긴 생성(`generating`)도 10분 lease가 지났으면 이어받는다 — 안 그러면 그 세션에서 영영 못 나온다.
        `SELECT id, answers, prefill, attempt, status
           FROM ${TABLE}
          WHERE company_id = $1::uuid AND created_by = $2::uuid
            AND (status = 'draft'
                 OR (status = 'generating' AND updated_at < NOW() - INTERVAL '10 minutes'))
            AND updated_at > NOW() - INTERVAL '30 days'
          ORDER BY updated_at DESC LIMIT 1`,
        [companyId, userId],
      );
      if (prev.rows[0]) {
        const s = mapSession(prev.rows[0]);
        return res.json({ id: s.id, prefill: s.prefill, answers: s.answers, resumed: true, ...progressOf(s.answers) });
      }
    }

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
      [companyId, userId, JSON.stringify(prefill)],
    );
    const id = String(r.rows[0].id);
    return res.status(201).json({ id, prefill, answers: {}, resumed: false, ...progressOf({}) });
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
    const s = await loadSession(companyId, String(req.params.id), resolveOwnerScope(req));
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
    // 생성이 끝난 세션도 답을 고칠 수 있다 — 고치는 순간 그 결과는 낡은 것이므로 `draft`로 되돌린다.
    // 여기서 막으면 "만들었는데 한 군데만 고치고 싶다"가 새 세션으로 밀려 대행비를 다시 내게 된다.
    const r = await query(
      `UPDATE ${TABLE}
          SET answers = COALESCE(answers, '{}'::jsonb) || jsonb_build_object($3::text, $4::jsonb),
              status = 'draft',
              updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid
          AND status IN ('draft', 'generated')
          AND ($5::uuid IS NULL OR created_by = $5::uuid)
        RETURNING answers`,
      [String(req.params.id), companyId, key, JSON.stringify(value ?? null), resolveOwnerScope(req)],
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
    const s = await loadSession(companyId, String(req.params.id), resolveOwnerScope(req));
    if (!s) return res.status(404).json({ error: '해당 세션을 찾을 수 없습니다.' });
    // "이미 냈는가"는 원장에 묻는다 — 세션 표식을 읽으면 표식만 실패한 경우 이미 낸 돈을 다시 청구한다.
    //   확인이 안 되면 금액을 짓지 않는다(모르는 것을 미차감으로 접으면 이미 낸 고객이 과다 견적을 본다).
    //   크레딧제 적용 여부도 같은 자리에서 **엄격하게** 읽는다 — 실패를 미적용으로 접으면
    //   견적만 0원이 되고 생성은 양수를 걷어 **승인하지 않은 금액**이 나간다.
    let interviewPaid: boolean;
    let creditEnabled: boolean;
    try {
      interviewPaid = await isChargedByKey(companyId, oneStepInterviewKey(s.id));
      creditEnabled = await isCreditEnabledStrict(companyId);
    } catch (e: any) {
      console.warn('[one-step] 과금 조회 실패:', e?.message || e);
      return res.status(503).json({ error: '요금을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', code: 'CREDIT_LOOKUP_UNAVAILABLE' });
    }
    return res.json(estimateOneStep({ sessionId: s.id, attempt: s.attempt, interviewPaid, creditEnabled }));
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
  // 선점 토큰 = 선점이 돌려준 회차. **이후의 모든 쓰기는 이 회차일 때만 성공한다.**
  //   우리 생성이 10분(lease)을 넘기면 다른 요청이 정당하게 재선점한다 — 그때 우리가 회차를 안 걸고
  //   완료·해제를 쓰면 **남의 선점을 덮거나 풀어** 둘이 동시에 돌고 이중 과금이 된다.
  let claimedAttempt = 0;
  const ownerId = resolveOwnerScope(req);
  try {
    const s = await loadSession(companyId, String(req.params.id), ownerId);
    if (!s) return res.status(404).json({ error: '해당 세션을 찾을 수 없습니다.' });

    // 이미 냈는지는 **선점 전에** 묻는다 — 확인이 안 되면 선점도 하지 않고 물러난다.
    //   모르는 금액을 견적·잔액 검사에 넣으면 이미 낸 고객이 부당하게 막힌다(원장 조회는 실패를 던진다).
    let interviewPaid: boolean;
    let creditEnabled: boolean;
    try {
      interviewPaid = await isChargedByKey(companyId, oneStepInterviewKey(s.id));
      creditEnabled = await isCreditEnabledStrict(companyId);
    } catch (e: any) {
      console.warn('[one-step] 과금 조회 실패:', e?.message || e);
      return res.status(503).json({ error: '요금을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', code: 'CREDIT_LOOKUP_UNAVAILABLE' });
    }

    // ⛔ **사용자가 승인한 금액과 지금 금액이 같아야 걷는다.** 견적과 생성 사이에 크레딧제가 켜지거나
    //   대행비 납부 여부가 바뀌면 화면이 보여 준 것과 다른 금액이 조용히 나간다.
    //   총액은 회차와 무관하므로 **선점 전에** 검사한다 — 여기서 되돌려야 세션이 `generating`에 갇히지 않는다.
    //   ⛔ **선택이 아니라 필수다.** 빠뜨린 호출자를 통과시키면 결박이 계약이 아니라 권고가 되고,
    //   낡은 화면·비정상 견적 응답이 승인 근거 없이 차감까지 간다.
    const expectedTotal = req.body?.expectedTotal;
    if (typeof expectedTotal !== 'number' || !Number.isFinite(expectedTotal) || expectedTotal < 0) {
      return res.status(400).json({ error: '요금 확인이 필요합니다. 화면을 새로고침한 뒤 다시 시도해 주세요.', code: 'QUOTE_REQUIRED' });
    }
    const nowTotal = estimateOneStep({ sessionId: s.id, attempt: s.attempt + 1, interviewPaid, creditEnabled }).total;
    if (expectedTotal !== nowTotal) {
      console.log(`[one-step] 견적 변동 — 재확인 요구 session=${s.id} 승인=${expectedTotal} 현재=${nowTotal} company=${companyId}`);
      return res.status(409).json({ error: '요금이 변경되었습니다. 금액을 다시 확인해 주세요.', code: 'QUOTE_CHANGED' });
    }

    // 선점 — 회차만 올리는 것으로는 아무것도 직렬화되지 않는다. **상태를 `generating`으로 원자 전이**한다.
    //   끊긴 시도는 10분 lease로 회수한다(플래너 승인 선점과 같은 값) — 없으면 그 세션이 영구히 잠긴다.
    //   ⛔ **답과 프리필을 선점이 함께 돌려준다.** 먼저 읽고 나중에 선점하면 그 사이 PATCH가 저장한 새 답이
    //   DB에 남고 유료 결과물은 옛 답으로 만들어진다 — 상태 전이만으로는 그 창이 안 닫힌다.
    const claim = await query(
      `UPDATE ${TABLE} SET status = 'generating', attempt = attempt + 1, updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid
          AND ($3::uuid IS NULL OR created_by = $3::uuid)
          AND (status IN ('draft', 'generated')
               OR (status = 'generating' AND updated_at < NOW() - INTERVAL '10 minutes'))
        RETURNING attempt, answers, prefill`,
      [s.id, companyId, ownerId],
    );
    // loadSession이 이미 존재·소유를 확인했으므로 0행 = 다른 요청이 생성 중이다.
    if (claim.rows.length === 0) {
      return res.status(409).json({ error: '이미 생성 중입니다. 끝나면 결과가 나타납니다.', code: 'ONE_STEP_GENERATING' });
    }
    const claimed = mapSession({ ...claim.rows[0], id: s.id, status: 'generating' });
    const attempt = claimed.attempt;
    claimedAttempt = attempt;

    // 생성 입력은 **선점이 돌려준 값으로만** 만든다(위에서 읽어 둔 s.answers를 쓰지 않는다).
    const ctx: InterviewContext = claimed.prefill?.context || {};
    const brief = buildMasterBrief(claimed.answers, ctx);
    const hasBenefit = typeof claimed.answers.benefit === 'string' && claimed.answers.benefit.trim().length > 0;
    const structure = buildDmStructure(brief.decisions, { hasBenefit });

    const quote = estimateOneStep({ sessionId: s.id, attempt, interviewPaid, creditEnabled });
    await checkCredit(companyId, quote.total);

    // AI 생성만 먼저 한다 — 돈은 **소유권을 확정한 뒤에** 건드린다.
    const result = await runInCreditBundle(() => oneShotGenerate({
      prompt: '',              // ⛔ 비운다 — 프롬프트 요약 통로를 타지 않기 위한 조건이다(설계서 §0-5)
      eventText: brief.eventText,
      structure,
      companyId,
    }));

    // 상품 이미지·정가·링크는 코드가 채운다(프롬프트로 지시하지 않는다 — 생성기 규칙과 싸우지 않게).
    try { await attachMallImagesToProductCarousels(companyId, result.sections); } catch { /* best-effort */ }

    // ⛔ **돈을 쓰기 전에 소유권을 재확인한다**(상태는 아직 `generating`으로 둔다).
    //   생성이 10분(lease)을 넘겼으면 다른 요청이 정당하게 재선점했을 수 있다 — 그 상태로 걷고 성공을
    //   돌려주면 두 회차가 각자 다른 멱등키로 차감해 **한 번 시킨 일에 두 번 과금**된다.
    //   0행이면 결과를 폐기한다: 차감도 응답도 하지 않는다. `.catch`로 삼키지 않는다.
    //
    //   ⛔ 갱신은 **차감 항목마다** 한다. 견적은 항목이 둘(생성비·대행비)이라 한 번만 갱신하면
    //   각 차감이 10분 미만이어도 **합산 시간**이 lease를 넘어 그 사이 재선점이 들어온다(Codex 6R).
    //   그래서 아래 루프가 매 차감 직전에 이 CAS를 돌린다. 남는 창은 **차감 한 건이 10분을 넘는 경우**뿐이고,
    //   그건 회사 크레딧 행이 10분간 잠겼다는 뜻이라 원스텝만의 경합이 아니라 전 크레딧 경로가 멈춘 계통 장애다.
    //   ⚠ **그 잔여 창은 수용한다.** 완전히 닫으려면 AI 생성 내내 DB 커넥션을 쥐는 잠금이 필요한데,
    //   풀(max 20)을 점유해 **백엔드 전체가 커넥션 대기에 빠진다**(Codex 5R). 잃는 것을 비교하면
    //   이쪽은 병리적 상황에서 생성비 5크레딧이고, 저쪽은 전 고객 발송 중단이다.
    const holdClaim = () => query(
      `UPDATE ${TABLE} SET updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid
          AND ($3::uuid IS NULL OR created_by = $3::uuid)
          AND status = 'generating' AND attempt = $4
        RETURNING id`,
      [s.id, companyId, ownerId, attempt],
    );

    const stillOurs = await holdClaim();
    if (stillOurs.rows.length !== 1) {
      claimedAttempt = 0;   // 우리 선점이 아니다 — 남의 것을 풀지 않는다
      console.log(`[one-step] 선점 상실 — 결과 폐기(무과금) session=${s.id} attempt=${attempt} company=${companyId}`);
      return res.status(409).json({ error: '다른 요청이 먼저 만들고 있습니다. 잠시 후 다시 시도해 주세요.', code: 'ONE_STEP_CLAIM_LOST' });
    }

    // 차감은 **선점을 쥔 채로** 한다. 여기서 상태를 미리 `generated`로 열면 그 순간부터 재선점이 가능해져,
    //   차감 중에 들어온 재시도가 새 회차로 또 생성하고 또 걷는다(생성비 키가 회차별이라 멱등이 안 막는다).
    //   차감 함수는 잔액 부족·영구 실패에 **예외를 던지지 않는다** — 결말을 받아서 갈라야 한다.
    // ⛔ 걷힌 것은 **양수로 모은다.** 견적에서 실패분을 빼는 방식(제외법)은 "시도조차 안 한 항목"을
    //   걷힌 것으로 세어 표시와 실차감이 갈린다 — 이 기능이 지키기로 한 바로 그 불변이 깨진다.
    const collected: typeof quote.charges = [];
    const unpaid: typeof quote.charges = [];

    // ⛔ **"세션이 이 결과를 가리키는가"는 판정 하나다.** 선점 상실·확인 실패·최종화 실패는 원인이 다르지만
    //   사용자에게는 같은 사실이다 — 이 결과는 세션에 저장되지 않았다. 따로 판정해 일부만 응답에 실으면
    //   화면은 정상 완료로 오인한다. 그래서 한 변수로 모으고 한 번만 내보낸다.
    let sessionDetached = false;

    await runInCreditBundle(async () => {
      for (const c of quote.charges) {
        if (c.cost <= 0) continue;
        // 매 항목 직전에 소유권 확인 + lease 재시작 — 잃었으면 **다음 차감을 시작하지 않는다.**
        //   확인 자체가 실패해도 마찬가지다: 이미 걷은 것이 있는데 바깥 catch로 보내면 500이 나가고,
        //   사용자는 낸 돈도 결과도 못 받은 채 재시도해 **또 걷힌다**(생성비 키가 회차별이라 멱등이 안 막는다).
        let own: { rows: any[] };
        try {
          own = await holdClaim();
        } catch (e: any) {
          sessionDetached = true;
          console.log(`[one-step] 선점 확인 실패 — 차감 중단 session=${s.id} attempt=${attempt} 미시도=${c.source} company=${companyId} err=${e?.message || e}`);
          break;
        }
        if (own.rows.length !== 1) {
          sessionDetached = true;
          console.log(`[one-step] 차감 중 선점 상실 — 이후 항목 중단 session=${s.id} attempt=${attempt} 미시도=${c.source} company=${companyId}`);
          break;
        }
        // ⛔ **불리언으로 접지 않는다.** `deducted`·`duplicate`만 원장에 돈이 있다는 뜻이고,
        //   `not_applicable`은 크레딧제가 그 사이 꺼졌다는 뜻이라 **수금이 아니다**(양수 견적이었는데
        //   원장이 안 움직였으므로 금액에 실으면 실차감보다 커진다).
        const outcome = await deductCreditOutcome({
          companyId, cost: c.cost, source: c.source,
          createdBy: req.user?.userId || null, idempotencyKey: c.idempotencyKey,
        });
        if (outcome === 'deducted' || outcome === 'duplicate') {
          collected.push(c);                 // 원장에 돈이 있다 = 걷힌 것
        } else if (outcome === 'failed') {
          unpaid.push(c);                    // **미수 = 이것뿐.** 아래 MISS 로그가 수동 재차감 큐다
        } else {
          // `not_applicable`(견적 후 크레딧제 해제) · `not_required`(걷을 것 없음) = **차감 의무가 없다.**
          //   미수로 넣으면 무과금 계정이 재차감 큐에 섞여 **잘못 걷힌다** — 금액에도 큐에도 넣지 않는다.
          console.log(`[one-step] 무과금 결말(${outcome}) — 재차감 대상 아님 session=${s.id} attempt=${attempt} source=${c.source} company=${companyId}`);
        }
      }
    });

    // 최종화 — **차감이 끝난 뒤에만** `generated`로 연다(그 전까지 이 세션은 재선점 대상이 아니다).
    //   선점을 잃었으면 아예 시도하지 않는다: 그 세션은 이미 다른 회차의 것이라 우리가 손댈 자리가 아니다.
    if (!sessionDetached) {
      const finalize = await query(
        `UPDATE ${TABLE}
            SET decisions = $3::jsonb, section_types = $4::jsonb, coverage = $5::jsonb,
                status = 'generated', updated_at = NOW()
          WHERE id = $1::uuid AND company_id = $2::uuid
            AND ($6::uuid IS NULL OR created_by = $6::uuid)
            AND status = 'generating' AND attempt = $7
          RETURNING id`,
        [s.id, companyId, JSON.stringify(brief.decisions), JSON.stringify(structure.sectionTypes),
          JSON.stringify(result.coverage ?? null), ownerId, attempt],
      ).catch((e: any) => {
        // 여기서 실패해도 결과는 돌려준다 — 이미 걷었기 때문이다(낸 사람에게서 결과를 뺏지 않는다).
        console.log(`[one-step] 최종화 실패 session=${s.id} attempt=${attempt} company=${companyId} err=${e?.message || e}`);
        return { rows: [] as any[] };
      });
      if (finalize.rows.length !== 1) {
        // 오류였든 회차를 빼앗겼든 **세션은 이 결과를 가리키지 않는다** — 원인은 위 로그가 가른다.
        sessionDetached = true;
        console.log(`[one-step] 최종화 미확정 — 세션이 이 결과를 가리키지 않는다 session=${s.id} attempt=${attempt} company=${companyId}`);
      }
    }
    claimedAttempt = 0;   // 여기까지 왔으면 선점 해제 대상이 아니다(남의 회차를 풀지 않는다)

    // 걷지 못한 항목은 **식별자와 함께** 남긴다 — 영구 실패의 구제는 수동 재차감이 전사 정책이라,
    // 어느 세션·회차·키인지 재구성할 수 있어야 그 정책이 실제로 집행된다("대상 N건"만 남기면 못 찾는다).
    // 표식을 따로 새기지 않는다: 이미 냈는지는 매번 원장에 묻는다(사본을 두면 두 진실이 갈린다).
    for (const c of unpaid) {
      console.log(`[CREDIT][MISS] one-step source=${c.source} cost=${c.cost} key=${c.idempotencyKey} session=${s.id} attempt=${attempt} company=${companyId}`);
    }

    // 결과는 돌려준다(걷힌 만큼은 낸 사람의 것이다). 다만 **금액은 실제 걷힌 것만** 싣고,
    // 세션이 이 결과를 가리키지 않으면 그 사실을 함께 알린다 — 화면이 정상 완료로 오인하지 않게.
    return res.json({
      success: true,
      sessionDetached: sessionDetached || undefined,
      charged: { charges: collected, total: sumOneStepCharges(collected), publishNotice: quote.publishNotice },
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
    // 선점을 잡은 채로 실패했으면 풀어 준다 — 안 풀면 10분 lease가 지나기 전까지 그 세션이 잠긴다.
    //   `attempt` 조건 = 선점 토큰. 우리가 늦어 다른 요청이 재선점했다면 0행이 되어
    //   **살아 있는 남의 선점을 풀지 않는다**(풀면 셋째가 잡아 둘이 동시에 돌고 이중 과금이 된다).
    if (claimedAttempt > 0) {
      await query(
        `UPDATE ${TABLE} SET status = 'draft', updated_at = NOW()
          WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'generating'
            AND ($3::uuid IS NULL OR created_by = $3::uuid)
            AND attempt = $4`,
        [String(req.params.id), companyId, ownerId, claimedAttempt],
      ).catch((e: any) => console.warn('[one-step] 선점 해제 실패(10분 뒤 자동 회수):', e?.message || e));
    }
    if (handleDbMigrationError(error, res, TABLE)) return;
    if (error?.name === 'InsufficientCreditError' || /크레딧/.test(String(error?.message || ''))) {
      return res.status(402).json({ error: '크레딧이 부족합니다. 충전 후 다시 시도해 주세요.', code: 'INSUFFICIENT_CREDIT' });
    }
    console.error('[one-step] 생성 실패:', error?.message || error);
    return res.status(500).json({ error: '생성에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

export default router;
