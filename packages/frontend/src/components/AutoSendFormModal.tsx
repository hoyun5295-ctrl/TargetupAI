/**
 * ★ D69/D86: 자동발송 생성/수정 모달 (6단계)
 *
 * 1. 기본 정보 (캠페인명, 설명)
 * 2. 활용 필드 선택 (AI 맞춤한줄 패턴 — 변수/개인화에 사용할 고객 필드)
 * 3. ★ D86: 발송 대상 설정 (AI 기반 자동 target_filter 생성 — parseBriefing 컨트롤타워 재활용)
 * 4. 스케줄 (매월/매주/매일 + 발송일/요일 + 시각)
 * 5. 메시지 (SMS/LMS/MMS 탭 + AI문안생성 + 스팸필터 + 본문 + 발신번호)
 * 6. 확인 (요약)
 *
 * ★ 자동발송은 프로 요금제 이상에서만 접근 가능 → AI/스팸필터 잠금 체크 불필요
 * ★ D83 교훈: 타겟 필터 없이({}) 발송 = 전체 고객 발송 사고 → 필터 필수 검증
 */

import { useEffect, useState, useMemo, useRef } from 'react';
import { aiApi } from '../api/client';
import { calculateSmsBytes, buildAdMessageFront, replaceMessageVars } from '../utils/formatDate';
import AiMessageSuggestModal from './AiMessageSuggestModal';
import SpamFilterTestModal from './SpamFilterTestModal';

interface AutoSendFormModalProps {
  campaign: any | null;  // null = 생성, 있으면 수정
  aiPremiumEnabled?: boolean; // ★ AI 프리미엄 게이팅 (프로 이상)
  onClose: () => void;
  onSuccess: () => void;
}

interface FieldItem {
  field_key: string;
  display_name: string;
  field_label: string;
  data_type: string;
  category: string;
  sort_order: number;
  is_custom: boolean;
}

const SCHEDULE_TYPES = [
  { value: 'monthly', label: '매월' },
  { value: 'weekly', label: '매주' },
  { value: 'daily', label: '매일' },
];

const WEEKDAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

const HOURS = Array.from({ length: 14 }, (_, i) => {
  const h = i + 8; // 08:00 ~ 21:00
  return { value: `${String(h).padStart(2, '0')}:00`, label: `${String(h).padStart(2, '0')}:00` };
});

// 카테고리 한글 라벨 (AiCustomSendFlow 패턴)
const DEFAULT_CATEGORY_LABELS: Record<string, string> = {
  basic: '기본 정보',
  purchase: '구매 정보',
  store: '매장 정보',
  membership: '멤버십',
  marketing: '마케팅',
  custom: '커스텀 필드',
};

function getToken(): string {
  return localStorage.getItem('token') || '';
}

// 이모지 감지 (B13-06 패턴)
const hasEmoji = (text: string): boolean => {
  const emojiPattern = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]|[\u2300-\u23FF]|[\u2B50-\u2BFF]|[\uFE00-\uFE0F]|[\u200D]|[\u20E3]|[\uE000-\uF8FF]/g;
  return emojiPattern.test(text);
};

const TOTAL_STEPS = 6;

const AI_TONES = [
  { value: 'friendly', label: '친근한' },
  { value: 'formal', label: '격식있는' },
  { value: 'cute', label: '귀여운' },
  { value: 'professional', label: '전문적인' },
];

export default function AutoSendFormModal({ campaign, aiPremiumEnabled, onClose, onSuccess }: AutoSendFormModalProps) {
  const isEdit = !!campaign;

  // 폼 상태
  const [campaignName, setCampaignName] = useState(campaign?.campaign_name || '');
  const [description, setDescription] = useState(campaign?.description || '');
  const [scheduleType, setScheduleType] = useState(campaign?.schedule_type || 'monthly');
  const [scheduleDay, setScheduleDay] = useState<number>(campaign?.schedule_day ?? 1);
  const [scheduleTime, setScheduleTime] = useState(
    campaign?.schedule_time ? (typeof campaign.schedule_time === 'string' ? campaign.schedule_time.slice(0, 5) : '10:00') : '10:00'
  );
  const [messageType, setMessageType] = useState<'SMS' | 'LMS' | 'MMS'>(campaign?.message_type || 'SMS');
  const [messageContent, setMessageContent] = useState(campaign?.message_content || '');
  const [messageSubject, setMessageSubject] = useState(campaign?.message_subject || '');
  const [callbackNumber, setCallbackNumber] = useState(campaign?.callback_number || '');
  const [useIndividualCallback, setUseIndividualCallback] = useState(campaign?.use_individual_callback ?? false);
  const [isAd, setIsAd] = useState(campaign?.is_ad ?? false);

  // ★ AI 문안 자동생성 모드 (기능 3)
  const [aiGenerateEnabled, setAiGenerateEnabled] = useState(campaign?.ai_generate_enabled ?? false);
  const [aiPrompt, setAiPrompt] = useState(campaign?.ai_prompt || '');
  const [aiTone, setAiTone] = useState(campaign?.ai_tone || 'friendly');
  const [fallbackMessageContent, setFallbackMessageContent] = useState(campaign?.fallback_message_content || '');

  // 발신번호 목록
  const [callbackNumbers, setCallbackNumbers] = useState<{ id: string; phone: string; label: string; is_default: boolean }[]>([]);

  // 080 수신거부 번호
  const [optOutNumber, setOptOutNumber] = useState('');

  // ★ Step 2: 활용 필드 선택 (AiCustomSendFlow 패턴)
  const [availableFields, setAvailableFields] = useState<FieldItem[]>([]);
  const [selectedFields, setSelectedFields] = useState<string[]>(
    campaign?.personal_fields || ['name']
  );
  const [fieldsLoading, setFieldsLoading] = useState(true);
  const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>(DEFAULT_CATEGORY_LABELS);

  // ★ D86: 타겟 설정 (Step 3) — AI 기반 자동 target_filter 생성
  const [targetFilter, setTargetFilter] = useState<Record<string, any>>(campaign?.target_filter || {});
  const [targetCount, setTargetCount] = useState(0);
  const [targetDescription, setTargetDescription] = useState(campaign?.description || '');
  const [targetParsing, setTargetParsing] = useState(false);
  const [targetConditionSummary, setTargetConditionSummary] = useState('');

  // ★ D86: D-1 사전 알림 (Step 4 하단)
  const [preNotify, setPreNotify] = useState(campaign?.pre_notify ?? true);
  const [notifyPhones, setNotifyPhones] = useState<string[]>(campaign?.notify_phones || []);
  const [notifyPhoneInput, setNotifyPhoneInput] = useState('');

  // AI 문구 추천
  const [showAiHelper, setShowAiHelper] = useState(false);
  const [aiHelperPrompt, setAiHelperPrompt] = useState('');
  const [aiHelperLoading, setAiHelperLoading] = useState(false);
  const [aiHelperResults, setAiHelperResults] = useState<any[]>([]);
  const [aiHelperRecommendation, setAiHelperRecommendation] = useState('');

  // 스팸필터 테스트
  const [showSpamFilter, setShowSpamFilter] = useState(false);

  // ★ D105: 스팸테스트 개인화용 샘플 고객 (P8 — recommend-target에서 받은 타겟 매칭 고객)
  const [spamSampleCustomer, setSpamSampleCustomer] = useState<Record<string, any> | undefined>(undefined);

  // MMS 이미지
  const [mmsUploadedImages, setMmsUploadedImages] = useState<{ url: string; file?: File }[]>(
    campaign?.mms_image_url ? [{ url: campaign.mms_image_url }] : []
  );

  // 토스트
  const [toast, setToast] = useState({ show: false, type: '' as 'success' | 'error' | 'warning' | '', message: '' });

  // UI
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 카테고리별 필드 그룹핑 (AiCustomSendFlow 패턴)
  const groupedFields = useMemo(() => {
    const groups: Record<string, FieldItem[]> = {};
    for (const f of availableFields) {
      if (f.field_key === 'phone' || f.field_key === 'sms_opt_in') continue;
      const cat = f.category || 'basic';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(f);
    }
    return groups;
  }, [availableFields]);

  // 선택된 필드 기반 변수 목록 (메시지 작성에서 사용)
  const variableFields = useMemo(() => {
    return selectedFields
      .map(key => availableFields.find(f => f.field_key === key))
      .filter((f): f is FieldItem => !!f)
      .map(f => ({
        field_key: f.field_key,
        display_name: f.display_name,
        variable: `%${f.display_name}%`,
      }));
  }, [selectedFields, availableFields]);

  // 토스트 자동 숨김
  useEffect(() => {
    if (!toast.show) return;
    const timer = setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
    return () => clearTimeout(timer);
  }, [toast.show, toast.message]);

  // 초기 데이터 로드
  useEffect(() => {
    (async () => {
      try {
        // 발신번호 로드 — Dashboard.tsx 패턴과 동일하게 data.numbers 사용
        const res = await fetch('/api/companies/callback-numbers', {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (res.ok) {
          const data = await res.json();
          const numbers = data.numbers || [];
          setCallbackNumbers(numbers);
          if (!callbackNumber && numbers.length > 0) {
            const defaultCb = numbers.find((n: any) => n.is_default);
            setCallbackNumber(defaultCb?.phone || numbers[0]?.phone || '');
          }
        }

        // 회사 설정 (080 수신거부 번호)
        const settingsRes = await fetch('/api/companies/settings', {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (settingsRes.ok) {
          const settingsData = await settingsRes.json();
          if (settingsData.reject_number) {
            setOptOutNumber(settingsData.reject_number);
          }
        }

        // ★ 활용 가능 필드 로드 (AiCustomSendFlow와 동일한 enabled-fields API)
        setFieldsLoading(true);
        const fieldsRes = await fetch('/api/customers/enabled-fields', {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (fieldsRes.ok) {
          const fieldsData = await fieldsRes.json();
          setAvailableFields(fieldsData.fields || []);
          if (fieldsData.categories) setCategoryLabels({ ...DEFAULT_CATEGORY_LABELS, ...fieldsData.categories });
        }
      } catch {}
      finally { setFieldsLoading(false); }
    })();
  }, []);

  // 필드 토글
  const toggleField = (fieldKey: string) => {
    setSelectedFields(prev =>
      prev.includes(fieldKey) ? prev.filter(k => k !== fieldKey) : [...prev, fieldKey]
    );
  };

  // ★ D95: 바이트 계산 — formatDate.ts 컨트롤타워 사용
  const getByteLength = calculateSmsBytes;

  const msgBytes = getByteLength(messageContent);
  const maxBytes = messageType === 'SMS' ? 90 : 2000;

  // SMS 자동 전환 경고
  useEffect(() => {
    if (messageType === 'SMS' && msgBytes > 90) {
      setMessageType('LMS');
      setToast({ show: true, type: 'warning', message: '90바이트 초과로 LMS로 자동 전환되었습니다.' });
    }
  }, [msgBytes]);

  // 080 무료거부 포맷
  const formatRejectNumber = (num: string) => {
    if (!num) return '';
    const clean = num.replace(/[^0-9]/g, '');
    if (clean.length === 11) return `${clean.slice(0, 3)}-${clean.slice(3, 7)}-${clean.slice(7)}`;
    if (clean.length === 10) return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
    return num;
  };

  // 광고 접미사 텍스트 — ★ PPT#3: 080번호 없어도 무료거부까지 표시
  const getAdSuffix = () => {
    if (!isAd) return '';
    return messageType === 'SMS'
      ? `무료거부${optOutNumber ? optOutNumber.replace(/-/g, '') : ''}`
      : `무료수신거부${optOutNumber ? ` ${formatRejectNumber(optOutNumber)}` : ''}`;
  };

  // ★ D86: AI 기반 타겟 자동 추출 — recommend-target 컨트롤타워 재활용 (한줄로와 동일 로직)
  const parseTargetCondition = async () => {
    if (!targetDescription.trim()) {
      setToast({ show: true, type: 'error', message: '발송 대상을 입력해주세요.' });
      return;
    }
    setTargetParsing(true);
    try {
      const res = await fetch('/api/ai/recommend-target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        // ★ auto_relax: false — 자동발송은 사용자 지정 조건 그대로 적용. 멋대로 완화 금지.
        body: JSON.stringify({ objective: targetDescription.trim(), auto_relax: false }),
      });
      if (res.ok) {
        const data = await res.json();
        const filters = data.filters || {};
        setTargetFilter(filters);
        setTargetConditionSummary(data.reasoning || '');
        setTargetCount(data.estimated_count || 0);
        // ★ D105 P8: 타겟 매칭 샘플 고객 저장 (스팸테스트 개인화용 — column 키 raw)
        if (data.sample_customer_raw && Object.keys(data.sample_customer_raw).length > 0) {
          const raw = data.sample_customer_raw;
          // custom_fields JSONB flat 처리 (백엔드 replaceVariables가 접근 가능하도록)
          setSpamSampleCustomer({ ...raw, ...(raw.custom_fields || {}) });
        }
        if (Object.keys(filters).length === 0) {
          setToast({ show: true, type: 'warning', message: 'AI가 타겟 조건을 인식하지 못했습니다. 좀 더 구체적으로 입력해주세요.' });
        } else {
          setToast({ show: true, type: 'success', message: `타겟 조건이 설정되었습니다. 현재 기준 약 ${(data.estimated_count || 0).toLocaleString()}명` });
        }
      } else {
        const err = await res.json();
        setToast({ show: true, type: 'error', message: err.error || '타겟 분석에 실패했습니다.' });
      }
    } catch {
      setToast({ show: true, type: 'error', message: '서버 연결에 실패했습니다.' });
    } finally {
      setTargetParsing(false);
    }
  };

  // AI 문구 생성 — selectedFields 기반 개인화 연동
  const generateAiMessage = async () => {
    if (!aiHelperPrompt.trim()) {
      setToast({ show: true, type: 'error', message: '어떤 메시지를 보낼지 입력해주세요.' });
      return;
    }
    setAiHelperLoading(true);
    setAiHelperResults([]);
    try {
      // ★ D120 P8: 영문 field_key → 한글 displayName 변환 (AI가 %고객명% 생성하도록)
      const personalFieldLabels = selectedFields.map(key => {
        const f = availableFields.find(af => af.field_key === key);
        return f?.field_label || f?.display_name || key;
      });
      const res = await aiApi.generateMessage({
        prompt: aiHelperPrompt,
        channel: messageType,
        isAd: isAd,
        usePersonalization: selectedFields.length > 0,
        personalFields: personalFieldLabels,
      });
      setAiHelperResults(res.data.variants || []);
      setAiHelperRecommendation(res.data.recommendation || '');
    } catch (err) {
      console.error('AI 문구 생성 오류:', err);
      setToast({ show: true, type: 'error', message: 'AI 문구 생성에 실패했습니다.' });
    } finally {
      setAiHelperLoading(false);
    }
  };

  // AI 문구 선택
  const selectAiMessage = (variant: any) => {
    const msg = variant.message_text || (messageType === 'SMS' ? variant.sms_text : variant.lms_text) || '';
    setMessageContent(msg);
    setShowAiHelper(false);
    setToast({ show: true, type: 'success', message: 'AI 추천 문구가 적용되었습니다.' });
  };

  // ★ D120: 변수 삽입 — 커서 위치에 삽입 (문안 끝이 아닌 커서 깜빡이는 곳)
  const msgTextareaRef = useRef<HTMLTextAreaElement>(null);
  const msgCursorPosRef = useRef<number>(0);
  const insertVariable = (varName: string) => {
    const pos = msgCursorPosRef.current;
    setMessageContent((prev: string) => {
      const before = prev.slice(0, pos);
      const after = prev.slice(pos);
      return before + varName + after;
    });
    const newPos = pos + varName.length;
    msgCursorPosRef.current = newPos;
    setTimeout(() => {
      if (msgTextareaRef.current) {
        msgTextareaRef.current.focus();
        msgTextareaRef.current.selectionStart = newPos;
        msgTextareaRef.current.selectionEnd = newPos;
      }
    }, 0);
  };

  // MMS 이미지 업로드
  const handleMmsImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setToast({ show: true, type: 'error', message: '이미지 파일만 업로드 가능합니다.' });
      return;
    }
    if (file.size > 300 * 1024) {
      setToast({ show: true, type: 'error', message: 'MMS 이미지는 300KB 이하만 가능합니다.' });
      return;
    }
    const url = URL.createObjectURL(file);
    setMmsUploadedImages([{ url, file }]);
  };

  // 저장
  const handleSave = async () => {
    setError('');

    if (!campaignName.trim()) { setError('자동발송 이름을 입력해주세요.'); setStep(1); return; }
    if (selectedFields.length === 0) { setError('활용할 고객 필드를 1개 이상 선택해주세요.'); setStep(2); return; }
    // ★ D86: 타겟 필터 필수 — D83 교훈 (빈 필터 = 전체 고객 발송 사고 방지)
    if (!targetFilter || Object.keys(targetFilter).length === 0) { setError('발송 대상 필터를 설정해주세요. 필터 없이는 전체 고객에게 발송됩니다.'); setStep(3); return; }
    // ★ AI 모드: prompt + fallback 필수 / 일반 모드: messageContent 필수
    if (aiGenerateEnabled) {
      if (!aiPrompt.trim()) { setError('AI 마케팅 컨셉을 입력해주세요.'); setStep(5); return; }
      if (!fallbackMessageContent.trim()) { setError('AI 생성 실패 시 사용할 폴백 메시지를 입력해주세요.'); setStep(5); return; }
    } else {
      if (!messageContent.trim()) { setError('메시지 내용을 입력해주세요.'); setStep(5); return; }
    }
    // ★ PPT#7: 수신자별 회신번호 사용 시 callbackNumber 미필수
    if (!useIndividualCallback && !callbackNumber) { setError('발신번호를 선택해주세요.'); setStep(5); return; }
    if (messageType === 'MMS' && mmsUploadedImages.length === 0 && !aiGenerateEnabled) { setError('MMS 이미지를 첨부해주세요.'); setStep(5); return; }
    if ((messageType === 'LMS' || messageType === 'MMS') && !messageSubject.trim() && !aiGenerateEnabled) { setError('LMS/MMS는 제목을 입력해주세요.'); setStep(5); return; }

    setSaving(true);
    try {
      const body: any = {
        campaign_name: campaignName.trim(),
        description: description.trim() || null,
        schedule_type: scheduleType,
        schedule_day: scheduleType === 'daily' ? null : scheduleDay,
        schedule_time: scheduleTime,
        // ★ D86: 사용자가 설정한 타겟 필터 — 빈 객체면 백엔드에서 거부됨
        target_filter: targetFilter,
        message_type: messageType,
        message_content: aiGenerateEnabled ? (fallbackMessageContent.trim() || null) : messageContent.trim(),
        message_subject: messageType !== 'SMS' ? messageSubject.trim() || null : null,
        callback_number: useIndividualCallback ? null : callbackNumber,
        use_individual_callback: useIndividualCallback,
        is_ad: isAd,
        personal_fields: selectedFields,
        // ★ AI 문안 자동생성 필드
        ai_generate_enabled: aiGenerateEnabled,
        ai_prompt: aiGenerateEnabled ? aiPrompt.trim() : null,
        ai_tone: aiGenerateEnabled ? aiTone : null,
        fallback_message_content: aiGenerateEnabled ? fallbackMessageContent.trim() : null,
        // ★ D86: D-1 사전 알림
        pre_notify: preNotify,
        notify_phones: preNotify && notifyPhones.length > 0 ? notifyPhones : null,
      };

      const url = isEdit ? `/api/auto-campaigns/${campaign.id}` : '/api/auto-campaigns';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || '저장에 실패했습니다.');
        return;
      }

      onSuccess();
    } catch (err: any) {
      setError(err.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  // 단계 유효성 검사
  const canProceed = () => {
    if (step === 1 && !campaignName.trim()) {
      setError('자동발송 이름을 입력해주세요.');
      return false;
    }
    if (step === 2 && selectedFields.length === 0) {
      setError('활용할 고객 필드를 1개 이상 선택해주세요.');
      return false;
    }
    // ★ D86: 타겟 필터 필수 — D83 교훈 (빈 필터 = 전체 고객 발송 사고)
    if (step === 3 && (!targetFilter || Object.keys(targetFilter).length === 0)) {
      setError('발송 대상 필터를 설정해주세요. 필터 없이는 전체 고객에게 발송됩니다.');
      return false;
    }
    return true;
  };

  // ★ D86: 타겟 필터 요약 텍스트
  const getFilterSummary = () => {
    if (!targetFilter || Object.keys(targetFilter).length === 0) return '미설정';
    const parts: string[] = [];
    for (const [key, val] of Object.entries(targetFilter)) {
      const field = availableFields.find(f => f.field_key === key);
      const label = field?.display_name || field?.field_label || key;
      if (val && typeof val === 'object' && val.operator) {
        const opLabels: Record<string, string> = { eq: '=', in: '포함', gte: '이상', lte: '이하', between: '범위', contains: '포함', days_within: '최근', birth_month: '월' };
        const op = opLabels[val.operator] || val.operator;
        const v = Array.isArray(val.value) ? val.value.join('~') : val.value;
        parts.push(`${label} ${op} ${v}`);
      } else if (Array.isArray(val)) {
        parts.push(`${label}: ${val.join('~')}`);
      } else {
        parts.push(`${label}: ${val}`);
      }
    }
    return parts.join(', ');
  };

  return (
    <>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* 토스트 */}
      {toast.show && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[70] px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg transition-all ${
          toast.type === 'success' ? 'bg-green-500 text-white' :
          toast.type === 'error' ? 'bg-red-500 text-white' :
          toast.type === 'warning' ? 'bg-amber-500 text-white' : 'bg-gray-700 text-white'
        }`}>
          {toast.message}
        </div>
      )}

      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fadeIn_0.2s_ease-out]"
      >
        <div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto animate-[slideUp_0.3s_ease-out]"
          style={{ overscrollBehavior: 'contain' }}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
        >
          {/* 헤더 */}
          <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
            <div>
              <h2 className="text-lg font-bold text-gray-800">
                {isEdit ? '자동발송 수정' : '새 자동발송'}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">단계 {step}/{TOTAL_STEPS}</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition p-1 rounded-lg hover:bg-gray-100">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-6 py-5">
            {/* 에러 */}
            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2.5 rounded-lg">
                {error}
              </div>
            )}

            {/* ========== Step 1: 기본 정보 ========== */}
            {step === 1 && (
              <div className="space-y-4" style={{ animation: 'slideUp 0.3s ease-out' }}>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">자동발송 이름 *</label>
                  <input
                    type="text"
                    value={campaignName}
                    onChange={e => setCampaignName(e.target.value)}
                    placeholder="예: 3월 생일 축하 발송"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    maxLength={200}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">설명 (선택)</label>
                  <input
                    type="text"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="예: 이번 달 생일인 고객에게 축하 SMS 발송"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
              </div>
            )}

            {/* ========== Step 2: 활용 필드 선택 (AiCustomSendFlow 패턴) ========== */}
            {step === 2 && (
              <div style={{ animation: 'slideUp 0.3s ease-out' }}>
                <div className="mb-5">
                  <h4 className="text-base font-bold text-gray-800 mb-1">활용할 고객 정보를 선택하세요</h4>
                  <p className="text-sm text-gray-500">선택한 필드를 AI 문안생성과 변수 치환에 활용합니다.</p>
                </div>

                {fieldsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <svg className="w-6 h-6 text-violet-500 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="ml-2 text-sm text-gray-500">필드 로딩 중...</span>
                  </div>
                ) : Object.keys(groupedFields).length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <p>고객 데이터에 사용 가능한 필드가 없습니다.</p>
                    <p className="text-xs mt-1">고객 데이터를 먼저 업로드해주세요.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(groupedFields).map(([category, fields]) => (
                      <div key={category}>
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-xs font-semibold text-gray-500 tracking-wide">{categoryLabels[category] || category}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {fields.map((field) => {
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
                                    {isSelected && (
                                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                      </svg>
                                    )}
                                  </div>
                                  <span className="truncate">{field.display_name}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 선택된 필드 요약 */}
                {selectedFields.length > 0 && (
                  <div className="mt-4 p-3 bg-violet-50 rounded-lg border border-violet-100">
                    <div className="text-xs text-violet-600 font-medium mb-1">선택된 필드 ({selectedFields.length}개)</div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedFields.map(key => {
                        const field = availableFields.find(f => f.field_key === key);
                        return (
                          <span key={key} className="inline-flex items-center gap-1 px-2 py-1 bg-white rounded-md text-xs text-violet-700 border border-violet-200">
                            {field?.display_name || key}
                            <button onClick={() => toggleField(key)} className="text-violet-400 hover:text-violet-600">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ========== Step 3: 발송 대상 설정 (D86 — AI 기반 자동 타겟 생성) ========== */}
            {step === 3 && (
              <div className="space-y-4" style={{ animation: 'slideUp 0.3s ease-out' }}>
                <div>
                  <label className="block text-sm font-bold text-gray-800 mb-1">발송 대상을 설명해주세요 *</label>
                  <p className="text-xs text-gray-500 mb-3">AI가 조건을 분석하여 매 발송 시점에 해당 조건의 고객을 자동 조회합니다.</p>
                </div>

                {/* 대상 설명 입력 */}
                <textarea
                  value={targetDescription}
                  onChange={e => setTargetDescription(e.target.value)}
                  placeholder={"예시:\n• 이번 달 생일인 고객\n• VIP 등급 여성 고객\n• 최근 3개월 미구매 고객\n• 피부타입이 건성인 고객\n• 30대 남성 중 구매금액 10만원 이상"}
                  className="w-full h-28 px-4 py-3 border border-gray-300 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400 leading-relaxed"
                />

                {/* AI 분석 버튼 */}
                <button
                  onClick={parseTargetCondition}
                  disabled={targetParsing || !targetDescription.trim()}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-2"
                >
                  {targetParsing ? (
                    <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> AI 타겟 분석 중...</>
                  ) : (
                    <>🎯 AI 타겟 분석</>
                  )}
                </button>

                {/* 분석 결과 */}
                {targetFilter && Object.keys(targetFilter).length > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-blue-700">✅ 타겟 조건 설정 완료</span>
                      <span className="text-lg font-bold text-blue-700">
                        약 {targetCount.toLocaleString()}명
                      </span>
                    </div>

                    {targetConditionSummary && (
                      <p className="text-sm text-gray-700">{targetConditionSummary}</p>
                    )}

                    <p className="text-xs text-gray-500">
                      📌 위 인원수는 현재 시점 기준이며, 실제 발송 시 해당 조건에 맞는 고객이 자동으로 조회됩니다.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ========== Step 4: 스케줄 (기존 Step 3) ========== */}
            {step === 4 && (
              <div className="space-y-4" style={{ animation: 'slideUp 0.3s ease-out' }}>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">반복 주기 *</label>
                  <div className="flex gap-2">
                    {SCHEDULE_TYPES.map(st => (
                      <button
                        key={st.value}
                        onClick={() => {
                          setScheduleType(st.value);
                          if (st.value === 'weekly') setScheduleDay(1);
                          if (st.value === 'monthly') setScheduleDay(1);
                        }}
                        className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition ${
                          scheduleType === st.value
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>

                {scheduleType === 'monthly' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">발송일 *</label>
                    <select
                      value={scheduleDay}
                      onChange={e => setScheduleDay(Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                        <option key={d} value={d}>{d}일</option>
                      ))}
                    </select>
                    <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
                      <span>📌</span> 2월은 28일까지이므로 발송일은 최대 28일까지 선택 가능합니다
                    </p>
                  </div>
                )}

                {scheduleType === 'weekly' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">요일 *</label>
                    <div className="flex gap-1.5">
                      {WEEKDAYS.map((day, idx) => (
                        <button
                          key={idx}
                          onClick={() => setScheduleDay(idx)}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition ${
                            scheduleDay === idx
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {day.slice(0, 1)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">발송 시각 *</label>
                  <select
                    value={scheduleTime}
                    onChange={e => setScheduleTime(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    {HOURS.map(h => (
                      <option key={h.value} value={h.value}>{h.label}</option>
                    ))}
                  </select>
                </div>

                {/* ★ D86: D-1 사전 알림 설정 */}
                <div className="border-t border-gray-200 pt-4 mt-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <label className="text-sm font-medium text-gray-700">D-1 사전 알림</label>
                      <p className="text-xs text-gray-500 mt-0.5">발송 전날 담당자에게 알림 메시지를 보냅니다</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPreNotify(!preNotify)}
                      className={`relative w-11 h-6 rounded-full transition-colors ${preNotify ? 'bg-blue-600' : 'bg-gray-300'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${preNotify ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>

                  {preNotify && (
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-gray-600">알림 받을 전화번호</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={notifyPhoneInput}
                          onChange={e => setNotifyPhoneInput(e.target.value.replace(/[^0-9-]/g, ''))}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const clean = notifyPhoneInput.replace(/-/g, '');
                              if (clean.length >= 10 && !notifyPhones.includes(clean)) {
                                setNotifyPhones(prev => [...prev, clean]);
                                setNotifyPhoneInput('');
                              }
                            }
                          }}
                          placeholder="01012345678"
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const clean = notifyPhoneInput.replace(/-/g, '');
                            if (clean.length >= 10 && !notifyPhones.includes(clean)) {
                              setNotifyPhones(prev => [...prev, clean]);
                              setNotifyPhoneInput('');
                            }
                          }}
                          className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition shrink-0"
                        >
                          추가
                        </button>
                      </div>
                      {notifyPhones.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {notifyPhones.map((phone, idx) => (
                            <span key={idx} className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 border border-blue-200 rounded-full text-xs text-blue-700">
                              {phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3')}
                              <button onClick={() => setNotifyPhones(prev => prev.filter((_, i) => i !== idx))} className="text-blue-400 hover:text-blue-600">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      {preNotify && notifyPhones.length === 0 && (
                        <p className="text-xs text-amber-600">📌 전화번호를 추가하지 않으면 사전 알림이 발송되지 않습니다.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ========== Step 5: 메시지 (기존 Step 4) ========== */}
            {step === 5 && (
              <div className="space-y-4" style={{ animation: 'slideUp 0.3s ease-out' }}>
                {/* 광고 여부 */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isAd"
                    checked={isAd}
                    onChange={e => setIsAd(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <label htmlFor="isAd" className="text-sm text-gray-700">광고 메시지 (080 수신거부 포함)</label>
                </div>

                {/* SMS/LMS/MMS 탭 토글 */}
                <div className="flex bg-gray-50 rounded-lg p-0.5">
                  <button
                    onClick={() => { setMessageType('SMS'); setMmsUploadedImages([]); }}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${messageType === 'SMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    SMS
                  </button>
                  <button
                    onClick={() => { setMessageType('LMS'); setMmsUploadedImages([]); }}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${messageType === 'LMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    LMS
                  </button>
                  <button
                    onClick={() => { setMessageType('MMS'); }}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${messageType === 'MMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    MMS
                  </button>
                </div>

                {/* ★ AI 문안 자동생성 토글 (프로 이상만 표시) */}
                {aiPremiumEnabled && (
                  <div
                    className={`p-3 rounded-xl border-2 transition-all cursor-pointer ${aiGenerateEnabled ? 'border-violet-300 bg-violet-50/50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}
                    onClick={() => setAiGenerateEnabled(!aiGenerateEnabled)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-bold text-gray-700 whitespace-nowrap">AI 문안 자동생성</span>
                        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-violet-100 text-violet-600 rounded shrink-0">PRO</span>
                      </div>
                      <div
                        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${aiGenerateEnabled ? 'bg-violet-500' : 'bg-gray-300'}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${aiGenerateEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                      </div>
                    </div>
                    {aiGenerateEnabled && (
                      <p className="text-xs text-violet-600 mt-1.5">발송 D-2에 AI가 문안을 자동 생성하고 스팸테스트까지 진행합니다.</p>
                    )}
                  </div>
                )}

                {/* ★ AI 모드 ON: 프롬프트 + 톤 + 폴백 메시지 입력 */}
                {aiGenerateEnabled && (
                  <div className="space-y-3 p-4 border-2 border-violet-200 rounded-2xl bg-gradient-to-b from-violet-50/80 to-white">
                    <div>
                      <label className="block text-sm font-medium text-violet-700 mb-1">마케팅 컨셉 / AI 지시사항 *</label>
                      <textarea
                        value={aiPrompt}
                        onChange={e => setAiPrompt(e.target.value)}
                        placeholder="예: 봄 시즌 세일 안내. 20% 할인 쿠폰 강조. 고객 이름 넣어서 친근하게."
                        className="w-full border border-violet-300 rounded-lg px-3 py-2.5 text-sm resize-none h-[80px] focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-violet-700 mb-1">폴백 메시지 (AI 실패 시 사용) *</label>
                      <textarea
                        value={fallbackMessageContent}
                        onChange={e => setFallbackMessageContent(e.target.value)}
                        placeholder="AI 생성이 실패할 경우 이 메시지가 대신 발송됩니다."
                        className="w-full border border-violet-300 rounded-lg px-3 py-2.5 text-sm resize-none h-[60px] focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none bg-white"
                      />
                      <p className="text-xs text-gray-400 mt-1">%이름% 등 변수 사용 가능</p>
                    </div>
                  </div>
                )}

                {/* 메시지 작성 영역 (AI 모드 OFF일 때만 표시) */}
                {!aiGenerateEnabled && (
                <div className="border-2 border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                  {/* LMS/MMS 제목 */}
                  {(messageType === 'LMS' || messageType === 'MMS') && (
                    <div className="px-4 pt-3">
                      <input
                        type="text"
                        value={messageSubject}
                        onChange={e => setMessageSubject(e.target.value)}
                        placeholder="제목 (필수)"
                        className="w-full px-3 py-2 border border-orange-300 bg-orange-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 placeholder-orange-400"
                        maxLength={200}
                      />
                    </div>
                  )}

                  {/* 메시지 본문 */}
                  <div className="p-4">
                    <div className="relative">
                      {isAd && (
                        <span className="absolute left-0 top-0 text-sm text-orange-600 font-medium pointer-events-none select-none">(광고) </span>
                      )}
                      <textarea
                        ref={msgTextareaRef}
                        value={messageContent}
                        onChange={e => {
                          const text = e.target.value;
                          setMessageContent(text);
                          msgCursorPosRef.current = e.target.selectionStart;
                        }}
                        onSelect={e => { msgCursorPosRef.current = (e.target as HTMLTextAreaElement).selectionStart; }}
                        placeholder="전송하실 내용을 입력하세요."
                        style={isAd ? { textIndent: '42px' } : {}}
                        className={`w-full resize-none border-0 focus:outline-none text-sm leading-relaxed ${messageType === 'SMS' ? 'h-[180px]' : 'h-[140px]'}`}
                      />
                    </div>
                    {/* 무료거부 표기 */}
                    {isAd && optOutNumber && (
                      <div className="text-sm text-orange-600 mt-1">
                        {getAdSuffix()}
                      </div>
                    )}

                    {/* MMS 이미지 */}
                    {messageType === 'MMS' && (
                      <div className="mt-2 pt-2 border-t">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-600">🖼️ MMS 이미지</span>
                          {mmsUploadedImages.length > 0 ? (
                            <div className="flex items-center gap-1">
                              {mmsUploadedImages.map((img, idx) => (
                                <img key={idx} src={img.url} alt="" className="w-10 h-10 object-cover rounded border" />
                              ))}
                              <button
                                onClick={() => setMmsUploadedImages([])}
                                className="text-xs text-red-500 ml-1 hover:underline"
                              >
                                삭제
                              </button>
                            </div>
                          ) : (
                            <label className="text-xs text-amber-600 cursor-pointer hover:underline">
                              클릭하여 이미지 첨부 →
                              <input type="file" accept="image/*" className="hidden" onChange={handleMmsImageUpload} />
                            </label>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-1">JPG/PNG 300KB 이하</p>
                      </div>
                    )}
                  </div>

                  {/* 바이트 표시 */}
                  <div className="px-3 py-1.5 bg-gray-50 border-t flex items-center justify-end">
                    <span className="text-xs text-gray-500">
                      <span className={`font-bold ${msgBytes > maxBytes ? 'text-red-500' : 'text-emerald-600'}`}>{msgBytes}</span>/{maxBytes}byte ({messageType})
                    </span>
                  </div>

                  {/* 발신번호 */}
                  <div className="px-3 py-2.5 border-t">
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">발신번호 (수신자에게 표시되는 번호)</label>
                    {callbackNumbers.length > 0 ? (
                      <select
                        value={useIndividualCallback ? '__individual__' : callbackNumber}
                        onChange={e => {
                          if (e.target.value === '__individual__') {
                            setUseIndividualCallback(true);
                            setCallbackNumber('');
                          } else {
                            setUseIndividualCallback(false);
                            setCallbackNumber(e.target.value);
                          }
                        }}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="">발신번호 선택</option>
                        {callbackNumbers.map(cb => (
                          <option key={cb.id} value={cb.phone}>
                            {cb.phone}{cb.label ? ` (${cb.label})` : ''}{cb.is_default ? ' ⭐ 기본' : ''}
                          </option>
                        ))}
                        <option value="__individual__">수신자별 회신번호 칼럼 사용</option>
                      </select>
                    ) : (
                      <p className="text-sm text-red-500 py-2">등록된 발신번호가 없습니다. 설정에서 발신번호를 등록해주세요.</p>
                    )}
                    {useIndividualCallback && (
                      <p className="text-xs text-emerald-600 mt-1.5">각 수신자의 회신번호 칼럼 값으로 발송됩니다</p>
                    )}
                  </div>

                  {/* ★ 자동입력 드롭다운 — 2단계에서 선택한 필드만 표시 */}
                  <div className="px-3 py-1.5 border-t bg-gray-50">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-gray-700 whitespace-nowrap">자동입력</span>
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            insertVariable(e.target.value);
                          }
                        }}
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="">변수 선택</option>
                        {variableFields.map(fm => (
                          <option key={fm.field_key} value={fm.variable}>{fm.display_name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* AI 추천 + 스팸필터 버튼 */}
                  <div className="px-3 py-1.5 border-t">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          setShowAiHelper(true);
                          setAiHelperPrompt('');
                          setAiHelperResults([]);
                          setAiHelperRecommendation('');
                        }}
                        className="py-2.5 bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        ✨ AI 문구추천
                      </button>
                      <button
                        onClick={async () => {
                          if (!messageContent.trim()) {
                            setToast({ show: true, type: 'error', message: '메시지를 먼저 입력해주세요.' });
                            return;
                          }
                          if (!callbackNumber) {
                            setToast({ show: true, type: 'error', message: '발신번호를 먼저 선택해주세요.' });
                            return;
                          }
                          // ★ B5: 스팸필터 모달 열기 직전 타겟 첫 고객 강제 채움
                          //   recommend-target 미호출 케이스에도 미리보기 개인화가 보이도록 보장
                          if (!spamSampleCustomer && Object.keys(targetFilter || {}).length > 0) {
                            try {
                              const res = await fetch('/api/auto-campaigns/preview-sample', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                                body: JSON.stringify({
                                  target_filter: targetFilter,
                                  store_code: campaign?.store_code || null,
                                }),
                              });
                              if (res.ok) {
                                const data = await res.json();
                                if (data.matched && data.customer) {
                                  setSpamSampleCustomer(data.customer);
                                }
                              }
                            } catch {
                              // 실패해도 스팸필터 모달은 열림 (미치환 상태로 폴백)
                            }
                          }
                          setShowSpamFilter(true);
                        }}
                        className="py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                      >
                        🛡️ 스팸필터테스트
                      </button>
                    </div>
                  </div>
                </div>
                )}
                {/* ★ AI 모드 ON: 발신번호 설정 */}
                {aiGenerateEnabled && (
                  <div className="border-2 border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                    <div className="px-3 py-2.5">
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">발신번호 (수신자에게 표시되는 번호)</label>
                      {callbackNumbers.length > 0 ? (
                        <select
                          value={useIndividualCallback ? '__individual__' : callbackNumber}
                          onChange={e => {
                            if (e.target.value === '__individual__') {
                              setUseIndividualCallback(true);
                              setCallbackNumber('');
                            } else {
                              setUseIndividualCallback(false);
                              setCallbackNumber(e.target.value);
                            }
                          }}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                          <option value="">발신번호 선택</option>
                          {callbackNumbers.map(cb => (
                            <option key={cb.id} value={cb.phone}>
                              {cb.phone}{cb.label ? ` (${cb.label})` : ''}{cb.is_default ? ' ⭐ 기본' : ''}
                            </option>
                          ))}
                          <option value="__individual__">수신자별 회신번호 칼럼 사용</option>
                        </select>
                      ) : (
                        <p className="text-sm text-red-500 py-2">등록된 발신번호가 없습니다. 설정에서 발신번호를 등록해주세요.</p>
                      )}
                      {useIndividualCallback && (
                        <p className="text-xs text-emerald-600 mt-1.5">각 수신자의 회신번호 칼럼 값으로 발송됩니다</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ========== Step 6: 확인 (기존 Step 5) ========== */}
            {step === 6 && (
              <div className="space-y-3" style={{ animation: 'slideUp 0.3s ease-out' }}>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">자동발송 설정 확인</h3>
                <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">이름</span>
                    <span className="text-gray-800 font-medium">{campaignName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">활용 필드</span>
                    <span className="text-violet-700 font-medium">{selectedFields.length}개</span>
                  </div>
                  {/* ★ D86: 타겟 요약 */}
                  <div className="flex justify-between">
                    <span className="text-gray-500">발송 대상</span>
                    <span className="text-blue-700 font-medium">
                      {targetConditionSummary || (targetCount > 0 ? `현재 기준 약 ${targetCount.toLocaleString()}명` : getFilterSummary())}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">스케줄</span>
                    <span className="text-gray-800 font-medium">
                      {scheduleType === 'daily' && `매일 ${scheduleTime}`}
                      {scheduleType === 'weekly' && `매주 ${WEEKDAYS[scheduleDay]} ${scheduleTime}`}
                      {scheduleType === 'monthly' && `매월 ${scheduleDay}일 ${scheduleTime}`}
                    </span>
                  </div>
                  {/* ★ D86: D-1 사전 알림 */}
                  <div className="flex justify-between">
                    <span className="text-gray-500">D-1 알림</span>
                    <span className={preNotify ? 'text-blue-700 font-medium' : 'text-gray-400'}>
                      {preNotify ? (notifyPhones.length > 0 ? `ON (${notifyPhones.length}명)` : 'ON (알림번호 미입력)') : 'OFF'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">메시지 유형</span>
                    <span className="text-gray-800">{messageType}{isAd ? ' (광고)' : ''}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">발신번호</span>
                    <span className="text-gray-800">{callbackNumber}</span>
                  </div>
                  {(messageType === 'LMS' || messageType === 'MMS') && messageSubject && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">제목</span>
                      <span className="text-gray-800">{messageSubject}</span>
                    </div>
                  )}
                  {aiGenerateEnabled && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">AI 문안생성</span>
                      <span className="text-violet-600 font-medium">ON ({AI_TONES.find(t => t.value === aiTone)?.label || aiTone})</span>
                    </div>
                  )}
                </div>

                {/* AI 모드 요약 */}
                {aiGenerateEnabled && (
                  <div className="bg-violet-50 rounded-lg p-3 border border-violet-200">
                    <p className="text-xs text-violet-600 font-medium mb-1">AI 자동생성 설정</p>
                    <p className="text-sm text-gray-700 mb-2">{aiPrompt}</p>
                    <p className="text-xs text-gray-500">발송 D-2에 AI가 문안을 생성하고 스팸테스트를 자동 진행합니다. 실패 시 아래 폴백 메시지가 발송됩니다.</p>
                    <div className="mt-2 p-2 bg-white rounded border border-violet-100 text-xs text-gray-600">
                      <span className="font-medium text-violet-600">폴백: </span>{fallbackMessageContent}
                    </div>
                  </div>
                )}

                {/* 선택된 필드 태그 */}
                <div className="flex flex-wrap gap-1.5">
                  {selectedFields.map(key => {
                    const field = availableFields.find(f => f.field_key === key);
                    return (
                      <span key={key} className="px-2 py-1 bg-violet-50 border border-violet-200 rounded-md text-xs text-violet-700">
                        {field?.display_name || key}
                      </span>
                    );
                  })}
                </div>

                {/* 메시지 미리보기 (AI 모드 OFF일 때만) */}
                {!aiGenerateEnabled && (
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs text-blue-700 font-medium mb-1">메시지 미리보기</p>
                  {isAd && <p className="text-sm text-orange-600 font-medium">(광고)</p>}
                  <p className="text-sm text-gray-700 whitespace-pre-line">{messageContent}</p>
                  {isAd && optOutNumber && (
                    <p className="text-sm text-orange-600 mt-1">{getAdSuffix()}</p>
                  )}
                </div>
                )}
                {messageType === 'MMS' && mmsUploadedImages.length > 0 && (
                  <div className="flex gap-2">
                    {mmsUploadedImages.map((img, idx) => (
                      <img key={idx} src={img.url} alt="" className="w-16 h-16 object-cover rounded-lg border" />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 하단 버튼 */}
          <div className="sticky bottom-0 bg-white border-t border-gray-100 px-6 py-4 flex items-center justify-between">
            <div>
              {step > 1 && (
                <button
                  onClick={() => setStep(step - 1)}
                  className="text-sm text-gray-500 hover:text-gray-700 transition"
                >
                  ← 이전
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition"
              >
                취소
              </button>
              {step < TOTAL_STEPS ? (
                <button
                  onClick={() => {
                    setError('');
                    if (!canProceed()) return;
                    setStep(step + 1);
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition"
                >
                  다음 →
                </button>
              ) : (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-5 py-2 rounded-lg text-sm font-medium transition"
                >
                  {saving ? '저장 중...' : (isEdit ? '수정 완료' : '자동발송 생성')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* AI 문구 추천 모달 */}
      <AiMessageSuggestModal
        show={showAiHelper}
        onClose={() => setShowAiHelper(false)}
        aiHelperPrompt={aiHelperPrompt}
        setAiHelperPrompt={setAiHelperPrompt}
        aiHelperLoading={aiHelperLoading}
        aiHelperResults={aiHelperResults}
        aiHelperRecommendation={aiHelperRecommendation}
        onGenerate={generateAiMessage}
        onSelectMessage={selectAiMessage}
        msgType={messageType}
      />

      {/* 스팸필터 테스트 모달 */}
      {/* ★ D106: 미리보기용 변수 치환 — replaceMessageVars로 필드매핑 변수(%고객명% 등) 치환 후 전달 */}
      {showSpamFilter && (() => {
        const preReplacedMsg = spamSampleCustomer
          ? replaceMessageVars(messageContent, availableFields, spamSampleCustomer, { removeUnmatched: true })
          : messageContent;
        return (
          <SpamFilterTestModal
            onClose={() => setShowSpamFilter(false)}
            messageContentSms={buildAdMessageFront(preReplacedMsg, 'SMS', isAd, optOutNumber)}
            messageContentLms={buildAdMessageFront(preReplacedMsg, 'LMS', isAd, optOutNumber)}
            callbackNumber={callbackNumber}
            messageType={messageType}
            subject={messageSubject}
            firstRecipient={spamSampleCustomer}
          />
        );
      })()}

    </>
  );
}
