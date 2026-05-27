/**
 * JourneyStatsPage.tsx — Journey 통계 시각화 (D192 2026-05-22)
 *
 * 매트릭스:
 *  1. Overview 카드 6건
 *  2. Step별 통계 테이블 (발송/실패/Skip + 클릭률 + 전환율)
 *  3. 등급별 효과 (Bar chart)
 *  4. 시간대별 발송/클릭 (24시간 line chart)
 *  5. 요일별 발송/클릭 (7일 bar chart)
 *  6. Variant Bandit 효과 (A/B 분기 posterior)
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts';
import {
  ArrowLeft, Users, CheckCircle2, XCircle, Pause, Loader2,
  TrendingUp, DollarSign, BarChart3, MousePointerClick, ShoppingCart, Beaker,
} from 'lucide-react';

interface JourneyStatsData {
  overview: {
    totalEntered: number;
    active: number;
    completed: number;
    paused: number;
    failed: number;
    totalCost: number;
    totalSent: number;
    totalFailed: number;
    totalSkipped: number;
    avgCompletionHours: number | null;
    completionRate: number;
  };
  steps: Array<{
    stepId: string;
    stepOrder: number;
    stepType: string;
    channel: string | null;
    enteredCount: number;
    sentCount: number;
    failedCount: number;
    skippedCount: number;
    totalCost: number;
    clickCount: number;
    conversionCount: number;
    clickRate: number;
    conversionRate: number;
  }>;
  segments: Array<{
    segment: string;
    enteredCount: number;
    completedCount: number;
    clickCount: number;
    conversionCount: number;
  }>;
  hourly: Array<{ hour: number; sentCount: number; clickCount: number; conversionCount: number }>;
  weekday: Array<{ weekday: number; sentCount: number; clickCount: number; conversionCount: number }>;
  variants: Array<{
    stepId: string;
    variantId: string;
    variantLabel: string;
    trafficWeight: number;
    sentCount: number;
    clickCount: number;
    conversionCount: number;
    posteriorMean: number;
    posteriorAlpha: number;
    posteriorBeta: number;
  }>;
}

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export default function JourneyStatsPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [stats, setStats] = useState<JourneyStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [journeyName, setJourneyName] = useState('');

  const token = () => localStorage.getItem('token');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [statsRes, journeyRes] = await Promise.all([
          fetch(`/api/ai/operator/journeys/${id}/stats`, {
            headers: { Authorization: `Bearer ${token()}` },
          }),
          fetch(`/api/ai/operator/journeys/${id}`, {
            headers: { Authorization: `Bearer ${token()}` },
          }),
        ]);
        const statsData = await statsRes.json();
        const journeyData = await journeyRes.json();
        if (statsData.success) setStats(statsData.stats);
        else setError(statsData.error || '통계 조회 실패');
        if (journeyData.success) setJourneyName(journeyData.detail?.journey?.name || '');
      } catch {
        setError('네트워크 오류');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const formatCost = (n: number) => `${n.toLocaleString('ko-KR')}원`;
  const formatPct = (n: number) => `${(n * 100).toFixed(1)}%`;

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900 text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900 text-white flex items-center justify-center">
        <div className="text-rose-300">{error || '통계 데이터 없음'}</div>
      </div>
    );
  }

  const hourlyData = stats.hourly.map((h) => ({ name: `${h.hour}시`, 발송: h.sentCount, 클릭: h.clickCount }));
  const weekdayData = stats.weekday.map((w) => ({ name: WEEKDAY_LABELS[w.weekday], 발송: w.sentCount, 클릭: w.clickCount }));
  const segmentData = stats.segments.map((s) => ({ name: s.segment, 진입: s.enteredCount, 완료: s.completedCount, 클릭: s.clickCount, 전환: s.conversionCount }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900 text-white">
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate(`/ai-journeys/${id}`)} className="p-2 hover:bg-white/5 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-violet-400" />
              {journeyName || '여정'} — 통계 분석
            </h1>
            <p className="text-sm text-white/50 mt-0.5">전체 효과 + 등급별 + 시간대 + 요일 + Variant Bandit</p>
          </div>
        </div>

        {/* Overview 카드 6건 */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <Card icon={<Users className="w-4 h-4" />} label="총 진입" value={stats.overview.totalEntered.toLocaleString()} color="text-blue-300" />
          <Card icon={<TrendingUp className="w-4 h-4" />} label="진행 중" value={stats.overview.active.toLocaleString()} color="text-cyan-300" />
          <Card icon={<CheckCircle2 className="w-4 h-4" />} label="완료" value={stats.overview.completed.toLocaleString()} color="text-emerald-300" />
          <Card icon={<Pause className="w-4 h-4" />} label="일시정지" value={stats.overview.paused.toLocaleString()} color="text-amber-300" />
          <Card icon={<XCircle className="w-4 h-4" />} label="실패" value={stats.overview.failed.toLocaleString()} color="text-rose-300" />
          <Card icon={<DollarSign className="w-4 h-4" />} label="총 비용" value={formatCost(stats.overview.totalCost)} color="text-fuchsia-300" />
        </div>

        {/* Step별 통계 */}
        <Section title="Step별 효과 매트릭스" subtitle="발송/실패/Skip + 클릭률 + 전환율">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5 border-b border-white/10">
                <tr className="text-left text-white/60 text-xs">
                  <th className="px-3 py-2.5 font-medium">Step</th>
                  <th className="px-3 py-2.5 font-medium">유형</th>
                  <th className="px-3 py-2.5 font-medium">채널</th>
                  <th className="px-3 py-2.5 font-medium text-right">진입</th>
                  <th className="px-3 py-2.5 font-medium text-right">발송</th>
                  <th className="px-3 py-2.5 font-medium text-right">실패</th>
                  <th className="px-3 py-2.5 font-medium text-right">Skip</th>
                  <th className="px-3 py-2.5 font-medium text-right">클릭</th>
                  <th className="px-3 py-2.5 font-medium text-right">전환</th>
                  <th className="px-3 py-2.5 font-medium text-right">클릭률</th>
                  <th className="px-3 py-2.5 font-medium text-right">전환율</th>
                  <th className="px-3 py-2.5 font-medium text-right">비용</th>
                </tr>
              </thead>
              <tbody>
                {stats.steps.map((s) => (
                  <tr key={s.stepId} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2.5">#{s.stepOrder + 1}</td>
                    <td className="px-3 py-2.5 text-xs">{s.stepType}</td>
                    <td className="px-3 py-2.5 text-xs uppercase">{s.channel || '-'}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{s.enteredCount.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{s.sentCount.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-rose-300">{s.failedCount.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-amber-300">{s.skippedCount.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-cyan-300">{s.clickCount.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-emerald-300">{s.conversionCount.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{formatPct(s.clickRate)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{formatPct(s.conversionRate)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{formatCost(s.totalCost)}</td>
                  </tr>
                ))}
                {stats.steps.length === 0 && (
                  <tr><td colSpan={12} className="text-center py-8 text-white/40">step 데이터 없음</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        {/* 등급별 Bar chart */}
        <Section title="등급별 효과 매트릭스" subtitle="진입/완료/클릭/전환 카운트">
          {segmentData.length === 0 ? (
            <div className="text-center py-8 text-white/40">데이터 없음</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={segmentData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="name" stroke="rgba(255,255,255,0.6)" />
                <YAxis stroke="rgba(255,255,255,0.6)" />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                <Legend />
                <Bar dataKey="진입" fill="#3b82f6" />
                <Bar dataKey="완료" fill="#10b981" />
                <Bar dataKey="클릭" fill="#06b6d4" />
                <Bar dataKey="전환" fill="#a855f7" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>

        {/* 시간대별 Line chart */}
        <Section title="시간대별 효과 (24시간 KST)" subtitle="발송 + 클릭 정시별 매트릭스">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={hourlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="name" stroke="rgba(255,255,255,0.6)" />
              <YAxis stroke="rgba(255,255,255,0.6)" />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
              <Legend />
              <Line type="monotone" dataKey="발송" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="클릭" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Section>

        {/* 요일별 Bar chart */}
        <Section title="요일별 효과" subtitle="발송 + 클릭 요일별 매트릭스">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={weekdayData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="name" stroke="rgba(255,255,255,0.6)" />
              <YAxis stroke="rgba(255,255,255,0.6)" />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
              <Legend />
              <Bar dataKey="발송" fill="#3b82f6" />
              <Bar dataKey="클릭" fill="#06b6d4" />
            </BarChart>
          </ResponsiveContainer>
        </Section>

        {/* Variant Bandit 효과 */}
        {stats.variants.length > 0 && (
          <Section title="A/B Variant Bandit 효과" subtitle="Thompson Sampling posterior 매트릭스 — 자동 최적화 효과">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/5 border-b border-white/10">
                  <tr className="text-left text-white/60 text-xs">
                    <th className="px-3 py-2.5 font-medium">Step</th>
                    <th className="px-3 py-2.5 font-medium">Variant</th>
                    <th className="px-3 py-2.5 font-medium text-right">분배율</th>
                    <th className="px-3 py-2.5 font-medium text-right">발송</th>
                    <th className="px-3 py-2.5 font-medium text-right">클릭</th>
                    <th className="px-3 py-2.5 font-medium text-right">전환</th>
                    <th className="px-3 py-2.5 font-medium text-right">사후 평균</th>
                    <th className="px-3 py-2.5 font-medium text-right">신뢰</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.variants.map((v) => (
                    <tr key={v.variantId} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-3 py-2.5 text-xs font-mono">{v.stepId.slice(0, 8)}</td>
                      <td className="px-3 py-2.5"><span className="px-2 py-0.5 bg-violet-500/20 text-violet-200 rounded text-xs">{v.variantLabel}</span></td>
                      <td className="px-3 py-2.5 text-right font-mono">{formatPct(v.trafficWeight)}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{v.sentCount.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-cyan-300">{v.clickCount.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-emerald-300">{v.conversionCount.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-violet-300">{formatPct(v.posteriorMean)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-white/50">α={v.posteriorAlpha.toFixed(1)} β={v.posteriorBeta.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 p-2 bg-violet-500/5 border border-violet-400/20 rounded text-[11px] text-violet-200/80 flex items-start gap-1.5">
              <Beaker className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span>Thompson Sampling 자동 최적화 — 효과 높은 variant 자동 가중치 증가. 사후 평균이 높을수록 우수 variant.</span>
            </div>
          </Section>
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

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 bg-white/5 border border-white/10 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <p className="text-[11px] text-white/40 mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
