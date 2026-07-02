// 자동마케팅(Continuous Operator) 재설계 공용 타입 — 2026-06-27
// proposal_json = orchestrate() 결과 전체(OrchestratorResult)가 저장된다(continuous-operator.ts).
// 화면은 그 전부를 위계로 렌더한다 — 버리는 데이터 0.

export type Schedule = 'daily' | 'weekly' | 'monthly';
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
  deliveryPolicy?: 'daily' | 'weekly' | 'monthly';
  verificationRequiredDays?: number;
  verificationPassedDays?: number;
  adminPhoneNumbers?: string[];
  backupAdminPhone?: string | null;
  adminAlertChannel?: 'sms' | 'kakao' | 'email';
  optOutMinutes?: number;
  spamScoreThreshold?: number;
  maxSpamRetries?: number;
  autoSendLeadMinutes?: number | null;
  // 발송 시각 모드 — 'fixed'(기본, 희망 시각 정각 발송) | 'ai_optimal'(반응 좋은 시간대로 AI가 조정)
  sendTimeMode?: 'fixed' | 'ai_optimal';
  // 문안 스타일 4종 — null/미지정 = 브랜드 톤 자동
  copyStyle?: 'courteous' | 'friendly' | 'witty' | 'punchy' | null;
  channel?: 'sms' | 'lms' | 'mms';
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
  expiresAt: string;
  createdAt: string;
  operatorName?: string;
  operatorObjective?: string;
}

// 통화/퍼센트 표시 헬퍼 — 모든 카드 공용
export const won = (n?: number | null): string => `₩${Math.round(Number(n) || 0).toLocaleString('ko-KR')}`;
export const pct = (r?: number | null, digits = 1): string => `${((Number(r) || 0) * 100).toFixed(digits)}%`;
