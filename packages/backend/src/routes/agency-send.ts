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
  canCancel, checkApproval, isEditable, NOT_CANCELABLE_SQL, validateRequestedAt,
  type AgencySendStatus,
} from '../utils/agency-send-state';
import { buildSlotPlan, extractAgencyVars } from '../utils/agency-send-vars';
import { findAttemptCampaignId } from '../utils/agency-send-campaign';
import { SEND_HOURS } from '../config/defaults';
import { triggerAgencySendDispatch } from '../utils/agency-send-worker';

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
/** 테스트 문자를 받을 담당자 수 상한. 그 이상은 실수로 명단을 넣은 것이다 */
const MAX_MANAGER_PHONES = 10;

const isMissingRelation = (err: any) => {
  const msg = String(err?.message || '');
  return (msg.includes('relation') || msg.includes('column')) && msg.includes('does not exist');
};

/**
 * 제목에 변수를 쓰지 못하게 막는다(★2026-08-23 Codex 적대 검토 high).
 *
 * 발송 배관은 **제목을 치환하지 않는다**(Harold 확정 · `messageUtils.prepareSendMessage` 3단계 주석).
 * 그래서 제목에 `%이름%`을 쓰면 그 글자가 그대로 고객에게 간다. 본문 슬롯과 짝도 맞지 않는다.
 * 발송 뒤에 알게 되는 결함이라 접수·수정에서 막는다.
 */
function rejectSubjectVars(subject: any, res: Response): boolean {
  const vars = extractAgencyVars(String(subject || ''));
  if (vars.length === 0) return false;
  res.status(400).json({
    success: false,
    code: 'SUBJECT_VARS',
    error: `제목에는 항목을 넣을 수 없습니다: ${vars.map((v) => `%${v}%`).join(' ')}. 제목은 모든 수신자에게 같은 문장으로 나갑니다.`,
  });
  return true;
}

/**
 * **예약이 한 번이라도 만들어진 접수는 고쳐서 다시 보내지 않는다**(★2026-08-23 Codex 3R high).
 *
 * `campaign_id`가 붙었다는 것은 이 명단이 이미 발송 배관에 들어갔다는 뜻이다. 그 뒤 예약이 중간에
 * 끊겼더라도 **일부는 이미 나갔을 수 있다**(적재 도중 예외로 종결된 캠페인이 그렇다).
 * 그 상태에서 시각만 바꿔 다시 보내면 같은 사람에게 두 번 가고 요금도 두 번 나간다.
 * 다시 보내야 하면 결과를 확인한 뒤 **새 접수**로 간다.
 */
function rejectAlreadyDispatched(campaignId: any, res: Response): boolean {
  if (!campaignId) return false;
  res.status(400).json({
    success: false,
    code: 'ALREADY_DISPATCHED',
    error: '이미 발송 준비가 시작된 접수입니다. 발송 결과를 확인하신 뒤 새로 접수해 주세요.',
  });
  return true;
}

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

/**
 * 회사 발송 허용 시간(없으면 CT 기본값).
 *
 * ⛔ 광고면 플랫폼 창(`SEND_HOURS`)과 **겹치는 구간**만 쓴다. 회사 설정이 그보다 넓어도 광고는
 *   야간 제한(정보통신망법)에 걸려 예약 단계에서 거절된다. 접수에서 안 막으면 담당자는
 *   발송 2시간 전에야 "나가지 않았다"를 알게 된다(★2026-08-23).
 */
async function loadSendWindow(companyId: string, isAd: boolean): Promise<{ startHour: number | null; endHour: number | null }> {
  let startHour: number | null = null;
  let endHour: number | null = null;
  try {
    const r = await query(`SELECT send_start_hour, send_end_hour FROM companies WHERE id = $1`, [companyId]);
    const row = r.rows[0] || {};
    startHour = row.send_start_hour != null ? Number(row.send_start_hour) : null;
    endHour = row.send_end_hour != null ? Number(row.send_end_hour) : null;
  } catch {
    startHour = null;
    endHour = null;
  }
  if (!isAd) return { startHour, endHour };
  return {
    startHour: Math.max(startHour ?? SEND_HOURS.start, SEND_HOURS.start),
    endHour: Math.min(endHour ?? SEND_HOURS.end, SEND_HOURS.end),
  };
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
    managerPhones: Array.isArray(row.manager_phones) && row.manager_phones.length > 0
      ? row.manager_phones
      : [row.manager_phone].filter(Boolean),
    originalContent: row.original_content,
    currentContent: row.current_content,
    contentVersion: row.content_version,
    // 행 수정 번호. 화면이 이 값을 되돌려주고 서버가 조건으로 쓴다(낙관적 잠금).
    revision: row.revision,
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
    // 화면이 "지금 승인하면 바로 예약된다"와 "승인 뒤 발송 직전 검사가 한 번 더 있다"를 구분하는 값
    finalTestedAt: row.final_test_at,
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
      managerPhone, managerPhones, requestedAt, mmsImagePaths, fileName, phoneColumn, varMapping,
      recipients,
    } = req.body || {};

    // ── 문안
    const body = String(content || '').trim();
    if (!body) return res.status(400).json({ success: false, error: '보낼 문안을 입력해 주세요.' });
    if (body.length > MAX_CONTENT) return res.status(400).json({ success: false, error: `문안은 ${MAX_CONTENT}자까지 넣을 수 있습니다.` });

    // 문안 변수는 직접발송과 같은 주소록 슬롯 네 칸에 얹는다(치환 CT가 하나여야 하므로).
    // ⛔ 발송 직전에 조용히 잘리면 안 되므로 접수에서 막는다.
    const plan = buildSlotPlan(body);
    if (!plan.ok) return res.status(400).json({ success: false, error: plan.error, code: 'TOO_MANY_VARS' });

    const type = String(messageType).toUpperCase();
    if (!['SMS', 'LMS', 'MMS'].includes(type)) {
      return res.status(400).json({ success: false, error: '보낼 수 있는 형식이 아닙니다.' });
    }
    if ((type === 'LMS' || type === 'MMS') && !String(subject || '').trim()) {
      return res.status(400).json({ success: false, error: '제목을 입력해 주세요.' });
    }
    if (rejectSubjectVars(subject, res)) return;
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

    // ── 담당자 번호(테스트 문자를 받을 곳). **여러 명일 수 있다**(Harold 2026-08-23)
    const managerList: string[] = [];
    const managerSeen = new Set<string>();
    const managerRaw: any[] = Array.isArray(managerPhones) ? managerPhones : [managerPhone];
    for (const raw of managerRaw) {
      const phone = normalizePhone(String(raw || ''));
      if (!phone || phone.length < 10 || managerSeen.has(phone)) continue;
      managerSeen.add(phone);
      managerList.push(phone);
      if (managerList.length >= MAX_MANAGER_PHONES) break;
    }
    if (managerList.length === 0) {
      return res.status(400).json({ success: false, error: '테스트 문자를 받을 담당자 휴대폰 번호를 넣어 주세요.' });
    }

    // ── 요청 시각(리드타임 + 회사 발송 허용 시간)
    const when = validateRequestedAt(requestedAt, new Date(), await loadSendWindow(auth.companyId, !!isAd));
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
           original_content, current_content, content_version, requested_at, manager_phone, manager_phones,
           file_name, phone_column, var_mapping, recipient_count
         ) VALUES ($1::uuid, $2::uuid, 'received', $3, $4, $5, $6::jsonb, $7, $8, $8, 1, $9, $10, $11::text[], $12, $13, $14::jsonb, $15)
         RETURNING *`,
        [
          auth.companyId, auth.userId, callback, type, subject || null,
          images.length > 0 ? JSON.stringify(images) : null, !!isAd,
          body, when.at, managerList[0], managerList,
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

    // ⛔ 승인의 기준은 **행 수정 번호**다(★2026-08-23 Codex 2R high). 문안 버전만 보면
    //   시각만 바뀐 건은 상태도 버전도 그대로라, 담당자가 **못 본 시각**으로 옛 승인이 통과한다.
    const revision = Number(req.body?.revision);
    const check = checkApproval(
      { status: row.status, revision: Number(row.revision), requestedAt: new Date(row.requested_at) },
      revision,
      new Date(),
    );
    if (!check.ok) return res.status(400).json({ success: false, error: check.error, code: check.code });

    const updated = await query(
      `UPDATE agency_send_requests
          SET status = 'approved', approved_at = NOW(), approved_by = $1::uuid,
              approval_version = content_version, revision = revision + 1, updated_at = NOW()
        WHERE id = $2::uuid AND company_id = $3::uuid
          AND status IN ('awaiting_approval','reapproval') AND revision = $4
        RETURNING *`,
      [auth.userId, req.params.id, auth.companyId, revision],
    );
    if (updated.rows.length === 0) {
      return res.status(409).json({ success: false, error: '이미 처리된 접수입니다. 화면을 새로 고쳐 주세요.', code: 'CONFLICT' });
    }

    await logEvent(req.params.id, 'approved', { revision, by: auth.userId });
    // 재승인은 남은 시간이 짧다. 다음 tick을 기다리면 그 사이에 만료 기준을 지나 승인이 헛돈다.
    triggerAgencySendDispatch(req.params.id);
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
    if (req.body?.subject != null && rejectSubjectVars(req.body.subject, res)) return;

    const r = await query(
      `SELECT status, var_mapping, revision, campaign_id FROM agency_send_requests WHERE id = $1::uuid AND company_id = $2::uuid`,
      [req.params.id, auth.companyId],
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: '접수를 찾을 수 없습니다.' });
    if (!isEditable(r.rows[0].status)) {
      return res.status(400).json({ success: false, error: '지금은 문안을 고칠 수 있는 상태가 아닙니다.' });
    }
    if (rejectAlreadyDispatched(r.rows[0].campaign_id, res)) return;
    // ⛔ 화면이 보고 있던 행 수정 번호를 조건으로 쓴다. 그 사이 워커가 문안을 다듬었거나 상태가 바뀌었으면
    //   덮지 않고 돌려보낸다(조건 없이 덮으면 워커가 잡고 있는 건의 lock이 깨진다).
    const observedRevision = Number(req.body?.revision);
    if (!Number.isFinite(observedRevision)) {
      return res.status(400).json({ success: false, code: 'REVISION_REQUIRED', error: '화면을 새로 고친 뒤 다시 시도해 주세요.' });
    }

    const plan = buildSlotPlan(body);
    if (!plan.ok) return res.status(400).json({ success: false, error: plan.error, code: 'TOO_MANY_VARS' });
    // 명단은 접수 때 확정됐다. 그때 연결하지 않은 항목을 새로 넣으면 그 자리가 빈칸으로 나간다.
    const known = Object.keys(r.rows[0].var_mapping || {});
    const unknown = plan.order.filter((v) => !known.includes(v));
    if (unknown.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'UNKNOWN_VARS',
        error: `명단에 연결하지 않은 항목이 있습니다: ${unknown.map((v) => `%${v}%`).join(' ')}. 그 부분을 빼거나 새로 접수해 주세요.`,
      });
    }

    // 원문도 함께 바꾼다 — 사용자가 새로 쓴 문장이 이번 접수의 원문이다(AI가 다듬을 때의 기준선).
    // 승인 흔적을 지워 옛 승인이 남지 않게 한다(불변 7).
    // ⛔ `final_test_at`도 지운다 — 바뀐 문안은 당일 검사를 통과한 적이 없다(그대로 두면 검사 없이 나간다).
    // ⛔ `dispatch_key`·`campaign_id`도 지운다 — 문안이 바뀌면 앞선 시도와는 다른 발송이다(새 시도 키를 받는다).
    // ⛔ **관찰한 상태·버전을 조건에 넣는다.** 조건 없이 덮으면 워커가 잡고 있는 건의 lock을 깨고,
    //   그 워커가 뒤늦게 옛 문안으로 상태를 되돌려 **고친 적 없는 문장이 나가는** 경로가 생긴다.
    const updated = await query(
      `UPDATE agency_send_requests
          SET original_content = $1, current_content = $1, content_version = content_version + 1,
              status = 'received', test_round = 0, last_test_result = NULL, last_test_at = NULL,
              approved_at = NULL, approved_by = NULL, approval_version = NULL, final_test_at = NULL,
              dispatch_key = NULL, campaign_id = NULL,
              subject = COALESCE($2, subject), expired_at = NULL,
              lock_at = NULL, lock_token = NULL, revision = revision + 1, updated_at = NOW()
        WHERE id = $3::uuid AND company_id = $4::uuid AND revision = $5
        RETURNING *`,
      [body, req.body?.subject ?? null, req.params.id, auth.companyId, observedRevision],
    );
    if (updated.rows.length === 0) {
      return res.status(409).json({
        success: false,
        code: 'STATE_CHANGED',
        error: '그 사이 상태가 바뀌었습니다. 화면을 새로 고치고 다시 시도해 주세요.',
      });
    }

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
      `SELECT status, revision, is_ad, campaign_id FROM agency_send_requests WHERE id = $1::uuid AND company_id = $2::uuid`,
      [req.params.id, auth.companyId],
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: '접수를 찾을 수 없습니다.' });
    if (!isEditable(r.rows[0].status)) {
      return res.status(400).json({ success: false, error: '지금은 시각을 고칠 수 있는 상태가 아닙니다.' });
    }
    if (rejectAlreadyDispatched(r.rows[0].campaign_id, res)) return;
    const observedRevision = Number(req.body?.revision);
    if (!Number.isFinite(observedRevision)) {
      return res.status(400).json({ success: false, code: 'REVISION_REQUIRED', error: '화면을 새로 고친 뒤 다시 시도해 주세요.' });
    }

    const when = validateRequestedAt(
      req.body?.requestedAt, new Date(), await loadSendWindow(auth.companyId, !!r.rows[0].is_ad),
    );
    if (!when.valid) return res.status(400).json({ success: false, error: when.error });

    // 문안은 그대로다. 검사를 이미 통과한 건이면 승인 대기로 돌려보내고, 아니면 검사부터 다시 한다.
    // ⛔ `final_test_at`을 지운다 — 시각이 바뀌면 그 날 그 시각 기준의 검사를 다시 받아야 한다(불변 2).
    // ⛔ `dispatch_key`·`campaign_id`를 지운다 — 새 시각은 새 시도다. 그대로 두면 실패한 앞 시도의
    //   캠페인을 계속 찾아 같은 자리에서 다시 닫힌다(★2026-08-23 Codex 적대 검토 high).
    // ⛔ 관찰한 상태를 조건에 넣는다(문안 수정과 같은 이유).
    const backTo: AgencySendStatus = r.rows[0].status === 'test_failed' ? 'received' : 'awaiting_approval';
    const updated = await query(
      `UPDATE agency_send_requests
          SET requested_at = $1, status = $2, expired_at = NULL,
              approved_at = NULL, approved_by = NULL, approval_version = NULL, final_test_at = NULL,
              dispatch_key = NULL, campaign_id = NULL, lock_at = NULL, lock_token = NULL,
              revision = revision + 1, updated_at = NOW()
        WHERE id = $3::uuid AND company_id = $4::uuid AND revision = $5
        RETURNING *`,
      [when.at, backTo, req.params.id, auth.companyId, observedRevision],
    );
    if (updated.rows.length === 0) {
      return res.status(409).json({
        success: false,
        code: 'STATE_CHANGED',
        error: '그 사이 상태가 바뀌었습니다. 화면을 새로 고치고 다시 시도해 주세요.',
      });
    }

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
    // ⛔ **취소는 두 저장소를 건드리는 다단계 작업이다**(★2026-08-23 Codex 3R critical).
    //   원장을 먼저 `cancelled`로 확정하면, 그 뒤 큐 삭제가 실패하거나 프로세스가 죽는 순간
    //   **화면은 취소인데 큐는 살아 요청 시각에 나간다**(0611 에이치피오 87,014건과 같은 형태).
    //   그래서 ①`cancelling`으로 먼저 잡고 ②큐를 지운 뒤 ③`cancelled`로 확정한다.
    //   죽어서 남은 `cancelling`은 워커가 마무리한다(발송을 막는 쪽으로 민다).
    // ⛔ 잡을 때 **옛 상태를 함께 받아 둔다**(`RETURNING`은 갱신 뒤 값이라 그것만으로는 되돌릴 수 없다).
    //   워커가 잡고 있는 행(`lock_token`)은 건드리지 않는다.
    const claimed = await query(
      `WITH prev AS (
         SELECT id, status, revision FROM agency_send_requests
          WHERE id = $1::uuid AND company_id = $2::uuid
          FOR UPDATE
       )
       UPDATE agency_send_requests a
          SET status = 'cancelling', cancel_reason = $3, lock_at = NOW(),
              revision = a.revision + 1, updated_at = NOW()
         FROM prev
        WHERE a.id = prev.id
          AND prev.status NOT IN (${NOT_CANCELABLE_SQL})
          AND a.lock_token IS NULL
       RETURNING prev.status AS prev_status, prev.revision AS prev_revision, a.*`,
      [req.params.id, auth.companyId, String(req.body?.reason || '담당자 취소').slice(0, 200)],
    );

    if (claimed.rows.length === 0) {
      const nowRow = await query(
        `SELECT status FROM agency_send_requests WHERE id = $1::uuid AND company_id = $2::uuid`,
        [req.params.id, auth.companyId],
      );
      if (nowRow.rows.length === 0) return res.status(404).json({ success: false, error: '접수를 찾을 수 없습니다.' });
      if (nowRow.rows[0].status === 'cancelled') {
        return res.status(409).json({ success: false, error: '이미 취소된 접수입니다.', code: 'ALREADY_CANCELLED' });
      }
      if (nowRow.rows[0].status === 'cancelling') {
        return res.status(409).json({ success: false, error: '취소를 처리하고 있습니다. 잠시 후 화면을 새로 고쳐 주세요.', code: 'CANCEL_IN_PROGRESS' });
      }
      if (!canCancel(nowRow.rows[0].status)) {
        return res.status(400).json({ success: false, error: '검사가 진행 중이라 지금은 취소할 수 없습니다. 잠시 후 다시 시도해 주세요.' });
      }
      return res.status(409).json({
        success: false,
        code: 'STATE_CHANGED',
        error: '처리 중이라 취소하지 못했습니다. 화면을 새로 고치고 다시 시도해 주세요.',
      });
    }

    const claimedRow = claimed.rows[0];
    // ⛔ 근거는 **시도 키 하나다**. 원장의 `campaign_id`는 나중에 적히는 캐시라 비어 있어도 캠페인은 있을 수 있다.
    const campaignId = await findAttemptCampaignId(auth.companyId, claimedRow.dispatch_key);

    // 예약이 만들어진 뒤의 취소는 **큐 삭제까지 끝나야** 취소다.
    // ⛔ 자체 DELETE를 쓰지 않는다 — 취소의 실체(라인 집합·효과 검증·환불)는 기존 캠페인 취소 CT가 소유한다.
    if (campaignId) {
      let result: { success: boolean; error?: string; tooLate?: boolean };
      try {
        const { cancelCampaign } = await import('../utils/campaign-lifecycle');
        result = await cancelCampaign(campaignId, auth.companyId, {
          cancelledBy: auth.userId,
          cancelledByType: req.user?.userType,
        });
      } catch (cancelErr: any) {
        result = { success: false, error: String(cancelErr?.message || '취소 처리 중 오류가 발생했습니다.') };
      }
      if (!result.success) {
        // ⛔ **되돌리는 것은 "큐를 건드리기 전에 거절당한 것이 확실할 때"뿐이다**(★2026-08-23 Codex 4R high).
        //   발송 15분 전 거절(`tooLate`)이 그 경우다. 그 밖의 실패·예외는 큐를 이미 지웠는지 알 수 없으므로
        //   `cancelling`으로 남긴다 — 워커가 이어받아 끝까지 민다(화면은 "취소 중").
        //   여기서 되돌리면 취소 의도가 사라져 **예약이 그대로 나간다.**
        if (result.tooLate) {
          const reverted = await query(
            `UPDATE agency_send_requests
                SET status = $1, cancel_reason = NULL, revision = revision + 1, updated_at = NOW()
              WHERE id = $2::uuid AND company_id = $3::uuid AND status = 'cancelling' AND revision = $4`,
            [claimedRow.prev_status, req.params.id, auth.companyId, claimedRow.revision],
          );
          await logEvent(req.params.id, 'cancel_rejected', {
            campaignId, error: result.error, reverted: reverted.rowCount || 0,
          });
          return res.status(400).json({ success: false, error: result.error, tooLate: true });
        }
        await logEvent(req.params.id, 'cancel_queue_failed', { campaignId, error: result.error });
        // 화면에는 현재 상태(`cancelling` = "취소 중")를 그대로 준다. 워커가 마무리하면 상태가 따라온다.
        const pendingRow = await query(
          `SELECT * FROM agency_send_requests WHERE id = $1::uuid AND company_id = $2::uuid`,
          [req.params.id, auth.companyId],
        );
        return res.status(202).json({
          success: true,
          pending: true,
          code: 'CANCEL_IN_PROGRESS',
          request: toPublic(pendingRow.rows[0]),
        });
      }
    }

    // ⛔ 캠페인이 없고 **시도 키가 남아 있으면** 즉시 확정하지 않는다(★2026-08-23 Codex 5R critical).
    //   예약을 만들던 핸들러가 뒤늦게 캠페인을 완성할 수 있다. 그 창은 워커가 시간으로 닫는다.
    if (!campaignId && claimedRow.dispatch_key) {
      await logEvent(req.params.id, 'cancel_pending_dispatch', { dispatchKey: claimedRow.dispatch_key });
      const pendingRow = await query(
        `SELECT * FROM agency_send_requests WHERE id = $1::uuid AND company_id = $2::uuid`,
        [req.params.id, auth.companyId],
      );
      return res.status(202).json({
        success: true, pending: true, code: 'CANCEL_IN_PROGRESS', request: toPublic(pendingRow.rows[0]),
      });
    }

    // 큐가 없어졌음을 확인한 뒤에만 취소를 확정한다.
    const done = await query(
      `UPDATE agency_send_requests
          SET status = 'cancelled', cancelled_at = NOW(), lock_at = NULL,
              revision = revision + 1, updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'cancelling' AND revision = $3
        RETURNING *`,
      [req.params.id, auth.companyId, claimedRow.revision],
    );
    if (done.rows.length === 0) {
      // 워커가 먼저 마무리했거나 그 사이 상태가 또 바뀌었다. 큐는 이미 지웠으므로 발송 위험은 없다.
      await logEvent(req.params.id, 'cancel_finalized_elsewhere', { campaignId });
      const cur = await query(
        `SELECT * FROM agency_send_requests WHERE id = $1::uuid AND company_id = $2::uuid`,
        [req.params.id, auth.companyId],
      );
      return res.json({ success: true, request: toPublic(cur.rows[0]) });
    }

    await logEvent(req.params.id, 'cancelled', { queueCancelled: !!campaignId, campaignId, from: claimedRow.prev_status });
    return res.json({ success: true, request: toPublic(done.rows[0]) });
  } catch (err: any) {
    if (isMissingRelation(err)) return migrationPending(res);
    console.error('[agency-send] 취소 실패:', err);
    return res.status(500).json({ success: false, error: '취소하지 못했습니다.' });
  }
});

export default router;
