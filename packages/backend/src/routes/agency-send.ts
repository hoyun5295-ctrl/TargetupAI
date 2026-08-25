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
import multer from 'multer';
import { getRegisteredCallbackSet, isCallbackRegistered } from '../utils/callback-filter';
import { validateMmsPayload } from '../utils/mms-validator';
import {
  parseAgencyRequestForm, parseAgencyRecipientList, pickPhoneColumn, resolveCallbackPlan,
  type AgencyFormError, type CallbackPlan,
} from '../utils/agency-send-form';
import { normalizePhone } from '../utils/normalize-phone';
import {
  canCancel, isEditable, isSameKstDay, NOT_CANCELABLE_SQL, validateRequestedAt,
  type AgencySendStatus,
} from '../utils/agency-send-state';
import { buildSlotPlan, extractAgencyVars, resolveVarColumns } from '../utils/agency-send-vars';
import { suggestVarColumnsWithAi } from '../utils/ai-column-mapper';
import { findAttemptCampaignId } from '../utils/agency-send-campaign';
import { SEND_HOURS } from '../config/defaults';
import { approveAgencyRequestTx } from '../utils/agency-send-approve';

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
    /**
     * 발송 전에 검사가 **한 번 더 남았는가**(★2026-08-23(2)).
     * ⛔ 같은 날 판정을 화면에서 다시 계산하지 않는다 — 판정이 둘이 되면 화면과 워커가 갈린다.
     */
    finalTestRequired: !row.final_test_at,
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
// 접수 생성 코어 — 검증·트랜잭션·이력이 전부 여기 있다 (★2026-08-25(3) 추출)
//   입구 = ①화면 접수(POST /) ②요청서 원스텝(POST /one-step, 회신번호 열 방식이면 여러 번)
//   ③(예정) 이메일 접수 워커. 입구가 늘어도 검증은 이 한 곳이다.
// ════════════════════════════════════════════════════════════
type CreateCoreResult =
  | { ok: true; request: any }
  | { ok: false; status: number; error: string; code?: string };

async function createRequestCore(
  auth: { companyId: string; userId: string },
  input: any,
  /** 외부 트랜잭션(원스텝 다건 생성). 주어지면 BEGIN·COMMIT·이력은 호출부가 소유한다 */
  extClient?: any,
  /**
   * 사전 조회 컨텍스트(★Codex 적대 2R) — 외부 트랜잭션이 연결을 쥔 채 코어가 전역 풀을 다시 기다리면
   * 동시 요청이 풀을 서로 기다리다 말라붙는다. 원스텝은 트랜잭션을 열기 **전에** 같은 함수로 조회해
   * 여기로 넘긴다. 검증 규칙 자체는 그대로 코어가 집행한다.
   */
  pre?: { registeredSet?: Set<string>; window?: { startHour: number | null; endHour: number | null } },
): Promise<CreateCoreResult> {
  const {
    messageType = 'SMS', subject, content, isAd = false, callbackNumber,
    managerPhone, managerPhones, requestedAt, mmsImagePaths, fileName, phoneColumn, varMapping,
    recipients,
  } = input || {};

  // ── 문안
  const body = String(content || '').trim();
  if (!body) return { ok: false, status: 400, error: '보낼 문안을 입력해 주세요.' };
  if (body.length > MAX_CONTENT) return { ok: false, status: 400, error: `문안은 ${MAX_CONTENT}자까지 넣을 수 있습니다.` };

  // 문안 변수는 직접발송과 같은 주소록 슬롯 네 칸에 얹는다(치환 CT가 하나여야 하므로).
  // ⛔ 발송 직전에 조용히 잘리면 안 되므로 접수에서 막는다.
  const plan = buildSlotPlan(body);
  if (!plan.ok) return { ok: false, status: 400, error: plan.error || '문안 항목이 너무 많습니다.', code: 'TOO_MANY_VARS' };

  const type = String(messageType).toUpperCase();
  if (!['SMS', 'LMS', 'MMS'].includes(type)) {
    return { ok: false, status: 400, error: '보낼 수 있는 형식이 아닙니다.' };
  }
  if ((type === 'LMS' || type === 'MMS') && !String(subject || '').trim()) {
    return { ok: false, status: 400, error: '제목을 입력해 주세요.' };
  }
  const subjectVars = extractAgencyVars(String(subject || ''));
  if (subjectVars.length > 0) {
    return {
      ok: false, status: 400, code: 'SUBJECT_VARS',
      error: `제목에는 항목을 넣을 수 없습니다: ${subjectVars.map((v) => `%${v}%`).join(' ')}. 제목은 모든 수신자에게 같은 문장으로 나갑니다.`,
    };
  }
  // MMS는 이미지가 본체다. 0장이면 통신사가 파일 오류로 버린다(2026-04-21 9007 선례)
  const images = Array.isArray(mmsImagePaths) ? mmsImagePaths : [];
  const mmsCheck = validateMmsPayload(type, images);
  if (!mmsCheck.ok) return { ok: false, status: 400, error: mmsCheck.error || '이미지 구성을 확인해 주세요.', code: mmsCheck.code };

  // ── 발신번호(회사에 등록된 것만)
  const callback = normalizePhone(String(callbackNumber || ''));
  if (!callback) return { ok: false, status: 400, error: '보내는 번호를 골라 주세요.' };
  const callbackOk = pre?.registeredSet ? pre.registeredSet.has(callback) : await isCallbackRegistered(auth.companyId, callback, auth.userId);
  if (!callbackOk) {
    return { ok: false, status: 400, error: '등록되지 않은 보내는 번호입니다. 발신번호 등록을 먼저 해 주세요.' };
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
    return { ok: false, status: 400, error: '테스트 문자를 받을 담당자 휴대폰 번호를 넣어 주세요.' };
  }

  // ── 요청 시각(리드타임 + 회사 발송 허용 시간)
  const when = validateRequestedAt(requestedAt, new Date(), pre?.window ?? await loadSendWindow(auth.companyId, !!isAd));
  if (!when.valid) return { ok: false, status: 400, error: when.error || '보낼 시각을 확인해 주세요.' };

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
    return { ok: false, status: 400, error: '보낼 번호가 없습니다. 명단을 확인해 주세요.' };
  }

  // ⛔ 접수 행과 수신자는 **한 트랜잭션**이다. 나뉘면 수신자 0건짜리 접수가 남고,
  //   워커가 그것을 집어 "보낼 사람이 없는 발송"을 만든다.
  //   원스텝(extClient)은 **여러 접수가 한 트랜잭션**이다 — 부분 생성 자체가 없다(★Codex 적대 1R).
  const client = extClient || await pool.connect();
  const own = !extClient;
  let request: any;
  try {
    if (own) await client.query('BEGIN');
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
    if (own) await client.query('COMMIT');
  } catch (txErr) {
    if (own) await client.query('ROLLBACK').catch(() => {});
    throw txErr;
  } finally {
    if (own) client.release();
  }

  if (own) {
    await logEvent(request.id, 'received', { recipientCount: rows.length, messageType: type });
    console.log(`[agency-send] 접수 company=${auth.companyId} id=${request.id} ${type} ${rows.length}건`);
  }
  return { ok: true, request };
}

// ════════════════════════════════════════════════════════════
// POST /api/agency-send — 접수 (화면 입구 · 검증은 코어가 소유)
// ════════════════════════════════════════════════════════════
router.post('/', async (req: Request, res: Response) => {
  const auth = await requireAgencySend(req, res);
  if (!auth) return;
  try {
    const result = await createRequestCore(auth, req.body || {});
    if (!result.ok) {
      return res.status(result.status).json({ success: false, error: result.error, ...(result.code ? { code: result.code } : {}) });
    }
    return res.status(201).json({ success: true, request: toPublic(result.request) });
  } catch (err: any) {
    if (isMissingRelation(err)) return migrationPending(res);
    console.error('[agency-send] 접수 실패:', err);
    return res.status(500).json({ success: false, error: '접수하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

// ════════════════════════════════════════════════════════════
// 요청서 원스텝 접수 (★2026-08-25(3) · Harold "요청서 규격화 + 원스텝")
//   파일 2개(요청서 규격 + 명단 자유형)를 서버가 파싱·검증·집계한다.
//   브라우저에는 상위 50건 샘플과 집계만 내려간다(전 행 전송이 화면 접수가 느린 진짜 원인).
//   확정도 같은 파일을 다시 받아 같은 분석을 거친다(서버에 중간 상태를 두지 않는다 — 무상태).
//   ⛔ 회신번호 열 방식 = 회신번호별로 접수를 나눈다. 대행발송이 타는 적재 배관(주소록 슬롯 5칸)은
//     수신자별 회신번호를 나르지 못한다(agency-send-worker 적재부 주석 소유). 나뉜 각 건은
//     기존 파이프라인(검사·담당자 문자·승인)을 각각 그대로 탄다 — 확인 화면이 그 사실을 안내한다.
// ════════════════════════════════════════════════════════════
const oneStepMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 2 },
}).fields([{ name: 'form', maxCount: 1 }, { name: 'list', maxCount: 1 }]);

/** 자격을 **파일을 받기 전에** 확인한다(★Codex 적대 1R — 무자격 계정이 메모리부터 점유하면 안 된다) */
async function requireAgencySendMw(req: Request, res: Response, next: () => void): Promise<void> {
  const auth = await requireAgencySend(req, res);
  if (!auth) return;
  (req as any).agencyAuth = auth;
  next();
}

/** multer 오류는 핸들러 밖에서 터진다 — JSON 계약으로 바꿔 준다(HTML 스택이 화면에 뜨지 않게) */
function oneStepUpload(req: Request, res: Response, next: () => void): void {
  oneStepMulter(req as any, res as any, (err: any) => {
    if (err) {
      const tooBig = err?.code === 'LIMIT_FILE_SIZE';
      res.status(tooBig ? 413 : 400).json({
        success: false,
        code: tooBig ? 'FILE_TOO_LARGE' : 'UPLOAD_INVALID',
        error: tooBig ? '파일이 너무 큽니다. 한 파일 15MB까지 올릴 수 있습니다.' : '파일 업로드 형식이 올바르지 않습니다.',
      });
      return;
    }
    next();
  });
}

/** 회신번호 종류(=나뉘는 접수 수) 상한. 이 위는 사람이 승인할 수 있는 규모가 아니다 */
const MAX_CALLBACK_GROUPS = 20;

interface OneStepGroup { callback: string; count: number; registered: boolean; recipients: Array<{ phone: string; vars: Record<string, any> }> }

interface OneStepAnalysis {
  subject: string;
  content: string;
  isAd: boolean;
  requestedAtIso: string | null;
  managerPhones: string[];
  callback: CallbackPlan;
  headers: string[];
  phoneColumn: string | null;
  varsMatched: Array<{ name: string; column: string | null; via: 'same' | 'override' | 'ai' | null }>;
  counts: { total: number; valid: number; dup: number; invalid: number; callbackMissing: number };
  groups: OneStepGroup[];
  sample: Array<{ phone: string; callback?: string }>;
  messageType: 'SMS' | 'LMS' | 'MMS';
  fileName: string | null;
  errors: AgencyFormError[];
}

/** 확인 화면에서 바꿀 수 있는 것: 시각 · 회신번호 선택 · 담당자 · 이미지 · 문안 항목의 열. 문안·제목은 요청서가 진실이다 */
function parseOneStepOverrides(raw: any): {
  requestedAt?: string; callback?: { mode: string; number?: string; column?: string };
  managerPhones?: string[]; mmsImagePaths?: string[]; phoneColumn?: string;
  varMapping?: Record<string, string>;
} {
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    if (!o || typeof o !== 'object') return {};
    // 문안 항목 매핑은 문자열 값만 남긴다(객체·배열이 끼면 열 이름 비교가 조용히 어긋난다)
    if (o.varMapping && typeof o.varMapping === 'object' && !Array.isArray(o.varMapping)) {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(o.varMapping)) {
        if (typeof v === 'string') clean[k] = v;
      }
      o.varMapping = clean;
    } else if (o.varMapping !== undefined) {
      delete o.varMapping;
    }
    return o;
  } catch {
    return {};
  }
}

async function analyzeOneStep(
  auth: { companyId: string; userId: string },
  formBuf: Buffer | null, listBuf: Buffer | null, listName: string | null,
  overrides: ReturnType<typeof parseOneStepOverrides>,
  /** AI 항목 추천 허용 여부. **미리보기만 true** — 확정 경로에 AI 비결정성이 들어오면 안 된다(★Codex 1R) */
  aiSuggest: boolean,
): Promise<OneStepAnalysis> {
  const errors: AgencyFormError[] = [];
  const empty: OneStepAnalysis = {
    subject: '', content: '', isAd: true, requestedAtIso: null, managerPhones: [],
    callback: { mode: 'none' }, headers: [], phoneColumn: null, varsMatched: [],
    counts: { total: 0, valid: 0, dup: 0, invalid: 0, callbackMissing: 0 },
    groups: [], sample: [], messageType: 'SMS', fileName: listName, errors,
  };
  if (!formBuf) { errors.push({ field: '요청서', error: '요청서 파일을 올려 주세요.' }); }
  if (!listBuf) { errors.push({ field: '명단', error: '고객 명단 파일을 올려 주세요.' }); }
  if (!formBuf || !listBuf) return empty;

  const form = parseAgencyRequestForm(formBuf);
  errors.push(...form.errors);

  let headers: string[] = [];
  let rows: Record<string, any>[] = [];
  try {
    const list = parseAgencyRecipientList(listBuf);
    headers = list.headers;
    rows = list.rows;
    // ⛔ 같은 이름의 열·상한 초과는 조용히 못 넘어간다(★Codex 적대 1R — 열이 밀리거나 잘리면 다른 사람에게 간다)
    for (const d of list.duplicates) errors.push({ field: '명단', error: `명단에 "${d}" 열이 두 개 있습니다. 하나만 남겨 주세요.` });
    if (list.truncated) errors.push({ field: '명단', error: `명단이 너무 큽니다. 한 번에 ${MAX_RECIPIENTS.toLocaleString()}명까지 접수할 수 있으니 나눠 주세요.` });
    if (list.columnsOverflow) errors.push({ field: '명단', error: '명단의 열이 100개를 넘습니다. 발송에 쓸 열만 남겨 주세요.' });
  } catch {
    errors.push({ field: '명단', error: '명단 파일을 읽지 못했습니다. 엑셀 또는 CSV인지 확인해 주세요.' });
  }
  if (headers.length > 0 && rows.length === 0) errors.push({ field: '명단', error: '명단에 데이터 행이 없습니다.' });

  // 수신자 열: 확인 화면에서 직접 고를 수 있다(값 비율 자동 선정이 애매한 파일 대비).
  // ⛔ 지정했는데 명단에 없으면 자동 선정으로 **폴백하지 않는다**(★2R — 사용자가 본 것과 다른 열 금지)
  let phoneColumn: string | null = null;
  if (overrides.phoneColumn !== undefined) {
    if (headers.includes(String(overrides.phoneColumn))) phoneColumn = String(overrides.phoneColumn);
    else errors.push({ field: '명단', error: '고르신 수신자 열이 명단에 없습니다. 다시 골라 주세요.' });
  } else {
    phoneColumn = pickPhoneColumn(headers, rows);
    if (rows.length > 0 && !phoneColumn) {
      errors.push({ field: '명단', error: '휴대폰 번호 열을 찾지 못했습니다. 확인 화면에서 수신자 열을 직접 골라 주세요.' });
    }
  }

  // 확인 화면 조정값 반영(시각·회신번호·담당자).
  // ⛔ 값이 "있으면" 그것이 전부다 — 빈 문자열·빈 배열도 의도다(★Codex 적대 1R: 화면에서 지웠는데
  //   요청서 원값으로 조용히 복귀하면, 보이는 것과 다른 값으로 접수된다). fail-closed = 반려.
  const hasRequestedAtOverride = Object.prototype.hasOwnProperty.call(overrides, 'requestedAt');
  const requestedAt = hasRequestedAtOverride
    ? (overrides.requestedAt ? new Date(overrides.requestedAt) : null)
    : form.requestedAt;
  const requestedAtIso = requestedAt && !Number.isNaN(requestedAt.getTime()) ? requestedAt.toISOString() : null;
  if (hasRequestedAtOverride && !requestedAtIso) errors.push({ field: '보낼 시각', error: '보낼 시각을 정해 주세요.' });
  const hasManagerOverride = Array.isArray(overrides.managerPhones);
  const managerPhones = (hasManagerOverride ? overrides.managerPhones! : form.managerPhones)
    .map((p) => normalizePhone(String(p || ''))).filter((p) => p.length >= 10).slice(0, MAX_MANAGER_PHONES);
  if (managerPhones.length === 0 && !form.errors.find((e) => e.field === '담당자 번호')) {
    errors.push({ field: '담당자 번호', error: '테스트 문자를 받을 담당자 번호가 없습니다.' });
  }

  // ⛔ 회신번호 조정값도 유효하지 않으면 요청서 값으로 **폴백하지 않는다**(★2R)
  let callback: CallbackPlan;
  if (overrides.callback !== undefined) {
    if (overrides.callback?.mode === 'fixed' && overrides.callback.number) {
      callback = { mode: 'fixed', number: normalizePhone(String(overrides.callback.number)) };
    } else if (overrides.callback?.mode === 'column' && overrides.callback.column && headers.includes(overrides.callback.column)) {
      callback = { mode: 'column', column: overrides.callback.column };
    } else {
      callback = { mode: 'none' };
      errors.push({ field: '회신번호', error: '고르신 회신번호가 올바르지 않습니다. 다시 골라 주세요.' });
    }
  } else {
    callback = resolveCallbackPlan(form.callbackRaw, headers);
  }
  if (callback.mode === 'none' && form.callbackRaw) {
    errors.push({ field: '회신번호', error: `회신번호 칸의 "${form.callbackRaw}"를 번호로도 명단의 열 이름으로도 읽지 못했습니다.` });
  }

  // 문안 항목 ↔ 명단 열: 확인 화면 조정값 > 같은 이름(화면 접수와 같은 규칙 · CT 소유)
  const usedVars = extractAgencyVars(form.content);
  const varResolution = resolveVarColumns(usedVars, headers, overrides.varMapping);
  let varsMatched: OneStepAnalysis['varsMatched'] = varResolution.resolved;
  // 이름이 다른 항목은 **미리보기 초회 분석에서만** AI가 열을 추천해 미리 골라 둔다(★2026-08-25 §17-6).
  //   추천은 확정이 아니다 — 화면이 이 매핑을 조정값으로 다시 보내야 접수된다. 확정 경로는
  //   aiSuggest=false로 이 분기 자체가 닫혀 있다(옛 번들이 varMapping 없이 확정해도 재추론 불가).
  //   실패하면 추천 없이 진행한다(항목 반려가 남고 사용자가 직접 고른다 · 조용한 성공 위장 금지).
  if (aiSuggest && overrides.varMapping === undefined && rows.length > 0) {
    const unmatched = varsMatched.filter((v) => !v.column).map((v) => v.name);
    if (unmatched.length > 0) {
      try {
        const suggestions = await suggestVarColumnsWithAi({
          companyId: auth.companyId,
          vars: unmatched,
          columnNames: headers,
          sampleRows: rows.slice(0, 5).map((r) => headers.map((h) => r[h] ?? null)),
        });
        varsMatched = varsMatched.map((v) => {
          if (v.column) return v;
          const s = suggestions.find((x) => x.name === v.name);
          return s?.column ? { ...v, column: s.column, via: 'ai' as const } : v;
        });
      } catch (aiErr: any) {
        console.warn('[agency-send] 원스텝 문안 항목 AI 추천 실패(직접 선택으로 진행):', aiErr?.message || aiErr);
      }
    }
  }
  for (const vm of varsMatched) {
    // 조정값이 틀린 항목은 아래에서 그 사유로만 알린다(한 항목에 반려 두 줄 금지)
    if (!vm.column && !varResolution.badOverrides.includes(vm.name)) {
      errors.push({ field: '문안 항목', error: `문안의 %${vm.name}%에 맞는 열을 명단에서 찾지 못했습니다. 문안 항목 칸에서 골라 주세요.` });
    }
  }
  for (const name of varResolution.badOverrides) {
    errors.push({ field: '문안 항목', error: `%${name}%에 고르신 열이 명단에 없습니다. 다시 골라 주세요.` });
  }
  const varMappingColumns = varsMatched.filter((v) => v.column);

  // 수신자 정리 + 집계(서버가 다 세고, 화면에는 숫자와 상위 50만 보낸다)
  const seen = new Set<string>();
  let dup = 0; let invalid = 0; let callbackMissing = 0;
  const groupMap = new Map<string, Array<{ phone: string; vars: Record<string, any> }>>();
  let groupsOverflow = false;
  const sample: Array<{ phone: string; callback?: string }> = [];
  const ONLY_DIGITS = (s: any) => String(s ?? '').replace(/[^0-9]/g, '');
  if (phoneColumn) {
    for (const r of rows) {
      const phone = normalizePhone(ONLY_DIGITS(r[phoneColumn]));
      if (!phone || phone.length < 10) { invalid++; continue; }
      if (seen.has(phone)) { dup++; continue; }
      let groupKey = callback.mode === 'fixed' ? callback.number : '';
      if (callback.mode === 'column') {
        const cb = normalizePhone(ONLY_DIGITS(r[callback.column]));
        if (!cb || cb.length < 8) { callbackMissing++; continue; }
        groupKey = cb;
        // ⛔ 21종째가 나타나는 즉시 멈춘다(★2R) — 잘못 매핑된 열 하나가 수만 그룹을 만들며
        //   자원(그룹 축적·등록 조회)을 태우는 것을 그룹 생성 단계에서 끊는다
        if (!groupMap.has(groupKey) && groupMap.size >= MAX_CALLBACK_GROUPS + 1) { groupsOverflow = true; continue; }
      }
      seen.add(phone);
      const vars: Record<string, any> = {};
      for (const vm of varMappingColumns) {
        if (r[vm.column!] !== undefined && r[vm.column!] !== null) vars[vm.name] = r[vm.column!];
      }
      if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
      groupMap.get(groupKey)!.push({ phone, vars });
      if (sample.length < 50) sample.push({ phone, ...(callback.mode === 'column' ? { callback: groupKey } : {}) });
    }
  }
  const valid = [...groupMap.values()].reduce((a, g) => a + g.length, 0);
  if (rows.length > 0 && valid === 0 && errors.length === 0) {
    errors.push({ field: '명단', error: '보낼 수 있는 번호가 없습니다.' });
  }

  // 회신번호 그룹(열 방식이면 접수가 이 수만큼 나뉜다) + 등록 여부.
  //   등록 검증은 **집합 1회 조회**로 한다(★2R — 그룹마다 조회하면 열 오지정 한 번에 수만 조회가 된다)
  const groups: OneStepGroup[] = [];
  const overLimit = groupsOverflow || groupMap.size > MAX_CALLBACK_GROUPS;
  const registeredSet = overLimit ? new Set<string>() : await getRegisteredCallbackSet(auth.companyId, auth.userId);
  for (const [cb, recipients] of groupMap) {
    if (!cb) continue;
    groups.push({ callback: cb, count: recipients.length, registered: overLimit ? false : registeredSet.has(cb), recipients });
    if (recipients.length > MAX_RECIPIENTS) {
      errors.push({ field: '명단', error: `회신번호 ${cb} 건이 ${recipients.length.toLocaleString()}명입니다. 한 접수는 ${MAX_RECIPIENTS.toLocaleString()}명까지라 명단을 나눠 주세요.` });
    }
  }
  groups.sort((a, b) => b.count - a.count);
  if (overLimit) {
    errors.push({ field: '회신번호', error: `회신번호가 ${MAX_CALLBACK_GROUPS}종을 넘습니다. 접수가 그만큼 나뉘어 승인이 어렵습니다. 회신번호 열이 맞는지 확인하시고, 맞다면 ${MAX_CALLBACK_GROUPS}종 이하로 나눠 주세요.` });
  }
  const unregistered = overLimit ? [] : groups.filter((g) => !g.registered);
  if (unregistered.length > 0) {
    errors.push({
      field: '회신번호',
      error: `등록되지 않은 회신번호가 있습니다: ${unregistered.map((g) => g.callback).join(', ')}. 발신번호 등록을 먼저 해 주세요.`,
    });
  }
  if (callback.mode === 'fixed' && groups.length === 0 && valid > 0) {
    // fixed인데 그룹이 안 만들어진 경우는 없다(키 = 번호). 방어적 분기일 뿐이다.
    errors.push({ field: '회신번호', error: '회신번호를 확인해 주세요.' });
  }

  // 발송 시각(리드타임 + 발송 허용 시간) 사전 검증 — 확정에서 또 검증되지만 확인 화면에서 먼저 알린다
  if (requestedAtIso) {
    const when = validateRequestedAt(requestedAtIso, new Date(), await loadSendWindow(auth.companyId, form.isAd));
    if (!when.valid) errors.push({ field: '보낼 시각', error: when.error || '보낼 시각을 확인해 주세요.' });
  }

  const images = Array.isArray(overrides.mmsImagePaths) ? overrides.mmsImagePaths : [];
  const messageType: 'SMS' | 'LMS' | 'MMS' = images.length > 0
    ? 'MMS' : (form.content.length > 45 || form.subject.trim() ? 'LMS' : 'SMS');

  return {
    subject: form.subject, content: form.content, isAd: form.isAd, requestedAtIso,
    managerPhones, callback, headers, phoneColumn, varsMatched,
    counts: { total: rows.length, valid, dup, invalid, callbackMissing },
    groups, sample, messageType, fileName: listName, errors,
  };
}

function oneStepFiles(req: Request): { formBuf: Buffer | null; listBuf: Buffer | null; listName: string | null } {
  const files = (req as any).files || {};
  const formBuf = files.form?.[0]?.buffer || null;
  const listBuf = files.list?.[0]?.buffer || null;
  // multer는 latin1로 줄 때가 있어 원래 한글 파일명으로 되돌린다(업로드 라우트와 같은 관행)
  const rawName = files.list?.[0]?.originalname || null;
  let listName: string | null = null;
  if (rawName) {
    try { listName = Buffer.from(rawName, 'latin1').toString('utf8'); } catch { listName = rawName; }
  }
  return { formBuf, listBuf, listName };
}

/** 화면에 내려보낼 분석 결과(수신자 전 행은 절대 안 내려간다) */
function toAnalysisView(a: OneStepAnalysis) {
  return {
    subject: a.subject, content: a.content, isAd: a.isAd, requestedAt: a.requestedAtIso,
    managerPhones: a.managerPhones, callback: a.callback, headers: a.headers, phoneColumn: a.phoneColumn,
    varsMatched: a.varsMatched, counts: a.counts,
    groups: a.groups.map((g) => ({ callback: g.callback, count: g.count, registered: g.registered })),
    sample: a.sample, messageType: a.messageType, fileName: a.fileName, errors: a.errors,
  };
}

// 미리보기 — 파싱·검증·집계 결과만 돌려준다(접수 없음)
router.post('/one-step/preview', requireAgencySendMw, oneStepUpload, async (req: Request, res: Response) => {
  const auth = (req as any).agencyAuth as { companyId: string; userId: string };
  try {
    const { formBuf, listBuf, listName } = oneStepFiles(req);
    const analysis = await analyzeOneStep(auth, formBuf, listBuf, listName, parseOneStepOverrides(req.body?.overrides), true);
    return res.json({ success: true, analysis: toAnalysisView(analysis) });
  } catch (err: any) {
    if (isMissingRelation(err)) return migrationPending(res);
    console.error('[agency-send] 원스텝 미리보기 실패:', err);
    return res.status(500).json({ success: false, error: '파일을 분석하지 못했습니다. 양식 그대로인지 확인해 주세요.' });
  }
});

// 확정 — 같은 파일을 다시 받아 같은 분석을 거치고, 회신번호 그룹마다 접수를 만든다
router.post('/one-step', requireAgencySendMw, oneStepUpload, async (req: Request, res: Response) => {
  const auth = (req as any).agencyAuth as { companyId: string; userId: string };
  try {
    const { formBuf, listBuf, listName } = oneStepFiles(req);
    const overrides = parseOneStepOverrides(req.body?.overrides);
    // ⛔ 확정은 확인 화면 스냅샷 **전체**가 필수다(★2R strict) — 빠진 필드가 요청서 원값으로
    //   조용히 복귀하면 사용자가 본 것과 다른 값으로 접수된다. 폼 폴백은 미리보기 초회에만 허용한다.
    const strictMissing: string[] = [];
    if (!Object.prototype.hasOwnProperty.call(overrides, 'requestedAt')) strictMissing.push('보낼 시각');
    if (!Array.isArray(overrides.managerPhones)) strictMissing.push('담당자 번호');
    if (!overrides.callback || !['fixed', 'column'].includes(String(overrides.callback.mode))) strictMissing.push('회신번호');
    if (!overrides.phoneColumn) strictMissing.push('수신자 열');
    if (!Array.isArray(overrides.mmsImagePaths)) strictMissing.push('이미지 목록');
    if (strictMissing.length > 0) {
      return res.status(400).json({
        success: false, code: 'CONFIRM_REQUIRED',
        error: `확인 화면을 거쳐 접수해 주세요. 빠진 항목: ${strictMissing.join(', ')}`,
      });
    }
    // ⛔ 확정은 AI 추천 없이 분석한다(aiSuggest=false) — varMapping이 빠져도 재추론이 아니라
    //   같은 이름 규칙만 돈다. 문안에 항목이 있는데 varMapping이 없으면 확인 화면이 옛 버전이다
    //   (★Codex 1R: 항목 0개인 옛 번들 접수까지 막지 않되, 항목이 있으면 새 화면을 거치게 한다).
    const analysis = await analyzeOneStep(auth, formBuf, listBuf, listName, overrides, false);
    if (analysis.varsMatched.length > 0 && overrides.varMapping === undefined) {
      return res.status(400).json({
        success: false, code: 'CONFIRM_REQUIRED',
        error: '접수 화면이 예전 버전입니다. 화면을 새로고침(Ctrl+F5)한 뒤 확인 화면을 다시 거쳐 접수해 주세요.',
      });
    }
    if (analysis.errors.length > 0) {
      return res.status(400).json({ success: false, error: analysis.errors[0].error, errors: analysis.errors, code: 'FORM_INVALID' });
    }

    // ⛔ 전 그룹을 **한 트랜잭션**으로 만든다(★Codex 적대 1R high) — 중간 실패 시 전부 되돌아가
    //   "일부만 접수된 상태"가 아예 생기지 않는다. 재시도해도 중복이 없다(전부 취소됐으니까).
    //   남는 잔여 위험 = 성공 응답이 유실된 뒤 통째로 다시 제출하는 경우이며, 이는 화면 접수의
    //   재클릭과 같은 부류다(§17에 수용 위험으로 기록).
    const created: any[] = [];
    // 트랜잭션을 열기 **전에** 검증 재료를 같은 함수로 조회해 둔다(★2R — 연결을 쥔 채 풀을 다시 기다리지 않는다)
    const pre = {
      registeredSet: await getRegisteredCallbackSet(auth.companyId, auth.userId),
      window: await loadSendWindow(auth.companyId, analysis.isAd),
    };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const group of analysis.groups) {
        const result = await createRequestCore(auth, {
          messageType: analysis.messageType,
          subject: analysis.subject || undefined,
          content: analysis.content,
          isAd: analysis.isAd,
          callbackNumber: group.callback,
          managerPhones: analysis.managerPhones,
          requestedAt: analysis.requestedAtIso,
          mmsImagePaths: Array.isArray(overrides.mmsImagePaths) ? overrides.mmsImagePaths : [],
          fileName: analysis.fileName,
          phoneColumn: analysis.phoneColumn || '전화번호',
          varMapping: Object.fromEntries(analysis.varsMatched.filter((v) => v.column).map((v) => [v.name, v.column!])),
          recipients: group.recipients,
        }, client, pre);
        if (!result.ok) {
          await client.query('ROLLBACK');
          return res.status(result.status).json({
            success: false,
            error: analysis.groups.length > 1 ? `회신번호 ${group.callback} 건: ${result.error} (아무것도 접수되지 않았습니다)` : result.error,
            ...(result.code ? { code: result.code } : {}),
          });
        }
        created.push(result.request);
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
    // 이력은 커밋 뒤에 적는다(커밋 전 별도 연결로 적으면 아직 없는 행을 가리킨다)
    for (const r of created) {
      await logEvent(r.id, 'received', { recipientCount: r.recipient_count, messageType: r.message_type, via: 'one-step' });
    }
    console.log(`[agency-send] 원스텝 접수 company=${auth.companyId} ${created.length}건(회신번호 ${analysis.groups.length}종)`);
    return res.status(201).json({ success: true, requests: created.map(toPublic) });
  } catch (err: any) {
    if (isMissingRelation(err)) return migrationPending(res);
    console.error('[agency-send] 원스텝 접수 실패:', err);
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
// GET /api/agency-send/:id/recipients — 재접수용 수신자 목록 (★2026-08-25 · 읽기 전용)
//   "같은 내용으로 다시 접수"가 이 목록을 받아 **기존 접수 API(POST /)를 그대로** 다시 탄다.
//   ⛔ 서버 쪽 복제(clone) 쓰기 경로를 만들지 않는다 — 검증·트랜잭션·적재 대조가 전부 접수 한 곳에 있어야 한다.
// ════════════════════════════════════════════════════════════
router.get('/:id/recipients', async (req: Request, res: Response) => {
  const auth = await requireAgencySend(req, res);
  if (!auth) return;
  try {
    const own = await query(
      `SELECT id FROM agency_send_requests WHERE id = $1::uuid AND company_id = $2::uuid`,
      [req.params.id, auth.companyId],
    );
    if (own.rows.length === 0) return res.status(404).json({ success: false, error: '접수를 찾을 수 없습니다.' });
    const r = await query(
      `SELECT phone, vars FROM agency_send_recipients WHERE request_id = $1::uuid ORDER BY row_no`,
      [req.params.id],
    );
    return res.json({ success: true, recipients: r.rows });
  } catch (err: any) {
    if (isMissingRelation(err)) return migrationPending(res);
    console.error('[agency-send] 수신자 조회 실패:', err);
    return res.status(500).json({ success: false, error: '수신자 목록을 불러오지 못했습니다.' });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/agency-send/:id/approve — 승인(발송을 결정하는 유일한 손)
// ════════════════════════════════════════════════════════════
router.post('/:id/approve', async (req: Request, res: Response) => {
  const auth = await requireAgencySend(req, res);
  if (!auth) return;
  try {
    // ⛔ 승인의 기준은 **행 수정 번호**다(★2026-08-23 Codex 2R high). 문안 버전만 보면
    //   시각만 바뀐 건은 상태도 버전도 그대로라, 담당자가 **못 본 시각**으로 옛 승인이 통과한다.
    // ★2026-08-25 판정·전이·이력·워커 기동은 승인 효과 CT 하나가 소유한다(utils/agency-send-approve.ts).
    //   입구가 둘이어도(이 로그인 경로 · 담당자 링크 경로) 같은 함수를 지난다.
    const outcome = await approveAgencyRequestTx({
      requestId: req.params.id,
      revision: Number(req.body?.revision),
      companyId: auth.companyId,
      approvedBy: auth.userId,
      via: 'screen',
    });
    if (!outcome.ok) {
      return res.status(outcome.status).json({ success: false, error: outcome.error, ...(outcome.code ? { code: outcome.code } : {}) });
    }
    return res.json({ success: true, request: toPublic(outcome.row) });
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
      `SELECT status, revision, is_ad, campaign_id, final_test_at
         FROM agency_send_requests WHERE id = $1::uuid AND company_id = $2::uuid`,
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
    // ⛔ `dispatch_key`·`campaign_id`를 지운다 — 새 시각은 새 시도다. 그대로 두면 실패한 앞 시도의
    //   캠페인을 계속 찾아 같은 자리에서 다시 닫힌다(★2026-08-23 Codex 적대 검토 high).
    // ⛔ 관찰한 상태를 조건에 넣는다(문안 수정과 같은 이유).
    const backTo: AgencySendStatus = r.rows[0].status === 'test_failed' ? 'received' : 'awaiting_approval';

    // `final_test_at` = 이 문안이 **발송일 당일 검사를 통과한** 시각. 시각이 바뀌면 발송일이 바뀔 수 있어
    // 원칙은 지우는 것이다(불변 2). 다만 **새 시각이 그 검사와 같은 날이면 그 검사가 여전히 당일 검사**라
    // 남긴다(★2026-08-23(2) Harold 지시 — 같은 날 두 번 검사하지 않는다).
    // ⛔ `received`로 돌아가는 건(문안을 다시 검사한다)은 조건 없이 지운다. 남기면 검사 없이 나간다.
    const priorFinalTest = r.rows[0].final_test_at ? new Date(r.rows[0].final_test_at) : null;
    const keepFinalTest = backTo === 'awaiting_approval'
      && !!priorFinalTest
      && !!when.at
      && isSameKstDay(priorFinalTest, when.at);

    const updated = await query(
      `UPDATE agency_send_requests
          SET requested_at = $1, status = $2, expired_at = NULL,
              approved_at = NULL, approved_by = NULL, approval_version = NULL,
              final_test_at = $6,
              dispatch_key = NULL, campaign_id = NULL, lock_at = NULL, lock_token = NULL,
              revision = revision + 1, updated_at = NOW()
        WHERE id = $3::uuid AND company_id = $4::uuid AND revision = $5
        RETURNING *`,
      [when.at, backTo, req.params.id, auth.companyId, observedRevision, keepFinalTest ? priorFinalTest : null],
    );
    if (updated.rows.length === 0) {
      return res.status(409).json({
        success: false,
        code: 'STATE_CHANGED',
        error: '그 사이 상태가 바뀌었습니다. 화면을 새로 고치고 다시 시도해 주세요.',
      });
    }

    await logEvent(req.params.id, 'rescheduled', {
      requestedAt: when.at?.toISOString(), status: backTo, keepFinalTest,
    });
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
