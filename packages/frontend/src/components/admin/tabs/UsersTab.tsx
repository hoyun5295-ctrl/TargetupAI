/**
 * UsersTab — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import type { JSX } from 'react/jsx-runtime';
import { formatDateTime } from '../../../utils/formatDate';
import type { Company } from '../admin-types';
import type { User } from '../admin-types';
import type { ModalState } from '../admin-types';

export interface UsersTabProps {
  closeModal: () => void;
  companies: Company[];
  expandedCompanies: Set<string>;
  getStatusBadge: (status: string) => JSX.Element;
  loadUsers: () => Promise<void>;
  setCopied: Dispatch<SetStateAction<boolean>>;
  setEditingUser: Dispatch<any>;
  setExpandedCompanies: Dispatch<SetStateAction<Set<string>>>;
  setModal: Dispatch<SetStateAction<ModalState>>;
  setShowUserModal: Dispatch<SetStateAction<boolean>>;
  setUserCompanyFilter: Dispatch<SetStateAction<string>>;
  setUserPage: Dispatch<SetStateAction<number>>;
  setUserSearch: Dispatch<SetStateAction<string>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
  userCompanyFilter: string;
  userPage: number;
  userSearch: string;
  users: User[];
}

export default function UsersTab(props: UsersTabProps) {
  const { closeModal, companies, expandedCompanies, getStatusBadge, loadUsers, setCopied, setEditingUser, setExpandedCompanies, setModal, setShowUserModal, setUserCompanyFilter, setUserPage, setUserSearch, showAlert, showConfirm, userCompanyFilter, userPage, userSearch, users } = props;
  const USERS_COMPANIES_PER_PAGE = 20;

  const showPasswordModal = (password: string, smsSent?: boolean, phone?: string) => {
    setCopied(false);
    setModal({ type: 'password', title: '임시 비밀번호 발급', message: '', password, smsSent, phone });
  };

  const handleResetPassword = async (userId: string, userName: string) => {
    showConfirm(
      '비밀번호 초기화',
      `${userName}님의 비밀번호를 초기화하시겠습니까?`,
      async () => {
        closeModal();
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (!res.ok) throw new Error('초기화 실패');
          
          const data = await res.json();
          showPasswordModal(data.tempPassword, data.smsSent, data.phone);
        } catch (error) {
          showAlert('오류', '비밀번호 초기화 실패', 'error');
        }
      }
    );
  };

  const handleDeleteUser = async (userId: string, userName: string) => {
    showConfirm(
      '사용자 삭제',
      `${userName}님을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
      async () => {
        closeModal();
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/users/${userId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (!res.ok) throw new Error('삭제 실패');
          
          loadUsers();
          showAlert('성공', '삭제되었습니다.', 'success');
        } catch (error) {
          showAlert('오류', '삭제 실패', 'error');
        }
      }
    );
  };

  const handleEditUser = (user: any) => {
    setEditingUser({
      ...user,
      storeCodes: user.store_codes ? user.store_codes.join(', ') : ''
    });
  };

  const getUserTypeBadge = (userType: string) => {
    if (userType === 'admin') {
      return <span className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">관리자</span>;
    }
    return <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">일반</span>;
  };
  return (
    <>
    {(
          <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm">
            <div className="px-5 py-3.5 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-base font-semibold">사용자 목록</h2>
              <button
                onClick={() => setShowUserModal(true)}
                className="whitespace-nowrap bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-[13px] font-medium"
              >
                + 사용자 추가
              </button>
            </div>

            {/* 검색/필터 */}
            <div className="px-6 py-3 bg-gray-50 border-b flex flex-wrap gap-x-4 gap-y-2 items-center">
              <div className="flex-1 min-w-[200px]">
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => { setUserSearch(e.target.value); setUserPage(1); }}
                  placeholder="아이디 · 이름 검색"
                  className="w-full max-w-xs px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[13px] text-gray-600 whitespace-nowrap">회사:</label>
                <select
                  value={userCompanyFilter}
                  onChange={(e) => { setUserCompanyFilter(e.target.value); setUserPage(1); }}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                >
                  <option value="all">전체</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.company_name}</option>
                  ))}
                </select>
              </div>
              <span className="text-[13px] text-gray-500 whitespace-nowrap">
                총 {users.filter(u => {
                  const matchSearch = !userSearch || 
                    u.login_id.toLowerCase().includes(userSearch.toLowerCase()) ||
                    u.name.toLowerCase().includes(userSearch.toLowerCase());
                  const matchCompany = userCompanyFilter === 'all' || u.company_id === userCompanyFilter;
                  return matchSearch && matchCompany;
                }).length}명
              </span>
            </div>

            <div className="overflow-x-auto">
              {(() => {
                // 필터링된 사용자
                const filteredUsers = users.filter(u => {
                  const matchSearch = !userSearch || 
                    u.login_id.toLowerCase().includes(userSearch.toLowerCase()) ||
                    u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
                    (u.company_name || '').toLowerCase().includes(userSearch.toLowerCase());
                  const matchCompany = userCompanyFilter === 'all' || u.company_id === userCompanyFilter;
                  return matchSearch && matchCompany;
                });

                // 회사별 그룹핑
                const groupedUsers = filteredUsers.reduce((acc, user) => {
                  const companyId = user.company_id || 'none';
                  if (!acc[companyId]) {
                    acc[companyId] = {
                      companyName: user.company_name || '소속 없음',
                      users: []
                    };
                  }
                  acc[companyId].users.push(user);
                  return acc;
                }, {} as Record<string, { companyName: string; users: typeof users }>);

                const companyIds = Object.keys(groupedUsers);

                if (filteredUsers.length === 0) {
                  return (
                    <div className="px-6 py-12 text-center text-gray-500">
                      {users.length === 0 ? '등록된 사용자가 없습니다.' : '검색 결과가 없습니다.'}
                    </div>
                  );
                }

                // ★ 회사 그룹 20개씩 페이지네이션
                const totalUserPages = Math.max(1, Math.ceil(companyIds.length / USERS_COMPANIES_PER_PAGE));
                const safeUserPage = Math.min(Math.max(1, userPage), totalUserPages);
                const pagedCompanyIds = companyIds.slice(
                  (safeUserPage - 1) * USERS_COMPANIES_PER_PAGE,
                  safeUserPage * USERS_COMPANIES_PER_PAGE
                );

                return (
                  <>
                  <div className="divide-y">
                    {pagedCompanyIds.map(companyId => {
                      const group = groupedUsers[companyId];
                      const isExpanded = expandedCompanies.has(companyId);
                      
                      return (
                        <div key={companyId}>
                          <button
                            onClick={() => {
                              const newSet = new Set(expandedCompanies);
                              if (isExpanded) {
                                newSet.delete(companyId);
                              } else {
                                newSet.add(companyId);
                              }
                              setExpandedCompanies(newSet);
                            }}
                            className="w-full px-6 py-3 bg-gray-50 hover:bg-gray-100 flex items-center justify-between transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <span className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                                ▶
                              </span>
                              <span className="font-semibold text-gray-800">{group.companyName}</span>
                              <span className="text-sm text-gray-500">({group.users.length}명)</span>
                            </div>
                          </button>
                          
                          {isExpanded && (
                            <table className="w-full text-[13px]">
                              <thead className="bg-gray-50/50">
                                <tr>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">로그인ID</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">이름</th>
                                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">권한</th>
                                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">담당 브랜드</th>
                                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">상태</th>
                                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">최근로그인</th>
                                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">관리</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {group.users.map((u) => (
                                  <tr key={u.id} className="hover:bg-blue-50/30">
                                    <td className="px-4 py-2.5 font-medium text-gray-900">{u.login_id}</td>
                                    <td className="px-4 py-2.5 text-gray-900">{u.name}</td>
                                    <td className="px-4 py-2.5 text-center">{getUserTypeBadge(u.user_type)}</td>
                                    <td className="px-4 py-2.5 text-center text-gray-600">
                                      {(u as any).store_codes && (u as any).store_codes.length > 0 
                                        ? (u as any).store_codes.join(', ') 
                                        : <span className="text-gray-400">전체</span>}
                                    </td>
                                    <td className="px-4 py-2.5 text-center">{getStatusBadge(u.status)}</td>
                                    <td className="px-4 py-2.5 text-center text-gray-500">
                                      {u.last_login_at ? formatDateTime(u.last_login_at) : '-'}
                                    </td>
                                    <td className="px-4 py-2.5 text-center">
                                      <button 
                                        onClick={() => handleEditUser(u)}
                                        className="whitespace-nowrap text-emerald-700 hover:text-emerald-800 text-[13px] mr-2"
                                      >
                                        수정
                                      </button>
                                      <button 
                                        onClick={() => handleResetPassword(u.id, u.name)}
                                        className="whitespace-nowrap text-orange-600 hover:text-orange-800 text-[13px] mr-2"
                                      >
                                        비번초기화
                                      </button>
                                      <button 
                                        onClick={() => handleDeleteUser(u.id, u.name)}
                                        className="whitespace-nowrap text-red-600 hover:text-red-800 text-[13px]"
                                      >
                                        삭제
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* ★ 회사 그룹 페이지네이션 */}
                  {totalUserPages > 1 && (
                    <div className="px-6 py-4 border-t flex items-center justify-between bg-gray-50">
                      <span className="text-sm text-gray-500">
                        총 {companyIds.length}개 회사 중 {(safeUserPage - 1) * USERS_COMPANIES_PER_PAGE + 1}-{Math.min(safeUserPage * USERS_COMPANIES_PER_PAGE, companyIds.length)}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setUserPage(p => Math.max(1, p - 1))}
                          disabled={safeUserPage === 1}
                          className="whitespace-nowrap px-3 py-1.5 text-[13px] rounded-md border bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                        >◀ 이전</button>
                        {Array.from({ length: totalUserPages }, (_, i) => i + 1).map(p => (
                          <button
                            key={p}
                            onClick={() => setUserPage(p)}
                            className={`whitespace-nowrap min-w-[36px] px-3 py-1.5 text-[13px] rounded-md transition-colors ${
                              p === safeUserPage ? 'bg-emerald-600 text-white' : 'bg-white border hover:bg-gray-100'
                            }`}
                          >{p}</button>
                        ))}
                        <button
                          onClick={() => setUserPage(p => Math.min(totalUserPages, p + 1))}
                          disabled={safeUserPage === totalUserPages}
                          className="whitespace-nowrap px-3 py-1.5 text-[13px] rounded-md border bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                        >다음 ▶</button>
                      </div>
                    </div>
                  )}
                  </>
                );
              })()}
            </div>
            </div>
        )}
    </>
  );
}
