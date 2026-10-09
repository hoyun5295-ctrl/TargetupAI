/**
 * CallbackCreateModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import SearchableSelect from '../../SearchableSelect';
import type { Company } from '../admin-types';

export interface CallbackCreateModalProps {
  companies: Company[];
  loadCallbackNumbers: () => Promise<void>;
  newCallback: { companyId: string; phone: string; label: string; isDefault: boolean; };
  setNewCallback: Dispatch<SetStateAction<{ companyId: string; phone: string; label: string; isDefault: boolean; }>>;
  setShowCallbackModal: Dispatch<SetStateAction<boolean>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
}

export default function CallbackCreateModal(props: CallbackCreateModalProps) {
  const { companies, loadCallbackNumbers, newCallback, setNewCallback, setShowCallbackModal, showAlert } = props;

  const handleCreateCallback = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/callback-numbers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newCallback)
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '등록 실패');
      }
      
      setShowCallbackModal(false);
      setNewCallback({ companyId: '', phone: '', label: '', isDefault: false });
      loadCallbackNumbers();
      showAlert('성공', '발신번호가 등록되었습니다.', 'success');
    } catch (error: any) {
      showAlert('오류', error.message || '등록 실패', 'error');
    }
  };
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
              <h3 className="text-base font-semibold text-gray-800">발신번호 등록</h3>
            </div>
            <form onSubmit={handleCreateCallback} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  고객사 *
                </label>
                {/* ★ D145 P3 (2026-05-07): SearchableSelect 적용 — 162개+ 고객사 스크롤 대신 입력으로 검색 */}
                <SearchableSelect
                  options={companies.map((company) => ({
                    value: company.id,
                    label: `${company.company_name} (${company.company_code})`,
                  }))}
                  value={newCallback.companyId}
                  onChange={(value) => setNewCallback({ ...newCallback, companyId: value })}
                  placeholder="고객사 선택 또는 입력 검색..."
                  required
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  발신번호 *
                </label>
                <input
                  type="text"
                  value={newCallback.phone}
                  onChange={(e) => setNewCallback({ ...newCallback, phone: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                  placeholder="02-1234-5678"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  별칭
                </label>
                <input
                  type="text"
                  value={newCallback.label}
                  onChange={(e) => setNewCallback({ ...newCallback, label: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                  placeholder="대표번호, 고객센터 등"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={newCallback.isDefault}
                  onChange={(e) => setNewCallback({ ...newCallback, isDefault: e.target.checked })}
                  className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500/30"
                />
                <label htmlFor="isDefault" className="text-[13px] text-gray-700">
                  대표번호로 설정
                </label>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowCallbackModal(false);
                    setNewCallback({ companyId: '', phone: '', label: '', isDefault: false });
                  }}
                  className="whitespace-nowrap flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="whitespace-nowrap flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                >
                  등록
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
