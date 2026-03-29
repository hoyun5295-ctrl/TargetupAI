import { useState } from 'react';
import { Button } from './ui';

interface ScheduleModalProps {
  show: boolean;
  onConfirm: (scheduledAt: string) => void;
  onCancel: () => void;
}

export default function ScheduleModal({ show, onConfirm, onCancel }: ScheduleModalProps) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const [date, setDate] = useState(todayStr);
  const [hour, setHour] = useState(pad(Math.min(now.getHours() + 1, 23)));
  const [minute, setMinute] = useState('00');

  if (!show) return null;

  const presets = [
    { label: '1시간 후', fn: () => { const d = new Date(now.getTime() + 3600000); setDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`); setHour(pad(d.getHours())); setMinute(pad(Math.floor(d.getMinutes() / 5) * 5)); } },
    { label: '3시간 후', fn: () => { const d = new Date(now.getTime() + 10800000); setDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`); setHour(pad(d.getHours())); setMinute(pad(Math.floor(d.getMinutes() / 5) * 5)); } },
    { label: '내일 오전 9시', fn: () => { const d = new Date(now); d.setDate(d.getDate() + 1); setDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`); setHour('09'); setMinute('00'); } },
  ];

  const selectedDateTime = new Date(`${date}T${hour}:${minute}:00`);
  const isValid = selectedDateTime > now;

  const formatPreview = () => {
    if (!isValid) return '과거 시간은 선택할 수 없습니다';
    return selectedDateTime.toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const handleConfirm = () => {
    if (!isValid) return;
    onConfirm(selectedDateTime.toISOString());
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-[2px]">
      <div className="bg-surface rounded-2xl shadow-modal max-w-sm w-full mx-4 p-6">
        <h3 className="text-base font-bold text-text mb-4">예약 발송</h3>

        {/* 빠른 선택 */}
        <div className="flex gap-2 mb-5">
          {presets.map(p => (
            <button key={p.label} onClick={p.fn}
              className="flex-1 py-2 text-xs font-semibold rounded-lg border border-border hover:border-primary-500 hover:bg-primary-50 text-text-secondary hover:text-primary-600 transition-all"
            >{p.label}</button>
          ))}
        </div>

        {/* 날짜 선택 */}
        <div className="space-y-3 mb-5">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">날짜</label>
            <input type="date" value={date} min={todayStr} onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-surface" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">시</label>
              <select value={hour} onChange={e => setHour(e.target.value)}
                className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-surface">
                {Array.from({ length: 24 }, (_, i) => pad(i)).map(h => <option key={h} value={h}>{h}시</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">분</label>
              <select value={minute} onChange={e => setMinute(e.target.value)}
                className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-surface">
                {Array.from({ length: 12 }, (_, i) => pad(i * 5)).map(m => <option key={m} value={m}>{m}분</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* 미리보기 */}
        <div className={`text-center py-3 rounded-lg mb-5 ${isValid ? 'bg-primary-50' : 'bg-error-50'}`}>
          <p className={`text-sm font-semibold ${isValid ? 'text-primary-600' : 'text-error-500'}`}>{formatPreview()}</p>
        </div>

        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>취소</Button>
          <Button className="flex-1" disabled={!isValid} onClick={handleConfirm}>예약 확정</Button>
        </div>
      </div>
    </div>
  );
}
