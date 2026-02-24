import { useState, useEffect, useCallback } from 'react';
import { manageStatsApi, manageUsersApi } from '../api/client';
import Toast from './Toast';
import { formatDateTime } from '../utils/formatDate';

export default function StatsTab() {
  const [view, setView] = useState<'daily' | 'monthly'>('daily');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // 사용자 필터
  const [users, setUsers] = useState<{ id: string; name: string; login_id: string }[]>([]);
  const [filterUserId, setFilterUserId] = useState('');

  // 상세
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailInfo, setDetailInfo] = useState<{ date: string } | null>(null);

  const perPage = 10;

  // 사용자 목록 로드
  useEffect(() => {
    manageUsersApi.list()
      .then((res: any) => setUsers(res.data.users || []))
      .catch(() => {});
  }, []);

  const loadStats = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await manageStatsApi.send({
        view, startDate, endDate, page: p, limit: perPage,
        filterUserId: filterUserId || undefined,
      });
      setStats(res.data);
      setPage(p);
    } catch { /* */ } finally { setLoading(false); }
  }, [view, startDate, endDate, filterUserId]);

  useEffect(() => { loadStats(1); }, [loadStats]);

  const loadDetail = async (date: string) => {
    setDetailLoading(true);
    setDetailInfo({ date });
    try {
      const res = await manageStatsApi.sendDetail({ view, date, filterUserId: filterUserId || undefined });
      setDetail(res.data);
    } catch {
      setToast({ msg: '상세 조회 실패', type: 'error' });
    } finally { setDetailLoading(false); }
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

  return (
    <>
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">발송 통계</h2>
        </div>

        {/* 필터 */}
        <div className="px-6 py-3 bg-gray-50 border-b flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <button onClick={() => setView('daily')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${view === 'daily' ? 'bg-blue-600 text-white' : 'bg-white border text-gray-600 hover:bg-gray-50'}`}>
              일별
            </button>
            <button onClick={() => setView('monthly')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${view === 'monthly' ? 'bg-blue-600 text-white' : 'bg-white border text-gray-600 hover:bg-gray-50'}`}>
              월별
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            <span className="text-gray-400">~</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          {users.length > 1 && (
            <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)}
              className="px-3 py-1.5 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
              <option value="">👤 전체 사용자</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name || u.login_id}</option>
              ))}
            </select>
          )}
          <button onClick={() => loadStats(1)}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition">
            조회
          </button>
        </div>

        {/* 요약 카드 — 실발송 3개 + 테스트 1개 (비용 포함) */}
        {stats?.summary && (
          <div className="px-6 py-4 grid grid-cols-4 gap-4 border-b">
            <div className="bg-blue-50 rounded-xl p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">총 발송</p>
              <p className="text-xl font-bold text-blue-700">{formatNum(stats.summary.total_sent)}</p>
            </div>
            <div className="bg-green-50 rounded-xl p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">성공</p>
              <p className="text-xl font-bold text-green-700">{formatNum(stats.summary.total_success)}</p>
            </div>
            <div className="bg-red-50 rounded-xl p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">실패</p>
              <p className="text-xl font-bold text-red-700">{formatNum(stats.summary.total_fail)}</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-4 text-center border border-amber-100">
              <p className="text-xs text-gray-500 mb-1">🧪 테스트</p>
              <p className="text-xl font-bold text-amber-700">{formatNum(testSummary?.total || 0)}</p>
              {testSummary && testSummary.total > 0 && (
                <>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    SMS {testSummary.sms} · LMS {testSummary.lms}
                  </p>
                  <p className="text-xs font-bold text-amber-600 mt-0.5">
                    {(testSummary.cost || 0).toLocaleString()}원
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {/* 테이블 */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center text-gray-500">로딩 중...</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">{view === 'monthly' ? '월' : '날짜'}</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">발송 횟수</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">발송</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">성공</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">실패</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">상세</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">데이터가 없습니다.</td></tr>
                ) : rows.map((r: any, i: number) => {
                  const dateKey = r.date || r.month;
                  return (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{dateKey}</td>
                      <td className="px-4 py-3 text-right">{formatNum(r.runs)}</td>
                      <td className="px-4 py-3 text-right">{formatNum(r.sent)}</td>
                      <td className="px-4 py-3 text-right text-green-600 font-medium">{formatNum(r.success)}</td>
                      <td className="px-4 py-3 text-right text-red-600">{formatNum(r.fail)}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => loadDetail(dateKey)}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium">보기</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 페이징 */}
        {totalPages > 1 && (
          <div className="px-6 py-3 border-t flex items-center justify-between">
            <span className="text-sm text-gray-500">
              {startIdx}~{endIdx} / {totalCount}건
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => loadStats(Math.max(1, page - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-sm rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
                이전
              </button>
              {getPageNumbers().map((p, i) =>
                p === '...' ? (
                  <span key={`dots-${i}`} className="px-2 text-gray-400">…</span>
                ) : (
                  <button key={p} onClick={() => loadStats(p as number)}
                    className={`px-3 py-1.5 text-sm rounded-lg transition ${p === page ? 'bg-blue-600 text-white' : 'bg-white border text-gray-600 hover:bg-gray-50'}`}>
                    {p}
                  </button>
                )
              )}
              <button onClick={() => loadStats(Math.min(totalPages, page + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 text-sm rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
                다음
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 상세 모달 */}
      {detailInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-[fadeIn_0.15s_ease-out]"
          onClick={() => { setDetailInfo(null); setDetail(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] overflow-auto animate-[zoomIn_0.2s_ease-out]"
            onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-b sticky top-0 z-10">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-gray-900">📊 {detailInfo.date} 상세</h3>
                <button onClick={() => { setDetailInfo(null); setDetail(null); }}
                  className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
              </div>
            </div>

            {detailLoading ? (
              <div className="p-8 text-center text-gray-500">로딩 중...</div>
            ) : detail ? (
              <div className="p-6 space-y-6">
                {/* 사용자별 통계 (비용 포함) */}
                {detail.userStats?.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">👤 사용자별</h4>
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">이름</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">부서</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-600">발송</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-600">성공</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-600">실패</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-600">비용</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {detail.userStats.map((u: any, i: number) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-medium">{u.user_name || '미지정'}</td>
                            <td className="px-3 py-2 text-gray-600">{u.department || '-'}</td>
                            <td className="px-3 py-2 text-right">{formatNum(u.sent)}</td>
                            <td className="px-3 py-2 text-right text-green-600">{formatNum(u.success)}</td>
                            <td className="px-3 py-2 text-right text-red-600">{formatNum(u.fail)}</td>
                            <td className="px-3 py-2 text-right text-amber-600 font-medium">
                              {(u.cost || 0).toLocaleString()}원
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 캠페인 상세 */}
                {detail.campaigns?.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">📋 캠페인별</h4>
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">캠페인</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">유형</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">담당자</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-600">발송</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-600">성공</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-600">실패</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {detail.campaigns.map((c: any, i: number) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-medium max-w-[200px] truncate">{c.campaign_name}</td>
                            <td className="px-3 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-xs ${c.send_type === 'ai' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                                {c.send_type === 'ai' ? 'AI' : '수동'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-600">{c.user_name || '-'}</td>
                            <td className="px-3 py-2 text-right">{formatNum(c.sent_count)}</td>
                            <td className="px-3 py-2 text-right text-green-600">{formatNum(c.success_count)}</td>
                            <td className="px-3 py-2 text-right text-red-600">{formatNum(c.fail_count)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 테스트 발송 내역 (담당자 + 스팸필터 통합) */}
                {detail.testDetail?.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">🧪 테스트 발송 ({detail.testDetail.length}건)</h4>
                    <table className="w-full text-sm">
                      <thead className="bg-amber-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">구분</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">수신번호</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">유형</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">상태</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">발송시간</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {detail.testDetail.map((t: any, i: number) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                t.testType === 'spam_filter' ? 'bg-violet-100 text-violet-700' : 'bg-orange-100 text-orange-700'
                              }`}>
                                {t.testType === 'spam_filter' ? '스팸필터' : '담당자'}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{t.phone}</td>
                            <td className="px-3 py-2">
                              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs rounded">
                                {t.msgType}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              {t.testType === 'spam_filter' ? (
                                <span className={`px-1.5 py-0.5 rounded text-xs ${
                                  t.result === 'pass' ? 'bg-green-100 text-green-700' :
                                  t.result === 'blocked' ? 'bg-red-100 text-red-700' :
                                  'bg-gray-100 text-gray-600'
                                }`}>
                                  {t.result === 'pass' ? '정상' : t.result === 'blocked' ? '차단' : '대기'}
                                </span>
                              ) : (
                                <span className={`px-1.5 py-0.5 rounded text-xs ${
                                  t.status === 'success' ? 'bg-green-100 text-green-700' :
                                  t.status === 'pending' ? 'bg-gray-100 text-gray-600' :
                                  'bg-red-100 text-red-700'
                                }`}>
                                  {t.status === 'success' ? '성공' : t.status === 'pending' ? '대기' : '실패'}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-gray-500 text-xs">
                              {formatDateTime(t.sentAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
