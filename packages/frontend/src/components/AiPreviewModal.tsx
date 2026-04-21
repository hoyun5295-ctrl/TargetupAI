import React from 'react';
import { replaceVarsBySampleCustomer, calculateSmsBytes, buildAdSubjectFront } from '../utils/formatDate';
import { getMmsImageDisplayName } from '../utils/mmsImage';

interface AiPreviewModalProps {
  show: boolean;
  onClose: () => void;
  aiResult: any;
  selectedChannel: string;
  selectedAiMsgIdx: number;
  useIndividualCallback: boolean;
  selectedCallback: string;
  mmsUploadedImages: {serverPath: string; url: string; filename: string; originalName?: string; size: number}[];
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

export default function AiPreviewModal(props: AiPreviewModalProps) {
  const {
    show,
    onClose,
    aiResult,
    selectedChannel,
    selectedAiMsgIdx,
    useIndividualCallback,
    selectedCallback,
    mmsUploadedImages,
    wrapAdText,
    sampleCustomer,
    isAd,
  } = props;

  if (!show) return null;

  const sc = sampleCustomer || {};
  const hasSample = Object.keys(sc).length > 0;
  const rawMsg = aiResult?.messages?.[selectedAiMsgIdx]?.message_text || '';
  const wrappedMsg = wrapAdText(rawMsg);
  const displayMsg = hasSample
    ? replaceVarsBySampleCustomer(wrappedMsg, sc, {
        removeUnmatched: true,
        aliasMap: {
          '이름': ['고객명', '성함', '고객이름'],
          '고객등급': ['등급', '멤버십등급', '회원등급'],
          '등록매장정보': ['매장명', '매장', '지점', '등록매장'],
          '최근구매매장': ['구매매장', '최근매장'],
          '보유포인트': ['포인트', '적립금'],
          '최근구매금액': ['구매금액', '구매액'],
          '누적구매금액': ['총구매금액', '총구매액', '누적구매'],
        },
      })
    : wrappedMsg;
  const msgBytes = calculateSmsBytes(displayMsg);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-4 border-b bg-emerald-50 flex justify-between items-center">
          <h3 className="font-bold text-lg">📱 메시지 미리보기</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
        </div>
        <div className="p-4">
          {/* 폰 프레임 */}
          <div className="mx-auto w-[280px]">
            <div className="rounded-[1.8rem] p-[3px] bg-gradient-to-b from-purple-400 to-purple-600 shadow-lg shadow-purple-200">
              <div className="bg-white rounded-[1.6rem] overflow-hidden flex flex-col" style={{ height: '420px' }}>
                {/* 폰 헤더 */}
                <div className="px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100 flex justify-between items-center shrink-0 border-b">
                  <span className="text-[11px] text-gray-400 font-medium">문자메시지</span>
                  <span className="text-[11px] font-bold text-purple-600">
                    {useIndividualCallback ? '수신자별' : (selectedCallback || '회신번호')}
                  </span>
                </div>
                {/* LMS/MMS 제목 */}
                {(selectedChannel === 'LMS' || selectedChannel === 'MMS') && (
                  <div className="px-4 py-2 bg-orange-50 border-b border-orange-200 shrink-0">
                    <span className="text-sm font-bold text-orange-700">
                      {buildAdSubjectFront(aiResult?.messages?.[selectedAiMsgIdx]?.subject || 'LMS 제목', selectedChannel, isAd ?? true)}
                    </span>
                  </div>
                )}
                {/* 메시지 영역 */}
                <div className="flex-1 overflow-y-auto p-3 bg-gradient-to-b from-purple-50/30 to-white">
                  {/* MMS 이미지 — B3(0417 PDF #3): 파일명 hover 툴팁 */}
                  {mmsUploadedImages.length > 0 && (
                    <div className="mb-2">
                      {mmsUploadedImages.map((img: any, idx: number) => {
                        const fname = getMmsImageDisplayName(img, `이미지${idx + 1}`);
                        return (
                          <img
                            key={idx}
                            src={img.url}
                            alt={fname}
                            title={fname}
                            className="w-full h-auto rounded border border-purple-200 mb-1"
                            style={{ maxHeight: '160px', objectFit: 'cover' }}
                          />
                        );
                      })}
                    </div>
                  )}
                  <div className="flex gap-2 mt-1">
                    <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center shrink-0 text-xs">📱</div>
                    <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm border border-gray-100 text-[12px] leading-[1.6] whitespace-pre-wrap break-all text-gray-700 max-w-[95%]">
                      {displayMsg || '메시지 없음'}
                    </div>
                  </div>
                </div>
                {/* 바이트 표시 */}
                <div className="px-3 py-2 border-t bg-gray-50 text-center shrink-0">
                  <span className="text-[10px] text-gray-400">
                    {msgBytes} / {selectedChannel === 'SMS' ? 90 : 2000} bytes
                  </span>
                </div>
              </div>
            </div>
          </div>
          {/* 샘플 고객 정보 */}
          {hasSample && (
            <div className="mt-3 p-2 bg-purple-50 rounded-lg">
              <div className="text-[10px] text-purple-600 font-medium">✨ 실제 타겟 고객 데이터 기반 미리보기</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
