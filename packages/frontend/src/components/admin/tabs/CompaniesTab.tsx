/**
 * CompaniesTab — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 * ★ 2026-10-09 다듬기(Harold 목업 v2 승인) — 요금 구분 · 사용 구분 거르기와 숫자 카드 4를 더했다. 수정 · 해지 · 검색 · 상태 동작은 그대로.
 */
import type { Dispatch, SetStateAction } from 'react';
import type { JSX } from 'react/jsx-runtime';
import { formatDate } from '../../../utils/formatDate';
import TablePagination from '../../common/TablePagination';
import { type Company } from '../admin-types';
import { toSupplyInputs } from '../../../utils/unitPrice';
import { companyPlanState, trialDaysLeft, type CompanyPlanState } from '../../../utils/planLabel';
import {
  AdminPanel, AdminFilterBar, AdminFilterLabel, AdminSegmented, AdminStatGrid, AdminStat, AdminPill, AdminTableEmpty, AdminSource,
  ADMIN_TABLE, ADMIN_THEAD, ADMIN_TH, ADMIN_TH_FIRST, ADMIN_TBODY, ADMIN_TR, ADMIN_TD, ADMIN_TD_FIRST, ADMIN_NUM,
  ADMIN_BTN_PRIMARY, ADMIN_BTN_SM, ADMIN_BTN_SM_DANGER, ADMIN_INPUT,
} from '../ui/admin-ui';

type PlanFilter = 'all' | CompanyPlanState;
type UsageFilter = 'all' | 'web' | 'agent' | 'both';

export interface CompaniesTabProps {
  closeModal: () => void;
  companies: Company[];
  companyPage: number;
  companyPlanFilter: PlanFilter;
  companySearch: string;
  companyStatusFilter: string;
  companyUsageFilter: UsageFilter;
  getStatusBadge: (status: string) => JSX.Element;
  industryOptions: { code: string; label: string; }[];
  loadAgentIds: (companyId: string) => Promise<void>;
  loadData: () => Promise<void>;
  loadUsers: () => Promise<void>;
  setCompanyPage: Dispatch<SetStateAction<number>>;
  setCompanyPlanFilter: Dispatch<SetStateAction<PlanFilter>>;
  setCompanySearch: Dispatch<SetStateAction<string>>;
  setCompanyStatusFilter: Dispatch<SetStateAction<string>>;
  setCompanyUsageFilter: Dispatch<SetStateAction<UsageFilter>>;
  setDashboardCardCount: Dispatch<SetStateAction<number>>;
  setDashboardCardIds: Dispatch<SetStateAction<string[]>>;
  setDashboardCardPool: Dispatch<SetStateAction<{ cardId: string; label: string; emoji: string; description: string; }[]>>;
  setEditCompany: Dispatch<SetStateAction<{ id: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; status: string; planId: string; rejectNumber: string; businessNumber: string; ceoName: string; businessType: string; businessItem: string; industryCode: string; address: string; sendHourStart: number; sendHourEnd: number; dailyLimit: number; duplicateDays: number; costPerSms: string | number; costPerLms: string | number; costPerMms: string | number; costPerKakao: string | number; costPerBrand: string | number; costPerBrandNonfriend: string | number; costPerTestSms: string | number; costPerTestLms: string | number; unitPriceBasis: 'vat_included' | 'vat_excluded'; billingType: string; balance: number; balanceAdjustType: 'charge' | 'deduct'; balanceAdjustAmount: string; balanceAdjustReason: string; balanceAdjusting: boolean; targetStrategy: string; crossCategoryAllowed: boolean; excludedSegments: string[]; approvalRequired: boolean; allowCallbackSelfRegister: boolean; maxUsers: number; sessionTimeoutMinutes: number; storeCodeList: string[]; newStoreCode: string; newExcludedSegment: string; lineGroupId: string; kakaoEnabled: boolean; userIsolationEnabled: boolean; usageType: string; useAiOrchestrator: boolean; cdpAutoExecuteEnabled: boolean; cdpAutoExecuteMaxRecipients: number; cdpAutoExecuteMaxCostKrw: number; cdpAutoExecuteMaxRisk: string; agencySendEnabled: boolean; subscriptionStatus: string; trialExpiresAt: string | null | ''; planCode: string; aiOperatorTrialStartedAt: string | null | ''; aiOperatorTrialUntil: string | null | ''; }>>;
  setEditCompanyTab: Dispatch<SetStateAction<'basic' | 'send' | 'cost' | 'ai' | 'store' | 'billing' | 'cards' | 'customers' | 'sync'>>;
  setFieldDataCheck: Dispatch<SetStateAction<Record<string, { hasData: boolean; count: number; }>>>;
  setIndustryOptions: Dispatch<SetStateAction<{ code: string; label: string; }[]>>;
  setLinePolicy: Dispatch<SetStateAction<{ subscriberType: string | null; mobileLineLimit: number | null; landlineLineLimit: number | null; effective: { mobile: number | null; landline: number | null; source: string; }; held: { mobile: number; landline: number; }; perAccount?: { activeAccounts: number; perAccount: number; } | null; } | null>>;
  setNewAgentMemo: Dispatch<SetStateAction<string>>;
  setNewAgentSendId: Dispatch<SetStateAction<string>>;
  setShowCompanyModal: Dispatch<SetStateAction<boolean>>;
  setShowEditCompanyModal: Dispatch<SetStateAction<boolean>>;
  setStandardFields: Dispatch<SetStateAction<any[]>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export default function CompaniesTab(props: CompaniesTabProps) {
  const { closeModal, companies, companyPage, companyPlanFilter, companySearch, companyStatusFilter, companyUsageFilter, getStatusBadge, industryOptions, loadAgentIds, loadData, loadUsers, setCompanyPage, setCompanyPlanFilter, setCompanySearch, setCompanyStatusFilter, setCompanyUsageFilter, setDashboardCardCount, setDashboardCardIds, setDashboardCardPool, setEditCompany, setEditCompanyTab, setFieldDataCheck, setIndustryOptions, setLinePolicy, setNewAgentMemo, setNewAgentSendId, setShowCompanyModal, setShowEditCompanyModal, setStandardFields, showAlert, showConfirm } = props;
  const companyPerPage = 10;

  const handleDeactivateCompany = (company: Company) => {
    showConfirm(
      '고객사 해지',
      `${company.company_name}을(를) 해지하시겠습니까?\n해당 회사의 모든 사용자도 비활성화됩니다.`,
      async () => {
        closeModal();
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/companies/${company.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || '해지 실패');
          }
          
          loadData();
          loadUsers();
          showAlert('성공', '고객사가 해지되었습니다.', 'success');
        } catch (error: any) {
          showAlert('오류', error.message || '해지 실패', 'error');
        }
      }
    );
  };

  const handleEditCompany = async (company: Company) => {
    try {
      const token = localStorage.getItem('token');
      // ★ 2026-08-18 발신번호 회선 정책 — 현재 상한과 보유 수를 함께 읽는다(판정과 같은 수를 본다)
      setLinePolicy(null);
      fetch(`/api/admin/companies/${company.id}/sender-line-policy`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (j) setLinePolicy(j); })
        .catch(() => {});
      // ★ 2026-07-21 문안 참조 업종 목록 — 정적 SSOT라 최초 1회만 로드(회사와 무관)
      if (industryOptions.length === 0) {
        fetch('/api/admin/industry-codes', { headers: { 'Authorization': `Bearer ${token}` } })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => { if (j?.industries) setIndustryOptions(j.industries); })
          .catch(() => {});
      }
      const [res, fieldsRes, enabledRes, dataCheckRes, cardsRes] = await Promise.all([
        fetch(`/api/admin/companies/${company.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/admin/standard-fields', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`/api/admin/companies/${company.id}/fields`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`/api/admin/companies/${company.id}/field-data-check`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`/api/admin/companies/${company.id}/dashboard-cards`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);
      if (res.ok) {
        const data = await res.json();
        const c = data.company;
        if (fieldsRes.ok) {
          const fData = await fieldsRes.json();
          setStandardFields(fData.fields || []);
        }
        if (dataCheckRes.ok) {
          const dcData = await dataCheckRes.json();
          setFieldDataCheck(dcData.dataCheck || {});
        }
        // D41 카드 설정 로드
        if (cardsRes.ok) {
          const cardsData = await cardsRes.json();
          setDashboardCardIds(cardsData.selectedCards || []);
          setDashboardCardCount(cardsData.selectedCards?.length || 0);
          // ★ D80: API 응답의 동적 필터링된 풀 사용 (고객사 DB 데이터 유무 기반)
          if (cardsData.pool && Array.isArray(cardsData.pool)) {
            setDashboardCardPool(cardsData.pool.map((c: any) => ({
              cardId: c.cardId,
              label: c.label,
              emoji: c.emoji || '📋',
              description: c.description,
            })));
          }
        } else {
          setDashboardCardIds([]);
          setDashboardCardCount(0);
          setDashboardCardPool([]);
        }
        setEditCompany({
          id: c.id,
          companyName: c.company_name || '',
          contactName: c.contact_name || '',
          contactEmail: c.contact_email || '',
          contactPhone: c.contact_phone || '',
          status: c.status || 'active',
          planId: c.plan_id || '',
          rejectNumber: c.reject_number || '',
          businessNumber: c.business_number || '',
          ceoName: c.ceo_name || '',
          businessType: c.business_type || '',
          businessItem: c.business_item || '',
          industryCode: c.industry_code || '',
          address: c.address || '',
          sendHourStart: c.send_start_hour ?? 9,
          sendHourEnd: c.send_end_hour ?? 21,
          dailyLimit: c.daily_limit_per_customer ?? 0,
          duplicateDays: c.duplicate_prevention_days ?? 7,
          // ★ 2026-07-26 미설정(NULL)을 기본단가로 위장하지 않는다 — 그대로 저장하면 계약과 다른 단가가 굳는다.
          //   ★ 전환 전(vat_included) 회사는 저장값이 **VAT 포함가**다. 그걸 "VAT 별도" 칸에 그대로 채우면
          //     수정 없이 저장만 해도 그 숫자가 공급가로 재해석돼 10% 과청구가 된다(Codex #1).
          //     그래서 공급가 상당액(÷1.1)으로 환산해 채운다 — 그대로 저장하면 지불액이 그대로 유지된다.
          ...toSupplyInputs(c),
          unitPriceBasis: c.unit_price_basis === 'vat_excluded' ? 'vat_excluded' : 'vat_included',
          billingType: c.billing_type || 'postpaid',
          balance: Number(c.balance) || 0,
          balanceAdjustType: 'charge' as 'charge' | 'deduct',
          balanceAdjustAmount: '',
          balanceAdjustReason: '',
          balanceAdjusting: false,
          targetStrategy: c.target_strategy || 'balanced',
          crossCategoryAllowed: c.cross_category_allowed ?? true,
          excludedSegments: c.excluded_segments || [],
          approvalRequired: c.approval_required ?? false,
          allowCallbackSelfRegister: c.allow_callback_self_register ?? false,
          maxUsers: c.max_users ?? 5,
          sessionTimeoutMinutes: c.session_timeout_minutes ?? 480,
          storeCodeList: c.store_code_list || [],
          newStoreCode: '',
          newExcludedSegment: '',
          lineGroupId: c.line_group_id || '',
          kakaoEnabled: c.kakao_enabled ?? false,
          userIsolationEnabled: c.user_isolation_enabled ?? false,  // ★ D162-3 수신거부 사용자격리
          usageType: c.usage_type || 'web',  // ★ 2026-07-03 사용구분
          useAiOrchestrator: c.use_ai_orchestrator ?? false,  // ★ D190 #2 AI Orchestrator
          cdpAutoExecuteEnabled: c.cdp_auto_execute_enabled ?? false,  // ★ 2026-06-06 자동마케팅 자율발송 게이트
          cdpAutoExecuteMaxRecipients: c.cdp_auto_execute_max_recipients ?? 1000,
          cdpAutoExecuteMaxCostKrw: c.cdp_auto_execute_max_cost_krw ?? 50000,
          cdpAutoExecuteMaxRisk: c.cdp_auto_execute_max_risk ?? 'low',
          agencySendEnabled: c.agency_send_enabled ?? false,  // ★ 2026-08-22 대행발송 스위치
          subscriptionStatus: c.subscription_status || 'trial',
          // ★ CT-17
          trialExpiresAt: c.trial_expires_at || '',
          planCode: c.plan_code || '',
          // ★ D219+ Part 2: AI 오퍼레이션 무료체험 컬럼 (DB ALTER 미실행 회사 = '' 정합)
          aiOperatorTrialStartedAt: c.ai_operator_trial_started_at || '',
          aiOperatorTrialUntil: c.ai_operator_trial_until || '',
        });
        setEditCompanyTab('basic');
        // ★ 2026-07-03 에이전트 발송ID 매핑 로드 (사용구분 관리)
        setNewAgentSendId('');
        setNewAgentMemo('');
        loadAgentIds(c.id);
        setShowEditCompanyModal(true);
      }
    } catch (error) {
      console.error('회사 정보 로드 실패:', error);
    }
  };

  // 필터링된 회사 목록 — D144 P9: 회사명 오름차순 정렬로 안정화 (수정 후 페이지 흔들림 방지)
  // ★ 2026-10-09 목업 v2 — 요금 구분(planLabel companyPlanState) · 사용구분 거르기 추가. 검색 · 상태 판정은 그대로.
  const filteredCompanies = companies.filter((company) => {
    const matchesSearch = companySearch === '' ||
      company.company_code.toLowerCase().includes(companySearch.toLowerCase()) ||
      company.company_name.toLowerCase().includes(companySearch.toLowerCase()) ||
      (company.contact_name && company.contact_name.toLowerCase().includes(companySearch.toLowerCase()));

    const matchesStatus = companyStatusFilter === 'all' || company.status === companyStatusFilter;
    const matchesPlan = companyPlanFilter === 'all' || companyPlanState(company) === companyPlanFilter;
    const matchesUsage = companyUsageFilter === 'all' || (company.usage_type || 'web') === companyUsageFilter;

    return matchesSearch && matchesStatus && matchesPlan && matchesUsage;
  }).sort((a, b) => (a.company_name || '').localeCompare(b.company_name || '', 'ko'));

  // 숫자 카드 = 불러온 전체 고객사 기준(거르기와 무관) — 표 위 「고객사 N곳」만 거른 수다
  const planOf = companies.map((c) => ({ c, state: companyPlanState(c) }));
  const paid = planOf.filter((x) => x.state === 'paid');
  const paidByPlan = Object.entries(
    paid.reduce<Record<string, number>>((acc, { c }) => { const k = c.plan_name || '이름 없음'; acc[k] = (acc[k] || 0) + 1; return acc; }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const trials = planOf.filter((x) => x.state === 'trial');
  const trialsEndingSoon = trials.filter(({ c }) => { const d = trialDaysLeft(c.trial_expires_at); return d !== null && d <= 7; }).length;
  const agentOnly = companies.filter((c) => c.usage_type === 'agent').length;
  const agentBoth = companies.filter((c) => c.usage_type === 'both').length;
  const internalCount = planOf.filter((x) => x.state === 'internal').length;
  const now = new Date();
  const newThisMonth = companies.filter((c) => {
    const d = new Date(c.created_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;

  const resetPage = () => setCompanyPage(1);

  const planCell = (company: Company) => {
    const state = companyPlanState(company);
    if (state === 'trial') {
      const d = trialDaysLeft(company.trial_expires_at);
      return <AdminPill tone="blue">{d === null ? '무료체험' : `무료체험 D-${d}`}</AdminPill>;
    }
    if (state === 'none') return <AdminPill tone="gray">{company.plan_name || '미가입'}</AdminPill>;
    if (state === 'internal') return <AdminPill tone="violet">{company.plan_name || '임직원'}</AdminPill>;
    return <AdminPill tone="green">{company.plan_name}</AdminPill>;
  };

  const usageCell = (company: Company) =>
    company.usage_type === 'agent' ? <AdminPill tone="amber">에이전트</AdminPill>
      : company.usage_type === 'both' ? <AdminPill tone="violet">웹+에이전트</AdminPill>
        : <AdminPill tone="blue">웹</AdminPill>;

  return (
    <AdminPanel
      title="고객사 관리"
      description="고객사 계약 · 요금제 · 상태를 봅니다. 「수정」에서 상세 설정을 바꿉니다"
      actions={<button type="button" onClick={() => setShowCompanyModal(true)} className={ADMIN_BTN_PRIMARY}>+ 고객사 추가</button>}
    >
      <AdminStatGrid>
        <AdminStat label="유료 이용" value={paid.length} unit="곳" tone="emerald"
          sub={paidByPlan.length > 0 ? paidByPlan.map(([name, n]) => `${name} ${n}`).join(' · ') : '없음'} />
        <AdminStat label="무료체험 중" value={trials.length} unit="곳" tone="blue"
          sub={trialsEndingSoon > 0 ? `7일 안에 만료 ${trialsEndingSoon}곳` : '7일 안에 만료 없음'} />
        <AdminStat label="에이전트 연동" value={agentOnly + agentBoth} unit="곳" tone="violet"
          sub={`에이전트 ${agentOnly} · 웹+에이전트 ${agentBoth}`} />
        <AdminStat label="이번 달 새로 등록" value={newThisMonth} unit="곳" tone="amber"
          sub={`${now.getMonth() + 1}월 1일부터`} />
      </AdminStatGrid>

      <AdminFilterBar>
        <span className="inline-flex items-center gap-2">
          <AdminFilterLabel>상태</AdminFilterLabel>
          <AdminSegmented
            value={companyStatusFilter}
            options={[
              { key: 'all', label: '전체' }, { key: 'active', label: '활성' }, { key: 'trial', label: '체험' },
              { key: 'suspended', label: '정지' }, { key: 'terminated', label: '해지' },
            ]}
            onChange={(v) => { setCompanyStatusFilter(v); resetPage(); }}
          />
        </span>
        <span className="inline-flex items-center gap-2">
          <AdminFilterLabel>요금제</AdminFilterLabel>
          <AdminSegmented<PlanFilter>
            value={companyPlanFilter}
            options={[
              { key: 'all', label: '전체' }, { key: 'paid', label: '유료' }, { key: 'trial', label: '무료체험' }, { key: 'none', label: '미가입' },
              // 임직원 요금제 회사가 있을 때만 칸을 보인다(없는 칸을 상시 두지 않는다)
              ...(internalCount > 0 || companyPlanFilter === 'internal' ? [{ key: 'internal' as const, label: '임직원' }] : []),
            ]}
            onChange={(v) => { setCompanyPlanFilter(v); resetPage(); }}
          />
        </span>
        <span className="inline-flex items-center gap-2">
          <AdminFilterLabel>사용</AdminFilterLabel>
          <AdminSegmented<UsageFilter>
            value={companyUsageFilter}
            options={[{ key: 'all', label: '전체' }, { key: 'web', label: '웹' }, { key: 'agent', label: '에이전트' }, { key: 'both', label: '웹+에이전트' }]}
            onChange={(v) => { setCompanyUsageFilter(v); resetPage(); }}
          />
        </span>
        <span className="flex-1" />
        <input
          type="text"
          value={companySearch}
          onChange={(e) => { setCompanySearch(e.target.value); setCompanyPage(1); }}
          placeholder="회사코드 · 회사명 · 담당자 검색"
          className={`${ADMIN_INPUT} w-full sm:w-60`}
        />
      </AdminFilterBar>

      <div className="px-5 pt-3.5 pb-1.5 text-[13px] font-semibold text-gray-900">
        고객사 <span className="font-normal text-gray-400 tabular-nums">{filteredCompanies.length.toLocaleString()}곳{filteredCompanies.length !== companies.length ? ` / 전체 ${companies.length.toLocaleString()}곳` : ''}</span>
      </div>

      <div className="overflow-x-auto">
        <table className={ADMIN_TABLE}>
          <thead className={ADMIN_THEAD}>
            <tr>
              <th className={ADMIN_TH_FIRST}>코드</th>
              <th className={ADMIN_TH}>회사명</th>
              <th className={ADMIN_TH}>담당자</th>
              <th className={`whitespace-nowrap ${ADMIN_TH} text-center`}>사용</th>
              <th className={ADMIN_TH}>요금제</th>
              <th className={`whitespace-nowrap ${ADMIN_TH} text-center`}>상태</th>
              <th className={`whitespace-nowrap ${ADMIN_TH} text-right`}>고객 수</th>
              <th className={ADMIN_TH}>등록일</th>
              <th className={`whitespace-nowrap ${ADMIN_TH} text-right pr-5`}>관리</th>
            </tr>
          </thead>
          <tbody className={ADMIN_TBODY}>
            {filteredCompanies.length === 0 ? (
              <AdminTableEmpty colSpan={9}>
                {companies.length === 0 ? '등록된 고객사가 없습니다.' : '조건에 맞는 고객사가 없습니다.'}
              </AdminTableEmpty>
            ) : (
              filteredCompanies
                .slice((companyPage - 1) * companyPerPage, companyPage * companyPerPage)
                .map((company) => (
                  <tr key={company.id} className={ADMIN_TR}>
                    <td className={`${ADMIN_TD_FIRST} font-semibold text-gray-900`}>{company.company_code}</td>
                    <td className={`${ADMIN_TD} font-medium text-gray-900`}>{company.company_name}</td>
                    <td className={ADMIN_TD}>{company.contact_name || <span className="text-gray-300">-</span>}</td>
                    <td className={`${ADMIN_TD} text-center`}>{usageCell(company)}</td>
                    <td className={ADMIN_TD}>{planCell(company)}</td>
                    <td className={`${ADMIN_TD} text-center`}>{getStatusBadge(company.status)}</td>
                    <td className={`${ADMIN_TD} ${ADMIN_NUM}`}>{company.total_customers?.toLocaleString() || 0}</td>
                    <td className={`${ADMIN_TD} tabular-nums`}>{formatDate(company.created_at)}</td>
                    <td className={`${ADMIN_TD} text-right pr-5`}>
                      <span className="inline-flex gap-1">
                        <button type="button" onClick={() => handleEditCompany(company)} className={ADMIN_BTN_SM}>수정</button>
                        {company.status !== 'terminated' && (
                          <button type="button" onClick={() => handleDeactivateCompany(company)} className={ADMIN_BTN_SM_DANGER}>해지</button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>
      <TablePagination
        total={filteredCompanies.length}
        page={companyPage}
        perPage={companyPerPage}
        onChange={setCompanyPage}
        unit="곳"
        accent="emerald"
      />
      <AdminSource>Data source: companies · plans · customers(활성 고객 수) · 화면을 연 시점에 불러온 목록 기준</AdminSource>
    </AdminPanel>
  );
}
