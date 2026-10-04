/**
 * MarketingPlannerPage.tsx — 마케팅 플래너 캘린더 (★ 2026-08-12 Phase 1 · ★ 2026-10-04 보강 · 설계서 §5-1 · 목업 v2 (가))
 *
 * 머리 숫자 = [할 일][이달 행사][보유 크레딧] · 행동 자리는 할 일 카드 한 곳(재료 넣기 · 확인하고 승인) ·
 * 왼쪽 달력 = 행사 기간 막대(주를 가로질러 하나) + 그날 나가는 발송(그 행사 상태 색 · 채널 아이콘) + 승인 마감 표시 ·
 * 오른쪽 = 행사 목록(다음 발송일 순 · 버튼 없이 줄 전체가 행사 상세) · 오른쪽 행사에 마우스를 올리면 달력에 그 행사만 남는다.
 * 375 = 할 일 → 행사 목록 → 접은 이번 주 달력.
 *
 * ⛔ 화면 상태 · 할 일 · 고칠 수 있는가는 서버가 판정한다(utils/planner-calendar.ts) — 사전에 없는 값은 그리지 않는다.
 * ⛔ 불러오기 실패는 빈 달력으로 속이지 않는다(차단 상자 + [다시 읽기] · F6). 날짜는 KST 'YYYY-MM-DD' 문자열 축.
 * ⛔ 공휴일 표는 서버 CT(utils/kr-holidays.ts) 하나가 진실이다. native dialog 0 · 모델명 0 · 줄표 0.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlarmClock, CalendarRange, ChartColumn, Check, ChevronDown, ChevronLeft, ChevronRight, ListChecks, Plus, Send } from 'lucide-react';
import ZoneFrame from '../components/zone/ZoneFrame';
import { useToast } from '../components/ToastProvider';
import { useMediaQuery } from '../hooks/useMediaQuery';
import PlannerEventModal from '../components/planner/PlannerEventModal';
import {
  PLANNER_LEGEND, PLANNER_SEND_KIND, PLANNER_STATE, kstToday, plannerDay, plannerDaysBetween, plannerRange, plannerStateOf,
  type PlannerSendKind,
} from '../constants/planner-status';
import { plannerApi, won, type Availability, type CalendarEvent, type Holiday, type PlannerCalendar } from '../components/planner/planner-api';

const todayMonth = () => kstToday().slice(0, 7);
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const shiftMonth = (m: string, delta: number) => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm - 1 + delta, 1)).toISOString().slice(0, 7); };
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** (순수) 행사 1건의 발송 = 날짜별 한 덩어리(같은 날 문자+DM = 1통) + 메일 */
interface SendChip { date: string; kind: PlannerSendKind; done: boolean; count: number | null }
function sendChipsOf(ev: CalendarEvent): SendChip[] {
  const out: SendChip[] = [];
  const live = ev.touchpoints.filter((t) => t.status !== 'skipped');
  const days = Array.from(new Set(live.map((t) => t.scheduledOn))).sort();
  for (const d of days) {
    const mine = live.filter((t) => t.scheduledOn === d);
    const sms = mine.find((t) => t.channel === 'sms');
    const dm = mine.find((t) => t.channel === 'dm');
    const email = mine.find((t) => t.channel === 'email');
    if (email) out.push({ date: d, kind: 'email', done: email.status === 'sent', count: email.sentCount });
    if (sms || dm) {
      const carrier = sms || dm!;
      out.push({ date: d, kind: sms && dm ? 'smsdm' : sms ? 'sms' : 'dm', done: carrier.status === 'sent', count: carrier.sentCount });
    }
  }
  return out;
}
const nextSendOf = (ev: CalendarEvent, today: string) => sendChipsOf(ev).find((c) => !c.done && c.date >= today)?.date || ev.firstSend || ev.startsOn;

export default function MarketingPlannerPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const phone = useMediaQuery('(max-width: 767px)');
  const [searchParams, setSearchParams] = useSearchParams();
  const today = kstToday();
  const [month, setMonth] = useState(() => (/^\d{4}-\d{2}$/.test(searchParams.get('month') || '') ? String(searchParams.get('month')) : todayMonth()));
  const [cal, setCal] = useState<PlannerCalendar | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'fail' | 'pending'>('loading');
  const [loadedAt, setLoadedAt] = useState<string>('');
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [modal, setModal] = useState<{ editing: CalendarEvent | null; date?: string | null } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [weekOpen, setWeekOpen] = useState(false);

  const loadAvailability = useCallback(async () => {
    const r = await plannerApi<{ channels: Availability[] }>('/api/marketing-planner/availability');
    if (r.ok) setAvailability(Array.isArray(r.data.channels) ? r.data.channels : []);
    return r.ok;
  }, []);

  const load = useCallback(async (m: string, silent = false) => {
    if (!silent) setLoadState('loading');
    const r = await plannerApi<PlannerCalendar>(`/api/marketing-planner/events?month=${m}`);
    if (r.ok) {
      setCal(r.data);
      setLoadState('ok');
      const now = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
      setLoadedAt(`${Number(now.slice(5, 7))}/${Number(now.slice(8, 10))} ${now.slice(11, 16)} 기준`);
      return;
    }
    if (r.status === 503 && r.data?.code === 'DB_MIGRATION_PENDING') { setLoadState('pending'); return; }
    // ⛔ 실패를 "행사 없음"으로 그리지 않는다(F6) — 직전 값을 지우고 차단 상자를 띄운다
    setCal(null);
    setLoadState('fail');
  }, []);

  useEffect(() => { void load(month); }, [month, load]);
  useEffect(() => { void loadAvailability(); }, [loadAvailability]);
  // 채널 상태를 못 받은 채면 창을 열 때 다시 묻는다(1회 실패로 "불러오는 중"에 갇히지 않게 · F6)
  useEffect(() => { if (modal && availability.length === 0) void loadAvailability(); }, [modal, availability.length, loadAvailability]);
  // 탭 복귀 때 조용히 다시 읽는다(휴대폰에서 승인하고 돌아온 PC 등 · 폴링 없음)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void load(month, true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [month, load]);

  // 옛 결재 문자 링크 착지 · 다른 화면에서 온 [행사 고치기](?edit=) · 달(?month=)
  useEffect(() => {
    const link = searchParams.get('link');
    const edit = searchParams.get('edit');
    if (!link && !edit && !searchParams.get('month')) return;
    if (link) toast.info(link === 'expired' ? '예전 결재 링크예요. 이제 행사마다 확인하고 승인해요. 아래 할 일을 확인해 주세요.' : '링크를 여는 중 문제가 있었어요. 아래 할 일을 확인해 주세요.');
    if (edit && cal) {
      const ev = cal.events.find((e) => e.id === edit);
      if (ev?.editable) setModal({ editing: ev });
    }
    if (!edit || cal) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, toast, cal]);

  const events = useMemo(() => (cal?.events || []).filter((e) => DAY_KEY.test(e.startsOn) && DAY_KEY.test(e.endsOn) && e.endsOn >= e.startsOn), [cal]);
  const holidays = useMemo(() => new Map<string, Holiday>((cal?.holidays || []).map((h) => [h.date, h])), [cal]);
  const todo = useMemo(() => events.filter((e) => e.todo).sort((a, b) => String(a.deadline?.date || a.firstSend || a.startsOn).localeCompare(String(b.deadline?.date || b.firstSend || b.startsOn))), [events]);
  const sorted = useMemo(() => {
    const rank = (e: CalendarEvent) => (e.displayState === 'cancelled' ? 2 : e.displayState === 'done' ? 1 : 0);
    return [...events].sort((a, b) => rank(a) - rank(b) || nextSendOf(a, today).localeCompare(nextSendOf(b, today)));
  }, [events, today]);
  const upcoming = useMemo(() => {
    const tomorrow = addDays(today, 1);
    return events.flatMap((e) => sendChipsOf(e).filter((c) => !c.done && (c.date === today || c.date === tomorrow)).map((c) => ({ e, c })));
  }, [events, today]);
  const nextAny = useMemo(() => events.flatMap((e) => sendChipsOf(e).filter((c) => !c.done && c.date >= today).map((c) => ({ e, c })))
    .sort((a, b) => a.c.date.localeCompare(b.c.date))[0] || null, [events, today]);

  const openEvent = (ev: CalendarEvent) => navigate(`/marketing-planner/events/${ev.id}`);
  const openCreate = (date?: string) => setModal({ editing: null, date: date || null });

  // ── 달력 ────────────────────────────────────────────────────────
  const weeks = useMemo(() => {
    const first = `${month}-01`;
    const start = addDays(first, -new Date(`${first}T00:00:00Z`).getUTCDay());
    const last = addDays(shiftMonth(month, 1) + '-01', -1);
    const out: string[] = [];
    for (let w = start; w <= last; w = addDays(w, 7)) out.push(w);
    return out;
  }, [month]);

  const weekRow = (ws: string, isLast: boolean) => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    const we = days[6];
    const inWeek = events.filter((e) => e.endsOn >= ws && e.startsOn <= we).sort((a, b) => a.startsOn.localeCompare(b.startsOn) || plannerDaysBetween(b.startsOn, b.endsOn) - plannerDaysBetween(a.startsOn, a.endsOn));
    const lanes: number[] = [];
    const bars = inWeek.map((e) => {
      const s = e.startsOn < ws ? ws : e.startsOn;
      const en = e.endsOn > we ? we : e.endsOn;
      const c0 = plannerDaysBetween(ws, s);
      const c1 = plannerDaysBetween(ws, en);
      let lane = lanes.findIndex((end) => end < c0);
      if (lane < 0) { lane = lanes.length; lanes.push(c1); } else lanes[lane] = c1;
      const st = plannerStateOf(e.displayState);
      if (!st) return null;
      const cl = e.startsOn < ws;
      const cr = e.endsOn > we;
      const Icon = st.icon;
      return (
        <button key={e.id} type="button" onClick={() => openEvent(e)} title={`${e.title} · ${st.label}`}
          className={`self-start border px-1.5 py-[3px] text-[11.5px] font-semibold leading-[1.3] flex items-start gap-1 min-w-0 text-left transition-opacity ${cl ? 'rounded-l-none border-l-0' : 'ml-1 rounded-l-md'} ${cr ? 'rounded-r-none border-r-0' : 'mr-1 rounded-r-md'} ${st.bar} ${hovered && hovered !== e.id ? 'opacity-25' : ''}`}
          style={{ gridColumn: `${c0 + 1} / span ${c1 - c0 + 1}`, gridRow: lane + 1 }}>
          {!cl && c1 !== c0 && <Icon className="w-3 h-3 mt-[1px] shrink-0" />}
          <span className={`min-w-0 ${c1 === c0 ? 'line-clamp-3' : 'line-clamp-2'}`}>{e.title}</span>
        </button>
      );
    });
    return (
      <div key={ws} className={`relative flex-1 ${isLast ? '' : 'border-b border-slate-100'}`}>
        <div className="absolute inset-0 grid grid-cols-7" aria-hidden="true">
          {days.map((d, i) => <div key={d} className={`${i < 6 ? 'border-r border-slate-100' : ''} ${d.slice(0, 7) !== month ? 'bg-slate-50' : ''} ${d === today ? 'bg-indigo-50/60' : ''}`} />)}
        </div>
        <div className="relative grid grid-cols-7">
          {days.map((d, i) => {
            const out = d.slice(0, 7) !== month;
            const hol = holidays.get(d);
            const red = i === 0 || !!hol;
            const due = events.find((e) => e.deadline?.date === d);
            return (
              <button key={d} type="button" onClick={() => (out ? setMonth(d.slice(0, 7)) : openCreate(d))} aria-label={`${plannerDay(d)}${out ? ' 그 달로' : ' 행사 담기'}`}
                className="px-1.5 pt-1.5 flex items-center gap-1 min-w-0 text-[12px] font-semibold tabular-nums text-left hover:bg-white/60">
                {d === today
                  ? <span className="inline-grid place-items-center min-w-[22px] h-[22px] px-1 rounded-full bg-indigo-600 text-white">{Number(d.slice(8))}</span>
                  : <span className={out ? 'text-slate-400' : red ? 'text-rose-700' : i === 6 ? 'text-sky-700' : 'text-slate-700'}>{Number(d.slice(8))}</span>}
                {hol && !out && <span className="text-[11px] font-medium text-rose-700 truncate">{hol.name}</span>}
                {due && !out && <span className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-800 whitespace-nowrap"><AlarmClock className="w-[11px] h-[11px]" />마감 {due.deadline!.hour}시</span>}
              </button>
            );
          })}
        </div>
        <div className="relative grid grid-cols-7 gap-y-1 mt-1.5 min-h-[22px]" style={{ gridAutoRows: 'minmax(22px,auto)' }}>{bars}</div>
        <div className="relative grid grid-cols-7 mt-1.5 pb-2 min-h-[30px]">
          {days.map((d) => (
            <div key={d} className="px-1 flex flex-col items-start gap-1 min-w-0">
              {events.flatMap((e) => sendChipsOf(e).filter((c) => c.date === d).map((c) => {
                const st = plannerStateOf(e.displayState);
                if (!st) return null;
                const K = PLANNER_SEND_KIND[c.kind];
                const Icon = c.done ? Check : K.icon;
                return (
                  <span key={`${e.id}-${c.kind}`} className={`inline-flex items-center gap-1 h-5 px-1.5 rounded border text-[11px] font-semibold whitespace-nowrap max-w-full transition-opacity ${st.chip} ${hovered && hovered !== e.id ? 'opacity-25' : ''}`}>
                    <Icon className="w-[11px] h-[11px] shrink-0" />{K.label}
                  </span>
                );
              }))}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const calendarCard = (
    <div className="w-full rounded-2xl border border-slate-200 bg-white overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 px-4 h-12 border-b border-slate-200">
        <h2 className="text-[14px] font-semibold">{Number(month.slice(5))}월 달력</h2>
        <span className="text-[12px] text-slate-500 hidden sm:inline">막대 = 행사 기간 · 아래 줄 = 그날 나가는 발송</span>
      </div>
      <div className="grid grid-cols-7 text-center text-[12px] font-semibold border-b border-slate-200">
        {DOW.map((d, i) => <div key={d} className={`py-2 ${i === 0 ? 'text-rose-700' : i === 6 ? 'text-sky-700' : 'text-slate-500'}`}>{d}</div>)}
      </div>
      {loadState === 'ok'
        ? <div className="flex-1 flex flex-col">{weeks.map((w, i) => weekRow(w, i === weeks.length - 1))}</div>
        : <div className="flex-1 min-h-[480px] bg-slate-50/80" aria-hidden="true" />}
      {loadState === 'ok' && (
        <div className="mt-auto px-4 py-2.5 border-t border-slate-200 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-slate-600">
          {PLANNER_LEGEND.map((k) => { const st = PLANNER_STATE[k]; const Icon = st.icon; return (
            <span key={k} className="inline-flex items-center gap-1.5"><span className={`inline-flex items-center justify-center w-5 h-4 rounded border ${st.bar}`}><Icon className="w-2.5 h-2.5" /></span>{st.label}</span>
          ); })}
          <span className="inline-flex items-center gap-1 font-bold text-amber-800"><AlarmClock className="w-3 h-3" />승인 마감</span>
          {cal && !cal.holidaysReady && <span className="text-amber-800">{month.slice(0, 4)}년 공휴일은 확정되면 표시해요</span>}
        </div>
      )}
    </div>
  );

  // ── 할 일 · 행사 목록 ────────────────────────────────────────────
  const todoRow = (e: CalendarEvent) => {
    const st = plannerStateOf(e.displayState);
    if (!st) return null;
    const Icon = st.icon;
    const chips = sendChipsOf(e).filter((c) => !c.done);
    const desc = e.displayState === 'material'
      ? (e.notice || `${e.staleChannels.map((c) => (c === 'dm' ? '모바일 DM' : '메일')).join('·')} 재료를 넣으면 완성본을 만들어요${e.firstSend ? ` · 첫 발송 ${plannerDay(e.firstSend)}` : ''}`)
      : e.displayState === 'review'
        ? `실물이 준비됐어요${chips[0] ? ` · ${plannerDay(chips[0].date)} ${PLANNER_SEND_KIND[chips[0].kind].label}부터 ${chips.length}번` : ''}`
        : (e.notice || '발송이 멈춰 있어요. 사유를 확인해 주세요.');
    const left = e.deadline ? plannerDaysBetween(today, e.deadline.date) : null;
    const due = e.deadline
      ? `승인 마감 ${plannerDay(e.deadline.date)} ${e.deadline.hour}시${left !== null ? ` · ${left > 0 ? `${left}일 남음` : left === 0 ? '오늘' : '지남'}` : ''}`
      : e.firstSend ? `첫 발송 ${plannerDay(e.firstSend)} 오전 8시 · 그 전에 승인해야 나가요` : '';
    const btn = e.displayState === 'material'
      ? <button type="button" onClick={() => setModal({ editing: e })} className={`${phone ? 'w-full h-11' : 'w-full h-10'} px-3.5 rounded-[10px] border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-[13px] font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5`}>재료 넣기</button>
      : e.displayState === 'review'
        ? <button type="button" onClick={() => openEvent(e)} className={`${phone ? 'w-full h-11' : 'w-full h-10'} px-4 rounded-[10px] bg-indigo-600 hover:bg-indigo-700 text-white text-[13.5px] font-bold inline-flex items-center justify-center gap-1.5`}>확인하고 승인</button>
        : <button type="button" onClick={() => openEvent(e)} className={`${phone ? 'w-full h-11' : 'w-full h-10'} px-3.5 rounded-[10px] border border-slate-200 bg-white hover:bg-slate-50 text-[13px] font-semibold text-slate-700`}>사유 보기</button>;
    const badge = <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-md border text-[12px] font-semibold whitespace-nowrap ${st.badge}`}><Icon className="w-[13px] h-[13px]" />{st.label}</span>;
    if (phone) {
      return (
        <li key={e.id} className="py-3.5 space-y-2">
          <div className="flex items-center gap-2">{badge}<b className="text-[14px] truncate">{e.title}</b></div>
          <p className="text-[12.5px] text-slate-600 leading-snug">{desc}</p>
          {due && <p className="text-[12.5px] font-semibold text-amber-800 inline-flex items-center gap-1 tabular-nums"><AlarmClock className="w-3.5 h-3.5" />{due}</p>}
          {btn}
        </li>
      );
    }
    return (
      <li key={e.id} className="grid grid-cols-[minmax(0,1fr)_250px_150px] items-center gap-5 py-3.5">
        <div className="min-w-0"><div className="flex items-center gap-2">{badge}<b className="text-[14px] truncate">{e.title}</b></div><p className="text-[12.5px] text-slate-600 mt-1">{desc}</p></div>
        <p className="text-[12.5px] font-bold text-amber-800 inline-flex items-center gap-1 tabular-nums">{due && <AlarmClock className="w-3.5 h-3.5 shrink-0" />}{due}</p>
        {btn}
      </li>
    );
  };

  const eventRow = (e: CalendarEvent) => {
    const st = plannerStateOf(e.displayState);
    if (!st) return null;
    const Icon = st.icon;
    const sub = e.displayState === 'making' ? (e.building ? '완성본을 만드는 중이에요' : e.notice || '문자 문안을 준비하고 있어요 · 준비되면 확인 요청이 가요')
      : e.displayState === 'approved' ? '정해진 날 오전 8시에 그대로 나가요'
        : e.displayState === 'cancelled' ? (e.closedReason === 'not_approved' ? '승인되지 않아 보내지 않았어요' : e.closedReason === 'missed' ? '예정일이 지나 보내지 않았어요' : '취소한 행사예요')
          : '';
    const subTone = e.displayState === 'making' ? 'text-violet-800' : e.displayState === 'approved' ? 'text-emerald-800' : 'text-slate-500';
    return (
      <li key={e.id}>
        <button type="button" onClick={() => openEvent(e)} onMouseEnter={() => setHovered(e.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(e.id)} onBlur={() => setHovered(null)}
          className="w-full text-left flex items-start gap-3 px-4 py-3.5 hover:bg-slate-50">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`inline-flex items-center gap-1 h-6 px-1.5 rounded-md border text-[11.5px] font-semibold whitespace-nowrap ${st.badge}`}><Icon className="w-[13px] h-[13px]" />{st.label}</span>
              <span className={`text-[14px] font-semibold truncate ${e.displayState === 'done' || e.displayState === 'cancelled' ? 'text-slate-600' : ''}`}>{e.title}</span>
            </div>
            <p className="text-[12px] text-slate-500 mt-1 tabular-nums truncate">{plannerRange(e.startsOn, e.endsOn)}{e.benefitText ? ` · ${e.benefitText}` : ''}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {sendChipsOf(e).map((c) => {
                const K = PLANNER_SEND_KIND[c.kind];
                const CIcon = c.done ? Check : K.icon;
                return <span key={`${c.date}-${c.kind}`} className={`inline-flex items-center gap-1 h-6 px-2 rounded-md border text-[12px] tabular-nums whitespace-nowrap ${st.chip}`}><CIcon className="w-3 h-3" />{plannerDay(c.date).replace(/\(.\)$/, '')} {K.label}{c.done && c.count !== null ? ` · ${won(c.count)} 보냄` : ''}</span>;
              })}
            </div>
            {sub && <p className={`text-[12px] font-semibold mt-2 ${subTone}`}>{sub}</p>}
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400 mt-1 shrink-0" />
        </button>
      </li>
    );
  };

  const empty = loadState === 'ok' && events.length === 0;
  const emptyGuide = (
    <div className="px-5 md:px-6 py-7">
      <p className="text-[16px] font-bold">이달 첫 행사를 담아 보세요</p>
      <p className="text-[13px] text-slate-600 mt-1">행사 하나에 문자·모바일 DM·메일을 정해진 날 보내 드려요</p>
      <ol className="mt-5 space-y-4 text-[13px]">
        {[['행사명·기간·혜택을 적어요', '혜택은 적은 글자 그대로 실려요'], ['사진·글·몰 상품을 넣어요', '모바일 DM과 메일 완성본을 만들어 드려요'], ['발송 3일 전, 실물을 보고 승인해요', '휴대폰으로 확인 요청이 가요 · 승인 전에는 아무것도 나가지 않아요']].map(([t, d], i) => (
          <li key={t} className="flex gap-3"><span className="w-6 h-6 rounded-full bg-slate-900 text-white text-[12px] font-bold grid place-items-center shrink-0">{i + 1}</span><div><b>{t}</b><p className="text-slate-600 mt-0.5">{d}</p></div></li>
        ))}
      </ol>
      <button type="button" onClick={() => openCreate()} className="mt-6 w-full md:w-auto h-12 md:h-10 px-4 rounded-[10px] bg-indigo-600 hover:bg-indigo-700 text-white text-[13.5px] font-bold inline-flex items-center justify-center gap-1.5"><Plus className="w-4 h-4" />첫 행사 담기</button>
    </div>
  );

  const upcomingStrip = (
    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-start gap-2.5 text-[12.5px]">
      <Send className="w-[15px] h-[15px] text-slate-500 mt-0.5 shrink-0" />
      {upcoming.length > 0 ? (
        <div className="min-w-0"><p className="font-semibold">오늘·내일 나가는 발송 {upcoming.length}</p>
          <p className="text-slate-600 mt-0.5 tabular-nums">{upcoming.map(({ e, c }) => `${plannerDay(c.date)} ${e.title} ${PLANNER_SEND_KIND[c.kind].label}`).join(' · ')}</p></div>
      ) : (
        <div className="min-w-0"><p className="font-semibold">오늘·내일 나가는 발송 없음</p>
          {nextAny && <p className="text-slate-600 mt-0.5 tabular-nums">다음 발송 {plannerDay(nextAny.c.date)} 오전 8시 · {nextAny.e.title} {PLANNER_SEND_KIND[nextAny.c.kind].label}{nextAny.e.displayState !== 'approved' && nextAny.e.displayState !== 'done' ? <> · <b className="text-amber-800">승인해야 나가요</b></> : null}</p>}
        </div>
      )}
    </div>
  );

  const listCard = (
    <div className="rounded-2xl border border-slate-200 bg-white flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 h-12 border-b border-slate-200">
        <h2 className="text-[14px] font-semibold">행사 {loadState === 'ok' ? events.length : ''}</h2>
        {!empty && loadState === 'ok' && <span className="text-[12px] text-slate-500">다음 발송일 순 · 누르면 행사 상세</span>}
      </div>
      {loadState !== 'ok' ? <div className="flex-1 min-h-[200px] bg-slate-50/80" aria-hidden="true" />
        : empty ? emptyGuide : (
          <>
            {upcomingStrip}
            <ul className="divide-y divide-slate-100">{sorted.map(eventRow)}</ul>
          </>
        )}
      {loadState === 'ok' && (
        <div className="mt-auto px-4 py-3 border-t border-slate-100">
          <p className="text-[10px] text-slate-500 italic">Data source: 행사·채널은 플래너 계획, 상태·마감은 서버 판정, 받는 사람 수는 수신거부를 뺀 고객 데이터 실조회, 발송 결과는 실제 발송 기록입니다. 공휴일은 관보 확정분입니다.</p>
        </div>
      )}
    </div>
  );

  const todoCard = todo.length > 0 && loadState === 'ok' ? (
    <section className={`bg-white rounded-2xl border border-slate-200 border-l-[3px] border-l-amber-400 shadow-sm ${phone ? 'px-4 pt-3.5' : 'p-5'}`}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 grid place-items-center"><ListChecks className="w-[14px] h-[14px]" /></span>
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">할 일 {todo.length}건</h2>
        {!phone && <span className="text-[12.5px] text-slate-500">마감이 가까운 순 · 승인 전에는 아무것도 나가지 않아요</span>}
      </div>
      <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">{todo.map(todoRow)}</ul>
    </section>
  ) : null;

  const weekStart = addDays(today, 0);
  const weekStrip = (
    <section className="bg-white rounded-2xl border border-slate-200 px-2 pt-2.5 pb-2">
      <div className="flex items-center justify-between px-2"><p className="text-[13px] font-semibold">이번 주</p><span className="text-[12px] text-slate-500 tabular-nums">{plannerDay(weekStart).replace(/\(.\)$/, '')} ~ {plannerDay(addDays(weekStart, 6)).replace(/\(.\)$/, '')}</span></div>
      <div className="grid grid-cols-7 gap-0.5 mt-1.5">
        {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => {
          const has = events.flatMap((e) => sendChipsOf(e).filter((c) => c.date === d).map(() => e));
          const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
          const isToday = d === today;
          const red = dow === 0 || holidays.has(d);
          return (
            <div key={d} className={`h-14 rounded-xl flex flex-col items-center justify-center gap-0.5 ${isToday ? 'bg-indigo-600 text-white' : ''}`} aria-label={`${plannerDay(d)}${has.length ? ` 발송 ${has.length}` : ''}`}>
              <span className={`text-[11px] ${isToday ? 'text-white/80' : red ? 'text-rose-700' : dow === 6 ? 'text-sky-700' : 'text-slate-500'}`}>{DOW[dow]}</span>
              <span className={`text-[15px] font-semibold tabular-nums ${!isToday && red ? 'text-rose-700' : ''}`}>{Number(d.slice(8))}</span>
              <span className="flex gap-0.5 h-1.5">{has.slice(0, 3).map((e, i) => <span key={i} className={`w-1.5 h-1.5 rounded-full ${e.displayState === 'review' || e.displayState === 'material' || e.displayState === 'hold' ? 'bg-amber-500' : e.displayState === 'making' ? 'bg-violet-500' : 'bg-emerald-500'}`} />)}</span>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={() => setWeekOpen((v) => !v)} className="mt-1 w-full h-11 rounded-xl text-[13px] font-semibold text-indigo-700 inline-flex items-center justify-center gap-1 hover:bg-indigo-50">
        {Number(month.slice(5))}월 달력 {weekOpen ? '접기' : '펼치기'}<ChevronDown className={`w-4 h-4 transition-transform ${weekOpen ? 'rotate-180' : ''}`} />
      </button>
    </section>
  );

  const kpiFail = loadState === 'fail';
  return (
    <ZoneFrame
      moduleId="planner"
      kpis={[
        { label: '할 일', value: kpiFail || !cal ? '확인 불가' : `${cal.kpi.todo}건`, tone: cal && cal.kpi.todo > 0 ? 'amber' : undefined },
        { label: `${Number(month.slice(5))}월 행사`, value: kpiFail || !cal ? '확인 불가' : `${cal.kpi.events}건` },
        { label: '보유 크레딧', value: cal?.kpi.balance !== null && cal?.kpi.balance !== undefined ? won(cal.kpi.balance) : '확인 불가' },
      ]}
      links={[
        { label: '이달 결과', icon: ChartColumn, onClick: () => navigate(`/marketing-planner/brief/${month}`) },
        { label: '1년 설계 보기', icon: CalendarRange, onClick: () => navigate('/marketing-calendar') },
      ]}
      stamp={{ text: loadedAt || '다시 읽기', onRefresh: () => { void load(month); void loadAvailability(); }, loading: loadState === 'loading' }}
      command={{
        lead: (
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-[3px]">
            <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} className={`${phone ? 'w-11 h-11' : 'w-8 h-8'} rounded-lg hover:bg-slate-100 grid place-items-center`} aria-label="이전 달"><ChevronLeft className="w-4 h-4" /></button>
            <span className="px-2 text-[14px] font-semibold tabular-nums">{phone ? `${Number(month.slice(5))}월` : `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`}</span>
            <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))} className={`${phone ? 'w-11 h-11' : 'w-8 h-8'} rounded-lg hover:bg-slate-100 grid place-items-center`} aria-label="다음 달"><ChevronRight className="w-4 h-4" /></button>
            {month !== todayMonth() && <button type="button" onClick={() => setMonth(todayMonth())} className="h-8 px-2.5 rounded-lg text-[12.5px] font-semibold text-slate-600 hover:bg-slate-100">이번 달</button>}
          </div>
        ),
        note: phone ? undefined : '행사를 담고 모바일 DM·메일 재료를 넣으면 완성본을 만들어요. 발송 3일 전 휴대폰으로 실물 확인 요청이 가요',
        primary: { label: '행사 담기', icon: Plus, onClick: () => openCreate(), tone: 'indigo' },
      }}
      blocks={[
        ...(loadState === 'fail' ? [{ text: '행사를 불러오지 못했어요. 달력이 비어 보여도 행사가 없는 것이 아니에요.', actionLabel: '다시 읽기', onAction: () => { void load(month); }, tone: 'rose' as const }] : []),
        ...(loadState === 'pending' ? [{ text: '플래너 준비 작업이 진행 중이에요. 몇 분 뒤 다시 읽어 주세요.', actionLabel: '다시 읽기', onAction: () => { void load(month); } }] : []),
        ...(cal && cal.migratedTodo > 0 ? [{ text: `결재가 행사별 확인으로 바뀌었어요. 확인할 행사 ${cal.migratedTodo}건이 아래 할 일에 있어요.` }] : []),
      ]}
      emphasis={!phone ? todoCard : null}
    >
      {phone ? (
        <div className="space-y-3">
          {todoCard}
          {listCard}
          {loadState === 'ok' && !empty && weekStrip}
          {weekOpen && calendarCard}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          <div className="lg:col-span-7 flex">{calendarCard}</div>
          <div className="lg:col-span-5 flex flex-col">{listCard}</div>
        </div>
      )}
      {modal && (
        <PlannerEventModal
          month={month}
          initialDate={modal.date}
          editing={modal.editing}
          availability={availability}
          balance={cal?.kpi.balance ?? null}
          onClose={() => setModal(null)}
          onSaved={() => { void load(month, true); }}
        />
      )}
    </ZoneFrame>
  );
}

