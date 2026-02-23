import { formatDateTime } from '../utils/formatDate';

interface RecentCampaignModalProps {
  show: boolean;
  onClose: () => void;
  recentCampaigns: any[];
}

export default function RecentCampaignModal({ show, onClose, recentCampaigns }: RecentCampaignModalProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[80vh] overflow-hidden">
        <div className="p-4 border-b bg-blue-50 flex justify-between items-center">
          <h3 className="font-bold text-lg">📊 최근 캠페인</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
        </div>
        <div className="p-4 overflow-y-auto max-h-[60vh]">
          {recentCampaigns.length > 0 ? (
            <div className="space-y-3">
              {recentCampaigns.map((c: any) => (
                <div key={c.id} className="p-4 border rounded-lg hover:border-blue-400 transition-all">
                  <div className="flex justify-between items-start mb-2">
                    <div className="font-semibold text-gray-800">{c.campaign_name}</div>
                    <span className={`px-2 py-1 rounded text-xs ${
                      c.status === 'completed' ? 'bg-amber-100 text-amber-700' :
                      c.status === 'scheduled' ? 'bg-pink-100 text-pink-700' :
                      c.status === 'sending' ? 'bg-yellow-100 text-yellow-700' :
                      c.status === 'cancelled' ? 'bg-gray-200 text-gray-500' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {c.status === 'completed' ? '완료' : c.status === 'scheduled' ? '예약' : c.status === 'sending' ? '발송중' : c.status === 'cancelled' ? '취소' : '준비'}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500 space-y-1">
                    <div>
                      {c.send_type === 'direct' ? '📤' : '🤖'} 
                      <span className={`ml-1 text-xs px-1.5 py-0.5 rounded ${c.send_type === 'direct' ? 'bg-emerald-100 text-emerald-700' : 'bg-purple-100 text-purple-700'}`}>
                        {c.send_type === 'direct' ? '직접' : 'AI'}
                      </span>
                      <span className="ml-2">📱 {c.message_type} · 👥 {c.target_count?.toLocaleString()}명</span>
                    </div>
                    <div>✅ 성공 {c.success_count?.toLocaleString() || 0} · ❌ 실패 {c.fail_count?.toLocaleString() || 0}</div>
                    <div className="text-xs text-gray-400">{formatDateTime(c.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">최근 캠페인이 없습니다</p>
          )}
        </div>
      </div>
    </div>
  );
}
