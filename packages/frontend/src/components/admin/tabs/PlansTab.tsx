/**
 * PlansTab — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';

export interface PlansTabProps {
  closeModal: () => void;
  loadPlans: () => Promise<void>;
  planList: any[];
  planPage: number;
  setEditingPlan: Dispatch<any>;
  setPlanPage: Dispatch<SetStateAction<number>>;
  setShowPlanModal: Dispatch<SetStateAction<boolean>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export default function PlansTab(props: PlansTabProps) {
  const { closeModal, loadPlans, planList, planPage, setEditingPlan, setPlanPage, setShowPlanModal, showAlert, showConfirm } = props;
  const planPerPage = 10;

  const handleDeletePlan = (id: string, name: string) => {
    showConfirm(
      '요금제 삭제',
      `"${name}" 요금제를 삭제하시겠습니까?`,
      async () => {
        closeModal();
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/plans/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || '삭제 실패');
          
          loadPlans();
          showAlert('성공', '삭제되었습니다.', 'success');
        } catch (error: any) {
          showAlert('오류', error.message || '삭제 실패', 'error');
        }
      }
    );
  };
  return (
    <>
    {(
          <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm">
            <div className="px-5 py-3.5 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-base font-semibold">요금제 관리</h2>
              <button
                onClick={() => setShowPlanModal(true)}
                className="whitespace-nowrap bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-[13px] font-medium"
              >
                + 요금제 추가
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">코드</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">요금제명</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">월 요금</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">사용 회사</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">상태</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {planList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                        등록된 요금제가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    planList
                      .slice((planPage - 1) * planPerPage, planPage * planPerPage)
                      .map((plan) => (
                      <tr key={plan.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium text-gray-900 whitespace-nowrap">{plan.plan_code}</td>
                        <td className="px-4 py-2 text-gray-900">{plan.plan_name}</td>
                        <td className="px-4 py-2 text-center text-gray-900 whitespace-nowrap font-medium">
                          {Number(plan.monthly_price).toLocaleString()}원
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span className="text-blue-600 font-medium">{plan.company_count || 0}개</span>
                        </td>
                        <td className="px-4 py-2 text-center">
                          {plan.is_active ? (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">활성</span>
                          ) : (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">비활성</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <div className="flex justify-center gap-2">
                            <button
                              onClick={() => setEditingPlan({ ...plan })}
                              className="whitespace-nowrap text-emerald-700 hover:text-emerald-800 text-[13px]"
                            >
                              수정
                            </button>
                            <button
                              onClick={() => handleDeletePlan(plan.id, plan.plan_name)}
                              className="whitespace-nowrap text-red-600 hover:text-red-800 text-[13px]"
                            >
                              삭제
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                </table>
            </div>
            {planList.length > planPerPage && (
              <div className="px-6 py-4 border-t flex items-center justify-between">
                <span className="text-sm text-gray-500">
                  총 {planList.length}개 중 {(planPage - 1) * planPerPage + 1}-{Math.min(planPage * planPerPage, planList.length)}
                </span>
                <div className="flex gap-1">
                  <button onClick={() => setPlanPage(p => Math.max(1, p - 1))} disabled={planPage === 1}
                    className="whitespace-nowrap px-3 py-1 rounded border text-[13px] disabled:opacity-40 hover:bg-gray-50">◀ 이전</button>
                  {Array.from({ length: Math.ceil(planList.length / planPerPage) }, (_, i) => i + 1).map(p => (
                    <button key={p} onClick={() => setPlanPage(p)}
                      className={`whitespace-nowrap px-3 py-1 rounded border text-[13px] ${planPage === p ? 'bg-emerald-600 text-white border-emerald-600' : 'hover:bg-gray-50'}`}>{p}</button>
                  ))}
                  <button onClick={() => setPlanPage(p => Math.min(Math.ceil(planList.length / planPerPage), p + 1))}
                    disabled={planPage >= Math.ceil(planList.length / planPerPage)}
                    className="whitespace-nowrap px-3 py-1 rounded border text-[13px] disabled:opacity-40 hover:bg-gray-50">다음 ▶</button>
                </div>
              </div>
            )}
            </div>
        )}
    </>
  );
}
