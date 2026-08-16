/**
 * 라우트: AI 마케팅 진단 — 슈퍼관리자 「신규마케팅진단」 (2026-08-16 신설)
 * 설계서 = docs/2026-08-16-marketing-diagnosis-design.md §4-6·§5-7
 *
 * 게이트
 *   - /access만 게이트 use보다 먼저(같은 전용 라우터 안 — 별도 라우터에 두면 mount 선점 404 · §4-6).
 *   - 이하 전 라우트 = authenticate + requireSuperAdmin + isDiagnosisViewer(비허용 = 404 존재 은닉).
 *   - 판정 인자 = req.user.userId(super_admins.id uuid) — loginId를 넘기면 uuid 예외를 코어가 삼켜 전원 차단(D1).
 *
 * 수동 부여(§4-6) — 잠긴 diagnosis 행에서 대상(linked_company_id) 파생. 임의 companyId 입력 금지.
 * 연결·지급·상태 전이·감사 기록이 한 트랜잭션(§4-1과 같은 CT — marketing-diagnosis-grant).
 */
import { Router, Request, Response } from 'express';
import pool, { query } from '../config/database';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { recordAuditLog, isDiagnosisViewer } from '../utils/audit-log';
import { judgeGrantEligibility, executeGrant, GrantConflictError } from '../utils/marketing-diagnosis-grant';

const router = Router();

// ── /access — 메뉴 노출 게이팅(기존 3축 대칭). 게이트 use보다 반드시 먼저 선언 ──
router.get('/access', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  res.json({ allowed: await isDiagnosisViewer(req.user?.userId) });
});

// ── 이하 전 라우트 게이트 — 비허용 계정에는 404(존재 은닉) ──
router.use(authenticate, requireSuperAdmin, async (req: Request, res: Response, next) => {
  if (await isDiagnosisViewer(req.user?.userId)) return next();
  return res.status(404).json({ success: false, error: '요청한 리소스를 찾을 수 없습니다.' });
});

/** 파이프라인 전이 표(§5-7). none→new는 고객 CTA(consult)만의 몫 — 관리자 전이에 없다. */
const LEAD_TRANSITIONS: Record<string, string[]> = {
  new: ['attempted', 'contacted', 'disqualified', 'on_hold'],
  attempted: ['attempted', 'contacted', 'disqualified', 'on_hold'],
  contacted: ['account_created', 'converted', 'disqualified', 'on_hold'],
  account_created: ['converted', 'disqualified', 'on_hold'],   // trial_granted 진입은 수동 부여 endpoint만
  trial_granted: ['converted', 'disqualified', 'on_hold'],
  on_hold: ['attempted', 'contacted', 'disqualified'],
};

// ────────────────────────────────────────────────────────────────────
// GET /badge — 신규 리드 수(사이드바 뱃지. 비허용 계정은 게이트 404 → 프론트 미렌더)
// ────────────────────────────────────────────────────────────────────
router.get('/badge', async (_req: Request, res: Response) => {
  try {
    const r = await query(`SELECT count(*)::int AS n FROM marketing_diagnoses WHERE lead_status = 'new'`);
    return res.json({ success: true, count: Number(r.rows[0]?.n ?? 0) });
  } catch (err) {
    if (handleDbMigrationError(err, res, 'marketing_diagnoses')) return;
    console.error('[diagnosis-admin] badge 실패:', err);
    return res.status(500).json({ success: false, error: '뱃지 조회 실패' });
  }
});

// ────────────────────────────────────────────────────────────────────
// GET / — 목록(A+B 통합 · 필터 · 이메일 그룹 카운트)
// ────────────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const funnel = req.query.funnel === 'A' || req.query.funnel === 'B' ? String(req.query.funnel) : null;
    const status = typeof req.query.status === 'string' && req.query.status.trim() ? req.query.status.trim() : null;
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const conds: string[] = [];
    const params: any[] = [];
    if (funnel) { params.push(funnel); conds.push(`md.funnel = $${params.length}`); }
    if (status) { params.push(status); conds.push(`md.lead_status = $${params.length}`); }
    const whereSql = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';

    params.push(limit, offset);
    const r = await query(
      `SELECT md.id, md.funnel, md.company_id, c.company_name,
              md.lead_company_name, md.lead_contact_name, md.lead_email, md.lead_phone,
              md.lead_status, md.contact_attempts, md.disqualify_reason, md.linked_company_id,
              md.recommended_plan_code, md.recommended_monthly_price, md.source_utm, md.created_at,
              CASE WHEN md.funnel = 'B'
                   THEN count(*) OVER (PARTITION BY lower(md.lead_email)) END AS same_email_count,
              count(*) OVER () AS total_count
         FROM marketing_diagnoses md
         LEFT JOIN companies c ON c.id = md.company_id
         ${whereSql}
        ORDER BY md.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const total = r.rows.length > 0 ? Number(r.rows[0].total_count) : 0;
    return res.json({
      success: true,
      total,
      rows: r.rows.map(({ total_count: _t, ...row }: any) => row),
    });
  } catch (err) {
    if (handleDbMigrationError(err, res, 'marketing_diagnoses')) return;
    console.error('[diagnosis-admin] 목록 실패:', err);
    return res.status(500).json({ success: false, error: '목록 조회 실패' });
  }
});

// ────────────────────────────────────────────────────────────────────
// GET /:id — 상세(답변 + 리포트 + 파이프라인)
// ────────────────────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const r = await query(
      `SELECT md.*, c.company_name, lc.company_name AS linked_company_name
         FROM marketing_diagnoses md
         LEFT JOIN companies c  ON c.id  = md.company_id
         LEFT JOIN companies lc ON lc.id = md.linked_company_id
        WHERE md.id = $1::uuid`,
      [req.params.id],
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: '진단을 찾을 수 없습니다.' });
    return res.json({ success: true, diagnosis: r.rows[0] });
  } catch (err) {
    if (handleDbMigrationError(err, res, 'marketing_diagnoses')) return;
    console.error('[diagnosis-admin] 상세 실패:', err);
    return res.status(500).json({ success: false, error: '상세 조회 실패' });
  }
});

// ────────────────────────────────────────────────────────────────────
// PATCH /:id/status — 파이프라인 전이(전이 표 강제 · attempted 재시도 카운트 · 실격 사유 의무)
// ────────────────────────────────────────────────────────────────────
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const to = String((req.body as any)?.status || '').trim();
    const disqualifyReason = (req.body as any)?.disqualify_reason
      ? String((req.body as any).disqualify_reason).slice(0, 30)
      : null;
    const linkedCompanyId = (req.body as any)?.linked_company_id
      ? String((req.body as any).linked_company_id)
      : null;

    const cur = await query(`SELECT id, funnel, lead_status FROM marketing_diagnoses WHERE id = $1::uuid`, [req.params.id]);
    if (cur.rows.length === 0) return res.status(404).json({ success: false, error: '진단을 찾을 수 없습니다.' });
    const row = cur.rows[0];

    const allowed = LEAD_TRANSITIONS[row.lead_status] ?? [];
    if (!allowed.includes(to)) {
      return res.status(400).json({ success: false, error: `허용되지 않는 상태 전이입니다: ${row.lead_status} → ${to}` });
    }
    if (to === 'account_created' && row.funnel !== 'B') {
      return res.status(400).json({ success: false, error: '계정 생성 상태는 잠재고객(퍼널 B)에만 적용됩니다.' });
    }
    if (to === 'disqualified' && !disqualifyReason) {
      return res.status(400).json({ success: false, error: '실격 사유가 필요합니다.' });
    }
    if (linkedCompanyId) {
      const exists = await query(`SELECT 1 FROM companies WHERE id = $1::uuid`, [linkedCompanyId]);
      if (exists.rows.length === 0) return res.status(400).json({ success: false, error: '연결할 회사를 찾을 수 없습니다.' });
    }

    const upd = await query(
      `UPDATE marketing_diagnoses
          SET lead_status = $2,
              contact_attempts = contact_attempts + CASE WHEN $2 = 'attempted' THEN 1 ELSE 0 END,
              disqualify_reason = CASE WHEN $2 = 'disqualified' THEN $3 ELSE disqualify_reason END,
              linked_company_id = COALESCE($4::uuid, linked_company_id),
              updated_at = NOW()
        WHERE id = $1::uuid AND lead_status = $5
        RETURNING id, lead_status, contact_attempts, linked_company_id`,
      [req.params.id, to, disqualifyReason, linkedCompanyId, row.lead_status],
    );
    if (upd.rows.length === 0) {
      return res.status(409).json({ success: false, error: '다른 곳에서 상태가 먼저 바뀌었습니다. 새로고침 후 다시 시도해 주세요.' });
    }

    // 감사 details = 허용 키만(§4-6 — 키 허용목록 테스트 대상)
    await recordAuditLog({
      actorUserId: req.user?.userId,
      action: 'diagnosis_status_change',
      targetType: 'marketing_diagnosis',
      targetId: req.params.id,
      details: { diagnosis_id: req.params.id, company_id: upd.rows[0].linked_company_id ?? null, outcome: to },
      req,
    });
    return res.json({ success: true, diagnosis: upd.rows[0] });
  } catch (err) {
    if (handleDbMigrationError(err, res, 'marketing_diagnoses')) return;
    console.error('[diagnosis-admin] 상태 변경 실패:', err);
    return res.status(500).json({ success: false, error: '상태 변경 실패' });
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /:id/grant — 수동 부여(퍼널 B 구제). 대상 = 잠긴 행의 linked_company_id 파생.
// 연결·지급·상태 전이·감사 기록 = 한 트랜잭션(§4-1과 같은 CT 원자성).
// ────────────────────────────────────────────────────────────────────
router.post('/:id/grant', async (req: Request, res: Response) => {
  // 성공 시에만 채워진다 — 감사 기록·응답은 client 반환 "뒤"에 한다(★Codex 적대 수용:
  // COMMIT 후 전역 query 감사를 client를 쥔 채 기다리면, 동시 요청이 풀 크기만큼 쌓일 때
  // 각자가 감사용 두 번째 커넥션을 기다리는 자기 고갈이 된다).
  let grantedInfo: { diagnosisId: string; companyId: string; trialExpiresAt: Date | null } | null = null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dx = await client.query(
      `SELECT id, funnel, lead_status, linked_company_id FROM marketing_diagnoses
        WHERE id = $1::uuid FOR UPDATE`,
      [req.params.id],
    );
    if (dx.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: '진단을 찾을 수 없습니다.' });
    }
    const row = dx.rows[0];
    if (row.funnel !== 'B') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: '수동 부여는 잠재고객(퍼널 B) 리드에만 적용됩니다.' });
    }
    // ★Codex 적대 수용 — 출발 상태를 account_created로 제한한다. terminal(converted·disqualified)이나
    //   진행 전 상태에서 지급하면 실제 혜택과 파이프라인 원장이 함께 오염된다.
    if (row.lead_status !== 'account_created') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        error: `수동 부여는 계정 생성 완료(account_created) 상태에서만 가능합니다. 현재: ${row.lead_status}`,
      });
    }
    if (!row.linked_company_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: '먼저 상태 변경에서 생성된 회사를 연결해 주세요.' });
    }

    const judgement = await judgeGrantEligibility(client, row.linked_company_id);
    if (judgement.outcome !== 'granted') {
      await client.query('ROLLBACK');
      const msg: Record<string, string> = {
        company_not_found: '연결된 회사를 찾을 수 없습니다.',
        not_applicable: '연결된 회사가 미가입(FREE) 상태가 아닙니다.',
        already_granted: '이미 진단 체험이 지급된 회사입니다.',
        not_eligible: '체험 이력이 있어 자동 지급 대상이 아닙니다. 필요 시 기존 수동 부여(고객사 상세)를 사용해 주세요.',
      };
      return res.status(409).json({ success: false, code: judgement.outcome, error: msg[judgement.outcome] });
    }

    let trialExpiresAt: Date | null;
    try {
      // 행위자 스냅샷을 지급 행에 함께 영속화 — 사후 감사 기록이 유실돼도 원장에 남는다(2R 수용).
      ({ trialExpiresAt } = await executeGrant(client, row.linked_company_id, row.id, {
        grantedBy: `admin:${req.user?.userId ?? 'unknown'}`,
      }));
    } catch (grantErr) {
      if (grantErr instanceof GrantConflictError) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, code: 'already_granted', error: '이미 진단 체험이 지급된 회사입니다.' });
      }
      throw grantErr;
    }

    // 전이도 잠금 시점 상태를 조건으로 — 0행이면 경쟁이 끼어든 것이므로 지급째 되돌린다.
    const upd = await client.query(
      `UPDATE marketing_diagnoses SET lead_status = 'trial_granted', updated_at = NOW()
        WHERE id = $1::uuid AND lead_status = 'account_created'
        RETURNING id`,
      [row.id],
    );
    if (upd.rows.length !== 1) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: '다른 곳에서 상태가 먼저 바뀌었습니다. 새로고침 후 다시 시도해 주세요.' });
    }
    await client.query('COMMIT');
    grantedInfo = { diagnosisId: row.id, companyId: row.linked_company_id, trialExpiresAt };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* 이중 롤백 무해 */ }
    if (handleDbMigrationError(err, res, 'diagnosis_trial_grants')) return;
    console.error('[diagnosis-admin] 수동 부여 실패:', err);
    return res.status(500).json({ success: false, error: '수동 부여에 실패했습니다.' });
  } finally {
    client.release();
  }

  // 감사 기록 = client 반환 뒤 best-effort(실패 흡수 CT) — details = 허용 키만
  await recordAuditLog({
    actorUserId: req.user?.userId,
    action: 'diagnosis_manual_grant',
    targetType: 'marketing_diagnosis',
    targetId: grantedInfo.diagnosisId,
    details: { diagnosis_id: grantedInfo.diagnosisId, company_id: grantedInfo.companyId, outcome: 'trial_granted' },
    req,
  });
  return res.json({ success: true, trialExpiresAt: grantedInfo.trialExpiresAt });
});

export default router;
