import { Award, BarChart3, Bell, BellOff, Cake, Clock, CreditCard, DollarSign, HelpCircle, Mail, MapPin, Rocket, Send, ShoppingCart, Sparkles, Store, User, UserPlus, Users, UserX } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import SendConfirmModal from '../components/SendConfirmModal';
import SpamFilterLockModal from '../components/SpamFilterLockModal';
import SpamFilterTestModal from '../components/SpamFilterTestModal';
import SubscriptionLockModal from '../components/SubscriptionLockModal';
import TodayStatsModal from '../components/TodayStatsModal';
import UploadProgressModal from '../components/UploadProgressModal';
import UploadResultModal from '../components/UploadResultModal';
import { useAuthStore } from '../stores/authStore';
import { formatDate } from '../utils/formatDate';

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
  const isSubscriptionLocked = planInfo
    ? (planInfo.subscription_status === 'expired' || planInfo.subscription_status === 'suspended')
    : (subscriptionStatus === 'expired' || subscriptionStatus === 'suspended');
  const isSpamFilterLocked = !planInfo || (Number(planInfo.monthly_price) || 0) < 150000;
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
  const [spamFilterData, setSpamFilterData] = useState<{sms?: string; lms?: string; callback: string; msgType: 'SMS'|'LMS'|'MMS'; firstRecipient?: Record<string, any>}>({callback:'',msgType:'SMS'});
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
  // D41 동적 카드
  const [dashboardCards, setDashboardCards] = useState<DashboardCardsResponse | null>(null);
  // 5개 카드 모달 state
  const [showRecentCampaigns, setShowRecentCampaigns] = useState(false);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [showDirectTargeting, setShowDirectTargeting] = useState(false);
  // 직접 타겟 설정 관련 state
   // 직접 타겟 설정 관련 state
   const [targetPhoneField, setTargetPhoneField] = useState('phone');
   const [targetSmsOptIn, setTargetSmsOptIn] = useState(true);
   const [targetCount, setTargetCount] = useState(0);
   const [targetCountLoading, setTargetCountLoading] = useState(false);
   const [targetSchemaFields, setTargetSchemaFields] = useState<{name: string, label: string, type: string}[]>([]);
   // 동적 필터 state
   const [enabledFields, setEnabledFields] = useState<any[]>([]);
   const [targetFilters, setTargetFilters] = useState<Record<string, string>>({});
   const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});
   const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>({});
   const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({ basic: true });
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
  const [showDirectSend, setShowDirectSend] = useState(false);
  const [showTargetSend, setShowTargetSend] = useState(false);
  // 직접타겟발송 관련 state
  const [targetSendChannel, setTargetSendChannel] = useState<'sms' | 'kakao_brand' | 'kakao_alimtalk'>('sms');
  const [targetMsgType, setTargetMsgType] = useState<'SMS' | 'LMS' | 'MMS'>('SMS');
  const [targetSubject, setTargetSubject] = useState('');
  const [targetMessage, setTargetMessage] = useState('');
  const [targetRecipients, setTargetRecipients] = useState<any[]>([]);
  const [targetSending, setTargetSending] = useState(false);
  const [targetListPage, setTargetListPage] = useState(0);
  const [targetListSearch, setTargetListSearch] = useState('');
  const [showTargetPreview, setShowTargetPreview] = useState(false);
  // 직접발송 관련 state
  const [directSendChannel, setDirectSendChannel] = useState<'sms' | 'kakao_brand' | 'kakao_alimtalk'>('sms');
  const [directMsgType, setDirectMsgType] = useState<'SMS' | 'LMS' | 'MMS'>('SMS');
  const [directSubject, setDirectSubject] = useState('');
  const [directMessage, setDirectMessage] = useState('');
  const [directRecipients, setDirectRecipients] = useState<any[]>([]);
  const [directSearchQuery, setDirectSearchQuery] = useState('');
  const [reserveEnabled, setReserveEnabled] = useState(false);
  const [reserveDateTime, setReserveDateTime] = useState('');
  const [showReservePicker, setShowReservePicker] = useState(false);
  // 카카오 관련 state
  const [kakaoMessage, setKakaoMessage] = useState('');
  const [kakaoTemplates, setKakaoTemplates] = useState<any[]>([]);
  const [kakaoSelectedTemplate, setKakaoSelectedTemplate] = useState<any>(null);
  const [kakaoTemplateVars, setKakaoTemplateVars] = useState<Record<string, string>>({});
  const kakaoEnabled = !!(user as any)?.company?.kakaoEnabled;
  // 카카오 템플릿 로드
  const loadKakaoTemplates = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/companies/kakao-templates', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setKakaoTemplates(data.templates || []);
      }
    } catch {}
  };
  // AI 문구 추천 (직접타겟발송) — 버튼 클릭 핸들러
  const handleAiMsgHelper = () => {
    if (planInfo?.plan_code === 'STARTER') {
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
  const executeDirectSend = async () => {
    setDirectSending(true);
    try {
      const res = await fetch('/api/campaigns/direct-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          msgType: directSendChannel === 'kakao_brand' ? 'LMS' : directMsgType,
          sendChannel: directSendChannel === 'sms' ? 'sms' : 'kakao',
          subject: directSubject,
          message: getFullMessage(directSendChannel === 'kakao_brand' ? kakaoMessage : directMessage),
          callback: useIndividualCallback ? null : selectedCallback,
          useIndividualCallback: useIndividualCallback,
          recipients: directRecipients.map((r: any) => ({ ...r, callback: r.callback || null })),
          adEnabled: adTextEnabled,
          scheduled: reserveEnabled,
          scheduledAt: reserveEnabled && reserveDateTime ? new Date(reserveDateTime).toISOString() : null,
          splitEnabled: splitEnabled,
          splitCount: splitEnabled ? splitCount : null,
          mmsImagePaths: mmsUploadedImages.map(img => img.serverPath)
        })
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
  const executeTargetSend = async () => {
    setTargetSending(true);
    try {
      const token = localStorage.getItem('token');
      // 변수 치환 처리
      const isKakaoBrand = targetSendChannel === 'kakao_brand';
      const baseMsg = isKakaoBrand ? kakaoMessage : targetMessage;
      const recipientsWithMessage = targetRecipients.map((r: any) => ({
        phone: r.phone,
        name: r.name || '',
        grade: r.grade || '',
        region: r.region || '',
        amount: r.total_purchase_amount || '',
        callback: r.callback || null,
        message: ((!isKakaoBrand && adTextEnabled) ? (targetMsgType === 'SMS' ? '(광고)' : '(광고) ') : '') + 
          baseMsg
            .replace(/%이름%/g, r.name || '')
            .replace(/%등급%/g, r.grade || '')
            .replace(/%지역%/g, r.region || '')
            .replace(/%구매금액%/g, r.total_purchase_amount || '')
            .replace(/%회신번호%/g, r.callback || '') +
          ((!isKakaoBrand && adTextEnabled) ? (targetMsgType === 'SMS' ? `\n무료거부${optOutNumber.replace(/-/g, '')}` : `\n무료수신거부 ${formatRejectNumber(optOutNumber)}`) : '')
      }));

      const res = await fetch('/api/campaigns/direct-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          msgType: targetSendChannel === 'kakao_brand' ? 'LMS' : targetMsgType,
          sendChannel: targetSendChannel === 'sms' ? 'sms' : 'kakao',
          subject: targetSubject,
          message: targetSendChannel === 'kakao_brand' ? kakaoMessage : targetMessage,
          callback: useIndividualCallback ? null : selectedCallback,
          useIndividualCallback: useIndividualCallback,
          recipients: recipientsWithMessage.map(r => ({ phone: r.phone, name: '', var1: '', var2: '', var3: '', callback: r.callback || null })),
          adEnabled: adTextEnabled,
          scheduled: reserveEnabled,
          scheduledAt: reserveEnabled && reserveDateTime ? new Date(reserveDateTime).toISOString() : null,
          splitEnabled: splitEnabled,
          splitCount: splitEnabled ? splitCount : null,
          customMessages: recipientsWithMessage.map(r => ({ ...r, callback: r.callback || null })),
          mmsImagePaths: mmsUploadedImages.map(img => img.serverPath)
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
  const [directFileHeaders, setDirectFileHeaders] = useState<string[]>([]);
  const [directFilePreview, setDirectFilePreview] = useState<any[]>([]);
  const [directFileData, setDirectFileData] = useState<any[]>([]);
  const [directColumnMapping, setDirectColumnMapping] = useState<{[key: string]: string}>({});
  const [directFileLoading, setDirectFileLoading] = useState(false);
  const [directMappingLoading, setDirectMappingLoading] = useState(false);
  const [directLoadingProgress, setDirectLoadingProgress] = useState(0);
  const [directSending, setDirectSending] = useState(false);
  const [directShowMapping, setDirectShowMapping] = useState(false);
  // AI 문구 추천 (직접발송)
  const [showAiMsgHelper, setShowAiMsgHelper] = useState(false);
  const [aiHelperPrompt, setAiHelperPrompt] = useState('');
  const [aiHelperLoading, setAiHelperLoading] = useState(false);
  const [aiHelperResults, setAiHelperResults] = useState<any[]>([]);
  const [aiHelperRecommendation, setAiHelperRecommendation] = useState('');
  const [showPlanUpgradeModal, setShowPlanUpgradeModal] = useState(false);
  const [showDirectInput, setShowDirectInput] = useState(false);
  const [showSpecialChars, setShowSpecialChars] = useState<'target' | 'direct' | null>(null);
  const [showTemplateBox, setShowTemplateBox] = useState<'target' | 'direct' | null>(null);
  const [templateList, setTemplateList] = useState<any[]>([]);
  const [showTemplateSave, setShowTemplateSave] = useState<'target' | 'direct' | null>(null);
  const [templateSaveName, setTemplateSaveName] = useState('');
  const [directInputText, setDirectInputText] = useState('');
  const [callbackNumbers, setCallbackNumbers] = useState<{id: string, phone: string, label: string, is_default: boolean}[]>([]);
  const [selectedCallback, setSelectedCallback] = useState('');
  const [useIndividualCallback, setUseIndividualCallback] = useState(false);
  const [sendConfirm, setSendConfirm] = useState<{show: boolean, type: 'immediate' | 'scheduled', count: number, unsubscribeCount: number, dateTime?: string, from?: 'direct' | 'target', msgType?: string}>({show: false, type: 'immediate', count: 0, unsubscribeCount: 0});

  // 전화번호 포맷팅 함수
  const formatPhoneNumber = (phone: string) => {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    
    // 휴대폰 11자리: 010-XXXX-XXXX
    if (cleaned.length === 11 && cleaned.startsWith('01')) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
    }
    // 휴대폰 10자리 (구형): 01X-XXX-XXXX
    if (cleaned.length === 10 && cleaned.startsWith('01')) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    // 서울 02 지역번호 (9자리): 02-XXX-XXXX
    if (cleaned.length === 9 && cleaned.startsWith('02')) {
      return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 5)}-${cleaned.slice(5)}`;
    }
    // 서울 02 지역번호 (10자리): 02-XXXX-XXXX
    if (cleaned.length === 10 && cleaned.startsWith('02')) {
      return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 6)}-${cleaned.slice(6)}`;
    }
    // 대표번호 8자리 (15XX, 16XX, 18XX): 1XXX-XXXX
    if (cleaned.length === 8 && cleaned.startsWith('1')) {
      return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
    }
    // 기타 지역번호 10자리: 0XX-XXX-XXXX
    if (cleaned.length === 10 && cleaned.startsWith('0')) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    // 기타 지역번호 11자리: 0XX-XXXX-XXXX
    if (cleaned.length === 11 && cleaned.startsWith('0')) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
    }
    // 그 외는 원본 반환
    return phone;
  };
  const [selectedRecipients, setSelectedRecipients] = useState<Set<number>>(new Set());
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
  const [toast, setToast] = useState<{show: boolean, type: 'success' | 'error', message: string}>({show: false, type: 'success', message: ''});
  const [optOutNumber, setOptOutNumber] = useState('080-000-0000');

  // 업로드 저장 시작 → 프로그레스 모달 표시 + 폴링
  const handleUploadSaveStart = (savedFileId: string, totalRows: number) => {
    setShowFileUpload(false);
    setShowUploadProgressModal(true);
    setUploadProgress({ status: 'processing', total: totalRows, processed: 0, percent: 0, insertCount: 0, duplicateCount: 0, errorCount: 0, message: '처리 시작...' });
    const progressInterval = setInterval(async () => {
      try {
        const pRes = await fetch(`/api/upload/progress/${savedFileId}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const pData = await pRes.json();
        setUploadProgress(pData);
        if (pData.status === 'completed' || pData.status === 'failed') {
          clearInterval(progressInterval);
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
    // 자동입력 변수를 최대 길이 값으로 치환
    const directVarMap: Record<string, string> = {
      '%이름%': 'name', '%기타1%': 'extra1', '%기타2%': 'extra2', '%기타3%': 'extra3', '%회신번호%': 'callback',
    };
    let fullMsg = getMaxByteMessage(directMessage, directRecipients, directVarMap);
    if (adTextEnabled) {
      const adPrefix = directMsgType === 'SMS' ? '(광고)' : '(광고) ';
      const optOutText = directMsgType === 'SMS'
        ? `무료거부${optOutNumber.replace(/-/g, '')}`
        : `무료수신거부 ${optOutNumber}`;
      fullMsg = `${adPrefix}${fullMsg}\n${optOutText}`;
    }
    // 한글 2byte, 영문/숫자 1byte 계산
    let bytes = 0;
    for (let i = 0; i < fullMsg.length; i++) {
      const char = fullMsg.charCodeAt(i);
      bytes += char > 127 ? 2 : 1;
    }
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
    // 자동입력 변수를 최대 길이 값으로 치환
    const targetVarMap: Record<string, string> = {
      '%이름%': 'name', '%등급%': 'grade', '%지역%': 'region', '%구매금액%': 'total_purchase_amount', '%회신번호%': 'callback',
    };
    let fullMsg = getMaxByteMessage(targetMessage, targetRecipients, targetVarMap);
    if (adTextEnabled) {
      const adPrefix = targetMsgType === 'SMS' ? '(광고)' : '(광고) ';
      const optOutText = targetMsgType === 'SMS'
        ? `무료거부${optOutNumber.replace(/-/g, '')}`
        : `무료수신거부 ${optOutNumber}`;
      fullMsg = `${adPrefix}${fullMsg}\n${optOutText}`;
    }
    let bytes = 0;
    for (let i = 0; i < fullMsg.length; i++) {
      const char = fullMsg.charCodeAt(i);
      bytes += char > 127 ? 2 : 1;
    }
    if (targetMsgType === 'SMS' && bytes > 90 && !showLmsConfirm) {
      setPendingBytes(bytes);
      setShowLmsConfirm(true);
    }
  }, [targetMessage, targetMsgType, adTextEnabled, optOutNumber, showTargetSend, targetRecipients, targetSendChannel]);

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
      // ★ sending 상태 캠페인이 있을 수 있으므로 결과 동기화 먼저 실행
      try {
        await fetch('/api/campaigns/sync-results', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
      } catch {}
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

  // 예약 대기 캠페인 로드
  const loadScheduledCampaigns = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/campaigns?status=scheduled', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setScheduledCampaigns(data.campaigns || []);
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
    } catch (err) {
      console.error('회사 설정 로드 실패:', err);
    }
  };

  // 직접 타겟 설정 - 스키마 로드
  // 직접 타겟 설정 - 스키마 로드 (기존 유지)
  const loadTargetSchema = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/customers/schema', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.fields) {
        setTargetSchemaFields(data.fields);
      }
    } catch (error) {
      console.error('스키마 로드 실패:', error);
    }
  };

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
  const saveTemplate = async (name: string, content: string, msgType: string, subject: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/sms-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ templateName: name, messageType: msgType, subject: subject || null, content })
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

  // 동적 필터 - 활성 필드 로드
  const loadEnabledFields = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/customers/enabled-fields', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setEnabledFields(data.fields || []);
        setFilterOptions(data.options || {});
        if (data.categories) setCategoryLabels(data.categories);
      }
    } catch (error) {
      console.error('필드 로드 실패:', error);
    }
  };

  // 동적 필터 → API 포맷 변환
  const buildDynamicFiltersForAPI = () => {
    const filters: Record<string, any> = {};
    for (const [fieldKey, value] of Object.entries(targetFilters)) {
      if (!value) continue;
      const field = enabledFields.find((f: any) => f.field_key === fieldKey);
      if (!field) continue;

      // 특수 필드 변환
      if (fieldKey === 'age_group') {
        const ageVal = parseInt(value);
        if (ageVal >= 60) { filters['age'] = { operator: 'gte', value: 60 }; }
        else { filters['age'] = { operator: 'between', value: [ageVal, ageVal + 9] }; }
        continue;
      }
      if (fieldKey === 'last_purchase_date' || fieldKey === 'first_purchase_date' || fieldKey === 'last_visit_date') {
        const dbCol = fieldKey === 'last_purchase_date' ? 'recent_purchase_date' : fieldKey;
        filters[dbCol] = { operator: 'days_within', value: parseInt(value) };
        continue;
      }

      const dbFieldMap: Record<string, string> = { 'opt_in_sms': 'sms_opt_in' };
      const dbField = dbFieldMap[fieldKey] || fieldKey;

      if (field.data_type === 'string') {
        filters[dbField] = { operator: 'eq', value };
      } else if (field.data_type === 'number') {
        filters[dbField] = { operator: 'gte', value: Number(value) };
      } else if (field.data_type === 'date') {
        filters[dbField] = { operator: 'days_within', value: parseInt(value) };
      } else if (field.data_type === 'boolean') {
        filters[dbField] = { operator: 'eq', value: value === 'true' };
      }
    }
    return filters;
  };

  // 직접 타겟 설정 - 필터 카운트
  const loadTargetCount = async () => {
    setTargetCountLoading(true);
    try {
      const token = localStorage.getItem('token');
      const dynamicFilters = buildDynamicFiltersForAPI();
      const res = await fetch('/api/customers/filter-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dynamicFilters, smsOptIn: targetSmsOptIn })
      });
      const data = await res.json();
      setTargetCount(data.count || 0);
    } catch (error) {
      console.error('카운트 조회 실패:', error);
    } finally {
      setTargetCountLoading(false);
    }
  };

  // 직접 타겟 설정 - 타겟 추출 후 발송화면 이동
  const handleTargetExtract = async () => {
    if (targetCount === 0) {
      setToast({show: true, type: 'error', message: '추출할 대상이 없습니다'});
      setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
      return;
    }
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
        const defaultCb = cbData.numbers?.find((n: any) => n.is_default);
        if (defaultCb) setSelectedCallback(defaultCb.phone);
      }
      
      const dynamicFilters = buildDynamicFiltersForAPI();
      const res = await fetch('/api/customers/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          dynamicFilters,
          smsOptIn: targetSmsOptIn,
          phoneField: targetPhoneField
        })
      });
      const data = await res.json();
      if (data.success && data.recipients) {
        const recipients = data.recipients.map((r: any) => ({
          phone: r.phone,
          name: r.name || '',
          grade: r.grade || '',
          region: r.region || '',
          amount: r.total_purchase_amount ? Math.floor(r.total_purchase_amount).toLocaleString() + '원' : '',
          callback: r.callback || ''
        }));
        setTargetRecipients(recipients);
        setShowDirectTargeting(false);
        setShowTargetSend(true);
        setToast({show: true, type: 'success', message: `${data.count}명 추출 완료`});
        setTimeout(() => setToast({show: false, type: 'success', message: ''}), 3000);
      }
    } catch (error) {
      console.error('타겟 추출 실패:', error);
      setToast({show: true, type: 'error', message: '타겟 추출 실패'});
      setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
    }
  };

  // 직접 타겟 설정 - 필터 초기화
  const resetTargetFilters = () => {
    setTargetFilters({});
    setTargetSmsOptIn(true);
    setTargetCount(0);
  };

  const handleExtractTarget = async () => {
    try {
      const params: any = {};
      if (filter.gender) params.gender = filter.gender;
      if (filter.minAge) params.minAge = filter.minAge;
      if (filter.maxAge) params.maxAge = filter.maxAge;
      if (filter.grade) params.grade = filter.grade;
      if (filter.smsOptIn) params.smsOptIn = 'true';

      console.log('API 호출 params:', params);
      const response = await customersApi.list({ ...params, limit: 100 });
      setTargetResult(response.data);
    } catch (error) {
      console.error('타겟 추출 실패:', error);
    }
  };

  // AI 타겟 추천
  const handleAiRecommendTarget = async () => {
    if (!aiObjective.trim()) {
      alert('마케팅 목표를 입력해주세요');
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
      
      alert(`AI 추천 완료!\n\n${result.reasoning}\n\n예상 타겟: ${result.estimated_count.toLocaleString()}명${result.unsubscribe_count > 0 ? `\n수신거부 제외: ${result.unsubscribe_count.toLocaleString()}명` : ''}`);
      setShowAiTarget(false);
      setAiObjective('');
    } catch (error) {
      console.error('AI 타겟 추천 실패:', error);
      alert('AI 추천 중 오류가 발생했습니다.');
    } finally {
      setAiLoading(false);
    }
  };
// AI 캠페인 생성 (프롬프트 한 방)
const handleAiCampaignGenerate = async (promptOverride?: string) => {
  const prompt = promptOverride || aiCampaignPrompt;
  if (!prompt.trim()) {
    setShowPromptAlert(true);
    return;
  }
  setAiLoading(true);
  try {
    // 1. 타겟 + 채널 추천 받기
    const response = await aiApi.recommendTarget({ objective: prompt });
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
    
    // 추천 채널로 기본 설정
    const kakaoEnabled = !!(user as any)?.company?.kakaoEnabled;
    let recommendedCh = result.recommended_channel || 'SMS';
    // 카카오 추천인데 활성화 안 되어있으면 SMS/LMS로 폴백
    if ((recommendedCh === '카카오' || recommendedCh === 'KAKAO') && !kakaoEnabled) {
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
    alert('AI 추천 중 오류가 발생했습니다.');
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
    alert('메시지 생성 중 오류가 발생했습니다.');
  } finally {
    setAiLoading(false);
  }
};

  // AI 메시지 생성
  const handleAiGenerateMessage = async () => {
    const prompt = aiPrompt.trim() || campaignContext;
    if (!prompt) {
      alert('메시지 요청 내용을 입력해주세요');
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
      alert('AI 메시지 생성 중 오류가 발생했습니다.');
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
      alert('캠페인명과 메시지 내용을 입력하세요');
      return;
    }

    try {
      await campaignsApi.create({
        ...campaign,
        targetFilter: filter,
      });
      alert('캠페인이 생성되었습니다');
      setActiveTab('send');
    } catch (error: any) {
      alert(error.response?.data?.error || '캠페인 생성 실패');
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
}) => {
  if (isSending) return; // 중복 클릭 방지
  
  const _sendTimeOption = modalData?.sendTimeOption || sendTimeOption;
  const _customSendTime = modalData?.customSendTime || customSendTime;
  const _selectedCallback = modalData?.selectedCallback ?? selectedCallback;
  const _useIndividualCallback = modalData?.useIndividualCallback ?? useIndividualCallback;
  const _campaignName = modalData?.campaignName || '';

  // 회신번호 검증
  if (!_selectedCallback && !_useIndividualCallback) {
    alert('회신번호를 선택해주세요');
    return;
  }
  
  setIsSending(true);
  try {
    // 선택된 메시지 가져오기 (첫번째 메시지 사용, 나중에 라디오 선택값으로 변경 가능)
    const selectedMsg = aiResult?.messages?.[selectedAiMsgIdx];
    if (!selectedMsg) {
      alert('메시지를 선택해주세요');
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
      messageType: selectedChannel === 'KAKAO' ? 'LMS' : selectedChannel,
      sendChannel: selectedChannel === 'KAKAO' ? 'kakao' : 'sms',
      messageContent: (() => {
        let msg = selectedMsg.message_text;
        // 카카오는 광고문구를 백엔드(insertKakaoQueue)에서 별도 처리 → 프론트에서 붙이지 않음
        if (isAd && selectedChannel !== 'KAKAO') {
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
      subject: selectedMsg.subject || '',
      mmsImagePaths: mmsUploadedImages.map(img => img.serverPath),
    };

    console.log('=== 발송 디버깅 ===');
    console.log('sendTimeOption:', _sendTimeOption);
    console.log('scheduledAt:', scheduledAt);
    console.log('campaignData:', campaignData);

    const response = await campaignsApi.create(campaignData);

    // 캠페인 발송 API 호출 (예약/즉시 모두)
    const campaignId = response.data.campaign?.id;
    if (campaignId) {
      await campaignsApi.send(campaignId);
    }
    
    // 모달 닫기
    setShowPreview(false);
    setShowAiResult(false);
    setShowAiSendModal(false);
    setAiStep(1);
    setAiCampaignPrompt('');
    // 성공 모달용 발송 정보 저장 (초기화 전에!)
    const sendInfoText = _sendTimeOption === 'now' ? '즉시 발송 완료' : 
                         _sendTimeOption === 'ai' ? `예약 완료 (${aiResult?.recommendedTime || 'AI 추천'})` :
                         `예약 완료 (${_customSendTime ? new Date(_customSendTime).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''})`;
    setSuccessSendInfo(sendInfoText);
    setSuccessChannel(selectedChannel);  // ★ #8 수정
    setSuccessTargetCount(aiResult?.target?.count || 0);  // ★ #8 수정
    setSuccessUnsubscribeCount(aiResult?.target?.unsubscribeCount || 0);  // ★ B8-08 수정
    
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
      alert(error.response?.data?.error || '캠페인 생성에 실패했습니다.');
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
  }) => {
    if (isSending || !customSendData) return;

    const _sendTimeOption = modalData.sendTimeOption;
    const _customSendTime = modalData.customSendTime;
    const _selectedCallback = modalData.selectedCallback;
    const _useIndividualCallback = modalData.useIndividualCallback;
    const _campaignName = modalData.campaignName;

    if (!_selectedCallback && !_useIndividualCallback) {
      alert('회신번호를 선택해주세요');
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
        await campaignsApi.send(campaignId);
      }

      // 모달 닫기 + 초기화
      setShowCustomSendModal(false);
      setShowAiCustomFlow(false);
      // ★ #8 수정: customSendData null 전에 채널/인원수 저장
      setSuccessChannel(customSendData?.channel || 'LMS');
      setSuccessTargetCount(customSendData?.estimatedCount || 0);
      setSuccessUnsubscribeCount(customSendData?.unsubscribeCount || 0);  // ★ B8-08 수정
      setCustomSendData(null);

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
        alert(error.response?.data?.error || '캠페인 생성에 실패했습니다.');
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
        alert('메시지를 선택해주세요');
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
          subject: selectedMsg.subject || '',  // ★ #7 수정: LMS/MMS 제목 누락 수정
          mmsImagePaths: mmsUploadedImages.map(img => img.serverPath),
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

  // 바이트 계산 함수 (한글 2byte, 영문/숫자 1byte)
  const calculateBytes = (text: string) => {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      bytes += char > 127 ? 2 : 1;
    }
    return bytes;
  };

  // SMS 90바이트로 잘린 메시지 반환
  const truncateToSmsBytes = (text: string, maxBytes: number = 90) => {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      bytes += char > 127 ? 2 : 1;
      if (bytes > maxBytes) return text.substring(0, i);
    }
    return text;
  };

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
    if (!isAd || ch === 'KAKAO') return msg;
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

  const messageBytes = calculateBytes(getFullMessage(directMessage));
  
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
          firstRecipient={spamFilterData.firstRecipient}
        />
      )}

      {/* AI 발송 방식 선택 모달 */}
      {showAiSendType && (
        <AiSendTypeModal
          onClose={() => { setShowAiSendType(false); setAiCampaignPrompt(''); }}
          initialPrompt={aiCampaignPrompt}
          onSelectHanjullo={(prompt) => {
            setShowAiSendType(false);
            setAiCampaignPrompt(prompt);
            handleAiCampaignGenerate(prompt);
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
              : 'bg-gradient-to-r from-red-500 to-rose-500 text-white'
          }`}>
            <span className="text-2xl">{toast.type === 'success' ? '✅' : '❌'}</span>
            <span className="font-medium text-lg">{toast.message}</span>
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
                  <div className="grid grid-cols-4 gap-3 filter blur-sm pointer-events-none select-none">
                    {dashboardCards.cards.map((card, i) => (
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

              {/* 정상 표시: 동적 카드 렌더링 */}
              {dashboardCards?.configured && dashboardCards?.hasCustomerData && (
                <div className={`grid ${dashboardCards.cardCount === 8 ? 'grid-cols-4 gap-3' : 'grid-cols-4 gap-3'}`}>
                  {dashboardCards.cards.map((card, i) => {
                    const color = CARD_COLORS[i % CARD_COLORS.length];
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
                    else if (card.type === 'sum') { displayVal = numVal >= 10000 ? `${(numVal / 10000).toFixed(0)}만` : numVal.toLocaleString(); suffix = '원'; }
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
              )}
            </div>
          </div>

          {/* ===== 우측 40%: 버튼 3개 세로 스택 ===== */}
          <div className="w-[40%] flex flex-col gap-4">
            {hideAi ? (
              <>
                <button 
                  onClick={() => { setShowDirectTargeting(true); loadEnabledFields(); }}
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
                  className="p-5 bg-green-700 hover:bg-green-800 rounded-xl transition-all hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed text-right flex-1 flex flex-col justify-between relative"
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
                        <div className="text-xl font-bold text-white mb-1">AI 추천 발송</div>
                        <div className="text-sm text-green-200">자연어로 AI가 자동 설계</div>
                      </div>
                      <div className="text-3xl text-green-300 self-end">→</div>
                    </>
                  )}
                </button>

                {/* 직접 타겟 발송 */}
                <button 
                  onClick={() => { if (isSubscriptionLocked) { setShowSubscriptionLock(true); return; } setShowDirectTargeting(true); loadEnabledFields(); }}
                  className={`p-5 bg-amber-500 hover:bg-amber-600 rounded-xl transition-all hover:shadow-lg text-right flex-1 flex flex-col justify-between ${isSubscriptionLocked ? 'opacity-60' : ''}`}
                >
                  <div>
                    <div className="text-xl font-bold text-white mb-1">{isSubscriptionLocked ? '🔒 ' : ''}직접 타겟 발송</div>
                    <div className="text-sm text-amber-100">원하는 고객을 직접 필터링</div>
                  </div>
                  <div className="text-3xl text-amber-200 self-end">→</div>
                </button>

                {/* 고객 DB 업로드 */}
                <button 
                  onClick={() => { if (isSubscriptionLocked) { setShowSubscriptionLock(true); return; } setShowFileUpload(true); }}
                  className={`p-5 bg-slate-600 hover:bg-slate-700 rounded-xl transition-all hover:shadow-lg text-right flex-1 flex flex-col justify-between ${isSubscriptionLocked ? 'opacity-60' : ''}`}
                >
                  <div>
                    <div className="text-xl font-bold text-white mb-1">{isSubscriptionLocked ? '🔒 ' : ''}고객 DB 업로드</div>
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
                      <option value="KAKAO">카카오 알림톡</option>
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
                  onClick={() => alert('캠페인 목록 페이지로 이동 (개발 예정)')}
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
        {showCustomerDB && <CustomerDBModal onClose={() => setShowCustomerDB(false)} token={localStorage.getItem('token')} />}
        {showCalendar && <CalendarModal onClose={() => setShowCalendar(false)} token={localStorage.getItem('token')} onEdit={(campaign) => {
          setShowCalendar(false);
          if (campaign._clone) {
            // 복제: AI 프롬프트에 캠페인 내용 복사
            setAiCampaignPrompt(campaign.description || campaign.campaign_name || '');
          } else {
            // 편집: 예약 캠페인이면 취소 안내
            alert(`예약 캠페인을 편집하려면 예약 대기 목록에서 취소 후 재생성해주세요.\n\n캠페인: ${campaign.campaign_name}`);
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
        {/* 직접 타겟 설정 모달 */}
        {showDirectTargeting && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl w-[700px] max-h-[95vh] overflow-hidden">
              {/* 헤더 */}
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-bold text-gray-800">직접 타겟 설정</h3>
                  <p className="text-sm text-gray-500 mt-0.5">필터 조건으로 대상 고객을 선택하세요</p>
                </div>
                <button 
                  onClick={() => { setShowDirectTargeting(false); resetTargetFilters(); }}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* 필터 영역 */}
              <div className="p-6 space-y-4 overflow-y-auto max-h-[65vh]">
                {/* 수신번호 필드 (phone 고정) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">수신번호 필드</label>
                  <div className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-gray-50 text-gray-700 text-sm">
                    📱 phone (전화번호)
                  </div>
                </div>

                <div className="border-t border-gray-100"></div>

                {/* 필터 조건 헤더 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700">필터 조건</span>
                    {Object.keys(targetFilters).length > 0 && (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-medium">
                        {Object.values(targetFilters).filter(v => v).length}개 적용
                      </span>
                    )}
                  </div>
                  <button onClick={resetTargetFilters} className="text-xs text-green-600 hover:text-green-700 font-medium">초기화</button>
                </div>

                {/* 아코디언 필터 */}
                {enabledFields.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    필터 항목을 로딩 중...
                  </div>
                ) : (
                  (() => {
                    // 카테고리 아이콘 (UI 표시용, 영문 키 기준)
                    const CAT_ICONS: Record<string, string> = {
                      basic: '📋', purchase: '💰', store: '🏪',
                      membership: '🏷️', marketing: '📱', custom: '🔧',
                    };
                    // 필터 대상에서 제외할 필드 (식별용/수신동의는 별도 처리)
                    const SKIP_FIELDS = ['name', 'phone', 'email', 'address', 'sms_opt_in'];
                    const filterableFields = enabledFields.filter((f: any) => !SKIP_FIELDS.includes(f.field_key));
                    
                    // 연령대 프리셋
                    const AGE_OPTIONS = [
                      { label: '20대', value: '20' }, { label: '30대', value: '30' },
                      { label: '40대', value: '40' }, { label: '50대', value: '50' },
                      { label: '60대 이상', value: '60' },
                    ];
                    // 금액 프리셋
                    const AMOUNT_OPTIONS = [
                      { label: '5만원 이상', value: '50000' }, { label: '10만원 이상', value: '100000' },
                      { label: '50만원 이상', value: '500000' }, { label: '100만원 이상', value: '1000000' },
                      { label: '500만원 이상', value: '5000000' },
                    ];
                    // 일수 프리셋
                    const DAYS_OPTIONS = [
                      { label: '7일 이내', value: '7' }, { label: '30일 이내', value: '30' },
                      { label: '90일 이내', value: '90' }, { label: '180일 이내', value: '180' },
                      { label: '1년 이내', value: '365' },
                    ];

                    const renderInput = (field: any) => {
                      const val = targetFilters[field.field_key] || '';
                      const set = (v: string) => setTargetFilters(prev => {
                        if (!v) { const next = {...prev}; delete next[field.field_key]; return next; }
                        return {...prev, [field.field_key]: v};
                      });
                      const selectClass = "w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm bg-white";

                      // 연령대 특수 처리
                      if (field.field_key === 'age_group') {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">전체</option>
                            {AGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        );
                      }

                      // 문자열 + DB 옵션 → 드롭다운
                      if (field.data_type === 'string' && filterOptions[field.field_key]?.length) {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">전체</option>
                            {filterOptions[field.field_key].map((opt: string) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        );
                      }

                      // 금액 필드 → 프리셋 드롭다운
                      if (field.data_type === 'number' && ['total_purchase_amount', 'avg_order_value'].includes(field.field_key)) {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">전체</option>
                            {AMOUNT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        );
                      }

                      // 숫자 필드 → 직접 입력
                      if (field.data_type === 'number') {
                        return (
                          <input type="number" value={val} onChange={e => set(e.target.value)}
                            placeholder="이상" className={selectClass} />
                        );
                      }

                      // 날짜 필드 → 일수 드롭다운
                      if (field.data_type === 'date') {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">전체</option>
                            {DAYS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        );
                      }

                      // 불리언
                      if (field.data_type === 'boolean') {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">전체</option>
                            <option value="true">예</option>
                            <option value="false">아니오</option>
                          </select>
                        );
                      }

                      // 기본: 텍스트 입력
                      return (
                        <input type="text" value={val} onChange={e => set(e.target.value)}
                          placeholder="입력" className={selectClass} />
                      );
                    };

                    return (
                      <div className="space-y-2">
                        {(() => {
                          // 실제 필드에 있는 카테고리만 순서대로 표시
                          const categoryOrder = ['basic', 'purchase', 'store', 'membership', 'marketing', 'custom'];
                          const usedCategories = [...new Set(filterableFields.map((f: any) => f.category))];
                          const orderedCategories = categoryOrder.filter(c => usedCategories.includes(c));
                          // categoryOrder에 없는 카테고리도 표시
                          const extraCategories = usedCategories.filter(c => !categoryOrder.includes(c));
                          return [...orderedCategories, ...extraCategories].map(cat => {
                            const label = `${CAT_ICONS[cat] || '📌'} ${categoryLabels[cat] || cat}`;
                            const catFields = filterableFields.filter((f: any) => f.category === cat);
                          if (catFields.length === 0) return null;
                          const activeCount = catFields.filter((f: any) => targetFilters[f.field_key]).length;
                          const isExpanded = expandedCats[cat] ?? false;

                          return (
                            <div key={cat} className="border border-gray-200 rounded-lg overflow-hidden">
                              <button
                                type="button"
                                onClick={() => setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] }))}
                                className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-gray-700">{label}</span>
                                  <span className="text-xs text-gray-400">({catFields.length})</span>
                                  {activeCount > 0 && (
                                    <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-semibold">{activeCount}</span>
                                  )}
                                </div>
                                <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                              {isExpanded && (
                                <div className="p-4 bg-white grid grid-cols-2 gap-3 border-t border-gray-100">
                                  {catFields.map((field: any) => (
                                    <div key={field.field_key}>
                                      <label className="block text-xs text-gray-500 mb-1.5">{field.display_name}</label>
                                      {renderInput(field)}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                          });
                        })()}
                      </div>
                    );
                  })()
                )}

                {/* 수신동의 */}
                <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                  <input 
                    type="checkbox" 
                    id="targetSmsOptIn" 
                    checked={targetSmsOptIn}
                    onChange={(e) => setTargetSmsOptIn(e.target.checked)}
                    className="w-4 h-4 text-green-600 rounded focus:ring-green-500" 
                  />
                  <label htmlFor="targetSmsOptIn" className="text-sm text-gray-700">수신동의 고객만 포함</label>
                </div>

                {/* 조회 버튼 */}
                <button
                  onClick={loadTargetCount}
                  disabled={targetCountLoading}
                  className="w-full py-2.5 border border-green-600 text-green-700 rounded-lg hover:bg-green-50 transition-colors font-medium disabled:opacity-50"
                >
                  {targetCountLoading ? '조회 중...' : '대상 인원 조회'}
                </button>
              </div>

              {/* 푸터 - 대상 인원 + 버튼 */}
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                      <Users className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">대상 인원</div>
                      <div className="text-2xl font-bold text-green-700">
                        {targetCountLoading ? '...' : targetCount.toLocaleString()}
                        <span className="text-base font-normal text-gray-500 ml-1">명</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setShowDirectTargeting(false); resetTargetFilters(); }}
                      className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors font-medium"
                    >
                      취소
                    </button>
                    <button
                      onClick={handleTargetExtract}
                      disabled={targetCount === 0}
                      className="px-6 py-2.5 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Users className="w-4 h-4" />
                      타겟 추출
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

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
      {/* 직접발송 모달 */}
      {/* 직접 타겟 발송 모달 */}
      {showTargetSend && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[1400px] max-h-[95vh] overflow-y-auto">
            {/* 헤더 */}
            <div className="px-6 py-4 border-b flex justify-between items-center bg-green-50">
              <div>
                <h3 className="text-xl font-bold text-gray-800">직접 타겟 발송</h3>
                <p className="text-base text-gray-500 mt-1">추출된 <span className="font-bold text-emerald-600">{targetRecipients.length.toLocaleString()}명</span>에게 메시지를 발송합니다</p>
              </div>
              <button 
                onClick={() => { setShowTargetSend(false); setTargetRecipients([]); setTargetMessage(''); setTargetSubject(''); setKakaoMessage(''); setTargetSendChannel('sms'); }}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* 본문 */}
            <div className="px-6 py-5 flex gap-5">
              {/* 좌측: 메시지 작성 */}
              <div className="w-[400px]">
                {/* 채널 선택 탭 */}
                <div className="flex mb-2 bg-gray-100 rounded-lg p-1 gap-0.5">
                  {([
                    { key: 'sms' as const, label: '📱 문자' },
                    { key: 'kakao_brand' as const, label: '💬 브랜드MSG' },
                    { key: 'kakao_alimtalk' as const, label: '🔔 알림톡' },
                  ] as const).map(ch => (
                    <button key={ch.key}
                      onClick={() => { setTargetSendChannel(ch.key); if (ch.key === 'sms') setMmsUploadedImages([]); }}
                      className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                        targetSendChannel === ch.key 
                          ? ch.key === 'sms' ? 'bg-white shadow text-emerald-600' 
                            : ch.key === 'kakao_brand' ? 'bg-white shadow text-yellow-700' 
                            : 'bg-white shadow text-blue-600'
                          : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >{ch.label}</button>
                  ))}
                </div>

                {/* === SMS 채널 === */}
                {targetSendChannel === 'sms' && (<>
                {/* SMS/LMS/MMS 서브탭 */}
                <div className="flex mb-2 bg-gray-50 rounded-lg p-0.5">
                  <button 
                    onClick={() => { setTargetMsgType('SMS'); setMmsUploadedImages([]); }}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${targetMsgType === 'SMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    SMS
                  </button>
                  <button 
                    onClick={() => { setTargetMsgType('LMS'); setMmsUploadedImages([]); }}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${targetMsgType === 'LMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    LMS
                  </button>
                  <button 
                    onClick={() => setTargetMsgType('MMS')}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${targetMsgType === 'MMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    MMS
                  </button>
                </div>

                {/* SMS 메시지 작성 영역 */}
                <div className="border-2 border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                  {/* LMS/MMS 제목 */}
                  {(targetMsgType === 'LMS' || targetMsgType === 'MMS') && (
                    <div className="px-4 pt-3">
                      <input
                        type="text"
                        value={targetSubject}
                        onChange={(e) => setTargetSubject(e.target.value)}
                        placeholder="제목 (필수)"
                        className="w-full px-3 py-2 border border-orange-300 bg-orange-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 placeholder-orange-400"
                      />
                    </div>
                  )}
                  
                  {/* 메시지 입력 */}
                  <div className="p-4">
                    <div className="relative">
                      {adTextEnabled && (
                        <span className="absolute left-0 top-0 text-sm text-orange-600 font-medium pointer-events-none select-none">(광고) </span>
                      )}
                      <textarea
                        value={targetMessage}
                        onChange={(e) => setTargetMessage(e.target.value)}
                        placeholder="전송하실 내용을 입력하세요."
                        style={adTextEnabled ? { textIndent: '42px' } : {}}
                        className={`w-full resize-none border-0 focus:outline-none text-sm leading-relaxed ${targetMsgType === 'SMS' ? 'h-[180px]' : 'h-[140px]'}`}
                      />
                    </div>
                    {/* 무료거부 표기 */}
                    {adTextEnabled && (
                      <div className="text-sm text-orange-600 mt-1">
                        {targetMsgType === 'SMS' 
                          ? `무료거부${optOutNumber.replace(/-/g, '')}` 
                          : `무료수신거부 ${formatRejectNumber(optOutNumber)}`}
                      </div>
                    )}
                    {/* 특수문자/이모지 안내 */}
                    <div className="text-xs text-gray-400 mt-2">
                      ⚠️ 이모지(😀)·특수문자는 LMS 전환 또는 발송 실패 원인이 될 수 있습니다
                    </div>
                  </div>
                  
                  {/* 버튼들 + 바이트 표시 */}
                  <div className="px-3 py-1.5 bg-gray-50 border-t flex items-center justify-between">
                    <div className="flex items-center gap-0.5">
                      <button onClick={handleAiMsgHelper} className="px-2 py-1 text-xs bg-gradient-to-r from-violet-500 to-blue-500 text-white rounded hover:from-violet-600 hover:to-blue-600 flex items-center gap-0.5 shadow-sm"><Sparkles className="w-3 h-3" />AI추천</button>
                      <button onClick={() => setShowSpecialChars('target')} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">특수문자</button>
                      <button onClick={() => { loadTemplates(); setShowTemplateBox('target'); }} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">보관함</button>
                      <button onClick={() => { if (!targetMessage.trim()) { setToast({show: true, type: 'error', message: '저장할 메시지를 먼저 입력해주세요.'}); setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000); return; } setTemplateSaveName(''); setShowTemplateSave('target'); }} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">문자저장</button>
                    </div>
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      <span className={`font-bold ${(() => {
                        const optOutText = targetMsgType === 'SMS' 
                          ? `무료거부${optOutNumber.replace(/-/g, '')}` 
                          : `무료수신거부 ${formatRejectNumber(optOutNumber)}`;
                        const fullMsg = adTextEnabled ? `${targetMsgType === 'SMS' ? '(광고)' : '(광고) '}${targetMessage}\n${optOutText}` : targetMessage;
                        const bytes = calculateBytes(fullMsg);
                        const max = targetMsgType === 'SMS' ? 90 : 2000;
                        return bytes > max ? 'text-red-500' : 'text-emerald-600';
                      })()}`}>
                        {(() => {
                          const optOutText = targetMsgType === 'SMS' 
                            ? `무료거부${optOutNumber.replace(/-/g, '')}` 
                            : `무료수신거부 ${formatRejectNumber(optOutNumber)}`;
                          const fullMsg = adTextEnabled ? `${targetMsgType === 'SMS' ? '(광고)' : '(광고) '}${targetMessage}\n${optOutText}` : targetMessage;
                          return calculateBytes(fullMsg);
                        })()}
                      </span>/{targetMsgType === 'SMS' ? 90 : 2000}byte
                    </span>
                  </div>
                  
                  {/* 회신번호 선택 */}
                  <div className="px-3 py-1.5 border-t">
                    <select 
                      value={useIndividualCallback ? '__individual__' : selectedCallback}
                      onChange={(e) => {
                        if (e.target.value === '__individual__') {
                          setUseIndividualCallback(true);
                          setSelectedCallback('');
                        } else {
                          setUseIndividualCallback(false);
                          setSelectedCallback(e.target.value);
                        }
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="">회신번호 선택</option>
                      <option value="__individual__">📱 개별회신번호 (고객별 매장번호)</option>
                      {callbackNumbers.map((cb) => (
                        <option key={cb.id} value={cb.phone}>
                        {formatPhoneNumber(cb.phone)} {cb.label ? `(${cb.label})` : ''} {cb.is_default ? '⭐' : ''}
                      </option>
                      ))}
                    </select>
                    {useIndividualCallback && (
                      <p className="text-xs text-blue-600 mt-1">💡 각 고객의 주이용매장 회신번호로 발송됩니다</p>
                    )}
                  </div>

                  {/* 자동입력 드롭다운 */}
                  <div className="px-3 py-1.5 border-t bg-gray-50">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-gray-700 whitespace-nowrap">자동입력</span>
                      <select 
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            setTargetMessage(prev => prev + e.target.value);
                          }
                        }}
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="">변수 선택</option>
                        <option value="%이름%">이름</option>
                        <option value="%등급%">등급</option>
                        <option value="%지역%">지역</option>
                        <option value="%구매금액%">구매금액</option>
                        <option value="%회신번호%">회신번호</option>
                      </select>
                    </div>
                  </div>
                  
                  {/* MMS 이미지 업로드 영역 */}
                  {(targetMsgType === 'MMS' || mmsUploadedImages.length > 0) && (
                    <div className="px-3 py-2 border-t bg-amber-50/50 cursor-pointer hover:bg-amber-100/50 transition-colors" onClick={() => setShowMmsUploadModal(true)}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-600">🖼️ MMS 이미지</span>
                        {mmsUploadedImages.length > 0 ? (
                          <div className="flex items-center gap-1">
                            {mmsUploadedImages.map((img, idx) => (
                              <img key={idx} src={img.url} alt="" className="w-10 h-10 object-cover rounded border" />
                            ))}
                            <span className="text-xs text-purple-600 ml-1">✏️ 수정</span>
                          </div>
                        ) : (
                          <span className="text-xs text-amber-600">클릭하여 이미지 첨부 →</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 미리보기 + 스팸필터 버튼 */}
                  <div className="px-3 py-1.5 border-t">
                    <div className="grid grid-cols-2 gap-2">
                    <button 
                        onClick={() => {
                          if (!targetMessage.trim()) {
                            alert('메시지를 입력해주세요');
                            return;
                          }
                          setDirectMessage(targetMessage);
                          setDirectMsgType(targetMsgType);
                          setDirectSubject(targetSubject);
                          setShowDirectPreview(true);
                        }}
                        className="py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        📄 미리보기
                      </button>
                      <button 
                        onClick={() => {
                          const msg = targetMessage || '';
                          const cb = selectedCallback || '';
                          // ★ 리스트 최상단 고객 데이터로 미리보기 치환
                          const firstR = targetRecipients[0];
                          const replaceVars = (text: string) => {
                            if (!text || !firstR) return text;
                            return text
                              .replace(/%이름%/g, firstR.name || '')
                              .replace(/%등급%/g, firstR.grade || '')
                              .replace(/%지역%/g, firstR.region || '')
                              .replace(/%매장명%/g, firstR.store_name || '')
                              .replace(/%포인트%/g, firstR.point != null ? String(firstR.point) : '')
                              .replace(/%기타1%/g, firstR.extra1 || '')
                              .replace(/%기타2%/g, firstR.extra2 || '')
                              .replace(/%기타3%/g, firstR.extra3 || '');
                          };
                          const smsRaw = adTextEnabled ? `(광고)${msg}\n무료거부${optOutNumber.replace(/-/g, '')}` : msg;
                          const lmsRaw = adTextEnabled ? `(광고) ${msg}\n무료수신거부 ${optOutNumber}` : msg;
                          const smsMsg = replaceVars(smsRaw);
                          const lmsMsg = replaceVars(lmsRaw);
                          setSpamFilterData({sms: smsMsg, lms: lmsMsg, callback: cb, msgType: targetMsgType, firstRecipient: firstR || undefined});
                          setShowSpamFilter(true);
                        }}
                        className="py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                      >
                        🛡️ 스팸필터테스트
                      </button>
                    </div>
                  </div>
                  
                  {/* 예약/분할/광고 옵션 - 3분할 2줄 */}
                  <div className="px-3 py-2 border-t">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                      {/* 예약전송 */}
                      <div className={`rounded-lg p-3 text-center ${reserveEnabled ? 'bg-blue-50' : 'bg-gray-50'}`}>
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={reserveEnabled}
                            onChange={(e) => {
                              setReserveEnabled(e.target.checked);
                              if (e.target.checked) setShowReservePicker(true);
                            }}
                            className="rounded w-4 h-4" 
                          />
                          <span className={`font-medium ${reserveEnabled ? 'text-blue-700' : ''}`}>예약전송</span>
                        </label>
                        <div 
                          className={`mt-1.5 text-xs cursor-pointer ${reserveEnabled ? 'text-blue-600 font-medium' : 'text-gray-400'}`}
                          onClick={() => reserveEnabled && setShowReservePicker(true)}
                        >
                          {reserveDateTime 
                            ? new Date(reserveDateTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : '예약시간 선택'}
                        </div>
                      </div>
                      {/* 분할전송 */}
                      <div className={`rounded-lg p-3 text-center ${splitEnabled ? 'bg-purple-50' : 'bg-gray-50'}`}>
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                          <input 
                            type="checkbox" 
                            className="rounded w-4 h-4"
                            checked={splitEnabled}
                            onChange={(e) => setSplitEnabled(e.target.checked)}
                          />
                          <span className={`font-medium ${splitEnabled ? 'text-purple-700' : ''}`}>분할전송</span>
                        </label>
                        <div className="mt-1.5 flex items-center justify-center gap-1">
                          <input 
                            type="number" 
                            className="w-14 border rounded px-1.5 py-1 text-xs text-center" 
                            placeholder="1000"
                            value={splitCount}
                            onChange={(e) => setSplitCount(Number(e.target.value) || 1000)}
                            disabled={!splitEnabled}
                          />
                          <span className="text-xs text-gray-500">건/분</span>
                        </div>
                      </div>
                      {/* 광고/080 */}
                      <div className={`rounded-lg p-3 text-center ${adTextEnabled ? 'bg-orange-50' : 'bg-gray-50'}`}>
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={adTextEnabled}
                            onChange={(e) => handleAdToggle(e.target.checked)}
                            className="rounded w-4 h-4"
                          />
                          <span className={`font-medium ${adTextEnabled ? 'text-orange-700' : ''}`}>광고표기</span>
                        </label>
                        <div className={`mt-1.5 text-xs ${adTextEnabled ? 'text-orange-500' : 'text-gray-400'}`}>080 수신거부</div>
                      </div>
                    </div>
                  </div>
                  
                  {/* 전송하기 버튼 */}
                  <div className="px-3 py-2 border-t">
                    <button 
                      onClick={async () => {
                        if (targetRecipients.length === 0) {
                          alert('수신자가 없습니다');
                          return;
                        }
                        if (!targetMessage.trim()) {
                          alert('메시지를 입력해주세요');
                          return;
                        }
                        if (!selectedCallback && !useIndividualCallback) {
                          alert('회신번호를 선택해주세요');
                          return;
                        }
                        if (useIndividualCallback && targetRecipients.some((r: any) => !r.callback)) {
                          alert('개별회신번호가 없는 고객이 있습니다.\n일반 회신번호를 선택하거나 고객 데이터를 확인해주세요.');
                          return;
                        }
                        if ((targetMsgType === 'LMS' || targetMsgType === 'MMS') && !targetSubject.trim()) {
                          alert('제목을 입력해주세요');
                          return;
                        }

                        // 바이트 계산
                        const optOutText = targetMsgType === 'SMS' 
                          ? `무료거부${optOutNumber.replace(/-/g, '')}` 
                          : `무료수신거부 ${formatRejectNumber(optOutNumber)}`;
                        const fullMsg = adTextEnabled ? `${targetMsgType === 'SMS' ? '(광고)' : '(광고) '}${targetMessage}\n${optOutText}` : targetMessage;
                        const msgBytes = calculateBytes(fullMsg);

                        // SMS인데 90바이트 초과 시 예쁜 모달로 전환 안내
                        if (targetMsgType === 'SMS' && msgBytes > 90 && !smsOverrideAccepted) {
                          setPendingBytes(msgBytes);
                          setShowLmsConfirm(true);
                          return;
                        }

                        // LMS/MMS인데 SMS로 보내도 되는 경우 비용 절감 안내
                        if (targetMsgType !== 'SMS') {
                          const smsOptOut = `무료거부${optOutNumber.replace(/-/g, '')}`;
                          const smsFullMsg = adTextEnabled ? `(광고)${targetMessage}\n${smsOptOut}` : targetMessage;
                          const smsBytes = calculateBytes(smsFullMsg);
                          if (smsBytes <= 90) {
                            setShowSmsConvert({show: true, from: 'target', currentBytes: msgBytes, smsBytes, count: targetRecipients.length});
                            return;
                          }
                        }

                        // 수신거부 체크
                        const token = localStorage.getItem('token');
                        const phones = targetRecipients.map((r: any) => r.phone);
                        const checkRes = await fetch('/api/unsubscribes/check', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ phones })
                        });
                        const checkData = await checkRes.json();
                        const unsubCount = checkData.unsubscribeCount || 0;

                        // 발송 확인 모달
                        setSendConfirm({
                          show: true,
                          type: reserveEnabled ? 'scheduled' : 'immediate',
                          count: targetRecipients.length - unsubCount,
                          unsubscribeCount: unsubCount,
                          dateTime: reserveEnabled && reserveDateTime ? reserveDateTime : undefined,
                          from: 'target',
                          msgType: targetMsgType
                        });
                        return;
                      }}
                      disabled={targetSending}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-base transition-colors disabled:opacity-50"
                    >
                      {targetSending ? '발송 중...' : '전송하기'}
                    </button>
                  </div>
                </div>
                </>)}

                {/* === 카카오 브랜드메시지 채널 === */}
                {targetSendChannel === 'kakao_brand' && (
                  <div className="border-2 border-yellow-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                    {/* 카카오 메시지 입력 */}
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">💬</span>
                        <span className="text-sm font-semibold text-yellow-800">브랜드메시지 (자유형)</span>
                      </div>
                      <textarea
                        value={kakaoMessage}
                        onChange={(e) => setKakaoMessage(e.target.value)}
                        placeholder={"카카오 브랜드메시지 내용을 입력하세요.\n\n이모지 사용 가능 😊\n최대 4,000자"}
                        className="w-full h-[200px] resize-none border border-yellow-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-yellow-400 text-sm leading-relaxed p-3 bg-yellow-50/30"
                      />
                      <div className="text-xs text-gray-400 mt-1">
                        💡 이모지·특수문자 사용 가능 | 광고표기는 백엔드에서 자동 처리됩니다
                      </div>
                    </div>
                    {/* 바이트/글자수 표시 */}
                    <div className="px-3 py-1.5 bg-yellow-50 border-t flex items-center justify-between">
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => setShowSpecialChars('target')} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">특수문자</button>
                        <button onClick={() => { loadTemplates(); setShowTemplateBox('target'); }} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">보관함</button>
                      </div>
                      <span className="text-xs text-gray-500">
                        <span className={`font-bold ${kakaoMessage.length > 4000 ? 'text-red-500' : 'text-yellow-600'}`}>{kakaoMessage.length}</span>/4,000자
                      </span>
                    </div>
                    {/* 회신번호 (카카오는 발신프로필 기반이므로 참조용) */}
                    <div className="px-3 py-1.5 border-t">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>💬</span>
                        <span>카카오 발신프로필로 발송됩니다 (설정에서 관리)</span>
                      </div>
                    </div>
                    {/* 자동입력 변수 */}
                    <div className="px-3 py-1.5 border-t bg-yellow-50/50">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-gray-700 whitespace-nowrap">자동입력</span>
                        <select 
                          value=""
                          onChange={(e) => { if (e.target.value) setKakaoMessage(prev => prev + e.target.value); }}
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                        >
                          <option value="">변수 선택</option>
                          <option value="%이름%">이름</option>
                          <option value="%등급%">등급</option>
                          <option value="%지역%">지역</option>
                          <option value="%구매금액%">구매금액</option>
                        </select>
                      </div>
                    </div>
                    {/* 예약/분할/광고 옵션 */}
                    <div className="px-3 py-2 border-t">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className={`rounded-lg p-3 text-center ${reserveEnabled ? 'bg-blue-50' : 'bg-gray-50'}`}>
                          <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                            <input type="checkbox" checked={reserveEnabled} onChange={(e) => { setReserveEnabled(e.target.checked); if (e.target.checked) setShowReservePicker(true); }} className="rounded w-4 h-4" />
                            <span className={`font-medium ${reserveEnabled ? 'text-blue-700' : ''}`}>예약전송</span>
                          </label>
                          <div className={`mt-1.5 text-xs cursor-pointer ${reserveEnabled ? 'text-blue-600 font-medium' : 'text-gray-400'}`} onClick={() => reserveEnabled && setShowReservePicker(true)}>
                            {reserveDateTime ? new Date(reserveDateTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '예약시간 선택'}
                          </div>
                        </div>
                        <div className={`rounded-lg p-3 text-center ${splitEnabled ? 'bg-purple-50' : 'bg-gray-50'}`}>
                          <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                            <input type="checkbox" className="rounded w-4 h-4" checked={splitEnabled} onChange={(e) => setSplitEnabled(e.target.checked)} />
                            <span className={`font-medium ${splitEnabled ? 'text-purple-700' : ''}`}>분할전송</span>
                          </label>
                          <div className="mt-1.5 flex items-center justify-center gap-1">
                            <input type="number" className="w-14 border rounded px-1.5 py-1 text-xs text-center" placeholder="1000" value={splitCount} onChange={(e) => setSplitCount(Number(e.target.value) || 1000)} disabled={!splitEnabled} />
                            <span className="text-xs text-gray-500">건/분</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* 전송하기 버튼 */}
                    <div className="px-3 py-2 border-t">
                      <button 
                        onClick={async () => {
                          if (targetRecipients.length === 0) { alert('수신자가 없습니다'); return; }
                          if (!kakaoMessage.trim()) { alert('메시지를 입력해주세요'); return; }
                          if (kakaoMessage.length > 4000) { alert('카카오 메시지는 4,000자 이내로 입력해주세요'); return; }
                          if (!kakaoEnabled) { alert('카카오 발송이 활성화되지 않았습니다. 관리자에게 문의해주세요.'); return; }
                          const token = localStorage.getItem('token');
                          const phones = targetRecipients.map((r: any) => r.phone);
                          const checkRes = await fetch('/api/unsubscribes/check', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ phones }) });
                          const checkData = await checkRes.json();
                          const unsubCount = checkData.unsubscribeCount || 0;
                          setSendConfirm({ show: true, type: reserveEnabled ? 'scheduled' : 'immediate', count: targetRecipients.length - unsubCount, unsubscribeCount: unsubCount, dateTime: reserveEnabled && reserveDateTime ? reserveDateTime : undefined, from: 'target', msgType: '카카오' });
                        }}
                        disabled={targetSending || (!kakaoEnabled)}
                        className={`w-full py-2.5 rounded-xl font-bold text-base transition-colors disabled:opacity-50 ${
                          kakaoEnabled ? 'bg-yellow-500 hover:bg-yellow-600 text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        }`}
                      >
                        {targetSending ? '발송 중...' : !kakaoEnabled ? '🔒 카카오 발송 준비중' : '💬 전송하기'}
                      </button>
                      {!kakaoEnabled && (
                        <p className="text-xs text-center text-gray-400 mt-1.5">카카오 발송 활성화는 관리자에게 문의해주세요</p>
                      )}
                    </div>
                  </div>
                )}

                {/* === 카카오 알림톡 채널 === */}
                {targetSendChannel === 'kakao_alimtalk' && (
                  <div className="border-2 border-blue-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-lg">🔔</span>
                        <span className="text-sm font-semibold text-blue-800">알림톡 (템플릿 기반)</span>
                      </div>
                      {/* 템플릿 목록 */}
                      {kakaoTemplates.length === 0 ? (
                        <div className="text-center py-12">
                          <div className="text-4xl mb-3">📋</div>
                          <p className="text-sm text-gray-500 font-medium">등록된 알림톡 템플릿이 없습니다</p>
                          <p className="text-xs text-gray-400 mt-1">설정 → 카카오 프로필 관리에서 템플릿을 등록해주세요</p>
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-[300px] overflow-y-auto">
                          {kakaoTemplates.map((t: any) => (
                            <div key={t.id}
                              onClick={() => {
                                setKakaoSelectedTemplate(t);
                                const vars: Record<string, string> = {};
                                (t.content?.match(/#{[^}]+}/g) || []).forEach((v: string) => { vars[v] = ''; });
                                setKakaoTemplateVars(vars);
                              }}
                              className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                                kakaoSelectedTemplate?.id === t.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">{t.template_name}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${t.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                  {t.status === 'approved' ? '승인' : t.status}
                                </span>
                              </div>
                              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{t.content}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* 선택된 템플릿 변수 매핑 */}
                      {kakaoSelectedTemplate && Object.keys(kakaoTemplateVars).length > 0 && (
                        <div className="mt-3 pt-3 border-t">
                          <p className="text-xs font-semibold text-gray-600 mb-2">변수 매핑</p>
                          {Object.keys(kakaoTemplateVars).map(varKey => (
                            <div key={varKey} className="flex items-center gap-2 mb-1.5">
                              <span className="text-xs text-blue-600 font-mono w-24 shrink-0">{varKey}</span>
                              <input
                                type="text"
                                value={kakaoTemplateVars[varKey]}
                                onChange={(e) => setKakaoTemplateVars(prev => ({...prev, [varKey]: e.target.value}))}
                                placeholder="값 입력"
                                className="flex-1 border rounded px-2 py-1 text-xs"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* 전송하기 버튼 */}
                    <div className="px-3 py-2 border-t">
                      <button
                        disabled={true}
                        className="w-full py-2.5 bg-gray-300 text-gray-500 rounded-xl font-bold text-base cursor-not-allowed"
                      >
                        🔒 알림톡 발송 준비중
                      </button>
                      <p className="text-xs text-center text-gray-400 mt-1.5">알림톡 발송 기능은 준비 중입니다</p>
                    </div>
                  </div>
                )}
              </div>
              
                        
              {/* 우측: 수신자 목록 */}
              <div className="flex-1 flex flex-col">
                {/* 헤더 */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-gray-800">수신자 목록</span>
                    <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-sm font-medium">
                      총 {targetRecipients.length.toLocaleString()}건
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="🔍 수신번호 검색"
                      value={targetListSearch}
                      onChange={(e) => { setTargetListSearch(e.target.value); setTargetListPage(0); }}
                      className="border rounded-lg px-3 py-1.5 text-sm w-48"
                    />
                    <label className="flex items-center gap-1 text-sm text-gray-600">
                      <input type="checkbox" defaultChecked className="rounded" />
                      중복제거
                    </label>
                    <label className="flex items-center gap-1 text-sm text-gray-600">
                      <input type="checkbox" defaultChecked className="rounded" />
                      수신거부제거
                    </label>
                  </div>
                </div>

                {/* 테이블 */}
                <div className="flex-1 border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-medium text-gray-600">수신번호</th>
                        <th className="px-4 py-2.5 text-left font-medium text-gray-600">이름</th>
                        <th className="px-4 py-2.5 text-left font-medium text-gray-600">등급</th>
                        <th className="px-4 py-2.5 text-left font-medium text-gray-600">지역</th>
                        <th className="px-4 py-2.5 text-left font-medium text-gray-600">구매금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const filtered = targetListSearch 
                          ? targetRecipients.filter(r => r.phone.includes(targetListSearch))
                          : targetRecipients;
                        const pageSize = 15;
                        const start = targetListPage * pageSize;
                        return filtered.slice(start, start + pageSize).map((r, idx) => (
                          <tr key={idx} className="border-t hover:bg-gray-50">
                            <td className="px-4 py-2 font-mono">{r.phone}</td>
                            <td className="px-4 py-2">{r.name || '-'}</td>
                            <td className="px-4 py-2">{r.grade || '-'}</td>
                            <td className="px-4 py-2">{r.region || '-'}</td>
                            <td className="px-4 py-2">{r.amount || '-'}</td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>

                {/* 페이징 */}
                <div className="mt-3 flex justify-center items-center gap-2">
                  {(() => {
                    const filtered = targetListSearch 
                      ? targetRecipients.filter(r => r.phone.includes(targetListSearch))
                      : targetRecipients;
                    const totalPages = Math.ceil(filtered.length / 15);
                    if (totalPages <= 1) return null;
                    
                    return (
                      <>
                        <button 
                          onClick={() => setTargetListPage(p => Math.max(0, p - 1))}
                          disabled={targetListPage === 0}
                          className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-50"
                        >
                          이전
                        </button>
                        <span className="text-sm text-gray-600">
                          {targetListPage + 1} / {totalPages} 페이지
                        </span>
                        <button 
                          onClick={() => setTargetListPage(p => Math.min(totalPages - 1, p + 1))}
                          disabled={targetListPage >= totalPages - 1}
                          className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-50"
                        >
                          다음
                        </button>
                      </>
                    );
                  })()}
                </div>

                {/* 하단 버튼 */}
                <div className="mt-3 flex justify-between items-center">
                  <div className="flex gap-2">
                    <button className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">중복제거</button>
                    <button className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">선택삭제</button>
                    <button 
                      onClick={() => setTargetRecipients([])}
                      className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
                    >
                      전체삭제
                    </button>
                  </div>
                  <button 
                    onClick={() => { setShowTargetSend(false); setShowDirectTargeting(true); }}
                    className="px-3 py-1.5 text-sm bg-gray-100 rounded-lg hover:bg-gray-200"
                  >
                    🔄 타겟 재설정
                  </button>
                </div>
                </div>
            </div>
          </div>
        </div>
      )}

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
                    alert('예약 시간을 선택해주세요');
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

      {showDirectSend && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[1400px] max-h-[95vh] overflow-y-auto">
            {/* 본문 */}
            <div className="px-6 py-5 flex gap-5">
              {/* 좌측: 메시지 작성 */}
              <div className="w-[400px]">
                {/* 채널 선택 탭 */}
                <div className="flex mb-2 bg-gray-100 rounded-lg p-1 gap-0.5">
                  {([
                    { key: 'sms' as const, label: '📱 문자' },
                    { key: 'kakao_brand' as const, label: '💬 브랜드MSG' },
                    { key: 'kakao_alimtalk' as const, label: '🔔 알림톡' },
                  ] as const).map(ch => (
                    <button key={ch.key}
                      onClick={() => { setDirectSendChannel(ch.key); if (ch.key === 'sms') setMmsUploadedImages([]); }}
                      className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                        directSendChannel === ch.key 
                          ? ch.key === 'sms' ? 'bg-white shadow text-emerald-600' 
                            : ch.key === 'kakao_brand' ? 'bg-white shadow text-yellow-700' 
                            : 'bg-white shadow text-blue-600'
                          : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >{ch.label}</button>
                  ))}
                </div>

                {/* === SMS 채널 === */}
                {directSendChannel === 'sms' && (<>
                {/* SMS/LMS/MMS 서브탭 */}
                <div className="flex mb-2 bg-gray-50 rounded-lg p-0.5">
                  <button 
                    onClick={() => { setDirectMsgType('SMS'); setMmsUploadedImages([]); }}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${directMsgType === 'SMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    SMS
                  </button>
                  <button 
                    onClick={() => { setDirectMsgType('LMS'); setMmsUploadedImages([]); }}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${directMsgType === 'LMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    LMS
                  </button>
                  <button 
                    onClick={() => setDirectMsgType('MMS')}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${directMsgType === 'MMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    MMS
                  </button>
                </div>

                {/* SMS 메시지 작성 영역 */}
                <div className="border-2 border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                  {/* LMS/MMS 제목 */}
                  {(directMsgType === 'LMS' || directMsgType === 'MMS') && (
                    <div className="px-4 pt-3">
                      <input
                        type="text"
                        value={directSubject}
                        onChange={(e) => setDirectSubject(e.target.value)}
                        placeholder="제목 (필수)"
                        className="w-full px-3 py-2 border border-orange-300 bg-orange-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 placeholder-orange-400"
                      />
                    </div>
                  )}
                  
                  {/* 메시지 입력 */}
                  <div className="p-4">
                    <div className="relative">
                      {adTextEnabled && (
                        <span className="absolute left-0 top-0 text-sm text-orange-600 font-medium pointer-events-none select-none">(광고) </span>
                      )}
                      <textarea
                        value={directMessage}
                        onChange={(e) => setDirectMessage(e.target.value)}
                        placeholder="전송하실 내용을 입력하세요."
                        style={adTextEnabled ? { textIndent: '42px' } : {}}
                        className={`w-full resize-none border-0 focus:outline-none text-sm leading-relaxed ${directMsgType === 'SMS' ? 'h-[180px]' : 'h-[140px]'}`}
                      />
                    </div>
                    {/* 무료거부 표기 */}
                    {adTextEnabled && (
                      <div className="text-sm text-orange-600 mt-1">
                        {directMsgType === 'SMS' 
                          ? `무료거부${optOutNumber.replace(/-/g, '')}` 
                          : `무료수신거부 ${formatRejectNumber(optOutNumber)}`}
                      </div>
                    )}
                    {/* 특수문자/이모지 안내 */}
                    <div className="text-xs text-gray-400 mt-2">
                      ⚠️ 이모지(😀)·특수문자는 LMS 전환 또는 발송 실패 원인이 될 수 있습니다
                    </div>
                    
                    {/* MMS 이미지 미리보기 */}
                    {(directMsgType === 'MMS' || mmsUploadedImages.length > 0) && (
                      <div className="mt-2 pt-2 border-t cursor-pointer hover:bg-amber-50/50 transition-colors rounded-lg p-2" onClick={() => setShowMmsUploadModal(true)}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-600">🖼️ MMS 이미지</span>
                          {mmsUploadedImages.length > 0 ? (
                            <div className="flex items-center gap-1">
                              {mmsUploadedImages.map((img, idx) => (
                                <img key={idx} src={img.url} alt="" className="w-10 h-10 object-cover rounded border" />
                              ))}
                              <span className="text-xs text-purple-600 ml-1">✏️ 수정</span>
                            </div>
                          ) : (
                            <span className="text-xs text-amber-600">클릭하여 이미지 첨부 →</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* 버튼들 + 바이트 표시 */}
                  <div className="px-3 py-1.5 bg-gray-50 border-t flex items-center justify-between">
                  <div className="flex items-center gap-0.5">
                      <button onClick={() => setShowSpecialChars('direct')} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">특수문자</button>
                      <button onClick={() => { loadTemplates(); setShowTemplateBox('direct'); }} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">보관함</button>
                      <button onClick={() => { if (!directMessage.trim()) { setToast({show: true, type: 'error', message: '저장할 메시지를 먼저 입력해주세요.'}); setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000); return; } setTemplateSaveName(''); setShowTemplateSave('direct'); }} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">문자저장</button>
                    </div>
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      <span className={`font-bold ${messageBytes > maxBytes ? 'text-red-500' : 'text-emerald-600'}`}>{messageBytes}</span>/{maxBytes}byte
                    </span>
                  </div>
                  
                  {/* 회신번호 선택 */}
                  <div className="px-3 py-1.5 border-t">
                    <select 
                      value={useIndividualCallback ? '__individual__' : selectedCallback}
                      onChange={(e) => {
                        if (e.target.value === '__individual__') {
                          setUseIndividualCallback(true);
                          setSelectedCallback('');
                        } else {
                          setUseIndividualCallback(false);
                          setSelectedCallback(e.target.value);
                        }
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="">회신번호 선택</option>
                      <option value="__individual__">📱 개별회신번호 (고객별 매장번호)</option>
                      {callbackNumbers.map((cb) => (
                        <option key={cb.id} value={cb.phone}>
                        {formatPhoneNumber(cb.phone)} {cb.label ? `(${cb.label})` : ''} {cb.is_default ? '⭐' : ''}
                      </option>
                      ))}
                    </select>
                    {useIndividualCallback && (
                      <p className="text-xs text-blue-600 mt-1">💡 각 고객의 주이용매장 회신번호로 발송됩니다</p>
                    )}
                  </div>

                  {/* 자동입력 버튼 */}
                  <div className="px-3 py-1.5 border-t bg-gray-50">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-gray-700 whitespace-nowrap">자동입력</span>
                      <div className="flex gap-2 flex-1">
                        <button onClick={() => setDirectMessage(prev => prev + '%이름%')} className="flex-1 py-2 text-sm bg-white border rounded-lg hover:bg-gray-100 font-medium">이름</button>
                        <button onClick={() => setDirectMessage(prev => prev + '%회신번호%')} className="flex-1 py-2 text-sm bg-white border rounded-lg hover:bg-blue-50 font-medium text-blue-700">회신번호</button>
                        <button onClick={() => setDirectMessage(prev => prev + '%기타1%')} className="flex-1 py-2 text-sm bg-white border rounded-lg hover:bg-gray-100 font-medium">기타1</button>
                        <button onClick={() => setDirectMessage(prev => prev + '%기타2%')} className="flex-1 py-2 text-sm bg-white border rounded-lg hover:bg-gray-100 font-medium">기타2</button>
                        <button onClick={() => setDirectMessage(prev => prev + '%기타3%')} className="flex-1 py-2 text-sm bg-white border rounded-lg hover:bg-gray-100 font-medium">기타3</button>
                      </div>
                    </div>
                  </div>
                  
                  {/* 미리보기 + 스팸필터 버튼 */}
                  <div className="px-3 py-1.5 border-t">
                    <div className="grid grid-cols-2 gap-2">
                    <button 
                        onClick={() => {
                          if (!directMessage.trim()) {
                            alert('메시지를 입력해주세요');
                            return;
                          }
                          setShowDirectPreview(true);
                        }}
                        className="py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        📄 미리보기
                      </button>
                      <button 
                        onClick={() => {
                          if (isSpamFilterLocked) { setShowSpamFilterLock(true); return; }
                          const msg = directMessage || '';
                          const cb = selectedCallback || '';
                          // ★ 리스트 최상단 고객 데이터로 미리보기 치환
                          const firstR = directRecipients[0];
                          const replaceVars = (text: string) => {
                            if (!text || !firstR) return text;
                            return text
                              .replace(/%이름%/g, firstR.name || '')
                              .replace(/%등급%/g, firstR.grade || '')
                              .replace(/%지역%/g, firstR.region || '')
                              .replace(/%매장명%/g, firstR.store_name || '')
                              .replace(/%포인트%/g, firstR.point != null ? String(firstR.point) : '')
                              .replace(/%기타1%/g, firstR.extra1 || '')
                              .replace(/%기타2%/g, firstR.extra2 || '')
                              .replace(/%기타3%/g, firstR.extra3 || '');
                          };
                          const smsRaw = adTextEnabled ? `(광고)${msg}\n무료거부${optOutNumber.replace(/-/g, '')}` : msg;
                          const lmsRaw = adTextEnabled ? `(광고) ${msg}\n무료수신거부 ${optOutNumber}` : msg;
                          const smsMsg = replaceVars(smsRaw);
                          const lmsMsg = replaceVars(lmsRaw);
                          setSpamFilterData({sms: smsMsg, lms: lmsMsg, callback: cb, msgType: directMsgType, firstRecipient: firstR || undefined});
                          setShowSpamFilter(true);
                        }}
                        className={`py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-colors ${isSpamFilterLocked ? 'opacity-60' : ''}`}
                      >
                        {isSpamFilterLocked ? '🔒' : '🛡️'} 스팸필터테스트
                      </button>
                    </div>
                  </div>
                  
                  {/* 예약/분할/광고 옵션 - 3분할 2줄 */}
                  <div className="px-3 py-2 border-t">
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {/* 예약전송 */}
                      <div className={`rounded-lg p-3 text-center ${reserveEnabled ? 'bg-blue-50' : 'bg-gray-50'}`}>
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={reserveEnabled}
                            onChange={(e) => {
                              setReserveEnabled(e.target.checked);
                              if (e.target.checked) setShowReservePicker(true);
                            }}
                            className="rounded w-4 h-4" 
                          />
                          <span className={`font-medium ${reserveEnabled ? 'text-blue-700' : ''}`}>예약전송</span>
                        </label>
                        <div 
                          className={`mt-1.5 text-xs cursor-pointer ${reserveEnabled ? 'text-blue-600 font-medium' : 'text-gray-400'}`}
                          onClick={() => reserveEnabled && setShowReservePicker(true)}
                        >
                          {reserveDateTime 
                            ? new Date(reserveDateTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : '예약시간 선택'}
                        </div>
                      </div>
                      {/* 분할전송 */}
                      <div className={`rounded-lg p-3 text-center ${splitEnabled ? 'bg-purple-50' : 'bg-gray-50'}`}>
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                          <input 
                            type="checkbox" 
                            className="rounded w-4 h-4"
                            checked={splitEnabled}
                            onChange={(e) => setSplitEnabled(e.target.checked)}
                          />
                          <span className={`font-medium ${splitEnabled ? 'text-purple-700' : ''}`}>분할전송</span>
                        </label>
                        <div className="mt-1.5 flex items-center justify-center gap-1">
                          <input 
                            type="number" 
                            className="w-14 border rounded px-1.5 py-1 text-xs text-center" 
                            placeholder="1000"
                            value={splitCount}
                            onChange={(e) => setSplitCount(Number(e.target.value) || 1000)}
                            disabled={!splitEnabled}
                          />
                          <span className="text-xs text-gray-500">건/분</span>
                        </div>
                      </div>
                      {/* 광고/080 */}
                      <div className={`rounded-lg p-3 text-center ${adTextEnabled ? 'bg-orange-50' : 'bg-gray-50'}`}>
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={adTextEnabled}
                            onChange={(e) => handleAdToggle(e.target.checked)}
                            className="rounded w-4 h-4"
                          />
                          <span className={`font-medium ${adTextEnabled ? 'text-orange-700' : ''}`}>광고표기</span>
                        </label>
                        <div className={`mt-1.5 text-xs ${adTextEnabled ? 'text-orange-500' : 'text-gray-400'}`}>080 수신거부</div>
                      </div>
                      </div>
                  </div>
                  
                  {/* 전송하기 버튼 */}
                  <div className="px-3 py-2 border-t">
                    <button 
                      onClick={async () => {
                        // 유효성 검사
                        if (directRecipients.length === 0) {
                          alert('수신자를 추가해주세요');
                          return;
                        }
                        if (!directMessage.trim()) {
                          alert('메시지를 입력해주세요');
                          return;
                        }
                        if (!selectedCallback && !useIndividualCallback) {
                          alert('회신번호를 선택해주세요');
                          return;
                        }
                        if (useIndividualCallback && directRecipients.some((r: any) => !r.callback)) {
                          alert('개별회신번호가 없는 수신자가 있습니다.\n일반 회신번호를 선택해주세요.');
                          return;
                        }
                        if ((directMsgType === 'LMS' || directMsgType === 'MMS') && !directSubject.trim()) {
                          alert('제목을 입력해주세요');
                          return;
                        }

                        // SMS 바이트 초과 시 LMS 전환 모달
                        if (directMsgType === 'SMS' && messageBytes > 90 && !smsOverrideAccepted) {
                          setPendingBytes(messageBytes);
                          setShowLmsConfirm(true);
                          return;
                        }

                        // LMS/MMS인데 SMS로 보내도 되는 경우 비용 절감 안내
                        if (directMsgType !== 'SMS') {
                          const smsOptOut = `무료거부${optOutNumber.replace(/-/g, '')}`;
                          const smsFullMsg = adTextEnabled ? `(광고)${directMessage}\n${smsOptOut}` : directMessage;
                          const smsBytes = calculateBytes(smsFullMsg);
                          if (smsBytes <= 90) {
                            setShowSmsConvert({show: true, from: 'direct', currentBytes: messageBytes, smsBytes, count: directRecipients.length});
                            return;
                          }
                        }

                        // 수신거부 체크
                        const token = localStorage.getItem('token');
                        const phones = directRecipients.map((r: any) => r.phone);
                        const checkRes = await fetch('/api/unsubscribes/check', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ phones })
                        });
                        const checkData = await checkRes.json();
                        const unsubCount = checkData.unsubscribeCount || 0;

                        setSendConfirm({
                          show: true,
                          type: reserveEnabled ? 'scheduled' : 'immediate',
                          count: directRecipients.length - unsubCount,
                          unsubscribeCount: unsubCount,
                          dateTime: reserveEnabled && reserveDateTime ? reserveDateTime : undefined,
                          from: 'direct',
                          msgType: directMsgType
                        });
                        return;
                      }}
                      className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-base transition-colors"
                    >
                      전송하기
                    </button>
                  </div>
                </div>
                </>)}

                {/* === 카카오 브랜드메시지 채널 === */}
                {directSendChannel === 'kakao_brand' && (
                  <div className="border-2 border-yellow-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                    {/* 카카오 메시지 입력 */}
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">💬</span>
                        <span className="text-sm font-semibold text-yellow-800">브랜드메시지 (자유형)</span>
                      </div>
                      <textarea
                        value={kakaoMessage}
                        onChange={(e) => setKakaoMessage(e.target.value)}
                        placeholder={"카카오 브랜드메시지 내용을 입력하세요.\n\n이모지 사용 가능 😊\n최대 4,000자"}
                        className="w-full h-[200px] resize-none border border-yellow-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-yellow-400 text-sm leading-relaxed p-3 bg-yellow-50/30"
                      />
                      <div className="text-xs text-gray-400 mt-1">
                        💡 이모지·특수문자 사용 가능 | 광고표기는 백엔드에서 자동 처리됩니다
                      </div>
                    </div>
                    {/* 글자수 표시 */}
                    <div className="px-3 py-1.5 bg-yellow-50 border-t flex items-center justify-between">
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => setShowSpecialChars('direct')} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">특수문자</button>
                        <button onClick={() => { loadTemplates(); setShowTemplateBox('direct'); }} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">보관함</button>
                      </div>
                      <span className="text-xs text-gray-500">
                        <span className={`font-bold ${kakaoMessage.length > 4000 ? 'text-red-500' : 'text-yellow-600'}`}>{kakaoMessage.length}</span>/4,000자
                      </span>
                    </div>
                    {/* 발신프로필 안내 */}
                    <div className="px-3 py-1.5 border-t">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>💬</span>
                        <span>카카오 발신프로필로 발송됩니다 (설정에서 관리)</span>
                      </div>
                    </div>
                    {/* 예약/분할 옵션 */}
                    <div className="px-3 py-2 border-t">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className={`rounded-lg p-3 text-center ${reserveEnabled ? 'bg-blue-50' : 'bg-gray-50'}`}>
                          <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                            <input type="checkbox" checked={reserveEnabled} onChange={(e) => { setReserveEnabled(e.target.checked); if (e.target.checked) setShowReservePicker(true); }} className="rounded w-4 h-4" />
                            <span className={`font-medium ${reserveEnabled ? 'text-blue-700' : ''}`}>예약전송</span>
                          </label>
                          <div className={`mt-1.5 text-xs cursor-pointer ${reserveEnabled ? 'text-blue-600 font-medium' : 'text-gray-400'}`} onClick={() => reserveEnabled && setShowReservePicker(true)}>
                            {reserveDateTime ? new Date(reserveDateTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '예약시간 선택'}
                          </div>
                        </div>
                        <div className={`rounded-lg p-3 text-center ${splitEnabled ? 'bg-purple-50' : 'bg-gray-50'}`}>
                          <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                            <input type="checkbox" className="rounded w-4 h-4" checked={splitEnabled} onChange={(e) => setSplitEnabled(e.target.checked)} />
                            <span className={`font-medium ${splitEnabled ? 'text-purple-700' : ''}`}>분할전송</span>
                          </label>
                          <div className="mt-1.5 flex items-center justify-center gap-1">
                            <input type="number" className="w-14 border rounded px-1.5 py-1 text-xs text-center" placeholder="1000" value={splitCount} onChange={(e) => setSplitCount(Number(e.target.value) || 1000)} disabled={!splitEnabled} />
                            <span className="text-xs text-gray-500">건/분</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* 전송하기 버튼 */}
                    <div className="px-3 py-2 border-t">
                      <button
                        onClick={async () => {
                          if (directRecipients.length === 0) { alert('수신자를 추가해주세요'); return; }
                          if (!kakaoMessage.trim()) { alert('메시지를 입력해주세요'); return; }
                          if (kakaoMessage.length > 4000) { alert('카카오 메시지는 4,000자 이내로 입력해주세요'); return; }
                          if (!kakaoEnabled) { alert('카카오 발송이 활성화되지 않았습니다. 관리자에게 문의해주세요.'); return; }
                          const token = localStorage.getItem('token');
                          const phones = directRecipients.map((r: any) => r.phone);
                          const checkRes = await fetch('/api/unsubscribes/check', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ phones }) });
                          const checkData = await checkRes.json();
                          const unsubCount = checkData.unsubscribeCount || 0;
                          setSendConfirm({ show: true, type: reserveEnabled ? 'scheduled' : 'immediate', count: directRecipients.length - unsubCount, unsubscribeCount: unsubCount, dateTime: reserveEnabled && reserveDateTime ? reserveDateTime : undefined, from: 'direct', msgType: '카카오' });
                        }}
                        disabled={!kakaoEnabled}
                        className={`w-full py-3 rounded-xl font-bold text-base transition-colors ${
                          kakaoEnabled ? 'bg-yellow-500 hover:bg-yellow-600 text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        }`}
                      >
                        {!kakaoEnabled ? '🔒 카카오 발송 준비중' : '💬 전송하기'}
                      </button>
                      {!kakaoEnabled && (
                        <p className="text-xs text-center text-gray-400 mt-1.5">카카오 발송 활성화는 관리자에게 문의해주세요</p>
                      )}
                    </div>
                  </div>
                )}

                {/* === 카카오 알림톡 채널 === */}
                {directSendChannel === 'kakao_alimtalk' && (
                  <div className="border-2 border-blue-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-lg">🔔</span>
                        <span className="text-sm font-semibold text-blue-800">알림톡 (템플릿 기반)</span>
                      </div>
                      {kakaoTemplates.length === 0 ? (
                        <div className="text-center py-12">
                          <div className="text-4xl mb-3">📋</div>
                          <p className="text-sm text-gray-500 font-medium">등록된 알림톡 템플릿이 없습니다</p>
                          <p className="text-xs text-gray-400 mt-1">설정 → 카카오 프로필 관리에서 템플릿을 등록해주세요</p>
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-[300px] overflow-y-auto">
                          {kakaoTemplates.map((t: any) => (
                            <div key={t.id}
                              onClick={() => {
                                setKakaoSelectedTemplate(t);
                                const vars: Record<string, string> = {};
                                (t.content?.match(/#{[^}]+}/g) || []).forEach((v: string) => { vars[v] = ''; });
                                setKakaoTemplateVars(vars);
                              }}
                              className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                                kakaoSelectedTemplate?.id === t.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">{t.template_name}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${t.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                  {t.status === 'approved' ? '승인' : t.status}
                                </span>
                              </div>
                              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{t.content}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {kakaoSelectedTemplate && Object.keys(kakaoTemplateVars).length > 0 && (
                        <div className="mt-3 pt-3 border-t">
                          <p className="text-xs font-semibold text-gray-600 mb-2">변수 매핑</p>
                          {Object.keys(kakaoTemplateVars).map(varKey => (
                            <div key={varKey} className="flex items-center gap-2 mb-1.5">
                              <span className="text-xs text-blue-600 font-mono w-24 shrink-0">{varKey}</span>
                              <input type="text" value={kakaoTemplateVars[varKey]} onChange={(e) => setKakaoTemplateVars(prev => ({...prev, [varKey]: e.target.value}))} placeholder="값 입력" className="flex-1 border rounded px-2 py-1 text-xs" />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="px-3 py-2 border-t">
                      <button disabled={true} className="w-full py-3 bg-gray-300 text-gray-500 rounded-xl font-bold text-base cursor-not-allowed">
                        🔒 알림톡 발송 준비중
                      </button>
                      <p className="text-xs text-center text-gray-400 mt-1.5">알림톡 발송 기능은 준비 중입니다</p>
                    </div>
                  </div>
                )}
              </div>
              
              {/* 우측: 수신자 목록 */}
              <div className="flex-1 flex flex-col">
                {/* 입력 방식 탭 + 체크박스 */}
                <div className="flex items-center gap-3 mb-4">
                  <button 
                    onClick={() => setShowDirectInput(true)}
                    className={`px-5 py-2.5 border-2 rounded-lg text-sm font-medium hover:bg-gray-50 ${directInputMode === 'direct' ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : ''}`}
                  >✏️ 직접입력</button>
                  <label 
                    className={`px-5 py-2.5 border-2 rounded-lg text-sm font-medium cursor-pointer hover:bg-gray-50 ${directInputMode === 'file' ? 'bg-amber-50 border-amber-400 text-amber-700' : ''} ${directFileLoading ? 'opacity-50 cursor-wait' : ''}`}
                  >
                    {directFileLoading ? '⏳ 파일 분석중...' : '📁 파일등록'}
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        
                        setDirectFileLoading(true);
                        const formData = new FormData();
                        formData.append('file', file);
                        
                        try {
                          const token = localStorage.getItem('token');
                          const res = await fetch('/api/upload/parse?includeData=true', {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${token}` },
                            body: formData
                          });
                          const data = await res.json();
                          if (data.success) {
                            setDirectFileHeaders(data.headers);
                            setDirectFilePreview(data.preview);
                            setDirectFileData(data.allData || data.preview);
                            setDirectInputMode('file');
                            setDirectShowMapping(true);
                            setDirectColumnMapping({});
                          } else {
                            alert(data.error || '파일 파싱 실패');
                          }
                        } catch (err) {
                          alert('파일 업로드 중 오류가 발생했습니다.');
                        } finally {
                          setDirectFileLoading(false);
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <button
                     onClick={async () => {
                       const token = localStorage.getItem('token');
                       const res = await fetch('/api/address-books/groups', {
                         headers: { Authorization: `Bearer ${token}` }
                       });
                       const data = await res.json();
                       if (data.success) {
                         setAddressGroups(data.groups || []);
                       }
                       setShowAddressBook(true);
                     }}
                     className={`px-5 py-2.5 border-2 rounded-lg text-sm font-medium hover:bg-gray-50 ${directInputMode === 'address' ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : ''}`}
                   >📒 주소록</button>
                  <label className="flex items-center gap-2 text-sm cursor-pointer ml-2">
                    <input type="checkbox" defaultChecked className="rounded w-4 h-4" />
                    <span className="font-medium">중복제거</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" defaultChecked className="rounded w-4 h-4" />
                    <span className="font-medium">수신거부제거</span>
                  </label>
                  <div className="flex-1"></div>
                  <button 
                    onClick={() => { setShowDirectSend(false); setKakaoMessage(''); setDirectSendChannel('sms'); }}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium flex items-center gap-1"
                  >
                    <span>✕</span> 창닫기
                  </button>
                </div>
                
                {/* 수신자 테이블 */}
                <div className="border-2 rounded-xl overflow-hidden flex-1 flex flex-col">
                  <div className="bg-gray-50 px-4 py-3 flex justify-between items-center border-b">
                  <span className="text-sm font-medium">
                      총 <span className="text-emerald-600 font-bold text-lg">{directRecipients.length.toLocaleString()}</span> 건
                      {directRecipients.length > 10 && !directSearchQuery && (
                        <span className="text-gray-400 text-xs ml-2">(상위 10개 표시)</span>
                      )}
                    </span>
                    <input
                      type="text"
                      placeholder="🔍 수신번호 검색"
                      value={directSearchQuery}
                      onChange={(e) => setDirectSearchQuery(e.target.value)}
                      className="border rounded-lg px-3 py-2 text-sm w-52"
                    />
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    <table className="w-full">
                    <thead className="bg-gray-50 border-b sticky top-0">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 w-10">
                            <input 
                              type="checkbox" 
                              className="rounded w-4 h-4"
                              checked={directRecipients.length > 0 && selectedRecipients.size === directRecipients.length}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedRecipients(new Set(directRecipients.map((_, i) => i)));
                                } else {
                                  setSelectedRecipients(new Set());
                                }
                              }}
                            />
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">수신번호</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">이름</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">회신번호</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">기타1</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">기타2</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">기타3</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {directRecipients.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-24 text-center text-gray-400">
                              <div className="text-4xl mb-2">📋</div>
                              <div className="text-sm">파일을 업로드하거나 직접 입력해주세요</div>
                            </td>
                          </tr>
                        ) : (
                          directRecipients
                            .map((r, idx) => ({ ...r, originalIdx: idx }))
                            .filter(r => !directSearchQuery || String(r.phone || '').includes(directSearchQuery))
                            .slice(0, directSearchQuery ? 100 : 10)
                            .map((r) => (
                            <tr key={r.originalIdx} className="hover:bg-gray-50">
                              <td className="px-4 py-3">
                                <input 
                                  type="checkbox" 
                                  className="rounded w-4 h-4"
                                  checked={selectedRecipients.has(r.originalIdx)}
                                  onChange={(e) => {
                                    const newSet = new Set(selectedRecipients);
                                    if (e.target.checked) newSet.add(r.originalIdx);
                                    else newSet.delete(r.originalIdx);
                                    setSelectedRecipients(newSet);
                                  }}
                                />
                              </td>
                              <td className="px-4 py-3 text-sm">{r.phone}</td>
                              <td className="px-4 py-3 text-sm">{r.name || '-'}</td>
                              <td className="px-4 py-3 text-sm font-mono text-xs text-gray-600">{r.callback || '-'}</td>
                              <td className="px-4 py-3 text-sm">{r.extra1 || '-'}</td>
                              <td className="px-4 py-3 text-sm">{r.extra2 || '-'}</td>
                              <td className="px-4 py-3 text-sm">{r.extra3 || '-'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                
                {/* 하단 버튼 - 전송하기와 높이 맞춤 */}
                <div className="flex gap-3 mt-4">
                  <button 
                    onClick={() => {
                      if (selectedRecipients.size === 0) {
                        alert('선택된 항목이 없습니다');
                        return;
                      }
                      const newList = directRecipients.filter((_, idx) => !selectedRecipients.has(idx));
                      setDirectRecipients(newList);
                      setSelectedRecipients(new Set());
                    }}
                    className="px-5 py-3 border-2 rounded-xl text-sm font-medium hover:bg-gray-50"
                  >선택삭제</button>
                  <button 
                    onClick={() => {
                      if (directRecipients.length === 0) return;
                      if (confirm('전체 삭제하시겠습니까?')) {
                        setDirectRecipients([]);
                        setSelectedRecipients(new Set());
                      }
                    }}
                    className="px-5 py-3 border-2 rounded-xl text-sm font-medium hover:bg-gray-50"
                  >전체삭제</button>
                  <div className="flex-1"></div>
                  <button 
                    onClick={() => {
                      setDirectRecipients([]);
                      setDirectMessage('');
                      setDirectSubject('');
                      setMmsUploadedImages([]);
                      setSelectedRecipients(new Set());
                      setSelectedCallback('');
                    }}
                    className="px-5 py-3 border-2 rounded-xl text-sm font-medium hover:bg-gray-50"
                  >🔄 초기화</button>
                </div>
              </div>
            </div>
            {/* 파일 매핑 모달 */}
            {directShowMapping && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-[550px] overflow-hidden">
                  <div className="p-4 border-b bg-blue-50 flex justify-between items-center">
                    <h3 className="font-bold text-lg">📁 컬럼 매핑</h3>
                    <button onClick={() => setDirectShowMapping(false)} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
                  </div>
                  
                  <div className="p-6">
                    {/* 매핑 안내 */}
                    <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-800">
                      💡 아래 필수 항목에 <strong>엑셀의 어떤 컬럼</strong>을 매핑할지 선택해주세요.
                    </div>
                    
                    {/* 헤더 */}
                    <div className="flex items-center gap-4 mb-3 px-4">
                      <span className="w-28 text-xs font-bold text-gray-500">필수 항목</span>
                      <span className="w-8 text-center text-xs text-gray-400">→</span>
                      <span className="flex-1 text-xs font-bold text-gray-500">엑셀 컬럼 선택</span>
                    </div>
                    
                    {/* 매핑 선택 - 5개만 */}
                    <div className="space-y-3">
                      {/* 수신번호 (필수) */}
                      <div className="flex items-center gap-4 p-4 bg-red-50 rounded-xl border-2 border-red-200">
                        <span className="w-28 text-sm font-bold text-red-700">📱 수신번호 *</span>
                        <span className="w-8 text-center text-gray-400">→</span>
                        <select
                          className="flex-1 border-2 border-red-300 rounded-lg px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-red-500"
                          value={directColumnMapping.phone || ''}
                          onChange={(e) => setDirectColumnMapping({...directColumnMapping, phone: e.target.value})}
                        >
                          <option value="">-- 컬럼 선택 --</option>
                          {directFileHeaders.map((h, i) => (
                            <option key={i} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                      
                      {/* 이름 */}
                      <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                        <span className="w-28 text-sm font-bold text-gray-700">👤 이름</span>
                        <span className="w-8 text-center text-gray-400">→</span>
                        <select
                          className="flex-1 border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          value={directColumnMapping.name || ''}
                          onChange={(e) => setDirectColumnMapping({...directColumnMapping, name: e.target.value})}
                        >
                          <option value="">-- 컬럼 선택 --</option>
                          {directFileHeaders.map((h, i) => (
                            <option key={i} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                      
                      {/* 기타1 */}
                      <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                        <span className="w-28 text-sm font-bold text-gray-700">1️⃣ 기타1</span>
                        <span className="w-8 text-center text-gray-400">→</span>
                        <select
                          className="flex-1 border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          value={directColumnMapping.extra1 || ''}
                          onChange={(e) => setDirectColumnMapping({...directColumnMapping, extra1: e.target.value})}
                        >
                          <option value="">-- 컬럼 선택 --</option>
                          {directFileHeaders.map((h, i) => (
                            <option key={i} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                      
                      {/* 기타2 */}
                      <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                        <span className="w-28 text-sm font-bold text-gray-700">2️⃣ 기타2</span>
                        <span className="w-8 text-center text-gray-400">→</span>
                        <select
                          className="flex-1 border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          value={directColumnMapping.extra2 || ''}
                          onChange={(e) => setDirectColumnMapping({...directColumnMapping, extra2: e.target.value})}
                        >
                          <option value="">-- 컬럼 선택 --</option>
                          {directFileHeaders.map((h, i) => (
                            <option key={i} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                      
                      {/* 기타3 */}
                      <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                        <span className="w-28 text-sm font-bold text-gray-700">3️⃣ 기타3</span>
                        <span className="w-8 text-center text-gray-400">→</span>
                        <select
                          className="flex-1 border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          value={directColumnMapping.extra3 || ''}
                          onChange={(e) => setDirectColumnMapping({...directColumnMapping, extra3: e.target.value})}
                        >
                          <option value="">-- 컬럼 선택 --</option>
                          {directFileHeaders.map((h, i) => (
                            <option key={i} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                      
                      {/* 회신번호 (매장번호) */}
                      <div className="flex items-center gap-4 p-4 bg-blue-50 rounded-xl border border-blue-200">
                        <span className="w-28 text-sm font-bold text-blue-700">📞 회신번호</span>
                        <span className="w-8 text-center text-gray-400">→</span>
                        <select
                          className="flex-1 border border-blue-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          value={directColumnMapping.callback || ''}
                          onChange={(e) => setDirectColumnMapping({...directColumnMapping, callback: e.target.value})}
                        >
                          <option value="">-- 컬럼 선택 --</option>
                          {directFileHeaders.map((h, i) => (
                            <option key={i} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-4 border-t bg-gray-50 flex justify-between items-center">
                    <span className="text-sm text-gray-600">📊 총 <strong>{directFileData.length.toLocaleString()}</strong>건</span>
                    <div className="flex gap-3">
                      <button 
                        onClick={() => setDirectShowMapping(false)}
                        className="px-6 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-100"
                      >취소</button>
                      <button 
                        onClick={async () => {
                          if (!directColumnMapping.phone) {
                            alert('수신번호는 필수입니다.');
                            return;
                          }
                          
                          setDirectMappingLoading(true);
                          setDirectLoadingProgress(0);
                          
                          // 비동기로 처리하여 UI 업데이트 허용
                          await new Promise(resolve => setTimeout(resolve, 10));
                          
                          const total = directFileData.length;
                          const chunkSize = 5000;
                          const mapped: any[] = [];
                          
                          for (let i = 0; i < total; i += chunkSize) {
                            const chunk = directFileData.slice(i, i + chunkSize);
                            const processed = chunk.map(row => {
                              let phone = String(row[directColumnMapping.phone] || '').replace(/-/g, '').trim();
                              if (phone.length === 10 && phone.startsWith('1')) {
                                phone = '0' + phone;
                              }
                              return {
                                phone,
                                name: row[directColumnMapping.name] || '',
                                extra1: row[directColumnMapping.extra1] || '',
                                extra2: row[directColumnMapping.extra2] || '',
                                extra3: row[directColumnMapping.extra3] || '',
                                callback: directColumnMapping.callback ? String(row[directColumnMapping.callback] || '').replace(/-/g, '').trim() : ''
                              };
                            }).filter(r => r.phone && r.phone.length >= 10);
                            
                            mapped.push(...processed);
                            setDirectLoadingProgress(Math.min(100, Math.round((i + chunkSize) / total * 100)));
                            await new Promise(resolve => setTimeout(resolve, 10));
                          }
                          
                          setDirectRecipients(mapped);
                          setDirectMappingLoading(false);
                          setDirectShowMapping(false);
                        }}
                        disabled={!directColumnMapping.phone || directMappingLoading}
                        className="px-8 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {directMappingLoading ? `처리중... ${directLoadingProgress}%` : '등록하기'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* 특수문자 모달 */}
            {showSpecialChars && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]" onClick={() => setShowSpecialChars(null)}>
                <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden animate-in fade-in zoom-in" onClick={e => e.stopPropagation()}>
                  <div className="p-4 border-b bg-purple-50 flex justify-between items-center">
                    <h3 className="font-bold text-lg">✨ 특수문자</h3>
                    <button onClick={() => setShowSpecialChars(null)} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
                  </div>
                  <div className="p-4">
                    <div className="grid grid-cols-8 gap-1.5">
                      {['★','☆','♥','♡','◆','◇','■','□','▲','△','▶','◀','●','○','◎','♤','♠','♧','♣','♢','♦','♪','♬','♩','☎','✉','✈','♨','☀','☁','☂','※','☞','↑','↓','←','→','▷','◁','▽','①','②','③','④','⑤','⑥','⑦','⑧','㈜','㈔','℡','㉿','㎝','㎏','㎡','㎎'].map((char, i) => (
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
                    <p className="text-xs text-gray-400 mt-3 text-center">⚠️ 일부 특수문자는 LMS 자동 전환될 수 있습니다</p>
                  </div>
                </div>
              </div>
            )}

            {/* 보관함 모달 */}
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

            {/* 문자저장 모달 */}
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
                          const ok = await saveTemplate(templateSaveName.trim(), content, msgType, subject);
                          if (ok) setShowTemplateSave(null);
                        }}
                        className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-bold transition-colors"
                      >💾 저장하기</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 직접입력 모달 */}
            {showDirectInput && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-[500px] overflow-hidden">
                  <div className="p-4 border-b bg-blue-50 flex justify-between items-center">
                    <h3 className="font-bold text-lg">✏️ 직접입력</h3>
                    <button onClick={() => setShowDirectInput(false)} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
                  </div>
                  
                  <div className="p-6">
                    <div className="mb-3 text-sm text-gray-600">
                      전화번호를 한 줄에 하나씩 입력해주세요.
                    </div>
                    <textarea
                      value={directInputText}
                      onChange={(e) => setDirectInputText(e.target.value)}
                      placeholder="01012345678&#10;01087654321&#10;01011112222"
                      className="w-full h-[250px] border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  
                  <div className="p-4 border-t bg-gray-50 flex justify-end gap-3">
                    <button 
                      onClick={() => setShowDirectInput(false)}
                      className="px-6 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-100"
                    >취소</button>
                    <button 
                      onClick={() => {
                        const lines = directInputText.split('\n').map(l => l.trim()).filter(l => l);
                        const newRecipients = lines.map(phone => ({
                          phone: phone.replace(/-/g, ''),
                          name: '',
                          extra1: '',
                          extra2: '',
                          extra3: '',
                          callback: ''
                        }));
                        setDirectRecipients([...directRecipients, ...newRecipients]);
                        setDirectInputText('');
                        setShowDirectInput(false);
                        setDirectInputMode('direct');
                      }}
                      className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium"
                    >
                      등록
                    </button>
                  </div>
                </div>
              </div>
            )}
            
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
        onLmsConvert={() => { if (showTargetSend) { setTargetMsgType('LMS'); } else { setDirectMsgType('LMS'); } setShowLmsConfirm(false); }}
        getMaxByteMessage={getMaxByteMessage}
        calculateBytes={calculateBytes}
        truncateToSmsBytes={truncateToSmsBytes}
      />
      <SmsConvertModal
        show={showSmsConvert.show}
        showSmsConvert={showSmsConvert}
        onClose={() => setShowSmsConvert({show: false, from: 'direct', currentBytes: 0, smsBytes: 0, count: 0})}
        onSmsConvert={() => { if (showSmsConvert.from === 'target') { setTargetMsgType('SMS'); } else { setDirectMsgType('SMS'); } setShowSmsConvert({show: false, from: 'direct', currentBytes: 0, smsBytes: 0, count: 0}); }}
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
      />
      <SendConfirmModal
        sendConfirm={sendConfirm}
        setSendConfirm={setSendConfirm}
        directSending={directSending}
        executeDirectSend={executeDirectSend}
        executeTargetSend={executeTargetSend}
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

      <PlanUpgradeModal show={showPlanUpgradeModal} onClose={() => setShowPlanUpgradeModal(false)} />

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
        <span>© 2026 INVITO</span>
      </div>
    </div>
  );
}