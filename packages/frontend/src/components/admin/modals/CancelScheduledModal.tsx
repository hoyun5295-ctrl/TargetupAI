/**
 * CancelScheduledModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';

export interface CancelScheduledModalProps {
  cancelReason: string;
  cancelTarget: { id: string; name: string; } | null;
  loadScheduledCampaigns: (page?: number) => Promise<void>;
  setCancelReason: Dispatch<SetStateAction<string>>;
  setCancelTarget: Dispatch<SetStateAction<{ id: string; name: string; } | null>>;
  setShowCancelModal: Dispatch<SetStateAction<boolean>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
}

export default function CancelScheduledModal(props: CancelScheduledModalProps) {
  const { cancelReason, cancelTarget, loadScheduledCampaigns, setCancelReason, setCancelTarget, setShowCancelModal, showAlert } = props;
  if (!(cancelTarget)) return null; // ★ 분리 E — 본체와 같은 조건(타입 좁히기 · 본체가 이미 같은 조건으로 그린다)

  const handleCancelCampaign = async () => {
    if (!cancelTarget || !cancelReason.trim()) {
      showAlert('오류', '취소 사유를 입력해주세요.', 'error');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/campaigns/${cancelTarget.id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ reason: cancelReason })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || '취소 실패');
      }

      setShowCancelModal(false);
      setCancelTarget(null);
      setCancelReason('');
      loadScheduledCampaigns();
      // ★ 2026-09-26 한줄로 V2 F35 — 서버 문구를 그대로 보여 준다(적재 중이던 캠페인은 워커가 결말을 정한다는 안내)
      showAlert('성공', data.message || '예약이 취소되었습니다.', 'success');
    } catch (error: any) {
      showAlert('오류', error.message || '취소 실패', 'error');
    }
  };
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-center text-gray-900 mb-2">예약 취소</h3>
              <p className="text-sm text-center text-gray-600 mb-4">
                <span className="font-medium text-gray-900">"{cancelTarget.name}"</span> 캠페인을 취소하시겠습니까?
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">
                  취소 사유 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-red-500 outline-none resize-none"
                  rows={3}
                  placeholder="취소 사유를 입력해주세요 (이력 관리용)"
                  required
                />
              </div>
            </div>
            <div className="flex border-t">
              <button
                onClick={() => {
                  setShowCancelModal(false);
                  setCancelTarget(null);
                  setCancelReason('');
                }}
                className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
              >
                닫기
              </button>
              <button
                onClick={handleCancelCampaign}
                className="whitespace-nowrap flex-1 px-4 py-3 text-red-600 font-medium hover:bg-red-50 transition-colors"
              >
                취소하기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
