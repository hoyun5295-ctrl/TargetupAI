/**
 * MarketingPlannerPage.tsx — 마케팅 플래너 (★ 2026-08-12 Phase 1 · 설계서 = docs/2026-08-12-ax-marketing-planner-design.md)
 *
 * 세 번째 시계 — 여정(사건)·자동마케팅(상태)에 이은 **달력** 축. 담당자가 월간 캘린더에 행사를 기입하고
 * 채널 5종을 체크하면, 이후 단계(Phase 2 결재 → Phase 3 대행 제작·실행)가 그 계획을 무인으로 완주한다.
 *
 * ★ 2026-08-13(2) 화면 재구성 — 달력이 화면을 다 먹던 구조를 **좌우 분할**로 바꿨다.
 *   왼쪽 = 달력(공휴일·오늘·행사 바), 오른쪽 = **실행 예정** 패널(터치포인트를 예정일 순으로).
 *   승인 뒤 실제로 채워지는 쪽은 오른쪽이고, 항목을 누르면 상세가 열린다 —
 *   아직 도래하지 않은 건은 계획(대상·시점·크레딧)을, 도래한 건은 **실제로 나간 문안과 소재 미리보기**를 보여준다.
 *
 * 영구 룰: 다크 slate-950 + violet 액센트 · native dialog 0(ConfirmModal·useToast) · 모델명 노출 0 ·
 *          혜택은 고객사 기입 칸(AI가 채우지 않는다) · Source caption 의무 · goBackOr 복귀.
 * ⛔ 공휴일 표는 서버 CT(`utils/kr-holidays.ts`) 하나가 진실이다 — 화면에 같은 표를 복사하지 않는다.
 * ⛔ 날짜는 전부 KST 'YYYY-MM-DD' 문자열 축이다. Date의 로컬 해석으로 오늘을 구하면 해외 접속에서 하루가 밀린다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, ExternalLink,
  Loader2, Lock, MailOpen, PauseCircle, Plus, Smartphone, Sparkles, Trash2, Wand2, X,
} from 'lucide-react';
import { goBackOr } from '../lib/scroll-restoration';
import { useToast } from '../components/ToastProvider';
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';

// ── 타입 (백엔드 CT와 미러 — 서버가 진실) ─────────────────────────────
type Channel = 'sms' | 'alimtalk' | 'email' | 'dm' | 'inapp';
type Anchor = 'start' | 'end' | 'before_start';

interface Availability { channel: Channel; label: string; available: boolean; reason: string | null; estCredits: number | null }
interface Touchpoint { id?: string; channel: Channel; label?: string; timing: { anchor: Anchor; offsetDays?: number; audience?: 'all' | 'participants' }; estCredits?: number | null; scheduledOn?: string; status?: string; lockReason?: string | null }
interface PlannerEvent {
  id: string; title: string; startsOn: string; endsOn: string; benefitText: string | null;
  products: Array<{ name: string }>; status: string; touchpoints: Touchpoint[]; estCreditsTotal: number;
}
/** ★ Phase 2 — 그 달 결재 상태(승인 원장 표가 아직 없으면 서버가 null을 준다) */
interface MonthApproval { status: 'pending' | 'approving' | 'approved' | 'cancelled'; approvedAt: string | null; agencyCredits: number }
/** ★ 2026-08-13(2) 공휴일 — 서버 표가 준비된 해만 온다. */
interface Holiday { date: string; name: string; substitute?: boolean }
/** ★ 2026-08-13(2) 도래한 터치포인트의 실제 결과 — 서버 실측(목업 없음). */
interface TouchpointDetail {
  status: string; scheduledOn: string; channel: Channel; label: string;
  audience: 'all' | 'participants'; audienceCount: number | null; audienceNote: string | null;
  sentAt: string | null; sentCount: number | null;
  message: { subject: string | null; body: string } | null;
  asset: { kind: 'dm' | 'email' | 'inapp' | 'alimtalk'; url?: string | null; html?: string | null; title?: string | null; body?: string | null; imageUrl?: string | null; inspection?: string | null } | null;
}

const ANCHOR_LABEL: Record<Anchor, string> = { start: '행사 시작일', end: '행사 종료일', before_start: '시작 전 사전 안내' };
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  draft: { label: '작성 중', cls: 'bg-white/10 text-white/60' },
  briefed: { label: '브리핑 대기', cls: 'bg-amber-500/20 text-amber-200' },
  approved: { label: '승인됨', cls: 'bg-emerald-500/20 text-emerald-200' },
};
/** 터치포인트 실행 상태 — 예정 패널·상세가 같은 라벨을 쓴다(두 벌 금지). */
const TP_STATUS: Record<string, { label: string; cls: string }> = {
  planned: { label: '실행 예정', cls: 'bg-white/10 text-white/60 border-white/15' },
  ready: { label: '준비 완료', cls: 'bg-sky-500/15 text-sky-200 border-sky-400/25' },
  producing: { label: '제작 중', cls: 'bg-violet-500/15 text-violet-200 border-violet-400/25' },
  scheduled: { label: '발송 예약', cls: 'bg-sky-500/15 text-sky-200 border-sky-400/25' },
  sent: { label: '발송 완료', cls: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/25' },
  skipped: { label: '생략', cls: 'bg-white/10 text-white/45 border-white/15' },
  hold_credit: { label: '보류 — 크레딧', cls: 'bg-amber-500/15 text-amber-200 border-amber-400/25' },
  locked: { label: '보류', cls: 'bg-amber-500/15 text-amber-200 border-amber-400/25' },
};
const CHANNEL_ICON: Record<Channel, typeof MailOpen> = {
  sms: Smartphone, alimtalk: Smartphone, email: MailOpen, dm: Smartphone, inapp: Smartphone,
};

/** KST 오늘 — 브라우저 타임존과 무관하게 한국 날짜를 쓴다(해외 접속 하루 밀림 차단). */
const kstToday = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const todayMonth = () => kstToday().slice(0, 7);

/** 'YYYY-MM' → 6주 42칸. 앞뒤 달 날짜도 채워 격자 높이가 달마다 흔들리지 않게 한다. */
function buildMonthCells(month: string): Array<{ date: string; inMonth: boolean }> {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const cells: Array<{ date: string; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    cells.push({ date, inMonth: date.startsWith(month) });
  }
  return cells;
}

const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
};

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** 두 날짜의 일수 차(KST 문자열 축). 예정 패널의 D-day 배지. */
function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

function ddayLabel(scheduledOn: string, today: string): string {
  const diff = daysBetween(today, scheduledOn);
  if (diff === 0) return '오늘';
  if (diff > 0) return `D-${diff}`;
  return `${-diff}일 전`;
}

export default function MarketingPlannerPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const token = () => localStorage.getItem('token');
  const auth = () => ({ Authorization: `Bearer ${token()}` });

  const [month, setMonth] = useState(todayMonth());
  const [events, setEvents] = useState<PlannerEvent[]>([]);
  const [approval, setApproval] = useState<MonthApproval | null>(null);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidaysReady, setHolidaysReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [migrationPending, setMigrationPending] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const today = kstToday();

  // 기입 모달
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PlannerEvent | null>(null);
  const [saving, setSaving] = useState(false);
  const [fTitle, setFTitle] = useState('');
  const [fStart, setFStart] = useState('');
  const [fEnd, setFEnd] = useState('');
  const [fBenefit, setFBenefit] = useState('');
  const [fProducts, setFProducts] = useState('');
  const [fTouchpoints, setFTouchpoints] = useState<Touchpoint[]>([]);

  // ★ 2026-08-13(2) 상세 모달 — 예정 건은 화면이 이미 가진 계획으로 즉시 그리고,
  //   도래한 건만 서버에 실제 결과(문안·소재)를 물어본다(불필요한 호출 0).
  const [detailOf, setDetailOf] = useState<{ ev: PlannerEvent; tp: Touchpoint } | null>(null);
  const [detail, setDetail] = useState<TouchpointDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [preview, setPreview] = useState<{ title: string; html: string } | null>(null);

  const loadAvailability = useCallback(async () => {
    try {
      const r = await fetch('/api/marketing-planner/availability', { headers: auth() });
      if (r.ok) {
        const d = await r.json();
        setAvailability(Array.isArray(d.channels) ? d.channels : []);
      }
    } catch { /* 가용성 로드 실패 — 기입 모달에서 재시도 */ }
  }, []);

  const loadEvents = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/marketing-planner/events?month=${m}`, { headers: auth() });
      if (r.status === 503) { setMigrationPending(true); setEvents([]); return; }
      if (r.ok) {
        const d = await r.json();
        setMigrationPending(false);
        setEvents(Array.isArray(d.events) ? d.events : []);
        setApproval(d.approval || null);
        setHolidays(Array.isArray(d.holidays) ? d.holidays : []);
        setHolidaysReady(d.holidaysReady !== false);
      }
    } catch { /* 일시 오류 — 직전 목록 유지 */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAvailability(); }, [loadAvailability]);
  useEffect(() => { loadEvents(month); }, [month, loadEvents]);

  // 결재 링크 착지 — 만료·오류를 조용히 넘기지 않는다(문자 링크의 도착점이 여기 하나다).
  useEffect(() => {
    const link = searchParams.get('link');
    if (!link) return;
    toast.error(link === 'expired'
      ? '결재 링크가 만료됐습니다 — 아래 브리핑에서 확인해 주세요'
      : '결재 링크를 여는 중 문제가 있었습니다 — 아래 브리핑에서 확인해 주세요');
    searchParams.delete('link');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, toast]);

  const cells = useMemo(() => buildMonthCells(month), [month]);
  const holidayByDate = useMemo(() => {
    const map = new Map<string, Holiday>();
    for (const h of holidays) if (!map.has(h.date)) map.set(h.date, h);
    return map;
  }, [holidays]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, PlannerEvent[]>();
    for (const ev of events) {
      // 행사 기간의 각 날짜에 바를 그린다 — 셀 순회보다 행사 순회가 싸다(행사 수 << 날짜 수)
      for (let d = ev.startsOn; d <= ev.endsOn; d = nextDay(d)) {
        const arr = map.get(d) || [];
        arr.push(ev);
        map.set(d, arr);
      }
    }
    return map;
  }, [events]);

  /** 실행 예정 목록 — 그 달 모든 터치포인트를 예정일 순으로 편다(행사가 아니라 **실행 단위**가 축이다). */
  const schedule = useMemo(() => {
    const rows: Array<{ ev: PlannerEvent; tp: Touchpoint }> = [];
    for (const ev of events) for (const tp of ev.touchpoints) rows.push({ ev, tp });
    return rows.sort((a, b) => String(a.tp.scheduledOn || '').localeCompare(String(b.tp.scheduledOn || '')));
  }, [events]);

  // ── 기입 모달 열기/편집 ──────────────────────────────────────────
  const openCreate = (date?: string) => {
    setEditing(null);
    setFTitle('');
    setFStart(date || `${month}-01`);
    setFEnd(date || `${month}-01`);
    setFBenefit('');
    setFProducts('');
    setFTouchpoints([]);
    setModalOpen(true);
  };
  const openEdit = (ev: PlannerEvent) => {
    setEditing(ev);
    setFTitle(ev.title);
    setFStart(ev.startsOn);
    setFEnd(ev.endsOn);
    setFBenefit(ev.benefitText || '');
    setFProducts((ev.products || []).map((p) => p.name).join('\n'));
    setFTouchpoints(ev.touchpoints.map((t) => ({ channel: t.channel, timing: t.timing })));
    setModalOpen(true);
  };

  /** 캘린더 셀 클릭 — 앞뒤 달 날짜를 누르면 그 달로 넘어간다(격자를 채운 값이 죽은 칸이 되지 않게). */
  const onCellClick = (cell: { date: string; inMonth: boolean }) => {
    if (!cell.inMonth) { setMonth(cell.date.slice(0, 7)); return; }
    const dayEvents = eventsByDate.get(cell.date) || [];
    if (dayEvents.length > 0) openEdit(dayEvents[0]);
    else openCreate(cell.date);
  };

  // ── 상세 ────────────────────────────────────────────────────────
  const openDetail = async (ev: PlannerEvent, tp: Touchpoint) => {
    setDetailOf({ ev, tp });
    setDetail(null);
    // 아직 도래하지 않은 계획은 물어볼 실측이 없다 — 화면이 가진 계획으로 그린다.
    const arrived = !!tp.scheduledOn && tp.scheduledOn <= today;
    if (!arrived || !tp.id) return;
    setDetailLoading(true);
    try {
      const r = await fetch(`/api/marketing-planner/touchpoints/${tp.id}/detail`, { headers: auth() });
      if (r.ok) setDetail(await r.json());
      else if (r.status !== 404) toast.error('상세를 불러오지 못했습니다');
    } catch {
      toast.error('네트워크 오류 — 다시 시도해 주세요');
    } finally {
      setDetailLoading(false);
    }
  };

  const toggleChannel = (channel: Channel) => {
    const gate = availability.find((a) => a.channel === channel);
    if (gate && !gate.available) return; // 잠금 — 클릭 무시(사유는 화면에 이미 떠 있다)
    setFTouchpoints((prev) => {
      const has = prev.some((t) => t.channel === channel);
      if (has) return prev.filter((t) => t.channel !== channel);
      // 채널별 기본 시점 — 문자·인앱=시작일 / 이메일·DM=시작 5일 전 사전 안내 / 알림톡=시작일(정보성 안내)
      const timing: Touchpoint['timing'] =
        channel === 'email' || channel === 'dm' ? { anchor: 'before_start', offsetDays: 5 } : { anchor: 'start' };
      return [...prev, { channel, timing }];
    });
  };

  const setTiming = (channel: Channel, anchor: Anchor, offsetDays?: number) => {
    setFTouchpoints((prev) => prev.map((t) => (
      t.channel === channel
        // 대상 축(audience)은 시점 변경에 휩쓸리지 않게 보존한다.
        ? { ...t, timing: { anchor, ...(anchor === 'before_start' ? { offsetDays: offsetDays || 5 } : {}), ...(t.timing.audience ? { audience: t.timing.audience } : {}) } }
        : t
    )));
  };

  /** ★ 2026-08-13 대상 축 — 전체 / 행사 참여 신청자. 서버가 채널별로 다시 확정한다(프론트 값 그대로 믿지 않는다). */
  const setAudience = (channel: Channel, audience: 'all' | 'participants') => {
    setFTouchpoints((prev) => prev.map((t) => (
      t.channel === channel
        ? { ...t, timing: { ...t.timing, ...(audience === 'participants' ? { audience } : { audience: undefined }) } }
        : t
    )));
  };

  const estTotal = useMemo(
    () => fTouchpoints.reduce((s, t) => s + (availability.find((a) => a.channel === t.channel)?.estCredits || 0), 0),
    [fTouchpoints, availability],
  );

  const submit = async () => {
    if (!fTitle.trim()) { toast.error('행사명을 입력해 주세요'); return; }
    if (!fStart || !fEnd) { toast.error('행사 기간을 선택해 주세요'); return; }
    if (fTouchpoints.length === 0) { toast.error('채널을 1개 이상 선택해 주세요'); return; }
    setSaving(true);
    try {
      const body = JSON.stringify({
        title: fTitle.trim(),
        startsOn: fStart,
        endsOn: fEnd,
        benefitText: fBenefit.trim() || null,
        products: fProducts.split('\n').map((s) => ({ name: s.trim() })).filter((p) => p.name),
        touchpoints: fTouchpoints.map((t) => ({ channel: t.channel, timing: t.timing })),
      });
      const url = editing ? `/api/marketing-planner/events/${editing.id}` : '/api/marketing-planner/events';
      const r = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body,
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 503) { setMigrationPending(true); toast.error('준비 중입니다 — 잠시 후 다시 시도해 주세요'); return; }
      if (!r.ok) { toast.error(d.error || '저장에 실패했습니다'); return; }
      toast.success(editing ? '행사가 수정되었습니다' : '행사가 캘린더에 담겼습니다');
      setModalOpen(false);
      loadEvents(month);
    } catch {
      toast.error('네트워크 오류 — 다시 시도해 주세요');
    } finally {
      setSaving(false);
    }
  };

  const removeEvent = (ev: PlannerEvent) => {
    setConfirm({
      title: '행사 삭제',
      description: `'${ev.title}' 행사를 캘린더에서 삭제할까요? 선택한 채널 구성도 함께 삭제됩니다.`,
      mode: 'danger',
      confirmLabel: '삭제',
      onConfirm: async () => {
        setConfirm(null);
        try {
          const r = await fetch(`/api/marketing-planner/events/${ev.id}`, { method: 'DELETE', headers: auth() });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) { toast.error(d.error || '삭제에 실패했습니다'); return; }
          toast.success('삭제되었습니다');
          loadEvents(month);
        } catch { toast.error('네트워크 오류 — 다시 시도해 주세요'); }
      },
    });
  };

  const monthEstTotal = events.reduce((s, e) => s + (e.estCreditsTotal || 0), 0);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* ── sticky 헤더 ───────────────────────────────────────────── */}
      <div className="bg-slate-900/70 backdrop-blur-md border-b border-white/10 sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
          <button onClick={() => goBackOr(navigate, '/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 transition-colors" aria-label="AI Operator로 돌아가기">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/20">
            <CalendarDays className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-semibold">마케팅 플래너</h1>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-fuchsia-500/25 text-fuchsia-200">NEW</span>
            </div>
            <p className="text-xs md:text-sm text-white/50 mt-0.5 hidden md:block">한 달 행사를 담아 두면, 채널별 제작과 발송을 AI가 이어받습니다</p>
          </div>
          <button
            onClick={() => navigate('/marketing-calendar')}
            className="text-xs text-violet-200 border border-violet-400/30 hover:bg-violet-500/20 px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span className="hidden md:inline">AI 추천으로 채우기</span>
          </button>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 md:px-6 py-5 space-y-4">
        {/* 준비 안내 — 테이블 미생성(배포 직후) 상태를 숨기지 않는다 */}
        {migrationPending && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            플래너 준비 작업이 진행 중입니다. 잠시 후 새로고침해 주세요.
          </div>
        )}

        {/* ── 월 내비게이션 + 월 요약 ──────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
            <button onClick={() => setMonth((m) => shiftMonth(m, -1))} className="p-2 rounded-lg hover:bg-white/10" aria-label="이전 달">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 text-sm font-semibold tabular-nums">{month.replace('-', '년 ')}월</span>
            <button onClick={() => setMonth((m) => shiftMonth(m, 1))} className="p-2 rounded-lg hover:bg-white/10" aria-label="다음 달">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          {month !== todayMonth() && (
            <button onClick={() => setMonth(todayMonth())} className="text-xs px-2.5 py-1.5 rounded-lg border border-white/15 text-white/60 hover:bg-white/10 transition-colors">
              이번 달
            </button>
          )}
          <div className="text-xs text-white/50">
            행사 <b className="text-white/80">{events.length}건</b>
            {monthEstTotal > 0 && <> · 예상 제작 크레딧 <b className="text-violet-200 tabular-nums">{monthEstTotal.toLocaleString()}</b></>}
          </div>
          <button
            onClick={() => openCreate()}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" /> 행사 담기
          </button>
        </div>

        {/* ── 결재 배너 (★ Phase 2) — 문자 링크 말고도 화면에서 결재로 갈 수 있는 두 번째 경로 ── */}
        {events.length > 0 && !migrationPending && (
          <div className={`rounded-2xl border px-4 md:px-5 py-3.5 flex flex-wrap items-center gap-3 ${
            approval?.status === 'approved'
              ? 'border-emerald-400/25 bg-emerald-500/[0.08]'
              : approval
                ? 'border-amber-400/25 bg-amber-500/[0.08]'
                : 'border-violet-400/25 bg-gradient-to-r from-violet-500/[0.12] to-fuchsia-500/[0.08]'
          }`}>
            {approval?.status === 'approved'
              ? <CheckCircle2 className="w-5 h-5 text-emerald-300 flex-shrink-0" />
              : <ClipboardCheck className="w-5 h-5 text-violet-300 flex-shrink-0" />}
            <div className="flex-1 min-w-[12rem]">
              <p className="text-sm font-semibold">
                {approval?.status === 'approved'
                  ? '이번 달 대행이 시작되었습니다'
                  : approval
                    ? '결재 대기 — 승인만 하면 대행이 시작됩니다'
                    : '이번 달 계획을 결재에 올리세요'}
              </p>
              <p className="text-xs text-white/55 mt-0.5">
                {approval?.status === 'approved'
                  ? '계획대로 제작과 발송이 이어집니다. 소재 제작분은 각 제작 시점에 차감됩니다.'
                  : '승인 전에는 제작·발송·차감이 일어나지 않습니다.'}
              </p>
            </div>
            <button
              onClick={() => navigate(`/marketing-planner/brief/${month}`)}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              {approval?.status === 'approved' ? '브리핑 보기' : approval ? '승인하러 가기' : '브리핑 열기'}
            </button>
          </div>
        )}

        {/* ── 좌: 캘린더 / 우: 실행 예정 ───────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* 캘린더 */}
          <div className="lg:col-span-7 rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
            <div className="grid grid-cols-7 border-b border-white/10 text-center text-[11px] font-medium">
              {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
                <div key={d} className={`py-2 ${i === 0 ? 'text-rose-300/80' : i === 6 ? 'text-sky-300/80' : 'text-white/45'}`}>{d}</div>
              ))}
            </div>
            {loading ? (
              <div className="py-24 flex items-center justify-center text-white/40 text-sm">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> 불러오는 중...
              </div>
            ) : (
              <div className="grid grid-cols-7">
                {cells.map((c, i) => {
                  const dayEvents = c.inMonth ? eventsByDate.get(c.date) || [] : [];
                  const holiday = holidayByDate.get(c.date);
                  const dow = i % 7;
                  const isToday = c.date === today;
                  const red = dow === 0 || !!holiday;
                  return (
                    <button
                      key={c.date}
                      onClick={() => onCellClick(c)}
                      className={`relative min-h-[84px] md:min-h-[104px] p-1.5 text-left border-b border-r border-white/5 align-top transition-colors ${
                        c.inMonth ? 'hover:bg-white/[0.06]' : 'bg-black/20 hover:bg-white/[0.03]'
                      }`}
                    >
                      <div className="flex items-baseline gap-1">
                        <span className={`text-[12px] tabular-nums font-medium ${
                          !c.inMonth ? 'text-white/20'
                            : isToday ? 'text-white'
                              : red ? 'text-rose-300' : dow === 6 ? 'text-sky-300/90' : 'text-white/70'
                        } ${isToday ? 'inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-violet-500' : ''}`}>
                          {Number(c.date.slice(8))}
                        </span>
                        {holiday && c.inMonth && (
                          <span className="text-[9px] text-rose-300/80 truncate">{holiday.name}</span>
                        )}
                      </div>
                      {c.inMonth && (
                        <div className="mt-1 space-y-1">
                          {dayEvents.slice(0, 3).map((ev) => (
                            <div key={ev.id} className="truncate rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-500/25 text-violet-100 border border-violet-400/20">
                              {ev.title}
                            </div>
                          ))}
                          {dayEvents.length > 3 && <div className="text-[9px] text-white/35 pl-1">+{dayEvents.length - 3}</div>}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {!holidaysReady && (
              <div className="px-4 py-2.5 border-t border-white/10 text-[11px] text-amber-200/70">
                {month.slice(0, 4)}년 공휴일 정보가 아직 등록되지 않아 표시하지 않습니다. 확정된 뒤 반영됩니다.
              </div>
            )}
          </div>

          {/* 실행 예정 패널 */}
          <div className="lg:col-span-5 rounded-2xl border border-white/10 bg-white/[0.03]">
            <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
              <h2 className="text-sm font-semibold">실행 예정</h2>
              <span className="text-[11px] text-white/40">{schedule.length}건</span>
              <span className="ml-auto text-[11px] text-white/35">항목을 누르면 상세가 열립니다</span>
            </div>
            {loading ? (
              <div className="py-20 flex items-center justify-center text-white/40 text-sm">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> 불러오는 중...
              </div>
            ) : schedule.length === 0 ? (
              <div className="py-16 px-6 text-center">
                <Sparkles className="w-6 h-6 text-violet-300/50 mx-auto mb-2" />
                <p className="text-sm text-white/60">이번 달 실행 예정이 없습니다</p>
                <p className="text-xs text-white/35 mt-1">행사를 담으면 채널별 발송 일정이 여기에 순서대로 섭니다</p>
              </div>
            ) : (
              <div className="divide-y divide-white/5 max-h-[720px] overflow-y-auto">
                {schedule.map(({ ev, tp }, i) => {
                  const st = TP_STATUS[String(tp.status || 'planned')] || TP_STATUS.planned;
                  const arrived = !!tp.scheduledOn && tp.scheduledOn <= today;
                  const Icon = CHANNEL_ICON[tp.channel] || Smartphone;
                  return (
                    <button
                      key={tp.id || `${ev.id}-${i}`}
                      onClick={() => openDetail(ev, tp)}
                      className="w-full text-left px-4 py-3 hover:bg-white/[0.04] transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded ${
                          arrived ? 'bg-white/10 text-white/50' : 'bg-violet-500/20 text-violet-200'
                        }`}>
                          {tp.scheduledOn ? ddayLabel(tp.scheduledOn, today) : '-'}
                        </span>
                        <Icon className="w-3.5 h-3.5 text-white/40 flex-shrink-0" />
                        <span className="text-sm font-medium truncate">{tp.label || tp.channel}</span>
                        <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded border ${st.cls}`}>{st.label}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-white/45">
                        <span className="truncate">{ev.title}</span>
                        <span className="tabular-nums flex-shrink-0">{tp.scheduledOn}</span>
                        {tp.timing?.audience === 'participants' && (
                          <span className="text-[10px] px-1.5 rounded bg-sky-500/15 text-sky-200 flex-shrink-0">참여자</span>
                        )}
                      </div>
                      {tp.lockReason && (
                        <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-200/80">
                          <PauseCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                          <span className="flex-1">{tp.lockReason}</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── 행사 목록(편집·삭제) ─────────────────────────────────── */}
        {events.length > 0 && (
          <div className="space-y-2">
            {events.map((ev) => (
              <div key={ev.id} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{ev.title}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${(STATUS_BADGE[ev.status] || STATUS_BADGE.draft).cls}`}>
                    {(STATUS_BADGE[ev.status] || STATUS_BADGE.draft).label}
                  </span>
                  <span className="text-xs text-white/40 tabular-nums">{ev.startsOn} ~ {ev.endsOn}</span>
                  {ev.estCreditsTotal > 0 && (
                    <span className="text-[11px] text-violet-200/80 tabular-nums">제작 예상 {ev.estCreditsTotal.toLocaleString()}크레딧</span>
                  )}
                  <span className="ml-auto flex gap-1.5">
                    <button onClick={() => openEdit(ev)} className="text-xs px-2.5 py-1 rounded-lg border border-white/15 text-white/70 hover:bg-white/10">편집</button>
                    {ev.status === 'draft' && (
                      <button onClick={() => removeEvent(ev)} className="p-1.5 rounded-lg text-white/40 hover:text-rose-300 hover:bg-rose-500/10" aria-label="삭제">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && events.length === 0 && !migrationPending && (
          <div className="rounded-2xl border border-dashed border-white/10 py-14 text-center">
            <Sparkles className="w-6 h-6 text-violet-300/50 mx-auto mb-2" />
            <p className="text-sm text-white/60">이번 달 행사가 아직 없습니다</p>
            <p className="text-xs text-white/35 mt-1">날짜를 누르거나 [행사 담기]로 시작하세요 — 채널 제작·발송은 AI가 이어받습니다</p>
          </div>
        )}

        <p className="text-[10px] text-white/30 italic">
          Data source — 행사·채널 구성은 저장 즉시 반영, 예상 크레딧은 소재 제작 기준이며 문자·알림톡은 실행 시 별도 과금됩니다.
          공휴일은 관보 확정분이고, 발송 결과·대상 수는 실제 발송 기록입니다. 월간 결재는 브리핑 화면에서 진행합니다.
        </p>
      </div>

      {/* ── 터치포인트 상세 모달 (★ 2026-08-13(2)) ─────────────────── */}
      {detailOf && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setDetailOf(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-white/10 flex items-start gap-3 sticky top-0 bg-slate-900 z-10">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold truncate">{detailOf.ev.title}</h3>
                <p className="text-[11px] text-white/45 mt-0.5">
                  {detailOf.tp.label || detailOf.tp.channel} · {detailOf.tp.scheduledOn}
                  {detailOf.tp.timing?.anchor && <> · {ANCHOR_LABEL[detailOf.tp.timing.anchor]}</>}
                </p>
              </div>
              <button onClick={() => setDetailOf(null)} className="p-1.5 rounded-lg text-white/40 hover:bg-white/10" aria-label="닫기">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {(() => {
                const tp = detailOf.tp;
                const st = TP_STATUS[String(tp.status || 'planned')] || TP_STATUS.planned;
                const arrived = !!tp.scheduledOn && tp.scheduledOn <= today;
                return (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[11px] px-2 py-1 rounded-lg border ${st.cls}`}>{st.label}</span>
                      {!arrived && <span className="text-[11px] text-white/45">{ddayLabel(String(tp.scheduledOn), today)}에 실행됩니다</span>}
                      {tp.timing?.audience === 'participants' && (
                        <span className="text-[11px] px-2 py-1 rounded-lg bg-sky-500/15 text-sky-200 border border-sky-400/25">행사 참여 신청자</span>
                      )}
                    </div>

                    {tp.lockReason && (
                      <div className="rounded-xl border border-amber-400/25 bg-amber-500/[0.08] px-3 py-2.5 flex items-start gap-2">
                        <PauseCircle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-px" />
                        <p className="text-[12px] text-amber-100/90">{tp.lockReason}</p>
                      </div>
                    )}

                    {/* 계획 — 도래 전에는 이것이 전부다(없는 실측을 지어내지 않는다) */}
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 space-y-1.5 text-[12px]">
                      <div className="flex justify-between"><span className="text-white/45">행사 기간</span><span className="tabular-nums">{detailOf.ev.startsOn} ~ {detailOf.ev.endsOn}</span></div>
                      <div className="flex justify-between"><span className="text-white/45">발송 예정일</span><span className="tabular-nums">{tp.scheduledOn}</span></div>
                      <div className="flex justify-between">
                        <span className="text-white/45">제작 크레딧</span>
                        <span className="tabular-nums">{tp.estCredits != null ? `${Number(tp.estCredits).toLocaleString()}크레딧` : '실행 시 과금'}</span>
                      </div>
                      {detailOf.ev.benefitText && (
                        <div className="flex justify-between gap-3"><span className="text-white/45 flex-shrink-0">혜택</span><span className="text-right">{detailOf.ev.benefitText}</span></div>
                      )}
                    </div>

                    {!arrived && (
                      <p className="text-[11px] text-white/40">
                        아직 도래하지 않은 일정입니다. 문자 문안은 발송 당일에 만들어지고, 소재는 승인 후 제작됩니다.
                      </p>
                    )}

                    {arrived && detailLoading && (
                      <div className="py-8 flex items-center justify-center text-white/40 text-sm">
                        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 실행 내역을 불러오는 중...
                      </div>
                    )}

                    {arrived && !detailLoading && detail && (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 space-y-1.5 text-[12px]">
                          {detail.sentAt && (
                            <div className="flex justify-between"><span className="text-white/45">발송 시각</span><span className="tabular-nums">{new Date(detail.sentAt).toLocaleString('ko-KR')}</span></div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-white/45">대상</span>
                            <span className="tabular-nums">
                              {detail.sentCount != null ? `${detail.sentCount.toLocaleString()}명 발송` : detail.audienceCount != null ? `${detail.audienceCount.toLocaleString()}명` : '집계 없음'}
                            </span>
                          </div>
                          {detail.audienceNote && <p className="text-[11px] text-white/40 pt-0.5">{detail.audienceNote}</p>}
                        </div>

                        {detail.message && (
                          <div>
                            <p className="text-[11px] font-medium text-white/50 mb-1.5">실제 발송 문안</p>
                            <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                              {detail.message.subject && <p className="text-[12px] font-semibold mb-1">{detail.message.subject}</p>}
                              <p className="text-[12px] text-white/75 whitespace-pre-wrap leading-relaxed">{detail.message.body}</p>
                            </div>
                          </div>
                        )}

                        {detail.asset && (
                          <div>
                            <p className="text-[11px] font-medium text-white/50 mb-1.5">발행된 소재</p>
                            {detail.asset.kind === 'email' && detail.asset.html && (
                              <button
                                onClick={() => setPreview({ title: '이메일 미리보기', html: String(detail.asset?.html || '') })}
                                className="w-full flex items-center gap-2 px-4 py-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-left"
                              >
                                <MailOpen className="w-4 h-4 text-violet-300 flex-shrink-0" />
                                <span className="text-[12px] flex-1 truncate">{detail.asset.title || '이메일 소재'}</span>
                                <span className="text-[11px] text-violet-200">미리보기</span>
                              </button>
                            )}
                            {detail.asset.kind === 'dm' && detail.asset.url && (
                              <a
                                href={detail.asset.url} target="_blank" rel="noopener noreferrer"
                                className="w-full flex items-center gap-2 px-4 py-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
                              >
                                <Smartphone className="w-4 h-4 text-violet-300 flex-shrink-0" />
                                <span className="text-[12px] flex-1 truncate">모바일 DM — {detail.asset.url}</span>
                                <ExternalLink className="w-3.5 h-3.5 text-violet-200 flex-shrink-0" />
                              </a>
                            )}
                            {detail.asset.kind === 'inapp' && (
                              <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                                {detail.asset.imageUrl && (
                                  <img src={detail.asset.imageUrl} alt="" className="w-full max-h-40 object-cover rounded-lg mb-2" />
                                )}
                                <p className="text-[12px] font-semibold">{detail.asset.title}</p>
                                <p className="text-[12px] text-white/70 mt-1 whitespace-pre-wrap">{detail.asset.body}</p>
                              </div>
                            )}
                            {detail.asset.kind === 'alimtalk' && (
                              <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                                {detail.asset.inspection && <p className="text-[11px] text-white/45 mb-1.5">검수 상태 — {detail.asset.inspection}</p>}
                                <p className="text-[12px] text-white/75 whitespace-pre-wrap leading-relaxed">{detail.asset.body}</p>
                              </div>
                            )}
                          </div>
                        )}

                        {!detail.message && !detail.asset && (
                          <p className="text-[11px] text-white/40">이 항목의 발송 내역이 아직 없습니다.</p>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="px-5 py-4 border-t border-white/10 flex gap-2">
              <button onClick={() => { const ev = detailOf.ev; setDetailOf(null); openEdit(ev); }} className="text-xs px-3 py-2 rounded-lg border border-white/15 text-white/70 hover:bg-white/10">
                행사 편집
              </button>
              <button onClick={() => navigate(`/marketing-planner/brief/${month}`)} className="ml-auto text-xs px-3 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 font-semibold hover:opacity-90">
                브리핑에서 보기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 소재 미리보기 — 발행된 HTML을 그대로 띄운다(sandbox: 스크립트 차단) */}
      {preview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70" onClick={() => setPreview(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl h-[82vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-bold">{preview.title}</h3>
              <button onClick={() => setPreview(null)} className="p-1.5 rounded-lg text-white/40 hover:bg-white/10" aria-label="닫기">
                <X className="w-4 h-4" />
              </button>
            </div>
            <iframe title={preview.title} srcDoc={preview.html} sandbox="" className="flex-1 w-full bg-white rounded-b-2xl" />
          </div>
        </div>
      )}

      {/* ── 행사 기입 모달 ─────────────────────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between sticky top-0 bg-slate-900 z-10">
              <h3 className="text-sm font-bold">{editing ? '행사 편집' : '행사 담기'}</h3>
              <button onClick={() => setModalOpen(false)} className="p-1.5 rounded-lg text-white/40 hover:bg-white/10" aria-label="닫기">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <label className="block">
                <span className="text-xs font-medium text-white/50">행사명</span>
                <input
                  type="text" value={fTitle} onChange={(e) => setFTitle(e.target.value.slice(0, 120))}
                  placeholder="예: 가을 신상 위크"
                  className="mt-1 w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 outline-none"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-white/50">시작일</span>
                  <input type="date" value={fStart} onChange={(e) => setFStart(e.target.value)}
                    className="mt-1 w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 outline-none [color-scheme:dark]" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-white/50">종료일</span>
                  <input type="date" value={fEnd} onChange={(e) => setFEnd(e.target.value)}
                    className="mt-1 w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 outline-none [color-scheme:dark]" />
                </label>
              </div>

              <label className="block">
                <span className="text-xs font-medium text-white/50">혜택 문구 <span className="text-white/30">(직접 입력 — AI가 대신 만들지 않습니다)</span></span>
                <input
                  type="text" value={fBenefit} onChange={(e) => setFBenefit(e.target.value.slice(0, 300))}
                  placeholder="예: 전 품목 신상 특가, 첫 구매 사은품"
                  className="mt-1 w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 outline-none"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-white/50">행사 상품 <span className="text-white/30">(한 줄에 하나 · 선택)</span></span>
                <textarea
                  value={fProducts} onChange={(e) => setFProducts(e.target.value)} rows={2}
                  placeholder={'니트 가디건\n울 머플러'}
                  className="mt-1 w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 outline-none resize-none"
                />
              </label>

              {/* 채널 선택 — 가용성 잠금 + 시점 규칙 */}
              <div>
                <span className="text-xs font-medium text-white/50">채널과 시점</span>
                <div className="mt-2 space-y-2">
                  {availability.map((a) => {
                    const selected = fTouchpoints.find((t) => t.channel === a.channel);
                    return (
                      <div key={a.channel} className={`rounded-xl border px-3 py-2.5 ${selected ? 'border-violet-400/40 bg-violet-500/10' : 'border-white/10 bg-white/[0.03]'} ${!a.available ? 'opacity-60' : ''}`}>
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => toggleChannel(a.channel)}
                            disabled={!a.available}
                            className={`w-4.5 h-4.5 w-[18px] h-[18px] rounded border flex items-center justify-center shrink-0 ${
                              selected ? 'bg-violet-500 border-violet-400' : 'border-white/25'
                            } ${!a.available ? 'cursor-not-allowed' : ''}`}
                            aria-label={a.label}
                          >
                            {selected && <span className="text-[10px] leading-none">✓</span>}
                            {!a.available && <Lock className="w-2.5 h-2.5 text-white/40" />}
                          </button>
                          <span className="text-sm">{a.label}</span>
                          <span className="ml-auto text-[11px] text-white/40 tabular-nums">
                            {a.estCredits != null ? `제작 ${a.estCredits}크레딧` : '실행 시 과금'}
                          </span>
                        </div>
                        {!a.available && a.reason && (
                          <p className="mt-1.5 ml-[28px] text-[11px] text-amber-200/70">{a.reason}</p>
                        )}
                        {selected && (
                          <div className="mt-2 ml-[28px] flex flex-wrap items-center gap-1.5">
                            {(['start', 'end', 'before_start'] as Anchor[]).map((anchor) => (
                              <button
                                key={anchor}
                                type="button"
                                onClick={() => setTiming(a.channel, anchor)}
                                className={`text-[11px] px-2 py-1 rounded-lg border ${
                                  selected.timing.anchor === anchor
                                    ? 'border-violet-400/60 bg-violet-500/25 text-violet-100'
                                    : 'border-white/10 text-white/50 hover:bg-white/5'
                                }`}
                              >
                                {ANCHOR_LABEL[anchor]}
                              </button>
                            ))}
                            {selected.timing.anchor === 'before_start' && (
                              <span className="flex items-center gap-1 text-[11px] text-white/60">
                                시작
                                <input
                                  type="number" min={1} max={30}
                                  value={selected.timing.offsetDays || 5}
                                  onChange={(e) => setTiming(a.channel, 'before_start', Math.max(1, Math.min(30, Number(e.target.value) || 5)))}
                                  className="w-14 px-2 py-1 bg-white/5 border border-white/10 rounded-lg text-center tabular-nums outline-none focus:ring-1 focus:ring-violet-500"
                                />
                                일 전
                              </span>
                            )}
                          </div>
                        )}
                        {/* ★ 2026-08-13 대상 축 — 문자·DM만 고를 수 있다.
                            알림톡은 언제나 참여 신청자(정보성 안내)라 선택지가 없고, 이메일은 참여 접수의 입구다. */}
                        {selected && (a.channel === 'sms' || a.channel === 'dm') && (
                          <label className="mt-2 ml-[28px] flex items-center gap-2 text-[11px] text-white/60 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selected.timing.audience === 'participants'}
                              onChange={(e) => setAudience(a.channel, e.target.checked ? 'participants' : 'all')}
                              className="accent-violet-500"
                            />
                            행사 참여를 신청한 고객에게만 보내기
                          </label>
                        )}
                        {selected && a.channel === 'alimtalk' && (
                          <p className="mt-2 ml-[28px] text-[11px] text-white/45">
                            알림톡은 행사 참여를 신청한 고객에게 보내는 안내입니다. 템플릿 검수는 대행해 드립니다.
                          </p>
                        )}
                      </div>
                    );
                  })}
                  {availability.length === 0 && (
                    <p className="text-xs text-white/40 py-3 text-center">채널 상태를 불러오는 중입니다...</p>
                  )}
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-white/10 flex items-center gap-3 sticky bottom-0 bg-slate-900">
              <span className="text-xs text-white/50">
                예상 제작 크레딧 <b className="text-violet-200 tabular-nums">{estTotal.toLocaleString()}</b>
                <span className="text-white/30"> · 저장만으로는 차감되지 않습니다</span>
              </span>
              <button
                onClick={submit} disabled={saving}
                className="ml-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {saving ? '저장 중...' : editing ? '수정 저장' : '캘린더에 담기'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
