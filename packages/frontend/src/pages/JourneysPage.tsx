import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ChevronDown, ChevronUp, Loader2, Pause, Play, Plus, Power, RefreshCw, Sparkles,
  ShoppingCart, Cake, Calendar as CalendarIcon, UserPlus, Repeat, Moon, MessageSquare,
  Clock, DollarSign, Users, Phone, Wand2, X, AlertCircle, Send, Trash2, Edit2, Save, Beaker, Code,
  BarChart3,
  // ★ D210+ Phase 2-fix6 (Harold 명시 2026-05-23): 6 sub-agent 진행 카드 + 토글 영역 아이콘
  Workflow, Brain, LayoutGrid, CheckCircle2,
  // ★ D210+ Phase 3 (2026-05-23 Harold 명시): 자동 재진입 토글 + funnel 시각화 + 다중 미리보기 아이콘
  RotateCcw, Activity, MousePointerClick, Filter as FilterIcon, TrendingUp, AlertTriangle, Eye,
  // ★ D211+ Phase 3 (2026-05-23 Harold 명시): 보관함 + 영구 삭제 아이콘
  Archive, ArchiveRestore,
} from 'lucide-react';
import JourneyVariantsEditor from '../components/journey/JourneyVariantsEditor';
import JourneyMmsUploader from '../components/journey/JourneyMmsUploader';
import LiquidPreviewModal from '../components/journey/LiquidPreviewModal';
// ★ D211+ Phase 3-fix (2026-05-23 Harold 명시): native confirm/prompt 영구 폐기 — 커스텀 다크 톤 모달 정합
import JourneyActionConfirmModal, { JourneyActionMode } from '../components/journey/JourneyActionConfirmModal';
// ★ D211+ Phase A 4번 (2026-05-23 Harold 명시): 흐름 다이어그램 시각화
import JourneyFlowDiagram from '../components/journey/JourneyFlowDiagram';
// ★ D218+ (2026-05-26): 활성화 자동 검증 + 정지 이력 + 담당자 알림 토글 신규
import JourneyActivationConfirmModal from '../components/journey/JourneyActivationConfirmModal';
import JourneyPauseLogsModal from '../components/journey/JourneyPauseLogsModal';
// 저장 여정 문안(본문·제목) 수정 — 초안·일시정지만(구조·일정 변경은 새 여정)
import JourneyMessageEditModal from '../components/journey/JourneyMessageEditModal';
// 고객 데이터 없으면 AI 문안 생성 전 안내 (공용 게이트)
import { useCustomerDataGate, CustomerDataRequiredBanner, CustomerDataRequiredModal } from '../components/CustomerDataGate';
import JourneyStepNotifyToggle from '../components/journey/JourneyStepNotifyToggle';
import AlimtalkChannelPanel, { type AlimtalkSenderProfile, type AlimtalkTemplate, type AlimtalkChannelState } from '../components/alimtalk/AlimtalkChannelPanel';
import InfoAlertJourneyBuilder, { type InfoAlertBuildResult } from '../components/journey/InfoAlertJourneyBuilder';
import { detectLiquidSyntax, renderLiquid, flattenCustomerForLiquid, SAMPLE_CUSTOMERS } from '../utils/liquid-templating';
// ★ D210+ Phase 2-fix6 (Harold 명시 2026-05-23): 변수 하이라이트 + 머지 미리보기 컨트롤타워.
import { highlightVars, mergeAndHighlightVars, mergeVarsPlain } from '../utils/highlightVars';
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';
import JourneyOptionsEditor from '../components/journey/JourneyOptionsEditor';
import { useToast } from '../components/ToastProvider';

// ★ D210+ Phase 2-fix6 (Harold 명시 2026-05-23): 여정 생성 6 sub-agent 진행 카드 매트릭스.
//   본질 = 옛 단순 로딩 → 6 sub-agent 시각 효과 → 사용자가 5~10초 기다리기 편함.
interface JourneySubAgentStep {
  icon: typeof Workflow;
  label: string;
  gradient: string;
  hint: string;
}
const JOURNEY_SUB_AGENT_STEPS: JourneySubAgentStep[] = [
  { icon: Workflow,      label: 'Trigger Detection',     gradient: 'from-rose-400 to-pink-500',     hint: '트리거 + 타겟 영역 자동 분석' },
  { icon: Sparkles,      label: 'Season Context',         gradient: 'from-amber-400 to-orange-500',  hint: '시즌 + 회사 톤 종합' },
  { icon: Brain,         label: 'Memory Learning',        gradient: 'from-emerald-400 to-teal-500',  hint: '회사 누적 학습 메모리 적용' },
  { icon: LayoutGrid,    label: 'Step Design',            gradient: 'from-cyan-400 to-blue-500',     hint: '단계 + 흐름 자동 설계' },
  { icon: MessageSquare, label: 'Message Composition',    gradient: 'from-violet-400 to-purple-500', hint: '본문 + 감성 풍성 작성' },
  { icon: CheckCircle2,  label: 'Review Ready',           gradient: 'from-fuchsia-400 to-pink-500',  hint: '검토 준비 완료' },
];

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
  paused_at: string | null;
  pause_reason: string | null;
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

// ★ D210+ Phase 3 (2026-05-23 Harold 명시): 다중 미리보기 영역 — preview-samples endpoint 응답 매트릭스
interface PreviewSample {
  label: string;
  customerId: string;
  sampleCustomer: Record<string, any>;
  sampleCustomerFields: Record<string, any>;
  modelVersion: string | null;
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

// ★ D188 Phase 2-B-1 (2026-05-21): step_type 3종 확장 — message/wait/condition.
type StepType = 'message' | 'wait' | 'condition';

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

type ConditionJsonb =
  | ConditionJsonbCustomerField
  | ConditionJsonbCdpEventExists
  | ConditionJsonbJourneyStepClicked;

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
}

interface RefineCandidate {
  message: string;
  tone: RefineTone;
  bytes: number;
  reasoning: string;
}

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
const STATUS_BADGE: Record<JourneyStatus, { label: string; cls: string }> = {
  draft:  { label: '초안',     cls: 'bg-violet-700/40 text-violet-100 border border-violet-400/30' },
  active: { label: '활성',     cls: 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/40' },
  paused: { label: '일시정지', cls: 'bg-amber-500/25 text-amber-200 border border-amber-400/40' },
  ended:  { label: '종료',     cls: 'bg-slate-700/50 text-white/60 border border-white/15' },
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
  return `${adPrefixFor(channel)}${message}\n${adRejectFor(channel, opt080)}`;
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

// D187-fix5: 이모지 + 비표준 특수문자 검출 (SMS/LMS 통신사 미지원 매트릭스)
function isInRange(code: number, ranges: Array<[number, number]>): boolean {
  for (const [s, e] of ranges) if (code >= s && code <= e) return true;
  return false;
}
const EMOJI_RANGES_FE: Array<[number, number]> = [
  [0x1F000, 0x1FFFF], [0x2600, 0x27BF], [0x2300, 0x23FF], [0x2B00, 0x2BFF], [0xFE00, 0xFE0F],
];
const UNSAFE_SPECIAL_FE = new Set<string>([
  '—', '–', '‐', '−',
  '・', '•', '⦁', '‣', '◦', '▪', '▫',
  '▶', '▷', '◀', '◁', '►', '◄', '➤', '➔', '➜', '➡',
  '※', '★', '☆', '✓', '✔', '✗', '✘', '◆', '◇', '■', '□', '●', '○',
  '«', '»', '〈', '〉', '《', '》', '「', '」', '『', '』', '“', '”', '‘', '’',
  '＆', '％', '＋', '＝', '？', '！', '：', '；', '，', '．', '＠', '＃', '＊',
]);
function detectUnsafe(text: string): { emoji: string[]; special: string[] } {
  const emoji: string[] = [];
  const special: string[] = [];
  for (const c of Array.from(text || '')) {
    const code = c.codePointAt(0) || 0;
    if (isInRange(code, EMOJI_RANGES_FE)) emoji.push(c);
    else if (UNSAFE_SPECIAL_FE.has(c)) special.push(c);
  }
  return { emoji: Array.from(new Set(emoji)), special: Array.from(new Set(special)) };
}

export default function JourneysPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [view, setView] = useState<'main' | 'review'>('main');
  const [journeys, setJourneys] = useState<JourneyRow[]>([]);
  const [callbackOptions, setCallbackOptions] = useState<CallbackOption[]>([]);
  const [opt080Number, setOpt080Number] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailsMap, setDetailsMap] = useState<Record<string, JourneyDetail>>({});
  // ★ D210+ Phase 3 (2026-05-23 Harold 명시): step별 funnel 통계 영역 (JourneyStepStat 활용)
  const [statsMap, setStatsMap] = useState<Record<string, JourneyStepStatFrontend[]>>({});
  // ★ D210+ Phase 3 (2026-05-23 Harold 명시): 다중 미리보기 영역 (preview-samples endpoint 활용)
  const [samplesMap, setSamplesMap] = useState<Record<string, PreviewSample[]>>({});
  const [samplesTotalMap, setSamplesTotalMap] = useState<Record<string, { total: number; capped: boolean }>>({});
  const [activeSampleLabel, setActiveSampleLabel] = useState<Record<string, string>>({});
  // ★ D211+ Phase 2 (2026-05-23 Harold 명시): step 진단 + next step 추천 영역
  const [diagnosisMap, setDiagnosisMap] = useState<Record<string, JourneyStepDiagnosis>>({});
  const [diagnosisLoading, setDiagnosisLoading] = useState<Record<string, boolean>>({});
  const [nextStepMap, setNextStepMap] = useState<Record<string, NextStepRecommendation>>({});
  const [nextStepLoading, setNextStepLoading] = useState<Record<string, boolean>>({});
  // ★ D211+ Phase 3 (2026-05-23 Harold 명시): status 필터 토글 (보관함 영역 분리)
  const [statusFilter, setStatusFilter] = useState<JourneyStatusFilter>('all');
  // ★ D211+ Phase 3-fix (2026-05-23 Harold 명시): archive/unarchive/delete 영역 커스텀 다크 톤 모달 (native confirm/prompt 폐기)
  const [actionModal, setActionModal] = useState<{ mode: JourneyActionMode; journeyId: string; journeyName: string } | null>(null);
  // ★ D218+ (2026-05-26): 활성화 자동 검증 모달 + 정지 이력 모달
  const [activationModal, setActivationModal] = useState<{ journeyId: string; journeyName: string; journeyStatus: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [pauseLogsModal, setPauseLogsModal] = useState<{ journeyId: string; journeyName: string } | null>(null);
  // 문안 수정 모달 — 초안·일시정지 여정만 (활성은 일시정지 후)
  const [editMessageModal, setEditMessageModal] = useState<{ journeyId: string; journeyName: string; journeyStatus: string } | null>(null);
  // ★ D211+ Phase A (2026-05-23 Harold 명시): 시뮬레이션 + 실시간 위치 영역
  const [simulationMap, setSimulationMap] = useState<Record<string, any>>({});
  const [simulationLoading, setSimulationLoading] = useState<Record<string, boolean>>({});
  const [livePositionsMap, setLivePositionsMap] = useState<Record<string, any>>({});

  // One-shot AI 생성 흐름
  const [objective, setObjective] = useState('');
  const [generating, setGenerating] = useState(false);
  // ★ D210+ Phase 2-fix6 (Harold 명시 2026-05-23): 6 sub-agent 진행 + 샘플 고객 머지 토글
  const [progressStep, setProgressStep] = useState(0);
  const [sampleCustomer, setSampleCustomer] = useState<Record<string, string | number | null> | null>(null);
  // ★ D210+ Phase 2-fix9 (Harold 명시 2026-05-23): Liquid 렌더링 영역 (field 키 매트릭스).
  const [sampleCustomerFields, setSampleCustomerFields] = useState<Record<string, any> | null>(null);
  // ★ D210+ Phase 2-fix10 (Harold 명시 2026-05-23): 옛 showMergedPreview state 폐기 — 토글 영역 X, 위/아래 영역 명확 분리.
  const [aiPkg, setAiPkg] = useState<AIJourneyPackage | null>(null);
  const [purpose, setPurpose] = useState<'marketing' | 'info-alert'>('marketing');
  const [reviewName, setReviewName] = useState('');
  const [reviewCallback, setReviewCallback] = useState('');
  const [reviewUseStorePhone, setReviewUseStorePhone] = useState(false);
  // ★ D189 #1 (2026-05-22): JourneyVariantsEditor 토글 — main view step별 A/B 테스트 편집 영역
  const [variantsExpandedStepIds, setVariantsExpandedStepIds] = useState<Set<string>>(new Set());
  // ★ D189 #2 (2026-05-22): 알림톡 채널 패널 데이터 — 회사 발신프로필 + 템플릿 + 활성 필드 (review view kakao step UI용)
  const [alimtalkSenders, setAlimtalkSenders] = useState<AlimtalkSenderProfile[]>([]);
  const [alimtalkTemplates, setAlimtalkTemplates] = useState<AlimtalkTemplate[]>([]);
  const [customerFields, setCustomerFields] = useState<Array<{ key: string; label: string }>>([]);
  // 자사몰(CDP) 연동 활성 여부 — 배송 등 custom 이벤트 트리거 잠금 해제용. install-status 기준(키 발급 or 이벤트 수신).
  const [hasMallIntegration, setHasMallIntegration] = useState(false);
  const [reviewBudget, setReviewBudget] = useState('');
  const [reviewThreshold, setReviewThreshold] = useState('');

  // step 수정
  const [previewSteps, setPreviewSteps] = useState<Set<number>>(new Set());
  const [refining, setRefining] = useState<{ stepIdx: number; candidates: RefineCandidate[] } | null>(null);
  const [refineLoading, setRefineLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // ★ D191 (2026-05-22) Phase B-1 Liquid Templating: 미리보기 모달 state
  const [previewSamples, setPreviewSamples] = useState<PreviewSample[]>([]);

  const token = () => localStorage.getItem('token');
  const customerGate = useCustomerDataGate(token());
  const [showDataGate, setShowDataGate] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      // ★ D211+ Phase 3 (2026-05-23 Harold 명시): statusFilter 영역 backend 전달 — archived 영역 분리
      const statusParam = statusFilter === 'all' ? 'all' : statusFilter;
      const [jr, cr] = await Promise.all([
        fetch(`/api/ai/operator/journeys?status=${statusParam}`, { headers: { Authorization: `Bearer ${token()}` } }),
        fetch('/api/ai/operator/journeys-callback-numbers', { headers: { Authorization: `Bearer ${token()}` } }),
      ]);
      const jd = await jr.json();
      const cd = await cr.json();
      if (jd.success) setJourneys(jd.journeys || []);
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

  // ★ D189 #2 (2026-05-22): 알림톡 발신프로필 + 템플릿 + 활성 필드 fetch (review view 알림톡 step UI용)
  useEffect(() => {
    const t = token();
    if (!t) return;
    Promise.all([
      fetch('/api/alimtalk/senders', { headers: { Authorization: `Bearer ${t}` } }).catch(() => null),
      fetch('/api/companies/kakao-templates?status=APPROVED', { headers: { Authorization: `Bearer ${t}` } }).catch(() => null),
      fetch('/api/customers/enabled-fields', { headers: { Authorization: `Bearer ${t}` } }).catch(() => null),
      fetch('/api/cdp/install-status', { headers: { Authorization: `Bearer ${t}` } }).catch(() => null),
    ]).then(async ([sndRes, tplRes, fldRes, cdpRes]) => {
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
        toast.warning(data.suggestion || '정합되는 알림톡 템플릿이 없습니다. 캠페인 의도에 맞는 템플릿을 추가 등록해주세요.');
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
        `AI 자동 매칭 완료 (정합 점수 ${data.matchScore})\n\n` +
        `템플릿: ${data.template.template_name}\n` +
        `근거: ${data.matchReason}\n\n` +
        `변수 자동 매핑: ${(data.variableMappings || []).length}건 (미매핑 ${unmappedCount}건 — 회사 admin 직접 입력 필요)\n\n` +
        `회사 admin 검토 + 정정 후 활성화해주세요.`
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

  const loadDetail = async (journeyId: string) => {
    if (detailsMap[journeyId]) return;
    try {
      const res = await fetch(`/api/ai/operator/journeys/${journeyId}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) {
        setDetailsMap((prev) => ({ ...prev, [journeyId]: { journey: data.journey, steps: data.steps } }));
      }
    } catch {}
  };

  // ★ D210+ Phase 3 (2026-05-23 Harold 명시): step별 funnel 통계 영역 fetch (buildJourneyStats 활용)
  const loadStats = async (journeyId: string) => {
    if (statsMap[journeyId]) return;
    try {
      const res = await fetch(`/api/ai/operator/journeys/${journeyId}/stats`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.steps)) {
        setStatsMap((prev) => ({ ...prev, [journeyId]: data.steps }));
      }
    } catch {}
  };

  // ★ D210+ Phase 3 (2026-05-23 Harold 명시): 다중 미리보기 6 영역 fetch (preview-samples endpoint 활용)
  const loadSamples = async (journeyId: string) => {
    if (samplesMap[journeyId]) return;
    try {
      const res = await fetch(`/api/ai/operator/journeys/${journeyId}/preview-samples`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.samples)) {
        setSamplesMap((prev) => ({ ...prev, [journeyId]: data.samples }));
        setSamplesTotalMap((prev) => ({ ...prev, [journeyId]: { total: Number(data.total) || 0, capped: !!data.capped } }));
        if (data.samples.length > 0 && !activeSampleLabel[journeyId]) {
          setActiveSampleLabel((prev) => ({ ...prev, [journeyId]: data.samples[0].label }));
        }
      }
    } catch {}
  };

  // ★ D211+ Phase 2 (2026-05-23 Harold 명시): step별 진단 fetch (buildJourneyStats + 분류 영역 자동)
  const loadDiagnosis = async (journeyId: string) => {
    if (diagnosisMap[journeyId] || diagnosisLoading[journeyId]) return;
    setDiagnosisLoading((prev) => ({ ...prev, [journeyId]: true }));
    try {
      const res = await fetch(`/api/ai/operator/journeys/${journeyId}/step-diagnosis`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success && data.diagnosis) {
        setDiagnosisMap((prev) => ({ ...prev, [journeyId]: data.diagnosis }));
      }
    } catch {}
    finally {
      setDiagnosisLoading((prev) => ({ ...prev, [journeyId]: false }));
    }
  };

  // ★ D211+ Phase A 1번 (2026-05-23 Harold 명시): 시뮬레이션 영역 — 회사 admin 1-click 호출 의무 (AI 호출 X / 단순 SQL 영역)
  const loadSimulation = async (journeyId: string) => {
    if (simulationLoading[journeyId]) return;
    setSimulationLoading((prev) => ({ ...prev, [journeyId]: true }));
    try {
      const res = await fetch(`/api/ai/operator/journeys/${journeyId}/simulate`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success && data.simulation) {
        setSimulationMap((prev) => ({ ...prev, [journeyId]: data.simulation }));
      }
    } catch {}
    finally {
      setSimulationLoading((prev) => ({ ...prev, [journeyId]: false }));
    }
  };

  // ★ D211+ Phase A 2번 (2026-05-23 Harold 명시): 실시간 위치 영역 — expand 시 자동 fetch (단순 SQL)
  const loadLivePositions = async (journeyId: string) => {
    if (livePositionsMap[journeyId]) return;
    try {
      const res = await fetch(`/api/ai/operator/journeys/${journeyId}/live-positions`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success && data.snapshot) {
        setLivePositionsMap((prev) => ({ ...prev, [journeyId]: data.snapshot }));
      }
    } catch {}
  };

  // ★ D211+ Phase 2 (2026-05-23 Harold 명시): 다음 단계 추천 fetch (AI 호출 비용 영역 — 회사 admin 1-click 호출 의무)
  const loadNextStep = async (journeyId: string) => {
    if (nextStepLoading[journeyId]) return;
    setNextStepLoading((prev) => ({ ...prev, [journeyId]: true }));
    try {
      const res = await fetch(`/api/ai/operator/journeys/${journeyId}/recommend-next-step`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success && data.recommendation) {
        setNextStepMap((prev) => ({ ...prev, [journeyId]: data.recommendation }));
      }
    } catch {}
    finally {
      setNextStepLoading((prev) => ({ ...prev, [journeyId]: false }));
    }
  };

  const toggleExpand = (journeyId: string) => {
    if (expandedId === journeyId) setExpandedId(null);
    else {
      setExpandedId(journeyId);
      loadDetail(journeyId);
      // ★ D210+ Phase 3 (2026-05-23 Harold 명시): expand 시 stats + samples 영역 함께 fetch
      loadStats(journeyId);
      loadSamples(journeyId);
      // ★ D211+ Phase 2 (2026-05-23 Harold 명시): expand 시 step별 진단 자동 fetch (AI 호출 X — DB 영역 빠른 영역)
      loadDiagnosis(journeyId);
      // ★ D211+ Phase A 2번 (2026-05-23 Harold 명시): expand 시 실시간 위치 자동 fetch (DB 영역 빠른 영역)
      loadLivePositions(journeyId);
    }
  };

  // ════════ One-shot AI 생성 ════════
  const handleAIGenerate = async (templateHint?: TemplateCode) => {
    if (customerGate.isEmpty) { setShowDataGate(true); return; }
    if (!templateHint && objective.trim().length < 3) {
      toast.warning('여정 목표를 자연어로 입력하거나 빠른 시작 카드를 선택해주세요.');
      return;
    }
    setGenerating(true);
    setProgressStep(0);
    setError(null);
    try {
      const res = await fetch('/api/ai/operator/journeys-ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          objective: templateHint ? undefined : objective.trim(),
          templateHint,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const pkg: AIJourneyPackage = data.package;
        setAiPkg(pkg);
        setReviewName(pkg.name);
        setReviewCallback(pkg.callbackNumberHint || callbackOptions.find((c) => c.is_default)?.phone || (callbackOptions[0]?.phone || ''));
        setReviewBudget(pkg.budgetMonthlyHint != null ? String(pkg.budgetMonthlyHint) : '');
        setReviewThreshold(pkg.thresholdCostHint != null ? String(pkg.thresholdCostHint) : '');
        // ★ D210+ Phase 2-fix7 (Harold 명시 2026-05-23): AI 응답 후 진행 시각 확보 영역.
        //   옛 사고 = 즉시 setView('review') + finally setGenerating(false) → 진행 시각 X.
        //   정정 = 1.5초 후 마지막 단계 완료 표시 → 2.2초 await 후 화면 전환 (사용자 자연 시각 흐름).
        setTimeout(() => {
          setProgressStep(JOURNEY_SUB_AGENT_STEPS.length);
        }, 1500);
        await new Promise((resolve) => setTimeout(resolve, 3700));
        setView('review');

        // 여정 trigger 기준 미리보기 고객 1건 fetch — 발송과 동일 기준(신규가입 등)으로 추출.
        fetch('/api/ai/operator/sample-customer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
          body: JSON.stringify({ triggerEvent: pkg.triggerEvent, triggerFilters: pkg.triggerFilters || {} }),
        })
          .then((sr) => sr.json())
          .then((sd) => {
            if (sd?.success && sd.sampleCustomer) {
              setSampleCustomer(sd.sampleCustomer);
              setSampleCustomerFields(sd.sampleCustomerFields || null);
            } else {
              setSampleCustomer(null);
              setSampleCustomerFields(null);
            }
          })
          .catch(() => {
            setSampleCustomer(null);
            setSampleCustomerFields(null);
          });

        // 10명 미리보기 모달용 실제 타겟 샘플 (trigger 기준, preview-target-samples)
        fetch('/api/ai/operator/preview-target-samples', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
          body: JSON.stringify({ triggerEvent: pkg.triggerEvent, triggerFilters: pkg.triggerFilters || {} }),
        })
          .then((sr) => sr.json())
          .then((sd) => {
            setPreviewSamples(sd?.success && Array.isArray(sd.samples) ? sd.samples : []);
          })
          .catch(() => setPreviewSamples([]));
      } else {
        toast.error(data.error || 'AI 생성 실패. 다시 시도해주세요.');
      }
    } catch (e: any) {
      toast.error(e?.message || '생성 중 오류');
    } finally {
      setGenerating(false);
    }
  };

  // ★ D210+ Phase 2-fix6 (Harold 명시 2026-05-23): generating 영역 시 sub-agent 단계 자동 진행 (1.5초 주기)
  useEffect(() => {
    if (!generating) return;
    if (progressStep >= JOURNEY_SUB_AGENT_STEPS.length) return;
    const timer = setTimeout(() => {
      setProgressStep((s) => Math.min(s + 1, JOURNEY_SUB_AGENT_STEPS.length));
    }, 1500);
    return () => clearTimeout(timer);
  }, [generating, progressStep]);

  const handleRegenerate = () => {
    if (!aiPkg) return;
    setConfirm({
      mode: 'warning',
      title: '여정 다시 생성',
      description: '현재 생성된 여정을 폐기하고 다시 생성하시겠습니까? 수정한 내용은 사라집니다.',
      confirmLabel: '다시 생성',
      onConfirm: () => {
        void handleAIGenerate(aiPkg.templateCode === 'custom' && objective ? undefined : aiPkg.templateCode);
      },
    });
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
      },
    });
  };

  const addStep = () => {
    if (!aiPkg) return;
    // ★ D188 Phase 2-B-1 (2026-05-21): 최대 step 5개 → 7개 확장 (wait/condition 추가 영역 확보).
    if (aiPkg.steps.length >= 7) { toast.warning('최대 7개 step까지 가능합니다.'); return; }
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

  const handleRefineOpen = async (idx: number) => {
    if (!aiPkg) return;
    const step = aiPkg.steps[idx];
    if (step.messageTemplate.trim().length < 10) {
      toast.warning('메시지를 10자 이상 작성한 후 다듬기를 사용해주세요.');
      return;
    }
    setRefineLoading(true);
    try {
      const res = await fetch('/api/ai/operator/journeys-refine-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          message: step.messageTemplate,
          channel: step.channel,
          isAd: step.isAd,
          stepIntent: step.stepIntent,
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
    const pkg: AIJourneyPackage = {
      name: result.name,
      templateCode: result.templateCode,
      triggerEvent: result.triggerEvent,
      triggerFilters: {},
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
      allowReentry: true,
      reentryCooldownDays: 0,
      callbackNumberHint: null,
      budgetMonthlyHint: null,
      thresholdCostHint: null,
      reasoning: '정보 알림 — 거래 이벤트 트리거 + 카카오 승인 템플릿',
    };
    setAiPkg(pkg);
    setPurpose('marketing');
    setView('review');
  };

  const handleSaveDraft = async () => {
    if (!aiPkg) return;
    if (!reviewCallback) { toast.warning('회신번호를 선택해주세요.'); return; }
    // ★ D188 Phase 2-B-1 (2026-05-21): step_type별 다른 검증 분기.
    //   message = 본문 + subject 검증 / wait = delay_hours>0 / condition = conditionJsonb 정합.
    const validOps = ['==', '!=', '>=', '<=', '>', '<', 'in', 'not_in', 'is_null', 'not_null'];
    for (const s of aiPkg.steps) {
      if (s.stepType === 'wait') {
        if (Number(s.delayHours) <= 0) {
          toast.warning(`step ${s.stepOrder} (wait) 대기 시간이 0 이하입니다. 1시간 이상 설정해주세요.`);
          return;
        }
        continue;
      }
      if (s.stepType === 'condition') {
        const c = s.conditionJsonb;
        if (!c || c.type !== 'customer_field' || !c.field || !c.field.trim()) {
          toast.warning(`step ${s.stepOrder} (condition) 조건 필드를 선택해주세요.`);
          return;
        }
        if (!validOps.includes(c.operator)) {
          toast.warning(`step ${s.stepOrder} (condition) 연산자를 선택해주세요.`);
          return;
        }
        if (!['is_null', 'not_null'].includes(c.operator) && (c.value === undefined || c.value === null || c.value === '')) {
          toast.warning(`step ${s.stepOrder} (condition) 비교값을 입력해주세요.`);
          return;
        }
        continue;
      }
      // message step = 본문 + subject 검증
      if (!s.messageTemplate.trim() || s.messageTemplate.trim().length < 10) {
        toast.warning(`step ${s.stepOrder} 본문이 비어있거나 너무 짧습니다.`);
        return;
      }
      if ((s.channel === 'lms' || s.channel === 'mms') && (!s.subject || !s.subject.trim())) {
        toast.warning(`step ${s.stepOrder} LMS/MMS 제목이 비어있습니다.`);
        return;
      }
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
      };
      const res = await fetch('/api/ai/operator/journeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setAiPkg(null);
        setObjective('');
        setView('main');
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
    if (action === 'activate') {
      setActivationModal({ journeyId, journeyName, journeyStatus: journey?.status || 'draft' });
      return;
    }

    // pause/end = 커스텀 모달(JourneyActionConfirmModal) 통합 — native confirm 폐기.
    if (action === 'pause' || action === 'end') {
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
        if (mode === 'delete' && expandedId === journeyId) setExpandedId(null);
        setActionModal(null);
        await loadAll();
      } else {
        toast.error(data.error || '처리 실패');
      }
    } catch (e: any) {
      toast.error(e?.message || '처리 중 오류');
    }
  };

  // ★ D210+ Phase 3 (2026-05-23 Harold 명시): 자동 재진입 토글 (회사 admin 명시 활성 — feedback_no_target_auto_relax 정합)
  //   activate 시 강력 안내 모달 의무 — 회사 admin 책임 영역 명시 + cooldown 영역 안내
  const handleToggleAutoReentry = (journeyId: string, currentEnabled: boolean, cooldownDays: number | null) => {
    const newEnabled = !currentEnabled;
    const doToggle = async () => {
      try {
        const res = await fetch(`/api/ai/operator/journeys/${journeyId}/auto-reentry`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
          body: JSON.stringify({ enabled: newEnabled }),
        });
        const data = await res.json();
        if (data.success) await loadAll();
        else toast.error(data.error || '자동 재진입 토글 실패');
      } catch (e: any) {
        toast.error(e?.message || '자동 재진입 토글 중 오류');
      }
    };
    if (newEnabled) {
      setConfirm({
        mode: 'warning',
        title: '자동 재진입 활성화',
        description:
          `여정을 완료한 고객이 cooldown(${cooldownDays ?? 0}일) 경과 후 자동으로 다시 진입합니다. 6시간 주기로 자동 진입합니다.\n\n` +
          `· 활성 상태 + 광고 수신 동의 고객만 진입\n` +
          `· 한 고객당 진행 중 1건만 — 중복 진입 차단\n` +
          `· 비용·발송은 회사 담당자 책임이므로 직접 확인이 필요합니다.`,
        confirmLabel: '활성화',
        onConfirm: doToggle,
      });
    } else {
      setConfirm({
        mode: 'warning',
        title: '자동 재진입 비활성화',
        description: '자동 재진입을 비활성화하시겠습니까? 이미 진입해 진행 중인 건에는 영향이 없습니다.',
        confirmLabel: '비활성화',
        onConfirm: doToggle,
      });
    }
  };

  return (
    // ★ D222+ Phase 1 (2026-05-27): 다크 톤 → 보라 그라데이션 톤 다운 + 시인성 강화 (text-white/50 → /80, /40 → /55)
    <div className="min-h-screen bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900 text-white">
      {/* 헤더 — D222+ Phase 1: 보라 톤 다운 sticky */}
      <div className="border-b border-violet-400/30 bg-violet-800/50 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-3 md:px-6 py-3 md:py-4 flex items-center gap-2 md:gap-4">
          <button
            onClick={() => view === 'review' ? setConfirm({ mode: 'warning', title: '메인으로 돌아가기', description: '생성한 여정이 사라집니다. 메인으로 돌아가시겠습니까?', confirmLabel: '나가기', onConfirm: () => { setView('main'); setAiPkg(null); } }) : navigate('/ai-operator')}
            className="p-2 rounded-lg hover:bg-white/15 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg md:text-2xl font-bold truncate text-white">
              {view === 'review' ? 'AI 생성 여정 검토' : '여정 자동화 — AI Operator'}
            </h1>
            <p className="text-xs md:text-sm text-white/80 mt-0.5">
              {view === 'review' ? 'AI가 설계한 흐름을 검토 + 혜택 부분 수정 후 활성화' : '자연어 한 줄 또는 빠른 시작 — AI가 시즌·회사 톤 반영해 완전 자동 생성'}
            </p>
          </div>
          {view === 'main' && (
            <button onClick={loadAll} disabled={loading} className="p-2 rounded-lg hover:bg-white/15 transition-colors disabled:opacity-50">
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-3 md:px-6 py-4 md:py-8">
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-200 text-sm">{error}</div>
        )}

        {callbackOptions.length === 0 && !loading && view === 'main' && (
          <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-200 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>회사에 등록된 발신번호가 없습니다. 여정 활성화 전 발신번호를 먼저 등록해주세요.</div>
          </div>
        )}

        {/* ════════════════════════════════════════
            MAIN VIEW — 자연어 입력 + 빠른 시작 + 활성 목록
            ════════════════════════════════════════ */}
        {view === 'main' && (
          <>
            {/* ★ 2026-06-22: 목적 선택 — 마케팅 여정(광고성 문자) vs 정보 알림(알림톡 거래통지) */}
            <div className="grid grid-cols-2 gap-2 mb-4 md:mb-6">
              <button
                onClick={() => setPurpose('marketing')}
                className={`p-4 rounded-xl border text-left transition-colors ${purpose === 'marketing' ? 'bg-fuchsia-500/15 border-fuchsia-400/50' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
              >
                <div className="text-sm font-semibold">마케팅 여정</div>
                <div className="text-[11px] text-white/50 mt-0.5">광고성 · 문자/LMS · AI가 카피 자동 생성</div>
              </button>
              <button
                onClick={() => setPurpose('info-alert')}
                className={`p-4 rounded-xl border text-left transition-colors ${purpose === 'info-alert' ? 'bg-teal-500/15 border-teal-400/50' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
              >
                <div className="text-sm font-semibold">정보 알림</div>
                <div className="text-[11px] text-white/50 mt-0.5">정보성 · 알림톡 · 거래 발생 시 승인 템플릿 발송</div>
              </button>
            </div>

            {purpose === 'info-alert' ? (
              <InfoAlertJourneyBuilder
                senders={alimtalkSenders}
                templates={alimtalkTemplates}
                customerFieldOptions={customerFields}
                hasMallIntegration={hasMallIntegration}
                onBuild={handleInfoAlertBuild}
                onBack={() => setPurpose('marketing')}
              />
            ) : (
            <>
            {customerGate.isEmpty && <CustomerDataRequiredBanner className="mb-4 md:mb-6" />}
            {/* 자연어 입력 */}
            <div className="bg-gradient-to-br from-fuchsia-500/10 via-purple-500/10 to-indigo-500/10 border border-fuchsia-500/30 rounded-xl p-4 md:p-6 mb-4 md:mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-5 h-5 text-fuchsia-300" />
                <h2 className="text-base md:text-lg font-semibold">자연어 한 줄로 여정 만들기</h2>
              </div>
              <p className="text-xs md:text-sm text-white/60 mb-3">
                AI가 시즌 + 회사 톤 + 학습 메모리를 종합해 완전한 여정을 자동 설계합니다. 검토 후 혜택 부분만 수정하시면 됩니다.
              </p>
              <div className="flex flex-col md:flex-row gap-2">
                <input
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  placeholder="예: 신규 가입자 환영 7일 시리즈 / VIP 고객 분기 감사 / 휴면 30일 회수 / 신상품 출시 3단계 안내"
                  className="flex-1 px-4 py-3 bg-slate-900 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-fuchsia-400"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !generating) handleAIGenerate(); }}
                  disabled={generating}
                />
                <button
                  onClick={() => handleAIGenerate()}
                  disabled={generating || objective.trim().length < 3}
                  className="px-5 py-3 bg-gradient-to-r from-fuchsia-500 to-purple-500 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  AI 생성
                </button>
              </div>
            </div>

            {/* 빠른 시작 카드 */}
            <div className="mb-4 md:mb-6">
              <h3 className="text-sm font-semibold text-white/80 mb-2">또는 빠른 시작</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
                {(Object.keys(TEMPLATE_VISUAL) as TemplateCode[]).map((code) => {
                  const v = TEMPLATE_VISUAL[code];
                  const Icon = v.icon;
                  return (
                    <button
                      key={code}
                      onClick={() => handleAIGenerate(code)}
                      disabled={generating}
                      className="p-3 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 hover:border-white/20 transition-colors disabled:opacity-50 text-left"
                    >
                      <div className={`w-7 h-7 rounded-md bg-gradient-to-br ${v.gradient} flex items-center justify-center mb-2`}>
                        <Icon className="w-4 h-4 text-white" />
                      </div>
                      <div className="text-xs font-medium">{v.label}</div>
                      <div className="text-[10px] text-white/40 mt-0.5">{v.hint}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            </>
            )}

            {/* ★ D211+ Phase 3 (2026-05-23 Harold 명시): 여정 목록 + status 필터 토글 (보관함 영역 분리) */}
            <div>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <h3 className="text-sm font-semibold text-white/80">
                  {statusFilter === 'archived' ? '보관함' : '여정 목록'} ({journeys.length})
                </h3>
                <div className="flex items-center gap-1 flex-wrap">
                  {([
                    { key: 'all', label: '전체' },
                    { key: 'active', label: '활성' },
                    { key: 'paused', label: '일시정지' },
                    { key: 'ended', label: '종료' },
                    { key: 'archived', label: '보관함' },
                  ] as Array<{ key: JourneyStatusFilter; label: string }>).map((f) => (
                    <button
                      key={f.key}
                      onClick={() => setStatusFilter(f.key)}
                      className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                        statusFilter === f.key
                          ? 'bg-violet-500/30 text-violet-100 border border-violet-400/50'
                          : 'bg-white/5 hover:bg-white/10 text-white/60 border border-white/10'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-white/40" />
                </div>
              )}
              {!loading && journeys.length === 0 && (
                <div className="p-8 bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-indigo-500/10 border border-violet-400/20 rounded-xl">
                  <div className="text-center mb-6">
                    <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center shadow-lg">
                      <Sparkles className="w-7 h-7 text-white" />
                    </div>
                    <h4 className="text-base font-semibold text-white mb-1">첫 여정을 만들어보세요</h4>
                    <p className="text-xs text-white/60">자연어 한 줄이면 AI가 완전한 여정을 자동 설계합니다 (5~10초)</p>
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
                            setObjective(ex.objective);
                            // 자연어 입력 영역으로 스크롤
                            setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50);
                          }}
                          className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-violet-400/30 rounded-lg text-left flex items-center gap-2 transition-all"
                        >
                          <ExIcon className="w-4 h-4 text-violet-300 flex-shrink-0" />
                          <span className="text-white/80 truncate">{ex.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-white/40 text-center mt-4">
                    또는 위 자연어 입력란에 직접 작성 — 회사 admin이 원하는 모든 시나리오 가능
                  </p>
                </div>
              )}
              <div className="space-y-2">
                {journeys.map((j) => {
                  const visual = TEMPLATE_VISUAL[j.template_code] || TEMPLATE_VISUAL.custom;
                  const Icon = visual.icon;
                  const badge = STATUS_BADGE[j.status];
                  const isExpanded = expandedId === j.id;
                  const detail = detailsMap[j.id];
                  return (
                    <div key={j.id} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                      <div className="p-3 cursor-pointer hover:bg-white/[0.07]" onClick={() => toggleExpand(j.id)}>
                        <div className="flex items-start gap-3">
                          <div className={`shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br ${visual.gradient} flex items-center justify-center`}>
                            <Icon className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <h3 className="text-sm font-semibold truncate">{j.name}</h3>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${badge.cls}`}>{badge.label}</span>
                            </div>
                            <div className="text-xs text-white/50 flex flex-wrap gap-x-3 gap-y-0.5">
                              <span className="flex items-center gap-1"><Users className="w-3 h-3" />{j.stats_total_entered}</span>
                              <span className="flex items-center gap-1"><Sparkles className="w-3 h-3" />{j.stats_total_completed}</span>
                              <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />{Number(j.stats_total_cost).toLocaleString()}원</span>
                              {j.callback_number && <span className="flex items-center gap-1 text-cyan-300/80"><Phone className="w-3 h-3" />{j.callback_number}</span>}
                            </div>
                            {j.pause_reason && j.status === 'paused' && (
                              <div className="mt-1.5 text-xs text-amber-200/90 bg-amber-500/10 px-2 py-1 rounded">{j.pause_reason}</div>
                            )}
                          </div>
                          <div className="shrink-0 flex items-center gap-1">
                            {/* ★ D192 (2026-05-22): Journey 상세 + 통계 진입 — 모든 상태 진입 가능 */}
                            <button onClick={(e) => { e.stopPropagation(); navigate(`/ai-journeys/${j.id}`); }} className="p-2 rounded bg-blue-500/20 hover:bg-blue-500/30 text-blue-300" title="진입 사용자 매트릭스">
                              <Users className="w-4 h-4" />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); navigate(`/ai-journeys/${j.id}/stats`); }} className="p-2 rounded bg-violet-500/20 hover:bg-violet-500/30 text-violet-300" title="통계 분석">
                              <BarChart3 className="w-4 h-4" />
                            </button>
                            {/* 문안 수정 — 초안·일시정지만(활성은 일시정지 후 / 일정·구조 변경은 새 여정) */}
                            {!j.archived_at && (j.status === 'draft' || j.status === 'paused') && (
                              <button onClick={(e) => { e.stopPropagation(); setEditMessageModal({ journeyId: j.id, journeyName: j.name, journeyStatus: j.status }); }} className="p-2 rounded bg-purple-500/20 hover:bg-purple-500/30 text-purple-300" title="문안 수정">
                                <Edit2 className="w-4 h-4" />
                              </button>
                            )}
                            {/* ★ D218+ (2026-05-26): 정지 이력 영구 기록 진입 — 담당자 단축 URL 정지 + 자동 정지 통합 표시 */}
                            <button onClick={(e) => { e.stopPropagation(); setPauseLogsModal({ journeyId: j.id, journeyName: j.name }); }} className="p-2 rounded bg-fuchsia-500/20 hover:bg-fuchsia-500/30 text-fuchsia-300" title="정지 이력 영구 기록">
                              <AlertTriangle className="w-4 h-4" />
                            </button>
                            {/* ★ D211+ Phase 3 (2026-05-23 Harold 명시): archived 영역 안 unarchive 영역 진입 + 그 외 영역 옛 매트릭스 정합 */}
                            {!j.archived_at && (j.status === 'draft' || j.status === 'paused') && (
                              <button onClick={(e) => { e.stopPropagation(); handleAction(j.id, 'activate'); }} className="p-2 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300" title="활성화">
                                <Play className="w-4 h-4" />
                              </button>
                            )}
                            {!j.archived_at && j.status === 'active' && (
                              <button onClick={(e) => { e.stopPropagation(); handleAction(j.id, 'pause'); }} className="p-2 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300" title="일시정지">
                                <Pause className="w-4 h-4" />
                              </button>
                            )}
                            {!j.archived_at && j.status !== 'ended' && (
                              <button onClick={(e) => { e.stopPropagation(); handleAction(j.id, 'end'); }} className="p-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-300" title="종료">
                                <Power className="w-4 h-4" />
                              </button>
                            )}
                            {/* ★ D211+ Phase 3 (2026-05-23 Harold 명시): 보관함 이동 — active 영역 차단 (먼저 일시정지/종료 의무) */}
                            {!j.archived_at && j.status !== 'active' && (
                              <button onClick={(e) => { e.stopPropagation(); handleAction(j.id, 'archive'); }} className="p-2 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300" title="보관함으로 이동">
                                <Archive className="w-4 h-4" />
                              </button>
                            )}
                            {/* ★ D211+ Phase 3 (2026-05-23 Harold 명시): 보관함 복원 — archived 영역만 */}
                            {j.archived_at && (
                              <button onClick={(e) => { e.stopPropagation(); handleAction(j.id, 'unarchive'); }} className="p-2 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300" title="보관함에서 복원">
                                <ArchiveRestore className="w-4 h-4" />
                              </button>
                            )}
                            {/* ★ D211+ Phase 3 (2026-05-23 Harold 명시): 영구 삭제 — active 영역 차단 + 2차 confirm "삭제" 단어 입력 의무 */}
                            {j.status !== 'active' && (
                              <button onClick={(e) => { e.stopPropagation(); handleAction(j.id, 'delete'); }} className="p-2 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300" title="영구 삭제 (복구 불가)">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
                          </div>
                        </div>
                      </div>
                      {isExpanded && detail && (
                        <div className="border-t border-white/10 p-3 bg-slate-950/40 space-y-2">
                          {/* ★ D211+ Phase A 4번 (2026-05-23 Harold 명시): 흐름 다이어그램 (step 흐름 + funnel + 실시간 위치 통합 시각화) */}
                          <JourneyFlowDiagram
                            steps={detail.steps}
                            funnelStats={statsMap[j.id]?.map((s) => ({
                              stepId: s.stepId,
                              funnelPercentage: s.funnelPercentage,
                              enteredCount: s.enteredCount,
                              sentCount: s.sentCount,
                              clickCount: s.clickCount,
                            }))}
                            livePositions={livePositionsMap[j.id]?.positions?.map((p: any) => ({
                              stepId: p.stepId,
                              activeCount: p.activeCount,
                              avgDwellMinutes: p.avgDwellMinutes,
                            }))}
                          />

                          {/* ★ D211+ Phase A 1번 (2026-05-23 Harold 명시): 시뮬레이션 카드 (draft/paused 영역 — 활성화 직전 안심 본질) */}
                          {(j.status === 'draft' || j.status === 'paused') && (
                            <div className="p-3 bg-emerald-500/5 border border-emerald-400/30 rounded-lg space-y-2">
                              <div className="flex items-center gap-2">
                                <TrendingUp className="w-4 h-4 text-emerald-300" />
                                <span className="text-sm font-semibold text-emerald-100">활성화 직전 시뮬레이션</span>
                              </div>
                              {!simulationMap[j.id] ? (
                                <div>
                                  <p className="text-[11px] text-white/60 leading-relaxed mb-2">
                                    트리거 매칭 고객 + 예상 발송 건수 + 예상 비용을 활성화 전에 미리 확인합니다 (실제 발송 안 함).
                                  </p>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); loadSimulation(j.id); }}
                                    disabled={simulationLoading[j.id]}
                                    className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-50 text-emerald-100 rounded text-xs flex items-center gap-1.5"
                                  >
                                    {simulationLoading[j.id] ? (
                                      <><Loader2 className="w-3 h-3 animate-spin" /> 분석 중</>
                                    ) : (
                                      <><TrendingUp className="w-3 h-3" /> 시뮬레이션 실행</>
                                    )}
                                  </button>
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  {/* 매칭 customer + 등급 분포 */}
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="p-2 bg-white/5 rounded">
                                      <div className="text-[10px] text-white/40">트리거 매칭</div>
                                      <div className="text-base font-semibold text-emerald-200 font-mono">{simulationMap[j.id].matchedCustomers.toLocaleString()}명{simulationMap[j.id].capped ? ' 이상' : ''}</div>
                                    </div>
                                    <div className="p-2 bg-white/5 rounded">
                                      <div className="text-[10px] text-white/40">총 예상 발송</div>
                                      <div className="text-base font-semibold text-violet-200 font-mono">{simulationMap[j.id].totalEstimatedSends.toLocaleString()}건</div>
                                    </div>
                                    <div className="p-2 bg-white/5 rounded">
                                      <div className="text-[10px] text-white/40">예상 비용</div>
                                      <div className="text-base font-semibold text-amber-200 font-mono">{simulationMap[j.id].totalEstimatedCost.toLocaleString()}원</div>
                                    </div>
                                    <div className="p-2 bg-white/5 rounded">
                                      <div className="text-[10px] text-white/40">예상 매출</div>
                                      <div className="text-base font-semibold text-cyan-200 font-mono">{simulationMap[j.id].estimatedRevenue != null ? `${simulationMap[j.id].estimatedRevenue.toLocaleString()}원` : '데이터 부족'}</div>
                                    </div>
                                  </div>
                                  {/* 등급 분포 */}
                                  {simulationMap[j.id].customerSegments?.length > 0 && (
                                    <div className="space-y-1">
                                      <div className="text-[10px] text-white/40">등급 분포</div>
                                      {simulationMap[j.id].customerSegments.slice(0, 5).map((seg: any) => (
                                        <div key={seg.segment} className="flex items-center gap-2">
                                          <div className="text-[10px] text-white/60 w-12">{seg.segment}</div>
                                          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                            <div className="h-full bg-emerald-400" style={{ width: `${seg.pct * 100}%` }} />
                                          </div>
                                          <div className="text-[10px] text-white/60 font-mono w-20 text-right">
                                            {seg.count.toLocaleString()}명 ({(seg.pct * 100).toFixed(0)}%)
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {/* 예상 클릭률 + 전환율 */}
                                  <div className="text-[11px] text-white/70 leading-relaxed">
                                    {simulationMap[j.id].reasoning}
                                  </div>
                                  <div className="flex items-center gap-3 text-[10px] text-white/50">
                                    <span><MousePointerClick className="w-2.5 h-2.5 inline text-cyan-300" /> 예상 클릭률 {simulationMap[j.id].estimatedClickRate != null ? `${(simulationMap[j.id].estimatedClickRate * 100).toFixed(1)}%` : '데이터 부족'}</span>
                                    <span><TrendingUp className="w-2.5 h-2.5 inline text-emerald-300" /> 예상 전환율 {simulationMap[j.id].estimatedConversionRate != null ? `${(simulationMap[j.id].estimatedConversionRate * 100).toFixed(1)}%` : '데이터 부족'}</span>
                                  </div>
                                  {/* 경고 영역 */}
                                  {simulationMap[j.id].warnings?.length > 0 && (
                                    <div className="space-y-1">
                                      {simulationMap[j.id].warnings.map((w: string, idx: number) => (
                                        <div key={idx} className="flex items-start gap-1.5 text-[10px] text-amber-200/80">
                                          <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0 mt-0.5" />
                                          <span>{w}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Phase 9: 여정 옵션 편집 (트리거 타이밍·포인트·한도·예산·재진입) — 표시 전용 → 편집 가능 */}
                          {detail.journey && (
                            <JourneyOptionsEditor journey={detail.journey} token={token() || ''} onSaved={loadAll} />
                          )}

                          {/* ★ D211+ Phase A 2번 (2026-05-23 Harold 명시): 실시간 진행 위치 요약 (active 여정 영역만) */}
                          {j.status === 'active' && livePositionsMap[j.id] && livePositionsMap[j.id].totalActive > 0 && (
                            <div className="p-3 bg-cyan-500/5 border border-cyan-400/30 rounded-lg">
                              <div className="flex items-center gap-2 mb-1">
                                <Users className="w-4 h-4 text-cyan-300" />
                                <span className="text-sm font-semibold text-cyan-100">실시간 진행 위치</span>
                                <span className="ml-auto text-[10px] text-white/40">
                                  현재 {livePositionsMap[j.id].totalActive.toLocaleString()}명 / 24h 완료 {livePositionsMap[j.id].totalCompleted24h.toLocaleString()}명
                                </span>
                              </div>
                              {livePositionsMap[j.id].nextRunAt && (
                                <div className="text-[11px] text-cyan-200/80">
                                  다음 발송 예정 — {new Date(livePositionsMap[j.id].nextRunAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                                </div>
                              )}
                            </div>
                          )}

                          {/* ★ D210+ Phase 3 (2026-05-23 Harold 명시): funnel 시각화 영역 (JourneyStepStat funnelPercentage + 이탈 사유 5 영역) */}
                          {statsMap[j.id] && statsMap[j.id].length > 0 && statsMap[j.id].some((st) => st.enteredCount > 0) && (
                            <div className="p-3 bg-violet-500/5 border border-violet-400/30 rounded-lg space-y-2">
                              <div className="flex items-center gap-2 mb-1">
                                <Activity className="w-4 h-4 text-violet-300" />
                                <span className="text-sm font-semibold text-violet-100">Step funnel 시각화</span>
                                <span className="text-[10px] text-white/40 ml-auto">journey_step_logs 영역 source</span>
                              </div>
                              {statsMap[j.id].map((st) => (
                                <div key={st.stepId} className="space-y-1">
                                  <div className="flex items-center gap-2 text-[11px]">
                                    <span className="font-mono text-white/60 w-12">Step {st.stepOrder}</span>
                                    <span className="text-white/40">{st.stepType}{st.channel ? ` · ${st.channel.toUpperCase()}` : ''}</span>
                                    <span className="ml-auto text-white/70 font-mono">{st.enteredCount.toLocaleString()}명 ({st.funnelPercentage.toFixed(1)}%)</span>
                                  </div>
                                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full ${st.funnelPercentage > 50 ? 'bg-emerald-400' : st.funnelPercentage > 20 ? 'bg-amber-400' : 'bg-rose-400'}`}
                                      style={{ width: `${Math.min(100, Math.max(2, st.funnelPercentage))}%` }}
                                    />
                                  </div>
                                  {(st.skippedHoursCount > 0 || st.skippedOptOutCount > 0 || st.skippedNoCustomerCount > 0 || st.conditionFailedCount > 0 || st.waitedCount > 0) && (
                                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-white/40 pl-12">
                                      {st.waitedCount > 0 && <span><Clock className="w-2.5 h-2.5 inline" /> 대기 {st.waitedCount}</span>}
                                      {st.skippedHoursCount > 0 && <span><Clock className="w-2.5 h-2.5 inline text-amber-300/70" /> 시간대 {st.skippedHoursCount}</span>}
                                      {st.skippedOptOutCount > 0 && <span><AlertTriangle className="w-2.5 h-2.5 inline text-rose-300/70" /> opt-out {st.skippedOptOutCount}</span>}
                                      {st.skippedNoCustomerCount > 0 && <span><Users className="w-2.5 h-2.5 inline text-rose-300/70" /> 고객 X {st.skippedNoCustomerCount}</span>}
                                      {st.conditionFailedCount > 0 && <span><FilterIcon className="w-2.5 h-2.5 inline text-rose-300/70" /> 조건 미충족 {st.conditionFailedCount}</span>}
                                    </div>
                                  )}
                                  {st.sentCount > 0 && (
                                    <div className="flex items-center gap-3 text-[10px] text-white/50 pl-12">
                                      <span><Send className="w-2.5 h-2.5 inline text-violet-300" /> 발송 {st.sentCount}</span>
                                      <span><MousePointerClick className="w-2.5 h-2.5 inline text-cyan-300" /> 클릭 {st.clickCount} ({(st.clickRate * 100).toFixed(1)}%)</span>
                                      <span><TrendingUp className="w-2.5 h-2.5 inline text-emerald-300" /> 전환 {st.conversionCount} ({(st.conversionRate * 100).toFixed(1)}%)</span>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* ★ D211+ Phase 2 (2026-05-23 Harold 명시): step별 AI 자동 진단 카드 — funnel 영역 직후 통합 */}
                          {diagnosisMap[j.id] && diagnosisMap[j.id].steps.length > 0 && (
                            <div className="p-3 bg-amber-500/5 border border-amber-400/30 rounded-lg space-y-2">
                              <div className="flex items-center gap-2 mb-1">
                                <AlertTriangle className="w-4 h-4 text-amber-300" />
                                <span className="text-sm font-semibold text-amber-100">AI 자동 진단</span>
                                <span className="ml-auto text-[10px] text-white/40 font-mono">
                                  건강 점수 {diagnosisMap[j.id].overallScore}/100
                                </span>
                              </div>
                              {/* 우선 처리 영역 3건 */}
                              {diagnosisMap[j.id].topConcerns.length > 0 && (
                                <div className="space-y-1 mb-2">
                                  <div className="text-[10px] text-white/40 font-semibold">우선 처리 영역</div>
                                  {diagnosisMap[j.id].topConcerns.map((concern, idx) => (
                                    <div key={idx} className="text-[11px] text-amber-200/80 pl-2 border-l-2 border-amber-400/30">
                                      {concern}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {/* step별 진단 + 1-click 액션 */}
                              <div className="space-y-1.5">
                                {diagnosisMap[j.id].steps.filter((s) => s.severity !== 'good').map((step) => (
                                  <div
                                    key={step.stepId}
                                    className={`p-2 rounded border ${
                                      step.severity === 'critical' ? 'bg-rose-500/10 border-rose-400/30' :
                                      'bg-amber-500/10 border-amber-400/30'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 text-[11px]">
                                      <span className="font-mono text-white/60 w-12">Step {step.stepOrder}</span>
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                        step.severity === 'critical' ? 'bg-rose-500/30 text-rose-200' :
                                        'bg-amber-500/30 text-amber-200'
                                      }`}>
                                        {step.severity === 'critical' ? '심각' : '주의'}
                                      </span>
                                      <span className="text-white/50">{step.topExitReason}</span>
                                      <span className="ml-auto text-white/60 font-mono">이탈 {(step.dropoutRate * 100).toFixed(0)}%</span>
                                    </div>
                                    <div className="text-[11px] text-white/70 mt-1 leading-relaxed">
                                      {step.recommendation}
                                    </div>
                                    {step.oneClickAction && (
                                      <div className="mt-1.5 text-[10px] text-amber-300/70 italic">
                                        제안 액션 — {step.oneClickAction.label} (회사 admin 명시 검토 후 적용)
                                      </div>
                                    )}
                                  </div>
                                ))}
                                {diagnosisMap[j.id].steps.every((s) => s.severity === 'good') && (
                                  <div className="text-[11px] text-emerald-300/80 leading-relaxed">
                                    전체 단계 정상 흐름 — 추가 정정 영역 없음. 다음 단계 신설 검토 가능.
                                  </div>
                                )}
                              </div>
                              <div className="text-[10px] text-white/40">
                                완료율 {(diagnosisMap[j.id].completionRate * 100).toFixed(1)}% · 진단 영역 = buildJourneyStats + 자동 분류
                              </div>
                            </div>
                          )}

                          {/* ★ D210+ Phase 3 (2026-05-23 Harold 명시): 다중 미리보기 영역 (6 영역 customer 자동 추출 — preview-samples endpoint) */}
                          {samplesMap[j.id] && samplesMap[j.id].length > 0 && (
                            <div className="p-3 bg-cyan-500/5 border border-cyan-400/30 rounded-lg space-y-2">
                              <div className="flex items-center gap-2 mb-1">
                                <Eye className="w-4 h-4 text-cyan-300" />
                                <span className="text-sm font-semibold text-cyan-100">미리보기 샘플</span>
                                {samplesTotalMap[j.id] && (
                                  <span className="text-[10px] text-cyan-200/80">전체 {samplesTotalMap[j.id].total.toLocaleString()}명{samplesTotalMap[j.id].capped ? ' 이상' : ''} 중 {samplesMap[j.id].length}명</span>
                                )}
                                <span className="text-[10px] text-white/30 italic ml-auto">Data source — customers + 예측</span>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {samplesMap[j.id].map((sample) => (
                                  <button
                                    key={sample.label}
                                    onClick={() =>
                                      setActiveSampleLabel((prev) => ({ ...prev, [j.id]: sample.label }))
                                    }
                                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                                      (activeSampleLabel[j.id] || samplesMap[j.id][0].label) === sample.label
                                        ? 'bg-cyan-500/30 text-cyan-100'
                                        : 'bg-white/5 text-white/60 hover:bg-white/10'
                                    }`}
                                  >
                                    {sample.label}
                                  </button>
                                ))}
                              </div>
                              {(() => {
                                const activeLabel = activeSampleLabel[j.id] || samplesMap[j.id][0].label;
                                const active = samplesMap[j.id].find((s) => s.label === activeLabel) || samplesMap[j.id][0];
                                return (
                                  <div className="p-2 bg-slate-950/60 border border-white/10 rounded text-[11px] space-y-1">
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-0.5">
                                      <div><span className="text-white/40">이름:</span> <span className="text-white/80 font-mono">{active.sampleCustomer.이름 || '-'}</span></div>
                                      <div><span className="text-white/40">등급:</span> <span className="text-white/80">{active.sampleCustomer.등급 || '-'}</span></div>
                                      <div><span className="text-white/40">지역:</span> <span className="text-white/80">{active.sampleCustomer.지역 || '-'}</span></div>
                                      <div><span className="text-white/40">연락처:</span> <span className="text-white/80 font-mono">{active.sampleCustomer.전화번호 || '-'}</span></div>
                                      <div><span className="text-white/40">최근 구매:</span> <span className="text-white/80">{active.sampleCustomer.최근구매일 || '-'}</span></div>
                                      <div><span className="text-white/40">총 구매:</span> <span className="text-white/80 font-mono">{active.sampleCustomer.총구매액 || '-'}</span></div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-x-3 mt-1.5 pt-1.5 border-t border-white/5">
                                      <div><span className="text-cyan-300/60">클릭:</span> <span className="font-mono text-cyan-200">{(Number(active.sampleCustomerFields.click_score) * 100).toFixed(1)}%</span></div>
                                      <div><span className="text-rose-300/60">이탈:</span> <span className="font-mono text-rose-200">{(Number(active.sampleCustomerFields.churn_risk) * 100).toFixed(1)}%</span></div>
                                      <div><span className="text-emerald-300/60">구매 가능성:</span> <span className="font-mono text-emerald-200">{(Number(active.sampleCustomerFields.purchase_likelihood) * 100).toFixed(1)}%</span></div>
                                    </div>
                                    {active.modelVersion && (
                                      <div className="text-[10px] text-white/40 mt-1">
                                        Predictive 모델: {active.modelVersion === 'v1.0-trained' ? (
                                          <span className="text-emerald-300">trained (실 데이터 기반)</span>
                                        ) : (
                                          <span className="text-amber-300">cold start (등급/활동 추정치)</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          )}

                          {/* ★ D210+ Phase 3 (2026-05-23 Harold 명시): 자동 재진입 토글 영역 (allow_reentry === true 영역만 표시) */}
                          {detail.journey.allow_reentry && (
                            <div className="p-3 bg-fuchsia-500/10 border border-fuchsia-500/30 rounded-lg flex items-start gap-3">
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                detail.journey.auto_reentry_enabled ? 'bg-fuchsia-500/30' : 'bg-white/5'
                              }`}>
                                <RotateCcw className={`w-5 h-5 ${detail.journey.auto_reentry_enabled ? 'text-fuchsia-200' : 'text-white/40'}`} />
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center justify-between mb-1">
                                  <div className="text-sm font-semibold text-fuchsia-100">
                                    자동 재진입 {detail.journey.auto_reentry_enabled ? '활성' : '비활성 (default)'}
                                  </div>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleToggleAutoReentry(
                                        j.id,
                                        !!detail.journey.auto_reentry_enabled,
                                        detail.journey.reentry_cooldown_days,
                                      );
                                    }}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                      detail.journey.auto_reentry_enabled ? 'bg-fuchsia-500' : 'bg-white/20'
                                    }`}
                                  >
                                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                                      detail.journey.auto_reentry_enabled ? 'translate-x-5' : 'translate-x-0.5'
                                    }`} />
                                  </button>
                                </div>
                                <div className="text-[11px] text-fuchsia-100/70 leading-relaxed">
                                  cooldown {detail.journey.reentry_cooldown_days ?? 0}일 경과 후 자동 진입 (6시간 cron). 회사 admin 명시 활성 의무 — AI 자동 진입 X 정합.
                                </div>
                              </div>
                            </div>
                          )}

                          {detail.steps.map((s) => {
                            const variantsExpanded = variantsExpandedStepIds.has(s.id);
                            const toggleVariants = () => {
                              setVariantsExpandedStepIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(s.id)) next.delete(s.id);
                                else next.add(s.id);
                                return next;
                              });
                            };
                            // ★ D189 #1: A/B 테스트는 message step만 (wait/condition step은 메시지 발송 X)
                            const supportsVariants = s.step_type === 'message';
                            return (
                              <div key={s.id} className="space-y-2">
                                <div className="flex items-start gap-3 p-2.5 bg-white/5 rounded">
                                  <div className="shrink-0 w-7 h-7 rounded-full bg-fuchsia-500/20 text-fuchsia-300 flex items-center justify-center text-xs font-semibold">{s.step_order}</div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[10px] text-white/50 mb-1 flex items-center gap-2 flex-wrap">
                                      <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> {s.timingLabel || `${s.delay_hours}시간 뒤`}</span>
                                      {s.channel && <span className="px-1.5 py-0.5 rounded bg-white/10 text-white/70">{s.channel.toUpperCase()}{s.is_ad ? ' · 광고' : ''}</span>}
                                      {s.conditionLabel && <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-200">{s.conditionLabel}</span>}
                                      {supportsVariants && (
                                        <button
                                          onClick={toggleVariants}
                                          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
                                            variantsExpanded
                                              ? 'bg-violet-500/30 text-violet-200'
                                              : 'bg-violet-500/10 hover:bg-violet-500/20 text-violet-300/80'
                                          }`}
                                          title="A/B 테스트 편집"
                                        >
                                          <Beaker className="w-3 h-3" />
                                          A/B 테스트 {variantsExpanded ? '닫기' : '열기'}
                                        </button>
                                      )}
                                    </div>
                                    {s.message_template && <div className="text-xs text-white/85 whitespace-pre-wrap">{s.message_template}</div>}
                                    {/* ★ D218+ (2026-05-26): message step 영역 = 담당자 알림 토글 (발송 2시간 전 + 발송 결과) */}
                                    {s.step_type === 'message' && (
                                      <div className="mt-3">
                                        <JourneyStepNotifyToggle
                                          journeyId={j.id}
                                          stepId={s.id}
                                          stepOrder={s.step_order}
                                          totalSteps={detail.steps.filter((st) => st.step_type === 'message').length}
                                          currentValue={s.notify_manager_on_pretest ?? null}
                                          token={token() || ''}
                                          onChange={() => loadAll()}
                                        />
                                      </div>
                                    )}
                                  </div>
                                </div>
                                {supportsVariants && variantsExpanded && (
                                  <JourneyVariantsEditor
                                    stepId={s.id}
                                    journeyId={j.id}
                                    journeyStatus={j.status === 'ended' ? 'paused' : (j.status as 'draft' | 'active' | 'paused')}
                                    defaultChannel={(s.channel || 'sms') as 'sms' | 'lms' | 'mms' | 'kakao'}
                                    defaultMessageTemplate={s.message_template || ''}
                                    onClose={toggleVariants}
                                  />
                                )}
                              </div>
                            );
                          })}

                          {/* ★ D211+ Phase 2 (2026-05-23 Harold 명시): 다음 단계 자동 추천 카드 — detail.steps 영역 다음 */}
                          <div className="p-3 bg-cyan-500/5 border border-cyan-400/30 rounded-lg space-y-2">
                            <div className="flex items-center gap-2">
                              <Sparkles className="w-4 h-4 text-cyan-300" />
                              <span className="text-sm font-semibold text-cyan-100">AI 다음 단계 추천</span>
                              <span className="ml-auto text-[10px] text-white/40">현재 {detail.steps.length}개 단계</span>
                            </div>
                            {!nextStepMap[j.id] ? (
                              <div>
                                <p className="text-[11px] text-white/60 leading-relaxed mb-2">
                                  현재 흐름 분석 후 다음 단계 1개 + 대안 2개를 추천합니다 (구체 혜택은 회사 admin 직접 작성).
                                </p>
                                <button
                                  onClick={(e) => { e.stopPropagation(); loadNextStep(j.id); }}
                                  disabled={nextStepLoading[j.id]}
                                  className="px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 disabled:opacity-50 text-cyan-100 rounded text-xs flex items-center gap-1.5"
                                >
                                  {nextStepLoading[j.id] ? (
                                    <>
                                      <Loader2 className="w-3 h-3 animate-spin" /> 추천 영역 분석 중
                                    </>
                                  ) : (
                                    <>
                                      <Sparkles className="w-3 h-3" /> AI 추천 받기
                                    </>
                                  )}
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {/* 추천 1순위 */}
                                <div className="p-2.5 bg-cyan-500/10 border border-cyan-400/40 rounded">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/30 text-cyan-100 font-semibold">추천 1순위</span>
                                    <span className="text-[11px] text-white/70 font-mono">
                                      {nextStepMap[j.id].recommended.stepType}
                                      {nextStepMap[j.id].recommended.delayHours > 0 && ` · ${nextStepMap[j.id].recommended.delayHours}h 후`}
                                      {nextStepMap[j.id].recommended.channel && ` · ${nextStepMap[j.id].recommended.channel?.toUpperCase()}`}
                                    </span>
                                  </div>
                                  {nextStepMap[j.id].recommended.messageTemplate && (
                                    <div className="text-[11px] text-white/80 whitespace-pre-wrap mb-1 leading-relaxed">
                                      {nextStepMap[j.id].recommended.messageTemplate}
                                    </div>
                                  )}
                                  <div className="text-[10px] text-cyan-200/80">{nextStepMap[j.id].recommended.reasoning}</div>
                                  {nextStepMap[j.id].recommended.expectedImpact && (
                                    <div className="text-[10px] text-emerald-300/70 mt-0.5">예상 영향 — {nextStepMap[j.id].recommended.expectedImpact}</div>
                                  )}
                                </div>
                                {/* 대안 2건 */}
                                {nextStepMap[j.id].alternatives.length > 0 && (
                                  <div className="space-y-1">
                                    <div className="text-[10px] text-white/40 font-semibold">대안</div>
                                    {nextStepMap[j.id].alternatives.map((alt, idx) => (
                                      <div key={idx} className="p-2 bg-white/5 border border-white/10 rounded">
                                        <div className="flex items-center gap-2 mb-0.5">
                                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/60">대안 {idx + 1}</span>
                                          <span className="text-[10px] text-white/60 font-mono">
                                            {alt.stepType}
                                            {alt.delayHours > 0 && ` · ${alt.delayHours}h`}
                                            {alt.channel && ` · ${alt.channel.toUpperCase()}`}
                                          </span>
                                        </div>
                                        {alt.messageTemplate && (
                                          <div className="text-[10px] text-white/70 whitespace-pre-wrap leading-relaxed">{alt.messageTemplate}</div>
                                        )}
                                        <div className="text-[10px] text-white/40 mt-0.5">{alt.reasoning}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {nextStepMap[j.id].reasoning && (
                                  <div className="text-[10px] text-white/50 italic border-t border-white/10 pt-1.5">
                                    {nextStepMap[j.id].reasoning}
                                  </div>
                                )}
                                <div className="text-[10px] text-white/40">
                                  회사 admin 명시 검토 + 승인 후 추가 의무 (AI 자동 추가 X).
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
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
            <div className="bg-fuchsia-500/10 border border-fuchsia-500/30 rounded-lg p-3 flex items-start gap-2">
              <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-fuchsia-300" />
              <div className="text-xs text-white/80">
                <span className="font-medium text-fuchsia-300">AI 설계 근거: </span>
                {aiPkg.reasoning || '시즌 + 회사 톤 + 메모리 기반 자동 설계'}
              </div>
            </div>

            {sampleCustomer && (
              <div className="bg-emerald-500/10 border border-emerald-400/30 rounded-lg p-3 text-xs text-emerald-100 flex items-start gap-2">
                <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-300" />
                <div>
                  <span className="font-semibold">타겟 고객 데이터 연동됨</span> — 각 step에서 <span className="text-emerald-200">발송 미리보기</span> 토글을 누르면, 추출된 타겟 최상위 고객 기준으로 실제 발송될 형태(변수 치환 + 광고·무료거부)를 볼 수 있어요.
                </div>
              </div>
            )}

            {/* 기본 설정 */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-white/60 mb-1">여정 이름</label>
                  <input value={reviewName} onChange={(e) => setReviewName(e.target.value)} className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-fuchsia-400" />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">회신번호 <span className="text-rose-400">*</span></label>
                  <select value={reviewCallback} onChange={(e) => setReviewCallback(e.target.value)} className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-fuchsia-400">
                    <option value="">선택해주세요</option>
                    {callbackOptions.map((c) => (
                      <option key={`${c.source}-${c.phone}`} value={c.phone}>
                        {c.phone}{c.description ? ` (${c.description})` : ''}{c.is_default ? ' • 기본' : ''}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 mt-2 text-xs text-white/70 cursor-pointer">
                    <input type="checkbox" checked={reviewUseStorePhone} onChange={(e) => setReviewUseStorePhone(e.target.checked)} className="rounded" />
                    <span>고객 매장번호로 발송 (매장번호 없는 고객은 위 번호로)</span>
                  </label>
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">월간 예산 (원, 선택)</label>
                  <input type="number" value={reviewBudget} onChange={(e) => setReviewBudget(e.target.value)} placeholder="비워두면 무제한" className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-fuchsia-400" />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">step당 비용 한도 (원, 선택)</label>
                  <input type="number" value={reviewThreshold} onChange={(e) => setReviewThreshold(e.target.value)} placeholder="비워두면 무제한" className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-fuchsia-400" />
                </div>
              </div>
              <div className="text-[11px] text-white/50 flex flex-wrap gap-x-3 gap-y-0.5">
                <span>트리거: {aiPkg.triggerEvent}</span>
                <span>재진입: {aiPkg.allowReentry ? (aiPkg.reentryCooldownDays ? `${aiPkg.reentryCooldownDays}일 후` : '즉시') : '불가'}</span>
                <span className="text-amber-300/80">(광고)+무료거부+발송시간+KISA 제목 자동 합성</span>
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
                  s.stepType === 'wait' ? 'bg-sky-500/20 text-sky-300' :
                  s.stepType === 'condition' ? 'bg-emerald-500/20 text-emerald-300' :
                  'bg-fuchsia-500/20 text-fuchsia-300';
                return (
                  <div key={idx} className="bg-white/[0.04] border border-white/15 rounded-2xl p-4 space-y-3 shadow-lg shadow-black/20">
                    {/* 제목바 — step 순번 + 의도 (3분할 카드 상단, 유형색 좌측 바) */}
                    <div className={`flex items-center gap-2 px-3 py-2 mb-1 rounded-lg border-l-4 ${s.stepType === 'wait' ? 'border-sky-400 bg-sky-500/10' : s.stepType === 'condition' ? 'border-emerald-400 bg-emerald-500/10' : 'border-fuchsia-400 bg-fuchsia-500/10'}`}>
                      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${stepTypeColor}`}>{s.stepOrder}</div>
                      <div className="text-sm font-semibold text-white/90 flex-1 min-w-0 truncate">{s.stepIntent || `Step ${s.stepOrder}`}</div>
                      {idx > 0 && <span className="shrink-0 text-[10px] text-white/40">이전 후 {formatStepDelay(s)}</span>}
                    </div>

                    {/* ★ D188 Phase 2-B-1: wait step UI — 시간 대기만 명시 */}
                    {/* ★ D188 Phase 2-B-1 + D210+ Phase 3 (2026-05-23 Harold 명시): wait step UI — delay_mode 3 영역
                          1. relative — 옛 매트릭스 (delay_hours 단순 영역)
                          2. specific_hour — target_hour_kst 영역 KST (오늘/내일 정합)
                          3. next_business_day — 다음 평일 09시 KST (단순 매트릭스) */}
                    {s.stepType === 'wait' && (
                      <div className="p-3 bg-sky-500/10 border border-sky-500/30 rounded text-xs space-y-3">
                        <div className="font-semibold text-sky-200">시간 대기 step</div>
                        <div className="text-sky-200/70 leading-relaxed">
                          메시지 발송 없이 대기 후 다음 step 진입. KST 시간대 정합 매트릭스.
                        </div>

                        {/* delay_mode dropdown */}
                        <div>
                          <label className="block text-[10px] text-sky-200/70 mb-1">대기 방식</label>
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
                            className="w-full px-2 py-1.5 bg-slate-900 border border-white/10 rounded text-xs"
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
                              <label className="text-[10px] text-sky-200/70 w-20">대기 기간</label>
                              <input type="number" min={0} max={365} value={Math.floor((s.delayHours ?? 0) / 24)}
                                onChange={(e) => { const days = Math.max(0, Math.min(365, Number(e.target.value) || 0)); updateStep(idx, { delayHours: days * 24 + ((s.delayHours ?? 0) % 24) }); }}
                                className="w-16 px-2 py-1 bg-slate-900 border border-white/10 rounded text-xs" />
                              <span className="text-[11px] text-sky-200/70">일</span>
                              <input type="number" min={0} max={23} value={(s.delayHours ?? 0) % 24}
                                onChange={(e) => { const hrs = Math.max(0, Math.min(23, Number(e.target.value) || 0)); updateStep(idx, { delayHours: Math.floor((s.delayHours ?? 0) / 24) * 24 + hrs }); }}
                                className="w-16 px-2 py-1 bg-slate-900 border border-white/10 rounded text-xs" />
                              <span className="text-[11px] text-sky-200/70">시간 대기</span>
                            </div>
                            <div className="text-[10px] text-sky-200/50">
                              예: 3일 0시간 대기 후 후기 요청 발송
                            </div>
                          </div>
                        )}

                        {/* mode 2: specific_hour — target_hour_kst input */}
                        {s.delayMode === 'specific_hour' && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <label className="text-[10px] text-sky-200/70 w-20">발송 시간</label>
                              <select
                                value={s.targetHourKst ?? 9}
                                onChange={(e) => updateStep(idx, { targetHourKst: Math.max(0, Math.min(23, Number(e.target.value) || 9)) })}
                                className="w-24 px-2 py-1 bg-slate-900 border border-white/10 rounded text-xs"
                              >
                                {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                                  <option key={h} value={h}>{String(h).padStart(2, '0')}시</option>
                                ))}
                              </select>
                              <span className="text-[11px] text-sky-200/70">KST (오늘 영역 안 지난 시점 → 내일 정합)</span>
                            </div>
                            <div className="text-[10px] text-sky-200/50">
                              예: 09시 KST → 옛 발송 직후 오전 진입 시 오늘 09시 / 오후 진입 시 내일 09시 정합
                            </div>
                          </div>
                        )}

                        {/* mode 3: next_business_day */}
                        {s.delayMode === 'next_business_day' && (
                          <div className="text-[10px] text-sky-200/50 leading-relaxed">
                            다음 평일 (월~금) 09시 KST 정합. 토/일 진입 시 다음 월요일 09시 / 금요일 09시 이후 진입 시 다음 월요일 09시 정합.
                          </div>
                        )}
                      </div>
                    )}

                    {/* ★ D188 Phase 2-B-1 + D210+ Phase 3 (2026-05-23 Harold 명시): condition step UI — type 3 분기 매트릭스
                          1. customer_field — 옛 매트릭스 (field + operator + value)
                          2. cdp_event_exists — 지난 N일 안 이벤트 EXISTS 영역
                          3. journey_step_clicked — 옛 step N 클릭 영역 EXISTS */}
                    {s.stepType === 'condition' && (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded text-xs space-y-3">
                        <div className="font-semibold text-emerald-200">조건 평가 step</div>
                        <div className="text-emerald-200/60 leading-relaxed">
                          고객 정보 또는 사건 영역 평가 후 조건 만족 시 다음 step 진입 / 미만족 시 여정 종료합니다.
                        </div>

                        {/* type dropdown */}
                        <div>
                          <label className="block text-[10px] text-emerald-200/70 mb-1">조건 type</label>
                          <select
                            value={s.conditionJsonb?.type || 'customer_field'}
                            onChange={(e) => {
                              const newType = e.target.value as ConditionJsonb['type'];
                              if (newType === 'customer_field') {
                                updateStep(idx, {
                                  conditionJsonb: {
                                    type: 'customer_field',
                                    field: 'recent_purchase_amount',
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
                              }
                            }}
                            className="w-full px-2 py-1.5 bg-slate-900 border border-white/10 rounded text-xs"
                          >
                            <option value="customer_field">고객 필드 조건 (등급 / 구매 금액 / 지역 영역)</option>
                            <option value="cdp_event_exists">CDP 이벤트 영역 (지난 N일 안 구매 / 클릭 EXISTS)</option>
                            <option value="journey_step_clicked">옛 step 클릭 영역 (Step N 클릭 EXISTS)</option>
                          </select>
                        </div>

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
                                className="px-2 py-1.5 bg-slate-900 border border-white/10 rounded text-xs"
                              >
                                <option value="">필드 선택</option>
                                <option value="recent_purchase_amount">최근 구매 금액</option>
                                <option value="total_purchase_amount">누적 구매 금액</option>
                                <option value="purchase_count">구매 횟수</option>
                                <option value="grade">등급</option>
                                <option value="points">포인트</option>
                                <option value="age">나이</option>
                                <option value="gender">성별</option>
                                <option value="region">지역</option>
                                <option value="sms_opt_in">SMS 수신동의</option>
                                <option value="recent_purchase_date">최근 구매일</option>
                                <option value="birth_date">생일</option>
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
                                className="px-2 py-1.5 bg-slate-900 border border-white/10 rounded text-xs"
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
                                  className="px-2 py-1.5 bg-slate-900 border border-white/10 rounded text-xs"
                                />
                              )}
                            </div>
                            <div className="text-[10px] text-emerald-200/50">
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
                                className="px-2 py-1.5 bg-slate-900 border border-white/10 rounded text-xs"
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
                                className="px-2 py-1.5 bg-slate-900 border border-white/10 rounded text-xs"
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
                                className="px-2 py-1.5 bg-slate-900 border border-white/10 rounded text-xs"
                              >
                                <option value="exists">이벤트 있음 (exists)</option>
                                <option value="not_exists">이벤트 없음 (not_exists)</option>
                              </select>
                            </div>
                            <div className="text-[10px] text-emerald-200/50">
                              예: "지난 7일 안 구매 이벤트 없음" → 마지막날 리마인드 발송 정합
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
                                className="px-2 py-1.5 bg-slate-900 border border-white/10 rounded text-xs"
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
                                className="px-2 py-1.5 bg-slate-900 border border-white/10 rounded text-xs"
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
                                className="px-2 py-1.5 bg-slate-900 border border-white/10 rounded text-xs"
                              >
                                <option value="true">클릭 있음</option>
                                <option value="false">클릭 없음</option>
                              </select>
                            </div>
                            <div className="text-[10px] text-emerald-200/50">
                              예: "Step 1 발송 후 5일 안 클릭 없음" → 다른 채널 영역 재시도 정합
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ★ D189 #2 (2026-05-22): 알림톡 step UI — AlimtalkChannelPanel 통합 (발신프로필 + 템플릿 + 변수 매핑 + 부달 + 미리보기) */}
                    {s.stepType === 'message' && s.channel === 'kakao' && (
                      <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-xs">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-semibold text-amber-200">알림톡 (KAKAO) step</div>
                          {/* ★ D190 #3 (2026-05-22): AI 자동 매칭 추천 버튼 + ★ D196 (2026-05-22) 사용법 안내 강화 */}
                          {alimtalkTemplates.length > 0 && (
                            <button
                              onClick={() => handleAlimtalkAutoMatch(idx)}
                              className="px-2 py-1 bg-violet-500/30 hover:bg-violet-500/50 text-violet-200 rounded text-[11px] flex items-center gap-1"
                              title="AI가 회사 보유 승인 알림톡 템플릿 중 캠페인 의도에 가장 정합하는 1건 자동 추천 + 변수(#{이름}/#{등급} 등) 자동 매핑. 결과 검토 후 회사 admin 정정 가능."
                            >
                              <Wand2 className="w-3 h-3" />
                              AI 자동 매칭
                            </button>
                          )}
                        </div>
                        {/* ★ D196 (2026-05-22) 사용법 안내 — 알림톡 step 첫 진입 시 가이드 */}
                        {!s.alimtalkTemplateCode && alimtalkTemplates.length > 0 && (
                          <div className="mb-2 p-2 bg-violet-500/10 border border-violet-400/20 rounded text-[11px] text-violet-200/90 flex items-start gap-1.5">
                            <Wand2 className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            <span>
                              <strong className="text-violet-200">AI 자동 매칭</strong> 버튼을 누르면 회사 보유 승인 템플릿 중 캠페인 의도에 정합하는 1건 자동 추천 + 변수 자동 매핑. 또는 아래에서 직접 선택 가능.
                            </span>
                          </div>
                        )}
                        {alimtalkSenders.length === 0 ? (
                          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded text-rose-200">
                            승인된 발신프로필이 없습니다. 알림톡 발송 모달에서 발신프로필을 먼저 등록해주세요.
                          </div>
                        ) : alimtalkTemplates.length === 0 ? (
                          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded text-rose-200">
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
                      </div>
                    )}

                    {/* ★ D188 Phase 2-B-1: message step UI — 기존 매트릭스 유지 (SMS/LMS/MMS) */}
                    {s.stepType === 'message' && s.channel !== 'kakao' && (
                      <>
                        {(s.channel === 'lms' || s.channel === 'mms') && (
                          <div>
                            <label className="block text-[11px] text-white/50 mb-1">제목 <span className="text-rose-400">*</span> <span className="text-white/30">(LMS/MMS 필수, 최대 40자)</span></label>
                            <div className="flex items-stretch gap-1">
                              {s.isAd && (
                                <span className="px-2.5 flex items-center shrink-0 bg-slate-950/60 border border-amber-400/20 rounded text-sm text-amber-300/70 select-none" title="발송 시 자동으로 앞에 붙습니다 (직접 입력하지 마세요)">(광고)</span>
                              )}
                              <input
                                value={s.subject}
                                onChange={(e) => updateStep(idx, { subject: e.target.value })}
                                placeholder="한 줄 제목 (호기심 유발 / 본문 핵심 요약)"
                                maxLength={40}
                                className={`flex-1 min-w-0 px-3 py-2 bg-slate-900 border rounded text-sm focus:outline-none focus:border-fuchsia-400 ${(!s.subject || !s.subject.trim()) ? 'border-rose-500/50' : 'border-white/10'}`}
                              />
                            </div>
                            <div className="text-[10px] text-white/40 mt-0.5">{getByteLength(s.subject)} bytes · 통신사 권장 ~ 40바이트 안</div>
                          </div>
                        )}

                        {/* ★ D189 #3 (2026-05-22): MMS 이미지 업로드 — channel === 'mms' 시 mount (최대 3장, JPG 300KB) */}
                        {s.channel === 'mms' && (
                          <JourneyMmsUploader
                            value={s.mmsImagePaths || []}
                            onChange={(paths) => updateStep(idx, { mmsImagePaths: paths })}
                          />
                        )}

                        {/* 원본 편집 / 발송 미리보기 토글 — 미리보기는 추출된 타겟 최상위 고객 1명 치환 + 광고/무료거부 합성 */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex rounded-lg bg-white/5 border border-white/10 p-0.5 text-[11px]">
                            <button type="button" onClick={() => setPreviewSteps((p) => { const n = new Set(p); n.delete(idx); return n; })}
                              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${!isPreview ? 'bg-violet-500/30 text-violet-100' : 'text-white/50 hover:text-white/80'}`}>원본 편집</button>
                            <button type="button" onClick={() => setPreviewSteps((p) => { const n = new Set(p); n.add(idx); return n; })}
                              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${isPreview ? 'bg-emerald-500/30 text-emerald-100' : 'text-white/50 hover:text-white/80'}`}>발송 미리보기</button>
                          </div>
                          {isPreview && sampleCustomer && (
                            <span className="text-[10px] text-emerald-300/70">타겟 최상위 고객 기준 · 실제 발송 형태</span>
                          )}
                        </div>

                        {isPreview ? (
                          <div className="px-3 py-2 bg-slate-950/60 border border-white/10 rounded text-sm whitespace-pre-wrap font-mono text-white/90 min-h-[140px] leading-relaxed">
                            {!sampleCustomer && (
                              <div className="mb-2 text-amber-300/80 text-[11px] leading-relaxed">
                                아직 이 조건의 타겟 고객이 없어 원본으로 표시됩니다. 여정을 켜면 조건을 충족하는 고객에게 자동 발송됩니다.
                              </div>
                            )}
                            {(s.channel === 'lms' || s.channel === 'mms') && s.subject && (
                              <div className="mb-2 pb-2 border-b border-white/10 text-[12px]">
                                <span className="text-white/45">제목 </span>
                                <span className="text-white/85">{s.isAd ? (s.subject.startsWith('(광고)') ? s.subject : `(광고) ${s.subject}`) : s.subject}</span>
                              </div>
                            )}
                            {sampleCustomer ? mergeVarsPlain(preview, sampleCustomer, sampleCustomerFields || undefined) : preview}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {s.isAd && (
                              <div className="px-3 py-1.5 bg-slate-950/50 border border-amber-400/20 rounded text-[11px] text-amber-300/70 select-none">
                                {adPrefixFor(s.channel).trim()} <span className="text-white/40">— 발송 시 자동 추가 (본문에 직접 쓰지 마세요)</span>
                              </div>
                            )}
                            <textarea value={s.messageTemplate} onChange={(e) => updateStep(idx, { messageTemplate: e.target.value })} rows={7} placeholder="본문을 입력하세요" className="w-full px-3 py-2 bg-slate-900 border border-fuchsia-400/50 rounded text-sm font-mono focus:outline-none resize-y leading-relaxed" />
                            {s.isAd && (
                              <div className="px-3 py-1.5 bg-slate-950/50 border border-amber-400/20 rounded text-[11px] text-amber-300/70 select-none whitespace-pre-wrap">
                                {adRejectFor(s.channel, opt080Number)} <span className="text-white/40">— 발송 시 자동 추가</span>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-white/40">
                          <span className={bytes > maxBytes ? 'text-rose-400' : ''}>본문: {bytes} / {maxBytes} bytes</span>
                          {placeholderWarn && <span className="text-amber-300">[...] 영역 - 직접 수정 필요</span>}
                          {(() => {
                            const unsafe = detectUnsafe(s.messageTemplate + ' ' + s.subject);
                            if (unsafe.emoji.length === 0 && unsafe.special.length === 0) return null;
                            return (
                              <span className="text-rose-400">
                                통신사 미지원 단어 - 저장 시 자동 정규화 (
                                {unsafe.emoji.length > 0 && `이모지: ${unsafe.emoji.slice(0, 5).join(' ')}`}
                                {unsafe.emoji.length > 0 && unsafe.special.length > 0 && ' / '}
                                {unsafe.special.length > 0 && `특수문자: ${unsafe.special.slice(0, 5).join(' ')}`}
                                )
                              </span>
                            );
                          })()}
                        </div>
                      </>
                    )}
                    {/* 발송 시점(자연어) + 컨트롤 (3분할 카드 하단) */}
                    <div className="pt-2.5 mt-1 border-t border-white/10 space-y-2">
                      {s.stepType === 'message' && (
                        <div className="flex flex-wrap items-center gap-1.5 text-xs bg-white/[0.03] rounded-lg px-2.5 py-2">
                          <Clock className="w-3.5 h-3.5 text-violet-300 shrink-0" />
                          <span className="text-white/50">{idx === 0 ? '트리거 후' : '직전 단계 후'}</span>
                          {/* 일 단위 우선 — 마케팅 담당자가 시간으로 환산할 필요 없음(일 + 시간 둘 다 입력) */}
                          <input type="number" min={0} max={365} value={Math.floor((s.delayHours ?? 0) / 24)}
                            onChange={(e) => { const days = Math.max(0, Math.min(365, Number(e.target.value) || 0)); updateStep(idx, { delayHours: days * 24 + ((s.delayHours ?? 0) % 24) }); }}
                            className="w-12 px-2 py-0.5 bg-slate-800 border border-white/10 rounded" />
                          <span className="text-white/85">일</span>
                          <input type="number" min={0} max={23} value={(s.delayHours ?? 0) % 24}
                            onChange={(e) => { const hrs = Math.max(0, Math.min(23, Number(e.target.value) || 0)); updateStep(idx, { delayHours: Math.floor((s.delayHours ?? 0) / 24) * 24 + hrs }); }}
                            className="w-12 px-2 py-0.5 bg-slate-800 border border-white/10 rounded" />
                          <span className="text-white/85">시간 뒤</span>
                          <span className="text-white/50 ml-1">· 발송 시각</span>
                          <select value={s.delayMode === 'relative_at_hour' && s.targetHourKst != null ? String(s.targetHourKst) : ''}
                            onChange={(e) => { const v = e.target.value; if (v === '') updateStep(idx, { delayMode: 'relative', targetHourKst: undefined }); else updateStep(idx, { delayMode: 'relative_at_hour', targetHourKst: Number(v) }); }}
                            className="px-1.5 py-0.5 bg-slate-800 border border-white/10 rounded">
                            <option value="">지정 안 함</option>
                            {Array.from({ length: 13 }, (_, i) => i + 8).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}시</option>)}
                          </select>
                          <span className="text-white/35 text-[10px]">밤이면 아침 자동</span>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <select
                          value={s.stepType}
                          onChange={(e) => {
                            const newType = e.target.value as StepType;
                            const patch: Partial<AIGeneratedStep> = { stepType: newType };
                            if (newType === 'condition' && !s.conditionJsonb) {
                              patch.conditionJsonb = { type: 'customer_field', field: 'recent_purchase_amount', operator: '>=', value: 100000 };
                            }
                            updateStep(idx, patch);
                          }}
                          className="px-2 py-1 bg-slate-800 border border-white/10 rounded" title="step 유형"
                        >
                          <option value="message">메시지</option>
                          <option value="wait">대기</option>
                          <option value="condition">조건</option>
                        </select>
                        {s.stepType === 'message' && (
                          <>
                            <select value={s.channel} onChange={(e) => updateStep(idx, { channel: e.target.value as ChannelType })} className="px-2 py-1 bg-slate-800 border border-white/10 rounded">
                              <option value="sms">SMS</option>
                              <option value="lms">LMS</option>
                              <option value="mms">MMS</option>
                              <option value="kakao">알림톡</option>
                            </select>
                            <label className="flex items-center gap-1 cursor-pointer px-2 py-1 rounded bg-slate-800 border border-white/10">
                              <input type="checkbox" checked={s.isAd} onChange={(e) => updateStep(idx, { isAd: e.target.checked })} className="rounded" />
                              <span className="text-amber-300/80">광고 표기</span>
                            </label>
                            <button onClick={() => handleRefineOpen(idx)} disabled={refineLoading} className="px-2 py-1 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 rounded flex items-center gap-1 disabled:opacity-50">
                              {refineLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}AI 다듬기
                            </button>
                          </>
                        )}
                        <button onClick={() => deleteStep(idx)} className="p-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded ml-auto" title="이 단계 삭제">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {aiPkg.steps.length < 7 && (
                <button onClick={addStep} className="w-full p-3 border-2 border-dashed border-white/10 hover:border-white/30 rounded-xl text-sm text-white/50 hover:text-white/80 flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4" /> Step 추가
                </button>
              )}
            </div>

            {/* 액션 버튼 */}
            <div className="flex flex-wrap gap-2 pt-2 sticky bottom-0 bg-slate-950/95 backdrop-blur-sm border-t border-white/10 -mx-3 md:-mx-6 px-3 md:px-6 py-3">
              <button onClick={handleRegenerate} disabled={generating || saving} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm flex items-center gap-2 disabled:opacity-50">
                <RefreshCw className="w-4 h-4" /> AI 다시 생성
              </button>
              <button onClick={() => setConfirm({ mode: 'warning', title: '메인으로 돌아가기', description: '변경사항이 사라집니다. 메인으로 돌아가시겠습니까?', confirmLabel: '나가기', onConfirm: () => { setView('main'); setAiPkg(null); } })} disabled={saving} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">취소</button>
              <button onClick={handleSaveDraft} disabled={saving || !reviewCallback} className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-fuchsia-500 to-purple-500 text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}초안 저장
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 고객 데이터 없음 — 생성 차단 안내 */}
      <CustomerDataRequiredModal open={showDataGate} onClose={() => setShowDataGate(false)} />

      {/* AI 다듬기 modal */}
      {refining && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setRefining(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-white/10 flex items-center justify-between sticky top-0 bg-slate-900">
              <h3 className="text-base font-semibold flex items-center gap-2"><Wand2 className="w-4 h-4 text-violet-400" />AI 다듬기 — 3 톤 후보</h3>
              <button onClick={() => setRefining(null)} className="text-white/40 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-3">
              {refining.candidates.length === 0 ? (
                <p className="text-sm text-white/60">생성된 후보가 없습니다.</p>
              ) : (
                refining.candidates.map((c, i) => (
                  <div key={i} className="p-3 bg-white/5 border border-white/10 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                        c.tone === '감성적' ? 'bg-pink-500/20 text-pink-300' :
                        c.tone === '실용적' ? 'bg-cyan-500/20 text-cyan-300' :
                        'bg-emerald-500/20 text-emerald-300'
                      }`}>{c.tone}</span>
                      <span className="text-[10px] text-white/40">{c.bytes} bytes</span>
                    </div>
                    <div className="text-sm text-white/90 whitespace-pre-wrap mb-2 font-mono">{c.message}</div>
                    {c.reasoning && <div className="text-[11px] text-white/40 mb-2">{c.reasoning}</div>}
                    <button onClick={() => handleAcceptRefine(c)} className="px-3 py-1.5 bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 rounded text-xs">이 후보 적용</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI 생성 중 오버레이 */}
      {/* ★ D210+ Phase 2-fix6 (Harold 명시 2026-05-23): 6 sub-agent 진행 카드 매트릭스 (옛 단순 로딩 → AiOperatorPage 매트릭스 미러) */}
      {generating && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-40 p-4">
          <div className="max-w-3xl w-full animate-in fade-in duration-300">
            <div className="text-center mb-6">
              <p className="text-[11px] font-semibold tracking-[0.28em] text-white/40 uppercase mb-2">AI Operator · Multi-Agent Pipeline</p>
              <p className="text-white/80 text-sm">6개 sub-agent가 협업하여 여정을 설계하고 있습니다</p>
            </div>

            {/* ★ D210+ Phase 2-fix8 (Harold 명시 2026-05-23): Stage 2 — 6단 모두 완료 후 둥근 스피너 + "마지막 다듬는 중" 안내 */}
            {progressStep >= JOURNEY_SUB_AGENT_STEPS.length && (
              <div className="mb-6 text-center animate-in fade-in duration-300">
                <Loader2 className="w-10 h-10 animate-spin text-fuchsia-400 mx-auto mb-3" />
                <p className="text-white/85 text-sm font-medium">AI Operator가 여정 마지막 다듬는 중입니다</p>
                <p className="text-white/50 text-xs mt-1">검토 화면 준비 중 — 잠시만 기다려주세요</p>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {JOURNEY_SUB_AGENT_STEPS.map((step, idx) => {
                const Icon = step.icon;
                const isDone = idx < progressStep;
                const isActive = idx === progressStep;
                const isPending = idx > progressStep;
                return (
                  <div
                    key={step.label}
                    className={`relative p-4 rounded-xl border backdrop-blur-xl transition-all duration-500 ${
                      isDone ? 'bg-emerald-500/10 border-emerald-400/30' :
                      isActive ? 'bg-white/10 border-fuchsia-400/40 scale-[1.02] shadow-lg shadow-fuchsia-500/20' :
                      'bg-white/[0.02] border-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`relative flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-all ${
                        isDone ? 'bg-gradient-to-br from-emerald-400 to-teal-500' :
                        isActive ? `bg-gradient-to-br ${step.gradient}` :
                        'bg-white/5'
                      }`}>
                        {isDone ? (
                          <CheckCircle2 className="w-5 h-5 text-white" strokeWidth={3} />
                        ) : isActive ? (
                          <>
                            <Icon className="w-5 h-5 text-white relative z-10" />
                            <span className="absolute inset-0 rounded-lg bg-white/20 animate-ping" />
                          </>
                        ) : (
                          <Icon className={`w-5 h-5 ${isPending ? 'text-white/25' : 'text-white'}`} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[10px] font-bold tracking-wider uppercase ${
                          isDone ? 'text-emerald-300' :
                          isActive ? 'text-white' :
                          'text-white/30'
                        }`}>
                          {step.label}
                        </p>
                        <p className={`text-xs mt-0.5 truncate ${
                          isDone || isActive ? 'text-white/70' : 'text-white/25'
                        }`}>
                          {isActive ? '진행 중...' : isDone ? '완료' : step.hint}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

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
    </div>
  );
}
