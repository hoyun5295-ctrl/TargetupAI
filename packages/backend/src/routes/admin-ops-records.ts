/**
 * 운영 기록 대장 라우트 (★2026-10-03 전송자격인증 3.1 ④ · 3.3 · 4.3) — 판정 · 저장은 `utils/ops-records.ts` 가 소유한다.
 *
 * 권한 = 슈퍼관리자 + 등급표 `opsRecords`(조회 = 전 등급 · 작성 · 확인 = 대표 · 지원팀장).
 * 무효 처리 = 대표 등급(`super`)만(★2026-10-03 · 지우지 않고 무효 기록을 쌓는다 · 판정은 CT).
 */
import { Request, Response, Router } from 'express';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import { fetchAdminRole, canRead, canWrite } from '../utils/admin-role';
import {
  OpsRecordError, validateOpsRecord, loadOpsActor, createOpsRecord, confirmOpsRecord, listOpsRecords,
  buildHanjulLogReviewSummary, currentKstMonth, voidOpsRecords,
} from '../utils/ops-records';

const router = Router();
router.use(authenticate, requireSuperAdmin);

function sendError(res: Response, err: any, tag: string) {
  if (err instanceof OpsRecordError) return res.status(err.http).json({ error: err.message });
  console.error(`[ops-records] ${tag}`, err);
  return res.status(500).json({ error: '운영 기록을 처리하지 못했습니다.' });
}

/** 화면 게이팅 — 볼 수 있는가 · 쓸 수 있는가 · 나는 누구인가 */
router.get('/meta', async (req: Request, res: Response) => {
  try {
    const role = await fetchAdminRole(req.user?.userId);
    const me = await loadOpsActor(req.user?.userId);
    return res.json({
      canRead: canRead(role, 'opsRecords'),
      canWrite: canWrite(role, 'opsRecords'),
      canVoid: role === 'super',
      me: me ? { id: me.id, loginId: me.loginId, name: me.name } : null,
      currentMonth: currentKstMonth(),
      // ★Codex 2R — 화면의 「지금」 기본값 · 입력 상한은 이 서버 시각으로 만든다(브라우저 시계가 빠르면 정상 입력이 거절된다)
      serverNow: new Date().toISOString(),
    });
  } catch (err) {
    return sendError(res, err, 'meta');
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const role = await fetchAdminRole(req.user?.userId);
    if (!canRead(role, 'opsRecords')) return res.status(403).json({ error: '운영 기록을 볼 수 있는 등급이 아닙니다.' });
    const records = await listOpsRecords({
      kind: typeof req.query.kind === 'string' ? req.query.kind : null,
      system: typeof req.query.system === 'string' ? req.query.system : null,
      limit: Number(req.query.limit) || 100,
      includeVoided: req.query.includeVoided === '1',
    });
    return res.json({ records });
  } catch (err) {
    return sendError(res, err, 'list');
  }
});

/** 한줄로 월간 점검 자료 미리보기 — 저장할 때는 서버가 다시 세어 기록에 얼린다 */
router.get('/log-review-summary', async (req: Request, res: Response) => {
  try {
    const role = await fetchAdminRole(req.user?.userId);
    if (!canWrite(role, 'opsRecords')) return res.status(403).json({ error: '운영 기록을 작성할 수 있는 등급이 아닙니다.' });
    const month = String(req.query.month || '');
    if (month > currentKstMonth()) return res.status(400).json({ error: '점검 대상 월은 이번 달보다 뒤일 수 없습니다.' });
    return res.json({ summary: await buildHanjulLogReviewSummary(month) });
  } catch (err) {
    return sendError(res, err, 'summary');
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const role = await fetchAdminRole(req.user?.userId);
    if (!canWrite(role, 'opsRecords')) return res.status(403).json({ error: '운영 기록을 작성할 수 있는 등급이 아닙니다.' });
    const actor = await loadOpsActor(req.user?.userId);
    if (!actor) return res.status(403).json({ error: '관리자 계정을 확인하지 못했습니다.' });
    const input = validateOpsRecord(req.body);
    const saved = await createOpsRecord({ input, actor, req });
    return res.status(201).json({ id: saved.id, createdAt: saved.createdAt });
  } catch (err) {
    return sendError(res, err, 'create');
  }
});

router.post('/:id/confirm', async (req: Request, res: Response) => {
  try {
    const role = await fetchAdminRole(req.user?.userId);
    if (!canWrite(role, 'opsRecords')) return res.status(403).json({ error: '운영 기록을 확인할 수 있는 등급이 아닙니다.' });
    const actor = await loadOpsActor(req.user?.userId);
    if (!actor) return res.status(403).json({ error: '관리자 계정을 확인하지 못했습니다.' });
    const done = await confirmOpsRecord({ recordId: String(req.params.id || ''), actor, comment: req.body?.comment, req });
    return res.json({ confirmedAt: done.confirmedAt });
  } catch (err) {
    return sendError(res, err, 'confirm');
  }
});

/** 무효 처리 — 대표 등급만 · 확인 전 기록만 · 사유 필수 · 여러 건은 전부 되거나 전부 안 된다 */
router.post('/void', async (req: Request, res: Response) => {
  try {
    const role = await fetchAdminRole(req.user?.userId);
    if (role !== 'super') return res.status(403).json({ error: '무효 처리는 대표 등급만 할 수 있습니다.' });
    const actor = await loadOpsActor(req.user?.userId);
    if (!actor) return res.status(403).json({ error: '관리자 계정을 확인하지 못했습니다.' });
    const done = await voidOpsRecords({ recordIds: req.body?.ids, reason: req.body?.reason, actor, req });
    return res.json(done);
  } catch (err) {
    return sendError(res, err, 'void');
  }
});

export default router;
