/**
 * journey-options-validator.ts — 여정별 옵션 입력을 안전 범위로 정규화 (Phase 9 Task 3)
 *   DB import 0 — 순수. 입력 계약(트리거 타이밍 키 + camelCase 옵션)을 클램프/화이트리스트한다.
 *   DB 컬럼 매핑은 PATCH endpoint에서(여기서는 정규화만 — 컬럼명 무관).
 *   클램프 헬퍼는 journey-points-trigger CT 재사용(인라인 중복 금지).
 */
import { clampInt, isValidMmdd } from './journey-points-trigger';

export interface NormalizedJourneyOptions {
  triggerFilters: Record<string, any>;
  options: {
    thresholdRecipients: number | null;
    thresholdCost: number | null;
    thresholdRiskLevel: 'low' | 'medium' | 'high';
    budgetMonthly: number | null;
    allowReentry: boolean;
    reentryCooldownDays: number;
    autoReentryEnabled: boolean;
    callbackNumber: string | null;
    callbackMode: 'fixed' | 'store';
    /** ★ 2026-07-10 목표 달성 시 자동 종료 — 진입 이후 구매 확인 시 잔여 step 중단 */
    goalExitEnabled: boolean;
    /** ★ 2026-07-11 목표 종류 — purchase(구매)/click(이 여정 발송 링크 클릭)/visit(자사몰 방문 page_view) */
    goalKind: 'purchase' | 'click' | 'visit';
    /** ★ 2026-07-11 홀드아웃 대조군 % (0~30 클램프, 0=비활성) — 신규 진입의 N%를 미발송 대조군으로 배정 */
    holdoutPct: number;
    /** ★ 2026-07-11 send-time 개인화 — 시각 지정 step 발송 시각을 고객 반응 최빈 시간대로 대체 */
    personalSendTime: boolean;
  };
}

const GOAL_KINDS = ['purchase', 'click', 'visit'] as const;

/** 0 이상 정수 또는 null(미설정/음수/비숫자). 한도·예산은 비우면 무제한(null). */
function clampOrNull(val: any): number | null {
  if (val == null || val === '') return null;
  const n = Number(val);
  if (Number.isNaN(n) || n < 0) return null;
  return Math.floor(n);
}

export function normalizeJourneyOptions(input: Record<string, any>): NormalizedJourneyOptions {
  const src = input || {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(src, k);

  // 트리거 타이밍 + 포인트 — 입력에 있는 키만 정규화(미지정 키에 기본값 주입 안 함).
  const triggerFilters: Record<string, any> = {};
  if (has('recent_hours')) triggerFilters.recent_hours = clampInt(src.recent_hours, 24, 1, 720);
  if (has('dormant_days')) triggerFilters.dormant_days = clampInt(src.dormant_days, 30, 1, 3650);
  if (has('days_before')) triggerFilters.days_before = clampInt(src.days_before, 7, 0, 90);
  if (has('abandon_hours')) triggerFilters.abandon_hours = clampInt(src.abandon_hours, 24, 1, 168);
  if (has('points_min')) triggerFilters.points_min = clampInt(src.points_min, 0, 0, Number.MAX_SAFE_INTEGER);
  if (has('inactive_days')) triggerFilters.inactive_days = clampInt(src.inactive_days, 180, 1, 100000);
  if (has('expiry_mode')) triggerFilters.expiry_mode = src.expiry_mode === 'annual_date' ? 'annual_date' : 'inactivity';
  if (has('expiry_month_day')) {
    const raw = String(src.expiry_month_day || '').trim();
    triggerFilters.expiry_month_day = isValidMmdd(raw) ? raw : '';
  }

  const riskLevels = ['low', 'medium', 'high'];
  const options: NormalizedJourneyOptions['options'] = {
    thresholdRecipients: clampOrNull(src.thresholdRecipients),
    thresholdCost: clampOrNull(src.thresholdCost),
    thresholdRiskLevel: riskLevels.includes(src.thresholdRiskLevel) ? src.thresholdRiskLevel : 'low',
    budgetMonthly: clampOrNull(src.budgetMonthly),
    allowReentry: src.allowReentry === true || src.allowReentry === 'true',
    reentryCooldownDays: clampInt(src.reentryCooldownDays, 0, 0, 365),
    autoReentryEnabled: src.autoReentryEnabled === true || src.autoReentryEnabled === 'true',
    callbackNumber: typeof src.callbackNumber === 'string' && src.callbackNumber.trim() ? src.callbackNumber.trim() : null,
    callbackMode: src.callbackMode === 'store' ? 'store' : 'fixed',
    goalExitEnabled: src.goalExitEnabled === true || src.goalExitEnabled === 'true',
    goalKind: (GOAL_KINDS as readonly string[]).includes(src.goalKind) ? src.goalKind : 'purchase',
    holdoutPct: clampInt(src.holdoutPct, 0, 0, 30),
    personalSendTime: src.personalSendTime === true || src.personalSendTime === 'true',
  };

  return { triggerFilters, options };
}
