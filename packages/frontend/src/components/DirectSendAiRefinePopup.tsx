/**
 * AI 다듬기 진입 안내 팝업 (D152+)
 *
 * 직접발송 진입 시 24h 1회 노출되는 가벼운 사용권고 안내.
 * 본체 AI 다듬기 모달(`AiRefineModal.tsx`)과는 분리된 별도 컴포넌트.
 * "지금 써볼게요" 클릭 시 직접발송 화면의 "AI 다듬기" 버튼 위치로 시선 유도 (CustomEvent).
 *
 * 패턴 미러: D145 AI 활용 안내 팝업.
 * 마스터 프롬프트: `status/AI-REFINE-POPUP-MASTER-PROMPT.md`.
 */

import { useEffect, useRef } from 'react';

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
    // 첫 focus = "다음에 볼게요" (실수 발송 방지)
    const t = setTimeout(() => laterRef.current?.focus(), 100);
    // ESC 닫기
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
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-[420px] bg-white rounded-[22px] shadow-2xl text-center animate-in zoom-in-95 duration-200 px-6 sm:px-7 pt-7 pb-5">

        {/* 닫기 X */}
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="absolute top-3.5 right-3.5 w-[30px] h-[30px] rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="m18 6-12 12M6 6l12 12" />
          </svg>
        </button>

        {/* 1) 원형 아이콘 (ring 효과) */}
        <div
          aria-hidden="true"
          className="relative w-[60px] h-[60px] mx-auto mb-4 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white"
          style={{
            boxShadow: '0 8px 18px -6px rgba(16,185,129,0.55), inset 0 1px 0 rgba(255,255,255,0.3)',
          }}
        >
          <span aria-hidden className="absolute -inset-1.5 rounded-full border-[1.5px] border-emerald-200 opacity-55" />
          <span aria-hidden className="absolute -inset-3 rounded-full border-[1.5px] border-emerald-200 opacity-25" />
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
            <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
          </svg>
        </div>

        {/* 2) 헤드라인 */}
        <h2
          id="ai-refine-popup-title"
          className="text-[19px] sm:text-[19px] font-bold text-gray-900 tracking-tight mb-2"
        >
          ✨ AI가 문안을 다듬어드려요
        </h2>

        {/* 3) 서브 */}
        <p className="text-[13.5px] text-gray-600 leading-relaxed mx-1.5 mb-5">
          직접 쓰신 메시지를 AI가 톤·길이·이모지를 자동으로 정리해서<br />
          다듬은 안을 보여드려요.
        </p>

        {/* 4) 미니 Before/After */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-stretch mb-[18px]">
          <div className="text-left rounded-[10px] p-[10px_12px_11px] border border-gray-200 bg-gray-50 flex flex-col">
            <span className="inline-block self-start text-[10px] font-semibold px-1.5 py-0.5 rounded-full mb-1.5 bg-gray-200 text-gray-600">
              직접 작성
            </span>
            <div className="text-[11.5px] leading-[1.55] text-gray-700 break-keep">
              내일 신상품 입고됩니다!
            </div>
          </div>
          <div aria-hidden="true" className="grid place-items-center text-emerald-500 px-0.5">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </div>
          <div className="text-left rounded-[10px] p-[10px_12px_11px] border border-emerald-200 bg-emerald-50 flex flex-col">
            <span className="inline-block self-start text-[10px] font-semibold px-1.5 py-0.5 rounded-full mb-1.5 bg-emerald-500 text-white">
              AI 다듬기
            </span>
            <div className="text-[11.5px] leading-[1.55] text-gray-900 break-keep">
              내일 드디어! 기다리시던 신상품이 입고됩니다 😊
            </div>
          </div>
        </div>

        {/* 5) 3 step */}
        <div className="flex flex-col gap-[7px] mb-[22px] px-1">
          <div className="flex items-center gap-2.5 text-[12.5px] text-gray-500 text-left">
            <span className="flex-shrink-0 w-[18px] h-[18px] rounded-full bg-gray-100 text-gray-500 text-[10.5px] font-bold flex items-center justify-center">1</span>
            <span>📝 메시지 직접 쓰기</span>
          </div>
          <div className="flex items-center gap-2.5 text-[12.5px] text-gray-500 text-left">
            <span className="flex-shrink-0 w-[18px] h-[18px] rounded-full bg-gray-100 text-gray-500 text-[10.5px] font-bold flex items-center justify-center">2</span>
            <span>✨ <b className="text-gray-700 font-semibold">"AI 다듬기"</b> 버튼 클릭</span>
          </div>
          <div className="flex items-center gap-2.5 text-[12.5px] text-gray-500 text-left">
            <span className="flex-shrink-0 w-[18px] h-[18px] rounded-full bg-gray-100 text-gray-500 text-[10.5px] font-bold flex items-center justify-center">3</span>
            <span>✅ 마음에 드는 안 선택</span>
          </div>
        </div>

        {/* 6) CTA 2개 */}
        <div className="grid grid-cols-[1fr_1.3fr] gap-2">
          <button
            ref={laterRef}
            type="button"
            onClick={onClose}
            className="px-3.5 py-3 rounded-[10px] bg-gray-100 hover:bg-gray-200 text-gray-700 text-[13.5px] font-medium transition-colors"
          >
            다음에 볼게요
          </button>
          <button
            type="button"
            onClick={onNow}
            className="px-3.5 py-3 rounded-[10px] bg-emerald-500 hover:bg-emerald-600 text-white text-[13.5px] font-semibold flex items-center justify-center gap-1.5 transition-colors active:translate-y-px"
            style={{
              boxShadow: '0 4px 12px -4px rgba(16,185,129,0.55), inset 0 1px 0 rgba(255,255,255,0.2)',
            }}
          >
            <span>지금 써볼게요</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* 7) 푸터 안내 (요금제 분기) */}
        <div className={`mt-3.5 text-[11px] text-center ${isTrialActive ? 'text-emerald-600 font-medium' : 'text-gray-400'}`}>
          {isTrialActive
            ? '무료체험 기간 동안 무제한 이용 가능 ✨'
            : '베이직 요금제(35만원/월) 이상에서 이용 가능'}
        </div>

      </div>
    </div>
  );
}
