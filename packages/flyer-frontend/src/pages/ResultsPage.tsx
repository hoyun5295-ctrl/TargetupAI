import { useState, useEffect } from 'react';
import { API_BASE } from '../App';
import { TabBar, DataTable, Badge, EmptyState, StatCard, Button } from '../components/ui';

interface Campaign { id: string; campaign_name: string; message_type: string; total_sent: number; total_success: number; total_failed: number; status: string; created_at: string; scheduled_at?: string; }
interface FlyerStat { id: string; title: string; short_code: string; click_count: number; status: string; created_at: string; }
interface Recipient { phone: string; status: string; status_label?: string; sent_at?: string; }
interface DailyClick { date: string; clicks: number; }

export default function ResultsPage({ token }: { token: string }) {
  const [tab, setTab] = useState<'send' | 'scheduled' | 'flyer'>('send');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [flyerStats, setFlyerStats] = useState<FlyerStat[]>([]);
  const [loading, setLoading] = useState(true);

  // 상세 모달
  const [detailCampaign, setDetailCampaign] = useState<Campaign | null>(null);
  const [detailRecipients, setDetailRecipients] = useState<Recipient[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // 클릭 상세
  const [clickDetail, setClickDetail] = useState<{ flyer: FlyerStat; daily: DailyClick[] } | null>(null);
  const [clickLoading, setClickLoading] = useState(false);

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [cRes, fRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/results?limit=50`, { headers }),
          fetch(`${API_BASE}/api/flyer/flyers`, { headers }),
        ]);
        if (cRes.ok) { const d = await cRes.json(); setCampaigns(d.campaigns || d.results || []); }
        if (fRes.ok) { const d = await fRes.json(); setFlyerStats(d.filter((f: FlyerStat) => f.status === 'published')); }
      } catch {}
      finally { setLoading(false); }
    })();
  }, [token]);

  const fmtDate = (d: string) => { const dt = new Date(d); return `${dt.getMonth()+1}/${dt.getDate()}`; };
  const fmtDateTime = (d: string) => {
    const dt = new Date(d);
    return `${dt.getFullYear()}.${dt.getMonth()+1}.${dt.getDate()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
  };
  const totalClicks = flyerStats.reduce((sum, f) => sum + (f.click_count || 0), 0);

  // 캠페인 상세 조회
  const handleCampaignDetail = async (c: Campaign) => {
    setDetailCampaign(c);
    setDetailLoading(true);
    setDetailRecipients([]);
    try {
      const res = await fetch(`${API_BASE}/api/v1/results/${c.id}/recipients?limit=100`, { headers });
      if (res.ok) {
        const d = await res.json();
        setDetailRecipients(d.recipients || d.data || []);
      }
    } catch {}
    finally { setDetailLoading(false); }
  };

  // 전단지 클릭 상세
  const handleFlyerClick = async (f: FlyerStat) => {
    setClickLoading(true);
    setClickDetail(null);
    try {
      const res = await fetch(`${API_BASE}/api/flyer/flyers/${f.id}/stats`, { headers });
      if (res.ok) {
        const d = await res.json();
        setClickDetail({ flyer: f, daily: d.daily_clicks || [] });
      }
    } catch {}
    finally { setClickLoading(false); }
  };

  // 발송 / 예약 분리
  const sentCampaigns = campaigns.filter(c => c.status !== 'scheduled');
  const scheduledCampaigns = campaigns.filter(c => c.status === 'scheduled');

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'success' | 'error' | 'warn' | 'neutral'; label: string }> = {
      completed: { variant: 'success', label: '완료' },
      sending: { variant: 'warn', label: '발송중' },
      scheduled: { variant: 'neutral', label: '예약' },
      cancelled: { variant: 'error', label: '취소' },
      failed: { variant: 'error', label: '실패' },
    };
    const m = map[status] || { variant: 'neutral' as const, label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-text">결과</h2>
        <TabBar
          tabs={[
            { key: 'send' as const, label: '발송 결과' },
            { key: 'scheduled' as const, label: `예약 (${scheduledCampaigns.length})` },
            { key: 'flyer' as const, label: '전단지 클릭' },
          ]}
          value={tab} onChange={setTab} className="w-80"
        />
      </div>

      {loading ? <div className="text-center py-20 text-text-muted">로딩 중...</div> : (
        <>
          {/* 발송 결과 */}
          {tab === 'send' && (
            <DataTable
              emptyMessage="발송 내역이 없습니다"
              columns={[
                { key: 'campaign_name', label: '캠페인', render: (v, row) => (
                  <button onClick={() => handleCampaignDetail(row)} className="font-medium text-text hover:text-primary-600 transition-colors text-left">
                    {v || '직접발송'}
                  </button>
                )},
                { key: 'message_type', label: '타입', align: 'center', render: (v) => <Badge variant="neutral">{v || 'SMS'}</Badge> },
                { key: 'status', label: '상태', align: 'center', render: (v) => statusBadge(v) },
                { key: 'total_sent', label: '발송', align: 'center', render: (v) => <span className="font-semibold">{v}</span> },
                { key: 'total_success', label: '성공', align: 'center', render: (v) => <span className="font-semibold text-success-600">{v}</span> },
                { key: 'total_failed', label: '실패', align: 'center', render: (v) => <span className="font-semibold text-error-500">{v}</span> },
                { key: 'created_at', label: '날짜', align: 'center', render: (v) => <span className="text-text-muted">{fmtDate(v)}</span> },
              ]}
              rows={sentCampaigns}
            />
          )}

          {/* 예약 발송 */}
          {tab === 'scheduled' && (
            scheduledCampaigns.length === 0 ? (
              <EmptyState icon="📅" title="예약된 발송이 없습니다" description="발송 페이지에서 예약 발송을 설정할 수 있습니다" />
            ) : (
              <DataTable
                emptyMessage="예약 내역이 없습니다"
                columns={[
                  { key: 'campaign_name', label: '캠페인', render: (v) => <span className="font-medium text-text">{v || '직접발송'}</span> },
                  { key: 'message_type', label: '타입', align: 'center', render: (v) => <Badge variant="neutral">{v || 'SMS'}</Badge> },
                  { key: 'total_sent', label: '대상', align: 'center', render: (v) => <span className="font-semibold">{v}</span> },
                  { key: 'scheduled_at', label: '예약 시간', align: 'center', render: (v) => <span className="text-primary-600 font-semibold text-xs">{v ? fmtDateTime(v) : '-'}</span> },
                  { key: 'status', label: '상태', align: 'center', render: (v) => statusBadge(v) },
                ]}
                rows={scheduledCampaigns}
              />
            )
          )}

          {/* 전단지 클릭 */}
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
                    <button key={f.id} onClick={() => handleFlyerClick(f)} className="bg-surface border border-border rounded-xl p-4 shadow-card hover:shadow-elevated transition-shadow text-left">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-sm text-text truncate">{f.title}</h3>
                          <p className="text-[11px] text-text-muted mt-0.5">{fmtDate(f.created_at)}</p>
                        </div>
                        <span className="text-2xl font-bold text-primary-600 ml-3">{f.click_count || 0}</span>
                      </div>
                      <code className="text-[11px] bg-bg text-text-secondary px-2 py-1 rounded-md font-mono block truncate">hanjul-flyer.kr/{f.short_code}</code>
                      <p className="text-[10px] text-primary-600 mt-2 font-medium">클릭하여 상세 보기</p>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* 캠페인 상세 모달 */}
      {detailCampaign && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-[2px]" onClick={() => setDetailCampaign(null)}>
          <div className="bg-surface rounded-2xl shadow-modal max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-text">{detailCampaign.campaign_name || '직접발송'}</h3>
                <p className="text-xs text-text-muted mt-0.5">{fmtDateTime(detailCampaign.created_at)}</p>
              </div>
              <div className="flex items-center gap-3">
                {statusBadge(detailCampaign.status)}
                <button onClick={() => setDetailCampaign(null)} className="text-text-muted hover:text-text transition-colors text-lg">✕</button>
              </div>
            </div>

            <div className="px-6 py-4">
              <div className="grid grid-cols-4 gap-3 mb-4">
                <div className="bg-bg rounded-lg p-3 text-center">
                  <p className="text-xs text-text-muted">발송</p>
                  <p className="text-lg font-bold text-text">{detailCampaign.total_sent}</p>
                </div>
                <div className="bg-success-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-success-600">성공</p>
                  <p className="text-lg font-bold text-success-600">{detailCampaign.total_success}</p>
                </div>
                <div className="bg-error-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-error-500">실패</p>
                  <p className="text-lg font-bold text-error-500">{detailCampaign.total_failed}</p>
                </div>
                <div className="bg-bg rounded-lg p-3 text-center">
                  <p className="text-xs text-text-muted">성공률</p>
                  <p className="text-lg font-bold text-text">
                    {detailCampaign.total_sent > 0 ? `${Math.round(detailCampaign.total_success / detailCampaign.total_sent * 100)}%` : '-'}
                  </p>
                </div>
              </div>

              <p className="text-xs font-semibold text-text-secondary mb-2">수신자 목록 (최대 100건)</p>
              <div className="overflow-y-auto max-h-64">
                {detailLoading ? (
                  <p className="text-sm text-text-muted text-center py-8">불러오는 중...</p>
                ) : detailRecipients.length === 0 ? (
                  <p className="text-sm text-text-muted text-center py-8">수신자 정보를 불러올 수 없습니다</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-bg sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-text-secondary">#</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-text-secondary">전화번호</th>
                        <th className="text-center px-3 py-2 text-xs font-semibold text-text-secondary">상태</th>
                        <th className="text-center px-3 py-2 text-xs font-semibold text-text-secondary">시간</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailRecipients.map((r, i) => (
                        <tr key={i} className="border-t border-border/30">
                          <td className="px-3 py-1.5 text-text-muted text-xs">{i + 1}</td>
                          <td className="px-3 py-1.5 font-mono text-xs">{r.phone}</td>
                          <td className="px-3 py-1.5 text-center">
                            <Badge variant={r.status === 'success' ? 'success' : r.status === 'failed' ? 'error' : 'warn'}>
                              {r.status_label || r.status || '대기'}
                            </Badge>
                          </td>
                          <td className="px-3 py-1.5 text-center text-xs text-text-muted">{r.sent_at ? fmtDateTime(r.sent_at) : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="px-6 py-3 border-t border-border flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => setDetailCampaign(null)}>닫기</Button>
            </div>
          </div>
        </div>
      )}

      {/* 전단지 클릭 상세 모달 */}
      {(clickDetail || clickLoading) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-[2px]" onClick={() => { setClickDetail(null); }}>
          <div className="bg-surface rounded-2xl shadow-modal max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-base font-bold text-text">{clickDetail?.flyer.title || '클릭 통계'}</h3>
              <button onClick={() => setClickDetail(null)} className="text-text-muted hover:text-text transition-colors text-lg">✕</button>
            </div>
            <div className="px-6 py-4">
              {clickLoading ? (
                <p className="text-sm text-text-muted text-center py-8">불러오는 중...</p>
              ) : clickDetail && (
                <>
                  <div className="text-center mb-6">
                    <p className="text-4xl font-bold text-primary-600">{clickDetail.flyer.click_count}</p>
                    <p className="text-xs text-text-muted mt-1">총 클릭수</p>
                  </div>

                  {clickDetail.daily.length > 0 ? (
                    <>
                      <p className="text-xs font-semibold text-text-secondary mb-3">일별 클릭 추이</p>
                      <div className="space-y-1.5">
                        {clickDetail.daily.slice(-14).map(d => {
                          const maxClicks = Math.max(...clickDetail.daily.map(x => x.clicks), 1);
                          const pct = (d.clicks / maxClicks) * 100;
                          return (
                            <div key={d.date} className="flex items-center gap-2">
                              <span className="text-[10px] text-text-muted w-10 text-right flex-shrink-0">{d.date.slice(5)}</span>
                              <div className="flex-1 bg-bg rounded-full h-4 overflow-hidden">
                                <div className="h-full bg-primary-500 rounded-full transition-all" style={{ width: `${Math.max(pct, 2)}%` }} />
                              </div>
                              <span className="text-[10px] font-semibold text-text w-6 text-right flex-shrink-0">{d.clicks}</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-text-muted text-center py-4">아직 클릭 데이터가 없습니다</p>
                  )}
                </>
              )}
            </div>
            <div className="px-6 py-3 border-t border-border flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => setClickDetail(null)}>닫기</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
