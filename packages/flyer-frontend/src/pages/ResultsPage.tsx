import { useState, useEffect } from 'react';
import { API_BASE } from '../App';
import { TabBar, DataTable, Badge, EmptyState, StatCard } from '../components/ui';

interface Campaign { id: string; campaign_name: string; message_type: string; total_sent: number; total_success: number; total_failed: number; status: string; created_at: string; }
interface FlyerStat { id: string; title: string; short_code: string; click_count: number; status: string; created_at: string; }

export default function ResultsPage({ token }: { token: string }) {
  const [tab, setTab] = useState<'send' | 'flyer'>('send');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [flyerStats, setFlyerStats] = useState<FlyerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [cRes, fRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/results?limit=30`, { headers }),
          fetch(`${API_BASE}/api/flyer/flyers`, { headers }),
        ]);
        if (cRes.ok) { const d = await cRes.json(); setCampaigns(d.campaigns || d.results || []); }
        if (fRes.ok) { const d = await fRes.json(); setFlyerStats(d.filter((f: FlyerStat) => f.status === 'published')); }
      } catch {}
      finally { setLoading(false); }
    })();
  }, [token]);

  const fmtDate = (d: string) => { const dt = new Date(d); return `${dt.getMonth()+1}/${dt.getDate()}`; };
  const totalClicks = flyerStats.reduce((sum, f) => sum + (f.click_count || 0), 0);

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-text">결과</h2>
        <TabBar tabs={[{ key: 'send', label: '발송 결과' }, { key: 'flyer', label: '전단지 클릭' }]} value={tab} onChange={setTab} className="w-64" />
      </div>

      {loading ? <div className="text-center py-20 text-text-muted">로딩 중...</div> : (
        <>
          {tab === 'send' && (
            <DataTable
              emptyMessage="발송 내역이 없습니다"
              columns={[
                { key: 'campaign_name', label: '캠페인', render: (v) => <span className="font-medium text-text">{v || '직접발송'}</span> },
                { key: 'message_type', label: '타입', align: 'center', render: (v) => <Badge variant="neutral">{v || 'SMS'}</Badge> },
                { key: 'total_sent', label: '발송', align: 'center', render: (v) => <span className="font-semibold">{v}</span> },
                { key: 'total_success', label: '성공', align: 'center', render: (v) => <span className="font-semibold text-success-600">{v}</span> },
                { key: 'total_failed', label: '실패', align: 'center', render: (v) => <span className="font-semibold text-error-500">{v}</span> },
                { key: 'created_at', label: '날짜', align: 'center', render: (v) => <span className="text-text-muted">{fmtDate(v)}</span> },
              ]}
              rows={campaigns}
            />
          )}

          {tab === 'flyer' && (
            <>
              {flyerStats.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                  <StatCard label="전체 클릭수" value={totalClicks.toLocaleString()} sub="발행된 전단지 합산" />
                  <StatCard label="발행 전단지" value={`${flyerStats.length}개`} />
                </div>
              )}
              {flyerStats.length === 0 ? (
                <EmptyState icon="📊" title="발행된 전단지가 없습니다" description="전단제작에서 전단지를 만들고 발행해주세요" />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {flyerStats.map(f => (
                    <div key={f.id} className="bg-surface border border-border rounded-xl p-4 shadow-card hover:shadow-elevated transition-shadow">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-sm text-text truncate">{f.title}</h3>
                          <p className="text-[11px] text-text-muted mt-0.5">{fmtDate(f.created_at)}</p>
                        </div>
                        <span className="text-2xl font-bold text-primary-600 ml-3">{f.click_count || 0}</span>
                      </div>
                      <code className="text-[11px] bg-bg text-text-secondary px-2 py-1 rounded-md font-mono block truncate">hanjul-flyer.kr/{f.short_code}</code>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
