/**
 * CustomerNoticeAckTab — 공지 확인 현황 (★2026-10-29 Harold 「확인한 업체가 누군지 보안인증 메뉴에서 체크」 · ceo · suran · 읽기만)
 *
 * 고객 보안 공지(B 카드 · C 점검 기록)를 업체마다 봤는지 · 「확인했습니다」를 눌렀는지.
 * ★1029 Harold 「무한 목록 말고 10개씩 · 확인한 업체 버튼 · 확인한 업체는 1페이지에 먼저」 = 순서는 서버(확인함 → 보기만 함 → 아직 안 봄) · 쪽 = ListPager 10개.
 * 집계 = 서버(utils/customer-notice.ts · 원천 audit_logs). 노출 게이팅은 부모(AdminDashboard)가 /api/admin/customer-notice-ack/access 로 한다.
 * 행을 누르면 계정별 상세 창(같은 응답 · 추가 호출 0). 설계 = docs/2026-10-29-customer-security-notice-ack-design.md §2-3 D.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ADMIN_TABLE, ADMIN_TR_OPEN, adminRowOpen, AdminTableEmpty, AdminDetailModal } from './ui/admin-ui';
import ListPager, { pageSlice } from '../shared/ListPager';

const PAGE_SIZE = 10;

type Status = 'acked' | 'seen' | 'none';
type Filter = Status | 'all';

interface Account {
  loginId: string;
  name: string;
  current: boolean;
  lastLoginAt: string | null;
  shownAt: string | null;
  reportAt: string | null;
  ackAt: string | null;
}
interface CompanyRow {
  companyId: string;
  companyName: string;
  status: Status;
  firstShownAt: string | null;
  reportAt: string | null;
  ackAt: string | null;
  ackLoginId: string | null;
  people: number;
  lastLoginAt: string | null;
  accounts: Account[];
}
interface Data {
  notice: { id: string; title: string; startsAt: string; showUntil: string };
  notices: { id: string; title: string }[];
  summary: { companies: number; acked: number; seen: number; none: number };
  companies: CompanyRow[];
}

const STATUS: Record<Status, { label: string; chip: string; dot: string; bar: string }> = {
  none: { label: '아직 안 봄', chip: 'bg-red-50 text-red-800 ring-red-200', dot: 'bg-red-600', bar: 'bg-red-300' },
  seen: { label: '보기만 함', chip: 'bg-orange-50 text-orange-800 ring-orange-200', dot: 'bg-orange-600', bar: 'bg-orange-300' },
  acked: { label: '확인함', chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200', dot: 'bg-emerald-600', bar: 'bg-emerald-600' },
};
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'acked', label: '확인한 업체' },
  { key: 'seen', label: '보기만 함' },
  { key: 'none', label: '아직 안 봄' },
];
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
}) : '-');

function StatusChip({ s }: { s: Status }) {
  return (
    <span className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-semibold ring-1 ring-inset whitespace-nowrap ${STATUS[s].chip}`}>
      <i className={`w-1.5 h-1.5 rounded-full ${STATUS[s].dot}`} />{STATUS[s].label}
    </span>
  );
}

export default function CustomerNoticeAckTab() {
  const [noticeId, setNoticeId] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<CompanyRow | null>(null);

  const load = useCallback(async (id: string | null) => {
    setLoading(true);
    setError('');
    try {
      const q = id ? `?noticeId=${encodeURIComponent(id)}` : '';
      const r = await fetch(`/api/admin/customer-notice-ack${q}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const d = await r.json();
      if (!r.ok || !d.success) { setError(d.error || '불러오지 못했습니다.'); setData(null); return; }
      setData(d);
    } catch {
      setError('불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(noticeId); }, [noticeId, load]);
  useEffect(() => { setPage(1); }, [filter, noticeId]);

  const filtered = useMemo(() => (data ? data.companies.filter((c) => filter === 'all' || c.status === filter) : []), [data, filter]);
  const rows = pageSlice(filtered, page, PAGE_SIZE);
  const s = data?.summary;
  const pct = (n: number) => (s && s.companies > 0 ? Math.round((n / s.companies) * 100) : 0);
  const counts: Record<Filter, number> = { none: s?.none ?? 0, seen: s?.seen ?? 0, acked: s?.acked ?? 0, all: s?.companies ?? 0 };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">공지 확인 현황</h2>
          <p className="text-xs text-gray-500 mt-1 break-keep">고객사마다 보안 공지를 봤는지, 「확인했습니다」를 눌렀는지 봅니다. 확인한 업체가 먼저 보입니다. 사내 회사(시연 · 사내 시험)는 빠집니다.</p>
        </div>
        {data && data.notices.length > 1 && (
          <select
            value={data.notice.id}
            onChange={(e) => setNoticeId(e.target.value)}
            className="h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700"
          >
            {data.notices.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
          </select>
        )}
        {data && data.notices.length <= 1 && (
          <span className="h-10 px-3 inline-flex items-center rounded-lg bg-white ring-1 ring-gray-200 text-sm font-medium text-gray-700">{data.notice.title}</span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr] gap-3">
        <div className="col-span-2 lg:col-span-1 rounded-xl bg-white ring-1 ring-gray-200 p-4">
          <div className="text-xs font-medium text-gray-500">사용 중 고객사</div>
          <div className="mt-1.5 text-2xl font-bold tabular-nums">{s ? s.companies.toLocaleString() : '-'}<span className="ml-1 text-sm font-semibold text-gray-400">곳</span></div>
          <div className="mt-3 h-2 rounded-full bg-gray-100 overflow-hidden flex" aria-hidden="true">
            <i className={STATUS.acked.bar} style={{ width: `${pct(counts.acked)}%` }} />
            <i className={STATUS.seen.bar} style={{ width: `${pct(counts.seen)}%` }} />
            <i className={STATUS.none.bar} style={{ width: `${pct(counts.none)}%` }} />
          </div>
        </div>
        {(['acked', 'seen', 'none'] as const).map((k) => (
          <div key={k} className="rounded-xl bg-white ring-1 ring-gray-200 p-4">
            <div className="text-xs font-medium text-gray-500">{STATUS[k].label}</div>
            <div className={`mt-1.5 text-2xl font-bold tabular-nums ${k === 'acked' ? 'text-emerald-700' : k === 'seen' ? 'text-orange-700' : 'text-red-700'}`}>
              {s ? counts[k].toLocaleString() : '-'}
              <span className="ml-1 text-sm font-semibold text-gray-400">곳{k === 'acked' && s ? ` ${pct(counts.acked)}%` : ''}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-white ring-1 ring-gray-200 overflow-hidden">
        <div className="flex flex-wrap gap-1.5 px-3 py-3 border-b border-gray-100" role="tablist" aria-label="상태로 걸러 보기">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`h-8 px-3 rounded-full text-xs font-semibold transition-colors ${filter === f.key ? 'bg-slate-900 text-white' : 'text-gray-600 ring-1 ring-inset ring-gray-200 hover:bg-gray-50'}`}
            >
              {f.label} <span className="tabular-nums opacity-70">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className={ADMIN_TABLE}>
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500">
                <th className="px-4 py-2.5 whitespace-nowrap">고객사</th>
                <th className="px-4 py-2.5 whitespace-nowrap">상태</th>
                <th className="px-4 py-2.5 whitespace-nowrap">처음 본 시각</th>
                <th className="px-4 py-2.5 whitespace-nowrap">확인 시각</th>
                <th className="px-4 py-2.5 whitespace-nowrap">확인한 계정</th>
                <th className="px-4 py-2.5 whitespace-nowrap">마지막 로그인</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && <AdminTableEmpty colSpan={6}>불러오는 중입니다</AdminTableEmpty>}
              {error && <AdminTableEmpty colSpan={6}><span className="text-red-600">{error}</span></AdminTableEmpty>}
              {data && !error && rows.length === 0 && (
                <AdminTableEmpty colSpan={6}>{filter === 'acked' ? '아직 확인한 고객사가 없습니다' : filter === 'none' ? '아직 안 본 고객사가 없습니다' : '해당하는 고객사가 없습니다'}</AdminTableEmpty>
              )}
              {rows.map((c) => (
                <tr key={c.companyId} {...adminRowOpen(() => setOpen(c))} className={`border-t border-gray-100 ${ADMIN_TR_OPEN}`}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="font-semibold text-gray-900">{c.companyName || '(이름 없음)'}</div>
                    <div className="text-[11.5px] text-gray-400 mt-0.5">계정 {c.people}</div>
                  </td>
                  <td className="px-4 py-3"><StatusChip s={c.status} /></td>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-gray-700">{fmt(c.firstShownAt ?? c.reportAt)}</td>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-gray-700">{fmt(c.ackAt)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-700">{c.ackLoginId || '-'}</td>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-gray-700">{fmt(c.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ListPager page={page} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>

      {open && (
        <AdminDetailModal title={`${open.companyName || '(이름 없음)'} 계정별 확인`} onClose={() => setOpen(null)}>
          <div className="overflow-x-auto">
            <table className={ADMIN_TABLE}>
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-500 border-b border-gray-100">
                  <th className="px-3 py-2 whitespace-nowrap">계정</th>
                  <th className="px-3 py-2 whitespace-nowrap">본 시각</th>
                  <th className="px-3 py-2 whitespace-nowrap">점검 기록</th>
                  <th className="px-3 py-2 whitespace-nowrap">확인 시각</th>
                  <th className="px-3 py-2 whitespace-nowrap">마지막 로그인</th>
                </tr>
              </thead>
              <tbody>
                {open.accounts.length === 0 && <AdminTableEmpty colSpan={5}>활성 계정이 없습니다</AdminTableEmpty>}
                {open.accounts.map((a) => (
                  <tr key={`${a.loginId}-${a.current}`} className="border-t border-gray-100">
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="font-medium text-gray-900">{a.loginId || '(아이디 없음)'}</span>
                      {a.name && <span className="ml-1.5 text-gray-500">{a.name}</span>}
                      {!a.current && <span className="ml-1.5 text-[11px] text-gray-400">지금은 없는 계정</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono text-gray-700">{fmt(a.shownAt)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono text-gray-700">{fmt(a.reportAt)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono text-gray-700">{a.ackAt ? fmt(a.ackAt) : '-'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono text-gray-700">{fmt(a.lastLoginAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminDetailModal>
      )}
    </div>
  );
}
