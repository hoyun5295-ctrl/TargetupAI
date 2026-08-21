/**
 * routes/marketing-planner.ts — 마케팅 플래너 API (★ 2026-08-12 Phase 1 · 2026-08-13 Phase 2 결재)
 *
 * 설계서 = docs/2026-08-12-ax-marketing-planner-design.md (확정 원장 §1 · 상태 기계 §5-2 · 승인 흐름 §5-3)
 * 판정 규칙은 전부 CT가 소유한다 — `utils/marketing-planner.ts`(검증·시점·크레딧) ·
 * `utils/planner-channel-gate.ts`(가용성) · `utils/planner-approval.ts`(브리핑·게이트·차감·토큰·전이).
 *
 * 범위 = 행사·터치포인트 CRUD + 가용성 + 예상 크레딧 + **월간 브리핑·결재**(제작·발송은 Phase 3).
 * ⚠ 승인은 **돈을 움직이는 쓰기 경로**다 — 그 순서와 멱등은 CT가 소유하고 이 파일은 부르기만 한다.
 *
 * ⛔ 테이블(planner_events·planner_touchpoints·planner_monthly_approvals)은 배포 후 DDL —
 *    그 전에는 전 endpoint가 `DB_MIGRATION_PENDING`(503)으로 답한다(500 노출 금지, db_alter_safety_net).
 */
import { Router, Request, Response } from 'express';
import { pool, query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { handleDbMigrationError } from '../utils/db-migration-error';
import {
  parsePlannerEventInput,
  parsePlanMonth,
  computeTouchpointDate,
  estimateChannelCredits,
  PLANNER_CHANNEL_LABEL,
  PlannerChannel,
} from '../utils/marketing-planner';
import { getPlannerChannelAvailability } from '../utils/planner-channel-gate';
// ★ 2026-08-13 Phase 2 — 브리핑·결재. 판정·전이·차감은 전부 이 CT가 소유한다.
import {
  loadMonthlyBrief,
  submitMonthlyBrief,
  approveMonthlyBrief,
  cancelMonthlyApproval,
  resolveApprovalToken,
  PlannerApprovalError,
} from '../utils/planner-approval';
// ★ 2026-08-13 Phase 3·4 — 제작 착수(승인 직후 best-effort) · 보류 재개 · 결과 브리핑 · 참여 착지.
import { runPlannerProductionPass, resumeHeldTouchpoint } from '../utils/planner-production';
import { runPlannerAlimtalkPass } from '../utils/planner-alimtalk';
import { loadTouchpointById } from '../utils/planner-touchpoint';
// 대상 축 판정은 실행부와 같은 순수 CT를 쓴다 — 화면에 보여주는 축과 나가는 축이 갈리지 않게.
import { resolveAudienceMode } from '../utils/planner-execution';
import { loadMonthlyResult } from '../utils/planner-report';
import { renderJoinLandingHtml, verifyJoinToken } from '../utils/planner-participation';
// ★ 2026-08-13(2) 캘린더 공휴일 — 표 CT 하나가 진실이다.
import { getMonthHolidays } from '../utils/kr-holidays';

const router = Router();

// ────────────────────────────────────────────────────────────────────
// GET /api/marketing-planner/participate/:token — 참여 신청 착지 (인증 전 · 고객이 이메일에서 온다)
//
// ⛔ 여기서 참여를 적재하지 않는다. 수신자 식별은 **이메일 클릭 실측**(email_events: 캠페인+주소)이 하고,
//    참여 이벤트 투영은 그 실측을 읽는 스위퍼가 한다(planner-participation). 이 화면은 확인만 한다 —
//    링크 주소만으로는 누가 눌렀는지 알 수 없고, 고객에게 정보를 더 묻는 것은 이 서비스의 UX 원칙이 아니다.
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
// GET /api/marketing-planner/approval/:token — 결재 링크 착지 (인증 전 · 문자 링크가 여기로 온다)
//
// ⛔ 토큰은 **어느 달의 결재 화면인지**만 정한다. 승인은 아래 인증 구간에서 로그인한 사용자가 한다 —
//    링크만으로 승인되면 URL 유출이 곧 결재 위조가 된다.
// 이 라우트는 authenticate 위에 둔다(아래 router.use(authenticate)는 이 지점 이후만 적용).
// ────────────────────────────────────────────────────────────────────
router.get('/approval/:token', async (req: Request, res: Response) => {
  try {
    const resolved = await resolveApprovalToken(String(req.params.token || ''));
    if (!resolved) return res.redirect('/marketing-planner?link=expired');
    return res.redirect(`/marketing-planner/brief/${resolved.planMonth}`);
  } catch (error: any) {
    // 문자 링크를 눌러 브라우저로 도착한 담당자에게 503 JSON을 보여줄 수는 없다 — 화면으로 보낸다.
    // 다만 배포 불일치(테이블 미생성)는 로그에서 구분되게 남긴다(모니터링이 정상 응답으로 착각하지 않도록).
    const migrationPending = String(error?.code || '') === '42P01' || String(error?.code || '') === '42703';
    console.error(
      `플래너 결재 링크 처리 실패${migrationPending ? ' [DB_MIGRATION_PENDING — planner_monthly_approvals CREATE 필요]' : ''}:`,
      error?.message || error,
    );
    return res.redirect('/marketing-planner?link=error');
  }
});

router.use(authenticate);

/** 수정 가능한 상태 — 승인 이후(producing~)는 Phase 2 결재 흐름(re_brief)을 거쳐야 한다. */
const EDITABLE_STATUS = ['draft', 'briefed', 're_brief'];

function requireCompany(req: Request, res: Response): string | null {
  const companyId = req.user?.companyId;
  if (!companyId) {
    res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    return null;
  }
  return companyId;
}

// GET /api/marketing-planner/availability — 채널 5종 가용성 + 예상 제작 크레딧 (기입 모달의 체크박스 소스)
router.get('/availability', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    const channels = await getPlannerChannelAvailability(companyId);
    return res.json({
      channels: channels.map((c) => ({ ...c, label: PLANNER_CHANNEL_LABEL[c.channel] })),
    });
  } catch (error: any) {
    console.error('플래너 채널 가용성 조회 실패:', error);
    return res.status(500).json({ error: '채널 상태 조회 실패' });
  }
});

// GET /api/marketing-planner/events?month=YYYY-MM — 그 달의 행사 + 터치포인트
router.get('/events', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const planMonth = parsePlanMonth(req.query.month);
  if (!planMonth) return res.status(400).json({ error: '조회할 달을 지정해 주세요. (YYYY-MM)' });
  try {
    // ★ 2026-08-21 (임은지 접수 — 행사 1건 담은 뒤 "화면을 불러오지 못했습니다") date 컬럼은 드라이버가
    //   JS Date로 돌려준다(database.ts는 1114만 재정의). `String(Date).slice(0,10)`은 "Fri Aug 21"이 되어
    //   화면의 날짜 산술(nextDay → toISOString)이 RangeError로 죽었다. 정산 관례대로 SQL에서 `::text`로
    //   'YYYY-MM-DD'를 받는다 — 계약 = planner-date-contract.test.ts(플래너 SELECT의 날짜 컬럼 캐스트 의무).
    const ev = await query(
      `SELECT id, title, starts_on::text AS starts_on, ends_on::text AS ends_on, benefit_text, products, status, created_at
         FROM planner_events
        WHERE company_id = $1 AND plan_month = $2 AND status <> 'cancelled'
        ORDER BY starts_on ASC, created_at ASC`,
      [companyId, planMonth],
    );
    const eventIds = ev.rows.map((r: any) => r.id);
    const tpByEvent = new Map<string, any[]>();
    if (eventIds.length > 0) {
      // 회사 조건을 자식 조회에도 직접 건다 — 부모로만 격리하면 회사가 섞인 자식 행이 목록·합계에 들어온다.
      const tp = await query(
        `SELECT id, event_id, channel, timing_rule, format, est_credits, status, lock_reason
           FROM planner_touchpoints
          WHERE event_id = ANY($1) AND company_id = $2::uuid
          ORDER BY created_at ASC`,
        [eventIds, companyId],
      );
      for (const r of tp.rows as any[]) {
        const arr = tpByEvent.get(String(r.event_id)) || [];
        arr.push(r);
        tpByEvent.set(String(r.event_id), arr);
      }
    }
    const events = ev.rows.map((r: any) => {
      const touchpoints = (tpByEvent.get(String(r.id)) || []).map((t: any) => ({
        id: String(t.id),
        channel: t.channel,
        label: PLANNER_CHANNEL_LABEL[t.channel as PlannerChannel] || t.channel,
        timing: t.timing_rule,
        format: t.format,
        estCredits: t.est_credits,
        // 발송 예정일은 저장하지 않고 조회 시점에 계산 — 행사 기간을 고치면 자동으로 따라온다(이중 진실 금지).
        scheduledOn: computeTouchpointDate(t.timing_rule, String(r.starts_on).slice(0, 10), String(r.ends_on).slice(0, 10)),
        status: t.status,
        lockReason: t.lock_reason,
      }));
      return {
        id: String(r.id),
        title: r.title,
        startsOn: String(r.starts_on).slice(0, 10),
        endsOn: String(r.ends_on).slice(0, 10),
        benefitText: r.benefit_text,
        products: r.products,
        status: r.status,
        touchpoints,
        estCreditsTotal: touchpoints.reduce((s: number, t: any) => s + (Number(t.estCredits) || 0), 0),
      };
    });
    // ★ 2026-08-13 Phase 2 — 캘린더 상단 결재 배너의 축. 승인 원장 표가 아직 없으면(배포 직후 DDL 전)
    //   배너만 접고 캘린더는 그대로 연다 — 새 표 하나 때문에 Phase 1 화면이 통째로 막히면 안 된다.
    let approval = null;
    try {
      const ap = await query(
        `SELECT status, submitted_at, approved_at, agency_credits
           FROM planner_monthly_approvals
          WHERE company_id = $1::uuid AND plan_month = $2`,
        [companyId, planMonth],
      );
      approval = ap.rows[0]
        ? {
            status: ap.rows[0].status,
            submittedAt: ap.rows[0].submitted_at,
            approvedAt: ap.rows[0].approved_at,
            agencyCredits: Number(ap.rows[0].agency_credits) || 0,
          }
        : null;
    } catch (e: any) {
      if (e?.code !== '42P01') console.warn('[marketing-planner] 승인 원장 조회 경고:', e?.message || e);
    }
    // ★ 2026-08-13(2) 공휴일 — 표의 진실은 `utils/kr-holidays.ts` 하나다(화면에 같은 표를 복사하지 않는다).
    //   표가 없는 해는 빈 배열이 아니라 `holidaysReady=false`로 알린다 — 화면이 "준비 중"이라 말한다.
    const holidayInfo = getMonthHolidays(planMonth);
    return res.json({
      month: planMonth, events, approval,
      holidays: holidayInfo.holidays, holidaysReady: holidayInfo.ready,
    });
  } catch (error: any) {
    if (handleDbMigrationError(error, res, 'planner_events')) return;
    console.error('플래너 행사 조회 실패:', error);
    return res.status(500).json({ error: '행사 조회 실패' });
  }
});

/** 행사 1건과 터치포인트를 한 트랜잭션으로 쓴다 — 행사만 남고 터치포인트가 유실되는 반쪽 저장 차단. */
async function writeEventWithTouchpoints(
  companyId: string,
  userId: string | null,
  parsed: ReturnType<typeof parsePlannerEventInput> & { ok: true },
  existingEventId?: string,
): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let eventId = existingEventId;
    if (eventId) {
      const up = await client.query(
        `UPDATE planner_events
            SET title = $1, starts_on = $2, ends_on = $3, benefit_text = $4, products = $5,
                plan_month = $6, updated_at = NOW()
          WHERE id = $7 AND company_id = $8 AND status = ANY($9)
          RETURNING id`,
        [
          parsed.value.title, parsed.value.startsOn, parsed.value.endsOn, parsed.value.benefitText,
          JSON.stringify(parsed.value.products), parsed.planMonth, eventId, companyId, EDITABLE_STATUS,
        ],
      );
      if (up.rows.length === 0) throw Object.assign(new Error('NOT_EDITABLE'), { code: 'NOT_EDITABLE' });
      // 터치포인트는 교체 — 수정 화면이 전체 구성을 다시 보내는 계약이라 부분 병합의 어긋남이 없다.
      // 쓰기 경로에도 회사 조건을 건다(6원칙 ① — 같은 부류를 읽기에서만 닫지 않는다).
      await client.query(`DELETE FROM planner_touchpoints WHERE event_id = $1 AND company_id = $2::uuid`, [eventId, companyId]);
    } else {
      const ins = await client.query(
        `INSERT INTO planner_events (company_id, plan_month, title, starts_on, ends_on, benefit_text, products, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8)
         RETURNING id`,
        [
          companyId, parsed.planMonth, parsed.value.title, parsed.value.startsOn, parsed.value.endsOn,
          parsed.value.benefitText, JSON.stringify(parsed.value.products), userId,
        ],
      );
      eventId = String(ins.rows[0].id);
    }
    for (const t of parsed.value.touchpoints) {
      await client.query(
        `INSERT INTO planner_touchpoints (event_id, company_id, channel, timing_rule, format, est_credits, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'planned')`,
        [eventId, companyId, t.channel, JSON.stringify(t.timing), t.format, estimateChannelCredits(t.channel) ?? 0],
      );
    }
    await client.query('COMMIT');
    return eventId!;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* 원 오류 우선 */ });
    throw err;
  } finally {
    client.release();
  }
}

// POST /api/marketing-planner/events — 행사 기입
router.post('/events', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const parsed = parsePlannerEventInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    // 잠긴 채널은 서버에서도 거른다 — 프론트 체크박스 상태를 신뢰하지 않는다.
    const gates = await getPlannerChannelAvailability(companyId);
    const locked = parsed.value.touchpoints.filter(
      (t) => gates.find((g) => g.channel === t.channel)?.available === false,
    );
    if (locked.length > 0) {
      const g = gates.find((x) => x.channel === locked[0].channel)!;
      return res.status(400).json({ error: `${PLANNER_CHANNEL_LABEL[g.channel]} — ${g.reason}` });
    }
    const eventId = await writeEventWithTouchpoints(companyId, req.user?.userId || null, parsed);
    console.log(`[marketing-planner] 행사 기입 ${eventId} (${parsed.planMonth} · ${parsed.value.title} · TP ${parsed.value.touchpoints.length})`);
    return res.status(201).json({ id: eventId, month: parsed.planMonth });
  } catch (error: any) {
    if (handleDbMigrationError(error, res, 'planner_events')) return;
    console.error('플래너 행사 기입 실패:', error);
    return res.status(500).json({ error: '행사 저장 실패' });
  }
});

// PUT /api/marketing-planner/events/:id — 수정 (draft·briefed·re_brief만)
router.put('/events/:id', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const parsed = parsePlannerEventInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const gates = await getPlannerChannelAvailability(companyId);
    const locked = parsed.value.touchpoints.filter(
      (t) => gates.find((g) => g.channel === t.channel)?.available === false,
    );
    if (locked.length > 0) {
      const g = gates.find((x) => x.channel === locked[0].channel)!;
      return res.status(400).json({ error: `${PLANNER_CHANNEL_LABEL[g.channel]} — ${g.reason}` });
    }
    await writeEventWithTouchpoints(companyId, req.user?.userId || null, parsed, String(req.params.id));
    return res.json({ id: String(req.params.id), month: parsed.planMonth });
  } catch (error: any) {
    if ((error as any)?.code === 'NOT_EDITABLE') {
      return res.status(400).json({ error: '승인 이후의 행사는 여기서 수정할 수 없습니다. 변경은 재승인 절차를 거칩니다.' });
    }
    if (handleDbMigrationError(error, res, 'planner_events')) return;
    console.error('플래너 행사 수정 실패:', error);
    return res.status(500).json({ error: '행사 수정 실패' });
  }
});

// DELETE /api/marketing-planner/events/:id — draft만 삭제 (그 외는 Phase 2 취소 전이로)
router.delete('/events/:id', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    const del = await query(
      `DELETE FROM planner_events WHERE id = $1 AND company_id = $2 AND status = 'draft' RETURNING id`,
      [String(req.params.id), companyId],
    );
    if (del.rows.length === 0) {
      return res.status(400).json({ error: '작성 중(draft) 상태의 행사만 삭제할 수 있습니다.' });
    }
    return res.json({ deleted: true });
  } catch (error: any) {
    if (handleDbMigrationError(error, res, 'planner_events')) return;
    console.error('플래너 행사 삭제 실패:', error);
    return res.status(500).json({ error: '행사 삭제 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// Phase 2 — 월간 브리핑·결재 (설계서 §5-3 · 요금 §3-4)
// ⛔ 미승인 = 미발송 = 미차감. 승인만이 그 달 대행 계약이고, 차감은 승인 시 1회다.
// ════════════════════════════════════════════════════════════════════

/** CT 오류 → HTTP. 코드가 화면 분기(충전 유도 등)의 축이 된다. */
function sendApprovalError(err: any, res: Response): boolean {
  if (err instanceof PlannerApprovalError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return true;
  }
  return false;
}

// GET /api/marketing-planner/brief?month=YYYY-MM — 월간 브리핑(결재 서류)
router.get('/brief', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const planMonth = parsePlanMonth(req.query.month);
  if (!planMonth) return res.status(400).json({ error: '조회할 달을 지정해 주세요. (YYYY-MM)' });
  try {
    const brief = await loadMonthlyBrief(companyId, planMonth);
    return res.json(brief);
  } catch (error: any) {
    if (handleDbMigrationError(error, res, 'planner_monthly_approvals')) return;
    console.error('플래너 브리핑 조회 실패:', error);
    return res.status(500).json({ error: '브리핑 조회 실패' });
  }
});

// POST /api/marketing-planner/brief/:month/submit — 결재 올리기(pending + 행사 briefed + 결재 문자)
router.post('/brief/:month/submit', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const planMonth = parsePlanMonth(req.params.month);
  if (!planMonth) return res.status(400).json({ error: '대상 달을 지정해 주세요. (YYYY-MM)' });
  try {
    const result = await submitMonthlyBrief(companyId, planMonth, req.user?.userId || null);
    return res.json(result);
  } catch (error: any) {
    if (sendApprovalError(error, res)) return;
    if (handleDbMigrationError(error, res, 'planner_monthly_approvals')) return;
    console.error('플래너 브리핑 제출 실패:', error);
    return res.status(500).json({ error: '결재 요청 실패' });
  }
});

// POST /api/marketing-planner/brief/:month/approve — 월간 승인(대행 크레딧 1회 차감·멱등)
router.post('/brief/:month/approve', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const planMonth = parsePlanMonth(req.params.month);
  if (!planMonth) return res.status(400).json({ error: '대상 달을 지정해 주세요. (YYYY-MM)' });
  try {
    const result = await approveMonthlyBrief(companyId, planMonth, req.user?.userId || null);
    // ★ 2026-08-13 Phase 3 — 승인 직후 소재 제작 착수. **승인 트랜잭션 밖 best-effort**다:
    //   고객 확정 경로(승인)에 부가 작업을 얹지 않는다(0808 교훈). 놓친 건은 제작 워커(그물)가 집는다.
    void runPlannerProductionPass({ companyId }).catch((e: any) =>
      console.warn('[marketing-planner] 승인 직후 제작 착수 경고:', e?.message || e));
    // 알림톡은 검수 리드타임(영업일 5일)이 있어 승인 직후 제출이 늦으면 그 터치포인트가 제외된다.
    void runPlannerAlimtalkPass({ companyId }).catch((e: any) =>
      console.warn('[marketing-planner] 승인 직후 알림톡 검수 착수 경고:', e?.message || e));
    return res.json(result);
  } catch (error: any) {
    if (sendApprovalError(error, res)) return;
    if (handleDbMigrationError(error, res, 'planner_monthly_approvals')) return;
    console.error('플래너 월간 승인 실패:', error);
    return res.status(500).json({ error: '승인 처리 실패' });
  }
});

// POST /api/marketing-planner/brief/:month/cancel — 월간 대행 취소(제작·발송 0건이면 대행료 전액 환불)
router.post('/brief/:month/cancel', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const planMonth = parsePlanMonth(req.params.month);
  if (!planMonth) return res.status(400).json({ error: '대상 달을 지정해 주세요. (YYYY-MM)' });
  try {
    const result = await cancelMonthlyApproval(companyId, planMonth, req.user?.userId || null);
    return res.json(result);
  } catch (error: any) {
    if (sendApprovalError(error, res)) return;
    if (handleDbMigrationError(error, res, 'planner_monthly_approvals')) return;
    console.error('플래너 월간 취소 실패:', error);
    return res.status(500).json({ error: '취소 처리 실패' });
  }
});

// GET /api/marketing-planner/brief/:month/result — 결과 브리핑(실측 집계 · Phase 4)
router.get('/brief/:month/result', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const planMonth = parsePlanMonth(req.params.month);
  if (!planMonth) return res.status(400).json({ error: '조회할 달을 지정해 주세요. (YYYY-MM)' });
  try {
    const result = await loadMonthlyResult(companyId, planMonth);
    return res.json(result);
  } catch (error: any) {
    if (handleDbMigrationError(error, res, 'planner_touchpoints')) return;
    console.error('플래너 결과 조회 실패:', error);
    return res.status(500).json({ error: '결과 조회 실패' });
  }
});

/**
 * GET /api/marketing-planner/touchpoints/:id/detail — 도래한 터치포인트의 **실제 실행 내역** (★ 2026-08-13(2))
 *
 * 화면은 도래 전 계획을 이미 갖고 있어 부르지 않는다 — 여기서 돌려주는 것은 **실측뿐**이다:
 * 실제로 나간 문안, 발송 수, 발행된 소재. 목업·추정을 섞지 않는다(없으면 null).
 * ⛔ 모든 조회에 회사 조건을 직접 건다(참조 uuid 하나로 남의 회사 소재를 열지 않는다).
 * ⛔ 컬럼은 2026-08-13(2) information_schema 실측분만 쓴다(campaigns·email_campaigns·cdp_inapp_messages·kakao_templates 20컬럼).
 */
router.get('/touchpoints/:id/detail', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    const tp = await loadTouchpointById(companyId, String(req.params.id));
    if (!tp) return res.status(404).json({ error: '해당 항목을 찾을 수 없습니다.' });

    let message: { subject: string | null; body: string } | null = null;
    let asset: Record<string, any> | null = null;
    let sentAt: string | null = tp.execMeta?.sent_at || null;
    let sentCount: number | null = Number.isFinite(Number(tp.execMeta?.sent_count)) ? Number(tp.execMeta.sent_count) : null;
    let audienceNote: string | null = null;

    // 문자·DM·알림톡 = 공용 발송 표에 실린다(채널 축은 send_channel이라 message_type으로 가르지 않는다).
    if (tp.execRef && tp.channel !== 'email' && tp.channel !== 'inapp') {
      const c = await query(
        `SELECT message_content, message_subject, sent_count, success_count, sent_at, target_count, status
           FROM campaigns WHERE id = $1::uuid AND company_id = $2::uuid`,
        [tp.execRef, companyId],
      );
      const row = c.rows[0];
      if (row) {
        if (row.message_content) message = { subject: row.message_subject || null, body: String(row.message_content) };
        sentAt = row.sent_at || sentAt;
        if (Number.isFinite(Number(row.sent_count))) sentCount = Number(row.sent_count);
        if (Number.isFinite(Number(row.success_count))) {
          audienceNote = `접수 ${Number(row.target_count || row.sent_count || 0).toLocaleString()}명 · 성공 ${Number(row.success_count).toLocaleString()}명`;
        }
      }
    }

    const assetRef = tp.assetRef || null;
    if (tp.channel === 'email') {
      const id = assetRef || tp.execMeta?.email_campaign_id || null;
      if (id) {
        const e = await query(
          `SELECT subject, html_body, sent_count, sent_at, status
             FROM email_campaigns WHERE id = $1::uuid AND company_id = $2::uuid`,
          [id, companyId],
        );
        const row = e.rows[0];
        if (row) {
          asset = { kind: 'email', title: row.subject, html: row.html_body };
          sentAt = row.sent_at || sentAt;
          if (Number.isFinite(Number(row.sent_count))) sentCount = Number(row.sent_count);
        }
      }
    } else if (tp.channel === 'dm') {
      const url = tp.execMeta?.dm_url ? String(tp.execMeta.dm_url) : null;
      if (url) asset = { kind: 'dm', url };
    } else if (tp.channel === 'inapp') {
      const id = assetRef || tp.execMeta?.inapp_message_id || null;
      if (id) {
        const m = await query(
          `SELECT title, body, image_url, status, start_at, end_at
             FROM cdp_inapp_messages WHERE id = $1::uuid AND company_id = $2::uuid`,
          [id, companyId],
        );
        const row = m.rows[0];
        if (row) {
          asset = { kind: 'inapp', title: row.title, body: row.body, imageUrl: row.image_url };
          if (row.status === 'active' && row.end_at) audienceNote = `행사 종료일까지 노출됩니다`;
        }
      }
    } else if (tp.channel === 'alimtalk') {
      const rowId = tp.execMeta?.alimtalk_template_row ? String(tp.execMeta.alimtalk_template_row) : null;
      if (rowId) {
        const t = await query(
          `SELECT content, status FROM kakao_templates WHERE id = $1::uuid AND company_id = $2::uuid`,
          [rowId, companyId],
        );
        const row = t.rows[0];
        if (row) {
          asset = { kind: 'alimtalk', body: row.content, inspection: String(row.status).toUpperCase() === 'APPROVED' ? '승인' : '검수 중' };
        }
      }
    }

    return res.json({
      status: tp.status,
      scheduledOn: tp.scheduledOn,
      channel: tp.channel,
      label: tp.channelLabel,
      audience: resolveAudienceMode(tp.channel, tp.timing),
      audienceCount: null,
      audienceNote,
      // 보류 사유는 목록 조회(`/events`)가 이미 주고 화면이 그 값을 쓴다 — 같은 사실을 두 응답으로 내보내지 않는다.
      sentAt,
      sentCount,
      message,
      asset,
    });
  } catch (error: any) {
    if (handleDbMigrationError(error, res, 'planner_touchpoints')) return;
    console.error('플래너 터치포인트 상세 조회 실패:', error);
    return res.status(500).json({ error: '상세 조회 실패' });
  }
});

// POST /api/marketing-planner/touchpoints/:id/resume — 보류(크레딧) 재개 1클릭
//   같은 멱등키라 이미 낸 제작비가 다시 빠지지 않는다. 발송 자체는 예정일에 실행 워커가 한다.
router.post('/touchpoints/:id/resume', async (req: Request, res: Response) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    const tp = await loadTouchpointById(companyId, String(req.params.id));
    if (!tp) return res.status(404).json({ error: '해당 항목을 찾을 수 없습니다.' });
    if (tp.status !== 'hold_credit' && tp.status !== 'locked') {
      return res.status(400).json({ error: '보류 상태인 항목만 다시 시작할 수 있습니다.' });
    }
    const outcome = await resumeHeldTouchpoint(tp);
    if (outcome === 'hold_credit') {
      return res.status(402).json({ error: '크레딧이 아직 부족합니다. 충전 후 다시 시도해 주세요.', code: 'INSUFFICIENT_CREDIT' });
    }
    // ⛔ 효과가 없었으면 성공으로 답하지 않는다(★ 2026-08-13(2)) — 화면은 "다시 시작했습니다"를 띄우는데
    //   행은 잠긴 채로 남아, 담당자는 고쳤다고 믿고 그 발송은 영영 나가지 않는다(6원칙 ②).
    if (outcome === 'unresumable') {
      return res.status(409).json({ error: '지금 상태에서는 다시 시작할 수 없습니다. 표시된 사유를 확인해 주세요.', code: 'NOT_RESUMABLE' });
    }
    if (outcome === 'locked') {
      return res.status(409).json({ error: '다시 시작했지만 진행하지 못했습니다. 표시된 사유를 확인해 주세요.', code: 'STILL_LOCKED' });
    }
    return res.json({ status: outcome });
  } catch (error: any) {
    if (handleDbMigrationError(error, res, 'planner_touchpoints')) return;
    console.error('플래너 보류 재개 실패:', error);
    return res.status(500).json({ error: '재개 처리 실패' });
  }
});

export default router;
