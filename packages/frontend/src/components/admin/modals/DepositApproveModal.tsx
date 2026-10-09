/**
 * DepositApproveModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import type { ModalState } from '../admin-types';
import { Check } from 'lucide-react';

export interface DepositApproveModalProps {
  chargeTxPage: number;
  depositAdminNote: string;
  depositTarget: any;
  loadChargeManagement: (page?: number) => Promise<void>;
  setDepositAdminNote: Dispatch<SetStateAction<string>>;
  setDepositTarget: Dispatch<any>;
  setModal: Dispatch<SetStateAction<ModalState>>;
  setShowDepositApproveModal: Dispatch<SetStateAction<boolean>>;
}

export default function DepositApproveModal(props: DepositApproveModalProps) {
  const { chargeTxPage, depositAdminNote, depositTarget, loadChargeManagement, setDepositAdminNote, setDepositTarget, setModal, setShowDepositApproveModal } = props;

  const handleApproveDeposit = async () => {
    if (!depositTarget) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/deposit-requests/${depositTarget.id}/approve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        // ★ 2026-08-19 전송자격인증 2.3 — 명의 확인 건은 확인 표시 없이 서버가 거절한다.
        //   모달에서 사유와 소명을 보고 누른 것이므로 여기서 true를 실어 보낸다.
        body: JSON.stringify({ adminNote: depositAdminNote || null, resolveHold: Boolean(depositTarget.held_reason) })
      });
      if (res.ok) {
        setModal({ type: 'alert', title: '승인 완료', message: `${Number(depositTarget.amount).toLocaleString()}원이 충전되었습니다.`, variant: 'success' });
        setShowDepositApproveModal(false);
        setDepositTarget(null);
        setDepositAdminNote('');
        loadChargeManagement(chargeTxPage);
      } else {
        const err = await res.json();
        setModal({ type: 'alert', title: '승인 실패', message: err.error || '처리 중 오류 발생', variant: 'error' });
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
            <div className="p-5 border-b bg-gradient-to-r from-emerald-50 to-green-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600"><Check className="w-5 h-5" /></div>
                <div>
                  <h3 className="text-base font-bold text-gray-800">충전 승인</h3>
                  <p className="text-xs text-gray-500">승인 시 잔액이 즉시 충전됩니다</p>
                </div>
              </div>
            </div>
            <div className="p-5">
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">회사</span>
                  <span className="font-medium text-gray-800">{depositTarget.company_name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">결제수단</span>
                  <span className="font-medium">{depositTarget.payment_method === 'deposit' ? '무통장입금' : depositTarget.payment_method === 'card' ? '카드결제' : '가상계좌'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">금액</span>
                  <span className="font-bold text-emerald-700">{Number(depositTarget.amount).toLocaleString()}원</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">입금자명</span>
                  <span className="font-medium">{depositTarget.depositor_name}</span>
                </div>
                {/* ★ 2026-08-19 전송자격인증 2.3 — 명의 확인 건은 사유와 소명을 보고 판단한다 */}
                {depositTarget.held_reason && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 space-y-1.5">
                    <div className="text-xs font-semibold text-rose-700">명의 확인 필요</div>
                    <div className="text-xs text-rose-800 leading-relaxed">{depositTarget.held_reason}</div>
                    <div className="text-[11px] text-gray-600 leading-relaxed border-t border-rose-200 pt-1.5">
                      <span className="font-medium">고객사 소명</span>
                      {' · '}
                      {depositTarget.explanation_note
                        ? depositTarget.explanation_note
                        : <span className="text-gray-400">아직 제출되지 않았습니다</span>}
                    </div>
                  </div>
                )}
                <div className="flex justify-between text-sm border-t pt-2">
                  <span className="text-gray-400">현재 잔액</span>
                  <span className="font-medium">{Number(depositTarget.balance || 0).toLocaleString()}원</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">충전 후 잔액</span>
                  <span className="font-bold text-blue-700">{(Number(depositTarget.balance || 0) + Number(depositTarget.amount)).toLocaleString()}원</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium mb-1.5 block">관리자 메모 (선택)</label>
                <input
                  type="text"
                  value={depositAdminNote}
                  onChange={(e) => setDepositAdminNote(e.target.value)}
                  placeholder="입금 확인 메모"
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>
            <div className="flex border-t">
              <button
                onClick={() => { setShowDepositApproveModal(false); setDepositTarget(null); setDepositAdminNote(''); }}
                className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
              >
                취소
              </button>
              <button
                onClick={handleApproveDeposit}
                className="whitespace-nowrap flex-1 px-4 py-3 text-emerald-600 font-medium hover:bg-emerald-50 transition-colors"
              >
                승인하기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
