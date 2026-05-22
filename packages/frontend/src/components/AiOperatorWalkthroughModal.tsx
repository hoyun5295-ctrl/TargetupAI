/**
 * AiOperatorWalkthroughModal.tsx — AI Operator 첫 진입 안내 (D193 2026-05-22)
 *
 * 회사 admin 첫 진입 시 1회 표시 (localStorage 기반).
 * 5단계 walkthrough: 자연어 → 여정 생성 → 검토 → 활성화 → 통계.
 * "다시 보지 않기" 버튼 포함.
 */

import { useEffect, useState } from 'react';
import { ArrowRight, BarChart3, Edit2, MessageSquareText, Play, Sparkles, X } from 'lucide-react';

interface WalkthroughStep {
  icon: typeof Sparkles;
  gradient: string;
  title: string;
  description: string;
  highlight: string;
}

// ★ D209+ (Harold 명시 2026-05-23): 모든 description 2줄 한도 (~42~45자) 안 정합 — 카드 높이 정합성 + 신뢰 본질.
const STEPS: WalkthroughStep[] = [
  {
    icon: MessageSquareText,
    gradient: 'from-fuchsia-400 to-purple-500',
    title: '1. 자연어 한 줄 입력',
    description: '원하는 캠페인을 일상 한국어로 작성하면 AI가 회사 톤 + 시즌 + 메모리 통합 자동 설계.',
    highlight: '예: "VIP 고객 봄 인사 + 등급별 분기 메시지"',
  },
  {
    icon: Sparkles,
    gradient: 'from-violet-400 to-fuchsia-500',
    title: '2. AI 자동 여정 생성 (5~10초)',
    description: '회사 톤 + 시즌 + 메모리 통합 — 트리거 / 채널 / 메시지 / 회신번호 + Liquid 자동 결정.',
    highlight: '7 표준 시리즈 + Custom 자유 시나리오 지원',
  },
  {
    icon: Edit2,
    gradient: 'from-amber-400 to-orange-500',
    title: '3. 회사 admin 검토 + 편집',
    description: 'AI가 안내문 / 인사 / 감성 풍성 작성. 구체 혜택은 admin 직접 수정 + step별 톤 3 후보 추천.',
    highlight: '광고 / 무료거부 / 제목 자동 합성 — 발송 직전 정합',
  },
  {
    icon: Play,
    gradient: 'from-emerald-400 to-teal-500',
    title: '4. 활성화 + 자동 발송',
    description: 'placeholder 잔존 시 활성화 차단. 활성 후 5분 주기로 트리거 감지 + 단계별 자동 발송.',
    highlight: 'A/B Variant 자동 분배 + Bandit 효과 자동 최적화',
  },
  {
    icon: BarChart3,
    gradient: 'from-cyan-400 to-blue-500',
    title: '5. 실시간 통계 + 효과 분석',
    description: '진입 사용자 + step별 효과 + 등급 / 시간대 / 요일 + Bandit. 누적 데이터로 정확도 자동 향상.',
    highlight: 'AI가 효과 데이터 학습 — 시간 지날수록 정확도 ↑',
  },
  // ★ D209+ (Harold 명시 2026-05-23): STEP 6 — 곧 업데이트 + 기존 고객사 PRO 특별혜택 안내.
  {
    icon: Sparkles,
    gradient: 'from-amber-400 to-fuchsia-500',
    title: '6. 곧 업데이트됩니다',
    description: '현재 개발 진행 중. 기존 고객사는 PRO 요금제 사용 시 특별 혜택 진입 가능 (운영팀 안내).',
    highlight: '★ 기존 고객사 PRO — AI Operator 특별 진입 정합',
  },
];

const WALKTHROUGH_STORAGE_KEY = 'ai-operator-walkthrough-seen-v1';

interface AiOperatorWalkthroughModalProps {
  forceShow?: boolean;
  onClose?: () => void;
}

export default function AiOperatorWalkthroughModal({ forceShow, onClose }: AiOperatorWalkthroughModalProps) {
  const [show, setShow] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (forceShow) {
      setShow(true);
      return;
    }
    const seen = localStorage.getItem(WALKTHROUGH_STORAGE_KEY);
    if (!seen) setShow(true);
  }, [forceShow]);

  const handleClose = (dontShowAgain = false) => {
    // ★ D209+ (Harold 명시 2026-05-23): forceShow 영역 = 매번 표시 본질 — localStorage 영역 처리 X.
    //   AI Operator 첫 진입 안내 영역 (forceShow=undefined) 만 localStorage 저장 정합.
    if (dontShowAgain && !forceShow) {
      localStorage.setItem(WALKTHROUGH_STORAGE_KEY, '1');
    }
    setShow(false);
    onClose?.();
  };

  if (!show) return null;

  const step = STEPS[stepIdx];
  const Icon = step.icon;
  const isLast = stepIdx === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200" onClick={() => handleClose(false)}>
      <div
        className="relative w-full max-w-2xl rounded-3xl border border-white/10 shadow-2xl bg-gradient-to-br from-indigo-950 via-purple-950 to-fuchsia-950 overflow-hidden animate-in fade-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 배경 글로우 */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-20 -left-20 w-72 h-72 rounded-full bg-fuchsia-500/20 blur-3xl" />
          <div className="absolute -bottom-20 -right-20 w-72 h-72 rounded-full bg-indigo-500/20 blur-3xl" />
        </div>

        <div className="relative p-6 md:p-8">
          {/* 닫기 버튼 */}
          <button
            onClick={() => handleClose(false)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>

          {/* 진행 표시 */}
          <div className="flex items-center gap-1.5 mb-6">
            {STEPS.map((_, idx) => (
              <div
                key={idx}
                className={`h-1 rounded-full transition-all ${
                  idx === stepIdx ? 'w-8 bg-fuchsia-400' : idx < stepIdx ? 'w-4 bg-violet-400/60' : 'w-4 bg-white/10'
                }`}
              />
            ))}
            <span className="ml-2 text-[10px] text-white/40 font-mono">{stepIdx + 1} / {STEPS.length}</span>
          </div>

          {/* 콘텐츠 */}
          <div className="text-center">
            <div className={`w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br ${step.gradient} flex items-center justify-center shadow-lg mb-5`}>
              <Icon className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl md:text-2xl font-semibold text-white mb-3">{step.title}</h2>
            <p className="text-sm md:text-base text-white/70 leading-relaxed mb-4">{step.description}</p>
            <div className="inline-block px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-xs md:text-sm text-violet-200">
              {step.highlight}
            </div>
          </div>

          {/* 액션 버튼 */}
          <div className="flex items-center justify-between gap-3 mt-8">
            <button
              onClick={() => setStepIdx(Math.max(0, stepIdx - 1))}
              disabled={stepIdx === 0}
              className="px-4 py-2 text-sm text-white/60 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              이전
            </button>
            {isLast ? (
              <button
                onClick={() => handleClose(true)}
                className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-fuchsia-500 to-purple-500 hover:opacity-90 text-white text-sm font-medium flex items-center gap-2 transition-all"
              >
                시작하기 <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={() => setStepIdx(stepIdx + 1)}
                className="px-5 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium flex items-center gap-1.5 transition-colors"
              >
                다음 <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* ★ D209+ (Harold 명시 2026-05-23): 다시 보지 않기 영역 = forceShow 영역 일 때 표시 X (매번 표시 본질). */}
          {!forceShow && (
            <div className="mt-4 text-center">
              <button
                onClick={() => handleClose(true)}
                className="text-[11px] text-white/40 hover:text-white/60 underline-offset-2 hover:underline"
              >
                다시 보지 않기
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
