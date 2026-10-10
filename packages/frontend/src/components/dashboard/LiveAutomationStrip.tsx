import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CalendarClock, Check, ChevronRight, PauseCircle, Repeat, Route, Send } from 'lucide-react';
import {
  ENTER_ONCE, countdownText, countdownTickMs, fetchJson, serialRunner, summarizeLive, type Fetched,
  type LiveJourneyRow, type LiveOperatorRow, type LiveScheduledRow, type LiveSending,
} from '../../utils/dashboard-live';
import { formatKstClock, formatKstMonthDayTime } from '../../utils/formatDate';

/**
 * ★ 2026-10-10 대시보드 모션 — 「지금 돌고 있는 자동화」 띠(설계 = docs/2026-10-10-dashboard-motion-design.md).
 *   서버가 준 상태에만 움직인다. 읽기만 한다(기존 경로 4개 · 새 서버 경로 0).
 *   - 1분마다 다시 읽기(창이 보일 때만 · 다시 보이면 바로) · 발송 중이면 3초마다 진행률 · refreshKey 가 오르면 바로 다시 읽기(B · C)
 *   - 발송이 끝나면 칸이 바로 사라지지 않고 끝 상태를 보여 준다(B)
 *   - 호출 일부가 실패하면 「없어요」가 아니라 「일부 상태를 확인하지 못했어요」(D)
 *   - 퍼지는 고리는 머리 점 하나 · 칸 안 점은 정지(E)
 */
export type LiveTarget = 'hub' | 'journeys' | 'auto' | 'scheduled' | 'results' | 'pricing';

/** 아직 적재 중인 단계 — 이 단계일 때만 「지금 발송 중」 칸을 그린다(단계 없는 옛 sending 행은 그리지 않는다) */
const SENDING_ACTIVE = new Set(['preparing', 'queued', 'processing']);
/** 끝난 단계 — sent = 적재 끝(성공 · 실패 · 취소는 status 로 가른다) · failed = 접수 단계 실패 */
const SENDING_DONE = new Set(['sent', 'failed']);
/** 발송 칸이 처음 나타날 때 · 새 칸이 생길 때 1회 */
const CHIP_IN = 'animate-in fade-in zoom-in-95 duration-200 fill-mode-backwards motion-reduce:animate-none';
/** 끝 상태를 보여 주는 시간 — 접수 끝 4초 · 실패는 다음 1분 읽기까지 */
const DONE_SHOW_MS = { sent: 4000, failed: 60_000 } as const;

type Done = { id: string; name: string; phase: 'sent' | 'failed' };

export default function LiveAutomationStrip({ scheduled, onOpen, onRunningChange, intro, refreshKey = 0 }: {
  scheduled: LiveScheduledRow[];
  onOpen: (target: LiveTarget) => void;
  onRunningChange: (n: number) => void;
  /** 페이지를 새로 열었을 때만 true — 띠 들어오기 1회 */
  intro: boolean;
  /** 즉시 직접발송 · 타겟발송 접수마다 오른다 → 바로 다시 읽기 */
  refreshKey?: number;
}) {
  const [operators, setOperators] = useState<LiveOperatorRow[]>([]);
  const [journeys, setJourneys] = useState<LiveJourneyRow[]>([]);
  const [sending, setSending] = useState<LiveSending | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [partial, setPartial] = useState(false);
  /** 켜진 자동화 수를 믿을 수 있는가(자동 마케팅 · 여정 둘 다 확인됨) — 아니면 AI Operator 버튼 숫자를 내리지 않는다 */
  const [runOk, setRunOk] = useState(false);
  /** 이미 끝 상태로 넘긴 캠페인 — 느린 읽기가 다시 「발송 중」으로 살리거나 끝 상태를 또 띄우지 않게 */
  const finished = useRef(new Set<string>());
  /**
   * ★ Codex 1R — 지금 따라가는 발송 칸의 캠페인. 칸의 주인은 하나다: 따라가는 동안에는 3초 진행률만 칸을 바꾸고
   *   1분 읽기는 새 발송을 찾는 일만 한다(두 경로가 같은 칸을 바꾸면 끝난 칸이 되살아나거나 끝 안내 없이 사라진다).
   */
  const tracked = useRef<string | null>(null);
  /** 3초 진행률 조회 실패 — 머리 표시를 「일부 상태를 확인하지 못했어요」로(자동화 수와는 다른 축) */
  const [pollFail, setPollFail] = useState(false);
  const [asOf, setAsOf] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // ★ Codex 1~4R — 서버 읽기 규칙 한 곳(utils/dashboard-live): 모든 요청 10초 제한 · 같은 값 읽기는 하나씩(합침)
  const get = fetchJson;

  /**
   * 끝 상태로 넘긴다 — 같은 캠페인은 한 번만(finished). 지금 보고 있는 칸의 3초 진행률만 부른다.
   *   단계 'sent' 는 적재 끝일 뿐 → status 로 가른다: cancelled = 끝 상태 없이 칸만 빠짐 · failed(0건) = 실패 · 그 밖 = 접수 끝
   */
  const finish = useCallback((id: string, name: string, phase: string, status: string | null) => {
    if (finished.current.has(id)) return;
    finished.current.add(id);
    if (tracked.current === id) tracked.current = null;
    setPollFail(false);
    setSending((s) => (s && s.id === id ? null : s));
    if (status === 'cancelled') return;
    setDone({ id, name, phase: phase === 'failed' || status === 'failed' ? 'failed' : 'sent' });
  }, []);

  /** 다시 읽기 — 하나씩만 돈다(runLoad · 도는 동안 들어온 요청은 끝난 뒤 한 번으로 합침). 끝 판정은 하지 않는다 */
  const load = useCallback(async (): Promise<void> => {
    const [op, jr, sd] = await Promise.all([
      get('/api/ai/operator/continuous'),
      get('/api/ai/operator/journeys?status=active'),
      get('/api/campaigns?status=sending&limit=1'),
    ]);
    let failed = false;
    if (op.ok && Array.isArray(op.body?.operators)) setOperators(op.body.operators); else failed = true;
    // 여정 403 = 이 계정은 여정을 못 쓴다 = 칸 없음(실패 아님)
    if (jr.ok && Array.isArray(jr.body?.journeys)) setJourneys(jr.body.journeys);
    else if (jr.status === 403) setJourneys([]);
    else failed = true;
    if (sd.ok && Array.isArray(sd.body?.campaigns)) {
      // 칸을 따라가는 중이면 손대지 않는다(주인 = 3초 진행률). 따라가는 칸이 없을 때만 새 발송을 찾는다
      const c = sd.body.campaigns[0];
      if (!tracked.current && c?.id && !finished.current.has(c.id)) {
        const pr = await get(`/api/campaigns/${c.id}/send-progress`);
        if (pr.ok && pr.body?.success) {
          // 적재 중 단계일 때만 칸을 그린다. 기다리는 사이 끝났거나 다른 칸을 따라가기 시작했으면 그리지 않는다
          if (SENDING_ACTIVE.has(pr.body.phase) && !finished.current.has(c.id) && !tracked.current) {
            tracked.current = c.id;
            setSending({ id: c.id, name: c.campaign_name || '발송', processed: pr.body.processed || 0, total: pr.body.total || 0, percent: pr.body.percent || 0 });
          }
        } else {
          failed = true; // 진행률을 못 읽었다
        }
      }
    } else {
      failed = true;
    }
    setPartial(failed);
    setRunOk(op.ok && (jr.ok || jr.status === 403));
    setAsOf(new Date());
    setNow(Date.now());
  }, [get]);
  const runLoad = useMemo(() => serialRunner(load), [load]);

  // 1분마다(창이 보일 때만) · 숨었던 창이 다시 보이면 바로(가드와 리스너는 한 쌍)
  useEffect(() => {
    void runLoad();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void runLoad(); }, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void runLoad(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [runLoad]);

  // C — 즉시 직접발송 접수 직후 바로 다시 읽기(접수 응답 전에 'sending' 행이 이미 있다 = 재시도 불필요)
  useEffect(() => { if (refreshKey) void runLoad(); }, [refreshKey, runLoad]);

  // B — 발송 중이면 3초마다 진행률. 끝 판정은 여기서만 한다. 통신 실패는 끝이 아니다(직전 상태 유지)
  //   ★ Codex 2R — 응답 반영 규칙(이 파일 공통): 정리된 요청의 응답은 버리고, 요청은 겹치지 않게 하나씩.
  //   느린 요청이 다음 틱과 겹치면 늦게 온 옛 실패가 끝난 뒤의 표시를 되살렸다.
  const sendingId = sending?.id;
  const sendingName = sending?.name;
  useEffect(() => {
    if (!sendingId) return;
    let alive = true;
    let busy = false;
    const t = setInterval(async () => {
      if (busy) return;
      busy = true;
      let pr: Fetched;
      try { pr = await get(`/api/campaigns/${sendingId}/send-progress`); } finally { busy = false; }
      // 이 칸을 더 따라가지 않으면(정리 · 끝 · 다른 칸) 응답을 버린다
      if (!alive || tracked.current !== sendingId) return;
      // 404 = 캠페인이 없어졌다(삭제 · 범위 밖) → 끝 상태 없이 칸만 뺀다
      if (pr.status === 404) {
        finished.current.add(sendingId);
        if (tracked.current === sendingId) tracked.current = null;
        setPollFail(false);
        setSending((s) => (s && s.id === sendingId ? null : s));
        return;
      }
      // 그 밖의 실패 = 마지막 진행률은 그대로 두고 머리에 「일부 상태를 확인하지 못했어요」
      if (!pr.ok || !pr.body?.success) { setPollFail(true); return; }
      setPollFail(false);
      if (SENDING_DONE.has(pr.body.phase)) { finish(sendingId, sendingName || '발송', pr.body.phase, pr.body.status ?? null); return; }
      setSending((s) => (s && s.id === sendingId ? { ...s, processed: pr.body.processed || 0, total: pr.body.total || 0, percent: pr.body.percent || 0 } : s));
    }, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [sendingId, sendingName, get, finish]);

  // B — 끝 상태는 정해진 시간만 보이고 빠진다. 접수 끝이면 빠진 뒤 한 번 다시 읽는다
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => { setDone(null); if (done.phase === 'sent') void runLoad(); }, DONE_SHOW_MS[done.phase]);
    return () => clearTimeout(t);
  }, [done, runLoad]);

  const s = summarizeLive({ operators, journeys, scheduled, sending, now });

  // E — 다음 회차 카운트다운: 1시간 안 = 1초마다 · 그 밖 = 1분마다
  const nextRunAt = s.auto?.nextRunAt ?? null;
  const hasAuto = !!s.auto;
  useEffect(() => {
    if (!hasAuto) return;
    const t = setTimeout(() => setNow(Date.now()), countdownTickMs(nextRunAt === null ? null : nextRunAt - now));
    return () => clearTimeout(t);
  }, [hasAuto, nextRunAt, now]);

  // D — 자동 마케팅 · 여정 둘 다 확인됐을 때만 AI Operator 버튼에 숫자를 넘긴다(일부 실패 = 0 = 알약 숨김)
  const runningShown = runOk ? s.running : 0;
  useEffect(() => { onRunningChange(runningShown); }, [runningShown, onRunningChange]);

  // 첫 읽기에서 그려진 칸은 띠 들어오기와 함께(intro) · 그 뒤 새로 생긴 칸만 1회 들어온다
  const firstPaint = useRef(true);
  useEffect(() => { if (asOf) firstPaint.current = false; }, [asOf]);
  const chipIn = intro || !firstPaint.current;

  const chips: ReactNode[] = [];
  if (s.journeys) {
    chips.push(
      <Shell key="journeys" enter={chipIn} onClick={() => onOpen('journeys')}>
        <ChipHead dot={<Dot tone="emerald" />} icon={<Route className="h-3.5 w-3.5" />} label={`켜진 여정 ${s.journeys.count}개`} />
        {/* 이름만 말줄임 · 「외 N개」는 잘리지 않는다(실측 1100 · 1280 폭에서 함께 잘렸다) */}
        <div className="mt-1.5 flex min-w-0 items-baseline gap-1 text-sm font-bold text-gray-900">
          <span className="truncate">{s.journeys.firstName}</span>
          {s.journeys.count > 1 && <span className="shrink-0 font-semibold text-gray-500">외 {s.journeys.count - 1}개</span>}
        </div>
        <div className="mt-0.5 truncate text-xs text-gray-500 tabular-nums">지금까지 {s.journeys.entered.toLocaleString()}명이 들어왔어요</div>
      </Shell>,
    );
  }
  if (s.auto) {
    const cd = countdownText(nextRunAt === null ? null : nextRunAt - now);
    chips.push(
      <Shell key="auto" enter={chipIn} onClick={() => onOpen('auto')}>
        <ChipHead dot={<Dot tone="violet" />} icon={<Repeat className="h-3.5 w-3.5" />} label={`자동 마케팅 ${s.auto.count}개`} />
        <div className="mt-1.5 truncate text-sm font-bold text-gray-900">{s.auto.nextName}</div>
        <div className="mt-0.5 truncate text-xs text-gray-500">
          {cd ? <>다음 회차 준비까지 <b className="font-semibold text-violet-700 tabular-nums">{cd}</b></> : '다음 회차를 곧 준비해요'}
        </div>
      </Shell>,
    );
  }
  if (s.stalled) {
    chips.push(
      <Shell key="stalled" enter={chipIn} onClick={() => onOpen('pricing')} tone="amber">
        <ChipHead dot={<Dot tone="amber" />} icon={<PauseCircle className="h-3.5 w-3.5" />} label="크레딧이 부족해 멈췄어요" />
        <div className="mt-1.5 truncate text-sm font-bold text-gray-900">자동 마케팅 {s.stalled.count}개</div>
        <div className="mt-0.5 truncate text-xs text-gray-500">충전하면 다음 회차부터 다시 돌아요</div>
      </Shell>,
    );
  }
  if (s.scheduled) {
    chips.push(
      <Shell key="scheduled" enter={chipIn} onClick={() => onOpen('scheduled')}>
        <ChipHead dot={<Dot tone="gray" />} icon={<CalendarClock className="h-3.5 w-3.5" />} label={`예약 대기 ${s.scheduled.count}건`} />
        <div className="mt-1.5 truncate text-sm font-bold text-gray-900">다음 발송 {formatKstMonthDayTime(new Date(s.scheduled.nextAt).toISOString())}</div>
        <div className="mt-0.5 truncate text-xs text-gray-500">{s.scheduled.nextName}</div>
      </Shell>,
    );
  }

  // 발송 칸은 맨 뒤 — 4초 뒤 빠질 때 앞 칸들이 자리를 옮기지 않는다
  if (s.sending || done) {
    const id = s.sending?.id ?? done!.id;
    const name = s.sending?.name ?? done!.name;
    const state = done && done.id === id ? done.phase : 'sending';
    const pct = state === 'sending' ? Math.min(100, Math.max(0, s.sending!.percent)) : 100;
    chips.push(
      <Shell
        key={`send-${id}`}
        enter={chipIn}
        onClick={state === 'sending' ? undefined : () => onOpen('results')}
        tone={state === 'failed' ? 'rose' : 'emerald'}
      >
        <ChipHead
          dot={<Dot tone={state === 'failed' ? 'rose' : 'emerald'} />}
          icon={state === 'sending'
            ? <Send className="h-3.5 w-3.5" />
            : <span key={state} className="inline-flex animate-in zoom-in-50 fade-in duration-300 fill-mode-backwards motion-reduce:animate-none">
                {state === 'failed' ? <AlertTriangle className="h-3.5 w-3.5 text-rose-600" /> : <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={3} />}
              </span>}
          label={state === 'sending' ? '지금 발송 중' : state === 'failed' ? '발송 처리에 실패했어요' : '발송 접수를 마쳤어요'}
        />
        <div className="mt-1.5 truncate text-sm font-bold text-gray-900">{name}</div>
        <div className="mt-0.5 truncate text-xs text-gray-500 tabular-nums">
          {state === 'sending'
            ? `대상 ${s.sending!.total.toLocaleString()}명 · ${s.sending!.percent}% 진행`
            : '결과는 발송결과에서 볼 수 있어요'}
        </div>
        <div className={`mt-2 h-1.5 overflow-hidden rounded-full ${state === 'failed' ? 'bg-rose-100' : 'bg-emerald-100'}`}>
          <div
            className={`h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none ${state === 'failed' ? 'bg-rose-400' : 'bg-gradient-to-r from-emerald-500 to-teal-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </Shell>,
    );
  }
  // 칸 수만큼 나눠 한 줄을 채운다(한쪽에 외톨이 칸이 남지 않게) · 5칸이면 넓은 화면에서 5등분
  //   5칸은 넓은 화면(xl)에서만 5등분 — 1100 폭에서 5등분하면 예약 시각 같은 핵심 줄이 잘렸다(실측)
  const cols = ['', '', 'sm:grid-cols-2', 'sm:grid-cols-3', 'sm:grid-cols-2 lg:grid-cols-4', 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'][chips.length];
  const shownPartial = partial || pollFail;
  const live = !shownPartial && (s.running > 0 || !!s.sending);

  return (
    <section className={`mb-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm ${intro ? ENTER_ONCE : ''}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <HeadDot live={live} muted={shownPartial || !asOf} />
          <span className="text-[15px] font-bold text-gray-900">
            {!asOf ? '자동화 상태를 확인하고 있어요'
              : shownPartial ? '일부 상태를 확인하지 못했어요'
              : s.running > 0 ? <>지금 <span className="tabular-nums">{s.running}</span>개가 자동으로 돌고 있어요</>
              : chips.length ? '켜진 자동화는 없어요' : '지금 돌고 있는 자동화가 없어요'}
          </span>
        </div>
        {/* 모바일 = 기준 시각 · 버튼은 늘 둘째 줄(첫 읽기 전후로 머리 높이가 같게 · 실측 390 폭 29px 뜀) */}
        <div className="flex w-full items-center justify-end gap-2 sm:ml-auto sm:w-auto">
          {asOf && !shownPartial && <span className="text-xs text-gray-400 tabular-nums">{formatKstClock(asOf, true)} 기준</span>}
          <button
            onClick={() => onOpen('hub')}
            className="inline-flex h-7 items-center gap-0.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-600 transition-colors hover:border-violet-200 hover:text-violet-700"
          >
            {asOf && !chips.length && !shownPartial ? '자동화 시작하기' : '자동화 전체 보기'}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {!asOf ? (
        // 첫 읽기 전 = 칸 한 줄 높이를 정적으로 잡는다(아래 카드가 밀려 내려가지 않게 · 깜빡임 없음)
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2" aria-hidden>
          <div className="h-[86px] rounded-xl border border-gray-100 bg-gray-50/70" />
          <div className="hidden h-[86px] rounded-xl border border-gray-100 bg-gray-50/70 sm:block" />
        </div>
      ) : chips.length ? (
        <div className={`mt-3 grid grid-cols-1 gap-2.5 ${cols}`}>{chips}</div>
      ) : (
        // 빈 띠도 자리표시와 같은 높이 — 읽기가 끝나는 순간 아래 카드가 위로 뛰지 않는다
        <div className="mt-3 flex min-h-[86px] items-center rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-4 text-xs text-gray-500">
          {shownPartial ? '잠시 뒤 다시 확인해요.' : '여정이나 자동 마케팅을 켜면 지금 무엇이 돌고 있는지 여기에 보여요.'}
        </div>
      )}

      <div className="mt-2.5 text-[10px] italic text-gray-400">Data source: 자동 마케팅 · 여정 · 발송 진행 · 예약 캠페인 · 1분마다 다시 확인</div>
    </section>
  );
}

/** 칸 껍데기 — 들어오기 여부는 처음 붙을 때 한 번 정한다(뒤에 클래스가 붙어 다시 도는 일이 없게) */
function Shell({ enter, onClick, tone = 'gray', children }: {
  enter: boolean;
  onClick?: () => void;
  tone?: 'gray' | 'emerald' | 'rose' | 'amber';
  children: ReactNode;
}) {
  const [animate] = useState(enter);
  const toneCls = {
    gray: 'border-gray-100 bg-gray-50/70',
    emerald: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50/60',
    rose: 'border-rose-200 bg-rose-50/70',
    amber: 'border-amber-200 bg-amber-50/70',
  }[tone];
  // 늘 같은 button 이다 — 발송 중(누를 곳 없음) → 끝(발송결과로) 으로 바뀔 때 요소가 갈아 끼워지면 들어오기가 다시 돌고 막대가 차오르지 않는다
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`min-w-0 rounded-xl border p-3 text-left ${toneCls} ${animate ? CHIP_IN : ''} ${onClick ? 'transition-colors hover:border-violet-200 hover:bg-white' : 'cursor-default'}`}
    >
      {children}
    </button>
  );
}

function ChipHead({ dot, icon, label }: { dot: ReactNode; icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
      {dot}
      <span className="text-gray-400">{icon}</span>
      <span className="truncate">{label}</span>
    </div>
  );
}

/** 칸 안 점 = 정지 색 점(퍼지는 고리 없음) */
function Dot({ tone }: { tone: 'emerald' | 'violet' | 'rose' | 'amber' | 'gray' }) {
  const c = { emerald: 'bg-emerald-500', violet: 'bg-violet-500', rose: 'bg-rose-500', amber: 'bg-amber-500', gray: 'bg-gray-300' }[tone];
  return <span className={`inline-flex h-2 w-2 shrink-0 rounded-full ${c}`} />;
}

/** 머리 점 — 지금 켜진 것이 있을 때만 고리가 퍼진다. 움직임 줄이기 = 정지 */
function HeadDot({ live, muted }: { live: boolean; muted: boolean }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {live && <span className="absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75 motion-safe:animate-ping" />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${muted ? 'bg-gray-300' : live ? 'bg-violet-500' : 'bg-gray-300'}`} />
    </span>
  );
}
