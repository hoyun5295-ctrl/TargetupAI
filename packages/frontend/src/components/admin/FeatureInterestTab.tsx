/**
 * FeatureInterestTab — 기능 관심 업체 (★ 2026-10-06 · Harold 명시 · ceo 전용 · 읽기만)
 *
 * 로그인 뒤 안내 창 · 대시보드 배너 · 기능 안내 창을 본 회사, 거기서 누른 버튼, 두 체험(7일 무료체험 · 이미지 체험)을 한 화면에서 본다.
 * 집계 = 서버(utils/feature-interest.ts · 원천 audit_logs + 체험 원장 둘 + 「다시 보지 않기」). 이 화면은 받은 줄을 판정 함수(utils/feature-interest-view)로 그린다.
 * 노출 게이팅은 부모(AdminDashboard)가 /api/admin/feature-interest/access 로 한다 — 점검 사용 현황과 같은 규약.
 *
 * ★ 2026-11-17 C141 통합안(Harold 「정신없다 · 무료체험이 누구인지도 모르겠다 · 칸도 벗어난다」 → 「통합안으로 구현 · 글씨는 작아도 되고 답답하지 않게」
 *   · 설계 docs/2026-11-17-c141-feature-interest-redesign-design.md · 목업 docs/mockups/2026-11-17-feature-interest-redesign-mockup.html 「통합안」)
 *   = 단계 칸 넷(누가 어디까지) + 고른 단계의 회사 목록(지금 상태 한 줄 · 본 것 한 줄) + 안내별(본 → 누름 → 결과) · 최근 일어난 일.
 *   옛 화면(업체 표 열한 칸 · 색 칩 · 화면 끝까지 늘인 폭 FULL_BLEED)은 걷었다 = 관리자 본문 폭 안에서 줄을 바꾼다 · 「없음」을 반복하지 않는다.
 *   줄을 누르면 상세 창(닫기 = X · [닫기] · ESC 만 · 배경 클릭으로 닫지 않는다 · 자매 = PrecheckUsageDetailModal).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, ChevronRight, X } from 'lucide-react';
import { usePlanFeatureIntros } from '../../constants/plan-feature-intros'; // ★ 2026-10-07 원장 = 서버(로그인한 사람에게만)
import ListPager, { pageSlice } from '../shared/ListPager';   // ★ 2026-10-07 업체 목록 쪽 넘김(20건)
import { ADMIN_TABLE_ONELINE } from './ui/admin-ui'; // ★ 2026-10-20 표 칸 한 줄
import { loginPopupOf, LINE_TRIAL_BANNER_ID } from '../../constants/login-popups';   // ★ 2026-11-15 C135 로그인 뒤 안내 창 등록부(창 이름 · 주 버튼 이름)
import {
  normalizeInterest, STAGES, stageRows, stageCounts, guideStats, sawGuide, seenParts, pressedParts, recentActivity,
  daysLeftText, lineTrialSourceText, groupDismissed, dismissedPopupName, type InterestStage, type InterestRowLike,
} from '../../utils/feature-interest-view';   // ★ C141 표시 판정(순수)

type Period = 'today' | '7d' | 'month' | 'all';
type PlanFilter = 'all' | 'unsubscribed' | 'subscribed';

/** 업체 줄(서버 utils/feature-interest.ts 의 FeatureInterestCompanyRow · 판정에 쓰는 칸 = InterestRowLike) */
interface CompanyRow extends InterestRowLike {
  planName: string;
  subscribed: boolean;
  users: { name: string; loginId: string }[];
}

interface InterestData {
  companies: CompanyRow[];
  /** 체험 둘 · 「다시 보지 않기」 목록을 읽었는가(false = 그 단계 · 그 칸의 수는 알 수 없음 · 「없음」 · 0 이라 쓰지 않는다) */
  trialsKnown: boolean;
  dismissalsKnown: boolean;
  lineTrialsKnown: boolean;
}

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: '오늘' },
  { key: '7d', label: '최근 7일' },
  { key: 'month', label: '이번 달' },
  { key: 'all', label: '전체' },
];
const PLAN_FILTERS: { key: PlanFilter; label: string }[] = [
  { key: 'all', label: '모든 회사' },
  { key: 'unsubscribed', label: '미가입만' },
  { key: 'subscribed', label: '요금제 사용 중만' },
];

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
/** 거르기 단추 한 덩어리(고른 것 = 검정) */
const segBtn = (on: boolean) => `h-8 px-3 rounded-md text-[12.5px] whitespace-nowrap transition-colors ${on ? 'bg-gray-900 text-white font-semibold' : 'text-gray-600 hover:bg-gray-100'}`;
const SEG = 'inline-flex gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5';
const CARD = 'rounded-2xl border border-gray-200/70 bg-white';
/** 강조색 하나(주황) — 누른 것 · 체험 중 */
const ACC = 'text-[#A8380B]';
// ★ 2026-11-15 C135 창의 이름 · 주 버튼 이름 = 등록부(constants/login-popups.ts) — 새 안내 창을 올리면 여기 손대지 않아도 탭에 나온다
/** 기능 id → 이름 — 원장을 받으면 채운다(받기 전엔 id 그대로) */
let FEATURE_TITLES = new Map<string, string>();
const featureName = (id: string) => loginPopupOf(id)?.name || FEATURE_TITLES.get(id) || id;
const EVENT_LABEL: Record<'open' | 'pricing' | 'go', string> = { open: '봄', pricing: '요금제 보기', go: '바로가기' };
/** 기록 한 줄의 행동 이름 — 안내 창의 go 는 그 창의 주 버튼 이름으로 */
const eventLabel = (e: { event: 'open' | 'pricing' | 'go'; featureId: string }) => (e.event === 'go' ? loginPopupOf(e.featureId)?.goLabel || EVENT_LABEL.go : EVENT_LABEL[e.event]);
const fmt = (iso: string) => new Date(iso).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
const EVENT_CHIP: Record<'open' | 'pricing' | 'go', string> = {
  open: 'bg-gray-100 text-gray-600',
  pricing: 'bg-[#FDF1EC] text-[#A8380B]',
  go: 'bg-[#FDF1EC] text-[#A8380B]',
};
const totalOpens = (c: CompanyRow) => c.features.reduce((t, f) => t + f.opens, 0);
/** 줄 글 — 길면 칸 안에서 줄을 바꾼다(자르지 않는다 · 낱말 안에서 끊지 않는다) */
const WRAP = 'break-keep [overflow-wrap:anywhere]';

/** 7일 체험의 남은 날 막대(7칸 · 남은 날만큼 주황) */
function DaysBar({ n }: { n: number | null }) {
  if (typeof n !== 'number') return null;
  return (
    <span className="inline-flex gap-[3px] align-middle mx-1.5" aria-hidden="true">
      {Array.from({ length: 7 }, (_, i) => <i key={i} className={`h-[5px] w-3 rounded-full ${i < n ? 'bg-[#CF4510]' : 'bg-gray-200'}`} />)}
    </span>
  );
}

const PlanText = ({ c }: { c: CompanyRow }) => (
  <span className={`text-[12px] ${c.lineTrial?.alive ? `${ACC} font-semibold` : 'text-gray-500'}`}>{c.subscribed ? c.planName : '미가입'}</span>
);

/** 업체 상세 창 — 받은 줄에 있는 값만 그린다(서버 조회 추가 없음 · 시간순 기록은 서버가 회사당 최근 30건만 준다) */
function CompanyDetailModal({ c, dismissalsKnown, onClose }: { c: CompanyRow; dismissalsKnown: boolean; onClose: () => void }) {
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
  const dismissed = groupDismissed(c.dismissed);
  const stats: [string, number, string][] = [
    ['안내를 본 횟수', opens, '회'],
    ['본 안내', c.features.length, '개'],
    ['요금제 보기', c.pricingClicks, '회'],
    ['버튼 누름', c.goClicks, '회'],
  ];

  return (
    <div className="fixed inset-0 z-[70] bg-gray-900/45 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl w-full max-w-[720px] max-h-[88vh] flex flex-col" role="dialog" aria-modal="true" aria-label={`${c.companyName} 기능 관심 상세`}>
        <div className="px-5 py-4 border-b flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-gray-100">
              <Building2 className="w-4 h-4 text-gray-700" />
            </div>
            <div className="min-w-0">
              <h3 className={`text-[14.5px] font-semibold text-gray-900 ${WRAP}`}>{c.companyName} <PlanText c={c} /></h3>
              <p className="text-[12px] text-gray-500">{c.seen ? `마지막 본 시각 ${fmt(c.lastAt)}` : '이 기간에 본 기록 없음'}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} autoFocus className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 shrink-0" aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-5 text-[13px]">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {stats.map(([k, v, unit]) => (
              <div key={k} className="rounded-xl bg-gray-50 px-3 py-2.5">
                <div className="text-[11.5px] text-gray-500">{k}</div>
                <div className="text-lg font-bold tabular-nums text-gray-900">{v.toLocaleString()}<span className="text-xs text-gray-400 font-semibold">{unit}</span></div>
              </div>
            ))}
          </div>

          {(c.lineTrial || c.trial || dismissed.length > 0) && (
            <section className="grid sm:grid-cols-2 gap-3">
              {c.lineTrial && (
                <div className="rounded-xl border border-gray-200/70 px-3.5 py-3">
                  <h4 className="text-[12.5px] font-semibold text-gray-700">7일 무료체험</h4>
                  <p className="mt-1.5">
                    {c.lineTrial.alive
                      ? <><b className={ACC}>{daysLeftText(c.lineTrial.daysLeft) || '진행 중'}</b><DaysBar n={c.lineTrial.daysLeft} /></>
                      : <b className="text-gray-700">끝남{c.lineTrial.endsAt ? ` ${fmt(c.lineTrial.endsAt)}` : ''}</b>}
                  </p>
                  <p className="mt-1 text-gray-500">{fmt(c.lineTrial.grantedAt)} 켬, {lineTrialSourceText(c.lineTrial)}</p>
                </div>
              )}
              {c.trial && (
                <div className="rounded-xl border border-gray-200/70 px-3.5 py-3">
                  <h4 className="text-[12.5px] font-semibold text-gray-700">이미지 체험</h4>
                  <p className="mt-1.5"><b className="tabular-nums">{c.trial.used}</b><span className="text-gray-400"> / {c.trial.granted}장</span></p>
                  <p className="mt-1 text-gray-500">{fmt(c.trial.requestedAt)} 신청, {c.trial.requestedBy || '이름 없음'}</p>
                </div>
              )}
              {dismissalsKnown && dismissed.length > 0 && (
                <div className="rounded-xl border border-gray-200/70 px-3.5 py-3">
                  <h4 className="text-[12.5px] font-semibold text-gray-700">「다시 보지 않기」를 누름</h4>
                  <ul className="mt-1.5 space-y-1 text-gray-600">
                    {c.dismissed.map((d) => (
                      <li key={`${d.introKey}-${d.loginId}`}>{dismissedPopupName(d.introKey)}, {d.userName || d.loginId || '이름 없음'}, <span className="tabular-nums">{fmt(d.at)}</span></li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {c.features.length > 0 && (
            <section>
              <h4 className="text-[12.5px] font-semibold text-gray-700 mb-2">안내별</h4>
              <div className="space-y-2">
                {c.features.map((f) => (
                  <div key={f.featureId} className="grid grid-cols-[minmax(0,140px)_1fr_88px] gap-2 items-center text-[12.5px]">
                    <span className={WRAP}>{featureName(f.featureId)}</span>
                    <span className="relative h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <span className="absolute inset-y-0 left-0 rounded-full bg-gray-400" style={{ width: `${(f.opens / maxOpens) * 100}%` }} />
                    </span>
                    <span className="text-right text-gray-500 tabular-nums">{f.opens}번 봄{f.clicks > 0 && <b className={` ${ACC}`}> {f.clicks}번 누름</b>}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {c.users.length > 0 && (
            <section>
              <h4 className="text-[12.5px] font-semibold text-gray-700 mb-2">본 사람 {c.users.length}명</h4>
              <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
                {c.users.map((u) => (
                  <div key={u.loginId} className={WRAP}>
                    {u.name || '이름 없음'} <span className="text-xs text-gray-400">{u.loginId}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {c.events.length > 0 && (
            <section>
              <h4 className="text-[12.5px] font-semibold text-gray-700 mb-2">
                시간순 기록, 최근 {c.events.length}건
                {totalEvents > c.events.length && <span className="text-xs text-gray-400 font-normal"> (전체 {totalEvents.toLocaleString()}건 중)</span>}
              </h4>
              <div className="overflow-x-auto">
                <table className={`w-full text-[12.5px] ${ADMIN_TABLE_ONELINE}`}>
                  <tbody>
                    {c.events.map((e, i) => (
                      <tr key={`${e.at}-${i}`} className="border-t border-dashed border-gray-200">
                        <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums text-gray-500">{fmt(e.at)}</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                          <span className={`inline-block px-1.5 py-px rounded-md text-[11.5px] font-semibold ${EVENT_CHIP[e.event]}`}>{eventLabel(e)}</span>
                        </td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{featureName(e.featureId)}</td>
                        <td className="py-1.5 text-gray-500 whitespace-nowrap">{e.userName || '이름 없음'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-gray-400">시간순 기록은 회사당 최근 30건</span>
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
  // ★ C141 단계 · 안내 · 「다시 보지 않기」 = 화면에서 건다(받아 둔 줄을 거른다 · 다시 읽지 않는다)
  const [stage, setStage] = useState<InterestStage>('line');
  const [guide, setGuide] = useState<string | null>(null);
  const [dismissedOnly, setDismissedOnly] = useState(false);
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
  const counts = useMemo(() => stageCounts(all), [all]);
  const guides = useMemo(() => guideStats(all), [all]);
  // 기능 이름은 원장(intros)을 받은 뒤 채워진다 — 받으면 다시 센다
  const activity = useMemo(() => recentActivity(all, featureName, 6), [all, intros]);
  /**
   * 그 단계를 읽었는가 — 체험 목록을 못 읽었으면 그 단계의 수 · 회사를 그리지 않는다.
   *   버튼만 누름 · 보기만 함 = 「체험이 아닌 회사」라 체험 목록 둘을 다 읽었을 때만 안다(못 읽으면 체험 회사가 섞여 보인다).
   */
  const stageKnown = (k: InterestStage) => !data || (k === 'line' ? data.lineTrialsKnown : k === 'studio' ? data.trialsKnown : data.lineTrialsKnown && data.trialsKnown);
  const inStageRows = useMemo(() => stageRows(all, stage).filter((c) => !guide || sawGuide(c, guide)), [all, stage, guide]);
  const rows = useMemo(() => (dismissedOnly ? inStageRows.filter((c) => c.dismissed.length > 0) : inStageRows), [inStageRows, dismissedOnly]);
  const dismissedInStage = inStageRows.filter((c) => c.dismissed.length > 0).length;
  const listUnknown = !!data && (!stageKnown(stage) || (dismissedOnly && !data.dismissalsKnown));
  const current = STAGES.find((s) => s.key === stage)!;
  const pick = (k: InterestStage) => { setStage(k); setPage(1); };

  /** 줄의 지금 상태(굵게) — 단계마다 그 단계의 사실 하나 */
  const statusLine = (c: CompanyRow) => {
    if (stage === 'line' && c.lineTrial) {
      return <><b className={ACC}>{daysLeftText(c.lineTrial.daysLeft) || '진행 중'}</b><DaysBar n={c.lineTrial.daysLeft} /><span className="inline-block text-gray-500">{fmt(c.lineTrial.grantedAt)} 켬, {lineTrialSourceText(c.lineTrial)}</span></>;
    }
    if (stage === 'studio' && c.trial) {
      return <><b>{c.trial.used}/{c.trial.granted}장 씀</b> <span className="inline-block text-gray-500">{fmt(c.trial.requestedAt)} 신청, {c.trial.requestedBy || '이름 없음'}</span></>;
    }
    if (stage === 'pressed') return <b>{pressedParts(c, featureName).join(', ')}</b>;
    const seen = seenParts(c, featureName);
    return seen.length ? <span>{seen.join(', ')}</span> : <span className="text-gray-500">이 기간에 본 기록 없음</span>;
  };
  /** 줄의 덧붙임(작게) — 본 것 · 다른 체험 · 끝난 7일 체험 · 「다시 보지 않기」 */
  const notes = (c: CompanyRow): string[] => {
    const out: string[] = [];
    const other: string[] = [];
    if (stage !== 'line' && c.lineTrial?.alive) other.push(`7일 무료체험 ${daysLeftText(c.lineTrial.daysLeft) || '진행 중'}`);
    if (stage !== 'studio' && c.trial) other.push(`이미지 체험 ${c.trial.used}/${c.trial.granted}장`);
    const seen = stage === 'seen' ? [] : seenParts(c, featureName);
    if (other.length || seen.length) out.push([...other, ...seen].join(', '));
    if (c.lineTrial && !c.lineTrial.alive) out.push(`7일 무료체험 끝남${c.lineTrial.endsAt ? ` ${fmt(c.lineTrial.endsAt)}` : ''}, ${lineTrialSourceText(c.lineTrial)}`);
    if (data?.dismissalsKnown) {
      const d = groupDismissed(c.dismissed);
      if (d.length) out.push(`다시 보지 않기: ${d.map((x) => `${x.name} ${x.users}명`).join(', ')} (최근 ${fmt(d.reduce((m, x) => (x.at > m ? x.at : m), ''))})`);
    }
    return out;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h2 className="text-[17px] font-bold text-gray-900">기능 관심 업체</h2>
          <p className="text-[12.5px] text-gray-500 mt-0.5">안내 창과 배너를 본 회사, 버튼을 누른 회사, 무료체험 중인 회사</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className={SEG} role="group" aria-label="기간">
            {PERIODS.map((p) => (
              <button key={p.key} type="button" aria-pressed={period === p.key} onClick={() => setPeriod(p.key)} className={segBtn(period === p.key)}>{p.label}</button>
            ))}
          </div>
          <div className={SEG} role="group" aria-label="회사">
            {PLAN_FILTERS.map((p) => (
              <button key={p.key} type="button" aria-pressed={plan === p.key} onClick={() => setPlan(p.key)} className={segBtn(plan === p.key)}>{p.label}</button>
            ))}
          </div>
          <button type="button" onClick={() => void load()} disabled={loading}
            className="h-9 px-3 rounded-lg border border-gray-200 bg-white text-[12.5px] text-gray-700 hover:bg-gray-50 disabled:opacity-40">새로고침</button>
        </div>
      </div>

      {error && <div className={`${CARD} px-5 py-4 text-[13px] text-rose-600`} role="alert">{error}</div>}

      {/* 단계 칸 넷 — 누가 어디까지 왔는가(누르면 아래 목록이 그 단계로) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" role="group" aria-label="단계">
        {STAGES.map((s) => {
          const known = stageKnown(s.key);
          const names = stageRows(all, s.key).slice(0, 3).map((c) => c.companyName);
          const more = counts[s.key] - names.length;
          return (
            <button key={s.key} type="button" aria-pressed={stage === s.key} onClick={() => pick(s.key)}
              className={`${CARD} text-left px-4 py-3.5 flex flex-col border-2 transition-colors ${stage === s.key ? '!border-gray-900' : 'border-transparent hover:!border-gray-300'}`}>
              <span className="text-[12.5px] font-semibold text-gray-500">{s.name}</span>
              <span className={`mt-0.5 text-[26px] font-extrabold leading-tight tabular-nums ${s.key === 'line' ? ACC : 'text-gray-900'}`}>
                {!data ? '-' : known ? counts[s.key].toLocaleString() : '?'}{data && known && <span className="ml-0.5 text-[13px] font-semibold text-gray-500">곳</span>}
              </span>
              <span className={`mt-1.5 text-[12px] leading-relaxed text-gray-500 ${WRAP}`}>
                {!data ? ' ' : !known ? '이 목록을 읽지 못했습니다' : names.length ? `${names.join(', ')}${more > 0 ? ` 외 ${more}곳` : ''}` : '아직 없습니다'}
              </span>
            </button>
          );
        })}
      </div>
      <p className="-mt-1 text-[11.5px] text-gray-400">두 체험은 기간과 무관하게 지금 상태입니다. 두 체험을 다 하는 회사는 두 칸에 다 셉니다.</p>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
        {/* 고른 단계의 회사 목록 */}
        <section className={`${CARD} overflow-hidden`} aria-label={`${current.name} 회사`}>
          <div className="px-5 py-3.5 border-b border-gray-100 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className={`min-w-0 ${WRAP}`}>
              <b className="text-[14.5px] text-gray-900">{current.name} <span className="tabular-nums">{listUnknown || !data ? '' : `${rows.length.toLocaleString()}곳`}</span></b>
              <span className="ml-2 text-[12px] text-gray-500">{current.order}, 줄을 누르면 상세</span>
              {guide && (
                <span className="ml-2 text-[12px] text-gray-700">
                  {guides.find((g) => g.key === guide)?.name}을 본 회사만{' '}
                  <button type="button" onClick={() => { setGuide(null); setPage(1); }} className="font-semibold underline underline-offset-2">풀기</button>
                </span>
              )}
            </div>
            <button type="button" aria-pressed={dismissedOnly} onClick={() => { setDismissedOnly((v) => !v); setPage(1); }}
              className={`h-8 px-3 rounded-lg border text-[12px] whitespace-nowrap ${dismissedOnly ? 'border-gray-900 bg-gray-900 text-white font-semibold' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
              다시 보지 않기 누른 회사만 <b className="tabular-nums">{!data ? '-' : data.dismissalsKnown ? dismissedInStage : '?'}</b>
            </button>
          </div>

          {/* ★ 못 읽은 목록 = 수 · 회사를 그리지 않는다(못 읽은 것을 0 · 없음으로 보이게 하는 자리 0) */}
          {listUnknown ? (
            <div className="px-5 py-12 text-center" role="status">
              <p className="text-[13px] font-semibold text-rose-600">이 목록을 읽지 못했습니다</p>
              <p className="mt-1 text-[12px] text-gray-500">수와 회사를 보여 드릴 수 없습니다. 새로고침을 눌러 주세요.</p>
            </div>
          ) : (<>
            {loading && !data && <p className="px-5 py-10 text-center text-[13px] text-gray-400">불러오는 중</p>}
            {data && rows.length === 0 && <p className="px-5 py-10 text-center text-[13px] text-gray-400">이 조건에 맞는 회사가 없습니다</p>}
            <ul>
              {pageSlice(rows, page).map((c) => (
                <li key={c.companyId} className="border-t border-gray-100 first:border-t-0">
                  <button type="button" onClick={() => setDetail(c)} aria-label={`${c.companyName} 상세 보기`}
                    className="group w-full text-left px-5 py-3.5 grid grid-cols-1 md:grid-cols-[minmax(0,190px)_minmax(0,1fr)_112px_16px] gap-x-5 gap-y-1 items-start hover:bg-gray-50 focus:bg-gray-50 focus:outline-none">
                    <span className="min-w-0">
                      <span className={`block text-[13.5px] font-semibold text-gray-900 leading-snug ${WRAP}`}>{c.companyName}</span>
                      <PlanText c={c} />
                    </span>
                    <span className={`min-w-0 text-[13px] leading-relaxed text-gray-800 ${WRAP}`}>
                      <span className="block">{statusLine(c)}</span>
                      {notes(c).map((t) => <span key={t} className="block text-[12px] text-gray-500">{t}</span>)}
                    </span>
                    <span className="text-[12px] text-gray-500 tabular-nums md:text-right leading-relaxed">
                      {c.seen ? fmt(c.lastAt) : '이 기간 기록 없음'}
                      {c.users.length > 0 && <span className="block">본 사람 {c.users.length}명</span>}
                    </span>
                    <ChevronRight className="hidden md:block w-4 h-4 mt-0.5 text-gray-300 group-hover:text-gray-600" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <ListPager page={page} total={rows.length} onPage={setPage} />
          </>)}
        </section>

        {/* 오른쪽 — 안내별 · 최근 일어난 일 */}
        <aside className="space-y-4">
          <section className={`${CARD} px-4 py-4`} aria-label="안내별">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <h3 className="text-[13.5px] font-bold text-gray-900">안내별</h3>
              <span className="text-[11.5px] text-gray-400">누르면 그 안내를 본 회사만</span>
            </div>
            {guides.map((g) => (
              <button key={g.key} type="button" aria-pressed={guide === g.key} onClick={() => { setGuide(guide === g.key ? null : g.key); setPage(1); }}
                className={`block w-full text-left rounded-lg px-2.5 py-2 -mx-1 transition-colors ${guide === g.key ? 'bg-gray-100' : 'hover:bg-gray-50'}`}>
                <span className="block text-[13px] font-semibold text-gray-900">{g.name}</span>
                <span className={`block text-[12px] text-gray-500 tabular-nums ${WRAP}`}>
                  본 <b className="text-gray-900">{data ? `${g.seen}곳` : '-'}</b>
                  {' → '}{g.pressLabel} <b className={ACC}>{data ? `${g.pressed}곳` : '-'}</b>
                  {g.result && <>{' → '}{g.result.label} <b className="text-gray-900">{!data ? '-' : (g.key === LINE_TRIAL_BANNER_ID ? data.lineTrialsKnown : data.trialsKnown) ? `${g.result.n}${g.result.unit}` : '?'}</b></>}
                </span>
              </button>
            ))}
          </section>

          <section className={`${CARD} px-4 py-4`} aria-label="최근 일어난 일">
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <h3 className="text-[13.5px] font-bold text-gray-900">최근 일어난 일</h3>
              <span className="text-[11.5px] text-gray-400">누른 것만</span>
            </div>
            {data && activity.length === 0 && <p className="py-3 text-[12px] text-gray-400">아직 없습니다</p>}
            <ul>
              {activity.map((a, i) => (
                <li key={`${a.companyId}-${a.at}-${i}`} className="grid grid-cols-[76px_minmax(0,1fr)] gap-2 py-2 border-t border-gray-100 first:border-t-0 text-[12px]">
                  <span className="text-gray-400 tabular-nums">{fmt(a.at)}</span>
                  <span className={`min-w-0 ${WRAP}`}>
                    <b className="block text-gray-900 font-semibold">{a.companyName}</b>
                    <span className={a.accent ? `${ACC} font-semibold` : 'text-gray-600'}>{a.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {detail && <CompanyDetailModal c={detail} dismissalsKnown={!!data?.dismissalsKnown} onClose={() => setDetail(null)} />}

      <p className="text-[11px] text-gray-400">요금제 = 지금 기준(고객 화면과 같은 판정) · 안내 기록은 2026-10-06 배포부터 · 두 체험과 「다시 보지 않기」는 지금 상태</p>
    </div>
  );
}
