import { useState, useEffect } from 'react';

interface ResultsModalProps {
  onClose: () => void;
  token: string | null;
}

export default function ResultsModal({ onClose, token }: ResultsModalProps) {
  const [activeTab, setActiveTab] = useState<'summary' | 'ai'>('summary');
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<any>(null);
  const [campaignDetail, setCampaignDetail] = useState<any>(null);
  const [yearMonth, setYearMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    fetchData();
  }, [yearMonth]);

  // 쿨다운 타이머
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  const fetchData = async () => {
    if (cooldown > 0) return;
    
    setLoading(true);
    setCooldown(30); // 30초 쿨다운
    
    try {
      // 요약 데이터
      const summaryRes = await fetch(`/api/v1/results/summary?from=${yearMonth}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const summaryData = await summaryRes.json();
      setSummary(summaryData);

      // 캠페인 목록
      const campaignsRes = await fetch(`/api/v1/results/campaigns?from=${yearMonth}&limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const campaignsData = await campaignsRes.json();
      setCampaigns(campaignsData.campaigns || []);
    } catch (error) {
      console.error('결과 조회 에러:', error);
    } finally {
      setLoading(false);
    }
  };

  // 캠페인 상세 조회
  const fetchCampaignDetail = async (campaignId: string) => {
    try {
      const res = await fetch(`/api/v1/results/campaigns/${campaignId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setCampaignDetail(data);
    } catch (error) {
      console.error('캠페인 상세 조회 에러:', error);
    }
  };

  const formatPhone = (phone: string) => {
    if (!phone) return '-';
    const cleaned = phone.replace(/\D/g, '');
    return `${cleaned.slice(0, 3)}-****-${cleaned.slice(-4)}`;
  };

  const getStatusBadge = (successRate: number) => {
    if (successRate >= 98) return 'bg-green-100 text-green-700';
    if (successRate >= 95) return 'bg-yellow-100 text-yellow-700';
    return 'bg-red-100 text-red-700';
  };

  const msgTypeLabel: Record<string, string> = {
    SMS: 'SMS', LMS: 'LMS', MMS: 'MMS', S: 'SMS', L: 'LMS', M: 'MMS', K: '알림톡', F: '친구톡'
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[1000px] max-h-[85vh] overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="flex justify-between items-center p-4 border-b bg-gradient-to-r from-green-50 to-blue-50">
          <h2 className="text-lg font-bold">📊 발송 결과</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
        </div>

        {/* 탭 */}
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('summary')}
            className={`flex-1 py-3 text-center font-medium ${activeTab === 'summary' ? 'border-b-2 border-green-500 text-green-600' : 'text-gray-500'}`}
          >
            📈 요약 및 비용현황
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            className={`flex-1 py-3 text-center font-medium ${activeTab === 'ai' ? 'border-b-2 border-purple-500 text-purple-600' : 'text-gray-500'}`}
          >
            🤖 AI분석
          </button>
        </div>

        {/* 콘텐츠 */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'summary' && (
            <div className="space-y-4">
              {/* 기간 선택 */}
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-600">기간:</span>
                <input
                  type="month"
                  value={`${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}`}
                  onChange={(e) => setYearMonth(e.target.value.replace('-', ''))}
                  className="border rounded px-3 py-1"
                />
                <button
                  onClick={fetchData}
                  disabled={cooldown > 0 || loading}
                  className={`px-4 py-1 rounded ${cooldown > 0 ? 'bg-gray-200 text-gray-500' : 'bg-green-500 text-white hover:bg-green-600'}`}
                >
                  {loading ? '조회 중...' : cooldown > 0 ? `${cooldown}초 후 조회 가능` : '🔍 조회'}
                </button>
              </div>

              {/* 요약 카드 */}
              {summary && (
                <div className="grid grid-cols-5 gap-3">
                  <div className="bg-blue-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-blue-600">{summary.summary?.totalSent?.toLocaleString() || 0}</div>
                    <div className="text-xs text-gray-500">총 발송</div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-green-600">{summary.summary?.totalSuccess?.toLocaleString() || 0}</div>
                    <div className="text-xs text-gray-500">성공</div>
                  </div>
                  <div className="bg-red-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-red-600">{summary.summary?.totalFail?.toLocaleString() || 0}</div>
                    <div className="text-xs text-gray-500">실패</div>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-purple-600">{summary.summary?.successRate || 0}%</div>
                    <div className="text-xs text-gray-500">성공률</div>
                  </div>
                  <div className="bg-yellow-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-yellow-600">
                      {((summary.summary?.totalSuccess || 0) * (summary.costs?.perSms || 9.9)).toLocaleString()}원
                    </div>
                    <div className="text-xs text-gray-500">예상 비용</div>
                  </div>
                </div>
              )}

              {/* 채널통합조회 테이블 */}
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 font-medium text-sm">📋 채널통합조회</div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-3 py-2 text-left">유형</th>
                      <th className="px-3 py-2 text-left">메시지 내용</th>
                      <th className="px-3 py-2 text-center">전송요청일시</th>
                      <th className="px-3 py-2 text-center">타입</th>
                      <th className="px-3 py-2 text-center">전송건수</th>
                      <th className="px-3 py-2 text-center">성공건수</th>
                      <th className="px-3 py-2 text-center">실패건수</th>
                      <th className="px-3 py-2 text-center">성공률(%)</th>
                      <th className="px-3 py-2 text-center">보기</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                          등록된 데이터가 없습니다.
                        </td>
                      </tr>
                    ) : (
                      campaigns.map((c) => (
                        <tr key={c.id} className="border-t hover:bg-gray-50">
                          <td className="px-3 py-2">{c.is_ad ? '광고' : '정보'}</td>
                          <td className="px-3 py-2 max-w-[200px] truncate">{c.message_content}</td>
                          <td className="px-3 py-2 text-center text-xs">
                            {new Date(c.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-3 py-2 text-center">{msgTypeLabel[c.message_type] || c.message_type}</td>
                          <td className="px-3 py-2 text-center">{c.sent_count?.toLocaleString() || 0}</td>
                          <td className="px-3 py-2 text-center text-green-600">{c.success_count?.toLocaleString() || 0}</td>
                          <td className="px-3 py-2 text-center text-red-600">{c.fail_count?.toLocaleString() || 0}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`px-2 py-0.5 rounded text-xs ${getStatusBadge(c.success_rate || 0)}`}>
                              {c.success_rate || 0}%
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                          <button
                              onClick={() => {
                                setSelectedCampaign(c);
                                fetchCampaignDetail(c.id);
                              }}
                              className="text-blue-500 hover:text-blue-700 text-xs"
                            >
                              [상세]
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-4">
              {/* 실패건 재발송 */}
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">🔄</span>
                  <span className="font-medium">실패건 재발송</span>
                </div>
                <p className="text-sm text-gray-500 mb-3">
                  선택한 캠페인의 실패 건을 대상으로 재발송 캠페인을 생성합니다.
                </p>
                <button className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600">
                  재발송 캠페인 생성
                </button>
              </div>

              {/* 미구매자 리마케팅 */}
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">🎯</span>
                  <span className="font-medium">미구매자 리마케팅</span>
                </div>
                <p className="text-sm text-gray-500 mb-3">
                  메시지 수신 성공자 중 아직 구매하지 않은 고객을 대상으로 리마케팅 캠페인을 생성합니다.
                </p>
                <div className="bg-purple-50 rounded p-3 mb-3">
                  <div className="text-xs text-purple-600">AI 추천 문구</div>
                  <div className="text-sm font-medium">"오늘이 마지막! 마감 임박 🔥"</div>
                </div>
                <button className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600">
                  리마케팅 캠페인 생성
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 캠페인 상세 모달 */}
        {selectedCampaign && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-60">
            <div className="bg-white rounded-xl shadow-2xl w-[800px] max-h-[80vh] overflow-hidden">
              <div className="flex justify-between items-center p-4 border-b">
                <h3 className="font-bold">📋 캠페인 상세: {selectedCampaign.campaign_name}</h3>
                <button onClick={() => setSelectedCampaign(null)} className="text-gray-500 hover:text-gray-700">✕</button>
              </div>
              <div className="p-4">
                {/* 차트 영역 */}
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="border rounded-lg p-4 text-center">
                    <div className="text-sm text-gray-500 mb-2">성공/실패 비율</div>
                    <div className="text-2xl font-bold text-green-600">
                      {selectedCampaign.success_rate || 0}%
                    </div>
                  </div>
                  <div className="border rounded-lg p-4 text-center">
                    <div className="text-sm text-gray-500 mb-2">통신사별 분포</div>
                    {campaignDetail?.charts?.carriers && Object.keys(campaignDetail.charts.carriers).length > 0 ? (
                      <div className="text-xs space-y-1">
                        {Object.entries(campaignDetail.charts.carriers).map(([carrier, count]) => (
                          <div key={carrier} className="flex justify-between">
                            <span>{carrier}</span>
                            <span className="font-medium">{(count as number).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400">성공 건 없음</div>
                    )}
                  </div>
                  <div className="border rounded-lg p-4 text-center">
                    <div className="text-sm text-gray-500 mb-2">실패사유 분포</div>
                    {campaignDetail?.charts?.errors && Object.keys(campaignDetail.charts.errors).length > 0 ? (
                      <div className="text-xs space-y-1">
                        {Object.entries(campaignDetail.charts.errors).map(([error, count]) => (
                          <div key={error} className="flex justify-between">
                            <span className="text-red-600">{error}</span>
                            <span className="font-medium">{(count as number).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400">실패 건 없음</div>
                    )}
                  </div>
                </div>

                {/* 메시지 내용 */}
                <div className="border rounded-lg p-4 mb-4">
                  <div className="text-sm text-gray-500 mb-2">💬 메시지 내용</div>
                  <div className="bg-gray-50 rounded p-3 text-sm whitespace-pre-wrap">
                    {selectedCampaign.message_content}
                  </div>
                </div>

                <div className="text-center text-gray-400 text-sm">
                  상세 발송 내역은 Agent 연동 후 조회 가능합니다.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}