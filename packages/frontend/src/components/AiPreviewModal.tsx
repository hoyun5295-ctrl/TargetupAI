import { Eye, X, Sparkles, Smartphone } from 'lucide-react';
import { replaceVarsBySampleCustomer, calculateSmsBytes, buildAdSubjectFront } from '../utils/formatDate';
import MmsImagePreview from './shared/MmsImagePreview';

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

const VARIABLE_ALIAS_MAP = {
  '이름': ['고객명', '성함', '고객이름'],
  '고객등급': ['등급', '멤버십등급', '회원등급'],
  '등록매장정보': ['매장명', '매장', '지점', '등록매장'],
  '최근구매매장': ['구매매장', '최근매장'],
  '보유포인트': ['포인트', '적립금'],
  '최근구매금액': ['구매금액', '구매액'],
  '누적구매금액': ['총구매금액', '총구매액', '누적구매'],
};

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
        aliasMap: VARIABLE_ALIAS_MAP,
      })
    : wrappedMsg;
  const msgBytes = calculateSmsBytes(displayMsg);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-[420px] mx-4 overflow-hidden animate-in zoom-in-95 duration-200 max-md:fixed max-md:inset-0 max-md:max-w-none max-md:max-h-none max-md:rounded-none">

        {/* 헤더 — sticky + emerald 그라데이션 + Eye 아이콘 */}
        <div className="sticky top-0 z-10 p-4 bg-gradient-to-r from-slate-950 via-emerald-950/40 to-slate-950 backdrop-blur-sm border-b border-white/10 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-md shadow-emerald-500/30">
              <Eye className="w-4 h-4 text-white" />
            </div>
            <h3 className="text-white font-bold text-base">메시지 미리보기</h3>
          </div>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white p-1.5 hover:bg-white/5 rounded transition-colors"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-4">
          {/* 폰 프레임 — 외곽 violet→fuchsia 그라데이션 + 메시지 영역 화이트 */}
          <div className="mx-auto w-[280px]">
            <div className="rounded-[1.8rem] p-[3px] bg-gradient-to-b from-violet-400 to-fuchsia-500 shadow-lg shadow-violet-500/30">
              <div className="bg-slate-900 rounded-[1.6rem] overflow-hidden flex flex-col" style={{ height: '420px' }}>
                {/* 폰 헤더 — 다크 톤 */}
                <div className="px-4 py-2.5 bg-gradient-to-r from-slate-950 to-violet-950/30 flex justify-between items-center shrink-0 border-b border-white/5">
                  <span className="text-[11px] text-white/40 font-medium">문자메시지</span>
                  <span className="text-[11px] font-bold text-violet-300">
                    {useIndividualCallback ? '수신자별' : (selectedCallback || '회신번호')}
                  </span>
                </div>

                {/* LMS/MMS 제목 — amber 액센트 */}
                {(selectedChannel === 'LMS' || selectedChannel === 'MMS') && (
                  <div className="px-4 py-1.5 bg-amber-500/10 border-b border-amber-400/20 shrink-0">
                    <span className="text-[11px] font-bold text-amber-300">
                      {buildAdSubjectFront(aiResult?.messages?.[selectedAiMsgIdx]?.subject || 'LMS 제목', selectedChannel, isAd ?? true)}
                    </span>
                  </div>
                )}

                {/* 메시지 영역 — 화이트 (실제 폰 시각 보존) */}
                <div className="flex-1 overflow-y-auto p-3 bg-white">
                  {mmsUploadedImages.length > 0 && (
                    <div className="mb-2">
                      <MmsImagePreview
                        images={mmsUploadedImages}
                        size="full"
                        maxHeight="160px"
                        borderColor="border border-violet-200"
                        compact
                      />
                    </div>
                  )}
                  <div className="flex gap-2 mt-1">
                    <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                      <Smartphone className="w-3.5 h-3.5 text-violet-600" />
                    </div>
                    <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm border border-gray-100 text-[12px] leading-[1.6] whitespace-pre-wrap break-all text-gray-700 max-w-[95%]">
                      {displayMsg || '메시지 없음'}
                    </div>
                  </div>
                </div>

                {/* 바이트 표시 — 다크 톤 */}
                <div className="px-3 py-2 border-t border-white/5 bg-slate-950 text-center shrink-0">
                  <span className="text-[10px] text-white/40">
                    {msgBytes} / {selectedChannel === 'SMS' ? 90 : 2000} bytes
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 샘플 고객 정보 — 다크 톤 violet 액센트 */}
          {hasSample && (
            <div className="mt-3 p-2.5 bg-violet-500/10 border border-violet-400/30 rounded-lg flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-violet-300 shrink-0" />
              <div className="text-[11px] text-violet-200 font-medium">실제 타겟 고객 데이터 기반 미리보기</div>
            </div>
          )}

          <div className="text-[10px] text-white/30 italic mt-3 text-center">
            Data source — AI 미리보기 (sample customer 치환 + buildAdMessageFront)
          </div>
        </div>
      </div>
    </div>
  );
}
