/**
 * planner-report.ts — 결과 브리핑 (★ 2026-08-13 Phase 4 · 인계 §4-⑥)
 *
 * 승인 후 무인 완주의 마지막 조각. **수치는 전부 실측이다** — 목업·추정 금지(기능 문서 §3-6).
 *   문자·DM·알림톡 = `campaigns`(발송 결과 동기화 워커가 채우는 성공·실패 실측)
 *   이메일 = `email_campaigns`(발송·오픈·클릭 실측) · 인앱 = 게시 여부·기간 · 참여자 = cdp_events 실쿼리
 *
 * ⛔ 결과를 다른 표에 복사하지 않는다 — 원본을 읽는다(진실 복사 금지).
 * ⛔ 월말 통지는 **월간 1회**다(`planner_monthly_approvals.result_notified_at` 멱등).
 *    그 컬럼은 배포 후 DDL이라, 없으면 통지 패스만 조용히 쉰다(결과 화면은 컬럼과 무관하게 동작한다).
 */
import { query } from '../config/database';
import { PlannerChannel, PLANNER_CHANNEL_LABEL, computeTouchpointDate, TimingRule } from './marketing-planner';
import { countPlannerParticipants } from './planner-participation';
import { currentPlanMonth } from './planner-approval';
import { notifyPlanner, setEventStatus } from './planner-touchpoint';

export interface ResultMetric {
  /** 화면 라벨(고객 언어) */
  label: string;
  value: string;
}

export interface ResultTouchpoint {
  id: string;
  channel: PlannerChannel;
  channelLabel: string;
  scheduledOn: string;
  status: string;
  lockReason: string | null;
  /** 실측 지표 — 없으면 빈 배열(0을 만들어 넣지 않는다). */
  metrics: ResultMetric[];
}

export interface ResultEvent {
  id: string;
  title: string;
  startsOn: string;
  endsOn: string;
  status: string;
  participants: number;
  touchpoints: ResultTouchpoint[];
}

export interface MonthlyResult {
  month: string;
  events: ResultEvent[];
  totals: {
    touchpointCount: number;
    sentCount: number;
    /** 발송 성공 실측 합(동기화된 값만) */
    successCount: number;
    participants: number;
  };
  notifiedAt: string | null;
}

function fmt(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString();
}

/** 월간 결과 — 결재 화면의 [결과] 탭이 그대로 쓰는 값. */
export async function loadMonthlyResult(companyId: string, planMonth: string): Promise<MonthlyResult> {
  const evRes = await query(
    // ★ 2026-08-21 date 컬럼은 `::text`로 받는다(임은지 접수 · 계약 = planner-date-contract.test.ts).
    `SELECT id, title, starts_on::text AS starts_on, ends_on::text AS ends_on, status
       FROM planner_events
      WHERE company_id = $1::uuid AND plan_month = $2 AND status <> 'cancelled'
      ORDER BY starts_on ASC, created_at ASC`,
    [companyId, planMonth],
  );
  const eventIds = evRes.rows.map((r: any) => r.id);
  const tpRows = eventIds.length > 0
    ? (await query(
        `SELECT id, event_id, channel, timing_rule, status, lock_reason, asset_ref, exec_ref
           FROM planner_touchpoints
          WHERE event_id = ANY($1) AND company_id = $2::uuid
          ORDER BY created_at ASC`,
        [eventIds, companyId],
      )).rows
    : [];

  // 실측 원본 조회 — 캠페인·이메일 캠페인을 한 번에 읽어 맵으로 (N+1 회피).
  const campaignIds = tpRows.filter((t: any) => t.exec_ref && t.channel !== 'email' && t.channel !== 'inapp').map((t: any) => t.exec_ref);
  const emailIds = tpRows.filter((t: any) => t.channel === 'email' && (t.asset_ref || t.exec_ref)).map((t: any) => t.asset_ref || t.exec_ref);
  const campaignMap = new Map<string, any>();
  if (campaignIds.length > 0) {
    const c = await query(
      `SELECT id, target_count, sent_count, success_count, fail_count, status
         FROM campaigns WHERE id = ANY($1::uuid[]) AND company_id = $2::uuid`,
      [campaignIds, companyId],
    );
    for (const row of c.rows as any[]) campaignMap.set(String(row.id), row);
  }
  const emailMap = new Map<string, any>();
  if (emailIds.length > 0) {
    const e = await query(
      `SELECT id, sent_count, open_count, click_count, status
         FROM email_campaigns WHERE id = ANY($1::uuid[]) AND company_id = $2::uuid`,
      [emailIds, companyId],
    );
    for (const row of e.rows as any[]) emailMap.set(String(row.id), row);
  }

  let touchpointCount = 0;
  let sentCount = 0;
  let successCount = 0;
  let participantsTotal = 0;
  const events: ResultEvent[] = [];

  for (const ev of evRes.rows as any[]) {
    const startsOn = String(ev.starts_on).slice(0, 10);
    const endsOn = String(ev.ends_on).slice(0, 10);
    const participants = await countPlannerParticipants(companyId, String(ev.id)).catch(() => 0);
    participantsTotal += participants;
    const list: ResultTouchpoint[] = [];
    for (const t of tpRows.filter((x: any) => String(x.event_id) === String(ev.id)) as any[]) {
      touchpointCount++;
      const channel = t.channel as PlannerChannel;
      const metrics: ResultMetric[] = [];
      if (channel === 'email') {
        const row = emailMap.get(String(t.asset_ref || t.exec_ref));
        if (row) {
          sentCount += Number(row.sent_count) || 0;
          metrics.push({ label: '발송', value: fmt(row.sent_count) });
          metrics.push({ label: '열어봄', value: fmt(row.open_count) });
          metrics.push({ label: '클릭', value: fmt(row.click_count) });
        }
      } else if (channel === 'inapp') {
        if (t.status === 'sent') metrics.push({ label: '게시', value: `${startsOn} ~ ${endsOn}` });
      } else {
        const row = campaignMap.get(String(t.exec_ref));
        if (row) {
          sentCount += Number(row.target_count) || 0;
          successCount += Number(row.success_count) || 0;
          metrics.push({ label: '대상', value: fmt(row.target_count) });
          metrics.push({ label: '성공', value: fmt(row.success_count) });
          if (Number(row.fail_count) > 0) metrics.push({ label: '실패', value: fmt(row.fail_count) });
        }
      }
      list.push({
        id: String(t.id),
        channel,
        channelLabel: PLANNER_CHANNEL_LABEL[channel] || String(channel),
        scheduledOn: computeTouchpointDate((t.timing_rule || {}) as TimingRule, startsOn, endsOn),
        status: String(t.status),
        lockReason: t.lock_reason || null,
        metrics,
      });
    }
    events.push({
      id: String(ev.id),
      title: String(ev.title),
      startsOn,
      endsOn,
      status: String(ev.status),
      participants,
      touchpoints: list,
    });
  }

  let notifiedAt: string | null = null;
  try {
    const a = await query(
      `SELECT result_notified_at FROM planner_monthly_approvals
        WHERE company_id = $1::uuid AND plan_month = $2`,
      [companyId, planMonth],
    );
    notifiedAt = a.rows[0]?.result_notified_at ? new Date(a.rows[0].result_notified_at).toISOString() : null;
  } catch (e: any) {
    // 컬럼·표 미생성(42703/42P01) = 통지 이력만 모른다. 결과 자체는 그대로 보여준다.
    if (e?.code !== '42703' && e?.code !== '42P01') throw e;
  }

  return {
    month: planMonth,
    events,
    totals: { touchpointCount, sentCount, successCount, participants: participantsTotal },
    notifiedAt,
  };
}

// ── 월말 통지 ────────────────────────────────────────────────────────
let notifyColumnReady: boolean | null = null;

/** `result_notified_at` 실재 확인 — 양성만 캐시(ALTER 후 자가 치유). */
async function isNotifyColumnReady(): Promise<boolean> {
  if (notifyColumnReady === true) return true;
  try {
    const r = await query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'planner_monthly_approvals' AND column_name = 'result_notified_at'`,
    );
    notifyColumnReady = r.rows.length > 0;
    return notifyColumnReady;
  } catch {
    return false;
  }
}

/** (순수) 통지 문구 — 결과 요약. 혜택·광고 표현을 넣지 않는다(담당자 안내). */
export function buildResultNoticeBody(result: MonthlyResult): string {
  const monthLabel = `${Number(result.month.slice(5, 7))}월`;
  return [
    `${monthLabel} 마케팅 결과 안내입니다.`,
    `행사 ${result.events.length}건 · 채널 ${result.totals.touchpointCount}개`,
    `발송 ${fmt(result.totals.sentCount)}건 · 성공 ${fmt(result.totals.successCount)}건`,
    result.totals.participants > 0 ? `행사 참여 신청 ${fmt(result.totals.participants)}명` : '',
    '자세한 내용은 플래너 결재 화면의 결과 탭에서 확인할 수 있습니다.',
  ].filter(Boolean).join('\n');
}

/**
 * 월말 결과 통지 — 지난 달 승인분 중 아직 안 보낸 것에 1통. 행사는 done → reported로 닫는다.
 * ⛔ 컬럼(`result_notified_at`)이 없으면 아무것도 하지 않는다 — 멱등 근거 없이 통지하면 매 주기 문자가 간다.
 */
export async function runPlannerResultNotifyPass(): Promise<{ notified: number }> {
  if (!(await isNotifyColumnReady())) return { notified: 0 };
  const thisMonth = currentPlanMonth();
  const targets = await query(
    `SELECT company_id, plan_month FROM planner_monthly_approvals
      WHERE status = 'approved' AND plan_month < $1 AND result_notified_at IS NULL
      ORDER BY plan_month ASC LIMIT 50`,
    [thisMonth],
  );
  let notified = 0;
  for (const row of targets.rows as any[]) {
    const companyId = String(row.company_id);
    const planMonth = String(row.plan_month);
    try {
      const result = await loadMonthlyResult(companyId, planMonth);
      if (result.events.length === 0) {
        // 보낼 결과가 없다 — 다시 집지 않게 표식만 남긴다(빈 통지 금지).
        await query(
          `UPDATE planner_monthly_approvals SET result_notified_at = NOW(), updated_at = NOW()
            WHERE company_id = $1::uuid AND plan_month = $2 AND result_notified_at IS NULL`,
          [companyId, planMonth],
        );
        continue;
      }
      const creator = await query(
        `SELECT created_by FROM planner_events
          WHERE company_id = $1::uuid AND plan_month = $2 AND created_by IS NOT NULL LIMIT 1`,
        [companyId, planMonth],
      );
      const sent = await notifyPlanner(
        companyId,
        creator.rows[0]?.created_by ? String(creator.rows[0].created_by) : null,
        '[마케팅 플래너] 월간 결과 안내',
        buildResultNoticeBody(result),
      );
      // ⛔ 통지가 한 통도 못 나갔으면 표식을 남기지 않는다 — 번호를 채우면 다음 주기에 나간다
      //    (0803 0건 통지 교훈: 효과가 끝난 뒤에만 기록을 확정한다).
      if (!sent) continue;
      await query(
        `UPDATE planner_monthly_approvals SET result_notified_at = NOW(), updated_at = NOW()
          WHERE company_id = $1::uuid AND plan_month = $2 AND result_notified_at IS NULL`,
        [companyId, planMonth],
      );
      for (const ev of result.events) {
        await setEventStatus(companyId, ev.id, 'reported', ['done']).catch(() => { /* 다음 주기 */ });
      }
      notified++;
      console.log(`[planner-report] 월간 결과 통지 ${companyId} ${planMonth}`);
    } catch (e: any) {
      console.error(`[planner-report] 결과 통지 실패 ${companyId} ${planMonth}:`, e?.message || e);
    }
  }
  return { notified };
}
