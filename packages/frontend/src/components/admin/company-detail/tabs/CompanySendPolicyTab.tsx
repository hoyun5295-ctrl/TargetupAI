/**
 * CompanySendPolicyTab — 슈퍼관리자 CompanyDetailModal 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';

export interface CompanySendPolicyTabProps {
  editCompany: { id: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; status: string; planId: string; rejectNumber: string; businessNumber: string; ceoName: string; businessType: string; businessItem: string; industryCode: string; address: string; sendHourStart: number; sendHourEnd: number; dailyLimit: number; duplicateDays: number; costPerSms: string | number; costPerLms: string | number; costPerMms: string | number; costPerKakao: string | number; costPerBrand: string | number; costPerBrandNonfriend: string | number; costPerTestSms: string | number; costPerTestLms: string | number; unitPriceBasis: 'vat_included' | 'vat_excluded'; billingType: string; balance: number; balanceAdjustType: 'charge' | 'deduct'; balanceAdjustAmount: string; balanceAdjustReason: string; balanceAdjusting: boolean; targetStrategy: string; crossCategoryAllowed: boolean; excludedSegments: string[]; approvalRequired: boolean; allowCallbackSelfRegister: boolean; maxUsers: number; sessionTimeoutMinutes: number; storeCodeList: string[]; newStoreCode: string; newExcludedSegment: string; lineGroupId: string; kakaoEnabled: boolean; userIsolationEnabled: boolean; usageType: string; useAiOrchestrator: boolean; cdpAutoExecuteEnabled: boolean; cdpAutoExecuteMaxRecipients: number; cdpAutoExecuteMaxCostKrw: number; cdpAutoExecuteMaxRisk: string; agencySendEnabled: boolean; subscriptionStatus: string; trialExpiresAt: string | null | ''; planCode: string; aiOperatorTrialStartedAt: string | null | ''; aiOperatorTrialUntil: string | null | ''; };
  setEditCompany: Dispatch<SetStateAction<{ id: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; status: string; planId: string; rejectNumber: string; businessNumber: string; ceoName: string; businessType: string; businessItem: string; industryCode: string; address: string; sendHourStart: number; sendHourEnd: number; dailyLimit: number; duplicateDays: number; costPerSms: string | number; costPerLms: string | number; costPerMms: string | number; costPerKakao: string | number; costPerBrand: string | number; costPerBrandNonfriend: string | number; costPerTestSms: string | number; costPerTestLms: string | number; unitPriceBasis: 'vat_included' | 'vat_excluded'; billingType: string; balance: number; balanceAdjustType: 'charge' | 'deduct'; balanceAdjustAmount: string; balanceAdjustReason: string; balanceAdjusting: boolean; targetStrategy: string; crossCategoryAllowed: boolean; excludedSegments: string[]; approvalRequired: boolean; allowCallbackSelfRegister: boolean; maxUsers: number; sessionTimeoutMinutes: number; storeCodeList: string[]; newStoreCode: string; newExcludedSegment: string; lineGroupId: string; kakaoEnabled: boolean; userIsolationEnabled: boolean; usageType: string; useAiOrchestrator: boolean; cdpAutoExecuteEnabled: boolean; cdpAutoExecuteMaxRecipients: number; cdpAutoExecuteMaxCostKrw: number; cdpAutoExecuteMaxRisk: string; agencySendEnabled: boolean; subscriptionStatus: string; trialExpiresAt: string | null | ''; planCode: string; aiOperatorTrialStartedAt: string | null | ''; aiOperatorTrialUntil: string | null | ''; }>>;
}

export default function CompanySendPolicyTab(props: CompanySendPolicyTabProps) {
  const { editCompany, setEditCompany } = props;

  return (
    <>
    {(
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">발송 시작 시간</label>
                      <select value={editCompany.sendHourStart}
                        onChange={(e) => setEditCompany({ ...editCompany, sendHourStart: Number(e.target.value) })}
                        className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none">
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">발송 종료 시간</label>
                      <select value={editCompany.sendHourEnd}
                        onChange={(e) => setEditCompany({ ...editCompany, sendHourEnd: Number(e.target.value) })}
                        className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none">
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {/* ★ 2026-07-11 거짓 설정 정리: 일일 발송 한도·중복 방지 기간 입력 제거 —
                      발송 경로 소비처 0곳(저장만 되던 죽은 설정). 실동작 제한 = 고객사 Settings 발송 피로도 보호.
                      state/저장 통로는 하위호환 유지(editCompany.dailyLimit/duplicateDays — 기존 값 보존 전송). */}
                                    <div className="flex items-center gap-2">
                    <input type="checkbox" id="approvalRequired" checked={editCompany.approvalRequired}
                      onChange={(e) => setEditCompany({ ...editCompany, approvalRequired: e.target.checked })}
                      className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500/30" />
                    <label htmlFor="approvalRequired" className="text-[13px] text-gray-700">발송 전 승인 필요</label>
                    </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="allowCallbackSelfRegister" checked={editCompany.allowCallbackSelfRegister}
                      onChange={(e) => setEditCompany({ ...editCompany, allowCallbackSelfRegister: e.target.checked })}
                      className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500/30" />
                    <label htmlFor="allowCallbackSelfRegister" className="text-[13px] text-gray-700">발신번호 자체 등록 허용</label>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 mt-2">
                    <p className="text-xs text-blue-700">
                      발송 시간은 한국 시간(KST) 기준이며, 광고성 메시지는 08:00~21:00 사이에만 발송할 수 있습니다.
                    </p>
                  </div>
                </div>
              )}
    </>
  );
}
