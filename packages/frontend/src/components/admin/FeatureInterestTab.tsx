/**
 * FeatureInterestTab — 기능 관심 업체 (★ 2026-10-06 · Harold 명시 · ceo 전용)
 *
 * AI Operator 에서 기능 안내 창(예시 영상 · 상세 설명)을 연 회사와 거기서 「요금제 보기」를 누른 회사.
 * 요금제를 아직 쓰지 않는 회사가 어떤 기능에 끌리는지 본다. 설계 = docs/2026-10-06-plan-feature-video-modal-design.md §10.
 * 집계 = 서버(utils/feature-interest.ts · 원천 audit_logs). 이 화면은 받은 값을 그린다.
 * 노출 게이팅은 부모(AdminDashboard)가 /api/admin/feature-interest/access 로 한다 — 점검 사용 현황과 같은 규약.
 * 톤 = 부모 화면(슈퍼관리자 라이트) · 강조색 = AI · 콘텐츠 그룹색(cyan).
 * ★ 2026-10-07 (Harold · 목업 2안 승인) 업체별 표 = 줄마다 한 줄(회사 · 요금제 · 사람 칸이 세로로 쪼개지던 것) ·
 *   「본 기능」은 한 줄 말줄임 + 마우스를 올리면 전체 목록 · 줄을 누르면 상세 창(펼침 줄 대신).
 *   상세 창 닫기 = X · [닫기] · ESC 만(배경 클릭으로 닫지 않는다 · 자매 = PrecheckUsageDetailModal).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, ChevronRight, X } from 'lucide-react';
import { PLAN_FEATURE_INTROS, findPlanFeatureIntro } from '../../constants/plan-feature-intros';
import ListPager, { pageSlice } from '../shared/ListPager';   // ★ 2026-10-07 업체 목록 쪽 넘김(20건)

type Period = 'today' | '7d' | 'month' | 'all';
type PlanFilter = 'all' | 'unsubscribed' | 'subscribed';

interface CompanyRow {
  companyId: string;
  companyName: string;
  planName: string;
  subscribed: boolean;
  features: { featureId: string; opens: number }[];
  pricingClicks: number;
  goClicks: number;
  lastAt: string;
  users: { name: string; loginId: string }[];
  events: { at: string; event: 'open' | 'pricing' | 'go'; featureId: string; userName: string }[];
}

interface InterestData {
  summary: { companies: number; opens: number; pricingCompanies: number; unsubscribedCompanies: number };
  features: { featureId: string; companies: number; pricingCompanies: number; goCompanies: number; opens: number }[];
  companies: CompanyRow[];
}

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: '오늘' },
  { key: '7d', label: '최근 7일' },
  { key: 'month', label: '이번 달' },
  { key: 'all', label: '전체' },
];
const PLAN_FILTERS: { key: PlanFilter; label: string }[] = [
  { key: 'all', label: '모든 회사' },
  { key: 'unsubscribed', label: '요금제 미가입만' },
  { key: 'subscribed', label: '요금제 사용 중만' },
];

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
const segBtn = (on: boolean) =>
  `px-3 py-1.5 text-sm transition-colors ${on ? 'bg-cyan-50 text-cyan-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`;
// ★ 2026-10-06 로그인 안내 창(AiOperatorLoginPromo) = 기능 원장 밖 항목 · 「지금 바로가기」(go) 가 다음 행동
const LOGIN_PROMO_ID = 'login-promo';
const featureName = (id: string) => (id === LOGIN_PROMO_ID ? '로그인 안내 창' : findPlanFeatureIntro(id)?.title || id);
const EVENT_LABEL: Record<'open' | 'pricing' | 'go', string> = { open: '안내 창 열람', pricing: '요금제 보기', go: '지금 바로가기' };
const fmt = (iso: string) => new Date(iso).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
const EVENT_CHIP: Record<'open' | 'pricing' | 'go', string> = {
  open: 'bg-gray-100 text-gray-700',
  pricing: 'bg-emerald-50 text-emerald-700',
  go: 'bg-violet-50 text-violet-700',
};
const totalOpens = (c: CompanyRow) => c.features.reduce((t, f) => t + f.opens, 0);
const PlanChip = ({ c }: { c: CompanyRow }) => (
  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${c.subscribed ? 'bg-gray-100 text-gray-600' : 'bg-amber-50 text-amber-700'}`}>
    {c.subscribed ? c.planName : '미가입'}
  </span>
);

/** 업체 상세 창 — 표 응답에 이미 있는 값만 그린다(서버 조회 추가 없음 · 시간순 기록은 서버가 회사당 최근 30건만 준다) */
function CompanyDetailModal({ c, onClose }: { c: CompanyRow; onClose: () => void }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) { e.stopPropagation(); onCloseRef.current(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const opens = totalOpens(c);
  const totalEvents = opens + c.pricingClicks + c.goClicks;
  const maxOpens = Math.max(1, ...c.features.map((f) => f.opens));
  const stats: [string, number, string, string][] = [
    ['안내 창 열람', opens, '회', 'text-gray-900'],
    ['본 기능', c.features.length, '개', 'text-cyan-700'],
    ['요금제 보기', c.pricingClicks, '회', 'text-emerald-600'],
    ['지금 바로가기', c.goClicks, '회', 'text-violet-600'],
  ];

  return (
    <div className="fixed inset-0 z-[70] bg-gray-900/45 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl w-full max-w-[720px] max-h-[88vh] flex flex-col" role="dialog" aria-modal="true" aria-label={`${c.companyName} 기능 관심 상세`}>
        <div className="px-5 py-4 border-b flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-cyan-50">
              <Building2 className="w-4 h-4 text-cyan-700" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-gray-900 flex items-center gap-2">
                <span className="truncate">{c.companyName}</span>
                <PlanChip c={c} />
              </h3>
              <p className="text-[12px] text-gray-500">마지막 본 시각 {fmt(c.lastAt)}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} autoFocus className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 shrink-0" aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {stats.map(([k, v, unit, tone]) => (
              <div key={k} className="rounded-xl bg-gray-50 px-3 py-2.5">
                <div className="text-[11.5px] text-gray-500">{k}</div>
                <div className={`text-xl font-bold tabular-nums ${tone}`}>{v.toLocaleString()}<span className="text-xs text-gray-400 font-semibold">{unit}</span></div>
              </div>
            ))}
          </div>

          <section>
            <h4 className="text-[13px] font-semibold text-gray-700 mb-2">기능별 열람</h4>
            <div className="space-y-2">
              {c.features.map((f) => (
                <div key={f.featureId} className="grid grid-cols-[120px_1fr_44px] gap-2 items-center text-[12.5px]">
                  <span className="truncate" title={featureName(f.featureId)}>{featureName(f.featureId)}</span>
                  <span className="relative h-2 rounded-full bg-gray-100 overflow-hidden">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-cyan-500" style={{ width: `${(f.opens / maxOpens) * 100}%` }} />
                  </span>
                  <span className="text-right text-gray-500 tabular-nums">{f.opens}회</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h4 className="text-[13px] font-semibold text-gray-700 mb-2">본 사람 {c.users.length}명</h4>
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
              {c.users.map((u) => (
                <div key={u.loginId} className="truncate" title={`${u.name || '이름 없음'} ${u.loginId}`}>
                  {u.name || '이름 없음'} <span className="text-xs text-gray-400">{u.loginId}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h4 className="text-[13px] font-semibold text-gray-700 mb-2">
              시간순 기록 · 최근 {c.events.length}건
              {totalEvents > c.events.length && <span className="text-xs text-gray-400 font-normal"> (전체 {totalEvents.toLocaleString()}건 중)</span>}
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <tbody>
                  {c.events.map((e, i) => (
                    <tr key={`${e.at}-${i}`} className="border-t border-dashed border-gray-200">
                      <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums text-gray-500">{fmt(e.at)}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        <span className={`inline-block px-1.5 py-px rounded-md text-[11.5px] font-semibold ${EVENT_CHIP[e.event]}`}>{EVENT_LABEL[e.event]}</span>
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{featureName(e.featureId)}</td>
                      <td className="py-1.5 text-gray-500"><span className="block max-w-[220px] truncate">{e.userName || '이름 없음'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between gap-3 shrink-0">
          <span className="text-[10px] text-gray-400 italic">Data source: 기능 안내 창 열람 기록(audit_logs) · 시간순 기록은 회사당 최근 30건</span>
          <button type="button" onClick={onClose} className="px-3.5 py-1.5 border rounded-lg text-sm bg-white hover:bg-gray-50">닫기</button>
        </div>
      </div>
    </div>
  );
}

export default function FeatureInterestTab() {
  const [period, setPeriod] = useState<Period>('7d');
  const [featureId, setFeatureId] = useState('all');
  const [plan, setPlan] = useState<PlanFilter>('all');
  const [data, setData] = useState<InterestData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<CompanyRow | null>(null);
  const [page, setPage] = useState(1);   // ★ 2026-10-07 업체 목록 쪽 넘김 · 조건을 바꿔 다시 읽으면 1쪽
  // 「본 기능」 말풍선 — 표가 가로 스크롤 상자 안이라 칸 안에 띄우면 잘린다 → 화면 기준(fixed)으로 하나만 띄운다
  const [tip, setTip] = useState<{ left: number; top: number; above: boolean; c: CompanyRow } | null>(null);
  // 늦게 도착한 옛 조건의 응답이 새 조건 화면을 덮지 않게(조건을 빨리 바꿀 때)
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mySeq = ++seq.current;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ period, plan });
      if (featureId !== 'all') params.set('featureId', featureId);
      const r = await fetch(`/api/admin/feature-interest?${params}`, { headers: authHeaders() });
      const d = await r.json();
      if (mySeq !== seq.current) return;
      if (!r.ok || !d?.success) throw new Error(d?.error || '기능 관심 업체를 불러오지 못했습니다.');
      setData(d as InterestData);
      setPage(1);
    } catch (e: any) {
      if (mySeq !== seq.current) return;
      setError(e?.message || '기능 관심 업체를 불러오지 못했습니다.');
      setData(null);
    } finally {
      if (mySeq === seq.current) setLoading(false);
    }
  }, [period, plan, featureId]);

  useEffect(() => { void load(); }, [load]);

  // 말풍선은 화면 기준 자리라 페이지가 움직이면 칸과 어긋난다 — 스크롤하면 닫는다
  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [tip]);

  const s = data?.summary;
  const maxCompanies = Math.max(1, ...(data?.features || []).map((f) => f.companies));

  return (
    <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
      <div className="px-6 py-4 border-b">
        <h2 className="text-lg font-semibold">기능 관심 업체</h2>
        <p className="text-xs text-gray-500 mt-1">AI Operator에서 기능 안내 창(예시 영상 · 상세 설명)을 연 회사와 「요금제 보기」를 누른 회사입니다. 요금제를 아직 쓰지 않는 회사가 어떤 기능에 끌리는지 봅니다</p>
      </div>

      <div className="px-6 py-3 border-b bg-gray-50 flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-500 font-medium">기간</span>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden divide-x divide-gray-200">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" onClick={() => setPeriod(p.key)} className={segBtn(period === p.key)}>{p.label}</button>
          ))}
        </div>
        <span className="text-sm text-gray-500 font-medium">기능</span>
        <select value={featureId} onChange={(e) => setFeatureId(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-cyan-200">
          <option value="all">모든 기능</option>
          <option value={LOGIN_PROMO_ID}>로그인 안내 창</option>
          {PLAN_FEATURE_INTROS.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
        </select>
        <span className="text-sm text-gray-500 font-medium">회사</span>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden divide-x divide-gray-200">
          {PLAN_FILTERS.map((p) => (
            <button key={p.key} type="button" onClick={() => setPlan(p.key)} className={segBtn(plan === p.key)}>{p.label}</button>
          ))}
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="ml-auto px-3 py-1.5 border rounded-lg text-sm bg-white hover:bg-gray-50 disabled:opacity-40">새로고침</button>
      </div>

      {error && <div className="px-6 py-4 text-sm text-rose-600">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 py-5">
        <div className="rounded-xl border border-gray-200/70 p-4">
          <div className="text-xs font-medium text-gray-500">안내 창을 연 회사</div>
          <div className="text-2xl font-bold tracking-tight text-cyan-700 mt-1 tabular-nums">{s ? s.companies.toLocaleString() : '-'}<span className="text-sm text-gray-400 font-semibold">곳</span></div>
        </div>
        <div className="rounded-xl border border-gray-200/70 p-4">
          <div className="text-xs font-medium text-gray-500">안내 창 열람</div>
          <div className="text-2xl font-bold tracking-tight text-gray-900 mt-1 tabular-nums">{s ? s.opens.toLocaleString() : '-'}<span className="text-sm text-gray-400 font-semibold">회</span></div>
        </div>
        <div className="rounded-xl border border-gray-200/70 p-4">
          <div className="text-xs font-medium text-gray-500">「요금제 보기」를 누른 회사</div>
          <div className="text-2xl font-bold tracking-tight text-emerald-600 mt-1 tabular-nums">{s ? s.pricingCompanies.toLocaleString() : '-'}<span className="text-sm text-gray-400 font-semibold">곳</span></div>
        </div>
        <div className="rounded-xl border border-gray-200/70 p-4">
          <div className="text-xs font-medium text-gray-500">그중 요금제 미가입</div>
          <div className="text-2xl font-bold tracking-tight text-amber-600 mt-1 tabular-nums">{s ? s.unsubscribedCompanies.toLocaleString() : '-'}<span className="text-sm text-gray-400 font-semibold">곳</span></div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[320px_minmax(0,1fr)] gap-4 px-6 pb-6">
        <div className="rounded-xl border border-gray-200/70 p-4 self-start">
          <div className="text-sm font-semibold mb-3">기능별 관심</div>
          {data && data.features.length === 0 && <div className="text-sm text-gray-400 py-6 text-center">이 기간에 안내 창을 연 회사가 없습니다</div>}
          <div className="space-y-2">
            {(data?.features || []).map((f) => {
              const next = f.featureId === LOGIN_PROMO_ID ? f.goCompanies : f.pricingCompanies;
              return (
                <div key={f.featureId} className="grid grid-cols-[92px_1fr_64px] gap-2 items-center text-[12.5px]">
                  <span className="truncate" title={featureName(f.featureId)}>{featureName(f.featureId)}</span>
                  <span className="relative h-2 rounded-full bg-gray-100 overflow-hidden">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-cyan-200" style={{ width: `${(f.companies / maxCompanies) * 100}%` }} />
                    <span className="absolute inset-y-0 left-0 rounded-full bg-cyan-600" style={{ width: `${(next / maxCompanies) * 100}%` }} />
                  </span>
                  <span className="text-right text-gray-500 tabular-nums">{f.companies}곳 · {next}</span>
                </div>
              );
            })}
          </div>
          <div className="text-[11px] text-gray-400 mt-3">연한 막대 = 안내 창을 연 회사 · 진한 막대 = 거기서 「요금제 보기」를 누른 회사(로그인 안내 창은 「지금 바로가기」)</div>
        </div>

        <div className="rounded-xl border border-gray-200/70 overflow-hidden">
          <div className="px-4 py-3 text-sm font-semibold border-b">업체별 · 마지막 본 순 <span className="text-xs text-gray-400 font-normal">· 줄을 누르면 상세</span></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left font-medium px-3 py-2 whitespace-nowrap">회사</th>
                  <th className="text-left font-medium px-3 py-2 whitespace-nowrap">요금제</th>
                  <th className="text-left font-medium px-3 py-2 whitespace-nowrap">본 기능</th>
                  <th className="text-right font-medium px-3 py-2 whitespace-nowrap">열람</th>
                  <th className="text-right font-medium px-3 py-2 whitespace-nowrap">요금제 보기</th>
                  <th className="text-right font-medium px-3 py-2 whitespace-nowrap">바로가기</th>
                  <th className="text-left font-medium px-3 py-2 whitespace-nowrap">마지막</th>
                  <th className="text-right font-medium px-3 py-2 whitespace-nowrap">본 사람</th>
                  <th className="w-8" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {loading && !data && <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">불러오는 중</td></tr>}
                {data && data.companies.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">이 조건에 맞는 회사가 없습니다</td></tr>}
                {pageSlice(data?.companies || [], page).map((c) => (
                  <tr
                    key={c.companyId}
                    tabIndex={0}
                    aria-label={`${c.companyName} 상세 보기`}
                    className="group border-t border-gray-100 hover:bg-gray-50 focus:bg-cyan-50/40 focus:outline-none cursor-pointer whitespace-nowrap"
                    onClick={() => { setTip(null); setDetail(c); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTip(null); setDetail(c); } }}
                  >
                    {/* 표 칸의 max-width 는 브라우저마다 듣지 않는다 — 말줄임은 칸 안 상자가 한다 */}
                    <td className="px-3 py-2.5 font-medium"><span className="block max-w-[200px] truncate" title={c.companyName}>{c.companyName}</span></td>
                    <td className="px-3 py-2.5"><PlanChip c={c} /></td>
                    <td className="px-3 py-2.5">
                      <span
                        className="block max-w-[260px] truncate text-cyan-800"
                        onMouseEnter={(e) => {
                          // 화면 오른쪽 · 아래 끝에서는 말풍선이 밖으로 나가지 않게(오른쪽은 당기고 · 아래쪽이면 칸 위에)
                          const r = e.currentTarget.getBoundingClientRect();
                          const above = r.bottom > window.innerHeight - 220;
                          setTip({ left: Math.max(8, Math.min(r.left, window.innerWidth - 336)), top: above ? r.top - 8 : r.bottom + 8, above, c });
                        }}
                        onMouseLeave={() => setTip(null)}
                      >
                        {c.features.map((f, i) => (
                          <span key={f.featureId}>{i > 0 && <span className="text-gray-300"> · </span>}{featureName(f.featureId)} <b className="tabular-nums text-cyan-700">{f.opens}</b></span>
                        ))}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{totalOpens(c).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {c.pricingClicks > 0 ? <b className="text-emerald-700">{c.pricingClicks}회</b> : <span className="text-gray-400">없음</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {c.goClicks > 0 ? <b className="text-violet-700">{c.goClicks}회</b> : <span className="text-gray-400">없음</span>}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{fmt(c.lastAt)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums" title={c.users.map((u) => u.name || u.loginId).join(', ')}>{c.users.length}명</td>
                    <td className="pr-3 text-gray-300 group-hover:text-cyan-600"><ChevronRight className="w-4 h-4" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ListPager page={page} total={data?.companies.length || 0} onPage={(p) => { setTip(null); setPage(p); }} />
        </div>
      </div>

      {tip && (
        <div className="fixed z-[60] min-w-[220px] max-w-[320px] rounded-xl bg-gray-900 text-white px-3 py-2.5 text-[12.5px] shadow-xl pointer-events-none" style={{ left: tip.left, top: tip.top, transform: tip.above ? 'translateY(-100%)' : undefined }} role="tooltip">
          {tip.c.features.map((f) => (
            <div key={f.featureId} className="flex justify-between gap-4 py-0.5">
              <span className="truncate">{featureName(f.featureId)}</span>
              <span className="font-bold text-cyan-200 tabular-nums">{f.opens}회</span>
            </div>
          ))}
          <div className="mt-1.5 pt-1.5 border-t border-white/15 text-[11.5px] text-gray-400">누르면 상세 창</div>
        </div>
      )}
      {detail && <CompanyDetailModal c={detail} onClose={() => setDetail(null)} />}

      <p className="px-6 pb-4 text-[10px] italic text-gray-400">Data source: 기능 안내 창 열람 기록(audit_logs) · 요금제 = 지금 기준(고객 화면과 같은 판정) · 기록은 2026-10-06 배포부터</p>
    </div>
  );
}
