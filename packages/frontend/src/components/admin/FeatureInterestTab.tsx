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
 * ★ 2026-11-16 C138 (Harold 「다시보지않기 누른 회사도 체크 · 전부 한눈에 · 기능별관심 필요없으니까 필터 · 화면 가로로 풀로 해서 짤리는거 없도록」)
 *   = 이 탭만 화면 가로를 다 쓴다(FULL_BLEED · CSS 만) · 「기능별 관심」 칸과 따로 있던 무료체험 표를 없애고 업체 표 하나에 모은다(무료체험 · 다시 보지 않기 칸) ·
 *     걸러 보기 = 보기(본 회사 · 무료체험 신청 · 다시 보지 않기) + 기능 단추(회사 수) · 표 칸은 자르지 않는다(말줄임 · 말풍선 없음 · 본 기능은 칸 안에서 줄을 바꾼다).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, ChevronRight, X } from 'lucide-react';
import { usePlanFeatureIntros } from '../../constants/plan-feature-intros'; // ★ 2026-10-07 원장 = 서버(로그인한 사람에게만)
import ListPager, { pageSlice } from '../shared/ListPager';   // ★ 2026-10-07 업체 목록 쪽 넘김(20건)
import { ADMIN_TABLE_ONELINE } from './ui/admin-ui'; // ★ 2026-10-20 표 칸 한 줄
import { loginPopupOf } from '../../constants/login-popups';   // ★ 2026-11-15 C135 로그인 뒤 안내 창 등록부(창 이름 · 주 버튼 이름)
import { normalizeInterest, visibleInterestRows, featureCounts, groupDismissed, dismissedPopupName, type InterestView } from '../../utils/feature-interest-view';   // ★ 2026-11-16 C138 걸러 보기 판정(순수)

type Period = 'today' | '7d' | 'month' | 'all';
type PlanFilter = 'all' | 'unsubscribed' | 'subscribed';
/** ★ C138 보기 — 본 회사(이 기간에 안내 창 · 기능을 본 회사) · 무료체험을 신청한 회사 · 「다시 보지 않기」를 누른 회사(뒤 둘은 기간과 무관하게 전부) */
type ViewFilter = InterestView;

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
  /** ★ C138 이 기간에 본 기록이 있는가 · 무료체험 신청 · 「다시 보지 않기」 기록(서버 utils/feature-interest.ts) */
  seen: boolean;
  trial: { requestedBy: string; requestedAt: string; used: number; granted: number } | null;
  dismissed: { introKey: string; at: string; userName: string; loginId: string }[];
}

interface InterestData {
  companies: CompanyRow[];
  /** ★ C138 무료체험 신청 · 「다시 보지 않기」 목록을 읽었는가(false = 그 칸 · 그 보기의 수는 알 수 없음 · 「없음」 · 0 이라 쓰지 않는다) */
  trialsKnown: boolean;
  dismissalsKnown: boolean;
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
// ★ 2026-10-06 로그인 뒤 안내 창 = 기능 원장 밖 항목 · 그 창의 주 버튼(go)이 다음 행동
// ★ 2026-11-15 C135 창의 이름 · 주 버튼 이름 = 등록부(constants/login-popups.ts) — 새 안내 창을 올리면 여기 손대지 않아도 탭에 나온다
/** 기능 id → 이름 — 원장을 받으면 채운다(받기 전엔 id 그대로) */
let FEATURE_TITLES = new Map<string, string>();
const featureName = (id: string) => loginPopupOf(id)?.name || FEATURE_TITLES.get(id) || id;
const EVENT_LABEL: Record<'open' | 'pricing' | 'go', string> = { open: '안내 창 열람', pricing: '요금제 보기', go: '지금 바로가기' };
/** 기록 한 줄의 행동 이름 — 안내 창의 go 는 그 창의 주 버튼 이름으로 */
const eventLabel = (e: { event: 'open' | 'pricing' | 'go'; featureId: string }) => (e.event === 'go' ? loginPopupOf(e.featureId)?.goLabel || EVENT_LABEL.go : EVENT_LABEL[e.event]);
const fmt = (iso: string) => new Date(iso).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
const EVENT_CHIP: Record<'open' | 'pricing' | 'go', string> = {
  open: 'bg-gray-100 text-gray-700',
  pricing: 'bg-emerald-50 text-emerald-700',
  go: 'bg-violet-50 text-violet-700',
};
const totalOpens = (c: CompanyRow) => c.features.reduce((t, f) => t + f.opens, 0);
/** 무료체험 상태 글 · 색 */
const trialState = (t: NonNullable<CompanyRow['trial']>) => (t.used >= t.granted ? { text: '다 씀', tone: 'bg-emerald-50 text-emerald-700' } : t.used > 0 ? { text: '쓰는 중', tone: 'bg-cyan-50 text-cyan-700' } : { text: '아직 안 씀', tone: 'bg-gray-100 text-gray-600' });
/**
 * 이 탭만 화면 가로를 다 쓴다 — 부모 틀(관리자 화면 본문 = pages/AdminDashboard.tsx <main>)은 1280px 로 묶여 가운데 정렬돼 있다.
 *   가운데 정렬된 틀 안에서는 「왼쪽 여백 = 50% - 50vw + 24px · 폭 = 100vw - 48px」이 화면 양 끝에서 같은 여백을 남긴다(틀의 폭 · 안쪽 여백과 무관).
 *   세로 줄바가 있으면 여백이 줄바 폭의 절반만큼 줄 뿐 넘치지 않는다. 1280px 미만 화면은 부모 폭이 곧 화면 폭이라 그대로 둔다(xl 부터 적용).
 */
const FULL_BLEED = 'xl:w-[calc(100vw_-_48px)] xl:ml-[calc(50%_-_50vw_+_24px)]';
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
              <p className="text-[12px] text-gray-500">{c.seen ? `마지막 본 시각 ${fmt(c.lastAt)}` : '이 기간에 본 기록 없음'}</p>
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

          {(c.trial || c.dismissed.length > 0) && (
            <section className="grid sm:grid-cols-2 gap-3">
              {c.trial && (
                <div className="rounded-xl border border-gray-200/70 px-3.5 py-3">
                  <h4 className="text-[13px] font-semibold text-gray-700">이미지 스튜디오 무료체험</h4>
                  <p className="mt-1.5 text-[13px] text-gray-600">신청 {fmt(c.trial.requestedAt)} · {c.trial.requestedBy || '이름 없음'}</p>
                  <p className="mt-1 text-[13px]"><b className="tabular-nums">{c.trial.used}</b><span className="text-gray-400"> / {c.trial.granted}장</span> <span className={`ml-1 inline-flex px-2 py-0.5 rounded-full text-xs ${trialState(c.trial).tone}`}>{trialState(c.trial).text}</span></p>
                </div>
              )}
              {c.dismissed.length > 0 && (
                <div className="rounded-xl border border-rose-200/70 bg-rose-50/40 px-3.5 py-3">
                  <h4 className="text-[13px] font-semibold text-gray-700">「다시 보지 않기」를 누름 {c.dismissed.length}건</h4>
                  <ul className="mt-1.5 space-y-1 text-[13px] text-gray-600">
                    {c.dismissed.map((d) => (
                      <li key={`${d.introKey}-${d.loginId}`}>{dismissedPopupName(d.introKey)} · {d.userName || d.loginId || '이름 없음'} · <span className="tabular-nums">{fmt(d.at)}</span></li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

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
              <table className={`w-full text-[13px] ${ADMIN_TABLE_ONELINE}`}>
                <tbody>
                  {c.events.map((e, i) => (
                    <tr key={`${e.at}-${i}`} className="border-t border-dashed border-gray-200">
                      <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums text-gray-500">{fmt(e.at)}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        <span className={`inline-block px-1.5 py-px rounded-md text-[11.5px] font-semibold ${EVENT_CHIP[e.event]}`}>{eventLabel(e)}</span>
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
          <span className="text-[10px] text-gray-400 italic">시간순 기록은 회사당 최근 30건</span>
          <button type="button" onClick={onClose} className="px-3.5 py-1.5 border rounded-lg text-sm bg-white hover:bg-gray-50">닫기</button>
        </div>
      </div>
    </div>
  );
}

export default function FeatureInterestTab() {
  const intros = usePlanFeatureIntros();
  if (intros && FEATURE_TITLES.size === 0) FEATURE_TITLES = new Map(intros.intros.map((f) => [f.id, f.title]));
  const [period, setPeriod] = useState<Period>('7d');
  const [plan, setPlan] = useState<PlanFilter>('all');
  // ★ C138 보기 · 기능 = 화면에서 건다(받아 둔 줄을 거른다 · 다시 읽지 않는다)
  const [view, setView] = useState<ViewFilter>('seen');
  const [featureId, setFeatureId] = useState('all');
  const [data, setData] = useState<InterestData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<CompanyRow | null>(null);
  const [page, setPage] = useState(1);   // ★ 2026-10-07 업체 목록 쪽 넘김 · 조건을 바꾸면 1쪽
  // 늦게 도착한 옛 조건의 응답이 새 조건 화면을 덮지 않게(조건을 빨리 바꿀 때)
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mySeq = ++seq.current;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ period, plan });
      const r = await fetch(`/api/admin/feature-interest?${params}`, { headers: authHeaders() });
      const d = await r.json();
      if (mySeq !== seq.current) return;
      if (!r.ok || !d?.success) throw new Error(d?.error || '기능 관심 업체를 불러오지 못했습니다.');
      setData(normalizeInterest<CompanyRow>(d));   // 받는 자리 한 곳에서 꼴을 맞춘다(없는 칸 = 모름 · 빈 값)
      setPage(1);
    } catch (e: any) {
      if (mySeq !== seq.current) return;
      setError(e?.message || '기능 관심 업체를 불러오지 못했습니다.');
      setData(null);
    } finally {
      if (mySeq === seq.current) setLoading(false);
    }
  }, [period, plan]);

  useEffect(() => { void load(); }, [load]);

  const all = useMemo(() => data?.companies || [], [data]);
  const rows = useMemo(() => visibleInterestRows(all, view, featureId), [all, view, featureId]);
  // 기능 단추 = 지금 보기의 줄에서 센 회사 수(서버가 따로 세지 않는다)
  const features = useMemo(() => featureCounts(all, view), [all, view]);
  const counts = useMemo(() => ({ seen: all.filter((c) => c.seen).length, trial: all.filter((c) => c.trial).length, dismissed: all.filter((c) => c.dismissed.length > 0).length }), [all]);
  // 요약 = 지금 보이는 줄에서 센다(걸러 보기와 숫자가 어긋나지 않게)
  const summary = useMemo(() => ({
    companies: rows.filter((c) => c.seen).length,
    opens: rows.reduce((t, c) => t + totalOpens(c), 0),
    pricingCompanies: rows.filter((c) => c.pricingClicks > 0).length,
    unsubscribedCompanies: rows.filter((c) => !c.subscribed).length,
  }), [rows]);

  // known = 그 목록을 읽었는가 — 못 읽었으면 단추의 수는 0 이 아니라 「?」 · 그 보기를 고르면 수 · 표 대신 「읽지 못했습니다」 하나만 그린다
  const VIEWS: { key: ViewFilter; label: string; n: number; known: boolean }[] = [
    { key: 'seen', label: '본 회사', n: counts.seen, known: true },
    { key: 'trial', label: '무료체험 신청', n: counts.trial, known: data?.trialsKnown !== false },
    { key: 'dismissed', label: '다시 보지 않기', n: counts.dismissed, known: data?.dismissalsKnown !== false },
  ];
  const viewUnknown = !VIEWS.find((v) => v.key === view)!.known;
  const chip = (on: boolean) => `inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[13px] whitespace-nowrap transition-colors ${on ? 'border-cyan-600 bg-cyan-600 text-white font-semibold' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`;
  const cards: [string, number, string, string][] = [
    ['안내 창을 연 회사', summary.companies, '곳', 'text-cyan-700'],
    ['안내 창 열람', summary.opens, '회', 'text-gray-900'],
    ['「요금제 보기」를 누른 회사', summary.pricingCompanies, '곳', 'text-emerald-600'],
    ['그중 요금제 미가입', summary.unsubscribedCompanies, '곳', 'text-amber-600'],
  ];

  return (
    <div className={`bg-white rounded-2xl border border-gray-200/70 shadow-sm ${FULL_BLEED}`}>
      <div className="px-6 py-4 border-b">
        <h2 className="text-lg font-semibold">기능 관심 업체</h2>
        <p className="text-xs text-gray-500 mt-1">로그인 뒤 안내 창과 기능 안내 창을 연 회사, 거기서 누른 버튼, 이미지 스튜디오 무료체험 신청, 안내 창의 「다시 보지 않기」를 회사 한 줄에 모아 봅니다</p>
      </div>

      <div className="px-6 py-3 border-b bg-gray-50 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm text-gray-500 font-medium">보기</span>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden divide-x divide-gray-200" role="group" aria-label="보기">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => { setView(v.key); setPage(1); }} className={segBtn(view === v.key)}>
              {v.label} <b className="tabular-nums">{!data ? '-' : v.known ? v.n.toLocaleString() : '?'}</b>
            </button>
          ))}
        </div>
        <span className="text-sm text-gray-500 font-medium">기간</span>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden divide-x divide-gray-200" role="group" aria-label="기간">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" aria-pressed={period === p.key} onClick={() => setPeriod(p.key)} className={segBtn(period === p.key)}>{p.label}</button>
          ))}
        </div>
        <span className="text-sm text-gray-500 font-medium">회사</span>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden divide-x divide-gray-200" role="group" aria-label="회사">
          {PLAN_FILTERS.map((p) => (
            <button key={p.key} type="button" aria-pressed={plan === p.key} onClick={() => setPlan(p.key)} className={segBtn(plan === p.key)}>{p.label}</button>
          ))}
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="ml-auto px-3 py-1.5 border rounded-lg text-sm bg-white hover:bg-gray-50 disabled:opacity-40">새로고침</button>
      </div>

      {error && <div className="px-6 py-4 text-sm text-rose-600">{error}</div>}

      {/* ★ C138 못 읽은 목록의 보기 = 수 · 기능 단추 · 표를 그리지 않는다(못 읽은 것을 0 · 없음으로 보이게 하는 자리 0 · Codex 구현 2R) */}
      {viewUnknown ? (
        <div className="px-6 py-14 text-center" role="status">
          <p className="text-sm font-semibold text-rose-600">이 목록을 읽지 못했습니다</p>
          <p className="mt-1.5 text-xs text-gray-500">수와 회사를 보여 드릴 수 없습니다. 새로고침을 눌러 주세요.</p>
        </div>
      ) : (<>
      {/* ★ C138 기능 걸러 보기 — 옛 「기능별 관심」 칸 대신(회사 수는 단추에 남긴다) · 누르면 그 기능을 본 회사만 */}
      <div className="px-6 py-3 border-b flex flex-wrap items-center gap-2" role="group" aria-label="기능">
        <span className="text-sm text-gray-500 font-medium mr-1">기능</span>
        <button type="button" aria-pressed={featureId === 'all'} onClick={() => { setFeatureId('all'); setPage(1); }} className={chip(featureId === 'all')}>전체</button>
        {features.map((f) => (
          <button key={f.featureId} type="button" aria-pressed={featureId === f.featureId} onClick={() => { setFeatureId(f.featureId); setPage(1); }} className={chip(featureId === f.featureId)}>
            {featureName(f.featureId)} <b className="tabular-nums">{f.companies}</b>
          </button>
        ))}
        {featureId !== 'all' && !features.some((f) => f.featureId === featureId) && (
          <button type="button" aria-pressed onClick={() => { setFeatureId('all'); setPage(1); }} className={chip(true)}>{featureName(featureId)} <b className="tabular-nums">0</b></button>
        )}
        {view !== 'seen' && <span className="text-xs text-gray-400">무료체험 신청과 「다시 보지 않기」는 기간과 무관하게 전부입니다</span>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 px-6 py-5">
        {cards.map(([k, v, unit, tone]) => (
          <div key={k} className="rounded-xl border border-gray-200/70 p-4">
            <div className="text-xs font-medium text-gray-500">{k}</div>
            <div className={`text-2xl font-bold tracking-tight mt-1 tabular-nums ${tone}`}>{data ? v.toLocaleString() : '-'}<span className="text-sm text-gray-400 font-semibold">{unit}</span></div>
          </div>
        ))}
      </div>

      <div className="mx-6 mb-6 rounded-xl border border-gray-200/70 overflow-hidden">
        <div className="px-4 py-3 text-sm font-semibold border-b">업체별 <b className="text-cyan-700 tabular-nums">{rows.length.toLocaleString()}곳</b> <span className="text-xs text-gray-400 font-normal">· 최근 순 · 줄을 누르면 상세</span></div>
        <div className="overflow-x-auto">
          <table className={`w-full text-sm ${ADMIN_TABLE_ONELINE}`}>
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left font-medium px-2.5 py-2">회사</th>
                <th className="text-left font-medium px-2.5 py-2">요금제</th>
                <th className="text-left font-medium px-2.5 py-2">본 안내 창 · 기능</th>
                <th className="text-right font-medium px-2.5 py-2">열람</th>
                <th className="text-right font-medium px-2.5 py-2">요금제 보기</th>
                <th className="text-right font-medium px-2.5 py-2">바로가기</th>
                <th className="text-left font-medium px-2.5 py-2">무료체험</th>
                <th className="text-left font-medium px-2.5 py-2">다시 보지 않기</th>
                <th className="text-left font-medium px-2.5 py-2">마지막 본 시각</th>
                <th className="text-right font-medium px-2.5 py-2">본 사람</th>
                <th className="w-8" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {loading && !data && <tr><td colSpan={11} className="px-2.5 py-8 text-center text-gray-400">불러오는 중</td></tr>}
              {data && rows.length === 0 && <tr><td colSpan={11} className="px-2.5 py-8 text-center text-gray-400">이 조건에 맞는 회사가 없습니다</td></tr>}
              {pageSlice(rows, page).map((c) => {
                const dismissed = groupDismissed(c.dismissed);
                const dismissedAt = dismissed.reduce((m, d) => (d.at > m ? d.at : m), '');   // 가장 최근에 누른 시각(받은 순서에 기대지 않는다)
                return (
                  <tr
                    key={c.companyId}
                    tabIndex={0}
                    aria-label={`${c.companyName} 상세 보기`}
                    className="group border-t border-gray-100 hover:bg-gray-50 focus:bg-cyan-50/40 focus:outline-none cursor-pointer align-top"
                    onClick={() => setDetail(c)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetail(c); } }}
                  >
                    <td className="px-2.5 py-2.5 font-medium !whitespace-normal"><span className="block w-max max-w-[180px] 2xl:max-w-[280px] [word-break:keep-all] [overflow-wrap:anywhere]">{c.companyName}</span></td>
                    <td className="px-2.5 py-2.5"><PlanChip c={c} /></td>
                    {/* 자르지 않는다 — 회사명 · 본 기능 · 다시 보지 않기는 길면 그 칸 안에서 줄을 바꾸고, 남는 폭은 본 기능 칸이 받는다(w-full) */}
                    <td className="px-2.5 py-2 !whitespace-normal min-w-[200px] w-full">
                      {c.features.length === 0 ? <span className="text-gray-400">없음</span> : (
                        <span className="flex flex-wrap gap-1">
                          {c.features.map((f) => (
                            <span key={f.featureId} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-50 text-cyan-800 text-[12.5px] whitespace-nowrap">{featureName(f.featureId)} <b className="tabular-nums text-cyan-700">{f.opens}</b></span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums">{totalOpens(c).toLocaleString()}</td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums">
                      {c.pricingClicks > 0 ? <b className="text-emerald-700">{c.pricingClicks}회</b> : <span className="text-gray-400">없음</span>}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums">
                      {c.goClicks > 0 ? <b className="text-violet-700">{c.goClicks}회</b> : <span className="text-gray-400">없음</span>}
                    </td>
                    <td className="px-2.5 py-2.5">
                      {c.trial ? (
                        <span className="inline-flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1.5">
                            <b className="tabular-nums">{c.trial.used}<span className="text-gray-400 font-normal"> / {c.trial.granted}장</span></b>
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${trialState(c.trial).tone}`}>{trialState(c.trial).text}</span>
                          </span>
                          <span className="text-xs tabular-nums text-gray-500">신청 {fmt(c.trial.requestedAt)}{c.trial.requestedBy ? ` · ${c.trial.requestedBy}` : ''}</span>
                        </span>
                      ) : <span className="text-gray-400">{data && !data.trialsKnown ? '알 수 없음' : '없음'}</span>}
                    </td>
                    <td className="px-2.5 py-2">
                      {data && !data.dismissalsKnown ? <span className="text-gray-400">알 수 없음</span>
                        : dismissed.length === 0 ? <span className="text-gray-400">없음</span> : (
                          <span className="inline-flex flex-col items-start gap-1">
                            {dismissed.map((d) => (
                              <span key={d.name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 text-[12.5px] whitespace-nowrap">{d.name} <b className="tabular-nums">{d.users}명</b></span>
                            ))}
                            <span className="text-xs tabular-nums text-gray-500">최근 {fmt(dismissedAt)}</span>
                          </span>
                        )}
                    </td>
                    <td className="px-2.5 py-2.5 tabular-nums">{c.seen ? fmt(c.lastAt) : <span className="text-gray-400">없음</span>}</td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums" title={c.users.map((u) => u.name || u.loginId).join(', ')}>{c.users.length}명</td>
                    <td className="pr-3 py-2.5 text-gray-300 group-hover:text-cyan-600"><ChevronRight className="w-4 h-4" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ListPager page={page} total={rows.length} onPage={setPage} />
      </div>
      </>)}

      {detail && <CompanyDetailModal c={detail} onClose={() => setDetail(null)} />}

      <p className="px-6 pb-4 text-[10px] italic text-gray-400">요금제 = 지금 기준(고객 화면과 같은 판정) · 기록은 2026-10-06 배포부터 · 무료체험 신청과 「다시 보지 않기」는 지금 상태</p>
    </div>
  );
}
