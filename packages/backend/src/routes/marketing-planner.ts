/**
 * routes/marketing-planner.ts — 마케팅 플래너 API (★ 2026-08-12 Phase 1 · ★ 2026-10-04 보강: 재료 · 행사별 확인 · 행사별 승인)
 *
 * 설계서 = docs/2026-10-04-planner-material-approval-design.md (흐름 §4 · 화면 §5 · 서버 §6 · 돈 §7)
 * 판정 규칙은 전부 CT가 소유한다 — 이 파일은 부르고 오류를 HTTP로 옮기기만 한다(인라인 판정 금지):
 *   `marketing-planner`(기입 검증) · `planner-channel-gate`(준비 판정) · `planner-event`(행사·재료 저장) · `planner-build`(완성본 생성) ·
 *   `planner-copy`(문자 문안) · `planner-confirm`(확인 본문·지문·견적·링크) · `planner-approve`(승인·승인 풀기·행사 취소) ·
 *   `planner-calendar`(캘린더 조립) · `planner-review`(되돌림·링크·승인 직후 스팸) · `planner-approval`(월 대행 원장·월 취소) · `planner-executor`(다시 시작).
 *
 * ⚠ 승인은 **돈을 움직이는 쓰기 경로**다 — 그 순서와 멱등은 CT가 소유한다.
 * ⛔ 사용자 범위(§3-10) = 관리자 회사 전체 · 담당자 자기 행사(resolveOwnerScope).
 * ⛔ `planner_events.meta`가 없으면(배포 뒤 DDL 전) 새 흐름 endpoint는 503 `DB_MIGRATION_PENDING`(db_alter_safety_net · requirePlannerMeta).
 */
import { userErrorResponse, respondUserError } from '../utils/http-error';
import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { resolveOwnerScope } from '../utils/owner-scope';
import { aiZonePlanBlocked } from '../utils/plan-guard';
import { InsufficientCreditError } from '../utils/ai-credit';
import { aiAutoBuildErrorResponse } from '../utils/ai-auto-build-materials';
import { parsePlannerEventInput, parsePlanMonth, isPlannerDay, PLANNER_CHANNEL_LABEL } from '../utils/marketing-planner';
import { getPlannerChannelAvailability, firstBlockedChannel } from '../utils/planner-channel-gate';
import { cancelMonthlyApproval, resolveApprovalToken, PlannerApprovalError } from '../utils/planner-approval';
import { loadTouchpointById, requirePlannerMeta } from '../utils/planner-touchpoint';
import { deletePlannerEvent, loadPlannerEvent, normalizePlannerAudience, normalizePlannerMaterials, savePlannerEvent, PlannerEventWriteError, PlannerMaterials } from '../utils/planner-event';
import { countPlannerAudience, countPlannerEmailRecipients, loadPlannerLineAskContext, plannerLineEnabled, verifyPlannerAudience } from '../utils/planner-audience';
import { confirmLineAudience, plannerLineAsk, plannerLineEventBody, readPlannerLine, type PlannerLineRead } from '../utils/planner-line-read';
import { currentPurchaseDoor, listObservedProducts } from '../utils/journey-product';
import { quotePlannerBuild, quotePlannerDraft, runPlannerBuild, PlannerBuildError } from '../utils/planner-build';
import { editPlannerCopy, runPlannerCopyPass, PlannerCopyEditError } from '../utils/planner-copy';
import { buildConfirmView, resolvePlannerPreviewToken } from '../utils/planner-confirm';
import { approvePlannerEvent, unapprovePlannerEvent, cancelPlannerEvent, PlannerApproveError } from '../utils/planner-approve';
import { buildPlannerCalendar } from '../utils/planner-calendar';
import { kickPlannerReview, runPostApprovalSpamPass } from '../utils/planner-review';
import { kickPlannerTouchpointNow, resumePlannerTouchpoint } from '../utils/planner-executor';
import { PlannerRecheckError, approvePlannerPairTx, buildRecheckView, deferPlannerPairTx, editPlannerPairCopyTx, kickPlannerRecheck, loadRecheckPair, skipPlannerPairTx } from '../utils/planner-recheck';
import { loadMonthlyResult } from '../utils/planner-report';
import { renderJoinLandingHtml, verifyJoinToken } from '../utils/planner-participation';

const router = Router();

// ────────────────────────────────────────────────────────────────────
// GET /api/marketing-planner/participate/:token — 참여 신청 착지 (인증 전 · 고객이 이메일에서 온다)
//
// ⛔ 여기서 참여를 적재하지 않는다. 수신자 식별은 **이메일 클릭 실측**(email_events: 캠페인+주소)이 하고,
//    참여 이벤트 투영은 그 실측을 읽는 스위퍼가 한다(planner-participation). 이 화면은 확인만 한다.
// ⛔ 고객용 화면이라 JSON·503을 보여주지 않는다. 실패도 안내 화면으로 답한다.
// ────────────────────────────────────────────────────────────────────
router.get('/participate/:token', async (req: Request, res: Response) => {
  const payload = verifyJoinToken(String(req.params.token || ''));
  if (!payload) {
    res.status(200).type('html').send(renderJoinLandingHtml({ ok: false }));
    return;
  }
  let title: string | null = null;
  try {
    const r = await query(
      `SELECT title FROM planner_events WHERE id = $1::uuid AND company_id = $2::uuid`,
      [payload.e, payload.c],
    );
    title = r.rows[0]?.title ? String(r.rows[0].title) : null;
  } catch (error: any) {
    // 표·컬럼 미생성(배포 불일치)도 고객에게는 안내 화면이다. 모니터링이 구분할 표식만 로그에 남긴다.
    const migrationPending = String(error?.code || '') === '42P01' || String(error?.code || '') === '42703';
    console.error(`플래너 참여 착지 조회 실패${migrationPending ? ' [DB_MIGRATION_PENDING]' : ''}:`, error?.message || error);
  }
  res.status(200).type('html').send(renderJoinLandingHtml({ ok: true, eventTitle: title }));
});

// ────────────────────────────────────────────────────────────────────
// GET /api/marketing-planner/approval/:token — 옛 월간 결재 문자 링크 착지 (인증 전)
// ★ 2026-10-04 월간 결재 폐지 — 옛 링크는 그 달 캘린더로 보낸다(설계서 §5-5). 토큰은 어느 달인지만 정한다.
// ────────────────────────────────────────────────────────────────────
router.get('/approval/:token', async (req: Request, res: Response) => {
  try {
    const resolved = await resolveApprovalToken(String(req.params.token || ''));
    if (!resolved) return res.redirect('/marketing-planner?link=expired');
    return res.redirect(`/marketing-planner?month=${encodeURIComponent(resolved.planMonth)}`);
  } catch (error: any) {
    const migrationPending = String(error?.code || '') === '42P01' || String(error?.code || '') === '42703';
    console.error(`플래너 옛 결재 링크 처리 실패${migrationPending ? ' [DB_MIGRATION_PENDING]' : ''}:`, error?.message || error);
    return res.redirect('/marketing-planner?link=error');
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/marketing-planner/confirm-view — 휴대폰 확인 화면(공개 · 로그인 없음 · 설계서 §5-3 · §6-4)
//
// ⛔ 토큰은 주소 # 뒤에 있고 화면이 이 요청 **본문**으로 넘긴다 — 서버 접근 로그·Referer로 새지 않는다(GET 쿼리 금지).
// ⛔ 토큰은 미리보기 권한일 뿐 승인 권한이 아니다(승인 = 로그인 · D3). 공개 본문에는 잔액을 싣지 않는다.
// ⛔ 열어 본다고 토큰이 사라지지 않는다(D2 · 문자 앱 미리보기).
// ────────────────────────────────────────────────────────────────────
router.post('/confirm-view', async (req: Request, res: Response) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  try {
    await requirePlannerMeta();
    const ev = await resolvePlannerPreviewToken(String(req.body?.token || ''));
    if (!ev) {
      return res.status(410).json({
        error: '확인 링크가 만료됐거나 내용이 바뀌어 더 이상 열 수 없습니다. 최신 내용은 한줄로 마케팅 플래너에서 확인해 주세요.',
        code: 'LINK_EXPIRED',
      });
    }
    return res.json(await buildConfirmView(ev, { mode: 'public' }));
  } catch (error: any) {
    if (handleDbMigrationError(error, res, 'planner_events')) return;
    console.error('플래너 공개 확인 화면 실패:', error?.message || error);
    if (respondUserError(res, error)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ error: '확인 화면을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.' });
  }
});

router.use(authenticate);

function requireCompany(req: Request, res: Response): string | null {
  const companyId = req.user?.companyId;
  if (!companyId) {
    res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    return null;
  }
  return companyId;
}

/** CT 오류 → HTTP(코드가 화면 분기의 축). 처리했으면 true. */
function sendPlannerError(err: any, res: Response, table: string, fallback: string): Response | void {
  if (err instanceof PlannerApproveError || err instanceof PlannerBuildError || err instanceof PlannerEventWriteError || err instanceof PlannerCopyEditError || err instanceof PlannerRecheckError) {
    return res.status(err.status).json({ error: err.message, code: err.code, ...((err as any).extra || {}) });
  }
  if (err instanceof PlannerApprovalError) return res.status(err.status).json({ error: err.message, code: err.code });
  // ★ 2026-10-25 사용자 조건 오류 · 원장 쓰기 실패(503 · 발행비 · 완성비 성공 뒤 차감 한 규칙)
  const ue = userErrorResponse(err);
  if (ue) return res.status(ue.status).json({ error: ue.body.error, code: ue.body.code });
  const mapped = aiAutoBuildErrorResponse(err);
  if (mapped) return res.status(mapped.status).json({ ...mapped.body, error: mapped.body.error });
  if (err instanceof InsufficientCreditError) {
    return res.status(402).json({ error: '크레딧이 부족합니다. 충전한 뒤 다시 시도해 주세요.', code: 'INSUFFICIENT_CREDIT' });
  }
  if (handleDbMigrationError(err, res, table)) return;
  console.error(`[marketing-planner] ${fallback}:`, err?.message || err);
  return res.status(500).json({ error: `${fallback}. 잠시 후 다시 시도해 주세요.` });
}

// GET /api/marketing-planner/availability — 채널 준비 판정 + 예상 크레딧 (기입 창의 채널 칸 소스 · 1차 = 문자·DM·메일)
router.get('/availability', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    const channels = await getPlannerChannelAvailability(companyId, req.user?.userId || null);
    return res.json({ channels: channels.map((c) => ({ ...c, label: PLANNER_CHANNEL_LABEL[c.channel] })) });
  } catch (error: any) {
    console.error('플래너 채널 가용성 조회 실패:', error);
    if (respondUserError(res, error)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ error: '채널 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

// GET /api/marketing-planner/events?month=YYYY-MM — 캘린더 한 달(행사 · 접점 · 화면 상태 · 할 일 · 머리 숫자 · 공휴일)
router.get('/events', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const planMonth = parsePlanMonth(req.query.month);
  if (!planMonth) return res.status(400).json({ error: '볼 달을 골라 주세요.' });
  try {
    await requirePlannerMeta();
    return res.json(await buildPlannerCalendar(companyId, planMonth, resolveOwnerScope(req)));
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_events', '캘린더를 불러오지 못했습니다');
  }
});

/** 기입 본문의 재료 — 없으면 undefined(재료 그대로) · 형식이 틀리면 오류 문장. */
function readMaterials(body: any, companyId: string): { ok: true; value: PlannerMaterials | undefined } | { ok: false; error: string } {
  if (body?.materials === undefined) return { ok: true, value: undefined };
  return normalizePlannerMaterials(body.materials, companyId);
}

/** 행사 저장 — body = 담기 창 본문(기본) · 한 줄 담기가 만든 본문(같은 판정을 그대로 지난다) */
async function saveEvent(req: Request, res: Response, eventId?: string, body: any = req.body) {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const parsed = parsePlannerEventInput(body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const materials = readMaterials(body, companyId);
  if (!materials.ok) return res.status(400).json({ error: materials.error, code: 'MATERIALS_INVALID' });
  // ★ 2026-10-18 받는 사람 = 저장 본문에 꼭 있어야 한다(칸이 빠졌다고 조용히 전체로 받지 않는다 · 설계서 §3-6)
  const aud = normalizePlannerAudience(body?.audience);
  if (!aud.ok) return res.status(400).json({ error: aud.error, code: 'AUDIENCE_REQUIRED' });
  try {
    await requirePlannerMeta();
    const verified = await verifyPlannerAudience(companyId, aud.value);
    if (!verified.ok) return res.status(verified.status).json({ error: verified.error, code: verified.code });
    // 잠긴 채널은 서버에서도 거른다 — 화면 체크박스 상태를 신뢰하지 않는다(재료 창 · 승인 · 발송 당일 같은 함수 · F2).
    const blocked = await firstBlockedChannel(parsed.value.touchpoints.map((t) => t.channel), {
      companyId, userId: req.user?.userId || null, phase: 'plan',
    });
    if (blocked) {
      return res.status(400).json({
        error: `${PLANNER_CHANNEL_LABEL[blocked.channel]}: ${blocked.readiness.reason}`,
        code: 'CHANNEL_LOCKED', channel: blocked.channel, settingsPath: blocked.readiness.settingsPath,
      });
    }
    const saved = await savePlannerEvent({
      companyId, userId: req.user?.userId || null, ownerId: resolveOwnerScope(req),
      value: parsed.value, planMonth: parsed.planMonth, materials: materials.value, audience: verified.value, eventId,
    });
    // 문자만 있는 행사는 곧바로 문안 준비에 들어간다(best-effort · 놓치면 대조 워커가 집는다).
    void runPlannerCopyPass({ companyId, eventId: saved.id }).catch(() => null);
    return res.status(eventId ? 200 : 201).json({ id: saved.id, month: parsed.planMonth, changed: saved.changed });
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_events', '행사를 저장하지 못했습니다');
  }
}

// ── ★ 2026-10-18 v2 입력 축(설계서 docs/2026-10-18-planner-v2-design.md §3-6 · 회사 스위치 PLANNER_LINE_COMPANY_IDS) ──
const LINE_CLOSED = { error: '이 기능은 아직 열리지 않았습니다.', code: 'FEATURE_DISABLED' };

/** 한 줄 → 읽기 + 그 회사 사정(구매자 제안 = 관측 상품명으로 확정 · ★ Codex B 3R · 4R) — 읽기 · 담기가 같은 함수 */
async function readLineForCompany(req: Request, companyId: string, line: string, nowMs: number) {
  const read: PlannerLineRead = readPlannerLine(line, nowMs);
  const ctx = await loadPlannerLineAskContext(companyId, req.user?.userId || null);
  read.audience = confirmLineAudience(read.audience, ctx.products ? ctx.products.list.map((p) => p.name) : null);
  return { read, ctx };
}

// POST /api/marketing-planner/line-read — 한 줄 → 읽은 칸 + 못 읽은 칸만 질문표(AI 0 · 0크레딧 · ★ 1024 뿌리 대장 R9)
router.post('/line-read', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  if (!plannerLineEnabled(companyId)) return res.status(404).json(LINE_CLOSED);
  const line = String(req.body?.line || '').trim();
  if (!line) return res.status(400).json({ error: '한 줄을 입력해 주세요.' });
  try {
    const { read, ctx } = await readLineForCompany(req, companyId, line, Date.now());
    return res.json({ ...read, ...plannerLineAsk(read, ctx) });
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_events', '한 줄을 읽지 못했습니다');
  }
});

// POST /api/marketing-planner/line-start — 한 줄 + 답 → 행사 담기(질문표는 서버가 다시 만든다 · 저장 판정 = 담기 창과 같은 saveEvent)
router.post('/line-start', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  if (!plannerLineEnabled(companyId)) return res.status(404).json(LINE_CLOSED);
  const line = String(req.body?.line || '').trim();
  if (!line) return res.status(400).json({ error: '한 줄을 입력해 주세요.' });
  const answers = req.body?.answers && typeof req.body.answers === 'object' && !Array.isArray(req.body.answers) ? req.body.answers : {};
  try {
    const nowMs = Date.now();
    const { read, ctx } = await readLineForCompany(req, companyId, line, nowMs);
    // 화면이 본 질문 창 = 지금 다시 만든 창이어야 저장한다(다르면 새 창으로 다시 묻는다 · 답을 조용히 버리지 않는다)
    const ask = plannerLineAsk(read, ctx);
    if (String(req.body?.askKey || '') !== ask.askKey) {
      return res.status(409).json({ error: '그 사이 상품이나 채널 사정이 바뀌었어요. 바뀐 질문을 확인하고 다시 담아 주세요.', code: 'LINE_CHANGED', read: { ...read, ...ask } });
    }
    const built = plannerLineEventBody(read, answers, ctx, nowMs);
    if (!built.ok) return res.status(400).json({ error: built.error, code: 'LINE_ANSWER_INVALID' });
    return saveEvent(req, res, undefined, built.body);
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_events', '행사를 담지 못했습니다');
  }
});

// GET /api/marketing-planner/audience/products — 대상 상품 목록(그 회사 지금 문 · 최근 180일 관측 · 여정과 같은 함수)
router.get('/audience/products', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  if (!plannerLineEnabled(companyId)) return res.status(404).json(LINE_CLOSED);
  try {
    const door = await currentPurchaseDoor(companyId);
    const list = await listObservedProducts(companyId, door);
    return res.json({ door, ...list });
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_events', '상품 목록을 불러오지 못했습니다');
  }
});

// POST /api/marketing-planner/audience/count — 담기 창 인원(문자 · 메일 · 실행과 같은 문 · 새 행사 = 요청 계정 · 기존 행사 = 만든 계정 범위)
router.post('/audience/count', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const aud = normalizePlannerAudience(req.body?.audience);
  if (!aud.ok) return res.status(400).json({ error: aud.error, code: 'AUDIENCE_REQUIRED' });
  try {
    await requirePlannerMeta();
    const verified = await verifyPlannerAudience(companyId, aud.value);
    if (!verified.ok) return res.status(verified.status).json({ error: verified.error, code: verified.code });
    let createdBy: string | null = req.user?.userId || null;
    let eventId = '';
    if (req.body?.eventId) {
      const ev = await loadPlannerEvent(companyId, String(req.body.eventId), resolveOwnerScope(req));
      if (!ev) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });
      createdBy = ev.createdBy;
      eventId = ev.id;
    }
    const [sms, email] = await Promise.all([
      countPlannerAudience({ companyId, createdBy, mode: 'all', plannerEventId: eventId, audience: verified.value })
        .then((r) => (r.blocked ? { state: 'blocked', count: null, reason: r.reason } : { state: 'known', count: r.count }))
        .catch(() => ({ state: 'error', count: null })),
      countPlannerEmailRecipients({ companyId, createdBy, plannerEventId: eventId, audience: verified.value }),
    ]);
    return res.json({ sms, email });
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_events', '받는 사람 수를 세지 못했습니다');
  }
});

// POST /api/marketing-planner/events — 행사 담기(재료 함께 가능)
router.post('/events', (req, res) => { void saveEvent(req, res); });
// PUT /api/marketing-planner/events/:id — 고치기(승인 전만 · 접점은 (채널·시점) upsert · 내용이 바뀌면 새 리비전)
router.put('/events/:id', (req, res) => { void saveEvent(req, res, String(req.params.id)); });

// DELETE /api/marketing-planner/events/:id — 승인 전 · 발송 0건 행사만 지운다(승인한 행사는 취소)
router.delete('/events/:id', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    if (!(await deletePlannerEvent(companyId, String(req.params.id), resolveOwnerScope(req)))) {
      return res.status(409).json({ error: '승인 전이고 완성본을 만드는 중이 아닌 행사만 지울 수 있습니다. 승인한 행사는 [행사 취소]로 멈춰 주세요.', code: 'NOT_DELETABLE' });
    }
    return res.json({ deleted: true });
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_events', '행사를 지우지 못했습니다');
  }
});

// POST /api/marketing-planner/build-quote — 담기 전 견적(기입 창 버튼 금액 · 저장 0 · 차감 0)
router.post('/build-quote', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const materials = normalizePlannerMaterials(req.body?.materials, companyId);
  if (!materials.ok) return res.status(400).json({ error: materials.error, code: 'MATERIALS_INVALID' });
  const channels = (Array.isArray(req.body?.channels) ? req.body.channels : []).filter((c: any) => c === 'dm' || c === 'email');
  if (channels.length === 0) return res.json({ quotes: [], total: 0 });
  const startsOn = isPlannerDay(req.body?.startsOn) ? String(req.body.startsOn) : '';
  const endsOn = isPlannerDay(req.body?.endsOn) ? String(req.body.endsOn) : startsOn;
  if (!startsOn) return res.status(400).json({ error: '행사 기간을 선택해 주세요.' });
  try {
    const quotes = await quotePlannerDraft({
      companyId, userId: req.user?.userId || null, channels, materials: materials.value,
      draft: {
        title: String(req.body?.title || '').trim().slice(0, 120) || '행사',
        startsOn, endsOn,
        benefitText: String(req.body?.benefitText || '').trim().slice(0, 300) || null,
      },
    });
    return res.json({ quotes, total: quotes.reduce((s, q) => s + q.total, 0) });
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_events', '견적을 내지 못했습니다');
  }
});

// POST /api/marketing-planner/events/:id/build-quote — 완성본 생성 견적(채널별 · 차감 0)
router.post('/events/:id/build-quote', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    await requirePlannerMeta();
    const channels = (Array.isArray(req.body?.channels) ? req.body.channels : []).filter((c: any) => c === 'dm' || c === 'email');
    if (channels.length === 0) return res.status(400).json({ error: '만들 채널을 골라 주세요.' });
    const quotes = await quotePlannerBuild({ companyId, eventId: String(req.params.id), ownerId: resolveOwnerScope(req), channels });
    return res.json({ quotes, total: quotes.reduce((s, q) => s + q.total, 0) });
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_events', '견적을 내지 못했습니다');
  }
});

// POST /api/marketing-planner/events/:id/build — [담고 만들기] 채널 1개(화면 발급 attemptToken + 화면이 본 expectedTotal)
router.post('/events/:id/build', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const channel = req.body?.channel;
  if (channel !== 'dm' && channel !== 'email') return res.status(400).json({ error: '만들 채널을 골라 주세요.' });
  if (await aiZonePlanBlocked(req, res)) return;   // ★ 2026-10-24 R2 — 생성비를 쓰는 주소 = 서버 요금제 문
  try {
    await requirePlannerMeta();
    const r = await runPlannerBuild({
      companyId, userId: req.user?.userId || null, ownerId: resolveOwnerScope(req), eventId: String(req.params.id),
      channel, attemptToken: String(req.body?.attemptToken || ''), expectedTotal: Number(req.body?.expectedTotal) || 0,
    });
    // 소재가 다 모였으면 문안 준비로(best-effort · 대조 워커가 그물)
    void runPlannerCopyPass({ companyId, eventId: String(req.params.id) }).catch(() => null);
    return res.json({ channel: r.channel, draftId: r.draftId, reused: r.reused });
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_events', '완성본을 만들지 못했습니다');
  }
});

// PUT /api/marketing-planner/events/:id/copy — 문자 문안 고치기(승인 전 · 검사는 문안 패스가 · §5-3)
router.put('/events/:id/copy', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    await requirePlannerMeta();
    await editPlannerCopy({
      companyId, ownerId: resolveOwnerScope(req), eventId: String(req.params.id),
      touchpointId: String(req.body?.touchpointId || ''), text: String(req.body?.text ?? ''),
      subject: req.body?.subject === undefined ? undefined : String(req.body.subject ?? ''),
    });
    kickPlannerReview(companyId, String(req.params.id));
    return res.json({ status: 'checking' });
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_touchpoints', '문안을 저장하지 못했습니다');
  }
});

// GET /api/marketing-planner/events/:id/confirm-view — 행사 상세(로그인판 확인 화면 · 잔액 포함)
router.get('/events/:id/confirm-view', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    await requirePlannerMeta();
    const ev = await loadPlannerEvent(companyId, String(req.params.id), resolveOwnerScope(req));
    if (!ev) return res.status(404).json({ error: '행사를 찾을 수 없습니다.', code: 'NOT_FOUND' });
    return res.json(await buildConfirmView(ev, { mode: 'member' }));
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_events', '행사 내용을 불러오지 못했습니다');
  }
});

// POST /api/marketing-planner/events/:id/approve — 행사 승인(화면이 본 지문 seenHash + 표시 금액 shownTotal · §6-5)
router.post('/events/:id/approve', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  if (await aiZonePlanBlocked(req, res)) return;   // ★ 2026-10-24 R2 — 대행료 · 발행비 · 발송 = 서버 요금제 문
  try {
    await requirePlannerMeta();
    const r = await approvePlannerEvent({
      companyId, userId: req.user?.userId || null, ownerId: resolveOwnerScope(req), eventId: String(req.params.id),
      seenHash: String(req.body?.seenHash || ''), shownTotal: Number(req.body?.shownTotal) || 0,
    });
    // 승인 직후 실주소 스팸 — 요청 안에서 돌리지 않는다(수 분 · 504 재클릭 차단 · H7). 놓치면 대조 워커가 집는다.
    if (!r.already) void runPostApprovalSpamPass({ companyId, eventId: String(req.params.id) }).catch(() => null);
    return res.json(r);
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_events', '승인하지 못했습니다');
  }
});

// POST /api/marketing-planner/events/:id/unapprove — 승인 풀기(첫 발송 전 · 환불·재차감 0)
router.post('/events/:id/unapprove', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    await requirePlannerMeta();
    return res.json(await unapprovePlannerEvent({ companyId, ownerId: resolveOwnerScope(req), eventId: String(req.params.id) }));
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_events', '승인을 풀지 못했습니다');
  }
});

// POST /api/marketing-planner/events/:id/cancel — 행사 취소(남은 발송 중지 · 발행비·완성비 비환불 · §6-9)
router.post('/events/:id/cancel', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    await requirePlannerMeta();
    return res.json(await cancelPlannerEvent({
      companyId, userId: req.user?.userId || null, ownerId: resolveOwnerScope(req), eventId: String(req.params.id),
    }));
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_events', '행사를 취소하지 못했습니다');
  }
});

// POST /api/marketing-planner/touchpoints/:id/resume — [다시 시작](보류·잠금 → 발송 대기 · 쌍이면 함께)
router.post('/touchpoints/:id/resume', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  // ★ 2026-10-24 R2 — 다시 진행 = 발송을 다시 켠다 → 서버 요금제 문(끄기 · 건너뛰기 · 미루기는 문 없음 · 한 줄 CT 구조체크 ②)
  if (await aiZonePlanBlocked(req, res)) return;
  try {
    const tp = await loadTouchpointById(companyId, String(req.params.id));
    const ownerId = resolveOwnerScope(req);
    if (!tp || (ownerId && tp.createdBy !== ownerId)) return res.status(404).json({ error: '해당 항목을 찾을 수 없습니다.' });
    const outcome = await resumePlannerTouchpoint(tp);
    if (outcome === 'hold_credit') {
      return res.status(402).json({ error: '크레딧이 아직 부족합니다. 충전 후 다시 시도해 주세요.', code: 'INSUFFICIENT_CREDIT' });
    }
    // ⛔ 효과가 없었으면 성공으로 답하지 않는다(6원칙 ②).
    if (outcome === 'unresumable') {
      return res.status(409).json({ error: '지금 상태에서는 다시 시작할 수 없습니다. 표시된 사유를 확인해 주세요.', code: 'NOT_RESUMABLE' });
    }
    return res.json({ status: outcome });
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_touchpoints', '다시 시작하지 못했습니다');
  }
});

// ── ★ 2026-10-18 쌍 재확인(PC 할 일 · 설계서 docs/2026-10-18-planner-v2-design.md §3-2) ─────────────
// 링크 화면과 같은 본문 함수 · 같은 CT · 로그인 MFA 세션 안이라 인증번호는 걸지 않는다(M5). 확인 창은 화면이 띄운다(Harold 1018 ①).
const recheckActor = (req: Request) => ({ userId: req.user?.userId || null, via: 'pc' as const, ownerScope: resolveOwnerScope(req) });

// GET /api/marketing-planner/touchpoints/:id/recheck — 재확인 화면 본문(로그인판)
router.get('/touchpoints/:id/recheck', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    await requirePlannerMeta();
    const p = await loadRecheckPair(companyId, String(req.params.id));
    const ownerId = resolveOwnerScope(req);
    if (!p || (ownerId && p.ev.createdBy !== ownerId)) return res.status(404).json({ error: '다시 정할 발송을 찾을 수 없습니다. 이미 처리됐을 수 있어요.', code: 'NOT_FOUND' });
    return res.json(await buildRecheckView(p, { mode: 'member' }));
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_touchpoints', '재확인 내용을 불러오지 못했습니다');
  }
});

// POST /api/marketing-planner/touchpoints/:id/recheck/approve — [새 문안으로 보내기] · [고친 문안으로 보내기]
router.post('/touchpoints/:id/recheck/approve', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  if (await aiZonePlanBlocked(req, res)) return;   // ★ 2026-10-24 R2 — 발송 = 서버 요금제 문
  try {
    await requirePlannerMeta();
    const r = await approvePlannerPairTx({
      companyId, carrierId: String(req.params.id), round: Number(req.body?.round),
      choice: req.body?.choice === 'current' ? 'current' : 'proposal', seenHash: String(req.body?.seenHash || ''), actor: recheckActor(req),
    });
    if (r.sendsAt === 'now') kickPlannerTouchpointNow(companyId, r.carrierId);
    return res.json(r);
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_touchpoints', '보내기를 정하지 못했습니다');
  }
});

// POST /api/marketing-planner/touchpoints/:id/recheck/edit — [직접 고치기](검사는 재확인 패스가)
router.post('/touchpoints/:id/recheck/edit', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    await requirePlannerMeta();
    const r = await editPlannerPairCopyTx({
      companyId, carrierId: String(req.params.id), round: Number(req.body?.round), text: String(req.body?.text ?? ''),
      subject: req.body?.subject === undefined ? undefined : String(req.body.subject ?? ''), actor: recheckActor(req),
    });
    kickPlannerRecheck(companyId, String(req.params.id));
    return res.json(r);
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_touchpoints', '문안을 저장하지 못했습니다');
  }
});

// POST /api/marketing-planner/touchpoints/:id/recheck/skip — [오늘만 건너뛰기]
router.post('/touchpoints/:id/recheck/skip', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    await requirePlannerMeta();
    return res.json(await skipPlannerPairTx({ companyId, carrierId: String(req.params.id), round: Number(req.body?.round), actor: recheckActor(req) }));
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_touchpoints', '건너뛰지 못했습니다');
  }
});

// POST /api/marketing-planner/touchpoints/:id/recheck/defer — [미루기](행사 기간 안 · 그날 다른 문자 없는 날)
router.post('/touchpoints/:id/recheck/defer', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    await requirePlannerMeta();
    const r = await deferPlannerPairTx({
      companyId, carrierId: String(req.params.id), round: Number(req.body?.round), toDate: String(req.body?.toDate || ''), actor: recheckActor(req),
    });
    kickPlannerRecheck(companyId, String(req.params.id));
    return res.json(r);
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_touchpoints', '미루지 못했습니다');
  }
});

// GET /api/marketing-planner/brief/:month/result — 이달 결과(실측 집계)
router.get('/brief/:month/result', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const planMonth = parsePlanMonth(req.params.month);
  if (!planMonth) return res.status(400).json({ error: '볼 달을 골라 주세요.' });
  try {
    return res.json(await loadMonthlyResult(companyId, planMonth, resolveOwnerScope(req)));
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_touchpoints', '이달 결과를 불러오지 못했습니다');
  }
});

// POST /api/marketing-planner/brief/:month/cancel — 월 대행 취소(그 달 발송 시도 0건이면 대행료 전액 환불 · 관리자만)
router.post('/brief/:month/cancel', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const planMonth = parsePlanMonth(req.params.month);
  if (!planMonth) return res.status(400).json({ error: '대상 달을 골라 주세요.' });
  // 월 대행 취소는 회사 전체 행사를 멈춘다 — 회사 관리자만(§3-10).
  if (resolveOwnerScope(req) !== null) return res.status(403).json({ error: '월 대행 취소는 회사 관리자만 할 수 있습니다.', code: 'ADMIN_ONLY' });
  try {
    return res.json(await cancelMonthlyApproval(companyId, planMonth, req.user?.userId || null));
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_monthly_approvals', '월 대행을 취소하지 못했습니다');
  }
});

export default router;
