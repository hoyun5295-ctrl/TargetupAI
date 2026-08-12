/**
 * routes/marketing-planner.ts — 마케팅 플래너 API (★ 2026-08-12 Phase 1)
 *
 * 설계서 = docs/2026-08-12-ax-marketing-planner-design.md (확정 원장 §1 · 상태 기계 §5-2)
 * 판정 규칙은 전부 CT가 소유한다 — `utils/marketing-planner.ts`(검증·시점·크레딧) · `utils/planner-channel-gate.ts`(가용성).
 *
 * Phase 1 범위 = 행사·터치포인트 CRUD + 가용성 + 예상 크레딧. **승인·차감·제작·발송은 없다**(Phase 2·3).
 * 따라서 이 파일에는 돈·발송을 움직이는 쓰기 경로가 없다.
 *
 * ⛔ 테이블(planner_events·planner_touchpoints)은 배포 후 DDL — 그 전에는 전 endpoint가
 *    `DB_MIGRATION_PENDING`(503)으로 답한다(500 노출 금지, db_alter_safety_net).
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

const router = Router();
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
    const ev = await query(
      `SELECT id, title, starts_on, ends_on, benefit_text, products, status, created_at
         FROM planner_events
        WHERE company_id = $1 AND plan_month = $2 AND status <> 'cancelled'
        ORDER BY starts_on ASC, created_at ASC`,
      [companyId, planMonth],
    );
    const eventIds = ev.rows.map((r: any) => r.id);
    const tpByEvent = new Map<string, any[]>();
    if (eventIds.length > 0) {
      const tp = await query(
        `SELECT id, event_id, channel, timing_rule, format, est_credits, status, lock_reason
           FROM planner_touchpoints
          WHERE event_id = ANY($1)
          ORDER BY created_at ASC`,
        [eventIds],
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
    return res.json({ month: planMonth, events });
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
      await client.query(`DELETE FROM planner_touchpoints WHERE event_id = $1`, [eventId]);
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

export default router;
