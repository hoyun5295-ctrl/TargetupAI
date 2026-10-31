/**
 * journey-pretest-scan.ts — 발송 전 스캔 순수 코어 (Phase 6B)
 *   임박 발송 execution들을 (journey, step, KST 발송날짜)당 1 bundle로 묶고,
 *   담당자 알림 여부를 결정한다. DB import 0 — 순수 (테스트 가능).
 * ★ 2026-10-31 알림 판정 = journey-step-notify.ts isStepNotifyOn 한 곳(첫 · 마지막 메시지 칸 · 설계서 docs/2026-10-31-journey-step-gate-notice-design.md §2-5)
 *   · 바로 보내는 칸 표식(안내 본문 한 줄 · §2-4).
 */

import { isStepNotifyOn } from './journey-step-notify';

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
  /** ★ 1031 그 여정 메시지 칸 첫 · 끝 번호 */
  first_message_order: number | null;
  last_message_order: number | null;
  /** ★ 1031 바로 보내는 칸 판정 재료 */
  start_kind?: string | null;
  delay_mode?: string | null;
  delay_hours?: number | null;
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
  /** ★ 1031 고객마다 앞 단계 직후 바로 나가는 칸(그날 이 칸에 닿는 고객에게 이어서 나간다) */
  immediate: boolean;
  scheduledSendAt: Date;
  executionId: string;
  sendDateKst: string;
}

/** KST(UTC+9) 기준 YYYY-MM-DD. */
export function kstDateOf(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** ★ 1031 바로 보내는 칸 = 시작 종류가 단발(날짜 기준 · 한 번 보내기)이 아니고 칸 대기가 relative 0시간. */
export function isImmediateStep(startKind: string | null | undefined, delayMode: string | null | undefined, delayHours: number | null | undefined): boolean {
  if (startKind === 'date_anchor' || startKind === 'one_shot') return false;
  return (delayMode == null || delayMode === 'relative') && Number(delayHours || 0) === 0;
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
        notifyManager: isStepNotifyOn(r.notify_manager_on_pretest, r.step_order, r.first_message_order, r.last_message_order),
        immediate: isImmediateStep(r.start_kind, r.delay_mode, r.delay_hours),
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
