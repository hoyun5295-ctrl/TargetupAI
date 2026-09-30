/**
 * MaterialInput — 재료 입력 공용 컴포넌트 (★ 2026-09-06 S5 · 설계서 §7)
 *
 * 이미지 몇 장(최대 5) + 행사 텍스트 + 링크 1개를 한 칸에서 받는다. 판독·생성·크레딧은 여기 없다(호출부 소유).
 * 다크 작업면(slate-950) 기준 · native dialog 0 · 모델명 0.
 * 호출부: 원클릭 캠페인(/quick-campaign) 인라인 · 이후 DM 빌더·이메일 편집기 입구(S6).
 */
import { useEffect, useMemo, useRef } from 'react';
import { ImagePlus, X, Link2 } from 'lucide-react';

export interface MaterialValue {
  files: File[];
  text: string;
  link: string;
}

export const MATERIAL_MAX_IMAGES = 5;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

export default function MaterialInput({ value, onChange, disabled, compact, onReject }: {
  value: MaterialValue;
  onChange: (next: MaterialValue) => void;
  disabled?: boolean;
  /** 편집기 입구용(텍스트 칸 낮게 · 링크 칸 숨김) */
  compact?: boolean;
  /** 형식·용량·장수로 거른 파일이 있을 때 한 줄 안내(호출부 토스트) */
  onReject?: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => value.files.map((f) => URL.createObjectURL(f)), [value.files]);
  useEffect(() => () => { previews.forEach((u) => URL.revokeObjectURL(u)); }, [previews]);

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const ok: File[] = [];
    let rejected = 0;
    for (const f of incoming) {
      if (!ACCEPT.includes(f.type) || f.size > MAX_FILE_BYTES) { rejected++; continue; }
      ok.push(f);
    }
    const room = MATERIAL_MAX_IMAGES - value.files.length;
    const take = ok.slice(0, Math.max(0, room));
    if (ok.length > take.length) rejected += ok.length - take.length;
    if (rejected > 0 && onReject) onReject(`${rejected}장을 제외했습니다(JPG·PNG·WebP · 5MB 이하 · 최대 ${MATERIAL_MAX_IMAGES}장).`);
    if (take.length) onChange({ ...value, files: [...value.files, ...take] });
  };
  const removeAt = (i: number) => onChange({ ...value, files: value.files.filter((_, n) => n !== i) });

  return (
    <div className="space-y-3">
      {/* 이미지 */}
      <div
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); if (!disabled) addFiles(e.dataTransfer.files); }}
        className={`rounded-2xl border border-dashed ${disabled ? 'border-slate-200' : 'border-violet-300 hover:border-violet-300'} bg-white p-3 transition-colors`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          {previews.map((src, i) => (
            <div key={src} className="relative w-20 h-20 rounded-xl overflow-hidden bg-white border border-slate-200">
              <img src={src} alt={`재료 이미지 ${i + 1}`} className="w-full h-full object-cover" />
              {!disabled && (
                <button type="button" onClick={() => removeAt(i)} aria-label="이미지 제외"
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white/90 flex items-center justify-center hover:bg-rose-600">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          {value.files.length < MATERIAL_MAX_IMAGES && (
            <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()}
              className="w-20 h-20 rounded-xl border border-slate-300 bg-white text-violet-800 hover:bg-violet-100 hover:border-violet-300 disabled:opacity-40 flex flex-col items-center justify-center gap-1">
              <ImagePlus className="w-5 h-5" />
              <span className="text-[10px]">{value.files.length === 0 ? '이미지' : '추가'}</span>
            </button>
          )}
          <input ref={inputRef} type="file" accept={ACCEPT.join(',')} multiple hidden onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = ''; }} />
          <p className="text-[11px] text-slate-400 ml-1">
            행사 배너·상품 사진을 올려주세요. 최대 {MATERIAL_MAX_IMAGES}장 · 첫 장이 첫 화면이 됩니다.
          </p>
        </div>
      </div>

      {/* 텍스트 */}
      <textarea
        value={value.text}
        onChange={(e) => onChange({ ...value, text: e.target.value.slice(0, 8000) })}
        disabled={disabled}
        rows={compact ? 3 : 5}
        placeholder={'행사 내용을 그대로 붙여넣어 주세요(기간 · 혜택 · 상품 · 조건). 비워 두면 올린 이미지에서 읽어 채웁니다.'}
        className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-200 disabled:opacity-50"
      />

      {/* 링크 */}
      {!compact && (
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            value={value.link}
            onChange={(e) => onChange({ ...value, link: e.target.value.slice(0, 500) })}
            disabled={disabled}
            placeholder="버튼이 열 주소(행사 페이지 · 쇼핑몰) · 없으면 편집기에서 채웁니다"
            className="flex-1 rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-300 disabled:opacity-50"
          />
        </div>
      )}
    </div>
  );
}
