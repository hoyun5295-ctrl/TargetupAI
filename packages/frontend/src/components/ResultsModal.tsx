import { useEffect, useState } from 'react';
import { calculateSmsBytes, formatCampaignMessageForDisplay, formatPhoneNumber } from '../utils/formatDate';
import MmsImagePreview from './shared/MmsImagePreview';
import CalendarModal from './CalendarModal';
import CampaignDetailModal from './CampaignDetailModal';
import {
  Calendar,
  CheckCircle2,
  Download,
  Lock,
  Mail,
  MessageSquare,
  MessagesSquare,
  Send,
  Smartphone,
  TrendingUp,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import {
  MSG_TYPE_LABEL,
  SEND_TYPE_LABEL,
  isAlimtalkChannel,
  isBrandOnlyChannel,
  matchesSendTypeFilter,
  resolveChannelChipClass,
  resolveChannelIconName,
  resolveChannelLabel,
  resolveSendTypeLabel,
} from '../utils/campaign-axis';
import {
  CUI_BTN_OUTLINE,
  CUI_BTN_PRIMARY,
  CUI_MODAL,
  CUI_MODAL_CLOSE,
  CUI_MODAL_HEAD,
  CUI_MODAL_SCRIM,
  CUI_MODAL_TITLE,
  CUI_PANEL,
  CUI_TH,
  CUI_THEAD,
  CUI_TR,
} from '../utils/console-ui';

/** 발송 결과 탭 — 세 탭은 같은 위계라 색을 나누지 않는다(활성만 인디고) */
const RESULT_TABS = [
  { key: 'summary', label: '전송결과' },
  { key: 'scheduled', label: '예약내역' },
  { key: 'test', label: '테스트발송내역' },
] as const;

/** 채널 칩 아이콘 — 판정은 campaign-axis CT, 어떤 컴포넌트를 그릴지는 화면이 정한다 */
const CHANNEL_ICON = {
  alimtalk: MessagesSquare,
  brand: Mail,
  message: MessageSquare,
} as const;

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
    <td className={`px-3 py-3 text-[13px] text-neutral-800 ${maxWidth || 'max-w-[250px]'}`}>
      <button
        onClick={() => onShowDetail(content)}
        className="text-left truncate block max-w-full transition-colors hover:text-indigo-600 hover:underline cursor-pointer"
        title="클릭하여 전체 내용 보기"
      >
        {display}
      </button>
    </td>
  );
}

export default function ResultsModal({ onClose, token, customerDbEnabled, isSubscriptionLocked, onFeatureLocked, onSubscriptionLocked }: ResultsModalProps) {
  // ★ 2026-08-17 탭 3분할 — 전송결과 / 예약내역 / 테스트발송내역.
  //   전에는 예약분이 전송결과 목록에 섞여 있었고 그 목록은 **기간 필터**를 타서,
  //   기본 기간이 오늘까지인 탓에 내일 예약분이 안 보였다(사용자는 발송 실패로 읽었다 — 실측).
  const [activeTab, setActiveTab] = useState<'summary' | 'scheduled' | 'test'>('summary');
  // 예약내역은 **기간 없이 전량**이라 목록 상태를 따로 둔다(전송결과 목록과 섞으면 기간 필터를 다시 타게 된다).
  const [scheduledCampaigns, setScheduledCampaigns] = useState<any[]>([]);
  const [scheduledLoading, setScheduledLoading] = useState(false);
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

  // ★ 2026-08-17 예약내역 — `scope=scheduled`는 서버가 기간 필터를 아예 걸지 않는다.
  //   기간 UI도 이 탭에는 없다: 예약은 "아직 안 나간 것"이라 유한하고, 잘라 보여줄 이유가 없다.
  const fetchScheduled = async () => {
    setScheduledLoading(true);
    try {
      const res = await fetch('/api/v1/results/campaigns?scope=scheduled&limit=2000', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setScheduledCampaigns(data.campaigns || []);
    } catch (error) {
      console.error('예약내역 조회 에러:', error);
    } finally {
      setScheduledLoading(false);
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

  const msgTypeLabel = MSG_TYPE_LABEL;



  const formatDateTime = (dt: string) => {
    if (!dt) return '-';
    return new Date(dt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // ★ D123 P6: 인라인 제거 → formatPhoneNumber 컨트롤타워 사용 (02 지역번호, 대표번호, 050X 전부 정확 처리)
  const formatPhone = (phone: string) => phone ? formatPhoneNumber(phone) : '-';

  // 필터링 — 목록 렌더러는 두 탭이 공유한다(행 배지·채널칩·취소·상세·페이징이 전부 같은 계약이다).
  //   바뀌는 것은 **어느 목록을 먹느냐**뿐이다. 표를 복제하면 한쪽만 고쳐지는 사고가 난다.
  const listSource = activeTab === 'scheduled' ? scheduledCampaigns : campaigns;
  const filteredCampaigns = listSource.filter(c => {
    // ★ 2026-07-31 이분법 폐기 — 'direct'가 아니면 전부 AI로 보던 탓에 자동발송·여정이 AI 필터에 섞였다.
    if (!matchesSendTypeFilter(c.send_type, filterType)) return false;
    if (filterSender !== 'all' && c.created_by_name !== filterSender) return false;
    return true;
  });
  const uniqueSenders = [...new Set(listSource.map(c => c.created_by_name).filter(Boolean))];
  const totalFilteredPages = Math.ceil(filteredCampaigns.length / itemsPerPage);
  const messageTotalPages = Math.ceil(messageTotal / messagePerPage);

  const getStatusLabel = (c: any) => {
    const type = resolveSendTypeLabel(c.send_type);
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
    if (c.status === 'cancelled') return 'bg-neutral-100 text-neutral-600 border border-neutral-200';
    if (c.status === 'failed' || c.status === 'draft') return 'bg-red-50 text-red-700 border border-red-200';
    return 'bg-neutral-50 text-neutral-600 border border-neutral-200';
  };

  return (
    <div className={CUI_MODAL_SCRIM}>
      <div className={`${CUI_MODAL} max-w-[1300px] max-h-[95vh]`} role="dialog" aria-modal="true" aria-label="발송 결과">
        {/* 헤더 */}
        <div className={CUI_MODAL_HEAD}>
          <h2 className={CUI_MODAL_TITLE}>발송 결과</h2>
          <button onClick={onClose} className={CUI_MODAL_CLOSE} aria-label="닫기">
            <X className="w-[17px] h-[17px]" />
          </button>
        </div>

        {/* 탭 — ★ 2026-08-17 활성색을 **정적 클래스**로. 전에는 `border-${tab.color}-500`처럼 런타임 조립이라
            Tailwind가 그 클래스를 생성하지 못해(safelist 부재) 활성 표시가 실제로는 안 그려지고 있었다.
            ★ 2026-08-17(2) 탭마다 다른 색(emerald·violet·orange)을 쓰던 것을 인디고 하나로.
              세 탭은 같은 위계인데 색이 셋이라 어디가 지금인지가 색이 아니라 위치로만 읽혔다.
              폭이 균등(flex-1)이라 밑줄은 인덱스만으로 미끄러진다 — 측정이 필요 없다. */}
        <div className="shrink-0 relative flex border-b border-neutral-200 bg-white" role="tablist">
          {RESULT_TABS.map((tab) => {
            const on = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={on}
                onClick={() => {
                  setActiveTab(tab.key as any);
                  setCurrentPage(1);
                  if (tab.key === 'test') fetchTestStats();
                  if (tab.key === 'scheduled') fetchScheduled();
                }}
                className={`flex-1 h-12 text-center text-[14px] transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-600/15 ${
                  on ? 'font-semibold text-indigo-600' : 'font-medium text-neutral-500 hover:text-neutral-900'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
          <span
            className="absolute bottom-[-1px] left-0 h-0.5 rounded-full bg-indigo-600 transition-transform duration-300 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none"
            style={{
              width: `${100 / RESULT_TABS.length}%`,
              transform: `translateX(${RESULT_TABS.findIndex(t => t.key === activeTab) * 100}%)`,
            }}
          />
        </div>

        {/* 콘텐츠 */}
        <div className="flex-1 overflow-y-auto p-5 relative" style={{ overscrollBehavior: 'contain' }}>
          {/* ★ D120 P6 → 2026-07-09 (Harold 명시): 캘린더 = 요금제 미가입(FREE) 포함 전 요금제 개방.
              발송결과는 basic_send 축(FREE 허용)이고 캘린더 데이터(GET /api/campaigns)도 요금제 게이트가 없다.
              구독 만료/정지 잠금만 유지(전 기능 차단 원칙). */}
          {activeTab === 'summary' && (
            <button
              onClick={() => {
                if (isSubscriptionLocked) { onSubscriptionLocked?.(); return; }
                setShowCalendar(true);
              }}
              className={`absolute top-4 right-5 z-10 h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg text-[13.5px] font-semibold transition ${
                isSubscriptionLocked
                  ? 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
                  : 'bg-white text-neutral-700 border border-neutral-200 hover:bg-neutral-50 hover:border-neutral-300 active:scale-[.98]'
              }`}
            >
              {isSubscriptionLocked
                ? <Lock className="w-[15px] h-[15px]" />
                : <Calendar className="w-[15px] h-[15px]" />}
              캘린더
            </button>
          )}
          {/* ★ 2026-08-17 전송결과·예약내역이 **같은 목록 렌더러**를 공유한다(아래 채널통합조회).
              다른 것은 위쪽 도구 영역뿐 — 예약내역엔 기간 UI가 없고(전량 조회) 결과 요약 카드도 없다
              (예약은 결과가 없어 전부 0으로 떠서 "실패한 건가"로 읽힌다). */}
          {(activeTab === 'summary' || activeTab === 'scheduled') && (
            <div className="space-y-4">
              {activeTab === 'scheduled' && (
                <div className="flex flex-wrap items-center gap-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
                  <div>
                    <div className="text-[11px] font-semibold tracking-wide text-indigo-500">예약 대기</div>
                    <div className="text-xl font-bold text-indigo-700 tabular-nums">{filteredCampaigns.length}건</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold tracking-wide text-indigo-500">발송 대상</div>
                    <div className="text-xl font-bold text-indigo-700 tabular-nums">
                      {filteredCampaigns.reduce((s, c) => s + (Number(c.target_count) || 0), 0).toLocaleString()}명
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold tracking-wide text-indigo-500">가장 이른 발송</div>
                    <div className="text-sm font-semibold text-indigo-700">
                      {(() => {
                        const times = filteredCampaigns
                          .map((c) => c.scheduled_at || c.sentAt)
                          .filter(Boolean)
                          .map((t: string) => new Date(t).getTime())
                          .filter((t) => !isNaN(t));
                        if (times.length === 0) return '-';
                        return new Date(Math.min(...times)).toLocaleString('ko-KR', {
                          month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        });
                      })()}
                    </div>
                  </div>
                  <p className="ml-auto text-[11px] text-indigo-500">기간과 무관하게 예약된 발송을 모두 보여줍니다</p>
                </div>
              )}
              {activeTab === 'scheduled' && scheduledLoading && (
                <div className="py-10 text-center text-sm text-neutral-400">예약내역을 불러오는 중…</div>
              )}
              {/* 기간 선택 + 필터 — 전송결과 전용 */}
              {activeTab === 'summary' && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-neutral-500 font-medium">기간</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="border border-neutral-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                />
                <span className="text-neutral-400">~</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="border border-neutral-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                />
                <div className="w-px h-6 bg-neutral-200" />
                <span className="text-sm text-neutral-500 font-medium">유형</span>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="border border-neutral-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                >
                  <option value="all">전체</option>
                  <option value="direct">{SEND_TYPE_LABEL.direct}</option>
                  <option value="ai">{SEND_TYPE_LABEL.ai}</option>
                  <option value="auto">{SEND_TYPE_LABEL.auto}</option>
                  <option value="journey">{SEND_TYPE_LABEL.journey}</option>
                </select>
                <span className="text-sm text-neutral-500 font-medium">발송자</span>
                <select
                  value={filterSender}
                  onChange={(e) => setFilterSender(e.target.value)}
                  className="border border-neutral-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                >
                  <option value="all">전체</option>
                  {uniqueSenders.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button
                  onClick={() => fetchData()}
                  disabled={cooldown > 0 || loading}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    cooldown > 0 ? 'bg-neutral-100 text-neutral-400 cursor-not-allowed' : 'bg-indigo-500 text-white hover:bg-indigo-600'
                  }`}
                >
                  {loading ? '조회 중...' : cooldown > 0 ? `${cooldown}초` : '조회'}
                </button>
              </div>
              )}

              {/* 요약 카드 — 전송결과 전용(예약은 결과가 없어 전부 0으로 뜬다) */}
              {activeTab === 'summary' && (summary || campaigns.length > 0) && (() => {
                const totalSuccess = filteredCampaigns.reduce((sum, c) => sum + (c.success_count || 0), 0);
                const totalFail = filteredCampaigns.reduce((sum, c) => sum + (c.fail_count || 0), 0);
                // D183: 전송 분모 = sent_count(통신사 발송 누계) 또는 target_count(목표 수) — 대기분 포함
                const totalSent = filteredCampaigns.reduce((sum, c) => sum + (c.sent_count || c.target_count || 0), 0);
                const successRate = totalSent > 0 ? Math.round((totalSuccess / totalSent) * 100) : 0;
                // 메시지 타입별 단가 — 서버가 회사 계약 단가를 이미 해석해 보낸다(무료 계약은 0원 그대로).
                // ★ 2026-07-31 `||` → `??`. 0원 계약이 오면 falsy라 기본 단가로 되살아나, 서버가 지키는
                //   "명시적 0원은 0원" 계약을 화면만 깨고 있었다.
                const perSms = summary?.costs?.perSms ?? 9.9;
                const perLms = summary?.costs?.perLms ?? 27;
                const perMms = summary?.costs?.perMms ?? 50;
                const perKakao = summary?.costs?.perKakao ?? 7.5;
                const perBrand = summary?.costs?.perBrand ?? perKakao;
                const estimatedCost = filteredCampaigns.reduce((sum, c) => {
                  const success = c.success_count || 0;
                  const type = (c.message_type || 'SMS').toUpperCase();
                  // ★ 2026-07-31 판정을 CT로 — 전에는 채널값 'kakao' 하나만 걸러서 전용 발송('kakao_brand')이
                  //   message_type='LMS'로 떨어져 문자 단가로 계산됐다.
                  //   브랜드는 BRAND 단가(cost_per_brand)로 차감되므로 그 단가로 센다 — 알림톡 단가가 아니다.
                  //   ⚠ 'both'는 문자·브랜드가 섞여 있는데 성공 건수가 채널별로 안 나뉜다. 아래 문자 단가로
                  //     계산되는 것은 기존 동작 그대로이고, 분리는 서버 실측 축이 필요한 별건이다.
                  if (isBrandOnlyChannel(c)) return sum + success * perBrand;
                  if (isAlimtalkChannel(c)) return sum + success * perKakao;
                  if (type === 'MMS') return sum + success * perMms;
                  if (type === 'LMS') return sum + success * perLms;
                  return sum + success * perSms;
                }, 0);
                return (
                  // ★ 2026-08-17 그라데이션 타일 5개(violet·emerald·rose·fuchsia·orange)를 걷어냈다.
                  //   숫자를 읽는 카드인데 아이콘이 제일 진해서 시선을 먼저 가져갔다.
                  //   아이콘은 옅은 표면 위 회색으로 내리고, 색은 **숫자에만** 남긴다(성공 green / 실패 rose).
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                      { key: 'sent', label: '총 발송', value: totalSent.toLocaleString(), Icon: Send, cls: 'text-neutral-900', progress: undefined as number | undefined },
                      { key: 'success', label: '성공', value: totalSuccess.toLocaleString(), Icon: CheckCircle2, cls: 'text-emerald-700', progress: undefined as number | undefined },
                      { key: 'fail', label: '실패', value: totalFail.toLocaleString(), Icon: XCircle, cls: totalFail > 0 ? 'text-rose-700' : 'text-neutral-900', progress: undefined as number | undefined },
                      { key: 'rate', label: '성공률', value: `${successRate}%`, Icon: TrendingUp, cls: 'text-indigo-600', progress: successRate as number | undefined },
                      { key: 'cost', label: '예상 비용', value: `₩${Math.round(estimatedCost).toLocaleString()}`, Icon: Wallet, cls: 'text-neutral-900', progress: undefined as number | undefined },
                    ].map(card => {
                      const Icon = card.Icon;
                      return (
                        <div key={card.key} className="rounded-xl border border-neutral-200 bg-white p-4">
                          <div className="flex items-center gap-2 mb-2.5">
                            <div className="w-7 h-7 rounded-lg bg-neutral-100 grid place-items-center text-neutral-500 shrink-0">
                              <Icon className="w-4 h-4" strokeWidth={1.75} />
                            </div>
                            <span className="text-[12.5px] font-medium text-neutral-500">{card.label}</span>
                          </div>
                          <div className={`text-[26px] leading-none font-bold tracking-[-0.03em] tabular-nums ${card.cls}`}>{card.value}</div>
                          {card.progress !== undefined && (
                            <div className="mt-3 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                              <div className="h-full bg-indigo-600 rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, card.progress)}%` }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* ★ 2026-07-23 에이전트(엔진) 발송 유형별 — agent·both 회사만 채워짐 (전송결과 전용) */}
              {activeTab === 'summary' && summary?.agent?.byType?.length > 0 && (
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50/30 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-indigo-100 flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-700 text-xs font-semibold">에이전트 발송</span>
                    <span className="text-xs text-neutral-400">게이트웨이 엔진 집계 · 유형별 (수신자별 상세 없음)</span>
                  </div>
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-white/60">
                      <tr className="border-b border-indigo-100">
                        <th className="h-[42px] px-4 text-left text-[12px] font-semibold text-neutral-500 whitespace-nowrap">유형</th>
                        <th className="h-[42px] px-4 text-right text-[12px] font-semibold text-neutral-500 whitespace-nowrap">전송</th>
                        <th className="h-[42px] px-4 text-right text-[12px] font-semibold text-neutral-500 whitespace-nowrap">성공</th>
                        <th className="h-[42px] px-4 text-right text-[12px] font-semibold text-neutral-500 whitespace-nowrap">실패</th>
                        <th className="h-[42px] px-4 text-right text-[12px] font-semibold text-neutral-500 whitespace-nowrap">성공률</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.agent.byType.map((t: any) => {
                        const rate = Number(t.sent) > 0 ? ((Number(t.success) / Number(t.sent)) * 100).toFixed(1) : '-';
                        return (
                          <tr key={t.msg_type} className="border-b border-indigo-50 last:border-0">
                            <td className="px-4 py-2.5"><span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-700 text-xs font-medium">{t.type_label || t.msg_type}</span></td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-neutral-700">{Number(t.sent).toLocaleString()}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600 font-medium">{Number(t.success).toLocaleString()}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-rose-500">{Number(t.fail).toLocaleString()}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-neutral-600">{Number(t.sent) > 0 ? `${rate}%` : '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                </div>
              )}

              {/* 채널통합조회 테이블 */}
              {(() => {
                const pageRows = filteredCampaigns.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
                const rateBarClass = (rate: number) => rate >= 98 ? 'bg-emerald-500' : rate >= 95 ? 'bg-amber-500' : 'bg-rose-500';
                // ★ 2026-07-31 판정은 campaign-axis CT 단일. 전에는 채널값 'kakao' 하나만 비교해서
                //   전용 발송이 쓰는 'kakao_brand'가 안 걸리고 message_type('LMS')으로 흘러내렸다.
                // ★ 2026-08-17 라벨 앞에 붙이던 이모지 문자('📨'·'💬'·'📱')를 아이콘으로 교체.
                //   이모지는 OS·브라우저마다 다르게 그려지고 글자 크기에 안 맞아 뭉갠다(Harold 지적).
                //   판정은 campaign-axis CT가 소유하고 여기는 컴포넌트만 고른다.
                const channelChip = (c: any) => ({
                  cls: resolveChannelChipClass(c),
                  label: resolveChannelLabel(c),
                  Icon: CHANNEL_ICON[resolveChannelIconName(c)],
                });
                return (
              <div className={CUI_PANEL}>
                <div className="bg-neutral-50 px-4 py-3 border-b border-neutral-200 flex items-center justify-between gap-2">
                  <span className="text-[14px] font-semibold text-neutral-900">
                    채널통합조회
                    <span className="text-[13px] text-neutral-500 font-normal ml-2 tabular-nums">{filteredCampaigns.length}건</span>
                  </span>
                  {/* ★ 2026-08-17 초록 solid → outline. 주요 행동이 아닌데 화면에서 가장 진했다. */}
                  <button
                    onClick={handleExportList}
                    disabled={filteredCampaigns.length === 0}
                    className={`${CUI_BTN_OUTLINE} h-8 px-3 text-[13px]`}
                  >
                    <Download className="w-3.5 h-3.5" /> 엑셀 다운로드
                  </button>
                </div>

                {/* 데스크탑: 테이블 (md 이상) */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-neutral-50 border-b border-neutral-200">
                        <th className="h-[42px] px-3 text-left text-[12px] font-semibold text-neutral-500 whitespace-nowrap">유형</th>
                        <th className="h-[42px] px-3 text-center text-[12px] font-semibold text-neutral-500 whitespace-nowrap">발송자</th>
                        <th className="h-[42px] px-3 text-left text-[12px] font-semibold text-neutral-500 whitespace-nowrap">메시지 내용</th>
                        <th className="h-[42px] px-3 text-center text-[12px] font-semibold text-neutral-500 whitespace-nowrap">등록일시</th>
                        <th className="h-[42px] px-3 text-center text-[12px] font-semibold text-neutral-500 whitespace-nowrap">발송일시</th>
                        <th className="h-[42px] px-3 text-center text-[12px] font-semibold text-neutral-500 whitespace-nowrap">채널</th>
                        <th className="h-[42px] px-3 text-center text-[12px] font-semibold text-neutral-500 whitespace-nowrap">전송건수</th>
                        <th className="h-[42px] px-3 text-center text-[12px] font-semibold text-neutral-500 whitespace-nowrap">성공</th>
                        <th className="h-[42px] px-3 text-center text-[12px] font-semibold text-neutral-500 whitespace-nowrap">실패</th>
                        <th className="h-[42px] px-3 text-center text-[12px] font-semibold text-neutral-500 whitespace-nowrap">대기</th>
                        <th className="h-[42px] px-3 text-center text-[12px] font-semibold text-neutral-500 whitespace-nowrap">성공률</th>
                        <th className="h-[42px] px-3 text-center text-[12px] font-semibold text-neutral-500 whitespace-nowrap min-w-[80px]">보기</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.length === 0 ? (
                        <tr><td colSpan={12} className="px-4 py-10 text-center text-neutral-400">조회된 데이터가 없습니다.</td></tr>
                      ) : (
                        pageRows.map((c) => {
                          const sent = c.sent_count || c.target_count || 0;
                          const successCnt = c.success_count || 0;
                          const failCnt = c.fail_count || 0;
                          const pendingCnt = c.pending_count != null ? Number(c.pending_count) : Math.max(0, sent - successCnt - failCnt);
                          const rate = sent > 0 ? Math.round((successCnt / sent) * 100) : 0;
                          const ch = channelChip(c);
                          return (
                          <tr key={c.id} className="border-t border-neutral-100 hover:bg-indigo-50/50 transition-colors">
                            <td className="px-3 py-3 whitespace-nowrap">
                              <span
                                className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${getStatusColor(c)}`}
                                title={c.status === 'cancelled' && c.cancelled_by_type === 'super_admin' ? `관리자 취소 / 사유: ${c.cancel_reason || '없음'}` : ''}
                              >
                                {getStatusLabel(c)}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-center text-[13px] text-neutral-800 whitespace-nowrap">{c.created_by_name || '-'}</td>
                            <MessageCell
                              content={formatCampaignMessageForDisplay(c)}
                              onShowDetail={(content) => setMsgDetailContent({
                                content,
                                msgType: c.message_type,
                                mmsImages: Array.isArray(c.mms_image_paths) ? c.mms_image_paths : (typeof c.mms_image_paths === 'string' ? (() => { try { return JSON.parse(c.mms_image_paths); } catch { return []; } })() : []),
                              })}
                            />
                            <td className="px-3 py-3 text-center text-[13px] text-neutral-500 tabular-nums whitespace-nowrap">
                              {new Date(c.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="px-3 py-3 text-center text-[13px] whitespace-nowrap">
                              {c.scheduled_at ? (
                                c.status === 'cancelled' ? (
                                  <span className="text-neutral-400 line-through">
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
                                <span className="text-neutral-500">{new Date(c.sent_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                              ) : '-'}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`inline-flex items-center gap-1 h-[22px] px-2 rounded-md text-[12px] font-semibold ${ch.cls}`}><ch.Icon className="w-3 h-3" strokeWidth={2} />{ch.label}</span>
                            </td>
                            <td className="px-3 py-2.5 text-center font-medium text-neutral-700">{sent.toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-center text-emerald-600 font-medium">{successCnt.toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-center text-rose-600 font-medium">{failCnt.toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-center text-amber-500 font-medium">{pendingCnt.toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <div className="w-12 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                                  <div className={`h-full rounded-full ${rateBarClass(rate)}`} style={{ width: `${rate}%` }} />
                                </div>
                                <span className="text-xs font-medium text-neutral-600">{rate}%</span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => { setMessages([]); setShowSendDetail(false); setSelectedCampaign(c); fetchCampaignDetail(c.id); }}
                                  className="text-indigo-600 hover:text-indigo-700 text-xs font-medium hover:underline"
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
                <div className="md:hidden divide-y divide-neutral-100">
                  {pageRows.length === 0 ? (
                    <div className="px-4 py-10 text-center text-neutral-400 text-sm">조회된 데이터가 없습니다.</div>
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
                              <span className={`inline-flex items-center gap-1 h-[22px] px-2 rounded-md text-[12px] font-semibold ${ch.cls}`}><ch.Icon className="w-3 h-3" strokeWidth={2} />{ch.label}</span>
                            </div>
                            <button
                              onClick={() => { setMessages([]); setShowSendDetail(false); setSelectedCampaign(c); fetchCampaignDetail(c.id); }}
                              className="h-7 px-2.5 rounded-md text-[12.5px] font-semibold text-indigo-600 transition hover:bg-indigo-600 hover:text-white"
                            >
                              상세
                            </button>
                          </div>
                          <div className="text-sm text-neutral-700 mb-2 break-all">{msgPreview.length > 60 ? msgPreview.slice(0, 60) + '…' : msgPreview}</div>
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-neutral-500">전송 <span className="font-medium text-neutral-700">{sent.toLocaleString()}</span></span>
                            <span className="text-neutral-500">성공 <span className="font-medium text-emerald-600">{successCnt.toLocaleString()}</span></span>
                            <span className="flex items-center gap-1">
                              <span className="w-10 h-1.5 rounded-full bg-neutral-100 overflow-hidden inline-block">
                                <span className={`block h-full rounded-full ${rateBarClass(rate)}`} style={{ width: `${rate}%` }} />
                              </span>
                              <span className="font-medium text-neutral-600">{rate}%</span>
                            </span>
                            {c.created_by_name && <span className="text-neutral-400 ml-auto">{c.created_by_name}</span>}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* 페이지네이션 */}
                {totalFilteredPages > 1 && (
                  <div className="flex items-center justify-center gap-1.5 py-3 border-t border-neutral-200 bg-neutral-50">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 text-sm rounded-md border border-neutral-200 bg-white hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      이전
                    </button>
                    {Array.from({ length: totalFilteredPages }, (_, i) => i + 1)
                      .filter(page => Math.abs(page - currentPage) <= 2 || page === 1 || page === totalFilteredPages)
                      .map((page, idx, arr) => (
                        <span key={page}>
                          {idx > 0 && arr[idx - 1] !== page - 1 && <span className="px-1 text-neutral-300">...</span>}
                          <button
                            onClick={() => setCurrentPage(page)}
                            className={`w-8 h-8 text-sm rounded-md border transition-colors ${
                              currentPage === page ? 'bg-indigo-500 text-white border-indigo-500' : 'border-neutral-200 bg-white hover:bg-neutral-50'
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
                      className="px-3 py-1 text-sm rounded-md border border-neutral-200 bg-white hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      다음
                    </button>
                  </div>
                )}
                <div className="px-4 py-2 text-[10px] text-neutral-400 italic border-t border-neutral-100">Data source — 캠페인 발송 집계(PG/MySQL)</div>
              </div>
                );
              })()}
            </div>
          )}

          {activeTab === 'test' && (
            <div className="space-y-4">
              {/* 기간 선택 */}
              <div className="flex items-center gap-4">
                <span className="text-sm text-neutral-500 font-medium">기간</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="border border-neutral-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400"
                />
                <span className="text-neutral-400">~</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="border border-neutral-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400"
                />
                <button
                  onClick={fetchTestStats}
                  disabled={testCooldown > 0}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    testCooldown > 0 ? 'bg-neutral-100 text-neutral-400 cursor-not-allowed' : 'bg-orange-500 text-white hover:bg-orange-600'
                  }`}
                >
                  {testCooldown > 0 ? `${testCooldown}초` : '조회'}
                </button>
              </div>

              {/* 요약 카드 */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 shadow-sm">
                  <div className="font-medium text-neutral-700 mb-2">전체 테스트</div>
                  <div className="flex justify-between items-end">
                    <div>
                      <span className="text-2xl font-bold text-amber-600">{testStats?.total || 0}</span>
                      <span className="text-sm text-neutral-500 ml-1">건</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-neutral-500">성공 {testStats?.success || 0} / 실패 {testStats?.fail || 0}</div>
                      <div className="text-lg font-bold text-amber-600">{(testStats?.cost || 0).toLocaleString()}원</div>
                    </div>
                  </div>
                </div>
                <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 shadow-sm">
                  <div className="font-medium text-neutral-700 mb-2">담당자 테스트</div>
                  <div className="flex justify-between items-end">
                    <div>
                      <span className="text-xl font-bold text-orange-600">{(testList || []).length}</span>
                      <span className="text-sm text-neutral-500 ml-1">건</span>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-neutral-400">담당자 발송 테스트</div>
                    </div>
                  </div>
                </div>
                <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 shadow-sm">
                  <div className="font-medium text-neutral-700 mb-2">스팸필터 테스트</div>
                  <div className="flex justify-between items-end">
                    <div>
                      <span className="text-xl font-bold text-indigo-600">{spamFilterStats?.total || 0}</span>
                      <span className="text-sm text-neutral-500 ml-1">건</span>
                    </div>
                    <div className="text-right">
                      {spamFilterStats && spamFilterStats.total > 0 ? (
                        <div className="text-xs text-neutral-400">SMS {spamFilterStats.sms} · LMS {spamFilterStats.lms}</div>
                      ) : (
                        <div className="text-xs text-neutral-400">통신사별 스팸 판정</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 담당자 테스트 리스트 */}
              <div className="border border-neutral-200 rounded-2xl overflow-hidden">
                <div className="bg-neutral-50 px-4 py-2.5 font-medium text-sm text-neutral-700 border-b">담당자 테스트 이력</div>
                <div className="max-h-[300px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">날짜</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">발송자</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">유형</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">수신번호</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">내용</th>
                        <th className="px-3 py-2 text-center text-xs font-semibold text-neutral-500">결과</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(!testList || testList.length === 0) ? (
                        <tr><td colSpan={6} className="px-3 py-8 text-center text-neutral-400">테스트 발송 이력이 없습니다</td></tr>
                      ) : (
                        (testList || [])
                          .slice((testCurrentPage - 1) * itemsPerPage, testCurrentPage * itemsPerPage)
                          .map((t: any) => (
                          <tr key={t.id} className="border-t hover:bg-neutral-50">
                            <td className="px-3 py-2 text-xs text-neutral-500">
                            {new Date(t.sentAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="px-3 py-2 text-xs text-neutral-700">{t.senderName || '-'}</td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${t.type === 'SMS' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-indigo-50 text-indigo-700 border border-indigo-200'}`}>
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
                  <div className="flex justify-center items-center gap-2 py-3 border-t bg-neutral-50">
                    <button onClick={() => setTestCurrentPage(p => Math.max(1, p - 1))} disabled={testCurrentPage === 1} className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-neutral-50 disabled:opacity-40">이전</button>
                    <span className="text-sm text-neutral-500">{testCurrentPage} / {Math.ceil(testList.length / itemsPerPage)}</span>
                    <button onClick={() => setTestCurrentPage(p => Math.min(Math.ceil(testList.length / itemsPerPage), p + 1))} disabled={testCurrentPage >= Math.ceil(testList.length / itemsPerPage)} className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-neutral-50 disabled:opacity-40">다음</button>
                  </div>
                )}
              </div>

              {/* 스팸필터 테스트 리스트 */}
              <div className="border border-neutral-200 rounded-2xl overflow-hidden">
                <div className="bg-indigo-50 px-4 py-2.5 font-medium text-sm text-indigo-700 border-b">스팸필터 테스트 이력</div>
                <div className="max-h-[300px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">날짜</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">발송자</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">유형</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">통신사</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">문안</th>
                        <th className="px-3 py-2 text-center text-xs font-semibold text-neutral-500">판정</th>
                      </tr>
                    </thead>
                    <tbody>
                    {(!spamFilterList || spamFilterList.length === 0) ? (
                        <tr><td colSpan={6} className="px-3 py-8 text-center text-neutral-400">스팸필터 테스트 이력이 없습니다</td></tr>
                      ) : (
                        spamFilterList
                          .slice((spamCurrentPage - 1) * itemsPerPage, spamCurrentPage * itemsPerPage)
                          .map((t: any, idx: number) => (
                          <tr key={t.id || idx} className="border-t hover:bg-neutral-50">
                            <td className="px-3 py-2 text-xs text-neutral-500">
                              {new Date(t.sentAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="px-3 py-2 text-xs text-neutral-700">{t.senderName || '-'}</td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${t.type === 'SMS' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-indigo-50 text-indigo-700 border border-indigo-200'}`}>
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
                  <div className="flex justify-center items-center gap-2 py-3 border-t bg-neutral-50">
                    <button onClick={() => setSpamCurrentPage(p => Math.max(1, p - 1))} disabled={spamCurrentPage === 1} className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-neutral-50 disabled:opacity-40">이전</button>
                    <span className="text-sm text-neutral-500">{spamCurrentPage} / {Math.ceil(spamFilterList.length / itemsPerPage)}</span>
                    <button onClick={() => setSpamCurrentPage(p => Math.min(Math.ceil(spamFilterList.length / itemsPerPage), p + 1))} disabled={spamCurrentPage >= Math.ceil(spamFilterList.length / itemsPerPage)} className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-neutral-50 disabled:opacity-40">다음</button>
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
                  <h3 className="font-bold text-neutral-800">발송 내역</h3>
                  <div className="text-xs text-neutral-500 mt-0.5">
                    {selectedCampaign.campaign_name}
                    <span className="mx-1.5 text-neutral-300">|</span>
                    발송자: {selectedCampaign.created_by_name || '-'}
                    <span className="mx-1.5 text-neutral-300">|</span>
                    총 {messageTotal.toLocaleString()}건
                  </div>
                </div>
                <button onClick={() => setShowSendDetail(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors text-lg">&times;</button>
              </div>

              {/* 검색 + 필터 + 다운로드 */}
              <div className="px-6 py-3 border-b bg-neutral-50 flex items-center gap-3 flex-wrap">
                <select
                  value={messageSearchType}
                  onChange={(e) => setMessageSearchType(e.target.value)}
                  className="border border-neutral-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200"
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
                  className="border border-neutral-300 rounded-lg px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                />
                <button
                  onClick={() => { setMessagePage(1); fetchMessages(selectedCampaign.id, 1); }}
                  className="px-4 py-1.5 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 transition-colors"
                >
                  검색
                </button>
                <div className="w-px h-6 bg-neutral-200" />
                {(['all', 'success', 'fail', 'substitute'] as const).map(st => {
                  const active = messageStatus === st;
                  const label = st === 'all' ? '전체' : st === 'success' ? '성공' : st === 'fail' ? '실패' : '대체';
                  const activeCls = st === 'success' ? 'bg-green-500 text-white shadow-sm shadow-green-200'
                    : st === 'fail' ? 'bg-rose-500 text-white shadow-sm shadow-rose-200'
                    : st === 'substitute' ? 'bg-amber-400 text-[#3C1E1E] shadow-sm shadow-amber-200'
                    : 'bg-neutral-800 text-white shadow-sm';
                  return (
                    <button
                      key={st}
                      onClick={() => { setMessageStatus(st); setMessagePage(1); fetchMessages(selectedCampaign.id, 1, { status: st }); }}
                      className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${active ? activeCls : 'bg-white border border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:text-neutral-700'}`}
                    >
                      {label}
                    </button>
                  );
                })}
                <div className="flex-1" />
                <button
                  onClick={() => handleExport(selectedCampaign.id, messageStatus)}
                  className="px-4 py-1.5 bg-neutral-700 text-white rounded-lg text-sm font-medium hover:bg-neutral-800 transition-colors"
                >
                  엑셀 다운로드
                </button>
              </div>

              {/* 테이블 */}
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 sticky top-0 z-[110]">
                    <tr>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-neutral-500 w-12">#</th>
                      <th className="h-[42px] px-3 text-left text-[12px] font-semibold text-neutral-500 whitespace-nowrap">유형</th>
                      <th className="h-[42px] px-3 text-left text-[12px] font-semibold text-neutral-500 whitespace-nowrap">수신번호</th>
                      <th className="h-[42px] px-3 text-left text-[12px] font-semibold text-neutral-500 whitespace-nowrap">회신번호</th>
                      <th className="h-[42px] px-3 text-left text-[12px] font-semibold text-neutral-500 whitespace-nowrap">메시지내용</th>
                      <th className="h-[42px] px-3 text-center text-[12px] font-semibold text-neutral-500 whitespace-nowrap">등록일시</th>
                      <th className="h-[42px] px-3 text-center text-[12px] font-semibold text-neutral-500 whitespace-nowrap">발송일시</th>
                      <th className="h-[42px] px-3 text-center text-[12px] font-semibold text-neutral-500 whitespace-nowrap">전송결과</th>
                      <th className="h-[42px] px-3 text-center text-[12px] font-semibold text-neutral-500 whitespace-nowrap">결과코드</th>
                      <th className="h-[42px] px-3 text-center text-[12px] font-semibold text-neutral-500 whitespace-nowrap">통신사</th>
                    </tr>
                  </thead>
                  <tbody>
                    {messageLoading ? (
                      <tr><td colSpan={10} className="py-10 text-center text-neutral-400">조회 중...</td></tr>
                    ) : messages.length === 0 ? (
                      <tr><td colSpan={10} className="py-10 text-center text-neutral-400">
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
                          <tr key={m.seqno} className="border-t hover:bg-neutral-50 transition-colors">
                            <td className="px-3 py-2.5 text-center text-xs text-neutral-400">{(messagePage - 1) * messagePerPage + idx + 1}</td>
                            <td className="px-3 py-2.5 text-xs whitespace-nowrap text-neutral-600">{m.send_type || '-'}</td>
                            <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{formatPhone(m.dest_no)}</td>
                            <td className="px-3 py-2.5 font-mono text-xs text-neutral-600 whitespace-nowrap">{formatPhone(m.call_back)}</td>
                            <MessageCell
                              content={m.msg_contents || ''}
                              onShowDetail={(content) => setMsgDetailContent({
                                content,
                                msgType: m.msg_type, // 'S'/'L'/'M' (MySQL)
                                mmsImages: Array.isArray(selectedCampaign?.mms_image_paths) ? selectedCampaign.mms_image_paths : [],
                              })}
                            />
                            {/* ★ D124: 등록일시 = 캠페인 created_at (한줄로에서 발송을 건 시간). 모든 행 동일 */}
                            <td className="px-3 py-2.5 text-center text-xs text-neutral-500 whitespace-nowrap">{selectedCampaign.created_at ? formatDateTime(selectedCampaign.created_at) : '-'}</td>
                            {/* ★ 발송일시 = sendreq_time(발송요청/예약 시각, KST·D98) — 목록 COALESCE(scheduled_at,sent_at)와 동일 기준(D233+). mobsend_time(통신사 응답)은 지연 시 다음날·대기 시 빈칸이라 불일치 */}
                            <td className="px-3 py-2.5 text-center text-xs text-neutral-500 whitespace-nowrap">{formatDateTime(m.sendreq_time)}</td>
                            <td className="px-3 py-2.5 text-center whitespace-nowrap">
                              {/* ★ 2026-06-13: 발송 예약(미발송) 행은 파란 칩 — 결과 대기와 구분 */}
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                statusInfo.type === 'success' ? 'bg-green-50 text-green-700' : statusInfo.type === 'scheduled' ? 'bg-blue-50 text-blue-700' : statusInfo.type === 'pending' ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700'
                              }`}>
                                {statusInfo.type === 'success' ? '성공' : statusInfo.type === 'scheduled' ? '발송 예약' : statusInfo.type === 'pending' ? '대기' : '실패'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-center text-xs text-neutral-500 whitespace-nowrap">{m.status_code} ({statusInfo.label})</td>
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
                <div className="flex items-center justify-center gap-1.5 py-3 border-t bg-neutral-50">
                  <button
                    onClick={() => { const p = Math.max(1, messagePage - 1); setMessagePage(p); fetchMessages(selectedCampaign.id, p); }}
                    disabled={messagePage <= 1}
                    className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                        messagePage === page ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white hover:bg-neutral-50'
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    onClick={() => { const p = Math.min(messageTotalPages, messagePage + 1); setMessagePage(p); fetchMessages(selectedCampaign.id, p); }}
                    disabled={messagePage >= messageTotalPages}
                    className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    다음
                  </button>
                  <span className="text-xs text-neutral-400 ml-2">{messagePage} / {messageTotalPages} 페이지</span>
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
                <p className="text-neutral-700 mb-2">다음 예약 발송을 취소하시겠습니까?</p>
                <div className="bg-neutral-50 rounded-lg p-3 text-sm">
                  <div className="text-neutral-500">예약 시간</div>
                  <div className="font-medium text-blue-600">
                    {cancelTarget.scheduled_at && new Date(cancelTarget.scheduled_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="text-neutral-500 mt-2">발송 건수</div>
                  <div className="font-medium">{cancelTarget.target_count?.toLocaleString()}건</div>
                </div>
                <p className="text-xs text-red-500 mt-3">* 취소된 예약은 복구할 수 없습니다.</p>
              </div>
              <div className="flex border-t">
                <button onClick={() => setCancelTarget(null)} className="flex-1 py-3 text-neutral-600 hover:bg-neutral-50 font-medium transition-colors">닫기</button>
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
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[400px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="bg-rose-50 px-6 py-4 border-b border-rose-100">
                <h3 className="text-lg font-bold text-rose-700">예약 취소</h3>
              </div>
              <div className="p-6">
                <p className="text-neutral-700">"{draftCancelTarget.campaign_name}" 예약 발송을 취소하시겠습니까?</p>
                <p className="text-xs text-rose-500 mt-3">* 취소된 예약은 복구할 수 없습니다.</p>
              </div>
              <div className="flex border-t border-neutral-200">
                <button onClick={() => setDraftCancelTarget(null)} className="flex-1 py-3 text-neutral-600 hover:bg-neutral-50 font-medium transition-colors">닫기</button>
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
          <div className={`fixed top-6 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg shadow-lg z-[10000] text-sm font-medium ${
            toast.type === 'success' ? 'bg-neutral-900 text-white' : 'bg-rose-600 text-white'
          }`}>
            {toast.message}
          </div>
        )}
        {/* ★ D123 P5: MMS 이미지 확대 모달 */}
        {enlargedImage && (
          <div
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-[90] animate-in fade-in duration-150 p-6"
          >
            <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setEnlargedImage(null)}
                className="absolute top-2 right-2 z-10 w-9 h-9 bg-white/90 rounded-full grid place-items-center text-neutral-700 transition hover:bg-white shadow"
                aria-label="닫기"
              ><X className="w-[17px] h-[17px]" /></button>
              <img
                src={enlargedImage.url}
                alt={enlargedImage.filename}
                className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-200"
              />
              <div className="mt-3 px-4 py-2 bg-white/90 rounded-lg text-sm text-neutral-700 font-medium shadow">
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
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80] animate-in fade-in duration-150 p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[400px] max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                  <div className="px-5 py-4 border-b border-neutral-200 flex justify-between items-center gap-4">
                    <h3 className="text-[16px] font-bold tracking-[-0.02em] text-neutral-900">메시지 내용</h3>
                    <button onClick={() => setMsgDetailContent(null)} className={CUI_MODAL_CLOSE} aria-label="닫기"><X className="w-[17px] h-[17px]" /></button>
                  </div>
                  <div className="p-4">
                    <div className="mx-auto w-[280px]">
                      <div className="rounded-[1.8rem] p-[3px] bg-gradient-to-b from-[#FEE500] to-[#EAD000] shadow-lg shadow-amber-200">
                        <div className="bg-[#9BBBD4] rounded-[1.6rem] overflow-hidden flex flex-col" style={{ height: '460px' }}>
                          <div className="px-4 py-2.5 bg-[#FEE500] flex items-center gap-1.5 shrink-0">
                            <MessageSquare className="w-3.5 h-3.5 text-[#3C1E1E]" strokeWidth={2.2} />
                            <span className="text-[12px] font-bold text-[#3C1E1E]">알림톡</span>
                          </div>
                          <div className="flex-1 overflow-y-auto p-3 select-text">
                            <div className="bg-white rounded-xl overflow-hidden shadow-sm max-w-[92%] border border-black/5">
                              <div className="bg-[#FEE500] px-3 py-2 text-[12px] font-bold text-[#3C1E1E]">알림톡 도착</div>
                              <div className="p-3 text-[12px] leading-[1.6] whitespace-pre-wrap break-all text-neutral-700 select-text cursor-text">{content}</div>
                              <div className="border-t border-neutral-100 px-3 py-2 text-center text-[11px] text-neutral-500 bg-neutral-50">채널 추가</div>
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
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80] animate-in fade-in duration-150 p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[400px] max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-neutral-200 flex justify-between items-center gap-4">
                  <h3 className="text-[16px] font-bold tracking-[-0.02em] text-neutral-900">메시지 내용</h3>
                  <button onClick={() => setMsgDetailContent(null)} className={CUI_MODAL_CLOSE} aria-label="닫기"><X className="w-[17px] h-[17px]" /></button>
                </div>
                <div className="p-4">
                  <div className="mx-auto w-[280px]">
                    <div className="rounded-[1.8rem] p-[3px] bg-gradient-to-b from-neutral-300 to-neutral-500 shadow-lg shadow-neutral-300/60">
                      <div className="bg-white rounded-[1.6rem] overflow-hidden flex flex-col" style={{ height: '460px' }}>
                        <div className="px-4 py-2.5 bg-gradient-to-r from-neutral-50 to-neutral-100 flex justify-between items-center shrink-0 border-b">
                          <span className="text-[11px] text-neutral-400 font-medium">문자메시지</span>
                          <span className="text-[11px] font-bold text-indigo-600">{typeLabel}</span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 bg-gradient-to-b from-indigo-50/40 to-white select-text">
                          {/* ★ D131: 첫 화면(폰프레임)과 동일 구조 — 이미지는 본문 아래, size=sm (일관성) */}
                          <div className="flex gap-2">
                            <div className="w-7 h-7 rounded-full bg-indigo-100 grid place-items-center shrink-0 text-indigo-600"><Smartphone className="w-3.5 h-3.5" strokeWidth={2} /></div>
                            <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm border border-neutral-100 text-[12px] leading-[1.6] whitespace-pre-wrap break-all text-neutral-700 max-w-[95%] select-text cursor-text">
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
                        <div className="px-3 py-2 border-t bg-neutral-50 text-center shrink-0">
                          <span className="text-[10px] text-neutral-400">
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
