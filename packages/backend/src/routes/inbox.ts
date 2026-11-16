/**
 * ★ 2026-11-14 C133 F5 답장 상담 — 고객사 상담함의 서버 길
 *   (설계서 docs/2026-11-13-hanjul-v3-design.md §7-5 · §18 「배포 D」 흐름 표 10 · 11)
 *
 * 판정 · SQL · 발송 = utils/inbound-sms.ts(여기는 관문과 응답 꼴만).
 * 관문 = 로그인 → 회사 관리자 → 단계 개방(v3Live 'inbox') · 차감 · 발송에 닿는 주소(사람 답장)는 서버 요금제 문(aiZonePlanBlocked)도. 담당자 계정 · 닫힌 회사 = `/status` 가 live:false 한 줄 · 나머지 주소는 403.
 * 발신 인증(전송자격인증 3.5)은 요청이 있는 두 자리 = 설정 저장(결과가 자동 답장일 때) · 사람 답장. CT 가 넘겨받은 gate 를 그 번호로 부른다.
 * 표가 없으면(DDL 전) 503 DB_MIGRATION_PENDING.
 */
import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { respondUserError } from '../utils/http-error';
import { v3Live } from '../utils/v3-stage';
import { aiZonePlanBlocked } from '../utils/plan-guard';
import { checkSenderAuthGate, senderAuthRejection } from '../utils/sender-auth';
import {
  inboxStatus, listThreads, readThread, humanReply, readHumanReply, discardHumanReply, closeInbound, readInboundSettings, saveInboundSettings, listKbItems, saveKbItem, deleteKbItem,
  type InboundCtx, type SenderGate,
} from '../utils/inbound-sms';
import { INBOUND_KB_MAX_ITEMS, INBOUND_KB_TITLE_MAX, INBOUND_KB_BODY_MAX, INBOUND_HANDOFF_MAX, INBOUND_HUMAN_REPLY_MAX, INBOUND_COMPANY_DAILY_DEFAULT, INBOUND_AUTO_HOURS } from '../utils/inbound-sms-rules';

const router = Router();
router.use(authenticate);

/** 회사 관리자만(받은 글에는 주인 사용자가 없다 = 담당자 계정에는 상담함이 없다) */
const ctxOf = (req: Request): InboundCtx | null => {
  const u = req.user as any;
  return u?.userType === 'company_admin' && u?.companyId && u?.userId ? { companyId: String(u.companyId), userId: String(u.userId) } : null;
};

type Handler = (req: Request, res: Response, ctx: InboundCtx) => Promise<unknown>;
/** 관문 + 오류 꼴을 한 번만 적는다 */
const guarded = (label: string, work: Handler) => async (req: Request, res: Response) => {
  try {
    const ctx = ctxOf(req);
    if (!ctx) return res.status(403).json({ success: false, error: '회사 관리자만 쓸 수 있습니다.' });
    if (!(await v3Live('inbox', ctx.companyId))) {
      return res.status(403).json({ success: false, code: 'V3_STAGE_CLOSED', error: '이 기능을 쓸 수 없습니다.' });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    return await work(req, res, ctx);
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'inbound_messages')) return;
    if (respondUserError(res, err)) return;
    console.error(`[inbox/${label}] 실패:`, err?.message);
    return res.status(500).json({ success: false, error: '상담함을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' });
  }
};

/** 발신 인증 — 그 요청의 세션으로 · CT 가 정한 번호로(받는 사람 1) */
const gateOf = (req: Request, ctx: InboundCtx): SenderGate => async (callback) => {
  const gate = await checkSenderAuthGate({ req, userId: ctx.userId, companyId: ctx.companyId, callback, useIndividualCallback: false, recipientCount: 1 });
  return gate.ok ? { ok: true } : { ok: false, rejection: senderAuthRejection(gate) };
};

// GET /status — 헤더 메뉴 · 「상담 번호 넣기」 단추를 그릴지(닫힌 회사 · 담당자 = live:false 한 줄)
router.get('/status', async (req: Request, res: Response) => {
  try {
    const ctx = ctxOf(req);
    const live = !!ctx && await v3Live('inbox', ctx.companyId);
    res.setHeader('Cache-Control', 'private, no-store');
    if (!live || !ctx) return res.json({ success: true, live: false });
    return res.json({ success: true, live: true, ...(await inboxStatus(ctx.companyId)) });
  } catch (err: any) {
    console.error('[inbox/status] 실패:', err?.message);
    return res.json({ success: true, live: false });   // 모르면 그리지 않는다
  }
});

// GET /threads?filter=human|all — 대화 목록 + 위쪽 숫자 넷
router.get('/threads', guarded('threads', async (req, res, ctx) => {
  const filter = req.query.filter === 'all' ? 'all' : 'human';
  return res.json({ success: true, ...(await listThreads(ctx.companyId, filter)) });
}));

// GET /threads/:key — 대화 하나(열쇠 = 그 대화의 받은 글 id)
router.get('/threads/:key', guarded('thread', async (req, res, ctx) => {
  const thread = await readThread(ctx.companyId, req.params.key);
  if (!thread) return res.status(404).json({ success: false, error: '대화를 찾을 수 없습니다.' });
  return res.json({ success: true, thread });
}));

// POST /messages/:id/reply — 사람 답장 { replyId, text } (화면이 만든 replyId 가 답장 행 id = 두 번 눌러도 한 번)
router.post('/messages/:id/reply', guarded('reply', async (req, res, ctx) => {
  if (await aiZonePlanBlocked(req, res)) return;   // 서버 요금제 문 — 답장은 차감 · 발송에 닿는다
  const out = await humanReply(ctx, req.params.id, req.body?.replyId, req.body?.text, gateOf(req, ctx));
  if (!out.done) return res.status(403).json(out.rejection);
  return res.json({ success: true, outcome: out.outcome, reply: out.reply });
}));

// GET /replies/:replyId — 화면이 그 답장의 끝을 묻는다(있으면 그 행 · 없으면 404)
router.get('/replies/:replyId', guarded('reply-read', async (req, res, ctx) => {
  const reply = await readHumanReply(ctx, req.params.replyId);
  if (!reply) return res.status(404).json({ success: false, error: '답장을 찾을 수 없습니다.' });
  return res.json({ success: true, reply });
}));

// POST /messages/:id/reply-discard — 화면이 보낸 답장 요청을 버린다 { replyId }(이미 있으면 그 행 = 나갔거나 접수된 것 · 없으면 그 id 를 닫는다)
router.post('/messages/:id/reply-discard', guarded('reply-discard', async (req, res, ctx) => {
  return res.json({ success: true, reply: await discardHumanReply(ctx, req.params.id, req.body?.replyId) });
}));

// POST /messages/:id/close — 답 없이 닫기(사람 필요인 글만)
router.post('/messages/:id/close', guarded('close', async (req, res, ctx) => {
  if (!(await closeInbound(ctx, req.params.id))) return res.status(409).json({ success: false, error: '닫을 수 있는 상태가 아니에요.' });
  return res.json({ success: true });
}));

// GET /settings — 설정 + 답변 항목 + 화면이 보여 줄 한도
router.get('/settings', guarded('settings', async (_req, res, ctx) => {
  const [settings, items, status] = await Promise.all([readInboundSettings(ctx.companyId), listKbItems(ctx.companyId), inboxStatus(ctx.companyId)]);
  return res.json({
    success: true, settings, items, numbers: status.numbers,
    limits: {
      kbItems: INBOUND_KB_MAX_ITEMS, kbTitle: INBOUND_KB_TITLE_MAX, kbBody: INBOUND_KB_BODY_MAX, handoff: INBOUND_HANDOFF_MAX, reply: INBOUND_HUMAN_REPLY_MAX,
      dailyDefault: INBOUND_COMPANY_DAILY_DEFAULT, autoFrom: INBOUND_AUTO_HOURS.start, autoTo: INBOUND_AUTO_HOURS.end,
    },
  });
}));

// PUT /settings — 저장(결과가 「켬 ∧ 바로 답장」이면 그 답장 발신번호로 발신 인증)
router.put('/settings', guarded('settings-save', async (req, res, ctx) => {
  const b = req.body || {};
  const out = await saveInboundSettings(ctx, {
    enabled: b.enabled, mode: b.mode, replyCallback: b.replyCallback, dailyCap: b.dailyCap, notifyPhone: b.notifyPhone, handoffText: b.handoffText,
  }, gateOf(req, ctx));
  if (!out.saved) return res.status(403).json(out.rejection);
  return res.json({ success: true, settings: out.settings });
}));

// POST /kb — 답변 항목 새로 · PUT /kb/:id — 고치기 · DELETE /kb/:id — 지우기
router.post('/kb', guarded('kb-add', async (req, res, ctx) => {
  const b = req.body || {};
  return res.json({ success: true, item: await saveKbItem(ctx, { title: b.title, body: b.body, enabled: b.enabled, sort: b.sort }) });
}));
router.put('/kb/:id', guarded('kb-save', async (req, res, ctx) => {
  const b = req.body || {};
  return res.json({ success: true, item: await saveKbItem(ctx, { id: req.params.id, title: b.title, body: b.body, enabled: b.enabled, sort: b.sort }) });
}));
router.delete('/kb/:id', guarded('kb-delete', async (req, res, ctx) => {
  if (!(await deleteKbItem(ctx, req.params.id))) return res.status(404).json({ success: false, error: '답변 항목을 찾을 수 없습니다.' });
  return res.json({ success: true });
}));

export default router;
