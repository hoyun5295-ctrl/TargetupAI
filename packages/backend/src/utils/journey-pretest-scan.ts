/**
 * journey-pretest-scan.ts — 발송 2시간 전 스캔 순수 코어 (Phase 6B)
 *   임박 발송 execution들을 (journey, step, KST 발송날짜)당 1 bundle로 묶고,
 *   담당자 알림 여부를 결정한다. DB import 0 — 순수 (테스트 가능).
 */

export interface PretestScanRow {
  execution_id: string;
  journey_id: string;
  company_id: string;
  created_by: string | null;
  next_run_at: Date | string;
  step_id: string;
  channel: string;
  is_ad: boolean;
  subject: string | null;
  notify_manager_on_pretest: boolean | null;
  step_order: number;
  total_steps: number;
}

export interface PretestBundle {
  bundleKey: string;
  journeyId: string;
  companyId: string;
  createdBy: string | null;
  stepId: string;
  channel: 'sms' | 'lms' | 'mms';
  isAd: boolean;
  subject: string | null;
  notifyManager: boolean;
  scheduledSendAt: Date;
  executionId: string;
  sendDateKst: string;
}

/** KST(UTC+9) 기준 YYYY-MM-DD. */
export function kstDateOf(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 담당자 알림 여부 — explicit true/false 우선, null이면 첫/마지막 step만 ON. */
function resolveNotify(flag: boolean | null, stepOrder: number, totalSteps: number): boolean {
  if (flag === true) return true;
  if (flag === false) return false;
  return Number(stepOrder) === 1 || Number(stepOrder) === Number(totalSteps);
}

/**
 * 임박 발송 execution들을 (journey, step, KST 발송날짜)당 1 bundle로 묶는다.
 *   같은 bundle은 가장 이른 발송시각 + 그 execution을 대표로 둔다.
 */
export function groupPretestBundles(rows: PretestScanRow[]): PretestBundle[] {
  const map = new Map<string, PretestBundle>();
  for (const r of rows) {
    const sendAt = r.next_run_at instanceof Date ? r.next_run_at : new Date(r.next_run_at);
    const sendDateKst = kstDateOf(sendAt);
    const key = `${r.journey_id}:${r.step_id}:${sendDateKst}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        bundleKey: key,
        journeyId: r.journey_id,
        companyId: r.company_id,
        createdBy: r.created_by ?? null,
        stepId: r.step_id,
        channel: r.channel as 'sms' | 'lms' | 'mms',
        isAd: r.is_ad !== false,
        subject: r.subject ?? null,
        notifyManager: resolveNotify(r.notify_manager_on_pretest, r.step_order, r.total_steps),
        scheduledSendAt: sendAt,
        executionId: r.execution_id,
        sendDateKst,
      });
    } else if (sendAt.getTime() < existing.scheduledSendAt.getTime()) {
      existing.scheduledSendAt = sendAt;
      existing.executionId = r.execution_id;
    }
  }
  return Array.from(map.values());
}
