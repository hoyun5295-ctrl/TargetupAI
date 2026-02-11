import { useState, useEffect } from 'react';
import { manageScheduledApi } from '../api/client';
import CustomModal from './CustomModal';
import Toast from './Toast';
import { formatDateTime } from '../utils/formatDate';

interface Campaign {
  id: string;
  campaign_name: string;
  status: string;
  scheduled_at: string;
  target_count: number;
  created_at: string;
  created_by_name: string;
  cancel_reason: string;
  cancelled_at: string;
  cancelled_by_type: string;
}

// 공통 페이징 컴포넌트
function Pagination({ page, totalPages, total, perPage, onPage }: {
  page: number; totalPages: number; total: number; perPage: number; onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="px-6 py-3 border-t flex items-center justify-between">
      <span className="text-sm text-gray-500">
        {(page - 1) * perPage + 1}~{Math.min(page * perPage, total)} / {total}건
      </span>
      <div className="flex gap-1">
        <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page === 1}
          className="px-3 py-1 rounded text-sm bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed">
          ◀ 이전
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1)
          .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
          .reduce((acc: (number | string)[], p, idx, arr) => {
            if (idx > 0 && (arr[idx - 1] as number) < p - 1) acc.push('...');
            acc.push(p);
            return acc;
          }, [])
          .map((p, i) =>
            p === '...' ? (
              <span key={`dot-${i}`} className="px-2 py-1 text-sm text-gray-400">…</span>
            ) : (
              <button key={p} onClick={() => onPage(p as number)}
                className={`px-3 py-1 rounded text-sm ${p === page ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {p}
              </button>
            )
          )}
        <button onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}
          className="px-3 py-1 rounded text-sm bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed">
          다음 ▶
        </button>
      </div>
    </div>
  );
}

export default function ScheduledTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'scheduled' | 'cancelled'>('all');
  const [filterUser, setFilterUser] = useState('');
  const [page, setPage] = useState(1);
  const perPage = 10;

  // 취소 모달
  const [showCancel, setShowCancel] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Campaign | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  // 알림 모달
  const [modal, setModal] = useState<{
    show: boolean; title: string; message: string;
    variant: 'success' | 'error' | 'warning' | 'info'; type: 'alert' | 'confirm';
  }>({ show: false, title: '', message: '', variant: 'info', type: 'alert' });

  useEffect(() => { loadCampaigns(); }, []);

  const loadCampaigns = async () => {
    try {
      const res = await manageScheduledApi.list();
      setCampaigns(res.data.campaigns);
    } catch { /* */ } finally { setLoading(false); }
  };

  // 고유 사용자 목록 추출
  const uniqueUsers = Array.from(new Set(campaigns.map(c => c.created_by_name).filter(Boolean))).sort();

  // 검색 + 상태 + 사용자 필터
  const filtered = campaigns.filter(c => {
    const matchSearch = !search ||
      c.campaign_name.toLowerCase().includes(search.toLowerCase()) ||
      (c.created_by_name || '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    const matchUser = !filterUser || c.created_by_name === filterUser;
    return matchSearch && matchStatus && matchUser;
  });

  // 정렬: 예약대기 먼저 → 취소 뒤로, 각각 날짜 내림차순
  const sorted = [...filtered].sort((a, b) => {
    if (a.status === 'scheduled' && b.status !== 'scheduled') return -1;
    if (a.status !== 'scheduled' && b.status === 'scheduled') return 1;
    const dateA = a.status === 'scheduled' ? a.scheduled_at : a.cancelled_at;
    const dateB = b.status === 'scheduled' ? b.scheduled_at : b.cancelled_at;
    return new Date(dateB || '').getTime() - new Date(dateA || '').getTime();
  });

  const totalPages = Math.ceil(sorted.length / perPage);
  const paged = sorted.slice((page - 1) * perPage, page * perPage);

  const scheduledCount = campaigns.filter(c => c.status === 'scheduled').length;
  const cancelledCount = campaigns.filter(c => c.status === 'cancelled').length;

  const openCancel = (c: Campaign) => {
    setCancelTarget(c);
    setCancelReason('');
    setShowCancel(true);
  };

  const handleCancel = async () => {
    if (!cancelTarget || !cancelReason.trim()) {
      setToast({ msg: '취소 사유를 입력해주세요.', type: 'error' });
      return;
    }
    try {
      await manageScheduledApi.cancel(cancelTarget.id, cancelReason.trim());
      setToast({ msg: '예약이 취소되었습니다.', type: 'success' });
      setShowCancel(false);
      loadCampaigns();
    } catch (err: any) {
      setToast({ msg: err.response?.data?.error || '취소 실패', type: 'error' });
    }
  };

  const formatDate = (d: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  if (loading) return <div className="p-8 text-center text-gray-500">로딩 중...</div>;

  return (
    <>
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <CustomModal
        show={modal.show} title={modal.title} message={modal.message}
        variant={modal.variant} type={modal.type}
        onClose={() => setModal(prev => ({ ...prev, show: false }))}
      />

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">예약 캠페인</h2>
        </div>

        {/* 검색 + 상태 + 사용자 필터 */}
        <div className="px-6 py-3 bg-gray-50 border-b flex flex-wrap items-center gap-4">
          <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="🔍 캠페인명, 생성자 검색..."
            className="flex-1 max-w-xs px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          {uniqueUsers.length > 1 && (
            <select value={filterUser} onChange={(e) => { setFilterUser(e.target.value); setPage(1); }}
              className="px-3 py-2 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
              <option value="">👤 전체 사용자</option>
              {uniqueUsers.map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-2">
            {([
              { key: 'all', label: `전체 (${scheduledCount + cancelledCount})` },
              { key: 'scheduled', label: `⏰ 예약 (${scheduledCount})` },
              { key: 'cancelled', label: `🚫 취소 (${cancelledCount})` },
            ] as const).map(opt => (
              <button key={opt.key} onClick={() => { setStatusFilter(opt.key); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  statusFilter === opt.key
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border text-gray-600 hover:bg-gray-100'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
          <span className="text-sm text-gray-500">총 {filtered.length}건</span>
        </div>

        {/* 테이블 */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-center font-medium text-gray-600 w-20">상태</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">캠페인명</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">예약/취소 시간</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">대상</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">생성자</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">비고</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600 w-24">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {paged.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                  {campaigns.length === 0 ? '예약/취소된 캠페인이 없습니다.' : '검색 결과가 없습니다.'}
                </td></tr>
              ) : paged.map(c => (
                <tr key={c.id} className={`hover:bg-gray-50 ${c.status === 'cancelled' ? 'text-gray-400' : ''}`}>
                  <td className="px-4 py-3 text-center">
                    {c.status === 'scheduled' ? (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">예약</span>
                    ) : (
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-xs font-medium">취소</span>
                    )}
                  </td>
                  <td className={`px-4 py-3 font-medium ${c.status === 'cancelled' ? 'line-through' : ''}`}>
                    {c.campaign_name}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {c.status === 'scheduled' ? formatDate(c.scheduled_at) : formatDate(c.cancelled_at)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {(c.target_count || 0).toLocaleString()}명
                  </td>
                  <td className="px-4 py-3">{c.created_by_name || '-'}</td>
                  <td className="px-4 py-3 text-xs">
                    {c.status === 'cancelled' && (
                      <span className="text-gray-400">
                        {c.cancelled_by_type === 'super_admin' ? '운영자' : '관리자'} · {c.cancel_reason || '-'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {c.status === 'scheduled' && (
                      <button onClick={() => openCancel(c)}
                        className="px-3 py-1.5 text-xs bg-red-50 text-red-600 hover:bg-red-100 rounded-lg font-medium transition">
                        예약취소
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination page={page} totalPages={totalPages} total={sorted.length} perPage={perPage} onPage={setPage} />
      </div>

      {/* 취소 모달 */}
      {showCancel && cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-[fadeIn_0.15s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 animate-[zoomIn_0.2s_ease-out]">
            <div className="px-6 pt-6 pb-4 bg-red-50">
              <h3 className="text-lg font-bold text-gray-900">⚠️ 예약 취소</h3>
              <p className="mt-1 text-sm text-gray-600">{cancelTarget.campaign_name}</p>
            </div>
            <div className="px-6 py-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">취소 사유 *</label>
              <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                rows={3} placeholder="취소 사유를 입력해주세요..."
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-red-500 outline-none resize-none" />
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => setShowCancel(false)}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition">돌아가기</button>
              <button onClick={handleCancel}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition">취소 확정</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
