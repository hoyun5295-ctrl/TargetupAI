/**
 * ImageToCopyButton — "이미지로 문안 생성" 공용 버튼 (2026-07-08)
 *
 * AI 문안·콘텐츠 생성 입력칸(생성 버튼 옆)에 드롭인. 클릭 → ImageToCopyModal 열림 → 판독 텍스트를 onExtracted로 전달.
 * 호출부는 <ImageToCopyButton onExtracted={(t) => setPrompt(t)} /> 한 줄. label 없으면 아이콘 전용.
 */
import { useState } from 'react';
import { ImagePlus } from 'lucide-react';
import ImageToCopyModal from './ImageToCopyModal';

export default function ImageToCopyButton({ onExtracted, className, label, disabled }: {
  onExtracted: (text: string) => void;
  className?: string;
  /** 지정 시 아이콘 + 라벨, 미지정 시 아이콘 전용 */
  label?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const base = label
    ? 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-violet-400/40 bg-violet-500/10 text-violet-100 text-sm font-medium hover:bg-violet-500/20 disabled:opacity-40 transition-colors'
    : 'inline-flex items-center justify-center w-10 h-10 rounded-xl border border-white/15 bg-white/5 text-violet-200 hover:bg-violet-500/20 hover:border-violet-400/40 disabled:opacity-40 transition-colors';
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={className || base}
        aria-label="이미지로 문안 생성"
        title="이미지로 문안 생성"
      >
        <ImagePlus className="w-[18px] h-[18px]" />
        {label ? <span>{label}</span> : null}
      </button>
      <ImageToCopyModal open={open} onClose={() => setOpen(false)} onExtracted={onExtracted} />
    </>
  );
}
