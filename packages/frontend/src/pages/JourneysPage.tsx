import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ChevronDown, ChevronUp, Loader2, Pause, Play, Plus, Power, RefreshCw, Sparkles,
  ShoppingCart, Cake, Calendar as CalendarIcon, UserPlus, Repeat, Moon, MessageSquare,
  Clock, DollarSign, Users, Phone, Wand2, X, AlertCircle, Send, Trash2, Edit2, Save, Beaker, Code,
  BarChart3,
  // ★ D210+ Phase 2-fix6 (Harold 명시 2026-05-23): 6 sub-agent 진행 카드 + 토글 영역 아이콘
  Workflow, Brain, LayoutGrid, CheckCircle2,
} from 'lucide-react';
import JourneyVariantsEditor from '../components/journey/JourneyVariantsEditor';
import JourneyMmsUploader from '../components/journey/JourneyMmsUploader';
import LiquidPreviewModal from '../components/journey/LiquidPreviewModal';
import AlimtalkChannelPanel, { type AlimtalkSenderProfile, type AlimtalkTemplate, type AlimtalkChannelState } from '../components/alimtalk/AlimtalkChannelPanel';
import { detectLiquidSyntax, renderLiquid, flattenCustomerForLiquid, SAMPLE_CUSTOMERS } from '../utils/liquid-templating';
// ★ D210+ Phase 2-fix6 (Harold 명시 2026-05-23): 변수 하이라이트 + 머지 미리보기 컨트롤타워.
import { highlightVars, mergeAndHighlightVars } from '../utils/highlightVars';

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
  stats_total_entered: number;
  stats_total_completed: number;
  stats_total_cost: number;
  paused_at: string | null;
  pause_reason: string | null;
  created_at: string;
}

interface StepRow {
  id: string;
  step_order: number;
  step_type: string;
  delay_hours: number;
  channel: string | null;
  message_template: string | null;
  is_ad: boolean;
}

interface JourneyDetail {
  journey: JourneyRow;
  steps: StepRow[];
}

interface CallbackOption {
  phone: string;
  source: string;
  description: string | null;
  is_default: boolean;
}

// ★ D188 Phase 2-B-1 (2026-05-21): step_type 3종 확장 — message/wait/condition.
type StepType = 'message' | 'wait' | 'condition';

interface ConditionJsonb {
  type: 'customer_field';
  field: string;
  operator: '==' | '!=' | '>=' | '<=' | '>' | '<' | 'in' | 'not_in' | 'is_null' | 'not_null';
  value?: any;
}

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

const STATUS_BADGE: Record<JourneyStatus, { label: string; cls: string }> = {
  draft:  { label: '초안',     cls: 'bg-slate-700 text-slate-200' },
  active: { label: '활성',     cls: 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' },
  paused: { label: '일시정지', cls: 'bg-amber-500/20 text-amber-300 border border-amber-400/30' },
  ended:  { label: '종료',     cls: 'bg-slate-800 text-slate-400' },
};

function buildPreview(message: string, isAd: boolean, channel: ChannelType, opt080: string): string {
  if (!isAd || !message) return message;
  const isLms = channel === 'lms' || channel === 'mms';
  const adPrefix = isLms ? '(광고) ' : '(광고)';
  const rejectText = opt080
    ? (isLms ? `\n무료수신거부 ${opt080}` : `\n무료거부${opt080.replace(/-/g, '')}`)
    : (isLms ? '\n무료수신거부' : '\n무료거부');
  return `${adPrefix}${message}${rejectText}`;
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
  const [view, setView] = useState<'main' | 'review'>('main');
  const [journeys, setJourneys] = useState<JourneyRow[]>([]);
  const [callbackOptions, setCallbackOptions] = useState<CallbackOption[]>([]);
  const [opt080Number, setOpt080Number] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailsMap, setDetailsMap] = useState<Record<string, JourneyDetail>>({});

  // One-shot AI 생성 흐름
  const [objective, setObjective] = useState('');
  const [generating, setGenerating] = useState(false);
  // ★ D210+ Phase 2-fix6 (Harold 명시 2026-05-23): 6 sub-agent 진행 + 샘플 고객 머지 토글
  const [progressStep, setProgressStep] = useState(0);
  const [sampleCustomer, setSampleCustomer] = useState<Record<string, string | number | null> | null>(null);
  const [showMergedPreview, setShowMergedPreview] = useState(false);
  const [aiPkg, setAiPkg] = useState<AIJourneyPackage | null>(null);
  const [reviewName, setReviewName] = useState('');
  const [reviewCallback, setReviewCallback] = useState('');
  // ★ D189 #1 (2026-05-22): JourneyVariantsEditor 토글 — main view step별 A/B 테스트 편집 영역
  const [variantsExpandedStepIds, setVariantsExpandedStepIds] = useState<Set<string>>(new Set());
  // ★ D189 #2 (2026-05-22): 알림톡 채널 패널 데이터 — 회사 발신프로필 + 템플릿 + 활성 필드 (review view kakao step UI용)
  const [alimtalkSenders, setAlimtalkSenders] = useState<AlimtalkSenderProfile[]>([]);
  const [alimtalkTemplates, setAlimtalkTemplates] = useState<AlimtalkTemplate[]>([]);
  const [customerFields, setCustomerFields] = useState<Array<{ key: string; label: string }>>([]);
  const [reviewBudget, setReviewBudget] = useState('');
  const [reviewThreshold, setReviewThreshold] = useState('');

  // step 수정
  const [editingStepIdx, setEditingStepIdx] = useState<number | null>(null);
  const [refining, setRefining] = useState<{ stepIdx: number; candidates: RefineCandidate[] } | null>(null);
  const [refineLoading, setRefineLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // ★ D191 (2026-05-22) Phase B-1 Liquid Templating: 미리보기 모달 state
  const [liquidPreview, setLiquidPreview] = useState<{ stepIdx: number; messageTemplate: string; subject: string } | null>(null);

  const token = () => localStorage.getItem('token');

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [jr, cr] = await Promise.all([
        fetch('/api/ai/operator/journeys?status=all', { headers: { Authorization: `Bearer ${token()}` } }),
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

  useEffect(() => { loadAll(); }, []);

  // ★ D189 #2 (2026-05-22): 알림톡 발신프로필 + 템플릿 + 활성 필드 fetch (review view 알림톡 step UI용)
  useEffect(() => {
    const t = token();
    if (!t) return;
    Promise.all([
      fetch('/api/alimtalk/senders', { headers: { Authorization: `Bearer ${t}` } }).catch(() => null),
      fetch('/api/companies/kakao-templates?status=APPROVED', { headers: { Authorization: `Bearer ${t}` } }).catch(() => null),
      fetch('/api/customers/enabled-fields', { headers: { Authorization: `Bearer ${t}` } }).catch(() => null),
    ]).then(async ([sndRes, tplRes, fldRes]) => {
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
    });
  }, []);

  // ★ D190 #3 (2026-05-22): 알림톡 AI 자동 매칭 — Opus 4.7 매칭 + 변수 자동 매핑
  const handleAlimtalkAutoMatch = async (stepIdx: number) => {
    if (!aiPkg) return;
    const matchObjective = aiPkg.name || aiPkg.reasoning || objective || '캠페인 발송';
    if (!matchObjective || matchObjective.trim().length < 3) {
      alert('캠페인 의도가 비어있습니다. 여정 이름 또는 목표를 입력해주세요.');
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
        alert(data.error || 'AI 매칭 실패');
        return;
      }
      if (!data.matched || !data.template) {
        alert(data.suggestion || '정합되는 알림톡 템플릿이 없습니다. 캠페인 의도에 맞는 템플릿을 추가 등록해주세요.');
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
      alert(
        `AI 자동 매칭 완료 (정합 점수 ${data.matchScore})\n\n` +
        `템플릿: ${data.template.template_name}\n` +
        `근거: ${data.matchReason}\n\n` +
        `변수 자동 매핑: ${(data.variableMappings || []).length}건 (미매핑 ${unmappedCount}건 — 회사 admin 직접 입력 필요)\n\n` +
        `회사 admin 검토 + 정정 후 활성화해주세요.`
      );
    } catch (err: any) {
      alert(err?.message || 'AI 매칭 중 오류');
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

  const toggleExpand = (journeyId: string) => {
    if (expandedId === journeyId) setExpandedId(null);
    else { setExpandedId(journeyId); loadDetail(journeyId); }
  };

  // ════════ One-shot AI 생성 ════════
  const handleAIGenerate = async (templateHint?: TemplateCode) => {
    if (!templateHint && objective.trim().length < 3) {
      alert('여정 목표를 자연어로 입력하거나 빠른 시작 카드를 선택해주세요.');
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

        // ★ D210+ Phase 2-fix6 (Harold 명시 2026-05-23): 회사 상위 고객 1건 자동 fetch — 원본/치환 토글 머지 영역 정합.
        //   여정 영역 = 트리거 기반 (filter X) → 전체 customer 안 LTV 상위 1건 fallback.
        fetch('/api/ai/operator/sample-customer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
          body: JSON.stringify({ filters: {} }),
        })
          .then((sr) => sr.json())
          .then((sd) => {
            if (sd?.success && sd.sampleCustomer) {
              setSampleCustomer(sd.sampleCustomer);
            } else {
              setSampleCustomer(null);
            }
          })
          .catch(() => setSampleCustomer(null));
      } else {
        alert(data.error || 'AI 생성 실패. 다시 시도해주세요.');
      }
    } catch (e: any) {
      alert(e?.message || '생성 중 오류');
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

  const handleRegenerate = async () => {
    if (!aiPkg) return;
    if (!confirm('현재 생성된 여정을 폐기하고 다시 생성하시겠습니까? 수정한 내용은 사라집니다.')) return;
    await handleAIGenerate(aiPkg.templateCode === 'custom' && objective ? undefined : aiPkg.templateCode);
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
    if (aiPkg.steps.length <= 1) { alert('최소 1개 step은 필요합니다.'); return; }
    if (!confirm(`step ${idx + 1}을(를) 삭제하시겠습니까?`)) return;
    const newSteps = aiPkg.steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepOrder: i + 1 }));
    setAiPkg({ ...aiPkg, steps: newSteps });
  };

  const addStep = () => {
    if (!aiPkg) return;
    // ★ D188 Phase 2-B-1 (2026-05-21): 최대 step 5개 → 7개 확장 (wait/condition 추가 영역 확보).
    if (aiPkg.steps.length >= 7) { alert('최대 7개 step까지 가능합니다.'); return; }
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
      alert('메시지를 10자 이상 작성한 후 다듬기를 사용해주세요.');
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
        alert(data.error || 'AI 다듬기 실패');
      }
    } catch (e: any) {
      alert(e?.message || '다듬기 중 오류');
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
  const handleSaveDraft = async () => {
    if (!aiPkg) return;
    if (!reviewCallback) { alert('회신번호를 선택해주세요.'); return; }
    // ★ D188 Phase 2-B-1 (2026-05-21): step_type별 다른 검증 분기.
    //   message = 본문 + subject 검증 / wait = delay_hours>0 / condition = conditionJsonb 정합.
    const validOps = ['==', '!=', '>=', '<=', '>', '<', 'in', 'not_in', 'is_null', 'not_null'];
    for (const s of aiPkg.steps) {
      if (s.stepType === 'wait') {
        if (Number(s.delayHours) <= 0) {
          alert(`step ${s.stepOrder} (wait) 대기 시간이 0 이하입니다. 1시간 이상 설정해주세요.`);
          return;
        }
        continue;
      }
      if (s.stepType === 'condition') {
        const c = s.conditionJsonb;
        if (!c || c.type !== 'customer_field' || !c.field || !c.field.trim()) {
          alert(`step ${s.stepOrder} (condition) 조건 필드를 선택해주세요.`);
          return;
        }
        if (!validOps.includes(c.operator)) {
          alert(`step ${s.stepOrder} (condition) 연산자를 선택해주세요.`);
          return;
        }
        if (!['is_null', 'not_null'].includes(c.operator) && (c.value === undefined || c.value === null || c.value === '')) {
          alert(`step ${s.stepOrder} (condition) 비교값을 입력해주세요.`);
          return;
        }
        continue;
      }
      // message step = 본문 + subject 검증
      if (!s.messageTemplate.trim() || s.messageTemplate.trim().length < 10) {
        alert(`step ${s.stepOrder} 본문이 비어있거나 너무 짧습니다.`);
        return;
      }
      if ((s.channel === 'lms' || s.channel === 'mms') && (!s.subject || !s.subject.trim())) {
        alert(`step ${s.stepOrder} LMS/MMS 제목이 비어있습니다.`);
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
        alert('초안 여정이 저장되었습니다. 활성 여정 목록에서 활성화 가능합니다.');
      } else {
        alert(data.error || '저장 실패');
      }
    } catch (e: any) {
      alert(e?.message || '저장 중 오류');
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (journeyId: string, action: 'activate' | 'pause' | 'end') => {
    const confirmMsg =
      action === 'activate' ? '여정을 활성화하시겠습니까? 트리거 조건에 맞는 고객이 진입하고 step별 메시지가 자동 발송됩니다.\n\n광고 자동 검증 4건이 모두 자동 부착됩니다.' :
      action === 'pause' ? '여정을 일시정지하시겠습니까?' :
      '여정을 종료하시겠습니까? 종료 후 재시작 불가합니다.';
    if (!confirm(confirmMsg)) return;
    try {
      const res = await fetch(`/api/ai/operator/journeys/${journeyId}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) await loadAll();
      else alert(data.error || '처리 실패');
    } catch (e: any) {
      alert(e?.message || '처리 중 오류');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* 헤더 */}
      <div className="border-b border-white/10 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-3 md:px-6 py-3 md:py-4 flex items-center gap-2 md:gap-4">
          <button
            onClick={() => view === 'review' ? (confirm('생성한 여정이 사라집니다. 메인으로 돌아가시겠습니까?') && (setView('main'), setAiPkg(null))) : navigate('/ai-operator')}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg md:text-2xl font-bold truncate">
              {view === 'review' ? 'AI 생성 여정 검토' : '여정 자동화 — AI Operator'}
            </h1>
            <p className="text-xs md:text-sm text-white/50 mt-0.5">
              {view === 'review' ? 'AI가 설계한 흐름을 검토 + 혜택 부분 수정 후 활성화' : '자연어 한 줄 또는 빠른 시작 — AI가 시즌·회사 톤 반영해 완전 자동 생성'}
            </p>
          </div>
          {view === 'main' && (
            <button onClick={loadAll} disabled={loading} className="p-2 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50">
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

            {/* 활성 여정 목록 */}
            <div>
              <h3 className="text-sm font-semibold text-white/80 mb-2">활성 여정 ({journeys.length})</h3>
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
                            {(j.status === 'draft' || j.status === 'paused') && (
                              <button onClick={(e) => { e.stopPropagation(); handleAction(j.id, 'activate'); }} className="p-2 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300" title="활성화">
                                <Play className="w-4 h-4" />
                              </button>
                            )}
                            {j.status === 'active' && (
                              <button onClick={(e) => { e.stopPropagation(); handleAction(j.id, 'pause'); }} className="p-2 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300" title="일시정지">
                                <Pause className="w-4 h-4" />
                              </button>
                            )}
                            {j.status !== 'ended' && (
                              <button onClick={(e) => { e.stopPropagation(); handleAction(j.id, 'end'); }} className="p-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-300" title="종료">
                                <Power className="w-4 h-4" />
                              </button>
                            )}
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
                          </div>
                        </div>
                      </div>
                      {isExpanded && detail && (
                        <div className="border-t border-white/10 p-3 bg-slate-950/40 space-y-2">
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
                                      <span><Clock className="w-3 h-3 inline" /> {s.delay_hours}h · {s.channel?.toUpperCase()} {s.is_ad && '· 광고'}</span>
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

            {/* ★ D210+ Phase 2-fix6 (Harold 명시 2026-05-23): 원본/적용 토글 — 모든 step 본문 표시 영역 전역 적용 */}
            {sampleCustomer && (
              <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => setShowMergedPreview(false)}
                  className={`flex-1 text-[11px] py-1.5 rounded-md transition-all ${
                    !showMergedPreview
                      ? 'bg-amber-400/25 text-amber-100 font-semibold ring-1 ring-amber-300/40'
                      : 'text-white/40 hover:text-white/60'
                  }`}
                  title="개인화 변수 위치 강조 — %고객명% 형태 그대로 표시"
                >
                  원본 (변수 강조)
                </button>
                <button
                  type="button"
                  onClick={() => setShowMergedPreview(true)}
                  className={`flex-1 text-[11px] py-1.5 rounded-md transition-all ${
                    showMergedPreview
                      ? 'bg-emerald-400/25 text-emerald-100 font-semibold ring-1 ring-emerald-400/40'
                      : 'text-white/40 hover:text-white/60'
                  }`}
                  title="상위 고객 데이터로 치환된 결과 미리보기"
                >
                  적용 (상위 고객 머지)
                </button>
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

            {/* Step 시계열 */}
            <div className="space-y-3">
              {aiPkg.steps.map((s, idx) => {
                const bytes = getByteLength(s.messageTemplate);
                const maxBytes = s.channel === 'sms' ? 90 : 2000;
                const preview = buildPreview(s.messageTemplate, s.isAd, s.channel, opt080Number);
                const previewBytes = getByteLength(preview);
                const placeholderWarn = hasPlaceholder(s.messageTemplate);
                const isEditing = editingStepIdx === idx;

                // ★ D188 Phase 2-B-1 (2026-05-21): step_type별 다른 UI — message/wait/condition.
                //   헤더는 공통 (step_type select 추가) / 본문은 step_type별 분기.
                const stepTypeColor =
                  s.stepType === 'wait' ? 'bg-sky-500/20 text-sky-300' :
                  s.stepType === 'condition' ? 'bg-emerald-500/20 text-emerald-300' :
                  'bg-fuchsia-500/20 text-fuchsia-300';
                return (
                  <div key={idx} className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-semibold ${stepTypeColor}`}>{s.stepOrder}</div>
                      <div className="text-sm font-medium text-white/80 flex-1 min-w-0 truncate">
                        {s.stepIntent || `Step ${s.stepOrder}`}
                      </div>
                      {/* step_type select — 모든 step에 공통 */}
                      <select
                        value={s.stepType}
                        onChange={(e) => {
                          const newType = e.target.value as StepType;
                          const patch: Partial<AIGeneratedStep> = { stepType: newType };
                          // condition 진입 시 빈 conditionJsonb 자동 생성
                          if (newType === 'condition' && !s.conditionJsonb) {
                            patch.conditionJsonb = { type: 'customer_field', field: 'recent_purchase_amount', operator: '>=', value: 100000 };
                          }
                          updateStep(idx, patch);
                        }}
                        className="px-2 py-1 bg-slate-800 border border-white/10 rounded text-xs"
                        title="step 유형"
                      >
                        <option value="message">메시지</option>
                        <option value="wait">대기</option>
                        <option value="condition">조건</option>
                      </select>
                      <div className="flex items-center gap-1 text-xs">
                        <Clock className="w-3.5 h-3.5 text-white/40" />
                        <input type="number" min={0} max={720} value={s.delayHours} onChange={(e) => updateStep(idx, { delayHours: Number(e.target.value) || 0 })} className="w-16 px-2 py-1 bg-slate-800 border border-white/10 rounded text-xs" />
                        <span className="text-white/50">h</span>
                      </div>
                      {/* channel select + 광고 toggle — message step만 */}
                      {s.stepType === 'message' && (
                        <>
                          {/* ★ D188 Phase 2-B-2 (2026-05-21): kakao + mms 채널 옵션 신규. */}
                          <select value={s.channel} onChange={(e) => updateStep(idx, { channel: e.target.value as ChannelType })} className="px-2 py-1 bg-slate-800 border border-white/10 rounded text-xs">
                            <option value="sms">SMS</option>
                            <option value="lms">LMS</option>
                            <option value="mms">MMS</option>
                            <option value="kakao">알림톡</option>
                          </select>
                          <label className="flex items-center gap-1 text-xs cursor-pointer">
                            <input type="checkbox" checked={s.isAd} onChange={(e) => updateStep(idx, { isAd: e.target.checked })} className="rounded" />
                            <span className="text-amber-300/80">광고</span>
                          </label>
                        </>
                      )}
                      {/* 직접 수정 + AI 다듬기 — message step만 */}
                      {s.stepType === 'message' && (
                        <>
                          <button onClick={() => setEditingStepIdx(isEditing ? null : idx)} className="p-1.5 bg-slate-700 hover:bg-slate-600 rounded" title={isEditing ? '닫기' : '직접 수정'}>
                            {isEditing ? <Save className="w-3.5 h-3.5" /> : <Edit2 className="w-3.5 h-3.5" />}
                          </button>
                          <button onClick={() => handleRefineOpen(idx)} disabled={refineLoading} className="px-2 py-1.5 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 rounded text-xs flex items-center gap-1 disabled:opacity-50">
                            {refineLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}AI 다듬기
                          </button>
                        </>
                      )}
                      <button onClick={() => deleteStep(idx)} className="p-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded" title="삭제">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* ★ D188 Phase 2-B-1: wait step UI — 시간 대기만 명시 */}
                    {s.stepType === 'wait' && (
                      <div className="p-3 bg-sky-500/10 border border-sky-500/30 rounded text-xs text-sky-200 leading-relaxed">
                        <div className="font-semibold mb-1">시간 대기 step</div>
                        <div className="text-sky-200/70">
                          이 step에서는 메시지 발송 없이 {s.delayHours}시간 대기 후 다음 step으로 진입합니다.
                          후기 요청 전 충분한 사용 시간 확보, 휴면 사용자 점진 접근 등 자연 흐름에 사용해주세요.
                        </div>
                      </div>
                    )}

                    {/* ★ D188 Phase 2-B-1: condition step UI — GUI 빌더 (field + operator + value) */}
                    {s.stepType === 'condition' && (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded text-xs space-y-2">
                        <div className="font-semibold text-emerald-200">조건 평가 step</div>
                        <div className="text-emerald-200/60 leading-relaxed">
                          고객 정보를 평가해 조건 만족 시 다음 step 진입 / 미만족 시 여정 종료합니다.
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-2 items-center">
                          <select
                            value={s.conditionJsonb?.field || ''}
                            onChange={(e) =>
                              updateStep(idx, {
                                conditionJsonb: {
                                  type: 'customer_field',
                                  field: e.target.value,
                                  operator: s.conditionJsonb?.operator || '>=',
                                  value: s.conditionJsonb?.value,
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
                            value={s.conditionJsonb?.operator || '>='}
                            onChange={(e) =>
                              updateStep(idx, {
                                conditionJsonb: {
                                  type: 'customer_field',
                                  field: s.conditionJsonb?.field || '',
                                  operator: e.target.value as ConditionJsonb['operator'],
                                  value: s.conditionJsonb?.value,
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
                          {!['is_null', 'not_null'].includes(s.conditionJsonb?.operator || '') && (
                            <input
                              type="text"
                              value={s.conditionJsonb?.value ?? ''}
                              onChange={(e) =>
                                updateStep(idx, {
                                  conditionJsonb: {
                                    type: 'customer_field',
                                    field: s.conditionJsonb?.field || '',
                                    operator: s.conditionJsonb?.operator || '>=',
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
                            <input
                              value={s.subject}
                              onChange={(e) => updateStep(idx, { subject: e.target.value })}
                              placeholder="한 줄 제목 (호기심 유발 / 본문 핵심 요약)"
                              maxLength={40}
                              className={`w-full px-3 py-2 bg-slate-900 border rounded text-sm focus:outline-none focus:border-fuchsia-400 ${(!s.subject || !s.subject.trim()) ? 'border-rose-500/50' : 'border-white/10'}`}
                            />
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

                        {isEditing ? (
                          <textarea value={s.messageTemplate} onChange={(e) => updateStep(idx, { messageTemplate: e.target.value })} rows={6} className="w-full px-3 py-2 bg-slate-900 border border-fuchsia-400/50 rounded text-sm font-mono focus:outline-none resize-y" />
                        ) : (
                          <div className="px-3 py-2 bg-slate-900/60 border border-white/10 rounded text-sm whitespace-pre-wrap font-mono text-white/90 cursor-pointer" onClick={() => setEditingStepIdx(idx)}>
                            {/* ★ D210+ Phase 2-fix6 (Harold 명시 2026-05-23): 변수 하이라이트 + 상위 고객 머지 토글 */}
                            {showMergedPreview && sampleCustomer
                              ? mergeAndHighlightVars(s.messageTemplate, sampleCustomer, 'dark')
                              : highlightVars(s.messageTemplate, 'dark')}
                          </div>
                        )}

                        {/* ★ D191 (2026-05-22) Phase B-1 Liquid Templating: Liquid 문법 감지 + 미리보기 진입 */}
                        {detectLiquidSyntax(s.messageTemplate + ' ' + s.subject) && (
                          <div className="p-2 bg-violet-500/10 border border-violet-400/30 rounded text-[11px] flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-violet-200">
                              <Code className="w-3.5 h-3.5" />
                              <span>Liquid 동적 콘텐츠 감지 — 사용자별 1:1 분기 + 변수 계산</span>
                            </div>
                            <button
                              onClick={() => setLiquidPreview({ stepIdx: idx, messageTemplate: s.messageTemplate, subject: s.subject || '' })}
                              className="px-2 py-1 bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 rounded text-[10px] font-medium flex items-center gap-1"
                            >
                              <Sparkles className="w-3 h-3" /> 10명 미리보기
                            </button>
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

                        {s.isAd && s.messageTemplate.trim().length >= 10 && (
                          <div className="p-2 bg-slate-950/60 border border-white/5 rounded text-[11px]">
                            <div className="text-white/40 mb-1">실제 발송 미리보기 ({previewBytes} bytes):</div>
                            <div className="whitespace-pre-wrap text-white/80 font-mono">{preview}</div>
                          </div>
                        )}
                      </>
                    )}
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
              <button onClick={() => { if (confirm('변경사항이 사라집니다. 메인으로 돌아가시겠습니까?')) { setView('main'); setAiPkg(null); } }} disabled={saving} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">취소</button>
              <button onClick={handleSaveDraft} disabled={saving || !reviewCallback} className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-fuchsia-500 to-purple-500 text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}초안 저장
              </button>
            </div>
          </div>
        )}
      </div>

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

      {/* ★ D191 (2026-05-22) Phase B-1: Liquid Templating 미리보기 modal */}
      {liquidPreview && (
        <LiquidPreviewModal
          messageTemplate={liquidPreview.messageTemplate}
          subject={liquidPreview.subject}
          onClose={() => setLiquidPreview(null)}
        />
      )}
    </div>
  );
}
