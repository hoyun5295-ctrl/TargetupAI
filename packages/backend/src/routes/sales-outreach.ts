/**
 * ★ 2026-08-24 AI 영업 아웃리치 v2 — 슈퍼관리자 ceo 전용 (설계 = docs/2026-07-31-ai-sales-outreach-design.md §15)
 *
 * - 권한의 진실은 라우트가 아니라 CT 효과 함수 안(assertOperator·fail-closed)이다. 여기의 검사는 UX용 이중이다.
 * - err.message 원문을 응답에 싣지 않는다(OutreachError 분류 + 안전 문구만 — B-0824-1 부류 차단).
 * - 상태를 바꾸는 endpoint는 성공·거절 양쪽 다 서버 로그를 남긴다(무흔적 4xx 금지).
 * - 테이블 미생성 상태 = 503 DB_MIGRATION_PENDING(db_alter_safety_net).
 */
import { Router, Request, Response } from 'express';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import { isSalesOutreachOperator } from '../utils/audit-log';
import {
  enqueueOutreachJob, confirmOutreachSelection, retryOutreachJob,
  getOutreachJob, getLatestOutreachJob,
  sendOutreachMailForJob, confirmOutreachMailArrived, markOutreachForwarded,
  editOutreachCopy, rebuildOutreachEmail,
  OutreachError, isOutreachMigrationPending,
} from '../utils/sales-outreach-jobs';
import { outreachMailTo } from '../utils/outreach-mailer';

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
    res.status(status).json({ error: err.message, code: err.code });
    return;
  }
  if (isOutreachMigrationPending(err)) {
    console.error(`[sales-outreach] ${context} — DB 마이그레이션 필요:`, err?.message);
    res.status(503).json({
      code: 'DB_MIGRATION_PENDING',
      error: 'DB 마이그레이션 필요: sales_outreach_jobs·sales_outreach_assets 테이블 생성을 요청해주세요.',
    });
    return;
  }
  console.error(`[sales-outreach] ${context} 실패:`, err?.message);
  res.status(500).json({ error: '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
}

// 메뉴 노출 게이팅 — 기존 /access 규약과 동일 응답 형태
router.get('/access', async (req: Request, res: Response) => {
  res.json({ allowed: await isSalesOutreachOperator(req.user?.userId) });
});

// 등록 — 등록만 동기(1초 내), 파이프라인은 잡으로. 202 + jobId 폴링.
router.post('/jobs', async (req: Request, res: Response) => {
  try {
    const { id } = await enqueueOutreachJob({
      companyName: req.body?.companyName,
      industryCategory: req.body?.industryCategory ?? null,
      homepageUrl: req.body?.homepageUrl,
    }, req.user?.userId);
    console.log('[sales-outreach] 등록:', id, req.user?.userId);
    res.status(202).json({ jobId: id });
  } catch (err: any) {
    respondError(res, err, '등록');
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

// 상태 폴링(2초) — 단계·산출물·실패 사유
router.get('/jobs/:id', async (req: Request, res: Response) => {
  try {
    res.json(await getOutreachJob(req.params.id, req.user?.userId));
  } catch (err: any) {
    respondError(res, err, '조회');
  }
});

// 읽은 것 확인(사람 게이트) — 행사·이미지·업종 확정 → 제작 시작
router.post('/jobs/:id/confirm', async (req: Request, res: Response) => {
  try {
    await confirmOutreachSelection(req.params.id, {
      eventIndex: req.body?.eventIndex ?? null,
      manualEventText: req.body?.manualEventText,
      imageUrl: req.body?.imageUrl ?? null,
      industryCategory: req.body?.industryCategory,
    }, req.user?.userId);
    console.log('[sales-outreach] 확정:', req.params.id, req.user?.userId);
    res.status(202).json({ ok: true });
  } catch (err: any) {
    respondError(res, err, '확정');
  }
});

// 실패 건 재시도(실패한 그 단계부터) — 자동 재시도는 없다. 사람 버튼이 유일 경로.
router.post('/jobs/:id/retry', async (req: Request, res: Response) => {
  try {
    await retryOutreachJob(req.params.id, req.user?.userId);
    console.log('[sales-outreach] 재시도:', req.params.id, req.user?.userId);
    res.status(202).json({ ok: true });
  } catch (err: any) {
    respondError(res, err, '재시도');
  }
});

// 자사 메일 발송 — 확인 모달 뒤 사람 클릭 1회. 결과 3값(sent/rejected/unknown)을 그대로 돌려준다.
router.post('/jobs/:id/send', async (req: Request, res: Response) => {
  try {
    const result = await sendOutreachMailForJob(req.params.id, req.user?.userId);
    console.log('[sales-outreach] 발송:', req.params.id, result.outcome, req.user?.userId);
    res.json({ outcome: result.outcome, detail: result.detail, to: outreachMailTo() });
  } catch (err: any) {
    respondError(res, err, '발송');
  }
});

// 수신함 도착 확인(사람) — 자동 종결 금지 축
router.post('/jobs/:id/mail-confirmed', async (req: Request, res: Response) => {
  try {
    await confirmOutreachMailArrived(req.params.id, req.user?.userId);
    console.log('[sales-outreach] 수신 확인:', req.params.id, req.user?.userId);
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
    res.status(202).json({ ok: true });
  } catch (err: any) {
    respondError(res, err, '문안 수정');
  }
});

// 메일 재조립 — 수신거부 문구(ENV) 반영 등
router.post('/jobs/:id/rebuild-email', async (req: Request, res: Response) => {
  try {
    await rebuildOutreachEmail(req.params.id, req.user?.userId);
    console.log('[sales-outreach] 메일 재조립:', req.params.id, req.user?.userId);
    res.status(202).json({ ok: true });
  } catch (err: any) {
    respondError(res, err, '메일 재조립');
  }
});

export default router;
