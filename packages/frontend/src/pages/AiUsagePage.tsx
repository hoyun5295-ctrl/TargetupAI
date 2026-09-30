import ZoneFrame from '../components/zone/ZoneFrame';
import ZoneEmphasis from '../components/zone/ZoneEmphasis';
import { AI_MEMORY_TABS } from '../components/zone/zone-tabs';
/**
 * AiUsagePage.tsx — D217+ AI 사용량 (Journey Builder 동급 8 화면)
 *
 * 설계서: docs/superpowers/specs/2026-05-25-ai-memory-usage-redesign-design.md § 3
 *
 * 8 화면:
 *   1. sticky 헤더 (TrendingUp emerald→cyan + BETA + 뒤로가기)
 *   2. AI 자율 진단 카드 (overview.top_insight 한 줄)
 *   3. 자연어 입력 + 빠른 시작 5 카드
 *   4. 5 metric 요약 + 지난달 같은 기간 대비 격차
 *   5. AI 비용 예측 라인 차트 (CostForecastChart)
 *   6. 1-click 액션 3 카드 (예측 / Batch 가이드 / 한도 알림)
 *   7. 자세히 분석 토글 (4 차트)
 *   8. Source caption
 *
 * 영구 룰 정합:
 *   - 모델명 UI 노출 0건 — 추상 명칭 ("고급 추론 모드" / "표준 추론 모드" / "보조 추론 모드")
 *   - native dialog 0건 — ConfirmModal + useToast
 *   - 한 클릭 = 즉시 AI 호출 (marketing_user_ux_priority)
 *   - 박-단어 0건
 *   - DB ALTER 안전망 — DB_MIGRATION_PENDING 503 분기
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  TrendingUp, TrendingDown, ChevronDown, ChevronUp, Loader2, RefreshCw, Sparkles,
  Send, X, Bell, Layers, BarChart3, Activity, Database, Calendar, DollarSign, Info,
  Wallet, Gauge, AlertTriangle,
} from 'lucide-react';
import ConfirmModal, { ConfirmState } from '../components/ConfirmModal';
import { useToast } from '../components/ToastProvider';
import ThresholdAlertModal, { ThresholdConfig } from '../components/AiUsage/ThresholdAlertModal';
import BatchModeGuideModal from '../components/AiUsage/BatchModeGuideModal';
import CostForecastChart, { ForecastPoint } from '../components/AiUsage/CostForecastChart';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

interface ModelDistRow {
  modelType: string;
  label: string;
  count: number;
  cost: number;
}

interface OverviewResponse {
  success: boolean;
  monthly_calls: number;
  monthly_limit: number | null;
  monthly_percent: number;
  daily_avg: number;
  predicted_days_to_limit: number | null;
  cache_hit_rate: number;
  cache_size: number;
  cache_hit: number;
  cache_miss: number;
  model_distribution: ModelDistRow[];
  batch_calls: number;
  prev_month_calls: number;
  prev_month_delta_percent: number | null;
  threshold_config: ThresholdConfig & { _migration_pending?: boolean };
  top_insight: string;
}

interface ForecastResponse {
  success: boolean;
  daily_forecast: ForecastPoint[];
  avg_daily_calls: number;
  avg_daily_cost: number;
  trend_slope: number;
  no_data: boolean;
}

interface BreakdownRow {
  source: string;
  modelType: string;
  count: number;
  cost: number;
}

interface DailyRow {
  date: string;
  count: number;
  cost: number;
}

// ════════════════════════════════════════════════════════════════════
// 모델 추상 명칭 매핑 — UI 노출 시 모델명 차단 정합
// ════════════════════════════════════════════════════════════════════

function abstractModelLabel(modelType: string): string {
  switch (modelType) {
    case 'opus':         return '고급 추론 모드';
    case 'sonnet':       return '표준 추론 모드';
    case 'gpt-fallback': return '보조 추론 모드';
    default:             return modelType;
  }
}

function abstractModelGradient(modelType: string): string {
  switch (modelType) {
    case 'opus':         return 'from-violet-400 to-purple-500';
    case 'sonnet':       return 'from-sky-400 to-cyan-500';
    case 'gpt-fallback': return 'from-amber-400 to-orange-500';
    default:             return 'from-slate-400 to-slate-500';
  }
}

function abstractModelColor(modelType: string): string {
  switch (modelType) {
    case 'opus':         return '#a78bfa';
    case 'sonnet':       return '#38bdf8';
    case 'gpt-fallback': return '#fbbf24';
    default:             return '#94a3b8';
  }
}

// ════════════════════════════════════════════════════════════════════
// 빠른 시작 5 카드
// ════════════════════════════════════════════════════════════════════

interface QuickStartCard {
  id: string;
  icon: typeof TrendingUp;
  label: string;
  hint: string;
  gradient: string;
  query?: string;
  action?: 'threshold' | 'batch-guide';
}

const QUICK_START_CARDS: QuickStartCard[] = [
  {
    id: 'trend',
    icon: TrendingUp,
    label: '월별 트렌드 분석',
    hint: '기존 30일 호출 추이 + 변동 원인',
    gradient: 'from-sky-400 to-cyan-500',
    query: '직전 30일간 AI 호출 추이를 분석해주세요. 증가 또는 감소 패턴이 있다면 어떤 출처가 영향을 주었나요?',
  },
  {
    id: 'model',
    icon: Activity,
    label: 'AI 추론 모드 분포',
    hint: '고급/표준/보조 추론 비율',
    gradient: 'from-violet-400 to-purple-500',
    query: '이번 달 AI 추론 모드별 사용량 분포를 분석해주세요. 어떤 모드가 가장 많이 사용되었고, 비용 최적화 여지가 있나요?',
  },
  {
    id: 'cost',
    icon: Wallet,
    label: '비용 절감 분석',
    hint: 'Top 비용 출처 + 절감 방안',
    gradient: 'from-amber-400 to-orange-500',
    query: '이번 달 가장 비용이 많이 든 호출 출처는 무엇이며, 비용 절감 방안을 제안해주세요.',
  },
  {
    id: 'threshold',
    icon: Bell,
    label: '한도 알림 설정',
    hint: '50% / 80% / 95% 임계값',
    gradient: 'from-rose-400 to-pink-500',
    action: 'threshold',
  },
  {
    id: 'batch',
    icon: Layers,
    label: 'Batch 모드 가이드',
    hint: '24h SLA + 50% 절감',
    gradient: 'from-emerald-400 to-teal-500',
    action: 'batch-guide',
  },
];

// ════════════════════════════════════════════════════════════════════
// 도넛 path 헬퍼
// ════════════════════════════════════════════════════════════════════

function buildModelDonut(distribution: ModelDistRow[], total: number) {
  if (total === 0) return [];
  let startAngle = -Math.PI / 2;
  const r = 70;
  const ir = 45;
  return distribution.map((d) => {
    const percent = d.count / total;
    const angle = percent * Math.PI * 2;
    const endAngle = startAngle + angle;
    const largeArc = angle > Math.PI ? 1 : 0;
    const x1 = 100 + r * Math.cos(startAngle);
    const y1 = 100 + r * Math.sin(startAngle);
    const x2 = 100 + r * Math.cos(endAngle);
    const y2 = 100 + r * Math.sin(endAngle);
    const ix1 = 100 + ir * Math.cos(endAngle);
    const iy1 = 100 + ir * Math.sin(endAngle);
    const ix2 = 100 + ir * Math.cos(startAngle);
    const iy2 = 100 + ir * Math.sin(startAngle);
    const pathD = [
      `M ${x1} ${y1}`,
      `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${ix1} ${iy1}`,
      `A ${ir} ${ir} 0 ${largeArc} 0 ${ix2} ${iy2}`,
      'Z',
    ].join(' ');
    startAngle = endAngle;
    return {
      ...d,
      percent,
      pathD,
      color: abstractModelColor(d.modelType),
    };
  });
}

// ════════════════════════════════════════════════════════════════════
// 메인 페이지
// ════════════════════════════════════════════════════════════════════

export default function AiUsagePage() {
  const toast = useToast();

  // 데이터
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([]);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [forecastLoading, setForecastLoading] = useState(true);
  const [detailedLoading, setDetailedLoading] = useState(false);
  const [migrationPending, setMigrationPending] = useState<string | null>(null);

  // 자연어 검색
  const [naturalQuery, setNaturalQuery] = useState('');
  const [naturalLoading, setNaturalLoading] = useState(false);
  const [naturalResult, setNaturalResult] = useState<{ query: string; answer: string; noData: boolean } | null>(null);

  // 모달
  const [showThresholdModal, setShowThresholdModal] = useState(false);
  const [showBatchGuide, setShowBatchGuide] = useState(false);
  const [showDetailedAnalysis, setShowDetailedAnalysis] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const queryInputRef = useRef<HTMLInputElement>(null);
  const token = () => localStorage.getItem('token');
  const authHeader = () => ({ Authorization: `Bearer ${token()}` });

  // ── 데이터 로드
  const loadOverview = async () => {
    setOverviewLoading(true);
    try {
      const r = await fetch('/api/ai-usage/overview', { headers: authHeader() });
      const data = await r.json();
      if (data.success) {
        setOverview(data);
        setMigrationPending(data.threshold_config?._migration_pending
          ? 'DB 마이그레이션 필요: 한도 알림 설정 기능을 사용하려면 운영자에게 companies ALTER (ai_usage_threshold_config jsonb) 실행을 요청해주세요.'
          : null);
      } else if (data.code === 'DB_MIGRATION_PENDING') {
        setMigrationPending(data.error || 'DB 마이그레이션이 필요합니다.');
      } else {
        toast.error(`요약 조회 실패: ${data.error || '알 수 없는 오류'}`);
      }
    } catch (e: any) {
      toast.error(`요약 조회 실패: ${e?.message || '네트워크 오류'}`);
    } finally {
      setOverviewLoading(false);
    }
  };

  const loadForecast = async () => {
    setForecastLoading(true);
    try {
      const r = await fetch('/api/ai-usage/forecast', { headers: authHeader() });
      const data = await r.json();
      if (data.success) {
        setForecast(data);
      }
    } catch (e: any) {
      console.warn('forecast 조회 실패:', e?.message);
    } finally {
      setForecastLoading(false);
    }
  };

  const loadDetailed = async () => {
    if (breakdown.length > 0 || daily.length > 0) return;
    setDetailedLoading(true);
    try {
      const r = await fetch('/api/ai/usage', { headers: authHeader() });
      const data = await r.json();
      if (data.success) {
        setBreakdown(data.breakdown || []);
        setDaily(data.daily || []);
      }
    } catch (e: any) {
      console.warn('detailed 조회 실패:', e?.message);
    } finally {
      setDetailedLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
    loadForecast();
  }, []);

  useEffect(() => {
    if (showDetailedAnalysis) loadDetailed();
  }, [showDetailedAnalysis]);

  const reloadAll = async () => {
    setNaturalResult(null);
    setBreakdown([]);
    setDaily([]);
    await Promise.all([loadOverview(), loadForecast()]);
    if (showDetailedAnalysis) await loadDetailed();
  };

  // ── 자연어 검색
  const runNaturalSearch = async (q: string) => {
    const query = q.trim();
    if (query.length < 2) {
      toast.warning('질문을 2자 이상 입력해주세요.');
      return;
    }
    setNaturalLoading(true);
    setNaturalResult({ query, answer: '', noData: false });
    try {
      const r = await fetch('/api/ai-usage/search-natural', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ query }),
      });
      const data = await r.json();
      if (data.success) {
        setNaturalResult({ query, answer: data.answer, noData: data.no_data });
      } else if (data.code === 'AI_RATE_LIMIT') {
        toast.warning(`AI 호출 한도 초과: ${data.error || '이번 달 한도를 초과했습니다.'}`);
        setNaturalResult(null);
      } else {
        toast.error(`검색 실패: ${data.error || '알 수 없는 오류'}`);
        setNaturalResult(null);
      }
    } catch (e: any) {
      toast.error(`검색 실패: ${e?.message || '네트워크 오류'}`);
      setNaturalResult(null);
    } finally {
      setNaturalLoading(false);
    }
  };

  // ── 빠른 시작 카드 클릭
  const handleQuickStart = (card: QuickStartCard) => {
    if (card.action === 'threshold') {
      setShowThresholdModal(true);
      return;
    }
    if (card.action === 'batch-guide') {
      setShowBatchGuide(true);
      return;
    }
    if (card.query) {
      setNaturalQuery(card.query);
      void runNaturalSearch(card.query);
    }
  };

  // ── 한도 알림 설정 저장
  const handleThresholdSave = async (config: { threshold_percent: number; channels: Array<'email' | 'sms' | 'inapp'>; enabled: boolean }) => {
    const r = await fetch('/api/ai-usage/threshold-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(config),
    });
    const data = await r.json();
    if (!data.success) {
      throw new Error(data.error || '저장 실패');
    }
    setShowThresholdModal(false);
    toast.success(`한도 알림 ${config.enabled ? '활성화' : '비활성화'} 완료: 임계값 ${config.threshold_percent}% / 채널 ${config.channels.length}개`);
    await loadOverview();
  };

  // ── 도넛 segments
  const modelDonut = useMemo(() => {
    if (!overview || overview.model_distribution.length === 0) return [];
    const total = overview.model_distribution.reduce((s, d) => s + d.count, 0);
    return buildModelDonut(overview.model_distribution, total);
  }, [overview]);

  const modelTotal = useMemo(() => {
    if (!overview) return 0;
    return overview.model_distribution.reduce((s, d) => s + d.count, 0);
  }, [overview]);

  // ── 자세히 분석 source 집계
  const detailedSources = useMemo(() => {
    if (breakdown.length === 0) return [];
    const sourceTotals: Record<string, number> = {};
    for (const b of breakdown) {
      sourceTotals[b.source] = (sourceTotals[b.source] || 0) + b.count;
    }
    return Object.entries(sourceTotals)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [breakdown]);

  // ── 자세히 분석 일별 비용
  const dailyCosts = useMemo(() => {
    if (daily.length === 0) return null;
    const sorted = [...daily].reverse();
    const maxCost = Math.max(...sorted.map((d) => d.cost), 1);
    return { rows: sorted, maxCost };
  }, [daily]);

  const monthlyPercentDeltaClass = (delta: number | null) => {
    if (delta === null) return 'text-slate-400';
    if (delta > 0) return 'text-amber-700';
    if (delta < 0) return 'text-emerald-700';
    return 'text-slate-400';
  };

  return (
    <ZoneFrame
      moduleId="ai-memory"
      tabs={AI_MEMORY_TABS}
      activeTab="usage"
      stamp={{ text: '다시 읽기', onRefresh: reloadAll, loading: overviewLoading || forecastLoading }}
      command={{
        facts: overview ? [
          { label: '이번 달', value: `${overview.monthly_calls.toLocaleString()}회` },
          ...(overview.monthly_limit !== null ? [{ label: '한도', value: `${overview.monthly_percent}%`, tone: (overview.monthly_percent >= 80 ? 'amber' : undefined) as 'amber' | undefined }] : []),
          { label: '일평균', value: `${overview.daily_avg.toLocaleString()}회` },
        ] : [{ label: '이번 달', value: '—' }],
        note: '회사별 AI 호출 · 한도 · 캐시 효율 · 비용 예측',
        actions: [{ label: '한도 알림', icon: Bell, onClick: () => setShowThresholdModal(true) }],
      }}
      emphasis={
        <ZoneEmphasis kind="ai" title="AI 자율 진단" meta="실시간">
          {overviewLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              사용량 데이터 분석 중...
            </div>
          ) : overview ? (
            <p className="text-sm text-slate-800 leading-relaxed">{overview.top_insight}</p>
          ) : (
            <p className="text-sm text-slate-500">진단 정보를 불러올 수 없습니다.</p>
          )}
          {overview && overview.predicted_days_to_limit !== null && (
            <div className="mt-2 text-[12px] text-slate-500">
              한도 도달 예측 <strong className="text-amber-700">약 {overview.predicted_days_to_limit}일 후</strong>
            </div>
          )}
          <div className="text-[10px] text-slate-400 italic mt-3">
            Data source: ai_call_log + plans.ai_calls_per_month + cache 통계 (5분 TTL) + 지난달 같은 기간 대비 격차
          </div>
        </ZoneEmphasis>
      }
    >
      <div className="space-y-6">
        {/* DB 마이그레이션 안내 */}
        {migrationPending && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
            <Info className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-amber-900 mb-1">잠시 후 다시 시도해 주세요</div>
              <div className="text-xs text-slate-600 leading-relaxed">기능을 준비 중입니다. 잠시 후 다시 시도해 주세요.</div>
            </div>
          </div>
        )}

        {/* ───────── 3. 자연어 입력 + 빠른 시작 5 카드 ───────── */}
        <div className="space-y-3">
          <div className="p-4 bg-white border border-slate-200 rounded-2xl">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <span className="text-sm font-semibold text-slate-900">자연어로 사용량 데이터에 질문하기</span>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">예: "이번 달 가장 비용이 많이 든 호출 출처는?" (Enter 키로 즉시 검색)</p>
            <div className="flex gap-2">
              <input
                ref={queryInputRef}
                type="text"
                value={naturalQuery}
                onChange={(e) => setNaturalQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !naturalLoading) {
                    void runNaturalSearch(naturalQuery);
                  }
                }}
                placeholder="질문을 입력하고 Enter 키를 눌러주세요 (2~500자)"
                maxLength={500}
                disabled={naturalLoading}
                className="flex-1 min-w-0 px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 disabled:opacity-40"
              />
              <button
                onClick={() => runNaturalSearch(naturalQuery)}
                disabled={naturalLoading || naturalQuery.trim().length < 2}
                className="px-4 py-2.5 border border-indigo-200 text-indigo-700 hover:bg-indigo-50 text-sm rounded-lg font-medium disabled:opacity-40 flex items-center gap-1.5 shrink-0"
              >
                {naturalLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                질문
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            {QUICK_START_CARDS.map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.id}
                  onClick={() => handleQuickStart(card)}
                  disabled={naturalLoading && !!card.query}
                  className="p-3 bg-white border border-slate-200 hover:bg-slate-100 hover:border-slate-300 rounded-xl text-left transition-all group disabled:opacity-50"
                >
                  <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${card.gradient} flex items-center justify-center mb-2 shadow-md group-hover:scale-110 transition-transform`}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <div className="text-xs font-semibold text-slate-900 mb-0.5 truncate">{card.label}</div>
                  <div className="text-[10px] text-slate-500 leading-snug line-clamp-2">{card.hint}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ───────── 자연어 검색 결과 ───────── */}
        {naturalResult && (
          <div className="p-5 bg-gradient-to-br from-indigo-50 via-cyan-50 to-sky-50 border border-indigo-200 rounded-2xl space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-slate-400 mb-1">질문</div>
                <div className="text-sm text-slate-800 italic">"{naturalResult.query}"</div>
              </div>
              <button onClick={() => setNaturalResult(null)} className="p-1.5 rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100" aria-label="결과 닫기">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="pt-3 border-t border-slate-200">
              <div className="text-[10px] text-cyan-700 mb-1.5 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                AI 답변
              </div>
              {naturalLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  사용량 데이터를 분석하여 답변 생성 중...
                </div>
              ) : (
                <div className="text-sm text-slate-900 whitespace-pre-wrap leading-relaxed">{naturalResult.answer}</div>
              )}
            </div>
            <div className="text-[10px] text-slate-400 italic">
              Data source: ai_call_log 30일 + cache 통계 + 모델 추상 분포 (시스템 프롬프트 자동 포함)
            </div>
          </div>
        )}

        {/* ───────── 4. 5 metric 요약 + 지난달 같은 기간 대비(R074) ───────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <MetricCard
            icon={Calendar}
            label="이번 달 호출"
            value={overview ? overview.monthly_calls.toLocaleString() : '—'}
            unit="회"
            gradient="from-cyan-400 to-sky-500"
            footer={overview && overview.prev_month_delta_percent !== null
              ? <DeltaChip delta={overview.prev_month_delta_percent} />
              : <span className="text-[10px] text-slate-400">지난달 같은 기간 데이터 없음</span>}
          />
          <MetricCard
            icon={Gauge}
            label="한도 사용률"
            value={overview && overview.monthly_limit !== null ? `${overview.monthly_percent}` : '—'}
            unit={overview?.monthly_limit !== null ? '%' : ''}
            gradient={overview && overview.monthly_percent >= 80 ? 'from-rose-400 to-pink-500' : 'from-emerald-400 to-teal-500'}
            footer={overview?.monthly_limit === null
              ? <span className="text-[10px] text-emerald-700">무제한 요금제</span>
              : overview && (
                <span className="text-[10px] text-slate-500">
                  / {overview.monthly_limit?.toLocaleString()}회
                </span>
              )}
          />
          <MetricCard
            icon={Database}
            label="Cache 히트율"
            value={overview ? (overview.cache_hit_rate * 100).toFixed(1) : '—'}
            unit="%"
            gradient="from-emerald-400 to-teal-500"
            footer={overview && (
              <span className="text-[10px] text-slate-500">
                hit {overview.cache_hit.toLocaleString()} / miss {overview.cache_miss.toLocaleString()}
              </span>
            )}
          />
          <MetricCard
            icon={Activity}
            label="일평균 호출"
            value={overview ? overview.daily_avg.toLocaleString() : '—'}
            unit="회"
            gradient="from-violet-400 to-purple-500"
            footer={overview?.predicted_days_to_limit !== null && overview
              ? <span className="text-[10px] text-amber-700">한도 도달 {overview.predicted_days_to_limit}일 후 예측</span>
              : <span className="text-[10px] text-slate-400">직전 30일 평균</span>}
          />
          <MetricCard
            icon={Layers}
            label="Batch 처리"
            value={overview ? overview.batch_calls.toLocaleString() : '—'}
            unit="건"
            gradient="from-amber-400 to-orange-500"
            footer={<span className="text-[10px] text-slate-500">직전 30일 일괄 처리 (50% 절감)</span>}
          />
        </div>

        {/* ───────── 5. AI 비용 예측 라인 차트 ───────── */}
        <div className="p-5 bg-white border border-slate-200 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-cyan-700" />
              <h3 className="text-sm font-semibold text-slate-900">향후 30일 호출 예측 (선형 회귀)</h3>
            </div>
            {forecast && !forecast.no_data && (
              <span className="text-[11px] text-slate-500">
                일평균 <strong className="text-slate-900">{forecast.avg_daily_calls.toLocaleString()}회</strong>
                <span className="ml-2">추세 <strong className={forecast.trend_slope > 0 ? 'text-amber-700' : forecast.trend_slope < 0 ? 'text-emerald-700' : 'text-slate-500'}>
                  {forecast.trend_slope > 0 ? '+' : ''}{forecast.trend_slope}/일
                </strong></span>
              </span>
            )}
          </div>
          <CostForecastChart
            forecast={forecast?.daily_forecast || []}
            monthlyLimit={overview?.monthly_limit || null}
            loading={forecastLoading}
          />
          <div className="text-[10px] text-slate-400 italic mt-3">
            Data source: ai_call_log 직전 30일 일별 + 선형 회귀 (y = ax + b) 향후 30일 예측 + 일평균 한도 비교
          </div>
        </div>

        {/* ───────── 6. 1-click 액션 3 카드 ───────── */}
        <div className="grid md:grid-cols-3 gap-3">
          <button
            onClick={() => {
              const el = document.querySelector('[data-section="forecast"]');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              else toast.info('비용 예측 차트를 위에서 확인하실 수 있습니다.');
            }}
            className="p-4 bg-gradient-to-br from-sky-50 to-cyan-50 border border-sky-200 hover:border-sky-300 rounded-xl text-left transition-all group"
          >
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-sky-400 to-cyan-500 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div className="text-sm font-semibold text-slate-900 mb-1">비용 예측 보기</div>
            <div className="text-[11px] text-slate-500 leading-relaxed">
              향후 30일 호출 + 비용 예측 + 한도 도달 시점.
            </div>
          </button>

          <button
            onClick={() => setShowBatchGuide(true)}
            className="p-4 bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-200 hover:border-violet-300 rounded-xl text-left transition-all group"
          >
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div className="text-sm font-semibold text-slate-900 mb-1">Batch 모드 가이드</div>
            <div className="text-[11px] text-slate-500 leading-relaxed">
              24시간 SLA + 50% 비용 절감. 언제 사용하면 좋은가요?
            </div>
          </button>

          <button
            onClick={() => setShowThresholdModal(true)}
            disabled={!!migrationPending}
            className="p-4 bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 hover:border-amber-300 rounded-xl text-left transition-all group disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
              <Bell className="w-5 h-5 text-white" />
            </div>
            <div className="text-sm font-semibold text-slate-900 mb-1">한도 알림 설정</div>
            <div className="text-[11px] text-slate-500 leading-relaxed">
              50% / 80% / 95% 임계값 + 이메일/SMS/앱 알림 채널.
            </div>
            {overview?.threshold_config?.enabled && !migrationPending && (
              <div className="text-[10px] text-emerald-700 mt-1.5">
                활성: {overview.threshold_config.threshold_percent}% / {(overview.threshold_config.channels || []).length}개 채널
              </div>
            )}
            {/* ★ 2026-09-27 R075 — '앱 알림' 채널 = 이 화면 표시: 이번 달 사용률이 설정한 기준 이상이면 알린다 */}
            {overview?.threshold_config?.enabled && !migrationPending
              && (overview.threshold_config.channels || []).includes('inapp')
              && overview.monthly_limit !== null
              && overview.monthly_percent >= Number(overview.threshold_config.threshold_percent || 0) && (
              <div className="text-[10px] text-amber-700 mt-1">
                이번 달 사용량이 알림 기준 {overview.threshold_config.threshold_percent}%에 도달했습니다
              </div>
            )}
          </button>
        </div>

        {/* ───────── 7. 자세히 분석 토글 ───────── */}
        <div data-section="forecast" className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <button
            onClick={() => setShowDetailedAnalysis((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-white transition-colors"
          >
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-cyan-700" />
              <span className="text-sm font-semibold text-slate-900">자세히 분석</span>
              <span className="text-[10px] text-slate-400">AI 추론 분포 · 출처별 호출 · 일별 비용 · cache 효율</span>
            </div>
            {showDetailedAnalysis ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
          </button>

          {showDetailedAnalysis && (
            <div className="px-5 pb-5 space-y-5 border-t border-slate-100 pt-5">
              {detailedLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-5">
                  {/* a. AI 추론 모드 도넛 */}
                  <div className="p-4 bg-white border border-slate-200 rounded-xl">
                    <div className="text-xs font-semibold text-slate-900 mb-3">AI 추론 모드 분포 (30일)</div>
                    {modelTotal === 0 ? (
                      <div className="text-center py-6 text-slate-400 text-xs">데이터 부족</div>
                    ) : (
                      <div className="flex items-center gap-4">
                        <svg viewBox="0 0 200 200" className="w-32 h-32">
                          {modelDonut.map((d) => (
                            <path key={d.modelType} d={d.pathD} fill={d.color}>
                              <title>{d.label}: {d.count.toLocaleString()}회 ({(d.percent * 100).toFixed(1)}%)</title>
                            </path>
                          ))}
                          <text x="100" y="100" textAnchor="middle" dominantBaseline="middle" className="fill-slate-900" style={{ fontSize: '18px', fontWeight: 700 }}>
                            {modelTotal.toLocaleString()}
                          </text>
                        </svg>
                        <div className="flex-1 space-y-1">
                          {modelDonut.map((d) => (
                            <div key={d.modelType} className="flex items-center gap-2 text-[11px]">
                              <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.color }} />
                              <span className="text-slate-700 flex-1 truncate">{d.label}</span>
                              <span className="text-slate-500 font-mono">{d.count.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="text-[10px] text-slate-400 italic mt-2">Data source: ai_call_log.model_type 추상 매핑</div>
                  </div>

                  {/* b. source 상위 10 bar */}
                  <div className="p-4 bg-white border border-slate-200 rounded-xl">
                    <div className="text-xs font-semibold text-slate-900 mb-3">호출 출처 Top 10 (30일)</div>
                    {detailedSources.length === 0 ? (
                      <div className="text-center py-6 text-slate-400 text-xs">데이터 부족</div>
                    ) : (
                      <div className="space-y-1.5">
                        {(() => {
                          const max = Math.max(...detailedSources.map((s) => s.count), 1);
                          return detailedSources.map((s) => (
                            <div key={s.source} className="flex items-center gap-2 text-[11px]">
                              <div className="w-24 text-slate-600 truncate" title={s.source}>{s.source}</div>
                              <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-cyan-400 to-sky-500"
                                  style={{ width: `${(s.count / max) * 100}%` }}
                                />
                              </div>
                              <span className="text-slate-500 font-mono w-14 text-right">{s.count.toLocaleString()}</span>
                            </div>
                          ));
                        })()}
                      </div>
                    )}
                    <div className="text-[10px] text-slate-400 italic mt-2">Data source: ai_call_log.source GROUP BY</div>
                  </div>

                  {/* c. 일별 비용 area */}
                  <div className="p-4 bg-white border border-slate-200 rounded-xl md:col-span-2">
                    <div className="text-xs font-semibold text-slate-900 mb-3">직전 30일 일별 비용 추이</div>
                    {!dailyCosts ? (
                      <div className="text-center py-6 text-slate-400 text-xs">데이터 부족</div>
                    ) : (
                      <div className="flex items-end gap-1 h-32">
                        {dailyCosts.rows.map((d) => {
                          const heightPercent = (d.cost / dailyCosts.maxCost) * 100;
                          return (
                            <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group">
                              <div className="flex-1 w-full flex items-end">
                                <div
                                  className="w-full bg-gradient-to-t from-amber-50 to-orange-400 rounded-t-md hover:opacity-100 opacity-80 transition-opacity"
                                  style={{ height: `${heightPercent}%`, minHeight: d.cost > 0 ? '2px' : '0' }}
                                  title={`${d.date}: ${d.cost.toLocaleString()}원 / ${d.count.toLocaleString()}회`}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {dailyCosts && (
                      <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                        <span>{dailyCosts.rows[0]?.date.slice(5)}</span>
                        <span className="font-mono">
                          총 {dailyCosts.rows.reduce((s, d) => s + d.cost, 0).toLocaleString()}원
                          {' / '}
                          {dailyCosts.rows.reduce((s, d) => s + d.count, 0).toLocaleString()}회
                        </span>
                        <span>{dailyCosts.rows[dailyCosts.rows.length - 1]?.date.slice(5)}</span>
                      </div>
                    )}
                    <div className="text-[10px] text-slate-400 italic mt-2">Data source: ai_call_log.cost_won 일별 합계</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ───────── 8. Source caption ───────── */}
        <div className="text-center text-[10px] text-slate-400 italic pt-4">
          Data source: ai_call_log (호출별 비용 + 모델 + source) + plans.ai_calls_per_month (월 한도) + ai_cache (5분 TTL) + ai_batch_jobs (Batch 처리)
          <br />
          AI 모델은 호출 의도에 따라 자동 선택됩니다. 추상 명칭으로 표시 (고급/표준/보조 추론 모드)
        </div>
      </div>

      {/* ───────── 모달 ───────── */}
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
      <ThresholdAlertModal
        open={showThresholdModal}
        onClose={() => setShowThresholdModal(false)}
        initial={overview?.threshold_config || null}
        onSave={handleThresholdSave}
      />
      <BatchModeGuideModal open={showBatchGuide} onClose={() => setShowBatchGuide(false)} />
    </ZoneFrame>
  );
}

// ════════════════════════════════════════════════════════════════════
// 5 Metric Card 컴포넌트 (페이지 내 inline)
// ════════════════════════════════════════════════════════════════════

interface MetricCardProps {
  icon: typeof Calendar;
  label: string;
  value: string;
  unit: string;
  gradient: string;
  footer: React.ReactNode;
}

function MetricCard({ icon: Icon, label, value, unit, gradient, footer }: MetricCardProps) {
  return (
    <div className="p-4 bg-white border border-slate-200 rounded-xl">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center flex-shrink-0`}>
          <Icon className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-[11px] text-slate-500 font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold text-slate-900">
        {value}
        {unit && <span className="text-sm text-slate-400 font-normal ml-1">{unit}</span>}
      </div>
      <div className="mt-1">{footer}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 지난달 같은 기간 대비 격차 chip
// ════════════════════════════════════════════════════════════════════

function DeltaChip({ delta }: { delta: number }) {
  if (delta === 0) {
    return <span className="text-[10px] text-slate-400">지난달 같은 기간 대비 변동 없음</span>;
  }
  const isUp = delta > 0;
  const Icon = isUp ? TrendingUp : TrendingDown;
  const tone = isUp ? 'text-amber-700' : 'text-emerald-700';
  return (
    <span className={`text-[10px] ${tone} flex items-center gap-0.5`}>
      <Icon className="w-2.5 h-2.5" />
      지난달 같은 기간 대비 {isUp ? '+' : ''}{delta}%
    </span>
  );
}
