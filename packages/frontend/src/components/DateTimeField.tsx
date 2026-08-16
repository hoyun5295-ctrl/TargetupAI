/**
 * DateTimeField — 날짜·시간 예약 입력 공용 컨트롤타워.
 *   2026-07-07(2) 신설 · 2026-07-08 2행 클린 레이아웃 · 2026-07-08(2) 한 줄 배치.
 *   2026-07-09 전면 개편(Harold 명시): 인라인 입력(날짜 input + 오전/오후 + 시:분 input, 칸 넘침) 폐기
 *     → 트리거 버튼 1개(선택값 한 줄 표기) + 클릭 시 다크 모달 피커(달력 그리드 + 오전/오후 + 시/분 클릭 선택).
 *     확인 시 선택값만 버튼에 표기 → 칸 넘침 0. 타이핑·시간 스크롤 함정 제거.
 *   이메일·인앱·마케팅캘린더·AI Operator·DM 예약 전 구간 공용 — 이 컴포넌트만 고치면 전 화면 동일 반영.
 *
 * value/onChange = ISO 문자열. 빈 값 = ''. tone: 'dark'(앱, 기본) | 'light'(DM 라이트 패널) — 트리거 버튼 색만 적용, 모달은 항상 다크.
 * open/onOpenChange(선택) = 제어형 오픈(부모가 다른 트리거로 모달을 열 때). 미전달 시 내부 상태로 동작.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, Clock, X, ChevronLeft, ChevronRight, Check } from 'lucide-react';

const pad2 = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;
const MINUTE_STEPS = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,...,55

/** ISO → datetime-local 포맷(YYYY-MM-DDTHH:mm, 로컬). 무효 = '' */
export function isoToLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** datetime-local 포맷(로컬) → ISO. 무효 = '' */
export function localInputToIso(local?: string | null): string {
  if (!local) return '';
  const d = new Date(local);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

/** ISO → 트리거 버튼 라벨 (예: 2026-07-09 (목) 오후 3:00). 무효 = '' */
function formatLabel(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const dow = WEEKDAYS[d.getDay()];
  const h24 = d.getHours();
  const isPm = h24 >= 12;
  const h12 = ((h24 + 11) % 12) + 1;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} (${dow}) ${isPm ? '오후' : '오전'} ${h12}:${pad2(d.getMinutes())}`;
}

interface DateTimeFieldProps {
  /** ISO 문자열 ('' = 미설정) */
  value: string | null | undefined;
  onChange: (iso: string) => void;
  tone?: 'dark' | 'light';
  /** 값 지우기 버튼 표시 (기본 false) */
  clearable?: boolean;
  disabled?: boolean;
  /** 제어형 오픈 (선택) — 부모가 별도 트리거로 모달을 열 때 */
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}

const LIGHT_BORDER = { borderColor: '#d7d9e0' } as const;

const TRIGGER = {
  dark: {
    btn: 'w-full flex items-center gap-2 pl-3 pr-2 py-2 bg-slate-900/70 border border-white/12 rounded-lg text-xs text-left hover:border-violet-400/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
    icon: 'text-violet-300/70',
    text: 'text-white truncate',
    placeholder: 'text-white/40 truncate',
    clear: 'text-white/40 hover:text-white/70',
  },
  light: {
    btn: 'w-full flex items-center gap-2 pl-3 pr-2 py-2 bg-white border rounded-lg text-xs text-left hover:border-violet-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
    icon: 'text-violet-500/70',
    text: 'text-gray-900 truncate',
    placeholder: 'text-gray-400 truncate',
    clear: 'text-gray-400 hover:text-gray-600',
  },
} as const;

export function DateTimeField({
  value, onChange, tone = 'dark', clearable = false, disabled = false, open, onOpenChange,
}: DateTimeFieldProps) {
  const controlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlled ? !!open : internalOpen;
  const setOpen = (v: boolean) => { if (controlled) onOpenChange?.(v); else setInternalOpen(v); };

  // draft — 모달 안에서만 편집, 취소 시 폐기
  const [draftDate, setDraftDate] = useState(''); // 'YYYY-MM-DD'
  const [draftPm, setDraftPm] = useState(false);
  const [draftHour, setDraftHour] = useState(9);  // 1~12
  const [draftMin, setDraftMin] = useState(0);    // 0~55 (5분 단위)
  const [viewYM, setViewYM] = useState<{ y: number; m: number }>(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });

  // 열릴 때 value로 draft 초기화 (없으면 오늘 오전 9시, 분은 가장 가까운 5분)
  useEffect(() => {
    if (!isOpen) return;
    const d = value ? new Date(value) : null;
    const base = d && !isNaN(d.getTime()) ? d : (() => { const n = new Date(); n.setHours(9, 0, 0, 0); return n; })();
    const h24 = base.getHours();
    setDraftDate(`${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(base.getDate())}`);
    setDraftPm(h24 >= 12);
    setDraftHour(((h24 + 11) % 12) + 1);
    setDraftMin(Math.min(55, Math.round(base.getMinutes() / 5) * 5));
    setViewYM({ y: base.getFullYear(), m: base.getMonth() });
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ESC 닫기 + body 스크롤 잠금
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // 달력 그리드 (앞 요일 offset + 해당 월 일수)
  const cells = useMemo(() => {
    const startDow = new Date(viewYM.y, viewYM.m, 1).getDay();
    const daysInMonth = new Date(viewYM.y, viewYM.m + 1, 0).getDate();
    const out: (number | null)[] = [];
    for (let i = 0; i < startDow; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(d);
    return out;
  }, [viewYM]);

  const now = new Date();
  const todayY = now.getFullYear(), todayM = now.getMonth(), todayD = now.getDate();
  const todayMidnight = new Date(todayY, todayM, todayD).getTime();
  const isPastDay = (d: number) => new Date(viewYM.y, viewYM.m, d).getTime() < todayMidnight;
  const selParts = draftDate ? draftDate.split('-').map(Number) : null;
  const isSelectedDay = (d: number) => !!selParts && selParts[0] === viewYM.y && selParts[1] === viewYM.m + 1 && selParts[2] === d;
  const isTodayCell = (d: number) => todayY === viewYM.y && todayM === viewYM.m && d === todayD;
  const canPrevMonth = viewYM.y > todayY || (viewYM.y === todayY && viewYM.m > todayM);

  const draftPreview = (() => {
    if (!selParts) return '';
    const [yy, mm, dd] = selParts;
    const dow = WEEKDAYS[new Date(yy, mm - 1, dd).getDay()];
    return `${yy}-${pad2(mm)}-${pad2(dd)} (${dow}) ${draftPm ? '오후' : '오전'} ${draftHour}:${pad2(draftMin)}`;
  })();

  const commit = () => {
    if (!draftDate) return;
    const [yy, mm, dd] = draftDate.split('-').map(Number);
    const h24 = (draftHour % 12) + (draftPm ? 12 : 0);
    const out = new Date(yy, mm - 1, dd, h24, draftMin, 0, 0);
    onChange(isNaN(out.getTime()) ? '' : out.toISOString());
    setOpen(false);
  };

  const trg = TRIGGER[tone];
  const label = formatLabel(value);

  return (
    <div className={`flex items-center gap-1.5 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`${trg.btn} flex-1 min-w-0`}
        style={tone === 'light' ? LIGHT_BORDER : undefined}
      >
        <Calendar className={`w-3.5 h-3.5 shrink-0 ${trg.icon}`} />
        <span className={label ? trg.text : trg.placeholder}>{label || '발송 시점 선택'}</span>
      </button>
      {clearable && value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className={`shrink-0 p-1 rounded ${trg.clear}`}
          aria-label="시각 지우기"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {isOpen && createPortal(
        <div
          className="fixed inset-0 z-[2000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-full max-w-sm bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
            {/* 헤더 */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10 bg-gradient-to-r from-slate-950 via-violet-950/40 to-slate-950">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
                  <Calendar className="w-4 h-4 text-white" />
                </div>
                <h3 className="text-white font-bold text-sm">발송 시점 선택</h3>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-white/50 hover:text-white p-1.5 hover:bg-white/5 rounded" aria-label="닫기">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* 달력 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <button
                    type="button"
                    onClick={() => setViewYM(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}
                    disabled={!canPrevMonth}
                    className="p-1.5 rounded-lg text-white/70 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="이전 달"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="text-sm font-semibold text-white tabular-nums">{viewYM.y}년 {viewYM.m + 1}월</div>
                  <button
                    type="button"
                    onClick={() => setViewYM(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))}
                    className="p-1.5 rounded-lg text-white/70 hover:bg-white/10"
                    aria-label="다음 달"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {WEEKDAYS.map((w, i) => (
                    <div key={w} className={`text-center text-[10px] font-semibold py-1 ${i === 0 ? 'text-rose-300/70' : i === 6 ? 'text-cyan-300/70' : 'text-white/40'}`}>{w}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {cells.map((d, idx) => {
                    if (d === null) return <div key={`e${idx}`} />;
                    const past = isPastDay(d);
                    const selected = isSelectedDay(d);
                    const today = isTodayCell(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        disabled={past}
                        onClick={() => setDraftDate(`${viewYM.y}-${pad2(viewYM.m + 1)}-${pad2(d)}`)}
                        className={`aspect-square rounded-lg text-xs font-medium tabular-nums transition-colors ${
                          selected
                            ? 'bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white font-bold shadow-md'
                            : past
                              ? 'text-white/15 cursor-not-allowed'
                              : today
                                ? 'text-violet-200 ring-1 ring-violet-400/50 hover:bg-white/10'
                                : 'text-white/75 hover:bg-white/10'
                        }`}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 시간 */}
              <div className="border-t border-white/10 pt-3 space-y-2.5">
                <div className="flex items-center gap-1.5 text-[11px] text-white/50">
                  <Clock className="w-3.5 h-3.5 text-violet-300/70" /> 시각
                </div>
                {/* 오전/오후 */}
                <div className="grid grid-cols-2 gap-1.5">
                  {([['오전', false], ['오후', true]] as const).map(([lb, pm]) => (
                    <button
                      key={lb}
                      type="button"
                      onClick={() => setDraftPm(pm)}
                      className={`py-2 rounded-lg text-xs font-semibold transition-colors ${draftPm === pm ? 'bg-violet-500/40 text-white ring-1 ring-violet-400/50' : 'bg-white/5 text-white/55 hover:bg-white/10'}`}
                    >
                      {lb}
                    </button>
                  ))}
                </div>
                {/* 시 */}
                <div>
                  <div className="text-[10px] text-white/40 mb-1">시</div>
                  <div className="grid grid-cols-6 gap-1">
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => setDraftHour(h)}
                        className={`py-1.5 rounded-md text-xs font-semibold tabular-nums transition-colors ${draftHour === h ? 'bg-violet-500/40 text-white ring-1 ring-violet-400/50' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                </div>
                {/* 분 (5분 단위) */}
                <div>
                  <div className="text-[10px] text-white/40 mb-1">분 (5분 단위)</div>
                  <div className="grid grid-cols-6 gap-1">
                    {MINUTE_STEPS.map((mnt) => (
                      <button
                        key={mnt}
                        type="button"
                        onClick={() => setDraftMin(mnt)}
                        className={`py-1.5 rounded-md text-xs font-semibold tabular-nums transition-colors ${draftMin === mnt ? 'bg-violet-500/40 text-white ring-1 ring-violet-400/50' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
                      >
                        {pad2(mnt)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 선택 미리보기 */}
              <div className="rounded-lg bg-violet-500/10 border border-violet-400/20 px-3 py-2 text-center">
                <span className="text-xs text-violet-100 font-medium tabular-nums">{draftPreview || '날짜를 선택해주세요'}</span>
              </div>
            </div>

            {/* 푸터 */}
            <div className="flex gap-2 px-4 py-3 border-t border-white/10">
              <button type="button" onClick={() => setOpen(false)} className="flex-1 py-2.5 rounded-lg border border-white/15 text-white/70 text-sm font-medium hover:bg-white/5 transition-colors">
                취소
              </button>
              <button
                type="button"
                onClick={commit}
                disabled={!draftDate}
                className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-sm font-semibold hover:from-violet-500 hover:to-fuchsia-500 shadow-md shadow-violet-500/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition-all"
              >
                <Check className="w-4 h-4" /> 확인
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
