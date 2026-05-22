/**
 * PredictiveDashboardPage.tsx — Phase B-2 Predictive Suite 대시보드 (D197 2026-05-22)
 *
 * AI 자율 판단 시각화:
 *  - 회사 전체 예측 점수 히스토그램 3건 (클릭률 / 이탈 위험 / 구매 가능성)
 *  - Top 이탈 위험 50명 매트릭스
 *  - Top 구매 가능성 50명 매트릭스
 *  - 모델 정확도 검증 (옛 예측 vs 실 결과 비교)
 *  - AI 자율 추천 안내 (insightText)
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import {
  ArrowLeft, Brain, MousePointerClick, AlertTriangle, ShoppingCart, Loader2,
  TrendingUp, Activity, Users, Sparkles,
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
  totalCustomers: number;
  highRiskCount: number;
  highPotentialCount: number;
  avgClickScore: number;
  avgChurnRisk: number;
  avgPurchaseLikelihood: number;
  insightText: string;
}

export default function PredictiveDashboardPage() {
  const navigate = useNavigate();
  const [distribution, setDistribution] = useState<Distribution | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'risk' | 'potential'>('risk');

  const token = () => localStorage.getItem('token');

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

  const currentList = tab === 'risk' ? distribution.topRiskCustomers : distribution.topPotentialCustomers;

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

        {/* Overview 카드 6건 */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <Card icon={<Users className="w-4 h-4" />} label="총 고객" value={summary.totalCustomers.toLocaleString()} color="text-blue-300" />
          <Card icon={<AlertTriangle className="w-4 h-4" />} label="이탈 위험 70%+" value={summary.highRiskCount.toLocaleString()} color="text-rose-300" />
          <Card icon={<ShoppingCart className="w-4 h-4" />} label="구매 가능성 60%+" value={summary.highPotentialCount.toLocaleString()} color="text-emerald-300" />
          <Card icon={<MousePointerClick className="w-4 h-4" />} label="평균 클릭률" value={formatPct(summary.avgClickScore)} color="text-cyan-300" />
          <Card icon={<Activity className="w-4 h-4" />} label="평균 이탈 위험" value={formatPct(summary.avgChurnRisk)} color="text-amber-300" />
          <Card icon={<TrendingUp className="w-4 h-4" />} label="평균 구매 가능성" value={formatPct(summary.avgPurchaseLikelihood)} color="text-fuchsia-300" />
        </div>

        {/* 히스토그램 3건 */}
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

        {/* 모델 정확도 */}
        {distribution.modelAccuracy && (
          <div className="mb-6 p-4 bg-white/5 border border-white/10 rounded-xl">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="w-4 h-4 text-violet-300" />
              <h2 className="text-sm font-semibold">모델 정확도 검증 (옛 예측 vs 실 결과)</h2>
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

        {/* Top 50 매트릭스 */}
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
            <button
              onClick={() => setTab('risk')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                tab === 'risk' ? 'bg-rose-500/30 text-rose-200' : 'text-white/50 hover:text-white/80'
              }`}
            >
              <AlertTriangle className="w-3 h-3 inline mr-1" /> Top 이탈 위험 50명
            </button>
            <button
              onClick={() => setTab('potential')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                tab === 'potential' ? 'bg-emerald-500/30 text-emerald-200' : 'text-white/50 hover:text-white/80'
              }`}
            >
              <ShoppingCart className="w-3 h-3 inline mr-1" /> Top 구매 가능성 50명
            </button>
          </div>
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
                  <th className="px-3 py-2.5 font-medium text-right">미활동 일수</th>
                </tr>
              </thead>
              <tbody>
                {currentList.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-12 text-white/40">예측 데이터 없음 — 1시간 안에 자동 계산됩니다.</td></tr>
                ) : currentList.map((c) => (
                  <tr key={c.customerId} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2.5">{c.customerName || '-'}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{c.customerPhone || '-'}</td>
                    <td className="px-3 py-2.5">{c.customerGrade || '-'}</td>
                    <td className="px-3 py-2.5">{c.customerRegion || '-'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-cyan-300">{formatPct(c.clickScore)}</td>
                    <td className={`px-3 py-2.5 text-right font-mono ${c.churnRisk > 0.7 ? 'text-rose-300' : 'text-white/70'}`}>{formatPct(c.churnRisk)}</td>
                    <td className={`px-3 py-2.5 text-right font-mono ${c.purchaseLikelihood > 0.6 ? 'text-emerald-300' : 'text-white/70'}`}>{formatPct(c.purchaseLikelihood)}</td>
                    <td className="px-3 py-2.5 text-right text-xs text-white/60">{c.lastActivityDays !== null ? `${c.lastActivityDays}일` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 컴퓨팅 시점 */}
        {distribution.computedAt && (
          <div className="mt-4 text-center text-[11px] text-white/40">
            마지막 계산: {new Date(distribution.computedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 1시간 주기 자동 갱신
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
      <div className={`flex items-center gap-1.5 text-xs ${color} mb-1.5`}>
        {icon}<span>{label}</span>
      </div>
      <div className="text-lg md:text-xl font-semibold font-mono">{value}</div>
    </div>
  );
}

function HistogramCard({
  title, icon, data, color, invertColor,
}: {
  title: string;
  icon: React.ReactNode;
  data: HistogramBin[];
  color: string;
  invertColor?: boolean;
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
