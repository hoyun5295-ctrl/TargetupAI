/**
 * journey-weekly-check.ts — 주간 회사 묶음 스팸 검사 워커(★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-9 · §0-1 · D10).
 *
 * 왜 있나
 *   보내기 전 검사는 「2시간 안에 나갈 실행」에 묶여, 바로 보내는 칸 · 한동안 발송이 없던 칸은 통과한 글이 몇 주씩 다시 검사되지 않았다.
 *   → 일요일 21:00(KST)부터 켜진 여정의 문자 칸 판 전부를 회사 돌아가며 · 다음 발송이 이른 칸부터 한 칸씩 검사한다(카카오 0 · 진행 중 실행 0 인 칸 포함).
 *   이어 하기 = DB 기준(이번 주 시작 뒤 그 칸 지금 판의 결정 기록 · 보류면 수정안 일까지 · 판정 = journey-pretest-notifier weeklyCheckRows 의 SQL · LIMIT 앞) · 1분마다 남은 칸 하나.
 *   검사는 한 번에 하나를 걸고 끝을 기다린다(줄에 쌓지 않는다 · 사람 검사 우선 · 밀림 경보 0).
 */
import { interleaveByCompany } from './concurrency';
import { weeklyCheckStep, weeklyCheckRows } from './journey-pretest-notifier';
import { candidatesReady } from './journey-pretest-candidate';
import { resolveJourneyAdFlag } from './journey-ad-policy';
import type { PretestBundle } from './journey-pretest-scan';

const TICK_MS = 60 * 1000;
/** 한 번에 살펴보는 칸 수(일이 남은 칸만 SQL 이 고른다 · 회사 돌아가며 첫 칸 하나만 검사 · 남은 칸 = 다음 분) */
export const WEEKLY_PICK_WINDOW = 300;

/** 이번 주 시작 = 지금 앞의 가장 가까운 일요일 21:00(KST) */
export function weeklyCheckWeekStart(now: Date): Date {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const back = (kst.getUTCDay() + 7) % 7;   // 0 = 일요일
  const start = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - back, 21 - 9, 0, 0));
  return start.getTime() > now.getTime() ? new Date(start.getTime() - 7 * 86400_000) : start;
}

let running = false;
let timer: NodeJS.Timeout | null = null;

export async function runWeeklyStepCheckTick(now: Date = new Date()): Promise<{ checked: number }> {
  if (running) return { checked: 0 };
  running = true;
  try {
    const weekStart = weeklyCheckWeekStart(now);
    const candOn = await candidatesReady().catch(() => false);
    const rows = await weeklyCheckRows(weekStart.toISOString(), candOn, WEEKLY_PICK_WINDOW);
    const pick = interleaveByCompany(rows, (r) => String(r.company_id))[0];
    if (!pick) return { checked: 0 };
    const sendAt = pick.next_run_at ? new Date(pick.next_run_at) : now;
    const b = {
      bundleKey: `weekly:${pick.journey_id}:${pick.step_id}`, journeyId: String(pick.journey_id), companyId: String(pick.company_id),
      createdBy: pick.created_by ? String(pick.created_by) : null, stepId: String(pick.step_id), channel: pick.channel,
      isAd: resolveJourneyAdFlag(pick.channel, pick.is_ad), subject: pick.subject ?? null, notifyManager: true, immediate: false,
      scheduledSendAt: sendAt, executionId: pick.execution_id ? String(pick.execution_id) : null,
      sendDateKst: new Date(sendAt.getTime() + 9 * 3600_000).toISOString().slice(0, 10),
      recheckHeld: false, errorsToday: 0, snapshotCreatedAt: null,
    } as unknown as PretestBundle;
    await weeklyCheckStep(b, pick.decision === 'held');
    return { checked: 1 };
  } finally {
    running = false;
  }
}

export function startWeeklyStepCheckWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    runWeeklyStepCheckTick().catch((e: any) => console.log(`[journey-weekly-check] tick 오류 — ${e?.message || e}`));
  }, TICK_MS);
  console.log('[journey-weekly-check] 1분 워커 시작(일요일 21:00 KST 주 시작 · 회사 돌아가며 한 칸씩)');
}

export function stopWeeklyStepCheckWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
