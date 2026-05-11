/**
 * AI 다듬기 잠금 안내 모달 (D152+)
 *
 * FREE/STARTER 회사가 AI 다듬기 버튼 클릭 시 노출.
 * "어떤 기능인지" 가치 안내 + "베이직 요금제(35만원/월) 이상에서 이용 가능" 업그레이드 동선.
 * 본체 AiRefineModal과 분리된 별도 컴포넌트 (SoC).
 *
 * Harold님 D152 명시: FREE/STARTER는 사용 못 하게 + 기능 설명 + 35만원 베이직 이상 안내.
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
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[70] animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-[460px] bg-white rounded-[22px] shadow-2xl text-center animate-in zoom-in-95 duration-200 px-6 sm:px-7 pt-7 pb-5">

        {/* 닫기 X */}
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="absolute top-3.5 right-3.5 w-[30px] h-[30px] rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center transition-colors"
        >
          <X className="w-4 h-4" strokeWidth={2.2} />
        </button>

        {/* 1) 원형 아이콘 — Sparkles + 잠금 배지 */}
        <div
          aria-hidden="true"
          className="relative w-[64px] h-[64px] mx-auto mb-4 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white"
          style={{
            boxShadow: '0 8px 18px -6px rgba(16,185,129,0.55), inset 0 1px 0 rgba(255,255,255,0.3)',
          }}
        >
          <Sparkles className="w-7 h-7" strokeWidth={2.2} />
          {/* 잠금 배지 우측 하단 */}
          <span
            aria-hidden
            className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-amber-500 border-2 border-white flex items-center justify-center shadow-md"
          >
            <Lock className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
          </span>
        </div>

        {/* 2) 헤드라인 */}
        <h2
          id="ai-refine-locked-title"
          className="text-[20px] font-bold text-gray-900 tracking-tight mb-2"
        >
          ✨ AI 문안 다듬기
        </h2>

        {/* 3) 서브 — 기능 설명 1~2줄 */}
        <p className="text-[13.5px] text-gray-600 leading-relaxed mx-2 mb-5">
          직접 쓰신 메시지를 AI가 톤·길이·이모지를 자동으로 정리해서<br />
          더 매력적인 다듬은 안을 보여드리는 기능이에요.
        </p>

        {/* 4) 미니 Before/After 카드 — 가치 시각화 */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-stretch mb-5">
          <div className="text-left rounded-[10px] p-[10px_12px_11px] border border-gray-200 bg-gray-50 flex flex-col">
            <span className="inline-block self-start text-[10px] font-semibold px-1.5 py-0.5 rounded-full mb-1.5 bg-gray-200 text-gray-600">
              직접 작성
            </span>
            <div className="text-[11.5px] leading-[1.55] text-gray-700 break-keep">
              내일 신상품 입고됩니다!
            </div>
          </div>
          <div aria-hidden="true" className="grid place-items-center text-emerald-500 px-0.5">
            <ArrowRight className="w-[18px] h-[18px]" strokeWidth={2.2} />
          </div>
          <div className="text-left rounded-[10px] p-[10px_12px_11px] border border-emerald-200 bg-emerald-50 flex flex-col">
            <span className="inline-block self-start text-[10px] font-semibold px-1.5 py-0.5 rounded-full mb-1.5 bg-emerald-500 text-white">
              AI 다듬기
            </span>
            <div className="text-[11.5px] leading-[1.55] text-gray-900 break-keep">
              내일 신상품이 입고됩니다 😊
            </div>
          </div>
        </div>

        {/* 5) 요금제 잠금 안내 박스 */}
        <div className="mb-5 mx-1 rounded-[12px] border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-white px-4 py-3">
          <div className="flex items-center justify-center gap-2 text-[13px] font-semibold text-amber-700 mb-1">
            <Lock className="w-3.5 h-3.5" strokeWidth={2.5} />
            <span>베이직 요금제 이상에서 이용 가능</span>
          </div>
          <p className="text-[11.5px] text-gray-500 leading-relaxed">
            월 35만원 · 베이직 / 프로 / 비즈니스 / 엔터프라이즈 요금제에서<br />
            AI 다듬기를 자유롭게 사용하실 수 있어요.
          </p>
        </div>

        {/* 6) CTA */}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="w-full py-3 rounded-[10px] bg-gray-100 hover:bg-gray-200 text-gray-700 text-[13.5px] font-medium transition-colors"
        >
          닫기
        </button>

        {/* 7) 푸터 */}
        <p className="mt-3 text-[11px] text-gray-400 leading-relaxed">
          요금제 업그레이드 문의는 <span className="font-medium text-gray-600">상단 메뉴 → 요금제</span>에서 확인하실 수 있어요.
        </p>

      </div>
    </div>
  );
}
