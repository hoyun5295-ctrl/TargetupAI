/**
 * PlanCreateModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';

export interface PlanCreateModalProps {
  loadPlans: () => Promise<void>;
  newPlan: { planCode: string; planName: string; maxCustomers: number; monthlyPrice: number; };
  setNewPlan: Dispatch<SetStateAction<{ planCode: string; planName: string; maxCustomers: number; monthlyPrice: number; }>>;
  setShowPlanModal: Dispatch<SetStateAction<boolean>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
}

export default function PlanCreateModal(props: PlanCreateModalProps) {
  const { loadPlans, newPlan, setNewPlan, setShowPlanModal, showAlert } = props;

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/plans', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newPlan)
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '등록 실패');
      
      setShowPlanModal(false);
      setNewPlan({ planCode: '', planName: '', maxCustomers: 1000, monthlyPrice: 0 });
      loadPlans();
      showAlert('성공', '요금제가 등록되었습니다.', 'success');
    } catch (error: any) {
      showAlert('오류', error.message || '등록 실패', 'error');
    }
  };
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-green-50 to-emerald-50">
              <h3 className="text-base font-semibold text-gray-800">요금제 추가</h3>
            </div>
            <form onSubmit={handleCreatePlan} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">요금제 코드 *</label>
                <input
                  type="text"
                  value={newPlan.planCode}
                  onChange={(e) => setNewPlan({ ...newPlan, planCode: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-green-500 outline-none"
                  placeholder="예: BASIC, PRO, ENTERPRISE"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">요금제명 *</label>
                <input
                  type="text"
                  value={newPlan.planName}
                  onChange={(e) => setNewPlan({ ...newPlan, planName: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-green-500 outline-none"
                  placeholder="예: 베이직, 프로, 엔터프라이즈"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">월 요금 (원) *</label>
                <input
                  type="number"
                  value={newPlan.monthlyPrice}
                  onChange={(e) => setNewPlan({ ...newPlan, monthlyPrice: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-green-500 outline-none"
                  min="0"
                  required
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowPlanModal(false);
                    setNewPlan({ planCode: '', planName: '', maxCustomers: 1000, monthlyPrice: 0 });
                  }}
                  className="whitespace-nowrap flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="whitespace-nowrap flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
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
