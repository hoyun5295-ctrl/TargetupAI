import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Brain,
  Check,
  Clock,
  DollarSign,
  LineChart,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  Sparkles,
  Target,
  Wand2,
  Workflow,
  Zap,
} from 'lucide-react';

// ============================================================
// 타입 정의
// ============================================================

interface ProposalMessage {
  variantId: string;
  variantName: string;
  concept: string;
  smsText: string;
  lmsText: string;
  kakaoText?: string;
  score: number;
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
  };
  schedule: {
    recommendedTime: string;
  };
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
  { d: 'D165', title: 'AI 제안서 카드 정합 디자인 강화', status: 'next' },
  { d: 'D166', title: '승인 → 발송 → 결과 reactive 흐름', status: 'planned' },
  { d: 'D167', title: 'Prompt Caching (callAIWithFallback 강화, 90% 비용 절감)', status: 'planned' },
  { d: 'D168', title: 'Tool Use SQL Loop (recommendTarget + relaxFilters 자동)', status: 'planned' },
  { d: 'D169', title: 'Extended Thinking (reasoning trace 노출)', status: 'planned' },
  { d: 'D170', title: '회사별 메모리 + Multi-agent (Orchestrator + Sub-agent)', status: 'planned' },
  { d: 'D171', title: 'Step 0 통합 검증 + ENTERPRISE 베타 운영 진입', status: 'planned' },
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
}

function ResultCard({ accent, icon: Icon, label, headline, subtitle, description, index }: ResultCardProps) {
  const tokens = ACCENT_TOKENS[accent];
  return (
    <div
      className={`group relative p-6 rounded-2xl bg-white/[0.04] backdrop-blur-xl border ${tokens.border} hover:bg-white/[0.07] hover:scale-[1.01] transition-all duration-300 shadow-lg ${tokens.glow} animate-in fade-in slide-in-from-bottom-3 fill-mode-both`}
      style={{ animationDelay: `${index * 60}ms`, animationDuration: '500ms' }}
    >
      <div className="flex items-start gap-4 mb-4">
        <div className={`flex-shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br ${tokens.iconBg} flex items-center justify-center shadow-lg`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] font-semibold tracking-[0.22em] uppercase mb-1 ${tokens.text}`}>{label}</p>
          <p className="text-2xl font-bold text-white truncate" title={headline}>{headline}</p>
          <p className="text-xs text-white/50 mt-0.5">{subtitle}</p>
        </div>
      </div>
      {description && (
        <p className="text-sm text-white/65 leading-relaxed pl-15 line-clamp-3">{description}</p>
      )}
    </div>
  );
}

// ============================================================
// 메인 페이지
// ============================================================

export default function AiOperatorPage() {
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [objective, setObjective] = useState('');
  const [loading, setLoading] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [proposal, setProposal] = useState<ProposalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    textareaRef.current?.focus();
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <ResultCard
                index={0}
                accent="rose"
                icon={Target}
                label="추천 타겟"
                headline={`${proposal.target.count.toLocaleString()}명`}
                subtitle={`전체 ${proposal.target.totalCount.toLocaleString()}명 중 ${proposal.target.totalCount > 0 ? ((proposal.target.count / proposal.target.totalCount) * 100).toFixed(1) : 0}%`}
                description={proposal.target.criteria}
              />
              <ResultCard
                index={1}
                accent="amber"
                icon={MessageSquare}
                label="추천 메시지"
                headline={proposal.messages[0]?.variantName || '문안'}
                subtitle={`${proposal.messages.length}개 안 생성 · ${proposal.recommendation || 'A안 추천'}`}
                description={proposal.messages[0]?.smsText || proposal.messages[0]?.lmsText || ''}
              />
              <ResultCard
                index={2}
                accent="emerald"
                icon={Send}
                label="추천 채널"
                headline={proposal.channel.recommended}
                subtitle={proposal.channel.isAd ? '광고 메시지' : '정보 메시지'}
                description={proposal.channel.reason}
              />
              <ResultCard
                index={3}
                accent="cyan"
                icon={Clock}
                label="발송 시점"
                headline={formatScheduleTime(proposal.schedule.recommendedTime)}
                subtitle="한국 시간 (KST)"
                description="AI 추천 최적 발송 시간 · 도착률 + 응답률 기반"
              />
              <ResultCard
                index={4}
                accent="violet"
                icon={DollarSign}
                label="예상 비용"
                headline={`${proposal.cost.estimated.toLocaleString()}원`}
                subtitle={proposal.cost.breakdown}
                description={`회사별 단가 자동 적용 · 단가 ${proposal.cost.unitCost.toLocaleString()}원/건`}
              />
              <ResultCard
                index={5}
                accent="fuchsia"
                icon={LineChart}
                label="예상 성과"
                headline={`+${proposal.performance.expectedRevenue.toLocaleString()}원`}
                subtitle={`클릭 ${proposal.performance.expectedClicks.toLocaleString()} · 전환 ${proposal.performance.expectedConversions.toLocaleString()}`}
                description={`예상 클릭률 ${(proposal.performance.clickRate * 100).toFixed(1)}% · 전환률 ${(proposal.performance.conversionRate * 100).toFixed(1)}% · 고객 평균 매출 기반 추정`}
              />
            </div>

            {/* CTA */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                disabled
                className="flex-1 px-6 py-3.5 rounded-xl bg-gradient-to-r from-amber-400 to-fuchsia-400 text-indigo-950 font-semibold opacity-40 cursor-not-allowed flex items-center justify-center gap-2"
                title="D166에서 박힐 예정"
              >
                <Send className="w-4 h-4" />
                승인 발송 <span className="text-[10px] font-mono opacity-70">D166</span>
              </button>
              <button
                type="button"
                disabled
                className="px-6 py-3.5 rounded-xl bg-white/5 text-white/70 font-medium border border-white/15 opacity-40 cursor-not-allowed flex items-center justify-center gap-2"
                title="D165에서 박힐 예정"
              >
                <Wand2 className="w-4 h-4" />
                메시지 다듬기 <span className="text-[10px] font-mono opacity-70">D165</span>
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="px-6 py-3.5 rounded-xl bg-white/10 text-white font-medium border border-white/20 hover:bg-white/15 transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                다시 생성
              </button>
            </div>

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
    </div>
  );
}
