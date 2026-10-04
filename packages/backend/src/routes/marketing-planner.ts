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
import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { resolveOwnerScope } from '../utils/owner-scope';
import { InsufficientCreditError } from '../utils/ai-credit';
import { aiAutoBuildErrorResponse } from '../utils/ai-auto-build-materials';
import { parsePlannerEventInput, parsePlanMonth, isPlannerDay, PLANNER_CHANNEL_LABEL } from '../utils/marketing-planner';
import { getPlannerChannelAvailability, firstBlockedChannel } from '../utils/planner-channel-gate';
import { cancelMonthlyApproval, resolveApprovalToken, PlannerApprovalError } from '../utils/planner-approval';
import { loadTouchpointById, requirePlannerMeta } from '../utils/planner-touchpoint';
import { loadPlannerEvent, normalizePlannerMaterials, savePlannerEvent, PlannerEventWriteError, PlannerMaterials } from '../utils/planner-event';
import { quotePlannerBuild, quotePlannerDraft, runPlannerBuild, PlannerBuildError } from '../utils/planner-build';
import { editPlannerCopy, runPlannerCopyPass, PlannerCopyEditError } from '../utils/planner-copy';
import { buildConfirmView, resolvePlannerPreviewToken } from '../utils/planner-confirm';
import { approvePlannerEvent, unapprovePlannerEvent, cancelPlannerEvent, PlannerApproveError } from '../utils/planner-approve';
import { buildPlannerCalendar } from '../utils/planner-calendar';
import { kickPlannerReview, runPostApprovalSpamPass } from '../utils/planner-review';
import { resumePlannerTouchpoint } from '../utils/planner-executor';
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
  if (err instanceof PlannerApproveError || err instanceof PlannerBuildError || err instanceof PlannerEventWriteError || err instanceof PlannerCopyEditError) {
    return res.status(err.status).json({ error: err.message, code: err.code, ...((err as any).extra || {}) });
  }
  if (err instanceof PlannerApprovalError) return res.status(err.status).json({ error: err.message, code: err.code });
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
    return res.status(500).json({ error: '채널 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

// GET /api/marketing-planner/events?month=YYYY-MM — 캘린더 한 달(행사 · 접점 · 화면 상태 · 할 일 · 머리 숫자 · 공휴일)
router.get('/events', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const planMonth = parsePlanMonth(req.query.month);
  if (!planMonth) return res.status(400).json({ error: '조회할 달을 지정해 주세요. (YYYY-MM)' });
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

async function saveEvent(req: Request, res: Response, eventId?: string) {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const parsed = parsePlannerEventInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const materials = readMaterials(req.body, companyId);
  if (!materials.ok) return res.status(400).json({ error: materials.error, code: 'MATERIALS_INVALID' });
  try {
    await requirePlannerMeta();
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
      value: parsed.value, planMonth: parsed.planMonth, materials: materials.value, eventId,
    });
    // 문자만 있는 행사는 곧바로 문안 준비에 들어간다(best-effort · 놓치면 대조 워커가 집는다).
    void runPlannerCopyPass({ companyId, eventId: saved.id }).catch(() => null);
    return res.status(eventId ? 200 : 201).json({ id: saved.id, month: parsed.planMonth, changed: saved.changed });
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_events', '행사를 저장하지 못했습니다');
  }
}

// POST /api/marketing-planner/events — 행사 담기(재료 함께 가능)
router.post('/events', (req, res) => { void saveEvent(req, res); });
// PUT /api/marketing-planner/events/:id — 고치기(승인 전만 · 접점은 (채널·시점) upsert · 내용이 바뀌면 새 리비전)
router.put('/events/:id', (req, res) => { void saveEvent(req, res, String(req.params.id)); });

// DELETE /api/marketing-planner/events/:id — 승인 전 · 발송 0건 행사만 지운다(승인한 행사는 취소)
router.delete('/events/:id', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    const ownerId = resolveOwnerScope(req);
    const del = await query(
      `DELETE FROM planner_events e
        WHERE e.id = $1::uuid AND e.company_id = $2::uuid AND e.status IN ('draft', 'briefed')
          AND ($3::text IS NULL OR e.created_by::text = $3::text)
          AND (e.meta->'building' IS NULL OR jsonb_typeof(e.meta->'building') <> 'object'
               OR (e.meta->'building'->>'at')::timestamptz < NOW() - interval '10 minutes')
          AND NOT EXISTS (SELECT 1 FROM planner_touchpoints t WHERE t.event_id = e.id AND t.company_id = e.company_id
                           AND (t.status IN ('sent', 'producing') OR t.exec_ref IS NOT NULL))
        RETURNING e.id`,
      [String(req.params.id), companyId, ownerId],
    );
    if (del.rows.length === 0) {
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

// GET /api/marketing-planner/brief/:month/result — 이달 결과(실측 집계)
router.get('/brief/:month/result', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const planMonth = parsePlanMonth(req.params.month);
  if (!planMonth) return res.status(400).json({ error: '조회할 달을 지정해 주세요. (YYYY-MM)' });
  try {
    return res.json(await loadMonthlyResult(companyId, planMonth));
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_touchpoints', '이달 결과를 불러오지 못했습니다');
  }
});

// POST /api/marketing-planner/brief/:month/cancel — 월 대행 취소(그 달 발송 시도 0건이면 대행료 전액 환불 · 관리자만)
router.post('/brief/:month/cancel', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const planMonth = parsePlanMonth(req.params.month);
  if (!planMonth) return res.status(400).json({ error: '대상 달을 지정해 주세요. (YYYY-MM)' });
  // 월 대행 취소는 회사 전체 행사를 멈춘다 — 회사 관리자만(§3-10).
  if (resolveOwnerScope(req) !== null) return res.status(403).json({ error: '월 대행 취소는 회사 관리자만 할 수 있습니다.', code: 'ADMIN_ONLY' });
  try {
    return res.json(await cancelMonthlyApproval(companyId, planMonth, req.user?.userId || null));
  } catch (error: any) {
    return sendPlannerError(error, res, 'planner_monthly_approvals', '월 대행을 취소하지 못했습니다');
  }
});

export default router;
