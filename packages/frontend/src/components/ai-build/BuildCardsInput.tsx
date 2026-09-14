/**
 * BuildCardsInput — AI 자동제작 행사 카드 목록(2026-09-14 T5 · 설계서 §4-2 ①)
 *
 * EventCardsInput(v0 · File 보유)의 후계. 차이 = 이미지를 고르는 즉시 업로드해 url 만 든다(새로고침 복구가 이미지까지 닿는다 · §4-2 상태) ·
 * [소재 라이브러리]에서 고르기 · 썸네일 좌상단 읽기 전용 배지(서버 판정 · "추정") · 순서 = 드래그 정렬 · 고치는 수단은 정렬과 [제외]뿐(불변 6).
 * 카드 ≤3 · 카드당 이미지 ≤3 · 판독·생성·크레딧은 여기 없다(호출부 소유). 다크 작업면 · native dialog 0 · 모델명 0.
 */
import { useRef, useState } from 'react';
import { ImagePlus, X, Link2, Plus, Trash2, FolderOpen, Loader2, GripVertical } from 'lucide-react';
import { newBuildCard, type BuildCardValue, type BuildImageValue, type BuildImageRole } from '../../utils/ai-build';

export const BUILD_CARDS_MAX = 3;
export const BUILD_CARD_IMAGES_MAX = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

const ROLE_LABEL: Record<BuildImageRole, string> = { hero: '첫 화면', photo: '사진', logo: '로고 추정', unknown: '확인 중' };
const ROLE_CLASS: Record<BuildImageRole, string> = {
  hero: 'bg-violet-600/90 text-white',
  photo: 'bg-black/70 text-white/90',
  logo: 'bg-amber-400/90 text-amber-950',
  unknown: 'bg-black/60 text-white/70',
};

function BuildCard({ index, value, onChange, onRemove, disabled, canRemove, onUpload, onOpenLibrary, onReject }: {
  index: number;
  value: BuildCardValue;
  onChange: (v: BuildCardValue) => void;
  onRemove: () => void;
  disabled?: boolean;
  canRemove: boolean;
  onUpload: (files: File[]) => Promise<BuildImageValue[]>;
  onOpenLibrary: (cardId: string) => void;
  onReject?: (m: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const dragFrom = useRef<number | null>(null);
  const room = BUILD_CARD_IMAGES_MAX - value.images.length;

  const addFiles = async (list: FileList | File[] | null) => {
    if (!list || disabled) return;
    const ok: File[] = [];
    let rejected = 0;
    for (const f of Array.from(list)) {
      if (!ACCEPT.includes(f.type) || f.size > MAX_FILE_BYTES) { rejected++; continue; }
      ok.push(f);
    }
    const take = ok.slice(0, Math.max(0, room));
    if (ok.length > take.length) rejected += ok.length - take.length;
    if (rejected > 0) onReject?.(`${rejected}장을 제외했습니다(JPG·PNG·WebP · 5MB 이하 · 카드당 최대 ${BUILD_CARD_IMAGES_MAX}장).`);
    if (take.length === 0) return;
    setUploading(true);
    try {
      const saved = await onUpload(take);
      if (saved.length < take.length) onReject?.(`${take.length - saved.length}장은 이미지 형식을 확인하지 못해 제외했습니다.`);
      if (saved.length) onChange({ ...value, images: [...value.images, ...saved].slice(0, BUILD_CARD_IMAGES_MAX) });
    } catch (e: any) {
      onReject?.(e?.message || '이미지를 올리지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setUploading(false);
    }
  };

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= value.images.length || to >= value.images.length) return;
    const next = value.images.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange({ ...value, images: next });
  };

  const hasText = value.text.trim().length > 0 || value.title.trim().length > 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-violet-500/30 text-violet-100 text-[11px] font-bold flex items-center justify-center shrink-0">{index + 1}</span>
        <input value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value.slice(0, 40) })} disabled={disabled}
          placeholder="행사 제목(40자) · 예: 추석 선물세트 기획전"
          className="flex-1 min-w-0 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-violet-400/60 disabled:opacity-50" />
        {canRemove && !disabled && (
          <button type="button" onClick={onRemove} aria-label="이 행사 삭제" className="shrink-0 p-1.5 rounded-lg text-white/50 hover:text-rose-300 hover:bg-rose-500/10"><Trash2 className="w-4 h-4" /></button>
        )}
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); if (dragFrom.current === null) void addFiles(e.dataTransfer.files); }}
        className={`rounded-xl border border-dashed ${disabled ? 'border-white/10' : 'border-violet-400/40 hover:border-violet-300/60'} bg-white/[0.02] p-2.5`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          {value.images.map((im, i) => (
            <div
              key={im.url}
              draggable={!disabled}
              onDragStart={() => { dragFrom.current = i; }}
              onDragEnd={() => { dragFrom.current = null; }}
              onDragOver={(e) => { e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragFrom.current !== null) move(dragFrom.current, i); dragFrom.current = null; }}
              className="relative w-20 h-20 rounded-lg overflow-hidden bg-slate-900 border border-white/10 group cursor-grab active:cursor-grabbing"
              title="끌어서 순서를 바꿀 수 있어요 · 첫 장이 첫 화면 후보"
            >
              <img src={im.url} alt={`행사 ${index + 1} 이미지 ${i + 1}`} className="w-full h-full object-cover" draggable={false} />
              <span className={`absolute left-1 top-1 px-1 rounded text-[9px] font-semibold ${ROLE_CLASS[im.role || 'unknown']}`}>
                {im.role ? ROLE_LABEL[im.role] : (i === 0 ? '첫 화면' : '사진')}
              </span>
              {!disabled && (
                <>
                  <span className="absolute left-1 bottom-1 text-white/70"><GripVertical className="w-3 h-3" /></span>
                  <button type="button" onClick={() => onChange({ ...value, images: value.images.filter((_, n) => n !== i) })} aria-label="이미지 제외"
                    className="absolute top-1 right-1 w-4 h-4 rounded-full bg-black/70 text-white/90 flex items-center justify-center hover:bg-rose-600"><X className="w-2.5 h-2.5" /></button>
                </>
              )}
            </div>
          ))}
          {room > 0 && (
            <>
              <button type="button" disabled={disabled || uploading} onClick={() => inputRef.current?.click()}
                className="w-20 h-20 rounded-lg border border-white/15 bg-white/5 text-violet-200 hover:bg-violet-500/20 disabled:opacity-40 flex flex-col items-center justify-center gap-0.5">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                <span className="text-[10px]">{uploading ? '올리는 중' : value.images.length === 0 ? '사진 추가' : '추가'}</span>
              </button>
              <button type="button" disabled={disabled || uploading} onClick={() => onOpenLibrary(value.id)}
                className="w-20 h-20 rounded-lg border border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/10 hover:text-white/85 disabled:opacity-40 flex flex-col items-center justify-center gap-0.5"
                title="저장해 둔 소재에서 고르기">
                <FolderOpen className="w-4 h-4" /><span className="text-[10px]">라이브러리</span>
              </button>
            </>
          )}
          <input ref={inputRef} type="file" accept={ACCEPT.join(',')} multiple hidden onChange={(e) => { void addFiles(e.target.files); e.currentTarget.value = ''; }} />
          <p className="text-[11px] text-white/45 ml-1 basis-full sm:basis-auto">배너·상품 사진 최대 {BUILD_CARD_IMAGES_MAX}장 · 첫 장이 첫 화면 후보 · 배지는 서버 판정(추정)</p>
        </div>
      </div>

      <textarea value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value.slice(0, 4000) })} disabled={disabled} rows={3}
        placeholder="행사 내용(기간 · 혜택 · 상품 · 조건)을 그대로 붙여넣어 주세요. 비워 두면 올린 사진에서 읽어 채웁니다(이미지 글자 읽기 1회)."
        className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-violet-400/60 disabled:opacity-50" />
      <div className="flex items-center gap-2 flex-wrap">
        <Link2 className="w-4 h-4 text-white/40 shrink-0" />
        <input value={value.link} onChange={(e) => onChange({ ...value, link: e.target.value.slice(0, 500) })} disabled={disabled}
          placeholder="이 행사의 버튼이 열 주소(행사 페이지)"
          className="flex-1 min-w-[180px] rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-violet-400/60 disabled:opacity-50" />
        <label className={`inline-flex items-center gap-1.5 text-[12px] ${hasText ? 'text-white/80 cursor-pointer' : 'text-white/35'}`} title={hasText ? undefined : '행사 내용을 쓰면 체크할 수 있습니다'}>
          <input type="checkbox" className="accent-violet-500" checked={value.licensed && hasText} disabled={disabled || !hasText} onChange={(e) => onChange({ ...value, licensed: e.target.checked })} />
          이 문구를 그대로 씁니다(숫자 포함)
        </label>
      </div>
    </div>
  );
}

export default function BuildCardsInput({ value, onChange, disabled, onUpload, onOpenLibrary, onReject }: {
  value: BuildCardValue[];
  onChange: (next: BuildCardValue[]) => void;
  disabled?: boolean;
  /** 고른 즉시 업로드(호출부 = POST /api/event-campaigns/materials read=0) → url·치수 */
  onUpload: (files: File[]) => Promise<BuildImageValue[]>;
  onOpenLibrary: (cardId: string) => void;
  onReject?: (message: string) => void;
}) {
  const full = value.length >= BUILD_CARDS_MAX;
  return (
    <div className="space-y-3">
      {value.map((c, i) => (
        <BuildCard key={c.id} index={i} value={c} disabled={disabled} canRemove={value.length > 1} onUpload={onUpload} onOpenLibrary={onOpenLibrary} onReject={onReject}
          onChange={(v) => onChange(value.map((x) => (x.id === c.id ? v : x)))}
          onRemove={() => onChange(value.filter((x) => x.id !== c.id))} />
      ))}
      <button type="button" disabled={disabled || full} onClick={() => onChange([...value, newBuildCard()])}
        title={full ? `행사는 ${BUILD_CARDS_MAX}개까지 담깁니다` : undefined}
        className="w-full rounded-2xl border border-dashed border-violet-400/30 py-2.5 text-sm text-violet-200 hover:bg-violet-500/10 disabled:opacity-40 disabled:hover:bg-transparent inline-flex items-center justify-center gap-1.5">
        <Plus className="w-4 h-4" /> 행사 추가{full ? ` (${BUILD_CARDS_MAX}개까지)` : ` (${value.length}/${BUILD_CARDS_MAX})`}
      </button>
    </div>
  );
}
