/**
 * autosend-policy.ts — 자동마케팅 자율 발송 순수 정책 (DB 미import → 순수 테스트)
 *
 * - resolveAutoSendLeadMinutes: 준비·정지 창(분). null/0/음수 → 120 기본, 상한 1440.
 * - computeScheduledSendAt: 발송 예정 시각 = 준비 시각(now) + lead분. 그 사이가 담당자 정지 창.
 * - decideSendOutcome: 발송 시점 0건·잔액부족 → skip+알림 / 정상 → send.
 * - normalizeCdpAutoExecuteGate: 슈퍼관리자 자율발송 게이트 입력 정규화(clamp·화이트리스트).
 */
import { clampInt } from './journey-points-trigger'; // 순수(DB 미import) CT — 테스트 DB-free 유지

export function resolveAutoSendLeadMinutes(raw: number | null | undefined): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return 120;
  return Math.min(n, 1440);
}

export function computeScheduledSendAt(now: Date, leadMinutes: number): Date {
  return new Date(now.getTime() + leadMinutes * 60 * 1000);
}

export interface SendOutcome {
  action: 'send' | 'skip';
  notify: boolean;
  reason: string;
}

export function decideSendOutcome(input: { recipientCount: number; balanceOk: boolean }): SendOutcome {
  if (input.recipientCount <= 0) {
    return { action: 'skip', notify: true, reason: '발송 대상 0명 — 이번 사이클 건너뜀' };
  }
  if (!input.balanceOk) {
    return { action: 'skip', notify: true, reason: '잔액 부족 — 이번 사이클 건너뜀' };
  }
  return { action: 'send', notify: false, reason: '발송 진행' };
}

/**
 * 'sending'에 정지된 제안 복구 판정(순수). campaign 'sending' 자동정리 패턴 미러(admin.ts).
 *  - campaignId 있음 = 발송 커밋 완료(마커) → 최종 상태만 'sent'로 마감. 노후 시각 무관 안전.
 *  - campaignId 없음 + claim 후 staleMinutes 경과 = 커밋 전 중단(예외/프로세스 종료) → 'admin_review'로 내려 사람 판단(절대 자동 재발송 X).
 *  - 그 외(최근 / claim 시각 모름) = keep(진행 중일 수 있어 손대지 않음).
 */
export type StuckSendingAction = 'mark_sent' | 'demote_admin_review' | 'keep';
export function decideStuckSendingRecovery(
  row: { campaignId: string | null; reviewedAt: Date | null },
  now: Date,
  staleMinutes: number = 30,
): StuckSendingAction {
  if (row.campaignId) return 'mark_sent';
  if (row.reviewedAt && now.getTime() - row.reviewedAt.getTime() >= staleMinutes * 60 * 1000) {
    return 'demote_admin_review';
  }
  return 'keep';
}

/**
 * 슈퍼관리자 자율발송 게이트 입력 정규화(순수). companies.cdp_auto_execute_* 4컬럼 UPDATE 직전 적용.
 *  - enabled: boolean true만 ON(문자열/숫자 → false).
 *  - maxRecipients: 1건 미만·과대 운영자 오타 방지 [1, 1,000,000], 미설정 1000.
 *  - maxCostKrw: [1, 100,000,000], 미설정 50000.
 *  - maxRisk: low/medium/high 화이트리스트, 그 외 'low'(가장 보수적).
 */
export type CdpRiskLevel = 'low' | 'medium' | 'high';
const CDP_RISK_LEVELS: CdpRiskLevel[] = ['low', 'medium', 'high'];
export interface CdpAutoExecuteGate {
  enabled: boolean;
  maxRecipients: number;
  maxCostKrw: number;
  maxRisk: CdpRiskLevel;
}
export function normalizeCdpAutoExecuteGate(raw: any): CdpAutoExecuteGate {
  const r = raw || {};
  return {
    enabled: r.enabled === true,
    maxRecipients: clampInt(r.maxRecipients, 1000, 1, 1_000_000),
    maxCostKrw: clampInt(r.maxCostKrw, 50000, 1, 100_000_000),
    maxRisk: CDP_RISK_LEVELS.includes(r.maxRisk) ? r.maxRisk : 'low',
  };
}
