/**
 * PredictiveDashboardPage.tsx
 *   - D197 (2026-05-22) Phase B-2 Predictive Suite 옛 영역
 *   - D210+ Phase 3 (2026-05-23 Harold 명시) 영구 진화:
 *     · 옛 Top 50명 영역 폐기 → 회사 전체 customer 페이지네이션 + 검색 + 필터 + 정렬
 *     · 상단 카드 8건 = 회사 전체 / 예측 계산 / cold vs trained / 위험 / 가능성 / 평균 3건
 *     · 모든 지표 = 실제 DB 테이블 source caption 명시 의무 ([[feedback_no_mock_data_in_production]])
 *     · cold start 신뢰도 안내 카드 (isAllColdStart 시 amber 영역)
 *     · 모델 정확도 = trained 0명 시 안내 카드로 대체
 *
 * AI 자율 판단 시각화:
 *   - 회사 전체 예측 점수 히스토그램 3건 (클릭률 / 이탈 위험 / 구매 가능성)
 *   - 회사 전체 customer 영역 페이지네이션 (10개씩 + 검색 + 5 필터 + 5 정렬)
 *   - 모델 정확도 검증 (옛 예측 vs 실 결과 비교 — trained 영역 진입 후 활성)
 *   - AI 자율 추천 안내 (insightText)
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import {
  ArrowLeft, Brain, MousePointerClick, AlertTriangle, ShoppingCart, Loader2,
  TrendingUp, Activity, Users, Sparkles, Search, Filter, ArrowUpDown,
  ChevronLeft, ChevronRight, Database, Info,
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

type FilterType = 'all' | 'high_risk' | 'high_potential' | 'high_click' | 'cold_start';
type SortType =
  | 'churn_risk_desc'
  | 'purchase_likelihood_desc'
  | 'click_score_desc'
  | 'last_activity_asc'
  | 'last_activity_desc';

const FILTER_OPTIONS: { value: FilterType; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'high_risk', label: '이탈 위험 70%+' },
  { value: 'high_potential', label: '구매 가능성 60%+' },
  { value: 'high_click', label: '클릭 가능성 50%+' },
  { value: 'cold_start', label: 'Cold start (추정)' },
];

const SORT_OPTIONS: { value: SortType; label: string }[] = [
  { value: 'churn_risk_desc', label: '이탈 위험 ↓' },
  { value: 'purchase_likelihood_desc', label: '구매 가능성 ↓' },
  { value: 'click_score_desc', label: '클릭 가능성 ↓' },
  { value: 'last_activity_asc', label: '미활동 일수 ↓' },
  { value: 'last_activity_desc', label: '최근 활동 ↓' },
];

export default function PredictiveDashboardPage() {
  const navigate = useNavigate();
  const [distribution, setDistribution] = useState<Distribution | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ★ D210+ Phase 3: 회사 전체 customer 페이지네이션 영역
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

  const token = () => localStorage.getItem('token');

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

  // 고객 목록 영역 — page/filter/sort/search 변경 시 자동 fetch
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
      // 네트워크 오류 — 옛 데이터 영역 유지
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

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
      </div>
    );
  }

  if (error || !distribution || !summary) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-rose-300 mb-2">{error || '데이터 조회 실패'}</div>
          <button onClick={() => navigate('/ai-operator')} className="px-4 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 rounded">
            AI Operator로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/ai-operator')} className="p-2 hover:bg-white/5 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2">
              <Brain className="w-5 h-5 text-violet-400" />
              AI 자율 예측 분석
            </h1>
            <p className="text-sm text-white/50 mt-0.5">사용자별 미래 행동 예측 — 클릭 가능성 / 이탈 위험 / 구매 가능성</p>
          </div>
        </div>

        {/* ★ D210+ Phase 3: cold start 신뢰도 안내 카드 (isAllColdStart 시 amber) */}
        {summary.isAllColdStart && summary.totalCustomersInPredictions > 0 && (
          <div className="mb-6 p-4 bg-amber-500/10 border border-amber-400/30 rounded-xl">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                <Info className="w-5 h-5 text-amber-300" />
              </div>
              <div className="flex-1 text-sm">
                <div className="font-semibold text-amber-200 mb-1">신뢰도 안내 — Cold start 영역</div>
                <div className="text-amber-100/80 leading-relaxed">
                  현재 {summary.totalCustomersInPredictions.toLocaleString()}명 모두 등급/활동 기반 추정치 (실제 발송 누적 0건).
                  실제 발송 + 클릭 누적 시 24시간 안에 trained 모델로 자동 진화 — 정확도 시간 흐름과 함께 향상됩니다.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* AI 자율 추천 안내 카드 */}
        <div className="mb-6 p-4 bg-gradient-to-br from-violet-500/15 via-fuchsia-500/10 to-indigo-500/15 border border-violet-400/30 rounded-xl">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-violet-100 mb-1">AI 자율 추천</div>
              <div className="text-xs text-white/80 leading-relaxed">{summary.insightText}</div>
              {(summary.highRiskCount > 0 || summary.highPotentialCount > 0) && (
                <button
                  onClick={() => navigate('/ai-operator')}
                  className="mt-3 px-3 py-1.5 bg-violet-500/30 hover:bg-violet-500/50 text-violet-100 rounded text-xs font-medium"
                >
                  AI Operator로 캠페인 즉시 진행
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ★ D210+ Phase 3: 상단 카드 8건 (회사 전체 / 예측 계산 / cold vs trained / 위험 / 가능성 / 평균 3건) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card
            icon={<Users className="w-4 h-4" />}
            label="회사 전체 고객"
            value={summary.totalCustomersInCompany.toLocaleString()}
            color="text-blue-300"
            source="customers 테이블"
          />
          <Card
            icon={<Database className="w-4 h-4" />}
            label="예측 계산 완료"
            value={`${summary.totalCustomersInPredictions.toLocaleString()} (${(summary.predictionCoverage * 100).toFixed(0)}%)`}
            color="text-indigo-300"
            source="cdp_customer_predictions 누적"
          />
          <Card
            icon={<Brain className="w-4 h-4" />}
            label="Cold / Trained 분포"
            value={`${summary.coldStartCount.toLocaleString()} / ${summary.trainedCount.toLocaleString()}`}
            color={summary.trainedCount > 0 ? 'text-emerald-300' : 'text-amber-300'}
            source="model_version 영역"
          />
          <Card
            icon={<AlertTriangle className="w-4 h-4" />}
            label="이탈 위험 70%+"
            value={summary.highRiskCount.toLocaleString()}
            color="text-rose-300"
            source="churn_risk > 0.7"
          />
          <Card
            icon={<ShoppingCart className="w-4 h-4" />}
            label="구매 가능성 60%+"
            value={summary.highPotentialCount.toLocaleString()}
            color="text-emerald-300"
            source="purchase_likelihood > 0.6"
          />
          <Card
            icon={<MousePointerClick className="w-4 h-4" />}
            label="평균 클릭 가능성"
            value={formatPct(summary.avgClickScore)}
            color="text-cyan-300"
            source={summary.isAllColdStart ? 'AVG(click_score) · 추정치' : 'AVG(click_score)'}
          />
          <Card
            icon={<Activity className="w-4 h-4" />}
            label="평균 이탈 위험"
            value={formatPct(summary.avgChurnRisk)}
            color="text-amber-300"
            source={summary.isAllColdStart ? 'AVG(churn_risk) · 추정치' : 'AVG(churn_risk)'}
          />
          <Card
            icon={<TrendingUp className="w-4 h-4" />}
            label="평균 구매 가능성"
            value={formatPct(summary.avgPurchaseLikelihood)}
            color="text-fuchsia-300"
            source={summary.isAllColdStart ? 'AVG(purchase_likelihood) · 추정치' : 'AVG(purchase_likelihood)'}
          />
        </div>

        {/* 히스토그램 3건 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <HistogramCard
            title="클릭 가능성 분포"
            icon={<MousePointerClick className="w-4 h-4 text-cyan-300" />}
            data={distribution.histogram.clickScore}
            color="#06b6d4"
            source="cdp_customer_predictions.click_score (10 bin)"
          />
          <HistogramCard
            title="이탈 위험 분포"
            icon={<AlertTriangle className="w-4 h-4 text-rose-300" />}
            data={distribution.histogram.churnRisk}
            color="#f43f5e"
            invertColor
            source="cdp_customer_predictions.churn_risk (10 bin)"
          />
          <HistogramCard
            title="구매 가능성 분포"
            icon={<ShoppingCart className="w-4 h-4 text-emerald-300" />}
            data={distribution.histogram.purchaseLikelihood}
            color="#10b981"
            source="cdp_customer_predictions.purchase_likelihood (10 bin)"
          />
        </div>

        {/* 모델 정확도 — trained 0명 영역 = 안내 카드 / 그 외 = 옛 매트릭스 */}
        {summary.trainedCount === 0 ? (
          <div className="mb-6 p-4 bg-white/5 border border-white/10 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="w-4 h-4 text-violet-300" />
              <h2 className="text-sm font-semibold">모델 정확도 검증</h2>
            </div>
            <div className="text-xs text-white/60 leading-relaxed">
              발송 누적 부족 — 검증 불가 영역입니다.
              발송 누적 3건+ 영역 진입 시 trained 모델 자동 활성 + 24시간 후 정확도 자동 표시 영역 활성됩니다.
            </div>
          </div>
        ) : distribution.modelAccuracy && (
          <div className="mb-6 p-4 bg-white/5 border border-white/10 rounded-xl">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="w-4 h-4 text-violet-300" />
              <h2 className="text-sm font-semibold">모델 정확도 검증 (옛 예측 vs 실 결과)</h2>
              <span className="text-[10px] text-white/40 ml-auto">trained {summary.trainedCount.toLocaleString()}명 영역</span>
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

        {/* ★ D210+ Phase 3: 회사 전체 customer 영역 (페이지네이션 + 검색 + 필터 + 정렬) */}
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
          {/* 검색/필터/정렬 영역 */}
          <div className="px-4 py-3 border-b border-white/10 flex flex-col md:flex-row md:items-center gap-3">
            <form onSubmit={handleSearch} className="flex-1 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="고객명 / 연락처 / 등급 / 지역 검색"
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-950/60 border border-white/10 rounded text-xs text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50"
                />
              </div>
              <button
                type="submit"
                className="px-3 py-1.5 bg-violet-500/30 hover:bg-violet-500/50 text-violet-100 rounded text-xs font-medium"
              >
                검색
              </button>
            </form>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Filter className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                <select
                  value={filter}
                  onChange={(e) => handleFilterChange(e.target.value as FilterType)}
                  className="pl-6 pr-7 py-1.5 bg-slate-950/60 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-violet-400/50 appearance-none"
                >
                  {FILTER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value} className="bg-slate-900">{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="relative">
                <ArrowUpDown className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                <select
                  value={sort}
                  onChange={(e) => handleSortChange(e.target.value as SortType)}
                  className="pl-6 pr-7 py-1.5 bg-slate-950/60 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-violet-400/50 appearance-none"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value} className="bg-slate-900">{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* 카운트 + 페이지 정보 */}
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

          {/* 테이블 영역 */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5 border-b border-white/10">
                <tr className="text-left text-white/60 text-xs">
                  <th className="px-3 py-2.5 font-medium">고객명</th>
                  <th className="px-3 py-2.5 font-medium">연락처</th>
                  <th className="px-3 py-2.5 font-medium">등급</th>
                  <th className="px-3 py-2.5 font-medium">지역</th>
                  <th className="px-3 py-2.5 font-medium text-right">클릭</th>
                  <th className="px-3 py-2.5 font-medium text-right">이탈 위험</th>
                  <th className="px-3 py-2.5 font-medium text-right">구매 가능성</th>
                  <th className="px-3 py-2.5 font-medium text-right">미활동</th>
                  <th className="px-3 py-2.5 font-medium text-center">모델</th>
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
                  <tr key={c.customerId} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2.5">{c.customerName || '-'}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{c.customerPhone || '-'}</td>
                    <td className="px-3 py-2.5">{c.customerGrade || '-'}</td>
                    <td className="px-3 py-2.5">{c.customerRegion || '-'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-cyan-300">{formatPct(c.clickScore)}</td>
                    <td className={`px-3 py-2.5 text-right font-mono ${c.churnRisk > 0.7 ? 'text-rose-300' : 'text-white/70'}`}>{formatPct(c.churnRisk)}</td>
                    <td className={`px-3 py-2.5 text-right font-mono ${c.purchaseLikelihood > 0.6 ? 'text-emerald-300' : 'text-white/70'}`}>{formatPct(c.purchaseLikelihood)}</td>
                    <td className="px-3 py-2.5 text-right text-xs text-white/60">{c.lastActivityDays !== null ? `${c.lastActivityDays}일` : '-'}</td>
                    <td className="px-3 py-2.5 text-center">
                      {c.modelVersion === 'v1.0-trained' ? (
                        <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded">trained</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded">cold</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 페이지네이션 영역 */}
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
                {/* 페이지 번호 영역 (현재 ± 2 영역) */}
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
                        page === pageNum
                          ? 'bg-violet-500/40 text-violet-100 font-semibold'
                          : 'text-white/60 hover:bg-white/5'
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

        {/* 컴퓨팅 시점 */}
        {summary.lastComputedAt && (
          <div className="mt-4 text-center text-[11px] text-white/40">
            마지막 계산: {new Date(summary.lastComputedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 1시간 주기 자동 갱신 · 회사 전체 영역
          </div>
        )}
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
        <div className="text-[10px] text-white/40 mt-1 truncate" title={source}>{source}</div>
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
    <div className="p-3 bg-slate-950/40 border border-white/5 rounded-lg">
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
