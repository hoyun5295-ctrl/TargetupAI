interface SendConfirmModalProps {
  sendConfirm: {
    show: boolean;
    type: 'immediate' | 'scheduled';
    count: number;
    unsubscribeCount: number;
    dateTime?: string;
    from?: 'direct' | 'target';
    msgType?: string;
  };
  setSendConfirm: (v: any) => void;
  directSending: boolean;
  executeDirectSend: () => void;
  executeTargetSend: () => void;
}

export default function SendConfirmModal({
  sendConfirm, setSendConfirm,
  directSending,
  executeDirectSend, executeTargetSend,
}: SendConfirmModalProps) {
  if (!sendConfirm.show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-xl shadow-2xl w-[420px] overflow-hidden">
        <div className={`px-6 py-4 border-b ${sendConfirm.type === 'immediate' ? 'bg-emerald-50' : 'bg-blue-50'}`}>
          <h3 className={`text-lg font-bold ${sendConfirm.type === 'immediate' ? 'text-emerald-700' : 'text-blue-700'}`}>
            {sendConfirm.type === 'immediate' ? '⚡ 즉시 발송' : '📅 예약 발송'}
          </h3>
        </div>
        <div className="p-6">
          <p className="text-gray-700 mb-4">
            {sendConfirm.type === 'immediate' 
              ? '메시지를 즉시 발송하시겠습니까?' 
              : '메시지를 예약 발송하시겠습니까?'}
          </p>
          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-500">발송 건수</span>
              <span className="font-bold text-emerald-600">{sendConfirm.count.toLocaleString()}건</span>
            </div>
            {sendConfirm.unsubscribeCount > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">수신거부 제외</span>
                <span className="font-bold text-rose-500">{sendConfirm.unsubscribeCount.toLocaleString()}건</span>
              </div>
            )}
            {sendConfirm.type === 'scheduled' && sendConfirm.dateTime && (
              <div className="flex justify-between">
                <span className="text-gray-500">예약 시간</span>
                <span className="font-bold text-blue-600">
                  {new Date(sendConfirm.dateTime).toLocaleString('ko-KR', {
                    timeZone: 'Asia/Seoul',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">메시지 타입</span>
              <span className="font-medium">{sendConfirm.msgType || 'SMS'}</span>
            </div>
            {sendConfirm.type === 'scheduled' && (
              <div className="mt-3 pt-3 border-t border-gray-200">
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <span>⚠️</span> 예약 취소는 발송 15분 전까지 가능합니다
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="flex border-t">
          <button
            onClick={() => setSendConfirm({show: false, type: 'immediate', count: 0, unsubscribeCount: 0})}
            disabled={directSending}
            className="flex-1 py-3 text-gray-600 hover:bg-gray-50 font-medium disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={() => sendConfirm.from === 'target' ? executeTargetSend() : executeDirectSend()}
            disabled={directSending}
            className={`flex-1 py-3 text-white font-medium ${sendConfirm.type === 'immediate' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-blue-500 hover:bg-blue-600'} disabled:opacity-50`}
          >
            {directSending ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">⏳</span> 처리중...
              </span>
            ) : (
              sendConfirm.type === 'immediate' ? '즉시 발송' : '예약 발송'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
