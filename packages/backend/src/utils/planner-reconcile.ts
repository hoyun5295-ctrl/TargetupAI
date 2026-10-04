/**
 * planner-reconcile.ts — 플래너 ↔ 실행 원장 대조 워커 (★ 2026-08-13 Phase 3 · 6원칙 ③)
 *
 * 플래너 터치포인트와 실제 실행(campaigns·제작물)은 **두 진실**이다. 그래서 배선과 함께 대조를 만든다 —
 * 선택이 아니라 필수다(기능 문서 §3-8).
 *
 * 잡는 것 넷:
 *   ① **놓친 실행** — 예정일이 지나도록 planned·ready로 남은 것 → 생략으로 닫고 사유 통지.
 *      ★ 2026-10-04 **미승인 행사의 접점도 닫는다**(옛: 승인된 행사만 봐서 미승인 행사는 조용히 남았다 · §6-8).
 *      (지난 날짜에 뒤늦게 보내지 않는다 — 끝난 행사 안내가 나가는 것이 더 큰 사고다.)
 *   ② **producing 고아** — 선점 lease(30분)를 넘긴 것 → 원위치로 돌려 다음 주기가 다시 본다.
 *   ③ **취소됐는데 실행 잔존** — 취소된 달에 발송·제작 참조가 남아 있으면 **사람에게 알린다**(자동 되돌림 금지).
 *   ④ **참여 클릭 미수집** — 이메일 참여 버튼 클릭을 참여 이벤트로 투영(누락 보충).
 *
 * 그리고 **패스를 구동한다** — 전환(옛 월간 결재 → 행사별 확인) · 문자 문안 준비 · 확인 링크·리마인드·준비 실패 통지 ·
 *   승인 직후 실주소 스팸 · 알림톡 검수 대행 · 결과 브리핑 통지. ★ 2026-10-04 이 워커는 생성 엔진을 부르지 않는다
 *   (소재 제작 그물 · DM 리마인드 패스 삭제 · 완성본은 사람이 [담고 만들기]를 누를 때만 만든다).
 *   별도 타이머를 만들지 않는다(어느 주기가 그 일을 하는지 흐려진다). 승인 직후 호출이 끊긴 건은
 *   전부 이 패스가 다시 집는다 — **호출부가 하나뿐인 패스는 그물이 없는 것과 같다.**
 *
 * ⛔ best-effort 경보 원칙 — 행 단위 정확 1회 보장을 쌓지 않는다(LESSONS 0731).
 *    같은 사실을 매 주기 다시 알리지 않으려고 exec_meta에 통지 표식만 남긴다.
 */
import { pool, query } from '../config/database';
import {
  guardExecMetaOrSkip,
  isEventMetaReady,
  isClaimStale,
  loadAllLiveTouchpoints,
  loadTouchpointById,
  notifyPlanner,
  releaseStaleClaim,
  setTouchpointState,
  stampExecMeta,
} from './planner-touchpoint';
import { classifyExecutionWindow, kstDateString } from './planner-execution';
import { ingestJoinClicksForCampaign } from './planner-participation';
import { runPlannerResultNotifyPass } from './planner-report';
import { runPlannerAlimtalkPass } from './planner-alimtalk';
import { runPlannerCopyPass } from './planner-copy';
import { formatPlannerDay, runPlannerReviewLinkPass, runPostApprovalSpamPass, settleEventIfFinished } from './planner-review';
import { PLANNER_PHASE1_CHANNELS } from './planner-channel-gate';
import { PLANNER_REASON } from './planner-reasons';

/** 지난 달까지 되돌아본다 — 그 이전은 브리핑·정산이 이미 닫힌 구간이다. */
function reconcileMonthFrom(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCMonth(kst.getUTCMonth() - 1);
  return kst.toISOString().slice(0, 7);
}

/** 미승인 행사도 닫는다 — 놓친 실행의 후보 행사 상태(옛 값 re_brief 포함). */
const MISSED_EVENT_STATUS = ['approved', 'producing', 'scheduled', 'done', 'briefed', 'draft', 're_brief'];

/**
 * ① 놓친 실행 — 예정일이 지난 planned·ready를 생략으로 닫고, 행사마다 통지 1건(날짜를 묶어서).
 * 사유 = 승인 각인이 있으면 "예정일이 지나" · 없으면 "승인되지 않아"(미승인 = 크레딧 0 고지).
 * 남은 접점이 없으면 행사를 닫는다(하나라도 나갔으면 발송 완료 · 아니면 취소 + 사유 표식).
 */
async function closeMissed(today: string, lookbackDate: string): Promise<number> {
  // 후보 전수(★ Codex 1R H7 · 한 페이지만 보면 앞 행이 지난 행을 가린다)
  const rows = await loadAllLiveTouchpoints({
    statuses: ['planned', 'ready'], eventStatuses: MISSED_EVENT_STATUS, scheduledFrom: lookbackDate, scheduledTo: today,
  }, { label: 'planner-reconcile closeMissed' });
  const missed = rows.filter((t) => classifyExecutionWindow(t.scheduledOn, today) === 'missed');
  let closed = 0;
  const byEvent = new Map<string, { first: (typeof missed)[number]; approved: string[]; unapproved: string[] }>();
  for (const tp of missed) {
    const approved = !!tp.execMeta?.approved;
    const ok = await setTouchpointState({
      companyId: tp.companyId, touchpointId: tp.id,
      status: 'skipped',
      fromStatuses: ['planned', 'ready'],
      lockReason: approved ? PLANNER_REASON.missed : PLANNER_REASON.notApproved,
      execMetaPatch: { missed_at: new Date().toISOString(), missed_reason: approved ? 'missed' : 'not_approved' },
    });
    if (!ok) continue;
    closed++;
    const g = byEvent.get(tp.eventId) || { first: tp, approved: [], unapproved: [] };
    const day = `${formatPlannerDay(tp.scheduledOn)} ${tp.channelLabel}`;
    (approved ? g.approved : g.unapproved).push(day);
    byEvent.set(tp.eventId, g);
  }
  for (const [eventId, g] of byEvent) {
    const tp = g.first;
    const lines: string[] = [];
    if (g.unapproved.length > 0) lines.push(`${Array.from(new Set(g.unapproved)).join(', ')} 발송은 승인되지 않아 보내지 않았습니다. 이 발송에는 크레딧이 빠지지 않았습니다.`);
    if (g.approved.length > 0) lines.push(`${Array.from(new Set(g.approved)).join(', ')} 발송은 예정일이 지나 보내지 않았습니다. 이번 발송의 문안비는 빠지지 않았습니다.`);
    await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 발송 생략', `'${tp.title}' ${lines.join(' ')}`);
    await settleEventIfFinished(tp.companyId, eventId, g.approved.length > 0 ? 'missed' : 'not_approved').catch(() => null);
  }
  return closed;
}

/** ② producing 고아 — lease 초과분을 원위치로. 통지는 반복 사유가 아니라 한 번만. */
async function recoverStale(lookbackDate: string): Promise<number> {
  const rows = await loadAllLiveTouchpoints({ statuses: ['producing'], scheduledFrom: lookbackDate }, { label: 'planner-reconcile recoverStale' });
  let recovered = 0;
  for (const tp of rows) {
    // 알림톡 검수는 producing을 쓰지 않는다(planned + exec_meta.alimtalk_stage) — 여기 있는 producing은 전부 실행 선점이다.
    if (!isClaimStale(tp.execMeta)) continue;
    const observed = String(tp.execMeta?.claimed_at || '');
    // ★ 2026-09-02 문자 1통에 실린 **동반 DM 행**은 캐리어 문자의 결과로 확정 복구한다(Codex 1R) — 캐리어가 exec_ref를 가지면
    //   그 발송에 함께 나간 것이고(sent), 캐리어가 보류·잠금이면 다시 실릴 수 있게 ready로, 생략이면 함께 생략. 캐리어가 아직 진행 중이면 기다린다.
    const carriedBy = String(tp.execMeta?.carried_by || '');
    if (tp.channel === 'dm' && carriedBy) {
      const carrier = await loadTouchpointById(tp.companyId, carriedBy).catch(() => null);
      if (carrier?.execRef) {
        const ok = await setTouchpointState({
          companyId: tp.companyId, touchpointId: tp.id, status: 'sent', fromStatuses: ['producing'], execRef: carrier.execRef, lockReason: null,
          execMetaPatch: { sent_at: new Date().toISOString(), campaign_id: carrier.execRef, recovered_from_carrier: true },
        });
        if (ok) recovered++;
        continue;
      }
      if (carrier && ['hold_credit', 'locked', 'skipped'].includes(carrier.status)) {
        const ok = await releaseStaleClaim({
          companyId: tp.companyId, touchpointId: tp.id, observedClaimedAt: observed,
          toStatus: carrier.status === 'skipped' ? 'skipped' : 'ready',
          lockReason: carrier.status === 'skipped' ? '같은 날의 문자가 생략되어 모바일 DM도 함께 생략했습니다.' : null,
          execMetaPatch: { recovered_at: new Date().toISOString() },
        });
        if (ok) recovered++;
        continue;
      }
      if (carrier && carrier.status === 'producing') continue; // 캐리어가 살아 있다 — 그쪽 판정을 기다린다
    }
    // ⛔ **발송 시도 표식이 있는데 실행 참조가 없으면 회수하지 않는다** — 보냈는지 모르는 상태를
    //   다시 발송 후보로 만들면 같은 문자가 두 번 나간다. 잠그고 사람을 부른다.
    if (tp.execMeta?.send_started_at && !tp.execRef) {
      const locked = await releaseStaleClaim({
        companyId: tp.companyId, touchpointId: tp.id, observedClaimedAt: observed, toStatus: 'locked',
        lockReason: PLANNER_REASON.sendUnknown,
      });
      if (locked) {
        recovered++;
        await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 확인 필요',
          `'${tp.title}' ${tp.channelLabel}(예정 ${formatPlannerDay(tp.scheduledOn)}) 발송 여부를 확인하지 못했습니다. 발송 결과 화면에서 확인해 주세요.`);
      }
      continue;
    }
    // ⛔ **회수는 자동 재시도가 아니다.** lease를 넘긴 작업이 아직 살아 있을 수 있고(heartbeat 사이 구간),
    //   그 상태에서 다시 발송 후보로 만들면 두 워커가 각각 커밋한다. 그래서 **locked(사람 판정)로 보낸다** —
    //   담당자가 [다시 시작]을 누르면 그때 정상 경로로 재개된다(제작비·발송 멱등키가 이중 과금을 막는다).
    const ok = await releaseStaleClaim({
      companyId: tp.companyId, touchpointId: tp.id, observedClaimedAt: observed, toStatus: 'locked',
      lockReason: PLANNER_REASON.stalled,
      execMetaPatch: { recovered_at: new Date().toISOString() },
    });
    if (ok) {
      await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 확인 필요',
        `'${tp.title}' ${tp.channelLabel}(예정 ${formatPlannerDay(tp.scheduledOn)}) ${PLANNER_REASON.stalled}`);
    }
    if (ok) recovered++;
  }
  return recovered;
}

/** ③ 취소됐는데 실행 잔존 — 자동 복구 대상이 아니다(사람이 판단한다). 회사당 1회만 알린다. */
async function reportCancelledLeftovers(): Promise<number> {
  const r = await query(
    `SELECT t.id, t.company_id, t.channel, t.exec_ref, e.title, e.created_by, e.plan_month
       FROM planner_touchpoints t
       JOIN planner_events e ON e.id = t.event_id AND e.company_id = t.company_id
      WHERE e.status = 'cancelled'
        AND (t.exec_ref IS NOT NULL OR t.status = 'sent')
        AND COALESCE(t.exec_meta->>'cancel_leftover_notified', '') = ''
      LIMIT 100`,
  );
  let reported = 0;
  for (const row of r.rows as any[]) {
    await notifyPlanner(String(row.company_id), row.created_by ? String(row.created_by) : null,
      '[마케팅 플래너] 확인 필요',
      `취소한 '${String(row.title)}' 계획에 이미 실행된 발송 기록이 있습니다(${String(row.plan_month)}). 발송 결과를 확인해 주세요.`);
    // ⛔ 표식만 남긴다 — 상태를 함께 쓰면 취소로 닫힌 행이 발송으로 되돌아간다.
    await stampExecMeta(String(row.company_id), String(row.id), { cancel_leftover_notified: new Date().toISOString() })
      .catch(() => { /* 표식 실패 = 다음 주기 재알림(중복이 침묵보다 낫다) */ });
    reported++;
  }
  return reported;
}

/** ④ 참여 클릭 → 참여 이벤트 투영 보충(발송 직후 1회는 실행부가 이미 돌렸다). */
async function sweepJoinClicks(monthFrom: string): Promise<number> {
  const r = await query(
    `SELECT t.id, t.company_id, t.event_id, t.asset_ref
       FROM planner_touchpoints t
       JOIN planner_events e ON e.id = t.event_id AND e.company_id = t.company_id
      WHERE t.channel = 'email' AND t.status = 'sent' AND t.asset_ref IS NOT NULL
        AND e.plan_month >= $1
      LIMIT 200`,
    [monthFrom],
  );
  let inserted = 0;
  for (const row of r.rows as any[]) {
    try {
      const res = await ingestJoinClicksForCampaign({
        companyId: String(row.company_id),
        emailCampaignId: String(row.asset_ref),
        plannerEventId: String(row.event_id),
        touchpointId: String(row.id),
      });
      inserted += res.inserted;
    } catch (e: any) {
      console.warn(`[planner-reconcile] 참여 수집 실패 tp=${row.id}:`, e?.message || e);
    }
  }
  return inserted;
}

/**
 * ⓪ 전환(★ 2026-10-04 §8 · 회의론자 M8·M9) — 옛 월간 결재 흐름의 행사를 행사별 확인 흐름으로 옮긴다. **멱등**(새 흐름 표식 = meta.revision).
 *   - 끝난 행사(ends_on < 오늘)의 남은 접점 = 생략 · 행사 = 발송 완료(하나라도 나갔으면) 또는 취소.
 *   - 진행 중·이후 행사(옛 draft · briefed · approved · producing · scheduled · re_brief) = 남은 접점을 승인 전(planned)으로 · 행사 = 재료 단계(draft).
 *     문자만 있는 행사는 문안 패스가 문안을 만들어 확인 대기로 올리고, 모바일 DM·메일은 재료를 넣어 다시 만든다(옛 DM 초안은 이어 쓰지 않는다).
 *     대행료는 같은 회차 키라 다시 승인해도 두 번 빠지지 않는다.
 *   - 1차 채널 밖(인앱·알림톡)의 남은 접점 = 생략.
 *   - 발송 여부를 모르는 행(시도 표식 · 참조 없음)과 진행 중(producing)이 있는 행사는 건드리지 않는다(고아 회수 · 사람 판정이 먼저 · 다음 주기에 다시 본다).
 * 데이터 의미 변경은 그 의미를 아는 코드가 배포된 뒤에만 — 그래서 수동 SQL이 아니라 이 패스다(meta 칸이 있을 때만 돈다).
 */
async function transitionLegacyEvents(today: string): Promise<number> {
  if (!(await isEventMetaReady())) return 0;
  const client = await pool.connect();
  let moved = 0;
  // 옛 행사 = 새 흐름 표식(revision)이 없고 아직 닫히지 않았고 진행 중(producing) 접점이 없는 것
  const legacy = `NOT (COALESCE(e.meta, '{}'::jsonb) ? 'revision')
          AND e.status NOT IN ('done', 'reported', 'cancelled')
          AND NOT EXISTS (SELECT 1 FROM planner_touchpoints x WHERE x.event_id = e.id AND x.company_id = e.company_id AND x.status = 'producing')`;
  const settled = `NOT ((t.exec_meta ? 'send_started_at') AND t.exec_ref IS NULL)`;
  try {
    await client.query('BEGIN');
    // 끝난 옛 행사 — 남은 접점 생략
    await client.query(
      `UPDATE planner_touchpoints t SET status = 'skipped', lock_reason = $2
         FROM planner_events e
        WHERE e.id = t.event_id AND e.company_id = t.company_id AND ${legacy}
          AND e.ends_on < $1::date
          AND t.status IN ('planned', 'ready', 'hold_credit', 'locked') AND ${settled}`,
      [today, PLANNER_REASON.missed],
    );
    // 이후 옛 행사 — 1차 채널 밖 접점 생략
    await client.query(
      `UPDATE planner_touchpoints t SET status = 'skipped', lock_reason = $2
         FROM planner_events e
        WHERE e.id = t.event_id AND e.company_id = t.company_id AND ${legacy}
          AND e.ends_on >= $1::date
          AND NOT (t.channel = ANY($3))
          AND t.status IN ('planned', 'ready', 'hold_credit', 'locked') AND ${settled}`,
      [today, PLANNER_REASON.notInPhase1, PLANNER_PHASE1_CHANNELS],
    );
    // 이후 옛 행사 — 남은 접점을 승인 전으로(옛 DM 단계 표식 제거)
    await client.query(
      `UPDATE planner_touchpoints t
          SET status = 'planned', lock_reason = NULL,
              exec_meta = COALESCE(t.exec_meta, '{}'::jsonb) - 'approved' - 'dm_stage' - 'dm_url' - 'dm_residue' - 'waiting_for_dm' - 'waiting_reason' - 'post_approval_spam'
         FROM planner_events e
        WHERE e.id = t.event_id AND e.company_id = t.company_id AND ${legacy}
          AND e.ends_on >= $1::date
          AND t.status IN ('planned', 'ready', 'hold_credit', 'locked') AND ${settled}`,
      [today],
    );
    // 행사 — 끝난 것은 닫고(남은 접점이 없을 때만), 이후 것은 재료 단계로 · 새 흐름 표식(revision 1 · migrated)
    const ended = await client.query(
      `UPDATE planner_events e
          SET status = CASE WHEN EXISTS (SELECT 1 FROM planner_touchpoints s WHERE s.event_id = e.id AND s.company_id = e.company_id AND s.status = 'sent')
                            THEN 'done' ELSE 'cancelled' END,
              meta = COALESCE(e.meta, '{}'::jsonb) || jsonb_build_object('revision', 1, 'migrated', jsonb_build_object('at', to_jsonb(NOW()), 'from', e.status), 'closedReason', 'missed'),
              updated_at = NOW()
        WHERE ${legacy}
          AND e.ends_on < $1::date
          AND NOT EXISTS (SELECT 1 FROM planner_touchpoints p WHERE p.event_id = e.id AND p.company_id = e.company_id AND p.status NOT IN ('sent', 'skipped'))
        RETURNING e.id`,
      [today],
    );
    const live = await client.query(
      `UPDATE planner_events e
          SET status = 'draft',
              meta = COALESCE(e.meta, '{}'::jsonb) || jsonb_build_object('revision', 1, 'migrated', jsonb_build_object('at', to_jsonb(NOW()), 'from', e.status)),
              updated_at = NOW()
        WHERE ${legacy}
          AND e.ends_on >= $1::date
          AND NOT EXISTS (SELECT 1 FROM planner_touchpoints p WHERE p.event_id = e.id AND p.company_id = e.company_id
                           AND p.status IN ('ready', 'hold_credit', 'locked'))
        RETURNING e.id`,
      [today],
    );
    await client.query('COMMIT');
    moved = ended.rows.length + live.rows.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* 원 오류 우선 */ });
    throw err;
  } finally {
    client.release();
  }
  if (moved > 0) console.log(`[planner-reconcile] 옛 월간 결재 행사 전환 ${moved}건(행사별 확인 흐름)`);
  return moved;
}

/** 대조 패스 — 1시간 주기. 발견은 통지, 자동 복구는 모호하지 않은 것만. */
let reconcileRunning = false;

export async function runPlannerReconcilePass(): Promise<{ missed: number; recovered: number; leftovers: number; joins: number }> {
  // ⛔ 한 번에 하나만 돈다 — 참여 투영이 이 패스 안에만 있어서, 겹치지 않으면 중복 적재가 구조적으로 불가능하다.
  if (reconcileRunning) return { missed: 0, recovered: 0, leftovers: 0, joins: 0 };
  reconcileRunning = true;
  try {
    return await reconcilePass();
  } finally {
    reconcileRunning = false;
  }
}

async function reconcilePass(): Promise<{ missed: number; recovered: number; leftovers: number; joins: number }> {
  if (!(await guardExecMetaOrSkip('planner-reconcile'))) return { missed: 0, recovered: 0, leftovers: 0, joins: 0 };
  const now = new Date();
  const today = kstDateString(now);
  const monthFrom = reconcileMonthFrom(now);

  // ⓪ 전환을 먼저 — 옛 승인 행사가 새 실행 조건(승인 각인)에 걸려 조용히 미발송되기 전에 재료·확인 단계로 옮긴다.
  await transitionLegacyEvents(today).catch((e: any) => console.error('[planner-reconcile] 전환 실패:', e?.message || e));
  const missed = await closeMissed(today, `${monthFrom}-01`).catch((e: any) => {
    console.error('[planner-reconcile] 놓친 실행 정리 실패:', e?.message || e); return 0;
  });
  const recovered = await recoverStale(`${monthFrom}-01`).catch((e: any) => {
    console.error('[planner-reconcile] 고아 회수 실패:', e?.message || e); return 0;
  });
  const leftovers = await reportCancelledLeftovers().catch((e: any) => {
    console.error('[planner-reconcile] 취소 잔존 점검 실패:', e?.message || e); return 0;
  });
  const joins = await sweepJoinClicks(monthFrom).catch((e: any) => {
    console.error('[planner-reconcile] 참여 수집 실패:', e?.message || e); return 0;
  });
  // ★ 2026-10-04 행사별 확인 흐름 — 반드시 closeMissed **뒤**(지난 접점을 먼저 닫아야 지나간 행사에 문안·링크를 만들지 않는다).
  //   문안 준비(원가 0 · AI 상한 20) → 확인 링크·리마인드·준비 실패 통지 → 승인 직후 실주소 스팸.
  await runPlannerCopyPass().catch((e: any) => console.error('[planner-reconcile] 문안 준비 실패:', e?.message || e));
  await runPlannerReviewLinkPass().catch((e: any) => console.error('[planner-reconcile] 확인 링크 실패:', e?.message || e));
  await runPostApprovalSpamPass().catch((e: any) => console.error('[planner-reconcile] 승인 직후 스팸 검사 실패:', e?.message || e));
  // ⛔ 알림톡 검수 대행도 여기서 돈다 — 별도 타이머를 두지 않는다(검수는 하루 단위 절차라 시간당 1회로 충분하고,
  //   타이머가 늘면 "어느 주기가 그 일을 하는지"가 흐려진다). 상태 추적의 원천은 30분 동기화 워커다.
  await runPlannerAlimtalkPass().catch((e: any) =>
    console.error('[planner-reconcile] 알림톡 검수 대행 실패:', e?.message || e));
  await runPlannerResultNotifyPass().catch((e: any) =>
    console.error('[planner-reconcile] 결과 브리핑 통지 실패:', e?.message || e));

  if (missed + recovered + leftovers + joins > 0) {
    console.log(`[planner-reconcile] 생략 ${missed} · 회수 ${recovered} · 취소잔존 ${leftovers} · 참여 ${joins}`);
  }
  return { missed, recovered, leftovers, joins };
}

let reconcileTimer: NodeJS.Timeout | null = null;
let reconcileBoot: NodeJS.Timeout | null = null;

/**
 * 대조 스케줄러 — 부팅 후 2분에 첫 실행, 이후 1시간 주기.
 * ⛔ 첫 실행이 없으면 재기동할 때마다 **한 시간 동안** 놓친 실행·고아·제작 그물이 전부 멈춘다
 *   (배포가 잦은 날 그 공백이 곧 미발송이다). 지연을 두는 이유는 startup 안정화 —
 *   실행 워커(1분)보다 늦게 두어 부팅 직후 DB·외부 호출이 한꺼번에 몰리지 않게 한다.
 */
export function startPlannerReconcileWorker(): void {
  if (reconcileTimer || reconcileBoot) return;
  const INTERVAL_MS = 60 * 60 * 1000;
  const BOOT_DELAY_MS = 2 * 60 * 1000;
  const tick = () => {
    void runPlannerReconcilePass().catch((e: any) => console.error('[planner-reconcile] 주기 실행 실패:', e?.message || e));
  };
  reconcileBoot = setTimeout(() => {
    reconcileBoot = null;
    tick();
    reconcileTimer = setInterval(tick, INTERVAL_MS);
  }, BOOT_DELAY_MS);
  console.log('[planner-reconcile] 마케팅 플래너 대조 워커 시작 (부팅 2분 뒤 첫 실행 · 이후 1시간 주기)');
}
