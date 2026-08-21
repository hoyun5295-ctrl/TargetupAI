import { useEffect } from 'react';
import { Brain, Code, LineChart, MessageSquare, MousePointerClick, Send, Sparkles, Target, Workflow, X, Zap } from 'lucide-react';

interface BetaFeatureModalProps {
  show: boolean;
  onClose: () => void;
}

interface EngineCard {
  icon: typeof Target;
  gradient: string;
  title: string;
  description: string;
}

const ENGINE_CARDS: EngineCard[] = [
  {
    icon: Target,
    gradient: 'from-rose-400 to-pink-500',
    title: 'AI 타겟 엔진',
    description: '자연어 한 줄로 고객군 자동 추출 + SQL 검증 loop',
  },
  {
    icon: MessageSquare,
    gradient: 'from-amber-400 to-orange-500',
    title: 'AI 메시지 엔진',
    description: '채널별 A/B 문구 + 스팸 검수 + 톤 자동 조절',
  },
  {
    icon: Send,
    gradient: 'from-emerald-400 to-teal-500',
    title: '채널 의사결정',
    description: '고객별 최적 채널·시점·빈도 AI 자동 판단',
  },
  {
    icon: Workflow,
    gradient: 'from-cyan-400 to-blue-500',
    title: '여정 자동화 (Journey Builder)',
    description: '자연어 한 줄 → 7 표준 여정 자동 설계 + 메시지·대기·조건 step + 다채널(SMS/LMS/MMS/알림톡) + A/B Bandit 자동 최적화 + 진입 사용자/통계 실시간 모니터링',
  },
  {
    icon: Code,
    gradient: 'from-violet-400 to-fuchsia-500',
    title: 'Liquid 1:1 동적 콘텐츠',
    description: '사용자별 등급/지역/구매 분기 자동 처리: 1개 메시지 작성 + 무한 분기 자동 렌더링. {{ customer.name }} + {% if VIP %} 같은 Shopify Liquid 표준 호환',
  },
  {
    icon: Zap,
    gradient: 'from-amber-400 to-orange-500',
    title: '실시간 트리거',
    description: '장바구니/예약/구매 이벤트 자동 감지 → 여정 즉시 진입 → 1:1 맞춤 다채널 발송',
  },
  {
    icon: MousePointerClick,
    gradient: 'from-emerald-400 to-cyan-500',
    title: 'Click 트래킹 + 자동 매칭',
    description: '단축 URL 자동 변환 + 클릭 추적 + Bandit reward 자동 누적 + 알림톡 템플릿 AI 자동 매칭 (변수 자동 매핑)',
  },
  {
    icon: LineChart,
    gradient: 'from-fuchsia-400 to-pink-500',
    title: '성과 + Next Action',
    description: '매출/ROI/LTV + 등급별/시간대/요일별 효과 + 다음 캠페인 AI 자동 제안',
  },
  {
    icon: Brain,
    gradient: 'from-amber-400 to-rose-500',
    title: 'AI Operator',
    description: '회사별 메모리 학습 + 시즌 컨텍스트 + 동적 흐름 결정 모드 + 회사 톤 자동 정합',
  },
];

export default function BetaFeatureModal({ show, onClose }: BetaFeatureModalProps) {
  useEffect(() => {
    if (!show) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [show, onClose]);

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div
        className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 shadow-2xl bg-gradient-to-br from-indigo-950 via-purple-950 to-fuchsia-950 animate-in fade-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 배경 글로우 효과 */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
          <div className="absolute -top-20 -left-20 w-96 h-96 rounded-full bg-fuchsia-500/20 blur-3xl" />
          <div className="absolute -bottom-20 -right-20 w-96 h-96 rounded-full bg-indigo-500/20 blur-3xl" />
        </div>

        <div className="relative p-8 md:p-10">
          {/* 닫기 버튼 */}
          <button
            type="button"
            onClick={onClose}
            className="absolute top-6 right-6 w-10 h-10 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>

          {/* 헤더 영역 */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-300 to-fuchsia-400 flex items-center justify-center shadow-lg shadow-fuchsia-500/30">
                <Sparkles className="w-6 h-6 text-indigo-950" />
              </div>
              <span className="text-[10px] font-bold tracking-[0.18em] px-2.5 py-1 rounded-full bg-gradient-to-r from-amber-400 to-fuchsia-400 text-indigo-950">
                ENTERPRISE BETA
              </span>
            </div>
            <p className="text-xs font-semibold tracking-[0.3em] text-white/40 mb-2 uppercase">AI Marketing Operations</p>
            <h2 className="text-3xl md:text-4xl font-bold mb-3 leading-tight bg-gradient-to-r from-amber-200 via-fuchsia-200 to-indigo-200 bg-clip-text text-transparent">
              한 줄로 작동하는<br className="hidden md:block" />차세대 마케팅 오퍼레이션
            </h2>
            <p className="text-white/70 text-sm md:text-base mb-5 leading-relaxed">
              자연어 한 줄 → 7 표준 여정 자동 설계 → 1:1 동적 콘텐츠(Liquid) → 다채널(SMS/LMS/MMS/알림톡) → A/B Bandit 자동 최적화 → Click 트래킹 → 성과 분석.
              엔터프라이즈 마케팅 자동운전 엔진.
            </p>
            <div className="flex items-center gap-3 text-xs text-white/50">
              <span>Enterprise Beta Program</span>
              <span className="w-1 h-1 rounded-full bg-white/30" />
              <span>Production 검증 단계</span>
              <span className="w-1 h-1 rounded-full bg-white/30" />
              <span>GA 2026 Q3</span>
            </div>
            <div className="mt-3 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full w-[35%] bg-gradient-to-r from-amber-400 via-fuchsia-400 to-indigo-400 rounded-full shadow-lg shadow-fuchsia-500/50" />
            </div>
          </div>

          {/* 7 엔진 카드 그리드 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {ENGINE_CARDS.map((card, idx) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.title}
                  className="group relative p-5 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 hover:bg-white/10 hover:border-white/20 hover:scale-[1.02] transition-all duration-300 animate-in fade-in slide-in-from-bottom-4 fill-mode-both"
                  style={{ animationDelay: `${idx * 50}ms`, animationDuration: '500ms' }}
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

          {/* 하단 CTA */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                window.location.href = 'mailto:mobile@invitocorp.com?subject=한줄로AI 엔터프라이즈 베타 문의';
              }}
              className="flex-1 px-8 py-3.5 rounded-xl bg-gradient-to-r from-amber-400 to-fuchsia-400 text-indigo-950 font-semibold hover:brightness-110 hover:shadow-lg hover:shadow-fuchsia-500/30 transition-all"
            >
              엔터프라이즈 문의하기
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-8 py-3.5 rounded-xl bg-white/10 text-white font-medium border border-white/20 hover:bg-white/20 transition-all"
            >
              출시 알림 신청
            </button>
          </div>

          {/* 하단 안내 */}
          <p className="mt-5 text-center text-xs text-white/40">
            본 기능은 엔터프라이즈 고객사 대상 베타 운영 중이며, 안정성 검증 후 단계적 확장됩니다.
          </p>
        </div>
      </div>
    </div>
  );
}
