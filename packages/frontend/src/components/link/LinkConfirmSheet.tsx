/**
 * LinkConfirmSheet — 링크 화면 · PC 할 일의 확인 창 하나(★ 2026-10-18 · Harold 「승인도 클릭하면 모달로 다시 확인」 · 설계서 §0 ①)
 *
 * 승인 · 보내기 · 취소 · 건너뛰기 · 미루기 · 정지를 누르면 바로 실행하지 않고 이 창이 뜬다.
 * 창이 보여 주는 것 = 받는 사람 · 나갈 것 · 비용 · 되돌릴 수 있는지(rows · notes) · 확정 버튼 1개.
 *
 * ⛔ 확정 버튼에 자동 포커스를 두지 않는다(회의론자 S3 · 위험 동작을 Enter 한 번으로 실행하지 않게) — 창 자체에 포커스.
 * ⛔ 실행 중에는 닫지 않는다(완료 응답이 엉뚱한 화면 상태에 적용되지 않게) · z = 확인·차단 창 티어(z-[2000]).
 * ⛔ native dialog 0 · 줄표 0.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Info, Loader2, X } from 'lucide-react';

export interface LinkConfirmRow { label: string; value: ReactNode }
export interface LinkConfirmNote { tone: 'info' | 'warn'; text: ReactNode }

const BTN = {
  primary: 'bg-indigo-600 hover:bg-indigo-700 text-white',
  amber: 'bg-amber-500 hover:bg-amber-400 text-slate-900',
  danger: 'bg-rose-600 hover:bg-rose-700 text-white',
} as const;

export default function LinkConfirmSheet({
  open, title, rows = [], notes = [], children, confirmLabel, tone = 'primary', busy = false, onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  rows?: LinkConfirmRow[];
  notes?: LinkConfirmNote[];
  /** 나갈 문안 미리보기 등 */
  children?: ReactNode;
  confirmLabel: string;
  tone?: keyof typeof BTN;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  // 열림 사건에만 반응한다(콜백 prop 을 의존성에 넣으면 렌더마다 포커스를 빼앗는다 · LESSONS 0902)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing && !busyRef.current) cancelRef.current();
    };
    window.addEventListener('keydown', onKey);
    setTimeout(() => boxRef.current?.focus(), 30);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[2000] bg-slate-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div
        ref={boxRef}
        tabIndex={-1}
        className="w-full sm:max-w-[480px] max-h-[92vh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl outline-none"
      >
        <div className="px-5 pt-5 pb-3 flex items-start gap-3">
          <h2 className="flex-1 min-w-0 text-[17px] font-bold tracking-[-0.02em] text-slate-900 leading-snug">{title}</h2>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="닫기"
            className="shrink-0 h-8 w-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>
        {rows.length > 0 && (
          <div className="mx-5 rounded-xl border border-slate-200 px-4 py-3 space-y-2">
            {rows.map((r) => (
              <p key={r.label} className="flex justify-between gap-4 text-[13px]">
                <span className="text-slate-500 shrink-0">{r.label}</span>
                <b className="text-slate-900 text-right min-w-0 break-words">{r.value}</b>
              </p>
            ))}
          </div>
        )}
        {children && <div className="mx-5 mt-3">{children}</div>}
        {notes.length > 0 && (
          <ul className="mx-5 mt-3 space-y-1.5">
            {notes.map((n, i) => (
              <li key={i} className={`flex gap-1.5 text-[12.5px] leading-relaxed ${n.tone === 'warn' ? 'text-amber-800' : 'text-slate-600'}`}>
                {n.tone === 'warn'
                  ? <AlertTriangle className="w-[13px] h-[13px] mt-0.5 shrink-0" />
                  : <Info className="w-[13px] h-[13px] mt-0.5 shrink-0 text-indigo-600" />}
                <span className="min-w-0">{n.text}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="px-5 pt-4 pb-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy}
            className="h-11 px-4 rounded-xl border border-slate-300 text-[14px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
            돌아가기
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
            className={`h-11 px-5 rounded-xl text-[14px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60 ${BTN[tone]}`}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
