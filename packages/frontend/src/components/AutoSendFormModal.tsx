/**
 * ★ D69: 자동발송 생성/수정 모달
 *
 * 설정 단계:
 * 1. 기본 정보 (캠페인명, 설명)
 * 2. 스케줄 (매월/매주/매일 + 발송일/요일 + 시각)
 * 3. 메시지 (SMS/LMS + 본문 + 발신번호)
 * 4. 확인 (요약)
 */

import { useEffect, useState } from 'react';

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
  const [messageType, setMessageType] = useState(campaign?.message_type || 'SMS');
  const [messageContent, setMessageContent] = useState(campaign?.message_content || '');
  const [messageSubject, setMessageSubject] = useState(campaign?.message_subject || '');
  const [callbackNumber, setCallbackNumber] = useState(campaign?.callback_number || '');
  const [isAd, setIsAd] = useState(campaign?.is_ad ?? false);

  // 발신번호 목록
  const [callbackNumbers, setCallbackNumbers] = useState<{ id: string; phone: string; label: string; is_default: boolean }[]>([]);

  // UI
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 발신번호 로드
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/companies/callback-numbers', {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (res.ok) {
          const data = await res.json();
          const numbers = data.callbackNumbers || data || [];
          setCallbackNumbers(numbers);
          if (!callbackNumber && numbers.length > 0) {
            const defaultCb = numbers.find((n: any) => n.is_default);
            setCallbackNumber(defaultCb?.phone || numbers[0]?.phone || '');
          }
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
  const autoMessageType = msgBytes > 90 ? 'LMS' : 'SMS';

  // 저장
  const handleSave = async () => {
    setError('');

    if (!campaignName.trim()) { setError('자동발송 이름을 입력해주세요.'); setStep(1); return; }
    if (!messageContent.trim()) { setError('메시지 내용을 입력해주세요.'); setStep(3); return; }
    if (!callbackNumber) { setError('발신번호를 선택해주세요.'); setStep(3); return; }

    setSaving(true);
    try {
      const body = {
        campaign_name: campaignName.trim(),
        description: description.trim() || null,
        schedule_type: scheduleType,
        schedule_day: scheduleType === 'daily' ? null : scheduleDay,
        schedule_time: scheduleTime,
        target_filter: campaign?.target_filter || {},
        message_type: autoMessageType,
        message_content: messageContent.trim(),
        message_subject: autoMessageType !== 'SMS' ? messageSubject.trim() || null : null,
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
                          if (st.value === 'weekly') setScheduleDay(1); // 기본 월요일
                          if (st.value === 'monthly') setScheduleDay(1); // 기본 1일
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

                {/* LMS 제목 */}
                {autoMessageType !== 'SMS' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">제목 (LMS/MMS)</label>
                    <input
                      type="text"
                      value={messageSubject}
                      onChange={e => setMessageSubject(e.target.value)}
                      placeholder="메시지 제목"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      maxLength={200}
                    />
                  </div>
                )}

                {/* 메시지 본문 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    메시지 내용 *
                    <span className={`ml-2 text-xs ${msgBytes > 90 ? 'text-amber-600' : 'text-gray-400'}`}>
                      {msgBytes}/90 bytes ({autoMessageType})
                    </span>
                  </label>
                  <textarea
                    value={messageContent}
                    onChange={e => setMessageContent(e.target.value)}
                    placeholder={'%고객명%님 안녕하세요!\n생일을 축하드립니다. 🎂'}
                    rows={5}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    변수: %고객명%, %매장명%, %등급% 등을 사용하면 발송 시 자동 치환됩니다
                  </p>
                </div>

                {/* 발신번호 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">발신번호 *</label>
                  {callbackNumbers.length > 0 ? (
                    <select
                      value={callbackNumber}
                      onChange={e => setCallbackNumber(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      {callbackNumbers.map(cb => (
                        <option key={cb.id} value={cb.phone}>
                          {cb.phone}{cb.label ? ` (${cb.label})` : ''}{cb.is_default ? ' [기본]' : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-sm text-gray-400">등록된 발신번호가 없습니다. 설정에서 발신번호를 등록해주세요.</p>
                  )}
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
                    <span className="text-gray-800">{autoMessageType}{isAd ? ' (광고)' : ''}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">발신번호</span>
                    <span className="text-gray-800">{callbackNumber}</span>
                  </div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs text-blue-700 font-medium mb-1">메시지 미리보기</p>
                  <p className="text-sm text-gray-700 whitespace-pre-line">{messageContent}</p>
                </div>
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
    </>
  );
}
