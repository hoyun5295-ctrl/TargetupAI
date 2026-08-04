// 자동마케팅(Continuous Operator) 재설계 공용 타입 — 2026-06-27
// proposal_json = orchestrate() 결과 전체(OrchestratorResult)가 저장된다(continuous-operator.ts).
// 화면은 그 전부를 위계로 렌더한다 — 버리는 데이터 0.

// ★ 2026-07-05: 'yearly' 신설 — 마케팅 캘린더 시즌 캠페인(연 1회, scheduleMonth 월 + scheduleDayOfMonth 일)
export type Schedule = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type OperatorStatus = 'active' | 'paused' | 'archived' | 'paused_no_credit';
export type ProposalStatus =
  | 'pending' | 'approved' | 'rejected' | 'auto_executed' | 'expired'
  | 'admin_review' | 'admin_stopped' | 'scheduled' | 'sending' | 'sent' | 'skipped';

// 메인 런처에서 진입하는 화면 구분
export type AutoMarketingView = 'launcher' | 'recommendations' | 'natural' | 'scenario' | 'operators';

export interface ContinuousOperator {
  id: string;
  name: string;
  objective: string;
  schedule: Schedule;
  scheduleTime: string;
  scheduleDayOfWeek?: number | null;
  scheduleDayOfMonth?: number | null;
  scheduleMonth?: number | null;  // 1~12 — yearly 전용 대상 월 (2026-07-05)
  status: OperatorStatus;
  lastRunAt: string | null;
  nextRunAt: string | null;
  totalProposals: number;
  totalApproved: number;
  totalRejected: number;
  totalAutoExecuted: number;
  createdAt: string;
  budgetMonthly?: number | null;
  budgetDaily?: number | null;
  budgetAlertThreshold?: number;
  budgetSpentMonth?: number;
  budgetSpentToday?: number;
  // ★ 2026-07-12 C-2 죽은 설정 정리 — deliveryPolicy·verification*·optOutMinutes·spamScoreThreshold·
  //   maxSpamRetries 제거(백엔드 소비 로직 0이던 거짓 설정).
  adminPhoneNumbers?: string[];
  backupAdminPhone?: string | null;
  adminAlertChannel?: 'sms' | 'kakao' | 'email';
  autoSendLeadMinutes?: number | null;
  // ★ 2026-07-12 C-4: 발송 대상 축 — null/미지정 = 목표 문장 자유 해석
  targetHint?: string | null;
  // ★ 2026-08-03 타겟팅 재설계: 발송 대상 계약 — 고르면 매 회차 같은 조건으로 대상을 뽑는다(재해석 없음).
  //   null = 계약 없음(목표 문장 해석 — 종전 방식). 파라미터 범위·검증은 backend가 단일 진실.
  segmentKey?: string | null;
  segmentParams?: Record<string, number> | null;
  /**
   * ⛔ 화면 전용 3상태 플래그 — 사용자가 "목표 문장으로 자동 판단"을 **명시적으로** 골랐는지.
   * 무관한 수정(이름·예산)에서는 옛 축을 건드리지 않아야 하고(미전송 = 서버 유지),
   * 자동 판단을 직접 고른 경우에만 해제를 보낸다. 저장 payload에는 이 값 자체가 나가지 않는다.
   */
  targetHintTouched?: boolean;
  // 발송 시각 모드 — 'fixed'(기본, 희망 시각 정각 발송) | 'ai_optimal'(반응 좋은 시간대로 AI가 조정)
  sendTimeMode?: 'fixed' | 'ai_optimal';
  // 문안 스타일 4종 — null/미지정 = 브랜드 톤 자동
  copyStyle?: 'courteous' | 'friendly' | 'witty' | 'punchy' | null;
  channel?: 'sms' | 'lms' | 'mms';
  // ★ 2026-07-30 (임은지 접수): 채널 mms 첨부 이미지(serverPath, 최대 3) — 매 자율 발송에 첨부
  mmsImagePaths?: string[] | null;
  benefitContent?: string | null;
  sequenceEnabled?: boolean;
  sequenceDelayDays?: number | null;
  sequenceReminderContent?: string | null;
}

export interface ProposalVariant {
  id: string;
  proposalId: string;
  variantIndex: number;
  messageBody: string;
  byteCount: number;
  armAlpha: number;
  armBeta: number;
  sentCount: number;
  clickCount: number;
  conversionCount: number;
  rewardTotal: number;
}

export interface BanditRecommendation {
  variantId: string;
  variantIndex: number;
  messageBody: string;
  posteriorMean: number;
  posteriorSample: number;
  totalTrials: number;
  reasoning: string;
}

export interface MultiGoalInput {
  name: string;
  description?: string;
  weight: number;
}

export interface MultiGoalSubPlan {
  goalName: string;
  targetCriteria: string;
  channelRecommended: string;
  timingRecommended: string;
  conflicts: string[];
  priority: number;
  shouldExecute: boolean;
  reasoning: string;
}

export interface MultiGoalAnalysis {
  goals: MultiGoalInput[];
  subPlans: MultiGoalSubPlan[];
  overallStrategy: string;
  conflictMatrix: string;
  recommendedOrder: string[];
  analyzedAt: string;
}

export interface LearningSummary {
  memory: {
    total: number;
    successPatterns: number;
    customerInsights: number;
    brandToneEvolution: number;
    channelPerformance: number;
    complianceLearning: number;
    lastLearnedAt: string | null;
    avgImportance: number;
  };
  topPatterns: Array<{
    memoryType: string;
    summary: string;
    importance: number;
    usageCount: number;
    updatedAt: string | null;
  }>;
  performance: {
    totalProposals30d: number;
    approvedCount: number;
    rejectedCount: number;
    autoExecutedCount: number;
    avgRecipients: number;
    avgCost: number;
  };
  variantWinner: {
    variantLabel: string;
    ctr: number;
    sent: number;
    clicks: number;
  } | null;
}

// ── proposal_json 타입 뷰 (orchestrate OrchestratorResult subset) ──
export interface GradeBreakdownRow {
  grade: string;
  count: number;
  conversionRate: number;
  expectedConversions: number;
  expectedRevenue: number;
  source: string;
}

export interface ProposalInsight {
  diagnosis?: string;
  insights?: string[];
  strategy?: string[];
  risks?: string[];
  generated?: boolean;
}

export interface ProposalPerformance {
  expectedClicks?: number;
  expectedConversions?: number;
  expectedRevenue?: number;
  clickRate?: number;
  conversionRate?: number;
  avgRevenue?: number;
  roi?: number;
  basis?: {
    level?: string;
    label?: string;
    confidence?: string;
    notes?: string[];
    eventWindowDays?: number;
    gradeBreakdown?: GradeBreakdownRow[];
  };
  insight?: ProposalInsight;
}

export interface ProposalMessage {
  variantId?: string;
  variantName?: string;
  concept?: string;
  body?: string;
  message?: string;
  subject?: string;
  byteCount?: number;
  byte_count?: number;
}

export interface ProposalJson {
  target?: {
    count?: number;
    totalCount?: number;
    criteria?: string;
    filters?: Record<string, unknown>;
    suggestedName?: string;
  };
  messages?: ProposalMessage[];
  recommendation?: string;
  recommendationReason?: string;
  channel?: {
    recommended?: string;
    reason?: string;
    isAd?: boolean;
    rejectNumber?: string | null;
  };
  schedule?: { recommendedTime?: string };
  compliance?: {
    passed?: boolean;
    riskLevel?: string;
    warnings?: string[];
    suggestions?: string[];
  };
  cost?: { estimated?: number; unitCost?: number; breakdown?: string };
  performance?: ProposalPerformance;
  meta?: {
    aiSynthesis?: string;
    usePersonalization?: boolean;
    personalizationVars?: string[];
  };
}

export interface OperatorProposal {
  id: string;
  operatorId: string;
  proposalJson: ProposalJson;
  recipientCount: number;
  costEstimate: number;
  status: ProposalStatus;
  autoExecuted: boolean;
  autoExecuteReason: string | null;
  reviewedAt: string | null;
  // ★ 2026-07-07: 발송 예정 시각 — pending에도 내려옴(예정일 경과 승인 경고용). 과거 저장분은 null 가능.
  scheduledSendAt?: string | null;
  expiresAt: string;
  createdAt: string;
  operatorName?: string;
  operatorObjective?: string;
}

// ★ 2026-07-09 승인 시 사용자가 고른 변형 + (편집 시) 본문 — 없으면 백엔드가 Bandit 추천 사용(자동 발송 경로 동일).
export interface ProposalApproveSelection {
  variantIndex: number;
  body: string;
  subject?: string;
}

/**
 * ★ 2026-08-03 타겟팅 재설계 — 발송 대상 계약 축.
 *   목록·라벨·사유·파라미터 정의를 전부 backend(GET /api/ai/operator/segments)가 준다.
 *   ⛔ 프런트에 축 목록을 두지 않는다 — 회사 데이터로 열리고 잠기는 축이라 여기서 흉내 내면 화면이 거짓말을 한다.
 */
export interface SegmentParamDef {
  key: string;
  label: string;
  unit: string;
  /** 자주 쓰는 값 — backend가 축마다 정한다(프런트가 목록을 갖지 않는다). */
  presets?: number[];
  default: number;
  min: number;
  max: number;
}

export interface SegmentAvailability {
  key: string;
  label: string;
  available: boolean;
  /** 왜 되는지 / 왜 안 되는지 — 그대로 노출한다. */
  reason: string;
  params: SegmentParamDef[];
  /**
   * ★ 2026-08-04 변화 축 — 지난번 발송 때와 비교해 대상을 정하는 조건.
   * 신규 등록에는 비교할 지난번이 없다. 그 상태를 "대상 0"이나 오류로 보여주면 담당자는 고장으로 읽으므로
   * 화면이 이 값을 보고 **첫 회차 안내**를 대신 띄운다(정상 동작이다).
   */
  needsCycleBaseline?: boolean;
}

// ★ 2026-08-03 타겟팅 재설계: 고정 축 목록(TARGET_HINT_OPTIONS)은 여기서 제거했다.
//   목록을 프런트에 두면 그 회사에서 안 되는 축까지 늘 열려 보인다 — 자동마케팅은 SegmentAvailability(서버 판정)만 쓴다.
//   마케팅 캘린더는 아직 옛 target_hint 축이라 그 화면이 자기 목록을 갖는다(계약 전환 = 별건).

// ★ 2026-07-12 C-3③: 자동마케팅 매출 귀속(ROI) — GET /operator/performance/automarketing-roi 응답
export interface AutoMarketingRoi {
  analysisPeriodDays: number;
  campaigns: number;
  totalSent: number;
  spendKrw: number;
  purchases7d: number;
  revenue7dKrw: number;
  hasCdpData: boolean;
  source: string;
}

// 통화/퍼센트 표시 헬퍼 — 모든 카드 공용
export const won = (n?: number | null): string => `₩${Math.round(Number(n) || 0).toLocaleString('ko-KR')}`;
export const pct = (r?: number | null, digits = 1): string => `${((Number(r) || 0) * 100).toFixed(digits)}%`;
