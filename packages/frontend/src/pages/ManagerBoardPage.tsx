/**
 * ManagerBoardPage — 담당자 상황판(로그인 없음 · 읽기 전용 · ★ 2026-11-02 엔진 재설계 E5 · 설계서 docs/2026-11-01-journey-automarketing-engine-design.md)
 *
 *   - 주소 = /manager-board#t=토큰(주간 요약 문자) · API = GET /api/manager-board/view · 토큰은 헤더(X-Manager-Board-Token)로만
 *   - 메뉴 = 한눈에 · 여정 · 자동마케팅 · 플래너 · 한눈에 = 판정 문장 + 숫자 + 할 일(이유 + 처리하러 가기) + 오늘 나갈 칸([멈추기])
 *   - 바꾸는 일은 여기서 하지 않는다 = [멈추기]는 정지 화면(확인 창 있음) · 나머지는 로그인 화면으로
 *
 * ⛔ native dialog 0 · 줄표 0 · 모델명 0 · 출처 줄 0(고객 화면).
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, LayoutDashboard, PauseCircle, Route, Sparkles } from 'lucide-react';
import { useApproveToken } from '../hooks/useApproveToken';
import { LinkShell, LinkLoading, LinkInvalid, LinkNotice } from '../components/link/LinkShell';
import { stepChannelLabel } from '../utils/journey-labels';

type StepCheck = 'passed' | 'unverified' | 'held' | 'waiting' | 'none';
interface Todo { kind: string; title: string; reason: string; action: { label: string; href: string } | null }
interface Board {
  companyName: string;
  scope: 'company' | 'mine';
  verdict: { tone: 'ok' | 'warn'; sentence: string };
  numbers: { activeJourneys: number; activeOperators: number; sent7d: number; successRate: number | null };
  todos: Todo[];
  today: Array<{ journeyId: string; journeyName: string; stepOrder: number; channel: string; count: number; firstAt: string; pauseUrl: string | null }>;
  journeys: Array<{ id: string; name: string; status: string; pauseReason: string | null; sent7d: number; steps: Array<{ order: number; channel: string; check: StepCheck; checkedAt: string | null }> }>;
  operators: Array<{ id: string; name: string; status: string; nextRunAt: string | null; reviewCount: number; lastSentAt: string | null; lastRecipients: number | null }>;
  planner: Array<{ id: string; title: string; startsOn: string; endsOn: string }>;
  more?: { journeys: number; operators: number };
}

const TABS = [
  { key: 'home', label: '한눈에', icon: LayoutDashboard },
  { key: 'journeys', label: '여정', icon: Route },
  { key: 'operators', label: '자동마케팅', icon: Sparkles },
  { key: 'planner', label: '플래너', icon: CalendarClock },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const CHECK_LABEL: Record<StepCheck, { text: string; cls: string }> = {
  passed: { text: '검사 통과', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  unverified: { text: '확인 못 함', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  held: { text: '보류', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  waiting: { text: '검사 기다림', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  none: { text: '검사 없음', cls: 'bg-white text-slate-400 border-slate-200' },
};
const OP_STATUS: Record<string, string> = { active: '운영 중', paused: '멈춤', paused_no_credit: '크레딧 부족으로 멈춤', draft: '준비 중' };

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const hm = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
const day = (d: string) => { const [, m, dd] = d.split('-').map(Number); return `${m}월 ${dd}일`; };
const channelLabel = (c: string) => stepChannelLabel(c);   // 채널 이름 = 주인 표 한 곳(R1)

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[11.5px] text-slate-500">{label}</p>
      <p className="mt-0.5 text-[17px] font-bold tracking-[-0.02em] text-slate-900">{value}</p>
    </div>
  );
}

function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
        <h2 className="text-[14px] font-semibold text-slate-900">{title}</h2>
        {right}
      </div>
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
}

const Empty = ({ text }: { text: string }) => <p className="text-[13px] text-slate-400 py-2">{text}</p>;

export default function ManagerBoardPage() {
  const token = useApproveToken();
  const [board, setBoard] = useState<Board | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'invalid' | 'error'>('loading');
  const [tab, setTab] = useState<TabKey>('home');

  useEffect(() => {
    if (!token) { setPhase('invalid'); return; }
    let alive = true;
    fetch('/api/manager-board/view', { headers: { 'X-Manager-Board-Token': token } })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        if (r.status === 404) { setPhase('invalid'); return; }
        if (!r.ok || !d?.success) { setPhase('error'); return; }
        setBoard(d as Board);
        setPhase('ready');
      })
      .catch(() => { if (alive) setPhase('error'); });
    return () => { alive = false; };
  }, [token]);

  const subtitle = board ? `${board.companyName}${board.scope === 'mine' ? ' · 내가 만든 것' : ' · 회사 전체'}` : '여정 · 자동마케팅 · 플래너';

  return (
    <LinkShell title="담당자 상황판" subtitle={subtitle} icon={LayoutDashboard} service="한줄로 담당자 상황판">
      {phase === 'loading' && <LinkLoading />}
      {phase === 'invalid' && <LinkInvalid title="주소가 맞지 않거나 기간이 지났어요" body="가장 최근에 받으신 주간 요약 문자의 주소로 다시 열어 주세요." />}
      {phase === 'error' && <LinkInvalid title="상황판을 불러오지 못했어요" body="잠시 후 다시 열어 주세요." />}
      {phase === 'ready' && board && (
        <div className="space-y-4">
          <nav className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1" aria-label="상황판 메뉴">
            {TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                className={`flex flex-col items-center gap-0.5 rounded-lg py-2 text-[12px] font-medium transition ${tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                <t.icon className="w-4 h-4" strokeWidth={2} />
                {t.label}
              </button>
            ))}
          </nav>

          {tab === 'home' && (
            <>
              <LinkNotice tone={board.verdict.tone === 'ok' ? 'emerald' : 'amber'} icon={board.verdict.tone === 'ok' ? CheckCircle2 : AlertTriangle}>
                <b>{board.verdict.sentence}</b>
              </LinkNotice>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="켜진 여정" value={`${board.numbers.activeJourneys}개`} />
                <Stat label="운영 중 자동마케팅" value={`${board.numbers.activeOperators}개`} />
                <Stat label="지난 7일 보낸 수" value={`${board.numbers.sent7d.toLocaleString('ko-KR')}건`} />
                <Stat label="지난 7일 성공률" value={board.numbers.successRate == null ? '결과 전' : `${board.numbers.successRate}%`} />
              </div>
              <Card title={`할 일 ${board.todos.length}건`}>
                {board.todos.length === 0 ? <Empty text="지금 확인할 일이 없어요." /> : (
                  <ul className="divide-y divide-slate-100">
                    {board.todos.map((t, i) => (
                      <li key={i} className="py-3">
                        <p className="text-[13.5px] font-semibold text-slate-900">{t.title}</p>
                        <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">{t.reason}</p>
                        {t.action && (
                          <a href={t.action.href} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-indigo-700">
                            {t.action.label}<ChevronRight className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {board.todos.some((t) => t.action) && <p className="mt-2 text-[11.5px] text-slate-400">처리하러 가기는 로그인한 뒤 그 화면에서 이어서 할 수 있어요.</p>}
              </Card>
              <Card title="오늘 나갈 칸">
                {board.today.length === 0 ? <Empty text="오늘 나갈 여정 칸이 없어요." /> : (
                  <ul className="divide-y divide-slate-100">
                    {board.today.map((t) => (
                      <li key={`${t.journeyId}-${t.stepOrder}`} className="py-3 flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13.5px] font-semibold text-slate-900 truncate">{t.journeyName} {t.stepOrder}번 칸</p>
                          <p className="text-[12px] text-slate-500">{channelLabel(t.channel)} · {t.count.toLocaleString('ko-KR')}명 · {hm(t.firstAt)}부터</p>
                        </div>
                        {t.pauseUrl && (
                          <a href={t.pauseUrl} className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-semibold text-slate-700">
                            <PauseCircle className="w-3.5 h-3.5" />멈추기
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {board.today.some((t) => t.pauseUrl) && <p className="mt-2 text-[11.5px] text-slate-400">멈추기를 누르면 확인 화면이 한 번 더 열려요. 그 칸의 오늘 발송만 멈춰요.</p>}
              </Card>
            </>
          )}

          {tab === 'journeys' && (
            <Card title={`여정 ${board.journeys.length}개`}>
              {board.journeys.length === 0 ? <Empty text="켜졌거나 멈춘 여정이 없어요." /> : (
                <ul className="divide-y divide-slate-100">
                  {board.journeys.map((j) => (
                    <li key={j.id} className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[13.5px] font-semibold text-slate-900 truncate">{j.name}</p>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${j.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>{j.status === 'active' ? '켜짐' : '멈춤'}</span>
                      </div>
                      {j.pauseReason && <p className="mt-1 text-[12.5px] text-slate-600">{j.pauseReason}</p>}
                      <p className="mt-1 text-[12px] text-slate-500">지난 7일 {j.sent7d.toLocaleString('ko-KR')}건 보냄</p>
                      {j.steps.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {j.steps.map((s) => (
                            <span key={s.order} className={`rounded-md border px-1.5 py-0.5 text-[11px] ${CHECK_LABEL[s.check].cls}`} title={s.checkedAt ? `마지막 검사 ${time(s.checkedAt)}` : undefined}>
                              {s.order}번 {channelLabel(s.channel)} · {CHECK_LABEL[s.check].text}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {(board.more?.journeys || 0) > 0 && <p className="mt-2 text-[12px] text-slate-500">이 밖에 여정 {board.more!.journeys}개가 더 있어요. 할 일과 숫자에는 모두 들어 있어요.</p>}
              <p className="mt-2 text-[11.5px] text-slate-400">문자 칸은 문안을 고칠 때와 일주일에 한 번 스팸 검사를 해요. 보류된 칸만 멈추고 여정의 다른 칸은 그대로 나가요.</p>
            </Card>
          )}

          {tab === 'operators' && (
            <Card title={`자동마케팅 ${board.operators.length}개`}>
              {board.operators.length === 0 ? <Empty text="자동마케팅이 없어요." /> : (
                <ul className="divide-y divide-slate-100">
                  {board.operators.map((o) => (
                    <li key={o.id} className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[13.5px] font-semibold text-slate-900 truncate">{o.name}</p>
                        <span className="shrink-0 text-[11.5px] font-semibold text-slate-600">{OP_STATUS[o.status] || o.status}</span>
                      </div>
                      <p className="mt-1 text-[12px] text-slate-500">
                        {o.nextRunAt ? `다음 제안 ${time(o.nextRunAt)}` : '다음 제안 시각 없음'}
                        {o.lastSentAt ? ` · 마지막 발송 ${time(o.lastSentAt)}${o.lastRecipients != null ? `(${o.lastRecipients.toLocaleString('ko-KR')}명)` : ''}` : ''}
                      </p>
                      {o.reviewCount > 0 && <p className="mt-1 text-[12.5px] font-semibold text-amber-800">승인을 기다리는 제안 {o.reviewCount}건</p>}
                    </li>
                  ))}
                </ul>
              )}
              {(board.more?.operators || 0) > 0 && <p className="mt-2 text-[12px] text-slate-500">이 밖에 자동마케팅 {board.more!.operators}개가 더 있어요. 할 일에는 모두 들어 있어요.</p>}
            </Card>
          )}

          {tab === 'planner' && (
            <Card title={`확인을 기다리는 행사 ${board.planner.length}건`}>
              {board.planner.length === 0 ? <Empty text="확인을 기다리는 플래너 행사가 없어요." /> : (
                <ul className="divide-y divide-slate-100">
                  {board.planner.map((e) => (
                    <li key={e.id} className="py-3">
                      <p className="text-[13.5px] font-semibold text-slate-900">{e.title}</p>
                      <p className="mt-1 text-[12px] text-slate-500">{day(e.startsOn)} ~ {day(e.endsOn)} · 확인하고 승인해야 나가요</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      )}
    </LinkShell>
  );
}
