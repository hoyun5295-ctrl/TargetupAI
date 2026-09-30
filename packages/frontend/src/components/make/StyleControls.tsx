/**
 * StyleControls — 수정 화면 오른쪽 블록 패널의 "누르면 바로 바뀌는" 조작(★ 2026-09-27 만들기 개편 · 목업 (라))
 *
 * 구도(그림 타일) · 배경(색 칸) · 글자 크기(작게·보통·크게) · 정렬 · 색. DM·이메일이 같은 부품을 쓰고,
 * 채널이 렌더하지 않는 값은 호출부가 옵션을 빼서 감춘다(죽은 컨트롤 금지 · LESSONS_FRONTEND 07-10).
 * 값의 원장은 기존 그대로(DM = setSectionStyle · 이메일 = 섹션 최상위 필드) — 새 저장 축 0.
 */
import type { ReactNode } from 'react';
import { AlignLeft, AlignCenter, AlignRight, Plus } from 'lucide-react';

export function PanelBlock({ title, hint, children, right }: { title: string; hint?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="py-4 border-t border-slate-200 first:border-t-0">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[12.5px] font-bold text-slate-900">{title}</span>
        {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      {children}
    </div>
  );
}

/** 구도 이름(담당자 말) — 값은 렌더러 표(DM_TREATMENTS · EMAIL_TREATMENT_OPTIONS) 그대로 */
const TREATMENT_NAME: Record<string, Record<string, string>> = {
  hero: { classic: '기본', full_bleed: '꽉 차게', split: '나란히', typographic: '글자만', editorial_overlap: '겹치기' },
  cta: { classic: '꽉 찬 버튼', ghost: '테두리만', bar: '넓은 띠', sticky: '아래에 고정' },
  product_carousel: { classic: '2열', focus: '대표 강조', list: '목록' },
  text_card: { classic: '기본', lead: '큰 글씨', framed: '테두리', quote: '인용' },
  coupon: { classic: '기본', ticket: '티켓', spotlight: '강조' },
  gallery: { classic: '기본', mosaic: '모자이크' },
  reviews: { classic: '기본', quote: '대표 후기' },
  countdown: { classic: '기본', banner: '슬림 띠' },
  promo_code: { classic: '어두운 판', light: '밝은 카드' },
  store_info: { classic: '기본', card: '카드' },
};
export function treatmentName(type: string, value: string, fallback?: string): string {
  return TREATMENT_NAME[type]?.[value] || fallback || value;
}

/** 구도 그림(작은 도식) — 브랜드 색 한 가지로 칠한다 */
function Thumb({ type, value, color }: { type: string; value: string; color: string }) {
  const img = <span className="block rounded-sm" style={{ background: color, opacity: 0.75 }} />;
  const line = (w: string, h = 4, dark = true) => <span className="block rounded-full" style={{ width: w, height: h, background: dark ? '#2b2320' : '#fff', opacity: dark ? 0.8 : 0.95 }} />;
  const box = 'w-full h-full rounded-md overflow-hidden relative bg-white';
  if (type === 'hero') {
    if (value === 'full_bleed') return <span className={box}><span className="absolute inset-0" style={{ background: color, opacity: 0.8 }} /><span className="absolute left-2 right-2 bottom-2 space-y-1">{line('70%', 4, false)}{line('45%', 3, false)}</span></span>;
    if (value === 'split') return <span className={`${box} flex`}><span className="w-1/2 h-full" style={{ background: color, opacity: 0.8 }} /><span className="flex-1 p-1.5 space-y-1 self-center">{line('90%')}{line('60%', 3)}</span></span>;
    if (value === 'typographic') return <span className={`${box} flex flex-col justify-center p-2 space-y-1.5`}>{line('90%', 6)}{line('60%', 3)}</span>;
    if (value === 'editorial_overlap') return <span className={box}><span className="absolute inset-x-0 top-0 h-3/5" style={{ background: color, opacity: 0.8 }} /><span className="absolute left-2 right-2 bottom-1.5 rounded bg-white shadow p-1 space-y-1">{line('80%', 3)}{line('50%', 3)}</span></span>;
    return <span className={`${box} flex flex-col`}><span className="h-3/5" style={{ background: color, opacity: 0.8 }} /><span className="p-1.5 space-y-1">{line('80%')}{line('50%', 3)}</span></span>;
  }
  if (type === 'cta') {
    if (value === 'ghost') return <span className={`${box} flex items-center justify-center p-2`}><span className="w-full h-4 rounded" style={{ border: `2px solid ${color}` }} /></span>;
    if (value === 'sticky') return <span className={`${box} flex flex-col justify-end`}><span className="h-4 w-full" style={{ background: color }} /></span>;
    if (value === 'bar') return <span className={`${box} flex items-center`}><span className="h-5 w-full" style={{ background: color }} /></span>;
    return <span className={`${box} flex items-center justify-center p-2`}><span className="w-full h-4 rounded" style={{ background: color }} /></span>;
  }
  if (type === 'product_carousel') {
    if (value === 'focus') return <span className={`${box} p-1.5 flex flex-col gap-1`}><span className="flex-1 rounded-sm" style={{ background: color, opacity: 0.45 }} /><span className="h-3 flex gap-1"><span className="flex-1 rounded-sm" style={{ background: color, opacity: 0.45 }} /><span className="flex-1 rounded-sm" style={{ background: color, opacity: 0.45 }} /></span></span>;
    if (value === 'list') return <span className={`${box} p-1.5 flex flex-col gap-1 justify-center`}>{[0, 1, 2].map((i) => <span key={i} className="h-2 rounded-sm" style={{ background: color, opacity: 0.45 }} />)}</span>;
    return <span className={`${box} p-1.5 grid grid-cols-2 gap-1`}>{[0, 1, 2, 3].map((i) => <span key={i} className="rounded-sm" style={{ background: color, opacity: 0.45 }} />)}</span>;
  }
  if (type === 'text_card') {
    if (value === 'lead') return <span className={`${box} p-2 flex flex-col justify-center gap-1`}>{line('95%', 5)}{line('80%', 5)}</span>;
    if (value === 'framed') return <span className={`${box} p-1.5`}><span className="block w-full h-full rounded p-1.5 space-y-1" style={{ border: `2px solid ${color}` }}>{line('70%')}{line('90%', 3)}</span></span>;
    if (value === 'quote') return <span className={`${box} p-2 flex flex-col gap-1`}><span className="text-[14px] leading-none font-black" style={{ color }}>“</span>{line('80%', 3)}{line('60%', 3)}</span>;
    return <span className={`${box} p-2 flex flex-col gap-1 justify-center`}>{line('70%')}{line('95%', 3)}{line('85%', 3)}</span>;
  }
  return <span className={`${box} p-1.5 flex flex-col gap-1`}>{img}<span className="flex-1" style={{ background: color, opacity: value === 'classic' ? 0.25 : 0.55, borderRadius: 3 }} />{line('60%', 3)}</span>;
}

export function TreatmentTiles({ type, options, value, onChange, color }: { type: string; options: Array<{ value: string; label?: string }>; value: string; onChange: (v: string) => void; color: string }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
      {options.map((o) => {
        const on = (value || 'classic') === o.value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)} className="flex flex-col items-center gap-1.5 group" aria-pressed={on}>
            <span className={`block w-full aspect-[5/6] rounded-lg p-[3px] transition-colors ${on ? 'bg-violet-500 ring-2 ring-violet-300' : 'bg-slate-100 group-hover:bg-slate-200'}`}>
              <Thumb type={type} value={o.value} color={color} />
            </span>
            <span className={`text-[11px] ${on ? 'text-slate-900 font-bold' : 'text-slate-500'}`}>{treatmentName(type, o.value, o.label)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Swatches({ options, value, onChange, custom }: {
  options: Array<{ value: string; color: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
  /** 직접 고르기(색 입력) */
  custom?: { value: string; onChange: (hex: string) => void };
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button key={o.value || 'none'} type="button" title={o.label} aria-label={o.label} aria-pressed={on} onClick={() => onChange(o.value)}
            className={`w-8 h-8 rounded-lg p-[3px] ${on ? 'ring-2 ring-violet-400 bg-violet-100' : 'bg-slate-100 hover:bg-slate-200'}`}>
            <span className="block w-full h-full rounded-md border border-black/10" style={{ background: o.color }} />
          </button>
        );
      })}
      {custom && (
        <label className="w-8 h-8 rounded-lg border border-dashed border-slate-300 flex items-center justify-center cursor-pointer text-slate-500 hover:text-slate-900 relative overflow-hidden" title="색 직접 고르기">
          <Plus className="w-4 h-4" />
          <input type="color" value={custom.value || '#8b5cf6'} onChange={(e) => custom.onChange(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" aria-label="색 직접 고르기" />
        </label>
      )}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: Array<{ value: T; label: ReactNode; aria?: string }>; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
      {options.map((o) => (
        <button key={o.value} type="button" aria-label={o.aria} aria-pressed={value === o.value} onClick={() => onChange(o.value)}
          className={`h-8 px-3 rounded-lg text-[12.5px] font-semibold inline-flex items-center justify-center ${value === o.value ? 'bg-violet-600 text-white' : 'text-slate-500 hover:text-slate-900'}`}>{o.label}</button>
      ))}
    </div>
  );
}

export function AlignControl({ value, onChange, allowRight = true }: { value: 'left' | 'center' | 'right'; onChange: (v: 'left' | 'center' | 'right') => void; allowRight?: boolean }) {
  const opts: Array<{ value: 'left' | 'center' | 'right'; label: ReactNode; aria: string }> = [
    { value: 'left', label: <AlignLeft className="w-4 h-4" />, aria: '왼쪽 정렬' },
    { value: 'center', label: <AlignCenter className="w-4 h-4" />, aria: '가운데 정렬' },
    ...(allowRight ? [{ value: 'right' as const, label: <AlignRight className="w-4 h-4" />, aria: '오른쪽 정렬' }] : []),
  ];
  return <Segmented options={opts} value={value} onChange={onChange} />;
}

/** 글자 크기 3단 — 섹션 공통 title_size/text_size(px · 비움 = 자동) */
export const TEXT_SIZE_PRESETS: Record<'sm' | 'md' | 'lg', { title?: number; text?: number }> = {
  sm: { title: 20, text: 14 },
  md: {},
  lg: { title: 32, text: 18 },
};
export function textSizeOf(section: { title_size?: number; text_size?: number }): 'sm' | 'md' | 'lg' {
  if (!section.title_size && !section.text_size) return 'md';
  if ((section.title_size || 0) >= 28 || (section.text_size || 0) >= 18) return 'lg';
  return 'sm';
}

export const DM_BACKGROUND_SWATCHES = [
  { value: '', color: '#ffffff', label: '기본' },
  { value: 'soft', color: '#f7efe6', label: '브랜드 연한 색' },
  { value: 'tint', color: '#ecd9c6', label: '브랜드 옅은 색' },
  { value: 'dark', color: '#2b2320', label: '어두운 판' },
];
export const EMAIL_BACKGROUND_SWATCHES = [
  { value: 'none', color: '#ffffff', label: '없음' },
  { value: 'soft', color: '#f7efe6', label: '소프트' },
  { value: 'tint', color: '#ecd9c6', label: '틴트' },
  { value: 'dark', color: '#2b2320', label: '다크' },
];
