import { useState, useEffect, useCallback, useRef } from 'react';
import { manageStatsApi, manageUsersApi } from '../../api/client';
import { useLegacyToast } from '../ToastProvider';
import { formatDateTime, formatCampaignMessageForDisplay } from '../../utils/formatDate';

export default function StatsTab() {
  const [view, setView] = useState<'daily' | 'monthly'>('daily');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [page, setPage] = useState(1);
  const [channel, setChannel] = useState<'web' | 'agent' | 'test'>('web'); // ★ 2026-07-23 웹/에이전트/테스트 탭
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const setToast = useLegacyToast();

  // 사용자 필터
  const [users, setUsers] = useState<{ id: string; name: string; login_id: string }[]>([]);
  const [filterUserId, setFilterUserId] = useState('');

  // 상세
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailInfo, setDetailInfo] = useState<{ date: string } | null>(null);
  const [testDetailPage, setTestDetailPage] = useState(1);
  // ★ 2026-06-26 라프레리 신고: 캠페인별 발송 문안 전체 보기
  const [msgDetail, setMsgDetail] = useState<{ name: string; content: string } | null>(null);
  // ★ 2026-07-23 (서수란) 발송 통계 엑셀(CSV) 다운로드
  const [exporting, setExporting] = useState(false);

  const perPage = 10;

  // ★ B8 수정: race condition 방지 — 탭 전환 시 이전 응답 무시
  const requestIdRef = useRef(0);

  // 사용자 목록 로드
  useEffect(() => {
    manageUsersApi.list()
      .then((res: any) => setUsers(res.data.users || []))
      .catch(() => {});
  }, []);

  const loadStats = useCallback(async (p = 1) => {
    const currentRequestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const res = await manageStatsApi.send({
        view, startDate, endDate, page: p, limit: perPage,
        filterUserId: filterUserId || undefined,
      });
      // ★ stale 응답이면 무시 (탭 전환 race condition 방지)
      if (currentRequestId !== requestIdRef.current) return;
      setStats(res.data);
      setPage(p);
    } catch { /* */ } finally {
      if (currentRequestId === requestIdRef.current) setLoading(false);
    }
  }, [view, startDate, endDate, filterUserId]);

  useEffect(() => { loadStats(1); }, [loadStats]);

  const loadDetail = async (date: string) => {
    setDetailLoading(true);
    setDetailInfo({ date });
    setTestDetailPage(1);
    try {
      const res = await manageStatsApi.sendDetail({ view, date, filterUserId: filterUserId || undefined });
      setDetail(res.data);
    } catch {
      setToast({ msg: '상세 조회 실패', type: 'error' });
    } finally { setDetailLoading(false); }
  };

  // ★ 2026-07-23 (서수란) 엑셀(CSV) 다운로드 — 웹+에이전트 합산 한 파일
  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await manageStatsApi.exportCsv({ view, startDate, endDate, filterUserId: filterUserId || undefined });
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `발송통계_${startDate}_${endDate}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setToast({ msg: '엑셀 다운로드 실패', type: 'error' });
    } finally { setExporting(false); }
  };

  const formatNum = (n: any) => Number(n || 0).toLocaleString();

  // 페이징
  const totalPages = stats?.totalPages || 1;
  const rows = stats?.rows || [];
  const startIdx = rows.length > 0 ? (page - 1) * perPage + 1 : 0;
  const endIdx = rows.length > 0 ? (page - 1) * perPage + rows.length : 0;
  const totalCount = stats?.total || 0;

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('...');
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
      if (page < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  const testSummary = stats?.testSummary;

  // ★ 2026-07-23 채널 탭 — 회사 usage_type로 노출 탭 결정 (web=웹+테스트 / agent=에이전트+테스트 / both=3탭)
  const usageType: string = stats?.usageType || 'web';
  const availableTabs: ('web' | 'agent' | 'test')[] =
    usageType === 'agent' ? ['agent', 'test']
      : usageType === 'both' ? ['web', 'agent', 'test']
        : ['web', 'test'];
  useEffect(() => {
    if (!availableTabs.includes(channel)) setChannel(availableTabs[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usageType]);
  const TAB_LABEL: Record<string, string> = { web: '웹 발송', agent: '에이전트 발송', test: '테스트 발송' };
  const agentSummary = stats?.agentSummary;
  const agentRows: any[] = stats?.agentRows || [];
  const agentByType: any[] = stats?.agentByType || [];
  const activeSummary = channel === 'agent' ? agentSummary : stats?.summary;

  return (
    <>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* 헤더 */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></svg>
          </span>
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">발송 통계</h2>
            <p className="text-xs text-slate-400 mt-0.5">기간·사용자별 발송 실적과 상세 내역</p>
          </div>
        </div>

        {/* ★ 2026-07-23 채널 탭 — 웹/에이전트/테스트 */}
        {availableTabs.length > 1 && (
          <div className="px-6 pt-3 flex items-center gap-1 border-b border-slate-100">
            {availableTabs.map((t) => (
              <button key={t} onClick={() => setChannel(t)}
                className={`px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 -mb-px transition ${channel === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
        )}

        {/* 필터 */}
        <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            {(['daily', 'monthly'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {v === 'daily' ? '일별' : '월별'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 outline-none transition" />
            <span className="text-slate-300">~</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 outline-none transition" />
          </div>
          {channel === 'web' && users.length > 1 && (
            <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 outline-none transition">
              <option value="">전체 사용자</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name || u.login_id}</option>
              ))}
            </select>
          )}
          <button onClick={() => loadStats(1)}
            className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-lg text-sm font-semibold shadow-sm shadow-indigo-600/20 transition">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
            조회
          </button>
          {/* ★ 2026-07-23 (서수란) 웹+에이전트 발송 수량을 한 파일로 — 정산 오차 확인용 */}
          <button onClick={handleExport} disabled={exporting} title="웹+에이전트 발송 수량(발송ID·유형별)을 한 파일로 내려받습니다"
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-semibold transition disabled:opacity-50">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
            {exporting ? '내보내는 중…' : '엑셀 다운로드'}
          </button>
        </div>

        {/* ★ 2026-07-23 요약 — 채널별 (웹/에이전트 = 총발송·성공·실패 / 테스트 = 테스트 요약) */}
        {channel === 'test' ? (
          <div className="px-6 py-5 grid grid-cols-2 md:grid-cols-4 gap-3 border-b border-slate-100">
            <div className="rounded-2xl border border-amber-200/70 bg-amber-50/40 p-4">
              <span className="text-xs font-medium text-slate-500">총 테스트</span>
              <p className="mt-2.5 text-3xl font-bold tracking-tight text-amber-600 tabular-nums">{formatNum(testSummary?.total || 0)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <span className="text-xs font-medium text-slate-500">성공</span>
              <p className="mt-2.5 text-3xl font-bold tracking-tight text-emerald-600 tabular-nums">{formatNum(testSummary?.success || 0)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <span className="text-xs font-medium text-slate-500">실패</span>
              <p className={`mt-2.5 text-3xl font-bold tracking-tight tabular-nums ${Number(testSummary?.fail) > 0 ? 'text-rose-500' : 'text-slate-300'}`}>{formatNum(testSummary?.fail || 0)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <span className="text-xs font-medium text-slate-500">SMS / LMS · 비용</span>
              <p className="mt-2.5 text-base font-bold tracking-tight text-slate-700 tabular-nums">SMS {testSummary?.sms || 0} · LMS {testSummary?.lms || 0}</p>
              <p className="mt-1 text-sm font-semibold text-amber-600">{(testSummary?.cost || 0).toLocaleString()}원</p>
            </div>
          </div>
        ) : activeSummary ? (
          <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-3 gap-3 border-b border-slate-100">
            {/* 총 발송 */}
            <div className="group rounded-2xl border border-slate-200 bg-white p-4 transition hover:shadow-md hover:border-slate-300">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">총 발송</span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600 transition group-hover:scale-110">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
                </span>
              </div>
              <p className="mt-2.5 text-3xl font-bold tracking-tight text-slate-900 tabular-nums">{formatNum(activeSummary.total_sent)}</p>
            </div>
            {/* 성공 */}
            <div className="group rounded-2xl border border-slate-200 bg-white p-4 transition hover:shadow-md hover:border-slate-300">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">성공</span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 transition group-hover:scale-110">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" /></svg>
                </span>
              </div>
              <p className="mt-2.5 text-3xl font-bold tracking-tight text-emerald-600 tabular-nums">{formatNum(activeSummary.total_success)}</p>
            </div>
            {/* 실패 */}
            <div className="group rounded-2xl border border-slate-200 bg-white p-4 transition hover:shadow-md hover:border-slate-300">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">실패</span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-500 transition group-hover:scale-110">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></svg>
                </span>
              </div>
              <p className={`mt-2.5 text-3xl font-bold tracking-tight tabular-nums ${Number(activeSummary.total_fail) > 0 ? 'text-rose-500' : 'text-slate-300'}`}>{formatNum(activeSummary.total_fail)}</p>
            </div>
          </div>
        ) : null}
        {channel === 'agent' && (
          <>
            {agentByType.length > 0 && (
              <div className="px-6 pt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                {agentByType.map((t: any) => (
                  <div key={t.msg_type} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 text-xs font-semibold">{t.type_label || t.msg_type}</span>
                      <span className="text-[11px] text-slate-400">성공률 {Number(t.sent) > 0 ? `${((Number(t.success) / Number(t.sent)) * 100).toFixed(1)}%` : '-'}</span>
                    </div>
                    <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">{formatNum(t.success)}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">전송 {formatNum(t.sent)} · 실패 {formatNum(t.fail)}</p>
                  </div>
                ))}
              </div>
            )}
            <p className="px-6 pt-3 text-[11px] text-slate-400 italic">에이전트 발송은 게이트웨이 엔진 집계(일 단위)로, 발송ID·유형(SMS/LMS/MMS/카카오알림톡)별로 나뉘며 수신자별 상세는 제공되지 않습니다. 웹+에이전트 합산 수량은 상단 ‘엑셀 다운로드’로 확인하세요.</p>
          </>
        )}

        {/* 테이블 — 웹/에이전트 (테스트는 요약 카드만) */}
        {channel !== 'test' && (
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
              <span className="text-sm">불러오는 중…</span>
            </div>
          ) : channel === 'agent' ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">{view === 'monthly' ? '월' : '날짜'}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">발송ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">유형</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">전송</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">성공</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">실패</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">대기</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {agentRows.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-16 text-center text-sm text-slate-400">표시할 에이전트 발송 내역이 없습니다.</td></tr>
                ) : agentRows.map((r: any, i: number) => (
                  <tr key={i} className="transition hover:bg-slate-50/70">
                    <td className="px-6 py-3.5 font-semibold text-slate-700">{r.period}</td>
                    <td className="px-4 py-3.5 text-left font-mono text-xs text-slate-600">{r.agent_send_id || '-'}</td>
                    <td className="px-4 py-3.5 text-left"><span className="px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 text-xs font-medium">{r.type_label || r.msg_type}</span></td>
                    <td className="px-4 py-3.5 text-right text-slate-700 font-medium tabular-nums">{formatNum(r.sent)}</td>
                    <td className="px-4 py-3.5 text-right text-emerald-600 font-semibold tabular-nums">{formatNum(r.success)}</td>
                    <td className={`px-4 py-3.5 text-right font-medium tabular-nums ${Number(r.fail) > 0 ? 'text-rose-500' : 'text-slate-300'}`}>{formatNum(r.fail)}</td>
                    <td className="px-6 py-3.5 text-right text-slate-400 tabular-nums">{formatNum(r.pending)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">{view === 'monthly' ? '월' : '날짜'}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">발송 횟수</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">발송</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">성공</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">실패</th>
                  <th className="px-6 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-400">상세</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-16 text-center text-sm text-slate-400">표시할 발송 내역이 없습니다.</td></tr>
                ) : rows.map((r: any, i: number) => {
                  const dateKey = r.period || r.date || r.month;
                  return (
                    <tr key={i} className="group transition hover:bg-slate-50/70">
                      <td className="px-6 py-3.5 font-semibold text-slate-700">{dateKey}</td>
                      <td className="px-4 py-3.5 text-right text-slate-500 tabular-nums">{formatNum(r.runs)}</td>
                      <td className="px-4 py-3.5 text-right text-slate-700 font-medium tabular-nums">{formatNum(r.sent)}</td>
                      <td className="px-4 py-3.5 text-right text-emerald-600 font-semibold tabular-nums">{formatNum(r.success)}</td>
                      <td className={`px-4 py-3.5 text-right font-medium tabular-nums ${Number(r.fail) > 0 ? 'text-rose-500' : 'text-slate-300'}`}>{formatNum(r.fail)}</td>
                      <td className="px-6 py-3.5 text-center">
                        <button onClick={() => loadDetail(dateKey)}
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 transition">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
                          보기
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        )}

        {/* 페이징 — 웹만 서버 페이징 */}
        {channel === 'web' && totalPages > 1 && (
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-400 tabular-nums">
              {startIdx}–{endIdx} / 전체 {totalCount}건
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => loadStats(Math.max(1, page - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
                이전
              </button>
              {getPageNumbers().map((p, i) =>
                p === '...' ? (
                  <span key={`dots-${i}`} className="px-2 text-slate-300">…</span>
                ) : (
                  <button key={p} onClick={() => loadStats(p as number)}
                    className={`min-w-[2.25rem] px-3 py-1.5 text-sm font-medium rounded-lg transition tabular-nums ${p === page ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    {p}
                  </button>
                )
              )}
              <button onClick={() => loadStats(Math.min(totalPages, page + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
                다음
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 상세 모달 */}
      {detailInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-[fadeIn_0.15s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl mx-4 max-h-[85vh] overflow-auto animate-[zoomIn_0.2s_ease-out]"
            onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5 bg-gradient-to-r from-indigo-50 via-white to-white border-b border-slate-100 sticky top-0 z-10">
              <div className="flex justify-between items-center gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-600/20">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></svg>
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">발송 상세</p>
                    <h3 className="text-lg font-bold text-slate-900 tracking-tight">{detailInfo.date}</h3>
                  </div>
                </div>
                <button onClick={() => { setDetailInfo(null); setDetail(null); }}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-white transition text-xl leading-none">✕</button>
              </div>
            </div>

            {detailLoading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                <span className="text-sm">불러오는 중…</span>
              </div>
            ) : detail ? (
              <div className="p-6 space-y-6">
                {/* 사용자별 통계 (비용 포함) */}
                {detail.userStats?.length > 0 && (
                  <div>
                    <h4 className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-2.5">
                      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-violet-100 text-violet-600">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                      </span>
                      사용자별
                    </h4>
                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr className="border-b border-slate-100">
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">이름</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">부서</th>
                          <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">발송</th>
                          <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">성공</th>
                          <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">실패</th>
                          <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">비용</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {detail.userStats.map((u: any, i: number) => (
                          <tr key={i} className="hover:bg-slate-50/70 transition">
                            <td className="px-4 py-2.5 font-semibold text-slate-700">{u.user_name || '미지정'}</td>
                            <td className="px-4 py-2.5 text-slate-500">{u.department || '-'}</td>
                            <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums">{formatNum(u.sent)}</td>
                            <td className="px-4 py-2.5 text-right text-emerald-600 font-medium tabular-nums">{formatNum(u.success)}</td>
                            <td className="px-4 py-2.5 text-right text-rose-500 tabular-nums">{formatNum(u.fail)}</td>
                            <td className="px-4 py-2.5 text-right text-amber-600 font-semibold tabular-nums">
                              {(u.cost || 0).toLocaleString()}원
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>
                )}

                {/* 캠페인 상세 */}
                {detail.campaigns?.length > 0 && (
                  <div>
                    <h4 className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-2.5">
                      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-indigo-100 text-indigo-600">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></svg>
                      </span>
                      캠페인별
                    </h4>
                    <div className="rounded-xl border border-slate-200 overflow-x-auto">
                    <table className="w-full text-sm whitespace-nowrap">
                      <thead className="bg-slate-50">
                        <tr className="border-b border-slate-100">
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">캠페인</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">유형</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">담당자</th>
                          <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">발송</th>
                          <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">성공</th>
                          <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">실패</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">메시지내용</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {detail.campaigns.map((c: any, i: number) => (
                          <tr key={i} className="hover:bg-slate-50/70 transition">
                            <td className="px-4 py-2.5 font-semibold text-slate-700 max-w-[280px] truncate">{c.campaign_name}</td>
                            <td className="px-4 py-2.5">
                              <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${c.send_type === 'ai' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
                                {c.send_type === 'ai' ? 'AI' : '수동'}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-slate-500">{c.user_name || '-'}</td>
                            <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums">{formatNum(c.sent_count)}</td>
                            <td className="px-4 py-2.5 text-right text-emerald-600 font-medium tabular-nums">{formatNum(c.success_count)}</td>
                            <td className="px-4 py-2.5 text-right text-rose-500 tabular-nums">{formatNum(c.fail_count)}</td>
                            <td className="px-4 py-2.5 text-left max-w-[420px]">
                              {c.message_content ? (() => {
                                const full = formatCampaignMessageForDisplay(c);
                                return (
                                  <span className="group/msg inline-flex items-center gap-1 max-w-full truncate text-xs text-slate-500 cursor-pointer hover:text-indigo-600 transition"
                                    title="클릭하여 전체 메시지 보기"
                                    onClick={() => setMsgDetail({ name: c.campaign_name, content: full })}>
                                    <span className="truncate">{full.slice(0, 60)}{full.length > 60 ? '…' : ''}</span>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0 opacity-0 group-hover/msg:opacity-100 transition"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
                                  </span>
                                );
                              })() : <span className="text-slate-300">-</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>
                )}

                {/* 테스트 발송 내역 (담당자 + 스팸필터 통합) */}
                {detail.testDetail?.length > 0 && (
                  <div>
                    <h4 className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-2.5">
                      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-100 text-amber-600">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><path d="M14.5 2v17.5c0 1.4-1.1 2.5-2.5 2.5s-2.5-1.1-2.5-2.5V2" /><path d="M8.5 2h7" /><path d="M9.5 16h5" /></svg>
                      </span>
                      테스트 발송 <span className="text-slate-400 font-medium">({detail.testDetail.length}건)</span>
                    </h4>
                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr className="border-b border-slate-100">
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">구분</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">수신번호</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">유형</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">상태</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">발송시간</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {detail.testDetail
                          .slice((testDetailPage - 1) * 10, testDetailPage * 10)
                          .map((t: any, i: number) => (
                          <tr key={i} className="hover:bg-slate-50/70 transition">
                            <td className="px-4 py-2.5">
                              <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${
                                t.testType === 'spam_filter' ? 'bg-violet-100 text-violet-700' : 'bg-orange-100 text-orange-700'
                              }`}>
                                {t.testType === 'spam_filter' ? '스팸필터' : '담당자'}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{t.phone}</td>
                            <td className="px-4 py-2.5">
                              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-md">
                                {t.msgType}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              {t.testType === 'spam_filter' ? (
                                <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${
                                  t.result === 'pass' ? 'bg-emerald-100 text-emerald-700' :
                                  t.result === 'blocked' ? 'bg-rose-100 text-rose-700' :
                                  'bg-slate-100 text-slate-600'
                                }`}>
                                  {t.result === 'pass' ? '정상' : t.result === 'blocked' ? '차단' : '대기'}
                                </span>
                              ) : (
                                <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${
                                  t.status === 'success' ? 'bg-emerald-100 text-emerald-700' :
                                  t.status === 'pending' ? 'bg-slate-100 text-slate-600' :
                                  'bg-rose-100 text-rose-700'
                                }`}>
                                  {t.status === 'success' ? '성공' : t.status === 'pending' ? '대기' : '실패'}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-slate-400 text-xs tabular-nums">
                              {formatDateTime(t.sentAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {detail.testDetail.length > 10 && (
                      <div className="flex justify-center items-center gap-3 py-3 border-t border-slate-100 bg-slate-50/50">
                        <button onClick={() => setTestDetailPage(p => Math.max(1, p - 1))} disabled={testDetailPage === 1} className="px-3 py-1 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition">이전</button>
                        <span className="text-xs text-slate-400 tabular-nums">{testDetailPage} / {Math.ceil(detail.testDetail.length / 10)}</span>
                        <button onClick={() => setTestDetailPage(p => Math.min(Math.ceil(detail.testDetail.length / 10), p + 1))} disabled={testDetailPage >= Math.ceil(detail.testDetail.length / 10)} className="px-3 py-1 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition">다음</button>
                      </div>
                    )}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* 메시지내용 전체 보기 모달 */}
      {msgDetail && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-[fadeIn_0.15s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[82vh] flex flex-col overflow-hidden animate-[zoomIn_0.2s_ease-out]" onClick={(e) => e.stopPropagation()}>
            {/* 헤더 */}
            <div className="px-5 py-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-100 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-500 uppercase tracking-wide">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  메시지 내용
                </div>
                <h4 className="text-sm font-bold text-gray-900 truncate mt-0.5">{msgDetail.name}</h4>
              </div>
              <button onClick={() => setMsgDetail(null)} className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-white/70 transition-colors text-lg leading-none">✕</button>
            </div>
            {/* 본문 */}
            <div className="p-5 overflow-auto">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-words select-text">{msgDetail.content}</div>
            </div>
            {/* 푸터 — 글자 수 + 복사 */}
            <div className="px-5 py-3 border-t border-gray-100 bg-white flex items-center justify-between gap-3">
              <span className="text-[11px] text-gray-400">{msgDetail.content.length}자</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setMsgDetail(null)} className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">닫기</button>
                <button
                  onClick={async () => {
                    const text = msgDetail.content;
                    try {
                      await navigator.clipboard.writeText(text);
                      setToast({ msg: '메시지를 복사했습니다', type: 'success' });
                    } catch {
                      const ta = document.createElement('textarea');
                      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
                      document.body.appendChild(ta); ta.select();
                      try { document.execCommand('copy'); setToast({ msg: '메시지를 복사했습니다', type: 'success' }); }
                      catch { setToast({ msg: '복사 실패 — 본문을 직접 선택해 복사해주세요', type: 'error' }); }
                      document.body.removeChild(ta);
                    }
                  }}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg shadow-sm transition-colors inline-flex items-center gap-1.5"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                  복사
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
