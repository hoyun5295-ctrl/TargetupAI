/**
 * routes/agency-send.ts — 대행발송 셀프 접수 API (★ 2026-08-22 신설)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §4-6. 상태·시각 판정은 CT(`utils/agency-send-state.ts`)가 소유한다.
 *
 * ⛔ 자격 판정은 `canUseAgencySend` 하나다(회사 스위치 AND 유료). 메뉴는 모든 회사에 보이지만 여기는 못 들어온다.
 * ⛔ 이 라우트는 **큐를 만들지 않는다.** 접수·승인은 원장 상태만 바꾸고, 큐 적재는 발송 2시간 전
 *   재검사를 통과한 뒤 워커가 한 번만 한다(설계서 불변 3). 그래서 승인 전 취소에는 지울 큐가 없다.
 * ⛔ 신규 테이블이라 컬럼·테이블 부재는 503 DB_MIGRATION_PENDING으로 돌려준다(db_alter_safety_net).
 */
import { Router, Request, Response } from 'express';
import pool, { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { canUseAgencySend, loadPlanContext } from '../utils/plan-guard';
import { isCallbackRegistered } from '../utils/callback-filter';
import { validateMmsPayload } from '../utils/mms-validator';
import { normalizePhone } from '../utils/normalize-phone';
import {
  canCancel, checkApproval, isEditable, needsQueueCancel, validateRequestedAt,
  type AgencySendStatus,
} from '../utils/agency-send-state';

const router = Router();
router.use(authenticate);

/** 접수 1건에 담을 수 있는 수신자 상한. 그 이상은 나눠 접수한다(엑셀 업로드 권장값과 같은 축) */
const MAX_RECIPIENTS = 30000;
const MAX_CONTENT = 2000;
/**
 * 수신자 INSERT 한 문장에 넣을 행 수.
 * ⛔ PostgreSQL 바인드 파라미터 상한은 65535다. 행마다 3개를 쓰므로 3만 건을 한 문장에 넣으면 9만 개가 되어
 *   상한을 넘긴다(적재가 통째로 실패한다). 나눠 넣되 **한 트랜잭션 안**에서 처리해 부분 적재를 만들지 않는다.
 */
const RECIPIENT_INSERT_CHUNK = 2000;

const isMissingRelation = (err: any) => {
  const msg = String(err?.message || '');
  return (msg.includes('relation') || msg.includes('column')) && msg.includes('does not exist');
};

function migrationPending(res: Response) {
  return res.status(503).json({
    success: false,
    code: 'DB_MIGRATION_PENDING',
    error: '대행발송을 준비 중입니다. 잠시 후 다시 시도해 주세요.',
  });
}

/**
 * 자격 확인. 쓰기·읽기 전 엔드포인트가 첫 줄에서 부른다.
 * 라우트 장식(미들웨어)으로 두지 않는 이유 = 효과를 만드는 문과 같은 함수 안에 있어야 경로가 늘어도 안 샌다.
 */
async function requireAgencySend(req: Request, res: Response): Promise<{ companyId: string; userId: string } | null> {
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  if (!companyId || !userId) {
    res.status(401).json({ success: false, error: '인증이 필요합니다.' });
    return null;
  }
  const ctx = await loadPlanContext(companyId);
  if (!canUseAgencySend(ctx)) {
    res.status(403).json({ success: false, code: 'AGENCY_SEND_NOT_ALLOWED', error: '대행발송이 열려 있지 않은 계정입니다.' });
    return null;
  }
  return { companyId, userId };
}

/** 회사 발송 허용 시간(없으면 CT 기본값) */
async function loadSendWindow(companyId: string): Promise<{ startHour: number | null; endHour: number | null }> {
  try {
    const r = await query(`SELECT send_start_hour, send_end_hour FROM companies WHERE id = $1`, [companyId]);
    const row = r.rows[0] || {};
    return {
      startHour: row.send_start_hour != null ? Number(row.send_start_hour) : null,
      endHour: row.send_end_hour != null ? Number(row.send_end_hour) : null,
    };
  } catch {
    return { startHour: null, endHour: null };
  }
}

async function logEvent(requestId: string, kind: string, payload: Record<string, any> = {}): Promise<void> {
  try {
    await query(`INSERT INTO agency_send_events (request_id, kind, payload) VALUES ($1::uuid, $2, $3::jsonb)`,
      [requestId, kind, JSON.stringify(payload)]);
  } catch (err: any) {
    console.warn('[agency-send] 이력 기록 실패(본 흐름은 계속):', err?.message);
  }
}

/** 목록·상세 응답에서 내부 필드를 떼어낸다 */
function toPublic(row: any) {
  return {
    id: row.id,
    status: row.status as AgencySendStatus,
    messageType: row.message_type,
    subject: row.subject,
    isAd: row.is_ad,
    callbackNumber: row.callback_number,
    managerPhone: row.manager_phone,
    originalContent: row.original_content,
    currentContent: row.current_content,
    contentVersion: row.content_version,
    mmsImagePaths: row.mms_image_paths || [],
    requestedAt: row.requested_at,
    recipientCount: row.recipient_count,
    fileName: row.file_name,
    varMapping: row.var_mapping || {},
    testRound: row.test_round,
    lastTestAt: row.last_test_at,
    lastTestResult: row.last_test_result || null,
    approvedAt: row.approved_at,
    approvalVersion: row.approval_version,
    reapprovalCount: row.reapproval_count,
    queuedAt: row.queued_at,
    campaignId: row.campaign_id,
    expiredAt: row.expired_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
  };
}

// ════════════════════════════════════════════════════════════
// GET /api/agency-send — 접수 목록
// ════════════════════════════════════════════════════════════
router.get('/', async (req: Request, res: Response) => {
  const auth = await requireAgencySend(req, res);
  if (!auth) return;
  try {
    const r = await query(
      `SELECT * FROM agency_send_requests WHERE company_id = $1::uuid ORDER BY created_at DESC LIMIT 100`,
      [auth.companyId],
    );
    return res.json({ success: true, requests: r.rows.map(toPublic) });
  } catch (err: any) {
    if (isMissingRelation(err)) return migrationPending(res);
    console.error('[agency-send] 목록 조회 실패:', err);
    return res.status(500).json({ success: false, error: '목록을 불러오지 못했습니다.' });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/agency-send — 접수
// ════════════════════════════════════════════════════════════
router.post('/', async (req: Request, res: Response) => {
  const auth = await requireAgencySend(req, res);
  if (!auth) return;

  try {
    const {
      messageType = 'SMS', subject, content, isAd = false, callbackNumber,
      managerPhone, requestedAt, mmsImagePaths, fileName, phoneColumn, varMapping,
      recipients,
    } = req.body || {};

    // ── 문안
    const body = String(content || '').trim();
    if (!body) return res.status(400).json({ success: false, error: '보낼 문안을 입력해 주세요.' });
    if (body.length > MAX_CONTENT) return res.status(400).json({ success: false, error: `문안은 ${MAX_CONTENT}자까지 넣을 수 있습니다.` });

    const type = String(messageType).toUpperCase();
    if (!['SMS', 'LMS', 'MMS'].includes(type)) {
      return res.status(400).json({ success: false, error: '보낼 수 있는 형식이 아닙니다.' });
    }
    if ((type === 'LMS' || type === 'MMS') && !String(subject || '').trim()) {
      return res.status(400).json({ success: false, error: '제목을 입력해 주세요.' });
    }
    // MMS는 이미지가 본체다. 0장이면 통신사가 파일 오류로 버린다(2026-04-21 9007 선례)
    const images = Array.isArray(mmsImagePaths) ? mmsImagePaths : [];
    const mmsCheck = validateMmsPayload(type, images);
    if (!mmsCheck.ok) return res.status(400).json({ success: false, error: mmsCheck.error, code: mmsCheck.code });

    // ── 발신번호(회사에 등록된 것만)
    const callback = normalizePhone(String(callbackNumber || ''));
    if (!callback) return res.status(400).json({ success: false, error: '보내는 번호를 골라 주세요.' });
    if (!(await isCallbackRegistered(auth.companyId, callback, auth.userId))) {
      return res.status(400).json({ success: false, error: '등록되지 않은 보내는 번호입니다. 발신번호 등록을 먼저 해 주세요.' });
    }

    // ── 담당자 번호(테스트 문자를 받을 곳)
    const manager = normalizePhone(String(managerPhone || ''));
    if (!manager || manager.length < 10) {
      return res.status(400).json({ success: false, error: '테스트 문자를 받을 담당자 휴대폰 번호를 넣어 주세요.' });
    }

    // ── 요청 시각(리드타임 + 회사 발송 허용 시간)
    const when = validateRequestedAt(requestedAt, new Date(), await loadSendWindow(auth.companyId));
    if (!when.valid) return res.status(400).json({ success: false, error: when.error });

    // ── 수신자
    const rows: Array<{ phone: string; vars: Record<string, any> }> = [];
    const seen = new Set<string>();
    for (const raw of Array.isArray(recipients) ? recipients : []) {
      const phone = normalizePhone(String(raw?.phone ?? raw ?? ''));
      if (!phone || phone.length < 10 || seen.has(phone)) continue;
      seen.add(phone);
      rows.push({ phone, vars: raw?.vars && typeof raw.vars === 'object' ? raw.vars : {} });
      if (rows.length >= MAX_RECIPIENTS) break;
    }
    if (rows.length === 0) {
      return res.status(400).json({ success: false, error: '보낼 번호가 없습니다. 명단을 확인해 주세요.' });
    }

    // ⛔ 접수 행과 수신자는 **한 트랜잭션**이다. 나뉘면 수신자 0건짜리 접수가 남고,
    //   워커가 그것을 집어 "보낼 사람이 없는 발송"을 만든다.
    const client = await pool.connect();
    let request: any;
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO agency_send_requests (
           company_id, created_by, status, callback_number, message_type, subject, mms_image_paths, is_ad,
           original_content, current_content, content_version, requested_at, manager_phone,
           file_name, phone_column, var_mapping, recipient_count
         ) VALUES ($1::uuid, $2::uuid, 'received', $3, $4, $5, $6::jsonb, $7, $8, $8, 1, $9, $10, $11, $12, $13::jsonb, $14)
         RETURNING *`,
        [
          auth.companyId, auth.userId, callback, type, subject || null,
          images.length > 0 ? JSON.stringify(images) : null, !!isAd,
          body, when.at, manager,
          fileName || null, String(phoneColumn || '전화번호'),
          JSON.stringify(varMapping && typeof varMapping === 'object' ? varMapping : {}),
          rows.length,
        ],
      );
      request = inserted.rows[0];

      for (let offset = 0; offset < rows.length; offset += RECIPIENT_INSERT_CHUNK) {
        const slice = rows.slice(offset, offset + RECIPIENT_INSERT_CHUNK);
        const values: any[] = [];
        const chunks: string[] = [];
        slice.forEach((r, i) => {
          const base = i * 3;
          chunks.push(`($1::uuid, $${base + 2}, $${base + 3}, $${base + 4}::jsonb)`);
          values.push(offset + i + 1, r.phone, JSON.stringify(r.vars));
        });
        await client.query(
          `INSERT INTO agency_send_recipients (request_id, row_no, phone, vars) VALUES ${chunks.join(',')}`,
          [request.id, ...values],
        );
      }

      // 적재 효과 검증 — 넣었다고 믿지 않고 센다(6원칙 ②). 어긋나면 접수 자체를 되돌린다
      const counted = await client.query(
        `SELECT COUNT(*)::int AS c FROM agency_send_recipients WHERE request_id = $1::uuid`, [request.id],
      );
      if ((counted.rows[0]?.c || 0) !== rows.length) {
        throw new Error(`수신자 적재 불일치: 기대 ${rows.length} 실제 ${counted.rows[0]?.c}`);
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }

    await logEvent(request.id, 'received', { recipientCount: rows.length, messageType: type });
    console.log(`[agency-send] 접수 company=${auth.companyId} id=${request.id} ${type} ${rows.length}건`);
    return res.status(201).json({ success: true, request: toPublic(request) });
  } catch (err: any) {
    if (isMissingRelation(err)) return migrationPending(res);
    console.error('[agency-send] 접수 실패:', err);
    return res.status(500).json({ success: false, error: '접수하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/agency-send/:id — 상세(검사 이력 포함)
// ════════════════════════════════════════════════════════════
router.get('/:id', async (req: Request, res: Response) => {
  const auth = await requireAgencySend(req, res);
  if (!auth) return;
  try {
    const r = await query(
      `SELECT * FROM agency_send_requests WHERE id = $1::uuid AND company_id = $2::uuid`,
      [req.params.id, auth.companyId],
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: '접수를 찾을 수 없습니다.' });

    const events = await query(
      `SELECT kind, payload, created_at FROM agency_send_events WHERE request_id = $1::uuid ORDER BY created_at DESC LIMIT 50`,
      [req.params.id],
    );
    return res.json({ success: true, request: toPublic(r.rows[0]), events: events.rows });
  } catch (err: any) {
    if (isMissingRelation(err)) return migrationPending(res);
    console.error('[agency-send] 상세 조회 실패:', err);
    return res.status(500).json({ success: false, error: '접수를 불러오지 못했습니다.' });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/agency-send/:id/approve — 승인(발송을 결정하는 유일한 손)
// ════════════════════════════════════════════════════════════
router.post('/:id/approve', async (req: Request, res: Response) => {
  const auth = await requireAgencySend(req, res);
  if (!auth) return;
  try {
    const r = await query(
      `SELECT * FROM agency_send_requests WHERE id = $1::uuid AND company_id = $2::uuid`,
      [req.params.id, auth.companyId],
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: '접수를 찾을 수 없습니다.' });
    const row = r.rows[0];

    const check = checkApproval(
      { status: row.status, contentVersion: Number(row.content_version), requestedAt: new Date(row.requested_at) },
      Number(req.body?.contentVersion),
      new Date(),
    );
    if (!check.ok) return res.status(400).json({ success: false, error: check.error, code: check.code });

    // 상태·버전을 조건에 넣어 같은 건이 두 번 승인되지 않게 한다(연타·두 사람 동시 승인)
    const updated = await query(
      `UPDATE agency_send_requests
          SET status = 'approved', approved_at = NOW(), approved_by = $1::uuid,
              approval_version = content_version, updated_at = NOW()
        WHERE id = $2::uuid AND company_id = $3::uuid
          AND status IN ('awaiting_approval','reapproval') AND content_version = $4
        RETURNING *`,
      [auth.userId, req.params.id, auth.companyId, Number(req.body?.contentVersion)],
    );
    if (updated.rows.length === 0) {
      return res.status(409).json({ success: false, error: '이미 처리된 접수입니다. 화면을 새로 고쳐 주세요.', code: 'CONFLICT' });
    }

    await logEvent(req.params.id, 'approved', { version: Number(req.body?.contentVersion), by: auth.userId });
    return res.json({ success: true, request: toPublic(updated.rows[0]) });
  } catch (err: any) {
    if (isMissingRelation(err)) return migrationPending(res);
    console.error('[agency-send] 승인 실패:', err);
    return res.status(500).json({ success: false, error: '승인하지 못했습니다.' });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/agency-send/:id/content — 문안 수정(수정하면 승인은 무효, 처음부터 다시 검사)
// ════════════════════════════════════════════════════════════
router.post('/:id/content', async (req: Request, res: Response) => {
  const auth = await requireAgencySend(req, res);
  if (!auth) return;
  try {
    const body = String(req.body?.content || '').trim();
    if (!body) return res.status(400).json({ success: false, error: '문안을 입력해 주세요.' });
    if (body.length > MAX_CONTENT) return res.status(400).json({ success: false, error: `문안은 ${MAX_CONTENT}자까지 넣을 수 있습니다.` });

    const r = await query(
      `SELECT status FROM agency_send_requests WHERE id = $1::uuid AND company_id = $2::uuid`,
      [req.params.id, auth.companyId],
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: '접수를 찾을 수 없습니다.' });
    if (!isEditable(r.rows[0].status)) {
      return res.status(400).json({ success: false, error: '지금은 문안을 고칠 수 있는 상태가 아닙니다.' });
    }

    // 원문도 함께 바꾼다 — 사용자가 새로 쓴 문장이 이번 접수의 원문이다(AI가 다듬을 때의 기준선).
    // 승인 흔적을 지워 옛 승인이 남지 않게 한다(불변 7).
    const updated = await query(
      `UPDATE agency_send_requests
          SET original_content = $1, current_content = $1, content_version = content_version + 1,
              status = 'received', test_round = 0, last_test_result = NULL, last_test_at = NULL,
              approved_at = NULL, approved_by = NULL, approval_version = NULL,
              subject = COALESCE($2, subject), expired_at = NULL, updated_at = NOW()
        WHERE id = $3::uuid AND company_id = $4::uuid
        RETURNING *`,
      [body, req.body?.subject ?? null, req.params.id, auth.companyId],
    );

    await logEvent(req.params.id, 'content_edited', { version: updated.rows[0]?.content_version });
    return res.json({ success: true, request: toPublic(updated.rows[0]) });
  } catch (err: any) {
    if (isMissingRelation(err)) return migrationPending(res);
    console.error('[agency-send] 문안 수정 실패:', err);
    return res.status(500).json({ success: false, error: '문안을 고치지 못했습니다.' });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/agency-send/:id/reschedule — 시각 변경(만료·재승인에서 새 시각을 받는다)
// ════════════════════════════════════════════════════════════
router.post('/:id/reschedule', async (req: Request, res: Response) => {
  const auth = await requireAgencySend(req, res);
  if (!auth) return;
  try {
    const r = await query(
      `SELECT status, content_version FROM agency_send_requests WHERE id = $1::uuid AND company_id = $2::uuid`,
      [req.params.id, auth.companyId],
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: '접수를 찾을 수 없습니다.' });
    if (!isEditable(r.rows[0].status)) {
      return res.status(400).json({ success: false, error: '지금은 시각을 고칠 수 있는 상태가 아닙니다.' });
    }

    const when = validateRequestedAt(req.body?.requestedAt, new Date(), await loadSendWindow(auth.companyId));
    if (!when.valid) return res.status(400).json({ success: false, error: when.error });

    // 문안은 그대로다. 검사를 이미 통과한 건이면 승인 대기로 돌려보내고, 아니면 검사부터 다시 한다.
    const backTo: AgencySendStatus = r.rows[0].status === 'test_failed' ? 'received' : 'awaiting_approval';
    const updated = await query(
      `UPDATE agency_send_requests
          SET requested_at = $1, status = $2, expired_at = NULL,
              approved_at = NULL, approved_by = NULL, approval_version = NULL, updated_at = NOW()
        WHERE id = $3::uuid AND company_id = $4::uuid
        RETURNING *`,
      [when.at, backTo, req.params.id, auth.companyId],
    );

    await logEvent(req.params.id, 'rescheduled', { requestedAt: when.at?.toISOString(), status: backTo });
    return res.json({ success: true, request: toPublic(updated.rows[0]) });
  } catch (err: any) {
    if (isMissingRelation(err)) return migrationPending(res);
    console.error('[agency-send] 시각 변경 실패:', err);
    return res.status(500).json({ success: false, error: '시각을 고치지 못했습니다.' });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/agency-send/:id/cancel — 취소
// ════════════════════════════════════════════════════════════
router.post('/:id/cancel', async (req: Request, res: Response) => {
  const auth = await requireAgencySend(req, res);
  if (!auth) return;
  try {
    const r = await query(
      `SELECT status, campaign_id FROM agency_send_requests WHERE id = $1::uuid AND company_id = $2::uuid`,
      [req.params.id, auth.companyId],
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: '접수를 찾을 수 없습니다.' });
    const { status, campaign_id: campaignId } = r.rows[0];

    if (!canCancel(status)) {
      return res.status(400).json({ success: false, error: '검사가 진행 중이라 지금은 취소할 수 없습니다. 잠시 후 다시 시도해 주세요.' });
    }

    // 큐에 실린 뒤(queued)의 취소는 큐 삭제까지 끝나야 취소다.
    // ⛔ 여기서 자체 DELETE를 쓰지 않는다 — 취소의 실체(라인 집합·효과 검증)는 기존 캠페인 취소 CT가 소유한다.
    //   0611 에이치피오 87,014건 실발송이 "취소 화면만 바뀌고 큐가 남은" 사고였다.
    if (needsQueueCancel(status)) {
      if (!campaignId) {
        return res.status(409).json({ success: false, error: '발송 준비 상태를 확인하지 못했습니다. 담당자에게 문의해 주세요.' });
      }
      const { cancelCampaign } = await import('../utils/campaign-lifecycle');
      const result = await cancelCampaign(campaignId, auth.companyId, {
        cancelledBy: auth.userId,
        cancelledByType: req.user?.userType,
      });
      if (!result.success) {
        return res.status(result.tooLate ? 400 : 500).json({ success: false, error: result.error, tooLate: result.tooLate });
      }
    }

    const updated = await query(
      `UPDATE agency_send_requests
          SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $1, updated_at = NOW()
        WHERE id = $2::uuid AND company_id = $3::uuid AND status <> 'cancelled'
        RETURNING *`,
      [String(req.body?.reason || '담당자 취소').slice(0, 200), req.params.id, auth.companyId],
    );
    if (updated.rows.length === 0) {
      return res.status(409).json({ success: false, error: '이미 취소된 접수입니다.' });
    }

    await logEvent(req.params.id, 'cancelled', { from: status, queueCancelled: needsQueueCancel(status) });
    return res.json({ success: true, request: toPublic(updated.rows[0]) });
  } catch (err: any) {
    if (isMissingRelation(err)) return migrationPending(res);
    console.error('[agency-send] 취소 실패:', err);
    return res.status(500).json({ success: false, error: '취소하지 못했습니다.' });
  }
});

export default router;
