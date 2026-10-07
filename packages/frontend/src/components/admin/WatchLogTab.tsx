/**
 * WatchLogTab — 감시 기록 (★2026-10-07 Harold 「의심은 해야지」 · ceo 전용 · 읽기만 · 20건씩)
 *
 * 감시 대상 계정(WATCH_LOGIN_IDS · 기본 psy5868)이 쓴 IP 목록. IP 마다 주인(통신사 · 회선을 받은 회사) ·
 * 처음 · 마지막 · 로그인 수 · 업무 시간 밖 로그인 · 동시 접속. 줄을 누르면 그 IP 에서 한 일(로그인 · 동시 접속 · 연 화면).
 * 집계 · 주인 조회 = 서버(utils/watch-alert.ts). 노출 게이팅은 부모(AdminDashboard)가 /api/admin/watch-log/access 로 한다.
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import ListPager from '../shared/ListPager';

interface IpRow {
  loginId: string; ip: string; owner: string; office: boolean;
  logins: number; firstAt: string; lastAt: string; concurrent: number; offHoursLogins: number;
}
interface EventRow { at: string; action: string; path: string; otherIp: string }

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
const fmt = (iso: string) => new Date(iso).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
const ACTION_LABEL: Record<string, string> = {
  login_success: '로그인', login_takeover: '동시 접속(기존 접속을 밀어냄)', login_session_conflict: '동시 접속(쓰는 중에 로그인 시도)',
  page_view: '화면', logout: '로그아웃', privacy_view: '개인정보 열람',
};

export default function WatchLogTab() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ watched: string[]; total: number; rows: IpRow[] } | null>(null);
  const [error, setError] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[] | null>(null);

  const load = useCallback(async (p: number) => {
    setError('');
    try {
      const r = await fetch(`/api/admin/watch-log?page=${p}`, { headers: auth() });
      const d = await r.json();
      if (!r.ok || !d.success) { setError(d.error || '불러오지 못했습니다.'); return; }
      setData(d);
    } catch { setError('불러오지 못했습니다.'); }
  }, []);
  useEffect(() => { void load(page); }, [page, load]);

  const toggle = async (row: IpRow) => {
    const key = `${row.loginId}|${row.ip}`;
    if (openKey === key) { setOpenKey(null); return; }
    setOpenKey(key);
    setEvents(null);
    try {
      const r = await fetch(`/api/admin/watch-log/events?loginId=${encodeURIComponent(row.loginId)}&ip=${encodeURIComponent(row.ip)}`, { headers: auth() });
      const d = await r.json();
      setEvents(r.ok && d.success ? d.events : []);
    } catch { setEvents([]); }
  };

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="px-5 py-3 border-b">
        <p className="text-sm font-semibold text-gray-900">감시 기록</p>
        <p className="text-xs text-gray-500 mt-0.5">
          대상 {data ? data.watched.join(', ') : '-'} · 사무실 밖 로그인과 두 곳 동시 접속은 대표 휴대폰으로 문자가 갑니다. 대상 계정에는 아무것도 보이지 않습니다.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              {['계정', 'IP', '주인', '로그인', '시간 외', '동시 접속', '처음', '마지막'].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {error && <tr><td colSpan={8} className="px-4 py-10 text-center text-red-600">{error}</td></tr>}
            {!error && !data && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">불러오는 중...</td></tr>}
            {data && data.rows.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">아직 기록이 없습니다.</td></tr>}
            {data?.rows.map((r) => {
              const key = `${r.loginId}|${r.ip}`;
              return (
                <Fragment key={key}>
                  <tr onClick={() => void toggle(r)} className="border-t hover:bg-gray-50 cursor-pointer">
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-900">{r.loginId}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
                      {r.ip}
                      {r.office && <span className="ml-1.5 px-1.5 py-0.5 rounded text-[11px] bg-gray-100 text-gray-600">사무실</span>}
                      {!r.office && r.logins <= 1 && <span className="ml-1.5 px-1.5 py-0.5 rounded text-[11px] bg-amber-50 text-amber-800">한 번</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-700 min-w-[220px]">{r.owner}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{r.logins}</td>
                    <td className={`px-4 py-2.5 whitespace-nowrap tabular-nums ${r.offHoursLogins > 0 ? 'text-amber-700 font-medium' : 'text-gray-400'}`}>{r.offHoursLogins}</td>
                    <td className={`px-4 py-2.5 whitespace-nowrap tabular-nums ${r.concurrent > 0 ? 'text-rose-700 font-medium' : 'text-gray-400'}`}>{r.concurrent}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-gray-600">{fmt(r.firstAt)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-gray-600">{fmt(r.lastAt)}</td>
                  </tr>
                  {openKey === key && (
                    <tr className="bg-gray-50/70">
                      <td colSpan={8} className="px-4 py-3">
                        {!events ? <p className="text-sm text-gray-400">불러오는 중...</p> : events.length === 0 ? (
                          <p className="text-sm text-gray-500">이 IP 에서 남은 기록이 없습니다.</p>
                        ) : (
                          <ul className="space-y-1 text-sm text-gray-700 max-h-72 overflow-y-auto">
                            {events.map((e, i) => (
                              <li key={i} className="flex gap-3">
                                <span className="tabular-nums text-gray-500 whitespace-nowrap">{fmt(e.at)}</span>
                                <span className={e.action.startsWith('login_t') || e.action.startsWith('login_s') && e.action !== 'login_success' ? 'text-rose-700' : ''}>
                                  {ACTION_LABEL[e.action] || e.action}{e.path ? ` · ${e.path}` : ''}{e.otherIp ? ` · 상대 IP ${e.otherIp}` : ''}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <ListPager page={page} total={data?.total ?? 0} onPage={setPage} />
      <p className="px-5 py-2.5 border-t text-xs text-gray-500">
        Source: 로그인 · 동시 접속 · 화면 접속 기록(감사 로그) · IP 주인 = 한국인터넷진흥원 조회. 휴대폰 데이터 IP 는 통신사가 여러 사람에게 나눠 씁니다. 동시 접속 상대 IP 는 2026-10-07 이후 기록부터 남습니다.
      </p>
    </div>
  );
}
