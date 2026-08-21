import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { companiesApi, plansApi, billingApi, unitPriceApi } from '../api/client';
import { previewUnitPrice, fmtPrice, toSupplyInputs } from '../utils/unitPrice'; // ★ 2026-07-26 단가 = VAT 별도 공급가
import { useAuthStore } from '../stores/authStore';
import { formatDateTime, formatDate, formatDateTimeShort, formatCampaignMessageForDisplay, getAlimtalkTemplateStatus, kstTodayStr } from '../utils/formatDate';
import SessionTimer from '../components/SessionTimer';
import AlimtalkSendersSection from '../components/alimtalk/AlimtalkSendersSection'; // ★ D130
import TablePagination from '../components/common/TablePagination'; // ★ 2026-07-20 목록 공용 페이저
import MessageDetailModal from '../components/MessageDetailModal'; // ★ D144 후속: 발송 상세 내역 모달의 메시지 셀 클릭 시 표시 + 복사
import SearchableSelect from '../components/SearchableSelect'; // ★ D144 P11+P13: 검색 가능 select (사용자 추가 소속회사 + 발송통계 회사 필터)
// ★ 2026-07-31 정산 메일 수신자 — 담당자 이메일 칸 하나를 유형별·복수 행 편집으로 대체
import BillingRecipientsEditor, { type BillingRecipient } from '../components/BillingRecipientsEditor';
import LoginBlocksManagement from '../components/admin/LoginBlocksManagement'; // ★ D145 P0 (2026-05-07): 로그인 차단 관리 (B안: IP+loginId 쌍)
import AgentChargePanel from '../components/AgentChargePanel'; // ★ 2026-07-24 §5-3 에이전트 충전 실행 (게이트웨이 지갑)
import AgentDeployWizard from '../components/admin/AgentDeployWizard'; // 싱크에이전트 OS별 배포 위저드
import DiagnosisAdminPanel from '../components/admin/DiagnosisAdminPanel'; // ★ 2026-08-16 신규마케팅진단(ceo 전용)
import { COMPANY_EMAIL } from '../constants/company';
import { formatAgentIdLabel } from '../utils/agentLabel'; // ★ 2026-07-27 발송ID 표시 규칙 단일 소스(발급명 병기)
import { formatPlanOptionLabel } from '../utils/planLabel'; // ★ 2026-07-28 요금제 라벨 = 월정액(고객 수 축 폐기)
import { taxbillIssueDatePreviewText, type TaxbillDayPolicy } from '../utils/taxbillDate'; // ★ 2026-07-28 작성일자 미리보기(예시 월 하드코딩 제거)
// ★ 2026-08-04 IMC 이관 모달 — 템플릿 화면에서는 이미 연결된 프로필로 템플릿만 가져온다(templateOnly)
import ImcProfileImportModal from '../components/alimtalk/ImcProfileImportModal';
import Billing080Modal from '../components/Billing080Modal'; // ★ 2026-07-30 추가 청구 관리 (서수란 접수 — 080 KT 명세서 분할 + 부가서비스 수기)
import MinimumChargeModal from '../components/MinimumChargeModal'; // ★ 2026-07-30 최소과금 정액 발행 (Harold 확정)
import SettlementOverviewModal from '../components/SettlementOverviewModal'; // ★ 2026-08-05 총 정산표 (ceo 전용)
import QtyAdjustModal, { type QtyAdjustTarget } from '../components/QtyAdjustModal'; // ★ 2026-08-04 수량 수정 발행 (서수란 접수)
import { creditTxLabel } from '../constants/credit'; // 크레딧 사용 이력 작업명 라벨
import { resolveChannelLabel, resolveSendTypeChipClass, resolveSendTypeLabel } from '../utils/campaign-axis';

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
  usage_type?: 'web' | 'agent' | 'both'; // ★ 2026-07-03 사용구분
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

  const [activeTab, setActiveTab] = useState<'companies' | 'users' | 'scheduled' | 'callbacks' | 'plans' | 'requests' | 'deposits' | 'credits' | 'allCampaigns' | 'stats' | 'billing' | 'syncAgents' | 'auditLogs' | 'lineGroups' | 'templates' | 'loginBlocks' | 'agentDeploy' | 'marketingDiagnosis' | 'spamBlock' | 'geoAccess'>('companies');
  // ★ 2026-06-11: 감사 로그 열람 권한 (AUDIT_LOG_VIEWER_IDS — 기본 ceo 전용) — 허용 계정에만 메뉴/탭 노출
  const [auditAccessAllowed, setAuditAccessAllowed] = useState(false);
  // ★ 2026-06-13: AI 학습 데이터 열람 권한 (AI_TRAINING_VIEWER_IDS — 기본 ceo 전용) — 허용 계정에만 진입 버튼 노출
  const [aiTrainingAllowed, setAiTrainingAllowed] = useState(false);
  // ★ 2026-07-17: 발송 라인 설정 권한 (LINE_GROUP_ADMIN_USERS — 기본 ceo,admin) — 허용 계정에만 메뉴/탭 노출.
  //   판정은 백엔드 GET /line-groups 응답의 canManage가 유일한 소스 — 프론트 자체 판정 금지.
  const [lineGroupCanManage, setLineGroupCanManage] = useState(false);
  // ★ 2026-08-16: 신규마케팅진단 열람 권한 (MARKETING_DIAGNOSIS_VIEWER_IDS — 기본 ceo 전용) + 신규 리드 뱃지
  const [diagnosisAllowed, setDiagnosisAllowed] = useState(false);
  const [diagnosisBadge, setDiagnosisBadge] = useState(0);
  const loadDiagnosisBadge = async () => {
    try {
      const token = localStorage.getItem('token');
      const r = await fetch('/api/admin/marketing-diagnosis/badge', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return;                        // 404(비허용·게이트 은닉) = 미렌더 유지
      const d = await r.json();
      if (d?.success) setDiagnosisBadge(Number(d.count) || 0);
    } catch { /* 뱃지 실패 = 0 유지 */ }
  };
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // 드롭다운: 단일 클릭 열림 고정 + 바깥 클릭·ESC 닫힘 (두 번 클릭 경합 제거)
  useEffect(() => {
    if (!openMenu) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenu(null); };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);
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
    industryCode: '',
    address: '',
    sendHourStart: 9,
    sendHourEnd: 21,
    dailyLimit: 0,
    duplicateDays: 7,
    // ★ 2026-07-26 단가는 **부가세 별도(공급가)** 입력이다. 빈 값 = 미설정(청구가 막힌다).
    //   기본 상수를 채워 두면 미설정 회사가 그 값으로 저장돼 조용히 계약과 다른 단가가 굳는다.
    costPerSms: '' as string | number,
    costPerLms: '' as string | number,
    costPerMms: '' as string | number,
    costPerKakao: '' as string | number,
    // ★ 2026-07-29 브랜드메시지(구 친구톡) — 알림톡과 다른 단가다. 비우면 청구·차감이 막힌다.
    costPerBrand: '' as string | number,
    costPerTestSms: '' as string | number,
    costPerTestLms: '' as string | number,
    unitPriceBasis: 'vat_included' as 'vat_included' | 'vat_excluded',
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
    lineGroupId: '',
    kakaoEnabled: false,
    userIsolationEnabled: false,  // ★ D162-3 (2026-05-15) 수신거부 사용자격리 ON/OFF
    usageType: 'web',  // ★ 2026-07-03 사용구분: web(웹발송) / agent(QTmsg 에이전트 전용) / both(웹+에이전트)
    useAiOrchestrator: false,  // ★ D190 #2 (2026-05-22) AI Orchestrator Tool Use 회사별 토글
    cdpAutoExecuteEnabled: false,  // ★ 2026-06-06 자동마케팅 자율발송 게이트
    cdpAutoExecuteMaxRecipients: 1000,
    cdpAutoExecuteMaxCostKrw: 50000,
    cdpAutoExecuteMaxRisk: 'low',
    subscriptionStatus: 'trial',
    // ★ CT-17: 30일 PRO 체험 관리 (표시용)
    trialExpiresAt: '' as string | null | '',
    planCode: '',
    // ★ D219+ Part 2 (2026-05-27): AI 오퍼레이션 30일 무료체험 분리 흐름 (기존 PRO 무료체험과 별도)
    aiOperatorTrialStartedAt: '' as string | null | '',
    aiOperatorTrialUntil: '' as string | null | '',
  });
  // ★ 2026-07-28 'fields'(필터항목) → 'billing'(정산) 탭 교체
  // ★ 2026-08-18 금칙어 차단(전송자격인증 5.2) — 조합 규칙·시뮬레이션·탐지 이력
  const [spamRules, setSpamRules] = useState<any[]>([]);
  const [spamHits, setSpamHits] = useState<any[]>([]);
  const [spamRuleName, setSpamRuleName] = useState('');
  const [spamElements, setSpamElements] = useState<Array<{ type: string; value: string }>>([
    { type: 'keyword', value: '' },
    { type: 'keyword', value: '' },
  ]);
  const [spamSim, setSpamSim] = useState<any>(null);
  const [spamBusy, setSpamBusy] = useState(false);

  // ★ 2026-08-19 국외 접근 통제(전송자격인증 2.2) — 시행 스위치는 서버 env가 소유한다. 화면에 켜는 버튼을 두지 않는다.
  const [geoStatus, setGeoStatus] = useState<any>(null);
  const [geoExceptions, setGeoExceptions] = useState<any[]>([]);
  const [geoHits, setGeoHits] = useState<any[]>([]);
  const [geoCidrInput, setGeoCidrInput] = useState('');
  const [geoForm, setGeoForm] = useState({ scope: 'user', target: '', cidr: '', reason: '' });
  const [geoBusy, setGeoBusy] = useState(false);

  const loadGeoAccess = async () => {
    const token = localStorage.getItem('token');
    const headers = { 'Authorization': `Bearer ${token}` };
    const [statusRes, exRes, hitsRes] = await Promise.all([
      fetch('/api/admin/geo/status', { headers }),
      fetch('/api/admin/geo/exceptions', { headers }),
      fetch('/api/admin/geo/hits?limit=200', { headers }),
    ]);
    if (statusRes.ok) setGeoStatus(await statusRes.json());
    if (exRes.ok) setGeoExceptions((await exRes.json()).exceptions || []);
    if (hitsRes.ok) setGeoHits((await hitsRes.json()).hits || []);
  };

  const geoPost = async (url: string, body: any, method: string = 'POST') => {
    const token = localStorage.getItem('token');
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({} as any));
    return { ok: res.ok, data };
  };

  const handleGeoCidrBulk = async () => {
    setGeoBusy(true);
    try {
      const { ok, data } = await geoPost('/api/admin/geo/cidrs/bulk', { cidrs: geoCidrInput });
      if (!ok) { showAlert('오류', data?.error || '대역 등록에 실패했습니다.', 'error'); return; }
      setGeoCidrInput('');
      await loadGeoAccess();
      showAlert('성공', `${Number(data.replaced).toLocaleString()}개 대역으로 교체되었습니다(이전 ${Number(data.before).toLocaleString()}개).`, 'success');
    } finally { setGeoBusy(false); }
  };

  const handleGeoExceptionCreate = async () => {
    setGeoBusy(true);
    try {
      const payload: any = { scope: geoForm.scope, cidr: geoForm.cidr.trim(), reason: geoForm.reason.trim() };
      if (geoForm.scope === 'user') payload.userId = geoForm.target.trim();
      else if (geoForm.scope !== 'global') payload.companyId = geoForm.target.trim();
      const { ok, data } = await geoPost('/api/admin/geo/exceptions', payload);
      if (!ok) { showAlert('오류', data?.error || '예외 등록에 실패했습니다.', 'error'); return; }
      setGeoForm({ scope: 'user', target: '', cidr: '', reason: '' });
      await loadGeoAccess();
      showAlert('성공', '예외가 승인되었습니다. 승인자와 사유가 이력에 남습니다.', 'success');
    } finally { setGeoBusy(false); }
  };

  const handleGeoExceptionRevoke = async (id: string) => {
    const { ok, data } = await geoPost(`/api/admin/geo/exceptions/${id}`, {}, 'DELETE');
    if (!ok) { showAlert('오류', data?.error || '회수에 실패했습니다.', 'error'); return; }
    await loadGeoAccess();
  };

  const loadSpamBlock = async () => {
    const token = localStorage.getItem('token');
    const headers = { 'Authorization': `Bearer ${token}` };
    const [rulesRes, hitsRes] = await Promise.all([
      fetch('/api/admin/spam-block/rules', { headers }),
      fetch('/api/admin/spam-block/hits?limit=100', { headers }),
    ]);
    if (rulesRes.ok) setSpamRules((await rulesRes.json()).rules || []);
    if (hitsRes.ok) setSpamHits((await hitsRes.json()).hits || []);
  };

  const spamElementsPayload = () => spamElements.filter((e) => e.value.trim()).map((e) => ({ type: e.type, value: e.value.trim() }));

  // ★ 규칙을 등록하기 전에 실제 발송 문안으로 돌려본다 — 정상 문자가 잡히는지 눈으로 본다
  const handleSpamSimulate = async () => {
    setSpamBusy(true);
    setSpamSim(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/spam-block/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ elements: spamElementsPayload(), days: 7 }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) { showAlert('오류', data?.error || '시뮬레이션에 실패했습니다.', 'error'); return; }
      setSpamSim(data);
    } finally { setSpamBusy(false); }
  };

  const handleSpamCreate = async () => {
    if (!spamRuleName.trim()) { showAlert('확인', '규칙 이름을 입력해주세요.', 'error'); return; }
    setSpamBusy(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/spam-block/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name: spamRuleName.trim(), elements: spamElementsPayload() }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) { showAlert('오류', data?.error || '규칙 생성에 실패했습니다.', 'error'); return; }
      setSpamRuleName('');
      setSpamElements([{ type: 'keyword', value: '' }, { type: 'keyword', value: '' }]);
      setSpamSim(null);
      await loadSpamBlock();
      showAlert('성공', '규칙이 등록되었습니다. 탐지 이력에서 무엇이 걸리는지 확인해주세요.', 'success');
    } finally { setSpamBusy(false); }
  };

  // ★ 2026-08-18 발신번호 회선 정책(전송자격인증 2.1) — 상한은 신규 등록에만 걸린다(기존 보유분 불변)
  const [linePolicy, setLinePolicy] = useState<{
    subscriberType: string | null;
    mobileLineLimit: number | null;
    landlineLineLimit: number | null;
    effective: { mobile: number | null; landline: number | null; source: string };
    held: { mobile: number; landline: number };
  } | null>(null);
  const [linePolicySaving, setLinePolicySaving] = useState(false);

  const [editCompanyTab, setEditCompanyTab] = useState<'basic' | 'send' | 'cost' | 'ai' | 'store' | 'billing' | 'cards' | 'customers' | 'sync'>('basic');
  // ★ 2026-07-21 문안 생성 참조 업종 목록 — SSOT=백엔드 industry-codes.ts (프론트 하드코딩 금지, GET /api/admin/industry-codes)
  const [industryOptions, setIndustryOptions] = useState<Array<{ code: string; label: string }>>([]);
  const [standardFields, setStandardFields] = useState<any[]>([]);
  const [enabledFields, setEnabledFields] = useState<string[]>([]);
  const [fieldDataCheck, setFieldDataCheck] = useState<Record<string, { hasData: boolean; count: number }>>({});
  // SyncAgent API Key 관리
  const [syncKeys, setSyncKeys] = useState<{ api_key: string | null; api_secret: string | null; use_db_sync: boolean }>({ api_key: null, api_secret: null, use_db_sync: false });
  const [syncKeyVisible, setSyncKeyVisible] = useState(false);
  const [syncSecretVisible, setSyncSecretVisible] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [showSyncRegenConfirm, setShowSyncRegenConfirm] = useState(false);
  // D41 대시보드 카드 설정
  const [dashboardCardIds, setDashboardCardIds] = useState<string[]>([]);
  // ★ D142+ (2026-04-29) 카드 순서 변경 — 드래그 중인 카드의 index (선택된 카드 영역 내부)
  const [draggedCardIdx, setDraggedCardIdx] = useState<number | null>(null);
  const [dashboardCardCount, setDashboardCardCount] = useState<number>(0); // 선택된 카드 수 (제한 없음, 6개씩 페이징 표시)
  // ★ D80: 하드코딩 풀 제거 → API 응답의 동적 필터링된 풀 사용 (고객사 DB 데이터 유무 기반)
  const [dashboardCardPool, setDashboardCardPool] = useState<{ cardId: string; label: string; emoji: string; description: string }[]>([]);
  // 전체 캠페인
const [allCampaigns, setAllCampaigns] = useState<any[]>([]);
const [allCampaignsTotal, setAllCampaignsTotal] = useState(0);
const [allCampaignsPage, setAllCampaignsPage] = useState(1);
const [allCampaignsSearch, setAllCampaignsSearch] = useState('');
const [allCampaignsStatus, setAllCampaignsStatus] = useState('');
const [allCampaignsCompany, setAllCampaignsCompany] = useState('');
// 발송 통계
const [sendStats, setSendStats] = useState<any>(null);
const [statsChannel, setStatsChannel] = useState<'web' | 'agent'>('web'); // ★ 2026-07-23 웹/에이전트 구분 탭
const [statsView, setStatsView] = useState<'daily' | 'monthly'>('daily');
const [statsStartDate, setStatsStartDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }));
const [statsEndDate, setStatsEndDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }));
const [statsCompanyFilter, setStatsCompanyFilter] = useState('');
const [statsPage, setStatsPage] = useState(1);
// ★ 2026-07-28 (서수란) 에이전트 탭은 서버가 전량 반환하는 축이라 여기서 자른다.
//   페이징이 없어 일자를 넓게 잡으면 행이 아래로 끝없이 이어졌다.
const [agentStatsPage, setAgentStatsPage] = useState(1);
const AGENT_STATS_PER_PAGE = 20;
const agentStatsRows: any[] = sendStats?.agentRows || [];
const agentStatsTotalPages = Math.max(1, Math.ceil(agentStatsRows.length / AGENT_STATS_PER_PAGE));
// 조회 조건이 바뀌어 행 수가 줄면 현재 페이지가 범위 밖이 된다 — 마지막 페이지로 당겨 빈 화면을 막는다.
const agentStatsSafePage = Math.min(Math.max(1, agentStatsPage), agentStatsTotalPages);
useEffect(() => { if (agentStatsPage !== agentStatsSafePage) setAgentStatsPage(agentStatsSafePage); }, [agentStatsPage, agentStatsSafePage]);
// 새로 조회하면 1페이지부터 — 옛 페이지 번호가 남아 다른 기간의 중간 페이지가 열리지 않게.
useEffect(() => { setAgentStatsPage(1); }, [sendStats]);
const [statsTotal, setStatsTotal] = useState(0);
const [statsDetail, setStatsDetail] = useState<any>(null);
const [statsDetailLoading, setStatsDetailLoading] = useState(false);
const [statsDetailInfo, setStatsDetailInfo] = useState<{ date: string; companyName: string } | null>(null);
// ★ D102: 메시지 내용 상세 모달
const [messageDetailContent, setMessageDetailContent] = useState<{ name: string; content: string } | null>(null);
  // 예약 캠페인 관리
  const [scheduledCampaigns, setScheduledCampaigns] = useState<any[]>([]);
  const [scheduledTotal, setScheduledTotal] = useState(0);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; name: string } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [scheduledPage, setScheduledPage] = useState(1);
  const scheduledPerPage = 20;
  const [scheduledSearch, setScheduledSearch] = useState('');
  const [scheduledCompanyFilter, setScheduledCompanyFilter] = useState('');
  const [scheduledStatusFilter, setScheduledStatusFilter] = useState('');
  const [scheduledStartDate, setScheduledStartDate] = useState('');
  const [scheduledEndDate, setScheduledEndDate] = useState('');
  const [scheduledLoginId, setScheduledLoginId] = useState('');

  // SMS 상세 조회 모달
  const [smsDetailModal, setSmsDetailModal] = useState(false);
  const [smsDetailCampaign, setSmsDetailCampaign] = useState<any>(null);
  const [smsDetailRows, setSmsDetailRows] = useState<any[]>([]);
  const [smsDetailTotal, setSmsDetailTotal] = useState(0);
  const [smsDetailPage, setSmsDetailPage] = useState(1);
  const [smsDetailStatus, setSmsDetailStatus] = useState('');
  const [smsDetailSearchType, setSmsDetailSearchType] = useState('dest_no');
  const [smsDetailSearchValue, setSmsDetailSearchValue] = useState('');
  const [smsDetailLoading, setSmsDetailLoading] = useState(false);
  // ★ D144 후속: 메시지 셀 클릭 시 전체 메시지 + 복사 버튼 모달
  const [smsDetailMsgModal, setSmsDetailMsgModal] = useState<string | null>(null);

  // 전체 캠페인 날짜필터
  const [allCampaignsStartDate, setAllCampaignsStartDate] = useState(kstTodayStr());
  const [allCampaignsEndDate, setAllCampaignsEndDate] = useState(kstTodayStr());

  // 사용자 검색/필터
  const [userSearch, setUserSearch] = useState('');
  const [userCompanyFilter, setUserCompanyFilter] = useState('all');
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  // ★ 회사 그룹 20개씩 페이지네이션
  const [userPage, setUserPage] = useState(1);
  const USERS_COMPANIES_PER_PAGE = 20;

  // 발신번호 관리
  const [callbackNumbers, setCallbackNumbers] = useState<any[]>([]);
  const [showCallbackModal, setShowCallbackModal] = useState(false);
  const [callbackSearch, setCallbackSearch] = useState('');
  const [expandedCallbackCompanies, setExpandedCallbackCompanies] = useState<Set<string>>(new Set());
  // ★ D135+ (B10): 회사별 발신번호 페이지네이션 — 한 회사당 160개 등 무한 스크롤 방지, 10개씩 페이징
  const [callbackCompanyPages, setCallbackCompanyPages] = useState<Record<string, number>>({});
  const CALLBACKS_PER_COMPANY_PAGE = 10;
  // ★ 2026-07-25 (서수란) 회사 목록 자체가 무페이징이라 화면이 아래로 끝없이 늘어남 → 회사 단위 페이징.
  //   회사별 번호 페이징(위)은 이미 있었고, 바깥 회사 루프만 빠져 있었다.
  const [callbackCompanyListPage, setCallbackCompanyListPage] = useState(1);
  const CALLBACK_COMPANIES_PER_PAGE = 20;
  const [newCallback, setNewCallback] = useState({
    companyId: '',
    phone: '',
    label: '',
    isDefault: false,
  });

  // 발신번호 등록 신청 관리
  const [callbackSubTab, setCallbackSubTab] = useState<'manage' | 'registrations' | 'managers'>('manage');
  const [senderRegistrations, setSenderRegistrations] = useState<any[]>([]);
  const [senderRegFilter, setSenderRegFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [senderRegLoading, setSenderRegLoading] = useState(false);
  const [senderRegDetail, setSenderRegDetail] = useState<any>(null);
  const [showSenderRegDetailModal, setShowSenderRegDetailModal] = useState(false);
  const [rejectReasonInput, setRejectReasonInput] = useState('');
  const [senderRegPendingCount, setSenderRegPendingCount] = useState(0);

  // 담당자 위임장 승인 관리
  const [pendingManagers, setPendingManagers] = useState<any[]>([]);
  const [pendingManagerCount, setPendingManagerCount] = useState(0);
  const [mgrRejectId, setMgrRejectId] = useState<string | null>(null);
  const [mgrRejectReason, setMgrRejectReason] = useState('');
  const [mgrFilter, setMgrFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [mgrSearch, setMgrSearch] = useState('');
  const [allManagers, setAllManagers] = useState<any[]>([]);

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
  // 종량제 Phase 4: 회사별 AI 크레딧 관리 (_forId = 현재 editCompany와 일치할 때만 표시)
  const [companyCredit, setCompanyCredit] = useState<any>(null);
  const [creditAdj, setCreditAdj] = useState<{ type: string; amount: string; reason: string; busy: boolean }>({ type: 'grant', amount: '', reason: '', busy: false });
  const [newPlan, setNewPlan] = useState({
    planCode: '',
    planName: '',
    maxCustomers: 1000,
    monthlyPrice: 0,
  });

  // 충전 관리 (통합)
  const [chargeTxList, setChargeTxList] = useState<any[]>([]);
  const [chargeTxPage, setChargeTxPage] = useState(1);
  const [chargeTxTotal, setChargeTxTotal] = useState(0);
  const chargeTxPerPage = 15;
  const [chargeTxCompanyFilter, setChargeTxCompanyFilter] = useState('all');
  const [chargeTxTypeFilter, setChargeTxTypeFilter] = useState('all');
  const [chargeTxMethodFilter, setChargeTxMethodFilter] = useState('all');
  const [chargeTxStartDate, setChargeTxStartDate] = useState('');
  const [chargeTxEndDate, setChargeTxEndDate] = useState('');
  const [chargeTxLoading, setChargeTxLoading] = useState(false);
  const [pendingDeposits, setPendingDeposits] = useState<any[]>([]);
  // ★ 2026-08-11 (서수란 접수) 요금/정산 뱃지의 **단일 진실**.
  //   목록 길이(`pendingDeposits.length`)를 뱃지로 쓰던 옛 방식은 두 곳(목록·뱃지)이 갈릴 수 있고,
  //   크레딧처럼 목록이 페이지 단위로 잘리는 축에서는 대기 25건이 20으로 보인다.
  //   여기 값은 60초 주기 카운트 조회 + 목록 로드가 함께 채운다. 못 센 축은 서버가 null을 주고 직전 값을 지킨다.
  const [planReqPendingCount, setPlanReqPendingCount] = useState(0);
  const [depositPendingCount, setDepositPendingCount] = useState(0);
  const [agentOrderPendingCount, setAgentOrderPendingCount] = useState(0);
  const [creditPendingCount, setCreditPendingCount] = useState(0);
  const [showDepositApproveModal, setShowDepositApproveModal] = useState(false);
  const [showDepositRejectModal, setShowDepositRejectModal] = useState(false);
  const [depositTarget, setDepositTarget] = useState<any>(null);
  const [depositAdminNote, setDepositAdminNote] = useState('');
  const [creditRequests, setCreditRequests] = useState<any[]>([]); // AI 크레딧 충전 요청 (후불 승인 대기)
  const [creditRiskCompanies, setCreditRiskCompanies] = useState<any[]>([]); // 크레딧 위험 회사 (소진·마이너스 — v2)
  const [predictiveRunning, setPredictiveRunning] = useState(false); // 예측 일괄 수동 실행 진행 상태
  const [creditPanel, setCreditPanel] = useState<'requests' | 'risk' | 'predictive' | null>(null); // 크레딧 탭 타일 → 모달
  // 크레딧 사용 이력 (전체 회사 — 크레딧 관리 탭)
  const [creditTxAll, setCreditTxAll] = useState<any[]>([]);
  const [creditTxPage, setCreditTxPage] = useState(1);
  const [creditTxTotalPages, setCreditTxTotalPages] = useState(1);
  const [creditTxCompany, setCreditTxCompany] = useState('');
  const [creditTxLoading, setCreditTxLoading] = useState(false);

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
// ★ 2026-08-20 정산월(라벨) — 서수란 0819 접수. "몇 월분인가"는 사람이 정한다(기본 = 종료일의 역월).
//   서버 resolveBillingLabelMonth와 같은 규약: 허용 = 정산 기간에 걸친 역월뿐. 여기 계산은 표시·선택용이고
//   최종 검증은 서버가 한다(기간 밖 422). 'YYYY-MM' 문자열 산술만 — Date 파싱 없음(TZ 무관).
const [billingLabelMonth, setBillingLabelMonth] = useState('');
const billingMonthsBetween = (startDay: string, endDay: string): string[] => {
  const s = String(startDay).slice(0, 7), e = String(endDay).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(s) || !/^\d{4}-\d{2}$/.test(e) || s > e) return [];
  const out: string[] = [];
  let y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7));
  while (out.length < 24) { // 24개월 상한 — 잘못된 기간 입력의 무한 루프 차단
    const cur = `${y}-${String(m).padStart(2, '0')}`;
    out.push(cur);
    if (cur === e) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
};
const billingLabelOptions = billingMonthsBetween(billingStart, billingEnd);
// 기간을 바꾸면 옛 선택이 집합 밖으로 나갈 수 있다 — 그때는 조용히 기본값(종료월)으로 돌아간다.
const billingLabelEffective = billingLabelOptions.includes(billingLabelMonth)
  ? billingLabelMonth
  : (billingLabelOptions[billingLabelOptions.length - 1] || '');
const billingLabelText = (ym: string) => ym ? `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월` : '';
// ※ 옛 billingUserId·billingUsers 상태는 폐기(2026-07-26) — 단일 계정 발행이 서버에서 차단됐다.
const [generating, setGenerating] = useState(false);
const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);
// ★ 2026-08-04 발행 전 점검 — `/preview`(발행과 같은 집계 함수)를 확인 모달에서 먼저 보여준다.
//   이 엔드포인트는 만들어진 뒤 화면에 붙은 적이 없어(호출부 0건), 막힐 이유를 발행을 눌러야 알았다.
const [billingPreviewLoading, setBillingPreviewLoading] = useState(false);
const [billingPreview, setBillingPreview] = useState<any>(null);
const [billings, setBillings] = useState<any[]>([]);
const [billingsLoading, setBillingsLoading] = useState(false);
const [filterYear, setFilterYear] = useState(new Date().getFullYear());
// ★ 2026-08-20 정산월 필터 — 0 = 전체(서수란 0819 접수 "년도 관리가 아닌 월별 관리"). 서버 축(billing_month).
const [filterMonth, setFilterMonth] = useState(0);
// ★ 2026-07-28 발행됨·미발송만 보기 토글 (emailed_at IS NULL)
const [billingUnsentOnly, setBillingUnsentOnly] = useState(false);
// ★ 2026-08-20 목록의 필터 귀속(Codex 3R 수용) — "이 목록이 어느 필터의 것인가"를 목록 상태가 직접 든다.
//   요청 순서(seq)만 보면 실패 경로(전환 요청 실패 → 옛 달 목록 잔존)와 옛 클로저 경로(벌크 종료 후
//   옛 필터로 재조회)가 남는다. 요청은 항상 ref의 **호출 시점 최신 키**로 나가고, 응답은 도착 시점
//   키와 일치할 때만 반영하며, 최신 키 요청이 실패하면 목록을 비운다(fail-closed — 다른 달을 남기지 않는다).
const billingFilterKey = `${filterYear}|${filterMonth}|${billingUnsentOnly ? 1 : 0}`;
const billingFilterKeyRef = useRef(billingFilterKey);
billingFilterKeyRef.current = billingFilterKey;
const [billingsKey, setBillingsKey] = useState(''); // 마지막으로 적재 성공한 목록의 키('' = 미적재)
// ★ 2026-08-05 총 정산표(ceo 전용) — 권한이 확인된 계정에만 진입점을 그린다.
const [canViewSettlementOverview, setCanViewSettlementOverview] = useState(false);
const [showSettlementOverview, setShowSettlementOverview] = useState(false);
// 컨펌 메일 재시도 중인 장 — 같은 행을 연타해 중복 요청이 겹치지 않게 한다.
const [retryingBillingId, setRetryingBillingId] = useState<string | null>(null);
const [showBillingDetail, setShowBillingDetail] = useState(false);
const [detailBilling, setDetailBilling] = useState<any>(null);
const [detailItems, setDetailItems] = useState<any[]>([]);
// ★ 2026-07-26 항목 줄·정합 검사 — 서버(/items)가 PDF·이메일과 같은 함수로 만들어 내려준다.
//   화면이 따로 합산하면 그 값이 청구서와 갈릴 수 있다("화면 금액 ≠ 청구서 금액"은 정산에서 가장 나쁜 부류).
const [detailLines, setDetailLines] = useState<any[]>([]);
const [detailHeaderCheck, setDetailHeaderCheck] = useState<any>(null);
const [detailLoading, setDetailLoading] = useState(false);
const [showBillingDeleteConfirm, setShowBillingDeleteConfirm] = useState(false);
const [deleteTargetId, setDeleteTargetId] = useState('');
// ★ 2026-07-26 확정·수금·메일 발송분 삭제는 서버가 사유를 요구한다 — 없으면 422로 막힌다.
const [deleteReason, setDeleteReason] = useState('');

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
// ★ 2026-07-26 충전관리 서브탭 — 한줄로(웹 선불 잔액)와 에이전트(게이트웨이 지갑)는 **서로 다른 지갑**이다.
//   한 화면에 세로로 쌓아 두니 스크롤이 길어 어느 지갑을 보고 있는지 헷갈린다는 운영 지적.
const [chargeScope, setChargeScope] = useState<'web' | 'agent'>('web');
// ★ 2026-07-26 단가 저장 — 기본정보 저장과 분리한다. 단가는 부가세 기준(unit_price_basis)과
//   **한 문장에서** 써야 해서 전용 엔드포인트만 쓰고, 저장 즉시 그 회사의 청구·차감 기준이 전환된다.
const [savingUnitPrices, setSavingUnitPrices] = useState(false);
const [applyUnitPriceToAgents, setApplyUnitPriceToAgents] = useState(false);

// 정산서 이메일 발송
const [showEmailModal, setShowEmailModal] = useState(false);
const [emailTarget, setEmailTarget] = useState<any>(null);
const [emailTo, setEmailTo] = useState('');
// ★ 2026-07-31 등록된 정산 수신자 — **표시 전용**. 입력칸에 넣으면 override가 되어 참조가 떨어진다.
const [emailDefaultTo, setEmailDefaultTo] = useState<{ primary: string; cc: string[] } | null>(null);
const [emailSubject, setEmailSubject] = useState('');
const [emailSending, setEmailSending] = useState(false);
// ★ 2026-07-26 재발송 확인 — 값이 있으면 "이미 언제·누구에게 나갔다"를 보여주는 확인 단계가 열린다.
const [emailResendInfo, setEmailResendInfo] = useState<string | null>(null);
// 확인한 그 발송 시각(서버가 409로 알려준 값). 재발송 요청에 함께 보내 확인 대상이 바뀌었는지 서버가 판정한다.
const [emailResendAt, setEmailResendAt] = useState<string | null>(null);
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
  // ★ D131 후속(2026-04-21): Agent 삭제 모달 상태
  const [showSyncDeleteModal, setShowSyncDeleteModal] = useState(false);
  const [syncDeleting, setSyncDeleting] = useState(false);
  // ★ D131 후속(2026-04-21): 'pause' | 'resume' 추가 — 원격 동기화 제어
  // ★ 2026-07-10 원격 관리 P2: 진단 2종 추가 — report_logs(최근 로그 업로드)·test_connection(소스 DB 연결 테스트)
  const [syncCommandType, setSyncCommandType] = useState<'full_sync' | 'restart' | 'pause' | 'resume' | 'report_logs' | 'test_connection'>('full_sync');
  // ★ 2026-07-01: 원격 컬럼 매핑 편집(update_config) — 재설치 없이 슈퍼관리자에서 매핑 갱신
  const [showSyncMappingModal, setShowSyncMappingModal] = useState(false);
  const [syncMapCustomers, setSyncMapCustomers] = useState<Array<{ src: string; target: string; label: string }>>([]);
  const [syncMapPurchases, setSyncMapPurchases] = useState<Array<{ src: string; target: string; label: string }>>([]);
  const [syncMapSaving, setSyncMapSaving] = useState(false);
  // ★ 2026-07-10 원격 관리 P0: 매핑 모달 프리필 — 에이전트 자기 보고(reported) 로드.
  //   reported 없음(구버전 v1.6.1 미만·첫 heartbeat 전) = 저장 차단(빈 화면 저장 = 전체 매핑 소실 함정 봉쇄).
  const [syncMapReported, setSyncMapReported] = useState<any>(null);
  const [syncMapReportLoading, setSyncMapReportLoading] = useState(false);
  const [syncMapAckSupported, setSyncMapAckSupported] = useState(false);
  const [syncMapDryRunning, setSyncMapDryRunning] = useState(false);
  // ★ 2026-07-01: 자동 업데이트 릴리즈 등록 (박스 무선 교체 트리거)
  const [showSyncReleaseModal, setShowSyncReleaseModal] = useState(false);
  const [syncReleaseForm, setSyncReleaseForm] = useState<{ version: string; checksum: string; force_update: boolean; tier: string }>({ version: '', checksum: '', force_update: true, tier: 'win-legacy' });
  const [syncReleaseSaving, setSyncReleaseSaving] = useState(false);

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

  // ===== 발송 라인그룹 =====
  const [lineGroups, setLineGroups] = useState<any[]>([]);
  const [lineGroupsLoading, setLineGroupsLoading] = useState(false);
  // ★ 2026-07-17 발송 라인 설정 탭 — 생성/수정 모달 (null이면 닫힘). sms_tables는 화면에서 콤마 문자열로 다룬다.
  const [editingLineGroup, setEditingLineGroup] = useState<any | null>(null);
  const [lineGroupSaving, setLineGroupSaving] = useState(false);

  // ★ 2026-08-04 템플릿 화면의 IMC 가져오기(이미 연결된 프로필 기준) 모달
  const [showImcTemplateImport, setShowImcTemplateImport] = useState(false);
  // ===== 템플릿 관리 =====
  const [adminTemplates, setAdminTemplates] = useState<any[]>([]);
  const [adminRcsTemplates, setAdminRcsTemplates] = useState<any[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateFilter, setTemplateFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [templateSubTab, setTemplateSubTab] = useState<'alimtalk' | 'rcs'>('alimtalk');
  const [showManualTemplateForm, setShowManualTemplateForm] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateDetail, setTemplateDetail] = useState<any | null>(null);
  const [manualForm, setManualForm] = useState({ companyId: '', templateCode: '', templateName: '', category: '', messageType: 'BA', content: '' });
  // ★ 2026-07-20: 이관으로 템플릿이 4,400건대가 되면서 전량 렌더가 사실상 못 쓰는 상태 → 페이징
  //   행 높이가 2줄(템플릿명+코드)이라 20건도 스크롤이 길어 10건으로 확정(고객사 목록과 동일 기준)
  const [templatePage, setTemplatePage] = useState(1);
  const templatePerPage = 10;
  // 검색·상태 필터는 알림톡/RCS 공통 규칙 — 한 곳에만 정의해 두 목록이 같은 기준을 쓰게 한다
  const filterTemplateRows = (list: any[]) =>
    list.filter((t: any) => {
      const q = templateSearch.trim().toLowerCase();
      if (q && !`${t.company_name || ''} ${t.template_name || ''} ${t.template_code || ''} ${t.custom_template_code || ''}`.toLowerCase().includes(q)) return false;
      if (templateFilter === 'all') return true;
      const lb = getAlimtalkTemplateStatus(t.status).label;
      return templateFilter === 'pending' ? lb === '검수중' : templateFilter === 'approved' ? lb === '승인' : lb === '반려';
    });
  const filteredAlimtalkTemplates = useMemo(
    () => filterTemplateRows(adminTemplates),
    [adminTemplates, templateSearch, templateFilter],
  );
  const filteredRcsTemplates = useMemo(
    () => filterTemplateRows(adminRcsTemplates),
    [adminRcsTemplates, templateSearch, templateFilter],
  );
  // 검색·필터·서브탭이 바뀌면 1페이지로 — 3페이지에서 검색해 결과가 1페이지뿐이면 빈 화면이 되는 것 차단
  useEffect(() => {
    setTemplatePage(1);
  }, [templateSearch, templateFilter, templateSubTab]);
  // ★ D130: 레거시 adminProfiles/showProfileForm/profileForm/profileSaving 제거 — AlimtalkSendersSection이 자체 관리

  // 커스텀 모달 상태
  const [modal, setModal] = useState<ModalState>({ type: null, title: '', message: '' });
  const [copied, setCopied] = useState(false);

  // ★ D96: 반려 사유 입력 모달
  // ★ 2026-08-17 반려 모달의 채널 축 제거 — RCS 수기 반려를 걷어내며 알림톡 전용이 됐다.
  const [rejectModal, setRejectModal] = useState<{ show: boolean; id: string; reason: string }>({ show: false, id: '', reason: '' });

  // 신규 고객사 폼
  const [newCompany, setNewCompany] = useState({
    companyCode: '',
    companyName: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    planId: '',
    usageType: 'web',  // ★ 2026-07-03 사용구분: web / agent / both
  });

  // ★ 2026-07-03 에이전트(QTmsg) 발송ID 매핑 관리 (수정 모달 내)
  //   ★ 2026-07-24 §5-1 원장 격상 — ID별 선/후불(billing_type)·단가 4종 표시/편집 (웹 축 companies.*와 별개 지갑)
  //   ★ 2026-07-27 cust_name = 게이트웨이 원장 발급명(RSRM_SalesMst.CustNm). 한 회사에 발송ID가 여럿일 때
  //     (런소프트 = C0130 런소프트3 · D0078 런소프트 · D0079 런소프트2) 세 줄을 구분하는 유일한 이름이다.
  const [agentIds, setAgentIds] = useState<{
    id: string; agent_send_id: string; memo: string | null; cust_name?: string | null;
    billing_type?: string | null;
    cost_per_sms?: string | number | null; cost_per_lms?: string | number | null;
    cost_per_mms?: string | number | null; cost_per_kakao?: string | number | null; cost_per_brand?: string | number | null;
  }[]>([]);
  const [newAgentSendId, setNewAgentSendId] = useState('');
  const [newAgentMemo, setNewAgentMemo] = useState('');
  const [agentIdSaving, setAgentIdSaving] = useState(false);
  // 원장(선/후불·단가) 인라인 편집 상태
  const [editingAgentRowId, setEditingAgentRowId] = useState<string | null>(null);
  const [editAgentLedger, setEditAgentLedger] = useState({
    billingType: 'postpaid', costPerSms: '', costPerLms: '', costPerMms: '', costPerKakao: '', costPerBrand: '', memo: '',
  });
  const [agentLedgerSaving, setAgentLedgerSaving] = useState(false);

  const loadAgentIds = async (companyId: string) => {
    setEditingAgentRowId(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/companies/${companyId}/agent-ids`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAgentIds(data.agentIds || []);
      } else {
        setAgentIds([]);
      }
    } catch {
      setAgentIds([]);
    }
  };

  const handleAddAgentId = async () => {
    const value = newAgentSendId.trim();
    if (!value || !editCompany.id) return;
    setAgentIdSaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/companies/${editCompany.id}/agent-ids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ agentSendId: value, memo: newAgentMemo.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        showAlert('오류', data.error || '발송ID 등록 실패', 'error');
      } else {
        setNewAgentSendId('');
        setNewAgentMemo('');
        await loadAgentIds(editCompany.id);
      }
    } catch {
      showAlert('오류', '서버 오류', 'error');
    } finally {
      setAgentIdSaving(false);
    }
  };

  const handleRemoveAgentId = async (rowId: string) => {
    if (!editCompany.id) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/companies/${editCompany.id}/agent-ids/${rowId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        showAlert('오류', data.error || '발송ID 삭제 실패', 'error');
      } else {
        await loadAgentIds(editCompany.id);
      }
    } catch {
      showAlert('오류', '서버 오류', 'error');
    }
  };

  // ★ 2026-07-24 §5-1 — 발송ID 원장(선/후불·단가·메모) 인라인 편집
  // 단가 입력 정제: 숫자+점 하나만 허용 ('1.2.3' 차단 — Codex 5R-2), 저장 시 점만 남은 값은 빈 값 처리
  const sanitizeCostInput = (v: string) => {
    const c = v.replace(/[^0-9.]/g, '');
    const i = c.indexOf('.');
    return i === -1 ? c : c.slice(0, i + 1) + c.slice(i + 1).replace(/\./g, '');
  };
  const normalizeCostForSave = (v: string) => {
    const t = v.trim();
    return t === '.' ? '' : t;
  };

  const openAgentLedgerEdit = (a: (typeof agentIds)[number]) => {
    setEditingAgentRowId(a.id);
    setEditAgentLedger({
      billingType: a.billing_type === 'prepaid' ? 'prepaid' : 'postpaid',
      costPerSms: a.cost_per_sms != null && String(a.cost_per_sms) !== '' ? String(Number(a.cost_per_sms)) : '',
      costPerLms: a.cost_per_lms != null && String(a.cost_per_lms) !== '' ? String(Number(a.cost_per_lms)) : '',
      costPerMms: a.cost_per_mms != null && String(a.cost_per_mms) !== '' ? String(Number(a.cost_per_mms)) : '',
      costPerKakao: a.cost_per_kakao != null && String(a.cost_per_kakao) !== '' ? String(Number(a.cost_per_kakao)) : '',
      costPerBrand: a.cost_per_brand != null && String(a.cost_per_brand) !== '' ? String(Number(a.cost_per_brand)) : '',
      memo: a.memo || '',
    });
  };

  const handleSaveAgentLedger = async () => {
    if (!editCompany.id || !editingAgentRowId) return;
    setAgentLedgerSaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/companies/${editCompany.id}/agent-ids/${editingAgentRowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          billingType: editAgentLedger.billingType,
          costPerSms: normalizeCostForSave(editAgentLedger.costPerSms),
          costPerLms: normalizeCostForSave(editAgentLedger.costPerLms),
          costPerMms: normalizeCostForSave(editAgentLedger.costPerMms),
          costPerKakao: normalizeCostForSave(editAgentLedger.costPerKakao),
          costPerBrand: normalizeCostForSave(editAgentLedger.costPerBrand),
          memo: editAgentLedger.memo.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showAlert('오류', data.error || '발송ID 설정 저장 실패', 'error');
      } else {
        setEditingAgentRowId(null);
        await loadAgentIds(editCompany.id);
      }
    } catch {
      showAlert('오류', '서버 오류', 'error');
    } finally {
      setAgentLedgerSaving(false);
    }
  };

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
// ★ 2026-08-04 loadInvoices 제거 — 그 데이터를 그리던 "거래내역서 목록" 섹션이 죽은 목록이라 사라졌다.
useEffect(() => { if (activeTab === 'billing') { loadBillings(); } }, [activeTab]);
// ★ 2026-08-20 서버 필터가 바뀌면 선택을 **즉시** 비운다(Codex 2R 수용) — 목록 도착 후의 가지치기만으로는
//   응답 전 전환 창에서 옛 목록·옛 선택으로 일괄 확정·발송이 가능했다. 선택이 비면 일괄 버튼 자체가 사라진다.
//   화면 내 검색·페이징은 서버 재조회가 없어 선택이 유지된다(0806 계약 그대로).
useEffect(() => { if (activeTab === 'billing') { setBillingSel([]); loadBillings(); } }, [filterYear, filterMonth, billingUnsentOnly]);
// ★ 2026-08-05 총 정산표 — 소유자(ceo) 전용이라 **진입점 자체를 권한 응답으로 가린다**(감사 로그와 같은 방식).
//   서버가 최종 판정이고(403), 이 값은 안 보이게 하는 용도다. 실패는 false로 두어 조용히 숨긴다.
useEffect(() => {
  if (activeTab !== 'billing') return;
  const token = localStorage.getItem('token');
  fetch('/api/admin/billing/overview/access', { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.json())
    .then((d) => setCanViewSettlementOverview(!!d?.allowed))
    .catch(() => setCanViewSettlementOverview(false));
}, [activeTab]);
useEffect(() => { if (activeTab === 'deposits') loadChargeManagement(1); }, [activeTab, chargeTxCompanyFilter, chargeTxTypeFilter, chargeTxMethodFilter, chargeTxStartDate, chargeTxEndDate]);
useEffect(() => { if (activeTab === 'deposits' || activeTab === 'credits') loadCreditRequests(); if (activeTab === 'credits') { loadAllCreditTx(1); loadCreditRisk(); } }, [activeTab]);
// ★ 2026-08-11 뱃지는 이제 loadPendingBadges(카운트)가 담당한다 — 이 mount 로드는 크레딧 모달 목록용으로만 남는다.
useEffect(() => { loadCreditRequests(); }, []);
useEffect(() => { if (activeTab === 'stats') loadSendStats(1); }, [activeTab]);
useEffect(() => { if (activeTab === 'syncAgents') loadSyncAgents(); }, [activeTab]);
useEffect(() => { if (activeTab === 'spamBlock') loadSpamBlock(); }, [activeTab]);
useEffect(() => { if (activeTab === 'geoAccess') loadGeoAccess(); }, [activeTab]);
useEffect(() => { if (activeTab === 'auditLogs' && auditAccessAllowed) loadAuditLogs(1); }, [activeTab, auditAccessAllowed]);
// ★ 2026-06-11: 감사 로그 열람 권한 확인 (1회) — 허용 계정에만 감사 로그 메뉴 노출
useEffect(() => {
  (async () => {
    try {
      const token = localStorage.getItem('token');
      const r = await fetch('/api/admin/audit-logs/access', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setAuditAccessAllowed(d.allowed === true);
    } catch { setAuditAccessAllowed(false); }
    try {
      const token = localStorage.getItem('token');
      // ★ 2026-08-16: 신규마케팅진단 접근(mount 1회) — 허용이면 신규 리드 뱃지도 함께
      const r = await fetch('/api/admin/marketing-diagnosis/access', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      if (d.allowed === true) {
        setDiagnosisAllowed(true);
        loadDiagnosisBadge();
      }
    } catch { setDiagnosisAllowed(false); }
    try {
      const token = localStorage.getItem('token');
      const r = await fetch('/api/admin/ai-training/access', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setAiTrainingAllowed(d.allowed === true);
    } catch { setAiTrainingAllowed(false); }
  })();
}, []);
useEffect(() => { if (activeTab === 'templates') { loadAdminTemplates(); loadAdminRcsTemplates(); } }, [activeTab, templateFilter]);
// ★ 2026-08-08 (임은지 접수 1·2 + 남지현 댓글) **알림 카운트의 수명을 화면에서 떼어낸다.**
//   그전에는 `activeTab === 'callbacks'`일 때만 불렀다 — 뱃지는 상단 메뉴에 있는데 그 값을 채우는 호출이
//   그 화면 진입에 묶여 있어, "발신번호 관리 탭을 눌러야 그제서야 알림이 뜨는" 상태였다(뱃지의 목적과 정반대).
//   새로고침으로도 안 뜬 이유도 같다 — 새로고침 직후 activeTab이 callbacks가 아니면 호출 자체가 없다.
//   진입 시 1회 + 60초 주기. 백그라운드 탭에서는 건너뛴다(하루 종일 열어 두는 화면이라 빈 호출을 만들지 않는다).
//   승인·반려 직후 재조회는 각 핸들러가 이미 부른다 — 그건 그대로 둔다(즉시 반영).
useEffect(() => {
  let alive = true;
  let inFlight = false;
  const tick = async () => {
    if (!alive || inFlight) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    inFlight = true;
    // ★ 2026-08-11 (서수란 접수) 요금/정산 뱃지도 같은 주기에 태운다 — 새 타이머를 만들지 않는다.
    //   0808에 만든 가드(백그라운드 건너뜀·중복 호출 차단·언마운트 정리)를 그대로 쓴다.
    try { await Promise.allSettled([loadSenderRegPendingCount(), loadPendingBadges()]); } finally { inFlight = false; }
  };
  tick();
  const timer = setInterval(tick, 60000);
  // 건너뛴 동안 값이 낡는다 — 화면으로 돌아오는 순간 맞춘다(가드와 한 쌍이다).
  document.addEventListener('visibilitychange', tick);
  return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
useEffect(() => { if (activeTab === 'callbacks' && callbackSubTab === 'registrations') { loadSenderRegistrations(senderRegFilter); } }, [activeTab, callbackSubTab, senderRegFilter]);
useEffect(() => { if (activeTab === 'callbacks' && callbackSubTab === 'managers') { loadAllManagers(); } }, [activeTab, callbackSubTab, mgrFilter]);
useEffect(() => { loadLineGroups(); }, []);

// ===== 템플릿 관리 함수 =====
const loadAdminTemplates = async () => {
  setTemplatesLoading(true);
  try {
    const tk = localStorage.getItem('token');
    const params = new URLSearchParams();
    // 상태 필터는 클라이언트(getAlimtalkTemplateStatus 라벨 기준)로 적용 — DB 대문자/동기화 값(KREJ 등) 호환
    const res = await fetch(`/api/admin/kakao-templates?${params}`, { headers: { Authorization: `Bearer ${tk}` } });
    const data = await res.json();
    if (data.success) setAdminTemplates(data.templates);
  } catch { /* ignore */ }
  setTemplatesLoading(false);
};

// ★ D130: 레거시 loadAdminProfiles 제거 — AlimtalkSendersSection이 /api/alimtalk/senders 사용

const loadAdminRcsTemplates = async () => {
  try {
    const tk = localStorage.getItem('token');
    const params = new URLSearchParams();
    // 상태 필터는 클라이언트(getAlimtalkTemplateStatus 라벨 기준)로 적용 — DB 대문자/동기화 값 호환
    const res = await fetch(`/api/admin/rcs-templates?${params}`, { headers: { Authorization: `Bearer ${tk}` } });
    const data = await res.json();
    if (data.success) setAdminRcsTemplates(data.templates);
  } catch { /* ignore */ }
};

// ★ 2026-08-17 RCS 분기 제거 — 알림톡 전용으로 좁혔다.
//   RCS 검수 주체는 외부(RCS Biz Center)라 우리 DB status를 손으로 바꾸는 것은 승인이 아니었다.
//   그 상태로 "승인"이 보이면 발송 가능으로 읽히는데 실제로는 아니다(설계서 §2-2 fail-closed).
const handleTemplateApprove = async (id: string) => {
  try {
    const tk = localStorage.getItem('token');
    const res = await fetch(`/api/admin/kakao-templates/${id}/approve`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({}) });
    const data = await res.json();
    if (data.success) { loadAdminTemplates(); loadAdminRcsTemplates(); setModal({ type: 'alert', title: '승인 완료', message: '템플릿이 승인되었습니다', variant: 'success' }); }
    else setModal({ type: 'alert', title: '승인 실패', message: data.error, variant: 'error' });
  } catch { setModal({ type: 'alert', title: '오류', message: '서버 오류', variant: 'error' }); }
};

// ★ D96: prompt() → 커스텀 모달로 변경
const handleTemplateReject = (id: string) => {
  setRejectModal({ show: true, id, reason: '' });
};

const handleTemplateRejectConfirm = async () => {
  if (!rejectModal.reason.trim()) {
    setModal({ type: 'alert', title: '입력 오류', message: '반려 사유를 입력해주세요', variant: 'error' });
    return;
  }
  try {
    const tk = localStorage.getItem('token');
    const res = await fetch(`/api/admin/kakao-templates/${rejectModal.id}/reject`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ rejectReason: rejectModal.reason.trim() }) });
    const data = await res.json();
    setRejectModal({ show: false, id: '', reason: '' });
    if (data.success) { loadAdminTemplates(); loadAdminRcsTemplates(); setModal({ type: 'alert', title: '반려 완료', message: '템플릿이 반려되었습니다', variant: 'success' }); }
    else setModal({ type: 'alert', title: '반려 실패', message: data.error, variant: 'error' });
  } catch { setModal({ type: 'alert', title: '오류', message: '서버 오류', variant: 'error' }); }
};

const handleManualTemplateSubmit = async () => {
  if (!manualForm.companyId || !manualForm.templateName || !manualForm.content) {
    setModal({ type: 'alert', title: '입력 오류', message: '고객사, 템플릿명, 본문은 필수입니다', variant: 'error' });
    return;
  }
  try {
    const tk = localStorage.getItem('token');
    const res = await fetch('/api/admin/kakao-templates/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
      body: JSON.stringify(manualForm),
    });
    const data = await res.json();
    if (data.success) {
      setShowManualTemplateForm(false);
      setManualForm({ companyId: '', templateCode: '', templateName: '', category: '', messageType: 'BA', content: '' });
      loadAdminTemplates();
      setModal({ type: 'alert', title: '등록 완료', message: '템플릿이 승인 상태로 등록되었습니다', variant: 'success' });
    } else setModal({ type: 'alert', title: '등록 실패', message: data.error, variant: 'error' });
  } catch { setModal({ type: 'alert', title: '오류', message: '서버 오류', variant: 'error' }); }
};

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
    // ★ 2026-08-21 서버 오류(500)를 빈 결과("총 0건")로 그리지 않는다 — 고객사 필터 SQL 오류가 이 자리에서 가려졌다.
    if (!res.ok) {
      setAuditLogs([]); setAuditLogsTotal(0); setAuditLogsTotalPages(0); setAuditLogsPage(page);
      showAlert('조회 실패', data?.error || '감사 로그를 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
      return;
    }
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

// ===== 발송 라인그룹 함수 =====
const loadLineGroups = async () => {
  setLineGroupsLoading(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/line-groups', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    setLineGroups(data.lineGroups || []);
    setLineGroupCanManage(!!data.canManage);
  } catch (e) { console.error('라인그룹 조회 실패:', e); }
  finally { setLineGroupsLoading(false); }
};

const saveLineGroup = async (id: string | null, data: any) => {
  const token = localStorage.getItem('token');
  const url = id ? `/api/admin/line-groups/${id}` : '/api/admin/line-groups';
  const method = id ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
  await loadLineGroups();
  return await res.json();
};

const deleteLineGroup = async (id: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`/api/admin/line-groups/${id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
  await loadLineGroups();
};

// ★ 2026-07-17 발송 라인 설정 탭 — 저장/삭제 핸들러.
//   sms_tables는 화면에서 콤마 구분 문자열로 다루고, 저장 직전 배열로 되돌린다.
//   테이블명 유효성(SMSQ_SEND[_n][_yyyymm])은 백엔드 validateSmsTables가 최종 판정 — 프론트는 형식만 다듬는다.
const handleSaveLineGroup = async () => {
  if (!editingLineGroup) return;
  const groupName = String(editingLineGroup.group_name || '').trim();
  const tables = String(editingLineGroup.sms_tables || '')
    .split(',').map((t: string) => t.trim()).filter(Boolean);
  if (!groupName) return showAlert('입력 확인', '그룹명을 입력해주세요.', 'warning');
  if (tables.length === 0) return showAlert('입력 확인', '발송 테이블을 1개 이상 입력해주세요.', 'warning');

  setLineGroupSaving(true);
  try {
    await saveLineGroup(editingLineGroup.id || null, {
      groupName,
      groupType: editingLineGroup.group_type,
      smsTables: tables,
      sortOrder: Number(editingLineGroup.sort_order) || 0,
      ...(editingLineGroup.id ? { isActive: !!editingLineGroup.is_active } : {}),
    });
    setEditingLineGroup(null);
    showAlert('저장 완료', `${groupName} 라인그룹이 저장되었습니다.`, 'success');
  } catch (e: any) {
    showAlert('저장 실패', e?.message || '라인그룹 저장에 실패했습니다.', 'error');
  } finally {
    setLineGroupSaving(false);
  }
};

const handleDeleteLineGroup = (lg: any) => {
  showConfirm(
    '라인그룹 삭제',
    `"${lg.group_name}" 라인그룹을 삭제하시겠습니까?\n이 라인으로 발송한 과거 캠페인의 집계·정산 조회 범위가 바뀔 수 있습니다.`,
    async () => {
      try {
        await deleteLineGroup(lg.id);
        showAlert('삭제 완료', `${lg.group_name} 라인그룹이 삭제되었습니다.`, 'success');
      } catch (e: any) {
        showAlert('삭제 실패', e?.message || '라인그룹 삭제에 실패했습니다.', 'error');
      }
    }
  );
};
useEffect(() => { if (billingToast) { const t = setTimeout(() => setBillingToast(null), 3000); return () => clearTimeout(t); } }, [billingToast]);
// ※ 옛 정산용 계정 목록 로드는 폐기했다(2026-07-26) — 단일 계정 발행 자체가 서버에서 차단되고,
//   계정별 발행은 회사 전체 묶음이라 계정을 고를 일이 없다.

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

// ★ D131 후속(2026-04-21): Agent 삭제 (버려진/중복 정리)
//   활성 Agent(30분 이내 heartbeat)는 서버에서 409 반환 → force=true로 강제 가능.
const handleSyncDelete = async (force = false) => {
  if (!syncSelectedAgent) return;
  setSyncDeleting(true);
  try {
    const token = localStorage.getItem('token');
    const url = `/api/admin/sync/agents/${syncSelectedAgent.id}${force ? '?force=true' : ''}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.code === 'AGENT_ACTIVE') {
        // 활성 Agent — 사용자에게 강제 삭제 여부 확인
        showConfirm('강제 삭제', `${data.error}\n\n그래도 강제 삭제하시겠습니까?`, () => { void handleSyncDelete(true); });
        setSyncDeleting(false);
        return;
      }
      throw new Error(data.error || 'Agent 삭제 실패');
    }
    setShowSyncDeleteModal(false);
    showAlert('성공', `${data.deleted?.agent_name || 'Agent'}를 삭제했습니다${data.forced ? ' (강제)' : ''}.`, 'success');
    loadSyncAgents();
  } catch (e: any) {
    showAlert('오류', e.message || 'Agent 삭제 실패', 'error');
  } finally {
    setSyncDeleting(false);
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
    // ★ D131 후속(2026-04-21): 명령 전송 후 목록 즉시 재조회 — Agent가 실제 pause/resume 수행 후
    //   다음 heartbeat(최대 60분 소요)에 status 반영될 때까지 UI는 기존 상태로 보임.
    //   명령 전송 직후 최소한 "명령 큐에 등록됐다"는 피드백과 함께 목록 리프레시.
    const commandLabels: Record<string, string> = {
      full_sync: '전체 동기화',
      pause: '일시정지',
      resume: '재개',
      restart: '재시작',
      report_logs: '최근 로그 요청',
      test_connection: '소스 DB 연결 테스트',
    };
    const label = commandLabels[syncCommandType] || syncCommandType;
    const ackNote = syncAgentSupportsAck(syncSelectedAgent.agent_version)
      ? ' 실행 결과는 상세 화면의 "명령 결과"에서 확인할 수 있습니다.'
      : '';
    showAlert('성공', `${label} 명령이 등록되었습니다. Agent가 다음 heartbeat(최대 60분)에 수행하고 상태가 반영됩니다.${ackNote}`, 'success');
    loadSyncAgents();
  } catch (e) {
    showAlert('오류', '명령 전송 실패', 'error');
  }
};

// ★ 2026-07-10 원격 관리: ACK(v1.6.1+) 지원 여부 — 진단 명령·dry-run 노출 판단 (백엔드 agent-protocol과 동일 기준)
const syncAgentSupportsAck = (version: string | null | undefined): boolean => {
  const m = String(version || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return false;
  const [a, b, c] = [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3] || '0', 10)];
  if (a !== 1) return a > 1;
  if (b !== 6) return b > 6;
  return c >= 1;
};

// ★ 2026-07-01: 원격 컬럼 매핑 편집(update_config) — 소스컬럼 → 표준/custom 슬롯
const SYNC_CUSTOM_SLOTS = Array.from({ length: 15 }, (_, i) => `custom_${i + 1}`);
const SYNC_CUSTOMER_TARGET_FIELDS = [
  'phone', 'name', 'gender', 'birth_date', 'email', 'address', 'region', 'grade',
  'store_phone', 'points', 'store_code', 'store_name', 'registered_store',
  'registered_store_number', 'registration_type', 'callback', 'sms_opt_in',
  'recent_purchase_date', 'recent_purchase_amount', 'recent_purchase_store',
  'total_purchase_amount', 'purchase_count', ...SYNC_CUSTOM_SLOTS,
];
const SYNC_PURCHASE_TARGET_FIELDS = [
  'customer_phone', 'purchase_date', 'total_amount', 'quantity',
  'store_code', 'store_name', 'product_code', 'product_name', 'unit_price', ...SYNC_CUSTOM_SLOTS,
];

// ★ 2026-07-10 원격 관리 P0-2: 모달 오픈 = 에이전트 자기 보고(reported) 로드 → 기존 매핑 프리필.
//   옛 구조(항상 빈 행)는 "한 줄 추가 저장 = 그 대상 매핑 전체 소실" 함정이었다(에이전트는 타겟 단위 통째 교체 — 실측).
const openSyncMappingModal = async (agent: any) => {
  setSyncSelectedAgent(agent);
  setSyncMapReported(null);
  setSyncMapAckSupported(false);
  setSyncMapCustomers([]);
  setSyncMapPurchases([]);
  setShowSyncMappingModal(true);
  setSyncMapReportLoading(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/sync/agents/${agent.id}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Agent 상세 조회 실패');
    const reported = data.agent?.reported || null;
    setSyncMapReported(reported);
    setSyncMapAckSupported(!!data.agent?.supports_ack);
    if (reported?.appliedMapping) {
      const labels = reported.appliedMapping.customFieldLabels || {};
      const custRows = Object.entries(reported.appliedMapping.customers || {}).map(([src, target]) => ({
        src,
        target: String(target),
        label: /^custom_\d+$/.test(String(target)) ? String(labels[String(target)] || '') : '',
      }));
      const purchRows = Object.entries(reported.appliedMapping.purchases || {}).map(([src, target]) => ({
        src,
        target: String(target),
        label: '',
      }));
      setSyncMapCustomers(custRows);
      setSyncMapPurchases(purchRows);
    }
  } catch (e: any) {
    showAlert('오류', e.message || 'Agent 상세 조회 실패', 'error');
  } finally {
    setSyncMapReportLoading(false);
  }
};

// 편집 행 → 전송 payload (저장·dry-run 공용). 빈 행 제외.
const buildSyncMappingPayload = () => {
  const customers: Record<string, string> = {};
  const customFieldLabels: Record<string, string> = {};
  for (const r of syncMapCustomers) {
    const src = r.src.trim();
    const target = r.target.trim();
    if (!src || !target) continue;
    customers[src] = target;
    if (/^custom_\d+$/.test(target) && r.label.trim()) customFieldLabels[target] = r.label.trim();
  }
  const purchases: Record<string, string> = {};
  for (const r of syncMapPurchases) {
    const src = r.src.trim();
    const target = r.target.trim();
    if (!src || !target) continue;
    purchases[src] = target;
  }
  const mapping: any = {};
  if (Object.keys(customers).length) mapping.customers = customers;
  if (Object.keys(purchases).length) mapping.purchases = purchases;
  if (Object.keys(customFieldLabels).length) mapping.customFieldLabels = customFieldLabels;
  return { mapping, custCount: Object.keys(customers).length, purchCount: Object.keys(purchases).length };
};

// ★ 2026-07-10 P0-2: 저장 = "전체 교체" 확인 모달을 거친 후에만 전송 (부분 추가 저장 사고 차단)
const handleSyncMappingSave = () => {
  if (!syncSelectedAgent) return;
  if (!syncMapReported) {
    showAlert('저장 불가', '에이전트가 아직 적용 매핑을 보고하지 않았습니다(구버전 또는 첫 heartbeat 전). 빈 화면 저장은 기존 매핑 전체를 지울 수 있어 차단됩니다.', 'error');
    return;
  }
  const { mapping, custCount, purchCount } = buildSyncMappingPayload();
  if (!mapping.customers && !mapping.purchases) {
    showAlert('입력 오류', '매핑을 한 개 이상 입력해주세요.', 'error');
    return;
  }
  showConfirm(
    '매핑 전체 교체',
    `이 저장은 전송한 대상의 매핑 전체를 교체합니다.\n\n전송: 고객 ${custCount}행 · 구매 ${purchCount}행\n(행을 모두 지운 대상은 전송되지 않아 기존 매핑이 유지됩니다)\n\n적용 후 바뀐 대상만 전체 재동기화가 실행됩니다. 진행할까요?`,
    () => { void doSyncMappingSend(mapping); },
  );
};

const doSyncMappingSend = async (mapping: any) => {
  if (!syncSelectedAgent) return;
  setSyncMapSaving(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/sync/agents/${syncSelectedAgent.id}/command`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'update_config', mapping }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '매핑 전송 실패');
    setShowSyncMappingModal(false);
    showAlert('성공', `매핑이 전송되었습니다. Agent가 다음 heartbeat(최대 60분)에 매핑을 갱신하고 바뀐 대상만 전체 재동기화합니다.${syncMapAckSupported ? '\n적용 결과는 상세 화면의 "명령 결과"에서 확인할 수 있습니다.' : ''}`, 'success');
    loadSyncAgents();
  } catch (e: any) {
    showAlert('오류', e.message || '매핑 전송 실패', 'error');
  } finally {
    setSyncMapSaving(false);
  }
};

// ★ 2026-07-10 P2-9: 매핑 dry-run — 편집 중 매핑을 소스 1행에 적용한 미리보기(저장·적용 없음).
//   결과는 에이전트 ACK로 상세 "명령 결과"에 도착(부스트로 보통 1~2분).
const handleSyncMappingDryRun = async () => {
  if (!syncSelectedAgent) return;
  const { mapping } = buildSyncMappingPayload();
  delete mapping.customFieldLabels; // dry-run은 라벨 불요
  if (!mapping.customers && !mapping.purchases) {
    showAlert('입력 오류', 'dry-run할 매핑을 한 개 이상 입력해주세요.', 'error');
    return;
  }
  setSyncMapDryRunning(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/sync/agents/${syncSelectedAgent.id}/command`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'mapping_dryrun', mapping }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'dry-run 전송 실패');
    showAlert('전송됨', '매핑 미리보기(dry-run) 명령을 보냈습니다. 결과는 상세 화면의 "명령 결과"에 도착합니다(에이전트 응답 주기에 따라 수 분 소요). 저장·적용은 일어나지 않습니다.', 'success');
  } catch (e: any) {
    showAlert('오류', e.message || 'dry-run 전송 실패', 'error');
  } finally {
    setSyncMapDryRunning(false);
  }
};

// ★ 2026-07-01: 자동 업데이트 릴리즈 등록 — 서버 exe 업로드 후 sync_releases 등록 → 박스 매시간 자동 수령
const handleSyncReleaseSubmit = async () => {
  const version = syncReleaseForm.version.trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    showAlert('입력 오류', '버전은 x.y.z 형식이어야 합니다 (예: 1.5.7).', 'error');
    return;
  }
  setSyncReleaseSaving(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/sync/releases', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version,
        checksum: syncReleaseForm.checksum.trim() || undefined,
        force_update: syncReleaseForm.force_update,
        tier: syncReleaseForm.tier || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '릴리즈 등록 실패');
    setShowSyncReleaseModal(false);
    showAlert('성공', `${version} 릴리즈가 등록됐습니다. 각 Agent가 다음 정각(매시간) 버전 확인 때 자동으로 받아 교체합니다.`, 'success');
  } catch (e: any) {
    showAlert('오류', e.message || '릴리즈 등록 실패', 'error');
  } finally {
    setSyncReleaseSaving(false);
  }
};

// ★ D131 후속(2026-04-21): DB의 status='paused'면 online 여부와 무관하게 "일시정지" 표시
//   Agent는 살아있으나(heartbeat 정상) 스케줄러만 pause된 상태.
const getSyncOnlineBadge = (onlineStatus: string, dbStatus?: string) => {
  if (dbStatus === 'paused') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">⏸ 일시정지</span>;
  if (onlineStatus === 'online') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">● 정상</span>;
  if (onlineStatus === 'delayed') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">● 지연</span>;
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
// ★ 2026-08-20 필터 귀속 재조회(Codex 3R 수용 — 2R의 seq 가드를 대체) — 파라미터를 클로저 상태가 아니라
//   **ref의 호출 시점 최신 키**에서 만든다. 벌크 종료 재조회처럼 옛 렌더의 클로저를 통해 불려도
//   항상 지금 화면의 필터로 요청이 나간다. 반영·로딩 해제는 도착 시점 키 일치가 조건이고,
//   최신 키 요청이 실패하면 목록을 비운다(fail-closed) — 다른 달 목록이 새 필터 아래 남지 않는다.
// ★ 2026-08-20 Codex 4R 수용 — 귀속(키)과 최신성(세대)은 직교 축이라 둘 다 건다. 키만 보면 같은 키의
//   두 재조회(행 상태 변경 연타 등)가 직렬화되지 않아 늦게 도착한 옛 스냅샷이 최신 목록을 덮는다.
//   상태를 쓰는 것은 **마지막에 시작한 요청 하나**뿐이고, 그 요청의 키가 현재 키일 때만이다.
const billingLoadGen = useRef(0);
const loadBillings = async () => {
  const key = billingFilterKeyRef.current;
  const gen = ++billingLoadGen.current;
  const [ky, km, kUnsent] = key.split('|');
  const isCurrent = () => gen === billingLoadGen.current && key === billingFilterKeyRef.current;
  setBillingsLoading(true);
  // ★ 2026-07-28 미발송만 보기 — 일괄발급에서 금액 불일치로 발송이 막힌 장은 컨펌 추적 목록에 안 뜬다.
  //   작업 결과 문구는 화면을 닫으면 사라지므로, 여기서 언제든 다시 찾을 수 있어야 한다.
  try {
    const res = await billingApi.getBillings({
      year: Number(ky),
      ...(Number(km) >= 1 && Number(km) <= 12 ? { month: Number(km) } : {}),
      ...(kUnsent === '1' ? { unsent: '1' as const } : {}),
    });
    if (isCurrent()) { setBillings(res.data); setBillingsKey(key); }
  }
  catch (e) {
    console.error(e);
    if (isCurrent()) { setBillings([]); setBillingsKey(''); }
  }
  finally { if (isCurrent()) setBillingsLoading(false); }
};
// ★ 2026-07-28 발행은 됐고 메일만 안 나간 묶음의 컨펌 단계 재시도.
//   발행을 다시 하지 않는다(기간 중복에 막힌다). 이미 나간 장은 서버가 대상에서 빼므로 중복 발송이 없다.
const handleRetryConfirmations = async (billingId: string, companyName: string) => {
  if (!billingId) return;
  setRetryingBillingId(billingId);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/billing/bulk/retry-confirmations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ billing_id: billingId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '재시도에 실패했습니다.');
    showAlert(data.targeted === 0 ? '확인' : '완료', `${companyName}: ${data.message}`, data.targeted === 0 ? 'info' : 'success');
    await loadBillings();
  } catch (e: any) {
    showAlert('오류', e?.message || '재시도에 실패했습니다.', 'error');
  } finally {
    setRetryingBillingId(null);
  }
};
const loadInvoices = async () => {
  setInvoicesLoading(true);
  try { const res = await billingApi.getInvoices(); setInvoices(res.data); }
  catch (e) { console.error(e); }
  finally { setInvoicesLoading(false); }
};
// ═══ ★ 2026-07-28 거래내역서 일괄발급 + 컨펌·세금계산서 현황 — SoT docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §3·§4 ═══
const prevMonthStr = () => {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthToPeriod = (ym: string) => {
  const y = Number(ym.slice(0, 4)); const m = Number(ym.slice(5, 7));
  const last = new Date(y, m, 0).getDate();
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, '0')}` };
};

const [bulkMonth, setBulkMonth] = useState<string>(prevMonthStr());
// ★ Codex 2R HIGH 수용 — 월은 ref로도 든다. 폴링 완료 콜백·발급 시작이 **화면의 현재 월**을 읽게 해
//   낡은 클로저가 이전 월로 발급하는 경로를 끊는다. 요청 시퀀스는 늦게 도착한 목록 응답을 버린다.
const bulkMonthRef = useRef(prevMonthStr());
const bulkReqSeqRef = useRef(0);
// ★ 2026-07-29 job이 시작된 월. 완료 콜백이 "그 사이 다른 월로 옮겨 담아둔 목록"을 지우지 않게 한다.
const bulkJobMonthRef = useRef('');
const [bulkListLoading, setBulkListLoading] = useState(false);
const [bulkList, setBulkList] = useState<any[] | null>(null);   // null = 아직 조회 전
const [bulkPage, setBulkPage] = useState(1);
const [bulkSelected, setBulkSelected] = useState<string[]>([]); // 상단 리스트 체크
const [bulkCombined, setBulkCombined] = useState<any[]>([]);    // 왼쪽 = 고객사 전체 발급
const [bulkByUser, setBulkByUser] = useState<any[]>([]);        // 오른쪽 = 계정별 발급
const [bulkJobId, setBulkJobId] = useState<string | null>(null);
const [bulkJob, setBulkJob] = useState<any>(null);
const [bulkStarting, setBulkStarting] = useState(false);
const [confirmBoardOpen, setConfirmBoardOpen] = useState(false);
// ★ 2026-07-30 추가 청구(080·부가서비스) + 최소과금 모달 (서수란 접수)
const [billing080Open, setBilling080Open] = useState(false);
// ★ 2026-08-04 수량 수정 발행 대상 장 — null이면 닫힘(서수란 0804 접수)
const [qtyAdjustTarget, setQtyAdjustTarget] = useState<QtyAdjustTarget | null>(null);
const [minChargeOpen, setMinChargeOpen] = useState(false);
const [confirmRows, setConfirmRows] = useState<any[]>([]);
const [confirmLoading, setConfirmLoading] = useState(false);
const [confirmStatusFilter, setConfirmStatusFilter] = useState('');
const [confirmTruncated, setConfirmTruncated] = useState(false);
const [manualDateDraft, setManualDateDraft] = useState<Record<string, string>>({});
// ★ 2026-08-21 계산서 비고(PO번호 등 — 시세이도) — 작성일자와 같은 통보로 오는 값이라 같은 자리에서 받는다.
const [manualRemarkDraft, setManualRemarkDraft] = useState<Record<string, string>>({});
// ★ 2026-08-05 (서수란 접수) 업체 확인을 관리자가 대신 기록 — 컨펌 링크를 안 누르고 메일·전화로
//   발행일자를 통보하는 회사(시세이도류)가 있다. 이 창구가 없으면 컨펌 관문이 그 회사를 영영 막는다.
const [adminConfirmTarget, setAdminConfirmTarget] = useState<any | null>(null);
const [adminConfirmNote, setAdminConfirmNote] = useState('');
const [adminConfirmBusy, setAdminConfirmBusy] = useState(false);
// ★ 2026-07-30 세금계산서 장부(taxbill_issues — 원본+수정 축) + 수정발행 모달
const [taxbillRows, setTaxbillRows] = useState<any[]>([]);
const [taxbillLoading, setTaxbillLoading] = useState(false);
const [taxbillStatusFilter, setTaxbillStatusFilter] = useState('');
const [taxbillTruncated, setTaxbillTruncated] = useState(false);
const [taxbillBoardOpen, setTaxbillBoardOpen] = useState(false);
const [modifyTarget, setModifyTarget] = useState<any | null>(null); // 수정발행 대상 장(issued 행)
const [modifyCode, setModifyCode] = useState<number>(6);
const [modifyWriteDate, setModifyWriteDate] = useState('');
const [modifyDeltaSupply, setModifyDeltaSupply] = useState('');
const [modifyDeltaTax, setModifyDeltaTax] = useState('');
const [modifyCorrectedSupply, setModifyCorrectedSupply] = useState('');
const [modifyCorrectedTax, setModifyCorrectedTax] = useState('');
const [modifySubmitting, setModifySubmitting] = useState(false);
// ★ 2026-08-05 (서수란 접수) 발행 완료분 **메일 재발송** — 문서를 만들지 않고 같은 문서번호로 다시 보낸다.
//   미수신 대응을 수정발행으로 하면 국세청에 문서가 한 장 더 생긴다. 그 오인을 막으려고 축을 갈랐다.
const [taxbillResendTarget, setTaxbillResendTarget] = useState<any | null>(null);
const [taxbillResendEmail, setTaxbillResendEmail] = useState('');
const [taxbillResendBusy, setTaxbillResendBusy] = useState(false);
// ★ 2026-08-05 발급 대기 취소 — 되돌리는 경로가 고객 이의신청 하나뿐이라, 발행 직전에 금액 오류를
//   발견해도 5분 뒤 워커가 그대로 국세청에 보냈다.
const [taxbillCancelTarget, setTaxbillCancelTarget] = useState<any | null>(null);
// ★ 2026-08-07 수정(취소·정정) 장 재시도 확인 — 국세청에 있는 원본을 건드리는 문서라 사유를 남긴다.
const [taxbillRetryTarget, setTaxbillRetryTarget] = useState<any | null>(null);
const [taxbillRetryReason, setTaxbillRetryReason] = useState('');
const [taxbillCancelReason, setTaxbillCancelReason] = useState('');
const [taxbillCancelBusy, setTaxbillCancelBusy] = useState(false);
// ★ 2026-08-05 테스트베드 발행분을 운영으로 다시 태우기 — 전환 전 12장이 국세청에 안 나갔는데
//   화면은 `발행 완료`로 보여줬다. 그 거짓말을 뱃지로 걷어내고 되돌릴 창구를 연다.
const [taxbillProdTarget, setTaxbillProdTarget] = useState<any | null>(null);
const [taxbillProdBusy, setTaxbillProdBusy] = useState(false);
// ★ 2026-08-21 작성일자 변경(서수란 접수 — 라프레리) — 자동 정책(익월 1일)이 만든 작성일자를
//   발행 전(ready/failed 원본 장)에 담당자가 고치는 창구. 문서번호는 그대로 유지된다.
const [taxbillDateTarget, setTaxbillDateTarget] = useState<any | null>(null);
const [taxbillDateValue, setTaxbillDateValue] = useState('');
const [taxbillDateRemark, setTaxbillDateRemark] = useState(''); // ★ 2026-08-21 계산서 비고(PO) — 변경 모달에서도 정정 가능
const [taxbillDateBusy, setTaxbillDateBusy] = useState(false);
// ★ 2026-07-29 수동 정산완료 — 우리 정산으로 발행할 수 없어 사람이 따로 처리한 회사의 그 달 기록.
//   담긴 좌/우 목록의 다중 선택(빼기)도 여기에 둔다 — 91개사를 한 줄씩 빼는 것은 쓸 수 없다.
const [bulkManualRows, setBulkManualRows] = useState<any[]>([]);
const [bulkManualOpen, setBulkManualOpen] = useState(false);
const [bulkManualBusy, setBulkManualBusy] = useState(false);
const [bulkManualReason, setBulkManualReason] = useState('');
const [bulkManualAsk, setBulkManualAsk] = useState<string[] | null>(null); // 사유 입력 모달 대상(회사 id) — null = 닫힘
const [bulkPickedSel, setBulkPickedSel] = useState<string[]>([]);          // 담긴 좌/우 목록 체크

const bulkPickedIds = () => new Set([...bulkCombined, ...bulkByUser].map((c) => c.id));

const fetchBulkList = async (opts: { keepPicked: boolean }) => {
  // ★ Codex 2R HIGH 수용 — 월은 ref에서 읽고(낡은 클로저 무력화), 시퀀스가 다르면 응답을 버린다
  //   (월 변경 직전에 나간 조회가 늦게 도착해 이전 월 목록을 되살리는 경로 차단).
  const seq = ++bulkReqSeqRef.current;
  const { start, end } = monthToPeriod(bulkMonthRef.current);
  setBulkListLoading(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/billing/bulk/unbilled?start=${start}&end=${end}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (seq !== bulkReqSeqRef.current) return; // 그 사이 월이 바뀜 — 이 응답은 폐기
    if (!res.ok) throw new Error(data?.error || '대상 조회 실패');
    setBulkList(Array.isArray(data.companies) ? data.companies : []);
    setBulkSelected([]);
    // ★ 2026-07-29 수동완료·해제 뒤의 재조회는 **담긴 목록을 지우지 않는다.**
    //   담아둔 뒤 남은 회사를 수동완료로 표시하면 애써 담은 수십 개사가 통째로 날아간다.
    //   수동완료는 담기지 않은 회사만 대상이라(체크박스가 그 행에만 있다) 담긴 목록과 겹치지 않는다.
    if (!opts.keepPicked) {
      setBulkCombined([]); setBulkByUser([]); setBulkPickedSel([]); setBulkPage(1);
    }
    // 수동완료 목록은 같은 기간을 보므로 함께 읽는다 — 목록에서 빠진 회사가 어디로 갔는지 화면에서 설명된다.
    void loadManualCompletions(seq);
  } catch (e: any) {
    if (seq === bulkReqSeqRef.current) setBillingToast({ msg: e?.message || '일괄발급 대상 조회 실패', type: 'error' });
  } finally {
    if (seq === bulkReqSeqRef.current) setBulkListLoading(false);
  }
};
// 인자 없는 두 진입점 — onClick에 직접 걸어도 이벤트 객체가 옵션으로 새지 않는다(LESSONS_FRONTEND 기본 인자 함정).
const loadBulkList = () => fetchBulkList({ keepPicked: false });
const refreshBulkList = () => fetchBulkList({ keepPicked: true });

// 수동완료 목록 — loadBulkList와 같은 시퀀스를 쓴다(월이 바뀐 뒤 늦게 온 응답은 버린다).
const loadManualCompletions = async (seq?: number) => {
  const mySeq = seq ?? bulkReqSeqRef.current;
  const { start, end } = monthToPeriod(bulkMonthRef.current);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/billing/bulk/manual-completions?start=${start}&end=${end}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (mySeq !== bulkReqSeqRef.current) return;
    if (!res.ok) throw new Error(data?.error || '수동 정산완료 조회 실패');
    setBulkManualRows(Array.isArray(data.rows) ? data.rows : []);
  } catch (e: any) {
    if (mySeq === bulkReqSeqRef.current) setBillingToast({ msg: e?.message || '수동 정산완료 조회 실패', type: 'error' });
  }
};

// 담기 — 정산 탭에 저장된 발행 단위(issue_scope)에 따라 좌/우 기본 배치. 담긴 회사는 상단에서 잠긴다.
//
// ★ 2026-07-29 `manual_billing` 회사는 **선택 담기에서도** 빠진다. 체크는 되게 두되(수동완료를 쳐야 하므로)
//   담기지는 않는다 — 자동 발급하면 안 되는 회사가 체크 한 번으로 딸려 들어가면 그게 사고다.
//   정말 자동으로 발급하려면 정산 탭에서 "수동 정산 회사"를 끄면 된다(명시적 행위).
// ★ 2026-07-30 최소과금(min_charge_supply) 회사도 동일 — 정액 발행(최소과금 모달)이 그 회사의 청구 경로다.
// ★ 2026-08-04 해지(status='terminated') 회사도 동일(서수란 접수) — 계약이 끝난 회사에 자동 발급이 나가면 안 된다.
//   목록에서 숨기지는 않는다: 해지 시각을 남기지 않아 "해지 직전 달 미청구분"이 남았는지를 데이터로 가릴 수 없고,
//   그 판단은 사람이 목록을 보고 해야 한다. 서버(filterBillableCompanies)가 job 생성·실행에서 같은 판정을
//   다시 하므로 **개별로 담아도 발급되지 않는다** — 미청구분은 위 [정산 생성](단건 발행)으로 처리한다.
const bulkAddRows = (rows: any[]): number => {
  const picked = bulkPickedIds();
  const adds = rows.filter((c) => !picked.has(c.id) && c.manual_billing !== true && c.min_charge_supply == null && c.status !== 'terminated');
  if (adds.length > 0) {
    setBulkCombined((prev) => [...prev, ...adds.filter((c) => c.issue_scope !== 'by_user')]);
    setBulkByUser((prev) => [...prev, ...adds.filter((c) => c.issue_scope === 'by_user')]);
  }
  return rows.length - adds.length;
};
const bulkAddSelected = () => {
  if (!bulkList) return;
  const skipped = bulkAddRows(bulkList.filter((c) => bulkSelected.includes(c.id)));
  setBulkSelected([]);
  if (skipped > 0) setBillingToast({ msg: `수동 정산·최소과금 회사 ${skipped}개사는 담지 않았습니다`, type: 'error' });
};
/** 전체 담기 — 이 달 미발급 후불 전량. 일괄발급의 본래 목적이라 한 번에 담는다. */
const bulkAddAll = () => {
  if (!bulkList) return;
  const picked = bulkPickedIds();
  const skipped = bulkAddRows(bulkList.filter((c) => !picked.has(c.id)));
  setBulkSelected([]);
  if (skipped > 0) setBillingToast({ msg: `수동 정산·최소과금 회사 ${skipped}개사는 담지 않았습니다`, type: 'error' });
};
const bulkMoveToByUser = (id: string) => {
  const row = bulkCombined.find((c) => c.id === id);
  if (!row) return;
  setBulkCombined((prev) => prev.filter((c) => c.id !== id));
  setBulkByUser((prev) => [...prev, row]);
};
const bulkMoveToCombined = (id: string) => {
  const row = bulkByUser.find((c) => c.id === id);
  if (!row) return;
  setBulkByUser((prev) => prev.filter((c) => c.id !== id));
  setBulkCombined((prev) => [...prev, row]);
};
const bulkRemove = (id: string) => {
  setBulkCombined((prev) => prev.filter((c) => c.id !== id));
  setBulkByUser((prev) => prev.filter((c) => c.id !== id));
  setBulkPickedSel((prev) => prev.filter((x) => x !== id));
};
/** 담긴 목록에서 체크한 회사를 한 번에 뺀다 — 빠진 회사는 상단 미발급 목록으로 되돌아간다. */
const bulkRemoveSelected = () => {
  if (bulkPickedSel.length === 0) return;
  const drop = new Set(bulkPickedSel);
  setBulkCombined((prev) => prev.filter((c) => !drop.has(c.id)));
  setBulkByUser((prev) => prev.filter((c) => !drop.has(c.id)));
  setBulkPickedSel([]);
};

// ── 수동 정산완료 ───────────────────────────────────────────
// 청구서를 만들지 않는다. 그 달 목록에서만 빠지고, 해제하면 곧바로 돌아온다.
const handleManualComplete = async () => {
  const ids = bulkManualAsk || [];
  if (ids.length === 0) return;
  const { start, end } = monthToPeriod(bulkMonthRef.current);
  setBulkManualBusy(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/billing/bulk/manual-completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ period_start: start, period_end: end, company_ids: ids, reason: bulkManualReason }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '수동 정산완료 처리 실패');
    setBulkManualAsk(null); setBulkManualReason('');
    // 실제 효과를 다시 읽어 확인한다 — 목록에서 빠졌는지는 서버 응답이 아니라 재조회가 증거다.
    await refreshBulkList();
    const skipped: string[] = Array.isArray(data.skipped) ? data.skipped : [];
    setBillingToast({
      msg: skipped.length > 0
        ? `${data.added}개사 수동 정산완료 · ${skipped.length}개사는 제외. 이미 발행됐거나 이미 수동완료입니다(${skipped.join(', ')})`
        : `${data.added}개사를 수동 정산완료로 표시했습니다`,
      type: skipped.length > 0 ? 'error' : 'success',
    });
  } catch (e: any) {
    setBillingToast({ msg: e?.message || '수동 정산완료 처리 실패', type: 'error' });
  } finally {
    setBulkManualBusy(false);
  }
};
const handleManualRelease = async (id: string) => {
  setBulkManualBusy(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/billing/bulk/manual-completions/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '해제 실패');
    await refreshBulkList();
    setBillingToast({ msg: '수동 정산완료를 해제했습니다. 미발급 목록으로 돌아갑니다', type: 'success' });
  } catch (e: any) {
    setBillingToast({ msg: e?.message || '해제 실패', type: 'error' });
  } finally {
    setBulkManualBusy(false);
  }
};

const handleBulkStart = async () => {
  // ★ Codex 2R HIGH 수용 — 발급 기간도 ref에서. 담기 목록은 월 변경 시 비워지므로 ref 월과 항상 한 쌍이다.
  // ★ 2026-07-29 요청 월을 **여기서 한 번 캡처**해 기간 계산·job 월 기록·409 처리가 같은 값을 쓴다.
  //   응답을 받은 뒤에 ref를 다시 읽으면, 요청 중에 월을 바꾼 경우 job 월이 새 월로 잘못 기록되고
  //   완료 콜백이 "같은 월"로 오판해 새로 담아둔 목록을 통째로 지운다.
  const requestMonth = bulkMonthRef.current;
  const { start, end } = monthToPeriod(requestMonth);
  const items = [
    ...bulkCombined.map((c) => ({ company_id: c.id, scope: 'combined' })),
    ...bulkByUser.map((c) => ({ company_id: c.id, scope: 'by_user' })),
  ];
  if (items.length === 0) { setBillingToast({ msg: '발급할 회사를 담아 주세요', type: 'error' }); return; }
  setBulkStarting(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/billing/bulk/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ period_start: start, period_end: end, items }),
    });
    const data = await res.json();
    if (!res.ok) {
      // ★ 2026-07-29 서버가 대상을 다시 판정해 거부한 경우(수동 정산 회사·이미 발행·수동완료)는
      //   화면이 낡은 것이므로 목록을 다시 읽어 준다 — 사람이 무엇이 바뀌었는지 바로 본다.
      //   화면이 그 사이 다른 월로 옮겨갔으면 담긴 목록을 지우지 않는다(보존 새로고침).
      if (data?.code === 'BULK_TARGET_NOT_BILLABLE') {
        if (bulkMonthRef.current === requestMonth) void loadBulkList();
        else void refreshBulkList();
      }
      throw new Error(data?.error || '일괄발급 시작 실패');
    }
    bulkJobMonthRef.current = requestMonth;
    setBulkJob(null);
    setBulkJobId(String(data.job_id));
  } catch (e: any) {
    setBillingToast({ msg: e?.message || '일괄발급 시작 실패', type: 'error' });
  } finally {
    setBulkStarting(false);
  }
};

// 진행률 폴링 — job이 끝나면(부분 실패 포함) 대상 목록을 다시 읽어 발급된 회사가 빠지게 한다.
// ★ Codex 1R MEDIUM 수용 — 요청 중첩(2초 넘게 걸리는 tick)과 종료 후 늦게 도착한 응답의 화면 덮어쓰기 차단.
useEffect(() => {
  if (!bulkJobId) return;
  let alive = true;
  let stopped = false;
  let inFlight = false;
  const tick = async () => {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/billing/bulk/jobs/${bulkJobId}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!alive || stopped || !res.ok) return;
      setBulkJob(data);
      if (data?.job?.status && data.job.status !== 'running') {
        stopped = true;
        clearInterval(timer);
        // ★ 2026-07-29 job 실행 중 다른 월로 옮겨 담았을 수 있다. 그 경우 전량 초기화하면
        //   새 월에 담아둔 목록이 통째로 날아간다 — 월이 같을 때만 초기화하고, 다르면 보존 새로고침.
        if (bulkJobMonthRef.current === bulkMonthRef.current) loadBulkList();
        else refreshBulkList();
      }
    } catch { /* 다음 주기 재시도 */ } finally {
      inFlight = false;
    }
  };
  const timer = setInterval(tick, 2000);
  tick();
  return () => { alive = false; stopped = true; clearInterval(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [bulkJobId]);

const loadConfirmBoard = async (statusFilter?: string) => {
  const { start, end } = monthToPeriod(bulkMonth);
  setConfirmLoading(true);
  try {
    const token = localStorage.getItem('token');
    const st = statusFilter !== undefined ? statusFilter : confirmStatusFilter;
    const q = st ? `&status=${st}` : '';
    const res = await fetch(`/api/admin/billing/confirmations?start=${start}&end=${end}${q}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '현황 조회 실패');
    setConfirmRows(Array.isArray(data.confirmations) ? data.confirmations : []);
    setConfirmTruncated(!!data.truncated);
  } catch (e: any) {
    setBillingToast({ msg: e?.message || '컨펌 현황 조회 실패', type: 'error' });
  } finally {
    setConfirmLoading(false);
  }
};

// 직접선택(중간정산) 건 — 작성일자 지정 → 발급 대기(ready) 진입
const handleManualIssueDate = async (confirmationId: string, requireRemark?: boolean) => {
  const d = manualDateDraft[confirmationId] || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { setBillingToast({ msg: '작성일자를 선택해 주세요', type: 'error' }); return; }
  // ★ 2026-08-21 계산서 비고(PO) — 필수 회사는 비어 있으면 서버가 422로 막는다. 화면에서도 먼저 안내한다.
  const remark = (manualRemarkDraft[confirmationId] || '').trim();
  if (requireRemark && !remark) { setBillingToast({ msg: '이 회사는 계산서 비고(PO번호)가 필수입니다', type: 'error' }); return; }
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/billing/confirmations/${confirmationId}/issue-date`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ issue_date: d, taxbill_remark: remark }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '작성일자 지정 실패');
    setBillingToast({ msg: data?.message || '발급 대기에 올렸습니다', type: 'success' });
    loadConfirmBoard();
  } catch (e: any) {
    setBillingToast({ msg: e?.message || '작성일자 지정 실패', type: 'error' });
  }
};

// 업체 확인 대리 기록 — 성공하면 컨펌 시각이 남아 작성일자 지정이 열린다.
const handleAdminConfirm = async () => {
  if (!adminConfirmTarget) return;
  const note = adminConfirmNote.trim();
  if (!note) { setBillingToast({ msg: '어떻게 확인받았는지 적어주세요', type: 'error' }); return; }
  setAdminConfirmBusy(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/billing/confirmations/${adminConfirmTarget.id}/admin-confirm`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ note }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '업체 확인 기록 실패');
    setBillingToast({ msg: data?.message || '업체 확인을 기록했습니다', type: 'success' });
    setAdminConfirmTarget(null);
    setAdminConfirmNote('');
    loadConfirmBoard();
  } catch (e: any) {
    setBillingToast({ msg: e?.message || '업체 확인 기록 실패', type: 'error' });
  } finally {
    setAdminConfirmBusy(false);
  }
};

const CONFIRM_STATUS_LABELS: Record<string, string> = {
  pending: '컨펌 대기', confirmed: '컨펌됨', due: '기한 경과', objected: '이의신청',
  manual_wait: '날짜 지정 대기', ready: '계산서 발급 대기', issued: '발급 완료',
};

// ★ 2026-07-30 세금계산서 장부 — 컨펌 추적과 다른 축(정산 1건에 원본+수정 N장)
const TAXBILL_STATUS_LABELS: Record<string, string> = {
  ready: '발급 대기', submitted: '발행 확인 중', issued: '발행 완료', failed: '실패', cancelled: '취소',
};
const MODIFY_CODE_LABELS: Record<number, string> = {
  1: '기재사항 착오정정 (부+정 2장)', 2: '공급가액 변동 (±1장)', 4: '계약 해제 (-1장)', 6: '착오 이중발급 취소 (-1장)',
};

const loadTaxbillIssues = async (statusFilter?: string) => {
  const { start, end } = monthToPeriod(bulkMonth);
  setTaxbillLoading(true);
  try {
    const token = localStorage.getItem('token');
    const st = statusFilter !== undefined ? statusFilter : taxbillStatusFilter;
    const q = st ? `&status=${st}` : '';
    const res = await fetch(`/api/admin/billing/taxbill-issues?start=${start}&end=${end}${q}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '장부 조회 실패');
    setTaxbillRows(Array.isArray(data.issues) ? data.issues : []);
    setTaxbillTruncated(!!data.truncated);
  } catch (e: any) {
    setBillingToast({ msg: e?.message || '세금계산서 장부 조회 실패', type: 'error' });
  } finally {
    setTaxbillLoading(false);
  }
};

// 수정발행 모달 열기 — 대상 장 기준으로 입력 초기화
const openModifyModal = (row: any) => {
  setModifyTarget(row);
  setModifyCode(6);
  setModifyWriteDate('');
  setModifyDeltaSupply('');
  setModifyDeltaTax('');
  setModifyCorrectedSupply(String(Math.trunc(Number(row.supply_amount) || 0)));
  setModifyCorrectedTax(String(Math.trunc(Number(row.tax_amount) || 0)));
};

// 빈 문자열·소수·비숫자를 Number 변환 전에 거부 — Number('')=0 함정(D150-3 계열)이 0원 장을 만든다
const intOrNull = (v: string): number | null => (/^-?\d+$/.test(String(v).trim()) ? Number(v) : null);

const handleModifySubmit = async () => {
  if (!modifyTarget || modifySubmitting) return;
  // 서버(planModifyIssue)가 최종 계약을 지키지만, 여기서 먼저 걸러야 사용자가 이유를 바로 본다
  if (modifyCode === 2 || modifyCode === 4) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(modifyWriteDate)) {
      setBillingToast({ msg: modifyCode === 2 ? '변동일을 선택해 주세요' : '해제일을 선택해 주세요', type: 'error' });
      return;
    }
  }
  if (modifyCode === 2 && (intOrNull(modifyDeltaSupply) === null || intOrNull(modifyDeltaTax) === null)) {
    setBillingToast({ msg: '변동분 공급가액·세액을 정수로 입력해 주세요', type: 'error' });
    return;
  }
  if (modifyCode === 1 && (intOrNull(modifyCorrectedSupply) === null || intOrNull(modifyCorrectedTax) === null)) {
    setBillingToast({ msg: '정정 후 공급가액·세액을 정수로 입력해 주세요', type: 'error' });
    return;
  }
  setModifySubmitting(true);
  try {
    const token = localStorage.getItem('token');
    const body: any = { code: modifyCode };
    if (modifyCode === 2 || modifyCode === 4) body.write_date = modifyWriteDate;
    if (modifyCode === 2) { body.delta_supply = intOrNull(modifyDeltaSupply); body.delta_tax = intOrNull(modifyDeltaTax); }
    if (modifyCode === 1) { body.corrected_supply = intOrNull(modifyCorrectedSupply); body.corrected_tax = intOrNull(modifyCorrectedTax); }
    const res = await fetch(`/api/admin/billing/taxbill-issues/${modifyTarget.id}/modify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '수정발행 요청 실패');
    setBillingToast({ msg: data?.message || '수정세금계산서를 발급 대기에 올렸습니다', type: 'success' });
    setModifyTarget(null);
    loadTaxbillIssues();
  } catch (e: any) {
    setBillingToast({ msg: e?.message || '수정발행 요청 실패', type: 'error' });
  } finally {
    setModifySubmitting(false);
  }
};

// 실패 장 재시도 — failed → ready (문서번호가 결정적이라 같은 번호로 재발행 = 중복 없음)
//   ★ 2026-08-07 수정(취소·정정) 장은 사유와 명시 확인을 함께 보낸다. 그 문서는 이미 국세청에 있는
//   원본을 취소·정정하므로, 눌린 김에 나가면 정상 문서가 사라진다(크로커다일 −3,903,325 실측).
const handleTaxbillRetry = async (issueId: string, opts?: { reason: string }) => {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/billing/taxbill-issues/${issueId}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(opts ? { confirm: true, reason: opts.reason } : {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '재시도 요청 실패');
    setBillingToast({ msg: data?.message || '발급 대기에 다시 올렸습니다', type: 'success' });
    setTaxbillRetryTarget(null);
    setTaxbillRetryReason('');
    loadTaxbillIssues();
  } catch (e: any) {
    setBillingToast({ msg: e?.message || '재시도 요청 실패', type: 'error' });
  }
};

// ★ 2026-08-21 작성일자 변경 — ready/failed 원본 장만(서버와 같은 화이트리스트). 문서번호는 유지된다.
//   failed 건은 서버가 ready로 복귀시켜 변경+재시도가 한 번에 끝난다.
const handleTaxbillIssueDateChange = async () => {
  if (!taxbillDateTarget) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(taxbillDateValue)) { setBillingToast({ msg: '작성일자를 선택해 주세요', type: 'error' }); return; }
  setTaxbillDateBusy(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/billing/taxbill-issues/${taxbillDateTarget.id}/issue-date`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      // ★ 2026-08-21 비고 키를 항상 보낸다(빈 값 = 지움) — 모달이 기존 값을 기본으로 보여주므로 그대로 두면 유지된다.
      body: JSON.stringify({ issue_date: taxbillDateValue, taxbill_remark: taxbillDateRemark.trim() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '작성일자 변경 실패');
    setBillingToast({ msg: data?.message || '작성일자를 변경했습니다', type: 'success' });
    setTaxbillDateTarget(null);
    setTaxbillDateValue('');
    setTaxbillDateRemark('');
    loadTaxbillIssues();
  } catch (e: any) {
    setBillingToast({ msg: e?.message || '작성일자 변경 실패', type: 'error' });
  } finally {
    setTaxbillDateBusy(false);
  }
};

// ★ 2026-08-05 테스트베드 발행분을 운영으로 다시 태운다 — 문서번호가 그대로라 같은 번호로 나간다.
const handleTaxbillReissueProduction = async () => {
  if (!taxbillProdTarget) return;
  setTaxbillProdBusy(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/billing/taxbill-issues/${taxbillProdTarget.id}/reissue-production`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '운영 재발행 요청 실패');
    setBillingToast({ msg: data?.message || '발급 대기에 올렸습니다', type: 'success' });
    setTaxbillProdTarget(null);
    loadTaxbillIssues();
    loadConfirmBoard();
  } catch (e: any) {
    setBillingToast({ msg: e?.message || '운영 재발행 요청 실패', type: 'error' });
  } finally {
    setTaxbillProdBusy(false);
  }
};

// ★ 2026-08-05 발급 대기 취소 — 워커가 국세청으로 보내기 전에 큐에서 내린다.
const handleTaxbillCancel = async () => {
  if (!taxbillCancelTarget) return;
  const reason = taxbillCancelReason.trim();
  if (!reason) { setBillingToast({ msg: '취소 사유를 적어주세요', type: 'error' }); return; }
  setTaxbillCancelBusy(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/billing/taxbill-issues/${taxbillCancelTarget.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      // ★ 2026-08-07 모달을 연 시점의 상태를 함께 보낸다(CAS) — 그 사이 [재시도]가 failed를 ready로
      //   올렸다면 담당자가 본 것과 다른 장을 내리게 된다. 서버가 불일치면 409로 되돌린다.
      body: JSON.stringify({ reason, expected_status: taxbillCancelTarget.status }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '발급 대기 취소 실패');
    setBillingToast({ msg: data?.message || '발급 대기에서 내렸습니다', type: 'success' });
    setTaxbillCancelTarget(null);
    setTaxbillCancelReason('');
    loadTaxbillIssues();
    loadConfirmBoard();
  } catch (e: any) {
    setBillingToast({ msg: e?.message || '발급 대기 취소 실패', type: 'error' });
  } finally {
    setTaxbillCancelBusy(false);
  }
};

// ★ 2026-08-05 (서수란 접수) 발행 완료분 메일 재발송 — 발행이 아니라 **메일만** 다시 나간다.
//   상태를 바꾸지 않으므로 목록을 다시 부르지 않는다(바뀔 값이 없다).
const handleTaxbillResend = async () => {
  if (!taxbillResendTarget) return;
  setTaxbillResendBusy(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/billing/taxbill-issues/${taxbillResendTarget.id}/resend-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: taxbillResendEmail.trim() || undefined }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '계산서 메일 재발송 실패');
    setBillingToast({ msg: data?.message || '계산서 메일을 다시 보냈습니다', type: 'success' });
    setTaxbillResendTarget(null);
    setTaxbillResendEmail('');
  } catch (e: any) {
    setBillingToast({ msg: e?.message || '계산서 메일 재발송 실패', type: 'error' });
  } finally {
    setTaxbillResendBusy(false);
  }
};

// ★ 2026-08-04 발행 확인 모달을 열면서 미리보기를 함께 부른다.
//   금액과 "발행이 막힐 이유"(billing_guard)를 발행 **전에** 같은 화면에서 본다 —
//   서버는 미리보기와 발행을 같은 함수로 판정하므로 여기 통과하면 발행도 통과한다.
const openBillingGenerateConfirm = async () => {
  if (!billingCompanyId) { setBillingToast({ msg: '고객사를 선택해주세요', type: 'error' }); return; }
  setBillingPreview(null);
  setShowGenerateConfirm(true);
  setBillingPreviewLoading(true);
  try {
    const res = await billingApi.preview({
      company_id: billingCompanyId,
      start: billingStart,
      end: billingEnd,
    });
    setBillingPreview(res.data);
  } catch (e: any) {
    // 미리보기 실패가 발행을 막지는 않는다 — 사유만 알리고 모달은 열어 둔다(서버가 최종 판정).
    setBillingToast({ msg: e.response?.data?.error || '미리보기 집계 실패. 발행 시 서버가 다시 판정합니다', type: 'error' });
  } finally { setBillingPreviewLoading(false); }
};

const handleBillingGenerate = async () => {
  setShowGenerateConfirm(false);
  setGenerating(true);
  try {
    // ★ 2026-07-26 단일 계정 지정(user_id) 폐기 — 서버가 422(BILLING_USER_SCOPE_CHANGED)로 차단한다.
    //   계정별은 scope='by_user'로 회사 전체가 계정 장 N + 공통 장 1 묶음으로 나온다.
    const res = await billingApi.generateBilling({
      company_id: billingCompanyId,
      scope: billingScope === 'user' ? 'by_user' : 'combined',
      billing_start: billingStart, billing_end: billingEnd,
      // ★ 2026-08-20 정산월 라벨 — 화면이 보여준 값을 그대로 보낸다(기본값 유도를 서버에 다시 맡기지 않는다).
      ...(billingLabelEffective ? { billing_label_month: billingLabelEffective } : {}),
    });
    const sheetCount = Number(res.data?.sheet_count) || 1;
    setBillingToast({ msg: `${billingLabelText(billingLabelEffective)} 정산(${billingStart} ~ ${billingEnd})이 생성되었습니다${sheetCount > 1 ? ` (${sheetCount}장 묶음)` : ''}`, type: 'success' });
    loadBillings();
  } catch (e: any) {
    // ★ 2026-07-26 409를 "삭제 후 재생성해주세요" 고정 문구로 덮지 않는다 — 그 안내대로 지우면
    //   billed 크레딧이 얽힌 경로로 들어가는 것이 0725에 고친 결함이고, 서버 문구가 기간·단위까지 담는다.
    setBillingToast({ msg: e.response?.data?.error || '정산 생성 실패', type: 'error' });
  } finally { setGenerating(false); }
};
const openBillingDetail = async (id: string) => {
  setShowBillingDetail(true);
  setDetailLoading(true);
  try {
    const res = await billingApi.getBillingItems(id);
    setDetailBilling(res.data.billing); setDetailItems(res.data.items);
    setDetailLines(res.data.lines || []); setDetailHeaderCheck(res.data.header_check || null);
  }
  catch (e) { setBillingToast({ msg: '상세 조회 실패', type: 'error' }); setShowBillingDetail(false); }
  finally { setDetailLoading(false); }
};
// ★ 2026-08-05 (서수란 접수) 정산 목록 선택 축 — "한 건씩 확정하고 메일도 한 건씩 눌러야 한다"
const [billingSel, setBillingSel] = useState<string[]>([]);
const [billingBulk, setBillingBulk] = useState<{ label: string; done: number; total: number } | null>(null);
// 목록이 바뀌면(연도·미발송 필터·재조회) 화면에 없는 선택은 버린다 — 안 보이는 건이 선택에 남아 있으면
// 버튼의 건수와 실제 실행 대상이 갈라지고, 담당자는 그 차이를 볼 방법이 없다.
useEffect(() => {
  setBillingSel((prev) => {
    const next = prev.filter((id) => billings.some((b: any) => b.id === id));
    return next.length === prev.length ? prev : next;
  });
}, [billings]);

// ★ 2026-08-06 정산 목록 검색 + 15개씩 페이징 (Harold 지시) — 목록이 길어 원하는 회사를 찾기 어려웠다.
//   검색은 **화면 안에서만** 좁힌다(서버 재조회 없음) — 선택은 페이지를 넘겨도, 검색어를 바꿔도 유지된다.
//   일괄 실행은 `billings` 전체에서 선택된 것을 대상으로 하므로 지금 안 보이는 선택도 함께 실행된다.
const BILLING_PAGE_SIZE = 15;
const [billingSearch, setBillingSearch] = useState('');
const [billingPage, setBillingPage] = useState(1);
const billingRows = useMemo(() => {
  const q = billingSearch.trim().toLowerCase();
  if (!q) return billings;
  return billings.filter((b: any) =>
    String(b.company_name || '').toLowerCase().includes(q)
    || String(b.user_name || '').toLowerCase().includes(q));
}, [billings, billingSearch]);
const billingTotalPages = Math.max(1, Math.ceil(billingRows.length / BILLING_PAGE_SIZE));
const billingPageNow = Math.min(billingPage, billingTotalPages);
const billingVisible = billingRows.slice((billingPageNow - 1) * BILLING_PAGE_SIZE, billingPageNow * BILLING_PAGE_SIZE);
useEffect(() => { setBillingPage(1); }, [billingSearch, billings]);

/**
 * 선택 건 일괄 실행. **새 일괄 엔드포인트를 만들지 않는다** — 확정은 `PUT /:id/status`,
 * 발송은 컨펌 경로(`bulk/retry-confirmations`)를 건별로 그대로 부른다. 서버에 벌크 문을 하나 더 두면
 * 발행 코어와 중복 발송 확인(409)을 우회하는 두 번째 길이 생기고, 그 둘은 반드시 갈라진다.
 *
 * 순차 실행이라 앞 건 실패가 뒤 건을 막지 않는다. 결과는 건별로 모아 그대로 보여준다(조용한 누락 금지).
 * **이미 발송된 장은 일괄 발송에 넣지 않는다** — 재발송은 "언제·누구에게 나갔는지"를 확인받는 개별 축이다.
 */
const runBillingBulk = async (kind: 'confirm' | 'send') => {
  // ★ 2026-08-20 실행도 필터 귀속으로 잠근다(Codex 3R 수용 — fail-closed). 지금 화면의 목록이
  //   현재 필터로 적재 확인된 것이 아니면 어떤 일괄 동작도 하지 않는다.
  if (billingsKey === '' || billingsKey !== billingFilterKeyRef.current) {
    showAlert('확인', '목록을 현재 조건으로 불러오는 중이거나 불러오지 못했습니다. 목록이 표시된 뒤 다시 선택해 주세요.', 'info');
    return;
  }
  const rows = billings.filter((b: any) => billingSel.includes(b.id));
  const eligible = kind === 'confirm'
    ? rows.filter((b: any) => b.status === 'draft')
    : rows.filter((b: any) => !b.emailed_at);
  const skipped = rows.length - eligible.length;
  if (eligible.length === 0) {
    showAlert('확인', kind === 'confirm'
      ? '선택한 건 중 확정할 수 있는 초안이 없습니다.'
      : '선택한 건 중 아직 발송되지 않은 청구서가 없습니다. 이미 나간 건은 행의 [재발송]으로 하나씩 확인 후 보냅니다.', 'info');
    return;
  }
  const label = kind === 'confirm' ? '청구 확정' : '발송';
  // ★ 2026-08-21 (서수란 접수 cmt2lh16200ezjnot2dke7nxe) 발송의 실행 단위는 행이 아니라 **묶음**이다.
  //   `retry-confirmations`는 받은 장과 같은 batch_id의 미발송 형제 장을 **전부** 보낸다(계정별 발급 = 한 묶음).
  //   행마다 부르면 첫 호출이 묶음 전체를 보내고 나머지 호출은 targeted 0 → "보낼 미발송 장이 없습니다"가
  //   실패로 집계됐다(시세이도 4장: 화면은 성공 1·실패 3, 실제는 4통 발송 — DB emailed_at 4행 실측).
  //   묶음당 1회만 부르고, 나간 통 수는 서버 summary.sent를 그대로 적는다(선택이 묶음의 일부여도 서버는
  //   묶음의 미발송 장 전부를 보내므로 선택 수가 아니라 실제 통 수를 보여준다). 청구 확정은 행 단위 그대로다.
  type BulkUnit = { company_name: string; ids: string[] };
  let units: BulkUnit[];
  if (kind === 'confirm') {
    units = eligible.map((b: any) => ({ company_name: b.company_name, ids: [b.id] }));
  } else {
    const byBatch = new Map<string, BulkUnit>();
    for (const b of eligible) {
      const key = String(b.batch_id || b.id);
      const u = byBatch.get(key);
      if (u) u.ids.push(b.id);
      else byBatch.set(key, { company_name: b.company_name, ids: [b.id] });
    }
    units = Array.from(byBatch.values());
  }
  setBillingBulk({ label, done: 0, total: units.length });
  const ok: string[] = [];
  const fail: string[] = [];
  const partial: string[] = [];
  let sentTotal = 0;
  const token = localStorage.getItem('token');
  for (const u of units) {
    try {
      if (kind === 'confirm') {
        await billingApi.updateBillingStatus(u.ids[0], 'confirmed');
        ok.push(u.company_name);
      } else {
        const res = await fetch('/api/admin/billing/bulk/retry-confirmations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ billing_id: u.ids[0] }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || '발송 실패');
        // ⚠ 이 엔드포인트는 **한 통도 못 나가도 success: true**를 돌려준다(금액 불일치·PDF 장애·이메일 미등록).
        //   HTTP 상태로만 판정하면 막힌 장이 "발송 완료"로 세어져 그 회사는 아무도 다시 보지 않는다.
        //   실제로 나간 통 수(summary.sent)로 가른다.
        const s: any = data?.summary || {};
        const sentCount = Number(s.sent) || 0;
        const blocked = Number(s.mismatchBlocked || 0) + Number(s.renderFailed || 0)
          + Number(s.skippedNoEmail || 0) + Number(s.mailFailed || 0);
        // 묶음당 1회 호출이라 정상 경로에서 targeted 0은 나오지 않는다 — 나오면 그 사이 다른 요청이 보냈거나 장이 사라진 것이다.
        if (Number(data?.targeted) === 0) fail.push(`${u.company_name}: 보낼 미발송 장이 없습니다(그 사이 발송됐거나 장을 찾지 못했습니다)`);
        else if (sentCount === 0) fail.push(`${u.company_name}: ${data?.message || '한 통도 나가지 않았습니다'}`);
        else {
          sentTotal += sentCount;
          ok.push(`${u.company_name}: ${sentCount}장 발송`);
          if (blocked > 0) partial.push(`${u.company_name}: ${data?.message || `일부 ${blocked}장이 나가지 않았습니다`}`);
        }
      }
    } catch (e: any) {
      fail.push(`${u.company_name}: ${e?.response?.data?.error || e?.message || '실패'}`);
    }
    setBillingBulk((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
  }
  setBillingBulk(null);
  setBillingSel([]);
  await loadBillings();
  const lines = kind === 'send'
    ? [`발송 성공 ${ok.length}건 · ${sentTotal}장`, ...ok]
    : [`${label} 성공 ${ok.length}건`];
  if (skipped > 0) lines.push(`대상 아님 ${skipped}건(선택에서 제외)`);
  if (partial.length > 0) lines.push('', '일부만 나감:', ...partial);
  if (fail.length > 0) lines.push('', '실패:', ...fail);
  const bad = fail.length + partial.length;
  showAlert(bad > 0 ? '확인 필요' : '완료', lines.join('\n'), bad > 0 ? 'error' : 'success');
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
    const res = await billingApi.deleteBilling(deleteTargetId, deleteReason.trim() || undefined);
    const deleted = Number(res.data?.deleted_ids?.length) || 1;
    setBillingToast({ msg: deleted > 1 ? `묶음 ${deleted}장이 함께 삭제되었습니다` : '정산이 삭제되었습니다', type: 'success' });
    setDeleteReason('');
    loadBillings();
    if (showBillingDetail && detailBilling?.id === deleteTargetId) setShowBillingDetail(false);
  } catch (e: any) {
    // 확정·수금·메일 발송분은 사유가 없으면 서버가 막는다 — 모달을 다시 열어 사유를 받는다.
    if (e.response?.data?.code === 'BILLING_DELETE_NEEDS_REASON') setShowBillingDeleteConfirm(true);
    setBillingToast({ msg: e.response?.data?.error || '삭제 실패', type: 'error' });
  }
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
      setSyncKeys(data.syncKeys);
    }
  } catch (error) {
    console.error('SyncAgent 토글 실패:', error);
  } finally {
    setSyncLoading(false);
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
    const response = await fetch(`/api/admin/billing/${id}/pdf`, { headers: { 'Authorization': `Bearer ${token}` } });
    // ★ 2026-07-26 서버 사유를 그대로 띄운다 — 항목합↔공급가액 불일치는 422 JSON으로 오는데
    //   그 전에는 'PDF 생성 실패' 한 줄로 덮여 운영자가 왜 막혔는지 알 수 없었다(정합 검사가 무의미해진다).
    if (!response.ok) {
      let msg = 'PDF 생성 실패';
      try { const j = await response.json(); msg = j.error || msg; } catch { /* 스트림이면 JSON이 아니다 */ }
      throw new Error(msg);
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `정산서_${label}.pdf`; a.click();
    window.URL.revokeObjectURL(url);
  } catch (e: any) { setBillingToast({ msg: e?.message || 'PDF 다운로드 실패', type: 'error' }); }
};
const handleInvoiceStatusChange = async (id: string, newStatus: string) => {
  try { await billingApi.updateStatus(id, newStatus); setBillingToast({ msg: '상태가 변경되었습니다', type: 'success' }); loadInvoices(); }
  catch (e) { setBillingToast({ msg: '상태 변경 실패', type: 'error' }); }
};
const downloadInvoicePdf = async (inv: any) => {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`/api/admin/billing/invoices/${inv.id}/pdf`, { headers: { 'Authorization': `Bearer ${token}` } });
    // ★ 2026-07-26 응답 검사 추가 — 그 전에는 오류 JSON을 그대로 .pdf로 저장해, 열리지 않는 파일이 내려왔다.
    if (!response.ok) {
      let msg = 'PDF 생성 실패';
      try { const j = await response.json(); msg = j.error || msg; } catch { /* 스트림이면 JSON이 아니다 */ }
      throw new Error(msg);
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `거래내역서_${inv.company_name}_${String(inv.billing_start).slice(0, 10)}.pdf`; a.click();
    window.URL.revokeObjectURL(url);
  } catch (e: any) { setBillingToast({ msg: e?.message || 'PDF 다운로드 실패', type: 'error' }); }
};
const billingFmt = (n: number) => (n || 0).toLocaleString('ko-KR');
const billingFmtWon = (n: number) => `₩${(n || 0).toLocaleString('ko-KR')}`;
const billingStatusBadge = (s: string) => {
  const map: Record<string, string> = { draft: 'bg-gray-100 text-gray-600', confirmed: 'bg-blue-100 text-blue-700', paid: 'bg-green-100 text-green-700' };
  const label: Record<string, string> = { draft: '초안', confirmed: '확정', paid: '수금완료' };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[s] || ''}`}>{label[s] || s}</span>;
};
// ★ 2026-07-26 청구 축 라벨 통일 — KAKAO는 '카카오알림톡'(0725 웹·에이전트 한 컬럼 라벨 통일과 같은 축),
//   스팸필터 유형키 추가. PDF·이메일(billing-invoice-lines CT)과 같은 이름이라야 화면=청구서다.
const billingTypeLabel: Record<string, string> = {
  SMS: 'SMS', LMS: 'LMS', MMS: 'MMS', KAKAO: '카카오알림톡',
  TEST_SMS: '테스트SMS', TEST_LMS: '테스트LMS', SPAM_SMS: '스팸SMS', SPAM_LMS: '스팸LMS',
};
// 상세 행 '구분' 라벨 — ★2026-07-31부터 **서버가 내리는 `scope_label`이 단일 진실**이다
// (backend `utils/billing-scope-label.ts`). 이 맵은 구버전 응답용 폴백으로만 남는다.
// `extra`(080·부가서비스)가 빠져 있어 화면에만 원문 'extra'가 노출되던 것도 함께 채운다.
const billingChannelLabel: Record<string, string> = { plan: '요금제', web: '한줄로', agent: '에이전트', test: '테스트', spam: '스팸필터', extra: '추가 항목' };
const billingChannelBg: Record<string, string> = { plan: 'bg-violet-50', agent: 'bg-blue-50/70', test: 'bg-amber-50', spam: 'bg-orange-50' };
// 요금제 구간 끝일 — item_date(YYYY-MM-DD) + (plan_days - 1). UTC 성분 산술이라 TZ 무관.
const billingShiftDay = (day: string, delta: number) => {
  const [y, m, d] = String(day).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return String(day).slice(5, 10);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
};
const billingCurrentYear = new Date().getFullYear();
const billingYearOptions = [billingCurrentYear - 1, billingCurrentYear, billingCurrentYear + 1];

// 정산서 이메일 발송 모달 열기
const openEmailModal = async (billing: any) => {
  setEmailTarget(billing);
  // ★ 2026-07-31 입력칸은 **비워 둔다**(Codex 2R — 1차 수정이 안 닫혔던 지점).
  //   원장에서 읽은 대표를 칸에 넣으면 그 값이 서버로 override로 가고, 서버는 override가 있으면
  //   참조(cc)를 떨어뜨린다 — 복수 수신자의 요지가 이 경로에서만 무효가 된다.
  //   그래서 **누구에게 가는지는 안내로 보여주고 칸은 비운다.** 칸을 채우면 그때만 그 한 사람에게 간다.
  setEmailTo('');
  setEmailDefaultTo(null);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/billing/company-billing-settings/${billing.company_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    const list: any[] = Array.isArray(data?.recipients) ? data.recipients : [];
    const scoped = billing.user_id
      ? list.filter((r) => String(r.user_id || '') === String(billing.user_id))
      : [];
    const pool_ = (scoped.length > 0 ? scoped : list.filter((r) => !r.user_id))
      .filter((r) => r.doc_type === 'statement' && r.is_active !== false);
    const primary = pool_.find((r) => r.is_primary) || pool_[0];
    if (primary?.email) {
      setEmailDefaultTo({
        primary: String(primary.email),
        cc: pool_.filter((r) => r.email !== primary.email).map((r) => String(r.email)),
      });
    }
  } catch {
    // 조회에 실패해도 안내만 비운 채로 연다 — 발송 자체는 서버가 등록된 수신자로 한다.
  }
  // ★ 2026-07-26 이 메일이 보내는 문서는 정산서다(첨부 PDF·본문 항목표 모두 정산서). 제목을 실물과 맞춘다.
  setEmailSubject(`[인비토] ${billing.company_name} ${billing.billing_year}년 ${billing.billing_month}월 정산서`);
  // 재발송 확인 상태는 모달을 열 때마다 초기화한다 — 앞 건의 확인이 남으면 확인 없이 재발송된다.
  setEmailResendInfo(null);
  setEmailResendAt(null);
  setShowEmailModal(true);
};

// ★ 2026-07-26 발송 전 PDF 선생성 — 서버는 첨부할 PDF가 디스크에 있어야 발송한다(BILLING_PDF_NOT_READY).
//   운영자가 "PDF 먼저 다운로드"라는 순서를 외워야 하는 UI는 마감일에 사고가 된다.
//   이 호출은 서버에서 PDF를 만들고 항목↔공급가액 정합 검사(422)를 함께 통과시킨다.
const ensureBillingPdf = async (id: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`/api/admin/billing/${id}/pdf`, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) {
    let msg = '청구서 PDF 생성에 실패했습니다';
    try { const j = await res.json(); msg = j.error || msg; } catch { /* PDF 스트림이면 본문이 JSON이 아니다 */ }
    throw new Error(msg);
  }
  await res.blob();   // 파일은 서버에 남는다 — 화면에 내려받지 않는다
};

// 정산서 이메일 발송 처리
//   ★ 2026-07-26 `resend` — 이미 발송된 정산서는 서버가 409로 한 번 되돌린다(확인 없는 중복 발송 차단).
//   확인 모달에서 다시 누르면 이 인자가 true로 들어와 그대로 발송된다.
const handleSendBillingEmail = async (resend = false) => {
  // ★ 2026-07-31 비어 있어도 막지 않는다 — 서버가 등록된 수신자로 해석해 보내고, 그것도 없으면 400으로 알린다.
  //   여기서 차단하면 새 원장에 대표가 있는데도 화면이 발송을 막는다(Codex 적대검증 high).
  if (!emailTarget) return;
  setEmailSending(true);
  try {
    // ★ 2026-07-26 본문은 서버가 만든다 — `billing_items`에서 항목표를 만들고 정합 검사를 통과한 본문만
    //   고객에게 나간다. 화면이 만든 HTML을 넘기면 그 검사를 우회하고, 실제로 그 본문에는 항목표가 없었다.
    //   첨부 PDF도 서버 파일이라 먼저 만들어 둔다.
    await ensureBillingPdf(emailTarget.id);
    const res = await billingApi.sendBillingEmail(emailTarget.id, {
      to: emailTo,
      subject: emailSubject,
      // 확인을 그 이력에 묶어 보낸다 — 확인 후 다른 발송이 있었으면 서버가 다시 409로 되돌린다.
      ...(resend && emailResendAt ? { resend: true, resend_of: emailResendAt } : {}),
    });
    // ★ 2026-07-12 성공 분기 (Codex HIGH 정정) — 실패 응답을 성공 토스트로 표시하던 무분기 제거
    if (!res.data?.success) {
      setBillingToast({ msg: res.data?.error || res.data?.message || '이메일 발송 실패', type: 'error' });
      return;
    }
    setBillingToast({ msg: res.data.message || '정산서가 발송되었습니다', type: 'success' });
    setShowEmailModal(false);
    setEmailResendInfo(null);
    setEmailResendAt(null);
    // 발송 이력 반영
    if (detailBilling?.id === emailTarget.id) {
      setDetailBilling((prev: any) => prev ? { ...prev, emailed_at: res.data.emailed_at, emailed_to: res.data.emailed_to } : prev);
    }
    loadBillings();
  } catch (e: any) {
    // 이미 발송된 정산서 = 409. 언제·누구에게 나갔는지 보여주고 재발송 확인을 받는다.
    if (e.response?.data?.code === 'BILLING_ALREADY_EMAILED') {
      const at = e.response.data.emailed_at ? formatDateTime(e.response.data.emailed_at) : '이전';
      setEmailResendInfo(`${at} · ${e.response.data.emailed_to || '수신자 미상'}`);
      setEmailResendAt(e.response.data.emailed_at || null);
      return;
    }
    // PDF 선생성 실패(정합 불일치 422 포함)는 fetch가 던진 Error라 `message`에 담긴다.
    setBillingToast({ msg: e.response?.data?.error || e.message || '이메일 발송 실패', type: 'error' });
  } finally {
    setEmailSending(false);
  }
};
  const loadData = async () => {
    // ★ 2026-06-13 첫 로딩 속도: 기존엔 7개 API를 직렬로 기다리는 동안 전체 화면이 "로딩 중..."에 막혀 있었음.
    //   첫 화면(대시보드 탭)에 필요한 고객사+요금제만 기다려 즉시 표시하고,
    //   나머지 5개는 병렬 백그라운드 — 각자 도착하는 대로 해당 탭 데이터가 채워진다(표시 값 동일).
    try {
      const [companiesRes, plansRes] = await Promise.all([
        companiesApi.list({ limit: 1000 }),
        plansApi.list(),
      ]);
      setCompanies(companiesRes.data.companies);
      setPlans(plansRes.data.plans);
    } catch (error) {
      console.error('데이터 로드 실패:', error);
    } finally {
      setLoading(false);
    }
    void Promise.allSettled([
      loadUsers(),              // 사용자 목록
      loadScheduledCampaigns(), // 예약 캠페인
      loadCallbackNumbers(),    // 발신번호
      loadPlans(),              // 요금제 목록
      loadPlanRequests(),       // 플랜 신청
      loadChargeManagement(1),  // 충전 관리 (배지 카운트용)
    ]);
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

  const loadScheduledCampaigns = async (page = 1) => {
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({ page: String(page), limit: String(scheduledPerPage) });
      if (scheduledSearch) params.set('search', scheduledSearch);
      if (scheduledCompanyFilter) params.set('companyId', scheduledCompanyFilter);
      if (scheduledStatusFilter) params.set('status', scheduledStatusFilter);
      if (scheduledStartDate) params.set('startDate', scheduledStartDate);
      if (scheduledEndDate) params.set('endDate', scheduledEndDate);
      if (scheduledLoginId) params.set('loginId', scheduledLoginId);
      const res = await fetch(`/api/admin/campaigns/scheduled?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setScheduledCampaigns(data.campaigns || []);
        setScheduledTotal(data.total || 0);
        setScheduledPage(page);
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

  // 발신번호 등록 신청 관련 함수
  const loadSenderRegistrations = async (status?: string) => {
    setSenderRegLoading(true);
    try {
      const token = localStorage.getItem('token');
      const url = status && status !== 'all'
        ? `/api/sender-registration/admin/all?status=${status}`
        : '/api/sender-registration/admin/all';
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSenderRegistrations(data.registrations || []);
      }
    } catch (error) {
      console.error('등록 신청 목록 로드 실패:', error);
    } finally {
      setSenderRegLoading(false);
    }
  };

  // ★ 2026-08-08 (임은지 접수) **알림은 축마다 따로 센다.**
  //   서버는 이미 나눠서 준다 — { managers(위임장), registrations(발신번호 신청), total }.
  //   그전에는 합계(count) 하나만 받아 `senderRegPendingCount`에 담고 그것을 **등록 신청 관리** 탭에 붙였다.
  //   그래서 위임장 대기 1건이 발신번호 신청 탭 뱃지로 뜨고, 그 탭 목록은 신청만 보니 0건이었다
  //   (실측: sender_registrations pending 0 · approved 2인데 뱃지 1).
  //   필드가 없으면 0으로 둔다 — 못 세는 쪽이 **틀린 탭에 띄우는 쪽보다** 낫다(이 접수가 그 사고다).
  const loadSenderRegPendingCount = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/sender-registration/admin/pending-count', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSenderRegPendingCount(Number(data.registrations ?? 0));
        setPendingManagerCount(Number(data.managers ?? 0));
      }
    } catch (error) {
      console.error('대기 건수 로드 실패:', error);
    }
  };

  const loadSenderRegDetail = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/sender-registration/admin/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSenderRegDetail(data.registration);
        setShowSenderRegDetailModal(true);
        setRejectReasonInput('');
      }
    } catch (error) {
      console.error('신청 상세 로드 실패:', error);
    }
  };

  const handleApproveSenderReg = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/sender-registration/admin/${id}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (res.ok) {
        setModal({ type: 'alert', title: '승인 완료', message: '발신번호가 승인되어 등록되었습니다.', variant: 'success' });
        setShowSenderRegDetailModal(false);
        setSenderRegDetail(null);
        loadSenderRegistrations(senderRegFilter);
        loadSenderRegPendingCount();
        loadCallbackNumbers();
      } else {
        setModal({ type: 'alert', title: '승인 실패', message: data.error || '승인 처리에 실패했습니다.', variant: 'error' });
      }
    } catch (error) {
      console.error('승인 처리 실패:', error);
      setModal({ type: 'alert', title: '오류', message: '승인 처리 중 오류가 발생했습니다.', variant: 'error' });
    }
  };

  const handleRejectSenderReg = async (id: string) => {
    if (!rejectReasonInput.trim()) {
      setModal({ type: 'alert', title: '입력 필요', message: '반려 사유를 입력해주세요.', variant: 'warning' });
      return;
    }
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/sender-registration/admin/${id}/reject`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectReason: rejectReasonInput.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        setModal({ type: 'alert', title: '반려 완료', message: '신청이 반려되었습니다.', variant: 'success' });
        setShowSenderRegDetailModal(false);
        setSenderRegDetail(null);
        setRejectReasonInput('');
        loadSenderRegistrations(senderRegFilter);
        loadSenderRegPendingCount();
      } else {
        setModal({ type: 'alert', title: '반려 실패', message: data.error || '반려 처리에 실패했습니다.', variant: 'error' });
      }
    } catch (error) {
      console.error('반려 처리 실패:', error);
      setModal({ type: 'alert', title: '오류', message: '반려 처리 중 오류가 발생했습니다.', variant: 'error' });
    }
  };

  const downloadSenderDoc = async (filename: string, originalName?: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/sender-registration/admin/download/${filename}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('다운로드 실패');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = originalName || filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('문서 다운로드 실패:', error);
      setModal({ type: 'alert', title: '다운로드 실패', message: '문서 다운로드에 실패했습니다.', variant: 'error' });
    }
  };

  // === 담당자 위임장 승인 관리 ===
  const loadAllManagers = async () => {
    try {
      const token = localStorage.getItem('token');
      const url = mgrFilter !== 'all'
        ? `/api/sender-registration/admin/all-managers?status=${mgrFilter}`
        : '/api/sender-registration/admin/all-managers';
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAllManagers(data.managers || []);
      }
    } catch (error) {
      console.error('담당자 목록 로드 실패:', error);
    }
  };

  const handleApproveManager = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/sender-registration/admin/managers/${id}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (res.ok) {
        setModal({ type: 'alert', title: '승인 완료', message: '담당자 위임장이 승인되었습니다.', variant: 'success' });
        loadAllManagers();
        loadSenderRegPendingCount();
      } else {
        setModal({ type: 'alert', title: '승인 실패', message: data.error || '승인 처리에 실패했습니다.', variant: 'error' });
      }
    } catch (error) {
      console.error('담당자 승인 실패:', error);
      setModal({ type: 'alert', title: '오류', message: '승인 처리 중 오류가 발생했습니다.', variant: 'error' });
    }
  };

  const handleRejectManager = async (id: string, reason: string) => {
    if (!reason.trim()) {
      setModal({ type: 'alert', title: '입력 필요', message: '반려 사유를 입력해주세요.', variant: 'warning' });
      return;
    }
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/sender-registration/admin/managers/${id}/reject`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectReason: reason.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        setModal({ type: 'alert', title: '반려 완료', message: '담당자 위임장이 반려되었습니다.', variant: 'success' });
        loadAllManagers();
        loadSenderRegPendingCount();
      } else {
        setModal({ type: 'alert', title: '반려 실패', message: data.error || '반려 처리에 실패했습니다.', variant: 'error' });
      }
    } catch (error) {
      console.error('담당자 반려 실패:', error);
      setModal({ type: 'alert', title: '오류', message: '반려 처리 중 오류가 발생했습니다.', variant: 'error' });
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
        const list = data.requests || [];
        setPlanRequests(list);
        // 이 목록도 상한 없이 전건이라 pending 수가 곧 뱃지다(승인·반려 직후 즉시 반영).
        setPlanReqPendingCount(list.filter((r: any) => r.status === 'pending').length);
      }
    } catch (error) {
      console.error('플랜 신청 로드 실패:', error);
    }
  };

  /**
   * ★ 2026-08-11 (서수란 접수) 요금/정산 대기 뱃지 카운트 — 60초 주기 경량 조회.
   *
   * 목록을 부르지 않는다. 충전 관리 목록 로더는 거래 이력 페이지까지 함께 끌어오므로
   * 뱃지 하나 때문에 그 쿼리를 주기로 돌리면 안 된다.
   * ⛔ **null인 축은 덮지 않는다** — 서버가 못 센 것이라, 0으로 쓰면 대기 중인 신청이 뱃지에서 사라진다.
   */
  const loadPendingBadges = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/pending-badges', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const d = await res.json();
      if (d.planRequests != null) setPlanReqPendingCount(Number(d.planRequests) || 0);
      if (d.deposits != null) setDepositPendingCount(Number(d.deposits) || 0);
      if (d.agentChargeOrders != null) setAgentOrderPendingCount(Number(d.agentChargeOrders) || 0);
      if (d.credits != null) setCreditPendingCount(Number(d.credits) || 0);
    } catch { /* 일시 오류 — 직전 값 유지, 다음 주기 재시도 */ }
  };

  const loadChargeManagement = async (page = 1) => {
    setChargeTxLoading(true);
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({ page: String(page), limit: String(chargeTxPerPage) });
      if (chargeTxCompanyFilter !== 'all') params.set('companyId', chargeTxCompanyFilter);
      if (chargeTxTypeFilter !== 'all') params.set('type', chargeTxTypeFilter);
      if (chargeTxMethodFilter !== 'all') params.set('paymentMethod', chargeTxMethodFilter);
      if (chargeTxStartDate) params.set('startDate', chargeTxStartDate);
      if (chargeTxEndDate) params.set('endDate', chargeTxEndDate);
      const res = await fetch(`/api/admin/charge-management?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setChargeTxList(data.transactions || []);
        setChargeTxTotal(data.total || 0);
        setChargeTxPage(page);
        const pending = data.pendingRequests || [];
        setPendingDeposits(pending);
        // 이 목록은 상한 없이 pending 전건이라 길이가 곧 카운트다 — 승인·반려 직후 뱃지가 60초를 안 기다린다.
        setDepositPendingCount(pending.length);
      }
    } catch (error) {
      console.error('충전 관리 로드 실패:', error);
    }
    setChargeTxLoading(false);
  };

  const handleApproveDeposit = async () => {
    if (!depositTarget) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/deposit-requests/${depositTarget.id}/approve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        // ★ 2026-08-19 전송자격인증 2.3 — 명의 확인 건은 확인 표시 없이 서버가 거절한다.
        //   모달에서 사유와 소명을 보고 누른 것이므로 여기서 true를 실어 보낸다.
        body: JSON.stringify({ adminNote: depositAdminNote || null, resolveHold: Boolean(depositTarget.held_reason) })
      });
      if (res.ok) {
        setModal({ type: 'alert', title: '승인 완료', message: `${Number(depositTarget.amount).toLocaleString()}원이 충전되었습니다.`, variant: 'success' });
        setShowDepositApproveModal(false);
        setDepositTarget(null);
        setDepositAdminNote('');
        loadChargeManagement(chargeTxPage);
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
        loadChargeManagement(chargeTxPage);
      } else {
        const err = await res.json();
        setModal({ type: 'alert', title: '거절 실패', message: err.error || '처리 중 오류 발생', variant: 'error' });
      }
    } catch (error) {
      setModal({ type: 'alert', title: '오류', message: '네트워크 오류', variant: 'error' });
    }
  };

  // ── AI 크레딧 충전 요청 (후불 — 슈퍼관리자 승인) ───────────────
  const loadAllCreditTx = async (page = 1, company = creditTxCompany) => {
    setCreditTxLoading(true);
    try {
      const token = localStorage.getItem('token');
      const qs = new URLSearchParams({ page: String(page) });
      if (company.trim()) qs.set('company', company.trim());
      const res = await fetch(`/api/admin/credit-transactions-all?${qs.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json();
      if (res.ok) { setCreditTxAll(d.transactions || []); setCreditTxPage(d.page || 1); setCreditTxTotalPages(d.totalPages || 1); }
    } catch (e) { console.error('크레딧 사용 이력 로드 실패:', e); }
    finally { setCreditTxLoading(false); }
  };

  const loadCreditRequests = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/credit-requests?status=pending', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) { const d = await res.json(); setCreditRequests(d.requests || []); }
    } catch (e) { console.error('크레딧 충전 요청 로드 실패:', e); }
  };

  const loadCreditRisk = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/credit-risk-companies', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) { const d = await res.json(); setCreditRiskCompanies(d.companies || []); }
    } catch (e) { console.error('크레딧 위험 회사 로드 실패:', e); }
  };

  // 예측 일괄 분석·차감 수동 실행 (9시 대기 없이 검증·복구·시연). 멱등키로 같은 날 중복 차감 0.
  const handleRunPredictiveNow = () => {
    showConfirm(
      '예측 일괄 실행',
      '요금제 가입 회사(고객 DB 보유) 전체에 지금 즉시 DB 규모별 예측 분석·크레딧 차감을 1회 실행합니다.\n오늘 이미 차감된 회사는 중복 차감되지 않습니다. 진행하시겠습니까?',
      async () => {
        setPredictiveRunning(true);
        try {
          const token = localStorage.getItem('token');
          const res = await fetch('/api/admin/predictive/run-now', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
          const d = await res.json();
          if (res.ok && d.success) {
            if (d.ran === false) {
              showAlert('진행 중', '예측 배치가 이미 실행 중입니다. 잠시 후 다시 시도해 주세요.', 'info');
            } else {
              showAlert('예측 실행 완료', `회사 ${d.companiesProcessed}개 분석 · 고객 ${Number(d.totalUpdated).toLocaleString()}명 갱신 (크레딧 부족 skip ${d.creditSkipped}).`, 'success');
              loadCreditRisk();
              loadAllCreditTx(1);
            }
          } else {
            showAlert('오류', d.error || '예측 수동 실행 실패', 'error');
          }
        } catch {
          showAlert('오류', '예측 수동 실행 실패', 'error');
        } finally {
          setPredictiveRunning(false);
        }
      }
    );
  };

  const handleApproveCreditRequest = (cr: any) => {
    setModal({
      type: 'confirm', title: 'AI 크레딧 충전 승인', variant: 'info',
      message: `${cr.company_name} · ${Number(cr.credits).toLocaleString()} 크레딧을 지급하고 ${Number(cr.total_amount).toLocaleString()}원을 월말 청구 대상으로 처리합니다. 승인할까요?`,
      onConfirm: async () => {
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/credit-requests/${cr.id}/approve`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } });
          const d = await res.json().catch(() => ({}));
          // 크레딧 목록은 페이지 단위(20)라 길이로 뱃지를 세면 안 된다 — 카운트를 따로 다시 부른다(즉시 반영).
          if (res.ok) { setModal({ type: 'alert', title: '승인 완료', message: d.message || '지급되었습니다.', variant: 'success' }); loadCreditRequests(); loadPendingBadges(); }
          else setModal({ type: 'alert', title: '승인 실패', message: d.error || '오류', variant: 'error' });
        } catch { setModal({ type: 'alert', title: '오류', message: '네트워크 오류', variant: 'error' }); }
      },
    });
  };

  const handleRejectCreditRequest = (cr: any) => {
    setModal({
      type: 'confirm', title: 'AI 크레딧 충전 거절', variant: 'warning',
      message: `${cr.company_name}의 ${Number(cr.credits).toLocaleString()} 크레딧 충전 요청을 거절할까요?`,
      onConfirm: async () => {
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/credit-requests/${cr.id}/reject`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ adminNote: '슈퍼관리자 거절' }),
          });
          const d = await res.json().catch(() => ({}));
          if (res.ok) { setModal({ type: 'alert', title: '거절 완료', message: d.message || '거절되었습니다.', variant: 'success' }); loadCreditRequests(); loadPendingBadges(); }
          else setModal({ type: 'alert', title: '거절 실패', message: d.error || '오류', variant: 'error' });
        } catch { setModal({ type: 'alert', title: '오류', message: '네트워크 오류', variant: 'error' }); }
      },
    });
  };

  const loadAllCampaigns = async (page = 1) => {
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({ page: String(page), limit: '10' });
      if (allCampaignsSearch) params.set('search', allCampaignsSearch);
      if (allCampaignsStatus) params.set('status', allCampaignsStatus);
      if (allCampaignsCompany) params.set('companyId', allCampaignsCompany);
      if (allCampaignsStartDate) params.set('startDate', allCampaignsStartDate);
      if (allCampaignsEndDate) params.set('endDate', allCampaignsEndDate);
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

  // SMS 상세 조회
  const loadSmsDetail = async (campaignId: string, page = 1) => {
    setSmsDetailLoading(true);
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (smsDetailStatus) params.set('status', smsDetailStatus);
      if (smsDetailSearchType && smsDetailSearchValue) {
        params.set('searchType', smsDetailSearchType);
        params.set('searchValue', smsDetailSearchValue);
      }
      const res = await fetch(`/api/admin/campaigns/${campaignId}/sms-detail?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSmsDetailCampaign(data.campaign);
        setSmsDetailRows(data.detail || []);
        setSmsDetailTotal(data.total || 0);
        setSmsDetailPage(page);
      }
    } catch (error) {
      console.error('SMS 상세 조회 실패:', error);
    } finally {
      setSmsDetailLoading(false);
    }
  };

  const openSmsDetail = (campaignId: string) => {
    setSmsDetailStatus('');
    setSmsDetailSearchType('dest_no');
    setSmsDetailSearchValue('');
    setSmsDetailPage(1);
    setSmsDetailModal(true);
    loadSmsDetail(campaignId, 1);
  };

// ★ B8: viewOverride 파라미터 추가 — setStatsView 후 stale 값 회피
//   기존: setStatsView(key); setTimeout(() => loadSendStats(1), 0);
//        → React state 업데이트가 batched라 setTimeout 안에서도 statsView 가 stale → 일/월 1회 어긋남
//   변경: setStatsView(key); loadSendStats(1, key);
//        → 명시적 view 인자 전달로 stale 회피
const loadSendStats = async (page = 1, viewOverride?: 'daily' | 'monthly') => {
  try {
    const view = viewOverride || statsView;
    const token = localStorage.getItem('token');
    const params = new URLSearchParams({
      view,
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
        usageType: 'web',
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
          storeCodes: editingUser.storeCodes ? editingUser.storeCodes.split(',').map((s: string) => s.trim()).filter(Boolean) : null,
          lineGroupId: editingUser.line_group_id || null,
          optOut080Number: editingUser.opt_out_080_number || null,
          optOutAutoSync: editingUser.opt_out_auto_sync || false
        })
      });

      if (!res.ok) throw new Error('수정 실패');

      // ★ 2026-08-18 로그인 인증번호는 별도 endpoint — 변경 시 신뢰 기기 해제 + 전용 이력이 남는다
      const mfaRes = await fetch(`/api/admin/users/${editingUser.id}/mfa-phone`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ mfaPhone: editingUser.mfa_phone || '' }),
      });
      if (!mfaRes.ok) {
        const mfaErr = await mfaRes.json().catch(() => ({} as any));
        setEditingUser(null);
        loadUsers();
        showAlert('일부 저장됨', mfaErr?.error || '로그인 인증번호는 저장하지 못했습니다.', 'error');
        return;
      }

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

  // ★ 2026-08-18 회선 정책 저장 — 회사 수정과 별도 endpoint(파라미터 40개 라우트에 끼우면 번호가 밀린다)
  const handleSaveLinePolicy = async () => {
    if (!editCompany.id || !linePolicy) return;
    setLinePolicySaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/companies/${editCompany.id}/sender-line-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          subscriberType: linePolicy.subscriberType || '',
          mobileLineLimit: linePolicy.mobileLineLimit,
          landlineLineLimit: linePolicy.landlineLineLimit,
        }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        showAlert('오류', data?.error || '회선 정책 저장에 실패했습니다.', 'error');
        return;
      }
      const refreshed = await fetch(`/api/admin/companies/${editCompany.id}/sender-line-policy`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (refreshed.ok) setLinePolicy(await refreshed.json());
      showAlert('성공', '발신번호 회선 정책이 저장되었습니다.', 'success');
    } catch {
      showAlert('오류', '회선 정책 저장에 실패했습니다.', 'error');
    } finally {
      setLinePolicySaving(false);
    }
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
          sessionTimeoutMinutes: c.session_timeout_minutes ?? 30,
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

  // ═══ ★ 2026-07-28 정산 탭 (필터항목 대체) — 발행 단위·정산 담당자·계산서 날짜 정책 ═══
  //   SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §2. 백엔드 = /api/admin/billing/company-billing-settings.
  const [btLoading, setBtLoading] = useState(false);
  const [btSaving, setBtSaving] = useState(false);
  const [btSettings, setBtSettings] = useState({ issue_scope: 'combined', taxbill_day_policy: 'last_day', manual_billing: false, require_taxbill_remark: false }); // ★ 2026-08-21 계산서 비고(PO) 필수 플래그
  // 회사 레벨 = billing_contacts(user_id NULL) 한 행 — 정산 담당자 + 계산서 사업자를 함께 갖는다.
  //   any로 두면 6개 키 이름 오타를 tsc가 못 잡는다(load·save·모달 3곳에 같은 키를 적는다).
  type BillingBizFields = {
    taxbill_biz_number: string; taxbill_company_name: string; taxbill_ceo_name: string;
    taxbill_address: string; taxbill_biz_type: string; taxbill_biz_item: string;
  };
  const [btCompanyContact, setBtCompanyContact] =
    useState<{ name: string; email: string } & Partial<BillingBizFields>>({ name: '', email: '' });
  const [btAccounts, setBtAccounts] = useState<any[]>([]);
  // ★ 2026-07-31 정산 메일 수신자(billing_recipients) — 유형별·복수. 담당자 행의 이메일 칸을 대체한다.
  //   이 목록은 저장 버튼과 무관하게 행 단위로 즉시 반영된다(추가·삭제·대표 지정이 각각 한 번의 호출).
  const [btRecipients, setBtRecipients] = useState<BillingRecipient[]>([]);
  // 사업자 모달 대상: 'company' = 회사 기본 사업자 / 그 외 문자열 = 계정 user_id / null = 닫힘.
  //   ⚠ 회사 레벨의 user_id는 NULL이라 null을 대상 식별자로 쓰면 "닫힘"과 구분되지 않는다 — sentinel을 둔다.
  const [btBizTarget, setBtBizTarget] = useState<string | null>(null);
  const [btBizDraft, setBtBizDraft] = useState<any>({});
  const [btBizExtracting, setBtBizExtracting] = useState(false);

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

  // ★ 2026-06-08: 30일 PRO 무료체험(grant-trial/revoke-trial) 제거 — BASIC 1개월 무료체험으로 통합(handleGrantBasicTrial/handleRevokeBasicTrial).

  // ★ 2026-06-08: BASIC 1개월 무료체험 부여 (PRO 체험 + AI op overlay 체험 대체)
  //   plan=BASIC + base 크레딧(750) 30일 → trial-downgrade-worker가 30일 후 FREE 자동 강등.
  const handleGrantBasicTrial = () => {
    if (!editCompany.id) return;
    // ★ 2026-07-28 같은 버튼이 신규 부여와 추가 부여(연장) 두 가지를 한다 — 문구로 구분한다.
    const isExtending = editCompany.subscriptionStatus === 'trial';
    showConfirm(
      isExtending ? '무료체험 1개월 추가 부여' : '무료체험 1개월 부여',
      isExtending
        ? `"${editCompany.companyName}" 의 무료체험을 1개월 더 연장할까요?\n\n· 남은 기간에 30일이 더해집니다\n· 크레딧은 다시 채우지 않습니다(중복 지급 방지)`
        : `"${editCompany.companyName}" 에 1개월 무료체험을 부여할까요?\n\n· 베이직과 같은 기능 + 크레딧 1개월 개방 (요금 0원)\n· 30일 후 자동으로 미가입(FREE)으로 강등`,
      async () => {
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/companies/${editCompany.id}/grant-basic-trial`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ days: 30 }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || 'BASIC 무료체험 부여 실패');
          if (data.company) {
            setEditCompany((prev) => ({
              ...prev,
              subscriptionStatus: data.company.subscription_status || 'trial',
              trialExpiresAt: data.company.trial_expires_at || '',
              planId: data.company.plan_id || prev.planId,
              planCode: data.company.plan_code || 'TRIAL',
            }));
          }
          showAlert('성공', data.message || 'BASIC 무료체험이 부여되었습니다.', 'success');
          loadData();
        } catch (err: any) {
          showAlert('실패', err?.message || 'BASIC 무료체험 부여 실패', 'error');
        }
      },
    );
  };

  // ★ 2026-06-08: BASIC 무료체험 즉시 취소 (FREE 강등)
  const handleRevokeBasicTrial = () => {
    if (!editCompany.id) return;
    showConfirm(
      'BASIC 무료체험 취소',
      `"${editCompany.companyName}" 의 무료체험을 즉시 취소하고 미가입(FREE)으로 강등할까요?`,
      async () => {
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/companies/${editCompany.id}/revoke-basic-trial`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || 'BASIC 무료체험 취소 실패');
          if (data.company) {
            setEditCompany((prev) => ({
              ...prev,
              subscriptionStatus: data.company.subscription_status || 'trial_expired',
              planId: data.company.plan_id || prev.planId,
              planCode: data.company.plan_code || 'FREE',
            }));
          }
          showAlert('완료', data.message || '무료체험이 취소되었습니다.', 'success');
          loadData();
        } catch (err: any) {
          showAlert('실패', err?.message || 'BASIC 무료체험 취소 실패', 'error');
        }
      },
    );
  };

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
          aiCreditsPerMonth: editingPlan.ai_credits_per_month,
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

  // 필터링된 회사 목록 — D144 P9: 회사명 오름차순 정렬로 안정화 (수정 후 페이지 흔들림 방지)
  const filteredCompanies = companies.filter((company) => {
    const matchesSearch = companySearch === '' ||
      company.company_code.toLowerCase().includes(companySearch.toLowerCase()) ||
      company.company_name.toLowerCase().includes(companySearch.toLowerCase()) ||
      (company.contact_name && company.contact_name.toLowerCase().includes(companySearch.toLowerCase()));

    const matchesStatus = companyStatusFilter === 'all' || company.status === companyStatusFilter;

    return matchesSearch && matchesStatus;
  }).sort((a, b) => (a.company_name || '').localeCompare(b.company_name || '', 'ko'));

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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 헤더 */}
      <header className="bg-white/90 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3.5 flex justify-between items-center">
        <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold tracking-tight text-gray-900 cursor-pointer hover:text-blue-600 transition-colors" onClick={() => window.location.reload()}>시스템 관리</h1>
            {/* ★ D152: ServiceSwitcher 제거 — hanjulDM 분리, admin.hanjuldm.kr 별도 도메인 */}
          </div>
          <div className="flex items-center gap-4">
            <SessionTimer />
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
          <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-5 hover:shadow-md transition-shadow">
            <div className="text-xs font-medium text-gray-500">전체 고객사</div>
            <div className="text-3xl font-bold tracking-tight text-gray-900 mt-1 tabular-nums">{companies.length}</div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-5 hover:shadow-md transition-shadow">
            <div className="text-xs font-medium text-gray-500">활성 고객사</div>
            <div className="text-3xl font-bold tracking-tight text-emerald-600 mt-1 tabular-nums">
              {companies.filter(c => c.status === 'active').length}
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-5 hover:shadow-md transition-shadow">
            <div className="text-xs font-medium text-gray-500">전체 사용자</div>
            <div className="text-3xl font-bold tracking-tight text-blue-600 mt-1 tabular-nums">{users.length}</div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-5 hover:shadow-md transition-shadow">
            <div className="text-xs font-medium text-gray-500">요금제</div>
            <div className="text-3xl font-bold tracking-tight text-violet-600 mt-1 tabular-nums">{plans.length}<span className="text-lg text-gray-400 font-semibold">개</span></div>
          </div>
        </div>

        {/* 드롭다운 그룹 메뉴 */}
        <div ref={menuRef} className="bg-white rounded-2xl border border-gray-200/70 shadow-sm mb-6">
          <div className="px-3 py-2 flex items-center gap-1 flex-wrap">
            {[
              {
                label: '고객 관리', color: 'blue',
                tabs: ['companies', 'users', 'marketingDiagnosis'] as const,
                items: [
                  { key: 'companies', label: '고객사 관리' },
                  { key: 'users', label: '사용자 관리' },
                  // ★ 2026-08-16: 신규마케팅진단 = 허용 계정(기본 ceo)에만 노출 · 뱃지 = 신규 리드 수
                  ...(diagnosisAllowed ? [{ key: 'marketingDiagnosis', label: '신규마케팅진단', badge: diagnosisBadge }] : []),
                ],
              },
              {
                label: '발송 관리', color: 'emerald',
                tabs: ['callbacks', 'stats', 'scheduled', 'allCampaigns', 'templates'] as const,
                items: [
                  // ★ 2026-08-08 상단 메뉴는 **두 축의 합** — "발신번호 관리에 볼 일 N건"이 여기선 맞는 말이다.
                  //   화면에 보이는 두 탭 뱃지의 합으로 만든다(서버 total을 따로 받으면 뱃지끼리 어긋날 수 있다).
                  { key: 'callbacks', label: '발신번호 관리', badge: senderRegPendingCount + pendingManagerCount },
                  { key: 'stats', label: '발송 통계', onClick: () => loadSendStats() },
                  { key: 'scheduled', label: '예약 관리' },
                  { key: 'allCampaigns', label: '캠페인 관리', onClick: () => loadAllCampaigns() },
                  // ★ 2026-07-09 CRM 캠페인 대행 설계 — 비즈니스+ 업체 접수 요청서 분석 → 제안서 PDF (별도 페이지)
                  { key: 'campaignAgency', label: '캠페인 대행 설계', onClick: () => navigate('/admin/campaign-agency') },
                  { key: 'templates', label: '템플릿 관리' },
                ],
              },
              {
                label: '요금/정산', color: 'amber',
                tabs: ['plans', 'requests', 'deposits', 'credits', 'billing'] as const,
                items: [
                  { key: 'plans', label: '요금제 관리' },
                  // ★ 2026-08-11 (서수란 접수) 뱃지 = 목록 길이가 아니라 **카운트 state**.
                  //   목록은 화면에 들어가야 채워지고 크레딧은 페이지 단위로 잘린다 —
                  //   둘 다 "대기가 있는데 뱃지가 0"을 만든다. 카운트는 60초 주기로 따로 돈다.
                  { key: 'requests', label: '플랜 신청', badge: planReqPendingCount },
                  // 충전 관리 = 웹 무통장입금 + 에이전트(발송ID) 충전 요청. 둘 다 "고객이 올린 신청"이라
                  // 한 탭에서 처리한다 — 한 축만 세면 다른 축의 대기가 뱃지에서 사라진다.
                  { key: 'deposits', label: '충전 관리', badge: depositPendingCount + agentOrderPendingCount },
                  { key: 'credits', label: '크레딧 관리', badge: creditPendingCount },
                  { key: 'billing', label: '정산 관리' },
                ],
              },
              {
                label: '시스템', color: 'gray',
                tabs: ['syncAgents', 'agentDeploy', 'lineGroups', 'auditLogs', 'loginBlocks'] as const,
                items: [
                  { key: 'syncAgents', label: 'Sync 모니터링' },
                  { key: 'agentDeploy', label: '싱크에이전트 배포' },
                  // ★ 2026-07-17: 발송 라인 설정 = 허용 계정(기본 ceo,admin)에만 노출
                  ...(lineGroupCanManage ? [{ key: 'lineGroups', label: '발송 라인 설정' }] : []),
                  // ★ 2026-06-11: 감사 로그 = 허용 계정(기본 ceo)에만 노출
                  ...(auditAccessAllowed ? [{ key: 'auditLogs', label: '감사 로그' }] : []),
                  // ★ 2026-08-18: 금칙어 차단(전송자격인증 5.2)
                  { key: 'spamBlock', label: '금칙어 차단' },
                  // ★ 2026-08-19: 국외 접근 통제(전송자격인증 2.2)
                  { key: 'geoAccess', label: '국외 접근 통제' },
                  // ★ 2026-07-04: 베스트 문안(업종 큐레이션) = 슈퍼관리자 공용(직원 큐레이션, ceo 게이트 없음)
                  { key: 'bestCopy', label: '베스트 문안', onClick: () => navigate('/admin/best-copy') },
                  // ★ 2026-06-13: AI 학습 데이터 = 허용 계정(기본 ceo)에만 노출 (별도 페이지 navigate)
                  ...(aiTrainingAllowed ? [{ key: 'aiTraining', label: 'AI 학습 데이터', onClick: () => navigate('/admin/ai-training') }] : []),
                  { key: 'loginBlocks', label: '로그인 차단 관리' },
                ],
              },
            ].map(group => {
              const isGroupActive = (group.tabs as readonly string[]).includes(activeTab);
              const isOpen = openMenu === group.label;
              const colorMap: Record<string, { active: string; hover: string; bg: string; border: string }> = {
                blue: { active: 'text-blue-600', hover: 'hover:text-blue-600', bg: 'bg-blue-50', border: 'border-blue-500' },
                emerald: { active: 'text-emerald-600', hover: 'hover:text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-500' },
                amber: { active: 'text-amber-600', hover: 'hover:text-amber-600', bg: 'bg-amber-50', border: 'border-amber-500' },
                gray: { active: 'text-gray-700', hover: 'hover:text-gray-600', bg: 'bg-gray-50', border: 'border-gray-500' },
              };
              const c = colorMap[group.color] || colorMap.blue;

              return (
                <div key={group.label} className="relative">
                  <button
                    onClick={() => setOpenMenu(isOpen ? null : group.label)}
                    className={`px-4 py-2.5 text-sm font-medium rounded-lg transition-all flex items-center gap-1.5 ${
                      isGroupActive ? `${c.active} ${c.bg}` : `text-gray-500 ${c.hover} hover:bg-gray-50`
                    }`}
                  >
                    {group.label}
                    {group.items.some((it: any) => it.badge > 0) && (
                      <span className="w-2 h-2 rounded-full bg-red-500"></span>
                    )}
                    <svg className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {isOpen && (
                    <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[180px] z-50"
                         style={{ animation: 'fadeIn 0.15s ease-out' }}>
                      {group.items.map((item: any) => (
                        <button key={item.key}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setActiveTab(item.key);
                            item.onClick?.();
                            setOpenMenu(null);
                          }}
                          className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                            activeTab === item.key ? `${c.active} ${c.bg} font-medium` : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {item.label}
                          {item.badge > 0 && (
                            <span className="ml-2 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                              {item.badge}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
        {/* 고객사 관리 탭 */}
        {activeTab === 'companies' && (
          <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
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
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">사용구분</th>
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
                      <td colSpan={9} className="px-6 py-12 text-center text-gray-500">
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
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          {/* ★ 2026-07-03 사용구분 배지 */}
                          {company.usage_type === 'agent' ? (
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">에이전트</span>
                          ) : company.usage_type === 'both' ? (
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700">웹+에이전트</span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-600">웹</span>
                          )}
                        </td>
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
            <TablePagination
              total={filteredCompanies.length}
              page={companyPage}
              perPage={companyPerPage}
              onChange={setCompanyPage}
            />
          </div>
        )}

        {/* 사용자 관리 탭 */}
        {activeTab === 'users' && (
          <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
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
                  onChange={(e) => { setUserSearch(e.target.value); setUserPage(1); }}
                  placeholder="🔍 아이디, 이름으로 검색..."
                  className="w-full max-w-xs px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">회사:</label>
                <select
                  value={userCompanyFilter}
                  onChange={(e) => { setUserCompanyFilter(e.target.value); setUserPage(1); }}
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

                // ★ 회사 그룹 20개씩 페이지네이션
                const totalUserPages = Math.max(1, Math.ceil(companyIds.length / USERS_COMPANIES_PER_PAGE));
                const safeUserPage = Math.min(Math.max(1, userPage), totalUserPages);
                const pagedCompanyIds = companyIds.slice(
                  (safeUserPage - 1) * USERS_COMPANIES_PER_PAGE,
                  safeUserPage * USERS_COMPANIES_PER_PAGE
                );

                return (
                  <>
                  <div className="divide-y">
                    {pagedCompanyIds.map(companyId => {
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
                  {/* ★ 회사 그룹 페이지네이션 */}
                  {totalUserPages > 1 && (
                    <div className="px-6 py-4 border-t flex items-center justify-between bg-gray-50">
                      <span className="text-sm text-gray-500">
                        총 {companyIds.length}개 회사 중 {(safeUserPage - 1) * USERS_COMPANIES_PER_PAGE + 1}-{Math.min(safeUserPage * USERS_COMPANIES_PER_PAGE, companyIds.length)}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setUserPage(p => Math.max(1, p - 1))}
                          disabled={safeUserPage === 1}
                          className="px-3 py-1.5 text-sm rounded-md border bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                        >◀ 이전</button>
                        {Array.from({ length: totalUserPages }, (_, i) => i + 1).map(p => (
                          <button
                            key={p}
                            onClick={() => setUserPage(p)}
                            className={`min-w-[36px] px-3 py-1.5 text-sm rounded-md transition-colors ${
                              p === safeUserPage ? 'bg-blue-600 text-white' : 'bg-white border hover:bg-gray-100'
                            }`}
                          >{p}</button>
                        ))}
                        <button
                          onClick={() => setUserPage(p => Math.min(totalUserPages, p + 1))}
                          disabled={safeUserPage === totalUserPages}
                          className="px-3 py-1.5 text-sm rounded-md border bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                        >다음 ▶</button>
                      </div>
                    </div>
                  )}
                  </>
                );
              })()}
            </div>
            </div>
        )}

        {/* 예약 관리 탭 */}
        {activeTab === 'scheduled' && (
          <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">예약 캠페인 관리</h2>
            </div>

            {/* 검색 필터 */}
            <div className="px-6 py-3 border-b bg-gray-50 flex flex-wrap gap-3 items-center">
              <select value={scheduledCompanyFilter} onChange={(e) => setScheduledCompanyFilter(e.target.value)}
                className="px-3 py-2 border rounded-lg text-sm bg-white">
                <option value="">전체 고객사</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
              <select value={scheduledStatusFilter} onChange={(e) => setScheduledStatusFilter(e.target.value)}
                className="px-3 py-2 border rounded-lg text-sm bg-white">
                <option value="">전체 상태</option>
                <option value="scheduled">예약</option>
                <option value="cancelled">취소</option>
              </select>
              <input type="date" value={scheduledStartDate} onChange={(e) => setScheduledStartDate(e.target.value)}
                className="px-3 py-2 border rounded-lg text-sm" />
              <span className="text-gray-400">~</span>
              <input type="date" value={scheduledEndDate} onChange={(e) => setScheduledEndDate(e.target.value)}
                className="px-3 py-2 border rounded-lg text-sm" />
              <input type="text" value={scheduledLoginId} onChange={(e) => setScheduledLoginId(e.target.value)}
                placeholder="계정(로그인ID)" className="w-36 px-3 py-2 border rounded-lg text-sm"
                onKeyDown={(e) => e.key === 'Enter' && loadScheduledCampaigns(1)} />
              <input type="text" value={scheduledSearch} onChange={(e) => setScheduledSearch(e.target.value)}
                placeholder="캠페인명/회사명 검색" className="w-48 px-3 py-2 border rounded-lg text-sm"
                onKeyDown={(e) => e.key === 'Enter' && loadScheduledCampaigns(1)} />
              <button onClick={() => loadScheduledCampaigns(1)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">조회</button>
              <span className="text-sm text-gray-500 ml-auto">총 {scheduledTotal}건</span>
            </div>

            <div className="overflow-x-auto">
              {/* ★ D145 P0 (2026-05-07): 컴팩트 — text-xs base + py-2 + 짧은 일시 포맷 + 캠페인명 240px */}
              <table className="w-full text-xs">
              <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap">고객사</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap">캠페인명</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-500 whitespace-nowrap">대상</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-500 whitespace-nowrap">생성자</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-500 whitespace-nowrap">등록</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-500 whitespace-nowrap">예약시간</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-500 whitespace-nowrap">상태</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-500 whitespace-nowrap">상세</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-500 whitespace-nowrap">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {scheduledCampaigns.length === 0 ? (
                    <tr><td colSpan={9} className="px-6 py-12 text-center text-gray-500">예약/취소 캠페인이 없습니다.</td></tr>
                  ) : scheduledCampaigns.map((campaign) => (
                      <tr key={campaign.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-900 whitespace-nowrap">
                          {campaign.company_name}
                          <span className="text-gray-400 ml-1">({campaign.company_code})</span>
                        </td>
                        <td className="px-3 py-2 text-gray-900" style={{ maxWidth: '240px' }}>
                          <div className="truncate" title={campaign.campaign_name}>{campaign.campaign_name}</div>
                        </td>
                        <td className="px-3 py-2 text-center text-gray-500 whitespace-nowrap">
                          {campaign.target_count?.toLocaleString() || 0}명
                        </td>
                        <td className="px-3 py-2 text-center text-gray-500 whitespace-nowrap">
                          {campaign.created_by_name || '-'}
                          {campaign.created_by_login && <span className="text-gray-400 ml-0.5">({campaign.created_by_login})</span>}
                        </td>
                        <td className="px-3 py-2 text-center text-gray-500 whitespace-nowrap">
                          {campaign.created_at ? formatDateTimeShort(campaign.created_at) : '-'}
                        </td>
                        <td className="px-3 py-2 text-center text-gray-500 whitespace-nowrap">
                          {campaign.scheduled_at ? formatDateTimeShort(campaign.scheduled_at) : '-'}
                        </td>
                        <td className="px-3 py-2 text-center whitespace-nowrap" style={{ minWidth: '70px' }}>
                          {campaign.status === 'scheduled' ? (
                            <span className="px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-800">예약</span>
                          ) : (
                            <div>
                              <span className="px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-800">취소</span>
                              {campaign.cancelled_by_type === 'super_admin' && (
                                <span className="ml-1 text-red-500">(관리자)</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center whitespace-nowrap" style={{ minWidth: '60px' }}>
                          <button onClick={() => openSmsDetail(campaign.id)}
                            className="text-blue-600 hover:text-blue-800 font-medium">[조회]</button>
                        </td>
                        <td className="px-3 py-2 text-center whitespace-nowrap" style={{ minWidth: '60px' }}>
                          {campaign.status === 'scheduled' ? (
                            <button onClick={() => openCancelModal(campaign.id, campaign.campaign_name)}
                              className="text-red-600 hover:text-red-800">취소</button>
                          ) : (
                            <span className="text-gray-400" title={campaign.cancel_reason || ''}>
                              {campaign.cancel_reason ? `사유: ${campaign.cancel_reason.substring(0, 15)}${campaign.cancel_reason.length > 15 ? '…' : ''}` : '-'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>

            {/* 서버사이드 페이징 */}
            {scheduledTotal > scheduledPerPage && (
              <div className="px-6 py-4 border-t flex items-center justify-between">
                <span className="text-sm text-gray-500">총 {scheduledTotal}건</span>
                <div className="flex gap-1">
                  <button onClick={() => loadScheduledCampaigns(Math.max(1, scheduledPage - 1))} disabled={scheduledPage === 1}
                    className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50">◀</button>
                  <span className="px-3 py-1 text-sm text-gray-600">{scheduledPage} / {Math.ceil(scheduledTotal / scheduledPerPage)}</span>
                  <button onClick={() => loadScheduledCampaigns(Math.min(Math.ceil(scheduledTotal / scheduledPerPage), scheduledPage + 1))}
                    disabled={scheduledPage >= Math.ceil(scheduledTotal / scheduledPerPage)}
                    className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50">▶</button>
                </div>
              </div>
            )}
            </div>
        )}

        {/* 발신번호 관리 탭 */}
        {activeTab === 'callbacks' && (
          <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
            {/* 서브탭 */}
            <div className="border-b flex">
              <button
                onClick={() => setCallbackSubTab('manage')}
                className={`px-6 py-3 text-sm font-medium border-b-2 ${
                  callbackSubTab === 'manage'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                발신번호 관리
              </button>
              <button
                onClick={() => setCallbackSubTab('registrations')}
                className={`px-6 py-3 text-sm font-medium border-b-2 ${
                  callbackSubTab === 'registrations'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                등록 신청 관리
                {senderRegPendingCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
                    {senderRegPendingCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => setCallbackSubTab('managers')}
                className={`px-6 py-3 text-sm font-medium border-b-2 ${
                  callbackSubTab === 'managers'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                등록현황 관리
                {/* ★ 2026-08-08 (임은지 접수 3) 위임장 대기는 **이 탭**의 일이다 — 그전에는 옆 탭(등록 신청 관리)
                    뱃지로 떠서, 알림을 보고 간 담당자가 빈 목록을 보고 되돌아왔다. */}
                {pendingManagerCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
                    {pendingManagerCount}
                  </span>
                )}
              </button>
            </div>

            {/* 서브탭: 발신번호 관리 */}
            {callbackSubTab === 'manage' && (
              <>
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
                onChange={(e) => { setCallbackSearch(e.target.value); setCallbackCompanyListPage(1); }}
                placeholder="고객사명, 번호로 검색..."
                className="w-full max-w-xs px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
              {/* 검색과 무관한 전체 등록 수 — 검색 결과 건수는 아래 페이저가 '총 N개 회사 중' 으로 따로 보여준다 */}
              <span className="text-sm text-gray-500">전체 등록 {callbackNumbers.length}개</span>
            </div>

            <div>
              {(() => {
                // D144 P12: 번호 검색 추가 — 회사명 OR 번호(대시 제거 숫자 비교)
                const filtered = callbackNumbers.filter(cb => {
                  if (!callbackSearch) return true;
                  const searchLower = callbackSearch.toLowerCase();
                  if ((cb.company_name || '').toLowerCase().includes(searchLower)) return true;
                  const searchDigits = callbackSearch.replace(/[^0-9]/g, '');
                  if (searchDigits.length >= 2) {
                    const phoneDigits = String(cb.phone || '').replace(/[^0-9]/g, '');
                    if (phoneDigits.includes(searchDigits)) return true;
                  }
                  return false;
                });

                const grouped = filtered.reduce((acc: Record<string, { companyName: string; companyCode: string; items: any[] }>, cb: any) => {
                  const cid = cb.company_id || 'none';
                  if (!acc[cid]) {
                    acc[cid] = { companyName: cb.company_name || '미지정', companyCode: cb.company_code || '', items: [] };
                  }
                  acc[cid].items.push(cb);
                  return acc;
                }, {});

                const companyIds = Object.keys(grouped);
                // ★ 2026-07-25 (서수란) 회사 목록 페이징.
                //   '미지정'(회사 연결이 없는 발신번호)은 항상 첫 페이지에 둔다 — 페이징 때문에 뒤 페이지로 밀려
                //   슈퍼관리자 눈에서 사라지면 안 된다. 발신번호는 발송 가능 번호 원장이라 안 보이는 것 자체가 위험.
                const orderedCompanyIds = [...companyIds].sort((a, b) => {
                  if (a === 'none') return -1;
                  if (b === 'none') return 1;
                  return (grouped[a].companyName || '').localeCompare(grouped[b].companyName || '');
                });
                const companyTotalPages = Math.max(1, Math.ceil(orderedCompanyIds.length / CALLBACK_COMPANIES_PER_PAGE));
                // 삭제·승인 후 재조회로 회사 수가 줄면 현재 페이지가 범위를 넘어 빈 화면이 되므로 표시용으로 clamp
                const safeCompanyPage = Math.min(callbackCompanyListPage, companyTotalPages);
                const pagedCompanyIds = orderedCompanyIds.slice(
                  (safeCompanyPage - 1) * CALLBACK_COMPANIES_PER_PAGE,
                  safeCompanyPage * CALLBACK_COMPANIES_PER_PAGE,
                );

                if (filtered.length === 0) {
                  return (
                    <div className="px-6 py-12 text-center text-gray-500">
                      {callbackNumbers.length === 0 ? '등록된 발신번호가 없습니다.' : '검색 결과가 없습니다.'}
                    </div>
                  );
                }

                return (
                  <>
                  <div className="divide-y">
                    {pagedCompanyIds.map(cid => {
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
                          {isExpanded && (() => {
                            // ★ D135+ (B10): 회사당 10개씩 페이징. 금강제화 등 160개 업체 무한 스크롤 방지.
                            const currentPage = callbackCompanyPages[cid] || 1;
                            const totalItems = group.items.length;
                            const totalPages = Math.max(1, Math.ceil(totalItems / CALLBACKS_PER_COMPANY_PAGE));
                            const safePage = Math.min(currentPage, totalPages);
                            const startIdx = (safePage - 1) * CALLBACKS_PER_COMPANY_PAGE;
                            const endIdx = Math.min(startIdx + CALLBACKS_PER_COMPANY_PAGE, totalItems);
                            const paged = group.items.slice(startIdx, endIdx);
                            const setCompanyPage = (p: number) =>
                              setCallbackCompanyPages(prev => ({ ...prev, [cid]: Math.max(1, Math.min(totalPages, p)) }));
                            // 페이지 번호 목록 (7개 이상이면 축약: 1 ... n-1 n n+1 ... N)
                            const pageNums: (number | string)[] = [];
                            if (totalPages <= 7) {
                              for (let i = 1; i <= totalPages; i++) pageNums.push(i);
                            } else {
                              pageNums.push(1);
                              if (safePage > 3) pageNums.push('...');
                              for (let i = Math.max(2, safePage - 1); i <= Math.min(totalPages - 1, safePage + 1); i++) pageNums.push(i);
                              if (safePage < totalPages - 2) pageNums.push('...');
                              pageNums.push(totalPages);
                            }
                            return (
                              <>
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
                                    {paged.map((cb: any) => (
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
                                {totalPages > 1 && (
                                  <div className="px-4 py-2.5 border-t bg-gray-50/30 flex items-center justify-between">
                                    <span className="text-xs text-gray-500">
                                      {startIdx + 1}~{endIdx} / {totalItems}개
                                    </span>
                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={() => setCompanyPage(safePage - 1)}
                                        disabled={safePage === 1}
                                        className="px-2.5 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                                      >
                                        이전
                                      </button>
                                      {pageNums.map((p, i) =>
                                        p === '...' ? (
                                          <span key={`d-${cid}-${i}`} className="px-1.5 text-gray-400">…</span>
                                        ) : (
                                          <button
                                            key={`p-${cid}-${p}`}
                                            onClick={() => setCompanyPage(p as number)}
                                            className={`px-2.5 py-1 text-xs rounded transition ${
                                              p === safePage
                                                ? 'bg-blue-600 text-white'
                                                : 'bg-white border text-gray-600 hover:bg-gray-50'
                                            }`}
                                          >
                                            {p}
                                          </button>
                                        )
                                      )}
                                      <button
                                        onClick={() => setCompanyPage(safePage + 1)}
                                        disabled={safePage === totalPages}
                                        className="px-2.5 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                                      >
                                        다음
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                  {/* ★ 2026-07-25 회사 단위 페이저 — 회사 20개 이하면 컴포넌트가 스스로 렌더하지 않는다 */}
                  <TablePagination
                    total={orderedCompanyIds.length}
                    page={safeCompanyPage}
                    perPage={CALLBACK_COMPANIES_PER_PAGE}
                    onChange={setCallbackCompanyListPage}
                    unit="개 회사"
                  />
                  </>
                );
              })()}
            </div>
              </>
            )}

            {/* 서브탭: 등록 신청 관리 */}
            {callbackSubTab === 'registrations' && (
              <>
                <div className="px-6 py-4 border-b flex justify-between items-center">
                  <h2 className="text-lg font-semibold">발신번호 등록 신청 관리</h2>
                  <div className="flex gap-2">
                    {(['pending', 'approved', 'rejected', 'all'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setSenderRegFilter(f)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          senderRegFilter === f
                            ? f === 'pending' ? 'bg-yellow-100 text-yellow-800'
                            : f === 'approved' ? 'bg-green-100 text-green-800'
                            : f === 'rejected' ? 'bg-red-100 text-red-800'
                            : 'bg-blue-100 text-blue-800'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {f === 'pending' ? '승인대기' : f === 'approved' ? '승인완료' : f === 'rejected' ? '반려' : '전체'}
                        {f === 'pending' && senderRegPendingCount > 0 && (
                          <span className="ml-1 text-xs font-bold">({senderRegPendingCount})</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* === 발신번호 등록 신청 목록 === */}
                {senderRegLoading ? (
                  <div className="px-6 py-12 text-center text-gray-500">로딩 중...</div>
                ) : senderRegistrations.length === 0 ? (
                  <div className="px-6 py-12 text-center text-gray-500">
                    {senderRegFilter === 'pending' ? '승인 대기 중인 신청이 없습니다.' : '해당 조건의 신청 내역이 없습니다.'}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">고객사</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">발신번호</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">별칭</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">매장</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">첨부</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">상태</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">신청일</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">관리</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {senderRegistrations.map((reg: any) => (
                          <tr key={reg.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-gray-900 font-medium">{reg.company_name || '-'}</td>
                            <td className="px-4 py-3 text-gray-900 font-mono">{reg.phone}</td>
                            <td className="px-4 py-3 text-gray-600">{reg.label || '-'}</td>
                            <td className="px-4 py-3 text-gray-600">{reg.store_name || '-'}</td>
                            <td className="px-4 py-3 text-center">
                              <span className="text-blue-600">{(reg.documents || []).length}건</span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                reg.status === 'pending' ? 'bg-yellow-100 text-yellow-800'
                                : reg.status === 'approved' ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                              }`}>
                                {reg.status === 'pending' ? '대기' : reg.status === 'approved' ? '승인' : '반려'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center text-gray-500">{formatDate(reg.created_at)}</td>
                            <td className="px-4 py-3 text-center">
                              <button
                                onClick={() => loadSenderRegDetail(reg.id)}
                                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                              >
                                상세
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* 서브탭: 등록현황 관리 (담당자 위임장) */}
            {callbackSubTab === 'managers' && (
              <>
                <div className="px-6 py-4 border-b">
                  <div className="flex justify-between items-center mb-3">
                    <h2 className="text-lg font-semibold">등록현황 관리</h2>
                    <div className="flex gap-2">
                      {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
                        <button
                          key={f}
                          onClick={() => setMgrFilter(f)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            mgrFilter === f
                              ? f === 'pending' ? 'bg-yellow-100 text-yellow-800'
                              : f === 'approved' ? 'bg-green-100 text-green-800'
                              : f === 'rejected' ? 'bg-red-100 text-red-800'
                              : 'bg-blue-100 text-blue-800'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {f === 'all' ? '전체' : f === 'pending' ? '승인대기' : f === 'approved' ? '승인완료' : '반려'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={mgrSearch}
                    onChange={(e) => setMgrSearch(e.target.value)}
                    placeholder="업체명 또는 담당자 이름으로 검색..."
                    className="w-full max-w-sm px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                {(() => {
                  const filteredMgrs = allManagers.filter(mgr => {
                    if (!mgrSearch.trim()) return true;
                    const q = mgrSearch.trim().toLowerCase();
                    return (mgr.company_name || '').toLowerCase().includes(q)
                      || (mgr.manager_name || '').toLowerCase().includes(q)
                      || (mgr.manager_phone || '').includes(q);
                  });
                  return filteredMgrs.length === 0 ? (
                    <div className="px-6 py-12 text-center text-gray-500">
                      {mgrSearch.trim() ? '검색 결과가 없습니다.' : '등록된 담당자가 없습니다.'}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">고객사</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">담당자</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">연락처</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">이메일</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">위임장</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">상태</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">반려사유</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">관리</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {filteredMgrs.map((mgr: any) => (
                            <tr key={mgr.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3 text-gray-900 font-medium">{mgr.company_name || '-'}</td>
                              <td className="px-4 py-3 text-gray-900">{mgr.manager_name}</td>
                              <td className="px-4 py-3 text-gray-600 font-mono text-xs">{mgr.manager_phone}</td>
                              <td className="px-4 py-3 text-gray-500 text-xs">{mgr.manager_email || '-'}</td>
                              <td className="px-4 py-3 text-center">
                                {mgr.authorization_doc ? (
                                  <button onClick={() => downloadSenderDoc(mgr.authorization_doc.storedName, mgr.authorization_doc.originalName)}
                                    className="text-blue-600 hover:text-blue-800 text-xs underline">다운로드</button>
                                ) : (
                                  <span className="text-gray-300 text-xs">없음</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  mgr.status === 'pending' ? 'bg-yellow-100 text-yellow-800'
                                  : mgr.status === 'approved' ? 'bg-green-100 text-green-800'
                                  : 'bg-red-100 text-red-800'
                                }`}>
                                  {mgr.status === 'pending' ? '대기' : mgr.status === 'approved' ? '승인' : '반려'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-gray-500 text-xs">{mgr.reject_reason || '-'}</td>
                              <td className="px-4 py-3 text-center">
                                {mgr.status === 'pending' && mgrRejectId !== mgr.id && (
                                  <div className="flex gap-1 justify-center">
                                    <button onClick={() => handleApproveManager(mgr.id)}
                                      className="px-2.5 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700">승인</button>
                                    <button onClick={() => { setMgrRejectId(mgr.id); setMgrRejectReason(''); }}
                                      className="px-2.5 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700">반려</button>
                                  </div>
                                )}
                                {mgr.status === 'pending' && mgrRejectId === mgr.id && (
                                  <div className="flex items-center gap-1">
                                    <input type="text" value={mgrRejectReason} onChange={(e) => setMgrRejectReason(e.target.value)}
                                      placeholder="반려 사유" className="px-2 py-1 border rounded text-xs w-32" />
                                    <button onClick={() => { handleRejectManager(mgr.id, mgrRejectReason); setMgrRejectId(null); }}
                                      disabled={!mgrRejectReason.trim()}
                                      className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700 disabled:opacity-40">확인</button>
                                    <button onClick={() => setMgrRejectId(null)}
                                      className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300">취소</button>
                                  </div>
                                )}
                                {mgr.status !== 'pending' && <span className="text-xs text-gray-300">-</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </>
            )}
            </div>
        )}

        {/* ★ 2026-08-19 국외 접근 통제 (전송자격인증 2.2) */}
        {activeTab === 'geoAccess' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="text-xs text-gray-500">등록된 국내 대역</div>
                <div className="mt-1.5 text-2xl font-bold text-gray-900 tabular-nums">
                  {Number(geoStatus?.cidrCount || 0).toLocaleString()}<span className="ml-1 text-sm font-semibold text-gray-400">개</span>
                </div>
                <div className="mt-1 text-[11px] text-gray-400">
                  {geoStatus?.cidrUpdatedAt ? `갱신 ${formatDateTime(geoStatus.cidrUpdatedAt)}` : '아직 등록되지 않았습니다'}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="text-xs text-gray-500">활성 예외 승인</div>
                <div className="mt-1.5 text-2xl font-bold text-gray-900 tabular-nums">
                  {Number(geoStatus?.exceptionCount || 0).toLocaleString()}<span className="ml-1 text-sm font-semibold text-gray-400">건</span>
                </div>
                <div className="mt-1 text-[11px] text-gray-400">해외 근무자 · 해외 본사 서버</div>
              </div>
              <div className={`rounded-xl border p-5 ${geoStatus?.enforced ? 'bg-rose-50 border-rose-200' : 'bg-white border-gray-200'}`}>
                <div className="text-xs text-gray-500">차단 시행</div>
                <div className={`mt-1.5 text-2xl font-bold ${geoStatus?.enforced ? 'text-rose-700' : 'text-gray-400'}`}>
                  {geoStatus?.enforced ? '시행 중' : '미시행'}
                </div>
                <div className="mt-1 text-[11px] text-gray-500 leading-relaxed">
                  {geoStatus?.enforced
                    ? `${geoStatus.enforceFrom} 부터 국외 로그인이 차단됩니다`
                    : '지금은 국외 접속을 기록만 합니다. 시행은 서버 환경변수 GEO_BLOCK_ENFORCE_FROM 으로만 열립니다'}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-base font-semibold text-gray-900">국내 대역 등록</h3>
              <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                등록된 대역에 <span className="font-medium">들지 않는 IP</span>를 국외로 봅니다. 대역이 하나도 없으면 판정 자체를 하지 않습니다(전원 통과).
                줄바꿈·쉼표·공백 어느 것으로 구분해도 됩니다. <span className="font-medium">등록할 때마다 전체가 교체</span>됩니다.
              </p>
              <textarea
                value={geoCidrInput}
                onChange={(e) => setGeoCidrInput(e.target.value)}
                rows={5}
                placeholder={'211.234.0.0/16\n1.201.0.0/16\n14.32.0.0/15'}
                className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-600/10"
              />
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[11px] text-gray-400">APNIC delegated 목록의 KR 행에서 뽑습니다.</span>
                <button
                  onClick={handleGeoCidrBulk}
                  disabled={geoBusy || !geoCidrInput.trim()}
                  className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40"
                >
                  {geoBusy ? '등록 중...' : '전체 교체 등록'}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-base font-semibold text-gray-900">예외 승인</h3>
              <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                해외에서 들어와야 하는 대상을 등록합니다. <span className="font-medium">사유 없이는 등록되지 않습니다</span>. 이 기록이 심사에 내는 예외 승인 대장입니다.
                <br />
                SDK·싱크에이전트는 국가로 막지 않습니다. 해외 본사를 둔 고객사는 <span className="font-medium">회사 API · 회사 에이전트</span> 범위로 그 대역을 등록해주세요.
              </p>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
                <select
                  value={geoForm.scope}
                  onChange={(e) => setGeoForm({ ...geoForm, scope: e.target.value })}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-indigo-500"
                >
                  <option value="user">계정 (해외 근무 담당자)</option>
                  <option value="company_api">회사 API (SDK·자사몰)</option>
                  <option value="company_agent">회사 에이전트 (사내 서버)</option>
                  <option value="global">전역</option>
                </select>
                <input
                  value={geoForm.target}
                  onChange={(e) => setGeoForm({ ...geoForm, target: e.target.value })}
                  placeholder={geoForm.scope === 'user' ? '대상 계정 UUID' : geoForm.scope === 'global' ? '전역 (비워둠)' : '대상 고객사 UUID'}
                  disabled={geoForm.scope === 'global'}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-indigo-500 disabled:bg-gray-50"
                />
                <input
                  value={geoForm.cidr}
                  onChange={(e) => setGeoForm({ ...geoForm, cidr: e.target.value })}
                  placeholder="203.0.113.0/24 (단일 IP는 /32)"
                  className="px-3 py-2 border border-gray-200 rounded-lg font-mono text-xs outline-none focus:border-indigo-500"
                />
                <input
                  value={geoForm.reason}
                  onChange={(e) => setGeoForm({ ...geoForm, reason: e.target.value })}
                  placeholder="승인 사유 (필수)"
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-indigo-500"
                />
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  onClick={handleGeoExceptionCreate}
                  disabled={geoBusy || !geoForm.cidr.trim() || !geoForm.reason.trim()}
                  className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40"
                >
                  예외 승인
                </button>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left">범위</th>
                      <th className="px-3 py-2 text-left">대상</th>
                      <th className="px-3 py-2 text-left">대역</th>
                      <th className="px-3 py-2 text-left">사유</th>
                      <th className="px-3 py-2 text-left">승인</th>
                      <th className="px-3 py-2 text-right">회수</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {geoExceptions.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400 text-xs">등록된 예외가 없습니다.</td></tr>
                    )}
                    {geoExceptions.map((x) => (
                      <tr key={x.id} className={x.is_active ? '' : 'opacity-45'}>
                        <td className="px-3 py-2 text-xs text-gray-700">
                          {x.scope === 'user' ? '계정' : x.scope === 'company_api' ? '회사 API' : x.scope === 'company_agent' ? '회사 에이전트' : '전역'}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-900">{x.login_id || x.company_name || '-'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-700">{x.cidr}</td>
                        <td className="px-3 py-2 text-xs text-gray-600 max-w-xs truncate">{x.reason}</td>
                        <td className="px-3 py-2 text-[11px] text-gray-400">{formatDateTime(x.approved_at)}</td>
                        <td className="px-3 py-2 text-right">
                          {x.is_active ? (
                            <button
                              onClick={() => handleGeoExceptionRevoke(x.id)}
                              className="px-2.5 py-1 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50"
                            >
                              회수
                            </button>
                          ) : (
                            <span className="text-[11px] text-gray-400">회수됨</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="text-base font-semibold text-gray-900">국외 접근 이력</h3>
                <p className="text-[10px] text-gray-500 mt-0.5 italic">Data source: 감사 로그 (foreign_access_detected · foreign_access_blocked)</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="px-4 py-2 text-left">시각</th>
                      <th className="px-4 py-2 text-left">계정</th>
                      <th className="px-4 py-2 text-left">고객사</th>
                      <th className="px-4 py-2 text-left">IP</th>
                      <th className="px-4 py-2 text-left">처리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {geoHits.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-xs">국외 접근 기록이 없습니다.</td></tr>
                    )}
                    {geoHits.map((h) => (
                      <tr key={h.id}>
                        <td className="px-4 py-2 text-xs text-gray-500">{formatDateTime(h.created_at)}</td>
                        <td className="px-4 py-2 text-xs text-gray-900">{h.login_id || '-'}</td>
                        <td className="px-4 py-2 text-xs text-gray-700">{h.company_name || '-'}</td>
                        <td className="px-4 py-2 font-mono text-xs text-gray-700">{h.ip_address || '-'}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 text-[11px] rounded ${h.action === 'foreign_access_blocked' ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-600'}`}>
                            {h.action === 'foreign_access_blocked' ? '차단' : '기록만'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 요금제 관리 탭 */}
        {activeTab === 'spamBlock' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-base font-semibold text-gray-900">차단정보 등록</h3>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                요소 <span className="font-medium">2~5개의 조합</span>으로 만듭니다. 요소가 <span className="font-medium">전부 맞을 때만</span> 걸립니다.
                단일 키워드는 정상 문자를 막기 때문에 등록되지 않습니다.
              </p>
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                이 체계는 <span className="font-medium text-gray-700">탐지만 합니다. 발송을 막지 않습니다.</span>
                걸린 문안은 아래 탐지 이력에 기록되고 문자는 그대로 나갑니다.
              </p>

              <div className="mt-4 space-y-3">
                <input type="text" value={spamRuleName} onChange={(e) => setSpamRuleName(e.target.value)}
                  placeholder="규칙 이름 (예: 무직자 당일대출 스팸)"
                  className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />

                {spamElements.map((el, i) => (
                  <div key={i} className="flex gap-2">
                    <select value={el.type}
                      onChange={(e) => setSpamElements(spamElements.map((x, xi) => xi === i ? { ...x, type: e.target.value } : x))}
                      className="w-32 px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                      <option value="keyword">키워드</option>
                      <option value="url">URL</option>
                      <option value="phone">전화번호</option>
                    </select>
                    <input type="text" value={el.value}
                      onChange={(e) => setSpamElements(spamElements.map((x, xi) => xi === i ? { ...x, value: e.target.value } : x))}
                      placeholder={el.type === 'url' ? 'bit.ly' : el.type === 'phone' ? '010-0000-0000' : '무직자'}
                      className="flex-1 px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                    {spamElements.length > 2 && (
                      <button type="button" onClick={() => setSpamElements(spamElements.filter((_, xi) => xi !== i))}
                        className="px-3 py-2 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">삭제</button>
                    )}
                  </div>
                ))}

                <div className="flex flex-wrap gap-2">
                  {spamElements.length < 5 && (
                    <button type="button" onClick={() => setSpamElements([...spamElements, { type: 'keyword', value: '' }])}
                      className="px-3 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">요소 추가</button>
                  )}
                  <button type="button" onClick={handleSpamSimulate} disabled={spamBusy || spamElementsPayload().length < 2}
                    className="px-4 py-2 text-xs font-medium border border-blue-200 text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 disabled:opacity-50">
                    {spamBusy ? '확인 중…' : '최근 발송 문안으로 오탐 확인'}
                  </button>
                  <button type="button" onClick={handleSpamCreate} disabled={spamBusy || spamElementsPayload().length < 2}
                    className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg">
                    탐지 전용으로 등록
                  </button>
                </div>

                {spamSim && (
                  <div className={`rounded-lg border px-4 py-3 text-xs ${spamSim.matchedCount > 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                    <p className="font-medium">
                      최근 {spamSim.scannedDays}일 발송 문안 {spamSim.scanned}건 중 <span className="font-bold">{spamSim.matchedCount}건</span> 일치
                    </p>
                    {spamSim.matchedCount > 0 && (
                      <>
                        <p className="mt-1 text-[11px]">아래 문안이 정상이라면 조합을 더 좁혀주세요.</p>
                        <ul className="mt-2 space-y-1">
                          {spamSim.samples?.map((sm: any, i: number) => (
                            <li key={i} className="bg-white/70 rounded px-2 py-1 text-[11px] text-gray-700 truncate">{sm.sample}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="text-base font-semibold text-gray-900">차단정보 목록</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="px-4 py-2 text-left">이름</th>
                      <th className="px-4 py-2 text-left">조합</th>
                      <th className="px-4 py-2 text-left">출처</th>
                      <th className="px-4 py-2 text-right">탐지</th>
                      <th className="px-4 py-2 text-left">처리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {spamRules.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-xs">등록된 차단정보가 없습니다. 규칙이 없으면 발송은 그대로 나갑니다.</td></tr>
                    )}
                    {spamRules.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-2 font-medium text-gray-900">{r.name}</td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            {(r.elements || []).map((el: any, i: number) => (
                              <span key={i} className="px-2 py-0.5 text-[11px] bg-gray-100 text-gray-700 rounded">
                                {el.type === 'url' ? 'URL' : el.type === 'phone' ? '번호' : '키워드'} · {el.value}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500">{r.source}</td>
                        <td className="px-4 py-2 text-right text-xs text-gray-700">{r.hit_count}</td>
                        <td className="px-4 py-2">
                          <span className="px-2 py-0.5 text-[11px] rounded bg-gray-100 text-gray-600">탐지만 (발송됨)</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="text-base font-semibold text-gray-900">탐지 이력</h3>
                <p className="text-[10px] text-gray-500 mt-0.5 italic">Data source: 금칙어 탐지 로그</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="px-4 py-2 text-left">시각</th>
                      <th className="px-4 py-2 text-left">규칙</th>
                      <th className="px-4 py-2 text-left">고객사</th>
                      <th className="px-4 py-2 text-left">경로</th>
                      <th className="px-4 py-2 text-left">처리</th>
                      <th className="px-4 py-2 text-right">건수</th>
                      <th className="px-4 py-2 text-left">문안</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {spamHits.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-xs">탐지 이력이 없습니다.</td></tr>
                    )}
                    {spamHits.map((h) => (
                      <tr key={h.id}>
                        <td className="px-4 py-2 text-xs text-gray-500">{new Date(h.created_at).toLocaleString('ko-KR')}</td>
                        <td className="px-4 py-2 text-xs text-gray-900">{h.rule_name || '-'}</td>
                        <td className="px-4 py-2 text-xs text-gray-700">{h.company_name || '-'}</td>
                        <td className="px-4 py-2 text-xs text-gray-500">{h.send_source || '-'}</td>
                        <td className="px-4 py-2">
                          <span className="px-2 py-0.5 text-[11px] rounded bg-gray-100 text-gray-600">탐지만</span>
                        </td>
                        <td className="px-4 py-2 text-right text-xs text-gray-700">{h.affected_rows}</td>
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-xs truncate">{h.content_sample}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'plans' && (
          <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
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
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">월 요금</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">사용 회사</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">상태</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {planList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
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
          <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
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
                          {typeof req.message === 'string' && req.message.startsWith('[무료체험]') && (
                            <span className="ml-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-fuchsia-100 text-fuchsia-700 align-middle">무료체험</span>
                          )}
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

        {/* 크레딧 관리 탭 — AI 크레딧 충전 요청(후불 승인) + 전체 회사 사용 이력 */}
        {activeTab === 'credits' && (
          <div className="space-y-4">
            {/* 크레딧 요약 타일 3칸 — 클릭 시 모달 상세 (가로 여백 축소) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                onClick={() => setCreditPanel('requests')}
                className="text-left bg-white rounded-2xl border border-gray-200/70 shadow-sm p-5 hover:shadow-md hover:border-violet-200 transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">크레딧 충전 요청</span>
                  {creditRequests.length > 0 && <span className="w-2 h-2 rounded-full bg-violet-500"></span>}
                </div>
                <div className="mt-2 text-3xl font-bold tracking-tight text-violet-700 tabular-nums">
                  {creditRequests.length}<span className="text-base text-gray-400 font-semibold">건</span>
                </div>
                <div className="text-[11px] text-gray-400 mt-1">후불 승인 대기 · 클릭해 상세</div>
              </button>

              <button
                onClick={() => setCreditPanel('risk')}
                className="text-left bg-white rounded-2xl border border-gray-200/70 shadow-sm p-5 hover:shadow-md hover:border-rose-200 transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">크레딧 위험 회사</span>
                  {creditRiskCompanies.length > 0 && <span className="w-2 h-2 rounded-full bg-rose-500"></span>}
                </div>
                <div className="mt-2 text-3xl font-bold tracking-tight text-rose-600 tabular-nums">
                  {creditRiskCompanies.length}<span className="text-base text-gray-400 font-semibold">건</span>
                </div>
                <div className="text-[11px] text-gray-400 mt-1">소진·마이너스 · 업셀/해지방어</div>
              </button>

              <button
                onClick={() => setCreditPanel('predictive')}
                className="text-left bg-white rounded-2xl border border-gray-200/70 shadow-sm p-5 hover:shadow-md hover:border-indigo-200 transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">예측 일괄 분석·차감</span>
                  <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </div>
                <div className="mt-2 text-lg font-bold tracking-tight text-indigo-700">매일 오전 9시 자동</div>
                <div className="text-[11px] text-gray-400 mt-1">클릭해 지금 실행</div>
              </button>
            </div>

            {/* 크레딧 충전 요청 모달 */}
            {creditPanel === 'requests' && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                  <div className="px-6 py-4 border-b flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">크레딧 충전 요청 {creditRequests.length}건 <span className="text-sm font-normal text-gray-400">(후불)</span></h3>
                    <button onClick={() => setCreditPanel(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                  </div>
                  <div className="p-5 overflow-y-auto">
                    {creditRequests.length === 0 ? (
                      <p className="text-sm text-gray-500 py-10 text-center">대기 중인 크레딧 충전 요청이 없습니다.</p>
                    ) : (
                      <div className="space-y-2">
                        {creditRequests.map((cr) => (
                          <div key={cr.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 border border-gray-100 flex-wrap gap-2">
                            <div className="flex items-center gap-4 flex-wrap">
                              <span className="px-2 py-0.5 rounded text-xs font-medium bg-violet-100 text-violet-800">크레딧 충전</span>
                              <span className="font-medium text-gray-900">{cr.company_name}</span>
                              <span className="font-bold text-lg text-violet-700">{Number(cr.credits).toLocaleString()} 크레딧</span>
                              <span className="text-sm text-gray-500">월말 청구 {Number(cr.total_amount).toLocaleString()}원</span>
                              <span className="text-xs text-gray-400">{formatDateTime(cr.created_at)}</span>
                            </div>
                            <div className="flex gap-2 flex-shrink-0">
                              <button onClick={() => handleApproveCreditRequest(cr)} className="px-4 py-1.5 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 transition-colors">승인</button>
                              <button onClick={() => handleRejectCreditRequest(cr)} className="px-4 py-1.5 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors">거절</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 크레딧 위험 회사 모달 */}
            {creditPanel === 'risk' && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                  <div className="px-6 py-4 border-b flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">크레딧 위험 회사 {creditRiskCompanies.length}건</h3>
                      <span className="text-[11px] text-gray-400">소진 임박·0·마이너스: 업셀/해지방어 대상</span>
                    </div>
                    <button onClick={() => setCreditPanel(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                  </div>
                  <div className="p-5 overflow-y-auto">
                    {creditRiskCompanies.length === 0 ? (
                      <p className="text-sm text-gray-500 py-10 text-center">위험 회사가 없습니다.</p>
                    ) : (
                      <div className="space-y-2">
                        {creditRiskCompanies.map((co) => {
                          const badge = co.risk === 'negative'
                            ? { t: co.nearCap ? '마이너스 · 상한 근접' : '마이너스', c: 'bg-rose-600 text-white' }
                            : co.risk === 'depleted'
                              ? { t: '소진(0)', c: 'bg-rose-200 text-rose-800' }
                              : { t: '소진 임박', c: 'bg-amber-200 text-amber-800' };
                          return (
                            <div key={co.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5 border border-gray-100 flex-wrap gap-2">
                              <div className="flex items-center gap-3 flex-wrap">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.c}`}>{badge.t}</span>
                                <span className="font-medium text-gray-900">{co.companyName}</span>
                                <span className="text-xs text-gray-400">{co.planName}</span>
                              </div>
                              <div className="flex items-center gap-4 text-sm flex-shrink-0">
                                <span className={`font-bold tabular-nums ${co.total < 0 ? 'text-rose-600' : 'text-gray-700'}`}>잔액 {Number(co.total).toLocaleString()}</span>
                                <span className="text-xs text-gray-400">월 {Number(co.planCredits).toLocaleString()}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 예측 일괄 분석·차감 실행 모달 */}
            {creditPanel === 'predictive' && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
                  <div className="px-6 py-4 border-b flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">예측 일괄 분석·차감 실행</h3>
                    <button onClick={() => setCreditPanel(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                  </div>
                  <div className="p-6">
                    <p className="text-sm text-gray-600 leading-relaxed">요금제 가입 회사(고객 DB 보유) 전체를 지금 즉시 분석·차감합니다. 매일 오전 9시 자동 실행과 동일하며, 오늘 이미 차감된 회사는 중복되지 않습니다.</p>
                    <button
                      onClick={() => { setCreditPanel(null); handleRunPredictiveNow(); }}
                      disabled={predictiveRunning}
                      className="mt-5 w-full px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {predictiveRunning ? '실행 중…' : '지금 실행'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 크레딧 사용 이력 — 전체 회사 */}
            <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
              <div className="px-6 py-4 border-b flex flex-wrap justify-between items-center gap-3">
                <h2 className="text-lg font-semibold">크레딧 사용 이력</h2>
                <div className="flex items-center gap-2">
                  <input
                    value={creditTxCompany}
                    onChange={(e) => setCreditTxCompany(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') loadAllCreditTx(1); }}
                    placeholder="회사 ID로 필터 (선택 · 비우면 전체)"
                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm w-64"
                  />
                  <button onClick={() => loadAllCreditTx(1)} className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors">조회</button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="px-4 py-2 font-medium">회사</th>
                      <th className="px-4 py-2 font-medium">작업</th>
                      <th className="px-4 py-2 font-medium">사용자</th>
                      <th className="px-4 py-2 font-medium text-right">변동</th>
                      <th className="px-4 py-2 font-medium text-right">잔여</th>
                      <th className="px-4 py-2 font-medium text-right">일시</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditTxLoading ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">불러오는 중...</td></tr>
                    ) : creditTxAll.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">사용 이력이 없습니다.</td></tr>
                    ) : (
                      creditTxAll.map((tx) => {
                        // ★ 2026-08-13 환불(refund)도 잔액이 늘어나는 축 — CreditHistoryModal isPlus와 같은 기준.
                        const plus = tx.type === 'grant' || tx.type === 'purchase' || tx.type === 'postpaid_grant' || tx.type === 'refund';
                        const after = Number(tx.balance_base_after || 0) + Number(tx.balance_purchased_after || 0);
                        return (
                          <tr key={tx.id} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-900">{tx.company_name || '-'}</td>
                            <td className="px-4 py-2 text-gray-700">{creditTxLabel(tx.type, tx.source)}</td>
                            <td className="px-4 py-2 text-gray-600">{tx.created_by_name || '자동'}</td>
                            <td className={`px-4 py-2 text-right font-semibold ${plus ? 'text-emerald-600' : 'text-rose-600'}`}>{plus ? '+' : '-'}{Number(tx.amount).toLocaleString()}</td>
                            <td className="px-4 py-2 text-right text-gray-500">{after.toLocaleString()}</td>
                            <td className="px-4 py-2 text-right text-gray-400 whitespace-nowrap">{formatDateTime(tx.created_at)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-center gap-2 px-6 py-3 border-t">
                <button disabled={creditTxPage <= 1} onClick={() => loadAllCreditTx(creditTxPage - 1)} className="px-3 py-1 rounded border border-gray-200 text-sm disabled:opacity-30">이전</button>
                <span className="text-sm text-gray-500">{creditTxPage} / {creditTxTotalPages}</span>
                <button disabled={creditTxPage >= creditTxTotalPages} onClick={() => loadAllCreditTx(creditTxPage + 1)} className="px-3 py-1 rounded border border-gray-200 text-sm disabled:opacity-30">다음</button>
              </div>
            </div>
          </div>
        )}

        {/* 충전 관리 탭 — 한줄로 / 에이전트 지갑 분리 (★ 2026-07-26) */}
        {activeTab === 'deposits' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-1.5 flex gap-1.5">
              {([
                ['web', '한줄로 충전', '웹 선불 잔액 · 무통장입금 승인'],
                ['agent', '에이전트 충전', '발송ID(게이트웨이) 지갑'],
              ] as const).map(([key, label, hint]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setChargeScope(key)}
                  className={`flex-1 rounded-xl px-4 py-2.5 text-left transition-colors ${
                    chargeScope === key ? 'bg-indigo-600 text-white' : 'hover:bg-gray-50 text-gray-600'
                  }`}
                >
                  <div className="text-sm font-bold flex items-center gap-2">
                    {label}
                    {key === 'web' && pendingDeposits.length > 0 && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${chargeScope === key ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-800'}`}>
                        대기 {pendingDeposits.length}
                      </span>
                    )}
                  </div>
                  <div className={`text-[11px] mt-0.5 ${chargeScope === key ? 'text-indigo-100' : 'text-gray-400'}`}>{hint}</div>
                </button>
              ))}
            </div>

            {/* 대기 건 알림 */}
            {chargeScope === 'web' && pendingDeposits.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">⏳</span>
                  <h3 className="font-semibold text-amber-800">승인 대기 {pendingDeposits.length}건</h3>
                </div>
                <div className="space-y-2">
                  {pendingDeposits.map((dr) => (
                    <div key={dr.id} className="flex items-center justify-between bg-white rounded-lg px-4 py-3 border border-amber-100">
                      <div className="flex items-center gap-4">
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">무통장입금</span>
                        <span className="font-medium text-gray-900">{dr.company_name}</span>
                        <span className="font-bold text-lg text-gray-900">{Number(dr.amount).toLocaleString()}원</span>
                        <span className="text-sm text-gray-500">입금자: {dr.depositor_name}</span>
                        {dr.held_reason && (
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-700">
                            명의 확인 필요{dr.explanation_note ? ' · 소명 도착' : ''}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">{formatDateTime(dr.created_at)}</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setDepositTarget(dr); setDepositAdminNote(''); setShowDepositApproveModal(true); }}
                          className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
                        >
                          승인
                        </button>
                        <button
                          onClick={() => { setDepositTarget(dr); setDepositAdminNote(''); setShowDepositRejectModal(true); }}
                          className="px-4 py-1.5 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors"
                        >
                          거절
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ★ 2026-07-24 §5-3 에이전트 충전 실행 — 웹 잔액과 별개 지갑(게이트웨이 원장 직결) */}
            {/* ★ 2026-08-11 접수함 건수를 상위 뱃지로 올린다 — 반려·충전 등록 직후 60초를 기다리지 않게. */}
            {chargeScope === 'agent' && <AgentChargePanel onPendingOrdersChange={setAgentOrderPendingCount} />}

            {/* 전체 잔액 변동 이력 — 한줄로(웹) 지갑 */}
            <div className={`bg-white rounded-2xl border border-gray-200/70 shadow-sm ${chargeScope === 'web' ? '' : 'hidden'}`}>
              <div className="px-6 py-4 border-b">
                <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
                  <h2 className="text-lg font-semibold">💰 잔액 변동 이력</h2>
                  <button
                    onClick={() => loadChargeManagement(1)}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
                  >
                    새로고침
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {/* ★ D150-5 (2026-05-09) PDF #2: 입력 검색 가능하도록 SearchableSelect 적용 */}
                  <div className="min-w-[200px]">
                    <SearchableSelect
                      options={companies.filter((c: any) => c.billing_type === 'prepaid').map((c: any) => ({
                        value: c.id,
                        label: c.company_name,
                      }))}
                      value={chargeTxCompanyFilter === 'all' ? '' : chargeTxCompanyFilter}
                      onChange={(value) => setChargeTxCompanyFilter(value || 'all')}
                      placeholder="고객사 검색..."
                      emptyLabel="전체 고객사"
                      className="w-full"
                    />
                  </div>
                  <select
                    value={chargeTxTypeFilter}
                    onChange={(e) => setChargeTxTypeFilter(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm"
                  >
                    <option value="all">전체 구분</option>
                    <option value="charge">충전</option>
                    <option value="deduct">차감</option>
                    <option value="refund">환불</option>
                  </select>
                  <select
                    value={chargeTxMethodFilter}
                    onChange={(e) => setChargeTxMethodFilter(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm"
                  >
                    <option value="all">전체 결제수단</option>
                    <option value="bank_transfer">무통장입금</option>
                    <option value="card">카드결제</option>
                    <option value="virtual_account">가상계좌</option>
                    <option value="admin">관리자</option>
                    <option value="system">시스템(발송)</option>
                  </select>
                  <input
                    type="date"
                    value={chargeTxStartDate}
                    onChange={(e) => setChargeTxStartDate(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm"
                  />
                  <span className="flex items-center text-gray-400">~</span>
                  <input
                    type="date"
                    value={chargeTxEndDate}
                    onChange={(e) => setChargeTxEndDate(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm"
                  />
                  {(chargeTxCompanyFilter !== 'all' || chargeTxTypeFilter !== 'all' || chargeTxMethodFilter !== 'all' || chargeTxStartDate || chargeTxEndDate) && (
                    <button
                      onClick={() => { setChargeTxCompanyFilter('all'); setChargeTxTypeFilter('all'); setChargeTxMethodFilter('all'); setChargeTxStartDate(''); setChargeTxEndDate(''); }}
                      className="px-3 py-2 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      필터 초기화
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">일시</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">고객사</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">구분</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">결제수단</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 whitespace-nowrap">금액</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 whitespace-nowrap">변동 후 잔액</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">설명</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {chargeTxLoading ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-gray-500">불러오는 중...</td>
                      </tr>
                    ) : chargeTxList.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-gray-500">잔액 변동 이력이 없습니다.</td>
                      </tr>
                    ) : (
                      chargeTxList.map((tx) => {
                        const typeConfig: Record<string, { label: string; color: string; sign: string }> = {
                          admin_charge: { label: '충전', color: 'bg-emerald-100 text-emerald-800', sign: '+' },
                          charge: { label: '충전', color: 'bg-emerald-100 text-emerald-800', sign: '+' },
                          deposit_charge: { label: '충전', color: 'bg-emerald-100 text-emerald-800', sign: '+' },
                          admin_deduct: { label: '차감', color: 'bg-red-100 text-red-800', sign: '-' },
                          deduct: { label: '차감', color: 'bg-red-100 text-red-800', sign: '-' },
                          refund: { label: '환불', color: 'bg-blue-100 text-blue-800', sign: '+' },
                        };
                        const methodConfig: Record<string, { label: string; color: string }> = {
                          bank_transfer: { label: '무통장입금', color: 'bg-blue-50 text-blue-700' },
                          card: { label: '카드결제', color: 'bg-purple-50 text-purple-700' },
                          virtual_account: { label: '가상계좌', color: 'bg-indigo-50 text-indigo-700' },
                          admin: { label: '관리자', color: 'bg-gray-100 text-gray-700' },
                          system: { label: '시스템', color: 'bg-orange-50 text-orange-700' },
                        };
                        const tc = typeConfig[tx.type] || { label: tx.type, color: 'bg-gray-100 text-gray-600', sign: '' };
                        const mc = methodConfig[tx.payment_method] || { label: tx.payment_method || '-', color: 'bg-gray-50 text-gray-600' };
                        const isPlus = ['admin_charge', 'charge', 'deposit_charge', 'refund'].includes(tx.type);

                        return (
                          <tr key={tx.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-center text-gray-600 whitespace-nowrap text-xs">
                              {formatDateTime(tx.created_at)}
                            </td>
                            <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                              {tx.company_name}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tc.color}`}>{tc.label}</span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${mc.color}`}>{mc.label}</span>
                            </td>
                            <td className={`px-4 py-3 text-right font-bold whitespace-nowrap ${isPlus ? 'text-emerald-600' : 'text-red-600'}`}>
                              {tc.sign}{Number(tx.amount).toLocaleString()}원
                            </td>
                            <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">
                              {Number(tx.balance_after).toLocaleString()}원
                            </td>
                            <td className="px-4 py-3 text-gray-600 max-w-[300px]">
                              <div className="truncate" title={tx.description || ''}>
                                {tx.description || '-'}
                              </div>
                              {tx.admin_name && (
                                <div className="text-xs text-gray-400">처리: {tx.admin_name}</div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {chargeTxTotal > chargeTxPerPage && (
                <div className="px-6 py-4 border-t flex items-center justify-between">
                  <span className="text-sm text-gray-500">
                    총 {chargeTxTotal}건 중 {(chargeTxPage - 1) * chargeTxPerPage + 1}-{Math.min(chargeTxPage * chargeTxPerPage, chargeTxTotal)}
                  </span>
                  <div className="flex gap-1">
                    <button onClick={() => loadChargeManagement(chargeTxPage - 1)} disabled={chargeTxPage === 1}
                      className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50">◀ 이전</button>
                    {(() => {
                      const totalPages = Math.ceil(chargeTxTotal / chargeTxPerPage);
                      const pages: number[] = [];
                      const start = Math.max(1, chargeTxPage - 2);
                      const end = Math.min(totalPages, start + 4);
                      for (let i = start; i <= end; i++) pages.push(i);
                      return pages.map(p => (
                        <button key={p} onClick={() => loadChargeManagement(p)}
                          className={`px-3 py-1 rounded border text-sm ${chargeTxPage === p ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'}`}>{p}</button>
                      ));
                    })()}
                    <button onClick={() => loadChargeManagement(chargeTxPage + 1)}
                      disabled={chargeTxPage >= Math.ceil(chargeTxTotal / chargeTxPerPage)}
                      className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50">다음 ▶</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 전체 캠페인 탭 */}
        {activeTab === 'allCampaigns' && (
          <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
            <div className="px-6 py-4 border-b">
              <div className="flex flex-wrap gap-3 items-center">
                <select value={allCampaignsCompany} onChange={(e) => setAllCampaignsCompany(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm">
                  <option value="">전체 고객사</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
                <select value={allCampaignsStatus} onChange={(e) => setAllCampaignsStatus(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm">
                  <option value="">전체 상태</option>
                  <option value="draft">임시저장</option>
                  <option value="scheduled">예약</option>
                  <option value="sending">발송중</option>
                  <option value="completed">완료</option>
                  <option value="cancelled">취소</option>
                </select>
                <input type="date" value={allCampaignsStartDate} onChange={(e) => setAllCampaignsStartDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm" />
                <span className="text-gray-400">~</span>
                <input type="date" value={allCampaignsEndDate} onChange={(e) => setAllCampaignsEndDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm" />
                <input type="text" placeholder="캠페인명 / 회사명 / 계정" value={allCampaignsSearch}
                  onChange={(e) => setAllCampaignsSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadAllCampaigns(1)}
                  className="px-3 py-2 border rounded-lg text-sm w-52" />
                <button onClick={() => loadAllCampaigns(1)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">조회</button>
                <span className="text-sm text-gray-500 ml-auto">총 {allCampaignsTotal}건</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-3 text-left text-gray-600 font-medium">회사(계정)</th>
                    <th className="px-3 py-3 text-left text-gray-600 font-medium">캠페인명</th>
                    <th className="px-3 py-3 text-center text-gray-600 font-medium">등록일시</th>
                    <th className="px-3 py-3 text-center text-gray-600 font-medium">발송일시</th>
                    <th className="px-3 py-3 text-center text-gray-600 font-medium">유형</th>
                    <th className="px-3 py-3 text-center text-gray-600 font-medium">문자</th>
                    <th className="px-3 py-3 text-center text-gray-600 font-medium">총건수</th>
                    <th className="px-3 py-3 text-center text-gray-600 font-medium">성공</th>
                    <th className="px-3 py-3 text-center text-gray-600 font-medium">실패</th>
                    <th className="px-3 py-3 text-center text-gray-600 font-medium">대기</th>
                    <th className="px-3 py-3 text-center text-gray-600 font-medium">상태</th>
                    <th className="px-3 py-3 text-center text-gray-600 font-medium">상세</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {allCampaigns.length === 0 ? (
                    <tr><td colSpan={12} className="px-4 py-12 text-center text-gray-400">캠페인이 없습니다.</td></tr>
                  ) : allCampaigns.map((c: any) => {
                    const sent = parseInt(c.total_sent) || 0;
                    const success = parseInt(c.total_success) || 0;
                    const fail = parseInt(c.total_fail) || 0;
                    const pending = c.total_pending != null ? (parseInt(c.total_pending) || 0) : Math.max(0, sent - success - fail);
                    return (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-3 py-3 text-gray-700">
                        <div>{c.company_name || '-'}</div>
                        {c.created_by_login && <div className="text-xs text-gray-400">{c.created_by_login}</div>}
                      </td>
                      <td className="px-3 py-3 font-medium text-gray-900">{c.name}</td>
                      <td className="px-3 py-3 text-center text-gray-500 text-xs whitespace-nowrap">
                        {c.created_at ? formatDateTimeShort(c.created_at) : '-'}
                      </td>
                      <td className="px-3 py-3 text-center text-gray-500 text-xs whitespace-nowrap">
                        {/* ★ 발송일시 = 송출일 기준(예약시각 우선) — 발송통계·상세와 일치 */}
                        {c.scheduled_at ? formatDateTimeShort(c.scheduled_at) : c.sent_at ? formatDateTimeShort(c.sent_at) : '-'}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          resolveSendTypeChipClass(c.send_type)
                        }`}>{resolveSendTypeLabel(c.send_type)}</span>
                      </td>
                      <td className="px-3 py-3 text-center text-xs text-gray-600">{resolveChannelLabel(c)}</td>
                      <td className="px-3 py-3 text-center text-gray-700">{sent.toLocaleString()}</td>
                      <td className="px-3 py-3 text-center text-green-600 font-medium">{success.toLocaleString()}</td>
                      <td className="px-3 py-3 text-center text-red-600">{fail.toLocaleString()}</td>
                      <td className="px-3 py-3 text-center text-amber-600">{pending.toLocaleString()}</td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          c.status === 'completed' ? 'bg-green-100 text-green-700' :
                          c.status === 'sending' ? 'bg-amber-100 text-amber-700' :
                          c.status === 'scheduled' ? 'bg-blue-100 text-blue-700' :
                          c.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {c.status === 'completed' ? '완료' : c.status === 'sending' ? '발송중' : c.status === 'scheduled' ? '예약' : c.status === 'cancelled' ? '취소' : c.status === 'draft' ? '임시' : c.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        {c.status !== 'draft' && (
                          <button onClick={() => openSmsDetail(c.id)}
                            className="text-blue-600 hover:text-blue-800 text-xs font-medium">[조회]</button>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {allCampaignsTotal > 10 && (
              <div className="px-6 py-4 border-t flex items-center justify-between">
                <span className="text-sm text-gray-500">총 {allCampaignsTotal}건</span>
                <div className="flex gap-1">
                  <button onClick={() => loadAllCampaigns(Math.max(1, allCampaignsPage - 1))} disabled={allCampaignsPage === 1}
                    className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50">◀</button>
                  {Array.from({ length: Math.ceil(allCampaignsTotal / 10) }, (_, i) => i + 1).slice(
                    Math.max(0, allCampaignsPage - 3), Math.min(Math.ceil(allCampaignsTotal / 10), allCampaignsPage + 2)
                  ).map(p => (
                    <button key={p} onClick={() => loadAllCampaigns(p)}
                      className={`w-8 h-8 rounded text-sm ${p === allCampaignsPage ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{p}</button>
                  ))}
                  <button onClick={() => loadAllCampaigns(Math.min(Math.ceil(allCampaignsTotal / 10), allCampaignsPage + 1))}
                    disabled={allCampaignsPage >= Math.ceil(allCampaignsTotal / 10)}
                    className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50">▶</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 발송 통계 탭 */}
        {activeTab === 'stats' && (
          <div className="space-y-4">
            {/* ★ 2026-07-23 채널 탭 — 웹/에이전트 구분 */}
            <div className="flex items-center gap-1 border-b border-gray-200">
              {([['web', '웹 발송'], ['agent', '에이전트 발송']] as const).map(([key, label]) => (
                <button key={key} onClick={() => { setStatsChannel(key); loadSendStats(1); }}
                  className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition ${statsChannel === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                  {label}
                </button>
              ))}
            </div>
            {/* 요약 바 (얇게) — 채널별 */}
            {(statsChannel === 'agent' ? sendStats?.agentSummary : sendStats?.summary) && (() => {
              const s = statsChannel === 'agent' ? sendStats.agentSummary : sendStats.summary;
              const sent = Number(s.total_sent);
              const success = Number(s.total_success);
              const fail = Number(s.total_fail);
              const pending = s.total_pending != null ? Number(s.total_pending) : Math.max(0, sent - success - fail);
              // D183 fix: 성공률 = 전송 대비 성공 비율 (대기 영역 포함 분모) — 사용자 관점 정합
              const rate = sent > 0 ? (success / sent * 100).toFixed(1) : '-';
              return (
                <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm px-6 py-3 flex items-center gap-8 text-sm">
                  <span className="text-gray-500">조회 기간 합계</span>
                  <span className="font-semibold text-blue-600">전송 {sent.toLocaleString()}</span>
                  <span className="font-semibold text-green-600">성공 {success.toLocaleString()}</span>
                  <span className="font-semibold text-red-600">실패 {fail.toLocaleString()}</span>
                  <span className="font-semibold text-amber-600">대기 {pending.toLocaleString()}</span>
                  <span className="font-semibold text-gray-700">성공률 {sent > 0 ? `${rate}%` : '-'}</span>
                </div>
              );
            })()}
           
            {/* 필터 영역 */}
            <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm px-6 py-4 flex flex-wrap gap-3 items-center">
              <div className="flex bg-gray-100 rounded-lg p-1">
                {([['daily', '일별'], ['monthly', '월별']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => { setStatsView(key); loadSendStats(1, key); }}
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
              {/* ★ D144 P13: 검색 가능 select — 회사명 입력으로 검색, 67개+ 스크롤 대신 */}
              <SearchableSelect
                options={companies.map(c => ({ value: c.id, label: c.company_name }))}
                value={statsCompanyFilter}
                onChange={setStatsCompanyFilter}
                emptyLabel="전체 고객사"
                placeholder="고객사 선택/검색..."
                className="w-48"
              />
              <button
                onClick={() => loadSendStats(1)}
                className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
              >
                조회
              </button>
              {/* ★ D114 P10: 발송통계 엑셀(CSV) 다운로드 — fetch+blob (Authorization 헤더 필수).
                  ★2026-07-24 에이전트 탭도 지원 — /stats/export/agent (기간×고객사×발송ID×발급명×대상ID×유형, 정산 대조용) */}
              <button
                onClick={async () => {
                  const token = localStorage.getItem('token');
                  if (!statsStartDate || !statsEndDate) { showAlert('안내', '시작일과 종료일을 선택해주세요.', 'warning'); return; }
                  const isAgent = statsChannel === 'agent';
                  const params = new URLSearchParams();
                  params.set('startDate', statsStartDate);
                  params.set('endDate', statsEndDate);
                  if (statsCompanyFilter) params.set('companyId', statsCompanyFilter);
                  if (isAgent) params.set('view', statsView);
                  try {
                    const res = await fetch(`/api/admin/stats/export${isAgent ? '/agent' : ''}?${params.toString()}`, {
                      headers: { Authorization: `Bearer ${token}` },
                    });
                    if (!res.ok) { const err = await res.json().catch(() => ({})); showAlert('오류', (err as any).error || '다운로드 실패', 'error'); return; }
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    // ★ 2026-07-25 CSV → .xlsx (서버가 exceljs로 서식·숫자형까지 넣어 내려준다)
                    a.download = `${isAgent ? '에이전트발송통계' : '발송통계'}_${statsStartDate}_${statsEndDate}.xlsx`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch { showAlert('오류', '다운로드 중 오류가 발생했습니다.', 'error'); }
                }}
                className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700"
              >
                엑셀 다운로드
              </button>
              <span className="text-sm text-gray-400 ml-auto">총 {statsChannel === 'agent' ? (sendStats?.agentTotal || 0) : statsTotal}건</span>
            </div>

            {/* 테이블 */}
            <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                  <tr>
                      <th className="px-4 py-3 text-left text-gray-600 font-medium">{statsView === 'daily' ? '날짜' : '월'}</th>
                      <th className="px-4 py-3 text-left text-gray-600 font-medium">고객사</th>
                      {/* ★ 2026-07-24 발송ID(CustId) — 고객사 화면과 동일 축(정산 대조) */}
                      {statsChannel === 'agent' && <th className="px-4 py-3 text-left text-gray-600 font-medium">발송ID</th>}
                      {statsChannel === 'agent' && <th className="px-4 py-3 text-left text-gray-600 font-medium">유형</th>}
                      <th className="px-4 py-3 text-center text-gray-600 font-medium">전송</th>
                      <th className="px-4 py-3 text-center text-gray-600 font-medium">성공</th>
                      <th className="px-4 py-3 text-center text-gray-600 font-medium">실패</th>
                      <th className="px-4 py-3 text-center text-gray-600 font-medium">대기</th>
                      <th className="px-4 py-3 text-center text-gray-600 font-medium">성공률</th>
                      <th className="px-4 py-3 text-center text-gray-600 font-medium">발송라인</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {!(statsChannel === 'agent' ? sendStats?.agentRows : sendStats?.rows)?.length ? (
                      <tr><td colSpan={statsChannel === 'agent' ? 10 : 8} className="px-4 py-12 text-center text-gray-400">데이터가 없습니다.</td></tr>
                    ) : (statsChannel === 'agent'
                        ? agentStatsRows.slice((agentStatsSafePage - 1) * AGENT_STATS_PER_PAGE, agentStatsSafePage * AGENT_STATS_PER_PAGE)
                        : sendStats.rows
                      ).map((row: any, idx: number) => {
                      const sent = Number(row.sent);
                      const success = Number(row.success);
                      const fail = Number(row.fail);
                      const pending = row.pending != null ? Number(row.pending) : Math.max(0, sent - success - fail);
                      // D183 fix: 성공률 = 전송 대비 성공 비율 (대기 영역 포함 분모) — 사용자 관점 정합
                      const rate = sent > 0 ? (success / sent * 100).toFixed(1) : '-';
                      return (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900 font-mono">{row.date || row.month || row.period}</td>
                          <td className="px-4 py-3 text-gray-700">{row.company_name}</td>
                          {statsChannel === 'agent' && (
                            <td className="px-4 py-3 font-mono text-xs text-gray-600">
                              {row.agent_send_id || '-'}{row.cust_name ? <span className="text-gray-400"> / {row.cust_name}</span> : null}
                              {/* ★ 2026-07-25 부달 재전송 귀속분(공용 엔진 계정 → 원 발송ID). 해석 실패분은 고객사가 (미귀속)으로 표시된다 */}
                              {row.is_relay ? <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-sans">부달 재전송</span> : null}
                            </td>
                          )}
                          {statsChannel === 'agent' && <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 text-xs font-medium">{row.type_label || row.msg_type}</span></td>}
                          <td className="px-4 py-3 text-center text-blue-600 font-medium">{sent.toLocaleString()}</td>
                          <td className="px-4 py-3 text-center text-green-600">{success.toLocaleString()}</td>
                          <td className="px-4 py-3 text-center text-red-600">{fail.toLocaleString()}</td>
                          <td className="px-4 py-3 text-center text-amber-600">{pending.toLocaleString()}</td>
                          <td className="px-4 py-3 text-center font-medium">{sent > 0 ? `${rate}%` : '-'}</td>
                          <td className="px-4 py-3 text-center">
                            {statsChannel === 'agent' ? (
                              <span className="px-2 py-1 bg-violet-50 text-violet-700 text-xs rounded-full font-medium">에이전트</span>
                            ) : row.line_group_name ? (
                              <span className="px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-full font-medium">{row.line_group_name}</span>
                            ) : (
                              <span className="text-xs text-gray-400">미배정</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 페이징 — 웹은 서버 페이징, 에이전트는 클라이언트 페이징(서버가 전량 반환하는 축) */}
              {statsChannel === 'agent' && agentStatsTotalPages > 1 && (
                <div className="px-6 py-4 border-t flex items-center justify-between">
                  <span className="text-xs text-gray-400 tabular-nums">
                    {(agentStatsSafePage - 1) * AGENT_STATS_PER_PAGE + 1}–
                    {Math.min(agentStatsSafePage * AGENT_STATS_PER_PAGE, agentStatsRows.length)} / 전체 {agentStatsRows.length}건
                  </span>
                  <div className="flex justify-center gap-2">
                    <button onClick={() => setAgentStatsPage(Math.max(1, agentStatsSafePage - 1))} disabled={agentStatsSafePage === 1}
                      className="px-3 h-8 rounded text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">이전</button>
                    {Array.from({ length: agentStatsTotalPages }, (_, i) => i + 1).slice(
                      Math.max(0, agentStatsSafePage - 3), Math.min(agentStatsTotalPages, agentStatsSafePage + 2)
                    ).map(p => (
                      <button key={p} onClick={() => setAgentStatsPage(p)}
                        className={`w-8 h-8 rounded text-sm ${p === agentStatsSafePage ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                        {p}
                      </button>
                    ))}
                    <button onClick={() => setAgentStatsPage(Math.min(agentStatsTotalPages, agentStatsSafePage + 1))} disabled={agentStatsSafePage === agentStatsTotalPages}
                      className="px-3 h-8 rounded text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">다음</button>
                  </div>
                </div>
              )}
              {statsChannel === 'web' && statsTotal > 10 && (
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

      {/* ═══ 템플릿 관리 탭 ═══ */}
      {activeTab === 'templates' && (
        <div className="space-y-4">
        {/* 발신 프로필 관리 — D130 AlimtalkSendersSection (IMC 연동 + 승인 워크플로우) */}
        <AlimtalkSendersSection />

        {/* 템플릿 관리 */}
        <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
          <div className="px-6 py-4 border-b flex justify-between items-center">
            <div>
              <h2 className="text-lg font-semibold">💬 템플릿 관리</h2>
              <p className="text-xs text-gray-500 mt-1">고객사 알림톡/RCS 템플릿 승인·반려 및 수동 등록</p>
            </div>
            <div className="flex items-center gap-2">
              {/* ★ 2026-08-04 딜러 이관은 발신프로필이 먼저 끝나고 템플릿이 뒤따르는 일이 잦아,
                  프로필 연결 뒤 템플릿만 다시 받아야 한다. 그 진입점을 템플릿 화면에도 둔다. */}
              <button onClick={() => setShowImcTemplateImport(true)}
                className="bg-violet-100 hover:bg-violet-200 text-violet-700 px-4 py-2 rounded-lg text-sm font-medium">
                IMC에서 가져오기
              </button>
              <button onClick={() => setShowManualTemplateForm(true)}
                className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
                + 수동 등록 (기존 템플릿)
              </button>
            </div>
          </div>

          {/* 서브탭 + 검색 + 필터 */}
          <div className="px-6 py-3 border-b flex items-center justify-between gap-3">
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => setTemplateSubTab('alimtalk')}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${templateSubTab === 'alimtalk' ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                알림톡
              </button>
              <button onClick={() => setTemplateSubTab('rcs')}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${templateSubTab === 'rcs' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                RCS
              </button>
            </div>
            <input
              type="text"
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
              placeholder="고객사·템플릿명·템플릿코드·관리코드 검색"
              className="flex-1 min-w-0 max-w-sm px-3 py-1.5 border rounded-lg text-sm"
            />
            <div className="flex gap-1 flex-shrink-0">
              {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
                <button key={f} onClick={() => setTemplateFilter(f)}
                  className={`px-2.5 py-1 rounded text-xs transition ${templateFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  {f === 'all' ? '전체' : f === 'pending' ? '승인대기' : f === 'approved' ? '승인' : '반려'}
                </button>
              ))}
            </div>
          </div>

          {/* 알림톡 목록 */}
          {templateSubTab === 'alimtalk' && (
            <>
            <div className="overflow-x-auto">
              {templatesLoading ? (
                <div className="text-center py-12 text-gray-400">로딩 중...</div>
              ) : filteredAlimtalkTemplates.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  {adminTemplates.length === 0 ? '템플릿이 없습니다' : '검색 결과가 없습니다'}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">고객사</th>
                      {/* ★ 2026-08-04 채널 컬럼 — 대행사는 한 회사 밑에 여러 브랜드 채널을 갖는다.
                          회사명만 보이면 어느 채널 템플릿인지 상세를 열어야 알 수 있었다. */}
                      <th className="px-4 py-3 text-left font-medium text-gray-600">채널</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">템플릿명</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">카테고리</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">상태</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">요청일</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredAlimtalkTemplates
                      .slice((templatePage - 1) * templatePerPage, templatePage * templatePerPage)
                      .map((t: any) => (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900 font-medium">{t.company_name || '-'}</td>
                        <td className="px-4 py-3">
                          {t.profile_name || t.yellow_id ? (
                            <>
                              <div className="text-gray-700">{t.profile_name || '-'}</div>
                              {t.yellow_id && <div className="text-xs text-gray-400">{t.yellow_id}</div>}
                            </>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-gray-900">{t.template_name}</div>
                          {t.template_code && (
                            <div
                              className="text-xs text-gray-400 hover:text-blue-600 cursor-pointer inline-block"
                              style={{ userSelect: 'text' }}
                              title="클릭하면 복사"
                              onClick={() => { navigator.clipboard.writeText(t.template_code); showAlert('복사 완료', '템플릿코드를 복사했습니다.', 'success'); }}
                            >{t.template_code}</div>
                          )}
                          {/* ★ 2026-07-22(접수2): 고객사 지정 관리코드 표시 + 검색 대상 */}
                          {t.custom_template_code && (
                            <div className="text-[11px] text-gray-400" style={{ userSelect: 'text' }}>관리코드: {t.custom_template_code}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{t.category || '-'}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getAlimtalkTemplateStatus(t.status).badgeClass}`}>
                            {getAlimtalkTemplateStatus(t.status).label}
                          </span>
                          {/* ★ CT-87 (2026-06-10): 검수 승인이어도 카카오 활성상태(A 외)면 발송 거부 — 실상태 병기 */}
                          {getAlimtalkTemplateStatus(t.status).label === '승인' && t.imc_template_status && t.imc_template_status !== 'A' && (
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ml-1 ${t.imc_template_status === 'R' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}
                              title="카카오 측 템플릿 활성상태가 A(정상)가 아니면 발송이 거부됩니다."
                            >
                              {t.imc_template_status === 'R' ? '활성 대기 · 발송불가' : t.imc_template_status === 'S' ? '중단 · 발송불가' : `${t.imc_template_status} · 발송불가`}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{t.requested_at ? new Date(t.requested_at).toLocaleDateString('ko-KR') : '-'}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex gap-1 justify-center items-center">
                            <button onClick={() => setTemplateDetail(t)}
                              className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100">상세</button>
                            {getAlimtalkTemplateStatus(t.status).label === '검수중' && (
                              <>
                                <button onClick={() => handleTemplateApprove(t.id)}
                                  className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100">승인</button>
                                <button onClick={() => handleTemplateReject(t.id)}
                                  className="text-xs px-2 py-1 bg-red-50 text-red-700 rounded hover:bg-red-100">반려</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <TablePagination
              total={filteredAlimtalkTemplates.length}
              page={templatePage}
              perPage={templatePerPage}
              onChange={setTemplatePage}
              unit="건"
            />
            </>
          )}

          {/* RCS 목록 */}
          {templateSubTab === 'rcs' && (
            <>
            <div className="overflow-x-auto">
              {filteredRcsTemplates.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  {adminRcsTemplates.length === 0 ? 'RCS 템플릿이 없습니다' : '검색 결과가 없습니다'}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">고객사</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">템플릿명</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">유형</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">상태</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredRcsTemplates
                      .slice((templatePage - 1) * templatePerPage, templatePage * templatePerPage)
                      .map((t: any) => (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900 font-medium">{t.company_name || '-'}</td>
                        <td className="px-4 py-3 text-gray-900">{t.template_name}</td>
                        <td className="px-4 py-3 text-gray-600">{t.message_type}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getAlimtalkTemplateStatus(t.status).badgeClass}`}>
                            {getAlimtalkTemplateStatus(t.status).label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {/* ★ 2026-08-17 RCS 승인·반려 버튼 제거 — 이 버튼은 우리 DB의 status만 바꿨고
                              실제 검수 주체(RCS Biz Center)와 아무 관계가 없었다. 그 상태로 "승인"을 보면
                              발송 가능으로 읽히지만 실제로는 그렇지 않다. 검수 상태는 연동 동기화로만 채운다
                              (설계 = docs/2026-08-17-rcs-integration-design.md §2-2). 상세 보기는 유지. */}
                          <div className="flex gap-1 justify-center items-center">
                            <button onClick={() => setTemplateDetail(t)}
                              className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100">상세</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <TablePagination
              total={filteredRcsTemplates.length}
              page={templatePage}
              perPage={templatePerPage}
              onChange={setTemplatePage}
              unit="건"
            />
            </>
          )}
        </div>
        </div>
      )}

      {/* ★ D130: 레거시 발신 프로필 등록 모달(Sender Key 수동 입력) 제거됨 — AlimtalkSendersSection의 SenderRegistrationWizard로 대체 */}

      {/* 템플릿 상세 모달 — 고객사 업로드 템플릿 정보 확인 (발송/승인 내용·반려 사유) */}
      {templateDetail && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-white flex justify-between items-center flex-shrink-0">
              <div>
                <h3 className="text-lg font-bold">템플릿 상세</h3>
                <p className="text-xs text-gray-500">{templateDetail.company_name || '-'} · {getAlimtalkTemplateStatus(templateDetail.status).label}</p>
              </div>
              <button onClick={() => setTemplateDetail(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="p-6 overflow-auto space-y-4 text-sm" style={{ userSelect: 'text' }}>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-xs text-gray-400 mb-0.5">템플릿명</div><div className="text-gray-800">{templateDetail.template_name || '-'}</div></div>
                <div><div className="text-xs text-gray-400 mb-0.5">템플릿코드</div><div className="text-gray-800 font-mono">{templateDetail.template_code || '-'}</div></div>
                <div><div className="text-xs text-gray-400 mb-0.5">카테고리</div><div className="text-gray-800">{templateDetail.category || '-'}</div></div>
                <div><div className="text-xs text-gray-400 mb-0.5">유형</div><div className="text-gray-800">{templateDetail.message_type || '-'}</div></div>
                <div><div className="text-xs text-gray-400 mb-0.5">발신프로필</div><div className="text-gray-800">{templateDetail.profile_name || '-'}</div></div>
                <div><div className="text-xs text-gray-400 mb-0.5">요청일</div><div className="text-gray-800">{(templateDetail.requested_at || templateDetail.created_at) ? new Date(templateDetail.requested_at || templateDetail.created_at).toLocaleString('ko-KR') : '-'}</div></div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">템플릿 내용</div>
                <div className="bg-gray-50 border rounded-lg p-3 whitespace-pre-wrap break-words text-gray-800">{templateDetail.content || '-'}</div>
              </div>
              {/* ★ 2026-06-22: 강조 표기 + 버튼 + 부가정보 — 검수/문의 응대 시 등록 내용 확인 (처리메모 요청) */}
              {templateDetail.emphasize_type && templateDetail.emphasize_type !== 'NONE' && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">강조 표기 ({templateDetail.emphasize_type})</div>
                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 whitespace-pre-wrap break-words text-gray-800">{templateDetail.emphasize_title || '-'}</div>
                </div>
              )}
              {(() => {
                const raw = (templateDetail as any).buttons;
                let btns: any[] = [];
                if (Array.isArray(raw)) btns = raw;
                else if (typeof raw === 'string' && raw.trim()) { try { const p = JSON.parse(raw); if (Array.isArray(p)) btns = p; } catch { /* 파싱 실패 무시 */ } }
                if (btns.length === 0) return null;
                return (
                  <div>
                    <div className="text-xs text-gray-400 mb-1">버튼 ({btns.length})</div>
                    <div className="space-y-1">
                      {btns.map((b: any, i: number) => {
                        const nm = b?.name || b?.buttonName || b?.title || `버튼 ${i + 1}`;
                        const tp = b?.linkType || b?.type || b?.linkTypeCode || '';
                        const url = b?.linkMo || b?.urlMobile || b?.url || b?.linkPc || b?.urlPc || '';
                        return (
                          <div key={i} className="bg-gray-50 border rounded px-3 py-1.5 text-xs text-gray-800">
                            <span className="font-medium">{nm}</span>
                            {tp ? <span className="text-gray-400"> · {tp}</span> : null}
                            {url ? <span className="text-gray-400 break-all"> · {url}</span> : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              {/* ★ 2026-07-28 서수란 접수 — 업체가 등록 시 입력한 부가기능이 상세에 하나도 안 나와
                  발송 실패 원인(대표링크 누락 등)을 슈퍼관리자에서 확인할 수 없었다(무주덕유산리조트).
                  값은 이미 kakao_templates에 저장돼 있고 목록 API가 kt.*로 실어 보낸다 — 렌더만 없었다.
                  대표링크만 채우면 같은 접수가 반복되므로 등록 폼이 받는 항목을 한 번에 노출한다.
                  값이 없는 항목은 그리지 않는다(기존 강조표기·버튼 블록과 동일한 규칙). */}
              {(() => {
                const raw = (templateDetail as any).represent_link;
                let rl: any = null;
                if (raw && typeof raw === 'object') rl = raw;
                else if (typeof raw === 'string' && raw.trim()) { try { rl = JSON.parse(raw); } catch { /* 파싱 실패 무시 */ } }
                const mo = rl?.urlMobile || rl?.linkMo || '';
                const pc = rl?.urlPc || rl?.linkPc || '';
                const ios = rl?.schemeIos || '';
                const and = rl?.schemeAndroid || '';
                if (!mo && !pc && !ios && !and) return null;
                return (
                  <div>
                    <div className="text-xs text-gray-400 mb-1">대표링크 (말풍선 전역 클릭)</div>
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-1 text-xs text-gray-800">
                      {mo && <div><span className="text-gray-400">Mobile</span> <span className="break-all">{mo}</span></div>}
                      {pc && <div><span className="text-gray-400">PC</span> <span className="break-all">{pc}</span></div>}
                      {ios && <div><span className="text-gray-400">iOS scheme</span> <span className="break-all">{ios}</span></div>}
                      {and && <div><span className="text-gray-400">Android scheme</span> <span className="break-all">{and}</span></div>}
                    </div>
                  </div>
                );
              })()}
              {templateDetail.preview_message && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">미리보기 메시지 (앱 알림 문구)</div>
                  <div className="bg-gray-50 border rounded-lg p-3 whitespace-pre-wrap break-words text-gray-800">{templateDetail.preview_message}</div>
                </div>
              )}
              {templateDetail.template_header && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">헤더</div>
                  <div className="bg-gray-50 border rounded-lg p-3 whitespace-pre-wrap break-words text-gray-800">{templateDetail.template_header}</div>
                </div>
              )}
              {templateDetail.ad_content && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">광고 문구</div>
                  <div className="bg-gray-50 border rounded-lg p-3 whitespace-pre-wrap break-words text-gray-800">{templateDetail.ad_content}</div>
                </div>
              )}
              {(() => {
                const raw = (templateDetail as any).quick_replies;
                let qrs: any[] = [];
                if (Array.isArray(raw)) qrs = raw;
                else if (typeof raw === 'string' && raw.trim()) { try { const p = JSON.parse(raw); if (Array.isArray(p)) qrs = p; } catch { /* 파싱 실패 무시 */ } }
                if (qrs.length === 0) return null;
                return (
                  <div>
                    <div className="text-xs text-gray-400 mb-1">바로연결 ({qrs.length})</div>
                    <div className="space-y-1">
                      {qrs.map((q: any, i: number) => (
                        <div key={i} className="bg-gray-50 border rounded px-3 py-1.5 text-xs text-gray-800">
                          <span className="font-medium">{q?.name || q?.title || `바로연결 ${i + 1}`}</span>
                          {(q?.linkMo || q?.urlMobile) ? <span className="text-gray-400 break-all"> · {q.linkMo || q.urlMobile}</span> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {templateDetail.security_flag && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                  보안 템플릿: 메인 디바이스(모바일) 외 서브 디바이스에는 메시지 내용이 노출되지 않습니다.
                </div>
              )}
              {templateDetail.extra_content && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">부가 정보</div>
                  <div className="bg-gray-50 border rounded-lg p-3 whitespace-pre-wrap break-words text-gray-800">{templateDetail.extra_content}</div>
                </div>
              )}
              {templateDetail.reject_reason && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">반려 사유</div>
                  <div className="bg-red-50 border border-red-100 rounded-lg p-3 whitespace-pre-wrap break-words text-red-700">{templateDetail.reject_reason}</div>
                </div>
              )}
            </div>
            <div className="px-6 py-3 border-t bg-gray-50 flex justify-end flex-shrink-0">
              <button onClick={() => setTemplateDetail(null)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium">닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* ★ 2026-08-04 IMC에서 템플릿 가져오기 — 이미 연결된 발신프로필을 골라 그 프로필 템플릿만 들여온다 */}
      {showImcTemplateImport && (
        <ImcProfileImportModal
          companies={companies.map((c: any) => ({ id: c.id, company_name: c.company_name }))}
          mode="templateOnly"
          onClose={() => setShowImcTemplateImport(false)}
          onDone={(msg) => { showAlert('완료', msg, 'success'); loadAdminTemplates(); }}
        />
      )}

      {/* 수동 등록 모달 */}
      {showManualTemplateForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b bg-gradient-to-r from-amber-50 to-white flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold">기존 템플릿 수동 등록</h3>
                <p className="text-xs text-gray-500">이미 카카오에 등록된 템플릿을 승인 상태로 직접 등록합니다</p>
              </div>
              <button onClick={() => setShowManualTemplateForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">고객사 <span className="text-red-500">*</span></label>
                <select value={manualForm.companyId} onChange={e => setManualForm({ ...manualForm, companyId: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                  <option value="">선택</option>
                  {companies.map((c: any) => <option key={c.id} value={c.id}>{c.companyName || c.company_name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">템플릿 코드</label>
                  <input value={manualForm.templateCode} onChange={e => setManualForm({ ...manualForm, templateCode: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">카테고리</label>
                  <select value={manualForm.category} onChange={e => setManualForm({ ...manualForm, category: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                    <option value="">선택</option>
                    {['결제/입금','배송/물류','예약/일정','회원가입/인증','공지/안내','주문/구매','이벤트/프로모션','고객관리','기타'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">템플릿명 <span className="text-red-500">*</span></label>
                <input value={manualForm.templateName} onChange={e => setManualForm({ ...manualForm, templateName: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">본문 <span className="text-red-500">*</span></label>
                <textarea value={manualForm.content} onChange={e => setManualForm({ ...manualForm, content: e.target.value })}
                  rows={5} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
              </div>
            </div>
            <div className="px-6 py-3 border-t bg-gray-50 flex justify-end gap-3">
              <button onClick={() => setShowManualTemplateForm(false)}
                className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm">취소</button>
              <button onClick={handleManualTemplateSubmit}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium">승인 상태로 등록</button>
            </div>
          </div>
        </div>
      )}

      {/* ★ D96: 반려 사유 입력 모달 */}
      {rejectModal.show && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[zoomIn_0.25s_ease-out]">
            <div className="px-6 pt-6 pb-2 text-center">
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900">템플릿 반려</h3>
              <p className="text-sm text-gray-500 mt-1">반려 사유를 입력해주세요</p>
            </div>
            <div className="px-6 py-3">
              <textarea
                value={rejectModal.reason}
                onChange={e => setRejectModal(prev => ({ ...prev, reason: e.target.value }))}
                placeholder="반려 사유를 입력하세요..."
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                autoFocus
              />
            </div>
            <div className="px-6 pb-6 pt-2 flex gap-3">
              <button
                onClick={() => setRejectModal({ show: false, id: '', reason: '' })}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2.5 rounded-xl text-sm transition"
              >
                취소
              </button>
              <button
                onClick={handleTemplateRejectConfirm}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-medium py-2.5 rounded-xl text-sm transition"
              >
                반려
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 고객사 추가 모달 */}
      {showCompanyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
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
                      {formatPlanOptionLabel(plan.plan_name, plan.monthly_price)}
                    </option>
                  ))}
                </select>
              </div>
              {/* ★ 2026-07-03 사용구분 — web(웹발송) / agent(QTmsg 에이전트 전용) / both(웹+에이전트) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  사용구분 *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: 'web', label: '웹발송', desc: '한줄로 전체 기능' },
                    { value: 'agent', label: '에이전트', desc: '카카오템플릿+결과만' },
                    { value: 'both', label: '웹+에이전트', desc: '웹 발송과 에이전트 발송을 함께 사용' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setNewCompany({ ...newCompany, usageType: opt.value })}
                      className={`px-2 py-2 rounded-lg border text-center transition ${
                        newCompany.usageType === opt.value
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <div className="text-sm font-medium">{opt.label}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">{opt.desc}</div>
                    </button>
                  ))}
                </div>
                {newCompany.usageType === 'agent' && (
                  <p className="text-xs text-amber-600 mt-1.5">
                    에이전트 전용 계정은 로그인 시 카카오 템플릿 관리만 접근 가능합니다 (대시보드 차단).
                  </p>
                )}
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b">
              <h3 className="text-lg font-semibold">새 사용자 추가</h3>
            </div>
            <form onSubmit={handleCreateUser} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  소속 회사 *
                </label>
                {/* ★ D144 P11: 검색 가능 select — 회사명 입력으로 검색, 67개+ 스크롤 대신 */}
                <SearchableSelect
                  options={companies.map((company) => ({
                    value: company.id,
                    label: `${company.company_name} (${company.company_code})`,
                  }))}
                  value={newUser.companyId}
                  onChange={(v) => setNewUser({ ...newUser, companyId: v })}
                  placeholder="회사명 검색..."
                  required
                />
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
              {/* ★ 2026-08-18 로그인 인증번호 — 계정당 하나. 계약 담당자 번호를 여기서 등록한다 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  로그인 인증번호 <span className="text-xs font-normal text-gray-400">(휴대폰 · 계정당 1개)</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="01012345678 (비우면 인증 해제)"
                  value={editingUser.mfa_phone || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, mfa_phone: e.target.value.replace(/\D/g, '').slice(0, 11) })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  로그인 시 이 번호로 6자리를 보냅니다. 번호를 바꾸면 기존 기기 인증이 모두 해제됩니다.
                </p>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">발송 라인그룹</label>
                <select
                  value={editingUser.line_group_id || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, line_group_id: e.target.value || null })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">회사 기본 라인그룹 사용</option>
                  {lineGroups.filter((lg: any) => (lg.group_type === 'bulk' || lg.group_type === 'bito') && lg.is_active).map((lg: any) => (
                    <option key={lg.id} value={lg.id}>{lg.group_name} ({lg.sms_tables?.length || 0}개 테이블)</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">개별 라인그룹 설정 시 이 사용자의 발송은 해당 라인으로 분리됩니다</p>
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

              {/* 080 수신거부 자동연동 섹션 */}
              <div className="border-t pt-4 mt-4">
                <div className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  📱 080 수신거부 자동연동 (나래인터넷)
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">080 수신거부번호</label>
                    <input
                      type="text"
                      value={editingUser.opt_out_080_number || ''}
                      onChange={(e) => setEditingUser({ ...editingUser, opt_out_080_number: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="예: 080-719-6700"
                    />
                    <p className="text-xs text-gray-400 mt-1">나래인터넷에서 발급받은 080번호 입력. 콜백 시 이 번호로 사용자 매칭</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="block text-sm font-medium text-gray-700">자동연동</label>
                    <button
                      type="button"
                      onClick={() => setEditingUser({ ...editingUser, opt_out_auto_sync: !editingUser.opt_out_auto_sync })}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editingUser.opt_out_auto_sync ? 'bg-green-500' : 'bg-gray-300'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editingUser.opt_out_auto_sync ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                    <span className={`text-sm ${editingUser.opt_out_auto_sync ? 'text-green-600 font-medium' : 'text-gray-400'}`}>
                      {editingUser.opt_out_auto_sync ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  {!editingUser.opt_out_080_number && editingUser.opt_out_auto_sync && (
                    <p className="text-xs text-orange-500">⚠️ 080번호를 입력해야 자동연동이 작동합니다</p>
                  )}
                </div>

                {/* 업로드 고객 DB 현황 */}
                {editingUser.uploaded_customer_count > 0 && (
                  <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">업로드 고객 DB: <strong>{Number(editingUser.uploaded_customer_count).toLocaleString()}건</strong></span>
                      <button
                        type="button"
                        onClick={() => showConfirm('고객 DB 삭제', `이 사용자가 업로드한 고객 ${Number(editingUser.uploaded_customer_count).toLocaleString()}건을 전부 삭제하시겠습니까?\n연관 구매내역도 함께 삭제되며, 복구할 수 없습니다.`, async () => {
                          try {
                            const token = localStorage.getItem('token');
                            const res = await fetch(`/api/admin/users/${editingUser.id}/customers`, {
                              method: 'DELETE',
                              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
                            });
                            if (res.ok) {
                              const data = await res.json();
                              showAlert('성공', `${data.deletedCount}명 삭제 (구매내역 ${data.deletedPurchases}건 포함)`, 'success');
                              setEditingUser({ ...editingUser, uploaded_customer_count: 0 });
                            } else {
                              const data = await res.json();
                              showAlert('오류', data.error || '삭제 실패', 'error');
                            }
                          } catch { showAlert('오류', '삭제 실패', 'error'); }
                        })}
                        className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
                      >
                        🗑️ 고객 DB 삭제
                      </button>
                    </div>
                  </div>
                )}

                {/* 수신거부 현황 */}
                {editingUser.unsubscribe_count > 0 && (
                  <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600">수신거부: <strong>{Number(editingUser.unsubscribe_count).toLocaleString()}건</strong></span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const token = localStorage.getItem('token');
                              const res = await fetch(`/api/admin/users/${editingUser.id}/unsubscribes/export`, {
                                headers: { 'Authorization': `Bearer ${token}` }
                              });
                              if (!res.ok) throw new Error('다운로드 실패');
                              const blob = await res.blob();
                              const url = window.URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `unsubscribes_${editingUser.name}_${new Date().toISOString().slice(0,10)}.csv`;
                              a.click();
                              window.URL.revokeObjectURL(url);
                            } catch { showAlert('오류', '다운로드 실패', 'error'); }
                          }}
                          className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"
                        >
                          📥 다운로드
                        </button>
                        <button
                          type="button"
                          onClick={() => showConfirm('수신거부 삭제', `이 사용자의 수신거부 ${Number(editingUser.unsubscribe_count).toLocaleString()}건을 전부 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.`, async () => {
                            try {
                              const token = localStorage.getItem('token');
                              const res = await fetch(`/api/admin/users/${editingUser.id}/unsubscribes`, {
                                method: 'DELETE',
                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
                              });
                              if (res.ok) {
                                const data = await res.json();
                                showAlert('성공', `${data.deletedCount}건 삭제되었습니다.`, 'success');
                                setEditingUser({ ...editingUser, unsubscribe_count: 0 });
                              }
                            } catch { showAlert('오류', '삭제 실패', 'error'); }
                          })}
                          className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
                        >
                          🗑️ 전체삭제
                        </button>
                      </div>
                    </div>
                  </div>
                )}
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
          <div className={`bg-white rounded-2xl shadow-2xl w-full ${editCompanyTab === 'customers' || editCompanyTab === 'cards' ? 'max-w-4xl' : 'max-w-2xl'} max-h-[90vh] flex flex-col transition-all`}>
            <div className="px-6 py-4 border-b">
              <h3 className="text-lg font-semibold">고객사 상세 설정</h3>
              <p className="text-xs text-gray-500 mt-1">{editCompany.companyName}</p>
            </div>

            {/* 탭 네비게이션 */}
            <div className="flex flex-shrink-0 border-b px-1 bg-gray-50">
              {[
                { key: 'basic', label: '기본정보', icon: '🏢' },
                { key: 'send', label: '발송정책', icon: '📋' },
                { key: 'cost', label: '단가/요금', icon: '💰' },
                { key: 'ai', label: '크레딧', icon: '💳' },
                { key: 'store', label: '분류코드', icon: '🏷️' },
                { key: 'billing', label: '정산', icon: '🧾' },
                { key: 'cards', label: '대시보드', icon: '📊' },
                { key: 'customers', label: '고객DB', icon: '👥' },
                { key: 'sync', label: 'Sync', icon: '🔄' },
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
                  className={`flex-1 py-2.5 text-[11px] font-medium text-center border-b-2 transition-colors ${
                    editCompanyTab === tab.key
                      ? 'border-blue-600 text-blue-600 bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <span className="block text-sm leading-tight">{tab.icon}</span>
                  <span className="block mt-0.5 leading-tight">{tab.label}</span>
                </button>
              ))}
            </div>

            <form onSubmit={handleUpdateCompany} className="flex-1 overflow-y-auto p-6">
              {/* 기본정보 탭 */}
              {editCompanyTab === 'basic' && (
                <div className="space-y-4">
                  {/* ★ 2026-08-18 발신번호 회선 정책 — 전송자격인증 2.1 */}
                  <div className="border border-gray-200 rounded-xl p-4 bg-gray-50/60">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-800">발신번호 회선 정책</h4>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          상한은 <span className="font-medium">신규 등록에만</span> 적용됩니다. 이미 등록된 번호는 그대로 유지됩니다.
                        </p>
                      </div>
                      <button type="button" onClick={handleSaveLinePolicy} disabled={!linePolicy || linePolicySaving}
                        className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg transition-colors">
                        {linePolicySaving ? '저장 중…' : '회선 정책 저장'}
                      </button>
                    </div>

                    {!linePolicy ? (
                      <p className="text-xs text-gray-400">불러오는 중…</p>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-3 text-xs">
                          <span className="px-2 py-1 rounded-md bg-white border border-gray-200 text-gray-600">
                            현재 보유 · 무선 <span className="font-semibold text-gray-900">{linePolicy.held.mobile}</span>
                          </span>
                          <span className="px-2 py-1 rounded-md bg-white border border-gray-200 text-gray-600">
                            현재 보유 · 유선 <span className="font-semibold text-gray-900">{linePolicy.held.landline}</span>
                          </span>
                          <span className="px-2 py-1 rounded-md bg-white border border-gray-200 text-gray-600">
                            적용 상한 · 무선 <span className="font-semibold text-gray-900">{linePolicy.effective.mobile ?? '제한 없음'}</span>
                            {' / '}유선 <span className="font-semibold text-gray-900">{linePolicy.effective.landline ?? '제한 없음'}</span>
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">가입자 유형</label>
                            <select
                              value={linePolicy.subscriberType || ''}
                              onChange={(e) => setLinePolicy({ ...linePolicy, subscriberType: e.target.value || null })}
                              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                              <option value="">미설정</option>
                              <option value="corporate">법인</option>
                              <option value="individual">개인</option>
                              <option value="foreigner">외국인</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">무선 상한</label>
                            <input type="number" min={1} placeholder="비우면 제한 없음"
                              disabled={linePolicy.subscriberType === 'individual' || linePolicy.subscriberType === 'foreigner'}
                              value={linePolicy.mobileLineLimit ?? ''}
                              onChange={(e) => setLinePolicy({ ...linePolicy, mobileLineLimit: e.target.value === '' ? null : Number(e.target.value) })}
                              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-100 disabled:text-gray-400" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">유선 상한</label>
                            <input type="number" min={1} placeholder="비우면 제한 없음"
                              disabled={linePolicy.subscriberType === 'individual' || linePolicy.subscriberType === 'foreigner'}
                              value={linePolicy.landlineLineLimit ?? ''}
                              onChange={(e) => setLinePolicy({ ...linePolicy, landlineLineLimit: e.target.value === '' ? null : Number(e.target.value) })}
                              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-100 disabled:text-gray-400" />
                          </div>
                        </div>

                        {(linePolicy.subscriberType === 'individual' || linePolicy.subscriberType === 'foreigner') && (
                          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                            개인·외국인은 고시 기준값이 적용됩니다. 무선 {linePolicy.subscriberType === 'foreigner' ? 2 : 3}회선 · 유선 5회선. 상한을 따로 지정할 수 없습니다.
                          </p>
                        )}
                        {linePolicy.subscriberType === 'corporate' && linePolicy.landlineLineLimit === null && (
                          <p className="text-[11px] text-gray-500">
                            법인 유선 상한은 종사자 수 확인 자료(고용보험 자료 등)를 받아 입력합니다. 비워 두면 제한이 걸리지 않습니다.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

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
                  {/* ★ 2026-07-21 문안 생성 참조 업종 — 사업자등록증 업태/종목(위)과 별개. 브랜드보이스 미등록 업체 문안 생성 시 참조 카테고리. */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">문안 생성 참조 업종</label>
                    <select value={editCompany.industryCode}
                      onChange={(e) => setEditCompany({ ...editCompany, industryCode: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                      <option value="">미지정</option>
                      {industryOptions.map((o) => (
                        <option key={o.code} value={o.code}>{o.label}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">브랜드보이스 미등록 업체의 문안 생성 시 참조하는 업종입니다. 사업자등록증 업태·종목과 무관하게 실제 판매 카테고리로 지정하세요.</p>
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
                        <option key={plan.id} value={plan.id}>{formatPlanOptionLabel(plan.plan_name, plan.monthly_price)}</option>
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
                  {/* ★ 2026-07-03 사용구분 + 에이전트 발송ID 매핑 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">사용구분 *</label>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { value: 'web', label: '웹발송', desc: '한줄로 전체 기능' },
                        { value: 'agent', label: '에이전트', desc: '카카오템플릿+결과만' },
                        { value: 'both', label: '웹+에이전트', desc: '웹 발송과 에이전트 발송을 함께 사용' },
                      ] as const).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setEditCompany({ ...editCompany, usageType: opt.value })}
                          className={`px-2 py-2 rounded-lg border text-center transition ${
                            editCompany.usageType === opt.value
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <div className="text-sm font-medium">{opt.label}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                    {editCompany.usageType === 'agent' && (
                      <p className="text-xs text-amber-600 mt-1.5">
                        에이전트 전용 계정은 로그인 시 카카오 템플릿 관리만 접근 가능합니다 (대시보드 차단). 다음 로그인부터 적용됩니다.
                      </p>
                    )}
                  </div>
                  {(editCompany.usageType === 'agent' || editCompany.usageType === 'both') && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                      <p className="text-sm font-semibold text-gray-800">에이전트 발송ID 매핑</p>
                      <p className="text-xs text-gray-500 mt-0.5 mb-2">이 회사에 속한 QTmsg 발송ID 목록. 발송량 조회·정산 합산의 기준이 됩니다.</p>
                      {agentIds.length > 0 ? (
                        <div className="space-y-1.5 mb-2">
                          {agentIds.map((a) => {
                            const costSummary = [
                              { l: 'S', v: a.cost_per_sms },
                              { l: 'L', v: a.cost_per_lms },
                              { l: 'M', v: a.cost_per_mms },
                              { l: '카카오', v: a.cost_per_kakao },
                              { l: '브랜드', v: a.cost_per_brand },
                            ].filter((c) => c.v != null && String(c.v) !== '').map((c) => `${c.l} ${Number(c.v)}`).join(' · ');
                            return (
                              <div key={a.id} className="bg-white rounded-lg border border-gray-200 px-3 py-1.5">
                                <div className="flex items-center justify-between">
                                  <div className="min-w-0 flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-mono text-gray-800">{formatAgentIdLabel(a.agent_send_id, a.cust_name)}</span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${a.billing_type === 'prepaid' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-100 text-gray-500'}`}>
                                      {a.billing_type === 'prepaid' ? '선불' : '후불'}
                                    </span>
                                    {costSummary && <span className="text-[10px] text-gray-400 tabular-nums">{costSummary}</span>}
                                    {a.memo && <span className="text-xs text-gray-400">{a.memo}</span>}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0 ml-2">
                                    <button
                                      type="button"
                                      onClick={() => (editingAgentRowId === a.id ? setEditingAgentRowId(null) : openAgentLedgerEdit(a))}
                                      className="text-xs text-blue-600 hover:text-blue-800"
                                    >
                                      설정
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveAgentId(a.id)}
                                      className="text-xs text-red-500 hover:text-red-700"
                                    >
                                      해제
                                    </button>
                                  </div>
                                </div>
                                {editingAgentRowId === a.id && (
                                  <div className="mt-1.5 rounded-lg border border-blue-200 bg-blue-50/40 p-2.5 space-y-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {(['prepaid', 'postpaid'] as const).map((bt) => (
                                        <button
                                          key={bt}
                                          type="button"
                                          onClick={() => setEditAgentLedger({ ...editAgentLedger, billingType: bt })}
                                          className={`px-2.5 py-1 rounded-lg border text-xs transition ${
                                            editAgentLedger.billingType === bt
                                              ? bt === 'prepaid'
                                                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                                                : 'border-blue-500 bg-blue-50 text-blue-700'
                                              : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                                          }`}
                                        >
                                          {bt === 'prepaid' ? '선불' : '후불'}
                                        </button>
                                      ))}
                                      <span className="text-[10px] text-gray-400">선불 지정 시 고객 대시보드 잔액 표시·충전 대상</span>
                                    </div>
                                    {/* ★ 2026-07-26 발송ID 단가도 회사 단가와 **같은 기준(VAT 별도 공급가)** 으로 해석된다.
                                        라벨 없이 두면 계약서의 VAT 포함가를 그대로 넣어 10% 과청구가 난다(Codex #7). */}
                                    <div className="rounded-lg bg-emerald-50/70 px-2 py-1.5 text-[10px] text-emerald-800">
                                      발송ID 단가도 <b>VAT 별도 공급가</b>로 입력합니다. 건별 VAT 10%는 시스템이 자동 합산합니다.
                                    </div>
                                    <div className="grid grid-cols-3 lg:grid-cols-5 gap-1.5">
                                      {([['costPerSms', 'SMS'], ['costPerLms', 'LMS'], ['costPerMms', 'MMS'], ['costPerKakao', '카카오'], ['costPerBrand', '브랜드']] as const).map(([k, label]) => {
                                        const raw = editAgentLedger[k];
                                        const pv = previewUnitPrice(raw);
                                        const empty = raw === '' || raw === null || raw === undefined;
                                        return (
                                          <div key={k}>
                                            <label className="block text-[10px] text-gray-500 mb-0.5">{label} 단가 <span className="text-emerald-700">(VAT 별도)</span></label>
                                            <input
                                              type="text"
                                              value={raw}
                                              onChange={(e) => setEditAgentLedger({ ...editAgentLedger, [k]: sanitizeCostInput(e.target.value) })}
                                              className="w-full px-2 py-1 border rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                              placeholder="미설정"
                                            />
                                            <div className="mt-0.5 text-[10px] text-emerald-700">
                                              {empty ? <span className="text-gray-400">미설정: 청구 차단</span> : <>VAT 포함 {fmtPrice(pv.withVat)}원</>}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                    <div className="flex gap-1.5">
                                      <input
                                        type="text"
                                        value={editAgentLedger.memo}
                                        onChange={(e) => setEditAgentLedger({ ...editAgentLedger, memo: e.target.value })}
                                        className="flex-1 px-2 py-1 border rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                        placeholder="메모(선택)"
                                      />
                                      <button
                                        type="button"
                                        onClick={handleSaveAgentLedger}
                                        disabled={agentLedgerSaving}
                                        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg text-xs shrink-0"
                                      >
                                        {agentLedgerSaving ? '저장 중...' : '저장'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingAgentRowId(null)}
                                        className="px-2.5 py-1 text-gray-500 hover:text-gray-700 text-xs shrink-0"
                                      >
                                        취소
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 mb-2">등록된 발송ID가 없습니다.</p>
                      )}
                      <div className="flex gap-2">
                        <input type="text" value={newAgentSendId}
                          onChange={(e) => setNewAgentSendId(e.target.value)}
                          className="flex-1 px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                          placeholder="발송ID" />
                        <input type="text" value={newAgentMemo}
                          onChange={(e) => setNewAgentMemo(e.target.value)}
                          className="w-28 px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                          placeholder="메모(선택)" />
                        <button
                          type="button"
                          onClick={handleAddAgentId}
                          disabled={agentIdSaving || !newAgentSendId.trim()}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg text-sm shrink-0"
                        >
                          {agentIdSaving ? '등록 중...' : '추가'}
                        </button>
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">구독 상태 *</label>
                    <select value={editCompany.subscriptionStatus}
                      onChange={(e) => setEditCompany({ ...editCompany, subscriptionStatus: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                      <option value="trial">체험 (trial)</option>
                      <option value="trial_expired">체험만료 (trial_expired)</option>
                      <option value="paid">정식 구독 (paid)</option>
                      <option value="active">정상 구독 (active)</option>
                      <option value="expired">만료 (expired)</option>
                      <option value="suspended">정지 (suspended)</option>
                    </select>
                    <p className="text-xs text-gray-400 mt-1">expired/suspended 시 전 기능 차단. trial_expired 는 FREE plan 자동 강등 후 마커.</p>
                  </div>
                  {/* ★ 2026-06-08: BASIC 1개월 무료체험 (PRO 체험 + AI op overlay 체험 대체) */}
                  <div className="col-span-2 rounded-lg border border-violet-200 bg-violet-50/40 p-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-semibold text-violet-900">무료체험 (베이직과 같은 기능 · 요금 0원)</p>
                        {editCompany.subscriptionStatus === 'trial' && editCompany.trialExpiresAt ? (
                          <p className="text-xs text-violet-700 mt-0.5">
                            체험 중 · 만료: <b>{new Date(editCompany.trialExpiresAt).toLocaleString('ko-KR')}</b>
                            {' '}
                            (D-{Math.max(0, Math.ceil((new Date(editCompany.trialExpiresAt).getTime() - Date.now()) / 86400000))})
                          </p>
                        ) : (
                          <p className="text-xs text-violet-600 mt-0.5">체험 미부여 상태. 부여 시 무료체험 요금제(베이직과 같은 기능·크레딧, 요금 0원) 1개월 개방, 30일 후 자동 미가입(FREE) 강등.</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleGrantBasicTrial}
                          className="px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-semibold"
                        >
                          {editCompany.subscriptionStatus === 'trial' ? '1개월 추가 부여' : '1개월 체험 부여'}
                        </button>
                        {editCompany.subscriptionStatus === 'trial' && (
                          <button
                            type="button"
                            onClick={handleRevokeBasicTrial}
                            className="px-3 py-2 bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-xs font-semibold"
                          >
                            체험 취소
                          </button>
                        )}
                      </div>
                    </div>
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">발송 라인</label>
                    <select value={editCompany.lineGroupId}
                      onChange={(e) => setEditCompany({ ...editCompany, lineGroupId: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                      <option value="">미할당 (전체 라인 사용)</option>
                      {lineGroups.filter((lg: any) => (lg.group_type === 'bulk' || lg.group_type === 'bito') && lg.is_active).map((lg: any) => (
                        <option key={lg.id} value={lg.id}>{lg.group_name} ({(lg.sms_tables || []).join(', ')})</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">대량발송 시 사용할 전용 라인그룹 (미할당 시 전체 라인 라운드로빈)</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">080 수신거부번호</label>
                    <input type="text" value={editCompany.rejectNumber}
                      onChange={(e) => setEditCompany({ ...editCompany, rejectNumber: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="080-000-0000" />
                  </div>
                  <div className="flex items-center justify-between bg-yellow-50 rounded-lg p-4 border border-yellow-200">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">💬</span>
                        <span className="font-semibold text-gray-800">카카오 브랜드메시지</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">활성화하면 해당 고객사에서 카카오 채널 발송이 가능합니다</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editCompany.kakaoEnabled}
                        onChange={(e) => setEditCompany({ ...editCompany, kakaoEnabled: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-yellow-500"></div>
                    </label>
                  </div>

                  {/* ★ D162-3 (2026-05-15) 수신거부 사용자격리 ON/OFF */}
                  <div className="flex items-center justify-between p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl mt-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">🔒</span>
                        <span className="font-semibold text-gray-800">수신거부 사용자격리</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        ON = 멀티 브랜드 회사 영역. 고객사관리자는 등록/삭제 차단(조회만 가능), 사용자가 등록한 수신거부는 관리자에게 자동 동기화.<br/>
                        OFF = 누구든 등록/삭제 가능 + 회사 전체 사용자 동일 수신거부 적용 (기본).
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editCompany.userIsolationEnabled}
                        onChange={(e) => setEditCompany({ ...editCompany, userIsolationEnabled: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                    </label>
                  </div>

                  {/* ★ D190 #2 (2026-05-22): AI Orchestrator (Tool Use) 회사별 토글 — 토글 변경 시 즉시 PATCH 호출 */}
                  <div className="flex items-start justify-between p-4 bg-violet-50 border border-violet-200 rounded-lg mt-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">🤖</span>
                        <span className="font-semibold text-gray-800">AI Orchestrator (Tool Use)</span>
                        <span className="text-xs bg-violet-500 text-white px-1.5 py-0.5 rounded">BETA</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        ON = AI Operator 동적 흐름 결정 모드 활성 (target → count → message → compliance 순서 자율 판단).<br/>
                        OFF = 기존 고정 순서 (안정 영역, default). ENT 1사 한정 활성 → PM2 로그 모니터링 후 단계적 확장 권장.
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editCompany.useAiOrchestrator}
                        onChange={async (e) => {
                          const next = e.target.checked;
                          const prev = editCompany.useAiOrchestrator;
                          setEditCompany({ ...editCompany, useAiOrchestrator: next });
                          try {
                            const token = localStorage.getItem('token');
                            const res = await fetch(`/api/admin/companies/${editCompany.id}/ai-orchestrator`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                              body: JSON.stringify({ enabled: next }),
                            });
                            const data = await res.json();
                            if (!res.ok) {
                              showAlert('오류', data?.error || 'AI Orchestrator 토글 실패', 'error');
                              setEditCompany({ ...editCompany, useAiOrchestrator: prev });
                            } else {
                              showAlert('완료', data?.message || 'AI Orchestrator 토글 완료', 'success');
                            }
                          } catch (err: any) {
                            showAlert('오류', err?.message || '네트워크 오류', 'error');
                            setEditCompany({ ...editCompany, useAiOrchestrator: prev });
                          }
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-500"></div>
                    </label>
                  </div>

                  {/* ★ 2026-06-06 자동마케팅 자율발송 게이트 — 슈퍼관리자 회사별 ON/임계값 (cdp_auto_execute_*) */}
                  <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg mt-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">🚀</span>
                          <span className="font-semibold text-gray-800">자동마케팅 자율발송 게이트</span>
                          <span className="text-xs bg-rose-500 text-white px-1.5 py-0.5 rounded">BETA</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          ON = AI 자동마케팅 제안서가 담당자 승인 없이 임계값 이내에서 <b>자율 발송</b> (회사 잔액 자동 차감 + 고객 자동 발송).<br/>
                          OFF = 제안서는 담당자 수동 승인 대기 (기본). 발신번호·무료거부(080)·잔액은 발송 직전 자동 확인.
                        </p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer ml-3">
                        <input
                          type="checkbox"
                          checked={editCompany.cdpAutoExecuteEnabled}
                          onChange={(e) => setEditCompany({ ...editCompany, cdpAutoExecuteEnabled: e.target.checked })}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-500"></div>
                      </label>
                    </div>
                    <div className={`grid grid-cols-3 gap-2 mt-3 ${editCompany.cdpAutoExecuteEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
                      <div>
                        <label className="block text-[11px] font-medium text-gray-600 mb-1">최대 수신자(명)</label>
                        <input type="number" min="1" value={editCompany.cdpAutoExecuteMaxRecipients}
                          onChange={(e) => setEditCompany({ ...editCompany, cdpAutoExecuteMaxRecipients: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 border rounded text-sm focus:ring-2 focus:ring-rose-400 outline-none" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-gray-600 mb-1">최대 회당 비용(원)</label>
                        <input type="number" min="1" value={editCompany.cdpAutoExecuteMaxCostKrw}
                          onChange={(e) => setEditCompany({ ...editCompany, cdpAutoExecuteMaxCostKrw: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 border rounded text-sm focus:ring-2 focus:ring-rose-400 outline-none" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-gray-600 mb-1">최대 위험도</label>
                        <select value={editCompany.cdpAutoExecuteMaxRisk}
                          onChange={(e) => setEditCompany({ ...editCompany, cdpAutoExecuteMaxRisk: e.target.value })}
                          className="w-full px-2 py-1.5 border rounded text-sm focus:ring-2 focus:ring-rose-400 outline-none bg-white">
                          <option value="low">low</option>
                          <option value="medium">medium</option>
                          <option value="high">high</option>
                        </select>
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          const token = localStorage.getItem('token');
                          const res = await fetch(`/api/admin/companies/${editCompany.id}/cdp-auto-execute`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                            body: JSON.stringify({
                              enabled: editCompany.cdpAutoExecuteEnabled,
                              maxRecipients: editCompany.cdpAutoExecuteMaxRecipients,
                              maxCostKrw: editCompany.cdpAutoExecuteMaxCostKrw,
                              maxRisk: editCompany.cdpAutoExecuteMaxRisk,
                            }),
                          });
                          const data = await res.json();
                          if (!res.ok) {
                            showAlert('오류', data?.error || '자율발송 게이트 저장 실패', 'error');
                          } else {
                            const cc = data.company;
                            setEditCompany({ ...editCompany,
                              cdpAutoExecuteEnabled: cc.cdp_auto_execute_enabled,
                              cdpAutoExecuteMaxRecipients: cc.cdp_auto_execute_max_recipients,
                              cdpAutoExecuteMaxCostKrw: cc.cdp_auto_execute_max_cost_krw,
                              cdpAutoExecuteMaxRisk: cc.cdp_auto_execute_max_risk,
                            });
                            showAlert('완료', data?.message || '자율발송 게이트 저장 완료', 'success');
                          }
                        } catch (err: any) {
                          showAlert('오류', err?.message || '네트워크 오류', 'error');
                        }
                      }}
                      className="mt-3 w-full py-2 bg-rose-500 hover:bg-rose-600 text-white text-sm font-medium rounded-lg transition-colors">
                      자율발송 게이트 저장
                    </button>
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
                  {/* ★ 2026-07-11 거짓 설정 정리: 일일 발송 한도·중복 방지 기간 입력 제거 —
                      발송 경로 소비처 0곳(저장만 되던 죽은 설정). 실동작 제한 = 고객사 Settings 발송 피로도 보호.
                      state/저장 통로는 하위호환 유지(editCompany.dailyLimit/duplicateDays — 기존 값 보존 전송). */}
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

                  <div className="grid grid-cols-2 gap-3">
                    {([
                      ['costPerSms', 'SMS', '단문 문자'],
                      ['costPerLms', 'LMS', '장문 문자'],
                      ['costPerMms', 'MMS', '이미지 문자'],
                      ['costPerKakao', '알림톡', '카카오 알림톡'],
                      ['costPerBrand', '브랜드메시지', '구 친구톡 · 알림톡과 별도 단가'],
                      ['costPerTestSms', '테스트 SMS', '비우면 SMS 단가'],
                      ['costPerTestLms', '테스트 LMS', '비우면 LMS 단가'],
                    ] as const).map(([key, label, hint]) => {
                      const raw = (editCompany as any)[key];
                      const p = previewUnitPrice(raw);
                      const empty = raw === '' || raw === null || raw === undefined;
                      return (
                        <div key={key} className="rounded-xl border border-gray-200 bg-white p-4">
                          <div className="mb-2 flex items-baseline justify-between">
                            <label className="text-sm font-bold text-gray-900">{label}</label>
                            <span className="text-[11px] text-gray-400">{hint}</span>
                          </div>
                          <div className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 focus-within:ring-2 focus-within:ring-emerald-500">
                            <input
                              type="number" step="0.01" min="0" inputMode="decimal"
                              value={raw as any}
                              placeholder={key.startsWith('costPerTest') ? '비우면 상속' : '0.00'}
                              onChange={(e) => setEditCompany({ ...editCompany, [key]: e.target.value === '' ? '' : e.target.value })}
                              className="w-full bg-transparent text-lg font-bold text-gray-900 outline-none"
                            />
                            <span className="shrink-0 text-xs text-gray-400">원 / 건</span>
                          </div>
                          <div className="mt-2 text-[11px] font-semibold text-emerald-700">
                            {empty
                              ? <span className="text-gray-400">미설정. 청구서 발행이 차단됩니다</span>
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
                      className="shrink-0 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {savingUnitPrices ? '저장 중...' : '단가 저장'}
                    </button>
                  </div>
                </div>
              )}

              {/* 크레딧 탭 (AI설정 → 종량제 크레딧 관리 전환) */}
              {editCompanyTab === 'ai' && (
                <div className="space-y-4">
                  {/* AI 크레딧 (종량제 Phase 4 — 모든 요금제) */}
                  <div className="bg-gradient-to-r from-violet-50 to-fuchsia-50 rounded-xl p-4 border border-violet-200">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-bold text-gray-800">AI 크레딧</div>
                      <button type="button" onClick={async () => {
                        try {
                          const token = localStorage.getItem('token');
                          const res = await fetch(`/api/admin/companies/${editCompany.id}/credit`, { headers: { Authorization: `Bearer ${token}` } });
                          if (res.ok) { const d = await res.json(); setCompanyCredit({ ...d, _forId: editCompany.id }); }
                          else { const d = await res.json().catch(() => ({})); setModal({ type: 'alert', title: '조회 실패', message: d.error || '오류', variant: 'error' }); }
                        } catch { setModal({ type: 'alert', title: '오류', message: '크레딧 조회 실패', variant: 'error' }); }
                      }} className="text-[10px] text-violet-600 hover:underline">조회 / 새로고침</button>
                    </div>
                    {companyCredit && companyCredit._forId === editCompany.id ? (
                      <>
                        {/* 총 잔여 — 큰 숫자 + 기본분/구매분 게이지 */}
                        <div className="rounded-lg border border-violet-100 bg-white/70 p-3 mb-3">
                          <div className="flex items-end justify-between">
                            <div>
                              <div className="text-[11px] text-gray-500">총 잔여</div>
                              <div className="text-2xl font-bold tabular-nums text-violet-700">
                                {Number(companyCredit.total || 0).toLocaleString()}
                                <span className="ml-1 text-xs font-normal text-gray-400">크레딧</span>
                              </div>
                            </div>
                            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                              {companyCredit.billingType === 'postpaid' ? '후불' : '선불'}
                            </span>
                          </div>
                          {(() => {
                            const base = Math.max(0, Number(companyCredit.baseRemaining || 0));
                            const pur = Math.max(0, Number(companyCredit.purchased || 0));
                            const gmax = Math.max(Number(companyCredit.planCredits || 0), base + pur, 1);
                            const bp = Math.max(0, Math.min(100, (base / gmax) * 100));
                            const pp = Math.max(0, Math.min(100 - bp, (pur / gmax) * 100));
                            return (
                              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-violet-100">
                                <div className="flex h-full">
                                  <div className="h-full bg-violet-500" style={{ width: `${bp}%` }} />
                                  <div className="h-full bg-fuchsia-400" style={{ width: `${pp}%` }} />
                                </div>
                              </div>
                            );
                          })()}
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                            <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-violet-500" /> 기본분 {Number(companyCredit.baseRemaining || 0).toLocaleString()}</span>
                            <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-fuchsia-400" /> 구매분 {Number(companyCredit.purchased || 0).toLocaleString()}</span>
                            <span className="text-gray-400">이번달 사용 {Number(companyCredit.monthlyUsed || 0).toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="flex gap-2 mb-2">
                          <button type="button" onClick={() => setCreditAdj({ ...creditAdj, type: 'grant' })}
                            className={`flex-1 py-1.5 text-xs font-medium rounded-lg ${creditAdj.type === 'grant' ? 'bg-violet-600 text-white' : 'bg-white border text-gray-600'}`}>지급</button>
                          <button type="button" onClick={() => setCreditAdj({ ...creditAdj, type: 'admin_deduct' })}
                            className={`flex-1 py-1.5 text-xs font-medium rounded-lg ${creditAdj.type === 'admin_deduct' ? 'bg-rose-600 text-white' : 'bg-white border text-gray-600'}`}>차감</button>
                        </div>
                        <div className="space-y-2">
                          <input type="number" placeholder="크레딧" value={creditAdj.amount}
                            onChange={(e) => setCreditAdj({ ...creditAdj, amount: e.target.value })}
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none" />
                          <input type="text" placeholder="사유 (필수)" value={creditAdj.reason}
                            onChange={(e) => setCreditAdj({ ...creditAdj, reason: e.target.value })}
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none" />
                          <button type="button" disabled={creditAdj.busy || !creditAdj.amount || !creditAdj.reason}
                            onClick={async () => {
                              const idemKey = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `a-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                              setCreditAdj(prev => ({ ...prev, busy: true }));
                              try {
                                const token = localStorage.getItem('token');
                                const res = await fetch(`/api/admin/companies/${editCompany.id}/credit-adjust`, {
                                  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                  body: JSON.stringify({ type: creditAdj.type, amount: Number(creditAdj.amount), reason: creditAdj.reason, idempotencyKey: idemKey })
                                });
                                const data = await res.json();
                                if (res.ok) {
                                  setCreditAdj({ type: 'grant', amount: '', reason: '', busy: false });
                                  const r2 = await fetch(`/api/admin/companies/${editCompany.id}/credit`, { headers: { Authorization: `Bearer ${token}` } });
                                  if (r2.ok) { const d2 = await r2.json(); setCompanyCredit({ ...d2, _forId: editCompany.id }); }
                                  setModal({ type: 'alert', title: '완료', message: data.message, variant: 'success' });
                                } else {
                                  setCreditAdj(prev => ({ ...prev, busy: false }));
                                  setModal({ type: 'alert', title: '실패', message: data.error, variant: 'error' });
                                }
                              } catch { setCreditAdj(prev => ({ ...prev, busy: false })); setModal({ type: 'alert', title: '오류', message: '크레딧 조정 실패', variant: 'error' }); }
                            }}
                            className={`w-full py-2.5 text-sm font-medium rounded-lg disabled:opacity-50 ${creditAdj.type === 'grant' ? 'bg-violet-600 hover:bg-violet-700 text-white' : 'bg-rose-600 hover:bg-rose-700 text-white'}`}
                          >{creditAdj.busy ? '처리 중...' : creditAdj.type === 'grant' ? '지급하기' : '차감하기'}</button>
                        </div>
                        {companyCredit.billingType === 'postpaid' && (
                          <div className="mt-3 pt-3 border-t border-violet-200">
                            <label className="text-[11px] font-bold text-gray-700">후불 추가 사용 한도 (크레딧)</label>
                            <div className="flex gap-2 mt-1">
                              <input type="number" defaultValue={Number(companyCredit.overageLimit || 0)} id="overageLimitInput"
                                className="flex-1 px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none" />
                              <button type="button" onClick={async () => {
                                const el = document.getElementById('overageLimitInput') as HTMLInputElement | null;
                                const v = Number(el?.value || 0);
                                try {
                                  const token = localStorage.getItem('token');
                                  const res = await fetch(`/api/admin/companies/${editCompany.id}/postpaid-overage-limit`, {
                                    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                    body: JSON.stringify({ overageLimit: v })
                                  });
                                  const data = await res.json();
                                  if (res.ok) { setCompanyCredit({ ...companyCredit, overageLimit: data.overageLimit }); setModal({ type: 'alert', title: '완료', message: data.message, variant: 'success' }); }
                                  else setModal({ type: 'alert', title: '실패', message: data.error, variant: 'error' });
                                } catch { setModal({ type: 'alert', title: '오류', message: '한도 설정 실패', variant: 'error' }); }
                              }} className="px-3 py-1.5 bg-violet-600 text-white text-xs rounded-lg hover:bg-violet-700">저장</button>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-xs text-gray-400 text-center py-2">위 조회 버튼으로 크레딧 현황을 불러오세요.</div>
                    )}
                  </div>

                  <div className="pt-3 mt-1 border-t border-gray-100">
                    <div className="text-[11px] font-semibold text-gray-400">AI 타겟 전략 (고급)</div>
                  </div>
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

              {/* ★ 2026-07-28 정산 탭 (필터항목 대체 — Harold 판정: 의미 없는 메뉴) — SoT §2 */}
              {editCompanyTab === 'billing' && (
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
                            className={`px-4 py-2 text-sm font-semibold transition-colors ${btSettings.issue_scope === 'combined' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                            고객사 전체 발급
                          </button>
                          <button type="button" onClick={() => setBtSettings({ ...btSettings, issue_scope: 'by_user' })}
                            className={`px-4 py-2 text-sm font-semibold transition-colors ${btSettings.issue_scope === 'by_user' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
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
                          className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
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
                            className={`shrink-0 px-2.5 py-1.5 rounded text-[11px] font-semibold border ${btCompanyContact.taxbill_biz_number ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}>
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
                          className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
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
                            className="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
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
                                    className="flex-1 px-2 py-1.5 border rounded text-xs focus:ring-1 focus:ring-indigo-500 outline-none" />
                                  <button type="button"
                                    onClick={() => { setBtBizDraft({ ...a }); setBtBizTarget(a.user_id); }}
                                    className={`shrink-0 px-2.5 py-1.5 rounded text-[11px] font-semibold border ${a.taxbill_biz_number ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
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
                        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                        {btSaving ? '저장 중...' : '정산 설정 저장'}
                      </button>
                    </>
                  )}

                  {/* 계산서 발급 사업자 등록 모달 — 회사 기본('company')과 계정별(user_id)이 같은 화면을 쓴다 */}
                  {btBizTarget && (
                    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={() => setBtBizTarget(null)}>
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
                                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2 mt-5">
                          <button type="button" onClick={() => setBtBizTarget(null)}
                            className="flex-1 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">취소</button>
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
                            className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold">적용 (저장 버튼으로 확정)</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* D41 대시보드 카드 설정 탭 */}
              {/* ★ D142+ (2026-04-29) 카드 순서 변경 기능 추가:
               *   기존: 체크박스로 선택만 가능. 새 카드 체크 시 항상 배열 끝에 추가 → 순서 조작 불가.
               *   변경: 두 영역 분리 (선택된 카드 / 추가 가능 카드)
               *         - 선택된 카드: 드래그(HTML5 native) + ↑↓ 버튼 + × 제거. 표시 순서 = 배열 순서.
               *         - 추가 가능 카드: 체크박스(추가 시 끝에 append). 미선택 카드만 표시.
               *   백엔드 변경 0건 — `company_settings.dashboard_cards` JSON 배열 순서 그대로 저장.
               */}
              {editCompanyTab === 'cards' && (() => {
                const selectedCards = dashboardCardIds
                  .map(id => dashboardCardPool.find(c => c.cardId === id))
                  .filter((c): c is { cardId: string; label: string; emoji: string; description: string } => !!c);
                const unselectedCards = dashboardCardPool.filter(c => !dashboardCardIds.includes(c.cardId));

                const moveUp = (idx: number) => {
                  if (idx === 0) return;
                  const newIds = [...dashboardCardIds];
                  [newIds[idx - 1], newIds[idx]] = [newIds[idx], newIds[idx - 1]];
                  setDashboardCardIds(newIds);
                };
                const moveDown = (idx: number) => {
                  if (idx >= dashboardCardIds.length - 1) return;
                  const newIds = [...dashboardCardIds];
                  [newIds[idx + 1], newIds[idx]] = [newIds[idx], newIds[idx + 1]];
                  setDashboardCardIds(newIds);
                };
                const removeCard = (cardId: string) => {
                  setDashboardCardIds(dashboardCardIds.filter(id => id !== cardId));
                };
                const addCard = (cardId: string) => {
                  if (dashboardCardIds.includes(cardId)) return;
                  setDashboardCardIds([...dashboardCardIds, cardId]);
                };
                const handleDrop = (targetIdx: number) => {
                  if (draggedCardIdx === null || draggedCardIdx === targetIdx) {
                    setDraggedCardIdx(null);
                    return;
                  }
                  const newIds = [...dashboardCardIds];
                  const [moved] = newIds.splice(draggedCardIdx, 1);
                  newIds.splice(targetIdx, 0, moved);
                  setDashboardCardIds(newIds);
                  setDraggedCardIdx(null);
                };

                return (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600">이 고객사의 대시보드에 표시할 카드와 순서를 설정하세요.</p>

                    {/* 안내 박스 */}
                    <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <span className="text-sm text-gray-600">
                        선택된 카드는 <strong>드래그</strong>하거나 <strong>↑↓ 버튼</strong>으로 순서를 변경할 수 있습니다. 대시보드에서 <strong>6개씩 페이징</strong>으로 표시됩니다.
                      </span>
                      <span className="text-xs text-gray-400 ml-auto whitespace-nowrap">
                        선택: <span className="font-bold text-blue-600">{dashboardCardIds.length}</span>개
                        {dashboardCardIds.length > 6 && <span className="text-gray-400 ml-1">({Math.ceil(dashboardCardIds.length / 6)}페이지)</span>}
                      </span>
                    </div>

                    {/* ===== 선택된 카드 영역 ===== */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold text-gray-800">📌 선택된 카드 ({selectedCards.length}개)</h4>
                        <span className="text-xs text-gray-400">위에서 아래 순서로 표시됩니다</span>
                      </div>
                      {selectedCards.length === 0 ? (
                        <div className="p-6 bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg text-center">
                          <p className="text-sm text-gray-500">선택된 카드가 없습니다.</p>
                          <p className="text-xs text-amber-600 mt-1">⚠️ 카드를 선택하지 않으면 고객사 대시보드에 DB현황이 표시되지 않습니다.</p>
                        </div>
                      ) : (
                        <div className="space-y-1.5 p-3 bg-blue-50/40 border border-blue-200 rounded-lg">
                          {selectedCards.map((card, idx) => {
                            const isFirst = idx === 0;
                            const isLast = idx === selectedCards.length - 1;
                            const isDragging = draggedCardIdx === idx;
                            const isPageBreak = (idx + 1) % 6 === 0 && idx !== selectedCards.length - 1;
                            return (
                              <div key={card.cardId}>
                                <div
                                  draggable
                                  onDragStart={() => setDraggedCardIdx(idx)}
                                  onDragOver={(e) => e.preventDefault()}
                                  onDrop={() => handleDrop(idx)}
                                  onDragEnd={() => setDraggedCardIdx(null)}
                                  className={`flex items-center gap-2 p-2.5 bg-white border rounded-lg transition-all cursor-move select-none ${
                                    isDragging ? 'opacity-40 border-blue-400 shadow-lg' : 'border-gray-200 hover:border-blue-300 hover:shadow-sm'
                                  }`}
                                >
                                  {/* 드래그 핸들 */}
                                  <span className="text-gray-400 text-lg leading-none flex-shrink-0" title="드래그하여 순서 변경">⋮⋮</span>
                                  {/* 순번 */}
                                  <span className="text-xs font-bold text-blue-600 w-6 text-center flex-shrink-0">{idx + 1}</span>
                                  {/* 카드 정보 */}
                                  <span className="text-base flex-shrink-0">{card.emoji}</span>
                                  <div className="flex-1 min-w-0">
                                    <span className="text-sm font-medium text-gray-800">{card.label}</span>
                                    <span className="text-xs text-gray-400 ml-2 hidden xl:inline">{card.description}</span>
                                  </div>
                                  {/* ↑ 위로 */}
                                  <button
                                    type="button"
                                    onClick={() => moveUp(idx)}
                                    disabled={isFirst}
                                    title="위로 이동"
                                    className={`w-7 h-7 flex items-center justify-center rounded transition-colors flex-shrink-0 ${
                                      isFirst ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-blue-100 hover:text-blue-700'
                                    }`}
                                  >
                                    ↑
                                  </button>
                                  {/* ↓ 아래로 */}
                                  <button
                                    type="button"
                                    onClick={() => moveDown(idx)}
                                    disabled={isLast}
                                    title="아래로 이동"
                                    className={`w-7 h-7 flex items-center justify-center rounded transition-colors flex-shrink-0 ${
                                      isLast ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-blue-100 hover:text-blue-700'
                                    }`}
                                  >
                                    ↓
                                  </button>
                                  {/* × 제거 */}
                                  <button
                                    type="button"
                                    onClick={() => removeCard(card.cardId)}
                                    title="제거"
                                    className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors flex-shrink-0"
                                  >
                                    ×
                                  </button>
                                </div>
                                {/* 페이지 구분선 (6개 단위) */}
                                {isPageBreak && (
                                  <div className="flex items-center gap-2 my-2">
                                    <div className="flex-1 h-px bg-gray-300" />
                                    <span className="text-[10px] text-gray-400 font-medium px-2">▼ {Math.floor(idx / 6) + 2}페이지 ▼</span>
                                    <div className="flex-1 h-px bg-gray-300" />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* ===== 추가 가능 카드 영역 ===== */}
                    {unselectedCards.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-800 mb-2">➕ 추가 가능한 카드 ({unselectedCards.length}개)</h4>
                        <div className="grid grid-cols-2 gap-1.5">
                          {unselectedCards.map((card) => (
                            <button
                              type="button"
                              key={card.cardId}
                              onClick={() => addCard(card.cardId)}
                              className="flex items-center gap-2 p-2 rounded-lg border bg-white border-gray-200 hover:bg-blue-50 hover:border-blue-300 transition-all text-left"
                              title="클릭하여 추가"
                            >
                              <span className="text-blue-500 text-base font-bold flex-shrink-0">+</span>
                              <span className="text-base flex-shrink-0">{card.emoji}</span>
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-gray-800">{card.label}</span>
                                <span className="text-xs text-gray-400 ml-1 hidden xl:inline">{card.description}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* 고객DB 탭 — D144 P10 (2026-05-07 정정):
                   Harold님 의도: 고객 DB 정보 출력은 제거 + 전체 삭제 기능만 유지.
                   개별/선택 삭제 + 검색/테이블/페이지네이션 제거. 전체 삭제 모달은 그대로 사용. */}
              {editCompanyTab === 'customers' && (
                <div className="space-y-3">
                  {/* 안내 + 총 고객 수만 표시 (정보 출력 없음) */}
                  <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                    <div className="text-sm font-medium text-gray-700 mb-1">고객 DB 관리</div>
                    <p className="text-xs text-gray-500">
                      등록된 고객: <span className="font-semibold text-gray-800">{adminCustPage.total.toLocaleString()}명</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      개별 고객 데이터 조회/삭제는 고객사관리자가 자기 화면에서 수행합니다. 슈퍼관리자는 전체 초기화만 가능합니다.
                    </p>
                  </div>

                  {/* 전체 삭제 (P10 정정 — 유지) */}
                  <div className="pt-3 border-t border-red-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium text-red-600">⚠️ 전체 삭제</div>
                        <p className="text-[11px] text-gray-400">이 회사의 모든 고객 및 구매내역 영구 삭제</p>
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

              {/* SyncAgent 탭 */}
              {editCompanyTab === 'sync' && (
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
                          className={`relative w-12 h-6 rounded-full transition-colors ${syncKeys.use_db_sync ? 'bg-blue-600' : 'bg-gray-300'}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${syncKeys.use_db_sync ? 'translate-x-6' : ''}`} />
                        </button>
                      </div>

                      {/* API Key 영역 */}
                      <div className={`space-y-4 ${!syncKeys.use_db_sync ? 'opacity-50 pointer-events-none' : ''}`}>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
                          <div className="flex gap-2">
                            <div className="flex-1 relative">
                              <input type="text" readOnly
                                value={syncKeys.api_key ? (syncKeyVisible ? syncKeys.api_key : '••••••••••••••••••••') : '(미발급)'}
                                className="w-full px-3 py-2 border rounded-lg bg-gray-50 text-sm font-mono pr-10"
                              />
                              {syncKeys.api_key && (
                                <button type="button" onClick={() => setSyncKeyVisible(!syncKeyVisible)}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">
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

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">API Secret</label>
                          <div className="flex gap-2">
                            <div className="flex-1 relative">
                              <input type="text" readOnly
                                value={syncKeys.api_secret ? (syncSecretVisible ? syncKeys.api_secret : '••••••••••••••••••••') : '(미발급)'}
                                className="w-full px-3 py-2 border rounded-lg bg-gray-50 text-sm font-mono pr-10"
                              />
                              {syncKeys.api_secret && (
                                <button type="button" onClick={() => setSyncSecretVisible(!syncSecretVisible)}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">
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
                        </div>

                        {/* 재발급 버튼 */}
                        <div className="pt-3 border-t">
                          {!showSyncRegenConfirm ? (
                            <button type="button" onClick={() => setShowSyncRegenConfirm(true)}
                              className="w-full px-4 py-2.5 bg-orange-50 text-orange-700 border border-orange-200 rounded-lg text-sm font-medium hover:bg-orange-100 transition">
                              API Key 재발급
                            </button>
                          ) : (
                            <div className="p-4 bg-red-50 border border-red-200 rounded-lg space-y-3">
                              <div className="text-sm text-red-700 font-medium">정말 재발급하시겠습니까?</div>
                              <p className="text-xs text-red-600">기존 API Key는 즉시 무효화됩니다. 해당 고객사의 SyncAgent가 새 키로 재설정되어야 합니다.</p>
                              <div className="flex gap-2">
                                <button type="button" onClick={() => setShowSyncRegenConfirm(false)}
                                  className="flex-1 px-3 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                                  취소
                                </button>
                                <button type="button" onClick={handleSyncRegenerate}
                                  className="flex-1 px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">
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
                      className="w-full px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50">
                      닫기
                    </button>
                  </div>
                </div>
              )}

              {editCompanyTab !== 'customers' && editCompanyTab !== 'sync' && (
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

      {/* SMS 상세 조회 모달 */}
      {smsDetailModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden animate-in fade-in zoom-in" style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            {/* 헤더 */}
            <div className="px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-white flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">📨 발송 상세 내역</h3>
                {smsDetailCampaign && (
                  <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500">
                    <span>{smsDetailCampaign.company_name} ({smsDetailCampaign.created_by_login || '-'})</span>
                    <span>•</span>
                    <span className="font-medium text-gray-700">{smsDetailCampaign.campaign_name}</span>
                    <span>•</span>
                    <span>{resolveChannelLabel(smsDetailCampaign)}</span>
                    <span>•</span>
                    <span className={`font-medium ${smsDetailCampaign.status === 'completed' ? 'text-green-600' : smsDetailCampaign.status === 'scheduled' ? 'text-blue-600' : 'text-gray-600'}`}>
                      {smsDetailCampaign.status === 'completed' ? '완료' : smsDetailCampaign.status === 'scheduled' ? '예약' : smsDetailCampaign.status === 'sending' ? '발송중' : smsDetailCampaign.status === 'cancelled' ? '취소' : smsDetailCampaign.status}
                    </span>
                  </div>
                )}
              </div>
              <button onClick={() => setSmsDetailModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">✕</button>
            </div>

            {/* 필터 */}
            <div className="px-6 py-3 border-b bg-gray-50 flex flex-wrap gap-3 items-center flex-shrink-0">
              <select value={smsDetailStatus} onChange={(e) => setSmsDetailStatus(e.target.value)}
                className="px-3 py-1.5 border rounded-lg text-sm bg-white">
                <option value="">전체 결과</option>
                <option value="success">성공</option>
                <option value="fail">실패</option>
                <option value="pending">대기</option>
              </select>
              <select value={smsDetailSearchType} onChange={(e) => setSmsDetailSearchType(e.target.value)}
                className="px-3 py-1.5 border rounded-lg text-sm bg-white">
                <option value="dest_no">수신번호</option>
                <option value="call_back">회신번호</option>
              </select>
              <input type="text" value={smsDetailSearchValue} onChange={(e) => setSmsDetailSearchValue(e.target.value)}
                placeholder="번호 검색..." className="w-40 px-3 py-1.5 border rounded-lg text-sm"
                onKeyDown={(e) => e.key === 'Enter' && smsDetailCampaign && loadSmsDetail(smsDetailCampaign.id, 1)} />
              <button onClick={() => smsDetailCampaign && loadSmsDetail(smsDetailCampaign.id, 1)}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">검색</button>
              <div className="ml-auto flex items-center gap-3">
                {/* ★ 2026-06-15: 슈퍼관리자 상세 엑셀 다운로드 (현재 상태 필터 그대로, 사용자 export와 동일 CT) */}
                <button
                  onClick={async () => {
                    if (!smsDetailCampaign) return;
                    const token = localStorage.getItem('token');
                    const params = new URLSearchParams();
                    if (smsDetailStatus) params.set('status', smsDetailStatus);
                    try {
                      const res = await fetch(`/api/admin/campaigns/${smsDetailCampaign.id}/sms-detail/export?${params.toString()}`, {
                        headers: { Authorization: `Bearer ${token}` },
                      });
                      if (!res.ok) { const err = await res.json().catch(() => ({})); showAlert('오류', (err as any).error || '다운로드 실패', 'error'); return; }
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `발송상세_${smsDetailCampaign.campaign_name || smsDetailCampaign.id}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch { showAlert('오류', '다운로드 중 오류가 발생했습니다.', 'error'); }
                  }}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700">
                  엑셀 다운로드
                </button>
                <span className="text-sm text-gray-500">총 {smsDetailTotal.toLocaleString()}건</span>
              </div>
            </div>

            {/* 테이블 */}
            <div className="overflow-auto flex-1">
              {smsDetailLoading ? (
                <div className="flex items-center justify-center py-20 text-gray-400">
                  <svg className="animate-spin h-6 w-6 mr-2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="60" strokeLinecap="round" /></svg>
                  조회 중...
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 whitespace-nowrap">No.</th>
                      <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 whitespace-nowrap">등록일시</th>
                      <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 whitespace-nowrap">발송일시</th>
                      <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 whitespace-nowrap">유형</th>
                      <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 whitespace-nowrap">수신번호</th>
                      <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 whitespace-nowrap">회신번호</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 whitespace-nowrap">메시지 내용</th>
                      <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 whitespace-nowrap">타입</th>
                      <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 whitespace-nowrap">통신사</th>
                      <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 whitespace-nowrap">결과</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {smsDetailRows.length === 0 ? (
                      <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                        {smsDetailCampaign?.status === 'scheduled' ? '아직 발송 전입니다.' : '발송 내역이 없습니다.'}
                      </td></tr>
                    ) : smsDetailRows.map((r: any, idx: number) => (
                      <tr key={r.seqno} className="hover:bg-blue-50/30">
                        <td className="px-3 py-2 text-center text-xs text-gray-400">{(smsDetailPage - 1) * 50 + idx + 1}</td>
                        {/* ★ D124: 등록일시 = 캠페인 created_at (모든 행 동일) */}
                        <td className="px-3 py-2 text-center text-xs text-gray-500 whitespace-nowrap">{smsDetailCampaign?.created_at ? new Date(smsDetailCampaign.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                        {/* ★ 발송일시 = sendreqTime(발송요청/예약 시각, KST) — 목록·통계와 동일 기준(D233+). mobsendTime(통신사 응답)은 지연 시 다음날·대기 시 빈칸이라 불일치 */}
                        <td className="px-3 py-2 text-center text-xs text-gray-500 whitespace-nowrap">{r.sendreqTime ? new Date(r.sendreqTime).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                        <td className="px-3 py-2 text-center text-xs text-gray-600 whitespace-nowrap">{r.sendType || '-'}</td>
                        <td className="px-3 py-2 text-center text-gray-700 font-mono text-xs hover:text-blue-600 cursor-pointer" style={{ userSelect: 'text' }} title="클릭하면 복사" onClick={() => { if (r.destNo) { navigator.clipboard.writeText(String(r.destNo)); showAlert('복사 완료', '수신번호를 복사했습니다.', 'success'); } }}>{r.destNo}</td>
                        <td className="px-3 py-2 text-center text-gray-500 font-mono text-xs hover:text-blue-600 cursor-pointer" style={{ userSelect: 'text' }} title="클릭하면 복사" onClick={() => { if (r.callBack) { navigator.clipboard.writeText(String(r.callBack)); showAlert('복사 완료', '회신번호를 복사했습니다.', 'success'); } }}>{r.callBack}</td>
                        <td className="px-3 py-2 text-gray-700 text-xs max-w-xs">
                          <div
                            className="truncate cursor-pointer hover:text-blue-600 hover:underline"
                            title="클릭하면 전체 메시지 + 복사"
                            onClick={() => r.msgContents && setSmsDetailMsgModal(r.msgContents)}
                          >
                            {r.msgContents ? (r.msgContents.length > 40 ? r.msgContents.substring(0, 40) + '…' : r.msgContents) : '-'}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center text-xs text-gray-600">{r.msgType}</td>
                        <td className="px-3 py-2 text-center text-xs text-gray-600">{r.carrier}</td>
                        <td className="px-3 py-2 text-center">
                          {/* ★ 2026-06-13: 발송 예약(미발송) 행은 파란 칩 — 결과 대기와 구분 */}
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                            r.statusType === 'success' ? 'bg-green-100 text-green-700' :
                            r.statusType === 'scheduled' ? 'bg-blue-100 text-blue-700' :
                            r.statusType === 'pending' ? 'bg-amber-100 text-amber-700' :
                            'bg-red-100 text-red-700'
                          }`}>{r.statusText}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* 하단 페이징 */}
            {smsDetailTotal > 50 && (
              <div className="px-6 py-3 border-t bg-gray-50 flex items-center justify-between flex-shrink-0">
                <span className="text-xs text-gray-500">{smsDetailPage} / {Math.ceil(smsDetailTotal / 50)} 페이지</span>
                <div className="flex gap-1">
                  <button onClick={() => smsDetailCampaign && loadSmsDetail(smsDetailCampaign.id, Math.max(1, smsDetailPage - 1))}
                    disabled={smsDetailPage === 1}
                    className="px-3 py-1 rounded border text-xs disabled:opacity-40 hover:bg-white">◀ 이전</button>
                  <button onClick={() => smsDetailCampaign && loadSmsDetail(smsDetailCampaign.id, Math.min(Math.ceil(smsDetailTotal / 50), smsDetailPage + 1))}
                    disabled={smsDetailPage >= Math.ceil(smsDetailTotal / 50)}
                    className="px-3 py-1 rounded border text-xs disabled:opacity-40 hover:bg-white">다음 ▶</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ★ D144 후속: 발송 상세 내역 모달 메시지 셀 클릭 시 표시 + 복사 */}
      <MessageDetailModal
        content={smsDetailMsgModal}
        onClose={() => setSmsDetailMsgModal(null)}
      />

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
                {/* ★ D145 P3 (2026-05-07): SearchableSelect 적용 — 162개+ 고객사 스크롤 대신 입력으로 검색 */}
                <SearchableSelect
                  options={companies.map((company) => ({
                    value: company.id,
                    label: `${company.company_name} (${company.company_code})`,
                  }))}
                  value={newCallback.companyId}
                  onChange={(value) => setNewCallback({ ...newCallback, companyId: value })}
                  placeholder="고객사 선택 또는 입력 검색..."
                  required
                  className="w-full"
                />
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

      {/* 발신번호 등록 신청 상세 모달 */}
      {showSenderRegDetailModal && senderRegDetail && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-800">발신번호 등록 신청 상세</h3>
              <button onClick={() => { setShowSenderRegDetailModal(false); setSenderRegDetail(null); }} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="p-6 space-y-5 overflow-y-auto">
              {/* 기본 정보 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-xs text-gray-500 block">고객사</span>
                  <span className="text-sm font-medium text-gray-900">{senderRegDetail.company_name || '-'}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">발신번호</span>
                  <span className="text-sm font-mono font-medium text-gray-900">{senderRegDetail.phone}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">별칭</span>
                  <span className="text-sm text-gray-700">{senderRegDetail.label || '-'}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">매장</span>
                  <span className="text-sm text-gray-700">{senderRegDetail.store_name || '-'}{senderRegDetail.store_code ? ` (${senderRegDetail.store_code})` : ''}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">신청자</span>
                  <span className="text-sm text-gray-700">{senderRegDetail.requested_by_name || '-'}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">신청일</span>
                  <span className="text-sm text-gray-700">{formatDateTime(senderRegDetail.created_at)}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-xs text-gray-500 block">상태</span>
                  <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium mt-0.5 ${
                    senderRegDetail.status === 'pending' ? 'bg-yellow-100 text-yellow-800'
                    : senderRegDetail.status === 'approved' ? 'bg-green-100 text-green-800'
                    : 'bg-red-100 text-red-800'
                  }`}>
                    {senderRegDetail.status === 'pending' ? '승인 대기' : senderRegDetail.status === 'approved' ? '승인 완료' : '반려'}
                  </span>
                </div>
              </div>

              {/* 요청 메모 */}
              {senderRegDetail.request_note && (
                <div>
                  <span className="text-xs text-gray-500 block mb-1">신청 메모</span>
                  <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{senderRegDetail.request_note}</p>
                </div>
              )}

              {/* 첨부 문서 */}
              <div>
                <span className="text-xs text-gray-500 block mb-2">첨부 문서</span>
                {(senderRegDetail.documents || []).length === 0 ? (
                  <p className="text-sm text-gray-400">첨부된 문서가 없습니다.</p>
                ) : (
                  <div className="space-y-2">
                    {(senderRegDetail.documents || []).map((doc: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                        <div>
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium mr-2 ${
                            doc.type === 'telecom_cert' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                          }`}>
                            {doc.type === 'telecom_cert' ? '통신가입증명원' : '위임장'}
                          </span>
                          <span className="text-sm text-gray-700">{doc.originalName}</span>
                          {doc.fileSize && <span className="text-xs text-gray-400 ml-2">({(doc.fileSize / 1024).toFixed(0)}KB)</span>}
                        </div>
                        <button
                          onClick={() => downloadSenderDoc(doc.storedName, doc.originalName)}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                        >
                          다운로드
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 반려 사유 (반려된 경우) */}
              {senderRegDetail.status === 'rejected' && senderRegDetail.reject_reason && (
                <div>
                  <span className="text-xs text-gray-500 block mb-1">반려 사유</span>
                  <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{senderRegDetail.reject_reason}</p>
                </div>
              )}

              {/* 승인/반려 액션 (pending일 때만) */}
              {senderRegDetail.status === 'pending' && (
                <div className="border-t pt-5 space-y-4">
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleApproveSenderReg(senderRegDetail.id)}
                      className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium text-sm"
                    >
                      승인 (발신번호 등록)
                    </button>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">반려 사유</label>
                    <textarea
                      value={rejectReasonInput}
                      onChange={(e) => setRejectReasonInput(e.target.value)}
                      placeholder="반려 사유를 입력해주세요..."
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-red-500 outline-none resize-none"
                      rows={2}
                    />
                    <button
                      onClick={() => handleRejectSenderReg(senderRegDetail.id)}
                      className="mt-2 w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium text-sm"
                    >
                      반려
                    </button>
                  </div>
                </div>
              )}
            </div>
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">월 AI 크레딧</label>
                <input
                  type="number"
                  value={editingPlan.ai_credits_per_month ?? ''}
                  onChange={(e) => setEditingPlan({ ...editingPlan, ai_credits_per_month: e.target.value === '' ? null : Number(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-violet-500 outline-none"
                  min="0"
                  placeholder="비워두면 크레딧 차감 미적용 (NULL)"
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
                            <th className="px-4 py-2.5 text-center text-gray-600 font-medium">타입</th>
                            <th className="px-4 py-2.5 text-left text-gray-600 font-medium">메시지내용</th>
                            <th className="px-4 py-2.5 text-center text-gray-600 font-medium">등록일시</th>
                            <th className="px-4 py-2.5 text-center text-gray-600 font-medium">발송일시</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {statsDetail.campaigns?.length === 0 ? (
                            <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">데이터가 없습니다.</td></tr>
                          ) : statsDetail.campaigns?.map((c: any, idx: number) => (
                            <tr key={idx} className="hover:bg-white">
                              <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[200px] truncate" title={c.campaign_name}>
                                {c.campaign_name}
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${resolveSendTypeChipClass(c.send_type)}`}>
                                  {resolveSendTypeLabel(c.send_type)}
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
                                  {resolveChannelLabel(c)}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-left text-xs text-gray-600 max-w-[250px]">
                                {c.message_content ? (
                                  (() => {
                                    // ★ B2: 컨트롤타워 — opt_out_080_number 기반 (광고)+080 부착
                                    const fullMsg = formatCampaignMessageForDisplay(c);
                                    return (
                                      <div
                                        className="truncate cursor-pointer hover:text-blue-600"
                                        title="클릭하여 전체 메시지 보기"
                                        onClick={() => setMessageDetailContent({ name: c.campaign_name, content: fullMsg })}
                                      >
                                        {fullMsg.substring(0, 50)}{fullMsg.length > 50 ? '...' : ''}
                                      </div>
                                    );
                                  })()
                                ) : '-'}
                              </td>
                              <td className="px-4 py-2.5 text-center text-gray-500 font-mono text-xs">
                                {c.created_at ? new Date(c.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                              </td>
                              <td className="px-4 py-2.5 text-center text-gray-500 font-mono text-xs">
                                {/* ★ 2026-06-13: 예약 우선 — 예약 캠페인 sent_at은 등록 시점 값(0609 교훈) */}
                                {(c.scheduled_at || c.sent_at) ? new Date(c.scheduled_at || c.sent_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
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
      {/* ★ D102: 메시지 내용 상세 모달 */}
      {messageDetailContent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-5 pb-3 border-b bg-gray-50 rounded-t-2xl flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-gray-900">메시지 내용</h3>
                <p className="text-xs text-gray-500 mt-0.5">{messageDetailContent.name}</p>
              </div>
              <button onClick={() => setMessageDetailContent(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
            </div>
            <div className="p-6 whitespace-pre-wrap break-words text-sm text-gray-700">{messageDetailContent.content}</div>
          </div>
        </div>
      )}
      {/* ★2026-08-16 토스트를 정산 탭 밖으로 올린다 — 탭 안에 있으면 다른 탭(신규마케팅진단 등)에서
          성공·실패 메시지가 통째로 안 보인다(눌러도 아무 반응 없는 것처럼 보이던 원인). fixed 배치라 위치 무변경. */}
      {billingToast && (
        <div className={`fixed top-6 right-6 z-[10000] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${
          billingToast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        }`}>
          {billingToast.msg}
        </div>
      )}
      {activeTab === 'billing' && (
        <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
          {/* ===== 1. 정산 생성 ===== */}
          <div className="px-6 py-5 border-b">
            <h3 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              정산 생성
            </h3>
            <div className="flex flex-wrap items-end gap-4">
              {/* 고객사 — ★ D150-5 (2026-05-09) PDF #2: SearchableSelect 적용 */}
              <div className="min-w-[200px]">
                <label className="block text-xs font-medium text-gray-500 mb-1">고객사</label>
                <SearchableSelect
                  options={companies.map((c: any) => ({
                    value: c.id,
                    label: c.company_name,
                  }))}
                  value={billingCompanyId}
                  onChange={(value) => setBillingCompanyId(value)}
                  placeholder="고객사 선택 또는 입력 검색..."
                  className="w-full"
                />
              </div>
              {/* 시작일 */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">시작일</label>
                {/* ★ 2026-08-20 기간을 바꾸면 정산월 명시 선택을 초기화한다(Codex 1R medium 수용) —
                    선택은 그 기간에 대한 것이다. 남겨 두면 옛 선택이 나중 기간에서 조용히 되살아난다. */}
                <input type="date" value={billingStart} onChange={e => { setBillingStart(e.target.value); setBillingLabelMonth(''); }}
                  className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              {/* 종료일 */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">종료일</label>
                <input type="date" value={billingEnd} onChange={e => { setBillingEnd(e.target.value); setBillingLabelMonth(''); }}
                  className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              {/* ★ 2026-08-20 정산월(라벨) — 서수란 0819 접수. 역월 정산은 표시만(입력 없음),
                  기간이 두 역월에 걸치는 중간정산에서만 선택이 나타난다(기본 종료월). */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">정산월</label>
                {billingLabelOptions.length > 1 ? (
                  <select value={billingLabelEffective} onChange={e => setBillingLabelMonth(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white">
                    {billingLabelOptions.map(ym => <option key={ym} value={ym}>{billingLabelText(ym)}</option>)}
                  </select>
                ) : (
                  <div className="px-3 py-2 text-sm text-gray-600">{billingLabelText(billingLabelEffective) || '—'}</div>
                )}
              </div>
              {/* 발행 단위 */}
              <div className="flex items-center gap-3 pb-0.5">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" checked={billingScope === 'company'} onChange={() => setBillingScope('company')} className="accent-indigo-600" />
                  고객사 전체
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" checked={billingScope === 'user'} onChange={() => setBillingScope('user')} className="accent-indigo-600" />
                  계정별
                </label>
              </div>
              {/* ★ 2026-07-26 계정 선택 폐기 — 단일 계정 발행은 테스트·스팸·에이전트·크레딧이 빠진
                  청구서를 만들어 서버가 차단한다. 계정별 = 회사 전체를 계정 장 N + 공통 장 1로 발행. */}
              {billingScope === 'user' && (
                <div className="text-xs text-gray-500 pb-1 max-w-[240px]">
                  회사 전체가 <strong>계정 장 + 공통 장 묶음</strong>으로 발행됩니다.
                  테스트·스팸필터·에이전트·AI 크레딧·요금제는 공통 장에 담깁니다.
                </div>
              )}
              {/* 생성 버튼 */}
              <button
                onClick={openBillingGenerateConfirm}
                disabled={generating}
                className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {generating ? '생성 중...' : '정산 생성'}
              </button>
            </div>
          </div>

          {/* ===== 1.5 거래내역서 일괄발급 (★2026-07-28 — SoT §3) ===== */}
          <div className="px-6 py-5 border-b">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
              <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                <svg className="w-5 h-5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 13l-7 7-7-7m14-8l-7 7-7-7" />
                </svg>
                거래내역서 일괄발급
              </h3>
              <div className="flex items-center gap-2">
                <input type="month" value={bulkMonth}
                  onChange={(e) => {
                    // ★ Codex 1R·2R HIGH 수용 — 월을 바꾸면 담긴 목록·조회 결과를 비우고,
                    //   ref·시퀀스를 올려 진행 중이던 옛 월 응답·낡은 클로저를 전부 무효화한다.
                    setBulkMonth(e.target.value);
                    bulkMonthRef.current = e.target.value;
                    bulkReqSeqRef.current++;
                    setBulkList(null); setBulkSelected([]); setBulkCombined([]); setBulkByUser([]); setBulkPage(1);
                    setBulkPickedSel([]); setBulkManualRows([]); setBulkManualOpen(false); setBulkManualAsk(null);
                  }}
                  className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none" />
                {/* ★ 2026-08-05 (서수란 접수) 재클릭이 닫히지 않던 것 — 옆 [세금계산서·컨펌 현황]만 토글이었다.
                    닫을 때는 목록만 감춘다(담아 둔 회사는 그대로 두고, 다시 열 때 `refreshBulkList`가 살린다).
                    `loadBulkList`는 keepPicked=false라 재클릭이 담긴 목록까지 지웠다 — 그래서 여기서 쓰지 않는다. */}
                <button onClick={() => { if (bulkList !== null) { setBulkList(null); return; } refreshBulkList(); }} disabled={bulkListLoading}
                  className={`px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 ${bulkList !== null ? 'bg-slate-700 text-white hover:bg-slate-800' : 'bg-violet-600 text-white hover:bg-violet-700'}`}>
                  {bulkListLoading ? '조회 중...' : bulkList !== null ? '미발급 대상 닫기' : '미발급 대상 불러오기'}
                </button>
                <button onClick={() => { const next = !confirmBoardOpen; setConfirmBoardOpen(next); if (next) loadConfirmBoard(); }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border ${confirmBoardOpen ? 'bg-slate-700 text-white border-slate-700' : 'text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                  세금계산서·컨펌 현황
                </button>
                {/* ★ 2026-07-30 추가 청구(080 매핑·KT 명세서·부가서비스 수기) + 최소과금 정액 발행 (서수란 접수) */}
                <button onClick={() => setBilling080Open(true)}
                  className="px-4 py-2 rounded-lg text-sm font-medium border text-slate-600 border-slate-300 hover:bg-slate-50">
                  추가 청구 관리
                </button>
                <button onClick={() => setMinChargeOpen(true)}
                  className="px-4 py-2 rounded-lg text-sm font-medium border text-slate-600 border-slate-300 hover:bg-slate-50">
                  최소과금
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-4">후불이면서 대상월 거래내역서가 아직 발급되지 않은 회사만 나옵니다. 담으면 정산 탭의 발행 단위대로 좌우에 앉고, 발급 시 이메일 등록 회사는 자동 발송·컨펌 흐름까지 이어집니다.</p>

            {/* ★ 2026-07-30 추가 청구(080·부가서비스) + 최소과금 (서수란 접수) */}
            <Billing080Modal open={billing080Open} onClose={() => setBilling080Open(false)}
              companies={companies.map((c) => ({ id: c.id, company_name: c.company_name }))} />
            <MinimumChargeModal open={minChargeOpen} onClose={() => setMinChargeOpen(false)}
              companies={companies.map((c) => ({ id: c.id, company_name: c.company_name }))}
              onChanged={() => { if (bulkList !== null) loadBulkList(); }} />
            {/* ★ 2026-08-04 수량 수정 발행 — 정산 목록 각 행의 [수량 조정]에서 연다 */}
            <QtyAdjustModal open={qtyAdjustTarget !== null} target={qtyAdjustTarget}
              onClose={() => setQtyAdjustTarget(null)}
              onReissued={() => { setQtyAdjustTarget(null); loadBillings(); }} />
            {/* ★ 2026-08-05 총 정산표 — 읽기 전용 집계. 진입점은 위 [총 정산표](ceo 전용) */}
            <SettlementOverviewModal show={showSettlementOverview} onClose={() => setShowSettlementOverview(false)} />

            {bulkList !== null && (() => {
              const picked = bulkPickedIds();
              const avail = bulkList.filter((c) => !picked.has(c.id));
              // ★ 2026-07-29 2열 · 페이지당 20 — 한 줄에 회사명뿐이라 화면 절반이 늘 비어 있었다.
              //   박스 높이는 그대로 두고 담는 용량만 2배로 늘린다(91개사 = 10페이지 → 5페이지).
              const PAGE = 20;
              const totalPages = Math.max(1, Math.ceil(avail.length / PAGE));
              const page = Math.min(bulkPage, totalPages);
              const visible = avail.slice((page - 1) * PAGE, page * PAGE);
              // 전체 담기에 실제로 담기는 것 — 수동 정산 + ★2026-07-30 최소과금 회사 제외(정액 발행 모달이 청구 경로).
              //   ★2026-08-06 해지는 **서버 목록에서 이미 빠진다**(Harold 지시) — 이 필터는 방어로만 남긴다.
              const availAuto = avail.filter((c) => c.manual_billing !== true && c.min_charge_supply == null && c.status !== 'terminated');
              const availManual = avail.length - availAuto.length;
              const pageIds = visible.map((c) => c.id);
              const pageAllChecked = pageIds.length > 0 && pageIds.every((id) => bulkSelected.includes(id));
              return (
                <div className="space-y-4">
                  {/* 상단 — 미발급 후불 리스트 (2열 · 페이징) */}
                  <div className="border rounded-lg">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-gray-50 rounded-t-lg">
                      <div className="flex items-center gap-2 min-w-0">
                        <label className="flex items-center gap-1.5 cursor-pointer shrink-0" title="이 페이지 전체 선택">
                          <input type="checkbox" checked={pageAllChecked} disabled={pageIds.length === 0}
                            onChange={() => setBulkSelected((prev) => pageAllChecked
                              ? prev.filter((x) => !pageIds.includes(x))
                              : Array.from(new Set([...prev, ...pageIds])))}
                            className="w-4 h-4 accent-indigo-600" />
                          <span className="text-[11px] text-gray-500">이 페이지</span>
                        </label>
                        <p className="text-xs font-semibold text-gray-600 truncate">
                          미발급 후불 {avail.length}개사 {bulkList.length !== avail.length ? `(담김 ${bulkList.length - avail.length})` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setBulkManualAsk([...bulkSelected])} disabled={bulkSelected.length === 0 || bulkManualBusy}
                          className="px-3 py-1.5 border border-amber-300 text-amber-700 bg-amber-50 rounded text-xs font-semibold hover:bg-amber-100 disabled:opacity-40">
                          선택 수동 정산완료 ({bulkSelected.length})
                        </button>
                        <button onClick={bulkAddSelected} disabled={bulkSelected.length === 0}
                          className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs font-semibold disabled:opacity-40">
                          선택 담기 ({bulkSelected.length})
                        </button>
                        <button onClick={bulkAddAll} disabled={availAuto.length === 0}
                          className="px-3 py-1.5 bg-violet-600 text-white rounded text-xs font-semibold hover:bg-violet-700 disabled:opacity-40">
                          전체 {availAuto.length}개사 담기{availManual > 0 ? ` (수동·최소과금 ${availManual} 제외)` : ''}
                        </button>
                      </div>
                    </div>
                    {avail.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-6">{bulkList.length === 0 ? '이 달 미발급 후불 회사가 없습니다.' : '전부 담았습니다.'}</p>
                    ) : (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 md:[&>*:nth-child(even)]:border-l">
                          {visible.map((c) => (
                            <label key={c.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 border-b">
                              <input type="checkbox" checked={bulkSelected.includes(c.id)}
                                onChange={() => setBulkSelected((prev) => prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id])}
                                className="w-4 h-4 shrink-0 accent-indigo-600" />
                              {/* min-w-0 = 2열 폭에서 긴 회사명이 뱃지를 밀어내지 않게 (flex-1만으로는 줄지 않는다) */}
                              <span className="text-sm text-gray-800 flex-1 min-w-0 truncate">{c.company_name}</span>
                              {c.manual_billing === true && (
                                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">수동 정산</span>
                              )}
                              {/* ★ 2026-07-30 최소과금 회사 — 담기에서 빠지고 최소과금 모달에서 정액 발행 */}
                              {c.min_charge_supply != null && (
                                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-semibold">최소과금</span>
                              )}
                              {/* ★ 2026-08-04 해지 회사 — 전체 담기에서 빠진다. 남은 미청구분이 있으면 개별로 담는다 */}
                              {c.status === 'terminated' && (
                                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-semibold">해지</span>
                              )}
                              <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${c.issue_scope === 'by_user' ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-500'}`}>
                                {c.issue_scope === 'by_user' ? '계정별' : '전체'}
                              </span>
                              {c.taxbill_day_policy === 'manual' && (
                                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">날짜 직접선택</span>
                              )}
                              {!c.company_contact_email && (
                                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-600">이메일 미등록</span>
                              )}
                              {c.issue_scope === 'by_user' && Number(c.missing_account_emails) > 0 && (
                                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-600">계정 메일 {c.missing_account_emails}건 미등록</span>
                              )}
                            </label>
                          ))}
                        </div>
                        {totalPages > 1 && (
                          <div className="flex items-center justify-center gap-2 py-2">
                            <button onClick={() => setBulkPage(Math.max(1, page - 1))} disabled={page <= 1}
                              className="px-2 py-1 text-xs text-gray-500 disabled:opacity-30">이전</button>
                            <span className="text-xs text-gray-500">{page} / {totalPages}</span>
                            <button onClick={() => setBulkPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
                              className="px-2 py-1 text-xs text-gray-500 disabled:opacity-30">다음</button>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* 수동 정산완료 목록 — 목록에서 빠진 회사가 어디로 갔는지 여기서 설명된다(해제하면 되돌아온다) */}
                  {bulkManualRows.length > 0 && (
                    <div className="border border-amber-200 rounded-lg bg-amber-50/40">
                      <button onClick={() => setBulkManualOpen(!bulkManualOpen)}
                        className="w-full flex items-center justify-between px-3 py-2 text-left">
                        <span className="text-xs font-semibold text-amber-800">수동 정산완료 {bulkManualRows.length}개사: 이 달 목록에서 빠져 있습니다</span>
                        <span className="text-[11px] text-amber-700">{bulkManualOpen ? '접기' : '보기'}</span>
                      </button>
                      {bulkManualOpen && (
                        <div className="divide-y divide-amber-100 border-t border-amber-200 max-h-60 overflow-y-auto">
                          {bulkManualRows.map((m) => (
                            <div key={m.id} className="flex items-center gap-2 px-3 py-1.5">
                              <span className="text-sm text-gray-800 shrink-0">{m.company_name}</span>
                              <span className="text-[11px] text-gray-500 flex-1 min-w-0 truncate">{m.reason || '사유 없음'}</span>
                              <button onClick={() => handleManualRelease(m.id)} disabled={bulkManualBusy}
                                className="shrink-0 text-[11px] text-amber-700 hover:underline disabled:opacity-40">해제</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 담긴 목록 선택 빼기 — 전체 담기 뒤 몇 곳만 빼는 흐름. 행마다 [빼기] 하나로는 91건에서 쓸 수 없다 */}
                  {(bulkCombined.length + bulkByUser.length) > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-gray-500">담김 {bulkCombined.length + bulkByUser.length}개사. 체크해서 한 번에 뺄 수 있습니다.</p>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setBulkPickedSel(
                          bulkPickedSel.length === bulkCombined.length + bulkByUser.length
                            ? []
                            : [...bulkCombined, ...bulkByUser].map((c) => c.id))}
                          className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded text-xs font-semibold hover:bg-gray-50">
                          {bulkPickedSel.length === bulkCombined.length + bulkByUser.length ? '전체 해제' : '전체 선택'}
                        </button>
                        <button onClick={bulkRemoveSelected} disabled={bulkPickedSel.length === 0}
                          className="px-3 py-1.5 border border-rose-300 text-rose-600 bg-rose-50 rounded text-xs font-semibold hover:bg-rose-100 disabled:opacity-40">
                          선택 빼기 ({bulkPickedSel.length})
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 좌우 배치 — 전량 담으면 수십~백 행이라 pane 안에서 스크롤한다(발급 시작 버튼이 화면 밖으로 밀리지 않게) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="border rounded-lg">
                      <p className="px-3 py-2 bg-indigo-50 text-xs font-semibold text-indigo-700 rounded-t-lg">고객사 전체 발급 ({bulkCombined.length})</p>
                      <div className="divide-y min-h-[60px] max-h-80 overflow-y-auto">
                        {bulkCombined.length === 0 && <p className="text-xs text-gray-300 text-center py-4">비어 있음</p>}
                        {bulkCombined.map((c) => (
                          <div key={c.id} className="flex items-center gap-2 px-3 py-1.5">
                            <input type="checkbox" checked={bulkPickedSel.includes(c.id)}
                              onChange={() => setBulkPickedSel((prev) => prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id])}
                              className="w-4 h-4 shrink-0 accent-rose-600" />
                            <span className="text-sm text-gray-800 flex-1 min-w-0 truncate">{c.company_name}</span>
                            {!c.company_contact_email && <span className="shrink-0 text-[10px] text-rose-500">메일 없음</span>}
                            <button onClick={() => bulkMoveToByUser(c.id)} className="shrink-0 text-[11px] text-sky-600 hover:underline">계정별 ▶</button>
                            <button onClick={() => bulkRemove(c.id)} className="shrink-0 text-[11px] text-gray-400 hover:text-rose-500">빼기</button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="border rounded-lg">
                      <p className="px-3 py-2 bg-sky-50 text-xs font-semibold text-sky-700 rounded-t-lg">계정별 발급 ({bulkByUser.length})</p>
                      <div className="divide-y min-h-[60px] max-h-80 overflow-y-auto">
                        {bulkByUser.length === 0 && <p className="text-xs text-gray-300 text-center py-4">비어 있음</p>}
                        {bulkByUser.map((c) => (
                          <div key={c.id} className="flex items-center gap-2 px-3 py-1.5">
                            <input type="checkbox" checked={bulkPickedSel.includes(c.id)}
                              onChange={() => setBulkPickedSel((prev) => prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id])}
                              className="w-4 h-4 shrink-0 accent-rose-600" />
                            <span className="text-sm text-gray-800 flex-1 min-w-0 truncate">{c.company_name}</span>
                            {!c.company_contact_email && <span className="shrink-0 text-[10px] text-rose-500">메일 없음</span>}
                            {/* ★ Codex 2R 수용 — 이 pane에 있으면 실제 발급이 계정별이다. 저장 scope와 무관하게 계정 메일 누락을 보여준다 */}
                            {Number(c.missing_account_emails) > 0 && <span className="shrink-0 text-[10px] text-orange-500">계정 메일 {c.missing_account_emails}건 미등록</span>}
                            <button onClick={() => bulkMoveToCombined(c.id)} className="shrink-0 text-[11px] text-indigo-600 hover:underline">◀ 전체</button>
                            <button onClick={() => bulkRemove(c.id)} className="shrink-0 text-[11px] text-gray-400 hover:text-rose-500">빼기</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <button onClick={handleBulkStart} disabled={bulkStarting || (bulkCombined.length + bulkByUser.length === 0)}
                    className="w-full py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-semibold disabled:opacity-40">
                    {bulkStarting ? '접수 중...' : `일괄 발급 시작 (${bulkCombined.length + bulkByUser.length}개사)`}
                  </button>
                </div>
              );
            })()}

            {/* 수동 정산완료 사유 입력 — 청구서를 만들지 않으므로 금액이 남지 않는다. 사유가 유일한 근거다 */}
            {bulkManualAsk !== null && (
              <div className="fixed inset-0 z-[2000] bg-black/50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5">
                  <h3 className="text-base font-bold text-gray-900 mb-1">수동 정산완료 ({bulkManualAsk.length}개사)</h3>
                  <p className="text-xs text-gray-500 mb-3">
                    {bulkMonth} 대상 목록에서 이 회사들을 뺍니다. <span className="font-semibold text-gray-700">거래내역서는 만들지 않습니다</span>.
                    금액은 시스템에 남지 않으니 어떻게 처리했는지 사유에 적어 주세요. 잘못 눌렀으면 목록에서 해제할 수 있습니다.
                  </p>
                  <textarea value={bulkManualReason} onChange={(e) => setBulkManualReason(e.target.value)} rows={3} maxLength={500}
                    placeholder="예) 별도 양식으로 직접 청구, 담당자 협의분"
                    className="w-full px-3 py-2 border rounded-lg text-sm resize-none focus:ring-2 focus:ring-amber-500 outline-none" autoFocus />
                  <div className="flex gap-2 mt-4">
                    <button onClick={() => { setBulkManualAsk(null); setBulkManualReason(''); }} disabled={bulkManualBusy}
                      className="flex-1 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-40">
                      취소
                    </button>
                    <button onClick={handleManualComplete} disabled={bulkManualBusy}
                      className="flex-1 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold disabled:opacity-40">
                      {bulkManualBusy ? '처리 중...' : '수동 정산완료로 표시'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 진행률 + 결과 */}
            {bulkJob?.job && (() => {
              const j = bulkJob.job;
              const total = Number(j.total_count) || 0;
              const done = Number(j.done_count) || 0;
              const failed = Number(j.failed_count) || 0;
              const pct = total > 0 ? Math.round(((done + failed) / total) * 100) : 0;
              return (
                <div className="mt-4 border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-gray-800">
                      {j.status === 'running' ? '발급 진행 중...' : '발급 완료'}
                      <span className="ml-2 text-xs font-normal text-gray-500">성공 {done} · 실패 {failed} / 전체 {total}</span>
                    </p>
                    <span className="text-sm font-bold text-violet-600">{pct}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-3 max-h-56 overflow-y-auto divide-y">
                    {(bulkJob.items || []).map((it: any) => (
                      <div key={it.id} className="flex items-start gap-2 py-1.5 text-xs">
                        <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          it.status === 'success' ? 'bg-emerald-100 text-emerald-700'
                          : it.status === 'failed' ? 'bg-rose-100 text-rose-600'
                          : it.status === 'running' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {it.status === 'success' ? '성공' : it.status === 'failed' ? '실패' : it.status === 'running' ? '진행' : '대기'}
                        </span>
                        <span className="w-40 shrink-0 truncate text-gray-800">{it.company_name}</span>
                        <span className="text-gray-500 break-all">{it.error || ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* 세금계산서·컨펌 현황판 (★2026-07-28 — 수정세금계산서 대비 내역 축) */}
            {confirmBoardOpen && (
              <div className="mt-4 border rounded-lg p-4">
                <div className="flex flex-wrap items-center gap-1.5 mb-3">
                  {['', 'pending', 'confirmed', 'objected', 'manual_wait', 'ready', 'issued'].map((s) => (
                    <button key={s || 'all'}
                      onClick={() => { setConfirmStatusFilter(s); loadConfirmBoard(s); }}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${confirmStatusFilter === s ? 'bg-slate-700 text-white border-slate-700' : 'text-slate-500 border-slate-300 hover:bg-slate-50'}`}>
                      {s === '' ? '전체' : CONFIRM_STATUS_LABELS[s]}
                    </button>
                  ))}
                  <button onClick={() => loadConfirmBoard()} className="ml-auto text-[11px] text-slate-500 hover:underline">새로고침</button>
                </div>
                {confirmTruncated && (
                  <p className="mb-2 px-2 py-1.5 bg-amber-50 text-amber-700 rounded text-[11px]">500건을 넘어 일부만 표시 중입니다. 상태 필터로 좁혀 주세요.</p>
                )}
                {confirmLoading ? (
                  <p className="text-sm text-gray-400 text-center py-4">불러오는 중...</p>
                ) : confirmRows.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">대상월에 해당 내역이 없습니다.</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto divide-y">
                    {confirmRows.map((r) => (
                      <div key={r.id} className="py-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            r.taxbill_status === 'issued' ? 'bg-emerald-100 text-emerald-700'
                            : r.taxbill_status === 'objected' ? 'bg-rose-100 text-rose-600'
                            : r.taxbill_status === 'ready' ? 'bg-violet-100 text-violet-700'
                            : r.taxbill_status === 'confirmed' ? 'bg-sky-100 text-sky-700'
                            : r.taxbill_status === 'manual_wait' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {CONFIRM_STATUS_LABELS[r.taxbill_status] || r.taxbill_status}
                          </span>
                          <span className="font-medium text-gray-800 truncate">{r.company_name}</span>
                          {r.account_name && <span className="text-gray-400">({r.account_name})</span>}
                          <span className="text-gray-500 truncate">{r.recipient_email}</span>
                          <span className="ml-auto shrink-0 font-semibold text-gray-700">{(Number(r.total_amount) || 0).toLocaleString()}원</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-400">
                          <span>발송 {r.sent_at ? new Date(r.sent_at).toLocaleString('ko-KR') : '-'}</span>
                          {r.confirmed_at && (
                            <span className="text-sky-600" title={r.confirm_note || undefined}>
                              컨펌 {new Date(r.confirmed_at).toLocaleString('ko-KR')}
                              {r.confirmed_by_admin && ` · 업체 확인 기록${r.confirm_note ? ` (${r.confirm_note})` : ''}`}
                            </span>
                          )}
                          {r.taxbill_issue_date && <span>작성일자 {String(r.taxbill_issue_date).slice(0, 10)}</span>}
                          {/* ★ 2026-08-21 계산서 비고(PO) — 발행 패스가 이 값을 팝빌 비고로 싣는다. */}
                          {r.taxbill_remark && <span className="text-indigo-600" title="계산서 비고에 그대로 인쇄됩니다">비고 {r.taxbill_remark}</span>}
                          {r.superseded_at && <span className="text-gray-400">재발급으로 무효</span>}
                          {/* ★ 2026-08-05 (서수란 접수) 작성일자 지정은 **컨펌 뒤에만** 연다.
                              지정하는 순간 발급 큐(ready)로 올라가 워커가 국세청 문서를 만든다 —
                              그전에는 컨펌 여부와 무관하게 열려 있어 업체 확인 없이 계산서가 나갔다.
                              업체가 메일·전화로 확인해 준 경우는 [업체 확인 기록]으로 컨펌을 남긴 뒤 지정한다. */}
                          {r.taxbill_status === 'manual_wait' && !r.superseded_at && (
                            r.confirmed_at ? (
                              <span className="flex items-center gap-1 ml-auto">
                                <input type="date" value={manualDateDraft[r.id] || ''}
                                  onChange={(e) => setManualDateDraft((prev) => ({ ...prev, [r.id]: e.target.value }))}
                                  className="px-1.5 py-0.5 border rounded text-[10px]" />
                                {/* ★ 2026-08-21 계산서 비고(PO번호) — 같은 통보로 오는 값이라 날짜 옆 한 자리. 필수 회사는 표시·차단. */}
                                <input type="text" value={manualRemarkDraft[r.id] || ''} maxLength={150}
                                  onChange={(e) => setManualRemarkDraft((prev) => ({ ...prev, [r.id]: e.target.value }))}
                                  placeholder={r.require_taxbill_remark ? '비고(PO번호), 필수' : '비고(PO번호 등, 선택)'}
                                  title="계산서 비고란에 그대로 인쇄됩니다"
                                  className={`px-1.5 py-0.5 border rounded text-[10px] w-40 ${r.require_taxbill_remark ? 'border-amber-400 bg-amber-50' : ''}`} />
                                <button onClick={() => handleManualIssueDate(r.id, r.require_taxbill_remark === true)}
                                  className="px-2 py-0.5 bg-amber-500 text-white rounded text-[10px] font-semibold">작성일자 지정</button>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 ml-auto">
                                <span className="text-[10px] text-gray-400">컨펌 전: 작성일자를 지정할 수 없습니다</span>
                                <button onClick={() => { setAdminConfirmTarget(r); setAdminConfirmNote(''); }}
                                  title="업체가 메일·전화로 확인해 준 경우, 근거를 적고 컨펌을 대신 기록합니다."
                                  className="px-2 py-0.5 border border-sky-300 bg-sky-50 text-sky-700 rounded text-[10px] font-semibold hover:bg-sky-100">업체 확인 기록</button>
                              </span>
                            )
                          )}
                        </div>
                        {r.objection_text && (
                          <p className="mt-1 px-2 py-1.5 bg-rose-50 text-rose-700 rounded text-[11px] whitespace-pre-wrap">이의신청: {r.objection_text}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* ── 세금계산서 장부 (★2026-07-30 — 원본+수정 축, 수정발행 진입점) ── */}
                <div className="mt-4 pt-3 border-t">
                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    <button onClick={() => { const next = !taxbillBoardOpen; setTaxbillBoardOpen(next); if (next) loadTaxbillIssues(); }}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${taxbillBoardOpen ? 'bg-slate-700 text-white border-slate-700' : 'text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                      세금계산서 장부 {taxbillBoardOpen ? '접기' : '열기'}
                    </button>
                    {taxbillBoardOpen && ['', 'ready', 'submitted', 'issued', 'failed'].map((s) => (
                      <button key={s || 'all'}
                        onClick={() => { setTaxbillStatusFilter(s); loadTaxbillIssues(s); }}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${taxbillStatusFilter === s ? 'bg-indigo-600 text-white border-indigo-600' : 'text-slate-500 border-slate-300 hover:bg-slate-50'}`}>
                        {s === '' ? '전체' : TAXBILL_STATUS_LABELS[s]}
                      </button>
                    ))}
                    {taxbillBoardOpen && <button onClick={() => loadTaxbillIssues()} className="ml-auto text-[11px] text-slate-500 hover:underline">새로고침</button>}
                  </div>
                  {taxbillBoardOpen && (
                    taxbillLoading ? (
                      <p className="text-sm text-gray-400 text-center py-4">불러오는 중...</p>
                    ) : taxbillRows.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-4">대상월에 장부 내역이 없습니다.</p>
                    ) : (
                      <>
                        {taxbillTruncated && (
                          <p className="mb-2 px-2 py-1.5 bg-amber-50 text-amber-700 rounded text-[11px]">500건을 넘어 일부만 표시 중입니다. 상태 필터로 좁혀 주세요.</p>
                        )}
                        <div className="max-h-72 overflow-y-auto divide-y">
                          {taxbillRows.map((t) => (
                            <div key={t.id} className="py-2 text-xs">
                              <div className="flex items-center gap-2">
                                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  t.status === 'issued' ? 'bg-emerald-100 text-emerald-700'
                                  : t.status === 'failed' ? 'bg-rose-100 text-rose-600'
                                  : t.status === 'submitted' ? 'bg-sky-100 text-sky-700'
                                  : t.status === 'ready' ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500'
                                }`}>
                                  {TAXBILL_STATUS_LABELS[t.status] || t.status}
                                </span>
                                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${t.kind === 'modify' ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>
                                  {t.kind === 'modify' ? `수정(사유${t.modify_code})` : '원본'}
                                </span>
                                <span className="font-medium text-gray-800 truncate">{t.company_name}</span>
                                <span className="text-gray-400">{t.issue_date}</span>
                                <span className={`ml-auto shrink-0 font-semibold ${Number(t.total_amount) < 0 ? 'text-rose-600' : 'text-gray-700'}`}>
                                  {(Number(t.total_amount) || 0).toLocaleString()}원
                                </span>
                                {/* ★ 2026-08-05 테스트베드 발행분은 **국세청에 나가지 않았다.** `발행 완료`만 보여주면
                                    화면이 거짓말을 한다 — 뱃지로 드러내고, 운영에서 못 찾는 동작(재발송·수정발행)은 잠근다. */}
                                {t.is_test === true && (
                                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-700"
                                    title="팝빌 테스트베드로 나간 문서입니다. 국세청에는 없습니다.">테스트베드</span>
                                )}
                                {/* ★ 2026-08-06 (Codex medium 수용) **모르는 것을 안다고 다루지 않는다.**
                                    표식이 없는 행(컬럼 부재·미백필)을 운영으로 취급하면 국세청에 없는 문서에
                                    재발송·수정발행이 열린다. 확정된 것만 연다 — 미확인은 전부 잠근다. */}
                                {t.status === 'issued' && t.is_test !== true && t.is_test !== false && (
                                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700"
                                    title="발행 환경 표식이 없습니다. DB 마이그레이션·백필 실행 전이라 어느 환경으로 나갔는지 확정할 수 없습니다.">환경 미확인</span>
                                )}
                                {/* ★ 2026-08-05 (서수란 접수) 미수신 재발송 — 문서를 만들지 않고 같은 번호로 메일만 다시 보낸다.
                                    이 버튼이 없어서 담당자가 쓸 수 있는 것이 [수정발행]뿐이었고, 그건 국세청에 한 장을 더 만든다. */}
                                {t.status === 'issued' && t.is_test === false && (
                                  <button onClick={() => { setTaxbillResendTarget(t); setTaxbillResendEmail(''); }}
                                    title="발행된 계산서 메일을 다시 보냅니다. 계산서를 새로 만들지 않습니다."
                                    className="shrink-0 px-2 py-0.5 border border-emerald-300 bg-emerald-50 text-emerald-700 rounded text-[10px] font-semibold hover:bg-emerald-100">메일 재발송</button>
                                )}
                                {t.status === 'issued' && t.nts_confirm_num && t.is_test === false && (
                                  <button onClick={() => openModifyModal(t)}
                                    className="shrink-0 px-2 py-0.5 bg-orange-500 text-white rounded text-[10px] font-semibold hover:bg-orange-600">수정발행</button>
                                )}
                                {/* 수정 장은 열지 않는다 — 당초 승인번호가 테스트베드 것이라 운영에는 그 원본이 없다(서버도 거부한다).
                                    ★ 2026-08-06 (Codex medium) **화이트리스트로 판정한다.** `!== 'modify'`는 NULL·미지의 종류까지
                                    열어, 서버가 422로 막을 동작을 화면이 "가능하다"고 안내하게 된다. 두 계약이 같아야 한다. */}
                                {t.status === 'issued' && t.is_test === true && t.kind === 'original' && (
                                  <button onClick={() => setTaxbillProdTarget(t)}
                                    title="이 문서는 국세청에 없습니다. 같은 문서번호로 운영에 다시 발행합니다."
                                    className="shrink-0 px-2 py-0.5 bg-rose-600 text-white rounded text-[10px] font-semibold hover:bg-rose-700">운영으로 재발행</button>
                                )}
                                {/* ★ 2026-08-07 수정(취소·정정) 장 재시도는 확인 모달을 지난다 — 그 문서는 이미 국세청에 있는
                                    원본을 건드린다. 원본 장 재시도는 안 나간 청구서를 같은 번호로 다시 보내는 것이라 그대로. */}
                                {t.status === 'failed' && (
                                  <button onClick={() => {
                                    if (t.kind === 'modify') { setTaxbillRetryTarget(t); setTaxbillRetryReason(''); }
                                    else handleTaxbillRetry(t.id);
                                  }}
                                    title={t.kind === 'modify'
                                      ? '수정(취소·정정) 장입니다. 확인 후 재시도합니다.'
                                      : '같은 문서번호로 다시 발행합니다.'}
                                    className="shrink-0 px-2 py-0.5 bg-slate-500 text-white rounded text-[10px] font-semibold hover:bg-slate-600">재시도</button>
                                )}
                                                {/* ★ 2026-08-05 발급 대기 취소 — 워커가 국세청으로 보내기 전 유일한 제동 장치다.
                                    그전에는 되돌리는 경로가 고객 이의신청뿐이라 담당자가 손댈 곳이 없었다. */}
                                {t.status === 'ready' && (
                                  <button onClick={() => { setTaxbillCancelTarget(t); setTaxbillCancelReason(''); }}
                                    title="아직 발행 전입니다. 큐에서 내려 워커가 보내지 않게 합니다."
                                    className="shrink-0 px-2 py-0.5 border border-rose-300 bg-rose-50 text-rose-700 rounded text-[10px] font-semibold hover:bg-rose-100">발급 대기 취소</button>
                                )}
                                {/* ★ 2026-08-21 작성일자 변경(서수란 접수 — 라프레리) — 자동 정책(익월 1일)이 만든 작성일자를
                                    발행 전에 고치는 유일한 창구. 승인번호가 생긴 뒤에는 국세청 사실이라 잠근다(서버와 같은 화이트리스트). */}
                                {(t.status === 'ready' || t.status === 'failed') && t.kind === 'original' && !t.nts_confirm_num && (
                                  <button onClick={() => { setTaxbillDateTarget(t); setTaxbillDateValue(String(t.issue_date || '').slice(0, 10)); setTaxbillDateRemark(String(t.taxbill_remark || '')); }}
                                    title="계산서에 적힐 작성일자를 바꿉니다. 문서번호는 그대로입니다."
                                    className="shrink-0 px-2 py-0.5 border border-indigo-300 bg-indigo-50 text-indigo-700 rounded text-[10px] font-semibold hover:bg-indigo-100">작성일자 변경</button>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-400">
                                {t.nts_confirm_num ? <span>승인번호 {t.nts_confirm_num}</span> : <span>승인번호 대기</span>}
                                {t.org_nts_confirm_num && <span>당초 {t.org_nts_confirm_num}</span>}
                                {t.issued_at && <span>발행 {new Date(t.issued_at).toLocaleString('ko-KR')}</span>}
                              </div>
                              {/* ★ 2026-08-21 실패 사유는 failed일 때만 보여준다 — [재시도]가 error를 지우지 않게
                                  바뀌어(작성일자 변경 자격 보존), ready로 올라간 행에도 옛 사유가 남아 있다. */}
                              {t.error && t.status === 'failed' && (
                                <p className="mt-1 px-2 py-1.5 bg-rose-50 text-rose-700 rounded text-[11px] whitespace-pre-wrap">{t.error}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    )
                  )}
                </div>
              </div>
            )}

            {/* ── 테스트베드 발행분 운영 재발행 모달 (★2026-08-05) ── */}
            {taxbillProdTarget && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">운영으로 재발행</h3>
                    <p className="text-sm text-gray-600 mb-1">
                      <strong>{taxbillProdTarget.company_name}</strong> · 작성일자 {taxbillProdTarget.issue_date}
                      {' · '}{(Number(taxbillProdTarget.total_amount) || 0).toLocaleString()}원
                    </p>
                    <p className="text-xs text-gray-500 mb-4">테스트베드 승인번호 {taxbillProdTarget.nts_confirm_num || '없음'}</p>

                    <div className="px-3 py-2 bg-rose-50 rounded-lg text-[11px] text-rose-800">
                      이 문서는 <strong>국세청에 나가지 않았습니다.</strong> 팝빌 테스트베드에만 있습니다.
                      같은 문서번호로 운영에 다시 발행합니다. 테스트와 운영은 분리된 환경이라 중복이 되지 않습니다.
                      <span className="block mt-1">발급 대기에 오르면 5분 주기 워커가 국세청으로 보냅니다. 작성일자는 그대로입니다.</span>
                    </div>
                  </div>
                  <div className="flex border-t">
                    <button onClick={() => setTaxbillProdTarget(null)} disabled={taxbillProdBusy}
                      className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">취소</button>
                    <button onClick={handleTaxbillReissueProduction} disabled={taxbillProdBusy}
                      className="flex-1 px-4 py-3 bg-rose-600 text-white font-semibold hover:bg-rose-700 transition-colors disabled:opacity-50">
                      {taxbillProdBusy ? '올리는 중...' : '국세청으로 발행'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── 발급 대기 취소 모달 (★2026-08-05) ── */}
            {taxbillCancelTarget && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">발급 대기 취소</h3>
                    <p className="text-sm text-gray-600 mb-1">
                      <strong>{taxbillCancelTarget.company_name}</strong> · 작성일자 {taxbillCancelTarget.issue_date}
                      {' · '}{(Number(taxbillCancelTarget.total_amount) || 0).toLocaleString()}원
                    </p>
                    <p className="text-xs text-gray-500 mb-4">아직 발행 전입니다. 5분 주기 워커가 곧 국세청으로 보냅니다.</p>

                    <label className="block text-xs font-semibold text-gray-600 mb-1">취소 사유</label>
                    <textarea value={taxbillCancelReason} onChange={(e) => setTaxbillCancelReason(e.target.value)} rows={3} maxLength={200}
                      placeholder="예) 업체 확인 결과 8월 LMS 수량이 달라 재발행 예정"
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-rose-500 outline-none resize-none" />

                    <div className="mt-3 px-3 py-2 bg-rose-50 rounded-lg text-[11px] text-rose-800">
                      큐에서 내리면 이 계산서는 발행되지 않습니다. 금액을 고치려면 그 뒤 <strong>수량 조정 재발행</strong> 또는
                      <strong> 삭제 후 재발행</strong>으로 진행합니다. 이미 발행에 들어간 건은 취소되지 않고 수정세금계산서 축입니다.
                    </div>
                  </div>
                  <div className="flex border-t">
                    <button onClick={() => { setTaxbillCancelTarget(null); setTaxbillCancelReason(''); }} disabled={taxbillCancelBusy}
                      className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">닫기</button>
                    <button onClick={handleTaxbillCancel} disabled={taxbillCancelBusy || !taxbillCancelReason.trim()}
                      className="flex-1 px-4 py-3 bg-rose-600 text-white font-semibold hover:bg-rose-700 transition-colors disabled:opacity-50">
                      {taxbillCancelBusy ? '처리 중...' : '발급 대기에서 내리기'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── 작성일자 변경 모달 (★2026-08-21 서수란 접수 — 라프레리) ── */}
            {taxbillDateTarget && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">작성일자 변경</h3>
                    <p className="text-sm text-gray-600 mb-1">
                      <strong>{taxbillDateTarget.company_name}</strong> · 현재 작성일자 {String(taxbillDateTarget.issue_date || '').slice(0, 10)}
                      {' · '}{(Number(taxbillDateTarget.total_amount) || 0).toLocaleString()}원
                    </p>
                    <p className="text-xs text-gray-500 mb-4">아직 국세청에 발행되지 않은 계산서입니다. 문서번호는 그대로 유지됩니다.</p>

                    <label className="block text-xs font-semibold text-gray-600 mb-1">새 작성일자</label>
                    <input type="date" value={taxbillDateValue} onChange={(e) => setTaxbillDateValue(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />

                    {/* ★ 2026-08-21 계산서 비고(PO번호) — 발행 패스가 팝빌 비고란에 그대로 싣는다. 기존 값이 기본으로 채워진다. */}
                    <label className="block text-xs font-semibold text-gray-600 mb-1 mt-3">계산서 비고 (PO번호 등 · 선택)</label>
                    <input type="text" value={taxbillDateRemark} maxLength={150} onChange={(e) => setTaxbillDateRemark(e.target.value)}
                      placeholder="예) PO-2026-0831 (계산서 비고란에 인쇄됩니다)"
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />

                    <div className="mt-3 px-3 py-2 bg-indigo-50 rounded-lg text-[11px] text-indigo-800">
                      오늘이거나 지난 날짜면 5분 안에 자동 발행되고, 미래 날짜면 그날 발행됩니다. 발행 실패 상태였던 건은
                      변경과 동시에 발급 대기로 되돌아갑니다. 비고를 비우면 계산서 비고도 비워집니다.
                    </div>
                  </div>
                  <div className="flex border-t">
                    <button onClick={() => { setTaxbillDateTarget(null); setTaxbillDateValue(''); setTaxbillDateRemark(''); }} disabled={taxbillDateBusy}
                      className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">닫기</button>
                    <button onClick={handleTaxbillIssueDateChange} disabled={taxbillDateBusy || !taxbillDateValue}
                      className="flex-1 px-4 py-3 bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50">
                      {taxbillDateBusy ? '처리 중...' : '변경하고 발급 대기에 올리기'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ★ 2026-08-07 수정(취소·정정) 장 재시도 확인 (Harold 승인 · Codex 적대검증 2R로 방향 확정)
                원본 재시도는 안 나간 청구서를 같은 문서번호로 다시 보내는 것이라 그대로 두고,
                수정 장만 이 관문을 지난다 — 그 문서는 **이미 국세청에 있는 원본을 취소·정정한다.** */}
            {taxbillRetryTarget && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">수정 계산서 재발행 확인</h3>
                    <p className="text-sm text-gray-600 mb-1">
                      <strong>{taxbillRetryTarget.company_name}</strong> · 작성일자 {taxbillRetryTarget.issue_date}
                      {' · '}{(Number(taxbillRetryTarget.total_amount) || 0).toLocaleString()}원
                    </p>
                    <p className="text-xs text-gray-500 mb-4">
                      사유 {taxbillRetryTarget.modify_code} 수정 장입니다.
                      {taxbillRetryTarget.org_nts_confirm_num
                        ? ` 당초 승인번호 ${taxbillRetryTarget.org_nts_confirm_num} 문서를 대상으로 합니다.`
                        : ''}
                    </p>

                    <label className="block text-xs font-semibold text-gray-600 mb-1">재발행 사유</label>
                    <textarea value={taxbillRetryReason} onChange={(e) => setTaxbillRetryReason(e.target.value)} rows={3} maxLength={200}
                      placeholder="예) 업체 확인 결과 8월 LMS 수량이 달라 정정이 필요함"
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none resize-none" />

                    <div className="mt-3 px-3 py-2 bg-amber-50 rounded-lg text-[11px] text-amber-900">
                      이 재시도가 성공하면 <strong>국세청에 있는 당초 문서가 실제로 취소·정정됩니다.</strong>
                      전에 실패했던 이유가 해소돼 지금은 나갈 수 있습니다. 그 정정이 지금도 필요한지 확인해 주세요.
                    </div>
                  </div>
                  <div className="flex border-t">
                    <button onClick={() => { setTaxbillRetryTarget(null); setTaxbillRetryReason(''); }}
                      className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">닫기</button>
                    <button onClick={() => handleTaxbillRetry(taxbillRetryTarget.id, { reason: taxbillRetryReason.trim() })}
                      disabled={!taxbillRetryReason.trim()}
                      className="flex-1 px-4 py-3 bg-amber-600 text-white font-semibold hover:bg-amber-700 transition-colors disabled:opacity-50">
                      확인하고 재발행
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── 업체 확인 대리 기록 모달 (★2026-08-05 서수란 접수) ── */}
            {adminConfirmTarget && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">업체 확인 기록</h3>
                    <p className="text-sm text-gray-600 mb-1">
                      <strong>{adminConfirmTarget.company_name}</strong>
                      {adminConfirmTarget.account_name && ` (${adminConfirmTarget.account_name})`}
                      {' · '}{(Number(adminConfirmTarget.total_amount) || 0).toLocaleString()}원
                    </p>
                    <p className="text-xs text-gray-500 mb-4">{adminConfirmTarget.billing_start} ~ {adminConfirmTarget.billing_end}</p>

                    <label className="block text-xs font-semibold text-gray-600 mb-1">어떻게 확인받았습니까</label>
                    <textarea value={adminConfirmNote} onChange={(e) => setAdminConfirmNote(e.target.value)} rows={3} maxLength={200}
                      placeholder="예) 8/5 구매팀 김OO 과장 메일로 8월 3일자 발행 요청 (PO 첨부)"
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-sky-500 outline-none resize-none" />

                    <div className="mt-3 px-3 py-2 bg-sky-50 rounded-lg text-[11px] text-sky-800">
                      업체가 컨펌 링크를 누르지 않고 메일·전화로 확인해 준 경우에만 씁니다. 기록하면 컨펌 시각이 남아
                      <strong> 작성일자를 지정할 수 있게</strong> 되고, 지정하는 순간 계산서가 발행됩니다. 적은 내용은 나중에 근거가 됩니다.
                    </div>
                  </div>
                  <div className="flex border-t">
                    <button onClick={() => { setAdminConfirmTarget(null); setAdminConfirmNote(''); }} disabled={adminConfirmBusy}
                      className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">취소</button>
                    <button onClick={handleAdminConfirm} disabled={adminConfirmBusy || !adminConfirmNote.trim()}
                      className="flex-1 px-4 py-3 bg-sky-600 text-white font-semibold hover:bg-sky-700 transition-colors disabled:opacity-50">
                      {adminConfirmBusy ? '기록 중...' : '확인 기록'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── 계산서 메일 재발송 모달 (★2026-08-05 서수란 접수) ── */}
            {taxbillResendTarget && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">계산서 메일 재발송</h3>
                    <p className="text-sm text-gray-600 mb-1">
                      <strong>{taxbillResendTarget.company_name}</strong> · 작성일자 {taxbillResendTarget.issue_date}
                      {' · '}{(Number(taxbillResendTarget.total_amount) || 0).toLocaleString()}원
                    </p>
                    <p className="text-xs text-gray-500 mb-4">승인번호 {taxbillResendTarget.nts_confirm_num || '대기'}</p>

                    <label className="block text-xs font-semibold text-gray-600 mb-1">받는 사람 (선택)</label>
                    <input type="email" value={taxbillResendEmail} onChange={(e) => setTaxbillResendEmail(e.target.value)}
                      placeholder="비우면 등록된 계산서 수신자 전원에게 보냅니다"
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />

                    <div className="mt-3 px-3 py-2 bg-emerald-50 rounded-lg text-[11px] text-emerald-800">
                      이미 발행된 <strong>그 계산서를 그대로 다시 메일링</strong>합니다. 계산서를 새로 만들지 않으므로
                      국세청에 문서가 한 장 더 나가지 않습니다. 금액이 틀린 건은 [수정발행]으로 정정합니다.
                    </div>
                  </div>
                  <div className="flex border-t">
                    <button onClick={() => { setTaxbillResendTarget(null); setTaxbillResendEmail(''); }} disabled={taxbillResendBusy}
                      className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">취소</button>
                    <button onClick={handleTaxbillResend} disabled={taxbillResendBusy}
                      className="flex-1 px-4 py-3 bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50">
                      {taxbillResendBusy ? '보내는 중...' : '메일 다시 보내기'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── 수정세금계산서 발급 모달 (★2026-07-30) ── */}
            {modifyTarget && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">수정세금계산서 발급</h3>
                    <p className="text-sm text-gray-600 mb-1"><strong>{modifyTarget.company_name}</strong> · 당초 작성일자 {modifyTarget.issue_date}</p>
                    <p className="text-xs text-gray-500 mb-4">
                      당초 공급가액 {Number(modifyTarget.supply_amount).toLocaleString()}원 · 세액 {Number(modifyTarget.tax_amount).toLocaleString()}원 · 승인번호 {modifyTarget.nts_confirm_num}
                    </p>

                    <label className="block text-xs font-semibold text-gray-600 mb-1">수정 사유</label>
                    <select value={modifyCode} onChange={(e) => setModifyCode(Number(e.target.value))}
                      className="w-full px-3 py-2 border rounded-lg text-sm mb-3 focus:ring-2 focus:ring-indigo-500 outline-none">
                      {[6, 4, 2, 1].map((c) => <option key={c} value={c}>{MODIFY_CODE_LABELS[c]}</option>)}
                    </select>

                    {(modifyCode === 2 || modifyCode === 4) && (
                      <div className="mb-3">
                        <label className="block text-xs font-semibold text-gray-600 mb-1">{modifyCode === 2 ? '변동일 (작성일자)' : '해제일 (작성일자)'}</label>
                        <input type="date" value={modifyWriteDate} onChange={(e) => setModifyWriteDate(e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                        {modifyCode === 2 && <p className="mt-1 text-[10px] text-amber-600">공급가액 변동은 변동일 기준 익월 10일이 발급 기한입니다.</p>}
                      </div>
                    )}

                    {modifyCode === 2 && (
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">공급가액 변동분 (±원)</label>
                          <input type="number" step="1" value={modifyDeltaSupply} onChange={(e) => setModifyDeltaSupply(e.target.value)} placeholder="-200000"
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">세액 변동분 (±원)</label>
                          <input type="number" step="1" value={modifyDeltaTax} onChange={(e) => setModifyDeltaTax(e.target.value)} placeholder="-20000"
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                        </div>
                      </div>
                    )}

                    {modifyCode === 1 && (
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">정정 후 공급가액 (원)</label>
                          <input type="number" step="1" value={modifyCorrectedSupply} onChange={(e) => setModifyCorrectedSupply(e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">정정 후 세액 (원)</label>
                          <input type="number" step="1" value={modifyCorrectedTax} onChange={(e) => setModifyCorrectedTax(e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                        </div>
                      </div>
                    )}

                    <div className="px-3 py-2 bg-slate-50 rounded-lg text-[11px] text-slate-600">
                      {modifyCode === 6 && <>당초 전액을 취소하는 <strong className="text-rose-600">-{Number(modifyTarget.total_amount).toLocaleString()}원</strong> 1장이 만들어집니다. 작성일자는 당초 작성일자 그대로입니다.</>}
                      {modifyCode === 4 && <>해제일 작성일자로 당초 전액을 취소하는 <strong className="text-rose-600">-{Number(modifyTarget.total_amount).toLocaleString()}원</strong> 1장이 만들어집니다.</>}
                      {modifyCode === 2 && <>변동분만큼의 ±1장이 만들어집니다. 감액이면 음수로 입력합니다.</>}
                      {modifyCode === 1 && <>당초 전액 취소(부) 1장 + 정정 금액(정) 1장, 총 2장이 함께 만들어집니다.</>}
                      <span className="block mt-1 text-slate-400">발급 대기에 오르면 5분 주기 워커가 팝빌로 발행합니다.</span>
                    </div>
                  </div>
                  <div className="flex border-t">
                    <button onClick={() => setModifyTarget(null)} disabled={modifySubmitting}
                      className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">취소</button>
                    <button onClick={handleModifySubmit} disabled={modifySubmitting}
                      className="flex-1 px-4 py-3 bg-orange-500 text-white font-semibold hover:bg-orange-600 transition-colors disabled:opacity-50">
                      {modifySubmitting ? '요청 중...' : '발급 대기에 올리기'}
                    </button>
                  </div>
                </div>
              </div>
            )}
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
              <div className="flex items-center gap-2">
                {/* ★ 2026-08-05 (서수란 접수) 선택 건 일괄 처리 — 한 건씩 확정하고 메일도 한 건씩 누르던 것.
                    진행 중에는 진행률만 남기고 버튼을 감춘다(중복 클릭 = 중복 발송). */}
                {billingBulk ? (
                  <span className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-indigo-200 bg-indigo-50 text-indigo-700">
                    {billingBulk.label} {billingBulk.done}/{billingBulk.total} 진행 중...
                  </span>
                ) : billingSel.length > 0 && (
                  <>
                    {/* ★ 2026-08-20 일괄 버튼은 목록이 **현재 필터로 적재 확인**됐을 때만 산다(Codex 2R·3R 수용) —
                        재조회 중이거나 적재 실패 상태의 billings 위에서는 실행하지 않는다. runBillingBulk 입구도 같은 잠금. */}
                    <button type="button" onClick={() => runBillingBulk('confirm')} disabled={billingsLoading || billingsKey !== billingFilterKey}
                      title="선택한 초안을 한 번에 청구 확정합니다. 수금 관리 표시이며 발송·세금계산서와 무관합니다."
                      className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                      선택 청구 확정 ({billingSel.length})
                    </button>
                    <button type="button" onClick={() => runBillingBulk('send')} disabled={billingsLoading || billingsKey !== billingFilterKey}
                      title="선택한 건 중 아직 발송되지 않은 청구서를 한 번에 보냅니다. 이미 나간 건은 행의 [재발송]으로 확인 후 보냅니다."
                      className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                      선택 발송 ({billingSel.length})
                    </button>
                    <button type="button" onClick={() => setBillingSel([])}
                      className="px-2 py-1.5 rounded-lg text-sm text-gray-500 hover:bg-gray-50 transition-colors">선택 해제</button>
                  </>
                )}
                {/* ★ 2026-08-05 총 정산표 — 소유자(ceo) 전용. 전 고객사 총 청구금·수금·미납을 한 화면에.
                    권한이 없는 계정에는 버튼 자체가 안 그려지고, 서버가 403으로 최종 판정한다. */}
                {canViewSettlementOverview && (
                  <button type="button" onClick={() => setShowSettlementOverview(true)}
                    title="전 고객사의 총 청구금·수금완료·미납을 한 화면에서 봅니다"
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors">
                    총 정산표
                  </button>
                )}
                {/* ★ 2026-07-28 발행됐는데 고객에게 안 나간 장. 금액 불일치로 발송이 막힌 장은 컨펌 추적 목록에 안 뜬다 */}
                <button type="button" onClick={() => setBillingUnsentOnly(!billingUnsentOnly)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${billingUnsentOnly ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
                  발행됨 · 미발송만
                </button>
                {/* ★ 2026-08-06 검색 (Harold 지시) — 목록이 길어 원하는 회사를 찾기 어려웠다. 화면 안에서만 좁힌다. */}
                <div className="relative">
                  <input type="text" value={billingSearch} onChange={(e) => setBillingSearch(e.target.value)}
                    placeholder="고객사·계정 검색"
                    className="w-44 pl-3 pr-7 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                  {billingSearch && (
                    <button type="button" onClick={() => setBillingSearch('')}
                      aria-label="검색어 지우기"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm">×</button>
                  )}
                </div>
                <select value={filterYear} onChange={e => setFilterYear(Number(e.target.value))}
                  className="px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                  {billingYearOptions.map(y => <option key={y} value={y}>{y}년</option>)}
                </select>
                {/* ★ 2026-08-20 정산월 필터 (서수란 0819 접수 — 월별 관리) */}
                <select value={filterMonth} onChange={e => setFilterMonth(Number(e.target.value))}
                  className="px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                  <option value={0}>전체 월</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
                </select>
              </div>
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
                      {/* ★ 2026-08-05 (서수란 접수) 전체 선택. ★2026-08-06 페이징이 생기면서 기준을 **이 페이지**로
                          한다(일괄발급 목록과 같은 규약) — 안 보이는 건까지 한 번에 선택되면 그게 사고다.
                          선택 자체는 페이지를 넘겨도 유지되므로 여러 페이지에 걸쳐 고를 수 있다. */}
                      <th className="px-3 py-2.5 text-center w-10">
                        {(() => {
                          const pageIds = billingVisible.map((b: any) => b.id);
                          const pageAll = pageIds.length > 0 && pageIds.every((id: string) => billingSel.includes(id));
                          return (
                            <input type="checkbox" aria-label="이 페이지 전체 선택" title="이 페이지 전체 선택"
                              checked={pageAll} disabled={pageIds.length === 0}
                              onChange={() => setBillingSel((prev) => pageAll
                                ? prev.filter((x) => !pageIds.includes(x))
                                : Array.from(new Set([...prev, ...pageIds])))}
                              className="w-4 h-4 accent-indigo-600 cursor-pointer" />
                          );
                        })()}
                      </th>
                      <th className="px-4 py-2.5 text-left text-gray-600 font-medium">고객사</th>
                      <th className="px-4 py-2.5 text-center text-gray-600 font-medium">구분</th>
                      <th className="px-4 py-2.5 text-center text-gray-600 font-medium">정산월</th>
                      {/* ★ 2026-08-04 SMS·LMS 두 컬럼을 '유형별'로 교체. 청구 축은 최대 14종(웹 4 + 에이전트 4 +
                          테스트 2 + 스팸 2 + 요금제 + AI 크레딧)이라 두 컬럼으로는 담기지 않는다 —
                          SMS/LMS뿐인 회사에선 맞아 보이고 `both` 회사에선 틀려 보였다. */}
                      <th className="px-4 py-2.5 text-center text-gray-600 font-medium">유형별</th>
                      <th className="px-4 py-2.5 text-right text-gray-600 font-medium">합계</th>
                      <th className="px-4 py-2.5 text-center text-gray-600 font-medium">상태</th>
                      <th className="px-4 py-2.5 text-center text-gray-600 font-medium">발송일</th>
                      <th className="px-4 py-2.5 text-center text-gray-600 font-medium">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {billingVisible.map((b: any) => (
                      <tr key={b.id} className={`hover:bg-gray-50 cursor-pointer ${billingSel.includes(b.id) ? 'bg-indigo-50/60' : ''}`} onClick={() => openBillingDetail(b.id)}>
                        <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" aria-label={`${b.company_name} 선택`}
                            checked={billingSel.includes(b.id)}
                            onChange={() => setBillingSel((prev) => prev.includes(b.id) ? prev.filter((x) => x !== b.id) : [...prev, b.id])}
                            className="w-4 h-4 accent-indigo-600 cursor-pointer" />
                        </td>
                        <td className="px-4 py-2.5 font-medium text-gray-900">{b.company_name}</td>
                        {/* ★ 2026-07-26 '구분' — 계정별 발행은 한 회사·한 기간에 여러 행이 생긴다.
                            계정 이름만 보이면 공통 장(계정 없음)이 '전체'로 보여 합산 발행과 구분되지 않는다. */}
                        <td className="px-4 py-2.5 text-center text-gray-500">
                          {b.scope === 'common'
                            ? <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 text-xs font-medium">공통 장</span>
                            : b.scope === 'by_user'
                              ? <span className="text-indigo-600">{b.user_name || '(계정 미상)'}</span>
                              : '전체'}
                        </td>
                        <td className="px-4 py-2.5 text-center text-gray-500">{b.billing_year}년 {b.billing_month}월</td>
                        {/* 상세 모달이 서버 `lines`(PDF·이메일과 같은 함수)로 채널별 전체 유형을 보여준다 — 새 집계 없음 */}
                        <td className="px-4 py-2.5 text-center">
                          <button
                            onClick={(e) => { e.stopPropagation(); openBillingDetail(b.id); }}
                            className="px-2.5 py-1 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-md hover:bg-indigo-50 transition-colors">
                            유형별
                          </button>
                        </td>
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
                          {/* ★ 2026-07-28 발행은 됐는데 메일이 안 나간 장 — 발행을 다시 하지 않고 컨펌 단계만 보낸다.
                              일괄발급 재실행은 기간 중복에 막히므로 이게 유일한 경로다.
                              장 id로 보낸다 — batch_id는 장이 2개 이상일 때만 생겨서 기본 발급(단일 장)에 안 닿는다.
                              ★ 2026-08-04 (서수란 접수) 이 버튼이 **정산 목록의 유일한 발송 버튼**이 됐다.
                              그전에는 확정 상태에서 별도 [발송](옛 send-email)이 함께 떠 있었는데, 그쪽은
                              컨펌 추적행을 만들지 않고 emailed_at만 찍었다. 운영자가 그것을 정식 발송으로 알고
                              누르면 그 순간 이 버튼의 조건(!emailed_at)이 꺼져 **그 청구서는 컨펌·이의신청·
                              세금계산서 흐름에 영영 진입하지 못했다**(일괄발급 탭에도 안 뜬다). 경로를 하나로 합쳤다. */}
                          {!b.emailed_at && (
                              <button onClick={() => handleRetryConfirmations(b.id, b.company_name)}
                                disabled={retryingBillingId === b.id}
                                title="거래내역서 PDF와 컨펌 링크를 등록된 정산 수신자에게 보냅니다"
                                className="px-2 py-1 text-xs bg-amber-100 text-amber-700 rounded hover:bg-amber-200 disabled:opacity-50 transition-colors">
                                {retryingBillingId === b.id ? '발송 중...' : '발송'}
                              </button>
                            )}
                            {/* ★ 2026-08-05 (서수란 접수) 발송이 끝난 장의 **재발송**. 0804에 옛 [발송]을 걷어내면서
                                "이미 나간 청구서를 다시 보내는" 경로가 화면에서 통째로 사라졌다(업체 미수신 시 처리 방법 0).
                                걷어낸 이유였던 결함은 그 뒤 서버에서 닫혔다 — `POST /:id/send-email`이 같은 트랜잭션에서
                                컨펌 토큰을 확보하고(ensureConfirmationToken) 발송 후 승격까지 한다(markConfirmationDelivered).
                                이제 이 경로로 보내도 컨펌·이의신청·세금계산서 흐름에서 빠지지 않는다.
                                중복 발송은 서버가 409로 한 번 되돌려 "언제·누구에게 나갔는지"를 확인받는다. */}
                            {b.emailed_at && (
                              <button onClick={() => openEmailModal(b)}
                                title="이미 발송된 거래내역서를 다시 보냅니다. 언제·누구에게 나갔는지 확인한 뒤에만 재발송됩니다."
                                className="px-2 py-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 transition-colors">
                                재발송
                              </button>
                            )}
                            <button onClick={() => downloadBillingPdf(b.id, `${b.company_name}_${b.billing_year}_${b.billing_month}`)}
                              className="px-2 py-1 text-xs bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition-colors">PDF</button>
                            {/* ★ 2026-08-05 (서수란 질의 "확정 버튼의 의미가 뭔가요?") — 축을 눈에 보이게 갈랐다.
                                발송·PDF는 **발행 축**이고, 아래 둘은 **수금 축**(draft → confirmed → paid)이다.
                                확정은 발행의 관문이 아니다 — 발송은 status를 보지 않고, 세금계산서는 고객 컨펌
                                (또는 기한 도래)이 큐를 움직인다. 같은 줄에 같은 크기로 붙어 있어서 담당자가
                                "이걸 눌러야 다음이 되나"로 읽었다. 구분선 + 문구로 뜻을 드러낸다. */}
                            <span className="mx-0.5 h-4 w-px bg-gray-200" aria-hidden="true" />
                            {b.status === 'draft' && (
                              <button onClick={() => handleBillingStatusChange(b.id, 'confirmed')}
                                title="수금 관리용 표시입니다. 이 금액으로 굳혔다는 뜻이고, 발송·세금계산서 발행과는 무관합니다. 확정 뒤에는 삭제할 때 사유가 필요합니다."
                                className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors">청구 확정</button>
                            )}
                            {b.status === 'confirmed' && (
                              <button onClick={() => handleBillingStatusChange(b.id, 'paid')}
                                title="입금을 받았다는 표시입니다. 총 정산표의 미납 집계에서 빠집니다."
                                className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors">수금완료</button>
                            )}
                            {/* ★ 2026-08-04 옛 [발송](openEmailModal → POST /:id/send-email)을 여기서 뺐다.
                                그 경로는 emailed_at만 찍고 컨펌 추적행을 만들지 않아, 누르는 순간 그 청구서가
                                컨펌·이의신청·세금계산서 흐름에서 통째로 빠졌다(서수란 0804 접수의 원인).
                                발송은 위 컨펌 경로 하나로 통일했다. 모달·라우트 자체는 남아 있으나 화면 진입점은 없다
                                — 완전 철거는 소비처 grep 후 별건(0728 필터항목 탭과 같은 방식). */}
                            {/* ★ 2026-08-04 업체와 수량이 다를 때 사람이 실제 수량을 적고 다시 발행한다(서수란 접수). */}
                            <button onClick={() => setQtyAdjustTarget({ id: b.id, companyName: b.company_name, accountName: b.account_name || null })}
                              className="px-2 py-1 text-xs bg-violet-100 text-violet-700 rounded hover:bg-violet-200 transition-colors">수량 조정</button>
                            <button onClick={() => { setDeleteTargetId(b.id); setDeleteReason(''); setShowBillingDeleteConfirm(true); }}
                              className="px-2 py-1 text-xs bg-red-100 text-red-600 rounded hover:bg-red-200 transition-colors">삭제</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* ★ 2026-08-06 페이징 (Harold 지시) — 15개씩. 검색으로 0건이 되면 그 사실을 그대로 말한다. */}
                {billingRows.length === 0 ? (
                  <p className="text-center py-6 text-sm text-gray-400">
                    "{billingSearch.trim()}"에 해당하는 정산이 없습니다.
                  </p>
                ) : billingTotalPages > 1 && (
                  <div className="flex items-center justify-center gap-3 py-3 border-t">
                    <button type="button" onClick={() => setBillingPage(Math.max(1, billingPageNow - 1))}
                      disabled={billingPageNow <= 1}
                      className="px-2 py-1 text-xs text-gray-500 disabled:opacity-30 hover:text-gray-800">이전</button>
                    <span className="text-xs text-gray-500 tabular-nums">
                      {billingPageNow} / {billingTotalPages}
                      <span className="ml-2 text-gray-400">({billingRows.length}건)</span>
                    </span>
                    <button type="button" onClick={() => setBillingPage(Math.min(billingTotalPages, billingPageNow + 1))}
                      disabled={billingPageNow >= billingTotalPages}
                      className="px-2 py-1 text-xs text-gray-500 disabled:opacity-30 hover:text-gray-800">다음</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ★ 2026-08-04 (서수란 접수 "정산목록과 거래내역서 목록 차이") 옛 "거래내역서 목록" 섹션 제거.
              그 목록은 `billing_invoices` 테이블을 봤는데, 거기에 행을 만드는 경로는
              POST /admin/billing/invoices 하나뿐이고 **화면에 그 진입점이 없다** —
              정산서를 몇 장 발행하든 영원히 "생성된 거래내역서가 없습니다"로 남는 죽은 목록이었다.
              정산 축은 위 `billings`(정산 목록)로 통합됐고 이 섹션은 그 이전의 잔재다.
              테이블·라우트 철거는 소비처 grep 후 별건(0728 필터항목 탭과 같은 방식). */}

          {/* ===== 정산 생성 확인 모달 (★2026-08-04 발행 전 점검 — 미리보기 금액·차단 사유 동반) ===== */}
          {showGenerateConfirm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-6 max-h-[75vh] overflow-y-auto">
                  <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-center text-gray-900 mb-2">정산 생성</h3>
                  <p className="text-sm text-center text-gray-600 mb-1">
                    <strong>{companies.find(c => c.id === billingCompanyId)?.company_name}</strong>
                  </p>
                  {/* ★ 2026-08-20 발행 전 마지막 관문에 정산월을 드러낸다 — 중간정산은 기간과 이름이 다른 달일 수 있다. */}
                  <p className="text-sm text-center text-gray-500 mb-1">
                    <strong className="text-gray-700">{billingLabelText(billingLabelEffective)} 정산</strong> · {billingStart} ~ {billingEnd}
                  </p>
                  <p className="text-xs text-center text-gray-400 mb-4">
                    {billingScope === 'company' ? '고객사 전체 (1장)' : '계정별: 계정 장 + 공통 장 묶음'}
                  </p>
                  {/* ★ 2026-08-04 발행 전 점검 — 발행과 같은 집계 함수(`/preview`)의 금액과 차단 사유.
                      여기서 막히는 것은 발행에서도 막힌다(서버가 같은 문으로 판정한다). */}
                  {billingPreviewLoading ? (
                    <p className="text-xs text-center text-gray-500 py-4">발송 데이터를 집계하는 중입니다...</p>
                  ) : billingPreview ? (
                    <>
                      <div className="rounded-xl border bg-gray-50 px-4 py-3 text-left">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">공급가액</span>
                          <span className="tabular-nums font-medium text-gray-800">{billingFmtWon(Number(billingPreview.amounts?.subtotal || 0))}</span>
                        </div>
                        <div className="flex justify-between text-sm mt-1">
                          <span className="text-gray-500">부가세</span>
                          <span className="tabular-nums font-medium text-gray-800">{billingFmtWon(Number(billingPreview.amounts?.vat || 0))}</span>
                        </div>
                        <div className="flex justify-between text-base mt-2 pt-2 border-t">
                          <span className="font-semibold text-gray-700">합계</span>
                          <span className="tabular-nums font-bold text-indigo-700">{billingFmtWon(Number(billingPreview.amounts?.total_amount || 0))}</span>
                        </div>
                      </div>
                      {billingPreview.billing_guard && billingPreview.billing_guard.billable === false && (
                        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left">
                          <p className="text-sm font-semibold text-red-700 mb-1.5">이 상태로는 발행이 막힙니다</p>
                          <ul className="space-y-1">
                            {String(billingPreview.billing_guard.reason || '').split(' / ').filter(Boolean).map((r: string, i: number) => (
                              <li key={i} className="text-xs text-red-700 leading-relaxed">· {r}</li>
                            ))}
                          </ul>
                          {(billingPreview.billing_guard.blocker_codes || []).some((c: string) => c === 'WEB_UNIT_PRICE_UNSET' || c === 'AGENT_UNIT_PRICE_MISSING') && (
                            <p className="text-xs text-red-600 mt-2 pt-2 border-t border-red-200">
                              고객사 관리 → 해당 고객사 수정 → 단가설정에서 빈 단가를 채운 뒤 다시 시도해 주세요.
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-center text-gray-500">
                      MySQL 발송 데이터를 집계하여 정산을 생성합니다.
                    </p>
                  )}
                </div>
                <div className="flex border-t">
                  <button onClick={() => setShowGenerateConfirm(false)}
                    className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">취소</button>
                  <button
                    onClick={handleBillingGenerate}
                    disabled={generating || billingPreviewLoading || billingPreview?.billing_guard?.billable === false}
                    className="flex-1 px-4 py-3 text-indigo-600 font-medium hover:bg-indigo-50 transition-colors disabled:opacity-40 disabled:hover:bg-transparent">
                    {generating ? '생성 중...' : billingPreviewLoading ? '집계 중...' : '발행'}
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
                    이 정산과 일자별 상세 데이터가 모두 삭제됩니다.<br />
                    계정별 묶음 발행분은 <strong>묶음 전체(계정 장 + 공통 장)</strong>가 함께 삭제됩니다.<br />계속하시겠습니까?
                  </p>
                  {/* ★ 2026-07-26 확정·수금·메일 발송분은 사유 필수 — 없으면 서버가 422로 막고 이 칸을 다시 연다 */}
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-gray-500 mb-1">삭제 사유 (확정·수금·메일 발송분은 필수)</label>
                    <textarea value={deleteReason} onChange={e => setDeleteReason(e.target.value)} rows={2}
                      placeholder="예: 단가 오설정으로 금액 오류, 재발행 예정"
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-red-400 outline-none resize-none" />
                  </div>
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
                          {/* ★ 2026-07-26 발행 단위 — 묶음 발행이면 이 장이 어떤 장인지가 보여야 한다 */}
                          {detailBilling.scope === 'by_user' && <span className="ml-2 px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-xs font-medium">계정 장</span>}
                          {detailBilling.scope === 'common' && <span className="ml-2 px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 text-xs font-medium">공통 장 (회사 단위 항목)</span>}
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
                    {/* ★ 2026-07-26 항목표 — 서버가 PDF·이메일과 같은 함수(buildInvoiceLines)로 내려준 줄.
                        헤더 컬럼 카드(SMS/LMS/MMS/카카오)를 폐기한 이유: 헤더에는 에이전트·요금제 칸이
                        없는데 공급가액에는 그 금액이 들어가서, 카드 세로합 ≠ 공급가액이었다. */}
                    <div className="px-6 py-4">
                      {/* 정합 경고 — 항목합 + 크레딧 ≠ 공급가액이면 PDF·메일도 같은 이유로 막힌다 */}
                      {detailHeaderCheck && !detailHeaderCheck.ok && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
                          <span className="font-semibold">항목 합계가 공급가액과 일치하지 않습니다</span>
                          <span className="ml-2">(차이 {billingFmtWon(Number(detailHeaderCheck.diff))})</span>
                          <span className="block text-xs text-red-500 mt-1">이 상태로는 PDF·메일 발행이 서버에서 차단됩니다. 발행 경로 점검이 필요합니다.</span>
                        </div>
                      )}

                      {detailLines.length > 0 && (
                        <div className="border rounded-lg overflow-hidden mb-4">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-3 py-2 text-left text-gray-600 font-medium">항목</th>
                                <th className="px-3 py-2 text-right text-gray-600 font-medium">수량</th>
                                <th className="px-3 py-2 text-right text-gray-600 font-medium">단가</th>
                                <th className="px-3 py-2 text-right text-gray-600 font-medium">금액</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {detailLines.map((line: any, idx: number) => (
                                <tr key={idx} className={billingChannelBg[line.channel] || 'bg-white'}>
                                  <td className="px-3 py-2 text-gray-800">{line.label}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{line.quantityText || `${billingFmt(Number(line.count))}건`}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{billingFmtWon(Number(line.unitPrice))}</td>
                                  <td className="px-3 py-2 text-right tabular-nums font-medium">{billingFmtWon(Number(line.amount))}</td>
                                </tr>
                              ))}
                              {Number(detailBilling.ai_credit_supply) > 0 && (
                                <tr className="bg-violet-50/60">
                                  <td className="px-3 py-2 text-gray-800">AI 크레딧</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{billingFmt(Number(detailBilling.ai_credit_count))} 크레딧</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{Number(detailBilling.ai_credit_count) > 0 ? billingFmtWon(Math.round(Number(detailBilling.ai_credit_supply) / Number(detailBilling.ai_credit_count))) : '-'}</td>
                                  <td className="px-3 py-2 text-right tabular-nums font-medium">{billingFmtWon(Number(detailBilling.ai_credit_supply))}</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
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
                                {/* ★ 2026-07-26 '구분' 열 — 축이 채널·계정·발송ID로 쪼개지면서 같은 날 같은 유형
                                    행이 여러 줄 생긴다. 구분이 없으면 중복 오류로 보인다(PDF 2페이지와 같은 열). */}
                                <th className="px-3 py-2 text-left text-gray-600 font-medium">구분</th>
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
                                // 채널 판정은 유형키 접두가 아니라 channel — 접두 판정은 새 유형이 생기면 조용히 어긋난다.
                                const ch = String(item.channel || 'web');
                                const isPlan = ch === 'plan';
                                const planDays = Number(item.plan_days) || 0;
                                // 요금제 행은 발송이 아니다 — 일자 칸에 적용 구간, 수량 4칸에 '-'.
                                const dateText = isPlan && planDays > 1
                                  ? `${String(item.item_date).slice(5, 10)}~${billingShiftDay(item.item_date, planDays - 1)}`
                                  : String(item.item_date).slice(5, 10);
                                const typeText = isPlan
                                  ? String(item.message_type).replace(/^PLAN_/, '')
                                  : (billingTypeLabel[item.message_type] || item.message_type);
                                // ★ 2026-07-31 구분 칸은 **서버가 확정한 값**(scope_label)을 그대로 쓴다 —
                                //   화면이 자기 판정을 또 두면 청구서(PDF)와 갈린다(실제로 갈려 있었다:
                                //   발급명은 화면에만, `extra` 행은 화면에서 원문 'extra' 노출).
                                //   구버전 응답 대비 폴백만 남긴다.
                                const scopeText = item.scope_label
                                  || (ch === 'agent'
                                    ? (formatAgentIdLabel(item.agent_send_id, item.cust_name) || '(발송ID 미상)')
                                    : (billingChannelLabel[ch] || ch));
                                const rowBg = billingChannelBg[ch] || (idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50');
                                return (
                                  <tr key={idx} className={rowBg}>
                                    <td className="px-3 py-2 text-gray-700 font-mono text-xs whitespace-nowrap">{dateText}</td>
                                    <td className="px-3 py-2 text-gray-600 text-xs whitespace-nowrap">{scopeText}</td>
                                    <td className="px-3 py-2">{typeText}</td>
                                    {isPlan ? (
                                      <>
                                        <td className="px-3 py-2 text-right text-gray-400">-</td>
                                        <td className="px-3 py-2 text-right text-gray-400">-</td>
                                        <td className="px-3 py-2 text-right text-gray-400">-</td>
                                        <td className="px-3 py-2 text-right text-gray-400">-</td>
                                      </>
                                    ) : (
                                      <>
                                        <td className="px-3 py-2 text-right tabular-nums">{billingFmt(Number(item.total_count))}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-green-700 font-medium">{billingFmt(Number(item.success_count))}</td>
                                        <td className={`px-3 py-2 text-right tabular-nums ${Number(item.fail_count) > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>{billingFmt(Number(item.fail_count))}</td>
                                        <td className={`px-3 py-2 text-right tabular-nums ${Number(item.pending_count) > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{billingFmt(Number(item.pending_count))}</td>
                                      </>
                                    )}
                                    <td className="px-3 py-2 text-right tabular-nums">{billingFmtWon(Number(item.unit_price))}</td>
                                    <td className="px-3 py-2 text-right tabular-nums font-medium">{billingFmtWon(Number(item.amount))}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot className="border-t-2 border-gray-300 bg-indigo-50">
                              <tr>
                                {/* ★ 2026-07-26 라벨 정정 — 이 합계는 AI 크레딧·부가세가 빠진 값이다.
                                    '합계'라고만 쓰면 상단 카드의 합계(총액)와 다른 이유를 알 수 없다. */}
                                <td colSpan={3} className="px-3 py-2.5 font-bold text-indigo-800">항목 합계 <span className="font-normal text-xs text-indigo-500">(AI 크레딧·부가세 제외 · 원 미만 절사)</span></td>
                                <td className="px-3 py-2.5 text-right tabular-nums font-medium">{billingFmt(detailItems.reduce((s: number, i: any) => s + Number(i.total_count), 0))}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums font-medium text-green-700">{billingFmt(detailItems.reduce((s: number, i: any) => s + Number(i.success_count), 0))}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums font-medium text-red-600">{billingFmt(detailItems.reduce((s: number, i: any) => s + Number(i.fail_count), 0))}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{billingFmt(detailItems.reduce((s: number, i: any) => s + Number(i.pending_count), 0))}</td>
                                <td className="px-3 py-2.5"></td>
                                {/* ★ 2026-07-30 일자행이 정확값(소수)이 되면서 세로합에 소수가 생긴다.
                                    표시 금액은 항목줄 절사 합(서버 lines — 청구서 1페이지와 같은 값)으로 통일한다.
                                    Σ소수를 floor하면 항목표와 1원 갈릴 수 있어 쓰지 않는다. */}
                                <td className="px-3 py-2.5 text-right tabular-nums font-bold text-indigo-800">{billingFmtWon(detailLines.length > 0 ? detailLines.reduce((s: number, l: any) => s + Number(l.amount), 0) : Math.floor(detailItems.reduce((s: number, i: any) => s + Number(i.amount), 0)))}</td>
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
                      {/* ★ 2026-08-05 목록과 같은 문구 — 이 줄은 **수금 축**이다(발행 액션은 오른쪽). */}
                      {detailBilling.status === 'draft' && (
                        <button onClick={() => handleBillingStatusChange(detailBilling.id, 'confirmed')}
                          title="수금 관리용 표시입니다. 이 금액으로 굳혔다는 뜻이고, 발송·세금계산서 발행과는 무관합니다. 확정 뒤에는 삭제할 때 사유가 필요합니다."
                          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">청구 확정</button>
                      )}
                      {detailBilling.status === 'confirmed' && (
                        <button onClick={() => handleBillingStatusChange(detailBilling.id, 'paid')}
                          title="입금을 받았다는 표시입니다. 총 정산표의 미납 집계에서 빠집니다."
                          className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">수금완료</button>
                      )}
                      <span className="text-[11px] text-gray-400">수금 관리 · 발행과 무관</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* ★ 2026-08-04 (서수란 접수) 상세 모달의 [정산서 발송]도 옛 경로(openEmailModal →
                          POST /:id/send-email)였다. 목록 버튼만 고치면 여기서 같은 문제가 그대로 재발한다 —
                          emailed_at만 찍히고 컨펌 추적행이 없어 그 청구서가 컨펌·세금계산서 흐름에서 빠진다.
                          발송은 아직 안 나간 장에 한해 **컨펌 경로 하나**로 통일한다. */}
                      {!detailBilling.emailed_at && (
                        <button onClick={() => handleRetryConfirmations(detailBilling.id, detailBilling.company_name)}
                          disabled={retryingBillingId === detailBilling.id}
                          title="거래내역서 PDF와 컨펌 링크를 등록된 정산 수신자에게 보냅니다"
                          className="px-4 py-1.5 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          {retryingBillingId === detailBilling.id ? '발송 중...' : '정산서 발송'}
                        </button>
                      )}
                      {/* ★ 2026-08-05 (서수란 접수) 목록과 같은 재발송 경로 — 상세에만 없으면 같은 접수가 다시 온다. */}
                      {detailBilling.emailed_at && (
                        <button onClick={() => openEmailModal(detailBilling)}
                          title="이미 발송된 거래내역서를 다시 보냅니다. 언제·누구에게 나갔는지 확인한 뒤에만 재발송됩니다."
                          className="px-4 py-1.5 text-sm border border-amber-300 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors flex items-center gap-1.5">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          거래내역서 재발송
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
                    {/* 등록된 수신자를 보여주되 칸에는 넣지 않는다 — 칸에 값이 있으면 서버가 override로 보고 참조를 뺀다 */}
                    {emailDefaultTo && !emailTo && (
                      <p className="mb-1.5 text-[11px] text-gray-500">
                        등록된 수신자 <span className="font-medium text-gray-700">{emailDefaultTo.primary}</span>
                        {emailDefaultTo.cc.length > 0 && ` · 참조 ${emailDefaultTo.cc.length}명`}
                        <span className="text-gray-400"> (비워두면 이대로 발송됩니다)</span>
                      </p>
                    )}
                    <input
                      type="email"
                      value={emailTo}
                      onChange={e => setEmailTo(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                      placeholder="다른 사람에게만 보낼 때만 입력"
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

                  {/* 본문 구성 — ★ 2026-07-26 목업 폐기.
                      본문은 서버가 청구 상세(billing_items)에서 만들고 항목합↔공급가액 정합 검사를 통과해야 나간다.
                      화면이 다른 본문을 그려두면 "미리보기와 실제가 다른" 거짓 표시가 된다. */}
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-gray-500 mb-1">본문 구성 (서버 생성)</label>
                    <div className="border rounded-lg p-3 bg-gray-50 text-xs text-gray-600 space-y-1.5 max-h-[140px] overflow-y-auto">
                      <p>안녕하세요, <strong>{emailTarget.company_name}</strong> 담당자님.</p>
                      <p><strong>{emailTarget.billing_year}년 {emailTarget.billing_month}월</strong> 정산서를 안내드립니다.</p>
                      <div className="bg-white rounded p-2 mt-2 border">
                        <div className="text-gray-500 mb-1">청구 항목표: 요금제 · 한줄로 · 에이전트 · 테스트 · 스팸필터 · AI 크레딧 (청구 상세와 동일)</div>
                        <div className="flex justify-between"><span className="text-gray-400">공급가액</span><span>{billingFmtWon(Number(emailTarget.subtotal || 0))}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">부가세</span><span>{billingFmtWon(Number(emailTarget.vat || 0))}</span></div>
                        <div className="flex justify-between border-t pt-1 mt-1"><span className="font-bold">합계</span><span className="font-bold text-indigo-700">{billingFmtWon(Number(emailTarget.total_amount || 0))}</span></div>
                      </div>
                      <p className="text-gray-400 mt-2">+ 정산서 PDF 첨부 (발송 시 자동 생성)</p>
                    </div>
                  </div>

                  {/* 발신 정보 */}
                  <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-400">
                    발신: {COMPANY_EMAIL} (하이웍스)
                  </div>

                  {/* ★ 2026-07-26 재발송 확인 — 서버가 409로 되돌린 경우에만 열린다.
                      같은 청구서가 확인 없이 두 번 고객에게 나가는 것을 막는다(메일은 회수 불가). */}
                  {emailResendInfo && (
                    <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-800">
                      <div className="font-semibold mb-0.5">이미 발송된 정산서입니다</div>
                      <div className="text-amber-700">{emailResendInfo}</div>
                      <div className="mt-1.5 text-amber-600">아래 &quot;재발송&quot;을 누르면 같은 청구서를 다시 보냅니다.</div>
                    </div>
                  )}
                </div>

                <div className="flex border-t">
                  <button
                    onClick={() => { setShowEmailModal(false); setEmailResendInfo(null); setEmailResendAt(null); }}
                    className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
                    disabled={emailSending}
                  >
                    취소
                  </button>
                  <button
                    onClick={() => handleSendBillingEmail(Boolean(emailResendInfo))}
                    disabled={emailSending}
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
                        {emailResendInfo ? '재발송' : '발송하기'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {/* 싱크에이전트 OS별 배포 위저드 탭 */}
      {activeTab === 'agentDeploy' && <AgentDeployWizard />}
      {/* Sync 모니터링 탭 */}
      {activeTab === 'syncAgents' && (
        <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
          <div className="px-6 py-4 border-b flex justify-between items-center">
            <h2 className="text-lg font-semibold">Sync Agent 모니터링</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setSyncReleaseForm({ version: '', checksum: '', force_update: true, tier: 'win-legacy' }); setShowSyncReleaseModal(true); }}
                className="text-sm text-violet-600 hover:text-violet-800 font-medium flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
                버전 배포
              </button>
              <button
                onClick={loadSyncAgents}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                새로고침
              </button>
            </div>
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
                      <td className="px-4 py-3 text-center">{getSyncOnlineBadge(agent.online_status, agent.status)}</td>
                      <td className="px-4 py-3 text-gray-500">{syncTimeAgo(agent.last_heartbeat_at)}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {syncTimeAgo(agent.last_sync_at)}
                        {/* ★ 2026-06-13: 통신은 정상인데 동기화만 3시간+ 멈춘 상태 표시 (인비토 6/13 06:00 중단 실측 후속) */}
                        {agent.is_online && agent.last_sync_at && (Date.now() - new Date(agent.last_sync_at).getTime() > 3 * 3600 * 1000) && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">동기화 지연</span>
                        )}
                      </td>
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
                              // ★ D131 후속: paused 상태면 기본값을 'resume'으로 자동 선택
                              setSyncCommandType(agent.status === 'paused' ? 'resume' : 'full_sync');
                              setShowSyncCommandModal(true);
                            }}
                            className="text-emerald-600 hover:text-emerald-800 text-xs font-medium px-2 py-1 rounded hover:bg-emerald-50"
                          >
                            명령
                          </button>
                          {/* ★ 2026-07-01: 매핑 — 원격 컬럼 매핑 편집(재설치 없이) */}
                          <button
                            onClick={() => openSyncMappingModal(agent)}
                            className="text-violet-600 hover:text-violet-800 text-xs font-medium px-2 py-1 rounded hover:bg-violet-50"
                          >
                            매핑
                          </button>
                          {/* ★ D131 후속(2026-04-21): 삭제 버튼 — 버려진/중복 Agent 정리 */}
                          <button
                            onClick={() => {
                              setSyncSelectedAgent(agent);
                              setShowSyncDeleteModal(true);
                            }}
                            className="text-red-600 hover:text-red-800 text-xs font-medium px-2 py-1 rounded hover:bg-red-50"
                          >
                            삭제
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

      {/* ★ D145 P0: 로그인 차단 관리 탭 */}
      {activeTab === 'loginBlocks' && (
        <LoginBlocksManagement />
      )}

      {/* ★ 2026-07-17 발송 라인 설정 탭 — LINE_GROUP_ADMIN_USERS(기본 ceo,admin) 전용 */}
      {activeTab === 'lineGroups' && lineGroupCanManage && (
        <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
          <div className="px-6 py-4 border-b flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">발송 라인 설정</h2>
              <p className="text-xs text-gray-500 mt-1">
                라인그룹은 발송 라우팅 축입니다. 바꾸면 적재·취소·집계·정산이 함께 움직입니다.
              </p>
            </div>
            <button
              onClick={() => setEditingLineGroup({ group_name: '', group_type: 'bulk', sms_tables: '', sort_order: lineGroups.length + 1, is_active: true })}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors whitespace-nowrap"
            >
              새 라인그룹
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">순서</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">그룹명</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">타입</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">발송 테이블</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">배정 고객사</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">상태</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 whitespace-nowrap">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {lineGroupsLoading ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-500">불러오는 중...</td></tr>
                ) : lineGroups.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-500">등록된 라인그룹이 없습니다.</td></tr>
                ) : (
                  lineGroups.map((lg: any) => {
                    const typeLabels: Record<string, { label: string; cls: string }> = {
                      bulk: { label: '대량발송', cls: 'bg-blue-100 text-blue-700' },
                      test: { label: '테스트', cls: 'bg-amber-100 text-amber-700' },
                      auth: { label: '인증', cls: 'bg-purple-100 text-purple-700' },
                      bito: { label: '자체 게이트웨이', cls: 'bg-emerald-100 text-emerald-700' },
                    };
                    const t = typeLabels[lg.group_type] || { label: lg.group_type, cls: 'bg-gray-100 text-gray-700' };
                    return (
                      <tr key={lg.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-center text-gray-500">{lg.sort_order}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-900">{lg.group_name}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${t.cls}`}>{t.label}</span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{(lg.sms_tables || []).join(', ')}</td>
                        <td className="px-4 py-2.5 text-center text-gray-700">{Number(lg.company_count || 0).toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${lg.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {lg.is_active ? '활성' : '비활성'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center whitespace-nowrap">
                          <button
                            onClick={() => setEditingLineGroup({ ...lg, sms_tables: (lg.sms_tables || []).join(', ') })}
                            className="px-2.5 py-1 text-xs border rounded-lg text-gray-700 hover:bg-gray-100"
                          >
                            수정
                          </button>
                          <button
                            onClick={() => handleDeleteLineGroup(lg)}
                            className="ml-1.5 px-2.5 py-1 text-xs border border-red-200 rounded-lg text-red-600 hover:bg-red-50"
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="px-6 py-3 border-t text-xs text-gray-400">
            고객사·사용자 배정은 [고객 관리 → 고객사 관리 → 수정 → 발송 라인] 및 [사용자 관리 → 수정 → 발송 라인그룹]에서 합니다.
          </div>
        </div>
      )}

      {/* ★ 2026-07-17 라인그룹 생성/수정 모달 */}
      {editingLineGroup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
              <h3 className="text-lg font-semibold text-gray-800">
                {editingLineGroup.id ? '라인그룹 수정' : '새 라인그룹'}
              </h3>
            </div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">그룹명 *</label>
                <input
                  type="text"
                  value={editingLineGroup.group_name}
                  onChange={(e) => setEditingLineGroup({ ...editingLineGroup, group_name: e.target.value })}
                  placeholder="비토게이트웨이 2"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">타입 *</label>
                <select
                  value={editingLineGroup.group_type}
                  onChange={(e) => setEditingLineGroup({ ...editingLineGroup, group_type: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="bulk">대량발송 (bulk)</option>
                  <option value="bito">자체 게이트웨이 (bito)</option>
                  <option value="test">테스트 (test)</option>
                  <option value="auth">인증 (auth)</option>
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  대량발송·자체 게이트웨이만 고객사/사용자 배정 드롭다운에 노출됩니다. 테스트·인증은 시스템 전용입니다.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">발송 테이블 *</label>
                <input
                  type="text"
                  value={editingLineGroup.sms_tables}
                  onChange={(e) => setEditingLineGroup({ ...editingLineGroup, sms_tables: e.target.value })}
                  placeholder="SMSQ_SEND_14"
                  className="w-full px-3 py-2 border rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <p className="text-xs text-gray-400 mt-1">
                  콤마로 구분. 2개 이상이면 라운드로빈으로 나눠 적재합니다. MySQL에 실재하는 테이블만 넣어야 합니다.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">정렬 순서</label>
                <input
                  type="number"
                  value={editingLineGroup.sort_order}
                  onChange={(e) => setEditingLineGroup({ ...editingLineGroup, sort_order: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              {editingLineGroup.id && (
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={!!editingLineGroup.is_active}
                    onChange={(e) => setEditingLineGroup({ ...editingLineGroup, is_active: e.target.checked })}
                    className="w-4 h-4"
                  />
                  활성 (비활성하면 이 라인으로 새 발송이 나가지 않습니다)
                </label>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingLineGroup(null)}
                  className="flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleSaveLineGroup}
                  disabled={lineGroupSaving}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {lineGroupSaving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ★ 2026-08-16 신규마케팅진단 탭 — ceo 전용(서버 게이트 404 은닉과 이중) */}
      {activeTab === 'marketingDiagnosis' && diagnosisAllowed && (
        <DiagnosisAdminPanel
          onBadgeRefresh={loadDiagnosisBadge}
          toast={(msg, type) => setBillingToast({ msg, type })}
        />
      )}

      {/* 감사 로그 탭 */}
      {activeTab === 'auditLogs' && auditAccessAllowed && (
        <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
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
              {auditActions.map(a => { const m={login_success:"로그인 성공",login_fail:"로그인 실패",login_blocked:"로그인 차단",customer_delete:"고객 삭제",customer_bulk_delete:"고객 선택삭제",customer_delete_all:"고객 전체삭제",customer_delete_by_user:"사용자별 고객 삭제",user_update:"사용자 수정",line_group_create:"라인그룹 생성",line_group_update:"라인그룹 수정",line_group_delete:"라인그룹 삭제",company_line_group_change:"회사 라인그룹 변경"} as any; return <option key={a} value={a}>{m[a]||a}</option>; })}
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
                      <div>{getSyncOnlineBadge(syncAgentDetail.agent?.online_status, syncAgentDetail.agent?.status)}</div>
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

                  {/* ★ 2026-07-10 원격 관리 P0: 에이전트 자기 보고 — 적용 매핑·소스 컬럼 (서버 사본, 진실 이원화 해소) */}
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">에이전트 자기 보고</h4>
                  {syncAgentDetail.agent?.reported ? (
                    <div className="border rounded-lg p-3 mb-5 text-xs space-y-2 bg-emerald-50/40 border-emerald-200">
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-gray-600">
                        <span>보고 시각 <b className="text-gray-800">{syncAgentDetail.agent.reported.reportedAt ? formatDateTimeShort(syncAgentDetail.agent.reported.reportedAt) : '-'}</b></span>
                        <span>매핑 해시 <b className="font-mono text-gray-800">{syncAgentDetail.agent.reported.configVersion || '-'}</b></span>
                        <span>고객 매핑 <b className="text-gray-800">{Object.keys(syncAgentDetail.agent.reported.appliedMapping?.customers || {}).length}건</b></span>
                        <span>구매 매핑 <b className="text-gray-800">{Object.keys(syncAgentDetail.agent.reported.appliedMapping?.purchases || {}).length}건</b></span>
                        <span>소스 컬럼 고객 <b className="text-gray-800">{(syncAgentDetail.agent.reported.sourceColumns?.customers || []).length}개</b>{syncAgentDetail.agent.reported.sourceColumns?.purchases ? <> · 구매 <b className="text-gray-800">{syncAgentDetail.agent.reported.sourceColumns.purchases.length}개</b></> : null}</span>
                      </div>
                      <details>
                        <summary className="cursor-pointer text-emerald-700 font-medium">적용 매핑 펼쳐보기</summary>
                        <div className="mt-2 grid grid-cols-2 gap-3">
                          <div>
                            <div className="text-gray-500 mb-1">고객</div>
                            <div className="bg-white border rounded p-2 max-h-40 overflow-y-auto font-mono text-[11px] space-y-0.5">
                              {Object.entries(syncAgentDetail.agent.reported.appliedMapping?.customers || {}).map(([s, t]: any) => (
                                <div key={s}>{s} → {String(t)}{/^custom_\d+$/.test(String(t)) && syncAgentDetail.agent.reported.appliedMapping?.customFieldLabels?.[String(t)] ? ` (${syncAgentDetail.agent.reported.appliedMapping.customFieldLabels[String(t)]})` : ''}</div>
                              ))}
                              {Object.keys(syncAgentDetail.agent.reported.appliedMapping?.customers || {}).length === 0 && <div className="text-gray-400">없음</div>}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">구매</div>
                            <div className="bg-white border rounded p-2 max-h-40 overflow-y-auto font-mono text-[11px] space-y-0.5">
                              {Object.entries(syncAgentDetail.agent.reported.appliedMapping?.purchases || {}).map(([s, t]: any) => (
                                <div key={s}>{s} → {String(t)}</div>
                              ))}
                              {Object.keys(syncAgentDetail.agent.reported.appliedMapping?.purchases || {}).length === 0 && <div className="text-gray-400">없음</div>}
                            </div>
                          </div>
                        </div>
                      </details>
                    </div>
                  ) : (
                    <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 mb-5 text-xs text-amber-800">
                      아직 자기 보고가 없습니다. 구버전(v1.6.1 미만) 또는 신버전 첫 heartbeat 전입니다.
                    </div>
                  )}

                  {/* ★ 2026-07-10 P1: 대기 명령 + 명령 결과 (ACK) */}
                  {(syncAgentDetail.agent?.pending_commands || []).length > 0 && (
                    <>
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">대기 중 명령</h4>
                      <div className="border rounded-lg p-3 mb-5 text-xs space-y-1">
                        {(syncAgentDetail.agent.pending_commands || []).map((c: any, i: number) => (
                          <div key={c.id || i} className="flex items-center justify-between gap-2">
                            <span className="font-medium text-gray-700">{c.type}</span>
                            <span className="text-gray-400">
                              등록 {c.created_at ? formatDateTimeShort(c.created_at) : '-'}
                              {c.attempts ? ` · 전달 ${c.attempts}회` : ' · 미전달'}
                              {c.delivered_at ? ` (최근 ${formatDateTimeShort(c.delivered_at)})` : ''}
                            </span>
                          </div>
                        ))}
                        <div className="text-gray-400 pt-1">{syncAgentDetail.agent?.supports_ack ? '에이전트 실행 확인(ACK) 수신 시 목록에서 사라집니다. 5회 재전달 미응답 시 실패로 만료됩니다.' : '구버전 에이전트: 다음 heartbeat에 전달 후 목록에서 사라집니다(결과 회신 없음).'}</div>
                      </div>
                    </>
                  )}
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">명령 결과 (최근 {(syncAgentDetail.agent?.command_results || []).length}건)</h4>
                  <div className="border rounded-lg overflow-hidden mb-5">
                    {(syncAgentDetail.agent?.command_results || []).length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-gray-400">
                        {syncAgentDetail.agent?.supports_ack ? '아직 회신된 명령 결과가 없습니다.' : '구버전 에이전트(v1.6.1 미만)는 명령 결과를 회신하지 않습니다.'}
                      </div>
                    ) : (
                      <div className="divide-y">
                        {[...(syncAgentDetail.agent.command_results || [])].reverse().map((r: any, i: number) => (
                          <div key={`${r.commandId || i}`} className="px-3 py-2 text-xs">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`px-1.5 py-0.5 rounded font-medium ${r.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{r.ok ? '성공' : '실패'}</span>
                              <span className="font-medium text-gray-700">{r.type}</span>
                              <span className="text-gray-400">{r.completedAt ? formatDateTimeShort(r.completedAt) : '-'}</span>
                            </div>
                            {r.message && <div className="mt-1 text-gray-600">{r.message}</div>}
                            {/* report_logs — 로그 열람 */}
                            {Array.isArray(r.data?.lines) && r.data.lines.length > 0 && (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-indigo-600">로그 {r.data.lines.length}줄 보기{r.data.truncated ? ' (앞부분 생략됨)' : ''}</summary>
                                <pre className="mt-1 bg-gray-900 text-gray-100 rounded p-2 max-h-64 overflow-auto text-[10px] leading-relaxed whitespace-pre-wrap">{r.data.lines.join('\n')}</pre>
                              </details>
                            )}
                            {/* mapping_dryrun — 소스 1행 → 매핑 결과 미리보기 */}
                            {(r.data?.customers || r.data?.purchases) && (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-indigo-600">매핑 미리보기 결과</summary>
                                <pre className="mt-1 bg-gray-50 border rounded p-2 max-h-64 overflow-auto text-[10px] leading-relaxed whitespace-pre-wrap">{JSON.stringify(r.data, null, 2)}</pre>
                              </details>
                            )}
                            {/* test_connection — 상세 */}
                            {typeof r.data?.connected === 'boolean' && (
                              <div className="mt-1 text-gray-500">연결 {r.data.connected ? '정상' : '실패'}{typeof r.data.customerColumns === 'number' ? ` · 고객 ${r.data.customerColumns}컬럼` : ''}{typeof r.data.purchaseColumns === 'number' ? ` · 구매 ${r.data.purchaseColumns}컬럼` : ''}{r.data.error ? ` · ${r.data.error}` : ''}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
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
                          <Fragment key={log.id}>
                          <tr className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-500">{(log.started_at || log.completed_at) ? formatDateTimeShort(log.started_at || log.completed_at) : '-'}</td>
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
                          {/* ★ 2026-06-13: 실패 행 상세(failures jsonb) — 어떤 행이 왜 실패했는지 표시 (식별 불가 구멍 해소) */}
                          {Array.isArray(log.failures) && log.failures.length > 0 && (
                            <tr className="bg-red-50/60">
                              <td colSpan={7} className="px-3 py-1.5 text-[11px] text-red-700">
                                실패 상세: {log.failures.slice(0, 5).map((f: any, i: number) => (
                                  <span key={i} className="mr-3 font-mono">{f.phone || '(번호 없음)'}: {f.reason || '원인 미기록'}</span>
                                ))}
                                {log.failures.length > 5 && <span className="text-red-400">외 {log.failures.length - 5}건</span>}
                              </td>
                            </tr>
                          )}
                          </Fragment>
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

      {/* ★ D131 후속(2026-04-21): Sync Agent 삭제 확인 모달 */}
      {showSyncDeleteModal && syncSelectedAgent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[420px] overflow-hidden animate-in fade-in zoom-in">
            <div className="p-5 border-b bg-gradient-to-r from-red-50 to-orange-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V4a2 2 0 012-2h4a2 2 0 012 2v3" /></svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-800">Agent 삭제</h3>
                  <p className="text-xs text-gray-500">{syncSelectedAgent.company_name} · {syncSelectedAgent.agent_name}</p>
                </div>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-gray-700">
                이 Agent 레코드를 서버에서 <b className="text-red-600">영구 삭제</b>합니다.
              </p>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600 space-y-1.5">
                <div className="flex justify-between"><span className="text-gray-500">Agent ID</span><span className="font-mono">{String(syncSelectedAgent.id).slice(0, 13)}…</span></div>
                <div className="flex justify-between"><span className="text-gray-500">버전</span><span>{syncSelectedAgent.agent_version || '-'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">마지막 heartbeat</span><span>{syncTimeAgo(syncSelectedAgent.last_heartbeat_at)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">동기화된 고객</span><span>{(syncSelectedAgent.total_customers_synced || 0).toLocaleString()}건</span></div>
              </div>
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                <div>⚠️ 이미 동기화된 고객 데이터는 유지되지만 <b>해당 Agent의 동기화 이력(sync_logs)은 함께 삭제</b>됩니다.</div>
                <div>⚠️ Agent가 아직 실행 중이면 다음 heartbeat 때 자동 재등록되어 레코드가 다시 생길 수 있습니다. 먼저 Agent 프로세스를 종료하세요.</div>
              </div>
            </div>
            <div className="flex border-t">
              <button
                onClick={() => setShowSyncDeleteModal(false)}
                disabled={syncDeleting}
                className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={() => handleSyncDelete(false)}
                disabled={syncDeleting}
                className="flex-1 px-4 py-3 text-red-600 font-medium hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                {syncDeleting ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ★ 2026-07-01: 원격 컬럼 매핑 편집 모달 (update_config) */}
      {showSyncMappingModal && syncSelectedAgent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-[680px] max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in">
            <div className="p-5 border-b bg-gradient-to-r from-violet-50 to-fuchsia-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-violet-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" /></svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-800">컬럼 매핑 편집</h3>
                  <p className="text-xs text-gray-500">{syncSelectedAgent.company_name} · {syncSelectedAgent.agent_name}</p>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-5 overflow-y-auto">
              {/* ★ 2026-07-10 P0: 에이전트 자기 보고 상태 배너 — 프리필 원천·구버전 정직 안내 */}
              {syncMapReportLoading ? (
                <div className="px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-500">
                  에이전트 보고(적용 매핑·소스 컬럼)를 불러오는 중...
                </div>
              ) : syncMapReported ? (
                <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    에이전트 보고 기준 프리필: 보고 {syncMapReported.reportedAt ? formatDateTimeShort(syncMapReported.reportedAt) : '-'}
                    {' '}· 매핑 해시 <span className="font-mono">{syncMapReported.configVersion || '-'}</span>
                    {' '}· 소스 컬럼 고객 {(syncMapReported.sourceColumns?.customers || []).length}개
                    {syncMapReported.sourceColumns?.purchases ? ` / 구매 ${syncMapReported.sourceColumns.purchases.length}개` : ''}
                  </div>
                  {(() => {
                    const used = new Set<string>();
                    for (const r of [...syncMapCustomers, ...syncMapPurchases]) {
                      if (/^custom_\d+$/.test(r.target)) used.add(r.target);
                    }
                    return (
                      <span className={`px-2 py-0.5 rounded-full font-medium ${used.size >= 15 ? 'bg-red-100 text-red-700' : 'bg-violet-100 text-violet-700'}`}>
                        custom 슬롯 {used.size}/15 사용 · 잔여 {Math.max(0, 15 - used.size)}
                      </span>
                    );
                  })()}
                </div>
              ) : (
                <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  에이전트 보고 대기. 현재 적용 매핑을 아직 보고하지 않았습니다(구버전 v{syncSelectedAgent.agent_version || '?'} 또는 첫 heartbeat 전).
                  기존 매핑을 볼 수 없는 상태의 저장은 <b>매핑 전체 소실</b> 위험이 있어 차단됩니다. v1.6.1 이상 배포 후 사용해주세요.
                </div>
              )}

              {/* 고객 매핑 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">고객 매핑</label>
                  <button
                    onClick={() => setSyncMapCustomers([...syncMapCustomers, { src: '', target: '', label: '' }])}
                    className="text-xs text-violet-600 hover:text-violet-800 font-medium"
                  >+ 행 추가</button>
                </div>
                <div className="space-y-2">
                  {syncMapCustomers.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {/* ★ 2026-07-10 P0: 소스 컬럼 = 보고된 실컬럼 드롭다운(자유 타이핑 폐지 — 오타 매핑 차단). 보고 없으면 입력 유지 */}
                      {(syncMapReported?.sourceColumns?.customers || []).length > 0 ? (
                        <select
                          value={row.src}
                          onChange={(e) => { const n = [...syncMapCustomers]; n[i] = { ...n[i], src: e.target.value }; setSyncMapCustomers(n); }}
                          className="flex-1 px-2 py-1.5 border rounded-lg text-xs bg-white focus:ring-2 focus:ring-violet-500 outline-none"
                        >
                          <option value="">소스 컬럼 선택</option>
                          {row.src && !(syncMapReported.sourceColumns.customers as string[]).includes(row.src) && (
                            <option value={row.src}>{row.src} (보고 목록 밖)</option>
                          )}
                          {(syncMapReported.sourceColumns.customers as string[]).map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : (
                        <input
                          placeholder="소스 컬럼 (예: 신규등록일자)"
                          value={row.src}
                          onChange={(e) => { const n = [...syncMapCustomers]; n[i] = { ...n[i], src: e.target.value }; setSyncMapCustomers(n); }}
                          className="flex-1 px-2 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-violet-500 outline-none"
                        />
                      )}
                      <span className="text-gray-400 text-xs">→</span>
                      <select
                        value={row.target}
                        onChange={(e) => { const n = [...syncMapCustomers]; n[i] = { ...n[i], target: e.target.value }; setSyncMapCustomers(n); }}
                        className="w-36 px-2 py-1.5 border rounded-lg text-xs bg-white focus:ring-2 focus:ring-violet-500 outline-none"
                      >
                        <option value="">타겟 선택</option>
                        {SYNC_CUSTOMER_TARGET_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                      {/^custom_\d+$/.test(row.target) && (
                        <input
                          placeholder="라벨 (예: 등록일자)"
                          value={row.label}
                          onChange={(e) => { const n = [...syncMapCustomers]; n[i] = { ...n[i], label: e.target.value }; setSyncMapCustomers(n); }}
                          className="w-28 px-2 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-violet-500 outline-none"
                        />
                      )}
                      <button
                        onClick={() => setSyncMapCustomers(syncMapCustomers.filter((_, j) => j !== i))}
                        className="text-red-400 hover:text-red-600 text-sm px-1"
                        title="행 삭제"
                      >✕</button>
                    </div>
                  ))}
                  {syncMapCustomers.length === 0 && !syncMapReportLoading && (
                    <p className="text-xs text-gray-400">{syncMapReported ? '보고된 고객 매핑이 없습니다. 행 추가로 입력하세요.' : '행 추가로 매핑을 입력하세요.'}</p>
                  )}
                </div>
              </div>

              {/* 구매 매핑 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">구매 매핑</label>
                  <button
                    onClick={() => setSyncMapPurchases([...syncMapPurchases, { src: '', target: '', label: '' }])}
                    className="text-xs text-violet-600 hover:text-violet-800 font-medium"
                  >+ 행 추가</button>
                </div>
                <div className="space-y-2">
                  {syncMapPurchases.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {(syncMapReported?.sourceColumns?.purchases || []).length > 0 ? (
                        <select
                          value={row.src}
                          onChange={(e) => { const n = [...syncMapPurchases]; n[i] = { ...n[i], src: e.target.value }; setSyncMapPurchases(n); }}
                          className="flex-1 px-2 py-1.5 border rounded-lg text-xs bg-white focus:ring-2 focus:ring-violet-500 outline-none"
                        >
                          <option value="">소스 컬럼 선택</option>
                          {row.src && !(syncMapReported.sourceColumns.purchases as string[]).includes(row.src) && (
                            <option value={row.src}>{row.src} (보고 목록 밖)</option>
                          )}
                          {(syncMapReported.sourceColumns.purchases as string[]).map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : (
                        <input
                          placeholder="소스 컬럼 (예: 고객전화)"
                          value={row.src}
                          onChange={(e) => { const n = [...syncMapPurchases]; n[i] = { ...n[i], src: e.target.value }; setSyncMapPurchases(n); }}
                          className="flex-1 px-2 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-violet-500 outline-none"
                        />
                      )}
                      <span className="text-gray-400 text-xs">→</span>
                      <select
                        value={row.target}
                        onChange={(e) => { const n = [...syncMapPurchases]; n[i] = { ...n[i], target: e.target.value }; setSyncMapPurchases(n); }}
                        className="w-36 px-2 py-1.5 border rounded-lg text-xs bg-white focus:ring-2 focus:ring-violet-500 outline-none"
                      >
                        <option value="">타겟 선택</option>
                        {SYNC_PURCHASE_TARGET_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                      <button
                        onClick={() => setSyncMapPurchases(syncMapPurchases.filter((_, j) => j !== i))}
                        className="text-red-400 hover:text-red-600 text-sm px-1"
                        title="행 삭제"
                      >✕</button>
                    </div>
                  ))}
                  {syncMapPurchases.length === 0 && <p className="text-xs text-gray-400">구매 매핑이 없으면 비워두세요.</p>}
                </div>
              </div>

              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                <div>• <b>저장은 전송한 대상의 매핑 전체를 교체</b>합니다. 남길 매핑도 화면에 남아 있어야 합니다.</div>
                <div>• 저장 시 Agent가 다음 heartbeat(최대 60분)에 매핑을 갱신하고 <b>바뀐 대상만</b> 전체 재동기화합니다.</div>
                <div>• custom 슬롯은 라벨이 화면 표시명이 됩니다(비우면 슬롯명 표시).</div>
                <div>• <b>미리보기(dry-run)</b>는 소스 1행에 적용한 결과만 회신하고 저장·적용하지 않습니다. 결과는 상세의 "명령 결과"에 도착합니다.</div>
              </div>
            </div>

            <div className="flex border-t">
              <button
                onClick={() => setShowSyncMappingModal(false)}
                disabled={syncMapSaving || syncMapDryRunning}
                className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r disabled:opacity-50"
              >취소</button>
              {/* ★ 2026-07-10 P2-9: dry-run — v1.6.1+(ACK) 전용 */}
              <button
                onClick={handleSyncMappingDryRun}
                disabled={syncMapSaving || syncMapDryRunning || !syncMapAckSupported}
                title={!syncMapAckSupported ? '에이전트 v1.6.1 이상에서 지원' : undefined}
                className="flex-1 px-4 py-3 text-indigo-600 font-medium hover:bg-indigo-50 transition-colors border-r disabled:opacity-50"
              >{syncMapDryRunning ? '전송 중...' : '미리보기(dry-run)'}</button>
              <button
                onClick={handleSyncMappingSave}
                disabled={syncMapSaving || syncMapDryRunning || syncMapReportLoading || !syncMapReported}
                title={!syncMapReported ? '에이전트 보고 수신 후 저장 가능(빈 화면 저장 차단)' : undefined}
                className="flex-1 px-4 py-3 text-violet-600 font-medium hover:bg-violet-50 transition-colors disabled:opacity-50"
              >{syncMapSaving ? '전송 중...' : '매핑 저장 및 전송'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ★ 2026-07-01: 자동 업데이트 릴리즈 등록 모달 */}
      {showSyncReleaseModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-[460px] overflow-hidden animate-in fade-in zoom-in">
            <div className="p-5 border-b bg-gradient-to-r from-violet-50 to-indigo-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-violet-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-800">Agent 버전 배포</h3>
                  <p className="text-xs text-gray-500">서버 exe 업로드 후 등록 → 각 Agent가 매시간 자동 수령·교체</p>
                </div>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs text-gray-500 font-medium mb-1.5 block">버전 (x.y.z)</label>
                <input
                  value={syncReleaseForm.version}
                  onChange={(e) => setSyncReleaseForm({ ...syncReleaseForm, version: e.target.value })}
                  placeholder="1.5.7"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium mb-1.5 block">OS 티어 (이 exe가 도는 환경)</label>
                <select
                  value={syncReleaseForm.tier}
                  onChange={(e) => setSyncReleaseForm({ ...syncReleaseForm, tier: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-violet-500 outline-none"
                >
                  <option value="win-legacy">win-legacy: Windows 7 · Server 2008 R2 (isae)</option>
                  <option value="win-mid">win-mid: Windows 8.1 · Server 2012 R2</option>
                  <option value="win-modern">win-modern: Windows 10/11 · Server 2016+</option>
                  <option value="linux-legacy">linux-legacy: CentOS 7 · RHEL 7</option>
                  <option value="linux-modern">linux-modern: Ubuntu 20+ · RHEL 8+</option>
                </select>
                <p className="text-[11px] text-gray-400 mt-1">이 티어의 에이전트에게만 배포됩니다(다른 티어 오배포 차단).</p>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium mb-1.5 block">체크섬 (SHA-256, 선택)</label>
                <input
                  value={syncReleaseForm.checksum}
                  onChange={(e) => setSyncReleaseForm({ ...syncReleaseForm, checksum: e.target.value })}
                  placeholder="서버 sha256sum 결과 (무결성 검증용)"
                  className="w-full px-3 py-2 border rounded-lg text-sm font-mono focus:ring-2 focus:ring-violet-500 outline-none"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={syncReleaseForm.force_update} onChange={(e) => setSyncReleaseForm({ ...syncReleaseForm, force_update: e.target.checked })} className="text-violet-600" />
                강제 업데이트 (감지 즉시 교체)
              </label>
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                <div>• 먼저 <code className="bg-amber-100 px-1 rounded">sync-agent-{'{버전}'}.exe</code>를 서버 <code className="bg-amber-100 px-1 rounded">agent-releases/</code>에 업로드하세요.</div>
                <div>• 등록하면 각 Agent가 다음 정각(매시간) 버전 확인 때 자동으로 받아 교체합니다(박스 원격 불필요).</div>
              </div>
            </div>
            <div className="flex border-t">
              <button
                onClick={() => setShowSyncReleaseModal(false)}
                disabled={syncReleaseSaving}
                className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r disabled:opacity-50"
              >취소</button>
              <button
                onClick={handleSyncReleaseSubmit}
                disabled={syncReleaseSaving}
                className="flex-1 px-4 py-3 text-violet-600 font-medium hover:bg-violet-50 transition-colors disabled:opacity-50"
              >{syncReleaseSaving ? '등록 중...' : '릴리즈 등록'}</button>
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
              {/* ★ D131 후속(2026-04-21 3차 수정): 자동 선택/비활성 로직 복원.
                  백엔드가 pause/resume 명령 등록 시 sync_agents.status를 즉시 UPDATE하므로
                  UI가 DB 실시간 상태 기반으로 재개/일시정지 활성화 판단 가능 (heartbeat 지연 없음).
                  - paused: pause/full_sync 비활성 (무의미), resume/restart 활성
                  - active: resume 비활성 (재개할 게 없음), pause/full_sync/restart 활성
                  - offline: 경고 + 모두 활성 (Agent 복귀 후 실행) */}
              {(() => {
                const isPaused = syncSelectedAgent.status === 'paused';
                const isOffline = syncSelectedAgent.status === 'inactive' || syncSelectedAgent.status === 'error';
                return (
                  <>
                    {isOffline && (
                      <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
                        ⚠️ Agent 오프라인 상태입니다. 명령은 Agent 복귀 후 실행됩니다.
                      </div>
                    )}
                    {isPaused && (
                      <div className="px-3 py-2 rounded-lg bg-orange-50 border border-orange-200 text-xs text-orange-700">
                        ⏸️ 현재 일시정지 상태입니다. <b>재개</b> 명령을 선택하세요.
                      </div>
                    )}
                    <div className="space-y-2">
                      <label className={`flex items-center gap-3 p-3 border rounded-lg transition-colors ${syncCommandType === 'full_sync' ? 'border-emerald-500 bg-emerald-50' : 'hover:bg-gray-50'} ${isPaused ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                        <input type="radio" name="cmdType" value="full_sync" checked={syncCommandType === 'full_sync'} onChange={() => setSyncCommandType('full_sync')} className="text-emerald-600" disabled={isPaused} />
                        <div>
                          <div className="text-sm font-medium text-gray-800">🔄 전체 동기화</div>
                          <div className="text-xs text-gray-500">{isPaused ? '일시정지 중: 재개 후 실행 가능' : '모든 고객/구매 데이터를 다시 동기화합니다'}</div>
                        </div>
                      </label>
                      <label className={`flex items-center gap-3 p-3 border rounded-lg transition-colors ${syncCommandType === 'pause' ? 'border-orange-500 bg-orange-50' : 'hover:bg-gray-50'} ${isPaused ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                        <input type="radio" name="cmdType" value="pause" checked={syncCommandType === 'pause'} onChange={() => setSyncCommandType('pause')} className="text-orange-600" disabled={isPaused} />
                        <div>
                          <div className="text-sm font-medium text-gray-800">⏸️ 동기화 일시정지</div>
                          <div className="text-xs text-gray-500">{isPaused ? '이미 일시정지 상태입니다' : '스케줄러만 중단 (Agent는 계속 살아있음, heartbeat 유지)'}</div>
                        </div>
                      </label>
                      <label className={`flex items-center gap-3 p-3 border rounded-lg transition-colors ${syncCommandType === 'resume' ? 'border-blue-500 bg-blue-50' : 'hover:bg-gray-50'} ${!isPaused ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                        <input type="radio" name="cmdType" value="resume" checked={syncCommandType === 'resume'} onChange={() => setSyncCommandType('resume')} className="text-blue-600" disabled={!isPaused} />
                        <div>
                          <div className="text-sm font-medium text-gray-800">▶️ 동기화 재개</div>
                          <div className="text-xs text-gray-500">{!isPaused ? '이미 실행 중입니다' : '일시정지된 스케줄러를 다시 시작합니다'}</div>
                        </div>
                      </label>
                      <label className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${syncCommandType === 'restart' ? 'border-emerald-500 bg-emerald-50' : 'hover:bg-gray-50'}`}>
                        <input type="radio" name="cmdType" value="restart" checked={syncCommandType === 'restart'} onChange={() => setSyncCommandType('restart')} className="text-emerald-600" />
                        <div>
                          <div className="text-sm font-medium text-gray-800">🔁 Agent 재시작</div>
                          <div className="text-xs text-gray-500">Agent 프로세스를 종료 (서비스로 설치된 경우 자동 재시작)</div>
                        </div>
                      </label>
                      {/* ★ 2026-07-10 원격 관리 P2: 진단 2종 — v1.6.1+(결과 회신 지원) 전용 */}
                      {(() => {
                        const ackOk = syncAgentSupportsAck(syncSelectedAgent.agent_version);
                        return (
                          <>
                            <label className={`flex items-center gap-3 p-3 border rounded-lg transition-colors ${syncCommandType === 'report_logs' ? 'border-indigo-500 bg-indigo-50' : 'hover:bg-gray-50'} ${!ackOk ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                              <input type="radio" name="cmdType" value="report_logs" checked={syncCommandType === 'report_logs'} onChange={() => setSyncCommandType('report_logs')} className="text-indigo-600" disabled={!ackOk} />
                              <div>
                                <div className="text-sm font-medium text-gray-800">📄 최근 로그 요청</div>
                                <div className="text-xs text-gray-500">{ackOk ? '에이전트 최근 로그 200줄을 회신받아 상세에서 열람' : 'v1.6.1 이상에서 지원'}</div>
                              </div>
                            </label>
                            <label className={`flex items-center gap-3 p-3 border rounded-lg transition-colors ${syncCommandType === 'test_connection' ? 'border-cyan-500 bg-cyan-50' : 'hover:bg-gray-50'} ${!ackOk ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                              <input type="radio" name="cmdType" value="test_connection" checked={syncCommandType === 'test_connection'} onChange={() => setSyncCommandType('test_connection')} className="text-cyan-600" disabled={!ackOk} />
                              <div>
                                <div className="text-sm font-medium text-gray-800">🔌 소스 DB 연결 테스트</div>
                                <div className="text-xs text-gray-500">{ackOk ? '고객사 소스 DB 연결·컬럼 조회 상태를 회신받아 확인' : 'v1.6.1 이상에서 지원'}</div>
                              </div>
                            </label>
                          </>
                        );
                      })()}
                    </div>
                  </>
                );
              })()}
              <p className="text-xs text-gray-400">명령 등록 시 상태가 즉시 반영됩니다. Agent는 다음 heartbeat(최대 60분) 때 실제 실행합니다.</p>
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
                {/* ★ 2026-08-19 전송자격인증 2.3 — 명의 확인 건은 사유와 소명을 보고 판단한다 */}
                {depositTarget.held_reason && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 space-y-1.5">
                    <div className="text-xs font-semibold text-rose-700">명의 확인 필요</div>
                    <div className="text-xs text-rose-800 leading-relaxed">{depositTarget.held_reason}</div>
                    <div className="text-[11px] text-gray-600 leading-relaxed border-t border-rose-200 pt-1.5">
                      <span className="font-medium">고객사 소명</span>
                      {' · '}
                      {depositTarget.explanation_note
                        ? depositTarget.explanation_note
                        : <span className="text-gray-400">아직 제출되지 않았습니다</span>}
                    </div>
                  </div>
                )}
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
