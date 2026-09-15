/**
 * PlanFeatureModal — 요금제가 있어야 쓰는 기능의 공통 안내 창 (★ 2026-09-15 Harold 지시 · 목업 승인)
 *
 * 무엇을 하나
 *   메뉴는 요금제와 상관없이 모두에게 보인다. 요금제가 없는 회사가 기능을 누르면 이 창이 뜬다.
 *   "무슨 기능인지 → 이렇게 쓴다 3단계 → 드는 크레딧 → 스타터 요금제부터" 순서로 한 장에 보여준다.
 *
 * ⛔ 문안·아이콘·크레딧은 `constants/plan-feature-intros.ts` 한 곳이 소유한다. 이 파일에 기능 설명을 쓰지 않는다.
 * ⛔ 판정(열어 줄지)은 호출부가 서버 값으로 한다. 이 창은 보여주기만 한다.
 * 옛 PlanUpgradeModal(기능 7개만 설명 · 목록에 없으면 다른 기능 설명이 나오던 창)을 대체한다.
 */
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Lock, X } from 'lucide-react';
import { findPlanFeatureIntro, PLAN_FEATURE_MIN_PLAN } from '../constants/plan-feature-intros';

interface PlanFeatureModalProps {
  /** 안내할 기능 id. null이면 창을 그리지 않는다 */
  featureId: string | null;
  onClose: () => void;
}

export default function PlanFeatureModal({ featureId, onClose }: PlanFeatureModalProps) {
  const navigate = useNavigate();
  const intro = featureId ? findPlanFeatureIntro(featureId) : null;
  const primaryRef = useRef<HTMLButtonElement>(null);
  // 호출부가 매 렌더 새 함수를 넘겨도 포커스·키 처리가 다시 걸리지 않게 최신 값만 참조한다
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!intro) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    primaryRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [intro]);

  if (!intro) return null;
  const Icon = intro.icon;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/60 backdrop-blur-[6px] animate-[fadeIn_0.2s_ease-out]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-feature-title"
        className="w-full sm:max-w-[520px] max-h-[88vh] overflow-y-auto overscroll-contain bg-slate-900 text-white border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] animate-[zoomIn_0.25s_ease-out]"
      >
        {/* 머리: 기능 아이콘 · 이름 · 한 줄 설명 */}
        <div className="relative px-6 pt-6 pb-5 border-b border-white/[0.07]">
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="absolute top-3.5 right-3.5 w-9 h-9 rounded-xl flex items-center justify-center text-white/50 hover:text-white hover:bg-white/[0.08] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-3.5 pr-9">
            <div className={`w-12 h-12 rounded-[14px] bg-gradient-to-br ${intro.gradient} flex items-center justify-center flex-shrink-0 shadow-[0_10px_22px_-10px_rgba(0,0,0,0.6)]`}>
              <Icon className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h3 id="plan-feature-title" className="text-[19px] font-bold tracking-[-0.01em] leading-tight">{intro.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-white/70 break-keep">{intro.summary}</p>
            </div>
          </div>
        </div>

        {/* 본문: 이렇게 씁니다 3단계 + 크레딧 */}
        <div className="px-6 pt-4 pb-2">
          <ol className="divide-y divide-white/[0.04]">
            {intro.steps.map((s) => {
              const StepIcon = s.icon;
              return (
                <li key={s.title} className="grid grid-cols-[28px_1fr] gap-3 py-2.5">
                  <div className="w-7 h-7 rounded-[9px] bg-violet-500/[0.14] text-violet-300 flex items-center justify-center">
                    <StepIcon className="w-[15px] h-[15px]" />
                  </div>
                  <div className="min-w-0">
                    <b className="block text-sm font-semibold mb-0.5">{s.title}</b>
                    <span className="block text-[13px] leading-relaxed text-white/[0.62] break-keep">{s.text}</span>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="mt-3 mb-1 flex flex-wrap gap-1.5">
            {intro.costs.length > 0
              ? intro.costs.map((c) => (
                <span key={c.source} className="inline-flex items-baseline gap-1.5 px-2.5 py-1.5 rounded-[9px] bg-white/[0.05] border border-white/[0.08] text-xs text-white/[0.66]">
                  {c.label}
                  <em className="not-italic font-bold text-white tabular-nums">{c.credits.toLocaleString()}</em>
                  크레딧
                </span>
              ))
              : (
                <span className="inline-flex px-2.5 py-1.5 rounded-[9px] bg-white/[0.05] border border-white/[0.08] text-xs text-white/[0.66]">
                  {intro.costNote}
                </span>
              )}
          </div>
        </div>

        {/* 요금제 안내 */}
        <div className="mx-6 mt-3 px-3.5 py-3 rounded-xl flex items-center gap-2.5 bg-amber-300/[0.08] border border-amber-300/[0.22] text-[13px] leading-relaxed text-amber-50">
          <Lock className="w-[18px] h-[18px] text-amber-300 flex-shrink-0" />
          <span className="break-keep">
            <b className="font-semibold text-white">{PLAN_FEATURE_MIN_PLAN} 요금제부터</b> 이용할 수 있어요. 가입하면 매달 크레딧이 들어오고, 크레딧 안에서 바로 쓸 수 있습니다.
          </span>
        </div>

        {/* 버튼 */}
        <div className="flex flex-col-reverse sm:flex-row gap-2 px-6 pt-[18px] pb-5">
          <button
            type="button"
            onClick={onClose}
            className="sm:w-auto w-full px-[18px] py-3 rounded-xl border border-white/[0.12] bg-white/[0.04] text-sm font-medium text-white/75 hover:bg-white/[0.09] hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300"
          >
            닫기
          </button>
          <button
            ref={primaryRef}
            type="button"
            onClick={() => { onClose(); navigate('/pricing'); }}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-sm font-semibold text-white shadow-[0_12px_26px_-12px_rgba(124,58,237,0.8)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
          >
            요금제 보기
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
        <p className="px-6 pb-4 -mt-1.5 text-[10px] italic text-white/30">Data source: AI 크레딧 단가표</p>
      </div>
    </div>
  );
}
