import React from 'react';

interface AiPreviewModalProps {
  show: boolean;
  onClose: () => void;
  aiResult: any;
  selectedChannel: string;
  selectedAiMsgIdx: number;
  useIndividualCallback: boolean;
  selectedCallback: string;
  mmsUploadedImages: {serverPath: string; url: string; filename: string; size: number}[];
  testSentResult: string | null;
  testSending: boolean;
  testCooldown: boolean;
  handleTestSend: () => void;
  setShowAiSendModal: (v: boolean) => void;
  wrapAdText: (text: string) => string;
  formatRejectNumber?: (num: string) => string;
}

export default function AiPreviewModal({
  show,
  onClose,
  aiResult,
  selectedChannel,
  selectedAiMsgIdx,
  useIndividualCallback,
  selectedCallback,
  mmsUploadedImages,
  testSentResult,
  testSending,
  testCooldown,
  handleTestSend,
  setShowAiSendModal,
  wrapAdText,
}: AiPreviewModalProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto w-[960px]">
        <div className="p-6 border-b bg-green-50">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold">📱 발송 미리보기</h3>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
          </div>
        </div>
        
        <div className="p-6 space-y-4">
          {/* 타겟 정보 */}
          <div className="bg-blue-50 rounded-lg p-4">
            <div className="text-sm text-gray-600 mb-1">📌 발송 대상</div>
            <div className="font-semibold">{aiResult?.target?.description || '타겟 고객'}</div>
            <div className="text-blue-600 font-bold">{aiResult?.target?.count?.toLocaleString() || 0}명</div>
            {aiResult?.target?.unsubscribeCount > 0 && (
              <div className="text-rose-500 text-sm mt-1">수신거부 제외: {aiResult?.target?.unsubscribeCount?.toLocaleString()}명</div>
            )}
          </div>

          {/* 채널 */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">채널:</span>
            <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded font-medium">{selectedChannel === 'KAKAO' ? '카카오' : selectedChannel}</span>
          </div>

          {/* 회신번호 */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">📞 회신번호:</span>
            <span className="font-medium">
              {useIndividualCallback ? '개별회신번호 (고객별 매장)' : (selectedCallback || '미선택')}
            </span>
          </div>

          {/* 메시지 미리보기 - 개인화 샘플 */}
          <div>
            <div className="text-sm text-gray-600 mb-2">💬 메시지 내용</div>
            {aiResult?.usePersonalization && aiResult?.personalizationVars?.length > 0 ? (
              <div>
                <div className="text-xs text-purple-600 mb-2">✨ 개인화 적용 예시 (상위 3명 샘플)</div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { '이름': '김민수', '포인트': '12,500', '등급': 'VIP', '매장명': '강남점', '지역': '서울', '구매금액': '350,000', '구매횟수': '8', '평균주문금액': '43,750', 'LTV점수': '85' },
                    { '이름': '이영희', '포인트': '8,200', '등급': 'GOLD', '매장명': '홍대점', '지역': '경기', '구매금액': '180,000', '구매횟수': '5', '평균주문금액': '36,000', 'LTV점수': '62' },
                    { '이름': '박지현', '포인트': '25,800', '등급': 'VIP', '매장명': '부산센텀점', '지역': '부산', '구매금액': '520,000', '구매횟수': '12', '평균주문금액': '43,300', 'LTV점수': '91' },
                  ].map((sample, idx) => {
                    let msg = wrapAdText(aiResult?.messages?.[selectedAiMsgIdx]?.message_text || '');
                    Object.entries(sample).forEach(([varName, value]) => {
                      msg = msg.replace(new RegExp(`%${varName}%`, 'g'), value);
                    });
                    return (
                      <div key={idx} className="rounded-2xl border-2 border-gray-200 overflow-hidden bg-white">
                        <div className="bg-gray-100 px-3 py-1.5 text-xs text-gray-500 text-center">샘플 {idx + 1}</div>
                        <div className="p-3 text-xs leading-relaxed whitespace-pre-wrap bg-gray-50" style={{ minHeight: '120px', maxHeight: '200px', overflowY: 'auto' }}>
                          {msg}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="bg-gray-100 rounded-lg p-4 whitespace-pre-wrap text-sm">
                {wrapAdText(aiResult?.messages?.[selectedAiMsgIdx]?.message_text || '') || '메시지 없음'}
              </div>
            )}
          </div>

          {/* MMS 이미지 미리보기 */}
          {mmsUploadedImages.length > 0 && (
            <div>
              <div className="text-sm text-gray-600 mb-2">🖼️ MMS 미리보기</div>
              <div className="flex justify-center">
                <div className="rounded-[1.8rem] p-[3px] bg-gradient-to-b from-purple-400 to-purple-600 shadow-lg shadow-purple-200">
                  <div className="bg-white rounded-[1.6rem] overflow-hidden flex flex-col w-[280px]" style={{ height: '420px' }}>
                    <div className="px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100 flex justify-between items-center shrink-0 border-b">
                      <span className="text-[11px] text-gray-400 font-medium">문자메시지</span>
                      <span className="text-[11px] font-bold text-purple-600">{useIndividualCallback ? '매장번호' : (selectedCallback || '회신번호')}</span>
                    </div>
                    {selectedChannel === 'LMS' || selectedChannel === 'MMS' ? (
                      <div className="px-4 py-2 bg-orange-50 border-b border-orange-200 shrink-0">
                        <span className="text-sm font-bold text-orange-700">{aiResult?.messages?.[selectedAiMsgIdx]?.subject || 'LMS 제목'}</span>
                      </div>
                    ) : null}
                    <div className="flex-1 overflow-y-auto p-3 bg-gradient-to-b from-purple-50/30 to-white">
                      {mmsUploadedImages.map((img, idx) => (
                        <img key={idx} src={img.url} alt="" className="w-full h-auto rounded mb-1.5" />
                      ))}
                      <div className="flex gap-2 mt-1">
                        <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center shrink-0 text-xs">📱</div>
                        <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm border border-gray-100 text-[13px] leading-[1.7] whitespace-pre-wrap text-gray-700 max-w-[95%]">
                        {wrapAdText(aiResult?.messages?.[selectedAiMsgIdx]?.message_text || '') || '메시지 없음'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="text-xs text-amber-600 bg-amber-50 rounded-lg p-2 mt-2 text-center">
                ⚠️ 실제 수신 화면은 이통사 및 휴대폰 기종에 따라 다르게 보일 수 있습니다
              </div>
            </div>
          )}

        </div>

        <div className="p-6 border-t space-y-3">
          {testSentResult && (
            <div className={`p-3 rounded-lg text-sm whitespace-pre-wrap mb-3 ${testSentResult.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {testSentResult}
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => { onClose(); }}
              className="flex-1 py-3 border rounded-lg text-gray-600 hover:bg-gray-100"
            >
              ← 돌아가기
            </button>
            <button
              onClick={handleTestSend}
              disabled={testSending || testCooldown}
              className="flex-1 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
            >
              {testSending ? '📱 발송 중...' : testCooldown ? '⏳ 10초 대기' : '📱 담당자 사전수신'}
            </button>
            <button
              onClick={() => {
                const toast = document.createElement('div');
                toast.innerHTML = `
                  <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:24px 32px;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,0.2);z-index:9999;text-align:center;">
                    <div style="font-size:48px;margin-bottom:12px;">🚧</div>
                    <div style="font-size:16px;font-weight:bold;color:#374151;margin-bottom:8px;">준비 중인 기능입니다</div>
                    <div style="font-size:14px;color:#6B7280;">스팸필터테스트는 곧 업데이트됩니다</div>
                  </div>
                  <div style="position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:9998;" onclick="this.parentElement.remove()"></div>
                `;
                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 2000);
              }}
              className="flex-1 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
            >
              🛡️ 스팸필터
            </button>
            <button
              onClick={() => { onClose(); setShowAiSendModal(true); }}
              className="flex-1 py-3 bg-green-700 text-white rounded-lg hover:bg-green-800"
            >
              ✅ 캠페인확정
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
