/**
 * MarketingPlannerPage.tsx — 마케팅 플래너 (★ 2026-08-12 Phase 1 · 설계서 = docs/2026-08-12-ax-marketing-planner-design.md)
 *
 * 세 번째 시계 — 여정(사건)·자동마케팅(상태)에 이은 **달력** 축. 담당자가 월간 캘린더에 행사를 기입하고
 * 채널 5종을 체크하면, 이후 단계(Phase 2 결재 → Phase 3 대행 제작·실행)가 그 계획을 무인으로 완주한다.
 *
 * Phase 1 화면 범위 = 캘린더 + 행사 기입 모달 + 채널 가용성 잠금 + 예상 크레딧 합계.
 * 승인·차감·제작은 아직 없다 — 상단에 그 사실을 숨기지 않고 말한다(결재는 다음 업데이트).
 *
 * 영구 룰: 다크 slate-950 + violet 액센트 · native dialog 0(ConfirmModal·useToast) · 모델명 노출 0 ·
 *          혜택은 고객사 기입 칸(AI가 채우지 않는다) · Source caption 의무 · goBackOr 복귀.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck,
  Loader2, Lock, Plus, Sparkles, Trash2, Wand2, X,
} from 'lucide-react';
import { goBackOr } from '../lib/scroll-restoration';
import { useToast } from '../components/ToastProvider';
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';

// ── 타입 (백엔드 CT와 미러 — 서버가 진실) ─────────────────────────────
type Channel = 'sms' | 'alimtalk' | 'email' | 'dm' | 'inapp';
type Anchor = 'start' | 'end' | 'before_start';

interface Availability { channel: Channel; label: string; available: boolean; reason: string | null; estCredits: number | null }
interface Touchpoint { id?: string; channel: Channel; label?: string; timing: { anchor: Anchor; offsetDays?: number }; estCredits?: number | null; scheduledOn?: string; lockReason?: string | null }
interface PlannerEvent {
  id: string; title: string; startsOn: string; endsOn: string; benefitText: string | null;
  products: Array<{ name: string }>; status: string; touchpoints: Touchpoint[]; estCreditsTotal: number;
}
/** ★ Phase 2 — 그 달 결재 상태(승인 원장 표가 아직 없으면 서버가 null을 준다) */
interface MonthApproval { status: 'pending' | 'approving' | 'approved' | 'cancelled'; approvedAt: string | null; agencyCredits: number }

const ANCHOR_LABEL: Record<Anchor, string> = { start: '행사 시작일', end: '행사 종료일', before_start: '시작 전 사전 안내' };
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  draft: { label: '작성 중', cls: 'bg-white/10 text-white/60' },
  briefed: { label: '브리핑 대기', cls: 'bg-amber-500/20 text-amber-200' },
  approved: { label: '승인됨', cls: 'bg-emerald-500/20 text-emerald-200' },
};

const todayMonth = () => new Date().toISOString().slice(0, 7);

/** 'YYYY-MM' → 캘린더 셀 배열(앞뒤 공백 포함 6주). 문자열 연산 위주 — 타임존 밀림 방지. */
function buildMonthCells(month: string): Array<{ date: string | null }> {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const firstDow = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Array<{ date: string | null }> = [];
  for (let i = 0; i < firstDow; i++) cells.push({ date: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: `${month}-${String(d).padStart(2, '0')}` });
  while (cells.length % 7 !== 0) cells.push({ date: null });
  return cells;
}

const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
};

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
  const [loading, setLoading] = useState(true);
  const [migrationPending, setMigrationPending] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

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
  const eventsByDate = useMemo(() => {
    const map = new Map<string, PlannerEvent[]>();
    for (const ev of events) {
      // 행사 기간의 각 날짜에 바를 그린다 — 셀 순회보다 행사 순회가 싸다(행사 수 << 날짜 수)
      for (let d = ev.startsOn; d <= ev.endsOn; d = nextDay(d)) {
        if (!d.startsWith(month)) continue;
        const arr = map.get(d) || [];
        arr.push(ev);
        map.set(d, arr);
      }
    }
    return map;
  }, [events, month]);

  function nextDay(date: string): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

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
      t.channel === channel ? { ...t, timing: { anchor, ...(anchor === 'before_start' ? { offsetDays: offsetDays || 5 } : {}) } } : t
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
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
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

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-5 space-y-4">
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

        {/* ── 캘린더 그리드 ────────────────────────────────────────── */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
          <div className="grid grid-cols-7 border-b border-white/10 text-center text-[11px] text-white/40">
            {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
              <div key={d} className={`py-2 ${i === 0 ? 'text-rose-300/60' : ''}`}>{d}</div>
            ))}
          </div>
          {loading ? (
            <div className="py-20 flex items-center justify-center text-white/40 text-sm">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> 불러오는 중...
            </div>
          ) : (
            <div className="grid grid-cols-7">
              {cells.map((c, i) => {
                const dayEvents = c.date ? eventsByDate.get(c.date) || [] : [];
                return (
                  <button
                    key={i}
                    disabled={!c.date}
                    onClick={() => c.date && (dayEvents.length > 0 ? openEdit(dayEvents[0]) : openCreate(c.date))}
                    className={`min-h-[76px] md:min-h-[96px] p-1.5 text-left border-b border-r border-white/5 align-top transition-colors ${
                      c.date ? 'hover:bg-white/[0.05]' : 'bg-white/[0.01]'
                    }`}
                  >
                    {c.date && (
                      <>
                        <div className="text-[11px] text-white/35 tabular-nums">{Number(c.date.slice(8))}</div>
                        <div className="mt-1 space-y-1">
                          {dayEvents.slice(0, 2).map((ev) => (
                            <div key={ev.id} className="truncate rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-500/25 text-violet-100 border border-violet-400/20">
                              {ev.title}
                            </div>
                          ))}
                          {dayEvents.length > 2 && <div className="text-[9px] text-white/35">+{dayEvents.length - 2}</div>}
                        </div>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── 행사 목록(캘린더 아래 상세) ──────────────────────────── */}
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
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ev.touchpoints.map((t, i) => (
                    <span key={i} className="text-[10px] px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/60">
                      {t.label || t.channel} · {t.scheduledOn}
                      {t.estCredits == null && <span className="text-white/35"> · 실행 시 과금</span>}
                    </span>
                  ))}
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
          Data source — 행사·채널 구성은 저장 즉시 반영, 예상 크레딧은 소재 제작 기준이며 문자·알림톡은 실행 시 별도 과금됩니다. 월간 결재는 브리핑 화면에서 진행합니다.
        </p>
      </div>

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
