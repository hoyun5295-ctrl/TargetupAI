import { useEffect, useState } from 'react';
import { calculateSmsBytes, formatCampaignMessageForDisplay, formatPhoneNumber } from '../utils/formatDate';
import MmsImagePreview from './shared/MmsImagePreview';
import CalendarModal from './CalendarModal';
import CampaignDetailModal from './CampaignDetailModal';
import { Send, CheckCircle2, XCircle, TrendingUp, Wallet, Download } from 'lucide-react';

interface ResultsModalProps {
  onClose: () => void;
  token: string | null;
  customerDbEnabled?: boolean;
  isSubscriptionLocked?: boolean;
  onFeatureLocked?: (featureName: string, requiredPlan: string) => void;
  onSubscriptionLocked?: () => void;
}

// STATUS_CODE_MAP 삭제 — 백엔드 API가 status_label, status_type, carrier_label을 직접 전달
// (sms-result-map.ts가 유일한 정의, 프론트 하드코딩 금지)

// CARRIER_MAP 삭제 — 백엔드 API가 carrier_label 직접 전달

// D107: 메시지 내용 셀 컨트롤타워 (3곳 통일)
function MessageCell({ content, maxWidth, onShowDetail }: { content: string; maxWidth?: string; onShowDetail: (text: string) => void }) {
  const display = content.length > 40 ? content.slice(0, 40) + '...' : content;
  return (
    <td className={`px-3 py-2.5 text-xs text-slate-600 ${maxWidth || 'max-w-[250px]'}`}>
      <button
        onClick={() => onShowDetail(content)}
        className="text-left truncate block max-w-full hover:text-emerald-600 hover:underline cursor-pointer"
        title="클릭하여 전체 내용 보기"
      >
        {display}
      </button>
    </td>
  );
}

export default function ResultsModal({ onClose, token, customerDbEnabled, isSubscriptionLocked, onFeatureLocked, onSubscriptionLocked }: ResultsModalProps) {
  const [activeTab, setActiveTab] = useState<'summary' | 'test'>('summary');
  const [showCalendar, setShowCalendar] = useState(false);
  const [testStats, setTestStats] = useState<any>(null);
  const [testList, setTestList] = useState<any[]>([]);
  const [spamFilterList, setSpamFilterList] = useState<any[]>([]);
  const [spamFilterStats, setSpamFilterStats] = useState<any>(null);
  const [spamCurrentPage, setSpamCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<any>(null);
  const [campaignDetail, setCampaignDetail] = useState<any>(null);
  const [yearMonth, setYearMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  // 일자별 기간 필터
  // ★ D227+-3 (2026-05-28 영업팀장 박성용 신고 fix): default = 7일 영역 (주인님 명시 — "일주일만 보여주고 결과 제대로")
  const [startDate, setStartDate] = useState(() => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return `${sevenDaysAgo.getFullYear()}-${String(sevenDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(sevenDaysAgo.getDate()).padStart(2, '0')}`;
  });
  const [endDate, setEndDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [cooldown, setCooldown] = useState(0);
  const [testCooldown, setTestCooldown] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [testCurrentPage, setTestCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const [draftCancelTarget, setDraftCancelTarget] = useState<any>(null);
  const [toast, setToast] = useState<{show: boolean, type: 'success' | 'error', message: string}>({show: false, type: 'success', message: ''});
  // ★ B6+B7(0417 PDF #6 #7): msgDetailContent state 확장
  //   #6 타입라벨 오류(바이트 기반 판정 → 실제 msgType 우선) + #7 MMS 이미지 누락(mmsImages 전달)
  //   호출부 4곳(L412/649/703/1011)에서 객체로 wrapping하여 전달.
  const [msgDetailContent, setMsgDetailContent] = useState<{
    content: string;
    msgType?: string;
    mmsImages?: any[];
  } | null>(null);
  const [enlargedImage, setEnlargedImage] = useState<{ url: string; filename: string } | null>(null); // ★ D123 P5: MMS 이미지 클릭 확대

  // 필터 상태
  const [filterType, setFilterType] = useState('all');
  const [filterSender, setFilterSender] = useState('all');

  // 발송내역 팝업 상태
  const [showSendDetail, setShowSendDetail] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  // ★ D225+ (2026-05-28 영업팀장 박성용 신고 fix): 알림톡 영역 시 templateCode + templateName 응답 영역
  const [alimtalkTemplateInfo, setAlimtalkTemplateInfo] = useState<{ code: string; name: string; status: string } | null>(null);
  const [messageTotal, setMessageTotal] = useState(0);
  const [messagePage, setMessagePage] = useState(1);
  const [messageSearchType, setMessageSearchType] = useState('phone');
  const [messageSearchValue, setMessageSearchValue] = useState('');
  const [messageStatus, setMessageStatus] = useState('all');
  const [messageLoading, setMessageLoading] = useState(false);
  const messagePerPage = 10;

  // ★ D104: 날짜 변경 시 cooldown 무시하고 즉시 조회
  useEffect(() => { fetchData(true); }, [startDate, endDate]);
  useEffect(() => {
    if (cooldown > 0) { const t = setTimeout(() => setCooldown(cooldown - 1), 1000); return () => clearTimeout(t); }
  }, [cooldown]);
  useEffect(() => {
    if (testCooldown > 0) { const t = setTimeout(() => setTestCooldown(testCooldown - 1), 1000); return () => clearTimeout(t); }
  }, [testCooldown]);
  useEffect(() => { setCurrentPage(1); }, [filterType, filterSender]);

  const fetchData = async (force = false) => {
    if (!force && cooldown > 0) return;
    setLoading(true);
    setCooldown(5);
    try {
      // ★ D144 후속: 화면 카운트는 MySQL 직접 카운트로 전환됐으나, sync-results는 통신사 실패분 자동 환불 +
      //   campaigns/campaign_runs/auto_campaign_runs status 전환 책임이 있어 보조용으로 유지.
      fetch('/api/campaigns/sync-results', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
        .catch(err => console.warn('sync-results 백그라운드 동기화 실패:', err));
      const from = startDate.replace(/-/g, '').slice(0, 6);
      const summaryRes = await fetch(`/api/v1/results/summary?from=${from}&fromDate=${startDate}&toDate=${endDate}`, { headers: { Authorization: `Bearer ${token}` } });
      setSummary(await summaryRes.json());
      // ★ D131: 기간 조회 시 limit=50 → 2000 상향 (서수란 팀장 제보 — 5페이지에서 끊기는 문제)
      //   원인: 백엔드는 page/limit 서버 페이지네이션 지원하지만 프론트가 page 파라미터 전달 안 하고
      //         클라이언트 사이드 페이지네이션(filteredCampaigns.length 기반)으로 구현돼 있어 현재 페이지 크기가 곧 전체 상한.
      //   TODO(기간계 개선): 진짜 서버사이드 페이지네이션으로 전환 — page 상태 변경 시 fetch 재호출 + total 기반 totalPages.
      const campaignsRes = await fetch(`/api/v1/results/campaigns?from=${from}&fromDate=${startDate}&toDate=${endDate}&limit=2000`, { headers: { Authorization: `Bearer ${token}` } });
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
    setTestCooldown(5);
    try {
      const testFrom = startDate.replace(/-/g, '').slice(0, 6);
      const res = await fetch(`/api/campaigns/test-stats?yearMonth=${testFrom}&fromDate=${startDate}&toDate=${endDate}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setTestStats(data.stats);
      setTestList(data.list);
      setSpamFilterStats(data.spamFilterStats || null);
      setSpamFilterList(data.spamFilterList || []);
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
      // ★ D225+ Brand Voice — 알림톡 영역 시 templateInfo 응답 반영
      setAlimtalkTemplateInfo(data.alimtalkTemplateInfo || null);
    } catch (error) {
      console.error('발송내역 조회 에러:', error);
    } finally {
      setMessageLoading(false);
    }
  };

  // 엑셀 다운로드
  const handleExport = async (campaignId: string, status?: string) => {
    try {
      const sp = new URLSearchParams();
      if (status && status !== 'all') sp.set('status', status);
      const res = await fetch(`/api/v1/results/campaigns/${campaignId}/export?${sp}`, { headers: { Authorization: `Bearer ${token}` } });
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

  // 채널통합조회(요약 탭) 목록 전체 엑셀 다운로드 — 현재 기간+유형+발송자 필터 그대로 서버 전달
  const handleExportList = async () => {
    try {
      const sp = new URLSearchParams();
      sp.set('fromDate', startDate);
      sp.set('toDate', endDate);
      if (filterType !== 'all') sp.set('sendType', filterType);
      if (filterSender !== 'all') sp.set('sender', filterSender);
      const res = await fetch(`/api/v1/results/campaigns/export?${sp}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { showToast('error', '다운로드에 실패했습니다.'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `발송결과_${startDate}_${endDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('success', '다운로드가 시작되었습니다.');
    } catch (error) {
      showToast('error', '다운로드에 실패했습니다.');
    }
  };

  const msgTypeLabel: Record<string, string> = { SMS: 'SMS', LMS: 'LMS', MMS: 'MMS', S: 'SMS', L: 'LMS', M: 'MMS', K: '알림톡', F: '친구톡' };



  const formatDateTime = (dt: string) => {
    if (!dt) return '-';
    return new Date(dt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // ★ D123 P6: 인라인 제거 → formatPhoneNumber 컨트롤타워 사용 (02 지역번호, 대표번호, 050X 전부 정확 처리)
  const formatPhone = (phone: string) => phone ? formatPhoneNumber(phone) : '-';

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
    else if (status === 'draft') status = '실패';
    return `${type}(${status})`;
  };

  const getStatusColor = (c: any) => {
    if (c.status === 'completed') return 'bg-green-50 text-green-700 border border-green-200';
    if (c.status === 'scheduled') return 'bg-blue-50 text-blue-700 border border-blue-200';
    if (c.status === 'sending') return 'bg-yellow-50 text-yellow-700 border border-yellow-200';
    if (c.status === 'cancelled') return 'bg-slate-100 text-slate-600 border border-slate-200';
    if (c.status === 'failed' || c.status === 'draft') return 'bg-red-50 text-red-700 border border-red-200';
    return 'bg-slate-50 text-slate-600 border border-slate-200';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 md:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[1300px] max-h-[95vh] overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="flex justify-between items-center px-6 py-4 border-b bg-white">
          <h2 className="text-lg font-bold text-slate-800">발송 결과</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors text-lg">&times;</button>
        </div>

        {/* 탭 */}
        <div className="flex border-b bg-slate-50">
          {[
            { key: 'summary', label: '요약 및 비용현황', color: 'emerald' },
            { key: 'test', label: '테스트 발송', color: 'orange' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key as any); if (tab.key === 'test') fetchTestStats(); }}
              className={`flex-1 py-3 text-center text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? `border-b-2 border-${tab.color}-500 text-${tab.color}-600 bg-white`
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 콘텐츠 */}
        <div className="flex-1 overflow-y-auto p-5 relative" style={{ overscrollBehavior: 'contain' }}>
          {/* ★ D120 P6: 캘린더 버튼 — 요약 탭에서만 + 무료 사용자 차단 */}
          {activeTab === 'summary' && (
            <button
              onClick={() => {
                if (isSubscriptionLocked) { onSubscriptionLocked?.(); return; }
                if (customerDbEnabled === false) { onFeatureLocked?.('캘린더', '스타터'); return; }
                setShowCalendar(true);
              }}
              className={`absolute top-4 right-5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors z-10 ${
                isSubscriptionLocked || customerDbEnabled === false
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-violet-500 text-white hover:bg-violet-600'
              }`}
            >
              {(isSubscriptionLocked || customerDbEnabled === false) && <span className="mr-1">🔒</span>}📅 캘린더
            </button>
          )}
          {activeTab === 'summary' && (
            <div className="space-y-4">
              {/* 기간 선택 + 필터 */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-slate-500 font-medium">기간</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
                />
                <span className="text-slate-400">~</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
                />
                <div className="w-px h-6 bg-slate-200" />
                <span className="text-sm text-slate-500 font-medium">유형</span>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
                >
                  <option value="all">전체</option>
                  <option value="ai">AI</option>
                  <option value="direct">수동</option>
                </select>
                <span className="text-sm text-slate-500 font-medium">발송자</span>
                <select
                  value={filterSender}
                  onChange={(e) => setFilterSender(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
                >
                  <option value="all">전체</option>
                  {uniqueSenders.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button
                  onClick={() => fetchData()}
                  disabled={cooldown > 0 || loading}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    cooldown > 0 ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-violet-500 text-white hover:bg-violet-600'
                  }`}
                >
                  {loading ? '조회 중...' : cooldown > 0 ? `${cooldown}초` : '조회'}
                </button>
              </div>

              {/* 요약 카드 */}
              {(summary || campaigns.length > 0) && (() => {
                const totalSuccess = filteredCampaigns.reduce((sum, c) => sum + (c.success_count || 0), 0);
                const totalFail = filteredCampaigns.reduce((sum, c) => sum + (c.fail_count || 0), 0);
                // D183: 전송 분모 = sent_count(통신사 발송 누계) 또는 target_count(목표 수) — 대기분 포함
                const totalSent = filteredCampaigns.reduce((sum, c) => sum + (c.sent_count || c.target_count || 0), 0);
                const successRate = totalSent > 0 ? Math.round((totalSuccess / totalSent) * 100) : 0;
                // 메시지 타입별 단가 적용 (SMS/LMS/MMS/카카오 구분)
                const perSms = summary?.costs?.perSms || 9.9;
                const perLms = summary?.costs?.perLms || 27;
                const perMms = summary?.costs?.perMms || 50;
                const perKakao = summary?.costs?.perKakao || 7.5;
                const estimatedCost = filteredCampaigns.reduce((sum, c) => {
                  const success = c.success_count || 0;
                  const type = (c.message_type || 'SMS').toUpperCase();
                  const channel = c.send_channel || 'sms';
                  if (channel === 'kakao') return sum + success * perKakao;
                  if (type === 'MMS') return sum + success * perMms;
                  if (type === 'LMS') return sum + success * perLms;
                  return sum + success * perSms;
                }, 0);
                return (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                      { key: 'sent', label: '총 발송', value: totalSent.toLocaleString(), Icon: Send, grad: 'from-violet-500 to-violet-600', cls: 'text-slate-900', progress: undefined as number | undefined },
                      { key: 'success', label: '성공', value: totalSuccess.toLocaleString(), Icon: CheckCircle2, grad: 'from-emerald-500 to-emerald-600', cls: 'text-emerald-600', progress: undefined as number | undefined },
                      { key: 'fail', label: '실패', value: totalFail.toLocaleString(), Icon: XCircle, grad: 'from-rose-500 to-rose-600', cls: 'text-rose-600', progress: undefined as number | undefined },
                      { key: 'rate', label: '성공률', value: `${successRate}%`, Icon: TrendingUp, grad: 'from-violet-500 to-fuchsia-600', cls: 'text-violet-600', progress: successRate as number | undefined },
                      { key: 'cost', label: '예상 비용', value: `₩${Math.round(estimatedCost).toLocaleString()}`, Icon: Wallet, grad: 'from-amber-500 to-orange-500', cls: 'text-amber-600', progress: undefined as number | undefined },
                    ].map(card => {
                      const Icon = card.Icon;
                      return (
                        <div key={card.key} className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${card.grad} flex items-center justify-center shadow-sm`}>
                              <Icon className="w-5 h-5 text-white" />
                            </div>
                            <span className="text-xs text-slate-500">{card.label}</span>
                          </div>
                          <div className={`text-2xl font-bold ${card.cls}`}>{card.value}</div>
                          {card.progress !== undefined && (
                            <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full" style={{ width: `${Math.min(100, card.progress)}%` }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* 채널통합조회 테이블 */}
              {(() => {
                const pageRows = filteredCampaigns.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
                const rateBarClass = (rate: number) => rate >= 98 ? 'bg-emerald-500' : rate >= 95 ? 'bg-amber-500' : 'bg-rose-500';
                const channelChip = (c: any) => {
                  const isLmsMms = c.message_type === 'LMS' || c.message_type === 'MMS' || c.message_type === 'L' || c.message_type === 'M';
                  const cls = c.send_channel === 'kakao' ? 'bg-yellow-50 text-yellow-700 border border-yellow-200'
                    : c.send_channel === 'alimtalk' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : c.send_channel === 'both' || isLmsMms ? 'bg-violet-50 text-violet-700 border border-violet-200'
                    : 'bg-slate-100 text-slate-600 border border-slate-200';
                  const label = c.send_channel === 'kakao' ? '💬 카카오'
                    : c.send_channel === 'alimtalk' ? '📨 알림톡'
                    : c.send_channel === 'both' ? '📱+💬'
                    : `📱 ${msgTypeLabel[c.message_type] || 'SMS'}`;
                  return { cls, label };
                };
                return (
              <div className="rounded-2xl border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
                  <span className="font-medium text-sm text-slate-700">
                    채널통합조회
                    <span className="text-slate-400 font-normal ml-2">{filteredCampaigns.length}건</span>
                  </span>
                  <button
                    onClick={handleExportList}
                    disabled={filteredCampaigns.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" /> 엑셀 다운로드
                  </button>
                </div>

                {/* 데스크탑: 테이블 (md 이상) */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">유형</th>
                        <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500">발송자</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">메시지 내용</th>
                        <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500">등록일시</th>
                        <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500">발송일시</th>
                        <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500">채널</th>
                        <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500">전송건수</th>
                        <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500">성공</th>
                        <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500">실패</th>
                        <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500">대기</th>
                        <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500">성공률</th>
                        <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500 min-w-[80px]">보기</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.length === 0 ? (
                        <tr><td colSpan={12} className="px-4 py-10 text-center text-slate-400">조회된 데이터가 없습니다.</td></tr>
                      ) : (
                        pageRows.map((c) => {
                          const sent = c.sent_count || c.target_count || 0;
                          const successCnt = c.success_count || 0;
                          const failCnt = c.fail_count || 0;
                          const pendingCnt = Math.max(0, sent - successCnt - failCnt);
                          const rate = sent > 0 ? Math.round((successCnt / sent) * 100) : 0;
                          const ch = channelChip(c);
                          return (
                          <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                            <td className="px-3 py-2.5">
                              <span
                                className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${getStatusColor(c)}`}
                                title={c.status === 'cancelled' && c.cancelled_by_type === 'super_admin' ? `관리자 취소 / 사유: ${c.cancel_reason || '없음'}` : ''}
                              >
                                {getStatusLabel(c)}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-center text-xs text-slate-600">{c.created_by_name || '-'}</td>
                            <MessageCell
                              content={formatCampaignMessageForDisplay(c)}
                              onShowDetail={(content) => setMsgDetailContent({
                                content,
                                msgType: c.message_type,
                                mmsImages: Array.isArray(c.mms_image_paths) ? c.mms_image_paths : (typeof c.mms_image_paths === 'string' ? (() => { try { return JSON.parse(c.mms_image_paths); } catch { return []; } })() : []),
                              })}
                            />
                            <td className="px-3 py-2.5 text-center text-xs text-slate-500">
                              {new Date(c.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="px-3 py-2.5 text-center text-xs">
                              {c.scheduled_at ? (
                                c.status === 'cancelled' ? (
                                  <span className="text-slate-400 line-through">
                                    {new Date(c.scheduled_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                    <span className="text-[10px] ml-1">(예약취소)</span>
                                  </span>
                                ) : (
                                  <span className="text-blue-600">
                                    {new Date(c.scheduled_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                    <span className="text-[10px] ml-1 text-blue-400">(예약)</span>
                                  </span>
                                )
                              ) : c.sent_at ? (
                                <span className="text-slate-500">{new Date(c.sent_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                              ) : '-'}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`inline-block px-1.5 py-0.5 rounded-md text-[10px] font-medium ${ch.cls}`}>{ch.label}</span>
                            </td>
                            <td className="px-3 py-2.5 text-center font-medium text-slate-700">{sent.toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-center text-emerald-600 font-medium">{successCnt.toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-center text-rose-600 font-medium">{failCnt.toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-center text-amber-500 font-medium">{pendingCnt.toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <div className="w-12 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                  <div className={`h-full rounded-full ${rateBarClass(rate)}`} style={{ width: `${rate}%` }} />
                                </div>
                                <span className="text-xs font-medium text-slate-600">{rate}%</span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => { setMessages([]); setShowSendDetail(false); setSelectedCampaign(c); fetchCampaignDetail(c.id); }}
                                  className="text-violet-600 hover:text-violet-700 text-xs font-medium hover:underline"
                                >
                                  상세
                                </button>
                                {c.status === 'scheduled' && (
                                  <button onClick={() => setCancelTarget(c)} className="text-rose-400 hover:text-rose-600 text-xs font-medium hover:underline ml-1">
                                    취소
                                  </button>
                                )}
                                {c.status === 'draft' && c.scheduled_at && new Date(c.scheduled_at) > new Date() && (new Date(c.scheduled_at).getTime() - Date.now()) >= 15 * 60 * 1000 && (
                                  <button onClick={() => setDraftCancelTarget(c)} className="text-rose-400 hover:text-rose-600 text-xs font-medium hover:underline ml-1">
                                    취소
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* 모바일: 카드형 행 (md 미만) */}
                <div className="md:hidden divide-y divide-slate-100">
                  {pageRows.length === 0 ? (
                    <div className="px-4 py-10 text-center text-slate-400 text-sm">조회된 데이터가 없습니다.</div>
                  ) : (
                    pageRows.map((c) => {
                      const sent = c.sent_count || c.target_count || 0;
                      const successCnt = c.success_count || 0;
                      const rate = sent > 0 ? Math.round((successCnt / sent) * 100) : 0;
                      const ch = channelChip(c);
                      const msgPreview = formatCampaignMessageForDisplay(c);
                      return (
                        <div key={c.id} className="p-4">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${getStatusColor(c)}`}>{getStatusLabel(c)}</span>
                              <span className={`inline-block px-1.5 py-0.5 rounded-md text-[10px] font-medium ${ch.cls}`}>{ch.label}</span>
                            </div>
                            <button
                              onClick={() => { setMessages([]); setShowSendDetail(false); setSelectedCampaign(c); fetchCampaignDetail(c.id); }}
                              className="text-violet-600 hover:text-violet-700 text-xs font-medium hover:underline shrink-0"
                            >
                              상세
                            </button>
                          </div>
                          <div className="text-sm text-slate-700 mb-2 break-all">{msgPreview.length > 60 ? msgPreview.slice(0, 60) + '…' : msgPreview}</div>
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-slate-500">전송 <span className="font-medium text-slate-700">{sent.toLocaleString()}</span></span>
                            <span className="text-slate-500">성공 <span className="font-medium text-emerald-600">{successCnt.toLocaleString()}</span></span>
                            <span className="flex items-center gap-1">
                              <span className="w-10 h-1.5 rounded-full bg-slate-100 overflow-hidden inline-block">
                                <span className={`block h-full rounded-full ${rateBarClass(rate)}`} style={{ width: `${rate}%` }} />
                              </span>
                              <span className="font-medium text-slate-600">{rate}%</span>
                            </span>
                            {c.created_by_name && <span className="text-slate-400 ml-auto">{c.created_by_name}</span>}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* 페이지네이션 */}
                {totalFilteredPages > 1 && (
                  <div className="flex items-center justify-center gap-1.5 py-3 border-t border-slate-200 bg-slate-50">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 text-sm rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      이전
                    </button>
                    {Array.from({ length: totalFilteredPages }, (_, i) => i + 1)
                      .filter(page => Math.abs(page - currentPage) <= 2 || page === 1 || page === totalFilteredPages)
                      .map((page, idx, arr) => (
                        <span key={page}>
                          {idx > 0 && arr[idx - 1] !== page - 1 && <span className="px-1 text-slate-300">...</span>}
                          <button
                            onClick={() => setCurrentPage(page)}
                            className={`w-8 h-8 text-sm rounded-md border transition-colors ${
                              currentPage === page ? 'bg-violet-500 text-white border-violet-500' : 'border-slate-200 bg-white hover:bg-slate-50'
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
                      className="px-3 py-1 text-sm rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      다음
                    </button>
                  </div>
                )}
                <div className="px-4 py-2 text-[10px] text-slate-400 italic border-t border-slate-100">Data source — 캠페인 발송 집계(PG/MySQL)</div>
              </div>
                );
              })()}
            </div>
          )}

          {activeTab === 'test' && (
            <div className="space-y-4">
              {/* 기간 선택 */}
              <div className="flex items-center gap-4">
                <span className="text-sm text-slate-500 font-medium">기간</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400"
                />
                <span className="text-slate-400">~</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400"
                />
                <button
                  onClick={fetchTestStats}
                  disabled={testCooldown > 0}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    testCooldown > 0 ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-orange-500 text-white hover:bg-orange-600'
                  }`}
                >
                  {testCooldown > 0 ? `${testCooldown}초` : '조회'}
                </button>
              </div>

              {/* 요약 카드 */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 shadow-sm">
                  <div className="font-medium text-slate-700 mb-2">전체 테스트</div>
                  <div className="flex justify-between items-end">
                    <div>
                      <span className="text-2xl font-bold text-amber-600">{testStats?.total || 0}</span>
                      <span className="text-sm text-slate-500 ml-1">건</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-slate-500">성공 {testStats?.success || 0} / 실패 {testStats?.fail || 0}</div>
                      <div className="text-lg font-bold text-amber-600">{(testStats?.cost || 0).toLocaleString()}원</div>
                    </div>
                  </div>
                </div>
                <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 shadow-sm">
                  <div className="font-medium text-slate-700 mb-2">담당자 테스트</div>
                  <div className="flex justify-between items-end">
                    <div>
                      <span className="text-xl font-bold text-orange-600">{(testList || []).length}</span>
                      <span className="text-sm text-slate-500 ml-1">건</span>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-400">담당자 발송 테스트</div>
                    </div>
                  </div>
                </div>
                <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4 shadow-sm">
                  <div className="font-medium text-slate-700 mb-2">스팸필터 테스트</div>
                  <div className="flex justify-between items-end">
                    <div>
                      <span className="text-xl font-bold text-violet-600">{spamFilterStats?.total || 0}</span>
                      <span className="text-sm text-slate-500 ml-1">건</span>
                    </div>
                    <div className="text-right">
                      {spamFilterStats && spamFilterStats.total > 0 ? (
                        <div className="text-xs text-slate-400">SMS {spamFilterStats.sms} · LMS {spamFilterStats.lms}</div>
                      ) : (
                        <div className="text-xs text-slate-400">통신사별 스팸 판정</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 담당자 테스트 리스트 */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <div className="bg-slate-50 px-4 py-2.5 font-medium text-sm text-slate-700 border-b">담당자 테스트 이력</div>
                <div className="max-h-[300px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">날짜</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">발송자</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">유형</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">수신번호</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">내용</th>
                        <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500">결과</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(!testList || testList.length === 0) ? (
                        <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">테스트 발송 이력이 없습니다</td></tr>
                      ) : (
                        (testList || [])
                          .slice((testCurrentPage - 1) * itemsPerPage, testCurrentPage * itemsPerPage)
                          .map((t: any) => (
                          <tr key={t.id} className="border-t hover:bg-slate-50">
                            <td className="px-3 py-2 text-xs text-slate-500">
                            {new Date(t.sentAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-700">{t.senderName || '-'}</td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${t.type === 'SMS' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-violet-50 text-violet-700 border border-violet-200'}`}>
                                {t.type}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{t.phone}</td>
                            <MessageCell
                              content={t.content || ''}
                              maxWidth="max-w-[300px]"
                              onShowDetail={(content) => setMsgDetailContent({ content, msgType: t.type })}
                            />
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
                  <div className="flex justify-center items-center gap-2 py-3 border-t bg-slate-50">
                    <button onClick={() => setTestCurrentPage(p => Math.max(1, p - 1))} disabled={testCurrentPage === 1} className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-slate-50 disabled:opacity-40">이전</button>
                    <span className="text-sm text-slate-500">{testCurrentPage} / {Math.ceil(testList.length / itemsPerPage)}</span>
                    <button onClick={() => setTestCurrentPage(p => Math.min(Math.ceil(testList.length / itemsPerPage), p + 1))} disabled={testCurrentPage >= Math.ceil(testList.length / itemsPerPage)} className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-slate-50 disabled:opacity-40">다음</button>
                  </div>
                )}
              </div>

              {/* 스팸필터 테스트 리스트 */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <div className="bg-violet-50 px-4 py-2.5 font-medium text-sm text-violet-700 border-b">스팸필터 테스트 이력</div>
                <div className="max-h-[300px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">날짜</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">발송자</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">유형</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">통신사</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">문안</th>
                        <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500">판정</th>
                      </tr>
                    </thead>
                    <tbody>
                    {(!spamFilterList || spamFilterList.length === 0) ? (
                        <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">스팸필터 테스트 이력이 없습니다</td></tr>
                      ) : (
                        spamFilterList
                          .slice((spamCurrentPage - 1) * itemsPerPage, spamCurrentPage * itemsPerPage)
                          .map((t: any, idx: number) => (
                          <tr key={t.id || idx} className="border-t hover:bg-slate-50">
                            <td className="px-3 py-2 text-xs text-slate-500">
                              {new Date(t.sentAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-700">{t.senderName || '-'}</td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${t.type === 'SMS' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-violet-50 text-violet-700 border border-violet-200'}`}>
                                {t.type}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-xs font-medium">{t.carrier || '-'}</td>
                            <MessageCell
                              content={t.content || ''}
                              maxWidth="max-w-[200px]"
                              onShowDetail={(content) => setMsgDetailContent({ content, msgType: t.type })}
                            />
                            <td className="px-3 py-2 text-center">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                (t.result === 'pass' || t.result === 'received') ? 'bg-green-50 text-green-700'
                                : t.result === 'blocked' ? 'bg-red-50 text-red-700'
                                : (t.result === 'failed' || t.result === 'timeout') ? 'bg-orange-50 text-orange-700'
                                : 'bg-yellow-50 text-yellow-700'
                              }`}>
                                {(t.result === 'pass' || t.result === 'received') ? '정상'
                                  : t.result === 'blocked' ? '차단'
                                  : t.result === 'failed' ? '실패'
                                  : t.result === 'timeout' ? '시간초과'
                                  : '대기'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  </div>
                {spamFilterList && spamFilterList.length > itemsPerPage && (
                  <div className="flex justify-center items-center gap-2 py-3 border-t bg-slate-50">
                    <button onClick={() => setSpamCurrentPage(p => Math.max(1, p - 1))} disabled={spamCurrentPage === 1} className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-slate-50 disabled:opacity-40">이전</button>
                    <span className="text-sm text-slate-500">{spamCurrentPage} / {Math.ceil(spamFilterList.length / itemsPerPage)}</span>
                    <button onClick={() => setSpamCurrentPage(p => Math.min(Math.ceil(spamFilterList.length / itemsPerPage), p + 1))} disabled={spamCurrentPage >= Math.ceil(spamFilterList.length / itemsPerPage)} className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-slate-50 disabled:opacity-40">다음</button>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

        {/* ==================== 캠페인 상세 모달 (CampaignDetailModal로 분리) ==================== */}
        {selectedCampaign && (
          <CampaignDetailModal
            campaign={selectedCampaign}
            detail={campaignDetail}
            alimtalkTemplateInfo={alimtalkTemplateInfo}
            firstMessageContent={messages[0]?.msg_contents}
            statusLabel={getStatusLabel(selectedCampaign)}
            statusBadgeClass={getStatusColor(selectedCampaign)}
            onClose={() => { setSelectedCampaign(null); setShowSendDetail(false); }}
            onShowMessages={() => {
              setShowSendDetail(true);
              setMessagePage(1);
              setMessageSearchValue('');
              setMessageStatus('all');
              fetchMessages(selectedCampaign.id, 1, { status: 'all', searchValue: '' });
            }}
            onImageClick={(url, filename) => setEnlargedImage({ url, filename })}
          />
        )}

        {/* ==================== 발송 내역 팝업 ==================== */}
        {/* ★ D124: 모달 폭 960→1300px 확대 + 각 셀 whitespace-nowrap — 수신번호/날짜/결과코드 줄바꿈 방지 */}
        {showSendDetail && selectedCampaign && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70] p-2 md:p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[1300px] max-h-[90vh] overflow-hidden flex flex-col">
              {/* 헤더 */}
              <div className="flex justify-between items-center px-6 py-4 border-b">
                <div>
                  <h3 className="font-bold text-slate-800">발송 내역</h3>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {selectedCampaign.campaign_name}
                    <span className="mx-1.5 text-slate-300">|</span>
                    발송자: {selectedCampaign.created_by_name || '-'}
                    <span className="mx-1.5 text-slate-300">|</span>
                    총 {messageTotal.toLocaleString()}건
                  </div>
                </div>
                <button onClick={() => setShowSendDetail(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors text-lg">&times;</button>
              </div>

              {/* 검색 + 필터 + 다운로드 */}
              <div className="px-6 py-3 border-b bg-slate-50 flex items-center gap-3 flex-wrap">
                <select
                  value={messageSearchType}
                  onChange={(e) => setMessageSearchType(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200"
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
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                />
                <button
                  onClick={() => { setMessagePage(1); fetchMessages(selectedCampaign.id, 1); }}
                  className="px-4 py-1.5 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 transition-colors"
                >
                  검색
                </button>
                <div className="w-px h-6 bg-slate-200" />
                {(['all', 'success', 'fail', 'substitute'] as const).map(st => {
                  const active = messageStatus === st;
                  const label = st === 'all' ? '전체' : st === 'success' ? '성공' : st === 'fail' ? '실패' : '대체';
                  const activeCls = st === 'success' ? 'bg-green-500 text-white shadow-sm shadow-green-200'
                    : st === 'fail' ? 'bg-rose-500 text-white shadow-sm shadow-rose-200'
                    : st === 'substitute' ? 'bg-amber-400 text-[#3C1E1E] shadow-sm shadow-amber-200'
                    : 'bg-slate-800 text-white shadow-sm';
                  return (
                    <button
                      key={st}
                      onClick={() => { setMessageStatus(st); setMessagePage(1); fetchMessages(selectedCampaign.id, 1, { status: st }); }}
                      className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${active ? activeCls : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'}`}
                    >
                      {label}
                    </button>
                  );
                })}
                <div className="flex-1" />
                <button
                  onClick={() => handleExport(selectedCampaign.id, messageStatus)}
                  className="px-4 py-1.5 bg-slate-700 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
                >
                  엑셀 다운로드
                </button>
              </div>

              {/* 테이블 */}
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0 z-[110]">
                    <tr>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500 w-12">#</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">유형</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">수신번호</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">회신번호</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">메시지내용</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500">등록일시</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500">발송일시</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500">전송결과</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500">결과코드</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500">통신사</th>
                    </tr>
                  </thead>
                  <tbody>
                    {messageLoading ? (
                      <tr><td colSpan={10} className="py-10 text-center text-slate-400">조회 중...</td></tr>
                    ) : messages.length === 0 ? (
                      <tr><td colSpan={10} className="py-10 text-center text-slate-400">
                        {/* ★ 2026-06-13: 취소 문구는 "발송 이력이 없는 취소"에만 — 취소 후 실발송된 캠페인(에이치피오)이
                            행 0건 상황에서 이 문구로 오인되던 것 차단 (행이 있으면 정상 표시됨) */}
                        {selectedCampaign?.status === 'cancelled' && !(Number(selectedCampaign?.success_count) > 0 || Number(selectedCampaign?.fail_count) > 0)
                          ? '취소된 캠페인입니다. 대기중이던 메시지는 취소 시 삭제되었습니다.'
                          : messageSearchValue ? '검색 결과가 없습니다.' : '데이터가 없습니다.'}
                      </td></tr>
                    ) : (
                      messages.map((m: any, idx: number) => {
                        // ★ 2026-06-13: 'scheduled'(발송 예약 — 미발송) 타입 추가, 결과 대기와 구분
                        const statusInfo = { label: m.status_label || `코드 ${m.status_code}`, type: (m.status_type || 'fail') as 'success' | 'fail' | 'pending' | 'scheduled' };
                        const carrier = m.carrier_label || '-';
                        return (
                          <tr key={m.seqno} className="border-t hover:bg-slate-50 transition-colors">
                            <td className="px-3 py-2.5 text-center text-xs text-slate-400">{(messagePage - 1) * messagePerPage + idx + 1}</td>
                            <td className="px-3 py-2.5 text-xs whitespace-nowrap text-slate-600">{m.send_type || '-'}</td>
                            <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{formatPhone(m.dest_no)}</td>
                            <td className="px-3 py-2.5 font-mono text-xs text-slate-600 whitespace-nowrap">{formatPhone(m.call_back)}</td>
                            <MessageCell
                              content={m.msg_contents || ''}
                              onShowDetail={(content) => setMsgDetailContent({
                                content,
                                msgType: m.msg_type, // 'S'/'L'/'M' (MySQL)
                                mmsImages: Array.isArray(selectedCampaign?.mms_image_paths) ? selectedCampaign.mms_image_paths : [],
                              })}
                            />
                            {/* ★ D124: 등록일시 = 캠페인 created_at (한줄로에서 발송을 건 시간). 모든 행 동일 */}
                            <td className="px-3 py-2.5 text-center text-xs text-slate-500 whitespace-nowrap">{selectedCampaign.created_at ? formatDateTime(selectedCampaign.created_at) : '-'}</td>
                            <td className="px-3 py-2.5 text-center text-xs text-slate-500 whitespace-nowrap">{formatDateTime(m.mobsend_time)}</td>
                            <td className="px-3 py-2.5 text-center whitespace-nowrap">
                              {/* ★ 2026-06-13: 발송 예약(미발송) 행은 파란 칩 — 결과 대기와 구분 */}
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                statusInfo.type === 'success' ? 'bg-green-50 text-green-700' : statusInfo.type === 'scheduled' ? 'bg-blue-50 text-blue-700' : statusInfo.type === 'pending' ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700'
                              }`}>
                                {statusInfo.type === 'success' ? '성공' : statusInfo.type === 'scheduled' ? '발송 예약' : statusInfo.type === 'pending' ? '대기' : '실패'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-center text-xs text-slate-500 whitespace-nowrap">{m.status_code} ({statusInfo.label})</td>
                            <td className="px-3 py-2.5 text-center text-xs font-medium whitespace-nowrap">{carrier}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* 페이지네이션 */}
              {messageTotalPages > 0 && (
                <div className="flex items-center justify-center gap-1.5 py-3 border-t bg-slate-50">
                  <button
                    onClick={() => { const p = Math.max(1, messagePage - 1); setMessagePage(p); fetchMessages(selectedCampaign.id, p); }}
                    disabled={messagePage <= 1}
                    className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                        messagePage === page ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white hover:bg-slate-50'
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    onClick={() => { const p = Math.min(messageTotalPages, messagePage + 1); setMessagePage(p); fetchMessages(selectedCampaign.id, p); }}
                    disabled={messagePage >= messageTotalPages}
                    className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    다음
                  </button>
                  <span className="text-xs text-slate-400 ml-2">{messagePage} / {messageTotalPages} 페이지</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================== 예약 취소 확인 모달 ==================== */}
        {cancelTarget && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[400px] max-h-[90vh] overflow-hidden">
              <div className="bg-red-50 px-6 py-4 border-b">
                <h3 className="text-lg font-bold text-red-700">예약 취소</h3>
              </div>
              <div className="p-6">
                <p className="text-slate-700 mb-2">다음 예약 발송을 취소하시겠습니까?</p>
                <div className="bg-slate-50 rounded-lg p-3 text-sm">
                  <div className="text-slate-500">예약 시간</div>
                  <div className="font-medium text-blue-600">
                    {cancelTarget.scheduled_at && new Date(cancelTarget.scheduled_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="text-slate-500 mt-2">발송 건수</div>
                  <div className="font-medium">{cancelTarget.target_count?.toLocaleString()}건</div>
                </div>
                <p className="text-xs text-red-500 mt-3">* 취소된 예약은 복구할 수 없습니다.</p>
              </div>
              <div className="flex border-t">
                <button onClick={() => setCancelTarget(null)} className="flex-1 py-3 text-slate-600 hover:bg-slate-50 font-medium transition-colors">닫기</button>
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/campaigns/${cancelTarget.id}/cancel`, { method: 'POST', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
                      const data = await res.json();
                      if (data.success) {
                        setCancelTarget(null);
                        showToast('success', '예약이 취소되었습니다.');
                        fetchData(true);
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

        {/* ==================== 예약(draft) 취소 확인 모달 (native dialog 대체) ==================== */}
        {draftCancelTarget && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setDraftCancelTarget(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[400px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="bg-rose-50 px-6 py-4 border-b border-rose-100">
                <h3 className="text-lg font-bold text-rose-700">예약 취소</h3>
              </div>
              <div className="p-6">
                <p className="text-slate-700">"{draftCancelTarget.campaign_name}" 예약 발송을 취소하시겠습니까?</p>
                <p className="text-xs text-rose-500 mt-3">* 취소된 예약은 복구할 수 없습니다.</p>
              </div>
              <div className="flex border-t border-slate-200">
                <button onClick={() => setDraftCancelTarget(null)} className="flex-1 py-3 text-slate-600 hover:bg-slate-50 font-medium transition-colors">닫기</button>
                <button
                  onClick={async () => {
                    const c = draftCancelTarget;
                    try {
                      const tk = localStorage.getItem('token');
                      const res = await fetch(`/api/campaigns/${c.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tk}` } });
                      const data = await res.json();
                      if (data.success) {
                        setCampaigns((prev: any[]) => prev.map((x: any) => x.id === c.id ? { ...x, status: 'cancelled' } : x));
                        setDraftCancelTarget(null);
                        showToast('success', '예약이 취소되었습니다.');
                      } else {
                        showToast('error', data.error || '취소에 실패했습니다.');
                      }
                    } catch {
                      showToast('error', '서버 연결 오류가 발생했습니다.');
                    }
                  }}
                  className="flex-1 py-3 bg-rose-500 text-white hover:bg-rose-600 font-medium transition-colors"
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
        {/* ★ D123 P5: MMS 이미지 확대 모달 */}
        {enlargedImage && (
          <div
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-[90] animate-in fade-in duration-150 p-6"
            onClick={() => setEnlargedImage(null)}
          >
            <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setEnlargedImage(null)}
                className="absolute top-2 right-2 z-10 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center text-slate-700 hover:bg-white shadow"
                aria-label="닫기"
              >✕</button>
              <img
                src={enlargedImage.url}
                alt={enlargedImage.filename}
                className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-200"
              />
              <div className="mt-3 px-4 py-2 bg-white/90 rounded-lg text-sm text-slate-700 font-medium shadow">
                {enlargedImage.filename}
              </div>
            </div>
          </div>
        )}
        {/* ★ D93→D120: 메시지 상세보기 모달 — 핸드폰 프레임 스타일 */}
        {/* ★ B6+B7(0417 PDF #6 #7): msgType 우선 타입 판정 + MMS 이미지 표시 */}
        {msgDetailContent !== null && (() => {
          const { content, msgType, mmsImages } = msgDetailContent;
          // ★ 알림톡(msg_type='K')은 카카오 톤 미리보기 — 문자(LMS/SMS/MMS·카카오실패 대체발송)는 아래 기존 문자창
          if (msgType === 'K') {
            return (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80] animate-in fade-in duration-150 p-4" onClick={() => setMsgDetailContent(null)}>
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[400px] max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                  <div className="p-4 border-b bg-amber-50 flex justify-between items-center">
                    <h3 className="font-bold text-lg">📱 메시지 내용</h3>
                    <button onClick={() => setMsgDetailContent(null)} className="text-slate-500 hover:text-slate-700 text-xl">✕</button>
                  </div>
                  <div className="p-4">
                    <div className="mx-auto w-[280px]">
                      <div className="rounded-[1.8rem] p-[3px] bg-gradient-to-b from-[#FEE500] to-[#EAD000] shadow-lg shadow-amber-200">
                        <div className="bg-[#9BBBD4] rounded-[1.6rem] overflow-hidden flex flex-col" style={{ height: '460px' }}>
                          <div className="px-4 py-2.5 bg-[#FEE500] flex items-center gap-1.5 shrink-0">
                            <span className="text-[13px]">💬</span>
                            <span className="text-[12px] font-bold text-[#3C1E1E]">알림톡</span>
                          </div>
                          <div className="flex-1 overflow-y-auto p-3 select-text">
                            <div className="bg-white rounded-xl overflow-hidden shadow-sm max-w-[92%] border border-black/5">
                              <div className="bg-[#FEE500] px-3 py-2 text-[12px] font-bold text-[#3C1E1E]">알림톡 도착</div>
                              <div className="p-3 text-[12px] leading-[1.6] whitespace-pre-wrap break-all text-slate-700 select-text cursor-text">{content}</div>
                              <div className="border-t border-slate-100 px-3 py-2 text-center text-[11px] text-slate-500 bg-slate-50">채널 추가</div>
                            </div>
                          </div>
                          <div className="px-3 py-2 border-t border-black/10 bg-[#FEE500]/40 text-center shrink-0">
                            <span className="text-[10px] text-[#3C1E1E]/70">{calculateSmsBytes(content)} / 2000 bytes</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          }
          // #6 타입 판정: 명시 msgType 우선 (MMS/M, LMS/L, SMS/S). 없으면 바이트 기반 추정
          const typeLabel =
            (msgType === 'MMS' || msgType === 'M') ? 'MMS' :
            (msgType === 'LMS' || msgType === 'L') ? 'LMS' :
            (msgType === 'SMS' || msgType === 'S') ? 'SMS' :
            (calculateSmsBytes(content) > 90 ? 'LMS' : 'SMS');
          const isMms = typeLabel === 'MMS';
          const maxBytes = typeLabel === 'SMS' ? 90 : 2000;
          const hasImages = Array.isArray(mmsImages) && mmsImages.length > 0;
          return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80] animate-in fade-in duration-150 p-4" onClick={() => setMsgDetailContent(null)}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[400px] max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                <div className="p-4 border-b bg-emerald-50 flex justify-between items-center">
                  <h3 className="font-bold text-lg">📱 메시지 내용</h3>
                  <button onClick={() => setMsgDetailContent(null)} className="text-slate-500 hover:text-slate-700 text-xl">✕</button>
                </div>
                <div className="p-4">
                  <div className="mx-auto w-[280px]">
                    <div className="rounded-[1.8rem] p-[3px] bg-gradient-to-b from-purple-400 to-purple-600 shadow-lg shadow-purple-200">
                      <div className="bg-white rounded-[1.6rem] overflow-hidden flex flex-col" style={{ height: '460px' }}>
                        <div className="px-4 py-2.5 bg-gradient-to-r from-slate-50 to-slate-100 flex justify-between items-center shrink-0 border-b">
                          <span className="text-[11px] text-slate-400 font-medium">문자메시지</span>
                          <span className="text-[11px] font-bold text-purple-600">{typeLabel}</span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 bg-gradient-to-b from-purple-50/30 to-white select-text">
                          {/* ★ D131: 첫 화면(폰프레임)과 동일 구조 — 이미지는 본문 아래, size=sm (일관성) */}
                          <div className="flex gap-2">
                            <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center shrink-0 text-xs">📱</div>
                            <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm border border-slate-100 text-[12px] leading-[1.6] whitespace-pre-wrap break-all text-slate-700 max-w-[95%] select-text cursor-text">
                              {content}
                              {isMms && hasImages && (
                                <MmsImagePreview
                                  images={mmsImages!}
                                  size="sm"
                                  onImageClick={(url, filename) => setEnlargedImage({ url, filename })}
                                />
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="px-3 py-2 border-t bg-slate-50 text-center shrink-0">
                          <span className="text-[10px] text-slate-400">
                            {calculateSmsBytes(content)} / {maxBytes} bytes
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
      {/* 캘린더 모달 */}
      {showCalendar && (
        <CalendarModal onClose={() => setShowCalendar(false)} token={token} />
      )}
    </div>
  );
}
