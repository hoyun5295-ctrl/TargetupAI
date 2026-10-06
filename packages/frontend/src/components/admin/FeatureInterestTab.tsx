/**
 * FeatureInterestTab — 기능 관심 업체 (★ 2026-10-06 · Harold 명시 · ceo 전용)
 *
 * AI Operator 에서 기능 안내 창(예시 영상 · 상세 설명)을 연 회사와 거기서 「요금제 보기」를 누른 회사.
 * 요금제를 아직 쓰지 않는 회사가 어떤 기능에 끌리는지 본다. 설계 = docs/2026-10-06-plan-feature-video-modal-design.md §10.
 * 집계 = 서버(utils/feature-interest.ts · 원천 audit_logs). 이 화면은 받은 값을 그린다.
 * 노출 게이팅은 부모(AdminDashboard)가 /api/admin/feature-interest/access 로 한다 — 점검 사용 현황과 같은 규약.
 * 톤 = 부모 화면(슈퍼관리자 라이트) · 강조색 = AI · 콘텐츠 그룹색(cyan).
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { PLAN_FEATURE_INTROS, findPlanFeatureIntro } from '../../constants/plan-feature-intros';

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

export default function FeatureInterestTab() {
  const [period, setPeriod] = useState<Period>('7d');
  const [featureId, setFeatureId] = useState('all');
  const [plan, setPlan] = useState<PlanFilter>('all');
  const [data, setData] = useState<InterestData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
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
    } catch (e: any) {
      if (mySeq !== seq.current) return;
      setError(e?.message || '기능 관심 업체를 불러오지 못했습니다.');
      setData(null);
    } finally {
      if (mySeq === seq.current) setLoading(false);
    }
  }, [period, plan, featureId]);

  useEffect(() => { void load(); }, [load]);

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
          <div className="px-4 py-3 text-sm font-semibold border-b">업체별 · 마지막 본 순 <span className="text-xs text-gray-400 font-normal">· 줄을 누르면 시간순 기록</span></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left font-medium px-3 py-2">회사</th>
                  <th className="text-left font-medium px-3 py-2">요금제</th>
                  <th className="text-left font-medium px-3 py-2">본 기능(횟수)</th>
                  <th className="text-left font-medium px-3 py-2 whitespace-nowrap">요금제 보기</th>
                  <th className="text-left font-medium px-3 py-2">마지막</th>
                  <th className="text-left font-medium px-3 py-2">본 사람</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">불러오는 중</td></tr>}
                {data && data.companies.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">이 조건에 맞는 회사가 없습니다</td></tr>}
                {(data?.companies || []).map((c) => (
                  <Fragment key={c.companyId}>
                    <tr className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer align-top" onClick={() => setOpenRow(openRow === c.companyId ? null : c.companyId)}>
                      <td className="px-3 py-2.5 font-medium">{c.companyName}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${c.subscribed ? 'bg-gray-100 text-gray-600' : 'bg-amber-50 text-amber-700'}`}>{c.subscribed ? c.planName : '미가입'}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        {c.features.map((f) => (
                          <span key={f.featureId} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-800 mr-1 mb-1">
                            {featureName(f.featureId)}<b className="tabular-nums">{f.opens}</b>
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {c.pricingClicks > 0 ? <b className="text-emerald-700">{c.pricingClicks}회</b> : <span className="text-gray-400">없음</span>}
                        {c.goClicks > 0 && <div className="text-[11px] text-violet-700">바로가기 {c.goClicks}회</div>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{fmt(c.lastAt)}</td>
                      <td className="px-3 py-2.5 text-xs">
                        {c.users.slice(0, 2).map((u) => <div key={u.loginId}>{u.name || '이름 없음'} <span className="text-gray-400">{u.loginId}</span></div>)}
                        {c.users.length > 2 && <div className="text-gray-400">외 {c.users.length - 2}명</div>}
                      </td>
                    </tr>
                    {openRow === c.companyId && (
                      <tr className="bg-gray-50/60">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="text-xs font-semibold text-gray-600 mb-1.5">{c.companyName} · 시간순 기록(최근 {c.events.length}건)</div>
                          <ul className="text-xs divide-y divide-dashed divide-gray-200">
                            {c.events.map((e, i) => (
                              <li key={`${e.at}-${i}`} className="grid grid-cols-[110px_96px_1fr] gap-2 py-1.5">
                                <span className="tabular-nums text-gray-500">{fmt(e.at)}</span>
                                <span className={e.event === 'pricing' ? 'font-semibold text-emerald-700' : e.event === 'go' ? 'font-semibold text-violet-700' : 'font-medium text-gray-700'}>{EVENT_LABEL[e.event]}</span>
                                <span className="text-gray-600">{featureName(e.featureId)} · {e.userName || '이름 없음'}</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="px-6 pb-4 text-[10px] italic text-gray-400">Data source: 기능 안내 창 열람 기록(audit_logs) · 요금제 = 지금 기준(고객 화면과 같은 판정) · 기록은 2026-10-06 배포부터</p>
    </div>
  );
}
