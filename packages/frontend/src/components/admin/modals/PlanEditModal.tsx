/**
 * PlanEditModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch } from 'react';

export interface PlanEditModalProps {
  editingPlan: any;
  loadPlans: () => Promise<void>;
  setEditingPlan: Dispatch<any>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
}

export default function PlanEditModal(props: PlanEditModalProps) {
  const { editingPlan, loadPlans, setEditingPlan, showAlert } = props;
  if (!(editingPlan)) return null; // ★ 분리 E — 본체와 같은 조건(타입 좁히기 · 본체가 이미 같은 조건으로 그린다)

  const handleUpdatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlan) return;
    
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/plans/${editingPlan.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          planName: editingPlan.plan_name,
          maxCustomers: editingPlan.max_customers,
          monthlyPrice: editingPlan.monthly_price,
          isActive: editingPlan.is_active,
          aiCreditsPerMonth: editingPlan.ai_credits_per_month,
        })
      });
      
      if (!res.ok) throw new Error('수정 실패');
      
      setEditingPlan(null);
      loadPlans();
      showAlert('성공', '수정되었습니다.', 'success');
    } catch (error) {
      showAlert('오류', '수정 실패', 'error');
    }
  };
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
              <h3 className="text-base font-semibold text-gray-800">요금제 수정</h3>
            </div>
            <form onSubmit={handleUpdatePlan} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">요금제 코드</label>
                <input
                  type="text"
                  value={editingPlan.plan_code}
                  disabled
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] bg-gray-100 text-gray-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">요금제명 *</label>
                <input
                  type="text"
                  value={editingPlan.plan_name}
                  onChange={(e) => setEditingPlan({ ...editingPlan, plan_name: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">월 요금 (원) *</label>
                <input
                  type="number"
                  value={editingPlan.monthly_price}
                  onChange={(e) => setEditingPlan({ ...editingPlan, monthly_price: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                  min="0"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">월 AI 크레딧</label>
                <input
                  type="number"
                  value={editingPlan.ai_credits_per_month ?? ''}
                  onChange={(e) => setEditingPlan({ ...editingPlan, ai_credits_per_month: e.target.value === '' ? null : Number(e.target.value) })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-violet-500 outline-none"
                  min="0"
                  placeholder="비워두면 크레딧 차감 미적용 (NULL)"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="planActive"
                  checked={editingPlan.is_active}
                  onChange={(e) => setEditingPlan({ ...editingPlan, is_active: e.target.checked })}
                  className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500/30"
                />
                <label htmlFor="planActive" className="text-[13px] text-gray-700">활성화</label>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingPlan(null)}
                  className="whitespace-nowrap flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="whitespace-nowrap flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                >
                  저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
