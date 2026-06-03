// components/admin/LoginBlocksManagement.tsx
// ★ D145 P0 (2026-05-07): 슈퍼관리자 로그인 차단 관리 화면
// 기능: 활성 차단 목록 / 이력 / 즉시 해제 / 수동 차단 추가

import { useEffect, useState } from 'react';
import { useToast } from '../ToastProvider';
import ConfirmModal, { type ConfirmState } from '../ConfirmModal';

interface LoginBlock {
  id: string;
  ip_address: string;
  login_id: string;
  blocked_at: string;
  expires_at: string;
  reason: string;
  fail_count: number;
  blocked_by: string | null;
  unblocked_at?: string | null;
  unblocked_by?: string | null;
  unblock_reason?: string | null;
  state?: 'active' | 'expired' | 'unblocked';
  remaining_seconds?: number;
  created_at?: string;
}

const REASON_LABEL: Record<string, string> = {
  auto_5fail_10min: '자동 (5회 실패)',
  manual: '수동',
};

function formatDate(s?: string | null): string {
  if (!s) return '-';
  return new Date(s).toLocaleString('ko-KR');
}

function formatRemain(seconds?: number): string {
  if (!seconds || seconds <= 0) return '만료';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}분 ${s}초`;
}

export default function LoginBlocksManagement() {
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [activeBlocks, setActiveBlocks] = useState<LoginBlock[]>([]);
  const [historyBlocks, setHistoryBlocks] = useState<LoginBlock[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [filterIp, setFilterIp] = useState('');
  const [filterLoginId, setFilterLoginId] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addIp, setAddIp] = useState('');
  const [addLoginId, setAddLoginId] = useState('');
  const [addDuration, setAddDuration] = useState(30);
  const [addReason, setAddReason] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const toast = useToast();

  const token = () => localStorage.getItem('token');

  const loadActive = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterIp) params.set('ip', filterIp);
      if (filterLoginId) params.set('loginId', filterLoginId);
      const res = await fetch(`/api/admin/login-blocks/active?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      setActiveBlocks(data.blocks || []);
    } catch (e) {
      console.error('활성 차단 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async (page: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '50');
      if (filterIp) params.set('ip', filterIp);
      if (filterLoginId) params.set('loginId', filterLoginId);
      const res = await fetch(`/api/admin/login-blocks/history?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      setHistoryBlocks(data.blocks || []);
      setHistoryTotal(data.pagination?.total || 0);
      setHistoryPage(page);
    } catch (e) {
      console.error('이력 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'active') loadActive();
    else loadHistory(1);
  }, [tab, refreshTick]);

  // 활성 탭은 10초마다 자동 갱신 (남은 시간 카운트다운)
  useEffect(() => {
    if (tab !== 'active') return;
    const t = setInterval(() => setRefreshTick((v) => v + 1), 10000);
    return () => clearInterval(t);
  }, [tab]);

  const handleUnblock = (blockId: string) => {
    setConfirm({
      mode: 'danger',
      title: '차단 해제',
      description: '이 차단을 즉시 해제하시겠습니까?',
      confirmLabel: '즉시 해제',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/admin/login-blocks/${blockId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'admin_unblock' }),
          });
          const data = await res.json();
          if (res.ok && data.success) {
            setRefreshTick((v) => v + 1);
          } else {
            toast.error(data.error || '해제 실패');
          }
        } catch (e: any) {
          toast.error(e?.message || '해제 중 오류');
        }
      },
    });
  };

  const handleAddBlock = async () => {
    if (!addIp.trim() || !addLoginId.trim()) {
      toast.error('IP와 loginId를 모두 입력해주세요.');
      return;
    }
    if (!Number.isFinite(addDuration) || addDuration <= 0) {
      toast.error('차단 시간은 1분 이상이어야 합니다.');
      return;
    }
    try {
      const res = await fetch('/api/admin/login-blocks', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ipAddress: addIp.trim(),
          loginId: addLoginId.trim(),
          durationMinutes: addDuration,
          reason: addReason.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowAddModal(false);
        setAddIp('');
        setAddLoginId('');
        setAddDuration(30);
        setAddReason('');
        setRefreshTick((v) => v + 1);
      } else {
        toast.error(data.error || '차단 추가 실패');
      }
    } catch (e: any) {
      toast.error(e?.message || '차단 추가 중 오류');
    }
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
      <div className="px-6 py-4 border-b flex justify-between items-center">
        <h2 className="text-lg font-semibold">로그인 차단 관리</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setRefreshTick((v) => v + 1)}
            className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded"
          >
            새로고침
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-3 py-1.5 text-sm bg-red-600 text-white hover:bg-red-700 rounded"
          >
            + 수동 차단
          </button>
        </div>
      </div>

      <div className="px-6 py-3 border-b flex gap-2">
        <button
          onClick={() => setTab('active')}
          className={`px-4 py-1.5 text-sm rounded ${tab === 'active' ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
        >
          현재 차단 ({activeBlocks.length})
        </button>
        <button
          onClick={() => setTab('history')}
          className={`px-4 py-1.5 text-sm rounded ${tab === 'history' ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
        >
          이력
        </button>
      </div>

      <div className="px-6 py-3 border-b flex gap-2">
        <input
          type="text"
          placeholder="IP 주소"
          value={filterIp}
          onChange={(e) => setFilterIp(e.target.value)}
          className="px-3 py-1.5 text-sm border rounded"
        />
        <input
          type="text"
          placeholder="로그인 ID"
          value={filterLoginId}
          onChange={(e) => setFilterLoginId(e.target.value)}
          className="px-3 py-1.5 text-sm border rounded"
        />
        <button
          onClick={() => setRefreshTick((v) => v + 1)}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded"
        >
          조회
        </button>
        {(filterIp || filterLoginId) && (
          <button
            onClick={() => { setFilterIp(''); setFilterLoginId(''); setRefreshTick((v) => v + 1); }}
            className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded"
          >
            초기화
          </button>
        )}
      </div>

      {loading && <div className="px-6 py-8 text-center text-gray-500">로딩 중...</div>}

      {!loading && tab === 'active' && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">IP</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">로그인 ID</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">차단 시각</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">만료 시각</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">남은 시간</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">실패 횟수</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">사유</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">액션</th>
              </tr>
            </thead>
            <tbody>
              {activeBlocks.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">현재 차단된 항목이 없습니다.</td></tr>
              ) : (
                activeBlocks.map((b) => (
                  <tr key={b.id} className="border-b hover:bg-gray-50">
                    <td className="px-3 py-2 text-sm font-mono">{b.ip_address}</td>
                    <td className="px-3 py-2 text-sm">{b.login_id}</td>
                    <td className="px-3 py-2 text-sm">{formatDate(b.blocked_at)}</td>
                    <td className="px-3 py-2 text-sm">{formatDate(b.expires_at)}</td>
                    <td className="px-3 py-2 text-sm font-medium text-amber-600">{formatRemain(b.remaining_seconds)}</td>
                    <td className="px-3 py-2 text-sm text-center">{b.fail_count}</td>
                    <td className="px-3 py-2 text-sm">{REASON_LABEL[b.reason] || b.reason}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => handleUnblock(b.id)}
                        className="px-2 py-1 text-xs bg-emerald-600 text-white hover:bg-emerald-700 rounded"
                      >
                        즉시 해제
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === 'history' && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">상태</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">IP</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">로그인 ID</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">차단 시각</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">만료/해제 시각</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">사유</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">해제 사유</th>
                </tr>
              </thead>
              <tbody>
                {historyBlocks.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">이력이 없습니다.</td></tr>
                ) : (
                  historyBlocks.map((b) => (
                    <tr key={b.id} className="border-b hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 text-xs rounded ${
                          b.state === 'active' ? 'bg-red-100 text-red-700' :
                          b.state === 'unblocked' ? 'bg-emerald-100 text-emerald-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {b.state === 'active' ? '차단중' : b.state === 'unblocked' ? '해제됨' : '만료'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-sm font-mono">{b.ip_address}</td>
                      <td className="px-3 py-2 text-sm">{b.login_id}</td>
                      <td className="px-3 py-2 text-sm">{formatDate(b.blocked_at)}</td>
                      <td className="px-3 py-2 text-sm">{formatDate(b.unblocked_at || b.expires_at)}</td>
                      <td className="px-3 py-2 text-sm">{REASON_LABEL[b.reason] || b.reason}</td>
                      <td className="px-3 py-2 text-sm text-gray-500">{b.unblock_reason || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {historyTotal > 50 && (
            <div className="px-6 py-3 border-t flex justify-center gap-1">
              {Array.from({ length: Math.ceil(historyTotal / 50) }, (_, i) => i + 1).slice(0, 20).map((p) => (
                <button
                  key={p}
                  onClick={() => loadHistory(p)}
                  className={`px-3 py-1 text-sm rounded ${p === historyPage ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[480px] max-w-[90vw]">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h3 className="text-lg font-semibold">수동 차단 추가</h3>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600">×</button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">IP 주소</label>
                <input
                  type="text"
                  value={addIp}
                  onChange={(e) => setAddIp(e.target.value)}
                  placeholder="예: 175.211.95.193"
                  className="w-full px-3 py-2 border rounded"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">로그인 ID</label>
                <input
                  type="text"
                  value={addLoginId}
                  onChange={(e) => setAddLoginId(e.target.value)}
                  placeholder="예: jessi1"
                  className="w-full px-3 py-2 border rounded"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">차단 시간 (분)</label>
                <select
                  value={addDuration}
                  onChange={(e) => setAddDuration(Number(e.target.value))}
                  className="w-full px-3 py-2 border rounded"
                >
                  <option value={30}>30분</option>
                  <option value={60}>1시간</option>
                  <option value={60 * 24}>24시간</option>
                  <option value={60 * 24 * 7}>7일</option>
                  <option value={60 * 24 * 30}>30일</option>
                  <option value={60 * 24 * 365}>1년 (사실상 영구)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">사유 (선택)</label>
                <input
                  type="text"
                  value={addReason}
                  onChange={(e) => setAddReason(e.target.value)}
                  placeholder="예: brute force 의심 IP"
                  className="w-full px-3 py-2 border rounded"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded"
              >
                취소
              </button>
              <button
                onClick={handleAddBlock}
                className="px-4 py-2 text-sm bg-red-600 text-white hover:bg-red-700 rounded"
              >
                차단 추가
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
