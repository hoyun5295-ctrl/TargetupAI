/**
 * CompanyStoreCodeTab — 슈퍼관리자 CompanyDetailModal 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';

export interface CompanyStoreCodeTabProps {
  editCompany: { id: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; status: string; planId: string; rejectNumber: string; businessNumber: string; ceoName: string; businessType: string; businessItem: string; industryCode: string; address: string; sendHourStart: number; sendHourEnd: number; dailyLimit: number; duplicateDays: number; costPerSms: string | number; costPerLms: string | number; costPerMms: string | number; costPerKakao: string | number; costPerBrand: string | number; costPerBrandNonfriend: string | number; costPerTestSms: string | number; costPerTestLms: string | number; unitPriceBasis: 'vat_included' | 'vat_excluded'; billingType: string; balance: number; balanceAdjustType: 'charge' | 'deduct'; balanceAdjustAmount: string; balanceAdjustReason: string; balanceAdjusting: boolean; targetStrategy: string; crossCategoryAllowed: boolean; excludedSegments: string[]; approvalRequired: boolean; allowCallbackSelfRegister: boolean; maxUsers: number; sessionTimeoutMinutes: number; storeCodeList: string[]; newStoreCode: string; newExcludedSegment: string; lineGroupId: string; kakaoEnabled: boolean; userIsolationEnabled: boolean; usageType: string; useAiOrchestrator: boolean; cdpAutoExecuteEnabled: boolean; cdpAutoExecuteMaxRecipients: number; cdpAutoExecuteMaxCostKrw: number; cdpAutoExecuteMaxRisk: string; agencySendEnabled: boolean; subscriptionStatus: string; trialExpiresAt: string | null | ''; planCode: string; aiOperatorTrialStartedAt: string | null | ''; aiOperatorTrialUntil: string | null | ''; };
  setEditCompany: Dispatch<SetStateAction<{ id: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; status: string; planId: string; rejectNumber: string; businessNumber: string; ceoName: string; businessType: string; businessItem: string; industryCode: string; address: string; sendHourStart: number; sendHourEnd: number; dailyLimit: number; duplicateDays: number; costPerSms: string | number; costPerLms: string | number; costPerMms: string | number; costPerKakao: string | number; costPerBrand: string | number; costPerBrandNonfriend: string | number; costPerTestSms: string | number; costPerTestLms: string | number; unitPriceBasis: 'vat_included' | 'vat_excluded'; billingType: string; balance: number; balanceAdjustType: 'charge' | 'deduct'; balanceAdjustAmount: string; balanceAdjustReason: string; balanceAdjusting: boolean; targetStrategy: string; crossCategoryAllowed: boolean; excludedSegments: string[]; approvalRequired: boolean; allowCallbackSelfRegister: boolean; maxUsers: number; sessionTimeoutMinutes: number; storeCodeList: string[]; newStoreCode: string; newExcludedSegment: string; lineGroupId: string; kakaoEnabled: boolean; userIsolationEnabled: boolean; usageType: string; useAiOrchestrator: boolean; cdpAutoExecuteEnabled: boolean; cdpAutoExecuteMaxRecipients: number; cdpAutoExecuteMaxCostKrw: number; cdpAutoExecuteMaxRisk: string; agencySendEnabled: boolean; subscriptionStatus: string; trialExpiresAt: string | null | ''; planCode: string; aiOperatorTrialStartedAt: string | null | ''; aiOperatorTrialUntil: string | null | ''; }>>;
}

export default function CompanyStoreCodeTab(props: CompanyStoreCodeTabProps) {
  const { editCompany, setEditCompany } = props;

  return (
    <>
    {(
                <div className="space-y-4">
                  <p className="text-sm text-gray-500">브랜드, 팀 등으로 고객/사용자를 구분할 때 사용합니다.</p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {editCompany.storeCodeList.map((code: string, idx: number) => (
                      <span key={idx} className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                        {code}
                        <button type="button"
                          onClick={() => setEditCompany({
                            ...editCompany,
                            storeCodeList: editCompany.storeCodeList.filter((_: string, i: number) => i !== idx)
                          })}
                          className="whitespace-nowrap text-emerald-700 hover:text-emerald-800 font-bold">×</button>
                      </span>
                    ))}
                    {editCompany.storeCodeList.length === 0 && (
                      <span className="text-gray-400 text-sm">분류 코드 없음 (전체 공유)</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input type="text" value={editCompany.newStoreCode}
                      onChange={(e) => setEditCompany({ ...editCompany, newStoreCode: e.target.value.toUpperCase() })}
                      className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                      placeholder="예: LUNA, BLOOM, ONLINE"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const code = editCompany.newStoreCode.trim();
                          if (code && !editCompany.storeCodeList.includes(code)) {
                            setEditCompany({
                              ...editCompany,
                              storeCodeList: [...editCompany.storeCodeList, code],
                              newStoreCode: ''
                            });
                          }
                        }
                      }} />
                    <button type="button"
                      onClick={() => {
                        const code = editCompany.newStoreCode.trim();
                        if (code && !editCompany.storeCodeList.includes(code)) {
                          setEditCompany({
                            ...editCompany,
                            storeCodeList: [...editCompany.storeCodeList, code],
                            newStoreCode: ''
                          });
                        }
                      }}
                      className="whitespace-nowrap px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-[13px]">
                      추가
                    </button>
                  </div>
                </div>
              )}
    </>
  );
}
