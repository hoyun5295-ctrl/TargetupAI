/**
 * AI 다듬기 진입 안내 팝업 (D152+ → D219+ Phase 0 다크 톤 정정)
 *
 * 직접발송 진입 시 24h 1회 노출되는 사용권고 안내 모달.
 * 본체 AI 다듬기 모달(`AiRefineModal.tsx`)과는 별도 컴포넌트.
 * "지금 써볼게요" 클릭 시 직접발송 화면의 "AI 다듬기" 버튼 위치로 시선 유도 (CustomEvent).
 *
 * D219+ 정정 (Harold 명시 2026-05-26):
 *   - 흰 톤 + emerald → 다크 톤 (bg-slate-900) + violet 액센트
 *   - Before/After 예시 = 단순 "★ 추가" 폐기 → 풍성한 광고 카피 변환 미리보기 (사용자 가치 즉시 인지)
 *   - 첨부 캡처 본보기 정합 (시즌 풍성 + 강조 부분 형광 violet 표시)
 *
 * 영구 룰 정합:
 *   - design_quality_minimum_journey_level (다크 톤 + violet 액센트 + Source caption)
 *   - no_native_browser_dialog (ConfirmModal + useToast 활용)
 *   - ai_no_arbitrary_benefit (예시 문구 안 구체 혜택 = "예시" 텍스트 명시)
 */

import { useEffect, useRef } from 'react';
import { X, Sparkles, ArrowRight } from 'lucide-react';

interface Props {
  isOpen: boolean;
  isTrialActive?: boolean;
  onClose: () => void;
  onNow: () => void;
}

export default function DirectSendAiRefinePopup({
  isOpen,
  isTrialActive,
  onClose,
  onNow,
}: Props) {
  const laterRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => laterRef.current?.focus(), 100);
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
      aria-labelledby="ai-refine-popup-title"
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-[460px] bg-slate-900 border border-white/10 rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
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

          {/* 아이콘 + 헤드라인 */}
          <div className="flex items-center gap-3">
            <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/40 flex-shrink-0">
              <span aria-hidden className="absolute -inset-1.5 rounded-2xl border-[1.5px] border-violet-400/40 opacity-50" />
              <Sparkles className="w-5 h-5 text-white" strokeWidth={2.25} />
            </div>
            <div className="flex-1 min-w-0">
              <h2
                id="ai-refine-popup-title"
                className="text-[17px] font-bold text-white tracking-tight leading-tight flex items-center gap-2"
              >
                AI가 문안을 다듬어드려요
              </h2>
              <p className="text-[12px] text-white/60 mt-1 leading-relaxed">
                직접 쓰신 메시지를 톤·길이·이모지·스팸 회피까지 한 번에 정리
              </p>
            </div>
          </div>
        </div>

        {/* 본문 */}
        <div className="px-6 py-5">
          {/* Before/After 미리보기 */}
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

          {/* 3 step 안내 */}
          <div className="flex flex-col gap-2 mb-5">
            <div className="flex items-center gap-2.5 text-[12px] text-white/70">
              <span className="flex-shrink-0 w-[20px] h-[20px] rounded-full bg-violet-500/20 text-violet-200 text-[10px] font-bold flex items-center justify-center">1</span>
              <span>메시지 직접 쓰기</span>
            </div>
            <div className="flex items-center gap-2.5 text-[12px] text-white/70">
              <span className="flex-shrink-0 w-[20px] h-[20px] rounded-full bg-violet-500/20 text-violet-200 text-[10px] font-bold flex items-center justify-center">2</span>
              <span><b className="text-white">"AI 다듬기"</b> 버튼 클릭</span>
            </div>
            <div className="flex items-center gap-2.5 text-[12px] text-white/70">
              <span className="flex-shrink-0 w-[20px] h-[20px] rounded-full bg-violet-500/20 text-violet-200 text-[10px] font-bold flex items-center justify-center">3</span>
              <span>마음에 드는 안 선택 후 1-click 적용</span>
            </div>
          </div>

          {/* CTA 2건 */}
          <div className="grid grid-cols-[1fr_1.4fr] gap-2">
            <button
              ref={laterRef}
              type="button"
              onClick={onClose}
              className="px-3.5 py-3 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-[13px] font-medium transition-colors"
            >
              다음에 볼게요
            </button>
            <button
              type="button"
              onClick={onNow}
              className="px-3.5 py-3 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all shadow-lg shadow-violet-500/30 active:translate-y-px"
            >
              <span>지금 써볼게요</span>
              <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.5} />
            </button>
          </div>

          {/* 푸터 안내 (요금제 분기) */}
          <div className={`mt-3 text-[11px] text-center ${isTrialActive ? 'text-violet-300' : 'text-white/40'}`}>
            {isTrialActive
              ? '무료체험 기간 안 무제한 이용 가능'
              : '스타터 요금제 이상에서 이용 가능'}
          </div>

          {/* Source caption */}
          <div className="text-[10px] text-white/30 italic mt-3 text-center">
            Data source — AI 문안 다듬기 (회사 30일 발송 패턴 학습 + 톤 자동 반영)
          </div>
        </div>
      </div>
    </div>
  );
}
