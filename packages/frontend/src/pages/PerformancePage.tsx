/**
 * PerformancePage.tsx — D213+ (2026-05-24) 4번 메뉴 성과리포트 전면 재작성
 *
 * 기존 278줄 → 신규 (Predictive 매트릭스 정합 12 화면)
 *
 * 영역:
 *   1. 상단 + 기간 선택 토글 (7d/14d/30d/90d)
 *   2. 데이터 부족 안내 카드 (CDP 미연동 / 발송 부족 / 이벤트 부족)
 *   3. AI 자율 진단 안내 카드 (Explainability — 비동기 로드)
 *   4. 1-click 액션 3 카드 (채널 ROI 회복 / 시간대 최적화 / 최고 성과 복제)
 *   5. 요약 6 metric + 격차 표시 (current vs previous)
 *   6. 자세히 분석 토글 (default 숨김)
 *   7. 자세히 영역 6 차트 (채널 ROI / 시간대 히트맵 / Funnel / 일별 추세 / 캠페인 반응 / 코호트 / 벤치마크)
 *   8. AI 영향 요인 매트릭스
 *   9. Top 캠페인 + 전체 드릴다운 (검색 + 필터 + 정렬 + 페이지네이션)
 *   10. Data source caption 의무 (feedback_no_mock_data_in_production)
 *   11. 컴퓨팅 시점 표기
 *
 * ⛔ 영구 룰:
 *   - native confirm/alert/prompt X (feedback_no_native_browser_dialog)
 *   - 모든 카드/차트 source 명시 의무 (feedback_no_mock_data_in_production)
 *   - 보라 톤 정합 (violet 그라데이션 + 액센트) — D222+ Phase 2 정정
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import {
  ArrowLeft, BarChart3, Brain, Clock, Loader2, RefreshCw, Sparkles, Target, TrendingUp, Users,
  AlertTriangle, MousePointerClick, Database, Activity, ChevronRight, ChevronLeft,
  Info, Search, Filter, ArrowUpDown, FileDown,
} from 'lucide-react';
import { useToast } from '../components/ToastProvider';

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

interface BenchmarkMetric {
  label: string;
  companyValue: number;
  industryAvg: number;
  diffPct: number;
  betterThan: boolean;
  source: string;
}

interface BenchmarkResult {
  planCode: string;
  planName: string;
  peerCompanyCount: number;
  metrics: BenchmarkMetric[];
  computedAt: string;
  source: string;
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

const PERIOD_OPTIONS: { value: PerformancePeriod; label: string }[] = [
  { value: '7d', label: '7일' },
  { value: '14d', label: '14일' },
  { value: '30d', label: '30일' },
  { value: '90d', label: '90일' },
];

const WEEKDAY_LABEL = ['일', '월', '화', '수', '목', '금', '토'];

const periodToDays = (p: PerformancePeriod): number => ({ '7d': 7, '14d': 14, '30d': 30, '90d': 90 }[p]);

export default function PerformancePage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<PerformancePeriod>('30d');
  const [snapshot, setSnapshot] = useState<SnapshotV2 | null>(null);
  const [availability, setAvailability] = useState<DataAvailability | null>(null);
  const [explanation, setExplanation] = useState<PerformanceExplanation | null>(null);
  const [cohort, setCohort] = useState<CohortResult | null>(null);
  const [benchmark, setBenchmark] = useState<BenchmarkResult | null>(null);
  const [attribution, setAttribution] = useState<AttributionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const [quickActionLoading, setQuickActionLoading] = useState<string | null>(null);

  const [campaignsExpanded, setCampaignsExpanded] = useState(false);
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

  // ★ D219+ Part 2 후속 (2026-05-27): 일일 인사이트 카드 — CT-98 collectCompanyInsight 활용
  //   매일 9시 메일 + 화면 안 즉시 확인 양쪽 흐름. 사용자가 화면 진입 시 어제 발송 + 활성 고객 즉시 확인 가능.
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

  // 기간 성과 PDF 보고서 — 풀분석 차감(같은 날 같은 기간 재다운로드는 backend 멱등으로 무료)
  const downloadPdf = async () => {
    if (pdfLoading) return;
    setPdfLoading(true);
    try {
      const res = await fetch('/api/ai/operator/performance/report-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ period }),
      });
      if (res.status === 402) {
        const d = await res.json().catch(() => ({}));
        toast.error(d?.error || 'AI 크레딧이 부족합니다.');
        setPdfLoading(false);
        return;
      }
      if (!res.ok) {
        toast.error('PDF 보고서 생성에 실패했습니다.');
        setPdfLoading(false);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `성과리포트_${period}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('PDF 보고서를 내려받았습니다.');
    } catch (e: any) {
      toast.error(e?.message || 'PDF 다운로드 중 오류가 발생했습니다.');
    }
    setPdfLoading(false);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExplanation(null);
    try {
      const headers = { Authorization: `Bearer ${token()}` };
      const days = periodToDays(period);
      const [snapRes, availRes, cohortRes, bmRes, attrRes, insightRes] = await Promise.all([
        fetch(`/api/ai/operator/performance/snapshot-v2?period=${period}`, { headers }),
        fetch('/api/ai/operator/performance/data-availability', { headers }),
        fetch('/api/ai/operator/performance/cohort?months=12', { headers }),
        fetch(`/api/ai/operator/performance/benchmark?days=${days}`, { headers }),
        fetch(`/api/ai/operator/performance/attribution?days=${days}`, { headers }),
        // ★ D219+ Part 2 후속 (2026-05-27): 일일 인사이트 fetch
        fetch('/api/insight/daily', { headers }),
      ]);
      const snapData = await snapRes.json();
      const availData = await availRes.json();
      const cohortData = await cohortRes.json();
      const bmData = await bmRes.json();
      const attrData = await attrRes.json();
      // 일일 인사이트 (실패 시 단순 skip — 본 화면 핵심 기능 X)
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
          setError('이 기능은 비즈니스 / 엔터프라이즈 요금제에서 이용 가능합니다.');
        } else {
          setError(snapData.error || '성과 매트릭스 조회 실패');
        }
        return;
      }
      setSnapshot(snapData.snapshot);
      if (availData.success) setAvailability(availData.availability);
      if (cohortData.success) setCohort(cohortData.cohort);
      if (bmData.success) setBenchmark(bmData.benchmark);
      if (attrData.success) setAttribution(attrData.attribution);
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
    if (campaignsExpanded) loadCampaigns();
  }, [campaignsExpanded, loadCampaigns]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchInput.trim());
    setCampaignsPage(1);
  };

  const handleQuickAction = async (actionType: 'channel_recovery' | 'time_optimization' | 'top_performer_replication') => {
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
      }
    } catch {}
    finally {
      setQuickActionLoading(null);
    }
  };

  const formatPct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const formatWon = (n: number) => `${Math.round(n).toLocaleString()}원`;

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

  return (
    // ★ D222+ Phase 2 (2026-05-27): 다크 → 보라 그라데이션 톤 다운 + 시인성 강화
    <div className="min-h-screen bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900 text-white">
      <div className="bg-violet-800/50 backdrop-blur-md border-b border-violet-400/30 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3 flex-wrap">
          <button onClick={() => navigate('/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-400 to-pink-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-fuchsia-500/20">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl md:text-2xl font-semibold text-white">성과 리포트</h1>
              <span className="text-[10px] bg-gradient-to-r from-amber-400 to-orange-500 text-white px-2 py-0.5 rounded-full font-bold tracking-wide">BETA</span>
            </div>
            <p className="text-xs md:text-sm text-white/50 mt-0.5">매출 / ROI / 채널·시간대 분석 + AI 자율 진단 + 기간 비교 + 1-click 액션</p>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {PERIOD_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setPeriod(o.value)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  period === o.value
                    ? 'bg-violet-500/30 text-violet-100 border border-violet-400/50'
                    : 'bg-white/5 hover:bg-white/10 text-white/60 border border-white/10'
                }`}
              >
                {o.label}
              </button>
            ))}
            <button
              onClick={downloadPdf}
              disabled={pdfLoading || loading || !snapshot || snapshot.totalCampaigns.current === 0}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium bg-gradient-to-r from-violet-500/80 to-fuchsia-500/80 hover:from-violet-500 hover:to-fuchsia-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors ml-1"
              title="기간 성과 PDF 보고서 — 풀분석 크레딧 차감(같은 날 같은 기간 재다운로드는 무료)"
            >
              {pdfLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
              PDF 보고서
            </button>
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
        {/* ★ D219+ Part 2 후속 (2026-05-27): 일일 인사이트 카드 (CT-98 collectCompanyInsight 활용) */}
        {dailyInsight && (
          <div className="rounded-2xl border border-violet-400/30 bg-gradient-to-br from-violet-500/10 via-fuchsia-500/10 to-indigo-500/10 p-5">
            <div className="flex items-start gap-4 flex-wrap">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h3 className="text-base font-semibold text-white">{dailyInsight.companyName} 일일 인사이트</h3>
                  {dailyInsight.trialDaysRemaining > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/30 text-violet-200 border border-violet-400/30 font-semibold">
                      체험 D-{dailyInsight.trialDaysRemaining}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-white/60">매일 9시 자동 메일과 동일한 인사이트 — 화면 안 즉시 확인 가능</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-[10px] text-white/50">어제 발송</p>
                <p className="text-2xl font-bold text-violet-200 mt-1">{dailyInsight.yesterdaySent.toLocaleString()}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-[10px] text-white/50">성공</p>
                <p className="text-2xl font-bold text-emerald-300 mt-1">{dailyInsight.yesterdaySuccess.toLocaleString()}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-[10px] text-white/50">실패</p>
                <p className="text-2xl font-bold text-rose-300 mt-1">{dailyInsight.yesterdayFail.toLocaleString()}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-[10px] text-white/50">활성 고객</p>
                <p className="text-2xl font-bold text-fuchsia-300 mt-1">{dailyInsight.totalCustomers.toLocaleString()}</p>
              </div>
            </div>

            <div className="mt-3 p-3 rounded-xl border border-violet-400/20 bg-violet-500/10">
              <p className="text-[11px] text-violet-100 leading-relaxed">
                <span className="font-semibold">오늘의 추천 — </span>
                {dailyInsight.totalCustomers === 0
                  ? '고객 데이터를 임포트하면 첫 발송이 가능합니다.'
                  : dailyInsight.yesterdaySent === 0
                  ? '어제 발송이 없었습니다. AI 자동 마케팅을 활용해보세요.'
                  : '꾸준한 발송이 이어지고 있습니다. 성과를 분석해 다음 캠페인을 정교화하세요.'}
              </p>
            </div>

            <p className="mt-2 text-[10px] text-white/30 italic">
              Data source — CT-98 daily-insight-mailer collectCompanyInsight (어제 0~24시 sms_send_results + customers is_active)
            </p>
          </div>
        )}

        {loading && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-12 flex flex-col items-center gap-3 text-white/50">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-300" />
            <div className="text-sm">최근 {period} 성과 매트릭스 + 데이터 영역 진단 중...</div>
          </div>
        )}

        {error && !loading && (
          <div className="bg-amber-500/10 border border-amber-400/30 rounded-xl p-6 text-amber-200">{error}</div>
        )}

        {!loading && !error && snapshot && (
          <>
            {availability && availability.cards.length > 0 && (
              <div className="space-y-2">
                {availability.cards.map((card, i) => {
                  const styleMap = {
                    critical: 'bg-rose-500/10 border-rose-400/30 text-rose-100',
                    warning: 'bg-amber-500/10 border-amber-400/30 text-amber-100',
                    info: 'bg-cyan-500/10 border-cyan-400/30 text-cyan-100',
                    good: 'bg-emerald-500/10 border-emerald-400/30 text-emerald-100',
                  }[card.level];
                  const iconColor = {
                    critical: 'text-rose-300',
                    warning: 'text-amber-300',
                    info: 'text-cyan-300',
                    good: 'text-emerald-300',
                  }[card.level];
                  const IconComp =
                    card.icon === 'cdp' ? Database :
                    card.icon === 'campaign' ? Sparkles :
                    card.icon === 'customer' ? Users :
                    Activity;
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

            <div className="p-4 bg-gradient-to-br from-violet-500/15 via-fuchsia-500/10 to-indigo-500/15 border border-violet-400/30 rounded-xl">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-violet-100 mb-1">AI 자율 진단</div>
                  {explanation ? (
                    <div className="text-xs text-white/80 leading-relaxed">{explanation.topInsight}</div>
                  ) : explainLoading ? (
                    <div className="text-xs text-white/60 flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" /> AI 분석 중 (10~20초)
                    </div>
                  ) : (
                    <button
                      onClick={loadExplanation}
                      className="text-xs text-violet-200 hover:text-violet-100 underline-offset-2 hover:underline"
                    >
                      AI 자율 진단 시작 →
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <QuickActionCard
                icon={<AlertTriangle className="w-5 h-5" />}
                title="채널 ROI 회복"
                desc="저성과 채널 회복 캠페인 자동 설계"
                color="rose"
                loading={quickActionLoading === 'channel_recovery'}
                disabled={snapshot.totalCampaigns.current === 0}
                onClick={() => handleQuickAction('channel_recovery')}
              />
              <QuickActionCard
                icon={<Clock className="w-5 h-5" />}
                title="시간대 최적화"
                desc="저성과 시간대 최적화 캠페인 자동 설계"
                color="emerald"
                loading={quickActionLoading === 'time_optimization'}
                disabled={snapshot.totalCampaigns.current === 0}
                onClick={() => handleQuickAction('time_optimization')}
              />
              <QuickActionCard
                icon={<TrendingUp className="w-5 h-5" />}
                title="최고 성과 복제"
                desc={`${period} 안 top 캠페인 복제 + 강화 매트릭스`}
                color="amber"
                loading={quickActionLoading === 'top_performer_replication'}
                disabled={snapshot.topCampaigns.length === 0}
                onClick={() => handleQuickAction('top_performer_replication')}
              />
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <SummaryMetricCard label="발송 캠페인" value={snapshot.totalCampaigns.current.toLocaleString()} metric={snapshot.totalCampaigns} icon={<Sparkles className="w-3.5 h-3.5" />} />
                <SummaryMetricCard label="총 발송" value={snapshot.totalSent.current.toLocaleString()} metric={snapshot.totalSent} icon={<Target className="w-3.5 h-3.5" />} />
                <SummaryMetricCard label="성공률" value={formatPct(snapshot.successRate.current)} metric={snapshot.successRate} icon={<Activity className="w-3.5 h-3.5" />} />
                <SummaryMetricCard label="신규 고객" value={snapshot.newCustomers.current.toLocaleString()} metric={snapshot.newCustomers} icon={<Users className="w-3.5 h-3.5" />} />
                <SummaryMetricCard label="활성 고객" value={snapshot.activeCustomers.current.toLocaleString()} metric={snapshot.activeCustomers} icon={<MousePointerClick className="w-3.5 h-3.5" />} />
                <SummaryMetricCard label="추정 매출" value={formatWon(snapshot.estimatedRevenue.current)} metric={snapshot.estimatedRevenue} icon={<TrendingUp className="w-3.5 h-3.5" />} />
              </div>
              <div className="mt-2 text-[10px] text-white/40">이전 동기간(직전 {period}) 대비 격차 표시 · {snapshot.source}</div>
            </div>

            <button
              onClick={() => setDetailsExpanded(!detailsExpanded)}
              className="w-full px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-xs text-white/60 flex items-center justify-center gap-1.5 transition-colors"
            >
              {detailsExpanded ? (
                <><ChevronLeft className="w-3 h-3 rotate-90" /> 간소 보기 — 자세한 차트 숨기기</>
              ) : (
                <><ChevronRight className="w-3 h-3 rotate-90" /> 자세한 분석 펼치기 (채널 / 시간대 / Funnel / 추세 / 캠페인 반응 / 코호트 / 벤치마크)</>
              )}
            </button>

            {detailsExpanded && (
              <div className="space-y-4">
                {snapshot.byChannelROI.length > 0 ? (
                  <ChartCard title="채널별 ROI 비교 (현재 vs 직전)" source="campaigns + MySQL 큐 직접 집계 (D144 정합)" icon={<Sparkles className="w-4 h-4 text-fuchsia-300" />}>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={snapshot.byChannelROI.map((c) => ({
                        channel: c.channel,
                        current: c.sent,
                        previous: c.previousSent,
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis dataKey="channel" stroke="rgba(255,255,255,0.5)" fontSize={11} />
                        <YAxis stroke="rgba(255,255,255,0.5)" fontSize={11} />
                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="current" name={`현재 ${period}`} fill="#a78bfa" />
                        <Bar dataKey="previous" name={`직전 ${period}`} fill="#475569" />
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="mt-2 space-y-1">
                      {snapshot.byChannelROI.map((c) => (
                        <div key={c.channel} className="flex items-center justify-between text-[11px]">
                          <span className="text-white/70 font-medium w-12">{c.channel}</span>
                          <div className="flex items-center gap-3 text-white/50">
                            <span>성공률 <span className="text-emerald-300 font-mono">{formatPct(c.successRate)}</span></span>
                            <span>비용 <span className="text-amber-300 font-mono">{formatWon(c.estimatedCost)}</span></span>
                            <span>ROAS <span className="text-cyan-300 font-mono">{c.roas > 0 ? c.roas.toFixed(2) + '×' : '-'}</span></span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ChartCard>
                ) : (
                  <ChartCard title="채널별 ROI 비교" source="campaigns" icon={<Sparkles className="w-4 h-4 text-fuchsia-300" />}>
                    <div className="text-center text-xs text-white/40 py-6">발송 데이터 없음 — 첫 캠페인 발송 후 활성</div>
                  </ChartCard>
                )}

                <ChartCard title="시간대 × 요일 히트맵" source="campaigns.sent_at (KST)" icon={<Clock className="w-4 h-4 text-cyan-300" />}>
                  {hourWeekdayMaxSent === 0 ? (
                    <div className="text-center text-xs text-white/40 py-6">발송 데이터 없음</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="text-[10px] mx-auto">
                        <thead>
                          <tr>
                            <th className="w-10 text-white/40 font-medium">시</th>
                            {WEEKDAY_LABEL.map((w) => (
                              <th key={w} className="w-10 text-white/40 font-medium">{w}</th>
                            ))}
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
                                    style={{
                                      backgroundColor: intensity > 0 ? `rgba(167, 139, 250, ${0.15 + intensity * 0.7})` : 'rgba(255,255,255,0.03)',
                                    }}
                                    title={cell ? `${cell.sent.toLocaleString()}건 성공률 ${formatPct(cell.successRate)}` : '0건'}
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
                </ChartCard>

                {snapshot.funnelStats && snapshot.funnelStats.viewCount > 0 ? (
                  <ChartCard title="자사몰 Funnel 시각화" source="cdp_events (page_view → cart_add → purchase)" icon={<Activity className="w-4 h-4 text-emerald-300" />}>
                    <div className="space-y-2">
                      <FunnelBar label="page_view" count={snapshot.funnelStats.viewCount} max={snapshot.funnelStats.viewCount} color="#6366f1" />
                      <FunnelBar label="cart_add" count={snapshot.funnelStats.cartAddCount} max={snapshot.funnelStats.viewCount} color="#06b6d4" />
                      <FunnelBar label="wishlist_add" count={snapshot.funnelStats.wishlistAddCount} max={snapshot.funnelStats.viewCount} color="#a78bfa" />
                      <FunnelBar label="purchase" count={snapshot.funnelStats.purchaseCount} max={snapshot.funnelStats.viewCount} color="#10b981" />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
                      <div className="p-2 bg-white/5 rounded text-center">
                        <div className="text-white/40">cart 전환율</div>
                        <div className="text-cyan-300 font-mono font-bold">{formatPct(snapshot.funnelStats.cartConversionRate)}</div>
                      </div>
                      <div className="p-2 bg-white/5 rounded text-center">
                        <div className="text-white/40">구매 전환율</div>
                        <div className="text-emerald-300 font-mono font-bold">{formatPct(snapshot.funnelStats.purchaseConversionRate)}</div>
                      </div>
                      <div className="p-2 bg-white/5 rounded text-center">
                        <div className="text-white/40">cart → 구매</div>
                        <div className="text-fuchsia-300 font-mono font-bold">{formatPct(snapshot.funnelStats.cartToPurchaseRate)}</div>
                      </div>
                    </div>
                  </ChartCard>
                ) : (
                  <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
                    <div className="flex items-start gap-3">
                      <Info className="w-4 h-4 text-cyan-300 mt-0.5" />
                      <div>
                        <div className="text-sm font-semibold text-white/80 mb-0.5">자사몰 Funnel 비활성</div>
                        <div className="text-xs text-white/50">자사몰 연동 시 page_view → cart_add → purchase 전환율 영역 자동 시각화.</div>
                      </div>
                    </div>
                  </div>
                )}

                <ChartCard title={`${period} 일별 추세 (현재 + 직전 overlay)`} source="campaigns (KST 일별 그룹)" icon={<TrendingUp className="w-4 h-4 text-amber-300" />}>
                  {trendData.length === 0 || trendData.every((d) => d.current === 0 && d.previous === 0) ? (
                    <div className="text-center text-xs text-white/40 py-6">발송 데이터 없음</div>
                  ) : (
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
                  )}
                </ChartCard>

                {attribution && (
                  <ChartCard title="캠페인 진행 후 반응 매트릭스" source={attribution.source} icon={<MousePointerClick className="w-4 h-4 text-fuchsia-300" />}>
                    {attribution.totalCampaigns === 0 ? (
                      <div className="text-xs text-white/40 py-4 text-center">발송 캠페인 X — 캠페인 발송 후 반응 영역 활성됩니다.</div>
                    ) : (
                      <div className="space-y-3">
                        <div className="text-[11px] text-white/60">
                          분석 기간: {attribution.analysisPeriodDays}일 / 캠페인 {attribution.totalCampaigns}건 / 발송 {attribution.totalSent.toLocaleString()}건 / 성공 {attribution.totalSuccess.toLocaleString()}건
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          {attribution.windows.map((w) => (
                            <div key={w.windowLabel} className="p-3 bg-white/5 border border-white/10 rounded-lg">
                              <div className="text-[10px] text-white/40 mb-1">캠페인 발송 후 {w.windowLabel}</div>
                              {attribution.hasCdpData ? (
                                <>
                                  <div className="text-base font-bold text-emerald-300 font-mono">{w.cdpPurchaseCount.toLocaleString()}건</div>
                                  <div className="text-[10px] text-white/60 mt-0.5">CDP 구매 / 매출 <span className="text-amber-300 font-mono">{formatWon(w.cdpRevenue)}</span></div>
                                </>
                              ) : (
                                <>
                                  <div className="text-base font-bold text-cyan-300 font-mono">{w.customerPurchaseCount.toLocaleString()}명</div>
                                  <div className="text-[10px] text-white/60 mt-0.5">recent_purchase_date 갱신 (CDP 미연동 fallback)</div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </ChartCard>
                )}

                {cohort && cohort.cohorts.length > 0 && (
                  <ChartCard title="가입월별 Retention Curve" source={cohort.source} icon={<Users className="w-4 h-4 text-violet-300" />}>
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
                      평균 M1 retention: <span className="text-cyan-300 font-mono">{formatPct(cohort.avgM1Rate)}</span> · M3 retention: <span className="text-violet-300 font-mono">{formatPct(cohort.avgM3Rate)}</span>
                    </div>
                  </ChartCard>
                )}

                {benchmark && benchmark.peerCompanyCount > 0 && (
                  <ChartCard title={`${benchmark.planName} 요금제 평균 대비 벤치마크`} source={benchmark.source} icon={<BarChart3 className="w-4 h-4 text-amber-300" />}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {benchmark.metrics.map((m) => (
                        <div key={m.label} className="p-3 bg-white/5 border border-white/10 rounded-lg">
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-[11px] text-white/60">{m.label}</div>
                            <span className={`text-[10px] font-mono font-bold ${m.betterThan ? 'text-emerald-300' : 'text-rose-300'}`}>
                              {m.diffPct >= 0 ? '+' : ''}{m.diffPct.toFixed(1)}%
                            </span>
                          </div>
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <div className="text-base font-mono font-bold text-white">
                              {typeof m.companyValue === 'number' && m.companyValue < 1 && m.companyValue > 0 ? formatPct(m.companyValue) : Math.round(m.companyValue).toLocaleString()}
                            </div>
                            <div className="text-[10px] text-white/40">vs 평균 <span className="font-mono text-white/60">
                              {typeof m.industryAvg === 'number' && m.industryAvg < 1 && m.industryAvg > 0 ? formatPct(m.industryAvg) : Math.round(m.industryAvg).toLocaleString()}
                            </span></div>
                          </div>
                          <div className="mt-1 text-[9px] text-white/30 truncate" title={m.source}>{m.source}</div>
                        </div>
                      ))}
                    </div>
                  </ChartCard>
                )}
                {benchmark && benchmark.peerCompanyCount === 0 && (
                  <div className="p-4 bg-white/5 border border-white/10 rounded-xl text-xs text-white/50">
                    {benchmark.source}
                  </div>
                )}
              </div>
            )}

            {explanation && explanation.factors.length > 0 && (
              <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
                <div className="flex items-center gap-2 mb-3">
                  <Brain className="w-4 h-4 text-violet-300" />
                  <h2 className="text-sm font-semibold">AI 영향 요인 매트릭스</h2>
                  <span className="ml-auto text-[10px] text-white/40">전체 성과 스코어 <span className="text-violet-300 font-mono font-bold">{explanation.overallScore}</span>/100</span>
                </div>
                <div className="space-y-1.5">
                  {explanation.factors.map((f, i) => {
                    const dirColor = f.direction === 'positive' ? 'bg-emerald-400' : f.direction === 'negative' ? 'bg-rose-400' : 'bg-amber-400';
                    const dirTextColor = f.direction === 'positive' ? 'text-emerald-300' : f.direction === 'negative' ? 'text-rose-300' : 'text-amber-300';
                    return (
                      <div key={i} className="grid grid-cols-12 gap-2 items-center text-[11px]">
                        <div className="col-span-3 text-white/70 font-medium">{f.label}</div>
                        <div className="col-span-5">
                          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                            <div className={`h-full ${dirColor}`} style={{ width: `${f.impactScore * 100}%` }} />
                          </div>
                        </div>
                        <div className={`col-span-1 text-right font-mono ${dirTextColor}`}>{(f.impactScore * 100).toFixed(0)}%</div>
                        <div className="col-span-3 text-[10px] text-white/50 truncate" title={f.detail}>{f.detail}</div>
                      </div>
                    );
                  })}
                </div>
                {explanation.recommendation && (
                  <div className="mt-3 p-2 bg-violet-500/10 border border-violet-400/30 rounded text-[11px] text-violet-100">
                    <strong>1순위 권장:</strong> {explanation.recommendation}
                  </div>
                )}
                <div className="mt-2 text-[10px] text-white/30 italic">
                  Data source — {Array.from(new Set(explanation.factors.map((f) => f.sourceField))).slice(0, 3).join(' · ')}
                </div>
              </div>
            )}

            {snapshot.topCampaigns.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-fuchsia-300" />
                    <h2 className="text-sm font-semibold">Top 캠페인 ({period})</h2>
                  </div>
                  <button
                    onClick={() => setCampaignsExpanded(!campaignsExpanded)}
                    className="text-[11px] text-violet-200 hover:text-violet-100 underline-offset-2 hover:underline"
                  >
                    {campaignsExpanded ? '전체 드릴다운 숨기기' : '전체 드릴다운 펼치기 →'}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-white/5 border-b border-white/10">
                      <tr className="text-left text-white/60">
                        <th className="px-3 py-2 font-medium">캠페인</th>
                        <th className="px-3 py-2 font-medium text-center">채널</th>
                        <th className="px-3 py-2 font-medium text-right">발송</th>
                        <th className="px-3 py-2 font-medium text-right">성공률</th>
                        <th className="px-3 py-2 font-medium text-right">매출</th>
                        <th className="px-3 py-2 font-medium text-right">ROAS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.topCampaigns.map((c) => (
                        <tr key={c.id} className="border-b border-white/5 hover:bg-white/5">
                          <td className="px-3 py-2">
                            <div className="text-white/80">{c.name}</div>
                            <div className="text-[10px] text-white/40">{new Date(c.sentAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</div>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className="text-[10px] px-1.5 py-0.5 bg-violet-500/20 text-violet-300 rounded font-mono">{c.messageType}</span>
                            {c.isAd && <span className="text-[10px] px-1 py-0.5 ml-1 bg-amber-500/20 text-amber-300 rounded">광고</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{c.sent.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-mono text-emerald-300">{formatPct(c.successRate)}</td>
                          <td className="px-3 py-2 text-right font-mono text-amber-300">{c.estimatedRevenue > 0 ? formatWon(c.estimatedRevenue) : '-'}</td>
                          <td className="px-3 py-2 text-right font-mono text-cyan-300">{c.roas > 0 ? c.roas.toFixed(2) + '×' : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {campaignsExpanded && (
                  <div className="border-t border-white/10 bg-violet-900/30">
                    <div className="p-3 border-b border-white/10 flex flex-col md:flex-row gap-2">
                      <form onSubmit={handleSearch} className="flex-1 flex gap-2">
                        <div className="relative flex-1">
                          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40" />
                          <input
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="캠페인명 검색"
                            className="w-full pl-8 pr-3 py-1.5 bg-violet-900/40 border border-white/10 rounded text-xs text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50"
                          />
                        </div>
                        <button type="submit" className="px-3 py-1.5 bg-violet-500/30 hover:bg-violet-500/50 text-violet-100 rounded text-xs font-medium">검색</button>
                      </form>
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <Filter className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                          <select value={filterChannel} onChange={(e) => { setFilterChannel(e.target.value); setCampaignsPage(1); }} className="pl-6 pr-7 py-1.5 bg-violet-900/40 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-violet-400/50 appearance-none">
                            <option value="all" className="bg-violet-900/40">전체 채널</option>
                            <option value="sms" className="bg-violet-900/40">SMS</option>
                            <option value="lms" className="bg-violet-900/40">LMS</option>
                            <option value="mms" className="bg-violet-900/40">MMS</option>
                            <option value="kakao" className="bg-violet-900/40">KAKAO</option>
                          </select>
                        </div>
                        <div className="relative">
                          <Filter className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                          <select value={filterAd} onChange={(e) => { setFilterAd(e.target.value); setCampaignsPage(1); }} className="pl-6 pr-7 py-1.5 bg-violet-900/40 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-violet-400/50 appearance-none">
                            <option value="all" className="bg-violet-900/40">광고/안내</option>
                            <option value="ad" className="bg-violet-900/40">광고만</option>
                            <option value="info" className="bg-violet-900/40">안내만</option>
                          </select>
                        </div>
                        <div className="relative">
                          <ArrowUpDown className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                          <select value={sort} onChange={(e) => { setSort(e.target.value); setCampaignsPage(1); }} className="pl-6 pr-7 py-1.5 bg-violet-900/40 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-violet-400/50 appearance-none">
                            <option value="sent_desc" className="bg-violet-900/40">발송 ↓</option>
                            <option value="success_rate_desc" className="bg-violet-900/40">성공률 ↓</option>
                            <option value="sent_at_desc" className="bg-violet-900/40">최근 ↓</option>
                            <option value="sent_at_asc" className="bg-violet-900/40">오래된 순 ↓</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {campaignsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
                      </div>
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
                                <td className="px-3 py-2 text-right font-mono">{c.sent.toLocaleString()}</td>
                                <td className="px-3 py-2 text-right font-mono text-emerald-300">{formatPct(c.successRate)}</td>
                                <td className="px-3 py-2 text-right font-mono text-amber-300">{formatWon(c.cost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {campaignsTotalPages > 1 && (
                      <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between text-[11px] text-white/50">
                        <div>전체 {campaignsTotal.toLocaleString()}건</div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setCampaignsPage(Math.max(1, campaignsPage - 1))} disabled={campaignsPage === 1} className="p-1 hover:bg-white/5 rounded disabled:opacity-30">
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <span className="font-mono">{campaignsPage} / {campaignsTotalPages}</span>
                          <button onClick={() => setCampaignsPage(Math.min(campaignsTotalPages, campaignsPage + 1))} disabled={campaignsPage === campaignsTotalPages} className="p-1 hover:bg-white/5 rounded disabled:opacity-30">
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="text-center text-[11px] text-white/40 pt-2">
              마지막 계산: {new Date(snapshot.computedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
              <br />
              이 추천은 AI 분석 결과이며 사용자 검토 + 승인 후 발송됩니다 (AI 단독 발송 X). 0건 자동완화 X — 발송 차단 정책 정합.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 컴포넌트
// ════════════════════════════════════════════════════════════════════

function SummaryMetricCard({
  label, value, metric, icon,
}: {
  label: string;
  value: string;
  metric: PerformanceMetricV2;
  icon: React.ReactNode;
}) {
  const diffColor = metric.diffPct === 0 ? 'text-white/40' : metric.betterThan ? 'text-emerald-300' : 'text-rose-300';
  const arrow = metric.diffPct === 0 ? '─' : metric.betterThan ? '↑' : '↓';
  return (
    <div className="p-3 bg-white/5 rounded-lg">
      <div className="flex items-center gap-1.5 text-[10px] text-white/40 mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-base md:text-lg font-bold text-white truncate" title={value}>{value}</div>
      <div className={`text-[10px] font-mono ${diffColor}`}>
        {arrow} {metric.diffPct === 0 ? '변동 없음' : `${metric.diffPct >= 0 ? '+' : ''}${metric.diffPct.toFixed(1)}%`}
      </div>
    </div>
  );
}

function QuickActionCard({
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
  const colorMap: Record<string, { bg: string; border: string; text: string; iconBg: string; iconText: string; btn: string }> = {
    rose: { bg: 'bg-rose-500/10', border: 'border-rose-400/30', text: 'text-rose-100', iconBg: 'bg-rose-500/30', iconText: 'text-rose-200', btn: 'bg-rose-500/30 hover:bg-rose-500/50 text-rose-50' },
    emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-400/30', text: 'text-emerald-100', iconBg: 'bg-emerald-500/30', iconText: 'text-emerald-200', btn: 'bg-emerald-500/30 hover:bg-emerald-500/50 text-emerald-50' },
    amber: { bg: 'bg-amber-500/10', border: 'border-amber-400/30', text: 'text-amber-100', iconBg: 'bg-amber-500/30', iconText: 'text-amber-200', btn: 'bg-amber-500/30 hover:bg-amber-500/50 text-amber-50' },
  };
  const c = colorMap[color];
  return (
    <div className={`p-4 ${c.bg} border ${c.border} rounded-xl`}>
      <div className="flex items-start gap-2.5 mb-2">
        <div className={`w-9 h-9 rounded-lg ${c.iconBg} flex items-center justify-center flex-shrink-0`}>
          <span className={c.iconText}>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold ${c.text}`}>{title}</div>
        </div>
      </div>
      <div className="text-[11px] text-white/60 leading-relaxed mb-2.5">{desc}</div>
      <button
        onClick={onClick}
        disabled={loading || disabled}
        className={`w-full px-3 py-1.5 ${c.btn} disabled:opacity-30 disabled:cursor-not-allowed rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors`}
      >
        {loading ? (
          <><Loader2 className="w-3 h-3 animate-spin" /> 준비 중</>
        ) : (
          <><Sparkles className="w-3 h-3" /> AI 자동 마케팅 진입</>
        )}
      </button>
    </div>
  );
}

function ChartCard({
  title, source, icon, children,
}: {
  title: string;
  source?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/10 flex items-center gap-1.5">
        {icon}
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="p-4">
        {children}
        {source && (
          <div className="text-[10px] text-white/30 italic mt-2 truncate" title={source}>Data source — {source}</div>
        )}
      </div>
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
