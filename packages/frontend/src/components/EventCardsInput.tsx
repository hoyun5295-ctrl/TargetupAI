/**
 * EventCardsInput — 행사 카드 목록 입력(★ 2026-09-06 v3 · 설계서 §10 고객 재료 페이지)
 *
 * 카드 1개 = 행사 1개 = {제목 40자 · 행사 내용 · 이미지 ≤3 · 링크 1 · "이 문구를 그대로 씁니다"(면허)}. 최대 3장(4번째 [행사 추가]는 disabled + 사유).
 * 이미지 objectURL 은 카드 컴포넌트 언마운트에서만 해제(전체 재생성 0) · key = 카드 id · 판독·생성·크레딧은 여기 없다(호출부 소유).
 * 다크 작업면(slate-950) · native dialog 0 · 모델명 0.
 */
import { useEffect, useMemo, useRef } from 'react';
import { ImagePlus, X, Link2, Plus, Trash2 } from 'lucide-react';

export interface EventCardValue {
  id: string;
  title: string;
  text: string;
  link: string;
  licensed: boolean;
  files: File[];
}

export const EVENT_CARDS_MAX = 3;
export const EVENT_CARD_IMAGES_MAX = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

export function newEventCard(): EventCardValue {
  const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : `c${Date.now().toString(36)}`;
  return { id, title: '', text: '', link: '', licensed: false, files: [] };
}

function EventCard({ index, value, onChange, onRemove, disabled, canRemove, onReject }: {
  index: number; value: EventCardValue; onChange: (v: EventCardValue) => void; onRemove: () => void; disabled?: boolean; canRemove: boolean; onReject?: (m: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => value.files.map((f) => URL.createObjectURL(f)), [value.files]);
  useEffect(() => () => { previews.forEach((u) => URL.revokeObjectURL(u)); }, [previews]);

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const ok: File[] = [];
    let rejected = 0;
    for (const f of Array.from(list)) {
      if (!ACCEPT.includes(f.type) || f.size > MAX_FILE_BYTES) { rejected++; continue; }
      ok.push(f);
    }
    const room = EVENT_CARD_IMAGES_MAX - value.files.length;
    const take = ok.slice(0, Math.max(0, room));
    if (ok.length > take.length) rejected += ok.length - take.length;
    if (rejected > 0 && onReject) onReject(`${rejected}장을 제외했습니다(JPG·PNG·WebP · 5MB 이하 · 카드당 최대 ${EVENT_CARD_IMAGES_MAX}장).`);
    if (take.length) onChange({ ...value, files: [...value.files, ...take] });
  };

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
        onDrop={(e) => { e.preventDefault(); if (!disabled) addFiles(e.dataTransfer.files); }}
        className={`rounded-xl border border-dashed ${disabled ? 'border-white/10' : 'border-violet-400/40 hover:border-violet-300/60'} bg-white/[0.02] p-2.5`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          {previews.map((src, i) => (
            <div key={src} className="relative w-16 h-16 rounded-lg overflow-hidden bg-slate-900 border border-white/10">
              <img src={src} alt={`행사 ${index + 1} 이미지 ${i + 1}`} className="w-full h-full object-cover" />
              {i === 0 && <span className="absolute left-1 bottom-1 px-1 rounded bg-black/70 text-white/90 text-[9px]">첫 화면</span>}
              {!disabled && (
                <button type="button" onClick={() => onChange({ ...value, files: value.files.filter((_, n) => n !== i) })} aria-label="이미지 제외"
                  className="absolute top-1 right-1 w-4 h-4 rounded-full bg-black/70 text-white/90 flex items-center justify-center hover:bg-rose-600"><X className="w-2.5 h-2.5" /></button>
              )}
            </div>
          ))}
          {value.files.length < EVENT_CARD_IMAGES_MAX && (
            <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()}
              className="w-16 h-16 rounded-lg border border-white/15 bg-white/5 text-violet-200 hover:bg-violet-500/20 disabled:opacity-40 flex flex-col items-center justify-center gap-0.5">
              <ImagePlus className="w-4 h-4" /><span className="text-[10px]">{value.files.length === 0 ? '배너' : '추가'}</span>
            </button>
          )}
          <input ref={inputRef} type="file" accept={ACCEPT.join(',')} multiple hidden onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = ''; }} />
          <p className="text-[11px] text-white/45 ml-1">행사 배너·상품 사진 최대 {EVENT_CARD_IMAGES_MAX}장 · 첫 장이 이 행사의 대표 이미지</p>
        </div>
      </div>
      <textarea value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value.slice(0, 4000) })} disabled={disabled} rows={3}
        placeholder="행사 내용(기간 · 혜택 · 상품 · 조건)을 그대로 붙여넣어 주세요. 비워 두면 올린 이미지에서 읽어 채웁니다."
        className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-violet-400/60 disabled:opacity-50" />
      <div className="flex items-center gap-2 flex-wrap">
        <Link2 className="w-4 h-4 text-white/40 shrink-0" />
        <input value={value.link} onChange={(e) => onChange({ ...value, link: e.target.value.slice(0, 500) })} disabled={disabled}
          placeholder="이 행사의 버튼이 열 주소(행사 페이지)"
          className="flex-1 min-w-[180px] rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-violet-400/60 disabled:opacity-50" />
        <label className={`inline-flex items-center gap-1.5 text-[12px] ${value.text.trim() ? 'text-white/80 cursor-pointer' : 'text-white/35'}`} title={value.text.trim() ? undefined : '행사 내용을 쓰면 체크할 수 있습니다'}>
          <input type="checkbox" className="accent-violet-500" checked={value.licensed && !!value.text.trim()} disabled={disabled || !value.text.trim()} onChange={(e) => onChange({ ...value, licensed: e.target.checked })} />
          이 문구를 그대로 씁니다(숫자 포함)
        </label>
      </div>
    </div>
  );
}

export default function EventCardsInput({ value, onChange, disabled, onReject }: {
  value: EventCardValue[];
  onChange: (next: EventCardValue[]) => void;
  disabled?: boolean;
  onReject?: (message: string) => void;
}) {
  const full = value.length >= EVENT_CARDS_MAX;
  return (
    <div className="space-y-3">
      {value.map((c, i) => (
        <EventCard key={c.id} index={i} value={c} disabled={disabled} canRemove={value.length > 1} onReject={onReject}
          onChange={(v) => onChange(value.map((x) => (x.id === c.id ? v : x)))}
          onRemove={() => onChange(value.filter((x) => x.id !== c.id))} />
      ))}
      <button type="button" disabled={disabled || full} onClick={() => onChange([...value, newEventCard()])}
        title={full ? `행사는 ${EVENT_CARDS_MAX}개까지 담깁니다` : undefined}
        className="w-full rounded-2xl border border-dashed border-violet-400/30 py-2.5 text-sm text-violet-200 hover:bg-violet-500/10 disabled:opacity-40 disabled:hover:bg-transparent inline-flex items-center justify-center gap-1.5">
        <Plus className="w-4 h-4" /> 행사 추가{full ? ` (${EVENT_CARDS_MAX}개까지)` : ` (${value.length}/${EVENT_CARDS_MAX})`}
      </button>
    </div>
  );
}
