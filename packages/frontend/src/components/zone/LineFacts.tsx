/**
 * LineFacts.tsx — 한줄로 시그니처 칸 묶음 · 묻는 창 · 보강 시트 (★ 2026-10-05 · 설계서 docs/2026-10-05-hanjul-signature-design.md §3 · §4)
 *
 * "저희가 지어낼 수 없는 사실만 한 번 여쭙니다." 1차 칸 = 혜택(생성 전) · 기간(이메일 채우기).
 *   - 프리필 0(AI 임의 혜택 금지) · [없음] = null(다시 묻지 않는다) · 칸 안 Enter 는 제출이 아니다.
 *   - 묻는 창(허브 문자) = 생성 전 · 판정이 걸렸을 때만 · 백드롭 닫힘 없음 · 닫기 = 취소.
 *   - 보강 시트 = 생성 뒤 · 완성본이 보인 채(데스크톱 오른쪽 · 모바일 아래) · 포털(편집기 transform 에 갇히지 않게).
 * ⛔ 모델명 0 · 줄표 0 · native dialog 0.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles } from 'lucide-react';
import { MK_INPUT, MK_BTN_OUTLINE, MK_BTN_AI, MK_BTN_PRIMARY, MK_MODAL } from '../../utils/make-ui';

export type LineFactsField = 'benefit' | 'period';
export interface LineFactsValues {
  /** undefined = 아직 안 건드림 · null = [없음] · 문자열 = 사용자가 적은 값 */
  benefit?: string | null;
  period?: string | null;
}

export const LINE_FACTS_REASON = '혜택 숫자는 AI가 지어내지 않아요. 적어 주시면 그대로 쓰고, 비워도 만들어요';

const FIELD_META: Record<LineFactsField, { label: string; placeholder: string; gain: string }> = {
  benefit: { label: '혜택', placeholder: '예: 전 상품 20% · 첫 구매 5천원 쿠폰', gain: '주시면 첫 줄이 혜택으로 시작해요' },
  period: { label: '기간', placeholder: '예: 10월 11일(토)까지', gain: '주시면 마감이 함께 실려요' },
};

const stopEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') e.preventDefault(); };

/** 칸 묶음 — 받은 키만 그린다 */
export function LineFacts({ fields, values, onChange, allowNone = true }: {
  fields: readonly LineFactsField[];
  values: LineFactsValues;
  onChange: (next: LineFactsValues) => void;
  /** [없음] 칩(생성 전 묻기에서만 · 채우기 시트에서는 비우면 그대로라 필요 없다) */
  allowNone?: boolean;
}) {
  return (
    <div className="space-y-3 [&_input]:text-slate-900 [&_input]:bg-white">
      {fields.map((f) => {
        const meta = FIELD_META[f];
        const v = values[f];
        const none = v === null;
        return (
          <div key={f}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label className="text-[13px] font-bold text-slate-900" htmlFor={`line-facts-${f}`}>{meta.label}</label>
              <span className="text-[12px] text-slate-500">{meta.gain}</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                id={`line-facts-${f}`}
                className={`${MK_INPUT} !h-11 min-w-0 flex-1`}
                value={typeof v === 'string' ? v : ''}
                placeholder={none ? '없음으로 만들어요' : meta.placeholder}
                maxLength={300}
                disabled={none}
                onKeyDown={stopEnter}
                onChange={(e) => onChange({ ...values, [f]: e.target.value })}
              />
              {allowNone && (
                <button
                  type="button"
                  aria-pressed={none}
                  onClick={() => onChange({ ...values, [f]: none ? undefined : null })}
                  className={`shrink-0 h-11 px-3.5 rounded-xl border text-[13px] font-semibold transition-colors ${none ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  없음
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 사용자가 적은 혜택(공백뿐이면 없음) */
export function typedBenefit(values: LineFactsValues): string | null {
  const b = typeof values.benefit === 'string' ? values.benefit.trim() : '';
  return b ? b : null;
}

/** 생성 전 확인 창 안에 넣는 블록(크레딧 확인 창 extraContent) */
export function LineFactsInline({ values, onChange }: { values: LineFactsValues; onChange: (v: LineFactsValues) => void }) {
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-[13px] font-bold text-slate-900 mb-1"><Sparkles className="w-3.5 h-3.5 text-violet-700" />만들기 전에 하나만 여쭐게요</div>
      <p className="text-[12px] text-slate-500 mb-3 leading-relaxed">{LINE_FACTS_REASON}</p>
      <LineFacts fields={['benefit']} values={values} onChange={onChange} />
    </div>
  );
}

/** 허브 문자처럼 확인 창이 없는 입구의 생성 전 묻는 창(판정이 걸렸을 때만 연다) */
export function LineFactsAskModal({ open, line, onCancel, onSubmit }: {
  open: boolean;
  line: string;
  onCancel: () => void;
  onSubmit: (benefit: string | null) => void;
}) {
  const [values, setValues] = useState<LineFactsValues>({});
  useEffect(() => { if (open) setValues({}); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);
  if (!open) return null;
  const typed = typedBenefit(values);
  return createPortal(
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" role="dialog" aria-modal="true" aria-label="만들기 전에 하나만 여쭐게요">
      <div className={`${MK_MODAL} w-full max-w-md p-6`}>
        <div className="flex items-start gap-3 mb-3">
          <div className="min-w-0">
            <div className="text-[15px] font-bold text-slate-900">만들기 전에 하나만 여쭐게요</div>
            <p className="text-[12.5px] text-slate-500 mt-1 leading-relaxed">{LINE_FACTS_REASON}</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="닫기" className="ml-auto p-1 rounded-lg hover:bg-slate-100 shrink-0"><X className="w-4 h-4 text-slate-400" /></button>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-[12.5px] text-slate-700 mb-4 break-words">{line}</div>
        <LineFacts fields={['benefit']} values={values} onChange={setValues} allowNone={false} />
        <div className="flex flex-col-reverse sm:flex-row gap-2 mt-5">
          <button type="button" className={`${MK_BTN_OUTLINE} !h-10 flex-1`} onClick={() => onSubmit(null)}>혜택 없이 만들기</button>
          <button type="button" className={`${MK_BTN_AI} flex-1`} disabled={!typed} onClick={() => onSubmit(typed)}>이 혜택으로 만들기</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 생성 뒤 보강 시트 — 완성본이 보인 채 오른쪽(모바일 아래)에서 연다 */
export function LineFactsSheet({ open, onClose, title, reason, line, children, primary }: {
  open: boolean;
  onClose: () => void;
  title: string;
  reason: string;
  /** 처음 넣은 한 줄(읽기 전용 · 다시 입력 요구 0) */
  line?: string | null;
  children: ReactNode;
  primary: { label: string; tone: 'amber' | 'indigo'; disabled?: boolean; onClick: () => void; note?: string };
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="false"
      aria-label={title}
      className="fixed z-[1250] bg-white border-slate-200 shadow-2xl flex flex-col inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t md:inset-x-auto md:right-0 md:top-0 md:bottom-0 md:max-h-none md:w-[400px] md:rounded-none md:border-t-0 md:border-l"
    >
      <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-slate-100">
        <div className="min-w-0">
          <div className="text-[15px] font-bold text-slate-900">{title}</div>
          <p className="text-[12.5px] text-slate-500 mt-1 leading-relaxed">{reason}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="닫기" className="ml-auto p-1 rounded-lg hover:bg-slate-100 shrink-0"><X className="w-4 h-4 text-slate-400" /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
        {line && <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-[12.5px] text-slate-700 break-words"><span className="text-slate-400 mr-1.5">처음 적은 한 줄</span>{line}</div>}
        {children}
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center gap-2">
        <button type="button" className={`${MK_BTN_OUTLINE} !h-10`} onClick={onClose}>이대로 쓰기</button>
        <div className="ml-auto flex flex-col items-end">
          <button type="button" disabled={primary.disabled} onClick={primary.onClick} className={primary.tone === 'amber' ? MK_BTN_AI : MK_BTN_PRIMARY}>{primary.label}</button>
          {primary.note && <span className="text-[11.5px] text-slate-400 mt-1">{primary.note}</span>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
