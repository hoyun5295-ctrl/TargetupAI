/**
 * PerformancePage.tsx — 성과 리포트 전면 재설계 (2026-06-08)
 *
 * 분석 중심 3단 위계 (난잡 금지):
 *   Tier 1 — 헤드라인: 핵심 KPI 4 큰 카드(매출·ROAS·성공률·활성고객) + AI 한 줄 진단
 *   Tier 2 — 요약 아이콘 바: 칩 클릭 → 세부 모달 (채널/시간대/퍼널/기여/코호트/벤치마크/추세)
 *   Tier 3 — 액션 & 보조: 1-click 액션 3 + Top 캠페인 + 어제 인사이트 접이식 칩
 *   세부 차트 = 전부 다크 모달(PerfModal)로 격리. 자사몰 연동 여부로 매출/ROAS/퍼널/기여 적응형.
 *
 * 영구 룰:
 *   - 다크 톤 bg-slate-950 + violet 액센트
 *   - 모델명 UI 노출 0 (AI 모델 추상 표기만)
 *   - native dialog(alert/confirm/prompt) 0 — ConfirmModal/useToast/CreditConfirmModal
 *   - 모든 카드/차트 source caption 의무
 *   - 모바일 반응형 + 임의상수 0(실데이터 근거)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import {
  ArrowLeft, BarChart3, Brain, Clock, Loader2, RefreshCw, Sparkles, TrendingUp, Users,
  AlertTriangle, MousePointerClick, Database, Activity, ChevronRight, ChevronLeft, ChevronDown, ChevronUp,
  Search, Filter, ArrowUpDown, FileDown, X, Check, Crown,
} from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import CreditConfirmModal from '../components/credit/CreditConfirmModal';

type PerformancePeriod = '7d' | '14d' | '30d' | '90d';

interface PerformanceMetricV2 {
  current: number;
  previous: number;
  diffPct: number;
  betterThan: boolean;
}

interface ChannelROI {
  channel: string;
  sent: number;
  success: number;
  successRate: number;
  estimatedRevenue: number;
  estimatedCost: number;
  roas: number;
  previousSent: number;
}

interface HourWeekdayCell {
  hour: number;
  weekday: number;
  sent: number;
  successRate: number;
}

interface PerformanceTrend {
  date: string;
  sent: number;
  success: number;
}

interface TopCampaign {
  id: string;
  name: string;
  messageType: string;
  sent: number;
  success: number;
  successRate: number;
  estimatedRevenue: number;
  roas: number;
  sentAt: string;
  isAd: boolean;
}

interface FunnelStats {
  viewCount: number;
  cartAddCount: number;
  wishlistAddCount: number;
  purchaseCount: number;
  cartConversionRate: number;
  purchaseConversionRate: number;
  cartToPurchaseRate: number;
}

interface SnapshotV2 {
  period: PerformancePeriod;
  periodDays: number;
  totalCampaigns: PerformanceMetricV2;
  totalSent: PerformanceMetricV2;
  successRate: PerformanceMetricV2;
  newCustomers: PerformanceMetricV2;
  activeCustomers: PerformanceMetricV2;
  estimatedRevenue: PerformanceMetricV2;
  estimatedRoas: PerformanceMetricV2;  // 블렌디드 ROAS (백엔드 신규)
  byChannelROI: ChannelROI[];
  byHourWeekday: HourWeekdayCell[];
  byDailyTrend: PerformanceTrend[];
  byDailyTrendPrevious: PerformanceTrend[];
  funnelStats?: FunnelStats;
  topCampaigns: TopCampaign[];
  computedAt: string;
  source: string;
}

interface ExplainFactor {
  category: string;
  label: string;
  impactScore: number;
  direction: 'positive' | 'negative' | 'neutral';
  detail: string;
  sourceField: string;
}

interface PerformanceExplanation {
  overallScore: number;
  topInsight: string;
  factors: ExplainFactor[];
  recommendation: string;
  explainedAt: string;
}

interface DataAvailabilityCard {
  level: 'critical' | 'warning' | 'info' | 'good';
  icon: string;
  title: string;
  message: string;
  actionLabel?: string;
  actionPath?: string;
}

interface DataAvailability {
  customerCount: number;
  campaignCount: number;
  cdpEventCount: number;
  hasCdpIntegration: boolean;
  cards: DataAvailabilityCard[];
  overallLevel: 'critical' | 'warning' | 'info' | 'good';
  computedAt: string;
}

interface CohortRow {
  cohortMonth: string;
  totalCustomers: number;
  m1Active: number;
  m2Active: number;
  m3Active: number;
  m6Active: number;
  m1Rate: number;
  m2Rate: number;
  m3Rate: number;
  m6Rate: number;
}

interface CohortResult {
  cohorts: CohortRow[];
  totalCohortCustomers: number;
  avgM1Rate: number;
  avgM3Rate: number;
  source: string;
  computedAt: string;
}

interface AttributionWindow {
  windowLabel: string;
  windowHours: number;
  cdpPurchaseCount: number;
  cdpRevenue: number;
  customerPurchaseCount: number;
  source: string;
}

interface AttributionResult {
  totalCampaigns: number;
  totalSent: number;
  totalSuccess: number;
  windows: AttributionWindow[];
  hasCdpData: boolean;
  analysisPeriodDays: number;
  computedAt: string;
  source: string;
}

interface DrillCampaign {
  id: string;
  name: string;
  messageType: string;
  isAd: boolean;
  sent: number;
  success: number;
  successRate: number;
  cost: number;
  sentAt: string;
}

// ★ 2026-07-03 고객 축 — 등급 성과 + 수신 고객 정밀 기여 (customer-axis endpoint)
interface GradePerformanceRow {
  grade: string;
  journeySent: number;
  dmSent: number;
  dmViewers: number;
  emailClickers: number;
  smsTargetedSent: number;
  buyers: number;
  revenue: number;
}

interface RecipientAttributionWindow {
  windowLabel: string;
  windowHours: number;
  buyers: number;
  purchases: number;
  revenue: number;
}

interface RecipientAttribution {
  totalRecipients: number;
  windows: RecipientAttributionWindow[];
  computedAt: string;
  source: string;
}

type ModalKey =
  | null | 'revenue' | 'channel' | 'hour' | 'funnel'
  | 'cohort' | 'trend' | 'diagnosis' | 'campaigns' | 'grade';

type QuickActionType = 'channel_recovery' | 'time_optimization' | 'top_performer_replication';

const PERIOD_OPTIONS: { value: PerformancePeriod; label: string }[] = [
  { value: '7d', label: '7일' },
  { value: '14d', label: '14일' },
  { value: '30d', label: '30일' },
  { value: '90d', label: '90일' },
];

const WEEKDAY_LABEL = ['일', '월', '화', '수', '목', '금', '토'];

const periodToDays = (p: PerformancePeriod): number => ({ '7d': 7, '14d': 14, '30d': 30, '90d': 90 }[p]);

// ─── 순수 포맷 헬퍼 (DB-free) ───
const formatPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const formatWon = (n: number) => `${Math.round(n).toLocaleString()}원`;
const formatRoas = (n: number) => (n > 0 ? `${n.toFixed(2)}×` : '—');
const formatNum = (n: number) => Math.round(n).toLocaleString();
const formatDiff = (m: PerformanceMetricV2) =>
  m.diffPct === 0 ? '변동 없음' : `${m.diffPct >= 0 ? '+' : ''}${m.diffPct.toFixed(1)}%`;

export default function PerformancePage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<PerformancePeriod>('30d');
  const [snapshot, setSnapshot] = useState<SnapshotV2 | null>(null);
  const [availability, setAvailability] = useState<DataAvailability | null>(null);
  const [explanation, setExplanation] = useState<PerformanceExplanation | null>(null);
  const [cohort, setCohort] = useState<CohortResult | null>(null);
  const [attribution, setAttribution] = useState<AttributionResult | null>(null);
  // ★ 2026-07-02 3차: 자동마케팅 매출 귀속(ROI) — 지출 대비 귀속 매출 실측
  const [amRoi, setAmRoi] = useState<{
    analysisPeriodDays: number; campaigns: number; totalSent: number; spendKrw: number;
    purchases7d: number; revenue7dKrw: number; hasCdpData: boolean; source: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  const [activeModal, setActiveModal] = useState<ModalKey>(null);
  const [insightExpanded, setInsightExpanded] = useState(false);

  const [quickActionLoading, setQuickActionLoading] = useState<string | null>(null);

  const [campaigns, setCampaigns] = useState<DrillCampaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsTotal, setCampaignsTotal] = useState(0);
  const [campaignsPage, setCampaignsPage] = useState(1);
  const [campaignsTotalPages, setCampaignsTotalPages] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterChannel, setFilterChannel] = useState('all');
  const [filterAd, setFilterAd] = useState('all');
  const [sort, setSort] = useState('sent_desc');

  const [explainLoading, setExplainLoading] = useState(false);

  // ★ 2026-07-03 고객 축 — 모달 열 때 lazy load (snapshot에 얹지 않음)
  const [customerAxis, setCustomerAxis] = useState<{
    gradePerformance: GradePerformanceRow[];
    recipientAttribution: RecipientAttribution | null;
  } | null>(null);
  const [customerAxisLoading, setCustomerAxisLoading] = useState(false);

  // 일일 인사이트 (CT-98 collectCompanyInsight) — Tier 3 접이식 칩
  const [dailyInsight, setDailyInsight] = useState<{
    companyId: string;
    companyName: string;
    recipientEmail: string;
    yesterdaySent: number;
    yesterdaySuccess: number;
    yesterdayFail: number;
    totalCustomers: number;
    trialDaysRemaining: number;
  } | null>(null);

  const token = () => localStorage.getItem('token');

  const [confirmReport, setConfirmReport] = useState(false);
  // 풀분석 흐름: 설정 모달 → CreditConfirmModal(동의) → start → 진행도 모달(폴링) → 다운로드
  const [showSettings, setShowSettings] = useState(false);
  const [analysisPurpose, setAnalysisPurpose] = useState<'overall' | 'revenue' | 'retention' | 'channel'>('overall');
  const [reportTitle, setReportTitle] = useState('');
  const [showProgress, setShowProgress] = useState(false);
  const [progress, setProgress] = useState<{ currentStep: number; totalSteps: number; stepLabel: string; progress: number; status: string } | null>(null);
  const analysisAlive = useRef(false);

  // ── 풀분석(비동기 job) ──
  const startFullAnalysis = async () => {
    try {
      analysisAlive.current = true;
      setShowProgress(true);
      setProgress({ currentStep: 0, totalSteps: 9, stepLabel: '데이터 수집', progress: 0, status: 'queued' });
      const res = await fetch('/api/ai/operator/performance/full-analysis/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ period, purpose: analysisPurpose, reportTitle: reportTitle || undefined }),
      });
      if (res.status === 402) {
        const d = await res.json().catch(() => ({}));
        toast.error(d?.error || 'AI 크레딧이 부족합니다.');
        setShowProgress(false);
        return;
      }
      if (!res.ok) {
        toast.error('풀분석 시작에 실패했습니다.');
        setShowProgress(false);
        return;
      }
      const d = await res.json();
      pollAnalysisStatus(String(d.jobId));
    } catch (e: any) {
      toast.error(e?.message || '풀분석 시작 중 오류가 발생했습니다.');
      setShowProgress(false);
    }
  };

  const pollAnalysisStatus = async (jobId: string) => {
    if (!analysisAlive.current) return;
    try {
      const res = await fetch(`/api/ai/operator/performance/full-analysis/status/${jobId}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) { toast.error('진행 상태 조회에 실패했습니다.'); setShowProgress(false); return; }
      const d = await res.json();
      setProgress({ currentStep: d.currentStep, totalSteps: d.totalSteps, stepLabel: d.stepLabel || '', progress: d.progress || 0, status: d.status });
      if (d.status === 'done') { await downloadAnalysisPdf(jobId); setShowProgress(false); return; }
      if (d.status === 'failed') { toast.error('풀분석에 실패했습니다. ' + (d.error || '')); setShowProgress(false); return; }
      setTimeout(() => pollAnalysisStatus(jobId), 1500);
    } catch (e: any) {
      toast.error(e?.message || '진행 상태 조회 중 오류가 발생했습니다.');
      setShowProgress(false);
    }
  };

  const downloadAnalysisPdf = async (jobId: string) => {
    try {
      const res = await fetch(`/api/ai/operator/performance/full-analysis/download/${jobId}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) { toast.error('보고서 다운로드에 실패했습니다.'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `풀분석보고서_${period}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('풀분석 보고서를 내려받았습니다.');
    } catch (e: any) {
      toast.error(e?.message || '보고서 다운로드 중 오류가 발생했습니다.');
    }
  };

  useEffect(() => () => { analysisAlive.current = false; }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExplanation(null);
    try {
      const headers = { Authorization: `Bearer ${token()}` };
      const days = periodToDays(period);
      const [snapRes, availRes, cohortRes, attrRes, insightRes, amRoiRes] = await Promise.all([
        fetch(`/api/ai/operator/performance/snapshot-v2?period=${period}`, { headers }),
        fetch('/api/ai/operator/performance/data-availability', { headers }),
        fetch('/api/ai/operator/performance/cohort?months=12', { headers }),
        fetch(`/api/ai/operator/performance/attribution?days=${days}`, { headers }),
        fetch('/api/insight/daily', { headers }),
        fetch(`/api/ai/operator/performance/automarketing-roi?days=${days}`, { headers }),
      ]);
      const snapData = await snapRes.json();
      const availData = await availRes.json();
      const cohortData = await cohortRes.json();
      const attrData = await attrRes.json();
      try {
        const insightData = await insightRes.json();
        if (insightRes.ok && insightData.success && insightData.insight) {
          setDailyInsight(insightData.insight);
        } else {
          setDailyInsight(null);
        }
      } catch {
        setDailyInsight(null);
      }
      if (!snapRes.ok) {
        if (snapData.code === 'BETA_GATE') {
          setError('본 기능은 요금제 가입 후 이용 가능합니다.');
        } else {
          setError(snapData.error || '성과 데이터 조회 실패');
        }
        return;
      }
      setSnapshot(snapData.snapshot);
      if (availData.success) setAvailability(availData.availability);
      if (cohortData.success) setCohort(cohortData.cohort);
      if (attrData.success) setAttribution(attrData.attribution);
      // ROI는 부가 카드 — 실패 시 조용히 숨김
      try {
        const amRoiData = await amRoiRes.json();
        if (amRoiData.success) setAmRoi(amRoiData.roi || null);
      } catch { setAmRoi(null); }
    } catch (e: any) {
      setError(e?.message || '네트워크 오류');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const loadExplanation = async () => {
    if (explanation || explainLoading) return;
    setExplainLoading(true);
    try {
      const res = await fetch('/api/ai/operator/performance/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: '{}',
      });
      const data = await res.json();
      if (data.success) setExplanation(data.explanation);
    } catch {}
    finally {
      setExplainLoading(false);
    }
  };

  const loadCampaigns = useCallback(async () => {
    setCampaignsLoading(true);
    try {
      const params = new URLSearchParams({
        period,
        page: String(campaignsPage),
        limit: '10',
        filterChannel,
        filterAd,
        sort,
      });
      if (searchQuery) params.set('search', searchQuery);
      const res = await fetch(`/api/ai/operator/performance/campaigns?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) {
        setCampaigns(data.campaigns || []);
        setCampaignsTotal(data.totalCount || 0);
        setCampaignsTotalPages(data.totalPages || 0);
      }
    } catch {}
    finally {
      setCampaignsLoading(false);
    }
  }, [period, campaignsPage, searchQuery, filterChannel, filterAd, sort]);

  useEffect(() => {
    if (activeModal === 'campaigns') loadCampaigns();
  }, [activeModal, loadCampaigns]);

  // ★ 2026-07-03 고객 축 — 기간 변경 시 초기화, 등급/매출 모달 열 때 1회 로드
  useEffect(() => { setCustomerAxis(null); }, [period]);
  useEffect(() => {
    if ((activeModal !== 'grade' && activeModal !== 'revenue') || customerAxis || customerAxisLoading) return;
    (async () => {
      setCustomerAxisLoading(true);
      try {
        const res = await fetch(`/api/ai/operator/performance/customer-axis?days=${periodToDays(period)}`, {
          headers: { Authorization: `Bearer ${token()}` },
        });
        const data = await res.json();
        if (data.success) {
          setCustomerAxis({
            gradePerformance: data.gradePerformance || [],
            recipientAttribution: data.recipientAttribution || null,
          });
        }
      } catch {}
      finally {
        setCustomerAxisLoading(false);
      }
    })();
  }, [activeModal, customerAxis, customerAxisLoading, period]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchInput.trim());
    setCampaignsPage(1);
  };

  const handleQuickAction = async (actionType: QuickActionType) => {
    setQuickActionLoading(actionType);
    try {
      const res = await fetch('/api/ai/operator/performance/quick-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ actionType }),
      });
      const data = await res.json();
      if (data.success && data.result) {
        const r = data.result;
        const labelMap: Record<string, string> = {
          channel_recovery: '채널 ROI 회복',
          time_optimization: '시간대 최적화',
          top_performer_replication: '최고 성과 복제',
        };
        sessionStorage.setItem('continuousOperatorPrefill', JSON.stringify({
          name: labelMap[actionType] || '자동 마케팅',
          objective: r.objective,
          actionType,
          suggestedChannel: r.suggestedChannel,
          suggestedTone: r.suggestedTone,
          suggestedHour: r.suggestedHour,
        }));
        sessionStorage.setItem('aiOperatorPrefill', JSON.stringify({
          objective: r.objective,
          targetFilters: r.targetFilters,
          suggestedChannel: r.suggestedChannel,
          suggestedTone: r.suggestedTone,
        }));
        navigate('/continuous-operator');
      } else {
        toast.error('1-click 액션 생성에 실패했습니다.');
      }
    } catch {
      toast.error('1-click 액션 생성 중 오류가 발생했습니다.');
    }
    finally {
      setQuickActionLoading(null);
    }
  };

  const openModal = (key: ModalKey) => {
    if (key === 'diagnosis') loadExplanation();
    setActiveModal(key);
  };
  const closeModal = () => setActiveModal(null);

  const hourWeekdayMaxSent = useMemo(() => {
    if (!snapshot) return 0;
    return Math.max(0, ...snapshot.byHourWeekday.map((c) => c.sent));
  }, [snapshot]);

  const trendData = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.byDailyTrend.map((c, i) => ({
      date: c.date.substring(5),
      current: c.sent,
      previous: snapshot.byDailyTrendPrevious[i]?.sent || 0,
    }));
  }, [snapshot]);

  const cohortChartData = useMemo(() => {
    if (!cohort) return [];
    return cohort.cohorts.slice(0, 12).map((c) => ({
      month: c.cohortMonth.substring(5),
      M1: Number((c.m1Rate * 100).toFixed(1)),
      M3: Number((c.m3Rate * 100).toFixed(1)),
      M6: Number((c.m6Rate * 100).toFixed(1)),
    })).reverse();
  }, [cohort]);

  // ─── 요약 칩 한 줄 표현 (실데이터 기반) ───
  const hasCdp = !!availability?.hasCdpIntegration;
  const topRoasChannel = snapshot && snapshot.byChannelROI.length
    ? [...snapshot.byChannelROI].sort((a, b) => b.roas - a.roas)[0] : null;
  const peakCell = snapshot
    ? snapshot.byHourWeekday.reduce<HourWeekdayCell>(
        (mx, c) => (c.sent > mx.sent ? c : mx),
        { hour: 0, weekday: 0, sent: 0, successRate: 0 },
      )
    : null;
  const attr7d = attribution?.windows.find((w) => w.windowLabel.includes('7'));

  const channelSummary = snapshot && snapshot.byChannelROI.length
    ? `${snapshot.byChannelROI.length}개 채널 · 최고 ${topRoasChannel && topRoasChannel.roas > 0 ? topRoasChannel.roas.toFixed(2) + '×' : '—'}`
    : '발송 데이터 준비 중';
  const hourSummary = peakCell && peakCell.sent > 0
    ? `최다 ${peakCell.hour}시 (${WEEKDAY_LABEL[peakCell.weekday]})`
    : '발송 데이터 준비 중';
  const funnelSummary = snapshot?.funnelStats && snapshot.funnelStats.viewCount > 0
    ? `구매 전환 ${formatPct(snapshot.funnelStats.purchaseConversionRate)}`
    : '연동 시 활성';
  const attrSummary = attr7d
    ? (attribution!.hasCdpData
        ? `7일 구매 ${formatNum(attr7d.cdpPurchaseCount)}건`
        : `7일 구매 ${formatNum(attr7d.customerPurchaseCount)}명`)
    : '발송 후 반응';
  const cohortSummary = cohort && cohort.totalCohortCustomers > 0
    ? `30일 잔존 ${formatPct(cohort.avgM1Rate)}`
    : '데이터 준비 중';
  const gradeSummary = customerAxis
    ? (customerAxis.gradePerformance.length > 0 ? `${customerAxis.gradePerformance.length}개 등급 매칭` : '매칭 데이터 준비 중')
    : '등급 × 전 채널 성과';

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="bg-slate-950/80 backdrop-blur-sm border-b border-white/10 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3 flex-wrap">
          <button onClick={() => goBackOr(navigate, '/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/20">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl md:text-2xl font-semibold text-white">성과 리포트</h1>
              {availability && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                  hasCdp
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'
                    : 'bg-white/5 text-white/50 border-white/15'
                }`}>
                  {hasCdp ? '자사몰 연동됨' : '자사몰 미연동'}
                </span>
              )}
            </div>
            <p className="text-xs md:text-sm text-white/50 mt-0.5">과거~현재 마케팅 성과 분석 — 결과 · 원인 · 제안</p>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {PERIOD_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setPeriod(o.value)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  period === o.value
                    ? 'bg-violet-500/20 text-violet-200 border border-violet-400/40'
                    : 'bg-white/5 hover:bg-white/10 text-white/60 border border-white/10'
                }`}
              >
                {o.label}
              </button>
            ))}
            <button
              onClick={() => setShowSettings(true)}
              disabled={loading || !snapshot || snapshot.totalCampaigns.current === 0}
              className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:opacity-90 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity ml-1 shadow-lg shadow-violet-500/20"
              title="기간 종합 마케팅 분석보고서 — 300크레딧"
            >
              <Sparkles className="w-3.5 h-3.5" />
              풀분석 보고서
            </button>
            {createPortal(
              <CreditConfirmModal
                open={confirmReport}
                source="orchestrate"
                onConfirm={() => { setConfirmReport(false); startFullAnalysis(); }}
                onCancel={() => setConfirmReport(false)}
              />,
              document.body,
            )}

            {/* 풀분석 설정 모달 — 기간 + 초점 + 제목 */}
            {showSettings && createPortal(
              <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
                <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0"><FileDown className="w-5 h-5 text-white" /></div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white flex items-center gap-2">풀분석 보고서 <span className="px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-200 text-[9px] font-bold">300 크레딧</span></div>
                      <div className="text-[11px] text-white/40">기간 종합 마케팅 분석 — 회사 보고용</div>
                    </div>
                    <button onClick={() => setShowSettings(false)} className="ml-auto p-1 hover:bg-white/10 rounded-lg flex-shrink-0" aria-label="닫기"><X className="w-4 h-4 text-white/40" /></button>
                  </div>
                  <div className="mt-5 space-y-4">
                    <div>
                      <div className="text-[11px] font-medium text-white/50 mb-2">분석 기간</div>
                      <div className="flex gap-1.5 flex-wrap">
                        {PERIOD_OPTIONS.map((o) => (
                          <button key={o.value} onClick={() => setPeriod(o.value)} className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${period === o.value ? 'bg-violet-500/20 text-violet-200 border border-violet-400/40' : 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10'}`}>{o.label}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-white/50 mb-2">보고서 초점</div>
                      <div className="grid grid-cols-2 gap-2">
                        {[{ v: 'overall', l: '종합', d: '전 영역 균형' }, { v: 'revenue', l: '매출 성장', d: '매출·ROAS 중심' }, { v: 'retention', l: '고객 유지', d: '리텐션·이탈' }, { v: 'channel', l: '채널 효율', d: '채널·캠페인' }].map((o) => (
                          <button key={o.v} onClick={() => setAnalysisPurpose(o.v as any)} className={`text-left px-3 py-2.5 rounded-xl border transition-colors ${analysisPurpose === o.v ? 'bg-violet-500/15 border-violet-400/40' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
                            <div className={`text-[12px] font-semibold ${analysisPurpose === o.v ? 'text-violet-200' : 'text-white/80'}`}>{o.l}</div>
                            <div className="text-[10px] text-white/40 mt-0.5">{o.d}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-white/50 mb-2">보고서 제목 <span className="text-white/30">(선택)</span></div>
                      <input value={reportTitle} onChange={(e) => setReportTitle(e.target.value)} placeholder="예: 2026년 6월 마케팅 성과 보고" className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[12px] text-white placeholder:text-white/25 focus:outline-none focus:border-violet-400/40" />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-6">
                    <button onClick={() => setShowSettings(false)} className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[13px] text-white/70 transition-colors">취소</button>
                    <button onClick={() => { setShowSettings(false); setConfirmReport(true); }} className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:opacity-90 text-[13px] font-semibold text-white transition-opacity">분석 실행</button>
                  </div>
                </div>
              </div>,
              document.body,
            )}

            {/* 풀분석 진행도 모달 — 실제 단계 폴링 */}
            {showProgress && progress && createPortal(
              <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
                <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-6">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0"><Sparkles className="w-5 h-5 text-white animate-pulse" /></div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white">AI가 풀분석 보고서를 작성 중입니다</div>
                      <div className="text-[11px] text-white/40 truncate">{progress.stepLabel} · {Math.round(progress.progress)}%</div>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mb-5">
                    <div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-500" style={{ width: `${progress.progress}%` }} />
                  </div>
                  <div className="space-y-1.5">
                    {['데이터 수집', '성과 진단', '원인 분석', '세그먼트', '다차원 비교', '채널·캠페인', '메시지 분석', '예측', '액션 플랜', 'PDF 생성'].map((label, i) => {
                      const done = i < progress.currentStep;
                      const active = i === progress.currentStep;
                      return (
                        <div key={label} className={`flex items-center gap-2.5 text-[12px] ${active ? 'text-white' : done ? 'text-white/50' : 'text-white/25'}`}>
                          <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${done ? 'bg-violet-500/30' : active ? 'bg-gradient-to-br from-violet-500 to-fuchsia-500' : 'bg-white/5'}`}>
                            {done ? <Check className="w-3 h-3 text-violet-300" /> : active ? <Loader2 className="w-3 h-3 text-white animate-spin" /> : null}
                          </div>
                          {label}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-white/30 mt-5 text-center">분석에는 보통 1~3분이 걸립니다. 창을 닫아도 진행됩니다.</p>
                </div>
              </div>,
              document.body,
            )}
            <button
              onClick={load}
              disabled={loading}
              className="p-1.5 rounded hover:bg-white/10 transition-colors ml-1"
              title="새로고침"
            >
              <RefreshCw className={`w-4 h-4 text-white/60 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-5">
        {loading && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-12 flex flex-col items-center gap-3 text-white/50">
            <Loader2 className="w-6 h-6 animate-spin text-violet-300" />
            <div className="text-sm">최근 {period} 성과 분석 + 데이터 진단 중...</div>
          </div>
        )}

        {error && !loading && (
          <div className="bg-amber-500/10 border border-amber-400/30 rounded-xl p-6 text-amber-200">{error}</div>
        )}

        {!loading && !error && snapshot && (
          <>
            {/* 데이터 부족 안내 (critical/warning만 눈에 띄게) */}
            {availability && availability.cards.filter((c) => c.level === 'critical' || c.level === 'warning').length > 0 && (
              <div className="space-y-2">
                {availability.cards.filter((c) => c.level === 'critical' || c.level === 'warning').map((card, i) => {
                  const styleMap = {
                    critical: 'bg-rose-500/10 border-rose-400/30 text-rose-100',
                    warning: 'bg-amber-500/10 border-amber-400/30 text-amber-100',
                    info: 'bg-cyan-500/10 border-cyan-400/30 text-cyan-100',
                    good: 'bg-emerald-500/10 border-emerald-400/30 text-emerald-100',
                  }[card.level];
                  const iconColor = {
                    critical: 'text-rose-300', warning: 'text-amber-300', info: 'text-cyan-300', good: 'text-emerald-300',
                  }[card.level];
                  const IconComp =
                    card.icon === 'cdp' ? Database : card.icon === 'campaign' ? Sparkles : card.icon === 'customer' ? Users : Activity;
                  return (
                    <div key={i} className={`p-4 border rounded-xl ${styleMap}`}>
                      <div className="flex items-start gap-3">
                        <div className={`w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 ${iconColor}`}>
                          <IconComp className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold mb-0.5">{card.title}</div>
                          <div className="text-xs leading-relaxed opacity-90">{card.message}</div>
                          {card.actionLabel && card.actionPath && (
                            <button
                              onClick={() => navigate(card.actionPath!)}
                              className="mt-2 px-2.5 py-1 bg-white/15 hover:bg-white/25 rounded text-[11px] font-medium transition-colors"
                            >
                              {card.actionLabel} →
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ════ Tier 1 — 헤드라인 ════ */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <HeadlineKpiCard
                label="매출" accent="violet" icon={<TrendingUp className="w-4 h-4" />}
                value={hasCdp && snapshot.estimatedRevenue.current > 0 ? formatWon(snapshot.estimatedRevenue.current) : '—'}
                metric={hasCdp && snapshot.estimatedRevenue.current > 0 ? snapshot.estimatedRevenue : undefined}
                sub={hasCdp ? '실매출(자사몰)' : '자사몰 연동 시 집계'}
                onClick={() => openModal('revenue')}
              />
              <HeadlineKpiCard
                label="ROAS" accent="cyan" icon={<BarChart3 className="w-4 h-4" />}
                value={formatRoas(snapshot.estimatedRoas.current)}
                metric={snapshot.estimatedRoas.current > 0 ? snapshot.estimatedRoas : undefined}
                sub={snapshot.estimatedRoas.current > 0 ? '매출 ÷ 비용' : '자사몰 매출 연동 시 산출'}
                onClick={() => openModal('channel')}
              />
              <HeadlineKpiCard
                label="성공률" accent="emerald" icon={<Activity className="w-4 h-4" />}
                value={formatPct(snapshot.successRate.current)} metric={snapshot.successRate}
                onClick={() => openModal('trend')}
              />
              <HeadlineKpiCard
                label="활성 고객" accent="amber" icon={<Users className="w-4 h-4" />}
                value={formatNum(snapshot.activeCustomers.current)} metric={snapshot.activeCustomers}
                onClick={() => openModal('cohort')}
              />
            </div>

            <div className="text-[11px] text-white/40">
              이 기간 캠페인 {formatNum(snapshot.totalCampaigns.current)}건 · 총 발송 {formatNum(snapshot.totalSent.current)}건 · 신규 고객 {formatNum(snapshot.newCustomers.current)}명 · 직전 {period} 대비 비교
            </div>

            {/* ════ 자동마케팅 ROI (2026-07-02 3차) — 지출 대비 귀속 매출 실측 ════ */}
            {amRoi && amRoi.campaigns > 0 && (
              <div className="bg-gradient-to-br from-emerald-500/10 to-slate-900 border border-emerald-400/25 rounded-2xl p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-xs font-semibold text-white/70">자동마케팅 ROI — 최근 {amRoi.analysisPeriodDays}일</div>
                  {amRoi.hasCdpData && amRoi.spendKrw > 0 && amRoi.revenue7dKrw > 0 && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold">
                      지출 대비 {(amRoi.revenue7dKrw / amRoi.spendKrw).toFixed(1)}배
                    </span>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="bg-white/5 rounded-lg px-3 py-2.5">
                    <div className="text-[10px] text-white/40">발송 캠페인</div>
                    <div className="text-lg font-bold text-white mt-0.5">{formatNum(amRoi.campaigns)}건</div>
                  </div>
                  <div className="bg-white/5 rounded-lg px-3 py-2.5">
                    <div className="text-[10px] text-white/40">지출 (메시지 비용)</div>
                    <div className="text-lg font-bold text-white mt-0.5">₩{formatNum(amRoi.spendKrw)}</div>
                  </div>
                  <div className="bg-white/5 rounded-lg px-3 py-2.5">
                    <div className="text-[10px] text-white/40">발송 후 7일 구매</div>
                    <div className="text-lg font-bold text-emerald-300 mt-0.5">{amRoi.hasCdpData ? `${formatNum(amRoi.purchases7d)}건` : '—'}</div>
                  </div>
                  <div className="bg-white/5 rounded-lg px-3 py-2.5">
                    <div className="text-[10px] text-white/40">귀속 매출 (7일)</div>
                    <div className="text-lg font-bold text-emerald-300 mt-0.5">{amRoi.hasCdpData ? `₩${formatNum(amRoi.revenue7dKrw)}` : '연동 필요'}</div>
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-white/30 italic">Data source — {amRoi.source}</div>
                {!amRoi.hasCdpData && (
                  <button onClick={() => navigate('/cdp-settings')} className="mt-2 px-2.5 py-1 bg-white/10 hover:bg-white/20 rounded text-[11px] text-white/80 font-medium transition-colors">
                    자사몰 연동하고 매출 귀속 보기 →
                  </button>
                )}
              </div>
            )}

            {/* ════ AI 자율 진단(좌) + 요약 아이콘 카드(우) 동일 높이 2단 ════ */}
            <div className="flex flex-col lg:flex-row gap-3 lg:items-stretch">
              <div className="lg:w-[36%] flex-shrink-0">
                <AiDiagnosisLine explanation={explanation} loading={explainLoading} onOpen={() => openModal('diagnosis')} />
              </div>
              <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-2 auto-rows-fr">
              <SummaryChip icon={<Sparkles className="w-4 h-4" />} accent="text-fuchsia-300" label="채널 ROI" summary={channelSummary} onClick={() => openModal('channel')} />
              <SummaryChip icon={<Clock className="w-4 h-4" />} accent="text-cyan-300" label="시간대" summary={hourSummary} onClick={() => openModal('hour')} />
              {hasCdp ? (
                <>
                  <SummaryChip icon={<Activity className="w-4 h-4" />} accent="text-emerald-300" label="퍼널" badge="자사몰" summary={funnelSummary} onClick={() => openModal('funnel')} />
                  <SummaryChip icon={<MousePointerClick className="w-4 h-4" />} accent="text-violet-300" label="기여도" badge="자사몰" summary={attrSummary} onClick={() => openModal('revenue')} />
                </>
              ) : (
                <SummaryChip icon={<Database className="w-4 h-4" />} accent="text-cyan-300" label="자사몰 연동" summary="실매출·퍼널·기여도 보기" onClick={() => navigate('/cdp-settings')} />
              )}
              <SummaryChip icon={<Crown className="w-4 h-4" />} accent="text-amber-300" label="고객 등급" summary={gradeSummary} onClick={() => openModal('grade')} />
              <SummaryChip icon={<Users className="w-4 h-4" />} accent="text-violet-300" label="코호트" summary={cohortSummary} onClick={() => openModal('cohort')} />
              <SummaryChip icon={<TrendingUp className="w-4 h-4" />} accent="text-emerald-300" label="추세" summary={`${period} 일별 추이`} onClick={() => openModal('trend')} />
              </div>
            </div>

            {/* ════ Tier 3 — 액션 & 보조 ════ */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <div className="text-xs font-semibold text-white/70 mb-2.5">추천 액션 — AI 자동 마케팅</div>
                <div className="space-y-2">
                  <QuickActionRow
                    icon={<AlertTriangle className="w-4 h-4" />} title="채널 ROI 회복" desc="저성과 채널 회복 캠페인 자동 설계" color="rose"
                    loading={quickActionLoading === 'channel_recovery'} disabled={snapshot.totalCampaigns.current === 0}
                    onClick={() => handleQuickAction('channel_recovery')}
                  />
                  <QuickActionRow
                    icon={<Clock className="w-4 h-4" />} title="시간대 최적화" desc="저성과 시간대 최적화 캠페인 자동 설계" color="emerald"
                    loading={quickActionLoading === 'time_optimization'} disabled={snapshot.totalCampaigns.current === 0}
                    onClick={() => handleQuickAction('time_optimization')}
                  />
                  <QuickActionRow
                    icon={<TrendingUp className="w-4 h-4" />} title="최고 성과 복제" desc={`${period} 안 top 캠페인 복제 + 강화`} color="amber"
                    loading={quickActionLoading === 'top_performer_replication'} disabled={snapshot.topCampaigns.length === 0}
                    onClick={() => handleQuickAction('top_performer_replication')}
                  />
                </div>
                <div className="mt-2 text-[10px] text-white/30 italic">Data source — performance quick-action (AI 자동 설계 · 사용자 검토 후 발송)</div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-xs font-semibold text-white/70">Top 캠페인</span>
                  <button onClick={() => openModal('campaigns')} className="text-[11px] text-violet-300 hover:text-violet-200">전체 보기 →</button>
                </div>
                {snapshot.topCampaigns.length === 0 ? (
                  <div className="text-xs text-white/40 py-4 text-center">발송 캠페인 없음 — 첫 캠페인 발송 후 활성</div>
                ) : (
                  <div className="space-y-1.5">
                    {snapshot.topCampaigns.slice(0, 3).map((c) => (
                      <div key={c.id} className="flex items-center gap-2 text-xs">
                        <span className="text-[10px] px-1.5 py-0.5 bg-violet-500/20 text-violet-300 rounded font-mono flex-shrink-0">{c.messageType}</span>
                        <span className="text-white/80 truncate flex-1" title={c.name}>{c.name}</span>
                        <span className="text-white/50 font-mono flex-shrink-0">{formatNum(c.sent)}건</span>
                        <span className="text-emerald-300 font-mono flex-shrink-0">{formatPct(c.successRate)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 text-[10px] text-white/30 italic">Data source — campaigns + MySQL 큐 직접 집계</div>
              </div>
            </div>

            {/* 어제 인사이트 (CT-98) — 작은 접이식 칩 */}
            {dailyInsight && (
              <div className="bg-white/5 border border-white/10 rounded-xl">
                <button onClick={() => setInsightExpanded(!insightExpanded)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left">
                  <Sparkles className="w-3.5 h-3.5 text-violet-300 flex-shrink-0" />
                  <span className="text-xs text-white/70">
                    어제 발송 {formatNum(dailyInsight.yesterdaySent)}건 · 성공 {formatNum(dailyInsight.yesterdaySuccess)} · 활성 고객 {formatNum(dailyInsight.totalCustomers)}
                  </span>
                  {insightExpanded ? <ChevronUp className="w-3.5 h-3.5 ml-auto text-white/40" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto text-white/40" />}
                </button>
                {insightExpanded && (
                  <div className="px-4 pb-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div className="rounded-lg border border-white/10 bg-white/5 p-2.5">
                        <p className="text-[10px] text-white/50">어제 발송</p>
                        <p className="text-lg font-bold text-violet-200 mt-0.5">{formatNum(dailyInsight.yesterdaySent)}</p>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-white/5 p-2.5">
                        <p className="text-[10px] text-white/50">성공</p>
                        <p className="text-lg font-bold text-emerald-300 mt-0.5">{formatNum(dailyInsight.yesterdaySuccess)}</p>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-white/5 p-2.5">
                        <p className="text-[10px] text-white/50">실패</p>
                        <p className="text-lg font-bold text-rose-300 mt-0.5">{formatNum(dailyInsight.yesterdayFail)}</p>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-white/5 p-2.5">
                        <p className="text-[10px] text-white/50">활성 고객</p>
                        <p className="text-lg font-bold text-fuchsia-300 mt-0.5">{formatNum(dailyInsight.totalCustomers)}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-[10px] text-white/30 italic">
                      Data source — CT-98 daily-insight-mailer (어제 0~24시 sms_send_results + customers is_active)
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="text-center text-[11px] text-white/40 pt-2">
              마지막 계산: {new Date(snapshot.computedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
              <br />
              이 분석은 AI 결과이며 액션은 사용자 검토 + 승인 후 발송됩니다 (AI 단독 발송 X). 0건 자동완화 X — 발송 차단 정책.
            </div>
          </>
        )}
      </div>

      {/* ════════════ 모달 ════════════ */}
      {snapshot && (
        <>
          {/* 매출 · 기여 모달 */}
          <PerfModal open={activeModal === 'revenue'} onClose={closeModal} title="매출 · 발송 후 기여" icon={<TrendingUp className="w-4 h-4 text-violet-300" />} source={attribution?.source || 'cdp_events.purchase'} wide>
            {hasCdp ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
                    <div className="text-[11px] text-white/50">기간 실매출</div>
                    <div className="text-xl font-bold text-violet-200 mt-1">{formatWon(snapshot.estimatedRevenue.current)}</div>
                    <div className={`text-[11px] font-mono mt-0.5 ${snapshot.estimatedRevenue.betterThan ? 'text-emerald-300' : 'text-rose-300'}`}>직전 대비 {formatDiff(snapshot.estimatedRevenue)}</div>
                  </div>
                  <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
                    <div className="text-[11px] text-white/50">블렌디드 ROAS</div>
                    <div className="text-xl font-bold text-cyan-200 mt-1">{formatRoas(snapshot.estimatedRoas.current)}</div>
                    <div className={`text-[11px] font-mono mt-0.5 ${snapshot.estimatedRoas.betterThan ? 'text-emerald-300' : 'text-rose-300'}`}>직전 대비 {formatDiff(snapshot.estimatedRoas)}</div>
                  </div>
                </div>
                {attribution && attribution.totalCampaigns > 0 ? (
                  <div className="space-y-2">
                    <div className="text-[11px] text-white/60">분석 기간 {attribution.analysisPeriodDays}일 / 캠페인 {formatNum(attribution.totalCampaigns)}건 / 발송 {formatNum(attribution.totalSent)}건</div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {attribution.windows.map((w) => (
                        <div key={w.windowLabel} className="p-3 bg-white/5 border border-white/10 rounded-lg">
                          <div className="text-[10px] text-white/40 mb-1">발송 후 {w.windowLabel}</div>
                          {attribution.hasCdpData ? (
                            <>
                              <div className="text-base font-bold text-emerald-300 font-mono">{formatNum(w.cdpPurchaseCount)}건</div>
                              <div className="text-[10px] text-white/60 mt-0.5">매출 <span className="text-amber-300 font-mono">{formatWon(w.cdpRevenue)}</span></div>
                            </>
                          ) : (
                            <>
                              <div className="text-base font-bold text-cyan-300 font-mono">{formatNum(w.customerPurchaseCount)}명</div>
                              <div className="text-[10px] text-white/60 mt-0.5">recent_purchase_date 갱신</div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-xs text-white/40 py-4">발송 캠페인 후 구매 반응이 쌓이면 여기에 표시됩니다.</div>
                )}
                {/* ★ 2026-07-03 고객 축 — 수신 고객 기준 정밀 기여 (여정·DM customer_id 매칭) */}
                <div className="pt-2 border-t border-white/10">
                  <div className="text-[11px] text-white/60 mb-2">수신 고객 기준 기여 <span className="text-emerald-300/80">(여정·DM — 고객 단위 정확 매칭)</span></div>
                  {customerAxisLoading ? (
                    <div className="flex items-center gap-2 text-[11px] text-white/40 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> 고객 매칭 집계 중…</div>
                  ) : customerAxis?.recipientAttribution && customerAxis.recipientAttribution.totalRecipients > 0 ? (
                    <>
                      <div className="text-[10px] text-white/40 mb-2">기간 내 수신 고객 {formatNum(customerAxis.recipientAttribution.totalRecipients)}명</div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        {customerAxis.recipientAttribution.windows.map((w) => (
                          <div key={w.windowLabel} className="p-3 bg-white/5 border border-white/10 rounded-lg">
                            <div className="text-[10px] text-white/40 mb-1">수신 후 {w.windowLabel}</div>
                            <div className="text-base font-bold text-emerald-300 font-mono">{formatNum(w.buyers)}명 구매</div>
                            <div className="text-[10px] text-white/60 mt-0.5">매출 <span className="text-amber-300 font-mono">{formatWon(w.revenue)}</span></div>
                          </div>
                        ))}
                      </div>
                      <div className="text-[10px] text-white/30 italic mt-1.5">Data source — {customerAxis.recipientAttribution.source}</div>
                    </>
                  ) : (
                    <div className="text-[11px] text-white/40 py-1">여정·DM 발송이 쌓이면 "발송받은 그 고객의 구매"를 고객 단위로 매칭해 보여드립니다.</div>
                  )}
                </div>
              </div>
            ) : (
              <CdpUpsellCard onConnect={() => navigate('/cdp-settings')} lines="실매출 · 발송 후 구매 기여를 자사몰 연동 시 집계합니다." />
            )}
          </PerfModal>

          {/* ★ 2026-07-03 고객 등급 성과 모달 (고객 축) */}
          <PerfModal open={activeModal === 'grade'} onClose={closeModal} title="고객 등급 성과" icon={<Crown className="w-4 h-4 text-amber-300" />} source="journey_step_logs · dm_recipient_tokens/dm_views · email_events · campaigns.target_filter(근사) · cdp_events" wide>
            {customerAxisLoading ? (
              <div className="flex items-center justify-center gap-2 text-xs text-white/40 py-10"><Loader2 className="w-4 h-4 animate-spin" /> 등급별 고객 매칭 집계 중…</div>
            ) : customerAxis && customerAxis.gradePerformance.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] whitespace-nowrap">
                    <thead>
                      <tr className="text-white/40 border-b border-white/10">
                        <th className="text-left py-2 pr-3 font-medium">등급</th>
                        <th className="text-right py-2 px-3 font-medium">여정 발송</th>
                        <th className="text-right py-2 px-3 font-medium">DM 수신</th>
                        <th className="text-right py-2 px-3 font-medium">DM 열람</th>
                        <th className="text-right py-2 px-3 font-medium">이메일 클릭</th>
                        <th className="text-right py-2 px-3 font-medium">SMS 타겟발송</th>
                        <th className="text-right py-2 px-3 font-medium">구매 고객</th>
                        <th className="text-right py-2 pl-3 font-medium">매출</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerAxis.gradePerformance.map((g) => (
                        <tr key={g.grade} className="border-b border-white/5">
                          <td className="py-2 pr-3 text-amber-200 font-medium">{g.grade}</td>
                          <td className="py-2 px-3 text-right text-white/70 font-mono">{formatNum(g.journeySent)}</td>
                          <td className="py-2 px-3 text-right text-white/70 font-mono">{formatNum(g.dmSent)}</td>
                          <td className="py-2 px-3 text-right text-cyan-300 font-mono">{formatNum(g.dmViewers)}</td>
                          <td className="py-2 px-3 text-right text-fuchsia-300 font-mono">{formatNum(g.emailClickers)}</td>
                          <td className="py-2 px-3 text-right text-white/50 font-mono">{formatNum(g.smsTargetedSent)}</td>
                          <td className="py-2 px-3 text-right text-emerald-300 font-mono">{formatNum(g.buyers)}</td>
                          <td className="py-2 pl-3 text-right text-amber-300 font-mono">{formatWon(g.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-[10px] text-white/40 mt-2">여정·DM = 고객 단위 정확 매칭 / 이메일 = 반응자 기준 / SMS 타겟발송 = 등급 타겟 캠페인 근사</div>
              </>
            ) : (
              <div className="text-center text-xs text-white/40 py-8">
                고객 등급과 발송·구매 기록이 매칭되면 여기에 표시됩니다.
                <br />여정·DM 발송 또는 등급 타겟 캠페인이 쌓이면 자동 활성화됩니다.
              </div>
            )}
          </PerfModal>

          {/* 채널 ROI 모달 */}
          <PerfModal open={activeModal === 'channel'} onClose={closeModal} title="채널 ROI" icon={<Sparkles className="w-4 h-4 text-fuchsia-300" />} source="campaigns + MySQL 큐 직접 집계 (D144 기준)" wide>
            {snapshot.byChannelROI.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={snapshot.byChannelROI.map((c) => ({ channel: c.channel, current: c.sent, previous: c.previousSent }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="channel" stroke="rgba(255,255,255,0.5)" fontSize={11} />
                    <YAxis stroke="rgba(255,255,255,0.5)" fontSize={11} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="current" name={`현재 ${period}`} fill="#a78bfa" />
                    <Bar dataKey="previous" name={`직전 ${period}`} fill="#475569" />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-3 space-y-1">
                  {snapshot.byChannelROI.map((c) => (
                    <div key={c.channel} className="flex items-center justify-between text-[11px]">
                      <span className="text-white/70 font-medium w-12">{c.channel}</span>
                      <div className="flex items-center gap-3 text-white/50">
                        <span>{c.channel === 'EMAIL' || c.channel === 'DM' ? '열람률' : '성공률'} <span className="text-emerald-300 font-mono">{formatPct(c.successRate)}</span></span>
                        <span>비용 <span className="text-amber-300 font-mono">{c.estimatedCost > 0 ? formatWon(c.estimatedCost) : '무료'}</span></span>
                        <span>ROAS <span className="text-cyan-300 font-mono">{c.roas > 0 ? c.roas.toFixed(2) + '×' : '-'}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
                {snapshot.byChannelROI.some((c) => c.channel === 'EMAIL' || c.channel === 'DM') && (
                  <div className="text-[10px] text-white/40 mt-2">EMAIL = 발송 무료(열람 기준) / DM = 열람 축(문자 발송분은 SMS·LMS 행에 포함) — 2026-07-03 전 채널 합류</div>
                )}
              </>
            ) : (
              <div className="text-center text-xs text-white/40 py-8">발송 데이터 없음 — 첫 캠페인 발송 후 활성</div>
            )}
          </PerfModal>

          {/* 시간대 모달 */}
          <PerfModal open={activeModal === 'hour'} onClose={closeModal} title="시간대 × 요일" icon={<Clock className="w-4 h-4 text-cyan-300" />} source="campaigns.sent_at (KST)" wide>
            {hourWeekdayMaxSent === 0 ? (
              <div className="text-center text-xs text-white/40 py-8">발송 데이터 없음</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="text-[10px] mx-auto">
                  <thead>
                    <tr>
                      <th className="w-10 text-white/40 font-medium">시</th>
                      {WEEKDAY_LABEL.map((w) => (<th key={w} className="w-10 text-white/40 font-medium">{w}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 24 }).map((_, h) => (
                      <tr key={h}>
                        <td className="text-white/40 font-mono text-center">{h}시</td>
                        {Array.from({ length: 7 }).map((_, w) => {
                          const cell = snapshot.byHourWeekday.find((c) => c.hour === h && c.weekday === w);
                          const intensity = hourWeekdayMaxSent > 0 && cell ? cell.sent / hourWeekdayMaxSent : 0;
                          return (
                            <td
                              key={w}
                              className="w-10 h-7 text-center text-white/80 font-mono"
                              style={{ backgroundColor: intensity > 0 ? `rgba(167, 139, 250, ${0.15 + intensity * 0.7})` : 'rgba(255,255,255,0.03)' }}
                              title={cell ? `${formatNum(cell.sent)}건 성공률 ${formatPct(cell.successRate)}` : '0건'}
                            >
                              {cell && cell.sent > 0 ? cell.sent : ''}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PerfModal>

          {/* 퍼널 모달 */}
          <PerfModal open={activeModal === 'funnel'} onClose={closeModal} title="자사몰 퍼널" icon={<Activity className="w-4 h-4 text-emerald-300" />} source="cdp_events (page_view → cart_add → purchase)" wide>
            {snapshot.funnelStats && snapshot.funnelStats.viewCount > 0 ? (
              <>
                <div className="space-y-2">
                  <FunnelBar label="조회 (page_view)" count={snapshot.funnelStats.viewCount} max={snapshot.funnelStats.viewCount} color="#6366f1" />
                  <FunnelBar label="장바구니 (cart_add)" count={snapshot.funnelStats.cartAddCount} max={snapshot.funnelStats.viewCount} color="#06b6d4" />
                  <FunnelBar label="위시 (wishlist_add)" count={snapshot.funnelStats.wishlistAddCount} max={snapshot.funnelStats.viewCount} color="#a78bfa" />
                  <FunnelBar label="구매 (purchase)" count={snapshot.funnelStats.purchaseCount} max={snapshot.funnelStats.viewCount} color="#10b981" />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
                  <div className="p-2 bg-white/5 rounded text-center">
                    <div className="text-white/40">장바구니 전환율</div>
                    <div className="text-cyan-300 font-mono font-bold">{formatPct(snapshot.funnelStats.cartConversionRate)}</div>
                  </div>
                  <div className="p-2 bg-white/5 rounded text-center">
                    <div className="text-white/40">구매 전환율</div>
                    <div className="text-emerald-300 font-mono font-bold">{formatPct(snapshot.funnelStats.purchaseConversionRate)}</div>
                  </div>
                  <div className="p-2 bg-white/5 rounded text-center">
                    <div className="text-white/40">장바구니 → 구매</div>
                    <div className="text-fuchsia-300 font-mono font-bold">{formatPct(snapshot.funnelStats.cartToPurchaseRate)}</div>
                  </div>
                </div>
              </>
            ) : (
              <CdpUpsellCard onConnect={() => navigate('/cdp-settings')} lines="조회 → 장바구니 → 구매 전환 퍼널을 자사몰 연동 시 시각화합니다." />
            )}
          </PerfModal>

          {/* 코호트 모달 */}
          <PerfModal open={activeModal === 'cohort'} onClose={closeModal} title="가입월별 잔존" icon={<Users className="w-4 h-4 text-violet-300" />} source={cohort?.source || 'customers.created_at + recent_purchase_date'} wide>
            {cohort && cohort.cohorts.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={cohortChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="month" stroke="rgba(255,255,255,0.5)" fontSize={10} />
                    <YAxis stroke="rgba(255,255,255,0.5)" fontSize={10} unit="%" />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="M1" name="가입 후 30일" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="M3" name="가입 후 90일" stroke="#a78bfa" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="M6" name="가입 후 180일" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="mt-2 text-[11px] text-white/60">
                  평균 30일 잔존: <span className="text-cyan-300 font-mono">{formatPct(cohort.avgM1Rate)}</span> · 90일 잔존: <span className="text-violet-300 font-mono">{formatPct(cohort.avgM3Rate)}</span>
                </div>
              </>
            ) : (
              <div className="text-center text-xs text-white/40 py-8">가입 · 구매 데이터가 쌓이면 잔존 곡선이 활성됩니다.</div>
            )}
          </PerfModal>

          {/* 추세 모달 */}
          <PerfModal open={activeModal === 'trend'} onClose={closeModal} title={`${period} 일별 추세`} icon={<TrendingUp className="w-4 h-4 text-emerald-300" />} source="campaigns (KST 일별 그룹)" wide>
            {trendData.length === 0 || trendData.every((d) => d.current === 0 && d.previous === 0) ? (
              <div className="text-center text-xs text-white/40 py-8">발송 데이터 없음</div>
            ) : (
              <>
                <div className="mb-3 flex items-center gap-3 text-[11px]">
                  <span className="text-white/50">성공률 <span className="text-emerald-300 font-mono">{formatPct(snapshot.successRate.current)}</span></span>
                  <span className={`font-mono ${snapshot.successRate.betterThan ? 'text-emerald-300' : 'text-rose-300'}`}>직전 대비 {formatDiff(snapshot.successRate)}</span>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="date" stroke="rgba(255,255,255,0.5)" fontSize={10} />
                    <YAxis stroke="rgba(255,255,255,0.5)" fontSize={10} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="current" name="현재" stroke="#a78bfa" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="previous" name="직전" stroke="#64748b" strokeWidth={2} dot={false} strokeDasharray="4 4" />
                  </LineChart>
                </ResponsiveContainer>
              </>
            )}
          </PerfModal>

          {/* AI 진단 모달 */}
          <PerfModal open={activeModal === 'diagnosis'} onClose={closeModal} title="AI 자율 진단" icon={<Brain className="w-4 h-4 text-violet-300" />} source={explanation ? Array.from(new Set(explanation.factors.map((f) => f.sourceField))).slice(0, 3).join(' · ') : '최근 30일 campaigns · cdp_events'} wide>
            {explainLoading ? (
              <div className="flex flex-col items-center gap-2 py-10 text-white/50">
                <Loader2 className="w-6 h-6 animate-spin text-violet-300" />
                <div className="text-xs">AI 분석 중 (10~20초)</div>
              </div>
            ) : explanation ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white/80">전체 성과 스코어</span>
                  <span className="text-lg font-bold text-violet-200 font-mono">{explanation.overallScore}</span>
                  <span className="text-xs text-white/40">/100</span>
                </div>
                <p className="text-sm text-white/80 leading-relaxed p-3 bg-violet-500/10 border border-violet-400/20 rounded-xl">{explanation.topInsight}</p>
                {explanation.factors.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-white/60 mb-2">영향 요인 (성과를 이끈 / 새는 곳)</div>
                    <div className="space-y-1.5">
                      {explanation.factors.map((f, i) => {
                        const dirColor = f.direction === 'positive' ? 'bg-emerald-400' : f.direction === 'negative' ? 'bg-rose-400' : 'bg-amber-400';
                        const dirTextColor = f.direction === 'positive' ? 'text-emerald-300' : f.direction === 'negative' ? 'text-rose-300' : 'text-amber-300';
                        return (
                          <div key={i} className="grid grid-cols-12 gap-2 items-center text-[11px]">
                            <div className="col-span-3 text-white/70 font-medium truncate" title={f.label}>{f.label}</div>
                            <div className="col-span-4">
                              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                                <div className={`h-full ${dirColor}`} style={{ width: `${f.impactScore * 100}%` }} />
                              </div>
                            </div>
                            <div className={`col-span-1 text-right font-mono ${dirTextColor}`}>{(f.impactScore * 100).toFixed(0)}%</div>
                            <div className="col-span-4 text-[10px] text-white/50 truncate" title={f.detail}>{f.detail}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {explanation.recommendation && (
                  <div className="p-3 bg-violet-500/10 border border-violet-400/30 rounded-xl text-[12px] text-violet-100">
                    <strong>1순위 권장:</strong> {explanation.recommendation}
                  </div>
                )}
                <div>
                  <div className="text-xs font-semibold text-white/60 mb-2">제안 → 1-click 액션</div>
                  <div className="space-y-2">
                    <QuickActionRow icon={<AlertTriangle className="w-4 h-4" />} title="채널 ROI 회복" desc="저성과 채널 회복 캠페인" color="rose" loading={quickActionLoading === 'channel_recovery'} disabled={snapshot.totalCampaigns.current === 0} onClick={() => handleQuickAction('channel_recovery')} />
                    <QuickActionRow icon={<Clock className="w-4 h-4" />} title="시간대 최적화" desc="저성과 시간대 최적화 캠페인" color="emerald" loading={quickActionLoading === 'time_optimization'} disabled={snapshot.totalCampaigns.current === 0} onClick={() => handleQuickAction('time_optimization')} />
                    <QuickActionRow icon={<TrendingUp className="w-4 h-4" />} title="최고 성과 복제" desc="top 캠페인 복제 + 강화" color="amber" loading={quickActionLoading === 'top_performer_replication'} disabled={snapshot.topCampaigns.length === 0} onClick={() => handleQuickAction('top_performer_replication')} />
                  </div>
                </div>
                <p className="text-[10px] text-white/30 italic">AI 자율 진단은 최근 30일 데이터 기준입니다.</p>
              </div>
            ) : (
              <div className="text-center py-8">
                <button onClick={loadExplanation} className="px-4 py-2 bg-violet-500/30 hover:bg-violet-500/50 text-violet-100 rounded-lg text-sm font-medium">AI 자율 진단 시작 →</button>
              </div>
            )}
          </PerfModal>

          {/* 캠페인 드릴다운 모달 */}
          <PerfModal open={activeModal === 'campaigns'} onClose={closeModal} title="캠페인 드릴다운" icon={<Sparkles className="w-4 h-4 text-fuchsia-300" />} source="campaigns + MySQL 큐 직접 집계 (D144 기준)" wide>
            <div className="flex flex-col md:flex-row gap-2 mb-3">
              <form onSubmit={handleSearch} className="flex-1 flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="캠페인명 검색"
                    className="w-full pl-8 pr-3 py-1.5 bg-slate-800 border border-white/10 rounded text-xs text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50"
                  />
                </div>
                <button type="submit" className="px-3 py-1.5 bg-violet-500/30 hover:bg-violet-500/50 text-violet-100 rounded text-xs font-medium">검색</button>
              </form>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Filter className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                  <select value={filterChannel} onChange={(e) => { setFilterChannel(e.target.value); setCampaignsPage(1); }} className="pl-6 pr-7 py-1.5 bg-slate-800 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-violet-400/50 appearance-none">
                    <option value="all">전체 채널</option>
                    <option value="sms">SMS</option>
                    <option value="lms">LMS</option>
                    <option value="mms">MMS</option>
                    <option value="kakao">KAKAO</option>
                  </select>
                </div>
                <div className="relative">
                  <Filter className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                  <select value={filterAd} onChange={(e) => { setFilterAd(e.target.value); setCampaignsPage(1); }} className="pl-6 pr-7 py-1.5 bg-slate-800 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-violet-400/50 appearance-none">
                    <option value="all">광고/안내</option>
                    <option value="ad">광고만</option>
                    <option value="info">안내만</option>
                  </select>
                </div>
                <div className="relative">
                  <ArrowUpDown className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                  <select value={sort} onChange={(e) => { setSort(e.target.value); setCampaignsPage(1); }} className="pl-6 pr-7 py-1.5 bg-slate-800 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-violet-400/50 appearance-none">
                    <option value="sent_desc">발송 ↓</option>
                    <option value="success_rate_desc">성공률 ↓</option>
                    <option value="sent_at_desc">최근 ↓</option>
                    <option value="sent_at_asc">오래된 순</option>
                  </select>
                </div>
              </div>
            </div>

            {campaignsLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-violet-400" /></div>
            ) : campaigns.length === 0 ? (
              <div className="text-center py-8 text-white/40 text-xs">검색/필터 결과 없음</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-white/5 border-b border-white/10">
                    <tr className="text-left text-white/60">
                      <th className="px-3 py-2 font-medium">캠페인</th>
                      <th className="px-3 py-2 font-medium text-center">채널</th>
                      <th className="px-3 py-2 font-medium text-right">발송</th>
                      <th className="px-3 py-2 font-medium text-right">성공률</th>
                      <th className="px-3 py-2 font-medium text-right">비용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr key={c.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="px-3 py-2">
                          <div className="text-white/80">{c.name}</div>
                          <div className="text-[10px] text-white/40">{new Date(c.sentAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="text-[10px] px-1.5 py-0.5 bg-violet-500/20 text-violet-300 rounded font-mono">{c.messageType}</span>
                          {c.isAd && <span className="text-[10px] px-1 py-0.5 ml-1 bg-amber-500/20 text-amber-300 rounded">광고</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{formatNum(c.sent)}</td>
                        <td className="px-3 py-2 text-right font-mono text-emerald-300">{formatPct(c.successRate)}</td>
                        <td className="px-3 py-2 text-right font-mono text-amber-300">{formatWon(c.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {campaignsTotalPages > 1 && (
              <div className="mt-3 flex items-center justify-between text-[11px] text-white/50">
                <div>전체 {formatNum(campaignsTotal)}건</div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setCampaignsPage(Math.max(1, campaignsPage - 1))} disabled={campaignsPage === 1} className="p-1 hover:bg-white/5 rounded disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                  <span className="font-mono">{campaignsPage} / {campaignsTotalPages}</span>
                  <button onClick={() => setCampaignsPage(Math.min(campaignsTotalPages, campaignsPage + 1))} disabled={campaignsPage === campaignsTotalPages} className="p-1 hover:bg-white/5 rounded disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
                </div>
              </div>
            )}
          </PerfModal>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 인라인 컴포넌트
// ════════════════════════════════════════════════════════════════════

function HeadlineKpiCard({
  label, value, metric, icon, accent, sub, onClick,
}: {
  label: string;
  value: string;
  metric?: PerformanceMetricV2;
  icon: React.ReactNode;
  accent: 'violet' | 'emerald' | 'cyan' | 'amber';
  sub?: string;
  onClick: () => void;
}) {
  const ring: Record<string, string> = {
    violet: 'hover:border-violet-400/50', emerald: 'hover:border-emerald-400/50',
    cyan: 'hover:border-cyan-400/50', amber: 'hover:border-amber-400/50',
  };
  const iconBg: Record<string, string> = {
    violet: 'bg-violet-500/20 text-violet-300', emerald: 'bg-emerald-500/20 text-emerald-300',
    cyan: 'bg-cyan-500/20 text-cyan-300', amber: 'bg-amber-500/20 text-amber-300',
  };
  const diffColor = !metric ? '' : metric.diffPct === 0 ? 'text-white/40' : metric.betterThan ? 'text-emerald-300' : 'text-rose-300';
  const arrow = !metric ? '' : metric.diffPct === 0 ? '─' : metric.betterThan ? '↑' : '↓';
  return (
    <button onClick={onClick} className={`text-left p-4 md:p-5 bg-white/5 border border-white/10 rounded-2xl transition-colors ${ring[accent]}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBg[accent]}`}>{icon}</div>
        <span className="text-xs text-white/50">{label}</span>
      </div>
      <div className="text-2xl md:text-3xl font-bold text-white truncate" title={value}>{value}</div>
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        {metric && <span className={`text-[11px] font-mono ${diffColor}`}>{arrow} {formatDiff(metric)}</span>}
        {sub && <span className="text-[10px] text-white/40">{sub}</span>}
      </div>
    </button>
  );
}

function AiDiagnosisLine({
  explanation, loading, onOpen,
}: {
  explanation: PerformanceExplanation | null;
  loading: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="h-full p-4 bg-gradient-to-br from-violet-500/15 via-fuchsia-500/10 to-indigo-500/15 border border-violet-400/30 rounded-2xl flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <span className="text-sm font-medium text-violet-100">AI 자율 진단</span>
        {explanation && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/30 text-violet-200 border border-violet-400/30 font-mono">{explanation.overallScore}/100</span>}
      </div>
      <div className="flex-1 min-h-0">
        {explanation ? (
          <p className="text-xs text-white/80 leading-relaxed line-clamp-3">{explanation.topInsight}</p>
        ) : loading ? (
          <div className="text-xs text-white/60 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> AI 분석 중 (10~20초)</div>
        ) : (
          <p className="text-xs text-white/60 leading-relaxed">클릭 한 번으로 최근 30일 성과의 원인과 다음 액션을 AI가 진단합니다.</p>
        )}
      </div>
      {!loading && (
        <button onClick={onOpen} className="mt-3 w-full px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:opacity-90 text-white text-xs font-semibold transition-opacity shadow-lg shadow-violet-500/20">
          {explanation ? '자세히 보기 →' : 'AI 진단 시작 →'}
        </button>
      )}
      <p className="mt-2 text-[10px] text-white/30 italic">Data source — 최근 30일 campaigns · cdp_events 기반 AI 진단</p>
    </div>
  );
}

function SummaryChip({
  icon, label, summary, accent, badge, onClick,
}: {
  icon: React.ReactNode; label: string; summary: string;
  accent: string; badge?: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 hover:border-white/20 transition-colors text-left w-full min-w-0">
      <span className={`flex-shrink-0 ${accent}`}>{icon}</span>
      <span className="flex flex-col min-w-0">
        <span className="text-xs font-medium text-white/80 flex items-center gap-1">
          {label}
          {badge && <span className="text-[9px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-300 flex-shrink-0">{badge}</span>}
        </span>
        <span className="text-[10px] text-white/40 truncate">{summary}</span>
      </span>
    </button>
  );
}

function QuickActionRow({
  icon, title, desc, color, loading, disabled, onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  color: 'rose' | 'emerald' | 'amber';
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const c: Record<string, { border: string; iconBg: string }> = {
    rose: { border: 'border-l-rose-400/60', iconBg: 'bg-rose-500/20 text-rose-300' },
    emerald: { border: 'border-l-emerald-400/60', iconBg: 'bg-emerald-500/20 text-emerald-300' },
    amber: { border: 'border-l-amber-400/60', iconBg: 'bg-amber-500/20 text-amber-300' },
  };
  const s = c[color];
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className={`w-full flex items-center gap-2.5 p-2.5 bg-white/5 border border-white/10 border-l-2 ${s.border} rounded-lg hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-left`}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${s.iconBg}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-white/85">{title}</div>
        <div className="text-[10px] text-white/50 truncate">{desc}</div>
      </div>
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-white/50 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-white/40 flex-shrink-0" />}
    </button>
  );
}

function PerfModal({
  open, title, icon, source, onClose, children, wide,
}: {
  open: boolean; title: string; icon: React.ReactNode; source?: string;
  onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
    >
      <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} max-h-[calc(100vh-2rem)] flex flex-col bg-slate-900 border border-white/10 rounded-2xl shadow-2xl`}>
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/10 flex-shrink-0">
          {icon}
          <h2 className="text-sm font-semibold text-white flex-1">{title}</h2>
          <button onClick={onClose} aria-label="닫기" className="p-1.5 rounded-lg hover:bg-white/10 text-white/60"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
        {source && <div className="px-5 py-2.5 border-t border-white/10 text-[10px] text-white/30 italic flex-shrink-0">Data source — {source}</div>}
      </div>
    </div>
  );
}

function CdpUpsellCard({ onConnect, lines }: { onConnect: () => void; lines: string }) {
  return (
    <div className="p-6 bg-gradient-to-br from-cyan-500/10 to-violet-500/10 border border-cyan-400/30 rounded-xl text-center">
      <Database className="w-8 h-8 mx-auto text-cyan-300 mb-2" />
      <div className="text-sm font-semibold text-white mb-1">자사몰 연동하면 보입니다</div>
      <div className="text-xs text-white/60 mb-3">{lines}</div>
      <button onClick={onConnect} className="px-3 py-1.5 bg-cyan-500/30 hover:bg-cyan-500/50 text-cyan-50 rounded text-xs font-semibold">자사몰 연동 진입 →</button>
    </div>
  );
}

function FunnelBar({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-0.5">
        <span className="text-white/70 font-medium">{label}</span>
        <span className="text-white/60 font-mono">{count.toLocaleString()} ({pct.toFixed(1)}%)</span>
      </div>
      <div className="h-3 bg-white/10 rounded overflow-hidden">
        <div className="h-full transition-all" style={{ width: `${Math.max(2, pct)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
