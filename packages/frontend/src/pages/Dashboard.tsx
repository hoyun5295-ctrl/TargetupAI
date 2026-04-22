import { Award, BarChart3, Bell, BellOff, Cake, Calendar, ChevronLeft, ChevronRight, Clock, CreditCard, DollarSign, HelpCircle, Mail, MapPin, Percent, Rocket, Send, ShoppingCart, Sparkles, Store, User, UserPlus, Users, UserX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiApi, campaignsApi, customersApi } from '../api/client';
import AddressBookModal from '../components/AddressBookModal';
import AiCampaignResultPopup from '../components/AiCampaignResultPopup';
import AiCampaignSendModal from '../components/AiCampaignSendModal';
import AiCustomSendFlow from '../components/AiCustomSendFlow';
import AiMessageSuggestModal from '../components/AiMessageSuggestModal';
import AiPreviewModal from '../components/AiPreviewModal';
import AiSendTypeModal from '../components/AiSendTypeModal';
import AnalysisModal from '../components/AnalysisModal';
import BalanceModals from '../components/BalanceModals';
import CalendarModal from '../components/CalendarModal';
import DeltaBadge from '../components/dashboard/DeltaBadge';
import CardDetailModal, { type CardTargetFilterOutput } from '../components/dashboard/CardDetailModal';
import CampaignSuccessModal from '../components/CampaignSuccessModal';
import { LmsConvertModal, SmsConvertModal } from '../components/ChannelConvertModals';
import CustomerDBModal from '../components/CustomerDBModal';
import CustomerInsightModal from '../components/CustomerInsightModal';
import DashboardHeader from '../components/DashboardHeader';
import DirectPreviewModal from '../components/DirectPreviewModal';
import DirectTargetFilterModal, { type FieldMeta } from '../components/DirectTargetFilterModal';
import TargetSendModal from '../components/TargetSendModal';
import FileUploadMappingModal from '../components/FileUploadMappingModal';
import LineGroupErrorModal from '../components/LineGroupErrorModal';
import MmsUploadModal from '../components/MmsUploadModal';
import PlanApprovalModal from '../components/PlanApprovalModal';
import PlanLimitModal from '../components/PlanLimitModal';
import PlanUpgradeModal from '../components/PlanUpgradeModal';
import RecentCampaignModal from '../components/RecentCampaignModal';
import RecommendTemplateModal from '../components/RecommendTemplateModal';
import ResultsModal from '../components/ResultsModal';
import ScheduledCampaignModal from '../components/ScheduledCampaignModal';
import ScheduleTimeModal from '../components/ScheduleTimeModal';
import CallbackConfirmModal, { type CallbackConfirmData } from '../components/CallbackConfirmModal';
import NameEmptyWarningModal from '../components/NameEmptyWarningModal';
import SendConfirmModal from '../components/SendConfirmModal';
import SpamFilterLockModal from '../components/SpamFilterLockModal';
import SpamFilterTestModal from '../components/SpamFilterTestModal';
import SubscriptionLockModal from '../components/SubscriptionLockModal';
import SyncActiveBlockModal from '../components/SyncActiveBlockModal';
import TodayStatsModal from '../components/TodayStatsModal';
import UploadProgressModal from '../components/UploadProgressModal';
import UploadResultModal from '../components/UploadResultModal';
import { useAuthStore } from '../stores/authStore';
import { formatDate, formatPreviewValue, formatByType, calculateSmsBytes, truncateToSmsBytes, DIRECT_VAR_MAP, DIRECT_VAR_TO_FIELD, DIRECT_FIELD_LABELS, DIRECT_MAPPING_FIELDS, replaceDirectVars, formatPhoneNumber, mmsServerPathToUrl, resolveRecipientCallback, buildAdMessageFront, validateMmsBeforeSend } from '../utils/formatDate';
import { insertAtCursorOrAppend } from '../utils/textInsert';
import { getMmsImagePath, getMmsImageDisplayName, toMmsImagePaths, type MmsImageItem } from '../utils/mmsImage';
import DirectSendPanel from '../components/DirectSendPanel';

interface Stats {
  total: string;
  sms_opt_in_count: string;
  male_count: string;
  female_count: string;
  vip_count: string;
  unsubscribe_count: string;
  monthly_sent: number;
  success_rate: string;
  monthly_budget: number;
  monthly_cost: number;
  sms_sent: number;
  lms_sent: number;
  mms_sent: number;
  kakao_sent: number;
  cost_per_sms: number;
  cost_per_lms: number;
  cost_per_mms: number;
  cost_per_kakao: number;
  age_under20: string;
  age_20s: string;
  age_30s: string;
  age_40s: string;
  age_50s: string;
  age_60plus: string;
  use_db_sync: boolean;
  use_file_upload: boolean;
}

interface PlanInfo {
  plan_name: string;
  plan_code: string;
  monthly_price: number;
  subscription_status: string;
  max_customers: number;
  current_customers: number;
  trial_expires_at: string;
  is_trial_expired: boolean;
  ai_analysis_level?: string;
  // D53: 요금제별 기능 게이팅 플래그
  customer_db_enabled?: boolean;
  spam_filter_enabled?: boolean;
  ai_messaging_enabled?: boolean;
  ai_premium_enabled?: boolean;
}

// D41 대시보드 동적 카드 아이콘 맵
const CARD_ICON_MAP: Record<string, any> = {
  Users, User, Cake, Calendar, BarChart3, Award, MapPin, Store, Mail, DollarSign, ShoppingCart, UserX, UserPlus, BellOff, Bell, Send, CreditCard, HelpCircle, Percent,
};

// D41 카드 아이콘 액센트 색상 (카드 자체는 white 통일)
const CARD_COLORS = [
  { bg: 'bg-white', border: 'border-gray-100', text: 'text-gray-900', accent: 'text-emerald-600', iconBg: 'bg-emerald-50', barColor: 'bg-emerald-500' },
  { bg: 'bg-white', border: 'border-gray-100', text: 'text-gray-900', accent: 'text-blue-600', iconBg: 'bg-blue-50', barColor: 'bg-blue-500' },
  { bg: 'bg-white', border: 'border-gray-100', text: 'text-gray-900', accent: 'text-amber-600', iconBg: 'bg-amber-50', barColor: 'bg-amber-500' },
  { bg: 'bg-white', border: 'border-gray-100', text: 'text-gray-900', accent: 'text-violet-600', iconBg: 'bg-violet-50', barColor: 'bg-violet-500' },
  { bg: 'bg-white', border: 'border-gray-100', text: 'text-gray-900', accent: 'text-rose-600', iconBg: 'bg-rose-50', barColor: 'bg-rose-500' },
  { bg: 'bg-white', border: 'border-gray-100', text: 'text-gray-900', accent: 'text-cyan-600', iconBg: 'bg-cyan-50', barColor: 'bg-cyan-500' },
  { bg: 'bg-white', border: 'border-gray-100', text: 'text-gray-900', accent: 'text-orange-600', iconBg: 'bg-orange-50', barColor: 'bg-orange-500' },
  { bg: 'bg-white', border: 'border-gray-100', text: 'text-gray-900', accent: 'text-teal-600', iconBg: 'bg-teal-50', barColor: 'bg-teal-500' },
];

interface DashboardCardData {
  cardId: string;
  label: string;
  type: string;
  icon: string;
  value: number | { label: string; count: number }[];
  hasData: boolean;
  // ★ D132 Phase A: 델타 뱃지
  delta?: number | null;
  deltaPercent?: number | null;
  deltaBaseline?: string;
  hasTrend?: boolean;
}

interface DashboardCardsResponse {
  configured: boolean;
  cardCount: number;
  hasCustomerData?: boolean;
  cards: DashboardCardData[];
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  // 기능 제한 체크 헬퍼
  const isHidden = (feature: string) => (user as any)?.hiddenFeatures?.includes(feature);
  const hideAi = isHidden('ai_recommend');
  const hideFileUpload = isHidden('file_upload');

  // 요금제 잠금 체크
  const subscriptionStatus = (user as any)?.company?.subscriptionStatus || 'trial';
  const [showSubscriptionLock, setShowSubscriptionLock] = useState(false);
  const [showSpamFilterLock, setShowSpamFilterLock] = useState(false);
  const [showPlanApproval, setShowPlanApproval] = useState(false);
  const [planApproval, setPlanApproval] = useState<{requestId: string; planName: string} | null>(null);

  const [stats, setStats] = useState<Stats | null>(null);
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
  // ★ CT-17 (2026-04-22): subscription_status === expired/suspended 만 전체 잠금.
  //   FREE(미가입) 자체는 기본 발송/수신거부/발송결과 허용 → 전체 잠금 아님.
  //   각 기능(AI·자동발송·모바일DM)은 plans 플래그 기반 개별 잠금으로 처리.
  const isSubscriptionLocked = planInfo
    ? (planInfo.subscription_status === 'expired' || planInfo.subscription_status === 'suspended')
    : (subscriptionStatus === 'expired' || subscriptionStatus === 'suspended');
  // D53: DB 플래그 기반 게이팅 (하드코딩 가격 체크 제거)
  // ★ D88: 구독 만료 시에도 모든 기능 잠금
  const isSpamFilterLocked = !planInfo?.spam_filter_enabled || isSubscriptionLocked;
  const isCustomerDbLocked = !planInfo?.customer_db_enabled || isSubscriptionLocked;
  const isAiMessagingLocked = !planInfo?.ai_messaging_enabled || isSubscriptionLocked;
  const [balanceInfo, setBalanceInfo] = useState<{billingType: string, balance: number, costPerSms: number, costPerLms: number, costPerMms: number, costPerKakao: number} | null>(null);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [showChargeModal, setShowChargeModal] = useState(false);
  const [chargeStep, setChargeStep] = useState<'select' | 'deposit'>('select');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositorName, setDepositorName] = useState('');
  const [depositSubmitting, setDepositSubmitting] = useState(false);
  const [depositSuccess, setDepositSuccess] = useState(false);
  const [showInsufficientBalance, setShowInsufficientBalance] = useState<{show: boolean, balance: number, required: number} | null>(null);
  const [showLineGroupError, setShowLineGroupError] = useState(false);
  const [companyNameFromDB, setCompanyNameFromDB] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'target' | 'campaign' | 'send'>('target');
  const [showCalendar, setShowCalendar] = useState(false);
  const [aiCampaignPrompt, setAiCampaignPrompt] = useState('');
  const [showAiResult, setShowAiResult] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);
  const [aiStep, setAiStep] = useState(1);
  const [selectedChannel, setSelectedChannel] = useState('SMS');
  const [showLmsConfirm, setShowLmsConfirm] = useState(false);
  const [pendingBytes, setPendingBytes] = useState(0);
  const [smsOverrideAccepted, setSmsOverrideAccepted] = useState(false);
  const [lmsKeepAccepted, setLmsKeepAccepted] = useState(false);
  const [showSmsConvert, setShowSmsConvert] = useState<{show: boolean, from: 'direct' | 'target', currentBytes: number, smsBytes: number, count: number}>({show: false, from: 'direct', currentBytes: 0, smsBytes: 0, count: 0});
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitCount, setSplitCount] = useState<number>(1000);
  const [isAd, setIsAd] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successCampaignId, setSuccessCampaignId] = useState('');
  const [selectedMessage, setSelectedMessage] = useState<any>(null);
  const [selectedAiMsgIdx, setSelectedAiMsgIdx] = useState(0);
  const [editingAiMsg, setEditingAiMsg] = useState<number | null>(null);
  const [showAiSendModal, setShowAiSendModal] = useState(false);
  const [showAiSendType, setShowAiSendType] = useState(false);
  const [showAiCustomFlow, setShowAiCustomFlow] = useState(false);
  const [customSendData, setCustomSendData] = useState<any>(null);
  const [showCustomSendModal, setShowCustomSendModal] = useState(false);
  // 저장 세그먼트용
  const [customFlowPreload, setCustomFlowPreload] = useState<{selectedFields: string[]; briefing: string; url: string; channel: string; isAd: boolean} | null>(null);
  const [lastSendConfig, setLastSendConfig] = useState<{type: 'hanjullo' | 'custom'; prompt?: string; autoRelax?: boolean; selectedFields?: string[]; briefing?: string; url?: string; channel?: string; isAd?: boolean} | null>(null);
  const [showSpamFilter, setShowSpamFilter] = useState(false);
  const [spamFilterData, setSpamFilterData] = useState<{sms?: string; lms?: string; callback: string; msgType: 'SMS'|'LMS'|'MMS'; subject?: string; isAd?: boolean; firstRecipient?: Record<string, any>}>({callback:'',msgType:'SMS'});
  const [sampleCustomer, setSampleCustomer] = useState<Record<string, string>>({});
  // ★ D85: column 키 raw 데이터 — 백엔드 replaceVariables용 (담당자테스트/스팸테스트)
  const [sampleCustomerRaw, setSampleCustomerRaw] = useState<Record<string, any>>({});
  const [sendTimeOption, setSendTimeOption] = useState<'ai' | 'now' | 'custom'>('now');
  const [successSendInfo, setSuccessSendInfo] = useState<string>('');  // 성공 모달용 발송 정보
  const [successChannel, setSuccessChannel] = useState<string>('');  // ★ #8 수정: 성공모달 전용 채널
  const [successTargetCount, setSuccessTargetCount] = useState<number>(0);  // ★ #8 수정: 성공모달 전용 인원수
  const [successUnsubscribeCount, setSuccessUnsubscribeCount] = useState<number>(0);  // ★ B8-08 수정: 성공모달 전용 수신거부
  const [customSendTime, setCustomSendTime] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testCooldown, setTestCooldown] = useState(false);
  const [testSentResult, setTestSentResult] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [showCustomerDB, setShowCustomerDB] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  // D41 동적 카드 + D77 페이징 뷰 (6개씩)
  const [dashboardCards, setDashboardCards] = useState<DashboardCardsResponse | null>(null);
  const [dbCardPage, setDbCardPage] = useState(0); // 현재 페이지 (0-indexed)
  // 5개 카드 모달 state
  const [showRecentCampaigns, setShowRecentCampaigns] = useState(false);
  const [showFileUpload, setShowFileUpload] = useState(false);
  // v1.5.0: 싱크에이전트 사용 중 업로드/수정/삭제 차단 모달 (설계서 §4-4)
  const [showSyncActiveBlock, setShowSyncActiveBlock] = useState(false);
  const [syncBlockActive, setSyncBlockActive] = useState(false);
  const [showDirectTargeting, setShowDirectTargeting] = useState(false);
  // ★ D132 Phase B: 대시보드 카드 상세 모달
  const [detailCard, setDetailCard] = useState<DashboardCardData | null>(null);
  const [cardTargetFilters, setCardTargetFilters] = useState<CardTargetFilterOutput | undefined>(undefined);
  // 직접 타겟 관련 state → DirectTargetFilterModal로 이동 (D43-3)
  const [showTemplates, setShowTemplates] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showTodayStats, setShowTodayStats] = useState(false);
  const [showScheduled, setShowScheduled] = useState(false);
  // 모달용 데이터
  const [recentCampaigns, setRecentCampaigns] = useState<any[]>([]);
  const [scheduledCampaigns, setScheduledCampaigns] = useState<any[]>([]);
  const [selectedScheduled, setSelectedScheduled] = useState<any>(null);
  const [scheduledRecipients, setScheduledRecipients] = useState<any[]>([]);
  const [scheduledRecipientsTotal, setScheduledRecipientsTotal] = useState(0);
  const [scheduledSearch, setScheduledSearch] = useState('');
  const [scheduledLoading, setScheduledLoading] = useState(false);
  const [scheduledHasMore, setScheduledHasMore] = useState(false);
  const [editScheduleTime, setEditScheduleTime] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{show: boolean, phone: string, idx: number | null}>({show: false, phone: '', idx: null});
  const [cancelConfirm, setCancelConfirm] = useState<{show: boolean, campaign: any}>({show: false, campaign: null});
  const [messagePreview, setMessagePreview] = useState<{show: boolean, phone: string, message: string}>({show: false, phone: '', message: ''});
  const [messageEditModal, setMessageEditModal] = useState(false);
  const [editMessage, setEditMessage] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [messageEditProgress, setMessageEditProgress] = useState(0);
  const [messageEditing, setMessageEditing] = useState(false);
  // 파일 업로드 관련
  const [showUploadResult, setShowUploadResult] = useState(false);
  const [uploadResult, setUploadResult] = useState({ insertCount: 0, duplicateCount: 0 });
  const [showPlanLimitError, setShowPlanLimitError] = useState(false);
  const [planLimitInfo, setPlanLimitInfo] = useState<any>(null);
  const [uploadProgress, setUploadProgress] = useState<any>({ status: 'unknown', total: 0, processed: 0, percent: 0, insertCount: 0, duplicateCount: 0, errorCount: 0, message: '' });
  const [showUploadProgressModal, setShowUploadProgressModal] = useState(false);
  const uploadProgressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showDirectSend, setShowDirectSend] = useState(false);
  const [showTargetSend, setShowTargetSend] = useState(false);
  // ★ D43-3c: 타겟 필드 메타 (동적 변수/테이블용)
  const [targetFieldsMeta, setTargetFieldsMeta] = useState<FieldMeta[]>([]);
  const [phoneFields, setPhoneFields] = useState<string[]>([]);  // ★ D103: 전화번호 형태 필드
  // 직접타겟발송 관련 state
  const [targetSendChannel, setTargetSendChannel] = useState<'sms' | 'rcs' | 'kakao_alimtalk'>('sms');
  const [targetMsgType, setTargetMsgType] = useState<'SMS' | 'LMS' | 'MMS'>('SMS');
  const [targetSubject, setTargetSubject] = useState('');
  const [targetMessage, setTargetMessage] = useState('');
  const [targetRecipients, setTargetRecipients] = useState<any[]>([]);
  const [targetSending, setTargetSending] = useState(false);
  const [targetListPage, setTargetListPage] = useState(0);
  const [targetListSearch, setTargetListSearch] = useState('');
  const [showTargetPreview, setShowTargetPreview] = useState(false);
  // 직접발송 관련 state
  const [directSendChannel, setDirectSendChannel] = useState<'sms' | 'rcs' | 'kakao_alimtalk'>('sms');
  const [directMsgType, setDirectMsgType] = useState<'SMS' | 'LMS' | 'MMS'>('SMS');
  const [directSubject, setDirectSubject] = useState('');
  const [directMessage, setDirectMessage] = useState('');
  const [directRecipients, setDirectRecipients] = useState<any[]>([]);

  const [reserveEnabled, setReserveEnabled] = useState(false);
  const [reserveDateTime, setReserveDateTime] = useState('');
  const [showReservePicker, setShowReservePicker] = useState(false);
  // 카카오 관련 state
  const [kakaoMessage, setKakaoMessage] = useState('');
  const [kakaoTemplates, setKakaoTemplates] = useState<any[]>([]);
  const [kakaoSelectedTemplate, setKakaoSelectedTemplate] = useState<any>(null);
  const [kakaoTemplateVars, setKakaoTemplateVars] = useState<Record<string, string>>({});
  const [alimtalkFallback, setAlimtalkFallback] = useState<'N' | 'S' | 'L' | 'A' | 'B'>('L'); // 알림톡 실패 시 폴백: N=없음, S=SMS, L=LMS, A=SMS+대체문구, B=LMS+대체문구 (D130)
  // ★ D130 알림톡 전용 추가 state (SMS/RCS/LMS/MMS와 무관)
  const [alimtalkProfileId, setAlimtalkProfileId] = useState<string>('');
  const [alimtalkNextContents, setAlimtalkNextContents] = useState<string>('');
  const [alimtalkSenders, setAlimtalkSenders] = useState<any[]>([]);
  const kakaoEnabled = !!(user as any)?.company?.kakaoEnabled;
  // 카카오 템플릿 + 발신프로필 로드 (D130)
  const loadKakaoTemplates = async () => {
    try {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      // ★ D130: D94 호환 — kakao-templates status=approved 로드 + 신규 /api/alimtalk/senders 로드
      const [tplRes, sndRes] = await Promise.all([
        fetch('/api/companies/kakao-templates?status=approved', { headers }),
        fetch('/api/alimtalk/senders', { headers }).catch(() => null),
      ]);
      if (tplRes.ok) {
        const data = await tplRes.json();
        setKakaoTemplates(data.templates || []);
      }
      if (sndRes?.ok) {
        const data = await sndRes.json();
        // 승인된 발신프로필만 노출
        const approved = (data.profiles || []).filter(
          (p: any) => p.approval_status === 'APPROVED',
        );
        setAlimtalkSenders(approved);
      }
    } catch {}
  };
  // RCS 승인 템플릿 로드
  const [rcsTemplates, setRcsTemplates] = useState<any[]>([]);
  const [rcsSelectedTemplate, setRcsSelectedTemplate] = useState<any>(null);
  const loadRcsTemplates = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/companies/rcs-templates?status=approved', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setRcsTemplates(data.templates || []);
      }
    } catch {}
  };
  // AI 문구 추천 (직접타겟발송) — 버튼 클릭 핸들러
  const handleAiMsgHelper = () => {
    // D53: DB 플래그 기반 게이팅
    if (isAiMessagingLocked) {
      setShowPlanUpgradeModal(true);
      return;
    }
    setShowAiMsgHelper(true);
    setAiHelperPrompt('');
    setAiHelperResults([]);
    setAiHelperRecommendation('');
  };

  // AI 문구 추천 — 생성 요청
  const generateAiDirectMessage = async () => {
    if (!aiHelperPrompt.trim()) {
      setToast({ show: true, type: 'error', message: '어떤 메시지를 보낼지 입력해주세요.' });
      setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
      return;
    }
    setAiHelperLoading(true);
    setAiHelperResults([]);
    try {
      const res = await aiApi.generateMessage({
        prompt: aiHelperPrompt,
        channel: targetMsgType,
        isAd: adTextEnabled,
      });
      setAiHelperResults(res.data.variants || []);
      setAiHelperRecommendation(res.data.recommendation || '');
    } catch (error) {
      console.error('AI 문구 생성 오류:', error);
      setToast({ show: true, type: 'error', message: 'AI 문구 생성에 실패했습니다.' });
      setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
    } finally {
      setAiHelperLoading(false);
    }
  };

  // AI 문구 추천 — 결과 선택
  const selectAiMessage = (variant: any) => {
    const msg = variant.message_text || (targetMsgType === 'SMS' ? variant.sms_text : variant.lms_text) || '';
    setTargetMessage(msg);
    setShowAiMsgHelper(false);
    setToast({ show: true, type: 'success', message: 'AI 추천 문구가 적용되었습니다. 자유롭게 수정하세요!' });
    setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
  };

  // 직접발송 실행 함수
  const executeDirectSend = async (confirmCallbackExclusion?: boolean, confirmNameEmpty?: boolean) => {
    if (isSending || directSending) return; // 교차 중복 발송 방지
    // ★ B2(0417 PDF #2): MMS 이미지 첨부 검증 (과금 혼동 방지) — SMS 채널일 때만
    if (directSendChannel === 'sms') {
      const mmsErr = validateMmsBeforeSend(directMsgType, mmsUploadedImages.length);
      if (mmsErr) {
        setToast({ show: true, type: 'error', message: mmsErr });
        return;
      }
    }
    if (adTextEnabled && !optOutNumber) {
      setToast({ show: true, type: 'error', message: '광고 발송을 위해 수신거부번호(080) 설정이 필요합니다. 설정 > 발신번호 관리에서 등록해주세요.' });
      return;
    }
    // ★ D111 P2: %이름%/%고객명%/%성함% 변수가 있는데 이름 비어있는 수신자 경고
    if (!confirmNameEmpty) {
      const isAlimtalk = directSendChannel === 'kakao_alimtalk';
      const msgForCheck = isAlimtalk || directSendChannel === 'rcs' ? kakaoMessage : directMessage;
      const hasNameVar = /%(이름|고객명|성함)%/.test(msgForCheck || '');
      if (hasNameVar && directRecipients && directRecipients.length > 0) {
        const emptyCount = directRecipients.filter((r: any) => !r.name || String(r.name).trim() === '').length;
        if (emptyCount > 0) {
          // 발송 확인 모달을 닫고 이름 경고 모달 표시
          setSendConfirm({ show: false, type: 'immediate', count: 0, unsubscribeCount: 0 });
          setNameEmptyWarning({ show: true, emptyCount, totalCount: directRecipients.length, sendType: 'direct' });
          return;
        }
      }
    }
    setDirectSending(true);
    try {
      // 알림톡 버튼을 QTmsg k_button_json 형식으로 변환
      const convertButtonsToQTmsg = (buttons: any[]) => {
        if (!buttons || buttons.length === 0) return null;
        const obj: Record<string, string> = {};
        buttons.forEach((btn: any, i: number) => {
          const n = i + 1;
          obj[`name${n}`] = btn.name || '';
          // linkType → QTmsg type 코드: WL=2(웹링크), AL=3(앱링크), DS=1(배송조회), BK=4(봇키워드), MD=5(메시지전달), CA=6(채널추가)
          const typeMap: Record<string, string> = { WL: '2', AL: '3', DS: '1', BK: '4', MD: '5', CA: '6' };
          obj[`type${n}`] = typeMap[btn.linkType] || '2';
          obj[`url${n}_1`] = btn.linkM || btn.linkP || '';
          obj[`url${n}_2`] = btn.linkP || '';
        });
        return JSON.stringify(obj);
      };

      const isAlimtalk = directSendChannel === 'kakao_alimtalk';
      const sendBody = {
        msgType: directSendChannel === 'rcs' ? 'LMS' : isAlimtalk ? 'LMS' : directMsgType,
        sendChannel: directSendChannel === 'sms' ? 'sms' : directSendChannel === 'rcs' ? 'rcs' : 'alimtalk',
        subject: directSubject,
        message: isAlimtalk ? kakaoMessage : (directSendChannel === 'rcs' ? kakaoMessage : directMessage),  // ★ D103: 순수 본문만. (광고)+080은 백엔드 prepareSendMessage에서 추가
        callback: isAlimtalk ? (callbackNumbers[0]?.phone || '') : (useIndividualCallback ? null : selectedCallback),
        useIndividualCallback: isAlimtalk ? false : useIndividualCallback,
        individualCallbackColumn: (!isAlimtalk && useIndividualCallback) ? individualCallbackColumn : undefined,
        recipients: directRecipients.map((r: any) => ({ ...r, callback: r.callback || null })),
        adEnabled: isAlimtalk ? false : adTextEnabled,
        scheduled: reserveEnabled,
        scheduledAt: reserveEnabled && reserveDateTime ? new Date(reserveDateTime).toISOString() : null,
        splitEnabled: isAlimtalk ? false : splitEnabled,
        splitCount: isAlimtalk ? null : (splitEnabled ? splitCount : null),
        mmsImagePaths: isAlimtalk ? [] : toMmsImagePaths(mmsUploadedImages),
        ...(confirmCallbackExclusion ? { confirmCallbackExclusion: true } : {}),
        // ★ D102: 중복제거/수신거부제거 사용자 선택 전달
        dedupEnabled: sendConfirm.dedupEnabled ?? true,
        unsubFilterEnabled: sendConfirm.unsubFilterEnabled ?? true,
        // 알림톡 전용 파라미터 (D130: 설계서 §6-3-D 반영 — profileId + nextContents + variableMap)
        ...(isAlimtalk && kakaoSelectedTemplate ? {
          alimtalkProfileId: alimtalkProfileId || kakaoSelectedTemplate.profile_id || '',
          alimtalkTemplateCode: kakaoSelectedTemplate.template_code || '',
          alimtalkTemplateId: kakaoSelectedTemplate.id || '',
          alimtalkVariableMap: kakaoTemplateVars,
          alimtalkButtonJson: convertButtonsToQTmsg(kakaoSelectedTemplate.buttons) || null,
          alimtalkNextType: alimtalkFallback,
          alimtalkNextContents: (alimtalkFallback === 'A' || alimtalkFallback === 'B') ? alimtalkNextContents : '',
        } : {}),
      };
      const res = await fetch('/api/campaigns/direct-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(sendBody)
      });
      const data = await res.json();
      if (res.status === 402 && data.insufficientBalance) {
        setSendConfirm({show: false, type: 'immediate', count: 0, unsubscribeCount: 0});
        setShowInsufficientBalance({show: true, balance: data.balance, required: data.requiredAmount});
        setDirectSending(false);
        return;
      }
      if (data.code === 'LINE_GROUP_NOT_SET') {
        setSendConfirm({show: false, type: 'immediate', count: 0, unsubscribeCount: 0});
        setShowLineGroupError(true);
        setDirectSending(false);
        return;
      }
      // ★ 미등록 회신번호 확인 모달 — callbackConfirmRequired 응답 처리
      if (data.callbackConfirmRequired) {
        setSendConfirm({show: false, type: 'immediate', count: 0, unsubscribeCount: 0});
        setCallbackConfirm({
          show: true,
          callbackMissingCount: data.callbackMissingCount,
          callbackUnregisteredCount: data.callbackUnregisteredCount,
          unregisteredDetails: data.unregisteredDetails || [],
          remainingCount: data.remainingCount,
          message: data.message,
          sendType: 'direct',
        });
        setDirectSending(false);
        return;
      }
      if (data.success) {
        setToast({show: true, type: 'success', message: data.message});
        setTimeout(() => setToast({show: false, type: 'success', message: ''}), 3000);
        if (balanceInfo?.billingType === 'prepaid') {
          const balanceRes = await fetch('/api/balance', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
          if (balanceRes.ok) setBalanceInfo(await balanceRes.json());
        }
        // 모달 유지, 입력 필드만 초기화
        setDirectMessage('');
        setDirectSubject('');
        setDirectRecipients([]);
        setDirectMsgType('SMS');
        setKakaoMessage('');
        setMmsUploadedImages([]);  // ★ MMS 이미지 초기화
        setReserveEnabled(false);
        setReserveDateTime('');
        loadRecentCampaigns();
        loadScheduledCampaigns();
      } else {
        setToast({show: true, type: 'error', message: data.error});
        setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
      }
    } catch (err) {
      setToast({show: true, type: 'error', message: '발송 실패'});
      setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
    } finally {
      setDirectSending(false);
    }
    setSendConfirm({show: false, type: 'immediate', count: 0, unsubscribeCount: 0});
  };
  
  // 직접타겟추출 발송 함수
  const executeTargetSend = async (confirmCallbackExclusion?: boolean, confirmNameEmpty?: boolean) => {
    // ★ D131: MMS 이미지 첨부 검증 — 채널 조건 제거 (MMS msgType은 어떤 채널에서도 이미지 필수)
    const mmsErr = validateMmsBeforeSend(targetMsgType, mmsUploadedImages.length);
    if (mmsErr) {
      setToast({ show: true, type: 'error', message: mmsErr });
      return;
    }
    // ★ D111 P2: %이름%/%고객명%/%성함% 변수가 있는데 이름 비어있는 수신자 경고
    if (!confirmNameEmpty) {
      const msgForCheck = targetSendChannel === 'rcs' ? kakaoMessage : targetMessage;
      const hasNameVar = /%(이름|고객명|성함)%/.test(msgForCheck || '');
      if (hasNameVar && targetRecipients && targetRecipients.length > 0) {
        const emptyCount = targetRecipients.filter((r: any) => !r.name || String(r.name).trim() === '').length;
        if (emptyCount > 0) {
          setSendConfirm({ show: false, type: 'immediate', count: 0, unsubscribeCount: 0 });
          setNameEmptyWarning({ show: true, emptyCount, totalCount: targetRecipients.length, sendType: 'target' });
          return;
        }
      }
    }
    setTargetSending(true);
    try {
      const token = localStorage.getItem('token');
      // 변수 치환 처리
      const isRcs = targetSendChannel === 'rcs';
      const baseMsg = isRcs ? kakaoMessage : targetMessage;
      // ★ D102: 프론트 변수 치환 제거 — 백엔드 replaceVariables 컨트롤타워 하나로 통일
      // customMessages를 보내지 않으므로 백엔드에서 DB 고객 데이터 기반으로 치환 + 포맷팅
      const recipientsForSend = targetRecipients.map((r: any) => ({
        phone: r.phone,
        name: r.name || '',
        extra1: r.extra1 || '',
        extra2: r.extra2 || '',
        extra3: r.extra3 || '',
        callback: resolveRecipientCallback(r, useIndividualCallback, individualCallbackColumn),
      }));

      const isTargetAlimtalk = targetSendChannel === 'kakao_alimtalk';
      const targetConvertButtons = (buttons: any[]) => {
        if (!buttons || buttons.length === 0) return null;
        const obj: Record<string, string> = {};
        buttons.forEach((btn: any, i: number) => {
          const n = i + 1;
          obj[`name${n}`] = btn.name || '';
          const typeMap: Record<string, string> = { WL: '2', AL: '3', DS: '1', BK: '4', MD: '5', CA: '6' };
          obj[`type${n}`] = typeMap[btn.linkType] || '2';
          obj[`url${n}_1`] = btn.linkM || btn.linkP || '';
          obj[`url${n}_2`] = btn.linkP || '';
        });
        return JSON.stringify(obj);
      };
      const res = await fetch('/api/campaigns/direct-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          msgType: targetSendChannel === 'rcs' ? 'LMS' : isTargetAlimtalk ? 'LMS' : targetMsgType,
          // ★ D130: 알림톡 매핑 버그 수정 — 'kakao' → 'alimtalk' (백엔드 directChannel === 'alimtalk' 체크와 정합)
          sendChannel: targetSendChannel === 'sms' ? 'sms' : targetSendChannel === 'rcs' ? 'rcs' : 'alimtalk',
          subject: targetSubject,
          message: isTargetAlimtalk ? (kakaoSelectedTemplate?.content || '') : targetSendChannel === 'rcs' ? kakaoMessage : targetMessage,
          callback: isTargetAlimtalk ? (callbackNumbers[0]?.phone || '') : (useIndividualCallback ? null : selectedCallback),
          useIndividualCallback: isTargetAlimtalk ? false : useIndividualCallback,
          individualCallbackColumn: (!isTargetAlimtalk && useIndividualCallback) ? individualCallbackColumn : undefined,
          recipients: recipientsForSend,
          adEnabled: isTargetAlimtalk ? false : adTextEnabled,
          scheduled: reserveEnabled,
          scheduledAt: reserveEnabled && reserveDateTime ? new Date(reserveDateTime).toISOString() : null,
          splitEnabled: isTargetAlimtalk ? false : splitEnabled,
          splitCount: isTargetAlimtalk ? null : (splitEnabled ? splitCount : null),
          mmsImagePaths: isTargetAlimtalk ? [] : toMmsImagePaths(mmsUploadedImages),
          ...(confirmCallbackExclusion ? { confirmCallbackExclusion: true } : {}),
          // ★ D102: 중복제거/수신거부제거 사용자 선택 전달
          dedupEnabled: sendConfirm.dedupEnabled ?? true,
          unsubFilterEnabled: sendConfirm.unsubFilterEnabled ?? true,
          // ★ D130 알림톡 전용 파라미터 (설계서 §6-3-D)
          ...(isTargetAlimtalk && kakaoSelectedTemplate ? {
            alimtalkProfileId: alimtalkProfileId || kakaoSelectedTemplate.profile_id || '',
            alimtalkTemplateCode: kakaoSelectedTemplate.template_code || '',
            alimtalkTemplateId: kakaoSelectedTemplate.id || '',
            alimtalkVariableMap: kakaoTemplateVars,
            alimtalkButtonJson: targetConvertButtons(kakaoSelectedTemplate.buttons) || null,
            alimtalkNextType: alimtalkFallback,
            alimtalkNextContents: (alimtalkFallback === 'A' || alimtalkFallback === 'B') ? alimtalkNextContents : '',
          } : {}),
        })
      });
      const data = await res.json();
      if (res.status === 402 && data.insufficientBalance) {
        setSendConfirm({show: false, type: 'immediate', count: 0, unsubscribeCount: 0});
        setShowInsufficientBalance({show: true, balance: data.balance, required: data.requiredAmount});
        setTargetSending(false);
        return;
      }
      if (data.code === 'LINE_GROUP_NOT_SET') {
        setSendConfirm({show: false, type: 'immediate', count: 0, unsubscribeCount: 0});
        setShowLineGroupError(true);
        setTargetSending(false);
        return;
      }
      // ★ 미등록 회신번호 확인 모달 — callbackConfirmRequired 응답 처리
      if (data.callbackConfirmRequired) {
        setSendConfirm({show: false, type: 'immediate', count: 0, unsubscribeCount: 0});
        setCallbackConfirm({
          show: true,
          callbackMissingCount: data.callbackMissingCount,
          callbackUnregisteredCount: data.callbackUnregisteredCount,
          unregisteredDetails: data.unregisteredDetails || [],
          remainingCount: data.remainingCount,
          message: data.message,
          sendType: 'target',
        });
        setTargetSending(false);
        return;
      }
      if (data.success) {
        setToast({show: true, type: 'success', message: data.message});
        setTimeout(() => setToast({show: false, type: 'success', message: ''}), 3000);
        if (balanceInfo?.billingType === 'prepaid') {
          const balanceRes = await fetch('/api/balance', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
          if (balanceRes.ok) setBalanceInfo(await balanceRes.json());
        }
        setShowTargetSend(false);
        setTargetRecipients([]);
        setTargetMessage('');
        setTargetSubject('');
        setKakaoMessage('');
        setMmsUploadedImages([]);  // ★ MMS 이미지 초기화
        loadRecentCampaigns();
        loadScheduledCampaigns();
      } else {
        setToast({show: true, type: 'error', message: data.error});
        setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
      }
    } catch (err) {
      setToast({show: true, type: 'error', message: '발송 실패'});
      setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
    } finally {
      setTargetSending(false);
    }
    setSendConfirm({show: false, type: 'immediate', count: 0, unsubscribeCount: 0});
  };
  
  // ★ 미등록 회신번호 확인 모달 — "제외하고 발송" 핸들러
  const handleCallbackConfirmSend = async () => {
    // ★ D100: 이중 호출 방지 — isSending 체크로 더블클릭 차단
    if (isSending || directSending || targetSending) return;
    const sendType = callbackConfirm.sendType;
    setCallbackConfirm(defaultCallbackConfirm);

    if (sendType === 'direct') {
      // 직접발송 재호출 (confirmCallbackExclusion=true)
      await executeDirectSend(true);
    } else if (sendType === 'target') {
      // 타겟추출 발송 재호출
      await executeTargetSend(true);
    } else if ((sendType === 'ai' || sendType === 'aiCustom') && pendingAiCampaignId) {
      // AI 캠페인 재발송 (confirmCallbackExclusion=true)
      try {
        setIsSending(true);
        await campaignsApi.send(pendingAiCampaignId, { confirmCallbackExclusion: true });
        setPendingAiCampaignId(null);

        // 성공 후 UI 초기화
        setShowPreview(false);
        setShowAiResult(false);
        setShowAiSendModal(false);
        setShowCustomSendModal(false);
        setShowAiCustomFlow(false);
        setAiStep(1);
        setAiCampaignPrompt('');
        setAiResult(null);
        setSelectedAiMsgIdx(0);
        setCustomSendData(null);

        setToast({ show: true, type: 'success', message: '발송이 시작되었습니다.' });
        setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
        loadRecentCampaigns();
        loadScheduledCampaigns();
      } catch (error: any) {
        console.error('미등록 회신번호 확인 후 발송 실패:', error);
        setToast({ show: true, type: 'error', message: error.response?.data?.error || '발송에 실패했습니다.' });
      } finally {
        setIsSending(false);
      }
    }
  };

  // MMS 이미지 (서버 업로드 방식)
  // ★ D124 N4: originalName 필드 추가 — 업로드한 원본 파일명 표시용 (DB mms_image_paths 객체 배열 전송에도 사용)
  const [mmsUploadedImages, setMmsUploadedImages] = useState<{serverPath: string; url: string; filename: string; originalName?: string; size: number}[]>([]);
  const [mmsUploading, setMmsUploading] = useState(false);
  const [showMmsUploadModal, setShowMmsUploadModal] = useState(false);

  // MMS 이미지 단일 슬롯 업로드 함수
  const handleMmsSlotUpload = async (file: File, slotIndex: number) => {
    // 검증: JPG만
    if (!file.name.toLowerCase().endsWith('.jpg') && !file.name.toLowerCase().endsWith('.jpeg')) {
      setToast({ show: true, type: 'error', message: 'JPG 파일만 업로드 가능합니다 (PNG/GIF 미지원)' });
      setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
      return;
    }
    // 검증: 300KB
    if (file.size > 300 * 1024) {
      setToast({ show: true, type: 'error', message: `${(file.size / 1024).toFixed(0)}KB — 300KB 이하만 가능합니다` });
      setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
      return;
    }

    setMmsUploading(true);
    try {
      const formData = new FormData();
      formData.append('images', file);
      const token = localStorage.getItem('token');
      const res = await fetch('/api/mms-images/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.success && data.images.length > 0) {
        setMmsUploadedImages(prev => {
          const updated = [...prev];
          updated[slotIndex] = data.images[0];
          return updated;
        });
      } else {
        setToast({ show: true, type: 'error', message: data.error || '업로드 실패' });
        setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
      }
    } catch {
      setToast({ show: true, type: 'error', message: '이미지 업로드 중 오류 발생' });
      setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
    } finally {
      setMmsUploading(false);
    }
  };

  // MMS 이미지 서버 업로드 함수 → 모달 오픈으로 변경
  const handleMmsImageUpload = (files: FileList | null, sendType: 'ai' | 'target' | 'direct') => {
    setShowMmsUploadModal(true);
  };

  // MMS 이미지 다중 선택 한번에 첨부 (#14)
  const handleMmsMultiUpload = async (files: FileList) => {
    const maxSlots = 3;
    const currentCount = mmsUploadedImages.length;
    const available = maxSlots - currentCount;
    if (available <= 0) {
      setToast({ show: true, type: 'error', message: '최대 3장까지 첨부 가능합니다' });
      setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
      return;
    }
    const filesToUpload = Array.from(files).slice(0, available);
    // 검증
    for (const file of filesToUpload) {
      if (!file.name.toLowerCase().endsWith('.jpg') && !file.name.toLowerCase().endsWith('.jpeg')) {
        setToast({ show: true, type: 'error', message: `${file.name}: JPG 파일만 업로드 가능합니다` });
        setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
        return;
      }
      if (file.size > 300 * 1024) {
        setToast({ show: true, type: 'error', message: `${file.name}: ${(file.size / 1024).toFixed(0)}KB — 300KB 이하만 가능합니다` });
        setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
        return;
      }
    }
    setMmsUploading(true);
    try {
      for (const file of filesToUpload) {
        const formData = new FormData();
        formData.append('images', file);
        const token = localStorage.getItem('token');
        const res = await fetch('/api/mms-images/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        const data = await res.json();
        if (res.ok && data.success && data.images.length > 0) {
          setMmsUploadedImages(prev => [...prev, data.images[0]]);
        }
      }
    } catch {
      setToast({ show: true, type: 'error', message: '이미지 업로드 중 오류 발생' });
      setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
    } finally {
      setMmsUploading(false);
    }
  };

  // MMS 이미지 삭제 함수 (슬롯 기반)
  const handleMmsImageRemove = async (index: number) => {
    const img = mmsUploadedImages[index];
    if (img) {
      try {
        const token = localStorage.getItem('token');
        await fetch(img.url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      } catch { /* 서버 삭제 실패해도 UI에서는 제거 */ }
    }
    setMmsUploadedImages(prev => prev.filter((_, i) => i !== index));
  };
  const [directInputMode, setDirectInputMode] = useState<'file' | 'direct' | 'address'>('file');
  const [showAddressBook, setShowAddressBook] = useState(false);
  const [addressGroups, setAddressGroups] = useState<{group_name: string, count: number}[]>([]);
  const [addressSaveMode, setAddressSaveMode] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [addressFileHeaders, setAddressFileHeaders] = useState<string[]>([]);
  const [addressFileData, setAddressFileData] = useState<any[]>([]);
  const [addressColumnMapping, setAddressColumnMapping] = useState<{[key: string]: string}>({});
  const [addressViewGroup, setAddressViewGroup] = useState<string | null>(null);
  const [addressViewContacts, setAddressViewContacts] = useState<any[]>([]);
  const [addressViewSearch, setAddressViewSearch] = useState('');
  const [addressPage, setAddressPage] = useState(0);
  // ★ D96: directFile* state → DirectSendPanel로 이동
  const [directSending, setDirectSending] = useState(false);
  // ★ D96: directShowMapping → DirectSendPanel로 이동
  // AI 문구 추천 (직접발송)
  const [showAiMsgHelper, setShowAiMsgHelper] = useState(false);
  const [aiHelperPrompt, setAiHelperPrompt] = useState('');
  const [aiHelperLoading, setAiHelperLoading] = useState(false);
  const [aiHelperResults, setAiHelperResults] = useState<any[]>([]);
  const [aiHelperRecommendation, setAiHelperRecommendation] = useState('');
  const [showPlanUpgradeModal, setShowPlanUpgradeModal] = useState(false);
  // D53: 범용 업그레이드 모달 — featureName/requiredPlan
  const [planUpgradeFeature, setPlanUpgradeFeature] = useState('');
  const [planUpgradeRequired, setPlanUpgradeRequired] = useState('');
  // ★ D96: showDirectInput → DirectSendPanel로 이동
  const [showSpecialChars, setShowSpecialChars] = useState<'target' | 'direct' | null>(null);
  const [showTemplateBox, setShowTemplateBox] = useState<'target' | 'direct' | null>(null);
  const [templateList, setTemplateList] = useState<any[]>([]);
  const [showTemplateSave, setShowTemplateSave] = useState<'target' | 'direct' | null>(null);
  const [templateSaveName, setTemplateSaveName] = useState('');
  // ★ D96: directInputText → DirectSendPanel로 이동
  const [callbackNumbers, setCallbackNumbers] = useState<{id: string, phone: string, label: string, is_default: boolean}[]>([]);
  const [selectedCallback, setSelectedCallback] = useState('');
  const [useIndividualCallback, setUseIndividualCallback] = useState(false);
  const [individualCallbackColumn, setIndividualCallbackColumn] = useState('');
  const [sendConfirm, setSendConfirm] = useState<{show: boolean, type: 'immediate' | 'scheduled', count: number, unsubscribeCount: number, dateTime?: string, from?: 'direct' | 'target', msgType?: string, dedupEnabled?: boolean, unsubFilterEnabled?: boolean}>({show: false, type: 'immediate', count: 0, unsubscribeCount: 0});

  // ★ 미등록 회신번호 확인 모달 state
  const defaultCallbackConfirm: CallbackConfirmData = { show: false, callbackMissingCount: 0, callbackUnregisteredCount: 0, unregisteredDetails: [], remainingCount: 0, message: '', sendType: 'direct' };
  const [callbackConfirm, setCallbackConfirm] = useState<CallbackConfirmData>(defaultCallbackConfirm);
  // 확인 모달에서 "제외하고 발송" 클릭 시 사용할 보관 데이터 (AI 캠페인용)
  const [pendingAiCampaignId, setPendingAiCampaignId] = useState<string | null>(null);
  // 직접발송 확인 모달용 원본 요청 body 보관
  const [pendingDirectSendBody, setPendingDirectSendBody] = useState<any>(null);

  // ★ D111 P2: 이름 비어있는 수신자 경고 모달 state
  const [nameEmptyWarning, setNameEmptyWarning] = useState<{
    show: boolean;
    emptyCount: number;
    totalCount: number;
    sendType: 'direct' | 'target';
  }>({ show: false, emptyCount: 0, totalCount: 0, sendType: 'direct' });

  // 전화번호 포맷팅 함수
  // ★ D97: formatPhoneNumber → formatDate.ts 컨트롤타워로 이관 (인라인 삭제)
  // ★ D96: selectedRecipients → DirectSendPanel로 이동
  const [showDirectPreview, setShowDirectPreview] = useState(false);
  const [adTextEnabled, setAdTextEnabled] = useState(true);

  // #9 광고 토글 OFF → 메시지 내 (광고) 접두사/무료거부 라인 자동 제거
  const handleAdToggle = (enabled: boolean) => {
    setAdTextEnabled(enabled);
    if (!enabled) {
      const stripAd = (msg: string) => msg.replace(/^\(광고\)\s*/g, '').replace(/\n무료거부\d+$/g, '').replace(/\n무료수신거부\s*[\d\-]+$/g, '').trim();
      setTargetMessage(prev => stripAd(prev));
      setDirectMessage(prev => stripAd(prev));
    }
  };
  const [toast, setToast] = useState<{show: boolean, type: 'success' | 'error' | 'warning', message: string}>({show: false, type: 'success', message: ''});

  // ★ B17-15: Toast 자동 해제 — show=true 될 때마다 4초 후 자동 닫힘
  useEffect(() => {
    if (!toast.show) return;
    const timer = setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 4000);
    return () => clearTimeout(timer);
  }, [toast.show, toast.message]);

  // B13-06: 이모지 감지 함수
  const hasEmoji = (text: string): boolean => {
    const emojiPattern = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]|[\u2300-\u23FF]|[\u2B50-\u2BFF]|[\uFE00-\uFE0F]|[\u200D]|[\u20E3]|[\uE000-\uF8FF]/g;
    return emojiPattern.test(text);
  };

  const [optOutNumber, setOptOutNumber] = useState('');

  // v1.5.0: 파일 업로드 오픈 전 싱크 차단 체크 (설계서 §4-4)
  const openFileUpload = () => {
    if (syncBlockActive) {
      setShowSyncActiveBlock(true);
      return;
    }
    if (isSubscriptionLocked) {
      setShowSubscriptionLock(true);
      return;
    }
    setShowFileUpload(true);
  };

  // 업로드 저장 시작 → 프로그레스 모달 표시 + 폴링
  const handleUploadSaveStart = (savedFileId: string, totalRows: number) => {
    setShowFileUpload(false);
    setShowUploadProgressModal(true);
    setUploadProgress({ status: 'processing', total: totalRows, processed: 0, percent: 0, insertCount: 0, duplicateCount: 0, errorCount: 0, message: '처리 시작...' });
    if (uploadProgressIntervalRef.current) clearInterval(uploadProgressIntervalRef.current);
    uploadProgressIntervalRef.current = setInterval(async () => {
      try {
        const pRes = await fetch(`/api/upload/progress/${savedFileId}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const pData = await pRes.json();
        setUploadProgress(pData);
        if (pData.status === 'completed' || pData.status === 'failed') {
          if (uploadProgressIntervalRef.current) clearInterval(uploadProgressIntervalRef.current);
          uploadProgressIntervalRef.current = null;
        }
      } catch (e) { /* ignore */ }
    }, 2000);
  };

  const handleUploadPlanLimit = (data: any) => {
    setPlanLimitInfo(data);
    setShowPlanLimitError(true);
  };

  // 타겟 필터
  const [filter, setFilter] = useState({
    gender: '',
    minAge: '',
    maxAge: '',
    grade: '',
    smsOptIn: true,
  });

  // 타겟 결과
  const [targetResult, setTargetResult] = useState<any>(null);

  // 캠페인 설정
  const [campaign, setCampaign] = useState({
    campaignName: '',
    messageType: 'SMS',
    messageContent: '',
    isAd: false,
  });

  // AI 관련 상태
  const [aiLoading, setAiLoading] = useState(false);
  const [showPromptAlert, setShowPromptAlert] = useState(false);
  const [aiObjective, setAiObjective] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiMessages, setAiMessages] = useState<any[]>([]);
  const [showAiTarget, setShowAiTarget] = useState(false);
  const [showAiMessage, setShowAiMessage] = useState(false);
  const [campaignContext, setCampaignContext] = useState(''); // 타겟→메시지 연결용

  useEffect(() => {
    loadStats();
    loadRecentCampaigns();
    loadScheduledCampaigns();
    loadCompanySettings();
  }, []);

  // 업로드 프로그레스 폴링 cleanup (컴포넌트 언마운트 시 interval 정리)
  useEffect(() => {
    return () => {
      if (uploadProgressIntervalRef.current) {
        clearInterval(uploadProgressIntervalRef.current);
        uploadProgressIntervalRef.current = null;
      }
    };
  }, []);

// 자동입력 변수를 수신자 중 가장 긴 값으로 치환하여 최대 바이트 메시지 생성
const getMaxByteMessage = (msg: string, recipients: any[], variableMap: Record<string, string>) => {
  let result = msg;
  // variableMap: { '%이름%': 'name', '%등급%': 'grade', ... }
  Object.entries(variableMap).forEach(([variable, field]) => {
    if (!result.includes(variable)) return;
    // 수신자 중 해당 필드의 가장 긴 값 찾기
    let maxValue = '';
    recipients.forEach((r: any) => {
      const val = String(r[field] || '');
      if (val.length > maxValue.length) maxValue = val;
    });
    // 수신자가 없거나 값이 없으면 기본 최대값 사용
    if (!maxValue) {
      const defaults: Record<string, string> = {
        '%이름%': '홍길동어머니', '%등급%': 'VVIP', '%지역%': '경기도 성남시',
        '%매장명%': '서울특별시 강남본점', '%포인트%': '9,999,999',
        '%구매금액%': '99,999,999원', '%기타1%': '가나다라마바사', '%기타2%': '가나다라마바사', '%기타3%': '가나다라마바사',
        '%회신번호%': '07012345678',
      };
      maxValue = defaults[variable] || '가나다라마바';
    }
    result = result.replace(new RegExp(variable.replace(/%/g, '%'), 'g'), maxValue);
  });
  return result;
};
  // 바이트 초과 시 자동 LMS 전환 (SMS→LMS만, LMS→SMS 복귀는 수동)
  useEffect(() => {
    // 메시지 변경 시 오버라이드 리셋
    setSmsOverrideAccepted(false);
    // ★ D96: 컨트롤타워(DIRECT_VAR_TO_FIELD) 사용
    let fullMsg = getMaxByteMessage(directMessage, directRecipients, DIRECT_VAR_TO_FIELD);
    fullMsg = buildAdMessageFront(fullMsg, directMsgType, adTextEnabled, optOutNumber);
    // ★ D95: 컨트롤타워 사용
    const bytes = calculateSmsBytes(fullMsg);
    // SMS에서 90바이트 초과 시 LMS 전환 확인 모달
    if (directMsgType === 'SMS' && bytes > 90 && !showLmsConfirm) {
      setPendingBytes(bytes);
      setShowLmsConfirm(true);
    }
  }, [directMessage, directMsgType, adTextEnabled, optOutNumber, directRecipients]);

  // 타겟발송 메시지 실시간 바이트 체크
  useEffect(() => {
    if (!showTargetSend || targetSendChannel !== 'sms') return;
    setSmsOverrideAccepted(false);
    // ★ D43-3c: 동적 변수맵 (하드코딩 제거)
    const targetVarMap: Record<string, string> = {};
    targetFieldsMeta.forEach(fm => {
      if (fm.field_key !== 'phone' && fm.field_key !== 'sms_opt_in') {
        targetVarMap[fm.variable] = fm.field_key;
      }
    });
    let fullMsg = getMaxByteMessage(targetMessage, targetRecipients, targetVarMap);
    fullMsg = buildAdMessageFront(fullMsg, targetMsgType, adTextEnabled, optOutNumber);
    // ★ D95: 컨트롤타워 사용
    const bytes = calculateSmsBytes(fullMsg);
    if (targetMsgType === 'SMS' && bytes > 90 && !showLmsConfirm) {
      setPendingBytes(bytes);
      setShowLmsConfirm(true);
    }
  }, [targetMessage, targetMsgType, adTextEnabled, optOutNumber, showTargetSend, targetRecipients, targetSendChannel, targetFieldsMeta]);

  const loadStats = async () => {
    try {
      const response = await customersApi.stats();
      setStats(response.data.stats);
      
      // 플랜 정보 조회
      const token = localStorage.getItem('token');
      const planRes = await fetch('/api/companies/my-plan', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (planRes.ok) {
        const planData = await planRes.json();
        setPlanInfo(planData);
      }

      // 잔액 정보 조회
      const balanceRes = await fetch('/api/balance', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (balanceRes.ok) {
        const balanceData = await balanceRes.json();
        setBalanceInfo(balanceData);
      }

      // D41 대시보드 동적 카드 조회
      try {
        const cardsRes = await fetch('/api/companies/dashboard-cards', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cardsRes.ok) {
          const cardsData = await cardsRes.json();
          setDashboardCards(cardsData);
        }
      } catch {}

      // 요금제 승인 알림 체크
      const approvalRes = await fetch('/api/companies/plan-request/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (approvalRes.ok) {
        const approvalData = await approvalRes.json();
        if (approvalData.unconfirmed?.status === 'approved') {
          setPlanApproval({ requestId: approvalData.unconfirmed.id, planName: approvalData.unconfirmed.requested_plan_name });
          setShowPlanApproval(true);
        }
      }
    } catch (error) {
      console.error('통계 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  };
  // 최근 캠페인 로드
  const loadRecentCampaigns = async () => {
    try {
      const token = localStorage.getItem('token');
      // ★ B8-13: sync-results를 fire-and-forget으로 변경 (대량 캠페인 시 대시보드 로딩 지연 방지)
      fetch('/api/campaigns/sync-results', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      }).catch(() => {});
      const res = await fetch('/api/campaigns?limit=10', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const campaigns = (data.campaigns || []).filter((c: any) => c.status !== 'draft');
      setRecentCampaigns(campaigns.slice(0, 5));
    } catch (error) {
      console.error('최근 캠페인 로드 실패:', error);
    }
  };

  // 예약 대기 캠페인 로드 — scheduled + draft(scheduled_at 있는) 캠페인 모두 포함
  const loadScheduledCampaigns = async () => {
    try {
      const token = localStorage.getItem('token');
      const [scheduledRes, draftRes] = await Promise.all([
        fetch('/api/campaigns?status=scheduled', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/campaigns?status=draft', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const scheduledData = await scheduledRes.json();
      const draftData = await draftRes.json();
      // scheduled: 전부 포함 / draft: scheduled_at이 있는 것만 포함
      const scheduled = scheduledData.campaigns || [];
      const draftWithSchedule = (draftData.campaigns || []).filter((c: any) => c.scheduled_at);
      setScheduledCampaigns([...scheduled, ...draftWithSchedule]);
    } catch (error) {
      console.error('예약 캠페인 로드 실패:', error);
    }
  };

  // ★ 회사 설정 로드 (080 수신거부번호 + 회신번호) — 초기 로드
  const loadCompanySettings = async () => {
    try {
      const token = localStorage.getItem('token');
      const settingsRes = await fetch('/api/companies/settings', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        if (settingsData.reject_number) {
          setOptOutNumber(settingsData.reject_number);
        }
        if (settingsData.company_name) {
          setCompanyNameFromDB(settingsData.company_name);
        }
        // v1.5.0: 싱크 차단 플래그 수신
        setSyncBlockActive(!!settingsData.sync_block_active);
      }
      const cbRes = await fetch('/api/companies/callback-numbers', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const cbData = await cbRes.json();
      if (cbData.success) {
        setCallbackNumbers(cbData.numbers || []);
        const defaultCb = cbData.numbers?.find((n: any) => n.is_default);
        if (defaultCb) setSelectedCallback(defaultCb.phone);
      }
      // ★ D103: 전화번호 형태 필드 로드 (개별회신번호 드롭다운용)
      try {
        const fieldsRes = await fetch('/api/customers/enabled-fields', { headers: { Authorization: `Bearer ${token}` } });
        if (fieldsRes.ok) {
          const fieldsData = await fieldsRes.json();
          if (fieldsData.phoneFields) setPhoneFields(fieldsData.phoneFields);
        }
      } catch (e) { /* 실패 시 빈 배열 유지 */ }
      // ★ D94: 알림톡/RCS 승인 템플릿 로드
      loadKakaoTemplates();
      loadRcsTemplates();
    } catch (err) {
      console.error('회사 설정 로드 실패:', err);
    }
  };

  // (D43-3) loadTargetSchema → 사용처 없음, 삭제됨
  // (D43-3) loadEnabledFields, buildDynamicFiltersForAPI, loadTargetCount, handleTargetExtract, resetTargetFilters → DirectTargetFilterModal로 이동

  // SMS 템플릿 로드
  const loadTemplates = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/sms-templates', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) setTemplateList(data.templates || []);
    } catch (error) {
      console.error('템플릿 로드 실패:', error);
    }
  };

  // SMS 템플릿 저장
  // ★ D124 N4: mmsImagePaths는 객체 배열({path, originalName}) 또는 문자열 배열 혼재 허용
  // ★ B1(0417 PDF #1): isAd 전달 — 저장 시점의 광고 체크박스 상태를 DB에 왕복
  const saveTemplate = async (name: string, content: string, msgType: string, subject: string, mmsImagePaths?: MmsImageItem[], isAd?: boolean) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/sms-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ templateName: name, messageType: msgType, subject: subject || null, content, mmsImagePaths: mmsImagePaths || null, isAd: typeof isAd === 'boolean' ? isAd : adTextEnabled })
      });
      const data = await res.json();
      if (data.success) {
        setToast({ show: true, type: 'success', message: '문자가 보관함에 저장되었습니다.' });
        setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
        return true;
      } else {
        setToast({ show: true, type: 'error', message: data.error || '저장 실패' });
        setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
        return false;
      }
    } catch (error) {
      setToast({ show: true, type: 'error', message: '저장 중 오류 발생' });
      setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
      return false;
    }
  };

  // SMS 템플릿 삭제
  const deleteTemplate = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/sms-templates/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setTemplateList(prev => prev.filter(t => t.id !== id));
        setToast({ show: true, type: 'success', message: '삭제되었습니다.' });
        setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
      }
    } catch (error) {
      console.error('템플릿 삭제 실패:', error);
    }
  };

  // 직접 타겟 추출 완료 콜백 (DirectTargetFilterModal → Dashboard)
  // ★ D43-3c: fieldsMeta 파라미터 추가, B16-07: selectedCallbackPhone 추가
  const handleTargetExtracted = async (recipients: any[], count: number, fieldsMeta: FieldMeta[], selectedCallbackPhone?: string, extractedPhoneFields?: string[]) => {
    try {
      const token = localStorage.getItem('token');
      // 080 수신거부번호 로드
      const settingsRes = await fetch('/api/companies/settings', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        if (settingsData.reject_number) {
          setOptOutNumber(settingsData.reject_number);
        }
      }
      // 회신번호 로드
      const cbRes = await fetch('/api/companies/callback-numbers', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const cbData = await cbRes.json();
      if (cbData.success) {
        setCallbackNumbers(cbData.numbers || []);
        // ★ B16-07: 직접타겟에서 선택한 회신번호 우선 적용
        if (selectedCallbackPhone === '__individual__') {
          setUseIndividualCallback(true);
          setSelectedCallback('');
        } else if (selectedCallbackPhone) {
          setUseIndividualCallback(false);
          setSelectedCallback(selectedCallbackPhone);
        } else {
          setUseIndividualCallback(false);
          const defaultCb = cbData.numbers?.find((n: any) => n.is_default);
          if (defaultCb) setSelectedCallback(defaultCb.phone);
        }
      }
    } catch (err) {
      console.error('설정 로드 실패:', err);
    }

    // ★ D43-3c: 수신자 원본 저장 + 필드 메타 저장 (하드코딩 매핑 제거)
    // ★ B-D75-03: custom_fields flat 처리는 백엔드 extract API에서 수행 (컨트롤타워 원칙)
    setTargetRecipients(recipients);
    setTargetFieldsMeta(fieldsMeta);
    if (extractedPhoneFields) setPhoneFields(extractedPhoneFields);
    // ★ D100: 직접타겟 추출 시 첫 번째 수신자를 샘플로 설정 (담당자테스트용)
    //   이전: AI 추천에서만 setSampleCustomerRaw → 직접타겟 담당자테스트에 이전 AI 샘플 잔류
    if (recipients.length > 0) {
      setSampleCustomerRaw(recipients[0]);
    }
    setShowDirectTargeting(false);
    setShowTargetSend(true);
    setToast({ show: true, type: 'success', message: `${count.toLocaleString()}명 추출 완료` });
    setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
  };

  // (D43-3) handleExtractTarget 레거시 제거 (미사용)

  // AI 타겟 추천
  const handleAiRecommendTarget = async () => {
    if (!aiObjective.trim()) {
      setToast({ show: true, type: 'error', message: '마케팅 목표를 입력해주세요' });
      return;
    }
    setAiLoading(true);
    try {
      const response = await aiApi.recommendTarget({ objective: aiObjective });
      const result = response.data;
      console.log('AI 응답:', result);
      console.log('적용할 gender:', result.filters?.gender?.value);

      // 추천된 필터 적용
      if (result.filters) {
        const newFilter = { ...filter };
        if (result.filters.gender?.value) newFilter.gender = result.filters.gender.value;
        if (result.filters.age?.value) {
          newFilter.minAge = result.filters.age.value[0]?.toString() || '';
          newFilter.maxAge = result.filters.age.value[1]?.toString() || '';
        }
        if (result.filters.grade?.value) newFilter.grade = result.filters.grade.value;
        setFilter(newFilter);
        console.log('설정된 필터:', newFilter);
      }
      
      // 캠페인 컨텍스트 저장 (메시지 생성에 사용)
      setCampaignContext(aiObjective);
      
      setToast({ show: true, type: 'success', message: `AI 추천 완료! 예상 타겟: ${result.estimated_count.toLocaleString()}명${result.unsubscribe_count > 0 ? ` (수신거부 제외: ${result.unsubscribe_count.toLocaleString()}명)` : ''}` });
      setShowAiTarget(false);
      setAiObjective('');
    } catch (error) {
      console.error('AI 타겟 추천 실패:', error);
      setToast({ show: true, type: 'error', message: 'AI 추천 중 오류가 발생했습니다.' });
    } finally {
      setAiLoading(false);
    }
  };
// AI 캠페인 생성 (프롬프트 한 방)
const handleAiCampaignGenerate = async (promptOverride?: string, autoRelax?: boolean) => {
  const prompt = promptOverride || aiCampaignPrompt;
  if (!prompt.trim()) {
    setShowPromptAlert(true);
    return;
  }
  setAiLoading(true);
  try {
    // 1. 타겟 + 채널 추천 받기 (★ D80: auto_relax 파라미터 전달)
    const response = await aiApi.recommendTarget({ objective: prompt, auto_relax: autoRelax !== false });
    const result = response.data;
    
    // AI 결과 저장
    setEditingAiMsg(null);
    setAiResult({
      target: {
        description: result.reasoning || '추천 타겟',
        count: result.estimated_count || 0,
        unsubscribeCount: result.unsubscribe_count || 0,
        filters: result.filters || {},
      },
      recommendedChannel: result.recommended_channel || 'SMS',
      channelReason: result.channel_reason || '간단한 안내 메시지에 적합합니다.',
      recommendedTime: result.recommended_time || '',
      suggestedCampaignName: result.suggested_campaign_name || '',
      useIndividualCallback: result.use_individual_callback || false,
      usePersonalization: result.use_personalization || false,
      personalizationVars: result.personalization_vars || [],
    });
    setSampleCustomer(result.sample_customer || {});
    // ★ D85: column 키 raw 데이터 (백엔드 replaceVariables용)
    setSampleCustomerRaw(result.sample_customer_raw || {});
    
    // 추천 채널로 기본 설정
    let recommendedCh = result.recommended_channel || 'SMS';
    // AI가 카카오 추천해도 SMS/LMS/MMS만 허용
    if (recommendedCh === '카카오' || recommendedCh === 'KAKAO') {
      recommendedCh = 'LMS';
    }
    setSelectedChannel(recommendedCh);
    if ((recommendedCh) !== 'MMS') setMmsUploadedImages([]);
    setIsAd(result.is_ad !== false);
    
    // ★ D103: AI가 개별회신번호 추천 시 phoneFields 기반 동적 설정 (하드코딩 'store_phone' 제거)
    if (result.use_individual_callback) {
      setUseIndividualCallback(true);
      if (!individualCallbackColumn) {
        // phoneFields에서 첫 번째 전화번호 필드 사용, 없으면 store_phone 폴백
        setIndividualCallbackColumn(phoneFields[0] || 'store_phone');
      }
    }
  
    // 팝업 열기
    setShowAiResult(true);
    setAiStep(1);
  } catch (error) {
    console.error('AI 캠페인 생성 실패:', error);
    setToast({ show: true, type: 'error', message: 'AI 추천 중 오류가 발생했습니다.' });
  } finally {
    setAiLoading(false);
  }
};

// AI 메시지 생성 (채널 선택 후)
const handleAiGenerateChannelMessage = async () => {
  setAiLoading(true);
  try {
    const response = await aiApi.generateMessage({
      prompt: aiCampaignPrompt,
      brandName: user?.company?.name || '브랜드',
      channel: selectedChannel,
      isAd: isAd,
      usePersonalization: aiResult?.usePersonalization || false,
      personalizationVars: aiResult?.personalizationVars || [],
    });
    
    // 메시지 결과 저장
    setAiResult((prev: any) => ({
      ...prev,
      messages: response.data.variants || [],
    }));
    setSelectedAiMsgIdx(0);  // ★ B8-12: 재생성 시 인덱스 초기화
    
    // 2단계로 이동
    setAiStep(2);
  } catch (error) {
    console.error('AI 메시지 생성 실패:', error);
    setToast({ show: true, type: 'error', message: '메시지 생성 중 오류가 발생했습니다.' });
  } finally {
    setAiLoading(false);
  }
};

  // AI 메시지 생성
  const handleAiGenerateMessage = async () => {
    const prompt = aiPrompt.trim() || campaignContext;
    if (!prompt) {
      setToast({ show: true, type: 'error', message: '메시지 요청 내용을 입력해주세요' });
      return;
    }
    setAiLoading(true);
    try {
      const response = await aiApi.generateMessage({
        prompt: prompt,
        brandName: user?.company?.name || '브랜드',
      });
      setAiMessages(response.data.variants || []);
    } catch (error) {
      console.error('AI 메시지 생성 실패:', error);
      setToast({ show: true, type: 'error', message: 'AI 메시지 생성 중 오류가 발생했습니다.' });
    } finally {
      setAiLoading(false);
    }
  };

  // AI 메시지 선택
  const handleSelectAiMessage = (message: any) => {
    const text = campaign.messageType === 'SMS' ? message.sms_text : message.lms_text;
    setCampaign({ ...campaign, messageContent: text });
    setShowAiMessage(false);
    setAiMessages([]);
    setAiPrompt('');
  };

  const handleCreateCampaign = async () => {
    if (!campaign.campaignName || !campaign.messageContent) {
      setToast({ show: true, type: 'error', message: '캠페인명과 메시지 내용을 입력하세요' });
      return;
    }

    try {
      await campaignsApi.create({
        ...campaign,
        targetFilter: filter,
      });
      setToast({ show: true, type: 'success', message: '캠페인이 생성되었습니다' });
      setActiveTab('send');
    } catch (error: any) {
      setToast({ show: true, type: 'error', message: error.response?.data?.error || '캠페인 생성 실패' });
    } finally {
      setIsSending(false);
    }
  };
// AI 캠페인 발송 확정 (모달에서 호출)
const handleAiCampaignSend = async (modalData?: {
  campaignName: string;
  sendTimeOption: 'ai' | 'now' | 'custom';
  customSendTime: string;
  selectedCallback: string;
  useIndividualCallback: boolean;
  individualCallbackColumn?: string;
  subject?: string;
}) => {
  if (isSending || directSending) return; // 교차 중복 발송 방지
  // ★ D131: MMS 이미지 첨부 검증 (한줄로 AI) — 사용자가 AI 추천 채널을 override할 수 있으므로
  //         AI 추천값(recommendedChannel)이 아닌 실제 선택값(selectedChannel) 기준으로 검증.
  const mmsErr = validateMmsBeforeSend(selectedChannel, mmsUploadedImages.length);
  if (mmsErr) {
    setToast({ show: true, type: 'error', message: mmsErr });
    return;
  }
  if (adTextEnabled && !optOutNumber) {
    setToast({ show: true, type: 'error', message: '광고 발송을 위해 수신거부번호(080) 설정이 필요합니다. 설정 > 발신번호 관리에서 등록해주세요.' });
    return;
  }

  const _sendTimeOption = modalData?.sendTimeOption || sendTimeOption;
  const _customSendTime = modalData?.customSendTime || customSendTime;
  const _selectedCallback = modalData?.selectedCallback ?? selectedCallback;
  const _useIndividualCallback = modalData?.useIndividualCallback ?? useIndividualCallback;
  const _campaignName = modalData?.campaignName || '';

  // 회신번호 검증
  if (!_selectedCallback && !_useIndividualCallback) {
    setToast({ show: true, type: 'error', message: '회신번호를 선택해주세요' });
    return;
  }

  setIsSending(true);
  try {
    // 선택된 메시지 가져오기 (첫번째 메시지 사용, 나중에 라디오 선택값으로 변경 가능)
    const selectedMsg = aiResult?.messages?.[selectedAiMsgIdx];
    if (!selectedMsg) {
      setToast({ show: true, type: 'error', message: '메시지를 선택해주세요' });
      setIsSending(false);
      return;
    }

    // 발송시간 계산
    let scheduledAt: string | null = null;
    if (_sendTimeOption === 'ai' && aiResult?.recommendedTime) {
      // AI 추천시간 파싱 (예: "2024-02-01 19:00" 또는 "2월 1일 오후 7시")
      const timeStr = aiResult.recommendedTime;
      let parsedDate: Date | null = null;
      // ISO 형식이면 그대로, 아니면 파싱 시도
      if (timeStr.includes('T') || timeStr.match(/^\d{4}-\d{2}-\d{2}/)) {
        parsedDate = new Date(timeStr);
      } else {
        // 한국어 형식 파싱 시도 (예: "2월 1일 19:00")
        const match = timeStr.match(/(\d+)월\s*(\d+)일.*?(\d{1,2}):?(\d{2})?/);
        if (match) {
          const year = new Date().getFullYear();
          const month = parseInt(match[1]) - 1;
          const day = parseInt(match[2]);
          const hour = parseInt(match[3]);
          const minute = parseInt(match[4] || '0');
          parsedDate = new Date(year, month, day, hour, minute);
        }
      }
      // ★ 추천시간이 과거이면 다음날 같은 시간으로 보정
      if (parsedDate && parsedDate.getTime() <= Date.now()) {
        parsedDate.setDate(parsedDate.getDate() + 1);
        console.log('[AI 추천시간] 과거 시간 → 다음날로 보정:', parsedDate.toISOString());
      }
      if (parsedDate) {
        scheduledAt = parsedDate.toISOString();
      }
    } else if (_sendTimeOption === 'custom' && _customSendTime) {
      scheduledAt = new Date(_customSendTime).toISOString();
    }
    // 'now'면 scheduledAt은 null (즉시 발송)

    // 이벤트 기간 파싱 (AI 메시지에서 추출 시도)
    let eventStartDate: string | null = null;
    let eventEndDate: string | null = null;
    
    // 메시지 내용에서 이벤트 기간 추출 시도
    const msgText = selectedMsg.message_text || '';
    // 여러 형식 지원: "X월 X일 ~ X일", "X월 X일 ~ X월 X일", "X/X ~ X/X"
    let eventMatch = msgText.match(/(\d+)월\s*(\d+)일.*?~\s*(\d+)월\s*(\d+)일/); // 2월 13일 ~ 2월 15일
    if (!eventMatch) {
      eventMatch = msgText.match(/(\d+)월\s*(\d+)일.*?~\s*(\d+)일/); // 2월 13일 ~ 15일
      if (eventMatch) {
        // 끝나는 월이 없으면 시작 월과 같음
        eventMatch = [eventMatch[0], eventMatch[1], eventMatch[2], eventMatch[1], eventMatch[3]];
      }
    }
    if (!eventMatch) {
      eventMatch = msgText.match(/(\d+)\/(\d+).*?~\s*(\d+)\/(\d+)/); // 2/13 ~ 2/15
    }
    
    if (eventMatch) {
      const year = new Date().getFullYear();
      const startMonth = parseInt(eventMatch[1]) - 1;
      const startDay = parseInt(eventMatch[2]);
      const endMonth = parseInt(eventMatch[3]) - 1;
      const endDay = parseInt(eventMatch[4]);
      eventStartDate = `${year}-${String(startMonth + 1).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
      eventEndDate = `${year}-${String(endMonth + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
    }

    // AI 추천 캠페인명 우선 사용, 없으면 메시지에서 추출
const msgContent = selectedMsg.message_text || '';
const nameMatch = msgContent.match(/\][\s]*(.+?)[\s]*[\n\r]/);
const extractedName = nameMatch ? nameMatch[1].replace(/[^\w가-힣\s]/g, '').trim().slice(0, 30) : `캠페인_${formatDate(new Date().toISOString())}`;
const autoName = _campaignName || aiResult?.suggestedCampaignName || extractedName;

const campaignData = {
  campaignName: autoName,
      messageType: selectedChannel,
      sendChannel: 'sms',
      messageContent: selectedMsg.message_text,  // ★ D103: 순수 본문만 전달. (광고)+080은 백엔드 prepareSendMessage에서 추가
      targetFilter: aiResult?.target?.filters || {},
      isAd: isAd,
      scheduledAt: scheduledAt,
      eventStartDate: eventStartDate,
      eventEndDate: eventEndDate,
      callback: _useIndividualCallback ? null : _selectedCallback,
      useIndividualCallback: _useIndividualCallback,
      individualCallbackColumn: _useIndividualCallback ? (modalData?.individualCallbackColumn ?? individualCallbackColumn) : undefined,
      // ★ B-D75-01: 모달에서 수정된 제목 우선 사용
      subject: modalData?.subject ?? selectedMsg.subject ?? '',
      mmsImagePaths: toMmsImagePaths(mmsUploadedImages),
    };

    const response = await campaignsApi.create(campaignData);

    // 캠페인 발송 API 호출 (예약/즉시 모두)
    const campaignId = response.data.campaign?.id;
    if (campaignId) {
      const sendResult = await campaignsApi.send(campaignId);
      // ★ 미등록 회신번호 확인 모달 — callbackConfirmRequired 응답 처리
      if (sendResult.data?.callbackConfirmRequired) {
        setPendingAiCampaignId(campaignId);
        setCallbackConfirm({
          show: true,
          callbackMissingCount: sendResult.data.callbackMissingCount,
          callbackUnregisteredCount: sendResult.data.callbackUnregisteredCount,
          unregisteredDetails: sendResult.data.unregisteredDetails || [],
          remainingCount: sendResult.data.remainingCount,
          message: sendResult.data.message,
          sendType: 'ai',
        });
        setIsSending(false);
        return;
      }
    }

    // 모달 닫기 + 상태 초기화
    setShowPreview(false);
    setShowAiResult(false);
    setShowAiSendModal(false);
    setAiStep(1);
    setAiCampaignPrompt('');
    // ★ B17-04: 이전 AI 결과 완전 초기화 (중복 발송 방지)
    setSelectedAiMsgIdx(0);
    setEditingAiMsg(null);
    // 성공 모달용 발송 정보 저장 (초기화 전에!)
    const sendInfoText = _sendTimeOption === 'now' ? '즉시 발송 완료' : 
                         _sendTimeOption === 'ai' ? `예약 완료 (${aiResult?.recommendedTime || 'AI 추천'})` :
                         `예약 완료 (${_customSendTime ? new Date(_customSendTime).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''})`;
    setSuccessSendInfo(sendInfoText);
    setSuccessChannel(selectedChannel);  // ★ #8 수정
    setSuccessTargetCount(aiResult?.target?.count || 0);  // ★ #8 수정
    setSuccessUnsubscribeCount(aiResult?.target?.unsubscribeCount || 0);  // ★ B8-08 수정
    // ★ D107: 저장 세그먼트용 — 한줄로 설정 캐시
    setLastSendConfig({ type: 'hanjullo', prompt: aiCampaignPrompt });

    // ★ B17-04: aiResult는 성공 모달용 값 저장 후 초기화 (중복 발송 방지)
    setAiResult(null);
    setSendTimeOption('ai');
    setCustomSendTime('');

    setSuccessCampaignId(response.data.campaign?.id || '');
    setShowSuccess(true);
    loadRecentCampaigns();
    loadScheduledCampaigns();
    
  } catch (error: any) {
    console.error('캠페인 생성 실패:', error);
    if (error.response?.data?.code === 'LINE_GROUP_NOT_SET') {
      setShowLineGroupError(true);
    } else if (error.response?.status === 402 && error.response?.data?.insufficientBalance) {
      setShowInsufficientBalance({show: true, balance: error.response.data.balance, required: error.response.data.requiredAmount});
    } else {
      setToast({ show: true, type: 'error', message: error.response?.data?.error || '캠페인 생성에 실패했습니다.' });
    }
  } finally {
    setIsSending(false);
  }
};

  // AI 맞춤한줄 발송 처리
  const handleAiCustomSend = async (modalData: {
    campaignName: string;
    sendTimeOption: 'ai' | 'now' | 'custom';
    customSendTime: string;
    selectedCallback: string;
    useIndividualCallback: boolean;
    individualCallbackColumn?: string;
    subject?: string;
  }) => {
    if (isSending || directSending || !customSendData) return; // 교차 중복 발송 방지
    // ★ B2(0417 PDF #2): MMS 이미지 첨부 검증 (맞춤한줄)
    if (customSendData.channel === 'MMS' && mmsUploadedImages.length === 0) {
      setToast({ show: true, type: 'error', message: 'MMS는 이미지 첨부가 필수입니다. 이미지를 업로드하거나 발송타입을 SMS/LMS로 변경해주세요.' });
      return;
    }
    if (adTextEnabled && !optOutNumber) {
      setToast({ show: true, type: 'error', message: '광고 발송을 위해 수신거부번호(080) 설정이 필요합니다. 설정 > 발신번호 관리에서 등록해주세요.' });
      return;
    }

    const _sendTimeOption = modalData.sendTimeOption;
    const _customSendTime = modalData.customSendTime;
    const _selectedCallback = modalData.selectedCallback;
    const _useIndividualCallback = modalData.useIndividualCallback;
    const _campaignName = modalData.campaignName;

    if (!_selectedCallback && !_useIndividualCallback) {
      setToast({ show: true, type: 'error', message: '회신번호를 선택해주세요' });
      return;
    }

    setIsSending(true);
    try {
      const variant = customSendData.variant;
      const channelType = customSendData.channel; // SMS or LMS

      // 발송시간 계산
      let scheduledAt: string | null = null;
      if (_sendTimeOption === 'custom' && _customSendTime) {
        scheduledAt = new Date(_customSendTime).toISOString();
      }
      // AI 맞춤한줄은 AI 추천시간 없으므로 'ai' 옵션 없음, 'now'면 null

      // ★ D103: 순수 본문만 전달. (광고)+080은 백엔드 prepareSendMessage에서 추가
      const messageContent = variant.message_text || '';

      const campaignData = {
        campaignName: _campaignName,
        messageType: channelType,
        sendChannel: 'sms',
        messageContent,
        targetFilter: customSendData.targetFilters || {},
        // ★ D111 P3: Dashboard 전역 isAd 대신 맞춤한줄 Step3 토글값(customSendData.isAd) 사용
        //   이전: isAd: isAd → 사용자가 광고 OFF 해도 Dashboard 전역값 true면 실발송에 (광고) 붙음
        //   같은 버그를 미리보기 prop과 실발송 body 양쪽에 가지고 있었음 → 양쪽 동일 수정
        isAd: customSendData.isAd ?? false,
        scheduledAt,
        eventStartDate: null,
        eventEndDate: null,
        callback: _useIndividualCallback ? null : _selectedCallback,
        useIndividualCallback: _useIndividualCallback,
        // ★ D102: modalData.individualCallbackColumn 우선 (맞춤한줄 개별회신번호 누락 수정)
        individualCallbackColumn: _useIndividualCallback ? (modalData.individualCallbackColumn || individualCallbackColumn || 'store_phone') : undefined,
        // ★ B+0407-3: 사용자가 발송확정 모달에서 수정한 제목(modalData.subject)을 우선 사용
        //   기존: variant.subject 만 사용 → 사용자 제목 수정이 무시되어 원본 제목으로 발송됨
        subject: modalData.subject ?? variant.subject ?? '',
        // ★ B1: MMS 채널일 때 첨부 이미지 경로 전달 (이전: 빈 배열 하드코딩으로 첨부 누락)
        mmsImagePaths: channelType === 'MMS' ? toMmsImagePaths(mmsUploadedImages) : [],
      };

      console.log('=== AI 맞춤한줄 발송 디버깅 ===');
      console.log('customSendData:', customSendData);
      console.log('campaignData:', campaignData);

      const response = await campaignsApi.create(campaignData);

      const campaignId = response.data.campaign?.id;
      if (campaignId) {
        const sendResult = await campaignsApi.send(campaignId);
        // ★ 미등록 회신번호 확인 모달 — callbackConfirmRequired 응답 처리
        if (sendResult.data?.callbackConfirmRequired) {
          setPendingAiCampaignId(campaignId);
          setCallbackConfirm({
            show: true,
            callbackMissingCount: sendResult.data.callbackMissingCount,
            callbackUnregisteredCount: sendResult.data.callbackUnregisteredCount,
            unregisteredDetails: sendResult.data.unregisteredDetails || [],
            remainingCount: sendResult.data.remainingCount,
            message: sendResult.data.message,
            sendType: 'aiCustom',
          });
          setIsSending(false);
          return;
        }
      }

      // 모달 닫기 + 초기화
      setShowCustomSendModal(false);
      setShowAiCustomFlow(false);
      // ★ #8 수정: customSendData null 전에 채널/인원수 저장
      setSuccessChannel(customSendData?.channel || 'LMS');
      setSuccessTargetCount(customSendData?.estimatedCount || 0);
      setSuccessUnsubscribeCount(customSendData?.unsubscribeCount || 0);  // ★ B8-08 수정
      // ★ D107: 저장 세그먼트용 — 맞춤한줄 설정 캐시
      if (customSendData) {
        setLastSendConfig({
          type: 'custom',
          selectedFields: customSendData.personalFields,
          briefing: customSendData.briefing,
          url: customSendData.url,
          channel: customSendData.channel,
          isAd: customSendData.isAd,
        });
      }
      setCustomSendData(null);
      // ★ B17-04: 이전 AI 결과 완전 초기화 (중복 발송 방지)
      setAiResult(null);
      setSelectedAiMsgIdx(0);
      setAiStep(1);
      setAiCampaignPrompt('');

      const sendInfoText = _sendTimeOption === 'now' ? '즉시 발송 완료' :
        `예약 완료 (${_customSendTime ? new Date(_customSendTime).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''})`;
      setSuccessSendInfo(sendInfoText);
      setSuccessCampaignId(response.data.campaign?.id || '');
      setShowSuccess(true);
      loadRecentCampaigns();
      loadScheduledCampaigns();

    } catch (error: any) {
      console.error('AI 맞춤한줄 발송 실패:', error);
      if (error.response?.data?.code === 'LINE_GROUP_NOT_SET') {
        setShowLineGroupError(true);
      } else if (error.response?.status === 402 && error.response?.data?.insufficientBalance) {
        setShowInsufficientBalance({ show: true, balance: error.response.data.balance, required: error.response.data.requiredAmount });
      } else {
        setToast({ show: true, type: 'error', message: error.response?.data?.error || '캠페인 생성에 실패했습니다.' });
      }
    } finally {
      setIsSending(false);
    }
  };

  // 담당자 사전수신
  const handleTestSend = async () => {
    setTestSending(true);
    setTestSentResult(null);
    try {
      const selectedMsg = aiResult?.messages?.[selectedAiMsgIdx];
      if (!selectedMsg) {
        setToast({ show: true, type: 'error', message: '메시지를 선택해주세요' });
        setTestSending(false);
        return;
      }
      // ★ D131: MMS + 이미지 0장 차단 (QTmsg Agent 9007 파일 오류 방지)
      //   서수란 팀장 제보(2026-04-21) — 담당자 테스트 MMS 37% 실패 원인.
      if (selectedChannel === 'MMS' && mmsUploadedImages.length === 0) {
        setToast({ show: true, type: 'error', message: 'MMS는 이미지 첨부가 필수입니다. 이미지를 업로드하거나 발송타입을 SMS/LMS로 변경해주세요.' });
        setTestSending(false);
        return;
      }
      const token = localStorage.getItem('token');
      const res = await fetch('/api/campaigns/test-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messageContent: selectedMsg.message_text,  // ★ D103: 순수 본문만. (광고)+080은 백엔드에서 추가
          messageType: selectedChannel,
          isAd: isAd,
          subject: selectedMsg.subject || '',
          mmsImagePaths: toMmsImagePaths(mmsUploadedImages),
          // ★ D85: column 키 raw 데이터 전달 — replaceVariables가 customer[column]으로 접근
          sampleCustomer: sampleCustomerRaw && Object.keys(sampleCustomerRaw).length > 0 ? sampleCustomerRaw : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const contactList = data.contacts?.map((c: any) => `${c.name}(${c.phone})`).join(', ') || '';
        setTestSentResult(`✅ ${data.message}\n${contactList}`);
      } else {
        setTestSentResult(`❌ ${data.error}`);
      }
    } catch (error) {
      setTestSentResult('❌ 테스트 발송 실패');
    } finally {
      setTestSending(false);
      setTestCooldown(true);
      setTimeout(() => {
        setTestCooldown(false);
        setTestSentResult(null);
      }, 10000);
    }
  };

  // 직접타겟발송 담당자 테스트
  const handleTargetTestSend = async () => {
    setTestSending(true);
    setTestSentResult(null);
    try {
      if (!targetMessage.trim()) {
        setToast({ show: true, type: 'error', message: '메시지를 입력해주세요' });
        setTestSending(false);
        return;
      }
      // ★ D131: MMS + 이미지 0장 차단 (QTmsg Agent 9007 파일 오류 방지)
      if (targetMsgType === 'MMS' && mmsUploadedImages.length === 0) {
        setToast({ show: true, type: 'error', message: 'MMS는 이미지 첨부가 필수입니다. 이미지를 업로드하거나 발송타입을 SMS/LMS로 변경해주세요.' });
        setTestSending(false);
        return;
      }
      // ★ D103: 순수 본문만. (광고)+080은 백엔드 test-send에서 추가
      const token = localStorage.getItem('token');
      const res = await fetch('/api/campaigns/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messageContent: targetMessage,
          messageType: targetMsgType,
          isAd: adTextEnabled,
          subject: targetSubject || '',
          mmsImagePaths: toMmsImagePaths(mmsUploadedImages),
          // ★ D85: column 키 raw 데이터 전달
          sampleCustomer: sampleCustomerRaw && Object.keys(sampleCustomerRaw).length > 0 ? sampleCustomerRaw : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const contactList = data.contacts?.map((c: any) => `${c.name}(${c.phone})`).join(', ') || '';
        setTestSentResult(`✅ ${data.message}\n${contactList}`);
      } else {
        setTestSentResult(`❌ ${data.error}`);
      }
    } catch (error) {
      setTestSentResult('❌ 테스트 발송 실패');
    } finally {
      setTestSending(false);
      setTestCooldown(true);
      setTimeout(() => { setTestCooldown(false); setTestSentResult(null); }, 10000);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  // ★ D95: 바이트 계산 — formatDate.ts 컨트롤타워 사용
  const calculateBytes = calculateSmsBytes;

  // ★ D95: SMS 바이트 자르기 — formatDate.ts 컨트롤타워 사용 (alias)

  // ★ D123 P6: 인라인 제거 → formatPhoneNumber 컨트롤타워 사용 (02/대표번호/050X 전부 정확 처리)
  const formatRejectNumber = formatPhoneNumber;

  // ★ AI추천 미리보기용 광고 문구 래핑 — D102: buildAdMessageFront 컨트롤타워 사용
  const wrapAdText = (msg: string, channel?: string) => {
    if (!msg) return msg;
    return buildAdMessageFront(msg, channel || selectedChannel, isAd, optOutNumber);
  };

  const getFullMessage = (msg: string) => {
    return buildAdMessageFront(msg, directMsgType, adTextEnabled, optOutNumber);
  };

  // ★ D96: 컨트롤타워(DIRECT_VAR_TO_FIELD) 사용 — 하드코딩 변수맵 제거
  const messageBytes = calculateBytes(getFullMessage(getMaxByteMessage(directMessage, directRecipients, DIRECT_VAR_TO_FIELD)));

  const maxBytes = directMsgType === 'SMS' ? 90 : 2000;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* 스팸필터 잠금 모달 */}
      <SpamFilterLockModal show={showSpamFilterLock} onClose={() => setShowSpamFilterLock(false)} />

      {/* 요금제 승인 알림 모달 */}
      <PlanApprovalModal
        show={showPlanApproval}
        planName={planApproval?.planName || ''}
        onClose={async () => {
          setShowPlanApproval(false);
          if (planApproval?.requestId) {
            const token = localStorage.getItem('token');
            await fetch(`/api/companies/plan-request/${planApproval.requestId}/confirm`, {
              method: 'PUT',
              headers: { Authorization: `Bearer ${token}` },
            });
          }
          setPlanApproval(null);
          // 잠금 해제 반영을 위해 페이지 새로고침
          window.location.reload();
        }}
      />

      {/* 스팸필터 테스트 모달 */}
      {showSpamFilter && (
        <SpamFilterTestModal
          onClose={() => setShowSpamFilter(false)}
          messageContentSms={spamFilterData.sms}
          messageContentLms={spamFilterData.lms}
          callbackNumber={spamFilterData.callback}
          messageType={spamFilterData.msgType}
          subject={spamFilterData.subject}
          isAd={spamFilterData.isAd}
          firstRecipient={spamFilterData.firstRecipient}
        />
      )}

      {/* AI 발송 방식 선택 모달 */}
      {showAiSendType && (
        <AiSendTypeModal
          onClose={() => { setShowAiSendType(false); setAiCampaignPrompt(''); }}
          initialPrompt={aiCampaignPrompt}
          aiPremiumEnabled={!!planInfo?.ai_premium_enabled}
          onSelectHanjullo={(prompt, autoRelax) => {
            setShowAiSendType(false);
            setAiCampaignPrompt(prompt);
            handleAiCampaignGenerate(prompt, autoRelax);
          }}
          onSelectCustom={() => {
            setShowAiSendType(false);
            setShowAiCustomFlow(true);
          }}
        />
      )}

      {/* AI 맞춤한줄 플로우 */}
      {showAiCustomFlow && (
        <AiCustomSendFlow
          onClose={() => { setShowAiCustomFlow(false); setCustomSendData(null); setCustomFlowPreload(null); }}
          preloadData={customFlowPreload || undefined}
          onConfirmSend={(data) => {
            setCustomSendData(data);
            setShowCustomSendModal(true);
          }}
          brandName={user?.company?.name || '브랜드'}
          callbackNumbers={callbackNumbers}
          selectedCallback={selectedCallback}
          isAd={isAd}
          optOutNumber={optOutNumber}
          setShowSpamFilter={setShowSpamFilter}
          setSpamFilterData={setSpamFilterData}
          handleTestSend={handleTestSend}
          testSending={testSending}
          testCooldown={testCooldown}
          testSentResult={testSentResult}
          sampleCustomer={sampleCustomer}
          isSpamFilterLocked={isSpamFilterLocked}
          /* ★ B1: MMS 이미지 첨부 (한줄로 AI와 동일 패턴 — Dashboard 부모 state 공유) */
          mmsUploadedImages={mmsUploadedImages}
          onMmsImageUpload={(files) => handleMmsMultiUpload(files!)}
          onMmsImageRemove={handleMmsImageRemove}
          mmsUploading={mmsUploading}
        />
      )}

      {/* AI 캠페인 발송 확정 모달 */}
      {showAiSendModal && (
        <AiCampaignSendModal
          onClose={() => setShowAiSendModal(false)}
          onSend={(data) => handleAiCampaignSend(data)}
          isSending={isSending}
          messageText={aiResult?.messages?.[selectedAiMsgIdx]?.message_text || ''}
          selectedChannel={selectedChannel}
          suggestedCampaignName={aiResult?.suggestedCampaignName || ''}
          recommendedTime={aiResult?.recommendedTime || ''}
          targetDescription={aiResult?.target?.description || '추천 타겟'}
          targetCount={aiResult?.target?.count || 0}
          callbackNumbers={callbackNumbers}
          defaultCallback={selectedCallback}
          defaultUseIndividual={useIndividualCallback}
          isAd={isAd}
          optOutNumber={optOutNumber}
          phoneFields={phoneFields}
          mmsImages={mmsUploadedImages}
          subject={aiResult?.messages?.[selectedAiMsgIdx]?.subject}
          usePersonalization={aiResult?.usePersonalization}
          sampleCustomer={sampleCustomer}
          />
        )}

        {/* AI 맞춤한줄 발송 확정 모달 */}
        {showCustomSendModal && customSendData && (
          <AiCampaignSendModal
            onClose={() => { setShowCustomSendModal(false); setCustomSendData(null); }}
            onSend={(data) => handleAiCustomSend(data)}
            isSending={isSending}
            messageText={customSendData.variant?.message_text || ''}
            selectedChannel={customSendData.channel}
            suggestedCampaignName={customSendData.promotionCard?.name || 'AI 맞춤 캠페인'}
            recommendedTime={''}
            targetDescription={customSendData.targetCondition?.description || '전체 고객'}
            targetCount={customSendData.estimatedCount || 0}
            callbackNumbers={callbackNumbers}
            defaultCallback={selectedCallback}
            defaultUseIndividual={useIndividualCallback}
            /* ★ D111 P3: Dashboard 전역 isAd 대신 맞춤한줄에서 사용자가 토글한 값(customSendData.isAd)을 전달.
               이전: isAd={isAd} → Dashboard 전역값 사용 → 광고 제외로 토글해도 미리보기에 (광고)+080 표시 (실발송은 정상).
               crm/sh 계정은 전역 isAd=false라 영향 없었고, 나머지 계정만 재현됨. */
            isAd={customSendData.isAd ?? false}
            optOutNumber={optOutNumber}
            phoneFields={phoneFields}
            subject={customSendData.variant?.subject}
            usePersonalization={true}
            sampleCustomer={sampleCustomer}
            /* ★ B1 후속: 발송 확정 모달 폰 미리보기에도 MMS 이미지 표시 */
            mmsImages={customSendData.channel === 'MMS' ? mmsUploadedImages : undefined}
          />
        )}
  
        {/* AI 프롬프트 입력 안내 모달 */}
      {showPromptAlert && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 bg-gradient-to-r from-emerald-50 to-green-50">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-emerald-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-800">AI 캠페인 생성</h3>
              </div>
              <p className="text-gray-600 leading-relaxed">
                원하는 캠페인 내용을 입력하세요.<br/>
                <span className="text-emerald-700 font-medium">타겟 선정부터 메시지 작성, 발송 시간까지</span><br/>
                AI가 자동으로 설계해드립니다.
              </p>
            </div>
            <div className="p-4 bg-gray-50 border-t">
              <div className="text-sm text-gray-500 mb-4">
                <p className="font-medium mb-2">💡 입력 예시:</p>
                <ul className="space-y-1 text-gray-600">
                  <li>• 30대 여성 VIP에게 봄 신상품 20% 할인 안내</li>
                  <li>• 3개월 미구매 고객에게 재방문 쿠폰 발송</li>
                  <li>• 생일 고객에게 축하 메시지 보내기</li>
                </ul>
              </div>
              <button
                onClick={() => setShowPromptAlert(false)}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition-colors"
              >
                확인
              </button>
            </div>
          </div>
          </div>
      )}
      {/* 토스트 알림 */}
      {toast.show && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] animate-bounce">
          <div className={`px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 ${
            toast.type === 'success'
              ? 'bg-gradient-to-r from-emerald-500 to-green-500 text-white'
              : toast.type === 'warning'
              ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white'
              : 'bg-gradient-to-r from-red-500 to-rose-500 text-white'
          }`}>
            <span className="text-2xl">{toast.type === 'success' ? '✅' : toast.type === 'warning' ? '⚠️' : '❌'}</span>
            <span className="font-medium text-lg">{toast.message}</span>
            <button onClick={() => setToast(prev => ({...prev, show: false}))} className="ml-2 text-white/80 hover:text-white text-lg">✕</button>
          </div>
        </div>
      )}
      {/* 헤더 */}
      <DashboardHeader
        companyName={companyNameFromDB || user?.company?.name || '한줄로'}
        userName={user?.name || ''}
        department={(user as any)?.department}
        isCompanyAdmin={user?.userType === 'company_admin'}
        onDirectSend={async () => {
          setShowDirectSend(true);
          try {
            const token = localStorage.getItem('token');
            const settingsRes = await fetch('/api/companies/settings', {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (settingsRes.ok) {
              const settingsData = await settingsRes.json();
              if (settingsData.reject_number) {
                setOptOutNumber(settingsData.reject_number);
              }
            }
            const res = await fetch('/api/companies/callback-numbers', {
              headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) {
              setCallbackNumbers(data.numbers || []);
              const defaultCb = data.numbers?.find((n: any) => n.is_default);
              if (defaultCb) setSelectedCallback(defaultCb.phone);
            }
          } catch (err) {
            console.error('회신번호 로드 실패:', err);
          }
        }}
        onCalendar={() => setShowCalendar(true)}
        onResults={() => setShowResults(true)}
        onAnalysis={() => setShowAnalysis(true)}
        onLogout={handleLogout}
        customerDbEnabled={planInfo?.customer_db_enabled}
        isSubscriptionLocked={isSubscriptionLocked}
        onSubscriptionLocked={() => setShowSubscriptionLock(true)}
        onFeatureLocked={(feature, required) => {
          setPlanUpgradeFeature(feature);
          setPlanUpgradeRequired(required);
          setShowPlanUpgradeModal(true);
        }}
      />

      {/* 메인 */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* ===== 상단: 좌(60%) + 우(40%) 통합 ===== */}
        <div className="flex gap-4 mb-4">
          {/* ===== 좌측 60%: 요금제/발송현황 + 동적카드 ===== */}
          <div className="w-[60%] flex flex-col gap-4">
            {/* 1행: 요금제 + 발송현황 */}
            <div className="flex gap-4">
              {/* 요금제 현황 */}
              <div
                onClick={() => navigate('/pricing')}
                className="w-[40%] bg-white rounded-2xl p-5 cursor-pointer hover:shadow-md transition-all border border-gray-100 shadow-sm"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-4 bg-green-600 rounded-full" />
                    <span className="text-sm font-semibold text-gray-800">요금제 현황</span>
                  </div>
                  <span className="text-xs font-medium text-gray-400 hover:text-green-700 transition-colors">요금제 안내 <span className="text-[10px]">→</span></span>
                </div>
                {/* ★ CT-17: plan_name + D-N 뱃지 같은 줄 배치로 카드 높이 최소화 */}
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-lg font-bold text-gray-800">
                    {planInfo?.plan_name || '로딩...'}
                  </span>
                  {/* TRIAL 체험 중 → 요금제 만료 D-N 뱃지 (PricingPage와 톤 통일) */}
                  {planInfo?.plan_code === 'TRIAL' && planInfo?.trial_expires_at && (() => {
                    const daysLeft = Math.max(0, Math.ceil((new Date(planInfo.trial_expires_at).getTime() - Date.now()) / 86400000));
                    return (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-[11px] font-bold whitespace-nowrap">요금제 만료 D-{daysLeft}</span>
                      </span>
                    );
                  })()}
                  {/* 체험 만료 후 FREE 강등 마커 */}
                  {planInfo?.subscription_status === 'trial_expired' && (
                    <span className="px-2 py-0.5 bg-red-100 text-red-600 text-[11px] font-bold rounded-full whitespace-nowrap">체험 만료</span>
                  )}
                </div>
                {planInfo?.plan_code !== 'FREE' && planInfo?.max_customers && (
                  <div className="mt-1">
                    <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-400">
                        {Number(planInfo.current_customers || 0).toLocaleString()} / {Number(planInfo.max_customers).toLocaleString()}명
                      </span>
                      <span className="text-xs text-gray-400">
                        {Math.round(((planInfo.current_customers || 0) / planInfo.max_customers) * 100)}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          ((planInfo.current_customers || 0) / planInfo.max_customers) >= 0.95
                            ? 'bg-red-500'
                            : ((planInfo.current_customers || 0) / planInfo.max_customers) >= 0.8
                              ? 'bg-orange-400'
                              : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(100, ((planInfo.current_customers || 0) / planInfo.max_customers) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
                {planInfo?.plan_code !== 'FREE' && !planInfo?.max_customers && (
                  <div className="text-xs text-gray-400">정상 이용 중</div>
                )}
              </div>

              {/* 발송 현황 */}
              <div className="w-[60%] bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-4 bg-green-600 rounded-full" />
                    <span className="text-sm font-semibold text-gray-800">발송 현황</span>
                  </div>
                  {balanceInfo?.billingType === 'prepaid' && (
                    <button onClick={() => setShowBalanceModal(true)} className="text-xs font-medium text-gray-400 hover:text-green-700 transition-colors">잔액 현황 <span className="text-[10px]">→</span></button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="text-center p-2 bg-gray-50 rounded-lg">
                    <div className="text-lg font-bold text-gray-800">{(stats?.monthly_sent || 0).toLocaleString()}</div>
                    <div className="text-xs text-gray-400 mt-1">성공건수</div>
                  </div>
                  <div className="text-center p-2 bg-gray-50 rounded-lg">
                    <div className="text-lg font-bold text-gray-800">{stats?.success_rate || '0'}%</div>
                    <div className="text-xs text-gray-400 mt-1">평균성공률</div>
                  </div>
                  <div className="text-center p-2 bg-gray-50 rounded-lg">
                    <div className="text-lg font-bold text-gray-800">{(stats?.monthly_cost || 0).toLocaleString()}<span className="text-xs font-normal text-gray-400">원</span></div>
                    <div className="text-xs text-gray-400 mt-1">총 사용금액</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 2행: DB현황 — 동적 카드 (D41, D107 리뉴얼) */}
            <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm flex-1">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-4 bg-green-600 rounded-full" />
                  <span className="text-sm font-semibold text-gray-800">DB 현황</span>
                </div>
                <button onClick={() => isSubscriptionLocked ? setShowSubscriptionLock(true) : setShowCustomerDB(true)} className="text-xs font-medium text-gray-400 hover:text-green-700 transition-colors flex items-center gap-1">
                  상세보기 <span className="text-[10px]">→</span>
                </button>
              </div>

              {/* 카드 미설정 */}
              {(!dashboardCards || !dashboardCards.configured) && (
                <div className="flex items-center justify-center py-10 text-gray-400">
                  <div className="text-center">
                    <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-3">
                      <BarChart3 className="w-6 h-6 text-gray-300" />
                    </div>
                    <div className="text-sm text-gray-400">관리자가 대시보드 카드를 설정하면 표시됩니다</div>
                  </div>
                </div>
              )}

              {/* 고객 DB 미업로드 — 전체 블러 + CTA */}
              {dashboardCards?.configured && dashboardCards?.hasCustomerData === false && (
                <div className="relative">
                  <div className="grid grid-cols-3 gap-3 filter blur-sm pointer-events-none select-none">
                    {dashboardCards.cards.slice(0, 6).map((card) => (
                      <div key={card.cardId} className="p-4 bg-gray-50/50 rounded-xl">
                        <div className="text-lg font-bold text-gray-200">0</div>
                        <div className="text-[10px] text-gray-300 mt-1">{card.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-[2px] rounded-xl">
                    <div className="text-center">
                      <div className="w-12 h-12 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-3">
                        <Users className="w-6 h-6 text-green-500" />
                      </div>
                      <div className="text-sm text-gray-600 font-medium mb-3">고객 DB를 업로드하면 현황을 확인할 수 있습니다</div>
                      <button
                        onClick={() => { openFileUpload(); }}
                        className="px-5 py-2 bg-gray-900 text-white text-xs font-medium rounded-xl hover:bg-gray-800 transition-colors shadow-sm"
                      >
                        고객 DB 업로드
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 정상 표시: 6개씩 페이징 카드 렌더링 (D77, D107 리뉴얼) */}
              {dashboardCards?.configured && dashboardCards?.hasCustomerData && (() => {
                const CARDS_PER_PAGE = 6;
                const allCards = dashboardCards.cards;
                const totalPages = Math.ceil(allCards.length / CARDS_PER_PAGE);
                const safePage = Math.min(dbCardPage, totalPages - 1);
                const pageCards = allCards.slice(safePage * CARDS_PER_PAGE, (safePage + 1) * CARDS_PER_PAGE);

                return (
                  <div>
                    <div className="grid grid-cols-3 gap-3">
                      {pageCards.map((card, i) => {
                        const globalIdx = safePage * CARDS_PER_PAGE + i;
                        const color = CARD_COLORS[globalIdx % CARD_COLORS.length];
                        const IconComp = CARD_ICON_MAP[card.icon] || HelpCircle;

                        // 데이터 없는 카드
                        if (!card.hasData) {
                          return (
                            <div key={card.cardId} className="relative p-4 rounded-xl border border-gray-100 bg-gray-50/30">
                              <div className="text-xs text-gray-400 mb-2">{card.label}</div>
                              <div className="text-lg font-bold text-gray-200">-</div>
                              <span className="absolute top-2 right-2 text-[9px] text-gray-300 bg-gray-100 px-1.5 py-0.5 rounded-md">N/A</span>
                            </div>
                          );
                        }

                        // distribution 타입 — 프로그레스 바 시각화
                        if (card.type === 'distribution' && Array.isArray(card.value)) {
                          const items = card.value.slice(0, 3);
                          const maxCount = Math.max(...items.map(it => it.count), 1);
                          return (
                            <div
                              key={card.cardId}
                              onClick={() => setDetailCard(card)}
                              className="p-4 rounded-xl border border-gray-100 hover:shadow-md hover:-translate-y-0.5 hover:border-violet-200 cursor-pointer transition-all"
                            >
                              <div className="flex items-center gap-2 mb-3">
                                <div className={`w-7 h-7 rounded-lg ${color.iconBg} flex items-center justify-center`}>
                                  <IconComp className={`w-3.5 h-3.5 ${color.accent}`} />
                                </div>
                                <span className="text-[11px] text-gray-500 font-medium">{card.label}</span>
                              </div>
                              <div className="space-y-2">
                                {items.map((item, j) => (
                                  <div key={j}>
                                    <div className="flex justify-between text-[11px] mb-0.5">
                                      <span className="text-gray-500 truncate max-w-[60%]">{item.label}</span>
                                      <span className="font-semibold text-gray-800">{item.count.toLocaleString()}</span>
                                    </div>
                                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                      <div className={`h-full ${color.barColor} rounded-full transition-all duration-500`} style={{ width: `${(item.count / maxCount) * 100}%` }} />
                                    </div>
                                  </div>
                                ))}
                                {items.length === 0 && <div className="text-[11px] text-gray-300 text-center py-2">-</div>}
                              </div>
                            </div>
                          );
                        }

                        // count / rate / sum 타입 — 숫자 카드
                        const numVal = typeof card.value === 'number' ? card.value : 0;
                        let displayVal = numVal.toLocaleString();
                        let suffix = '';
                        if (card.type === 'rate') { displayVal = numVal.toFixed(1); suffix = '%'; }
                        else if (card.type === 'sum') { displayVal = numVal >= 10000 ? `${Math.round(numVal / 10000).toLocaleString()}만` : numVal.toLocaleString(); suffix = '원'; }
                        else if (card.cardId === 'active_campaigns') { suffix = '건'; }
                        else { suffix = '명'; }

                        return (
                          <div
                            key={card.cardId}
                            onClick={() => setDetailCard(card)}
                            className="p-4 rounded-xl border border-gray-100 hover:shadow-md hover:-translate-y-0.5 hover:border-violet-200 cursor-pointer transition-all"
                          >
                            <div className="flex items-center gap-2 mb-3">
                              <div className={`w-8 h-8 rounded-xl ${color.iconBg} flex items-center justify-center`}>
                                <IconComp className={`w-4 h-4 ${color.accent}`} />
                              </div>
                              <span className="text-[11px] text-gray-400">{card.label}</span>
                            </div>
                            <div className="text-2xl font-bold text-gray-900 tracking-tight">
                              {displayVal}<span className="text-sm font-normal text-gray-400 ml-0.5">{suffix}</span>
                            </div>
                            {/* ★ D132 Phase A: 델타 뱃지 — 30일 전 동일 시점 대비 증감 */}
                            {card.hasTrend && card.delta !== null && card.delta !== undefined && (
                              <div className="mt-2 flex items-center gap-1.5">
                                <DeltaBadge delta={card.delta} deltaPercent={card.deltaPercent} baseline={card.deltaBaseline} suffix={suffix} />
                                <span className="text-[10px] text-gray-400">지난달 대비</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* 페이지 인디케이터 + 좌우 화살표 */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4">
                        <button
                          onClick={() => setDbCardPage(p => Math.max(0, p - 1))}
                          disabled={safePage === 0}
                          className="w-7 h-7 rounded-full flex items-center justify-center text-green-600 hover:bg-green-50 disabled:opacity-20 disabled:hover:bg-transparent transition-colors"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="flex items-center gap-1.5">
                          {Array.from({ length: totalPages }, (_, idx) => (
                            <button
                              key={idx}
                              onClick={() => setDbCardPage(idx)}
                              className={`h-1.5 rounded-full transition-all duration-300 ${
                                idx === safePage ? 'bg-gray-800 w-5' : 'bg-gray-200 w-1.5 hover:bg-gray-400'
                              }`}
                            />
                          ))}
                        </div>
                        <button
                          onClick={() => setDbCardPage(p => Math.min(totalPages - 1, p + 1))}
                          disabled={safePage >= totalPages - 1}
                          className="w-7 h-7 rounded-full flex items-center justify-center text-green-600 hover:bg-green-50 disabled:opacity-20 disabled:hover:bg-transparent transition-colors"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ===== 우측 40%: 버튼 3개 세로 스택 ===== */}
          <div className="w-[40%] flex flex-col gap-4">
            {hideAi ? (
              <>
                <button 
                  onClick={() => { setShowDirectTargeting(true); }}
                  className="p-5 bg-amber-500 hover:bg-amber-600 rounded-xl transition-all hover:shadow-lg text-right flex-1 flex flex-col justify-between"
                >
                  <div>
                    <div className="text-xl font-bold text-white mb-1">직접 타겟 발송</div>
                    <div className="text-sm text-amber-100">원하는 고객을 직접 필터링</div>
                  </div>
                  <div className="text-3xl text-amber-200 self-end">→</div>
                </button>
                {!hideFileUpload && (
                <button 
                  onClick={() => openFileUpload()}
                  className="p-5 bg-slate-600 hover:bg-slate-700 rounded-xl transition-all hover:shadow-lg text-right flex-1 flex flex-col justify-between"
                >
                  <div>
                    <div className="text-xl font-bold text-white mb-1">고객 DB 업로드</div>
                    <div className="text-sm text-slate-200">엑셀/CSV로 고객 추가</div>
                  </div>
                  <div className="text-3xl text-slate-300 self-end">→</div>
                </button>
                )}
              </>
            ) : (
              <>
                {/* AI 추천 발송 */}
                <button
                  onClick={async () => {
                    if (isSubscriptionLocked) { setShowSubscriptionLock(true); return; }
                    // D53: AI 발송 게이팅
                    if (isAiMessagingLocked) { setPlanUpgradeFeature('AI 추천 발송'); setPlanUpgradeRequired('베이직'); setShowPlanUpgradeModal(true); return; }
                    setShowAiSendType(true);
                    try {
                      const token = localStorage.getItem('token');
                      const settingsRes = await fetch('/api/companies/settings', {
                        headers: { Authorization: `Bearer ${token}` }
                      });
                      if (settingsRes.ok) {
                        const settingsData = await settingsRes.json();
                        if (settingsData.reject_number) setOptOutNumber(settingsData.reject_number);
                      }
                      const cbRes = await fetch('/api/companies/callback-numbers', {
                        headers: { Authorization: `Bearer ${token}` }
                      });
                      const cbData = await cbRes.json();
                      if (cbData.success) {
                        setCallbackNumbers(cbData.numbers || []);
                        const defaultCb = cbData.numbers?.find((n: any) => n.is_default);
                        if (defaultCb) setSelectedCallback(defaultCb.phone);
                      }
                    } catch (err) {
                      console.error('회신번호 로드 실패:', err);
                    }
                  }}
                  disabled={aiLoading}
                  className={`p-5 bg-green-700 hover:bg-green-800 rounded-xl transition-all hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed text-right flex-1 flex flex-col justify-between relative ${isSubscriptionLocked || isAiMessagingLocked ? 'opacity-60' : ''}`}
                >
                  <div className="absolute -top-2 right-3 bg-white text-green-700 text-xs font-bold px-2 py-0.5 rounded-full shadow">
                    MAIN
                  </div>
                  {aiLoading ? (
                    <>
                      <div>
                        <div className="text-xl font-bold text-white mb-1">AI 분석 중...</div>
                        <div className="text-sm text-green-200">잠시만 기다려주세요</div>
                      </div>
                      <div className="text-3xl text-green-300 self-end animate-pulse">⏳</div>
                    </>
                  ) : (
                    <>
                      <div>
                        <div className="text-xl font-bold text-white mb-1">{(isSubscriptionLocked || isAiMessagingLocked) ? '🔒 ' : ''}AI 추천 발송</div>
                        <div className="text-sm text-green-200">자연어로 AI가 자동 설계</div>
                      </div>
                      <div className="text-3xl text-green-300 self-end">→</div>
                    </>
                  )}
                </button>

                {/* 직접 타겟 발송 */}
                <button
                  onClick={() => {
                    if (isSubscriptionLocked) { setShowSubscriptionLock(true); return; }
                    // D53: 고객DB 게이팅 (직접타겟은 고객DB 필요)
                    if (isCustomerDbLocked) { setPlanUpgradeFeature('직접 타겟 발송'); setPlanUpgradeRequired('스타터'); setShowPlanUpgradeModal(true); return; }
                    setShowDirectTargeting(true);
                  }}
                  className={`p-5 bg-amber-500 hover:bg-amber-600 rounded-xl transition-all hover:shadow-lg text-right flex-1 flex flex-col justify-between ${isSubscriptionLocked || isCustomerDbLocked ? 'opacity-60' : ''}`}
                >
                  <div>
                    <div className="text-xl font-bold text-white mb-1">{(isSubscriptionLocked || isCustomerDbLocked) ? '🔒 ' : ''}직접 타겟 발송</div>
                    <div className="text-sm text-amber-100">원하는 고객을 직접 필터링</div>
                  </div>
                  <div className="text-3xl text-amber-200 self-end">→</div>
                </button>

                {/* 고객 DB 업로드 */}
                <button
                  onClick={() => {
                    // v1.5.0: 싱크 사용 중 최우선 차단
                    if (syncBlockActive) { setShowSyncActiveBlock(true); return; }
                    if (isSubscriptionLocked) { setShowSubscriptionLock(true); return; }
                    // D53: 고객DB 게이팅
                    if (isCustomerDbLocked) { setPlanUpgradeFeature('고객 DB 업로드'); setPlanUpgradeRequired('스타터'); setShowPlanUpgradeModal(true); return; }
                    setShowFileUpload(true);
                  }}
                  className={`p-5 bg-slate-600 hover:bg-slate-700 rounded-xl transition-all hover:shadow-lg text-right flex-1 flex flex-col justify-between ${isSubscriptionLocked || isCustomerDbLocked ? 'opacity-60' : ''}`}
                >
                  <div>
                    <div className="text-xl font-bold text-white mb-1">{(isSubscriptionLocked || isCustomerDbLocked) ? '🔒 ' : ''}고객 DB 업로드</div>
                    <div className="text-sm text-slate-200">엑셀/CSV로 고객 추가</div>
                  </div>
                  <div className="text-3xl text-slate-300 self-end">→</div>
                </button>
              </>
            )}
          </div>
        </div>

        {/* 탭 */}
        <div className="bg-transparent rounded-lg mb-4">
        <div className="flex border-b hidden">
            <button
              onClick={() => setActiveTab('target')}
              className={`px-6 py-4 text-sm font-medium ${
                activeTab === 'target'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              1. 타겟 추출
            </button>
            <button
              onClick={() => setActiveTab('campaign')}
              className={`px-6 py-4 text-sm font-medium ${
                activeTab === 'campaign'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              2. 캠페인 설정
            </button>
            <button
              onClick={() => setActiveTab('send')}
              className={`px-6 py-4 text-sm font-medium ${
                activeTab === 'send'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              3. 발송
            </button>
            </div>

            <div className="px-4 pt-1 pb-4">
             {/* 타겟 추출 탭 */}
            {activeTab === 'target' && (
              <div>
{/* 5개 기능 카드 */}
<div className="grid grid-cols-4 gap-4">
                  {/* 최근 캠페인 */}
                  <div onClick={() => { if (isSubscriptionLocked) { setShowSubscriptionLock(true); return; } loadRecentCampaigns(); setShowRecentCampaigns(true); }} className={`bg-white/50 shadow-sm rounded-xl p-6 min-h-[140px] cursor-pointer hover:shadow-lg transition-all text-center border border-green-200 ${isSubscriptionLocked ? 'opacity-60' : ''}`}>
                    <BarChart3 className="w-8 h-8 mx-auto mb-3 text-green-700" />
                    <div className="font-semibold text-gray-800 mb-1">{isSubscriptionLocked ? '🔒 ' : ''}최근 캠페인</div>
                    <div className="text-xs text-gray-500 mb-3">최근 발송 내역</div>
                    <div className="text-xl font-bold text-green-700">{recentCampaigns.length}건</div>
                  </div>

                  {/* AI 발송 템플릿 — AI 기능이므로 ai_messaging 잠금도 체크 (CT-17) */}
                  <div onClick={() => { if (isSubscriptionLocked || isAiMessagingLocked) { setShowSubscriptionLock(true); return; } setShowTemplates(true); }} className={`bg-white/50 shadow-sm rounded-xl p-6 min-h-[140px] cursor-pointer hover:shadow-lg transition-all text-center border border-green-200 ${(isSubscriptionLocked || isAiMessagingLocked) ? 'opacity-60' : ''}`}>
                    <Sparkles className="w-8 h-8 mx-auto mb-3 text-green-600" />
                    <div className="font-semibold text-gray-800 mb-1">{(isSubscriptionLocked || isAiMessagingLocked) ? '🔒 ' : ''}AI 발송 템플릿</div>
                    <div className="text-xs text-gray-500 mb-3">저장 & 바로 실행</div>
                    <div className="text-xl font-bold text-green-700">관리</div>
                  </div>

                  {/* AI 분석 (발송 성과 + 예시 리포트) */}
                  <div onClick={() => { setShowAnalysis(true); }} className={`bg-white/50 shadow-sm rounded-xl p-6 min-h-[140px] cursor-pointer hover:shadow-lg transition-all text-center border border-green-200 relative overflow-hidden`}>
                    <Sparkles className="w-8 h-8 mx-auto mb-3 text-amber-500" />
                    <div className="font-semibold text-gray-800 mb-1">AI 분석</div>
                    <div className="text-xs text-gray-500 mb-2">성과 분석 리포트</div>
                    <div className="text-xs text-gray-400 leading-relaxed" style={{ WebkitMaskImage: 'linear-gradient(to bottom, black 40%, transparent)', maskImage: 'linear-gradient(to bottom, black 40%, transparent)' }}>
                      화요일 오전 10시 발송이 가장 효과적...
                    </div>
                    <div className="absolute bottom-2 left-0 right-0 text-[10px] text-amber-600 font-medium">예시 리포트 보기 →</div>
                  </div>

                  {/* 예약 대기 */}
                  <div onClick={() => { if (isSubscriptionLocked) { setShowSubscriptionLock(true); return; } loadScheduledCampaigns(); setShowScheduled(true); }} className={`bg-white/50 shadow-sm rounded-xl p-6 min-h-[140px] cursor-pointer hover:shadow-lg transition-all text-center border border-amber-200 ${isSubscriptionLocked ? 'opacity-60' : ''}`}>
                    <Clock className="w-8 h-8 mx-auto mb-3 text-amber-500" />
                    <div className="font-semibold text-gray-800 mb-1">{isSubscriptionLocked ? '🔒 ' : ''}예약 대기</div>
                    <div className="text-xs text-gray-500 mb-3">곧 발송될 캠페인</div>
                    <div className="text-xl font-bold text-amber-600">{scheduledCampaigns.length}건</div>
                  </div>
                </div>
              </div>
            )}
            {/* 캠페인 설정 탭 */}
            {activeTab === 'campaign' && (
              <div>
                <h3 className="text-lg font-semibold mb-4">캠페인 설정</h3>
                
                {/* 캠페인 컨텍스트 표시 */}
                {campaignContext && (
                  <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                    <span className="text-sm text-purple-700">
                      📌 마케팅 목표: {campaignContext}
                    </span>
                  </div>
                )}

                <div className="space-y-4 max-w-2xl">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      캠페인명 *
                    </label>
                    <input
                      type="text"
                      value={campaign.campaignName}
                      onChange={(e) => setCampaign({ ...campaign, campaignName: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      placeholder="예: 1월 VIP 프로모션"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      메시지 유형
                    </label>
                    <select
                      value={campaign.messageType}
                      onChange={(e) => setCampaign({ ...campaign, messageType: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="SMS">SMS (단문)</option>
                      <option value="LMS">LMS (장문)</option>
                      <option value="MMS">MMS (사진)</option>
                    </select>
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-sm font-medium text-gray-700">
                        메시지 내용 *
                      </label>
                      <button
                        onClick={() => setShowAiMessage(true)}
                        className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded text-sm font-medium flex items-center gap-1"
                      >
                        ✨ AI 문구 생성
                      </button>
                    </div>
                    <textarea
                      value={campaign.messageContent}
                      onChange={(e) => setCampaign({ ...campaign, messageContent: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg h-32"
                      placeholder="메시지 내용을 입력하세요..."
                    />
                    <div className="text-right text-sm text-gray-500 mt-1">
                      {campaign.messageContent.length}/90자 (SMS 기준)
                    </div>
                  </div>

                  {/* AI 메시지 생성 모달 */}
                  {showAiMessage && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                      <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
                        <h4 className="text-lg font-semibold mb-4">✨ AI 문구 생성</h4>
                        
                        {aiMessages.length === 0 ? (
                          <>
                            <p className="text-sm text-gray-600 mb-4">
                              어떤 메시지를 보내고 싶은지 설명해주세요.
                            </p>
                            <textarea
                              value={aiPrompt || campaignContext}
                              onChange={(e) => setAiPrompt(e.target.value)}
                              className="w-full px-3 py-2 border rounded-lg h-24 mb-4"
                              placeholder="예: 신규 고객 대상 20% 할인 쿠폰 안내"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setShowAiMessage(false);
                                  setAiPrompt('');
                                }}
                                className="flex-1 px-4 py-2 border rounded-lg text-gray-600"
                              >
                                취소
                              </button>
                              <button
                                onClick={handleAiGenerateMessage}
                                disabled={aiLoading}
                                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
                              >
                                {aiLoading ? '생성 중...' : 'AI 문구 생성'}
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="text-sm text-gray-600 mb-4">
                              AI가 생성한 문구 중 하나를 선택하세요.
                            </p>
                            <div className="space-y-4 mb-4">
                              {aiMessages.map((msg, idx) => (
                                <div
                                  key={idx}
                                  className="border rounded-lg p-4 hover:border-purple-500 cursor-pointer"
                                  onClick={() => handleSelectAiMessage(msg)}
                                >
                                  <div className="flex justify-between items-start mb-2">
                                    <span className="font-medium text-purple-600">
                                      {msg.variant_id}. {msg.variant_name}
                                    </span>
                                    <span className="text-sm text-gray-500">
                                      점수: {msg.score}
                                    </span>
                                  </div>
                                  <p className="text-sm text-gray-600 mb-2">{msg.concept}</p>
                                  <div className="bg-gray-50 p-2 rounded text-sm">
                                    {campaign.messageType === 'SMS' ? msg.sms_text : msg.lms_text}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <button
                              onClick={() => {
                                setAiMessages([]);
                                setAiPrompt('');
                              }}
                              className="w-full px-4 py-2 border rounded-lg text-gray-600"
                            >
                              다시 생성하기
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={campaign.isAd}
                        onChange={(e) => setCampaign({ ...campaign, isAd: e.target.checked })}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-700">광고성 메시지 (앞에 [광고] 자동 추가)</span>
                    </label>
                  </div>

                  <button
                    onClick={handleCreateCampaign}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium"
                  >
                    캠페인 생성
                  </button>
                </div>
              </div>
            )}

            {/* 발송 탭 */}
            {activeTab === 'send' && (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">📤</div>
                <h3 className="text-lg font-semibold mb-2">발송 준비 완료</h3>
                <p className="text-gray-500 mb-6">
                  캠페인 목록에서 발송할 캠페인을 선택하세요
                </p>
                <button
                  onClick={() => setToast({ show: true, type: 'error', message: '캠페인 목록 페이지로 이동 (개발 예정)' })}
                  className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-lg font-medium"
                >
                  캠페인 발송하기
                </button>
              </div>
            )}
          </div>
        </div>
        <AiCampaignResultPopup
          show={showAiResult}
          onClose={() => setShowAiResult(false)}
          aiStep={aiStep}
          setAiStep={setAiStep}
          aiResult={aiResult}
          setAiResult={setAiResult}
          selectedChannel={selectedChannel}
          setSelectedChannel={setSelectedChannel}
          selectedAiMsgIdx={selectedAiMsgIdx}
          setSelectedAiMsgIdx={setSelectedAiMsgIdx}
          editingAiMsg={editingAiMsg}
          setEditingAiMsg={setEditingAiMsg}
          isAd={isAd}
          setIsAd={setIsAd}
          user={user}
          aiLoading={aiLoading}
          handleAiGenerateChannelMessage={handleAiGenerateChannelMessage}
          testSentResult={testSentResult}
          testSending={testSending}
          testCooldown={testCooldown}
          handleTestSend={handleTestSend}
          setShowPreview={setShowPreview}
          setShowAiSendModal={setShowAiSendModal}
          setShowSpamFilter={setShowSpamFilter}
          setSpamFilterData={setSpamFilterData}
          setShowMmsUploadModal={setShowMmsUploadModal}
          mmsUploadedImages={mmsUploadedImages}
          setMmsUploadedImages={setMmsUploadedImages}
          wrapAdText={wrapAdText}
          calculateBytes={calculateBytes}
          optOutNumber={optOutNumber}
          selectedCallback={selectedCallback}
          campaign={campaign}
          formatRejectNumber={formatRejectNumber}
          targetRecipients={targetRecipients}
          sampleCustomer={sampleCustomer}
        />
        <AiPreviewModal
          show={showPreview}
          onClose={() => setShowPreview(false)}
          aiResult={aiResult}
          selectedChannel={selectedChannel}
          selectedAiMsgIdx={selectedAiMsgIdx}
          useIndividualCallback={useIndividualCallback}
          selectedCallback={selectedCallback}
          mmsUploadedImages={mmsUploadedImages}
          testSentResult={testSentResult}
          testSending={testSending}
          testCooldown={testCooldown}
          handleTestSend={handleTestSend}
          setShowAiSendModal={setShowAiSendModal}
          wrapAdText={wrapAdText}
          formatRejectNumber={formatRejectNumber}
          sampleCustomer={sampleCustomer}
          setSpamFilterData={setSpamFilterData}
          setShowSpamFilter={setShowSpamFilter}
          optOutNumber={optOutNumber}
          isAd={isAd}
        />
        <CampaignSuccessModal
          show={showSuccess}
          onClose={() => { setShowSuccess(false); setLastSendConfig(null); }}
          onShowCalendar={() => { setShowSuccess(false); setShowCalendar(true); }}
          selectedChannel={successChannel || selectedChannel}
          aiResult={aiResult}
          successSendInfo={successSendInfo}
          overrideTargetCount={successTargetCount || undefined}
          overrideUnsubscribeCount={successUnsubscribeCount || undefined}
          canSaveSegment={!!lastSendConfig}
          onSaveSegment={async (name: string, emoji: string) => {
            if (!lastSendConfig) return;
            const res = await fetch('/api/saved-segments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
              body: JSON.stringify({
                name,
                emoji,
                segmentType: lastSendConfig.type,
                prompt: lastSendConfig.prompt,
                autoRelax: lastSendConfig.autoRelax,
                selectedFields: lastSendConfig.selectedFields,
                briefing: lastSendConfig.briefing,
                url: lastSendConfig.url,
                channel: lastSendConfig.channel,
                isAd: lastSendConfig.isAd,
              }),
            });
            const data = await res.json();
            if (!data.success) {
              setToast({ show: true, type: 'error', message: data.error || '세그먼트 저장에 실패했습니다.' });
              throw new Error(data.error);
            }
          }}
        />
        {showResults && <ResultsModal onClose={() => setShowResults(false)} token={localStorage.getItem('token')} customerDbEnabled={planInfo?.customer_db_enabled} isSubscriptionLocked={isSubscriptionLocked} onFeatureLocked={(name, plan) => { /* 업그레이드 모달 등 */ }} onSubscriptionLocked={() => setShowSubscriptionLock(true)} />}
        {showCustomerDB && <CustomerDBModal onClose={() => setShowCustomerDB(false)} token={localStorage.getItem('token')} userType={user?.userType} />}
        {showCalendar && <CalendarModal onClose={() => setShowCalendar(false)} token={localStorage.getItem('token')} onEdit={(campaign) => {
          setShowCalendar(false);
          if (campaign._clone) {
            // 복제: AI 프롬프트에 캠페인 내용 복사
            setAiCampaignPrompt(campaign.description || campaign.campaign_name || '');
          } else {
            // 편집: 예약 캠페인이면 취소 안내
            setToast({ show: true, type: 'error', message: `예약 캠페인을 편집하려면 예약 대기 목록에서 취소 후 재생성해주세요. (캠페인: ${campaign.campaign_name})` });
          }
        }} />}

        <MmsUploadModal
          show={showMmsUploadModal}
          onClose={() => setShowMmsUploadModal(false)}
          mmsUploadedImages={mmsUploadedImages}
          mmsUploading={mmsUploading}
          handleMmsSlotUpload={handleMmsSlotUpload}
          handleMmsMultiUpload={handleMmsMultiUpload}
          handleMmsImageRemove={handleMmsImageRemove}
          setTargetMsgType={setTargetMsgType}
          setDirectMsgType={setDirectMsgType}
          setSelectedChannel={setSelectedChannel}
        />
        
        <RecentCampaignModal show={showRecentCampaigns} onClose={() => setShowRecentCampaigns(false)} recentCampaigns={recentCampaigns} />

        <RecommendTemplateModal
          show={showTemplates}
          onClose={() => setShowTemplates(false)}
          onSelectHanjullo={(prompt, autoRelax) => {
            setShowTemplates(false);
            setAiCampaignPrompt(prompt);
            handleAiCampaignGenerate(prompt, autoRelax);
          }}
          onSelectCustom={(preloadData) => {
            setShowTemplates(false);
            setCustomFlowPreload(preloadData);
            setShowAiCustomFlow(true);
          }}
        />
                            {/* 파일 업로드 캠페인 모달 */}
        {/* 직접 타겟 설정 모달 (D43-3: 컴포넌트 분리) */}
        <DirectTargetFilterModal
          show={showDirectTargeting}
          onClose={() => { setShowDirectTargeting(false); setCardTargetFilters(undefined); }}
          onExtracted={handleTargetExtracted}
          initialFilters={cardTargetFilters}
        />

        {/* ★ D132 Phase B: 대시보드 카드 클릭 → 상세 모달 */}
        <CardDetailModal
          card={detailCard}
          onClose={() => setDetailCard(null)}
          onTargetSend={(filters) => {
            setCardTargetFilters(filters);
            setShowDirectTargeting(true);
          }}
        />

        <FileUploadMappingModal
          show={showFileUpload}
          onClose={() => setShowFileUpload(false)}
          onSaveStart={handleUploadSaveStart}
          onPlanLimitExceeded={handleUploadPlanLimit}
        />
        <CustomerInsightModal show={showInsights} onClose={() => setShowInsights(false)} stats={stats} />

        <TodayStatsModal show={showTodayStats} onClose={() => setShowTodayStats(false)} stats={stats} recentCampaignsCount={recentCampaigns.length} />
      
      <UploadProgressModal
        show={showUploadProgressModal}
        uploadProgress={uploadProgress}
        onClose={() => setShowUploadProgressModal(false)}
      />
      <PlanLimitModal show={showPlanLimitError} onClose={() => setShowPlanLimitError(false)} planLimitInfo={planLimitInfo} />

        <ScheduledCampaignModal
          show={showScheduled}
          onClose={() => setShowScheduled(false)}
          scheduledCampaigns={scheduledCampaigns}
          setScheduledCampaigns={setScheduledCampaigns}
          setToast={setToast}
        />
      </main>
      <UploadResultModal
        show={showUploadResult}
        uploadResult={uploadResult}
        onClose={() => { setShowUploadResult(false); window.location.reload(); }}
      />
      {/* 직접 타겟 발송 모달 (D43-3c: TargetSendModal 컴포넌트 분리) */}
      <TargetSendModal
        show={showTargetSend}
        onClose={() => { setShowTargetSend(false); setTargetRecipients([]); setTargetMessage(''); setTargetSubject(''); setKakaoMessage(''); setTargetSendChannel('sms'); }}
        fieldsMeta={targetFieldsMeta}
        targetRecipients={targetRecipients}
        setTargetRecipients={setTargetRecipients}
        targetSendChannel={targetSendChannel}
        setTargetSendChannel={setTargetSendChannel}
        targetMsgType={targetMsgType}
        setTargetMsgType={setTargetMsgType}
        targetSubject={targetSubject}
        setTargetSubject={setTargetSubject}
        targetMessage={targetMessage}
        setTargetMessage={setTargetMessage}
        kakaoMessage={kakaoMessage}
        setKakaoMessage={setKakaoMessage}
        kakaoEnabled={kakaoEnabled}
        kakaoTemplates={kakaoTemplates}
        kakaoSelectedTemplate={kakaoSelectedTemplate}
        setKakaoSelectedTemplate={setKakaoSelectedTemplate}
        kakaoTemplateVars={kakaoTemplateVars}
        setKakaoTemplateVars={setKakaoTemplateVars}
        alimtalkFallback={alimtalkFallback}
        setAlimtalkFallback={setAlimtalkFallback}
        alimtalkSenders={alimtalkSenders}
        alimtalkProfileId={alimtalkProfileId}
        setAlimtalkProfileId={setAlimtalkProfileId}
        alimtalkNextContents={alimtalkNextContents}
        setAlimtalkNextContents={setAlimtalkNextContents}
        selectedCallback={selectedCallback}
        setSelectedCallback={setSelectedCallback}
        useIndividualCallback={useIndividualCallback}
        setUseIndividualCallback={setUseIndividualCallback}
        individualCallbackColumn={individualCallbackColumn}
        setIndividualCallbackColumn={setIndividualCallbackColumn}
        callbackNumbers={callbackNumbers}
        phoneFields={phoneFields}
        adTextEnabled={adTextEnabled}
        handleAdToggle={handleAdToggle}
        optOutNumber={optOutNumber}
        reserveEnabled={reserveEnabled}
        setReserveEnabled={setReserveEnabled}
        reserveDateTime={reserveDateTime}
        setShowReservePicker={setShowReservePicker}
        splitEnabled={splitEnabled}
        setSplitEnabled={setSplitEnabled}
        splitCount={splitCount}
        setSplitCount={setSplitCount}
        mmsUploadedImages={mmsUploadedImages}
        setMmsUploadedImages={setMmsUploadedImages}
        setShowMmsUploadModal={setShowMmsUploadModal}
        formatPhoneNumber={formatPhoneNumber}
        formatRejectNumber={formatRejectNumber}
        calculateBytes={calculateBytes}
        setToast={setToast}
        setShowDirectPreview={setShowDirectPreview}
        setDirectMessage={setDirectMessage}
        setDirectMsgType={setDirectMsgType}
        setDirectSubject={setDirectSubject}
        setSpamFilterData={setSpamFilterData}
        setShowSpamFilter={setShowSpamFilter}
        handleAiMsgHelper={handleAiMsgHelper}
        setShowSpecialChars={setShowSpecialChars}
        loadTemplates={loadTemplates}
        setShowTemplateBox={setShowTemplateBox}
        setShowTemplateSave={setShowTemplateSave}
        setTemplateSaveName={setTemplateSaveName}
        smsOverrideAccepted={smsOverrideAccepted}
        setSmsOverrideAccepted={setSmsOverrideAccepted}
        setPendingBytes={setPendingBytes}
        setShowLmsConfirm={setShowLmsConfirm}
        setShowSmsConvert={setShowSmsConvert}
        lmsKeepAccepted={lmsKeepAccepted}
        setLmsKeepAccepted={setLmsKeepAccepted}
        setSendConfirm={setSendConfirm}
        targetSending={targetSending}
        onResetTarget={() => { setShowTargetSend(false); setShowDirectTargeting(true); }}
        handleTargetTestSend={handleTargetTestSend}
        testSending={testSending}
        testCooldown={testCooldown}
        testSentResult={testSentResult}
      />

      {/* 예약전송 달력 모달 (공용) */}
      {showReservePicker && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl shadow-2xl w-[360px] overflow-hidden">
            <div className="bg-blue-50 px-5 py-4 border-b">
              <h3 className="text-lg font-bold text-blue-700">📅 예약 시간 설정</h3>
            </div>
            <div className="p-5">
              {/* 빠른 선택 */}
              <div className="mb-4">
                <div className="text-xs text-gray-500 mb-2">빠른 선택</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: '1시간 후', hours: 1 },
                    { label: '3시간 후', hours: 3 },
                    { label: '내일 오전 9시', tomorrow: 9 },
                  ].map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => {
                        const d = new Date();
                        if (opt.hours) {
                          d.setHours(d.getHours() + opt.hours);
                        } else if (opt.tomorrow) {
                          d.setDate(d.getDate() + 1);
                          d.setHours(opt.tomorrow, 0, 0, 0);
                        }
                        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                        setReserveDateTime(local);
                      }}
                      className="py-2 px-2 text-xs border rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* 직접 선택 */}
              <div>
                <div className="flex gap-4">
                  {/* 날짜 */}
                  <div className="flex-1">
                    <div className="text-xs text-gray-500 mb-2">날짜</div>
                    <input
                      type="date"
                      value={reserveDateTime?.split('T')[0] || ''}
                      onChange={(e) => {
                        const time = reserveDateTime?.split('T')[1] || '09:00';
                        setReserveDateTime(`${e.target.value}T${time}`);
                      }}
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-blue-400 focus:outline-none"
                    />
                  </div>
                  {/* 시간 */}
                  <div className="flex-1">
                    <div className="text-xs text-gray-500 mb-2">시간</div>
                    <div className="flex items-center gap-1">
                      <select
                        value={reserveDateTime?.split('T')[1]?.split(':')[0] || '09'}
                        onChange={(e) => {
                          const date = reserveDateTime?.split('T')[0] || new Date().toISOString().split('T')[0];
                          const minute = reserveDateTime?.split('T')[1]?.split(':')[1] || '00';
                          setReserveDateTime(`${date}T${e.target.value}:${minute}`);
                        }}
                        className="w-[70px] border-2 border-gray-200 rounded-lg px-1 py-2.5 text-sm text-center focus:border-blue-400 focus:outline-none bg-white cursor-pointer"
                      >
                        {Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0')).map(h => (
                          <option key={h} value={h}>{h}시</option>
                        ))}
                      </select>
                      <span className="text-lg font-bold text-gray-400">:</span>
                      <select
                        value={reserveDateTime?.split('T')[1]?.split(':')[1] || '00'}
                        onChange={(e) => {
                          const date = reserveDateTime?.split('T')[0] || new Date().toISOString().split('T')[0];
                          const hour = reserveDateTime?.split('T')[1]?.split(':')[0] || '09';
                          setReserveDateTime(`${date}T${hour}:${e.target.value}`);
                        }}
                        className="w-[70px] border-2 border-gray-200 rounded-lg px-1 py-2.5 text-sm text-center focus:border-blue-400 focus:outline-none bg-white cursor-pointer"
                      >
                        {Array.from({ length: 12 }, (_, i) => (i * 5).toString().padStart(2, '0')).map(m => (
                          <option key={m} value={m}>{m}분</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
              {/* 선택된 시간 표시 */}
              {reserveDateTime && (
                <div className="mt-4 p-3 bg-blue-50 rounded-lg text-center">
                  <span className="text-sm text-gray-600">예약 시간: </span>
                  <span className="text-sm font-bold text-blue-700">
                    {new Date(reserveDateTime).toLocaleString('ko-KR', {
                      timeZone: 'Asia/Seoul',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
              )}
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t flex gap-2">
              <button
                onClick={() => {
                  setShowReservePicker(false);
                  setReserveEnabled(false);
                  setReserveDateTime('');
                }}
                className="flex-1 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-100"
              >
                취소
              </button>
              <button
                onClick={() => {
                  if (!reserveDateTime) {
                    setToast({ show: true, type: 'error', message: '예약 시간을 선택해주세요' });
                    return;
                  }
                  setShowReservePicker(false);
                }}
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ★ D96: 직접발송 패널 — DirectSendPanel.tsx로 분리 */}
      {showDirectSend && (
        <DirectSendPanel
          directSendChannel={directSendChannel} setDirectSendChannel={setDirectSendChannel}
          directMsgType={directMsgType} setDirectMsgType={setDirectMsgType}
          directSubject={directSubject} setDirectSubject={setDirectSubject}
          directMessage={directMessage} setDirectMessage={setDirectMessage}
          directRecipients={directRecipients} setDirectRecipients={setDirectRecipients}
          messageBytes={messageBytes} maxBytes={maxBytes}
          callbackNumbers={callbackNumbers}
          selectedCallback={selectedCallback} setSelectedCallback={setSelectedCallback}
          useIndividualCallback={useIndividualCallback} setUseIndividualCallback={setUseIndividualCallback}
          individualCallbackColumn={individualCallbackColumn} setIndividualCallbackColumn={setIndividualCallbackColumn}
          adTextEnabled={adTextEnabled} handleAdToggle={handleAdToggle}
          reserveEnabled={reserveEnabled} setReserveEnabled={setReserveEnabled}
          reserveDateTime={reserveDateTime} setShowReservePicker={setShowReservePicker}
          splitEnabled={splitEnabled} setSplitEnabled={setSplitEnabled}
          splitCount={splitCount} setSplitCount={setSplitCount}
          optOutNumber={optOutNumber}
          mmsUploadedImages={mmsUploadedImages} setMmsUploadedImages={setMmsUploadedImages}
          setShowMmsUploadModal={setShowMmsUploadModal}
          isSpamFilterLocked={isSpamFilterLocked} setShowSpamFilterLock={setShowSpamFilterLock}
          setSpamFilterData={setSpamFilterData} setShowSpamFilter={setShowSpamFilter}
          kakaoTemplates={kakaoTemplates}
          kakaoSelectedTemplate={kakaoSelectedTemplate} setKakaoSelectedTemplate={setKakaoSelectedTemplate}
          kakaoTemplateVars={kakaoTemplateVars} setKakaoTemplateVars={setKakaoTemplateVars}
          alimtalkFallback={alimtalkFallback} setAlimtalkFallback={setAlimtalkFallback}
          kakaoMessage={kakaoMessage} setKakaoMessage={setKakaoMessage}
          alimtalkSenders={alimtalkSenders}
          alimtalkProfileId={alimtalkProfileId} setAlimtalkProfileId={setAlimtalkProfileId}
          alimtalkNextContents={alimtalkNextContents} setAlimtalkNextContents={setAlimtalkNextContents}
          rcsTemplates={rcsTemplates}
          rcsSelectedTemplate={rcsSelectedTemplate} setRcsSelectedTemplate={setRcsSelectedTemplate}
          setShowDirectPreview={setShowDirectPreview}
          setShowSpecialChars={setShowSpecialChars}
          setShowTemplateBox={setShowTemplateBox}
          setShowTemplateSave={setShowTemplateSave}
          setTemplateSaveName={setTemplateSaveName}
          loadTemplates={loadTemplates}
          setShowAddressBook={setShowAddressBook}
          setAddressGroups={setAddressGroups}
          onSendConfirm={setSendConfirm}
          setToast={setToast}
          lmsKeepAccepted={lmsKeepAccepted} smsOverrideAccepted={smsOverrideAccepted}
          setPendingBytes={setPendingBytes} setShowLmsConfirm={setShowLmsConfirm}
          setShowSmsConvert={setShowSmsConvert}
          getFullMessage={getFullMessage}
          getMaxByteMessage={getMaxByteMessage}
          formatPhoneNumber={formatPhoneNumber}
          formatRejectNumber={formatRejectNumber}
          onClose={() => { setShowDirectSend(false); setKakaoMessage(''); setDirectSendChannel('sms'); }}
        />
      )}
      {/* 특수문자 모달 (직접발송 + 직접타겟발송 공용) */}
      {showSpecialChars && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]" onClick={() => setShowSpecialChars(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden animate-in fade-in zoom-in" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b bg-purple-50 flex justify-between items-center">
              <h3 className="font-bold text-lg">✨ 특수문자</h3>
              <button onClick={() => setShowSpecialChars(null)} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-8 gap-1.5">
                {/* SMS/LMS 호환 특수문자만 (EUC-KR 인코딩 지원 확인 완료) */}
                {['★','☆','♥','♡','◆','◇','■','□','▲','△','▶','◀','●','○','◎','♤','♠','♧','♣','♪','♬','♩','☎','♨','※','☞','↑','↓','←','→','▷','◁','▽','①','②','③','④','⑤','⑥','⑦','⑧','㈜','㈔','℡','㉿','㎝','㎏','㎡','㎎'].map((char, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      // ★ D124 N3: 컨트롤타워 insertAtCursorOrAppend — 커서 위치 삽입 (fallback: 끝에 붙임)
                      const kind = showSpecialChars; // 'target' | 'direct'
                      const ta = document.querySelector<HTMLTextAreaElement>(`textarea[data-char-target="${kind}"]`);
                      const setter = kind === 'target' ? setTargetMessage : setDirectMessage;
                      insertAtCursorOrAppend(ta, char, setter);
                      setShowSpecialChars(null);
                    }}
                    className="w-10 h-10 flex items-center justify-center text-lg border rounded-lg hover:bg-purple-50 hover:border-purple-300 transition-colors"
                  >
                    {char}
                  </button>
                ))}
              </div>
              <p className="text-xs text-amber-500 mt-3 text-center">✅ SMS/LMS 호환 특수문자만 표시됩니다 (EUC-KR 기준)</p>
            </div>
          </div>
        </div>
      )}

      {/* 보관함 모달 (직접발송 + 직접타겟발송 공용) */}
      {showTemplateBox && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]" onClick={() => setShowTemplateBox(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[500px] max-h-[70vh] overflow-hidden animate-in fade-in zoom-in" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b bg-amber-50 flex justify-between items-center">
              <h3 className="font-bold text-lg">📂 보관함</h3>
              <button onClick={() => setShowTemplateBox(null)} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[50vh]">
              {templateList.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <div className="text-4xl mb-3">📭</div>
                  <div className="text-sm">저장된 문자가 없습니다</div>
                  <div className="text-xs mt-1">메시지 작성 후 '문자저장'을 눌러주세요</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {templateList.map((t: any) => (
                    <div key={t.id} className="border rounded-xl p-4 hover:border-amber-300 hover:bg-amber-50/30 transition-colors group">
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-medium text-sm text-gray-800">{t.template_name}</div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">{t.message_type}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteTemplate(t.id); }}
                            className="text-gray-300 hover:text-red-500 text-sm opacity-0 group-hover:opacity-100 transition-opacity"
                          >🗑️</button>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 mb-3 line-clamp-2 whitespace-pre-wrap">{t.content}</div>
                      <button
                        onClick={() => {
                          if (showTemplateBox === 'target') {
                            setTargetMessage(t.content);
                            if (t.subject) setTargetSubject(t.subject);
                            if (t.message_type) setTargetMsgType(t.message_type);
                          } else {
                            setDirectMessage(t.content);
                            if (t.subject) setDirectSubject(t.subject);
                            if (t.message_type) setDirectMsgType(t.message_type);
                          }
                          // ★ B1(0417 PDF #1): 저장 시점의 광고 체크박스 상태 복원
                          //   t.is_ad === false 만 OFF로, NULL/undefined/true는 ON 유지(레거시 호환)
                          setAdTextEnabled(t.is_ad !== false);
                          // ★ D100: MMS 이미지 복원 — JSON 문자열/배열 양쪽 대응
                          //   DB에 JSON.stringify()로 저장 → 조회 시 string으로 반환 → Array.isArray 실패 → 이미지 미복원
                          // ★ D124 N4: 배열 항목이 객체(신규: {path, originalName}) 또는 문자열(과거) 혼재 → 컨트롤타워 사용
                          let mmsPaths = t.mms_image_paths;
                          if (typeof mmsPaths === 'string') {
                            try { mmsPaths = JSON.parse(mmsPaths); } catch { mmsPaths = null; }
                          }
                          if (t.message_type === 'MMS' && mmsPaths && Array.isArray(mmsPaths)) {
                            setMmsUploadedImages(mmsPaths.map((item: any, i: number) => {
                              const serverPath = getMmsImagePath(item);
                              const originalName = typeof item === 'object' && item?.originalName ? item.originalName : undefined;
                              const apiUrl = mmsServerPathToUrl(serverPath);
                              const filename = getMmsImageDisplayName(item, `image_${i + 1}`);
                              return { serverPath, url: apiUrl, filename, originalName, size: 0 };
                            }));
                          }
                          setShowTemplateBox(null);
                          setToast({ show: true, type: 'success', message: '문자가 적용되었습니다.' });
                          setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
                        }}
                        className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors"
                      >적용하기</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 문자저장 모달 (직접발송 + 직접타겟발송 공용) */}
      {showTemplateSave && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]" onClick={() => setShowTemplateSave(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden animate-in fade-in zoom-in" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b bg-emerald-50 flex justify-between items-center">
              <h3 className="font-bold text-lg">💾 문자 저장</h3>
              <button onClick={() => setShowTemplateSave(null)} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
            </div>
            <div className="p-6">
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">저장할 이름</label>
                <input
                  type="text"
                  value={templateSaveName}
                  onChange={(e) => setTemplateSaveName(e.target.value)}
                  placeholder="예: VIP 할인 안내, 봄 신상품 홍보"
                  className="w-full border-2 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  autoFocus
                />
              </div>
              <div className="mb-4 p-3 bg-gray-50 rounded-xl">
                <div className="text-xs text-gray-400 mb-1">저장될 내용 미리보기</div>
                <div className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-4">
                  {showTemplateSave === 'target' ? targetMessage : directMessage}
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowTemplateSave(null)}
                  className="flex-1 py-3 border-2 rounded-xl text-sm font-medium hover:bg-gray-50"
                >취소</button>
                <button
                  onClick={async () => {
                    if (!templateSaveName.trim()) {
                      setToast({ show: true, type: 'error', message: '이름을 입력해주세요.' });
                      setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
                      return;
                    }
                    const content = showTemplateSave === 'target' ? targetMessage : directMessage;
                    const msgType = showTemplateSave === 'target' ? targetMsgType : directMsgType;
                    const subject = showTemplateSave === 'target' ? targetSubject : directSubject;
                    const imagePaths = msgType === 'MMS' ? toMmsImagePaths(mmsUploadedImages) : undefined;
                    const ok = await saveTemplate(templateSaveName.trim(), content, msgType, subject, imagePaths);
                    if (ok) setShowTemplateSave(null);
                  }}
                  className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-bold transition-colors"
                >💾 저장하기</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AddressBookModal
        show={showAddressBook}
        onClose={() => setShowAddressBook(false)}
        directRecipients={directRecipients}
        setDirectRecipients={setDirectRecipients}
        setToast={setToast}
      />
      <LmsConvertModal
        show={showLmsConfirm}
        onClose={() => setShowLmsConfirm(false)}
        pendingBytes={pendingBytes}
        showTargetSend={showTargetSend}
        targetMessage={targetMessage}
        directMessage={directMessage}
        targetMsgType={targetMsgType}
        directMsgType={directMsgType}
        targetRecipients={targetRecipients}
        directRecipients={directRecipients}
        adTextEnabled={adTextEnabled}
        optOutNumber={optOutNumber}
        onSmsOverride={() => { setSmsOverrideAccepted(true); setShowLmsConfirm(false); }}
        onLmsConvert={() => { if (showTargetSend) { setTargetMsgType('LMS'); } else { setDirectMsgType('LMS'); } setMmsUploadedImages([]); setLmsKeepAccepted(false); setShowLmsConfirm(false); }}
        getMaxByteMessage={getMaxByteMessage}
        calculateBytes={calculateBytes}
        truncateToSmsBytes={truncateToSmsBytes}
      />
      <SmsConvertModal
        show={showSmsConvert.show}
        showSmsConvert={showSmsConvert}
        onClose={() => { setLmsKeepAccepted(true); setShowSmsConvert({show: false, from: 'direct', currentBytes: 0, smsBytes: 0, count: 0}); }}
        onSmsConvert={() => { if (showSmsConvert.from === 'target') { setTargetMsgType('SMS'); } else { setDirectMsgType('SMS'); } setMmsUploadedImages([]); setLmsKeepAccepted(false); setShowSmsConvert({show: false, from: 'direct', currentBytes: 0, smsBytes: 0, count: 0}); }}
      />
        
              <ScheduleTimeModal
                show={showReservePicker}
                reserveDateTime={reserveDateTime}
                setReserveDateTime={setReserveDateTime}
                setReserveEnabled={setReserveEnabled}
                onClose={() => setShowReservePicker(false)}
              />
      <DirectPreviewModal
        show={showDirectPreview}
        onClose={() => setShowDirectPreview(false)}
        directMessage={directMessage}
        directMsgType={directMsgType}
        directSubject={directSubject}
        directRecipients={directRecipients}
        targetRecipients={targetRecipients}
        showTargetSend={showTargetSend}
        selectedCallback={selectedCallback}
        mmsUploadedImages={mmsUploadedImages}
        formatPhoneNumber={formatPhoneNumber}
        calculateBytes={calculateBytes}
        getFullMessage={getFullMessage}
        targetFieldsMeta={targetFieldsMeta}
      />
      <SendConfirmModal
        sendConfirm={sendConfirm}
        setSendConfirm={setSendConfirm}
        directSending={directSending}
        executeDirectSend={executeDirectSend}
        executeTargetSend={executeTargetSend}
      />
      {/* ★ D111 P2: 이름 비어있는 수신자 경고 모달 */}
      <NameEmptyWarningModal
        show={nameEmptyWarning.show}
        emptyCount={nameEmptyWarning.emptyCount}
        totalCount={nameEmptyWarning.totalCount}
        sendType={nameEmptyWarning.sendType}
        isSending={directSending || targetSending}
        onCancel={() => setNameEmptyWarning({ show: false, emptyCount: 0, totalCount: 0, sendType: 'direct' })}
        onConfirm={() => {
          const st = nameEmptyWarning.sendType;
          setNameEmptyWarning({ show: false, emptyCount: 0, totalCount: 0, sendType: 'direct' });
          // 2번째 파라미터 confirmNameEmpty=true로 재호출 → 체크 스킵
          if (st === 'direct') executeDirectSend(undefined, true);
          else if (st === 'target') executeTargetSend(undefined, true);
        }}
      />
      {/* ★ 미등록 회신번호 제외 확인 모달 */}
      <CallbackConfirmModal
        data={callbackConfirm}
        onClose={async () => {
          // ★ D120: 확인 모달 취소 시 미확정 draft 캠페인 완전 삭제 (cancelled 잔류 방지)
          if (pendingAiCampaignId) {
            try {
              const token = localStorage.getItem('token');
              await fetch(`/api/campaigns/${pendingAiCampaignId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
            } catch { /* 이미 없으면 무시 */ }
          }
          setCallbackConfirm(defaultCallbackConfirm);
          setPendingAiCampaignId(null);
        }}
        onConfirm={handleCallbackConfirmSend}
        isSending={directSending || isSending}
      />
      <BalanceModals
        showBalanceModal={showBalanceModal}
        setShowBalanceModal={setShowBalanceModal}
        showChargeModal={showChargeModal}
        setShowChargeModal={setShowChargeModal}
        balanceInfo={balanceInfo}
        showInsufficientBalance={showInsufficientBalance}
        setShowInsufficientBalance={setShowInsufficientBalance}
      />
      <AiMessageSuggestModal
        show={showAiMsgHelper}
        onClose={() => setShowAiMsgHelper(false)}
        aiHelperPrompt={aiHelperPrompt}
        setAiHelperPrompt={setAiHelperPrompt}
        aiHelperLoading={aiHelperLoading}
        aiHelperResults={aiHelperResults}
        aiHelperRecommendation={aiHelperRecommendation}
        onGenerate={generateAiDirectMessage}
        onSelectMessage={selectAiMessage}
        msgType={targetMsgType}
      />

      <PlanUpgradeModal show={showPlanUpgradeModal} onClose={() => setShowPlanUpgradeModal(false)} featureName={planUpgradeFeature} requiredPlan={planUpgradeRequired} />

      <LineGroupErrorModal show={showLineGroupError} onClose={() => setShowLineGroupError(false)} />

      <SubscriptionLockModal show={showSubscriptionLock} onClose={() => setShowSubscriptionLock(false)} />
      {/* v1.5.0: 싱크에이전트 사용 중 차단 모달 (설계서 §4-4) */}
      <SyncActiveBlockModal isOpen={showSyncActiveBlock} onClose={() => setShowSyncActiveBlock(false)} />

      <AnalysisModal
        show={showAnalysis}
        onClose={() => setShowAnalysis(false)}
        analysisLevel={planInfo?.ai_analysis_level || 'none'}
        onActionPrompt={(prompt) => {
          setShowAnalysis(false);
          setAiCampaignPrompt(prompt);
          handleAiCampaignGenerate(prompt);
        }}
      />

      {/* 하단 링크 */}
      <div className="max-w-7xl mx-auto px-4 py-6 mt-8 border-t border-gray-200 text-center text-xs text-gray-400 space-x-3">
        <a href="/privacy" target="_blank" className="hover:text-gray-600 transition">개인정보처리방침</a>
        <span>|</span>
        <a href="/terms" target="_blank" className="hover:text-gray-600 transition">이용약관</a>
        <span>|</span>
        <span>© {new Date().getFullYear()} INVITO</span>
      </div>
    </div>
  );
}