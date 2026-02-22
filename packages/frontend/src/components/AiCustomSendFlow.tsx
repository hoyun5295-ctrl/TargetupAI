import { useState, useEffect } from 'react';
import { 
  X, ChevronRight, ChevronLeft, Sparkles, CheckCircle2, 
  FileText, Palette, Link2, Loader2, Pencil, Check,
  User, ShoppingBag, MapPin, Star, Calendar, Hash
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

interface MessageVariant {
  variant_id: string;
  variant_name: string;
  concept: string;
  message_text: string;
  subject?: string;
  score: number;
}

// 필드 카테고리별 아이콘
const CATEGORY_ICONS: Record<string, any> = {
  '기본정보': User,
  '구매정보': ShoppingBag,
  '지역정보': MapPin,
  '등급/포인트': Star,
  '날짜정보': Calendar,
  '기타': Hash,
};

// 개인화에 적합한 필드만 (시스템 필드 제외)
const PERSONALIZATION_FIELDS = [
  'name', 'gender', 'grade', 'store_name', 'region', 
  'birth_date', 'birth_month_day', 'age', 'points',
  'total_purchase_amount', 'purchase_count', 'recent_purchase_date',
  'recent_purchase_store', 'avg_order_value', 'wedding_anniversary',
];

// 필드별 카테고리 분류
const FIELD_CATEGORIES: Record<string, string> = {
  name: '기본정보', gender: '기본정보', age: '기본정보',
  birth_date: '기본정보', birth_month_day: '기본정보',
  grade: '등급/포인트', points: '등급/포인트',
  store_name: '지역정보', region: '지역정보',
  recent_purchase_store: '지역정보',
  total_purchase_amount: '구매정보', purchase_count: '구매정보',
  recent_purchase_date: '구매정보', avg_order_value: '구매정보',
  wedding_anniversary: '날짜정보',
};

// 톤/분위기 옵션
const TONE_OPTIONS = [
  { value: 'friendly', label: '😊 친근한', desc: '이웃에게 말하듯 따뜻하게' },
  { value: 'formal', label: '👔 격식있는', desc: '비즈니스 톤으로 신뢰감 있게' },
  { value: 'humorous', label: '😄 유머러스한', desc: '재미있고 기억에 남게' },
  { value: 'urgent', label: '🔥 긴급한', desc: '지금 바로 행동을 유도' },
  { value: 'premium', label: '✨ 프리미엄', desc: 'VIP를 위한 고급스러운 톤' },
  { value: 'casual', label: '💬 캐주얼', desc: '편하고 가벼운 톤' },
];

export default function AiCustomSendFlow({
  onClose,
  brandName,
  callbackNumbers,
  selectedCallback,
  isAd,
  optOutNumber,
}: AiCustomSendFlowProps) {
  // Step 관리
  const [currentStep, setCurrentStep] = useState(1);
  const TOTAL_STEPS = 4;

  // Step 1: 개인화 필드 선택
  const [availableFields, setAvailableFields] = useState<any[]>([]);
  const [selectedFields, setSelectedFields] = useState<string[]>(['name']);
  const [fieldsLoading, setFieldsLoading] = useState(true);

  // Step 2: 프로모션 브리핑
  const [briefing, setBriefing] = useState('');
  const [url, setUrl] = useState('');
  const [tone, setTone] = useState('friendly');
  const [channel, setChannel] = useState<'SMS' | 'LMS'>('LMS');

  // Step 3: 프로모션 카드
  const [promotionCard, setPromotionCard] = useState<PromotionCard | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [editingCard, setEditingCard] = useState(false);
  const [editedCard, setEditedCard] = useState<PromotionCard | null>(null);

  // Step 4: 문안 생성
  const [variants, setVariants] = useState<MessageVariant[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState('');

  // 필드 로드
  useEffect(() => {
    loadFields();
  }, []);

  const loadFields = async () => {
    try {
      setFieldsLoading(true);
      const token = localStorage.getItem('token');
      const res = await fetch('/api/customers/enabled-fields', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const fields = (data.fields || []).filter((f: any) => 
          PERSONALIZATION_FIELDS.includes(f.field_key)
        );
        setAvailableFields(fields);
      }
    } catch (error) {
      console.error('필드 로드 실패:', error);
    } finally {
      setFieldsLoading(false);
    }
  };

  const toggleField = (fieldKey: string) => {
    setSelectedFields(prev => 
      prev.includes(fieldKey)
        ? prev.filter(k => k !== fieldKey)
        : [...prev, fieldKey]
    );
  };

  // Step 2 → Step 3: 브리핑 파싱
  const handleParseBriefing = async () => {
    if (!briefing.trim()) return;
    setIsParsing(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/ai/parse-briefing', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ briefing: briefing.trim() })
      });
      if (res.ok) {
        const data = await res.json();
        setPromotionCard(data.promotionCard);
        setEditedCard(data.promotionCard);
        setCurrentStep(3);
      } else {
        const err = await res.json();
        alert(err.error || '파싱 실패');
      }
    } catch (error) {
      console.error('브리핑 파싱 실패:', error);
      alert('서버 오류가 발생했습니다.');
    } finally {
      setIsParsing(false);
    }
  };

  // Step 3 → Step 4: 맞춤 문안 생성
  const handleGenerateCustom = async () => {
    const card = editingCard ? editedCard : promotionCard;
    if (!card) return;
    setIsGenerating(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/ai/generate-custom', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          briefing: briefing.trim(),
          promotionCard: card,
          personalFields: selectedFields,
          url: url.trim() || undefined,
          tone,
          brandName,
          channel,
          isAd,
        })
      });
      if (res.ok) {
        const data = await res.json();
        setVariants(data.variants || []);
        setRecommendation(data.recommendation || '');
        setSelectedVariant(data.recommendation || data.variants?.[0]?.variant_id);
        setCurrentStep(4);
      } else {
        const err = await res.json();
        alert(err.error || '문안 생성 실패');
      }
    } catch (error) {
      console.error('문안 생성 실패:', error);
      alert('서버 오류가 발생했습니다.');
    } finally {
      setIsGenerating(false);
    }
  };

  // 카테고리별 필드 그룹화
  const groupedFields = availableFields.reduce((acc: Record<string, any[]>, field: any) => {
    const cat = FIELD_CATEGORIES[field.field_key] || '기타';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(field);
    return acc;
  }, {});

  // Step 유효성 검사
  const canGoNext = () => {
    switch (currentStep) {
      case 1: return selectedFields.length > 0;
      case 2: return briefing.trim().length >= 10;
      case 3: return promotionCard !== null;
      case 4: return selectedVariant !== null;
      default: return false;
    }
  };

  const stepLabels = ['개인화 필드', '프로모션 브리핑', '프로모션 확인', '문안 생성'];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[720px] max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        
        {/* 헤더 */}
        <div className="px-6 py-4 border-b bg-gradient-to-r from-violet-50 to-purple-50 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-violet-600" />
            <h3 className="text-lg font-bold text-gray-800">AI 맞춤한줄</h3>
            <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-medium">
              Step {currentStep}/{TOTAL_STEPS}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
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
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all ${
                      isDone ? 'bg-violet-600 text-white' :
                      isActive ? 'bg-violet-600 text-white ring-2 ring-violet-200' :
                      'bg-gray-200 text-gray-500'
                    }`}>
                      {isDone ? <Check className="w-3.5 h-3.5" /> : step}
                    </div>
                    <span className={`text-xs truncate ${isActive ? 'text-violet-700 font-semibold' : 'text-gray-400'}`}>
                      {label}
                    </span>
                  </div>
                  {i < stepLabels.length - 1 && (
                    <div className={`w-4 h-px mx-1 shrink-0 ${isDone ? 'bg-violet-400' : 'bg-gray-200'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 컨텐츠 */}
        <div className="flex-1 overflow-y-auto p-6">
          
          {/* ===== Step 1: 개인화 필드 선택 ===== */}
          {currentStep === 1 && (
            <div>
              <div className="mb-5">
                <h4 className="text-base font-bold text-gray-800 mb-1">이번 발송에 활용할 고객 정보를 선택하세요</h4>
                <p className="text-sm text-gray-500">선택한 필드를 활용해 AI가 고객별 1:1 맞춤 문안을 생성합니다.</p>
              </div>

              {fieldsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
                  <span className="ml-2 text-sm text-gray-500">필드 로딩 중...</span>
                </div>
              ) : availableFields.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <User className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p>고객사에 설정된 필드가 없습니다.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(groupedFields).map(([category, fields]) => {
                    const IconComp = CATEGORY_ICONS[category] || Hash;
                    return (
                      <div key={category}>
                        <div className="flex items-center gap-1.5 mb-2">
                          <IconComp className="w-3.5 h-3.5 text-gray-400" />
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{category}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {(fields as any[]).map((field: any) => {
                            const isSelected = selectedFields.includes(field.field_key);
                            return (
                              <button
                                key={field.field_key}
                                onClick={() => toggleField(field.field_key)}
                                className={`px-3 py-2.5 rounded-lg border text-sm text-left transition-all ${
                                  isSelected
                                    ? 'border-violet-400 bg-violet-50 text-violet-700 ring-1 ring-violet-200'
                                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                    isSelected ? 'bg-violet-600 border-violet-600' : 'border-gray-300'
                                  }`}>
                                    {isSelected && <Check className="w-3 h-3 text-white" />}
                                  </div>
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
                  <div className="text-xs text-violet-600 font-medium mb-1">
                    선택된 필드 ({selectedFields.length}개)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedFields.map(key => {
                      const field = availableFields.find((f: any) => f.field_key === key);
                      return (
                        <span key={key} className="inline-flex items-center gap-1 px-2 py-1 bg-white rounded-md text-xs text-violet-700 border border-violet-200">
                          {field?.display_name || key}
                          <button onClick={() => toggleField(key)} className="text-violet-400 hover:text-violet-600">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== Step 2: 프로모션 브리핑 ===== */}
          {currentStep === 2 && (
            <div>
              <div className="mb-5">
                <h4 className="text-base font-bold text-gray-800 mb-1">프로모션을 브리핑해주세요</h4>
                <p className="text-sm text-gray-500">회의에서 팀원에게 설명하듯 자연스럽게 적으시면 됩니다.</p>
              </div>

              {/* 브리핑 입력 */}
              <div className="mb-5">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <FileText className="w-4 h-4 inline mr-1 text-violet-500" />
                  프로모션 브리핑
                </label>
                <textarea
                  value={briefing}
                  onChange={(e) => setBriefing(e.target.value)}
                  placeholder={`예시: 이번에 봄 신상품 출시 기념으로 3월 1일부터 15일까지 전 상품 20% 할인 행사를 진행합니다. VIP 고객에게는 추가 10% 쿠폰을 드리고, 5만원 이상 구매 시 무료배송 혜택도 있습니다. 쿠폰코드는 SPRING2026입니다.`}
                  className="w-full h-32 px-4 py-3 border border-gray-300 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent placeholder-gray-400 leading-relaxed"
                  autoFocus
                />
                <div className="flex justify-between mt-1.5">
                  <span className="text-xs text-gray-400">구체적일수록 AI가 더 정확하게 파싱합니다</span>
                  <span className={`text-xs ${briefing.length < 10 ? 'text-red-400' : 'text-gray-400'}`}>
                    {briefing.length}자 (최소 10자)
                  </span>
                </div>
              </div>

              {/* URL 입력 */}
              <div className="mb-5">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <Link2 className="w-4 h-4 inline mr-1 text-violet-500" />
                  바로가기 URL <span className="text-gray-400 font-normal">(선택)</span>
                </label>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/event"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-400 mt-1">입력하시면 문안에 "▶ 바로가기" 형태로 자동 배치됩니다</p>
              </div>

              {/* 톤/분위기 + 채널 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <Palette className="w-4 h-4 inline mr-1 text-violet-500" />
                    톤 / 분위기
                  </label>
                  <div className="space-y-1.5">
                    {TONE_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setTone(opt.value)}
                        className={`w-full px-3 py-2 rounded-lg border text-left text-sm transition-all ${
                          tone === opt.value
                            ? 'border-violet-400 bg-violet-50 text-violet-700'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        <span className="font-medium">{opt.label}</span>
                        <span className="text-xs text-gray-400 ml-1.5">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    📱 발송 채널
                  </label>
                  <div className="space-y-1.5">
                    <button
                      onClick={() => setChannel('SMS')}
                      className={`w-full px-3 py-2.5 rounded-lg border text-left text-sm transition-all ${
                        channel === 'SMS'
                          ? 'border-violet-400 bg-violet-50 text-violet-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <div className="font-medium">SMS</div>
                      <div className="text-xs text-gray-400">90바이트 (한글 약 45자)</div>
                    </button>
                    <button
                      onClick={() => setChannel('LMS')}
                      className={`w-full px-3 py-2.5 rounded-lg border text-left text-sm transition-all ${
                        channel === 'LMS'
                          ? 'border-violet-400 bg-violet-50 text-violet-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <div className="font-medium">LMS</div>
                      <div className="text-xs text-gray-400">2,000바이트 (한글 약 1,000자)</div>
                    </button>
                  </div>

                  {/* 선택 요약 */}
                  <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="text-xs font-medium text-gray-500 mb-2">선택 요약</div>
                    <div className="space-y-1 text-xs text-gray-600">
                      <div>• 개인화 필드: <b className="text-violet-600">{selectedFields.length}개</b></div>
                      <div>• 톤: <b>{TONE_OPTIONS.find(t => t.value === tone)?.label}</b></div>
                      <div>• 채널: <b>{channel}</b></div>
                      {url && <div>• URL: <b className="text-blue-500">{url.substring(0, 30)}...</b></div>}
                      <div>• 광고: <b>{isAd ? '예 (법정문구 자동삽입)' : '아니오'}</b></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ===== Step 3: 프로모션 카드 확인/수정 ===== */}
          {currentStep === 3 && promotionCard && (
            <div>
              <div className="mb-5">
                <h4 className="text-base font-bold text-gray-800 mb-1">AI가 파싱한 프로모션 정보를 확인하세요</h4>
                <p className="text-sm text-gray-500">내용이 정확한지 확인하고, 필요하면 직접 수정할 수 있습니다.</p>
              </div>

              <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl border border-violet-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-violet-600" />
                    <span className="text-sm font-bold text-violet-700">프로모션 카드</span>
                  </div>
                  <button
                    onClick={() => {
                      setEditingCard(!editingCard);
                      if (!editingCard) setEditedCard({ ...promotionCard });
                    }}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      editingCard 
                        ? 'bg-violet-600 text-white' 
                        : 'bg-white text-violet-600 border border-violet-300 hover:bg-violet-50'
                    }`}
                  >
                    {editingCard ? <><Check className="w-3 h-3" /> 수정완료</> : <><Pencil className="w-3 h-3" /> 수정하기</>}
                  </button>
                </div>

                {(() => {
                  const card = editingCard ? editedCard! : promotionCard;
                  const cardFields = [
                    { key: 'name', label: '프로모션명', icon: '🎯' },
                    { key: 'benefit', label: '혜택/할인', icon: '🎁' },
                    { key: 'condition', label: '조건', icon: '📋' },
                    { key: 'period', label: '기간', icon: '📅' },
                    { key: 'target', label: '대상', icon: '👥' },
                    { key: 'couponCode', label: '쿠폰코드', icon: '🏷️' },
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
                            <div className="flex-1">
                              <div className="text-xs font-medium text-gray-500 mb-0.5">{label}</div>
                              {editingCard ? (
                                <input
                                  type="text"
                                  value={(editedCard as any)?.[key] || ''}
                                  onChange={(e) => setEditedCard(prev => prev ? { ...prev, [key]: e.target.value } : null)}
                                  className="w-full px-3 py-1.5 border border-violet-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
                                  placeholder={`${label}을 입력하세요`}
                                />
                              ) : (
                                <div className="text-sm text-gray-800 font-medium">{value}</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* 원본 브리핑 참고 */}
              <details className="mt-4">
                <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">원본 브리핑 보기</summary>
                <div className="mt-2 p-3 bg-gray-50 rounded-lg text-xs text-gray-500 whitespace-pre-wrap">{briefing}</div>
              </details>
            </div>
          )}

          {/* ===== Step 4: 문안 생성 결과 ===== */}
          {currentStep === 4 && (
            <div>
              <div className="mb-5">
                <h4 className="text-base font-bold text-gray-800 mb-1">AI가 생성한 맞춤 문안을 선택하세요</h4>
                <p className="text-sm text-gray-500">
                  개인화 변수(<code className="bg-gray-100 px-1 rounded text-violet-600">&이름&</code> 등)는 발송 시 실제 값으로 치환됩니다.
                </p>
              </div>

              {variants.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
                  <span className="ml-2 text-sm text-gray-500">문안 생성 중...</span>
                </div>
              ) : (
                <div className="space-y-3">
                  {variants.map((v) => (
                    <button
                      key={v.variant_id}
                      onClick={() => setSelectedVariant(v.variant_id)}
                      className={`w-full p-4 rounded-xl border text-left transition-all ${
                        selectedVariant === v.variant_id
                          ? 'border-violet-400 bg-violet-50 ring-2 ring-violet-200'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            selectedVariant === v.variant_id ? 'bg-violet-600 text-white' : 'bg-gray-200 text-gray-600'
                          }`}>
                            {v.variant_name}
                          </span>
                          <span className="text-sm font-medium text-gray-700">{v.concept}</span>
                          {recommendation === v.variant_id && (
                            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">AI 추천</span>
                          )}
                        </div>
                        <span className="text-xs text-gray-400">
                          {new TextEncoder().encode(v.message_text).length}bytes
                        </span>
                      </div>
                      <div className="bg-white rounded-lg border border-gray-100 p-3 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed font-mono">
                        {v.message_text}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 하단 버튼 */}
        <div className="px-6 py-4 border-t bg-gray-50 flex justify-between items-center shrink-0">
          <button
            onClick={() => {
              if (currentStep === 1) onClose();
              else setCurrentStep(prev => prev - 1);
            }}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            {currentStep === 1 ? '닫기' : '이전'}
          </button>

          <div className="flex items-center gap-3">
            {currentStep === 2 && (
              <button
                onClick={handleParseBriefing}
                disabled={!canGoNext() || isParsing}
                className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isParsing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> AI 분석 중...</>
                ) : (
                  <><Sparkles className="w-4 h-4" /> AI 분석</>
                )}
              </button>
            )}
            {currentStep === 3 && (
              <button
                onClick={handleGenerateCustom}
                disabled={isGenerating}
                className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isGenerating ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> 문안 생성 중...</>
                ) : (
                  <><Sparkles className="w-4 h-4" /> 맞춤 문안 생성</>
                )}
              </button>
            )}
            {currentStep === 4 && (
              <button
                onClick={() => {
                  // TODO: AiCampaignSendModal로 연결 (다음 세션)
                  alert('발송 확정 기능은 다음 세션에서 연결합니다.');
                }}
                disabled={!selectedVariant}
                className="flex items-center gap-2 px-5 py-2.5 bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" /> 발송 확정
              </button>
            )}
            {currentStep === 1 && (
              <button
                onClick={() => setCurrentStep(2)}
                disabled={!canGoNext()}
                className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                다음 <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
