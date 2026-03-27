import { Award, BarChart3, Bell, BellOff, Cake, Clock, CreditCard, DollarSign, HelpCircle, Mail, MapPin, Rocket, Send, ShoppingCart, Sparkles, Store, User, UserPlus, Users, UserX } from 'lucide-react';
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
import SendConfirmModal from '../components/SendConfirmModal';
import SpamFilterLockModal from '../components/SpamFilterLockModal';
import SpamFilterTestModal from '../components/SpamFilterTestModal';
import SubscriptionLockModal from '../components/SubscriptionLockModal';
import TodayStatsModal from '../components/TodayStatsModal';
import UploadProgressModal from '../components/UploadProgressModal';
import UploadResultModal from '../components/UploadResultModal';
import { useAuthStore } from '../stores/authStore';
import { formatDate, formatPreviewValue, calculateSmsBytes, truncateToSmsBytes, DIRECT_VAR_MAP, DIRECT_VAR_TO_FIELD, DIRECT_FIELD_LABELS, DIRECT_MAPPING_FIELDS, replaceDirectVars, formatPhoneNumber } from '../utils/formatDate';
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
  Users, User, Cake, BarChart3, Award, MapPin, Store, Mail, DollarSign, ShoppingCart, UserX, UserPlus, BellOff, Bell, Send, CreditCard, HelpCircle,
};

// D41 카드 색상 로테이션
const CARD_COLORS = [
  { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', accent: 'text-emerald-500' },
  { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', accent: 'text-blue-500' },
  { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', accent: 'text-amber-500' },
  { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', accent: 'text-violet-500' },
  { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', accent: 'text-rose-500' },
  { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700', accent: 'text-cyan-500' },
  { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', accent: 'text-orange-500' },
  { bg: 'bg-teal-50', border: 'border-teal-200', text: 'text-teal-700', accent: 'text-teal-500' },
];

interface DashboardCardData {
  cardId: string;
  label: string;
  type: string;
  icon: string;
  value: number | { label: string; count: number }[];
  hasData: boolean;
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
  // 트라이얼 만료도 subscription 잠금으로 처리 (FREE plan + 7일 경과)
  const isSubscriptionLocked = planInfo
    ? (planInfo.subscription_status === 'expired' || planInfo.subscription_status === 'suspended'
       || (planInfo.plan_code === 'FREE' && planInfo.is_trial_expired))
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
  const [showSpamFilter, setShowSpamFilter] = useState(false);
  const [spamFilterData, setSpamFilterData] = useState<{sms?: string; lms?: string; callback: string; msgType: 'SMS'|'LMS'|'MMS'; subject?: string; firstRecipient?: Record<string, any>}>({callback:'',msgType:'SMS'});
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
  const [showDirectTargeting, setShowDirectTargeting] = useState(false);
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
  const [alimtalkFallback, setAlimtalkFallback] = useState<'N' | 'S' | 'L'>('L'); // 알림톡 실패 시 폴백: N=없음, S=SMS, L=LMS
  const kakaoEnabled = !!(user as any)?.company?.kakaoEnabled;
  // 카카오 템플릿 로드
  const loadKakaoTemplates = async () => {
    try {
      const token = localStorage.getItem('token');
      // ★ D94: 승인된 알림톡 템플릿만 로드
      const res = await fetch('/api/companies/kakao-templates?status=approved', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setKakaoTemplates(data.templates || []);
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
  const executeDirectSend = async (confirmCallbackExclusion?: boolean) => {
    if (isSending || directSending) return; // 교차 중복 발송 방지
    if (adTextEnabled && !optOutNumber) {
      setToast({ show: true, type: 'error', message: '광고 발송을 위해 수신거부번호(080) 설정이 필요합니다. 설정 > 발신번호 관리에서 등록해주세요.' });
      return;
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
        message: isAlimtalk ? kakaoMessage : getFullMessage(directSendChannel === 'rcs' ? kakaoMessage : directMessage),
        callback: isAlimtalk ? (callbackNumbers[0]?.phone || '') : (useIndividualCallback ? null : selectedCallback),
        useIndividualCallback: isAlimtalk ? false : useIndividualCallback,
        recipients: directRecipients.map((r: any) => ({ ...r, callback: r.callback || null })),
        adEnabled: isAlimtalk ? false : adTextEnabled,
        scheduled: reserveEnabled,
        scheduledAt: reserveEnabled && reserveDateTime ? new Date(reserveDateTime).toISOString() : null,
        splitEnabled: isAlimtalk ? false : splitEnabled,
        splitCount: isAlimtalk ? null : (splitEnabled ? splitCount : null),
        mmsImagePaths: isAlimtalk ? [] : mmsUploadedImages.map(img => img.serverPath),
        ...(confirmCallbackExclusion ? { confirmCallbackExclusion: true } : {}),
        // 알림톡 전용 파라미터
        ...(isAlimtalk && kakaoSelectedTemplate ? {
          alimtalkTemplateCode: kakaoSelectedTemplate.template_code || '',
          alimtalkButtonJson: convertButtonsToQTmsg(kakaoSelectedTemplate.buttons) || null,
          alimtalkNextType: alimtalkFallback,
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
  const executeTargetSend = async (confirmCallbackExclusion?: boolean) => {
    setTargetSending(true);
    try {
      const token = localStorage.getItem('token');
      // 변수 치환 처리
      const isRcs = targetSendChannel === 'rcs';
      const baseMsg = isRcs ? kakaoMessage : targetMessage;
      // ★ D43-3c: 동적 변수 치환 (하드코딩 제거)
      const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const recipientsWithMessage = targetRecipients.map((r: any) => {
        let substituted = baseMsg;
        targetFieldsMeta.forEach(fm => {
          if (fm.field_key === 'phone' || fm.field_key === 'sms_opt_in') return;
          const pattern = new RegExp(escapeRe(fm.variable), 'g');
          substituted = substituted.replace(pattern, String(r[fm.field_key] ?? ''));
        });
        return {
          phone: r.phone,
          callback: r.callback || null,
          message: ((!isRcs && adTextEnabled) ? (targetMsgType === 'SMS' ? '(광고)' : '(광고) ') : '') +
            substituted +
            ((!isRcs && adTextEnabled) ? (targetMsgType === 'SMS' ? `\n무료거부${optOutNumber.replace(/-/g, '')}` : `\n무료수신거부 ${formatRejectNumber(optOutNumber)}`) : '')
        };
      });

      const res = await fetch('/api/campaigns/direct-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          msgType: targetSendChannel === 'rcs' ? 'LMS' : targetMsgType,
          sendChannel: targetSendChannel === 'sms' ? 'sms' : targetSendChannel === 'rcs' ? 'rcs' : 'kakao',
          subject: targetSubject,
          message: targetSendChannel === 'rcs' ? kakaoMessage : targetMessage,
          callback: useIndividualCallback ? null : selectedCallback,
          useIndividualCallback: useIndividualCallback,
          recipients: recipientsWithMessage.map(r => ({ phone: r.phone, name: '', var1: '', var2: '', var3: '', callback: r.callback || null })),
          adEnabled: adTextEnabled,
          scheduled: reserveEnabled,
          scheduledAt: reserveEnabled && reserveDateTime ? new Date(reserveDateTime).toISOString() : null,
          splitEnabled: splitEnabled,
          splitCount: splitEnabled ? splitCount : null,
          customMessages: recipientsWithMessage.map(r => ({ ...r, callback: r.callback || null })),
          mmsImagePaths: mmsUploadedImages.map(img => img.serverPath),
          ...(confirmCallbackExclusion ? { confirmCallbackExclusion: true } : {}),
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
  const [mmsUploadedImages, setMmsUploadedImages] = useState<{serverPath: string; url: string; filename: string; size: number}[]>([]);
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
  const [sendConfirm, setSendConfirm] = useState<{show: boolean, type: 'immediate' | 'scheduled', count: number, unsubscribeCount: number, dateTime?: string, from?: 'direct' | 'target', msgType?: string}>({show: false, type: 'immediate', count: 0, unsubscribeCount: 0});

  // ★ 미등록 회신번호 확인 모달 state
  const defaultCallbackConfirm: CallbackConfirmData = { show: false, callbackMissingCount: 0, callbackUnregisteredCount: 0, unregisteredDetails: [], remainingCount: 0, message: '', sendType: 'direct' };
  const [callbackConfirm, setCallbackConfirm] = useState<CallbackConfirmData>(defaultCallbackConfirm);
  // 확인 모달에서 "제외하고 발송" 클릭 시 사용할 보관 데이터 (AI 캠페인용)
  const [pendingAiCampaignId, setPendingAiCampaignId] = useState<string | null>(null);
  // 직접발송 확인 모달용 원본 요청 body 보관
  const [pendingDirectSendBody, setPendingDirectSendBody] = useState<any>(null);

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
    if (adTextEnabled) {
      const adPrefix = directMsgType === 'SMS' ? '(광고)' : '(광고) ';
      const optOutText = directMsgType === 'SMS'
        ? `무료거부${optOutNumber.replace(/-/g, '')}`
        : `무료수신거부 ${optOutNumber}`;
      fullMsg = `${adPrefix}${fullMsg}\n${optOutText}`;
    }
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
    if (adTextEnabled) {
      const adPrefix = targetMsgType === 'SMS' ? '(광고)' : '(광고) ';
      const optOutText = targetMsgType === 'SMS'
        ? `무료거부${optOutNumber.replace(/-/g, '')}`
        : `무료수신거부 ${optOutNumber}`;
      fullMsg = `${adPrefix}${fullMsg}\n${optOutText}`;
    }
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
  const saveTemplate = async (name: string, content: string, msgType: string, subject: string, mmsImagePaths?: string[]) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/sms-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ templateName: name, messageType: msgType, subject: subject || null, content, mmsImagePaths: mmsImagePaths || null })
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
  const handleTargetExtracted = async (recipients: any[], count: number, fieldsMeta: FieldMeta[], selectedCallbackPhone?: string) => {
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
    
    // 개별회신번호 자동 설정
    if (result.use_individual_callback) {
      setUseIndividualCallback(true);
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
  subject?: string;
}) => {
  if (isSending || directSending) return; // 교차 중복 발송 방지
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
      messageContent: (() => {
        let msg = selectedMsg.message_text;
        if (isAd) {
          const prefix = selectedChannel === 'SMS' ? '(광고)' : '(광고) ';
          const suffix = selectedChannel === 'SMS'
            ? `\n무료거부${optOutNumber.replace(/-/g, '')}`
            : `\n무료수신거부 ${formatRejectNumber(optOutNumber)}`;
          msg = prefix + msg + suffix;
        }
        return msg;
      })(),
      targetFilter: aiResult?.target?.filters || {},
      isAd: isAd,
      scheduledAt: scheduledAt,
      eventStartDate: eventStartDate,
      eventEndDate: eventEndDate,
      callback: _useIndividualCallback ? null : _selectedCallback,
      useIndividualCallback: _useIndividualCallback,
      // ★ B-D75-01: 모달에서 수정된 제목 우선 사용
      subject: modalData?.subject ?? selectedMsg.subject ?? '',
      mmsImagePaths: mmsUploadedImages.map(img => img.serverPath),
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
    subject?: string;
  }) => {
    if (isSending || directSending || !customSendData) return; // 교차 중복 발송 방지
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

      // 메시지 내용 (광고문구 래핑)
      let messageContent = variant.message_text || '';
      if (isAd) {
        const prefix = channelType === 'SMS' ? '(광고)' : '(광고) ';
        const suffix = channelType === 'SMS'
          ? `\n무료거부${optOutNumber.replace(/-/g, '')}`
          : `\n무료수신거부 ${formatRejectNumber(optOutNumber)}`;
        messageContent = prefix + messageContent + suffix;
      }

      const campaignData = {
        campaignName: _campaignName,
        messageType: channelType,
        sendChannel: 'sms',
        messageContent,
        targetFilter: customSendData.targetFilters || {},
        isAd: isAd,
        scheduledAt,
        eventStartDate: null,
        eventEndDate: null,
        callback: _useIndividualCallback ? null : _selectedCallback,
        useIndividualCallback: _useIndividualCallback,
        subject: variant.subject || '',
        mmsImagePaths: [],
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
      const token = localStorage.getItem('token');
      const res = await fetch('/api/campaigns/test-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messageContent: (() => {
            let msg = selectedMsg.message_text;
            if (isAd) {
              const prefix = selectedChannel === 'SMS' ? '(광고)' : '(광고) ';
              const suffix = selectedChannel === 'SMS'
                ? `\n무료거부${optOutNumber.replace(/-/g, '')}`
                : `\n무료수신거부 ${formatRejectNumber(optOutNumber)}`;
              msg = prefix + msg + suffix;
            }
            return msg;
          })(),
          messageType: selectedChannel,
          subject: selectedMsg.subject || '',
          mmsImagePaths: mmsUploadedImages.map(img => img.serverPath),
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
      let msg = targetMessage;
      if (adTextEnabled) {
        const prefix = targetMsgType === 'SMS' ? '(광고)' : '(광고) ';
        const suffix = targetMsgType === 'SMS'
          ? `\n무료거부${optOutNumber.replace(/-/g, '')}`
          : `\n무료수신거부 ${formatRejectNumber(optOutNumber)}`;
        msg = prefix + msg + suffix;
      }
      const token = localStorage.getItem('token');
      const res = await fetch('/api/campaigns/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messageContent: msg,
          messageType: targetMsgType,
          subject: targetSubject || '',
          mmsImagePaths: mmsUploadedImages.map(img => img.serverPath),
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

  // 광고문구 포함된 최종 메시지
  // 080번호 하이픈 포맷팅 (0801111111 → 080-111-1111)
  const formatRejectNumber = (num: string) => {
    const clean = num.replace(/-/g, '');
    if (clean.length === 10) {
      return `${clean.slice(0,3)}-${clean.slice(3,6)}-${clean.slice(6)}`;
    }
    return num;
  };

  // ★ AI추천 미리보기용 광고 문구 래핑
  const wrapAdText = (msg: string, channel?: string) => {
    if (!msg) return msg;
    const ch = channel || selectedChannel;
    if (!isAd) return msg;
    const adPrefix = ch === 'SMS' ? '(광고)' : '(광고) ';
    const adSuffix = ch === 'SMS'
      ? `\n무료거부${optOutNumber.replace(/-/g, '')}`
      : `\n무료수신거부 ${formatRejectNumber(optOutNumber)}`;
    return adPrefix + msg + adSuffix;
  };

  const getFullMessage = (msg: string) => {
    if (!adTextEnabled) return msg;
    const prefix = directMsgType === 'SMS' ? '(광고)' : '(광고) ';
    const optOutText = directMsgType === 'SMS' 
      ? `무료거부${optOutNumber.replace(/-/g, '')}` 
      : `무료수신거부 ${formatRejectNumber(optOutNumber)}`;
    return `${prefix}${msg}\n${optOutText}`;
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
          onClose={() => { setShowAiCustomFlow(false); setCustomSendData(null); }}
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
            isAd={isAd}
            optOutNumber={optOutNumber}
            subject={customSendData.variant?.subject}
            usePersonalization={true}
            sampleCustomer={sampleCustomer}
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
                className="w-[40%] bg-white/50 rounded-xl p-5 cursor-pointer hover:bg-white/80 transition-all border border-green-200"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-gray-400 font-medium">요금제 현황</span>
                  <span className="text-green-700 text-xs font-medium">요금제 안내 →</span>
                </div>
                <div className="text-lg font-bold text-gray-800 mb-1">
                  {planInfo?.plan_name || '로딩...'}
                </div>
                {planInfo?.plan_code === 'FREE' && !planInfo?.is_trial_expired && (
                  <div className="text-xs text-orange-500 font-medium">
                    트라이얼 D-{Math.max(0, Math.ceil((new Date(planInfo.trial_expires_at).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))}
                  </div>
                )}
                {planInfo?.plan_code === 'FREE' && planInfo?.is_trial_expired && (
                  <div className="text-xs text-red-500 font-medium">트라이얼 만료</div>
                )}
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
              <div className="w-[60%] bg-white/50 rounded-xl p-5 border border-amber-200">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-gray-400 font-medium">발송 현황</span>
                  {balanceInfo?.billingType === 'prepaid' && (
                    <button onClick={() => setShowBalanceModal(true)} className="text-green-700 text-xs font-medium hover:text-green-800 transition-colors">잔액 현황 →</button>
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

            {/* 2행: DB현황 — 동적 카드 (D41) */}
            <div className="bg-white/50 rounded-xl p-5 border border-green-200 flex-1">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-gray-500 font-medium">DB 현황</span>
                <button onClick={() => isSubscriptionLocked ? setShowSubscriptionLock(true) : setShowCustomerDB(true)} className="text-green-700 text-xs font-medium hover:text-green-800 transition-colors">DB 정보조회 →</button>
              </div>

              {/* 카드 미설정 */}
              {(!dashboardCards || !dashboardCards.configured) && (
                <div className="flex items-center justify-center py-8 text-gray-400">
                  <div className="text-center">
                    <div className="text-3xl mb-2">📊</div>
                    <div className="text-sm">관리자가 대시보드 카드를 설정하면 표시됩니다</div>
                  </div>
                </div>
              )}

              {/* 고객 DB 미업로드 — 전체 블러 + CTA */}
              {dashboardCards?.configured && dashboardCards?.hasCustomerData === false && (
                <div className="relative">
                  <div className="grid grid-cols-3 gap-3 filter blur-sm pointer-events-none select-none">
                    {dashboardCards.cards.slice(0, 6).map((card, i) => (
                      <div key={card.cardId} className="text-center p-3 bg-gray-50 rounded-lg">
                        <div className="text-xl font-bold text-gray-300">0</div>
                        <div className="text-xs text-gray-300 mt-1">{card.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center bg-white/60 rounded-lg">
                    <div className="text-center">
                      <div className="text-3xl mb-2">📂</div>
                      <div className="text-sm text-gray-600 font-medium mb-2">고객 DB를 업로드하면 현황을 확인할 수 있습니다</div>
                      <button
                        onClick={() => { if (isSubscriptionLocked) { setShowSubscriptionLock(true); return; } setShowFileUpload(true); }}
                        className="px-4 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 transition-colors"
                      >
                        고객 DB 업로드
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 정상 표시: 6개씩 페이징 카드 렌더링 (D77) */}
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

                        // 데이터 없는 카드 — 블러 처리
                        if (!card.hasData) {
                          return (
                            <div key={card.cardId} className="relative text-center p-3 bg-gray-50 rounded-lg border border-gray-200">
                              <div className="filter blur-sm">
                                <div className="text-xl font-bold text-gray-300">-</div>
                              </div>
                              <div className="text-xs text-gray-400 mt-1">{card.label}</div>
                              <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-[10px] text-gray-400 bg-white/80 px-1.5 py-0.5 rounded">데이터 없음</span>
                              </div>
                            </div>
                          );
                        }

                        // distribution 타입 — 분포 표시
                        if (card.type === 'distribution' && Array.isArray(card.value)) {
                          const items = card.value.slice(0, 3);
                          return (
                            <div key={card.cardId} className={`p-3 rounded-lg border ${color.border} ${color.bg}`}>
                              <div className="flex items-center gap-1.5 mb-2">
                                <IconComp className={`w-3.5 h-3.5 ${color.accent}`} />
                                <span className="text-xs text-gray-500 font-medium">{card.label}</span>
                              </div>
                              <div className="space-y-1">
                                {items.map((item, j) => (
                                  <div key={j} className="flex justify-between text-xs">
                                    <span className="text-gray-600 truncate">{item.label}</span>
                                    <span className={`font-bold ${color.text}`}>{item.count.toLocaleString()}</span>
                                  </div>
                                ))}
                                {items.length === 0 && <div className="text-xs text-gray-400 text-center">-</div>}
                              </div>
                            </div>
                          );
                        }

                        // count / rate / sum 타입 — 숫자 표시
                        const numVal = typeof card.value === 'number' ? card.value : 0;
                        let displayVal = numVal.toLocaleString();
                        let suffix = '';
                        if (card.type === 'rate') { displayVal = numVal.toFixed(1); suffix = '%'; }
                        else if (card.type === 'sum') { displayVal = numVal >= 10000 ? `${Math.round(numVal / 10000).toLocaleString()}만` : numVal.toLocaleString(); suffix = '원'; }
                        else if (card.cardId === 'active_campaigns') { suffix = '건'; }
                        else { suffix = '명'; }

                        return (
                          <div key={card.cardId} className={`text-center p-3 rounded-lg border ${color.border} ${color.bg}`}>
                            <IconComp className={`w-5 h-5 mx-auto mb-1.5 ${color.accent}`} />
                            <div className={`text-xl font-bold ${color.text}`}>
                              {displayVal}<span className="text-xs font-normal text-gray-400 ml-0.5">{suffix}</span>
                            </div>
                            <div className="text-xs text-gray-500 mt-1">{card.label}</div>
                          </div>
                        );
                      })}
                    </div>

                    {/* 페이지 인디케이터 (2페이지 이상일 때만 표시) */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-center gap-1.5 mt-3">
                        {Array.from({ length: totalPages }, (_, idx) => (
                          <button
                            key={idx}
                            onClick={() => setDbCardPage(idx)}
                            className={`w-2 h-2 rounded-full transition-all ${
                              idx === safePage ? 'bg-green-500 w-4' : 'bg-gray-300 hover:bg-gray-400'
                            }`}
                          />
                        ))}
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
                  onClick={() => setShowFileUpload(true)}
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

                  {/* 빠른 발송 예시 */}
                  <div onClick={() => { if (isSubscriptionLocked) { setShowSubscriptionLock(true); return; } setShowTemplates(true); }} className={`bg-white/50 shadow-sm rounded-xl p-6 min-h-[140px] cursor-pointer hover:shadow-lg transition-all text-center border border-green-200 ${isSubscriptionLocked ? 'opacity-60' : ''}`}>
                    <Rocket className="w-8 h-8 mx-auto mb-3 text-green-600" />
                    <div className="font-semibold text-gray-800 mb-1">{isSubscriptionLocked ? '🔒 ' : ''}발송 예시</div>
                    <div className="text-xs text-gray-500 mb-3">클릭하면 바로 실행</div>
                    <div className="text-xl font-bold text-green-700">4개</div>
                  </div>

                  {/* 고객 인사이트 */}
                  <div onClick={() => { if (isSubscriptionLocked) { setShowSubscriptionLock(true); return; } setShowInsights(true); }} className={`bg-white/50 shadow-sm rounded-xl p-6 min-h-[140px] cursor-pointer hover:shadow-lg transition-all text-center border border-green-200 ${isSubscriptionLocked ? 'opacity-60' : ''}`}>
                    <Users className="w-8 h-8 mx-auto mb-3 text-green-600" />
                    <div className="font-semibold text-gray-800 mb-1">{isSubscriptionLocked ? '🔒 ' : ''}고객 인사이트</div>
                    <div className="text-xs text-gray-500 mb-3">고객 현황 분석</div>
                    <div className="text-xl font-bold text-green-700">{parseInt(stats?.total || '0').toLocaleString()}명</div>
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
          onClose={() => setShowSuccess(false)}
          onShowCalendar={() => { setShowSuccess(false); setShowCalendar(true); }}
          selectedChannel={successChannel || selectedChannel}
          aiResult={aiResult}
          successSendInfo={successSendInfo}
          overrideTargetCount={successTargetCount || undefined}
          overrideUnsubscribeCount={successUnsubscribeCount || undefined}
        />
        {showResults && <ResultsModal onClose={() => setShowResults(false)} token={localStorage.getItem('token')} />}
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

        <RecommendTemplateModal show={showTemplates} onClose={() => setShowTemplates(false)} onSelectTemplate={(prompt) => { setAiCampaignPrompt(prompt); setShowTemplates(false); setShowAiSendType(true); }} />
                            {/* 파일 업로드 캠페인 모달 */}
        {/* 직접 타겟 설정 모달 (D43-3: 컴포넌트 분리) */}
        <DirectTargetFilterModal
          show={showDirectTargeting}
          onClose={() => setShowDirectTargeting(false)}
          onExtracted={handleTargetExtracted}
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
        selectedCallback={selectedCallback}
        setSelectedCallback={setSelectedCallback}
        useIndividualCallback={useIndividualCallback}
        setUseIndividualCallback={setUseIndividualCallback}
        callbackNumbers={callbackNumbers}
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
                      if (showSpecialChars === 'target') setTargetMessage(prev => prev + char);
                      else setDirectMessage(prev => prev + char);
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
                          // ★ D98: MMS 이미지 복원 — serverPath에서 API URL 추출
                          if (t.message_type === 'MMS' && t.mms_image_paths && Array.isArray(t.mms_image_paths)) {
                            setMmsUploadedImages(t.mms_image_paths.map((p: string, i: number) => {
                              // serverPath가 절대경로면 → /api/mms-images/{companyId}/{filename} URL 생성
                              const parts = p.replace(/\\/g, '/').split('/');
                              const filename = parts[parts.length - 1];
                              const companyDir = parts[parts.length - 2];
                              const apiUrl = filename && companyDir ? `/api/mms-images/${companyDir}/${filename}` : p;
                              return { serverPath: p, url: apiUrl, filename: filename || `image_${i + 1}`, size: 0 };
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
                    const imagePaths = msgType === 'MMS' ? mmsUploadedImages.map(img => img.serverPath) : undefined;
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
      {/* ★ 미등록 회신번호 제외 확인 모달 */}
      <CallbackConfirmModal
        data={callbackConfirm}
        onClose={async () => {
          // ★ D95: 확인 모달 취소 시 pending draft 캠페인 정리 (중복 예약 방지)
          if (pendingAiCampaignId) {
            try { await campaignsApi.cancel(pendingAiCampaignId); } catch { /* 이미 없으면 무시 */ }
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

      <AnalysisModal
        show={showAnalysis}
        onClose={() => setShowAnalysis(false)}
        analysisLevel={planInfo?.ai_analysis_level || 'none'}
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