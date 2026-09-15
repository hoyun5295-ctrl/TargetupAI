/**
 * CatalogPagesInput — AI 자동제작 "카탈로그 DM" 채널의 재료 입력(★ 2026-09-15 Harold 지시 · 쪽 이미지 수량 제한 없이)
 *
 * 쪽 이미지 N장(순서 = 쪽 순서 · 첫 장이 표지)을 고르는 즉시 업로드해 url 만 든다(BuildCardsInput 과 같은 규약 · 새로고침 복구가 이미지까지 닿는다).
 * 서버 업로드 1회 상한(9장)에 맞춰 나눠 올리고 진행 수를 보인다. 업무 상한 없음(서버 보호용 기술 상한만 서버가 갖는다).
 * 드래그 정렬 · [제외] · [소재 라이브러리] · 선택 제목 1줄. 판독·생성·크레딧은 여기 없다(호출부 소유). 다크 작업면 · native dialog 0 · 모델명 0.
 */
import { useRef, useState } from 'react';
import { ImagePlus, X, FolderOpen, Loader2, GripVertical, BookOpen } from 'lucide-react';
import { AI_BUILD_CATALOG_UPLOAD_CHUNK, type BuildImageValue } from '../../utils/ai-build';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

export default function CatalogPagesInput({ value, onChange, title, onTitleChange, disabled, onUpload, onOpenLibrary, onReject }: {
  value: BuildImageValue[];
  onChange: (next: BuildImageValue[]) => void;
  title: string;
  onTitleChange: (v: string) => void;
  disabled?: boolean;
  /** 고른 즉시 업로드(호출부 = POST /api/event-campaigns/materials read=0 · 1회 ≤ 9장) → url·치수 */
  onUpload: (files: File[]) => Promise<BuildImageValue[]>;
  onOpenLibrary: () => void;
  onReject?: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const dragFrom = useRef<number | null>(null);
  const uploading = progress !== null;

  const addFiles = async (list: FileList | File[] | null) => {
    if (!list || disabled || uploading) return;
    const ok: File[] = [];
    let rejected = 0;
    for (const f of Array.from(list)) {
      if (!ACCEPT.includes(f.type) || f.size > MAX_FILE_BYTES) { rejected++; continue; }
      ok.push(f);
    }
    if (rejected > 0) onReject?.(`${rejected}장을 제외했습니다(JPG·PNG·WebP · 5MB 이하).`);
    if (ok.length === 0) return;
    setProgress({ done: 0, total: ok.length });
    const saved: BuildImageValue[] = [];
    let failed = 0;
    try {
      for (let i = 0; i < ok.length; i += AI_BUILD_CATALOG_UPLOAD_CHUNK) {
        const chunk = ok.slice(i, i + AI_BUILD_CATALOG_UPLOAD_CHUNK);
        try {
          const got = await onUpload(chunk);
          saved.push(...got);
          failed += chunk.length - got.length;
        } catch {
          failed += chunk.length;
        }
        setProgress({ done: Math.min(ok.length, i + chunk.length), total: ok.length });
      }
      if (failed > 0) onReject?.(`${failed}장은 올리지 못해 제외했습니다.`);
      if (saved.length) onChange([...value, ...saved]);
    } finally {
      setProgress(null);
    }
  };

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= value.length || to >= value.length) return;
    const next = value.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-violet-300 shrink-0" />
        <input value={title} onChange={(e) => onTitleChange(e.target.value.slice(0, 40))} disabled={disabled}
          placeholder="카탈로그 제목(선택 · 40자) · 예: 2026 겨울 컬렉션"
          className="flex-1 min-w-0 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-violet-400/60 disabled:opacity-50" />
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); if (dragFrom.current === null) void addFiles(e.dataTransfer.files); }}
        className={`rounded-xl border border-dashed ${disabled ? 'border-white/10' : 'border-violet-400/40 hover:border-violet-300/60'} bg-white/[0.02] p-3`}
      >
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
          {value.map((im, i) => (
            <div
              key={`${im.url}-${i}`}
              draggable={!disabled && !uploading}
              onDragStart={() => { dragFrom.current = i; }}
              onDragEnd={() => { dragFrom.current = null; }}
              onDragOver={(e) => { e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragFrom.current !== null) move(dragFrom.current, i); dragFrom.current = null; }}
              className="relative aspect-[640/920] rounded-lg overflow-hidden bg-white border border-white/10 group cursor-grab active:cursor-grabbing"
              title="끌어서 쪽 순서를 바꿀 수 있어요 · 첫 장이 표지"
            >
              <img src={im.url} alt={`${i + 1}쪽`} className="w-full h-full object-contain" draggable={false} />
              <span className="absolute left-1 top-1 px-1.5 rounded text-[10px] font-bold bg-black/70 text-white">{i + 1}</span>
              {!disabled && !uploading && (
                <>
                  <span className="absolute left-1 bottom-1 text-white/80 drop-shadow"><GripVertical className="w-3 h-3" /></span>
                  <button type="button" onClick={() => onChange(value.filter((_, n) => n !== i))} aria-label={`${i + 1}쪽 제외`}
                    className="absolute top-1 right-1 w-4 h-4 rounded-full bg-black/70 text-white/90 flex items-center justify-center hover:bg-rose-600"><X className="w-2.5 h-2.5" /></button>
                </>
              )}
            </div>
          ))}
          <button type="button" disabled={disabled || uploading} onClick={() => inputRef.current?.click()}
            className="aspect-[640/920] rounded-lg border border-white/15 bg-white/5 text-violet-200 hover:bg-violet-500/20 disabled:opacity-40 flex flex-col items-center justify-center gap-1 px-1">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
            <span className="text-[10px] text-center leading-tight">{uploading ? `${progress.done}/${progress.total} 올리는 중` : value.length === 0 ? '쪽 이미지 추가' : '쪽 추가'}</span>
          </button>
          <button type="button" disabled={disabled || uploading} onClick={onOpenLibrary}
            className="aspect-[640/920] rounded-lg border border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/10 hover:text-white/85 disabled:opacity-40 flex flex-col items-center justify-center gap-1 px-1"
            title="저장해 둔 소재에서 고르기">
            <FolderOpen className="w-4 h-4" /><span className="text-[10px]">라이브러리</span>
          </button>
        </div>
        <input ref={inputRef} type="file" accept={ACCEPT.join(',')} multiple hidden onChange={(e) => { void addFiles(e.target.files); e.currentTarget.value = ''; }} />
        <p className="text-[11px] text-white/45 mt-2">
          {value.length > 0 ? `${value.length}쪽 · ` : ''}장수 제한 없음 · JPG·PNG·WebP · 5MB/장 · 올린 순서가 쪽 순서(첫 장 = 표지) · 2쪽 이상이면 만들 수 있어요
        </p>
      </div>
    </div>
  );
}
