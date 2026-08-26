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
import { getRegisteredCallbackSet } from '../utils/callback-filter';
import {
  isEditable, isSameKstDay, validateRequestedAt,
  type AgencySendStatus,
} from '../utils/agency-send-state';
import { buildSlotPlan, extractAgencyVars } from '../utils/agency-send-vars';
import { approveAgencyRequestTx } from '../utils/agency-send-approve';
import { cancelAgencyRequestTx } from '../utils/agency-send-cancel';
// ★2026-08-26 §18 승격 — 접수 코어·원스텝 분석은 CT(utils/agency-send-intake.ts)가 소유한다.
//   입구 = 화면 접수 · 원스텝 · 이메일 접수 워커. 이 파일에 코어를 다시 정의하지 마라(두 벌 금지).
import {
  analyzeOneStep, createRequestCore, loadSendWindow, logEvent, parseOneStepOverrides,
  MAX_CONTENT, type OneStepAnalysis,
} from '../utils/agency-send-intake';

const router = Router();
router.use(authenticate);

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
async function requireAgencySend(req: Request, res: Response): Promise<{ companyId: string; userId: string; seesAll: boolean } | null> {
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
  // ★2026-08-26(2) 사용자 격리(서수란 접수 · Harold 확정) — 관리자는 회사 전체, 일반 사용자는 본인 접수만.
  //   제품 공통 패턴(자동발송 D151-3 · 주소록 · AI 오퍼레이터)과 같은 축이다.
  //   ⛔ 판정은 JWT 어휘(company_admin)로만 한다 — DB users.user_type(admin/user)과 어휘가 달라
  //   혼용하면 제한 사용자가 승격된다(SCHEMA.md users 절 · 자동마케팅 발송 범위 사고 기원).
  const seesAll = req.user?.userType === 'company_admin' || req.user?.userType === 'super_admin';
  return { companyId, userId, seesAll };
}

/**
 * 소유자 술어 파라미터 — 관리자는 null(전체), 일반 사용자는 본인 id.
 * 쓰는 자리 전부가 `AND ($n::uuid IS NULL OR created_by = $n::uuid)` 한 모양이다(경로마다 다른 판정 금지).
 */
const ownerParam = (auth: { userId: string; seesAll: boolean }): string | null => (auth.seesAll ? null : auth.userId);

/** 목록·상세 응답에서 내부 필드를 떼어낸다 */
function toPublic(row: any) {
  return {
    id: row.id,
    status: row.status as AgencySendStatus,
    // ★2026-08-26 §18 접수 출처('screen'|'one_step'|'email'). DDL 전 행은 컬럼이 없어 'screen'으로 읽힌다.
    //   표시 라벨은 프론트 SOURCE_LABEL 단일표가 소유한다(fileName 유무 추정 폐지).
    source: row.source || 'screen',
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
    // ★2026-08-26(2) 접수 계정 — 관리자 조회(users JOIN이 실린 SELECT)에만 값이 있다.
    //   일반 사용자 응답에는 키 자체가 없다(본인 것만 보이므로 표시할 이유가 없다).
    ...(row.created_by_name !== undefined ? { createdByName: row.created_by_name || row.created_by_login || null } : {}),
  };
}

// ════════════════════════════════════════════════════════════
// GET /api/agency-send — 접수 목록
// ════════════════════════════════════════════════════════════
router.get('/', async (req: Request, res: Response) => {
  const auth = await requireAgencySend(req, res);
  if (!auth) return;
  try {
    // 관리자 = 회사 전체(접수 계정 이름 동봉) · 일반 사용자 = 본인 접수만(★2026-08-26(2) 격리)
    const r = auth.seesAll
      ? await query(
          `SELECT a.*, u.name AS created_by_name, u.login_id AS created_by_login
             FROM agency_send_requests a
             LEFT JOIN users u ON u.id = a.created_by
            WHERE a.company_id = $1::uuid
            ORDER BY a.created_at DESC LIMIT 100`,
          [auth.companyId],
        )
      : await query(
          `SELECT * FROM agency_send_requests
            WHERE company_id = $1::uuid AND created_by = $2::uuid
            ORDER BY created_at DESC LIMIT 100`,
          [auth.companyId, auth.userId],
        );
    return res.json({ success: true, requests: r.rows.map(toPublic) });
  } catch (err: any) {
    if (isMissingRelation(err)) return migrationPending(res);
    console.error('[agency-send] 목록 조회 실패:', err);
    return res.status(500).json({ success: false, error: '목록을 불러오지 못했습니다.' });
  }
});

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
//   ★2026-08-26(2) 통일 양식 = 파일 하나(내용 + 고객리스트 시트)를 서버가 파싱·검증·집계한다.
//   명단 파일을 따로 올리는 옛 방식도 API 계약으로는 계속 받는다(list 필드 = 선택).
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


function oneStepFiles(req: Request): { formBuf: Buffer | null; listBuf: Buffer | null; listName: string | null } {
  const files = (req as any).files || {};
  const formBuf = files.form?.[0]?.buffer || null;
  const listBuf = files.list?.[0]?.buffer || null;
  // multer는 latin1로 줄 때가 있어 원래 한글 파일명으로 되돌린다(업로드 라우트와 같은 관행)
  // ★2026-08-26(2) 통일 양식(한 파일)이면 명단 파일이 없다 — 목록에 보일 파일명은 요청서 파일명이다
  const rawName = files.list?.[0]?.originalname || files.form?.[0]?.originalname || null;
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
    sample: a.sample, sampleRows: a.sampleRows, messageType: a.messageType, fileName: a.fileName, errors: a.errors,
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
          source: 'one_step',
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
      `SELECT a.*, u.name AS created_by_name, u.login_id AS created_by_login
         FROM agency_send_requests a
         LEFT JOIN users u ON u.id = a.created_by
        WHERE a.id = $1::uuid AND a.company_id = $2::uuid AND ($3::uuid IS NULL OR a.created_by = $3::uuid)`,
      [req.params.id, auth.companyId, ownerParam(auth)],
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: '접수를 찾을 수 없습니다.' });
    if (!auth.seesAll) { delete r.rows[0].created_by_name; delete r.rows[0].created_by_login; }

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
      `SELECT id FROM agency_send_requests
        WHERE id = $1::uuid AND company_id = $2::uuid AND ($3::uuid IS NULL OR created_by = $3::uuid)`,
      [req.params.id, auth.companyId, ownerParam(auth)],
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
    // ★2026-08-26(2) 격리 — 일반 사용자는 본인 접수만 승인할 수 있다. 승인 CT는 담당자 링크(무인증
    //   토큰) 경로와 공유라 계정 축을 모른다. 소유자는 바뀌지 않는 값이라 사전 확인으로 충분하다.
    if (!auth.seesAll) {
      const own = await query(
        `SELECT 1 FROM agency_send_requests WHERE id = $1::uuid AND company_id = $2::uuid AND created_by = $3::uuid`,
        [req.params.id, auth.companyId, auth.userId],
      );
      if (own.rows.length === 0) return res.status(404).json({ success: false, error: '접수를 찾을 수 없습니다.' });
    }
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
      `SELECT status, var_mapping, revision, campaign_id FROM agency_send_requests
        WHERE id = $1::uuid AND company_id = $2::uuid AND ($3::uuid IS NULL OR created_by = $3::uuid)`,
      [req.params.id, auth.companyId, ownerParam(auth)],
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
         FROM agency_send_requests
        WHERE id = $1::uuid AND company_id = $2::uuid AND ($3::uuid IS NULL OR created_by = $3::uuid)`,
      [req.params.id, auth.companyId, ownerParam(auth)],
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
    // ★2026-08-26(3) 취소 효과는 CT 하나가 소유한다(utils/agency-send-cancel.ts) — 입구가 둘이어도
    //   (이 로그인 경로 · 슈퍼관리자 운영 취소) 같은 함수를 지난다(승인 CT와 같은 패턴).
    const result = await cancelAgencyRequestTx({
      requestId: req.params.id,
      companyId: auth.companyId,
      reason: String(req.body?.reason || '담당자 취소'),
      ownerUserId: ownerParam(auth),
      cancelledBy: auth.userId,
      cancelledByType: req.user?.userType,
    });
    if (!result.ok) {
      return res.status(result.status).json({
        success: false, error: result.error,
        ...(result.code ? { code: result.code } : {}),
        ...(result.tooLate ? { tooLate: true } : {}),
      });
    }
    if (result.pending) {
      // 화면에는 현재 상태(`cancelling` = "취소 중")를 그대로 준다. 워커가 마무리하면 상태가 따라온다.
      return res.status(202).json({ success: true, pending: true, code: 'CANCEL_IN_PROGRESS', request: toPublic(result.row) });
    }
    return res.json({ success: true, request: toPublic(result.row) });
  } catch (err: any) {
    if (isMissingRelation(err)) return migrationPending(res);
    console.error('[agency-send] 취소 실패:', err);
    return res.status(500).json({ success: false, error: '취소하지 못했습니다.' });
  }
});

export default router;
