/**
 * ★ 2026-11-14 C133 F5 답장 상담 — 운영자(슈퍼관리자)의 서버 길: 상담 번호 · 미배정함 · 직접 등록
 *   (설계서 docs/2026-11-13-hanjul-v3-design.md §7-3 · §18 「배포 D」 흐름 표 12 · 정한 것 7 · 13)
 *
 * 판정 · SQL = utils/inbound-sms.ts(여기는 관문과 응답 꼴만). 번호 행을 지우는 주소는 없다.
 *   · 묶기 = 처음 묶는 번호이거나 전에 그 회사에 묶였던 번호만 · 수동 배정한 번호는 못 묶는다
 *   · 배정 = 미배정 글을 회사로(그 번호가 묶였던 회사가 있으면 그 회사로만 · 없으면 그 번호는 그때부터 수동 배정 전용)
 *   · 직접 등록 = 수신 입구와 같은 함수(receiveInbound) · providerMsgId = manual: + 새 id
 * 표가 없으면(DDL 전) 503 DB_MIGRATION_PENDING.
 */
import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { respondUserError } from '../utils/http-error';
import {
  listInboundNumbers, registerInboundNumber, bindInboundNumber, unbindInboundNumber, listUnassigned, assignInboundMessage, receiveInbound,
} from '../utils/inbound-sms';

const router = Router();
router.use(authenticate, requireSuperAdmin);

type Handler = (req: Request, res: Response, adminId: string | null) => Promise<unknown>;
const guarded = (label: string, work: Handler) => async (req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    const id = String((req.user as any)?.userId || '');
    return await work(req, res, /^[0-9a-f-]{36}$/i.test(id) ? id : null);
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'inbound_numbers')) return;
    if (respondUserError(res, err)) return;
    console.error(`[admin-inbound/${label}] 실패:`, err?.message);
    return res.status(500).json({ success: false, error: '처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' });
  }
};

// GET /overview — 번호 목록 + 미배정 글
router.get('/overview', guarded('overview', async (_req, res) => {
  const [numbers, unassigned] = await Promise.all([listInboundNumbers(), listUnassigned()]);
  return res.json({ success: true, numbers, unassigned, receiveReady: !!String(process.env.INBOUND_SMS_KEY || '') });
}));

// POST /numbers — 번호 등록(안 묶인 채로)
router.post('/numbers', guarded('number-add', async (req, res, adminId) => {
  return res.json({ success: true, ...(await registerInboundNumber(req.body?.number, req.body?.note, adminId)) });
}));

// POST /numbers/bind — 회사에 묶기 { number, companyId }
router.post('/numbers/bind', guarded('number-bind', async (req, res) => {
  await bindInboundNumber(req.body?.number, req.body?.companyId);
  return res.json({ success: true });
}));

// POST /numbers/unbind — 풀기 { number }
router.post('/numbers/unbind', guarded('number-unbind', async (req, res) => {
  if (!(await unbindInboundNumber(req.body?.number))) return res.status(409).json({ success: false, error: '묶여 있지 않은 번호예요.' });
  return res.json({ success: true });
}));

// POST /messages/:id/assign — 미배정 글을 회사로 { companyId }
router.post('/messages/:id/assign', guarded('assign', async (req, res, adminId) => {
  await assignInboundMessage(req.params.id, req.body?.companyId, adminId);
  return res.json({ success: true });
}));

// POST /manual — 직접 등록 { from, to, text }(수신 배선이 정해지기 전의 시험 · 수신 입구와 같은 함수)
router.post('/manual', guarded('manual', async (req, res) => {
  const b = req.body || {};
  const out = await receiveInbound({ from: b.from, to: b.to, text: b.text, providerMsgId: `manual:${randomUUID()}` });
  return res.json({ success: true, assigned: out.assigned });
}));

export default router;
