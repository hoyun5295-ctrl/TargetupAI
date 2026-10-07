/**
 * IntroLeadsTab — 소개 방문 · 시연 요청 (★2026-10-07 Harold 명시 · ceo · suran 만 · 읽기만 · 20건씩)
 *
 * 공개 소개 페이지(/intro) 방문 기록과 시연 요청. 「같은 IP 로그인 계정」 = 그 IP 로 우리 서비스에 로그인한 적 있는 계정.
 * 집계 = 서버(utils/intro-leads.ts · 원천 audit_logs). 노출 게이팅은 부모(AdminDashboard)가 /api/admin/intro-leads/access 로 한다.
 * ⚠ 휴대폰 데이터 IP 는 통신사가 여러 사람에게 나눠 쓴다 · IP 가 같다는 것만으로 같은 사람이라고 단정하지 않는다(화면 안내문).
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import ListPager from '../shared/ListPager';

type Kind = 'all' | 'request' | 'view';

interface Row {
  id: string;
  at: string;
  kind: 'request' | 'view';
  ip: string;
  userAgent: string;
  from: string;
  request: { companyName: string; contactName: string; phone: string; method: 'visit' | 'video'; memo: string } | null;
  sameIpLogins: { loginId: string; companyName: string; lastAt: string }[];
}

interface Data {
  summary: { viewsToday: number; views7d: number; requests: number };
  total: number;
  rows: Row[];
}

const KINDS: { key: Kind; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'request', label: '시연 요청만' },
  { key: 'view', label: '방문만' },
];
const segBtn = (on: boolean) =>
  `px-3 py-1.5 text-sm transition-colors ${on ? 'bg-cyan-50 text-cyan-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`;
const fmt = (iso: string) => new Date(iso).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
const phoneFmt = (p: string) => (p.length === 11 ? `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}` : p);
/** 브라우저 정보 한 줄 요약 — 표에서는 짧게, 펼치면 원문 */
const uaShort = (ua: string) => {
  if (/KAKAOTALK/i.test(ua)) return '카카오톡 안';
  const dev = /iPhone|iPad/i.test(ua) ? 'iPhone' : /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : '기타';
  const br = /Edg\//.test(ua) ? 'Edge' : /Whale/.test(ua) ? 'Whale' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${dev} · ${br}` : dev;
};

export default function IntroLeadsTab() {
  const [kind, setKind] = useState<Kind>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (k: Kind, p: number) => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`/api/admin/intro-leads?kind=${k}&page=${p}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const d = await r.json();
      if (!r.ok || !d.success) { setError(d.error || '불러오지 못했습니다.'); setData(null); return; }
      setData(d);
    } catch {
      setError('불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(kind, page); }, [kind, page, load]);

  const s = data?.summary;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {([['오늘 방문', s?.viewsToday], ['최근 7일 방문', s?.views7d], ['시연 요청(전체)', s?.requests]] as [string, number | undefined][]).map(([label, n]) => (
          <div key={label} className="bg-white rounded-xl border px-5 py-4">
            <p className="text-sm text-gray-500">{label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{n === undefined ? '-' : n.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-5 py-3 border-b flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border overflow-hidden">
            {KINDS.map((k) => (
              <button key={k.key} type="button" onClick={() => { setKind(k.key); setPage(1); }} className={segBtn(kind === k.key)}>{k.label}</button>
            ))}
          </div>
          <a href="/intro" target="_blank" rel="noreferrer" className="text-sm text-cyan-700 hover:underline">소개 페이지 열기</a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">시각</th>
                <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">구분</th>
                <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">요청자</th>
                <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">IP</th>
                <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">같은 IP 로그인 계정</th>
                <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">브라우저 · 들어온 곳</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">불러오는 중...</td></tr>
              )}
              {error && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-red-600">{error}</td></tr>
              )}
              {data && data.rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  {kind === 'request' ? '아직 시연 요청이 없습니다.' : '아직 방문 기록이 없습니다.'}
                </td></tr>
              )}
              {data?.rows.map((r) => (
                <Fragment key={r.id}>
                  <tr onClick={() => setOpen(open === r.id ? null : r.id)} className="border-t hover:bg-gray-50 cursor-pointer">
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-gray-700">{fmt(r.at)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${r.kind === 'request' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                        {r.kind === 'request' ? '시연 요청' : '방문'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-900">
                      {r.request ? `${r.request.companyName} · ${r.request.contactName}` : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-gray-700">{r.ip || '-'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {r.sameIpLogins.length === 0 ? <span className="text-gray-400">없음</span> : (
                        <span className="inline-flex flex-wrap gap-1">
                          {r.sameIpLogins.slice(0, 3).map((l) => (
                            <span key={l.loginId} className="px-2 py-0.5 rounded-full text-xs bg-amber-50 text-amber-800">{l.loginId}</span>
                          ))}
                          {r.sameIpLogins.length > 3 && <span className="text-xs text-gray-500">외 {r.sameIpLogins.length - 3}</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">{uaShort(r.userAgent)}{r.from ? ` · ${r.from}` : ''}</td>
                  </tr>
                  {open === r.id && (
                    <tr key={`${r.id}-d`} className="bg-gray-50/70">
                      <td colSpan={6} className="px-4 py-3 text-sm text-gray-700 space-y-1.5">
                        {r.request && (
                          <>
                            <p>연락처 <span className="font-medium tabular-nums">{phoneFmt(r.request.phone)}</span> · 희망 {r.request.method === 'video' ? '화상 시연' : '방문 시연'}</p>
                            {r.request.memo && <p className="whitespace-pre-line">궁금한 점: {r.request.memo}</p>}
                          </>
                        )}
                        {r.sameIpLogins.length > 0 && (
                          <p>같은 IP 로그인: {r.sameIpLogins.map((l) => `${l.loginId}${l.companyName ? `(${l.companyName})` : ''} 최근 ${fmt(l.lastAt)}`).join(' · ')}</p>
                        )}
                        <p className="text-xs text-gray-500 break-all">브라우저 원문: {r.userAgent || '-'}</p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <ListPager page={page} total={data?.total ?? 0} onPage={setPage} />
        <p className="px-5 py-2.5 border-t text-xs text-gray-500">
          Source: 소개 페이지 방문 · 시연 요청 기록 · 로그인 기록 IP 대조. 휴대폰 데이터 IP 는 통신사가 여러 사람에게 나눠 써서, IP 가 같다는 것만으로 같은 사람이라고 볼 수 없습니다.
        </p>
      </div>
    </div>
  );
}
