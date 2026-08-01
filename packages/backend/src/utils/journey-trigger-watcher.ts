/**
 * Journey Trigger Watcher — D187 (2026-05-20)
 *
 * 목적
 *   활성 여정의 trigger_event 영역을 5분 cron으로 polling하여 매칭 고객을 journey_executions에 enqueue합니다.
 *
 * 트리거 매트릭스 (D187 Harold 확정)
 *   - customer.created (onboarding): customers.created_at 최근 N시간 안 신규 가입 고객
 *   - cdp.purchase (repeat): cdp_events.event_name='purchase' 직전 5분 안 발생
 *   - customer.dormant (dormant): customers.recent_purchase_date < NOW() - dormant_days
 *   - cdp.cart_abandon (cart): cdp_events.event_name='cart_add' 직전 abandon_hours 시점, 이후 checkout_start 없음
 *   - customer.birthday_approaching (birthday): customers.birth_month_day = (NOW + days_before) MM-DD
 *   - cdp.reservation_created (reservation): cdp_events.event_name='reservation_created' 직전 5분
 *   - custom: audience(customer_conditions) + 안전필터 매칭 중 미진입분만 진입 (execution 안티조인 dedup, 상시 세그먼트)
 *
 * 재진입 cooldown 정합
 *   - allow_reentry=false → 이미 execution 1건 이상이면 skip
 *   - allow_reentry=true, cooldown_days=0 → 항상 허용 (매 trigger 발생 시 신규 execution)
 *   - allow_reentry=true, cooldown_days>0 → 마지막 entered_at + cooldown_days < NOW() 시 허용
 *
 * 영구 원칙 정합
 *   - no_target_auto_relax: 매칭 0건 시 enqueue 없음, 침묵 유지
 *   - 회사 격리: 모든 SQL company_id 필수
 *   - ai_operator_model_isolation: AI 호출 없음 (Sonnet 4.6 흐름 영향 0)
 */

import { query, pool } from '../config/database';
// 추출 조건 = journey-target-extractor 공유 컨트롤타워 (발송·미리보기 동일 기준 단일 진입점)
import { selectJourneyTargetCustomerIds, selectCdpEventRowsForCursor, selectCartAbandonProperties, JOURNEY_COUNT_CAP } from './journey-target-extractor';
import { planCdpCursorBatch, buildEntryPropsArray, resolveCdpCursorEventName } from './journey-cdp-cursor';
// ★ 2026-08-01 여정 재설계 §3-0-2 — 신규/기존을 가릴 근거가 없는 회사는 발송하지 않는다(fail-closed).
import { resolveNewCustomerJudgement } from './journey-identity-signals';
import { getCompanyIdentityCapability } from './company-data-profile';
import { calculateNextRunAt } from './send-time-util';
import { getJourneyHoldoutPct } from './journey-entry-ledger';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

interface ActiveJourney {
  id: string;
  company_id: string;
  template_code: string;
  trigger_event: string;
  trigger_filters: Record<string, any>;
  allow_reentry: boolean;
  reentry_cooldown_days: number | null;
  stats_total_entered: number;
  threshold_recipients_per_step: number | null;
  last_event_cursor: Date | null;
}

interface FirstStepRow {
  id: string;
  delay_hours: number;
  delay_mode: string;
  target_hour_kst: number | null;
}

// 진입 INSERT — enqueueCandidates / processCdpCursorJourney 공용(중복 정의 방지).
// ★ 2026-07-11 홀드아웃: $5=holdout_pct(0~30) — 확률 당첨 시 status='holdout'(발송 tick의 active 조회에서 자동 제외 = 미발송 대조군).
const INSERT_EXECUTION_SQL =
  `INSERT INTO journey_executions (
     id, journey_id, customer_id, current_step_order, status,
     entered_at, next_run_at, created_at, entry_event_properties
   ) VALUES (
     gen_random_uuid(), $1::uuid, $2::uuid, 0,
     CASE
       WHEN EXISTS (SELECT 1 FROM journey_executions he
                     WHERE he.journey_id = $1::uuid AND he.customer_id = $2::uuid AND he.status = 'holdout')
         THEN 'holdout'
       WHEN $5::int > 0 AND random() * 100 < $5::int THEN 'holdout'
       ELSE 'active'
     END,
     NOW(), $3, NOW(), $4::jsonb
   )`;

/**
 * 여정 자동 정지 — 이 워커의 정지 3경로(대량 차단 2 + 판정 불가 1) 공용 (2026-08-01).
 *
 * ⛔ 회사 격리: WHERE에 company_id를 강제한다 (Codex 2R 지적, 전량 수용).
 *   옛 세 UPDATE는 journey id와 status만 봤다. 호출부가 DB에서 읽은 id를 넘기더라도
 *   **쓰기 자체가 회사 일치를 강제하지 않으면** id가 어긋나는 순간 남의 회사 여정을 정지시킨다.
 *   같은 부류가 셋이라 개별로 고치지 않고 여기 하나로 모았다.
 */
async function pauseJourneyForCompany(journeyId: string, companyId: string, reason: string): Promise<void> {
  await query(
    `UPDATE journeys SET status = 'paused', paused_at = NOW(), pause_reason = $3, updated_at = NOW()
      WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'active'`,
    [journeyId, companyId, String(reason).slice(0, 500)],
  );
}

// ════════════════════════════════════════════════════════════════════
// Worker — 5분 cron
// ════════════════════════════════════════════════════════════════════

let workerRunning = false;

export async function runJourneyTriggerWatcher(): Promise<{ matched: number; enqueued: number; skipped: number }> {
  if (workerRunning) {
    return { matched: 0, enqueued: 0, skipped: 0 };
  }
  workerRunning = true;

  const summary = { matched: 0, enqueued: 0, skipped: 0 };

  try {
    // ★ 2026-06-30 여정 일반화 — event/standing만 5분 cron 진입. date_anchor=anchor-scheduler, one_shot=활성 시 dispatch가 처리(여기 제외).
    //   start_kind default 'event'라 기존 8 트리거(event)+custom(standing) 경로는 byte 불변.
    const activeRes = await query(
      `SELECT id, company_id, template_code, trigger_event, trigger_filters,
              allow_reentry, reentry_cooldown_days, stats_total_entered,
              threshold_recipients_per_step, last_event_cursor
       FROM journeys
       WHERE status = 'active'
         AND COALESCE(start_kind, 'event') IN ('event', 'standing')
       ORDER BY created_at ASC`
    );

    for (const j of activeRes.rows as ActiveJourney[]) {
      try {
        const result = await processJourneyTrigger(j);
        summary.matched += result.matched;
        summary.enqueued += result.enqueued;
        summary.skipped += result.skipped;
      } catch (err: any) {
        console.error(`[JourneyTrigger] 여정=${j.id} 처리 실패:`, err?.message || err);
      }
    }

    if (summary.matched > 0 || summary.enqueued > 0) {
      console.log(`[JourneyTrigger] 처리 완료 — matched=${summary.matched} enqueued=${summary.enqueued} skipped=${summary.skipped}`);
    }
  } finally {
    workerRunning = false;
  }

  return summary;
}

export function startJourneyTriggerWatcher(): void {
  const intervalMs = 5 * 60 * 1000;
  setInterval(() => {
    runJourneyTriggerWatcher().catch((err) => console.error('[JourneyTrigger] 예외:', err));
  }, intervalMs);
  setTimeout(() => {
    runJourneyTriggerWatcher().catch((err) => console.error('[JourneyTrigger] 초기 실행 예외:', err));
  }, 90 * 1000);
  console.log('[JourneyTrigger] 스케줄러 시작 (5분 주기)');
}

// ════════════════════════════════════════════════════════════════════
// 여정별 trigger 처리
// ════════════════════════════════════════════════════════════════════

async function processJourneyTrigger(j: ActiveJourney): Promise<{ matched: number; enqueued: number; skipped: number }> {
  // ★ Phase 3: 구매·예약·배송(custom_order_shipped)은 이벤트 커서 경로(누락 0 + 정확히 1회 + properties 동봉). 그 외는 공유 컨트롤타워 추출.
  const cursorEvent = resolveCdpCursorEventName(j.trigger_event);
  if (cursorEvent) {
    return processCdpCursorJourney(j, cursorEvent);
  }
  // ★ 2026-08-01 Codex 1R 수용 — 판정 불가는 발송하지 않는다(fail-closed).
  //   신규 고객 여정인데 이 회사 데이터로 기존/신규를 가릴 근거가 하나도 없으면, "진입 원장에 없다"는
  //   이유만으로 기존 고객이 후보가 된다. 활성화 뒤 싱크에이전트가 기존 고객 DB를 처음 적재하는
  //   순간 그 회사 전원이 그렇게 된다 — 10년 단골에게 환영 문자가 나간다.
  //   생성·활성화 화면 게이트는 **이미 활성인 여정**을 막지 못하므로 런타임에서도 막는다.
  //   조용히 0건으로 두지 않고 사유를 남겨 정지한다 — 화면에서 원인을 볼 수 있어야 한다.
  //   ★ 2026-08-01 Codex 3R — 회사 능력은 **게이트에만** 쓴다. 추출에 넘기지 않는다.
  //     추출의 술어는 고객 데이터로만 평가되므로(journey-identity-signals) 능력을 알 필요가 없고,
  //     넘기면 능력을 읽은 시점과 고객 행을 읽는 시점이 갈려 경합이 생긴다.
  if (j.trigger_event === 'customer.created') {
    const judgement = resolveNewCustomerJudgement(await getCompanyIdentityCapability(j.company_id));
    if (!judgement.canJudge) {
      await pauseJourneyForCompany(j.id, j.company_id, `신규 고객 판정 불가 — ${judgement.reason}`);
      console.log(`[JourneyTrigger] 신규 판정 근거 없음 → 정지 journey=${j.id} company=${j.company_id}`);
      return { matched: 0, enqueued: 0, skipped: 0 };
    }
  }

  // 추출 = journey-target-extractor 공유 컨트롤타워. journeyId + 재진입 정보 전달.
  //   휴면·생일·포인트는 진입 안티조인으로 회차마다 다음 분이 들어와 501번째+ 누락이 없다.
  const reentry = { allowReentry: j.allow_reentry, cooldownDays: Number(j.reentry_cooldown_days || 0) };
  // ★ Fix #2 (2026-06-05): 대량 차단기를 LIMIT 500이 무력화하던 문제 정정.
  //   상한 설정 시 cap+1까지 추출 → 진짜 급증(후보 > 상한)만 정지. 미설정(무제한)이면 500 스로틀로 회차 분산.
  const cap = j.threshold_recipients_per_step;
  const extractLimit = cap != null ? Number(cap) + 1 : JOURNEY_COUNT_CAP;
  const ids = await selectJourneyTargetCustomerIds(j.company_id, j.trigger_event, j.trigger_filters || {}, extractLimit, j.id, reentry);
  if (ids.length === 0) {
    return { matched: 0, enqueued: 0, skipped: 0 };
  }
  if (cap != null && ids.length > Number(cap)) {
    await pauseJourneyForCompany(
      j.id,
      j.company_id,
      `대량 진입 감지 (신규 후보 ${Number(cap)}건 초과) — 자동 정지, 담당자 확인 필요`,
    );
    console.warn(`[JourneyTrigger] 대량 차단 — journey=${j.id} 신규 후보 > 상한 ${cap} → 정지`);
    return { matched: ids.length, enqueued: 0, skipped: ids.length };
  }
  // ★ 2026-06-22: 장바구니는 진입 시점 cart_add properties를 entry_event_properties로 실어 알림톡 #{상품명}을 채운다.
  if (j.trigger_event === 'cdp.cart_abandon') {
    const abandonHours = Number((j.trigger_filters || {}).abandon_hours || 24);
    const propsByCustomer = await selectCartAbandonProperties(j.company_id, ids, abandonHours);
    return enqueueCandidates(j, ids, propsByCustomer);
  }
  return enqueueCandidates(j, ids);
}

// ════════════════════════════════════════════════════════════════════
// ★ Phase 3: cdp 이벤트 커서 처리 (구매·예약) — 커서 이후~지금 이벤트 전수, 진입+커서 전진을 한 트랜잭션.
// ════════════════════════════════════════════════════════════════════

async function processCdpCursorJourney(j: ActiveJourney, eventName: string): Promise<{ matched: number; enqueued: number; skipped: number }> {
  // ★ 2026-08-01 §11-3 — 커서 축을 "발생"에서 "도착"으로 옮긴다.
  //   옛 축은 배치로 늦게 도착한 데이터(매장 구매)를 영영 놓쳤다.
  //   단, 저장돼 있는 옛 커서 값은 **발생 시각**이라 그대로 도착 축으로 읽으면 처리분을 다시 잡는다.
  //   그래서 축 전환은 `last_event_cursor_id` 컬럼이 생긴 뒤에만 켠다(DDL이 커서 재기준을 함께 한다).
  //   컬럼 확인은 트랜잭션 밖에서 — 트랜잭션 안에서 실패하면 그 트랜잭션이 통째로 깨진다.
  //   ⛔ 시각과 id를 **같은 조회에서** 함께 읽는다. 시각을 바깥 SELECT에서, id를 여기서 따로 읽으면
  //     그 사이 DDL이 커밋될 때 옛 축 시각과 새 축 id가 한 쌍이 된다(누락·재처리).
  //   ⛔ 42703(컬럼 없음)만 폴백한다. 연결 끊김·타임아웃까지 삼키면 DDL 이후에도 옛 축으로 돌아가
  //     도착 시각이 담긴 커서를 발생 시각으로 해석한다(Codex 지적).
  let cursorAt: Date | string | null;
  let cursorEventId: string | null = null;
  let arrivalAxis = false;
  try {
    const c = await query(`SELECT last_event_cursor, last_event_cursor_id FROM journeys WHERE id = $1::uuid`, [j.id]);
    cursorAt = c.rows[0]?.last_event_cursor ?? null;
    cursorEventId = c.rows[0]?.last_event_cursor_id ?? null;
    arrivalAxis = true;
  } catch (err: any) {
    if (err?.code !== '42703') throw err;
    cursorAt = j.last_event_cursor;   // 컬럼 미마이그레이션 → 옛 축(occurred_at) 그대로
  }
  const axis = arrivalAxis ? 'created_at' : 'occurred_at';

  // ★ 창 끝은 DB 시계에서 받고 안전 지연을 둔다(Codex 지적).
  //   cdp 적재는 트랜잭션 안에서 created_at=NOW()를 쓰는데 PostgreSQL의 NOW()는 **트랜잭션 시작 시각**이다.
  //   적재 트랜잭션이 먼저 시작되고 우리 SELECT가 먼저 실행되면 그 행은 안 보이는데,
  //   창을 지금 시각까지 소모해 버리면 나중에 커밋된 그 행은 이미 커서 뒤라 영영 안 잡힌다.
  //   지연은 적재 트랜잭션이 그 안에 끝난다는 가정 위에 선다 — 증명이 아니라 완화다.
  //   커서보다 뒤로 물러나지 않게 max를 씌운다(활성화 직후 커서가 지금이면 창이 음수가 된다).
  const wr = await query(`SELECT NOW() - INTERVAL '1 minute' AS w`);
  const lagged: Date = wr.rows[0].w;
  const cursorStart = cursorAt || lagged;   // 커서 없으면 빈 창(다음 회차부터)
  const windowEnd = new Date(Math.max(new Date(lagged).getTime(), new Date(cursorStart).getTime()));

  // ★ Fix #11 (2026-06-05): 한 윈도우 이벤트가 상한을 넘어도 LIMIT로 영구 누락하던 문제 정정.
  //   축 순으로 chunk+1 조회 후, 실제로 본 마지막 행까지만 커서를 전진(나머지 다음 회차).
  const CDP_EVENT_CHUNK = 1000;
  const rows = await selectCdpEventRowsForCursor(
    j.company_id,
    eventName,
    j.trigger_filters || {},
    { at: cursorStart, eventId: cursorEventId, axis },
    windowEnd,
    CDP_EVENT_CHUNK + 1,
  );
  const batch = planCdpCursorBatch(rows, CDP_EVENT_CHUNK, windowEnd, axis);
  const ids = batch.ids;
  // 커서 쓰기 — 컬럼이 있으면 (시각, 이벤트 id) 둘 다. 없으면 시각만.
  const cursorSql = arrivalAxis
    ? `UPDATE journeys SET last_event_cursor = $2, last_event_cursor_id = $3::uuid WHERE id = $1::uuid`
    : `UPDATE journeys SET last_event_cursor = $2 WHERE id = $1::uuid`;
  const cursorParams = arrivalAxis
    ? [j.id, batch.newCursor.at, batch.newCursor.eventId]
    : [j.id, batch.newCursor.at];

  // 대량 차단기 — 후보 과다 시 정지+사유(커서 전진 안 함 → 재활성화 시 재평가).
  const cap = j.threshold_recipients_per_step;
  if (cap != null && ids.length > Number(cap)) {
    await pauseJourneyForCompany(
      j.id,
      j.company_id,
      `대량 진입 감지 (${ids.length}건 > 상한 ${cap}건) — 자동 정지, 담당자 확인 필요`,
    );
    console.warn(`[JourneyTrigger] 대량 차단(cdp) — journey=${j.id} 후보=${ids.length} 상한=${cap} → 정지`);
    return { matched: ids.length, enqueued: 0, skipped: ids.length };
  }

  const firstStepRes = await query(
    `SELECT id, delay_hours, delay_mode, target_hour_kst FROM journey_steps WHERE journey_id = $1::uuid AND step_order = 1`,
    [j.id]
  );
  // step 없거나 후보 0이어도 커서는 전진(이 창/chunk 처리 완료 표시 — 누락 방지).
  if (firstStepRes.rows.length === 0 || ids.length === 0) {
    await query(cursorSql, cursorParams);
    return { matched: ids.length, enqueued: 0, skipped: ids.length };
  }
  const firstStep = firstStepRes.rows[0] as FirstStepRow;

  // ★ 정확히 1회: 진입 전부 + 커서 전진을 한 트랜잭션 (크래시 시 통째 롤백 → 다음 회차 동일 창 재처리, 중복 0).
  const holdoutPct = await getJourneyHoldoutPct(j.id);  // ★ 2026-07-11 홀드아웃 — 여정당 1회 조회
  let enqueued = 0;
  let skipped = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const customerId of ids) {
      const allowed = await checkCooldown(j, customerId);
      if (!allowed) { skipped++; continue; }
      const nextRunAt = calculateNextRunAt(firstStep.delay_mode, Number(firstStep.delay_hours || 0), firstStep.target_hour_kst);
      const evProps = batch.propertiesByCustomer[customerId];
      await client.query(INSERT_EXECUTION_SQL, [j.id, customerId, nextRunAt, evProps ? JSON.stringify(evProps) : null, holdoutPct]);
      enqueued++;
    }
    await client.query(cursorSql, cursorParams);
    if (enqueued > 0) {
      await client.query(
        `UPDATE journeys SET stats_total_entered = stats_total_entered + $2, updated_at = NOW() WHERE id = $1::uuid`,
        [j.id, enqueued]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return { matched: ids.length, enqueued, skipped };
}

// ════════════════════════════════════════════════════════════════════
// enqueue 처리 (cooldown 검증 + journey_executions INSERT)
// ════════════════════════════════════════════════════════════════════

async function enqueueCandidates(j: ActiveJourney, customerIds: string[], propsByCustomer?: Record<string, Record<string, any>>): Promise<{ matched: number; enqueued: number; skipped: number }> {
  const matched = customerIds.length;
  if (matched === 0) return { matched: 0, enqueued: 0, skipped: 0 };

  // 첫 step 조회 (step_order=1)
  const firstStepRes = await query(
    `SELECT id, delay_hours, delay_mode, target_hour_kst FROM journey_steps WHERE journey_id = $1::uuid AND step_order = 1`,
    [j.id]
  );
  if (firstStepRes.rows.length === 0) {
    return { matched, enqueued: 0, skipped: matched };
  }
  const firstStep = firstStepRes.rows[0] as FirstStepRow;
  const nextRunAt = calculateNextRunAt(firstStep.delay_mode, Number(firstStep.delay_hours || 0), firstStep.target_hour_kst);
  const isSignup = j.trigger_event === 'customer.created';

  // ★ Fix #6 (2026-06-05): 한 명씩 루프 폐기 → 조건 맞는 전원을 한 방 일괄 INSERT(원래 의도 = 전체 진입).
  //   중복·cooldown은 추출 단계 안티조인(원장·재진입·execution)이 이미 제외. 아래 NOT EXISTS는 추가 안전망 —
  //   재진입 가능 = active만 / 재진입 불가 = 어떤 execution이라도 있으면 제외(checkCooldown과 동일 기준).
  const reentryGuard = j.allow_reentry ? `AND je.status = 'active'` : ``;
  // ★ 2026-06-22: 진입 properties(장바구니 cart_add 등)를 id 순서에 정렬해 entry_event_properties로 동봉.
  //   props 미전달(타 트리거) 시 전부 null → entry_event_properties NULL(기존 동작 불변).
  const entryProps = buildEntryPropsArray(customerIds, propsByCustomer);
  const holdoutPct = await getJourneyHoldoutPct(j.id);  // ★ 2026-07-11 홀드아웃 — 여정당 1회 조회
  let enqueued = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insRes = await client.query(
      `INSERT INTO journey_executions (id, journey_id, customer_id, current_step_order, status, entered_at, next_run_at, created_at, entry_event_properties)
       SELECT gen_random_uuid(), $1::uuid, t.cid, 0,
              CASE
                WHEN EXISTS (SELECT 1 FROM journey_executions he
                              WHERE he.journey_id = $1::uuid AND he.customer_id = t.cid AND he.status = 'holdout')
                  THEN 'holdout'
                WHEN $5::int > 0 AND random() * 100 < $5::int THEN 'holdout'
                ELSE 'active'
              END,
              NOW(), $3, NOW(), t.props
         FROM unnest($2::uuid[], $4::jsonb[]) AS t(cid, props)
        WHERE NOT EXISTS (
          SELECT 1 FROM journey_executions je
           WHERE je.journey_id = $1::uuid AND je.customer_id = t.cid ${reentryGuard}
        )
       RETURNING customer_id`,
      [j.id, customerIds, nextRunAt, entryProps, holdoutPct]
    );
    enqueued = insRes.rows.length;

    // 신규가입: 실제 진입한 고객만 진입 원장 'entered' 일괄 기록(같은 트랜잭션 — 원자성). 식별자=회사+매장코드+전화번호.
    if (isSignup && enqueued > 0) {
      const enteredIds = insRes.rows.map((r: any) => r.customer_id);
      await client.query(
        `INSERT INTO journey_entry_ledger (journey_id, company_id, store_code, phone, kind)
         SELECT $1::uuid, c.company_id, c.store_code, c.phone, 'entered'
           FROM customers c
          WHERE c.id = ANY($2::uuid[]) AND c.company_id = $3::uuid AND c.phone IS NOT NULL AND c.phone <> ''
         ON CONFLICT (journey_id, company_id, COALESCE(store_code, '__NONE__'), phone) DO NOTHING`,
        [j.id, enteredIds, j.company_id]
      );
    }

    if (enqueued > 0) {
      await client.query(
        `UPDATE journeys SET stats_total_entered = stats_total_entered + $2, updated_at = NOW() WHERE id = $1::uuid`,
        [j.id, enqueued]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return { matched, enqueued, skipped: matched - enqueued };
}

async function checkCooldown(j: ActiveJourney, customerId: string): Promise<boolean> {
  if (!j.allow_reentry) {
    // 재진입 불가 — 어떤 execution이라도 존재 시 차단
    const r = await query(
      `SELECT 1 FROM journey_executions WHERE journey_id = $1::uuid AND customer_id = $2::uuid LIMIT 1`,
      [j.id, customerId]
    );
    return r.rows.length === 0;
  }

  // 재진입 가능
  const cooldownDays = Number(j.reentry_cooldown_days || 0);
  if (cooldownDays <= 0) {
    return true;
  }

  const last = await query(
    `SELECT entered_at FROM journey_executions
     WHERE journey_id = $1::uuid AND customer_id = $2::uuid
     ORDER BY entered_at DESC LIMIT 1`,
    [j.id, customerId]
  );
  if (last.rows.length === 0) return true;

  const lastEntered = new Date(last.rows[0].entered_at).getTime();
  const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
  return Date.now() - lastEntered >= cooldownMs;
}
