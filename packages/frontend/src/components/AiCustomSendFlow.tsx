import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Hash,
  Link2, Loader2,
  MapPin,
  Pencil,
  ShoppingBag,
  Sparkles,
  Star,
  User,
  Users,
  X,
  XCircle
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatPreviewValue, calculateSmsBytes, replaceMessageVars, buildAdMessageFront, buildAdSubjectFront } from '../utils/formatDate';
import { highlightVars } from '../utils/highlightVars';

interface AiCustomSendFlowProps {
  onClose: () => void;
  onConfirmSend?: (data: {
    variant: MessageVariant;
    targetFilters: Record<string, any>;
    targetCondition: TargetCondition;
    promotionCard: PromotionCard;
    channel: 'SMS' | 'LMS' | 'MMS';
    tone: string;
    url: string;
    briefing: string;
    personalFields: string[];
    estimatedCount: number;
    unsubscribeCount: number;
    isAd: boolean;
  }) => void;
  brandName: string;
  callbackNumbers: { id: string; phone: string; label: string; is_default: boolean }[];
  selectedCallback: string;
  isAd: boolean;
  optOutNumber: string;
  // B16-03: 스팸필터/담당자테스트
  setShowSpamFilter?: (v: boolean) => void;
  setSpamFilterData?: (data: any) => void;
  handleTestSend?: () => void;
  testSending?: boolean;
  testCooldown?: boolean;
  testSentResult?: string | null;
  sampleCustomer?: Record<string, any>;
  isSpamFilterLocked?: boolean;
  // D107: 저장 세그먼트에서 프리로드
  preloadData?: {
    selectedFields: string[];
    briefing: string;
    url: string;
    channel: string;
    isAd: boolean;
  };
  // ★ B1: MMS 이미지 첨부 (Dashboard에서 props 전달 — 한줄로 AI와 동일 패턴)
  mmsUploadedImages?: { serverPath: string; url: string; filename: string; size: number }[];
  onMmsImageUpload?: (files: FileList | null) => void;
  onMmsImageRemove?: (index: number) => void;
  mmsUploading?: boolean;
}

interface PromotionCard {
  name: string;
  benefit: string;
  condition: string;
  period: string;
  target: string;
  couponCode?: string;
  extra?: string;
}

interface TargetCondition {
  description: string;
  gender: string;
  grade: string;
  ageRange: string;
  region: string;
  purchasePeriod: string;
  storeName: string;
  minPurchaseAmount: string;
  birthMonth: string;
  extra: string;
}

interface MessageVariant {
  variant_id: string;
  variant_name: string;
  concept: string;
  message_text: string;
  subject?: string;
  score: number;
}

const EMPTY_TARGET_CONDITION: TargetCondition = {
  description: '', gender: '', grade: '', ageRange: '',
  region: '', purchasePeriod: '', storeName: '', minPurchaseAmount: '', birthMonth: '', extra: '',
};

const CATEGORY_ICONS: Record<string, any> = {
  basic: User, purchase: ShoppingBag, store: MapPin,
  membership: Star, marketing: Hash, custom: Hash,
};




export default function AiCustomSendFlow({
  onClose, onConfirmSend, brandName, callbackNumbers, selectedCallback, isAd, optOutNumber,
  setShowSpamFilter, setSpamFilterData, handleTestSend, testSending, testCooldown, testSentResult,
  sampleCustomer, isSpamFilterLocked, preloadData,
  mmsUploadedImages = [], onMmsImageUpload, onMmsImageRemove, mmsUploading,
}: AiCustomSendFlowProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const TOTAL_STEPS = 4;

  // Step 1
  const [availableFields, setAvailableFields] = useState<any[]>([]);
  const [selectedFields, setSelectedFields] = useState<string[]>(['name']);
  const [fieldsLoading, setFieldsLoading] = useState(true);
  const [sampleData, setSampleData] = useState<Record<string, any>>({});
  const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>({});

  // Step 2
  const [briefing, setBriefing] = useState('');
  const [url, setUrl] = useState('');
  const tone = 'friendly'; // AI 내부 기본값 (UI 미노출)
  const [channel, setChannel] = useState<'SMS' | 'LMS' | 'MMS'>('LMS');
  const [isAdLocal, setIsAdLocal] = useState(isAd);

  // Step 3
  const [promotionCard, setPromotionCard] = useState<PromotionCard | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [editingCard, setEditingCard] = useState(false);
  const [editedCard, setEditedCard] = useState<PromotionCard | null>(null);
  const [targetCondition, setTargetCondition] = useState<TargetCondition>(EMPTY_TARGET_CONDITION);
  const [editingTarget, setEditingTarget] = useState(false);
  const [editedTarget, setEditedTarget] = useState<TargetCondition>(EMPTY_TARGET_CONDITION);
  const [targetFilters, setTargetFilters] = useState<Record<string, any>>({});
  const [estimatedCount, setEstimatedCount] = useState(0);
  const [unsubscribeCount, setUnsubscribeCount] = useState(0);
  const [targetRecounting, setTargetRecounting] = useState(false);

  // Step 4
  const [variants, setVariants] = useState<MessageVariant[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedVariantIdx, setSelectedVariantIdx] = useState(0);
  // ★ 검수리스트 UX: 머지 미리보기 토글 (기본=머지 결과 / 토글 시 변수 강조)
  const [showVarsHighlightOnly, setShowVarsHighlightOnly] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  // ★ D92: 미리보기 모달 state
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  // 커스텀 모달 state
  const [alertModal, setAlertModal] = useState<{
    title: string;
    message: string;
    type: 'error' | 'warning' | 'info';
  } | null>(null);
  // ★ D91: SMS→LMS 전환 확인 모달
  const [lmsConvertModal, setLmsConvertModal] = useState<{ show: boolean; bytes: number }>({ show: false, bytes: 0 });
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmText: string;
    cancelText: string;
    onConfirm: () => void;
    onCancel: () => void;
  } | null>(null);

  // ★ D80: AI 성과 기반 다음 캠페인 추천
  const [showRecommend, setShowRecommend] = useState(false);
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [recommendData, setRecommendData] = useState<any>(null);
  const [recommendHover, setRecommendHover] = useState(false);

  const fetchRecommendation = async () => {
    setRecommendLoading(true);
    setRecommendData(null);
    try {
      const token = localStorage.getItem('token') || '';
      const res = await fetch('/api/ai/recommend-next-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ months: 3 }),
      });
      if (res.ok) {
        const data = await res.json();
        setRecommendData(data);
        setShowRecommend(true);
      } else {
        const err = await res.json();
        setAlertModal({ title: 'AI 추천 실패', message: err.error || '추천 데이터를 가져올 수 없습니다.', type: 'error' });
      }
    } catch {
      setAlertModal({ title: 'AI 추천 실패', message: '네트워크 오류가 발생했습니다.', type: 'error' });
    } finally {
      setRecommendLoading(false);
    }
  };

  // ★ B17-12: AI맞춤한줄 자체 테스트 핸들러 — variants 데이터 사용
  const [customTestSending, setCustomTestSending] = useState(false);
  const [customTestCooldown, setCustomTestCooldown] = useState(false);
  const [customTestResult, setCustomTestResult] = useState<string | null>(null);

  const handleCustomTestSend = async () => {
    setCustomTestSending(true);
    setCustomTestResult(null);
    try {
      const selectedMsg = variants[selectedVariantIdx];
      if (!selectedMsg) {
        setAlertModal({ title: '오류', message: '메시지를 선택해주세요', type: 'error' });
        setCustomTestSending(false);
        return;
      }
      // ★ D103: 순수 본문만. (광고)+080은 백엔드 test-send에서 추가
      const token = localStorage.getItem('token');
      const res = await fetch('/api/campaigns/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messageContent: selectedMsg.message_text,
          messageType: channel,
          isAd: isAdLocal,
          subject: selectedMsg.subject || '',
          mmsImagePaths: [],
          // ★ D83: 미리보기와 동일한 샘플 고객으로 개인화 치환 (불일치 버그 수정)
          sampleCustomer: sampleData && Object.keys(sampleData).length > 0 ? sampleData : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const contactList = data.contacts?.map((c: any) => `${c.name}(${c.phone})`).join(', ') || '';
        setCustomTestResult(`✅ ${data.message}\n${contactList}`);
      } else {
        setCustomTestResult(`❌ ${data.error}`);
      }
    } catch (error) {
      setCustomTestResult('❌ 테스트 발송 실패');
    } finally {
      setCustomTestSending(false);
      setCustomTestCooldown(true);
      setTimeout(() => {
        setCustomTestCooldown(false);
        setCustomTestResult(null);
      }, 10000);
    }
  };

  useEffect(() => { loadFields(); }, []);

  // D107: 저장 세그먼트 프리로드 — 필드 로드 완료 후 적용
  useEffect(() => {
    if (preloadData && !fieldsLoading) {
      setSelectedFields(preloadData.selectedFields);
      setBriefing(preloadData.briefing);
      setUrl(preloadData.url);
      if (preloadData.channel === 'SMS' || preloadData.channel === 'LMS' || preloadData.channel === 'MMS') {
        setChannel(preloadData.channel);
      }
      setIsAdLocal(preloadData.isAd);
      setCurrentStep(2); // Step 1 스킵 → Step 2 (프로모션 브리���)부터
    }
  }, [preloadData, fieldsLoading]);

  const loadFields = async () => {
    try {
      setFieldsLoading(true);
      const token = localStorage.getItem('token');
      const res = await fetch('/api/customers/enabled-fields', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAvailableFields(data.fields || []);
        if (data.sample) setSampleData(data.sample);
        if (data.categories) setCategoryLabels(data.categories);
      }
    } catch (error) { console.error('필드 로드 실패:', error); }
    finally { setFieldsLoading(false); }
  };

  const toggleField = (fieldKey: string) => {
    setSelectedFields(prev => prev.includes(fieldKey) ? prev.filter(k => k !== fieldKey) : [...prev, fieldKey]);
  };

  // ★ D95: 바이트 계산 — formatDate.ts 컨트롤타워 사용
  const calculateBytes = calculateSmsBytes;

  const formatRejectNumber = (num: string) => {
    const clean = num.replace(/-/g, '');
    if (clean.length === 10) return `${clean.slice(0,3)}-${clean.slice(3,6)}-${clean.slice(6)}`;
    return num;
  };

  // ★ D102: buildAdMessageFront 컨트롤타워 사용
  const wrapAdText = (msg: string) => {
    if (!msg) return msg;
    return buildAdMessageFront(msg, channel, isAdLocal, optOutNumber);
  };

  // ★ D95: replaceMessageVars 컨트롤타워 사용
  const replaceSampleVars = (text: string) => replaceMessageVars(text, availableFields, sampleData);

  // 커스텀 alert 표시
  const showAlert = (title: string, message: string, type: 'error' | 'warning' | 'info' = 'error') => {
    setAlertModal({ title, message, type });
  };

  const handleParseBriefing = async () => {
    if (!briefing.trim()) return;
    setIsParsing(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/ai/parse-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ briefing: briefing.trim() })
      });
      if (res.ok) {
        const data = await res.json();
        setPromotionCard(data.promotionCard);
        setEditedCard(data.promotionCard);
        const tc = data.targetCondition || EMPTY_TARGET_CONDITION;
        setTargetCondition(tc);
        setEditedTarget(tc);
        setTargetFilters(data.targetFilters || {});
        setEstimatedCount(data.estimatedCount || 0);
        setUnsubscribeCount(data.unsubscribeCount || 0);
        // ★ D88: 타겟 필터에 맞는 샘플 고객으로 교체 — 미리보기 정확도 향상
        if (data.sampleCustomer && Object.keys(data.sampleCustomer).length > 0) {
          setSampleData(data.sampleCustomer);
        }
        setCurrentStep(3);
      } else { const err = await res.json(); showAlert('AI 분석 실패', err.error || '브리핑 파싱에 실패했습니다. 내용을 확인 후 다시 시도해주세요.', 'error'); }
    } catch (error) { console.error('브리핑 파싱 실패:', error); showAlert('서버 오류', '서버와의 통신 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 'error'); }
    finally { setIsParsing(false); }
  };

  const handleGenerateCustom = async () => {
    const card = editingCard ? editedCard : promotionCard;
    if (!card) return;
    setIsGenerating(true);
    setCurrentStep(4);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/ai/generate-custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          briefing: briefing.trim(), promotionCard: card, personalFields: selectedFields,
          fieldLabels: Object.fromEntries(availableFields.map((f: any) => [f.field_key, f.field_label || f.display_name || f.field_key])),
          url: url.trim() || undefined, tone, brandName, channel, isAd: isAdLocal,
        })
      });
      if (res.ok) {
        const data = await res.json();
        setVariants(data.variants || []);
        setSelectedVariantIdx(0);
      } else { const err = await res.json(); showAlert('문안 생성 실패', err.error || '맞춤 문안 생성에 실패했습니다. 프로모션 카드를 확인 후 다시 시도해주세요.', 'error'); setCurrentStep(3); }
    } catch (error) { console.error('문안 생성 실패:', error); showAlert('서버 오류', '서버와의 통신 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 'error'); setCurrentStep(3); }
    finally { setIsGenerating(false); }
  };

  // 버그 #9: 타겟 조건 수정 후 재조회
  const handleRetargetCount = async (updatedTarget: TargetCondition) => {
    setTargetRecounting(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/ai/recount-target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        // ★ D84: 기존 targetFilters도 전달 — 커스텀 필드(custom_fields.*) 보존
        body: JSON.stringify({ targetCondition: updatedTarget, originalTargetFilters: targetFilters })
      });
      if (res.ok) {
        const data = await res.json();
        setEstimatedCount(data.estimatedCount || 0);
        setUnsubscribeCount(data.unsubscribeCount || 0);
        setTargetFilters(data.targetFilters || {});
      }
    } catch (error) { console.error('타겟 재조회 실패:', error); }
    finally { setTargetRecounting(false); }
  };

  const groupedFields = availableFields.reduce((acc: Record<string, any[]>, field: any) => {
    const cat = field.category || 'custom';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(field);
    return acc;
  }, {});

  // 타겟 조건이 하나라도 있는지 확인
  const hasTargetCondition = (tc: TargetCondition) => {
    return Object.entries(tc).some(([key, val]) => key !== 'description' && val && val.trim() !== '');
  };

  const canGoNext = () => {
    switch (currentStep) {
      case 1: return selectedFields.length > 0;
      case 2: return briefing.trim().length >= 10;
      case 3: return promotionCard !== null;
      case 4: return variants.length > 0;
      default: return false;
    }
  };

  const stepLabels = ['개인화 필드', '프로모션 브리핑', '프로모션 확인', '문안 생성'];

  // 타겟 조건 카드 필드 정의
  const targetFields = [
    { key: 'gender', label: '성별', icon: '👤' },
    { key: 'grade', label: '등급', icon: '⭐' },
    { key: 'ageRange', label: '연령대', icon: '🎂' },
    { key: 'region', label: '지역', icon: '📍' },
    { key: 'purchasePeriod', label: '구매 기간', icon: '🛒' },
    { key: 'storeName', label: '매장/브랜드', icon: '🏪' },
    { key: 'minPurchaseAmount', label: '최소 구매금액', icon: '💰' },
    { key: 'extra', label: '기타 조건', icon: '📌' },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${currentStep === 4 ? 'max-w-[900px]' : currentStep === 3 ? 'max-w-[820px]' : 'max-w-[720px]'} max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200`}>
        
        {/* 헤더 */}
        <div className="px-6 py-4 border-b bg-gradient-to-r from-violet-50 to-purple-50 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-violet-600" />
            <h3 className="text-lg font-bold text-gray-800">AI 맞춤한줄</h3>
            <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-medium">Step {currentStep}/{TOTAL_STEPS}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {/* 스텝 인디케이터 */}
        <div className="px-6 py-3 border-b bg-gray-50 shrink-0">
          <div className="flex items-center gap-1">
            {stepLabels.map((label, i) => {
              const step = i + 1;
              const isActive = step === currentStep;
              const isDone = step < currentStep;
              return (
                <div key={step} className="flex items-center flex-1">
                  <div className="flex items-center gap-1.5 flex-1">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all ${isDone ? 'bg-violet-600 text-white' : isActive ? 'bg-violet-600 text-white ring-2 ring-violet-200' : 'bg-gray-200 text-gray-500'}`}>
                      {isDone ? <Check className="w-3.5 h-3.5" /> : step}
                    </div>
                    <span className={`text-xs truncate ${isActive ? 'text-violet-700 font-semibold' : 'text-gray-400'}`}>{label}</span>
                  </div>
                  {i < stepLabels.length - 1 && <div className={`w-4 h-px mx-1 shrink-0 ${isDone ? 'bg-violet-400' : 'bg-gray-200'}`} />}
                </div>
              );
            })}
          </div>
        </div>

        {/* 컨텐츠 */}
        <div className="flex-1 overflow-y-auto p-6">
          
          {/* Step 1 */}
          {currentStep === 1 && (
            <div>
              <div className="mb-5">
                <h4 className="text-base font-bold text-gray-800 mb-1">이번 발송에 활용할 고객 정보를 선택하세요</h4>
                <p className="text-sm text-gray-500">선택한 필드를 활용해 AI가 고객별 1:1 맞춤 문안을 생성합니다.</p>
              </div>
              {fieldsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-violet-500 animate-spin" /><span className="ml-2 text-sm text-gray-500">필드 로딩 중...</span>
                </div>
              ) : availableFields.length === 0 ? (
                <div className="text-center py-12 text-gray-400"><User className="w-10 h-10 mx-auto mb-2 opacity-50" /><p>고객사에 설정된 필드가 없습니다.</p></div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(groupedFields).map(([category, fields]) => {
                    const IconComp = CATEGORY_ICONS[category] || Hash;
                    return (
                      <div key={category}>
                        <div className="flex items-center gap-1.5 mb-2"><IconComp className="w-3.5 h-3.5 text-gray-400" /><span className="text-xs font-semibold text-gray-500 tracking-wide">{categoryLabels[category] || category}</span></div>
                        <div className="grid grid-cols-3 gap-2">
                          {(fields as any[]).map((field: any) => {
                            const isSelected = selectedFields.includes(field.field_key);
                            return (
                              <button key={field.field_key} onClick={() => toggleField(field.field_key)}
                                className={`px-3 py-2.5 rounded-lg border text-sm text-left transition-all ${isSelected ? 'border-violet-400 bg-violet-50 text-violet-700 ring-1 ring-violet-200' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}>
                                <div className="flex items-center gap-2">
                                  <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isSelected ? 'bg-violet-600 border-violet-600' : 'border-gray-300'}`}>{isSelected && <Check className="w-3 h-3 text-white" />}</div>
                                  <span className="truncate">{field.display_name}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {selectedFields.length > 0 && (
                <div className="mt-4 p-3 bg-violet-50 rounded-lg border border-violet-100">
                  <div className="text-xs text-violet-600 font-medium mb-1">선택된 필드 ({selectedFields.length}개)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedFields.map(key => {
                      const field = availableFields.find((f: any) => f.field_key === key);
                      return (
                        <span key={key} className="inline-flex items-center gap-1 px-2 py-1 bg-white rounded-md text-xs text-violet-700 border border-violet-200">
                          {field?.display_name || key}
                          <button onClick={() => toggleField(key)} className="text-violet-400 hover:text-violet-600"><X className="w-3 h-3" /></button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2 */}
          {currentStep === 2 && (
            <div>
              <div className="mb-5">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-base font-bold text-gray-800">프로모션을 브리핑해주세요</h4>
                  <div className="relative"
                    onMouseEnter={() => setRecommendHover(true)}
                    onMouseLeave={() => setRecommendHover(false)}
                  >
                    <button
                      onClick={fetchRecommendation}
                      disabled={recommendLoading}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-500 hover:to-orange-500 text-white rounded-lg text-xs font-medium transition-all shadow-sm disabled:opacity-50"
                    >
                      {recommendLoading ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3" />
                      )}
                      AI 추천
                    </button>
                    {recommendHover && !recommendLoading && (
                      <div className="absolute right-0 top-full mt-1 w-56 p-2.5 bg-gray-800 text-white text-xs rounded-lg shadow-lg z-20 leading-relaxed">
                        최근 3개월 캠페인 성과를 AI가 분석하여 최적의 타겟/시간/채널을 추천합니다.
                        <div className="absolute -top-1 right-4 w-2 h-2 bg-gray-800 rotate-45" />
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-sm text-gray-500">회의에서 팀원에게 설명하듯 자연스럽게 적으시면 됩니다. <b className="text-violet-600">발송 대상도 함께 적으면</b> AI가 타겟까지 자동 분석합니다.</p>
              </div>

              {/* ★ D80: AI 성과 기반 추천 결과 패널 */}
              {showRecommend && recommendData?.recommendations && (
                <div className="mb-5 p-4 bg-gradient-to-b from-amber-50 to-white border-2 border-amber-200 rounded-xl">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-500" />
                      <span className="text-sm font-bold text-gray-800">AI 캠페인 추천</span>
                    </div>
                    <button onClick={() => setShowRecommend(false)} className="text-gray-400 hover:text-gray-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-2 text-sm text-gray-700">
                    {recommendData.recommendations.target && (
                      <div className="flex gap-2">
                        <span className="shrink-0 text-xs font-semibold text-amber-600 bg-amber-100 px-2 py-0.5 rounded">타겟</span>
                        <span>{recommendData.recommendations.target}</span>
                      </div>
                    )}
                    {recommendData.recommendations.timing && (
                      <div className="flex gap-2">
                        <span className="shrink-0 text-xs font-semibold text-amber-600 bg-amber-100 px-2 py-0.5 rounded">시간</span>
                        <span>{recommendData.recommendations.timing}</span>
                      </div>
                    )}
                    {recommendData.recommendations.channel && (
                      <div className="flex gap-2">
                        <span className="shrink-0 text-xs font-semibold text-amber-600 bg-amber-100 px-2 py-0.5 rounded">채널</span>
                        <span>{recommendData.recommendations.channel}</span>
                      </div>
                    )}
                    {recommendData.recommendations.insights && (
                      <div className="mt-2 pt-2 border-t border-amber-100">
                        <p className="text-xs text-gray-500 leading-relaxed">{recommendData.recommendations.insights}</p>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2">최근 {recommendData.performance?.periodMonths || 3}개월 캠페인 {recommendData.performance?.totalCampaigns || 0}건 기반 분석</p>
                </div>
              )}
              <div className="mb-5">
                <label className="block text-sm font-medium text-gray-700 mb-1.5"><FileText className="w-4 h-4 inline mr-1 text-violet-500" />프로모션 브리핑</label>
                <textarea value={briefing} onChange={(e) => setBriefing(e.target.value)}
                  placeholder={"예시: 3개월 내 구매한 VIP 여성 고객 대상으로 봄 신상품 출시 기념 3/1~15 전 상품 20% 할인 행사를 진행합니다. 5만원 이상 구매 시 무료배송, 쿠폰코드 SPRING2026\n\n💡 대상 고객을 함께 적으면 AI가 타겟 조건도 자동 파싱합니다!"}
                  className="w-full h-32 px-4 py-3 border border-gray-300 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent placeholder-gray-400 leading-relaxed" autoFocus />
                <div className="flex justify-between mt-1.5">
                  <span className="text-xs text-gray-400">프로모션 내용 + 발송 대상을 함께 적으면 더 정확합니다</span>
                  <span className={`text-xs ${briefing.length < 10 ? 'text-red-400' : 'text-gray-400'}`}>{briefing.length}자 (최소 10자)</span>
                </div>
              </div>
              <div className="mb-5">
                <label className="block text-sm font-medium text-gray-700 mb-1.5"><Link2 className="w-4 h-4 inline mr-1 text-violet-500" />바로가기 URL <span className="text-gray-400 font-normal">(선택)</span></label>
                <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/event"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                <p className="text-xs text-gray-400 mt-1">입력하시면 문안에 "▶ 바로가기" 형태로 자동 배치됩니다</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5"><User className="w-4 h-4 inline mr-1 text-violet-500" />선택한 개인화 필드</label>
                  <div className="bg-violet-50 border border-violet-200 rounded-xl p-3">
                    <div className="flex flex-wrap gap-1.5">
                      {selectedFields.map(key => {
                        const field = availableFields.find((f: any) => f.field_key === key);
                        const label = field?.field_label || field?.display_name || key;
                        return (
                          <span key={key} className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-violet-300 rounded-full text-xs font-medium text-violet-700">
                            <Check className="w-3 h-3" />{label}
                          </span>
                        );
                      })}
                    </div>
                    <p className="text-xs text-violet-500 mt-2">위 필드를 활용해 AI가 고객별 1:1 맞춤 문안을 생성합니다</p>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">💡 브리핑에 위 필드 관련 내용을 적으면 더 정확한 문안이 생성됩니다</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">📱 발송 채널</label>
                  <div className="space-y-1.5">
                    {(['SMS', 'LMS', 'MMS'] as const).map(ch => (
                      <button key={ch} onClick={() => setChannel(ch)}
                        className={`w-full px-3 py-2.5 rounded-lg border text-left text-sm transition-all ${channel === ch ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                        <div className="font-medium">{ch}</div>
                        <div className="text-xs text-gray-400">{ch === 'SMS' ? '90바이트 (한글 약 45자)' : ch === 'LMS' ? '2,000바이트 (한글 약 1,000자)' : '2,000바이트 + 이미지 첨부'}</div>
                      </button>
                    ))}
                  </div>
                  {/* ★ B1: MMS 채널 선택 시 이미지 첨부 UI (한줄로 AI/직접발송과 동일 패턴) */}
                  {channel === 'MMS' && (
                    <div className="mt-4 p-3 bg-violet-50 border border-violet-200 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-semibold text-violet-700">📎 MMS 이미지 첨부 (최대 3장)</label>
                        <span className="text-[10px] text-violet-500">JPG / 300KB 이하</span>
                      </div>
                      {mmsUploadedImages && mmsUploadedImages.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {mmsUploadedImages.map((img, idx) => (
                            <div key={idx} className="relative w-16 h-16 rounded border border-violet-300 overflow-hidden">
                              <img src={img.url} alt={img.filename} className="w-full h-full object-cover" />
                              {onMmsImageRemove && (
                                <button
                                  onClick={() => onMmsImageRemove(idx)}
                                  className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-white text-[10px] rounded-bl flex items-center justify-center hover:bg-red-600"
                                  title="삭제"
                                >×</button>
                              )}
                            </div>
                          ))}
                          {mmsUploadedImages.length < 3 && onMmsImageUpload && (
                            <label className="w-16 h-16 border-2 border-dashed border-violet-300 rounded flex items-center justify-center cursor-pointer hover:bg-violet-100 text-violet-500 text-xs">
                              + 추가
                              <input type="file" accept="image/jpeg,image/jpg" multiple className="hidden" onChange={(e) => onMmsImageUpload(e.target.files)} />
                            </label>
                          )}
                        </div>
                      ) : onMmsImageUpload ? (
                        <label className="block w-full py-3 border-2 border-dashed border-violet-300 rounded text-center text-xs text-violet-600 cursor-pointer hover:bg-violet-100">
                          {mmsUploading ? '업로드 중...' : '클릭하여 이미지 선택 (JPG, 300KB 이하)'}
                          <input type="file" accept="image/jpeg,image/jpg" multiple className="hidden" onChange={(e) => onMmsImageUpload(e.target.files)} />
                        </label>
                      ) : (
                        <p className="text-xs text-violet-500">이미지 첨부 핸들러가 연결되지 않았습니다.</p>
                      )}
                    </div>
                  )}
                  {/* 광고 여부 토글 */}
                  <div className="mt-4">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <div className={`w-10 h-5 rounded-full transition-colors relative ${isAdLocal ? 'bg-violet-500' : 'bg-gray-300'}`}
                        onClick={() => setIsAdLocal(!isAdLocal)}>
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isAdLocal ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </div>
                      <span className="text-sm text-gray-700">광고성 메시지</span>
                    </label>
                    <p className="text-xs text-gray-400 mt-1">{isAdLocal ? '(광고) 표기 + 무료수신거부 번호 자동 삽입' : '비광고: 법정 문구 미삽입'}</p>
                  </div>
                  <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="text-xs font-medium text-gray-500 mb-2">선택 요약</div>
                    <div className="space-y-1 text-xs text-gray-600">
                      <div>• 개인화 필드: <b className="text-violet-600">{selectedFields.map(key => {
                        const f = availableFields.find((ff: any) => ff.field_key === key);
                        return f?.field_label || f?.display_name || key;
                      }).join(', ')}</b></div>
                      <div>• 채널: <b>{channel}</b></div>
                      {url && <div>• URL: <b className="text-blue-500">{url.length > 30 ? url.substring(0, 30) + '...' : url}</b></div>}
                      <div>• 광고: <b>{isAdLocal ? '예 (법정문구 자동삽입)' : '아니오'}</b></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3 — 프로모션 카드 + 타겟 조건 카드 2열 */}
          {currentStep === 3 && promotionCard && (
            <div>
              <div className="mb-5">
                <h4 className="text-base font-bold text-gray-800 mb-1">AI가 파싱한 프로모션 정보를 확인하세요</h4>
                <p className="text-sm text-gray-500">
                  내용을 변경하려면 <b className="text-violet-600">이전 단계(프로모션 브리핑)</b>로 돌아가서 새로 입력해주세요.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* 프로모션 카드 (왼쪽) — ★ B+0407-2: 수정 불가 (read-only) */}
                <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl border border-violet-200 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-600" /><span className="text-sm font-bold text-violet-700">프로모션 카드</span></div>
                    <span className="text-[11px] text-violet-500 italic">변경하려면 이전 단계에서 새 브리핑</span>
                  </div>
                  {(() => {
                    const card = promotionCard;
                    const cardFields = [
                      { key: 'name', label: '프로모션명', icon: '🎯' }, { key: 'benefit', label: '혜택/할인', icon: '🎁' },
                      { key: 'condition', label: '조건', icon: '📋' }, { key: 'period', label: '기간', icon: '📅' },
                      { key: 'target', label: '대상', icon: '👥' }, { key: 'couponCode', label: '쿠폰코드', icon: '🏷️' },
                      { key: 'extra', label: '기타', icon: '💡' },
                    ];
                    return (
                      <div className="space-y-3">
                        {cardFields.map(({ key, label, icon }) => {
                          const value = (card as any)[key];
                          if (!value) return null;
                          return (
                            <div key={key} className="flex items-start gap-3">
                              <span className="text-base mt-0.5 shrink-0">{icon}</span>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-gray-500 mb-0.5">{label}</div>
                                <div className="text-sm text-gray-800 font-medium">{value}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                {/* 타겟 조건 카드 (오른쪽) — ★ B+0407-2: 수정 불가 (read-only) */}
                <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-xl border border-blue-200 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2"><Users className="w-4 h-4 text-blue-600" /><span className="text-sm font-bold text-blue-700">발송 대상</span></div>
                    <span className="text-[11px] text-blue-500 italic">변경하려면 이전 단계에서 새 브리핑</span>
                  </div>

                  {/* 타겟 요약 (description) — ★ B+0407-2: read-only 모드 */}
                  {(() => {
                    const tc = targetCondition;
                    const hasCondition = hasTargetCondition(tc);

                    if (!hasCondition) {
                      return (
                        <div className="text-center py-6">
                          <Users className="w-8 h-8 text-blue-300 mx-auto mb-2" />
                          <div className="text-sm font-medium text-blue-600 mb-1">전체 고객 대상</div>
                          <div className="text-xs text-gray-400 mb-2">브리핑에 타겟 조건이 없어 전체 고객에게 발송됩니다.</div>
                          {targetRecounting ? (
                            <div className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 text-blue-500 animate-spin" /><span className="text-sm text-blue-500">재조회 중...</span></div>
                          ) : (
                            <div className="text-lg font-bold text-blue-700">{estimatedCount.toLocaleString()}명</div>
                          )}
                          {!targetRecounting && unsubscribeCount > 0 && <div className="text-xs text-red-400 mt-0.5">수신거부 {unsubscribeCount.toLocaleString()}명 제외</div>}
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-3">
                        {/* 요약 */}
                        {tc.description && (
                          <div className="px-3 py-2 bg-blue-100/60 rounded-lg border border-blue-200">
                            <div className="text-xs font-semibold text-blue-700">{tc.description}</div>
                            <div className="flex items-center gap-2 mt-1.5">
                              {targetRecounting ? (
                                <><Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" /><span className="text-xs text-blue-500">재조회 중...</span></>
                              ) : (
                                <span className="text-sm font-bold text-blue-800">{estimatedCount.toLocaleString()}명</span>
                              )}
                              {!targetRecounting && unsubscribeCount > 0 && <span className="text-xs text-red-400">(수신거부 {unsubscribeCount.toLocaleString()}명 제외)</span>}
                            </div>
                          </div>
                        )}
                        {/* 각 필드 — read-only 표시만 */}
                        {targetFields.map(({ key, label, icon }) => {
                          const value = (tc as any)[key];
                          if (!value) return null;
                          return (
                            <div key={key} className="flex items-start gap-3">
                              <span className="text-base mt-0.5 shrink-0">{icon}</span>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-gray-500 mb-0.5">{label}</div>
                                <div className="text-sm text-gray-800 font-medium">{value}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>

              <details className="mt-4">
                <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">원본 브리핑 보기</summary>
                <div className="mt-2 p-3 bg-gray-50 rounded-lg text-xs text-gray-500 whitespace-pre-wrap">{briefing}</div>
              </details>
            </div>
          )}

          {/* Step 4 — 핸드폰 모양 3개 가로 배치 (기존 AI 한줄로와 동일) */}
          {currentStep === 4 && (
            <div>
              <div className="text-sm text-gray-600 mb-3">💬 {channel} 메시지 추천 (택1)</div>
              {isGenerating ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Loader2 className="w-8 h-8 text-violet-500 animate-spin mb-3" />
                  <span className="text-sm text-gray-500">AI가 맞춤 문안을 생성하고 있습니다...</span>
                  <span className="text-xs text-gray-400 mt-1">개인화 변수를 활용하여 최적의 문안을 만들고 있어요</span>
                </div>
              ) : variants.length > 0 ? (
                <div className="grid grid-cols-3 gap-5">
                  {variants.map((msg, idx) => (
                    <label key={msg.variant_id || idx} className="cursor-pointer group">
                      <input type="radio" name="custom-message" className="hidden" checked={selectedVariantIdx === idx} onChange={() => { setSelectedVariantIdx(idx); setEditingIdx(null); }} />
                      <div className={`rounded-[1.8rem] p-[3px] transition-all ${selectedVariantIdx === idx ? 'bg-gradient-to-b from-purple-400 to-purple-600 shadow-lg shadow-purple-200' : 'bg-gray-300 hover:bg-gray-400'}`}>
                        <div className="bg-white rounded-[1.6rem] overflow-hidden flex flex-col" style={{ height: '420px' }}>
                          {/* 상단 */}
                          <div className="px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100 flex justify-between items-center shrink-0 border-b">
                            <span className="text-[11px] text-gray-400 font-medium">문자메시지</span>
                            <div className="flex items-center gap-1.5">
                              {selectedVariantIdx === idx && editingIdx !== idx && (
                                <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingIdx(idx); }}
                                  className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded hover:bg-purple-200 transition-colors">✏️ 수정</button>
                              )}
                              <span className="text-[11px] font-bold text-purple-600">{msg.variant_id}. {msg.variant_name}</span>
                            </div>
                          </div>
                          {/* LMS/MMS 제목 */}
                          {(channel === 'LMS' || channel === 'MMS') && msg.subject && (
                            <div className="px-4 py-1.5 bg-orange-50 border-b border-orange-200 shrink-0">
                              <span className="text-[11px] font-bold text-orange-700">{buildAdSubjectFront(msg.subject, channel, isAdLocal)}</span>
                            </div>
                          )}
                          {/* 메시지 영역 */}
                          <div className="flex-1 overflow-y-auto p-3 bg-gradient-to-b from-purple-50/30 to-white">
                            {editingIdx === idx ? (
                              <div className="h-full flex flex-col gap-2">
                                {(channel === 'LMS' || channel === 'MMS') && (
                                  <input type="text" value={msg.subject || ''} onChange={(e) => { const u = [...variants]; u[idx] = { ...u[idx], subject: e.target.value }; setVariants(u); }}
                                    placeholder="LMS 제목" className="w-full text-[12px] px-2 py-1.5 border border-orange-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400" />
                                )}
                                <textarea value={msg.message_text} onChange={(e) => { const u = [...variants]; u[idx] = { ...u[idx], message_text: e.target.value }; setVariants(u); }}
                                  className="flex-1 w-full text-[12px] leading-[1.6] p-2 border border-purple-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-400" autoFocus />
                                <button onClick={(e) => { 
                                  e.preventDefault(); e.stopPropagation(); 
                                  // ★ #9 수정: SMS 편집 완료 시 바이트 초과 경고
                                  if (channel === 'SMS') {
                                    const editedBytes = calculateBytes(wrapAdText(msg.message_text || ''));
                                    if (editedBytes > 90) {
                                      setConfirmModal({
                                        title: 'SMS 바이트 초과',
                                        message: `수정한 문안이 SMS 90바이트를 초과합니다 (${editedBytes}바이트).\nLMS로 전환하거나 추가 수정하시겠습니까?`,
                                        confirmText: '계속 수정',
                                        cancelText: '그대로 저장',
                                        onConfirm: () => { setConfirmModal(null); },
                                        onCancel: () => { setConfirmModal(null); setEditingIdx(null); },
                                      });
                                      return;
                                    }
                                  }
                                  setEditingIdx(null); 
                                }}
                                  className="py-1.5 bg-purple-600 text-white text-[11px] font-medium rounded-lg hover:bg-purple-700 transition-colors">✅ 수정 완료</button>
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs bg-purple-100">📱</div>
                                <div className="rounded-2xl rounded-tl-sm p-3 shadow-sm border text-[12px] leading-[1.6] whitespace-pre-wrap break-all overflow-hidden text-gray-700 max-w-[95%] bg-white border-gray-100">
                                  {/* ★ B1 후속: MMS 첨부 이미지 미리보기 */}
                                  {channel === 'MMS' && mmsUploadedImages && mmsUploadedImages.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mb-1.5">
                                      {mmsUploadedImages.map((img, i) => (
                                        <img key={i} src={img.url} alt="" className="w-full h-auto rounded border border-purple-200" style={{ maxHeight: '120px', objectFit: 'cover' }} />
                                      ))}
                                    </div>
                                  )}
                                  {highlightVars(wrapAdText(msg.message_text || ''))}
                                </div>
                              </div>
                            )}
                          </div>
                          {/* 하단 바이트 */}
                          <div className="px-3 py-2 border-t bg-gray-50 text-center shrink-0">
                            {(() => {
                              const bytes = calculateBytes(wrapAdText(msg.message_text || ''));
                              const limit = channel === 'SMS' ? 90 : 2000;
                              const isOver = bytes > limit;
                              return (
                                <span className={`text-[10px] ${isOver ? 'text-red-600 font-bold' : selectedVariantIdx === idx ? 'text-purple-600 font-medium' : 'text-gray-400'}`}>
                                  {isOver && '⚠️ '}{bytes} / {limit} bytes{isOver && channel === 'SMS' ? ' (초과! LMS 전환 권장)' : ''}
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">메시지를 불러오는 중...</div>
              )}
              {/* B16-03 + B17-12: 담당자 테스트 결과 표시 (자체 핸들러 결과 사용) */}
              {customTestResult && (
                <div className="mt-3 mx-1 p-3 bg-gray-50 rounded-lg text-sm whitespace-pre-wrap border">
                  {customTestResult}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 하단 버튼 */}
        <div className="px-6 py-4 border-t bg-gray-50 flex justify-between items-center shrink-0">
          <button onClick={() => { if (currentStep === 1) onClose(); else setCurrentStep(prev => prev - 1); }}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">
            <ChevronLeft className="w-4 h-4" />{currentStep === 1 ? '닫기' : '이전'}
          </button>
          <div className="flex items-center gap-3">
            {currentStep === 2 && (
              <button onClick={handleParseBriefing} disabled={!canGoNext() || isParsing}
                className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {isParsing ? <><Loader2 className="w-4 h-4 animate-spin" /> AI 분석 중...</> : <><Sparkles className="w-4 h-4" /> AI 분석</>}
              </button>
            )}
            {currentStep === 3 && (
              <button onClick={handleGenerateCustom} disabled={isGenerating}
                className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {isGenerating ? <><Loader2 className="w-4 h-4 animate-spin" /> 문안 생성 중...</> : <><Sparkles className="w-4 h-4" /> 맞춤 문안 생성</>}
              </button>
            )}
            {currentStep === 4 && (
              <>
                {/* ★ D92: 미리보기 버튼 — 한줄로와 동일하게 개인화 미리보기 제공 */}
                <button
                  onClick={() => setShowPreviewModal(true)}
                  disabled={variants.length === 0}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                >
                  📄 미리보기
                </button>
                {/* B16-03 + B17-12: 담당자 테스트 버튼 — 자체 핸들러 사용 (variants 데이터 참조) */}
                <button
                  onClick={handleCustomTestSend}
                  disabled={customTestSending || customTestCooldown || variants.length === 0}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                >
                  {customTestSending ? '📱 발송 중...' : customTestCooldown ? '⏳ 10초 대기' : '📱 담당자테스트'}
                </button>
                {/* B16-03: 스팸필터 테스트 버튼 */}
                {setShowSpamFilter && setSpamFilterData && (
                  <button
                    onClick={() => {
                      if (isSpamFilterLocked) return;
                      const msg = variants[selectedVariantIdx]?.message_text || '';
                      const cb = selectedCallback || '';
                      // ★ D88: sampleData(타겟 필터 매칭 샘플) 우선 사용, 없으면 sampleCustomer(prop) 폴백
                      const sc = (Object.keys(sampleData).length > 0 ? sampleData : sampleCustomer) || {};
                      // ★ D121: 미리보기와 동일한 데이터+aliasMap으로 스팸필터에도 치환
                      const hasSample = sc && Object.keys(sc).length > 0;
                      const replaceVars = (text: string) => hasSample
                        ? replaceMessageVars(text, availableFields, sc, { removeUnmatched: true })
                        : text;
                      const smsRaw = buildAdMessageFront(msg, 'SMS', isAdLocal, optOutNumber);
                      const lmsRaw = buildAdMessageFront(msg, 'LMS', isAdLocal, optOutNumber);
                      const smsMsg = replaceVars(smsRaw);
                      const lmsMsg = replaceVars(lmsRaw);
                      const subj = variants[selectedVariantIdx]?.subject || '';
                      setSpamFilterData({ sms: smsMsg, lms: lmsMsg, callback: cb, msgType: channel, subject: subj, isAd: isAdLocal, firstRecipient: sc });
                      setShowSpamFilter(true);
                    }}
                    disabled={variants.length === 0}
                    className={`flex items-center gap-1.5 px-4 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-medium rounded-lg transition-colors ${isSpamFilterLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    {isSpamFilterLocked ? '🔒' : '🛡️'} 스팸필터
                  </button>
                )}
                {/* 발송 확정 버튼 */}
                <button onClick={() => {
                  if (onConfirmSend && variants[selectedVariantIdx]) {
                    // ★ D91: SMS 바이트 초과 시 LMS 전환 확인 모달 (경고 대신 전환 옵션 제공)
                    const selectedMsg = variants[selectedVariantIdx].message_text || '';
                    const totalBytes = calculateBytes(wrapAdText(selectedMsg));
                    if (channel === 'SMS' && totalBytes > 90) {
                      setLmsConvertModal({ show: true, bytes: totalBytes });
                      return;
                    }
                    onConfirmSend({
                      variant: variants[selectedVariantIdx],
                      targetFilters,
                      targetCondition: editingTarget ? editedTarget : targetCondition,
                      promotionCard: (editingCard ? editedCard : promotionCard)!,
                      channel,
                      tone,
                      url: url.trim(),
                      briefing: briefing.trim(),
                      personalFields: selectedFields,
                      estimatedCount,
                      unsubscribeCount,
                      isAd: isAdLocal,
                    });
                  }
                }} disabled={variants.length === 0}
                  className="flex items-center gap-2 px-5 py-2.5 bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  <CheckCircle2 className="w-4 h-4" /> 발송 확정 ({estimatedCount.toLocaleString()}명)
                </button>
              </>
            )}
            {currentStep === 1 && (
              <button onClick={() => setCurrentStep(2)} disabled={!canGoNext()}
                className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                다음 <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ★ D92: 맞춤한줄 미리보기 모달 — 한줄로와 동일한 개인화 미리보기 */}
      {showPreviewModal && variants[selectedVariantIdx] && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b bg-emerald-50 flex justify-between items-center">
              <h3 className="font-bold text-lg">📄 메시지 미리보기</h3>
              <button onClick={() => setShowPreviewModal(false)} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
            </div>
            <div className="p-4">
              {/* 폰 프레임 */}
              <div className="mx-auto w-[280px]">
                <div className="rounded-[1.8rem] p-[3px] bg-gradient-to-b from-purple-400 to-purple-600 shadow-lg">
                  <div className="bg-white rounded-[1.6rem] overflow-hidden flex flex-col" style={{ height: '420px' }}>
                    <div className="px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100 flex justify-between items-center shrink-0 border-b">
                      <span className="text-[11px] text-gray-400 font-medium">문자메시지</span>
                      <span className="text-[11px] font-bold text-purple-600">{channel}</span>
                    </div>
                    {(channel === 'LMS' || channel === 'MMS') && variants[selectedVariantIdx]?.subject && (
                      <div className="px-4 py-2 bg-orange-50 border-b border-orange-200">
                        <span className="text-sm font-bold text-orange-700">{buildAdSubjectFront(variants[selectedVariantIdx].subject, channel, isAdLocal)}</span>
                      </div>
                    )}
                    <div className="flex-1 overflow-y-auto p-3 bg-gradient-to-b from-purple-50/30 to-white">
                      {/* ★ 검수리스트 UX: 머지 토글 — 변수 강조 vs 첫 고객 데이터 머지 */}
                      {Object.keys(sampleData).length > 0 && (
                        <div className="flex items-center gap-1 mb-2 px-1">
                          <button
                            onClick={() => setShowVarsHighlightOnly(true)}
                            className={`flex-1 text-[10px] py-1 rounded transition-colors ${showVarsHighlightOnly ? 'bg-amber-100 text-amber-800 font-bold' : 'bg-gray-50 text-gray-400'}`}
                            title="개인화 변수 위치 강조 (실제 값 미치환)"
                          >변수 강조</button>
                          <button
                            onClick={() => setShowVarsHighlightOnly(false)}
                            className={`flex-1 text-[10px] py-1 rounded transition-colors ${!showVarsHighlightOnly ? 'bg-purple-100 text-purple-800 font-bold' : 'bg-gray-50 text-gray-400'}`}
                            title="첫 고객 데이터로 실제 머지된 결과 미리보기"
                          >머지 결과</button>
                        </div>
                      )}
                      <div className="flex gap-2 mt-1">
                        <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center shrink-0 text-xs">📱</div>
                        <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm border border-gray-100 text-[12px] leading-[1.6] whitespace-pre-wrap break-all text-gray-700 max-w-[95%]">
                          {/* ★ B1 후속: 미리보기 모달에도 MMS 이미지 표시 */}
                          {channel === 'MMS' && mmsUploadedImages && mmsUploadedImages.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-2">
                              {mmsUploadedImages.map((img, i) => (
                                <img key={i} src={img.url} alt="" className="w-full h-auto rounded border border-purple-200" style={{ maxHeight: '160px', objectFit: 'cover' }} />
                              ))}
                            </div>
                          )}
                          {Object.keys(sampleData).length > 0 && !showVarsHighlightOnly
                            ? replaceSampleVars(wrapAdText(variants[selectedVariantIdx]?.message_text || ''))
                            : highlightVars(wrapAdText(variants[selectedVariantIdx]?.message_text || ''))}
                        </div>
                      </div>
                    </div>
                    <div className="px-3 py-2 border-t bg-gray-50 text-center shrink-0">
                      <span className="text-[10px] text-gray-400">
                        {calculateBytes(Object.keys(sampleData).length > 0 ? replaceSampleVars(wrapAdText(variants[selectedVariantIdx]?.message_text || '')) : wrapAdText(variants[selectedVariantIdx]?.message_text || ''))} / {channel === 'SMS' ? 90 : 2000} bytes
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              {/* 샘플 고객 정보 */}
              {Object.keys(sampleData).length > 0 && (
                <div className="mt-3 p-2 bg-purple-50 rounded-lg">
                  <div className="text-[10px] text-purple-600 font-medium mb-1">✨ 실제 타겟 고객 데이터 기반 미리보기</div>
                  <div className="text-[10px] text-purple-500">
                    {availableFields.filter(f => sampleData[f.field_key] != null).slice(0, 5).map(f => `${f.field_label || f.field_key}: ${formatPreviewValue(sampleData[f.field_key])}`).join(' | ')}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 커스텀 Alert 모달 */}
      {/* ★ D91: SMS→LMS 전환 확인 모달 */}
      {lmsConvertModal.show && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 text-center">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 bg-amber-100">
                <AlertTriangle className="w-6 h-6 text-amber-600" />
              </div>
              <h4 className="text-base font-bold text-gray-800 mb-2">메시지 길이 초과</h4>
              <p className="text-sm text-gray-600 leading-relaxed">
                SMS 제한을 초과합니다 ({lmsConvertModal.bytes}바이트).<br />
                LMS로 전환하여 발송하시겠습니까?
              </p>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => setLmsConvertModal({ show: false, bytes: 0 })}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => {
                  setChannel('LMS');
                  setLmsConvertModal({ show: false, bytes: 0 });
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-green-600 hover:bg-green-700 transition-colors"
              >
                LMS 전환
              </button>
            </div>
          </div>
        </div>
      )}
      {alertModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 text-center">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 ${
                alertModal.type === 'error' ? 'bg-red-100' : alertModal.type === 'warning' ? 'bg-amber-100' : 'bg-blue-100'
              }`}>
                {alertModal.type === 'error' ? (
                  <XCircle className="w-6 h-6 text-red-600" />
                ) : (
                  <AlertTriangle className={`w-6 h-6 ${alertModal.type === 'warning' ? 'text-amber-600' : 'text-blue-600'}`} />
                )}
              </div>
              <h4 className="text-base font-bold text-gray-800 mb-2">{alertModal.title}</h4>
              <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{alertModal.message}</p>
            </div>
            <div className="px-6 pb-5">
              <button
                onClick={() => setAlertModal(null)}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-colors ${
                  alertModal.type === 'error' ? 'bg-red-600 hover:bg-red-700' : alertModal.type === 'warning' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
                autoFocus
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 커스텀 Confirm 모달 */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-3">
                <AlertTriangle className="w-6 h-6 text-amber-600" />
              </div>
              <h4 className="text-base font-bold text-gray-800 mb-2">{confirmModal.title}</h4>
              <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{confirmModal.message}</p>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={confirmModal.onCancel}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                {confirmModal.cancelText}
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 transition-colors"
                autoFocus
              >
                {confirmModal.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
