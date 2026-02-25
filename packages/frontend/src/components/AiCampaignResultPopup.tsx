import React from 'react';

interface AiCampaignResultPopupProps {
  show: boolean;
  onClose: () => void;
  aiStep: number;
  setAiStep: (step: number) => void;
  aiResult: any;
  setAiResult: (result: any) => void;
  selectedChannel: string;
  setSelectedChannel: (ch: string) => void;
  selectedAiMsgIdx: number;
  setSelectedAiMsgIdx: (idx: number) => void;
  editingAiMsg: number | null;
  setEditingAiMsg: (idx: number | null) => void;
  isAd: boolean;
  setIsAd: (v: boolean) => void;
  user: any;
  aiLoading: boolean;
  handleAiGenerateChannelMessage: () => void;
  // Step 2 buttons
  testSentResult: string | null;
  testSending: boolean;
  testCooldown: boolean;
  handleTestSend: () => void;
  setShowPreview: (v: boolean) => void;
  setShowAiSendModal: (v: boolean) => void;
  setShowSpamFilter: (v: boolean) => void;
  setSpamFilterData: (data: any) => void;
  setShowMmsUploadModal: (v: boolean) => void;
  // MMS
  mmsUploadedImages: {serverPath: string; url: string; filename: string; size: number}[];
  setMmsUploadedImages: React.Dispatch<React.SetStateAction<{serverPath: string; url: string; filename: string; size: number}[]>>;
  // Utils
  wrapAdText: (text: string) => string;
  calculateBytes: (text: string) => number;
  optOutNumber: string;
  selectedCallback: string;
  campaign: any;
  formatRejectNumber: (num: string) => string;
}

export default function AiCampaignResultPopup({
  show,
  onClose,
  aiStep,
  setAiStep,
  aiResult,
  setAiResult,
  selectedChannel,
  setSelectedChannel,
  selectedAiMsgIdx,
  setSelectedAiMsgIdx,
  editingAiMsg,
  setEditingAiMsg,
  isAd,
  setIsAd,
  user,
  aiLoading,
  handleAiGenerateChannelMessage,
  testSentResult,
  testSending,
  testCooldown,
  handleTestSend,
  setShowPreview,
  setShowAiSendModal,
  setShowSpamFilter,
  setSpamFilterData,
  setShowMmsUploadModal,
  mmsUploadedImages,
  setMmsUploadedImages,
  wrapAdText,
  calculateBytes,
  optOutNumber,
  selectedCallback,
  campaign,
  formatRejectNumber,
}: AiCampaignResultPopupProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className={`bg-white rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto ${aiStep === 2 ? 'w-[960px]' : 'w-[600px]'}`}>
        
        {/* 헤더 */}
        <div className="p-6 border-b bg-green-50">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <span>✨</span> AI 추천 결과 {aiStep === 1 ? '- 타겟 & 채널' : '- 캠페인 확정'}
            </h3>
            <button onClick={() => { onClose(); setAiStep(1); }} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
          </div>
        </div>

        {/* Step 1: 타겟 + 채널 선택 */}
        {aiStep === 1 && (
          <div className="p-6 space-y-6">
            {/* 타겟 요약 */}
            <div className="bg-blue-50 rounded-lg p-4">
              <div className="text-sm text-gray-600 mb-1">📌 추출된 타겟</div>
              <div className="font-semibold text-gray-800">{aiResult?.target?.description || '추천 타겟'}</div>
<div className="text-blue-600 font-bold text-lg mt-1">{aiResult?.target?.count?.toLocaleString() || 0}명</div>
            </div>

            {/* 채널 추천 */}
            <div>
              <div className="text-sm text-gray-600 mb-2">📱 AI 추천 채널</div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
              <div className="font-semibold text-purple-800">{aiResult?.recommendedChannel || 'SMS'} 추천</div>
              <div className="text-sm text-purple-600 mt-1">"{aiResult?.channelReason || '추천 채널입니다'}"</div>
              {(aiResult?.recommendedChannel === '카카오' || aiResult?.recommendedChannel === 'KAKAO') && !(user as any)?.company?.kakaoEnabled && (
                <div className="text-xs text-amber-600 mt-2 bg-amber-50 rounded p-2">💡 카카오 채널은 아직 준비 중입니다. 현재는 SMS/LMS를 이용해주세요.</div>
              )}
              </div>
{/* 광고성 여부 */}
<div className="flex items-center justify-between bg-yellow-50 rounded-lg p-4 mb-4">
              <div>
                <div className="font-semibold text-gray-800">📢 광고성 메시지</div>
                <div className="text-sm text-gray-500">
                  {isAd ? '(광고) 표기 + 무료거부번호 필수 포함' : '알림성 메시지 (표기 불필요)'}
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={isAd} 
                  onChange={(e) => setIsAd(e.target.checked)}
                  className="sr-only peer" 
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
              </label>
            </div>
              <div className="text-sm text-gray-600 mb-2">채널 선택</div>
              <div className="grid grid-cols-4 gap-2">
                {[{key: 'SMS', label: 'SMS', icon: '📱'}, {key: 'LMS', label: 'LMS', icon: '📝'}, {key: 'MMS', label: 'MMS', icon: '🖼️'}, {key: 'KAKAO', label: '카카오', icon: '💬'}].map(({key: ch, label, icon}) => {
                  const isKakao = ch === 'KAKAO';
                  const kakaoEnabled = !!(user as any)?.company?.kakaoEnabled;
                  const isKakaoDisabled = isKakao && !kakaoEnabled;
                  return (
                  <button
                    key={ch}
                    onClick={() => { if (isKakaoDisabled) return; setSelectedChannel(ch); if (ch !== 'MMS') setMmsUploadedImages([]); }}
                    disabled={isKakaoDisabled}
                    className={`p-3 rounded-lg border-2 text-center font-medium transition-all relative ${
                      isKakaoDisabled
                        ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed opacity-60'
                        : selectedChannel === ch
                        ? 'border-purple-500 bg-purple-50 text-purple-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-600'
                    }`}
                  >
                    {icon} {label}
                    {isKakaoDisabled && (
                      <span className="absolute -top-2 -right-2 text-[10px] bg-gray-400 text-white px-1.5 py-0.5 rounded-full font-medium">준비중</span>
                    )}
                  </button>
                  );
                })}
              </div>
            </div>

            {/* 다음 버튼 */}
            <button
              onClick={handleAiGenerateChannelMessage}
              disabled={aiLoading}
              className="w-full py-4 bg-green-700 text-white rounded-lg font-medium hover:bg-green-800 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {aiLoading ? (
                <>
                  <span className="animate-spin">⏳</span>
                  메시지 생성 중...
                </>
              ) : (
                <>다음: 문구 생성 →</>
              )}
            </button>
          </div>
        )}

        {/* Step 2: 메시지 + 캠페인 확정 */}
        {aiStep === 2 && (
          <div className="p-6 space-y-6">
            {/* 선택된 채널 표시 */}
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>선택된 채널:</span>
              <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded font-medium">{selectedChannel === 'KAKAO' ? '카카오' : selectedChannel}</span>
            </div>

            {/* 메시지 3안 - 모던 폰 UI */}
            <div>
              <div className="text-sm text-gray-600 mb-3">💬 {selectedChannel === 'KAKAO' ? '카카오' : selectedChannel} 메시지 추천 (택1)</div>
              <div className="grid grid-cols-3 gap-5">
                {aiResult?.messages?.length > 0 ? (
                  aiResult.messages.map((msg: any, idx: number) => (
                    <label key={msg.variant_id || idx} className="cursor-pointer group">
                      <input type="radio" name="message" className="hidden" defaultChecked={idx === 0} onChange={() => { setSelectedAiMsgIdx(idx); setEditingAiMsg(null); }} />
                      {/* 모던 폰 프레임 */}
                      <div className="rounded-[1.8rem] p-[3px] transition-all bg-gray-300 group-has-[:checked]:bg-gradient-to-b group-has-[:checked]:from-purple-400 group-has-[:checked]:to-purple-600 group-has-[:checked]:shadow-lg group-has-[:checked]:shadow-purple-200 hover:bg-gray-400">
                        <div className="bg-white rounded-[1.6rem] overflow-hidden flex flex-col" style={{ height: '420px' }}>
                          {/* 상단 - 타입명 + 수정 버튼 */}
                          <div className="px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100 flex justify-between items-center shrink-0 border-b">
                            <span className="text-[11px] text-gray-400 font-medium">{selectedChannel === 'KAKAO' ? '카카오톡' : '문자메시지'}</span>
                            <div className="flex items-center gap-1.5">
                              {selectedAiMsgIdx === idx && editingAiMsg !== idx && (
                                <button
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingAiMsg(idx); }}
                                  className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded hover:bg-purple-200 transition-colors"
                                >
                                  ✏️ 수정
                                </button>
                              )}
                              <span className="text-[11px] font-bold text-purple-600">{msg.variant_id}. {msg.variant_name}</span>
                            </div>
                          </div>
                          {/* LMS/MMS 제목 */}
                          {(selectedChannel === 'LMS' || selectedChannel === 'MMS') && msg.subject && (
                            <div className="px-4 py-1.5 bg-orange-50 border-b border-orange-200 shrink-0">
                              <span className="text-[11px] font-bold text-orange-700">{msg.subject}</span>
                            </div>
                          )}
                          {/* 메시지 영역 */}
                          <div className="flex-1 overflow-y-auto p-3 bg-gradient-to-b from-purple-50/30 to-white">
                            {editingAiMsg === idx ? (
                              <div className="h-full flex flex-col gap-2">
                                {(selectedChannel === 'LMS' || selectedChannel === 'MMS') && (
                                  <input
                                    type="text"
                                    value={msg.subject || ''}
                                    onChange={(e) => {
                                      const updated = [...aiResult.messages];
                                      updated[idx] = { ...updated[idx], subject: e.target.value };
                                      setAiResult({ ...aiResult, messages: updated });
                                    }}
                                    placeholder="LMS 제목"
                                    className="w-full text-[12px] px-2 py-1.5 border border-orange-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
                                  />
                                )}
                                <textarea
                                  value={msg.message_text}
                                  onChange={(e) => {
                                    const updated = [...aiResult.messages];
                                    updated[idx] = { ...updated[idx], message_text: e.target.value, byte_count: calculateBytes(e.target.value) };
                                    setAiResult({ ...aiResult, messages: updated });
                                  }}
                                  className="flex-1 w-full text-[12px] leading-[1.6] p-2 border border-purple-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-400"
                                  autoFocus
                                />
                                <button
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingAiMsg(null); }}
                                  className="py-1.5 bg-purple-600 text-white text-[11px] font-medium rounded-lg hover:bg-purple-700 transition-colors"
                                >
                                  ✅ 수정 완료
                                </button>
                              </div>
                            ) : (
                            <div className="flex gap-2">
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs ${selectedChannel === 'KAKAO' ? 'bg-yellow-100' : 'bg-purple-100'}`}>{selectedChannel === 'KAKAO' ? '💬' : '📱'}</div>
                              <div className={`rounded-2xl rounded-tl-sm p-3 shadow-sm border text-[12px] leading-[1.6] whitespace-pre-wrap break-all overflow-hidden text-gray-700 max-w-[95%] ${selectedChannel === 'KAKAO' ? 'bg-yellow-50 border-yellow-200' : 'bg-white border-gray-100'}`}>
                              {aiResult?.usePersonalization ? (() => {
                                  const sampleData: Record<string, string> = { '이름': '김민수', '포인트': '12,500', '등급': 'VIP', '매장명': '강남점', '지역': '서울', '구매금액': '350,000', '구매횟수': '8', '평균주문금액': '43,750', 'LTV점수': '85' };
                                  let text = msg.message_text || '';
                                  Object.entries(sampleData).forEach(([k, v]) => { text = text.replace(new RegExp(`%${k}%`, 'g'), v); });
                                  return wrapAdText(text);
                                })() : wrapAdText(msg.message_text || '')}
                              </div>
                            </div>
                            )}
                          </div>
                          {/* 하단 바이트 */}
                          <div className="px-3 py-2 border-t bg-gray-50 text-center shrink-0">
                          <span className={`text-[10px] ${editingAiMsg === idx ? 'text-purple-600 font-medium' : 'text-gray-400'}`}>{calculateBytes(wrapAdText(msg.message_text || ''))} / {selectedChannel === 'SMS' ? 90 : selectedChannel === 'KAKAO' ? '4000자' : 2000} bytes</span>
                          </div>
                        </div>
                      </div>
                    </label>
                  ))
                ) : (
                  <div className="col-span-3 text-center py-8 text-gray-400">
                    메시지를 불러오는 중...
                  </div>
                )}
              </div>
            </div>

            {/* MMS 이미지 첨부 */}
            <div>
              <div className="text-base font-semibold text-gray-700 mb-3">🖼️ 이미지 첨부 (MMS)</div>
              <div
                onClick={() => setShowMmsUploadModal(true)}
                className="border-2 border-dashed border-gray-200 rounded-xl p-4 bg-gray-50/50 cursor-pointer hover:border-purple-400 hover:bg-purple-50/50 transition-all"
              >
                {mmsUploadedImages.length > 0 ? (
                  <div className="flex items-center gap-3">
                    {mmsUploadedImages.map((img, idx) => (
                      <img key={idx} src={img.url} alt="" className="w-16 h-16 object-cover rounded-lg border shadow-sm" />
                    ))}
                    <div className="text-sm text-purple-600 font-medium">✏️ {mmsUploadedImages.length}장 첨부됨 (클릭하여 수정)</div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 py-2">
                    <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                      <span className="text-xl">📷</span>
                    </div>
                    <div className="text-sm text-gray-500">클릭하여 이미지를 첨부하면 MMS로 발송됩니다</div>
                    <div className="text-xs text-gray-400">JPG만 · 300KB 이하 · 최대 3장</div>
                  </div>
                )}
              </div>
            </div>

{/* 하단 버튼 */}
{testSentResult && (
              <div className={`p-3 rounded-lg text-sm whitespace-pre-wrap mb-3 ${testSentResult.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {testSentResult}
              </div>
            )}
            <div className="flex gap-3 pt-4 border-t">
              <button
                onClick={() => setAiStep(1)}
                className="flex-1 py-3 border rounded-lg text-gray-600 hover:bg-gray-100 flex items-center justify-center gap-2"
              >
                ← 채널변경
              </button>
              <button
onClick={handleTestSend}
disabled={testSending || testCooldown}
className="flex-1 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 flex items-center justify-center gap-2"
>
{testSending ? '📱 발송 중...' : testCooldown ? '⏳ 10초 대기' : '📱 담당자 테스트'}
</button>
<button 
onClick={() => setShowPreview(true)}
className="flex-1 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2"
>
👁️ 미리보기
</button>
<button 
onClick={() => {
  const msg = aiResult?.messages?.[selectedAiMsgIdx]?.message_text || campaign.messageContent || '';
                    const cb = selectedCallback || '';
                    const smsMsg = isAd ? `(광고)${msg}\n무료거부${optOutNumber.replace(/-/g, '')}` : msg;
                    const lmsMsg = isAd ? `(광고) ${msg}\n무료수신거부 ${formatRejectNumber(optOutNumber)}` : msg;
                    setSpamFilterData({sms: smsMsg, lms: lmsMsg, callback: cb, msgType: selectedChannel as 'SMS'|'LMS'|'MMS'});
                    setShowSpamFilter(true);
}}
className="flex-1 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 flex items-center justify-center gap-2"
>
🛡️ 스팸필터
</button>
<button 
onClick={() => setShowAiSendModal(true)}
className="flex-1 py-3 bg-green-700 text-white rounded-lg hover:bg-green-800 flex items-center justify-center gap-2"
>
✅ 캠페인확정
</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
