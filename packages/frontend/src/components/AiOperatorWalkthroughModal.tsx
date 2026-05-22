/**
 * AiOperatorWalkthroughModal.tsx — AI Operator 첫 진입 안내 (D193 2026-05-22)
 *
 * 회사 admin 첫 진입 시 1회 표시 (localStorage 기반).
 * 5단계 walkthrough: 자연어 → 여정 생성 → 검토 → 활성화 → 통계.
 * "다시 보지 않기" 버튼 포함.
 */

import { useEffect, useState } from 'react';
import { ArrowRight, BarChart3, Edit2, LayoutGrid, MessageSquareText, Play, Sparkles, X } from 'lucide-react';
// ★ D210+ (Harold 명시 2026-05-23): STEP 6 메뉴 매트릭스 = AiOperatorPage와 단일 source 공통 사용.
import { SUB_MODULE_CARDS } from '../constants/ai-operator-modules';

interface WalkthroughStep {
  icon: typeof Sparkles;
  gradient: string;
  title: string;
  description: string;
  highlight: string;
}

// ★ D209+ (Harold 명시 2026-05-23): 모든 description 2줄 한도 안 정합 — 카드 높이 정합성 + 신뢰.
// ★ D210+ (Harold 명시 2026-05-23 추가 정정): 마케팅팀(중딩 수준) 친화 — AI 기술 용어(Liquid/Variant/Bandit/placeholder/admin/트리거) 일상 표현 + 비유 활용.
//   description \n = 의미 단위 줄바꿈 (whitespace-pre-line CSS 정합) — 더 친절하고 명료하게.
const STEPS: WalkthroughStep[] = [
  {
    icon: MessageSquareText,
    gradient: 'from-fuchsia-400 to-purple-500',
    title: '1. 자연어 한 줄 입력',
    description: '원하는 캠페인을 메신저 보내듯 편하게 한 줄만 적어주세요.\n우리 브랜드 톤과 이번 시즌 분위기까지 AI가 자동으로 맞춰줍니다.',
    highlight: '예) "VIP 고객한테 봄맞이 인사 보내줘"',
  },
  {
    icon: Sparkles,
    gradient: 'from-violet-400 to-fuchsia-500',
    title: '2. AI 자동 여정 생성 (5~10초)',
    description: 'AI가 5~10초 만에 언제·어디로(문자·알림톡)·어떤 문구로 보낼지 한 번에 설계해줍니다.\n자주 쓰는 7가지 시나리오 또는 원하는 대로 자유롭게 만들 수도 있어요.',
    highlight: '재구매·휴면·생일축하·신규가입 등 7가지 + 직접 만들기',
  },
  {
    icon: Edit2,
    gradient: 'from-amber-400 to-orange-500',
    title: '3. 검토 + 직접 수정',
    description: 'AI가 만든 인사말·본문을 한눈에 쭉 살펴보고 마음에 안 드는 부분만 수정하세요.\n할인율·쿠폰 금액·이벤트 내용은 마케팅팀이 직접 적어주세요.',
    highlight: '(광고) 표기·무료수신거부·제목까지 자동으로 합쳐드림',
  },
  {
    icon: Play,
    gradient: 'from-emerald-400 to-teal-500',
    title: '4. 활성화 + 자동 발송',
    description: '[직접 작성] 자리에 내용을 안 채우면 활성화 버튼이 잠겨서 실수로 발송되지 않아요.\n활성화하면 5분마다 조건에 맞는 고객을 찾아 단계별로 자동 발송합니다.',
    highlight: 'A안·B안 동시 발송 → AI가 효과 좋은 쪽으로 자동 비중 조절',
  },
  {
    icon: BarChart3,
    gradient: 'from-cyan-400 to-blue-500',
    title: '5. 실시간 통계 + 효과 분석',
    description: '어떤 고객이 받았고, 누가 열어봤고, 누가 실제로 구매했는지 한 화면에서 확인하세요.\n발송이 쌓일수록 AI가 우리 회사 고객 패턴을 더 정확하게 학습합니다.',
    highlight: '시간대·요일·등급별 클릭률·구매율까지 한눈에',
  },
  // ★ D210+ (Harold 명시 2026-05-23): STEP 6 = AI Operator 전체 메뉴 매트릭스 + 기존 고객사 특별 혜택 안내 통합.
  //   본문 영역 = SUB_MODULE_CARDS 10건 4열 그리드 (lg:grid-cols-4 × 3행) + 하단 안내 박스.
  //   사용자 본질 = 옛 영역 진입 시 어떤 메뉴 있는지 한 눈에 확인.
  {
    icon: LayoutGrid,
    gradient: 'from-amber-400 to-fuchsia-500',
    title: '6. AI Operator 전체 메뉴',
    description: '자연어 한 줄 외에도 쓸 수 있는 AI 기능 모음입니다.\n원하는 메뉴를 클릭하면 바로 해당 페이지로 이동돼요.',
    highlight: '기존 고객사는 PRO 요금제 사용 시 특별 혜택 받으실 수 있어요.\n자세한 내용은 운영팀에 문의해주세요.',
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
        className={`relative w-full ${isLast ? 'max-w-5xl' : 'max-w-2xl'} rounded-3xl border border-white/10 shadow-2xl bg-gradient-to-br from-indigo-950 via-purple-950 to-fuchsia-950 overflow-hidden animate-in fade-in zoom-in-95 duration-300 transition-[max-width]`}
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
            {isLast ? (
              <>
                {/* ★ D210+ (Harold 명시 2026-05-23): STEP 6 = 메뉴 매트릭스 + 하단 안내 박스 통합 — 사용자 한 눈에 메뉴 확인. */}
                <p className="text-sm text-white/60 leading-relaxed mb-5 whitespace-pre-line">{step.description}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-5 text-left">
                  {SUB_MODULE_CARDS.map((card) => {
                    const CardIcon = card.icon;
                    return (
                      <div
                        key={card.label}
                        className="group relative p-4 rounded-2xl bg-white/[0.06] border border-white/10 hover:bg-white/[0.12] hover:border-violet-400/40 hover:scale-[1.02] transition-all duration-300"
                      >
                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${card.gradient} flex items-center justify-center mb-2.5 shadow-lg`}>
                          <CardIcon className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          <h3 className="text-white font-semibold text-sm">{card.label}</h3>
                          {card.adminOnly && (
                            <span className="text-[8px] font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-amber-500/30 text-amber-200 border border-amber-400/30">관리자</span>
                          )}
                        </div>
                        <p className="text-white/55 text-[11px] leading-relaxed">{card.description}</p>
                      </div>
                    );
                  })}
                </div>
                <div className="rounded-xl p-4 bg-gradient-to-r from-amber-500/15 to-fuchsia-500/15 border border-amber-400/30 text-left">
                  <p className="text-xs font-semibold text-amber-200 mb-1.5 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    기존 고객사 특별 혜택
                  </p>
                  <p className="text-[11px] text-white/70 leading-relaxed whitespace-pre-line">{step.highlight}</p>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm md:text-base text-white/70 leading-relaxed mb-4 whitespace-pre-line">{step.description}</p>
                <div className="inline-block px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-xs md:text-sm text-violet-200">
                  {step.highlight}
                </div>
              </>
            )}
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
