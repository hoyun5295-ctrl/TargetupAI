import ZoneFrame from '../components/zone/ZoneFrame';
import { fetchOneLineEnabled } from '../utils/one-line';   // ★ 2026-10-05 한줄로 시그니처
import { decorateOutcome } from '../utils/decorate-outcome';
import ZoneEmphasis from '../components/zone/ZoneEmphasis';
import ZoneRowActions from '../components/zone/ZoneRowActions';
import ZoneSection from '../components/zone/ZoneSection';
import ZoneSegmented from '../components/zone/ZoneSegmented';
import { JOURNEY_TABS } from '../components/zone/zone-tabs';
import StatusPill from '../components/console/StatusPill';
import { zoneModule } from '../constants/ai-operator-modules';
import { journeyRowActionPlan, journeyRowActionLabel, JOURNEY_STATUS_LABEL, type JourneyRowActionId } from '../utils/journey-row-actions';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { goUpTo } from '../lib/scroll-restoration';
import {
  ArrowLeft, Loader2, Pause, Play, Plus, Power, RefreshCw, Sparkles,
  ShoppingCart, Cake, Calendar as CalendarIcon, UserPlus, Repeat, Moon, MessageSquare,
  Clock, DollarSign, Users, Phone, Wand2, X, AlertCircle, Send, Trash2, Edit2, Save, Beaker, Code,
  BarChart3, Megaphone, Bell, ChevronLeft, ChevronRight,
  // ★ D210+ Phase 2-fix6 (Harold 명시 2026-05-23): 6 sub-agent 진행 카드 + 토글 영역 아이콘
  Workflow, Brain, LayoutGrid, CheckCircle2,
  // ★ D210+ Phase 3 (2026-05-23 Harold 명시): 자동 재진입 토글 + funnel 시각화 + 다중 미리보기 아이콘
  RotateCcw, Activity, MousePointerClick, Filter as FilterIcon, TrendingUp, AlertTriangle, Eye,
  // ★ D211+ Phase 3 (2026-05-23 Harold 명시): 보관함 + 영구 삭제 아이콘
  Archive, ArchiveRestore,
  // ★ 2026-06-30 여정 일반화 SP-B: 날짜축 여정 아이콘
  CalendarClock,
  // ★ 2026-07-10 목표 달성 시 자동 종료
  Target,
  // ★ 2026-09-29 여정 V2 1차 — 생애 지도 입구
  Map as MapIcon,
} from 'lucide-react';
import JourneyMmsUploader from '../components/journey/JourneyMmsUploader';
// ★ D211+ Phase 3-fix (2026-05-23 Harold 명시): native confirm/prompt 영구 폐기 — 커스텀 다크 톤 모달 정합
import JourneyActionConfirmModal, { JourneyActionMode } from '../components/journey/JourneyActionConfirmModal';
// ★ D211+ Phase A 4번 (2026-05-23 Harold 명시): 흐름 다이어그램 시각화
// ★ D218+ (2026-05-26): 활성화 자동 검증 + 정지 이력 + 담당자 알림 토글 신규
import JourneyActivationConfirmModal from '../components/journey/JourneyActivationConfirmModal';
import JourneyPauseLogsModal from '../components/journey/JourneyPauseLogsModal';
// ★ 2026-07-11 여정 [타겟확인] — 공용 타겟 리스트 모달 (0710 자동마케팅과 동일 계약)
import TargetRecipientsModal, { arrayPager } from '../components/TargetRecipientsModal';
// 저장 여정 문안(본문·제목) 수정 — 초안·일시정지만(구조·일정 변경은 새 여정)
import JourneyMessageEditModal from '../components/journey/JourneyMessageEditModal';
// 고객 데이터 없으면 AI 문안 생성 전 안내 (공용 게이트)
import { useCustomerDataGate, CustomerDataRequiredBanner, CustomerDataRequiredModal } from '../components/CustomerDataGate';
import AlimtalkChannelPanel, { validateAlimtalkChannelState, type AlimtalkSenderProfile, type AlimtalkTemplate, type AlimtalkChannelState } from '../components/alimtalk/AlimtalkChannelPanel';
// ★ 2026-08-02 §13 화면 흐름 — 자연어 → 추천 모달 → 스텝별 전환 → 브리핑 모달
import JourneyDataScopeNote from '../components/journey/JourneyDataScopeNote';
import InterviewModal, { type InterviewPreset, type InterviewQuickStart } from '../components/journey/map/InterviewModal';
import { RequestKeys } from '../utils/request-id';
import GradeOrderModal from '../components/journey/GradeOrderModal';
import InfoAlertJourneyBuilder, { type InfoAlertBuildResult } from '../components/journey/InfoAlertJourneyBuilder';
import DateAnchorJourneyBuilder, { type DateAnchorBuildResult } from '../components/journey/DateAnchorJourneyBuilder';
import { TRIGGER_EVENTS } from '../utils/journey-trigger-catalog';
// ★ 2026-09-29 여정 V2 0차 ⑤⑦ — 칸 종류 · 흐름 색 표기는 공용 유틸 한 곳.
// ★ 2026-08-08 — 문안 placeholder(혜택·링크) 판정·치환 단일 정의(스튜디오 카드와 같은 규약).
import { fillBenefitPlaceholders, fillUrlPlaceholders, isSendableUrl } from '../utils/message-placeholders';
// ★ 2026-08-08 — 다듬기 결과는 비포/애프터로 본다. 하이라이트는 직접발송 모달과 같은 CT.
import { highlightAdditions } from '../utils/text-diff';
import { calculateSmsBytes, LMS_SUBJECT_MAX_CHARS } from '../utils/formatDate';
// ★ 2026-09-26 한줄로 V2 m068 — 보낼 수 없는 글자 판정(게이트웨이 CP949 표)
import { findUnsupportedSmsChars } from '../utils/smsSafeChars';
import { buildAdMessageFront, buildAdSubjectFront } from '../utils/formatDate';
import { detectLiquidSyntax, renderLiquid, flattenCustomerForLiquid, SAMPLE_CUSTOMERS } from '../utils/liquid-templating';
// ★ D210+ Phase 2-fix6 (Harold 명시 2026-05-23): 변수 하이라이트 + 머지 미리보기 컨트롤타워.
import { highlightVars, mergeAndHighlightVars, mergeVarsPlain } from '../utils/highlightVars';
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';
import JourneyWorkspace from '../components/journey/workspace/JourneyWorkspace';
import PhoneComposer from '../components/journey/PhoneComposer';
import { COND_FIELDS } from '../components/journey/JourneyBuilderUi';
import type { PauseReasonView } from '../utils/journey-map';
import { useJourneyActions } from '../components/journey/workspace/useJourneyActions';
import { useToast } from '../components/ToastProvider';
// ★ 2026-10-10 한 줄 묻기 — 질문이면 회사 데이터로 답한다(설계서 docs/2026-10-10-oneline-ask-design.md)
import { useLineAsk } from '../hooks/useLineAsk';
import LineAnswer from '../components/zone/LineAnswer';
import { AI_GENERATE_COSTS } from '../constants/credit';

// D187-fix3 (2026-05-21): One-shot AI Operator — 자연어 한 줄 → AI가 완전 패키지 자동 생성 → 1 페이지 검토 → 활성화
//   영구 룰: AI는 흐름/안내문/감성 텍스트만 풍성하게 / 구체 혜택(% / 원 / 무료 / 쿠폰)은 회사 admin 직접 작성
//   기존 wizard 5단계 폐기 → One-shot 흐름 정합

type TemplateCode = 'onboarding' | 'repeat' | 'dormant' | 'cart' | 'birthday' | 'reservation' | 'custom';
type JourneyStatus = 'draft' | 'active' | 'paused' | 'ended';
// ★ D188 Phase 2-B-2 (2026-05-21): kakao 채널 추가.
type ChannelType = 'sms' | 'lms' | 'mms' | 'kakao';
type RefineTone = '감성적' | '실용적' | '캐주얼';

interface JourneyRow {
  id: string;
  name: string;
  template_code: TemplateCode;
  trigger_event: string;
  status: JourneyStatus;
  budget_monthly: number | null;
  callback_number: string | null;
  allow_reentry: boolean;
  reentry_cooldown_days: number | null;
  // ★ D210+ Phase 3 (2026-05-23 Harold 명시): 자동 재진입 명시 활성 영역 (default false)
  auto_reentry_enabled?: boolean;
  stats_total_entered: number;
  stats_total_completed: number;
  stats_total_cost: number;
  // ★ 2026-07-10 목표 달성 시 자동 종료 — 옵션 + 목표 달성 종료 수(listJourneys 서브쿼리)
  goal_exit_enabled?: boolean;
  goal_met_count?: number;
  /** ★ 2026-07-11 홀드아웃 대조군(미발송) 수 */
  holdout_count?: number;
  paused_at: string | null;
  pause_reason: string | null;
  /** ★ V.3 §6-6 — 멈춘 이유 사람 말(서버 pauseReasonView · 원문 pause_reason 은 그리지 않는다). */
  pause_view?: PauseReasonView | null;
  threshold_recipients_per_step?: number | null;
  /** ★ V.3 §5-1 — 이번에 켜면 내는 처음 켜기 크레딧(서버 판정). */
  activation_cost?: number;
  created_at: string;
  // ★ D211+ Phase 3 (2026-05-23 Harold 명시): 보관함 영역 (soft delete)
  archived_at?: string | null;
  // ★ D211+ Phase A 5번 (2026-05-23 Harold 명시): 트리거 복합 조건 영역
  trigger_filters?: Record<string, any>;
}

// ★ D211+ Phase 3 (2026-05-23 Harold 명시): status 필터 매트릭스 (전체/활성/일시정지/종료/보관함)
type JourneyStatusFilter = 'all' | 'active' | 'paused' | 'ended' | 'archived';

interface StepRow {
  id: string;
  step_order: number;
  step_type: string;
  delay_hours: number;
  channel: string | null;
  message_template: string | null;
  is_ad: boolean;
  // ★ D218+ (2026-05-26): step별 담당자 알림 ON/OFF/default 3 상태
  notify_manager_on_pretest?: boolean | null;
  // Phase 9: 시점/조건 원본 + 백엔드 getJourneyDetail가 붙이는 타임라인 라벨
  delay_mode?: string | null;
  target_hour_kst?: number | null;
  condition_jsonb?: any;
  timingLabel?: string;
  conditionLabel?: string | null;
}

interface JourneyDetail {
  journey: JourneyRow;
  steps: StepRow[];
}

// ★ D210+ Phase 3 (2026-05-23 Harold 명시): funnel 시각화 영역 — JourneyStepStat 응답 매트릭스
interface JourneyStepStatFrontend {
  stepId: string;
  stepOrder: number;
  stepType: string;
  channel: string | null;
  enteredCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  totalCost: number;
  clickCount: number;
  conversionCount: number;
  clickRate: number;
  conversionRate: number;
  funnelPercentage: number;
  skippedHoursCount: number;
  skippedOptOutCount: number;
  skippedNoCustomerCount: number;
  conditionFailedCount: number;
  waitedCount: number;
}

// ★ D211+ Phase 2 (2026-05-23 Harold 명시): Journey Step Diagnosis 응답 매트릭스
interface OneClickAction {
  type: 'adjust_wait_hours' | 'adjust_condition' | 'add_variant' | 'pause_journey' | 'expand_send_hours';
  label: string;
  payload: Record<string, any>;
}

interface StepDiagnosisItem {
  stepId: string;
  stepOrder: number;
  stepType: string;
  severity: 'good' | 'warning' | 'critical';
  funnelPercentage: number;
  dropoutRate: number;
  topExitReason: string;
  topExitReasonCount: number;
  recommendation: string;
  oneClickAction: OneClickAction | null;
}

interface JourneyStepDiagnosis {
  journeyId: string;
  diagnosedAt: string;
  overallScore: number;
  topConcerns: string[];
  steps: StepDiagnosisItem[];
  totalEntered: number;
  totalCompleted: number;
  completionRate: number;
}

// ★ D211+ Phase 2 (2026-05-23 Harold 명시): 다음 단계 추천 응답 매트릭스
interface RecommendedStep {
  stepType: 'message' | 'wait' | 'condition';
  delayHours: number;
  channel: 'sms' | 'lms' | 'mms' | null;
  messageTemplate: string | null;
  subject: string | null;
  conditionType: string | null;
  reasoning: string;
  expectedImpact: string;
}

interface NextStepRecommendation {
  journeyId: string;
  recommendedAt: string;
  currentStepCount: number;
  recommended: RecommendedStep;
  alternatives: RecommendedStep[];
  reasoning: string;
}

interface CallbackOption {
  phone: string;
  source: string;
  description: string | null;
  is_default: boolean;
}

// ★ 2026-06-29: "오늘의 여정 기회" — 회사 실데이터 분석으로 산출 (가변 개수 + 매출 규모 우선순위)
interface JourneyOpportunity {
  type: string;
  templateCode: TemplateCode;
  title: string;
  description: string;
  count: number;
  valueAtStake?: number;
  priority?: 'high' | 'medium';
  suggestedObjective: string;
  /** ★ 2026-08-08 이어달리기 — 이 카드가 약속한 트리거. 생성 요청에 실어야 약속대로 만들어진다. */
  preferTriggerEvent?: string;
  /** ★ 2026-08-08 — 카드에 함께 나가는 고지(소급 금지·겹침). 서버가 정한 문장을 그대로 보여준다. */
  notices?: string[];
}

// ★ D188 Phase 2-B-1 (2026-05-21): step_type 3종 확장 — message/wait/condition.
// ★ 2026-09-30 V2 4차 — 'end'(끝 칸 · 발송 0). 서버 스위치(features.endChip)가 켜졌을 때만 고를 수 있다.
type StepType = 'message' | 'wait' | 'condition' | 'end';
/** ★ 2026-09-30 V2 4차 — 칸 수 상한(서버 journey-step-limits 와 같은 두 값): 문자 칸 7 · 전체 12. */
const MAX_MESSAGE_STEPS = 7;
const MAX_TOTAL_STEPS = 12;

// ★ D210+ Phase 3 (2026-05-23 Harold 명시): condition step type 3 union 확장
//   1. customer_field — 옛 매트릭스 (9 operator)
//   2. cdp_event_exists — 지난 N일 안 이벤트 EXISTS 영역 (예: "지난 7일 안 구매 X 영역")
//   3. journey_step_clicked — 옛 step N 클릭 영역 EXISTS (예: "Step 1 영역 클릭 X 영역 재시도")

type ConditionOperator = '==' | '!=' | '>=' | '<=' | '>' | '<' | 'in' | 'not_in' | 'is_null' | 'not_null';

interface ConditionJsonbCustomerField {
  type: 'customer_field';
  field: string;
  operator: ConditionOperator;
  value?: any;
}

interface ConditionJsonbCdpEventExists {
  type: 'cdp_event_exists';
  event_name: string;
  within_days: number;
  presence: 'exists' | 'not_exists';
}

interface ConditionJsonbJourneyStepClicked {
  type: 'journey_step_clicked';
  step_order: number;
  within_days: number;
  clicked: boolean;
}

// ★ 2026-09-30 V2 4차 — 새 조건 2종. 이 여정에 들어온 뒤 구매했나 · 앞쪽 문자 칸 링크를 눌렀나(저장 전 = 칸 번호 · 서버가 칸 id 로 바꾼다).
interface ConditionJsonbPurchaseSinceEntry {
  type: 'purchase_since_entry';
  purchased: boolean;
}
interface ConditionJsonbStepLinkClicked {
  type: 'step_link_clicked';
  step_ref_order?: number;
  step_id?: string;
  clicked: boolean;
}

type ConditionJsonb =
  | ConditionJsonbCustomerField
  | ConditionJsonbCdpEventExists
  | ConditionJsonbJourneyStepClicked
  | ConditionJsonbPurchaseSinceEntry
  | ConditionJsonbStepLinkClicked;

interface AIGeneratedStep {
  stepOrder: number;
  stepType: StepType;
  delayHours: number;
  channel: ChannelType;
  messageTemplate: string;
  subject: string;
  isAd: boolean;
  stepIntent: string;
  // ★ D188 Phase 2-B-1 (2026-05-21): condition step 평가용 conditionJsonb.
  conditionJsonb?: ConditionJsonb;
  // ★ 2026-07-11 진짜 분기: condition 미충족 시 이동할 step_order(전방만). null/미지정 = 여정 종료(현행).
  notMetGoto?: number | null;
  // ★ 2026-07-11 wait-until-event: 대기 step 이벤트 대기(발생 시 즉시 진행, 타임아웃 시 진행). 미지정 = 시간만 대기.
  waitEventName?: string;
  waitTimeoutHours?: number;
  // ★ D210+ Phase 3 (2026-05-23 Harold 명시): wait step 정확도 영역 — KST 시간대
  //   'relative' (default) = 옛 매트릭스 (delay_hours 영역)
  //   'specific_hour'      = target_hour_kst 영역 (오늘/내일 KST 정합)
  //   'next_business_day'  = 다음 평일 09시 KST
  delayMode?: 'relative' | 'relative_at_hour' | 'specific_hour' | 'next_business_day';
  targetHourKst?: number;  // 0~23 (relative_at_hour / specific_hour)
  // ★ D188 Phase 2-B-2 (2026-05-21): 알림톡 (channel='kakao') 영역.
  alimtalkProfileId?: string;
  alimtalkTemplateCode?: string;
  alimtalkVariableMap?: Record<string, string>;
  alimtalkNextType?: 'N' | 'S' | 'L' | 'A' | 'B';
  alimtalkNextContents?: string;
  alimtalkNextSubject?: string;
  // ★ D188 Phase 2-B-2 (2026-05-21): MMS (channel='mms') 영역.
  mmsImagePaths?: string[];
  // ★ 2026-06-30 여정 일반화 — date_anchor 스텝 D-N(앵커 N일 전, 0=당일).
  anchorOffsetDays?: number;
}

interface AIJourneyPackage {
  name: string;
  templateCode: TemplateCode;
  triggerEvent: string;
  triggerFilters: Record<string, any>;
  steps: AIGeneratedStep[];
  allowReentry: boolean;
  reentryCooldownDays: number | null;
  callbackNumberHint: string | null;
  budgetMonthlyHint: number | null;
  thresholdCostHint: number | null;
  reasoning: string;
  /**
   * ★ 2026-08-08 이어달리기 — 서버가 계약값으로 고정한 트리거. 값이 있을 때만 저장에 트리거를 싣는다.
   *   (마케팅 여정은 원래 트리거를 안 보내고 템플릿 기본값을 쓴다 — 그대로 두면 추천이 약속한 여정이 안 만들어진다)
   */
  presetTriggerEvent?: string | null;
  /** ★ 2026-08-08 혜택 입력 — 이 패키지 생성에 실제로 쓰인 혜택. 재생성이 다시 싣는다. */
  benefitText?: string | null;
  /** ★ 2026-09-29 여정 V2 0차 ⑪ — "목표를 이루면 남은 문자 안 보냄" 기본값(서버가 트리거 계약에서 파생 · 화면 목록 아님). */
  goalExitDefault?: boolean;
  /** ★ 2026-09-29 여정 V2 0차 ② — AI 가 낸 대상 조건 중 쓸 수 없어 뺀 것("반영 안 됨"으로 보인다). */
  droppedConditionNotices?: string[];
  /** ★ 2026-09-29 여정 V2 0차 ① — 계획 모달 "누구에게"(저장될 대상 조건을 사람 말로 · 서버가 만든 문장). */
  targetSummary?: string;
  // ★ 2026-06-30 여정 일반화 — 시작 방식(start_kind) + 날짜축/one_shot. 미설정(기존 마케팅 여정)이면 저장 시 미전송 = 옛 동작 그대로.
  startKind?: 'event' | 'standing' | 'date_anchor' | 'one_shot';
  anchorDate?: string | null;
  anchorRecurrence?: string | null;
  anchorRecurrenceDay?: number | null;
  anchorHourKst?: number | null;
  oneShotScheduledAt?: string | null;
}

interface RefineCandidate {
  message: string;
  tone: RefineTone;
  bytes: number;
  reasoning: string;
}

/**
 * ★ 2026-08-01 설계서 §2-3 — 빠른 시작 칩이 어느 트리거를 쓰는지.
 *   회사가 준 데이터로 그 트리거를 판정할 수 없으면 칩을 잠근다. custom은 트리거 데이터가 필요 없다.
 *   만들어지고 켜졌는데 대상이 0건인 상태를 사용자가 모르는 것이 제일 나쁘다.
 */
const TEMPLATE_TRIGGER_KEY: Record<TemplateCode, string | null> = {
  onboarding: 'signup',
  repeat: 'purchase',
  dormant: 'dormant',
  cart: 'cart',
  birthday: 'birthday',
  reservation: 'reservation',
  custom: null,
};

const TEMPLATE_VISUAL: Record<TemplateCode, { icon: typeof UserPlus; gradient: string; label: string; hint: string }> = {
  onboarding:  { icon: UserPlus,     gradient: 'from-emerald-400 to-teal-500',   label: '신규 가입 환영',  hint: '24시간 안 가입자' },
  repeat:      { icon: Repeat,       gradient: 'from-cyan-400 to-blue-500',      label: '재구매 유도',     hint: '구매 직후 follow-up' },
  dormant:     { icon: Moon,         gradient: 'from-violet-400 to-indigo-500',  label: '휴면 회수',       hint: '30일+ 휴면 고객' },
  cart:        { icon: ShoppingCart, gradient: 'from-amber-400 to-orange-500',   label: '장바구니 회복',   hint: '24시간 결제 X' },
  birthday:    { icon: Cake,         gradient: 'from-pink-400 to-rose-500',      label: '생일 축하',       hint: 'D-7 사전 + D-Day' },
  reservation: { icon: CalendarIcon, gradient: 'from-blue-400 to-indigo-500',    label: '예약 알림',       hint: 'D-3 + D-Day + D+1' },
  custom:      { icon: Sparkles,     gradient: 'from-fuchsia-400 to-purple-500', label: '자유 여정',       hint: 'AI가 자동 설계' },
};

// ★ D222+ Phase 1 (2026-05-27): status badge 시인성 강화 (-300 → -200)
/**
 * ★ 2026-08-02 (Codex 1R P2-7) — **시작 조건은 실제 trigger_event에서 읽는다.**
 *   `TEMPLATE_VISUAL.label`은 캠페인 목적('재구매 유도')이지 진입 조건('주문 완료')이 아니다.
 *   추천 모달의 일이 "무엇이 이 여정을 시작하는가"를 확인시키는 것이라, 목적을 조건 자리에 쓰면 그 일을 못 한다.
 */
function triggerLabelOf(triggerEvent?: string, templateCode?: TemplateCode): string {
  const def = triggerEvent ? TRIGGER_EVENTS.find((t) => t.triggerEvent === triggerEvent) : undefined;
  if (def) return def.label;
  if (triggerEvent === 'custom') return '설정한 대상 조건';
  if (triggerEvent === 'journey.after') return '앞 여정을 마치면';   // ★ V.3 §18 — 지도에서 붙인 여정
  return templateCode ? TEMPLATE_VISUAL[templateCode]?.label || '설정한 조건' : '설정한 조건';
}

const STATUS_BADGE: Record<JourneyStatus, { label: string; cls: string }> = {
  // ★ 2026-09-30 AI 존 대개편 D6: 이름 = 초안·켜짐·멈춤·끝남(목록·지도·상세 한 벌 · utils/journey-row-actions JOURNEY_STATUS_LABEL)
  draft:  { label: JOURNEY_STATUS_LABEL.draft,  cls: 'neutral' },
  active: { label: JOURNEY_STATUS_LABEL.active, cls: 'green' },
  paused: { label: JOURNEY_STATUS_LABEL.paused, cls: 'amber' },
  ended:  { label: JOURNEY_STATUS_LABEL.ended,  cls: 'neutral' },
};

// ★ 2026-06-25: (광고) 접두사 / 무료거부 문구를 단일 출처로 — 발송 미리보기와 원본 편집이 같은 합성을 보이게.
//   원본 편집에는 읽기 전용으로만 표시하고 저장 본문(messageTemplate)에는 넣지 않는다(발송 시 1회만 합성 = 이중 부착 차단).
function adPrefixFor(channel: ChannelType): string {
  return (channel === 'lms' || channel === 'mms') ? '(광고) ' : '(광고)';
}
function adRejectFor(channel: ChannelType, opt080: string): string {
  const isLms = channel === 'lms' || channel === 'mms';
  if (opt080) return isLms ? `무료수신거부 ${opt080}` : `무료거부${opt080.replace(/-/g, '')}`;
  return isLms ? '무료수신거부' : '무료거부';
}

function buildPreview(message: string, isAd: boolean, channel: ChannelType, opt080: string): string {
  if (!isAd || !message) return message;
  // 본문에 이미 (광고) 마커(반각/전각)가 있으면 제거 후 표준 1회 부착 — 이중부착 방지
  const pure = message.replace(/^\s*[(（]\s*광고\s*[)）]\s*/, '');
  return `${adPrefixFor(channel)}${pure}\n${adRejectFor(channel, opt080)}`;
}

// ★ 2026-06-22: 스텝 타임라인 지연 표시 — 이전 스텝 후 대기 시간을 사람이 읽기 쉽게
function formatStepDelay(s: AIGeneratedStep): string {
  if (s.delayMode === 'next_business_day') return '다음 평일 09시';
  if (s.delayMode === 'specific_hour') return `${s.targetHourKst ?? 9}시`;
  const h = s.delayHours ?? 0;
  if (h === 0) return '바로';
  if (h < 24) return `${h}시간`;
  if (h % 24 === 0) return `${h / 24}일`;
  return `${Math.floor(h / 24)}일 ${h % 24}시간`;
}

function getByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) bytes += s.charCodeAt(i) > 127 ? 2 : 1;
  return bytes;
}

function hasPlaceholder(message: string): boolean {
  return /\[.*?\]/.test(message);
}

/**
 * ★ 2026-08-02 §13-4 — 저장을 막는 문제를 모은다. **저장 검증과 브리핑 모달이 같은 함수를 쓴다.**
 *   따로 쓰면 브리핑은 통과시키는데 저장은 거부하는(또는 그 반대) 어긋남이 생긴다.
 *   ★ D188 Phase 2-B-1 (2026-05-21) step_type별 분기를 그대로 옮긴 것 — 규칙 자체는 바뀌지 않았다.
 */
const CONDITION_OPS = ['==', '!=', '>=', '<=', '>', '<', 'in', 'not_in', 'is_null', 'not_null'];
function collectStepIssues(steps: AIGeneratedStep[]): Array<{ stepOrder: number; message: string }> {
  const out: Array<{ stepOrder: number; message: string }> = [];
  for (const s of steps) {
    if (s.stepType === 'wait') {
      if (Number(s.delayHours) <= 0) out.push({ stepOrder: s.stepOrder, message: '대기 시간을 1시간 이상으로' });
      continue;
    }
    // ★ 2026-09-30 V2 4차 — 끝 칸은 확인할 것이 없다(대기 0 · 발송 0). 첫 칸이면 안 된다.
    if (s.stepType === 'end') {
      if (s.stepOrder === 1) out.push({ stepOrder: s.stepOrder, message: '첫 칸은 끝 칸일 수 없어요' });
      continue;
    }
    if (s.stepType === 'condition') {
      const c = s.conditionJsonb;
      if (c && c.type === 'purchase_since_entry') continue;
      if (c && c.type === 'step_link_clicked') {
        const target = steps.find((t) => t.stepOrder === c.step_ref_order);
        if (!c.step_id && (!target || target.stepOrder >= s.stepOrder || target.stepType !== 'message')) {
          out.push({ stepOrder: s.stepOrder, message: '링크를 볼 앞쪽 문자 칸을 골라 주세요' });
        }
        continue;
      }
      if (c && c.type !== 'customer_field') {
        // ★ 2026-09-29 V2 0차 ⑦ — 옛 두 종류는 지금 저장할 수 없다(사유를 그대로 말한다 · "필드 선택 필요"는 엉뚱한 안내였다).
        out.push({ stepOrder: s.stepOrder, message: '이 조건 종류는 지금 저장할 수 없어요. 고객 정보 조건으로 바꿔 주세요' });
      } else if (!c || !c.field || !c.field.trim()) {
        out.push({ stepOrder: s.stepOrder, message: '조건 필드 선택 필요' });
      } else if (!CONDITION_OPS.includes(c.operator)) {
        out.push({ stepOrder: s.stepOrder, message: '조건 연산자 선택 필요' });
      } else if (!['is_null', 'not_null'].includes(c.operator) && (c.value === undefined || c.value === null || c.value === '')) {
        out.push({ stepOrder: s.stepOrder, message: '비교값 입력 필요' });
      }
      continue;
    }
    if (!s.messageTemplate?.trim() || s.messageTemplate.trim().length < 10) {
      out.push({ stepOrder: s.stepOrder, message: '본문이 비었거나 너무 짧음' });
      continue;
    }
    if ((s.channel === 'lms' || s.channel === 'mms') && (!s.subject || !s.subject.trim())) {
      out.push({ stepOrder: s.stepOrder, message: '제목 없음(LMS·MMS 필수)' });
      continue;
    }
    // ★ 2026-08-02 Harold 지시 — 이미지 없는 MMS는 저장하지 않는다.
    //   그대로 두면 LMS보다 비싼 단가로 글자만 나간다(고객사 돈이 새는 방향).
    if (s.channel === 'mms' && (s.mmsImagePaths?.length ?? 0) === 0) {
      out.push({ stepOrder: s.stepOrder, message: '이미지 없음(MMS 필수)' });
    }
  }
  return out;
}

// ★ 2026-09-26 한줄로 V2 m068(B-0910-5) — 문자로 보낼 수 없는 글자만(게이트웨이 CP949 표 · smsSafeChars CT).
//   옛 검사는 ★♥☎▶※“” 같은 보낼 수 있는 기호까지 "통신사 미지원"으로 알렸고, 발송 직전 정리가 실제로 그 글자를 바꿨다.
//   발송 경로는 이제 보낼 수 있는 글자를 바꾸지 않는다(backend message-sanitizer `sanitizeUnsendableForSms`).
function detectUnsafe(text: string): string[] {
  return findUnsupportedSmsChars(text || '').map((u) => u.char);
}

export default function JourneysPage() {
  const navigate = useNavigate();
  const toast = useToast();
  // ★ 2026-08-02 §13-2 — 'studio' = 한 화면에서 스텝 하나를 완결하는 흐름(스텝마다 화면 전환).
  //   'review'(한 화면에 전부)는 정보 알림·날짜축 빌더와 저장된 여정 편집이 계속 쓴다.
  const [view, setView] = useState<'main' | 'review'>('main');
  // ★ 2026-08-02 등급 서열 — 잠긴 자리에서 그 자리로 연다(설정 메뉴로 쫓아내지 않는다).
  const [gradeOrderOpen, setGradeOrderOpen] = useState(false);
  /**
   * ★ 2026-08-02 (Codex 1R P2-5) — **생성에 실제로 쓴 목적**을 확정 저장한다.
   *   `objective` 텍스트 상자는 생성 이후에도 바뀌고, 빠른 시작·기회 카드 경로는 그 상자를 아예 안 쓴다.
   *   그 상자를 나중에 읽으면 AI 맥락과 화면이 생성과 무관한 문장을 물고 간다.
   */
  const [journeys, setJourneys] = useState<JourneyRow[]>([]);
  // ★ 2026-06-29: "오늘의 여정 기회" 카드 (실데이터 집계) + 페이징
  const [opportunities, setOpportunities] = useState<JourneyOpportunity[]>([]);
  // ★ 2026-09-30: 만들 수 있는 여정 범위 안내는 명령 카드 "자세히"로 펼친다(옛: 입구 카드 아래 상시)
  const [showScopeNote, setShowScopeNote] = useState(false);
  const [oppPage, setOppPage] = useState(0);
  /**
   * ★ 2026-08-08 이어달리기 — 방금 저장한 여정의 **실제 시작 신호**(저장 응답에서 읽는다).
   *   여기서 패키지 값을 믿으면 안 된다: 마케팅 여정은 저장 때 트리거를 안 보내고 템플릿 기본값을 쓴다.
   *   세션 한정이라 닫으면 끝이다(운영 중 추천은 기회 카드가 상시 담당한다).
   */
  const [successionFrom, setSuccessionFrom] = useState<string | null>(null);
  // ★ 2026-09-29 여정 V2 0차 ⑥ — 방금 저장한 여정의 "목표를 이루면 남은 문자 안 보냄" 실제 저장값.
  const [successionGoalExit, setSuccessionGoalExit] = useState<boolean | null>(null);
  const [callbackOptions, setCallbackOptions] = useState<CallbackOption[]>([]);
  const [opt080Number, setOpt080Number] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // ★ D211+ Phase 3 (2026-05-23 Harold 명시): status 필터 토글 (보관함 영역 분리)
  const [statusFilter, setStatusFilter] = useState<JourneyStatusFilter>('all');
  /**
   * ★ 2026-08-08 — 지금 손에 있는 목록이 **어느 필터의 응답인가.**
   *   필터는 조회보다 먼저 바뀌고, 겹친 옛 요청이 늦게 도착해 목록을 덮을 수도 있다.
   *   "활성 후속 여정이 없다"를 이 목록으로 증명하려면 목록의 출처가 지금 필터와 같아야 한다.
   */
  const [loadedStatus, setLoadedStatus] = useState<JourneyStatusFilter | null>(null);
  // ★ D211+ Phase 3-fix (2026-05-23 Harold 명시): archive/unarchive/delete 영역 커스텀 다크 톤 모달 (native confirm/prompt 폐기)
  const [actionModal, setActionModal] = useState<{ mode: JourneyActionMode; journeyId: string; journeyName: string } | null>(null);
  // ★ D218+ (2026-05-26): 활성화 자동 검증 모달 + 정지 이력 모달
  const [activationModal, setActivationModal] = useState<{ journeyId: string; journeyName: string; journeyStatus: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [pauseLogsModal, setPauseLogsModal] = useState<{ journeyId: string; journeyName: string } | null>(null);
  // ★ 2026-07-11 [타겟확인] — 여정별 1회 로드 캐시 + 클라 페이징 (0710 자동마케팅 패턴 미러)
  const [targetModal, setTargetModal] = useState<{ journeyId: string; journeyName: string } | null>(null);
  const [targetInfo, setTargetInfo] = useState<{
    recipients: any[]; displayTotal: number; capped: boolean;
    criteria: string | null; basisLabel: string | null;
    conditionColumns: { key: string; label: string }[];
  } | null>(null);
  const targetCacheRef = useRef<Record<string, any>>({});
  const fetchJourneyTargets = async (journeyId: string) => {
    if (targetCacheRef.current[journeyId]) return targetCacheRef.current[journeyId];
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/ai/operator/journeys/${journeyId}/target-recipients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: '{}',
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '발송 대상 조회에 실패했습니다.');
    targetCacheRef.current[journeyId] = data;
    return data;
  };
  const journeyTargetPage = async (page: number, pageSize: number) => {
    if (!targetModal) return { recipients: [], total: 0 };
    const info = await fetchJourneyTargets(targetModal.journeyId);
    setTargetInfo(info);
    return arrayPager(info.recipients || [])(page, pageSize);
  };
  // 문안 수정 모달 — 초안·일시정지 여정만 (활성은 일시정지 후)
  const [editMessageModal, setEditMessageModal] = useState<{ journeyId: string; journeyName: string; journeyStatus: string } | null>(null);

  // One-shot AI 생성 흐름
  const [objective, setObjective] = useState('');
  // ★ 2026-08-08 혜택 입력(선택) — 모달의 자연어·빠른 시작 두 경로가 같은 값을 쓴다.
  //   1클릭 카드(이어달리기·기회)는 이 상자를 읽지 않는다 — 옛 입력이 엉뚱한 여정에 끼면 안 된다.
  const [benefitText, setBenefitText] = useState('');
  // ★ 2026-10-05 한줄로 시그니처(설계서 §5) — 스위치 켠 회사는 명령 카드 한 줄이 모달에 남은 혜택 칸 값을 싣지 않는다
  //   (화면에 안 보이는 값이 혜택 근거가 되던 길). 혜택은 그 값이 보이는 모달 · 스튜디오 채움 패널에서만 받는다.
  const [lineFactsOn, setLineFactsOn] = useState(false);
  useEffect(() => { void fetchOneLineEnabled().then(setLineFactsOn); }, []);
  // ★ 2026-10-23 한 줄 여정 한 길 — 열린 입구(한 줄 · 시작 사건). null = 닫힘.
  const [lineJourney, setLineJourney] = useState<{ sentence?: string; preset?: InterviewPreset } | null>(null);
  // ★ 2026-10-10 한 줄 묻기 — 판정은 입구에서만(목록 한 줄 · 지도 ?objective= 자동 경로). 만들기는 ★1023 openLineJourney 한 길.
  const lineAsk = useLineAsk('journeys');
  const journeyCost = `${AI_GENERATE_COSTS['journey-ai-generate']}크레딧`;
  // ★ 2026-08-01 설계서 §2-3 — 이 회사가 지금 만들 수 있는 여정. 못 만드는 것은 사유와 함께 잠근다.
  //   조회 실패면 잠그지 않는다(화면 편의 게이트). 실제 발송 차단은 백엔드가 담당한다.
  const [dataCap, setDataCap] = useState<Record<string, { available: boolean; reason: string }> | null>(null);
  // ★ 2026-09-30 V2 4차 — 끝 칸 쓰기 스위치(서버 JOURNEY_END_CHIP_ENABLED). 꺼져 있으면 끝 칸을 고를 수 없다.
  const [endChipEnabled, setEndChipEnabled] = useState(false);
  // ★ 2026-08-02 §13-5 — 구매가 어느 문으로 들어오는지 + 마지막 도착 시각. 매장 문이면 하루 모아 다음 날 오전에 나간다.
  const [purchaseDoor, setPurchaseDoor] = useState<{ door: 'mall' | 'ledger'; lastArrivalAt: string | null } | null>(null);
  // ★ D210+ Phase 2-fix6 (Harold 명시 2026-05-23): 6 sub-agent 진행 + 샘플 고객 머지 토글
  const [sampleCustomer, setSampleCustomer] = useState<Record<string, string | number | null> | null>(null);
  // ★ D210+ Phase 2-fix9 (Harold 명시 2026-05-23): Liquid 렌더링 영역 (field 키 매트릭스).
  const [sampleCustomerFields, setSampleCustomerFields] = useState<Record<string, any> | null>(null);
  // ★ D210+ Phase 2-fix10 (Harold 명시 2026-05-23): 옛 showMergedPreview state 폐기 — 토글 영역 X, 위/아래 영역 명확 분리.
  const [aiPkg, setAiPkg] = useState<AIJourneyPackage | null>(null);
  // 'marketing' = 모달 닫힘(기본). 세 진입이 모두 모달이라 열림 상태를 값으로 구분한다(2026-08-02).
  const [purpose, setPurpose] = useState<'marketing' | 'marketing-modal' | 'info-alert' | 'date-anchor'>('marketing');
  const [reviewName, setReviewName] = useState('');
  const [reviewCallback, setReviewCallback] = useState('');
  const [reviewUseStorePhone, setReviewUseStorePhone] = useState(false);
  // ★ D189 #2 (2026-05-22): 알림톡 채널 패널 데이터 — 회사 발신프로필 + 템플릿 + 활성 필드 (review view kakao step UI용)
  const [alimtalkSenders, setAlimtalkSenders] = useState<AlimtalkSenderProfile[]>([]);
  const [alimtalkTemplates, setAlimtalkTemplates] = useState<AlimtalkTemplate[]>([]);
  const [customerFields, setCustomerFields] = useState<Array<{ key: string; label: string }>>([]);
  // ★ 2026-06-30 여정 일반화 SP-B — AI 꾸미기 활용 컬럼(data-profile 안전 %변수% 토큰). 날짜축 스텝 편집 모달용.
  const [dataProfileVars, setDataProfileVars] = useState<Array<{ token: string; label: string }>>([]);
  // 자사몰(CDP) 연동 활성 여부 — 배송 등 custom 이벤트 트리거 잠금 해제용. install-status 기준(키 발급 or 이벤트 수신).
  const [hasMallIntegration, setHasMallIntegration] = useState(false);
  const [reviewBudget, setReviewBudget] = useState('');
  const [reviewThreshold, setReviewThreshold] = useState('');
  // ★ 2026-07-10 목표 달성 시 자동 종료 — 기본값 제안(끌 수 있음)
  // ★ 2026-09-29 여정 V2 0차 ⑪(Harold 승인 결정 1) — 기본값은 **서버가 트리거 계약에서 파생**한다(aiPkg.goalExitDefault).
  //   옛: 이 화면의 템플릿 목록(repeat · cart · dormant)이 정해 같은 트리거도 만드는 길마다 달랐다
  //   (AI 자유 생성 'dormant' = 켜짐 · 이어달리기 프리셋 'custom' = 꺼짐 · 가입은 목록에 없어 늘 꺼짐).
  //   트리거가 바뀌는 수정(대화형 수정) 뒤에도 그 트리거의 기본값으로 다시 맞춘다.
  const [reviewGoalExit, setReviewGoalExit] = useState(false);
  // (회의론자 0차 검증 4-가) 담당자가 토글을 직접 만졌는가 — 안 만졌고 패키지에 기본값이 없으면(정보 알림 · 날짜축처럼
  //   화면이 조립한 패키지) 저장 요청에서 값을 빼 서버가 트리거 계약에서 정하게 한다. 경로마다 다른 기본값을 막는다.
  const [reviewGoalExitTouched, setReviewGoalExitTouched] = useState(false);
  useEffect(() => {
    setReviewGoalExit(aiPkg?.goalExitDefault === true);
    setReviewGoalExitTouched(false);
  }, [aiPkg?.goalExitDefault, aiPkg?.triggerEvent]);

  // step 수정
  const [previewSteps, setPreviewSteps] = useState<Set<number>>(new Set());
  // ★ 2026-06-29: 검토 화면 난잡함 제거 — step 편집을 인라인에서 모달로(요약 카드 + 편집 모달). 편집 중 step idx.
  const [editingStepIdx, setEditingStepIdx] = useState<number | null>(null);
  // ★ 2026-06-29: 대화형 여정 수정 — 자연어로 초안 패키지 수정
  const [editInstruction, setEditInstruction] = useState('');
  const [editingPackage, setEditingPackage] = useState(false);
  const [refining, setRefining] = useState<{ stepIdx: number; candidates: RefineCandidate[] } | null>(null);
  const [refineLoading, setRefineLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // ★ D191 (2026-05-22) Phase B-1 Liquid Templating: 미리보기 모달 state

  const token = () => localStorage.getItem('token');
  const customerGate = useCustomerDataGate(token());
  const [showDataGate, setShowDataGate] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      // ★ D211+ Phase 3 (2026-05-23 Harold 명시): statusFilter 영역 backend 전달 — archived 영역 분리
      const statusParam = statusFilter === 'all' ? 'all' : statusFilter;
      const [jr, cr, opr] = await Promise.all([
        fetch(`/api/ai/operator/journeys?status=${statusParam}`, { headers: { Authorization: `Bearer ${token()}` } }),
        fetch('/api/ai/operator/journeys-callback-numbers', { headers: { Authorization: `Bearer ${token()}` } }),
        fetch('/api/ai/operator/journeys-opportunities', { headers: { Authorization: `Bearer ${token()}` } }),
      ]);
      const jd = await jr.json();
      const cd = await cr.json();
      const od = await opr.json().catch(() => ({ success: false }));
      if (od?.success) setOpportunities(Array.isArray(od.opportunities) ? od.opportunities : []);
      if (jd.success) {
        setJourneys(jd.journeys || []);
        if (Number.isFinite(Number(jd.costs?.operation))) setOperationCost(Number(jd.costs.operation));
        // 이 목록이 어느 필터의 성공 응답인지 함께 적는다(요청 시점 값 — 늦게 온 옛 응답이면 지금 필터와 어긋난다).
        setLoadedStatus(statusFilter);
      }
      else if (jd.code === 'AI_OPERATOR_GATED') setError('AI Operator 진입 권한이 없습니다. 관리자에게 문의해주세요.');
      else setError(jd.error || '여정 조회 실패');
      if (cd.success) {
        setCallbackOptions(cd.numbers || []);
        setOpt080Number(cd.opt080Number || '');
      }
    } catch (e: any) {
      setError(e?.message || '조회 중 오류');
    } finally {
      setLoading(false);
    }
  };

  // ★ D211+ Phase 3 (2026-05-23 Harold 명시): statusFilter 변경 시 자동 재조회
  useEffect(() => { loadAll(); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // ★ 2026-08-01 설계서 §2-3 — 이 회사 데이터로 만들 수 있는 여정을 받아온다.
  //   실패해도 잠그지 않는다: 화면 편의 게이트일 뿐이고, 여기서 막으면 만들 수 있는 여정까지 못 만든다.
  const loadDataCap = async () => {
    try {
      const res = await fetch('/api/ai/operator/journeys-data-capability', {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data?.success && data.triggers) setDataCap(data.triggers);
      if (data?.success) setEndChipEnabled(data?.features?.endChip === true);
      if (data?.success && data.purchaseDoor) setPurchaseDoor(data.purchaseDoor);
    } catch {
      /* 조회 실패 = 잠그지 않음(기존 동작 유지) */
    }
  };
  useEffect(() => { void loadDataCap(); }, []);

  // ★ 2026-09-29 여정 V2 1차 — 생애 지도 · 빈 곳 찾기의 [만들기]가 이 화면으로 온다(?preset=시작 사건&objective=문장).
  //   ★ 2026-10-23 모든 입구와 같은 한 길(openLineJourney = 문장으로 만들기 창)을 한 번만 연다. 고객 수 게이트가 읽힌 뒤에 연다.
  const [searchParams, setSearchParams] = useSearchParams();
  // ★ 2026-10-20 여정 V.3 §9-1 — 작업 화면 = 주소 ?journey=ID&step=ID(지도와 같은 방식 · 뒤로 가기 · 새로 고침에도 같은 창 · 목록 스크롤 유지).
  const wsJourney = searchParams.get('journey');
  const wsStep = searchParams.get('step');
  const openWorkspace = (id: string, step?: string | null) => setSearchParams((prev) => {
    const n = new URLSearchParams(prev); n.set('journey', id); if (step) n.set('step', step); else n.delete('step'); return n;
  }, { replace: searchParams.has('journey') });
  const closeWorkspace = () => setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete('journey'); n.delete('step'); return n; }, { replace: true });
  const [operationCost, setOperationCost] = useState(10);
  const journeyActions = useJourneyActions({ onChanged: () => { void loadAll(); }, operationCost });
  const presetHandledRef = useRef(false);
  useEffect(() => {
    if (presetHandledRef.current || customerGate.loading) return;
    const preset = searchParams.get('preset');
    // ★ 2026-10-24 결함 14 — 허브 · 자동 마케팅의 「여정으로」 넘기기(sessionStorage)도 같은 한 길(문장으로 만들기 창)
    //   옛: 목표만 입력칸에 넣고 없는 「검토 단계」를 안내했다(문안은 버려졌다).
    let stashed = '';
    try {
      const raw = sessionStorage.getItem('journeyObjectivePrefill');
      if (raw) stashed = String(JSON.parse(raw)?.objective || '').trim();
    } catch { /* 깨진 값 = 버린다 */ }
    sessionStorage.removeItem('journeyObjectivePrefill');
    const queryObjective = searchParams.get('objective')?.trim() || stashed;
    if (!preset && !queryObjective) return;
    presetHandledRef.current = true;
    setSearchParams({}, { replace: true });
    if (preset) { openLineJourney({ preset: { triggerEvent: preset, objective: queryObjective || undefined } }); return; }
    // ★ 2026-09-30 AI 존 대개편(Codex R1): 지도 탭 명령 카드의 한 줄(목표만 · preset 없음)도 같은 가드 뒤 한 번만 생성한다 — 목록 한 줄과 같은 자유 문장 경로.
    // ★ 2026-10-10 한 줄 묻기 — 지도 한 줄도 질문이면 답만 연다(목록 한 줄과 같은 판정 · 여정을 만들지 않는다)
    setObjective(queryObjective);
    void (async () => {
      if (await lineAsk.route(queryObjective)) return;
      openLineJourney({ sentence: queryObjective });
    })();
  }, [customerGate.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ★ D189 #2 (2026-05-22): 알림톡 발신프로필 + 템플릿 + 활성 필드 fetch (review view 알림톡 step UI용)
  useEffect(() => {
    const t = token();
    if (!t) return;
    Promise.all([
      fetch('/api/alimtalk/senders', { headers: { Authorization: `Bearer ${t}` } }).catch(() => null),
      fetch('/api/companies/kakao-templates?status=APPROVED', { headers: { Authorization: `Bearer ${t}` } }).catch(() => null),
      fetch('/api/customers/enabled-fields', { headers: { Authorization: `Bearer ${t}` } }).catch(() => null),
      fetch('/api/cdp/install-status', { headers: { Authorization: `Bearer ${t}` } }).catch(() => null),
      fetch('/api/ai/operator/data-profile', { headers: { Authorization: `Bearer ${t}` } }).catch(() => null),
    ]).then(async ([sndRes, tplRes, fldRes, cdpRes, dpRes]) => {
      if (dpRes?.ok) {
        const data = await dpRes.json();
        // ★ 2026-08-08 (Harold 접수) — 서버는 `safeFields`·`conditionalFields`·`blockedFields`로 나눠 준다.
        //   `data.fields`를 읽고 있어 **항상 0**이었고(0630 배선 이래), 그래서 꾸미기 칩·변수 넣기 카드가
        //   화면에서 통째로 사라졌다. 날짜축 빌더의 꾸미기도 같은 값을 써서 함께 죽어 있었다.
        //   ⛔ `conditionalFields`는 채우지 않는다 — 채움률이 중간이라 빈 값 고객에게 어색한 문장이 나간다
        //     (0630 주석의 원래 의도도 "안전 %변수% 토큰"이다). `blockedFields`는 당연히 제외.
        const vars = (data.safeFields || []).map((f: any) => ({
          token: String(f.percentVar || f.label || '').trim(),
          label: String(f.label || f.percentVar || '').trim(),
        })).filter((v: { token: string }) => v.token);
        setDataProfileVars(vars);
      }
      if (sndRes?.ok) {
        const data = await sndRes.json();
        setAlimtalkSenders(data.profiles || []);
      }
      if (tplRes?.ok) {
        const data = await tplRes.json();
        setAlimtalkTemplates(data.templates || []);
      }
      if (fldRes?.ok) {
        const data = await fldRes.json();
        const fields = (data.fields || []).map((f: any) => ({
          key: f.field_key,
          label: f.display_name || f.field_label || f.field_key,
        }));
        setCustomerFields(fields);
      }
      if (cdpRes?.ok) {
        const data = await cdpRes.json();
        // 키 발급됐거나 이벤트가 들어온 적 있으면 자사몰 연동 활성 → 배송 트리거 잠금 해제
        setHasMallIntegration(!!data.keyIssuedAt || (data.total || 0) > 0);
      }
    });
  }, []);

  // ★ D190 #3 (2026-05-22): 알림톡 AI 자동 매칭 — Opus 4.7 매칭 + 변수 자동 매핑
  const handleAlimtalkAutoMatch = async (stepIdx: number) => {
    if (!aiPkg) return;
    const matchObjective = aiPkg.name || aiPkg.reasoning || objective || '캠페인 발송';
    if (!matchObjective || matchObjective.trim().length < 3) {
      toast.warning('캠페인 의도가 비어있습니다. 여정 이름 또는 목표를 입력해주세요.');
      return;
    }
    try {
      const res = await fetch('/api/ai/operator/alimtalk/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          campaignObjective: matchObjective,
          campaignType: aiPkg.templateCode,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.error || 'AI 매칭 실패');
        return;
      }
      if (!data.matched || !data.template) {
        toast.warning(data.suggestion || '이 여정에 맞는 알림톡 템플릿이 없어요. 맞는 템플릿을 등록해 주세요.');
        return;
      }
      // 매칭 결과 자동 적용 — 회사 admin 검토 후 추가 정정 가능
      const variableMap: Record<string, string> = {};
      for (const m of (data.variableMappings || [])) {
        if (m.customerFieldKey) {
          variableMap[m.templateVariable] = `@@${m.customerFieldKey}@@`;
        }
      }
      updateStep(stepIdx, {
        alimtalkProfileId: data.template.profile_id,
        alimtalkTemplateCode: data.template.template_code,
        alimtalkVariableMap: variableMap,
      });
      const unmappedCount = (data.variableMappings || []).filter((m: any) => !m.customerFieldKey).length;
      toast.success(
        `AI 자동 연결 완료 (맞음 점수 ${data.matchScore})\n\n` +
        `템플릿: ${data.template.template_name}\n` +
        `근거: ${data.matchReason}\n\n` +
        `변수 자동 연결: ${(data.variableMappings || []).length}건 (못 맞춘 ${unmappedCount}건은 직접 넣어 주세요)\n\n` +
        `검토하고 고친 뒤 켜 주세요.`
      );
    } catch (err: any) {
      toast.error(err?.message || 'AI 매칭 중 오류');
    }
  };

  // ★ D189 #2 (2026-05-22): step.alimtalk* ↔ AlimtalkChannelState 매핑 헬퍼
  const stepToAlimtalkState = (step: AIGeneratedStep): AlimtalkChannelState => {
    const tpl = alimtalkTemplates.find((t) => t.template_code === step.alimtalkTemplateCode);
    return {
      profileId: step.alimtalkProfileId || '',
      templateCode: step.alimtalkTemplateCode || '',
      templateId: tpl?.id || '',
      variableMap: step.alimtalkVariableMap || {},
      nextType: (step.alimtalkNextType || 'L') as 'N' | 'S' | 'L' | 'A' | 'B',
      nextContents: step.alimtalkNextContents || '',
      nextSubject: step.alimtalkNextSubject || '',
    };
  };

  const alimtalkStateToStepPatch = (state: AlimtalkChannelState): Partial<AIGeneratedStep> => ({
    alimtalkProfileId: state.profileId || undefined,
    alimtalkTemplateCode: state.templateCode || undefined,
    alimtalkVariableMap: state.variableMap,
    alimtalkNextType: state.nextType,
    alimtalkNextContents: state.nextContents,
    alimtalkNextSubject: state.nextSubject,
  });

  // ════════ 한 줄 여정 = 한 길 ════════
  // ★ 2026-10-23 여정 결함 0 — 여정을 만드는 모든 입구(한 줄 · 빠른 시작 · 기회 카드 · 다음 수 · 한 줄 답 카드 · 지도 ?preset · ?objective)가
  //   문장으로 만들기 창 하나로 간다 → 질문표(재료 판 · 한 줄의 혜택 · 마감일을 채워 둠) → 서버 초안(초안마다 크레딧 · 멱등) → 작업 화면.
  //   옛: 화면이 AI 패키지를 들고 있다 저장했다(돌려보기마다 차감 · 멱등 없음 · 화면 매핑 · 반복 발송 안내가 안 보이던 길).
  const openLineJourney = (entry: { sentence?: string; preset?: InterviewPreset }) => {
    if (customerGate.isEmpty) { setShowDataGate(true); return; }
    setLineJourney(entry);
  };
  /** 추천 카드(기회 · 한 줄 답) — 시작 사건이 있으면 그 사건의 질문표, 없으면 문장으로. */
  const openFromCard = (objectiveText?: string, preferTriggerEvent?: string) => (preferTriggerEvent
    ? openLineJourney({ preset: { triggerEvent: preferTriggerEvent, objective: objectiveText } })
    : openLineJourney({ sentence: objectiveText || '' }));

  /** 다시 만들기 — 검토 화면의 패키지는 정보 알림 · 날짜축 빌더가 만든 것뿐이다(마케팅 한 줄은 서버 초안 길) → 처음 만든 빌더로 돌려보낸다. */
  const regenerateFromPackage = (pkg: AIJourneyPackage) => {
    setAiPkg(null);
    setView('main');
    setPurpose(pkg.startKind === 'date_anchor' ? 'date-anchor' : 'info-alert');
    toast.info('이 여정은 처음 만든 화면에서 다시 만들어 주세요.');
  };

  const handleRegenerate = () => {
    if (!aiPkg) return;
    setConfirm({
      mode: 'warning',
      title: '여정 다시 생성',
      description: '현재 생성된 여정을 폐기하고 다시 생성하시겠습니까? 수정한 내용은 사라집니다.',
      confirmLabel: '다시 생성',
      onConfirm: () => {
        setEditingStepIdx(null);
        regenerateFromPackage(aiPkg);
      },
    });
  };

  // ★ 2026-06-29: 대화형 여정 수정 — 자연어 한 줄로 초안 패키지를 AI가 고침 (저장·발송 무관, 초안 편집만)
  const handleConversationalEdit = async () => {
    if (!aiPkg) return;
    const instruction = editInstruction.trim();
    if (instruction.length < 2) { toast.warning('수정 요청을 입력해주세요. 예: 2단계 하루 늦추고 VIP만 보내줘'); return; }
    setEditingPackage(true);
    try {
      const res = await fetch('/api/ai/operator/journeys-ai-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ package: aiPkg, instruction }),
      });
      const data = await res.json();
      if (data.success && data.package) {
        setAiPkg(data.package);
        setEditingStepIdx(null);
        setPreviewSteps(new Set());
        setEditInstruction('');
        toast.success(data.package.reasoning ? `수정 완료: ${data.package.reasoning}` : '여정을 수정했습니다.');
      } else {
        toast.error(data.error || 'AI 수정 실패. 요청을 더 명확히 작성해주세요.');
      }
    } catch (e: any) {
      toast.error(e?.message || '수정 중 오류');
    } finally {
      setEditingPackage(false);
    }
  };

  // ════════ step 수정 ════════
  const updateStep = (idx: number, patch: Partial<AIGeneratedStep>) => {
    if (!aiPkg) return;
    const newSteps = [...aiPkg.steps];
    newSteps[idx] = { ...newSteps[idx], ...patch };
    setAiPkg({ ...aiPkg, steps: newSteps });
  };

  const deleteStep = (idx: number) => {
    if (!aiPkg) return;
    if (aiPkg.steps.length <= 1) { toast.warning('최소 1개 step은 필요합니다.'); return; }
    setConfirm({
      mode: 'danger',
      title: 'step 삭제',
      description: `step ${idx + 1}을(를) 삭제하시겠습니까?`,
      confirmLabel: '삭제',
      onConfirm: () => {
        const newSteps = aiPkg.steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepOrder: i + 1 }));
        setAiPkg({ ...aiPkg, steps: newSteps });
        setEditingStepIdx(null);
      },
    });
  };

  const addStep = () => {
    if (!aiPkg) return;
    // ★ 2026-09-30 V2 4차 — 문자 칸 7 + 전체 12(서버와 같은 두 값). 새 칸은 문자 칸으로 붙으므로 둘 다 본다.
    if (aiPkg.steps.length >= MAX_TOTAL_STEPS) { toast.warning(`칸은 최대 ${MAX_TOTAL_STEPS}개까지 만들 수 있어요.`); return; }
    if (aiPkg.steps.filter((x) => x.stepType === 'message').length >= MAX_MESSAGE_STEPS) { toast.warning(`문자 칸은 최대 ${MAX_MESSAGE_STEPS}개까지예요. 대기 · 조건 칸은 있는 칸의 종류를 바꿔 만들어 주세요.`); return; }
    const lastDelay = aiPkg.steps[aiPkg.steps.length - 1]?.delayHours || 0;
    const newStep: AIGeneratedStep = {
      stepOrder: aiPkg.steps.length + 1,
      stepType: 'message',
      delayHours: lastDelay + 24,
      channel: 'lms',
      messageTemplate: '%고객명%님,\n\n[안내 본문을 직접 작성해주세요]\n\n자세히 → [URL 입력]',
      subject: '[제목을 입력해주세요]',
      isAd: true,
      stepIntent: '추가 step',
    };
    setAiPkg({ ...aiPkg, steps: [...aiPkg.steps, newStep] });
  };

  /**
   * ★ 2026-08-02 — 이 회사가 지금 만들 수 있는 여정의 폭. 진입 화면·세 모달이 같은 숫자를 쓴다.
   *   ⛔ 판정은 서버(회사 데이터 기준)가 하고 화면은 세기만 한다 — 여기서 조건을 만들지 않는다.
   *   예약은 여정에서 빠졌으므로(정보 알림 축) 이 셈에서 제외한다.
   */
  const journeyScope = useMemo(() => {
    const entries = Object.entries(dataCap || {}).filter(([k]) => k !== 'reservation');
    const locked = entries.filter(([, v]) => !v.available);
    return {
      availableCount: entries.length - locked.length,
      lockedCount: locked.length,
      lockedHints: locked.map(([, v]) => v.reason),
    };
  }, [dataCap]);

  /** 빠른 시작 카드 — 마케팅 모달 안에서만 쓴다(메인에서 옮김). 예약은 정보 알림 축이라 뺀다. */
  const quickStartItems: InterviewQuickStart[] = useMemo(
    () => (Object.keys(TEMPLATE_VISUAL) as TemplateCode[])
      .filter((code) => code !== 'reservation')
      .map((code) => {
        const v = TEMPLATE_VISUAL[code];
        const trgKey = TEMPLATE_TRIGGER_KEY[code];
        const cap = trgKey ? dataCap?.[trgKey] : undefined;
        const lockedReason = cap && !cap.available ? cap.reason : null;
        return {
          code,
          label: v.label,
          hint: v.hint,
          icon: v.icon,
          gradient: v.gradient,
          lockedReason,
        };
      }),
    [dataCap]
  );

  /**
   * ★ 2026-08-02 §13-3 — AI가 문안을 쓸 때 받아야 하는 여정 맥락.
   *   앞 스텝 문안 전부 + 지금 몇 번째인지 + 트리거로부터 얼마 뒤인지. 이게 있어야 "겹치지 않게"가 성립한다.
   */
  const buildStepAiContext = (idx: number) => {
    if (!aiPkg) return undefined;
    const cumulative = (upto: number) =>
      aiPkg.steps.slice(0, upto + 1).reduce((sum, s) => sum + (Number(s.delayHours) || 0), 0);
    return {
      triggerLabel: triggerLabelOf(aiPkg.triggerEvent, aiPkg.templateCode),
      objective: aiPkg.name || undefined,
      stepOrder: aiPkg.steps[idx]?.stepOrder ?? idx + 1,
      hoursFromTrigger: cumulative(idx),
      previousMessages: aiPkg.steps
        .slice(0, idx)
        .map((s, i) => ({
          stepOrder: s.stepOrder,
          hoursFromTrigger: cumulative(i),
          message: String(s.messageTemplate || '').trim(),
        }))
        .filter((p) => !!p.message),
    };
  };

  const handleRefineOpen = async (idx: number) => {
    if (!aiPkg) return;
    const step = aiPkg.steps[idx];
    setRefineLoading(true);
    try {
      // 본문이 비어 있어도 부른다 — 여정 맥락으로 처음부터 쓰는 생성 모드(§13-3).
      //   옛 흐름은 사람이 먼저 열 글자를 써야 눌렸다(추가 입력 요구 = 1클릭 원칙 위반).
      const res = await fetch('/api/ai/operator/journeys-refine-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          message: step.messageTemplate,
          channel: step.channel,
          isAd: step.isAd,
          stepIntent: step.stepIntent,
          journey: buildStepAiContext(idx),
          // ★ 2026-08-08 (Harold 접수) — 화면이 비포/애프터 한 쌍이라 안은 하나면 된다.
          //   3안을 만들어 둘을 버리는 것은 시간·토큰만 쓴다.
          variants: 1,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setRefining({ stepIdx: idx, candidates: data.candidates || [] });
      } else {
        toast.error(data.error || 'AI 다듬기 실패');
      }
    } catch (e: any) {
      toast.error(e?.message || '다듬기 중 오류');
    } finally {
      setRefineLoading(false);
    }
  };

  const handleAcceptRefine = (candidate: RefineCandidate) => {
    if (!aiPkg || !refining) return;
    updateStep(refining.stepIdx, { messageTemplate: candidate.message });
    setRefining(null);
  };

  // ════════ 저장 + 활성화 ════════
  // ★ 2026-06-22: 정보 알림 빌더 결과 → aiPkg(kakao step)로 조립 → 기존 review 흐름 재사용
  const handleInfoAlertBuild = (result: InfoAlertBuildResult) => {
    const reasonByKind: Record<string, string> = {
      event: '정보 알림: 거래 이벤트 발생 시 카카오 승인 템플릿 발송',
      one_shot: '정보 알림: 대상군에 카카오 승인 템플릿 1회 발송',
      standing: '정보 알림: 조건 충족 고객에게 카카오 승인 템플릿 상시 발송',
    };
    const pkg: AIJourneyPackage = {
      name: result.name,
      templateCode: result.templateCode,
      triggerEvent: result.triggerEvent,
      triggerFilters: result.triggerFilters || {},
      steps: [{
        stepOrder: 1,
        stepType: 'message',
        delayHours: 0,
        channel: 'kakao',
        messageTemplate: result.step.messageTemplate,
        subject: '',
        isAd: false,
        stepIntent: '정보 알림',
        alimtalkProfileId: result.step.alimtalkProfileId,
        alimtalkTemplateCode: result.step.alimtalkTemplateCode,
        alimtalkVariableMap: result.step.alimtalkVariableMap,
        alimtalkNextType: result.step.alimtalkNextType,
        alimtalkNextContents: result.step.alimtalkNextContents,
        alimtalkNextSubject: result.step.alimtalkNextSubject,
      }],
      allowReentry: result.startKind === 'event' || result.startKind === 'standing',
      reentryCooldownDays: 0,
      callbackNumberHint: null,
      budgetMonthlyHint: null,
      thresholdCostHint: null,
      reasoning: reasonByKind[result.startKind] || '정보 알림: 카카오 승인 템플릿',
      startKind: result.startKind,
      oneShotScheduledAt: result.oneShotScheduledAt,
    };
    setAiPkg(pkg);
    setPurpose('marketing');
    setView('review');
  };

  // ★ 2026-06-30 여정 일반화 SP-B — 날짜축 빌더 결과 → AIJourneyPackage(date_anchor) 조립 → 검토 흐름 재사용.
  const handleDateAnchorBuild = (result: DateAnchorBuildResult) => {
    const pkg: AIJourneyPackage = {
      name: result.name,
      templateCode: 'custom',
      triggerEvent: 'custom',
      triggerFilters: result.triggerFilters || {},
      steps: result.steps.map((s, i): AIGeneratedStep => ({
        stepOrder: i + 1,
        stepType: 'message',
        delayHours: 0,
        channel: s.channel,
        messageTemplate: s.messageTemplate,
        subject: s.subject,
        isAd: true,
        stepIntent: `D-${s.anchorOffsetDays}`,
        anchorOffsetDays: s.anchorOffsetDays,
      })),
      allowReentry: false,
      reentryCooldownDays: null,
      callbackNumberHint: null,
      budgetMonthlyHint: null,
      thresholdCostHint: null,
      reasoning: '날짜축 여정: 기준 날짜 기준 D-N 단계 발송',
      startKind: 'date_anchor',
      anchorDate: result.anchorDate,
      anchorRecurrence: result.anchorRecurrence,
      anchorRecurrenceDay: result.anchorRecurrenceDay,
      anchorHourKst: result.anchorHourKst,
    };
    setAiPkg(pkg);
    setPurpose('marketing');
    setView('review');
  };

  // ★ 2026-06-30 여정 일반화 SP-B — 날짜축 자동 생성: 자연어 목표 → D-N 스텝 일괄 생성.
  // ★ 2026-10-23 여정 결함 0 — 목표마다 요청 키 하나(RequestKeys CT) · 그 목표의 결과를 받을 때만 지운다.
  //   같은 목표의 재시도 = 같은 요청 = 서버 한 번 차감 · 실패 응답으로 키를 버리지 않는다(3R) · 다른 목표의 성공이 이 키를 지우지 않는다(4R).
  const anchorKeys = useRef(new RequestKeys());
  const handleAnchorGeneratePlan = async (objective: string): Promise<{ offsetDays: number; subject: string; message: string }[] | null> => {
    const reqId = anchorKeys.current.keyFor(objective);
    try {
      const res = await fetch('/api/ai/operator/journeys/anchor-generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ objective, requestId: reqId }),
      });
      const data = await res.json();
      if (data.success) { anchorKeys.current.settled(objective); return Array.isArray(data.steps) ? data.steps : []; }
      toast.error(data.error || 'AI 자동 생성 실패');
      return null;
    } catch (e: any) {
      toast.error(e?.message || 'AI 자동 생성 중 오류');
      return null;
    }
  };

  // ★ 날짜축 스텝 편집 모달 — AI 다듬기(3 톤 후보). 기존 journeys-refine-step 재사용.
  const handleAnchorRefine = async (message: string): Promise<{ message: string; tone: string }[] | null> => {
    try {
      const res = await fetch('/api/ai/operator/journeys-refine-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ message, channel: 'lms', isAd: true, stepIntent: '날짜축 안내' }),
      });
      const data = await res.json();
      if (data.success) return Array.isArray(data.candidates) ? data.candidates : [];
      toast.error(data.error || 'AI 다듬기 실패');
      return null;
    } catch (e: any) {
      toast.error(e?.message || '다듬기 중 오류');
      return null;
    }
  };

  // ★ 날짜축 스텝 편집 모달 — AI 꾸미기(선택 컬럼 %변수% 녹임). 기존 decorate-message 재사용.
  const handleAnchorDecorate = async (message: string, selectedVars: string[]): Promise<string | null> => {
    try {
      const res = await fetch('/api/ai/operator/decorate-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ message, selectedVars, channel: 'lms', isAd: true }),
      });
      const data = await res.json();
      if (data.success) {
        const o = decorateOutcome(data);
        if (o.tone === 'info') toast.info(o.text);
        return o.changed ? String(data.message || '') : null;
      }
      toast.error(data.error || 'AI 꾸미기 실패');
      return null;
    } catch (e: any) {
      toast.error(e?.message || '꾸미기 중 오류');
      return null;
    }
  };

  const handleSaveDraft = async () => {
    if (!aiPkg) return;
    if (!reviewCallback) { toast.warning('회신번호를 선택해주세요.'); return; }
    const issues = collectStepIssues(aiPkg.steps);
    if (issues.length > 0) {
      toast.warning(`스텝 ${issues[0].stepOrder}: ${issues[0].message}`);
      return;
    }
    setSaving(true);
    try {
      const body: any = {
        templateCode: aiPkg.templateCode,
        name: reviewName.trim() || undefined,
        customObjective: aiPkg.templateCode === 'custom' ? objective.trim() || undefined : undefined,
        callbackNumber: reviewCallback,
        callbackMode: reviewUseStorePhone ? 'store' : 'fixed',
        steps: aiPkg.steps,
        budgetMonthly: reviewBudget ? Number(reviewBudget) : null,
        thresholdCost: reviewThreshold ? Number(reviewThreshold) : null,
        allowReentry: aiPkg.allowReentry,
        reentryCooldownDays: aiPkg.reentryCooldownDays,
        // ★ 2026-09-29 V2 0차 ⑪ — 기본값의 주인은 서버 계약. 담당자가 만졌거나 서버가 기본값을 준 패키지일 때만 싣는다.
        ...(reviewGoalExitTouched || aiPkg.goalExitDefault !== undefined ? { goalExitEnabled: reviewGoalExit } : {}),
      };
      // ★ 2026-06-30 여정 일반화 — 시작 방식이 설정된 신규 흐름(SP-A 알림톡 / SP-B 날짜축)만 트리거·앵커 오버라이드 전송.
      //   미설정(기존 마케팅 여정)이면 미전송 = 백엔드가 템플릿 기본 트리거 사용(옛 동작 byte 불변).
      if (aiPkg.startKind) {
        body.startKind = aiPkg.startKind;
        body.triggerEvent = aiPkg.triggerEvent;
        body.triggerFilters = aiPkg.triggerFilters || {};
        body.anchorDate = aiPkg.anchorDate ?? null;
        body.anchorRecurrence = aiPkg.anchorRecurrence ?? null;
        body.anchorRecurrenceDay = aiPkg.anchorRecurrenceDay ?? null;
        body.anchorHourKst = aiPkg.anchorHourKst ?? null;
        body.oneShotScheduledAt = aiPkg.oneShotScheduledAt ?? null;
      } else if (aiPkg.presetTriggerEvent) {
        // ★ 2026-08-08 이어달리기 — 추천이 약속한 트리거로 저장한다.
        //   여기서 안 실으면 "휴면 복귀를 권했는데 재구매 여정이 저장되는" 어긋남이 그대로 남는다.
        //   조건은 서버가 비워 보낸 값을 그대로 — 기본값은 추출기·워커가 소유한다.
        body.triggerEvent = aiPkg.presetTriggerEvent;
        body.triggerFilters = aiPkg.triggerFilters || {};
      } else if (aiPkg.triggerEvent) {
        // ★ 2026-09-29 여정 V2 0차 ① — **계획 모달 · 대상 미리보기가 보여 준 트리거 · 대상 조건을 그대로 저장한다.**
        //   옛: 마케팅 여정은 트리거 · 조건을 보내지 않아 서버가 템플릿 기본값으로 저장했다
        //   (화면 "서울 VIP 첫 구매" → 저장 "모든 구매 · 조건 없음", custom 이면 "전 고객"). 더 보내는 쪽으로 새는 자리였다.
        //   서버는 레지스트리 · 대상 조건 검증(journey-builder)을 지나야만 저장한다.
        body.triggerEvent = aiPkg.triggerEvent;
        body.triggerFilters = aiPkg.triggerFilters || {};
      }
      const res = await fetch('/api/ai/operator/journeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setAiPkg(null);
        setObjective('');
        setBenefitText('');
        setView('main');
        // ★ 2026-08-08 이어달리기 — 다음 수 안내의 근거는 **저장된 여정의 실제 시작 신호**다.
        //   응답에 상세가 없으면 안내하지 않는다(무엇을 만들었는지 모르는 채로 다음 수를 권하지 않는다).
        setSuccessionFrom(String(data?.detail?.journey?.trigger_event || '') || null);
        // ★ 2026-09-29 여정 V2 0차 ⑥ — 다음 수 카드가 "이어받습니다"라고 말하려면 원 여정이 목표를 이뤘을 때 끝나야 한다.
        //   저장 응답의 실제 값을 쥔다(화면 토글이 아니라 서버가 저장한 값).
        setSuccessionGoalExit(data?.detail?.journey?.goal_exit_enabled === true);
        await loadAll();
        toast.success('초안 여정이 저장되었습니다. 활성 여정 목록에서 활성화 가능합니다.');
      } else {
        toast.error(data.error || '저장 실패');
      }
    } catch (e: any) {
      toast.error(e?.message || '저장 중 오류');
    } finally {
      setSaving(false);
    }
  };

  // ★ D211+ Phase 3-fix (2026-05-23 Harold 명시): archive/unarchive/delete 영역 = 커스텀 다크 톤 모달 진입만 (실제 처리 = executeAction)
  // ★ D218+ (2026-05-26): activate 영역 = JourneyActivationConfirmModal 진입 (자동 검증 + 비용 + 잔액 + 확인 흐름)
  const handleAction = async (
    journeyId: string,
    action: 'activate' | 'pause' | 'end' | 'archive' | 'unarchive' | 'delete',
  ) => {
    const journey = journeys.find((j) => j.id === journeyId);
    const journeyName = journey?.name || '여정';

    // archive/unarchive/delete = 커스텀 모달 진입 (native confirm/prompt 영구 폐기)
    if (action === 'archive' || action === 'unarchive' || action === 'delete') {
      setActionModal({ mode: action, journeyId, journeyName });
      return;
    }

    // ★ D218+ (2026-05-26): activate = 자동 검증 모달 진입 (옛 native confirm 폐기 + ConfirmModal 정합)
    // ★ 2026-10-20 V.3 §6-7 — 다시 켜기(멈춤) = 한 단계 한 줄 · 멈추기 = 1클릭(확인 창 0) · 공용 훅(지도 · 작업 화면과 한 벌).
    if (action === 'activate' && journey?.status === 'paused') {
      journeyActions.activate({ id: journeyId, name: journeyName, status: 'paused', goalExitEnabled: journey.goal_exit_enabled === true, thresholdRecipients: journey.threshold_recipients_per_step ?? null, activationCost: Number(journey.activation_cost || 0), pause: journey.pause_view || null });
      return;
    }
    if (action === 'activate') {
      setActivationModal({ journeyId, journeyName, journeyStatus: journey?.status || 'draft' });
      return;
    }
    if (action === 'pause') {
      void journeyActions.pause({ id: journeyId, name: journeyName, status: journey?.status || 'active' });
      return;
    }

    // end = 커스텀 모달(JourneyActionConfirmModal) — native confirm 폐기.
    if (action === 'end') {
      setActionModal({ mode: action, journeyId, journeyName });
      return;
    }
  };

  // ★ D211+ Phase 3-fix (2026-05-23 Harold 명시): 커스텀 모달 확인 후 실제 API 호출
  const executeArchiveAction = async () => {
    if (!actionModal) return;
    const { mode, journeyId } = actionModal;
    const method = mode === 'delete' ? 'DELETE' : (mode === 'pause' || mode === 'end') ? 'POST' : 'PATCH';
    const path = mode === 'delete' ? '' : '/' + mode;
    try {
      const res = await fetch(`/api/ai/operator/journeys/${journeyId}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) {
        if ((mode === 'delete' || mode === 'archive') && wsJourney === journeyId) closeWorkspace();
        setActionModal(null);
        await loadAll();
      } else {
        toast.error(data.error || '처리 실패');
      }
    } catch (e: any) {
      toast.error(e?.message || '처리 중 오류');
    }
  };

  // ★ 2026-09-30 AI 존 대개편(설계서 §4-1): 다음 수 + 오늘의 여정 기회 = 강조 카드 한 장(원본 JSX 그대로 옮김 · 1클릭 유지)
  const successionNode = view !== 'main' ? null : (() => {
              if (!successionFrom) return null;
              const fromDef = TRIGGER_EVENTS.find((t) => t.triggerEvent === successionFrom);
              // ★ 2026-09-30 V2 3차 — 상품 고르기 창 전용 트리거(상품 재구매)는 1클릭 다음 수로 권하지 않는다(상품 없이 만들 수 없다).
              const nextKey = (fromDef?.nextKeys || []).find((k) => TRIGGER_EVENTS.find((t) => t.key === k)?.requiresConfig !== 'product_pick');
              const nextDef = nextKey ? TRIGGER_EVENTS.find((t) => t.key === nextKey) : undefined;
              if (!fromDef || !nextDef) return null;
              // 게이트 ① 이 회사 데이터로 그 여정을 만들 수 있는가 — 모르면 권하지 않는다(fail-closed).
              if (dataCap?.[nextDef.key]?.available !== true) return null;
              // 게이트 ② 이미 그 신호로 도는 여정이 있으면 권하지 않는다(축은 trigger_event).
              //   ⛔ 목록은 상태 필터로 걸러져 오고, 필터를 바꾼 직후·조회 실패 때는 **직전 목록이 남아 있다.**
              //   활성 여정이 안 실린 화면에서는 "없다"를 증명할 수 없다 — 증명할 수 없으면 권하지 않는다
              //   (이미 도는 여정을 또 만들라고 하는 쪽이 더 나쁘다).
              if (statusFilter !== 'all' && statusFilter !== 'active') return null;
              if (loading || error) return null;
              if (loadedStatus !== statusFilter) return null;   // 손에 든 목록이 지금 필터의 응답이 아니다
              const activeTriggers = new Set(
                journeys.filter((j) => j.status === 'active' && !j.archived_at).map((j) => j.trigger_event),
              );
              if (activeTriggers.has(nextDef.triggerEvent)) return null;
              const overlapLabels = (nextDef.overlapKeys || [])
                .map((k) => TRIGGER_EVENTS.find((t) => t.key === k))
                .filter((t) => !!t && activeTriggers.has(t.triggerEvent))
                .map((t) => t!.label);
              const v = TEMPLATE_VISUAL[nextDef.templateCode] || TEMPLATE_VISUAL.custom;
              const NextIcon = v.icon;
              return (
                <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3.5 md:p-4">
                  <div className="flex items-start gap-3">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${v.gradient}`}>
                      <NextIcon className="h-5 w-5 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-bold text-slate-900 md:text-base">다음 수: {nextDef.label} 여정</h2>
                        <span className="shrink-0 rounded border border-violet-200 bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold text-violet-900">NEW</span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">
                        방금 만든 <span className="font-semibold text-slate-900">{fromDef.label}</span> 여정에서 목표를 이룬 고객은{' '}
                        <span className="font-semibold text-slate-900">{nextDef.label}</span> 여정이 이어받습니다.
                      </p>
                      <div className="mt-2 space-y-1">
                        {/* ★ 2026-09-29 V2 0차 ⑥ — 원 여정이 목표를 이뤄도 안 끝나면 "이어받습니다"는 절반만 사실이다(두 여정 문자를 같이 받는다). */}
                        {successionGoalExit === false && (
                          <div className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-800">
                            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>방금 만든 {fromDef.label} 여정은 목표를 이뤄도 남은 문자가 계속 나가요. 두 여정 문자를 같이 받지 않게 하려면 그 여정 옵션에서 "목표 달성 시 자동 종료"를 켜 주세요.</span>
                          </div>
                        )}
                        <div className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-800">
                          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>여정은 켠 뒤에 생기는 일부터 받습니다. 지금 만들면 앞으로 해당하는 고객부터 나갑니다.</span>
                        </div>
                        {overlapLabels.length > 0 && (
                          <div className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-800">
                            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>{overlapLabels.join('·')} 여정과 같은 구매 한 번에 둘 다 발송될 수 있어요.</span>
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => openLineJourney({ preset: { triggerEvent: nextDef.triggerEvent } })}
                          disabled={lineAsk.judging}
                          className="flex items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50 px-3 h-8 text-[13px] font-semibold disabled:opacity-50"
                        >
                          <Sparkles className="h-3.5 w-3.5" /> 이어서 만들기
                        </button>
                        <button
                          onClick={() => setSuccessionFrom(null)}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-500 hover:bg-white"
                        >
                          나중에
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })();
  const oppPerPage = 3;
  const oppTotalPages = Math.ceil(opportunities.length / oppPerPage);
  const oppPageIdx = Math.min(oppPage, Math.max(0, oppTotalPages - 1));
  const oppItems = opportunities.slice(oppPageIdx * oppPerPage, oppPageIdx * oppPerPage + oppPerPage);
  const journeyEmphasis = view === 'main' && (successionNode || opportunities.length > 0) ? (
    <ZoneEmphasis
      kind="ai"
      title={opportunities.length > 0 ? '오늘의 여정 기회' : '다음 수'}
      meta={opportunities.length > 0 ? '회사 데이터에서 찾은 비어 있는 여정' : undefined}
      right={opportunities.length > 0 ? (<>
                    {oppTotalPages > 1 && (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setOppPage(Math.max(0, oppPageIdx - 1))} disabled={oppPageIdx === 0} className="p-1.5 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed" aria-label="이전">
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-[11px] text-slate-500 tabular-nums min-w-[34px] text-center">{oppPageIdx + 1} / {oppTotalPages}</span>
                        <button onClick={() => setOppPage(Math.min(oppTotalPages - 1, oppPageIdx + 1))} disabled={oppPageIdx >= oppTotalPages - 1} className="p-1.5 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed" aria-label="다음">
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
      </>) : undefined}
    >
      {successionNode}
      {opportunities.length > 0 && (
        <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory -mx-1 px-1 pb-1 md:grid md:grid-cols-3 md:overflow-visible md:mx-0 md:px-0 md:pb-0">
                    {oppItems.map((op) => {
                      const v = TEMPLATE_VISUAL[op.templateCode] || TEMPLATE_VISUAL.custom;
                      const OpIcon = v.icon;
                      return (
                        // ★ 2026-08-08 — 같은 유형이 여럿일 수 있다(이어달리기는 후속 트리거마다 한 장) — 키에 트리거를 함께 쓴다.
                        <div key={`${op.type}:${op.preferTriggerEvent || ''}`} className="shrink-0 w-[85%] md:w-auto snap-start bg-white border border-slate-200 rounded-xl p-4 flex flex-col">
                          <div className="flex items-center gap-3 mb-2.5">
                            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${v.gradient} flex items-center justify-center shrink-0`}>
                              <OpIcon className="w-5 h-5 text-white" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <div className="text-sm font-semibold text-slate-900 truncate">{op.title}</div>
                                {op.priority === 'high' && (
                                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">우선</span>
                                )}
                              </div>
                              <div className="text-lg font-bold text-slate-900 leading-tight">
                                {op.count.toLocaleString()}<span className="text-xs font-medium text-slate-500 ml-0.5">명</span>
                              </div>
                            </div>
                          </div>
                          <p className="text-xs text-slate-600 leading-relaxed flex-1 mb-3">{op.description}</p>
                          {/* ★ 2026-08-08 — 고지는 카드가 지우지 않는다. 소급 금지·겹침은 만들기 전에 알아야 한다. */}
                          {(op.notices || []).length > 0 && (
                            <div className="mb-3 space-y-1">
                              {(op.notices || []).map((n) => (
                                <div key={n} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-800">
                                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                                  <span>{n}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <button
                            onClick={() => openFromCard(op.suggestedObjective, op.preferTriggerEvent)}
                            disabled={lineAsk.judging}
                            className="h-9 px-3 rounded-[10px] border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50 text-[13px] font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
                          >
                            <Sparkles className="w-3.5 h-3.5" /> 1클릭 생성
                          </button>
                        </div>
                      );
                    })}
        </div>
      )}
    </ZoneEmphasis>
  ) : null;

  const journeyOneLine = zoneModule('journeys').oneLine!;
  const scopeTotal = journeyScope.availableCount + journeyScope.lockedCount;
  const backFromView = () => (view !== 'main'
    ? setConfirm({ mode: 'warning', title: '메인으로 돌아가기', description: '생성한 여정이 사라집니다. 메인으로 돌아가시겠습니까?', confirmLabel: '나가기', onConfirm: () => { setView('main'); setAiPkg(null); setBenefitText(''); } })
    : goUpTo(navigate, '/ai-operator')); // ★ 2026-10-01 첫 화면 ← = 항상 허브(머리 부품과 같은 규칙)

  return (
    <ZoneFrame
      moduleId="journeys"
      sub={view === 'review' ? 'AI 생성 여정 검토' : null}
      onBack={backFromView}
      backLabel={view === 'main' ? 'AI Operator로' : '여정 목록으로'}
      tabs={view === 'main' ? JOURNEY_TABS : undefined}
      activeTab="list"
      command={view === 'main' ? {
        line: {
          value: objective,
          onChange: setObjective,
          onSubmit: () => {
            void (async () => {
              if (await lineAsk.route(objective)) return;
              openLineJourney({ sentence: objective });
            })();
          },
          placeholder: journeyOneLine.placeholder,
          verb: journeyOneLine.verb,
          icon: Sparkles,
          busy: lineAsk.judging,
        },
      } : null}
      blocks={[
        ...(error ? [{ text: error, tone: 'rose' as const }] : []),
        ...(callbackOptions.length === 0 && !loading && view === 'main' ? [{ text: '회사에 등록된 발신번호가 없어 여정을 켤 수 없습니다. 만들기는 지금도 됩니다.' }] : []),
      ]}
      links={view === 'main' ? [{ label: `만들 수 있는 여정 ${journeyScope.availableCount}/${scopeTotal}종 · ${showScopeNote ? '접기' : '자세히'}`, onClick: () => setShowScopeNote((v) => !v) }] : []}
      stamp={view === 'main' ? { text: '다시 읽기', onRefresh: loadAll, loading } : null}
      start={view === 'main' && !lineAsk.hasCards ? {
        items: [
          { icon: Megaphone, title: '마케팅 여정', desc: '빠른 시작을 고르고 혜택까지 넣어 설계', tint: 'from-fuchsia-400 to-purple-500', featured: true, badge: '추천', onClick: () => openLineJourney({}) },
          { icon: Bell, title: '정보 알림', desc: '주문·배송 같은 거래가 일어나면 알림톡', tint: 'from-teal-400 to-emerald-500', onClick: () => setPurpose('info-alert') },
          { icon: CalendarClock, title: '날짜축 여정', desc: '정해 둔 날짜 기준 D-7·D-3·D-1·당일', tint: 'from-indigo-400 to-violet-500', onClick: () => setPurpose('date-anchor') },
        ],
      } : null}
      emphasis={view === 'main' && lineAsk.ask ? (
        <LineAnswer
          ask={lineAsk.ask}
          busy={false}
          cardCost={(c) => (c.action.kind === 'journey' ? journeyCost : undefined)}
          makeCost={journeyCost}
          onClose={lineAsk.close}
          onPick={(c) => {
            if (c.action.kind !== 'journey') return;
            lineAsk.close();
            openFromCard(c.action.objective, c.action.preferTriggerEvent);
          }}
          onMakeAnyway={() => {
            const line = lineAsk.ask!.line;
            lineAsk.close();
            openLineJourney({ sentence: line });
          }}
        />
      ) : journeyEmphasis}
    >
        {view === 'main' && customerGate.isEmpty && <CustomerDataRequiredBanner className="mb-4 md:mb-5" />}
        {view === 'main' && showScopeNote && (
          <JourneyDataScopeNote
            className="mb-5"
            availableCount={journeyScope.availableCount}
            lockedCount={journeyScope.lockedCount}
            lockedHints={journeyScope.lockedHints}
          />
        )}
        {view === 'main' && (
          <>
            {/* ★ 2026-08-08 이어달리기 — 방금 만든 여정의 다음 수. 세션 한정(닫으면 끝),
                근거는 저장 응답이 알려 준 실제 시작 신호다. 운영 중 추천은 아래 기회 카드가 상시 담당한다. */}




            {/* ★ D211+ Phase 3 (2026-05-23 Harold 명시): 여정 목록 + status 필터 토글 (보관함 영역 분리) */}
            <div>
              <ZoneSection
                title={statusFilter === 'archived' ? '보관함' : '내 여정'}
                count={journeys.length}
                filter={(
                  <ZoneSegmented
                    ariaLabel="여정 거르기"
                    items={[
                      { id: 'all', label: '전체' },
                      { id: 'active', label: JOURNEY_STATUS_LABEL.active },
                      { id: 'paused', label: JOURNEY_STATUS_LABEL.paused },
                      { id: 'ended', label: JOURNEY_STATUS_LABEL.ended },
                      { id: 'archived', label: '보관함' },
                    ] as Array<{ id: JourneyStatusFilter; label: string }>}
                    value={statusFilter}
                    onChange={(id) => setStatusFilter(id)}
                  />
                )}
              />
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                </div>
              )}
              {!loading && journeys.length === 0 && (
                <div className="p-8 bg-gradient-to-br from-violet-50 via-fuchsia-50 to-indigo-50 border border-violet-200 rounded-xl">
                  <div className="text-center mb-6">
                    <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center shadow-lg">
                      <Sparkles className="w-7 h-7 text-white" />
                    </div>
                    <h4 className="text-base font-semibold text-slate-900 mb-1">첫 여정을 만들어보세요</h4>
                    <p className="text-xs text-slate-500">자연어 한 줄이면 AI가 완전한 여정을 자동 설계합니다 (5~10초)</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    {[
                      { icon: UserPlus, label: '신규 가입자 환영 시리즈 3통', objective: '신규 가입자에게 환영 인사 + 첫 구매 안내 3통 시리즈' },
                      { icon: Repeat, label: '재구매 후기 + 추천 캠페인', objective: '구매 직후 후기 요청 + 추천 상품 안내' },
                      { icon: Moon, label: '휴면 회원 복귀 캠페인', objective: '90일 휴면 고객 복귀 유도 + 등급별 분기' },
                      { icon: ShoppingCart, label: '장바구니 회복 메시지', objective: '장바구니 결제 미진행 24h 후 회복 메시지' },
                      { icon: Cake, label: '생일 D-7 사전 축하', objective: '생일 7일 전 사전 축하 + 등급별 인사' },
                    ].map((ex, idx) => {
                      const ExIcon = ex.icon;
                      return (
                        <button
                          key={idx}
                          onClick={() => {
                            // ★ 2026-09-29 여정 V2 0차 ⑦ — 옛: 목표만 바꾸고 위로 스크롤했다. 입력칸은 모달로 옮겨져(0802) 화면에 없어서
                            //   누르면 아무 일도 안 일어났다(죽은 버튼). 목표를 채운 채 마케팅 여정 모달을 연다.
                            setObjective(ex.objective);
                            setPurpose('marketing-modal');
                          }}
                          className="p-2.5 bg-white hover:bg-slate-100 border border-slate-200 hover:border-violet-200 rounded-lg text-left flex items-center gap-2 transition-all"
                        >
                          <ExIcon className="w-4 h-4 text-violet-700 flex-shrink-0" />
                          <span className="text-slate-700 truncate">{ex.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-slate-400 text-center mt-4">
                    예시를 누르면 문장이 채워진 채로 여정 만들기 창이 열립니다. 원하는 내용으로 고쳐 쓰셔도 됩니다.
                  </p>
                </div>
              )}
              {/* ★ 2026-10-11 Harold: 「한 줄 꽉 찬 카드는 공간 낭비 · 3열 · 누르면 모달」 — 카드 = 이름 · 상태 · 숫자 세 칸 · 동작 / 상세(옛 펼침) = 아래 상세 창 */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {journeys.map((j) => {
                  const visual = TEMPLATE_VISUAL[j.template_code] || TEMPLATE_VISUAL.custom;
                  const Icon = visual.icon;
                  const badge = STATUS_BADGE[j.status];
                  return (
                    <div
                      key={j.id}
                      onClick={() => openWorkspace(j.id)}
                      className="flex flex-col min-w-0 bg-white border border-slate-200 rounded-2xl p-4 cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.05)] hover:border-indigo-200 hover:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_12px_28px_-14px_rgba(15,23,42,0.22)] transition-[border-color,box-shadow]"
                    >
                      <div className="flex items-start gap-3">
                        <div className={`shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br ${visual.gradient} flex items-center justify-center`}>
                          <Icon className="w-[18px] h-[18px] text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-[14px] font-semibold text-slate-900 truncate" title={j.name}>
                            <button type="button" onClick={(e) => { e.stopPropagation(); openWorkspace(j.id); }} className="max-w-full truncate text-left hover:text-indigo-700 focus:outline-none focus-visible:underline">{j.name}</button>
                          </h3>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <StatusPill label={badge.label} tone={badge.cls as 'neutral' | 'green' | 'amber'} />
                            {j.archived_at && <StatusPill label="보관" tone="neutral" />}
                          </div>
                        </div>
                      </div>
                      <dl className="mt-3 flex flex-wrap gap-2">
                        {[
                          ['진입', Number(j.stats_total_entered || 0).toLocaleString()],
                          ['완료', Number(j.stats_total_completed || 0).toLocaleString()],
                          ['비용', `${Number(j.stats_total_cost || 0).toLocaleString()}원`],
                        ].map(([k, v]) => (
                          <div key={k} className="flex-1 min-w-fit rounded-lg bg-slate-50 px-2.5 py-2">
                            <dt className="text-[11px] text-slate-500">{k}</dt>
                            <dd className="text-[15px] font-semibold text-slate-900 tabular-nums whitespace-nowrap">{v}</dd>
                          </div>
                        ))}
                      </dl>
                      {(Number(j.goal_met_count) > 0 || Number(j.holdout_count) > 0) && (
                        <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[12px]">
                          {Number(j.goal_met_count) > 0 && (
                            <span className="text-emerald-700" title="목표 달성 종료: 진입 후 목표 달성이 확인되어 잔여 발송 없이 종료된 고객">목표 달성 {Number(j.goal_met_count).toLocaleString()}</span>
                          )}
                          {Number(j.holdout_count) > 0 && (
                            <span className="text-sky-700" title="홀드아웃 대조군: 증분 성과 비교를 위해 의도적으로 발송하지 않는 진입 고객 (통계 분석에서 전환 비교)">홀드아웃 {Number(j.holdout_count).toLocaleString()}</span>
                          )}
                        </div>
                      )}
                      {j.pause_view && j.status === 'paused' && (
                        <div className="mt-2 text-[12.5px] text-slate-600 bg-slate-50 px-2 py-1 rounded break-keep">{j.pause_view.text}</div>
                      )}
                      <div className="mt-auto pt-3">
                        <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
                          <span className="min-w-0 flex-1 truncate text-[12px] text-slate-400">{j.callback_number ? `회신 ${j.callback_number}` : ''}</span>
                            {(() => {
                              // ★ 2026-09-30 AI 존 대개편 D5: 노출 조건은 옛 조건식 그대로(utils/journey-row-actions · 계약 테스트)
                              const plan = journeyRowActionPlan(j.status, !!j.archived_at);
                              const run: Record<JourneyRowActionId, () => void> = {
                                entrants: () => navigate(`/ai-journeys/${j.id}`),
                                stats: () => navigate(`/ai-journeys/${j.id}/stats`),
                                target: () => { setTargetInfo(null); setTargetModal({ journeyId: j.id, journeyName: j.name }); },
                                edit_message: () => setEditMessageModal({ journeyId: j.id, journeyName: j.name, journeyStatus: j.status }),
                                pause_logs: () => setPauseLogsModal({ journeyId: j.id, journeyName: j.name }),
                                activate: () => handleAction(j.id, 'activate'),
                                pause: () => handleAction(j.id, 'pause'),
                                end: () => handleAction(j.id, 'end'),
                                archive: () => handleAction(j.id, 'archive'),
                                unarchive: () => handleAction(j.id, 'unarchive'),
                                delete: () => handleAction(j.id, 'delete'),
                              };
                              const act = (id: JourneyRowActionId | null) => (id ? { label: journeyRowActionLabel(id, j.status), onClick: run[id] } : null);
                              return (
                                <ZoneRowActions
                                  primary={act(plan.primary)}
                                  secondary={act(plan.secondary)}
                                  menu={plan.menu.map((id) => ({
                                    label: journeyRowActionLabel(id, j.status),
                                    onClick: run[id],
                                    danger: id === 'end' || id === 'delete',
                                    divider: id === 'end' || (id === 'archive' && !plan.menu.includes('end')) || (id === 'delete' && !plan.menu.includes('end') && !plan.menu.includes('archive')),
                                  }))}
                                />
                              );
                            })()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* ════════════════════════════════════════
            REVIEW VIEW — AI 생성 여정 검토 + 수정
            ════════════════════════════════════════ */}
        {view === 'review' && aiPkg && (
          <div className="space-y-4">
            {/* AI reasoning */}
            <div className="bg-fuchsia-50 border border-fuchsia-200 rounded-lg p-3 flex items-start gap-2">
              <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-fuchsia-700" />
              <div className="text-xs text-slate-700">
                <span className="font-medium text-fuchsia-700">AI 설계 근거: </span>
                {aiPkg.reasoning || '시즌 + 회사 톤 + 메모리 기반 자동 설계'}
              </div>
            </div>

            {/* ★ 2026-06-29: 대화형 수정 — 말로 고치기 (클릭 편집 대신 자연어 한 줄) */}
            <div className="bg-gradient-to-br from-violet-50 to-fuchsia-50 border border-violet-200 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Wand2 className="w-4 h-4 text-violet-700" />
                <span className="text-sm font-semibold">대화형 수정</span>
                <span className="text-[11px] text-slate-400">말로 고치세요 (예: "2단계 하루 늦추고 VIP만 보내줘")</span>
              </div>
              <div className="flex flex-col md:flex-row gap-2">
                <input
                  value={editInstruction}
                  onChange={(e) => setEditInstruction(e.target.value)}
                  placeholder="예: 첫 단계를 알림톡으로 / 마지막에 3일 뒤 리마인드 추가 / 전체 톤 더 캐주얼하게"
                  className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm placeholder-slate-400 focus:outline-none focus:border-violet-400"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !editingPackage) handleConversationalEdit(); }}
                  disabled={editingPackage}
                />
                <button
                  onClick={handleConversationalEdit}
                  disabled={editingPackage || editInstruction.trim().length < 2}
                  className="px-4 py-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {editingPackage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  수정 적용
                </button>
              </div>
            </div>

            {sampleCustomer && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-900 flex items-start gap-2">
                <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-700" />
                <div>
                  <span className="font-semibold">타겟 고객 데이터 연동됨</span>. 각 step에서 <span className="text-emerald-800">발송 미리보기</span> 토글을 누르면, 추출된 타겟 최상위 고객 기준으로 실제 발송될 형태(변수 치환 + 광고·무료거부)를 볼 수 있어요.
                </div>
              </div>
            )}

            {/* 기본 설정 */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">여정 이름</label>
                  <input value={reviewName} onChange={(e) => setReviewName(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-fuchsia-400" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">회신번호 <span className="text-rose-600">*</span></label>
                  <select value={reviewCallback} onChange={(e) => setReviewCallback(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-fuchsia-400">
                    <option value="">선택해주세요</option>
                    {callbackOptions.map((c) => (
                      <option key={`${c.source}-${c.phone}`} value={c.phone}>
                        {c.phone}{c.description ? ` (${c.description})` : ''}{c.is_default ? ' • 기본' : ''}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 mt-2 text-xs text-slate-600 cursor-pointer">
                    <input type="checkbox" checked={reviewUseStorePhone} onChange={(e) => setReviewUseStorePhone(e.target.checked)} className="rounded" />
                    <span>고객 매장번호로 발송 (매장번호 없는 고객은 위 번호로)</span>
                  </label>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">월간 예산 (원, 선택)</label>
                  <input type="number" value={reviewBudget} onChange={(e) => setReviewBudget(e.target.value)} placeholder="비워두면 무제한" className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-fuchsia-400" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">step당 비용 한도 (원, 선택)</label>
                  <input type="number" value={reviewThreshold} onChange={(e) => setReviewThreshold(e.target.value)} placeholder="비워두면 무제한" className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-fuchsia-400" />
                </div>
                {/* ★ 2026-07-10 목표 달성 시 자동 종료 — 구매 독려형이면 기본 켜짐 제안 */}
                <div className="md:col-span-2 p-2.5 bg-slate-100 border border-emerald-200 rounded-lg">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={reviewGoalExit} onChange={(e) => { setReviewGoalExit(e.target.checked); setReviewGoalExitTouched(true); }} className="rounded mt-0.5" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-900"><Target className="w-3.5 h-3.5 text-emerald-700" />목표 달성 시 자동 종료</span>
                      <span className="block text-[10px] text-slate-400 leading-relaxed mt-0.5">
                        여정 진입 후 구매가 확인된 고객은 남은 메시지를 받지 않고 "목표 달성"으로 종료됩니다. 이미 산 고객에게 독려 문자가 또 가는 것을 막습니다.
                      </span>
                    </span>
                  </label>
                </div>
              </div>
              <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
                <span>트리거: {aiPkg.triggerEvent}</span>
                <span>재진입: {aiPkg.allowReentry ? (aiPkg.reentryCooldownDays ? `${aiPkg.reentryCooldownDays}일 후` : '즉시') : '불가'}</span>
                <span className="text-amber-700">(광고) 표기 · 무료거부 번호 · 발송 가능 시간 · 광고 제목 자동 합성</span>
              </div>
            </div>

            {/* ★ 2026-06-22: Step 세로 타임라인 — 흐름(1→2→3)이 위→아래로 보이게 (가로 3분할 어지러움 해소) */}
            <div className="flex flex-col gap-3 max-w-3xl mx-auto">
              {aiPkg.steps.map((s, idx) => {
                const bytes = getByteLength(s.messageTemplate);
                const maxBytes = s.channel === 'sms' ? 90 : 2000;
                const preview = buildPreview(s.messageTemplate, s.isAd, s.channel, opt080Number);
                const previewBytes = getByteLength(preview);
                const placeholderWarn = hasPlaceholder(s.messageTemplate);
                const isPreview = previewSteps.has(idx);

                // ★ D188 Phase 2-B-1 (2026-05-21): step_type별 다른 UI — message/wait/condition.
                //   헤더는 공통 (step_type select 추가) / 본문은 step_type별 분기.
                const stepTypeColor =
                  s.stepType === 'wait' ? 'bg-sky-100 text-sky-700' :
                  s.stepType === 'condition' ? 'bg-emerald-100 text-emerald-700' :
                  s.stepType === 'end' ? 'bg-slate-100 text-slate-500' :
                  'bg-fuchsia-100 text-fuchsia-700';
                return (
                  <div key={idx} className={`bg-white border rounded-2xl p-3 shadow-lg shadow-black/20 ${s.stepType === 'wait' ? 'border-sky-200' : s.stepType === 'condition' ? 'border-emerald-200' : 'border-fuchsia-200'}`}>
                    {/* ★ 2026-06-29: step 요약 카드 — 클릭 편집 모달화 (인라인 편집기 난잡함 제거) */}
                    <div className="flex items-center gap-3">
                      <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${stepTypeColor}`}>{s.stepOrder}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800 truncate">{s.stepIntent || `Step ${s.stepOrder}`}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${stepTypeColor}`}>{s.stepType === 'wait' ? '대기' : s.stepType === 'condition' ? '조건' : s.stepType === 'end' ? '끝' : '메시지'}</span>
                          {s.stepType === 'message' && <span className="text-[10px] uppercase tracking-wide text-slate-400">{s.channel}</span>}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                          {idx === 0 ? '트리거 후' : '직전 후'} {formatStepDelay(s)}
                          {s.stepType === 'message' && s.messageTemplate.trim() ? ` · ${s.messageTemplate.replace(/\s+/g, ' ').trim().slice(0, 36)}` : ''}
                          {s.stepType === 'condition' ? (s.notMetGoto ? ` · 만족 시 다음 / 미충족 시 Step ${s.notMetGoto}` : ' · 조건 만족 시 다음 단계') : ''}
                          {s.stepType === 'wait' ? (s.waitEventName ? ` · ${s.waitEventName} 이벤트 대기 (최대 ${s.waitTimeoutHours ?? 72}시간)` : ' · 대기 후 다음 단계') : ''}
                          {s.stepType === 'end' ? ' · 이 갈래는 여기서 끝(보내지 않음)' : ''}
                        </div>
                      </div>
                      <button onClick={() => setEditingStepIdx(idx)} className="shrink-0 px-3 py-1.5 rounded-lg bg-violet-100 hover:bg-violet-100 text-violet-800 text-xs font-medium flex items-center gap-1">
                        <Edit2 className="w-3.5 h-3.5" /> 편집
                      </button>
                      <button onClick={() => deleteStep(idx)} className="shrink-0 p-1.5 bg-rose-100 hover:bg-rose-100 text-rose-700 rounded-lg" title="이 단계 삭제">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {editingStepIdx === idx && createPortal(
                      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[45] p-4">
                        <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col text-slate-900" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
                          <div className="flex items-center justify-between p-5 border-b border-slate-200 bg-gradient-to-r from-fuchsia-50 via-violet-50 to-purple-50">
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-semibold ${stepTypeColor}`}>{s.stepOrder}</div>
                              <div>
                                <h3 className="text-base font-semibold text-slate-900">Step {s.stepOrder} 편집</h3>
                                <p className="text-[11px] text-slate-500 mt-0.5 truncate max-w-[220px]">{s.stepIntent || '단계 상세 편집'}</p>
                              </div>
                            </div>
                            <button onClick={() => setEditingStepIdx(null)} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors" aria-label="닫기">
                              <X className="w-4 h-4 text-slate-500" />
                            </button>
                          </div>
                          <div className="flex-1 overflow-y-auto p-5 space-y-3">

                    {/* ★ D188 Phase 2-B-1: wait step UI — 시간 대기만 명시 */}
                    {/* ★ D188 Phase 2-B-1 + D210+ Phase 3 (2026-05-23 Harold 명시): wait step UI — delay_mode 3 영역
                          1. relative — 옛 매트릭스 (delay_hours 단순 영역)
                          2. specific_hour — target_hour_kst 영역 KST (오늘/내일 정합)
                          3. next_business_day — 다음 평일 09시 KST (단순 매트릭스) */}
                    {s.stepType === 'wait' && (
                      <div className="p-3 bg-sky-50 border border-sky-200 rounded text-xs space-y-3">
                        <div className="font-semibold text-sky-800">대기 step</div>
                        <div className="text-sky-800 leading-relaxed">
                          메시지 발송 없이 대기 후 다음 step에 진입합니다.
                        </div>

                        {/* ★ 2026-07-11 wait-until-event — 이벤트가 오면 즉시 진행, 없으면 타임아웃에 진행 */}
                        <div>
                          <label className="block text-[10px] text-sky-800 mb-1">이벤트 대기 (선택)</label>
                          <select
                            value={s.waitEventName || ''}
                            onChange={(e) => updateStep(idx, { waitEventName: e.target.value || undefined, waitTimeoutHours: e.target.value ? (s.waitTimeoutHours ?? 72) : undefined })}
                            className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs"
                          >
                            <option value="">사용 안 함: 시간만 대기 (기본)</option>
                            <option value="purchase">구매(purchase)가 오면 즉시 진행</option>
                            <option value="message_click">발송 링크 클릭이 오면 즉시 진행</option>
                            <option value="page_view">몰 방문(page_view)이 오면 즉시 진행</option>
                            <option value="cart_add">장바구니 담기가 오면 즉시 진행</option>
                            <option value="reservation_created">예약 생성이 오면 즉시 진행</option>
                          </select>
                          {s.waitEventName && (
                            <div className="mt-2 flex items-center gap-2">
                              <label className="text-[10px] text-sky-800 shrink-0">최대 대기 (시간)</label>
                              <input
                                type="number" min={1} max={720}
                                value={s.waitTimeoutHours ?? 72}
                                onChange={(e) => updateStep(idx, { waitTimeoutHours: Math.max(1, Math.min(720, Number(e.target.value) || 72)) })}
                                className="w-24 px-2 py-1.5 bg-white border border-slate-200 rounded text-xs"
                              />
                              <span className="text-[10px] text-sky-800">기한까지 안 오면 다음 step으로 진행합니다.</span>
                            </div>
                          )}
                        </div>

                        {/* delay_mode dropdown */}
                        <div>
                          <label className="block text-[10px] text-sky-800 mb-1">대기 방식</label>
                          <select
                            value={s.delayMode || 'relative'}
                            onChange={(e) => {
                              const newMode = e.target.value as NonNullable<AIGeneratedStep['delayMode']>;
                              if (newMode === 'specific_hour') {
                                updateStep(idx, { delayMode: newMode, targetHourKst: s.targetHourKst ?? 9 });
                              } else {
                                updateStep(idx, { delayMode: newMode, targetHourKst: undefined });
                              }
                            }}
                            className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs"
                          >
                            <option value="relative">상대 시간 (N시간 후)</option>
                            <option value="specific_hour">특정 시간 (오늘/내일 N시 KST)</option>
                            <option value="next_business_day">다음 평일 (월~금) 09시 KST</option>
                          </select>
                        </div>

                        {/* mode 1: relative — 일 + 시간 (마케팅 담당자가 시간 환산 불필요) */}
                        {(!s.delayMode || s.delayMode === 'relative') && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <label className="text-[10px] text-sky-800 w-20">대기 기간</label>
                              <input type="number" min={0} max={365} value={Math.floor((s.delayHours ?? 0) / 24)}
                                onChange={(e) => { const days = Math.max(0, Math.min(365, Number(e.target.value) || 0)); updateStep(idx, { delayHours: days * 24 + ((s.delayHours ?? 0) % 24) }); }}
                                className="w-16 px-2 py-1 bg-white border border-slate-200 rounded text-xs" />
                              <span className="text-[11px] text-sky-800">일</span>
                              <input type="number" min={0} max={23} value={(s.delayHours ?? 0) % 24}
                                onChange={(e) => { const hrs = Math.max(0, Math.min(23, Number(e.target.value) || 0)); updateStep(idx, { delayHours: Math.floor((s.delayHours ?? 0) / 24) * 24 + hrs }); }}
                                className="w-16 px-2 py-1 bg-white border border-slate-200 rounded text-xs" />
                              <span className="text-[11px] text-sky-800">시간 대기</span>
                            </div>
                            <div className="text-[10px] text-sky-800">
                              예: 3일 0시간 대기 후 후기 요청 발송
                            </div>
                          </div>
                        )}

                        {/* mode 2: specific_hour — target_hour_kst input */}
                        {s.delayMode === 'specific_hour' && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <label className="text-[10px] text-sky-800 w-20">발송 시간</label>
                              <select
                                value={s.targetHourKst ?? 9}
                                onChange={(e) => updateStep(idx, { targetHourKst: Math.max(0, Math.min(23, Number(e.target.value) || 9)) })}
                                className="w-24 px-2 py-1 bg-white border border-slate-200 rounded text-xs"
                              >
                                {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                                  <option key={h} value={h}>{String(h).padStart(2, '0')}시</option>
                                ))}
                              </select>
                              <span className="text-[11px] text-sky-800">KST (오늘 그 시각이 지났으면 내일)</span>
                            </div>
                            <div className="text-[10px] text-sky-800">
                              예: 09시 → 오전에 들어오면 오늘 09시, 오후에 들어오면 내일 09시
                            </div>
                          </div>
                        )}

                        {/* mode 3: next_business_day */}
                        {s.delayMode === 'next_business_day' && (
                          <div className="text-[10px] text-sky-800 leading-relaxed">
                            다음 평일(월~금) 09시에 보내요. 주말이나 금요일 09시 뒤에 들어오면 다음 월요일 09시예요.
                          </div>
                        )}
                      </div>
                    )}

                    {/* ★ D188 Phase 2-B-1 + D210+ Phase 3 (2026-05-23 Harold 명시): condition step UI — type 3 분기 매트릭스
                          1. customer_field — 옛 매트릭스 (field + operator + value)
                          2. cdp_event_exists — 지난 N일 안 이벤트 EXISTS 영역
                          3. journey_step_clicked — 옛 step N 클릭 영역 EXISTS */}
                    {s.stepType === 'condition' && (
                      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-xs space-y-3">
                        <div className="font-semibold text-emerald-800">조건 칸</div>
                        <div className="text-emerald-800 leading-relaxed">
                          고객 정보를 확인해 맞으면 바로 다음 칸으로 갑니다. 아니면 아래에서 고른 대로 여정을 끝내거나 뒤쪽 칸으로 건너뜁니다.
                        </div>

                        {/* ★ 2026-07-11 진짜 분기 — 미충족 시: 종료(기본) 또는 뒤쪽 step으로 이동 (yes/no 경로) */}
                        <div>
                          <label className="block text-[11px] text-emerald-800 mb-1">조건이 맞지 않으면</label>
                          <select
                            value={s.notMetGoto ?? ''}
                            onChange={(e) => updateStep(idx, { notMetGoto: e.target.value === '' ? null : Number(e.target.value) })}
                            className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs"
                          >
                            <option value="">여정 끝 (기본)</option>
                            {aiPkg.steps.filter((t) => t.stepOrder > s.stepOrder).map((t) => (
                              <option key={t.stepOrder} value={t.stepOrder}>
                                {t.stepOrder}번째 칸으로 건너뛰기{t.stepIntent ? `: ${String(t.stepIntent).slice(0, 20)}` : ''}
                              </option>
                            ))}
                          </select>
                          {/* ★ 2026-09-29 여정 V2 0차 ⑦ — 옛 안내는 실행기와 반대로 설명했다. 실제 동작(journey-executor.ts):
                              맞으면 = 바로 다음 칸 · 아니면 = 고른 뒤쪽 칸으로 점프(사이 칸은 안 받음) · 맞는 쪽은 그 뒤 칸까지 이어서 받는다. */}
                          <div className="text-[11px] text-emerald-800 mt-1 leading-relaxed">
                            조건이 맞는 고객은 다음 칸부터 끝까지 이어서 받습니다. 맞지 않는 고객은 고른 칸으로 건너뛰고 그 사이 칸은 받지 않습니다.
                          </div>
                        </div>

                        {/* type dropdown */}
                        <div>
                          <label className="block text-[11px] text-emerald-800 mb-1">조건 종류</label>
                          <select
                            value={s.conditionJsonb?.type || 'customer_field'}
                            onChange={(e) => {
                              const newType = e.target.value as ConditionJsonb['type'];
                              if (newType === 'customer_field') {
                                updateStep(idx, {
                                  conditionJsonb: {
                                    type: 'customer_field',
                                    field: 'total_purchase_amount',
                                    operator: '>=',
                                    value: 100000,
                                  },
                                });
                              } else if (newType === 'cdp_event_exists') {
                                updateStep(idx, {
                                  conditionJsonb: {
                                    type: 'cdp_event_exists',
                                    event_name: 'purchase',
                                    within_days: 7,
                                    presence: 'not_exists',
                                  },
                                });
                              } else if (newType === 'journey_step_clicked') {
                                updateStep(idx, {
                                  conditionJsonb: {
                                    type: 'journey_step_clicked',
                                    step_order: Math.max(1, s.stepOrder - 1),
                                    within_days: 5,
                                    clicked: false,
                                  },
                                });
                              } else if (newType === 'purchase_since_entry') {
                                updateStep(idx, { conditionJsonb: { type: 'purchase_since_entry', purchased: true } });
                              } else if (newType === 'step_link_clicked') {
                                const prevMsg = [...aiPkg.steps].filter((t) => t.stepOrder < s.stepOrder && t.stepType === 'message').pop();
                                updateStep(idx, { conditionJsonb: { type: 'step_link_clicked', step_ref_order: prevMsg?.stepOrder, clicked: true } });
                              }
                            }}
                            className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs"
                          >
                            <option value="customer_field">고객 정보 (등급 · 구매 금액 · 지역 등)</option>
                            {/* ★ 2026-09-30 V2 4차 — 새 조건 2종(목표 판정 · 통계와 같은 기준) */}
                            <option value="purchase_since_entry">이 여정에 들어온 뒤 구매했나</option>
                            <option value="step_link_clicked">앞쪽 문자 칸의 링크를 눌렀나</option>
                            {/* ★ 2026-09-29 여정 V2 0차 ⑦ — 아래 두 종류는 고를 수는 있는데 저장이 막히는 죽은 선택지였다(collectStepIssues).
                                기준도 틀려 있다(구매 여정에서는 진입 구매로 늘 참 · 매장 구매는 못 봄 · 아무 클릭이나 셈).
                                "이 여정에 들어온 뒤 구매했나" · "이 칸 링크를 눌렀나"로 다시 여는 것은 4차. AI 가 낸 옛 조건은 표시만 한다. */}
                            {s.conditionJsonb?.type === 'cdp_event_exists' && (
                              <option value="cdp_event_exists" disabled>최근 사건 조건 (지금은 저장할 수 없어요)</option>
                            )}
                            {s.conditionJsonb?.type === 'journey_step_clicked' && (
                              <option value="journey_step_clicked" disabled>앞 칸 클릭 조건 (지금은 저장할 수 없어요)</option>
                            )}
                          </select>
                        </div>

                        {/* ★ 2026-09-30 V2 4차 — 들어온 뒤 구매 */}
                        {s.conditionJsonb?.type === 'purchase_since_entry' && (
                          <div className="flex flex-wrap gap-1.5">
                            {[{ v: true, label: '샀으면 맞음' }, { v: false, label: '안 샀으면 맞음' }].map((o) => (
                              <button key={String(o.v)} type="button"
                                onClick={() => updateStep(idx, { conditionJsonb: { type: 'purchase_since_entry', purchased: o.v } })}
                                className={(s.conditionJsonb as ConditionJsonbPurchaseSinceEntry).purchased === o.v ? 'px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-100 border border-emerald-300 text-emerald-900' : 'px-2.5 py-1 rounded-lg text-[11px] border border-slate-300 text-slate-500 hover:bg-slate-100'}>
                                {o.label}
                              </button>
                            ))}
                            <div className="w-full text-[11px] text-emerald-800">자사몰 주문 · 매장 구매 · 최근 구매일 중 하나라도 들어온 뒤면 "샀음"(목표 판정과 같은 기준)</div>
                          </div>
                        )}
                        {/* ★ 2026-09-30 V2 4차 — 앞쪽 문자 칸 링크 클릭(통계의 칸별 클릭과 같은 기준) */}
                        {s.conditionJsonb?.type === 'step_link_clicked' && (() => {
                          const c = s.conditionJsonb as ConditionJsonbStepLinkClicked;
                          const prevMsgs = aiPkg.steps.filter((t) => t.stepOrder < s.stepOrder && t.stepType === 'message');
                          return (
                            <div className="space-y-2">
                              <select value={c.step_ref_order ?? ''} onChange={(e) => updateStep(idx, { conditionJsonb: { ...c, step_ref_order: e.target.value === '' ? undefined : Number(e.target.value) } })}
                                className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs">
                                <option value="">볼 문자 칸 고르기</option>
                                {prevMsgs.map((t) => <option key={t.stepOrder} value={t.stepOrder}>{t.stepOrder}번째 칸{t.stepIntent ? `: ${String(t.stepIntent).slice(0, 20)}` : ''}</option>)}
                              </select>
                              <div className="flex flex-wrap gap-1.5">
                                {[{ v: true, label: '눌렀으면 맞음' }, { v: false, label: '안 눌렀으면 맞음' }].map((o) => (
                                  <button key={String(o.v)} type="button" onClick={() => updateStep(idx, { conditionJsonb: { ...c, clicked: o.v } })}
                                    className={c.clicked === o.v ? 'px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-100 border border-emerald-300 text-emerald-900' : 'px-2.5 py-1 rounded-lg text-[11px] border border-slate-300 text-slate-500 hover:bg-slate-100'}>
                                    {o.label}
                                  </button>
                                ))}
                              </div>
                              {prevMsgs.length === 0 && <div className="text-[11px] text-amber-800">이 칸 앞에 문자 칸이 없어요.</div>}
                            </div>
                          );
                        })()}

                        {/* type 1: customer_field 영역 */}
                        {(!s.conditionJsonb || s.conditionJsonb.type === 'customer_field') && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-2 items-center">
                              <select
                                value={(s.conditionJsonb as ConditionJsonbCustomerField | undefined)?.field || ''}
                                onChange={(e) =>
                                  updateStep(idx, {
                                    conditionJsonb: {
                                      type: 'customer_field',
                                      field: e.target.value,
                                      operator: (s.conditionJsonb as ConditionJsonbCustomerField | undefined)?.operator || '>=',
                                      value: (s.conditionJsonb as ConditionJsonbCustomerField | undefined)?.value,
                                    },
                                  })
                                }
                                className="px-2 py-1.5 bg-white border border-slate-200 rounded text-xs"
                              >
                                <option value="">고객 정보 선택</option>
                                {/* ★ 2026-10-25 #15(R1) — 칸 목록 = 대상 조건 CT 와 같은 표(COND_FIELDS · 짝 시험 journey-v3-cond-fields-1020) · 옛 목록 값은 그대로 보여 준다 */}
                                {(() => {
                                  const cur = (s.conditionJsonb as ConditionJsonbCustomerField | undefined)?.field || '';
                                  return cur && !COND_FIELDS.some((f) => f.key === cur) ? <option value={cur}>이전에 고른 정보(다시 골라 주세요)</option> : null;
                                })()}
                                {COND_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                              </select>
                              <select
                                value={(s.conditionJsonb as ConditionJsonbCustomerField | undefined)?.operator || '>='}
                                onChange={(e) =>
                                  updateStep(idx, {
                                    conditionJsonb: {
                                      type: 'customer_field',
                                      field: (s.conditionJsonb as ConditionJsonbCustomerField | undefined)?.field || '',
                                      operator: e.target.value as ConditionOperator,
                                      value: (s.conditionJsonb as ConditionJsonbCustomerField | undefined)?.value,
                                    },
                                  })
                                }
                                className="px-2 py-1.5 bg-white border border-slate-200 rounded text-xs"
                              >
                                <option value="==">같음 (==)</option>
                                <option value="!=">다름 (!=)</option>
                                <option value=">=">이상 (≥)</option>
                                <option value="<=">이하 (≤)</option>
                                <option value=">">초과 (&gt;)</option>
                                <option value="<">미만 (&lt;)</option>
                                <option value="in">포함 (in)</option>
                                <option value="not_in">미포함 (not_in)</option>
                                <option value="is_null">비어있음</option>
                                <option value="not_null">값 있음</option>
                              </select>
                              {!['is_null', 'not_null'].includes((s.conditionJsonb as ConditionJsonbCustomerField | undefined)?.operator || '') && (
                                <input
                                  type="text"
                                  value={(s.conditionJsonb as ConditionJsonbCustomerField | undefined)?.value ?? ''}
                                  onChange={(e) =>
                                    updateStep(idx, {
                                      conditionJsonb: {
                                        type: 'customer_field',
                                        field: (s.conditionJsonb as ConditionJsonbCustomerField | undefined)?.field || '',
                                        operator: (s.conditionJsonb as ConditionJsonbCustomerField | undefined)?.operator || '>=',
                                        value: e.target.value,
                                      },
                                    })
                                  }
                                  placeholder="비교값 (in/not_in은 쉼표 구분)"
                                  className="px-2 py-1.5 bg-white border border-slate-200 rounded text-xs"
                                />
                              )}
                            </div>
                            <div className="text-[10px] text-emerald-800">
                              예: 최근 구매 금액 ≥ 100000 → VIP 등급 고객만 다음 step 진입
                            </div>
                          </div>
                        )}

                        {/* type 2: cdp_event_exists 영역 */}
                        {s.conditionJsonb?.type === 'cdp_event_exists' && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
                              <select
                                value={s.conditionJsonb.event_name}
                                onChange={(e) =>
                                  updateStep(idx, {
                                    conditionJsonb: {
                                      type: 'cdp_event_exists',
                                      event_name: e.target.value,
                                      within_days: (s.conditionJsonb as ConditionJsonbCdpEventExists).within_days,
                                      presence: (s.conditionJsonb as ConditionJsonbCdpEventExists).presence,
                                    },
                                  })
                                }
                                className="px-2 py-1.5 bg-white border border-slate-200 rounded text-xs"
                              >
                                <option value="purchase">구매 (purchase)</option>
                                <option value="order">주문 (order)</option>
                                <option value="cart_add">장바구니 추가 (cart_add)</option>
                                <option value="page_view">페이지 조회 (page_view)</option>
                                <option value="message_click">메시지 클릭 (message_click)</option>
                              </select>
                              <input
                                type="number"
                                min={1}
                                max={365}
                                value={s.conditionJsonb.within_days}
                                onChange={(e) =>
                                  updateStep(idx, {
                                    conditionJsonb: {
                                      type: 'cdp_event_exists',
                                      event_name: (s.conditionJsonb as ConditionJsonbCdpEventExists).event_name,
                                      within_days: Math.max(1, Math.min(365, Number(e.target.value) || 7)),
                                      presence: (s.conditionJsonb as ConditionJsonbCdpEventExists).presence,
                                    },
                                  })
                                }
                                placeholder="지난 N일 (1~365)"
                                className="px-2 py-1.5 bg-white border border-slate-200 rounded text-xs"
                              />
                              <select
                                value={s.conditionJsonb.presence}
                                onChange={(e) =>
                                  updateStep(idx, {
                                    conditionJsonb: {
                                      type: 'cdp_event_exists',
                                      event_name: (s.conditionJsonb as ConditionJsonbCdpEventExists).event_name,
                                      within_days: (s.conditionJsonb as ConditionJsonbCdpEventExists).within_days,
                                      presence: e.target.value as 'exists' | 'not_exists',
                                    },
                                  })
                                }
                                className="px-2 py-1.5 bg-white border border-slate-200 rounded text-xs"
                              >
                                <option value="exists">이벤트 있음 (exists)</option>
                                <option value="not_exists">이벤트 없음 (not_exists)</option>
                              </select>
                            </div>
                            <div className="text-[10px] text-emerald-800">
                              예: 「지난 7일 안 구매 없음」 → 마지막 날 다시 알림
                            </div>
                          </div>
                        )}

                        {/* type 3: journey_step_clicked 영역 */}
                        {s.conditionJsonb?.type === 'journey_step_clicked' && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
                              <select
                                value={s.conditionJsonb.step_order}
                                onChange={(e) =>
                                  updateStep(idx, {
                                    conditionJsonb: {
                                      type: 'journey_step_clicked',
                                      step_order: Number(e.target.value) || 1,
                                      within_days: (s.conditionJsonb as ConditionJsonbJourneyStepClicked).within_days,
                                      clicked: (s.conditionJsonb as ConditionJsonbJourneyStepClicked).clicked,
                                    },
                                  })
                                }
                                className="px-2 py-1.5 bg-white border border-slate-200 rounded text-xs"
                              >
                                {Array.from({ length: Math.max(0, s.stepOrder - 1) }, (_, i) => i + 1).map((n) => (
                                  <option key={n} value={n}>Step {n}</option>
                                ))}
                              </select>
                              <input
                                type="number"
                                min={1}
                                max={365}
                                value={s.conditionJsonb.within_days}
                                onChange={(e) =>
                                  updateStep(idx, {
                                    conditionJsonb: {
                                      type: 'journey_step_clicked',
                                      step_order: (s.conditionJsonb as ConditionJsonbJourneyStepClicked).step_order,
                                      within_days: Math.max(1, Math.min(365, Number(e.target.value) || 5)),
                                      clicked: (s.conditionJsonb as ConditionJsonbJourneyStepClicked).clicked,
                                    },
                                  })
                                }
                                placeholder="발송 후 N일 (1~365)"
                                className="px-2 py-1.5 bg-white border border-slate-200 rounded text-xs"
                              />
                              <select
                                value={String(s.conditionJsonb.clicked)}
                                onChange={(e) =>
                                  updateStep(idx, {
                                    conditionJsonb: {
                                      type: 'journey_step_clicked',
                                      step_order: (s.conditionJsonb as ConditionJsonbJourneyStepClicked).step_order,
                                      within_days: (s.conditionJsonb as ConditionJsonbJourneyStepClicked).within_days,
                                      clicked: e.target.value === 'true',
                                    },
                                  })
                                }
                                className="px-2 py-1.5 bg-white border border-slate-200 rounded text-xs"
                              >
                                <option value="true">클릭 있음</option>
                                <option value="false">클릭 없음</option>
                              </select>
                            </div>
                            <div className="text-[10px] text-emerald-800">
                              예: 「1번째 칸 발송 뒤 5일 안 클릭 없음」 → 다른 채널로 다시 보내기
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ★ D189 #2 (2026-05-22): 알림톡 step UI — AlimtalkChannelPanel 통합 (발신프로필 + 템플릿 + 변수 매핑 + 부달 + 미리보기) */}
                    {s.stepType === 'message' && s.channel === 'kakao' && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-semibold text-amber-800">알림톡 (KAKAO) step</div>
                          {/* ★ D190 #3 (2026-05-22): AI 자동 매칭 추천 버튼 + ★ D196 (2026-05-22) 사용법 안내 강화 */}
                          {alimtalkTemplates.length > 0 && (
                            <button
                              onClick={() => handleAlimtalkAutoMatch(idx)}
                              className="px-2 py-1 bg-violet-100 hover:bg-violet-200 text-violet-800 rounded text-[11px] flex items-center gap-1"
                              title="AI가 회사의 승인된 알림톡 템플릿 중 이 여정에 가장 맞는 1건을 고르고 변수(#{이름}/#{등급} 등)를 연결해요. 결과를 보고 고칠 수 있어요."
                            >
                              <Wand2 className="w-3 h-3" />
                              AI 자동 매칭
                            </button>
                          )}
                        </div>
                        {/* ★ D196 (2026-05-22) 사용법 안내 — 알림톡 step 첫 진입 시 가이드 */}
                        {!s.alimtalkTemplateCode && alimtalkTemplates.length > 0 && (
                          <div className="mb-2 p-2 bg-violet-50 border border-violet-200 rounded text-[11px] text-violet-800 flex items-start gap-1.5">
                            <Wand2 className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            <span>
                              <strong className="text-violet-800">AI 자동 매칭</strong> 버튼을 누르면 회사의 승인된 템플릿 중 이 여정에 맞는 1건을 고르고 변수를 연결해요. 아래에서 직접 골라도 돼요.
                            </span>
                          </div>
                        )}
                        {alimtalkSenders.length === 0 ? (
                          <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-800">
                            승인된 발신프로필이 없습니다. 알림톡 발송 모달에서 발신프로필을 먼저 등록해주세요.
                          </div>
                        ) : alimtalkTemplates.length === 0 ? (
                          <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-800">
                            승인된 알림톡 템플릿이 없습니다. 알림톡 발송 모달에서 템플릿을 먼저 등록 + 검수 통과 후 사용해주세요.
                          </div>
                        ) : (
                          <AlimtalkChannelPanel
                            senders={alimtalkSenders}
                            templates={alimtalkTemplates}
                            customerFieldOptions={customerFields}
                            value={stepToAlimtalkState(s)}
                            onChange={(next) => updateStep(idx, alimtalkStateToStepPatch(next))}
                          />
                        )}
                        {/* ★ 2026-07-27: 전환재발송 규칙 위반은 저장(400)·활성화에서 막힌다 — 화면에서 먼저 알려준다. */}
                        {s.alimtalkTemplateCode && validateAlimtalkChannelState(stepToAlimtalkState(s)) && (
                          <div className="mt-2 p-2 bg-rose-50 border border-rose-200 rounded text-[11px] text-rose-800">
                            {validateAlimtalkChannelState(stepToAlimtalkState(s))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ★ D188 Phase 2-B-1: message step UI — 기존 매트릭스 유지 (SMS/LMS/MMS) */}
                    {s.stepType === 'message' && s.channel !== 'kakao' && (
                      <>
                        {/* ★ 2026-10-20 V.3 §9-4 — 만들기 검토 칸도 큰 휴대폰 한 벌((광고) · 무료수신거부 합성 바이트 · 제목 40 · 보이는 모습 = 대상 고객 1명 치환).
                            옛: 순수 본문 바이트만 세서 단문 90바이트 경계를 넘겨도 몰랐다. */}
                        <PhoneComposer
                          channel={(s.channel === 'sms' || s.channel === 'mms' ? s.channel : 'lms') as 'sms' | 'lms' | 'mms'}
                          subject={s.subject || ''}
                          body={s.messageTemplate || ''}
                          isAd={s.isAd !== false}
                          opt080Number={opt080Number}
                          onSubject={(v) => updateStep(idx, { subject: v })}
                          onBody={(v) => updateStep(idx, { messageTemplate: v })}
                          sampleCustomer={sampleCustomer}
                          sampleCustomerFields={sampleCustomerFields}
                          imageCount={s.channel === 'mms' ? (s.mmsImagePaths?.length ?? 0) : 0}
                          resetKey={idx}
                        />

                        {/* ★ D189 #3 (2026-05-22): MMS 이미지 업로드 — channel === 'mms' 시 mount (최대 3장, JPG 300KB) */}
                        {s.channel === 'mms' && (
                          <JourneyMmsUploader
                            value={s.mmsImagePaths || []}
                            onChange={(paths) => updateStep(idx, { mmsImagePaths: paths })}
                          />
                        )}

                        <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-slate-400">
                          {placeholderWarn && <span className="text-amber-700">[...] 자리는 직접 고쳐 주세요</span>}
                          {(() => {
                            const unsafe = detectUnsafe(s.messageTemplate + ' ' + s.subject);
                            if (unsafe.length === 0) return null;
                            return (
                              <span className="text-rose-600">
                                문자로 보낼 수 없는 글자: 발송 때 빠지거나 비슷한 글자로 바뀝니다 ({unsafe.slice(0, 5).join(' ')})
                              </span>
                            );
                          })()}
                        </div>
                      </>
                    )}
                    {/* 발송 시점(자연어) + 컨트롤 (3분할 카드 하단) */}
                    <div className="pt-2.5 mt-1 border-t border-slate-200 space-y-2">
                      {s.stepType === 'message' && (
                        <div className="flex flex-wrap items-center gap-1.5 text-xs bg-white rounded-lg px-2.5 py-2">
                          <Clock className="w-3.5 h-3.5 text-violet-700 shrink-0" />
                          <span className="text-slate-500">{idx === 0 ? '트리거 후' : '직전 단계 후'}</span>
                          {/* 일 단위 우선 — 마케팅 담당자가 시간으로 환산할 필요 없음(일 + 시간 둘 다 입력) */}
                          <input type="number" min={0} max={365} value={Math.floor((s.delayHours ?? 0) / 24)}
                            onChange={(e) => { const days = Math.max(0, Math.min(365, Number(e.target.value) || 0)); updateStep(idx, { delayHours: days * 24 + ((s.delayHours ?? 0) % 24) }); }}
                            className="w-12 px-2 py-0.5 bg-slate-100 border border-slate-200 rounded" />
                          <span className="text-slate-700">일</span>
                          <input type="number" min={0} max={23} value={(s.delayHours ?? 0) % 24}
                            onChange={(e) => { const hrs = Math.max(0, Math.min(23, Number(e.target.value) || 0)); updateStep(idx, { delayHours: Math.floor((s.delayHours ?? 0) / 24) * 24 + hrs }); }}
                            className="w-12 px-2 py-0.5 bg-slate-100 border border-slate-200 rounded" />
                          <span className="text-slate-700">시간 뒤</span>
                          <span className="text-slate-500 ml-1">· 발송 시각</span>
                          <select value={s.delayMode === 'relative_at_hour' && s.targetHourKst != null ? String(s.targetHourKst) : ''}
                            onChange={(e) => { const v = e.target.value; if (v === '') updateStep(idx, { delayMode: 'relative', targetHourKst: undefined }); else updateStep(idx, { delayMode: 'relative_at_hour', targetHourKst: Number(v) }); }}
                            className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded">
                            <option value="">지정 안 함</option>
                            {Array.from({ length: 13 }, (_, i) => i + 8).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}시</option>)}
                          </select>
                          <span className="text-slate-400 text-[10px]">밤이면 아침 자동</span>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <select
                          value={s.stepType}
                          onChange={(e) => {
                            const newType = e.target.value as StepType;
                            const patch: Partial<AIGeneratedStep> = { stepType: newType };
                            if (newType === 'condition' && !s.conditionJsonb) {
                              patch.conditionJsonb = { type: 'customer_field', field: 'total_purchase_amount', operator: '>=', value: 100000 };
                            }
                            // ★ 2026-09-30 V2 4차 — 끝 칸은 기다리지 않는다(대기 0 고정).
                            if (newType === 'end') patch.delayHours = 0;
                            updateStep(idx, patch);
                          }}
                          className="px-2 py-1 bg-slate-100 border border-slate-200 rounded" title="step 유형"
                        >
                          <option value="message">메시지</option>
                          <option value="wait">대기</option>
                          <option value="condition">조건</option>
                          {(endChipEnabled || s.stepType === 'end') && <option value="end">끝 (이 갈래를 여기서 마침)</option>}
                        </select>
                        {s.stepType === 'message' && (
                          <>
                            <select value={s.channel} onChange={(e) => updateStep(idx, { channel: e.target.value as ChannelType })} className="px-2 py-1 bg-slate-100 border border-slate-200 rounded">
                              <option value="sms">SMS</option>
                              <option value="lms">LMS</option>
                              <option value="mms">MMS</option>
                              <option value="kakao">알림톡</option>
                            </select>
                            <label className="flex items-center gap-1 cursor-pointer px-2 py-1 rounded bg-slate-100 border border-slate-200">
                              <input type="checkbox" checked={s.isAd} onChange={(e) => updateStep(idx, { isAd: e.target.checked })} className="rounded" />
                              <span className="text-amber-700">광고 표기</span>
                            </label>
                            <button onClick={() => handleRefineOpen(idx)} disabled={refineLoading} className="px-2 py-1 bg-violet-100 hover:bg-violet-100 text-violet-700 rounded flex items-center gap-1 disabled:opacity-50">
                              {refineLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}AI 다듬기
                            </button>
                          </>
                        )}
                        <button onClick={() => deleteStep(idx)} className="p-1.5 bg-rose-100 hover:bg-rose-100 text-rose-700 rounded ml-auto" title="이 단계 삭제">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                          </div>
                          <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 bg-slate-100">
                            <button onClick={() => setEditingStepIdx(null)} className="text-white px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-sm font-medium">완료</button>
                          </div>
                        </div>
                      </div>,
                      document.body,
                    )}
                  </div>
                );
              })}

              {aiPkg.steps.length < MAX_TOTAL_STEPS && (
                <button onClick={addStep} className="w-full p-3 border-2 border-dashed border-slate-200 hover:border-slate-300 rounded-xl text-sm text-slate-500 hover:text-slate-700 flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4" /> Step 추가
                </button>
              )}
            </div>

            {/* 액션 버튼 */}
            <div className="flex flex-wrap gap-2 pt-2 sticky bottom-0 bg-slate-100 backdrop-blur-sm border-t border-slate-200 -mx-3 md:-mx-6 px-3 md:px-6 py-3">
              <button onClick={handleRegenerate} disabled={saving} className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-700 text-sm flex items-center gap-2 disabled:opacity-50">
                <RefreshCw className="w-4 h-4" /> AI 다시 생성
              </button>
              <button onClick={() => setConfirm({ mode: 'warning', title: '메인으로 돌아가기', description: '변경사항이 사라집니다. 메인으로 돌아가시겠습니까?', confirmLabel: '나가기', onConfirm: () => { setView('main'); setAiPkg(null); } })} disabled={saving} className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-700 text-sm">취소</button>
              <button onClick={handleSaveDraft} disabled={saving || !reviewCallback} className="text-white flex-1 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}초안 저장
              </button>
            </div>
          </div>
        )}

      {/* 고객 데이터 없음 — 생성 차단 안내 */}
      <CustomerDataRequiredModal open={showDataGate} onClose={() => setShowDataGate(false)} />

      {/* AI 다듬기 modal */}
      {/* ★ 2026-08-08 (Harold 접수) — 후보 나열을 없애고 **비포/애프터 한 쌍**으로 본다.
          "3종은 의미가 없다 · 뭐가 바뀌었는지 보이게" — 직접발송 모달과 같은 규약(하이라이트 CT 공용). */}
      {refining && (() => {
        const cand = refining.candidates[0];
        const before = String(aiPkg?.steps[refining.stepIdx]?.messageTemplate || '');
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-slate-200 bg-white" onClick={(e) => e.stopPropagation()}>
              <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white p-4">
                <h3 className="flex items-center gap-2 text-base font-semibold">
                  <Wand2 className="h-4 w-4 text-violet-600" />AI 다듬기
                  {cand && <span className="text-[11px] font-normal text-slate-400">바뀐 부분만 표시됩니다</span>}
                </h3>
                <button onClick={() => setRefining(null)} className="text-slate-400 hover:text-slate-900"><X className="h-5 w-5" /></button>
              </div>

              {!cand ? (
                <div className="p-4"><p className="text-sm text-slate-500">다듬은 결과가 없습니다. 다시 시도해 주세요.</p></div>
              ) : (
                <div className="space-y-3 p-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    {/* 비포 — 지금 문안 */}
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">지금 문안</span>
                        <span className="text-[10px] text-slate-400">{calculateSmsBytes(buildAdMessageFront(before, String(aiPkg?.steps[refining.stepIdx]?.channel || 'lms').toUpperCase(), aiPkg?.steps[refining.stepIdx]?.isAd !== false, opt080Number))} bytes</span>
                      </div>
                      <div className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-slate-500">{before || '(비어 있음)'}</div>
                    </div>

                    {/* 애프터 — 바뀐 부분 강조 */}
                    <div className="rounded-lg border border-violet-300 bg-violet-50 p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="rounded bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-900">다듬은 문안</span>
                        <span className="text-[10px] text-slate-400">{cand.bytes} bytes</span>
                        {cand.tone && <span className="text-[10px] text-slate-400">{cand.tone} 톤</span>}
                      </div>
                      <div className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-slate-800">
                        {highlightAdditions(before, cand.message).map((chunk, i) => (
                          chunk.added
                            ? <mark key={i} className="rounded bg-violet-200 text-violet-900">{chunk.text}</mark>
                            : <span key={i}>{chunk.text}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {cand.reasoning && (
                    <p className="rounded-lg border border-slate-200 bg-slate-100 p-2.5 text-[11.5px] leading-relaxed text-slate-500">{cand.reasoning}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleAcceptRefine(cand)}
                      className="rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-xs font-semibold text-white transition-opacity"
                    >
                      이걸로 바꾸기
                    </button>
                    <button
                      onClick={() => { const i = refining.stepIdx; setRefining(null); void handleRefineOpen(i); }}
                      disabled={refineLoading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-white disabled:opacity-50"
                    >
                      {refineLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} 다시 다듬기
                    </button>
                    <button onClick={() => setRefining(null)} className="px-3 py-2 text-xs text-slate-400 hover:text-slate-600">그대로 두기</button>
                  </div>
                  <p className="text-[10px] italic text-slate-400">바이트는 (광고) 표기 포함 기준입니다.</p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ★ D211+ Phase 3-fix (2026-05-23 Harold 명시): archive/unarchive/delete 영역 커스텀 다크 톤 모달 (native confirm/prompt 영구 폐기) */}
      {actionModal && (
        <JourneyActionConfirmModal
          mode={actionModal.mode}
          journeyName={actionModal.journeyName}
          onConfirm={executeArchiveAction}
          onClose={() => setActionModal(null)}
        />
      )}

      {/* native confirm 폐기 — 공용 다크 톤 확인 모달 */}
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />

      {/* ★ D218+ (2026-05-26): 활성화 자동 검증 모달 — 비용 + 잔액 + ConfirmModal */}
      {activationModal && (
        <JourneyActivationConfirmModal
          journeyId={activationModal.journeyId}
          journeyName={activationModal.journeyName}
          journeyStatus={activationModal.journeyStatus}
          goalExitEnabled={journeys.find((j) => j.id === activationModal.journeyId)?.goal_exit_enabled === true}
          thresholdRecipients={(journeys.find((j) => j.id === activationModal.journeyId) as any)?.threshold_recipients_per_step ?? null}
          activationCost={Number((journeys.find((j) => j.id === activationModal.journeyId) as any)?.activation_cost ?? 0) || 0}
          token={token() || ''}
          onClose={() => setActivationModal(null)}
          onActivated={() => loadAll()}
        />
      )}

      {/* ★ D218+ (2026-05-26): 정지 이력 영구 기록 모달 */}
      {pauseLogsModal && (
        <JourneyPauseLogsModal
          journeyId={pauseLogsModal.journeyId}
          journeyName={pauseLogsModal.journeyName}
          token={token() || ''}
          onClose={() => setPauseLogsModal(null)}
        />
      )}

      {editMessageModal && (
        <JourneyMessageEditModal
          journeyId={editMessageModal.journeyId}
          journeyName={editMessageModal.journeyName}
          journeyStatus={editMessageModal.journeyStatus}
          token={token() || ''}
          onClose={() => setEditMessageModal(null)}
          onSaved={() => { void loadAll(); }}
        />
      )}

      {/* ★ 2026-07-11 [타겟확인] — 공용 모달(createPortal z-2000). totalCount=발송 추출과 동일 함수 실측 */}
      <TargetRecipientsModal
        show={!!targetModal}
        onClose={() => { setTargetModal(null); setTargetInfo(null); }}
        title={`발송 대상 확인: ${targetModal?.journeyName || ''}`}
        criteria={targetInfo?.criteria ?? null}
        totalCount={targetInfo?.displayTotal ?? null}
        fetchPage={targetModal ? journeyTargetPage : null}
        extraColumns={targetInfo?.conditionColumns || null}
        note={[targetInfo?.basisLabel, `전체 ${(targetInfo?.displayTotal ?? 0).toLocaleString()}${targetInfo?.capped ? '+' : ''}명 중 최대 100명 표시`].filter(Boolean).join(' · ')}
      />

      {/* 정보 알림 — 버튼 클릭 모달화 (거래 통지 알림톡 빌더). 인라인 페이지 교체 폐기 → 닫으면 메인 그대로 */}
      {view === 'main' && purpose === 'info-alert' && createPortal(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col text-slate-900" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="flex items-center justify-between p-5 border-b border-slate-200 bg-gradient-to-r from-teal-50 via-emerald-50 to-teal-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center">
                  <Bell className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">정보 알림 만들기</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">거래가 일어나면 카카오 승인 템플릿으로 알림톡 자동 발송 (광고 아님)</p>
                </div>
              </div>
              <button onClick={() => setPurpose('marketing')} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors" aria-label="닫기">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <JourneyDataScopeNote
                className="mb-4"
                availableCount={journeyScope.availableCount}
                lockedCount={journeyScope.lockedCount}
                lockedHints={journeyScope.lockedHints}
              />
              <InfoAlertJourneyBuilder
                embedded
                senders={alimtalkSenders}
                templates={alimtalkTemplates}
                customerFieldOptions={customerFields}
                hasMallIntegration={hasMallIntegration}
                onBuild={handleInfoAlertBuild}
                onBack={() => setPurpose('marketing')}
              />
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* 날짜축 여정 — 지정일 D-N 빌더 모달 (2026-06-30 여정 일반화 SP-B) */}
      {view === 'main' && purpose === 'date-anchor' && createPortal(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col text-slate-900" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="flex items-center justify-between p-5 border-b border-slate-200 bg-gradient-to-r from-indigo-50 via-violet-50 to-indigo-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center">
                  <CalendarClock className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">날짜축 여정 만들기</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">기준 날짜(예: 포인트 소멸일) 기준 D-N 단계 발송 · D-0 후 정지/반복</p>
                </div>
              </div>
              <button onClick={() => setPurpose('marketing')} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors" aria-label="닫기">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <JourneyDataScopeNote
                className="mb-4"
                availableCount={journeyScope.availableCount}
                lockedCount={journeyScope.lockedCount}
                lockedHints={journeyScope.lockedHints}
              />
              <DateAnchorJourneyBuilder
                embedded
                dataProfileVars={dataProfileVars}
                opt080Number={opt080Number}
                onBuild={handleDateAnchorBuild}
                onBack={() => setPurpose('marketing')}
                onGeneratePlan={handleAnchorGeneratePlan}
                onRefine={handleAnchorRefine}
                onDecorate={handleAnchorDecorate}
              />
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ★ 2026-08-02 등급 서열 — 고객 데이터 화면과 이 잠긴 자리, 두 곳에서 같은 모달을 연다. */}
      <GradeOrderModal
        open={gradeOrderOpen}
        onClose={() => setGradeOrderOpen(false)}
        onSaved={() => { void loadDataCap(); }}
        token={token() || ''}
      />

      {/* ★ 2026-10-23 한 줄 여정 한 길 — 여정을 만드는 모든 입구가 이 창 하나(질문표 · 서버 초안 · 작업 화면). */}
      <InterviewModal
        open={!!lineJourney}
        onClose={() => setLineJourney(null)}
        initialSentence={lineJourney?.sentence}
        preset={lineJourney?.preset || null}
        quickStarts={quickStartItems}
        focusLabel="작업 화면 열기"
        onFocusJourney={(id) => openWorkspace(id)}
        onCreated={(made) => {
          void loadAll();
          // 다음 수 안내의 근거 = 서버가 만든 여정의 실제 시작 신호(옛 저장 응답과 같은 규칙)
          if (made && made.length > 0) { setSuccessionFrom(made[0].triggerEvent || null); setSuccessionGoalExit(made[0].goalExitEnabled); }
        }}
      />
      <JourneyWorkspace
        journeyId={wsJourney}
        stepId={wsStep}
        onClose={closeWorkspace}
        onChanged={() => { void loadAll(); }}
        onNavigate={(id, step) => openWorkspace(id, step)}
      />
      {journeyActions.node}
    </ZoneFrame>
  );
}
