/**
 * DepositRejectModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import type { ModalState } from '../admin-types';
import { X } from 'lucide-react';

export interface DepositRejectModalProps {
  chargeTxPage: number;
  depositAdminNote: string;
  depositTarget: any;
  loadChargeManagement: (page?: number) => Promise<void>;
  setDepositAdminNote: Dispatch<SetStateAction<string>>;
  setDepositTarget: Dispatch<any>;
  setModal: Dispatch<SetStateAction<ModalState>>;
  setShowDepositRejectModal: Dispatch<SetStateAction<boolean>>;
}

export default function DepositRejectModal(props: DepositRejectModalProps) {
  const { chargeTxPage, depositAdminNote, depositTarget, loadChargeManagement, setDepositAdminNote, setDepositTarget, setModal, setShowDepositRejectModal } = props;

  const handleRejectDeposit = async () => {
    if (!depositTarget) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/deposit-requests/${depositTarget.id}/reject`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ adminNote: depositAdminNote || '거절' })
      });
      if (res.ok) {
        setModal({ type: 'alert', title: '거절 완료', message: '충전 요청이 거절되었습니다.', variant: 'success' });
        setShowDepositRejectModal(false);
        setDepositTarget(null);
        setDepositAdminNote('');
        loadChargeManagement(chargeTxPage);
      } else {
        const err = await res.json();
        setModal({ type: 'alert', title: '거절 실패', message: err.error || '처리 중 오류 발생', variant: 'error' });
      }
    } catch (error) {
      setModal({ type: 'alert', title: '오류', message: '네트워크 오류', variant: 'error' });
    }
  };
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden animate-in fade-in zoom-in">
            <div className="p-5 border-b bg-red-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center text-rose-600"><X className="w-5 h-5" /></div>
                <div>
                  <h3 className="text-base font-bold text-gray-800">충전 거절</h3>
                  <p className="text-xs text-gray-500">{depositTarget.company_name} · {Number(depositTarget.amount).toLocaleString()}원</p>
                </div>
              </div>
            </div>
            <div className="p-5">
              <label className="text-xs text-gray-500 font-medium mb-1.5 block">거절 사유 *</label>
              <textarea
                value={depositAdminNote}
                onChange={(e) => setDepositAdminNote(e.target.value)}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-red-500 outline-none resize-none"
                rows={3}
                placeholder="거절 사유를 입력해주세요."
              />
            </div>
            <div className="flex border-t">
              <button
                onClick={() => { setShowDepositRejectModal(false); setDepositTarget(null); setDepositAdminNote(''); }}
                className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
              >
                취소
              </button>
              <button
                onClick={handleRejectDeposit}
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
