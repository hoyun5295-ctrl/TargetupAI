/**
 * PredictiveDashboardPage.tsx — AI 자율 예측 (발견·제안 중심 인사이트 엔진)
 *
 * 2026-06-07 재설계 (Harold 명시 — "어정쩡한 숫자판" 정정):
 *   메인 3블록 = ① cold start / 요약 안내 1줄 ② AI 발견 세그먼트(이탈 / 구매 / VIP, 주인공) ③ 작은 요약 바
 *   나머지(전체 고객 목록 · 분포 · 정확도 · 고객 근거)는 전부 모달 — 난잡 금지 5원칙.
 *   AI가 위험·기회·VIP 그룹을 스스로 발견 + 근거 한 줄 + 1클릭 캠페인(사람이 최종 결정).
 *   근거(reasonSummary)는 backend getCompanyPredictionSummary discoveredSegments — 실데이터 기반.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import {
  ArrowLeft, Brain, MousePointerClick, AlertTriangle, ShoppingCart, Loader2,
  TrendingUp, Users, Sparkles, Search, Filter, ArrowUpDown,
  ChevronLeft, ChevronRight, Database, Info, X, Crown, ArrowRight, UserPlus, Repeat, RefreshCw,
} from 'lucide-react';

interface HistogramBin {
  range: string;
  count: number;
  pct: number;
}

interface CustomerRow {
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  customerGrade: string | null;
  customerRegion: string | null;
  clickScore: number;
  churnRisk: number;
  purchaseLikelihood: number;
  lastActivityDays: number | null;
  modelVersion?: string;
  ltv60d?: number;
  ltv90d?: number;
  ltv365d?: number;
  nextPurchaseDays?: number | null;
  channelPreference?: string | null;
  bestHour?: number | null;
  tonePreference?: string | null;
}

interface ExplainFactor {
  category: 'recency' | 'click_history' | 'purchase_frequency' | 'grade' | 'engagement' | 'channel';
  label: string;
  impactScore: number;
  direction: 'positive' | 'negative' | 'neutral';
  detail: string;
  sourceField: string;
}

interface CustomerExplanation {
  customerId: string;
  customerName: string | null;
  customerGrade: string | null;
  predictions: {
    clickScore: number;
    churnRisk: number;
    purchaseLikelihood: number;
    ltv90d: number;
    nextPurchaseDays: number | null;
    channelPreference: string | null;
    bestHour: number | null;
  };
  factors: ExplainFactor[];
  topRecommendation: string;
  explainedAt: string;
}

interface ModelAccuracy {
  clickPredicted: number;
  clickActual: number;
  clickAccuracy: number;
  conversionPredicted: number;
  conversionActual: number;
  conversionAccuracy: number;
}

interface Distribution {
  histogram: {
    clickScore: HistogramBin[];
    churnRisk: HistogramBin[];
    purchaseLikelihood: HistogramBin[];
  };
  topRiskCustomers: CustomerRow[];
  topPotentialCustomers: CustomerRow[];
  modelAccuracy: ModelAccuracy | null;
  totalCustomers: number;
  computedAt: string | null;
}

// ★ 2026-06-07: AI 발견 세그먼트 (backend discoveredSegments)
interface DiscoveredSegment {
  key: 'churn_recovery' | 'purchase_push' | 'vip_engagement' | 'first_purchase' | 'high_engagement' | 'repurchase_imminent';
  label: string;
  count: number;
  reasonSummary: string;
  accent: 'rose' | 'emerald' | 'fuchsia' | 'indigo' | 'cyan' | 'amber';
}

interface Summary {
  totalCustomersInCompany: number;
  totalCustomersInPredictions: number;
  predictionCoverage: number;
  coldStartCount: number;
  trainedCount: number;
  isAllColdStart: boolean;
  lastComputedAt: string | null;
  highRiskCount: number;
  highPotentialCount: number;
  avgClickScore: number;
  avgChurnRisk: number;
  avgPurchaseLikelihood: number;
  insightText: string;
  avgLtv60d: number;
  avgLtv90d: number;
  avgLtv365d: number;
  totalProjectedLtv60d: number;
  totalProjectedLtv90d: number;
  totalProjectedLtv365d: number;
  highLtvCount: number;
  channelDistribution: Array<{ channel: string; count: number; pct: number }>;
  bestHourDistribution: Array<{ hour: number; count: number; pct: number }>;
  discoveredSegments: DiscoveredSegment[];
}

interface CustomerListResponse {
  success: boolean;
  customers: CustomerRow[];
  totalCount: number;
  filteredCount: number;
  page: number;
  totalPages: number;
  limit: number;
}

type FilterType = 'all' | 'high_risk' | 'high_potential' | 'high_click' | 'high_ltv' | 'first_purchase' | 'repurchase' | 'cold_start';
type SortType =
  | 'churn_risk_desc'
  | 'purchase_likelihood_desc'
  | 'click_score_desc'
  | 'ltv_365d_desc'
  | 'last_activity_asc'
  | 'last_activity_desc';

const FILTER_OPTIONS: { value: FilterType; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'high_risk', label: '이탈 위험 70%+' },
  { value: 'high_potential', label: '구매 가능성 60%+' },
  { value: 'high_click', label: '클릭 가능성 50%+' },
  { value: 'high_ltv', label: 'VIP (LTV 상위)' },
  { value: 'first_purchase', label: '첫 구매 전' },
  { value: 'repurchase', label: '재구매 임박' },
  { value: 'cold_start', label: '초기 추정' },
];

const SORT_OPTIONS: { value: SortType; label: string }[] = [
  { value: 'churn_risk_desc', label: '이탈 위험 ↓' },
  { value: 'purchase_likelihood_desc', label: '구매 가능성 ↓' },
  { value: 'click_score_desc', label: '클릭 가능성 ↓' },
  { value: 'ltv_365d_desc', label: 'LTV ↓' },
  { value: 'last_activity_asc', label: '미활동 일수 ↓' },
  { value: 'last_activity_desc', label: '최근 활동 ↓' },
];

// 세그먼트 accent → 색 매핑
const SEG_FILTER: Record<DiscoveredSegment['key'], FilterType> = {
  churn_recovery: 'high_risk',
  purchase_push: 'high_potential',
  vip_engagement: 'high_ltv',
  first_purchase: 'first_purchase',
  high_engagement: 'high_click',
  repurchase_imminent: 'repurchase',
};
const ACCENT: Record<DiscoveredSegment['accent'], {
  grad: string; text: string; iconBg: string; border: string; btn: string;
}> = {
  rose: {
    grad: 'from-rose-500 to-pink-500', text: 'text-rose-300', iconBg: 'bg-rose-500/20',
    border: 'border-rose-400/25', btn: 'from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600',
  },
  emerald: {
    grad: 'from-emerald-500 to-teal-500', text: 'text-emerald-300', iconBg: 'bg-emerald-500/20',
    border: 'border-emerald-400/25', btn: 'from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600',
  },
  fuchsia: {
    grad: 'from-fuchsia-500 to-purple-500', text: 'text-fuchsia-300', iconBg: 'bg-fuchsia-500/20',
    border: 'border-fuchsia-400/25', btn: 'from-fuchsia-500 to-purple-500 hover:from-fuchsia-600 hover:to-purple-600',
  },
  indigo: {
    grad: 'from-indigo-500 to-blue-500', text: 'text-indigo-300', iconBg: 'bg-indigo-500/20',
    border: 'border-indigo-400/25', btn: 'from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600',
  },
  cyan: {
    grad: 'from-cyan-500 to-sky-500', text: 'text-cyan-300', iconBg: 'bg-cyan-500/20',
    border: 'border-cyan-400/25', btn: 'from-cyan-500 to-sky-500 hover:from-cyan-600 hover:to-sky-600',
  },
  amber: {
    grad: 'from-amber-500 to-orange-500', text: 'text-amber-300', iconBg: 'bg-amber-500/20',
    border: 'border-amber-400/25', btn: 'from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600',
  },
};

export default function PredictiveDashboardPage() {
  const navigate = useNavigate();
  const [distribution, setDistribution] = useState<Distribution | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 고객 목록 (모달 안에서 사용)
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [sort, setSort] = useState<SortType>('churn_risk_desc');
  const [totalCount, setTotalCount] = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);
  const [explanationMap, setExplanationMap] = useState<Record<string, CustomerExplanation>>({});
  const [explainLoading, setExplainLoading] = useState<Record<string, boolean>>({});
  const [quickActionLoading, setQuickActionLoading] = useState<string | null>(null);

  // ★ 2026-06-07: 모달 표시 상태 (난잡 금지 — 메인은 3블록, 나머지 모달)
  const [showCustomersModal, setShowCustomersModal] = useState(false);
  const [segmentReason, setSegmentReason] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);  // 분포·정확도 모달
  const [recomputing, setRecomputing] = useState(false);  // 지금 전체 재계산 진행

  // 매일 자동 예측 ON/OFF
  const [predictiveEnabled, setPredictiveEnabled] = useState<boolean | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMigrationPending, setSettingsMigrationPending] = useState(false);

  const token = () => localStorage.getItem('token');

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/ai/operator/predictive/settings', { headers: { Authorization: `Bearer ${token()}` } });
        if (res.status === 503) { setSettingsMigrationPending(true); return; }
        const d = await res.json();
        if (d.success) setPredictiveEnabled(!!d.predictiveEnabled);
      } catch { /* 설정 조회 실패 — 토글 숨김 */ }
    })();
  }, []);

  const togglePredictive = async () => {
    if (settingsSaving || predictiveEnabled === null) return;
    const next = !predictiveEnabled;
    setSettingsSaving(true);
    try {
      const res = await fetch('/api/ai/operator/predictive/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.status === 503) { setSettingsMigrationPending(true); setSettingsSaving(false); return; }
      const d = await res.json();
      if (d.success) setPredictiveEnabled(!!d.predictiveEnabled);
    } catch { /* 변경 실패 — 상태 유지 */ }
    setSettingsSaving(false);
  };

  // 첫 mount = distribution + summary 동시 로드
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [distRes, sumRes] = await Promise.all([
          fetch('/api/ai/operator/predictive/distribution', { headers: { Authorization: `Bearer ${token()}` } }),
          fetch('/api/ai/operator/predictive/summary', { headers: { Authorization: `Bearer ${token()}` } }),
        ]);
        const dist = await distRes.json();
        const sum = await sumRes.json();
        if (dist.success) setDistribution(dist.distribution);
        else setError(dist.error || '예측 분포 조회 실패');
        if (sum.success) setSummary(sum.summary);
      } catch {
        setError('네트워크 오류');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // 고객 목록 — page/filter/sort/search 변경 시 자동 fetch (모달에서 소비)
  const fetchCustomers = useCallback(async () => {
    setCustomerLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        filter,
        sort,
      });
      if (search) params.set('search', search);
      const res = await fetch(`/api/ai/operator/predictive/customers?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data: CustomerListResponse = await res.json();
      if (data.success) {
        setCustomers(data.customers);
        setTotalCount(data.totalCount);
        setFilteredCount(data.filteredCount);
        setTotalPages(data.totalPages);
      }
    } catch {
      // 네트워크 오류 — 기존 데이터 유지
    } finally {
      setCustomerLoading(false);
    }
  }, [page, limit, filter, sort, search]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  };

  const handleFilterChange = (v: FilterType) => {
    setFilter(v);
    setPage(1);
  };

  const handleSortChange = (v: SortType) => {
    setSort(v);
    setPage(1);
  };

  const formatPct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const formatWon = (n: number) => `${Math.round(n).toLocaleString()}원`;

  // Explainability fetch (고객 클릭 시)
  const loadExplanation = async (customerId: string) => {
    if (explanationMap[customerId] || explainLoading[customerId]) return;
    setExplainLoading((prev) => ({ ...prev, [customerId]: true }));
    try {
      const res = await fetch(`/api/ai/operator/predictive/customers/${customerId}/explain`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success && data.explanation) {
        setExplanationMap((prev) => ({ ...prev, [customerId]: data.explanation }));
      }
    } catch {}
    finally {
      setExplainLoading((prev) => ({ ...prev, [customerId]: false }));
    }
  };

  const openDetail = (customerId: string) => {
    setExpandedCustomerId(customerId);
    loadExplanation(customerId);
  };
  const closeDetail = () => setExpandedCustomerId(null);

  // 발견 세그먼트 "근거 보기" → 해당 그룹으로 필터한 고객 목록 모달
  const openSegmentCustomers = (seg: DiscoveredSegment) => {
    setFilter(SEG_FILTER[seg.key]);
    if (seg.key === 'vip_engagement') setSort('ltv_365d_desc');
    else if (seg.key === 'churn_recovery') setSort('churn_risk_desc');
    else setSort('purchase_likelihood_desc');
    setSearch('');
    setSearchInput('');
    setPage(1);
    setSegmentReason(seg.reasonSummary);
    setShowCustomersModal(true);
  };

  // 작은 요약 바 "전체 고객" → 필터 없는 전체 목록 모달
  const openAllCustomers = () => {
    setFilter('all');
    setSort('churn_risk_desc');
    setSearch('');
    setSearchInput('');
    setPage(1);
    setSegmentReason(null);
    setShowCustomersModal(true);
  };

  // 1-click 액션 — AI 자동 마케팅(ContinuousOperator) prefill 진입
  const handleQuickAction = async (actionType: DiscoveredSegment['key']) => {
    setQuickActionLoading(actionType);
    try {
      const res = await fetch('/api/ai/operator/predictive/quick-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ actionType }),
      });
      const data = await res.json();
      if (data.success) {
        const actionLabelMap: Record<string, string> = {
          churn_recovery: '이탈 위험 회복',
          purchase_push: '구매 유도',
          vip_engagement: 'VIP LTV 보존',
          first_purchase: '첫 구매 유도',
          high_engagement: '관심·반응 활성화',
          repurchase_imminent: '재구매 유도',
        };
        sessionStorage.setItem('continuousOperatorPrefill', JSON.stringify({
          name: actionLabelMap[actionType] || '자동 마케팅',
          objective: data.objective,
          actionType,
          targetCount: data.targetCount,
          suggestedChannel: data.suggestedChannel,
          suggestedTone: data.suggestedTone,
        }));
        // 기존 1회성 발송 흐름에서도 활용 가능
        sessionStorage.setItem('aiOperatorPrefill', JSON.stringify({
          objective: data.objective,
          targetFilters: data.targetFilters,
          suggestedChannel: data.suggestedChannel,
          suggestedTone: data.suggestedTone,
        }));
        navigate('/continuous-operator');
      }
    } catch {}
    finally {
      setQuickActionLoading(null);
    }
  };

  // 지금 전체 재계산 (연동 무관·회사 전체) — 매일 워커가 비연동 회사를 skip하는 문제 우회
  const handleRecompute = async () => {
    if (recomputing) return;
    setRecomputing(true);
    try {
      const res = await fetch('/api/ai/operator/predictive/recompute', {
        method: 'POST', headers: { Authorization: `Bearer ${token()}` },
      });
      const d = await res.json();
      if (d.success) { window.location.reload(); return; }
    } catch { /* 재계산 실패 — 상태 복구 */ }
    setRecomputing(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900 text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
      </div>
    );
  }

  if (error || !distribution || !summary) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-rose-300 mb-2">{error || '데이터 조회 실패'}</div>
          <button onClick={() => navigate('/ai-operator')} className="px-4 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 rounded">
            AI Operator로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  const segments = summary.discoveredSegments || [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="max-w-5xl mx-auto p-4 md:p-6">
        {/* 블록1: 헤더 */}
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => navigate('/ai-operator')} className="p-2 hover:bg-white/5 rounded-lg shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg md:text-xl font-semibold flex items-center gap-2">
              AI 자율 예측
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 font-medium">실험실</span>
            </h1>
            <p className="text-xs text-white/50 mt-0.5 truncate">위험·기회 고객을 AI가 먼저 찾아 제안합니다</p>
          </div>
          <button
            onClick={handleRecompute}
            disabled={recomputing}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-white/80 disabled:opacity-50 transition-colors"
            title="회사 전체 고객을 지금 다시 계산합니다 (하루 1회 · DB 규모 기준 차감)"
          >
            {recomputing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{recomputing ? '계산 중' : '지금 재계산'}</span>
          </button>
          {/* 연동(싱크에이전트·SDK) 회사는 매일 1회 자동 분석 — on/off 토글 폐지(크레딧 모델 v2). 차감은 DB 규모 기준. */}
          {!settingsMigrationPending && (
            <div className="flex flex-col items-end gap-1 shrink-0">
              <span className="text-xs text-white/70">매일 1회 자동 분석</span>
              <span className="text-[10px] text-white/40">연동 시 DB 규모 기준 자동 차감 · 미연동 0</span>
            </div>
          )}
          {settingsMigrationPending && (
            <div className="shrink-0 text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-400/30 rounded-lg px-2.5 py-1.5 flex items-center gap-1">
              <Info className="w-3 h-3" /> DB 준비 중
            </div>
          )}
        </div>

        {/* 블록2: 안내 1줄 — cold start면 추정 안내, 학습 후면 한 줄 요약 */}
        <div className={`mb-5 px-4 py-3 rounded-xl border flex items-start gap-2.5 text-xs leading-relaxed ${summary.isAllColdStart
          ? 'bg-amber-500/10 border-amber-400/25 text-amber-100/90'
          : 'bg-violet-500/10 border-violet-400/25 text-white/80'}`}>
          {summary.isAllColdStart
            ? <Info className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
            : <Sparkles className="w-4 h-4 text-violet-300 shrink-0 mt-0.5" />}
          <span>
            {summary.isAllColdStart
              ? `현재 ${summary.totalCustomersInPredictions.toLocaleString()}명이 등급·활동 기반 추정치입니다(실제 발송 0건). 발송·클릭이 쌓이면 24시간 안에 실측 모델로 자동 전환됩니다.`
              : summary.insightText}
          </span>
        </div>

        {/* 블록3: AI 발견 세그먼트 (주인공) */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-violet-300" />
            <h2 className="text-sm font-semibold text-white">AI가 발견한 고객 그룹</h2>
            <span className="text-[11px] text-white/40">지금 행동하면 효과가 큰 그룹입니다</span>
          </div>
          {segments.length === 0 ? (
            <div className="px-5 py-8 rounded-2xl bg-white/[0.03] border border-white/10 text-center">
              <Brain className="w-8 h-8 text-white/20 mx-auto mb-2" />
              <div className="text-sm text-white/60">아직 뚜렷한 그룹을 찾지 못했습니다.</div>
              <div className="text-xs text-white/40 mt-1">발송이 쌓이면 AI가 위험·기회 고객을 자동으로 골라냅니다.</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {segments.map((seg) => (
                <SegmentCard
                  key={seg.key}
                  seg={seg}
                  isColdStart={summary.isAllColdStart}
                  actionLoading={quickActionLoading === seg.key}
                  onSeeReason={() => openSegmentCustomers(seg)}
                  onCampaign={() => handleQuickAction(seg.key)}
                />
              ))}
            </div>
          )}
          <div className="text-[10px] text-white/30 italic mt-2">Data source — cdp_customer_predictions (매일 1회 자동 분석)</div>
        </div>

        {/* 블록4: 작은 요약 바 — 한 줄, 각 클릭 → 모달 */}
        <div className="rounded-xl bg-white/[0.03] border border-white/10 px-2 py-1.5 flex flex-wrap items-center gap-1">
          <SummaryBarItem icon={<Users className="w-4 h-4" />} label="전체 고객" value={`${summary.totalCustomersInCompany.toLocaleString()}명`} onClick={openAllCustomers} />
          <SummaryBarItem icon={<Database className="w-4 h-4" />} label="예측 진행" value={`${(summary.predictionCoverage * 100).toFixed(0)}%`} onClick={() => setShowDetails(true)} />
          <SummaryBarItem icon={<TrendingUp className="w-4 h-4" />} label="평균 LTV(90일)" value={formatWon(summary.avgLtv90d)} onClick={() => setShowDetails(true)} />
          <SummaryBarItem icon={<TrendingUp className="w-4 h-4" />} label="합산 LTV(365일)" value={formatWon(summary.totalProjectedLtv365d)} onClick={() => setShowDetails(true)} />
          <SummaryBarItem icon={<Brain className="w-4 h-4" />} label="학습 완료" value={summary.trainedCount > 0 ? `${summary.trainedCount.toLocaleString()}명` : '준비 중'} onClick={() => setShowDetails(true)} />
        </div>

        {/* 컴퓨팅 시점 */}
        {summary.lastComputedAt && (
          <div className="mt-4 text-center text-[11px] text-white/40">
            마지막 계산: {new Date(summary.lastComputedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 매일 1회 자동 분석 · 회사 전체 기준
          </div>
        )}
      </div>

      {/* ── 모달: 분포 · 정확도 ── */}
      {showDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-slate-900/95 backdrop-blur border-b border-white/10 px-5 py-4 flex items-center justify-between z-10">
              <h2 className="text-base font-semibold text-white">분포 · 모델 정확도</h2>
              <button onClick={() => setShowDetails(false)} className="p-1.5 hover:bg-white/10 rounded-lg text-white/60"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
                <Card
                  icon={<TrendingUp className="w-4 h-4" />}
                  label="전체 LTV (365일)"
                  value={formatWon(summary.totalProjectedLtv365d)}
                  color="text-emerald-300"
                  source="cdp_customer_predictions.ltv_365d"
                />
                <Card
                  icon={<Brain className="w-4 h-4" />}
                  label="학습 상태 (초기 / 완료)"
                  value={`${summary.coldStartCount.toLocaleString()} / ${summary.trainedCount.toLocaleString()}`}
                  color={summary.trainedCount > 0 ? 'text-emerald-300' : 'text-amber-300'}
                  source="cdp_customer_predictions.model_version"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
                <HistogramCard
                  title="클릭 가능성 분포"
                  icon={<MousePointerClick className="w-4 h-4 text-cyan-300" />}
                  data={distribution.histogram.clickScore}
                  color="#06b6d4"
                />
                <HistogramCard
                  title="이탈 위험 분포"
                  icon={<AlertTriangle className="w-4 h-4 text-rose-300" />}
                  data={distribution.histogram.churnRisk}
                  color="#f43f5e"
                  invertColor
                />
                <HistogramCard
                  title="구매 가능성 분포"
                  icon={<ShoppingCart className="w-4 h-4 text-emerald-300" />}
                  data={distribution.histogram.purchaseLikelihood}
                  color="#10b981"
                />
              </div>

              {summary.trainedCount === 0 ? (
                <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <Brain className="w-4 h-4 text-violet-300" />
                    <h3 className="text-sm font-semibold">모델 정확도 검증</h3>
                  </div>
                  <div className="text-xs text-white/60 leading-relaxed">
                    발송 누적이 부족해 아직 정확도를 검증할 수 없습니다.
                    발송이 3건 이상 쌓이면 학습 모델이 자동 활성되고, 24시간 뒤 정확도가 자동 표시됩니다.
                  </div>
                </div>
              ) : distribution.modelAccuracy && (
                <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <Brain className="w-4 h-4 text-violet-300" />
                    <h3 className="text-sm font-semibold">모델 정확도 검증 (예측 vs 실 결과)</h3>
                    <span className="text-[10px] text-white/40 ml-auto">학습 완료 {summary.trainedCount.toLocaleString()}명</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <AccuracyCard
                      title="클릭 예측"
                      predicted={distribution.modelAccuracy.clickPredicted}
                      actual={distribution.modelAccuracy.clickActual}
                      accuracy={distribution.modelAccuracy.clickAccuracy}
                    />
                    <AccuracyCard
                      title="구매 예측"
                      predicted={distribution.modelAccuracy.conversionPredicted}
                      actual={distribution.modelAccuracy.conversionActual}
                      accuracy={distribution.modelAccuracy.conversionAccuracy}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 모달: 전체 고객 목록 (검색 · 필터 · 정렬 · 페이지네이션) ── */}
      {showCustomersModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-slate-900/95 backdrop-blur border-b border-white/10 px-5 py-4 flex items-start justify-between z-10">
              <div className="min-w-0 pr-3">
                <h2 className="text-base font-semibold text-white">고객 목록</h2>
                {segmentReason && <p className="text-xs text-white/55 mt-1 leading-relaxed">{segmentReason}</p>}
              </div>
              <button onClick={() => setShowCustomersModal(false)} className="p-1.5 hover:bg-white/10 rounded-lg text-white/60 shrink-0"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto">
              {/* 검색/필터/정렬 */}
              <div className="px-4 py-3 border-b border-white/10 flex flex-col md:flex-row md:items-center gap-3">
                <form onSubmit={handleSearch} className="flex-1 flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40" />
                    <input
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="고객명 / 연락처 / 등급 / 지역 검색"
                      className="w-full pl-8 pr-3 py-1.5 bg-white/5 border border-white/10 rounded text-xs text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50"
                    />
                  </div>
                  <button type="submit" className="px-3 py-1.5 bg-violet-500/30 hover:bg-violet-500/50 text-violet-100 rounded text-xs font-medium">검색</button>
                </form>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Filter className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                    <select
                      value={filter}
                      onChange={(e) => handleFilterChange(e.target.value as FilterType)}
                      className="pl-6 pr-7 py-1.5 bg-white/5 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-violet-400/50 appearance-none"
                    >
                      {FILTER_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value} className="bg-slate-800">{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="relative">
                    <ArrowUpDown className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                    <select
                      value={sort}
                      onChange={(e) => handleSortChange(e.target.value as SortType)}
                      className="pl-6 pr-7 py-1.5 bg-white/5 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-violet-400/50 appearance-none"
                    >
                      {SORT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value} className="bg-slate-800">{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* 카운트 */}
              <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between text-[11px] text-white/50">
                <div>
                  {search || filter !== 'all' ? (
                    <>필터 결과 <span className="text-white/80 font-mono">{filteredCount.toLocaleString()}</span> / 전체 <span className="text-white/80 font-mono">{totalCount.toLocaleString()}</span>명</>
                  ) : (
                    <>전체 <span className="text-white/80 font-mono">{totalCount.toLocaleString()}</span>명</>
                  )}
                </div>
                <div>
                  {totalPages > 0 && (
                    <>페이지 <span className="text-white/80 font-mono">{page}</span> / <span className="text-white/80 font-mono">{totalPages}</span></>
                  )}
                </div>
              </div>

              {/* 테이블 */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white/5 border-b border-white/10">
                    <tr className="text-left text-white/60 text-xs">
                      <th className="px-3 py-2.5 font-medium">고객명</th>
                      <th className="px-3 py-2.5 font-medium">등급</th>
                      <th className="px-3 py-2.5 font-medium text-right">클릭</th>
                      <th className="px-3 py-2.5 font-medium text-right">이탈 위험</th>
                      <th className="px-3 py-2.5 font-medium text-right">구매 가능성</th>
                      <th className="px-3 py-2.5 font-medium text-right">LTV 365일</th>
                      <th className="px-3 py-2.5 font-medium text-right">다음 구매</th>
                      <th className="px-3 py-2.5 font-medium text-center">선호 채널</th>
                      <th className="px-3 py-2.5 font-medium text-center w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerLoading ? (
                      <tr><td colSpan={9} className="text-center py-12">
                        <Loader2 className="w-5 h-5 animate-spin text-violet-400 inline-block" />
                      </td></tr>
                    ) : customers.length === 0 ? (
                      <tr><td colSpan={9} className="text-center py-12 text-white/40">
                        {search || filter !== 'all' ? '검색/필터 결과 없음' : '예측 데이터 누적 중 — 1시간 안에 자동 계산됩니다.'}
                      </td></tr>
                    ) : customers.map((c) => (
                      <tr
                        key={c.customerId}
                        className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                        onClick={() => openDetail(c.customerId)}
                      >
                        <td className="px-3 py-2.5">
                          <div>{c.customerName || '-'}</div>
                          <div className="text-[10px] text-white/40 font-mono">{c.customerPhone || ''} · {c.customerRegion || ''}</div>
                        </td>
                        <td className="px-3 py-2.5">{c.customerGrade || '-'}</td>
                        <td className={`px-3 py-2.5 text-right font-mono ${summary.isAllColdStart ? 'text-white/25' : 'text-cyan-300'}`}>{formatPct(c.clickScore)}</td>
                        <td className={`px-3 py-2.5 text-right font-mono ${summary.isAllColdStart ? 'text-white/25' : c.churnRisk > 0.7 ? 'text-rose-300 font-semibold' : 'text-white/70'}`}>{formatPct(c.churnRisk)}</td>
                        <td className={`px-3 py-2.5 text-right font-mono ${summary.isAllColdStart ? 'text-white/25' : c.purchaseLikelihood > 0.6 ? 'text-emerald-300 font-semibold' : 'text-white/70'}`}>{formatPct(c.purchaseLikelihood)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-amber-300">{c.ltv365d !== undefined ? formatWon(c.ltv365d) : '-'}</td>
                        <td className="px-3 py-2.5 text-right text-xs text-white/70">{c.nextPurchaseDays !== null && c.nextPurchaseDays !== undefined ? `D+${c.nextPurchaseDays}` : '-'}</td>
                        <td className="px-3 py-2.5 text-center">
                          {c.channelPreference ? (
                            <span className="text-[10px] px-1.5 py-0.5 bg-cyan-500/20 text-cyan-300 rounded font-mono">{c.channelPreference.toUpperCase()}</span>
                          ) : (
                            <span className="text-[10px] text-white/30">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <ChevronRight className="w-3.5 h-3.5 text-white/40" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 페이지네이션 */}
              {totalPages > 1 && (
                <div className="px-4 py-3 border-t border-white/10 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                    className="p-1.5 hover:bg-white/5 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum: number;
                      if (totalPages <= 5) pageNum = i + 1;
                      else if (page <= 3) pageNum = i + 1;
                      else if (page >= totalPages - 2) pageNum = totalPages - 4 + i;
                      else pageNum = page - 2 + i;
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setPage(pageNum)}
                          className={`min-w-[28px] h-7 px-2 text-xs font-mono rounded ${
                            page === pageNum ? 'bg-violet-500/40 text-violet-100 font-semibold' : 'text-white/60 hover:bg-white/5'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page === totalPages}
                    className="p-1.5 hover:bg-white/5 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 모달: 고객 상세 (예측 3 + 근거 + 1클릭) ── */}
      {expandedCustomerId && (() => {
        const sel = customers.find((x) => x.customerId === expandedCustomerId);
        if (!sel) return null;
        return (
          <PredictiveDetailModal
            customer={sel}
            explanation={explanationMap[expandedCustomerId]}
            loading={!!explainLoading[expandedCustomerId]}
            onClose={closeDetail}
            onQuickAction={() => { closeDetail(); handleQuickAction(sel.churnRisk > 0.7 ? 'churn_recovery' : sel.purchaseLikelihood > 0.6 ? 'purchase_push' : 'vip_engagement'); }}
          />
        );
      })()}
    </div>
  );
}

// ── AI 발견 세그먼트 카드 (주인공) ──
function SegmentCard({
  seg, isColdStart, actionLoading, onSeeReason, onCampaign,
}: {
  seg: DiscoveredSegment;
  isColdStart: boolean;
  actionLoading: boolean;
  onSeeReason: () => void;
  onCampaign: () => void;
}) {
  const A = ACCENT[seg.accent];
  const ICON_MAP = {
    churn_recovery: AlertTriangle, purchase_push: ShoppingCart, vip_engagement: Crown,
    first_purchase: UserPlus, high_engagement: MousePointerClick, repurchase_imminent: Repeat,
  } as const;
  const Icon = ICON_MAP[seg.key];
  const isActive = seg.count > 0;
  return (
    <div className={`relative rounded-2xl bg-white/[0.04] border ${A.border} p-5 flex flex-col overflow-hidden ${isActive ? '' : 'opacity-55'}`}>
      <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${A.grad}`} />
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-11 h-11 rounded-xl ${A.iconBg} flex items-center justify-center shrink-0`}>
          <Icon className={`w-5 h-5 ${A.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-white/70">{seg.label}</div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-white tracking-tight">{seg.count.toLocaleString()}</span>
            <span className="text-sm text-white/45">명</span>
            {isActive && isColdStart && <span className="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">추정</span>}
          </div>
        </div>
      </div>
      <p className="text-xs text-white/70 leading-relaxed flex-1 mb-4">{seg.reasonSummary}</p>
      <div className="flex gap-2">
        <button
          onClick={onSeeReason}
          disabled={!isActive}
          className="flex-1 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-white/80 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/5"
        >
          근거 보기
        </button>
        <button
          onClick={onCampaign}
          disabled={!isActive || actionLoading}
          className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold text-white flex items-center justify-center gap-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${isActive ? `bg-gradient-to-r ${A.btn}` : 'bg-white/10'}`}
        >
          {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isActive ? <>캠페인 만들기 <ArrowRight className="w-3.5 h-3.5" /></> : '활성화 대기'}
        </button>
      </div>
    </div>
  );
}

// ── 작은 요약 바 항목 ──
function SummaryBarItem({
  icon, label, value, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/5 transition-colors text-left flex-1 min-w-[120px]">
      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/55 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] text-white/40 truncate">{label}</div>
        <div className="text-sm font-semibold text-white font-mono truncate">{value}</div>
      </div>
    </button>
  );
}

// ── 고객 상세 모달 — 예측 3 + AI 권장 + 영향 요인 + 1클릭 ──
function PredictiveDetailModal({
  customer, explanation, loading, onClose, onQuickAction,
}: {
  customer: CustomerRow;
  explanation: CustomerExplanation | undefined;
  loading: boolean;
  onClose: () => void;
  onQuickAction: () => void;
}) {
  const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const fmtWon = (n: number) => `${Math.round(n).toLocaleString()}원`;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur border-b border-white/10 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <div className="text-base font-semibold text-white">{customer.customerName || '-'}</div>
            <div className="text-[11px] text-white/40 font-mono">{customer.customerGrade || '-'} · {customer.customerPhone || ''} · {customer.customerRegion || ''}</div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg text-white/60"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="p-3 bg-cyan-500/10 rounded-lg text-center"><div className="text-[10px] text-white/50">클릭</div><div className="text-lg font-bold text-cyan-300">{fmtPct(customer.clickScore)}</div></div>
            <div className="p-3 bg-rose-500/10 rounded-lg text-center"><div className="text-[10px] text-white/50">이탈 위험</div><div className="text-lg font-bold text-rose-300">{fmtPct(customer.churnRisk)}</div></div>
            <div className="p-3 bg-emerald-500/10 rounded-lg text-center"><div className="text-[10px] text-white/50">구매 가능성</div><div className="text-lg font-bold text-emerald-300">{fmtPct(customer.purchaseLikelihood)}</div></div>
          </div>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-violet-400" /></div>
          ) : !explanation ? (
            <div className="text-center py-6 text-white/40 text-xs">예측 근거를 불러오지 못했습니다.</div>
          ) : (
            <>
              <div className="p-3 bg-violet-500/10 border border-violet-400/30 rounded-lg">
                <div className="flex items-start gap-2">
                  <Sparkles className="w-4 h-4 text-violet-300 flex-shrink-0 mt-0.5" />
                  <div><div className="text-[11px] font-semibold text-violet-200 mb-1">AI 1순위 권장</div><div className="text-xs text-white/85 leading-relaxed">{explanation.topRecommendation}</div></div>
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-white/70 mb-2">왜 이렇게 예측했나 (영향 요인)</div>
                <div className="space-y-1.5">
                  {explanation.factors.map((f, idx) => {
                    const dirColor = f.direction === 'positive' ? 'bg-emerald-400' : f.direction === 'negative' ? 'bg-rose-400' : 'bg-amber-400';
                    const dirText = f.direction === 'positive' ? 'text-emerald-300' : f.direction === 'negative' ? 'text-rose-300' : 'text-amber-300';
                    return (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-center text-[11px]">
                        <div className="col-span-3 text-white/70 font-medium">{f.label}</div>
                        <div className="col-span-5"><div className="h-2 bg-white/10 rounded-full overflow-hidden"><div className={`h-full ${dirColor}`} style={{ width: `${Math.round(f.impactScore * 100)}%` }} /></div></div>
                        <div className={`col-span-1 text-right font-mono ${dirText}`}>{(f.impactScore * 100).toFixed(0)}%</div>
                        <div className="col-span-3 text-[10px] text-white/50 truncate" title={f.detail}>{f.detail}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 text-[10px] text-white/30 italic">Data source — {explanation.factors.map((f) => f.sourceField).filter((s, i, arr) => arr.indexOf(s) === i).slice(0, 3).join(' · ')}</div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-white/10">
                <div className="p-2 bg-white/5 rounded text-center"><div className="text-[9px] text-white/40">LTV 90일</div><div className="text-xs font-mono text-amber-300">{fmtWon(explanation.predictions.ltv90d)}</div></div>
                <div className="p-2 bg-white/5 rounded text-center"><div className="text-[9px] text-white/40">다음 구매</div><div className="text-xs font-mono text-emerald-300">{explanation.predictions.nextPurchaseDays !== null ? `D+${explanation.predictions.nextPurchaseDays}일` : '데이터 부족'}</div></div>
                <div className="p-2 bg-white/5 rounded text-center"><div className="text-[9px] text-white/40">선호 채널</div><div className="text-xs font-mono text-cyan-300">{explanation.predictions.channelPreference?.toUpperCase() || '데이터 부족'}</div></div>
                <div className="p-2 bg-white/5 rounded text-center"><div className="text-[9px] text-white/40">최적 시간대</div><div className="text-xs font-mono text-violet-300">{explanation.predictions.bestHour !== null ? `${explanation.predictions.bestHour}시` : '데이터 부족'}</div></div>
              </div>
              <button onClick={onQuickAction} className="w-full py-2.5 bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white text-sm font-semibold rounded-xl transition-colors">
                이 고객에게 맞는 캠페인 만들기
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({
  icon, label, value, color, source,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  source?: string;
}) {
  return (
    <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
      <div className={`flex items-center gap-1.5 text-xs ${color} mb-1.5`}>
        {icon}<span>{label}</span>
      </div>
      <div className="text-lg md:text-xl font-semibold font-mono">{value}</div>
      {source && (
        <div className="text-[10px] text-white/40 mt-1 truncate" title={source}>Data source — {source}</div>
      )}
    </div>
  );
}

function HistogramCard({
  title, icon, data, color, invertColor, source,
}: {
  title: string;
  icon: React.ReactNode;
  data: HistogramBin[];
  color: string;
  invertColor?: boolean;
  source?: string;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
      <div className="px-3 py-2.5 border-b border-white/10 flex items-center gap-1.5">
        {icon}
        <span className="text-xs font-semibold">{title}</span>
      </div>
      <div className="p-3">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis dataKey="range" stroke="rgba(255,255,255,0.5)" fontSize={10} />
            <YAxis stroke="rgba(255,255,255,0.5)" fontSize={10} />
            <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="count" name="고객 수">
              {data.map((entry, idx) => {
                const intensity = invertColor ? 1 - idx / data.length : idx / data.length;
                return <Cell key={idx} fill={color} fillOpacity={0.4 + intensity * 0.6} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {source && (
          <div className="text-[10px] text-white/40 mt-1 px-1 truncate" title={source}>{source}</div>
        )}
      </div>
    </div>
  );
}

function AccuracyCard({
  title, predicted, actual, accuracy,
}: { title: string; predicted: number; actual: number; accuracy: number }) {
  const formatPct = (n: number) => `${(n * 100).toFixed(1)}%`;
  return (
    <div className="p-3 bg-white/5 border border-white/5 rounded-lg">
      <div className="text-xs text-white/60 mb-2">{title}</div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-white/40 text-[10px]">예측</div>
          <div className="font-mono">{formatPct(predicted)}</div>
        </div>
        <div>
          <div className="text-white/40 text-[10px]">실제</div>
          <div className="font-mono">{formatPct(actual)}</div>
        </div>
        <div>
          <div className="text-white/40 text-[10px]">정확도</div>
          <div className={`font-mono ${accuracy >= 0.7 ? 'text-emerald-300' : accuracy >= 0.4 ? 'text-amber-300' : 'text-rose-300'}`}>
            {formatPct(accuracy)}
          </div>
        </div>
      </div>
    </div>
  );
}
