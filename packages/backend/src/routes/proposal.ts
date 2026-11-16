/**
 * 제안 페이지(/proposal) · 제작 대행 체험 주소 (★ 2026-11-16 C136 배포 나 · 설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §3 ~ §7)
 *   마운트 = /api/plans/proposal. 판정 · SQL · 제작은 전부 CT(utils/proposal-trial.ts)가 소유한다 — 여기는 문과 응답 꼴만.
 *   - 담당자 = 로그인한 고객사 사용자(에이전트 전용 회사 제외) · 소개 글은 로그인한 요청에만 내려간다(머리말 private, no-store).
 *   - 직원 = 슈퍼관리자 ∧ 「소개 방문 · 시연 요청」 탭과 같은 허용 계정(대표 · 지원팀장 = 확인하고 전달하는 사람).
 *   - 표가 없으면(DDL 앞) 503 DB_MIGRATION_PENDING.
 * ⛔ 이 주소들은 발송하지 않는다(완성본을 작성 화면에 채울 값만 준다 · 발송은 평소 직접발송 길 그대로).
 */
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { isIntroLeadsViewer, recordAuditLog } from '../utils/audit-log';
import { canSeeIntroContent, GATED_CACHE_CONTROL } from '../utils/gated-content';
import {
  PROPOSAL_AUDIT, PROPOSAL_AUDIT_TARGET, PROPOSAL_PHOTO_MAX, PROPOSAL_PHOTO_MAX_BYTES, ProposalError,
  cleanProposalSrc, parseProposalRequest, checkProposalPhotos, proposalTrialExists, requestProposalTrial, startProposalProduce,
  proposalViewFor, proposalFillFor, proposalPageContent, proposalPrefillPhone,
  loadProposalAdmin, loadProposalAdminDetail, editProposalCopy, setProposalCallback, deliverProposalKit, notifyProposalReady,
  defaultProduceDeps, type ProposalRedo,
} from '../utils/proposal-trial';

const router = Router();
const TABLE = 'proposal_trials';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const limiter = (name: string, max: number) => rateLimit({
  windowMs: 10 * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `proposal-${name}:${req.user?.userId || 'anon'}`,
  message: { success: false, error: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.', code: 'RATE_LIMITED' },
});

/** 오류 응답 한 곳 — 표 없음 503 · CT 가 던진 오류는 그 상태 · 그 밖 500 */
function fail(err: any, res: Response, where: string): Response | void {
  if (handleDbMigrationError(err, res, TABLE)) return;
  if (err instanceof ProposalError) return res.status(err.status).json({ success: false, error: err.message, code: err.code });
  console.error(`[proposal/${where}] 실패:`, err?.message);
  return res.status(500).json({ success: false, error: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
}

/** 담당자 문 — 고객사 사용자 ∧ 에이전트 전용 회사 아님(소개 내용을 받을 수 있는 계정과 같은 판정) */
async function customerGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.setHeader('Cache-Control', GATED_CACHE_CONTROL);
  try {
    if (!(await canSeeIntroContent(req.user as any))) {
      res.status(403).json({ success: false, error: '이 계정에서는 볼 수 없는 화면입니다.', code: 'PROPOSAL_NOT_AVAILABLE' });
      return;
    }
    next();
  } catch (err: any) {
    console.error('[proposal] 회사 조회 실패:', err?.message);
    res.status(503).json({ success: false, error: '잠시 후 다시 시도해 주세요.' });
  }
}

// ── 로그인 전: 제안 페이지 열람 기록(링크의 src 만 남긴다 · 응답은 언제나 204 · IP당 호출 상한) ──
//   소개 글 · 그림은 이 주소로 나가지 않는다(아래 로그인 뒤 주소만 준다 · 설계서 §3-1).
const viewLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { success: false, error: '요청이 너무 잦습니다.', code: 'RATE_LIMITED' } });
router.post('/view', viewLimiter, async (req: Request, res: Response) => {
  await recordAuditLog({ action: PROPOSAL_AUDIT.view, targetType: PROPOSAL_AUDIT_TARGET, details: { src: cleanProposalSrc(req.body?.src) || '' }, req });
  res.status(204).end();
});

// ── 담당자: 제안 페이지가 그릴 것(상태 · CSS · 신청 전에는 소개 글) ──
router.get('/', authenticate, limiter('view', 120), customerGate, async (req: Request, res: Response) => {
  try {
    const user = req.user as any;
    const src = cleanProposalSrc(req.query.src);
    await recordAuditLog({ actorUserId: user.userId, action: PROPOSAL_AUDIT.open, targetType: PROPOSAL_AUDIT_TARGET, targetId: user.companyId, details: { src: src || '' }, req });
    const view = await proposalViewFor(user);
    const content = await proposalPageContent(view.state === 'none');
    const phone = view.state === 'none' ? await proposalPrefillPhone(user.userId) : '';
    return res.json({ success: true, view, content, phone });
  } catch (err: any) {
    return fail(err, res, 'view');
  }
});

// ── 담당자: 신청(회사당 한 번) — 이미 신청한 회사는 본문(사진)을 읽기 전에 409 ──
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PROPOSAL_PHOTO_MAX_BYTES, files: PROPOSAL_PHOTO_MAX } });
async function alreadyRequested(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (await proposalTrialExists(String(req.user?.companyId))) {
      res.status(409).json({ success: false, error: '이미 신청하셨어요. 진행 상태를 확인해 주세요.', code: 'PROPOSAL_ALREADY_REQUESTED' });
      return;
    }
    next();
  } catch (err: any) {
    fail(err, res, 'request');
  }
}
function photos(req: Request, res: Response, next: NextFunction): void {
  upload.array('photos', PROPOSAL_PHOTO_MAX)(req, res, (err: any) => {
    if (err) {
      res.status(400).json({ success: false, error: err?.code === 'LIMIT_FILE_SIZE' ? '사진 한 장은 10MB 까지 올릴 수 있어요.' : '사진을 다시 확인해 주세요.', code: 'PHOTO_INVALID' });
      return;
    }
    next();
  });
}
router.post('/request', authenticate, limiter('request', 10), customerGate, alreadyRequested, photos, async (req: Request, res: Response) => {
  try {
    const user = req.user as any;
    const parsed = parseProposalRequest(req.body);
    if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });
    const files = ((req as any).files || []) as Array<{ buffer: Buffer; originalname?: string }>;
    const bad = checkProposalPhotos(files);
    if (bad) return res.status(400).json({ success: false, error: bad, code: 'PHOTO_INVALID' });
    const out = await requestProposalTrial({ ...parsed.value, companyId: user.companyId, userId: user.userId, files });
    if (out === 'exists') return res.status(409).json({ success: false, error: '이미 신청하셨어요. 진행 상태를 확인해 주세요.', code: 'PROPOSAL_ALREADY_REQUESTED' });
    // 제작은 기다리지 않는다(화면은 「만들고 있습니다」로 간다)
    const deps = defaultProduceDeps();
    void deps.alert({ companyId: user.companyId, kind: 'requested' });
    void startProposalProduce(user.companyId, { kind: 'resume' }, deps).catch((err: any) => console.error('[proposal/request] 제작 시작 실패:', err?.message));
    return res.json({ success: true });
  } catch (err: any) {
    return fail(err, res, 'request');
  }
});

// ── 담당자: 「명단만 올려 보내기」가 작성 화면에 채울 값(권한 · 전달 상태를 다시 본다) ──
router.get('/fill', authenticate, limiter('fill', 60), customerGate, async (req: Request, res: Response) => {
  try {
    const n = (v: unknown): number | null => (/^[0-2]$/.test(String(v ?? '')) ? Number(v) : null);
    const copy = n(req.query.copy);
    if (copy === null) return res.status(400).json({ success: false, error: '문안을 골라 주세요.' });
    const fill = await proposalFillFor(req.user as any, { poster: n(req.query.poster), copy, withDm: req.query.dm === '1' });
    if (!fill) return res.status(404).json({ success: false, error: '완성본을 찾을 수 없습니다.', code: 'PROPOSAL_KIT_NOT_FOUND' });
    return res.json({ success: true, fill });
  } catch (err: any) {
    return fail(err, res, 'fill');
  }
});

// ── 직원(슈퍼관리자 「제안 체험」 탭) ──
async function staffGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.setHeader('Cache-Control', GATED_CACHE_CONTROL);
  if (!(await isIntroLeadsViewer(req.user?.userId))) {
    res.status(403).json({ success: false, error: '권한이 없습니다.' });
    return;
  }
  if (req.params.companyId !== undefined && !UUID_RE.test(String(req.params.companyId))) {
    res.status(400).json({ success: false, error: '회사를 찾을 수 없습니다.' });
    return;
  }
  next();
}
const staff = [authenticate, requireSuperAdmin, staffGate] as const;

router.get('/admin', ...staff, async (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, ...(await loadProposalAdmin()) });
  } catch (err: any) {
    return fail(err, res, 'admin');
  }
});

router.get('/admin/:companyId', ...staff, async (req: Request, res: Response) => {
  try {
    const detail = await loadProposalAdminDetail(req.params.companyId);
    if (!detail) return res.status(404).json({ success: false, error: '신청을 찾을 수 없습니다.' });
    return res.json({ success: true, ...detail });
  } catch (err: any) {
    return fail(err, res, 'admin-detail');
  }
});

/** 다시 만들기(전체 · 포스터 한 장 · DM · 검사 다시 · 끊긴 제작 잇기) — 전부 제작의 한 문을 지난다 */
router.post('/admin/:companyId/produce', ...staff, async (req: Request, res: Response) => {
  try {
    const kind = String(req.body?.kind || 'resume');
    const index = Number(req.body?.index);
    const redo: ProposalRedo | null = kind === 'resume' || kind === 'all' || kind === 'dm' || kind === 'spam' ? { kind }
      : kind === 'poster' && Number.isInteger(index) && index >= 0 && index <= 2 ? { kind: 'poster', index } : null;
    if (!redo) return res.status(400).json({ success: false, error: '무엇을 다시 만들지 알 수 없습니다.' });
    const out = await startProposalProduce(req.params.companyId, redo);
    if (out.ok) return res.json({ success: true });
    const text = { none: '신청을 찾을 수 없습니다.', busy: '제작 중입니다. 끝난 뒤 다시 눌러 주세요.', delivered: '이미 전달한 완성본은 다시 만들 수 없습니다.', changed: '그 사이 내용이 바뀌었습니다. 화면을 새로 고쳐 주세요.' }[out.reason];
    return res.status(out.reason === 'none' ? 404 : 409).json({ success: false, error: text, code: `PROPOSAL_${out.reason.toUpperCase()}` });
  } catch (err: any) {
    return fail(err, res, 'produce');
  }
});

router.post('/admin/:companyId/copy', ...staff, async (req: Request, res: Response) => {
  try {
    const out = await editProposalCopy(req.params.companyId, Number(req.body?.revision), Number(req.body?.index), { subject: req.body?.subject, text: req.body?.text });
    if (out === 'ok') return res.json({ success: true });
    return res.status(out === 'invalid' ? 400 : 409).json({ success: false, error: out === 'invalid' ? '문안을 다시 확인해 주세요.' : '그 사이 내용이 바뀌었습니다. 화면을 새로 고쳐 주세요.' });
  } catch (err: any) {
    return fail(err, res, 'copy');
  }
});

router.post('/admin/:companyId/callback', ...staff, async (req: Request, res: Response) => {
  try {
    const out = await setProposalCallback(req.params.companyId, Number(req.body?.revision), req.body?.callback);
    if (out === 'ok') return res.json({ success: true });
    return res.status(out === 'invalid' ? 400 : 409).json({ success: false, error: out === 'invalid' ? '그 회사에 등록된 발신번호만 고를 수 있습니다.' : '그 사이 내용이 바뀌었습니다. 화면을 새로 고쳐 주세요.' });
  } catch (err: any) {
    return fail(err, res, 'callback');
  }
});

router.post('/admin/:companyId/deliver', ...staff, async (req: Request, res: Response) => {
  try {
    const revision = Number(req.body?.revision);
    if (!Number.isInteger(revision) || revision < 0) return res.status(400).json({ success: false, error: '화면을 새로 고쳐 주세요.' });
    const out = await deliverProposalKit(req.params.companyId, String(req.user?.userId), revision);
    if (out.result === 'ok') return res.json({ success: true, notice: out.notice });
    const text = { none: '신청을 찾을 수 없습니다.', not_ready: '확인 대기 상태일 때만 전달할 수 있습니다.', incomplete: '포스터 3장과 문안 3개가 다 있어야 전달할 수 있습니다.', changed: '그 사이 내용이 바뀌었습니다. 화면을 새로 고쳐 다시 확인해 주세요.' }[out.result];
    return res.status(out.result === 'none' ? 404 : 409).json({ success: false, error: text, code: `PROPOSAL_${out.result.toUpperCase()}` });
  } catch (err: any) {
    return fail(err, res, 'deliver');
  }
});

/** 도착 알림 보내기 · 다시 보내기 — tries = 화면이 본 시도 수(둘이 동시에 눌러도 한 요청만 통과) */
router.post('/admin/:companyId/notify', ...staff, async (req: Request, res: Response) => {
  try {
    const tries = Number(req.body?.tries);
    if (!Number.isInteger(tries) || tries < 0) return res.status(400).json({ success: false, error: '화면을 새로 고쳐 주세요.' });
    return res.json({ success: true, notice: await notifyProposalReady(req.params.companyId, tries) });
  } catch (err: any) {
    return fail(err, res, 'notify');
  }
});

export default router;
