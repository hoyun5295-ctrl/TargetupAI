interface LmsConvertModalProps {
  show: boolean;
  onClose: () => void;
  pendingBytes: number;
  showTargetSend: boolean;
  targetMessage: string;
  directMessage: string;
  targetMsgType: string;
  directMsgType: string;
  targetRecipients: any[];
  directRecipients: any[];
  adTextEnabled: boolean;
  optOutNumber: string;
  onSmsOverride: () => void;
  onLmsConvert: () => void;
  getMaxByteMessage: (msg: string, recipients: any[], variableMap: Record<string, string>) => string;
  calculateBytes: (str: string) => number;
  truncateToSmsBytes: (str: string, maxBytes: number) => string;
  formatRejectNumber?: (num: string) => string;
}

export function LmsConvertModal({
  show, onClose, pendingBytes, showTargetSend,
  targetMessage, directMessage, targetMsgType, directMsgType,
  targetRecipients, directRecipients, adTextEnabled, optOutNumber,
  onSmsOverride, onLmsConvert,
  getMaxByteMessage, calculateBytes, truncateToSmsBytes
}: LmsConvertModalProps) {
  if (!show) return null;

  // 현재 활성 발송 모드의 풀 메시지 계산
  const activeMsg = showTargetSend ? targetMessage : directMessage;
  const activeMsgType = showTargetSend ? targetMsgType : directMsgType;
  const activeRecipients = showTargetSend ? targetRecipients : directRecipients;
  const activeVarMap: Record<string, string> = showTargetSend
    ? { '%이름%': 'name', '%등급%': 'grade', '%지역%': 'region', '%구매금액%': 'total_purchase_amount', '%회신번호%': 'callback' }
    : { '%이름%': 'name', '%기타1%': 'extra1', '%기타2%': 'extra2', '%기타3%': 'extra3', '%회신번호%': 'callback' };
  let fullMsg = getMaxByteMessage(activeMsg, activeRecipients, activeVarMap);
  
  const optOutText = activeMsgType === 'SMS'
    ? `무료거부${optOutNumber.replace(/-/g, '')}`
    : `무료수신거부 ${optOutNumber}`;
  if (adTextEnabled) {
    const adPrefix = activeMsgType === 'SMS' ? '(광고)' : '(광고) ';
    fullMsg = `${adPrefix}${fullMsg}\n${optOutText}`;
  }

  const truncated = truncateToSmsBytes(fullMsg, 90);
  const truncatedBytes = calculateBytes(truncated);
  const isOptOutCut = adTextEnabled && !truncated.includes(optOutText);
  const isAdBlocked = adTextEnabled && isOptOutCut;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70]">
      <div className="bg-white rounded-xl shadow-2xl w-[440px] overflow-hidden">
        <div className="p-6 bg-gradient-to-r from-amber-50 to-orange-50 border-b">
          <div className="text-center relative">
            <button onClick={onClose} className="absolute right-0 top-0 text-gray-400 hover:text-gray-600 text-xl">✕</button>
            <div className="text-5xl mb-3">📝</div>
            <h3 className="text-lg font-bold text-gray-800">메시지 길이 초과</h3>
          </div>
        </div>
        <div className="p-6">
          <div className="text-center mb-4">
            <div className="text-3xl font-bold text-red-500 mb-1">{pendingBytes} <span className="text-lg text-gray-400">/ 90 byte</span></div>
            <div className="text-gray-600">SMS 제한을 초과했습니다</div>
          </div>

          {/* 잘린 메시지 미리보기 */}
          <div className="mb-4">
            <div className="text-xs font-medium text-gray-500 mb-1.5">SMS 발송 시 수신 내용 ({truncatedBytes}/90 byte)</div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
              {truncated}
              <span className="text-red-400 bg-red-50 px-0.5">···(잘림)</span>
            </div>
          </div>

          {/* 광고 문자 수신거부 잘림 경고 */}
          {isAdBlocked && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <div className="flex items-start gap-2">
                <span className="text-red-500 text-lg leading-none mt-0.5">⛔</span>
                <div>
                  <div className="text-sm font-semibold text-red-700">수신거부 번호가 잘립니다</div>
                  <div className="text-xs text-red-600 mt-0.5">
                    광고 문자는 수신거부 번호를 반드시 포함해야 합니다 (정보통신망법 제50조).<br/>
                    SMS로 발송할 수 없습니다. LMS로 전환해주세요.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 비광고 잘림 경고 */}
          {!isAdBlocked && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              <div className="flex items-start gap-2">
                <span className="text-amber-500 text-lg leading-none mt-0.5">⚠️</span>
                <div className="text-xs text-amber-700">
                  SMS로 발송하면 90바이트 이후 내용이 잘려서 수신됩니다.
                </div>
              </div>
            </div>
          )}

          <div className="bg-blue-50 rounded-lg p-4 mb-4">
            <div className="text-sm text-blue-800">
              <div className="font-medium mb-1">💡 LMS로 전환하시겠습니까?</div>
              <div className="text-blue-600">LMS는 최대 2,000byte까지 발송 가능합니다</div>
            </div>
          </div>
          <div className="flex gap-3">
            {isAdBlocked ? (
              <button
                disabled
                className="flex-1 py-3 border-2 border-gray-200 rounded-lg text-gray-400 font-medium cursor-not-allowed bg-gray-50"
              >SMS 발송 불가</button>
            ) : (
              <button
                onClick={onSmsOverride}
                className="flex-1 py-3 border-2 border-amber-300 rounded-lg text-amber-700 font-medium hover:bg-amber-50"
              >SMS 유지 (잘림 발송)</button>
            )}
            <button
              onClick={onLmsConvert}
              className="flex-1 py-3 bg-green-700 text-white rounded-lg font-medium hover:bg-green-800"
            >LMS 전환</button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SmsConvertModalProps {
  show: boolean;
  showSmsConvert: {
    show: boolean;
    from: 'direct' | 'target';
    currentBytes: number;
    smsBytes: number;
    count: number;
  };
  onClose: () => void;
  onSmsConvert: () => void;
}

export function SmsConvertModal({ show, showSmsConvert, onClose, onSmsConvert }: SmsConvertModalProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70]">
      <div className="bg-white rounded-xl shadow-2xl w-[420px] overflow-hidden">
        <div className="p-6 bg-gradient-to-r from-blue-50 to-emerald-50 border-b">
          <div className="text-center">
            <div className="text-5xl mb-3">💰</div>
            <h3 className="text-lg font-bold text-gray-800">비용 절감 안내</h3>
          </div>
        </div>
        <div className="p-6">
          <div className="text-center mb-4">
            <div className="text-sm text-gray-600 mb-2">SMS로 발송하면 비용이 절감됩니다!</div>
            <div className="flex items-center justify-center gap-3 text-lg">
              <span className="text-gray-500">{showSmsConvert.currentBytes}byte</span>
              <span className="text-gray-400">→</span>
              <span className="font-bold text-emerald-600">{showSmsConvert.smsBytes}byte</span>
            </div>
          </div>
          
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <div className="text-sm text-gray-600 mb-3 text-center">예상 비용 비교 ({showSmsConvert.count.toLocaleString()}건 기준)</div>
            <div className="flex justify-between items-center">
              <div className="text-center flex-1">
                <div className="text-xs text-gray-500 mb-1">LMS (27원/건)</div>
                <div className="text-lg font-bold text-gray-700">{(showSmsConvert.count * 27).toLocaleString()}원</div>
              </div>
              <div className="text-2xl text-gray-300 px-4">→</div>
              <div className="text-center flex-1">
                <div className="text-xs text-gray-500 mb-1">SMS (10원/건)</div>
                <div className="text-lg font-bold text-emerald-600">{(showSmsConvert.count * 10).toLocaleString()}원</div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-gray-200 text-center">
              <span className="text-sm text-gray-600">절감 금액: </span>
              <span className="text-lg font-bold text-red-500">{((showSmsConvert.count * 27) - (showSmsConvert.count * 10)).toLocaleString()}원</span>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 border-2 border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50"
            >LMS 유지</button>
            <button
              onClick={onSmsConvert}
              className="flex-1 py-3 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700"
            >SMS 전환</button>
          </div>
        </div>
      </div>
    </div>
  );
}
