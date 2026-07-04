import { useState, useEffect, useCallback } from 'react';
import { customersApi, manageUsersApi } from '../api/client';
import { formatDateTime } from '../utils/formatDate';

interface Customer {
  id: string;
  name: string;
  phone: string;
  gender: string;
  grade: string;
  region: string;
  store_code: string;
  store_name: string;
  sms_opt_in: boolean;
  total_purchase_amount: number;
  recent_purchase_date: string;
  created_at: string;
}

interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface UserOption {
  id: string;
  name: string;
  login_id: string;
  department: string;
  store_codes: string[];
}

export default function CustomersTab() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 25, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ★ 사용자(ID)별 필터
  const [users, setUsers] = useState<UserOption[]>([]);
  const [filterUserId, setFilterUserId] = useState('');

  // 모달
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'individual' | 'bulk'; customer?: Customer; count?: number } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // 토스트
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // 사용자 목록 로드
  useEffect(() => {
    (async () => {
      try {
        const res = await manageUsersApi.list();
        const userList = (res.data.users || res.data || []).map((u: any) => ({
          id: u.id,
          name: u.name,
          login_id: u.login_id || u.loginId,
          department: u.department || '',
          store_codes: u.store_codes || [],
        }));
        setUsers(userList);
      } catch (e) {
        console.error('사용자 목록 조회 실패:', e);
      }
    })();
  }, []);

  const loadCustomers = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (search.trim()) params.search = search.trim();
      if (filterUserId) params.filterUserId = filterUserId;
      const res = await customersApi.list(params);
      setCustomers(res.data.customers || []);
      setPagination(res.data.pagination || { total: 0, page, limit: 25, totalPages: 0 });
      setSelectedIds(new Set());
    } catch (e: any) {
      setToast({ msg: e.response?.data?.error || '고객 목록 조회 실패', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [search, filterUserId]);

  useEffect(() => { loadCustomers(1); }, []);

  // ★ 사용자 필터 변경 시 재조회
  useEffect(() => { loadCustomers(1); }, [filterUserId]);

  const handleSearch = () => { loadCustomers(1); };
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleSearch(); };

  // 체크박스
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === customers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(customers.map(c => c.id)));
    }
  };

  // 개별 삭제 확인
  const confirmDeleteOne = (customer: Customer) => {
    setDeleteTarget({ type: 'individual', customer });
    setShowDeleteModal(true);
  };

  // 선택 삭제 확인
  const confirmDeleteBulk = () => {
    if (selectedIds.size === 0) return;
    setDeleteTarget({ type: 'bulk', count: selectedIds.size });
    setShowDeleteModal(true);
  };

  // 삭제 실행
  const executeDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      if (deleteTarget.type === 'individual' && deleteTarget.customer) {
        const res = await customersApi.deleteOne(deleteTarget.customer.id);
        setToast({ msg: res.data.message, type: 'success' });
      } else if (deleteTarget.type === 'bulk') {
        const res = await customersApi.bulkDelete(Array.from(selectedIds));
        setToast({ msg: res.data.message, type: 'success' });
      }
      setShowDeleteModal(false);
      setDeleteTarget(null);
      loadCustomers(pagination.page);
    } catch (e: any) {
      setToast({ msg: e.response?.data?.error || '삭제 실패', type: 'error' });
    } finally {
      setDeleteLoading(false);
    }
  };

  const formatGender = (g: string) => {
    if (!g) return '-';
    const v = g.toUpperCase();
    if (['M', '남', '남자', 'MALE'].includes(v)) return '남';
    if (['F', '여', '여자', 'FEMALE'].includes(v)) return '여';
    return g;
  };

  const formatAmount = (v: number) => {
    if (!v) return '-';
    return Number(v).toLocaleString() + '원';
  };

  return (
    <div className="space-y-4">
      {/* 상단 바 */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-gray-800">👥 고객 DB 관리</h2>
            <span className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
              총 {pagination.total.toLocaleString()}명
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* ★ 사용자별 필터 (2명 이상일 때만 표시) */}
            {users.length >= 2 && (
              <select
                value={filterUserId}
                onChange={(e) => setFilterUserId(e.target.value)}
                className="px-3 py-2 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">전체 사용자</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.login_id}){u.department ? ` - ${u.department}` : ''}
                  </option>
                ))}
              </select>
            )}

            {/* 검색 */}
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="이름 또는 전화번호 검색"
                className="pl-9 pr-3 py-2 border rounded-lg text-sm w-56 focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <button onClick={handleSearch}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition">
              조회
            </button>

            {/* 선택 삭제 */}
            {selectedIds.size > 0 && (
              <button onClick={confirmDeleteBulk}
                className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                선택 삭제 ({selectedIds.size}명)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-center w-10">
                  <input type="checkbox"
                    checked={customers.length > 0 && selectedIds.size === customers.length}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">이름</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">전화번호</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">성별</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">등급</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">지역</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">매장</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">수신동의</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">총구매액</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">최근구매</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">등록일</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600 w-16">삭제</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr><td colSpan={12} className="text-center py-12 text-gray-400">불러오는 중...</td></tr>
              ) : customers.length === 0 ? (
                <tr><td colSpan={12} className="text-center py-12 text-gray-400">고객 데이터가 없습니다</td></tr>
              ) : customers.map((c) => (
                <tr key={c.id} className={`hover:bg-gray-50 transition ${selectedIds.has(c.id) ? 'bg-blue-50/50' : ''}`}>
                  <td className="px-4 py-3 text-center">
                    <input type="checkbox"
                      checked={selectedIds.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  </td>
                  <td className="px-4 py-3 text-left font-medium text-gray-800">{c.name || '-'}</td>
                  <td className="px-4 py-3 text-left text-gray-600">{c.phone || '-'}</td>
                  <td className="px-4 py-3 text-center">{formatGender(c.gender)}</td>
                  <td className="px-4 py-3 text-center">
                    {c.grade ? (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        c.grade.toUpperCase() === 'VIP' ? 'bg-amber-100 text-amber-700' :
                        c.grade.toUpperCase() === 'GOLD' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{c.grade}</span>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3 text-left text-gray-600">{c.region || '-'}</td>
                  <td className="px-4 py-3 text-left text-gray-600 text-xs">{c.store_name || c.store_code || '-'}</td>
                  <td className="px-4 py-3 text-center">
                    {c.sms_opt_in ? (
                      <span className="text-green-600 font-medium">✓</span>
                    ) : (
                      <span className="text-red-400">✗</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{formatAmount(c.total_purchase_amount)}</td>
                  <td className="px-4 py-3 text-center text-gray-500 text-xs">
                    {c.recent_purchase_date ? formatDateTime(c.recent_purchase_date) : '-'}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-500 text-xs">
                    {c.created_at ? formatDateTime(c.created_at) : '-'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => confirmDeleteOne(c)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                      title="삭제">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
            <div className="text-sm text-gray-500">
              {((pagination.page - 1) * pagination.limit) + 1}~{Math.min(pagination.page * pagination.limit, pagination.total)}
              <span className="text-gray-400"> / {pagination.total.toLocaleString()}명</span>
            </div>
            <div className="flex gap-1">
              <button onClick={() => loadCustomers(1)} disabled={pagination.page === 1}
                className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-30 hover:bg-white transition">«</button>
              <button onClick={() => loadCustomers(pagination.page - 1)} disabled={pagination.page === 1}
                className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-30 hover:bg-white transition">‹</button>
              <span className="px-3 py-1.5 text-sm font-medium text-blue-600">{pagination.page} / {pagination.totalPages}</span>
              <button onClick={() => loadCustomers(pagination.page + 1)} disabled={pagination.page === pagination.totalPages}
                className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-30 hover:bg-white transition">›</button>
              <button onClick={() => loadCustomers(pagination.totalPages)} disabled={pagination.page === pagination.totalPages}
                className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-30 hover:bg-white transition">»</button>
            </div>
          </div>
        )}
      </div>

      {/* 삭제 확인 모달 */}
      {showDeleteModal && deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 animate-in zoom-in-95 fade-in duration-200">
            <div className="p-6">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900 text-center mb-2">
                {deleteTarget.type === 'individual' ? '고객 삭제' : '선택 삭제'}
              </h3>
              <p className="text-sm text-gray-500 text-center mb-1">
                {deleteTarget.type === 'individual'
                  ? `"${deleteTarget.customer?.name || deleteTarget.customer?.phone}" 고객을 삭제합니다.`
                  : `선택한 ${deleteTarget.count}명의 고객을 삭제합니다.`
                }
              </p>
              <p className="text-xs text-red-500 text-center font-medium">
                삭제된 데이터는 복구할 수 없습니다.
                <br />관련 구매내역도 함께 삭제됩니다.
              </p>
            </div>
            <div className="flex border-t">
              <button onClick={() => { setShowDeleteModal(false); setDeleteTarget(null); }}
                className="flex-1 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-bl-2xl transition">
                취소
              </button>
              <button onClick={executeDelete} disabled={deleteLoading}
                className="flex-1 py-3 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-br-2xl transition disabled:opacity-50">
                {deleteLoading ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] animate-in slide-in-from-bottom fade-in duration-300">
          <div className={`px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white ${
            toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
          }`}>
            {toast.msg}
          </div>
          {setTimeout(() => setToast(null), 3000) && null}
        </div>
      )}
    </div>
  );
}
