/**
 * AI 다듬기 잠금 안내 모달 (D152+ → D219+ Phase 0 다크 톤 정정)
 *
 * FREE/STARTER 회사가 AI 다듬기 버튼 클릭 시 노출.
 * "어떤 기능인지" 가치 안내 + "스타터 요금제 이상에서 이용 가능" 업그레이드 동선.
 *
 * D219+ 정정 (Harold 명시 2026-05-26):
 *   - 흰 톤 + emerald → 다크 톤 (bg-slate-900) + violet 액센트
 *   - Before/After 예시 = 단순 "★ 추가" 폐기 → 풍성한 광고 카피 변환 (가치 즉시 인지)
 *   - 잠금 배지 amber 영역 유지 (강조 영역)
 *
 * 영구 룰 정합:
 *   - design_quality_minimum_journey_level (다크 톤 + violet 액센트)
 *   - no_native_browser_dialog (ConfirmModal + useToast)
 */

import { useEffect, useRef } from 'react';
import { X, Sparkles, Lock, ArrowRight } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function AiRefineLockedModal({ isOpen, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => closeRef.current?.focus(), 100);
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', handler);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-refine-locked-title"
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[70] animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-[480px] bg-slate-900 border border-white/10 rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
        {/* 헤더 그라데이션 */}
        <div className="relative px-6 pt-6 pb-5 bg-gradient-to-r from-violet-500/15 via-fuchsia-500/15 to-purple-500/15 border-b border-white/10">
          {/* 닫기 X */}
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="absolute top-3.5 right-3.5 w-[30px] h-[30px] rounded-lg text-white/50 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" strokeWidth={2.2} />
          </button>

          {/* 원형 아이콘 + 잠금 배지 */}
          <div className="text-center">
            <div
              aria-hidden="true"
              className="relative w-[64px] h-[64px] mx-auto mb-3 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white shadow-lg shadow-violet-500/40"
            >
              <span aria-hidden className="absolute -inset-1.5 rounded-2xl border-[1.5px] border-violet-400/40 opacity-50" />
              <Sparkles className="w-7 h-7" strokeWidth={2.2} />
              {/* 잠금 배지 우측 하단 */}
              <span
                aria-hidden
                className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-amber-500 border-2 border-slate-900 flex items-center justify-center shadow-md"
              >
                <Lock className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
              </span>
            </div>

            <h2
              id="ai-refine-locked-title"
              className="text-[19px] font-bold text-white tracking-tight mb-2 flex items-center justify-center gap-2"
            >
              AI 문안 다듬기
            </h2>
            <p className="text-[13px] text-white/60 leading-relaxed">
              직접 쓰신 메시지를 톤·길이·이모지·스팸 회피까지 한 번에 정리
            </p>
          </div>
        </div>

        {/* 본문 */}
        <div className="px-6 py-5">
          {/* Before/After 미리보기 — 가치 시각화 */}
          <div className="grid grid-cols-1 gap-3 mb-5">
            {/* 직접 작성 (원본) */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-3.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-white/10 text-white/60">
                  직접 작성
                </span>
                <span className="text-[10px] text-white/30 font-mono">36자</span>
              </div>
              <div className="text-[12px] leading-relaxed text-white/80 whitespace-pre-line">
                [브랜드명] 상반기 결산 BIG SALE ★{'\n'}
                6월 5일~9일, 단 5일간!{'\n'}
                자세히 보기 hjl.kr/abc
              </div>
            </div>

            {/* 화살표 */}
            <div className="flex items-center justify-center gap-2 text-violet-300">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-violet-400/40 to-violet-400/40" />
              <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
              <span className="text-[10px] font-semibold uppercase tracking-wider">AI 다듬기</span>
              <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
              <div className="h-px flex-1 bg-gradient-to-l from-transparent via-violet-400/40 to-violet-400/40" />
            </div>

            {/* AI 다듬은 안 */}
            <div className="rounded-xl border border-violet-400/40 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/5 p-3.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-violet-500/30 text-violet-100 flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5" />
                  AI 다듬기
                </span>
                <span className="text-[10px] text-violet-200/60 font-mono">LMS 152자</span>
              </div>
              <div className="text-[12px] leading-relaxed text-white/90 whitespace-pre-line">
                [브랜드명] 상반기 결산 BIG SALE ★{'\n\n'}
                <span className="bg-violet-500/30 text-violet-50 rounded px-0.5">상반기를 마무리하는 딱 5일,</span>{'\n'}
                <span className="bg-violet-500/30 text-violet-50 rounded px-0.5">기다리시던 빅세일이 시작됩니다.</span>{'\n\n'}
                ▶ 6월 5일~9일, 단 5일간{'\n\n'}
                <span className="bg-violet-500/30 text-violet-50 rounded px-0.5">놓치면 다음 기회를 기다리셔야 합니다.</span>{'\n'}
                hjl.kr/abc
              </div>
              <div className="text-[10px] text-violet-200/40 italic mt-2">
                강조 부분 = AI가 풍성하게 다듬은 표현 (예시)
              </div>
            </div>
          </div>

          {/* 요금제 잠금 안내 박스 */}
          <div className="mb-5 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3">
            <div className="flex items-center justify-center gap-2 text-[13px] font-semibold text-amber-200 mb-1.5">
              <Lock className="w-3.5 h-3.5" strokeWidth={2.5} />
              <span>스타터 요금제 이상에서 이용 가능</span>
            </div>
            <p className="text-[11.5px] text-amber-100/70 leading-relaxed text-center">
              스타터 / 베이직 / 프로 / 비즈니스 / 엔터프라이즈 요금제에서{'\n'}
              AI 다듬기를 자유롭게 사용하실 수 있어요.
            </p>
          </div>

          {/* CTA */}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 text-[13px] font-medium transition-colors"
          >
            닫기
          </button>

          {/* 푸터 */}
          <p className="mt-3 text-[11px] text-white/40 leading-relaxed text-center">
            요금제 업그레이드 문의는 <span className="font-medium text-white/70">상단 메뉴 → 요금제</span>에서 확인하실 수 있어요.
          </p>

          {/* Source caption */}
          <div className="text-[10px] text-white/30 italic mt-3 text-center">
            Data source — AI 문안 다듬기 (회사 30일 발송 패턴 학습 + 톤 자동 반영)
          </div>
        </div>
      </div>
    </div>
  );
}
