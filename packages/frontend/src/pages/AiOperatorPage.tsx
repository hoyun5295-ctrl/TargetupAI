import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Brain,
  Check,
  Clock,
  LineChart,
  MessageSquare,
  Send,
  Sparkles,
  Target,
  Workflow,
  Zap,
} from 'lucide-react';

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
  { d: 'D164', title: '진입 wizard + 자연어 입력 메인 hero', status: 'next' },
  { d: 'D165', title: 'AI 제안서 통합 카드 (타겟 + 메시지 + 채널 + 시간 + 비용 + 성과)', status: 'planned' },
  { d: 'D166', title: '승인 → 발송 → 결과 reactive 흐름', status: 'planned' },
  { d: 'D167', title: 'Prompt Caching (callAIWithFallback 강화, 90% 비용 절감)', status: 'planned' },
  { d: 'D168', title: 'Tool Use SQL Loop (recommendTarget + relaxFilters 자동)', status: 'planned' },
  { d: 'D169', title: 'Extended Thinking (reasoning trace 노출)', status: 'planned' },
  { d: 'D170', title: '회사별 메모리 + Multi-agent (Orchestrator + Sub-agent 6~7)', status: 'planned' },
  { d: 'D171', title: 'Step 0 통합 검증 + ENTERPRISE 베타 운영 진입', status: 'planned' },
];

const STATUS_CONFIG: Record<MilestoneStatus, { icon: typeof Check; bg: string; ring: string; text: string; label: string }> = {
  done:    { icon: Check, bg: 'bg-gradient-to-br from-emerald-400 to-teal-500', ring: 'ring-emerald-400/30', text: 'text-emerald-300', label: '완료' },
  next:    { icon: Sparkles, bg: 'bg-gradient-to-br from-amber-400 to-fuchsia-500', ring: 'ring-fuchsia-400/40', text: 'text-amber-200', label: '다음 진행' },
  planned: { icon: Clock, bg: 'bg-white/10', ring: 'ring-white/10', text: 'text-white/40', label: '예정' },
};

export default function AiOperatorPage() {
  const navigate = useNavigate();
  const doneCount = SESSION_MILESTONES.filter((m) => m.status === 'done').length;
  const progress = Math.round((doneCount / SESSION_MILESTONES.length) * 100);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-purple-950 to-fuchsia-950 text-white">
      {/* 배경 글로우 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-fuchsia-500/10 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-purple-500/5 blur-3xl" />
      </div>

      {/* 헤더 */}
      <header className="relative border-b border-white/10 backdrop-blur-md bg-white/5">
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
              <Sparkles className="w-4.5 h-4.5 text-indigo-950" />
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
      <main className="relative max-w-7xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/60 mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Enterprise Beta · Production 검증 중
          </div>
          <p className="text-xs font-semibold tracking-[0.32em] text-white/40 mb-3 uppercase">AI Marketing Operations</p>
          <h1 className="text-4xl md:text-5xl font-bold mb-5 leading-tight bg-gradient-to-r from-amber-200 via-fuchsia-200 to-indigo-200 bg-clip-text text-transparent">
            한 줄로 작동하는<br />차세대 마케팅 오퍼레이션
          </h1>
          <p className="text-white/60 text-base md:text-lg max-w-2xl mx-auto leading-relaxed">
            타겟팅 · 메시지 · 채널 · 시점 · 여정 · 성과 분석까지 AI가 자동 설계 · 실행 · 학습합니다.<br className="hidden md:block" />
            마케터는 한 줄 명령으로 목표를 전달하고, AI 제안서를 검토 · 승인합니다.
          </p>
        </div>

        {/* 진행률 카드 */}
        <div className="max-w-3xl mx-auto mb-14 p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl">
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
            {ENGINE_CARDS.map((card, idx) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.title}
                  className="group relative p-5 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 hover:bg-white/10 hover:border-white/20 hover:scale-[1.02] transition-all duration-300"
                  style={{ animationDelay: `${idx * 50}ms` }}
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
      </main>
    </div>
  );
}
