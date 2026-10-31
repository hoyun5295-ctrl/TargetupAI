/**
 * 여정 보낸 결과 안내 = 칸 · 날짜 단위 CT (★ 2026-10-31 · 설계서 docs/2026-10-31-journey-step-gate-notice-design.md §2-6 · 뿌리 R30)
 *
 * 단위 = journey_step_campaigns 한 행(여정 · 칸 · 발송일 KST = 그날 그 칸 발송이 같이 쓰는 캠페인 하나).
 *   옛: 고객이 여정을 다 마친(completed) 실행만 후보라 중간 칸 결과는 오지 않았다(2칸 여정의 1번 칸 = 2번 칸이 나갈 때까지 0 · 오류접수 cmvujpa3w).
 * 칸 · 날짜당 많아야 두 통:
 *   - 첫 안내 = 오늘 = 그날 그 칸 예정분이 다 나가고(진행 중 실행 0 · 정지 화면과 같은 조각) 결과를 셀 수 있고 대기 0 / 지난 날 = 08시 뒤(대기 · 셀 수 없음은 그대로 밝힘)
 *   - 하루 합계 = 첫 안내 뒤 그날 더 보낸 몫이 있으면 다음 날 08시 뒤(하루 내내 이어서 나가는 칸)
 *   - 알림 꺼짐 · 받을 담당자 없음 = 보내지 않고 기록만(후보에서 빠진다 · 매 회차 앞자리를 차지하지 않게 · R8)
 * 보내기 = 안내 쓰기 한 꼴(journey-notice-once · 시도 수 = result_notice_attempts · 적재 = 상한 있는 연결).
 * 기록 칸 = DDL C84-DDL-1(배포 뒤 · 기준선 = 있던 행은 이미 알림) · 칸이 없으면 이 회차를 건너뛴다(옛 경로로 돌아가지 않음 · 소급 · 중복 0).
 */

import { query, withBoundedMysql } from '../config/database';
import { SEND_HOURS } from '../config/defaults';
import { getAuthSmsTable, bulkInsertSmsQueue, getCompanySmsTablesWithLogs, smsCampaignCountsSafe, getPlatformNoticeCallback } from './sms-queue';
import { pickOwnerContact } from './owner-contact';
import { isStepNotifyOn, messageStepBoundsSql } from './journey-step-notify';
import { dueExecutionsSql } from './journey-pause-handler';
import { NOTICE_ENQUEUE_TIMEOUT_MS, NOTICE_MAX_ATTEMPTS, sendNoticeOnce } from './journey-notice-once';
import { sendSystemAlert } from './system-alert';

/** 후보 창 = 오늘 · 어제 · 그제(KST) */
export const RESULT_NOTICE_WINDOW_DAYS = 2;
/** 한 회차에 보는 행 수(정렬 = 이른 날부터 · PK 순 커서로 회차를 이어 끝까지 돈다) */
export const RESULT_NOTICE_SCAN_LIMIT = 500;

export type ResultNoticeDecision = 'first' | 'day_total' | 'record_only' | 'wait';

export interface ResultNoticeFacts {
  /** 알림 켜짐(isStepNotifyOn) · 받을 담당자 있음 */
  notifyOn: boolean;
  /** 발송일 · 오늘(KST 'YYYY-MM-DD') · 지금 KST 시 */
  sendDay: string;
  todayKst: string;
  kstHour: number;
  /** 발송 시간 시작(시) */
  sendStartHour: number;
  /** 첫 안내를 했는가(result_notice_at) */
  noticed: boolean;
  /** 캠페인 보낸 수 · 안내에 담은 보낸 수 */
  sentCount: number;
  noticedSent: number;
  /** 그날 그 칸 진행 중 실행이 남았는가 */
  stillDue: boolean;
  /** 결과를 셀 수 있었는가 · 대기 수 */
  countsKnown: boolean;
  pending: number;
}

/** (순수) 이번 회차에 그 칸 · 그 날을 어떻게 하는가 */
export function decideResultNotice(f: ResultNoticeFacts): ResultNoticeDecision {
  if (f.sentCount <= f.noticedSent) return 'wait';
  if (!f.notifyOn) return 'record_only';
  const dayClosed = f.sendDay < f.todayKst;
  const morning = f.kstHour >= f.sendStartHour;
  if (!f.noticed) {
    if (!dayClosed) return !f.stillDue && f.countsKnown && f.pending === 0 ? 'first' : 'wait';
    return morning ? 'first' : 'wait';
  }
  return dayClosed && morning ? 'day_total' : 'wait';
}

/** (순수) 안내 본문 */
export function buildResultNoticeBody(p: {
  journeyName: string; stepOrder: number; messageSteps: number; isLast: boolean; sendDay: string;
  sentCount: number; countsKnown: boolean; success: number; fail: number; pending: number; dayTotal: boolean;
}): string {
  const [, mm, dd] = p.sendDay.split('-');
  const dayLabel = `${Number(mm)}월 ${Number(dd)}일`;
  const resultLine = p.countsKnown
    ? `성공: ${p.success}건 / 실패: ${p.fail}건${p.pending > 0 ? ` / 대기: ${p.pending}건` : ''}`
    : '결과 집계 전. 발송결과 화면에서 확인해 주세요';
  return [
    '[여정 발송 결과]',
    '',
    `여정: ${p.journeyName || '여정 자동 발송'}`,
    `step ${p.stepOrder} / ${p.messageSteps}${p.isLast ? ' (최종)' : ''}`,
    `날짜: ${dayLabel}`,
    `보낸 수: ${p.sentCount}건`,
    resultLine,
    ...(p.dayTotal ? [`${dayLabel} 하루 합계입니다.`] : []),
    '',
    p.isLast ? '여정 마지막 칸입니다.' : '다음 칸은 정한 때에 이어서 나갑니다.',
  ].join('\n');
}

// ── 기록 칸(C84-DDL-1) 확인 — 참은 기억 · 거짓은 5분 뒤 다시(journey-lineage 와 같은 규약) ──
let _ready = false;
let _absentUntil = 0;
let _lastAbsentLog = 0;
const RECHECK_MS = 5 * 60 * 1000;
export async function resultNoticeColumnsReady(): Promise<boolean> {
  if (_ready) return true;
  if (Date.now() < _absentUntil) return false;
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'journey_step_campaigns' AND column_name IN ('result_notice_sent', 'result_notice_at', 'result_notice_attempts')`,
  );
  const ok = Number(r.rows[0]?.n || 0) === 3;
  if (ok) _ready = true;
  else _absentUntil = Date.now() + RECHECK_MS;
  return ok;
}
/** 시험 전용. */
export function resetResultNoticeColumnsCache(value?: boolean): void {
  _cursor = null;
  _ready = value === true;
  _absentUntil = value === false ? Date.now() + RECHECK_MS : 0;
}

/**
 * 후보를 끝까지 도는 커서(PK 순 · Codex 구현 1R ④ · 2R ①) — 한 회차 = 커서 뒤 RESULT_NOTICE_SCAN_LIMIT 행 · 다 못 채우면 다음 회차는 처음부터.
 *   기다리는 행이 아무리 많아도 모든 후보가 ceil(후보 수 / 상한) 회차 안에 한 번은 판정을 받는다(앞자리 독차지 0).
 *   판정은 decideResultNotice 한 곳(SQL 은 거르지 않는다 · 2R ② = 판정을 SQL 에 베끼면 알림 꺼짐 「기록만」이 어긋났다). 재시작 = 처음부터.
 */
let _cursor: { sendDay: string; journeyId: string; stepId: string } | null = null;

/** 캠페인 동기화 워커(5분)가 동기화 뒤에 부른다. */
export async function notifyJourneyStepResults(): Promise<void> {
  if (!(await resultNoticeColumnsReady())) {
    if (Date.now() - _lastAbsentLog >= RECHECK_MS) {
      _lastAbsentLog = Date.now();
      console.warn('[journey-result] 결과 안내 기록 칸(journey_step_campaigns.result_notice_*)이 없어 이번 회차를 건너뜁니다 · 원장 C84-DDL-1');
    }
    return;
  }
  const bounds = messageStepBoundsSql('jsc.journey_id');
  const res = await query(
    `SELECT jsc.journey_id, jsc.step_id, jsc.send_date::text AS send_day, jsc.campaign_id,
            jsc.result_notice_sent, (jsc.result_notice_at IS NOT NULL) AS noticed,
            j.company_id, j.name AS journey_name, j.created_by,
            s.step_order, s.notify_manager_on_pretest,
            ${bounds.first} AS first_message_order, ${bounds.last} AS last_message_order,
            (SELECT COUNT(*) FROM journey_steps mc WHERE mc.journey_id = jsc.journey_id AND COALESCE(mc.step_type, 'message') = 'message')::int AS message_steps,
            COALESCE(c.sent_count, 0)::int AS sent_count,
            EXISTS (SELECT 1 ${dueExecutionsSql('jsc.journey_id', 'jsc.step_id', 'jsc.send_date')}) AS still_due,
            to_char(NOW() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS today_kst,
            EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Asia/Seoul')::int AS kst_hour
       FROM journey_step_campaigns jsc
       JOIN journeys j ON j.id = jsc.journey_id
       JOIN journey_steps s ON s.id = jsc.step_id
       JOIN campaigns c ON c.id = jsc.campaign_id
      WHERE jsc.send_date >= (NOW() AT TIME ZONE 'Asia/Seoul')::date - ${RESULT_NOTICE_WINDOW_DAYS}
        AND COALESCE(c.sent_count, 0) > COALESCE(jsc.result_notice_sent, 0)
        AND ($1::date IS NULL OR (jsc.send_date, jsc.journey_id, jsc.step_id) > ($1::date, $2::uuid, $3::uuid))
      ORDER BY jsc.send_date ASC, jsc.journey_id ASC, jsc.step_id ASC
      LIMIT ${RESULT_NOTICE_SCAN_LIMIT}`,
    [_cursor?.sendDay ?? null, _cursor?.journeyId ?? null, _cursor?.stepId ?? null],
  );
  const last = res.rows[res.rows.length - 1] as any;
  _cursor = res.rows.length < RESULT_NOTICE_SCAN_LIMIT ? null : { sendDay: String(last.send_day), journeyId: String(last.journey_id), stepId: String(last.step_id) };
  for (const row of res.rows as any[]) {
    try {
      await handleStepDay(row);
    } catch (err: any) {
      console.warn(`[journey-result] 결과 안내 처리 실패 journey=${row.journey_id} step=${row.step_id} day=${row.send_day}:`, err?.message || err);
    }
  }
}

async function handleStepDay(row: any): Promise<void> {
  const oldSent: number | null = row.result_notice_sent == null ? null : Number(row.result_notice_sent);
  const sentCount = Number(row.sent_count || 0);
  const pk = [row.journey_id, row.step_id, row.send_day];
  const finalize = async (): Promise<boolean> => (await query(
    `UPDATE journey_step_campaigns SET result_notice_sent = $4, result_notice_at = NOW(), result_notice_attempts = 0
      WHERE journey_id = $1::uuid AND step_id = $2::uuid AND send_date = $3::date
        AND result_notice_sent IS NOT DISTINCT FROM $5::int
      RETURNING journey_id`,
    [...pk, sentCount, oldSent],
  )).rows.length > 0;

  const contact = isStepNotifyOn(row.notify_manager_on_pretest, row.step_order, row.first_message_order, row.last_message_order)
    ? await pickOwnerContact(row.company_id, row.created_by || null)
    : null;

  let success = 0; let fail = 0; let pending = 0; let countsKnown = false;
  if (contact) {
    try {
      const tables = await getCompanySmsTablesWithLogs(row.company_id, row.created_by || undefined);
      if (tables.length > 0) {
        const agg = await smsCampaignCountsSafe(tables, [row.campaign_id]);
        const c = agg.get(String(row.campaign_id));
        if (c) { success = Number(c.success || 0); fail = Number(c.fail || 0); pending = Number(c.pending || 0); countsKnown = true; }
      }
    } catch (aggErr: any) {
      console.warn(`[journey-result] 결과 집계 실패 campaign=${row.campaign_id}:`, aggErr?.message || aggErr);
    }
  }

  const decision = decideResultNotice({
    notifyOn: !!contact, sendDay: String(row.send_day), todayKst: String(row.today_kst), kstHour: Number(row.kst_hour),
    sendStartHour: SEND_HOURS.start, noticed: !!row.noticed, sentCount, noticedSent: oldSent ?? 0,
    stillDue: !!row.still_due, countsKnown, pending,
  });
  if (decision === 'wait') return;
  if (decision === 'record_only' || !contact) { await finalize(); return; }

  const body = buildResultNoticeBody({
    journeyName: String(row.journey_name || ''), stepOrder: Number(row.step_order), messageSteps: Number(row.message_steps || 0),
    isLast: Number(row.step_order) === Number(row.last_message_order), sendDay: String(row.send_day),
    sentCount, countsKnown, success, fail, pending, dayTotal: decision === 'day_total',
  });
  const result = await sendNoticeOnce({
    claim: async () => (await query(
      `UPDATE journey_step_campaigns SET result_notice_attempts = result_notice_attempts + 1
        WHERE journey_id = $1::uuid AND step_id = $2::uuid AND send_date = $3::date
          AND result_notice_sent IS NOT DISTINCT FROM $4::int AND result_notice_attempts < $5
        RETURNING journey_id`,
      [...pk, oldSent, NOTICE_MAX_ATTEMPTS],
    )).rows.length > 0,
    enqueue: async () => {
      const authTable = await getAuthSmsTable();
      const inserted = await withBoundedMysql(NOTICE_ENQUEUE_TIMEOUT_MS, (run) => bulkInsertSmsQueue(
        [authTable],
        [[contact.phone, getPlatformNoticeCallback(), body, 'L', '[여정 발송 결과]', null, '', row.company_id, '', '', '']],
        true,
        undefined,
        { run },
      ));
      return inserted === 1;
    },
    finalize,
  });
  if (result === 'sent') {
    console.log(`[journey-result] ✓ 결과 안내 journey=${row.journey_name} step=${row.step_order} day=${row.send_day} 보낸 ${sentCount}(성공 ${success}/실패 ${fail}/대기 ${pending})${decision === 'day_total' ? ' 하루 합계' : ''}`);
    return;
  }
  if (result === 'not_claimed') {
    // 시도를 다 쓴 단계 = 보내지 않고 기록 + 경보(그 단계 포기 · 다음 단계는 시도 0 부터)
    const r = await query(
      `SELECT result_notice_sent, result_notice_attempts FROM journey_step_campaigns
        WHERE journey_id = $1::uuid AND step_id = $2::uuid AND send_date = $3::date`, pk,
    );
    const cur = r.rows[0];
    const sameStage = cur && (cur.result_notice_sent == null ? null : Number(cur.result_notice_sent)) === oldSent;
    if (sameStage && Number(cur.result_notice_attempts) >= NOTICE_MAX_ATTEMPTS && (await finalize())) {
      void sendSystemAlert({
        companyId: row.company_id,
        dedupKey: `journey-result-notice-giveup:${row.journey_id}`,
        message: `여정 보낸 결과 안내를 ${NOTICE_MAX_ATTEMPTS}번 보내지 못해 그 날 안내를 건너뜁니다. journey=${row.journey_id} step=${row.step_id} day=${row.send_day}`,
      }).catch(() => undefined);
    }
  }
}
