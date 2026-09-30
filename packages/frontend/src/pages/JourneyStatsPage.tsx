import { Workflow } from 'lucide-react';
import { OUI_CHART_AXIS, OUI_CHART_GRID, OUI_CHART_TOOLTIP } from '../utils/operator-ui';
import ZoneFrame from '../components/zone/ZoneFrame';
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
import { goBackOr } from '../lib/scroll-restoration';
// ★ 2026-09-29 여정 V2 0차 ⑤⑦ — 칸 종류 표기는 공용 유틸 한 곳.
import { stepTypeLabel } from '../utils/journey-labels';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts';
import {
  ArrowLeft, Users, CheckCircle2, XCircle, Pause, Loader2,
  TrendingUp, DollarSign, BarChart3, MousePointerClick, ShoppingCart, Beaker, Target,
} from 'lucide-react';

interface JourneyStatsData {
  overview: {
    /** ★ 2026-07-10 목표 달성 종료(진입 이후 구매 확인 이탈) — 성과 지표 */
    goalMet?: number;
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
    /** ★ 2026-07-11 홀드아웃 대조군(미발송) */
    holdout?: number;
  };
  /** ★ 2026-07-11 홀드아웃 증분 비교 — 대조군 없으면 null */
  holdoutCompare?: {
    holdoutTotal: number;
    holdoutConverted: number;
    sentTotal: number;
    sentConverted: number;
    holdoutRate: number;
    sentRate: number;
  } | null;
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
      <ZoneFrame moduleId="journeys" sub="성과" backTo={`/ai-journeys/${id}`} backLabel="여정 상세로">
        <div className="py-24 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
      </ZoneFrame>
    );
  }

  if (error || !stats) {
    return (
      <ZoneFrame moduleId="journeys" sub="성과" backTo={`/ai-journeys/${id}`} backLabel="여정 상세로">
        <div className="py-24 text-center text-rose-700">{error || '통계 데이터 없음'}</div>
      </ZoneFrame>
    );
  }

  const hourlyData = stats.hourly.map((h) => ({ name: `${h.hour}시`, 발송: h.sentCount, 클릭: h.clickCount }));
  const weekdayData = stats.weekday.map((w) => ({ name: WEEKDAY_LABELS[w.weekday], 발송: w.sentCount, 클릭: w.clickCount }));
  const segmentData = stats.segments.map((s) => ({ name: s.segment, 진입: s.enteredCount, 완료: s.completedCount, 클릭: s.clickCount, 전환: s.conversionCount }));

  return (
    <ZoneFrame
      moduleId="journeys"
      sub={`${journeyName || '여정'} · 성과`}
      backTo={`/ai-journeys/${id}`}
      backLabel="여정 상세로"
      aux={{ label: '진입 고객', icon: Users, onClick: () => navigate(`/ai-journeys/${id}`) }}
    >
      <div>
        {/* Overview 카드 — ★ 2026-07-10 목표 달성(진입 후 구매 확인 이탈 = 성과) 추가 */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          <Card icon={<Users className="w-4 h-4" />} label="총 진입" value={stats.overview.totalEntered.toLocaleString()} color="text-blue-700" />
          <Card icon={<TrendingUp className="w-4 h-4" />} label="진행 중" value={stats.overview.active.toLocaleString()} color="text-cyan-700" />
          <Card icon={<CheckCircle2 className="w-4 h-4" />} label="완료" value={stats.overview.completed.toLocaleString()} color="text-emerald-700" />
          <Card icon={<Target className="w-4 h-4" />} label="목표 달성" value={Number(stats.overview.goalMet || 0).toLocaleString()} color="text-emerald-700" />
          <Card icon={<Pause className="w-4 h-4" />} label="일시정지" value={stats.overview.paused.toLocaleString()} color="text-amber-700" />
          <Card icon={<XCircle className="w-4 h-4" />} label="실패" value={stats.overview.failed.toLocaleString()} color="text-rose-700" />
          <Card icon={<DollarSign className="w-4 h-4" />} label="총 비용" value={formatCost(stats.overview.totalCost)} color="text-fuchsia-700" />
        </div>
        {Number(stats.overview.goalMet || 0) > 0 && (
          <div className="text-[11px] text-emerald-700 -mt-4 mb-6">목표 달성 = 여정 진입 후 목표 달성이 확인되어 남은 발송 없이 종료된 고객. 이 여정이 만든 성과입니다.</div>
        )}

        {/* ★ 2026-07-11 홀드아웃 증분 비교 — 발송군 vs 미발송 대조군 전환율 */}
        {stats.holdoutCompare && stats.holdoutCompare.holdoutTotal > 0 && (
          <div className="mb-6 p-4 bg-sky-50 border border-sky-200 rounded-xl">
            <div className="flex items-center gap-2 mb-3">
              <Beaker className="w-4 h-4 text-sky-700" />
              <span className="text-sm font-semibold text-sky-900">홀드아웃 증분 비교</span>
              <span className="text-[10px] text-slate-400">이 여정이 실제로 전환을 만드는지: 발송군 vs 미발송 대조군</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 bg-white border border-slate-200 rounded-lg">
                <div className="text-[10px] text-slate-400 mb-1">발송군 전환율</div>
                <div className="text-xl font-bold text-emerald-700 tabular-nums">{(stats.holdoutCompare.sentRate * 100).toFixed(1)}%</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{stats.holdoutCompare.sentConverted.toLocaleString()} / {stats.holdoutCompare.sentTotal.toLocaleString()}명</div>
              </div>
              <div className="p-3 bg-white border border-slate-200 rounded-lg">
                <div className="text-[10px] text-slate-400 mb-1">대조군 전환율 (미발송)</div>
                <div className="text-xl font-bold text-slate-600 tabular-nums">{(stats.holdoutCompare.holdoutRate * 100).toFixed(1)}%</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{stats.holdoutCompare.holdoutConverted.toLocaleString()} / {stats.holdoutCompare.holdoutTotal.toLocaleString()}명</div>
              </div>
              <div className="p-3 bg-white border border-slate-200 rounded-lg">
                <div className="text-[10px] text-slate-400 mb-1">증분 효과 (발송군 − 대조군)</div>
                <div className={`text-xl font-bold tabular-nums ${stats.holdoutCompare.sentRate >= stats.holdoutCompare.holdoutRate ? 'text-sky-700' : 'text-rose-700'}`}>
                  {((stats.holdoutCompare.sentRate - stats.holdoutCompare.holdoutRate) * 100).toFixed(1)}%p
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">전환 판정 = 진입 이후 구매(이벤트·프로필)</div>
              </div>
            </div>
            <div className="text-[10px] text-slate-400 italic mt-2">Data source: journey_executions(holdout) × cdp_events·customers 실측</div>
          </div>
        )}

        {/* Step별 통계 */}
        <Section title="Step별 효과 매트릭스" subtitle="발송/실패/Skip + 클릭률 + 전환율">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white border-b border-slate-200">
                <tr className="text-left text-slate-500 text-xs">
                  <th className="px-3 py-2.5 font-medium">Step</th>
                  <th className="px-3 py-2.5 font-medium">유형</th>
                  <th className="px-3 py-2.5 font-medium">채널</th>
                  <th className="px-3 py-2.5 font-medium text-right">진입</th>
                  <th className="px-3 py-2.5 font-medium text-right">발송</th>
                  <th className="px-3 py-2.5 font-medium text-right">실패</th>
                  <th className="px-3 py-2.5 font-medium text-right">건너뜀</th>
                  <th className="px-3 py-2.5 font-medium text-right">클릭</th>
                  <th className="px-3 py-2.5 font-medium text-right">전환</th>
                  <th className="px-3 py-2.5 font-medium text-right">클릭률</th>
                  <th className="px-3 py-2.5 font-medium text-right">전환율</th>
                  <th className="px-3 py-2.5 font-medium text-right">비용</th>
                </tr>
              </thead>
              <tbody>
                {stats.steps.map((s) => (
                  <tr key={s.stepId} className="border-b border-slate-100 hover:bg-white">
                    <td className="px-3 py-2.5">{s.stepOrder}번째</td>
                    <td className="px-3 py-2.5 text-xs">{stepTypeLabel(s.stepType)}</td>
                    <td className="px-3 py-2.5 text-xs uppercase">{s.channel || '-'}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{s.enteredCount.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{s.sentCount.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-rose-700">{s.failedCount.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-amber-700">{s.skippedCount.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-cyan-700">{s.clickCount.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-emerald-700">{s.conversionCount.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{formatPct(s.clickRate)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{formatPct(s.conversionRate)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{formatCost(s.totalCost)}</td>
                  </tr>
                ))}
                {stats.steps.length === 0 && (
                  <tr><td colSpan={12} className="text-center py-8 text-slate-400">step 데이터 없음</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        {/* 등급별 Bar chart */}
        <Section title="등급별 효과 매트릭스" subtitle="진입/완료/클릭/전환 카운트">
          {segmentData.length === 0 ? (
            <div className="text-center py-8 text-slate-400">데이터 없음</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={segmentData}>
                <CartesianGrid strokeDasharray="3 3" stroke={OUI_CHART_GRID} />
                <XAxis dataKey="name" stroke={OUI_CHART_AXIS} />
                <YAxis stroke={OUI_CHART_AXIS} />
                <Tooltip contentStyle={OUI_CHART_TOOLTIP} />
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
              <CartesianGrid strokeDasharray="3 3" stroke={OUI_CHART_GRID} />
              <XAxis dataKey="name" stroke={OUI_CHART_AXIS} />
              <YAxis stroke={OUI_CHART_AXIS} />
              <Tooltip contentStyle={OUI_CHART_TOOLTIP} />
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
              <CartesianGrid strokeDasharray="3 3" stroke={OUI_CHART_GRID} />
              <XAxis dataKey="name" stroke={OUI_CHART_AXIS} />
              <YAxis stroke={OUI_CHART_AXIS} />
              <Tooltip contentStyle={OUI_CHART_TOOLTIP} />
              <Legend />
              <Bar dataKey="발송" fill="#3b82f6" />
              <Bar dataKey="클릭" fill="#06b6d4" />
            </BarChart>
          </ResponsiveContainer>
        </Section>

        {/* Variant Bandit 효과 */}
        {stats.variants.length > 0 && (
          <Section title="A/B Variant Bandit 효과" subtitle="Thompson Sampling posterior 매트릭스: 자동 최적화 효과">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white border-b border-slate-200">
                  <tr className="text-left text-slate-500 text-xs">
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
                    <tr key={v.variantId} className="border-b border-slate-100 hover:bg-white">
                      <td className="px-3 py-2.5 text-xs font-mono">{v.stepId.slice(0, 8)}</td>
                      <td className="px-3 py-2.5"><span className="px-2 py-0.5 bg-violet-100 text-violet-800 rounded text-xs">{v.variantLabel}</span></td>
                      <td className="px-3 py-2.5 text-right font-mono">{formatPct(v.trafficWeight)}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{v.sentCount.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-cyan-700">{v.clickCount.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-emerald-700">{v.conversionCount.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-violet-700">{formatPct(v.posteriorMean)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-slate-500">α={v.posteriorAlpha.toFixed(1)} β={v.posteriorBeta.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 p-2 bg-violet-50 border border-violet-200 rounded text-[11px] text-violet-800 flex items-start gap-1.5">
              <Beaker className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span>Thompson Sampling 자동 최적화. 효과 높은 variant 자동 가중치 증가. 사후 평균이 높을수록 우수 variant.</span>
            </div>
          </Section>
        )}
      </div>
    </ZoneFrame>
  );
}

function Card({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="p-3 bg-white border border-slate-200 rounded-lg">
      <div className={`flex items-center gap-1.5 text-xs ${color} mb-1.5`}>
        {icon}<span>{label}</span>
      </div>
      <div className="text-lg md:text-xl font-semibold font-mono">{value}</div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
