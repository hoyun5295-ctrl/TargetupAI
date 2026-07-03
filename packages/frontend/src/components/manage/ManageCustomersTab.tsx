import { useState, useEffect, useCallback, useRef } from 'react';
import { customersApi, manageUsersApi } from '../../api/client';
import { formatDateTime } from '../../utils/formatDate';

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

  // ★ 2026-07-03: 구매 이력 모달 (app.hanjul.ai CustomersTab과 동일 기능 — 두 앱 공통 반영)
  const [purchaseCustomer, setPurchaseCustomer] = useState<Customer | null>(null);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseData, setPurchaseData] = useState<{
    summary: { totalCount: number; totalAmount: number };
    purchases: Array<{ purchase_date: string; total_amount: number; quantity: number; store_code: string; store_name: string }>;
    pagination: Pagination;
  } | null>(null);
  // 요청 카운터 가드 — 연타/늦은 응답이 다른 고객 모달을 오염·강제 종료하지 않게 최신 요청만 반영
  const purchaseReqRef = useRef(0);
  const loadPurchases = async (customer: Customer, page = 1) => {
    const reqId = ++purchaseReqRef.current;
    const isInitial = purchaseCustomer?.id !== customer.id || !purchaseData;
    setPurchaseCustomer(customer);
    if (isInitial) setPurchaseData(null);
    setPurchaseLoading(true);
    try {
      const res = await customersApi.purchases(customer.id, { page, limit: 20 });
      if (purchaseReqRef.current !== reqId) return;
      setPurchaseData({
        summary: res.data.summary || { totalCount: 0, totalAmount: 0 },
        purchases: res.data.purchases || [],
        pagination: res.data.pagination || { total: 0, page, limit: 20, totalPages: 0 },
      });
    } catch (e: any) {
      if (purchaseReqRef.current !== reqId) return;
      setToast({ msg: e.response?.data?.error || '구매 이력 조회 실패', type: 'error' });
      // 최초 열기 실패만 모달 닫기 — 페이지 이동 실패는 보던 데이터 유지
      if (isInitial) {
        setPurchaseCustomer(null);
        setPurchaseData(null);
      }
    } finally {
      if (purchaseReqRef.current === reqId) setPurchaseLoading(false);
    }
  };
  const closePurchaseModal = () => {
    purchaseReqRef.current++; // 진행 중 요청 무효화
    setPurchaseCustomer(null);
    setPurchaseData(null);
    setPurchaseLoading(false);
  };

  // ★ D144 P5 (2026-05-07): 고객DB 전체 삭제
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [deleteAllConfirmInput, setDeleteAllConfirmInput] = useState('');
  const [deletingAll, setDeletingAll] = useState(false);
  const [deleteAllResult, setDeleteAllResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleDeleteAll = async () => {
    if (!deleteAllConfirmInput.trim()) {
      setDeleteAllResult({ ok: false, message: '회사명을 입력해주세요' });
      return;
    }
    setDeletingAll(true);
    setDeleteAllResult(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/customers/delete-all', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmCompanyName: deleteAllConfirmInput.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setDeleteAllResult({ ok: true, message: `${data.deletedCount?.toLocaleString() || 0}명의 고객 데이터가 전체 삭제되었습니다` });
        setTimeout(() => {
          setShowDeleteAllModal(false);
          setDeleteAllConfirmInput('');
          setDeleteAllResult(null);
          loadCustomers(1);
        }, 2000);
      } else {
        setDeleteAllResult({ ok: false, message: data.error || '삭제 실패' });
      }
    } catch (e) {
      setDeleteAllResult({ ok: false, message: '네트워크 오류' });
    } finally {
      setDeletingAll(false);
    }
  };

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
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M17 21v-2a4 4 0 0 0-3-3.87" /><path d="M9 21v-2a4 4 0 0 0-4-4H4" /><circle cx="9" cy="7" r="4" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            </span>
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">고객 DB 관리</h2>
              <p className="text-xs text-slate-400 mt-0.5">총 <span className="font-semibold text-slate-600 tabular-nums">{pagination.total.toLocaleString()}</span>명</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* ★ 사용자별 필터 (2명 이상일 때만 표시) */}
            {users.length >= 1 && (
              <select
                value={filterUserId}
                onChange={(e) => setFilterUserId(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 outline-none transition"
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
                className="pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 w-56 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 outline-none transition"
              />
              <svg className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <button onClick={handleSearch}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 shadow-sm shadow-indigo-600/20 transition">
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

            {/* ★ D144 P5: 전체 삭제 (회사명 입력 안전장치) */}
            {pagination.total > 0 && (
              <button
                onClick={() => { setShowDeleteAllModal(true); setDeleteAllConfirmInput(''); setDeleteAllResult(null); }}
                className="px-4 py-2 bg-red-700 text-white rounded-lg text-sm font-medium hover:bg-red-800 transition flex items-center gap-1.5"
                title="고객 DB 전체 영구 삭제 (회사명 확인 필요)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                전체 삭제
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ★ D144 P5: 고객 DB 전체 삭제 confirm 모달 */}
      {showDeleteAllModal && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in">
            <div className="px-6 py-5">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-slate-900 tracking-tight">고객 DB 전체 삭제</h3>
                  <p className="text-sm text-slate-600 mt-1">
                    등록된 모든 고객 데이터({pagination.total.toLocaleString()}명), 구매내역, 수신거부, 필드 정의가 <strong className="text-red-600">영구 삭제</strong>됩니다. 복구 불가능합니다.
                  </p>
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-800">
                <strong>안전 확인:</strong> 본인 회사의 정확한 회사명을 아래에 입력해야 삭제됩니다.
              </div>
              <input
                type="text"
                value={deleteAllConfirmInput}
                onChange={(e) => { setDeleteAllConfirmInput(e.target.value); setDeleteAllResult(null); }}
                placeholder="회사명을 정확히 입력하세요"
                disabled={deletingAll}
                className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg text-sm focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 outline-none disabled:bg-slate-50"
                onKeyDown={(e) => { if (e.key === 'Enter' && !deletingAll) handleDeleteAll(); }}
                autoFocus
              />
              {deleteAllResult && (
                <div className={`mt-3 p-3 rounded-lg text-sm ${deleteAllResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  {deleteAllResult.message}
                </div>
              )}
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2 rounded-b-xl">
              <button
                onClick={() => { setShowDeleteAllModal(false); setDeleteAllConfirmInput(''); setDeleteAllResult(null); }}
                disabled={deletingAll}
                className="px-4 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={handleDeleteAll}
                disabled={deletingAll || !deleteAllConfirmInput.trim() || (deleteAllResult?.ok === true)}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {deletingAll ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="60" strokeLinecap="round" /></svg>
                    삭제 중...
                  </>
                ) : '영구 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 테이블 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100">
              <tr>
                <th className="px-4 py-3 text-center w-10">
                  <input type="checkbox"
                    checked={customers.length > 0 && selectedIds.size === customers.length}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">이름</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">전화번호</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">성별</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">등급</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">지역</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">매장</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">수신동의</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">총구매액</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">최근구매</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">등록일</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400 w-20">구매이력</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400 w-16">삭제</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr><td colSpan={13} className="text-center py-12 text-slate-400">불러오는 중...</td></tr>
              ) : customers.length === 0 ? (
                <tr><td colSpan={13} className="text-center py-12 text-slate-400">고객 데이터가 없습니다</td></tr>
              ) : customers.map((c) => (
                <tr key={c.id} className={`hover:bg-slate-50/70 transition ${selectedIds.has(c.id) ? 'bg-indigo-50/60' : ''}`}>
                  <td className="px-4 py-3 text-center">
                    <input type="checkbox"
                      checked={selectedIds.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                  </td>
                  <td className="px-4 py-3 text-left font-medium text-slate-800">{c.name || '-'}</td>
                  <td className="px-4 py-3 text-left text-slate-600">{c.phone || '-'}</td>
                  <td className="px-4 py-3 text-center">{formatGender(c.gender)}</td>
                  <td className="px-4 py-3 text-center">
                    {c.grade ? (
                      <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${
                        c.grade.toUpperCase() === 'VIP' ? 'bg-amber-100 text-amber-700' :
                        c.grade.toUpperCase() === 'GOLD' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>{c.grade}</span>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3 text-left text-slate-600">{c.region || '-'}</td>
                  <td className="px-4 py-3 text-left text-slate-600 text-xs">{c.store_name || c.store_code || '-'}</td>
                  <td className="px-4 py-3 text-center">
                    {c.sms_opt_in ? (
                      <span className="text-emerald-600 font-semibold">✓</span>
                    ) : (
                      <span className="text-rose-400">✗</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">{formatAmount(c.total_purchase_amount)}</td>
                  <td className="px-4 py-3 text-center text-slate-500 text-xs">
                    {c.recent_purchase_date ? formatDateTime(c.recent_purchase_date) : '-'}
                  </td>
                  <td className="px-4 py-3 text-center text-slate-500 text-xs">
                    {c.created_at ? formatDateTime(c.created_at) : '-'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => loadPurchases(c)}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                      title="구매 이력">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                      </svg>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => confirmDeleteOne(c)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
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
          <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
            <div className="text-xs text-slate-400 tabular-nums">
              {((pagination.page - 1) * pagination.limit) + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)}
              <span className="text-slate-300"> / 전체 {pagination.total.toLocaleString()}명</span>
            </div>
            <div className="flex gap-1">
              <button onClick={() => loadCustomers(1)} disabled={pagination.page === 1}
                className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 disabled:opacity-30 hover:bg-slate-50 transition">«</button>
              <button onClick={() => loadCustomers(pagination.page - 1)} disabled={pagination.page === 1}
                className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 disabled:opacity-30 hover:bg-slate-50 transition">‹</button>
              <span className="px-3 py-1.5 text-sm font-semibold text-indigo-600 tabular-nums">{pagination.page} / {pagination.totalPages}</span>
              <button onClick={() => loadCustomers(pagination.page + 1)} disabled={pagination.page === pagination.totalPages}
                className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 disabled:opacity-30 hover:bg-slate-50 transition">›</button>
              <button onClick={() => loadCustomers(pagination.totalPages)} disabled={pagination.page === pagination.totalPages}
                className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 disabled:opacity-30 hover:bg-slate-50 transition">»</button>
            </div>
          </div>
        )}
      </div>

      {/* ★ 2026-07-03: 구매 이력 모달 */}
      {purchaseCustomer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closePurchaseModal(); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col animate-in zoom-in-95 fade-in duration-200">
            {/* 헤더 */}
            <div className="flex items-start justify-between p-5 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-900 tracking-tight">구매 이력</h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  {purchaseCustomer.name || '-'} · {purchaseCustomer.phone}
                </p>
              </div>
              <button onClick={closePurchaseModal}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition" title="닫기">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 요약 — 페이지 이동 중에도 유지(총계는 불변, 깜빡임 방지) */}
            {purchaseData && (
              <div className="flex gap-2 px-5 pt-4">
                <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-medium">
                  총 {purchaseData.summary.totalCount.toLocaleString()}건
                </span>
                <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium">
                  총 구매액 {Number(purchaseData.summary.totalAmount).toLocaleString()}원
                </span>
              </div>
            )}

            {/* 목록 */}
            <div className="flex-1 overflow-y-auto p-5">
              {purchaseLoading ? (
                <div className="text-center py-12 text-slate-400">불러오는 중...</div>
              ) : !purchaseData || purchaseData.purchases.length === 0 ? (
                <div className="text-center py-12 text-slate-400">구매 이력이 없습니다</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-100">
                      <tr>
                        <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">구매일</th>
                        <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">금액</th>
                        <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">수량</th>
                        <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">매장</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {purchaseData.purchases.map((p, i) => (
                        <tr key={i} className="hover:bg-slate-50/70 transition">
                          <td className="px-3 py-2 text-left text-slate-700">{p.purchase_date || '-'}</td>
                          <td className="px-3 py-2 text-right text-slate-800 font-medium">{formatAmount(p.total_amount)}</td>
                          <td className="px-3 py-2 text-center text-slate-600">{p.quantity ?? '-'}</td>
                          <td className="px-3 py-2 text-left text-slate-600 text-xs">{p.store_name || p.store_code || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 페이지네이션 + 닫기 */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
              <div className="text-sm text-slate-500 tabular-nums">
                {purchaseData && purchaseData.pagination.totalPages > 1
                  ? `${purchaseData.pagination.page} / ${purchaseData.pagination.totalPages} 페이지`
                  : ''}
              </div>
              <div className="flex gap-1">
                {purchaseData && purchaseData.pagination.totalPages > 1 && (
                  <>
                    <button onClick={() => loadPurchases(purchaseCustomer, purchaseData.pagination.page - 1)}
                      disabled={purchaseLoading || purchaseData.pagination.page === 1}
                      className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 disabled:opacity-30 hover:bg-white transition">‹</button>
                    <button onClick={() => loadPurchases(purchaseCustomer, purchaseData.pagination.page + 1)}
                      disabled={purchaseLoading || purchaseData.pagination.page === purchaseData.pagination.totalPages}
                      className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 disabled:opacity-30 hover:bg-white transition">›</button>
                  </>
                )}
                <button onClick={closePurchaseModal}
                  className="px-4 py-1.5 text-sm font-medium border border-slate-200 rounded-lg text-slate-600 hover:bg-white transition ml-2">닫기</button>
              </div>
            </div>
          </div>
        </div>
      )}

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
              <h3 className="text-lg font-bold text-slate-900 tracking-tight text-center mb-2">
                {deleteTarget.type === 'individual' ? '고객 삭제' : '선택 삭제'}
              </h3>
              <p className="text-sm text-slate-500 text-center mb-1">
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
            <div className="flex border-t border-slate-100">
              <button onClick={() => { setShowDeleteModal(false); setDeleteTarget(null); }}
                className="flex-1 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 rounded-bl-2xl transition">
                취소
              </button>
              <button onClick={executeDelete} disabled={deleteLoading}
                className="flex-1 py-3 text-sm font-bold text-white bg-rose-500 hover:bg-rose-600 rounded-br-2xl transition disabled:opacity-50">
                {deleteLoading ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom fade-in duration-300">
          <div className={`px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white ${
            toast.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'
          }`}>
            {toast.msg}
          </div>
          {setTimeout(() => setToast(null), 3000) && null}
        </div>
      )}
    </div>
  );
}
