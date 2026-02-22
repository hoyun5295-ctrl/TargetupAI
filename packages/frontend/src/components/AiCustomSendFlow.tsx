import { useState, useEffect } from 'react';
import { 
  X, ChevronRight, ChevronLeft, Sparkles, CheckCircle2, 
  FileText, Palette, Link2, Loader2, Pencil, Check,
  User, ShoppingBag, MapPin, Star, Calendar, Hash, Users
} from 'lucide-react';

interface AiCustomSendFlowProps {
  onClose: () => void;
  brandName: string;
  callbackNumbers: { id: string; phone: string; label: string; is_default: boolean }[];
  selectedCallback: string;
  isAd: boolean;
  optOutNumber: string;
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
  region: '', purchasePeriod: '', storeName: '', minPurchaseAmount: '', extra: '',
};

const CATEGORY_ICONS: Record<string, any> = {
  '기본정보': User, '구매정보': ShoppingBag, '지역정보': MapPin,
  '등급/포인트': Star, '날짜정보': Calendar, '기타': Hash,
};

const PERSONALIZATION_FIELDS = [
  'name', 'gender', 'grade', 'store_name', 'region', 
  'birth_date', 'birth_month_day', 'age', 'points',
  'total_purchase_amount', 'purchase_count', 'recent_purchase_date',
  'recent_purchase_store', 'avg_order_value', 'wedding_anniversary',
];

const FIELD_CATEGORIES: Record<string, string> = {
  name: '기본정보', gender: '기본정보', age: '기본정보',
  birth_date: '기본정보', birth_month_day: '기본정보',
  grade: '등급/포인트', points: '등급/포인트',
  store_name: '지역정보', region: '지역정보', recent_purchase_store: '지역정보',
  total_purchase_amount: '구매정보', purchase_count: '구매정보',
  recent_purchase_date: '구매정보', avg_order_value: '구매정보',
  wedding_anniversary: '날짜정보',
};

const TONE_OPTIONS = [
  { value: 'friendly', label: '😊 친근한', desc: '이웃에게 말하듯 따뜻하게' },
  { value: 'formal', label: '👔 격식있는', desc: '비즈니스 톤으로 신뢰감 있게' },
  { value: 'humorous', label: '😄 유머러스한', desc: '재미있고 기억에 남게' },
  { value: 'urgent', label: '🔥 긴급한', desc: '지금 바로 행동을 유도' },
  { value: 'premium', label: '✨ 프리미엄', desc: 'VIP를 위한 고급스러운 톤' },
  { value: 'casual', label: '💬 캐주얼', desc: '편하고 가벼운 톤' },
];

const SAMPLE_DATA: Record<string, string> = {
  '이름': '김민수', '성별': '여성', '등급': 'VIP', '매장명': '강남점',
  '지역': '서울', '생일': '03-15', '나이': '32',
  '포인트': '12,500', '구매금액': '350,000', '구매횟수': '8',
  '최근구매일': '2026-02-10', '최근구매매장': '강남점',
  '평균주문금액': '43,750', '결혼기념일': '06-20',
};

export default function AiCustomSendFlow({
  onClose, brandName, callbackNumbers, selectedCallback, isAd, optOutNumber,
}: AiCustomSendFlowProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const TOTAL_STEPS = 4;

  // Step 1
  const [availableFields, setAvailableFields] = useState<any[]>([]);
  const [selectedFields, setSelectedFields] = useState<string[]>(['name']);
  const [fieldsLoading, setFieldsLoading] = useState(true);

  // Step 2
  const [briefing, setBriefing] = useState('');
  const [url, setUrl] = useState('');
  const [tone, setTone] = useState('friendly');
  const [channel, setChannel] = useState<'SMS' | 'LMS'>('LMS');

  // Step 3
  const [promotionCard, setPromotionCard] = useState<PromotionCard | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [editingCard, setEditingCard] = useState(false);
  const [editedCard, setEditedCard] = useState<PromotionCard | null>(null);
  const [targetCondition, setTargetCondition] = useState<TargetCondition>(EMPTY_TARGET_CONDITION);
  const [editingTarget, setEditingTarget] = useState(false);
  const [editedTarget, setEditedTarget] = useState<TargetCondition>(EMPTY_TARGET_CONDITION);

  // Step 4
  const [variants, setVariants] = useState<MessageVariant[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedVariantIdx, setSelectedVariantIdx] = useState(0);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  useEffect(() => { loadFields(); }, []);

  const loadFields = async () => {
    try {
      setFieldsLoading(true);
      const token = localStorage.getItem('token');
      const res = await fetch('/api/customers/enabled-fields', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAvailableFields((data.fields || []).filter((f: any) => PERSONALIZATION_FIELDS.includes(f.field_key)));
      }
    } catch (error) { console.error('필드 로드 실패:', error); }
    finally { setFieldsLoading(false); }
  };

  const toggleField = (fieldKey: string) => {
    setSelectedFields(prev => prev.includes(fieldKey) ? prev.filter(k => k !== fieldKey) : [...prev, fieldKey]);
  };

  const calculateBytes = (text: string) => {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) { bytes += text.charCodeAt(i) > 127 ? 2 : 1; }
    return bytes;
  };

  const formatRejectNumber = (num: string) => {
    const clean = num.replace(/-/g, '');
    if (clean.length === 10) return `${clean.slice(0,3)}-${clean.slice(3,6)}-${clean.slice(6)}`;
    return num;
  };

  const wrapAdText = (msg: string) => {
    if (!msg || !isAd) return msg;
    const adPrefix = channel === 'SMS' ? '(광고)' : '(광고) ';
    const adSuffix = channel === 'SMS'
      ? `\n무료거부${optOutNumber.replace(/-/g, '')}`
      : `\n무료수신거부 ${formatRejectNumber(optOutNumber)}`;
    return adPrefix + msg + adSuffix;
  };

  const replaceSampleVars = (text: string) => {
    let result = text;
    Object.entries(SAMPLE_DATA).forEach(([k, v]) => { result = result.replace(new RegExp(`%${k}%`, 'g'), v); });
    return result;
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
        setCurrentStep(3);
      } else { const err = await res.json(); alert(err.error || '파싱 실패'); }
    } catch (error) { console.error('브리핑 파싱 실패:', error); alert('서버 오류가 발생했습니다.'); }
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
          url: url.trim() || undefined, tone, brandName, channel, isAd,
        })
      });
      if (res.ok) {
        const data = await res.json();
        setVariants(data.variants || []);
        setSelectedVariantIdx(0);
      } else { const err = await res.json(); alert(err.error || '문안 생성 실패'); setCurrentStep(3); }
    } catch (error) { console.error('문안 생성 실패:', error); alert('서버 오류가 발생했습니다.'); setCurrentStep(3); }
    finally { setIsGenerating(false); }
  };

  const groupedFields = availableFields.reduce((acc: Record<string, any[]>, field: any) => {
    const cat = FIELD_CATEGORIES[field.field_key] || '기타';
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
                        <div className="flex items-center gap-1.5 mb-2"><IconComp className="w-3.5 h-3.5 text-gray-400" /><span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{category}</span></div>
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
                <h4 className="text-base font-bold text-gray-800 mb-1">프로모션을 브리핑해주세요</h4>
                <p className="text-sm text-gray-500">회의에서 팀원에게 설명하듯 자연스럽게 적으시면 됩니다. <b className="text-violet-600">발송 대상도 함께 적으면</b> AI가 타겟까지 자동 분석합니다.</p>
              </div>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1.5"><Palette className="w-4 h-4 inline mr-1 text-violet-500" />톤 / 분위기</label>
                  <div className="space-y-1.5">
                    {TONE_OPTIONS.map(opt => (
                      <button key={opt.value} onClick={() => setTone(opt.value)}
                        className={`w-full px-3 py-2 rounded-lg border text-left text-sm transition-all ${tone === opt.value ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                        <span className="font-medium">{opt.label}</span><span className="text-xs text-gray-400 ml-1.5">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">📱 발송 채널</label>
                  <div className="space-y-1.5">
                    {(['SMS', 'LMS'] as const).map(ch => (
                      <button key={ch} onClick={() => setChannel(ch)}
                        className={`w-full px-3 py-2.5 rounded-lg border text-left text-sm transition-all ${channel === ch ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                        <div className="font-medium">{ch}</div>
                        <div className="text-xs text-gray-400">{ch === 'SMS' ? '90바이트 (한글 약 45자)' : '2,000바이트 (한글 약 1,000자)'}</div>
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="text-xs font-medium text-gray-500 mb-2">선택 요약</div>
                    <div className="space-y-1 text-xs text-gray-600">
                      <div>• 개인화 필드: <b className="text-violet-600">{selectedFields.length}개</b></div>
                      <div>• 톤: <b>{TONE_OPTIONS.find(t => t.value === tone)?.label}</b></div>
                      <div>• 채널: <b>{channel}</b></div>
                      {url && <div>• URL: <b className="text-blue-500">{url.length > 30 ? url.substring(0, 30) + '...' : url}</b></div>}
                      <div>• 광고: <b>{isAd ? '예 (법정문구 자동삽입)' : '아니오'}</b></div>
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
                <p className="text-sm text-gray-500">내용이 정확한지 확인하고, 필요하면 직접 수정할 수 있습니다.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* 프로모션 카드 (왼쪽) */}
                <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl border border-violet-200 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-600" /><span className="text-sm font-bold text-violet-700">프로모션 카드</span></div>
                    <button onClick={() => { setEditingCard(!editingCard); if (!editingCard) setEditedCard({ ...promotionCard }); }}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${editingCard ? 'bg-violet-600 text-white' : 'bg-white text-violet-600 border border-violet-300 hover:bg-violet-50'}`}>
                      {editingCard ? <><Check className="w-3 h-3" /> 수정완료</> : <><Pencil className="w-3 h-3" /> 수정하기</>}
                    </button>
                  </div>
                  {(() => {
                    const card = editingCard ? editedCard! : promotionCard;
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
                          if (!value && !editingCard) return null;
                          return (
                            <div key={key} className="flex items-start gap-3">
                              <span className="text-base mt-0.5 shrink-0">{icon}</span>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-gray-500 mb-0.5">{label}</div>
                                {editingCard ? (
                                  <input type="text" value={(editedCard as any)?.[key] || ''}
                                    onChange={(e) => setEditedCard(prev => prev ? { ...prev, [key]: e.target.value } : null)}
                                    className="w-full px-3 py-1.5 border border-violet-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white" placeholder={`${label}을 입력하세요`} />
                                ) : (<div className="text-sm text-gray-800 font-medium">{value}</div>)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                {/* 타겟 조건 카드 (오른쪽) */}
                <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-xl border border-blue-200 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2"><Users className="w-4 h-4 text-blue-600" /><span className="text-sm font-bold text-blue-700">발송 대상</span></div>
                    <button onClick={() => { setEditingTarget(!editingTarget); if (!editingTarget) setEditedTarget({ ...targetCondition }); }}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${editingTarget ? 'bg-blue-600 text-white' : 'bg-white text-blue-600 border border-blue-300 hover:bg-blue-50'}`}>
                      {editingTarget ? <><Check className="w-3 h-3" /> 수정완료</> : <><Pencil className="w-3 h-3" /> 수정하기</>}
                    </button>
                  </div>

                  {/* 타겟 요약 (description) */}
                  {(() => {
                    const tc = editingTarget ? editedTarget : targetCondition;
                    const hasCondition = hasTargetCondition(tc);

                    if (!hasCondition && !editingTarget) {
                      return (
                        <div className="text-center py-6">
                          <Users className="w-8 h-8 text-blue-300 mx-auto mb-2" />
                          <div className="text-sm font-medium text-blue-600 mb-1">전체 고객 대상</div>
                          <div className="text-xs text-gray-400">브리핑에 타겟 조건이 없어 전체 고객에게 발송됩니다.</div>
                          <button onClick={() => { setEditingTarget(true); setEditedTarget({ ...targetCondition }); }}
                            className="mt-3 text-xs text-blue-500 hover:text-blue-700 underline">타겟 조건 직접 추가</button>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-3">
                        {/* 요약 */}
                        {tc.description && !editingTarget && (
                          <div className="px-3 py-2 bg-blue-100/60 rounded-lg border border-blue-200">
                            <div className="text-xs font-semibold text-blue-700">{tc.description}</div>
                          </div>
                        )}
                        {/* 각 필드 */}
                        {targetFields.map(({ key, label, icon }) => {
                          const value = (tc as any)[key];
                          if (!value && !editingTarget) return null;
                          return (
                            <div key={key} className="flex items-start gap-3">
                              <span className="text-base mt-0.5 shrink-0">{icon}</span>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-gray-500 mb-0.5">{label}</div>
                                {editingTarget ? (
                                  <input type="text" value={(editedTarget as any)?.[key] || ''}
                                    onChange={(e) => setEditedTarget(prev => ({ ...prev, [key]: e.target.value }))}
                                    className="w-full px-3 py-1.5 border border-blue-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" placeholder={`${label} (비워두면 제한 없음)`} />
                                ) : (<div className="text-sm text-gray-800 font-medium">{value}</div>)}
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
                          {/* LMS 제목 */}
                          {channel === 'LMS' && msg.subject && (
                            <div className="px-4 py-1.5 bg-orange-50 border-b border-orange-200 shrink-0">
                              <span className="text-[11px] font-bold text-orange-700">{msg.subject}</span>
                            </div>
                          )}
                          {/* 메시지 영역 */}
                          <div className="flex-1 overflow-y-auto p-3 bg-gradient-to-b from-purple-50/30 to-white">
                            {editingIdx === idx ? (
                              <div className="h-full flex flex-col gap-2">
                                {channel === 'LMS' && (
                                  <input type="text" value={msg.subject || ''} onChange={(e) => { const u = [...variants]; u[idx] = { ...u[idx], subject: e.target.value }; setVariants(u); }}
                                    placeholder="LMS 제목" className="w-full text-[12px] px-2 py-1.5 border border-orange-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400" />
                                )}
                                <textarea value={msg.message_text} onChange={(e) => { const u = [...variants]; u[idx] = { ...u[idx], message_text: e.target.value }; setVariants(u); }}
                                  className="flex-1 w-full text-[12px] leading-[1.6] p-2 border border-purple-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-400" autoFocus />
                                <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingIdx(null); }}
                                  className="py-1.5 bg-purple-600 text-white text-[11px] font-medium rounded-lg hover:bg-purple-700 transition-colors">✅ 수정 완료</button>
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs bg-purple-100">📱</div>
                                <div className="rounded-2xl rounded-tl-sm p-3 shadow-sm border text-[12px] leading-[1.6] whitespace-pre-wrap break-all overflow-hidden text-gray-700 max-w-[95%] bg-white border-gray-100">
                                  {replaceSampleVars(wrapAdText(msg.message_text || ''))}
                                </div>
                              </div>
                            )}
                          </div>
                          {/* 하단 바이트 */}
                          <div className="px-3 py-2 border-t bg-gray-50 text-center shrink-0">
                            <span className={`text-[10px] ${selectedVariantIdx === idx ? 'text-purple-600 font-medium' : 'text-gray-400'}`}>
                              {calculateBytes(wrapAdText(msg.message_text || ''))} / {channel === 'SMS' ? 90 : 2000} bytes
                            </span>
                          </div>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">메시지를 불러오는 중...</div>
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
              <button onClick={() => { alert('발송 확정 기능은 다음 세션에서 연결합니다.'); }} disabled={variants.length === 0}
                className="flex items-center gap-2 px-5 py-2.5 bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <CheckCircle2 className="w-4 h-4" /> 발송 확정
              </button>
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
    </div>
  );
}
