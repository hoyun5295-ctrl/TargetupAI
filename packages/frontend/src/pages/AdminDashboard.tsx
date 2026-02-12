import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { companiesApi, plansApi, billingApi } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { formatDateTime, formatDate, formatDateTimeShort } from '../utils/formatDate';

interface Company {
  id: string;
  company_code: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  status: string;
  total_customers: number;
  plan_id: string;
  plan_name: string;
  reject_number: string;
  created_at: string;
}

interface Plan {
  id: string;
  plan_code: string;
  plan_name: string;
  max_customers: number;
  monthly_price: number;
}

interface User {
  id: string;
  login_id: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  user_type: string;
  status: string;
  company_id: string;
  company_name: string;
  last_login_at: string;
  created_at: string;
}

// 커스텀 모달 타입
interface ModalState {
  type: 'confirm' | 'alert' | 'password' | null;
  title: string;
  message: string;
  variant?: 'success' | 'error' | 'warning' | 'info';
  password?: string;
  smsSent?: boolean;
  phone?: string;
  onConfirm?: () => void;
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const [activeTab, setActiveTab] = useState<'companies' | 'users' | 'scheduled' | 'callbacks' | 'plans' | 'requests' | 'deposits' | 'allCampaigns' | 'stats' | 'billing' | 'syncAgents' | 'auditLogs'>('companies');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [showEditCompanyModal, setShowEditCompanyModal] = useState(false);
  const [editCompany, setEditCompany] = useState({
    id: '',
    companyName: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    status: 'active',
    planId: '',
    rejectNumber: '',
    businessNumber: '',
    ceoName: '',
    businessType: '',
    businessItem: '',
    address: '',
    sendHourStart: 9,
    sendHourEnd: 21,
    dailyLimit: 0,
    duplicateDays: 7,
    costPerSms: 9.9,
    costPerLms: 27,
    costPerMms: 50,
    costPerKakao: 7.5,
    billingType: 'postpaid',
    balance: 0,
    balanceAdjustType: 'charge' as 'charge' | 'deduct',
    balanceAdjustAmount: '',
    balanceAdjustReason: '',
    balanceAdjusting: false,
    targetStrategy: 'balanced',
    crossCategoryAllowed: true,
    excludedSegments: [] as string[],
    approvalRequired: false,
    allowCallbackSelfRegister: false,
    maxUsers: 5,
    sessionTimeoutMinutes: 30,
    storeCodeList: [] as string[],
    newStoreCode: '',
    newExcludedSegment: '',
  });
  const [editCompanyTab, setEditCompanyTab] = useState<'basic' | 'send' | 'cost' | 'ai' | 'store' | 'fields' | 'customers'>('basic');
  const [standardFields, setStandardFields] = useState<any[]>([]);
  const [enabledFields, setEnabledFields] = useState<string[]>([]);
  const [fieldDataCheck, setFieldDataCheck] = useState<Record<string, { hasData: boolean; count: number }>>({});
  // 전체 캠페인
const [allCampaigns, setAllCampaigns] = useState<any[]>([]);
const [allCampaignsTotal, setAllCampaignsTotal] = useState(0);
const [allCampaignsPage, setAllCampaignsPage] = useState(1);
const [allCampaignsSearch, setAllCampaignsSearch] = useState('');
const [allCampaignsStatus, setAllCampaignsStatus] = useState('');
const [allCampaignsCompany, setAllCampaignsCompany] = useState('');
// 발송 통계
const [sendStats, setSendStats] = useState<any>(null);
const [statsView, setStatsView] = useState<'daily' | 'monthly'>('daily');
const [statsStartDate, setStatsStartDate] = useState(() => new Date().toISOString().slice(0, 10));
const [statsEndDate, setStatsEndDate] = useState(() => new Date().toISOString().slice(0, 10));
const [statsCompanyFilter, setStatsCompanyFilter] = useState('');
const [statsPage, setStatsPage] = useState(1);
const [statsTotal, setStatsTotal] = useState(0);
const [statsDetail, setStatsDetail] = useState<any>(null);
const [statsDetailLoading, setStatsDetailLoading] = useState(false);
const [statsDetailInfo, setStatsDetailInfo] = useState<{ date: string; companyName: string } | null>(null);
  // 예약 캠페인 관리
  const [scheduledCampaigns, setScheduledCampaigns] = useState<any[]>([]);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; name: string } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [scheduledPage, setScheduledPage] = useState(1);
  const scheduledPerPage = 10;
  const [scheduledSearch, setScheduledSearch] = useState('');

  // 사용자 검색/필터
  const [userSearch, setUserSearch] = useState('');
  const [userCompanyFilter, setUserCompanyFilter] = useState('all');
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());

  // 발신번호 관리
  const [callbackNumbers, setCallbackNumbers] = useState<any[]>([]);
  const [showCallbackModal, setShowCallbackModal] = useState(false);
  const [callbackSearch, setCallbackSearch] = useState('');
  const [expandedCallbackCompanies, setExpandedCallbackCompanies] = useState<Set<string>>(new Set());
  const [newCallback, setNewCallback] = useState({
    companyId: '',
    phone: '',
    label: '',
    isDefault: false,
  });

  // 회사 목록 검색/필터
  const [companySearch, setCompanySearch] = useState('');
  const [companyStatusFilter, setCompanyStatusFilter] = useState('all');
  const [companyPage, setCompanyPage] = useState(1);
  const companyPerPage = 10;

  // 요금제 관리
  const [planList, setPlanList] = useState<any[]>([]);
  const [planPage, setPlanPage] = useState(1);
  const planPerPage = 10;
  
  // 플랜 신청 관리
  const [planRequests, setPlanRequests] = useState<any[]>([]);
  const [requestPage, setRequestPage] = useState(1);
  const requestPerPage = 10;
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<any>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<any>(null);
  const [newPlan, setNewPlan] = useState({
    planCode: '',
    planName: '',
    maxCustomers: 1000,
    monthlyPrice: 0,
  });

  // 충전 관리
  const [depositRequests, setDepositRequests] = useState<any[]>([]);
  const [depositPage, setDepositPage] = useState(1);
  const [depositTotal, setDepositTotal] = useState(0);
  const depositPerPage = 10;
  const [depositStatusFilter, setDepositStatusFilter] = useState('all');
  const [depositMethodFilter, setDepositMethodFilter] = useState('all');
  const [depositLoading, setDepositLoading] = useState(false);
  const [showDepositApproveModal, setShowDepositApproveModal] = useState(false);
  const [showDepositRejectModal, setShowDepositRejectModal] = useState(false);
  const [depositTarget, setDepositTarget] = useState<any>(null);
  const [depositAdminNote, setDepositAdminNote] = useState('');

// ===== 정산 관리 =====
const [billingCompanyId, setBillingCompanyId] = useState('');
const [billingStart, setBillingStart] = useState(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
});
const [billingEnd, setBillingEnd] = useState(() => {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
});
const [billingScope, setBillingScope] = useState<'company' | 'user'>('company');
const [billingUserId, setBillingUserId] = useState('');
const [billingUsers, setBillingUsers] = useState<any[]>([]);
const [billingUsersLoading, setBillingUsersLoading] = useState(false);
const [generating, setGenerating] = useState(false);
const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);
const [billings, setBillings] = useState<any[]>([]);
const [billingsLoading, setBillingsLoading] = useState(false);
const [filterYear, setFilterYear] = useState(new Date().getFullYear());
const [showBillingDetail, setShowBillingDetail] = useState(false);
const [detailBilling, setDetailBilling] = useState<any>(null);
const [detailItems, setDetailItems] = useState<any[]>([]);
const [detailLoading, setDetailLoading] = useState(false);
const [showBillingDeleteConfirm, setShowBillingDeleteConfirm] = useState(false);
const [deleteTargetId, setDeleteTargetId] = useState('');

// 고객 전체 삭제
const [showCustomerDeleteAll, setShowCustomerDeleteAll] = useState(false);
const [customerDeleteConfirmName, setCustomerDeleteConfirmName] = useState('');
const [customerDeleteLoading, setCustomerDeleteLoading] = useState(false);

// 고객 DB 관리 (슈퍼관리자 - 고객사 수정 모달 내)
const [adminCustomers, setAdminCustomers] = useState<any[]>([]);
const [adminCustPage, setAdminCustPage] = useState({ total: 0, page: 1, totalPages: 0 });
const [adminCustSearch, setAdminCustSearch] = useState('');
const [adminCustSelected, setAdminCustSelected] = useState<Set<string>>(new Set());
const [adminCustLoading, setAdminCustLoading] = useState(false);
const [showAdminCustDeleteModal, setShowAdminCustDeleteModal] = useState(false);
const [adminCustDeleteTarget, setAdminCustDeleteTarget] = useState<{ type: 'individual' | 'bulk'; customer?: any; count?: number } | null>(null);
const [adminCustDeleteLoading, setAdminCustDeleteLoading] = useState(false);
const [invoices, setInvoices] = useState<any[]>([]);
const [invoicesLoading, setInvoicesLoading] = useState(false);
const [billingToast, setBillingToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
// 정산서 이메일 발송
const [showEmailModal, setShowEmailModal] = useState(false);
const [emailTarget, setEmailTarget] = useState<any>(null);
const [emailTo, setEmailTo] = useState('');
const [emailSubject, setEmailSubject] = useState('');
const [emailSending, setEmailSending] = useState(false);
  // ===== Sync Agent 모니터링 =====
  const [syncAgents, setSyncAgents] = useState<any[]>([]);
  const [syncAgentsLoading, setSyncAgentsLoading] = useState(false);
  const [syncSelectedAgent, setSyncSelectedAgent] = useState<any>(null);
  const [syncAgentDetail, setSyncAgentDetail] = useState<any>(null);
  const [syncDetailLoading, setSyncDetailLoading] = useState(false);
  const [showSyncDetailModal, setShowSyncDetailModal] = useState(false);
  const [showSyncConfigModal, setShowSyncConfigModal] = useState(false);
  const [syncConfigForm, setSyncConfigForm] = useState({ sync_interval_customers: 60, sync_interval_purchases: 30 });
  const [showSyncCommandModal, setShowSyncCommandModal] = useState(false);
  const [syncCommandType, setSyncCommandType] = useState<'full_sync' | 'restart'>('full_sync');

  // ===== 감사 로그 =====
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLogsLoading, setAuditLogsLoading] = useState(false);
  const [auditLogsPage, setAuditLogsPage] = useState(1);
  const [auditLogsTotal, setAuditLogsTotal] = useState(0);
  const [auditLogsTotalPages, setAuditLogsTotalPages] = useState(0);
  const [auditActionFilter, setAuditActionFilter] = useState('all');
  const [auditCompanyFilter, setAuditCompanyFilter] = useState('all');
  const [auditFromDate, setAuditFromDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [auditToDate, setAuditToDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [auditActions, setAuditActions] = useState<string[]>([]);

  // ===== 잔액 변동 이력 (고객사 상세) =====
  const [balanceTxList, setBalanceTxList] = useState<any[]>([]);
  const [balanceTxLoading, setBalanceTxLoading] = useState(false);

  // 커스텀 모달 상태
  const [modal, setModal] = useState<ModalState>({ type: null, title: '', message: '' });
  const [copied, setCopied] = useState(false);

  // 신규 고객사 폼
  const [newCompany, setNewCompany] = useState({
    companyCode: '',
    companyName: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    planId: '',
  });

  // 신규 사용자 폼
  const [newUser, setNewUser] = useState({
    companyId: '',
    loginId: '',
    password: '',
    name: '',
    email: '',
    phone: '',
    department: '',
    userType: 'user',
    storeCodes: '',
  });

  useEffect(() => {
    loadData();
  }, []);
// ===== 정산 useEffect =====
useEffect(() => { if (activeTab === 'billing') { loadBillings(); loadInvoices(); } }, [activeTab]);
useEffect(() => { if (activeTab === 'billing') loadBillings(); }, [filterYear]);
useEffect(() => { if (activeTab === 'deposits') loadDepositRequests(1); }, [activeTab, depositStatusFilter, depositMethodFilter]);
useEffect(() => { if (activeTab === 'syncAgents') loadSyncAgents(); }, [activeTab]);
useEffect(() => { if (activeTab === 'auditLogs') loadAuditLogs(1); }, [activeTab]);

// 감사 로그 조회
const loadAuditLogs = async (page: number) => {
  setAuditLogsLoading(true);
  try {
    const token = localStorage.getItem('token');
    const params = new URLSearchParams({ page: String(page), limit: '10' });
    if (auditActionFilter !== 'all') params.set('action', auditActionFilter);
    if (auditCompanyFilter !== 'all') params.set('companyId', auditCompanyFilter);
    if (auditFromDate) params.set('fromDate', auditFromDate);
    if (auditToDate) params.set('toDate', auditToDate);
    const res = await fetch(`/api/admin/audit-logs?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    setAuditLogs(data.logs || []);
    setAuditLogsTotal(data.total || 0);
    setAuditLogsTotalPages(data.totalPages || 0);
    setAuditLogsPage(page);
    if (data.actions) setAuditActions(data.actions);
  } catch (e) { console.error('감사 로그 조회 실패:', e); }
  finally { setAuditLogsLoading(false); }
};

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
useEffect(() => { if (billingToast) { const t = setTimeout(() => setBillingToast(null), 3000); return () => clearTimeout(t); } }, [billingToast]);
useEffect(() => {
  if (billingScope === 'user' && billingCompanyId) {
    setBillingUsersLoading(true);
    billingApi.getCompanyUsers(billingCompanyId)
      .then(res => setBillingUsers(res.data))
      .catch(() => setBillingUsers([]))
      .finally(() => setBillingUsersLoading(false));
  } else {
    setBillingUsers([]);
    setBillingUserId('');
  }
}, [billingScope, billingCompanyId]);

// ===== Sync Agent 함수 =====
const loadSyncAgents = async () => {
  setSyncAgentsLoading(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/sync/agents', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('조회 실패');
    const data = await res.json();
    setSyncAgents(data.agents || []);
  } catch (e) {
    console.error('Sync Agent 목록 조회 실패:', e);
  } finally {
    setSyncAgentsLoading(false);
  }
};

const loadSyncAgentDetail = async (agentId: string) => {
  setSyncDetailLoading(true);
  setShowSyncDetailModal(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/sync/agents/${agentId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('조회 실패');
    const data = await res.json();
    setSyncAgentDetail(data);
  } catch (e) {
    showAlert('오류', 'Agent 상세 조회 실패', 'error');
    setShowSyncDetailModal(false);
  } finally {
    setSyncDetailLoading(false);
  }
};

const handleSyncConfigSave = async () => {
  if (!syncSelectedAgent) return;
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/sync/agents/${syncSelectedAgent.id}/config`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(syncConfigForm)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || '설정 변경 실패');
    }
    setShowSyncConfigModal(false);
    showAlert('성공', '설정이 저장되었습니다. Agent가 다음 config 조회 시 반영됩니다.', 'success');
    loadSyncAgents();
  } catch (e: any) {
    showAlert('오류', e.message || '설정 변경 실패', 'error');
  }
};

const handleSyncCommand = async () => {
  if (!syncSelectedAgent) return;
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/sync/agents/${syncSelectedAgent.id}/command`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: syncCommandType })
    });
    if (!res.ok) throw new Error('명령 전송 실패');
    setShowSyncCommandModal(false);
    showAlert('성공', '명령이 등록되었습니다. Agent가 다음 config 조회 시 실행합니다.', 'success');
  } catch (e) {
    showAlert('오류', '명령 전송 실패', 'error');
  }
};

const getSyncOnlineBadge = (status: string) => {
  if (status === 'online') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">● 정상</span>;
  if (status === 'delayed') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">● 지연</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">● 오프라인</span>;
};

const syncTimeAgo = (dateStr: string | null) => {
  if (!dateStr) return '-';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
};

// ===== 정산 함수 =====
const loadBillings = async () => {
  setBillingsLoading(true);
  try { const res = await billingApi.getBillings({ year: filterYear }); setBillings(res.data); }
  catch (e) { console.error(e); }
  finally { setBillingsLoading(false); }
};
const loadInvoices = async () => {
  setInvoicesLoading(true);
  try { const res = await billingApi.getInvoices(); setInvoices(res.data); }
  catch (e) { console.error(e); }
  finally { setInvoicesLoading(false); }
};
const handleBillingGenerate = async () => {
  setShowGenerateConfirm(false);
  setGenerating(true);
  try {
    await billingApi.generateBilling({ company_id: billingCompanyId, user_id: billingScope === 'user' ? billingUserId : undefined, billing_start: billingStart, billing_end: billingEnd });
    setBillingToast({ msg: `${billingStart} ~ ${billingEnd} 정산이 생성되었습니다`, type: 'success' });
    loadBillings();
  } catch (e: any) {
    if (e.response?.status === 409) setBillingToast({ msg: '해당 월 정산이 이미 존재합니다. 삭제 후 재생성해주세요.', type: 'error' });
    else setBillingToast({ msg: e.response?.data?.error || '정산 생성 실패', type: 'error' });
  } finally { setGenerating(false); }
};
const openBillingDetail = async (id: string) => {
  setShowBillingDetail(true);
  setDetailLoading(true);
  try { const res = await billingApi.getBillingItems(id); setDetailBilling(res.data.billing); setDetailItems(res.data.items); }
  catch (e) { setBillingToast({ msg: '상세 조회 실패', type: 'error' }); setShowBillingDetail(false); }
  finally { setDetailLoading(false); }
};
const handleBillingStatusChange = async (id: string, newStatus: string) => {
  try {
    await billingApi.updateBillingStatus(id, newStatus);
    setBillingToast({ msg: '상태가 변경되었습니다', type: 'success' });
    loadBillings();
    if (detailBilling?.id === id) setDetailBilling((prev: any) => prev ? { ...prev, status: newStatus } : prev);
  } catch (e) { setBillingToast({ msg: '상태 변경 실패', type: 'error' }); }
};
const handleBillingDelete = async () => {
  setShowBillingDeleteConfirm(false);
  try {
    await billingApi.deleteBilling(deleteTargetId);
    setBillingToast({ msg: '정산이 삭제되었습니다', type: 'success' });
    loadBillings();
    if (showBillingDetail && detailBilling?.id === deleteTargetId) setShowBillingDetail(false);
  } catch (e: any) { setBillingToast({ msg: e.response?.data?.error || '삭제 실패', type: 'error' }); }
};

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

// 슈퍼관리자 고객 목록 로드
const loadAdminCustomers = async (page = 1) => {
  if (!editCompany.id) return;
  setAdminCustLoading(true);
  try {
    const token = localStorage.getItem('token');
    const params = new URLSearchParams({ page: String(page), limit: '25', companyId: editCompany.id });
    if (adminCustSearch.trim()) params.set('search', adminCustSearch.trim());
    const res = await fetch(`/api/customers?${params}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    setAdminCustomers(data.customers || []);
    setAdminCustPage({ total: data.pagination?.total || 0, page: data.pagination?.page || 1, totalPages: data.pagination?.totalPages || 0 });
    setAdminCustSelected(new Set());
  } catch (e) { console.error('고객 목록 조회 실패:', e); }
  finally { setAdminCustLoading(false); }
};

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

const downloadBillingPdf = async (id: string, label: string) => {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`http://localhost:3000/api/admin/billing/${id}/pdf`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!response.ok) throw new Error('PDF 생성 실패');
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `정산서_${label}.pdf`; a.click();
    window.URL.revokeObjectURL(url);
  } catch (e) { setBillingToast({ msg: 'PDF 다운로드 실패', type: 'error' }); }
};
const handleInvoiceStatusChange = async (id: string, newStatus: string) => {
  try { await billingApi.updateStatus(id, newStatus); setBillingToast({ msg: '상태가 변경되었습니다', type: 'success' }); loadInvoices(); }
  catch (e) { setBillingToast({ msg: '상태 변경 실패', type: 'error' }); }
};
const downloadInvoicePdf = async (inv: any) => {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`http://localhost:3000/api/admin/billing/invoices/${inv.id}/pdf`, { headers: { 'Authorization': `Bearer ${token}` } });
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `거래내역서_${inv.company_name}_${String(inv.billing_start).slice(0, 10)}.pdf`; a.click();
    window.URL.revokeObjectURL(url);
  } catch (e) { setBillingToast({ msg: 'PDF 다운로드 실패', type: 'error' }); }
};
const billingFmt = (n: number) => (n || 0).toLocaleString('ko-KR');
const billingFmtWon = (n: number) => `₩${(n || 0).toLocaleString('ko-KR')}`;
const billingStatusBadge = (s: string) => {
  const map: Record<string, string> = { draft: 'bg-gray-100 text-gray-600', confirmed: 'bg-blue-100 text-blue-700', paid: 'bg-green-100 text-green-700' };
  const label: Record<string, string> = { draft: '초안', confirmed: '확정', paid: '수금완료' };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[s] || ''}`}>{label[s] || s}</span>;
};
const billingTypeLabel: Record<string, string> = { SMS: 'SMS', LMS: 'LMS', MMS: 'MMS', KAKAO: '카카오', TEST_SMS: '테스트SMS', TEST_LMS: '테스트LMS' };
const billingCurrentYear = new Date().getFullYear();
const billingYearOptions = [billingCurrentYear - 1, billingCurrentYear, billingCurrentYear + 1];

// 정산서 이메일 발송 모달 열기
const openEmailModal = (billing: any) => {
  const company = companies.find(c => c.id === billing.company_id);
  setEmailTarget(billing);
  setEmailTo(company?.contact_email || '');
  setEmailSubject(`[인비토] ${billing.company_name} ${billing.billing_year}년 ${billing.billing_month}월 거래내역서`);
  setShowEmailModal(true);
};

// 정산서 이메일 발송 처리
const handleSendBillingEmail = async () => {
  if (!emailTo) return setBillingToast({ msg: '수신자 이메일을 입력해주세요', type: 'error' });
  if (!emailTarget) return;
  setEmailSending(true);
  try {
    const bodyHtml = `
      <div style="font-family:'Apple SD Gothic Neo','맑은 고딕',sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <div style="border-bottom:3px solid #4F46E5;padding-bottom:16px;margin-bottom:24px;">
          <h2 style="margin:0;color:#1F2937;font-size:20px;">INVITO 거래내역서</h2>
        </div>
        <p style="color:#374151;font-size:14px;line-height:1.8;">
          안녕하세요, <strong>${emailTarget.company_name}</strong> 담당자님.<br/>
          아래와 같이 거래내역서를 송부드립니다.
        </p>
        <div style="background:#F3F4F6;border-radius:8px;padding:20px;margin:20px 0;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151;">
            <tr><td style="padding:6px 0;color:#6B7280;">정산 기간</td><td style="padding:6px 0;text-align:right;font-weight:600;">${emailTarget.billing_year}년 ${emailTarget.billing_month}월</td></tr>
            <tr><td style="padding:6px 0;color:#6B7280;">공급가액</td><td style="padding:6px 0;text-align:right;">₩${Number(emailTarget.subtotal || 0).toLocaleString('ko-KR')}</td></tr>
            <tr><td style="padding:6px 0;color:#6B7280;">부가세</td><td style="padding:6px 0;text-align:right;">₩${Number(emailTarget.vat || 0).toLocaleString('ko-KR')}</td></tr>
            <tr style="border-top:2px solid #D1D5DB;"><td style="padding:10px 0 6px;color:#1F2937;font-weight:700;">합계</td><td style="padding:10px 0 6px;text-align:right;font-weight:700;color:#4F46E5;font-size:18px;">₩${Number(emailTarget.total_amount || 0).toLocaleString('ko-KR')}</td></tr>
          </table>
        </div>
        <p style="color:#374151;font-size:14px;line-height:1.8;">
          첨부된 거래내역서(PDF)를 확인해 주세요.<br/>
          문의사항이 있으시면 아래 연락처로 연락 부탁드립니다.
        </p>
        <div style="margin-top:32px;padding-top:16px;border-top:1px solid #E5E7EB;color:#9CA3AF;font-size:12px;">
          <strong style="color:#6B7280;">주식회사 인비토 (INVITO Corp.)</strong><br/>
          이메일: mobile@invitocorp.com
        </div>
      </div>
    `;
    const res = await billingApi.sendBillingEmail(emailTarget.id, {
      to: emailTo,
      subject: emailSubject,
      body_html: bodyHtml,
    });
    setBillingToast({ msg: res.data.message || '정산서가 발송되었습니다', type: 'success' });
    setShowEmailModal(false);
    // 발송 이력 반영
    if (detailBilling?.id === emailTarget.id) {
      setDetailBilling((prev: any) => prev ? { ...prev, emailed_at: res.data.emailed_at, emailed_to: res.data.emailed_to } : prev);
    }
    loadBillings();
  } catch (e: any) {
    setBillingToast({ msg: e.response?.data?.error || '이메일 발송 실패', type: 'error' });
  } finally {
    setEmailSending(false);
  }
};
  const loadData = async () => {
    try {
      const [companiesRes, plansRes] = await Promise.all([
        companiesApi.list(),
        plansApi.list(),
      ]);
      setCompanies(companiesRes.data.companies);
      setPlans(plansRes.data.plans);
      
      // 사용자 목록 로드
      await loadUsers();
      // 예약 캠페인 로드
      await loadScheduledCampaigns();
      // 발신번호 로드
      await loadCallbackNumbers();
      // 요금제 로드
      await loadPlans();
      // 플랜 신청 로드
      await loadPlanRequests();
      // 충전 요청 로드 (배지 카운트용)
      await loadDepositRequests(1);
    } catch (error) {
      console.error('데이터 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error('사용자 로드 실패:', error);
    }
  };

  const loadScheduledCampaigns = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/campaigns/scheduled', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setScheduledCampaigns(data.campaigns || []);
      }
    } catch (error) {
      console.error('예약 캠페인 로드 실패:', error);
    }
  };

  const loadCallbackNumbers = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/callback-numbers', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCallbackNumbers(data.callbackNumbers || []);
      }
    } catch (error) {
      console.error('발신번호 로드 실패:', error);
    }
  };

  const loadPlans = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/plans', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPlanList(data.plans || []);
      }
    } catch (error) {
      console.error('요금제 로드 실패:', error);
    }
  };

  const loadPlanRequests = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/plan-requests', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPlanRequests(data.requests || []);
      }
    } catch (error) {
      console.error('플랜 신청 로드 실패:', error);
    }
  };

  const loadDepositRequests = async (page = 1) => {
    setDepositLoading(true);
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({ page: String(page), limit: String(depositPerPage) });
      if (depositStatusFilter !== 'all') params.set('status', depositStatusFilter);
      if (depositMethodFilter !== 'all') params.set('paymentMethod', depositMethodFilter);
      const res = await fetch(`/api/admin/deposit-requests?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDepositRequests(data.requests || []);
        setDepositTotal(data.total || 0);
        setDepositPage(page);
      }
    } catch (error) {
      console.error('충전 요청 로드 실패:', error);
    }
    setDepositLoading(false);
  };

  const handleApproveDeposit = async () => {
    if (!depositTarget) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/deposit-requests/${depositTarget.id}/approve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ adminNote: depositAdminNote || null })
      });
      if (res.ok) {
        setModal({ type: 'alert', title: '승인 완료', message: `${Number(depositTarget.amount).toLocaleString()}원이 충전되었습니다.`, variant: 'success' });
        setShowDepositApproveModal(false);
        setDepositTarget(null);
        setDepositAdminNote('');
        loadDepositRequests(depositPage);
      } else {
        const err = await res.json();
        setModal({ type: 'alert', title: '승인 실패', message: err.error || '처리 중 오류 발생', variant: 'error' });
      }
    } catch (error) {
      setModal({ type: 'alert', title: '오류', message: '네트워크 오류', variant: 'error' });
    }
  };

  const handleRejectDeposit = async () => {
    if (!depositTarget) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/deposit-requests/${depositTarget.id}/reject`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ adminNote: depositAdminNote || '거절' })
      });
      if (res.ok) {
        setModal({ type: 'alert', title: '거절 완료', message: '충전 요청이 거절되었습니다.', variant: 'success' });
        setShowDepositRejectModal(false);
        setDepositTarget(null);
        setDepositAdminNote('');
        loadDepositRequests(depositPage);
      } else {
        const err = await res.json();
        setModal({ type: 'alert', title: '거절 실패', message: err.error || '처리 중 오류 발생', variant: 'error' });
      }
    } catch (error) {
      setModal({ type: 'alert', title: '오류', message: '네트워크 오류', variant: 'error' });
    }
  };

  const loadAllCampaigns = async (page = 1) => {
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({ page: String(page), limit: '10' });
      if (allCampaignsSearch) params.set('search', allCampaignsSearch);
      if (allCampaignsStatus) params.set('status', allCampaignsStatus);
      if (allCampaignsCompany) params.set('companyId', allCampaignsCompany);
      const res = await fetch(`/api/admin/campaigns/all?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAllCampaigns(data.campaigns || []);
        setAllCampaignsTotal(data.total || 0);
        setAllCampaignsPage(page);
      }
    } catch (error) {
      console.error('전체 캠페인 로드 실패:', error);
  }
};

const loadSendStats = async (page = 1) => {
  try {
    const token = localStorage.getItem('token');
    const params = new URLSearchParams({
      view: statsView,
      page: String(page),
      limit: '10',
    });
    if (statsStartDate) params.set('startDate', statsStartDate);
    if (statsEndDate) params.set('endDate', statsEndDate);
    if (statsCompanyFilter) params.set('companyId', statsCompanyFilter);
    const res = await fetch(`/api/admin/stats/send?${params}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      setSendStats(data);
      setStatsPage(page);
      setStatsTotal(data.total || 0);
    }
  } catch (error) {
    console.error('발송 통계 로드 실패:', error);
  }
};
const loadStatsDetail = async (date: string, companyId: string, companyName: string) => {
  try {
    setStatsDetailLoading(true);
    setStatsDetailInfo({ date, companyName });
    const token = localStorage.getItem('token');
    const params = new URLSearchParams({ view: statsView, date, companyId });
    const res = await fetch(`/api/admin/stats/send/detail?${params}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      setStatsDetail(data);
    }
  } catch (error) {
    console.error('통계 상세 로드 실패:', error);
  } finally {
    setStatsDetailLoading(false);
  }
};

const handleApproveRequest = async (id: string) => {
  setModal({
      type: 'confirm',
      title: '플랜 변경 승인',
      message: '이 신청을 승인하시겠습니까?\n승인 시 즉시 플랜이 변경됩니다.',
      onConfirm: async () => {
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/plan-requests/${id}/approve`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
          });
          
          if (res.ok) {
            closeModal();
            setModal({ type: 'alert', title: '승인 완료', message: '플랜이 변경되었습니다.', variant: 'success' });
            loadPlanRequests();
            loadData();
          } else {
            const data = await res.json();
            closeModal();
            setModal({ type: 'alert', title: '승인 실패', message: data.error || '승인에 실패했습니다.', variant: 'error' });
          }
        } catch (error) {
          closeModal();
          setModal({ type: 'alert', title: '오류', message: '처리 중 오류가 발생했습니다.', variant: 'error' });
        }
      }
    });
  };

  const handleRejectRequest = async () => {
    if (!rejectTarget || !rejectReason.trim()) {
      setModal({ type: 'alert', title: '입력 오류', message: '거절 사유를 입력해주세요.', variant: 'warning' });
      return;
    }
    
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/plan-requests/${rejectTarget.id}/reject`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ adminNote: rejectReason.trim() })
      });
      
      if (res.ok) {
        setShowRejectModal(false);
        setRejectTarget(null);
        setRejectReason('');
        setModal({ type: 'alert', title: '거절 완료', message: '신청이 거절되었습니다.', variant: 'success' });
        loadPlanRequests();
      } else {
        const data = await res.json();
        setModal({ type: 'alert', title: '거절 실패', message: data.error || '거절에 실패했습니다.', variant: 'error' });
      }
    } catch (error) {
      setModal({ type: 'alert', title: '오류', message: '처리 중 오류가 발생했습니다.', variant: 'error' });
    }
  };

  // 모달 헬퍼 함수
  const showAlert = (title: string, message: string, variant: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    setModal({ type: 'alert', title, message, variant });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setModal({ type: 'confirm', title, message, onConfirm });
  };

  const showPasswordModal = (password: string, smsSent?: boolean, phone?: string) => {
    setCopied(false);
    setModal({ type: 'password', title: '임시 비밀번호 발급', message: '', password, smsSent, phone });
  };

  const closeModal = () => {
    setModal({ type: null, title: '', message: '' });
    setCopied(false);
  };

  const handleCopyPassword = async () => {
    if (modal.password) {
      await navigator.clipboard.writeText(modal.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await companiesApi.create(newCompany);
      setShowCompanyModal(false);
      setNewCompany({
        companyCode: '',
        companyName: '',
        contactName: '',
        contactEmail: '',
        contactPhone: '',
        planId: '',
      });
      loadData();
      showAlert('성공', '고객사가 생성되었습니다.', 'success');
    } catch (error: any) {
      showAlert('오류', error.response?.data?.error || '생성 실패', 'error');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ...newUser,
          storeCodes: newUser.storeCodes ? newUser.storeCodes.split(',').map(s => s.trim()).filter(Boolean) : null
        })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '생성 실패');
      }
      
      setShowUserModal(false);
      setNewUser({
        companyId: '',
        loginId: '',
        password: '',
        name: '',
        email: '',
        phone: '',
        department: '',
        userType: 'user',
        storeCodes: '',
      });
      loadUsers();
      showAlert('성공', '사용자가 생성되었습니다.', 'success');
    } catch (error: any) {
      showAlert('오류', error.message || '생성 실패', 'error');
    }
  };

  const handleResetPassword = async (userId: string, userName: string) => {
    showConfirm(
      '비밀번호 초기화',
      `${userName}님의 비밀번호를 초기화하시겠습니까?`,
      async () => {
        closeModal();
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (!res.ok) throw new Error('초기화 실패');
          
          const data = await res.json();
          showPasswordModal(data.tempPassword, data.smsSent, data.phone);
        } catch (error) {
          showAlert('오류', '비밀번호 초기화 실패', 'error');
        }
      }
    );
  };

  const handleDeleteUser = async (userId: string, userName: string) => {
    showConfirm(
      '사용자 삭제',
      `${userName}님을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
      async () => {
        closeModal();
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/users/${userId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (!res.ok) throw new Error('삭제 실패');
          
          loadUsers();
          showAlert('성공', '삭제되었습니다.', 'success');
        } catch (error) {
          showAlert('오류', '삭제 실패', 'error');
        }
      }
    );
  };

  const handleEditUser = (user: any) => {
    setEditingUser({
      ...user,
      storeCodes: user.store_codes ? user.store_codes.join(', ') : ''
    });
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: editingUser.name,
          email: editingUser.email,
          phone: editingUser.phone,
          department: editingUser.department,
          userType: editingUser.user_type,
          status: editingUser.status,
          storeCodes: editingUser.storeCodes ? editingUser.storeCodes.split(',').map((s: string) => s.trim()).filter(Boolean) : null
        })
      });

      if (!res.ok) throw new Error('수정 실패');

      setEditingUser(null);
      loadUsers();
      showAlert('성공', '사용자 정보가 수정되었습니다.', 'success');
    } catch (error) {
      showAlert('오류', '수정 실패', 'error');
    }
  };

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
      const [res, fieldsRes, enabledRes, dataCheckRes] = await Promise.all([
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
          address: c.address || '',
          sendHourStart: c.send_start_hour ?? 9,
          sendHourEnd: c.send_end_hour ?? 21,
          dailyLimit: c.daily_limit_per_customer ?? 0,
          duplicateDays: c.duplicate_prevention_days ?? 7,
          costPerSms: c.cost_per_sms ?? 9.9,
          costPerLms: c.cost_per_lms ?? 27,
          costPerMms: c.cost_per_mms ?? 50,
          costPerKakao: c.cost_per_kakao ?? 7.5,
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
          sessionTimeoutMinutes: c.session_timeout_minutes ?? 30,
          storeCodeList: c.store_code_list || [],
          newStoreCode: '',
          newExcludedSegment: '',
        });
        setEditCompanyTab('basic');
        setShowEditCompanyModal(true);
      }
    } catch (error) {
      console.error('회사 정보 로드 실패:', error);
    }
  };

  const handleUpdateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const [res, fieldsRes] = await Promise.all([
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

  const openCancelModal = (id: string, name: string) => {
    setCancelTarget({ id, name });
    setCancelReason('');
    setShowCancelModal(true);
  };

  const handleCancelCampaign = async () => {
    if (!cancelTarget || !cancelReason.trim()) {
      showAlert('오류', '취소 사유를 입력해주세요.', 'error');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/campaigns/${cancelTarget.id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ reason: cancelReason })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '취소 실패');
      }

      setShowCancelModal(false);
      setCancelTarget(null);
      setCancelReason('');
      loadScheduledCampaigns();
      showAlert('성공', '예약이 취소되었습니다.', 'success');
    } catch (error: any) {
      showAlert('오류', error.message || '취소 실패', 'error');
    }
  };

  const handleCreateCallback = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/callback-numbers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newCallback)
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '등록 실패');
      }
      
      setShowCallbackModal(false);
      setNewCallback({ companyId: '', phone: '', label: '', isDefault: false });
      loadCallbackNumbers();
      showAlert('성공', '발신번호가 등록되었습니다.', 'success');
    } catch (error: any) {
      showAlert('오류', error.message || '등록 실패', 'error');
    }
  };

  const [editingCallback, setEditingCallback] = useState<any>(null);

  const handleUpdateCallback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCallback) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/callback-numbers/${editingCallback.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ phone: editingCallback.phone, label: editingCallback.label })
      });
      if (!res.ok) throw new Error('수정 실패');
      setEditingCallback(null);
      loadCallbackNumbers();
      showAlert('성공', '발신번호가 수정되었습니다.', 'success');
    } catch (error) {
      showAlert('오류', '수정 실패', 'error');
    }
  };

  const handleDeleteCallback = (id: string, phone: string) => {
    showConfirm(
      '발신번호 삭제',
      `${phone} 번호를 삭제하시겠습니까?`,
      async () => {
        closeModal();
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/callback-numbers/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (!res.ok) throw new Error('삭제 실패');
          
          loadCallbackNumbers();
          showAlert('성공', '삭제되었습니다.', 'success');
        } catch (error) {
          showAlert('오류', '삭제 실패', 'error');
        }
      }
    );
  };

  const handleSetDefault = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/callback-numbers/${id}/default`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) throw new Error('설정 실패');
      
      loadCallbackNumbers();
      showAlert('성공', '대표번호로 설정되었습니다.', 'success');
    } catch (error) {
      showAlert('오류', '설정 실패', 'error');
    }
  };

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/plans', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newPlan)
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '등록 실패');
      
      setShowPlanModal(false);
      setNewPlan({ planCode: '', planName: '', maxCustomers: 1000, monthlyPrice: 0 });
      loadPlans();
      showAlert('성공', '요금제가 등록되었습니다.', 'success');
    } catch (error: any) {
      showAlert('오류', error.message || '등록 실패', 'error');
    }
  };

  const handleUpdatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlan) return;
    
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/plans/${editingPlan.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          planName: editingPlan.plan_name,
          maxCustomers: editingPlan.max_customers,
          monthlyPrice: editingPlan.monthly_price,
          isActive: editingPlan.is_active,
        })
      });
      
      if (!res.ok) throw new Error('수정 실패');
      
      setEditingPlan(null);
      loadPlans();
      showAlert('성공', '수정되었습니다.', 'success');
    } catch (error) {
      showAlert('오류', '수정 실패', 'error');
    }
  };

  const handleDeletePlan = (id: string, name: string) => {
    showConfirm(
      '요금제 삭제',
      `"${name}" 요금제를 삭제하시겠습니까?`,
      async () => {
        closeModal();
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/plans/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || '삭제 실패');
          
          loadPlans();
          showAlert('성공', '삭제되었습니다.', 'success');
        } catch (error: any) {
          showAlert('오류', error.message || '삭제 실패', 'error');
        }
      }
    );
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      trial: 'bg-yellow-100 text-yellow-800',
      active: 'bg-green-100 text-green-800',
      suspended: 'bg-red-100 text-red-800',
      terminated: 'bg-gray-100 text-gray-800',
      locked: 'bg-red-100 text-red-800',
      dormant: 'bg-gray-100 text-gray-800',
    };
    const labels: Record<string, string> = {
      trial: '체험',
      active: '활성',
      suspended: '정지',
      terminated: '해지',
      locked: '잠금',
      dormant: '휴면',
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || styles.active}`}>
        {labels[status] || status}
      </span>
    );
  };

  const getUserTypeBadge = (userType: string) => {
    if (userType === 'admin') {
      return <span className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">관리자</span>;
    }
    return <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">일반</span>;
  };

  // 필터링된 회사 목록
  const filteredCompanies = companies.filter((company) => {
    const matchesSearch = companySearch === '' || 
      company.company_code.toLowerCase().includes(companySearch.toLowerCase()) ||
      company.company_name.toLowerCase().includes(companySearch.toLowerCase()) ||
      (company.contact_name && company.contact_name.toLowerCase().includes(companySearch.toLowerCase()));
    
    const matchesStatus = companyStatusFilter === 'all' || company.status === companyStatusFilter;
    
    return matchesSearch && matchesStatus;
  });

  // 임시 비밀번호 생성
  const generateTempPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 8; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewUser({ ...newUser, password });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* 헤더 */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold text-gray-800 cursor-pointer hover:text-blue-600 transition" onClick={() => window.location.reload()}>한줄로 시스템 관리</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{user?.name}님</span>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* 메인 */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* 통계 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500">전체 고객사</div>
            <div className="text-3xl font-bold text-gray-800">{companies.length}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500">활성 고객사</div>
            <div className="text-3xl font-bold text-green-600">
              {companies.filter(c => c.status === 'active').length}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500">전체 사용자</div>
            <div className="text-3xl font-bold text-blue-600">{users.length}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500">요금제</div>
            <div className="text-3xl font-bold text-purple-600">{plans.length}개</div>
          </div>
        </div>

        {/* 탭 메뉴 */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="border-b">
            <nav className="flex">
              <button
                onClick={() => setActiveTab('companies')}
                className={`px-4 py-3 text-sm font-medium border-b-2 ${
                  activeTab === 'companies'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                고객사 관리
              </button>
              <button
                onClick={() => setActiveTab('users')}
                className={`px-4 py-3 text-sm font-medium border-b-2 ${
                  activeTab === 'users'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                사용자 관리
              </button>
              <button
                onClick={() => setActiveTab('callbacks')}
                className={`px-4 py-3 text-sm font-medium border-b-2 ${
                  activeTab === 'callbacks'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                발신번호 관리
              </button>
              <button
                onClick={() => { setActiveTab('stats'); loadSendStats(); }}
                className={`px-4 py-3 text-sm font-medium border-b-2 ${
                  activeTab === 'stats'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                발송 통계
              </button>
              <button
                onClick={() => setActiveTab('scheduled')}
                className={`px-4 py-3 text-sm font-medium border-b-2 ${
                  activeTab === 'scheduled'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                예약 관리
              </button>
              <button
                onClick={() => { setActiveTab('allCampaigns'); loadAllCampaigns(); }}
                className={`px-4 py-3 text-sm font-medium border-b-2 ${
                  activeTab === 'allCampaigns'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                전체 캠페인
              </button>
              <button
                onClick={() => setActiveTab('plans')}
                className={`px-4 py-3 text-sm font-medium border-b-2 ${
                  activeTab === 'plans'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
                >
                요금제 관리
              </button>
              <button
                onClick={() => setActiveTab('requests')}
                className={`px-4 py-3 text-sm font-medium border-b-2 relative ${
                  activeTab === 'requests'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                플랜 신청
                {planRequests.filter(r => r.status === 'pending').length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {planRequests.filter(r => r.status === 'pending').length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('deposits')}
                className={`px-4 py-3 text-sm font-medium border-b-2 relative ${
                  activeTab === 'deposits'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                충전 관리
                {depositRequests.filter(r => r.status === 'pending').length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-emerald-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {depositRequests.filter(r => r.status === 'pending').length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('billing')}
                className={`px-4 py-3 text-sm font-medium border-b-2 ${
                  activeTab === 'billing'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                정산 관리
              </button>
              <button
                onClick={() => setActiveTab('syncAgents')}
                className={`px-4 py-3 text-sm font-medium border-b-2 ${
                  activeTab === 'syncAgents'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Sync 모니터링
              </button>
              <button
                onClick={() => setActiveTab('auditLogs')}
                className={`px-4 py-3 text-sm font-medium border-b-2 ${
                  activeTab === 'auditLogs'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                📋 감사 로그
              </button>
            </nav>
          </div>
        </div>
        {/* 고객사 관리 탭 */}
        {activeTab === 'companies' && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h2 className="text-lg font-semibold">고객사 목록</h2>
              <button
                onClick={() => setShowCompanyModal(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                + 고객사 추가
              </button>
            </div>

            {/* 검색/필터 */}
            <div className="px-6 py-3 border-b bg-gray-50 flex gap-4 items-center">
              <div className="flex-1">
                <input
                  type="text"
                  value={companySearch}
                  onChange={(e) => { setCompanySearch(e.target.value); setCompanyPage(1); }}
                  placeholder="회사코드, 회사명, 담당자명 검색..."
                  className="w-full max-w-xs px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">상태:</span>
                <select
                  value={companyStatusFilter}
                  onChange={(e) => { setCompanyStatusFilter(e.target.value); setCompanyPage(1); }}
                  className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="all">전체</option>
                  <option value="active">활성</option>
                  <option value="trial">체험</option>
                  <option value="suspended">정지</option>
                  <option value="terminated">해지</option>
                </select>
              </div>
              <div className="text-sm text-gray-500">
                {filteredCompanies.length}개 / 총 {companies.length}개
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">코드</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">회사명</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">담당자</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">요금제</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">상태</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">고객 수</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">등록일</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                {filteredCompanies.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                        {companies.length === 0 ? '등록된 고객사가 없습니다.' : '검색 결과가 없습니다.'}
                      </td>
                    </tr>
                  ) : (
                    filteredCompanies
                      .slice((companyPage - 1) * companyPerPage, companyPage * companyPerPage)
                      .map((company) => (
                      <tr key={company.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                          {company.company_code}
                        </td>
                        <td className="px-4 py-3 text-gray-900">{company.company_name}</td>
                        <td className="px-4 py-3 text-gray-500">{company.contact_name || '-'}</td>
                        <td className="px-4 py-3 text-center text-gray-500 whitespace-nowrap">{company.plan_name || '-'}</td>
                        <td className="px-4 py-3 text-center">{getStatusBadge(company.status)}</td>
                        <td className="px-4 py-3 text-center text-gray-500 whitespace-nowrap">
                          {company.total_customers?.toLocaleString() || 0}
                        </td>
                        <td className="px-4 py-3 text-center text-gray-500 whitespace-nowrap">
                          {formatDate(company.created_at)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button 
                            onClick={() => handleEditCompany(company)}
                            className="text-blue-600 hover:text-blue-800 text-sm mr-2"
                          >
                            수정
                          </button>
                          {company.status !== 'terminated' && (
                            <button 
                              onClick={() => handleDeactivateCompany(company)}
                              className="text-red-600 hover:text-red-800 text-sm"
                            >
                              해지
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                </table>
            </div>
            {filteredCompanies.length > companyPerPage && (
              <div className="px-6 py-4 border-t flex items-center justify-between">
                <span className="text-sm text-gray-500">
                  총 {filteredCompanies.length}개 중 {(companyPage - 1) * companyPerPage + 1}-{Math.min(companyPage * companyPerPage, filteredCompanies.length)}
                </span>
                <div className="flex gap-1">
                  <button onClick={() => setCompanyPage(p => Math.max(1, p - 1))} disabled={companyPage === 1}
                    className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50">◀ 이전</button>
                  {Array.from({ length: Math.ceil(filteredCompanies.length / companyPerPage) }, (_, i) => i + 1).map(p => (
                    <button key={p} onClick={() => setCompanyPage(p)}
                      className={`px-3 py-1 rounded border text-sm ${companyPage === p ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'}`}>{p}</button>
                  ))}
                  <button onClick={() => setCompanyPage(p => Math.min(Math.ceil(filteredCompanies.length / companyPerPage), p + 1))}
                    disabled={companyPage >= Math.ceil(filteredCompanies.length / companyPerPage)}
                    className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50">다음 ▶</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 사용자 관리 탭 */}
        {activeTab === 'users' && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h2 className="text-lg font-semibold">사용자 목록</h2>
              <button
                onClick={() => setShowUserModal(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                + 사용자 추가
              </button>
            </div>

            {/* 검색/필터 */}
            <div className="px-6 py-3 bg-gray-50 border-b flex gap-4 items-center">
              <div className="flex-1">
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="🔍 아이디, 이름으로 검색..."
                  className="w-full max-w-xs px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">회사:</label>
                <select
                  value={userCompanyFilter}
                  onChange={(e) => setUserCompanyFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="all">전체</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.company_name}</option>
                  ))}
                </select>
              </div>
              <span className="text-sm text-gray-500">
                총 {users.filter(u => {
                  const matchSearch = !userSearch || 
                    u.login_id.toLowerCase().includes(userSearch.toLowerCase()) ||
                    u.name.toLowerCase().includes(userSearch.toLowerCase());
                  const matchCompany = userCompanyFilter === 'all' || u.company_id === userCompanyFilter;
                  return matchSearch && matchCompany;
                }).length}명
              </span>
            </div>

            <div className="overflow-x-auto">
              {(() => {
                // 필터링된 사용자
                const filteredUsers = users.filter(u => {
                  const matchSearch = !userSearch || 
                    u.login_id.toLowerCase().includes(userSearch.toLowerCase()) ||
                    u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
                    (u.company_name || '').toLowerCase().includes(userSearch.toLowerCase());
                  const matchCompany = userCompanyFilter === 'all' || u.company_id === userCompanyFilter;
                  return matchSearch && matchCompany;
                });

                // 회사별 그룹핑
                const groupedUsers = filteredUsers.reduce((acc, user) => {
                  const companyId = user.company_id || 'none';
                  if (!acc[companyId]) {
                    acc[companyId] = {
                      companyName: user.company_name || '소속 없음',
                      users: []
                    };
                  }
                  acc[companyId].users.push(user);
                  return acc;
                }, {} as Record<string, { companyName: string; users: typeof users }>);

                const companyIds = Object.keys(groupedUsers);

                if (filteredUsers.length === 0) {
                  return (
                    <div className="px-6 py-12 text-center text-gray-500">
                      {users.length === 0 ? '등록된 사용자가 없습니다.' : '검색 결과가 없습니다.'}
                    </div>
                  );
                }

                return (
                  <div className="divide-y">
                    {companyIds.map(companyId => {
                      const group = groupedUsers[companyId];
                      const isExpanded = expandedCompanies.has(companyId);
                      
                      return (
                        <div key={companyId}>
                          <button
                            onClick={() => {
                              const newSet = new Set(expandedCompanies);
                              if (isExpanded) {
                                newSet.delete(companyId);
                              } else {
                                newSet.add(companyId);
                              }
                              setExpandedCompanies(newSet);
                            }}
                            className="w-full px-6 py-3 bg-gray-50 hover:bg-gray-100 flex items-center justify-between transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <span className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                                ▶
                              </span>
                              <span className="font-semibold text-gray-800">{group.companyName}</span>
                              <span className="text-sm text-gray-500">({group.users.length}명)</span>
                            </div>
                          </button>
                          
                          {isExpanded && (
                            <table className="w-full text-sm">
                              <thead className="bg-gray-50/50">
                                <tr>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">로그인ID</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">이름</th>
                                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">권한</th>
                                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">담당 브랜드</th>
                                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">상태</th>
                                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">최근로그인</th>
                                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">관리</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {group.users.map((u) => (
                                  <tr key={u.id} className="hover:bg-blue-50/30">
                                    <td className="px-4 py-2.5 font-medium text-gray-900">{u.login_id}</td>
                                    <td className="px-4 py-2.5 text-gray-900">{u.name}</td>
                                    <td className="px-4 py-2.5 text-center">{getUserTypeBadge(u.user_type)}</td>
                                    <td className="px-4 py-2.5 text-center text-gray-600">
                                      {(u as any).store_codes && (u as any).store_codes.length > 0 
                                        ? (u as any).store_codes.join(', ') 
                                        : <span className="text-gray-400">전체</span>}
                                    </td>
                                    <td className="px-4 py-2.5 text-center">{getStatusBadge(u.status)}</td>
                                    <td className="px-4 py-2.5 text-center text-gray-500">
                                      {u.last_login_at ? formatDateTime(u.last_login_at) : '-'}
                                    </td>
                                    <td className="px-4 py-2.5 text-center">
                                      <button 
                                        onClick={() => handleEditUser(u)}
                                        className="text-blue-600 hover:text-blue-800 text-sm mr-2"
                                      >
                                        수정
                                      </button>
                                      <button 
                                        onClick={() => handleResetPassword(u.id, u.name)}
                                        className="text-orange-600 hover:text-orange-800 text-sm mr-2"
                                      >
                                        비번초기화
                                      </button>
                                      <button 
                                        onClick={() => handleDeleteUser(u.id, u.name)}
                                        className="text-red-600 hover:text-red-800 text-sm"
                                      >
                                        삭제
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            </div>
        )}

        {/* 예약 관리 탭 */}
        {activeTab === 'scheduled' && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h2 className="text-lg font-semibold">예약 캠페인 관리</h2>
              <span className="text-sm text-gray-500">총 {scheduledCampaigns.length}건</span>
            </div>

            <div className="px-6 py-3 border-b bg-gray-50 flex gap-4 items-center">
              <input
                type="text"
                value={scheduledSearch}
                onChange={(e) => { setScheduledSearch(e.target.value); setScheduledPage(1); }}
                placeholder="🔍 고객사명으로 검색..."
                className="w-full max-w-xs px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
              {scheduledSearch && (
                <span className="text-sm text-gray-500">
                  {scheduledCampaigns.filter(c => (c.company_name || '').toLowerCase().includes(scheduledSearch.toLowerCase())).length}건 검색됨
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
              <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">고객사</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">캠페인명</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">대상</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">등록일시</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">예약시간</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">상태</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {scheduledCampaigns.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                        예약된 캠페인이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    scheduledCampaigns
                      .filter(c => !scheduledSearch || (c.company_name || '').toLowerCase().includes(scheduledSearch.toLowerCase()))
                      .slice((scheduledPage - 1) * scheduledPerPage, scheduledPage * scheduledPerPage)
                      .map((campaign) => (
                      <tr key={campaign.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900">
                          {campaign.company_name}
                          <span className="text-gray-400 ml-1">({campaign.company_code})</span>
                        </td>
                        <td className="px-4 py-3 text-gray-900">{campaign.campaign_name}</td>
                        <td className="px-4 py-3 text-center text-gray-500 whitespace-nowrap">
                          {campaign.target_count?.toLocaleString() || 0}명
                        </td>
                        <td className="px-4 py-3 text-center text-gray-500 whitespace-nowrap">
                          {campaign.created_at ? formatDateTime(campaign.created_at) : '-'}
                        </td>
                        <td className="px-4 py-3 text-center text-gray-500 whitespace-nowrap">
                          {campaign.scheduled_at ? formatDateTime(campaign.scheduled_at) : '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {campaign.status === 'scheduled' ? (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">예약</span>
                          ) : (
                            <div>
                              <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">취소됨</span>
                              {campaign.cancelled_by_type === 'super_admin' && (
                                <span className="ml-1 text-xs text-red-500">(관리자)</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {campaign.status === 'scheduled' ? (
                            <button
                              onClick={() => openCancelModal(campaign.id, campaign.campaign_name)}
                              className="text-red-600 hover:text-red-800 text-sm"
                            >
                              취소
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">
                              {campaign.cancel_reason && `사유: ${campaign.cancel_reason}`}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* 페이지네이션 */}
            {(() => {
              const filtered = scheduledCampaigns.filter(c => !scheduledSearch || (c.company_name || '').toLowerCase().includes(scheduledSearch.toLowerCase()));
              const totalPages = Math.ceil(filtered.length / scheduledPerPage);
              if (filtered.length <= scheduledPerPage) return null;
              return (
                <div className="px-6 py-4 border-t flex items-center justify-between">
                  <span className="text-sm text-gray-500">
                    총 {filtered.length}건 중 {(scheduledPage - 1) * scheduledPerPage + 1}-{Math.min(scheduledPage * scheduledPerPage, filtered.length)}
                  </span>
                  <div className="flex gap-1">
                    <button onClick={() => setScheduledPage(p => Math.max(1, p - 1))} disabled={scheduledPage === 1}
                      className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50">◀ 이전</button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                      <button key={p} onClick={() => setScheduledPage(p)}
                        className={`px-3 py-1 rounded border text-sm ${scheduledPage === p ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'}`}>{p}</button>
                    ))}
                    <button onClick={() => setScheduledPage(p => Math.min(totalPages, p + 1))}
                      disabled={scheduledPage >= totalPages}
                      className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50">다음 ▶</button>
                  </div>
                </div>
              );
            })()}
            </div>
        )}

        {/* 발신번호 관리 탭 */}
        {activeTab === 'callbacks' && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h2 className="text-lg font-semibold">발신번호 관리</h2>
              <button
                onClick={() => setShowCallbackModal(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                + 발신번호 등록
              </button>
            </div>

            <div className="px-6 py-3 border-b bg-gray-50 flex gap-4 items-center">
              <input
                type="text"
                value={callbackSearch}
                onChange={(e) => setCallbackSearch(e.target.value)}
                placeholder="🔍 고객사명으로 검색..."
                className="w-full max-w-xs px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <span className="text-sm text-gray-500">총 {callbackNumbers.length}개</span>
            </div>

            <div>
              {(() => {
                const filtered = callbackNumbers.filter(cb => 
                  !callbackSearch || (cb.company_name || '').toLowerCase().includes(callbackSearch.toLowerCase())
                );

                const grouped = filtered.reduce((acc: Record<string, { companyName: string; companyCode: string; items: any[] }>, cb: any) => {
                  const cid = cb.company_id || 'none';
                  if (!acc[cid]) {
                    acc[cid] = { companyName: cb.company_name || '미지정', companyCode: cb.company_code || '', items: [] };
                  }
                  acc[cid].items.push(cb);
                  return acc;
                }, {});

                const companyIds = Object.keys(grouped);

                if (filtered.length === 0) {
                  return (
                    <div className="px-6 py-12 text-center text-gray-500">
                      {callbackNumbers.length === 0 ? '등록된 발신번호가 없습니다.' : '검색 결과가 없습니다.'}
                    </div>
                  );
                }

                return (
                  <div className="divide-y">
                    {companyIds.map(cid => {
                      const group = grouped[cid];
                      const isExpanded = expandedCallbackCompanies.has(cid);
                      return (
                        <div key={cid}>
                          <button
                            onClick={() => {
                              const newSet = new Set(expandedCallbackCompanies);
                              if (isExpanded) newSet.delete(cid); else newSet.add(cid);
                              setExpandedCallbackCompanies(newSet);
                            }}
                            className="w-full px-6 py-3 bg-gray-50 hover:bg-gray-100 flex items-center justify-between transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <span className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                              <span className="font-semibold text-gray-800">{group.companyName}</span>
                              <span className="text-xs text-gray-400">({group.companyCode})</span>
                              <span className="text-sm text-gray-500">{group.items.length}개</span>
                            </div>
                          </button>
                          {isExpanded && (
                            <table className="w-full text-sm">
                              <thead className="bg-gray-50/50">
                                <tr>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">발신번호</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">별칭</th>
                                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">대표</th>
                                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">등록일</th>
                                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">관리</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {group.items.map((cb: any) => (
                                  <tr key={cb.id} className="hover:bg-blue-50/30">
                                    <td className="px-4 py-2.5 font-medium text-gray-900">{cb.phone}</td>
                                    <td className="px-4 py-2.5 text-gray-500">{cb.label || '-'}</td>
                                    <td className="px-4 py-2.5 text-center">
                                      {cb.is_default ? (
                                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">대표</span>
                                      ) : (
                                        <button onClick={() => handleSetDefault(cb.id)} className="text-blue-600 hover:text-blue-800 text-xs">대표설정</button>
                                      )}
                                    </td>
                                    <td className="px-4 py-2.5 text-center text-gray-500">{formatDate(cb.created_at)}</td>
                                    <td className="px-4 py-2.5 text-center">
                                      <button onClick={() => setEditingCallback({ id: cb.id, phone: cb.phone, label: cb.label || '' })} className="text-blue-600 hover:text-blue-800 text-sm mr-2">수정</button>
                                      <button onClick={() => handleDeleteCallback(cb.id, cb.phone)} className="text-red-600 hover:text-red-800 text-sm">삭제</button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            </div>
        )}

        {/* 요금제 관리 탭 */}
        {activeTab === 'plans' && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h2 className="text-lg font-semibold">요금제 관리</h2>
              <button
                onClick={() => setShowPlanModal(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                + 요금제 추가
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">코드</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">요금제명</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">최대 고객수</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">월 요금</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">사용 회사</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">상태</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {planList.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                        등록된 요금제가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    planList
                      .slice((planPage - 1) * planPerPage, planPage * planPerPage)
                      .map((plan) => (
                      <tr key={plan.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{plan.plan_code}</td>
                        <td className="px-4 py-3 text-gray-900">{plan.plan_name}</td>
                        <td className="px-4 py-3 text-center text-gray-600 whitespace-nowrap">
                          {plan.max_customers.toLocaleString()}명
                        </td>
                        <td className="px-4 py-3 text-center text-gray-900 whitespace-nowrap font-medium">
                          {Number(plan.monthly_price).toLocaleString()}원
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-blue-600 font-medium">{plan.company_count || 0}개</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {plan.is_active ? (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">활성</span>
                          ) : (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">비활성</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex justify-center gap-2">
                            <button
                              onClick={() => setEditingPlan({ ...plan })}
                              className="text-blue-600 hover:text-blue-800 text-sm"
                            >
                              수정
                            </button>
                            <button
                              onClick={() => handleDeletePlan(plan.id, plan.plan_name)}
                              className="text-red-600 hover:text-red-800 text-sm"
                            >
                              삭제
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                </table>
            </div>
            {planList.length > planPerPage && (
              <div className="px-6 py-4 border-t flex items-center justify-between">
                <span className="text-sm text-gray-500">
                  총 {planList.length}개 중 {(planPage - 1) * planPerPage + 1}-{Math.min(planPage * planPerPage, planList.length)}
                </span>
                <div className="flex gap-1">
                  <button onClick={() => setPlanPage(p => Math.max(1, p - 1))} disabled={planPage === 1}
                    className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50">◀ 이전</button>
                  {Array.from({ length: Math.ceil(planList.length / planPerPage) }, (_, i) => i + 1).map(p => (
                    <button key={p} onClick={() => setPlanPage(p)}
                      className={`px-3 py-1 rounded border text-sm ${planPage === p ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'}`}>{p}</button>
                  ))}
                  <button onClick={() => setPlanPage(p => Math.min(Math.ceil(planList.length / planPerPage), p + 1))}
                    disabled={planPage >= Math.ceil(planList.length / planPerPage)}
                    className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50">다음 ▶</button>
                </div>
              </div>
            )}
            </div>
        )}

        {/* 플랜 신청 관리 탭 */}
        {activeTab === 'requests' && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">플랜 변경 신청 목록</h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">신청일시</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">회사</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">신청자</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">현재 플랜</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">신청 플랜</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">메시지</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">상태</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">처리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {planRequests.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                        플랜 변경 신청이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    planRequests
                      .slice((requestPage - 1) * requestPerPage, requestPage * requestPerPage)
                      .map((req) => (
                      <tr key={req.id} className={`hover:bg-gray-50 ${req.status === 'pending' ? 'bg-yellow-50' : ''}`}>
                        <td className="px-4 py-3 text-center text-gray-600 whitespace-nowrap">
                          {formatDateTime(req.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{req.company_name}</div>
                          <div className="text-xs text-gray-500">{req.company_code}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-900">
                          {req.user_name} ({req.user_login_id})
                        </td>
                        <td className="px-4 py-3 text-center text-gray-600 whitespace-nowrap">
                          {req.current_plan_name || '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="font-medium text-blue-600">{req.requested_plan_name}</span>
                          <div className="text-xs text-gray-500">
                            {Number(req.requested_plan_price).toLocaleString()}원/월
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate" title={req.message}>
                          {req.message || '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {req.status === 'pending' && (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">대기</span>
                          )}
                          {req.status === 'approved' && (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">승인</span>
                          )}
                          {req.status === 'rejected' && (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">거절</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {req.status === 'pending' ? (
                            <div className="flex justify-center gap-2">
                              <button
                                onClick={() => handleApproveRequest(req.id)}
                                className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                              >
                                승인
                              </button>
                              <button
                                onClick={() => {
                                  setRejectTarget(req);
                                  setRejectReason('');
                                  setShowRejectModal(true);
                                }}
                                className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                              >
                                거절
                              </button>
                            </div>
                          ) : (
                            <div className="text-xs text-gray-500">
                              <div>{req.processed_by_name || '-'}</div>
                              {req.processed_at && (
                                <div>{formatDate(req.processed_at)}</div>
                              )}
                              {req.admin_note && (
                                <div className="text-red-600 mt-1" title={req.admin_note}>
                                  {req.admin_note.length > 10 ? req.admin_note.slice(0, 10) + '...' : req.admin_note}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                </table>
            </div>
            {planRequests.length > requestPerPage && (
              <div className="px-6 py-4 border-t flex items-center justify-between">
                <span className="text-sm text-gray-500">
                  총 {planRequests.length}개 중 {(requestPage - 1) * requestPerPage + 1}-{Math.min(requestPage * requestPerPage, planRequests.length)}
                </span>
                <div className="flex gap-1">
                  <button onClick={() => setRequestPage(p => Math.max(1, p - 1))} disabled={requestPage === 1}
                    className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50">◀ 이전</button>
                  {Array.from({ length: Math.ceil(planRequests.length / requestPerPage) }, (_, i) => i + 1).map(p => (
                    <button key={p} onClick={() => setRequestPage(p)}
                      className={`px-3 py-1 rounded border text-sm ${requestPage === p ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'}`}>{p}</button>
                  ))}
                  <button onClick={() => setRequestPage(p => Math.min(Math.ceil(planRequests.length / requestPerPage), p + 1))}
                    disabled={requestPage >= Math.ceil(planRequests.length / requestPerPage)}
                    className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50">다음 ▶</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 충전 관리 탭 */}
        {activeTab === 'deposits' && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b flex flex-wrap justify-between items-center gap-3">
              <h2 className="text-lg font-semibold">충전 관리</h2>
              <div className="flex gap-2">
                <select
                  value={depositMethodFilter}
                  onChange={(e) => setDepositMethodFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="all">전체 결제수단</option>
                  <option value="deposit">무통장입금</option>
                  <option value="card">카드결제</option>
                  <option value="virtual_account">가상계좌</option>
                </select>
                <select
                  value={depositStatusFilter}
                  onChange={(e) => setDepositStatusFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="all">전체 상태</option>
                  <option value="pending">대기</option>
                  <option value="confirmed">승인</option>
                  <option value="rejected">거절</option>
                </select>
                <button
                  onClick={() => loadDepositRequests(1)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
                >
                  새로고침
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">요청일</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">회사</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">결제수단</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 whitespace-nowrap">금액</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">입금자명</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">상태</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">처리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {depositLoading ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-500">불러오는 중...</td>
                    </tr>
                  ) : depositRequests.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-500">충전 요청이 없습니다.</td>
                    </tr>
                  ) : (
                    depositRequests.map((dr) => (
                      <tr key={dr.id} className={`hover:bg-gray-50 ${dr.status === 'pending' ? 'bg-yellow-50' : ''}`}>
                        <td className="px-4 py-3 text-center text-gray-600 whitespace-nowrap">
                          {formatDateTime(dr.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{dr.company_name}</div>
                          <div className="text-xs text-gray-500">잔액: {Number(dr.balance || 0).toLocaleString()}원</div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {dr.payment_method === 'deposit' && (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">무통장입금</span>
                          )}
                          {dr.payment_method === 'card' && (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">카드결제</span>
                          )}
                          {dr.payment_method === 'virtual_account' && (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">가상계좌</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-gray-900 whitespace-nowrap">
                          {Number(dr.amount).toLocaleString()}원
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {dr.depositor_name || '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {dr.status === 'pending' && (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">대기</span>
                          )}
                          {dr.status === 'confirmed' && (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">승인</span>
                          )}
                          {dr.status === 'rejected' && (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">거절</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {dr.status === 'pending' ? (
                            <div className="flex justify-center gap-2">
                              <button
                                onClick={() => {
                                  setDepositTarget(dr);
                                  setDepositAdminNote('');
                                  setShowDepositApproveModal(true);
                                }}
                                className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                              >
                                승인
                              </button>
                              <button
                                onClick={() => {
                                  setDepositTarget(dr);
                                  setDepositAdminNote('');
                                  setShowDepositRejectModal(true);
                                }}
                                className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                              >
                                거절
                              </button>
                            </div>
                          ) : (
                            <div className="text-xs text-gray-500">
                              <div>{dr.confirmed_by_name || '-'}</div>
                              {dr.confirmed_at && (
                                <div>{formatDate(dr.confirmed_at)}</div>
                              )}
                              {dr.admin_note && (
                                <div className="text-gray-600 mt-1" title={dr.admin_note}>
                                  {dr.admin_note.length > 15 ? dr.admin_note.slice(0, 15) + '...' : dr.admin_note}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {depositTotal > depositPerPage && (
              <div className="px-6 py-4 border-t flex items-center justify-between">
                <span className="text-sm text-gray-500">
                  총 {depositTotal}건 중 {(depositPage - 1) * depositPerPage + 1}-{Math.min(depositPage * depositPerPage, depositTotal)}
                </span>
                <div className="flex gap-1">
                  <button onClick={() => loadDepositRequests(depositPage - 1)} disabled={depositPage === 1}
                    className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50">◀ 이전</button>
                  {Array.from({ length: Math.ceil(depositTotal / depositPerPage) }, (_, i) => i + 1).map(p => (
                    <button key={p} onClick={() => loadDepositRequests(p)}
                      className={`px-3 py-1 rounded border text-sm ${depositPage === p ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'}`}>{p}</button>
                  ))}
                  <button onClick={() => loadDepositRequests(depositPage + 1)}
                    disabled={depositPage >= Math.ceil(depositTotal / depositPerPage)}
                    className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50">다음 ▶</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 전체 캠페인 탭 */}
        {activeTab === 'allCampaigns' && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b">
              <div className="flex flex-wrap gap-3 items-center">
                <input
                  type="text"
                  placeholder="캠페인명 / 회사명 검색"
                  value={allCampaignsSearch}
                  onChange={(e) => setAllCampaignsSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadAllCampaigns(1)}
                  className="px-3 py-2 border rounded-lg text-sm w-60"
                />
                <select
                  value={allCampaignsStatus}
                  onChange={(e) => { setAllCampaignsStatus(e.target.value); }}
                  className="px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="">전체 상태</option>
                  <option value="draft">임시저장</option>
                  <option value="scheduled">예약</option>
                  <option value="completed">완료</option>
                  <option value="cancelled">취소</option>
                </select>
                <select
                  value={allCampaignsCompany}
                  onChange={(e) => { setAllCampaignsCompany(e.target.value); }}
                  className="px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="">전체 회사</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.company_name}</option>
                  ))}
                </select>
                <button
                  onClick={() => loadAllCampaigns(1)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                >
                  검색
                </button>
                <button
                  onClick={() => { setAllCampaignsSearch(''); setAllCampaignsStatus(''); setAllCampaignsCompany(''); setTimeout(() => loadAllCampaigns(1), 0); }}
                  className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                >
                  초기화
                </button>
                <span className="text-sm text-gray-500 ml-auto">총 {allCampaignsTotal}건</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-gray-600 font-medium">회사</th>
                    <th className="px-4 py-3 text-left text-gray-600 font-medium">캠페인명</th>
                    <th className="px-4 py-3 text-center text-gray-600 font-medium">유형</th>
                    <th className="px-4 py-3 text-center text-gray-600 font-medium">상태</th>
                    <th className="px-4 py-3 text-center text-gray-600 font-medium">대상</th>
                    <th className="px-4 py-3 text-center text-gray-600 font-medium">발송</th>
                    <th className="px-4 py-3 text-center text-gray-600 font-medium">성공</th>
                    <th className="px-4 py-3 text-center text-gray-600 font-medium">실패</th>
                    <th className="px-4 py-3 text-center text-gray-600 font-medium">발송일</th>
                    <th className="px-4 py-3 text-center text-gray-600 font-medium">생성일</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {allCampaigns.length === 0 ? (
                    <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">캠페인이 없습니다.</td></tr>
                  ) : allCampaigns.map((c: any) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700">{c.company_name || '-'}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          c.campaign_type === 'ai' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'
                        }`}>
                          {c.campaign_type === 'ai' ? 'AI' : '수동'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          c.status === 'completed' ? 'bg-green-100 text-green-700' :
                          c.status === 'scheduled' ? 'bg-amber-100 text-amber-700' :
                          c.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {c.status === 'completed' ? '완료' : c.status === 'scheduled' ? '예약' : c.status === 'cancelled' ? '취소' : c.status === 'draft' ? '임시' : c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-700">{(c.last_target_count || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-center text-gray-700">{(parseInt(c.total_sent) || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-center text-green-600 font-medium">{(parseInt(c.total_success) || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-center text-red-600">{(parseInt(c.total_fail) || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-center text-gray-500 text-xs">
                        {c.last_sent_at ? formatDateTimeShort(c.last_sent_at) : '-'}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-500 text-xs">
                        {formatDate(c.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 페이징 */}
            {allCampaignsTotal > 10 && (
              <div className="px-6 py-4 border-t flex justify-center gap-2">
                {Array.from({ length: Math.ceil(allCampaignsTotal / 10) }, (_, i) => i + 1).slice(
                  Math.max(0, allCampaignsPage - 3), Math.min(Math.ceil(allCampaignsTotal / 10), allCampaignsPage + 2)
                ).map(p => (
                  <button
                    key={p}
                    onClick={() => loadAllCampaigns(p)}
                    className={`w-8 h-8 rounded text-sm ${p === allCampaignsPage ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 발송 통계 탭 */}
        {activeTab === 'stats' && (
          <div className="space-y-4">
            {/* 요약 바 (얇게) */}
            {sendStats?.summary && (() => {
              const sent = Number(sendStats.summary.total_sent);
              const success = Number(sendStats.summary.total_success);
              const fail = Number(sendStats.summary.total_fail);
              const pending = sent - success - fail;
              const rate = sent > 0 ? (success / sent * 100).toFixed(1) : '0.0';
              return (
                <div className="bg-white rounded-lg shadow px-6 py-3 flex items-center gap-8 text-sm">
                  <span className="text-gray-500">조회 기간 합계</span>
                  <span className="font-semibold text-blue-600">전송 {sent.toLocaleString()}</span>
                  <span className="font-semibold text-green-600">성공 {success.toLocaleString()}</span>
                  <span className="font-semibold text-red-600">실패 {fail.toLocaleString()}</span>
                  <span className="font-semibold text-amber-600">대기 {pending.toLocaleString()}</span>
                  <span className="font-semibold text-gray-700">성공률 {rate}%</span>
                </div>
              );
            })()}
           
            {/* 필터 영역 */}
            <div className="bg-white rounded-lg shadow px-6 py-4 flex flex-wrap gap-3 items-center">
              <div className="flex bg-gray-100 rounded-lg p-1">
                {([['daily', '일별'], ['monthly', '월별']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => { setStatsView(key); setTimeout(() => loadSendStats(1), 0); }}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      statsView === key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <input
                  type="date"
                  value={statsStartDate}
                  onChange={(e) => setStatsStartDate(e.target.value)}
                  className="px-3 py-1.5 border rounded-lg text-sm"
                />
                <span className="text-gray-400">~</span>
                <input
                  type="date"
                  value={statsEndDate}
                  onChange={(e) => setStatsEndDate(e.target.value)}
                  className="px-3 py-1.5 border rounded-lg text-sm"
                />
              </div>
              <select
                value={statsCompanyFilter}
                onChange={(e) => setStatsCompanyFilter(e.target.value)}
                className="px-3 py-1.5 border rounded-lg text-sm"
              >
                <option value="">전체 고객사</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.company_name}</option>
                ))}
              </select>
              <button
                onClick={() => loadSendStats(1)}
                className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
              >
                조회
              </button>
              <span className="text-sm text-gray-400 ml-auto">총 {statsTotal}건</span>
            </div>

            {/* 테이블 */}
            <div className="bg-white rounded-lg shadow">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                  <tr>
                      <th className="px-4 py-3 text-left text-gray-600 font-medium">{statsView === 'daily' ? '날짜' : '월'}</th>
                      <th className="px-4 py-3 text-left text-gray-600 font-medium">고객사</th>
                      <th className="px-4 py-3 text-center text-gray-600 font-medium">전송</th>
                      <th className="px-4 py-3 text-center text-gray-600 font-medium">성공</th>
                      <th className="px-4 py-3 text-center text-gray-600 font-medium">실패</th>
                      <th className="px-4 py-3 text-center text-gray-600 font-medium">대기</th>
                      <th className="px-4 py-3 text-center text-gray-600 font-medium">성공률</th>
                      <th className="px-4 py-3 text-center text-gray-600 font-medium">기타</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {!sendStats?.rows?.length ? (
                      <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">데이터가 없습니다.</td></tr>
                    ) : sendStats.rows.map((row: any, idx: number) => {
                      const sent = Number(row.sent);
                      const success = Number(row.success);
                      const fail = Number(row.fail);
                      const pending = sent - success - fail;
                      const rate = sent > 0 ? (success / sent * 100).toFixed(1) : '-';
                      return (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900 font-mono">{row.date || row.month}</td>
                          <td className="px-4 py-3 text-gray-700">{row.company_name}</td>
                          <td className="px-4 py-3 text-center text-blue-600 font-medium">{sent.toLocaleString()}</td>
                          <td className="px-4 py-3 text-center text-green-600">{success.toLocaleString()}</td>
                          <td className="px-4 py-3 text-center text-red-600">{fail.toLocaleString()}</td>
                          <td className="px-4 py-3 text-center text-amber-600">{pending > 0 ? pending.toLocaleString() : '0'}</td>
                          <td className="px-4 py-3 text-center font-medium">{rate}%</td>
                          <td className="px-4 py-3 text-center">
                          <button
                              onClick={() => loadStatsDetail(row.date || row.month, row.company_id, row.company_name)}
                              className="text-blue-500 hover:text-blue-700 text-xs underline"
                            >
                              상세
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 페이징 */}
              {statsTotal > 10 && (
                <div className="px-6 py-4 border-t flex justify-center gap-2">
                  {Array.from({ length: Math.ceil(statsTotal / 10) }, (_, i) => i + 1).slice(
                    Math.max(0, statsPage - 3), Math.min(Math.ceil(statsTotal / 10), statsPage + 2)
                  ).map(p => (
                    <button
                      key={p}
                      onClick={() => loadSendStats(p)}
                      className={`w-8 h-8 rounded text-sm ${p === statsPage ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {!sendStats && (
              <div className="text-center py-12 text-gray-400">통계 데이터를 불러오는 중...</div>
            )}
          </div>
        )}

      {/* 고객사 추가 모달 */}
      {showCompanyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b">
              <h3 className="text-lg font-semibold">새 고객사 추가</h3>
            </div>
            <form onSubmit={handleCreateCompany} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  고객사 코드 *
                </label>
                <input
                  type="text"
                  value={newCompany.companyCode}
                  onChange={(e) => setNewCompany({ ...newCompany, companyCode: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="예: ABC001"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  회사명 *
                </label>
                <input
                  type="text"
                  value={newCompany.companyName}
                  onChange={(e) => setNewCompany({ ...newCompany, companyName: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="예: ABC 주식회사"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  담당자명
                </label>
                <input
                  type="text"
                  value={newCompany.contactName}
                  onChange={(e) => setNewCompany({ ...newCompany, contactName: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  이메일
                </label>
                <input
                  type="email"
                  value={newCompany.contactEmail}
                  onChange={(e) => setNewCompany({ ...newCompany, contactEmail: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  요금제 *
                </label>
                <select
                  value={newCompany.planId}
                  onChange={(e) => setNewCompany({ ...newCompany, planId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                >
                  <option value="">선택하세요</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.plan_name} ({plan.max_customers.toLocaleString()}명)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  담당 분류 코드
                </label>
                {(() => {
                  const selectedCompany = companies.find(c => c.id === newUser.companyId);
                  const storeList = (selectedCompany as any)?.store_code_list || [];
                  
                  if (!newUser.companyId) {
                    return <p className="text-xs text-gray-400">먼저 소속 회사를 선택하세요</p>;
                  }
                  if (storeList.length === 0) {
                    return <p className="text-xs text-gray-400">이 회사는 분류 코드가 없습니다 (전체 접근)</p>;
                  }
                  
                  return (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {storeList.map((code: string) => {
                        const selected = newUser.storeCodes.split(',').map(s => s.trim()).filter(Boolean);
                        const isChecked = selected.includes(code);
                        return (
                          <label key={code} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm cursor-pointer border transition-colors ${isChecked ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const newSelected = e.target.checked
                                  ? [...selected, code]
                                  : selected.filter(s => s !== code);
                                setNewUser({ ...newUser, storeCodes: newSelected.join(', ') });
                              }}
                              className="sr-only"
                            />
                            {code}
                          </label>
                        );
                      })}
                    </div>
                  );
                })()}
                <p className="text-xs text-gray-500 mt-2">비워두면 전체 고객 조회 가능</p>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCompanyModal(false)}
                  className="flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  추가
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 사용자 추가 모달 */}
      {showUserModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b">
              <h3 className="text-lg font-semibold">새 사용자 추가</h3>
            </div>
            <form onSubmit={handleCreateUser} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  소속 회사 *
                </label>
                <select
                  value={newUser.companyId}
                  onChange={(e) => setNewUser({ ...newUser, companyId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                >
                  <option value="">선택하세요</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.company_name} ({company.company_code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  로그인 ID *
                </label>
                <input
                  type="text"
                  value={newUser.loginId}
                  onChange={(e) => setNewUser({ ...newUser, loginId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="영문, 숫자 조합"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  초기 비밀번호 *
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="8자 이상"
                    required
                  />
                  <button
                    type="button"
                    onClick={generateTempPassword}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
                  >
                    자동생성
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  이름 *
                </label>
                <input
                  type="text"
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  이메일
                </label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  연락처
                </label>
                <input
                  type="text"
                  value={newUser.phone}
                  onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="010-0000-0000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  부서
                </label>
                <input
                  type="text"
                  value={newUser.department}
                  onChange={(e) => setNewUser({ ...newUser, department: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  권한 *
                </label>
                <select
                  value={newUser.userType}
                  onChange={(e) => setNewUser({ ...newUser, userType: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="user">일반 사용자</option>
                  <option value="admin">회사 관리자</option>
                  </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  담당 분류 코드
                </label>
                {(() => {
                  const selectedCompany = companies.find(c => c.id === newUser.companyId);
                  const storeList = (selectedCompany as any)?.store_code_list || [];
                  
                  if (!newUser.companyId) {
                    return <p className="text-xs text-gray-400 py-2">먼저 소속 회사를 선택하세요</p>;
                  }
                  if (storeList.length === 0) {
                    return <p className="text-xs text-gray-400 py-2">이 회사는 분류 코드가 없습니다 (전체 접근)</p>;
                  }
                  
                  return (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {storeList.map((code: string) => {
                        const selected = newUser.storeCodes.split(',').map(s => s.trim()).filter(Boolean);
                        const isChecked = selected.includes(code);
                        return (
                          <label key={code} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm cursor-pointer border transition-colors ${isChecked ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const newSelected = e.target.checked
                                  ? [...selected, code]
                                  : selected.filter(s => s !== code);
                                setNewUser({ ...newUser, storeCodes: newSelected.join(', ') });
                              }}
                              className="sr-only"
                            />
                            {code}
                          </label>
                        );
                      })}
                    </div>
                  );
                })()}
                <p className="text-xs text-gray-500 mt-2">비워두면 전체 고객 조회 가능</p>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowUserModal(false)}
                  className="flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  추가
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 사용자 수정 모달 */}
      {editingUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
              <h3 className="text-lg font-semibold text-gray-800">✏️ 사용자 수정</h3>
            </div>
            <form onSubmit={handleUpdateUser} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">로그인 ID</label>
                <input
                  type="text"
                  value={editingUser.login_id}
                  disabled
                  className="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이름 *</label>
                <input
                  type="text"
                  value={editingUser.name}
                  onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
                <input
                  type="email"
                  value={editingUser.email || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">연락처</label>
                <input
                  type="text"
                  value={editingUser.phone || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">부서</label>
                <input
                  type="text"
                  value={editingUser.department || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, department: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">권한</label>
                <select
                  value={editingUser.user_type}
                  onChange={(e) => setEditingUser({ ...editingUser, user_type: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="user">일반 사용자</option>
                  <option value="admin">회사 관리자</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">담당 분류 코드</label>
                {(() => {
                  const selectedCompany = companies.find(c => c.id === editingUser.company_id);
                  const storeList = (selectedCompany as any)?.store_code_list || [];
                  
                  if (storeList.length === 0) {
                    return <p className="text-xs text-gray-400">이 회사는 분류 코드가 없습니다 (전체 접근)</p>;
                  }
                  
                  return (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {storeList.map((code: string) => {
                        const selected = (editingUser.storeCodes || '').split(',').map((s: string) => s.trim()).filter(Boolean);
                        const isChecked = selected.includes(code);
                        return (
                          <label key={code} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm cursor-pointer border transition-colors ${isChecked ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const newSelected = e.target.checked
                                  ? [...selected, code]
                                  : selected.filter((s: string) => s !== code);
                                setEditingUser({ ...editingUser, storeCodes: newSelected.join(', ') });
                              }}
                              className="sr-only"
                            />
                            {code}
                          </label>
                        );
                      })}
                    </div>
                  );
                })()}
                <p className="text-xs text-gray-500 mt-2">비워두면 전체 고객 조회 가능</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">상태</label>
                <select
                  value={editingUser.status}
                  onChange={(e) => setEditingUser({ ...editingUser, status: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="active">활성</option>
                  <option value="locked">잠금</option>
                  <option value="dormant">휴면</option>
                  </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 고객사 수정 모달 */}
      {showEditCompanyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className={`bg-white rounded-lg shadow-xl w-full ${editCompanyTab === 'customers' ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] flex flex-col transition-all`}>
            <div className="px-6 py-4 border-b">
              <h3 className="text-lg font-semibold">고객사 상세 설정</h3>
              <p className="text-xs text-gray-500 mt-1">{editCompany.companyName}</p>
            </div>
            
            {/* 탭 네비게이션 */}
            <div className="flex border-b px-2 bg-gray-50">
              {[
                { key: 'basic', label: '기본정보', icon: '🏢' },
                { key: 'send', label: '발송정책', icon: '📋' },
                { key: 'cost', label: '단가/요금', icon: '💰' },
                { key: 'ai', label: 'AI설정', icon: '🤖' },
                { key: 'store', label: '분류코드', icon: '🏷️' },
                { key: 'fields', label: '필터항목', icon: '🔍' },
                { key: 'customers', label: '고객DB', icon: '👥' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setEditCompanyTab(tab.key as any);
                    if (tab.key === 'customers') { setAdminCustSearch(''); loadAdminCustomers(1); }
                    if (tab.key === 'cost' && editCompany?.billingType === 'prepaid') { loadBalanceTx(editCompany.id); }
                  }}
                  className={`flex-1 px-2 py-3 text-xs font-medium border-b-2 transition-colors ${
                    editCompanyTab === tab.key
                      ? 'border-blue-600 text-blue-600 bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <span className="block text-base">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleUpdateCompany} className="flex-1 overflow-y-auto p-6">
              {/* 기본정보 탭 */}
              {editCompanyTab === 'basic' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">회사명 *</label>
                    <input type="text" value={editCompany.companyName}
                      onChange={(e) => setEditCompany({ ...editCompany, companyName: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">사업자번호</label>
                    <input type="text" value={editCompany.businessNumber}
                      onChange={(e) => setEditCompany({ ...editCompany, businessNumber: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="000-00-00000" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">대표자</label>
                    <input type="text" value={editCompany.ceoName}
                      onChange={(e) => setEditCompany({ ...editCompany, ceoName: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">업태</label>
                      <input type="text" value={editCompany.businessType}
                        onChange={(e) => setEditCompany({ ...editCompany, businessType: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="도소매업" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">종목</label>
                      <input type="text" value={editCompany.businessItem}
                        onChange={(e) => setEditCompany({ ...editCompany, businessItem: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="화장품" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">주소</label>
                    <input type="text" value={editCompany.address}
                      onChange={(e) => setEditCompany({ ...editCompany, address: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="서울시 강남구..." />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">담당자명</label>
                    <input type="text" value={editCompany.contactName}
                      onChange={(e) => setEditCompany({ ...editCompany, contactName: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
                    <input type="email" value={editCompany.contactEmail}
                      onChange={(e) => setEditCompany({ ...editCompany, contactEmail: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">연락처</label>
                    <input type="text" value={editCompany.contactPhone}
                      onChange={(e) => setEditCompany({ ...editCompany, contactPhone: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="010-0000-0000" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">요금제 *</label>
                    <select value={editCompany.planId}
                      onChange={(e) => setEditCompany({ ...editCompany, planId: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required>
                      <option value="">선택하세요</option>
                      {plans.map((plan) => (
                        <option key={plan.id} value={plan.id}>{plan.plan_name} ({plan.max_customers.toLocaleString()}명)</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">상태 *</label>
                    <select value={editCompany.status}
                      onChange={(e) => setEditCompany({ ...editCompany, status: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                      <option value="trial">체험</option>
                      <option value="active">활성</option>
                      <option value="suspended">정지</option>
                      <option value="terminated">해지</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">최대 사용자 수</label>
                    <div className="flex items-center gap-2">
                      <input type="number" value={editCompany.maxUsers}
                        onChange={(e) => setEditCompany({ ...editCompany, maxUsers: Math.max(1, Number(e.target.value)) })}
                        className="w-24 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" min={1} />
                      <span className="text-sm text-gray-500">명</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">고객사 관리자가 생성할 수 있는 최대 사용자 계정 수</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">세션 타임아웃</label>
                    <div className="flex items-center gap-2">
                      <input type="number" value={editCompany.sessionTimeoutMinutes}
                        onChange={(e) => setEditCompany({ ...editCompany, sessionTimeoutMinutes: Math.min(480, Math.max(5, Number(e.target.value))) })}
                        className="w-24 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" min={5} max={480} />
                      <span className="text-sm text-gray-500">분</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">비활동 시 자동 로그아웃 시간 (5~480분)</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">080 수신거부번호</label>
                    <input type="text" value={editCompany.rejectNumber}
                      onChange={(e) => setEditCompany({ ...editCompany, rejectNumber: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="080-000-0000" />
                  </div>
                </div>
              )}

              {/* 발송정책 탭 */}
              {editCompanyTab === 'send' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">발송 시작 시간</label>
                      <select value={editCompany.sendHourStart}
                        onChange={(e) => setEditCompany({ ...editCompany, sendHourStart: Number(e.target.value) })}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">발송 종료 시간</label>
                      <select value={editCompany.sendHourEnd}
                        onChange={(e) => setEditCompany({ ...editCompany, sendHourEnd: Number(e.target.value) })}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">일일 발송 한도 (0 = 무제한)</label>
                    <input type="number" value={editCompany.dailyLimit}
                      onChange={(e) => setEditCompany({ ...editCompany, dailyLimit: Number(e.target.value) })}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" min="0" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">중복 발송 방지 기간 (일)</label>
                    <input type="number" value={editCompany.duplicateDays}
                      onChange={(e) => setEditCompany({ ...editCompany, duplicateDays: Number(e.target.value) })}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" min="0" />
                  </div>
                                    <div className="flex items-center gap-2">
                    <input type="checkbox" id="approvalRequired" checked={editCompany.approvalRequired}
                      onChange={(e) => setEditCompany({ ...editCompany, approvalRequired: e.target.checked })}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" />
                    <label htmlFor="approvalRequired" className="text-sm text-gray-700">발송 전 승인 필요</label>
                    </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="allowCallbackSelfRegister" checked={editCompany.allowCallbackSelfRegister}
                      onChange={(e) => setEditCompany({ ...editCompany, allowCallbackSelfRegister: e.target.checked })}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" />
                    <label htmlFor="allowCallbackSelfRegister" className="text-sm text-gray-700">발신번호 자체 등록 허용</label>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 mt-2">
                    <p className="text-xs text-blue-700">
                      💡 발송 시간은 한국 시간(KST) 기준이며, 광고성 메시지는 08:00~21:00 사이에만 발송할 수 있습니다.
                    </p>
                  </div>
                </div>
              )}

              {/* 단가/요금 탭 */}
              {editCompanyTab === 'cost' && (
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
                          className={`px-4 py-2 text-xs font-medium transition-colors ${editCompany.billingType === 'postpaid' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
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
                          className={`px-4 py-2 text-xs font-medium transition-colors ${editCompany.billingType === 'prepaid' ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                        >선불</button>
                      </div>
                    </div>
                  </div>

                  {/* 선불 잔액 관리 (선불일 때만) */}
                  {editCompany.billingType === 'prepaid' && (
                    <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl p-4 border border-emerald-200">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm font-bold text-gray-800">💰 충전 잔액</div>
                        <div className={`text-xl font-bold ${editCompany.balance < 10000 ? 'text-red-600' : 'text-emerald-700'}`}>
                          {editCompany.balance.toLocaleString()}원
                        </div>
                      </div>
                      <div className="flex gap-2 mb-3">
                        <button type="button" onClick={() => setEditCompany({ ...editCompany, balanceAdjustType: 'charge' })}
                          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${editCompany.balanceAdjustType === 'charge' ? 'bg-emerald-600 text-white' : 'bg-white border text-gray-600'}`}
                        >충전</button>
                        <button type="button" onClick={() => setEditCompany({ ...editCompany, balanceAdjustType: 'deduct' })}
                          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${editCompany.balanceAdjustType === 'deduct' ? 'bg-red-600 text-white' : 'bg-white border text-gray-600'}`}
                        >차감</button>
                      </div>
                      <div className="space-y-2">
                        <input type="number" placeholder="금액 (원)" value={editCompany.balanceAdjustAmount}
                          onChange={(e) => setEditCompany({ ...editCompany, balanceAdjustAmount: e.target.value })}
                          className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
                        <input type="text" placeholder="사유 (필수)" value={editCompany.balanceAdjustReason}
                          onChange={(e) => setEditCompany({ ...editCompany, balanceAdjustReason: e.target.value })}
                          className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
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
                          className={`w-full py-2.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                            editCompany.balanceAdjustType === 'charge' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-red-600 hover:bg-red-700 text-white'
                          }`}
                        >{editCompany.balanceAdjusting ? '처리 중...' : editCompany.balanceAdjustType === 'charge' ? '충전하기' : '차감하기'}</button>
                      </div>

                      {/* 잔액 변동 이력 */}
                      <div className="mt-3 pt-3 border-t border-emerald-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold text-gray-700">📊 최근 변동 이력</span>
                          <button type="button" onClick={() => loadBalanceTx(editCompany.id)}
                            className="text-[10px] text-emerald-600 hover:underline">새로고침</button>
                        </div>
                        {balanceTxLoading ? (
                          <div className="text-xs text-gray-400 text-center py-2">불러오는 중...</div>
                        ) : balanceTxList.length === 0 ? (
                          <div className="text-xs text-gray-400 text-center py-2">
                            변동 이력이 없습니다.
                            <button type="button" onClick={() => loadBalanceTx(editCompany.id)} className="ml-1 text-emerald-600 hover:underline">조회</button>
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
                                      {typeLabels[tx.type] || tx.type}
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

                  <p className="text-sm text-gray-500">건당 단가를 설정합니다. (단위: 원)</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 rounded-lg p-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">SMS</label>
                      <div className="flex items-center gap-1">
                        <input type="number" step="0.1" value={editCompany.costPerSms}
                          onChange={(e) => setEditCompany({ ...editCompany, costPerSms: Number(e.target.value) })}
                          className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                        <span className="text-sm text-gray-500">원</span>
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">LMS</label>
                      <div className="flex items-center gap-1">
                        <input type="number" step="0.1" value={editCompany.costPerLms}
                          onChange={(e) => setEditCompany({ ...editCompany, costPerLms: Number(e.target.value) })}
                          className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                        <span className="text-sm text-gray-500">원</span>
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">MMS</label>
                      <div className="flex items-center gap-1">
                        <input type="number" step="0.1" value={editCompany.costPerMms}
                          onChange={(e) => setEditCompany({ ...editCompany, costPerMms: Number(e.target.value) })}
                          className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                        <span className="text-sm text-gray-500">원</span>
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">카카오</label>
                      <div className="flex items-center gap-1">
                        <input type="number" step="0.1" value={editCompany.costPerKakao}
                          onChange={(e) => setEditCompany({ ...editCompany, costPerKakao: Number(e.target.value) })}
                          className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                        <span className="text-sm text-gray-500">원</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* AI설정 탭 */}
              {editCompanyTab === 'ai' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">타겟 전략</label>
                    <select value={editCompany.targetStrategy}
                      onChange={(e) => setEditCompany({ ...editCompany, targetStrategy: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                      <option value="balanced">균형형 (Balanced)</option>
                      <option value="aggressive">공격형 (Aggressive) - 넓은 타겟</option>
                      <option value="conservative">보수형 (Conservative) - 정밀 타겟</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">AI가 타겟을 추출할 때 적용하는 전략입니다.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="crossCategory" checked={editCompany.crossCategoryAllowed}
                      onChange={(e) => setEditCompany({ ...editCompany, crossCategoryAllowed: e.target.checked })}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" />
                    <label htmlFor="crossCategory" className="text-sm text-gray-700">교차 카테고리 타겟 허용</label>
                  </div>
                  <p className="text-xs text-gray-500 -mt-2 ml-6">예: 스킨케어 구매자에게 색조 제품 추천</p>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">제외 세그먼트</label>
                    <p className="text-xs text-gray-500 mb-2">AI 타겟에서 항상 제외할 고객 그룹</p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {editCompany.excludedSegments.map((seg: string, idx: number) => (
                        <span key={idx} className="inline-flex items-center gap-1 px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm">
                          {seg}
                          <button type="button"
                            onClick={() => setEditCompany({
                              ...editCompany,
                              excludedSegments: editCompany.excludedSegments.filter((_: string, i: number) => i !== idx)
                            })}
                            className="text-red-600 hover:text-red-800 font-bold">×</button>
                        </span>
                      ))}
                      {editCompany.excludedSegments.length === 0 && (
                        <span className="text-gray-400 text-sm">제외 세그먼트 없음</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input type="text" value={editCompany.newExcludedSegment}
                        onChange={(e) => setEditCompany({ ...editCompany, newExcludedSegment: e.target.value })}
                        className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="예: 탈퇴요청, VIP제외, 휴면고객"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const seg = editCompany.newExcludedSegment.trim();
                            if (seg && !editCompany.excludedSegments.includes(seg)) {
                              setEditCompany({
                                ...editCompany,
                                excludedSegments: [...editCompany.excludedSegments, seg],
                                newExcludedSegment: ''
                              });
                            }
                          }
                        }} />
                      <button type="button"
                        onClick={() => {
                          const seg = editCompany.newExcludedSegment.trim();
                          if (seg && !editCompany.excludedSegments.includes(seg)) {
                            setEditCompany({
                              ...editCompany,
                              excludedSegments: [...editCompany.excludedSegments, seg],
                              newExcludedSegment: ''
                            });
                          }
                        }}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm">
                        추가
                      </button>
                    </div>
                  </div>

                  <div className="bg-purple-50 rounded-lg p-3 mt-2">
                    <p className="text-xs text-purple-700">
                      🤖 이 설정은 AI가 캠페인 타겟을 추출할 때 기본 조건으로 적용됩니다.
                    </p>
                  </div>
                </div>
              )}

              {/* 분류코드 탭 */}
              {editCompanyTab === 'store' && (
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
                          className="text-blue-600 hover:text-blue-800 font-bold">×</button>
                      </span>
                    ))}
                    {editCompany.storeCodeList.length === 0 && (
                      <span className="text-gray-400 text-sm">분류 코드 없음 (전체 공유)</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input type="text" value={editCompany.newStoreCode}
                      onChange={(e) => setEditCompany({ ...editCompany, newStoreCode: e.target.value.toUpperCase() })}
                      className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
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
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
                      추가
                    </button>
                  </div>
                </div>
              )}

              {/* 필터항목 탭 */}
              {editCompanyTab === 'fields' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-gray-600">이 고객사에서 사용할 필터 항목을 선택하세요.</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setEnabledFields(standardFields.map((f: any) => f.field_key))}
                        className="text-xs text-blue-600 hover:underline">전체선택</button>
                      <button type="button" onClick={() => setEnabledFields([])}
                        className="text-xs text-gray-500 hover:underline">전체해제</button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mb-3">선택: {enabledFields.length} / {standardFields.length}개</p>

                  {['basic', 'segment', 'purchase', 'loyalty', 'store', 'preference', 'marketing', 'custom'].map(cat => {
                    const catFields = standardFields.filter((f: any) => f.category === cat);
                    if (catFields.length === 0) return null;
                    const catLabels: Record<string, string> = {
                      basic: '기본정보', segment: '등급/세그먼트', purchase: '구매/거래',
                      loyalty: '충성도/활동', store: '소속/채널', preference: '선호/관심',
                      marketing: '마케팅수신', custom: '커스텀'
                    };
                    const allChecked = catFields.every((f: any) => enabledFields.includes(f.field_key));
                    return (
                      <div key={cat} className="border rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <input type="checkbox" checked={allChecked}
                            onChange={() => {
                              if (allChecked) {
                                setEnabledFields(enabledFields.filter(k => !catFields.some((f: any) => f.field_key === k)));
                              } else {
                                const newKeys = catFields.map((f: any) => f.field_key).filter((k: string) => !enabledFields.includes(k));
                                setEnabledFields([...enabledFields, ...newKeys]);
                              }
                            }}
                            className="w-4 h-4 text-blue-600 rounded" />
                          <span className="text-sm font-semibold text-gray-700">{catLabels[cat] || cat}</span>
                          <span className="text-xs text-gray-400">({catFields.filter((f: any) => enabledFields.includes(f.field_key)).length}/{catFields.length})</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1 ml-6">
  {catFields.map((field: any) => {
    const dc = fieldDataCheck[field.field_key];
    const hasData = dc?.hasData ?? false;
    const count = dc?.count ?? 0;
    return (
      <label key={field.field_key} className={`flex items-center gap-2 py-1 cursor-pointer rounded px-1 ${hasData ? 'hover:bg-gray-50' : 'opacity-50'}`}>
        <input type="checkbox"
          checked={enabledFields.includes(field.field_key)}
          onChange={() => {
            setEnabledFields(prev =>
              prev.includes(field.field_key)
                ? prev.filter(k => k !== field.field_key)
                : [...prev, field.field_key]
            );
          }}
          className="w-3.5 h-3.5 text-blue-600 rounded" />
        <span className={`text-xs ${hasData ? 'text-gray-700' : 'text-gray-400'}`}>{field.display_name}</span>
        <span className={`text-[10px] ${hasData ? 'text-green-600' : 'text-red-400'}`}>
          {hasData ? `🟢 ${count.toLocaleString()}건` : '🔴 0건'}
        </span>
      </label>
    );
  })}
</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 고객DB 탭 */}
              {editCompanyTab === 'customers' && (
                <div className="space-y-3">
                  {/* 상단: 검색 + 선택삭제 + 전체삭제 */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative flex-1 min-w-[180px]">
                      <input type="text" value={adminCustSearch}
                        onChange={(e) => setAdminCustSearch(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); loadAdminCustomers(1); } }}
                        placeholder="이름/전화번호 검색"
                        className="w-full pl-8 pr-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                      <svg className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <button type="button" onClick={() => loadAdminCustomers(1)}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">조회</button>
                    {adminCustSelected.size > 0 && (
                      <button type="button" onClick={() => { setAdminCustDeleteTarget({ type: 'bulk', count: adminCustSelected.size }); setShowAdminCustDeleteModal(true); }}
                        className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600">
                        선택 삭제 ({adminCustSelected.size})
                      </button>
                    )}
                    <span className="text-xs text-gray-500 ml-auto">총 {adminCustPage.total.toLocaleString()}명</span>
                  </div>

                  {/* 테이블 */}
                  <div className="border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto max-h-[340px] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b sticky top-0">
                          <tr>
                            <th className="px-2 py-2 text-center w-8">
                              <input type="checkbox"
                                checked={adminCustomers.length > 0 && adminCustSelected.size === adminCustomers.length}
                                onChange={() => {
                                  if (adminCustSelected.size === adminCustomers.length) setAdminCustSelected(new Set());
                                  else setAdminCustSelected(new Set(adminCustomers.map((c: any) => c.id)));
                                }}
                                className="rounded border-gray-300 text-blue-600" />
                            </th>
                            <th className="px-2 py-2 text-left font-medium text-gray-600">이름</th>
                            <th className="px-2 py-2 text-left font-medium text-gray-600">전화번호</th>
                            <th className="px-2 py-2 text-center font-medium text-gray-600">성별</th>
                            <th className="px-2 py-2 text-center font-medium text-gray-600">등급</th>
                            <th className="px-2 py-2 text-center font-medium text-gray-600">수신</th>
                            <th className="px-2 py-2 text-center font-medium text-gray-600 w-10"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {adminCustLoading ? (
                            <tr><td colSpan={7} className="text-center py-8 text-gray-400">불러오는 중...</td></tr>
                          ) : adminCustomers.length === 0 ? (
                            <tr><td colSpan={7} className="text-center py-8 text-gray-400">고객 데이터가 없습니다</td></tr>
                          ) : adminCustomers.map((c: any) => (
                            <tr key={c.id} className={`hover:bg-gray-50 ${adminCustSelected.has(c.id) ? 'bg-blue-50/50' : ''}`}>
                              <td className="px-2 py-1.5 text-center">
                                <input type="checkbox" checked={adminCustSelected.has(c.id)}
                                  onChange={() => { const s = new Set(adminCustSelected); s.has(c.id) ? s.delete(c.id) : s.add(c.id); setAdminCustSelected(s); }}
                                  className="rounded border-gray-300 text-blue-600" />
                              </td>
                              <td className="px-2 py-1.5 text-left font-medium text-gray-800">{c.name || '-'}</td>
                              <td className="px-2 py-1.5 text-left text-gray-600">{c.phone || '-'}</td>
                              <td className="px-2 py-1.5 text-center">{c.gender ? (['M','m','남','남자','male'].includes(c.gender) ? '남' : ['F','f','여','여자','female'].includes(c.gender) ? '여' : c.gender) : '-'}</td>
                              <td className="px-2 py-1.5 text-center">{c.grade || '-'}</td>
                              <td className="px-2 py-1.5 text-center">{c.sms_opt_in ? <span className="text-green-600">✓</span> : <span className="text-red-400">✗</span>}</td>
                              <td className="px-2 py-1.5 text-center">
                                <button type="button" onClick={() => { setAdminCustDeleteTarget({ type: 'individual', customer: c }); setShowAdminCustDeleteModal(true); }}
                                  className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition" title="삭제">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* 페이지네이션 */}
                    {adminCustPage.totalPages > 1 && (
                      <div className="flex items-center justify-between px-3 py-2 border-t bg-gray-50 text-xs">
                        <span className="text-gray-500">{adminCustPage.page} / {adminCustPage.totalPages} 페이지</span>
                        <div className="flex gap-1">
                          <button type="button" onClick={() => loadAdminCustomers(1)} disabled={adminCustPage.page === 1}
                            className="px-2 py-1 border rounded disabled:opacity-30 hover:bg-white">«</button>
                          <button type="button" onClick={() => loadAdminCustomers(adminCustPage.page - 1)} disabled={adminCustPage.page === 1}
                            className="px-2 py-1 border rounded disabled:opacity-30 hover:bg-white">‹</button>
                          <button type="button" onClick={() => loadAdminCustomers(adminCustPage.page + 1)} disabled={adminCustPage.page === adminCustPage.totalPages}
                            className="px-2 py-1 border rounded disabled:opacity-30 hover:bg-white">›</button>
                          <button type="button" onClick={() => loadAdminCustomers(adminCustPage.totalPages)} disabled={adminCustPage.page === adminCustPage.totalPages}
                            className="px-2 py-1 border rounded disabled:opacity-30 hover:bg-white">»</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 전체 삭제 */}
                  <div className="pt-3 border-t border-red-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium text-red-600">⚠️ 전체 삭제</div>
                        <p className="text-[11px] text-gray-400">모든 고객 및 구매내역 영구 삭제</p>
                      </div>
                      <button type="button"
                        onClick={() => { setCustomerDeleteConfirmName(''); setShowCustomerDeleteAll(true); }}
                        className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100 transition">
                        전체 삭제
                      </button>
                    </div>
                  </div>

                  {/* 닫기 버튼 */}
                  <div className="flex pt-4 mt-4 border-t">
                    <button type="button" onClick={() => setShowEditCompanyModal(false)}
                      className="w-full px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50">
                      닫기
                    </button>
                  </div>
                </div>
              )}

              {editCompanyTab !== 'customers' && (
              <div className="flex gap-3 pt-6 mt-4 border-t">
                <button type="button" onClick={() => setShowEditCompanyModal(false)}
                  className="flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50">
                  취소
                </button>
                <button type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  저장
                </button>
              </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* 예약 취소 모달 */}
      {showCancelModal && cancelTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-center text-gray-900 mb-2">예약 취소</h3>
              <p className="text-sm text-center text-gray-600 mb-4">
                <span className="font-medium text-gray-900">"{cancelTarget.name}"</span> 캠페인을 취소하시겠습니까?
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  취소 사유 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 outline-none resize-none"
                  rows={3}
                  placeholder="취소 사유를 입력해주세요 (이력 관리용)"
                  required
                />
              </div>
            </div>
            <div className="flex border-t">
              <button
                onClick={() => {
                  setShowCancelModal(false);
                  setCancelTarget(null);
                  setCancelReason('');
                }}
                className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
              >
                닫기
              </button>
              <button
                onClick={handleCancelCampaign}
                className="flex-1 px-4 py-3 text-red-600 font-medium hover:bg-red-50 transition-colors"
              >
                취소하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 발신번호 수정 모달 */}
      {editingCallback && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">📞 발신번호 수정</h3>
              <form onSubmit={handleUpdateCallback} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">발신번호 *</label>
                  <input
                    type="text"
                    value={editingCallback.phone}
                    onChange={(e) => setEditingCallback({ ...editingCallback, phone: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">별칭</label>
                  <input
                    type="text"
                    value={editingCallback.label}
                    onChange={(e) => setEditingCallback({ ...editingCallback, label: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="예: 대표번호, 강남점"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button type="button" onClick={() => setEditingCallback(null)}
                    className="flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50">취소</button>
                  <button type="submit"
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">저장</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 발신번호 등록 모달 */}
      {showCallbackModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
              <h3 className="text-lg font-semibold text-gray-800">📞 발신번호 등록</h3>
            </div>
            <form onSubmit={handleCreateCallback} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  고객사 *
                </label>
                <select
                  value={newCallback.companyId}
                  onChange={(e) => setNewCallback({ ...newCallback, companyId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                >
                  <option value="">선택하세요</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.company_name} ({company.company_code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  발신번호 *
                </label>
                <input
                  type="text"
                  value={newCallback.phone}
                  onChange={(e) => setNewCallback({ ...newCallback, phone: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="02-1234-5678"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  별칭
                </label>
                <input
                  type="text"
                  value={newCallback.label}
                  onChange={(e) => setNewCallback({ ...newCallback, label: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="대표번호, 고객센터 등"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={newCallback.isDefault}
                  onChange={(e) => setNewCallback({ ...newCallback, isDefault: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <label htmlFor="isDefault" className="text-sm text-gray-700">
                  대표번호로 설정
                </label>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowCallbackModal(false);
                    setNewCallback({ companyId: '', phone: '', label: '', isDefault: false });
                  }}
                  className="flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  등록
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 요금제 추가 모달 */}
      {showPlanModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b bg-gradient-to-r from-green-50 to-emerald-50">
              <h3 className="text-lg font-semibold text-gray-800">💳 요금제 추가</h3>
            </div>
            <form onSubmit={handleCreatePlan} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">요금제 코드 *</label>
                <input
                  type="text"
                  value={newPlan.planCode}
                  onChange={(e) => setNewPlan({ ...newPlan, planCode: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                  placeholder="예: BASIC, PRO, ENTERPRISE"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">요금제명 *</label>
                <input
                  type="text"
                  value={newPlan.planName}
                  onChange={(e) => setNewPlan({ ...newPlan, planName: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                  placeholder="예: 베이직, 프로, 엔터프라이즈"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">최대 고객수 *</label>
                <input
                  type="number"
                  value={newPlan.maxCustomers}
                  onChange={(e) => setNewPlan({ ...newPlan, maxCustomers: Number(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                  min="0"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">월 요금 (원) *</label>
                <input
                  type="number"
                  value={newPlan.monthlyPrice}
                  onChange={(e) => setNewPlan({ ...newPlan, monthlyPrice: Number(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                  min="0"
                  required
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowPlanModal(false);
                    setNewPlan({ planCode: '', planName: '', maxCustomers: 1000, monthlyPrice: 0 });
                  }}
                  className="flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  등록
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 요금제 수정 모달 */}
      {editingPlan && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
              <h3 className="text-lg font-semibold text-gray-800">✏️ 요금제 수정</h3>
            </div>
            <form onSubmit={handleUpdatePlan} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">요금제 코드</label>
                <input
                  type="text"
                  value={editingPlan.plan_code}
                  disabled
                  className="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">요금제명 *</label>
                <input
                  type="text"
                  value={editingPlan.plan_name}
                  onChange={(e) => setEditingPlan({ ...editingPlan, plan_name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">최대 고객수 *</label>
                <input
                  type="number"
                  value={editingPlan.max_customers}
                  onChange={(e) => setEditingPlan({ ...editingPlan, max_customers: Number(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  min="0"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">월 요금 (원) *</label>
                <input
                  type="number"
                  value={editingPlan.monthly_price}
                  onChange={(e) => setEditingPlan({ ...editingPlan, monthly_price: Number(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  min="0"
                  required
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="planActive"
                  checked={editingPlan.is_active}
                  onChange={(e) => setEditingPlan({ ...editingPlan, is_active: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <label htmlFor="planActive" className="text-sm text-gray-700">활성화</label>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingPlan(null)}
                  className="flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== 커스텀 모달들 ===== */}
      
      {/* 확인 모달 (Confirm) */}
      {modal.type === 'confirm' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-center text-gray-900 mb-2">{modal.title}</h3>
              <p className="text-sm text-center text-gray-600 whitespace-pre-line">{modal.message}</p>
            </div>
            <div className="flex border-t">
              <button
                onClick={closeModal}
                className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
              >
                취소
              </button>
              <button
                onClick={() => modal.onConfirm?.()}
                className="flex-1 px-4 py-3 text-orange-600 font-medium hover:bg-orange-50 transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 알림 모달 (Alert) */}
      {modal.type === 'alert' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${
                modal.variant === 'success' ? 'bg-green-100' :
                modal.variant === 'error' ? 'bg-red-100' :
                modal.variant === 'warning' ? 'bg-yellow-100' : 'bg-blue-100'
              }`}>
                {modal.variant === 'success' && (
                  <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {modal.variant === 'error' && (
                  <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                {modal.variant === 'warning' && (
                  <svg className="w-6 h-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                )}
                {modal.variant === 'info' && (
                  <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
              <h3 className="text-lg font-semibold text-center text-gray-900 mb-2">{modal.title}</h3>
              <p className="text-sm text-center text-gray-600">{modal.message}</p>
            </div>
            <div className="border-t">
              <button
                onClick={closeModal}
                className={`w-full px-4 py-3 font-medium transition-colors ${
                  modal.variant === 'success' ? 'text-green-600 hover:bg-green-50' :
                  modal.variant === 'error' ? 'text-red-600 hover:bg-red-50' :
                  modal.variant === 'warning' ? 'text-yellow-600 hover:bg-yellow-50' : 'text-blue-600 hover:bg-blue-50'
                }`}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 비밀번호 모달 (복사 기능 포함) */}
      {modal.type === 'password' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-center text-gray-900 mb-4">{modal.title}</h3>
              
              <div className="bg-gray-50 rounded-xl p-4 mb-4">
                <p className="text-xs text-gray-500 mb-2 text-center">임시 비밀번호</p>
                <div className="flex items-center justify-center gap-2">
                  <code className="text-2xl font-mono font-bold text-gray-900 tracking-wider">
                    {modal.password}
                  </code>
                  <button
                    onClick={handleCopyPassword}
                    className={`p-2 rounded-lg transition-all ${
                      copied 
                        ? 'bg-green-100 text-green-600' 
                        : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                    }`}
                    title="복사하기"
                  >
                    {copied ? (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                    )}
                  </button>
                </div>
                {copied && (
                  <p className="text-xs text-green-600 text-center mt-2">복사되었습니다!</p>
                )}
              </div>
              
              {modal.smsSent && modal.phone && (
                <div className="bg-blue-50 rounded-lg p-3 mb-4">
                  <p className="text-sm text-blue-800 text-center">
                    📱 <strong>{modal.phone}</strong>로 SMS 발송 완료
                  </p>
                </div>
              )}
              {!modal.smsSent && (
                <div className="bg-yellow-50 rounded-lg p-3 mb-4">
                  <p className="text-sm text-yellow-800 text-center">
                    ⚠️ 휴대폰 번호가 없어 SMS를 발송하지 못했습니다
                  </p>
                </div>
              )}
              
              <p className="text-xs text-gray-500 text-center">
                {modal.smsSent ? '사용자에게 SMS로 전달되었습니다.' : '사용자에게 직접 전달해주세요.'}<br/>
                최초 로그인 시 비밀번호 변경이 필요합니다.
              </p>
            </div>
            <div className="border-t">
              <button
                onClick={closeModal}
                className="w-full px-4 py-3 text-blue-600 font-medium hover:bg-blue-50 transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
{/* 발송 통계 상세 모달 */}
{statsDetailInfo && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">발송 통계 상세</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  {statsDetailInfo.date} · {statsDetailInfo.companyName}
                </p>
              </div>
              <button
                onClick={() => { setStatsDetail(null); setStatsDetailInfo(null); }}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto max-h-[calc(85vh-64px)] p-6 space-y-6">
              {statsDetailLoading ? (
                <div className="text-center py-12 text-gray-400">로딩 중...</div>
              ) : statsDetail ? (
                <>
                  {/* 사용자별 요약 */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      사용자별 발송 현황
                    </h4>
                    <div className="bg-gray-50 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="px-4 py-2.5 text-left text-gray-600 font-medium">사용자</th>
                            <th className="px-4 py-2.5 text-left text-gray-600 font-medium">아이디</th>
                            <th className="px-4 py-2.5 text-center text-gray-600 font-medium">부서</th>
                            <th className="px-4 py-2.5 text-center text-gray-600 font-medium">담당 브랜드</th>
                            <th className="px-4 py-2.5 text-center text-gray-600 font-medium">캠페인수</th>
                            <th className="px-4 py-2.5 text-center text-gray-600 font-medium">전송</th>
                            <th className="px-4 py-2.5 text-center text-gray-600 font-medium">성공</th>
                            <th className="px-4 py-2.5 text-center text-gray-600 font-medium">실패</th>
                            <th className="px-4 py-2.5 text-center text-gray-600 font-medium">성공률</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {statsDetail.userStats?.length === 0 ? (
                            <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">데이터가 없습니다.</td></tr>
                          ) : statsDetail.userStats?.map((u: any, idx: number) => {
                            const sent = Number(u.sent);
                            const success = Number(u.success);
                            const fail = Number(u.fail);
                            const rate = sent > 0 ? (success / sent * 100).toFixed(1) : '-';
                            return (
                              <tr key={idx} className="hover:bg-white">
                                <td className="px-4 py-2.5 font-medium text-gray-900">{u.user_name || '(알 수 없음)'}</td>
                                <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{u.login_id || '-'}</td>
                                <td className="px-4 py-2.5 text-center text-gray-500">{u.department || '-'}</td>
                                <td className="px-4 py-2.5 text-center text-gray-500">{u.store_codes?.length > 0 ? u.store_codes.join(', ') : '-'}</td>
                                <td className="px-4 py-2.5 text-center text-gray-700">{Number(u.runs)}</td>
                                <td className="px-4 py-2.5 text-center text-blue-600 font-medium">{sent.toLocaleString()}</td>
                                <td className="px-4 py-2.5 text-center text-green-600">{success.toLocaleString()}</td>
                                <td className="px-4 py-2.5 text-center text-red-600">{fail.toLocaleString()}</td>
                                <td className="px-4 py-2.5 text-center font-medium">{rate}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 캠페인별 상세 */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <svg className="w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                      캠페인별 발송 내역
                    </h4>
                    <div className="bg-gray-50 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="px-4 py-2.5 text-left text-gray-600 font-medium">캠페인명</th>
                            <th className="px-4 py-2.5 text-center text-gray-600 font-medium">유형</th>
                            <th className="px-4 py-2.5 text-center text-gray-600 font-medium">발송자</th>
                            <th className="px-4 py-2.5 text-center text-gray-600 font-medium">대상</th>
                            <th className="px-4 py-2.5 text-center text-gray-600 font-medium">전송</th>
                            <th className="px-4 py-2.5 text-center text-gray-600 font-medium">성공</th>
                            <th className="px-4 py-2.5 text-center text-gray-600 font-medium">실패</th>
                            <th className="px-4 py-2.5 text-center text-gray-600 font-medium">메시지</th>
                            <th className="px-4 py-2.5 text-center text-gray-600 font-medium">발송시간</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {statsDetail.campaigns?.length === 0 ? (
                            <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">데이터가 없습니다.</td></tr>
                          ) : statsDetail.campaigns?.map((c: any, idx: number) => (
                            <tr key={idx} className="hover:bg-white">
                              <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[200px] truncate" title={c.campaign_name}>
                                {c.campaign_name}
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                  c.send_type === 'ai' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'
                                }`}>
                                  {c.send_type === 'ai' ? 'AI' : '수동'}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-center text-gray-600">{c.user_name || '-'}</td>
                              <td className="px-4 py-2.5 text-center text-gray-500">{Number(c.target_count || 0).toLocaleString()}</td>
                              <td className="px-4 py-2.5 text-center text-blue-600 font-medium">{Number(c.sent_count || 0).toLocaleString()}</td>
                              <td className="px-4 py-2.5 text-center text-green-600">{Number(c.success_count || 0).toLocaleString()}</td>
                              <td className="px-4 py-2.5 text-center text-red-600">{Number(c.fail_count || 0).toLocaleString()}</td>
                              <td className="px-4 py-2.5 text-center">
                                <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                                  c.message_type === 'LMS' ? 'bg-blue-100 text-blue-700' :
                                  c.message_type === 'MMS' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
                                }`}>
                                  {c.message_type || 'SMS'}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-center text-gray-500 font-mono text-xs">
                                {c.sent_at ? new Date(c.sent_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
      {activeTab === 'billing' && (
        <div className="bg-white rounded-lg shadow">
          {/* 빌링 토스트 */}
          {billingToast && (
            <div className={`fixed top-6 right-6 z-[70] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${
              billingToast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
            }`}>
              {billingToast.msg}
            </div>
          )}

          {/* ===== 1. 정산 생성 ===== */}
          <div className="px-6 py-5 border-b">
            <h3 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              정산 생성
            </h3>
            <div className="flex flex-wrap items-end gap-4">
              {/* 고객사 */}
              <div className="min-w-[200px]">
                <label className="block text-xs font-medium text-gray-500 mb-1">고객사</label>
                <select value={billingCompanyId} onChange={e => setBillingCompanyId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                  <option value="">선택</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
              </div>
              {/* 시작일 */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">시작일</label>
                <input type="date" value={billingStart} onChange={e => setBillingStart(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              {/* 종료일 */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">종료일</label>
                <input type="date" value={billingEnd} onChange={e => setBillingEnd(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              {/* 발행 단위 */}
              <div className="flex items-center gap-3 pb-0.5">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" checked={billingScope === 'company'} onChange={() => setBillingScope('company')} className="accent-indigo-600" />
                  고객사 전체
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" checked={billingScope === 'user'} onChange={() => setBillingScope('user')} className="accent-indigo-600" />
                  사용자별
                </label>
              </div>
              {/* 사용자 선택 */}
              {billingScope === 'user' && (
                <div className="min-w-[160px]">
                  <label className="block text-xs font-medium text-gray-500 mb-1">사용자</label>
                  <select value={billingUserId} onChange={e => setBillingUserId(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    disabled={billingUsersLoading || !billingCompanyId}>
                    <option value="">{billingUsersLoading ? '로딩...' : !billingCompanyId ? '고객사 먼저 선택' : '선택'}</option>
                    {billingUsers.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.department || u.login_id})</option>)}
                  </select>
                </div>
              )}
              {/* 생성 버튼 */}
              <button
                onClick={() => {
                  if (!billingCompanyId) return setBillingToast({ msg: '고객사를 선택해주세요', type: 'error' });
                  if (billingScope === 'user' && !billingUserId) return setBillingToast({ msg: '사용자를 선택해주세요', type: 'error' });
                  setShowGenerateConfirm(true);
                }}
                disabled={generating}
                className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {generating ? '생성 중...' : '정산 생성'}
              </button>
            </div>
          </div>

          {/* ===== 2. 정산 목록 ===== */}
          <div className="px-6 py-5 border-b">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                정산 목록
              </h3>
              <select value={filterYear} onChange={e => setFilterYear(Number(e.target.value))}
                className="px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                {billingYearOptions.map(y => <option key={y} value={y}>{y}년</option>)}
              </select>
            </div>

            {billingsLoading ? (
              <div className="text-center py-8 text-gray-400">로딩 중...</div>
            ) : billings.length === 0 ? (
              <div className="text-center py-8 text-gray-400">정산 데이터가 없습니다</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-gray-600 font-medium">고객사</th>
                      <th className="px-4 py-2.5 text-center text-gray-600 font-medium">구분</th>
                      <th className="px-4 py-2.5 text-center text-gray-600 font-medium">정산월</th>
                      <th className="px-4 py-2.5 text-right text-gray-600 font-medium">SMS</th>
                      <th className="px-4 py-2.5 text-right text-gray-600 font-medium">LMS</th>
                      <th className="px-4 py-2.5 text-right text-gray-600 font-medium">합계</th>
                      <th className="px-4 py-2.5 text-center text-gray-600 font-medium">상태</th>
                      <th className="px-4 py-2.5 text-center text-gray-600 font-medium">발송일</th>
                      <th className="px-4 py-2.5 text-center text-gray-600 font-medium">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {billings.map((b: any) => (
                      <tr key={b.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openBillingDetail(b.id)}>
                        <td className="px-4 py-2.5 font-medium text-gray-900">{b.company_name}</td>
                        <td className="px-4 py-2.5 text-center text-gray-500">{b.user_name || '전체'}</td>
                        <td className="px-4 py-2.5 text-center text-gray-500">{b.billing_year}년 {b.billing_month}월</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{billingFmt(Number(b.sms_success))}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{billingFmt(Number(b.lms_success))}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-indigo-700 tabular-nums">{billingFmtWon(Number(b.total_amount))}</td>
                        <td className="px-4 py-2.5 text-center">{billingStatusBadge(b.status)}</td>
                        <td className="px-4 py-2.5 text-center text-xs text-gray-500">
                          {b.emailed_at ? (
                            <span className="inline-flex items-center gap-1 text-green-600" title={`${b.emailed_to}\n${formatDateTime(b.emailed_at)}`}>
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                              {new Date(b.emailed_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' })}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                          {b.status === 'draft' && (
                              <button onClick={() => handleBillingStatusChange(b.id, 'confirmed')}
                                className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors">확정</button>
                            )}
                            {b.status === 'confirmed' && (
                              <button onClick={() => handleBillingStatusChange(b.id, 'paid')}
                                className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors">수금완료</button>
                            )}
                            <button onClick={() => downloadBillingPdf(b.id, `${b.company_name}_${b.billing_year}_${b.billing_month}`)}
                              className="px-2 py-1 text-xs bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition-colors">PDF</button>
                            {(b.status === 'confirmed' || b.status === 'paid') && (
                              <button onClick={() => openEmailModal(b)}
                                className="px-2 py-1 text-xs bg-amber-100 text-amber-700 rounded hover:bg-amber-200 transition-colors flex items-center gap-0.5">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                                발송
                              </button>
                            )}
                            <button onClick={() => { setDeleteTargetId(b.id); setShowBillingDeleteConfirm(true); }}
                              className="px-2 py-1 text-xs bg-red-100 text-red-600 rounded hover:bg-red-200 transition-colors">삭제</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ===== 3. 거래내역서 목록 ===== */}
          <div className="px-6 py-5">
            <h3 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              거래내역서 목록
            </h3>

            {invoicesLoading ? (
              <div className="text-center py-8 text-gray-400">로딩 중...</div>
            ) : invoices.length === 0 ? (
              <div className="text-center py-8 text-gray-400">생성된 거래내역서가 없습니다</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-gray-600 font-medium">고객사</th>
                      <th className="px-4 py-2.5 text-center text-gray-600 font-medium">브랜드</th>
                      <th className="px-4 py-2.5 text-center text-gray-600 font-medium">정산기간</th>
                      <th className="px-4 py-2.5 text-right text-gray-600 font-medium">공급가액</th>
                      <th className="px-4 py-2.5 text-right text-gray-600 font-medium">부가세</th>
                      <th className="px-4 py-2.5 text-right text-gray-600 font-medium">합계</th>
                      <th className="px-4 py-2.5 text-center text-gray-600 font-medium">상태</th>
                      <th className="px-4 py-2.5 text-center text-gray-600 font-medium">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {invoices.map((inv: any) => (
                      <tr key={inv.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-medium text-gray-900">{inv.company_name}</td>
                        <td className="px-4 py-2.5 text-center text-gray-500">{inv.store_name || '통합'}</td>
                        <td className="px-4 py-2.5 text-center text-gray-500 font-mono text-xs">
                          {String(inv.billing_start).slice(0, 10)} ~ {String(inv.billing_end).slice(0, 10)}
                        </td>
                        <td className="px-4 py-2.5 text-right">{billingFmtWon(Number(inv.subtotal))}</td>
                        <td className="px-4 py-2.5 text-right">{billingFmtWon(Number(inv.vat))}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-indigo-700">{billingFmtWon(Number(inv.total_amount))}</td>
                        <td className="px-4 py-2.5 text-center">{billingStatusBadge(inv.status)}</td>
                        <td className="px-4 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {inv.status === 'draft' && (
                              <button onClick={() => handleInvoiceStatusChange(inv.id, 'confirmed')}
                                className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors">확정</button>
                            )}
                            {inv.status === 'confirmed' && (
                              <button onClick={() => handleInvoiceStatusChange(inv.id, 'paid')}
                                className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors">수금완료</button>
                            )}
                            <button onClick={() => downloadInvoicePdf(inv)}
                              className="px-2 py-1 text-xs bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition-colors">PDF</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ===== 정산 생성 확인 모달 ===== */}
          {showGenerateConfirm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-6">
                  <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-center text-gray-900 mb-2">정산 생성</h3>
                  <p className="text-sm text-center text-gray-600 mb-1">
                    <strong>{companies.find(c => c.id === billingCompanyId)?.company_name}</strong>
                  </p>
                  <p className="text-sm text-center text-gray-500 mb-1">
                    {billingStart} ~ {billingEnd}
                  </p>
                  <p className="text-xs text-center text-gray-400 mb-4">
                    {billingScope === 'company' ? '고객사 전체' : `사용자: ${billingUsers.find((u: any) => u.id === billingUserId)?.name || ''}`}
                  </p>
                  <p className="text-xs text-center text-gray-500">
                    MySQL 발송 데이터를 집계하여 정산을 생성합니다.
                  </p>
                </div>
                <div className="flex border-t">
                  <button onClick={() => setShowGenerateConfirm(false)}
                    className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">취소</button>
                  <button onClick={handleBillingGenerate} disabled={generating}
                    className="flex-1 px-4 py-3 text-indigo-600 font-medium hover:bg-indigo-50 transition-colors">
                    {generating ? '생성 중...' : '확인'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ===== 정산 삭제 확인 모달 ===== */}
          {showBillingDeleteConfirm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-6">
                  <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-center text-gray-900 mb-2">정산 삭제</h3>
                  <p className="text-sm text-center text-gray-600">
                    이 정산과 일자별 상세 데이터가 모두 삭제됩니다.<br />계속하시겠습니까?
                  </p>
                </div>
                <div className="flex border-t">
                  <button onClick={() => setShowBillingDeleteConfirm(false)}
                    className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">취소</button>
                  <button onClick={handleBillingDelete}
                    className="flex-1 px-4 py-3 text-red-600 font-medium hover:bg-red-50 transition-colors">삭제</button>
                </div>
              </div>
            </div>
          )}


          {/* ===== 정산 상세 모달 ===== */}
          {showBillingDetail && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col">
                {/* 모달 헤더 */}
                <div className="px-6 py-4 border-b bg-gradient-to-r from-indigo-50 to-white flex items-center justify-between flex-shrink-0">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      정산 상세
                    </h3>
                    {detailBilling && (
                      <div>
                        <p className="text-sm text-gray-500 mt-0.5">
                          {detailBilling.company_name} · {detailBilling.billing_year}년 {detailBilling.billing_month}월
                          {detailBilling.user_name && <span className="ml-2 text-indigo-600">({detailBilling.user_name})</span>}
                        </p>
                        {detailBilling.emailed_at && (
                          <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            {formatDateTime(detailBilling.emailed_at)} · {detailBilling.emailed_to}로 발송됨
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <button onClick={() => setShowBillingDetail(false)}
                    className="w-8 h-8 rounded-full hover:bg-gray-200 flex items-center justify-center transition-colors">
                    <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {detailLoading ? (
                  <div className="flex-1 flex items-center justify-center py-16">
                    <div className="text-gray-400">로딩 중...</div>
                  </div>
                ) : detailBilling && (
                  <div className="flex-1 overflow-y-auto">
                    {/* 요약 카드 */}
                    <div className="px-6 py-4">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                        {Number(detailBilling.sms_success) > 0 && (
                          <div className="bg-blue-50 rounded-lg p-3 text-center">
                            <div className="text-xs text-blue-600 font-medium">SMS</div>
                            <div className="text-lg font-bold text-blue-800">{billingFmt(Number(detailBilling.sms_success))}건</div>
                            <div className="text-xs text-blue-500">@{billingFmtWon(Number(detailBilling.sms_unit_price))}</div>
                          </div>
                        )}
                        {Number(detailBilling.lms_success) > 0 && (
                          <div className="bg-purple-50 rounded-lg p-3 text-center">
                            <div className="text-xs text-purple-600 font-medium">LMS</div>
                            <div className="text-lg font-bold text-purple-800">{billingFmt(Number(detailBilling.lms_success))}건</div>
                            <div className="text-xs text-purple-500">@{billingFmtWon(Number(detailBilling.lms_unit_price))}</div>
                          </div>
                        )}
                        {Number(detailBilling.mms_success) > 0 && (
                          <div className="bg-pink-50 rounded-lg p-3 text-center">
                            <div className="text-xs text-pink-600 font-medium">MMS</div>
                            <div className="text-lg font-bold text-pink-800">{billingFmt(Number(detailBilling.mms_success))}건</div>
                            <div className="text-xs text-pink-500">@{billingFmtWon(Number(detailBilling.mms_unit_price))}</div>
                          </div>
                        )}
                        {Number(detailBilling.kakao_success) > 0 && (
                          <div className="bg-yellow-50 rounded-lg p-3 text-center">
                            <div className="text-xs text-yellow-600 font-medium">카카오</div>
                            <div className="text-lg font-bold text-yellow-800">{billingFmt(Number(detailBilling.kakao_success))}건</div>
                            <div className="text-xs text-yellow-500">@{billingFmtWon(Number(detailBilling.kakao_unit_price))}</div>
                          </div>
                        )}
                      </div>

                      {/* 테스트 발송 */}
                      {(Number(detailBilling.test_sms_count) > 0 || Number(detailBilling.test_lms_count) > 0) && (
                        <div className="bg-amber-50 rounded-lg p-3 mb-4 flex items-center gap-4 text-sm">
                          <span className="text-amber-700 font-medium">테스트:</span>
                          {Number(detailBilling.test_sms_count) > 0 && <span className="text-amber-600">SMS {billingFmt(Number(detailBilling.test_sms_count))}건</span>}
                          {Number(detailBilling.test_lms_count) > 0 && <span className="text-amber-600">LMS {billingFmt(Number(detailBilling.test_lms_count))}건</span>}
                        </div>
                      )}

                      {/* 합계 */}
                      <div className="bg-indigo-50 rounded-lg p-4 flex items-center justify-between mb-6">
                        <div className="flex items-center gap-6 text-sm">
                          <div><span className="text-gray-500">공급가액</span> <span className="font-medium text-gray-800 ml-1">{billingFmtWon(Number(detailBilling.subtotal))}</span></div>
                          <div><span className="text-gray-500">부가세</span> <span className="font-medium text-gray-800 ml-1">{billingFmtWon(Number(detailBilling.vat))}</span></div>
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-gray-500">합계</span>
                          <div className="text-xl font-bold text-indigo-700">{billingFmtWon(Number(detailBilling.total_amount))}</div>
                        </div>
                      </div>

                      {/* 일자별 상세 테이블 */}
                      <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                        <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        일자별 상세 내역 ({detailItems.length}건)
                      </h4>

                      {detailItems.length === 0 ? (
                        <div className="text-center py-6 text-gray-400 text-sm">상세 데이터가 없습니다</div>
                      ) : (
                        <div className="overflow-x-auto border rounded-lg">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-3 py-2 text-left text-gray-600 font-medium">일자</th>
                                <th className="px-3 py-2 text-left text-gray-600 font-medium">유형</th>
                                <th className="px-3 py-2 text-right text-gray-600 font-medium">전송</th>
                                <th className="px-3 py-2 text-right text-gray-600 font-medium">성공</th>
                                <th className="px-3 py-2 text-right text-gray-600 font-medium">실패</th>
                                <th className="px-3 py-2 text-right text-gray-600 font-medium">대기</th>
                                <th className="px-3 py-2 text-right text-gray-600 font-medium">단가</th>
                                <th className="px-3 py-2 text-right text-gray-600 font-medium">금액</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {detailItems.map((item: any, idx: number) => {
                                const isTest = item.message_type.startsWith('TEST');
                                return (
                                  <tr key={idx} className={isTest ? 'bg-amber-50' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                                    <td className="px-3 py-2 text-gray-700 font-mono text-xs">{String(item.item_date).slice(5, 10)}</td>
                                    <td className="px-3 py-2">{billingTypeLabel[item.message_type] || item.message_type}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{billingFmt(Number(item.total_count))}</td>
                                    <td className="px-3 py-2 text-right tabular-nums text-green-700 font-medium">{billingFmt(Number(item.success_count))}</td>
                                    <td className={`px-3 py-2 text-right tabular-nums ${Number(item.fail_count) > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>{billingFmt(Number(item.fail_count))}</td>
                                    <td className={`px-3 py-2 text-right tabular-nums ${Number(item.pending_count) > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{billingFmt(Number(item.pending_count))}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{billingFmtWon(Number(item.unit_price))}</td>
                                    <td className="px-3 py-2 text-right tabular-nums font-medium">{billingFmtWon(Number(item.amount))}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot className="border-t-2 border-gray-300 bg-indigo-50">
                              <tr>
                                <td colSpan={2} className="px-3 py-2.5 font-bold text-indigo-800">합계</td>
                                <td className="px-3 py-2.5 text-right tabular-nums font-medium">{billingFmt(detailItems.reduce((s: number, i: any) => s + Number(i.total_count), 0))}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums font-medium text-green-700">{billingFmt(detailItems.reduce((s: number, i: any) => s + Number(i.success_count), 0))}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums font-medium text-red-600">{billingFmt(detailItems.reduce((s: number, i: any) => s + Number(i.fail_count), 0))}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{billingFmt(detailItems.reduce((s: number, i: any) => s + Number(i.pending_count), 0))}</td>
                                <td className="px-3 py-2.5"></td>
                                <td className="px-3 py-2.5 text-right tabular-nums font-bold text-indigo-800">{billingFmtWon(detailItems.reduce((s: number, i: any) => s + Number(i.amount), 0))}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 모달 하단 액션 */}
                {detailBilling && !detailLoading && (
                  <div className="px-6 py-3 border-t bg-gray-50 flex items-center justify-between flex-shrink-0">
                    <div className="flex items-center gap-2">
                      {billingStatusBadge(detailBilling.status)}
                      {detailBilling.status === 'draft' && (
                        <button onClick={() => handleBillingStatusChange(detailBilling.id, 'confirmed')}
                          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">확정</button>
                      )}
                      {detailBilling.status === 'confirmed' && (
                        <button onClick={() => handleBillingStatusChange(detailBilling.id, 'paid')}
                          className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">수금완료</button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {(detailBilling.status === 'confirmed' || detailBilling.status === 'paid') && (
                        <button onClick={() => { setShowBillingDetail(false); setTimeout(() => openEmailModal(detailBilling), 200); }}
                          className="px-4 py-1.5 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors flex items-center gap-1.5">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          정산서 발송
                        </button>
                      )}
                      <button onClick={() => downloadBillingPdf(detailBilling.id, `${detailBilling.company_name}_${detailBilling.billing_year}_${detailBilling.billing_month}`)}
                        className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-1.5">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        PDF 다운로드
                      </button>
                      <button onClick={() => setShowBillingDetail(false)}
                        className="px-4 py-1.5 text-sm text-gray-600 border rounded-lg hover:bg-gray-100 transition-colors">닫기</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== 정산서 이메일 발송 모달 ===== */}
          {showEmailModal && emailTarget && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-6">
                  <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-center text-gray-900 mb-2">정산서 이메일 발송</h3>
                  <p className="text-sm text-center text-gray-500 mb-5">
                    <strong>{emailTarget.company_name}</strong> · {emailTarget.billing_year}년 {emailTarget.billing_month}월
                  </p>

                  {/* 이전 발송 이력 */}
                  {emailTarget.emailed_at && (
                    <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-4 text-xs text-green-700 flex items-center gap-1.5">
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      이전 발송: {formatDateTime(emailTarget.emailed_at)} → {emailTarget.emailed_to}
                    </div>
                  )}

                  {/* 수신자 이메일 */}
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-gray-500 mb-1">수신자 이메일</label>
                    <input
                      type="email"
                      value={emailTo}
                      onChange={e => setEmailTo(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                      placeholder="담당자 이메일"
                    />
                  </div>

                  {/* 메일 제목 */}
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-gray-500 mb-1">메일 제목</label>
                    <input
                      type="text"
                      value={emailSubject}
                      onChange={e => setEmailSubject(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                    />
                  </div>

                  {/* 본문 미리보기 */}
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-gray-500 mb-1">본문 미리보기</label>
                    <div className="border rounded-lg p-3 bg-gray-50 text-xs text-gray-600 space-y-1.5 max-h-[140px] overflow-y-auto">
                      <p>안녕하세요, <strong>{emailTarget.company_name}</strong> 담당자님.</p>
                      <p>아래와 같이 거래내역서를 송부드립니다.</p>
                      <div className="bg-white rounded p-2 mt-2 border">
                        <div className="flex justify-between"><span className="text-gray-400">정산 기간</span><span className="font-medium">{emailTarget.billing_year}년 {emailTarget.billing_month}월</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">공급가액</span><span>{billingFmtWon(Number(emailTarget.subtotal || 0))}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">부가세</span><span>{billingFmtWon(Number(emailTarget.vat || 0))}</span></div>
                        <div className="flex justify-between border-t pt-1 mt-1"><span className="font-bold">합계</span><span className="font-bold text-indigo-700">{billingFmtWon(Number(emailTarget.total_amount || 0))}</span></div>
                      </div>
                      <p className="text-gray-400 mt-2">+ 거래내역서 PDF 첨부</p>
                    </div>
                  </div>

                  {/* 발신 정보 */}
                  <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-400">
                    발신: mobile@invitocorp.com (하이웍스)
                  </div>
                </div>

                <div className="flex border-t">
                  <button
                    onClick={() => setShowEmailModal(false)}
                    className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
                    disabled={emailSending}
                  >
                    취소
                  </button>
                  <button
                    onClick={handleSendBillingEmail}
                    disabled={emailSending || !emailTo}
                    className="flex-1 px-4 py-3 text-amber-600 font-medium hover:bg-amber-50 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {emailSending ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                        발송 중...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                        발송하기
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Sync 모니터링 탭 */}
      {activeTab === 'syncAgents' && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b flex justify-between items-center">
            <h2 className="text-lg font-semibold">Sync Agent 모니터링</h2>
            <button
              onClick={loadSyncAgents}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              새로고침
            </button>
          </div>

          {syncAgentsLoading ? (
            <div className="p-12 text-center text-gray-500">로딩 중...</div>
          ) : syncAgents.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" /></svg>
              <p>등록된 Sync Agent가 없습니다.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">고객사</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Agent명</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">버전</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">DB</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">상태</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">마지막 Heartbeat</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">마지막 동기화</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">고객 수</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">오늘 동기화</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">에러</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {syncAgents.map((agent: any) => (
                    <tr key={agent.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{agent.company_name || '-'}</td>
                      <td className="px-4 py-3 text-gray-700">{agent.agent_name || '-'}</td>
                      <td className="px-4 py-3 text-gray-500">{agent.agent_version || '-'}</td>
                      <td className="px-4 py-3 text-gray-500">{agent.db_type || '-'}</td>
                      <td className="px-4 py-3 text-center">{getSyncOnlineBadge(agent.online_status)}</td>
                      <td className="px-4 py-3 text-gray-500">{syncTimeAgo(agent.last_heartbeat_at)}</td>
                      <td className="px-4 py-3 text-gray-500">{syncTimeAgo(agent.last_sync_at)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{(agent.total_customers_synced || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{agent.today_sync_count || 0}건</td>
                      <td className="px-4 py-3 text-right">
                        <span className={agent.recent_error_count > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>
                          {agent.recent_error_count || 0}건
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => { setSyncSelectedAgent(agent); loadSyncAgentDetail(agent.id); }}
                            className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50"
                          >
                            상세
                          </button>
                          <button
                            onClick={() => {
                              setSyncSelectedAgent(agent);
                              setSyncConfigForm({ sync_interval_customers: 60, sync_interval_purchases: 30 });
                              setShowSyncConfigModal(true);
                            }}
                            className="text-gray-600 hover:text-gray-800 text-xs font-medium px-2 py-1 rounded hover:bg-gray-100"
                          >
                            설정
                          </button>
                          <button
                            onClick={() => {
                              setSyncSelectedAgent(agent);
                              setSyncCommandType('full_sync');
                              setShowSyncCommandModal(true);
                            }}
                            className="text-emerald-600 hover:text-emerald-800 text-xs font-medium px-2 py-1 rounded hover:bg-emerald-50"
                          >
                            명령
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 감사 로그 탭 */}
      {activeTab === 'auditLogs' && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">📋 감사 로그</h2>
            <p className="text-xs text-gray-500 mt-1">로그인, 삭제, 설정 변경 등 주요 활동 기록</p>
          </div>

          {/* 필터 */}
          <div className="px-6 py-3 border-b bg-gray-50 flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-500 font-medium">기간</span>
            <input type="date" value={auditFromDate} onChange={(e) => setAuditFromDate(e.target.value)}
              className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            <span className="text-gray-400">~</span>
            <input type="date" value={auditToDate} onChange={(e) => setAuditToDate(e.target.value)}
              className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
            <div className="w-px h-6 bg-gray-200" />
            <span className="text-sm text-gray-500 font-medium">액션</span>
            <select value={auditActionFilter} onChange={(e) => setAuditActionFilter(e.target.value)}
              className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="all">전체</option>
              {auditActions.map(a => { const m={login_success:"로그인 성공",login_fail:"로그인 실패",login_blocked:"로그인 차단",customer_delete:"고객 삭제",customer_bulk_delete:"고객 선택삭제",customer_delete_all:"고객 전체삭제"} as any; return <option key={a} value={a}>{m[a]||a}</option>; })}
            </select>
            <span className="text-sm text-gray-500 font-medium">고객사</span>
            <select value={auditCompanyFilter} onChange={(e) => setAuditCompanyFilter(e.target.value)}
              className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="all">전체</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
            <button onClick={() => loadAuditLogs(1)}
              className="px-4 py-1.5 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors">
              조회
            </button>
          </div>

          {/* 총 건수 */}
          <div className="px-6 py-2 text-xs text-gray-500">
            총 {auditLogsTotal.toLocaleString()}건 · {auditLogsPage} / {auditLogsTotalPages} 페이지
          </div>

          {/* 테이블 */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">일시</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">사용자</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">고객사</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">액션</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">상세</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {auditLogsLoading ? (
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500">불러오는 중...</td></tr>
                ) : auditLogs.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500">조회된 로그가 없습니다.</td></tr>
                ) : (
                  auditLogs.map((log) => {
                    const actionColors: Record<string, string> = {
                      login_success: 'bg-green-100 text-green-700',
                      login_fail: 'bg-red-100 text-red-700',
                      login_blocked: 'bg-red-200 text-red-800',
                      customer_delete: 'bg-orange-100 text-orange-700',
                      customer_bulk_delete: 'bg-orange-100 text-orange-700',
                      customer_delete_all: 'bg-red-100 text-red-700',
                    };
                    const actionLabels: Record<string, string> = {
                      login_success: '로그인 성공',
                      login_fail: '로그인 실패',
                      login_blocked: '로그인 차단',
                      customer_delete: '고객 삭제',
                      customer_bulk_delete: '고객 선택삭제',
                      customer_delete_all: '고객 전체삭제',
                    };
                    const details = log.details || {};
                    const userTypes: Record<string,string> = { admin:'관리자', user:'사용자', super_admin:'슈퍼관리자', company_admin:'고객사관리자' };
                    const reasons: Record<string,string> = { invalid_password:'비밀번호 불일치', user_not_found:'계정 없음', inactive:'비활성 계정', locked:'잠금 계정', dormant:'휴면 계정', not_allowed:'접근 차단' };
                    let detailText = '';
                    if (log.action === 'login_success') {
                      detailText = (details.loginId || '') + ' (' + (userTypes[details.userType as string] || details.userType || '') + ') · ' + (details.companyName || '');
                    } else if (log.action === 'login_fail') {
                      detailText = (details.loginId || '') + ' · ' + (reasons[details.reason as string] || details.reason || '');
                    } else if (log.action === 'login_blocked') {
                      detailText = (details.loginId || '') + ' · ' + (reasons[details.reason as string] || details.reason || '');
                    } else if (log.action === 'customer_delete_all') {
                      detailText = (details.company_name || '') + ' · ' + (details.deleted_customers || 0).toLocaleString() + '명 전체삭제';
                    } else if (log.action === 'customer_bulk_delete') {
                      detailText = (details.company_name || '') + ' · ' + (details.deleted_count || details.count || 0).toLocaleString() + '명 선택삭제';
                    } else if (log.action === 'customer_delete') {
                      detailText = (details.company_name || '') + ' · ' + (details.phone || '') + ' 삭제';
                    } else {
                      detailText = JSON.stringify(details).slice(0, 60);
                    }

                    return (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-center text-gray-600 whitespace-nowrap text-xs">
                          {formatDateTime(log.created_at)}
                        </td>
                        <td className="px-4 py-3 text-left">
                          <div className="font-medium text-gray-800 text-xs">{log.user_name || '-'}</div>
                          <div className="text-[10px] text-gray-400">{log.login_id || ''}</div>
                        </td>
                        <td className="px-4 py-3 text-left text-xs text-gray-600">
                          {log.company_name || '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-1 rounded-full text-[11px] font-medium ${actionColors[log.action] || 'bg-gray-100 text-gray-600'}`}>
                            {actionLabels[log.action] || log.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-left text-xs text-gray-500 max-w-[300px] truncate" title={detailText}>
                          {detailText || '-'}
                        </td>
                        <td className="px-4 py-3 text-center text-xs text-gray-400 whitespace-nowrap">
                          {log.ip_address || '-'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 페이지네이션 */}
          {auditLogsTotalPages > 1 && (
            <div className="px-6 py-3 border-t flex justify-center gap-1">
              <button onClick={() => loadAuditLogs(1)} disabled={auditLogsPage === 1}
                className="px-2 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-30">«</button>
              <button onClick={() => loadAuditLogs(auditLogsPage - 1)} disabled={auditLogsPage === 1}
                className="px-2 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-30">‹</button>
              {Array.from({ length: auditLogsTotalPages }, (_, i) => i + 1)
                .filter(p => Math.abs(p - auditLogsPage) <= 2 || p === 1 || p === auditLogsTotalPages)
                .map((p, idx, arr) => (
                  <span key={p}>
                    {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-gray-400">…</span>}
                    <button onClick={() => loadAuditLogs(p)}
                      className={`px-3 py-1 text-xs border rounded ${p === auditLogsPage ? 'bg-blue-500 text-white' : 'hover:bg-gray-50'}`}>{p}</button>
                  </span>
                ))}
              <button onClick={() => loadAuditLogs(auditLogsPage + 1)} disabled={auditLogsPage === auditLogsTotalPages}
                className="px-2 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-30">›</button>
              <button onClick={() => loadAuditLogs(auditLogsTotalPages)} disabled={auditLogsPage === auditLogsTotalPages}
                className="px-2 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-30">»</button>
            </div>
          )}
        </div>
      )}
      </main>
      {showSyncDetailModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[700px] max-h-[85vh] overflow-hidden animate-in fade-in zoom-in">
            <div className="p-5 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" /></svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-800">Agent 상세</h3>
                    <p className="text-xs text-gray-500">{syncSelectedAgent?.company_name} · {syncSelectedAgent?.agent_name}</p>
                  </div>
                </div>
                <button onClick={() => setShowSyncDetailModal(false)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <div className="p-5 overflow-y-auto max-h-[calc(85vh-80px)]">
              {syncDetailLoading ? (
                <div className="text-center py-8 text-gray-500">로딩 중...</div>
              ) : syncAgentDetail ? (
                <>
                  {/* 기본 정보 */}
                  <div className="grid grid-cols-3 gap-3 mb-5">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-400 mb-1">버전</div>
                      <div className="font-medium text-gray-800">{syncAgentDetail.agent?.agent_version || '-'}</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-400 mb-1">OS</div>
                      <div className="font-medium text-gray-800 text-xs">{syncAgentDetail.agent?.os_info || '-'}</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-400 mb-1">상태</div>
                      <div>{getSyncOnlineBadge(syncAgentDetail.agent?.online_status)}</div>
                    </div>
                  </div>

                  {/* 통계 카드 */}
                  <div className="grid grid-cols-4 gap-3 mb-5">
                    <div className="bg-blue-50 rounded-lg p-3 text-center">
                      <div className="text-xl font-bold text-blue-700">{syncAgentDetail.stats?.total_syncs_today || 0}</div>
                      <div className="text-xs text-blue-500">오늘 동기화</div>
                    </div>
                    <div className="bg-red-50 rounded-lg p-3 text-center">
                      <div className="text-xl font-bold text-red-700">{syncAgentDetail.stats?.total_errors_today || 0}</div>
                      <div className="text-xs text-red-500">오늘 에러</div>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-3 text-center">
                      <div className="text-xl font-bold text-emerald-700">{(syncAgentDetail.stats?.total_customers || 0).toLocaleString()}</div>
                      <div className="text-xs text-emerald-500">총 고객</div>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-3 text-center">
                      <div className="text-xl font-bold text-purple-700">{(syncAgentDetail.stats?.total_purchases || 0).toLocaleString()}</div>
                      <div className="text-xs text-purple-500">총 구매</div>
                    </div>
                  </div>

                  {/* 동기화 이력 */}
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">최근 동기화 이력</h4>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-gray-500">시각</th>
                          <th className="px-3 py-2 text-left text-gray-500">타입</th>
                          <th className="px-3 py-2 text-left text-gray-500">모드</th>
                          <th className="px-3 py-2 text-right text-gray-500">건수</th>
                          <th className="px-3 py-2 text-right text-gray-500">성공</th>
                          <th className="px-3 py-2 text-right text-gray-500">실패</th>
                          <th className="px-3 py-2 text-right text-gray-500">소요</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {(syncAgentDetail.recent_logs || []).map((log: any) => (
                          <tr key={log.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-500">{log.started_at ? formatDateTimeShort(log.started_at) : '-'}</td>
                            <td className="px-3 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-xs ${log.sync_type === 'customers' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                                {log.sync_type === 'customers' ? '고객' : '구매'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-500">{log.mode === 'full' ? '전체' : '증분'}</td>
                            <td className="px-3 py-2 text-right text-gray-700">{log.total_count || 0}</td>
                            <td className="px-3 py-2 text-right text-green-600">{log.success_count || 0}</td>
                            <td className="px-3 py-2 text-right">
                              <span className={log.fail_count > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>{log.fail_count || 0}</span>
                            </td>
                            <td className="px-3 py-2 text-right text-gray-500">{log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}초` : '-'}</td>
                          </tr>
                        ))}
                        {(!syncAgentDetail.recent_logs || syncAgentDetail.recent_logs.length === 0) && (
                          <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-400">동기화 이력이 없습니다.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-gray-400">데이터를 불러올 수 없습니다.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sync 설정 변경 모달 */}
      {showSyncConfigModal && syncSelectedAgent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden animate-in fade-in zoom-in">
            <div className="p-5 border-b bg-gradient-to-r from-gray-50 to-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-800">동기화 설정</h3>
                  <p className="text-xs text-gray-500">{syncSelectedAgent.company_name} · {syncSelectedAgent.agent_name}</p>
                </div>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs text-gray-500 font-medium mb-1.5 block">고객 동기화 주기 (분)</label>
                <input
                  type="number"
                  min={5}
                  value={syncConfigForm.sync_interval_customers}
                  onChange={(e) => setSyncConfigForm({ ...syncConfigForm, sync_interval_customers: parseInt(e.target.value) || 5 })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium mb-1.5 block">구매 동기화 주기 (분)</label>
                <input
                  type="number"
                  min={5}
                  value={syncConfigForm.sync_interval_purchases}
                  onChange={(e) => setSyncConfigForm({ ...syncConfigForm, sync_interval_purchases: parseInt(e.target.value) || 5 })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <p className="text-xs text-gray-400">Agent가 다음 config 조회 시 변경사항이 반영됩니다.</p>
            </div>
            <div className="flex border-t">
              <button
                onClick={() => setShowSyncConfigModal(false)}
                className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
              >
                취소
              </button>
              <button
                onClick={handleSyncConfigSave}
                className="flex-1 px-4 py-3 text-blue-600 font-medium hover:bg-blue-50 transition-colors"
              >
                저장하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sync 명령 전송 모달 */}
      {showSyncCommandModal && syncSelectedAgent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden animate-in fade-in zoom-in">
            <div className="p-5 border-b bg-gradient-to-r from-emerald-50 to-green-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-800">Agent 명령 전송</h3>
                  <p className="text-xs text-gray-500">{syncSelectedAgent.company_name} · {syncSelectedAgent.agent_name}</p>
                </div>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <label className="text-xs text-gray-500 font-medium mb-1.5 block">명령 유형</label>
              <div className="space-y-2">
                <label className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${syncCommandType === 'full_sync' ? 'border-emerald-500 bg-emerald-50' : 'hover:bg-gray-50'}`}>
                  <input type="radio" name="cmdType" value="full_sync" checked={syncCommandType === 'full_sync'} onChange={() => setSyncCommandType('full_sync')} className="text-emerald-600" />
                  <div>
                    <div className="text-sm font-medium text-gray-800">전체 동기화</div>
                    <div className="text-xs text-gray-500">모든 고객/구매 데이터를 다시 동기화합니다</div>
                  </div>
                </label>
                <label className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${syncCommandType === 'restart' ? 'border-emerald-500 bg-emerald-50' : 'hover:bg-gray-50'}`}>
                  <input type="radio" name="cmdType" value="restart" checked={syncCommandType === 'restart'} onChange={() => setSyncCommandType('restart')} className="text-emerald-600" />
                  <div>
                    <div className="text-sm font-medium text-gray-800">Agent 재시작</div>
                    <div className="text-xs text-gray-500">Agent 프로세스를 재시작합니다</div>
                  </div>
                </label>
              </div>
              <p className="text-xs text-gray-400">Agent가 다음 config 조회 시 명령을 실행합니다.</p>
            </div>
            <div className="flex border-t">
              <button
                onClick={() => setShowSyncCommandModal(false)}
                className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
              >
                취소
              </button>
              <button
                onClick={handleSyncCommand}
                className="flex-1 px-4 py-3 text-emerald-600 font-medium hover:bg-emerald-50 transition-colors"
              >
                명령 전송
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 플랜 신청 거절 모달 */}
      {showRejectModal && rejectTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-center text-gray-900 mb-2">플랜 신청 거절</h3>
              <p className="text-sm text-center text-gray-600 mb-4">
                <strong>{rejectTarget.company_name}</strong>의<br/>
                {rejectTarget.requested_plan_name} 플랜 신청을 거절합니다.
              </p>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  거절 사유 *
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 outline-none resize-none"
                  rows={3}
                  placeholder="거절 사유를 입력해주세요."
                />
              </div>
            </div>
            <div className="flex border-t">
              <button
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectTarget(null);
                  setRejectReason('');
                }}
                className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
              >
                취소
              </button>
              <button
                onClick={handleRejectRequest}
                className="flex-1 px-4 py-3 text-red-600 font-medium hover:bg-red-50 transition-colors"
              >
                거절하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 충전 승인 확인 모달 */}
      {showDepositApproveModal && depositTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden animate-in fade-in zoom-in">
            <div className="p-5 border-b bg-gradient-to-r from-emerald-50 to-green-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-xl">✅</div>
                <div>
                  <h3 className="text-lg font-bold text-gray-800">충전 승인</h3>
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
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>
            <div className="flex border-t">
              <button
                onClick={() => { setShowDepositApproveModal(false); setDepositTarget(null); setDepositAdminNote(''); }}
                className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
              >
                취소
              </button>
              <button
                onClick={handleApproveDeposit}
                className="flex-1 px-4 py-3 text-emerald-600 font-medium hover:bg-emerald-50 transition-colors"
              >
                승인하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 충전 거절 모달 */}
      {showDepositRejectModal && depositTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden animate-in fade-in zoom-in">
            <div className="p-5 border-b bg-red-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center text-xl">❌</div>
                <div>
                  <h3 className="text-lg font-bold text-gray-800">충전 거절</h3>
                  <p className="text-xs text-gray-500">{depositTarget.company_name} · {Number(depositTarget.amount).toLocaleString()}원</p>
                </div>
              </div>
            </div>
            <div className="p-5">
              <label className="text-xs text-gray-500 font-medium mb-1.5 block">거절 사유 *</label>
              <textarea
                value={depositAdminNote}
                onChange={(e) => setDepositAdminNote(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 outline-none resize-none"
                rows={3}
                placeholder="거절 사유를 입력해주세요."
              />
            </div>
            <div className="flex border-t">
              <button
                onClick={() => { setShowDepositRejectModal(false); setDepositTarget(null); setDepositAdminNote(''); }}
                className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
              >
                취소
              </button>
              <button
                onClick={handleRejectDeposit}
                className="flex-1 px-4 py-3 text-red-600 font-medium hover:bg-red-50 transition-colors"
              >
                거절하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 고객 개별/선택 삭제 확인 모달 (최상위) ===== */}
      {showAdminCustDeleteModal && adminCustDeleteTarget && editCompany && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[70]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-center text-gray-900 mb-2">
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
                className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">취소</button>
              <button onClick={executeAdminCustDelete} disabled={adminCustDeleteLoading}
                className="flex-1 px-4 py-3 text-red-600 font-bold hover:bg-red-50 transition-colors disabled:opacity-50">
                {adminCustDeleteLoading ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 고객 전체 삭제 확인 모달 (최상위) ===== */}
      {showCustomerDeleteAll && editCompany && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[70]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-center text-gray-900 mb-2">⚠️ 고객 데이터 전체 삭제</h3>
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
                  className="w-full px-3 py-2 border border-red-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 outline-none"
                />
              </div>
            </div>
            <div className="flex border-t">
              <button onClick={() => { setShowCustomerDeleteAll(false); setCustomerDeleteConfirmName(''); }}
                className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">취소</button>
              <button
                onClick={handleCustomerDeleteAll}
                disabled={customerDeleteConfirmName !== editCompany.companyName || customerDeleteLoading}
                className="flex-1 px-4 py-3 text-red-600 font-bold hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {customerDeleteLoading ? '삭제 중...' : '전체 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
