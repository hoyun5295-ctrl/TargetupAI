import { useState, useEffect } from 'react';

interface AiCampaignSendModalProps {
  onClose: () => void;
  onSend: (data: {
    campaignName: string;
    sendTimeOption: 'ai' | 'now' | 'custom';
    customSendTime: string;
    selectedCallback: string;
    useIndividualCallback: boolean;
  }) => void;
  isSending: boolean;
  // AI 결과 데이터
  messageText: string;
  selectedChannel: string;
  suggestedCampaignName: string;
  recommendedTime: string;
  targetDescription: string;
  targetCount: number;
  // 회신번호
  callbackNumbers: { id: string; phone: string; label: string; is_default: boolean }[];
  defaultCallback: string;
  defaultUseIndividual: boolean;
  // 광고 여부
  isAd: boolean;
  optOutNumber: string;
  // MMS
  mmsImages?: { url: string }[];
  subject?: string;
  // 개인화
  usePersonalization?: boolean;
}

export default function AiCampaignSendModal({
  onClose,
  onSend,
  isSending,
  messageText,
  selectedChannel,
  suggestedCampaignName,
  recommendedTime,
  targetDescription,
  targetCount,
  callbackNumbers,
  defaultCallback,
  defaultUseIndividual,
  isAd,
  optOutNumber,
  mmsImages,
  subject,
  usePersonalization,
}: AiCampaignSendModalProps) {
  const [campaignName, setCampaignName] = useState(suggestedCampaignName || '');
  const [sendTimeOption, setSendTimeOption] = useState<'ai' | 'now' | 'custom'>('ai');
  const [customSendTime, setCustomSendTime] = useState('');
  const [selectedCallback, setSelectedCallback] = useState(defaultCallback);
  const [useIndividualCallback, setUseIndividualCallback] = useState(defaultUseIndividual);

  useEffect(() => {
    if (!recommendedTime) setSendTimeOption('now');
  }, [recommendedTime]);

  const handleSend = () => {
    if (!campaignName.trim()) {
      alert('캠페인명을 입력해주세요');
      return;
    }
    if (!selectedCallback && !useIndividualCallback) {
      alert('회신번호를 선택해주세요');
      return;
    }
    if (sendTimeOption === 'custom' && !customSendTime) {
      alert('발송 시간을 선택해주세요');
      return;
    }
    onSend({
      campaignName,
      sendTimeOption,
      customSendTime,
      selectedCallback,
      useIndividualCallback,
    });
  };

  const formatPhoneNumber = (num: string) => {
    if (!num) return '';
    const clean = num.replace(/\D/g, '');
    if (clean.startsWith('02')) return clean.replace(/(\d{2})(\d{3,4})(\d{4})/, '$1-$2-$3');
    if (clean.length === 8) return clean.replace(/(\d{4})(\d{4})/, '$1-$2');
    return clean.replace(/(\d{3,4})(\d{3,4})(\d{4})/, '$1-$2-$3');
  };

  // 미리보기 메시지 구성
  const getPreviewMessage = () => {
    let msg = messageText || '';
    if (usePersonalization) {
      const sampleData: Record<string, string> = { '이름': '김민수', '포인트': '12,500', '등급': 'VIP', '매장명': '강남점', '지역': '서울' };
      Object.entries(sampleData).forEach(([k, v]) => { msg = msg.replace(new RegExp(`%${k}%`, 'g'), v); });
    }
    return msg;
  };

  // AI 추천시간 과거 여부
  const isRecommendedTimePast = () => {
    if (!recommendedTime) return false;
    const t = recommendedTime;
    let d: Date | null = null;
    if (t.includes('T') || t.match(/^\d{4}-\d{2}-\d{2}/)) d = new Date(t);
    else {
      const m = t.match(/(\d+)월\s*(\d+)일.*?(\d{1,2}):?(\d{2})?/);
      if (m) d = new Date(new Date().getFullYear(), parseInt(m[1]) - 1, parseInt(m[2]), parseInt(m[3]), parseInt(m[4] || '0'));
    }
    return d ? d.getTime() <= Date.now() : false;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[55]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* 헤더 */}
        <div className="p-5 bg-gradient-to-r from-green-50 to-emerald-50 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center"><span className="text-xl">🚀</span></div>
            <div>
              <h3 className="font-bold text-gray-800 text-lg">AI 추천 결과 - 메시지 & 발송</h3>
              <p className="text-xs text-gray-500">캠페인 정보를 확인하고 발송합니다</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        {/* 본문 */}
        <div className="p-5 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 160px)' }}>
          <div className="flex gap-5">
            {/* 좌측: 폰 미리보기 */}
            <div className="flex-shrink-0">
              <div className="rounded-[1.8rem] p-[3px] bg-gradient-to-b from-emerald-400 to-green-600 shadow-lg shadow-green-200">
                <div className="bg-white rounded-[1.6rem] overflow-hidden flex flex-col w-[260px]" style={{ height: '440px' }}>
                  {/* 상단 */}
                  <div className="px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100 flex justify-between items-center shrink-0 border-b">
                    <span className="text-[11px] text-gray-400 font-medium">문자메시지</span>
                    <span className="text-[11px] font-bold text-emerald-600">
                      {useIndividualCallback ? '매장번호' : formatPhoneNumber(selectedCallback) || '회신번호'}
                    </span>
                  </div>
                  {/* LMS 제목 */}
                  {(selectedChannel === 'LMS' || selectedChannel === 'MMS') && subject && (
                    <div className="px-4 py-2 bg-orange-50 border-b border-orange-200 shrink-0">
                      <span className="text-sm font-bold text-orange-700">{subject}</span>
                    </div>
                  )}
                  {/* 메시지 영역 */}
                  <div className="flex-1 overflow-y-auto p-3 bg-gradient-to-b from-emerald-50/30 to-white">
                    {/* MMS 이미지 */}
                    {mmsImages && mmsImages.length > 0 && mmsImages.map((img, idx) => (
                      <img key={idx} src={img.url} alt="" className="w-full h-auto rounded mb-1.5" />
                    ))}
                    <div className="flex gap-2 mt-1">
                      <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 text-xs">📱</div>
                      <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm border border-gray-100 text-[12px] leading-[1.7] whitespace-pre-wrap break-all text-gray-700 max-w-[95%]">
                        {getPreviewMessage() || '메시지 없음'}
                      </div>
                    </div>
                  </div>
                  {/* 하단 */}
                  <div className="px-3 py-2 border-t bg-gray-50 text-center shrink-0">
                    <span className="text-[10px] text-gray-400">{selectedChannel}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 우측: 발송 설정 */}
            <div className="flex-1 min-w-0 space-y-5">
              {/* 타겟 요약 */}
              <div className="bg-blue-50 rounded-lg p-3 flex items-center justify-between">
                <div>
                  <span className="text-xs text-gray-500">📌 발송 대상</span>
                  <div className="text-sm font-medium text-gray-700 mt-0.5">{targetDescription}</div>
                </div>
                <div className="text-blue-600 font-bold text-lg">{targetCount?.toLocaleString()}명</div>
              </div>

              {/* 캠페인명 */}
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-2 block">📝 캠페인명</label>
                <input
                  type="text"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="캠페인명을 입력하세요"
                  className="w-full border-2 rounded-lg px-4 py-2.5 text-sm focus:border-green-400 focus:outline-none"
                />
              </div>

              {/* 회신번호 */}
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-2 block">📞 회신번호</label>
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
                  className="w-full border-2 rounded-lg px-4 py-2.5 text-sm focus:border-green-400 focus:outline-none"
                >
                  <option value="">회신번호 선택</option>
                  <option value="__individual__">📱 개별회신번호 (고객별 매장번호)</option>
                  {callbackNumbers.map((cb) => (
                    <option key={cb.id} value={cb.phone}>
                      {cb.label || cb.phone} {cb.is_default && '(기본)'}
                    </option>
                  ))}
                </select>
                {useIndividualCallback && (
                  <p className="text-xs text-blue-600 mt-1">💡 각 고객의 주이용매장 회신번호로 발송</p>
                )}
              </div>

              {/* 발송시간 */}
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-2 block">⏰ 발송시간</label>
                <div className="space-y-2">
                  {/* AI 추천시간 */}
                  {recommendedTime && (
                    <label
                      onClick={() => setSendTimeOption('ai')}
                      className={`block p-3 border-2 rounded-xl cursor-pointer transition-all ${sendTimeOption === 'ai' ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-green-300'}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${sendTimeOption === 'ai' ? 'border-green-500' : 'border-gray-300'}`}>
                            {sendTimeOption === 'ai' && <div className="w-2 h-2 rounded-full bg-green-500" />}
                          </div>
                          <span className="font-medium text-sm">🤖 AI 추천시간</span>
                        </div>
                        <span className="text-sm text-gray-600">{recommendedTime}</span>
                      </div>
                      {isRecommendedTimePast() && (
                        <div className="text-xs text-orange-500 mt-1 ml-6">→ 과거 시간이므로 다음날로 자동 보정됩니다</div>
                      )}
                    </label>
                  )}

                  {/* 즉시 발송 */}
                  <label
                    onClick={() => setSendTimeOption('now')}
                    className={`block p-3 border-2 rounded-xl cursor-pointer transition-all ${sendTimeOption === 'now' ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-green-300'}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${sendTimeOption === 'now' ? 'border-green-500' : 'border-gray-300'}`}>
                        {sendTimeOption === 'now' && <div className="w-2 h-2 rounded-full bg-green-500" />}
                      </div>
                      <span className="font-medium text-sm">⚡ 즉시 발송</span>
                      <span className="text-xs text-gray-400">지금 바로</span>
                    </div>
                  </label>

                  {/* 예약 발송 */}
                  <label
                    onClick={() => setSendTimeOption('custom')}
                    className={`block p-3 border-2 rounded-xl cursor-pointer transition-all ${sendTimeOption === 'custom' ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-green-300'}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${sendTimeOption === 'custom' ? 'border-green-500' : 'border-gray-300'}`}>
                        {sendTimeOption === 'custom' && <div className="w-2 h-2 rounded-full bg-green-500" />}
                      </div>
                      <span className="font-medium text-sm">📅 예약 발송</span>
                    </div>
                    {sendTimeOption === 'custom' && (
                      <div className="ml-6 flex items-center gap-2">
                        <input
                          type="date"
                          className="border-2 rounded-lg px-3 py-1.5 text-sm"
                          value={customSendTime?.split('T')[0] || ''}
                          min={new Date().toISOString().split('T')[0]}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const time = customSendTime?.split('T')[1] || '09:00';
                            setCustomSendTime(`${e.target.value}T${time}`);
                          }}
                        />
                        <select
                          value={parseInt(customSendTime?.split('T')[1]?.split(':')[0] || '9') >= 12 ? 'PM' : 'AM'}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const currentHour = parseInt(customSendTime?.split('T')[1]?.split(':')[0] || '9');
                            const hour12 = currentHour === 0 ? 12 : currentHour > 12 ? currentHour - 12 : currentHour;
                            let hour24 = e.target.value === 'PM' ? (hour12 === 12 ? 12 : hour12 + 12) : (hour12 === 12 ? 0 : hour12);
                            const date = customSendTime?.split('T')[0] || new Date().toISOString().split('T')[0];
                            const minute = customSendTime?.split('T')[1]?.split(':')[1] || '00';
                            setCustomSendTime(`${date}T${hour24.toString().padStart(2, '0')}:${minute}`);
                          }}
                          className="border-2 rounded-lg px-2 py-1.5 text-sm"
                        >
                          <option value="AM">오전</option>
                          <option value="PM">오후</option>
                        </select>
                        <input
                          type="number" min="1" max="12"
                          value={(() => { const h = parseInt(customSendTime?.split('T')[1]?.split(':')[0] || '9'); return h === 0 ? 12 : h > 12 ? h - 12 : h; })()}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            let h12 = Math.min(12, Math.max(1, parseInt(e.target.value) || 1));
                            const cur = parseInt(customSendTime?.split('T')[1]?.split(':')[0] || '9');
                            const isPM = cur >= 12;
                            let h24 = isPM ? (h12 === 12 ? 12 : h12 + 12) : (h12 === 12 ? 0 : h12);
                            const date = customSendTime?.split('T')[0] || new Date().toISOString().split('T')[0];
                            const min = customSendTime?.split('T')[1]?.split(':')[1] || '00';
                            setCustomSendTime(`${date}T${h24.toString().padStart(2, '0')}:${min}`);
                          }}
                          className="w-12 border-2 rounded-lg px-2 py-1.5 text-sm text-center"
                        />
                        <span className="text-lg font-bold text-gray-400">:</span>
                        <input
                          type="number" min="0" max="59"
                          value={parseInt(customSendTime?.split('T')[1]?.split(':')[1] || '0')}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            let min = Math.min(59, Math.max(0, parseInt(e.target.value) || 0));
                            const date = customSendTime?.split('T')[0] || new Date().toISOString().split('T')[0];
                            const hour = customSendTime?.split('T')[1]?.split(':')[0] || '09';
                            setCustomSendTime(`${date}T${hour}:${min.toString().padStart(2, '0')}`);
                          }}
                          className="w-12 border-2 rounded-lg px-2 py-1.5 text-sm text-center"
                        />
                      </div>
                    )}
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 하단 버튼 */}
        <div className="p-4 border-t bg-gray-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors">
            취소
          </button>
          <button
            onClick={handleSend}
            disabled={isSending}
            className="px-8 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {isSending ? '⏳ 발송 중...' : '🚀 발송하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
