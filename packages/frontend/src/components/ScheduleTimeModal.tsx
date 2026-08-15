/**
 * ScheduleTimeModal — 예약 발송 시각 선택
 *
 * ★ 2026-08-15 전면 재작성.
 *   옛 화면은 검증 실패 안내를 `document.createElement` + `innerHTML` **문자열**로 만들어
 *   body에 직접 붙였다(인라인 style·onclick 속성·이모지). React 밖에서 DOM을 조작하는 구조라
 *   화면이 언마운트돼도 그 노드가 남을 수 있고, 문자열 HTML이라 안전 검사도 받지 못했다.
 *   → 셸(`shared/ConfirmDialogShell`)로 통일하고, 검증 오류는 **창 안 인라인 메시지**로 바꾼다.
 *   선택 로직(빠른 선택·날짜/시간 분리 입력·과거 시각 차단)은 무변경이다.
 */

import { useState, useEffect } from 'react';
import { CalendarClock, AlertCircle } from 'lucide-react';
import ConfirmDialogShell from './shared/ConfirmDialogShell';

interface ScheduleTimeModalProps {
  show: boolean;
  reserveDateTime: string;
  setReserveDateTime: (v: string) => void;
  setReserveEnabled: (v: boolean) => void;
  onClose: () => void;
}

const toLocalInput = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

const QUICK = [
  { label: '1시간 후', hours: 1 },
  { label: '3시간 후', hours: 3 },
  { label: '내일 오전 9시', tomorrow: 9 },
] as const;

export default function ScheduleTimeModal({
  show, reserveDateTime, setReserveDateTime, setReserveEnabled, onClose,
}: ScheduleTimeModalProps) {
  const [error, setError] = useState('');

  useEffect(() => { if (show) setError(''); }, [show]);

  if (!show) return null;

  const datePart = reserveDateTime?.split('T')[0] || '';
  const timePart = reserveDateTime?.split('T')[1] || '';
  const hour = timePart.split(':')[0] || '09';
  const minute = timePart.split(':')[1] || '00';

  const setDate = (v: string) => { setReserveDateTime(`${v}T${timePart || '09:00'}`); setError(''); };
  const setHour = (v: string) => {
    setReserveDateTime(`${datePart || new Date().toISOString().split('T')[0]}T${v}:${minute}`);
    setError('');
  };
  const setMinute = (v: string) => {
    setReserveDateTime(`${datePart || new Date().toISOString().split('T')[0]}T${hour}:${v}`);
    setError('');
  };

  const confirm = () => {
    if (!reserveDateTime) { setError('예약 시각을 먼저 선택해 주세요.'); return; }
    if (new Date(reserveDateTime) <= new Date()) {
      setError('현재 시각보다 이전으로는 예약할 수 없습니다.');
      return;
    }
    onClose();
  };

  const selectClass =
    'w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-800 ring-1 ring-slate-200 ' +
    'focus:ring-2 focus:ring-blue-500/50 outline-none transition shadow-sm cursor-pointer';

  return (
    <ConfirmDialogShell
      show
      tone="blue"
      icon={<CalendarClock size={18} strokeWidth={1.9} className="text-white" />}
      title="예약 시각 설정"
      subtitle="지정한 시각에 자동으로 발송됩니다."
      z="z-[2150]"
      maxW="max-w-[460px]"
      cancelLabel="예약 안 함"
      onCancel={() => { setReserveEnabled(false); setReserveDateTime(''); onClose(); }}
      confirmLabel="이 시각으로 예약"
      onConfirm={confirm}
    >
      <div>
        <p className="text-[11.5px] text-slate-400 mb-2">빠른 선택</p>
        <div className="grid grid-cols-3 gap-2">
          {QUICK.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => {
                const d = new Date();
                if ('hours' in opt) d.setHours(d.getHours() + opt.hours);
                else { d.setDate(d.getDate() + 1); d.setHours(opt.tomorrow, 0, 0, 0); }
                setReserveDateTime(toLocalInput(d));
                setError('');
              }}
              className="py-2 px-2 rounded-xl text-[12px] font-medium text-slate-600 bg-white ring-1 ring-slate-200 hover:ring-blue-300 hover:text-blue-600 hover:bg-blue-50/50 transition shadow-sm"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-[1fr_auto_auto] gap-2 items-end">
        <div>
          <p className="text-[11.5px] text-slate-400 mb-2">날짜</p>
          <input
            type="date"
            value={datePart}
            onChange={(e) => setDate(e.target.value)}
            min={new Date().toISOString().split('T')[0]}
            className={selectClass}
          />
        </div>
        <div>
          <p className="text-[11.5px] text-slate-400 mb-2">시</p>
          <select value={hour} onChange={(e) => setHour(e.target.value)} className={`${selectClass} w-[76px] text-center`}>
            {Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0')).map((h) => (
              <option key={h} value={h}>{h}시</option>
            ))}
          </select>
        </div>
        <div>
          <p className="text-[11.5px] text-slate-400 mb-2">분</p>
          <select value={minute} onChange={(e) => setMinute(e.target.value)} className={`${selectClass} w-[76px] text-center`}>
            {Array.from({ length: 12 }, (_, i) => (i * 5).toString().padStart(2, '0')).map((m) => (
              <option key={m} value={m}>{m}분</option>
            ))}
          </select>
        </div>
      </div>

      {reserveDateTime && !error && (
        <div className="mt-4 px-3.5 py-3 rounded-xl bg-slate-50/70 ring-1 ring-slate-900/5">
          <p className="text-[11.5px] text-slate-400">예약 시각</p>
          <p className="text-[14px] font-semibold text-blue-600 mt-0.5">
            {new Date(reserveDateTime).toLocaleString('ko-KR', {
              timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4 px-3.5 py-2.5 rounded-xl bg-rose-50/70 ring-1 ring-rose-200/70 text-[12px] text-rose-800 inline-flex items-start gap-2 w-full">
          <AlertCircle size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}
    </ConfirmDialogShell>
  );
}
