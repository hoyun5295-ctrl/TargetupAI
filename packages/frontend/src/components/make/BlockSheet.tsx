/**
 * BlockSheet — 결과 화면 "누른 곳만 고치기" 하단 시트(★ 2026-09-27 만들기 개편 · 목업 ④)
 *
 * 버튼 블록 = 버튼 글자 + 누르면 갈 주소(필수) + 추천 주소 칩(우리 홈페이지 · 최근 쓴 주소) — 가장 자주 채우는 칸만 크게.
 * 그 밖의 블록 = 기존 블록 편집기(SectionPropsEditor)를 그대로(make.css .mk-editor 가 변수를 정의한다 · 편집기 코드 무수정).
 * 고친 값은 스토어에 바로 들어가고 [저장] = 즉시 저장(자동 저장도 따로 돈다).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { X, Globe, RotateCcw, Type, Trash2, Loader2 } from 'lucide-react';
import SectionPropsEditor from '../dm/panels/SectionPropsEditor';
import type { Section } from '../../utils/dm-section-defaults';
import { blockLabel } from '../../utils/make-flow';
import { MK_BTN_PRIMARY, MK_INPUT } from '../../utils/make-ui';
import '../../styles/make.css';

const CTA_LABEL_MAX = 13;

export default function BlockSheet({
  section, onUpdate, onClose, onRemove, onDone, saving, suggestions, onAiRewrite, topSlot,
}: {
  section: Section;
  onUpdate: (patch: Record<string, any>) => void;
  onClose: () => void;
  onRemove: () => void;
  onDone: () => void;
  saving?: boolean;
  suggestions: Array<{ label: string; url: string; icon: 'home' | 'recent' }>;
  onAiRewrite?: () => void;
  /** ★ 2026-10-10 블록 편집기 위에 얹는 칸(상품 블록 = [몰에서 상품 바꾸기]) · 미지정 = 지금 그대로 */
  topSlot?: ReactNode;
}) {
  const urlRef = useRef<HTMLInputElement | null>(null);
  const isCta = section.type === 'cta';
  const buttons: Array<{ label: string; url: string; style: string }> = isCta ? ((section.props as any)?.buttons || []) : [];
  const b0 = buttons[0] || { label: '', url: '', style: 'primary' };
  const setB0 = (patch: Partial<typeof b0>) => {
    const next = buttons.length ? buttons.map((b, i) => (i === 0 ? { ...b, ...patch } : b)) : [{ ...b0, ...patch }];
    onUpdate({ buttons: next });
  };
  useEffect(() => { if (isCta && !b0.url) urlRef.current?.focus(); }, [section.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-x-0 bottom-0 z-[900] flex justify-center px-3 pointer-events-none">
      <div className="mk-sheet-in pointer-events-auto w-full max-w-[520px] mk-max-h-62 flex flex-col rounded-t-2xl border border-slate-300 border-b-0 bg-white shadow-[0_-20px_50px_-20px_rgba(0,0,0,0.8)]" role="dialog" aria-label={`${blockLabel(section)} 고치기`}>
        <div className="flex justify-center pt-2"><span className="w-10 h-1 rounded-full bg-slate-200" /></div>
        <div className="flex items-center justify-between px-5 pt-2 pb-3">
          <b className="text-[16px] text-slate-900">{blockLabel(section)} 고치기</b>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto mk-scroll px-5 pb-3">
          {isCta ? (
            <div className="space-y-4">
              <label className="block">
                <span className="block text-[12.5px] font-semibold text-slate-600 mb-1.5">버튼 글자</span>
                <div className="relative">
                  <input value={b0.label} maxLength={CTA_LABEL_MAX} onChange={(e) => setB0({ label: e.target.value })} className={`${MK_INPUT} pr-16`} />
                  <em className="not-italic absolute right-3 top-1/2 -translate-y-1/2 text-[11.5px] text-slate-400">{b0.label.length} / {CTA_LABEL_MAX}</em>
                </div>
              </label>
              <label className="block">
                <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-600 mb-1.5">누르면 갈 주소<em className="not-italic text-[10.5px] font-bold text-amber-950 bg-amber-400 rounded px-1.5 py-px">필수</em></span>
                <input ref={urlRef} value={b0.url} onChange={(e) => setB0({ url: e.target.value.trim() })} placeholder="https://" inputMode="url" className={`${MK_INPUT} ${!b0.url ? 'border-violet-300' : ''}`} />
              </label>
              {suggestions.length > 0 && (
                <div className="flex flex-wrap gap-2 -mt-2">
                  {suggestions.map((s) => (
                    <button key={s.url} type="button" onClick={() => setB0({ url: s.url })} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-[12px] text-slate-700 hover:bg-slate-100 max-w-full">
                      {s.icon === 'home' ? <Globe className="w-3.5 h-3.5 shrink-0" /> : <RotateCcw className="w-3.5 h-3.5 shrink-0" />}<span className="truncate">{s.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {buttons.length > 1 && <p className="text-[11.5px] text-slate-400">버튼이 {buttons.length}개예요. 나머지는 [자세히 편집]에서 고칠 수 있어요.</p>}
            </div>
          ) : (
            <div className="mk-editor">
              {topSlot}
              <SectionPropsEditor key={section.id} section={section} onUpdate={onUpdate} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-slate-200">
          {onAiRewrite && <button type="button" onClick={onAiRewrite} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-300 bg-white text-[12.5px] text-slate-700 hover:bg-slate-100"><Type className="w-4 h-4" />문구 다르게</button>}
          <button type="button" onClick={onRemove} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-300 bg-white text-[12.5px] text-slate-700 hover:bg-slate-100"><Trash2 className="w-4 h-4" />빼기</button>
          <button type="button" onClick={onDone} disabled={saving} className={`${MK_BTN_PRIMARY} ml-auto`}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}저장</button>
        </div>
      </div>
    </div>
  );
}
