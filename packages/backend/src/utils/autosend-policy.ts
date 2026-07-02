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
 * 자율 발송 직전 예산 가드(순수). Phase2 D — 제안 생성 시점 차단과 별개로 발송 직전 1회 더 재검증.
 *  - 제안 생성 → lead(기본 120분) 대기 사이 같은 오퍼레이터의 다른 발송이 예산을 소진했을 수 있어, 발송 직전 재확인.
 *  - 예산(budgetMonthly/Daily) = 관리자 입력 컬럼, spent = 당월/당일 로그 SUM(누적 컬럼 X — 여정 J2), pendingCost = 그 제안 cost_estimate. 임의 상수 0.
 *  - 판정 = `spent + pending > 한도` → 이번 발송이 한도를 넘기면 over. 정확히 한도에 닿으면(==) 허용.
 *  - 예산 null = 무제한(가드 없음). month 우선 검사.
 */
export interface BudgetGuardInput {
  budgetMonthly: number | null;
  budgetDaily: number | null;
  spentMonth: number;
  spentToday: number;
  pendingCost: number;
}
export interface BudgetGuardResult {
  over: boolean;
  scope: 'month' | 'day' | null;
  reason: string;
}
export function decideBudgetGuard(input: BudgetGuardInput): BudgetGuardResult {
  const pending = Math.max(0, Math.floor(Number(input.pendingCost)) || 0);
  const spentMonth = Math.max(0, Math.floor(Number(input.spentMonth)) || 0);
  const spentToday = Math.max(0, Math.floor(Number(input.spentToday)) || 0);
  if (input.budgetMonthly != null && spentMonth + pending > input.budgetMonthly) {
    return {
      over: true,
      scope: 'month',
      reason: `월 예산 초과 — 발송 보류 (사용 ${spentMonth.toLocaleString()}원 + 이번 ${pending.toLocaleString()}원 > 한도 ${input.budgetMonthly.toLocaleString()}원)`,
    };
  }
  if (input.budgetDaily != null && spentToday + pending > input.budgetDaily) {
    return {
      over: true,
      scope: 'day',
      reason: `일 한도 초과 — 발송 보류 (오늘 ${spentToday.toLocaleString()}원 + 이번 ${pending.toLocaleString()}원 > 한도 ${input.budgetDaily.toLocaleString()}원)`,
    };
  }
  return { over: false, scope: null, reason: '' };
}

/**
 * 발송 시각 모드 — 2026-07-02 1단계 B (Harold 스펙: 설정 시각 = 발송 희망 시각).
 *  - 'fixed'(기본): 희망 시각 정각 발송. 생성·스팸테스트·담당자 통지 = 희망 시각 − 준비시간(lead).
 *  - 'ai_optimal': 클릭 반응 피크 시각으로 발송 시각을 AI가 정함(Phase3 B 유지 — 명시 선택 시에만).
 */
export type SendTimeMode = 'fixed' | 'ai_optimal';

export function normalizeSendTimeMode(raw: unknown): SendTimeMode {
  return raw === 'ai_optimal' ? 'ai_optimal' : 'fixed';
}

export type OperatorScheduleKind = 'daily' | 'weekly' | 'monthly';

/**
 * 다음 발송 희망 시각(KST 주기 occurrence) — 지금(now) 이후 가장 가까운 schedule_time.
 *  continuous-operator.ts computeNextRun의 검증된 KST 산식을 now 주입형 순수 함수로 이동(테스트 가능).
 *  - weekly: 지정 요일(0=일~6=토), 같은 요일인데 시각이 지났으면 다음 주.
 *  - monthly: 지정 일자, 말일 초과 시 그 달 말일로 클램프, 이번 달 지났으면 다음 달.
 */
export function computeNextOccurrence(
  schedule: OperatorScheduleKind,
  scheduleTime: string,
  dayOfWeek: number | null = null,
  dayOfMonth: number | null = null,
  now: Date = new Date(),
): Date {
  const [hStr, mStr] = String(scheduleTime || '').split(':');
  const h = parseInt(hStr) || 9;
  const m = parseInt(mStr) || 0;

  // 한국 시간 기준 — UTC = KST - 9h
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const target = new Date(kstNow);
  target.setUTCHours(h, m, 0, 0);

  if (schedule === 'weekly' && dayOfWeek != null) {
    let diff = (dayOfWeek - target.getUTCDay() + 7) % 7;
    if (diff === 0 && target.getTime() <= kstNow.getTime()) diff = 7;
    target.setUTCDate(target.getUTCDate() + diff);
  } else if (schedule === 'monthly' && dayOfMonth != null) {
    const clampToMonth = (t: Date) => {
      const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
      t.setUTCDate(Math.min(dayOfMonth, last));
    };
    target.setUTCDate(1);
    clampToMonth(target);
    if (target.getTime() <= kstNow.getTime()) {
      target.setUTCMonth(target.getUTCMonth() + 1, 1);
      clampToMonth(target);
    }
  } else if (target.getTime() <= kstNow.getTime()) {
    if (schedule === 'daily') target.setUTCDate(target.getUTCDate() + 1);
    else if (schedule === 'weekly') target.setUTCDate(target.getUTCDate() + 7);
    else if (schedule === 'monthly') target.setUTCMonth(target.getUTCMonth() + 1);
  }
  // KST → UTC
  return new Date(target.getTime() - 9 * 60 * 60 * 1000);
}

/**
 * 다음 생성 시각 = 발송 희망 시각 − 준비시간(lead분) — 2026-07-02 1단계 B.
 *  생성 시각이 이미 지났으면 한 주기 뒤 occurrence로 넘긴다.
 *  (generateProposal 직후 재계산이 같은 주기의 T−lead(=지금)를 다시 잡아 1분마다 재생성되는 무한 루프 차단.
 *   신규 생성 시각이 lead 안쪽이면 첫 주기는 다음 occurrence — 즉시 시작은 run-now가 담당.)
 */
export function computeNextGenerationRun(
  schedule: OperatorScheduleKind,
  scheduleTime: string,
  dayOfWeek: number | null,
  dayOfMonth: number | null,
  leadMinutes: number,
  now: Date = new Date(),
): { nextRunAt: Date; sendAt: Date } {
  const lead = resolveAutoSendLeadMinutes(leadMinutes);
  let sendAt = computeNextOccurrence(schedule, scheduleTime, dayOfWeek, dayOfMonth, now);
  let nextRunAt = new Date(sendAt.getTime() - lead * 60 * 1000);
  if (nextRunAt.getTime() <= now.getTime()) {
    sendAt = computeNextOccurrence(schedule, scheduleTime, dayOfWeek, dayOfMonth, new Date(sendAt.getTime() + 60 * 1000));
    nextRunAt = new Date(sendAt.getTime() - lead * 60 * 1000);
  }
  return { nextRunAt, sendAt };
}

/**
 * 문안 스타일 4종 — 2026-07-02 2단계 (Harold 스펙: 설정 시 문안 느낌 선택지 4가지).
 *  선택 없음(null) = 브랜드 톤 자동(기존 동작 그대로). 프롬프트는 톤 지시만 — 구체 혜택 생성 금지 원칙과 충돌 없음.
 */
export type CopyStyle = 'courteous' | 'friendly' | 'witty' | 'punchy';

export const COPY_STYLES: Array<{ key: CopyStyle; label: string; prompt: string }> = [
  { key: 'courteous', label: '정중한', prompt: '격식 있는 정중한 존댓말로, 신뢰감 있게 안내하는 톤으로 작성하라.' },
  { key: 'friendly', label: '친근한', prompt: '단골에게 말 걸 듯 다정하고 부드러운 톤으로 작성하라. 과한 격식은 뺀다.' },
  { key: 'witty', label: '위트있는', prompt: '가볍게 미소 짓게 하는 위트를 한 스푼 담아 작성하라. 유치한 말장난은 피하고 센스 있는 한 줄 중심.' },
  { key: 'punchy', label: '짧고 강한', prompt: '군더더기 없이 핵심만 짧고 강하게. 문장 수를 최소화하고 임팩트 있는 첫 줄로 시작하라.' },
];

export function normalizeCopyStyle(raw: unknown): CopyStyle | null {
  return COPY_STYLES.some((s) => s.key === raw) ? (raw as CopyStyle) : null;
}

/** 문안 생성 objective에 덧붙일 스타일 지시 블록. null = 빈 문자열(브랜드 톤 자동). */
export function buildCopyStylePromptBlock(style: CopyStyle | null): string {
  if (!style) return '';
  const def = COPY_STYLES.find((s) => s.key === style)!;
  return `[문안 스타일 — 반드시 반영] ${def.label} 톤: ${def.prompt}`;
}

/**
 * 자율 발송 예정 안내(담당자 통지 2번 문자) 문구 — 2026-07-02 1단계 (Harold 스펙).
 *  발송 일시 + 추출 타겟 수 + 예상 비용(해당 유형 단가 × 수량) + 예약취소(정지) 안내.
 *  단가 미상(0 이하)이면 산식은 생략하고 총액만 표기(임의 상수 생성 금지).
 */
export interface PrepNoticeInput {
  sendAtLabel: string;      // 발송 예정 시각 라벨 (KST 조립은 호출부 — 예: '7월 3일 14:00')
  recipientCount: number;   // 추출 타겟 수
  costEstimate: number;     // 총 예상 비용(원)
  channelLabel: string;     // 'SMS' | 'LMS' | 'MMS'
  unitCost: number;         // 회사 단가(원/건)
}

export function buildAutoSendPrepInfoBody(input: PrepNoticeInput): string {
  const count = Math.max(0, Math.floor(Number(input.recipientCount)) || 0);
  const total = Math.max(0, Math.round(Number(input.costEstimate)) || 0);
  const unit = Number(input.unitCost) > 0 ? Number(input.unitCost) : 0;
  const costLine = unit > 0
    ? `예상 비용 약 ${total.toLocaleString()}원 (${input.channelLabel} ${unit.toLocaleString()}원 × ${count.toLocaleString()}건)`
    : `예상 비용 약 ${total.toLocaleString()}원`;
  return [
    `${input.sendAtLabel}에 위 문안이 ${count.toLocaleString()}명에게 자동 발송됩니다.`,
    costLine,
    `예약 취소를 원하시면 발송 전에 한줄로에 접속해 자동마케팅 [정지]를 눌러주세요.`,
  ].join('\n');
}

/**
 * 어제(KST) 하루 구간 — 성과 회고(2차) 대상 선별용. UTC Date 쌍 + 라벨 반환(순수, now 주입).
 */
export function kstYesterdayRange(now: Date = new Date()): { start: Date; end: Date; dateLabel: string } {
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayKstMidnightUtcMs = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate(), -9, 0, 0);
  const start = new Date(todayKstMidnightUtcMs - 24 * 60 * 60 * 1000);
  const end = new Date(todayKstMidnightUtcMs);
  const startKst = new Date(start.getTime() + 9 * 60 * 60 * 1000);
  return { start, end, dateLabel: `${startKst.getUTCMonth() + 1}월 ${startKst.getUTCDate()}일` };
}

/**
 * 성과 회고 문자(2차 — Harold 확정) — 발송 다음날 아침 담당자에게 어제 결과 보고.
 *  클릭은 실측이 있을 때만 표기(단축 URL 미사용 발송은 미측정과 0을 구분할 수 없어 생략 — 정직).
 */
export interface DailyRecapInput {
  operatorName: string;
  dateLabel: string;      // '7월 1일'
  sentCount: number;
  successCount: number;
  clickedCount: number;
}

export function buildDailyRecapBody(input: DailyRecapInput): string {
  const sent = Math.max(0, Math.floor(Number(input.sentCount)) || 0);
  const success = Math.max(0, Math.floor(Number(input.successCount)) || 0);
  const clicked = Math.max(0, Math.floor(Number(input.clickedCount)) || 0);
  const lines = [
    `어제(${input.dateLabel}) '${input.operatorName}' 발송 결과입니다.`,
    `- 발송 ${sent.toLocaleString()}명 · 성공 ${success.toLocaleString()}명`,
  ];
  if (clicked > 0 && sent > 0) {
    lines.push(`- 클릭 ${clicked.toLocaleString()}명 (${((clicked / sent) * 100).toFixed(1)}%)`);
  }
  lines.push('이 결과를 학습해 다음 추천에 반영합니다.');
  return lines.join('\n');
}

/**
 * 담당자 안내 문자 머리말 — Harold 2026-07-02 지시: 모든 담당자 안내 문자는
 * "[한줄로 AI 자동마케팅 안내문자]"로 시작해 한줄로 발신임을 분명히 한다. 중복 부착 방지.
 */
const OPERATOR_NOTICE_HEADER = '[한줄로 AI 자동마케팅 안내문자]';

export function wrapOperatorNoticeBody(body: string): string {
  const b = String(body || '');
  if (b.startsWith(OPERATOR_NOTICE_HEADER)) return b;
  return `${OPERATOR_NOTICE_HEADER}\n${b}`;
}

/**
 * 승인 대기(수동 검토) 담당자 통지 문구 — 자율 발송 자격 미달로 pending에 머무는 새 추천을
 * 담당자가 모르는 문제 해소(2026-07-02 1단계). 승인해야 발송됨을 명시.
 */
export interface PendingReviewNoticeInput {
  operatorName: string;
  recipientCount: number;
  costEstimate: number;
}

export function buildPendingReviewNoticeBody(input: PendingReviewNoticeInput): string {
  const count = Math.max(0, Math.floor(Number(input.recipientCount)) || 0);
  const total = Math.max(0, Math.round(Number(input.costEstimate)) || 0);
  return [
    `'${input.operatorName}' 새 추천이 승인 대기 중입니다.`,
    `대상 ${count.toLocaleString()}명 · 예상 비용 약 ${total.toLocaleString()}원`,
    `한줄로에 접속해 검토 후 승인하면 발송됩니다. 승인 전에는 발송되지 않습니다.`,
  ].join('\n');
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
