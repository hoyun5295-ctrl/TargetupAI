import { useState, useEffect } from 'react';

interface ResultsModalProps {
  onClose: () => void;
  token: string | null;
}

const STATUS_CODE_MAP: Record<number, { label: string; type: 'success' | 'fail' | 'pending' }> = {
  6: { label: 'SMS 성공', type: 'success' },
  1000: { label: 'LMS 성공', type: 'success' },
  1800: { label: '카카오 성공', type: 'success' },
  100: { label: '발송 대기', type: 'pending' },
  55: { label: '요금 부족', type: 'fail' },
  2008: { label: '비가입자/결번', type: 'fail' },
  23: { label: '식별코드 오류', type: 'fail' },
  2323: { label: '식별코드 오류', type: 'fail' },
  3000: { label: '메시지 형식 오류', type: 'fail' },
  3001: { label: '발신번호 오류', type: 'fail' },
  3002: { label: '수신번호 오류', type: 'fail' },
  3003: { label: '메시지 길이 초과', type: 'fail' },
  3004: { label: '스팸 차단', type: 'fail' },
  4000: { label: '전송 시간 초과', type: 'fail' },
  9999: { label: '기타 오류', type: 'fail' },
};

const CARRIER_MAP: Record<string, string> = {
  '11': 'SKT', '16': 'KT', '19': 'LG U+',
  '12': 'SKT 알뜰폰', '17': 'KT 알뜰폰', '20': 'LG 알뜰폰',
  'SKT': 'SKT', 'KTF': 'KT', 'LGT': 'LG U+',
};

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

  // 필터 상태
  const [filterType, setFilterType] = useState('all');
  const [filterSender, setFilterSender] = useState('all');

  // 발송내역 팝업 상태
  const [showSendDetail, setShowSendDetail] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [messageTotal, setMessageTotal] = useState(0);
  const [messagePage, setMessagePage] = useState(1);
  const [messageSearchType, setMessageSearchType] = useState('phone');
  const [messageSearchValue, setMessageSearchValue] = useState('');
  const [messageStatus, setMessageStatus] = useState('all');
  const [messageLoading, setMessageLoading] = useState(false);
  const messagePerPage = 10;

  useEffect(() => { fetchData(); }, [yearMonth]);
  useEffect(() => {
    if (cooldown > 0) { const t = setTimeout(() => setCooldown(cooldown - 1), 1000); return () => clearTimeout(t); }
  }, [cooldown]);
  useEffect(() => {
    if (testCooldown > 0) { const t = setTimeout(() => setTestCooldown(testCooldown - 1), 1000); return () => clearTimeout(t); }
  }, [testCooldown]);
  useEffect(() => { setCurrentPage(1); }, [filterType, filterSender]);

  const fetchData = async () => {
    if (cooldown > 0) return;
    setLoading(true);
    setCooldown(30);
    try {
      await fetch('/api/campaigns/sync-results', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const summaryRes = await fetch(`/api/v1/results/summary?from=${yearMonth}`, { headers: { Authorization: `Bearer ${token}` } });
      setSummary(await summaryRes.json());
      const campaignsRes = await fetch(`/api/v1/results/campaigns?from=${yearMonth}&limit=50`, { headers: { Authorization: `Bearer ${token}` } });
      const campaignsData = await campaignsRes.json();
      setCampaigns(campaignsData.campaigns || []);
    } catch (error) {
      console.error('결과 조회 에러:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCampaignDetail = async (campaignId: string) => {
    try {
      const res = await fetch(`/api/v1/results/campaigns/${campaignId}`, { headers: { Authorization: `Bearer ${token}` } });
      setCampaignDetail(await res.json());
    } catch (error) {
      console.error('캠페인 상세 조회 에러:', error);
    }
  };

  const fetchTestStats = async () => {
    if (testCooldown > 0) return;
    setTestCooldown(30);
    try {
      const res = await fetch(`/api/campaigns/test-stats?yearMonth=${yearMonth}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setTestStats(data.stats);
      setTestList(data.list);
    } catch (error) {
      console.error('테스트 통계 조회 실패:', error);
    }
  };

  // 발송내역 조회
  const fetchMessages = async (campaignId: string, page = 1, overrides?: { status?: string; searchValue?: string }) => {
    setMessageLoading(true);
    try {
      const currentStatus = overrides?.status ?? messageStatus;
      const currentSearchValue = overrides?.searchValue ?? messageSearchValue;

      const params = new URLSearchParams({ page: String(page), limit: String(messagePerPage) });
      if (currentSearchValue.trim()) {
        params.set('searchType', messageSearchType);
        params.set('searchValue', currentSearchValue.trim());
      }
      if (currentStatus !== 'all') params.set('status', currentStatus);
      const res = await fetch(`/api/v1/results/campaigns/${campaignId}/messages?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setMessages(data.messages || []);
      setMessageTotal(data.pagination?.total || 0);
      setMessagePage(page);
    } catch (error) {
      console.error('발송내역 조회 에러:', error);
    } finally {
      setMessageLoading(false);
    }
  };

  // 엑셀 다운로드
  const handleExport = async (campaignId: string) => {
    try {
      const res = await fetch(`/api/v1/results/campaigns/${campaignId}/export`, { headers: { Authorization: `Bearer ${token}` } });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `발송내역_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('success', '다운로드가 시작되었습니다.');
    } catch (error) {
      showToast('error', '다운로드에 실패했습니다.');
    }
  };

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ show: true, type, message });
    setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
  };

  const msgTypeLabel: Record<string, string> = { SMS: 'SMS', LMS: 'LMS', MMS: 'MMS', S: 'SMS', L: 'LMS', M: 'MMS', K: '알림톡', F: '친구톡' };
  const getStatusBadge = (rate: number) => rate >= 98 ? 'bg-green-100 text-green-700' : rate >= 95 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700';

  const getPreviewText = (content: string) => {
    const sampleData: Record<string, string> = {
      '이름': '김민수', '포인트': '12,500', '등급': 'VIP', '매장명': '강남점',
      '지역': '서울', '구매금액': '350,000', '구매횟수': '8', '평균주문금액': '43,750', 'LTV점수': '85'
    };
    let text = content || '';
    Object.entries(sampleData).forEach(([k, v]) => { text = text.replace(new RegExp(`%${k}%`, 'g'), v); });
    return text;
  };

  const formatDateTime = (dt: string) => {
    if (!dt) return '-';
    return new Date(dt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatPhone = (phone: string) => {
    if (!phone) return '-';
    const c = phone.replace(/\D/g, '');
    if (c.length === 11) return `${c.slice(0,3)}-${c.slice(3,7)}-${c.slice(7)}`;
    if (c.length === 10) return `${c.slice(0,3)}-${c.slice(3,6)}-${c.slice(6)}`;
    return phone;
  };

  // 필터링
  const filteredCampaigns = campaigns.filter(c => {
    if (filterType === 'direct' && c.send_type !== 'direct') return false;
    if (filterType === 'ai' && c.send_type === 'direct') return false;
    if (filterSender !== 'all' && c.created_by_name !== filterSender) return false;
    return true;
  });
  const uniqueSenders = [...new Set(campaigns.map(c => c.created_by_name).filter(Boolean))];
  const totalFilteredPages = Math.ceil(filteredCampaigns.length / itemsPerPage);
  const messageTotalPages = Math.ceil(messageTotal / messagePerPage);

  const getStatusLabel = (c: any) => {
    const type = c.send_type === 'direct' ? '수동' : 'AI';
    let status = c.status;
    if (status === 'completed') status = '완료';
    else if (status === 'scheduled') status = '예약';
    else if (status === 'sending') status = '발송중';
    else if (status === 'cancelled') status = c.cancelled_by_type === 'super_admin' ? '관리자취소' : '취소';
    else if (status === 'failed') status = '실패';
    else if (status === 'draft') status = 'draft';
    return `${type}(${status})`;
  };

  const getStatusColor = (c: any) => {
    if (c.status === 'completed') return 'bg-green-50 text-green-700 border border-green-200';
    if (c.status === 'scheduled') return 'bg-blue-50 text-blue-700 border border-blue-200';
    if (c.status === 'sending') return 'bg-yellow-50 text-yellow-700 border border-yellow-200';
    if (c.status === 'cancelled') return 'bg-gray-100 text-gray-600 border border-gray-200';
    if (c.status === 'failed') return 'bg-red-50 text-red-700 border border-red-200';
    return 'bg-gray-50 text-gray-600 border border-gray-200';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[1300px] max-h-[100vh] overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="flex justify-between items-center px-6 py-4 border-b bg-white">
          <h2 className="text-lg font-bold text-gray-800">발송 결과</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors text-lg">&times;</button>
        </div>

        {/* 탭 */}
        <div className="flex border-b bg-gray-50">
          {[
            { key: 'summary', label: '요약 및 비용현황', color: 'emerald' },
            { key: 'test', label: '테스트 발송', color: 'orange' },
            { key: 'ai', label: 'AI분석', color: 'violet' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key as any); if (tab.key === 'test') fetchTestStats(); }}
              className={`flex-1 py-3 text-center text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? `border-b-2 border-${tab.color}-500 text-${tab.color}-600 bg-white`
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 콘텐츠 */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'summary' && (
            <div className="space-y-4">
              {/* 기간 선택 + 필터 */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-gray-500 font-medium">기간</span>
                <input
                  type="month"
                  value={`${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}`}
                  onChange={(e) => setYearMonth(e.target.value.replace('-', ''))}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                />
                <div className="w-px h-6 bg-gray-200" />
                <span className="text-sm text-gray-500 font-medium">유형</span>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                >
                  <option value="all">전체</option>
                  <option value="ai">AI</option>
                  <option value="direct">수동</option>
                </select>
                <span className="text-sm text-gray-500 font-medium">발송자</span>
                <select
                  value={filterSender}
                  onChange={(e) => setFilterSender(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                >
                  <option value="all">전체</option>
                  {uniqueSenders.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button
                  onClick={fetchData}
                  disabled={cooldown > 0 || loading}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    cooldown > 0 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-emerald-500 text-white hover:bg-emerald-600'
                  }`}
                >
                  {loading ? '조회 중...' : cooldown > 0 ? `${cooldown}초` : '조회'}
                </button>
              </div>

              {/* 요약 카드 */}
              {(summary || campaigns.length > 0) && (() => {
                const totalSuccess = filteredCampaigns.reduce((sum, c) => sum + (c.success_count || 0), 0);
                const totalFail = filteredCampaigns.reduce((sum, c) => sum + (c.fail_count || 0), 0);
                const totalSent = totalSuccess + totalFail;
                const successRate = totalSent > 0 ? Math.round((totalSuccess / totalSent) * 100) : 0;
                const perSms = summary?.costs?.perSms || 9.9;
                return (
                  <div className="grid grid-cols-5 gap-3">
                    {[
                      { label: '총 발송', value: totalSent.toLocaleString(), color: 'text-blue-600', bg: 'bg-blue-50 border-blue-100' },
                      { label: '성공', value: totalSuccess.toLocaleString(), color: 'text-green-600', bg: 'bg-green-50 border-green-100' },
                      { label: '실패', value: totalFail.toLocaleString(), color: 'text-red-600', bg: 'bg-red-50 border-red-100' },
                      { label: '성공률', value: `${successRate}%`, color: 'text-violet-600', bg: 'bg-violet-50 border-violet-100' },
                      { label: '예상 비용', value: `${(totalSuccess * perSms).toLocaleString()}원`, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-100' },
                    ].map(card => (
                      <div key={card.label} className={`rounded-lg p-4 text-center border ${card.bg}`}>
                        <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
                        <div className="text-xs text-gray-500 mt-1">{card.label}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* 채널통합조회 테이블 */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-2.5 font-medium text-sm text-gray-700 border-b">
                  채널통합조회
                  <span className="text-gray-400 font-normal ml-2">{filteredCampaigns.length}건</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">유형</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">발송자</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">메시지 내용</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">등록일시</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">발송일시</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">타입</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">전송건수</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">성공</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">실패</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">대기</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">성공률</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase min-w-[80px]">보기</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCampaigns.length === 0 ? (
                      <tr><td colSpan={12} className="px-4 py-10 text-center text-gray-400">조회된 데이터가 없습니다.</td></tr>
                    ) : (
                      filteredCampaigns
                        .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                        .map((c) => (
                        <tr key={c.id} className="border-t hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(c)}`}
                              title={c.status === 'cancelled' && c.cancelled_by_type === 'super_admin' ? `관리자 취소 / 사유: ${c.cancel_reason || '없음'}` : ''}
                            >
                              {getStatusLabel(c)}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center text-xs text-gray-600">{c.created_by_name || '-'}</td>
                          <td className="px-3 py-2.5 max-w-[200px] truncate text-gray-700">{c.message_content}</td>
                          <td className="px-3 py-2.5 text-center text-xs text-gray-500">
                            {new Date(c.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-3 py-2.5 text-center text-xs">
                            {c.scheduled_at ? (
                              <span className="text-blue-600">
                                {new Date(c.scheduled_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                <span className="text-[10px] ml-1 text-blue-400">(예약)</span>
                              </span>
                            ) : c.sent_at ? (
                              <span className="text-gray-500">{new Date(c.sent_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                            ) : '-'}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="text-xs font-medium">{msgTypeLabel[c.message_type] || c.message_type}</span>
                          </td>
                          <td className="px-3 py-2.5 text-center font-medium">{(c.target_count || c.sent_count || 0).toLocaleString()}</td>
                          <td className="px-3 py-2.5 text-center text-green-600 font-medium">{(c.success_count || 0).toLocaleString()}</td>
                          <td className="px-3 py-2.5 text-center text-red-600 font-medium">{(c.fail_count || 0).toLocaleString()}</td>
                          <td className="px-3 py-2.5 text-center text-amber-500 font-medium">
                            {((c.target_count || 0) - (c.success_count || 0) - (c.fail_count || 0)).toLocaleString()}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {(() => {
                              const total = (c.success_count || 0) + (c.fail_count || 0);
                              const rate = total > 0 ? Math.round(((c.success_count || 0) / total) * 100) : 0;
                              return <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusBadge(rate)}`}>{rate}%</span>;
                            })()}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => { setSelectedCampaign(c); fetchCampaignDetail(c.id); }}
                                className="text-blue-500 hover:text-blue-700 text-xs font-medium hover:underline"
                              >
                                상세
                              </button>
                              {c.status === 'scheduled' && (
                                <button onClick={() => setCancelTarget(c)} className="text-red-400 hover:text-red-600 text-xs font-medium hover:underline ml-1">
                                  취소
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
                {totalFilteredPages > 1 && (
                  <div className="flex items-center justify-center gap-1.5 py-3 border-t bg-gray-50">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      이전
                    </button>
                    {Array.from({ length: totalFilteredPages }, (_, i) => i + 1)
                      .filter(page => Math.abs(page - currentPage) <= 2 || page === 1 || page === totalFilteredPages)
                      .map((page, idx, arr) => (
                        <span key={page}>
                          {idx > 0 && arr[idx - 1] !== page - 1 && <span className="px-1 text-gray-300">...</span>}
                          <button
                            onClick={() => setCurrentPage(page)}
                            className={`w-8 h-8 text-sm rounded-md border transition-colors ${
                              currentPage === page ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white hover:bg-gray-50'
                            }`}
                          >
                            {page}
                          </button>
                        </span>
                      ))
                    }
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalFilteredPages, p + 1))}
                      disabled={currentPage === totalFilteredPages}
                      className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      다음
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
                <span className="text-sm text-gray-500 font-medium">기간</span>
                <input
                  type="month"
                  value={`${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}`}
                  onChange={(e) => setYearMonth(e.target.value.replace('-', ''))}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400"
                />
                <button
                  onClick={fetchTestStats}
                  disabled={testCooldown > 0}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    testCooldown > 0 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-orange-500 text-white hover:bg-orange-600'
                  }`}
                >
                  {testCooldown > 0 ? `${testCooldown}초` : '조회'}
                </button>
              </div>

              {/* 요약 카드 */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-orange-50 border border-orange-100 rounded-lg p-4">
                  <div className="font-medium text-gray-700 mb-2">담당자 테스트</div>
                  <div className="flex justify-between items-end">
                    <div>
                      <span className="text-2xl font-bold text-orange-600">{testStats?.total || 0}</span>
                      <span className="text-sm text-gray-500 ml-1">건</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-500">성공 {testStats?.success || 0} / 실패 {testStats?.fail || 0}</div>
                      <div className="text-lg font-bold text-orange-600">{(testStats?.cost || 0).toLocaleString()}원</div>
                    </div>
                  </div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="font-medium text-gray-700 mb-2">스팸필터 테스트</div>
                  <div className="flex justify-between items-center h-[52px]">
                    <span className="text-gray-400 text-sm">준비중</span>
                  </div>
                </div>
              </div>

              {/* 테스트 리스트 */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-2.5 font-medium text-sm text-gray-700 border-b">담당자 테스트 이력</div>
                <div className="max-h-[400px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">날짜</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">발송자</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">유형</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">수신번호</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">내용</th>
                        <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500">결과</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(!testList || testList.length === 0) ? (
                        <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">테스트 발송 이력이 없습니다</td></tr>
                      ) : (
                        (testList || [])
                          .slice((testCurrentPage - 1) * itemsPerPage, testCurrentPage * itemsPerPage)
                          .map((t: any) => (
                          <tr key={t.id} className="border-t hover:bg-gray-50">
                            <td className="px-3 py-2 text-xs text-gray-500">
                              {new Date(t.sentAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-700">{t.senderName || '-'}</td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${t.type === 'SMS' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-violet-50 text-violet-700 border border-violet-200'}`}>
                                {t.type}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{t.phone}</td>
                            <td className="px-3 py-2 max-w-[300px] truncate">{t.content}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                t.status === 'success' ? 'bg-green-50 text-green-700' : t.status === 'pending' ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700'
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
                {testList && testList.length > itemsPerPage && (
                  <div className="flex justify-center items-center gap-2 py-3 border-t bg-gray-50">
                    <button onClick={() => setTestCurrentPage(p => Math.max(1, p - 1))} disabled={testCurrentPage === 1} className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-gray-50 disabled:opacity-40">이전</button>
                    <span className="text-sm text-gray-500">{testCurrentPage} / {Math.ceil(testList.length / itemsPerPage)}</span>
                    <button onClick={() => setTestCurrentPage(p => Math.min(Math.ceil(testList.length / itemsPerPage), p + 1))} disabled={testCurrentPage >= Math.ceil(testList.length / itemsPerPage)} className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-gray-50 disabled:opacity-40">다음</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-4">
              <div className="border border-gray-200 rounded-lg p-5">
                <div className="font-medium text-gray-700 mb-2">실패건 재발송</div>
                <p className="text-sm text-gray-500 mb-3">선택한 캠페인의 실패 건을 대상으로 재발송 캠페인을 생성합니다.</p>
                <button className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm font-medium transition-colors">재발송 캠페인 생성</button>
              </div>
              <div className="border border-gray-200 rounded-lg p-5">
                <div className="font-medium text-gray-700 mb-2">미구매자 리마케팅</div>
                <p className="text-sm text-gray-500 mb-3">메시지 수신 성공자 중 아직 구매하지 않은 고객을 대상으로 리마케팅 캠페인을 생성합니다.</p>
                <div className="bg-violet-50 border border-violet-100 rounded-lg p-3 mb-3">
                  <div className="text-xs text-violet-500">AI 추천 문구</div>
                  <div className="text-sm font-medium text-violet-700">"오늘이 마지막! 마감 임박"</div>
                </div>
                <button className="px-4 py-2 bg-violet-500 text-white rounded-lg hover:bg-violet-600 text-sm font-medium transition-colors">리마케팅 캠페인 생성</button>
              </div>
            </div>
          )}
        </div>

        {/* ==================== 캠페인 상세 모달 ==================== */}
        {selectedCampaign && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
            <div className="bg-white rounded-xl shadow-2xl w-[820px] max-h-[85vh] overflow-hidden flex flex-col">
              {/* 헤더 */}
              <div className="flex justify-between items-center px-6 py-4 border-b">
                <h3 className="font-bold text-gray-800">캠페인 상세</h3>
                <button onClick={() => { setSelectedCampaign(null); setShowSendDetail(false); }} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors text-lg">&times;</button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                {/* 상단 3카드 */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="border border-gray-200 rounded-lg p-4 text-center">
                    <div className="text-xs text-gray-500 mb-1">성공률</div>
                    <div className={`text-3xl font-bold ${
                      (() => {
                        const s = campaignDetail?.charts?.successFail;
                        const rate = s ? Math.round((s.success / (s.success + s.fail || 1)) * 100) : 0;
                        return rate >= 50 ? 'text-green-600' : 'text-red-500';
                      })()
                    }`}>
                      {campaignDetail?.charts?.successFail
                        ? Math.round((campaignDetail.charts.successFail.success / (campaignDetail.charts.successFail.success + campaignDetail.charts.successFail.fail || 1)) * 100)
                        : 0}%
                    </div>
                  </div>
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="text-xs text-gray-500 mb-2 text-center">통신사별 분포</div>
                    {campaignDetail?.charts?.carriers && Object.keys(campaignDetail.charts.carriers).length > 0 ? (
                      <div className="space-y-1.5">
                        {Object.entries(campaignDetail.charts.carriers).map(([carrier, count]) => {
                          const colors: Record<string, string> = { 'SKT': 'bg-red-100 text-red-700', 'KT': 'bg-orange-100 text-orange-700', 'LG U+': 'bg-pink-100 text-pink-700' };
                          return (
                            <div key={carrier} className={`flex justify-between items-center px-2.5 py-1 rounded-md text-xs ${colors[carrier] || 'bg-gray-100 text-gray-600'}`}>
                              <span className="font-medium">{carrier}</span>
                              <span className="font-bold">{(count as number).toLocaleString()}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400 text-center mt-2">성공 건 없음</div>
                    )}
                  </div>
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="text-xs text-gray-500 mb-2 text-center">실패사유 분포</div>
                    {campaignDetail?.charts?.errors && Object.keys(campaignDetail.charts.errors).length > 0 ? (
                      <div className="space-y-1">
                        {Object.entries(campaignDetail.charts.errors).map(([error, count]) => (
                          <div key={error} className="flex justify-between text-xs">
                            <span className="text-red-600">{error}</span>
                            <span className="font-medium text-gray-700">{(count as number).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400 text-center mt-2">실패 건 없음</div>
                    )}
                  </div>
                </div>

                {/* 폰 미리보기 + 캠페인 정보 */}
                <div className="flex gap-5">
                  {/* 폰 미리보기 */}
                  <div className="flex-shrink-0">
                    <div className="text-xs text-gray-500 mb-2 font-medium">메시지 미리보기</div>
                    <div className="w-[240px] rounded-[1.8rem] p-[3px] bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-200/50">
                      <div className="bg-white rounded-[1.6rem] overflow-hidden flex flex-col" style={{ height: '400px' }}>
                        {/* 상단 */}
                        <div className="px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100 flex justify-between items-center shrink-0 border-b">
                          <span className="text-[11px] text-gray-400 font-medium">문자메시지</span>
                          <span className="text-[11px] font-bold text-emerald-600">{msgTypeLabel[selectedCampaign.message_type] || selectedCampaign.message_type}</span>
                        </div>
                        {/* 메시지 영역 */}
                        <div className="flex-1 overflow-y-auto p-3 bg-gradient-to-b from-emerald-50/30 to-white">
                          <div className="flex gap-2">
                            <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 text-[10px] font-bold text-emerald-600">T</div>
                            <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm border border-gray-100 text-[11.5px] leading-[1.7] whitespace-pre-wrap text-gray-700 max-w-[95%]">
                              {getPreviewText(selectedCampaign.message_content || '')}
                            </div>
                          </div>
                        </div>
                        {/* 하단 바이트 */}
                        <div className="px-3 py-2 border-t bg-gray-50 text-center shrink-0">
                          <span className="text-[10px] text-gray-400">
                            {(() => { let b=0; const t=selectedCampaign.message_content||''; for(let i=0;i<t.length;i++) b+=t.charCodeAt(i)>127?2:1; return b; })()} / {selectedCampaign.message_type === 'SMS' || selectedCampaign.message_type === 'S' ? 90 : 2000} bytes
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 캠페인 정보 */}
                  <div className="flex-1">
                    <div className="text-xs text-gray-500 mb-2 font-medium">캠페인 정보</div>
                    <div className="border border-gray-200 rounded-lg divide-y">
                      {[
                        { label: '캠페인명', value: selectedCampaign.campaign_name },
                        { label: '유형', value: `${selectedCampaign.send_type === 'direct' ? '수동' : 'AI'} / ${msgTypeLabel[selectedCampaign.message_type] || selectedCampaign.message_type}` },
                        { label: '발송자', value: selectedCampaign.created_by_name || '-' },
                        { label: '회신번호', value: selectedCampaign.callback_number || '-' },
                        { label: '전송건수', value: `${(selectedCampaign.target_count || selectedCampaign.sent_count || 0).toLocaleString()}건` },
                        { label: '성공 / 실패', value: `${(selectedCampaign.success_count || 0).toLocaleString()} / ${(selectedCampaign.fail_count || 0).toLocaleString()}` },
                        { label: '등록일시', value: new Date(selectedCampaign.created_at).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) },
                        { label: '발송일시', value: selectedCampaign.sent_at ? new Date(selectedCampaign.sent_at).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : selectedCampaign.scheduled_at ? `${new Date(selectedCampaign.scheduled_at).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} (예약)` : '-' },
                      ].map(row => (
                        <div key={row.label} className="flex px-4 py-2.5 text-sm">
                          <span className="w-24 flex-shrink-0 text-gray-500">{row.label}</span>
                          <span className="text-gray-800 font-medium">{row.value}</span>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        setShowSendDetail(true);
                        setMessagePage(1);
                        setMessageSearchValue('');
                        setMessageStatus('all');
                        fetchMessages(selectedCampaign.id, 1, { status: 'all', searchValue: '' });
                      }}
                      className="mt-4 w-full py-2.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 text-sm font-medium transition-colors"
                    >
                      발송 내역 보기
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== 발송 내역 팝업 ==================== */}
        {showSendDetail && selectedCampaign && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70]">
            <div className="bg-white rounded-xl shadow-2xl w-[960px] max-h-[85vh] min-h-[70vh] overflow-hidden flex flex-col">
              {/* 헤더 */}
              <div className="flex justify-between items-center px-6 py-4 border-b">
                <div>
                  <h3 className="font-bold text-gray-800">발송 내역</h3>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {selectedCampaign.campaign_name}
                    <span className="mx-1.5 text-gray-300">|</span>
                    발송자: {selectedCampaign.created_by_name || '-'}
                    <span className="mx-1.5 text-gray-300">|</span>
                    총 {messageTotal.toLocaleString()}건
                  </div>
                </div>
                <button onClick={() => setShowSendDetail(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors text-lg">&times;</button>
              </div>

              {/* 검색 + 필터 + 다운로드 */}
              <div className="px-6 py-3 border-b bg-gray-50 flex items-center gap-3 flex-wrap">
                <select
                  value={messageSearchType}
                  onChange={(e) => setMessageSearchType(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200"
                >
                  <option value="phone">수신번호</option>
                  <option value="callback">회신번호</option>
                </select>
                <input
                  type="text"
                  value={messageSearchValue}
                  onChange={(e) => setMessageSearchValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { setMessagePage(1); fetchMessages(selectedCampaign.id, 1); }}}
                  placeholder="번호 입력"
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                />
                <button
                  onClick={() => { setMessagePage(1); fetchMessages(selectedCampaign.id, 1); }}
                  className="px-4 py-1.5 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 transition-colors"
                >
                  검색
                </button>
                <div className="w-px h-6 bg-gray-200" />
                {['all', 'success', 'fail'].map(st => (
                  <button
                    key={st}
                    onClick={() => { setMessageStatus(st); setMessagePage(1); fetchMessages(selectedCampaign.id, 1, { status: st }); }}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      messageStatus === st
                        ? st === 'success' ? 'bg-green-100 text-green-700 border border-green-300' : st === 'fail' ? 'bg-red-100 text-red-700 border border-red-300' : 'bg-gray-700 text-white'
                        : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {st === 'all' ? '전체' : st === 'success' ? '성공' : '실패'}
                  </button>
                ))}
                <div className="flex-1" />
                <button
                  onClick={() => handleExport(selectedCampaign.id)}
                  className="px-4 py-1.5 bg-gray-700 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
                >
                  엑셀 다운로드
                </button>
              </div>

              {/* 테이블 */}
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 w-12">#</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">수신번호</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">회신번호</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">메시지내용</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500">요청시간</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500">발송시간</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500">전송결과</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500">결과코드</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500">통신사</th>
                    </tr>
                  </thead>
                  <tbody>
                    {messageLoading ? (
                      <tr><td colSpan={9} className="py-10 text-center text-gray-400">조회 중...</td></tr>
                    ) : messages.length === 0 ? (
                      <tr><td colSpan={9} className="py-10 text-center text-gray-400">
                        {selectedCampaign?.status === 'cancelled'
                          ? '취소된 캠페인입니다. 대기중이던 메시지는 취소 시 삭제되었습니다.'
                          : messageSearchValue ? '검색 결과가 없습니다.' : '데이터가 없습니다.'}
                      </td></tr>
                    ) : (
                      messages.map((m: any, idx: number) => {
                        const statusInfo = STATUS_CODE_MAP[m.status_code] || { label: `코드 ${m.status_code}`, type: 'fail' as const };
                        const carrier = CARRIER_MAP[m.mob_company] || m.mob_company || '-';
                        return (
                          <tr key={m.seqno} className="border-t hover:bg-gray-50 transition-colors">
                            <td className="px-3 py-2.5 text-center text-xs text-gray-400">{(messagePage - 1) * messagePerPage + idx + 1}</td>
                            <td className="px-3 py-2.5 font-mono text-xs">{formatPhone(m.dest_no)}</td>
                            <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{formatPhone(m.call_back)}</td>
                            <td className="px-3 py-2.5 text-xs text-gray-600 max-w-[120px]">
                              <div className="relative group/msg">
                                <span className="truncate block cursor-default">{(m.msg_contents || '').slice(0, 10)}{(m.msg_contents || '').length > 10 ? '...' : ''}</span>
                                {(m.msg_contents || '').length > 10 && (
                                  <div className="invisible group-hover/msg:visible absolute left-full top-0 ml-2 z-[100] pointer-events-none">
                                    <div className="w-[220px] rounded-[1.4rem] p-[3px] bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-2xl">
                                      <div className="bg-white rounded-[1.2rem] overflow-hidden flex flex-col" style={{ maxHeight: '300px' }}>
                                        <div className="px-3 py-1.5 bg-gradient-to-r from-gray-50 to-gray-100 flex justify-between items-center shrink-0 border-b">
                                          <span className="text-[10px] text-gray-400 font-medium">문자메시지</span>
                                          <span className="text-[10px] font-bold text-emerald-600">{m.msg_type === 'S' ? 'SMS' : m.msg_type === 'L' ? 'LMS' : m.msg_type}</span>
                                        </div>
                                        <div className="flex-1 overflow-y-auto p-2 bg-gradient-to-b from-emerald-50/30 to-white">
                                          <div className="flex gap-1.5">
                                            <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 text-[8px] font-bold text-emerald-600">T</div>
                                            <div className="bg-white rounded-xl rounded-tl-sm p-2 shadow-sm border border-gray-100 text-[10px] leading-[1.6] whitespace-pre-wrap text-gray-700 max-w-[95%]">
                                              {getPreviewText(m.msg_contents || '')}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-center text-xs text-gray-500">{formatDateTime(m.sendreq_time)}</td>
                            <td className="px-3 py-2.5 text-center text-xs text-gray-500">{formatDateTime(m.mobsend_time)}</td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                statusInfo.type === 'success' ? 'bg-green-50 text-green-700' : statusInfo.type === 'pending' ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700'
                              }`}>
                                {statusInfo.type === 'success' ? '성공' : statusInfo.type === 'pending' ? '대기' : '실패'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-center text-xs text-gray-500">{m.status_code} ({statusInfo.label})</td>
                            <td className="px-3 py-2.5 text-center text-xs font-medium">{carrier}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* 페이지네이션 */}
              {messageTotalPages > 0 && (
                <div className="flex items-center justify-center gap-1.5 py-3 border-t bg-gray-50">
                  <button
                    onClick={() => { const p = Math.max(1, messagePage - 1); setMessagePage(p); fetchMessages(selectedCampaign.id, p); }}
                    disabled={messagePage <= 1}
                    className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    이전
                  </button>
                  {Array.from({ length: Math.min(messageTotalPages, 10) }, (_, i) => {
                    let start = Math.max(1, messagePage - 4);
                    if (start + 9 > messageTotalPages) start = Math.max(1, messageTotalPages - 9);
                    return start + i;
                  }).filter(p => p <= messageTotalPages).map(page => (
                    <button
                      key={page}
                      onClick={() => { setMessagePage(page); fetchMessages(selectedCampaign.id, page); }}
                      className={`w-8 h-8 text-sm rounded-md border transition-colors ${
                        messagePage === page ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white hover:bg-gray-50'
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    onClick={() => { const p = Math.min(messageTotalPages, messagePage + 1); setMessagePage(p); fetchMessages(selectedCampaign.id, p); }}
                    disabled={messagePage >= messageTotalPages}
                    className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    다음
                  </button>
                  <span className="text-xs text-gray-400 ml-2">{messagePage} / {messageTotalPages} 페이지</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================== 예약 취소 확인 모달 ==================== */}
        {cancelTarget && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
            <div className="bg-white rounded-xl shadow-2xl w-[400px] overflow-hidden">
              <div className="bg-red-50 px-6 py-4 border-b">
                <h3 className="text-lg font-bold text-red-700">예약 취소</h3>
              </div>
              <div className="p-6">
                <p className="text-gray-700 mb-2">다음 예약 발송을 취소하시겠습니까?</p>
                <div className="bg-gray-50 rounded-lg p-3 text-sm">
                  <div className="text-gray-500">예약 시간</div>
                  <div className="font-medium text-blue-600">
                    {cancelTarget.scheduled_at && new Date(cancelTarget.scheduled_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="text-gray-500 mt-2">발송 건수</div>
                  <div className="font-medium">{cancelTarget.target_count?.toLocaleString()}건</div>
                </div>
                <p className="text-xs text-red-500 mt-3">* 취소된 예약은 복구할 수 없습니다.</p>
              </div>
              <div className="flex border-t">
                <button onClick={() => setCancelTarget(null)} className="flex-1 py-3 text-gray-600 hover:bg-gray-50 font-medium transition-colors">닫기</button>
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/campaigns/${cancelTarget.id}/cancel`, { method: 'POST', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
                      const data = await res.json();
                      if (data.success) {
                        setCancelTarget(null);
                        showToast('success', '예약이 취소되었습니다.');
                        fetchData();
                      } else {
                        showToast('error', data.error || '취소 실패');
                      }
                    } catch (err) {
                      showToast('error', '취소 중 오류 발생');
                    }
                  }}
                  className="flex-1 py-3 bg-red-500 text-white hover:bg-red-600 font-medium transition-colors"
                >
                  예약 취소
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 토스트 */}
        {toast.show && (
          <div className={`fixed top-6 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg shadow-lg z-[100] text-sm font-medium ${
            toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
          }`}>
            {toast.message}
          </div>
        )}
      </div>
    </div>
  );
}
