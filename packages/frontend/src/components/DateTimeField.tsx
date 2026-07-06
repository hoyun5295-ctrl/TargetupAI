/**
 * DateTimeField — 날짜(클릭 캘린더) + 시간(오전/오후 토글 + 시·분 직접 입력) 공용 입력 (2026-07-07(2))
 *
 * 브라우저 기본 datetime-local의 시간 스크롤 선택이 불편하다는 Harold님 지시로 전면 교체.
 * - 날짜 = 네이티브 date 클릭 캘린더 유지 (편한 부분 보존)
 * - 시간 = [오전|오후] 토글 + 시(1~12)·분(0~59) 직접 타이핑
 * value/onChange = ISO 문자열. 빈 값 = ''.
 * tone: 'dark'(앱 다크 톤, 기본) | 'light'(DM 라이트 패널)
 */
import { useEffect, useState } from 'react';

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
    input: 'bg-slate-900/60 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 focus:outline-none focus:border-violet-400/40 px-2 py-1.5 [color-scheme:dark]',
    num: 'bg-slate-900/60 border border-white/10 rounded-lg text-xs text-white text-center focus:outline-none focus:border-violet-400/40 py-1.5 w-11',
    segWrap: 'inline-flex rounded-lg border border-white/10 overflow-hidden',
    segOn: 'bg-violet-500/30 text-white',
    segOff: 'bg-slate-900/60 text-white/50 hover:text-white/80',
    colon: 'text-white/40',
    clear: 'text-white/40 hover:text-white/70',
  },
  light: {
    input: 'bg-white border rounded-lg text-xs px-2 py-1.5 focus:outline-none',
    num: 'bg-white border rounded-lg text-xs text-center py-1.5 w-11 focus:outline-none',
    segWrap: 'inline-flex rounded-lg border overflow-hidden',
    segOn: 'bg-slate-800 text-white',
    segOff: 'bg-white text-gray-500 hover:text-gray-800',
    colon: 'text-gray-400',
    clear: 'text-gray-400 hover:text-gray-600',
  },
} as const;

const LIGHT_BORDER = { borderColor: '#d7d9e0', color: '#1f2430' } as const;

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
    <div className={`flex items-center gap-1.5 flex-wrap ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <input
        type="date"
        value={dateStr}
        disabled={disabled}
        onChange={(e) => emit(e.target.value, isPm, hour12, minute)}
        className={t.input}
        style={lightStyle}
      />
      <div className={t.segWrap} style={lightStyle}>
        {([['오전', false], ['오후', true]] as const).map(([label, pm]) => (
          <button
            key={label}
            type="button"
            onClick={() => emit(dateStr || todayStr(), pm, clampHour(hourText), clampMin(minText))}
            className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${isPm === pm ? t.segOn : t.segOff}`}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        type="text"
        inputMode="numeric"
        maxLength={2}
        value={hourText}
        onChange={(e) => {
          const raw = e.target.value.replace(/\D/g, '').slice(0, 2);
          setHourText(raw);
          if (raw !== '') emit(dateStr || todayStr(), isPm, clampHour(raw), clampMin(minText));
        }}
        onBlur={() => setHourText(String(clampHour(hourText)))}
        aria-label="시 (1~12)"
        className={t.num}
        style={lightStyle}
      />
      <span className={`text-xs font-bold ${t.colon}`}>:</span>
      <input
        type="text"
        inputMode="numeric"
        maxLength={2}
        value={minText}
        onChange={(e) => {
          const raw = e.target.value.replace(/\D/g, '').slice(0, 2);
          setMinText(raw);
          if (raw !== '') emit(dateStr || todayStr(), isPm, clampHour(hourText), clampMin(raw));
        }}
        onBlur={() => setMinText(pad(clampMin(minText)))}
        aria-label="분 (0~59)"
        className={t.num}
        style={lightStyle}
      />
      {clearable && value && (
        <button type="button" onClick={() => onChange('')} className={`text-[11px] px-1 ${t.clear}`} aria-label="시각 지우기">지우기</button>
      )}
    </div>
  );
}
