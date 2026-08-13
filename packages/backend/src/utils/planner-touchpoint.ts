/**
 * planner-touchpoint.ts — 플래너 터치포인트 원장 접근 CT (★ 2026-08-13 Phase 3)
 *
 * 실행·제작·검수·대조 네 워커가 **같은 문으로** 원장을 읽고 상태를 옮긴다.
 * 상태 전이를 각자 쓰면 CAS를 빠뜨린 한 곳이 두 번 발송한다 — 그 자리를 없앤다.
 *
 * ⛔ 실측 컬럼만 쓴다(2026-08-13 · planner_touchpoints 12컬럼):
 *    id · event_id · company_id · channel · timing_rule · format · est_credits · status · lock_reason ·
 *    asset_ref · exec_ref · created_at. **updated_at은 없다** — 참조 금지.
 * ⛔ `exec_meta`(jsonb)는 배포 후 DDL이다. 그 전에는 워커가 **한 곳에서** 판정해 통째로 쉰다
 *    (분기를 흩뿌리면 어디는 돌고 어디는 안 도는 반쪽 상태가 된다).
 * ⛔ 발송 예정일은 저장하지 않는다 — computeTouchpointDate로 계산해서 돌려준다(이중 진실 금지).
 */
import { pool, query } from '../config/database';
import { PlannerChannel, TimingRule, computeTouchpointDate, PLANNER_CHANNEL_LABEL } from './marketing-planner';
import { notifyOperatorAdmins } from './continuous-operator';
import { PLANNER_CLAIM_LEASE_MINUTES, PLANNER_NOTICE_HEADER } from './planner-execution';

export interface PlannerTouchpointRow {
  id: string;
  eventId: string;
  companyId: string;
  channel: PlannerChannel;
  channelLabel: string;
  timing: TimingRule;
  status: string;
  assetRef: string | null;
  execRef: string | null;
  execMeta: Record<string, any>;
  /** 계산값(저장하지 않는다) */
  scheduledOn: string;
  // 행사 축
  planMonth: string;
  title: string;
  startsOn: string;
  endsOn: string;
  benefitText: string | null;
  products: Array<{ name: string }>;
  createdBy: string | null;
  eventStatus: string;
}

// ── exec_meta 준비 판정 ──────────────────────────────────────────────
let execMetaReady: boolean | null = null;

/**
 * `planner_touchpoints.exec_meta` 실재 확인. **양성만 캐시한다** —
 * 음성을 캐시하면 ALTER를 실행해도 재기동 전까지 워커가 영원히 쉰다(자가 치유 불가).
 */
export async function isExecMetaReady(): Promise<boolean> {
  if (execMetaReady === true) return true;
  try {
    const r = await query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'planner_touchpoints' AND column_name = 'exec_meta'`,
    );
    execMetaReady = r.rows.length > 0;
    return execMetaReady;
  } catch (e: any) {
    console.warn('[planner-touchpoint] exec_meta 확인 실패(이번 주기 보류):', e?.message || e);
    return false;
  }
}

/** 워커 진입 게이트 — 준비 전이면 사유를 남기고 아무것도 하지 않는다(부분 실행 금지). */
export async function guardExecMetaOrSkip(worker: string): Promise<boolean> {
  if (await isExecMetaReady()) return true;
  console.log(`[${worker}] DB_MIGRATION_PENDING — planner_touchpoints.exec_meta ALTER 대기, 이번 주기 건너뜀`);
  return false;
}

// ── 조회 ─────────────────────────────────────────────────────────────
/** 승인 이후 살아 있는 행사 상태 — 미승인은 어떤 실행·제작에도 걸리지 않는다(fail-closed). */
export const LIVE_EVENT_STATUS = ['approved', 'producing', 'scheduled', 'done'];

function mapRow(r: any): PlannerTouchpointRow {
  const startsOn = String(r.starts_on).slice(0, 10);
  const endsOn = String(r.ends_on).slice(0, 10);
  const timing = (r.timing_rule || {}) as TimingRule;
  return {
    id: String(r.id),
    eventId: String(r.event_id),
    companyId: String(r.company_id),
    channel: r.channel as PlannerChannel,
    channelLabel: PLANNER_CHANNEL_LABEL[r.channel as PlannerChannel] || String(r.channel),
    timing,
    status: String(r.status),
    assetRef: r.asset_ref ? String(r.asset_ref) : null,
    execRef: r.exec_ref ? String(r.exec_ref) : null,
    execMeta: (r.exec_meta && typeof r.exec_meta === 'object') ? r.exec_meta : {},
    scheduledOn: computeTouchpointDate(timing, startsOn, endsOn),
    planMonth: String(r.plan_month),
    title: String(r.title),
    startsOn,
    endsOn,
    benefitText: r.benefit_text ?? null,
    products: Array.isArray(r.products) ? r.products : [],
    createdBy: r.created_by ? String(r.created_by) : null,
    eventStatus: String(r.event_status),
  };
}

/**
 * 실행·제작 후보 조회 — **승인된 행사의 터치포인트만**.
 * 예정일은 계산 축이라 SQL로 거르지 않는다(같은 규칙을 SQL에 한 번 더 쓰면 두 진실이 된다).
 * 월 범위로 좁혀 읽고 Node에서 computeTouchpointDate로 판정한다 — 월 계획이라 행 수가 작다.
 */
export async function loadLiveTouchpoints(input: {
  statuses: string[];
  channels?: PlannerChannel[];
  /** 'YYYY-MM' 이상만 (지난 달 이월 실행 방지 — 기본 = 이번 달) */
  monthFrom: string;
  companyId?: string;
  limit?: number;
}): Promise<PlannerTouchpointRow[]> {
  const params: any[] = [input.statuses, LIVE_EVENT_STATUS, input.monthFrom];
  let companyClause = '';
  if (input.companyId) {
    params.push(input.companyId);
    companyClause = ` AND t.company_id = $${params.length}::uuid`;
  }
  let channelClause = '';
  if (input.channels && input.channels.length > 0) {
    params.push(input.channels);
    channelClause = ` AND t.channel = ANY($${params.length})`;
  }
  params.push(Math.min(Math.max(1, input.limit || 500), 2000));
  const r = await query(
    `SELECT t.id, t.event_id, t.company_id, t.channel, t.timing_rule, t.status,
            t.asset_ref, t.exec_ref, t.exec_meta,
            e.plan_month, e.title, e.starts_on, e.ends_on, e.benefit_text, e.products,
            e.created_by, e.status AS event_status
       FROM planner_touchpoints t
       JOIN planner_events e ON e.id = t.event_id AND e.company_id = t.company_id
      WHERE t.status = ANY($1)
        AND e.status = ANY($2)
        AND e.plan_month >= $3${companyClause}${channelClause}
      ORDER BY e.starts_on ASC, t.created_at ASC
      LIMIT $${params.length}`,
    params,
  );
  return (r.rows as any[]).map(mapRow);
}

/** 터치포인트 1건 재조회(재개·수동 경로). */
export async function loadTouchpointById(companyId: string, touchpointId: string): Promise<PlannerTouchpointRow | null> {
  const r = await query(
    `SELECT t.id, t.event_id, t.company_id, t.channel, t.timing_rule, t.status,
            t.asset_ref, t.exec_ref, t.exec_meta,
            e.plan_month, e.title, e.starts_on, e.ends_on, e.benefit_text, e.products,
            e.created_by, e.status AS event_status
       FROM planner_touchpoints t
       JOIN planner_events e ON e.id = t.event_id AND e.company_id = t.company_id
      WHERE t.id = $1::uuid AND t.company_id = $2::uuid`,
    [touchpointId, companyId],
  );
  return r.rows[0] ? mapRow(r.rows[0]) : null;
}

// ── 전이 ─────────────────────────────────────────────────────────────
/**
 * 선점 — 상태 CAS로 소유권을 잡고 exec_meta에 시각을 새긴다(고아 회수의 근거).
 * 0행 = 다른 실행이 이미 집었다 → 이번 실행은 손대지 않는다(이중 발송 차단).
 */
export async function claimTouchpoint(
  companyId: string,
  touchpointId: string,
  fromStatuses: string[],
  toStatus: 'producing',
  stampKey = 'claimed_at',
): Promise<boolean> {
  const r = await query(
    `UPDATE planner_touchpoints
        SET status = $4,
            exec_meta = COALESCE(exec_meta, '{}'::jsonb) || jsonb_build_object($5::text, to_jsonb(NOW()))
      WHERE id = $1::uuid AND company_id = $2::uuid AND status = ANY($3)
      RETURNING id`,
    [touchpointId, companyId, fromStatuses, toStatus, stampKey],
  );
  return r.rows.length > 0;
}

/** 상태 이동 + exec_meta 병합 + (선택) 참조 컬럼 기록. 효과(RETURNING)로만 성공을 판정한다. */
export async function setTouchpointState(input: {
  /** ⛔ 필수 — 쓰기에도 회사 경계를 직접 건다(id만으로 쓰면 잘못 결합된 uuid 하나가 남의 회사 상태를 바꾼다). */
  companyId: string;
  touchpointId: string;
  status: string;
  fromStatuses?: string[];
  assetRef?: string | null;
  execRef?: string | null;
  lockReason?: string | null;
  execMetaPatch?: Record<string, any>;
}): Promise<boolean> {
  const params: any[] = [input.touchpointId, input.companyId, input.status];
  const sets = ['status = $3'];
  if (input.assetRef !== undefined) {
    params.push(input.assetRef);
    sets.push(`asset_ref = $${params.length}::uuid`);
  }
  if (input.execRef !== undefined) {
    params.push(input.execRef);
    sets.push(`exec_ref = $${params.length}::uuid`);
  }
  if (input.lockReason !== undefined) {
    params.push(input.lockReason ? String(input.lockReason).slice(0, 300) : null);
    sets.push(`lock_reason = $${params.length}`);
  }
  if (input.execMetaPatch) {
    params.push(JSON.stringify(input.execMetaPatch));
    sets.push(`exec_meta = COALESCE(exec_meta, '{}'::jsonb) || $${params.length}::jsonb`);
  }
  let guard = '';
  if (input.fromStatuses && input.fromStatuses.length > 0) {
    params.push(input.fromStatuses);
    guard = ` AND status = ANY($${params.length})`;
  }
  const r = await query(
    `UPDATE planner_touchpoints SET ${sets.join(', ')}
      WHERE id = $1::uuid AND company_id = $2::uuid${guard} RETURNING id`,
    params,
  );
  return r.rows.length > 0;
}

/**
 * exec_meta만 병합한다(상태 무변경) — 통지 표식처럼 **상태를 바꿀 이유가 없는 기록**에 쓴다.
 * ⛔ 표식을 남기려고 status를 함께 쓰면 그 자리가 조용한 상태 변경이 된다(취소된 행을 발송으로 되돌리는 부류).
 */
export async function stampExecMeta(companyId: string, touchpointId: string, patch: Record<string, any>): Promise<void> {
  await query(
    `UPDATE planner_touchpoints
        SET exec_meta = COALESCE(exec_meta, '{}'::jsonb) || $3::jsonb
      WHERE id = $1::uuid AND company_id = $2::uuid`,
    [touchpointId, companyId, JSON.stringify(patch)],
  );
}

/** 행사 상태 전이 — 조건부(CAS). 승인 원장이 소유한 전이(approved·cancelled)는 여기서 건드리지 않는다. */
export async function setEventStatus(
  companyId: string,
  eventId: string,
  status: string,
  fromStatuses: string[],
): Promise<boolean> {
  const r = await query(
    `UPDATE planner_events SET status = $3, updated_at = NOW()
      WHERE id = $1::uuid AND company_id = $2::uuid AND status = ANY($4)
      RETURNING id`,
    [eventId, companyId, status, fromStatuses],
  );
  return r.rows.length > 0;
}

/** 그 행사의 터치포인트 상태 분포 — 행사 마감(done) 판정·대조에 쓴다. */
export async function summarizeEventTouchpoints(
  companyId: string,
  eventId: string,
): Promise<Record<string, number>> {
  const r = await query(
    `SELECT status, COUNT(*)::int AS cnt
       FROM planner_touchpoints WHERE event_id = $1::uuid AND company_id = $2::uuid
      GROUP BY status`,
    [eventId, companyId],
  );
  const out: Record<string, number> = {};
  for (const row of r.rows as any[]) out[String(row.status)] = Number(row.cnt) || 0;
  return out;
}

// ── 통지 ─────────────────────────────────────────────────────────────
/**
 * 담당자 통지 — 무과금 인증 라인(자동마케팅과 같은 함수) + 플래너 머리말.
 * 실패가 실행을 되돌리지는 않지만, **조용히 넘기지도 않는다**(반환값으로 알린다).
 */
export async function notifyPlanner(
  companyId: string,
  createdBy: string | null,
  title: string,
  body: string,
): Promise<boolean> {
  try {
    return await notifyOperatorAdmins(
      { adminPhoneNumbers: [], backupAdminPhone: null, companyId, createdBy },
      title,
      body,
      { noticeHeader: PLANNER_NOTICE_HEADER },
    );
  } catch (e: any) {
    console.warn('[planner-touchpoint] 통지 실패:', e?.message || e);
    return false;
  }
}

/**
 * 그 달 제작·실행 실적 — 취소 환불 자격 판정의 근거(실쿼리).
 * ⛔ 원장 접근은 이 파일이 소유한다 — 결재 CT가 제작 워커를 import하면 순환이 생긴다.
 */
export async function countMonthWork(companyId: string, planMonth: string): Promise<{ produced: number; executed: number }> {
  const r = await query(
    `SELECT
       COUNT(*) FILTER (WHERE t.asset_ref IS NOT NULL)::int AS produced,
       -- ⛔ **발송 시도 표식도 실행으로 센다.** 커밋은 됐는데 참조 기록이 늦거나 실패한 창이 있고,
       --    그 창에서 "아무 일도 안 했다"로 읽으면 나간 발송에 대행료를 환불한다.
       COUNT(*) FILTER (
         WHERE t.exec_ref IS NOT NULL
            OR t.status IN ('sent', 'scheduled')
            OR (t.exec_meta ? 'send_started_at')
       )::int AS executed
       FROM planner_touchpoints t
       JOIN planner_events e ON e.id = t.event_id AND e.company_id = t.company_id
      WHERE t.company_id = $1::uuid AND e.plan_month = $2`,
    [companyId, planMonth],
  );
  return { produced: Number(r.rows[0]?.produced) || 0, executed: Number(r.rows[0]?.executed) || 0 };
}

/**
 * ★ 2026-08-13 Codex 2R 구조 정정 — **취소와 실행을 같은 행 잠금으로 직렬화한다.**
 *
 * 왜 필요한가(같은 부류가 두 라운드 반복된 뿌리): "커밋 직전에 취소를 조회한다"는 **장벽이 아니다.**
 * 조회 성공과 외부 효과(발송 커밋·제작비 차감) 사이에 창이 남고, 그 창에서 취소가 0건으로 집계해
 * 전액 환불한 뒤 워커가 발송을 커밋한다. 그래서 **선점 자체를 그 달 승인 원장 행 잠금 안에서** 한다:
 *   - 취소가 먼저 잠그면 → 이 선점은 잠금 해제 후 들어와 `cancelled`를 보고 물러난다.
 *   - 선점이 먼저 잠그면 → 취소는 대기 후 들어와 그 행이 `producing`임을 보고 **실적으로 세어 환불하지 않는다.**
 * 잠금 순서는 **승인 원장 → companies**로 통일한다(환불도 그 트랜잭션 안에서 일어난다).
 *
 * 반환 false = 이번 주기에 손대지 않는다(취소됨·이미 선점됨·원장 없음).
 */
export async function claimTouchpointUnderPlanLock(
  tp: { companyId: string; id: string; eventId: string; planMonth: string },
  fromStatuses: string[],
  stampKey = 'claimed_at',
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // ① 그 달 승인 원장 행을 잠근다 — 취소가 같은 행을 잠그므로 두 경로가 직렬화된다.
    const lock = await client.query(
      `SELECT status FROM planner_monthly_approvals
        WHERE company_id = $1::uuid AND plan_month = $2
        FOR UPDATE`,
      [tp.companyId, tp.planMonth],
    );
    const approvalStatus = String(lock.rows[0]?.status || '');
    if (!lock.rows[0] || approvalStatus === 'cancelled') {
      await client.query('ROLLBACK');
      return false;
    }
    // ② 행사가 승인 이후 상태인가(취소·되돌림 방어).
    const ev = await client.query(
      `SELECT status FROM planner_events WHERE id = $1::uuid AND company_id = $2::uuid`,
      [tp.eventId, tp.companyId],
    );
    if (!LIVE_EVENT_STATUS.includes(String(ev.rows[0]?.status || ''))) {
      await client.query('ROLLBACK');
      return false;
    }
    // ③ 같은 잠금 안에서 터치포인트를 선점한다.
    const claimed = await client.query(
      `UPDATE planner_touchpoints
          SET status = 'producing',
              exec_meta = COALESCE(exec_meta, '{}'::jsonb) || jsonb_build_object($4::text, to_jsonb(NOW()))
        WHERE id = $1::uuid AND company_id = $2::uuid AND status = ANY($3)
        RETURNING id`,
      [tp.id, tp.companyId, fromStatuses, stampKey],
    );
    if (claimed.rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query('COMMIT');
    return true;
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => { /* 원 오류 우선 */ });
    console.warn('[planner-touchpoint] 선점 실패(이번 주기 보류):', err?.message || err);
    return false;
  } finally {
    client.release();
  }
}

/**
 * ★ 2026-08-13 Codex 2R 구조 정정 ② — **알림톡 검수 단계를 실행 상태에서 분리한다.**
 *
 * 검수는 며칠 걸리는 외부 절차고 발송은 당일 몇 분이다. 둘이 `producing`을 공유하면
 * 실행이 선점한 행을 검수 워커가 "검수 중"으로 오인해 `ready`로 되돌리고, 그 행이 다시 선점돼 두 번 발송된다.
 * 그래서 **검수 중에는 터치포인트 상태를 `planned`로 두고 단계는 `exec_meta.alimtalk_stage`가 갖는다.**
 * 실행은 `ready`만 집으므로 두 상태 기계가 겹치지 않는다.
 *
 * 반환 false = 다른 실행이 이미 그 단계를 집었다(동시 제출·중복 템플릿 차단).
 */
export async function claimAlimtalkStage(
  companyId: string,
  touchpointId: string,
  fromStages: string[],
  toStage: string,
): Promise<boolean> {
  const r = await query(
    `UPDATE planner_touchpoints
        SET exec_meta = COALESCE(exec_meta, '{}'::jsonb)
                        || jsonb_build_object('alimtalk_stage', $4::text, 'alimtalk_claimed_at', to_jsonb(NOW()))
      WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'planned'
        AND COALESCE(exec_meta->>'alimtalk_stage', '') = ANY($3)
      RETURNING id`,
    [touchpointId, companyId, fromStages, toStage],
  );
  return r.rows.length > 0;
}

/**
 * 계획이 아직 살아 있는가 — **취소된 달에는 제작·발송·과금을 하지 않는다.**
 * 실행·제작 둘 다 이 문을 쓴다(각자 조건을 쓰면 한쪽이 취소를 못 본다).
 * ⛔ 승인 원장이 `pending`이어도 막지 않는다 — 승인 뒤 행사를 추가해 **재제출**하면 그 상태가 되고,
 *   그때 이미 승인된 행사의 실행이 조용히 멈추면 안 된다(재제출은 취소가 아니다).
 */
export async function isPlannerPlanLive(companyId: string, eventId: string): Promise<boolean> {
  const r = await query(
    `SELECT e.status AS event_status,
            (SELECT a.status FROM planner_monthly_approvals a
              WHERE a.company_id = e.company_id AND a.plan_month = e.plan_month) AS approval_status
       FROM planner_events e
      WHERE e.id = $1::uuid AND e.company_id = $2::uuid`,
    [eventId, companyId],
  );
  const row = r.rows[0];
  if (!row) return false;
  if (!LIVE_EVENT_STATUS.includes(String(row.event_status))) return false;
  return String(row.approval_status || '') !== 'cancelled';
}

/**
 * 선점 heartbeat — 긴 단계(스팸 실테스트·대량 발송) 앞에서 소유권 시각을 갱신한다.
 * 이것이 있어야 lease 회수가 **살아 있는 작업**을 고아로 오인하지 않는다.
 */
export async function touchClaim(companyId: string, touchpointId: string): Promise<void> {
  await query(
    `UPDATE planner_touchpoints
        SET exec_meta = COALESCE(exec_meta, '{}'::jsonb) || jsonb_build_object('claimed_at', to_jsonb(NOW()))
      WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'producing'`,
    [touchpointId, companyId],
  ).catch((e: any) => console.warn('[planner-touchpoint] heartbeat 실패:', e?.message || e));
}

/**
 * 고아 회수 — **소유권 값 CAS**로만 되돌린다.
 * 내가 관측한 `claimed_at`이 그대로일 때만 상태를 옮긴다. 그 사이 heartbeat가 갱신했다면
 * 그 작업은 살아 있는 것이므로 손대지 않는다(살아 있는 선점을 되돌리면 두 워커가 같은 행을 잡는다).
 */
export async function releaseStaleClaim(input: {
  companyId: string;
  touchpointId: string;
  observedClaimedAt: string;
  toStatus: string;
  execMetaPatch?: Record<string, any>;
  lockReason?: string | null;
}): Promise<boolean> {
  if (!input.observedClaimedAt) return false;
  const params: any[] = [input.touchpointId, input.companyId, input.toStatus, input.observedClaimedAt];
  const sets = ['status = $3'];
  if (input.lockReason !== undefined) {
    params.push(input.lockReason ? String(input.lockReason).slice(0, 300) : null);
    sets.push(`lock_reason = $${params.length}`);
  }
  params.push(JSON.stringify(input.execMetaPatch || {}));
  sets.push(`exec_meta = COALESCE(exec_meta, '{}'::jsonb) || $${params.length}::jsonb`);
  const r = await query(
    `UPDATE planner_touchpoints SET ${sets.join(', ')}
      WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'producing'
        AND exec_meta->>'claimed_at' = $4
      RETURNING id`,
    params,
  );
  return r.rows.length > 0;
}

/**
 * 고아 판정(선점 lease 초과) — 대조 워커가 쓴다.
 *
 * ⛔ **선점 표식(claimed_at)이 없으면 고아가 아니다.** 선점은 언제나 claimTouchpoint가 시각을 새기므로,
 *   표식이 없는 producing은 다른 상태 기계가 들고 있는 것이다 — 알림톡 검수 대기가 그렇다(며칠 걸린다).
 *   표식 없는 행을 회수하면 검수 중인 터치포인트를 되돌려 템플릿을 또 만들고 무한히 재제출한다.
 */
export function isClaimStale(execMeta: Record<string, any>, now: Date = new Date()): boolean {
  const raw = execMeta?.claimed_at;
  if (!raw) return false;
  const t = new Date(String(raw)).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t > PLANNER_CLAIM_LEASE_MINUTES * 60 * 1000;
}
