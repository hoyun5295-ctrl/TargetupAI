interface CampaignSuccessModalProps {
  show: boolean;
  onClose: () => void;
  onShowCalendar: () => void;
  selectedChannel: string;
  aiResult: any;
  successSendInfo: string;
}

export default function CampaignSuccessModal({ show, onClose, onShowCalendar, selectedChannel, aiResult, successSendInfo }: CampaignSuccessModalProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[400px] text-center p-8">
        <div className="text-6xl mb-4">🎉</div>
        <h3 className="text-xl font-bold text-gray-800 mb-2">캠페인이 확정되었습니다!</h3>
         <div className="bg-green-50 rounded-lg p-4 mb-6 text-left">
         <div className="text-sm text-gray-600 space-y-1">
            <div>{selectedChannel === 'KAKAO' ? '💬' : '📱'} 채널: <span className="font-medium">{selectedChannel === 'KAKAO' ? '카카오' : selectedChannel}</span></div>
            <div>👥 대상: <span className="font-medium">{aiResult?.target?.count?.toLocaleString() || 0}명</span></div>
            {aiResult?.target?.unsubscribeCount > 0 && (
              <div>🚫 수신거부 제외: <span className="font-medium text-rose-500">{aiResult?.target?.unsubscribeCount?.toLocaleString()}명</span></div>
            )}
            <div>⏰ 발송: <span className="font-medium">{successSendInfo}</span></div>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onShowCalendar}
            className="flex-1 py-3 border rounded-lg text-gray-600 hover:bg-gray-100"
          >
            📅 캘린더 확인
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-green-700 text-white rounded-lg hover:bg-green-800"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
