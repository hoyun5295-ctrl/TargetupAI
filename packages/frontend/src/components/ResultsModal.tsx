import { useState, useEffect } from 'react';

interface ResultsModalProps {
  onClose: () => void;
  token: string | null;
}

export default function ResultsModal({ onClose, token }: ResultsModalProps) {
  const [activeTab, setActiveTab] = useState<'summary' | 'test' | 'ai'>('summary');
  const [testStats, setTestStats] = useState<any>(null);
  const [testList, setTestList] = useState<any[]>([]);
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
  const [testCooldown, setTestCooldown] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [testCurrentPage, setTestCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const [toast, setToast] = useState<{show: boolean, type: 'success' | 'error', message: string}>({show: false, type: 'success', message: ''});

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

  // 테스트 쿨다운 타이머
  useEffect(() => {
    if (testCooldown > 0) {
      const timer = setTimeout(() => setTestCooldown(testCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [testCooldown]);

  const fetchData = async () => {
    if (cooldown > 0) return;
    
    setLoading(true);
    setCooldown(30); // 30초 쿨다운
    
    try {
      // 먼저 동기화 실행
      await fetch('/api/campaigns/sync-results', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

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

  const fetchTestStats = async () => {
    if (testCooldown > 0) return;
    setTestCooldown(30);
    try {
      const res = await fetch(`/api/campaigns/test-stats?yearMonth=${yearMonth}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setTestStats(data.stats);
      setTestList(data.list);
    } catch (error) {
      console.error('테스트 통계 조회 실패:', error);
    }
  };

  const msgTypeLabel: Record<string, string> = {
    SMS: 'SMS', LMS: 'LMS', MMS: 'MMS', S: 'SMS', L: 'LMS', M: 'MMS', K: '알림톡', F: '친구톡'
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[1300px] max-h-[100vh] overflow-hidden flex flex-col">
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
            onClick={() => { setActiveTab('test'); fetchTestStats(); }}
            className={`flex-1 py-3 text-center font-medium ${activeTab === 'test' ? 'border-b-2 border-orange-500 text-orange-600' : 'text-gray-500'}`}
          >
            📱 테스트 발송
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
              {(summary || campaigns.length > 0) && (() => {
                // campaigns 배열에서 직접 계산
                const totalSuccess = campaigns.reduce((sum, c) => sum + (c.success_count || 0), 0);
                const totalFail = campaigns.reduce((sum, c) => sum + (c.fail_count || 0), 0);
                const totalSent = totalSuccess + totalFail;
                const successRate = totalSent > 0 ? Math.round((totalSuccess / totalSent) * 100) : 0;
                const perSms = summary?.costs?.perSms || 9.9;
                
                return (
                <div className="grid grid-cols-5 gap-3">
                  <div className="bg-blue-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-blue-600">{totalSent.toLocaleString()}</div>
                    <div className="text-xs text-gray-500">총 발송</div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-green-600">{totalSuccess.toLocaleString()}</div>
                    <div className="text-xs text-gray-500">성공</div>
                  </div>
                  <div className="bg-red-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-red-600">{totalFail.toLocaleString()}</div>
                    <div className="text-xs text-gray-500">실패</div>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-purple-600">{successRate}%</div>
                    <div className="text-xs text-gray-500">성공률</div>
                  </div>
                  <div className="bg-yellow-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-yellow-600">
                      {(totalSuccess * perSms).toLocaleString()}원
                    </div>
                    <div className="text-xs text-gray-500">예상 비용</div>
                  </div>
                  </div>
                );
              })()}

              {/* 채널통합조회 테이블 */}
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 font-medium text-sm">📋 채널통합조회</div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-100">
                  <tr>
                      <th className="px-3 py-2 text-left">유형</th>
                      <th className="px-3 py-2 text-center">발송자</th>
                      <th className="px-3 py-2 text-left">메시지 내용</th>
                      <th className="px-3 py-2 text-center">등록일시</th>
                      <th className="px-3 py-2 text-center">발송일시</th>
                      <th className="px-3 py-2 text-center">타입</th>
                      <th className="px-3 py-2 text-center">전송건수</th>
                      <th className="px-3 py-2 text-center">성공</th>
                      <th className="px-3 py-2 text-center">실패</th>
                      <th className="px-3 py-2 text-center">대기</th>
                      <th className="px-3 py-2 text-center">성공률(%)</th>
                      <th className="px-3 py-2 text-center min-w-[80px]">보기</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="px-4 py-8 text-center text-gray-400">
                          등록된 데이터가 없습니다.
                        </td>
                      </tr>
                    ) : (
                      campaigns
                        .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                        .map((c) => (
                        <tr key={c.id} className="border-t hover:bg-gray-50">
                          <td className="px-3 py-2">
                          <span 
                            className={`px-2 py-0.5 rounded text-xs cursor-default ${c.send_type === 'direct' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}
                            title={c.status === 'cancelled' && c.cancelled_by_type === 'super_admin' ? `관리자 취소\n사유: ${c.cancel_reason || '없음'}` : ''}
                          >
                          {c.send_type === 'direct' ? '수동' : 'AI'}({c.status === 'completed' ? '완료' : c.status === 'scheduled' ? '예약' : c.status === 'sending' ? '발송중' : c.status === 'cancelled' ? (c.cancelled_by_type === 'super_admin' ? '관리자취소' : '취소') : c.status})
                            </span>
                            </td>
                          <td className="px-3 py-2 text-center text-xs text-gray-600">
                            {c.created_by_name || '-'}
                          </td>
                          <td className="px-3 py-2 max-w-[200px] truncate">{c.message_content}</td>
                          <td className="px-3 py-2 text-center text-xs">
                          {new Date(c.created_at).toLocaleString('ko-KR', { 
                              month: '2-digit', 
                              day: '2-digit', 
                              hour: '2-digit', 
                              minute: '2-digit' 
                            })}
                          </td>
                          <td className="px-3 py-2 text-center text-xs">
                            {c.scheduled_at ? (
                              <span className="text-blue-600">
                                {new Date(c.scheduled_at).toLocaleString('ko-KR', { 
                                  month: '2-digit', 
                                  day: '2-digit', 
                                  hour: '2-digit', 
                                  minute: '2-digit' 
                                })}
                                <span className="text-[10px] ml-1">(예약)</span>
                              </span>
                            ) : c.sent_at ? (
                              new Date(c.sent_at).toLocaleString('ko-KR', { 
                                month: '2-digit', 
                                day: '2-digit', 
                                hour: '2-digit', 
                                minute: '2-digit' 
                              })
                            ) : '-'}
                          </td>
                          <td className="px-3 py-2 text-center">{msgTypeLabel[c.message_type] || c.message_type}</td>
                          <td className="px-3 py-2 text-center">{(c.target_count || c.sent_count || 0).toLocaleString()}</td>
                          <td className="px-3 py-2 text-center text-green-600">{c.success_count?.toLocaleString() || 0}</td>
                          <td className="px-3 py-2 text-center text-red-600">{c.fail_count?.toLocaleString() || 0}</td>
                          <td className="px-3 py-2 text-center text-orange-500">{((c.target_count || 0) - (c.success_count || 0) - (c.fail_count || 0)).toLocaleString()}</td>
                          <td className="px-3 py-2 text-center">
                            {(() => {
                              const total = (c.success_count || 0) + (c.fail_count || 0);
                              const rate = total > 0 ? Math.round(((c.success_count || 0) / total) * 100) : 0;
                              return (
                                <span className={`px-2 py-0.5 rounded text-xs ${getStatusBadge(rate)}`}>
                                  {rate}%
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => {
                                  setSelectedCampaign(c);
                                  fetchCampaignDetail(c.id);
                                }}
                                className="text-blue-500 hover:text-blue-700 text-xs"
                              >
                                [상세]
                              </button>
                              {c.status === 'scheduled' && (
                                <button
                                  onClick={() => setCancelTarget(c)}
                                  className="text-red-500 hover:text-red-700 text-xs"
                                >
                                  [취소]
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  </table>
                
                {/* 페이지네이션 */}
                {campaigns.length > itemsPerPage && (
                  <div className="flex items-center justify-center gap-2 py-3 border-t">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      ◀ 이전
                    </button>
                    {Array.from({ length: Math.ceil(campaigns.length / itemsPerPage) }, (_, i) => i + 1)
                      .filter(page => Math.abs(page - currentPage) <= 2 || page === 1 || page === Math.ceil(campaigns.length / itemsPerPage))
                      .map((page, idx, arr) => (
                        <span key={page}>
                          {idx > 0 && arr[idx - 1] !== page - 1 && <span className="px-1">...</span>}
                          <button
                            onClick={() => setCurrentPage(page)}
                            className={`px-3 py-1 text-sm border rounded ${currentPage === page ? 'bg-emerald-500 text-white' : 'hover:bg-gray-100'}`}
                          >
                            {page}
                          </button>
                        </span>
                      ))
                    }
                    <button
                      onClick={() => setCurrentPage(p => Math.min(Math.ceil(campaigns.length / itemsPerPage), p + 1))}
                      disabled={currentPage === Math.ceil(campaigns.length / itemsPerPage)}
                      className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      다음 ▶
                    </button>
                  </div>
                )}
                    
                    </div>
            </div>
          )}

          {activeTab === 'test' && (
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
                  onClick={fetchTestStats}
                  disabled={testCooldown > 0}
                  className={`px-4 py-1 rounded ${testCooldown > 0 ? 'bg-gray-300 text-gray-500' : 'bg-orange-500 text-white hover:bg-orange-600'}`}
                >
                  {testCooldown > 0 ? `${testCooldown}초 후 조회 가능` : '🔍 조회'}
                </button>
              </div>

              {/* 요약 카드 */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-orange-50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">📱</span>
                    <span className="font-medium">담당자 테스트</span>
                  </div>
                  <div className="flex justify-between items-end">
                    <div>
                      <span className="text-2xl font-bold text-orange-600">{testStats?.total || 0}</span>
                      <span className="text-sm text-gray-500 ml-1">건</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-500">
                        성공 {testStats?.success || 0} / 실패 {testStats?.fail || 0}
                      </div>
                      <div className="text-lg font-bold text-orange-600">
                        {(testStats?.cost || 0).toLocaleString()}원
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-100 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">🛡️</span>
                    <span className="font-medium">스팸필터 테스트</span>
                  </div>
                  <div className="flex justify-between items-center h-[52px]">
                    <span className="text-gray-400">준비중</span>
                  </div>
                </div>
              </div>

              {/* 테스트 리스트 */}
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 font-medium text-sm border-b">
                  📋 담당자 테스트 이력
                </div>
                <div className="max-h-[400px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left">날짜</th>
                        <th className="px-3 py-2 text-left">유형</th>
                        <th className="px-3 py-2 text-left">수신번호</th>
                        <th className="px-3 py-2 text-left">내용</th>
                        <th className="px-3 py-2 text-center">결과</th>
                      </tr>
                    </thead>
                    <tbody>
                    {(!testList || testList.length === 0) ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-8 text-center text-gray-400">
                            테스트 발송 이력이 없습니다
                          </td>
                        </tr>
                      ) : (
                        (testList || [])
                          .slice((testCurrentPage - 1) * itemsPerPage, testCurrentPage * itemsPerPage)
                          .map((t: any) => (
                          <tr key={t.id} className="border-t hover:bg-gray-50">
                            <td className="px-3 py-2 text-xs text-gray-500">
                              {new Date(t.sentAt).toLocaleString('ko-KR', { 
                                month: '2-digit', day: '2-digit', 
                                hour: '2-digit', minute: '2-digit' 
                              })}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded text-xs ${t.type === 'SMS' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                                {t.type}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{t.phone}</td>
                            <td className="px-3 py-2 max-w-[300px] truncate">{t.content}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`px-2 py-0.5 rounded text-xs ${
                                t.status === 'success' ? 'bg-green-100 text-green-700' : 
                                t.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 
                                'bg-red-100 text-red-700'
                              }`}>
                                {t.status === 'success' ? '성공' : t.status === 'pending' ? '대기' : '실패'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                
                {/* 페이징 */}
                {testList && testList.length > itemsPerPage && (
                  <div className="flex justify-center items-center gap-2 py-3 border-t">
                    <button
                      onClick={() => setTestCurrentPage(p => Math.max(1, p - 1))}
                      disabled={testCurrentPage === 1}
                      className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                    >
                      ◀ 이전
                    </button>
                    <span className="text-sm text-gray-600">
                      {testCurrentPage} / {Math.ceil(testList.length / itemsPerPage)} 페이지
                    </span>
                    <button
                      onClick={() => setTestCurrentPage(p => Math.min(Math.ceil(testList.length / itemsPerPage), p + 1))}
                      disabled={testCurrentPage >= Math.ceil(testList.length / itemsPerPage)}
                      className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                    >
                      다음 ▶
                    </button>
                  </div>
                )}
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
                <div className="text-sm text-gray-500 mb-2">성공률 %</div>
                    <div className="text-2xl font-bold text-green-600">
                      {campaignDetail?.charts?.successFail 
                        ? Math.round((campaignDetail.charts.successFail.success / (campaignDetail.charts.successFail.success + campaignDetail.charts.successFail.fail || 1)) * 100)
                        : 0}%
                    </div>
                  </div>
                  <div className="border rounded-lg p-4 text-center">
                    <div className="text-sm text-gray-500 mb-2">통신사별 분포</div>
                    {campaignDetail?.charts?.carriers && Object.keys(campaignDetail.charts.carriers).length > 0 ? (
                      <div className="text-xs space-y-2">
                        {Object.entries(campaignDetail.charts.carriers).map(([carrier, count]) => {
                          const carrierStyle: Record<string, {bg: string, text: string, icon: string}> = {
                            'SKT': {bg: 'bg-red-50', text: 'text-red-600', icon: '🔴'},
                            'KT': {bg: 'bg-orange-50', text: 'text-orange-600', icon: '🟠'},
                            'LG U+': {bg: 'bg-pink-50', text: 'text-pink-600', icon: '🟣'},
                            'SKT 알뜰폰': {bg: 'bg-red-50', text: 'text-red-400', icon: '⭕'},
                            'KT 알뜰폰': {bg: 'bg-orange-50', text: 'text-orange-400', icon: '⭕'},
                            'LG 알뜰폰': {bg: 'bg-pink-50', text: 'text-pink-400', icon: '⭕'},
                          };
                          const style = carrierStyle[carrier] || {bg: 'bg-gray-50', text: 'text-gray-600', icon: '📱'};
                          return (
                            <div key={carrier} className={`flex justify-between items-center px-2 py-1 rounded ${style.bg}`}>
                              <span className={`font-medium ${style.text}`}>{style.icon} {carrier}</span>
                              <span className="font-bold">{(count as number).toLocaleString()}건</span>
                            </div>
                          );
                        })}
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
              
              </div>
            </div>
          </div>
        )}

        {/* 예약 취소 확인 모달 */}
        {cancelTarget && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
            <div className="bg-white rounded-xl shadow-2xl w-[400px] overflow-hidden">
              <div className="bg-red-50 px-6 py-4 border-b">
                <h3 className="text-lg font-bold text-red-700">⚠️ 예약 취소</h3>
              </div>
              <div className="p-6">
                <p className="text-gray-700 mb-2">다음 예약 발송을 취소하시겠습니까?</p>
                <div className="bg-gray-50 rounded-lg p-3 text-sm">
                  <div className="text-gray-500">예약 시간</div>
                  <div className="font-medium text-blue-600">
                    {cancelTarget.scheduled_at && new Date(cancelTarget.scheduled_at).toLocaleString('ko-KR', {
                      timeZone: 'Asia/Seoul',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                  <div className="text-gray-500 mt-2">발송 건수</div>
                  <div className="font-medium">{cancelTarget.target_count?.toLocaleString()}건</div>
                </div>
                <p className="text-xs text-red-500 mt-3">* 취소된 예약은 복구할 수 없습니다.</p>
              </div>
              <div className="flex border-t">
                <button
                  onClick={() => setCancelTarget(null)}
                  className="flex-1 py-3 text-gray-600 hover:bg-gray-50 font-medium"
                >
                  닫기
                </button>
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/campaigns/${cancelTarget.id}/cancel`, {
                        method: 'POST',
                        headers: {
                          'Authorization': `Bearer ${localStorage.getItem('token')}`
                        }
                      });
                      const data = await res.json();
                      if (data.success) {
                        setCancelTarget(null);
                        setToast({show: true, type: 'success', message: '예약이 취소되었습니다.'});
                        setTimeout(() => setToast({show: false, type: 'success', message: ''}), 3000);
                        fetchData();
                      } else {
                        setToast({show: true, type: 'error', message: data.error || '취소 실패'});
                        setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
                      }
                    } catch (err) {
                      setToast({show: true, type: 'error', message: '취소 중 오류 발생'});
                      setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
                    }
                  }}
                  className="flex-1 py-3 bg-red-500 text-white hover:bg-red-600 font-medium"
                >
                  예약 취소
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* 토스트 알림 */}
        {toast.show && (
          <div className={`fixed top-6 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg shadow-lg z-[100] ${
            toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
          }`}>
            {toast.type === 'success' ? '✅' : '❌'} {toast.message}
          </div>
        )}
      </div>
    </div>
  );
}