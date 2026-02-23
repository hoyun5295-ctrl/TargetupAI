interface TodayStatsModalProps {
  show: boolean;
  onClose: () => void;
  stats: {
    monthly_sent: number;
    monthly_cost: number;
    monthly_budget: number;
    success_rate: string;
    sms_sent: number;
    lms_sent: number;
    mms_sent: number;
    kakao_sent: number;
    cost_per_sms: number;
    cost_per_lms: number;
    cost_per_mms: number;
    cost_per_kakao: number;
  } | null;
  recentCampaignsCount: number;
}

export default function TodayStatsModal({ show, onClose, stats, recentCampaignsCount }: TodayStatsModalProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[800px] max-h-[85vh] overflow-hidden">
        <div className="p-4 border-b bg-orange-50 flex justify-between items-center">
          <h3 className="font-bold text-lg">📈 이번 달 통계</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[70vh] space-y-6">
          {/* 상단 요약 카드 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-6 bg-gradient-to-br from-orange-50 to-yellow-50 rounded-xl text-center">
              <div className="text-sm text-gray-500 mb-2">이번 달 총 발송</div>
              <div className="text-4xl font-bold text-orange-600">{(stats?.monthly_sent || 0).toLocaleString()}건</div>
            </div>
            <div className="p-6 bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl text-center">
              <div className="text-sm text-gray-500 mb-2">이번 달 사용금액</div>
              <div className="text-4xl font-bold text-green-600">{(stats?.monthly_cost || 0).toLocaleString()}원</div>
              <div className="text-xs text-gray-400 mt-1">예산: {(stats?.monthly_budget || 0).toLocaleString()}원</div>
            </div>
          </div>

          {/* 상세 지표 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-blue-50 rounded-lg text-center">
              <div className="text-2xl mb-2">✅</div>
              <div className="text-2xl font-bold text-blue-600">{stats?.success_rate || '0'}%</div>
              <div className="text-xs text-gray-500">평균 성공률</div>
            </div>
            <div className="p-4 bg-purple-50 rounded-lg text-center">
              <div className="text-2xl mb-2">📊</div>
              <div className="text-2xl font-bold text-purple-600">{recentCampaignsCount}건</div>
              <div className="text-xs text-gray-500">진행된 캠페인</div>
            </div>
          </div>

          {/* 채널별 통계 */}
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-3">채널별 발송</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <span className="font-medium">📱 SMS</span>
                <div className="text-right">
                  <span className="font-bold text-gray-700">{(stats?.sms_sent || 0).toLocaleString()}건</span>
                  <span className="text-xs text-gray-400 ml-2">(@{stats?.cost_per_sms || 9.9}원)</span>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <span className="font-medium">📨 LMS</span>
                <div className="text-right">
                  <span className="font-bold text-gray-700">{(stats?.lms_sent || 0).toLocaleString()}건</span>
                  <span className="text-xs text-gray-400 ml-2">(@{stats?.cost_per_lms || 27}원)</span>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <span className="font-medium">🖼️ MMS</span>
                <div className="text-right">
                  <span className="font-bold text-gray-700">{(stats?.mms_sent || 0).toLocaleString()}건</span>
                  <span className="text-xs text-gray-400 ml-2">(@{stats?.cost_per_mms || 50}원)</span>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <span className="font-medium">💬 카카오톡</span>
                <div className="text-right">
                  <span className="font-bold text-gray-700">{(stats?.kakao_sent || 0).toLocaleString()}건</span>
                  <span className="text-xs text-gray-400 ml-2">(@{stats?.cost_per_kakao || 7.5}원)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
