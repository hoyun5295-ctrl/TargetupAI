import React from 'react';
import { formatPreviewValue, buildAdMessageFront, replaceVarsBySampleCustomer } from '../utils/formatDate';

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
  sampleCustomer?: Record<string, string>;
  setSpamFilterData?: (data: any) => void;
  setShowSpamFilter?: (v: boolean) => void;
  optOutNumber?: string;
  isAd?: boolean;
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
  sampleCustomer,
  setSpamFilterData,
  setShowSpamFilter,
  optOutNumber = '',
  isAd = false,
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
            <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded font-medium">{selectedChannel}</span>
          </div>

          {/* 회신번호 */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">📞 회신번호:</span>
            <span className="font-medium">
              {useIndividualCallback ? '수신자별 회신번호 칼럼 사용' : (selectedCallback || '미선택')}
            </span>
          </div>

          {/* 메시지 미리보기 - 개인화 샘플 */}
          <div>
            <div className="text-sm text-gray-600 mb-2">💬 메시지 내용</div>
            {aiResult?.usePersonalization && aiResult?.personalizationVars?.length > 0 ? (
              (() => {
                // sampleCustomer(백엔드 실제 데이터) 기반 변수 치환 + AI 변수명↔displayName 별칭 매핑
                const aliasMap: Record<string, string[]> = {
                  '이름': ['고객명', '성함', '고객이름'],
                  '고객등급': ['등급', '멤버십등급', '회원등급'],
                  '등록매장정보': ['매장명', '매장', '지점', '등록매장'],
                  '최근구매매장': ['구매매장', '최근매장'],
                  '보유포인트': ['포인트', '적립금'],
                  '최근구매금액': ['구매금액', '구매액'],
                  '누적구매금액': ['총구매금액', '총구매액', '누적구매'],
                };
                const replaceAllVars = (text: string, data: Record<string, string>) => {
                  if (!text || !data) return text;
                  let result = text;
                  // 1차: 직접 매칭 (sampleCustomer 키 = AI 변수명)
                  Object.entries(data).forEach(([k, v]) => {
                    result = result.replace(new RegExp(`%${k}%`, 'g'), formatPreviewValue(v));
                  });
                  // 2차: 별칭 매핑 (AI가 다른 변수명 사용 시 → sampleCustomer의 실제 키로 폴백)
                  Object.entries(aliasMap).forEach(([realKey, aliases]) => {
                    const val = data[realKey];
                    if (!val) return;
                    aliases.forEach(alias => {
                      result = result.replace(new RegExp(`%${alias}%`, 'g'), formatPreviewValue(val));
                    });
                  });
                  // 역방향: AI가 displayName 사용, sampleCustomer에 별칭으로 존재하는 경우
                  Object.entries(aliasMap).forEach(([realKey, aliases]) => {
                    for (const alias of aliases) {
                      const val = data[alias];
                      if (!val) continue;
                      result = result.replace(new RegExp(`%${realKey}%`, 'g'), formatPreviewValue(val));
                      break;
                    }
                  });
                  // 남은 %변수% 제거
                  result = result.replace(/%[^%\s]{1,20}%/g, '');
                  return result;
                };
                const sc = sampleCustomer || {};
                const hasSample = Object.keys(sc).length > 0;
                return (
              <div>
                <div className="text-xs text-purple-600 mb-2">✨ 개인화 적용 예시 {hasSample ? '(실제 고객 데이터 기반)' : ''}</div>
                <div>
                  {hasSample ? (
                    <div className="rounded-2xl border-2 border-purple-200 overflow-hidden bg-white">
                      <div className="bg-purple-50 px-3 py-1.5 text-xs text-purple-500 text-center">실제 고객 샘플</div>
                      <div className="p-3 text-xs leading-relaxed whitespace-pre-wrap bg-gray-50" style={{ minHeight: '120px', maxHeight: '200px', overflowY: 'auto' }}>
                        {replaceAllVars(wrapAdText(aiResult?.messages?.[selectedAiMsgIdx]?.message_text || ''), sc)}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-center">
                      <div className="text-amber-600 font-medium text-sm mb-1">등록된 고객 데이터가 없습니다</div>
                      <div className="text-amber-500 text-xs">고객 DB에 데이터를 업로드하시면 실제 고객 정보 기반의 개인화 미리보기를 확인할 수 있습니다.</div>
                    </div>
                  )}
                </div>
              </div>
                );
              })()
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
                      <span className="text-[11px] font-bold text-purple-600">{useIndividualCallback ? '수신자별 회신번호' : (selectedCallback || '회신번호')}</span>
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
          {/* ★ B-D75-02: 발송 대상 0명일 때 경고 */}
          {(aiResult?.target?.count || 0) === 0 && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-center">
              <div className="text-rose-600 font-medium text-sm">발송 대상이 0명입니다</div>
              <div className="text-rose-500 text-xs mt-1">고객 DB에 데이터를 업로드하거나, 타겟 조건을 수정해주세요.</div>
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
              disabled={testSending || testCooldown || (aiResult?.target?.count || 0) === 0}
              className="flex-1 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
            >
              {testSending ? '📱 발송 중...' : testCooldown ? '⏳ 10초 대기' : '📱 담당자 사전수신'}
            </button>
            <button
              disabled={(aiResult?.target?.count || 0) === 0}
              onClick={() => {
                if (setSpamFilterData && setShowSpamFilter) {
                  const msg = aiResult?.messages?.[selectedAiMsgIdx]?.message_text || '';
                  const cb = selectedCallback || '';
                  const sc = sampleCustomer || {};
                  // ★ B+0407-1: 인라인 제거 — replaceVarsBySampleCustomer 컨트롤타워 + aliasMap 옵션
                  const replaceVars = (text: string) => replaceVarsBySampleCustomer(text, sc, {
                    removeUnmatched: true,
                    aliasMap: {
                      '이름': ['고객명', '성함'],
                      '고객등급': ['등급'],
                      '등록매장정보': ['매장명', '매장'],
                      '보유포인트': ['포인트'],
                      '최근구매매장': ['구매매장'],
                    },
                  });
                  const smsRaw = buildAdMessageFront(msg, 'SMS', isAd, optOutNumber);
                  const lmsRaw = buildAdMessageFront(msg, 'LMS', isAd, optOutNumber);
                  const subj = aiResult?.messages?.[selectedAiMsgIdx]?.subject || '';
                  setSpamFilterData({ sms: replaceVars(smsRaw), lms: replaceVars(lmsRaw), callback: cb, msgType: selectedChannel as any, subject: subj, firstRecipient: sc });
                  setShowSpamFilter(true);
                }
              }}
              className="flex-1 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
            >
              🛡️ 스팸필터
            </button>
            <button
              onClick={() => { onClose(); setShowAiSendModal(true); }}
              disabled={(aiResult?.target?.count || 0) === 0}
              className="flex-1 py-3 bg-green-700 text-white rounded-lg hover:bg-green-800 disabled:opacity-50"
            >
              ✅ 캠페인확정
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
