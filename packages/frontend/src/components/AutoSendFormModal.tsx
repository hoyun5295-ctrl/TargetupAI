/**
 * ★ D69: 자동발송 생성/수정 모달
 *
 * 설정 단계:
 * 1. 기본 정보 (캠페인명, 설명)
 * 2. 스케줄 (매월/매주/매일 + 발송일/요일 + 시각)
 * 3. 메시지 (SMS/LMS/MMS 탭 + AI문안생성 + 스팸필터 + 본문 + 발신번호)
 * 4. 확인 (요약)
 */

import { useEffect, useState } from 'react';
import { aiApi } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import AiMessageSuggestModal from './AiMessageSuggestModal';
import SpamFilterTestModal from './SpamFilterTestModal';

interface AutoSendFormModalProps {
  campaign: any | null;  // null = 생성, 있으면 수정
  onClose: () => void;
  onSuccess: () => void;
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

function getToken(): string {
  return localStorage.getItem('token') || '';
}

// 이모지 감지 (B13-06 패턴)
const hasEmoji = (text: string): boolean => {
  const emojiPattern = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]|[\u2300-\u23FF]|[\u2B50-\u2BFF]|[\uFE00-\uFE0F]|[\u200D]|[\u20E3]|[\uE000-\uF8FF]/g;
  return emojiPattern.test(text);
};

export default function AutoSendFormModal({ campaign, onClose, onSuccess }: AutoSendFormModalProps) {
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
  const [isAd, setIsAd] = useState(campaign?.is_ad ?? false);

  // 발신번호 목록
  const [callbackNumbers, setCallbackNumbers] = useState<{ id: string; phone: string; label: string; is_default: boolean }[]>([]);

  // 080 수신거부 번호
  const [optOutNumber, setOptOutNumber] = useState('');

  // 요금제 정보
  const [planInfo, setPlanInfo] = useState<any>(null);
  const isAiMessagingLocked = !planInfo?.ai_messaging_enabled;
  const isSpamFilterLocked = !planInfo?.spam_filter_enabled;

  // AI 문구 추천
  const [showAiHelper, setShowAiHelper] = useState(false);
  const [aiHelperPrompt, setAiHelperPrompt] = useState('');
  const [aiHelperLoading, setAiHelperLoading] = useState(false);
  const [aiHelperResults, setAiHelperResults] = useState<any[]>([]);
  const [aiHelperRecommendation, setAiHelperRecommendation] = useState('');

  // 스팸필터 테스트
  const [showSpamFilter, setShowSpamFilter] = useState(false);

  // MMS 이미지
  const [mmsUploadedImages, setMmsUploadedImages] = useState<{ url: string; file?: File }[]>(
    campaign?.mms_image_url ? [{ url: campaign.mms_image_url }] : []
  );

  // 변수 필드 메타 (enabled-fields API 기반 동적)
  const [variableFields, setVariableFields] = useState<{ field_key: string; display_name: string; variable: string }[]>([]);

  // 토스트
  const [toast, setToast] = useState({ show: false, type: '' as 'success' | 'error' | 'warning' | '', message: '' });

  // UI
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 토스트 자동 숨김
  useEffect(() => {
    if (!toast.show) return;
    const timer = setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
    return () => clearTimeout(timer);
  }, [toast.show, toast.message]);

  // 발신번호 + 회사설정 로드
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

        // 요금제 정보
        const planRes = await fetch('/api/companies/plan-info', {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (planRes.ok) {
          const planData = await planRes.json();
          setPlanInfo(planData);
        }

        // 변수 필드 메타 로드 — TargetSendModal과 동일한 동적 변수 지원
        const fieldsRes = await fetch('/api/customers/enabled-fields', {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (fieldsRes.ok) {
          const fieldsData = await fieldsRes.json();
          const fields = (fieldsData.fields || fieldsData || [])
            .filter((f: any) => f.field_key !== 'phone' && f.field_key !== 'sms_opt_in')
            .map((f: any) => ({
              field_key: f.field_key,
              display_name: f.display_name || f.field_key,
              variable: `%${f.display_name || f.field_key}%`,
            }));
          setVariableFields(fields);
        }
      } catch {}
    })();
  }, []);

  // 메시지 바이트 계산
  const getByteLength = (str: string) => {
    let bytes = 0;
    for (let i = 0; i < str.length; i++) {
      bytes += str.charCodeAt(i) > 127 ? 2 : 1;
    }
    return bytes;
  };

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

  // 광고 접미사 텍스트
  const getAdSuffix = () => {
    if (!isAd || !optOutNumber) return '';
    return messageType === 'SMS'
      ? `무료거부${optOutNumber.replace(/-/g, '')}`
      : `무료수신거부 ${formatRejectNumber(optOutNumber)}`;
  };

  // AI 문구 생성
  const generateAiMessage = async () => {
    if (!aiHelperPrompt.trim()) {
      setToast({ show: true, type: 'error', message: '어떤 메시지를 보낼지 입력해주세요.' });
      return;
    }
    setAiHelperLoading(true);
    setAiHelperResults([]);
    try {
      const res = await aiApi.generateMessage({
        prompt: aiHelperPrompt,
        channel: messageType,
        isAd: isAd,
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

  // 변수 삽입
  const insertVariable = (varName: string) => {
    setMessageContent((prev: string) => prev + varName);
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
    if (!messageContent.trim()) { setError('메시지 내용을 입력해주세요.'); setStep(3); return; }
    if (!callbackNumber) { setError('발신번호를 선택해주세요.'); setStep(3); return; }
    if (messageType === 'MMS' && mmsUploadedImages.length === 0) { setError('MMS 이미지를 첨부해주세요.'); setStep(3); return; }
    if ((messageType === 'LMS' || messageType === 'MMS') && !messageSubject.trim()) { setError('LMS/MMS는 제목을 입력해주세요.'); setStep(3); return; }

    setSaving(true);
    try {
      const body = {
        campaign_name: campaignName.trim(),
        description: description.trim() || null,
        schedule_type: scheduleType,
        schedule_day: scheduleType === 'daily' ? null : scheduleDay,
        schedule_time: scheduleTime,
        target_filter: campaign?.target_filter || {},
        message_type: messageType,
        message_content: messageContent.trim(),
        message_subject: messageType !== 'SMS' ? messageSubject.trim() || null : null,
        callback_number: callbackNumber,
        is_ad: isAd,
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
        onClick={onClose}
      >
        <div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto animate-[slideUp_0.3s_ease-out]"
          onClick={e => e.stopPropagation()}
        >
          {/* 헤더 */}
          <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
            <div>
              <h2 className="text-lg font-bold text-gray-800">
                {isEdit ? '자동발송 수정' : '새 자동발송'}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">단계 {step}/4</p>
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

            {/* Step 1: 기본 정보 */}
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

            {/* Step 2: 스케줄 */}
            {step === 2 && (
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

                {/* 매월: 발송일 */}
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

                {/* 매주: 요일 */}
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

                {/* 발송 시각 */}
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
              </div>
            )}

            {/* Step 3: 메시지 */}
            {step === 3 && (
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

                {/* SMS/LMS/MMS 탭 토글 — Dashboard 직접발송 패턴 */}
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

                {/* 메시지 작성 영역 */}
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
                        value={messageContent}
                        onChange={e => {
                          const text = e.target.value;
                          setMessageContent(text);
                          if (messageType !== 'MMS' && hasEmoji(text)) {
                            setToast({ show: true, type: 'warning', message: 'SMS/LMS는 이모지를 지원하지 않습니다. 발송 실패 원인이 됩니다.' });
                          }
                        }}
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
                    {/* 이모지 안내 */}
                    <div className="text-xs text-gray-400 mt-2">
                      ⚠️ 이모지·특수문자는 LMS 전환 또는 발송 실패 원인이 될 수 있습니다
                    </div>

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
                  <div className="px-3 py-1.5 border-t">
                    {callbackNumbers.length > 0 ? (
                      <select
                        value={callbackNumber}
                        onChange={e => setCallbackNumber(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="">회신번호 선택</option>
                        {callbackNumbers.map(cb => (
                          <option key={cb.id} value={cb.phone}>
                            {cb.phone}{cb.label ? ` (${cb.label})` : ''}{cb.is_default ? ' ⭐' : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-sm text-red-500 py-2">등록된 발신번호가 없습니다. 설정에서 발신번호를 등록해주세요.</p>
                    )}
                  </div>

                  {/* ★ 자동입력 드롭다운 — fieldsMeta 기반 동적 (하드코딩 제거, TargetSendModal 패턴) */}
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
                          if (isAiMessagingLocked) {
                            setToast({ show: true, type: 'warning', message: 'AI 문구 추천은 프로 요금제 이상에서 사용 가능합니다.' });
                            return;
                          }
                          setShowAiHelper(true);
                          setAiHelperPrompt('');
                          setAiHelperResults([]);
                          setAiHelperRecommendation('');
                        }}
                        className={`py-2.5 bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 text-white rounded-lg text-sm font-medium transition-colors ${isAiMessagingLocked ? 'opacity-60' : ''}`}
                      >
                        {isAiMessagingLocked ? '🔒' : '✨'} AI 문구추천
                      </button>
                      <button
                        onClick={() => {
                          if (isSpamFilterLocked) {
                            setToast({ show: true, type: 'warning', message: '스팸필터 테스트는 프로 요금제 이상에서 사용 가능합니다.' });
                            return;
                          }
                          if (!messageContent.trim()) {
                            setToast({ show: true, type: 'error', message: '메시지를 먼저 입력해주세요.' });
                            return;
                          }
                          if (!callbackNumber) {
                            setToast({ show: true, type: 'error', message: '발신번호를 먼저 선택해주세요.' });
                            return;
                          }
                          setShowSpamFilter(true);
                        }}
                        className={`py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-colors ${isSpamFilterLocked ? 'opacity-60' : ''}`}
                      >
                        {isSpamFilterLocked ? '🔒' : '🛡️'} 스팸필터테스트
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: 확인 */}
            {step === 4 && (
              <div className="space-y-3" style={{ animation: 'slideUp 0.3s ease-out' }}>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">자동발송 설정 확인</h3>
                <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">이름</span>
                    <span className="text-gray-800 font-medium">{campaignName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">스케줄</span>
                    <span className="text-gray-800 font-medium">
                      {scheduleType === 'daily' && `매일 ${scheduleTime}`}
                      {scheduleType === 'weekly' && `매주 ${WEEKDAYS[scheduleDay]} ${scheduleTime}`}
                      {scheduleType === 'monthly' && `매월 ${scheduleDay}일 ${scheduleTime}`}
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
                </div>
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs text-blue-700 font-medium mb-1">메시지 미리보기</p>
                  {isAd && <p className="text-sm text-orange-600 font-medium">(광고)</p>}
                  <p className="text-sm text-gray-700 whitespace-pre-line">{messageContent}</p>
                  {isAd && optOutNumber && (
                    <p className="text-sm text-orange-600 mt-1">{getAdSuffix()}</p>
                  )}
                </div>
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
              {step < 4 ? (
                <button
                  onClick={() => {
                    setError('');
                    if (step === 1 && !campaignName.trim()) {
                      setError('자동발송 이름을 입력해주세요.');
                      return;
                    }
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
      {showSpamFilter && (
        <SpamFilterTestModal
          onClose={() => setShowSpamFilter(false)}
          messageContentSms={isAd ? `(광고)${messageContent}\n${getAdSuffix()}` : messageContent}
          messageContentLms={isAd ? `(광고) ${messageContent}\n${getAdSuffix()}` : messageContent}
          callbackNumber={callbackNumber}
          messageType={messageType}
          subject={messageSubject}
        />
      )}
    </>
  );
}
