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
import ListPager, { pageSlice } from '../components/shared/ListPager'; // ★ 2026-10-07 목록 쪽 넘김(20건)
import { readAlimtalkSplit, alimtalkFallbackRows } from '../utils/alimtalk-split'; // ★ 2026-10-07 알림톡 시도 · 대체 문자 분리
import LoginBlocksManagement from '../components/admin/LoginBlocksManagement'; // ★ D145 P0 (2026-05-07): 로그인 차단 관리 (B안: IP+loginId 쌍)
import AgentChargePanel from '../components/AgentChargePanel'; // ★ 2026-07-24 §5-3 에이전트 충전 실행 (게이트웨이 지갑)
import AgentDeployWizard from '../components/admin/AgentDeployWizard'; // 싱크에이전트 OS별 배포 위저드
import DiagnosisAdminPanel from '../components/admin/DiagnosisAdminPanel'; // ★ 2026-08-16 신규마케팅진단(ceo 전용)
import PlanTermBox, { PlanTermLockNote } from '../components/admin/PlanTermBox'; // ★ 2026-10-04 선불 요금제 이용 기간
import HelpQuestionsTab from '../components/admin/HelpQuestionsTab'; // ★ 2026-08-24 도움말 질문 이력(ceo 전용)
import FeatureInterestTab from '../components/admin/FeatureInterestTab'; // ★ 2026-10-06 기능 관심 업체(ceo 전용)
import IdentityStatusTab from '../components/admin/IdentityStatusTab'; // ★ 2026-10-07 본인인증 현황(ceo 전용)
import IntroLeadsTab from '../components/admin/IntroLeadsTab'; // ★ 2026-10-07 소개 방문 · 시연 요청(ceo · suran)
import WatchLogTab from '../components/admin/WatchLogTab'; // ★ 2026-10-07 감시 기록(ceo 전용)
import PrecheckUsageTab from '../components/admin/PrecheckUsageTab'; // ★ 2026-09-26 스팸 검사·맞춤법 사용 현황(ceo 전용)
import AgencyEmailSendersModal from '../components/admin/AgencyEmailSendersModal'; // ★ 2026-08-26 대행발송 허용 발신 이메일(§18)
import AgencyMailIntakePanel from '../components/admin/AgencyMailIntakePanel'; // ★ 2026-08-26 대행발송 메일 접수 관제(§18)
import AgencySendLedgerPanel from '../components/admin/AgencySendLedgerPanel'; // ★ 2026-08-26(2) 대행발송 내역(전 고객사 진행현황)
import { AUDIT_ACTION_COLOR, AUDIT_ACTION_LABEL, formatAuditDetail } from '../constants/audit-action-labels'; // ★ 2026-08-24 감사 액션 한글화 CT
import { resolveSpamHitSourceLabel, resolveSpamRuleSourceLabel } from '../constants/spam-block-labels'; // ★1003 금칙어 화면 내부 코드 표시명
import { COMPANY_EMAIL } from '../constants/company';
import { formatAgentIdLabel } from '../utils/agentLabel'; // ★ 2026-07-27 발송ID 표시 규칙 단일 소스(발급명 병기)
import { formatPlanOptionLabel } from '../utils/planLabel'; // ★ 2026-07-28 요금제 라벨 = 월정액(고객 수 축 폐기)
import { taxbillIssueDatePreviewText, type TaxbillDayPolicy } from '../utils/taxbillDate'; // ★ 2026-07-28 작성일자 미리보기(예시 월 하드코딩 제거)
// ★ 2026-08-04 IMC 이관 모달 — 템플릿 화면에서는 이미 연결된 프로필로 템플릿만 가져온다(templateOnly)
import ImcProfileImportModal from '../components/alimtalk/ImcProfileImportModal';
import OpsRecordsTab from '../components/admin/OpsRecordsTab'; // ★ 2026-10-03 운영 기록 대장(전송자격인증 3.1 ④ · 3.3 · 4.3)
import Billing080Modal from '../components/Billing080Modal'; // ★ 2026-07-30 추가 청구 관리 (서수란 접수 — 080 KT 명세서 분할 + 부가서비스 수기)
import MinimumChargeModal from '../components/MinimumChargeModal'; // ★ 2026-07-30 최소과금 정액 발행 (Harold 확정)
import SettlementOverviewModal from '../components/SettlementOverviewModal'; // ★ 2026-08-05 총 정산표 (ceo 전용)
import QtyAdjustModal, { type QtyAdjustTarget } from '../components/QtyAdjustModal'; // ★ 2026-08-04 수량 수정 발행 (서수란 접수)
import { creditTxLabel } from '../constants/credit'; // 크레딧 사용 이력 작업명 라벨
import { resolveChannelLabel, resolveSendTypeChipClass, resolveSendTypeLabel } from '../utils/campaign-axis';

import type { Company, Plan, User, ModalState } from '../components/admin/admin-types'; // ★ 2026-10-09 분리 E
import PlansTab from '../components/admin/tabs/PlansTab'; // ★ 2026-10-09 분리 E
import CompaniesTab from '../components/admin/tabs/CompaniesTab'; // ★ 2026-10-09 분리 E
import UsersTab from '../components/admin/tabs/UsersTab'; // ★ 2026-10-09 분리 E
import ScheduledTab from '../components/admin/tabs/ScheduledTab'; // ★ 2026-10-09 분리 E
import CallbacksTab from '../components/admin/tabs/CallbacksTab'; // ★ 2026-10-09 분리 E
import AdminAccountsTab from '../components/admin/tabs/AdminAccountsTab'; // ★ 2026-10-09 분리 E
import GeoAccessTab from '../components/admin/tabs/GeoAccessTab'; // ★ 2026-10-09 분리 E
import SpamBlockTab from '../components/admin/tabs/SpamBlockTab'; // ★ 2026-10-09 분리 E
import PlanRequestsTab from '../components/admin/tabs/PlanRequestsTab'; // ★ 2026-10-09 분리 E
import CreditsTab from '../components/admin/tabs/CreditsTab'; // ★ 2026-10-09 분리 E
import DepositsTab from '../components/admin/tabs/DepositsTab'; // ★ 2026-10-09 분리 E
import AllCampaignsTab from '../components/admin/tabs/AllCampaignsTab'; // ★ 2026-10-09 분리 E
import SendStatsTab from '../components/admin/tabs/SendStatsTab'; // ★ 2026-10-09 분리 E
import TemplatesTab from '../components/admin/tabs/TemplatesTab'; // ★ 2026-10-09 분리 E
import SyncAgentsTab from '../components/admin/tabs/SyncAgentsTab'; // ★ 2026-10-09 분리 E
import LineGroupsTab from '../components/admin/tabs/LineGroupsTab'; // ★ 2026-10-09 분리 E
import AuditLogsTab from '../components/admin/tabs/AuditLogsTab'; // ★ 2026-10-09 분리 E
import AdminCreateModal from '../components/admin/modals/AdminCreateModal'; // ★ 2026-10-09 분리 E
import AdminActiveEditModal from '../components/admin/modals/AdminActiveEditModal'; // ★ 2026-10-09 분리 E
import AdminRoleEditModal from '../components/admin/modals/AdminRoleEditModal'; // ★ 2026-10-09 분리 E
import TemplateDetailModal from '../components/admin/modals/TemplateDetailModal'; // ★ 2026-10-09 분리 E
import ManualTemplateFormModal from '../components/admin/modals/ManualTemplateFormModal'; // ★ 2026-10-09 분리 E
import TemplateRejectModal from '../components/admin/modals/TemplateRejectModal'; // ★ 2026-10-09 분리 E
import CompanyCreateModal from '../components/admin/modals/CompanyCreateModal'; // ★ 2026-10-09 분리 E
import UserCreateModal from '../components/admin/modals/UserCreateModal'; // ★ 2026-10-09 분리 E
import UserEditModal from '../components/admin/modals/UserEditModal'; // ★ 2026-10-09 분리 E
import CompanyDetailModal from '../components/admin/company-detail/CompanyDetailModal'; // ★ 2026-10-09 분리 E
import SmsDetailModal from '../components/admin/modals/SmsDetailModal'; // ★ 2026-10-09 분리 E
import CancelScheduledModal from '../components/admin/modals/CancelScheduledModal'; // ★ 2026-10-09 분리 E
import CallbackEditModal from '../components/admin/modals/CallbackEditModal'; // ★ 2026-10-09 분리 E
import CallbackCreateModal from '../components/admin/modals/CallbackCreateModal'; // ★ 2026-10-09 분리 E
import SenderRegDetailModal from '../components/admin/modals/SenderRegDetailModal'; // ★ 2026-10-09 분리 E
import PlanCreateModal from '../components/admin/modals/PlanCreateModal'; // ★ 2026-10-09 분리 E
import PlanEditModal from '../components/admin/modals/PlanEditModal'; // ★ 2026-10-09 분리 E
import StatsDetailModal from '../components/admin/modals/StatsDetailModal'; // ★ 2026-10-09 분리 E
import LineGroupEditModal from '../components/admin/modals/LineGroupEditModal'; // ★ 2026-10-09 분리 E
import SyncDetailModal from '../components/admin/modals/SyncDetailModal'; // ★ 2026-10-09 분리 E
import SyncConfigModal from '../components/admin/modals/SyncConfigModal'; // ★ 2026-10-09 분리 E
import SyncDeleteModal from '../components/admin/modals/SyncDeleteModal'; // ★ 2026-10-09 분리 E
import SyncMappingModal from '../components/admin/modals/SyncMappingModal'; // ★ 2026-10-09 분리 E
import SyncReleaseModal from '../components/admin/modals/SyncReleaseModal'; // ★ 2026-10-09 분리 E
import SyncCommandModal from '../components/admin/modals/SyncCommandModal'; // ★ 2026-10-09 분리 E
import RequestRejectModal from '../components/admin/modals/RequestRejectModal'; // ★ 2026-10-09 분리 E
import DepositApproveModal from '../components/admin/modals/DepositApproveModal'; // ★ 2026-10-09 분리 E
import DepositRejectModal from '../components/admin/modals/DepositRejectModal'; // ★ 2026-10-09 분리 E
import AdminCustomerDeleteModal from '../components/admin/modals/AdminCustomerDeleteModal'; // ★ 2026-10-09 분리 E
import CustomerDeleteAllModal from '../components/admin/modals/CustomerDeleteAllModal'; // ★ 2026-10-09 분리 E
import { AdminPill, PILL } from '../components/admin/ui/admin-ui'; // ★ 2026-10-09 슈퍼관리자 다듬기(목업 v2)

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const [activeTab, setActiveTab] = useState<'companies' | 'users' | 'scheduled' | 'callbacks' | 'plans' | 'requests' | 'deposits' | 'credits' | 'allCampaigns' | 'stats' | 'billing' | 'syncAgents' | 'auditLogs' | 'lineGroups' | 'templates' | 'loginBlocks' | 'agentDeploy' | 'marketingDiagnosis' | 'spamBlock' | 'geoAccess' | 'helpQuestions' | 'agencyMail' | 'agencyLedger' | 'adminAccounts' | 'precheckUsage' | 'featureInterest' | 'identityStatus' | 'introLeads' | 'watchLog' | 'opsRecords'>('companies');
  // ★ 2026-06-11: 감사 로그 열람 권한 (AUDIT_LOG_VIEWER_IDS — 기본 ceo 전용) — 허용 계정에만 메뉴/탭 노출
  const [auditAccessAllowed, setAuditAccessAllowed] = useState(false);
  // ★ 2026-08-27 직원 계정·권한 (전송자격인증 3.2·3.3) — 권한분류표 원본은 서버(utils/admin-role.ts)
  const [adminAccountsAllowed, setAdminAccountsAllowed] = useState(false);
  const [adminAccounts, setAdminAccounts] = useState<any[]>([]);
  const [adminMatrix, setAdminMatrix] = useState<any[]>([]);
  const [adminRoleOptions, setAdminRoleOptions] = useState<any[]>([]);
  const [adminLevelLabels, setAdminLevelLabels] = useState<Record<string, string>>({});
  const [adminRoleHistory, setAdminRoleHistory] = useState<any[]>([]);
  // ★ 2026-10-07 쪽 넘김(20건 · 받아 둔 목록을 자른다)
  const [adminAccountsPage, setAdminAccountsPage] = useState(1);
  const [adminRoleHistoryPage, setAdminRoleHistoryPage] = useState(1);
  const [adminRoleEdit, setAdminRoleEdit] = useState<{ id: string; login_id: string; role: string; reason: string } | null>(null);
  const [adminCreate, setAdminCreate] = useState<{ loginId: string; name: string; email: string; role: string; password: string; reason: string } | null>(null);
  const [adminActiveEdit, setAdminActiveEdit] = useState<{ id: string; login_id: string; isActive: boolean; reason: string } | null>(null);
  const [adminRoleBusy, setAdminRoleBusy] = useState(false);
  // ★ 2026-10-03 지원팀장은 직원 계정을 조회만 — 등급 · 계정 추가 · 중지 버튼은 서버가 준 canWrite 일 때만 보인다
  const [adminAccountsCanWrite, setAdminAccountsCanWrite] = useState(false);
  // ★ 2026-10-03 보안 · 인증 묶음(대표 · 지원팀장) 메뉴 노출 — 서버 GET /api/admin/my-permissions 의 canRead 가 유일 소스.
  //   화면은 숨기기만 한다(실제 차단은 라우트가 같은 등급표로). 조회 실패 = 빈 값 = 숨김(닫힌 쪽으로).
  const [myPermRead, setMyPermRead] = useState<Record<string, boolean>>({});
  const [helpQAccessAllowed, setHelpQAccessAllowed] = useState(false); // ★ 2026-08-24 도움말 질문 이력(ceo 전용)
  const [featureInterestAllowed, setFeatureInterestAllowed] = useState(false); // ★ 2026-10-06 기능 관심 업체(ceo 전용)
  const [identityStatusAllowed, setIdentityStatusAllowed] = useState(false); // ★ 2026-10-07 본인인증 현황(ceo 전용)
  const [introLeadsAllowed, setIntroLeadsAllowed] = useState(false); // ★ 2026-10-07 소개 방문 · 시연 요청(ceo · suran)
  const [watchLogAllowed, setWatchLogAllowed] = useState(false); // ★ 2026-10-07 감시 기록(ceo 전용)
  const [precheckUsageAllowed, setPrecheckUsageAllowed] = useState(false); // ★ 2026-09-26 스팸 검사·맞춤법 사용 현황(ceo 전용)
  // ★ 2026-08-24 AI 영업 아웃리치(ceo 전용 · 모달) — 서버 /access가 유일 소스, 미허용 = 메뉴 자체 미노출
  const [outreachAllowed, setOutreachAllowed] = useState(false);
  // ★ 2026-09-14 (Harold) AI 영업 뱃지 제거 — 실패·미확인 수가 "고객 관리" 메뉴에 빨간 점으로 상시 켜져 있었다.
  //   AI 영업은 ceo 전용 작업 화면이라 상단 메뉴 알림 축이 아니다(옛 /api/sales-outreach/badge 소비 0).
  // ★ 2026-06-13: AI 학습 데이터 열람 권한 (AI_TRAINING_VIEWER_IDS — 기본 ceo 전용) — 허용 계정에만 진입 버튼 노출
  const [aiTrainingAllowed, setAiTrainingAllowed] = useState(false);
  // ★ 2026-09-03: 베스트 구성(참조 골격) 열람 권한 (BEST_LAYOUT_VIEWER_IDS — 기본 ceo 전용) — 허용 계정에만 메뉴 노출
  const [bestLayoutAllowed, setBestLayoutAllowed] = useState(false);
  // ★ 2026-07-17: 발송 라인 설정 권한 (LINE_GROUP_ADMIN_USERS — 기본 ceo,admin) — 허용 계정에만 메뉴/탭 노출.
  //   판정은 백엔드 GET /line-groups 응답의 canManage가 유일한 소스 — 프론트 자체 판정 금지.
  const [lineGroupCanManage, setLineGroupCanManage] = useState(false);
  // ★ 2026-08-16: 신규마케팅진단 열람 권한 (MARKETING_DIAGNOSIS_VIEWER_IDS — 기본 ceo 전용) + 신규 리드 뱃지
  const [diagnosisAllowed, setDiagnosisAllowed] = useState(false);
  // ★ 2026-10-03 60초 뱃지 주기(빈 의존성 효과)가 허용 여부를 읽는 통로 — state 는 그 효과 안에서 처음 값으로 굳는다
  const diagnosisAllowedRef = useRef(false);
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
    costPerBrandNonfriend: '' as string | number,
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
    sessionTimeoutMinutes: 480,
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
    agencySendEnabled: false,  // ★ 2026-08-22 대행발송 스위치(companies.agency_send_enabled)
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
  // ★ 2026-10-07 쪽 넘김(20건) — 결과 로그 = 서버가 쪽마다 · 차단정보 목록 = 받아 둔 목록을 자른다
  const [spamHitsPage, setSpamHitsPage] = useState(1);
  const [spamHitsTotal, setSpamHitsTotal] = useState(0);
  const [spamRulesPage, setSpamRulesPage] = useState(1);
  const [spamBlockNotice, setSpamBlockNotice] = useState('');
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
  const [geoHitsDenied, setGeoHitsDenied] = useState(false); // 403 = 권한 없음. "기록 없음"으로 그리면 거짓이다
  // ★ 2026-10-07 쪽 넘김(20건 · ListPager) — 차단 로그 = 서버가 쪽마다 · 예외 승인 = 받아 둔 목록을 자른다
  const [geoHitsPage, setGeoHitsPage] = useState(1);
  const [geoHitsTotal, setGeoHitsTotal] = useState(0);
  const [geoExPage, setGeoExPage] = useState(1);
  // ★ 2026-10-02 expiresAt = 허용 만료일(YYYY-MM-DD · 비우면 기한 없음) — 전송자격인증 2.2 ③
  const [geoForm, setGeoForm] = useState({ scope: 'user', target: '', cidr: '', reason: '', expiresAt: '' });
  const [geoBusy, setGeoBusy] = useState(false);

  const loadGeoAccess = async () => {
    const token = localStorage.getItem('token');
    const headers = { 'Authorization': `Bearer ${token}` };
    const [statusRes, exRes] = await Promise.all([
      fetch('/api/admin/geo/status', { headers }),
      fetch('/api/admin/geo/exceptions', { headers }),
      loadGeoHits(geoHitsPage),
    ]);
    if (statusRes.ok) setGeoStatus(await statusRes.json());
    if (exRes.ok) setGeoExceptions((await exRes.json()).exceptions || []);
  };

  const loadGeoHits = async (page: number) => {
    const res = await fetch(`/api/admin/geo/hits?page=${page}`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
    if (res.ok) {
      const d = await res.json();
      setGeoHits(d.hits || []);
      setGeoHitsTotal(Number(d.total) || 0);
      setGeoHitsPage(Number(d.page) || page);
      setGeoHitsDenied(false);
    } else setGeoHitsDenied(res.status === 403);
  };

  // ★ 2026-08-27 직원 계정·권한 — 권한분류표·등급 정의는 서버가 소유한다(화면이 표를 만들지 않는다)
  const loadAdminAccounts = async () => {
    const token = localStorage.getItem('token');
    const headers = { 'Authorization': `Bearer ${token}` };
    const [listRes, histRes] = await Promise.all([
      fetch('/api/admin/admin-accounts', { headers }),
      fetch('/api/admin/admin-accounts/history?limit=100', { headers }),
    ]);
    if (listRes.ok) {
      const body = await listRes.json();
      setAdminAccounts(body.accounts || []);
      setAdminMatrix(body.matrix || []);
      setAdminRoleOptions(body.roles || []);
      setAdminLevelLabels(body.levelLabels || {});
      setAdminAccountsCanWrite(body.canWrite === true);
      setAdminAccountsAllowed(true);
    } else {
      setAdminAccountsAllowed(false);
    }
    if (histRes.ok) setAdminRoleHistory((await histRes.json()).history || []);
  };

  const loadSpamBlock = async () => {
    const token = localStorage.getItem('token');
    const headers = { 'Authorization': `Bearer ${token}` };
    const [rulesRes] = await Promise.all([
      fetch('/api/admin/spam-block/rules', { headers }),
      loadSpamHits(spamHitsPage),
    ]);
    if (rulesRes.ok) {
      const body = await rulesRes.json();
      setSpamRules(body.rules || []);
      // 차단 안내 문구는 서버(spam-block.ts 상수)가 유일한 원본 — 화면에 복사해 두지 않는다
      setSpamBlockNotice(body.blockNotice || '');
    }
  };

  const loadSpamHits = async (page: number) => {
    const res = await fetch(`/api/admin/spam-block/hits?page=${page}`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
    if (!res.ok) return;
    const d = await res.json();
    setSpamHits(d.hits || []);
    setSpamHitsTotal(Number(d.total) || 0);
    setSpamHitsPage(Number(d.page) || page);
  };

  // ★ 2026-10-03 규칙별 탐지 · 차단 전환(전송자격인증 5.2 차단 승격). 서버가 전후 값을 감사 기록에 남긴다.
  const [spamModeBusyId, setSpamModeBusyId] = useState<string | null>(null);

  // ★ 2026-08-18 발신번호 회선 정책(전송자격인증 2.1) — 상한은 신규 등록에만 걸린다(기존 보유분 불변)
  const [linePolicy, setLinePolicy] = useState<{
    subscriberType: string | null;
    mobileLineLimit: number | null;
    landlineLineLimit: number | null;
    effective: { mobile: number | null; landline: number | null; source: string };
    held: { mobile: number; landline: number };
    // ★1003 D-8 법인 계정당 무선 상한(스위치 켜진 법인만 값이 있다)
    perAccount?: { activeAccounts: number; perAccount: number } | null;
  } | null>(null);
  const [linePolicySaving, setLinePolicySaving] = useState(false);

  const [editCompanyTab, setEditCompanyTab] = useState<'basic' | 'send' | 'cost' | 'ai' | 'store' | 'billing' | 'cards' | 'customers' | 'sync'>('basic');
  // ★ 2026-07-21 문안 생성 참조 업종 목록 — SSOT=백엔드 industry-codes.ts (프론트 하드코딩 금지, GET /api/admin/industry-codes)
  const [industryOptions, setIndustryOptions] = useState<Array<{ code: string; label: string }>>([]);
  const [standardFields, setStandardFields] = useState<any[]>([]);
  const [enabledFields, setEnabledFields] = useState<string[]>([]);
  const [fieldDataCheck, setFieldDataCheck] = useState<Record<string, { hasData: boolean; count: number }>>({});
  // SyncAgent API Key 관리
  // ★2026-09-12 `api_secret`은 재발급 응답에만 실려 온다(서버에 원문 미저장). 평소에는 `has_secret`만 온다.
  const [syncKeys, setSyncKeys] = useState<{ api_key: string | null; api_secret?: string | null; has_secret?: boolean; use_db_sync: boolean }>({ api_key: null, api_secret: null, has_secret: false, use_db_sync: false });
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

  // 발신번호 관리
  const [callbackNumbers, setCallbackNumbers] = useState<any[]>([]);
  const [showCallbackModal, setShowCallbackModal] = useState(false);
  const [callbackSearch, setCallbackSearch] = useState('');
  const [expandedCallbackCompanies, setExpandedCallbackCompanies] = useState<Set<string>>(new Set());
  // ★ D135+ (B10): 회사별 발신번호 페이지네이션 — 한 회사당 160개 등 무한 스크롤 방지, 10개씩 페이징
  const [callbackCompanyPages, setCallbackCompanyPages] = useState<Record<string, number>>({});
  // ★ 2026-07-25 (서수란) 회사 목록 자체가 무페이징이라 화면이 아래로 끝없이 늘어남 → 회사 단위 페이징.
  //   회사별 번호 페이징(위)은 이미 있었고, 바깥 회사 루프만 빠져 있었다.
  const [callbackCompanyListPage, setCallbackCompanyListPage] = useState(1);
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
  // ★ 2026-10-09 목업 v2 고객사 목록 거르기 둘 — 탭을 옮겨 다녀도 값이 남도록 본체에 둔다(검색 · 상태와 같은 자리)
  const [companyPlanFilter, setCompanyPlanFilter] = useState<'all' | 'paid' | 'trial' | 'none' | 'internal'>('all');
  const [companyUsageFilter, setCompanyUsageFilter] = useState<'all' | 'web' | 'agent' | 'both'>('all');
  const [companyPage, setCompanyPage] = useState(1);

  // 요금제 관리
  const [planList, setPlanList] = useState<any[]>([]);
  const [planPage, setPlanPage] = useState(1);
  
  // 플랜 신청 관리
  const [planRequests, setPlanRequests] = useState<any[]>([]);
  const [requestPage, setRequestPage] = useState(1);
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
  // ★ 2026-09-14 (Harold) 발신프로필 승인 대기 — 발송 관리 > 템플릿 관리 뱃지. /pending-badges 의 senderProfiles 축.
  const [senderProfilePendingCount, setSenderProfilePendingCount] = useState(0);
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
useEffect(() => { if (activeTab === 'adminAccounts') loadAdminAccounts(); }, [activeTab]);
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
      const r = await fetch('/api/admin/help-questions/access', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setHelpQAccessAllowed(d.allowed === true);
    } catch { setHelpQAccessAllowed(false); }
    try {
      const token = localStorage.getItem('token');
      // ★ 2026-09-26 스팸 검사·맞춤법 사용 현황 — 허용 계정(기본 ceo)에만 메뉴 노출
      const r = await fetch('/api/admin/precheck-usage/access', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setPrecheckUsageAllowed(d.allowed === true);
    } catch { setPrecheckUsageAllowed(false); }
    try {
      const token = localStorage.getItem('token');
      // ★ 2026-10-06 기능 관심 업체 — 허용 계정(기본 ceo)에만 메뉴 노출
      const r = await fetch('/api/admin/feature-interest/access', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setFeatureInterestAllowed(d.allowed === true);
    } catch { setFeatureInterestAllowed(false); }
    try {
      const token = localStorage.getItem('token');
      // ★ 2026-10-07 본인인증 현황 — 허용 계정(기본 ceo)에만 메뉴 노출
      const r = await fetch('/api/admin/identity-status/access', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setIdentityStatusAllowed(d.allowed === true);
    } catch { setIdentityStatusAllowed(false); }
    try {
      const token = localStorage.getItem('token');
      // ★ 2026-10-07 소개 방문 · 시연 요청 — 허용 계정(기본 ceo · suran)에만 메뉴 노출
      const r = await fetch('/api/admin/intro-leads/access', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setIntroLeadsAllowed(d.allowed === true);
    } catch { setIntroLeadsAllowed(false); }
    try {
      const token = localStorage.getItem('token');
      // ★ 2026-10-07 감시 기록 — 허용 계정(기본 ceo)에만 메뉴 노출
      const r = await fetch('/api/admin/watch-log/access', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setWatchLogAllowed(d.allowed === true);
    } catch { setWatchLogAllowed(false); }
    try {
      const token = localStorage.getItem('token');
      // ★ 2026-08-16: 신규마케팅진단 접근(mount 1회) — 허용이면 신규 리드 뱃지도 함께
      const r = await fetch('/api/admin/marketing-diagnosis/access', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      if (d.allowed === true) {
        setDiagnosisAllowed(true);
        diagnosisAllowedRef.current = true;
        loadDiagnosisBadge();
      }
    } catch { setDiagnosisAllowed(false); }
    try {
      const token = localStorage.getItem('token');
      const r = await fetch('/api/admin/ai-training/access', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setAiTrainingAllowed(d.allowed === true);
    } catch { setAiTrainingAllowed(false); }
    try {
      const token = localStorage.getItem('token');
      // ★ 2026-09-03: 베스트 구성 접근(mount 1회) — 허용 계정(기본 ceo)에만 메뉴 노출
      const r = await fetch('/api/admin/best-layout/access', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setBestLayoutAllowed(d.allowed === true);
    } catch { setBestLayoutAllowed(false); }
    try {
      const token = localStorage.getItem('token');
      // ★ 2026-08-24: AI 영업 아웃리치 접근(mount 1회) — 허용 계정(기본 ceo)에만 메뉴 노출
      const r = await fetch('/api/sales-outreach/access', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setOutreachAllowed(d.allowed === true);
    } catch { setOutreachAllowed(false); }
    try {
      const token = localStorage.getItem('token');
      // ★ 2026-08-27: 직원 계정·권한(전송자격인증 3.2·3.3) — 대표 등급에만 메뉴 노출.
      //   목록 응답 자체가 게이트라 별도 access 엔드포인트를 만들지 않는다.
      const r = await fetch('/api/admin/admin-accounts', { headers: { Authorization: `Bearer ${token}` } });
      setAdminAccountsAllowed(r.ok);
    } catch { setAdminAccountsAllowed(false); }
    try {
      const token = localStorage.getItem('token');
      // ★ 2026-10-03 보안 · 인증 묶음(금칙어 · 국외 접근 통제 · 로그인 차단 · 운영 기록 대장) 메뉴 노출
      const r = await fetch('/api/admin/my-permissions', { headers: { Authorization: `Bearer ${token}` } });
      const d = r.ok ? await r.json() : null;
      setMyPermRead(d?.canRead && typeof d.canRead === 'object' ? d.canRead : {});
    } catch { setMyPermRead({}); }
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
  let diagInFlight = false;
  const tick = async () => {
    if (!alive || inFlight) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    inFlight = true;
    // ★ 2026-10-03 (Harold) 신규마케팅진단 뱃지도 같은 주기에 — 열어 둔 동안 새 리드가 와도 뜨게 한다(허용 계정만).
    //   ⛔ 진단 조회는 자기 진행 표시(diagInFlight)로만 겹침을 막고 기다리지 않는다 — 진단 응답이 늦을 때
    //   공용 inFlight 가 풀리지 않으면 발신번호 · 충전 · 크레딧 뱃지 갱신까지 멈춘다(1003 Codex 1R 지적).
    if (diagnosisAllowedRef.current && !diagInFlight) {
      diagInFlight = true;
      loadDiagnosisBadge().finally(() => { diagInFlight = false; });
    }
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

// 감사 로그 조회
const loadAuditLogs = async (page: number) => {
  setAuditLogsLoading(true);
  try {
    const token = localStorage.getItem('token');
    const params = new URLSearchParams({ page: String(page), limit: '20' });   // ★ 2026-10-07 보안·인증 목록 20건 통일
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

// ★ D131 후속(2026-04-21): DB의 status='paused'면 online 여부와 무관하게 "일시정지" 표시
//   Agent는 살아있으나(heartbeat 정상) 스케줄러만 pause된 상태.
// ★2026-09-02(2) 판정 기준은 고객사마다 다르다(동기화 기본 360분). 배지에 그 에이전트의 실제 주기를
//   담아 "1시간 전인데 왜 지연이냐"에 화면이 스스로 답하게 한다. 값은 서버가 판정에 쓴 것과 같은 것이다.
const getSyncOnlineBadge = (onlineStatus: string, dbStatus?: string, hbMin?: number, syncMin?: number) => {
  const cycleHint = hbMin ? `하트비트 ${hbMin}분 주기${syncMin ? ` · 동기화 ${syncMin}분 주기` : ''} 기준` : '';
  if (dbStatus === 'paused') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">⏸ 일시정지</span>;
  if (onlineStatus === 'online') return <span title={cycleHint} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">● 정상</span>;
  if (onlineStatus === 'delayed') return <span title={cycleHint ? `${cycleHint} · 한 주기를 놓쳤습니다` : ''} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">● 지연</span>;
  // ★2026-09-02 하트비트만 끊기고 적재는 되는 반쪽 상태. 종전에는 이것도 "오프라인"이라 데이터가
  //   2분 전까지 들어오는 에이전트를 죽은 것으로 읽게 했다. 적재 여부는 옆 "마지막 동기화" 칸이 말한다.
  if (onlineStatus === 'sync_only') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800" title="적재는 되고 있지만 하트비트가 끊겨 원격 명령·자기 보고가 전달되지 않습니다.">● 하트비트 끊김</span>;
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
  // ★ 2026-09-13 브랜드 두 줄 — 없으면 상세 행에 원문 키가 보인다(청구서 라벨 = billing-types.ts label)
  BRAND: '브랜드메시지', BRAND_NF: '브랜드메시지(비친구)',
  TEST_SMS: '테스트SMS', TEST_LMS: '테스트LMS', TEST_MMS: '테스트MMS', SPAM_SMS: '스팸SMS', SPAM_LMS: '스팸LMS',
  // ★ 2026-09-26 담당자 브랜드메시지 테스트(청구서 라벨 = billing-types.ts · PDF와 같은 이름)
  TEST_BRAND: '테스트브랜드메시지',
  // ★ 2026-09-16 추가 항목(서수란 접수) — 없으면 상세 행에 내부 키(EXTRA_MANUAL)가 그대로 보인다.
  //   실제로 그렇게 보이고 있었다. 이름은 PDF·이메일(billing-invoice-lines CT)과 같은 값이라야 한다.
  EXTRA_080_FEE: '080 번호 이용료', EXTRA_080_SVC: '080 부가서비스', EXTRA_080_CALL: '080 통화료',
  EXTRA_MANUAL: '부가서비스', EXTRA_BASE_FEE: '기본요금',
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
      // ★ 2026-09-14 발신프로필 승인 대기(발송 관리 > 템플릿 관리 뱃지) — 같은 주기·같은 null 규칙.
      if (d.senderProfiles != null) setSenderProfilePendingCount(Number(d.senderProfiles) || 0);
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

  // 모달 헬퍼 함수
  const showAlert = (title: string, message: string, variant: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    setModal({ type: 'alert', title, message, variant });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setModal({ type: 'confirm', title, message, onConfirm });
  };

  // ★2026-08-26 §18 대행발송 허용 발신 이메일 — 회사 편집이 열릴 때 활성 주소 수를 채운다(트리거 건수 표기).
  //   못 센 축은 0이 아니라 null로 둔다(0은 "볼 일 없음"으로 읽혀 조회가 깨진 순간 대기가 사라진다 · LESSONS_FRONTEND).
  const [agencyEmailModalOpen, setAgencyEmailModalOpen] = useState(false);
  const [agencyEmailActiveCount, setAgencyEmailActiveCount] = useState<number | null>(null);
  // 0826 실험실 접힘(기본 닫힘) — 실사용 0~1개사 스위치 3종을 담는다
  const [labOpen, setLabOpen] = useState(false);
  useEffect(() => {
    const id = editCompany?.id;
    setAgencyEmailModalOpen(false);
    setLabOpen(false);
    if (!id) { setAgencyEmailActiveCount(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/companies/${id}/agency-send-emails`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        });
        const data = await res.json();
        if (cancelled) return;
        setAgencyEmailActiveCount(data?.success ? (data.senders || []).filter((s: any) => s.is_active).length : null);
      } catch {
        if (!cancelled) setAgencyEmailActiveCount(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editCompany?.id]);

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

  const [editingCallback, setEditingCallback] = useState<any>(null);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // ★ 2026-10-09 슈퍼관리자 다듬기 — 알약 = 공용 부품(admin-ui PILL 의미 색)
  const getStatusBadge = (status: string) => {
    const tones: Record<string, keyof typeof PILL> = {
      trial: 'blue',
      active: 'green',
      suspended: 'rose',
      terminated: 'gray',
      locked: 'rose',
      dormant: 'gray',
    };
    const labels: Record<string, string> = {
      trial: '체험',
      active: '활성',
      suspended: '정지',
      terminated: '해지',
      locked: '잠금',
      dormant: '휴면',
    };
    return <AdminPill tone={tones[status] || 'green'}>{labels[status] || status}</AdminPill>;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f6f8]">
      {/* 헤더 */}
      {/* ★ 2026-10-09 슈퍼관리자 다듬기(Harold 목업 v2) — 구조 그대로 · 글씨 한 단계 작게 · 강조색 emerald 하나 */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-[52px] flex justify-between items-center">
        <div className="flex items-center gap-4">
            <h1 className="text-base font-bold tracking-tight text-gray-900 cursor-pointer hover:text-emerald-700 transition-colors" onClick={() => window.location.reload()}>시스템 관리</h1>
            {/* ★ D152: ServiceSwitcher 제거 — hanjulDM 분리, admin.hanjuldm.kr 별도 도메인 */}
          </div>
          <div className="flex items-center gap-3.5">
            <SessionTimer />
            <span className="text-[13px] text-gray-700">{user?.name}님</span>
            <button
              onClick={handleLogout}
              className="whitespace-nowrap text-[13px] text-gray-500 hover:text-gray-800"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* 메인 */}
      <main className="max-w-7xl mx-auto px-4 md:px-6 pt-[18px] pb-10">
        {/* 통계 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div className="bg-white rounded-xl border border-gray-200/80 px-4 py-3.5">
            <div className="text-xs text-gray-500">전체 고객사</div>
            <div className="text-2xl font-extrabold tracking-tight text-gray-900 mt-0.5 tabular-nums">{companies.length}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200/80 px-4 py-3.5">
            <div className="text-xs text-gray-500">활성 고객사</div>
            <div className="text-2xl font-extrabold tracking-tight text-emerald-700 mt-0.5 tabular-nums">
              {companies.filter(c => c.status === 'active').length}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200/80 px-4 py-3.5">
            <div className="text-xs text-gray-500">전체 사용자</div>
            <div className="text-2xl font-extrabold tracking-tight text-indigo-700 mt-0.5 tabular-nums">{users.length}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200/80 px-4 py-3.5">
            <div className="text-xs text-gray-500">요금제</div>
            <div className="text-2xl font-extrabold tracking-tight text-violet-700 mt-0.5 tabular-nums">{plans.length}<span className="text-[13px] text-gray-400 font-semibold ml-px">개</span></div>
          </div>
        </div>

        {/* 드롭다운 그룹 메뉴 */}
        <div ref={menuRef} className="bg-white rounded-xl border border-gray-200/80 mb-3">
          <div className="p-1.5 flex items-center gap-0.5 flex-wrap">
            {[
              // ★ 2026-10-03 (Harold) 4묶음 → 7묶음 · 항목 삭제 0 · key 변경 0(설계서 docs/2026-10-03-admin-dashboard-split-design.md §2).
              //   묶음의 「활성」은 항목 key 에서 계산한다 — 그전에는 묶음마다 탭 목록(tabs)을 손으로 따로 적어
              //   「시스템」 목록에 금칙어 · 국외 접근 통제가 빠져 그 화면을 열어도 묶음에 불이 안 들어왔다.
              {
                label: '고객 관리',
                items: [
                  { key: 'companies', label: '고객사 관리' },
                  { key: 'users', label: '사용자 관리' },
                  // ★ 2026-08-16: 신규마케팅진단 = 허용 계정(기본 ceo)에만 노출 · 뱃지 = 신규 리드 수(60초 주기)
                  ...(diagnosisAllowed ? [{ key: 'marketingDiagnosis', label: '신규마케팅진단', badge: diagnosisBadge }] : []),
                  // ★ 2026-10-07 (Harold) 소개 방문 · 시연 요청 = 허용 계정(기본 ceo · suran)에만 노출
                  ...(introLeadsAllowed ? [{ key: 'introLeads', label: '소개 방문 · 시연 요청' }] : []),
                  // ★ 2026-08-24: AI 영업 = 허용 계정(★1003 ceo · suran)에만 노출 · ★ 2026-10-09 별도 페이지(/admin/outreach · 뒤로가기 = 이 화면)
                  ...(outreachAllowed ? [{ key: 'salesOutreach', label: 'AI 영업', onClick: () => navigate('/admin/outreach') }] : []),
                ],
              },
              {
                label: '발송 관리',
                items: [
                  // ★ 2026-08-08 상단 메뉴는 **두 축의 합** — "발신번호 관리에 볼 일 N건"이 여기선 맞는 말이다.
                  //   화면에 보이는 두 탭 뱃지의 합으로 만든다(서버 total을 따로 받으면 뱃지끼리 어긋날 수 있다).
                  { key: 'callbacks', label: '발신번호 관리', badge: senderRegPendingCount + pendingManagerCount },
                  // ★ 2026-09-14 (Harold) 발신프로필 승인 대기 = 이 탭(발신 프로필 화면)에 뱃지 — 60초 주기 + 승인·반려 직후.
                  { key: 'templates', label: '템플릿 관리', badge: senderProfilePendingCount },
                  { key: 'scheduled', label: '예약 관리' },
                  { key: 'allCampaigns', label: '캠페인 관리', onClick: () => loadAllCampaigns() },
                  // ★ 2026-10-03 (Harold) 탭 진입 조회는 activeTab 효과가 한다 — 여기서도 부르면 같은 요청이 두 번 나가
                  //   캐시가 빈 순간 3~4초짜리 집계가 둘 동시에 돌았다(운영 로그 200 + 304 한 쌍). 이미 이 탭일 때 다시 누른 경우만 새로 조회.
                  { key: 'stats', label: '발송 통계', onClick: () => { if (activeTab === 'stats') loadSendStats(); } },
                ],
              },
              {
                label: '대행 발송',
                items: [
                  // ★ 2026-08-26 §18 이메일 접수 관제 — 반려·격리 메일의 유일한 노출면
                  { key: 'agencyMail', label: '대행발송 접수' },
                  // ★ 2026-08-26(2) 전 고객사 대행발송 진행현황(진행 레일 + 접수구분 + 고객사·신청자)
                  { key: 'agencyLedger', label: '대행발송 내역' },
                  // ★ 2026-07-09 CRM 캠페인 대행 설계 — 비즈니스+ 업체 접수 요청서 분석 → 제안서 PDF (별도 페이지)
                  { key: 'campaignAgency', label: '캠페인 대행 설계', onClick: () => navigate('/admin/campaign-agency') },
                ],
              },
              {
                label: '요금/정산',
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
                // ★ 2026-10-03 (Harold) 보안 · 인증 = 대표 · 지원팀장(ceo · suran)만. 노출은 서버 등급표(my-permissions · 각 /access)가 정한다.
                //   감사 로그는 대표만(AUDIT_LOG_VIEWER_IDS) · 직원 계정 · 권한은 지원팀장 조회만.
                label: '보안 · 인증',
                items: [
                  ...(adminAccountsAllowed ? [{ key: 'adminAccounts', label: '직원 계정·권한' }] : []),
                  ...(myPermRead.loginBlocks === true ? [{ key: 'loginBlocks', label: '로그인 차단 관리' }] : []),
                  // ★ 2026-08-19: 국외 접근 통제(전송자격인증 2.2)
                  ...(myPermRead.geoAccess === true ? [{ key: 'geoAccess', label: '국외 접근 통제' }] : []),
                  // ★ 2026-08-18: 금칙어 차단(전송자격인증 5.2)
                  ...(myPermRead.spamBlock === true ? [{ key: 'spamBlock', label: '금칙어 차단' }] : []),
                  // ★ 2026-06-11: 감사 로그 = 허용 계정(기본 ceo)에만 노출
                  ...(auditAccessAllowed ? [{ key: 'auditLogs', label: '감사 로그' }] : []),
                  // ★ 2026-10-07 (Harold) 본인인증 현황 = 허용 계정(기본 ceo)에만 노출 · 다른 계정은 메뉴 자체가 없다
                  ...(identityStatusAllowed ? [{ key: 'identityStatus', label: '본인인증 현황' }] : []),
                  // ★ 2026-10-07 (Harold) 감시 기록 = 허용 계정(기본 ceo)에만 노출
                  ...(watchLogAllowed ? [{ key: 'watchLog', label: '감시 기록' }] : []),
                  // ★ 2026-10-03 운영 기록 대장 — 작성 · 확인은 화면이 서버 판정(meta)을 받아 연다
                  ...(myPermRead.opsRecords === true ? [{ key: 'opsRecords', label: '운영 기록 대장' }] : []),
                ],
              },
              {
                label: '연동 · 인프라',
                items: [
                  { key: 'syncAgents', label: 'Sync 모니터링' },
                  { key: 'agentDeploy', label: '싱크에이전트 배포' },
                  // ★ 2026-07-17: 발송 라인 설정 = 허용 계정(기본 ceo,admin)에만 노출
                  ...(lineGroupCanManage ? [{ key: 'lineGroups', label: '발송 라인 설정' }] : []),
                ],
              },
              {
                label: 'AI · 콘텐츠',
                items: [
                  // ★ 2026-07-04: 베스트 문안(업종 큐레이션) = 슈퍼관리자 공용(직원 큐레이션, ceo 게이트 없음)
                  { key: 'bestCopy', label: '베스트 문안', onClick: () => navigate('/admin/best-copy') },
                  // ★ 2026-09-03: 베스트 구성(참조 골격 = DM·이메일 구성 학습) = 허용 계정(기본 ceo)에만 노출 (별도 페이지 navigate)
                  ...(bestLayoutAllowed ? [{ key: 'bestLayout', label: '베스트 구성', onClick: () => navigate('/admin/best-layout') }] : []),
                  // ★ 2026-06-13: AI 학습 데이터 = 허용 계정(기본 ceo)에만 노출 (별도 페이지 navigate)
                  ...(aiTrainingAllowed ? [{ key: 'aiTraining', label: 'AI 학습 데이터', onClick: () => navigate('/admin/ai-training') }] : []),
                  // ★ 2026-08-24: 도움말 질문 이력 = 허용 계정(기본 ceo)에만 노출
                  ...(helpQAccessAllowed ? [{ key: 'helpQuestions', label: '도움말 질문 이력' }] : []),
                  // ★ 2026-09-26 (Harold) 스팸 검사·맞춤법 사용 현황 = 허용 계정(기본 ceo)에만 노출 · 다른 계정은 메뉴 자체가 없다
                  ...(precheckUsageAllowed ? [{ key: 'precheckUsage', label: '점검 사용 현황' }] : []),
                  // ★ 2026-10-06 (Harold) 기능 관심 업체 = 허용 계정(기본 ceo)에만 노출 · 다른 계정은 메뉴 자체가 없다
                  ...(featureInterestAllowed ? [{ key: 'featureInterest', label: '기능 관심 업체' }] : []),
                ],
              },
            ].filter((group) => group.items.length > 0).map(group => {
              // 묶음 활성 = 지금 탭이 이 묶음의 항목인가(항목 목록 하나가 유일한 기준)
              const isGroupActive = group.items.some((it: any) => it.key === activeTab);
              const isOpen = openMenu === group.label;
              // ★ 2026-10-09 묶음마다 다르던 색(colorMap 8색)을 걷었다 — 슈퍼관리자 강조색 = emerald 하나(Harold 「담백하게」)

              return (
                <div key={group.label} className="relative">
                  <button
                    onClick={() => setOpenMenu(isOpen ? null : group.label)}
                    className={`h-[34px] px-3 text-[13px] rounded-lg transition-colors flex items-center gap-1.5 ${
                      isGroupActive ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {group.label}
                    {group.items.some((it: any) => it.badge > 0) && (
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                    )}
                    <svg className={`w-3 h-3 opacity-60 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {isOpen && (
                    <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-[10px] shadow-[0_12px_30px_rgba(17,24,39,0.08)] p-1.5 min-w-[190px] z-50"
                         style={{ animation: 'fadeIn 0.15s ease-out' }}>
                      {group.items.map((item: any) => (
                        <button key={item.key}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setActiveTab(item.key);
                            item.onClick?.();
                            setOpenMenu(null);
                          }}
                          className={`whitespace-nowrap w-full text-left px-2.5 py-[7px] rounded-md text-[13px] transition-colors flex items-center justify-between ${
                            activeTab === item.key ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          {item.label}
                          {item.badge > 0 && (
                            <span className="ml-2 bg-rose-500 text-white text-[11px] rounded-full min-w-[18px] h-[18px] px-1.5 inline-flex items-center justify-center font-bold tabular-nums">
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
        {activeTab === 'companies' && <CompaniesTab {...{ closeModal, companies, companyPage, companyPlanFilter, companySearch, companyStatusFilter, companyUsageFilter, getStatusBadge, industryOptions, loadAgentIds, loadData, loadUsers, setCompanyPage, setCompanyPlanFilter, setCompanySearch, setCompanyStatusFilter, setCompanyUsageFilter, setDashboardCardCount, setDashboardCardIds, setDashboardCardPool, setEditCompany, setEditCompanyTab, setFieldDataCheck, setIndustryOptions, setLinePolicy, setNewAgentMemo, setNewAgentSendId, setShowCompanyModal, setShowEditCompanyModal, setStandardFields, showAlert, showConfirm }} />}

        {/* 사용자 관리 탭 */}
        {activeTab === 'users' && <UsersTab {...{ closeModal, companies, expandedCompanies, getStatusBadge, loadUsers, setCopied, setEditingUser, setExpandedCompanies, setModal, setShowUserModal, setUserCompanyFilter, setUserPage, setUserSearch, showAlert, showConfirm, userCompanyFilter, userPage, userSearch, users }} />}

        {/* 예약 관리 탭 */}
        {activeTab === 'scheduled' && <ScheduledTab {...{ companies, loadScheduledCampaigns, openSmsDetail, scheduledCampaigns, scheduledCompanyFilter, scheduledEndDate, scheduledLoginId, scheduledPage, scheduledPerPage, scheduledSearch, scheduledStartDate, scheduledStatusFilter, scheduledTotal, setCancelReason, setCancelTarget, setScheduledCompanyFilter, setScheduledEndDate, setScheduledLoginId, setScheduledSearch, setScheduledStartDate, setScheduledStatusFilter, setShowCancelModal }} />}

        {/* 발신번호 관리 탭 */}
        {activeTab === 'callbacks' && <CallbacksTab {...{ allManagers, callbackCompanyListPage, callbackCompanyPages, callbackNumbers, callbackSearch, callbackSubTab, closeModal, downloadSenderDoc, expandedCallbackCompanies, loadAllManagers, loadCallbackNumbers, loadSenderRegPendingCount, mgrFilter, mgrRejectId, mgrRejectReason, mgrSearch, pendingManagerCount, senderRegFilter, senderRegLoading, senderRegPendingCount, senderRegistrations, setCallbackCompanyListPage, setCallbackCompanyPages, setCallbackSearch, setCallbackSubTab, setEditingCallback, setExpandedCallbackCompanies, setMgrFilter, setMgrRejectId, setMgrRejectReason, setMgrSearch, setModal, setRejectReasonInput, setSenderRegDetail, setSenderRegFilter, setShowCallbackModal, setShowSenderRegDetailModal, showAlert, showConfirm }} />}

        {/* ★ 2026-08-27 직원 계정·권한 (전송자격인증 3.2·3.3) */}
        {activeTab === 'adminAccounts' && <AdminAccountsTab {...{ adminAccounts, adminAccountsAllowed, adminAccountsCanWrite, adminAccountsPage, adminLevelLabels, adminMatrix, adminRoleHistory, adminRoleHistoryPage, adminRoleOptions, setAdminAccountsPage, setAdminActiveEdit, setAdminCreate, setAdminRoleEdit, setAdminRoleHistoryPage }} />}

        {/* ★ 2026-08-19 국외 접근 통제 (전송자격인증 2.2) */}
        {activeTab === 'helpQuestions' && helpQAccessAllowed && (
          <HelpQuestionsTab companies={companies.map((c) => ({ id: c.id, company_name: c.company_name }))} />
        )}
        {activeTab === 'precheckUsage' && precheckUsageAllowed && (
          <PrecheckUsageTab companies={companies.map((c) => ({ id: c.id, company_name: c.company_name }))} />
        )}
        {activeTab === 'featureInterest' && featureInterestAllowed && <FeatureInterestTab />}
        {activeTab === 'identityStatus' && identityStatusAllowed && <IdentityStatusTab />}
        {activeTab === 'introLeads' && introLeadsAllowed && <IntroLeadsTab />}
        {activeTab === 'watchLog' && watchLogAllowed && <WatchLogTab />}

        {activeTab === 'geoAccess' && <GeoAccessTab {...{ geoBusy, geoExPage, geoExceptions, geoForm, geoHits, geoHitsDenied, geoHitsPage, geoHitsTotal, geoStatus, loadGeoAccess, loadGeoHits, setGeoBusy, setGeoExPage, setGeoForm, showAlert }} />}

        {/* 요금제 관리 탭 */}
        {activeTab === 'spamBlock' && <SpamBlockTab {...{ loadSpamBlock, loadSpamHits, setSpamBusy, setSpamElements, setSpamModeBusyId, setSpamRuleName, setSpamRulesPage, setSpamSim, showAlert, showConfirm, spamBlockNotice, spamBusy, spamElements, spamHits, spamHitsPage, spamHitsTotal, spamModeBusyId, spamRuleName, spamRules, spamRulesPage, spamSim }} />}

        {activeTab === 'plans' && <PlansTab {...{ closeModal, loadPlans, planList, planPage, setEditingPlan, setPlanPage, setShowPlanModal, showAlert, showConfirm }} />}

        {/* 플랜 신청 관리 탭 */}
        {activeTab === 'requests' && <PlanRequestsTab {...{ closeModal, loadData, loadPlanRequests, planRequests, requestPage, setModal, setRejectReason, setRejectTarget, setRequestPage, setShowRejectModal }} />}

        {/* 크레딧 관리 탭 — AI 크레딧 충전 요청(후불 승인) + 전체 회사 사용 이력 */}
        {activeTab === 'credits' && <CreditsTab {...{ creditPanel, creditRequests, creditRiskCompanies, creditTxAll, creditTxCompany, creditTxLoading, creditTxPage, creditTxTotalPages, loadAllCreditTx, loadCreditRequests, loadCreditRisk, loadPendingBadges, predictiveRunning, setCreditPanel, setCreditTxCompany, setModal, setPredictiveRunning, showAlert, showConfirm }} />}

        {/* 충전 관리 탭 — 한줄로 / 에이전트 지갑 분리 (★ 2026-07-26) */}
        {activeTab === 'deposits' && <DepositsTab {...{ chargeScope, chargeTxCompanyFilter, chargeTxEndDate, chargeTxList, chargeTxLoading, chargeTxMethodFilter, chargeTxPage, chargeTxPerPage, chargeTxStartDate, chargeTxTotal, chargeTxTypeFilter, companies, loadChargeManagement, pendingDeposits, setAgentOrderPendingCount, setChargeScope, setChargeTxCompanyFilter, setChargeTxEndDate, setChargeTxMethodFilter, setChargeTxStartDate, setChargeTxTypeFilter, setDepositAdminNote, setDepositTarget, setShowDepositApproveModal, setShowDepositRejectModal }} />}

        {/* 전체 캠페인 탭 */}
        {activeTab === 'allCampaigns' && <AllCampaignsTab {...{ allCampaigns, allCampaignsCompany, allCampaignsEndDate, allCampaignsPage, allCampaignsSearch, allCampaignsStartDate, allCampaignsStatus, allCampaignsTotal, companies, loadAllCampaigns, openSmsDetail, setAllCampaignsCompany, setAllCampaignsEndDate, setAllCampaignsSearch, setAllCampaignsStartDate, setAllCampaignsStatus }} />}

        {/* 발송 통계 탭 */}
        {activeTab === 'stats' && <SendStatsTab {...{ AGENT_STATS_PER_PAGE, agentStatsRows, agentStatsSafePage, agentStatsTotalPages, companies, loadSendStats, sendStats, setAgentStatsPage, setStatsChannel, setStatsCompanyFilter, setStatsEndDate, setStatsStartDate, setStatsView, showAlert, statsChannel, statsCompanyFilter, statsEndDate, statsPage, statsStartDate, statsTotal, statsView }} />}

      {/* ═══ 템플릿 관리 탭 ═══ */}
      {activeTab === 'templates' && <TemplatesTab {...{ adminRcsTemplates, adminTemplates, filteredAlimtalkTemplates, filteredRcsTemplates, loadAdminRcsTemplates, loadAdminTemplates, loadPendingBadges, setModal, setRejectModal, setShowImcTemplateImport, setShowManualTemplateForm, setTemplateDetail, setTemplateFilter, setTemplatePage, setTemplateSearch, setTemplateSubTab, showAlert, templateFilter, templatePage, templateSearch, templateSubTab, templatesLoading }} />}

      {/* ★ D130: 레거시 발신 프로필 등록 모달(Sender Key 수동 입력) 제거됨 — AlimtalkSendersSection의 SenderRegistrationWizard로 대체 */}

      {/* ★ 2026-08-27 계정 생성 모달 — 초기 비밀번호는 이 화면에서만 다루고 어디에도 남기지 않는다 */}
      {adminCreate && <AdminCreateModal {...{ adminCreate, adminRoleBusy, adminRoleOptions, loadAdminAccounts, setAdminCreate, setAdminRoleBusy, showAlert }} />}

      {/* ★ 2026-08-27 사용 중지·재개 모달 — 행을 지우지 않는다(지우면 심사에 낼 이력이 사라진다) */}
      {adminActiveEdit && <AdminActiveEditModal {...{ adminActiveEdit, adminRoleBusy, loadAdminAccounts, setAdminActiveEdit, setAdminRoleBusy, showAlert }} />}

      {/* ★ 2026-08-27 등급 변경 모달 — 사유 없이는 저장되지 않는다(전송자격인증 3.3 변경 이력 및 사유) */}
      {adminRoleEdit && <AdminRoleEditModal {...{ adminRoleBusy, adminRoleEdit, adminRoleOptions, loadAdminAccounts, setAdminRoleBusy, setAdminRoleEdit, showAlert }} />}

      {/* 템플릿 상세 모달 — 고객사 업로드 템플릿 정보 확인 (발송/승인 내용·반려 사유) */}
      {templateDetail && <TemplateDetailModal {...{ setTemplateDetail, templateDetail }} />}

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
      {showManualTemplateForm && <ManualTemplateFormModal {...{ companies, loadAdminTemplates, manualForm, setManualForm, setModal, setShowManualTemplateForm }} />}

      {/* ★ D96: 반려 사유 입력 모달 */}
      {rejectModal.show && <TemplateRejectModal {...{ loadAdminRcsTemplates, loadAdminTemplates, rejectModal, setModal, setRejectModal }} />}

      {/* 고객사 추가 모달 */}
      {showCompanyModal && <CompanyCreateModal {...{ companies, loadData, newCompany, newUser, plans, setNewCompany, setNewUser, setShowCompanyModal, showAlert }} />}

      {/* 사용자 추가 모달 */}
      {showUserModal && <UserCreateModal {...{ companies, loadUsers, newUser, setNewUser, setShowUserModal, showAlert }} />}

      {/* 사용자 수정 모달 */}
      {editingUser && <UserEditModal {...{ companies, editingUser, lineGroups, loadUsers, setEditingUser, showAlert, showConfirm }} />}

      {/* 고객사 수정 모달 */}
      {showEditCompanyModal && <CompanyDetailModal {...{ adminCustPage, getStatusBadge, agencyEmailActiveCount, agentIdSaving, agentIds, agentLedgerSaving, applyUnitPriceToAgents, balanceTxList, balanceTxLoading, btAccounts, btBizDraft, btBizExtracting, btBizTarget, btCompanyContact, btLoading, btRecipients, btSaving, btSettings, companyCredit, creditAdj, dashboardCardIds, dashboardCardPool, draggedCardIdx, editAgentLedger, editCompany, editCompanyTab, editingAgentRowId, enabledFields, industryOptions, labOpen, lineGroups, linePolicy, linePolicySaving, loadAdminCustomers, loadAgentIds, loadData, newAgentMemo, newAgentSendId, plans, savingUnitPrices, setAdminCustSearch, setAgencyEmailModalOpen, setAgentIdSaving, setAgentLedgerSaving, setApplyUnitPriceToAgents, setBalanceTxList, setBalanceTxLoading, setBillingToast, setBtAccounts, setBtBizDraft, setBtBizExtracting, setBtBizTarget, setBtCompanyContact, setBtLoading, setBtRecipients, setBtSaving, setBtSettings, setCompanyCredit, setCreditAdj, setCustomerDeleteConfirmName, setDashboardCardIds, setDraggedCardIdx, setEditAgentLedger, setEditCompany, setEditCompanyTab, setEditingAgentRowId, setLabOpen, setLinePolicy, setLinePolicySaving, setModal, setNewAgentMemo, setNewAgentSendId, setSavingUnitPrices, setShowCustomerDeleteAll, setShowEditCompanyModal, setShowSyncRegenConfirm, setSyncKeyVisible, setSyncKeys, setSyncLoading, setSyncSecretVisible, showAlert, showConfirm, showSyncRegenConfirm, syncKeyVisible, syncKeys, syncLoading, syncSecretVisible }} />}

      {/* SMS 상세 조회 모달 */}
      {smsDetailModal && <SmsDetailModal {...{ loadSmsDetail, setSmsDetailModal, setSmsDetailMsgModal, setSmsDetailSearchType, setSmsDetailSearchValue, setSmsDetailStatus, showAlert, smsDetailCampaign, smsDetailLoading, smsDetailPage, smsDetailRows, smsDetailSearchType, smsDetailSearchValue, smsDetailStatus, smsDetailTotal }} />}

      {/* ★ D144 후속: 발송 상세 내역 모달 메시지 셀 클릭 시 표시 + 복사 */}
      <MessageDetailModal
        content={smsDetailMsgModal}
        onClose={() => setSmsDetailMsgModal(null)}
      />

      {/* 예약 취소 모달 */}
      {showCancelModal && cancelTarget && <CancelScheduledModal {...{ cancelReason, cancelTarget, loadScheduledCampaigns, setCancelReason, setCancelTarget, setShowCancelModal, showAlert }} />}

      {/* 발신번호 수정 모달 */}
      {editingCallback && <CallbackEditModal {...{ editingCallback, loadCallbackNumbers, setEditingCallback, showAlert }} />}

      {/* 발신번호 등록 모달 */}
      {showCallbackModal && <CallbackCreateModal {...{ companies, loadCallbackNumbers, newCallback, setNewCallback, setShowCallbackModal, showAlert }} />}

      {/* 발신번호 등록 신청 상세 모달 */}
      {showSenderRegDetailModal && senderRegDetail && <SenderRegDetailModal {...{ downloadSenderDoc, loadCallbackNumbers, loadSenderRegPendingCount, loadSenderRegistrations, rejectReasonInput, senderRegDetail, senderRegFilter, setModal, setRejectReasonInput, setSenderRegDetail, setShowSenderRegDetailModal }} />}

      {/* 요금제 추가 모달 */}
      {showPlanModal && <PlanCreateModal {...{ loadPlans, newPlan, setNewPlan, setShowPlanModal, showAlert }} />}

      {/* 요금제 수정 모달 */}
      {editingPlan && <PlanEditModal {...{ editingPlan, loadPlans, setEditingPlan, showAlert }} />}

      {/* ★2026-08-26 §18 대행발송 메일 접수 관제 탭 */}
      {activeTab === 'agencyMail' && <AgencyMailIntakePanel />}
      {activeTab === 'agencyLedger' && <AgencySendLedgerPanel />}

      {/* ★2026-08-26 §18 허용 발신 이메일 관리 — 회사 편집 모달 밖의 독립 오버레이(z-[60]).
          확인·알림 모달이 이 아래(문서 뒤쪽)에 렌더되므로 같은 z에서도 위에 뜬다(파일 내 중첩 관례). */}
      {agencyEmailModalOpen && editCompany && (
        <AgencyEmailSendersModal
          companyId={editCompany.id}
          companyName={editCompany.companyName || ''}
          show={agencyEmailModalOpen}
          onClose={() => setAgencyEmailModalOpen(false)}
          onChanged={(n) => setAgencyEmailActiveCount(n)}
          showConfirm={showConfirm}
          showAlert={showAlert}
        />
      )}

      {/* ===== 커스텀 모달들 ===== */}

      {/* 확인 모달 (Confirm) */}
      {modal.type === 'confirm' && (
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-center text-gray-900 mb-2">{modal.title}</h3>
              <p className="text-sm text-center text-gray-600 whitespace-pre-line">{modal.message}</p>
            </div>
            <div className="flex border-t">
              <button
                onClick={closeModal}
                className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
              >
                취소
              </button>
              <button
                onClick={() => modal.onConfirm?.()}
                className="whitespace-nowrap flex-1 px-4 py-3 text-orange-600 font-medium hover:bg-orange-50 transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 알림 모달 (Alert) */}
      {modal.type === 'alert' && (
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-[60]">
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
              <h3 className="text-base font-semibold text-center text-gray-900 mb-2">{modal.title}</h3>
              <p className="text-sm text-center text-gray-600">{modal.message}</p>
            </div>
            <div className="border-t">
              <button
                onClick={closeModal}
                className={`whitespace-nowrap w-full px-4 py-3 font-medium transition-colors ${
                  modal.variant === 'success' ? 'text-green-600 hover:bg-green-50' :
                  modal.variant === 'error' ? 'text-red-600 hover:bg-red-50' :
                  modal.variant === 'warning' ? 'text-yellow-600 hover:bg-yellow-50' : 'text-emerald-700 hover:bg-emerald-50'
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
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-center text-gray-900 mb-4">{modal.title}</h3>
              
              <div className="bg-gray-50 rounded-xl p-4 mb-4">
                <p className="text-xs text-gray-500 mb-2 text-center">임시 비밀번호</p>
                <div className="flex items-center justify-center gap-2">
                  <code className="text-2xl font-mono font-bold text-gray-900 tracking-wider">
                    {modal.password}
                  </code>
                  <button
                    onClick={handleCopyPassword}
                    className={`whitespace-nowrap p-2 rounded-lg transition-all ${
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
                    <strong>{modal.phone}</strong>로 SMS 발송 완료
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
                className="whitespace-nowrap w-full px-4 py-3 text-emerald-700 font-medium hover:bg-emerald-50 transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
{/* 발송 통계 상세 모달 */}
{statsDetailInfo && <StatsDetailModal {...{ setMessageDetailContent, setStatsDetail, setStatsDetailInfo, statsDetail, statsDetailInfo, statsDetailLoading }} />}
      {/* ★ D102: 메시지 내용 상세 모달 */}
      {messageDetailContent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-5 pb-3 border-b bg-gray-50 rounded-t-2xl flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-gray-900">메시지 내용</h3>
                <p className="text-xs text-gray-500 mt-0.5">{messageDetailContent.name}</p>
              </div>
              <button onClick={() => setMessageDetailContent(null)} className="whitespace-nowrap text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
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
        <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm">
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
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none" />
              </div>
              {/* 종료일 */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">종료일</label>
                <input type="date" value={billingEnd} onChange={e => { setBillingEnd(e.target.value); setBillingLabelMonth(''); }}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none" />
              </div>
              {/* ★ 2026-08-20 정산월(라벨) — 서수란 0819 접수. 역월 정산은 표시만(입력 없음),
                  기간이 두 역월에 걸치는 중간정산에서만 선택이 나타난다(기본 종료월). */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">정산월</label>
                {billingLabelOptions.length > 1 ? (
                  <select value={billingLabelEffective} onChange={e => setBillingLabelMonth(e.target.value)}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none bg-white">
                    {billingLabelOptions.map(ym => <option key={ym} value={ym}>{billingLabelText(ym)}</option>)}
                  </select>
                ) : (
                  <div className="px-3 py-2 text-sm text-gray-600">{billingLabelText(billingLabelEffective) || '—'}</div>
                )}
              </div>
              {/* 발행 단위 */}
              <div className="flex items-center gap-3 pb-0.5">
                <label className="flex items-center gap-1.5 text-[13px] cursor-pointer">
                  <input type="radio" checked={billingScope === 'company'} onChange={() => setBillingScope('company')} className="accent-indigo-600" />
                  고객사 전체
                </label>
                <label className="flex items-center gap-1.5 text-[13px] cursor-pointer">
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
                className="whitespace-nowrap px-5 py-2 bg-emerald-600 text-white rounded-lg text-[13px] font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
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
              <div className="flex flex-wrap items-center gap-2">
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
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-violet-500 outline-none" />
                {/* ★ 2026-08-05 (서수란 접수) 재클릭이 닫히지 않던 것 — 옆 [세금계산서·컨펌 현황]만 토글이었다.
                    닫을 때는 목록만 감춘다(담아 둔 회사는 그대로 두고, 다시 열 때 `refreshBulkList`가 살린다).
                    `loadBulkList`는 keepPicked=false라 재클릭이 담긴 목록까지 지웠다 — 그래서 여기서 쓰지 않는다. */}
                <button onClick={() => { if (bulkList !== null) { setBulkList(null); return; } refreshBulkList(); }} disabled={bulkListLoading}
                  className={`whitespace-nowrap px-4 py-2 rounded-lg text-[13px] font-medium disabled:opacity-50 ${bulkList !== null ? 'bg-slate-700 text-white hover:bg-slate-800' : 'bg-violet-600 text-white hover:bg-violet-700'}`}>
                  {bulkListLoading ? '조회 중...' : bulkList !== null ? '미발급 대상 닫기' : '미발급 대상 불러오기'}
                </button>
                <button onClick={() => { const next = !confirmBoardOpen; setConfirmBoardOpen(next); if (next) loadConfirmBoard(); }}
                  className={`whitespace-nowrap px-4 py-2 rounded-lg text-[13px] font-medium border ${confirmBoardOpen ? 'bg-slate-700 text-white border-slate-700' : 'text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                  세금계산서·컨펌 현황
                </button>
                {/* ★ 2026-07-30 추가 청구(080 매핑·KT 명세서·부가서비스 수기) + 최소과금 정액 발행 (서수란 접수) */}
                <button onClick={() => setBilling080Open(true)}
                  className="whitespace-nowrap px-4 py-2 rounded-lg text-[13px] font-medium border text-slate-600 border-slate-300 hover:bg-slate-50">
                  추가 청구 관리
                </button>
                <button onClick={() => setMinChargeOpen(true)}
                  className="whitespace-nowrap px-4 py-2 rounded-lg text-[13px] font-medium border text-slate-600 border-slate-300 hover:bg-slate-50">
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
                          className="whitespace-nowrap px-3 py-1.5 border border-amber-300 text-amber-700 bg-amber-50 rounded text-xs font-semibold hover:bg-amber-100 disabled:opacity-40">
                          선택 수동 정산완료 ({bulkSelected.length})
                        </button>
                        <button onClick={bulkAddSelected} disabled={bulkSelected.length === 0}
                          className="whitespace-nowrap px-3 py-1.5 bg-emerald-600 text-white rounded text-xs font-semibold disabled:opacity-40">
                          선택 담기 ({bulkSelected.length})
                        </button>
                        <button onClick={bulkAddAll} disabled={availAuto.length === 0}
                          className="whitespace-nowrap px-3 py-1.5 bg-violet-600 text-white rounded text-xs font-semibold hover:bg-violet-700 disabled:opacity-40">
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
                              className="whitespace-nowrap px-2 py-1 text-xs text-gray-500 disabled:opacity-30">이전</button>
                            <span className="text-xs text-gray-500">{page} / {totalPages}</span>
                            <button onClick={() => setBulkPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
                              className="whitespace-nowrap px-2 py-1 text-xs text-gray-500 disabled:opacity-30">다음</button>
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
                                className="whitespace-nowrap shrink-0 text-[11px] text-amber-700 hover:underline disabled:opacity-40">해제</button>
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
                          className="whitespace-nowrap px-3 py-1.5 border border-gray-300 text-gray-600 rounded text-xs font-semibold hover:bg-gray-50">
                          {bulkPickedSel.length === bulkCombined.length + bulkByUser.length ? '전체 해제' : '전체 선택'}
                        </button>
                        <button onClick={bulkRemoveSelected} disabled={bulkPickedSel.length === 0}
                          className="whitespace-nowrap px-3 py-1.5 border border-rose-300 text-rose-600 bg-rose-50 rounded text-xs font-semibold hover:bg-rose-100 disabled:opacity-40">
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
                            <button onClick={() => bulkMoveToByUser(c.id)} className="whitespace-nowrap shrink-0 text-[11px] text-sky-600 hover:underline">계정별 ▶</button>
                            <button onClick={() => bulkRemove(c.id)} className="whitespace-nowrap shrink-0 text-[11px] text-gray-400 hover:text-rose-500">빼기</button>
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
                            <button onClick={() => bulkMoveToCombined(c.id)} className="whitespace-nowrap shrink-0 text-[11px] text-emerald-700 hover:underline">◀ 전체</button>
                            <button onClick={() => bulkRemove(c.id)} className="whitespace-nowrap shrink-0 text-[11px] text-gray-400 hover:text-rose-500">빼기</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <button onClick={handleBulkStart} disabled={bulkStarting || (bulkCombined.length + bulkByUser.length === 0)}
                    className="whitespace-nowrap w-full py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-[13px] font-semibold disabled:opacity-40">
                    {bulkStarting ? '접수 중...' : `일괄 발급 시작 (${bulkCombined.length + bulkByUser.length}개사)`}
                  </button>
                </div>
              );
            })()}

            {/* 수동 정산완료 사유 입력 — 청구서를 만들지 않으므로 금액이 남지 않는다. 사유가 유일한 근거다 */}
            {bulkManualAsk !== null && (
              <div className="fixed inset-0 z-[2000] bg-gray-900/40 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5">
                  <h3 className="text-base font-bold text-gray-900 mb-1">수동 정산완료 ({bulkManualAsk.length}개사)</h3>
                  <p className="text-xs text-gray-500 mb-3">
                    {bulkMonth} 대상 목록에서 이 회사들을 뺍니다. <span className="font-semibold text-gray-700">거래내역서는 만들지 않습니다</span>.
                    금액은 시스템에 남지 않으니 어떻게 처리했는지 사유에 적어 주세요. 잘못 눌렀으면 목록에서 해제할 수 있습니다.
                  </p>
                  <textarea value={bulkManualReason} onChange={(e) => setBulkManualReason(e.target.value)} rows={3} maxLength={500}
                    placeholder="예) 별도 양식으로 직접 청구, 담당자 협의분"
                    className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] resize-none focus:ring-2 focus:ring-amber-500 outline-none" autoFocus />
                  <div className="flex gap-2 mt-4">
                    <button onClick={() => { setBulkManualAsk(null); setBulkManualReason(''); }} disabled={bulkManualBusy}
                      className="whitespace-nowrap flex-1 py-2 border border-gray-300 text-gray-600 rounded-lg text-[13px] font-medium hover:bg-gray-50 disabled:opacity-40">
                      취소
                    </button>
                    <button onClick={handleManualComplete} disabled={bulkManualBusy}
                      className="whitespace-nowrap flex-1 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[13px] font-semibold disabled:opacity-40">
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
                      className={`whitespace-nowrap px-2.5 py-1 rounded-full text-[11px] font-semibold border ${confirmStatusFilter === s ? 'bg-slate-700 text-white border-slate-700' : 'text-slate-500 border-slate-300 hover:bg-slate-50'}`}>
                      {s === '' ? '전체' : CONFIRM_STATUS_LABELS[s]}
                    </button>
                  ))}
                  <button onClick={() => loadConfirmBoard()} className="whitespace-nowrap ml-auto text-[11px] text-slate-500 hover:underline">새로고침</button>
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
                                  className="px-1.5 py-0.5 border border-gray-200 rounded text-[10px]" />
                                {/* ★ 2026-08-21 계산서 비고(PO번호) — 같은 통보로 오는 값이라 날짜 옆 한 자리. 필수 회사는 표시·차단. */}
                                <input type="text" value={manualRemarkDraft[r.id] || ''} maxLength={150}
                                  onChange={(e) => setManualRemarkDraft((prev) => ({ ...prev, [r.id]: e.target.value }))}
                                  placeholder={r.require_taxbill_remark ? '비고(PO번호), 필수' : '비고(PO번호 등, 선택)'}
                                  title="계산서 비고란에 그대로 인쇄됩니다"
                                  className={`px-1.5 py-0.5 border rounded text-[10px] w-40 ${r.require_taxbill_remark ? 'border-amber-400 bg-amber-50' : ''}`} />
                                <button onClick={() => handleManualIssueDate(r.id, r.require_taxbill_remark === true)}
                                  className="whitespace-nowrap px-2 py-0.5 bg-amber-500 text-white rounded text-[10px] font-semibold">작성일자 지정</button>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 ml-auto">
                                <span className="text-[10px] text-gray-400">컨펌 전: 작성일자를 지정할 수 없습니다</span>
                                <button onClick={() => { setAdminConfirmTarget(r); setAdminConfirmNote(''); }}
                                  title="업체가 메일·전화로 확인해 준 경우, 근거를 적고 컨펌을 대신 기록합니다."
                                  className="whitespace-nowrap px-2 py-0.5 border border-sky-300 bg-sky-50 text-sky-700 rounded text-[10px] font-semibold hover:bg-sky-100">업체 확인 기록</button>
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
                      className={`whitespace-nowrap px-2.5 py-1 rounded-full text-[11px] font-semibold border ${taxbillBoardOpen ? 'bg-slate-700 text-white border-slate-700' : 'text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                      세금계산서 장부 {taxbillBoardOpen ? '접기' : '열기'}
                    </button>
                    {taxbillBoardOpen && ['', 'ready', 'submitted', 'issued', 'failed'].map((s) => (
                      <button key={s || 'all'}
                        onClick={() => { setTaxbillStatusFilter(s); loadTaxbillIssues(s); }}
                        className={`whitespace-nowrap px-2.5 py-1 rounded-full text-[11px] font-semibold border ${taxbillStatusFilter === s ? 'bg-emerald-600 text-white border-emerald-600' : 'text-slate-500 border-slate-300 hover:bg-slate-50'}`}>
                        {s === '' ? '전체' : TAXBILL_STATUS_LABELS[s]}
                      </button>
                    ))}
                    {taxbillBoardOpen && <button onClick={() => loadTaxbillIssues()} className="whitespace-nowrap ml-auto text-[11px] text-slate-500 hover:underline">새로고침</button>}
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
                                    className="whitespace-nowrap shrink-0 px-2 py-0.5 border border-emerald-300 bg-emerald-50 text-emerald-700 rounded text-[10px] font-semibold hover:bg-emerald-100">메일 재발송</button>
                                )}
                                {t.status === 'issued' && t.nts_confirm_num && t.is_test === false && (
                                  <button onClick={() => openModifyModal(t)}
                                    className="whitespace-nowrap shrink-0 px-2 py-0.5 bg-orange-500 text-white rounded text-[10px] font-semibold hover:bg-orange-600">수정발행</button>
                                )}
                                {/* 수정 장은 열지 않는다 — 당초 승인번호가 테스트베드 것이라 운영에는 그 원본이 없다(서버도 거부한다).
                                    ★ 2026-08-06 (Codex medium) **화이트리스트로 판정한다.** `!== 'modify'`는 NULL·미지의 종류까지
                                    열어, 서버가 422로 막을 동작을 화면이 "가능하다"고 안내하게 된다. 두 계약이 같아야 한다. */}
                                {t.status === 'issued' && t.is_test === true && t.kind === 'original' && (
                                  <button onClick={() => setTaxbillProdTarget(t)}
                                    title="이 문서는 국세청에 없습니다. 같은 문서번호로 운영에 다시 발행합니다."
                                    className="whitespace-nowrap shrink-0 px-2 py-0.5 bg-rose-600 text-white rounded text-[10px] font-semibold hover:bg-rose-700">운영으로 재발행</button>
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
                                    className="whitespace-nowrap shrink-0 px-2 py-0.5 bg-slate-500 text-white rounded text-[10px] font-semibold hover:bg-slate-600">재시도</button>
                                )}
                                                {/* ★ 2026-08-05 발급 대기 취소 — 워커가 국세청으로 보내기 전 유일한 제동 장치다.
                                    그전에는 되돌리는 경로가 고객 이의신청뿐이라 담당자가 손댈 곳이 없었다. */}
                                {t.status === 'ready' && (
                                  <button onClick={() => { setTaxbillCancelTarget(t); setTaxbillCancelReason(''); }}
                                    title="아직 발행 전입니다. 큐에서 내려 워커가 보내지 않게 합니다."
                                    className="whitespace-nowrap shrink-0 px-2 py-0.5 border border-rose-300 bg-rose-50 text-rose-700 rounded text-[10px] font-semibold hover:bg-rose-100">발급 대기 취소</button>
                                )}
                                {/* ★ 2026-08-21 작성일자 변경(서수란 접수 — 라프레리) — 자동 정책(익월 1일)이 만든 작성일자를
                                    발행 전에 고치는 유일한 창구. 승인번호가 생긴 뒤에는 국세청 사실이라 잠근다(서버와 같은 화이트리스트). */}
                                {(t.status === 'ready' || t.status === 'failed') && t.kind === 'original' && !t.nts_confirm_num && (
                                  <button onClick={() => { setTaxbillDateTarget(t); setTaxbillDateValue(String(t.issue_date || '').slice(0, 10)); setTaxbillDateRemark(String(t.taxbill_remark || '')); }}
                                    title="계산서에 적힐 작성일자를 바꿉니다. 문서번호는 그대로입니다."
                                    className="whitespace-nowrap shrink-0 px-2 py-0.5 border border-emerald-300 bg-emerald-50 text-emerald-700 rounded text-[10px] font-semibold hover:bg-emerald-100">작성일자 변경</button>
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
              <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="p-6">
                    <h3 className="text-base font-semibold text-gray-900 mb-1">운영으로 재발행</h3>
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
                      className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">취소</button>
                    <button onClick={handleTaxbillReissueProduction} disabled={taxbillProdBusy}
                      className="whitespace-nowrap flex-1 px-4 py-3 bg-rose-600 text-white font-semibold hover:bg-rose-700 transition-colors disabled:opacity-50">
                      {taxbillProdBusy ? '올리는 중...' : '국세청으로 발행'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── 발급 대기 취소 모달 (★2026-08-05) ── */}
            {taxbillCancelTarget && (
              <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="p-6">
                    <h3 className="text-base font-semibold text-gray-900 mb-1">발급 대기 취소</h3>
                    <p className="text-sm text-gray-600 mb-1">
                      <strong>{taxbillCancelTarget.company_name}</strong> · 작성일자 {taxbillCancelTarget.issue_date}
                      {' · '}{(Number(taxbillCancelTarget.total_amount) || 0).toLocaleString()}원
                    </p>
                    <p className="text-xs text-gray-500 mb-4">아직 발행 전입니다. 5분 주기 워커가 곧 국세청으로 보냅니다.</p>

                    <label className="block text-xs font-semibold text-gray-600 mb-1">취소 사유</label>
                    <textarea value={taxbillCancelReason} onChange={(e) => setTaxbillCancelReason(e.target.value)} rows={3} maxLength={200}
                      placeholder="예) 업체 확인 결과 8월 LMS 수량이 달라 재발행 예정"
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-rose-500 outline-none resize-none" />

                    <div className="mt-3 px-3 py-2 bg-rose-50 rounded-lg text-[11px] text-rose-800">
                      큐에서 내리면 이 계산서는 발행되지 않습니다. 금액을 고치려면 그 뒤 <strong>수량 조정 재발행</strong> 또는
                      <strong> 삭제 후 재발행</strong>으로 진행합니다. 이미 발행에 들어간 건은 취소되지 않고 수정세금계산서 축입니다.
                    </div>
                  </div>
                  <div className="flex border-t">
                    <button onClick={() => { setTaxbillCancelTarget(null); setTaxbillCancelReason(''); }} disabled={taxbillCancelBusy}
                      className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">닫기</button>
                    <button onClick={handleTaxbillCancel} disabled={taxbillCancelBusy || !taxbillCancelReason.trim()}
                      className="whitespace-nowrap flex-1 px-4 py-3 bg-rose-600 text-white font-semibold hover:bg-rose-700 transition-colors disabled:opacity-50">
                      {taxbillCancelBusy ? '처리 중...' : '발급 대기에서 내리기'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── 작성일자 변경 모달 (★2026-08-21 서수란 접수 — 라프레리) ── */}
            {taxbillDateTarget && (
              <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="p-6">
                    <h3 className="text-base font-semibold text-gray-900 mb-1">작성일자 변경</h3>
                    <p className="text-sm text-gray-600 mb-1">
                      <strong>{taxbillDateTarget.company_name}</strong> · 현재 작성일자 {String(taxbillDateTarget.issue_date || '').slice(0, 10)}
                      {' · '}{(Number(taxbillDateTarget.total_amount) || 0).toLocaleString()}원
                    </p>
                    <p className="text-xs text-gray-500 mb-4">아직 국세청에 발행되지 않은 계산서입니다. 문서번호는 그대로 유지됩니다.</p>

                    <label className="block text-xs font-semibold text-gray-600 mb-1">새 작성일자</label>
                    <input type="date" value={taxbillDateValue} onChange={(e) => setTaxbillDateValue(e.target.value)}
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none" />

                    {/* ★ 2026-08-21 계산서 비고(PO번호) — 발행 패스가 팝빌 비고란에 그대로 싣는다. 기존 값이 기본으로 채워진다. */}
                    <label className="block text-xs font-semibold text-gray-600 mb-1 mt-3">계산서 비고 (PO번호 등 · 선택)</label>
                    <input type="text" value={taxbillDateRemark} maxLength={150} onChange={(e) => setTaxbillDateRemark(e.target.value)}
                      placeholder="예) PO-2026-0831 (계산서 비고란에 인쇄됩니다)"
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none" />

                    <div className="mt-3 px-3 py-2 bg-indigo-50 rounded-lg text-[11px] text-indigo-800">
                      오늘이거나 지난 날짜면 5분 안에 자동 발행되고, 미래 날짜면 그날 발행됩니다. 발행 실패 상태였던 건은
                      변경과 동시에 발급 대기로 되돌아갑니다. 비고를 비우면 계산서 비고도 비워집니다.
                    </div>
                  </div>
                  <div className="flex border-t">
                    <button onClick={() => { setTaxbillDateTarget(null); setTaxbillDateValue(''); setTaxbillDateRemark(''); }} disabled={taxbillDateBusy}
                      className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">닫기</button>
                    <button onClick={handleTaxbillIssueDateChange} disabled={taxbillDateBusy || !taxbillDateValue}
                      className="whitespace-nowrap flex-1 px-4 py-3 bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50">
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
              <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="p-6">
                    <h3 className="text-base font-semibold text-gray-900 mb-1">수정 계산서 재발행 확인</h3>
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
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-amber-500 outline-none resize-none" />

                    <div className="mt-3 px-3 py-2 bg-amber-50 rounded-lg text-[11px] text-amber-900">
                      이 재시도가 성공하면 <strong>국세청에 있는 당초 문서가 실제로 취소·정정됩니다.</strong>
                      전에 실패했던 이유가 해소돼 지금은 나갈 수 있습니다. 그 정정이 지금도 필요한지 확인해 주세요.
                    </div>
                  </div>
                  <div className="flex border-t">
                    <button onClick={() => { setTaxbillRetryTarget(null); setTaxbillRetryReason(''); }}
                      className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">닫기</button>
                    <button onClick={() => handleTaxbillRetry(taxbillRetryTarget.id, { reason: taxbillRetryReason.trim() })}
                      disabled={!taxbillRetryReason.trim()}
                      className="whitespace-nowrap flex-1 px-4 py-3 bg-amber-600 text-white font-semibold hover:bg-amber-700 transition-colors disabled:opacity-50">
                      확인하고 재발행
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── 업체 확인 대리 기록 모달 (★2026-08-05 서수란 접수) ── */}
            {adminConfirmTarget && (
              <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="p-6">
                    <h3 className="text-base font-semibold text-gray-900 mb-1">업체 확인 기록</h3>
                    <p className="text-sm text-gray-600 mb-1">
                      <strong>{adminConfirmTarget.company_name}</strong>
                      {adminConfirmTarget.account_name && ` (${adminConfirmTarget.account_name})`}
                      {' · '}{(Number(adminConfirmTarget.total_amount) || 0).toLocaleString()}원
                    </p>
                    <p className="text-xs text-gray-500 mb-4">{adminConfirmTarget.billing_start} ~ {adminConfirmTarget.billing_end}</p>

                    <label className="block text-xs font-semibold text-gray-600 mb-1">어떻게 확인받았습니까</label>
                    <textarea value={adminConfirmNote} onChange={(e) => setAdminConfirmNote(e.target.value)} rows={3} maxLength={200}
                      placeholder="예) 8/5 구매팀 김OO 과장 메일로 8월 3일자 발행 요청 (PO 첨부)"
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-sky-500 outline-none resize-none" />

                    <div className="mt-3 px-3 py-2 bg-sky-50 rounded-lg text-[11px] text-sky-800">
                      업체가 컨펌 링크를 누르지 않고 메일·전화로 확인해 준 경우에만 씁니다. 기록하면 컨펌 시각이 남아
                      <strong> 작성일자를 지정할 수 있게</strong> 되고, 지정하는 순간 계산서가 발행됩니다. 적은 내용은 나중에 근거가 됩니다.
                    </div>
                  </div>
                  <div className="flex border-t">
                    <button onClick={() => { setAdminConfirmTarget(null); setAdminConfirmNote(''); }} disabled={adminConfirmBusy}
                      className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">취소</button>
                    <button onClick={handleAdminConfirm} disabled={adminConfirmBusy || !adminConfirmNote.trim()}
                      className="whitespace-nowrap flex-1 px-4 py-3 bg-sky-600 text-white font-semibold hover:bg-sky-700 transition-colors disabled:opacity-50">
                      {adminConfirmBusy ? '기록 중...' : '확인 기록'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── 계산서 메일 재발송 모달 (★2026-08-05 서수란 접수) ── */}
            {taxbillResendTarget && (
              <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="p-6">
                    <h3 className="text-base font-semibold text-gray-900 mb-1">계산서 메일 재발송</h3>
                    <p className="text-sm text-gray-600 mb-1">
                      <strong>{taxbillResendTarget.company_name}</strong> · 작성일자 {taxbillResendTarget.issue_date}
                      {' · '}{(Number(taxbillResendTarget.total_amount) || 0).toLocaleString()}원
                    </p>
                    <p className="text-xs text-gray-500 mb-4">승인번호 {taxbillResendTarget.nts_confirm_num || '대기'}</p>

                    <label className="block text-xs font-semibold text-gray-600 mb-1">받는 사람 (선택)</label>
                    <input type="email" value={taxbillResendEmail} onChange={(e) => setTaxbillResendEmail(e.target.value)}
                      placeholder="비우면 등록된 계산서 수신자 전원에게 보냅니다"
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500 outline-none" />

                    <div className="mt-3 px-3 py-2 bg-emerald-50 rounded-lg text-[11px] text-emerald-800">
                      이미 발행된 <strong>그 계산서를 그대로 다시 메일링</strong>합니다. 계산서를 새로 만들지 않으므로
                      국세청에 문서가 한 장 더 나가지 않습니다. 금액이 틀린 건은 [수정발행]으로 정정합니다.
                    </div>
                  </div>
                  <div className="flex border-t">
                    <button onClick={() => { setTaxbillResendTarget(null); setTaxbillResendEmail(''); }} disabled={taxbillResendBusy}
                      className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">취소</button>
                    <button onClick={handleTaxbillResend} disabled={taxbillResendBusy}
                      className="whitespace-nowrap flex-1 px-4 py-3 bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50">
                      {taxbillResendBusy ? '보내는 중...' : '메일 다시 보내기'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── 수정세금계산서 발급 모달 (★2026-07-30) ── */}
            {modifyTarget && (
              <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="p-6">
                    <h3 className="text-base font-semibold text-gray-900 mb-1">수정세금계산서 발급</h3>
                    <p className="text-sm text-gray-600 mb-1"><strong>{modifyTarget.company_name}</strong> · 당초 작성일자 {modifyTarget.issue_date}</p>
                    <p className="text-xs text-gray-500 mb-4">
                      당초 공급가액 {Number(modifyTarget.supply_amount).toLocaleString()}원 · 세액 {Number(modifyTarget.tax_amount).toLocaleString()}원 · 승인번호 {modifyTarget.nts_confirm_num}
                    </p>

                    <label className="block text-xs font-semibold text-gray-600 mb-1">수정 사유</label>
                    <select value={modifyCode} onChange={(e) => setModifyCode(Number(e.target.value))}
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] mb-3 focus:ring-2 focus:ring-emerald-500/30 outline-none">
                      {[6, 4, 2, 1].map((c) => <option key={c} value={c}>{MODIFY_CODE_LABELS[c]}</option>)}
                    </select>

                    {(modifyCode === 2 || modifyCode === 4) && (
                      <div className="mb-3">
                        <label className="block text-xs font-semibold text-gray-600 mb-1">{modifyCode === 2 ? '변동일 (작성일자)' : '해제일 (작성일자)'}</label>
                        <input type="date" value={modifyWriteDate} onChange={(e) => setModifyWriteDate(e.target.value)}
                          className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none" />
                        {modifyCode === 2 && <p className="mt-1 text-[10px] text-amber-600">공급가액 변동은 변동일 기준 익월 10일이 발급 기한입니다.</p>}
                      </div>
                    )}

                    {modifyCode === 2 && (
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">공급가액 변동분 (±원)</label>
                          <input type="number" step="1" value={modifyDeltaSupply} onChange={(e) => setModifyDeltaSupply(e.target.value)} placeholder="-200000"
                            className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">세액 변동분 (±원)</label>
                          <input type="number" step="1" value={modifyDeltaTax} onChange={(e) => setModifyDeltaTax(e.target.value)} placeholder="-20000"
                            className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none" />
                        </div>
                      </div>
                    )}

                    {modifyCode === 1 && (
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">정정 후 공급가액 (원)</label>
                          <input type="number" step="1" value={modifyCorrectedSupply} onChange={(e) => setModifyCorrectedSupply(e.target.value)}
                            className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">정정 후 세액 (원)</label>
                          <input type="number" step="1" value={modifyCorrectedTax} onChange={(e) => setModifyCorrectedTax(e.target.value)}
                            className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none" />
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
                      className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">취소</button>
                    <button onClick={handleModifySubmit} disabled={modifySubmitting}
                      className="whitespace-nowrap flex-1 px-4 py-3 bg-orange-500 text-white font-semibold hover:bg-orange-600 transition-colors disabled:opacity-50">
                      {modifySubmitting ? '요청 중...' : '발급 대기에 올리기'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ===== 2. 정산 목록 ===== */}
          <div className="px-6 py-5 border-b">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                정산 목록
              </h3>
              <div className="flex flex-wrap items-center gap-2">
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
                      className="whitespace-nowrap px-3 py-1.5 rounded-lg text-[13px] font-semibold border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                      선택 청구 확정 ({billingSel.length})
                    </button>
                    <button type="button" onClick={() => runBillingBulk('send')} disabled={billingsLoading || billingsKey !== billingFilterKey}
                      title="선택한 건 중 아직 발송되지 않은 청구서를 한 번에 보냅니다. 이미 나간 건은 행의 [재발송]으로 확인 후 보냅니다."
                      className="whitespace-nowrap px-3 py-1.5 rounded-lg text-[13px] font-semibold border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                      선택 발송 ({billingSel.length})
                    </button>
                    <button type="button" onClick={() => setBillingSel([])}
                      className="whitespace-nowrap px-2 py-1.5 rounded-lg text-[13px] text-gray-500 hover:bg-gray-50 transition-colors">선택 해제</button>
                  </>
                )}
                {/* ★ 2026-08-05 총 정산표 — 소유자(ceo) 전용. 전 고객사 총 청구금·수금·미납을 한 화면에.
                    권한이 없는 계정에는 버튼 자체가 안 그려지고, 서버가 403으로 최종 판정한다. */}
                {canViewSettlementOverview && (
                  <button type="button" onClick={() => setShowSettlementOverview(true)}
                    title="전 고객사의 총 청구금·수금완료·미납을 한 화면에서 봅니다"
                    className="whitespace-nowrap px-3 py-1.5 rounded-lg text-[13px] font-semibold border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors">
                    총 정산표
                  </button>
                )}
                {/* ★ 2026-07-28 발행됐는데 고객에게 안 나간 장. 금액 불일치로 발송이 막힌 장은 컨펌 추적 목록에 안 뜬다 */}
                <button type="button" onClick={() => setBillingUnsentOnly(!billingUnsentOnly)}
                  className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-[13px] font-semibold border transition-colors ${billingUnsentOnly ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
                  발행됨 · 미발송만
                </button>
                {/* ★ 2026-08-06 검색 (Harold 지시) — 목록이 길어 원하는 회사를 찾기 어려웠다. 화면 안에서만 좁힌다. */}
                <div className="relative">
                  <input type="text" value={billingSearch} onChange={(e) => setBillingSearch(e.target.value)}
                    placeholder="고객사·계정 검색"
                    className="w-44 pl-3 pr-7 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none" />
                  {billingSearch && (
                    <button type="button" onClick={() => setBillingSearch('')}
                      aria-label="검색어 지우기"
                      className="whitespace-nowrap absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-[13px]">×</button>
                  )}
                </div>
                <select value={filterYear} onChange={e => setFilterYear(Number(e.target.value))}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none">
                  {billingYearOptions.map(y => <option key={y} value={y}>{y}년</option>)}
                </select>
                {/* ★ 2026-08-20 정산월 필터 (서수란 0819 접수 — 월별 관리) */}
                <select value={filterMonth} onChange={e => setFilterMonth(Number(e.target.value))}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none">
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
                <table className="w-full text-[13px]">
                  <thead className="bg-gray-50">
                    <tr>
                      {/* ★ 2026-08-05 (서수란 접수) 전체 선택. ★2026-08-06 페이징이 생기면서 기준을 **이 페이지**로
                          한다(일괄발급 목록과 같은 규약) — 안 보이는 건까지 한 번에 선택되면 그게 사고다.
                          선택 자체는 페이지를 넘겨도 유지되므로 여러 페이지에 걸쳐 고를 수 있다. */}
                      <th className="whitespace-nowrap px-3 py-2 text-center w-10">
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
                      <th className="whitespace-nowrap px-4 py-2 text-left text-gray-500 font-medium">고객사</th>
                      <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">구분</th>
                      <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">정산월</th>
                      {/* ★ 2026-08-04 SMS·LMS 두 컬럼을 '유형별'로 교체. 청구 축은 최대 14종(웹 4 + 에이전트 4 +
                          테스트 2 + 스팸 2 + 요금제 + AI 크레딧)이라 두 컬럼으로는 담기지 않는다 —
                          SMS/LMS뿐인 회사에선 맞아 보이고 `both` 회사에선 틀려 보였다. */}
                      <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">유형별</th>
                      <th className="whitespace-nowrap px-4 py-2 text-right text-gray-500 font-medium">합계</th>
                      <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">상태</th>
                      <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">발송일</th>
                      <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">관리</th>
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
                            className="whitespace-nowrap px-2.5 py-1 text-xs font-medium text-emerald-700 border border-emerald-200 rounded-md hover:bg-emerald-50 transition-colors">
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
                                className="whitespace-nowrap px-2 py-1 text-xs bg-amber-100 text-amber-700 rounded hover:bg-amber-200 disabled:opacity-50 transition-colors">
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
                                className="whitespace-nowrap px-2 py-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 transition-colors">
                                재발송
                              </button>
                            )}
                            <button onClick={() => downloadBillingPdf(b.id, `${b.company_name}_${b.billing_year}_${b.billing_month}`)}
                              className="whitespace-nowrap px-2 py-1 text-xs bg-emerald-100 text-emerald-700 rounded hover:bg-indigo-200 transition-colors">PDF</button>
                            {/* ★ 2026-08-05 (서수란 질의 "확정 버튼의 의미가 뭔가요?") — 축을 눈에 보이게 갈랐다.
                                발송·PDF는 **발행 축**이고, 아래 둘은 **수금 축**(draft → confirmed → paid)이다.
                                확정은 발행의 관문이 아니다 — 발송은 status를 보지 않고, 세금계산서는 고객 컨펌
                                (또는 기한 도래)이 큐를 움직인다. 같은 줄에 같은 크기로 붙어 있어서 담당자가
                                "이걸 눌러야 다음이 되나"로 읽었다. 구분선 + 문구로 뜻을 드러낸다. */}
                            <span className="mx-0.5 h-4 w-px bg-gray-200" aria-hidden="true" />
                            {b.status === 'draft' && (
                              <button onClick={() => handleBillingStatusChange(b.id, 'confirmed')}
                                title="수금 관리용 표시입니다. 이 금액으로 굳혔다는 뜻이고, 발송·세금계산서 발행과는 무관합니다. 확정 뒤에는 삭제할 때 사유가 필요합니다."
                                className="whitespace-nowrap px-2 py-1 text-xs bg-emerald-100 text-emerald-700 rounded hover:bg-blue-200 transition-colors">청구 확정</button>
                            )}
                            {b.status === 'confirmed' && (
                              <button onClick={() => handleBillingStatusChange(b.id, 'paid')}
                                title="입금을 받았다는 표시입니다. 총 정산표의 미납 집계에서 빠집니다."
                                className="whitespace-nowrap px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors">수금완료</button>
                            )}
                            {/* ★ 2026-08-04 옛 [발송](openEmailModal → POST /:id/send-email)을 여기서 뺐다.
                                그 경로는 emailed_at만 찍고 컨펌 추적행을 만들지 않아, 누르는 순간 그 청구서가
                                컨펌·이의신청·세금계산서 흐름에서 통째로 빠졌다(서수란 0804 접수의 원인).
                                발송은 위 컨펌 경로 하나로 통일했다. 모달·라우트 자체는 남아 있으나 화면 진입점은 없다
                                — 완전 철거는 소비처 grep 후 별건(0728 필터항목 탭과 같은 방식). */}
                            {/* ★ 2026-08-04 업체와 수량이 다를 때 사람이 실제 수량을 적고 다시 발행한다(서수란 접수). */}
                            <button onClick={() => setQtyAdjustTarget({ id: b.id, companyName: b.company_name, accountName: b.account_name || null })}
                              className="whitespace-nowrap px-2 py-1 text-xs bg-violet-100 text-violet-700 rounded hover:bg-violet-200 transition-colors">수량 조정</button>
                            <button onClick={() => { setDeleteTargetId(b.id); setDeleteReason(''); setShowBillingDeleteConfirm(true); }}
                              className="whitespace-nowrap px-2 py-1 text-xs bg-red-100 text-red-600 rounded hover:bg-red-200 transition-colors">삭제</button>
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
                      className="whitespace-nowrap px-2 py-1 text-xs text-gray-500 disabled:opacity-30 hover:text-gray-800">이전</button>
                    <span className="text-xs text-gray-500 tabular-nums">
                      {billingPageNow} / {billingTotalPages}
                      <span className="ml-2 text-gray-400">({billingRows.length}건)</span>
                    </span>
                    <button type="button" onClick={() => setBillingPage(Math.min(billingTotalPages, billingPageNow + 1))}
                      disabled={billingPageNow >= billingTotalPages}
                      className="whitespace-nowrap px-2 py-1 text-xs text-gray-500 disabled:opacity-30 hover:text-gray-800">다음</button>
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
            <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-[60]">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-6 max-h-[75vh] overflow-y-auto">
                  <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h3 className="text-base font-semibold text-center text-gray-900 mb-2">정산 생성</h3>
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
                          {/* ★ 2026-09-04 안내 분기(서수란 접수 후속) — 종전엔 단가 관련 차단이면 무조건
                              "빈 단가를 채우라"고 했다. `UNBILLABLE_TYPE_KEY`는 **채울 칸 자체가 없는** 유형이라
                              그 안내가 거짓이고, 운영자가 단가 화면을 뒤지다 시간을 버린다(0904 랩디 KL). */}
                          {(billingPreview.billing_guard.blocker_codes || []).some((c: string) => c === 'WEB_UNIT_PRICE_UNSET' || c === 'AGENT_UNIT_PRICE_MISSING') && (
                            <p className="text-xs text-red-600 mt-2 pt-2 border-t border-red-200">
                              고객사 관리 → 해당 고객사 수정 → 단가설정에서 빈 단가를 채운 뒤 다시 시도해 주세요.
                            </p>
                          )}
                          {(billingPreview.billing_guard.blocker_codes || []).includes('UNBILLABLE_TYPE_KEY') && (
                            <p className="text-xs text-red-600 mt-2 pt-2 border-t border-red-200">
                              위 유형은 단가를 입력할 칸이 없어 화면에서 해결되지 않습니다. 개발팀에 그 유형 코드를 전달해 주세요.
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
                    className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">취소</button>
                  <button
                    onClick={handleBillingGenerate}
                    disabled={generating || billingPreviewLoading || billingPreview?.billing_guard?.billable === false}
                    className="whitespace-nowrap flex-1 px-4 py-3 text-emerald-700 font-medium hover:bg-emerald-50 transition-colors disabled:opacity-40 disabled:hover:bg-transparent">
                    {generating ? '생성 중...' : billingPreviewLoading ? '집계 중...' : '발행'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ===== 정산 삭제 확인 모달 ===== */}
          {showBillingDeleteConfirm && (
            <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-[60]">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-6">
                  <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </div>
                  <h3 className="text-base font-semibold text-center text-gray-900 mb-2">정산 삭제</h3>
                  <p className="text-sm text-center text-gray-600">
                    이 정산과 일자별 상세 데이터가 모두 삭제됩니다.<br />
                    계정별 묶음 발행분은 <strong>묶음 전체(계정 장 + 공통 장)</strong>가 함께 삭제됩니다.<br />계속하시겠습니까?
                  </p>
                  {/* ★ 2026-07-26 확정·수금·메일 발송분은 사유 필수 — 없으면 서버가 422로 막고 이 칸을 다시 연다 */}
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-gray-500 mb-1">삭제 사유 (확정·수금·메일 발송분은 필수)</label>
                    <textarea value={deleteReason} onChange={e => setDeleteReason(e.target.value)} rows={2}
                      placeholder="예: 단가 오설정으로 금액 오류, 재발행 예정"
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-red-400 outline-none resize-none" />
                  </div>
                </div>
                <div className="flex border-t">
                  <button onClick={() => setShowBillingDeleteConfirm(false)}
                    className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r">취소</button>
                  <button onClick={handleBillingDelete}
                    className="whitespace-nowrap flex-1 px-4 py-3 text-red-600 font-medium hover:bg-red-50 transition-colors">삭제</button>
                </div>
              </div>
            </div>
          )}


          {/* ===== 정산 상세 모달 ===== */}
          {showBillingDetail && (
            <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-[60]">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col">
                {/* 모달 헤더 */}
                <div className="px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-white flex items-center justify-between flex-shrink-0">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">
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
                          <table className="w-full text-[13px]">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="whitespace-nowrap px-3 py-2 text-left text-gray-500 font-medium">항목</th>
                                <th className="whitespace-nowrap px-3 py-2 text-right text-gray-500 font-medium">수량</th>
                                <th className="whitespace-nowrap px-3 py-2 text-right text-gray-500 font-medium">단가</th>
                                <th className="whitespace-nowrap px-3 py-2 text-right text-gray-500 font-medium">금액</th>
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
                          <table className="w-full text-[13px]">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="whitespace-nowrap px-3 py-2 text-left text-gray-500 font-medium">일자</th>
                                {/* ★ 2026-07-26 '구분' 열 — 축이 채널·계정·발송ID로 쪼개지면서 같은 날 같은 유형
                                    행이 여러 줄 생긴다. 구분이 없으면 중복 오류로 보인다(PDF 2페이지와 같은 열). */}
                                <th className="whitespace-nowrap px-3 py-2 text-left text-gray-500 font-medium">구분</th>
                                <th className="whitespace-nowrap px-3 py-2 text-left text-gray-500 font-medium">유형</th>
                                <th className="whitespace-nowrap px-3 py-2 text-right text-gray-500 font-medium">전송</th>
                                <th className="whitespace-nowrap px-3 py-2 text-right text-gray-500 font-medium">성공</th>
                                <th className="whitespace-nowrap px-3 py-2 text-right text-gray-500 font-medium">실패</th>
                                <th className="whitespace-nowrap px-3 py-2 text-right text-gray-500 font-medium">대기</th>
                                <th className="whitespace-nowrap px-3 py-2 text-right text-gray-500 font-medium">단가</th>
                                <th className="whitespace-nowrap px-3 py-2 text-right text-gray-500 font-medium">금액</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {detailItems.map((item: any, idx: number) => {
                                // 채널 판정은 유형키 접두가 아니라 channel — 접두 판정은 새 유형이 생기면 조용히 어긋난다.
                                const ch = String(item.channel || 'web');
                                const isPlan = ch === 'plan';
                                // ★ 2026-09-16 발송 수량 축이 없는 행 — 요금제·추가 항목(080·부가서비스).
                                //   PDF 2페이지는 처음부터 이 둘을 '-'로 그렸는데 화면만 0을 찍고 있었다.
                                //   수기 항목이 `단가 × 수량` 한 줄이 되면서 그 0이 "9건인데 0"으로 읽힌다 — 같은 규약으로 맞춘다.
                                const noQtyAxis = isPlan || ch === 'extra';
                                const planDays = Number(item.plan_days) || 0;
                                // 요금제 행은 발송이 아니다 — 일자 칸에 적용 구간, 수량 4칸에 '-'.
                                const dateText = isPlan && planDays > 1
                                  ? `${String(item.item_date).slice(5, 10)}~${billingShiftDay(item.item_date, planDays - 1)}`
                                  : String(item.item_date).slice(5, 10);
                                // ★ 2026-09-16 수기 부가서비스는 **입력한 항목명**이 유형 칸이다(PDF와 같은 규약).
                                //   그 전에는 여기에 내부 키(EXTRA_MANUAL)가 그대로 보였다(서수란 접수).
                                const extraLabel = String(item.item_label ?? '').trim();
                                const typeText = isPlan
                                  ? String(item.message_type).replace(/^PLAN_/, '')
                                  : (extraLabel || billingTypeLabel[item.message_type] || item.message_type);
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
                                    {noQtyAxis ? (
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
                          className="whitespace-nowrap px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors">청구 확정</button>
                      )}
                      {detailBilling.status === 'confirmed' && (
                        <button onClick={() => handleBillingStatusChange(detailBilling.id, 'paid')}
                          title="입금을 받았다는 표시입니다. 총 정산표의 미납 집계에서 빠집니다."
                          className="whitespace-nowrap px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">수금완료</button>
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
                          className="px-4 py-1.5 text-[13px] bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors flex items-center gap-1.5">
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
                          className="px-4 py-1.5 text-[13px] border border-amber-300 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors flex items-center gap-1.5">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          거래내역서 재발송
                        </button>
                      )}
                      <button onClick={() => downloadBillingPdf(detailBilling.id, `${detailBilling.company_name}_${detailBilling.billing_year}_${detailBilling.billing_month}`)}
                        className="px-4 py-1.5 text-[13px] bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-1.5">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        PDF 다운로드
                      </button>
                      <button onClick={() => setShowBillingDetail(false)}
                        className="whitespace-nowrap px-4 py-1.5 text-[13px] text-gray-600 border rounded-lg hover:bg-gray-100 transition-colors">닫기</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== 정산서 이메일 발송 모달 ===== */}
          {showEmailModal && emailTarget && (
            <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-[60]">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-6">
                  <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h3 className="text-base font-semibold text-center text-gray-900 mb-2">정산서 이메일 발송</h3>
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
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-amber-500 outline-none"
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
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-amber-500 outline-none"
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
                    className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
                    disabled={emailSending}
                  >
                    취소
                  </button>
                  <button
                    onClick={() => handleSendBillingEmail(Boolean(emailResendInfo))}
                    disabled={emailSending}
                    className="whitespace-nowrap flex-1 px-4 py-3 text-amber-600 font-medium hover:bg-amber-50 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
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
      {activeTab === 'syncAgents' && <SyncAgentsTab {...{ getSyncOnlineBadge, loadSyncAgents, setShowSyncCommandModal, setShowSyncConfigModal, setShowSyncDeleteModal, setShowSyncDetailModal, setShowSyncMappingModal, setShowSyncReleaseModal, setSyncAgentDetail, setSyncCommandType, setSyncConfigForm, setSyncDetailLoading, setSyncMapAckSupported, setSyncMapCustomers, setSyncMapPurchases, setSyncMapReportLoading, setSyncMapReported, setSyncReleaseForm, setSyncSelectedAgent, showAlert, syncAgents, syncAgentsLoading, syncTimeAgo }} />}

      {/* ★ D145 P0: 로그인 차단 관리 탭 */}
      {activeTab === 'loginBlocks' && (
        <LoginBlocksManagement />
      )}

      {/* ★ 2026-10-03 운영 기록 대장(로그 점검 · 방화벽 변경 · 권한 점검) */}
      {activeTab === 'opsRecords' && <OpsRecordsTab />}

      {/* ★ 2026-07-17 발송 라인 설정 탭 — LINE_GROUP_ADMIN_USERS(기본 ceo,admin) 전용 */}
      {activeTab === 'lineGroups' && lineGroupCanManage && <LineGroupsTab {...{ lineGroups, lineGroupsLoading, loadLineGroups, setEditingLineGroup, showAlert, showConfirm }} />}

      {/* ★ 2026-07-17 라인그룹 생성/수정 모달 */}
      {editingLineGroup && <LineGroupEditModal {...{ editingLineGroup, lineGroupSaving, loadLineGroups, setEditingLineGroup, setLineGroupSaving, showAlert }} />}

      {/* ★ 2026-08-16 신규마케팅진단 탭 — ceo 전용(서버 게이트 404 은닉과 이중) */}
      {activeTab === 'marketingDiagnosis' && diagnosisAllowed && (
        <DiagnosisAdminPanel
          onBadgeRefresh={loadDiagnosisBadge}
          toast={(msg, type) => setBillingToast({ msg, type })}
        />
      )}

      {/* 감사 로그 탭 */}
      {activeTab === 'auditLogs' && auditAccessAllowed && <AuditLogsTab {...{ auditActionFilter, auditActions, auditCompanyFilter, auditFromDate, auditLogs, auditLogsLoading, auditLogsPage, auditLogsTotal, auditLogsTotalPages, auditToDate, companies, loadAuditLogs, setAuditActionFilter, setAuditCompanyFilter, setAuditFromDate, setAuditToDate }} />}

      
      </main>
      {showSyncDetailModal && <SyncDetailModal {...{ getSyncOnlineBadge, setShowSyncDetailModal, syncAgentDetail, syncDetailLoading, syncSelectedAgent }} />}

      {/* Sync 설정 변경 모달 */}
      {showSyncConfigModal && syncSelectedAgent && <SyncConfigModal {...{ loadSyncAgents, setShowSyncConfigModal, setSyncConfigForm, showAlert, syncConfigForm, syncSelectedAgent }} />}

      {/* ★ D131 후속(2026-04-21): Sync Agent 삭제 확인 모달 */}
      {showSyncDeleteModal && syncSelectedAgent && <SyncDeleteModal {...{ loadSyncAgents, setShowSyncDeleteModal, setSyncDeleting, showAlert, showConfirm, syncDeleting, syncSelectedAgent, syncTimeAgo }} />}

      {/* ★ 2026-07-01: 원격 컬럼 매핑 편집 모달 (update_config) */}
      {showSyncMappingModal && syncSelectedAgent && <SyncMappingModal {...{ loadSyncAgents, setShowSyncMappingModal, setSyncMapCustomers, setSyncMapDryRunning, setSyncMapPurchases, setSyncMapSaving, showAlert, showConfirm, syncMapAckSupported, syncMapCustomers, syncMapDryRunning, syncMapPurchases, syncMapReportLoading, syncMapReported, syncMapSaving, syncSelectedAgent }} />}

      {/* ★ 2026-07-01: 자동 업데이트 릴리즈 등록 모달 */}
      {showSyncReleaseModal && <SyncReleaseModal {...{ setShowSyncReleaseModal, setSyncReleaseForm, setSyncReleaseSaving, showAlert, syncReleaseForm, syncReleaseSaving }} />}

      {/* Sync 명령 전송 모달 */}
      {showSyncCommandModal && syncSelectedAgent && <SyncCommandModal {...{ loadSyncAgents, setShowSyncCommandModal, setSyncCommandType, showAlert, syncCommandType, syncSelectedAgent }} />}

      {/* 플랜 신청 거절 모달 */}
      {showRejectModal && rejectTarget && <RequestRejectModal {...{ loadPlanRequests, rejectReason, rejectTarget, setModal, setRejectReason, setRejectTarget, setShowRejectModal }} />}

      {/* 충전 승인 확인 모달 */}
      {showDepositApproveModal && depositTarget && <DepositApproveModal {...{ chargeTxPage, depositAdminNote, depositTarget, loadChargeManagement, setDepositAdminNote, setDepositTarget, setModal, setShowDepositApproveModal }} />}

      {/* 충전 거절 모달 */}
      {showDepositRejectModal && depositTarget && <DepositRejectModal {...{ chargeTxPage, depositAdminNote, depositTarget, loadChargeManagement, setDepositAdminNote, setDepositTarget, setModal, setShowDepositRejectModal }} />}

      {/* ===== 고객 개별/선택 삭제 확인 모달 (최상위) ===== */}
      {showAdminCustDeleteModal && adminCustDeleteTarget && editCompany && <AdminCustomerDeleteModal {...{ adminCustDeleteLoading, adminCustDeleteTarget, adminCustPage, adminCustSelected, editCompany, loadAdminCustomers, setAdminCustDeleteLoading, setAdminCustDeleteTarget, setShowAdminCustDeleteModal, showAlert }} />}

      {/* ===== 고객 전체 삭제 확인 모달 (최상위) ===== */}
      {showCustomerDeleteAll && editCompany && <CustomerDeleteAllModal {...{ customerDeleteConfirmName, customerDeleteLoading, editCompany, loadData, setCustomerDeleteConfirmName, setCustomerDeleteLoading, setShowCustomerDeleteAll, showAlert }} />}
    </div>
  );
}
