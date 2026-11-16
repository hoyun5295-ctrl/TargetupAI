/**
 * ★ 2026-11-14 C133 F4 — 나눠 보내기(일회성 캠페인 2단계 배분)의 서버 길
 *   (설계서 docs/2026-11-13-hanjul-v3-design.md §6 · §18 「배포 C-3」).
 *
 * 판정 · SQL · 발송 = utils/campaign-split.ts · campaign-split-rules.ts(여기는 관문과 응답 꼴만).
 * 관문 = 로그인 → 고객사 계정 → 단계 개방(v3Live 'split') · 차감 · 발송에 닿는 주소(시작 · 이어 보내기)는 서버 요금제 문(aiZonePlanBlocked)도.
 *   닫힌 회사 = `/status` 가 live:false 한 줄 · 나머지 주소는 403.
 *   시작 요청 버리기(`/:id/discard`)만 단계 개방을 보지 않는다 — 보낸 요청의 끝(시작됨 · 닫힘)은 기능이 닫힌 뒤에도 서버가 답해야 화면의 잠금이 풀린다(발송 0 · 차감 0).
 * 표가 없으면(DDL 전) 503 DB_MIGRATION_PENDING.
 * 시작 = 요청 하나가 값 전부를 싣는다(캠페인 생성 · 발송 요청을 따로 부르지 않는다) · 화면이 만든 id 가 나눠 보내기 id(두 번 눌러도 한 번).
 */
import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { respondUserError } from '../utils/http-error';
import { v3Live } from '../utils/v3-stage';
import { aiZonePlanBlocked } from '../utils/plan-guard';
import { checkSenderAuthGate, senderAuthRejection } from '../utils/sender-auth';
import {
  planSplit, createSplit, discardSplitStart, advanceSplit, stopSplit, resumeSplit, readSplit, listSplits, normalizeSplitId,
  type SplitCtx, type SplitStartInput,
} from '../utils/campaign-split';
import { SPLIT_PCTS, SPLIT_WAITS, SPLIT_WAIT_LABEL, splitVariantLabel } from '../utils/campaign-split-rules';

const router = Router();
router.use(authenticate);

const ctxOf = (req: Request): SplitCtx | null => {
  const u = req.user as any;
  return u?.companyId && u?.userId ? { companyId: String(u.companyId), userId: String(u.userId), userType: String(u.userType || '') } : null;
};

type Handler = (req: Request, res: Response, ctx: SplitCtx) => Promise<unknown>;
/** 관문 + 오류 꼴을 한 번만 적는다 */
const guarded = (label: string, work: Handler, stageGate = true) => async (req: Request, res: Response) => {
  try {
    const ctx = ctxOf(req);
    if (!ctx) return res.status(403).json({ success: false, error: '고객사 권한이 필요합니다.' });
    if (stageGate && !(await v3Live('split', ctx.companyId))) {
      return res.status(403).json({ success: false, code: 'V3_STAGE_CLOSED', error: '이 기능을 쓸 수 없습니다.' });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    return await work(req, res, ctx);
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'campaign_split_tests')) return;
    if (respondUserError(res, err)) return;
    console.error(`[campaign-split/${label}] 실패:`, err?.message);
    return res.status(500).json({ success: false, error: '나눠 보내기를 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' });
  }
};

const inputOf = (body: any): SplitStartInput => ({
  id: String(body?.id ?? ''),
  name: String(body?.name ?? ''),
  msgType: String(body?.msgType ?? ''),
  callback: String(body?.callback ?? ''),
  isAd: body?.isAd === true,
  scheduledAt: body?.scheduledAt ? String(body.scheduledAt) : null,
  targetFilter: body?.targetFilter && typeof body.targetFilter === 'object' ? body.targetFilter : {},
  variants: Array.isArray(body?.variants) ? body.variants.slice(0, 10).map((v: any) => ({ text: String(v?.text ?? ''), subject: v?.subject == null ? null : String(v.subject) })) : [],
  pct: Number(body?.pct),
  wait: String(body?.wait ?? ''),
});

// GET /status — 토글을 그릴지(닫힌 회사 = live:false 한 줄) · 고를 수 있는 값
router.get('/status', async (req: Request, res: Response) => {
  try {
    const ctx = ctxOf(req);
    const live = !!ctx && await v3Live('split', ctx.companyId);
    res.setHeader('Cache-Control', 'private, no-store');
    if (!live) return res.json({ success: true, live: false });
    return res.json({ success: true, live: true, pcts: SPLIT_PCTS, waits: SPLIT_WAITS.map((code) => ({ code, label: SPLIT_WAIT_LABEL[code] })) });
  } catch (err: any) {
    console.error('[campaign-split/status] 실패:', err?.message);
    return res.json({ success: true, live: false });   // 모르면 그리지 않는다
  }
});

// POST /preview — 확인 창의 값(대상 수 · 문안별 인원 · 나머지 · 시각 · 비용) · 못 쓰면 이유(화면의 잠금 이유 = 이 글자)
router.post('/preview', guarded('preview', async (req, res, ctx) => {
  const plan = await planSplit(ctx, inputOf(req.body));
  return res.json({
    success: true,
    total: plan.total, perVariant: plan.sizes.perVariant, testTotal: plan.sizes.testTotal, rest: plan.sizes.rest,
    labels: plan.variants.map((_, i) => splitVariantLabel(i)),
    startAt: plan.startAt.toISOString(), decideAt: plan.decideAt.toISOString(), scheduled: !!plan.scheduledAt,
    unitPrice: plan.unitPrice, estimate: plan.estimate, prepaid: plan.prepaid, balance: plan.balance,
  });
}));

// POST / — 시작(같은 id 의 두 번째 요청 = 새로 만들지 않고 있는 것을 돌려준다)
router.post('/', guarded('start', async (req, res, ctx) => {
  if (await aiZonePlanBlocked(req, res)) return;   // 서버 요금제 문(AI 한줄로와 같은 문) — 차감 · 발송에 닿기 전
  const input = inputOf(req.body);
  const id = normalizeSplitId(input.id);
  const existing = await readSplit(ctx, id);
  if (existing) return res.json({ success: true, created: false, split: existing });
  const plan = await planSplit(ctx, { ...input, id });
  // 발신 인증(전송자격인증 3.5) — 전체 인원으로 한 번 · 차감 · 행 생성보다 앞(나머지 묶음은 워커가 보낸다 = 요청이 없다)
  const gate = await checkSenderAuthGate({ req, userId: ctx.userId, companyId: ctx.companyId, callback: plan.callback, useIndividualCallback: false, recipientCount: plan.total });
  if (!gate.ok) return res.status(403).json(senderAuthRejection(gate));
  const { created } = await createSplit(ctx, id, plan);
  // 실행은 만든 요청만 부른다(같은 id 의 다른 요청이 먼저 만들었으면 그 요청 · 워커가 이어 한다).
  //   만든 뒤의 실행 오류는 시작을 되돌리지 않는다(워커가 같은 함수로 이어 한다) — 지금 상태를 그대로 돌려준다
  const outcome = created
    ? await advanceSplit(id).catch((e: any) => { console.error(`[campaign-split/start] 첫 실행 실패 split=${id}:`, e?.message || e); return 'error' as const; })
    : 'none' as const;
  const split = await readSplit(ctx, id);
  // 내 것이 아닌 id(다른 담당자가 만든 것) = 없는 것과 같게
  if (!split) return res.status(409).json({ success: false, code: 'SPLIT_ID', error: '요청 값이 올바르지 않아요. 창을 닫았다가 다시 열어 주세요.' });
  return res.json({ success: true, created, outcome, split });
}));

// POST /:id/discard — 화면이 보낸 시작 요청을 버린다(이미 만들어졌으면 그것을 돌려준다 = 시작된 것 · 없으면 그 id 를 닫는다)
router.post('/:id/discard', guarded('discard', async (req, res, ctx) => {
  return res.json({ success: true, split: await discardSplitStart(ctx, req.params.id) });
}, false));

// GET / — 최근 나눠 보내기(담당자 = 자기 것 · 관리자 = 회사 전체)
router.get('/', guarded('list', async (_req, res, ctx) => {
  return res.json({ success: true, splits: await listSplits(ctx) });
}));

// GET /:id — 요약 창
router.get('/:id', guarded('read', async (req, res, ctx) => {
  const split = await readSplit(ctx, req.params.id);
  if (!split) return res.status(404).json({ success: false, error: '나눠 보내기를 찾을 수 없습니다.' });
  return res.json({ success: true, split });
}));

// POST /:id/stop — 여기서 그만(남은 묶음을 보내지 않는다 · 이미 나간 묶음은 일반 캠페인 그대로)
router.post('/:id/stop', guarded('stop', async (req, res, ctx) => {
  if (!(await stopSplit(ctx, req.params.id))) {
    return res.status(409).json({ success: false, code: 'SPLIT_NOT_STOPPABLE', error: '지금은 멈출 수 없어요. 이미 끝났거나 나머지를 보내는 중이에요.' });
  }
  return res.json({ success: true, split: await readSplit(ctx, req.params.id) });
}));

// POST /:id/resume — 이어 보내기(막힌 것만 · 못 나간 묶음부터 같은 고정 대상으로)
router.post('/:id/resume', guarded('resume', async (req, res, ctx) => {
  if (await aiZonePlanBlocked(req, res)) return;   // 서버 요금제 문 — 이어 보내기도 차감 · 발송에 닿는다
  if (!(await resumeSplit(ctx, req.params.id))) {
    return res.status(409).json({ success: false, code: 'SPLIT_NOT_BLOCKED', error: '이어 보낼 수 있는 상태가 아니에요.' });
  }
  const outcome = await advanceSplit(req.params.id).catch((e: any) => { console.error(`[campaign-split/resume] 실행 실패 split=${req.params.id}:`, e?.message || e); return 'error' as const; });
  return res.json({ success: true, outcome, split: await readSplit(ctx, req.params.id) });
}));

export default router;
