/**
 * CompanyBillingTab — 슈퍼관리자 CompanyDetailModal 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import type { BillingRecipient } from '../../../BillingRecipientsEditor';
import BillingRecipientsEditor from '../../../BillingRecipientsEditor';
import { taxbillIssueDatePreviewText, type TaxbillDayPolicy } from '../../../../utils/taxbillDate';

export interface CompanyBillingTabProps {
  btAccounts: any[];
  btBizDraft: any;
  btBizExtracting: boolean;
  btBizTarget: string | null;
  btCompanyContact: { name: string; email: string; } & Partial<{ taxbill_biz_number: string; taxbill_company_name: string; taxbill_ceo_name: string; taxbill_address: string; taxbill_biz_type: string; taxbill_biz_item: string; }>;
  btLoading: boolean;
  btRecipients: BillingRecipient[];
  btSaving: boolean;
  btSettings: { issue_scope: string; taxbill_day_policy: string; manual_billing: boolean; require_taxbill_remark: boolean; };
  editCompany: { id: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; status: string; planId: string; rejectNumber: string; businessNumber: string; ceoName: string; businessType: string; businessItem: string; industryCode: string; address: string; sendHourStart: number; sendHourEnd: number; dailyLimit: number; duplicateDays: number; costPerSms: string | number; costPerLms: string | number; costPerMms: string | number; costPerKakao: string | number; costPerBrand: string | number; costPerBrandNonfriend: string | number; costPerTestSms: string | number; costPerTestLms: string | number; unitPriceBasis: 'vat_included' | 'vat_excluded'; billingType: string; balance: number; balanceAdjustType: 'charge' | 'deduct'; balanceAdjustAmount: string; balanceAdjustReason: string; balanceAdjusting: boolean; targetStrategy: string; crossCategoryAllowed: boolean; excludedSegments: string[]; approvalRequired: boolean; allowCallbackSelfRegister: boolean; maxUsers: number; sessionTimeoutMinutes: number; storeCodeList: string[]; newStoreCode: string; newExcludedSegment: string; lineGroupId: string; kakaoEnabled: boolean; userIsolationEnabled: boolean; usageType: string; useAiOrchestrator: boolean; cdpAutoExecuteEnabled: boolean; cdpAutoExecuteMaxRecipients: number; cdpAutoExecuteMaxCostKrw: number; cdpAutoExecuteMaxRisk: string; agencySendEnabled: boolean; subscriptionStatus: string; trialExpiresAt: string | null | ''; planCode: string; aiOperatorTrialStartedAt: string | null | ''; aiOperatorTrialUntil: string | null | ''; };
  setBtAccounts: Dispatch<SetStateAction<any[]>>;
  setBtBizDraft: Dispatch<any>;
  setBtBizExtracting: Dispatch<SetStateAction<boolean>>;
  setBtBizTarget: Dispatch<SetStateAction<string | null>>;
  setBtCompanyContact: Dispatch<SetStateAction<{ name: string; email: string; } & Partial<{ taxbill_biz_number: string; taxbill_company_name: string; taxbill_ceo_name: string; taxbill_address: string; taxbill_biz_type: string; taxbill_biz_item: string; }>>>;
  setBtRecipients: Dispatch<SetStateAction<BillingRecipient[]>>;
  setBtSaving: Dispatch<SetStateAction<boolean>>;
  setBtSettings: Dispatch<SetStateAction<{ issue_scope: string; taxbill_day_policy: string; manual_billing: boolean; require_taxbill_remark: boolean; }>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
}

export default function CompanyBillingTab(props: CompanyBillingTabProps) {
  const { btAccounts, btBizDraft, btBizExtracting, btBizTarget, btCompanyContact, btLoading, btRecipients, btSaving, btSettings, editCompany, setBtAccounts, setBtBizDraft, setBtBizExtracting, setBtBizTarget, setBtCompanyContact, setBtRecipients, setBtSaving, setBtSettings, showAlert } = props;


  // ★ 2026-07-28 사업자등록증 자동입력 — 파일 선택 즉시 판독해 입력칸을 채운다(저장은 사람이 확정)
  const handleBizRegistrationFile = async (file: File | null) => {
    if (!file) return;
    setBtBizExtracting(true);
    try {
      const token = localStorage.getItem('token');
      const form = new FormData();
      form.append('image', file);
      const res = await fetch('/api/admin/billing/biz-registration-extract', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || '사업자등록증 판독 실패');
      const info = data.info || {};
      setBtBizDraft((prev: any) => ({
        ...prev,
        taxbill_biz_number: info.biz_number || prev.taxbill_biz_number || '',
        taxbill_company_name: info.company_name || prev.taxbill_company_name || '',
        taxbill_ceo_name: info.ceo_name || prev.taxbill_ceo_name || '',
        taxbill_address: info.address || prev.taxbill_address || '',
        taxbill_biz_type: info.biz_type || prev.taxbill_biz_type || '',
        taxbill_biz_item: info.biz_item || prev.taxbill_biz_item || '',
      }));
      showAlert('완료', '사업자등록증에서 정보를 읽어 입력칸에 채웠습니다. 내용을 확인한 뒤 적용해 주세요.', 'success');
    } catch (e: any) {
      showAlert('오류', e?.message || '사업자등록증 판독 실패', 'error');
    } finally {
      setBtBizExtracting(false);
    }
  };

  const handleSaveBillingTab = async () => {
    if (!editCompany.id) return;
    // ★ 2026-07-31 이메일 검증은 여기서 하지 않는다 — 수신자는 `billing_recipients` 편집기가
    //   행 단위로 즉시 저장하며 형식 검증도 그쪽(서버 CT 포함)에서 한다.
    setBtSaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/billing/company-billing-settings/${editCompany.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          issue_scope: btSettings.issue_scope,
          taxbill_day_policy: btSettings.taxbill_day_policy,
          require_taxbill_remark: btSettings.require_taxbill_remark,
          manual_billing: btSettings.manual_billing,
          // 회사 레벨은 담당자 + 계산서 사업자를 함께 보낸다. 사업자를 비워 보내면 그대로 NULL이 되고,
          // 발급 시 회사 기본정보(companies)로 내려간다 — 우선순위는 SoT §5 참조.
          // ★ 2026-07-31 `email`은 더 이상 보내지 않는다 — 수신자 원장이 `billing_recipients`로 옮겨졌고,
          //   이 컬럼을 계속 채우면 "어느 쪽이 진짜 수신자인가"가 다시 갈린다(저장할 때마다 NULL로 빠진다).
          company_contact: {
            name: btCompanyContact.name,
            taxbill_biz_number: btCompanyContact.taxbill_biz_number, taxbill_company_name: btCompanyContact.taxbill_company_name,
            taxbill_ceo_name: btCompanyContact.taxbill_ceo_name, taxbill_address: btCompanyContact.taxbill_address,
            taxbill_biz_type: btCompanyContact.taxbill_biz_type, taxbill_biz_item: btCompanyContact.taxbill_biz_item,
          },
          // 토글이 전체 발급이어도 계정 담당자 입력분은 보존 저장한다 — 토글을 되돌렸을 때 다시 입력하지 않게.
          account_contacts: btAccounts.map((a) => ({
            // label = 사업자번호 검증 오류에 "어느 계정인지"를 담기 위한 표시용(서버 저장 대상 아님).
            user_id: a.user_id, label: a.name || a.login_id, name: a.contact_name,
            taxbill_biz_number: a.taxbill_biz_number, taxbill_company_name: a.taxbill_company_name,
            taxbill_ceo_name: a.taxbill_ceo_name, taxbill_address: a.taxbill_address,
            taxbill_biz_type: a.taxbill_biz_type, taxbill_biz_item: a.taxbill_biz_item,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '정산 설정 저장 실패');
      showAlert('성공', '정산 설정이 저장되었습니다. 이메일이 등록된 회사는 거래내역서가 자동 발송됩니다.', 'success');
    } catch (e: any) {
      showAlert('오류', e?.message || '정산 설정 저장 실패', 'error');
    } finally {
      setBtSaving(false);
    }
  };
  return (
    <>
    {(
                <div className="space-y-5">
                  {btLoading ? (
                    <p className="text-sm text-gray-400 py-8 text-center">정산 설정을 불러오는 중...</p>
                  ) : (
                    <>
                      {/* 발행 단위 토글 */}
                      <div className="rounded-lg border border-gray-200 p-4">
                        <p className="text-sm font-semibold text-gray-800 mb-1">거래내역서 발행 단위</p>
                        <p className="text-xs text-gray-500 mb-3">일괄발급 화면에서 이 회사가 기본으로 앉는 자리입니다. 계정별 = 계정 장 N개 + 공통 장(테스트·스팸·크레딧·요금제) 1개.</p>
                        <div className="flex rounded-lg overflow-hidden border border-gray-300 w-fit">
                          <button type="button" onClick={() => setBtSettings({ ...btSettings, issue_scope: 'combined' })}
                            className={`whitespace-nowrap px-4 py-2 text-[13px] font-semibold transition-colors ${btSettings.issue_scope === 'combined' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                            고객사 전체 발급
                          </button>
                          <button type="button" onClick={() => setBtSettings({ ...btSettings, issue_scope: 'by_user' })}
                            className={`whitespace-nowrap px-4 py-2 text-[13px] font-semibold transition-colors ${btSettings.issue_scope === 'by_user' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                            개별(계정별) 발급
                          </button>
                        </div>
                      </div>

                      {/* ★ 2026-07-29 수동 정산 회사 — 일괄발급 담기에서 자동으로 빠진다 (목록에서 숨기지는 않는다) */}
                      <div className={`rounded-lg border p-4 ${btSettings.manual_billing ? 'border-amber-300 bg-amber-50/50' : 'border-gray-200'}`}>
                        <label className="flex items-start gap-3 cursor-pointer">
                          <input type="checkbox" checked={btSettings.manual_billing}
                            onChange={(e) => setBtSettings({ ...btSettings, manual_billing: e.target.checked })}
                            className="mt-0.5 w-4 h-4 accent-amber-600" />
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-semibold text-gray-800">수동 정산 회사: 일괄발급 대상 제외</span>
                            <span className="block text-xs text-gray-500 mt-1">
                              우리 정산으로 거래내역서를 발행할 수 없어 사람이 따로 처리하는 회사입니다. 켜두면 일괄발급 화면의
                              [전체 담기]와 [선택 담기] 양쪽에서 이 회사가 빠집니다. 목록에서 숨기지는 않습니다.
                              그 달 처리 여부를 볼 수 있어야 하고, 처리했으면 그 화면에서 [수동 정산완료]를 눌러 목록에서 뺍니다.
                            </span>
                          </span>
                        </label>
                      </div>

                      {/* 회사 정산 담당자 — 전체 발급 수신자 + 계정별일 때 공통 장 수신자 */}
                      <div className="rounded-lg border border-gray-200 p-4">
                        <p className="text-sm font-semibold text-gray-800 mb-1">회사 정산 담당자</p>
                        <p className="text-xs text-gray-500 mb-3">거래내역서 자동 발송 수신자입니다. 기본정보 탭의 담당자(마케팅)와 별개입니다. 계정별 발급이어도 공통 장은 여기로 갑니다.</p>
                        <input type="text" value={btCompanyContact.name} placeholder="담당자 이름"
                          onChange={(e) => setBtCompanyContact({ ...btCompanyContact, name: e.target.value })}
                          className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none" />
                        {/* ★ 2026-07-31 이메일은 칸 하나가 아니라 수신자 목록이다 — 유형(거래내역서/세금계산서)이
                            다를 수 있고 여러 명일 수 있다. 저장 버튼과 무관하게 즉시 반영된다(행 단위 CRUD). */}
                        <BillingRecipientsEditor
                          companyId={editCompany.id}
                          userId={null}
                          recipients={btRecipients}
                          onChanged={setBtRecipients}
                          onError={(m) => showAlert('오류', m, 'error')}
                        />
                        {/* ★ 2026-07-28 회사 기본 사업자 — 전체 발급이면 이 사업자로 계산서가 나간다.
                            계정별과 같은 모달·같은 사업자등록증 자동입력을 쓴다(문구만 분기). */}
                        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-gray-700">계산서 발급 사업자 (회사 기본)</p>
                            <p className="text-[11px] text-gray-400 truncate">
                              {btCompanyContact.taxbill_biz_number
                                ? `${btCompanyContact.taxbill_company_name || ''} ${btCompanyContact.taxbill_biz_number}`.trim()
                                : '미등록. 비워두면 기본정보 탭의 회사 사업자정보로 발급됩니다.'}
                            </p>
                          </div>
                          <button type="button"
                            onClick={() => { setBtBizDraft({ ...btCompanyContact }); setBtBizTarget('company'); }}
                            className={`whitespace-nowrap shrink-0 px-2.5 py-1.5 rounded text-[11px] font-semibold border ${btCompanyContact.taxbill_biz_number ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                            {btCompanyContact.taxbill_biz_number ? '사업자 수정' : '사업자등록증 등록'}
                          </button>
                        </div>
                      </div>

                      {/* 계산서 발급일자 정책 */}
                      <div className="rounded-lg border border-gray-200 p-4">
                        <p className="text-sm font-semibold text-gray-800 mb-1">세금계산서 작성일자</p>
                        <p className="text-xs text-gray-500 mb-3">컨펌(또는 3일 경과) 후 자동 발급될 때 계산서에 적히는 작성일자입니다.</p>
                        <select value={btSettings.taxbill_day_policy}
                          onChange={(e) => setBtSettings({ ...btSettings, taxbill_day_policy: e.target.value })}
                          className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none">
                          <option value="last_day">대상월 말일 (30일 달이면 30일, 2월이면 28·29일)</option>
                          <option value="first_day">익월 1일 (12월분은 익년 1월 1일)</option>
                          <option value="manual">직접선택 (중간정산 등, 발급 때마다 날짜 지정, 자동 발급 제외)</option>
                        </select>
                        {/* ★ 2026-07-28 예시 월을 글자로 적어두면 그 달에만 맞는 안내가 된다 — 현재 달 기준으로 계산해 보여준다(CT: utils/taxbillDate) */}
                        <p className="mt-2 text-xs text-indigo-600">{taxbillIssueDatePreviewText(btSettings.taxbill_day_policy as TaxbillDayPolicy)}</p>
                      </div>

                      {/* ★ 2026-08-21 계산서 비고(PO) 필수 — 시세이도처럼 부서 PO를 계산서 비고에 실어야 하는 회사. 켜면 작성일자 지정·변경 때 비고가 비어 있으면 막는다. */}
                      <div className="rounded-lg border border-gray-200 p-4">
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input type="checkbox" checked={btSettings.require_taxbill_remark}
                            onChange={(e) => setBtSettings({ ...btSettings, require_taxbill_remark: e.target.checked })}
                            className="mt-0.5 rounded text-[13px] border-gray-300 text-emerald-600 focus:ring-emerald-500/30" />
                          <span>
                            <span className="text-sm font-semibold text-gray-800">계산서 비고(PO번호) 필수</span>
                            <span className="block text-xs text-gray-500 mt-0.5">작성일자를 지정할 때 비고(PO번호 등)를 반드시 입력하게 합니다. 입력한 값은 세금계산서 비고란에 그대로 인쇄됩니다.</span>
                          </span>
                        </label>
                      </div>

                      {/* 계정별 담당자·사업자 (개별 발급일 때 펼침) */}
                      {btSettings.issue_scope === 'by_user' && (
                        <div className="rounded-lg border border-gray-200 p-4">
                          <p className="text-sm font-semibold text-gray-800 mb-1">계정별 정산 담당자</p>
                          <p className="text-xs text-gray-500 mb-3">계정 장은 여기 등록된 이메일로 각각 발송·컨펌됩니다. 사업장이 다른 계정은 [계산서 사업자]로 별도 사업자를 등록하세요. 미등록이면 회사 기본 사업자로 발급됩니다.</p>
                          <div className="space-y-2">
                            {btAccounts.length === 0 && <p className="text-xs text-gray-400">활성 계정이 없습니다.</p>}
                            {btAccounts.map((a) => (
                              <div key={a.user_id} className="border rounded-lg px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <div className="w-32 shrink-0">
                                    <p className="text-sm font-medium text-gray-800 truncate">{a.name || a.login_id}</p>
                                    <p className="text-[10px] text-gray-400 truncate">{a.login_id}</p>
                                  </div>
                                  <input type="text" value={a.contact_name} placeholder="담당자 이름"
                                    onChange={(e) => setBtAccounts((prev) => prev.map((x) => x.user_id === a.user_id ? { ...x, contact_name: e.target.value } : x))}
                                    className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-xs focus:ring-1 focus:ring-emerald-500/30 outline-none" />
                                  <button type="button"
                                    onClick={() => { setBtBizDraft({ ...a }); setBtBizTarget(a.user_id); }}
                                    className={`whitespace-nowrap shrink-0 px-2.5 py-1.5 rounded text-[11px] font-semibold border ${a.taxbill_biz_number ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
                                    {a.taxbill_biz_number ? `사업자 ${a.taxbill_biz_number}` : '계산서 사업자'}
                                  </button>
                                </div>
                                {/* 계정 장의 수신자 — 회사 레벨과 같은 편집기·같은 규칙(유형별 대표 1명 + 참조) */}
                                <div className="mt-2">
                                  <BillingRecipientsEditor
                                    companyId={editCompany.id}
                                    userId={a.user_id}
                                    recipients={btRecipients}
                                    onChanged={setBtRecipients}
                                    onError={(m) => showAlert('오류', m, 'error')}
                                    compact
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <button type="button" onClick={handleSaveBillingTab} disabled={btSaving}
                        className="whitespace-nowrap w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-[13px] font-semibold">
                        {btSaving ? '저장 중...' : '정산 설정 저장'}
                      </button>
                    </>
                  )}

                  {/* 계산서 발급 사업자 등록 모달 — 회사 기본('company')과 계정별(user_id)이 같은 화면을 쓴다 */}
                  {btBizTarget && (
                    <div className="fixed inset-0 z-[60] bg-gray-900/40 flex items-center justify-center p-4" onClick={() => setBtBizTarget(null)}>
                      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-base font-bold text-gray-900 mb-1">
                          {btBizTarget === 'company' ? '회사 기본 계산서 사업자' : '계산서 발급 사업자 등록'}
                        </h3>
                        <p className="text-xs text-gray-500 mb-3">
                          {btBizTarget === 'company'
                            ? '고객사 전체 발급이면 이 사업자로 세금계산서가 나갑니다. 전부 비우면 기본정보 탭의 회사 사업자정보로 발급됩니다.'
                            : '이 계정의 계산서를 받을 사업자 정보입니다. 전부 비우면 회사 기본 사업자로 발급됩니다.'}
                        </p>
                        {/* ★ 2026-07-28 사업자등록증 자동입력 — 파일을 올리면 상호·사업자번호·대표자·주소·업태·종목을 읽어 채운다 */}
                        <label className={`flex items-center justify-center gap-2 mb-4 px-3 py-2.5 border-2 border-dashed rounded-lg cursor-pointer text-xs font-semibold ${btBizExtracting ? 'border-gray-200 text-gray-400' : 'border-indigo-300 text-indigo-600 hover:bg-indigo-50'}`}>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 9l5-5 5 5M12 4v12" />
                          </svg>
                          {btBizExtracting ? '사업자등록증 읽는 중...' : '사업자등록증으로 자동입력 (JPG·PNG·WebP·PDF)'}
                          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" disabled={btBizExtracting}
                            onChange={(e) => { handleBizRegistrationFile(e.target.files?.[0] || null); e.target.value = ''; }} />
                        </label>
                        <div className="space-y-2.5">
                          {[
                            { k: 'taxbill_biz_number', label: '사업자등록번호', ph: '000-00-00000' },
                            { k: 'taxbill_company_name', label: '상호', ph: '' },
                            { k: 'taxbill_ceo_name', label: '대표자명', ph: '' },
                            { k: 'taxbill_address', label: '사업장 주소', ph: '' },
                            { k: 'taxbill_biz_type', label: '업태', ph: '' },
                            { k: 'taxbill_biz_item', label: '종목', ph: '' },
                          ].map((f) => (
                            <div key={f.k}>
                              <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
                              <input type="text" value={btBizDraft[f.k] || ''} placeholder={f.ph}
                                onChange={(e) => setBtBizDraft({ ...btBizDraft, [f.k]: e.target.value })}
                                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none" />
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2 mt-5">
                          <button type="button" onClick={() => setBtBizTarget(null)}
                            className="whitespace-nowrap flex-1 py-2 border border-gray-300 rounded-lg text-[13px] text-gray-600 hover:bg-gray-50">취소</button>
                          <button type="button"
                            onClick={() => {
                              // 회사 기본은 담당자 이름·이메일을 덮지 않도록 사업자 6필드만 병합한다(모달 draft에 담당자 값이 섞여 들어온다).
                              if (btBizTarget === 'company') {
                                setBtCompanyContact((prev: any) => ({
                                  ...prev,
                                  taxbill_biz_number: btBizDraft.taxbill_biz_number || '',
                                  taxbill_company_name: btBizDraft.taxbill_company_name || '',
                                  taxbill_ceo_name: btBizDraft.taxbill_ceo_name || '',
                                  taxbill_address: btBizDraft.taxbill_address || '',
                                  taxbill_biz_type: btBizDraft.taxbill_biz_type || '',
                                  taxbill_biz_item: btBizDraft.taxbill_biz_item || '',
                                }));
                              } else {
                                setBtAccounts((prev) => prev.map((x) => x.user_id === btBizTarget ? { ...x, ...btBizDraft } : x));
                              }
                              setBtBizTarget(null);
                            }}
                            className="whitespace-nowrap flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[13px] font-semibold">적용 (저장 버튼으로 확정)</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
    </>
  );
}
