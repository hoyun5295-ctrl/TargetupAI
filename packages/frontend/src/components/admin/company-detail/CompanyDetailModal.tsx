/**
 * CompanyDetailModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import { formatPlanOptionLabel, companyPlanState, trialDaysLeft } from '../../../utils/planLabel';
import { AdminPill, ADMIN_BTN, ADMIN_BTN_PRIMARY } from '../ui/admin-ui';
import type { JSX } from 'react/jsx-runtime';
import PlanTermBox, { PlanTermLockNote } from '../PlanTermBox';
import { formatAgentIdLabel } from '../../../utils/agentLabel';
import { previewUnitPrice, fmtPrice, toSupplyInputs } from '../../../utils/unitPrice';
import { formatDateTime } from '../../../utils/formatDate';
import BillingRecipientsEditor from '../../BillingRecipientsEditor';
import type { BillingRecipient } from '../../BillingRecipientsEditor';
import { taxbillIssueDatePreviewText, type TaxbillDayPolicy } from '../../../utils/taxbillDate';
import { unitPriceApi } from '../../../api/client';
import type { Plan } from '../admin-types';
import type { ModalState } from '../admin-types';
import CompanyBasicTab from './tabs/CompanyBasicTab'; // ★ 2026-10-09 분리 E
import CompanySendPolicyTab from './tabs/CompanySendPolicyTab'; // ★ 2026-10-09 분리 E
import CompanyCostTab from './tabs/CompanyCostTab'; // ★ 2026-10-09 분리 E
import CompanyCreditTab from './tabs/CompanyCreditTab'; // ★ 2026-10-09 분리 E
import CompanyStoreCodeTab from './tabs/CompanyStoreCodeTab'; // ★ 2026-10-09 분리 E
import CompanyBillingTab from './tabs/CompanyBillingTab'; // ★ 2026-10-09 분리 E
import CompanyDashboardCardsTab from './tabs/CompanyDashboardCardsTab'; // ★ 2026-10-09 분리 E
import CompanyCustomerDbTab from './tabs/CompanyCustomerDbTab'; // ★ 2026-10-09 분리 E
import CompanySyncTab from './tabs/CompanySyncTab'; // ★ 2026-10-09 분리 E

export interface CompanyDetailModalProps {
  adminCustPage: { total: number; page: number; totalPages: number; };
  agencyEmailActiveCount: number | null;
  agentIdSaving: boolean;
  agentIds: { id: string; agent_send_id: string; memo: string | null; cust_name?: string | null; billing_type?: string | null; cost_per_sms?: string | number | null; cost_per_lms?: string | number | null; cost_per_mms?: string | number | null; cost_per_kakao?: string | number | null; cost_per_brand?: string | number | null; }[];
  agentLedgerSaving: boolean;
  applyUnitPriceToAgents: boolean;
  balanceTxList: any[];
  balanceTxLoading: boolean;
  btAccounts: any[];
  btBizDraft: any;
  btBizExtracting: boolean;
  btBizTarget: string | null;
  btCompanyContact: { name: string; email: string; } & Partial<{ taxbill_biz_number: string; taxbill_company_name: string; taxbill_ceo_name: string; taxbill_address: string; taxbill_biz_type: string; taxbill_biz_item: string; }>;
  btLoading: boolean;
  btRecipients: BillingRecipient[];
  btSaving: boolean;
  btSettings: { issue_scope: string; taxbill_day_policy: string; manual_billing: boolean; require_taxbill_remark: boolean; };
  companyCredit: any;
  creditAdj: { type: string; amount: string; reason: string; busy: boolean; };
  dashboardCardIds: string[];
  dashboardCardPool: { cardId: string; label: string; emoji: string; description: string; }[];
  draggedCardIdx: number | null;
  editAgentLedger: { billingType: string; costPerSms: string; costPerLms: string; costPerMms: string; costPerKakao: string; costPerBrand: string; memo: string; };
  editCompany: { id: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; status: string; planId: string; rejectNumber: string; businessNumber: string; ceoName: string; businessType: string; businessItem: string; industryCode: string; address: string; sendHourStart: number; sendHourEnd: number; dailyLimit: number; duplicateDays: number; costPerSms: string | number; costPerLms: string | number; costPerMms: string | number; costPerKakao: string | number; costPerBrand: string | number; costPerBrandNonfriend: string | number; costPerTestSms: string | number; costPerTestLms: string | number; unitPriceBasis: 'vat_included' | 'vat_excluded'; billingType: string; balance: number; balanceAdjustType: 'charge' | 'deduct'; balanceAdjustAmount: string; balanceAdjustReason: string; balanceAdjusting: boolean; targetStrategy: string; crossCategoryAllowed: boolean; excludedSegments: string[]; approvalRequired: boolean; allowCallbackSelfRegister: boolean; maxUsers: number; sessionTimeoutMinutes: number; storeCodeList: string[]; newStoreCode: string; newExcludedSegment: string; lineGroupId: string; kakaoEnabled: boolean; userIsolationEnabled: boolean; usageType: string; useAiOrchestrator: boolean; cdpAutoExecuteEnabled: boolean; cdpAutoExecuteMaxRecipients: number; cdpAutoExecuteMaxCostKrw: number; cdpAutoExecuteMaxRisk: string; agencySendEnabled: boolean; subscriptionStatus: string; trialExpiresAt: string | null | ''; planCode: string; aiOperatorTrialStartedAt: string | null | ''; aiOperatorTrialUntil: string | null | ''; };
  editCompanyTab: 'basic' | 'send' | 'cost' | 'ai' | 'store' | 'billing' | 'cards' | 'customers' | 'sync';
  editingAgentRowId: string | null;
  getStatusBadge: (status: string) => JSX.Element;
  enabledFields: string[];
  industryOptions: { code: string; label: string; }[];
  labOpen: boolean;
  lineGroups: any[];
  linePolicy: { subscriberType: string | null; mobileLineLimit: number | null; landlineLineLimit: number | null; effective: { mobile: number | null; landline: number | null; source: string; }; held: { mobile: number; landline: number; }; perAccount?: { activeAccounts: number; perAccount: number; } | null; } | null;
  linePolicySaving: boolean;
  loadAdminCustomers: (page?: number) => Promise<void>;
  loadAgentIds: (companyId: string) => Promise<void>;
  loadData: () => Promise<void>;
  newAgentMemo: string;
  newAgentSendId: string;
  plans: Plan[];
  savingUnitPrices: boolean;
  setAdminCustSearch: Dispatch<SetStateAction<string>>;
  setAgencyEmailModalOpen: Dispatch<SetStateAction<boolean>>;
  setAgentIdSaving: Dispatch<SetStateAction<boolean>>;
  setAgentLedgerSaving: Dispatch<SetStateAction<boolean>>;
  setApplyUnitPriceToAgents: Dispatch<SetStateAction<boolean>>;
  setBalanceTxList: Dispatch<SetStateAction<any[]>>;
  setBalanceTxLoading: Dispatch<SetStateAction<boolean>>;
  setBillingToast: Dispatch<SetStateAction<{ msg: string; type: 'success' | 'error'; } | null>>;
  setBtAccounts: Dispatch<SetStateAction<any[]>>;
  setBtBizDraft: Dispatch<any>;
  setBtBizExtracting: Dispatch<SetStateAction<boolean>>;
  setBtBizTarget: Dispatch<SetStateAction<string | null>>;
  setBtCompanyContact: Dispatch<SetStateAction<{ name: string; email: string; } & Partial<{ taxbill_biz_number: string; taxbill_company_name: string; taxbill_ceo_name: string; taxbill_address: string; taxbill_biz_type: string; taxbill_biz_item: string; }>>>;
  setBtLoading: Dispatch<SetStateAction<boolean>>;
  setBtRecipients: Dispatch<SetStateAction<BillingRecipient[]>>;
  setBtSaving: Dispatch<SetStateAction<boolean>>;
  setBtSettings: Dispatch<SetStateAction<{ issue_scope: string; taxbill_day_policy: string; manual_billing: boolean; require_taxbill_remark: boolean; }>>;
  setCompanyCredit: Dispatch<any>;
  setCreditAdj: Dispatch<SetStateAction<{ type: string; amount: string; reason: string; busy: boolean; }>>;
  setCustomerDeleteConfirmName: Dispatch<SetStateAction<string>>;
  setDashboardCardIds: Dispatch<SetStateAction<string[]>>;
  setDraggedCardIdx: Dispatch<SetStateAction<number | null>>;
  setEditAgentLedger: Dispatch<SetStateAction<{ billingType: string; costPerSms: string; costPerLms: string; costPerMms: string; costPerKakao: string; costPerBrand: string; memo: string; }>>;
  setEditCompany: Dispatch<SetStateAction<{ id: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; status: string; planId: string; rejectNumber: string; businessNumber: string; ceoName: string; businessType: string; businessItem: string; industryCode: string; address: string; sendHourStart: number; sendHourEnd: number; dailyLimit: number; duplicateDays: number; costPerSms: string | number; costPerLms: string | number; costPerMms: string | number; costPerKakao: string | number; costPerBrand: string | number; costPerBrandNonfriend: string | number; costPerTestSms: string | number; costPerTestLms: string | number; unitPriceBasis: 'vat_included' | 'vat_excluded'; billingType: string; balance: number; balanceAdjustType: 'charge' | 'deduct'; balanceAdjustAmount: string; balanceAdjustReason: string; balanceAdjusting: boolean; targetStrategy: string; crossCategoryAllowed: boolean; excludedSegments: string[]; approvalRequired: boolean; allowCallbackSelfRegister: boolean; maxUsers: number; sessionTimeoutMinutes: number; storeCodeList: string[]; newStoreCode: string; newExcludedSegment: string; lineGroupId: string; kakaoEnabled: boolean; userIsolationEnabled: boolean; usageType: string; useAiOrchestrator: boolean; cdpAutoExecuteEnabled: boolean; cdpAutoExecuteMaxRecipients: number; cdpAutoExecuteMaxCostKrw: number; cdpAutoExecuteMaxRisk: string; agencySendEnabled: boolean; subscriptionStatus: string; trialExpiresAt: string | null | ''; planCode: string; aiOperatorTrialStartedAt: string | null | ''; aiOperatorTrialUntil: string | null | ''; }>>;
  setEditCompanyTab: Dispatch<SetStateAction<'basic' | 'send' | 'cost' | 'ai' | 'store' | 'billing' | 'cards' | 'customers' | 'sync'>>;
  setEditingAgentRowId: Dispatch<SetStateAction<string | null>>;
  setLabOpen: Dispatch<SetStateAction<boolean>>;
  setLinePolicy: Dispatch<SetStateAction<{ subscriberType: string | null; mobileLineLimit: number | null; landlineLineLimit: number | null; effective: { mobile: number | null; landline: number | null; source: string; }; held: { mobile: number; landline: number; }; perAccount?: { activeAccounts: number; perAccount: number; } | null; } | null>>;
  setLinePolicySaving: Dispatch<SetStateAction<boolean>>;
  setModal: Dispatch<SetStateAction<ModalState>>;
  setNewAgentMemo: Dispatch<SetStateAction<string>>;
  setNewAgentSendId: Dispatch<SetStateAction<string>>;
  setSavingUnitPrices: Dispatch<SetStateAction<boolean>>;
  setShowCustomerDeleteAll: Dispatch<SetStateAction<boolean>>;
  setShowEditCompanyModal: Dispatch<SetStateAction<boolean>>;
  setShowSyncRegenConfirm: Dispatch<SetStateAction<boolean>>;
  setSyncKeyVisible: Dispatch<SetStateAction<boolean>>;
  setSyncKeys: Dispatch<SetStateAction<{ api_key: string | null; api_secret?: string | null; has_secret?: boolean; use_db_sync: boolean; }>>;
  setSyncLoading: Dispatch<SetStateAction<boolean>>;
  setSyncSecretVisible: Dispatch<SetStateAction<boolean>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
  showSyncRegenConfirm: boolean;
  syncKeyVisible: boolean;
  syncKeys: { api_key: string | null; api_secret?: string | null; has_secret?: boolean; use_db_sync: boolean; };
  syncLoading: boolean;
  syncSecretVisible: boolean;
}

export default function CompanyDetailModal(props: CompanyDetailModalProps) {
  const { adminCustPage, agencyEmailActiveCount, agentIdSaving, agentIds, agentLedgerSaving, applyUnitPriceToAgents, balanceTxList, balanceTxLoading, btAccounts, btBizDraft, btBizExtracting, btBizTarget, btCompanyContact, btLoading, btRecipients, btSaving, btSettings, companyCredit, creditAdj, dashboardCardIds, dashboardCardPool, draggedCardIdx, editAgentLedger, editCompany, editCompanyTab, editingAgentRowId, enabledFields, getStatusBadge, industryOptions, labOpen, lineGroups, linePolicy, linePolicySaving, loadAdminCustomers, loadAgentIds, loadData, newAgentMemo, newAgentSendId, plans, savingUnitPrices, setAdminCustSearch, setAgencyEmailModalOpen, setAgentIdSaving, setAgentLedgerSaving, setApplyUnitPriceToAgents, setBalanceTxList, setBalanceTxLoading, setBillingToast, setBtAccounts, setBtBizDraft, setBtBizExtracting, setBtBizTarget, setBtCompanyContact, setBtLoading, setBtRecipients, setBtSaving, setBtSettings, setCompanyCredit, setCreditAdj, setCustomerDeleteConfirmName, setDashboardCardIds, setDraggedCardIdx, setEditAgentLedger, setEditCompany, setEditCompanyTab, setEditingAgentRowId, setLabOpen, setLinePolicy, setLinePolicySaving, setModal, setNewAgentMemo, setNewAgentSendId, setSavingUnitPrices, setShowCustomerDeleteAll, setShowEditCompanyModal, setShowSyncRegenConfirm, setSyncKeyVisible, setSyncKeys, setSyncLoading, setSyncSecretVisible, showAlert, showConfirm, showSyncRegenConfirm, syncKeyVisible, syncKeys, syncLoading, syncSecretVisible } = props;

// 잔액 변동 이력 조회 (고객사 상세)
const loadBalanceTx = async (companyId: string) => {
  setBalanceTxLoading(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/companies/${companyId}/balance-transactions?page=1&limit=10`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    setBalanceTxList(data.transactions || []);
  } catch (e) { console.error('잔액 이력 조회 실패:', e); }
  finally { setBalanceTxLoading(false); }
};

// SyncAgent 키 로드
const loadSyncKeys = async (companyId: string) => {
  setSyncLoading(true);
  try {
    const res = await fetch(`/api/admin/companies/${companyId}/sync-keys`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    if (res.ok) {
      const data = await res.json();
      setSyncKeys(data.syncKeys);
    }
  } catch (error) {
    console.error('SyncAgent 키 로드 실패:', error);
  } finally {
    setSyncLoading(false);
    setSyncKeyVisible(false);
    setSyncSecretVisible(false);
  }
};

  const loadBillingTab = async (companyId: string) => {
    if (!companyId) return;
    setBtLoading(true);
    try {
      const token = localStorage.getItem('token');
      const [sRes, uRes] = await Promise.all([
        fetch(`/api/admin/billing/company-billing-settings/${companyId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/admin/billing/company-users/${companyId}`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const sData = await sRes.json();
      const uData = await uRes.json();
      if (!sRes.ok) throw new Error(sData?.error || '정산 설정 조회 실패');
      const contacts: any[] = Array.isArray(sData.contacts) ? sData.contacts : [];
      setBtRecipients(Array.isArray(sData.recipients) ? sData.recipients : []);
      const companyC = contacts.find((c: any) => !c.user_id);
      setBtSettings({
        issue_scope: sData?.settings?.issueScope || 'combined',
        taxbill_day_policy: sData?.settings?.taxbillDayPolicy || 'last_day',
        require_taxbill_remark: sData?.settings?.requireTaxbillRemark === true,
        manual_billing: sData?.settings?.manualBilling === true,
      });
      setBtCompanyContact({
        name: companyC?.contact_name || '', email: companyC?.contact_email || '',
        taxbill_biz_number: companyC?.taxbill_biz_number || '', taxbill_company_name: companyC?.taxbill_company_name || '',
        taxbill_ceo_name: companyC?.taxbill_ceo_name || '', taxbill_address: companyC?.taxbill_address || '',
        taxbill_biz_type: companyC?.taxbill_biz_type || '', taxbill_biz_item: companyC?.taxbill_biz_item || '',
      });
      const users: any[] = Array.isArray(uData) ? uData : [];
      setBtAccounts(users.map((u: any) => {
        const c: any = contacts.find((x: any) => String(x.user_id) === String(u.id)) || {};
        return {
          user_id: u.id, name: u.name, login_id: u.login_id,
          contact_name: c.contact_name || '', contact_email: c.contact_email || '',
          taxbill_biz_number: c.taxbill_biz_number || '', taxbill_company_name: c.taxbill_company_name || '',
          taxbill_ceo_name: c.taxbill_ceo_name || '', taxbill_address: c.taxbill_address || '',
          taxbill_biz_type: c.taxbill_biz_type || '', taxbill_biz_item: c.taxbill_biz_item || '',
        };
      }));
    } catch (e: any) {
      showAlert('오류', e?.message || '정산 설정을 불러오지 못했습니다.', 'error');
    } finally {
      setBtLoading(false);
    }
  };

  const handleUpdateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const [res, fieldsRes, cardsRes] = await Promise.all([
        fetch(`/api/admin/companies/${editCompany.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(editCompany)
        }),
        fetch(`/api/admin/companies/${editCompany.id}/fields`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ enabledFields })
        }),
        fetch(`/api/admin/companies/${editCompany.id}/dashboard-cards`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ cards: dashboardCardIds, cardCount: dashboardCardIds.length })
        })
      ]);
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '수정 실패');
      }
      
      setShowEditCompanyModal(false);
      loadData();
      showAlert('성공', '고객사 정보가 수정되었습니다.', 'success');
    } catch (error: any) {
      showAlert('오류', error.message || '수정 실패', 'error');
    }
  };
  return (
    <>
    {(
        // ★ 2026-10-09 슈퍼관리자 다듬기(목업 v2) — 머리 = 이름 · 알약 / 탭 = 글자만(이모지 걷음) / 아래 줄 = 닫기 · 저장 고정
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 md:p-6 z-50">
          <div className={`bg-white rounded-[14px] shadow-[0_24px_60px_rgba(17,24,39,0.25)] w-full ${editCompanyTab === 'basic' ? 'max-w-[960px]' : editCompanyTab === 'customers' || editCompanyTab === 'cards' ? 'max-w-4xl' : 'max-w-2xl'} max-h-[90vh] flex flex-col overflow-hidden transition-all`}>
            <div className="px-5 md:px-[22px] pt-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-gray-900">고객사 상세 설정</h3>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{editCompany.companyName}</p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {companyPlanState({ plan_code: editCompany.planCode, subscription_status: editCompany.subscriptionStatus, trial_expires_at: editCompany.trialExpiresAt }) === 'trial' && (
                    <AdminPill tone="blue">무료체험{trialDaysLeft(editCompany.trialExpiresAt) !== null ? ` D-${trialDaysLeft(editCompany.trialExpiresAt)}` : ''}</AdminPill>
                  )}
                  {editCompany.usageType === 'agent' ? <AdminPill tone="amber">에이전트</AdminPill>
                    : editCompany.usageType === 'both' ? <AdminPill tone="violet">웹+에이전트</AdminPill>
                      : <AdminPill tone="blue">웹</AdminPill>}
                  {getStatusBadge(editCompany.status)}
                </div>
              </div>
              <button type="button" onClick={() => setShowEditCompanyModal(false)} aria-label="닫기"
                className="whitespace-nowrap w-[30px] h-[30px] shrink-0 rounded-lg text-lg leading-none text-gray-500 hover:bg-gray-100">×</button>
            </div>

            {/* 탭 네비게이션 */}
            <div className="flex flex-shrink-0 gap-0.5 px-[18px] pt-2.5 border-b border-gray-200 overflow-x-auto">
              {[
                { key: 'basic', label: '기본정보' },
                { key: 'send', label: '발송정책' },
                { key: 'cost', label: '단가/요금' },
                { key: 'ai', label: '크레딧' },
                { key: 'store', label: '분류코드' },
                { key: 'billing', label: '정산' },
                { key: 'cards', label: '대시보드' },
                { key: 'customers', label: '고객DB' },
                { key: 'sync', label: 'Sync' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setEditCompanyTab(tab.key as any);
                    if (tab.key === 'customers') { setAdminCustSearch(''); loadAdminCustomers(1); }
                    if (tab.key === 'cost' && editCompany?.billingType === 'prepaid') { loadBalanceTx(editCompany.id); }
                    if (tab.key === 'sync') { loadSyncKeys(editCompany.id); }
                    if (tab.key === 'billing') { loadBillingTab(editCompany.id); }
                  }}
                  className={`h-[34px] px-3 text-[13px] whitespace-nowrap border-b-2 -mb-px transition-colors ${
                    editCompanyTab === tab.key
                      ? 'border-emerald-600 text-emerald-700 font-semibold'
                      : 'border-transparent text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleUpdateCompany} className="flex-1 min-h-0 flex flex-col">
              <div className={`flex-1 overflow-y-auto px-5 md:px-[22px] py-4 ${editCompanyTab === 'basic' ? 'bg-[#fafbfc]' : 'bg-white'}`}>
              {/* 기본정보 탭 */}
              {editCompanyTab === 'basic' && <CompanyBasicTab {...{ agencyEmailActiveCount, agentIdSaving, agentIds, agentLedgerSaving, editAgentLedger, editCompany, editingAgentRowId, industryOptions, labOpen, lineGroups, linePolicy, linePolicySaving, loadAgentIds, loadData, newAgentMemo, newAgentSendId, plans, setAgencyEmailModalOpen, setAgentIdSaving, setAgentLedgerSaving, setEditAgentLedger, setEditCompany, setEditingAgentRowId, setLabOpen, setLinePolicy, setLinePolicySaving, setNewAgentMemo, setNewAgentSendId, showAlert, showConfirm }} />}

              {/* 발송정책 탭 */}
              {editCompanyTab === 'send' && <CompanySendPolicyTab {...{ editCompany, setEditCompany }} />}

              {/* 단가/요금 탭 */}
              {editCompanyTab === 'cost' && <CompanyCostTab {...{ applyUnitPriceToAgents, balanceTxList, balanceTxLoading, editCompany, loadBalanceTx, loadData, savingUnitPrices, setApplyUnitPriceToAgents, setBillingToast, setEditCompany, setModal, setSavingUnitPrices }} />}

              {/* 크레딧 탭 (AI설정 → 종량제 크레딧 관리 전환) */}
              {editCompanyTab === 'ai' && <CompanyCreditTab {...{ companyCredit, creditAdj, editCompany, setCompanyCredit, setCreditAdj, setEditCompany, setModal }} />}

              {/* 분류코드 탭 */}
              {editCompanyTab === 'store' && <CompanyStoreCodeTab {...{ editCompany, setEditCompany }} />}

              {/* ★ 2026-07-28 정산 탭 (필터항목 대체 — Harold 판정: 의미 없는 메뉴) — SoT §2 */}
              {editCompanyTab === 'billing' && <CompanyBillingTab {...{ btAccounts, btBizDraft, btBizExtracting, btBizTarget, btCompanyContact, btLoading, btRecipients, btSaving, btSettings, editCompany, setBtAccounts, setBtBizDraft, setBtBizExtracting, setBtBizTarget, setBtCompanyContact, setBtRecipients, setBtSaving, setBtSettings, showAlert }} />}

              {/* D41 대시보드 카드 설정 탭 */}
              {/* ★ D142+ (2026-04-29) 카드 순서 변경 기능 추가:
               *   기존: 체크박스로 선택만 가능. 새 카드 체크 시 항상 배열 끝에 추가 → 순서 조작 불가.
               *   변경: 두 영역 분리 (선택된 카드 / 추가 가능 카드)
               *         - 선택된 카드: 드래그(HTML5 native) + ↑↓ 버튼 + × 제거. 표시 순서 = 배열 순서.
               *         - 추가 가능 카드: 체크박스(추가 시 끝에 append). 미선택 카드만 표시.
               *   백엔드 변경 0건 — `company_settings.dashboard_cards` JSON 배열 순서 그대로 저장.
               */}
              {editCompanyTab === 'cards' && <CompanyDashboardCardsTab {...{ dashboardCardIds, dashboardCardPool, draggedCardIdx, setDashboardCardIds, setDraggedCardIdx }} />}

              {/* 고객DB 탭 — D144 P10 (2026-05-07 정정):
                   Harold님 의도: 고객 DB 정보 출력은 제거 + 전체 삭제 기능만 유지.
                   개별/선택 삭제 + 검색/테이블/페이지네이션 제거. 전체 삭제 모달은 그대로 사용. */}
              {editCompanyTab === 'customers' && <CompanyCustomerDbTab {...{ adminCustPage, setCustomerDeleteConfirmName, setShowCustomerDeleteAll, setShowEditCompanyModal }} />}

              {/* SyncAgent 탭 */}
              {editCompanyTab === 'sync' && <CompanySyncTab {...{ editCompany, setShowEditCompanyModal, setShowSyncRegenConfirm, setSyncKeyVisible, setSyncKeys, setSyncLoading, setSyncSecretVisible, showAlert, showSyncRegenConfirm, syncKeyVisible, syncKeys, syncLoading, syncSecretVisible }} />}

              </div>

              {editCompanyTab !== 'customers' && editCompanyTab !== 'sync' && (
              <div className="shrink-0 px-5 md:px-[22px] py-3 border-t border-gray-200 bg-white flex items-center justify-end gap-1.5">
                <button type="button" onClick={() => setShowEditCompanyModal(false)} className={ADMIN_BTN}>
                  취소
                </button>
                <button type="submit" className={`whitespace-nowrap ${ADMIN_BTN_PRIMARY} min-w-[72px]`}>
                  저장
                </button>
              </div>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
