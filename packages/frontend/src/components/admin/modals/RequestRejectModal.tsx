/**
 * RequestRejectModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import type { ModalState } from '../admin-types';

export interface RequestRejectModalProps {
  loadPlanRequests: () => Promise<void>;
  rejectReason: string;
  rejectTarget: any;
  setModal: Dispatch<SetStateAction<ModalState>>;
  setRejectReason: Dispatch<SetStateAction<string>>;
  setRejectTarget: Dispatch<any>;
  setShowRejectModal: Dispatch<SetStateAction<boolean>>;
}

export default function RequestRejectModal(props: RequestRejectModalProps) {
  const { loadPlanRequests, rejectReason, rejectTarget, setModal, setRejectReason, setRejectTarget, setShowRejectModal } = props;

  const handleRejectRequest = async () => {
    if (!rejectTarget || !rejectReason.trim()) {
      setModal({ type: 'alert', title: '입력 오류', message: '거절 사유를 입력해주세요.', variant: 'warning' });
      return;
    }
    
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/plan-requests/${rejectTarget.id}/reject`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ adminNote: rejectReason.trim() })
      });
      
      if (res.ok) {
        setShowRejectModal(false);
        setRejectTarget(null);
        setRejectReason('');
        setModal({ type: 'alert', title: '거절 완료', message: '신청이 거절되었습니다.', variant: 'success' });
        loadPlanRequests();
      } else {
        const data = await res.json();
        setModal({ type: 'alert', title: '거절 실패', message: data.error || '거절에 실패했습니다.', variant: 'error' });
      }
    } catch (error) {
      setModal({ type: 'alert', title: '오류', message: '처리 중 오류가 발생했습니다.', variant: 'error' });
    }
  };
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-center text-gray-900 mb-2">플랜 신청 거절</h3>
              <p className="text-sm text-center text-gray-600 mb-4">
                <strong>{rejectTarget.company_name}</strong>의<br/>
                {rejectTarget.requested_plan_name} 플랜 신청을 거절합니다.
              </p>
              
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  거절 사유 *
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-red-500 outline-none resize-none"
                  rows={3}
                  placeholder="거절 사유를 입력해주세요."
                />
              </div>
            </div>
            <div className="flex border-t">
              <button
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectTarget(null);
                  setRejectReason('');
                }}
                className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
              >
                취소
              </button>
              <button
                onClick={handleRejectRequest}
                className="whitespace-nowrap flex-1 px-4 py-3 text-red-600 font-medium hover:bg-red-50 transition-colors"
              >
                거절하기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
