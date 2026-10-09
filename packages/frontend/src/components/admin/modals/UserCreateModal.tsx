/**
 * UserCreateModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import SearchableSelect from '../../SearchableSelect';
import type { Company } from '../admin-types';

export interface UserCreateModalProps {
  companies: Company[];
  loadUsers: () => Promise<void>;
  newUser: { companyId: string; loginId: string; password: string; name: string; email: string; phone: string; department: string; userType: string; storeCodes: string; };
  setNewUser: Dispatch<SetStateAction<{ companyId: string; loginId: string; password: string; name: string; email: string; phone: string; department: string; userType: string; storeCodes: string; }>>;
  setShowUserModal: Dispatch<SetStateAction<boolean>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
}

export default function UserCreateModal(props: UserCreateModalProps) {
  const { companies, loadUsers, newUser, setNewUser, setShowUserModal, showAlert } = props;

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ...newUser,
          storeCodes: newUser.storeCodes ? newUser.storeCodes.split(',').map(s => s.trim()).filter(Boolean) : null
        })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '생성 실패');
      }
      
      setShowUserModal(false);
      setNewUser({
        companyId: '',
        loginId: '',
        password: '',
        name: '',
        email: '',
        phone: '',
        department: '',
        userType: 'user',
        storeCodes: '',
      });
      loadUsers();
      showAlert('성공', '사용자가 생성되었습니다.', 'success');
    } catch (error: any) {
      showAlert('오류', error.message || '생성 실패', 'error');
    }
  };

  // 임시 비밀번호 생성
  const generateTempPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 8; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewUser({ ...newUser, password });
  };
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-3.5 border-b border-gray-100">
              <h3 className="text-base font-semibold">새 사용자 추가</h3>
            </div>
            <form onSubmit={handleCreateUser} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  소속 회사 *
                </label>
                {/* ★ D144 P11: 검색 가능 select — 회사명 입력으로 검색, 67개+ 스크롤 대신 */}
                <SearchableSelect
                  options={companies.map((company) => ({
                    value: company.id,
                    label: `${company.company_name} (${company.company_code})`,
                  }))}
                  value={newUser.companyId}
                  onChange={(v) => setNewUser({ ...newUser, companyId: v })}
                  placeholder="회사명 검색..."
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  로그인 ID *
                </label>
                <input
                  type="text"
                  value={newUser.loginId}
                  onChange={(e) => setNewUser({ ...newUser, loginId: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                  placeholder="영문, 숫자 조합"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  초기 비밀번호 *
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                    placeholder="8자 이상"
                    required
                  />
                  <button
                    type="button"
                    onClick={generateTempPassword}
                    className="whitespace-nowrap px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-[13px]"
                  >
                    자동생성
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  이름 *
                </label>
                <input
                  type="text"
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  이메일
                </label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  연락처
                </label>
                <input
                  type="text"
                  value={newUser.phone}
                  onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                  placeholder="010-0000-0000"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  부서
                </label>
                <input
                  type="text"
                  value={newUser.department}
                  onChange={(e) => setNewUser({ ...newUser, department: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  권한 *
                </label>
                <select
                  value={newUser.userType}
                  onChange={(e) => setNewUser({ ...newUser, userType: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                >
                  <option value="user">일반 사용자</option>
                  <option value="admin">회사 관리자</option>
                  </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  담당 분류 코드
                </label>
                {(() => {
                  const selectedCompany = companies.find(c => c.id === newUser.companyId);
                  const storeList = (selectedCompany as any)?.store_code_list || [];
                  
                  if (!newUser.companyId) {
                    return <p className="text-xs text-gray-400 py-2">먼저 소속 회사를 선택하세요</p>;
                  }
                  if (storeList.length === 0) {
                    return <p className="text-xs text-gray-400 py-2">이 회사는 분류 코드가 없습니다 (전체 접근)</p>;
                  }
                  
                  return (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {storeList.map((code: string) => {
                        const selected = newUser.storeCodes.split(',').map(s => s.trim()).filter(Boolean);
                        const isChecked = selected.includes(code);
                        return (
                          <label key={code} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[13px] cursor-pointer border transition-colors ${isChecked ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const newSelected = e.target.checked
                                  ? [...selected, code]
                                  : selected.filter(s => s !== code);
                                setNewUser({ ...newUser, storeCodes: newSelected.join(', ') });
                              }}
                              className="sr-only"
                            />
                            {code}
                          </label>
                        );
                      })}
                    </div>
                  );
                })()}
                <p className="text-xs text-gray-500 mt-2">비워두면 전체 고객 조회 가능</p>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowUserModal(false)}
                  className="whitespace-nowrap flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="whitespace-nowrap flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                >
                  추가
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
