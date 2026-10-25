/**
 * routes/planner-recheck-public.ts — 플래너 당일 재확인 담당자 링크(★ 2026-10-18 · 무로그인 · 설계서 docs/2026-10-18-planner-v2-design.md §3-2-4)
 *
 *   GET  /api/planner-recheck/view         — 화면 본문(쌍 · 원래 문안 · 새 문안 · DM · 받는 사람 · 할 수 있는 일 · 인증 상태)
 *   POST /api/planner-recheck/auth/verify  — 인증번호 확인(통지를 받은 계정 · 로그인 경로와 같은 응답 CT)
 *   POST /api/planner-recheck/approve      — [새 문안으로 보내기] · [고친 문안으로 보내기](인증번호)
 *   POST /api/planner-recheck/edit         — [직접 고치기](인증번호)
 *   POST /api/planner-recheck/skip         — [오늘만 건너뛰기](인증번호 없음 · 멈춘 쌍만)
 *   POST /api/planner-recheck/defer        — [미루기](인증번호 없음 · 새 날짜도 다시 보내기 승인을 지난다)
 *   POST /api/planner-recheck/cancel       — [행사 취소](인증번호 · 되돌릴 수 없음 · Harold 1018 「모바일로 취소도」)
 *
 * ⛔ 토큰은 헤더(X-Planner-Recheck-Token)로만 · 주소엔 # 뒤 · 무효는 같은 410(무엇이 틀렸는지 알려주지 않는다).
 * ⛔ 판정 · 효과는 전부 CT(planner-recheck · sender-auth · planner-approve) — 이 파일은 부르고 HTTP 로 옮긴다.
 * ⛔ 보내기 · 고치기 · 취소 = 통지를 받은 계정 · 휴대폰 번호 = 인증 번호 · 회사 스위치 · 기기에 묶인 인증(`checkStrictSenderAuth` · 통과로 접지 않는다).
 */
import { aiZonePlanBlockedFor } from '../utils/plan-guard';
import { respondUserError } from '../utils/http-error';
import { Router, Request, Response } from 'express';
import {
  PLANNER_RECHECK_TOKEN_HEADER, PlannerRecheckError, RecheckPair, approvePlannerPairTx, buildRecheckView, deferPlannerPairTx,
  editPlannerPairCopyTx, kickPlannerRecheck, resolveRecheckLinkActor, resolveRecheckToken, skipPlannerPairTx,
} from '../utils/planner-recheck';
import { checkStrictSenderAuth, senderAuthDeviceProof, senderAuthRejection, senderAuthVerifyResponse, verifySenderAuthChallenge, isSenderAuthSchemaMissing } from '../utils/sender-auth';
import { cancelPlannerEvent, PlannerApproveError } from '../utils/planner-approve';
import { kickPlannerTouchpointNow } from '../utils/planner-executor';
import { loadPlannerDefaultCallback } from '../utils/planner-copy';
import { requirePlannerMeta } from '../utils/planner-touchpoint';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { recordAuditLog } from '../utils/audit-log';

const router = Router();

const GONE = { success: false, code: 'LINK_EXPIRED', error: '이 주소는 마감됐거나 내용이 바뀌어 더 열 수 없습니다. 최신 내용은 한줄로 마케팅 플래너 캘린더에서 확인해 주세요.' };

function noStore(res: Response) {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
}

function sendError(err: any, res: Response, fallback: string): Response | void {
  if (err instanceof PlannerRecheckError || err instanceof PlannerApproveError) {
    return res.status(err.status).json({ success: false, error: err.message, code: err.code, ...((err as any).extra || {}) });
  }
  // ★ 2026-10-25 사용자 조건 오류 · 원장 쓰기 실패(503)
  if (respondUserError(res, err)) return;
  if (isSenderAuthSchemaMissing(err)) return res.status(503).json({ success: false, code: 'DB_MIGRATION_PENDING', error: 'DB 마이그레이션 필요: sender_auth_challenges 생성 요청' });
  if (handleDbMigrationError(err, res, 'planner_touchpoints')) return;
  console.error(`[planner-recheck] ${fallback}:`, err?.message || err);
  return res.status(500).json({ success: false, error: `${fallback}. 잠시 후 다시 시도해 주세요.` });
}

/** 헤더 토큰 → 열린 쌍(아니면 410 응답을 보내고 null) */
async function openPair(req: Request, res: Response): Promise<RecheckPair | null> {
  await requirePlannerMeta();
  const r = await resolveRecheckToken(String(req.headers[PLANNER_RECHECK_TOKEN_HEADER] || ''));
  if (!r || r.kind !== 'open') { res.status(410).json(GONE); return null; }
  return r.pair;
}

/**
 * 보내기 · 고치기 · 취소 앞 — 링크 권한(열 때마다 다시) + 기기에 묶인 인증. 통과 = 행위자 · 아니면 응답을 보내고 null.
 * 인증이 없으면 인증번호를 그 계정 MFA 번호로 보내고 403 SENDER_AUTH_REQUIRED(화면이 인증 창을 띄우고 같은 동작을 다시 보낸다).
 */
async function actingUser(req: Request, res: Response, p: RecheckPair): Promise<{ userId: string; ownerScope: string | null } | null> {
  const actor = await resolveRecheckLinkActor(p);
  if (!actor.canAct || !actor.userId) {
    res.status(403).json({ success: false, code: 'LINK_ACTION_PC_ONLY', error: actor.reason || '이 일은 PC 한줄로에서 하실 수 있어요.' });
    return null;
  }
  const callback = await loadPlannerDefaultCallback(p.ev.companyId);
  const auth = await checkStrictSenderAuth({ req: { ip: req.ip, headers: req.headers }, userId: actor.userId, companyId: p.ev.companyId, callback });
  if (!auth.ok) {
    if ('blocked' in auth) {
      res.status(403).json({ success: false, code: 'LINK_ACTION_PC_ONLY', error: '계정에 인증 휴대폰 번호가 없어 이 일은 PC 한줄로에서 하실 수 있어요.' });
      return null;
    }
    res.status(403).json(senderAuthRejection(auth.gate));
    return null;
  }
  return { userId: actor.userId, ownerScope: actor.ownerScope };
}

const audit = (req: Request, p: RecheckPair, action: string, userId: string | null, details: Record<string, unknown> = {}) =>
  void recordAuditLog({ actorUserId: userId, action, targetType: 'planner_touchpoint', targetId: p.carrier.id, details: { event: p.ev.id, date: p.recheck.date, round: p.recheck.round, ...details }, req });

router.get('/view', async (req: Request, res: Response) => {
  noStore(res);
  try {
    await requirePlannerMeta();
    const r = await resolveRecheckToken(String(req.headers[PLANNER_RECHECK_TOKEN_HEADER] || ''));
    if (!r) return res.status(410).json(GONE);
    if (r.kind === 'closed') return res.json({ success: true, closed: { outcome: r.outcome, at: r.at, title: r.title, date: r.date } });
    return res.json({ success: true, view: await buildRecheckView(r.pair, { mode: 'public', req: { ip: req.ip, headers: req.headers } }) });
  } catch (err: any) {
    return sendError(err, res, '화면을 불러오지 못했습니다');
  }
});

router.post('/auth/verify', async (req: Request, res: Response) => {
  noStore(res);
  try {
    const p = await openPair(req, res);
    if (!p) return;
    const actor = await resolveRecheckLinkActor(p);
    if (!actor.canAct || !actor.userId) return res.status(403).json({ success: false, code: 'LINK_ACTION_PC_ONLY', error: actor.reason || '이 일은 PC 한줄로에서 하실 수 있어요.' });
    const { challengeId, code } = req.body || {};
    if (!challengeId || !code) return res.status(400).json({ success: false, error: '인증번호를 입력해주세요.' });
    const verdict = await verifySenderAuthChallenge({ challengeId: String(challengeId), userId: actor.userId, code: String(code), req });
    const out = senderAuthVerifyResponse(verdict);
    // ★ Codex A 1R — 인증번호를 확인한 **이 기기**에만 기기 증명을 준다(화면이 헤더로 들고 다닌다 · 링크를 전달받은 다른 기기는 없다)
    if (verdict.status === 'ok' && verdict.challengeId && verdict.verifiedAt) {
      try { out.body.device = senderAuthDeviceProof(verdict.challengeId, verdict.verifiedAt); } catch { /* 키 없음 = 증명 없음 = 엄격판이 막는다 */ }
    }
    return res.status(out.status).json(out.body);
  } catch (err: any) {
    return sendError(err, res, '인증을 확인하지 못했습니다');
  }
});

router.post('/approve', async (req: Request, res: Response) => {
  noStore(res);
  try {
    const p = await openPair(req, res);
    if (!p) return;
    const who = await actingUser(req, res, p);
    if (!who) return;
    if (await aiZonePlanBlockedFor(p.ev.companyId, { userId: who.userId }, res)) return;   // ★ 2026-10-25 원장 #55 — PC [보내기]와 같은 요금제 문
    const choice = req.body?.choice === 'current' ? 'current' : 'proposal';
    const r = await approvePlannerPairTx({
      companyId: p.ev.companyId, carrierId: p.carrier.id, round: Number(p.recheck.round), choice, seenHash: String(req.body?.seenHash || ''),
      actor: { userId: who.userId, via: 'link', ownerScope: who.ownerScope, tokenHash: p.recheck.tokenHash || null },
    });
    if (r.sendsAt === 'now') kickPlannerTouchpointNow(p.ev.companyId, r.carrierId);
    audit(req, p, 'planner_link_approve', who.userId, { choice });
    return res.json({ success: true, ...r });
  } catch (err: any) {
    return sendError(err, res, '보내기를 정하지 못했습니다');
  }
});

router.post('/edit', async (req: Request, res: Response) => {
  noStore(res);
  try {
    const p = await openPair(req, res);
    if (!p) return;
    const who = await actingUser(req, res, p);
    if (!who) return;
    const r = await editPlannerPairCopyTx({
      companyId: p.ev.companyId, carrierId: p.carrier.id, round: Number(p.recheck.round), text: String(req.body?.text ?? ''),
      subject: req.body?.subject === undefined ? undefined : String(req.body.subject ?? ''),
      actor: { userId: who.userId, via: 'link', ownerScope: who.ownerScope, tokenHash: p.recheck.tokenHash || null },
    });
    kickPlannerRecheck(p.ev.companyId, p.carrier.id);
    audit(req, p, 'planner_link_edit', who.userId);
    return res.json({ success: true, ...r });
  } catch (err: any) {
    return sendError(err, res, '문안을 저장하지 못했습니다');
  }
});

router.post('/skip', async (req: Request, res: Response) => {
  noStore(res);
  try {
    const p = await openPair(req, res);
    if (!p) return;
    const r = await skipPlannerPairTx({
      companyId: p.ev.companyId, carrierId: p.carrier.id, round: Number(p.recheck.round),
      actor: { userId: p.recheck.notifiedUserId || null, via: 'link', ownerScope: null, tokenHash: p.recheck.tokenHash || null },
    });
    audit(req, p, 'planner_link_skip', p.recheck.notifiedUserId || null);
    return res.json({ success: true, ...r });
  } catch (err: any) {
    return sendError(err, res, '건너뛰지 못했습니다');
  }
});

router.post('/defer', async (req: Request, res: Response) => {
  noStore(res);
  try {
    const p = await openPair(req, res);
    if (!p) return;
    const r = await deferPlannerPairTx({
      companyId: p.ev.companyId, carrierId: p.carrier.id, round: Number(p.recheck.round), toDate: String(req.body?.toDate || ''),
      actor: { userId: p.recheck.notifiedUserId || null, via: 'link', ownerScope: null, tokenHash: p.recheck.tokenHash || null },
    });
    kickPlannerRecheck(p.ev.companyId, p.carrier.id);
    audit(req, p, 'planner_link_defer', p.recheck.notifiedUserId || null, { to: r.to });
    return res.json({ success: true, ...r });
  } catch (err: any) {
    return sendError(err, res, '미루지 못했습니다');
  }
});

router.post('/cancel', async (req: Request, res: Response) => {
  noStore(res);
  try {
    const p = await openPair(req, res);
    if (!p) return;
    const who = await actingUser(req, res, p);
    if (!who) return;
    // ★ Codex A 2R — 토큰 대조는 취소 트랜잭션 안에서(월 원장 → 행사 → 캐리어 행 잠금 순서 그대로 · 한 커밋 · 회차가 넘어간 옛 토큰 = 410)
    const hash = String(p.recheck.tokenHash || '');
    if (!hash) return res.status(410).json(GONE);
    const r = await cancelPlannerEvent({
      companyId: p.ev.companyId, userId: who.userId, ownerId: who.ownerScope, eventId: p.ev.id,
      linkGuard: { touchpointId: p.carrier.id, tokenHash: hash, round: Number(p.recheck.round) },
    });
    audit(req, p, 'planner_link_cancel', who.userId, { skipped: r.skipped });
    return res.json({ success: true, ...r });
  } catch (err: any) {
    return sendError(err, res, '행사를 취소하지 못했습니다');
  }
});

export default router;
