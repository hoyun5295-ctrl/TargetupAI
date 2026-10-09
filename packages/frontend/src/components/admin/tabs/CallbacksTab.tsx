/**
 * CallbacksTab — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import { formatDate } from '../../../utils/formatDate';
import TablePagination from '../../common/TablePagination';
import type { ModalState } from '../admin-types';

export interface CallbacksTabProps {
  allManagers: any[];
  callbackCompanyListPage: number;
  callbackCompanyPages: Record<string, number>;
  callbackNumbers: any[];
  callbackSearch: string;
  callbackSubTab: 'manage' | 'registrations' | 'managers';
  closeModal: () => void;
  downloadSenderDoc: (filename: string, originalName?: string) => Promise<void>;
  expandedCallbackCompanies: Set<string>;
  loadAllManagers: () => Promise<void>;
  loadCallbackNumbers: () => Promise<void>;
  loadSenderRegPendingCount: () => Promise<void>;
  mgrFilter: 'pending' | 'approved' | 'rejected' | 'all';
  mgrRejectId: string | null;
  mgrRejectReason: string;
  mgrSearch: string;
  pendingManagerCount: number;
  senderRegFilter: 'pending' | 'approved' | 'rejected' | 'all';
  senderRegLoading: boolean;
  senderRegPendingCount: number;
  senderRegistrations: any[];
  setCallbackCompanyListPage: Dispatch<SetStateAction<number>>;
  setCallbackCompanyPages: Dispatch<SetStateAction<Record<string, number>>>;
  setCallbackSearch: Dispatch<SetStateAction<string>>;
  setCallbackSubTab: Dispatch<SetStateAction<'manage' | 'registrations' | 'managers'>>;
  setEditingCallback: Dispatch<any>;
  setExpandedCallbackCompanies: Dispatch<SetStateAction<Set<string>>>;
  setMgrFilter: Dispatch<SetStateAction<'pending' | 'approved' | 'rejected' | 'all'>>;
  setMgrRejectId: Dispatch<SetStateAction<string | null>>;
  setMgrRejectReason: Dispatch<SetStateAction<string>>;
  setMgrSearch: Dispatch<SetStateAction<string>>;
  setModal: Dispatch<SetStateAction<ModalState>>;
  setRejectReasonInput: Dispatch<SetStateAction<string>>;
  setSenderRegDetail: Dispatch<any>;
  setSenderRegFilter: Dispatch<SetStateAction<'pending' | 'approved' | 'rejected' | 'all'>>;
  setShowCallbackModal: Dispatch<SetStateAction<boolean>>;
  setShowSenderRegDetailModal: Dispatch<SetStateAction<boolean>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export default function CallbacksTab(props: CallbacksTabProps) {
  const { allManagers, callbackCompanyListPage, callbackCompanyPages, callbackNumbers, callbackSearch, callbackSubTab, closeModal, downloadSenderDoc, expandedCallbackCompanies, loadAllManagers, loadCallbackNumbers, loadSenderRegPendingCount, mgrFilter, mgrRejectId, mgrRejectReason, mgrSearch, pendingManagerCount, senderRegFilter, senderRegLoading, senderRegPendingCount, senderRegistrations, setCallbackCompanyListPage, setCallbackCompanyPages, setCallbackSearch, setCallbackSubTab, setEditingCallback, setExpandedCallbackCompanies, setMgrFilter, setMgrRejectId, setMgrRejectReason, setMgrSearch, setModal, setRejectReasonInput, setSenderRegDetail, setSenderRegFilter, setShowCallbackModal, setShowSenderRegDetailModal, showAlert, showConfirm } = props;
  const CALLBACKS_PER_COMPANY_PAGE = 10;
  const CALLBACK_COMPANIES_PER_PAGE = 20;

  const loadSenderRegDetail = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/sender-registration/admin/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSenderRegDetail(data.registration);
        setShowSenderRegDetailModal(true);
        setRejectReasonInput('');
      }
    } catch (error) {
      console.error('신청 상세 로드 실패:', error);
    }
  };

  const handleApproveManager = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/sender-registration/admin/managers/${id}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (res.ok) {
        setModal({ type: 'alert', title: '승인 완료', message: '담당자 위임장이 승인되었습니다.', variant: 'success' });
        loadAllManagers();
        loadSenderRegPendingCount();
      } else {
        setModal({ type: 'alert', title: '승인 실패', message: data.error || '승인 처리에 실패했습니다.', variant: 'error' });
      }
    } catch (error) {
      console.error('담당자 승인 실패:', error);
      setModal({ type: 'alert', title: '오류', message: '승인 처리 중 오류가 발생했습니다.', variant: 'error' });
    }
  };

  const handleRejectManager = async (id: string, reason: string) => {
    if (!reason.trim()) {
      setModal({ type: 'alert', title: '입력 필요', message: '반려 사유를 입력해주세요.', variant: 'warning' });
      return;
    }
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/sender-registration/admin/managers/${id}/reject`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectReason: reason.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        setModal({ type: 'alert', title: '반려 완료', message: '담당자 위임장이 반려되었습니다.', variant: 'success' });
        loadAllManagers();
        loadSenderRegPendingCount();
      } else {
        setModal({ type: 'alert', title: '반려 실패', message: data.error || '반려 처리에 실패했습니다.', variant: 'error' });
      }
    } catch (error) {
      console.error('담당자 반려 실패:', error);
      setModal({ type: 'alert', title: '오류', message: '반려 처리 중 오류가 발생했습니다.', variant: 'error' });
    }
  };

  const handleDeleteCallback = (id: string, phone: string) => {
    showConfirm(
      '발신번호 삭제',
      `${phone} 번호를 삭제하시겠습니까?`,
      async () => {
        closeModal();
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/callback-numbers/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (!res.ok) throw new Error('삭제 실패');
          
          loadCallbackNumbers();
          showAlert('성공', '삭제되었습니다.', 'success');
        } catch (error) {
          showAlert('오류', '삭제 실패', 'error');
        }
      }
    );
  };

  const handleSetDefault = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/callback-numbers/${id}/default`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) throw new Error('설정 실패');
      
      loadCallbackNumbers();
      showAlert('성공', '대표번호로 설정되었습니다.', 'success');
    } catch (error) {
      showAlert('오류', '설정 실패', 'error');
    }
  };
  return (
    <>
    {(
          <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm">
            {/* 서브탭 */}
            <div className="border-b flex">
              <button
                onClick={() => setCallbackSubTab('manage')}
                className={`whitespace-nowrap px-6 py-3 text-[13px] font-medium border-b-2 ${
                  callbackSubTab === 'manage'
                    ? 'border-emerald-500 text-emerald-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                발신번호 관리
              </button>
              <button
                onClick={() => setCallbackSubTab('registrations')}
                className={`whitespace-nowrap px-6 py-3 text-[13px] font-medium border-b-2 ${
                  callbackSubTab === 'registrations'
                    ? 'border-emerald-500 text-emerald-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                등록 신청 관리
                {senderRegPendingCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
                    {senderRegPendingCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => setCallbackSubTab('managers')}
                className={`whitespace-nowrap px-6 py-3 text-[13px] font-medium border-b-2 ${
                  callbackSubTab === 'managers'
                    ? 'border-emerald-500 text-emerald-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                등록현황 관리
                {/* ★ 2026-08-08 (임은지 접수 3) 위임장 대기는 **이 탭**의 일이다 — 그전에는 옆 탭(등록 신청 관리)
                    뱃지로 떠서, 알림을 보고 간 담당자가 빈 목록을 보고 되돌아왔다. */}
                {pendingManagerCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
                    {pendingManagerCount}
                  </span>
                )}
              </button>
            </div>

            {/* 서브탭: 발신번호 관리 */}
            {callbackSubTab === 'manage' && (
              <>
            <div className="px-5 py-3.5 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-base font-semibold">발신번호 관리</h2>
              <button
                onClick={() => setShowCallbackModal(true)}
                className="whitespace-nowrap bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-[13px] font-medium"
              >
                + 발신번호 등록
              </button>
            </div>

            <div className="px-6 py-3 border-b bg-gray-50 flex gap-4 items-center">
              <input
                type="text"
                value={callbackSearch}
                onChange={(e) => { setCallbackSearch(e.target.value); setCallbackCompanyListPage(1); }}
                placeholder="고객사명, 번호로 검색..."
                className="w-full max-w-xs px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
              />
              {/* 검색과 무관한 전체 등록 수 — 검색 결과 건수는 아래 페이저가 '총 N개 회사 중' 으로 따로 보여준다 */}
              <span className="text-sm text-gray-500">전체 등록 {callbackNumbers.length}개</span>
            </div>

            <div>
              {(() => {
                // D144 P12: 번호 검색 추가 — 회사명 OR 번호(대시 제거 숫자 비교)
                const filtered = callbackNumbers.filter(cb => {
                  if (!callbackSearch) return true;
                  const searchLower = callbackSearch.toLowerCase();
                  if ((cb.company_name || '').toLowerCase().includes(searchLower)) return true;
                  const searchDigits = callbackSearch.replace(/[^0-9]/g, '');
                  if (searchDigits.length >= 2) {
                    const phoneDigits = String(cb.phone || '').replace(/[^0-9]/g, '');
                    if (phoneDigits.includes(searchDigits)) return true;
                  }
                  return false;
                });

                const grouped = filtered.reduce((acc: Record<string, { companyName: string; companyCode: string; items: any[] }>, cb: any) => {
                  const cid = cb.company_id || 'none';
                  if (!acc[cid]) {
                    acc[cid] = { companyName: cb.company_name || '미지정', companyCode: cb.company_code || '', items: [] };
                  }
                  acc[cid].items.push(cb);
                  return acc;
                }, {});

                const companyIds = Object.keys(grouped);
                // ★ 2026-07-25 (서수란) 회사 목록 페이징.
                //   '미지정'(회사 연결이 없는 발신번호)은 항상 첫 페이지에 둔다 — 페이징 때문에 뒤 페이지로 밀려
                //   슈퍼관리자 눈에서 사라지면 안 된다. 발신번호는 발송 가능 번호 원장이라 안 보이는 것 자체가 위험.
                const orderedCompanyIds = [...companyIds].sort((a, b) => {
                  if (a === 'none') return -1;
                  if (b === 'none') return 1;
                  return (grouped[a].companyName || '').localeCompare(grouped[b].companyName || '');
                });
                const companyTotalPages = Math.max(1, Math.ceil(orderedCompanyIds.length / CALLBACK_COMPANIES_PER_PAGE));
                // 삭제·승인 후 재조회로 회사 수가 줄면 현재 페이지가 범위를 넘어 빈 화면이 되므로 표시용으로 clamp
                const safeCompanyPage = Math.min(callbackCompanyListPage, companyTotalPages);
                const pagedCompanyIds = orderedCompanyIds.slice(
                  (safeCompanyPage - 1) * CALLBACK_COMPANIES_PER_PAGE,
                  safeCompanyPage * CALLBACK_COMPANIES_PER_PAGE,
                );

                if (filtered.length === 0) {
                  return (
                    <div className="px-6 py-12 text-center text-gray-500">
                      {callbackNumbers.length === 0 ? '등록된 발신번호가 없습니다.' : '검색 결과가 없습니다.'}
                    </div>
                  );
                }

                return (
                  <>
                  <div className="divide-y">
                    {pagedCompanyIds.map(cid => {
                      const group = grouped[cid];
                      const isExpanded = expandedCallbackCompanies.has(cid);
                      return (
                        <div key={cid}>
                          <button
                            onClick={() => {
                              const newSet = new Set(expandedCallbackCompanies);
                              if (isExpanded) newSet.delete(cid); else newSet.add(cid);
                              setExpandedCallbackCompanies(newSet);
                            }}
                            className="w-full px-6 py-3 bg-gray-50 hover:bg-gray-100 flex items-center justify-between transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <span className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                              <span className="font-semibold text-gray-800">{group.companyName}</span>
                              <span className="text-xs text-gray-400">({group.companyCode})</span>
                              <span className="text-sm text-gray-500">{group.items.length}개</span>
                            </div>
                          </button>
                          {isExpanded && (() => {
                            // ★ D135+ (B10): 회사당 10개씩 페이징. 금강제화 등 160개 업체 무한 스크롤 방지.
                            const currentPage = callbackCompanyPages[cid] || 1;
                            const totalItems = group.items.length;
                            const totalPages = Math.max(1, Math.ceil(totalItems / CALLBACKS_PER_COMPANY_PAGE));
                            const safePage = Math.min(currentPage, totalPages);
                            const startIdx = (safePage - 1) * CALLBACKS_PER_COMPANY_PAGE;
                            const endIdx = Math.min(startIdx + CALLBACKS_PER_COMPANY_PAGE, totalItems);
                            const paged = group.items.slice(startIdx, endIdx);
                            const setCompanyPage = (p: number) =>
                              setCallbackCompanyPages(prev => ({ ...prev, [cid]: Math.max(1, Math.min(totalPages, p)) }));
                            // 페이지 번호 목록 (7개 이상이면 축약: 1 ... n-1 n n+1 ... N)
                            const pageNums: (number | string)[] = [];
                            if (totalPages <= 7) {
                              for (let i = 1; i <= totalPages; i++) pageNums.push(i);
                            } else {
                              pageNums.push(1);
                              if (safePage > 3) pageNums.push('...');
                              for (let i = Math.max(2, safePage - 1); i <= Math.min(totalPages - 1, safePage + 1); i++) pageNums.push(i);
                              if (safePage < totalPages - 2) pageNums.push('...');
                              pageNums.push(totalPages);
                            }
                            return (
                              <>
                                <table className="w-full text-[13px]">
                                  <thead className="bg-gray-50/50">
                                    <tr>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">발신번호</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">별칭</th>
                                      <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">대표</th>
                                      <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">등록일</th>
                                      <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">관리</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {paged.map((cb: any) => (
                                      <tr key={cb.id} className="hover:bg-blue-50/30">
                                        <td className="px-4 py-2.5 font-medium text-gray-900">{cb.phone}</td>
                                        <td className="px-4 py-2.5 text-gray-500">{cb.label || '-'}</td>
                                        <td className="px-4 py-2.5 text-center">
                                          {cb.is_default ? (
                                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">대표</span>
                                          ) : (
                                            <button onClick={() => handleSetDefault(cb.id)} className="whitespace-nowrap text-emerald-700 hover:text-emerald-800 text-xs">대표설정</button>
                                          )}
                                        </td>
                                        <td className="px-4 py-2.5 text-center text-gray-500">{formatDate(cb.created_at)}</td>
                                        <td className="px-4 py-2.5 text-center">
                                          <button onClick={() => setEditingCallback({ id: cb.id, phone: cb.phone, label: cb.label || '' })} className="whitespace-nowrap text-emerald-700 hover:text-emerald-800 text-[13px] mr-2">수정</button>
                                          <button onClick={() => handleDeleteCallback(cb.id, cb.phone)} className="whitespace-nowrap text-red-600 hover:text-red-800 text-[13px]">삭제</button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                {totalPages > 1 && (
                                  <div className="px-4 py-2.5 border-t bg-gray-50/30 flex items-center justify-between">
                                    <span className="text-xs text-gray-500">
                                      {startIdx + 1}~{endIdx} / {totalItems}개
                                    </span>
                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={() => setCompanyPage(safePage - 1)}
                                        disabled={safePage === 1}
                                        className="whitespace-nowrap px-2.5 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                                      >
                                        이전
                                      </button>
                                      {pageNums.map((p, i) =>
                                        p === '...' ? (
                                          <span key={`d-${cid}-${i}`} className="px-1.5 text-gray-400">…</span>
                                        ) : (
                                          <button
                                            key={`p-${cid}-${p}`}
                                            onClick={() => setCompanyPage(p as number)}
                                            className={`whitespace-nowrap px-2.5 py-1 text-xs rounded transition ${
                                              p === safePage
                                                ? 'bg-emerald-600 text-white'
                                                : 'bg-white border text-gray-600 hover:bg-gray-50'
                                            }`}
                                          >
                                            {p}
                                          </button>
                                        )
                                      )}
                                      <button
                                        onClick={() => setCompanyPage(safePage + 1)}
                                        disabled={safePage === totalPages}
                                        className="whitespace-nowrap px-2.5 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                                      >
                                        다음
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                  {/* ★ 2026-07-25 회사 단위 페이저 — 회사 20개 이하면 컴포넌트가 스스로 렌더하지 않는다 */}
                  <TablePagination
                    total={orderedCompanyIds.length}
                    page={safeCompanyPage}
                    perPage={CALLBACK_COMPANIES_PER_PAGE}
                    onChange={setCallbackCompanyListPage}
                    unit="개 회사"
                  />
                  </>
                );
              })()}
            </div>
              </>
            )}

            {/* 서브탭: 등록 신청 관리 */}
            {callbackSubTab === 'registrations' && (
              <>
                <div className="px-5 py-3.5 border-b border-gray-100 flex justify-between items-center">
                  <h2 className="text-base font-semibold">발신번호 등록 신청 관리</h2>
                  <div className="flex gap-2">
                    {(['pending', 'approved', 'rejected', 'all'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setSenderRegFilter(f)}
                        className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                          senderRegFilter === f
                            ? f === 'pending' ? 'bg-yellow-100 text-yellow-800'
                            : f === 'approved' ? 'bg-green-100 text-green-800'
                            : f === 'rejected' ? 'bg-red-100 text-red-800'
                            : 'bg-emerald-100 text-blue-800'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {f === 'pending' ? '승인대기' : f === 'approved' ? '승인완료' : f === 'rejected' ? '반려' : '전체'}
                        {f === 'pending' && senderRegPendingCount > 0 && (
                          <span className="ml-1 text-xs font-bold">({senderRegPendingCount})</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* === 발신번호 등록 신청 목록 === */}
                {senderRegLoading ? (
                  <div className="px-6 py-12 text-center text-gray-500">로딩 중...</div>
                ) : senderRegistrations.length === 0 ? (
                  <div className="px-6 py-12 text-center text-gray-500">
                    {senderRegFilter === 'pending' ? '승인 대기 중인 신청이 없습니다.' : '해당 조건의 신청 내역이 없습니다.'}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium text-gray-500">고객사</th>
                          <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium text-gray-500">발신번호</th>
                          <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium text-gray-500">별칭</th>
                          <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium text-gray-500">매장</th>
                          <th className="whitespace-nowrap px-4 py-2 text-center text-xs font-medium text-gray-500">첨부</th>
                          <th className="whitespace-nowrap px-4 py-2 text-center text-xs font-medium text-gray-500">상태</th>
                          <th className="whitespace-nowrap px-4 py-2 text-center text-xs font-medium text-gray-500">신청일</th>
                          <th className="whitespace-nowrap px-4 py-2 text-center text-xs font-medium text-gray-500">관리</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {senderRegistrations.map((reg: any) => (
                          <tr key={reg.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-900 font-medium">{reg.company_name || '-'}</td>
                            <td className="px-4 py-2 text-gray-900 font-mono">{reg.phone}</td>
                            <td className="px-4 py-2 text-gray-600">{reg.label || '-'}</td>
                            <td className="px-4 py-2 text-gray-600">{reg.store_name || '-'}</td>
                            <td className="px-4 py-2 text-center">
                              <span className="text-blue-600">{(reg.documents || []).length}건</span>
                            </td>
                            <td className="px-4 py-2 text-center">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                reg.status === 'pending' ? 'bg-yellow-100 text-yellow-800'
                                : reg.status === 'approved' ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                              }`}>
                                {reg.status === 'pending' ? '대기' : reg.status === 'approved' ? '승인' : '반려'}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-center text-gray-500">{formatDate(reg.created_at)}</td>
                            <td className="px-4 py-2 text-center">
                              <button
                                onClick={() => loadSenderRegDetail(reg.id)}
                                className="whitespace-nowrap text-emerald-700 hover:text-emerald-800 text-[13px] font-medium"
                              >
                                상세
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* 서브탭: 등록현황 관리 (담당자 위임장) */}
            {callbackSubTab === 'managers' && (
              <>
                <div className="px-5 py-3.5 border-b border-gray-100">
                  <div className="flex justify-between items-center mb-3">
                    <h2 className="text-base font-semibold">등록현황 관리</h2>
                    <div className="flex gap-2">
                      {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
                        <button
                          key={f}
                          onClick={() => setMgrFilter(f)}
                          className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                            mgrFilter === f
                              ? f === 'pending' ? 'bg-yellow-100 text-yellow-800'
                              : f === 'approved' ? 'bg-green-100 text-green-800'
                              : f === 'rejected' ? 'bg-red-100 text-red-800'
                              : 'bg-emerald-100 text-blue-800'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {f === 'all' ? '전체' : f === 'pending' ? '승인대기' : f === 'approved' ? '승인완료' : '반려'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={mgrSearch}
                    onChange={(e) => setMgrSearch(e.target.value)}
                    placeholder="업체명 또는 담당자 이름으로 검색..."
                    className="w-full max-w-sm px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                  />
                </div>

                {(() => {
                  const filteredMgrs = allManagers.filter(mgr => {
                    if (!mgrSearch.trim()) return true;
                    const q = mgrSearch.trim().toLowerCase();
                    return (mgr.company_name || '').toLowerCase().includes(q)
                      || (mgr.manager_name || '').toLowerCase().includes(q)
                      || (mgr.manager_phone || '').includes(q);
                  });
                  return filteredMgrs.length === 0 ? (
                    <div className="px-6 py-12 text-center text-gray-500">
                      {mgrSearch.trim() ? '검색 결과가 없습니다.' : '등록된 담당자가 없습니다.'}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px]">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium text-gray-500">고객사</th>
                            <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium text-gray-500">담당자</th>
                            <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium text-gray-500">연락처</th>
                            <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium text-gray-500">이메일</th>
                            <th className="whitespace-nowrap px-4 py-2 text-center text-xs font-medium text-gray-500">위임장</th>
                            <th className="whitespace-nowrap px-4 py-2 text-center text-xs font-medium text-gray-500">상태</th>
                            <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium text-gray-500">반려사유</th>
                            <th className="whitespace-nowrap px-4 py-2 text-center text-xs font-medium text-gray-500">관리</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {filteredMgrs.map((mgr: any) => (
                            <tr key={mgr.id} className="hover:bg-gray-50">
                              <td className="px-4 py-2 text-gray-900 font-medium">{mgr.company_name || '-'}</td>
                              <td className="px-4 py-2 text-gray-900">{mgr.manager_name}</td>
                              <td className="px-4 py-2 text-gray-600 font-mono text-xs">{mgr.manager_phone}</td>
                              <td className="px-4 py-2 text-gray-500 text-xs">{mgr.manager_email || '-'}</td>
                              <td className="px-4 py-2 text-center">
                                {mgr.authorization_doc ? (
                                  <button onClick={() => downloadSenderDoc(mgr.authorization_doc.storedName, mgr.authorization_doc.originalName)}
                                    className="whitespace-nowrap text-emerald-700 hover:text-emerald-800 text-xs underline">다운로드</button>
                                ) : (
                                  <span className="text-gray-300 text-xs">없음</span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-center">
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  mgr.status === 'pending' ? 'bg-yellow-100 text-yellow-800'
                                  : mgr.status === 'approved' ? 'bg-green-100 text-green-800'
                                  : 'bg-red-100 text-red-800'
                                }`}>
                                  {mgr.status === 'pending' ? '대기' : mgr.status === 'approved' ? '승인' : '반려'}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-gray-500 text-xs">{mgr.reject_reason || '-'}</td>
                              <td className="px-4 py-2 text-center">
                                {mgr.status === 'pending' && mgrRejectId !== mgr.id && (
                                  <div className="flex gap-1 justify-center">
                                    <button onClick={() => handleApproveManager(mgr.id)}
                                      className="whitespace-nowrap px-2.5 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700">승인</button>
                                    <button onClick={() => { setMgrRejectId(mgr.id); setMgrRejectReason(''); }}
                                      className="whitespace-nowrap px-2.5 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700">반려</button>
                                  </div>
                                )}
                                {mgr.status === 'pending' && mgrRejectId === mgr.id && (
                                  <div className="flex items-center gap-1">
                                    <input type="text" value={mgrRejectReason} onChange={(e) => setMgrRejectReason(e.target.value)}
                                      placeholder="반려 사유" className="px-2 py-1 border border-gray-200 rounded text-xs w-32" />
                                    <button onClick={() => { handleRejectManager(mgr.id, mgrRejectReason); setMgrRejectId(null); }}
                                      disabled={!mgrRejectReason.trim()}
                                      className="whitespace-nowrap px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700 disabled:opacity-40">확인</button>
                                    <button onClick={() => setMgrRejectId(null)}
                                      className="whitespace-nowrap px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300">취소</button>
                                  </div>
                                )}
                                {mgr.status !== 'pending' && <span className="text-xs text-gray-300">-</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </>
            )}
            </div>
        )}
    </>
  );
}
