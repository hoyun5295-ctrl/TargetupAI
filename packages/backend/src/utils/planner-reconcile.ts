/**
 * planner-reconcile.ts — 플래너 ↔ 실행 원장 대조 워커 (★ 2026-08-13 Phase 3 · 6원칙 ③)
 *
 * 플래너 터치포인트와 실제 실행(campaigns·제작물)은 **두 진실**이다. 그래서 배선과 함께 대조를 만든다 —
 * 선택이 아니라 필수다(기능 문서 §3-8).
 *
 * 잡는 것 넷:
 *   ① **놓친 실행** — 승인됐는데 예정일이 지나도록 planned·ready로 남은 것 → 생략으로 닫고 사유 통지.
 *      (지난 날짜에 뒤늦게 보내지 않는다 — 끝난 행사 안내가 나가는 것이 더 큰 사고다.)
 *   ② **producing 고아** — 선점 lease(30분)를 넘긴 것 → 원위치로 돌려 다음 주기가 다시 본다.
 *   ③ **취소됐는데 실행 잔존** — 취소된 달에 발송·제작 참조가 남아 있으면 **사람에게 알린다**(자동 되돌림 금지).
 *   ④ **참여 클릭 미수집** — 이메일 참여 버튼 클릭을 참여 이벤트로 투영(누락 보충).
 *
 * 그리고 **패스 셋을 구동한다** — 소재 제작 그물 · 알림톡 검수 대행 · 결과 브리핑 통지.
 *   별도 타이머를 만들지 않는다(어느 주기가 그 일을 하는지 흐려진다). 승인 직후 호출이 끊긴 건은
 *   전부 이 패스가 다시 집는다 — **호출부가 하나뿐인 패스는 그물이 없는 것과 같다.**
 *
 * ⛔ best-effort 경보 원칙 — 행 단위 정확 1회 보장을 쌓지 않는다(LESSONS 0731).
 *    같은 사실을 매 주기 다시 알리지 않으려고 exec_meta에 통지 표식만 남긴다.
 */
import { query } from '../config/database';
import {
  guardExecMetaOrSkip,
  isClaimStale,
  loadLiveTouchpoints,
  loadTouchpointById,
  notifyPlanner,
  releaseStaleClaim,
  setTouchpointState,
  stampExecMeta,
} from './planner-touchpoint';
import { carrierKey, classifyExecutionWindow, dmStageOf, kstDateString } from './planner-execution';
import { ingestJoinClicksForCampaign } from './planner-participation';
import { runPlannerResultNotifyPass } from './planner-report';
import { runPlannerAlimtalkPass } from './planner-alimtalk';
import { runPlannerDmReminderPass, runPlannerProductionPass } from './planner-production';

/** 지난 달까지 되돌아본다 — 그 이전은 브리핑·정산이 이미 닫힌 구간이다. */
function reconcileMonthFrom(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCMonth(kst.getUTCMonth() - 1);
  return kst.toISOString().slice(0, 7);
}

/**
 * ① 놓친 실행 — 예정일이 지난 planned·ready를 생략으로 닫는다.
 * ★ 2026-09-02 사유가 **왜** 안 나갔는지를 말한다 — 모바일 DM이 발행되지 않아 기다리다 넘긴 문자와 그 DM은
 *   "DM이 마무리되지 않아"로 닫고, 같은 행사·같은 시점의 문자+DM 쌍은 통지를 **한 번만** 보낸다(두 통이면 담당자가 두 사고로 읽는다).
 */
async function closeMissed(today: string, monthFrom: string): Promise<number> {
  const rows = await loadLiveTouchpoints({ statuses: ['planned', 'ready'], monthFrom, limit: 500 });
  const missed = rows.filter((t) => classifyExecutionWindow(t.scheduledOn, today) === 'missed');
  // 쌍 판정은 표식이 아니라 **구조**로 — 같은 행사·같은 날·같은 대상(carrierKey) 묶음에 미발행 DM이 있으면 그 묶음 전체가 "DM 미완성" 사유다.
  //   (표식 waiting_for_dm은 실행 워커가 그날 한 번이라도 돌아야 찍히므로 그것만 믿으면 통지가 둘로 갈린다 — 적대 검토 지적)
  const groups = new Map<string, typeof missed>();
  for (const t of missed) {
    if (t.channel !== 'sms' && t.channel !== 'dm') continue;
    const k = `${t.eventId}:${carrierKey(t.scheduledOn, t.timing)}`;
    groups.set(k, [...(groups.get(k) || []), t]);
  }
  const dmRelatedKeys = new Set<string>();
  for (const [k, group] of groups) {
    if (group.some((t) => t.channel === 'dm' && dmStageOf(t.execMeta) !== 'published') || group.some((t) => t.channel === 'sms' && !!t.execMeta?.waiting_for_dm)) {
      dmRelatedKeys.add(k);
    }
  }
  let closed = 0;
  const notifiedPairs = new Set<string>();
  for (const tp of missed) {
    const pairKey = `${tp.eventId}:${carrierKey(tp.scheduledOn, tp.timing)}`;
    const dmRelated = (tp.channel === 'sms' || tp.channel === 'dm') && dmRelatedKeys.has(pairKey);
    const reason = dmRelated
      ? `모바일 DM이 예정일(${tp.scheduledOn})까지 완성·발행되지 않아 문자를 보내지 않았습니다.`
      : `예정일(${tp.scheduledOn})이 지나 발송하지 않았습니다.`;
    const ok = await setTouchpointState({
      companyId: tp.companyId, touchpointId: tp.id,
      status: 'skipped',
      fromStatuses: ['planned', 'ready'],
      lockReason: reason,
      execMetaPatch: { missed_at: new Date().toISOString(), ...(dmRelated ? { missed_reason: 'dm_unpublished' } : {}) },
    });
    if (!ok) continue;
    closed++;
    if (dmRelated) {
      // 문자+DM 쌍 → 통지 1건. 차감 축을 정확히 말한다(당일 문안비는 안 나갔고, 이미 나간 제작비·발행비는 그대로다).
      if (notifiedPairs.has(pairKey)) continue;
      notifiedPairs.add(pairKey);
      const dmRow = (groups.get(pairKey) || []).find((t) => t.channel === 'dm');
      const residue = String(dmRow?.execMeta?.dm_residue || '');
      await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 발송 생략',
        `'${tp.title}' ${tp.scheduledOn} 문자는 모바일 DM이 마무리되지 않아 보내지 않았습니다${residue ? ` (남은 자리: ${residue})` : ''}. 이번 발송 요금(당일 문안)은 차감되지 않았고, 이미 차감된 제작비·발행비는 그대로입니다. 필요하면 계획을 다시 세워 결재에 올려주세요.`);
      continue;
    }
    await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 발송 생략',
      `'${tp.title}' ${tp.channelLabel}(예정 ${tp.scheduledOn})이 예정일에 발송되지 않아 생략 처리했습니다. 필요하면 계획을 다시 세워 결재에 올려주세요.`);
  }
  return closed;
}

/** ② producing 고아 — lease 초과분을 원위치로. 통지는 반복 사유가 아니라 한 번만. */
async function recoverStale(monthFrom: string): Promise<number> {
  const rows = await loadLiveTouchpoints({ statuses: ['producing'], monthFrom, limit: 500 });
  let recovered = 0;
  for (const tp of rows) {
    // ★ 2026-08-13 Codex 2R: 알림톡 검수는 producing을 쓰지 않는다(planned + exec_meta.alimtalk_stage) —
    //   그래서 여기 있는 producing은 전부 실행·제작 선점이다. 예외 분기가 사라졌다.
    // ★ 2026-09-02 모바일 DM 초안 대기도 같은 계약이다 — planned + exec_meta.dm_stage='drafted'로 두고 **절대 producing에 두지 않는다**.
    //   발행 감지는 planned → ready 단일 CAS라 여기 회수 대상이 될 일이 없다.
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
        lockReason: '발송 여부를 확인하지 못했습니다. 발송 내역 확인이 필요합니다.',
      });
      if (locked) {
        recovered++;
        await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 확인 필요',
          `'${tp.title}' ${tp.channelLabel}(예정 ${tp.scheduledOn}) 발송 여부를 확인하지 못했습니다. 발송 내역을 확인해 주세요.`);
      }
      continue;
    }
    // ⛔ **회수는 자동 재시도가 아니다.** lease를 넘긴 작업이 아직 살아 있을 수 있고(heartbeat 사이 구간),
    //   그 상태에서 다시 발송 후보로 만들면 두 워커가 각각 커밋한다. 그래서 **locked(사람 판정)로 보낸다** —
    //   담당자가 [다시 시작]을 누르면 그때 정상 경로로 재개된다(제작비·발송 멱등키가 이중 과금을 막는다).
    const ok = await releaseStaleClaim({
      companyId: tp.companyId, touchpointId: tp.id, observedClaimedAt: observed, toStatus: 'locked',
      lockReason: '진행이 오래 멈춰 있어 자동 진행을 중단했습니다. 확인 후 [다시 시작]을 눌러주세요.',
      execMetaPatch: { recovered_at: new Date().toISOString() },
    });
    if (ok) {
      await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 확인 필요',
        `'${tp.title}' ${tp.channelLabel}(예정 ${tp.scheduledOn}) 진행이 오래 멈춰 자동 진행을 중단했습니다. 확인 후 [다시 시작]을 눌러주세요.`);
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

  const missed = await closeMissed(today, monthFrom).catch((e: any) => {
    console.error('[planner-reconcile] 놓친 실행 정리 실패:', e?.message || e); return 0;
  });
  const recovered = await recoverStale(monthFrom).catch((e: any) => {
    console.error('[planner-reconcile] 고아 회수 실패:', e?.message || e); return 0;
  });
  const leftovers = await reportCancelledLeftovers().catch((e: any) => {
    console.error('[planner-reconcile] 취소 잔존 점검 실패:', e?.message || e); return 0;
  });
  const joins = await sweepJoinClicks(monthFrom).catch((e: any) => {
    console.error('[planner-reconcile] 참여 수집 실패:', e?.message || e); return 0;
  });
  // ⛔ **소재 제작 그물** (★ 2026-08-13 정정 — 선언만 있고 실체가 없던 자리).
  //   승인 직후 제작은 라우트의 best-effort 한 번뿐이라, 그 호출이 일시 실패로 planned에 되돌아오거나
  //   그 사이 프로세스가 재기동되면 소재가 **예정일 당일에야** 만들어지고 그날 실패하면 그 행사는 못 나간다.
  //   ⛔ 반드시 closeMissed **뒤**에 둔다 — 예정일이 지난 터치포인트를 먼저 닫아야
  //   지나간 계획의 소재를 제작해 크레딧이 나가지 않는다.
  await runPlannerProductionPass().catch((e: any) =>
    console.error('[planner-reconcile] 소재 제작 그물 실패:', e?.message || e));
  // ★ 2026-09-02 초안 대기 DM의 예정일 하루 전 리마인드 — 발행 전에는 그 시점 문자가 나가지 않으므로 마지막 통지다.
  await runPlannerDmReminderPass(today).catch((e: any) =>
    console.error('[planner-reconcile] DM 발행 리마인드 실패:', e?.message || e));
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
