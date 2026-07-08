/**
 * DateTimeField — 날짜(클릭 캘린더) + 시간(오전/오후 + 시·분) 공용 예약 입력
 *   2026-07-07(2) 신설 · 2026-07-08 UI 전면 정비(답답한 wrap·빈 네이티브 박스 → 2행 클린 레이아웃 + 아이콘).
 *   2026-07-08(2) 한 줄 배치 — Harold님 지시: 날짜·오전/오후·시:분이 줄바꿈 없이 한 줄에 들어가도록 크기·배분 축소(wrap 금지).
 *
 * 브라우저 datetime-local 시간 스크롤이 불편하다는 Harold님 지시로 시간은 [오전|오후] + 시(1~12)·분(0~59) 직접 입력.
 * value/onChange = ISO 문자열. 빈 값 = ''. tone: 'dark'(앱, 기본) | 'light'(DM 라이트 패널).
 * 이메일·인앱·마케팅캘린더·AI Operator 예약 시점 공용 — 이 컴포넌트만 고치면 전 화면 반영.
 */
import { useEffect, useState } from 'react';
import { Calendar, Clock } from 'lucide-react';

/** ISO → datetime-local 포맷(YYYY-MM-DDTHH:mm, 로컬). 무효 = '' */
export function isoToLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local 포맷(로컬) → ISO. 무효 = '' */
export function localInputToIso(local?: string | null): string {
  if (!local) return '';
  const d = new Date(local);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

interface DateTimeFieldProps {
  /** ISO 문자열 ('' = 미설정) */
  value: string | null | undefined;
  onChange: (iso: string) => void;
  tone?: 'dark' | 'light';
  /** 날짜만 지운 초기화 버튼 표시 (기본 false) */
  clearable?: boolean;
  disabled?: boolean;
}

const TONE = {
  dark: {
    date: 'w-full pl-7 pr-1.5 py-2 bg-slate-900/70 border border-white/12 rounded-lg text-xs text-white [color-scheme:dark] focus:outline-none focus:border-violet-400/50 transition-colors',
    icon: 'text-violet-300/70',
    timeWrap: 'inline-flex shrink-0 items-center gap-1 bg-slate-900/70 border border-white/12 rounded-lg pl-2 pr-1.5 py-2',
    num: 'bg-transparent text-xs text-white text-center font-semibold focus:outline-none w-5 tabular-nums',
    colon: 'text-white/40 font-bold',
    segWrap: 'inline-flex shrink-0 rounded-lg border border-white/12 overflow-hidden bg-slate-900/70',
    segOn: 'bg-violet-500/40 text-white',
    segOff: 'text-white/45 hover:text-white/80',
    clear: 'text-white/40 hover:text-white/70',
  },
  light: {
    date: 'w-full pl-7 pr-1.5 py-2 bg-white border rounded-lg text-xs text-gray-900 focus:outline-none transition-colors',
    icon: 'text-violet-500/70',
    timeWrap: 'inline-flex shrink-0 items-center gap-1 bg-white border rounded-lg pl-2 pr-1.5 py-2',
    num: 'bg-transparent text-xs text-gray-900 text-center font-semibold focus:outline-none w-5 tabular-nums',
    colon: 'text-gray-400 font-bold',
    segWrap: 'inline-flex shrink-0 rounded-lg border overflow-hidden bg-white',
    segOn: 'bg-slate-800 text-white',
    segOff: 'text-gray-500 hover:text-gray-800',
    clear: 'text-gray-400 hover:text-gray-600',
  },
} as const;

const LIGHT_BORDER = { borderColor: '#d7d9e0' } as const;

export function DateTimeField({ value, onChange, tone = 'dark', clearable = false, disabled = false }: DateTimeFieldProps) {
  const d = value ? new Date(value) : null;
  const valid = !!(d && !isNaN(d.getTime()));
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = valid ? `${d!.getFullYear()}-${pad(d!.getMonth() + 1)}-${pad(d!.getDate())}` : '';
  const hours24 = valid ? d!.getHours() : 9;
  const isPm = hours24 >= 12;
  const hour12 = ((hours24 + 11) % 12) + 1;
  const minute = valid ? d!.getMinutes() : 0;

  // 타이핑 중 자연스럽게 — 로컬 텍스트 상태 + blur/변경 시 범위 보정 후 반영
  const [hourText, setHourText] = useState(String(hour12));
  const [minText, setMinText] = useState(pad(minute));
  useEffect(() => { setHourText(String(hour12)); setMinText(pad(minute)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const todayStr = () => {
    const n = new Date();
    return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
  };

  const emit = (nextDate: string, nextPm: boolean, nextH12: number, nextMin: number) => {
    if (!nextDate) { onChange(''); return; }
    const [yy, mm, dd] = nextDate.split('-').map(Number);
    if (!yy || !mm || !dd) { onChange(''); return; }
    const h24 = (nextH12 % 12) + (nextPm ? 12 : 0);
    const out = new Date(yy, mm - 1, dd, h24, nextMin, 0, 0);
    onChange(isNaN(out.getTime()) ? '' : out.toISOString());
  };

  const clampHour = (raw: string): number => {
    const n = parseInt(raw.replace(/\D/g, ''), 10);
    if (!isFinite(n)) return hour12;
    return Math.min(12, Math.max(1, n));
  };
  const clampMin = (raw: string): number => {
    const n = parseInt(raw.replace(/\D/g, ''), 10);
    if (!isFinite(n)) return minute;
    return Math.min(59, Math.max(0, n));
  };

  const t = TONE[tone];
  const lightStyle = tone === 'light' ? LIGHT_BORDER : undefined;

  return (
    <div className={`flex items-center gap-1.5 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* 날짜 — 클릭 캘린더 (한 줄 안에서 남는 폭을 차지, min-w로 잘림 방지) */}
      <div className="relative flex-1 min-w-[7.5rem]">
        <Calendar className={`w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none ${t.icon}`} />
        <input
          type="date"
          value={dateStr}
          disabled={disabled}
          onChange={(e) => emit(e.target.value, isPm, clampHour(hourText), clampMin(minText))}
          className={t.date}
          style={lightStyle}
        />
      </div>

      {/* 오전/오후 */}
      <div className={t.segWrap} style={lightStyle}>
        {([['오전', false], ['오후', true]] as const).map(([label, pm]) => (
          <button
            key={label}
            type="button"
            disabled={disabled}
            onClick={() => emit(dateStr || todayStr(), pm, clampHour(hourText), clampMin(minText))}
            className={`px-2 py-2 text-xs font-medium transition-colors ${isPm === pm ? t.segOn : t.segOff}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 시:분 */}
      <div className={t.timeWrap} style={lightStyle}>
        <Clock className={`w-3.5 h-3.5 ${t.icon}`} />
        <input
          type="text"
          inputMode="numeric"
          maxLength={2}
          value={hourText}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, '').slice(0, 2);
            setHourText(raw);
            if (raw !== '') emit(dateStr || todayStr(), isPm, clampHour(raw), clampMin(minText));
          }}
          onBlur={() => setHourText(String(clampHour(hourText)))}
          aria-label="시 (1~12)"
          className={t.num}
        />
        <span className={`text-xs ${t.colon}`}>:</span>
        <input
          type="text"
          inputMode="numeric"
          maxLength={2}
          value={minText}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, '').slice(0, 2);
            setMinText(raw);
            if (raw !== '') emit(dateStr || todayStr(), isPm, clampHour(hourText), clampMin(raw));
          }}
          onBlur={() => setMinText(pad(clampMin(minText)))}
          aria-label="분 (0~59)"
          className={t.num}
        />
      </div>

      {clearable && value && (
        <button type="button" onClick={() => onChange('')} className={`shrink-0 text-[11px] px-1 ${t.clear}`} aria-label="시각 지우기">지우기</button>
      )}
    </div>
  );
}
