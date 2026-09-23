/**
 * ★ 2026-08-24 AI 영업 아웃리치 v2 — 슈퍼관리자 ceo 전용 (설계 = docs/2026-07-31-ai-sales-outreach-design.md §15 · ★2026-09-05 §8-3 엔드포인트 확장)
 *
 * - 권한의 진실은 라우트가 아니라 CT 효과 함수 안(assertOperator·fail-closed)이다. 여기의 검사는 UX용 이중이다.
 * - err.message 원문을 응답에 싣지 않는다(OutreachError 분류 + 안전 문구만 — B-0824-1 부류 차단).
 * - 상태를 바꾸는 endpoint는 성공·거절 양쪽 다 서버 로그를 남기고, 성공은 감사 로그(recordAuditLog · B-12)도 남긴다.
 * - 테이블 미생성 상태 = 503 DB_MIGRATION_PENDING(db_alter_safety_net).
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import { isSalesOutreachOperator, recordAuditLog } from '../utils/audit-log';
import {
  enqueueOutreachJob, confirmOutreachSelection, retryOutreachJob,
  getOutreachJob, getLatestOutreachJob, listOutreachJobs, enqueueOutreachJobsBulk,
  OutreachError, isOutreachMigrationPending,
  sendOutreachMailForJob, sendOutreachTestMail, confirmOutreachMailArrived, markOutreachForwarded,
  editOutreachCopy, editOutreachSubject, rebuildOutreachEmail, regenerateOutreachAsset, recrawlOutreachJob,
  dismissOutreachJob, countOutreachBadge, selectOutreachMaterials, hideOutreachSections, overrideOutreachMaterialGate,
  deleteOutreachJob, deleteOutreachJobsBulk,
  // ★ v3 회신 문장 · 레시피 승격
  editOutreachReplyLine, promoteOutreachRecipe,
} from '../utils/sales-outreach-jobs';
import { outreachMailTo, outreachMailToList, isOutreachMailerReady, outreachTestMailDomains, outreachTestMailAddresses } from '../utils/outreach-mailer';
// ★ 2026-09-23 담당자 직접 발송(설계서 docs/2026-09-23-outreach-direct-send-design.md) — 효과 함수는 전부 그 파일 안에서 assertOperator 를 먼저 지난다
import {
  getOutreachDirectInfo, setOutreachContact, reviewOutreachJob, holdOutreachJob, ackOutreachContactDomain, reopenOutreachContact,
  sendOutreachDirectForJob, sendOutreachDirectBulk, autoSendOutreachJob, getOutreachDirectStatus, resumeOutreachAutoSend,
  setOutreachSendReviewFlag, extractOutreachStorePageText, getOutreachWorkbench,
} from '../utils/sales-outreach-direct-jobs';
import { directStageEnv, outreachHashSecret, CONTACT_BASIS_PRESETS } from '../utils/sales-outreach-direct';
import { getOutreachContext } from '../utils/sales-outreach-produce';
import { buildOutreachTemplateXlsx, parseOutreachBulkXlsx } from '../utils/sales-outreach-bulk';
import { XLSX_CONTENT_TYPE, xlsxContentDisposition } from '../utils/xlsx-writer';

const router = Router();
router.use(authenticate, requireSuperAdmin);

/** 오류 → 안전 응답 공통 변환(원문 미노출) */
function respondError(res: Response, err: any, context: string): void {
  if (err instanceof OutreachError) {
    const status = err.code === 'FORBIDDEN' ? 403
      : err.code === 'NOT_FOUND' ? 404
      : err.code === 'CONFLICT' ? 409
      : err.code === 'NOT_READY' ? 503
      : 400;
    console.log(`[sales-outreach] ${context} 거절(${err.code}):`, err.message);
    res.status(status).json({ error: err.message, code: err.code, ...(err.details || {}) });
    return;
  }
  if (isOutreachMigrationPending(err)) {
    console.error(`[sales-outreach] ${context} — DB 마이그레이션 필요:`, err?.message);
    res.status(503).json({
      code: 'DB_MIGRATION_PENDING',
      error: 'DB 마이그레이션 필요: sales_outreach_jobs·sales_outreach_assets·sales_outreach_sends·sales_outreach_suppressions·sales_outreach_controls 테이블(및 fail_detail·contact 칸) 생성을 요청해주세요.',
    });
    return;
  }
  console.error(`[sales-outreach] ${context} 실패:`, err?.message);
  res.status(500).json({ error: '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
}

/** 감사 로그(성공 분기 전용 · 실패는 CT가 흡수) */
function audit(req: Request, action: string, jobId: string | null, details?: Record<string, unknown>): void {
  recordAuditLog({ actorUserId: req.user?.userId, action: `sales_outreach.${action}`, targetType: 'sales_outreach_job', targetId: jobId, details, req }).catch(() => {});
}

// 메뉴 노출 게이팅 — 기존 /access 규약과 동일 응답 형태. ★ B-1 허용 계정에만 준비·발송 ENV 상태 노출.
router.get('/access', async (req: Request, res: Response) => {
  const allowed = await isSalesOutreachOperator(req.user?.userId);
  res.json({
    allowed,
    ...(allowed ? {
      mailTo: outreachMailToList(),
      ready: !!getOutreachContext(),
      send: { senderReady: isOutreachMailerReady(), unsubReady: !!(process.env.OUTREACH_UNSUB_NOTICE || '').trim() },
      testDomains: outreachTestMailDomains(),
      // ★ 2026-09-23 검수 허용 주소 · 직접 발송 결재 단계(ENV) · 원장 비밀값 준비 · 수신 근거 선택지
      testAddresses: outreachTestMailAddresses(),
      direct: { envStage: directStageEnv(), hashReady: !!outreachHashSecret() },
      contactBasisPresets: CONTACT_BASIS_PRESETS,
    } : {}),
  });
});

// ★ B-13 메뉴 뱃지 — 비허용 계정 404(게이트 은닉)
router.get('/badge', async (req: Request, res: Response) => {
  try {
    if (!(await isSalesOutreachOperator(req.user?.userId))) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, count: await countOutreachBadge(req.user?.userId) });
  } catch (err: any) {
    respondError(res, err, '뱃지');
  }
});

// 등록 — 등록만 동기(1초 내), 파이프라인은 잡으로. 202 + jobId 폴링. ★ B-6 중복 409 · ★ B-15 extraNotes
router.post('/jobs', async (req: Request, res: Response) => {
  try {
    const { id } = await enqueueOutreachJob({
      companyName: req.body?.companyName,
      industryCategory: req.body?.industryCategory ?? null,
      homepageUrl: req.body?.homepageUrl,
      extraNotes: req.body?.extraNotes ?? null,
      force: req.body?.force === true,
      // ★ 2026-09-23 담당자(사람이 넣은 값) · 네이버 스토어 주소(저장만)
      contactEmail: req.body?.contactEmail ?? null,
      contactName: req.body?.contactName ?? null,
      contactBasis: req.body?.contactBasis ?? null,
      naverStoreUrl: req.body?.naverStoreUrl ?? null,
    }, req.user?.userId);
    console.log('[sales-outreach] 등록:', id, req.user?.userId);
    audit(req, 'enqueue', id, { companyName: String(req.body?.companyName || '').slice(0, 100), force: req.body?.force === true });
    res.status(202).json({ jobId: id });
  } catch (err: any) {
    respondError(res, err, '등록');
  }
});

// 대량 업로드 양식(xlsx) — 입력 3열 + 옆에 작성 예시·업종 목록(Harold 0824)
router.get('/template.xlsx', async (req: Request, res: Response) => {
  try {
    if (!(await isSalesOutreachOperator(req.user?.userId))) {
      return res.status(403).json({ error: '이 기능을 사용할 권한이 없습니다.', code: 'FORBIDDEN' });
    }
    const buf = await buildOutreachTemplateXlsx();
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', xlsxContentDisposition('AI영업_업체목록_양식.xlsx'));
    res.send(buf);
  } catch (err: any) {
    respondError(res, err, '양식 다운로드');
  }
});

// 대량 등록 — ★ C-6 순서 = 권한 검사 → multer(확장자 AND mimetype) → 파싱 → enqueue
const bulkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const extOk = /\.(xlsx|xls)$/i.test(String(file.originalname || ''));
    const mimeOk = /spreadsheetml|ms-excel|octet-stream/i.test(String(file.mimetype || ''));
    if (extOk && mimeOk) return cb(null, true);
    const e: any = new Error('엑셀 파일만 허용');
    e.code = 'BAD_FILE_TYPE';
    cb(e);
  },
});
router.post('/jobs/bulk', async (req: Request, res: Response) => {
  if (!(await isSalesOutreachOperator(req.user?.userId))) {
    return res.status(403).json({ error: '이 기능을 사용할 권한이 없습니다.', code: 'FORBIDDEN' });
  }
  bulkUpload.single('file')(req as any, res as any, async (err: any) => {
    if (err) {
      console.log('[sales-outreach] 일괄 업로드 거절:', err?.message);
      const msg = err?.code === 'LIMIT_FILE_SIZE' ? '파일이 5MB를 넘습니다. 나눠서 올려주세요.'
        : err?.code === 'BAD_FILE_TYPE' ? '엑셀 파일(.xlsx/.xls)만 올릴 수 있습니다.'
        : '파일 업로드에 실패했습니다(5MB 이하 엑셀 파일 1개).';
      return res.status(400).json({ error: msg });
    }
    try {
      const file = (req as any).file as { buffer: Buffer } | undefined;
      if (!file?.buffer) return res.status(400).json({ error: '엑셀 파일을 선택해주세요.' });
      const parsed = parseOutreachBulkXlsx(file.buffer);
      if (parsed.rows.length === 0) {
        return res.status(400).json({
          error: '등록할 수 있는 줄이 없습니다. 양식의 업체명·홈페이지 열을 확인해주세요.',
          rejected: parsed.rejected,
          rejectedOverflow: parsed.rejectedOverflow,
        });
      }
      // ★ 2026-09-23 일괄 옵션 — 행사 자동 확정(기본 켬) · 단계 3 묶음 자동 발송 승인(유효 단계 3 일 때만 · 승인 기록 = 이 사람 · 이 시각 · 규칙 v1)
      const autoConfirm = String((req as any).body?.autoConfirm ?? '1') !== '0';
      const wantAutoSend = String((req as any).body?.autoSend ?? '0') === '1';
      let autoSendApproval: { by: string; at: string; rule: string } | null = null;
      if (wantAutoSend) {
        const st = await getOutreachDirectStatus(req.user?.userId);
        if (st.stage < 3) return res.status(409).json({ error: `묶음 자동 발송은 단계 3부터 열립니다(지금 단계 ${st.stage}).`, code: 'CONFLICT', blockers: st.blockers });
        if (!autoConfirm) return res.status(400).json({ error: '자동 발송은 행사 자동 확정과 함께만 켤 수 있습니다.', code: 'VALIDATION' });
        autoSendApproval = { by: String(req.user?.userId), at: new Date().toISOString(), rule: 'v1' };
      }
      const result = await enqueueOutreachJobsBulk(parsed.rows, req.user?.userId, {
        autoConfirm,
        autoSendApproval,
        onReady: autoSendApproval ? (id: string) => autoSendOutreachJob(id) : undefined,
      });
      console.log('[sales-outreach] 일괄 등록:', result.acceptedIds.length, '건 /', req.user?.userId, autoConfirm ? '자동 확정' : '', autoSendApproval ? '자동 발송 승인' : '');
      audit(req, 'enqueue_bulk', null, { accepted: result.acceptedIds.length, rejected: parsed.rejected.length + result.rejected.length, autoConfirm, autoSend: !!autoSendApproval, batch: result.batch });
      res.status(202).json({
        accepted: result.acceptedIds.length,
        acceptedIds: result.acceptedIds,
        batch: result.batch,
        rejected: [
          ...parsed.rejected.map((r) => ({ label: `${r.line}행`, reason: r.reason })),
          ...result.rejected.map((r) => ({ label: r.companyName, reason: r.reason })),
        ],
        rejectedOverflow: parsed.rejectedOverflow,
        // 등록은 됐지만 칸 하나를 비운 줄(거절과 별도 · §10)
        warnings: parsed.warnings.map((w) => ({ label: `${w.line}행`, reason: w.reason })),
        format: parsed.format,
      });
    } catch (e: any) {
      respondError(res, e, '일괄 등록');
    }
  });
});

// 진행 목록(이력) — ★ B-8 검색·상태 그룹·커서
router.get('/jobs', async (req: Request, res: Response) => {
  try {
    res.json({
      jobs: await listOutreachJobs(req.user?.userId, {
        q: typeof req.query.q === 'string' ? req.query.q : null,
        group: typeof req.query.group === 'string' ? req.query.group : null,
        view: typeof req.query.view === 'string' ? req.query.view : null,
        limit: req.query.limit ? Number(req.query.limit) : null,
        before: typeof req.query.before === 'string' ? req.query.before : null,
      }),
    });
  } catch (err: any) {
    respondError(res, err, '목록 조회');
  }
});

// 직전 실행 1건 요약(모달 상단 요약 줄 + 재실행 경고용)
router.get('/jobs/latest', async (req: Request, res: Response) => {
  try {
    res.json({ job: await getLatestOutreachJob(req.user?.userId) });
  } catch (err: any) {
    respondError(res, err, '최근 건 조회');
  }
});

// ★ 2026-09-23 작업대(묶음 · 줄 · 3초 판정 카드 = 서버 계산) — 폴링
router.get('/workbench', async (req: Request, res: Response) => {
  try {
    res.json(await getOutreachWorkbench({ batch: typeof req.query.batch === 'string' ? req.query.batch : null }, req.user?.userId));
  } catch (err: any) {
    respondError(res, err, '작업대 조회');
  }
});

// ★ 2026-09-23 직접 발송 단계 · 통계 · 자동 정지
router.get('/direct/status', async (req: Request, res: Response) => {
  try {
    res.json(await getOutreachDirectStatus(req.user?.userId));
  } catch (err: any) {
    respondError(res, err, '발송 단계 조회');
  }
});

router.post('/direct/resume', async (req: Request, res: Response) => {
  try {
    await resumeOutreachAutoSend(req.user?.userId);
    console.log('[sales-outreach] 자동 발송 다시 켬:', req.user?.userId);
    audit(req, 'direct_resume', null);
    res.json({ ok: true });
  } catch (err: any) {
    respondError(res, err, '자동 발송 다시 켜기');
  }
});

// ★ 2026-09-23 묶음 직접 발송(단계 2 · 확인한 건만 · 백그라운드 순차)
router.post('/jobs/send-direct-bulk', async (req: Request, res: Response) => {
  try {
    const r = await sendOutreachDirectBulk(req.body?.items, req.user?.userId);
    console.log('[sales-outreach] 묶음 직접 발송 접수:', r.queued.length, '건 · 제외', r.skipped.length, req.user?.userId);
    audit(req, 'send_direct_bulk', null, { queued: r.queued, skipped: r.skipped.length });
    res.status(202).json({ ok: true, ...r });
  } catch (err: any) {
    respondError(res, err, '묶음 직접 발송');
  }
});

// 상태 폴링(2초) — 단계·산출물·실패 사유·발송 잠금 · ★ 2026-09-23 담당자 직접 발송 정보(direct · 조회 실패는 null · 본 조회를 막지 않는다)
router.get('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const job = await getOutreachJob(req.params.id, req.user?.userId);
    const direct = await getOutreachDirectInfo(req.params.id, req.user?.userId).catch((e: any) => {
      console.log('[sales-outreach] 직접 발송 정보 건너뜀:', req.params.id, e?.message);
      return null;
    });
    res.json({ ...job, direct });
  } catch (err: any) {
    respondError(res, err, '조회');
  }
});

// ★ 2026-09-23 담당자 저장(ready 면 메일 재조립이 바로 돈다 · AI 0)
router.post('/jobs/:id/contact', async (req: Request, res: Response) => {
  try {
    const r = await setOutreachContact(req.params.id, { email: req.body?.email, name: req.body?.name, basis: req.body?.basis }, req.user?.userId);
    console.log('[sales-outreach] 담당자 저장:', req.params.id, r.rebuilding ? '재조립' : '', req.user?.userId);
    audit(req, 'contact', req.params.id, { hasEmail: !!String(req.body?.email || '').trim(), rebuilding: r.rebuilding });
    res.json({ ok: true, ...r });
  } catch (err: any) {
    respondError(res, err, '담당자 저장');
  }
});

// ★ 2026-09-23 확인(O · 화면에 렌더한 판 id) · 보류(X · 사유 5값)
router.post('/jobs/:id/review', async (req: Request, res: Response) => {
  try {
    await reviewOutreachJob(req.params.id, req.body?.assetId, req.user?.userId);
    console.log('[sales-outreach] 확인:', req.params.id, req.user?.userId);
    audit(req, 'review', req.params.id, { assetId: String(req.body?.assetId || '').slice(0, 40) });
    res.json({ ok: true });
  } catch (err: any) {
    respondError(res, err, '확인');
  }
});

router.post('/jobs/:id/hold', async (req: Request, res: Response) => {
  try {
    await holdOutreachJob(req.params.id, req.body?.reason, req.user?.userId);
    console.log('[sales-outreach] 보류:', req.params.id, req.body?.reason, req.user?.userId);
    audit(req, 'hold', req.params.id, { reason: String(req.body?.reason || '').slice(0, 20) });
    res.json({ ok: true });
  } catch (err: any) {
    respondError(res, err, '보류');
  }
});

// ★ 2026-09-23 담당자 도메인 불일치 해제(근거 확인 · 사람 2클릭 · 그 주소에만)
router.post('/jobs/:id/domain-ack', async (req: Request, res: Response) => {
  try {
    await ackOutreachContactDomain(req.params.id, req.user?.userId);
    console.log('[sales-outreach] 도메인 불일치 해제:', req.params.id, req.user?.userId);
    audit(req, 'domain_ack', req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    respondError(res, err, '도메인 불일치 해제');
  }
});

// ★ 2026-09-23 담당자에게 직접 발송(단계 1 · 발송 확인 창의 1클릭 · 수신처 = 서버 저장값 · expectedTo 는 확인만)
router.post('/jobs/:id/send-direct', async (req: Request, res: Response) => {
  try {
    const r = await sendOutreachDirectForJob(req.params.id, req.body?.expectedTo, req.user?.userId);
    console.log('[sales-outreach] 직접 발송:', req.params.id, r.outcome, req.user?.userId);
    audit(req, 'send_direct', req.params.id, { outcome: r.outcome });
    res.json({ ok: true, outcome: r.outcome, detail: r.detail, to: r.to });
  } catch (err: any) {
    respondError(res, err, '직접 발송');
  }
});

// ★ 2026-09-23 같은 회사 재접촉 열기(마지막 발송 90일 경과)
router.post('/jobs/:id/reopen-contact', async (req: Request, res: Response) => {
  try {
    const r = await reopenOutreachContact(req.params.id, req.user?.userId);
    console.log('[sales-outreach] 재접촉 열기:', req.params.id, r.reopened, req.user?.userId);
    audit(req, 'reopen_contact', req.params.id, r);
    res.json({ ok: true, ...r });
  } catch (err: any) {
    respondError(res, err, '재접촉 열기');
  }
});

// ★ 2026-09-23 사후 확인(단계 3 표본) ok · wrong(= 자동 정지)
router.post('/sends/:id/review-flag', async (req: Request, res: Response) => {
  try {
    await setOutreachSendReviewFlag(req.params.id, req.body?.flag, req.user?.userId);
    console.log('[sales-outreach] 사후 확인:', req.params.id, req.body?.flag, req.user?.userId);
    audit(req, 'send_review_flag', null, { sendId: req.params.id, flag: String(req.body?.flag || '') });
    res.json({ ok: true });
  } catch (err: any) {
    respondError(res, err, '사후 확인');
  }
});

// ★ 2026-09-23 네이버 스토어 저장본(사람이 저장한 기획전 페이지 · 2MB · 네트워크 0 · DB 쓰기 0 → 붙여넣기 칸을 채운다)
const storePageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (/\.html?$/i.test(String(file.originalname || ''))) return cb(null, true);
    const e: any = new Error('웹페이지 파일만 허용');
    e.code = 'BAD_FILE_TYPE';
    cb(e);
  },
});
router.post('/jobs/:id/store-page', async (req: Request, res: Response) => {
  if (!(await isSalesOutreachOperator(req.user?.userId))) {
    return res.status(403).json({ error: '이 기능을 사용할 권한이 없습니다.', code: 'FORBIDDEN' });
  }
  storePageUpload.single('file')(req as any, res as any, async (err: any) => {
    if (err) {
      console.log('[sales-outreach] 스토어 저장본 거절:', err?.message);
      const msg = err?.code === 'LIMIT_FILE_SIZE' ? '파일이 2MB를 넘습니다.' : err?.code === 'BAD_FILE_TYPE' ? '저장한 웹페이지 파일(.html)만 올릴 수 있습니다.' : '파일 업로드에 실패했습니다.';
      return res.status(400).json({ error: msg });
    }
    try {
      const file = (req as any).file as { buffer: Buffer } | undefined;
      if (!file?.buffer) return res.status(400).json({ error: '파일을 선택해주세요.' });
      const r = await extractOutreachStorePageText(req.params.id, file.buffer.toString('utf8'), req.user?.userId);
      console.log('[sales-outreach] 스토어 저장본 읽기:', req.params.id, r.chars, req.user?.userId);
      audit(req, 'store_page', req.params.id, { chars: r.chars });
      res.json({ ok: true, ...r });
    } catch (e: any) {
      respondError(res, e, '스토어 저장본 읽기');
    }
  });
});

// 읽은 것 확인(사람 게이트) — 행사·이미지·업종 확정 → 제작 시작. ★ A-9 warnings 동봉
router.post('/jobs/:id/confirm', async (req: Request, res: Response) => {
  try {
    const { warnings } = await confirmOutreachSelection(req.params.id, {
      eventIndex: req.body?.eventIndex ?? null,
      // ★ v3 다중 선택(배열 · 서버가 정수·범위·중복을 걸러 앞 3개)
      eventIndexes: Array.isArray(req.body?.eventIndexes) ? req.body.eventIndexes : null,
      manualEventText: req.body?.manualEventText,
      imageUrl: req.body?.imageUrl ?? null,
      industryCategory: req.body?.industryCategory,
    }, req.user?.userId);
    console.log('[sales-outreach] 확정:', req.params.id, req.user?.userId);
    audit(req, 'confirm', req.params.id, { eventIndex: req.body?.eventIndex ?? null, events: Array.isArray(req.body?.eventIndexes) ? req.body.eventIndexes.length : null, manual: !!req.body?.manualEventText, image: !!req.body?.imageUrl });
    res.status(202).json({ ok: true, warnings });
  } catch (err: any) {
    respondError(res, err, '확정');
  }
});

// 실패 건 재시도(실패한 그 단계부터) — 자동 재시도는 없다. 사람 버튼이 유일 경로.
router.post('/jobs/:id/retry', async (req: Request, res: Response) => {
  try {
    await retryOutreachJob(req.params.id, req.user?.userId);
    console.log('[sales-outreach] 재시도:', req.params.id, req.user?.userId);
    audit(req, 'retry', req.params.id);
    res.status(202).json({ ok: true });
  } catch (err: any) {
    respondError(res, err, '재시도');
  }
});

// ★ B-7 주소 수정·재분석(awaiting_confirm·failed)
router.post('/jobs/:id/recrawl', async (req: Request, res: Response) => {
  try {
    await recrawlOutreachJob(req.params.id, { homepageUrl: req.body?.homepageUrl ?? null }, req.user?.userId);
    console.log('[sales-outreach] 재분석:', req.params.id, req.user?.userId);
    audit(req, 'recrawl', req.params.id, { homepageUrl: String(req.body?.homepageUrl || '').slice(0, 300) || null });
    res.status(202).json({ ok: true });
  } catch (err: any) {
    respondError(res, err, '재분석');
  }
});

// ★ B-3 산출물별 재생성
router.post('/jobs/:id/regenerate', async (req: Request, res: Response) => {
  try {
    const { seq } = await regenerateOutreachAsset(req.params.id, String(req.body?.kind || ''), req.user?.userId);
    console.log('[sales-outreach] 재생성:', req.params.id, req.body?.kind, seq, req.user?.userId);
    audit(req, 'regenerate', req.params.id, { kind: String(req.body?.kind || ''), seq });
    res.status(202).json({ ok: true, seq });
  } catch (err: any) {
    respondError(res, err, '재생성');
  }
});

// 자사 메일 발송 — 확인 모달 뒤 사람 클릭 1회. 결과 3값(sent/rejected/unknown)을 그대로 돌려준다.
router.post('/jobs/:id/send', async (req: Request, res: Response) => {
  try {
    const result = await sendOutreachMailForJob(req.params.id, req.user?.userId);
    console.log('[sales-outreach] 발송:', req.params.id, result.outcome, req.user?.userId);
    audit(req, 'send', req.params.id, { outcome: result.outcome, to: outreachMailTo() });
    res.json({ outcome: result.outcome, detail: result.detail, to: outreachMailTo(), recipients: outreachMailToList() });
  } catch (err: any) {
    respondError(res, err, '발송');
  }
});

// ★ B-15 검수 테스트 발송 — 허용 도메인 안의 담당자 주소로. stage·mail_result 무변경.
router.post('/jobs/:id/test-send', async (req: Request, res: Response) => {
  try {
    const result = await sendOutreachTestMail(req.params.id, String(req.body?.to || ''), req.user?.userId);
    console.log('[sales-outreach] 검수 발송:', req.params.id, result.outcome, req.user?.userId);
    audit(req, 'test_send', req.params.id, { outcome: result.outcome, to: result.to });
    res.json({ outcome: result.outcome, detail: result.detail, to: result.to });
  } catch (err: any) {
    respondError(res, err, '검수 발송');
  }
});

// 수신함 도착 확인(사람) — 자동 종결 금지 축
router.post('/jobs/:id/mail-confirmed', async (req: Request, res: Response) => {
  try {
    await confirmOutreachMailArrived(req.params.id, req.user?.userId);
    console.log('[sales-outreach] 수신 확인:', req.params.id, req.user?.userId);
    audit(req, 'mail_confirmed', req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    respondError(res, err, '수신 확인');
  }
});

// 업체 전달함 표시(사람) — 공개 샘플 수명 연장 트리거 + 재실행 경고 축
router.post('/jobs/:id/forwarded', async (req: Request, res: Response) => {
  try {
    await markOutreachForwarded(req.params.id, req.user?.userId);
    console.log('[sales-outreach] 전달 표시:', req.params.id, req.user?.userId);
    audit(req, 'forwarded', req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    respondError(res, err, '전달 표시');
  }
});

// 문안 수정(제작 완료 상태에서) — 수정 즉시 메일 재조립(미리보기 = 발송본 유지)
router.post('/jobs/:id/copy', async (req: Request, res: Response) => {
  try {
    await editOutreachCopy(req.params.id, req.body?.body, req.user?.userId);
    console.log('[sales-outreach] 문안 수정:', req.params.id, req.user?.userId);
    audit(req, 'copy_edit', req.params.id);
    res.status(202).json({ ok: true });
  } catch (err: any) {
    respondError(res, err, '문안 수정');
  }
});

// ★ B-9 메일 제목 편집(1~40자)
router.post('/jobs/:id/subject', async (req: Request, res: Response) => {
  try {
    await editOutreachSubject(req.params.id, String(req.body?.subject || ''), req.user?.userId);
    console.log('[sales-outreach] 제목 수정:', req.params.id, req.user?.userId);
    audit(req, 'subject_edit', req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    respondError(res, err, '제목 수정');
  }
});

// ★ v3 회신 유도 문장 편집(0~60자 · 비우면 기본 문장) → 메일 재조립(AI 0)
router.post('/jobs/:id/reply-line', async (req: Request, res: Response) => {
  try {
    await editOutreachReplyLine(req.params.id, String(req.body?.text || ''), req.user?.userId);
    console.log('[sales-outreach] 회신 문장 수정:', req.params.id, req.user?.userId);
    audit(req, 'reply_line', req.params.id);
    res.status(202).json({ ok: true });
  } catch (err: any) {
    respondError(res, err, '회신 문장 수정');
  }
});

// ★ v3 레시피 승격(학습 원장 · 원문 0 · best_copy_assets kind recipe · 같은 잡 중복 0)
router.post('/jobs/:id/promote-recipe', async (req: Request, res: Response) => {
  try {
    const r = await promoteOutreachRecipe(req.params.id, req.user?.userId);
    console.log('[sales-outreach] 레시피 승격:', req.params.id, r.id, req.user?.userId);
    audit(req, 'promote_recipe', req.params.id, { assetId: r.id });
    res.json({ ok: true, ...r });
  } catch (err: any) {
    respondError(res, err, '레시피 승격');
  }
});

// 메일 재조립 — 수신거부 문구(ENV) 반영 등(제목·서두는 보존)
router.post('/jobs/:id/rebuild-email', async (req: Request, res: Response) => {
  try {
    await rebuildOutreachEmail(req.params.id, req.user?.userId);
    console.log('[sales-outreach] 메일 재조립:', req.params.id, req.user?.userId);
    audit(req, 'rebuild_email', req.params.id);
    res.status(202).json({ ok: true });
  } catch (err: any) {
    respondError(res, err, '메일 재조립');
  }
});

// ★ B-13 실패 건 숨기기(뱃지 제외 · 삭제 아님)
// ★ 0905(3) C4-2 재료 다시 고르기(ready → producing_dm · 실측 통과 사본 URL 화이트리스트 · 제목·서두 보존)
router.post('/jobs/:id/materials', async (req: Request, res: Response) => {
  try {
    const r = await selectOutreachMaterials(req.params.id, req.body, req.user?.userId);
    console.log('[sales-outreach] 재료 재선택:', req.params.id, r.products, r.gallery, r.seq, req.user?.userId);
    audit(req, 'materials', req.params.id, { products: r.products, gallery: r.gallery, seq: r.seq });
    res.status(202).json({ ok: true, ...r });
  } catch (err: any) {
    respondError(res, err, '재료 재선택');
  }
});

// ★ 0905(3) C4-3 블록 숨기기(override 데이터 · DM 재발행/이메일 재조립 · AI 0 · 재생성 뒤 재적용)
router.post('/jobs/:id/sections', async (req: Request, res: Response) => {
  try {
    const r = await hideOutreachSections(req.params.id, { kind: String(req.body?.kind || ''), hidden: req.body?.hidden, reason: req.body?.reason }, req.user?.userId);
    console.log('[sales-outreach] 블록 숨김:', req.params.id, req.body?.kind, r.hidden, req.user?.userId);
    audit(req, 'sections', req.params.id, { kind: String(req.body?.kind || ''), hidden: r.hidden });
    res.status(202).json({ ok: true, ...r });
  } catch (err: any) {
    respondError(res, err, '블록 숨김');
  }
});

// ★ 2026-09-06 S2 재료 부족 잠금 해제(사람 2클릭 · 감사 로그) — ready 에서만 · 재크롤이면 다시 잠긴다
router.post('/jobs/:id/material-override', async (req: Request, res: Response) => {
  try {
    const r = await overrideOutreachMaterialGate(req.params.id, req.user?.userId);
    console.log('[sales-outreach] 재료 부족 잠금 해제:', req.params.id, req.user?.userId);
    audit(req, 'material_override', req.params.id);
    res.json({ ok: true, ...r });
  } catch (err: any) {
    respondError(res, err, '재료 부족 잠금 해제');
  }
});

// ★ 2026-09-06 S4 삭제 — 단건(sent 허용 · 링크 즉시 닫힘 · 파기 숫자 응답) · 다중(sent 제외 · 최대 100). 진행 중·발송 중은 409.
router.post('/jobs/delete-bulk', async (req: Request, res: Response) => {
  try {
    const r = await deleteOutreachJobsBulk(req.body?.ids, req.user?.userId);
    console.log('[sales-outreach] 선택 삭제:', r.deleted.length, '건 · 제외', r.skipped.length, req.user?.userId);
    audit(req, 'delete_bulk', null, { deleted: r.deleted, skipped: r.skipped.length });
    res.json({ ok: true, ...r });
  } catch (err: any) {
    respondError(res, err, '선택 삭제');
  }
});

router.post('/jobs/:id/delete', async (req: Request, res: Response) => {
  try {
    const r = await deleteOutreachJob(req.params.id, req.user?.userId);
    console.log('[sales-outreach] 삭제:', req.params.id, req.user?.userId);
    audit(req, 'delete', req.params.id, r);
    res.json({ ok: true, ...r });
  } catch (err: any) {
    respondError(res, err, '삭제');
  }
});

router.post('/jobs/:id/dismiss', async (req: Request, res: Response) => {
  try {
    await dismissOutreachJob(req.params.id, req.user?.userId);
    console.log('[sales-outreach] 숨기기:', req.params.id, req.user?.userId);
    audit(req, 'dismiss', req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    respondError(res, err, '숨기기');
  }
});

export default router;
