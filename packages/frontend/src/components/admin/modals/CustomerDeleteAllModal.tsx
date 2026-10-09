/**
 * CustomerDeleteAllModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';

export interface CustomerDeleteAllModalProps {
  customerDeleteConfirmName: string;
  customerDeleteLoading: boolean;
  editCompany: { id: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; status: string; planId: string; rejectNumber: string; businessNumber: string; ceoName: string; businessType: string; businessItem: string; industryCode: string; address: string; sendHourStart: number; sendHourEnd: number; dailyLimit: number; duplicateDays: number; costPerSms: string | number; costPerLms: string | number; costPerMms: string | number; costPerKakao: string | number; costPerBrand: string | number; costPerBrandNonfriend: string | number; costPerTestSms: string | number; costPerTestLms: string | number; unitPriceBasis: 'vat_included' | 'vat_excluded'; billingType: string; balance: number; balanceAdjustType: 'charge' | 'deduct'; balanceAdjustAmount: string; balanceAdjustReason: string; balanceAdjusting: boolean; targetStrategy: string; crossCategoryAllowed: boolean; excludedSegments: string[]; approvalRequired: boolean; allowCallbackSelfRegister: boolean; maxUsers: number; sessionTimeoutMinutes: number; storeCodeList: string[]; newStoreCode: string; newExcludedSegment: string; lineGroupId: string; kakaoEnabled: boolean; userIsolationEnabled: boolean; usageType: string; useAiOrchestrator: boolean; cdpAutoExecuteEnabled: boolean; cdpAutoExecuteMaxRecipients: number; cdpAutoExecuteMaxCostKrw: number; cdpAutoExecuteMaxRisk: string; agencySendEnabled: boolean; subscriptionStatus: string; trialExpiresAt: string | null | ''; planCode: string; aiOperatorTrialStartedAt: string | null | ''; aiOperatorTrialUntil: string | null | ''; };
  loadData: () => Promise<void>;
  setCustomerDeleteConfirmName: Dispatch<SetStateAction<string>>;
  setCustomerDeleteLoading: Dispatch<SetStateAction<boolean>>;
  setShowCustomerDeleteAll: Dispatch<SetStateAction<boolean>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
}

export default function CustomerDeleteAllModal(props: CustomerDeleteAllModalProps) {
  const { customerDeleteConfirmName, customerDeleteLoading, editCompany, loadData, setCustomerDeleteConfirmName, setCustomerDeleteLoading, setShowCustomerDeleteAll, showAlert } = props;

// 고객 전체 삭제 실행
const handleCustomerDeleteAll = async () => {
  setCustomerDeleteLoading(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/customers/delete-all', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetCompanyId: editCompany.id, confirmCompanyName: customerDeleteConfirmName })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '삭제 실패');
    setShowCustomerDeleteAll(false);
    setCustomerDeleteConfirmName('');
    showAlert('삭제 완료', `${data.deletedCount}명의 고객 데이터가 삭제되었습니다.\n구매내역 ${data.deletedPurchases}건도 함께 삭제되었습니다.`, 'success');
    loadData();
  } catch (e: any) {
    showAlert('오류', e.message || '삭제 실패', 'error');
  } finally {
    setCustomerDeleteLoading(false);
  }
};
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-[70]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-center text-gray-900 mb-2">⚠️ 고객 데이터 전체 삭제</h3>
              <p className="text-sm text-center text-gray-600 mb-1">
                <span className="font-bold text-red-600">{editCompany.companyName}</span>의
              </p>
              <p className="text-sm text-center text-gray-600 mb-4">
                모든 고객 데이터와 구매내역이 <span className="font-bold text-red-600">영구 삭제</span>됩니다.
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  확인을 위해 회사명을 정확히 입력해주세요
                </label>
                <input
                  type="text"
                  value={customerDeleteConfirmName}
                  onChange={(e) => setCustomerDeleteConfirmName(e.target.value)}
                  placeholder={editCompany.companyName}
                  className="w-full px-3 py-1.5 border border-red-200 rounded-lg text-[13px] focus:ring-2 focus:ring-red-500 outline-none"
                />
              </div>
            </div>
            <div className="flex border-t">
              <button onClick={() => { setShowCustomerDeleteAll(false); setCustomerDeleteConfirmName(''); }}
                className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">취소</button>
              <button
                onClick={handleCustomerDeleteAll}
                disabled={customerDeleteConfirmName !== editCompany.companyName || customerDeleteLoading}
                className="whitespace-nowrap flex-1 px-4 py-3 text-red-600 font-bold hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {customerDeleteLoading ? '삭제 중...' : '전체 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
