/**
 * 라우트: AI 마케팅 진단 — 인증 축(퍼널 A) (2026-08-16 신설)
 * 설계서 = docs/2026-08-16-marketing-diagnosis-design.md §4-1(제출+지급 한 트랜잭션)·§4-3(API 5종)
 *
 * 불변 원칙(§2)
 *   - 화면은 게이트가 아니다 — 노출·지급·제출 전부 서버가 plan_code='FREE' 재검사.
 *   - 진단 계산은 크레딧 차감 0·AI 호출 0(순수 룰 — plan-recommend·marketing-diagnosis-report CT).
 *   - 1회 한정 = DB UNIQUE(diagnosis_trial_grants·funnel A 부분 UNIQUE)가 실효 장치. 예외 재지급 경로 없음.
 *   - 제출+지급 = client 하나의 한 트랜잭션. 쪼개면 지급 실패가 재시도를 영구 차단하거나 FK가 못 본다.
 *   - 실패 = 전체 ROLLBACK(진단 미저장 = 재시도 가능이 복구 경로).
 *
 * ⛔ 신규 4테이블(diagnosis_question_sets·marketing_diagnoses·diagnosis_trial_grants·diagnosis_invites)은
 *    배포 후 DDL(§3) — 그 전에는 전 endpoint가 503 DB_MIGRATION_PENDING(원칙 10 · 활성 문항 세트 0개도 503).
 */
import { Router, Request, Response } from 'express';
import pool, { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { computeMonthlyUsage } from '../utils/monthly-usage';
import { validateAnswers, recommendPlan, visibleQuestions, type DiagnosisDefinition } from '../utils/plan-recommend';
import { buildDiagnosisResult, type ReportInputs } from '../utils/marketing-diagnosis-report';
import {
  loadActiveQuestionSet, handleDefinitionInvalid, DIAGNOSIS_PLAN_ROWS_SQL,
  projectQuestions, computeSendingPrefill,
} from '../utils/marketing-diagnosis-store';
import {
  judgeGrantEligibility,
  executeGrant,
  hasTrialHistory,
  GrantConflictError,
} from '../utils/marketing-diagnosis-grant';

const router = Router();
router.use(authenticate);

function activeSetMissing(res: Response) {
  return res.status(503).json({
    success: false,
    code: 'DB_MIGRATION_PENDING',
    error: 'DB 마이그레이션 필요 — diagnosis_question_sets 활성 문항 세트(seed) 실행 요청',
  });
}

// ────────────────────────────────────────────────────────────────────
// GET /state — 화면 판정 전부 이 한 응답(§4-3). grantable이 CTA 분기의 유일 입력.
// ────────────────────────────────────────────────────────────────────
router.get('/state', async (req: Request, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
  try {
    const [setRes, compRes, dxRes, grantRes, invRes] = await Promise.all([
      query(`SELECT version FROM diagnosis_question_sets WHERE is_active = true LIMIT 1`),
      query(
        `SELECT UPPER(COALESCE(p.plan_code, '')) AS plan_code, c.subscription_status, c.trial_expires_at
           FROM companies c LEFT JOIN plans p ON p.id = c.plan_id
          WHERE c.id = $1`,
        [companyId],
      ),
      query(
        `SELECT created_at, recommended_plan_code FROM marketing_diagnoses
          WHERE company_id = $1 AND funnel = 'A' LIMIT 1`,
        [companyId],
      ),
      query(`SELECT 1 FROM diagnosis_trial_grants WHERE company_id = $1`, [companyId]),
      query(`SELECT invited_at FROM diagnosis_invites WHERE company_id = $1`, [companyId]),
    ]);
    if (setRes.rows.length === 0) return activeSetMissing(res);
    if (compRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    }
    const comp = compRes.rows[0];
    const eligible = comp.plan_code === 'FREE';

    let grantable: 'available' | 'already_granted' | 'not_eligible' | 'not_applicable';
    if (!eligible) grantable = 'not_applicable';
    else if (grantRes.rows.length > 0) grantable = 'already_granted';
    else grantable = (await hasTrialHistory({ query }, companyId, comp)) ? 'not_eligible' : 'available';

    return res.json({
      success: true,
      eligible,
      grantable,
      completedAt: dxRes.rows[0]?.created_at ?? null,
      invitedAt: invRes.rows[0]?.invited_at ?? null,
      trialExpiresAt: comp.trial_expires_at ?? null,
      recommendedPlanCode: dxRes.rows[0]?.recommended_plan_code ?? null,
    });
  } catch (err) {
    if (handleDefinitionInvalid(err, res)) return;
    if (handleDbMigrationError(err, res, 'marketing_diagnoses')) return;
    console.error('[marketing-diagnosis] state 실패:', err);
    return res.status(500).json({ success: false, error: '진단 상태 조회에 실패했습니다.' });
  }
});

// ────────────────────────────────────────────────────────────────────
// GET /questions — 퍼널 A 문항(공개와 같은 투영 함수 — 단일 진실) + sending 실측 선치환(v3)
//   선치환 값은 화면 안내용일 뿐 — 제출 시 서버가 재계산해 쓴다(프론트 값 불신 · 화면은 게이트가 아니다).
// ────────────────────────────────────────────────────────────────────
router.get('/questions', async (req: Request, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
  try {
    const activeSet = await loadActiveQuestionSet();
    if (!activeSet) return activeSetMissing(res);
    const projected = projectQuestions(activeSet.definition);
    const prefilled: Record<string, string> = {};
    const sendingGate = activeSet.definition.questions.find((q) => q.axis === 'sending');
    if (sendingGate) {
      const prefill = await computeSendingPrefill(companyId);
      // 문항 세트가 바뀌어 매핑 키가 실존하지 않으면 선치환을 조용히 끈다(fail-safe — 콘텐츠 결합 가드)
      if (prefill && sendingGate.options.some((o) => o.key === prefill.optionKey)) {
        prefilled[sendingGate.key] = prefill.optionKey;
      }
    }
    return res.json({ success: true, version: activeSet.version, ...projected, prefilled });
  } catch (err) {
    if (handleDefinitionInvalid(err, res)) return;
    if (handleDbMigrationError(err, res, 'diagnosis_question_sets')) return;
    console.error('[marketing-diagnosis] questions 실패:', err);
    return res.status(500).json({ success: false, error: '문항 조회에 실패했습니다.' });
  }
});

// ────────────────────────────────────────────────────────────────────
// GET /report — 최신 funnel A 행 재열람 계약(§4-3 — submit 400·409와 무관하게 항상 열람 가능)
// ────────────────────────────────────────────────────────────────────
router.get('/report', async (req: Request, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
  try {
    const r = await query(
      `SELECT result, recommended_plan_code, recommended_monthly_price, created_at
         FROM marketing_diagnoses WHERE company_id = $1 AND funnel = 'A' LIMIT 1`,
      [companyId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, error: '진단 결과가 없습니다. 먼저 진단을 완료해 주세요.' });
    }
    return res.json({ success: true, ...r.rows[0] });
  } catch (err) {
    if (handleDbMigrationError(err, res, 'marketing_diagnoses')) return;
    console.error('[marketing-diagnosis] report 실패:', err);
    return res.status(500).json({ success: false, error: '리포트 조회에 실패했습니다.' });
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /invited — 초대 모달 표시 기록(멱등 — localStorage 판정 금지 §4-3)
// ────────────────────────────────────────────────────────────────────
router.post('/invited', async (req: Request, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
  try {
    await query(
      `INSERT INTO diagnosis_invites (company_id) VALUES ($1) ON CONFLICT (company_id) DO NOTHING`,
      [companyId],
    );
    return res.json({ success: true });
  } catch (err) {
    if (handleDbMigrationError(err, res, 'diagnosis_invites')) return;
    console.error('[marketing-diagnosis] invited 실패:', err);
    return res.status(500).json({ success: false, error: '기록에 실패했습니다.' });
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /submit — §4-1 전문: 저장+지급 한 트랜잭션(client 1개가 전 과정 소유)
// ────────────────────────────────────────────────────────────────────
router.post('/submit', async (req: Request, res: Response) => {
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
  try {
    // 읽기 준비는 전부 트랜잭션 밖(전역 query) — tx 안에서 풀 커넥션을 추가 요구하지 않는다(§4-1).
    // definition 구조 검증은 로더가 소유한다(위반 = catch의 handleDefinitionInvalid → 503).
    const activeSet = await loadActiveQuestionSet();
    if (!activeSet) return activeSetMissing(res);
    const answers = (req.body as any)?.answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      return res.status(400).json({ success: false, error: '답변 형식이 올바르지 않습니다.' });
    }
    // 문항 버전 결속(★Codex 1R) — 사용자가 본 세트와 계산할 세트가 다르면 조용한 재해석 대신 409.
    // 구 클라이언트(버전 미전송)는 기존 동작 유지.
    const requestedVersion = (req.body as any)?.question_set_version;
    if (typeof requestedVersion === 'string' && requestedVersion !== activeSet.version) {
      // 재시도 복구 우선(★Codex 2R) — 제출 커밋 후 응답 유실 + 버전 전환이 겹친 재시도는
      // "처음부터"가 아니라 저장된 결과를 돌려준다(완료 사용자를 초기화하지 않는다).
      const prev = await query(
        `SELECT result FROM marketing_diagnoses WHERE company_id = $1 AND funnel = 'A' LIMIT 1`,
        [companyId],
      );
      if (prev.rows.length > 0) {
        return res.json({ success: true, outcome: 'already_granted', result: prev.rows[0].result });
      }
      console.warn(`[marketing-diagnosis] submit 409 VERSION_CHANGED (company=${companyId}): ${requestedVersion} → ${activeSet.version}`);
      return res.status(409).json({
        success: false, code: 'VERSION_CHANGED',
        error: '진단 문항이 갱신되었어요. 처음부터 다시 진행해 주세요.',
      });
    }

    // v3 — sending 축 실측 선치환: 실측이 있으면 **서버값이 진실**이다(★Codex 1R — 클라이언트가
    // 보낸 값은 항상 덮어쓴다. 화면은 게이트가 아니다). 선치환 값은 answers에 저장하지 않는다(M1).
    const clientAnswers: Record<string, string> = { ...(answers as Record<string, string>) };
    const merged: Record<string, string> = { ...clientAnswers };
    let optionalKeys: Set<string> | undefined;
    let prefillInfo: ReportInputs['prefill'];
    const def: DiagnosisDefinition = activeSet.definition;
    const sendingGate = def.questions.find((q) => q.axis === 'sending');
    if (sendingGate) {
      const prefill = await computeSendingPrefill(companyId);
      if (prefill && sendingGate.options.some((o) => o.key === prefill.optionKey)) {
        merged[sendingGate.key] = prefill.optionKey;
        delete clientAnswers[sendingGate.key];   // 실측 축은 저장하지 않는다(둔갑 차단)
        prefillInfo = { sending: { optionKey: prefill.optionKey, sentCount: prefill.sentCount } };
        // 게이트를 참조하는 분기 = 필수 완화 키(로드·제출 시점 실측 차로 경로가 어긋나는 창 흡수)
        optionalKeys = new Set([sendingGate.key]);
        for (const q of def.questions) {
          if (q.show_when?.q === sendingGate.key) optionalKeys.add(q.key);
        }
        // 서버 게이트 기준으로 비가시가 된 잔재 분기 답은 서버가 정리한다(★Codex 1R —
        // 비가시 답이 처방 변형 입력으로 흘러드는 통로 차단. 그 밖의 비가시 답은 여전히 400)
        const visibleNow = new Set(visibleQuestions(def, merged).map((q) => q.key));
        for (const k of optionalKeys) {
          if (k !== sendingGate.key && merged[k] !== undefined && !visibleNow.has(k)) {
            delete merged[k];
            delete clientAnswers[k];
          }
        }
      }
    }

    const ansCheck = validateAnswers(def, merged, { optionalKeys });
    if (!ansCheck.ok) {
      // 4xx 무흔적 금지(기능 문서 §9) — 거절 사유를 서버에도 남긴다
      console.warn(`[marketing-diagnosis] submit 400 (company=${companyId}): ${ansCheck.error}`);
      return res.status(400).json({ success: false, error: ansCheck.error || '답변이 유효하지 않습니다.' });
    }

    const [planRes, usage, brandRes] = await Promise.all([
      query(DIAGNOSIS_PLAN_ROWS_SQL),
      computeMonthlyUsage(companyId),
      query(`SELECT brand_description, brand_tone FROM companies WHERE id = $1`, [companyId]),
    ]);
    const recommend = recommendPlan(def, merged, planRes.rows, { optionalKeys });
    const brandVoiceMissing = !(brandRes.rows[0]?.brand_description || brandRes.rows[0]?.brand_tone);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // §4-1 ⓐ·ⓓ — 회사 행 잠금 + 지급 자격 판정(수동 부여와 같은 CT 한 벌)
      const judgement = await judgeGrantEligibility(client, companyId);
      if (judgement.outcome === 'company_not_found') {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
      }
      // 원칙 2 — 제출도 잠근 행으로 FREE 정확 일치 재검사(§9-3: 유료·STAFF·TRIAL활성·미배정 = 400).
      if (judgement.outcome === 'not_applicable') {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, code: 'NOT_APPLICABLE', error: '현재 요금제에서는 진단을 제공하지 않습니다.' });
      }
      // 기지급 — A 진단이 이미 있으면 재호출 안정 응답(저장된 결과와 함께 already_granted).
      // A 진단이 없는 기지급(관리자 수동 B 지급이 선행)은 진단은 저장하고 지급만 건너뛴다
      // (★Codex 적대 수용 — 완주한 진단이 저장 경로를 잃으면 안 된다. §4-1 "진단은 저장" 원칙).
      if (judgement.outcome === 'already_granted') {
        const prev = await client.query(
          `SELECT result FROM marketing_diagnoses WHERE company_id = $1 AND funnel = 'A' LIMIT 1`,
          [companyId],
        );
        if (prev.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.json({ success: true, outcome: 'already_granted', result: prev.rows[0].result });
        }
      }
      // 이력·기지급이면 진단은 저장하되 지급만 없다(fail-closed·구제 = 기존 수동 부여).
      const outcome: 'granted' | 'already_granted' | 'not_eligible' =
        judgement.outcome === 'granted' ? 'granted'
        : judgement.outcome === 'already_granted' ? 'already_granted'
        : 'not_eligible';

      const result = buildDiagnosisResult({
        definition: def,
        answers: merged,
        recommend,
        usage,
        brandVoiceMissing,
        grantOutcome: outcome,
        prefill: prefillInfo,
      });

      // ⓑ·ⓒ 저장 — funnel A 부분 UNIQUE가 동시 제출 경쟁의 최후 방어(충돌 = 409)
      let diagnosisId: string;
      try {
        const ins = await client.query(
          `INSERT INTO marketing_diagnoses
             (funnel, company_id, submitted_by, question_set_version, answers, result,
              recommended_plan_id, recommended_plan_code, recommended_monthly_price, rule_version)
           VALUES ('A', $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9)
           RETURNING id`,
          [
            companyId,
            userId ?? null,
            activeSet.version,
            JSON.stringify(clientAnswers),   // 실측 선치환 축·잔재 분기 제거분(효과 답변 원장 — M1·Codex 1R)
            JSON.stringify(result),
            recommend.plan?.id ?? null,
            recommend.plan ? String(recommend.plan.plan_code) : null,
            recommend.plan ? Number(recommend.plan.monthly_price) : null,
            activeSet.definition.rule_version,
          ],
        );
        diagnosisId = ins.rows[0].id;
      } catch (insErr: any) {
        if (String(insErr?.code) === '23505') {
          await client.query('ROLLBACK');
          return res.status(409).json({
            success: false,
            code: 'ALREADY_SUBMITTED',
            error: '이미 제출된 진단입니다. 리포트에서 결과를 확인하실 수 있어요.',
          });
        }
        throw insErr;
      }

      if (outcome !== 'granted') {
        await client.query('COMMIT');
        return res.json({ success: true, outcome, result });
      }

      // ⓔ·ⓕ 지급 실행 — 같은 client 한 트랜잭션(CT — grants UNIQUE가 유일한 실효 장치 §2-3)
      let trialExpiresAt: Date | null;
      try {
        ({ trialExpiresAt } = await executeGrant(client, companyId, diagnosisId));
      } catch (grantErr) {
        if (grantErr instanceof GrantConflictError) {
          await client.query('ROLLBACK');
          return res.json({ success: true, outcome: 'already_granted', result: null });
        }
        throw grantErr;
      }

      await client.query('COMMIT');
      return res.json({ success: true, outcome: 'granted', result, trialExpiresAt });
    } catch (txErr) {
      try { await client.query('ROLLBACK'); } catch { /* 이중 롤백 무해 */ }
      throw txErr; // 전체 실패 = 진단 미저장 = 재시도 가능(§4-1 복구 경로)
    } finally {
      client.release();
    }
  } catch (err) {
    if (handleDefinitionInvalid(err, res)) return;
    if (handleDbMigrationError(err, res, 'marketing_diagnoses')) return;
    console.error('[marketing-diagnosis] submit 실패:', err);
    return res.status(500).json({ success: false, outcome: 'failed', error: '진단 제출 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /consult — CTA②: 기존 A 행 lead_status 'none'→'new' (새 행 아님·멱등 §4-3)
// ────────────────────────────────────────────────────────────────────
router.post('/consult', async (req: Request, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
  try {
    const upd = await query(
      `UPDATE marketing_diagnoses SET lead_status = 'new', updated_at = NOW()
        WHERE company_id = $1 AND funnel = 'A' AND lead_status = 'none'
        RETURNING id`,
      [companyId],
    );
    if (upd.rows.length === 0) {
      const exists = await query(
        `SELECT 1 FROM marketing_diagnoses WHERE company_id = $1 AND funnel = 'A' LIMIT 1`,
        [companyId],
      );
      if (exists.rows.length === 0) {
        return res.status(404).json({ success: false, error: '진단 결과가 없습니다. 먼저 진단을 완료해 주세요.' });
      }
      // 이미 신청됨 — 멱등 성공
    }
    return res.json({ success: true });
  } catch (err) {
    if (handleDbMigrationError(err, res, 'marketing_diagnoses')) return;
    console.error('[marketing-diagnosis] consult 실패:', err);
    return res.status(500).json({ success: false, error: '상담 신청에 실패했습니다.' });
  }
});

export default router;
