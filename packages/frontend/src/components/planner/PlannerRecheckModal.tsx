/**
 * PlannerRecheckModal — PC 캘린더 할 일 「발송 다시 정하기」 창(★ 2026-10-18 · 설계서 docs/2026-10-18-planner-v2-design.md §3-3)
 *
 * 링크 화면과 같은 본문(서버 buildRecheckView) · 같은 부품(PlannerRecheckPanel) · 같은 CT. 로그인 MFA 세션 안이라 인증번호는 묻지 않는다(M5).
 * 버튼마다 확인 창을 지난다(Harold 1018 ①). 행사 취소는 기존 행사 취소 API.
 * ⛔ native dialog 0 · 줄표 0 · 판정은 서버.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarCheck, Loader2, X } from 'lucide-react';
import { MK_MODAL, MK_MODAL_BACKDROP } from '../../utils/make-ui';
import { useToast } from '../ToastProvider';
import PlannerRecheckPanel from './PlannerRecheckPanel';
import { plannerApi, plannerCancelText, type RecheckAction, type RecheckView } from './planner-api';
import { plannerDay } from '../../constants/planner-status';

const POLL_MS = 8000;

export default function PlannerRecheckModal({ carrierId, eventId, onClose, onChanged }: {
  carrierId: string;
  eventId: string;
  onClose: () => void;
  /** 정한 뒤(캘린더를 다시 읽는다) */
  onChanged: () => void;
}) {
  const toast = useToast();
  const [view, setView] = useState<RecheckView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const load = useCallback(async () => {
    const r = await plannerApi<RecheckView>(`/api/marketing-planner/touchpoints/${carrierId}/recheck`);
    if (r.ok) { setView(r.data); setError(null); return; }
    setError(r.data?.error || '내용을 불러오지 못했어요.');
  }, [carrierId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busyRef.current) closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const waiting = !!view && (view.proposal.state === 'preparing' || view.current.state === 'pending');
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [waiting, load]);

  const run = async (a: RecheckAction): Promise<void> => {
    if (!view || busy) return;
    setBusy(true);
    try {
      const base = `/api/marketing-planner/touchpoints/${carrierId}/recheck`;
      const r = a.kind === 'cancel'
        ? await plannerApi(`/api/marketing-planner/events/${eventId}/cancel`, { method: 'POST', body: {} })
        : await plannerApi(`${base}/${a.kind}`, {
          method: 'POST',
          body: {
            round: view.pair.round,
            ...(a.kind === 'approve' ? { choice: a.choice, seenHash: a.choice === 'proposal' ? view.proposal.hash : view.current.hash } : {}),
            ...(a.kind === 'edit' ? { text: a.text, subject: a.subject } : {}),
            ...(a.kind === 'defer' ? { toDate: a.toDate } : {}),
          },
        });
      if (!r.ok) {
        toast.error(r.data?.error || '처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
        if (r.status === 409 || r.status === 404) await load();
        return;
      }
      if (a.kind === 'edit') { toast.success('고친 문안을 실제 주소로 검사하고 있어요. 통과하면 여기서 보낼 수 있어요.'); await load(); return; }
      if (a.kind === 'cancel') { const c = plannerCancelText(r.data); (c.warn ? toast.warning : toast.success)(c.text); }
      else toast.success(a.kind === 'approve' ? '보내기로 정했어요.' : a.kind === 'skip' ? '이 날 발송을 건너뛰었어요.' : '미뤘어요. 새 날짜 문안이 준비되면 알려 드려요.');
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className={MK_MODAL_BACKDROP} role="dialog" aria-modal="true" aria-label="발송 다시 정하기">
      <div className={`${MK_MODAL} w-full max-w-[560px] max-h-[92vh] flex flex-col`}>
        <div className="flex items-center gap-3 px-5 h-14 border-b border-slate-200 shrink-0">
          <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 grid place-items-center"><CalendarCheck className="w-4 h-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold truncate">{view ? view.event.title : '발송 다시 정하기'}</p>
            {view && <p className="text-[12px] text-slate-500 tabular-nums">{plannerDay(view.pair.date)} 문자 · 마감 {view.deadline.hour}시</p>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="닫기" className="w-9 h-9 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-40"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {view ? <PlannerRecheckPanel view={view} mode="pc" busy={busy} onAction={run} />
            : error ? <p className="text-[13px] text-rose-700">{error}</p>
              : <div className="py-12 grid place-items-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
