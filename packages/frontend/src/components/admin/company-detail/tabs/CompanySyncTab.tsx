/**
 * CompanySyncTab — 슈퍼관리자 CompanyDetailModal 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';

export interface CompanySyncTabProps {
  editCompany: { id: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; status: string; planId: string; rejectNumber: string; businessNumber: string; ceoName: string; businessType: string; businessItem: string; industryCode: string; address: string; sendHourStart: number; sendHourEnd: number; dailyLimit: number; duplicateDays: number; costPerSms: string | number; costPerLms: string | number; costPerMms: string | number; costPerKakao: string | number; costPerBrand: string | number; costPerBrandNonfriend: string | number; costPerTestSms: string | number; costPerTestLms: string | number; unitPriceBasis: 'vat_included' | 'vat_excluded'; billingType: string; balance: number; balanceAdjustType: 'charge' | 'deduct'; balanceAdjustAmount: string; balanceAdjustReason: string; balanceAdjusting: boolean; targetStrategy: string; crossCategoryAllowed: boolean; excludedSegments: string[]; approvalRequired: boolean; allowCallbackSelfRegister: boolean; maxUsers: number; sessionTimeoutMinutes: number; storeCodeList: string[]; newStoreCode: string; newExcludedSegment: string; lineGroupId: string; kakaoEnabled: boolean; userIsolationEnabled: boolean; usageType: string; useAiOrchestrator: boolean; cdpAutoExecuteEnabled: boolean; cdpAutoExecuteMaxRecipients: number; cdpAutoExecuteMaxCostKrw: number; cdpAutoExecuteMaxRisk: string; agencySendEnabled: boolean; subscriptionStatus: string; trialExpiresAt: string | null | ''; planCode: string; aiOperatorTrialStartedAt: string | null | ''; aiOperatorTrialUntil: string | null | ''; };
  setShowEditCompanyModal: Dispatch<SetStateAction<boolean>>;
  setShowSyncRegenConfirm: Dispatch<SetStateAction<boolean>>;
  setSyncKeyVisible: Dispatch<SetStateAction<boolean>>;
  setSyncKeys: Dispatch<SetStateAction<{ api_key: string | null; api_secret?: string | null; has_secret?: boolean; use_db_sync: boolean; }>>;
  setSyncLoading: Dispatch<SetStateAction<boolean>>;
  setSyncSecretVisible: Dispatch<SetStateAction<boolean>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  showSyncRegenConfirm: boolean;
  syncKeyVisible: boolean;
  syncKeys: { api_key: string | null; api_secret?: string | null; has_secret?: boolean; use_db_sync: boolean; };
  syncLoading: boolean;
  syncSecretVisible: boolean;
}

export default function CompanySyncTab(props: CompanySyncTabProps) {
  const { editCompany, setShowEditCompanyModal, setShowSyncRegenConfirm, setSyncKeyVisible, setSyncKeys, setSyncLoading, setSyncSecretVisible, showAlert, showSyncRegenConfirm, syncKeyVisible, syncKeys, syncLoading, syncSecretVisible } = props;


// SyncAgent 키 재발급
const handleSyncRegenerate = async () => {
  if (!editCompany.id) return;
  setSyncLoading(true);
  try {
    const res = await fetch(`/api/admin/companies/${editCompany.id}/sync-keys/regenerate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    if (res.ok) {
      const data = await res.json();
      setSyncKeys(data.syncKeys);
      setSyncKeyVisible(true);
      setSyncSecretVisible(true);
      showAlert('재발급 완료', data.message, 'success');
    }
  } catch (error) {
    console.error('SyncAgent 키 재발급 실패:', error);
  } finally {
    setSyncLoading(false);
    setShowSyncRegenConfirm(false);
  }
};

// SyncAgent use_db_sync 토글
const handleSyncToggle = async (useDbSync: boolean) => {
  if (!editCompany.id) return;
  setSyncLoading(true);
  try {
    const res = await fetch(`/api/admin/companies/${editCompany.id}/sync-keys`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({ useDbSync })
    });
    if (res.ok) {
      const data = await res.json();
      // ★2026-09-13(3) 토글 응답에는 시크릿 원문이 없다(서버에 남지 않는다 · 싱크 등재분 ③).
      //   방금 재발급해 한 번만 보여 주던 원문을 토글 한 번에 지우지 않는다(같은 키일 때만 이어 둔다).
      setSyncKeys((prev) => ({
        ...data.syncKeys,
        ...(prev.api_secret && prev.api_key === data.syncKeys?.api_key ? { api_secret: prev.api_secret } : {}),
      }));
    }
  } catch (error) {
    console.error('SyncAgent 토글 실패:', error);
  } finally {
    setSyncLoading(false);
  }
};
  return (
    <>
    {(
                <div className="space-y-5">
                  {syncLoading ? (
                    <div className="text-center py-8 text-gray-500">로딩 중...</div>
                  ) : (
                    <>
                      {/* use_db_sync 토글 */}
                      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div>
                          <div className="text-sm font-medium text-gray-800">SyncAgent 활성화</div>
                          <p className="text-xs text-gray-500 mt-0.5">고객사 DB 자동 동기화 기능</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSyncToggle(!syncKeys.use_db_sync)}
                          className={`relative w-12 h-6 rounded-full transition-colors ${syncKeys.use_db_sync ? 'bg-emerald-600' : 'bg-gray-300'}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${syncKeys.use_db_sync ? 'translate-x-6' : ''}`} />
                        </button>
                      </div>

                      {/* API Key 영역 */}
                      <div className={`space-y-4 ${!syncKeys.use_db_sync ? 'opacity-50 pointer-events-none' : ''}`}>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">API Key</label>
                          <div className="flex gap-2">
                            <div className="flex-1 relative">
                              <input type="text" readOnly
                                value={syncKeys.api_key ? (syncKeyVisible ? syncKeys.api_key : '••••••••••••••••••••') : '(미발급)'}
                                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg bg-gray-50 text-[13px] font-mono pr-10"
                              />
                              {syncKeys.api_key && (
                                <button type="button" onClick={() => setSyncKeyVisible(!syncKeyVisible)}
                                  className="whitespace-nowrap absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">
                                  {syncKeyVisible ? '숨김' : '보기'}
                                </button>
                              )}
                            </div>
                            {syncKeys.api_key && syncKeyVisible && (
                              <button type="button"
                                onClick={() => { navigator.clipboard.writeText(syncKeys.api_key || ''); showAlert('복사 완료', '복사되었습니다.', 'success'); }}
                                className="px-3 py-2 border rounded-lg text-xs text-gray-600 hover:bg-gray-50 whitespace-nowrap">
                                복사
                              </button>
                            )}
                          </div>
                        </div>

                        {/* ★2026-09-12 시크릿은 서버에 원문으로 남지 않는다. 재발급 직후 이 화면에서만 보인다. */}
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">API Secret</label>
                          <div className="flex gap-2">
                            <div className="flex-1 relative">
                              <input type="text" readOnly
                                value={syncKeys.api_secret
                                  ? (syncSecretVisible ? syncKeys.api_secret : '••••••••••••••••••••')
                                  : (syncKeys.has_secret ? '발급되어 있습니다 (다시 볼 수 없음)' : '(미발급)')}
                                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg bg-gray-50 text-[13px] font-mono pr-10"
                              />
                              {syncKeys.api_secret && (
                                <button type="button" onClick={() => setSyncSecretVisible(!syncSecretVisible)}
                                  className="whitespace-nowrap absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">
                                  {syncSecretVisible ? '숨김' : '보기'}
                                </button>
                              )}
                            </div>
                            {syncKeys.api_secret && syncSecretVisible && (
                              <button type="button"
                                onClick={() => { navigator.clipboard.writeText(syncKeys.api_secret || ''); showAlert('복사 완료', '복사되었습니다.', 'success'); }}
                                className="px-3 py-2 border rounded-lg text-xs text-gray-600 hover:bg-gray-50 whitespace-nowrap">
                                복사
                              </button>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-gray-500">
                            {syncKeys.api_secret
                              ? '지금 화면을 벗어나면 다시 볼 수 없습니다. 설치에 쓸 값을 복사해 두세요.'
                              : '보안을 위해 서버에 원문을 두지 않습니다. 값이 필요하면 아래에서 재발급하세요.'}
                          </p>
                        </div>

                        {/* 재발급 버튼 */}
                        <div className="pt-3 border-t">
                          {!showSyncRegenConfirm ? (
                            <button type="button" onClick={() => setShowSyncRegenConfirm(true)}
                              className="whitespace-nowrap w-full px-4 py-2.5 bg-orange-50 text-orange-700 border border-orange-200 rounded-lg text-[13px] font-medium hover:bg-orange-100 transition">
                              API Key 재발급
                            </button>
                          ) : (
                            <div className="p-4 bg-red-50 border border-red-200 rounded-lg space-y-3">
                              <div className="text-sm text-red-700 font-medium">정말 재발급하시겠습니까?</div>
                              <p className="text-xs text-red-600">기존 API Key는 즉시 무효화됩니다. 해당 고객사의 SyncAgent가 새 키로 재설정되어야 합니다.</p>
                              <div className="flex gap-2">
                                <button type="button" onClick={() => setShowSyncRegenConfirm(false)}
                                  className="whitespace-nowrap flex-1 px-3 py-2 border rounded-lg text-[13px] text-gray-600 hover:bg-gray-50">
                                  취소
                                </button>
                                <button type="button" onClick={handleSyncRegenerate}
                                  className="whitespace-nowrap flex-1 px-3 py-2 bg-red-600 text-white rounded-lg text-[13px] font-medium hover:bg-red-700">
                                  재발급 확인
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        <p className="text-xs text-gray-400">
                          SyncAgent 설치 시 위 API Key/Secret을 고객사 에이전트 설정 파일에 입력합니다.
                          재발급 시 기존 키는 즉시 무효화되므로, 에이전트 설정도 함께 변경해야 합니다.
                        </p>
                      </div>
                    </>
                  )}

                  {/* 닫기 버튼 */}
                  <div className="flex pt-4 mt-4 border-t">
                    <button type="button" onClick={() => setShowEditCompanyModal(false)}
                      className="whitespace-nowrap w-full px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50">
                      닫기
                    </button>
                  </div>
                </div>
              )}
    </>
  );
}
