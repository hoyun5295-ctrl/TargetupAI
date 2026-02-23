interface Stats {
  total: string;
  sms_opt_in_count: string;
  male_count: string;
  female_count: string;
  vip_count: string;
  age_under20: string;
  age_20s: string;
  age_30s: string;
  age_40s: string;
  age_50s: string;
  age_60plus: string;
}

interface CustomerInsightModalProps {
  show: boolean;
  onClose: () => void;
  stats: Stats | null;
}

export default function CustomerInsightModal({ show, onClose, stats }: CustomerInsightModalProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[800px] max-h-[90vh] overflow-hidden">
        <div className="p-4 border-b bg-green-50 flex justify-between items-center">
          <h3 className="font-bold text-lg">👥 고객 인사이트</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[80vh] space-y-6">
          {/* 전체 고객 */}
          <div className="p-6 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl text-center">
            <div className="text-sm text-gray-500 mb-2">전체 고객</div>
            <div className="text-4xl font-bold text-gray-800">{parseInt(stats?.total || '0').toLocaleString()}명</div>
            <div className="text-sm text-green-600 mt-2">수신동의: {parseInt(stats?.sms_opt_in_count || '0').toLocaleString()}명</div>
          </div>

          {/* 성별별 현황 */}
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-3">성별별 현황</div>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-blue-50 rounded-lg text-center">
                <div className="text-2xl mb-2">👨</div>
                <div className="text-2xl font-bold text-blue-600">{parseInt(stats?.male_count || '0').toLocaleString()}명</div>
                <div className="text-xs text-gray-500 mt-1">남성</div>
              </div>
              <div className="p-4 bg-pink-50 rounded-lg text-center">
                <div className="text-2xl mb-2">👩</div>
                <div className="text-2xl font-bold text-pink-600">{parseInt(stats?.female_count || '0').toLocaleString()}명</div>
                <div className="text-xs text-gray-500 mt-1">여성</div>
              </div>
            </div>
          </div>

          {/* 연령대별 고객분포 */}
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-3">연령대별 고객분포</div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-purple-50 rounded-lg text-center">
                  <div className="text-2xl font-bold text-purple-600">{parseInt(stats?.age_under20 || '0').toLocaleString()}명</div>
                  <div className="text-xs text-gray-500 mt-1">~19세</div>
                </div>
                <div className="p-4 bg-indigo-50 rounded-lg text-center">
                  <div className="text-2xl font-bold text-indigo-600">{parseInt(stats?.age_20s || '0').toLocaleString()}명</div>
                  <div className="text-xs text-gray-500 mt-1">20대</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-cyan-50 rounded-lg text-center">
                  <div className="text-2xl font-bold text-cyan-600">{parseInt(stats?.age_30s || '0').toLocaleString()}명</div>
                  <div className="text-xs text-gray-500 mt-1">30대</div>
                </div>
                <div className="p-4 bg-teal-50 rounded-lg text-center">
                  <div className="text-2xl font-bold text-teal-600">{parseInt(stats?.age_40s || '0').toLocaleString()}명</div>
                  <div className="text-xs text-gray-500 mt-1">40대</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-orange-50 rounded-lg text-center">
                  <div className="text-2xl font-bold text-orange-600">{parseInt(stats?.age_50s || '0').toLocaleString()}명</div>
                  <div className="text-xs text-gray-500 mt-1">50대</div>
                </div>
                <div className="p-4 bg-red-50 rounded-lg text-center">
                  <div className="text-2xl font-bold text-red-600">{parseInt(stats?.age_60plus || '0').toLocaleString()}명</div>
                  <div className="text-xs text-gray-500 mt-1">60대 이상</div>
                </div>
              </div>
            </div>
          </div>

          {/* 고객등급별 현황 */}
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-3">고객등급별 현황</div>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-yellow-50 rounded-lg text-center">
                <div className="text-2xl mb-2">⭐</div>
                <div className="text-2xl font-bold text-yellow-600">{parseInt(stats?.vip_count || '0').toLocaleString()}명</div>
                <div className="text-xs text-gray-500 mt-1">VIP</div>
              </div>
              <div className="p-4 bg-gray-100 rounded-lg text-center">
                <div className="text-2xl mb-2">👤</div>
                <div className="text-2xl font-bold text-gray-600">{(parseInt(stats?.total || '0') - parseInt(stats?.vip_count || '0')).toLocaleString()}명</div>
                <div className="text-xs text-gray-500 mt-1">일반</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
