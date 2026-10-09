/**
 * AdminCustomerDeleteModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';

export interface AdminCustomerDeleteModalProps {
  adminCustDeleteLoading: boolean;
  adminCustDeleteTarget: { type: 'individual' | 'bulk'; customer?: any; count?: number; } | null;
  adminCustPage: { total: number; page: number; totalPages: number; };
  adminCustSelected: Set<string>;
  editCompany: { id: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; status: string; planId: string; rejectNumber: string; businessNumber: string; ceoName: string; businessType: string; businessItem: string; industryCode: string; address: string; sendHourStart: number; sendHourEnd: number; dailyLimit: number; duplicateDays: number; costPerSms: string | number; costPerLms: string | number; costPerMms: string | number; costPerKakao: string | number; costPerBrand: string | number; costPerBrandNonfriend: string | number; costPerTestSms: string | number; costPerTestLms: string | number; unitPriceBasis: 'vat_included' | 'vat_excluded'; billingType: string; balance: number; balanceAdjustType: 'charge' | 'deduct'; balanceAdjustAmount: string; balanceAdjustReason: string; balanceAdjusting: boolean; targetStrategy: string; crossCategoryAllowed: boolean; excludedSegments: string[]; approvalRequired: boolean; allowCallbackSelfRegister: boolean; maxUsers: number; sessionTimeoutMinutes: number; storeCodeList: string[]; newStoreCode: string; newExcludedSegment: string; lineGroupId: string; kakaoEnabled: boolean; userIsolationEnabled: boolean; usageType: string; useAiOrchestrator: boolean; cdpAutoExecuteEnabled: boolean; cdpAutoExecuteMaxRecipients: number; cdpAutoExecuteMaxCostKrw: number; cdpAutoExecuteMaxRisk: string; agencySendEnabled: boolean; subscriptionStatus: string; trialExpiresAt: string | null | ''; planCode: string; aiOperatorTrialStartedAt: string | null | ''; aiOperatorTrialUntil: string | null | ''; };
  loadAdminCustomers: (page?: number) => Promise<void>;
  setAdminCustDeleteLoading: Dispatch<SetStateAction<boolean>>;
  setAdminCustDeleteTarget: Dispatch<SetStateAction<{ type: 'individual' | 'bulk'; customer?: any; count?: number; } | null>>;
  setShowAdminCustDeleteModal: Dispatch<SetStateAction<boolean>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
}

export default function AdminCustomerDeleteModal(props: AdminCustomerDeleteModalProps) {
  const { adminCustDeleteLoading, adminCustDeleteTarget, adminCustPage, adminCustSelected, editCompany, loadAdminCustomers, setAdminCustDeleteLoading, setAdminCustDeleteTarget, setShowAdminCustDeleteModal, showAlert } = props;
  if (!(adminCustDeleteTarget && editCompany)) return null; // ★ 분리 E — 본체와 같은 조건(타입 좁히기 · 본체가 이미 같은 조건으로 그린다)

// 슈퍼관리자 고객 삭제 실행
const executeAdminCustDelete = async () => {
  if (!adminCustDeleteTarget) return;
  setAdminCustDeleteLoading(true);
  try {
    const token = localStorage.getItem('token');
    if (adminCustDeleteTarget.type === 'individual' && adminCustDeleteTarget.customer) {
      const res = await fetch(`/api/customers/${adminCustDeleteTarget.customer.id}?companyId=${editCompany.id}`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    } else if (adminCustDeleteTarget.type === 'bulk') {
      const res = await fetch('/api/customers/bulk-delete', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(adminCustSelected), companyId: editCompany.id })
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    }
    setShowAdminCustDeleteModal(false);
    setAdminCustDeleteTarget(null);
    showAlert('성공', '삭제되었습니다.', 'success');
    loadAdminCustomers(adminCustPage.page);
  } catch (e: any) { showAlert('오류', e.message || '삭제 실패', 'error'); }
  finally { setAdminCustDeleteLoading(false); }
};
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-[70]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-center text-gray-900 mb-2">
                {adminCustDeleteTarget.type === 'individual' ? '고객 삭제' : '선택 삭제'}
              </h3>
              <p className="text-sm text-center text-gray-600 mb-1">
                {adminCustDeleteTarget.type === 'individual'
                  ? `"${adminCustDeleteTarget.customer?.name || adminCustDeleteTarget.customer?.phone}" 고객을 삭제합니다.`
                  : `선택한 ${adminCustDeleteTarget.count}명의 고객을 삭제합니다.`}
              </p>
              <p className="text-xs text-red-500 text-center font-medium">삭제된 데이터는 복구할 수 없습니다.</p>
            </div>
            <div className="flex border-t">
              <button onClick={() => { setShowAdminCustDeleteModal(false); setAdminCustDeleteTarget(null); }}
                className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">취소</button>
              <button onClick={executeAdminCustDelete} disabled={adminCustDeleteLoading}
                className="whitespace-nowrap flex-1 px-4 py-3 text-red-600 font-bold hover:bg-red-50 transition-colors disabled:opacity-50">
                {adminCustDeleteLoading ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
