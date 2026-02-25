interface CampaignSuccessModalProps {
  show: boolean;
  onClose: () => void;
  onShowCalendar: () => void;
  selectedChannel: string;
  aiResult: any;
  successSendInfo: string;
  overrideTargetCount?: number;
  overrideUnsubscribeCount?: number;
}

export default function CampaignSuccessModal({ show, onClose, onShowCalendar, selectedChannel, aiResult, successSendInfo, overrideTargetCount, overrideUnsubscribeCount }: CampaignSuccessModalProps) {
  if (!show) return null;

  const displayCount = overrideTargetCount ?? aiResult?.target?.count ?? 0;
  const displayUnsub = overrideUnsubscribeCount ?? aiResult?.target?.unsubscribeCount ?? 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm text-center overflow-hidden animate-zoomIn">
        <div className="px-8 pt-8 pb-2">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🎉</span>
          </div>
          <h3 className="text-xl font-bold text-gray-800 mb-1">캠페인이 확정되었습니다!</h3>
          <p className="text-sm text-gray-500 mb-5">발송이 정상적으로 등록되었습니다</p>
        </div>
        <div className="mx-6 mb-6 bg-green-50 rounded-xl p-4 text-left">
          <div className="text-sm text-gray-600 space-y-2">
            <div className="flex items-center gap-2">
              <span>{selectedChannel === 'KAKAO' ? '💬' : '📱'}</span>
              <span>채널:</span>
              <span className="font-semibold text-gray-800">{selectedChannel === 'KAKAO' ? '카카오' : selectedChannel}</span>
            </div>
            <div className="flex items-center gap-2">
              <span>👥</span>
              <span>대상:</span>
              <span className="font-semibold text-gray-800">{displayCount.toLocaleString()}명</span>
            </div>
            {displayUnsub > 0 && (
              <div className="flex items-center gap-2">
                <span>🚫</span>
                <span>수신거부 제외:</span>
                <span className="font-semibold text-rose-500">{displayUnsub.toLocaleString()}명</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span>⏰</span>
              <span>발송:</span>
              <span className="font-semibold text-gray-800">{successSendInfo}</span>
            </div>
          </div>
        </div>
        <div className="flex border-t">
          <button
            onClick={onShowCalendar}
            className="flex-1 py-3.5 text-gray-600 hover:bg-gray-50 font-medium transition-colors"
          >
            📅 캘린더 확인
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-3.5 bg-green-700 text-white font-medium hover:bg-green-800 transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
