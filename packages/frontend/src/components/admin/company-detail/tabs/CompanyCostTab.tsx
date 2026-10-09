/**
 * CompanyCostTab — 슈퍼관리자 CompanyDetailModal 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import { formatDateTime } from '../../../../utils/formatDate';
import PlanTermBox from '../../PlanTermBox';
import { previewUnitPrice, fmtPrice, toSupplyInputs } from '../../../../utils/unitPrice';
import { unitPriceApi } from '../../../../api/client';
import type { ModalState } from '../../admin-types';

export interface CompanyCostTabProps {
  applyUnitPriceToAgents: boolean;
  balanceTxList: any[];
  balanceTxLoading: boolean;
  editCompany: { id: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; status: string; planId: string; rejectNumber: string; businessNumber: string; ceoName: string; businessType: string; businessItem: string; industryCode: string; address: string; sendHourStart: number; sendHourEnd: number; dailyLimit: number; duplicateDays: number; costPerSms: string | number; costPerLms: string | number; costPerMms: string | number; costPerKakao: string | number; costPerBrand: string | number; costPerBrandNonfriend: string | number; costPerTestSms: string | number; costPerTestLms: string | number; unitPriceBasis: 'vat_included' | 'vat_excluded'; billingType: string; balance: number; balanceAdjustType: 'charge' | 'deduct'; balanceAdjustAmount: string; balanceAdjustReason: string; balanceAdjusting: boolean; targetStrategy: string; crossCategoryAllowed: boolean; excludedSegments: string[]; approvalRequired: boolean; allowCallbackSelfRegister: boolean; maxUsers: number; sessionTimeoutMinutes: number; storeCodeList: string[]; newStoreCode: string; newExcludedSegment: string; lineGroupId: string; kakaoEnabled: boolean; userIsolationEnabled: boolean; usageType: string; useAiOrchestrator: boolean; cdpAutoExecuteEnabled: boolean; cdpAutoExecuteMaxRecipients: number; cdpAutoExecuteMaxCostKrw: number; cdpAutoExecuteMaxRisk: string; agencySendEnabled: boolean; subscriptionStatus: string; trialExpiresAt: string | null | ''; planCode: string; aiOperatorTrialStartedAt: string | null | ''; aiOperatorTrialUntil: string | null | ''; };
  loadBalanceTx: (companyId: string) => Promise<void>;
  loadData: () => Promise<void>;
  savingUnitPrices: boolean;
  setApplyUnitPriceToAgents: Dispatch<SetStateAction<boolean>>;
  setBillingToast: Dispatch<SetStateAction<{ msg: string; type: 'success' | 'error'; } | null>>;
  setEditCompany: Dispatch<SetStateAction<{ id: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; status: string; planId: string; rejectNumber: string; businessNumber: string; ceoName: string; businessType: string; businessItem: string; industryCode: string; address: string; sendHourStart: number; sendHourEnd: number; dailyLimit: number; duplicateDays: number; costPerSms: string | number; costPerLms: string | number; costPerMms: string | number; costPerKakao: string | number; costPerBrand: string | number; costPerBrandNonfriend: string | number; costPerTestSms: string | number; costPerTestLms: string | number; unitPriceBasis: 'vat_included' | 'vat_excluded'; billingType: string; balance: number; balanceAdjustType: 'charge' | 'deduct'; balanceAdjustAmount: string; balanceAdjustReason: string; balanceAdjusting: boolean; targetStrategy: string; crossCategoryAllowed: boolean; excludedSegments: string[]; approvalRequired: boolean; allowCallbackSelfRegister: boolean; maxUsers: number; sessionTimeoutMinutes: number; storeCodeList: string[]; newStoreCode: string; newExcludedSegment: string; lineGroupId: string; kakaoEnabled: boolean; userIsolationEnabled: boolean; usageType: string; useAiOrchestrator: boolean; cdpAutoExecuteEnabled: boolean; cdpAutoExecuteMaxRecipients: number; cdpAutoExecuteMaxCostKrw: number; cdpAutoExecuteMaxRisk: string; agencySendEnabled: boolean; subscriptionStatus: string; trialExpiresAt: string | null | ''; planCode: string; aiOperatorTrialStartedAt: string | null | ''; aiOperatorTrialUntil: string | null | ''; }>>;
  setModal: Dispatch<SetStateAction<ModalState>>;
  setSavingUnitPrices: Dispatch<SetStateAction<boolean>>;
}

export default function CompanyCostTab(props: CompanyCostTabProps) {
  const { applyUnitPriceToAgents, balanceTxList, balanceTxLoading, editCompany, loadBalanceTx, loadData, savingUnitPrices, setApplyUnitPriceToAgents, setBillingToast, setEditCompany, setModal, setSavingUnitPrices } = props;


  // ★ 2026-07-26 단가 저장 — 기본정보 수정과 분리된 전용 경로.
  //   저장 성공 시 그 회사의 기준이 'vat_excluded'로 전환되므로, 화면 상태도 즉시 맞춰
  //   같은 화면에서 두 번 저장했을 때 안내 문구가 어긋나지 않게 한다.
  const handleSaveUnitPrices = async () => {
    if (!editCompany?.id) return;
    setSavingUnitPrices(true);
    try {
      const res = await unitPriceApi.save(
        editCompany.id,
        {
          sms: editCompany.costPerSms,
          lms: editCompany.costPerLms,
          mms: editCompany.costPerMms,
          kakao: editCompany.costPerKakao,
          brand: editCompany.costPerBrand,
          brandNonfriend: editCompany.costPerBrandNonfriend,
          testSms: editCompany.costPerTestSms,
          testLms: editCompany.costPerTestLms,
        },
        applyUnitPriceToAgents,
      );
      if (!res.data?.success) throw new Error(res.data?.error || '단가 저장 실패');
      // ★ 2026-07-26 서버가 반올림해 실제로 저장한 값을 화면에 되돌린다(Codex #10).
      //   요청값을 그대로 두면 7.199처럼 입력한 뒤 화면과 DB가 갈린다.
      const saved = res.data.company || {};
      setEditCompany((prev: any) => ({
        ...prev,
        ...toSupplyInputs({ ...saved, unit_price_basis: 'vat_excluded' }),
        unitPriceBasis: 'vat_excluded',
      }));
      setApplyUnitPriceToAgents(false);
      setBillingToast({ msg: res.data.message || '단가를 저장했습니다.', type: 'success' });
      await loadData();
    } catch (err: any) {
      setBillingToast({ msg: err?.response?.data?.error || err?.message || '단가 저장 실패', type: 'error' });
    } finally {
      setSavingUnitPrices(false);
    }
  };
  return (
    <>
    {(
                <div className="space-y-4">
                  {/* 요금제 유형 전환 */}
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-200">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="text-sm font-bold text-gray-800">요금제 유형</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {editCompany.billingType === 'prepaid' ? '선불: 충전 후 차감' : '후불: 월말 정산'}
                        </div>
                      </div>
                      <div className="flex bg-white rounded-lg border shadow-sm overflow-hidden">
                        <button type="button"
                          onClick={async () => {
                            if (editCompany.billingType === 'postpaid') return;
                            try {
                              const token = localStorage.getItem('token');
                              const res = await fetch(`/api/admin/companies/${editCompany.id}/billing-type`, {
                                method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                body: JSON.stringify({ billingType: 'postpaid' })
                              });
                              const data = await res.json();
                              if (res.ok) {
                                setEditCompany({ ...editCompany, billingType: 'postpaid' });
                                setModal({ type: 'alert', title: '변경 완료', message: data.message, variant: 'success' });
                              } else {
                                setModal({ type: 'alert', title: '변경 실패', message: data.error, variant: 'error' });
                              }
                            } catch { setModal({ type: 'alert', title: '오류', message: '요금제 유형 변경 실패', variant: 'error' }); }
                          }}
                          className={`whitespace-nowrap px-4 py-2 text-xs font-medium transition-colors ${editCompany.billingType === 'postpaid' ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                        >후불</button>
                        <button type="button"
                          onClick={async () => {
                            if (editCompany.billingType === 'prepaid') return;
                            try {
                              const token = localStorage.getItem('token');
                              const res = await fetch(`/api/admin/companies/${editCompany.id}/billing-type`, {
                                method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                body: JSON.stringify({ billingType: 'prepaid' })
                              });
                              const data = await res.json();
                              if (res.ok) {
                                setEditCompany({ ...editCompany, billingType: 'prepaid' });
                                setModal({ type: 'alert', title: '변경 완료', message: data.message, variant: 'success' });
                              } else {
                                setModal({ type: 'alert', title: '변경 실패', message: data.error, variant: 'error' });
                              }
                            } catch { setModal({ type: 'alert', title: '오류', message: '요금제 유형 변경 실패', variant: 'error' }); }
                          }}
                          className={`whitespace-nowrap px-4 py-2 text-xs font-medium transition-colors ${editCompany.billingType === 'prepaid' ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                        >선불</button>
                      </div>
                    </div>
                  </div>

                  {/* 선불 잔액 관리 (선불일 때만) */}
                  {editCompany.billingType === 'prepaid' && (
                    <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl p-4 border border-emerald-200">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm font-bold text-gray-800">충전 잔액</div>
                        <div className={`text-xl font-bold ${editCompany.balance < 10000 ? 'text-red-600' : 'text-emerald-700'}`}>
                          {editCompany.balance.toLocaleString()}원
                        </div>
                      </div>
                      <div className="flex gap-2 mb-3">
                        <button type="button" onClick={() => setEditCompany({ ...editCompany, balanceAdjustType: 'charge' })}
                          className={`whitespace-nowrap flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${editCompany.balanceAdjustType === 'charge' ? 'bg-emerald-600 text-white' : 'bg-white border text-gray-600'}`}
                        >충전</button>
                        <button type="button" onClick={() => setEditCompany({ ...editCompany, balanceAdjustType: 'deduct' })}
                          className={`whitespace-nowrap flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${editCompany.balanceAdjustType === 'deduct' ? 'bg-red-600 text-white' : 'bg-white border text-gray-600'}`}
                        >차감</button>
                      </div>
                      <div className="space-y-2">
                        <input type="number" placeholder="금액 (원)" value={editCompany.balanceAdjustAmount}
                          onChange={(e) => setEditCompany({ ...editCompany, balanceAdjustAmount: e.target.value })}
                          className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500 outline-none" />
                        <input type="text" placeholder="사유 (필수)" value={editCompany.balanceAdjustReason}
                          onChange={(e) => setEditCompany({ ...editCompany, balanceAdjustReason: e.target.value })}
                          className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500 outline-none" />
                        <button type="button" disabled={editCompany.balanceAdjusting || !editCompany.balanceAdjustAmount || !editCompany.balanceAdjustReason}
                          onClick={async () => {
                            setEditCompany(prev => ({ ...prev, balanceAdjusting: true }));
                            try {
                              const token = localStorage.getItem('token');
                              const res = await fetch(`/api/admin/companies/${editCompany.id}/balance-adjust`, {
                                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                body: JSON.stringify({ type: editCompany.balanceAdjustType, amount: Number(editCompany.balanceAdjustAmount), reason: editCompany.balanceAdjustReason })
                              });
                              const data = await res.json();
                              if (res.ok) {
                                setEditCompany(prev => ({ ...prev, balance: data.balance, balanceAdjustAmount: '', balanceAdjustReason: '', balanceAdjusting: false }));
                                loadBalanceTx(editCompany.id);
                                setModal({ type: 'alert', title: '완료', message: data.message, variant: 'success' });
                              } else {
                                setEditCompany(prev => ({ ...prev, balanceAdjusting: false }));
                                setModal({ type: 'alert', title: '실패', message: data.error, variant: 'error' });
                              }
                            } catch { setEditCompany(prev => ({ ...prev, balanceAdjusting: false })); setModal({ type: 'alert', title: '오류', message: '잔액 조정 실패', variant: 'error' }); }
                          }}
                          className={`whitespace-nowrap w-full py-2.5 text-[13px] font-medium rounded-lg transition-colors disabled:opacity-50 ${
                            editCompany.balanceAdjustType === 'charge' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-red-600 hover:bg-red-700 text-white'
                          }`}
                        >{editCompany.balanceAdjusting ? '처리 중...' : editCompany.balanceAdjustType === 'charge' ? '충전하기' : '차감하기'}</button>
                      </div>

                      {/* 잔액 변동 이력 */}
                      <div className="mt-3 pt-3 border-t border-emerald-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold text-gray-700">최근 변동 이력</span>
                          <button type="button" onClick={() => loadBalanceTx(editCompany.id)}
                            className="whitespace-nowrap text-[10px] text-emerald-600 hover:underline">새로고침</button>
                        </div>
                        {balanceTxLoading ? (
                          <div className="text-xs text-gray-400 text-center py-2">불러오는 중...</div>
                        ) : balanceTxList.length === 0 ? (
                          <div className="text-xs text-gray-400 text-center py-2">
                            변동 이력이 없습니다.
                            <button type="button" onClick={() => loadBalanceTx(editCompany.id)} className="whitespace-nowrap ml-1 text-emerald-600 hover:underline">조회</button>
                          </div>
                        ) : (
                          <div className="max-h-[180px] overflow-y-auto space-y-1">
                            {balanceTxList.map((tx: any) => {
                              const typeColors: Record<string, string> = {
                                admin_charge: 'text-emerald-600', charge: 'text-emerald-600', deposit_charge: 'text-emerald-600',
                                admin_deduct: 'text-red-600', deduct: 'text-red-600',
                                refund: 'text-blue-600',
                              };
                              const typeLabels: Record<string, string> = {
                                admin_charge: '관리자 충전', charge: '충전', deposit_charge: '입금 충전',
                                admin_deduct: '관리자 차감', deduct: '발송 차감',
                                refund: '환불',
                              };
                              const isPlus = ['admin_charge', 'charge', 'deposit_charge', 'refund'].includes(tx.type);
                              return (
                                <div key={tx.id} className="flex items-center justify-between text-[11px] py-1 px-2 bg-white rounded border">
                                  <div className="flex-1">
                                    <span className={`font-medium ${typeColors[tx.type] || 'text-gray-600'}`}>
                                      {/* ★ 2026-10-04 요금제 이용료(선불 이용 기간)는 같은 차감 type이라 참조 유형으로 가른다 */}
                                      {tx.type === 'deduct' && tx.reference_type === 'plan_term' ? '요금제 이용료' : (typeLabels[tx.type] || tx.type)}
                                    </span>
                                    <span className="text-gray-400 ml-2">{tx.description?.slice(0, 30) || ''}</span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className={`font-bold ${isPlus ? 'text-emerald-600' : 'text-red-600'}`}>
                                      {isPlus ? '+' : '-'}{Number(tx.amount).toLocaleString()}원
                                    </span>
                                    <span className="text-gray-400 w-[55px] text-right">{formatDateTime(tx.created_at).slice(5, 16)}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ★ 2026-10-04 선불 요금제 이용 기간(docs/2026-10-04-prepaid-plan-term-design.md §7) — 잔액 조정과 같은 화면에서 */}
                  {editCompany.billingType === 'prepaid' && <PlanTermBox companyId={editCompany.id} />}

                  {/* ★ 2026-07-26 단가 입력 = 부가세 별도(공급가). 시스템이 건별 VAT를 자동 합산한다.
                      배경: 단가가 부가세 포함으로 입력돼 있었는데 청구가 10%를 또 더해 과청구가 났다.
                      화면에 기준을 못 박고, 칸마다 실제 차감액을 같이 보여줘 입력 즉시 검산되게 한다. */}
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-gray-900">
                          {editCompany.companyName || '고객사'} 공급 단가 (VAT 별도)
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-gray-600">
                          입력값은 <b>VAT 별도 공급가</b>입니다. 발송 시 건별 VAT 10%를 자동 계산해 합산하고,
                          저장 즉시 이 고객사의 청구·차감에 적용됩니다.
                        </p>
                      </div>
                      <span className="shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white">VAT 10% 자동</span>
                    </div>
                    {editCompany.unitPriceBasis !== 'vat_excluded' && (
                      <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        이 고객사는 아직 <b>부가세 포함 단가</b>로 저장돼 있습니다. 계약서의 <b>공급가(VAT 별도)</b>를 입력해 저장하면
                        기준이 전환되고, 그때부터 청구서에 부가세가 한 번만 붙습니다.
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {([
                      ['costPerSms', 'SMS', '단문 문자'],
                      ['costPerLms', 'LMS', '장문 문자'],
                      ['costPerMms', 'MMS', '이미지 문자'],
                      ['costPerKakao', '알림톡', '카카오 알림톡'],
                      ['costPerBrand', '브랜드메시지 친구', '채널 친구 대상 · 알림톡과 별도'],
                      ['costPerBrandNonfriend', '브랜드메시지 비친구', '마수동 전체·비친구 대상'],
                      ['costPerTestSms', '테스트 SMS', '비우면 SMS 단가'],
                      ['costPerTestLms', '테스트 LMS', '비우면 LMS 단가'],
                    ] as const).map(([key, label, hint]) => {
                      const raw = (editCompany as any)[key];
                      const p = previewUnitPrice(raw);
                      const empty = raw === '' || raw === null || raw === undefined;
                      return (
                        <div key={key} className="rounded-xl border border-gray-200 bg-white p-4">
                          <div className="mb-2 flex items-baseline justify-between gap-x-2 flex-wrap">
                            <label className="text-[13px] font-bold text-gray-900">{label}</label>
                            <span className="text-[11px] text-gray-400">{hint}</span>
                          </div>
                          <div className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 focus-within:ring-2 focus-within:ring-emerald-500">
                            <input
                              type="number" step="0.01" min="0" inputMode="decimal"
                              value={raw as any}
                              placeholder={key.startsWith('costPerTest') || key === 'costPerBrandNonfriend' ? '비우면 상속' : '0.00'}
                              onChange={(e) => setEditCompany({ ...editCompany, [key]: e.target.value === '' ? '' : e.target.value })}
                              className="w-full bg-transparent text-lg font-bold text-gray-900 outline-none"
                            />
                            <span className="shrink-0 text-xs text-gray-400">원 / 건</span>
                          </div>
                          {/* ★ 2026-09-04 문구 정정(서수란 접수 후속) — 종전엔 비어 있기만 하면 조건 없이
                              "청구서 발행이 차단됩니다"라고 했다. 실제 게이트는 **그 유형으로 성공 발송이
                              있을 때만** 막고(findUnsetPricedTypes·priceBillingRows), 테스트 단가는
                              비면 SMS·LMS를 상속한다(TEST_SMS: testSmsRaw ?? sms). 그래서 "안 쓰는 업체는
                              미지정인데 발행이 됐다"는 접수가 나왔다 — 화면이 거짓을 말하고 있었다. */}
                          <div className="mt-2 text-[11px] font-semibold text-emerald-700">
                            {empty
                              ? (key.startsWith('costPerTest')
                                  ? <span className="text-gray-400">미설정. {key === 'costPerTestSms' ? 'SMS' : 'LMS'} 단가를 따릅니다</span>
                                  : key === 'costPerBrandNonfriend'
                                    ? <span className="text-gray-400">미설정. 브랜드메시지 친구 단가를 따릅니다</span>
                                    : <span className="text-gray-400">미설정. 이 유형으로 발송이 있으면 청구서 발행이 차단됩니다</span>)
                              : <>VAT {fmtPrice(p.vat)}원 · <span className="text-emerald-800">VAT 포함 {fmtPrice(p.withVat)}원 차감</span></>}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <label className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2.5 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={applyUnitPriceToAgents}
                      onChange={(e) => setApplyUnitPriceToAgents(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      단가가 <b>비어 있는 발송ID</b>에도 이 값을 함께 적용합니다.
                      이미 값이 있는 발송ID는 건드리지 않습니다. 발송ID마다 계약이 다를 수 있어 자동 상속은 하지 않습니다.
                    </span>
                  </label>

                  <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">
                    <p className="text-[11px] leading-relaxed text-gray-500">
                      VAT는 건별 공급가의 10%를 소수점 둘째 자리로 반올림합니다.
                      선불은 VAT 포함 금액을 발송 시 차감하고 최종 실패 건만 같은 금액으로 환불합니다.
                      스팸필터 테스트는 별도 단가 없이 SMS·LMS 단가를 그대로 적용합니다.
                    </p>
                    <button
                      onClick={handleSaveUnitPrices}
                      disabled={savingUnitPrices}
                      className="whitespace-nowrap shrink-0 rounded-lg bg-emerald-600 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {savingUnitPrices ? '저장 중...' : '단가 저장'}
                    </button>
                  </div>
                </div>
              )}
    </>
  );
}
