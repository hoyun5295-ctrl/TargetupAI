import { useState, useEffect } from 'react';
import { API_BASE } from '../App';

interface CampaignResult {
  id: string;
  campaign_name: string;
  message_type: string;
  total_sent: number;
  total_success: number;
  total_failed: number;
  status: string;
  created_at: string;
}

interface FlyerStat {
  id: string;
  title: string;
  short_code: string;
  click_count: number;
  status: string;
  created_at: string;
}

export default function ResultsPage({ token }: { token: string }) {
  const [tab, setTab] = useState<'send' | 'flyer'>('send');
  const [campaigns, setCampaigns] = useState<CampaignResult[]>([]);
  const [flyerStats, setFlyerStats] = useState<FlyerStat[]>([]);
  const [loading, setLoading] = useState(true);

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // 발송 결과
        const campRes = await fetch(`${API_BASE}/api/v1/results?limit=30`, { headers });
        if (campRes.ok) {
          const data = await campRes.json();
          setCampaigns(data.campaigns || data.results || []);
        }

        // 전단지 클릭 통계
        const flyerRes = await fetch(`${API_BASE}/api/flyer/flyers`, { headers });
        if (flyerRes.ok) {
          const all = await flyerRes.json();
          setFlyerStats(all.filter((f: FlyerStat) => f.status === 'published'));
        }
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    })();
  }, [token]);

  const fmtDate = (d: string) => { const dt = new Date(d); return `${dt.getFullYear()}.${dt.getMonth()+1}.${dt.getDate()}`; };

  return (
    <>
      <h2 className="text-lg font-bold text-gray-800 mb-6">결과</h2>

      {/* 탭 */}
      <div className="flex gap-1 mb-6">
        <button onClick={() => setTab('send')} className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${tab === 'send' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>발송 결과</button>
        <button onClick={() => setTab('flyer')} className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${tab === 'flyer' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>전단지 클릭</button>
      </div>

      {loading ? <div className="text-center py-20 text-gray-400">로딩 중...</div> : (
        <>
          {/* 발송 결과 */}
          {tab === 'send' && (
            campaigns.length === 0 ? (
              <div className="text-center py-16 text-gray-500">발송 내역이 없습니다</div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">캠페인</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">타입</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">발송</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">성공</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">실패</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">날짜</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map(c => (
                      <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-800">{c.campaign_name || '직접발송'}</td>
                        <td className="px-4 py-3 text-center text-gray-500">{c.message_type || 'SMS'}</td>
                        <td className="px-4 py-3 text-center font-medium">{c.total_sent}</td>
                        <td className="px-4 py-3 text-center text-green-600 font-medium">{c.total_success}</td>
                        <td className="px-4 py-3 text-center text-red-500 font-medium">{c.total_failed}</td>
                        <td className="px-4 py-3 text-center text-gray-400">{fmtDate(c.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* 전단지 클릭 통계 */}
          {tab === 'flyer' && (
            flyerStats.length === 0 ? (
              <div className="text-center py-16 text-gray-500">발행된 전단지가 없습니다</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {flyerStats.map(f => (
                  <div key={f.id} className="bg-white rounded-xl border border-gray-200 p-4">
                    <h3 className="font-bold text-gray-800 mb-1">{f.title}</h3>
                    <p className="text-xs text-gray-400 mb-3">{fmtDate(f.created_at)}</p>
                    <div className="flex items-center justify-between">
                      <code className="text-xs bg-gray-100 px-2 py-1 rounded">hanjul-flyer.kr/{f.short_code}</code>
                      <span className="text-lg font-bold text-blue-600">👆 {f.click_count || 0}</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </>
      )}
    </>
  );
}
