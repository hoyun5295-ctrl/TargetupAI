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

// ★ 2026-07-12 C-4: 발송 대상 축 선택지 — backend autosend-policy TARGET_HINTS의 키·라벨 미러.
//   검증(화이트리스트)·타겟 지시문은 backend가 단일 진실 — 여기는 표시용 라벨만.
export const TARGET_HINT_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'all', label: '전체 고객' },
  { key: 'dormant', label: '휴면 고객' },
  { key: 'recent_buyers', label: '최근 구매 고객' },
  { key: 'vip', label: 'VIP·상위 등급' },
  { key: 'birthday', label: '이달 생일 고객' },
  { key: 'new_customers', label: '신규 등록 고객' },
];

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
