/**
 * PrecheckUsageTab — 스팸 검사·맞춤법 사용 현황 (★ 2026-09-26 · Harold 명시 · ceo 전용)
 *
 * 0925 배포한 발송 전 점검(스팸 검사 무료 체험 3회 · 맞춤법 무료 월 5회)을 어느 업체가 언제 썼는가.
 * 집계·라벨·무료 한도 판정 = 서버(utils/precheck-usage.ts · 고객 화면과 같은 함수). 이 화면은 받은 값을 그린다.
 * 노출 게이팅은 부모(AdminDashboard)가 /api/admin/precheck-usage/access로 한다 — 도움말 질문 이력과 같은 규약.
 * 톤 = 부모 화면(슈퍼관리자 라이트) 그대로 · 강조색 = 발송 관리 그룹색(emerald).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDateTimeShort } from '../../utils/formatDate';

type Period = 'today' | '7d' | 'month';
type Kind = 'all' | 'spam' | 'spell';

interface CompanyRow {
  companyId: string;
  companyName: string;
  planName: string;
  spamPaid: number;
  spamTrial: number;
  spamAuto: number;
  spellDirect: number;
  spellAgency: number;
  lastAt: string;
  spamTrialEligible: boolean;
  spamTrialUsed: number;
  spamTrialLimit: number;
  spellUnlimited: boolean;
  spellUsedThisMonth: number;
  spellMonthlyLimit: number | null;
}

interface RecentRow {
  createdAt: string;
  companyName: string;
  userName: string | null;
  userLogin: string | null;
  kind: 'spam' | 'spell';
  kindLabel: string;
  subLabel: string;
  trial: boolean;
  resultLabel: string;
}

interface UsageData {
  summary: {
    total: number;
    spam: { total: number; paid: number; trial: number; auto: number };
    spell: { total: number; direct: number; agency: number; failed: number };
  };
  trialExhausted: number;
  spellExhausted: number;
  companies: CompanyRow[];
  recent: RecentRow[];
  total: number;
  page: number;
  totalPages: number;
}

interface Props {
  companies: { id: string; company_name: string }[];
}

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: '오늘' },
  { key: '7d', label: '최근 7일' },
  { key: 'month', label: '이번 달' },
];
const KINDS: { key: Kind; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'spam', label: '스팸 검사' },
  { key: 'spell', label: '맞춤법' },
];

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

const segBtn = (on: boolean) =>
  `px-3 py-1.5 text-sm transition-colors ${on ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`;

/** 무료 한도 뱃지 — 다 쓰면 amber */
function QuotaBadge({ used, limit }: { used: number; limit: number }) {
  const full = used >= limit;
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium tabular-nums ${full ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
      {used} / {limit}
    </span>
  );
}

function SubBadge({ row }: { row: RecentRow }) {
  const cls = row.trial
    ? 'bg-blue-50 text-blue-700'
    : row.subLabel === '자동'
      ? 'bg-violet-50 text-violet-700'
      : 'bg-gray-100 text-gray-600';
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{row.subLabel}</span>;
}

function ResultText({ label }: { label: string }) {
  const cls = label === '차단 있음' || label === '실패'
    ? 'text-rose-600'
    : label === '진행 중'
      ? 'text-amber-600'
      : 'text-gray-700';
  return <span className={`text-sm ${cls}`}>{label}</span>;
}

export default function PrecheckUsageTab({ companies }: Props) {
  const [period, setPeriod] = useState<Period>('today');
  const [kind, setKind] = useState<Kind>('all');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 늦게 도착한 옛 조건의 응답이 새 조건 화면을 덮지 않게(조건을 빨리 바꿀 때)
  const seq = useRef(0);

  const load = useCallback(async (p: number) => {
    const mySeq = ++seq.current;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ period, kind, page: String(p) });
      if (companyFilter !== 'all') params.set('companyId', companyFilter);
      const r = await fetch(`/api/admin/precheck-usage?${params}`, { headers: authHeaders() });
      const d = await r.json();
      if (mySeq !== seq.current) return;
      if (!r.ok || !d?.success) throw new Error(d?.error || '사용 현황을 불러오지 못했습니다.');
      setData(d as UsageData);
      setPage(p);
    } catch (e: any) {
      if (mySeq !== seq.current) return;
      setError(e?.message || '사용 현황을 불러오지 못했습니다.');
      setData(null);
    } finally {
      if (mySeq === seq.current) setLoading(false);
    }
  }, [period, kind, companyFilter]);

  useEffect(() => { load(1); }, [load]);

  const s = data?.summary;

  return (
    <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
      <div className="px-6 py-4 border-b">
        <h2 className="text-lg font-semibold">스팸 검사 · 맞춤법 사용 현황</h2>
        <p className="text-xs text-gray-500 mt-1">어느 업체가 언제 썼는지. 무료 체험(스팸 검사 3회)과 무료 한도(맞춤법 월 5회) 소진 현황을 함께 봅니다</p>
      </div>

      <div className="px-6 py-3 border-b bg-gray-50 flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-500 font-medium">기간</span>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden divide-x divide-gray-200">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" onClick={() => setPeriod(p.key)} className={segBtn(period === p.key)}>{p.label}</button>
          ))}
        </div>
        <span className="text-sm text-gray-500 font-medium">고객사</span>
        <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200">
          <option value="all">전체</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        <span className="text-sm text-gray-500 font-medium">종류</span>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden divide-x divide-gray-200">
          {KINDS.map((k) => (
            <button key={k.key} type="button" onClick={() => setKind(k.key)} className={segBtn(kind === k.key)}>{k.label}</button>
          ))}
        </div>
        <button type="button" onClick={() => load(page)} disabled={loading}
          className="ml-auto px-3 py-1.5 border rounded-lg text-sm bg-white hover:bg-gray-50 disabled:opacity-40">새로고침</button>
      </div>

      {error && <div className="px-6 py-4 text-sm text-rose-600">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 py-5">
        <div className="rounded-xl border border-gray-200/70 p-4">
          <div className="text-xs font-medium text-gray-500">스팸 검사</div>
          <div className="text-2xl font-bold tracking-tight text-blue-600 mt-1 tabular-nums">{s ? s.spam.total.toLocaleString() : '-'}<span className="text-sm text-gray-400 font-semibold">회</span></div>
          <div className="text-[11px] text-gray-500 mt-1">{s ? `유료 ${s.spam.paid} · 무료 체험 ${s.spam.trial} · 자동 ${s.spam.auto}` : ''}</div>
        </div>
        <div className="rounded-xl border border-gray-200/70 p-4">
          <div className="text-xs font-medium text-gray-500">맞춤법</div>
          <div className="text-2xl font-bold tracking-tight text-emerald-600 mt-1 tabular-nums">{s ? s.spell.total.toLocaleString() : '-'}<span className="text-sm text-gray-400 font-semibold">회</span></div>
          <div className="text-[11px] text-gray-500 mt-1">{s ? `직접발송 ${s.spell.direct} · 대행 ${s.spell.agency} · 실패 ${s.spell.failed}` : ''}</div>
        </div>
        <div className="rounded-xl border border-gray-200/70 p-4">
          <div className="text-xs font-medium text-gray-500">스팸 체험 다 쓴 업체</div>
          <div className="text-2xl font-bold tracking-tight text-amber-600 mt-1 tabular-nums">{data ? data.trialExhausted : '-'}<span className="text-sm text-gray-400 font-semibold">곳</span></div>
          <div className="text-[11px] text-gray-500 mt-1">3회 중 3회 · 이 기간 사용 업체 중</div>
        </div>
        <div className="rounded-xl border border-gray-200/70 p-4">
          <div className="text-xs font-medium text-gray-500">맞춤법 한도 다 쓴 업체</div>
          <div className="text-2xl font-bold tracking-tight text-amber-600 mt-1 tabular-nums">{data ? data.spellExhausted : '-'}<span className="text-sm text-gray-400 font-semibold">곳</span></div>
          <div className="text-[11px] text-gray-500 mt-1">이번 달 5회 중 5회 · 이 기간 사용 업체 중</div>
        </div>
      </div>

      <div className="px-6 pb-2 text-sm font-semibold text-gray-800">업체별</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs text-gray-500">
              <th className="px-6 py-2 font-medium whitespace-nowrap">고객사</th>
              <th className="px-4 py-2 font-medium whitespace-nowrap">요금제</th>
              <th className="px-4 py-2 font-medium whitespace-nowrap text-right">스팸 유료</th>
              <th className="px-4 py-2 font-medium whitespace-nowrap text-right">스팸 자동</th>
              <th className="px-4 py-2 font-medium whitespace-nowrap">스팸 무료 체험</th>
              <th className="px-4 py-2 font-medium whitespace-nowrap">맞춤법</th>
              <th className="px-4 py-2 font-medium whitespace-nowrap">맞춤법 무료(이번 달)</th>
              <th className="px-4 py-2 font-medium whitespace-nowrap">마지막 사용</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && !data ? (
              <tr><td colSpan={8} className="px-6 py-10 text-center text-gray-400">불러오는 중...</td></tr>
            ) : !data || data.companies.length === 0 ? (
              <tr><td colSpan={8} className="px-6 py-10 text-center text-gray-400">이 기간에 사용한 업체가 없습니다</td></tr>
            ) : data.companies.map((c) => (
              <tr key={c.companyId} className="hover:bg-gray-50/60">
                <td className="px-6 py-2.5 whitespace-nowrap font-medium text-gray-800">{c.companyName}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">{c.planName}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-right tabular-nums text-gray-700">{c.spamPaid}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-right tabular-nums text-gray-700">{c.spamAuto}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  {c.spamTrialEligible
                    ? <QuotaBadge used={c.spamTrialUsed} limit={c.spamTrialLimit} />
                    : <span className="text-xs text-gray-400">해당 없음</span>}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-gray-700 tabular-nums">
                  직접 {c.spellDirect}{c.spellAgency > 0 ? <span className="text-gray-500"> · 대행 {c.spellAgency}</span> : null}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  {c.spellMonthlyLimit == null
                    ? <span className="text-xs text-gray-400">무제한</span>
                    : <QuotaBadge used={c.spellUsedThisMonth} limit={c.spellMonthlyLimit} />}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-xs text-gray-500">{formatDateTimeShort(c.lastAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-6 pt-5 pb-2 flex items-baseline gap-2">
        <span className="text-sm font-semibold text-gray-800">최근 사용 기록</span>
        <span className="text-xs text-gray-500">총 {data ? data.total.toLocaleString() : 0}건 · 10건씩</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs text-gray-500">
              <th className="px-6 py-2 font-medium whitespace-nowrap">시각</th>
              <th className="px-4 py-2 font-medium whitespace-nowrap">고객사</th>
              <th className="px-4 py-2 font-medium whitespace-nowrap">사용자</th>
              <th className="px-4 py-2 font-medium whitespace-nowrap">종류</th>
              <th className="px-4 py-2 font-medium whitespace-nowrap">구분</th>
              <th className="px-4 py-2 font-medium whitespace-nowrap">결과</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && !data ? (
              <tr><td colSpan={6} className="px-6 py-10 text-center text-gray-400">불러오는 중...</td></tr>
            ) : !data || data.recent.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-10 text-center text-gray-400">사용 기록이 없습니다</td></tr>
            ) : data.recent.map((r, i) => (
              <tr key={`${r.createdAt}-${i}`} className="hover:bg-gray-50/60">
                <td className="px-6 py-2.5 text-xs text-gray-500 whitespace-nowrap">{formatDateTimeShort(r.createdAt)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap font-medium text-gray-800">{r.companyName}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">
                  {r.userName || '-'}{r.userLogin ? <span className="text-gray-400 text-xs"> ({r.userLogin})</span> : null}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-gray-700">{r.kindLabel}</td>
                <td className="px-4 py-2.5 whitespace-nowrap"><SubBadge row={r} /></td>
                <td className="px-4 py-2.5 whitespace-nowrap"><ResultText label={r.resultLabel} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="px-6 py-3 border-t flex items-center justify-center gap-2">
          <button disabled={page <= 1 || loading} onClick={() => load(page - 1)}
            className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50">이전</button>
          <span className="text-sm text-gray-500">{page} / {data.totalPages}</span>
          <button disabled={page >= data.totalPages || loading} onClick={() => load(page + 1)}
            className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50">다음</button>
        </div>
      )}

      <p className="px-6 py-3 border-t text-[10px] text-gray-400 italic">
        자료: 스팸 검사 기록 · 직접발송 맞춤법 기록 · 대행 맞춤법 이력(테스트 문자 뒤 자동 검사) · 무료 한도는 고객 화면과 같은 판정
      </p>
    </div>
  );
}
