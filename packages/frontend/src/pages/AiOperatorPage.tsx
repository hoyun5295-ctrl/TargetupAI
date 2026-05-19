import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  DollarSign,
  LineChart,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Wand2,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import AiRefineModal from '../components/AiRefineModal';
import { useAuthStore } from '../stores/authStore';

// ============================================================
// 타입 정의
// ============================================================

interface ProposalMessage {
  variantId: string;
  variantName: string;
  concept: string;
  body: string;             // ★ D165 fix: backend message_text 단일 필드 (channel은 별도 박음)
  subject?: string;         // LMS/MMS 제목 (선택)
  byteCount?: number;       // SMS 경고용
  byteWarning?: boolean;
  score: number;
}

// ★ D170: Multi-Agent Orchestrator 응답 — compliance + agentDurations 추가
interface ComplianceBlock {
  passed: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  warnings: string[];
  suggestions: string[];
}

interface ProposalResponse {
  success: boolean;
  target: {
    count: number;
    totalCount: number;
    criteria: string;
    filters: Record<string, unknown>;
    suggestedName: string;
  };
  messages: ProposalMessage[];
  recommendation: string;
  recommendationReason: string;
  channel: {
    recommended: string;
    reason: string;
    isAd: boolean;
    rejectNumber?: string | null;  // ★ Harold 명시: 광고 메시지 미리보기에 (광고)+무료거부 자동 합성
  };
  schedule: {
    recommendedTime: string;
  };
  compliance?: ComplianceBlock;  // ★ D170: Compliance Sub-agent 응답
  cost: {
    estimated: number;
    unitCost: number;
    breakdown: string;
  };
  performance: {
    expectedClicks: number;
    expectedConversions: number;
    expectedRevenue: number;
    clickRate: number;
    conversionRate: number;
  };
  meta: {
    usePersonalization: boolean;
    personalizationVars: string[];
    useIndividualCallback: boolean;
    countVerified?: boolean;                    // ★ D168
    agentDurations?: Record<string, number>;    // ★ D170
    generatedAt: string;
  };
}

// ============================================================
// 정적 데이터
// ============================================================

const EXAMPLE_PROMPTS = [
  '최근 30일 미구매 VIP에게 재구매 쿠폰 보내줘',
  '장바구니 이탈 24시간 고객에게 10% 할인 알림',
  '휴면 전환 위험 고객에게 복귀 메시지',
  '신규 가입 후 7일 미구매 고객에게 첫 구매 혜택',
];

interface SubAgentStep {
  icon: typeof Target;
  label: string;
  gradient: string;
  hint: string;
}

const SUB_AGENT_STEPS: SubAgentStep[] = [
  { icon: Target, label: 'Target Analysis', gradient: 'from-rose-400 to-pink-500', hint: '고객군 자동 추출 · SQL 생성' },
  { icon: MessageSquare, label: 'Message Composition', gradient: 'from-amber-400 to-orange-500', hint: 'A/B 문구 + 스팸 검수' },
  { icon: Send, label: 'Channel Decisioning', gradient: 'from-emerald-400 to-teal-500', hint: '최적 채널 판단' },
  { icon: Clock, label: 'Schedule Optimization', gradient: 'from-cyan-400 to-blue-500', hint: '발송 시점 추천' },
  { icon: DollarSign, label: 'Cost Calculation', gradient: 'from-violet-400 to-purple-500', hint: '회사별 단가 적용' },
  { icon: LineChart, label: 'Performance Forecast', gradient: 'from-fuchsia-400 to-pink-500', hint: '클릭 · 전환 · 매출 추정' },
];

interface EngineCard {
  icon: typeof Target;
  gradient: string;
  title: string;
  description: string;
}

const ENGINE_CARDS: EngineCard[] = [
  { icon: Target, gradient: 'from-rose-400 to-pink-500', title: 'AI 타겟 엔진', description: '자연어 한 줄로 고객군 자동 추출 + SQL 검증 loop' },
  { icon: MessageSquare, gradient: 'from-amber-400 to-orange-500', title: 'AI 메시지 엔진', description: '채널별 A/B 문구 + 스팸 검수 + 톤 자동 조절' },
  { icon: Send, gradient: 'from-emerald-400 to-teal-500', title: '채널 의사결정', description: '고객별 최적 채널·시점·빈도 AI 자동 판단' },
  { icon: Workflow, gradient: 'from-cyan-400 to-blue-500', title: '여정 자동화', description: '가입/재구매/휴면/생일 여정 AI 자동 설계' },
  { icon: Zap, gradient: 'from-violet-400 to-purple-500', title: '실시간 트리거', description: '장바구니/예약/구매 이벤트 즉시 자동 발송' },
  { icon: LineChart, gradient: 'from-fuchsia-400 to-pink-500', title: '성과 + Next Action', description: '매출/ROI/LTV + 다음 캠페인 AI 자동 제안' },
  { icon: Brain, gradient: 'from-amber-400 to-rose-500', title: 'AI Operator', description: '6 sub-agent 협업 + 회사별 메모리 학습' },
];

type MilestoneStatus = 'done' | 'next' | 'planned';

interface SessionMilestone {
  d: string;
  title: string;
  status: MilestoneStatus;
}

const SESSION_MILESTONES: SessionMilestone[] = [
  { d: 'D163', title: '베타 안내 시스템 인프라 (헤더 메뉴 + 모달 + 게이팅)', status: 'done' },
  { d: 'D164', title: '진입 hero + 자연어 입력 + AI 통합 제안서 endpoint', status: 'done' },
  { d: 'D165', title: 'AI 제안서 카드 정합 디자인 강화', status: 'done' },
  { d: 'D166', title: '승인 → 발송 → 결과 reactive 흐름 + 발송 시점 안전장치', status: 'done' },
  { d: 'D167', title: 'Prompt Caching (callAIWithFallback 강화, 90% 비용 절감)', status: 'done' },
  { d: 'D168', title: 'Tool Use SQL Loop (countFilteredCustomers — AI 추정 → DB 실제)', status: 'done' },
  { d: 'D169', title: 'Extended Thinking (Opus 4.7 adaptive 호환)', status: 'done' },
  { d: 'D170', title: '회사별 메모리 + Multi-Agent Orchestrator (6 Sub-agent)', status: 'done' },
  { d: 'D171', title: 'Step 0 통합 검증 + ENTERPRISE 베타 운영 진입', status: 'next' },
];

const STATUS_CONFIG: Record<MilestoneStatus, { icon: typeof Check; bg: string; ring: string; text: string; label: string }> = {
  done:    { icon: Check, bg: 'bg-gradient-to-br from-emerald-400 to-teal-500', ring: 'ring-emerald-400/30', text: 'text-emerald-300', label: '완료' },
  next:    { icon: Sparkles, bg: 'bg-gradient-to-br from-amber-400 to-fuchsia-500', ring: 'ring-fuchsia-400/40', text: 'text-amber-200', label: '다음 진행' },
  planned: { icon: Clock, bg: 'bg-white/10', ring: 'ring-white/10', text: 'text-white/40', label: '예정' },
};

// 결과 카드 액센트
interface AccentTokens {
  iconBg: string;
  border: string;
  glow: string;
  text: string;
}

const ACCENT_TOKENS: Record<string, AccentTokens> = {
  rose:    { iconBg: 'from-rose-400 to-pink-500',       border: 'border-rose-400/20',    glow: 'hover:shadow-rose-500/20',    text: 'text-rose-200' },
  amber:   { iconBg: 'from-amber-400 to-orange-500',    border: 'border-amber-400/20',   glow: 'hover:shadow-amber-500/20',   text: 'text-amber-200' },
  emerald: { iconBg: 'from-emerald-400 to-teal-500',    border: 'border-emerald-400/20', glow: 'hover:shadow-emerald-500/20', text: 'text-emerald-200' },
  cyan:    { iconBg: 'from-cyan-400 to-blue-500',       border: 'border-cyan-400/20',    glow: 'hover:shadow-cyan-500/20',    text: 'text-cyan-200' },
  violet:  { iconBg: 'from-violet-400 to-purple-500',   border: 'border-violet-400/20',  glow: 'hover:shadow-violet-500/20',  text: 'text-violet-200' },
  fuchsia: { iconBg: 'from-fuchsia-400 to-pink-500',    border: 'border-fuchsia-400/20', glow: 'hover:shadow-fuchsia-500/20', text: 'text-fuchsia-200' },
};

// ============================================================
// 헬퍼
// ============================================================

function formatScheduleTime(iso: string): string {
  if (!iso) return '추후 안내';
  // recommended_time 형식: "YYYY-MM-DD HH:mm" 또는 ISO
  const cleaned = iso.replace(' ', 'T');
  const date = new Date(cleaned);
  if (isNaN(date.getTime())) return iso;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const dow = dayNames[date.getDay()];
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day}(${dow}) ${hh}:${mm}`;
}

// ============================================================
// 결과 카드 sub-component
// ============================================================

interface ResultCardProps {
  accent: keyof typeof ACCENT_TOKENS;
  icon: typeof Target;
  label: string;
  headline: string;
  subtitle: string;
  description?: string;
  index: number;
  extra?: React.ReactNode;       // ★ D165: 카드 본문 하단 풍부 인터랙션 슬롯 (3안 토글 / 차트 / breakdown 등)
  className?: string;            // ★ D165: 그리드 col-span 등 외부 제어
  truncateHeadline?: boolean;    // ★ D165: 메시지 카드처럼 긴 텍스트 truncate 끄기
}

function ResultCard({ accent, icon: Icon, label, headline, subtitle, description, index, extra, className, truncateHeadline = true }: ResultCardProps) {
  const tokens = ACCENT_TOKENS[accent];
  return (
    <div
      className={`group relative p-6 rounded-2xl bg-white/[0.04] backdrop-blur-xl border ${tokens.border} hover:bg-white/[0.07] hover:scale-[1.01] transition-all duration-300 shadow-lg ${tokens.glow} animate-in fade-in slide-in-from-bottom-3 fill-mode-both ${className || ''}`}
      style={{ animationDelay: `${index * 60}ms`, animationDuration: '500ms' }}
    >
      <div className="flex items-start gap-4 mb-4">
        <div className={`flex-shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br ${tokens.iconBg} flex items-center justify-center shadow-lg`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] font-semibold tracking-[0.22em] uppercase mb-1 ${tokens.text}`}>{label}</p>
          <p className={`text-2xl font-bold text-white ${truncateHeadline ? 'truncate' : ''}`} title={headline}>{headline}</p>
          <p className="text-xs text-white/50 mt-0.5">{subtitle}</p>
        </div>
      </div>
      {description && (
        <p className="text-sm text-white/65 leading-relaxed line-clamp-3 mb-3">{description}</p>
      )}
      {extra && <div className="mt-1">{extra}</div>}
    </div>
  );
}

// ============================================================
// 메인 페이지
// ============================================================

export default function AiOperatorPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const companyName = (user as any)?.company?.name || '';
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // ★ D174 (2026-05-19): PerformancePage가 sessionStorage에 박은 prefill objective 자동 박음
  const [objective, setObjective] = useState(() => {
    if (typeof window === 'undefined') return '';
    const prefill = sessionStorage.getItem('ai_operator_prefill_objective');
    if (prefill) {
      sessionStorage.removeItem('ai_operator_prefill_objective');
      return prefill;
    }
    return '';
  });
  const [loading, setLoading] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [proposal, setProposal] = useState<ProposalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ★ D165: 메시지 3안 토글 + 다듬기 모달 + 다듬기 결과 오버라이드
  const [selectedVariantIdx, setSelectedVariantIdx] = useState(0);
  const [showRefineModal, setShowRefineModal] = useState(false);
  const [refinedOverrides, setRefinedOverrides] = useState<Record<number, string>>({});
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  // ★ D166: 승인 → 발송 흐름 (preview-recipients + /direct-send 2-step)
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<{
    campaignId: string;
    sentCount: number;
    failCount: number;
    unsubscribeCount?: number;
    message: string;
    suggestedName: string;
  } | null>(null);
  // ★ D170+ (Harold 명시 2026-05-19): 발송 시점 안전장치 박음
  //   'aiRecommended' = AI 추천 시점 그대로 예약 발송 (미래 시점이면)
  //   'immediate' = 지금 즉시 발송 (사용자 명시 선택)
  //   'custom' = 사용자가 직접 시점 선택 (datetime-local input)
  type SendMode = 'aiRecommended' | 'immediate' | 'custom';
  const [sendMode, setSendMode] = useState<SendMode>('aiRecommended');
  const [customScheduledAt, setCustomScheduledAt] = useState<string>(''); // YYYY-MM-DDTHH:mm 형식

  // textarea 자동 높이 조절
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [objective]);

  // 로딩 시 sub-agent 단계 자동 진행
  useEffect(() => {
    if (!loading) return;
    if (progressStep >= SUB_AGENT_STEPS.length) return;
    const timer = setTimeout(() => {
      setProgressStep((s) => Math.min(s + 1, SUB_AGENT_STEPS.length));
    }, 1500);
    return () => clearTimeout(timer);
  }, [loading, progressStep]);

  const handleSubmit = async () => {
    if (objective.trim().length < 5) {
      setError('마케팅 목표를 한 줄로 입력해주세요 (5자 이상).');
      return;
    }
    setError(null);
    setLoading(true);
    setProgressStep(0);
    setProposal(null);

    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/ai/operator/propose', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ objective: objective.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '제안서 생성에 실패했습니다.');
      }
      // 모든 단계 완료 표시 후 결과 노출
      setProgressStep(SUB_AGENT_STEPS.length);
      setTimeout(() => {
        setProposal(data as ProposalResponse);
        setLoading(false);
      }, 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
      setLoading(false);
      setProgressStep(0);
    }
  };

  const handleReset = () => {
    setProposal(null);
    setObjective('');
    setError(null);
    setProgressStep(0);
    setSendResult(null);
    setSendError(null);
    setRefinedOverrides({});
    setSelectedVariantIdx(0);
    textareaRef.current?.focus();
  };

  // ★ D166: 승인 발송 — 2-step (preview-recipients → /direct-send)
  const handleApprove = async () => {
    if (!proposal || sending) return;
    setSending(true);
    setSendError(null);
    setSendResult(null);

    try {
      const token = localStorage.getItem('token');

      // 1. recipients 조회
      const previewRes = await fetch('/api/ai/operator/preview-recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filters: proposal.target.filters }),
      });
      const previewData = await previewRes.json();
      if (!previewRes.ok || !previewData.success) {
        throw new Error(previewData.error || '수신자 조회 실패');
      }
      const recipients: Array<Record<string, unknown>> = previewData.recipients || [];
      if (recipients.length === 0) {
        throw new Error('발송 대상 고객이 없습니다. 타겟 조건을 조정해주세요.');
      }
      if (!previewData.defaultCallback) {
        throw new Error('기본 회신번호가 등록되지 않았습니다. 발신번호 관리에서 등록 후 다시 시도해주세요.');
      }

      // 2. 선택된 안 추출
      const idx = Math.min(selectedVariantIdx, Math.max(0, proposal.messages.length - 1));
      const variant = proposal.messages[idx];
      if (!variant) throw new Error('선택된 메시지가 없습니다.');
      const body = refinedOverrides[idx] || variant.body || '';
      if (!body || body.length < 5) throw new Error('메시지 본문이 비어있습니다. 다시 생성해주세요.');

      const channel = (proposal.channel.recommended || 'SMS').toUpperCase();
      const isLmsOrMms = channel === 'LMS' || channel === 'MMS';
      // LMS/MMS subject 필수 — AI가 안 줬으면 suggestedName 또는 회사명으로 fallback (17자 이내)
      const rawSubject = variant.subject || proposal.target.suggestedName || `${companyName || ''} AI 캠페인`.trim() || 'AI Operator';
      const subject = isLmsOrMms ? rawSubject.slice(0, 17) : '';

      // ★ D170+ (Harold 명시): 발송 시점 안전장치 박음 — AI 추천/즉시/사용자 직접 분기
      let scheduled = false;
      let scheduledAt: string | null = null;
      const now = Date.now();
      const MIN_FUTURE_MS = 60 * 1000; // 1분 이상 미래여야 예약 발송으로 박음

      if (sendMode === 'aiRecommended') {
        // AI 추천 시점이 미래면 예약, 과거/현재면 즉시 발송
        const recRaw = proposal.schedule.recommendedTime || '';
        if (recRaw) {
          const recDate = new Date(recRaw.replace(' ', 'T'));
          if (!isNaN(recDate.getTime()) && recDate.getTime() > now + MIN_FUTURE_MS) {
            scheduled = true;
            scheduledAt = recDate.toISOString();
          }
        }
      } else if (sendMode === 'immediate') {
        // 즉시 발송 — 사용자 명시 선택
        scheduled = false;
      } else if (sendMode === 'custom') {
        // 사용자가 직접 선택한 시점
        if (!customScheduledAt) {
          throw new Error('예약 발송 시점을 선택해주세요.');
        }
        const customDate = new Date(customScheduledAt);
        if (isNaN(customDate.getTime())) {
          throw new Error('예약 시점 형식이 올바르지 않습니다.');
        }
        if (customDate.getTime() <= now + MIN_FUTURE_MS) {
          throw new Error('예약 시점은 현재로부터 1분 이상 미래여야 합니다.');
        }
        // 발송 허용 시간대 (08:00 ~ 21:00 KST) — 한줄로 SEND_HOURS 정합
        const hour = customDate.getHours();
        if (hour < 8 || hour >= 21) {
          throw new Error('예약 시점은 08:00 ~ 21:00 사이여야 합니다.');
        }
        scheduled = true;
        scheduledAt = customDate.toISOString();
      }

      // ★ D170+ (Harold 명시 안전장치): 즉시 발송 시 사용자 확인 — 회수 불가 안내
      if (!scheduled) {
        const isAiPast = sendMode === 'aiRecommended';
        const confirmMsg = isAiPast
          ? `AI 추천 시점이 과거이거나 임박해서 ${recipients.length.toLocaleString()}명에게 지금 즉시 발송됩니다.\n발송 후 회수 불가합니다. 진행하시겠습니까?`
          : `${recipients.length.toLocaleString()}명에게 지금 즉시 발송됩니다.\n발송 후 회수 불가합니다. 진행하시겠습니까?`;
        if (!window.confirm(confirmMsg)) {
          setSending(false);
          setSendError(null);
          return;
        }
      }

      // 3. 발송 (기존 /direct-send 재사용 — 검증된 흐름 + 라인그룹/중복제거/회신번호 가드 자동)
      const sendRes = await fetch('/api/campaigns/direct-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          msgType: channel,
          subject,
          message: body,
          callback: previewData.defaultCallback,
          recipients,
          adEnabled: !!proposal.channel.isAd,
          scheduled,
          scheduledAt,
          sendChannel: 'sms',
          dedupEnabled: true,
          unsubFilterEnabled: true,
        }),
      });
      const sendData = await sendRes.json();
      if (!sendRes.ok || !sendData.success) {
        throw new Error(sendData.error || '발송 처리 실패');
      }

      setSendResult({
        campaignId: sendData.campaignId,
        sentCount: sendData.sentCount || 0,
        failCount: sendData.failCount || 0,
        unsubscribeCount: sendData.unsubscribeCount || 0,
        message: sendData.message || '',
        suggestedName: proposal.target.suggestedName || 'AI Operator 캠페인',
      });
    } catch (err) {
      setSendError(err instanceof Error ? err.message : '발송 오류가 발생했습니다.');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const doneCount = SESSION_MILESTONES.filter((m) => m.status === 'done').length;
  const progress = Math.round((doneCount / SESSION_MILESTONES.length) * 100);

  const showAbout = !loading && !proposal;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-purple-950 to-fuchsia-950 text-white">
      {/* 배경 글로우 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-fuchsia-500/10 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-purple-500/5 blur-3xl" />
      </div>

      {/* 헤더 */}
      <header className="relative border-b border-white/10 backdrop-blur-md bg-white/5 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-all text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            대시보드로 돌아가기
          </button>

          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-300 to-fuchsia-400 flex items-center justify-center shadow-lg shadow-fuchsia-500/30">
              <Sparkles className="w-5 h-5 text-indigo-950" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold bg-gradient-to-r from-amber-200 via-fuchsia-200 to-indigo-200 bg-clip-text text-transparent">
                AI Operator
              </span>
              <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-fuchsia-400 text-indigo-950">
                BETA
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* 메인 본문 */}
      <main className="relative max-w-5xl mx-auto px-6 py-10 md:py-14">
        {/* ============= Hero + 입력창 (항상 표시 — 결과 모드에서도 상단 유지) ============= */}
        {!proposal && (
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/60 mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Enterprise Beta · Production 검증 중
            </div>
            <p className="text-xs font-semibold tracking-[0.32em] text-white/40 mb-3 uppercase">AI Marketing Operations</p>
            <h1 className="text-4xl md:text-5xl font-bold mb-5 leading-tight bg-gradient-to-r from-amber-200 via-fuchsia-200 to-indigo-200 bg-clip-text text-transparent">
              한 줄 명령으로 작동하는<br />차세대 마케팅 오퍼레이션
            </h1>
            <p className="text-white/60 text-base md:text-lg max-w-2xl mx-auto leading-relaxed">
              마케팅 목표를 한 줄로 입력하시면, AI가 타겟팅 · 메시지 · 채널 · 시점 · 비용 · 성과까지<br className="hidden md:block" />
              자동 설계한 제안서를 즉시 제공합니다.
            </p>
          </div>
        )}

        {/* 입력 영역 (항상 노출 — 결과 모드에서는 축소된 형태로) */}
        <div className={`mb-${proposal ? '10' : '6'} ${proposal ? 'mt-2' : ''}`}>
          <div className="relative group">
            {/* 그라데이션 보더 */}
            <div className="absolute -inset-px rounded-2xl bg-gradient-to-r from-amber-400/40 via-fuchsia-400/40 to-indigo-400/40 opacity-60 group-focus-within:opacity-100 blur-sm transition-opacity" />
            <div className="relative flex items-end gap-3 p-2 rounded-2xl bg-indigo-950/80 backdrop-blur-xl border border-white/10">
              <div className="flex-shrink-0 ml-3 mb-3">
                <Sparkles className="w-5 h-5 text-amber-300" />
              </div>
              <textarea
                ref={textareaRef}
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="예: 최근 30일 미구매 VIP에게 재구매 쿠폰 보내줘"
                disabled={loading}
                rows={1}
                className="flex-1 bg-transparent text-white placeholder-white/30 px-1 py-3 resize-none focus:outline-none text-base leading-relaxed min-h-[44px] max-h-[200px] disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading || objective.trim().length < 5}
                className="flex-shrink-0 px-5 py-3 rounded-xl bg-gradient-to-r from-amber-400 to-fuchsia-400 text-indigo-950 font-semibold hover:brightness-110 hover:shadow-lg hover:shadow-fuchsia-500/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                aria-label="AI 제안서 생성"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                <span className="hidden sm:inline">{loading ? '생성 중' : '생성'}</span>
              </button>
            </div>
          </div>
          <div className="mt-2.5 flex items-center justify-between px-2 text-[11px] text-white/35">
            <span>⌘ + Enter 단축키로 즉시 제출</span>
            <span>{objective.length} chars</span>
          </div>

          {error && (
            <div className="mt-3 p-3 rounded-lg bg-rose-500/10 border border-rose-400/30 text-rose-200 text-sm">
              {error}
            </div>
          )}

          {/* 예시 프롬프트 칩 (입력 전만) */}
          {!loading && !proposal && objective.length === 0 && (
            <div className="mt-5">
              <p className="text-[11px] font-semibold tracking-[0.2em] text-white/35 uppercase mb-2.5">Suggested Prompts</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setObjective(p);
                      textareaRef.current?.focus();
                    }}
                    className="px-3.5 py-1.5 text-xs rounded-full bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:border-white/20 hover:text-white transition-all"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ============= Loading State — 6 sub-agent 시각화 ============= */}
        {loading && (
          <div className="mb-14 animate-in fade-in duration-300">
            <div className="text-center mb-8">
              <p className="text-[11px] font-semibold tracking-[0.28em] text-white/40 uppercase mb-2">AI Operator · Multi-Agent Pipeline</p>
              <p className="text-white/70 text-sm">6개 sub-agent가 협업하여 제안서를 설계하고 있습니다</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {SUB_AGENT_STEPS.map((step, idx) => {
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
                          <Check className="w-5 h-5 text-white" strokeWidth={3} />
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
        )}

        {/* ============= 결과 영역 — 6 카드 그리드 ============= */}
        {proposal && !loading && (
          <div className="mb-14">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.28em] text-white/40 uppercase mb-1">AI Proposal · Generated</p>
                <h2 className="text-xl font-bold text-white">{proposal.target.suggestedName || 'AI 마케팅 제안서'}</h2>
              </div>
              <span className="text-xs text-white/40">
                {new Date(proposal.meta.generatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 생성
              </span>
            </div>

            {/* ★ D170: Compliance Sub-agent 경고 표시 — high/medium만 노출, low는 ShieldCheck 작은 표시 */}
            {proposal.compliance && (
              <>
                {(proposal.compliance.riskLevel !== 'low' || !proposal.compliance.passed) && (
                  <div className={`mb-5 p-4 rounded-xl border backdrop-blur-xl ${
                    proposal.compliance.riskLevel === 'high'
                      ? 'bg-rose-500/10 border-rose-400/40'
                      : 'bg-amber-500/10 border-amber-400/40'
                  }`}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <AlertTriangle className={`w-4 h-4 ${proposal.compliance.riskLevel === 'high' ? 'text-rose-300' : 'text-amber-300'}`} />
                      <p className={`text-sm font-semibold ${proposal.compliance.riskLevel === 'high' ? 'text-rose-100' : 'text-amber-100'}`}>
                        Compliance Check · {proposal.compliance.riskLevel === 'high' ? '발송 차단 권장' : '검토 필요'}
                      </p>
                    </div>
                    {proposal.compliance.warnings.length > 0 && (
                      <ul className="text-xs text-white/75 space-y-1 mb-2">
                        {proposal.compliance.warnings.map((w, i) => (
                          <li key={i} className="flex gap-1.5"><span className="opacity-60">·</span><span>{w}</span></li>
                        ))}
                      </ul>
                    )}
                    {proposal.compliance.suggestions.length > 0 && (
                      <ul className="text-xs text-white/60 space-y-1 mt-2 pt-2 border-t border-white/10">
                        {proposal.compliance.suggestions.map((s, i) => (
                          <li key={i} className="flex gap-1.5"><span className="opacity-60">→</span><span>{s}</span></li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {proposal.compliance.riskLevel === 'low' && proposal.compliance.passed && (
                  <div className="mb-5 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-400/30 text-xs">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
                    <span className="text-emerald-200">Compliance Check 통과</span>
                  </div>
                )}
              </>
            )}

            {(() => {
              // ★ D165: 메시지 3안 토글 — 다듬기 결과가 있으면 오버라이드 사용
              const variants = proposal.messages;
              const safeIdx = Math.min(selectedVariantIdx, Math.max(0, variants.length - 1));
              const activeVariant = variants[safeIdx];
              const isRecommended = (proposal.recommendation || '').includes(activeVariant?.variantId || '__none__')
                || (proposal.recommendation || '').includes(activeVariant?.variantName || '__none__');
              const activeChannel = (proposal.channel.recommended || 'SMS').toUpperCase();
              const overrideText = refinedOverrides[safeIdx];
              const baseBody = activeVariant?.body || '';
              const rawActiveBody = overrideText || baseBody;
              // ★ Harold 명시 (2026-05-19): 광고 메시지면 (광고) prefix + 무료거부 suffix 자동 합성 — 실제 발송 형태 미리보기
              //   원본(rawActiveBody)은 다듬기/발송 시 그대로 사용. 표시(activeBody)만 합성 — 실 발송은 /direct-send가 adEnabled=true로 자동 박음.
              const isAd = !!proposal.channel.isAd;
              const rawReject = proposal.channel.rejectNumber || '';
              const formattedReject = rawReject
                ? rawReject.replace(/[^0-9]/g, '').replace(/^(\d{3,4})(\d{3,4})(\d{4})$/, '$1-$2-$3')
                : '';
              const activeBody = (isAd && rawReject && rawActiveBody)
                ? `(광고)\n${rawActiveBody}\n무료거부 ${formattedReject || rawReject}`
                : rawActiveBody;
              const bytesLen = (s: string) => {
                let bytes = 0;
                for (let i = 0; i < s.length; i++) {
                  const code = s.charCodeAt(i);
                  bytes += code > 0x7F ? 2 : 1;
                }
                return bytes;
              };
              const activeBytes = bytesLen(activeBody);

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  {/* ============= 추천 메시지 (full width — D165 핵심 인터랙션) ============= */}
                  <ResultCard
                    index={0}
                    accent="amber"
                    icon={MessageSquare}
                    label="추천 메시지"
                    headline={activeVariant?.variantName || '문안'}
                    subtitle={`${variants.length}개 안 생성 · ${activeChannel} · ${activeBytes} bytes${overrideText ? ' · 다듬어진 안' : ''}`}
                    truncateHeadline={false}
                    className="md:col-span-2"
                    extra={
                      <div className="mt-3">
                        {/* 3안 토글 탭 */}
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                          {variants.map((v, idx) => {
                            const isActive = idx === safeIdx;
                            const isAnswerRecommended = (proposal.recommendation || '').includes(v.variantId)
                              || (proposal.recommendation || '').includes(v.variantName);
                            return (
                              <button
                                key={v.variantId}
                                type="button"
                                onClick={() => setSelectedVariantIdx(idx)}
                                className={`group/tab relative px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                                  isActive
                                    ? 'bg-gradient-to-r from-amber-400/30 to-fuchsia-400/30 text-white border border-amber-300/40 shadow-md'
                                    : 'bg-white/[0.04] text-white/55 border border-white/10 hover:bg-white/[0.08] hover:text-white/80'
                                }`}
                              >
                                {isAnswerRecommended && (
                                  <Star className={`w-3 h-3 ${isActive ? 'text-amber-300 fill-amber-300' : 'text-amber-400/60 fill-amber-400/60'}`} />
                                )}
                                <span>{v.variantName || `${String.fromCharCode(65 + idx)}안`}</span>
                                {v.score > 0 && (
                                  <span className={`ml-0.5 text-[10px] tabular-nums ${isActive ? 'text-amber-200' : 'text-white/40'}`}>
                                    {v.score}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                          {isRecommended && (
                            <span className="ml-auto text-[10px] font-semibold tracking-[0.2em] uppercase text-amber-300/80">
                              AI Recommended
                            </span>
                          )}
                        </div>

                        {/* 콘셉트 */}
                        {activeVariant?.concept && (
                          <p className="text-xs text-white/45 mb-2">
                            <span className="font-semibold text-white/60">콘셉트:</span> {activeVariant.concept}
                          </p>
                        )}

                        {/* 본문 박스 */}
                        <div className="relative p-4 rounded-xl bg-indigo-950/60 border border-white/10 mb-3">
                          <pre className="whitespace-pre-wrap break-words text-sm text-white/85 leading-relaxed font-sans">
                            {activeBody || '메시지 본문이 비어있습니다.'}
                          </pre>
                          {overrideText && (
                            <button
                              type="button"
                              onClick={() => setRefinedOverrides((prev) => {
                                const next = { ...prev };
                                delete next[safeIdx];
                                return next;
                              })}
                              className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 hover:bg-emerald-500/30 transition-all"
                              title="원본 안으로 되돌리기"
                            >
                              다듬어짐 · 되돌리기
                            </button>
                          )}
                        </div>

                        {/* 메시지 액션 */}
                        <div className="flex gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setShowRefineModal(true)}
                            disabled={!activeBody}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-amber-400/20 to-fuchsia-400/20 text-amber-100 border border-amber-300/30 hover:from-amber-400/30 hover:to-fuchsia-400/30 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                          >
                            <Wand2 className="w-3.5 h-3.5" />
                            AI로 다듬기
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!activeBody) return;
                              navigator.clipboard.writeText(activeBody).then(() => {
                                setCopiedAt(Date.now());
                                setTimeout(() => setCopiedAt(null), 1500);
                              });
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-white/70 border border-white/10 hover:bg-white/10 hover:text-white transition-all"
                          >
                            {copiedAt ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                            {copiedAt ? '복사 완료' : '본문 복사'}
                          </button>
                        </div>
                      </div>
                    }
                  />

                  {/* ============= 추천 타겟 ============= */}
                  <ResultCard
                    index={1}
                    accent="rose"
                    icon={Target}
                    label="추천 타겟"
                    headline={`${proposal.target.count.toLocaleString()}명`}
                    subtitle={`전체 ${proposal.target.totalCount.toLocaleString()}명 중 ${proposal.target.totalCount > 0 ? ((proposal.target.count / proposal.target.totalCount) * 100).toFixed(1) : 0}%`}
                    description={proposal.target.criteria}
                  />

                  {/* ============= 추천 채널 ============= */}
                  <ResultCard
                    index={2}
                    accent="emerald"
                    icon={Send}
                    label="추천 채널"
                    headline={proposal.channel.recommended}
                    subtitle={proposal.channel.isAd ? '광고 메시지 (Ad)' : '정보 메시지 (Info)'}
                    description={proposal.channel.reason}
                  />

                  {/* ============= 발송 시점 — D170+ Harold 명시: 사용자 변경 가능 + 안전장치 ============= */}
                  <ResultCard
                    index={3}
                    accent="cyan"
                    icon={Clock}
                    label="발송 시점"
                    headline={
                      sendMode === 'immediate'
                        ? '지금 즉시 발송'
                        : sendMode === 'custom' && customScheduledAt
                          ? formatScheduleTime(customScheduledAt)
                          : formatScheduleTime(proposal.schedule.recommendedTime)
                    }
                    subtitle={
                      sendMode === 'aiRecommended'
                        ? 'AI 추천 · KST'
                        : sendMode === 'immediate'
                          ? '사용자 선택 · 즉시'
                          : '사용자 선택 · 예약'
                    }
                    truncateHeadline={false}
                    extra={
                      <div className="mt-3 space-y-2">
                        {/* AI 추천 시점 — radio */}
                        <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white/[0.04] border border-white/10 hover:bg-white/[0.07] cursor-pointer transition-all">
                          <input
                            type="radio"
                            name="sendMode"
                            checked={sendMode === 'aiRecommended'}
                            onChange={() => setSendMode('aiRecommended')}
                            className="mt-0.5 accent-cyan-400"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-white">AI 추천 시점 사용</p>
                            <p className="text-[11px] text-white/55 mt-0.5">{formatScheduleTime(proposal.schedule.recommendedTime)} 자동 예약</p>
                          </div>
                        </label>

                        {/* 즉시 발송 — radio */}
                        <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white/[0.04] border border-white/10 hover:bg-white/[0.07] cursor-pointer transition-all">
                          <input
                            type="radio"
                            name="sendMode"
                            checked={sendMode === 'immediate'}
                            onChange={() => setSendMode('immediate')}
                            className="mt-0.5 accent-amber-400"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-white">지금 즉시 발송</p>
                            <p className="text-[11px] text-white/55 mt-0.5">승인 클릭 즉시 발송 큐 진입</p>
                          </div>
                        </label>

                        {/* 사용자 직접 선택 — radio + datetime input */}
                        <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white/[0.04] border border-white/10 hover:bg-white/[0.07] cursor-pointer transition-all">
                          <input
                            type="radio"
                            name="sendMode"
                            checked={sendMode === 'custom'}
                            onChange={() => setSendMode('custom')}
                            className="mt-0.5 accent-fuchsia-400"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-white mb-1.5">직접 시점 선택</p>
                            <input
                              type="datetime-local"
                              value={customScheduledAt}
                              onChange={(e) => {
                                setCustomScheduledAt(e.target.value);
                                if (e.target.value) setSendMode('custom');
                              }}
                              min={(() => {
                                const d = new Date(Date.now() + 5 * 60 * 1000); // 5분 후 최소
                                const pad = (n: number) => String(n).padStart(2, '0');
                                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                              })()}
                              disabled={sendMode !== 'custom'}
                              className="w-full px-2 py-1 rounded-md bg-indigo-950/60 border border-white/15 text-white text-xs disabled:opacity-50 disabled:cursor-not-allowed [color-scheme:dark]"
                            />
                            <p className="text-[10px] text-white/40 mt-1">발송 허용 시간 · 08:00 ~ 21:00 KST</p>
                          </div>
                        </label>
                      </div>
                    }
                  />

                  {/* ============= 예상 비용 (breakdown 강화) ============= */}
                  <ResultCard
                    index={4}
                    accent="violet"
                    icon={DollarSign}
                    label="예상 비용"
                    headline={`${proposal.cost.estimated.toLocaleString()}원`}
                    subtitle={`${activeChannel} ${proposal.target.count.toLocaleString()}건`}
                    truncateHeadline={false}
                    extra={
                      <div className="mt-2 space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-white/60 px-2 py-1.5 rounded-md bg-white/5 border border-white/10">
                          <span>건당 단가</span>
                          <span className="font-mono font-semibold text-white">{proposal.cost.unitCost.toLocaleString()}원</span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-white/60 px-2 py-1.5 rounded-md bg-white/5 border border-white/10">
                          <span>발송 건수</span>
                          <span className="font-mono font-semibold text-white">{proposal.target.count.toLocaleString()}건</span>
                        </div>
                        <div className="flex items-center justify-between text-xs px-2 py-1.5 rounded-md bg-gradient-to-r from-violet-500/15 to-purple-500/15 border border-violet-400/30">
                          <span className="font-semibold text-violet-200">총 예상 비용</span>
                          <span className="font-mono font-bold text-white">{proposal.cost.estimated.toLocaleString()}원</span>
                        </div>
                      </div>
                    }
                  />

                  {/* ============= 예상 성과 (full width — 미니 차트) ============= */}
                  <ResultCard
                    index={5}
                    accent="fuchsia"
                    icon={LineChart}
                    label="예상 성과"
                    headline={`+${proposal.performance.expectedRevenue.toLocaleString()}원`}
                    subtitle="고객 평균 매출 × 예상 전환 수 기반 추정"
                    truncateHeadline={false}
                    className="md:col-span-2"
                    extra={
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {/* 클릭률 */}
                        <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-semibold tracking-wider uppercase text-fuchsia-200">예상 클릭</span>
                            <span className="text-xs font-mono font-bold text-white">{proposal.performance.expectedClicks.toLocaleString()}</span>
                          </div>
                          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-fuchsia-400 to-pink-400 rounded-full transition-all duration-700"
                              style={{ width: `${Math.min(100, proposal.performance.clickRate * 100 * 10)}%` }}
                            />
                          </div>
                          <p className="text-[10px] text-white/40 mt-1">CTR {(proposal.performance.clickRate * 100).toFixed(1)}%</p>
                        </div>

                        {/* 전환률 */}
                        <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-semibold tracking-wider uppercase text-fuchsia-200">예상 전환</span>
                            <span className="text-xs font-mono font-bold text-white">{proposal.performance.expectedConversions.toLocaleString()}</span>
                          </div>
                          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-amber-400 to-rose-400 rounded-full transition-all duration-700"
                              style={{ width: `${Math.min(100, proposal.performance.conversionRate * 100 * 30)}%` }}
                            />
                          </div>
                          <p className="text-[10px] text-white/40 mt-1">CVR {(proposal.performance.conversionRate * 100).toFixed(2)}%</p>
                        </div>

                        {/* ROI */}
                        <div className="p-3 rounded-xl bg-gradient-to-br from-fuchsia-500/10 to-pink-500/10 border border-fuchsia-400/30">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-semibold tracking-wider uppercase text-fuchsia-200">예상 ROI</span>
                            <span className="text-xs font-mono font-bold text-white">
                              {proposal.cost.estimated > 0
                                ? `${Math.round((proposal.performance.expectedRevenue / proposal.cost.estimated) * 100).toLocaleString()}%`
                                : '—'}
                            </span>
                          </div>
                          <p className="text-[10px] text-white/55 mt-2 leading-relaxed">
                            매출 {proposal.performance.expectedRevenue.toLocaleString()}원<br />
                            ÷ 비용 {proposal.cost.estimated.toLocaleString()}원
                          </p>
                        </div>
                      </div>
                    }
                  />
                </div>
              );
            })()}

            {/* ★ D166: 승인 발송 활성화 — preview-recipients + /direct-send 2-step */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={handleApprove}
                disabled={sending}
                className="flex-1 px-6 py-3.5 rounded-xl bg-gradient-to-r from-amber-400 via-fuchsia-400 to-indigo-400 text-indigo-950 font-semibold hover:brightness-110 hover:shadow-xl hover:shadow-fuchsia-500/40 disabled:opacity-50 disabled:cursor-wait transition-all flex items-center justify-center gap-2"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {sending ? '발송 처리 중...' : '승인 후 발송 시작'}
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={sending}
                className="px-6 py-3.5 rounded-xl bg-white/10 text-white font-medium border border-white/20 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                다시 생성
              </button>
            </div>

            {/* 발송 에러 */}
            {sendError && (
              <div className="mt-3 p-3 rounded-lg bg-rose-500/10 border border-rose-400/30 text-rose-200 text-sm">
                <span className="font-semibold">발송 오류 · </span>{sendError}
              </div>
            )}

            {/* 메시지 추천 이유 (작게) */}
            {proposal.recommendationReason && (
              <div className="mt-6 p-4 rounded-xl bg-white/[0.03] border border-white/10">
                <p className="text-[10px] font-semibold tracking-[0.22em] text-white/40 uppercase mb-1.5">AI Recommendation Reason</p>
                <p className="text-sm text-white/70 leading-relaxed">{proposal.recommendationReason}</p>
              </div>
            )}
          </div>
        )}

        {/* ============= About (입력 전만 표시) ============= */}
        {showAbout && (
          <>
            {/* 진행률 카드 */}
            <div className="max-w-3xl mx-auto mb-12 p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-white font-semibold text-sm">Step 0 · Operations Foundation</h3>
                  <p className="text-xs text-white/50 mt-0.5">9-Phase 분할 · Enterprise AI Marketing Operations 아키텍처 구축</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold bg-gradient-to-r from-amber-300 to-fuchsia-400 bg-clip-text text-transparent">
                    {progress}%
                  </div>
                  <div className="text-xs text-white/40">{doneCount} / {SESSION_MILESTONES.length}</div>
                </div>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 via-fuchsia-400 to-indigo-400 rounded-full shadow-lg shadow-fuchsia-500/50 transition-all duration-700"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* 7 엔진 카드 */}
            <div className="mb-14">
              <p className="text-[10px] font-semibold tracking-[0.28em] text-white/40 mb-1.5 uppercase">Core AI Engines</p>
              <h2 className="text-xl font-bold mb-1.5 text-white">7 코어 엔진 아키텍처</h2>
              <p className="text-sm text-white/50 mb-6">Simple outside, Enterprise-grade inside — 단순한 인터페이스 뒤에서 7개 코어 엔진이 협업합니다</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {ENGINE_CARDS.map((card) => {
                  const Icon = card.icon;
                  return (
                    <div
                      key={card.title}
                      className="group relative p-5 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 hover:bg-white/10 hover:border-white/20 hover:scale-[1.02] transition-all duration-300"
                    >
                      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${card.gradient} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform`}>
                        <Icon className="w-6 h-6 text-white" />
                      </div>
                      <h3 className="text-white font-semibold text-base mb-1.5">{card.title}</h3>
                      <p className="text-white/60 text-xs leading-relaxed">{card.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 9 세션 로드맵 */}
            <div className="mb-14">
              <p className="text-[10px] font-semibold tracking-[0.28em] text-white/40 mb-1.5 uppercase">Development Roadmap</p>
              <h2 className="text-xl font-bold mb-1.5 text-white">Step 0 · 9-Phase Delivery</h2>
              <p className="text-sm text-white/50 mb-6">Phase 단위 분할 출시 · 각 단계 tsc 0 errors + atomic safe-build 검증 통과 후 진입</p>
              <div className="space-y-2">
                {SESSION_MILESTONES.map((m) => {
                  const cfg = STATUS_CONFIG[m.status];
                  const Icon = cfg.icon;
                  return (
                    <div
                      key={m.d}
                      className={`flex items-center gap-4 p-4 rounded-xl border ${
                        m.status === 'done' ? 'bg-white/[0.07] border-emerald-400/20' :
                        m.status === 'next' ? 'bg-gradient-to-r from-amber-400/10 to-fuchsia-400/10 border-fuchsia-400/30' :
                        'bg-white/[0.02] border-white/5'
                      } ${cfg.ring} transition-all`}
                    >
                      <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center ring-2 ${cfg.ring} ${cfg.bg}`}>
                        <Icon className={`w-4 h-4 ${m.status === 'planned' ? 'text-white/40' : 'text-white'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-xs font-mono font-bold ${cfg.text}`}>{m.d}</span>
                          <span className={`text-[10px] uppercase tracking-wider ${cfg.text}`}>· {cfg.label}</span>
                        </div>
                        <p className={`text-sm ${m.status === 'planned' ? 'text-white/40' : 'text-white/85'}`}>
                          {m.title}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 출시 안내 */}
            <div className="max-w-3xl mx-auto p-8 rounded-2xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10 text-center backdrop-blur-xl">
              <div className="inline-flex w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-300 to-fuchsia-400 items-center justify-center mb-4 shadow-lg shadow-fuchsia-500/30">
                <Sparkles className="w-6 h-6 text-indigo-950" />
              </div>
              <p className="text-[10px] font-semibold tracking-[0.3em] text-white/40 mb-2 uppercase">Enterprise Beta Program</p>
              <h3 className="text-xl font-bold mb-3">Production 검증 단계 운영 중</h3>
              <p className="text-sm text-white/60 mb-5 leading-relaxed">
                Production 안정성 검증 완료 후 PRO · BASIC 등급으로 순차 확장됩니다.<br />
                검증 단계의 개선 피드백은 즉시 반영됩니다.
              </p>
              <div className="flex items-center justify-center gap-3 text-xs text-white/50">
                <span>GA 2026 Q3</span>
                <span className="w-1 h-1 rounded-full bg-white/30" />
                <span>Enterprise Inquiry · mobile@invitocorp.com</span>
              </div>
            </div>
          </>
        )}
      </main>

      {/* ★ D166: 발송 결과 모달 — 발송 처리 완료 후 큰 체크 + 캠페인 정보 + dashboard 발송결과 진입 */}
      {sendResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => setSendResult(null)}
        >
          <div
            className="relative w-full max-w-md rounded-3xl border border-white/10 shadow-2xl bg-gradient-to-br from-emerald-950 via-teal-950 to-indigo-950 animate-in fade-in zoom-in-95 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 배경 글로우 */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
              <div className="absolute -top-20 -left-20 w-72 h-72 rounded-full bg-emerald-500/20 blur-3xl" />
              <div className="absolute -bottom-20 -right-20 w-72 h-72 rounded-full bg-teal-500/20 blur-3xl" />
            </div>

            <div className="relative p-8">
              <button
                type="button"
                onClick={() => setSendResult(null)}
                className="absolute top-5 right-5 w-9 h-9 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
                aria-label="닫기"
              >
                <X className="w-5 h-5" />
              </button>

              {/* 큰 체크 아이콘 */}
              <div className="flex justify-center mb-5">
                <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-2xl shadow-emerald-500/40">
                  <CheckCircle2 className="w-12 h-12 text-white" strokeWidth={2.5} />
                  <span className="absolute inset-0 rounded-full bg-emerald-400/30 animate-ping" />
                </div>
              </div>

              <div className="text-center mb-6">
                <p className="text-[10px] font-semibold tracking-[0.3em] uppercase text-emerald-300 mb-2">Campaign Dispatched</p>
                <h3 className="text-2xl font-bold text-white mb-1.5">발송 처리 완료</h3>
                <p className="text-sm text-white/70 truncate" title={sendResult.suggestedName}>{sendResult.suggestedName}</p>
              </div>

              {/* 결과 숫자 */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-center">
                  <p className="text-[10px] font-semibold tracking-wider uppercase text-emerald-300 mb-1.5">발송 성공</p>
                  <p className="text-2xl font-bold text-white tabular-nums">{sendResult.sentCount.toLocaleString()}</p>
                  <p className="text-[11px] text-white/40 mt-0.5">건</p>
                </div>
                <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-center">
                  <p className="text-[10px] font-semibold tracking-wider uppercase text-white/40 mb-1.5">발송 실패</p>
                  <p className={`text-2xl font-bold tabular-nums ${sendResult.failCount > 0 ? 'text-rose-300' : 'text-white/30'}`}>
                    {sendResult.failCount.toLocaleString()}
                  </p>
                  <p className="text-[11px] text-white/40 mt-0.5">건 {sendResult.failCount > 0 ? '· 자동 환불' : ''}</p>
                </div>
              </div>

              {sendResult.message && (
                <div className="mb-5 p-3 rounded-lg bg-white/[0.03] border border-white/10">
                  <p className="text-xs text-white/65 leading-relaxed">{sendResult.message}</p>
                </div>
              )}

              {/* CTA */}
              <div className="flex flex-col sm:flex-row gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setSendResult(null);
                    navigate('/dashboard');
                  }}
                  className="flex-1 px-5 py-3 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 text-emerald-950 font-semibold hover:brightness-110 hover:shadow-lg hover:shadow-emerald-500/30 transition-all"
                >
                  발송 결과 보기
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSendResult(null);
                    handleReset();
                  }}
                  className="px-5 py-3 rounded-xl bg-white/10 text-white font-medium border border-white/20 hover:bg-white/20 transition-all"
                >
                  새 캠페인
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ★ D165: 메시지 다듬기 모달 — AiRefineModal 재사용 (D152 emerald 톤). 선택된 안 → AI 풍성화 → onApply로 오버라이드 박힘 */}
      <AiRefineModal
        isOpen={showRefineModal}
        originalMessage={(() => {
          if (!proposal) return '';
          const idx = Math.min(selectedVariantIdx, Math.max(0, proposal.messages.length - 1));
          const v = proposal.messages[idx];
          if (!v) return '';
          return refinedOverrides[idx] || v.body || '';
        })()}
        companyName={companyName}
        onClose={() => setShowRefineModal(false)}
        onApply={(text) => {
          setRefinedOverrides((prev) => ({ ...prev, [selectedVariantIdx]: text }));
          setShowRefineModal(false);
        }}
      />
    </div>
  );
}
